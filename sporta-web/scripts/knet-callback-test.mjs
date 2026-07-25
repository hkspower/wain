// End-to-end test of the KNET response handler.
//
// Runs the real callback.php under a real PHP server, against a PostgREST
// stand-in backed by a real PostgreSQL carrying schema.sql — so the column
// names, the RLS-free service path, and the fail-closed amount check are all
// genuinely exercised. The trandata is built with the same AES-128-CBC routine
// KNET uses, so the handler decrypts a real payload rather than a fixture.
//
// Needs: PostgreSQL on :5433 (db "sporta"), PHP CLI.
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCipheriv } from 'node:crypto'
import { mkdtempSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'sporta', '-tAq']
const sql = async (q) => (await run('psql', [...PSQL, '-c', q])).stdout.trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const KEY = '1234567890123456' // 16 bytes, as AES-128 requires
const IV = 'PGKEYENCDECIVSPC' // fixed by KNET

const encryptTrandata = (fields) => {
  const plain = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const c = createCipheriv('aes-128-cbc', KEY, IV)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex').toUpperCase()
}

// ---- PostgREST stand-in over the real database -----------------------------
const rest = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const track = (u.searchParams.get('track_id') || '').replace('eq.', '')
    try {
      if (req.method === 'GET') {
        const out = await sql(
          `select coalesce(json_agg(t),'[]')::text from (select amount, payment_status from orders where track_id=${lit(track)}) t`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(out)
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse(raw)
        // PostgREST rejects the whole request if any column is unknown — the
        // behaviour that made the original bug invisible. Reproduce it.
        const cols = await sql(
          `select string_agg(column_name,',') from information_schema.columns where table_name='orders'`)
        const known = new Set(cols.split(','))
        const bad = Object.keys(body).find((k) => !known.has(k))
        if (bad) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ code: 'PGRST204', message: `Column '${bad}' of relation 'orders' does not exist` }))
        }
        const sets = Object.entries(body)
          .map(([k, v]) => `${k}=${v === null ? 'null' : lit(v)}`).join(', ')
        let where = `track_id=${lit(track)}`
        if (u.searchParams.get('payment_status') === 'neq.paid') where += ` and payment_status <> 'paid'`
        await sql(`update orders set ${sets} where ${where}`)
        res.writeHead(204).end()
        return
      }
      res.writeHead(404).end()
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: String(e.stderr || e.message).slice(0, 300) }))
    }
  })
})
await new Promise((r) => rest.listen(8150, '127.0.0.1', r))

// ---- a throwaway knet/ directory with a test config ------------------------
const dir = mkdtempSync(join(tmpdir(), 'knet-'))
cpSync(new URL('../dropin/php-knet', import.meta.url).pathname, dir, { recursive: true })
// PHP array syntax, not JSON — a JSON object literal is a PHP parse error, and
// a config.php that fails to parse makes every request 500 with no clue why.
const cfg = {
  env: 'test',
  test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
  production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
  tranportal_id: 'TEST', tranportal_password: 'TESTPW', resource_key: KEY,
  response_url: 'https://x/knet/callback.php', error_url: 'https://x/knet/callback.php',
  result_page_url: 'https://www.sporta.com.kw/payment/result',
  action: '1', currency_code: '414', language: 'EN',
  log_file: join(dir, 'payments.log'),
  supabase_url: 'http://127.0.0.1:8150', supabase_service_key: 'test-service-key',
  orders_table: 'orders', orders_match_column: 'track_id',
}
writeFileSync(
  join(dir, 'config.php'),
  '<?php return [\n' +
    Object.entries(cfg).map(([k, v]) => `  '${k}' => '${String(v).replace(/'/g, "\\'")}',`).join('\n') +
    '\n];\n',
)

const php = (await import('node:child_process')).spawn('php', ['-S', '127.0.0.1:8151', '-t', dir], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 900))

// ---------------------------------------------------------------------------
const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

async function callback(fields) {
  const r = await fetch('http://127.0.0.1:8151/callback.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
    body: new URLSearchParams({ trandata: encryptTrandata(fields) }),
    redirect: 'manual',
  })
  return { status: r.status, location: r.headers.get('location') ?? '' }
}
const order = (track) => sql(
  `select coalesce(payment_status,'')||'|'||coalesce(cbk_status,'')||'|'||coalesce(cbk_paymentid,'')||'|'||coalesce(cbk_reference,'')||'|'||case when paid_at is null then 'no-paid_at' else 'paid_at' end from orders where track_id=${lit(track)}`)

const fresh = async (track, amount) => {
  await sql(`delete from order_items where order_id in (select id from orders where track_id=${lit(track)}); delete from orders where track_id=${lit(track)}`)
  await sql(`insert into orders(track_id, amount, payment_status) values (${lit(track)}, ${amount}, 'pending')`)
}

// 1. the happy path — this is what was silently failing
await fresh('SPOK0001', 24.0)
let r = await callback({ result: 'CAPTURED', trackid: 'SPOK0001', amt: '24.000', paymentid: '100200300', tranid: 'T900', ref: 'REF900', auth: 'A55', postdate: '0725' })
let row = await order('SPOK0001')
ok('captured payment is recorded as paid', row.startsWith('paid|CAPTURED|100200300|REF900|paid_at'), row)
ok('customer is sent to the success page', r.location.includes('status=success'), r.location.split('?')[1])

// 2. amount tampering at the bank leg
await fresh('SPAMT0001', 24.0)
await callback({ result: 'CAPTURED', trackid: 'SPAMT0001', amt: '0.100', paymentid: '1', ref: 'R', auth: 'A' })
row = await order('SPAMT0001')
ok('underpayment is refused, not marked paid', row.startsWith('failed|AMOUNT_MISMATCH'), row)

// 3. unknown order -> held for review, never silently paid
r = await callback({ result: 'CAPTURED', trackid: 'SPGHOST01', amt: '24.000', paymentid: '2', ref: 'R', auth: 'A' })
ok('unknown order is held for review', r.location.includes('status=review'), r.location.split('?')[1])

// 4. a replayed failure must not downgrade a paid order
await callback({ result: 'CANCELED', trackid: 'SPOK0001', amt: '24.000', paymentid: '100200300', ref: 'REF900' })
row = await order('SPOK0001')
ok('late failure cannot un-pay a paid order', row.startsWith('paid|CAPTURED'), row)

// 5. a replayed success is idempotent
await callback({ result: 'CAPTURED', trackid: 'SPOK0001', amt: '24.000', paymentid: '100200300', tranid: 'T900', ref: 'REF900', auth: 'A55' })
const dup = await sql(`select count(*)::text from orders where track_id='SPOK0001'`)
ok('replayed success does not duplicate the order', dup === '1', `${dup} row(s)`)

// 6. a forged callback signed with the wrong key must not be accepted
const wrong = (() => {
  const c = createCipheriv('aes-128-cbc', '6543210987654321', IV)
  return Buffer.concat([c.update('result=CAPTURED&trackid=SPFORGE01&amt=999.000', 'utf8'), c.final()]).toString('hex').toUpperCase()
})()
await fresh('SPFORGE01', 24.0)
const forged = await fetch('http://127.0.0.1:8151/callback.php', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
  body: new URLSearchParams({ trandata: wrong }), redirect: 'manual',
})
row = await order('SPFORGE01')
ok('callback encrypted with the wrong key is rejected',
   (forged.headers.get('location') ?? '').includes('decrypt_failed') && row.startsWith('pending'),
   row)

// 7. plaintext HTTP is refused
const insecure = await fetch('http://127.0.0.1:8151/callback.php', { method: 'POST', redirect: 'manual' })
ok('plain HTTP is refused', insecure.status === 403, `HTTP ${insecure.status}`)

php.kill(); rest.close()
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
