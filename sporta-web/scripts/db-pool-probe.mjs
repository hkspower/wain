#!/usr/bin/env node
// DB POOL PROBE — what the database server is configured for, how many connections it holds right now, and what
// opening a connection COSTS from the machine this runs on. READ-ONLY: SELECT, SHOW and COM_PING, nothing else.
//
//   node scripts/db-pool-probe.mjs --config /run/sporta-api-config.php          (inside the web container: the store's own config)
//   node scripts/db-pool-probe.mjs --config <file> --json
//   node scripts/db-pool-probe.mjs --host 127.0.0.1 --port 3306 --user U --password-file F --database D
//   node scripts/db-pool-probe.mjs ... --samples 300 --request-ms 12
//
// WHY IT EXISTS. The questions that decide whether persistent connections are worth anything on the live VPS
// cannot be answered from the repository: MariaDB's max_connections and thread_handling on the live 11.8
// container, how many connections the shop holds at this moment, and above all the ROUND-TRIP TIME between the
// Apache container and the database container. Pooling saves (cost of opening a connection) minus (the two
// round trips a pooled request spends instead: PHP's COM_PING and the pool's one reset statement). That
// difference is a few hundred microseconds when the database is on the same host and a few milliseconds when it is
// not. This tool measures both sides where the PHP runs, prints the difference, and says what share of a request
// it is. Run it in the web container (or in a job on the same Docker network), not on a laptop.
//
// NO DEPENDENCIES. The MySQL client below is the one scripts/db-url-scan.mjs uses (handshake v10,
// mysql_native_password, COM_QUERY), plus COM_PING, so it runs in a bare node:24-alpine job. It does not
// support TLS, caching_sha2_password or ed25519.
//
// CREDENTIALS, in this order: --config <php file> (the store's api config: db_host, db_name, db_user, db_pass,
// plain strings or file_get_contents('/run/...') as on the VPS) | SPORTA_API_CONFIG_FILE | DB_HOST DB_PORT
// DB_SOCKET DB_USER DB_PASSWORD DB_NAME (each also as DB_*_FILE). Never printed.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { cpus, loadavg } from 'node:os'

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const JSON_OUT = flag('--json')
const SAMPLES = Math.max(20, Number(argOf('--samples') ?? 200))
const REQUEST_MS = Number(argOf('--request-ms') ?? 10)   // a typical request, for the percentage; the benchmark measured ~8-40 ms
const ABSURD_RTT_MS = 5

// ---------------------------------------------------------------------------
// credentials (same shapes as db-url-scan.mjs)
const readTrim = (p) => readFileSync(p, 'utf8').replace(/\r?\n$/, '')
function phpArray(file) {
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
  const persistent = src.match(/['"]db_persistent['"]\s*=>\s*([^,\n]+)/)
  const slots = src.match(/['"]db_persistent_slots['"]\s*=>\s*([^,\n]+)/)
  v.db_persistent = persistent ? persistent[1].trim() : '(absent: off)'
  v.db_persistent_slots = slots ? slots[1].trim() : '(absent: defaults)'
  return v
}
const envOrFile = (name) => {
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name]
  const f = process.env[`${name}_FILE`]
  return f ? readTrim(f) : undefined
}
function credentials() {
  const cfgFile = argOf('--config') ?? process.env.SPORTA_API_CONFIG_FILE
  let host, port, socket, user, password, database, cfg = null
  if (cfgFile) { cfg = phpArray(cfgFile); host = cfg.db_host; user = cfg.db_user; password = cfg.db_pass; database = cfg.db_name }
  host = argOf('--host') ?? host ?? envOrFile('DB_HOST'); user = argOf('--user') ?? user ?? envOrFile('DB_USER')
  const pf = argOf('--password-file')
  password = (pf ? readTrim(pf) : undefined) ?? password ?? envOrFile('DB_PASSWORD') ?? envOrFile('DB_PASS')
  database = argOf('--database') ?? database ?? envOrFile('DB_NAME'); socket = envOrFile('DB_SOCKET'); port = argOf('--port') ?? envOrFile('DB_PORT')
  if (host && host.includes(';')) {
    const [h, ...rest] = host.split(';'); host = h
    for (const kv of rest) { const [k, v] = kv.split('='); if (k === 'port') port ??= v; if (k === 'unix_socket') socket ??= v }
  }
  if (!user || !database) { console.error('db-pool-probe: no credentials (need --config <php file>, SPORTA_API_CONFIG_FILE, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME).'); process.exit(2) }
  return { host: host || '127.0.0.1', port: Number(port || 3306), socket, user, password: password ?? '', database, cfg }
}

// ---------------------------------------------------------------------------
// a minimal MySQL client (see db-url-scan.mjs), plus COM_PING
const CAP = { LONG_PASSWORD: 1, LONG_FLAG: 4, CONNECT_WITH_DB: 8, PROTOCOL_41: 0x200, TRANSACTIONS: 0x2000, SECURE_CONNECTION: 0x8000, MULTI_RESULTS: 0x20000, PLUGIN_AUTH: 0x80000 }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
const lenenc = (b, pos) => {
  const f = b[pos]
  if (f < 0xfb) return [f, pos + 1]
  if (f === 0xfc) return [b.readUInt16LE(pos + 1), pos + 3]
  if (f === 0xfd) return [b.readUIntLE(pos + 1, 3), pos + 4]
  return [Number(b.readBigUInt64LE(pos + 1)), pos + 9]
}
class MySQL {
  constructor(o) { this.o = o; this.buf = Buffer.alloc(0); this.waiters = []; this.inbox = []; this.seq = 0 }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = this.o.socket ? connect(this.o.socket) : connect(this.o.port, this.o.host)
      this.sock.setNoDelay?.(true)
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump() })
      this.sock.on('error', (e) => { const w = this.waiters.shift(); if (w) w.reject(e); else if (!this.ready) reject(e) })
      this.sock.on('close', () => { for (const w of this.waiters.splice(0)) w.reject(new Error('connection closed')) })
      this.sock.once('connect', async () => { try { await this.handshake(); this.ready = true; resolve() } catch (e) { reject(e) } })
    })
  }
  pump() {
    while (this.buf.length >= 4) {
      const len = this.buf.readUIntLE(0, 3)
      if (this.buf.length < 4 + len) return
      const payload = this.buf.subarray(4, 4 + len)
      this.seq = this.buf[3] + 1
      this.buf = this.buf.subarray(4 + len)
      const whole = Buffer.from(payload)
      const w = this.waiters.shift()
      if (w) w.resolve(whole); else this.inbox.push(whole)
    }
  }
  packet() {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift())
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.pump() })
  }
  send(payload, seq) { const h = Buffer.alloc(4); h.writeUIntLE(payload.length, 0, 3); h[3] = seq; this.sock.write(Buffer.concat([h, payload])) }
  static scramble(password, salt) {
    if (!password) return Buffer.alloc(0)
    const sha = (b) => createHash('sha1').update(b).digest()
    const s1 = sha(Buffer.from(password, 'utf8')); const s2 = sha(s1); const s3 = sha(Buffer.concat([salt, s2]))
    return Buffer.from(s1.map((b, i) => b ^ s3[i]))
  }
  async handshake() {
    const p = await this.packet()
    if (p[0] === 0xff) throw new Error(`server refused: ${p.subarray(3).toString()}`)
    if (p[0] !== 10) throw new Error(`unsupported protocol ${p[0]}`)
    let i = 1
    while (p[i] !== 0) i++
    i++; i += 4
    const salt1 = p.subarray(i, i + 8); i += 8; i++
    const capLow = p.readUInt16LE(i); i += 2; i++; i += 2
    const capHigh = p.readUInt16LE(i); i += 2
    const serverCap = capLow | (capHigh << 16)
    const authLen = p[i]; i += 1; i += 10
    const salt2Len = Math.max(13, authLen - 8)
    let salt2 = p.subarray(i, i + salt2Len); i += salt2Len
    if (salt2[salt2.length - 1] === 0) salt2 = salt2.subarray(0, salt2.length - 1)
    let plugin = 'mysql_native_password'
    if (serverCap & CAP.PLUGIN_AUTH) { let j = i; while (j < p.length && p[j] !== 0) j++; plugin = p.subarray(i, j).toString() }
    const salt = Buffer.concat([salt1, salt2]).subarray(0, 20)
    const caps = CAP.LONG_PASSWORD | CAP.LONG_FLAG | CAP.CONNECT_WITH_DB | CAP.PROTOCOL_41 | CAP.TRANSACTIONS | CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH
    if (plugin !== 'mysql_native_password') throw new Error(`auth plugin ${plugin} is not supported by this client (mysql_native_password only)`)
    const auth = MySQL.scramble(this.o.password, salt)
    this.send(Buffer.concat([u32(caps), u32(16 * 1024 * 1024), Buffer.from([45]), Buffer.alloc(23), Buffer.from(this.o.user + '\0'), Buffer.from([auth.length]), auth,
      Buffer.from(this.o.database + '\0'), Buffer.from('mysql_native_password\0')]), 1)
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
  async ping() { this.send(Buffer.from([0x0e]), 0); const r = await this.packet(); if (r[0] !== 0x00) throw new Error('ping failed') }
  async query(sql) {
    this.send(Buffer.concat([Buffer.from([3]), Buffer.from(sql, 'utf8')]), 0)
    const first = await this.packet()
    if (first[0] === 0xff) throw new Error(`SQL error ${first.readUInt16LE(1)}: ${first.subarray(9).toString().slice(0, 160)}`)
    if (first[0] === 0x00) return []
    const [ncols] = lenenc(first, 0)
    for (let c = 0; c < ncols; c++) await this.packet()
    if ((await this.packet())[0] !== 0xfe) throw new Error('expected EOF after column definitions')
    const rows = []
    for (;;) {
      const p = await this.packet()
      if (p[0] === 0xfe && p.length < 9) break
      if (p[0] === 0xff) throw new Error(`SQL error ${p.readUInt16LE(1)}`)
      const row = []; let pos = 0
      for (let c = 0; c < ncols; c++) {
        if (p[pos] === 0xfb) { row.push(null); pos++; continue }
        const [l, n] = lenenc(p, pos); pos = n; row.push(p.subarray(pos, pos + l).toString('utf8')); pos += l
      }
      rows.push(row)
    }
    return rows
  }
  end() { try { this.sock.end() } catch { /* gone */ } }
}

// ---------------------------------------------------------------------------
const now = () => Number(process.hrtime.bigint()) / 1e6
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : NaN }
const f2 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

const cred = credentials()
const out = { where: cred.socket ? `unix socket ${cred.socket}` : `${cred.host}:${cred.port}`, config: cred.cfg ? { db_persistent: cred.cfg.db_persistent, db_persistent_slots: cred.cfg.db_persistent_slots } : null }
const kv = async (c, sql) => Object.fromEntries((await c.query(sql)).map(([k, v]) => [k, v]))

const c = new MySQL(cred)
try { await c.connect() } catch (e) { console.error(`db-pool-probe: cannot connect to ${out.where}: ${e.message}`); process.exit(1) }

// ---- 1. what the server is set up for
const wantVars = ['version', 'max_connections', 'max_user_connections', 'thread_handling', 'thread_pool_size', 'thread_pool_max_threads', 'thread_pool_idle_timeout',
  'thread_pool_oversubscribe', 'thread_pool_stall_limit', 'thread_cache_size', 'wait_timeout', 'interactive_timeout', 'connect_timeout', 'back_log', 'max_connect_errors',
  'extra_port', 'extra_max_connections', 'skip_name_resolve', 'max_statement_time', 'innodb_lock_wait_timeout', 'sql_mode', 'time_zone']
out.variables = await kv(c, `show global variables where Variable_name in (${wantVars.map((v) => `'${v}'`).join(',')})`)
const wantStatus = ['Threads_connected', 'Threads_running', 'Threads_created', 'Threads_cached', 'Max_used_connections', 'Max_used_connections_time', 'Connections', 'Aborted_connects', 'Aborted_clients',
  'Connection_errors_max_connections', 'Connection_errors_internal', 'Uptime', 'Questions']
out.status = await kv(c, `show global status where Variable_name in (${wantStatus.map((v) => `'${v}'`).join(',')})`)
const meUser = (await c.query('select substring_index(user(), "@", 1), current_user()'))[0]
out.account = { user: meUser[0] }
try {
  const grants = (await c.query('show grants')).map((r) => r[0]).join('\n')
  const m = grants.match(/MAX_USER_CONNECTIONS\s+(\d+)/i)
  out.account.max_user_connections = m ? Number(m[1]) : null
} catch { out.account.max_user_connections = null }
try {
  // Without the PROCESS privilege the server shows only this account's own connections, which is what the account cap counts.
  const rows = await c.query("select user, count(*), sum(command = 'Sleep') from information_schema.processlist group by user order by 2 desc")
  out.connections = rows.map(([user, n, idle]) => ({ user, open: Number(n), idle: Number(idle) }))
} catch { out.connections = null }

// ---- 2. what a connection costs, from here
const connectMs = [], pingMs = [], selectMs = [], shortMs = []
const SHORT = "SELECT CONNECTION_ID(), DATABASE(), @sporta_pool_gen, @@in_transaction, (@@sql_mode <=> @sporta_pool_sm AND @@time_zone <=> @sporta_pool_tz AND @@max_statement_time <=> @sporta_pool_mst AND @@autocommit <=> @sporta_pool_ac), IF(@sporta_pool_gen IS NULL, 0, IF(IF(RELEASE_ALL_LOCKS() >= 0, COALESCE(@sporta_pool_slot, 0), 0) > 0, 1, 0))"
for (let i = 0; i < SAMPLES; i++) {
  const a = new MySQL(cred)
  const t0 = now()
  try { await a.connect() } catch (e) { console.error(`db-pool-probe: connect failed on sample ${i}: ${e.message}`); process.exit(1) }
  connectMs.push(now() - t0)
  const t1 = now(); await a.query('select 1'); selectMs.push(now() - t1)
  a.end()
}
for (let i = 0; i < SAMPLES; i++) {
  const t0 = now(); await c.ping(); pingMs.push(now() - t0)
  const t1 = now(); await c.query(SHORT); shortMs.push(now() - t1)
}
const connectCost = med(connectMs)                     // TCP + handshake + auth, to the first usable statement
const pooledCost = med(pingMs) + med(shortMs)           // PHP's COM_PING + the pool's one reset statement
const saving = connectCost - pooledCost
out.latency_ms = {
  samples: SAMPLES,
  open_connection_median: f2(connectCost), open_connection_p95: f2(p95(connectMs)),
  first_select_after_connect_median: f2(med(selectMs)),
  ping_median: f2(med(pingMs)), ping_p95: f2(p95(pingMs)),
  pool_reset_statement_median: f2(med(shortMs)), pool_reset_statement_p95: f2(p95(shortMs)),
}
out.estimate = {
  pooled_overhead_ms: f2(pooledCost),
  saving_per_request_ms: f2(saving),
  as_percent_of_a_request: f2((saving / REQUEST_MS) * 100),
  assumed_request_ms: REQUEST_MS,
}
c.end()

// ---- 3. reading it
const v = out.variables, s = out.status
const notes = []
const maxc = Number(v.max_connections)
const peak = Number(s.Max_used_connections)
notes.push(`max_connections ${v.max_connections}, peak ever used ${s.Max_used_connections}${Number.isFinite(maxc) && peak / maxc > 0.7 ? ' (more than 70% of the limit: connection pressure is real)' : ' (the limit has not been near)'}`)
notes.push(`thread_handling ${v.thread_handling}${v.thread_handling === 'pool-of-threads' ? `, thread_pool_size ${v.thread_pool_size}` : ' (one OS thread per connection; pool-of-threads is the server-side pool)'}`)
if (Number(s.Connection_errors_max_connections) > 0) notes.push(`Connection_errors_max_connections is ${s.Connection_errors_max_connections}: clients HAVE been refused for lack of connections`)
if (Number(s.Aborted_connects) > 0) notes.push(`Aborted_connects ${s.Aborted_connects} since start (failed handshakes: wrong password, scans, or the server's limit)`)
if (out.account.max_user_connections) notes.push(`this account is capped at ${out.account.max_user_connections} connections: persistent handles must stay well under that (db_persistent_slots)`)
if (out.latency_ms.ping_median > ABSURD_RTT_MS) notes.push(`a COM_PING takes ${out.latency_ms.ping_median} ms: the database is NOT on the same host or network segment; pooling would pay here`)
// Latency measured on a machine whose CPUs are all busy mostly measures the scheduler. /proc/loadavg inside a container is the HOST's.
out.machine = { cpus: cpus().length, load_1m: f2(loadavg()[0]) }
if (loadavg()[0] > cpus().length * 1.5) notes.push(`the load average (${f2(loadavg()[0])}) is far above the ${cpus().length} CPUs: every latency above is inflated by waiting for a CPU; repeat when the machine is quiet before believing the verdict`)
const worth = saving / REQUEST_MS >= 0.05
notes.push(`opening a connection costs ${f2(connectCost)} ms here; a pooled request spends ${f2(pooledCost)} ms (ping + reset) instead: saving ${f2(saving)} ms per request = ${f2((saving / REQUEST_MS) * 100)}% of a ${REQUEST_MS} ms request`)
notes.push(worth ? 'VERDICT: the saving is 5% or more of a request: measure with the real load and consider db_persistent' : 'VERDICT: the saving is under 5% of a request: leave db_persistent off')
out.notes = notes

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0) }
console.log(`db-pool-probe: ${out.where} as ${out.account.user}`)
if (out.config) console.log(`  config: db_persistent ${out.config.db_persistent}, db_persistent_slots ${out.config.db_persistent_slots}`)
console.log('  server:', Object.entries(out.variables).filter(([k]) => !['sql_mode', 'time_zone'].includes(k)).map(([k, x]) => `${k}=${x}`).join(' '))
console.log('  status:', Object.entries(out.status).map(([k, x]) => `${k}=${x}`).join(' '))
if (out.connections) console.log('  connections now:', out.connections.map((x) => `${x.user} ${x.open} (${x.idle} idle)`).join(', '))
console.log('  latency (ms):', Object.entries(out.latency_ms).map(([k, x]) => `${k}=${x}`).join(' '))
for (const n of notes) console.log(`  - ${n}`)
