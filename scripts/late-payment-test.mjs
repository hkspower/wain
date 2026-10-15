/**
 * test:late-payment — BL-01 (2026-10-14, owner's choice: re-claim the stock, or flag for a refund).
 *
 * A card capture can land after the sweeper released its hold. store_payment_settled() now checks
 * the order's stock first:
 *   A  the size is still on the shelf      → taken again, stock_released goes back to 0, paid
 *   B  the size is gone                    → nothing taken, stock_released stays 1, still paid,
 *                                            and a zero-delta 'late_payment' row names the order
 *   C  the order was cancelled             → never re-claimed, even with stock on the shelf
 *
 * Run `bash scripts/sandbox.sh` first. Order 60 (one line, one size) is put back to its original state
 * and its stock and ledger rows are restored afterwards.
 * MUTATE=1 removes the call in store_payment_settled and checks A and C must fail.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const storeFile = ROOT + 'sporta-site/public_html/api/store.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).replace(/\n$/, '')

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const storeOrig = readFileSync(storeFile, 'utf8')
if (process.env.MUTATE) {
  writeFileSync(storeFile, storeOrig.replace("if ($newStatus === 'paid') store_late_payment_reclaim($db, $orderId);", ''))
}

let cookie = ''
const api = async (route, data) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  const set = r.headers.get('set-cookie')
  if (set && !cookie) cookie = set.split(';')[0]
  return { status: r.status, text: await r.text() }
}

const ORDER = 60
const line = sql(`select p.slug, i.size, i.qty from order_items i join products p on p.id = i.product_id where i.order_id = ${ORDER} and i.size is not null`).split('\t')
const [slug, size, qty] = [line[0], line[1], Number(line[2])]
const orig = sql(`select payment_status, payment_method, fulfilment_status, stock_claimed, stock_released, coalesce(paid_at,''), coalesce(cbk_paymentid,''), coalesce(cbk_message,'') from orders where id = ${ORDER}`).split('\t')
const origStock = sql(`select stock from product_variants where slug = '${slug}' and size = '${size}'`)
const maxLog = Number(sql('select coalesce(max(id),0) from stock_log'))
const maxJe = Number(sql('select coalesce(max(id),0) from journal_entries'))

const setState = ({ fulfilment = 'unfulfilled', stock }) => {
  sql(`update orders set payment_status = 'failed', payment_method = 'knet', fulfilment_status = '${fulfilment}', stock_claimed = 1, stock_released = 1, paid_at = null, cbk_paymentid = null, cbk_message = null where id = ${ORDER}`)
  sql(`update product_variants set stock = ${stock} where slug = '${slug}' and size = '${size}'`)
}
const orderNow = () => sql(`select payment_status, stock_released from orders where id = ${ORDER}`).split('\t')
const stockNow = () => Number(sql(`select stock from product_variants where slug = '${slug}' and size = '${size}'`))
const pay = () => api('card_settled', { order_id: ORDER, bank_reference: '123456789' })

try {
  sql('delete from rate_limit; delete from rate_bucket')
  const login = await api('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  check(login.status === 200, 'signed in to the panel', `status ${login.status}`)

  // A — late capture, size still on the shelf
  setState({ stock: 10 })
  const a = await pay()
  const [paidA, relA] = orderNow()
  check(a.status === 200 && paidA === 'paid', 'A a late capture marks the order paid', `status ${a.status}`)
  check(stockNow() === 10 - qty && relA === '0', 'A the size is taken again and the order is claimed again', `stock ${stockNow()}, released ${relA}`)

  // B — late capture, size gone
  setState({ stock: 0 })
  const b = await pay()
  const [paidB, relB] = orderNow()
  check(b.status === 200 && paidB === 'paid', 'B the money is recorded: the order is still paid', `status ${b.status}`)
  check(stockNow() === 0 && relB === '1', 'B nothing is taken when the size is gone', `stock ${stockNow()}, released ${relB}`)
  const flagged = Number(sql(`select count(*) from stock_log where id > ${maxLog} and reason = 'late_payment' and delta = 0 and slug = '${slug}'`))
  check(flagged >= 1, 'B a late_payment row names the short size in the stock history', `rows ${flagged}`)

  // C — cancelled order: never re-claimed
  setState({ fulfilment: 'cancelled', stock: 10 })
  const c = await pay()
  const [paidC, relC] = orderNow()
  check(c.status === 200 && paidC === 'paid', 'C a cancelled order that is paid late is still recorded as paid', `status ${c.status}`)
  check(stockNow() === 10 && relC === '1', 'C a cancelled order is not re-claimed, even with stock on the shelf', `stock ${stockNow()}, released ${relC}`)
} finally {
  if (process.env.MUTATE) writeFileSync(storeFile, storeOrig)
  // Restore the order, its size's stock, and the ledger and stock rows written by this run.
  sql(`update orders set payment_status = '${orig[0]}', payment_method = '${orig[1]}', fulfilment_status = '${orig[2]}', stock_claimed = ${orig[3]}, stock_released = ${orig[4]}, paid_at = ${orig[5] ? `'${orig[5]}'` : 'null'}, cbk_paymentid = ${orig[6] ? `'${orig[6]}'` : 'null'}, cbk_message = ${orig[7] ? `'${orig[7].replace(/'/g, "''")}'` : 'null'} where id = ${ORDER}`)
  sql(`update product_variants set stock = ${origStock} where slug = '${slug}' and size = '${size}'`)
  sql(`delete from stock_log where id > ${maxLog}`)
  sql(`delete from journal_lines where entry_id > ${maxJe}`)
  sql(`delete from journal_entries where id > ${maxJe}`)
  console.log(fails ? `\n${fails} FAILED` : '\nall late-payment checks passed')
  process.exitCode = fails ? 1 : 0
}
