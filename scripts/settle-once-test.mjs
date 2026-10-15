/**
 * test:settle-once — a payment is settled once, however many times it is reported (2026-10-15).
 *
 * Runs its own 4-worker PHP server so requests really overlap.
 *   A  cod_paid sent twice at once: one succeeds, one is refused, ONE "payment" message is queued
 *   B  card_settled sent twice at once: the same
 *   C  the stock sweeper does not put a paid order's garments back on sale, and does return an
 *      unpaid order's, in one step (store_stock_release re-checks under a lock)
 *
 * Run `bash scripts/sandbox.sh` first. Orders it makes are removed; stock is put back.
 * MUTATE=unguarded removes the cod_paid guard: A fails.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const ADMIN = ROOT + 'sporta-site/public_html/api/admin.php'
const PORT = 4392
const BASE = `http://127.0.0.1:${PORT}`
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const orig = readFileSync(ADMIN, 'utf8')
if (process.env.MUTATE === 'unguarded') writeFileSync(ADMIN, orig.replace('if ($mv->rowCount() !== 1) {\n            $db->rollBack();\n            store_fail($paid ?', 'if (false) {\n            $db->rollBack();\n            store_fail($paid ?'))

const TAG = 'SPSO' + Date.now().toString(36).toUpperCase().slice(-5)
const SLUG = sql("select v.slug from product_variants v join products p on p.slug = v.slug where v.size = 'M' and p.active = 1 group by v.slug having count(*) = 1 order by v.slug limit 1")
const stock0 = sql(`select stock from product_variants where slug = '${SLUG}' and size = 'M'`)
const logMax = sql('select ifnull(max(id), 0) from stock_log')
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT + 'sporta-site/public_html', ROOT + 'scripts/dev-router.php'],
  { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' })
let cookie = ''
const admin = (r, body) => fetch(`${BASE}/api/admin.php?r=${r}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Cookie: cookie }, body: JSON.stringify(body) })
  .then(async (x) => ({ s: x.status, b: await x.text() }))
const place = async (i, method) => {
  const r = await fetch(`${BASE}/api/api.php?r=order`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ track_id: `${TAG}${i}`, items: [{ slug: SLUG, qty: 1, size: 'M' }], payment_method: method, lang: 'en',
      customer: { name: 'Settle Rig', phone: '5' + String(7000000 + i), email: 'so@example.com', governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1' } }) })
  return (await r.json()).order_id
}
const payMsgs = (id) => sql(`select count(*) from fulfilment_outbox where order_id = ${id} and kind = 'payment'`)

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/api.php?r=slides`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 200)) }
  sql(`delete from rate_limit; delete from rate_bucket; update product_variants set stock = 10 where slug = '${SLUG}' and size = 'M'`)
  const login = await fetch(`${BASE}/api/admin.php?r=login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: JSON.stringify({ email: 'manager@sporta.com.kw', password: 'correct horse' }) })
  cookie = (login.headers.get('set-cookie') || '').split(';')[0]
  check(login.status === 200 && !!cookie, 'signed in')

  // A
  // Four requests at once, over five orders: the race is a few milliseconds wide.
  const bad = []
  for (let k = 0; k < 5; k++) {
    const cod = await place(10 + k, 'cod')
    const a = await Promise.all([0, 1, 2, 3].map(() => admin('cod_paid', { order_id: cod, paid: true })))
    const ok = a.filter((x) => x.s === 200).length
    if (ok !== 1 || payMsgs(cod) !== '1') bad.push(`order ${cod}: ${ok} succeeded, ${payMsgs(cod)} messages`)
  }
  check(bad.length === 0, 'A cod_paid four times at once (x5): one succeeds, one payment message', bad.join('; '))

  // B
  const card = await place(2, 'knet')
  const b = await Promise.all([admin('card_settled', { order_id: card, bank_reference: '123456789012' }), admin('card_settled', { order_id: card, bank_reference: '123456789012' })])
  check(b.filter((x) => x.s === 200).length === 1 && payMsgs(card) === '1', 'B card_settled twice at once: one succeeds, one payment message', `${b.map((x) => x.s)} msgs=${payMsgs(card)}`)

  // C — the sweeper's own function, through PHP, against a paid order and an unpaid one
  const unpaid = await place(3, 'knet')
  sql(`update orders set created_at = now() - interval 1 day where id in (${card}, ${unpaid})`)
  const before = sql(`select stock from product_variants where slug = '${SLUG}' and size = 'M'`)
  const out = execFileSync('php', ['-r', `chdir('${ROOT}sporta-site/public_html/api'); $_SERVER['REQUEST_METHOD']='GET'; require 'store.php'; $db = store_db(); echo json_encode([store_stock_release($db, ${card}), store_stock_release($db, ${unpaid}), store_stock_release($db, ${unpaid})]);`], { encoding: 'utf8' }).trim().split('\n').pop()
  const after = sql(`select stock from product_variants where slug = '${SLUG}' and size = 'M'`)
  check(out === '[false,true,false]', 'C a paid order is not released; an unpaid one is, once', out)
  check(+after === +before + 1, 'C exactly one unit came back to the shelf', `${before} -> ${after}`)
  check(sql(`select stock_released from orders where id = ${card}`) === '0', 'C the paid order is still holding its stock')
} finally {
  srv.kill()
  if (process.env.MUTATE) writeFileSync(ADMIN, orig)
  const ids = sql(`select ifnull(group_concat(id), '') from orders where track_id like '${TAG}%'`)
  if (ids) {
    for (const t of ['order_items', 'fulfilment_outbox', 'customer_mail_outbox', 'whatsapp_outbox', 'push_outbox', 'order_location']) sql(`delete from ${t} where order_id in (${ids})`)
    try { sql(`delete l from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_ref in (${ids.split(',').map((x) => `'order:${x}'`).join(',')})`) } catch {}
    try { sql(`delete from journal_entries where source_ref in (${ids.split(',').map((x) => `'order:${x}'`).join(',')})`) } catch {}
    sql(`delete from orders where id in (${ids})`)
  }
  sql(`delete from stock_log where id > ${logMax} and slug = '${SLUG}'`)
  sql(`update product_variants set stock = ${+stock0} where slug = '${SLUG}' and size = 'M'`)
  sql('delete from rate_limit; delete from rate_bucket')
  check(readFileSync(ADMIN, 'utf8') === orig && sql(`select count(*) from orders where track_id like '${TAG}%'`) === '0', 'everything it made is removed and admin.php is as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall settle-once checks passed')
  process.exitCode = fails ? 1 : 0
}
