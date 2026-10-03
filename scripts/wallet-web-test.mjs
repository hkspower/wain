/**
 * test:wallet-web — the Apple Wallet card in both languages, and the update service that keeps a
 * saved card's points current (2026-10-03). Runs against the sandbox (bash scripts/sandbox.sh).
 *
 *  - a stand-in certificate is made in sporta-site/wallet-certs for the run (refused if a real one
 *    is there) and removed after, so wallet.php really signs and passkit.php really serves;
 *  - the card: web service + token, every label a KEY that both en.lproj and ar.lproj translate,
 *    the strings files UTF-16 with a BOM, the new colours, the back of the card from /backends;
 *  - the service: registration needs the card's own token, "what changed?" answers 204 when nothing
 *    did, a paid order makes it answer the serial, the card fetch is the card, If-Modified-Since is
 *    a 304, and fetching a card does NOT mark it changed again (the loop that would make every phone
 *    re-download it for ever).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:4300'
const CERTS = 'sporta-site/wallet-certs'
const TYPE = 'pass.kw.com.sporta.card'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== '' ? '   ' + detail : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()

if (existsSync(join(CERTS, 'pass.pem'))) { console.error('a certificate is already installed in ' + CERTS + ' — refusing to replace it'); process.exit(1) }
const madeDir = !existsSync(CERTS)
mkdirSync(CERTS, { recursive: true })
execFileSync('php', ['-r', `
  $d = '${CERTS}';
  $ca = openssl_pkey_new(['private_key_bits' => 2048]);
  $caCrt = openssl_csr_sign(openssl_csr_new(['commonName' => 'Stand-in WWDR'], $ca), null, $ca, 2);
  $k = openssl_pkey_new(['private_key_bits' => 2048]);
  $crt = openssl_csr_sign(openssl_csr_new(['UID' => '${TYPE}', 'commonName' => 'Pass Type ID: ${TYPE}', 'organizationalUnitName' => 'ABCDE12345', 'organizationName' => 'Sporta Test'], $k), $caCrt, $ca, 2);
  openssl_x509_export($caCrt, $w); openssl_x509_export($crt, $c); openssl_pkey_export($k, $kp);
  file_put_contents("$d/wwdr.pem", $w); file_put_contents("$d/pass.pem", $c); file_put_contents("$d/pass.key", $kp);
`])

const cleanCerts = () => { for (const f of ['pass.pem', 'pass.key', 'wwdr.pem']) rmSync(join(CERTS, f), { force: true }); if (madeDir) rmSync(CERTS, { recursive: true, force: true }) }
// The stand-in certificate exists from here on; anything that fails before the main try (a stopped
// database, say) must still take it away, or the next run refuses to start.
let orderId, track, phone
// A fresh sandbox has no paid order, and this rig used to pass only when another rig had left one. It
// plants its own (track SPWALLETRIG) when there is none, and deletes exactly that row at the end.
const OWN_TRACK = 'SPWALLETRIG'
let plantedOrder = false
try {
  if (sql("select count(*) from orders where payment_status = 'paid' and customer_phone <> ''") === '0') {
    sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, paid_at, created_at) values ('${OWN_TRACK}', 12.5, 'paid', 'knet', 'unfulfilled', 'Wallet Rig', '96555519876', now(), now())`)
    plantedOrder = true
  }
  ;[orderId, track, phone] = sql("select id, track_id, customer_phone from orders where payment_status = 'paid' and customer_phone <> '' order by id limit 1").split('\t')
}
catch (e) { cleanCerts(); console.error('sandbox database unreachable — run bash scripts/sandbox.sh'); process.exit(1) }
sql(`delete r from wallet_registrations r join wallet_passes p on p.serial = r.serial where p.phone = '${phone}'`)
sql(`delete from wallet_passes where phone = '${phone}'`)
sql('delete from rate_limit')
const work = mkdtempSync(join(tmpdir(), 'wallet-web-'))
const unzip = (file, name) => execFileSync('unzip', ['-p', file, name])

try {
  // ---------------------------------------------------------------- the card
  const r = await fetch(`${BASE}/api/wallet.php?r=loyalty&phone=${encodeURIComponent(phone)}&track=${track}`)
  check(r.status === 200 && /pkpass/.test(r.headers.get('content-type') || ''), 'wallet.php issues a signed card', `${r.status} ${r.headers.get('content-type')}`)
  const file = join(work, 'card.pkpass')
  writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  const list = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n')
  const pass = JSON.parse(unzip(file, 'pass.json').toString())
  const serial = pass.serialNumber
  check(pass.webServiceURL === 'https://www.sporta.com.kw/api/passkit.php', 'the card carries the update service', pass.webServiceURL)
  check(/^[a-f0-9]{32}$/.test(pass.authenticationToken || ''), 'and its own 32-character token')
  check(sql(`select auth_token from wallet_passes where serial = '${serial}'`) === pass.authenticationToken, 'the token is the one stored for that card')
  check(pass.backgroundColor === 'rgb(45, 48, 52)' && pass.labelColor === 'rgb(247, 140, 80)', 'the new colours: header grey, light orange labels', `${pass.backgroundColor} / ${pass.labelColor}`)
  check(['strip.png', 'strip@2x.png', 'strip@3x.png', 'logo@3x.png'].every((f) => list.includes(f)), 'the redrawn strip at 1x, 2x and 3x')
  check(list.every((f) => !f.includes('/') || /^(en|ar)\.lproj\/pass\.strings$/.test(f)), 'flat, apart from the two translation folders', list.filter((f) => f.includes('/')).join(' '))

  const parse = (buf) => {
    check(buf[0] === 0xff && buf[1] === 0xfe, 'a strings file is UTF-16LE with a BOM')
    const t = new TextDecoder('utf-16le').decode(buf.subarray(2))
    return Object.fromEntries([...t.matchAll(/"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";/g)].map((m) => [m[1], m[2]]))
  }
  const en = parse(unzip(file, 'en.lproj/pass.strings')), ar = parse(unzip(file, 'ar.lproj/pass.strings'))
  const card = pass.storeCard
  const fields = [...card.headerFields, ...card.primaryFields, ...card.secondaryFields, ...card.backFields]
  const keys = new Set(fields.map((f) => f.label).concat(fields.map((f) => f.changeMessage).filter(Boolean),
    fields.map((f) => f.value).filter((v) => typeof v === 'string' && /^[A-Z_]+$/.test(v))))
  const missing = [...keys].filter((k) => !(k in en) || !(k in ar))
  check(missing.length === 0, `every label and fixed value is translated in both languages (${keys.size} keys)`, missing.join(' '))
  check(/[؀-ۿ]/.test(ar.POINTS) && en.POINTS === 'Points', 'Arabic in ar.lproj, English in en.lproj', `${en.POINTS} / ${ar.POINTS}`)
  check(/%@/.test(en.CHANGE_POINTS) && /%@/.test(ar.CHANGE_POINTS), 'the "balance is now" message keeps its %@ in both')
  const back = Object.fromEntries(card.backFields.map((f) => [f.key, f]))
  const contact = JSON.parse(sql("select value from settings where name = 'contact'") || '{}')
  check(!!back.how && !!back.shop && !!back.track && !!back.card, 'the back explains points and links the shop, tracking and the card page')
  check(!contact.phone || back.phone?.value === contact.phone, 'the phone on the back is the one set in /backends', back.phone?.value)
  const manifest = JSON.parse(unzip(file, 'manifest.json').toString())
  check(manifest['en.lproj/pass.strings'] && manifest['ar.lproj/pass.strings'], 'the translations are in the signed manifest')

  // ------------------------------------------------------------- the service
  const svc = `${BASE}/api/passkit.php/v1`
  const dev = 'dev' + Date.now()
  const auth = { Authorization: `ApplePass ${pass.authenticationToken}`, 'Content-Type': 'application/json' }
  const reg = `${svc}/devices/${dev}/registrations/${TYPE}/${serial}`
  const body = JSON.stringify({ pushToken: 'a'.repeat(64) })
  check((await fetch(reg, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status === 401, 'registering without the token is 401')
  check((await fetch(reg, { method: 'POST', body, headers: { ...auth, Authorization: 'ApplePass ' + '0'.repeat(32) } })).status === 401, 'with a wrong token, 401')
  check((await fetch(`${svc}/devices/${dev}/registrations/${TYPE}/SP-NOSUCH`, { method: 'POST', body, headers: auth })).status === 401, 'an unknown serial is the same 401')
  check((await fetch(reg, { method: 'POST', body, headers: auth })).status === 201, 'the right token registers the phone (201)')
  check((await fetch(reg, { method: 'POST', body, headers: auth })).status === 200, 'registering again is 200')

  let q = await fetch(`${svc}/devices/${dev}/registrations/${TYPE}`)
  const first = q.status === 200 ? await q.json() : {}
  check(q.status === 200 && first.serialNumbers?.includes(serial), 'the phone is told which card it holds', JSON.stringify(first))
  q = await fetch(`${svc}/devices/${dev}/registrations/${TYPE}?passesUpdatedSince=${first.lastUpdated}`)
  check(q.status === 204, 'nothing changed since: 204', String(q.status))

  // A stale snapshot, so the fetch below really writes points_at_issue — that write is what would
  // bump updated_at and send every phone round again if it were not pinned.
  sql(`update wallet_passes set points_at_issue = 0, updated_at = updated_at where serial = '${serial}'`)
  await new Promise((res) => setTimeout(res, 1100))
  const p = await fetch(`${svc}/passes/${TYPE}/${serial}`, { headers: auth })
  const lm = p.headers.get('last-modified')
  check(p.status === 200 && /pkpass/.test(p.headers.get('content-type') || ''), 'the card fetch answers the card', String(p.status))
  check((await fetch(`${svc}/passes/${TYPE}/${serial}`)).status === 401, 'and refuses without the token')
  check((await fetch(`${svc}/passes/${TYPE}/${serial}`, { headers: { ...auth, 'If-Modified-Since': lm } })).status === 304, 'If-Modified-Since the last copy: 304')
  q = await fetch(`${svc}/devices/${dev}/registrations/${TYPE}?passesUpdatedSince=${first.lastUpdated}`)
  check(q.status === 204, 'fetching the card does not mark it changed again (no re-download loop)', String(q.status))

  // An order being paid: the card is marked changed and the phone is told so.
  await new Promise((res) => setTimeout(res, 1100))   // timestamps are whole seconds
  execFileSync('php', ['-r', `require 'sporta-site/public_html/api/store.php'; store_wallet_touch(store_db(), ${orderId});`])
  q = await fetch(`${svc}/devices/${dev}/registrations/${TYPE}?passesUpdatedSince=${first.lastUpdated}`)
  check(q.status === 200 && (await q.json()).serialNumbers?.includes(serial), 'after an order is paid, the phone is told the card changed', String(q.status))

  check((await fetch(reg, { method: 'DELETE', headers: auth })).status === 200, 'removing the card unregisters the phone')
  check((await fetch(`${svc}/devices/${dev}/registrations/${TYPE}`)).status === 204, 'and the phone then holds nothing')
  check((await fetch(`${svc}/devices/${dev}/registrations/pass.someone.else`)).status === 404, 'another pass type is 404')
} finally {
  sql(`delete r from wallet_registrations r join wallet_passes p on p.serial = r.serial where p.phone = '${phone}'`)
  sql(`delete from wallet_passes where phone = '${phone}'`)
  if (plantedOrder) sql(`delete from orders where track_id = '${OWN_TRACK}'`)
  cleanCerts()
  rmSync(work, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} failed` : '\nall ok — a two-language card that keeps its points current')
process.exit(fails ? 1 : 0)
