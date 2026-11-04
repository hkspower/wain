#!/usr/bin/env node
// LIVE SCHEMA DIFF — is the database the shop is connected to the database the code was written for?
//
//   node scripts/db-schema-live-diff.mjs --live --config /run/sporta-api-config.php --expected-file expected-schema.json
//   node scripts/db-schema-live-diff.mjs --live --expected-build            (build the expectation first; needs the repo + MariaDB)
//   node scripts/db-schema-live-diff.mjs --snapshot                          (regenerate ops/db/expected-schema.json from the repo)
//   node scripts/db-schema-live-diff.mjs --check-snapshot                    (exit 3 if the committed snapshot is stale)
//   node scripts/db-schema-live-diff.mjs --expected [--json]                 (build the expectation, print it, write nothing)
//   node scripts/db-schema-live-diff.mjs --lint-migrations [--json]          (static rules over every *.mysql.sql)
//   node scripts/db-schema-live-diff.mjs --integrity [--json]                (apply / repeat / reorder / install-vs-schema / seed re-run, on a private MariaDB)
//   node scripts/db-schema-live-diff.mjs --make-job                          (write ops/db/schema-diff.compose.json)
//   options: --json | --markdown (default for --live) · --strict (warnings fail too) · --no-fail · --out FILE
//
// WHY IT EXISTS. CLAUDE.md: "Before deploying code that touches a new column, diff the live schema (read-only
// job) against the migrations." Until now that was a person reading SHOW COLUMNS. The cost of not doing it is on
// record: on 2026-11-02 the live database lacked inventory.mysql.sql, the stock claim wrote product_variants.
// inventory_version, the column did not exist, and every order answered 500 for 33 days. A regex over the PHP
// finds nothing there; the database does.
//
// THE THREE INPUTS
//   expected   the schema the repository builds: schema.mysql.sql, the install parts, every other migration, on a
//              throw-away private MariaDB (--snapshot writes it as ops/db/expected-schema.json; the committed file
//              is what the one-shot VPS job carries, because the job has no checkout and no MariaDB of its own).
//              The snapshot also records WHICH FILE creates each object (so the report says "apply
//              inventory.mysql.sql") and WHICH PHP FILES use each column and whether they guard it with
//              store_column_exists() / SHOW COLUMNS / a 1054 handler (so a guarded column is a warning).
//   live       information_schema of the connected database: tables, columns, indexes, foreign keys, CHECK
//              constraints, triggers, routines, events. Read through a session that is READ ONLY; the first thing the
//              tool does is assert @@tx_read_only = 1, and every statement it sends goes through a gate that
//              refuses anything but SELECT / SHOW. No row data is read; no value of any table is printed.
//   the diff   see diffSchemas(). Each finding says what the CODE needs: `code` (a table, column, unique key or
//              type the PHP uses and does not guard; exit 1), `guarded` (the PHP asks first; warning), `integrity`
//              (a missing foreign key or CHECK, a missing plain index: nothing breaks today; warning),
//              `drift` (a type, default or collation that differs but still works; warning/info) and `extra`
//              (something live that the repo does not know: an old-build table, an OpenCart leftover; info).
//
// EXIT CODES  0 nothing the code needs is missing · 1 something is (or any warning with --strict) · 2 the tool
// could not do its job (no connection, session not read-only) · 3 the committed snapshot is stale.
//
// NO DEPENDENCIES for --live: the MySQL text protocol client below is the one db-url-scan.mjs uses (handshake v10,
// mysql_native_password, COM_QUERY), so the script runs in a bare node:24-alpine job. The local modes load
// scripts/lib/private-mariadb.mjs on demand and never run on the VPS.
//
// MUTATION MARKERS: the `/*M:xxx*/` comments are used by scripts/db-schema-live-diff-test.mjs, which blanks one
// comparison at a time in a copy of this file and requires the suite to go red. Do not remove them.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = resolve(HERE, '..')
export const SQLDIR = join(WEB, 'dropin/php-store')
export const SNAPSHOT_FILE = join(WEB, 'ops/db/expected-schema.json')
export const JOB_FILE = join(WEB, 'ops/db/schema-diff.compose.json')
export const FORMAT = 'sporta-expected-schema/1'

// ============================================================================ the read-only gate
// Everything the live mode sends passes through here. A statement that is not a SELECT or a SHOW is refused
// BEFORE it reaches the socket; the session is also READ ONLY at the server, so there are two locks.
export class ReadOnlyViolation extends Error {}
const SETUP = /^(set\s+session\s+transaction\s+read\s+only|start\s+transaction\s+read\s+only|rollback|set\s+session\s+max_statement_time\s*=\s*\d+)$/i
export function assertReadOnlySql(sql) {
  const s = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim().replace(/;+\s*$/, '')
  /*M:gate-multi*/
  if (s.includes(';')) throw new ReadOnlyViolation('refused: more than one statement')
  /*M:gate-verb*/
  if (/^(select|show)\b/i.test(s) || SETUP.test(s)) {
    // A SELECT can still write: INTO OUTFILE / DUMPFILE, or a locking read (FOR UPDATE / LOCK IN SHARE MODE).
    if (/\binto\s+(outfile|dumpfile)\b/i.test(s) || /\bfor\s+update\b/i.test(s) || /\block\s+in\s+share\s+mode\b/i.test(s)) throw new ReadOnlyViolation('refused: a SELECT that writes or locks')
    return s
  }
  throw new ReadOnlyViolation(`refused: only SELECT / SHOW may be sent (got "${s.slice(0, 24).replace(/\s+/g, ' ')}")`)
}

// A connection wrapper: every query is gated, and `readOnly()` must succeed before the first schema read.
export class Gate {
  constructor(conn) { this.conn = conn; this.sent = [] }
  async query(sql) {
    const ok = assertReadOnlySql(sql)
    this.sent.push(ok)
    return this.conn.query(ok)
  }
  // SET SESSION TRANSACTION READ ONLY + START TRANSACTION READ ONLY, then @@tx_read_only must read 1.
  async readOnly() {
    await this.query('SET SESSION TRANSACTION READ ONLY')
    await this.query('START TRANSACTION READ ONLY')
    const r = await this.query('SELECT @@session.tx_read_only')
    /*M:tx-assert*/
    if (String(r.rows[0]?.[0]) !== '1') throw new ReadOnlyViolation('the session is not read-only; nothing was read')
    await this.query('SET SESSION max_statement_time = 60').catch(() => { /* MySQL rather than MariaDB */ })
    return true
  }
  async end() { try { await this.query('ROLLBACK') } catch { /* gone */ } this.conn.end() }
}

// ============================================================================ MySQL text protocol client
const CAP = { LONG_PASSWORD: 1, LONG_FLAG: 4, CONNECT_WITH_DB: 8, PROTOCOL_41: 0x200, TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000, MULTI_RESULTS: 0x20000, PLUGIN_AUTH: 0x80000 }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
function lenenc(b, pos) {
  const f = b[pos]
  if (f < 0xfb) return [f, pos + 1]
  if (f === 0xfc) return [b.readUInt16LE(pos + 1), pos + 3]
  if (f === 0xfd) return [b.readUIntLE(pos + 1, 3), pos + 4]
  return [Number(b.readBigUInt64LE(pos + 1)), pos + 9]
}
export class MySQL {
  constructor(opts) { this.o = opts; this.buf = Buffer.alloc(0); this.waiters = []; this.inbox = []; this.seq = 0 }
  connect() {
    return new Promise((resolveConn, rejectConn) => {
      this.sock = this.o.socket ? connect(this.o.socket) : connect(this.o.port, this.o.host)
      this.sock.setNoDelay?.(true)
      this.sock.setTimeout(120000, () => this.sock.destroy(new Error('timeout')))
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump() })
      this.sock.on('error', (e) => { const w = this.waiters.shift(); if (w) w.reject(e); else if (!this.ready) rejectConn(e) })
      this.sock.on('close', () => { for (const w of this.waiters.splice(0)) w.reject(new Error('connection closed')) })
      this.sock.once('connect', async () => {
        try { await this.handshake(); this.ready = true; resolveConn() } catch (e) { rejectConn(e) }
      })
    })
  }
  pump() {
    while (this.buf.length >= 4) {
      const len = this.buf.readUIntLE(0, 3)
      if (this.buf.length < 4 + len) return
      const seq = this.buf[3]
      const payload = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      if (len === 0xffffff) { this.partial = Buffer.concat([this.partial ?? Buffer.alloc(0), payload]); continue }
      const whole = this.partial ? Buffer.concat([this.partial, payload]) : Buffer.from(payload)
      this.partial = undefined
      this.seq = seq + 1
      const w = this.waiters.shift()
      if (w) w.resolve(whole); else this.inbox.push(whole)
    }
  }
  packet() {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift())
    return new Promise((res, rej) => { this.waiters.push({ resolve: res, reject: rej }); this.pump() })
  }
  send(payload, seq) {
    const h = Buffer.alloc(4); h.writeUIntLE(payload.length, 0, 3); h[3] = seq
    this.sock.write(Buffer.concat([h, payload]))
  }
  static scramble(password, salt) {
    if (!password) return Buffer.alloc(0)
    const sha = (b) => createHash('sha1').update(b).digest()
    const s1 = sha(Buffer.from(password, 'utf8')); const s2 = sha(s1)
    const s3 = sha(Buffer.concat([salt, s2]))
    return Buffer.from(s1.map((b, i) => b ^ s3[i]))
  }
  async handshake() {
    const p = await this.packet()
    if (p[0] === 0xff) throw new Error(`server refused the connection (${p.readUInt16LE(1)})`)
    if (p[0] !== 10) throw new Error(`unsupported protocol ${p[0]}`)
    let i = 1
    while (p[i] !== 0) i++
    this.serverVersion = p.subarray(1, i).toString()
    i++; i += 4
    const salt1 = p.subarray(i, i + 8); i += 8
    i++
    const capLow = p.readUInt16LE(i); i += 2
    i++; i += 2
    const capHigh = p.readUInt16LE(i); i += 2
    const serverCap = capLow | (capHigh << 16)
    const authLen = p[i]; i += 1
    i += 10
    const salt2Len = Math.max(13, authLen - 8)
    let salt2 = p.subarray(i, i + salt2Len); i += salt2Len
    if (salt2[salt2.length - 1] === 0) salt2 = salt2.subarray(0, salt2.length - 1)
    let plugin = 'mysql_native_password'
    if (serverCap & CAP.PLUGIN_AUTH) { let j = i; while (j < p.length && p[j] !== 0) j++; plugin = p.subarray(i, j).toString() }
    const salt = Buffer.concat([salt1, salt2]).subarray(0, 20)
    const caps = CAP.LONG_PASSWORD | CAP.LONG_FLAG | CAP.CONNECT_WITH_DB | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH
    if (plugin !== 'mysql_native_password') throw new Error(`auth plugin ${plugin} is not supported by this client (mysql_native_password only)`)
    const auth = MySQL.scramble(this.o.password, salt)
    this.send(Buffer.concat([
      u32(caps), u32(16 * 1024 * 1024), Buffer.from([45]), Buffer.alloc(23),
      Buffer.from(this.o.user + '\0'), Buffer.from([auth.length]), auth,
      Buffer.from(this.o.database + '\0'), Buffer.from('mysql_native_password\0'),
    ]), 1)
    let r = await this.packet()
    if (r[0] === 0xfe) {
      let j = 1; while (r[j] !== 0) j++
      if (r.subarray(1, j).toString() !== 'mysql_native_password') throw new Error('auth switch is not supported')
      this.send(MySQL.scramble(this.o.password, r.subarray(j + 1, j + 21)), this.seq)
      r = await this.packet()
    }
    if (r[0] === 0xff) throw new Error(`sign-in refused (${r.readUInt16LE(1)})`)
    if (r[0] !== 0x00) throw new Error('unexpected handshake reply')
  }
  async query(sql) {
    this.send(Buffer.concat([Buffer.from([3]), Buffer.from(sql, 'utf8')]), 0)
    const first = await this.packet()
    if (first[0] === 0xff) throw new Error(`SQL error ${first.readUInt16LE(1)}: ${first.subarray(9).toString().slice(0, 200)}`)
    if (first[0] === 0x00) return { columns: [], rows: [] }
    const [ncols] = lenenc(first, 0)
    const columns = []
    for (let c = 0; c < ncols; c++) {
      const def = await this.packet()
      let pos = 0, name = ''
      for (let f = 0; f < 5; f++) { const [l, n] = lenenc(def, pos); pos = n; name = def.subarray(pos, pos + l).toString(); pos += l }
      columns.push(name)
    }
    const eof = await this.packet()
    if (eof[0] !== 0xfe) throw new Error('expected EOF after column definitions')
    const rows = []
    for (;;) {
      const p = await this.packet()
      if (p[0] === 0xfe && p.length < 9) break
      if (p[0] === 0xff) throw new Error(`SQL error ${p.readUInt16LE(1)}: ${p.subarray(9).toString().slice(0, 200)}`)
      const row = []; let pos = 0
      for (let c = 0; c < ncols; c++) {
        if (p[pos] === 0xfb) { row.push(null); pos++; continue }
        const [l, n] = lenenc(p, pos); pos = n
        row.push(p.subarray(pos, pos + l).toString('utf8')); pos += l
      }
      rows.push(row)
    }
    return { columns, rows }
  }
  end() { try { this.sock.end() } catch { /* gone */ } }
}

// Credentials: resolved, used, never printed. Same sources and order as db-url-scan.mjs.
const readTrim = (p) => readFileSync(p, 'utf8').replace(/\r?\n$/, '')
function phpConfig(file) {
  const src = readFileSync(file, 'utf8')
  const get = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`))
    return m ? (m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1') : undefined
  }
  const getFile = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:trim\\()?\\s*(?:@)?file_get_contents\\(\\s*'([^']+)'`))
    return m ? readTrim(m[1]) : undefined
  }
  const v = {}
  for (const k of ['db_host', 'db_name', 'db_user', 'db_pass']) v[k] = get(k) ?? getFile(k)
  return v
}
const envOrFile = (name, env) => {
  if (env[name] !== undefined && env[name] !== '') return env[name]
  return env[`${name}_FILE`] ? readTrim(env[`${name}_FILE`]) : undefined
}
export function credentials(args, env = process.env) {
  const cfgFile = args.config ?? env.SPORTA_API_CONFIG_FILE
  let host, port, socket, user, password, database
  if (cfgFile) { const c = phpConfig(cfgFile); host = c.db_host; user = c.db_user; password = c.db_pass; database = c.db_name }
  host ??= envOrFile('DB_HOST', env); user ??= envOrFile('DB_USER', env)
  password ??= envOrFile('DB_PASSWORD', env) ?? envOrFile('DB_PASS', env)
  database ??= envOrFile('DB_NAME', env); socket = envOrFile('DB_SOCKET', env); port = envOrFile('DB_PORT', env)
  if (host && host.includes(';')) {
    const [h, ...rest] = host.split(';'); host = h
    for (const kv of rest) { const [k, v] = kv.split('='); if (k === 'port') port ??= v; if (k === 'unix_socket') socket ??= v }
  }
  if (!user || !database) throw new Error('no credentials: need --config <php file>, SPORTA_API_CONFIG_FILE, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME')
  return { host: host || '127.0.0.1', port: Number(port || 3306), socket, user, password: password ?? '', database }
}
// An error message must never carry the password, whatever produced it.
export function scrub(message, secrets) {
  let m = String(message)
  /*M:scrub*/
  for (const s of secrets) if (s && s.length >= 3) m = m.split(s).join('***')
  return m
}

// ============================================================================ reading a schema
// The statements below are the ONLY ones the live mode sends besides the read-only setup. All are SELECTs on
// information_schema, restricted to the connected database. TABLE_ROWS is an engine estimate, used only to say
// whether an unknown table is empty; it is not row data.
export const SCHEMA_QUERIES = {
  version: 'SELECT VERSION(), @@character_set_database, @@collation_database',
  tables: 'SELECT table_name, table_type, engine, table_collation, table_rows FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
  columns: 'SELECT table_name, column_name, ordinal_position, column_type, is_nullable, column_default, character_set_name, collation_name, extra, generation_expression FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position',
  indexes: 'SELECT table_name, index_name, non_unique, seq_in_index, column_name, sub_part, index_type FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index',
  fks: 'SELECT k.table_name, k.constraint_name, k.ordinal_position, k.column_name, k.referenced_table_name, k.referenced_column_name, r.update_rule, r.delete_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name, k.ordinal_position',
  checks: 'SELECT table_name, constraint_name, level, check_clause FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() ORDER BY table_name, constraint_name',
  triggers: 'SELECT trigger_name, event_object_table, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY trigger_name',
  routines: 'SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = DATABASE() ORDER BY routine_name',
  events: 'SELECT event_name, status FROM information_schema.events WHERE event_schema = DATABASE() ORDER BY event_name',
}

const lc = (s) => (s == null ? s : String(s))
// The default MariaDB reports for a nullable column with no explicit default is the STRING 'NULL' (10.2.7+); for a
// NOT NULL column with none, SQL NULL. Both mean "no default": normalise to null.
export function normDefault(d) { return d == null || d === 'NULL' ? null : String(d) }
export const normCharset = (c) => (c === 'utf8' ? 'utf8mb3' : c)
export const normCollation = (c) => (c == null ? c : String(c).replace(/^utf8_/, 'utf8mb3_'))
// "int(10) unsigned" and "int(11) unsigned" are the same type: the display width stores and compares nothing.
export function normType(t) {
  return String(t).toLowerCase().replace(/\s+/g, ' ').replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, '$1').trim()
}

export async function readSchema(q) {
  const get = async (k) => (await q(SCHEMA_QUERIES[k])).rows
  const [ver] = await get('version')
  const out = { server: String(ver[0]), dbCharset: ver[1], dbCollation: ver[2], tables: {}, views: [], triggers: [], routines: [], events: [] }
  for (const [t, type, engine, coll, rows] of await get('tables')) {
    if (type === 'VIEW') { out.views.push(t); continue }
    if (type !== 'BASE TABLE' && type !== 'SYSTEM VERSIONED') continue
    out.tables[t] = { engine: lc(engine), collation: normCollation(coll), rows: rows == null ? null : Number(rows), columns: {}, order: [], indexes: {}, fks: {}, checks: {} }
  }
  for (const [t, c, pos, type, nul, def, cs, coll, extra, gen] of await get('columns')) {
    const T = out.tables[t]; if (!T) continue
    T.columns[c] = { pos: Number(pos), type: String(type), null: nul === 'YES', def: normDefault(def), cs: normCharset(cs), coll: normCollation(coll), extra: String(extra || '').toLowerCase(), gen: gen || null }
    T.order.push(c)
  }
  for (const [t, name, nonUnique, seq, col, sub, type] of await get('indexes')) {
    const T = out.tables[t]; if (!T) continue
    const ix = (T.indexes[name] ??= { unique: nonUnique === '0', type: String(type), cols: [] })
    ix.cols[Number(seq) - 1] = col + (sub ? `(${sub})` : '')
  }
  for (const [t, name, seq, col, rt, rc, upd, del] of await get('fks')) {
    const T = out.tables[t]; if (!T) continue
    const fk = (T.fks[name] ??= { cols: [], ref: rt, refcols: [], upd, del })
    fk.cols[Number(seq) - 1] = col; fk.refcols[Number(seq) - 1] = rc
  }
  for (const [t, name, level, clause] of await get('checks')) {
    const T = out.tables[t]; if (!T) continue
    T.checks[name] = { level: String(level), clause: String(clause) }
  }
  out.triggers = (await get('triggers')).map((r) => `${r[0]} (${r[2]} ${r[3]} on ${r[1]})`)
  out.routines = (await get('routines')).map((r) => `${r[0]} (${r[1]})`)
  out.events = (await get('events')).map((r) => `${r[0]} (${r[1]})`)
  return out
}

// ============================================================================ comparison helpers
export const normClause = (c) => String(c).toLowerCase().replace(/`/g, '').replace(/\s+/g, '').replace(/^\((.*)\)$/, '$1')
const literals = (c) => new Set([...String(c).matchAll(/'((?:[^'\\]|\\.|'')*)'/g)].map((m) => m[1]))
const INT_BYTES = { tinyint: 1, smallint: 2, mediumint: 3, int: 4, integer: 4, bigint: 8 }
const TEXT_CAP = { tinytext: 255, text: 65535, mediumtext: 16777215, longtext: 4294967295, tinyblob: 255, blob: 65535, mediumblob: 16777215, longblob: 4294967295 }
export function parseType(t) {
  const s = String(t).toLowerCase().trim()
  const m = /^([a-z]+)\s*(?:\(([^)]*)\))?\s*(unsigned)?/.exec(s)
  const base = m ? m[1] : s
  const arg = m && m[2] != null ? m[2] : null
  const o = { raw: s, base, unsigned: !!(m && m[3]) }
  if (base === 'enum' || base === 'set') o.values = [...literals(s)]
  if (base === 'decimal' || base === 'numeric' || base === 'dec') { const [p, sc] = (arg ?? '10,0').split(',').map(Number); o.p = p; o.s = sc || 0; o.base = 'decimal' }
  else if (['char', 'varchar', 'binary', 'varbinary'].includes(base)) o.len = Number(arg)
  if (base in INT_BYTES) o.base = base === 'integer' ? 'int' : base
  return o
}
const familyOf = (p) => (p.base in INT_BYTES || p.base === 'int' ? 'int' : p.base === 'decimal' ? 'decimal'
  : ['float', 'double', 'real'].includes(p.base) ? 'float' : ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'json'].includes(p.base) ? 'string'
  : ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'].includes(p.base) ? 'blob' : ['datetime', 'timestamp', 'date', 'time', 'year'].includes(p.base) ? 'temporal'
  : p.base === 'enum' ? 'enum' : p.base === 'set' ? 'set' : 'other')
const strCap = (p) => (p.len != null ? p.len : p.base === 'json' ? TEXT_CAP.longtext : TEXT_CAP[p.base] ?? null)

// How does the live type compare with the one the code was written for?
//   same · wider (live holds everything expected does) · narrower (it can lose or refuse data) · family (a different kind
//   of value) · other (differs, cannot be ranked).
export function typeRelation(expectedType, liveType) {
  const e = parseType(expectedType), l = parseType(liveType)
  if (normType(expectedType) === normType(liveType)) return { rel: 'same' }
  const fe = familyOf(e), fl = familyOf(l)
  // json is longtext in MariaDB: the same column, the same family.
  if (fe !== fl) {
    // a plain string column where an enum was expected holds every value the enum does
    if (fe === 'enum' && fl === 'string') return { rel: 'wider', note: 'varchar/text where an enum was expected' }
    return { rel: 'family', note: `${fl} where ${fe} was expected` }
  }
  if (fe === 'int') {
    const ranges = (p) => { const bits = BigInt(INT_BYTES[p.base] * 8); return p.unsigned ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] }
    const [emin, emax] = ranges(e), [lmin, lmax] = ranges(l)
    if (lmin <= emin && lmax >= emax) return { rel: 'wider' }
    if (!l.unsigned && e.unsigned && INT_BYTES[l.base] >= INT_BYTES[e.base]) return { rel: 'narrower', note: 'signed where unsigned is expected: the top half of the range overflows' }
    return { rel: 'narrower', note: 'smaller integer: large values overflow' }
  }
  if (fe === 'decimal') {
    if (l.s < e.s) return { rel: 'narrower', note: `${e.s - l.s} fewer decimal place(s): amounts are rounded` }
    if (l.p - l.s < e.p - e.s) return { rel: 'narrower', note: 'fewer digits before the point: large amounts overflow' }
    return { rel: 'wider' }
  }
  if (fe === 'string') {
    const ce = strCap(e), cl = strCap(l)
    if (ce != null && cl != null) return cl < ce ? { rel: 'narrower', note: `holds ${cl} characters, ${ce} expected: longer values are refused or cut` } : { rel: 'wider' }
    return { rel: 'other' }
  }
  if (fe === 'blob') { const ce = strCap(e), cl = strCap(l); return ce != null && cl != null && cl < ce ? { rel: 'narrower', note: 'smaller binary type' } : { rel: 'wider' } }
  if (fe === 'enum' || fe === 'set') {
    const missing = e.values.filter((v) => !l.values.includes(v))
    return missing.length ? { rel: 'narrower', note: `live ${fe} lacks ${missing.map((v) => `'${v}'`).join(', ')}` } : { rel: 'wider' }
  }
  return { rel: 'other' }
}

const NON_UNICODE = /^(latin1|latin2|ascii|cp\d+|binary|swe7|greek|hebrew|koi8|armscii8|dec8|hp8|tis620|macroman|geostd8|big5|gbk|sjis|ujis|euckr)/i

// ============================================================================ the diff
const SEV = { error: 0, warning: 1, info: 2 }
const KIND_ORDER = ['table_missing', 'column_missing', 'index_missing', 'check_missing', 'check_changed', 'fk_missing', 'engine', 'column_type', 'column_nullable', 'column_default', 'column_charset', 'column_collation', 'column_extra', 'table_collation', 'index_changed', 'fk_changed', 'index_renamed', 'column_extra_live', 'index_extra', 'fk_extra', 'check_extra', 'table_extra', 'object_extra']
const sevOfNeeds = { code: 'error', guarded: 'warning', integrity: 'warning', drift: 'warning', extra: 'info', cosmetic: 'info' }

// Which expected file(s) create an object, dedicated migrations first, then the schema file, then the one-file install.
export function providersOf(expected, key) {
  const out = []
  for (const [f, keys] of Object.entries(expected.provides ?? {})) if (keys.includes(key)) out.push(f)
  const rank = (f) => (f === 'install.mysql.sql' ? 3 : f === 'schema.mysql.sql' ? 2 : f === 'seed.mysql.sql' ? 2 : 0)
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
const dedicated = (f) => !['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql'].includes(f)

// How the code treats a column or table that is not there. `refs` are the PHP files that use it, `guards` the subset
// that asks first (store_column_exists, SHOW COLUMNS, *_table_exists, a 1054 / 1146 handler).
export function codeNeed(expected, kind, table, column) {
  const c = expected.code ?? { tables: {}, columns: {} }
  const rec = kind === 'table' ? c.tables?.[table] : c.columns?.[`${table}.${column}`]
  if (!rec || !rec[0]?.length) return { needs: 'cosmetic', refs: [], unguarded: [] }
  const unguarded = rec[0].filter((f) => !rec[1].includes(f))
  /*M:guard*/
  return unguarded.length ? { needs: 'code', refs: rec[0], unguarded } : { needs: 'guarded', refs: rec[0], unguarded }
}

// Classify a live table the repository does not define.
export function classifyExtraTable(name, expected) {
  const fam = expected.families ?? {}
  if (fam.planned?.[name]) return { family: 'planned', note: `created by ${fam.planned[name]} (not part of the install yet)` }
  if (fam.old_build?.[name] !== undefined) return { family: 'old-build', note: fam.old_build[name] ? `old-build table; PHP in this repo that mentions it: ${fam.old_build[name]}` : 'old-build table (present in the 2026-11-01 production dump); no PHP in this repo mentions it. DATA-SCAN-2026-11-02 section 7: do not drop' }
  if (/^oc_/i.test(name)) return { family: 'opencart', note: 'OpenCart leftover (the shop before this one). May hold customer data: see the data-protection plan; not read by this code' }
  if (/^(wp_|wc_|woocommerce_)/i.test(name)) return { family: 'wordpress', note: 'WordPress / WooCommerce leftover' }
  if (/^(ps_|psm_)/i.test(name)) return { family: 'prestashop', note: 'PrestaShop leftover' }
  if (/^(jobs|failed_jobs|migrations|password_resets|personal_access_tokens|sessions|cache|cache_locks)$/i.test(name)) return { family: 'framework', note: 'framework table (Laravel-style) left behind' }
  if (/(_legacy_\d+|_(bak|backup|old|copy|tmp|temp)(_\d+)?|_\d{8}(T?\d*)?)$/i.test(name) || /^(bak|backup|old|tmp|temp)_/i.test(name)) return { family: 'backup-copy', note: 'looks like a dated copy or backup; nothing in this code reads it' }
  return { family: 'unknown', note: 'not defined by this repository and not recognised: find out what created it before deleting anything' }
}

export function diffSchemas(expected, live, opts = {}) {
  const items = []
  const add = (it) => { it.severity = sevOfNeeds[it.needs]; items.push(it) }
  const ET = expected.tables, LT = live.tables
  const skip = new Set(opts.skip ?? [])

  // ---- tables
  for (const t of Object.keys(ET)) {
    if (!LT[t]) {
      /*M:table-missing*/
      const n = codeNeed(expected, 'table', t)
      const key = `table:${t}`
      add({ kind: 'table_missing', table: t, name: null, needs: n.needs, expected: `table (${Object.keys(ET[t].columns).length} columns)`, live: 'absent',
        reason: n.needs === 'code' ? `used by ${n.unguarded.slice(0, 4).join(', ')} without a check` : n.needs === 'guarded' ? `used by ${n.refs.slice(0, 4).join(', ')}, which ask first` : 'no PHP in the repo uses it',
        key, explained_by: providersOf(expected, key) })
    }
  }
  for (const t of Object.keys(LT)) {
    if (!ET[t]) {
      /*M:table-extra*/
      const c = classifyExtraTable(t, expected)
      add({ kind: 'table_extra', table: t, name: null, needs: 'extra', expected: 'not defined', live: `table${LT[t].rows != null ? ` (about ${LT[t].rows} rows)` : ''}`, reason: c.note, family: c.family, key: `table:${t}`, explained_by: [] })
    }
  }

  // ---- inside the tables both have
  for (const t of Object.keys(ET)) {
    const e = ET[t], l = LT[t]
    if (!l) continue
    /*M:engine*/
    if (!skip.has('engine') && e.engine && l.engine && e.engine.toLowerCase() !== l.engine.toLowerCase()) {
      const tx = e.engine.toLowerCase() === 'innodb'
      add({ kind: 'engine', table: t, name: null, needs: tx ? 'code' : 'drift', expected: e.engine, live: l.engine,
        reason: tx ? 'orders, stock claims and refunds rely on transactions and foreign keys; this engine has neither' : 'engine differs', key: `table:${t}`, explained_by: providersOf(expected, `table:${t}`) })
    }
    if (!skip.has('engine') && e.collation && l.collation && e.collation !== l.collation) {
      add({ kind: 'table_collation', table: t, name: null, needs: 'drift', expected: e.collation, live: l.collation, reason: 'new columns inherit this; a join across different collations can fail with "Illegal mix of collations"', key: `table:${t}`, explained_by: [] })
    }

    // columns
    for (const c of Object.keys(e.columns)) {
      const ec = e.columns[c], lcol = l.columns[c]
      const key = `column:${t}.${c}`
      if (!lcol) {
        /*M:col-missing*/
        const n = codeNeed(expected, 'column', t, c)
        add({ kind: 'column_missing', table: t, name: c, needs: n.needs, expected: ec.type + (ec.null ? ' null' : ' not null'), live: 'absent',
          reason: n.needs === 'code' ? `used by ${n.unguarded.slice(0, 4).join(', ')} without a check` : n.needs === 'guarded' ? `used by ${n.refs.slice(0, 4).join(', ')}, which ask first` : 'no PHP in the repo uses it',
          key, explained_by: providersOf(expected, key) })
        continue
      }
      /*M:col-type*/
      if (!skip.has('types')) {
        const r = typeRelation(ec.type, lcol.type)
        if (r.rel === 'narrower' || r.rel === 'family') {
          const money = /decimal/i.test(ec.type) && /decimal|float|double|int/i.test(lcol.type)
          add({ kind: 'column_type', table: t, name: c, needs: 'code', expected: ec.type, live: lcol.type, reason: `${r.note ?? r.rel}${money ? ' (money column)' : ''}`, key, explained_by: providersOf(expected, key) })
        } else if (r.rel === 'wider') {
          /*M:col-wider*/
          add({ kind: 'column_type', table: t, name: c, needs: 'cosmetic', expected: ec.type, live: lcol.type, reason: 'live holds at least everything expected: harmless', key, explained_by: [] })
        } else if (r.rel === 'other') {
          add({ kind: 'column_type', table: t, name: c, needs: 'drift', expected: ec.type, live: lcol.type, reason: 'different type that cannot be ranked: check by hand', key, explained_by: providersOf(expected, key) })
        }
      }
      /*M:col-null*/
      if (!skip.has('nullable') && ec.null !== lcol.null) {
        const bad = ec.null && !lcol.null
        add({ kind: 'column_nullable', table: t, name: c, needs: bad ? 'code' : 'drift', expected: ec.null ? 'null' : 'not null', live: lcol.null ? 'null' : 'not null',
          reason: bad ? 'the code stores NULL here; the live column refuses it' : 'live is looser than the repo', key, explained_by: [] })
      }
      /*M:col-default*/
      if (!skip.has('defaults') && ec.def !== lcol.def && !(ec.extra.includes('auto_increment') || lcol.extra.includes('auto_increment'))) {
        const bad = ec.def != null && lcol.def == null && !lcol.null
        add({ kind: 'column_default', table: t, name: c, needs: bad ? 'code' : 'drift', expected: ec.def ?? 'none', live: lcol.def ?? 'none',
          reason: bad ? 'an INSERT that leaves this column out fails under STRICT mode (error 1364)' : 'a different default changes what an omitted value means', key, explained_by: [] })
      }
      /*M:col-charset*/
      if (!skip.has('charset') && (ec.cs || lcol.cs)) {
        if (ec.cs !== lcol.cs) {
          const bad = lcol.cs && NON_UNICODE.test(lcol.cs)
          add({ kind: 'column_charset', table: t, name: c, needs: bad ? 'code' : 'drift', expected: ec.cs ?? 'none', live: lcol.cs ?? 'none',
            reason: bad ? 'Arabic text cannot be stored in this character set: it becomes "?" or is refused' : lcol.cs === 'utf8mb3' ? 'no 4-byte characters (emoji) in names and notes' : 'character set differs', key, explained_by: [] })
        } else if (ec.coll !== lcol.coll) {
          /*M:col-coll*/
          add({ kind: 'column_collation', table: t, name: c, needs: 'drift', expected: ec.coll, live: lcol.coll, reason: 'sorting and comparison differ; a join with a column of another collation can fail with "Illegal mix of collations"', key, explained_by: [] })
        }
      }
      if (!skip.has('extra') && ec.extra !== lcol.extra) {
        const lostAuto = ec.extra.includes('auto_increment') && !lcol.extra.includes('auto_increment')
        add({ kind: 'column_extra', table: t, name: c, needs: lostAuto ? 'code' : 'drift', expected: ec.extra || 'none', live: lcol.extra || 'none',
          reason: lostAuto ? 'an INSERT without an id fails' : 'attribute differs (on update / generated)', key, explained_by: [] })
      }
    }
    for (const c of Object.keys(l.columns)) {
      if (!e.columns[c]) {
        /*M:col-extra*/
        const k = `column:${t}.${c}`
        const known = expected.known_extra?.[k]
        add({ kind: 'column_extra_live', table: t, name: c, needs: 'extra', expected: 'not defined', live: l.columns[c].type, reason: known ? `created by ${known} (not part of the install)` : 'not defined by this repository', key: k, explained_by: [] })
      }
    }

    // indexes
    if (!skip.has('indexes')) {
      const sig = (ix) => `${ix.unique ? 'U' : 'N'}:${ix.cols.join(',')}`
      const liveBySig = new Map(Object.entries(l.indexes).map(([n, ix]) => [sig(ix), n]))
      const expectedSigs = new Set(Object.values(e.indexes).map(sig))
      for (const [n, ix] of Object.entries(e.indexes)) {
        const key = `index:${t}.${n}`
        const li = l.indexes[n]
        if (!li) {
          const alias = liveBySig.get(sig(ix))
          if (alias) { add({ kind: 'index_renamed', table: t, name: n, needs: 'cosmetic', expected: `${n} (${ix.cols.join(', ')})`, live: `${alias} (same columns)`, reason: 'same key under another name: harmless', key, explained_by: [] }); continue }
          /*M:idx-missing*/
          const crit = ix.unique
          add({ kind: 'index_missing', table: t, name: n, needs: crit ? 'code' : 'integrity', expected: `${n === 'PRIMARY' ? 'PRIMARY KEY' : ix.unique ? 'UNIQUE' : 'INDEX'} (${ix.cols.join(', ')})`, live: 'absent',
            reason: crit ? 'a uniqueness rule the code relies on (INSERT IGNORE / ON DUPLICATE KEY / duplicate-order checks): duplicates are accepted without it' : 'slower queries as the table grows; nothing fails', key, explained_by: providersOf(expected, key) })
        } else if (sig(ix) !== sig(li)) {
          /*M:idx-changed*/
          add({ kind: 'index_changed', table: t, name: n, needs: ix.unique !== li.unique ? 'code' : 'integrity', expected: sig(ix).slice(2), live: sig(li).slice(2), reason: ix.unique !== li.unique ? 'uniqueness differs' : 'different columns', key, explained_by: providersOf(expected, key) })
        }
      }
      for (const [n, ix] of Object.entries(l.indexes)) {
        if (e.indexes[n] || expectedSigs.has(sig(ix))) continue
        /*M:idx-extra*/
        const k = `index:${t}.${n}`
        add({ kind: 'index_extra', table: t, name: n, needs: ix.unique ? 'drift' : 'extra', expected: 'not defined', live: `${ix.unique ? 'UNIQUE' : 'INDEX'} (${ix.cols.join(', ')})`,
          reason: expected.known_extra?.[k] ? `created by ${expected.known_extra[k]}` : ix.unique ? 'an unknown uniqueness rule can refuse inserts the code expects to succeed' : 'not defined by this repository', key: k, explained_by: [] })
      }
    }

    // foreign keys
    if (!skip.has('fks')) {
      const fsig = (f) => `${f.cols.join(',')}->${f.ref}(${f.refcols.join(',')}) ${f.upd}/${f.del}`
      const fsigNoRule = (f) => `${f.cols.join(',')}->${f.ref}(${f.refcols.join(',')})`
      const liveFk = Object.entries(l.fks)
      for (const [n, f] of Object.entries(e.fks)) {
        const key = `fk:${t}.${n}`
        const lf = l.fks[n] ?? liveFk.find(([, x]) => fsigNoRule(x) === fsigNoRule(f))?.[1]
        if (!lf) {
          /*M:fk-missing*/
          add({ kind: 'fk_missing', table: t, name: n, needs: 'integrity', expected: fsig(f), live: 'absent', reason: 'rows can be orphaned and deletes do not cascade; the code still runs', key, explained_by: providersOf(expected, key) })
        } else if (fsig(lf) !== fsig(f)) {
          add({ kind: 'fk_changed', table: t, name: n, needs: 'integrity', expected: fsig(f), live: fsig(lf), reason: 'ON UPDATE / ON DELETE rule differs: deletes may cascade differently', key, explained_by: providersOf(expected, key) })
        }
      }
      for (const [n, f] of liveFk) {
        if (e.fks[n] || Object.values(e.fks).some((x) => fsigNoRule(x) === fsigNoRule(f))) continue
        add({ kind: 'fk_extra', table: t, name: n, needs: 'extra', expected: 'not defined', live: fsig(f), reason: 'a foreign key this repository does not define can block deletes', key: `fk:${t}.${n}`, explained_by: [] })
      }
    }

    // CHECK constraints
    if (!skip.has('checks')) {
      const liveChecks = Object.entries(l.checks)
      for (const [n, ck] of Object.entries(e.checks)) {
        const key = `check:${t}.${n}`
        const lk = l.checks[n] ?? liveChecks.find(([, x]) => normClause(x.clause) === normClause(ck.clause))?.[1]
        if (!lk) {
          /*M:check-missing*/
          add({ kind: 'check_missing', table: t, name: n, needs: 'integrity', expected: ck.clause, live: 'absent', reason: 'the database no longer refuses bad values here; the PHP still validates', key, explained_by: providersOf(expected, key) })
        } else if (normClause(lk.clause) !== normClause(ck.clause)) {
          /*M:check-changed*/
          const el = literals(ck.clause), ll = literals(lk.clause)
          const lacks = [...el].filter((v) => !ll.has(v))
          add({ kind: 'check_changed', table: t, name: n, needs: lacks.length ? 'code' : 'integrity', expected: ck.clause, live: lk.clause,
            reason: lacks.length ? `the live rule refuses ${lacks.map((v) => `'${v}'`).join(', ')}, which the code writes` : 'the rule differs', key, explained_by: providersOf(expected, key) })
        }
      }
      for (const [n, ck] of liveChecks) {
        if (e.checks[n] || Object.values(e.checks).some((x) => normClause(x.clause) === normClause(ck.clause))) continue
        add({ kind: 'check_extra', table: t, name: n, needs: 'extra', expected: 'not defined', live: ck.clause, reason: 'a rule this repository does not define can refuse inserts', key: `check:${t}.${n}`, explained_by: [] })
      }
    }
  }

  // ---- other objects
  for (const [list, what] of [[live.triggers, 'trigger'], [live.routines, 'routine'], [live.events, 'event'], [live.views, 'view']]) {
    for (const o of list ?? []) add({ kind: 'object_extra', table: '-', name: o, needs: 'extra', expected: 'none', live: what, reason: `${what}s run or answer outside the PHP: find out who created it`, key: `${what}:${o}`, explained_by: [] })
  }

  // ---- order, stable
  const ko = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i }
  items.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.table.localeCompare(b.table) || ko(a.kind) - ko(b.kind) || String(a.name).localeCompare(String(b.name)))
  for (const it of items) { it.id = `${it.kind}:${it.table}${it.name ? '.' + it.name : ''}`; it.explained_by = [...new Set(it.explained_by ?? [])] }

  return { items, migrations: migrationStatus(expected, live, items), summary: summarise(items, live, expected) }
}

function summarise(items, live, expected) {
  const by = (s) => items.filter((i) => i.severity === s).length
  return {
    errors: by('error'), warnings: by('warning'), info: by('info'),
    expected_tables: Object.keys(expected.tables).length, live_tables: Object.keys(live.tables).length,
    expected_columns: Object.values(expected.tables).reduce((n, t) => n + Object.keys(t.columns).length, 0),
    live_columns: Object.values(live.tables).reduce((n, t) => n + Object.keys(t.columns).length, 0),
    by_needs: Object.fromEntries(['code', 'guarded', 'integrity', 'drift', 'extra', 'cosmetic'].map((n) => [n, items.filter((i) => i.needs === n).length])),
  }
}

// ---- migrations: which files are applied, partly applied or not
export function keyPresent(live, key) {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'table') return !!live.tables[rest]
  const dot = rest.indexOf('.')
  const t = rest.slice(0, dot), n = rest.slice(dot + 1)
  const T = live.tables[t]
  if (!T) return false
  if (kind === 'column') return !!T.columns[n]
  if (kind === 'index') return !!T.indexes[n]
  if (kind === 'fk') return !!T.fks[n]
  if (kind === 'check') return !!T.checks[n]
  return false
}
export function migrationStatus(expected, live, items) {
  // an object that exists but was found wrong for the code (narrow type, stale CHECK list, changed key) does not count as applied
  const ATTR = new Set(['column_type', 'column_nullable', 'column_default', 'column_charset', 'column_collation', 'column_extra', 'check_changed', 'index_changed', 'fk_changed'])
  const bad = new Set(items.filter((i) => ATTR.has(i.kind) && i.needs === 'code').map((i) => i.key))
  const needKeys = new Set(items.filter((i) => i.needs === 'code').map((i) => i.key))
  const files = Object.keys(expected.provides ?? {})
  const out = []
  for (const f of files) {
    const keys = expected.provides[f]
    // a renamed-but-equivalent index or constraint counts as present
    const renamed = new Set(items.filter((i) => i.kind === 'index_renamed').map((i) => i.key))
    const present = keys.filter((k) => (keyPresent(live, k) || renamed.has(k)) && !bad.has(k))
    const missingCode = keys.filter((k) => needKeys.has(k)).length
    const status = keys.length === 0 ? 'noop' : present.length === keys.length ? 'applied' : present.length === 0 ? 'not applied' : 'partly applied'
    out.push({ file: f, status, present: present.length, total: keys.length, missing_code_needed: missingCode, kind: dedicated(f) ? 'migration' : 'bundle' })
  }
  return out.sort((a, b) => (a.kind === b.kind ? expected.order.indexOf(a.file) - expected.order.indexOf(b.file) : a.kind === 'migration' ? -1 : 1))
}

// The smallest list of dedicated migrations that supplies every missing object the code needs, in repository order.
export function migrationsToApply(expected, items) {
  const need = items.filter((i) => i.needs === 'code' && i.explained_by.length)
  const open = new Set(need.map((i) => i.id))
  const chosen = []
  while (open.size) {
    const count = new Map()
    for (const i of need) if (open.has(i.id)) for (const f of i.explained_by) if (dedicated(f)) count.set(f, (count.get(f) ?? 0) + 1)
    if (!count.size) break
    const [best] = [...count.entries()].sort((a, b) => b[1] - a[1] || expected.order.indexOf(a[0]) - expected.order.indexOf(b[0]))[0]
    chosen.push(best)
    for (const i of need) if (i.explained_by.includes(best)) open.delete(i.id)
  }
  const unexplained = need.filter((i) => open.has(i.id)).map((i) => i.id)
  return { files: chosen.sort((a, b) => expected.order.indexOf(a) - expected.order.indexOf(b)), unexplained }
}

export function exitCodeFor(result, { strict = false } = {}) {
  /*M:exit*/
  if (result.summary.errors > 0) return 1
  if (strict && result.summary.warnings > 0) return 1
  return 0
}

// ============================================================================ rendering
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const short = (s, n = 110) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }
export function renderMarkdown(expected, live, result, meta = {}) {
  const s = result.summary
  const L = []
  const verdict = s.errors ? `FAIL: ${s.errors} problem(s) the code needs` : s.warnings ? `PASS with ${s.warnings} warning(s)` : 'PASS'
  L.push(`# Live schema diff: ${meta.database ?? 'database'}`)
  L.push('')
  L.push(`**${verdict}**`)
  L.push('')
  L.push(`- live server: ${live.server}; default collation ${live.dbCollation}; ${s.live_tables} tables, ${s.live_columns} columns`)
  L.push(`- expected: ${s.expected_tables} tables, ${s.expected_columns} columns, from ${Object.keys(expected.files ?? {}).length} SQL files (snapshot ${meta.snapshotId ?? '?'})`)
  L.push(`- findings: ${s.errors} error, ${s.warnings} warning, ${s.info} note; by cause: ${Object.entries(s.by_needs).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  L.push(`- read-only: the session was READ ONLY (asserted), ${meta.statements ?? '?'} SELECT/SHOW statements sent, no row data read`)
  L.push('')
  const apply = migrationsToApply(expected, result.items)
  L.push('## What to apply')
  L.push('')
  if (apply.files.length) {
    L.push('Dedicated migrations that supply what the code needs and is missing, in repository order. Each is additive and safe to run twice:')
    L.push('')
    apply.files.forEach((f, i) => L.push(`${i + 1}. \`${f}\``))
    L.push('')
    L.push('Do NOT re-import `install.mysql.sql` on a shop that has taken orders to catch up: it re-runs `seed.mysql.sql` and `brands.mysql.sql`, which put the seed prices, names, categories and active flags back (scripts/db-schema-live-diff-test.mjs proves it). Run the single migration file instead.')
  } else L.push('Nothing the code needs is missing.')
  if (apply.unexplained.length) { L.push(''); L.push(`Missing but not created by any dedicated migration (schema.mysql.sql / install.mysql.sql create them): ${apply.unexplained.join(', ')}`) }
  L.push('')
  L.push('## Migrations')
  L.push('')
  L.push('| file | status | objects present | code-needed missing |')
  L.push('|---|---|---|---|')
  for (const m of result.migrations) L.push(`| ${m.file}${m.kind === 'bundle' ? ' (bundle)' : ''} | ${m.status} | ${m.present}/${m.total} | ${m.missing_code_needed} |`)
  const section = (title, filter, cols) => {
    const rows = result.items.filter(filter)
    if (!rows.length) return
    L.push(''); L.push(`## ${title} (${rows.length})`); L.push('')
    L.push('| where | expected | live | why | created by |'); L.push('|---|---|---|---|---|')
    for (const i of rows) L.push(`| ${esc(i.kind.replace(/_/g, ' '))} \`${esc(i.table === '-' ? i.name : i.table + (i.name ? '.' + i.name : ''))}\` | ${esc(short(i.expected))} | ${esc(short(i.live))} | ${esc(short(i.reason, 160))} | ${esc(i.explained_by.join(', ') || '-')} |`)
  }
  section('Problems the code needs (exit 1)', (i) => i.severity === 'error')
  section('Warnings', (i) => i.severity === 'warning')
  const extras = result.items.filter((i) => i.severity === 'info')
  if (extras.length) {
    L.push(''); L.push(`## Notes (${extras.length})`); L.push('')
    const t = extras.filter((i) => i.kind === 'table_extra')
    if (t.length) {
      L.push('Tables the repository does not define, by family:'); L.push('')
      L.push('| table | family | live | note |'); L.push('|---|---|---|---|')
      for (const i of t) L.push(`| \`${i.table}\` | ${i.family} | ${esc(i.live)} | ${esc(short(i.reason, 170))} |`)
      L.push('')
    }
    const o = extras.filter((i) => i.kind !== 'table_extra')
    if (o.length) {
      L.push('| where | expected | live | why |'); L.push('|---|---|---|---|')
      for (const i of o) L.push(`| ${esc(i.kind.replace(/_/g, ' '))} \`${esc(i.table === '-' ? i.name : i.table + (i.name ? '.' + i.name : ''))}\` | ${esc(short(i.expected))} | ${esc(short(i.live))} | ${esc(short(i.reason, 140))} |`)
    }
  }
  L.push('')
  return L.join('\n')
}
export function renderJson(expected, live, result, meta = {}) {
  return JSON.stringify({ tool: 'db-schema-live-diff', database: meta.database ?? null, server: live.server, snapshot: meta.snapshotId ?? null,
    verdict: result.summary.errors ? 'fail' : 'pass', summary: result.summary, apply: migrationsToApply(expected, result.items),
    migrations: result.migrations, findings: result.items }, null, 2) + '\n'
}

// ============================================================================ SQL text: statements and migrations
// Split a file into statements without being fooled by ; or -- inside a quoted string or a comment.
export function splitStatements(sql) {
  const out = []
  let cur = '', i = 0, line = 1, startLine = 1
  const n = sql.length
  const push = () => { const t = cur.trim(); if (t) out.push({ text: t, line: startLine }); cur = '' }
  while (i < n) {
    const ch = sql[i], nx = sql[i + 1]
    if (cur.trim() === '' && !/\s/.test(ch)) startLine = line
    if (ch === '\n') line++
    if (ch === '-' && nx === '-' && (sql[i + 2] === ' ' || sql[i + 2] === '\n' || sql[i + 2] === '\t' || i + 2 >= n)) { while (i < n && sql[i] !== '\n') i++; continue }
    if (ch === '#') { while (i < n && sql[i] !== '\n') i++; continue }
    if (ch === '/' && nx === '*') { const e = sql.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; line += (sql.slice(i, end).match(/\n/g) ?? []).length; i = end; cur += ' '; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n) { if (sql[j] === '\\' && ch !== '`') { j += 2; continue } if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue } break } j++ }
      cur += sql.slice(i, j + 1); line += (sql.slice(i, j + 1).match(/\n/g) ?? []).length; i = j + 1; continue
    }
    if (ch === ';') { push(); i++; continue }
    cur += ch; i++
  }
  push()
  return out
}
// Split on commas that are not inside parentheses or quotes.
export function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { cur += c; if (c === '\\') { cur += s[++i] ?? '' } else if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const stripQuotes = (s) => s.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"/g, "''")
const ident = '`?([A-Za-z_][A-Za-z0-9_$]*)`?'

// Parse one statement into what it does. Only the shapes this project writes are understood; anything else is `other`.
export function parseStatement(stmt) {
  const text = squash(stmt.text)
  const low = text.toLowerCase()
  let m
  if ((m = new RegExp(`^create\\s+(?:temporary\\s+)?table\\s+(if\\s+not\\s+exists\\s+)?${ident}`, 'i').exec(text))) return { ...stmt, op: 'create_table', table: m[2], ifNotExists: !!m[1], raw: text }
  if ((m = new RegExp(`^create\\s+(unique\\s+|fulltext\\s+)?index\\s+(if\\s+not\\s+exists\\s+)?${ident}\\s+on\\s+${ident}`, 'i').exec(text))) return { ...stmt, op: 'create_index', unique: !!m[1] && /unique/i.test(m[1]), name: m[3], table: m[4], ifNotExists: !!m[2], raw: text }
  if ((m = new RegExp(`^alter\\s+(?:ignore\\s+)?table\\s+(if\\s+exists\\s+)?${ident}\\s+(.*)$`, 'is').exec(text))) {
    const table = m[2]
    const clauses = splitTop(m[3]).map((c) => parseAlterClause(c))
    return { ...stmt, op: 'alter_table', table, clauses, raw: text }
  }
  if (/^drop\s+(table|database|schema|index|view|trigger|procedure|function|event)\b/i.test(text)) return { ...stmt, op: 'drop', raw: text }
  if (/^truncate\b/i.test(text)) return { ...stmt, op: 'truncate', raw: text }
  if (/^rename\s+table\b/i.test(text)) return { ...stmt, op: 'rename_table', raw: text }
  if (/^delete\b/i.test(text)) return { ...stmt, op: 'delete', hasWhere: /\bwhere\b/i.test(stripQuotes(text)), raw: text }
  if (/^update\b/i.test(text)) return { ...stmt, op: 'update', hasWhere: /\bwhere\b/i.test(stripQuotes(text)), table: (new RegExp(`^update\\s+(?:ignore\\s+)?${ident}`, 'i').exec(text) ?? [])[1], raw: text }
  if (/^replace\b/i.test(text)) return { ...stmt, op: 'replace', raw: text }
  if ((m = new RegExp(`^insert\\s+(ignore\\s+)?into\\s+${ident}`, 'i').exec(text))) {
    const dup = /\bon\s+duplicate\s+key\s+update\b/i.exec(stripQuotes(text))
    let assigns = []
    if (dup) {
      const tail = text.slice(text.toLowerCase().lastIndexOf('on duplicate key update') + 'on duplicate key update'.length)
      assigns = splitTop(tail).map((a) => { const am = /^`?(\w+)`?\s*=\s*(.+)$/.exec(a.trim()); return am ? { col: am[1], expr: am[2].trim() } : null }).filter(Boolean)
    }
    return { ...stmt, op: 'insert', table: m[2], ignore: !!m[1], onDuplicate: !!dup, assigns, raw: text }
  }
  if (/^(set|use|delimiter|lock|unlock|start|commit|rollback|begin)\b/i.test(text)) return { ...stmt, op: low.split(' ')[0], raw: text }
  if (/^(create\s+(?:or\s+replace\s+)?(?:definer\s*=\s*\S+\s+)?(?:procedure|function|trigger|event|view))/i.test(text)) return { ...stmt, op: 'create_routine', raw: text }
  return { ...stmt, op: 'other', raw: text }
}
function parseAlterClause(c) {
  const t = squash(c)
  let m
  if ((m = new RegExp(`^add\\s+(unique\\s+|fulltext\\s+|spatial\\s+)?(?:key|index)\\s+(if\\s+not\\s+exists\\s+)?${ident}?\\s*\\(`, 'i').exec(t)))
    return { type: 'add_index', unique: /unique/i.test(m[1] ?? ''), name: m[3] ?? null, ifNotExists: !!m[2], text: t }
  if ((m = new RegExp(`^add\\s+(?:constraint\\s+(?:if\\s+not\\s+exists\\s+)?${ident}\\s+)?(unique(?:\\s+(?:key|index))?|primary\\s+key|foreign\\s+key|check)\\b`, 'i').exec(t)))
    return { type: 'add_constraint', name: m[1] ?? null, ctype: /^unique/i.test(m[2]) ? 'unique' : m[2].toLowerCase().replace(/\s+/g, ' '), ifNotExists: /if\s+not\s+exists/i.test(t.slice(0, 60)), text: t }
  // a keyword used as a column name is only a column when it is quoted
  if ((m = new RegExp(`^add\\s+(?:column\\s+)?(if\\s+not\\s+exists\\s+)?${ident}\\s+(.+)$`, 'i').exec(t)) && (/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?`/i.test(t) || !/^(constraint|primary|unique|key|index|foreign|check|fulltext|spatial|period|system)$/i.test(m[2]))) {
    const unique = /(^|[\s)])unique(?!\s*\()/i.test(stripQuotes(m[3])) && !/unique\s+key\s*\(/i.test(m[3])
    return { type: 'add_column', column: m[2], ifNotExists: !!m[1], unique, after: (/\bafter\s+`?(\w+)`?/i.exec(m[3]) ?? [])[1] ?? null, text: t }
  }
  if ((m = new RegExp(`^drop\\s+(constraint|check|foreign\\s+key|primary\\s+key|index|key|column|period)\\s*(if\\s+exists\\s+)?${ident}?`, 'i').exec(t)))
    return { type: 'drop', what: m[1].toLowerCase().replace(/\s+/g, ' '), name: m[3] ?? null, ifExists: !!m[2], text: t }
  if (/^(modify|change)\b/i.test(t)) return { type: 'modify_column', text: t }
  if (/^(rename|convert|alter\s+column|engine|auto_increment|default|character|collate|row_format|comment)/i.test(t)) return { type: 'alter_other', text: t }
  return { type: 'other', text: t }
}

// ---- the static keys one file creates (the dynamic half is the CREATE TABLEs, read back from MariaDB)
export function staticKeys(parsed) {
  const keys = new Set()
  const groups = []
  for (const s of parsed) {
    if (s.op === 'create_index') keys.add(`index:${s.table}.${s.name}`)
    if (s.op === 'alter_table') {
      const cols = []
      for (const c of s.clauses) {
        if (c.type === 'add_column') { keys.add(`column:${s.table}.${c.column}`); cols.push(c.column); if (c.unique) keys.add(`index:${s.table}.${c.column}`) }
        else if (c.type === 'add_index' && c.name) keys.add(`index:${s.table}.${c.name}`)
        else if (c.type === 'add_constraint' && c.name) {
          const kind = c.ctype === 'foreign key' ? 'fk' : c.ctype === 'check' ? 'check' : 'index'
          keys.add(`${kind}:${s.table}.${c.name}`)
        }
      }
      if (cols.length) groups.push({ table: s.table, columns: cols })
    }
  }
  return { keys, groups }
}

// ============================================================================ the lint
// Rules over the text of one migration. `error` = a statement a re-run or a deploy must never contain;
// `warning` = a statement that is legitimate once and surprising on a re-run.
export const LINT_RULES = {
  'destructive-drop': 'DROP TABLE / DATABASE / COLUMN / INDEX / PRIMARY KEY / FOREIGN KEY removes something a live shop has',
  'truncate': 'TRUNCATE empties a table',
  'delete-no-where': 'DELETE without WHERE removes every row',
  'update-no-where': 'UPDATE without WHERE rewrites every row',
  'rename': 'RENAME changes a name the PHP uses',
  'modify-column': 'MODIFY / CHANGE rewrites an existing column: data can be cut or converted',
  'not-idempotent': 'the statement fails (or duplicates data) the second time it is run',
  'redefine-constraint': 'DROP CONSTRAINT IF EXISTS x then ADD CONSTRAINT x: allowed, but the rule is briefly absent',
  'overwrite-on-rerun': 'ON DUPLICATE KEY UPDATE / REPLACE / UPDATE overwrites a value the owner may have edited since',
  'not-portable': 'USE / CREATE DATABASE / DELIMITER / a stored routine / a schema-qualified name: breaks a phpMyAdmin import on shared hosting',
  'server-default-collation': 'CREATE TABLE without an explicit ENGINE / CHARSET / COLLATE takes the server default, which differs between MariaDB 10.x and 11.x',
  'float-money': 'FLOAT / DOUBLE for a money-looking column rounds',
  'session-setting': 'SET foreign_key_checks / sql_mode / autocommit changes the import session',
}
export function lintFile(name, text) {
  const findings = []
  const add = (rule, severity, st, detail = '') => findings.push({ file: name, line: st?.line ?? 0, rule, severity, detail: short(squash(detail || st?.raw || ''), 140) })
  const stmts = splitStatements(text).map(parseStatement)
  // names redefined in the same file (drop constraint if exists X ... add constraint X)
  const dropped = new Map(), added = new Set()
  for (const s of stmts) if (s.op === 'alter_table') for (const c of s.clauses) {
    if (c.type === 'drop' && /constraint|check/.test(c.what) && c.name) dropped.set(`${s.table}.${c.name}`, s)
    if (c.type === 'add_constraint' && c.name) added.add(`${s.table}.${c.name}`)
  }
  for (const s of stmts) {
    /*M:lint-ddl*/
    if (s.op === 'drop') add('destructive-drop', 'error', s)
    if (s.op === 'truncate') add('truncate', 'error', s)
    if (s.op === 'rename_table') add('rename', 'error', s)
    if (s.op === 'delete') add(s.hasWhere ? 'overwrite-on-rerun' : 'delete-no-where', s.hasWhere ? 'warning' : 'error', s)
    if (s.op === 'update' && !s.hasWhere) add('update-no-where', 'error', s)
    if (s.op === 'update' && s.hasWhere && !/(\bis\s+null|=\s*0\b|\bnot\s+exists\b|\bis\s+not\s+null)/i.test(stripQuotes(s.raw).split(/\bwhere\b/i)[1] ?? '')) add('overwrite-on-rerun', 'warning', s, `update on ${s.table} whose WHERE does not restrict to unset rows`)
    if (s.op === 'replace') add('overwrite-on-rerun', 'warning', s)
    if (s.op === 'create_routine' || s.op === 'delimiter' || s.op === 'use' || /^create\s+(database|schema)\b/i.test(s.raw ?? '')) add('not-portable', 'error', s)
    if (s.op === 'set' && /\b(foreign_key_checks|sql_mode|autocommit|unique_checks)\b/i.test(s.raw)) add('session-setting', 'warning', s)
    if (s.op === 'create_table') {
      if (!s.ifNotExists) add('not-idempotent', 'error', s, `CREATE TABLE ${s.table} without IF NOT EXISTS`)
      if (!/\bengine\s*=\s*\w+/i.test(s.raw) || !/\bcharset\s*=\s*\w+|\bcharacter\s+set\s*=?\s*\w+/i.test(s.raw) || !/\bcollate\s*=?\s*\w+/i.test(s.raw)) add('server-default-collation', 'warning', s, `CREATE TABLE ${s.table}`)
      const body = s.raw.slice(s.raw.indexOf('('))
      for (const col of splitTop(body.replace(/^\(/, '').replace(/\)[^)]*$/, ''))) {
        const cm = /^`?(\w+)`?\s+(float|double|real)\b/i.exec(col)
        if (cm && /(price|amount|cost|fee|total|subtotal|balance|value|vat|tax|discount)/i.test(cm[1])) add('float-money', 'warning', s, `${s.table}.${cm[1]} ${cm[2]}`)
      }
      if (/`?\w+`?\.`?\w+`?\s*\(/.test(s.raw.split('(')[0]) || /\bcreate\s+table\s+(if\s+not\s+exists\s+)?`?\w+`?\.`?\w+/i.test(s.raw)) add('not-portable', 'error', s, 'schema-qualified table name')
    }
    if (s.op === 'create_index' && !s.ifNotExists) add('not-idempotent', 'error', s, `CREATE INDEX ${s.name} without IF NOT EXISTS`)
    if (s.op === 'alter_table') {
      for (const c of s.clauses) {
        if (c.type === 'drop') {
          const redefined = /constraint|check/.test(c.what) && c.name && added.has(`${s.table}.${c.name}`)
          if (redefined) add('redefine-constraint', 'warning', s, c.text)
          else add('destructive-drop', 'error', s, c.text)
        }
        if (c.type === 'modify_column') add('modify-column', 'warning', s, c.text)
        if (c.type === 'alter_other' && /^rename/i.test(c.text)) add('rename', 'error', s, c.text)
        if (c.type === 'add_column' && !c.ifNotExists) add('not-idempotent', 'error', s, `ADD COLUMN ${c.column} without IF NOT EXISTS`)
        if (c.type === 'add_index' && !c.ifNotExists) add('not-idempotent', 'error', s, `ADD INDEX ${c.name ?? ''} without IF NOT EXISTS`)
        if (c.type === 'add_constraint' && !c.ifNotExists && !(c.name && dropped.has(`${s.table}.${c.name}`))) add('not-idempotent', 'error', s, `ADD CONSTRAINT ${c.name ?? ''} ${c.ctype} without IF NOT EXISTS`)
      }
    }
    if (s.op === 'insert') {
      if (!s.ignore && !s.onDuplicate) add('not-idempotent', 'error', s, `INSERT into ${s.table} duplicates its rows on a second run`)
      const selfAssign = (a) => a.expr.replace(/[`\s]/g, '').toLowerCase() === a.col.toLowerCase() || a.expr.replace(/[`\s]/g, '').toLowerCase() === `${(s.table ?? '').toLowerCase()}.${a.col.toLowerCase()}`
      const over = s.assigns.filter((a) => !selfAssign(a))
      if (s.onDuplicate && over.length) add('overwrite-on-rerun', 'warning', s, `${s.table}: ON DUPLICATE KEY UPDATE sets ${over.map((a) => a.col).join(', ')}`)
    }
  }
  return findings
}
// Which findings a file is KNOWN to carry and why. Each is documented in sporta-web/ops/db/SCHEMA-DIFF.md; the lint
// reports them anyway, tagged, so nothing is hidden by being known.
export const lintSeverityOrder = { error: 0, warning: 1 }

export function readSqlSources(dir = SQLDIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.mysql.sql')).sort()
  const out = files.map((f) => ({ name: f, path: join(dir, f), group: 'dropin' }))
  const live = join(WEB, '..', 'sporta-live')
  if (existsSync(live)) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mysql.sql') ? [join(d, e.name)] : []))
    for (const p of walk(live)) out.push({ name: relative(join(WEB, '..'), p), path: p, group: 'sporta-live' })
  }
  const priv = join(WEB, 'ops/db/privacy-schema.sql')
  if (existsSync(priv)) out.push({ name: 'ops/db/privacy-schema.sql', path: priv, group: 'ops' })
  return out
}
export function lintAll(sources = readSqlSources()) {
  const findings = []
  for (const s of sources) findings.push(...lintFile(s.name, readFileSync(s.path, 'utf8')))
  findings.sort((a, b) => lintSeverityOrder[a.severity] - lintSeverityOrder[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
  return findings
}
export function renderLint(findings, sources) {
  const L = ['# Migration lint', '', `${sources.length} files · ${findings.filter((f) => f.severity === 'error').length} error · ${findings.filter((f) => f.severity === 'warning').length} warning`, '']
  if (!findings.length) return L.concat(['Clean.', '']).join('\n')
  L.push('| file | line | rule | severity | detail |', '|---|---|---|---|---|')
  for (const f of findings) L.push(`| ${f.file} | ${f.line} | ${f.rule} | ${f.severity} | ${esc(f.detail)} |`)
  L.push('', '### Rules', '')
  for (const r of [...new Set(findings.map((f) => f.rule))]) L.push(`- \`${r}\`: ${LINT_RULES[r]}`)
  return L.concat(['']).join('\n')
}

// ============================================================================ local half: build the expectation
// Everything below needs the repository and a MariaDB binary. None of it is used by --live.
export function installParts(dir = SQLDIR) {
  const gen = readFileSync(join(WEB, 'scripts/make-install-sql.mjs'), 'utf8')
  const start = gen.indexOf('const PARTS = [')
  const src = gen.slice(start, gen.indexOf(']\n', start))
  return [...src.matchAll(/\['([\w-]+\.mysql\.sql)'/g)].map((m) => m[1])
}
// The order the expectation is built in: schema, the install parts in the generator's order, every other dropin
// migration alphabetically, then the migrations that live outside the dropin and that the dropin PHP needs.
export function canonicalOrder(dir = SQLDIR) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.mysql.sql')).sort()
  const parts = installParts(dir)
  const first = ['schema.mysql.sql', ...parts.filter((f) => f !== 'schema.mysql.sql')]
  const rest = all.filter((f) => f !== 'install.mysql.sql' && !first.includes(f))
  return { dropin: [...first, ...rest], external: ['sporta-live/birthday/birthday.mysql.sql'].filter((f) => existsSync(join(WEB, '..', f))), install: 'install.mysql.sql', parts }
}
export const sourcePath = (name) => (name.startsWith('sporta-live/') ? join(WEB, '..', name) : name.startsWith('ops/') ? join(WEB, name) : join(SQLDIR, name))
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

export function runSql(inst, db, text, { force = false } = {}) {
  const r = spawnSync('mariadb', ['--no-defaults', '-S', inst.sock, '-uroot', '--default-character-set=utf8mb4', ...(force ? ['--force'] : []), ...(db ? [db] : [])],
    { input: text, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status === 0) return { ok: true, stderr: r.stderr }
  const m = /ERROR (\d+) \((\w+)\)(?: at line (\d+))?: (.*)/.exec(r.stderr || '')
  return { ok: false, code: m ? Number(m[1]) : null, line: m && m[3] ? Number(m[3]) : null, message: (m ? m[4] : (r.stderr || '').trim()).slice(0, 300), stderr: r.stderr }
}
export async function freshDb(inst, name, { collate = 'utf8mb4_unicode_ci' } = {}) {
  await inst.sql(`drop database if exists \`${name}\`; create database \`${name}\` character set utf8mb4 collate ${collate}`)
  return name
}
// Read a private database through the SAME client and the SAME queries the live mode uses.
export async function readPrivate(inst, db) {
  const conn = new MySQL({ socket: inst.sock, user: 'root', password: '', database: db })
  await conn.connect()
  try { return await readSchema((sql) => conn.query(sql)) } finally { conn.end() }
}
export async function startInstance(label, { portFrom = 34300, root = null } = {}) {
  const { startPrivateMariadb } = await import('./lib/private-mariadb.mjs')
  return startPrivateMariadb({ label, portFrom, root })
}

// What each file creates: CREATE TABLEs are applied alone into an empty database (foreign key checks off, so a
// reference to a table of another file is fine) and read back, so implicit key names and CHECK names are MariaDB's
// own; ALTERs and CREATE INDEXes are read from the text.
export async function providesOf(inst, name, text) {
  const parsed = splitStatements(text).map(parseStatement)
  const stat = staticKeys(parsed)
  const staticList = [...stat.keys].sort()
  const keys = new Set(stat.keys)
  const groups = stat.groups
  const creates = parsed.filter((s) => s.op === 'create_table').map((s) => s.raw)
  if (creates.length) {
    const db = await freshDb(inst, 'provides_scratch')
    const r = runSql(inst, db, `set foreign_key_checks=0;\nset names utf8mb4;\n${creates.join(';\n')};\n`)
    if (!r.ok) throw new Error(`${name}: its CREATE TABLEs do not apply on their own: ${r.message}`)
    const snap = await readPrivate(inst, db)
    for (const [t, T] of Object.entries(snap.tables)) {
      keys.add(`table:${t}`)
      for (const c of Object.keys(T.columns)) keys.add(`column:${t}.${c}`)
      for (const i of Object.keys(T.indexes)) keys.add(`index:${t}.${i}`)
      for (const f of Object.keys(T.fks)) keys.add(`fk:${t}.${f}`)
      for (const c of Object.keys(T.checks)) keys.add(`check:${t}.${c}`)
    }
    await inst.sql('drop database if exists provides_scratch')
  }
  return { keys: [...keys].sort(), staticKeys: staticList, groups }
}

// ---- the PHP side: who uses a column, and who asks first
export function phpFiles() {
  // sporta-live holds staging copies of PHP that already lives in the dropin; scanning both would count every file twice
  const roots = [join(WEB, 'dropin/php-store'), join(WEB, 'dropin/php-knet'), join(WEB, 'dropin/php-cbk')]
  const out = []
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!['test', 'tests', 'node_modules'].includes(e.name)) walk(p) }
      else if (e.name.endsWith('.php') && !/^(config|config\.example|setup-config)\.php$/.test(e.name)) out.push(p)
    }
  }
  roots.forEach(walk)
  return out.sort()
}
export function phpLabel(p) {
  const r = relative(join(WEB, '..'), p)
  return r.startsWith('..') ? basename(p) : r.replace(/^sporta-web\/dropin\/(php-store\/)?/, '').replace(/^sporta-web\//, '')
}
const words = (text) => new Set((text.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []))

// Guards found in one PHP file: [{table, column|null}] plus the functions that contain a guard (callers inherit them).
export function guardsIn(text, tablesCols) {
  const g = []
  for (const m of text.matchAll(/store_column_exists\(\s*\$\w+\s*,\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g)) g.push({ table: m[1], column: m[2], how: 'store_column_exists' })
  for (const m of text.matchAll(/show\s+columns\s+from\s+`?(\w+)`?\s+like\s+['"](\w+)['"]/gi)) g.push({ table: m[1], column: m[2], how: 'SHOW COLUMNS' })
  for (const m of text.matchAll(/\w*table_exists\(\s*\$\w+\s*,\s*['"](\w+)['"]/g)) g.push({ table: m[1], column: null, how: 'table_exists' })
  for (const m of text.matchAll(/column_name\s*=\s*['"](\w+)['"]/gi)) { /* information_schema probes name their table elsewhere */ void m }
  // a handler for error 1054 (unknown column) / 1146 (unknown table) right after a query that names columns
  for (const m of text.matchAll(/errorInfo\[1\][^\n]{0,40}?(1054|1146)|(1054|1146)[^\n]{0,60}errorInfo\[1\]/g)) {
    const win = text.slice(Math.max(0, m.index - 900), m.index).toLowerCase()
    const w = words(win)
    for (const [t, cols] of Object.entries(tablesCols)) {
      if (!w.has(t)) continue
      if ((m[1] ?? m[2]) === '1146') g.push({ table: t, column: null, how: '1146 handler' })
      else for (const c of cols) if (c !== 'id' && w.has(c)) g.push({ table: t, column: c, how: '1054 handler' })
    }
  }
  // functions that contain a guard: another file that calls them is guarded too
  const fns = []
  for (const m of text.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{;]*\{/g)) {
    let depth = 1, i = m.index + m[0].length
    while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++ }
    const body = text.slice(m.index, i)
    const inner = []
    for (const x of body.matchAll(/store_column_exists\(\s*\$\w+\s*,\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)|show\s+columns\s+from\s+`?(\w+)`?\s+like\s+['"](\w+)['"]/gi)) inner.push({ table: x[1] ?? x[3], column: x[2] ?? x[4], how: `${m[1]}()` })
    if (inner.length && m[1] !== 'store_column_exists') fns.push({ name: m[1], guards: inner })
  }
  return { guards: g, fns }
}

export function scanCode(expectedTables, alterGroups, files = phpFiles()) {
  const tablesCols = Object.fromEntries(Object.entries(expectedTables).map(([t, T]) => [t, Object.keys(T.columns)]))
  const info = files.map((p) => {
    const text = readFileSync(p, 'utf8')
    return { file: phpLabel(p), text, words: words(text), ...guardsIn(text, tablesCols) }
  })
  // functions that guard, by name, repository wide
  const fnGuards = new Map()
  for (const f of info) for (const fn of f.fns) fnGuards.set(fn.name, fn.guards)
  const sibling = new Map() // "t.c" -> the other columns added by the same ALTER
  for (const g of alterGroups) for (const c of g.columns) sibling.set(`${g.table}.${c}`, g.columns.map((x) => `${g.table}.${x}`))
  const code = { tables: {}, columns: {} }
  for (const f of info) {
    f.guardSet = new Set()
    for (const g of f.guards) {
      if (g.column) for (const k of sibling.get(`${g.table}.${g.column}`) ?? [`${g.table}.${g.column}`]) f.guardSet.add(k)
      f.guardSet.add(g.column ? `${g.table}.${g.column}` : `${g.table}`)
    }
    for (const [name, guards] of fnGuards) if (f.text.includes(`${name}(`) && !f.fns.some((fn) => fn.name === name && false)) {
      for (const g of guards) for (const k of sibling.get(`${g.table}.${g.column}`) ?? [`${g.table}.${g.column}`]) f.guardSet.add(k)
    }
  }
  for (const [t, T] of Object.entries(expectedTables)) {
    const tableCtx = new RegExp(`\\b(from|join|into|update|table|exists|like)\\s+\`?${t}\\b`, 'i')
    const strict = info.filter((f) => f.words.has(t) && tableCtx.test(f.text))
    if (strict.length) code.tables[t] = [strict.map((f) => f.file), strict.filter((f) => f.guardSet.has(t)).map((f) => f.file)]
    for (const c of Object.keys(T.columns)) {
      const refs = info.filter((f) => f.words.has(t) && f.words.has(c))
      if (refs.length) code.columns[`${t}.${c}`] = [refs.map((f) => f.file), refs.filter((f) => f.guardSet.has(`${t}.${c}`)).map((f) => f.file)]
    }
  }
  const seen = new Set()
  const guardNames = info.flatMap((f) => f.guards.map((g) => ({ file: f.file, table: g.table, column: g.column, how: g.how }))).filter((g) => { const k = JSON.stringify(g); if (seen.has(k)) return false; seen.add(k); return true })
  return { code, guards: guardNames }
}

// Old-build tables: those in the committed production structure dump of 2026-11-01 that the repository does not define.
export function oldBuildTables(expectedTables, files) {
  const dump = join(WEB, 'docs/live-schema-structure.sql')
  if (!existsSync(dump)) return {}
  const names = [...readFileSync(dump, 'utf8').matchAll(/^CREATE TABLE `([a-z0-9_]+)`/gm)].map((m) => m[1]).filter((t) => !expectedTables[t])
  const out = {}
  for (const n of names) {
    const refs = files.filter((f) => new RegExp(`\\b(from|join|into|update|table)\\s+\`?${n}\\b`, 'i').test(f.text)).map((f) => f.file)
    out[n] = refs.join(', ')
  }
  return out
}

// ---- build the whole snapshot
export async function buildSnapshot({ inst: given = null, log = () => {} } = {}) {
  const inst = given ?? await startInstance('sdiff')
  try {
    const order = canonicalOrder()
    const files = [...order.dropin, ...order.external]
    const texts = {}
    for (const f of files) texts[f] = readFileSync(sourcePath(f), 'utf8')
    texts[order.install] = readFileSync(sourcePath(order.install), 'utf8')
    const db = await freshDb(inst, 'expected')
    for (const f of files) {
      const r = runSql(inst, db, texts[f])
      if (!r.ok) throw new Error(`${f} does not apply on top of the files before it: ${r.message}${r.line ? ` (line ${r.line})` : ''}`)
      log(`applied ${f}`)
    }
    const schema = await readPrivate(inst, db)
    const provides = {}, groups = [], staticOnly = {}
    for (const f of [...files, order.install]) {
      const p = await providesOf(inst, f, texts[f])
      provides[f] = p.keys
      staticOnly[f] = p.staticKeys
      if (f !== order.install) groups.push(...p.groups)
    }
    // objects some other file creates that the expectation does not: known extras (the 2026-10-31 hot-fix, the privacy pack)
    const known_extra = {}, planned = {}
    for (const s of readSqlSources()) {
      if (files.includes(s.name) || s.name === order.install) continue
      const p = await providesOf(inst, s.name, readFileSync(s.path, 'utf8'))
      provides[s.name] = p.keys
      for (const k of p.keys) {
        const inExpected = (provides[order.install] ?? []).includes(k) || files.some((f) => provides[f]?.includes(k))
        if (!inExpected) { known_extra[k] = s.name; if (k.startsWith('table:')) planned[k.slice(6)] = s.name }
      }
    }
    // unused provides entries for non-canonical files stay out of the migration status (they are not expected)
    // A key the file creates on its own but that the finished schema does not carry (MariaDB drops the implicit index a
    // foreign key made once a covering index exists) is not an object a live database should have. A key the TEXT of a
    // file names but the finished schema lacks is a parse error: refuse to write a snapshot that would lie.
    const have = new Set()
    for (const [t, T] of Object.entries(schema.tables)) {
      have.add(`table:${t}`)
      for (const c of Object.keys(T.columns)) have.add(`column:${t}.${c}`)
      for (const i of Object.keys(T.indexes)) have.add(`index:${t}.${i}`)
      for (const f of Object.keys(T.fks)) have.add(`fk:${t}.${f}`)
      for (const c of Object.keys(T.checks)) have.add(`check:${t}.${c}`)
    }
    const status = {}
    for (const f of [...files, order.install]) {
      const lost = (staticOnly[f] ?? []).filter((k) => !have.has(k))
      if (lost.length) throw new Error(`${f}: names ${lost.join(', ')} but the schema built from the repository has no such object (the SQL parser and MariaDB disagree)`)
      status[f] = provides[f].filter((k) => have.has(k))
    }
    const scan = scanCode(schema.tables, groups)
    const phpInfo = phpFiles().map((p) => ({ file: phpLabel(p), text: readFileSync(p, 'utf8') }))
    const snapshot = {
      format: FORMAT,
      server: schema.server,
      files: Object.fromEntries([...files, order.install].map((f) => [f, sha(texts[f])])),
      order: [...files, order.install],
      parts: order.parts,
      tables: schema.tables,
      provides: status,
      known_extra,
      families: { planned, old_build: oldBuildTables(schema.tables, phpInfo) },
      code: scan.code,
      guards: scan.guards,
    }
    for (const T of Object.values(snapshot.tables)) delete T.rows
    return snapshot
  } finally { if (!given) inst.stop() }
}

// The part of a snapshot that must match the repository exactly (the PHP scan may lag; see compareSnapshots).
export function snapshotText(snap) {
  const o = { ...snap }
  const lines = ['{', `"format": ${JSON.stringify(o.format)},`, `"server": ${JSON.stringify(o.server)},`, `"files": ${JSON.stringify(o.files)},`, `"order": ${JSON.stringify(o.order)},`, `"parts": ${JSON.stringify(o.parts)},`]
  lines.push('"tables": {')
  const tn = Object.keys(o.tables).sort()
  tn.forEach((t, i) => {
    const T = o.tables[t]
    lines.push(`${JSON.stringify(t)}: {"engine": ${JSON.stringify(T.engine)}, "collation": ${JSON.stringify(T.collation)},`)
    lines.push(' "columns": {')
    const cn = T.order ?? Object.keys(T.columns)
    cn.forEach((c, j) => lines.push(`  ${JSON.stringify(c)}: ${JSON.stringify(T.columns[c])}${j < cn.length - 1 ? ',' : ''}`))
    lines.push(' },')
    lines.push(` "indexes": ${JSON.stringify(T.indexes)},`, ` "fks": ${JSON.stringify(T.fks)},`, ` "checks": ${JSON.stringify(T.checks)}}${i < tn.length - 1 ? ',' : ''}`)
  })
  lines.push('},')
  lines.push('"provides": {')
  const pn = Object.keys(o.provides)
  pn.forEach((f, i) => lines.push(`${JSON.stringify(f)}: ${JSON.stringify(o.provides[f])}${i < pn.length - 1 ? ',' : ''}`))
  lines.push('},')
  lines.push(`"known_extra": ${JSON.stringify(o.known_extra)},`, `"families": ${JSON.stringify(o.families)},`)
  lines.push('"code": {"tables": {')
  const ct = Object.keys(o.code.tables).sort()
  ct.forEach((t, i) => lines.push(`${JSON.stringify(t)}: ${JSON.stringify(o.code.tables[t])}${i < ct.length - 1 ? ',' : ''}`))
  lines.push('}, "columns": {')
  const cc = Object.keys(o.code.columns).sort()
  cc.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(o.code.columns[k])}${i < cc.length - 1 ? ',' : ''}`))
  lines.push('}},')
  lines.push(`"guards": ${JSON.stringify(o.guards)}`)
  lines.push('}')
  return lines.join('\n') + '\n'
}
// strict part = everything but `server`, `code` and `guards`; the PHP part is advisory
export function compareSnapshots(committed, fresh) {
  const strip = (s) => { const { server, code, guards, ...rest } = s; void server; void code; void guards; return rest }
  const a = JSON.stringify(strip(committed)), b = JSON.stringify(strip(fresh))
  const schemaSame = a === b
  const codeSame = JSON.stringify(committed.code) === JSON.stringify(fresh.code) && JSON.stringify(committed.guards) === JSON.stringify(fresh.guards)
  const why = []
  if (!schemaSame) {
    for (const f of new Set([...Object.keys(committed.files), ...Object.keys(fresh.files)])) if (committed.files[f] !== fresh.files[f]) why.push(`${f} ${committed.files[f] ? (fresh.files[f] ? 'changed' : 'removed') : 'added'}`)
    if (!why.length) why.push('the built schema differs although no file hash does (a different MariaDB?)')
  }
  return { schemaSame, codeSame, why }
}

// ---- integrity: apply, repeat, reorder, install vs schema, seed re-run
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export const shuffled = (list, seed) => { const r = mulberry32(seed), a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// Compare two schemas object by object: which keys does one have that the other lacks, which attributes differ.
export function schemaKeys(schema) {
  const k = new Map()
  for (const [t, T] of Object.entries(schema.tables)) {
    k.set(`table:${t}`, `${T.engine}/${T.collation}`)
    for (const [c, C] of Object.entries(T.columns)) k.set(`column:${t}.${c}`, `${normType(C.type)}|${C.null}|${C.def}|${C.cs}|${C.coll}|${C.extra}`)
    for (const [i, I] of Object.entries(T.indexes)) k.set(`index:${t}.${i}`, `${I.unique}|${I.cols.join(',')}`)
    for (const [f, F] of Object.entries(T.fks)) k.set(`fk:${t}.${f}`, `${F.cols.join(',')}>${F.ref}(${F.refcols.join(',')}) ${F.upd}/${F.del}`)
    for (const [c, C] of Object.entries(T.checks)) k.set(`check:${t}.${c}`, normClause(C.clause))
  }
  return k
}
export function compareSchemas(a, b) {
  const ka = schemaKeys(a), kb = schemaKeys(b)
  const onlyA = [], onlyB = [], differ = []
  for (const [k, v] of ka) { if (!kb.has(k)) onlyA.push(k); else if (kb.get(k) !== v) differ.push(k) }
  for (const k of kb.keys()) if (!ka.has(k)) onlyB.push(k)
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort(), differ: differ.sort(), same: !onlyA.length && !onlyB.length && !differ.length }
}
// A checksum of every row of every table: a second run must not change any.
export async function rowChecksums(inst, db) {
  const tables = (await inst.sql(`select table_name from information_schema.tables where table_schema='${db}' and table_type='BASE TABLE' order by 1`)).split('\n').filter(Boolean)
  const out = {}
  for (const t of tables) {
    const r = await inst.sql(`checksum table \`${t}\``, db)
    out[t] = r.split('\t')[1]
  }
  return out
}

export const repoSource = () => ({ order: canonicalOrder(), text: (f) => readFileSync(sourcePath(f), 'utf8') })

export async function integrity({ inst: given = null, source = repoSource(), seeds = [11, 23, 37, 41], log = () => {}, seedChecks = true } = {}) {
  const inst = given ?? await startInstance('sinteg')
  const report = { applies: [], repeat: {}, order: [], install: {}, seed: {}, deps: [] }
  try {
    const order = source.order
    const files = [...order.dropin, ...order.external]
    const text = source.text
    // 1) canonical order, every file once, stop-at-first-error per file
    const A = await freshDb(inst, 'integ_a')
    for (const f of files) { const r = runSql(inst, A, text(f)); report.applies.push({ file: f, ok: r.ok, message: r.ok ? '' : r.message }) }
    const schemaA = await readPrivate(inst, A)
    const sumsA = await rowChecksums(inst, A)
    // 2) every file a second time
    const again = []
    for (const f of files) { const r = runSql(inst, A, text(f)); if (!r.ok) again.push({ file: f, message: r.message }) }
    const schemaA2 = await readPrivate(inst, A)
    const sumsA2 = await rowChecksums(inst, A)
    const cmp2 = compareSchemas(schemaA, schemaA2)
    report.repeat = { errors: again, schemaSame: cmp2.same, rowsChanged: Object.keys(sumsA).filter((t) => sumsA[t] !== sumsA2[t]), diff: cmp2 }
    // 3) install.mysql.sql alone, and install then the rest (the way `npm run sandbox` and the rigs build it)
    const I = await freshDb(inst, 'integ_i')
    const ri = runSql(inst, I, text(order.install))
    const schemaI = await readPrivate(inst, I)
    const IR = await freshDb(inst, 'integ_ir')
    runSql(inst, IR, text(order.install))
    const restApplied = []
    for (const f of files.filter((x) => !order.parts.includes(x) && x !== 'schema.mysql.sql')) { const r = runSql(inst, IR, text(f)); restApplied.push({ file: f, ok: r.ok, message: r.ok ? '' : r.message }) }
    const schemaIR = await readPrivate(inst, IR)
    report.install = { ok: ri.ok, message: ri.message ?? '', aloneVsCanonical: compareSchemas(schemaA, schemaI), withRestVsCanonical: compareSchemas(schemaA, schemaIR), restApplied }
    Object.defineProperty(report, 'schemaA', { value: schemaA, enumerable: false })
    // 4) the dedicated migrations in other orders, on top of the install parts
    const migs = files.filter((x) => !order.parts.includes(x) && x !== 'schema.mysql.sql')
    for (const [label, ord] of [['reverse', [...migs].reverse()], ...seeds.map((s) => [`shuffle-${s}`, shuffled(migs, s)])]) {
      const B = await freshDb(inst, 'integ_b')
      for (const f of [ 'schema.mysql.sql', ...order.parts.filter((x) => x !== 'schema.mysql.sql') ]) runSql(inst, B, text(f))
      const errs = []
      for (const f of ord) { const r = runSql(inst, B, text(f)); if (!r.ok) errs.push({ file: f, message: r.message }) }
      const c = compareSchemas(schemaA, await readPrivate(inst, B))
      report.order.push({ label, errors: errs, same: c.same, diff: c })
    }
    // 5) dependencies: the smallest prefix of the canonical order each migration needs
    for (const f of files.filter((x) => x !== 'schema.mysql.sql')) {
      const dbn = await freshDb(inst, 'integ_d')
      let need = []
      const base = ['schema.mysql.sql']
      runSql(inst, dbn, text('schema.mysql.sql'))
      let r = runSql(inst, dbn, text(f))
      if (!r.ok) {
        const pool = files.filter((x) => x !== 'schema.mysql.sql' && x !== f)
        for (const p of pool) {
          runSql(inst, dbn, text(p)); need.push(p)
          r = runSql(inst, dbn, text(f))
          if (r.ok) break
        }
        if (!r.ok) need = ['(still fails)']
        else {
          // shrink: drop any prerequisite whose removal still works
          for (const p of [...need]) {
            const d2 = await freshDb(inst, 'integ_d2')
            runSql(inst, d2, text('schema.mysql.sql'))
            for (const q of need.filter((x) => x !== p)) runSql(inst, d2, text(q))
            if (runSql(inst, d2, text(f)).ok) need = need.filter((x) => x !== p)
          }
        }
      }
      const declared = need.filter((p) => new RegExp(p.replace(/\.mysql\.sql$/, '').replace(/[-.]/g, '\\$&') + '(\\.mysql\\.sql)?', 'i').test(text(f).split('\n').filter((l) => /^\s*--/.test(l)).join('\n')))
      report.deps.push({ file: f, aloneOnSchema: base, needs: need, declaredInHeader: declared })
    }
    // 6) the seed: owner edits, then a re-run
    if (!seedChecks) return report
    const S = await freshDb(inst, 'integ_s')
    runSql(inst, S, text(order.install))
    const seedSet = async () => inst.sql(`select concat_ws('|',
        (select count(*) from products), (select count(*) from product_variants), (select count(*) from brands), (select count(*) from settings))`, S)
    const before = await seedSet()
    const probe = (await inst.sql(`select slug from products order by id limit 1`, S))
    const sku = (await inst.sql(`select sku from product_variants order by sku limit 1`, S))
    const women = (await inst.sql(`select slug from products where category = 'women' order by id limit 1`, S))
    const OWNER = `update products set price = 99.999, name_en = 'OWNER EDIT', active = 0, category = 'owner' where slug = '${probe}';
      update product_variants set stock = 777, cost_aed = 1.23 where sku = '${sku}';
      update brands set name_en = 'OWNER BRAND' where slug = 'sporta';
      update products set no_exchange = 0 where slug = '${women}';
      update settings set value = '{"owner":true}' where name = 'hero'`
    await inst.sql(OWNER, S)
    const edited = async () => inst.sql(`select concat_ws('|',
        (select price from products where slug = '${probe}'), (select name_en from products where slug = '${probe}'), (select active from products where slug = '${probe}'),
        (select stock from product_variants where sku = '${sku}'), (select cost_aed from product_variants where sku = '${sku}'),
        (select name_en from brands where slug = 'sporta'), (select value from settings where name = 'hero'), (select no_exchange from products where slug = '${women}'))`, S)
    const mine = await edited()
    report.seed = { rowsBefore: before, results: [] }
    for (const f of ['seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql', order.install]) {
      await inst.sql(OWNER, S)
      runSql(inst, S, text(f))
      const after = (await edited()).split('|'), was = mine.split('|')
      const labels = ['product price', 'product name', 'product active flag', 'variant stock', 'variant cost', 'brand name', 'settings value', 'no-exchange flag']
      report.seed.results.push({ file: f, overwritten: labels.filter((_, i) => after[i] !== was[i]), preserved: labels.filter((_, i) => after[i] === was[i]), rowsAfter: await seedSet() })
    }
    return report
  } finally { if (!given) inst.stop() }
}

// ---- what the install file and the lists around it leave out (static, from the snapshot and the repository)
// Objects a dedicated migration creates that neither schema.mysql.sql nor the install parts create: a shop installed
// from install.mysql.sql lacks them until somebody runs the migration.
export function lackedByInstall(snapshot) {
  const bases = new Set()
  for (const f of ['schema.mysql.sql', ...(snapshot.parts ?? [])]) for (const k of snapshot.provides[f] ?? []) bases.add(k)
  const installKeys = new Set(snapshot.provides['install.mysql.sql'] ?? [])
  const lacking = {}
  for (const [f, keys] of Object.entries(snapshot.provides)) {
    if (!dedicated(f) || (snapshot.parts ?? []).includes(f)) continue
    const missing = keys.filter((k) => !installKeys.has(k))
    if (missing.length) lacking[f] = missing
  }
  void bases
  return lacking
}
// A guard that names a column no migration creates: the code asks, the answer is always "no", the feature is off for good.
export function guardsOnMissing(snapshot) {
  return (snapshot.guards ?? []).filter((g) => g.column && !snapshot.tables[g.table]?.columns?.[g.column] && !snapshot.tables[g.table]?.columns?.[g.column])
    .concat((snapshot.guards ?? []).filter((g) => !g.column && !snapshot.tables[g.table]))
}
// The lists that name migrations or tables: the install generator, the numbered copies in the package, the file audit,
// the install check in preflight.php. Each is compared with the files on disk and with the tables the code needs.
export function packagingChecks(snapshot) {
  const files = readdirSync(SQLDIR).filter((f) => f.endsWith('.mysql.sql') && f !== 'install.mysql.sql').sort()
  const parts = installParts()
  const rd = (p) => readFileSync(join(WEB, p), 'utf8')
  const pkg = rd('scripts/make-package.mjs')
  const pkgOrder = [...((/const ORDER = \[([^\]]*)\]/.exec(pkg) ?? [])[1] ?? '').matchAll(/'([\w-]+)\.mysql'/g)].map((m) => `${m[1]}.mysql.sql`)
  const audit = rd('scripts/file-audit.mjs')
  const auditList = [...new Set([...audit.matchAll(/\/api\/([\w-]+\.mysql\.sql)/g)].map((m) => m[1]))]
  const pf = rd('dropin/php-store/preflight.php')
  const needSrc = pf.slice(pf.indexOf('$need = ['), pf.indexOf('];', pf.indexOf('$need = [')))
  const preflightNeed = [...needSrc.matchAll(/'(\w+)'\s*=>/g)].map((m) => m[1])
  const needed = Object.keys(snapshot.code.tables).filter((t) => snapshot.code.tables[t][0].length > snapshot.code.tables[t][1].length)
  // the install generator really writes install.mysql.sql from the parts: regenerate in a scratch tree and compare
  let installFresh = null
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'sdiff-gen-'))
    mkdirSync(join(tmp, 'scripts'), { recursive: true }); mkdirSync(join(tmp, 'dropin/php-store'), { recursive: true })
    writeFileSync(join(tmp, 'scripts/make-install-sql.mjs'), rd('scripts/make-install-sql.mjs'))
    for (const f of parts) writeFileSync(join(tmp, 'dropin/php-store', f), readFileSync(join(SQLDIR, f)))
    const r = spawnSync(process.execPath, [join(tmp, 'scripts/make-install-sql.mjs')], { encoding: 'utf8' })
    installFresh = r.status === 0 && readFileSync(join(tmp, 'dropin/php-store/install.mysql.sql'), 'utf8') === readFileSync(join(SQLDIR, 'install.mysql.sql'), 'utf8')
    rmSync(tmp, { recursive: true, force: true })
  } catch { installFresh = null }
  return {
    on_disk: files,
    install_parts: parts,
    not_in_install_parts: files.filter((f) => !parts.includes(f)),
    listed_but_absent: parts.filter((f) => !files.includes(f)),
    package_numbered_copies: pkgOrder,
    package_numbered_lacking: files.filter((f) => !pkgOrder.includes(f) && ['schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'].includes(f)),
    file_audit_required: auditList,
    file_audit_not_required: files.filter((f) => !auditList.includes(f)),
    preflight_tables: preflightNeed,
    tables_the_code_needs_unchecked_by_preflight: needed.filter((t) => !preflightNeed.includes(t)),
    install_on_disk_is_the_generator_output: installFresh,
    lacked_by_install: lackedByInstall(snapshot),
    guards_naming_missing_objects: guardsOnMissing(snapshot),
  }
}

// ============================================================================ the job
export function encode(text) { return gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64') }
export function jobSpec(scriptText, snapshotText) {
  return {
    services: {
      schemadiff: {
        image: 'node:24-alpine',
        restart: 'no',
        // The script and the committed expectation travel as data (gzip + base64: an alphabet with neither a dollar sign
        // nor a forbidden word), because the Hostinger API refuses a compose file that contains curl, wget or
        // require('fs'), and compose interpolates a dollar sign. Same mounts as the other read-only database jobs.
        environment: { SRC: encode(scriptText), EXPECTED: encode(snapshotText) },
        volumes: [
          '/docker/sporta/private/api-config.php:/run/sporta-api-config.php:ro',
          '/docker/sporta/private/db_name:/run/secrets/sporta_db_name:ro',
          '/docker/sporta/private/db_user:/run/secrets/sporta_db_user:ro',
          '/docker/sporta/private/db_pass:/run/secrets/sporta_db_pass:ro',
        ],
        networks: ['sporta-db_default'],
        entrypoint: ['/bin/sh', '-c'],
        command: ['printenv SRC | base64 -d | gunzip > /tmp/d.mjs && printenv EXPECTED | base64 -d | gunzip > /tmp/e.json && node /tmp/d.mjs --live --config /run/sporta-api-config.php --expected-file /tmp/e.json --markdown --exit-line'],
      },
    },
    networks: { 'sporta-db_default': { external: true } },
  }
}
export const FORBIDDEN_IN_JOB = [/curl/i, /wget/i, /require\(\s*['"]fs['"]\s*\)/, /\$/]

// ============================================================================ CLI
function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (!x.startsWith('--')) { a._.push(x); continue }
    const k = x.slice(2)
    if (['config', 'expected-file', 'out', 'db'].includes(k)) a[k] = argv[++i]
    else a[k] = true
  }
  return a
}
function loadExpected(args) {
  const f = args['expected-file'] ?? (process.env.EXPECTED_B64 ? null : SNAPSHOT_FILE)
  const text = f ? readFileSync(f, 'utf8') : gunzipSync(Buffer.from(process.env.EXPECTED_B64, 'base64')).toString('utf8')
  const snap = JSON.parse(text)
  if (snap.format !== FORMAT) throw new Error(`the expected-schema file has format ${snap.format}, this tool reads ${FORMAT}`)
  return snap
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const json = !!args.json
  const out = (s) => (args.out ? writeFileSync(args.out, s) : process.stdout.write(s))
  if (args.help || (!args.live && !args.snapshot && !args['check-snapshot'] && !args.expected && !args['lint-migrations'] && !args.integrity && !args['make-job'])) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 14).map((l) => l.slice(3)).join('\n'))
    return 0
  }
  if (args['lint-migrations']) {
    const sources = readSqlSources()
    const f = lintAll(sources)
    out(json ? JSON.stringify({ files: sources.map((s) => s.name), findings: f }, null, 2) + '\n' : renderLint(f, sources))
    return f.some((x) => x.severity === 'error') && !args['no-fail'] ? 1 : 0
  }
  if (args.snapshot || args['check-snapshot'] || args.expected) {
    let snap
    try { snap = await buildSnapshot({ log: args.verbose ? console.error : () => {} }) } catch (e) { console.error(`cannot build the expected schema: ${e.message}`); return 2 }
    if (args.snapshot) { writeFileSync(args.out ?? SNAPSHOT_FILE, snapshotText(snap)); console.error(`wrote ${args.out ?? SNAPSHOT_FILE}: ${Object.keys(snap.tables).length} tables, ${snap.order.length} files`); return 0 }
    if (args['check-snapshot']) {
      const c = compareSnapshots(JSON.parse(readFileSync(args.out ?? SNAPSHOT_FILE, 'utf8')), JSON.parse(snapshotText(snap)))
      if (!c.schemaSame) { console.error(`STALE: the committed snapshot differs from what the repository builds (${c.why.join('; ')}). Run: node scripts/db-schema-live-diff.mjs --snapshot`); return 3 }
      console.error(c.codeSame ? 'snapshot is current' : 'snapshot schema is current; its PHP-usage section lags the code (advisory: re-run --snapshot to refresh)')
      return 0
    }
    out(json ? snapshotText(snap) : `expected schema: ${Object.keys(snap.tables).length} tables, ${Object.values(snap.tables).reduce((n, t) => n + Object.keys(t.columns).length, 0)} columns, ${snap.order.length} files\n${Object.entries(snap.tables).map(([t, T]) => `  ${t} (${Object.keys(T.columns).length} columns, ${Object.keys(T.indexes).length} indexes)`).join('\n')}\n`)
    return 0
  }
  if (args.integrity) {
    const r = await integrity({ log: args.verbose ? console.error : () => {} })
    out(JSON.stringify(r, null, 2) + '\n')
    return 0
  }
  if (args['make-job']) {
    const snapText = readFileSync(SNAPSHOT_FILE, 'utf8')
    const spec = jobSpec(readFileSync(fileURLToPath(import.meta.url), 'utf8'), snapText)
    writeFileSync(args.out ?? JOB_FILE, JSON.stringify(spec, null, 2) + '\n')
    console.error(`wrote ${args.out ?? JOB_FILE}`)
    return 0
  }

  // ---- --live
  let expected
  try { expected = args['expected-build'] ? JSON.parse(snapshotText(await buildSnapshot())) : loadExpected(args) } catch (e) { console.error(`cannot load the expected schema: ${e.message}`); return 2 }
  let cred
  try { cred = credentials(args) } catch (e) { console.error(`db-schema-live-diff: ${e.message}`); return 2 }
  if (args.db) cred.database = args.db
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error(`db-schema-live-diff: cannot connect: ${scrub(e.message, secrets)}`); return 2 }
  const gate = new Gate(conn)
  let live
  try {
    await gate.readOnly()
    live = await readSchema((sql) => gate.query(sql))
  } catch (e) {
    console.error(`db-schema-live-diff: ${scrub(e.message, secrets)}`)
    await gate.end()
    return 2
  }
  await gate.end()
  const result = diffSchemas(expected, live, {})
  const meta = { database: cred.database, snapshotId: sha(JSON.stringify(expected.files)), statements: gate.sent.length }
  out(json ? renderJson(expected, live, result, meta) : renderMarkdown(expected, live, result, meta))
  return args['no-fail'] ? 0 : exitCodeFor(result, { strict: !!args.strict })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitLine = process.argv.includes('--exit-line')
  const done = (code) => { if (exitLine) process.stdout.write(`SCHEMA_DIFF_EXIT=${code}\n`); process.exit(code) }
  main().then(done, (e) => { console.error(`db-schema-live-diff: ${e.message}`); done(2) })
}
