/**
 * test:late-payment-callback — BL-01 through the BANK CALLBACKS (2026-10-15).
 *
 * test:late-payment drives the admin routes (cod_paid, card_settled). A late card capture arrives
 * through knet/callback.php or pay/callback.php, which settle the order themselves — and until
 * 2026-10-15 neither called store_late_payment_reclaim(), so a late capture went on overselling the
 * size. This rig goes through those two files:
 *
 *   K  KNET: a real encrypted CAPTURED response POSTed to /knet/callback.php
 *        KA  the size is on the shelf  → taken again, stock_released 0, paid
 *        KB  the size is gone          → nothing taken, stock_released 1, paid, a 'late_payment' row
 *        KC  the order was cancelled   → not re-claimed
 *   C  CBK: pay/callback.php's own cbk_update_order(), extracted from the file and called with the
 *      result the gateway would send. The encrp path needs CBK's HTTPS API, which the sandbox cannot
 *      answer with TLS verification on — so the settle step is driven, not the fetch before it.
 *        CA  the size is on the shelf  → taken again, stock_released 0, paid
 *
 * Run `bash scripts/sandbox.sh` first. Removes everything it writes and restores the stock.
 * MUTATE=1 removes the call from both callbacks: KA, KB and CA must fail.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const knetCb = PUB + '/knet/callback.php'
const payCb = PUB + '/pay/callback.php'
const harnessFile = PUB + '/pay/_late-callback-rig.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const CALL = /\n\s*\/\/ BL-01: a capture that lands after the sweeper[^\n]*\n[^\n]*\n[^\n]*\n\s*if \(\$paid\) store_late_payment_reclaim\(\$pdo, \(int\) ?\$orderId\);/
const knetOrig = readFileSync(knetCb, 'utf8')
const payOrig = readFileSync(payCb, 'utf8')
check(CALL.test(knetOrig) && CALL.test(payOrig), 'both callbacks carry the BL-01 call (the anchor the mutation removes)')
if (process.env.MUTATE) {
  writeFileSync(knetCb, knetOrig.replace(CALL, ''))
  writeFileSync(payCb, payOrig.replace(CALL, ''))
}

// A size with stock, and its product id.
const [sku, slug, size, stock0] = sql(`select sku, slug, size, stock from product_variants where stock >= 3 and size is not null order by sku limit 1`).split('\t')
const pid = sql(`select id from products where slug = '${slug}'`)
const tag = Date.now().toString(36).toUpperCase().slice(-6)
const made = []

function order(track, method, fulfilment = 'unfulfilled') {
  const id = sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, stock_claimed, stock_released,
                    customer_name, customer_phone, created_at)
                  values ('${track}', 7.000, 'pending', '${method}', '${fulfilment}', 1, 1, 'Late Callback Rig', '96555512345', now() - interval 3 hour);
                  select last_insert_id()`)
  sql(`insert into order_items (order_id, product_id, name_en, qty, unit_price, size) values (${id}, ${pid}, 'Rig', 1, 7.000, '${size}')`)
  made.push(id)
  return id
}
const stock = () => Number(sql(`select stock from product_variants where sku = '${sku}'`))
const row = (id) => sql(`select payment_status, stock_released from orders where id = ${id}`).split('\t')
const lateRows = (track) => Number(sql(`select count(*) from stock_log where reason = 'late_payment' and ref = '${track}'`))

const php = (code) => spawnSync('php', ['-r', code], { encoding: 'utf8' })
async function knetCapture(track) {
  const plain = `paymentid=PAY${track}&result=CAPTURED&auth=123456&ref=REF${track}&tranid=TX${track}&postdate=1015&trackid=${track}&amt=7.000&udf1=&udf2=&udf3=&udf4=&udf5=`
  const enc = php(`require "${PUB}/knet/knet.php"; $c = knet_config(); echo knet_encrypt('${plain}', $c['resource_key']);`).stdout.trim()
  const r = await fetch(`${BASE}/knet/callback.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
    body: new URLSearchParams({ trandata: enc }).toString(),
    redirect: 'manual',
  })
  return r.status
}

try {
  sql('delete from rate_limit; delete from rate_bucket')

  // KA — on the shelf
  let t = 'SPLCKA' + tag, id = order(t, 'knet')
  let s = stock(), status = await knetCapture(t)
  let [ps, rel] = row(id)
  check(status === 200 || status === 302, 'KA the KNET callback answers normally', `status ${status}`)
  check(ps === 'paid', 'KA the order is paid', ps)
  check(stock() === s - 1 && rel === '0', 'KA a late KNET capture takes the size back', `stock ${s} -> ${stock()}, stock_released ${rel}`)

  // KB — sold out in the meantime
  t = 'SPLCKB' + tag; id = order(t, 'knet')
  sql(`update product_variants set stock = 0 where sku = '${sku}'`)
  status = await knetCapture(t);
  [ps, rel] = row(id)
  check(ps === 'paid', 'KB the order stays paid (the money is in)', ps)
  check(stock() === 0 && rel === '1', 'KB nothing is taken from an empty shelf', `stock ${stock()}, stock_released ${rel}`)
  check(lateRows(t) >= 1, 'KB a late_payment row names the order for a refund', `${lateRows(t)} row(s)`)
  sql(`update product_variants set stock = ${stock0} where sku = '${sku}'`)

  // KC — cancelled before the capture
  t = 'SPLCKC' + tag; id = order(t, 'knet', 'cancelled')
  s = stock(); await knetCapture(t);
  [ps, rel] = row(id)
  check(stock() === s && rel === '1', 'KC a cancelled order is not re-claimed', `stock ${s} -> ${stock()}, stock_released ${rel}`)

  // CA — CBK settle step, extracted from pay/callback.php so the real function body runs
  t = 'SPLCCA' + tag; id = order(t, 'tpay')
  const src = readFileSync(payCb, 'utf8')
  const start = src.indexOf('function cbk_update_order(')
  const end = src.indexOf('\n}\n', start)
  check(start > 0 && end > start, 'CA cbk_update_order() is found in pay/callback.php')
  const fn = src.slice(start, end + 2)
  s = stock()
  const harness = `require "${PUB}/pay/cbk.php"; $cfg = cbk_config(); ${fn}
    cbk_update_order($cfg, '${t}', true, ['Status' => '1', 'Amount' => '7.000', 'PayId' => '${t}', 'TrackId' => 'G${t}', 'PaymentId' => 'P${t}', 'ReferenceId' => 'R${t}', 'PayType' => '2']);
    echo "done";`
  // Run from a file inside pay/, so the function's own __DIR__ lookup of api/store.php resolves as it
  // does on the server (php -r has no __DIR__, which would skip the whole settle block).
  writeFileSync(harnessFile, '<?php ' + harness)
  const out = spawnSync('php', [harnessFile], { encoding: 'utf8' })
  check(out.stdout.trim().endsWith('done'), 'CA the CBK settle step runs', (out.stderr || out.stdout).slice(0, 200));
  [ps, rel] = row(id)
  check(ps === 'paid', 'CA the order is paid', ps)
  check(stock() === s - 1 && rel === '0', 'CA a late CBK capture takes the size back', `stock ${s} -> ${stock()}, stock_released ${rel}`)
} finally {
  if (process.env.MUTATE) { writeFileSync(knetCb, knetOrig); writeFileSync(payCb, payOrig) }
  try { unlinkSync(harnessFile) } catch {}
  const ids = made.join(',') || '0'
  const refs = sql(`select group_concat(concat("'", track_id, "'")) from orders where id in (${ids})`) || "''"
  sql(`set foreign_key_checks=0;
       delete from journal_lines where entry_id in (select id from journal_entries where source_ref in (${ids.split(',').map(i => `'${i}','order:${i}'`).join(',')}));
       delete from journal_entries where source_ref in (${ids.split(',').map(i => `'${i}','order:${i}'`).join(',')});
       set foreign_key_checks=1;
       delete from fulfilment_outbox where order_id in (${ids});
       delete from order_items where order_id in (${ids});
       delete from orders where id in (${ids});
       delete from knet_responses where track_id in (${refs});
       delete from stock_log where ref in (${refs}) or (sku = '${sku}' and reason in ('order','late_payment') and at > now() - interval 10 minute);
       update product_variants set stock = ${stock0} where sku = '${sku}'`)
  check(readFileSync(knetCb, 'utf8') === knetOrig && readFileSync(payCb, 'utf8') === payOrig, 'both callbacks are back exactly as they were')
  check(stock() === Number(stock0), 'the stock is back as it was', `${stock()}`)
  check(!existsSync(harnessFile), 'the harness file is gone from pay/')
  console.log(fails ? `\n${fails} FAILED` : '\nall late-payment callback checks passed')
  process.exitCode = fails ? 1 : 0
}
