/**
 * test:knet-refresh — the KNET callback brought in line with K-064 v1.5 (2026-10-15).
 *
 * Drives the real /knet/callback.php with responses encrypted by the shop's own knet_encrypt(), and with
 * callback_response left UNSET in config.php, so the default ('auto') is what is measured.
 *
 *   R1  KNET's notification (a POST carrying trandata) gets ONLY the line REDIRECT=<url>: text/plain, no tag,
 *       no second line, no Location header (§5, §10.2.1 — HTML or a redirect here is a cause of auto-void)
 *   R2  an unusable trandata also gets only the line (same caller, same rule)
 *   R3  the error URL (a browser GET, ErrorText, no trandata) gets a 302 to the result page, and leaves a NOTE
 *       on the pending order — never a status; a paid order's message is not touched
 *   R4  CAPTURED at the right amount → paid
 *   R5  HOST TIMEOUT → review (the bank may have taken the money; an inquiry decides), not failed
 *   R6  APPROVED → review, not paid (only CAPTURED is success, §3.6)
 *   R7  CAPTURED at the wrong amount → review (money taken), not failed
 *   R8  NOT CAPTURED after a payment → the order stays paid
 *
 * Run `bash scripts/sandbox.sh` first. Removes everything it writes.
 * MUTATE=style  restores the old 'both' default:            R1, R2 fail
 * MUTATE=approved  counts APPROVED as paid again:           R6 fails
 * MUTATE=mismatch  marks a wrong amount failed again:       R7 fails
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const CB = PUB + '/knet/callback.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const cbOrig = readFileSync(CB, 'utf8')
const M = process.env.MUTATE
const mutate = (from, to) => { if (!cbOrig.includes(from)) throw new Error('mutation anchor missing: ' + from.slice(0, 60)); writeFileSync(CB, readFileSync(CB, 'utf8').replace(from, to)) }
if (M === 'style') mutate("(string) ($cfg['callback_response'] ?? '') ?: 'auto'", "(string) ($cfg['callback_response'] ?? '') ?: 'both'")
if (M === 'approved') mutate("$paid      = $result === 'CAPTURED';", "$paid      = $result === 'CAPTURED' || $result === 'APPROVED';")
if (M === 'mismatch') mutate("        $paid = false;\n        $review = true;\n        $result = 'AMOUNT_MISMATCH';", "        $paid = false;\n        $result = 'AMOUNT_MISMATCH';")

const cfgStyle = spawnSync('php', ['-r', `$c = require "${PUB}/knet/config.php"; echo array_key_exists('callback_response', $c) ? 'set:' . $c['callback_response'] : 'unset';`], { encoding: 'utf8' }).stdout.trim()
check(cfgStyle === 'unset', 'the sandbox config.php leaves callback_response unset, so the default is what is measured', cfgStyle)

const tag = Date.now().toString(36).toUpperCase().slice(-6)
const made = []
const order = (suffix, status = 'pending') => {
  const t = 'SPKR' + suffix + tag
  made.push(t)
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, created_at)
       values ('${t}', 7.000, '${status}', 'knet', 'unfulfilled', 'Refresh Rig', '96555512345', now())`)
  return t
}
const enc = (plain) => spawnSync('php', ['-r', `require "${PUB}/knet/knet.php"; $c = knet_config(); echo knet_encrypt('${plain}', $c['resource_key']);`], { encoding: 'utf8' }).stdout.trim()
const resp = (t, result, amt = '7.000') => `paymentid=PAY${t}&result=${encodeURIComponent(result).replace(/%20/g, '+')}&auth=999554&avr=N&ref=REF${t}&tranid=TX${t}&postdate=1015&trackid=${t}&udf1=&udf2=&udf3=&udf4=&udf5=&amt=${amt}`
const notify = async (trandata) => {
  const r = await fetch(`${BASE}/knet/callback.php`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
    body: new URLSearchParams({ trandata }).toString(),
  })
  return { status: r.status, type: r.headers.get('content-type') || '', location: r.headers.get('location'), text: await r.text() }
}
const status = (t) => sql(`select payment_status from orders where track_id = '${t}'`)

try {
  sql('delete from rate_limit; delete from rate_bucket')

  // R1 + R4
  let t = order('OK')
  let r = await notify(enc(resp(t, 'CAPTURED')))
  check(r.status === 200 && /^REDIRECT=\S+$/.test(r.text) && !r.text.includes('<') && !r.text.includes('\n') && !r.location,
    'R1 the notification is answered with only the line REDIRECT=<url>', JSON.stringify({ s: r.status, t: r.text.slice(0, 90), loc: r.location }))
  check(r.type.startsWith('text/plain'), 'R1 as text/plain', r.type)
  check(r.text.includes('status=success'), 'R1 the line points the shopper at the success receipt', r.text.slice(0, 120))
  check(status(t) === 'paid', 'R4 CAPTURED at the right amount → paid', status(t))

  // R8 — a later decline does not downgrade it
  await notify(enc(resp(t, 'NOT CAPTURED')))
  check(status(t) === 'paid', 'R8 NOT CAPTURED after a payment leaves the order paid', status(t))

  // R2
  r = await notify('DEADBEEF00')
  check(r.status === 200 && /^REDIRECT=\S+$/.test(r.text) && !r.location, 'R2 an unusable trandata is answered with only the line too', r.text.slice(0, 90))

  // R3 — the error URL
  const tp = order('ER'), tPaid = order('EP', 'paid')
  sql(`update orders set cbk_message = 'kept' where track_id = '${tPaid}'`)
  let e = await fetch(`${BASE}/knet/callback.php?ErrorText=IPAY0100158+Host+timeout&trackid=${tp}`, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } })
  check(e.status === 302 && (e.headers.get('location') || '').includes('status=error'), 'R3 the error URL redirects the browser (302) to the result page', `${e.status} ${e.headers.get('location')}`)
  check(sql(`select cbk_message from orders where track_id = '${tp}'`) === 'IPAY0100158 Host timeout' && status(tp) === 'pending',
    'R3 the error text is noted on the pending order, and its status is untouched', `${sql(`select cbk_message from orders where track_id = '${tp}'`)} / ${status(tp)}`)
  await fetch(`${BASE}/knet/callback.php?ErrorText=forged&trackid=${tPaid}`, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } })
  check(sql(`select cbk_message from orders where track_id = '${tPaid}'`) === 'kept' && status(tPaid) === 'paid', 'R3 a paid order is not written by the unsigned error URL')

  // R5
  t = order('HT'); await notify(enc(resp(t, 'HOST TIMEOUT')))
  check(status(t) === 'review', 'R5 HOST TIMEOUT → review, not failed', status(t))

  // R6
  t = order('AP'); await notify(enc(resp(t, 'APPROVED')))
  check(status(t) === 'review', 'R6 APPROVED → review, not paid', status(t))

  // R7
  t = order('MM'); r = await notify(enc(resp(t, 'CAPTURED', '0.500')))
  check(status(t) === 'review', 'R7 CAPTURED at the wrong amount → review, not failed', status(t))
  check(r.text.includes('status=review'), 'R7 the shopper is sent to the review receipt', r.text.slice(0, 120))
} finally {
  writeFileSync(CB, cbOrig)
  const list = made.map((x) => `'${x}'`).join(',') || "''"
  sql(`delete from fulfilment_outbox where order_id in (select id from orders where track_id in (${list}));
       set foreign_key_checks=0;
       delete from journal_lines where entry_id in (select id from journal_entries where source_ref in (select concat('order:', id) from orders where track_id in (${list})) or source_ref in (select id from orders where track_id in (${list})));
       delete from journal_entries where source_ref in (select concat('order:', id) from orders where track_id in (${list})) or source_ref in (select id from orders where track_id in (${list}));
       set foreign_key_checks=1;
       delete from knet_responses where track_id in (${list});
       delete from orders where track_id in (${list})`)
  check(readFileSync(CB, 'utf8') === cbOrig, 'knet/callback.php is back exactly as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall KNET refresh checks passed')
  process.exitCode = fails ? 1 : 0
}
