// CBK hosted gateway (T-Pay) — the parts that decide whether money is recorded.
//
// Driven against the real PHP endpoints, a stub gateway standing in for CBK,
// and real PostgreSQL. The stub matters: what is being tested is our handling
// of CBK's answers, and the answers worth testing are the awkward ones — a
// success whose amount does not match, a failure, a repeat.
//
// Needs: php -S on :8133 serving dropin/php-cbk with a test config, the stub
// gateway on :8132, the PostgREST shim on :8130, PostgreSQL on :5433.
import { execFileSync } from 'node:child_process'

const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'sporta', '-tAq']
const q = (sql) => execFileSync('psql', [...PSQL, '-c', sql]).toString().trim()
const PAY = 'http://127.0.0.1:8133'
const STUB = 'http://127.0.0.1:8132'

const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

const curl = (url, opts = []) =>
  execFileSync('curl', ['-s', '-H', 'X-Forwarded-Proto: https', ...opts, url]).toString()
const code = (url, opts = []) =>
  execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...opts, url]).toString()

function newOrder(track, method = 'tpay') {
  q(`delete from order_items where order_id in (select id from orders where track_id='${track}');
     delete from orders where track_id='${track}';`)
  return q(`select public.create_order('${track}','[{"slug":"flash-shorts-red","qty":2}]'::jsonb,
    '{"name":"Test Buyer","phone":"99887766","governorate":"hawalli","area":"Salmiya",
      "block":"1","street":"X","building":"1"}'::jsonb,'${method}')`)
}
const setStub = (obj) => curl(`${STUB}/__set`, ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(obj)])

// ---- 1. plain HTTP is refused on both endpoints ------------------------------
ok('pay.php refuses plain HTTP', code(`${PAY}/pay.php?trackid=X`) === '403')
ok('callback.php refuses plain HTTP', code(`${PAY}/callback.php?encrp=X`) === '403')

// ---- 2. the amount comes from the database, never the URL --------------------
{
  newOrder('TPAYOK0001')
  const dbAmount = q(`select amount from orders where track_id='TPAYOK0001'`)
  const form = curl(`${PAY}/pay.php?trackid=TPAYOK0001&paytype=2&amount=0.001`)
  const sent = form.match(/name="tij_MerchantPaymentAmount" value="([^"]*)"/)?.[1]
  ok('a URL amount is ignored — the order total is charged',
     Number(sent) === Number(dbAmount), `url said 0.001, sent ${sent}, order is ${dbAmount}`)
  ok('T-Pay selects the QR payment type',
     /name="tij_MerchPayType" value="2"/.test(form))
  ok('the merchant key and token are posted, not the secret',
     /tij_MerchantEncryptCode/.test(form) && !/CSEC/.test(form))
}

// ---- 3. a captured payment is recorded --------------------------------------
{
  setStub({ Status: '1', TrackId: 'TPAYOK0001', Amount: q(`select amount from orders where track_id='TPAYOK0001'`),
            PaymentId: '900900', ReferenceId: 'REFOK', PayType: '2', Message: 'Captured' })
  curl(`${PAY}/callback.php?encrp=ENCRP1`)
  const row = q(`select payment_status||'|'||coalesce(cbk_paymentid,'')||'|'||coalesce(cbk_reference,'')||'|'||
                 case when paid_at is null then 'no-paid_at' else 'paid_at' end
                 from orders where track_id='TPAYOK0001'`)
  ok('captured T-Pay payment is recorded as paid', row === 'paid|900900|REFOK|paid_at', row)
}

// ---- 4. a mismatched amount must NOT be marked paid --------------------------
{
  newOrder('TPAYBAD001')
  const real = q(`select amount from orders where track_id='TPAYBAD001'`)
  setStub({ Status: '1', TrackId: 'TPAYBAD001', Amount: '0.100', PaymentId: '1', ReferenceId: 'R', PayType: '2' })
  curl(`${PAY}/callback.php?encrp=ENCRP2`)
  const row = q(`select payment_status from orders where track_id='TPAYBAD001'`)
  ok('a payment for the wrong amount is not marked paid', row !== 'paid', `status=${row}`)
  ok('...and is held for review rather than filed as failed', row === 'review', `status=${row}`)
  ok('...and the order total is left alone',
     q(`select amount from orders where track_id='TPAYBAD001'`) === real,
     `still ${real}`)
}

// ---- 5. a declined payment ---------------------------------------------------
{
  newOrder('TPAYFAIL01')
  setStub({ Status: '2', TrackId: 'TPAYFAIL01', Amount: '0', PaymentId: '', ReferenceId: '', PayType: '2' })
  curl(`${PAY}/callback.php?encrp=ENCRP3`)
  ok('a declined payment is recorded as failed',
     q(`select payment_status from orders where track_id='TPAYFAIL01'`) === 'failed')
  ok('...and has no paid_at',
     q(`select coalesce(paid_at::text,'none') from orders where track_id='TPAYFAIL01'`) === 'none')
}

// ---- 6. a missing encrp is not a silent success ------------------------------
{
  const out = curl(`${PAY}/callback.php`, ['-o', '/dev/null', '-D', '-'])
  ok('a callback with no encrp redirects to an error, not success',
     /status=error/.test(out) && !/status=success/.test(out))
}

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
