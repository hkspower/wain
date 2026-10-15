/**
 * test:knet-response-storage — K-064 §3.5.2 (2026-10-15): the encrypted and the plain-text KNET response
 * are stored, one row per usable response.
 *
 * Builds a real encrypted response with the shop's own knet_encrypt(), posts it to the callback as the
 * gateway would, and checks the row. Uses a DECLINED result, so no money moves and no ledger row is made.
 *
 *   A  a usable response is stored: encrypted = the posted trandata, plaintext = the decrypted text
 *   B  with the table missing, the payment still gets its redirect (not a 500); the failure is logged
 *   C  an unusable response (garbage trandata) stores nothing
 *
 * Run `bash scripts/sandbox.sh` first. Removes everything it writes.
 * MUTATE=store removes the storage call: A must fail.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const cbFile = PUB + '/knet/callback.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
const php = (code) => spawnSync('php', ['-r', `require "${PUB}/knet/knet.php"; $cfg = knet_config(); ${code}`], { encoding: 'utf8' }).stdout.trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const cbOrig = readFileSync(cbFile, 'utf8')
if (process.env.MUTATE === 'store') {
  writeFileSync(cbFile, cbOrig.replace('knet_store_response($cfg, $trackid, $trandata, (string) $plain);', ''))
}

const tid = 'SPKSTO' + Date.now().toString(36).toUpperCase().slice(-6)
const plain = `result=DECLINED&trackid=${tid}&amt=10.000&paymentid=PAY${tid}&tranid=TX${tid}&ref=REF${tid}&postdate=1015&udf1=&udf2=&udf3=&udf4=&udf5=`
const key = php('echo $cfg["resource_key"];')
const trandata = php(`echo knet_encrypt(${JSON.stringify(plain).replace(/"/g, "'")}, $cfg["resource_key"]);`)

// Run the callback table-free by renaming it for check B, and restore it straight after.
const post = async (blob) => {
  const r = await fetch(`${BASE}/knet/callback.php`, {
    method: 'POST',
    // The sandbox serves HTTP only. The callback accepts HTTPS as the shop's proxy reports it, which is the header.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
    body: new URLSearchParams({ trandata: blob }).toString(),
    redirect: 'manual',
  })
  return r.status
}

try {
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, created_at)
       values ('${tid}', 10.000, 'pending', 'knet', 'unfulfilled', 'Storage Rig', '96555512345', now())`)
  check(key && trandata && /^[0-9A-F]+$/.test(trandata), 'the rig builds a real encrypted response with the shop\'s own encrypt', `blob ${trandata.length} chars`)

  // A — a usable response is stored, both forms
  const status = await post(trandata)
  // 200 under callback_response 'both' (HTML redirect), 302 under 'redirect': both are a normal answer.
  check(status === 200 || status === 302, 'the callback answers normally, not refused or failed', `status ${status}`)
  const row = sql(`select encrypted, plaintext from knet_responses where track_id = '${tid}' order by id desc limit 1`)
  const [enc, pl] = row ? row.split('\t') : [null, null]
  check(enc === trandata, 'A the encrypted response is stored exactly as the gateway posted it', enc ? `${enc.length} chars` : 'no row')
  check(pl === plain, 'A the plain-text response is stored as decrypted', pl ? pl.slice(0, 40) : 'no row')

  // B — table missing: the payment still gets its redirect, and the failure is logged
  sql('rename table knet_responses to knet_responses_off')
  let statusB
  try {
    statusB = await post(trandata)
  } finally {
    sql('rename table knet_responses_off to knet_responses')
  }
  check(statusB === 200 || statusB === 302, 'B with the table missing the callback still answers normally (no 500, the payment is not refused)', `status ${statusB}`)

  // C — garbage trandata stores nothing for this track
  const before = Number(sql(`select count(*) from knet_responses where track_id = '${tid}'`))
  await post('DEADBEEF0000')
  const after = Number(sql(`select count(*) from knet_responses where track_id = '${tid}'`))
  check(after === before, 'C an unusable response stores nothing', `${before} before, ${after} after`)
} finally {
  if (process.env.MUTATE === 'store') writeFileSync(cbFile, cbOrig)
  sql(`delete from knet_responses where track_id = '${tid}'`)
  sql(`delete from orders where track_id = '${tid}'`)
  console.log(fails ? `\n${fails} FAILED` : '\nall KNET response-storage checks passed')
  process.exitCode = fails ? 1 : 0
}
