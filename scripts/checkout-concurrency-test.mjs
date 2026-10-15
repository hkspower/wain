/**
 * test:checkout-concurrency — many shoppers checking out at once (2026-10-15).
 *
 * Starts its own PHP server with 4 workers (the sandbox's `php -S` is single-threaded, so it
 * can never race) and fires 40 cash orders at once for two sizes with 5 left each, half of them
 * with the bag in the opposite order, plus 5 copies of one order with the same reference.
 *
 *   A  no checkout dies: zero 500s (two bags [A,B] and [B,A] used to deadlock in InnoDB)
 *   B  no overselling: exactly 5 orders go through and both sizes end at 0
 *   C  every refusal names the true count (0), not a stale snapshot ("only 3 left")
 *   D  the same reference sent 5 times at once is ONE order (idempotency)
 *
 * Run `bash scripts/sandbox.sh` first. Every order, line, outbox and stock-log row it creates is
 * removed, and the two stock counts are put back. MUTATE=unsorted claims in cart order: A fails.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const STORE = ROOT + 'sporta-site/public_html/api/store.php'
const PORT = 4391
const API = `http://127.0.0.1:${PORT}/api/api.php?r=order`
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const storeOrig = readFileSync(STORE, 'utf8')
if (process.env.MUTATE === 'unsorted') writeFileSync(STORE, storeOrig.replace('usort($lines, function ($a, $b) {', 'if (false) usort($lines, function ($a, $b) {'))

const [A, B, C] = sql("select v.slug from product_variants v join products p on p.slug = v.slug where v.size = 'M' and p.active = 1 group by v.slug having count(*) = 1 order by v.slug limit 3").split('\n')
const stockBefore = sql(`select group_concat(concat(sku, '=', stock)) from product_variants where slug in ('${A}','${B}','${C}') and size = 'M'`)
const logMax = sql('select ifnull(max(id), 0) from stock_log')
const TAG = 'SPCC' + Date.now().toString(36).toUpperCase().slice(-5)

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT + 'sporta-site/public_html', ROOT + 'scripts/dev-router.php'],
  { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' })
const order = (i, items, track) => fetch(API, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${PORT}` },
  body: JSON.stringify({ track_id: track || `${TAG}${String(i).padStart(3, '0')}`, items, method: 'cod', lang: 'en',
    customer: { name: 'Concurrency Rig', phone: '5' + String(6000000 + i), email: 'cc@example.com', governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1' } }),
}).then(async (r) => ({ s: r.status, b: await r.text() })).catch((e) => ({ s: 0, b: String(e) }))

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/api.php?r=slides`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 200)) }
  check(!!A && !!B && !!C, 'found three products with one M row each', `${A} ${B} ${C}`)
  sql(`delete from rate_limit; delete from rate_bucket; update product_variants set stock = 5 where slug in ('${A}','${B}','${C}') and size = 'M'`)
  const jobs = []
  for (let i = 0; i < 40; i++) {
    const ab = [{ slug: A, qty: 1, size: 'M' }, { slug: B, qty: 1, size: 'M' }]
    jobs.push(order(i, i % 2 ? ab : ab.slice().reverse()))
  }
  const dupe = `${TAG}DUP`
  for (let k = 0; k < 5; k++) jobs.push(order(100 + k, [{ slug: C, qty: 1, size: 'M' }], dupe))
  const res = await Promise.all(jobs)
  const main = res.slice(0, 40), dup = res.slice(40)
  const s500 = main.concat(dup).filter((r) => r.s >= 500)
  check(s500.length === 0, 'A no checkout dies with a server error', s500.length ? `${s500.length} × ${s500[0].s} ${s500[0].b.slice(0, 60)}` : '')
  const placed = Number(sql(`select count(*) from orders where track_id like '${TAG}%' and track_id <> '${dupe}'`))
  const left = sql(`select group_concat(stock order by slug) from product_variants where slug in ('${A}','${B}') and size = 'M'`)
  check(left === '0,0' && placed === 5,
    'B no overselling: both sizes end at 0 and no more orders than units', `orders=${placed} stock=${left}`)
  const refusals = main.filter((r) => r.s === 409).map((r) => (r.b.match(/"error":"([^"]+)"/) || [])[1])
  const stale = refusals.filter((e) => !/_0$/.test(e || ''))
  check(refusals.length > 0 && stale.length === 0, 'C every refusal names 0 left, not a stale count', stale.slice(0, 3).join(' '))
  const dupIds = new Set(dup.filter((r) => r.s === 200).map((r) => (r.b.match(/"order_id":(\d+)/) || [])[1]))
  check(sql(`select count(*) from orders where track_id = '${dupe}'`) === '1' && dupIds.size <= 1 && sql(`select stock from product_variants where slug = '${C}' and size = 'M'`) === '4',
    'D the same reference sent 5 times at once is one order (and takes one unit)', `rows=${sql(`select count(*) from orders where track_id = '${dupe}'`)} ids=${[...dupIds].join(',')}`)
} finally {
  srv.kill()
  if (process.env.MUTATE) writeFileSync(STORE, storeOrig)
  const ids = sql(`select ifnull(group_concat(id), '') from orders where track_id like '${TAG}%'`)
  if (ids) {
    for (const t of ['order_items', 'fulfilment_outbox', 'customer_mail_outbox', 'whatsapp_outbox', 'push_outbox', 'order_location']) sql(`delete from ${t} where order_id in (${ids})`)
    sql(`delete from orders where id in (${ids})`)
  }
  sql(`delete from stock_log where id > ${logMax} and slug in ('${A}','${B}','${C}')`)
  for (const pair of stockBefore.split(',')) { const [sku, n] = pair.split('='); sql(`update product_variants set stock = ${+n} where sku = '${sku}'`) }
  sql('delete from rate_limit; delete from rate_bucket')
  check(sql(`select count(*) from orders where track_id like '${TAG}%'`) === '0' && readFileSync(STORE, 'utf8') === storeOrig, 'everything it made is removed and store.php is as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall checkout-concurrency checks passed')
  process.exitCode = fails ? 1 : 0
}
