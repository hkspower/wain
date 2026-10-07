/**
 * Passcode unlock on /backends — the server half and the login keypad.
 *
 *   bash scripts/sandbox.sh && node scripts/passcode-test.mjs
 *
 * Asserts: a browser with no device cookie is refused; enrolling sets an
 * HttpOnly SameSite=Strict cookie and stores only hashes; a trusted browser
 * unlocks after the session ends; a DIFFERENT browser with the right passcode
 * is refused; five wrong tries lock the device (even the right passcode then);
 * weak passcodes are refused; the CSRF header is required; removing a device
 * kills the unlock; a changed password removes every device; and the login
 * screen shows the keypad only for a trusted browser.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

class Jar {
  c = {}
  async call(route, body, hdr = true) {
    const r = await fetch(`${BASE}/api/admin.php?r=${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(hdr ? { 'X-Sporta-Admin': '1' } : {}),
        cookie: Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    })
    const raw = r.headers.getSetCookie?.() ?? []
    this.raw = raw
    for (const s of raw) { const [kv] = s.split(';'); const i = kv.indexOf('='); this.c[kv.slice(0, i)] = kv.slice(i + 1) }
    let j = null; try { j = await r.json() } catch {}
    return { status: r.status, j }
  }
  dropSession() { for (const k of Object.keys(this.c)) if (!/sporta_dev$/.test(k)) delete this.c[k] }
}
const clean = () => { sql('delete from admin_devices'); sql("delete from rate_limit; delete from rate_bucket") }
clean()

const a = new Jar()
check((await a.call('passcode_unlock', { passcode: '481516' })).status === 401, 'no cookie: unlock refused')
check((await a.call('passcode_status')).j.trusted === false, 'no cookie: not trusted')
check((await a.call('passcode_unlock', { passcode: '481516' }, false)).status === 400, 'unlock without the CSRF header is refused')
const s = await a.call('login', { email: EMAIL, password: PASSWORD })
check(s.status === 200 && !s.j.need_code, 'password sign-in works')
check((await a.call('passcode_enroll', { passcode: '111111' })).status === 400, 'repeated digits refused')
check((await a.call('passcode_enroll', { passcode: '123456' })).status === 400, '123456 refused')
check((await a.call('passcode_enroll', { passcode: '48151' })).status === 400, 'five digits refused')
check((await a.call('passcode_enroll', { passcode: '4815ab' })).status === 400, 'letters refused')
const e = await a.call('passcode_enroll', { passcode: '481516', label: 'Test · Chrome' })
const cookie = a.raw.find((x) => /sporta_dev=/.test(x)) ?? ''
check(e.status === 200 && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie), 'enrolling sets an HttpOnly SameSite=Strict cookie', cookie.split(';').slice(1).join(';'))
const row = sql('select length(token_hash), left(pass_hash,4), label from admin_devices').split('\t')
check(row[0] === '64' && row[1] === '$2y$', 'only a token hash and a bcrypt hash are stored', row.join(' '))
check(!sql('select token_hash from admin_devices').includes(a.c.sporta_dev ?? a.c['__Host-sporta_dev'] ?? 'x'), 'the raw token is not stored')
check(((await a.call('passcode_devices')).j.devices[0]?.current) === true, 'device list marks this browser')

// session ends → passcode unlocks THIS browser
a.dropSession()
check((await a.call('me')).j === null, 'signed out')
check((await a.call('passcode_status')).j.trusted === true, 'status: trusted')
const bad = await a.call('passcode_unlock', { passcode: '000001' })
check(bad.status === 401, 'wrong passcode refused')
const ok = await a.call('passcode_unlock', { passcode: '481516' })
check(ok.status === 200 && (await a.call('me')).j?.email === EMAIL, 'right passcode signs in')
check((await a.call('stats')).status !== 401, 'and reaches a gated route')

// another browser: right passcode, no cookie
const other = new Jar()
check((await other.call('passcode_unlock', { passcode: '481516' })).status === 401, 'other browser with the right passcode: refused')
// stolen-cookie shape: a forged token
other.c.sporta_dev = 'a'.repeat(64)
check((await other.call('passcode_unlock', { passcode: '481516' })).status === 401, 'forged token: refused')

// lockout
a.dropSession()
let last
for (let i = 0; i < 5; i++) last = await a.call('passcode_unlock', { passcode: '000002' })
check(last.status === 423, 'fifth wrong try locks the device')
check((await a.call('passcode_unlock', { passcode: '481516' })).status === 423, 'the right passcode no longer works once locked')
check((await a.call('passcode_status')).j.locked === true, 'status says locked')

// password sign-in + re-enrol clears it; removal kills it
const b = new Jar(); b.c = { ...a.c }
await b.call('login', { email: EMAIL, password: PASSWORD })
await b.call('passcode_enroll', { passcode: '927314' })
b.dropSession()
check((await b.call('passcode_unlock', { passcode: '927314' })).status === 200, 're-enrolling clears the lock')
const id = (await b.call('passcode_devices')).j.devices[0].id
await b.call('passcode_remove', { id })
b.dropSession()
check((await b.call('passcode_unlock', { passcode: '927314' })).status === 401, 'removed device no longer unlocks')

// expiry
const c = new Jar(); await c.call('login', { email: EMAIL, password: PASSWORD }); await c.call('passcode_enroll', { passcode: '927314' })
sql("update admin_devices set expires_at = now() - interval 1 minute")
c.dropSession()
check((await c.call('passcode_unlock', { passcode: '927314' })).status === 401, 'expired device refused')

// password change removes every device (checked at the source: the sandbox account must keep its password)
const src = execFileSync('grep', ['-c', 'delete from admin_devices where admin_id', 'sporta-site/public_html/api/admin.php'], { encoding: 'utf8' }).trim()
check(Number(src) >= 2, 'a password change deletes the admin\'s devices (source guard)')

// the shopper never gets the device cookie
const shop = await fetch(`${BASE}/api/api.php?r=slides`)
check(!(shop.headers.get('set-cookie') ?? '').includes('sporta_dev'), 'storefront sets no device cookie')

// browser: keypad only for a trusted browser
clean()
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext()
const pg = await ctx.newPage()
await pg.goto(`${BASE}/backends`); await pg.waitForSelector('input[type=password]', { timeout: 15000 })
await pg.waitForTimeout(600)
check(await pg.locator('[data-sporta-pass-pad]').count() === 0, 'untrusted browser: no keypad, password form as before')
// enrol through the API inside this browser, then sign out
const enrol = await pg.evaluate(async ([em, pw]) => {
  const h = { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }
  await fetch('/api/admin.php?r=login', { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify({ email: em, password: pw }) })
  const r = await fetch('/api/admin.php?r=passcode_enroll', { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify({ passcode: '739105', label: 'pw' }) })
  await fetch('/api/admin.php?r=logout', { method: 'POST', headers: h, credentials: 'include' })
  return r.status
}, [EMAIL, PASSWORD])
check(enrol === 200, 'enrolled from the browser')
await pg.goto(`${BASE}/backends`); await pg.waitForSelector('[data-sporta-pass-pad]', { timeout: 15000 })
const formHidden = await pg.evaluate(() => { const pw = [...document.querySelectorAll('input[type=password]')].find((i) => !i.closest('[data-sporta-pass-pad]')); const f = pw && (pw.closest('form') || pw.parentElement); return !!f && getComputedStyle(f).display === 'none' })
check(formHidden, 'trusted browser: password form tucked away behind the keypad')
await pg.locator('[data-sporta-pass-pad] button').click()
check(await pg.evaluate(() => { const pw = [...document.querySelectorAll('input[type=password]')].find((i) => !i.closest('[data-sporta-pass-pad]')); return getComputedStyle(pw).display !== 'none' }), '"Use password instead" brings the form back')
await pg.reload(); await pg.waitForSelector('[data-sporta-pass-pad] input')
await pg.fill('[data-sporta-pass-pad] input', '000003'); await pg.waitForTimeout(800)
check((await pg.locator('[data-sporta-pass-pad]').innerText()).length > 0 && await pg.locator('[data-sporta-pass-pad] input').inputValue() === '', 'wrong passcode clears the field')
await pg.type('[data-sporta-pass-pad] input', '739105'); await pg.waitForLoadState('networkidle'); await pg.waitForTimeout(1500)
check(await pg.locator('[data-sporta-pass-pad]').count() === 0 && await pg.evaluate(async () => (await (await fetch('/api/admin.php?r=me', { headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' })).json())?.email), 'right passcode in the browser signs in')
await br.close()
clean()
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
