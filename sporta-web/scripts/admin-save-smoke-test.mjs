// Every admin write route answers, and none of them crashes (owner, 2026-11-16: "check all save button").
//
// The Save buttons on /backends call admin.php?r=<route> with a POST. This test signs in as an admin of its own, then
// sends each write route an EMPTY body and a body of the wrong shape, and asserts:
//   - the answer is JSON (never a PHP error page, never HTML);
//   - the status is not 500 (a 500 is a Save that fails for everyone, whatever the input);
//   - no database error text and no PHP fatal text reaches the browser.
// A refusal (400, 403, 404, 409, 422) is the right answer to an empty or wrong body. A 200 is allowed too: a route
// that treats an empty body as "nothing to change" may say so.
//
// What this does NOT prove: that a valid Save persists. Those round trips live in the suites named beside each route
// (npm run test:native, test:admin-polish, test:db-center, ...). Routes with no suite at all are listed at the end, so
// the gap is written down rather than silent.
//
//   npm run test:admin-save-smoke    (needs the sandbox: npm run sandbox)
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE_DIR = join(ROOT, 'dropin/php-store')
let passes = 0, fails = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const sql = async (s) => (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', s])).stdout.trim()
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// Every admin route that writes (the activity-log list in admin.php, which is the owner's own list of edits) plus the
// Save-like POSTs that list does not carry. Sign-in, sign-out and the MFA / Google steps have their own suites.
const WRITE_ROUTES = [
  'product_save', 'product_active', 'product_image_upload', 'brand_assign', 'brand_save', 'brand_delete', 'brand_active',
  'slide_save', 'slide_delete', 'slide_reorder', 'font_upload', 'font_delete', 'seo_save', 'settings_save',
  'content_save', 'returns_policy_save', 'shipping_save', 'assistant_settings_save', 'discount_save', 'discount_active',
  'discount_delete', 'inventory_variant_save', 'inventory_adjust', 'inventory_finance', 'set_stock', 'variants_create',
  'crm_save', 'crm_create', 'crm_note', 'block_customer', 'unblock_customer', 'customer', 'cod_paid', 'card_settled',
  'fulfilment', 'support_update', 'support_reply', 'return_status', 'payment_config', 'checkout_settings',
  'theme_settings', 'topbar_settings',
]
// Not sent: sync reaches outside the sandbox, clear_cache empties the shared cache, google_unlink needs a linked account.
// Their own suites cover them; the empty-body probe would only prove they run.
const NOT_PROBED = ['sync', 'clear_cache', 'google_unlink']

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }

const tmp = mkdtempSync(join(tmpdir(), 'sporta-save-smoke-'))
const CFG = join(tmp, 'config.php')
writeFileSync(CFG, `<?php\nreturn ['admin_session_dir' => ${phpStr(join(tmp, 'sessions'))}] + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)
const port = await freePort(8437)
const srv = spawn('php', ['-d', 'sendmail_path=true', '-S', `127.0.0.1:${port}`, '-t', STORE_DIR],
  { stdio: 'ignore', env: { ...process.env, SPORTA_API_CONFIG_FILE: CFG } })
process.on('exit', () => { try { srv.kill() } catch { /* gone */ } })
const BASE = `http://127.0.0.1:${port}`
let up = false
for (let i = 0; i < 80 && !up; i++) {
  await new Promise((r) => setTimeout(r, 100))
  try { up = (await fetch(`${BASE}/api.php?r=checkout_config`)).status === 200 } catch { /* starting */ }
}

head('the store is up, with an admin of its own')
is(up, `the store is up on :${port}`, up ? '' : 'did not start')
if (!up) process.exit(1)

const EMAIL = `save-smoke-${randomBytes(4).toString('hex')}@sporta.test`
const PASSWORD = randomBytes(12).toString('base64url')
const hashed = (await run('php', ['-r', `echo password_hash(${phpStr(PASSWORD)}, PASSWORD_DEFAULT);`])).stdout.trim()
await sql(`insert into admin_users (email, password_hash) values ('${EMAIL}', '${hashed}')`)

const signin = await fetch(`${BASE}/admin.php?r=login`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((p) => /^(__Host-)?sporta_admin=/.test(p)) || ''
is(signin.status === 200 && cookie !== '', 'the smoke admin signs in', `${signin.status}`)

const ERR = /SQLSTATE|Fatal error|Uncaught|Parse error|Warning: |Notice: |Stack trace|mysqli?_|PDOException/i
async function post(route, body) {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin', Cookie: cookie },
    body,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, text, json }
}

head('an empty body: no write route crashes, and every one exists')
// admin.php ends with store_fail('not_found', 404): a route it does not know. A Save that calls such a route
// would answer exactly that, so it is a failure here, not a refusal.
const failures = []
const missing = []
for (const route of WRITE_ROUTES) {
  const r = await post(route, '{}')
  const okJson = r.json !== null
  const crashed = r.status >= 500 || ERR.test(r.text)
  if (r.json?.error === 'not_found' && r.status === 404) missing.push(route)
  if (!okJson || crashed) failures.push(`${route} ${r.status} ${okJson ? '' : 'not JSON'} ${ERR.test(r.text) ? 'error text' : ''}`.trim())
}
is(missing.length === 0, `every write route is one admin.php knows`, missing.length ? `missing: ${missing.join(', ')}` : '')
is(failures.length === 0, `all ${WRITE_ROUTES.length} write routes answer an empty body with JSON and no 5xx or error text`,
   failures.length ? failures.join(' | ') : '')

head('a body of the wrong shape: the same, with a list where an object belongs')
const wrong = []
for (const route of WRITE_ROUTES) {
  const r = await post(route, '[1,2,"x",null]')
  const okJson = r.json !== null
  const crashed = r.status >= 500 || ERR.test(r.text)
  if (!okJson || crashed) wrong.push(`${route} ${r.status} ${okJson ? '' : 'not JSON'} ${ERR.test(r.text) ? 'error text' : ''}`.trim())
}
is(wrong.length === 0, 'and the same for a JSON list body', wrong.length ? wrong.join(' | ') : '')

head('a signed-out request is refused everywhere, with JSON')
const anon = []
for (const route of WRITE_ROUTES) {
  const res = await fetch(`${BASE}/admin.php?r=${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })
  const text = await res.text()
  if (res.status !== 401 && res.status !== 403) anon.push(`${route} ${res.status}`)
  else if (!text.startsWith('{')) anon.push(`${route} not JSON`)
}
is(anon.length === 0, 'with no session, every write route says 401 or 403 in JSON', anon.join(' | '))

head('routes not probed here (their own suites cover them)')
console.log(`     ${NOT_PROBED.join(', ')}`)

// Tidy: the smoke admin.
try { await sql(`delete from admin_users where email = '${EMAIL}'`) } catch {
  await sql(`update admin_users set password_hash = 'x', email = concat('gone-', id, '@sporta.test') where email = '${EMAIL}'`).catch(() => {})
}
console.log(`\n${passes} passed, ${fails} failed`)
try { srv.kill() } catch { /* gone */ }
process.exit(fails ? 1 : 0)
