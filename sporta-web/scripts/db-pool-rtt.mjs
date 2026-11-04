#!/usr/bin/env node
// HOW MUCH CAN POOLING SAVE AS THE DATABASE GETS FARTHER AWAY?
//
//   node scripts/db-pool-rtt.mjs                 delays 0, 0.5, 1, 2, 4 ms each way
//   node scripts/db-pool-rtt.mjs --delays 0,1,3 --n 200
//
// A private MariaDB with a small TCP forwarder in front of it that holds every packet for a fixed time in each
// direction (so the round-trip time is twice that). Through it, the same three things are timed (see
// fixtures/pool-rtt.php): connect-per-request, the pool (PHP's COM_PING + the pool's one reset statement + the
// query), and a bare persistent handle with no reset at all. The point is a NUMBER OF ROUND TRIPS: opening a
// connection costs about 2.5 (TCP, then the authentication exchange) and the query one more; a pooled request
// spends one on PHP's ping, one on the pool's reset statement, and one on the query. So even with the reset kept
// as short as one statement, pooling saves about HALF a round trip plus the server's CPU for the connection,
// however far away the database is. The bare handle, which skips the reset and is not safe, saves about 1.5.
import { spawnSync } from 'node:child_process'
import { createServer, connect } from 'node:net'
import { join } from 'node:path'
import { DROPIN, FIXTURES, WEB } from './lib/pool-rig.mjs'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'

const argv = process.argv.slice(2)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const DELAYS = String(arg('--delays', '0,0.5,1,2,4')).split(',').map(Number)
const N = Number(arg('--n', '150'))
const poolFile = join(DROPIN, 'php-store', 'db-pool.php')

let inst
try { inst = await startPrivateMariadb({ label: 'rtt', portFrom: 33820 }) } catch (e) { console.log(`SKIP db-pool-rtt: ${e.message}`); process.exit(0) }
const pw = 'rtt-' + Math.random().toString(36).slice(2)
await inst.sql(`create database rtt; create user 'rtt'@'127.0.0.1' identified by '${pw}'; grant all on rtt.* to 'rtt'@'127.0.0.1';`)

const forwarders = []
const forward = (delayMs) => new Promise((resolve) => {
  const srv = createServer((c) => {
    const up = connect(inst.port, '127.0.0.1')
    for (const s of [c, up]) s.setNoDelay(true)
    const pipe = (from, to) => from.on('data', (d) => { if (delayMs > 0) setTimeout(() => { if (!to.destroyed) to.write(d) }, delayMs); else to.write(d) })
    pipe(c, up); pipe(up, c)
    c.on('close', () => up.destroy()); up.on('close', () => c.destroy()); c.on('error', () => {}); up.on('error', () => {})
  })
  srv.listen(0, '127.0.0.1', () => { forwarders.push(srv); resolve(srv.address().port) })
})

console.log(`MariaDB ${inst.version}; ${N} interleaved rounds per delay; machine load ${process.platform === 'linux' ? spawnSync('cat', ['/proc/loadavg'], { encoding: 'utf8' }).stdout.split(' ').slice(0, 3).join(' ') : 'n/a'}`)
console.log('| one-way delay | round trip | plain (connect each request) | pooled (ping + reset + query) | bare persistent (unsafe) | pooled saves | = round trips |')
console.log('|---:|---:|---:|---:|---:|---:|---:|')
for (const d of DELAYS) {
  const port = await forward(d)
  const r = spawnSync('php', ['-d', 'error_log=/dev/null', join(FIXTURES, 'pool-rtt.php'), poolFile, String(port), 'rtt', pw, 'rtt', String(N)], { encoding: 'utf8', timeout: 600000 })
  let o
  try { o = JSON.parse(r.stdout.trim()) } catch { console.log(`| ${d} ms | failed: ${(r.stderr || r.stdout).slice(0, 120)} |`); continue }
  const rtt = d * 2
  const save = o.plain.median - o.pooled.median
  console.log(`| ${d} ms | ${rtt} ms | ${o.plain.median} ms | ${o.pooled.median} ms | ${o.bare.median} ms | ${save.toFixed(2)} ms (${((save / o.plain.median) * 100).toFixed(0)}%) | ${rtt > 0 ? (save / rtt).toFixed(1) : 'n/a'} |`)
}
for (const s of forwarders) s.close()
inst.stop()
void WEB
