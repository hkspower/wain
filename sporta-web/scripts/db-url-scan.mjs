#!/usr/bin/env node
// DB URL SCAN — every URL-shaped value in every text column of the shop's
// database, reported as HOSTS PER table.column, never as row contents.
//
//   node scripts/db-url-scan.mjs                       (credentials from the environment)
//   node scripts/db-url-scan.mjs --config /run/sporta-api-config.php
//   node scripts/db-url-scan.mjs --json                (machine-readable, same rules)
//   node scripts/db-url-scan.mjs --no-fail             (exit 0 even with UNKNOWN hosts)
//   node scripts/db-url-scan.mjs --limit 20000         (rows read per column, default 5000)
//   node scripts/db-url-scan.mjs --tables orders,products
//
// WHY IT EXISTS. The URL-bearing rows a healthy Sporta database holds are
// few and known: product photo paths under /images/products/, hero buttons and
// the promo bar pointing at same-origin paths, brand logos and hero photographs
// as data:image/(png|jpeg|webp) rows, and the optional checkout location line
// (a www.google.com/maps link) inside an order note. Anything else — a slide
// pointed at an affiliate site, a "logo" whose data: URI is really HTML, a
// phishing link in a note the picker reads in the warehouse mail — is a row
// that should not exist, and the only way to know is to look at every column.
//
// READ-ONLY, BY CONSTRUCTION, NOT BY PROMISE.
//   * The session is put in READ ONLY mode and the work runs inside
//     START TRANSACTION READ ONLY; the server then refuses every write (error
//     1792) whatever the account can do. The scan asserts @@tx_read_only = 1
//     before it reads a single row and stops if it is not.
//   * Nothing but SELECT is sent after that; the transaction ends with ROLLBACK.
//   * Pair it with a SELECT-only account where one exists; the mode above holds
//     even with a full-privilege account.
//
// WHAT IS PRINTED, AND WHAT NEVER IS.
//   * Per table.column: rows scanned, rows that carry a URL-shaped value, and
//     the distinct HOSTS with how many rows carry each, classified KNOWN,
//     UNKNOWN or DANGEROUS (javascript:, data:text/html, vbscript:...).
//   * For the structural URL columns (STRUCTURAL below — the ones that are
//     SUPPOSED to hold a link or a data: image) a sample of the path: the first
//     40 characters with every digit replaced by #.
//   * For every other column — names, addresses, notes, messages — hosts only.
//     No path, no local part of an email, no phone number, no row id, no name.
//     Columns whose name contains email, password, secret, token, hash or totp
//     are never read at all.
//   * Credentials are never printed, not even masked.
//
// CREDENTIALS, in this order (first found wins):
//   --config <file>        a PHP file returning an array with db_host, db_name,
//                          db_user, db_pass (the store's api config shape;
//                          db_host may carry ';port=N' or ';unix_socket=PATH')
//   SPORTA_API_CONFIG_FILE the same file, named the way the store names it
//   DB_HOST DB_PORT DB_SOCKET DB_USER DB_PASSWORD DB_NAME, each also accepted
//                          as DB_*_FILE naming a file that holds the value
//                          (Docker-secret style: the live VPS keeps db_name,
//                          db_user and db_pass as 0600 files)
//
// NO DEPENDENCIES. The MySQL client below speaks the text protocol itself
// (handshake v10, mysql_native_password, COM_QUERY), so the script runs in a
// bare node:24-alpine job on the VPS with nothing installed. It does not
// support TLS, caching_sha2_password or ed25519; MariaDB's default
// mysql_native_password over a private network or a unix socket is the case
// it is written for.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const JSON_OUT = flag('--json')
const NO_FAIL = flag('--no-fail')
const LIMIT = Math.max(1, Number(argOf('--limit') ?? 5000))
const ONLY_TABLES = (argOf('--tables') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const QUIET = flag('--quiet')

// ---------------------------------------------------------------------------
// Allow-list: what a URL in THIS database may legitimately point at, and why.
// A host here is KNOWN only because the line says why. Add a line when the
// owner decides something; never to make a scan green.
const KNOWN_HOSTS = {
  'www.sporta.com.kw': 'the shop itself (canonical origin)',
  'sporta.com.kw': 'the shop, non-canonical spelling (should be www; still ours)',
  'www.google.com': 'checkout "Share my location" writes https://www.google.com/maps?q=LAT,LNG into the order note (CLAUDE.md item 5)',
  'maps.google.com': 'older spelling of the same Google Maps link',
  'wa.me': 'WhatsApp click-to-chat links (WHATSAPP.md)',
  'www.instagram.com': 'the shop\'s Instagram (footer)',
  'instagram.com': 'the shop\'s Instagram (footer)',
  'www.tiktok.com': 'the shop\'s TikTok (footer)',
  'schema.org': 'JSON-LD vocabulary namespace',
  'www.w3.org': 'XML/SVG namespace',
}
// data: URIs the row stores on purpose: brand logos and hero photographs, as
// png/jpeg/webp with the matching magic number (store_data_image()).
const KNOWN_DATA = new Set(['data:image/png', 'data:image/jpeg', 'data:image/webp'])
// Same-origin paths that the structural columns legitimately hold.
const KNOWN_PATH = /^\/(images\/products\/|cats\/|hero\/|shop|product\/|about|contact|returns|track|wishlist|cart|checkout|terms|privacy|$)/

// Columns that are SUPPOSED to hold a link or a data: image. Only these get a
// (masked) path sample in the report; every other column is hosts-only.
const STRUCTURAL = new Set([
  'products.image', 'products.images', 'hero_slides.cta_href', 'hero_slides.image',
  'brands.logo', 'settings.value',
])
// Never read: nothing useful can be in them and reading them is a liability.
const NEVER_READ = /(email|password|secret|token|_hash$|totp|google_sub|session)/i

// ---------------------------------------------------------------------------
// URL-shaped tokens. The same family url-inventory-test.mjs uses on the repo.
const SCHEME_RE = /\b(https?|ftps?|sftp|ssh|wss?|git|file|smtps?|ldaps?):\/\/([^\s"'`<>()\[\]{}\\,;|]*)/gi
const PROTO_REL_RE = /(?<![:\w\/])\/\/((?:[a-z0-9-]+\.)+[a-z]{2,}|[0-9]{1,3}(?:\.[0-9]{1,3}){3})(?::\d+)?(\/[^\s"'`<>()\[\]{}\\,;|]*)?/gi
const PSEUDO_RE = /\b(javascript|vbscript|mailto|tel|sms|data|blob|intent|ms-msdt|search-ms):/gi
const WWW_RE = /(?<![\w@\/.-])(www\.(?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w-])/gi
const TLDS = 'com|net|org|io|kw|dev|app|ai|cloud|me|co|uk|info|biz|xyz|tv|us|sa|ae|qa|bh|om|eg|jo|lb|tr|in|ru|cn|de|fr|es|it|nl|se|ch|link|site|online|shop|store|page|click|top|live|icu|cc|ly|gl|to|be|at|sh|gg|lol|zip|mov|review|one|pro|club|vip|win|work|money|cash'
const BARE_RE = new RegExp(`(?<![\\w@\\/.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w-])(?!\\()`, 'gi')
// Rows worth fetching at all: a server-side pre-filter that cuts the transfer
// to rows that can contain a token. Over-inclusive on purpose.
const SQL_PREFILTER = "(?i)(https?:|ftps?:|sftp:|ssh:|wss?:|file:|//|www[.]|data:|javascript:|vbscript:|mailto:|tel:|blob:|[a-z0-9-]+[.](com|net|org|io|kw|dev|app|ai|cloud|me|co|uk|info|biz|xyz|tv|link|site|online|shop|store|page|click|top|live|icu|cc|ly|gl|to|zip|mov)([^a-z0-9-]|$))"

function maskPath(p) {
  return String(p ?? '').replace(/[0-9]/g, '#').slice(0, 40)
}

// Classify one token: returns { host, kind, path, verdict }.
function classify(kind, host, path, extra) {
  if (kind === 'data') {
    const label = String(host).toLowerCase()
    if (KNOWN_DATA.has(label)) {
      return { host: label, kind, path: '', verdict: extra?.magicOk === false ? 'DANGEROUS' : 'KNOWN',
        note: extra?.magicOk === false ? 'labelled image but the bytes are not that image' : undefined }
    }
    return { host: label, kind, path: '', verdict: /^data:(text|application|image\/svg)/.test(label) ? 'DANGEROUS' : 'UNKNOWN' }
  }
  if (kind === 'javascript' || kind === 'vbscript' || kind === 'blob' || kind === 'intent' || kind === 'ms-msdt' || kind === 'search-ms') {
    return { host: `(${kind}:)`, kind, path: '', verdict: 'DANGEROUS' }
  }
  if (kind === 'mailto') return { host: host ? `(mailto:) ${host}` : '(mailto:)', kind, path: '', verdict: 'UNKNOWN' }
  if (kind === 'tel' || kind === 'sms') return { host: `(${kind}:)`, kind, path: '', verdict: 'UNKNOWN' }
  if (kind === 'path') {
    return { host: '(same-origin path)', kind, path: maskPath(path), verdict: KNOWN_PATH.test(path) ? 'KNOWN' : 'UNKNOWN' }
  }
  const h = String(host).toLowerCase().replace(/\.$/, '')
  const verdict = KNOWN_HOSTS[h] ? 'KNOWN' : 'UNKNOWN'
  return { host: h, kind, path: maskPath(path), verdict }
}

// Tokens in one value. Also decides whether a data:image/* really is one.
function tokensOf(value, structural) {
  const out = []
  const s = String(value)
  const seen = new Set()
  const push = (t) => { const k = `${t.kind}|${t.host}`; if (!seen.has(k)) { seen.add(k); out.push(t) } }
  for (const m of s.matchAll(SCHEME_RE)) {
    const rest = m[2]
    const host = rest.split(/[\/?#]/)[0].replace(/^.*@/, '').replace(/:\d+$/, '')
    const path = rest.slice(host.length).replace(/^:\d+/, '')
    push(classify(m[1].toLowerCase(), host, path))
  }
  for (const m of s.matchAll(PROTO_REL_RE)) push(classify('protocol-relative', m[1], m[2] ?? ''))
  for (const m of s.matchAll(PSEUDO_RE)) {
    const kind = m[1].toLowerCase()
    if (kind === 'data') {
      const at = m.index
      const label = (s.slice(at, at + 40).match(/^data:([a-z0-9.+\/-]+)/i) ?? [, ''])[1].toLowerCase()
      let magicOk
      if (KNOWN_DATA.has(`data:${label}`)) {
        const b64 = s.slice(at).match(/^data:[^,]*;base64,([A-Za-z0-9+\/=\s]{0,64})/)
        if (b64) {
          const bytes = Buffer.from(b64[1].replace(/\s+/g, ''), 'base64')
          const magic = { 'image/png': '89504e470d0a1a0a', 'image/jpeg': 'ffd8ff', 'image/webp': '52494646' }[label]
          magicOk = bytes.toString('hex').startsWith(magic) && (label !== 'image/webp' || bytes.slice(8, 12).toString() === 'WEBP')
        } else magicOk = false
      }
      push(classify('data', `data:${label}`, '', { magicOk }))
    } else if (kind === 'mailto') {
      const dom = (s.slice(m.index + 7).match(/^[^\s@]+@([a-z0-9.-]+)/i) ?? [, ''])[1].toLowerCase()
      push(classify('mailto', dom, ''))
    } else push(classify(kind, '', ''))
  }
  for (const m of s.matchAll(WWW_RE)) push(classify('bare-www', m[1], ''))
  for (const m of s.matchAll(BARE_RE)) {
    const h = m[1].toLowerCase()
    if (/^www\./.test(h)) continue
    push(classify('bare', h, ''))
  }
  // A structural column holding a plain path (products.image, cta_href) is a
  // same-origin link: report it so an unexpected path (a .php, a traversal)
  // shows up, and so the report says what the column normally holds.
  if (structural && out.length === 0 && /^\//.test(s.trim())) {
    for (const one of s.split(',')) { const p = one.trim(); if (p.startsWith('/')) push(classify('path', '', p)) }
  }
  // settings.value is JSON: an "href" inside it that is a path is reported the same way.
  if (structural && /^[{\[]/.test(s.trim())) {
    for (const m of s.matchAll(/"(?:href|url|link|image|src)"\s*:\s*"((?:\\\/|\/)[^"]*)"/g)) push(classify('path', '', m[1].replace(/\\\//g, '/')))
  }
  return out
}

// ---------------------------------------------------------------------------
// Credentials. Resolved, used, never printed.
function readFileTrim(p) { return readFileSync(p, 'utf8').replace(/\r?\n$/, '') }
function phpArray(file) {
  // The store's config is a PHP file returning an array of scalars. A regex
  // read is enough for the four db_* keys and avoids needing php in the job.
  const src = readFileSync(file, 'utf8')
  const get = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`))
    if (!m) return undefined
    return (m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1')
  }
  // The VPS keeps db_name/db_user/db_pass as files and reads them with
  // trim(file_get_contents('/run/sporta-config/db_x')): honour that shape too.
  const getFile = (k) => {
    const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:trim\\()?\\s*(?:@)?file_get_contents\\(\\s*'([^']+)'`))
    return m ? readFileTrim(m[1]) : undefined
  }
  const v = {}
  for (const k of ['db_host', 'db_name', 'db_user', 'db_pass']) v[k] = get(k) ?? getFile(k)
  return v
}
function envOrFile(name) {
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name]
  const f = process.env[`${name}_FILE`]
  return f ? readFileTrim(f) : undefined
}
function credentials() {
  const cfgFile = argOf('--config') ?? process.env.SPORTA_API_CONFIG_FILE
  let host, port, socket, user, password, database
  if (cfgFile) {
    const c = phpArray(cfgFile)
    host = c.db_host; user = c.db_user; password = c.db_pass; database = c.db_name
  }
  host ??= envOrFile('DB_HOST'); user ??= envOrFile('DB_USER'); password ??= envOrFile('DB_PASSWORD') ?? envOrFile('DB_PASS')
  database ??= envOrFile('DB_NAME'); socket = envOrFile('DB_SOCKET'); port = envOrFile('DB_PORT')
  // The store spells a port or socket inside db_host: "127.0.0.1;port=3393",
  // "localhost;unix_socket=/run/mysqld/mysqld.sock".
  if (host && host.includes(';')) {
    const [h, ...rest] = host.split(';'); host = h
    for (const kv of rest) { const [k, v] = kv.split('='); if (k === 'port') port ??= v; if (k === 'unix_socket') socket ??= v }
  }
  if (!socket && (host === 'localhost' || !host) && !port && process.platform !== 'win32') {
    for (const p of ['/run/mysqld/mysqld.sock', '/var/run/mysqld/mysqld.sock', '/tmp/mysql.sock']) {
      try { readFileSync(p); } catch (e) { if (e.code === 'ENXIO' || e.code === 'EACCES') { socket = p; break } }
    }
  }
  if (!user || !database) {
    console.error('db-url-scan: no credentials (need --config <php file>, SPORTA_API_CONFIG_FILE, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME).')
    process.exit(2)
  }
  return { host: host || '127.0.0.1', port: Number(port || 3306), socket, user, password: password ?? '', database }
}

// ---------------------------------------------------------------------------
// A minimal MySQL text-protocol client: handshake v10, mysql_native_password,
// COM_QUERY, result sets. Enough for SELECTs and SETs; nothing else is sent.
const CAP = { LONG_PASSWORD: 1, LONG_FLAG: 4, CONNECT_WITH_DB: 8, PROTOCOL_41: 0x200, TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000, MULTI_RESULTS: 0x20000, PLUGIN_AUTH: 0x80000, PLUGIN_AUTH_LENENC: 0x200000 }

class MySQL {
  constructor(opts) { this.o = opts; this.buf = Buffer.alloc(0); this.waiters = []; this.inbox = []; this.seq = 0 }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = this.o.socket ? connect(this.o.socket) : connect(this.o.port, this.o.host)
      this.sock.setNoDelay?.(true)
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump() })
      this.sock.on('error', (e) => { const w = this.waiters.shift(); if (w) w.reject(e); else if (!this.ready) reject(e) })
      this.sock.on('close', () => { for (const w of this.waiters.splice(0)) w.reject(new Error('connection closed')) })
      this.sock.once('connect', async () => {
        try { await this.handshake(); this.ready = true; resolve() } catch (e) { reject(e) }
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
      // A packet of exactly 0xffffff bytes continues in the next one.
      if (len === 0xffffff) { this.partial = Buffer.concat([this.partial ?? Buffer.alloc(0), payload]); continue }
      const whole = this.partial ? Buffer.concat([this.partial, payload]) : Buffer.from(payload)
      this.partial = undefined
      this.seq = seq + 1
      // A packet that arrives before anyone asked for it is queued, never
      // dropped: a result set's rows stream in faster than they are consumed.
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
  async handshake() {
    const p = await this.packet()
    if (p[0] === 0xff) throw new Error(`server refused: ${p.subarray(3).toString()}`)
    if (p[0] !== 10) throw new Error(`unsupported protocol ${p[0]}`)
    let i = 1
    while (p[i] !== 0) i++
    i++ // server version
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
    const caps = CAP.LONG_PASSWORD | CAP.LONG_FLAG | CAP.CONNECT_WITH_DB | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH
    if (plugin !== 'mysql_native_password') throw new Error(`auth plugin ${plugin} is not supported by this client (mysql_native_password only)`)
    const auth = MySQL.scramble(this.o.password, salt)
    const resp = Buffer.concat([
      u32(caps), u32(16 * 1024 * 1024), Buffer.from([45]), Buffer.alloc(23),
      Buffer.from(this.o.user + '\0'), Buffer.from([auth.length]), auth,
      Buffer.from(this.o.database + '\0'), Buffer.from('mysql_native_password\0'),
    ])
    this.send(resp, 1)
    let r = await this.packet()
    if (r[0] === 0xfe) {
      // Auth switch request: only the native plugin is honoured.
      let j = 1; while (r[j] !== 0) j++
      const name = r.subarray(1, j).toString()
      if (name !== 'mysql_native_password') throw new Error(`auth switch to ${name} is not supported`)
      const newSalt = r.subarray(j + 1, j + 21)
      this.send(MySQL.scramble(this.o.password, newSalt), this.seq)
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
      // catalog, schema, table, org_table, name, org_name — each lenenc string
      let pos = 0, name = ''
      for (let f = 0; f < 5; f++) { const [l, n] = lenenc(def, pos); pos = n; name = def.subarray(pos, pos + l).toString(); pos += l }
      columns.push(name)
    }
    let eof = await this.packet()
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
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
function lenenc(b, pos) {
  const f = b[pos]
  if (f < 0xfb) return [f, pos + 1]
  if (f === 0xfc) return [b.readUInt16LE(pos + 1), pos + 3]
  if (f === 0xfd) return [b.readUIntLE(pos + 1, 3), pos + 4]
  return [Number(b.readBigUInt64LE(pos + 1)), pos + 9]
}

// ---------------------------------------------------------------------------
// The scan.
const q = (s) => '`' + String(s).replace(/`/g, '``') + '`'
const sqlStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"

async function main() {
  const cred = credentials()
  const db = new MySQL(cred)
  const say = (s) => { if (!JSON_OUT && !QUIET) console.log(s) }
  try { await db.connect() } catch (e) { console.error(`db-url-scan: cannot connect: ${e.message}`); process.exit(2) }

  // Read-only, asserted, before anything is read.
  await db.query('SET SESSION TRANSACTION READ ONLY')
  await db.query('START TRANSACTION READ ONLY')
  const ro = await db.query('SELECT @@session.tx_read_only')
  if (String(ro.rows[0]?.[0]) !== '1') { console.error('db-url-scan: the session is not read-only; stopping before any read.'); db.end(); process.exit(2) }
  await db.query('SET SESSION max_statement_time = 60').catch(() => { /* MySQL rather than MariaDB: no such variable */ })

  const cols = await db.query(
    "SELECT table_name, column_name, data_type, character_maximum_length FROM information_schema.columns " +
    "WHERE table_schema = DATABASE() AND data_type IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob','enum','set') " +
    'ORDER BY table_name, ordinal_position')
  const tables = [...new Set(cols.rows.map((r) => r[0]))].filter((t) => !ONLY_TABLES.length || ONLY_TABLES.includes(t))
  const rowCount = {}
  for (const t of tables) rowCount[t] = Number((await db.query(`SELECT COUNT(*) FROM ${q(t)}`)).rows[0][0])

  const report = []      // { column, type, rows, hits, skipped, hosts: [{host, kind, verdict, rows, sample, note}] }
  let unknownTotal = 0, dangerousTotal = 0, hitsTotal = 0
  for (const [table, column, type, maxLen] of cols.rows) {
    if (!tables.includes(table)) continue
    const key = `${table}.${column}`
    if (NEVER_READ.test(column)) { report.push({ column: key, type, rows: rowCount[table], hits: 0, skipped: 'never read (credential or personal column)', hosts: [] }); continue }
    const structural = STRUCTURAL.has(key)
    // Pre-filter on the server; the full token pass happens here on what comes
    // back. A structural column is read whole, so the report also says what it
    // NORMALLY holds (47 same-origin photo paths, say) next to the odd one out.
    const sel = await db.query(
      `SELECT ${q(column)} FROM ${q(table)} WHERE ${q(column)} IS NOT NULL AND ${q(column)} <> ''` +
      (structural ? '' : ` AND ${q(column)} REGEXP ${sqlStr(SQL_PREFILTER)}`) + ` LIMIT ${LIMIT}`)
    const agg = new Map()
    let hits = 0
    for (const [value] of sel.rows) {
      const toks = tokensOf(value, structural)
      if (!toks.length) continue
      hits++
      for (const t of toks) {
        const k = `${t.kind}|${t.host}|${t.verdict}`
        const e = agg.get(k) ?? { host: t.host, kind: t.kind, verdict: t.verdict, rows: 0, sample: undefined, note: t.note }
        e.rows++
        if (structural && e.sample === undefined && t.path) e.sample = t.path
        agg.set(k, e)
      }
    }
    const hosts = [...agg.values()].sort((a, b) => (a.verdict === b.verdict ? b.rows - a.rows : a.verdict.localeCompare(b.verdict)))
    for (const h of hosts) { if (h.verdict === 'UNKNOWN') unknownTotal++; if (h.verdict === 'DANGEROUS') dangerousTotal++ }
    hitsTotal += hits
    report.push({ column: key, type: maxLen ? `${type}(${maxLen})` : type, rows: rowCount[table], hits, truncated: sel.rows.length >= LIMIT, hosts })
  }
  await db.query('ROLLBACK').catch(() => { /* nothing to roll back */ })
  db.end()

  const summary = { database: 'scanned', tables: tables.length, columns: report.length, rows_with_urls: hitsTotal,
    unknown_hosts: unknownTotal, dangerous: dangerousTotal, limit_per_column: LIMIT, read_only: true }
  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, columns: report }, null, 2))
  } else {
    console.log(`db-url-scan — read-only (tx_read_only=1), ${tables.length} tables, ${report.length} text columns, ${LIMIT} rows/column max`)
    for (const c of report) {
      if (c.skipped) { if (!QUIET) console.log(`  ${c.column.padEnd(40)} ${String(c.type).padEnd(16)} rows ${String(c.rows).padStart(6)}  (${c.skipped})`); continue }
      if (!c.hits && QUIET) continue
      console.log(`  ${c.column.padEnd(40)} ${String(c.type).padEnd(16)} rows ${String(c.rows).padStart(6)}  with-url ${String(c.hits).padStart(5)}${c.truncated ? '  (LIMIT reached)' : ''}`)
      for (const h of c.hosts) {
        const tag = h.verdict === 'KNOWN' ? 'known    ' : h.verdict === 'UNKNOWN' ? 'UNKNOWN  ' : 'DANGEROUS'
        console.log(`      ${tag} ${String(h.rows).padStart(5)}  ${h.kind.padEnd(18)} ${h.host}${h.sample ? `  path≈ ${h.sample}` : ''}${h.note ? `  — ${h.note}` : ''}`)
      }
    }
    const knownSeen = new Set(report.flatMap((c) => c.hosts.filter((h) => h.verdict === 'KNOWN' && KNOWN_HOSTS[h.host]).map((h) => h.host)))
    if (knownSeen.size) { console.log('\nknown hosts seen, and why they are known:'); for (const h of knownSeen) console.log(`  ${h.padEnd(22)} ${KNOWN_HOSTS[h]}`) }
    console.log(`\n${hitsTotal} rows carry a URL-shaped value; ${unknownTotal} UNKNOWN host/column pairs; ${dangerousTotal} DANGEROUS.`)
  }
  say('')
  process.exit(!NO_FAIL && (unknownTotal || dangerousTotal) ? 1 : 0)
}

main().catch((e) => { console.error(`db-url-scan: ${e.message}`); process.exit(2) })
