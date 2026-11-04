#!/usr/bin/env node
// DATABASE-CONNECTION POOLING BENCHMARK — connect-per-request (today) against opt-in persistent
// connections, on a PRIVATE stack that mimics the live runtime.
//
//   node scripts/db-pool-bench.mjs                              # the whole matrix, Apache prefork + mod_php if available
//   node scripts/db-pool-bench.mjs --modes off --c 1,10 --routes products,stock --reps 1
//   node scripts/db-pool-bench.mjs --server cli-server --workers 8   # php -S fallback, 8 worker processes
//   node scripts/db-pool-bench.mjs --out results.json --md results.md
//   node scripts/db-pool-bench.mjs --opcache                    # opcache on (the live image may or may not have it)
//   node scripts/db-pool-bench.mjs --tree /path/to/patched/dropin
//
// WHAT IT MEASURES, per route and per concurrency (1, 10, 50, 100 by default):
//   requests per second, p50 / p95 / p99 latency, and the MariaDB status counters Connections,
//   Threads_created, Aborted_connects, Max_used_connections around the run, plus how many connections
//   are left OPEN afterwards (the idle pool). `off` is today: one connection per request. `on` is
//   db_persistent=true with a slot cap high enough not to interfere.
//
// WHAT IT NEVER TOUCHES: the shared test rig (database `sporta`, ports 8095-8100, 8188, 4173, dist/).
// Everything is built in a temp directory and removed on exit. Ports are scanned upward from 33750.
//
// HONESTY NOTES the output repeats: the machine this runs on is shared and may be heavily loaded
// (the load average is printed with every table), so absolute numbers mean little and only the
// interleaved off/on COMPARISON means anything; each cell is run `--reps` times with the mode order
// alternating and the table shows the median and the spread (min..max) so noise is visible.
import { writeFileSync } from 'node:fs'
import { loadavg, cpus } from 'node:os'
import { loadRun, median } from './lib/pool-load.mjs'
import { startPoolRig } from './lib/pool-rig.mjs'

const argv = process.argv.slice(2)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const flag = (f) => argv.includes(f)
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean)

const CONC = list(arg('--c', '1,10,50,100')).map(Number)
const MODES = list(arg('--modes', 'off,on'))
const REPS = Math.max(1, Number(arg('--reps', '3')))
const ROUTES = list(arg('--routes', 'products,stock,product,checkout_config,slides,order'))
const SERVER = arg('--server', 'apache')
const WORKERS = Number(arg('--workers', '8'))
const MAXW = Number(arg('--max-workers', '150'))
const SECS = Number(arg('--seconds', '10'))
const OUT = arg('--out', '')
const MD = arg('--md', '')
const OPC = flag('--opcache')
const TREE = arg('--tree', undefined)
const QUIET = flag('--quiet')
const log = (...a) => { if (!QUIET) console.log(...a) }

const rig = await startPoolRig({
  tree: TREE, label: 'bench', server: SERVER, workers: WORKERS, maxWorkers: MAXW, opcache: OPC,
  config: { db_persistent: false, db_persistent_slots: 200 },
})
if (rig.skip) { console.log('SKIP db-pool-bench:', rig.skip); process.exit(0) }
log(`stack: ${rig.kind}${rig.kind === 'apache' ? ` (mpm_prefork, mod_php, MaxRequestWorkers ${MAXW})` : ` (php -S, ${WORKERS} workers)`}, MariaDB ${(await rig.vars()).version}, opcache ${OPC ? 'on' : 'off'}`)
log(`machine: ${cpus().length} CPUs, load average at start ${loadavg().map((x) => x.toFixed(1)).join(' ')}`)
const dbVars = await rig.vars()
log('server settings the question depends on:', JSON.stringify({ max_connections: dbVars.max_connections, thread_handling: dbVars.thread_handling, thread_cache_size: dbVars.thread_cache_size, wait_timeout: dbVars.wait_timeout }))

const slug = await rig.one('select slug from products where active = 1 order by slug limit 1')
let seq = 0
const runId = Math.random().toString(36).slice(2, 7).toUpperCase()
const phoneFor = (n) => `9${String(2000000 + (n % 7000000)).padStart(7, '0')}`
const ROUTE = {
  products: () => ({ path: '/api/api.php?r=products' }),
  stock: () => ({ path: '/api/api.php?r=stock' }),
  product: () => ({ path: `/product/${slug}` }),                       // seo-page.php: the server-rendered product page
  checkout_config: () => ({ path: '/api/api.php?r=checkout_config' }),
  slides: () => ({ path: '/api/api.php?r=slides' }),                  // also carries the promo bar
  order: () => {
    const n = ++seq
    return {
      path: '/api/api.php?r=order', method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: `B${runId}${String(n).padStart(8, '0')}`, payment_method: 'knet',
        items: [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'l', fit: 'Oversize' }],
        customer: { name: 'Bench Tester', phone: phoneFor(n), governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' },
      }),
    }
  },
}

const setMode = (m) => rig.writeApi({ db_persistent: m === 'on', db_persistent_slots: 200 })
const results = [] // { route, c, mode, rep, ...run, deltas }

async function cell(route, c, mode) {
  setMode(mode)
  const build = ROUTE[route]
  const nReq = Math.max(120, c * 10)
  // warm up at the same concurrency so Apache has its children and (in `on`) its handles, then measure
  await loadRun({ base: rig.SITE, build, concurrency: c, requests: Math.max(2 * c, 30), maxSeconds: 6 })
  await rig.sql('flush status', '')
  const before = await rig.counters()
  const cpu0 = rig.cpuTicks()
  const r = await loadRun({ base: rig.SITE, build, concurrency: c, requests: nReq, maxSeconds: SECS })
  const cpu1 = rig.cpuTicks()
  const after = await rig.counters()
  const ms = (t) => (t * 10) / Math.max(1, r.completed)   // 100 ticks a second -> ms of CPU per request
  const d = (k) => after[k] - before[k]
  return {
    ...r,
    // the second snapshot's own connection is in the delta: subtract it
    connections: d('Connections') - 1, perReq: +(((d('Connections') - 1) / Math.max(1, r.completed))).toFixed(3),
    threadsCreated: d('Threads_created'), abortedConnects: d('Aborted_connects'), maxUsed: after.Max_used_connections,
    openAfter: after.Threads_connected - 1,
    cpuPhp: +ms(cpu1.php - cpu0.php).toFixed(2), cpuDb: +ms(cpu1.db - cpu0.db).toFixed(2),
  }
}

for (const route of ROUTES) {
  for (const c of CONC) {
    for (let rep = 0; rep < REPS; rep++) {
      const order = rep % 2 === 0 ? MODES : [...MODES].reverse()
      for (const mode of order) {
        const r = await cell(route, c, mode)
        results.push({ route, c, mode, rep, ...r })
        log(`${route.padEnd(15)} c=${String(c).padStart(3)} ${mode.padEnd(3)} rep${rep}  ${String(r.rps).padStart(7)} rps  p50 ${String(r.p50).padStart(7)}  p95 ${String(r.p95).padStart(7)}  cpu php ${r.cpuPhp} db ${r.cpuDb} ms/req  conn/req ${r.perReq}  threads+ ${r.threadsCreated}  open ${r.openAfter}  ok ${r.ok}/${r.completed}`)
      }
    }
  }
}

// ---- summary: medians over reps, with the spread ----
const rows = []
for (const route of ROUTES) for (const c of CONC) {
  const row = { route, c }
  for (const mode of MODES) {
    const rs = results.filter((x) => x.route === route && x.c === c && x.mode === mode)
    if (!rs.length) continue
    const m = (k) => median(rs.map((x) => x[k]))
    const rng = (k) => `${Math.min(...rs.map((x) => x[k]))}..${Math.max(...rs.map((x) => x[k]))}`
    row[mode] = { rps: m('rps'), rpsRange: rng('rps'), p50: m('p50'), p50Range: rng('p50'), p95: m('p95'), perReq: m('perReq'), cpuPhp: m('cpuPhp'), cpuDb: m('cpuDb'), threads: m('threadsCreated'), open: m('openAfter'), ok: rs.every((x) => x.ok === x.completed) }
  }
  rows.push(row)
}
const pctChange = (a, b) => (a && b ? `${(((b - a) / a) * 100).toFixed(0)}%` : '')
let md = `# Connection pooling benchmark\n\n- stack: ${rig.kind}${rig.kind === 'apache' ? `, mpm_prefork + mod_php, MaxRequestWorkers ${MAXW}` : `, php -S with ${WORKERS} workers`}; MariaDB ${dbVars.version}; opcache ${OPC ? 'on' : 'off'}\n- machine: ${cpus().length} CPUs, load average at the end ${loadavg().map((x) => x.toFixed(1)).join(' ')} (shared, so read only the off/on comparison)\n- each cell: ${REPS} repetitions, median shown, range in brackets\n\n`
md += '| route | c | mode | rps (range) | p50 ms (range) | p95 ms | PHP cpu ms/req | DB cpu ms/req | conn/req | threads created | open after |\n|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|\n'
for (const r of rows) for (const mode of MODES) {
  const x = r[mode]; if (!x) continue
  md += `| ${r.route} | ${r.c} | ${mode} | ${x.rps} (${x.rpsRange}) | ${x.p50} (${x.p50Range}) | ${x.p95} | ${x.cpuPhp} | ${x.cpuDb} | ${x.perReq} | ${x.threads} | ${x.open} |\n`
}
if (MODES.includes('off') && MODES.includes('on')) {
  md += '\n| route | c | rps off -> on | p50 off -> on | p95 off -> on | PHP cpu ms/req off -> on | DB cpu ms/req off -> on |\n|---|---:|---|---|---|---|---|\n'
  for (const r of rows) if (r.off && r.on) md += `| ${r.route} | ${r.c} | ${r.off.rps} -> ${r.on.rps} (${pctChange(r.off.rps, r.on.rps)}) | ${r.off.p50} -> ${r.on.p50} (${pctChange(r.off.p50, r.on.p50)}) | ${r.off.p95} -> ${r.on.p95} (${pctChange(r.off.p95, r.on.p95)}) | ${r.off.cpuPhp} -> ${r.on.cpuPhp} (${pctChange(r.off.cpuPhp, r.on.cpuPhp)}) | ${r.off.cpuDb} -> ${r.on.cpuDb} (${pctChange(r.off.cpuDb, r.on.cpuDb)}) |\n`
}
console.log('\n' + md)
if (MD) writeFileSync(MD, md)
if (OUT) writeFileSync(OUT, JSON.stringify({ stack: rig.kind, vars: dbVars, opcache: OPC, results, rows }, null, 2))
rig.stop()
