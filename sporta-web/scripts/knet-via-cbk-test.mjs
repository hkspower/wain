// ONE SETUP FOR BOTH: KNET paid through the CBK hosted gateway (the T-Pay
// config: ClientId / ClientSecret / ENCRP_KEY), with tij_MerchPayType = 1, when
// `knet_via_cbk` is on — and nothing changes while it is off.
//
//   npm run test:knet-via-cbk   (needs the sandbox: MariaDB, :8099 fake CBK)
//
// It serves a COPY of the three dropins in the shared-hosting layout
// (T/knet, T/pay, T/api) so /knet/pay.php can find /pay/config.php exactly as
// it will on the server, and it writes only configs it owns.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PORT = 8136
const BASE = `http://127.0.0.1:${PORT}`
const GW = 'http://127.0.0.1:8099'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (s) => console.log(`\n=== ${s} ${'='.repeat(Math.max(3, 58 - s.length))}`)
const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()

const T = fs.mkdtempSync(join(tmpdir(), 'sporta-knetcbk-'))
for (const [from, to] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
  fs.cpSync(join(WEB, 'dropin', from), join(T, to), { recursive: true })
}
// The sandbox's gitignored configs: the store's DB, KNET's (test) and CBK's.
// Only the CBK one is edited here: its return URL must come back to THIS server.
const cbkCfgPath = join(T, 'pay', 'config.php')
const writeCbk = async (extra) => {
  await run('php', ['-r', `$c = require '${cbkCfgPath}'; $c['return_url'] = '${BASE}/pay/callback.php';`
    + ` $c['token_cache_file'] = '/tmp/.cbk_token_knetcbk.json'; $c['log_file'] = '/tmp/cbk-knetcbk.log';`
    + ` unset($c['knet_via_cbk']); $c += json_decode('${JSON.stringify(extra)}', true);`
    + ` file_put_contents('${cbkCfgPath}', '<?php return ' . var_export($c, true) . ';');`])
}
await writeCbk({})
await run('mariadb', ['sporta', '-e', 'delete from rate_limit; update product_variants set stock = 1000'])
await run('rm', ['-f', '/tmp/.cbk_token_knetcbk.json', '/tmp/fake-cbk-txns.json'])

// opcache.enable=0: the built-in server honours `opcache.enable` (not enable_cli),
// and with revalidate_freq=2 it served a pay/config.php rewritten a moment ago from
// its cache, so the "switch ON" step intermittently still saw the switch off.
const server = spawn('php', ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${PORT}`, '-t', T], { stdio: 'ignore' })
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/api.php?r=theme`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }

const HTTPS = { 'X-Forwarded-Proto': 'https' }
const get = (url) => fetch(url, { headers: HTTPS, redirect: 'manual' })
const newOrder = async (track, method) => (await fetch(`${BASE}/api/api.php?r=order`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ track_id: track, items: [{ slug: 'cloudsoft-jacket-army-green', qty: 2, size: 'L', fit: 'oversize' }],
    customer: { name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' },
    payment_method: method }),
})).json()
const formFields = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const formAction = (html) => /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? ''
const payThrough = async (html, query = '') => {
  const action = formAction(html).replace(/&amp;/g, '&')
  const gw = await (await fetch(action + (query ? (action.includes('?') ? '&' : '?') + query : ''), { method: 'POST', body: new URLSearchParams(formFields(html)) })).json()
  const back = await get(gw.return_url)
  return { gw, location: back.headers.get('location') ?? '' }
}

try {
  await sql('delete from fulfilment_outbox; delete from order_items; delete from orders;')

  head('switch OFF (the default): nothing changes')
  const k1 = await newOrder('SPKC0001', 'knet')
  is(k1.amount === 21, 'a KNET order is created and priced by the server', `${k1.amount}`)
  const off = await get(`${BASE}/pay/pay.php?trackid=SPKC0001`)
  is(off.status === 409, 'the CBK endpoint refuses a KNET order', `${off.status} ${(await off.text()).slice(0, 60)}`)
  const classic = await get(`${BASE}/knet/pay.php?trackid=SPKC0001`)
  is(!(classic.status === 302 && /\/pay\/pay\.php/.test(classic.headers.get('location') ?? '')), '/knet/pay.php does NOT hand over to CBK', `${classic.status}`)
  // T-Pay is no longer a customer method (2026-11-03): a NEW tpay order is refused, so the T-Pay order below is an order
  // placed as a card order and recorded as T-Pay, which is what an order from before that change looks like.
  const refusedTpay = await newOrder('SPKC0009', 'tpay')
  is(refusedTpay.error === 'payment_method_unavailable', 'a new T-Pay order is refused: payment_method_unavailable', JSON.stringify(refusedTpay).slice(0, 120))
  const t0 = await newOrder('SPKC0002', 'knet')
  await sql(`update orders set payment_method = 'tpay' where track_id = 'SPKC0002'`)
  const tf = formFields(await (await get(`${BASE}/pay/pay.php?trackid=SPKC0002`)).text())
  is(t0.amount === 21 && tf.tij_MerchPayType === '2', 'a T-Pay order still goes out as PayType 2', tf.tij_MerchPayType)

  head('switch ON: KNET through the CBK setup')
  await writeCbk({ knet_via_cbk: true })
  const hand = await get(`${BASE}/knet/pay.php?trackid=SPKC0001&lang=ar`)
  const loc = hand.headers.get('location') ?? ''
  is(hand.status === 302 && loc === '/pay/pay.php?trackid=SPKC0001&lang=ar', '/knet/pay.php hands the customer to /pay/pay.php with the same track id', `${hand.status} ${loc}`)
  const next = await get(`${BASE}${loc}`)
  const html = await next.text()
  const f = formFields(html)
  is(f.tij_MerchPayType === '1', 'the CBK form asks for KNET only (tij_MerchPayType = 1)', f.tij_MerchPayType)
  // The classic /knet/pay.php hit above already took attempt 1 (the counter is
  // shared), so this is a retry: the gateway reference carries a suffix and the
  // order's own id travels in udf5, which is what the callback resolves.
  is(f.tij_MerchantPaymentAmount === '21.000' && f.tij_MerchantPaymentTrack.startsWith('SPKC0001') && f.tij_MerchantUdf5 === 'SPKC0001',
     'amount from the database, the order id carried in udf5', `${f.tij_MerchantPaymentAmount} ${f.tij_MerchantPaymentTrack}`)
  is(f.tij_MerchantEncryptCode === 'TESTENCRP' && f.tij_MerchAuthKeyApi?.startsWith('FAKETOKEN-'), 'it uses the CBK ENCRP_KEY and a real AccessToken')
  const forged = await get(`${BASE}/pay/pay.php?trackid=SPKC0001&paytype=2&amount=0.100`)
  const ff = formFields(await forged.text())
  is(ff.tij_MerchPayType === '1' && ff.tij_MerchantPaymentAmount === '21.000', 'a paytype or amount in the URL changes nothing', `${ff.tij_MerchPayType} ${ff.tij_MerchantPaymentAmount}`)
  const still = formFields(await (await get(`${BASE}/pay/pay.php?trackid=SPKC0002`)).text())
  is(still.tij_MerchPayType === '2', 'a T-Pay order is still PayType 2 with the switch on', still.tij_MerchPayType)

  head('the bank answers')
  const done = await payThrough(html, 'outcome=success')
  is(done.gw.sent?.tij_MerchPayType === '1', 'the gateway received PayType 1', done.gw.sent?.tij_MerchPayType)
  is(done.location.includes('status=success') && done.location.includes('SPKC0001'), 'the customer lands on the success page', done.location.split('?')[1] ?? '')
  const row = (await sql("select payment_status, payment_method, paid_at is not null, cbk_paytype from orders where track_id='SPKC0001'")).split('\t')
  is(row[0] === 'paid' && row[1] === 'knet' && row[2] === '1', 'the order is PAID and is still recorded as a KNET order', row.join(' | '))
  is(row[3] === 'KNET', "the bank's own pay type (KNET) is stored for reconciliation", row[3])
  const outbox = await sql("select count(*) from fulfilment_outbox where kind='payment' and order_id=(select id from orders where track_id='SPKC0001')")
  is(outbox === '1', 'one "payment received" message is queued', outbox)
  const again = await get(`${BASE}/pay/pay.php?trackid=SPKC0001`)
  is(again.status === 409, 'a paid KNET order cannot be paid again', `${again.status}`)

  const k3 = await newOrder('SPKC0003', 'knet')
  const under = await payThrough(await (await get(`${BASE}/pay/pay.php?trackid=SPKC0003`)).text(), 'outcome=success&amt=1.000')
  is((await sql("select payment_status from orders where track_id='SPKC0003'")) === 'review' && k3.amount === 21, 'an underpayment is held for review, not banked', under.location.split('?')[1] ?? '')
  const k4 = await newOrder('SPKC0004', 'knet')
  await payThrough(await (await get(`${BASE}/pay/pay.php?trackid=SPKC0004`)).text(), 'outcome=failed')
  is((await sql("select payment_status from orders where track_id='SPKC0004'")) === 'failed' && k4.amount === 21, 'a declined card closes the order')

  head('cash on delivery is never taken here')
  const cod = await newOrder('SPKC0005', 'cod')
  const refuse = await get(`${BASE}/pay/pay.php?trackid=SPKC0005`)
  is(cod.amount === 21 && refuse.status === 409, 'a cash-on-delivery order is refused by the CBK endpoint', `${refuse.status}`)
  head('an unreadable CBK config stops KNET instead of falling back to Tranportal')
  // The CBK file EXISTS but does not parse: its switch may be on. Carrying on would send the customer to the
  // classic Tranportal gateway when the shop meant CBK, so the payment stops (503) and nothing is redirected.
  fs.writeFileSync(cbkCfgPath, '<?php return [ "knet_via_cbk" => ;\n')
  const broken = await get(`${BASE}/knet/pay.php?trackid=SPKC0001`)
  is(broken.status === 503 && !broken.headers.get('location'),
     'with the CBK config unreadable, /knet/pay.php answers 503 and starts no payment', `${broken.status} ${broken.headers.get('location') ?? ''}`)
} finally {
  server.kill()
  fs.rmSync(T, { recursive: true, force: true })
  await run('rm', ['-f', '/tmp/.cbk_token_knetcbk.json']).catch(() => {})
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK')
process.exit(fails ? 1 : 0)
