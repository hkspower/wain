#!/usr/bin/env node
// DB SECURITY AUDIT — a READ-ONLY look at how well the shop's MariaDB is
// locked down, answered check by check as PASS, FAIL or UNKNOWN.
//
//   node scripts/db-security-audit.mjs --config /run/sporta-api-config.php
//   node scripts/db-security-audit.mjs --json
//   node scripts/db-security-audit.mjs --only acct,tls        (ids or prefixes)
//   node scripts/db-security-audit.mjs --accept sec.recoverable_secrets
//   node scripts/db-security-audit.mjs --list                 (every check id)
//   node scripts/db-security-audit.mjs --fixes-md             (the owner's FAIL table)
//   node scripts/db-security-audit.mjs --connect-timeout 10   (seconds to connect and sign in; default 30)
//
// WHAT IT ANSWERS. Not "is the shop up" but "if someone got a foothold, how
// far could they go, and what would be left lying around for them":
//   accounts   anonymous users, empty passwords, '%' hosts, root reachable from
//              the network, FILE/SUPER/PROCESS/SHUTDOWN/GRANT OPTION, DDL rights
//              held by the web account, accounts nobody uses, old passwords
//   server     bind address and who is connected as the server sees it,
//              skip_name_resolve, local_infile, secure_file_priv, sql_mode,
//              TLS, general/slow logs, binary logs, connection and statement
//              ceilings, charset defaults, event scheduler, password-strength
//              plugins, connection auditing, version and end-of-life
//   schema     engines, primary keys, foreign keys, utf8mb4 on every column,
//              triggers/events/routines/views run with a powerful DEFINER,
//              copies of tables left in the live schema, other databases
//   secrets    columns that hold passwords/tokens/secrets and whether their
//              values LOOK hashed (bcrypt, argon2, hex digest) — shape only
//   hygiene    card-like numbers in free text (Luhn), precise-location lines,
//              expired tokens, personal data in log tables, retention
//
// READ-ONLY, BY CONSTRUCTION, NOT BY PROMISE (three independent layers).
//   1. The session is put in READ ONLY mode and everything runs inside START
//      TRANSACTION READ ONLY. The tool asserts @@tx_read_only = 1 before it
//      sends a single question and STOPS (exit 2) if it is not.
//   2. Every statement passes a gate before it is sent: it must begin with
//      SELECT or SHOW and may not contain INTO, FOR UPDATE, LOCK IN SHARE
//      MODE, ';', an executable comment, or a function with side effects
//      (GET_LOCK, SLEEP, BENCHMARK, LOAD_FILE ...). A write cannot be spelled.
//   3. Only information_schema, SHOW and (when the account may) the mysql
//      account tables are read. Run it with the web account for a limited
//      verdict, or with a read-only auditor account for the full one; neither
//      can change anything, and the second layer holds even for root.
//
// WHAT IS PRINTED, AND WHAT NEVER IS.
//   Table and column names, counts, account names (user@host — mask them with
//   --mask-names), variable names and values of server settings. NEVER a row
//   value: no name, phone, address, note, token, hash, secret or password, not
//   even masked. Password hashes are never selected from the account tables
//   (the server reduces them to "empty or not" before they leave it); SHOW
//   GRANTS text, which can carry a hash, is parsed in memory and discarded.
//   Card-like numbers are COUNTED per column, never shown. (To run the Luhn test here,
//   the server sends back the first 4000 characters of each row that has twelve or more
//   digits in a row; they sit in memory for the count and are dropped. They travel over
//   the connection, so use --tls / --tls-ca when it crosses a network you do not trust.)
//
// PASS / FAIL / UNKNOWN. UNKNOWN is never a pass: it means the connecting
// account cannot look (the reason names the missing privilege) or the answer
// lives outside the database (the reason points at ops/db/HOST-CHECKLIST.md).
// An empty answer from a catalogue the account cannot fully see (triggers need
// TRIGGER, events need EVENT ...) is UNKNOWN too, never PASS.
//
// EXIT CODE  0 no FAIL (or every FAIL was named in --accept)
//            1 at least one FAIL    (--strict: UNKNOWN counts too)
//            2 could not run (no credentials, cannot connect, session not
//              read-only, bad flag)
//
// CREDENTIALS, in this order (first found wins) — same as db-url-scan.mjs:
//   --config <file>        a PHP file returning db_host, db_name, db_user, db_pass
//   SPORTA_API_CONFIG_FILE the same file, named the way the store names it
//   DB_HOST DB_PORT DB_SOCKET DB_USER DB_PASSWORD DB_NAME, each also accepted
//                          as DB_*_FILE naming a file that holds the value
// The password is never taken from the command line (it would sit in `ps`),
// and is scrubbed from everything the tool prints.
//
// NO DEPENDENCIES. A minimal MySQL client (handshake v10, mysql_native_password,
// optional TLS upgrade, COM_QUERY) so it runs in a bare node:24-alpine job on
// the VPS. Not supported: ed25519 / caching_sha2_password sign-in.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { connect, isIP } from 'node:net'
import { connect as tlsConnect, checkServerIdentity } from 'node:tls'
import { pathToFileURL } from 'node:url'

export const TOOL = { name: 'db-security-audit', version: '1.0.0' }

// ===========================================================================
// 1. THE STATEMENT GATE — nothing but a read can be sent.
// ===========================================================================

// Remove string literals, quoted identifiers and comments so that keywords can
// be looked for in what the server would actually parse. An executable comment
// (/*! ... */, /*M! ... */) is a way to smuggle a statement past a naive
// filter, so it is reported rather than stripped.
export function stripSql(sql) {
  let out = ''
  let exec = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue }
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue } break }
        i++
      }
      out += ' '
    } else if (c === '`') {
      i++
      while (i < sql.length) {
        if (sql[i] === '`') { if (sql[i + 1] === '`') { i += 2; continue } break }
        i++
      }
      out += ' _ '
    } else if (c === '-' && sql[i + 1] === '-' && /\s|^$/.test(sql[i + 2] ?? ' ')) {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (c === '/' && sql[i + 1] === '*') {
      if (sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!')) exec = true
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 1
      out += ' '
    } else out += c
  }
  return { text: out, exec }
}

const BAD_FUNCTIONS = /\b(GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS|SLEEP|BENCHMARK|LOAD_FILE|SYS_EXEC|SYS_EVAL|MASTER_POS_WAIT|SOURCE_POS_WAIT|SETVAL|NEXTVAL|NEXT\s+VALUE)\b/i

// Returns null when the statement may be sent, else the reason it may not.
export function gateReason(sql) {
  const { text, exec } = stripSql(String(sql))
  if (exec) return 'executable comment'
  if (text.includes(';')) return 'more than one statement'
  if (!/^\s*(SELECT|SHOW)\b/i.test(text)) return 'not a SELECT or SHOW'
  if (/\bINTO\b/i.test(text)) return 'INTO (assignment or file write)'
  if (/\bFOR\s+UPDATE\b/i.test(text) || /\bLOCK\s+IN\s+SHARE\b/i.test(text)) return 'locking read'
  const f = BAD_FUNCTIONS.exec(text)
  if (f) return `function with side effects (${f[1].toUpperCase()})`
  return null
}

// The three statements the session setup needs, matched exactly.
const SETUP_ALLOWED = [
  /^SET SESSION TRANSACTION READ ONLY$/,
  /^START TRANSACTION READ ONLY$/,
  /^SET SESSION max_statement_time = \d{1,4}$/,
  /^ROLLBACK$/,
]

// ===========================================================================
// 2. A MINIMAL MYSQL CLIENT (text protocol), with an optional TLS upgrade.
// ===========================================================================

const CAP = { LONG_PASSWORD: 1, LONG_FLAG: 4, CONNECT_WITH_DB: 8, PROTOCOL_41: 0x200, SSL: 0x800, TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000, MULTI_RESULTS: 0x20000, PLUGIN_AUTH: 0x80000 }

export class SqlError extends Error {
  constructor(errno, message) { super(message); this.errno = errno; this.name = 'SqlError' }
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
function lenenc(b, pos) {
  const f = b[pos]
  if (f < 0xfb) return [f, pos + 1]
  if (f === 0xfc) return [b.readUInt16LE(pos + 1), pos + 3]
  if (f === 0xfd) return [b.readUIntLE(pos + 1, 3), pos + 4]
  return [Number(b.readBigUInt64LE(pos + 1)), pos + 9]
}

export class MySQL {
  constructor(opts) { this.o = opts; this.buf = Buffer.alloc(0); this.waiters = []; this.inbox = []; this.seq = 0; this.tls = false; this.tlsVerified = false }
  attach(sock) {
    this.sock = sock
    sock.setNoDelay?.(true)
    // A server that stops answering must not hold a one-shot job open for ever: 30 s to connect and sign in, then 120 s of
    // silence (the server itself cuts any statement at 60 s, see openReadOnlySession).
    sock.setTimeout?.(this.ready ? (this.o.idleMs ?? 120000) : (this.o.connectMs ?? 30000), () => sock.destroy(new Error('the server did not answer in time')))
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump() })
    sock.on('error', (e) => { const w = this.waiters.shift(); if (w) w.reject(e); else if (!this.ready) this.failConnect?.(e) })
    sock.on('close', () => { for (const w of this.waiters.splice(0)) w.reject(new Error('connection closed')) })
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.failConnect = reject
      const raw = this.o.socket ? connect(this.o.socket) : connect(this.o.port, this.o.host)
      this.raw = raw
      this.attach(raw)
      raw.once('connect', async () => {
        try { await this.handshake(); this.ready = true; this.sock.setTimeout?.(this.o.idleMs ?? 120000); resolve() } catch (e) { reject(e) }
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
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.pump() })
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
  // TLS upgrade, MySQL style: send a short SSLRequest in the clear, then wrap
  // the same socket. Encryption is always on once asked for; the certificate is
  // checked only when a CA file was supplied (a private network with a
  // self-signed server certificate is the normal case — the output says which).
  async upgradeTls() {
    const raw = this.sock
    raw.removeAllListeners('data'); raw.removeAllListeners('error'); raw.removeAllListeners('close')
    const name = this.o.tlsName || this.o.host
    const wanted = this.o.tlsCa
      ? { ca: this.o.tlsCa, rejectUnauthorized: true, ...(isIP(name) ? {} : { servername: name }), checkServerIdentity: (_h, cert) => checkServerIdentity(name, cert) }
      : { rejectUnauthorized: false }
    const secure = tlsConnect({ socket: raw, minVersion: 'TLSv1.2', ...wanted })
    await new Promise((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject) })
    this.tls = true
    this.tlsVerified = !!this.o.tlsCa && secure.authorized
    this.buf = Buffer.alloc(0)
    this.attach(secure)
  }
  async handshake() {
    const p = await this.packet()
    if (p[0] === 0xff) throw new Error(`server refused: ${p.subarray(9).toString().slice(0, 120)}`)
    if (p[0] !== 10) throw new Error(`unsupported protocol ${p[0]}`)
    let i = 1
    while (p[i] !== 0) i++
    this.serverVersion = p.subarray(1, i).toString()
    i++
    i += 4 // thread id
    const salt1 = p.subarray(i, i + 8); i += 8
    i++ // filler
    const capLow = p.readUInt16LE(i); i += 2
    i++ // charset
    i += 2 // status
    const capHigh = p.readUInt16LE(i); i += 2
    const serverCap = capLow | (capHigh << 16)
    const authLen = p[i]; i += 1
    i += 10 // reserved
    const salt2Len = Math.max(13, authLen - 8)
    let salt2 = p.subarray(i, i + salt2Len); i += salt2Len
    if (salt2[salt2.length - 1] === 0) salt2 = salt2.subarray(0, salt2.length - 1)
    let plugin = 'mysql_native_password'
    if (serverCap & CAP.PLUGIN_AUTH) { let j = i; while (j < p.length && p[j] !== 0) j++; plugin = p.subarray(i, j).toString() }
    const salt = Buffer.concat([salt1, salt2]).subarray(0, 20)
    let caps = CAP.LONG_PASSWORD | CAP.LONG_FLAG | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH
    if (this.o.database) caps |= CAP.CONNECT_WITH_DB
    if (plugin !== 'mysql_native_password') throw new Error(`auth plugin ${plugin} is not supported by this client (mysql_native_password only)`)
    let seq = 1
    if (this.o.tls) {
      if (!(serverCap & CAP.SSL)) throw new Error('--tls was asked for but the server does not offer TLS (have_ssl is not YES)')
      caps |= CAP.SSL
      this.send(Buffer.concat([u32(caps), u32(16 * 1024 * 1024), Buffer.from([45]), Buffer.alloc(23)]), seq++)
      await this.upgradeTls()
    }
    const auth = MySQL.scramble(this.o.password, salt)
    const resp = Buffer.concat([
      u32(caps), u32(16 * 1024 * 1024), Buffer.from([45]), Buffer.alloc(23),
      Buffer.from(this.o.user + '\0'), Buffer.from([auth.length]), auth,
      ...(this.o.database ? [Buffer.from(this.o.database + '\0')] : []),
      Buffer.from('mysql_native_password\0'),
    ])
    this.send(resp, seq)
    let r = await this.packet()
    if (r[0] === 0xfe) {
      let j = 1; while (r[j] !== 0) j++
      const name = r.subarray(1, j).toString()
      if (name !== 'mysql_native_password') throw new Error(`auth switch to ${name} is not supported`)
      const newSalt = r.subarray(j + 1, j + 21)
      this.send(MySQL.scramble(this.o.password, newSalt), this.seq)
      r = await this.packet()
    }
    if (r[0] === 0xff) throw new Error(`sign-in refused (${r.readUInt16LE(1)}): ${r.subarray(9).toString().slice(0, 120)}`)
    if (r[0] !== 0x00) throw new Error('unexpected handshake reply')
  }
  // Session setup only: exact statements from SETUP_ALLOWED.
  async setup(sql) {
    if (!SETUP_ALLOWED.some((re) => re.test(sql))) throw new Error(`setup statement refused: ${sql.slice(0, 40)}`)
    return this.wire(sql)
  }
  // Everything the checks send goes through the gate.
  async query(sql) {
    const why = gateReason(sql)
    if (why) throw new Error(`statement refused by the read-only gate (${why})`)
    return this.wire(sql)
  }
  // The raw wire call. Exposed only so the suite can prove the SERVER refuses a
  // write even if the gate were bypassed; nothing in this file calls it.
  async wire(sql) {
    this.send(Buffer.concat([Buffer.from([3]), Buffer.from(sql, 'utf8')]), 0)
    const first = await this.packet()
    if (first[0] === 0xff) throw new SqlError(first.readUInt16LE(1), first.subarray(9).toString().slice(0, 200))
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
      if (p[0] === 0xff) throw new SqlError(p.readUInt16LE(1), p.subarray(9).toString().slice(0, 200))
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

// Open a session that cannot write, or throw. Used by main() and by the suite.
export async function openReadOnlySession(cred) {
  const db = new MySQL(cred)
  await db.connect()
  await db.setup('SET SESSION TRANSACTION READ ONLY')
  await db.setup('START TRANSACTION READ ONLY')
  const ro = await db.query('SELECT @@session.tx_read_only')
  if (String(ro.rows[0]?.[0]) !== '1') {
    db.end()
    const e = new Error('the session is not read-only; stopping before any question is asked')
    e.notReadOnly = true
    throw e
  }
  await db.setup('SET SESSION max_statement_time = 60').catch(() => { /* MySQL, not MariaDB: no such variable */ })
  return db
}

// ===========================================================================
// 3. CREDENTIALS (same shapes as scripts/db-url-scan.mjs)
// ===========================================================================

function readFileTrim(p) { return readFileSync(p, 'utf8').replace(/\r?\n$/, '') }
export function phpArray(file) {
  const src = readFileSync(file, 'utf8')
  const get = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")\\s*[,\\]]`))
    if (!m) return undefined
    return (m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1')
  }
  // The VPS keeps db_name/db_user/db_pass as files and reads them with an expression such as
  //   trim((string)@file_get_contents('/run/secrets/...'))   — any wrapper, cast or @ is accepted.
  const getFile = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>[^\\n]*?file_get_contents\\(\\s*['"]([^'"]+)['"]`))
    return m ? readFileTrim(m[1]) : undefined
  }
  const v = {}
  for (const k of ['db_host', 'db_name', 'db_user', 'db_pass']) v[k] = get(k) ?? getFile(k)
  return v
}
function envOrFile(env, name) {
  if (env[name] !== undefined && env[name] !== '') return env[name]
  const f = env[`${name}_FILE`]
  return f ? readFileTrim(f) : undefined
}
export function credentials(opts, env = process.env) {
  const cfgFile = opts.config ?? env.SPORTA_API_CONFIG_FILE
  let host, port, socket, user, password, database
  let source = 'env'
  if (cfgFile) {
    const c = phpArray(cfgFile)
    host = c.db_host; user = c.db_user; password = c.db_pass; database = c.db_name
    source = 'config'
  }
  host ??= opts.host ?? envOrFile(env, 'DB_HOST'); user ??= opts.user ?? envOrFile(env, 'DB_USER')
  password ??= envOrFile(env, 'DB_PASSWORD') ?? envOrFile(env, 'DB_PASS')
  database ??= opts.database ?? envOrFile(env, 'DB_NAME')
  socket = opts.socket ?? envOrFile(env, 'DB_SOCKET'); port = opts.port ?? envOrFile(env, 'DB_PORT')
  if (host && host.includes(';')) {
    const [h, ...rest] = host.split(';'); host = h
    for (const kv of rest) { const [k, v] = kv.split('='); if (k === 'port') port ??= v; if (k === 'unix_socket') socket ??= v }
  }
  if (!user) return { error: 'no credentials (need --config <php file>, SPORTA_API_CONFIG_FILE, or DB_HOST/DB_USER/DB_PASSWORD[/DB_NAME]).' }
  return { host: host || '127.0.0.1', port: Number(port || 3306), socket, user, password: password ?? '', database: database || '', source }
}

// ===========================================================================
// 4. PURE HELPERS (exported so the suite can test them without a server)
// ===========================================================================

export const q = (s) => '`' + String(s).replace(/`/g, '``') + '`'
export const sqlStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '') + "'"
const SYSTEM_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys']
const NOT_SYSTEM = `(${SYSTEM_SCHEMAS.map(sqlStr).join(',')})`
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const trunc = (s, n = 200) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))

// --- SHOW GRANTS text -> structure. The text may carry a password hash; only
// the privilege list, the object and WITH GRANT OPTION are kept.
const OBJ = '(?:`(?:[^`]|``)*`|\\*)(?:\\.(?:`(?:[^`]|``)*`|\\*))?'
const GRANT_RE = new RegExp(`^GRANT\\s+([\\s\\S]+?)\\s+ON\\s+(?:(PROCEDURE|FUNCTION|PACKAGE BODY|PACKAGE)\\s+)?(${OBJ})\\s+TO\\s`, 'i')
function splitTop(s) {
  const out = []; let depth = 0; let cur = ''
  for (const c of s) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
function unq(s) { return s.startsWith('`') ? s.slice(1, -1).replace(/``/g, '`') : s }
export function parseGrant(line) {
  const text = String(line)
  if (/^GRANT\s+PROXY\s+ON\s/i.test(text)) return { kind: 'proxy', privs: new Set(['PROXY']), all: false, scope: 'global', schema: null, grantOption: /\bWITH\s+GRANT\s+OPTION\b/i.test(text) }
  const m = GRANT_RE.exec(text)
  if (!m) {
    // "GRANT `r1`, `r2` TO `user`@`host`": the privileges are the ROLES', which SHOW GRANTS FOR <user> does not
    // list. Keep the role names so the caller can read them (expandRoles); a role is a way to hold ALL PRIVILEGES.
    const rl = /^GRANT\s+((?:`(?:[^`]|``)*`\s*,?\s*)+)\s+TO\s/i.exec(text)
    if (rl) return { kind: 'role', roles: [...rl[1].matchAll(/`((?:[^`]|``)*)`/g)].map((x) => x[1].replace(/``/g, '`')), privs: new Set(), all: false, scope: 'role', schema: null, grantOption: false }
    if (/^GRANT\s+`/.test(text)) return { kind: 'role', roles: [], privs: new Set(), all: false, scope: 'role', schema: null, grantOption: false }
    return null
  }
  const privs = new Set(); let all = false
  for (const p of splitTop(m[1])) {
    const name = p.replace(/\s*\([\s\S]*\)\s*$/, '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (name === 'ALL PRIVILEGES' || name === 'ALL') all = true
    else if (name) privs.add(name)
  }
  const parts = m[3].match(/`(?:[^`]|``)*`|\*/g) ?? []
  let scope = 'global', schema = null
  if (m[2]) { scope = 'routine'; schema = unq(parts[0] ?? '*') }
  else if (parts.length === 2 && parts[0] === '*' && parts[1] === '*') scope = 'global'
  else if (parts.length === 2 && parts[1] === '*') { scope = 'schema'; schema = unq(parts[0]) }
  else if (parts.length === 2) { scope = 'table'; schema = unq(parts[0]) }
  else { scope = 'schema'; schema = null }
  const tail = text.slice(m[0].length).replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
  const grantOption = /\bWITH\s+(?:[A-Z_]+\s+\d+\s+)*GRANT\s+OPTION\b/i.test(tail)
  return { kind: 'priv', privs, all, scope, schema, grantOption }
}
export function parseGrants(lines) { return lines.map(parseGrant).filter(Boolean) }

// A GRANT schema name may carry LIKE wildcards: _ and % (escaped as \_ \%).
export function schemaMatches(pattern, name) {
  if (pattern === null || pattern === undefined) return false
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    if (c === '%') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i').test(name)
}
// Does this account hold `priv` globally, or on `schema` (when given)?
export function holds(grants, priv, schema) {
  const P = priv.toUpperCase()
  for (const g of grants) {
    if (g.kind !== 'priv') continue
    if (g.scope === 'global' && (g.all || g.privs.has(P))) return true
    if (schema && g.scope === 'schema' && schemaMatches(g.schema, schema) && (g.all || g.privs.has(P))) return true
  }
  return false
}
export function holdsGrantOption(grants, schema) {
  return grants.some((g) => g.kind === 'priv' && g.grantOption && (g.scope === 'global' || (schema ? schemaMatches(g.schema, schema) : g.scope === 'schema')))
}
// REPLICATION SLAVE reads the whole binary log (every changed row); BINLOG REPLAY replays arbitrary events (a write);
// READ_ONLY ADMIN and the two REPLICATION ... ADMIN rights change how the server treats data.
export const DANGEROUS_GLOBAL = ['SUPER', 'FILE', 'PROCESS', 'SHUTDOWN', 'CREATE USER', 'RELOAD', 'SET USER', 'BINLOG ADMIN', 'FEDERATED ADMIN', 'CONNECTION ADMIN',
  'REPLICATION SLAVE', 'REPLICATION MASTER ADMIN', 'REPLICATION SLAVE ADMIN', 'BINLOG REPLAY', 'READ_ONLY ADMIN']
export const DML_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
export const DDL_PRIVS = ['CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER', 'EVENT', 'CREATE VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'LOCK TABLES']
export function globalDanger(grants) {
  const out = new Set()
  for (const g of grants) {
    if (g.kind !== 'priv') continue
    if (g.scope === 'global') {
      if (g.all) return { all: true, privs: ['ALL PRIVILEGES'], grantOption: true }
      for (const p of DANGEROUS_GLOBAL) if (g.privs.has(p)) out.add(p)
      if (g.grantOption) out.add('GRANT OPTION')
    } else if (g.grantOption) out.add(`GRANT OPTION on ${g.scope === 'schema' ? q(g.schema ?? '*') : g.scope}`)
  }
  return { all: false, privs: [...out], grantOption: out.has('GRANT OPTION') }
}
// Reach beyond the shop schema. DML on EVERY schema (`ON *.*`) includes `mysql`; DML on `mysql` itself is the account
// tables: UPDATE or INSERT there is GRANT in disguise, SELECT there reads every password hash. (ALL ON *.* is
// globalDanger's; ALL on one ordinary schema is the app's own and acct.app_ddl's business.)
export function broadReach(grants) {
  const out = new Set()
  for (const g of grants) {
    if (g.kind !== 'priv') continue
    if (g.scope === 'global') { if (!g.all) for (const p of DML_PRIVS) if (g.privs.has(p)) out.add(`${p} on every schema`) }
    else if ((g.scope === 'schema' || g.scope === 'table') && g.schema !== null && schemaMatches(g.schema, 'mysql')) {
      if (g.all) out.add('ALL PRIVILEGES on mysql')
      else for (const p of DML_PRIVS) if (g.privs.has(p)) out.add(`${p} on mysql`)
    }
  }
  return [...out]
}
export function ddlPrivs(grants, schema) {
  const out = new Set()
  for (const g of grants) {
    if (g.kind !== 'priv') continue
    const applies = g.scope === 'global' || ((g.scope === 'schema' || g.scope === 'table') && (!schema || schemaMatches(g.schema, schema)))
    if (!applies) continue
    if (g.all) { out.add('ALL PRIVILEGES'); continue }
    for (const p of DDL_PRIVS) if (g.privs.has(p)) out.add(p)
  }
  return [...out]
}
export function isAdminClass(grants) {
  return grants.some((g) => g.kind === 'priv' && g.scope === 'global' && (g.all || g.privs.has('SUPER')))
}

// --- Hosts
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])
// "IP/mask" hosts (172.18.0.0/255.255.0.0, or a bare prefix length): how many leading bits the mask fixes. A mask of 0
// bits (0.0.0.0/0.0.0.0) matches EVERY address; a mask looser than the block its base address belongs to (10.0.0.0/0.0.0.0,
// 172.16.0.0/255.0.0.0) reaches beyond the private range. null = no mask, or one this tool cannot read.
export function maskBits(host) {
  const i = String(host ?? '').indexOf('/')
  if (i < 0) return null
  const m = String(host).slice(i + 1).trim()
  if (/^\d{1,2}$/.test(m)) return Number(m) <= 32 ? Number(m) : null
  const q4 = m.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!q4) return null
  let n = 0
  for (const o of q4.slice(1).map(Number)) { if (o > 255) return null; n = (n * 256) + o }
  const bits = n.toString(2).padStart(32, '0')
  return /^1*0*$/.test(bits) ? (bits.match(/1/g) ?? []).length : null // non-contiguous masks are unreadable, not "narrow"
}
const PRIVATE_FLOOR = [[/^10\./, 8], [/^172\.(1[6-9]|2\d|3[01])\./, 12], [/^192\.168\./, 16], [/^169\.254\./, 16]]
export function hostScope(host, serverHostname = '') {
  const h = String(host ?? '').trim().toLowerCase()
  if (LOOPBACK.has(h) || /^127\./.test(h) || (serverHostname && h === serverHostname.toLowerCase())) {
    const lb = maskBits(h)
    return lb !== null && lb < 8 ? (lb === 0 ? 'any' : 'public') : 'local'
  }
  if (h === '' || /^[%_.\s]*$/.test(h)) return 'any'
  const ip = h.split('/')[0]
  if (h.includes('/')) {
    const bits = maskBits(h)
    if (bits === 0) return 'any'
    if (bits === null) return 'public' // a netmask we cannot read: do not call it private
    const floor = PRIVATE_FLOOR.find(([re]) => re.test(ip))
    if (!floor || bits < floor[1]) return /^[0-9.%_]+$/.test(ip) ? 'public' : 'named'
  }
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip) || /^fd[0-9a-f]{2}:/.test(ip) || /^fe80:/.test(ip)) return 'private'
  if (/^[0-9.%_/]+$/.test(h)) return 'public'
  return 'named'
}
export const reachableFromNetwork = (host, serverHostname) => hostScope(host, serverHostname) !== 'local'

// A processlist HOST value ("203.0.113.9:51234", "localhost") -> its class.
export function clientAddressClass(hostField) {
  let h = String(hostField ?? '').trim().toLowerCase()
  if (h === '' || h === 'localhost') return 'socket'
  h = h.replace(/^\[(.*)\](:\d+)?$/, '$1').replace(/:\d+$/, '')
  h = h.replace(/^::ffff:/, '')
  if (/^127\./.test(h) || h === '::1') return 'loopback'
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'private'
    return 'public'
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return 'private'
  if (h.includes(':')) return 'public'
  return 'named'
}
export const maskIp = (hostField) => String(hostField).replace(/:\d+$/, '').replace(/^(\d+\.\d+\.\d+)\.\d+$/, '$1.x')

// --- Version and end of life -------------------------------------------------
// Dates are the vendor's published end of community support for each series.
// `verify` marks a date this table could not confirm offline. The table has a
// "checked" date; an old table is reported rather than trusted.
export const EOL_TABLE = {
  checked: '2026-11-04',
  mariadb: {
    '10.3': { eol: '2023-05-25' }, '10.4': { eol: '2024-06-18' }, '10.5': { eol: '2025-06-24' },
    '10.6': { eol: '2026-07-06' }, '10.11': { eol: '2028-02-16' },
    '11.0': { eol: '2024-06-07' }, '11.1': { eol: '2024-08-21' }, '11.2': { eol: '2024-11-21' }, '11.3': { eol: '2024-05-10' },
    '11.4': { eol: '2029-05-29' }, '11.5': { eol: '2025-02-01', approx: true }, '11.6': { eol: '2025-05-01', approx: true }, '11.7': { eol: '2025-11-01', approx: true },
    '11.8': { eol: '2028-06-04', verify: true },
  },
  mysql: { '5.7': { eol: '2023-10-31' }, '8.0': { eol: '2026-04-30' }, '8.4': { eol: '2032-04-30' } },
}
export function parseVersion(raw) {
  const m = String(raw ?? '').match(/^(?:5\.5\.5-)?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { raw: String(raw), major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), series: `${m[1]}.${m[2]}`, flavour: /mariadb/i.test(raw) ? 'mariadb' : 'mysql' }
}
export function versionSupport(raw, now = new Date(), warnDays = 90) {
  const v = parseVersion(raw)
  if (!v) return { status: 'UNKNOWN', reason: 'the version string was not recognised' }
  const entry = EOL_TABLE[v.flavour][v.series]
  const tableAgeDays = (now - new Date(EOL_TABLE.checked + 'T00:00:00Z')) / 864e5
  if (!entry) {
    const newest = Math.max(...Object.keys(EOL_TABLE[v.flavour]).map((s) => Number(s.split('.')[0])))
    if (v.major > newest) return { status: 'UNKNOWN', reason: `series ${v.series} is newer than this tool's end-of-life table (checked ${EOL_TABLE.checked}); read the vendor's maintenance policy`, v }
    return { status: 'FAIL', detail: `${v.flavour === 'mariadb' ? 'MariaDB' : 'MySQL'} ${v.series} is not in the supported list in this tool's table (all series it knows are listed with their end-of-life date); treat as out of support`, v }
  }
  const days = Math.floor((new Date(entry.eol + 'T00:00:00Z') - now) / 864e5)
  const stale = tableAgeDays > 400 ? ` (this tool's table is ${Math.floor(tableAgeDays)} days old: re-check the date)` : ''
  const verify = entry.verify ? ' (date not confirmed offline: re-check at mariadb.org/about/#maintenance-policy)' : ''
  if (days < 0) return { status: 'FAIL', detail: `${v.raw} is out of support: series ${v.series} ended ${entry.approx ? 'around ' + entry.eol.slice(0, 7) : entry.eol + ' (' + (-days) + ' days ago)'}${stale}`, v, entry }
  if (days <= warnDays) return { status: 'FAIL', detail: `series ${v.series} support ends ${entry.eol} (${days} days)${stale}`, v, entry }
  return { status: 'PASS', detail: `${v.raw}: series ${v.series} is supported until ${entry.eol} (${days} days)${verify}${stale}`, v, entry }
}

// --- Card-like numbers (Luhn)
export function luhn(digits) {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d; alt = !alt
  }
  return sum % 10 === 0
}
const CARD_RUN = /(?<![0-9])[3-6][0-9](?:[ \u00a0.-]?[0-9]){11,17}(?![0-9])/g
// Arabic-Indic (U+0660-0669), Eastern Arabic-Indic (U+06F0-06F9) and full-width (U+FF10-FF19) digits read as digits:
// a customer in Kuwait writes a card number in the digits of their keyboard.
export const toAsciiDigits = (text) => String(text).replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, (c) => String(c.charCodeAt(0) & 0xf))
// How many card-like (Luhn-valid, 13-19 digit, major-industry digit 3-6) runs
// are in a text. Count only: the digits are never returned.
export function cardLikeCount(text) {
  let n = 0
  for (const m of toAsciiDigits(text).matchAll(CARD_RUN)) {
    const d = m[0].replace(/[^0-9]/g, '')
    if (d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d)) n++
  }
  return n
}

// --- Credential-shaped columns: what do the values look like? (shape only)
export const CRED_NAME = /(pass(word|wd)?|pwd|secret|token|otp|recover|totp|(^|_)hash$|(^|_)digest$|api[_-]?key|private[_-]?key|session|salt|signature|credential|passkey|webauthn|p256dh|auth_secret)/i
export function credentialKind(column) {
  const c = String(column).toLowerCase()
  if (/pass(word|wd)|pwd/.test(c)) return 'password'
  if (/(^|_)(hash|digest)$/.test(c)) return 'hash'
  if (/totp|secret|api[_-]?key|private[_-]?key|p256dh|auth_secret|salt/.test(c)) return 'recoverable'
  if (/token|session|otp|recover|passkey|webauthn|credential|signature/.test(c)) return 'token'
  return null
}
const ENC_PREFIX = /^(enc|aes|sodium|v[0-9]+)[:$]/i
// Aggregate counts from the server -> a verdict about how the values are kept.
export function classifyCredential(kind, s) {
  const filled = s.n - s.empty
  if (filled <= 0) return { verdict: 'EMPTY', note: 'no values stored' }
  const strong = s.bcrypt + s.argon + s.cryptsha
  const digest = s.hex64 + s.hex40 + s.hex32 + s.native
  const hashed = strong + digest
  const encrypted = s.encrypted ?? 0
  if (kind === 'password') {
    if (strong === filled) return { verdict: 'OK', note: 'all values are salted password hashes' }
    if (hashed === filled) return { verdict: 'WEAK', note: `${digest} of ${filled} values are fast unsalted digests, not password hashes` }
    return { verdict: 'PLAIN', note: `${filled - hashed} of ${filled} values do not look hashed` }
  }
  if (kind === 'hash') {
    if (hashed === filled) return { verdict: 'OK', note: 'all values look like digests' }
    return { verdict: 'PLAIN', note: `${filled - hashed} of ${filled} values do not look like a digest` }
  }
  if (kind === 'recoverable') {
    if (encrypted === filled) return { verdict: 'OK', note: 'all values carry an encryption prefix' }
    if (s.base32 > 0) return { verdict: 'CLEAR', note: `${s.base32} of ${filled} values are base32 secrets in clear (a TOTP seed)` }
    return { verdict: 'CLEAR', note: `${filled - encrypted} of ${filled} values have no encryption prefix` }
  }
  // token / session: the column NAME says it is the token itself.
  return { verdict: 'RAW', note: `${filled} values stored under a name that says it is the token itself (a hash belongs in a *_hash column)` }
}

// ===========================================================================
// 5. THE FIX TABLE — what each FAIL means and the command that fixes it.
//    (--fixes-md prints it; ops/db/AUDIT-FIXES.md is that output, and the
//    suite fails if the two drift.)
// ===========================================================================

const DB_JOB = 'a one-shot job as an administrative account (never the web account)'
export const FIXES = {
  'acct.anonymous': { sev: 'high', means: 'Anyone can connect without a user name; MariaDB then applies the anonymous account\'s rights.', fix: ["DROP USER IF EXISTS ''@'localhost';", "DROP USER IF EXISTS ''@'%';"], where: DB_JOB + '; ops/db/hygiene.sql section 1 does this' },
  'acct.empty_password': { sev: 'high', means: 'An account that can be signed in to with no password.', fix: ["ALTER USER 'NAME'@'HOST' IDENTIFIED BY '<new secret, read from a file by the job>';", "-- or, if nothing uses it: DROP USER 'NAME'@'HOST';"], where: DB_JOB + '; a new password goes in a root-only file, never in chat' },
  'acct.wildcard_host': { sev: 'medium', means: "An account that accepts connections from any address ('%'), from a public range, or from a netmask range wider than a private block (0.0.0.0/0.0.0.0 is every address), so only the network keeps it private.", fix: ["RENAME USER 'NAME'@'%' TO 'NAME'@'172.18.0.%';  -- use the subnet the host job prints for the database network"], where: DB_JOB + '; ops/db/grants.sql creates the narrow per-actor accounts (private host, connection limits) and ops/db/retire-old-account.sql then locks the old broad one' },
  'acct.root_network': { sev: 'high', means: 'An administrative account (ALL PRIVILEGES or SUPER) can log in from the network, not only from the server itself.', fix: ["DROP USER IF EXISTS 'root'@'%';  -- first confirm root@localhost works: docker exec <db container> mariadb -uroot -e 'select 1'"], where: DB_JOB + '; ops/db/drop-root-remote.sql (read its preconditions first)' },
  'acct.powerful_privs': { sev: 'high', means: 'A non-administrative account holds SUPER, FILE, PROCESS, SHUTDOWN, RELOAD, CREATE USER, REPLICATION SLAVE or GRANT OPTION, reads or writes EVERY schema (SELECT/INSERT/UPDATE/DELETE ON *.*), touches the mysql account tables, or holds any of this through a ROLE: a stolen web password could read server files, see other queries, copy the binary log, or mint new accounts.', fix: ["REVOKE SUPER, FILE, PROCESS, SHUTDOWN, RELOAD, CREATE USER, REPLICATION SLAVE ON *.* FROM 'NAME'@'HOST';", "REVOKE GRANT OPTION ON *.* FROM 'NAME'@'HOST';", "REVOKE SELECT, INSERT, UPDATE, DELETE ON *.* FROM 'NAME'@'HOST';  -- and ... ON mysql.* if the FAIL says 'on mysql'", "REVOKE `ROLE` FROM 'NAME'@'HOST';  -- when the FAIL comes through a role (the role's own rights: SHOW GRANTS FOR `ROLE`)"], where: DB_JOB + '; ops/db/grants.sql creates the narrow per-actor accounts (private host, connection limits) and ops/db/retire-old-account.sql then locks the old broad one' },
  'acct.app_ddl': { sev: 'medium', means: 'The web account can CREATE, ALTER or DROP tables; one SQL-injection bug then deletes the shop. The PHP never changes the schema at runtime.', fix: ["REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'NAME'@'HOST';", "GRANT SELECT, INSERT, UPDATE, DELETE ON sporta.* TO 'NAME'@'HOST';  -- exact set: the least-privilege lane's list in ops/db; run migrations as an admin job"], where: DB_JOB + '; ops/db/grants.sql creates the narrow per-actor accounts (private host, connection limits) and ops/db/retire-old-account.sql then locks the old broad one' },
  'acct.unused': { sev: 'low', means: 'An account with no rights to anything, or rights on a schema that no longer exists. (MariaDB records no last-login time; this finds accounts with nothing to use.)', fix: ["DROP USER 'NAME'@'HOST';"], where: DB_JOB + '; ops/db/grants.sql creates the narrow per-actor accounts (private host, connection limits) and ops/db/retire-old-account.sql then locks the old broad one' },
  'acct.password_age': { sev: 'low', means: 'A password not changed within the limit (default 365 days).', fix: ["ALTER USER 'NAME'@'HOST' IDENTIFIED BY '<new secret from a file>';  -- then update the secret file the application reads"], where: DB_JOB + '; rotate the web account together with its secret file' },
  'srv.skip_grant_tables': { sev: 'high', means: 'The server skips the permission system: every client is an administrator.', fix: ['Remove --skip-grant-tables from the database service command (or my.cnf) and restart the database container.'], where: 'the database service definition' },
  'srv.network_exposure': { sev: 'high', means: 'The database listens beyond the loopback interface, or a client is connected from a public address. Inside Docker it must listen on the container network, so the real test is on the host: 3306 must not be published.', fix: ['Run the host job (ops/db/host-audit.compose.json) and confirm no port 3306 mapping.', 'If published: remove the "ports:" entry for 3306 from the database service and re-create it.'], where: 'the database service definition + the host job' },
  'srv.public_clients': { sev: 'high', means: 'The server sees (or saw) a client connecting from a public IP address.', fix: ['Find the source with the host job; remove any published 3306 port; DROP/RENAME the account it used to a private subnet host.'], where: 'host job + ' + DB_JOB },
  'srv.skip_name_resolve': { sev: 'low', means: 'Account host names are matched by DNS: slower, and a poisoned reverse lookup can change who matches which account.', fix: ['Add skip-name-resolve under [mysqld] and restart. (Accounts must use IP/subnet hosts, not names.)'], where: 'my.cnf, restart' },
  'srv.local_infile': { sev: 'medium', means: 'LOAD DATA LOCAL INFILE is allowed: a malicious server or an injected statement can pull files from the client side.', fix: ['SET GLOBAL local_infile = 0;', 'Persist: local-infile=0 under [mysqld].'], where: DB_JOB + ' + my.cnf; ops/db/hygiene.sql section 3' },
  'srv.secure_file_priv': { sev: 'medium', means: 'SELECT ... INTO OUTFILE and LOAD_FILE are not confined to a directory, so FILE privilege reaches anywhere the server can write.', fix: ['Set secure-file-priv=/var/lib/mysql-files under [mysqld] and mount an EMPTY, read-only directory there (MariaDB refuses a path that does not exist, and has no NULL value); restart.'], where: 'my.cnf, restart' },
  'srv.sql_strict': { sev: 'medium', means: 'Non-strict SQL mode silently truncates over-long values and coerces bad input instead of refusing it (the PHP does not set its own mode).', fix: ["SET GLOBAL sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';", 'Persist: sql_mode=... under [mysqld].'], where: DB_JOB + ' + my.cnf; takes effect for new connections' },
  'srv.sql_zero_date': { sev: 'low', means: 'Zero dates (0000-00-00) are accepted, which hides bad input.', fix: ["Add NO_ZERO_DATE,NO_ZERO_IN_DATE to sql_mode (see srv.sql_strict)."], where: 'same change as srv.sql_strict' },
  'srv.sql_div_zero': { sev: 'low', means: 'Division by zero returns NULL instead of an error.', fix: ['Add ERROR_FOR_DIVISION_BY_ZERO to sql_mode (see srv.sql_strict).'], where: 'same change as srv.sql_strict' },
  'srv.sql_group_by': { sev: 'low', means: 'ONLY_FULL_GROUP_BY is off, so ambiguous GROUP BY queries run and return arbitrary values. Turning it on can break a query: run the suites on a copy first (the eleven GROUP BY queries in dropin/php-store read as compliant).', fix: ['Add ONLY_FULL_GROUP_BY to sql_mode after the native suite passes against it.'], where: 'same change as srv.sql_strict, last' },
  'srv.event_scheduler': { sev: 'low', means: 'Scheduled events run with their definer\'s rights and are a place to hide persistence; the shop uses none (host cron does the jobs).', fix: ['SET GLOBAL event_scheduler = OFF;', 'Persist: event_scheduler=OFF under [mysqld].'], where: DB_JOB + ' + my.cnf' },
  'srv.password_policy': { sev: 'low', means: 'No password-strength plugin is active, so a weak database password is accepted.', fix: ["INSTALL SONAME 'simple_password_check';", 'SET GLOBAL simple_password_check_minimal_length = 24;', 'Persist: plugin_load_add=simple_password_check under [mysqld].'], where: DB_JOB + ' + my.cnf; ops/db/hygiene.sql section 4' },
  'srv.audit_log': { sev: 'low', means: 'Logins are not recorded, so a brute-force or a stolen-password login leaves no trace on the database side.', fix: ["INSTALL SONAME 'server_audit';", "SET GLOBAL server_audit_events = 'CONNECT';", 'SET GLOBAL server_audit_logging = ON;  -- plus server_audit_file_rotate_size / _rotations so it cannot fill the disk'], where: DB_JOB + ' + my.cnf' },
  'srv.symlinks': { sev: 'low', means: 'Symbolic links inside the data directory are followed.', fix: ['Add skip-symbolic-links under [mysqld]; restart.'], where: 'my.cnf, restart' },
  'srv.version_support': { sev: 'medium', means: 'The server series is out of support (or about to be): no more security fixes.', fix: ['Plan a major upgrade: dump (D3 lane backups), pull the newer image, restore on a copy, run the suites, switch. Within a series, pull the latest patch release.'], where: 'the database service definition' },
  'tls.available': { sev: 'medium', means: 'The server has no TLS configured: everything between the shop and the database (orders, names, phones) crosses the network in clear.', fix: ['Create a certificate, key and CA, mount them read-only at /etc/mysql/tls/ (key 0400, owned by the database user), THEN add ops/db/sporta-db-tls.cnf (ssl_cert / ssl_key / ssl_ca) and restart.', 'Never the other way round: a server told to use a certificate file that is missing refuses to start (measured), and the shop is down. Rehearse on a throwaway container first.'], where: 'my.cnf + secret files, restart' },
  'tls.require_secure_transport': { sev: 'medium', means: 'TCP clients may connect without TLS.', fix: ['Set require_secure_transport=ON ONLY AFTER the PHP connects with TLS (PDO ssl options). The current PHP does not, so enabling it first takes the shop down; see ops/db notes.'], where: 'my.cnf, restart; needs a PHP change first' },
  'tls.versions': { sev: 'medium', means: 'TLS 1.0/1.1 are allowed.', fix: ['Set tls_version=TLSv1.2,TLSv1.3 under [mysqld]; restart.'], where: 'my.cnf, restart' },
  'tls.cert_expiry': { sev: 'medium', means: 'The server certificate has expired or expires within 30 days.', fix: ['Issue a new certificate, replace the files, restart (or FLUSH SSL on 10.4+).'], where: 'secret files + restart' },
  'log.general': { sev: 'high', means: 'The general query log is on: every statement, with every customer name, phone and address in it, is written to disk (or to a table).', fix: ['SET GLOBAL general_log = 0;', 'Persist: general_log=0 under [mysqld]; delete the old log file after reading it.'], where: DB_JOB + ' + my.cnf' },
  'log.slow': { sev: 'low', means: 'The slow log is on; it stores statement text with literal values for slow queries.', fix: ['SET GLOBAL slow_query_log = 0;  -- or keep it only while tuning, in a 0700 directory'], where: DB_JOB },
  'log.binlog_pitr': { sev: 'low', means: 'No binary log: the best recovery is the last dump, everything since is lost. (Owner decision: with a handful of orders a nightly dump may be enough.)', fix: ['Add log-bin=sporta-bin, binlog_format=ROW, binlog_expire_logs_seconds=1209600 under [mysqld]; restart. Pair with the backup lane\'s dump.', 'Or pass --accept log.binlog_pitr to record that you decided against it.'], where: 'my.cnf, restart; decide with the backup lane' },
  'log.binlog_retention': { sev: 'medium', means: 'Binary logs are kept without a limit (or longer than 30 days). They contain every changed row, personal data included, and fill the disk.', fix: ['SET GLOBAL binlog_expire_logs_seconds = 1209600;', "PURGE BINARY LOGS BEFORE NOW() - INTERVAL 14 DAY;"], where: DB_JOB + ' + my.cnf' },
  'lim.user_connections': { sev: 'low', means: 'No per-account connection limit: one flooded account can use every connection slot and starve the admin.', fix: ["ALTER USER 'NAME'@'HOST' WITH MAX_USER_CONNECTIONS 60;  -- or SET GLOBAL max_user_connections = 60;"], where: DB_JOB + '; the accounts in ops/db/grants.sql carry their own limits' },
  'lim.statement_time': { sev: 'low', means: 'No statement timeout: one runaway or injected query can pin the CPU.', fix: ['SET GLOBAL max_statement_time = 60;  -- the shop\'s longest wait is a 10 s advisory lock'], where: DB_JOB + ' + my.cnf' },
  'lim.wait_timeout': { sev: 'low', means: 'Idle connections are kept for 8 hours, holding slots.', fix: ['SET GLOBAL wait_timeout = 600;'], where: DB_JOB + ' + my.cnf' },
  'lim.connections': { sev: 'low', means: 'max_connections is far above what a small shop needs; a flood allocates memory per connection.', fix: ['SET GLOBAL max_connections = 200;'], where: DB_JOB + ' + my.cnf' },
  'lim.packet': { sev: 'low', means: 'max_allowed_packet is above 64 MiB; one request can make the server allocate that much.', fix: ['SET GLOBAL max_allowed_packet = 33554432;  -- hero photographs are the largest rows'], where: DB_JOB + ' + my.cnf' },
  'cs.server_defaults': { sev: 'low', means: 'New tables created without an explicit character set become latin1 (or another non-utf8mb4 set) and mangle Arabic.', fix: ['Set character-set-server=utf8mb4 and collation-server=utf8mb4_unicode_ci under [mysqld]; restart.'], where: 'my.cnf, restart' },
  'cs.database_default': { sev: 'low', means: 'The shop database\'s default character set is not utf8mb4.', fix: ['ALTER DATABASE sporta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'], where: DB_JOB },
  'cs.columns': { sev: 'medium', means: 'Columns that are not utf8mb4 cannot hold Arabic or emoji: values are mangled or cut at the first 4-byte character, and mixed character sets enable comparison tricks.', fix: ['ALTER TABLE `TABLE` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;  -- back up first; text already stored as ? stays ?'], where: DB_JOB },
  'cs.collation_mix': { sev: 'low', means: 'More than one collation in the shop schema: joins can fail with "illegal mix of collations" and comparisons behave differently per table.', fix: ['ALTER TABLE `TABLE` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;  -- for each table listed'], where: DB_JOB },
  'sch.engine': { sev: 'medium', means: 'A table is not InnoDB: no transactions, no foreign keys, and it can be corrupted by a crash.', fix: ['ALTER TABLE `TABLE` ENGINE=InnoDB;'], where: DB_JOB },
  'sch.primary_key': { sev: 'low', means: 'A table without a primary key cannot be safely replicated, de-duplicated or repaired row by row.', fix: ['ALTER TABLE `TABLE` ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;  -- or archive and drop it if nothing reads it'], where: DB_JOB },
  'sch.foreign_keys': { sev: 'low', means: 'foreign_key_checks is OFF globally, so the database stops enforcing the links between orders, items and accounts.', fix: ['SET GLOBAL foreign_key_checks = 1;', 'Persist: remove foreign_key_checks=0 from the server config.'], where: DB_JOB + ' + my.cnf' },
  'sch.definers': { sev: 'medium', means: 'A trigger, event, routine or view runs with the rights of a powerful account (or one that no longer exists): whoever can change or reach it borrows those rights.', fix: ['SHOW CREATE <TRIGGER|VIEW|EVENT|PROCEDURE> name;  then recreate it with DEFINER = a low-privilege account (SQL SECURITY INVOKER for views).'], where: DB_JOB },
  'sch.backup_copies': { sev: 'low', means: 'Tables that look like copies, backups or leftovers of an old build sit in the live schema. They hold the same personal data as the real ones and nothing reads them.', fix: ['Export them first (D3 lane dump), then: DROP TABLE `TABLE`;'], where: DB_JOB + '; the data scan says "do not drop" the old-build tables until the live storefront\'s source is found' },
  'sch.other_databases': { sev: 'medium', means: 'Other databases (especially test / test_*) are visible to this account; the stock "test" database is writable by everyone.', fix: ['DROP DATABASE IF EXISTS test;', "DELETE nothing by hand: also DROP USER ''@'%'; (see acct.anonymous) and REVOKE any grant on test\\_%."], where: DB_JOB + '; ops/db/hygiene.sql section 2 drops test' },
  'sec.password_hashes': { sev: 'high', means: 'A password column holds values that are not salted password hashes (plaintext, or a fast digest that can be cracked offline).', fix: ['The PHP uses password_hash(); re-hash on next sign-in (password_needs_rehash) or force a reset. Never read the values to "fix" them.'], where: 'application change' },
  'sec.token_storage': { sev: 'medium', means: 'A session/token/OTP column stores the value itself, so a database read (backup, SQL injection) yields live sign-ins.', fix: ['Store sha256(token) in a token_hash column and compare hashes; invalidate the existing tokens.'], where: 'application change (PHP patch), then delete old rows' },
  'sec.hash_columns': { sev: 'low', means: 'A column named like a hash holds values that do not look like one.', fix: ['Check the column; if it is plaintext, rename and hash it as above.'], where: 'application change' },
  'sec.recoverable_secrets': { sev: 'medium', means: 'A secret the server must be able to read back (an authenticator seed) is stored in clear in the database, so anyone with a database copy can generate valid codes.', fix: ["Encrypt it with a key kept outside the database (PHP: sodium secretbox, key in the private config) and store 'enc:v1:...'; this check passes when every value carries that prefix.", 'Or pass --accept sec.recoverable_secrets to record the decision to live with it.'], where: 'application change (PHP patch)' },
  'sec.secrets_in_text': { sev: 'high', means: 'A text/JSON column contains something shaped like "password: ..." / "token: ..." / "api_key = ...".', fix: ['Find the rows with a SELECT limited to the key name, move the secret to the private config files, rotate it, blank the field.'], where: DB_JOB + ' + rotation' },
  'hyg.card_numbers': { sev: 'high', means: 'Free text contains a number shaped like a payment card (13-19 digits, Luhn-valid; spaces, hyphens and dots between groups, Latin or Arabic-Indic digits). The privacy page promises the shop never stores card numbers.', fix: ["Review the listed column (look at the rows yourself, in the admin); replace the digits: UPDATE `TABLE` SET `COLUMN` = REGEXP_REPLACE(`COLUMN`, '[0-9][0-9 -]{11,17}[0-9]', '[removed]') WHERE id = <id>;  -- Arabic-Indic digits: edit the row by hand", 'Then check backups, the warehouse mail and the fulfilment_outbox copy for the same text.'], where: DB_JOB + ' after you have looked at the row' },
  'hyg.location_lines': { sev: 'medium', means: 'Orders older than the limit (default 90 days) still carry the customer\'s precise map location in the note, and the privacy page does not mention location at all.', fix: ["UPDATE orders SET customer_note = TRIM(REGEXP_REPLACE(customer_note, '(Location|\u0627\u0644\u0645\u0648\u0642\u0639): ?https://[^ ]+', '')) WHERE created_at < NOW() - INTERVAL 90 DAY AND customer_note LIKE '%google.com/maps%';", 'Same for fulfilment_outbox.payload; add the location line to Privacy.jsx section 1.'], where: DB_JOB + '; owner decision on the period' },
  'hyg.retention': { sev: 'low', means: 'The privacy page promises no retention period ("as long as we need them for accounting and for the returns period"), so there is nothing to measure against. Orders older than the period you choose are listed by age.', fix: ['Decide a period (for example 5 years for accounting), then run the audit with --order-retention-days N.'], where: 'owner decision' },
  'hyg.dead_tokens': { sev: 'low', means: 'Expired reset/login tokens (hashed) are still stored past the grace period.', fix: ['DELETE FROM admin_password_resets WHERE expires_at < NOW() - INTERVAL 7 DAY;', 'DELETE FROM customer_password_resets WHERE expires_at < NOW() - INTERVAL 7 DAY;'], where: DB_JOB },
  'hyg.log_pii': { sev: 'low', means: 'Log-like tables keep personal data (emails, IPs, message bodies) longer than the limit (default 365 days).', fix: ['Archive and delete: DELETE FROM `LOGTABLE` WHERE `TIME` < NOW() - INTERVAL 365 DAY;  -- table and column are named in the evidence'], where: DB_JOB },
}

// ===========================================================================
// 6. THE CHECKS
// ===========================================================================

export const CHECKS = []
const check = (id, category, title, run) => CHECKS.push({ id, category, title, run, severity: FIXES[id]?.sev ?? 'low' })
const pass = (detail, items) => ({ status: 'PASS', detail, items })
const fail = (detail, items) => ({ status: 'FAIL', detail, items })
const unknown = (reason) => ({ status: 'UNKNOWN', reason })

const PRIV_ERRNO = new Set([1044, 1045, 1142, 1143, 1227, 1370, 1410, 1141, 1109])
export const privReason = (e, what) => `the connecting account may not read ${what} (error ${e.errno}: ${trunc(e.message.replace(/'[^']*'@'[^']*'/g, "'…'@'…'"), 90)})`

// ---- context --------------------------------------------------------------
async function buildContext(db, opts) {
  const ctx = { db, opts, cache: new Map(), now: opts.now ? new Date(opts.now + 'T12:00:00Z') : new Date() }
  ctx.sql = async (sql) => { if (!ctx.cache.has(sql)) ctx.cache.set(sql, await db.query(sql)); return ctx.cache.get(sql) }
  ctx.rows = async (sql) => (await ctx.sql(sql)).rows
  ctx.objs = async (sql) => { const r = await ctx.sql(sql); return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.toLowerCase(), row[i]]))) }
  const kv = async (sql) => new Map((await ctx.rows(sql)).map(([k, v]) => [String(k).toLowerCase(), v]))
  ctx.vars = await kv('SHOW GLOBAL VARIABLES')
  ctx.status = await kv('SHOW GLOBAL STATUS').catch(() => new Map())
  ctx.sessionStatus = await kv("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version','Ssl_cipher','Ssl_server_not_after','Ssl_server_not_before')").catch(() => new Map())
  const ident = (await ctx.rows('SELECT CURRENT_USER(), USER(), IFNULL(DATABASE(), \'\'), VERSION(), CONNECTION_ID()'))[0]
  ctx.currentUser = ident[0]; ctx.version = parseVersion(ident[3]); ctx.versionRaw = ident[3]
  ctx.connectionId = ident[4]
  ctx.schema = opts.schema || ident[2] || ''
  ctx.hostname = ctx.vars.get('hostname') ?? ''
  ctx.v = (name) => ctx.vars.get(name.toLowerCase())
  ctx.mariadb = /mariadb/i.test(ident[3]) || /mariadb/i.test(ctx.v('version_comment') ?? '')

  // Rights held through ROLES. `SHOW GRANTS FOR <user>` lists only "GRANT `role` TO user"; the role's own rights are a
  // separate `SHOW GRANTS FOR <role>`. Follow them (cycle-safe) so a role cannot hide ALL PRIVILEGES from every check
  // below. A role this account may not read leaves the picture incomplete (`.opaque`): never a PASS.
  ctx.expand = async (grants, seen = new Set()) => {
    const out = [...grants]
    for (const g of grants) {
      if (g.kind !== 'role') continue
      for (const r of g.roles ?? []) {
        if (seen.has(r)) continue
        seen.add(r)
        let lines
        try { lines = (await ctx.rows(`SHOW GRANTS FOR ${q(r)}`)).map((x) => x[0]) } catch { out.opaque = true; continue }
        const inner = await ctx.expand(parseGrants(lines), seen)
        if (inner.opaque) out.opaque = true
        out.push(...inner)
      }
    }
    return out
  }

  // The connecting account's own grants.
  ctx.myGrants = await ctx.expand(parseGrants((await ctx.rows('SHOW GRANTS FOR CURRENT_USER()')).map((r) => r[0])))
  ctx.can = (priv, schema) => holds(ctx.myGrants, priv, schema)

  // Is the app schema known? If none was named, take the only non-system one.
  if (!ctx.schema) {
    const s = (await ctx.rows(`SELECT schema_name FROM information_schema.SCHEMATA WHERE schema_name NOT IN ${NOT_SYSTEM} AND schema_name NOT REGEXP '^test'`)).map((r) => r[0])
    if (s.length === 1) ctx.schema = s[0]
  }

  ctx.accounts = async () => {
    if (ctx._accounts) return ctx._accounts
    const order = opts.accountsSource === 'user' ? ['user'] : opts.accountsSource === 'global_priv' ? ['global_priv'] : ['global_priv', 'user']
    let last
    for (const src of order) {
      try {
        const rows = await ctx.objs(ACCOUNT_SQL[src])
        const list = rows.map((r) => ({
          user: r.user, host: r.host, label: `${r.user}@${r.host}`,
          plugins: [r.plugin || 'mysql_native_password', ...[...String(r.auth_or ?? '').matchAll(/"plugin"\s*:\s*"([^"]+)"/g)].map((m) => m[1])],
          emptyPassword: false, locked: ['1', 'true', 'Y'].includes(String(r.locked)), isRole: ['1', 'true', 'Y'].includes(String(r.is_role)),
          pwChangedAt: num(r.pw_changed) > 0 ? num(r.pw_changed) : null, maxUserConn: num(r.max_uc),
        }))
        rows.forEach((r, i) => {
          const a = list[i]
          const chain = [{ plugin: r.plugin || 'mysql_native_password', empty: String(r.main_empty) === '1' }]
          const alt = String(r.auth_or ?? '')
          if (alt) {
            try {
              for (const e of JSON.parse(alt)) if (e.plugin) chain.push({ plugin: e.plugin, empty: !e.authentication_string })
            } catch { /* unparsable alternative: leave the main entry only */ }
          }
          a.emptyPassword = !a.isRole && !a.locked && chain.some((c) => /^(mysql_native_password|mysql_old_password)$/.test(c.plugin) && c.empty)
        })
        return (ctx._accounts = { ok: true, source: src, list })
      } catch (e) {
        last = e
        if (!(e instanceof SqlError) || e.errno !== 1146) break
      }
    }
    return (ctx._accounts = { ok: false, reason: last instanceof SqlError ? privReason(last, 'the account tables (mysql.global_priv / mysql.user)') : `account tables unreadable: ${trunc(last?.message ?? '')}` })
  }
  ctx.grantsOf = async (a) => {
    if (!ctx._grants) ctx._grants = new Map()
    if (!ctx._grants.has(a.label)) {
      try {
        const gs = await ctx.expand(parseGrants((await ctx.rows(`SHOW GRANTS FOR ${sqlStr(a.user)}@${sqlStr(a.host)}`)).map((r) => r[0])))
        ctx._grants.set(a.label, gs.opaque ? null : gs) // a role it cannot read: the account's rights are not fully known
      } catch (e) { ctx._grants.set(a.label, e instanceof SqlError && e.errno === 1141 ? [] : null) }
    }
    return ctx._grants.get(a.label)
  }
  ctx.mask = (s) => (opts.mask ? String(s).replace(/^([^@])[^@]*([^@])@/, '$1***$2@') : String(s))
  return ctx
}

const ACCOUNT_SQL = {
  // The server reduces every hash to "empty or not": no hash crosses the wire.
  global_priv:
    "SELECT User AS user, Host AS host, IFNULL(JSON_VALUE(Priv, '$.plugin'), '') AS plugin, " +
    "IF(IFNULL(JSON_VALUE(Priv, '$.authentication_string'), '') = '', 1, 0) AS main_empty, " +
    "IFNULL(JSON_VALUE(Priv, '$.account_locked'), '0') AS locked, IFNULL(JSON_VALUE(Priv, '$.is_role'), '0') AS is_role, " +
    "IFNULL(JSON_VALUE(Priv, '$.password_last_changed'), '0') AS pw_changed, IFNULL(JSON_VALUE(Priv, '$.max_user_connections'), '0') AS max_uc, " +
    "IFNULL(REGEXP_REPLACE(JSON_QUERY(Priv, '$.auth_or'), '\"authentication_string\" *: *\"[^\"]+\"', '\"authentication_string\":\"x\"'), '') AS auth_or " +
    'FROM mysql.global_priv ORDER BY User, Host',
  user:
    "SELECT User AS user, Host AS host, IFNULL(plugin, '') AS plugin, IF(IFNULL(authentication_string, '') = '' AND IFNULL(Password, '') = '', 1, 0) AS main_empty, " +
    // The view has no account_locked column: the vendor's own locked system accounts are named, every other account is assumed usable.
    "IF(User IN ('mariadb.sys', 'mysql.sys', 'mysql.session', 'mysql.infoschema') AND Host = 'localhost', '1', '0') AS locked, IFNULL(is_role, 'N') AS is_role, " +
    "'0' AS pw_changed, IFNULL(max_user_connections, 0) AS max_uc, '' AS auth_or FROM mysql.user ORDER BY User, Host",
}

// 'healthcheck' is the local-only account the official Docker image creates for its own health probe.
const SYSTEM_ACCOUNTS = new Set(['root', 'mariadb.sys', 'mysql', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'healthcheck'])
const isLocalSystem = (a, ctx) => SYSTEM_ACCOUNTS.has(a.user) && hostScope(a.host, ctx.hostname) === 'local'

// Run `fn` over every account whose grants can be read; returns what it saw
// and whether the picture is complete.
async function eachAccount(ctx, fn) {
  const acc = await ctx.accounts()
  if (acc.ok) {
    let unreadable = 0
    const out = []
    for (const a of acc.list) {
      if (a.isRole || a.locked) continue
      const g = await ctx.grantsOf(a)
      if (g === null) { unreadable++; continue }
      const r = await fn(a, g)
      if (r) out.push(r)
    }
    return { complete: unreadable === 0, out, reason: unreadable ? `${unreadable} account(s)' grants could not be read` : '' }
  }
  const me = /^'?([^'@]*)'?@'?([^']*)'?$/.exec(ctx.currentUser) ?? []
  const a = { user: me[1] ?? ctx.currentUser, host: me[2] ?? '', label: ctx.currentUser, self: true }
  const r = await fn(a, ctx.myGrants)
  return { complete: false, out: r ? [r] : [], reason: acc.reason + (ctx.myGrants.opaque ? '; a role this account holds also has rights it may not read' : '') }
}
// FAIL when offenders were seen; PASS only when the picture is complete.
const verdict = (res, okDetail, failDetail) => (res.out.length ? fail(failDetail(res.out), res.out.map(String)) : res.complete ? pass(okDetail) : unknown(res.reason))

// ---------------- accounts
check('acct.anonymous', 'accounts', 'No anonymous (empty user name) accounts', async (ctx) => {
  if (ctx.currentUser.startsWith("''@") || ctx.currentUser.startsWith('@')) return fail('this connection IS an anonymous account', [ctx.currentUser])
  const acc = await ctx.accounts()
  if (!acc.ok) return unknown(acc.reason)
  const bad = acc.list.filter((a) => a.user === '' && !a.isRole)
  return bad.length ? fail(`${bad.length} anonymous account(s)`, bad.map((a) => ctx.mask(a.label))) : pass(`none of ${acc.list.length} accounts is anonymous`)
})
check('acct.empty_password', 'accounts', 'No account can sign in with an empty password', async (ctx) => {
  const acc = await ctx.accounts()
  if (!acc.ok) return unknown(acc.reason)
  const bad = acc.list.filter((a) => a.emptyPassword)
  return bad.length ? fail(`${bad.length} account(s) accept an empty password`, bad.map((a) => ctx.mask(a.label))) : pass(`all ${acc.list.filter((a) => !a.isRole).length} accounts require a secret, are locked, or use socket/other authentication`)
})
check('acct.wildcard_host', 'accounts', "No account accepts connections from any host ('%', or a netmask range)", async (ctx) => {
  const acc = await ctx.accounts()
  if (!acc.ok) return unknown(acc.reason)
  const bad = acc.list.filter((a) => !a.isRole && !a.locked && a.user !== '' && ['any', 'public', 'named'].includes(hostScope(a.host, ctx.hostname)) && (/[%_/]/.test(a.host) || hostScope(a.host, ctx.hostname) === 'any'))
  return bad.length ? fail(`${bad.length} account(s) with a wildcard or public host`, bad.map((a) => ctx.mask(a.label))) : pass('every usable account is limited to a loopback address, a private subnet or a named host')
})
check('acct.root_network', 'accounts', 'No administrative account is reachable from the network', async (ctx) => {
  const res = await eachAccount(ctx, async (a, g) => (isAdminClass(g) && reachableFromNetwork(a.host, ctx.hostname) ? ctx.mask(a.label) : null))
  return verdict(res, 'administrative accounts (ALL PRIVILEGES / SUPER) exist only on loopback', (o) => `${o.length} administrative account(s) can connect from the network`)
})
check('acct.powerful_privs', 'accounts', 'No ordinary account holds SUPER / FILE / PROCESS / GRANT OPTION, reads every schema, or gets there through a role', async (ctx) => {
  const res = await eachAccount(ctx, async (a, g) => {
    if (!a.self && isLocalSystem(a, ctx)) return null
    if (a.self && SYSTEM_ACCOUNTS.has(a.user) && hostScope(a.host, ctx.hostname) === 'local') return null
    const d = globalDanger(g)
    const all = [...d.privs, ...broadReach(g)]
    // An account named with --auditor exists to run this audit: PROCESS (to see every connection) and SELECT on
    // mysql (the account tables) are its two expected powers. Anything else it holds still counts.
    const privs = ctx.opts.auditor.includes(a.user) ? all.filter((p) => p !== 'PROCESS' && p !== 'SELECT on mysql') : all
    return privs.length ? `${ctx.mask(a.label)}: ${privs.join(', ')}` : null
  })
  return verdict(res, 'only local administrative accounts hold powerful privileges', (o) => `${o.length} account(s) hold powerful privileges`)
})
check('acct.app_ddl', 'accounts', 'The web account cannot change the schema (no CREATE/ALTER/DROP/...)', async (ctx) => {
  const allow = new Set(ctx.opts.allowDdl)
  const res = await eachAccount(ctx, async (a, g) => {
    if (allow.has(a.user)) return null
    if (isLocalSystem(a, ctx) || (a.self && SYSTEM_ACCOUNTS.has(a.user) && hostScope(a.host, ctx.hostname) === 'local')) return null
    const all = ddlPrivs(g, ctx.schema || null)
    const d = ctx.opts.auditor.includes(a.user) ? all.filter((p) => p !== 'TRIGGER') : all // TRIGGER is how an auditor sees triggers
    return d.length ? `${ctx.mask(a.label)}: ${d.join(', ')}` : null
  })
  return verdict(res, 'no usable account outside the allow-list holds schema-changing rights', (o) => `${o.length} account(s) can change the schema`)
})
check('acct.unused', 'accounts', 'No account with nothing to use', async (ctx) => {
  const acc = await ctx.accounts()
  if (!acc.ok) return unknown(acc.reason)
  const schemas = new Set((await ctx.rows('SELECT schema_name FROM information_schema.SCHEMATA')).map((r) => String(r[0]).toLowerCase()))
  const bad = []
  let unread = 0
  for (const a of acc.list) {
    if (a.isRole || SYSTEM_ACCOUNTS.has(a.user) || a.user === '') continue
    const g = await ctx.grantsOf(a)
    if (g === null) { unread++; continue }
    const useful = g.filter((x) => x.kind === 'role' || x.kind === 'proxy' || (x.kind === 'priv' && (x.scope !== 'global' || x.all || [...x.privs].some((p) => p !== 'USAGE'))))
    if (!useful.length) { bad.push(`${ctx.mask(a.label)}: no privileges beyond USAGE`); continue }
    const missing = g.filter((x) => x.kind === 'priv' && x.scope !== 'global' && x.schema && ![...schemas].some((s) => schemaMatches(x.schema, s))).map((x) => x.schema)
    if (missing.length && missing.length === useful.length) bad.push(`${ctx.mask(a.label)}: rights only on missing schema(s) ${[...new Set(missing)].map(q).join(', ')}`)
  }
  if (bad.length) return fail(`${bad.length} account(s) are unusable or unused`, bad)
  return unread ? unknown(`${unread} account(s)' grants (or a role they hold) could not be read, so "nothing to use" cannot be ruled out`) : pass('every account has rights on something that exists')
})
check('acct.password_age', 'accounts', 'Passwords were changed within the limit (default 365 days)', async (ctx) => {
  const acc = await ctx.accounts()
  if (!acc.ok) return unknown(acc.reason)
  const limit = ctx.opts.maxPasswordAgeDays
  const nowS = ctx.now.getTime() / 1000
  const bad = [], unk = []
  for (const a of acc.list) {
    if (a.isRole || a.locked || SYSTEM_ACCOUNTS.has(a.user) && a.pwChangedAt === null) continue
    if (a.pwChangedAt === null) { unk.push(a); continue }
    const days = Math.floor((nowS - a.pwChangedAt) / 86400)
    if (days > limit) bad.push(`${ctx.mask(a.label)}: ${days} days`)
  }
  if (bad.length) return fail(`${bad.length} password(s) older than ${limit} days`, bad)
  if (unk.length) return unknown(`${unk.length} account(s) carry no password-change time (created before MariaDB 10.4 or by a tool that did not set it): age cannot be judged`)
  return pass(`every password was changed within ${limit} days`)
})

// ---------------- server
const ALL_IFACES = new Set(['', '*', '0.0.0.0', '::', '0.0.0.0,::'])
check('srv.skip_grant_tables', 'server', 'The permission system is on', async (ctx) => {
  const v = ctx.v('skip_grant_tables')
  if (v === undefined) return unknown('skip_grant_tables is not reported by this server')
  return v === 'ON' ? fail('skip_grant_tables = ON: every client is an administrator') : pass('skip_grant_tables = OFF')
})
check('srv.network_exposure', 'server', 'The database does not listen beyond what it needs', async (ctx) => {
  const skip = ctx.v('skip_networking'), bind = (ctx.v('bind_address') ?? '').trim(), port = ctx.v('port')
  if (skip === 'ON') return pass('skip_networking = ON: socket only')
  if (bind && !ALL_IFACES.has(bind) && (hostScope(bind) === 'local' || hostScope(bind) === 'private')) return pass(`bind_address = ${bind}, port ${port}`)
  if (bind && !ALL_IFACES.has(bind) && hostScope(bind) === 'public') return fail(`bind_address = ${bind}: a public address`)
  return unknown(`bind_address = ${bind || '(all interfaces)'}, port ${port}: the server listens on every interface of its container/host. Whether 3306 is reachable from outside is decided by the HOST (published ports, firewall): run ops/db/host-audit.compose.json and read HOST-CHECKLIST.md`)
})
check('srv.public_clients', 'server', 'No client connected from a public address', async (ctx) => {
  const rows = await ctx.rows('SELECT id, host FROM information_schema.PROCESSLIST')
  const mine = rows.find((r) => String(r[0]) === String(ctx.connectionId))
  const bad = rows.filter((r) => clientAddressClass(r[1]) === 'public')
  const items = [...new Set(bad.map((r) => maskIp(r[1])))]
  if (bad.length) return fail(`${bad.length} connection(s) from public addresses (shown as /24)`, items)
  const full = ctx.can('PROCESS')
  if (!full) return unknown(`only this connection is visible (it comes from a ${clientAddressClass(mine?.[1])} address); other clients need the PROCESS privilege`)
  return pass(`${rows.length} connection(s) now, none from a public address`)
})
check('srv.skip_name_resolve', 'server', 'Hostnames are not resolved', async (ctx) => {
  const v = ctx.v('skip_name_resolve')
  if (v === undefined) return unknown('skip_name_resolve is not reported by this server')
  return v === 'ON' ? pass('skip_name_resolve = ON') : fail('skip_name_resolve = OFF: account hosts are matched through DNS')
})
check('srv.local_infile', 'server', 'LOAD DATA LOCAL INFILE is off', async (ctx) => {
  const v = ctx.v('local_infile')
  if (v === undefined) return unknown('local_infile is not reported by this server')
  return v === 'OFF' || v === '0' ? pass('local_infile = OFF') : fail(`local_infile = ${v}`)
})
check('srv.secure_file_priv', 'server', 'File import/export is confined', async (ctx) => {
  const v = ctx.v('secure_file_priv')
  if (v === undefined) return unknown('secure_file_priv is not reported by this server')
  return v === '' ? fail('secure_file_priv is empty: INTO OUTFILE / LOAD_FILE are not confined to a directory') : pass(v === null || v === 'NULL' ? 'secure_file_priv = NULL: import/export disabled' : `secure_file_priv = ${v}`)
})
const MODE = (ctx) => new Set((ctx.v('sql_mode') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
check('srv.sql_strict', 'server', 'Strict SQL mode (bad input is refused, not trimmed)', async (ctx) => {
  const m = MODE(ctx)
  return m.has('STRICT_ALL_TABLES') ? pass('STRICT_ALL_TABLES is set') : m.has('STRICT_TRANS_TABLES') ? pass('STRICT_TRANS_TABLES is set (covers InnoDB; STRICT_ALL_TABLES also covers other engines)') : fail(`sql_mode has no strict flag: ${ctx.v('sql_mode') || '(empty)'}`)
})
check('srv.sql_zero_date', 'server', 'Zero dates are refused', async (ctx) => {
  const m = MODE(ctx); const miss = ['NO_ZERO_DATE', 'NO_ZERO_IN_DATE'].filter((f) => !m.has(f))
  return miss.length ? fail(`sql_mode lacks ${miss.join(', ')}`) : pass('NO_ZERO_DATE and NO_ZERO_IN_DATE are set')
})
check('srv.sql_div_zero', 'server', 'Division by zero is an error', async (ctx) => (MODE(ctx).has('ERROR_FOR_DIVISION_BY_ZERO') ? pass('ERROR_FOR_DIVISION_BY_ZERO is set') : fail('sql_mode lacks ERROR_FOR_DIVISION_BY_ZERO')))
check('srv.sql_group_by', 'server', 'ONLY_FULL_GROUP_BY is on', async (ctx) => (MODE(ctx).has('ONLY_FULL_GROUP_BY') ? pass('ONLY_FULL_GROUP_BY is set') : fail('sql_mode lacks ONLY_FULL_GROUP_BY')))
check('srv.event_scheduler', 'server', 'The event scheduler is off', async (ctx) => {
  const v = ctx.v('event_scheduler')
  if (v === undefined) return unknown('event_scheduler is not reported by this server')
  return v === 'ON' ? fail('event_scheduler = ON') : pass(`event_scheduler = ${v}`)
})
check('srv.password_policy', 'server', 'A password-strength plugin is active', async (ctx) => {
  const rows = await ctx.rows("SELECT plugin_name, plugin_status FROM information_schema.PLUGINS WHERE plugin_name IN ('simple_password_check','validate_password','cracklib_password_check','password_reuse_check') OR plugin_name LIKE '%password%'")
  const active = rows.filter((r) => r[1] === 'ACTIVE' && /simple_password_check|validate_password|cracklib_password_check/.test(r[0])).map((r) => r[0])
  return active.length ? pass(`active: ${active.join(', ')}`) : fail('no password-strength plugin is active (simple_password_check / validate_password / cracklib_password_check)')
})
check('srv.audit_log', 'server', 'Connections are audited (server_audit)', async (ctx) => {
  if (!ctx.mariadb) return unknown('server_audit is a MariaDB plugin; this server is not MariaDB')
  const rows = await ctx.rows("SELECT plugin_status FROM information_schema.PLUGINS WHERE plugin_name = 'server_audit'")
  if (!rows.length || rows[0][0] !== 'ACTIVE') return fail('the server_audit plugin is not active')
  const logging = ctx.v('server_audit_logging'), events = (ctx.v('server_audit_events') ?? '').toUpperCase()
  if (logging !== 'ON') return fail('server_audit is installed but server_audit_logging is OFF')
  if (events !== '' && !events.includes('CONNECT')) return fail(`server_audit_events = ${events}: connections are not logged`)
  return pass(`server_audit logging ON, events ${events || '(all)'}`)
})
check('srv.symlinks', 'server', 'Symbolic links are not followed', async (ctx) => {
  const v = ctx.v('have_symlink') ?? ctx.v('symbolic_links')
  if (v === undefined) return unknown('have_symlink is not reported by this server')
  return /^(DISABLED|NO|OFF|0)$/i.test(v) ? pass(`symbolic links: ${v}`) : fail(`symbolic links: ${v}`)
})
check('srv.version_support', 'server', 'The server series is still supported', async (ctx) => {
  const s = versionSupport(ctx.versionRaw, ctx.now)
  return s.status === 'PASS' ? pass(s.detail) : s.status === 'FAIL' ? fail(s.detail) : unknown(s.reason)
})

// ---------------- TLS
check('tls.available', 'tls', 'The server can speak TLS', async (ctx) => {
  const have = ctx.v('have_ssl') ?? ctx.v('have_openssl')
  const ok = have === 'YES' || (have === undefined && (ctx.v('ssl_cert') || ctx.sessionStatus.get('ssl_server_not_after')))
  return ok ? pass('TLS is configured (have_ssl = YES)') : fail(`have_ssl = ${have ?? '(absent)'}: no certificate is loaded`)
})
check('tls.require_secure_transport', 'tls', 'TCP clients must use TLS (require_secure_transport)', async (ctx) => {
  const v = ctx.v('require_secure_transport')
  if (v === undefined) return unknown('require_secure_transport is not reported by this server')
  return v === 'ON' ? pass('require_secure_transport = ON') : fail('require_secure_transport = OFF: a client may connect in clear')
})
check('tls.versions', 'tls', 'Only TLS 1.2 and 1.3 are offered', async (ctx) => {
  const v = ctx.v('tls_version')
  if (v === undefined) return unknown('tls_version is not reported by this server')
  const old = v.split(',').map((s) => s.trim()).filter((s) => /^TLSv1(\.1)?$/.test(s))
  return old.length ? fail(`tls_version = ${v} allows ${old.join(', ')}`) : pass(`tls_version = ${v}`)
})
check('tls.cert_expiry', 'tls', 'The server certificate is valid for at least 30 days', async (ctx) => {
  const after = ctx.sessionStatus.get('ssl_server_not_after')
  if (!after) return unknown('the server reports no certificate expiry (TLS off, or an old server)')
  const t = Date.parse(after.replace(/\s+GMT$/, ' GMT'))
  if (!Number.isFinite(t)) return unknown(`certificate end date not parseable (${trunc(after, 40)})`)
  const days = Math.floor((t - ctx.now.getTime()) / 864e5)
  return days < 0 ? fail(`the certificate expired ${-days} days ago`) : days < 30 ? fail(`the certificate expires in ${days} days`) : pass(`the certificate is valid for ${days} more days`)
})

// ---------------- logs
check('log.general', 'logs', 'The general query log is off', async (ctx) => {
  const v = ctx.v('general_log')
  if (v === undefined) return unknown('general_log is not reported by this server')
  if (v !== 'ON') return pass('general_log = OFF')
  return fail(`general_log = ON, log_output = ${ctx.v('log_output')}, file ${ctx.v('general_log_file')}: every statement, with its customer data, is being written`)
})
check('log.slow', 'logs', 'The slow query log is off', async (ctx) => {
  const v = ctx.v('slow_query_log')
  if (v === undefined) return unknown('slow_query_log is not reported by this server')
  return v === 'ON' ? fail(`slow_query_log = ON, log_output = ${ctx.v('log_output')}, file ${ctx.v('slow_query_log_file')}, long_query_time ${ctx.v('long_query_time')}`) : pass('slow_query_log = OFF')
})
const binlogOn = (ctx) => ctx.v('log_bin') === 'ON' || ctx.v('log_bin') === '1'
const binlogSeconds = (ctx) => {
  const s = num(ctx.v('binlog_expire_logs_seconds')), d = num(ctx.v('expire_logs_days'))
  return s > 0 ? s : d > 0 ? d * 86400 : 0
}
check('log.binlog_pitr', 'logs', 'Point-in-time recovery is possible (binary log on)', async (ctx) => {
  if (ctx.v('log_bin') === undefined) return unknown('log_bin is not reported by this server')
  return binlogOn(ctx) ? pass('log_bin = ON') : fail('log_bin = OFF: only the last dump can be restored; changes since are lost')
})
check('log.binlog_retention', 'logs', 'Binary logs are purged within 30 days', async (ctx) => {
  if (ctx.v('log_bin') === undefined) return unknown('log_bin is not reported by this server')
  if (!binlogOn(ctx)) return pass('no binary log is kept')
  const s = binlogSeconds(ctx)
  if (s === 0) return fail('log_bin = ON with no expiry: binary logs (every changed row, personal data included) are kept forever')
  const days = Math.round(s / 864) / 100
  return days > 30 ? fail(`binary logs are kept ${days} days`) : pass(`binary logs are kept ${days} days`)
})

// ---------------- limits
check('lim.connections', 'limits', 'max_connections is modest', async (ctx) => {
  const n = num(ctx.v('max_connections'))
  return n > 1000 ? fail(`max_connections = ${n}`) : pass(`max_connections = ${n}`)
})
check('lim.user_connections', 'limits', 'One account cannot take every connection (max_user_connections)', async (ctx) => {
  const g = num(ctx.v('max_user_connections'))
  if (g > 0) return pass(`max_user_connections = ${g}`)
  const acc = await ctx.accounts()
  if (acc.ok) {
    const open = acc.list.filter((a) => !a.isRole && !a.locked && !SYSTEM_ACCOUNTS.has(a.user) && a.maxUserConn === 0)
    return open.length ? fail(`max_user_connections = 0 (no global limit) and ${open.length} usable account(s) have none`, open.map((a) => ctx.mask(a.label))) : pass('every non-system account has its own connection limit')
  }
  return fail('max_user_connections = 0 (no global limit); per-account limits could not be read: ' + acc.reason)
})
check('lim.statement_time', 'limits', 'A statement timeout is set (max_statement_time)', async (ctx) => {
  const v = ctx.v('max_statement_time') ?? ctx.v('max_execution_time')
  if (v === undefined) return unknown('neither max_statement_time nor max_execution_time exists on this server')
  return num(v) > 0 ? pass(`statement timeout = ${num(v)} s`) : fail('no statement timeout (0): one query can run forever')
})
check('lim.wait_timeout', 'limits', 'Idle connections are dropped within an hour (wait_timeout)', async (ctx) => {
  const n = num(ctx.v('wait_timeout'))
  return n > 3600 ? fail(`wait_timeout = ${n} s`) : pass(`wait_timeout = ${n} s`)
})
check('lim.packet', 'limits', 'max_allowed_packet is at most 64 MiB', async (ctx) => {
  const n = num(ctx.v('max_allowed_packet'))
  return n > 64 * 1024 * 1024 ? fail(`max_allowed_packet = ${Math.round(n / 1048576)} MiB`) : pass(`max_allowed_packet = ${Math.round(n / 1048576)} MiB`)
})

// ---------------- character sets
const OK_CS = (cs) => cs === 'utf8mb4' || cs === 'ascii' || cs === 'binary'
check('cs.server_defaults', 'charset', 'New tables default to utf8mb4', async (ctx) => {
  const cs = ctx.v('character_set_server'), col = ctx.v('collation_server')
  return cs === 'utf8mb4' && /^utf8mb4_/.test(col ?? '') ? pass(`${cs} / ${col}`) : fail(`character_set_server = ${cs}, collation_server = ${col}`)
})
check('cs.database_default', 'charset', 'The shop database defaults to utf8mb4', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const r = await ctx.rows(`SELECT default_character_set_name, default_collation_name FROM information_schema.SCHEMATA WHERE schema_name = ${sqlStr(ctx.schema)}`)
  if (!r.length) return unknown(`schema ${ctx.schema} not visible to this account`)
  return r[0][0] === 'utf8mb4' ? pass(`${r[0][0]} / ${r[0][1]}`) : fail(`schema default is ${r[0][0]} / ${r[0][1]}`)
})
async function appColumns(ctx) {
  return ctx.objs(`SELECT table_schema, table_name, column_name, data_type, column_type, character_maximum_length, character_set_name, collation_name FROM information_schema.COLUMNS WHERE table_schema NOT IN ${NOT_SYSTEM} ORDER BY table_schema, table_name, ordinal_position`)
}
async function appTables(ctx) {
  return ctx.objs(`SELECT table_schema, table_name, table_type, engine, table_collation FROM information_schema.TABLES WHERE table_schema NOT IN ${NOT_SYSTEM} ORDER BY table_schema, table_name`)
}
const inApp = (ctx, r) => !ctx.schema || r.table_schema === ctx.schema
check('cs.columns', 'charset', 'Every text column is utf8mb4', async (ctx) => {
  const cols = (await appColumns(ctx)).filter((r) => r.character_set_name && inApp(ctx, r))
  const bad = cols.filter((r) => !OK_CS(r.character_set_name))
  if (!cols.length) return unknown(`no text columns visible in ${ctx.schema || 'any schema'}`)
  const byTable = new Map()
  for (const r of bad) byTable.set(`${r.table_schema}.${r.table_name}`, [...(byTable.get(`${r.table_schema}.${r.table_name}`) ?? []), `${r.column_name} (${r.character_set_name})`])
  return bad.length ? fail(`${bad.length} column(s) in ${byTable.size} table(s) are not utf8mb4`, [...byTable].map(([t, c]) => `${t}: ${c.slice(0, 6).join(', ')}${c.length > 6 ? ` +${c.length - 6}` : ''}`)) : pass(`${cols.length} text columns, all utf8mb4 (or ascii/binary)`)
})
check('cs.collation_mix', 'charset', 'One collation across the shop schema', async (ctx) => {
  // *_bin columns are deliberate: MariaDB gives every JSON column utf8mb4_bin, and exact-match keys use it too.
  const cols = (await appColumns(ctx)).filter((r) => r.collation_name && r.character_set_name === 'utf8mb4' && !/_bin$/.test(r.collation_name) && inApp(ctx, r))
  const set = new Map()
  for (const r of cols) set.set(r.collation_name, (set.get(r.collation_name) ?? 0) + 1)
  if (!cols.length) return unknown('no utf8mb4 columns visible')
  return set.size > 1 ? fail(`${set.size} different collations in use`, [...set].map(([c, n]) => `${c}: ${n} column(s)`)) : pass(`all ${cols.length} utf8mb4 columns use ${[...set.keys()][0]}`)
})

// ---------------- schema
check('sch.engine', 'schema', 'Every table is InnoDB', async (ctx) => {
  const t = (await appTables(ctx)).filter((r) => r.table_type === 'BASE TABLE' && inApp(ctx, r))
  if (!t.length) return unknown(`no tables visible in ${ctx.schema || 'any schema'}`)
  const bad = t.filter((r) => r.engine !== 'InnoDB')
  return bad.length ? fail(`${bad.length} of ${t.length} table(s) are not InnoDB`, bad.map((r) => `${r.table_schema}.${r.table_name} (${r.engine})`)) : pass(`all ${t.length} tables are InnoDB`)
})
check('sch.primary_key', 'schema', 'Every table has a primary key', async (ctx) => {
  const t = (await appTables(ctx)).filter((r) => r.table_type === 'BASE TABLE' && inApp(ctx, r))
  if (!t.length) return unknown(`no tables visible in ${ctx.schema || 'any schema'}`)
  const pk = new Set((await ctx.rows(`SELECT table_schema, table_name FROM information_schema.TABLE_CONSTRAINTS WHERE constraint_type = 'PRIMARY KEY' AND table_schema NOT IN ${NOT_SYSTEM}`)).map((r) => `${r[0]}.${r[1]}`))
  const bad = t.filter((r) => !pk.has(`${r.table_schema}.${r.table_name}`))
  return bad.length ? fail(`${bad.length} of ${t.length} table(s) have no primary key`, bad.map((r) => `${r.table_schema}.${r.table_name}`)) : pass(`all ${t.length} tables have a primary key`)
})
check('sch.foreign_keys', 'schema', 'Foreign keys exist and are enforced', async (ctx) => {
  const on = ctx.v('foreign_key_checks')
  const n = num((await ctx.rows(`SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE constraint_schema NOT IN ${NOT_SYSTEM}${ctx.schema ? ` AND constraint_schema = ${sqlStr(ctx.schema)}` : ''}`))[0][0])
  if (on === 'OFF') return fail(`foreign_key_checks = OFF globally (${n} constraints exist but are not enforced)`)
  return n > 0 ? pass(`${n} foreign keys, foreign_key_checks = ${on ?? '(not reported)'}`) : fail('no foreign key exists in the schema: links between orders, items and accounts are not enforced')
})
check('sch.definers', 'schema', 'Triggers, events, routines and views do not run as a powerful account', async (ctx) => {
  const sc = ctx.schema || undefined
  const acc = await ctx.accounts()
  const powerful = new Set(['root', 'mariadb.sys'])
  const known = new Set()
  if (acc.ok) {
    for (const a of acc.list) {
      known.add(`${a.user}@${a.host}`.toLowerCase())
      const g = await ctx.grantsOf(a)
      if (g && isAdminClass(g)) powerful.add(a.user)
    }
  }
  const defs = []
  const blind = []
  const add = (kind, name, definer, extra = '') => defs.push({ kind, name, definer: String(definer ?? ''), extra })
  const where = (col) => `${col} NOT IN ${NOT_SYSTEM}${ctx.schema ? ` AND ${col} = ${sqlStr(ctx.schema)}` : ''}`
  // Triggers live in files, not tables: only the TRIGGER privilege shows them.
  if (ctx.can('TRIGGER', sc)) for (const r of await ctx.rows(`SELECT trigger_schema, trigger_name, definer FROM information_schema.TRIGGERS WHERE ${where('trigger_schema')}`)) add('trigger', `${r[0]}.${r[1]}`, r[2])
  else blind.push('triggers (need the TRIGGER privilege)')
  // Events and routines are readable from the mysql tables by an account that can read them.
  let ev = null
  try { ev = await ctx.rows(`SELECT db, name, definer FROM mysql.event WHERE ${where('db')}`) } catch { /* not readable */ }
  if (ev === null && ctx.can('EVENT', sc)) ev = await ctx.rows(`SELECT event_schema, event_name, definer FROM information_schema.EVENTS WHERE ${where('event_schema')}`)
  if (ev === null) blind.push('events (need SELECT on mysql.* or the EVENT privilege)'); else for (const r of ev) add('event', `${r[0]}.${r[1]}`, r[2])
  let rt = null
  try { rt = await ctx.rows(`SELECT db, name, definer, security_type FROM mysql.proc WHERE ${where('db')}`) } catch { /* not readable */ }
  if (rt === null && ['EXECUTE', 'CREATE ROUTINE', 'ALTER ROUTINE'].some((p) => ctx.can(p, sc))) rt = await ctx.rows(`SELECT routine_schema, routine_name, definer, security_type FROM information_schema.ROUTINES WHERE ${where('routine_schema')}`)
  if (rt === null) blind.push('routines (need SELECT on mysql.* or EXECUTE)'); else for (const r of rt) add('routine', `${r[0]}.${r[1]}`, r[2], r[3] === 'DEFINER' ? 'definer-rights' : '')
  if (ctx.can('SHOW VIEW', sc)) for (const r of await ctx.rows(`SELECT table_schema, table_name, definer, security_type FROM information_schema.VIEWS WHERE ${where('table_schema')}`)) add('view', `${r[0]}.${r[1]}`, r[2], r[3] === 'DEFINER' ? 'definer-rights' : '')
  else blind.push('views (need SHOW VIEW)')
  const bad = []
  for (const d of defs) {
    const [user, ...h] = d.definer.split('@'); const host = h.join('@')
    const runsAsDefiner = d.kind === 'trigger' || d.kind === 'event' || d.extra === 'definer-rights'
    if (runsAsDefiner && powerful.has(user)) bad.push(`${d.kind} ${d.name}: definer ${ctx.mask(d.definer)} is powerful`)
    else if (acc.ok && d.definer && !known.has(d.definer.toLowerCase()) && !known.has(`${user}@${host}`.toLowerCase())) bad.push(`${d.kind} ${d.name}: definer ${ctx.mask(d.definer)} does not exist`)
  }
  if (bad.length) return fail(`${bad.length} object(s) with a powerful or missing definer`, bad)
  if (blind.length) return unknown(`${defs.length} object(s) seen and none is wrong, but this account cannot see: ${blind.join('; ')}. An empty list proves nothing.`)
  if (!acc.ok) return unknown(`${defs.length} object(s) seen, none with a root/admin-looking definer; ${acc.reason}`)
  return pass(defs.length ? `${defs.length} object(s), none with a powerful or missing definer` : 'no triggers, events, routines or views')
})
export const BACKUP_NAME = /(^|_)(bak|backup|old|copy|dump|tmp|temp|legacy|archive|snapshot|prev|orig)(_|\d|$)|_\d{8}|_20\d{2}(0[1-9]|1[0-2])/i
check('sch.backup_copies', 'schema', 'No copies or backups left in the live schema', async (ctx) => {
  const t = (await appTables(ctx)).filter((r) => inApp(ctx, r))
  if (!t.length) return unknown(`no tables visible in ${ctx.schema || 'any schema'}`)
  const bad = t.filter((r) => BACKUP_NAME.test(r.table_name))
  return bad.length ? fail(`${bad.length} table(s) look like copies, backups or leftovers`, bad.map((r) => `${r.table_schema}.${r.table_name}`)) : pass('no table name looks like a copy or backup')
})
check('sch.other_databases', 'schema', 'No other databases are visible (and no test database)', async (ctx) => {
  const names = (await ctx.rows('SELECT schema_name FROM information_schema.SCHEMATA')).map((r) => r[0])
  const other = names.filter((n) => !SYSTEM_SCHEMAS.includes(n.toLowerCase()) && n !== ctx.schema)
  return other.length ? fail(`${other.length} other database(s) visible to this account`, other.map(q)) : pass(`only ${ctx.schema ? q(ctx.schema) : 'the shop database'} and system schemas are visible`)
})

// ---------------- secrets (shape only)
async function credentialColumns(ctx) {
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r) && /char|text|blob|binary|json/.test(r.data_type) && CRED_NAME.test(r.column_name) && credentialKind(r.column_name))
  return cols
}
async function columnShape(ctx, c) {
  const col = q(c.column_name), tbl = `${q(c.table_schema)}.${q(c.table_name)}`
  const re = (r) => `SUM(${col} REGEXP ${sqlStr(r)})`
  const r = (await ctx.rows(
    `SELECT COUNT(*), SUM(IFNULL(${col}, '') = ''), ${re('^[$]2[abxy][$][0-9]{2}[$]')}, ${re('^[$]argon2(id|i|d)[$]')}, ${re('^[$]([56]|y)[$]')}, ` +
    `${re('^[0-9a-f]{64}$')}, ${re('^[0-9a-f]{40}$')}, ${re('^[0-9a-f]{32}$')}, ${re('^[*][0-9A-F]{40}$')}, ${re('^[A-Z2-7]{16,64}=*$')}, ${re('^(enc|aes|sodium|v[0-9]+)[:$]')} FROM ${tbl}`))[0]
  const n = (i) => num(r[i])
  return { n: n(0), empty: n(1), bcrypt: n(2), argon: n(3), cryptsha: n(4), hex64: n(5), hex40: n(6), hex32: n(7), native: n(8), base32: n(9), encrypted: n(10) }
}
async function credentialReport(ctx) {
  if (ctx._cred) return ctx._cred
  const out = []
  for (const c of await credentialColumns(ctx)) {
    const kind = credentialKind(c.column_name)
    const s = await columnShape(ctx, c)
    out.push({ key: `${c.table_name}.${c.column_name}`, kind, rows: s.n, ...classifyCredential(kind, s) })
  }
  return (ctx._cred = out)
}
const credCheck = (kinds, bad, okText, failText) => async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const rep = (await credentialReport(ctx)).filter((r) => kinds.includes(r.kind))
  const hits = rep.filter((r) => bad.includes(r.verdict))
  if (hits.length) return fail(failText(hits.length), hits.map((r) => `${r.key} (${r.kind}): ${r.note}`))
  return pass(rep.length ? `${rep.length} column(s) checked: ${rep.map((r) => `${r.key}=${r.verdict}`).join(', ')}` : okText)
}
check('sec.password_hashes', 'secrets', 'Password columns hold salted password hashes', credCheck(['password'], ['WEAK', 'PLAIN'], 'no password column in the schema', (n) => `${n} password column(s) do not hold password hashes`))
check('sec.token_storage', 'secrets', 'Session/token/OTP columns hold hashes, not the tokens', credCheck(['token'], ['RAW'], 'no token or session column', (n) => `${n} column(s) store the token itself`))
check('sec.hash_columns', 'secrets', 'Columns named *_hash hold digests', credCheck(['hash'], ['PLAIN'], 'no *_hash column', (n) => `${n} hash column(s) hold non-digest values`))
check('sec.recoverable_secrets', 'secrets', 'Secrets the server must read back are encrypted at rest', credCheck(['recoverable'], ['CLEAR'], 'no recoverable-secret column', (n) => `${n} column(s) hold a readable secret in clear`))
// (?i): a JSON column is utf8mb4_bin in MariaDB, where REGEXP is case-sensitive without it. The value may hold any
// printable character a person types as a password, so it runs to the next space, quote, comma or semicolon.
const SECRET_IN_TEXT = '(?i)(secret|token|passw(or)?d|passcode|pwd|api[_-]?key|bearer|authorization)[a-z_-]{0,12}["\' ]*[:=]["\' ]*[^\\s"\',;]{10,}'
check('sec.secrets_in_text', 'secrets', 'No secret-shaped text in free-text or JSON columns', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const skip = new Set((await credentialColumns(ctx)).map((c) => `${c.table_name}.${c.column_name}`))
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r) && /^(varchar|char|tinytext|text|mediumtext|longtext|json)$/.test(r.data_type) && !skip.has(`${r.table_name}.${r.column_name}`) && !/^(image|logo|images)$/.test(r.column_name) && num(r.character_maximum_length, 99999) >= 24)
  const bad = []
  for (const c of cols) {
    const n = num((await ctx.rows(`SELECT COUNT(*) FROM ${q(c.table_schema)}.${q(c.table_name)} WHERE ${q(c.column_name)} REGEXP ${sqlStr(SECRET_IN_TEXT)}`))[0][0])
    if (n) bad.push(`${c.table_name}.${c.column_name}: ${n} row(s)`)
  }
  return bad.length ? fail(`${bad.length} column(s) contain secret-shaped text (counts only)`, bad) : pass(`${cols.length} text/JSON columns scanned (server-side pattern count), none matched`)
})

// ---------------- hygiene
// What the server looks for before the Luhn check runs here: twelve-plus digit-like characters in a row, in any of the
// three digit scripts above (the same set toAsciiDigits maps), separated by space, no-break space, dot or hyphen.
const CARD_PREFILTER = '[0-9\u0660-\u0669\u06f0-\u06f9\uff10-\uff19][0-9\u0660-\u0669\u06f0-\u06f9\uff10-\uff19 \u00a0.-]{11,}[0-9\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]'
const CARD_EXCLUDE = /^(cbk_|knet_|payment|track_id$|order_track_id$|reference$|wa_message_id$|sku$|slug$|image|logo$|to_e164$|contact_phone$|customer_phone$|phone$)/i
check('hyg.card_numbers', 'hygiene', 'No card-like numbers in free text', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r) && /^(varchar|char|tinytext|text|mediumtext|longtext|json)$/.test(r.data_type) && num(r.character_maximum_length, 99999) >= 13 && !CARD_EXCLUDE.test(r.column_name) && !credentialKind(r.column_name))
  const bad = []; let scanned = 0
  for (const c of cols) {
    const col = q(c.column_name)
    const sel = await ctx.rows(`SELECT LEFT(${col}, 4000) FROM ${q(c.table_schema)}.${q(c.table_name)} WHERE ${col} REGEXP ${sqlStr(CARD_PREFILTER)} LIMIT ${ctx.opts.limit}`)
    scanned++
    let n = 0
    for (const [v] of sel) if (cardLikeCount(v) > 0) n++
    if (n) bad.push(`${c.table_name}.${c.column_name}: ${n} value(s)${sel.length >= ctx.opts.limit ? ' (limit reached)' : ''}`)
  }
  return bad.length ? fail(`${bad.length} column(s) hold Luhn-valid 13-19 digit runs (counts only; may include false positives)`, bad) : pass(`${scanned} free-text columns scanned, no Luhn-valid card-like number`)
})
check('hyg.location_lines', 'hygiene', `No old precise-location lines in orders`, async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r))
  const has = (t, c) => cols.some((r) => r.table_name === t && r.column_name === c)
  const days = ctx.opts.locationRetentionDays
  const targets = [['orders', 'customer_note', 'created_at'], ['fulfilment_outbox', 'payload', 'created_at']].filter(([t, c, d]) => has(t, c) && has(t, d))
  if (!targets.length) return unknown('neither orders.customer_note nor fulfilment_outbox.payload exists in this schema')
  const re = 'google[.]com/maps|maps[.]google[.]com|maps[.]app[.]goo[.]gl|goo[.]gl/maps|maps[?]q=|geo:-?[0-9]+[.][0-9]+,'
  const bad = [], seen = []
  for (const [t, c, d] of targets) {
    const [total, old] = (await ctx.rows(`SELECT COUNT(*), SUM(${q(d)} < NOW() - INTERVAL ${days} DAY) FROM ${q(ctx.schema)}.${q(t)} WHERE ${q(c)} REGEXP ${sqlStr(re)}`))[0]
    seen.push(`${t}.${c}: ${num(total)} row(s) carry a map link, ${num(old)} older than ${days} days`)
    if (num(old) > 0) bad.push(`${t}.${c}: ${num(old)} older than ${days} days`)
  }
  return bad.length ? fail(`precise-location lines kept past ${days} days`, seen) : pass(`no map link older than ${days} days`, seen)
})
check('hyg.retention', 'hygiene', 'A retention period is defined and kept for orders', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const cols = await appColumns(ctx)
  if (!cols.some((r) => r.table_name === 'orders' && r.column_name === 'created_at' && inApp(ctx, r))) return unknown('orders.created_at not visible')
  const [t, y1, y2, y3, y5] = (await ctx.rows(`SELECT COUNT(*), SUM(created_at < NOW() - INTERVAL 1 YEAR), SUM(created_at < NOW() - INTERVAL 2 YEAR), SUM(created_at < NOW() - INTERVAL 3 YEAR), SUM(created_at < NOW() - INTERVAL 5 YEAR) FROM ${q(ctx.schema)}.orders`))[0]
  const ages = [`orders: ${num(t)} total; older than 1y ${num(y1)}, 2y ${num(y2)}, 3y ${num(y3)}, 5y ${num(y5)}`]
  const d = ctx.opts.orderRetentionDays
  if (d === null) return { status: 'UNKNOWN', reason: 'the privacy page states no period (Privacy.jsx section 3: "as long as we need them for accounting and for the returns period"), so there is nothing to measure against. Decide one and pass --order-retention-days N.', items: ages }
  const old = num((await ctx.rows(`SELECT COUNT(*) FROM ${q(ctx.schema)}.orders WHERE created_at < NOW() - INTERVAL ${d} DAY`))[0][0])
  return old ? fail(`${old} order(s) older than the ${d}-day period`, ages) : pass(`no order older than ${d} days`, ages)
})
const EXPIRY_COL = /^(expires?(_at)?|expiry|valid_until|expires_on)$/i
check('hyg.dead_tokens', 'hygiene', 'Expired tokens are not kept', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r))
  const byTable = new Map()
  for (const r of cols) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r])
  const bad = []; let n = 0
  for (const [t, cs] of byTable) {
    const exp = cs.find((c) => EXPIRY_COL.test(c.column_name) && /date|time/.test(c.data_type))
    if (!exp || !cs.some((c) => /token|code|reset/i.test(c.column_name))) continue
    n++
    const cnt = num((await ctx.rows(`SELECT COUNT(*) FROM ${q(ctx.schema)}.${q(t)} WHERE ${q(exp.column_name)} < NOW() - INTERVAL 7 DAY`))[0][0])
    if (cnt) bad.push(`${t}: ${cnt} row(s) expired more than 7 days ago`)
  }
  if (!n) return unknown('no table with a token and an expiry column found')
  return bad.length ? fail(`${bad.length} table(s) keep long-expired tokens`, bad) : pass(`${n} token table(s) checked, nothing expired for over 7 days`)
})
const LOG_TABLE = /(^|_)(log|logs|activity|audit|history|events?|outbox|attempts?|conversations?|chat|transcripts?|movements|resets)(_|$)/i
const PII_COL = /(email|phone|mobile|e164|address|(^|_)ip$|request_ip|client_ip|user_agent|(^|_)note$|message|body|payload|comment)/i
const TIME_COL = /^(created_at|logged_at|sent_at|at|ts|timestamp|time|created)$/i
check('hyg.log_pii', 'hygiene', 'Log-like tables do not keep personal data past the limit', async (ctx) => {
  if (!ctx.schema) return unknown('no schema selected (set DB_NAME or --schema)')
  const cols = (await appColumns(ctx)).filter((r) => inApp(ctx, r))
  const byTable = new Map()
  for (const r of cols) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r])
  const days = ctx.opts.logRetentionDays
  const bad = [], seen = []
  for (const [t, cs] of byTable) {
    if (!LOG_TABLE.test(t)) continue
    const pii = cs.filter((c) => PII_COL.test(c.column_name) && /char|text|json/.test(c.data_type)).map((c) => c.column_name)
    const time = cs.find((c) => TIME_COL.test(c.column_name) && /date|time/.test(c.data_type))
    if (!pii.length || !time) continue
    const [total, old] = (await ctx.rows(`SELECT COUNT(*), SUM(${q(time.column_name)} < NOW() - INTERVAL ${days} DAY) FROM ${q(ctx.schema)}.${q(t)}`))[0]
    seen.push(`${t}: ${num(total)} row(s); personal columns ${pii.join(', ')}; ${num(old)} older than ${days} days`)
    if (num(old)) bad.push(`${t}: ${num(old)} row(s) older than ${days} days (columns ${pii.join(', ')})`)
  }
  if (!seen.length) return unknown('no log-like table with personal-data columns and a timestamp was found')
  return bad.length ? fail(`${bad.length} log table(s) keep personal data past ${days} days`, bad) : pass(`${seen.length} log-like table(s) hold personal data, none older than ${days} days`, seen)
})

// ===========================================================================
// 7. FACTS (not graded) + RUNNER
// ===========================================================================

async function collectFacts(ctx) {
  const f = {
    server: ctx.versionRaw, flavour: ctx.mariadb ? 'MariaDB' : 'MySQL', schema: ctx.schema || null,
    connected_as: ctx.mask(ctx.currentUser), session_tls: ctx.sessionStatus.get('ssl_version') || null,
    threads_connected: num(ctx.status.get('threads_connected'), null), max_used_connections: num(ctx.status.get('max_used_connections'), null),
    aborted_connects_since_start: num(ctx.status.get('aborted_connects'), null), uptime_seconds: num(ctx.status.get('uptime'), null),
    innodb_encrypt_tables: ctx.v('innodb_encrypt_tables') ?? null, userstat: ctx.v('userstat') ?? null,
    can_read_account_tables: (await ctx.accounts()).ok,
    privileges_seen: { process: ctx.can('PROCESS'), trigger: ctx.can('TRIGGER') || (!!ctx.schema && ctx.can('TRIGGER', ctx.schema)), event: ctx.can('EVENT') || (!!ctx.schema && ctx.can('EVENT', ctx.schema)) },
  }
  try {
    f.tables = (await appTables(ctx)).filter((r) => r.table_type === 'BASE TABLE' && inApp(ctx, r)).length
    const pii = new Map()
    for (const c of (await appColumns(ctx)).filter((r) => inApp(ctx, r) && /char|text/.test(r.data_type) && /(email|phone|mobile|e164|name|address|street|block|area|(^|_)ip$|request_ip|note|body|comment|message)/i.test(r.column_name))) pii.set(c.table_name, (pii.get(c.table_name) ?? 0) + 1)
    f.personal_data_tables = Object.fromEntries([...pii].sort())
  } catch { /* facts are best effort */ }
  return f
}

export async function runChecks(db, opts) {
  const ctx = await buildContext(db, opts)
  const only = opts.only, skip = opts.skip
  const wanted = (id) => (!only.length || only.some((p) => id === p || id.startsWith(p + '.') || id.startsWith(p))) && !skip.some((p) => id === p || id.startsWith(p + '.'))
  const results = []
  for (const c of CHECKS) {
    if (!wanted(c.id)) continue
    let r
    try { r = await c.run(ctx) } catch (e) {
      r = e instanceof SqlError && PRIV_ERRNO.has(e.errno) ? unknown(privReason(e, 'something this check needs'))
        : unknown(`the check could not run: ${trunc(e.message, 160)}`)
    }
    const accepted = opts.accept.includes(c.id) && r.status === 'FAIL'
    results.push({ id: c.id, category: c.category, title: c.title, severity: c.severity, status: r.status, accepted, detail: r.detail ?? null, reason: r.reason ?? null, items: r.items ?? [] })
  }
  const facts = await collectFacts(ctx)
  return { ctx, results, facts }
}

export function summarize(results) {
  const s = { pass: 0, fail: 0, unknown: 0, accepted: 0 }
  for (const r of results) {
    if (r.status === 'PASS') s.pass++
    else if (r.status === 'UNKNOWN') s.unknown++
    else if (r.accepted) s.accepted++
    else s.fail++
  }
  return s
}

// ===========================================================================
// 8. OUTPUT
// ===========================================================================

export function fixesMarkdown() {
  const lines = [
    '<!-- GENERATED by `node scripts/db-security-audit.mjs --fixes-md`. Do not edit by hand: edit FIXES in the script. -->',
    '# Database audit: what each FAIL means and the fix',
    '',
    'Run the audit (read-only) with `node scripts/db-security-audit.mjs`; each FAIL names one of the ids below.',
    'Every fix is applied through the project\'s job route (a one-shot job on the VPS), after a backup, and only on the',
    'owner\'s say-so. Nothing here has been applied. `NAME`/`HOST`/`TABLE` stand for what the FAIL printed.',
    '',
    '| Check id | Severity | What it means | Fix | Where / how |',
    '|---|---|---|---|---|',
  ]
  const esc = (s) => String(s).replace(/\|/g, '\\|')
  const isCode = (l) => /^(DROP|REVOKE|ALTER|SET|INSTALL|RENAME|UPDATE|DELETE|PURGE|GRANT|SHOW|SELECT|--|SHOW CREATE)/.test(l)
  const cell = (arr) => arr.map((l) => (isCode(l) ? '`' + esc(l).replace(/`/g, "'") + '`' : esc(l))).join('<br>')
  for (const c of CHECKS) {
    const f = FIXES[c.id]
    lines.push(`| \`${c.id}\` | ${f.sev} | ${esc(f.means)} | ${cell(f.fix)} | ${esc(f.where)} |`)
  }
  lines.push('', '## UNKNOWN is not a pass', '', 'UNKNOWN means the connecting account cannot look, or the answer lives on the host. Re-run with an auditor account',
    '(see HOST-CHECKLIST.md, "Full-visibility audit account") or run the host job. `--accept ID` records a decision to live with a FAIL;',
    'it is printed as accepted and never counted as a pass.', '')
  return lines.join('\n')
}

function render(opts, conn, run) {
  const { results, facts } = run
  const sum = summarize(results)
  const out = []
  out.push(`${TOOL.name} ${TOOL.version} — READ ONLY (tx_read_only=1; SELECT/SHOW through a gate; nothing is written)`)
  out.push(`server ${facts.flavour} ${facts.server} · schema ${facts.schema ?? '(none)'} · as ${facts.connected_as} · ${conn.transport}${conn.tls ? ` + TLS${conn.tlsVerified ? ' (certificate verified)' : ' (certificate not verified)'}` : ' (no TLS on this connection)'}`)
  let cat = ''
  const reasons = new Map()
  for (const r of results) {
    if (r.category !== cat) { cat = r.category; out.push('', cat.toUpperCase()) }
    const tag = r.status === 'FAIL' ? (r.accepted ? 'ACCEPT' : 'FAIL  ') : r.status === 'PASS' ? 'PASS  ' : 'UNKNWN'
    const sev = r.status === 'FAIL' && !r.accepted ? ` [${r.severity}]` : ''
    let text = r.status === 'UNKNOWN' ? r.reason : r.detail
    if (r.status === 'UNKNOWN' && text.length > 60) { if (reasons.has(text)) text = `(same reason as ${reasons.get(text)})`; else reasons.set(text, r.id) }
    out.push(`  ${tag} ${r.id}${sev}  ${text}`)
    if (r.status !== 'PASS') for (const i of r.items.slice(0, 12)) out.push(`           - ${i}`)
    if (r.status !== 'PASS' && r.items.length > 12) out.push(`           - … ${r.items.length - 12} more`)
    if (r.status === 'PASS' && r.items.length) for (const i of r.items.slice(0, 6)) out.push(`           · ${i}`)
  }
  out.push('', `SUMMARY  pass ${sum.pass}  fail ${sum.fail}  unknown ${sum.unknown}${sum.accepted ? `  accepted ${sum.accepted}` : ''}`)
  const bad = results.filter((r) => r.status === 'FAIL' && !r.accepted).sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity))
  if (bad.length) out.push(`FAIL by severity: ${bad.map((r) => `${r.id}(${r.severity})`).join(', ')}`, 'What each FAIL means and the fix: ops/db/AUDIT-FIXES.md (or --fixes-md).')
  if (sum.unknown) out.push('UNKNOWN = this account cannot look, or the answer is on the host. It is not a pass.')
  return out.join('\n')
}

// ===========================================================================
// 9. CLI
// ===========================================================================

export function parseArgs(argv) {
  const flag = (f) => argv.includes(f)
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const list = (f) => (arg(f) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const numArg = (f, d) => { const v = arg(f); return v === undefined ? d : Number(v) }
  const known = new Set(['--config', '--json', '--no-fail', '--strict', '--only', '--skip', '--accept', '--schema', '--limit', '--mask-names', '--tls', '--tls-ca', '--tls-name',
    '--now', '--order-retention-days', '--location-retention-days', '--log-retention-days', '--max-password-age-days', '--allow-ddl', '--accounts-source', '--list',
    '--fixes-md', '--help', '-h', '--host', '--port', '--socket', '--user', '--database', '--quiet', '--auditor', '--connect-timeout'])
  const unknownFlags = argv.filter((a) => a.startsWith('--') && !known.has(a))
  return {
    unknownFlags,
    config: arg('--config'), json: flag('--json'), noFail: flag('--no-fail'), strict: flag('--strict'), mask: flag('--mask-names'), quiet: flag('--quiet'),
    only: list('--only'), skip: list('--skip'), accept: list('--accept'), allowDdl: list('--allow-ddl'), auditor: list('--auditor'),
    schema: arg('--schema'), limit: Math.max(1, numArg('--limit', 20000)),
    tls: flag('--tls') || !!arg('--tls-ca'), tlsCa: arg('--tls-ca') ? readFileSync(arg('--tls-ca')) : undefined, tlsName: arg('--tls-name'),
    now: arg('--now'), accountsSource: arg('--accounts-source') ?? 'auto',
    orderRetentionDays: numArg('--order-retention-days', null), locationRetentionDays: numArg('--location-retention-days', 90),
    logRetentionDays: numArg('--log-retention-days', 365), maxPasswordAgeDays: numArg('--max-password-age-days', 365),
    connectTimeout: Math.max(1, numArg('--connect-timeout', 30)),
    list: flag('--list'), fixesMd: flag('--fixes-md'), help: flag('--help') || flag('-h'),
    host: arg('--host'), port: arg('--port'), socket: arg('--socket'), user: arg('--user'), database: arg('--database'),
  }
}

export function scrubber(cred) {
  const secrets = [cred?.password].filter((s) => s && s.length >= 4)
  return (text) => secrets.reduce((t, s) => t.split(s).join('[redacted]'), text)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv)
  if (opts.unknownFlags.length) { console.error(`${TOOL.name}: unknown flag ${opts.unknownFlags[0]} (see --help)`); return 2 }
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return 0
  }
  if (opts.list) { for (const c of CHECKS) console.log(`${c.id.padEnd(30)} ${c.severity.padEnd(7)} ${c.title}`); return 0 }
  if (opts.fixesMd) { console.log(fixesMarkdown()); return 0 }
  for (const a of opts.accept) if (!CHECKS.some((c) => c.id === a)) { console.error(`${TOOL.name}: --accept names an unknown check id: ${a}`); return 2 }
  const cred = credentials(opts, env)
  if (cred.error) { console.error(`${TOOL.name}: ${cred.error}`); return 2 }
  cred.tls = opts.tls; cred.tlsCa = opts.tlsCa; cred.tlsName = opts.tlsName; cred.connectMs = opts.connectTimeout * 1000
  const scrub = scrubber(cred)
  let db
  try { db = await openReadOnlySession(cred) } catch (e) {
    const hint = !e.notReadOnly && /\(1045\)/.test(e.message)
      ? `${cred.source === 'config' && !cred.password ? ' (the config file gave no password: is the secret file it reads mounted?)' : ''}${!cred.tls ? ' (if the server sets require_secure_transport, retry with --tls or --tls-ca FILE)' : ''}`
      : ''
    console.error(scrub(`${TOOL.name}: ${e.notReadOnly ? e.message : `cannot connect: ${e.message}`}${hint}`))
    return 2
  }
  let run
  try { run = await runChecks(db, opts) } catch (e) {
    console.error(scrub(`${TOOL.name}: ${e.message}`)); db.end(); return 2
  }
  await db.setup('ROLLBACK').catch(() => { /* nothing to roll back */ })
  db.end()
  const conn = { transport: cred.socket ? 'unix socket' : 'tcp', tls: db.tls, tlsVerified: db.tlsVerified }
  const sum = summarize(run.results)
  if (opts.json) {
    console.log(scrub(JSON.stringify({ tool: TOOL, read_only: true, connection: conn, server: { version: run.facts.server, flavour: run.facts.flavour }, schema: run.facts.schema, summary: sum,
      checks: run.results.map((r) => ({ ...r, fix: r.status === 'FAIL' ? `ops/db/AUDIT-FIXES.md#${r.id}` : null })), facts: run.facts }, null, 2)))
  } else if (!opts.quiet) console.log(scrub(render(opts, conn, run)))
  if (opts.noFail) return 0
  return sum.fail || (opts.strict && sum.unknown) ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Leave only after stdout has drained: a long report piped into a job log must not be cut.
  const leave = (code) => process.stdout.write('', () => process.exit(code))
  main().then(leave, (e) => { console.error(`${TOOL.name}: ${e.message}`); leave(2) })
}
