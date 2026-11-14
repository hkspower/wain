// The device passcode on the LIVE admin (block "ADMIN PASSCODE", public/sporta-admin-brands.js) in a real browser.
//
//   npm run test:admin-passcode-addon   (rig-free: no database, no server, no sandbox. The pages are the CAPTURED live sign-in
//                                       (scripts/fixtures/admin-login/markup.mjs, live.css) and the CAPTURED live Settings screen
//                                       (scripts/fixtures/sizes-admin/settings.html) with the 14 add-on sheets; the admin API is a
//                                       fake answered by route interception, shaped like admin.php passcode_status / passcode_login /
//                                       passcode_info / passcode_set / passcode_clear (the answers store.php gives, see
//                                       dropin/php-store/store.php store_passcode_*); the REAL add-on file runs on it)
//
// What is asserted:
//   SIGN-IN
//   - the passcode step replaces the password form only when the server says "enabled" for the remembered address, and asks
//     with that address and the session header; nothing is asked when no address is remembered, and nothing is shown when the
//     server says no;
//   - the six-digit field: digits only, at most six, the submit waits for six digits, the password form comes back with
//     "Use my password instead" and is not asked again on this screen;
//   - a wrong passcode (401) keeps the step and says so; a passcode lock (423) and a refusal (403) hand back to the password
//     form with the same words the repo's admin uses; an account lock (423 locked) keeps the step and says so;
//   - a right passcode (200) reloads the page (the compiled app then reads the session), and the POST carries the address,
//     the passcode and the session header;
//   - the address is remembered when the password form is submitted, lower-cased, and never the password;
//   - Settings: the section sits under the Settings heading once; set, change and remove go to the right routes with the
//     right bodies (remove sends the password only); every refusal (wrong password, bad passcode, 401, 429, no network) is
//     worded; the passcode_info failure leaves the form usable; Arabic reads right to left;
//   - the block: markers once, no markup injection, no eval, no third-party host, one storage key (the address), the only
//     routes are the five passcode routes, the repo's own admin markers switch it off;
//   - REVIEW (independent review of 61e060c5): "Use my password instead" holds when the compiled app rebuilds its form; the
//     passcode leaves the field after a server error or an account lock; a 429 is worded; a 200 without the expected JSON is
//     never "saved" or "none set"; a request that is never answered is given up after 15 seconds (this block waits 16.5 s);
//   - MUTATION CHECK: with the block cut out of the file the sign-in shows no passcode step at all.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'
import { LOGIN } from './fixtures/admin-login/markup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const LOGIN_CSS = readFileSync(join(ROOT, 'scripts/fixtures/admin-login/live.css'), 'utf8')
const BEGIN_MARK = '/* ===== ADMIN PASSCODE - begin'
const END_MARK = '/* ===== ADMIN PASSCODE - end'
const BEGIN = BRANDS_JS.indexOf(BEGIN_MARK)
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN PASSCODE block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const BLOCK = BRANDS_JS.slice(BEGIN, BRANDS_JS.indexOf('\n', END))
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))
const ORIGIN = 'https://www.sporta.com.kw'
const EMAIL = 'qa-admin@sporta.test'
const PASSWORD = 'test-password-not-real'
const FILES = addons(knetServed())

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------------------------------------ pages
const signInPage = (lang) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LOGIN_CSS}</style></head><body>${LOGIN}</body></html>`
const settingsPage = (lang) => fixturePage('settings', FILES, { rtl: lang === 'ar', dark: false })

// ------------------------------------------------------------------------------------------------ the fake server
function world(o = {}) {
  return {
    calls: [], docs: 0, abort: false,
    status: o.status ?? { status: 200, body: { enabled: true } },
    login: o.login ?? { status: 401, body: { error: 'wrong_passcode' } },
    info: o.info ?? { status: 200, body: { set: false } },
    set: o.set ?? { status: 200, body: { set: true } },
    clear: o.clear ?? { status: 200, body: { set: false } },
  }
}
const ANSWER = { passcode_status: 'status', passcode_login: 'login', passcode_info: 'info', passcode_set: 'set', passcode_clear: 'clear' }
function handler(W, pageFor) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (p === '/backends' || p.startsWith('/backends/')) {
      if (req.resourceType() === 'document') W.docs++
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageFor(p) })
    }
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || ''
      W.calls.push({ method: req.method(), route: r, email: u.searchParams.get('email'), headers: req.headers(), body: req.postData() })
      if (W.hang) return                       // never answered: the request stays open (a dead connection)
      if (W.abort) return route.abort('failed')
      const key = ANSWER[r]
      if (!key) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const a = W[key]
      return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) })
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const pageErrors = []
const contexts = []

// email: the address put in localStorage before the page loads (null = nothing remembered).
async function open(W, { path = '/backends', lang = 'en', email = EMAIL, js = BRANDS_JS, before = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true })
  contexts.push(ctx)
  if (email !== null) await ctx.addInitScript((e) => { try { localStorage.setItem('sporta.admin.passcodeEmail', e) } catch (_) { /* blocked */ } }, email)
  await ctx.route(ORIGIN + '/**', handler(W, (p) => (p === '/backends/settings' ? settingsPage(lang) : signInPage(lang))))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
  await pg.goto(ORIGIN + path)
  if (before) await pg.evaluate(before)
  await pg.addScriptTag({ content: js })
  return pg
}
const formState = (pg) => pg.evaluate(() => { const f = document.getElementById('admin-password')?.form; return f ? f.getAttribute('data-sporta-passcode') : null })
const settle = (pg) => pg.waitForFunction(() => {
  const f = document.getElementById('admin-password')?.form
  const s = f && f.getAttribute('data-sporta-passcode')
  return s === 'panel' || s === 'password'
}, null, { timeout: 4000 }).catch(() => {})
const formShown = (pg) => pg.evaluate(() => { const f = document.getElementById('admin-password')?.form; return !!f && f.style.display !== 'none' })
const panelCount = (pg) => pg.evaluate(() => document.querySelectorAll('[data-sporta-passcode-panel]').length)
const alertText = (pg) => pg.evaluate(() => { const a = document.querySelector('form[data-sporta-passcode-panel] [role="alert"]'); return a && !a.hidden ? a.textContent : '' })
const noticeText = (pg) => pg.evaluate(() => { const n = document.querySelector('[data-sporta-passcode-notice]'); return n ? n.textContent : '' })
const settleSettings = (pg) => pg.waitForFunction(() => {
  const s = document.querySelector('[data-sporta-passcode-section] [role="status"]')
  return !!s && s.textContent.trim() !== '' && !/Checking|جارٍ/.test(s.textContent)
}, null, { timeout: 4000 }).catch(() => {})
const mine = (W, route) => W.calls.filter((c) => c.route === route)
const waitDocs = async (W, n) => { for (let i = 0; i < 80 && W.docs < n; i++) await sleep(50) }

// ================================================================================================ SIGN-IN
head('sign-in: the passcode step')
{
  const W = world({ status: { status: 200, body: { enabled: true } } })
  const pg = await open(W)
  await settle(pg)
  is(await formState(pg) === 'panel', 'an address remembered on this browser, with a passcode set: the passcode step is shown')
  const st = mine(W, 'passcode_status')
  is(st.length === 1, 'the server is asked once, for the remembered address', `asked ${st.length} times`)
  is(st[0] && st[0].method === 'GET' && st[0].email === EMAIL, 'the question is a GET with that address')
  is(st[0] && st[0].headers['x-sporta-admin'] === '1', 'the question carries the X-Sporta-Admin header')
  is(!(await formShown(pg)) && (await panelCount(pg)) === 1, 'the password form is hidden and exactly one passcode step stands in for it')
  const input = await pg.evaluate(() => {
    const i = document.getElementById('sporta-passcode-input')
    return i ? { type: i.type, max: i.maxLength, mode: i.getAttribute('inputmode'), ac: i.getAttribute('autocomplete'), dir: i.dir } : null
  })
  is(input && input.type === 'password' && input.max === 6 && input.mode === 'numeric' && input.ac === 'one-time-code' && input.dir === 'ltr',
    'the field is a masked six-digit numeric field, left to right, with the one-time-code hint', JSON.stringify(input))
  is(await pg.locator('form[data-sporta-passcode-panel] button[type="submit"]').isDisabled(), 'the submit waits for six digits')
  await pg.fill('#sporta-passcode-input', '12a3')
  is(await pg.inputValue('#sporta-passcode-input') === '123', 'letters are dropped as they are typed (12a3 -> 123)')
  is(await pg.locator('form[data-sporta-passcode-panel] button[type="submit"]').isDisabled(), 'still disabled at three digits')
  await pg.fill('#sporta-passcode-input', '1234567')
  is(await pg.inputValue('#sporta-passcode-input') === '123456', 'no more than six digits are kept')
  is(!(await pg.locator('form[data-sporta-passcode-panel] button[type="submit"]').isDisabled()), 'enabled at six digits')
  await pg.click('form[data-sporta-passcode-panel] button[type="button"]')
  is(await formShown(pg) && (await panelCount(pg)) === 0, '"Use my password instead" brings the password form back and removes the step')
  is(await formState(pg) === 'password', 'and the step is not asked again on this screen')
  is(mine(W, 'passcode_status').length === 1, 'and the server is not asked again either', `asked ${mine(W, 'passcode_status').length} times`)
  await pg.close()
}

head('sign-in: no step where the server says no, or nothing is remembered')
{
  const W = world({ status: { status: 200, body: { enabled: false } } })
  const pg = await open(W)
  await settle(pg)
  is(await formState(pg) === 'password' && await formShown(pg) && (await panelCount(pg)) === 0, 'enabled:false -> the password form stays, no step')
  await pg.close()
}
{
  const W = world()
  const pg = await open(W, { email: null })
  await sleep(300)
  is(mine(W, 'passcode_status').length === 0 && await formState(pg) === 'password', 'no remembered address -> the server is not asked at all')
  await pg.close()
}
{
  const W = world({ status: { status: 500, body: { error: 'db_unreachable' } } })
  const pg = await open(W)
  await settle(pg)
  is(await formShown(pg) && (await panelCount(pg)) === 0, 'a failed question (500) -> the password form, never a broken step')
  await pg.close()
}
{
  const W = world({ status: { status: 200, body: { enabled: true } } })
  const pg = await open(W, { email: 'not an address' })
  await sleep(300)
  is(mine(W, 'passcode_status').length === 0, 'a remembered value that is not an address is never sent')
  await pg.close()
}

head('sign-in: the server answers to a wrong, locked or refused passcode')
{
  const W = world({ login: { status: 401, body: { error: 'wrong_passcode' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(250)
  const post = mine(W, 'passcode_login')
  is(post.length === 1 && post[0].method === 'POST', 'submitting asks passcode_login once, as a POST')
  is(post[0] && JSON.parse(post[0].body || '{}').passcode === '123456' && JSON.parse(post[0].body || '{}').email === EMAIL,
    'the body is the address and the passcode, as JSON', post[0] && post[0].body)
  is(post[0] && post[0].headers['x-sporta-admin'] === '1' && /application\/json/.test(post[0].headers['content-type'] || ''),
    'the POST carries X-Sporta-Admin and a JSON content type')
  is(await alertText(pg) === 'That passcode is not right.', 'a wrong passcode says so, in words', await alertText(pg))
  is(await pg.inputValue('#sporta-passcode-input') === '' && (await panelCount(pg)) === 1, 'the field is cleared and the step stays for another try')
  is(!(await formShown(pg)), 'and the password form stays hidden')
  await pg.close()
}
{
  const W = world({ login: { status: 423, body: { error: 'passcode_locked' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await formShown(pg) && (await panelCount(pg)) === 0, 'a passcode lock (423 passcode_locked) hands back to the password form')
  is(await noticeText(pg) === 'Too many wrong passcodes. Sign in with your password.', 'with the repo admin\'s words for it', await noticeText(pg))
  await pg.close()
}
{
  const W = world({ login: { status: 403, body: { error: 'passcode_unavailable' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await formShown(pg) && (await panelCount(pg)) === 0, 'a refusal (403) hands back to the password form')
  is(await noticeText(pg) === 'Sign in with your password on this browser.', 'with the words for it', await noticeText(pg))
  await pg.close()
}
{
  const W = world({ login: { status: 423, body: { error: 'locked' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await panelCount(pg) === 1 && (await alertText(pg)).indexOf('locked for 15 minutes') >= 0, 'an account lock (423 locked) keeps the step and says why', await alertText(pg))
  await pg.close()
}
{
  const W = world({ login: { status: 500, body: { error: 'db_unreachable' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await alertText(pg) === 'The server failed to answer. Try again, or sign in with your password.', 'a server error is not called a wrong passcode', await alertText(pg))
  await pg.close()
}

head('sign-in: a right passcode reloads the page')
{
  const W = world({ login: { status: 200, body: { email: EMAIL } } })
  const pg = await open(W)
  await settle(pg)
  const before = W.docs
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await waitDocs(W, before + 1)
  is(W.docs === before + 1, 'the page is loaded again (the compiled app then asks "me" and finds the session)', `documents ${before} -> ${W.docs}`)
  await pg.close()
}

head('sign-in: the address is remembered, the password is not')
{
  const W = world({ status: { status: 200, body: { enabled: false } } })
  const pg = await open(W, { email: null })
  await settle(pg)
  await pg.fill('#admin-email', '  QA-Admin@Sporta.TEST ')
  await pg.fill('#admin-password', PASSWORD)
  await pg.evaluate(() => document.getElementById('admin-password').form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await sleep(100)
  const stored = await pg.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k) } return o })
  is(stored['sporta.admin.passcodeEmail'] === 'qa-admin@sporta.test', 'the address is kept, trimmed and lower-cased', JSON.stringify(stored))
  is(!Object.values(stored).some((v) => String(v).indexOf(PASSWORD) >= 0), 'the password is not kept anywhere in this browser')
  await pg.close()
}

head('sign-in: built once, off where the repo admin has its own screen')
{
  const W = world({ status: { status: 200, body: { enabled: true } } })
  const pg = await open(W)
  await settle(pg)
  await pg.addScriptTag({ content: BRANDS_JS })   // a second copy of the whole file
  await sleep(300)
  is(await panelCount(pg) === 1 && await pg.evaluate(() => !!window.__sportaPasscode), 'a second copy of the file starts nothing new: one step, one guard')
  await pg.close()
}
{
  const W = world()
  const pg = await open(W, { before: () => { document.body.insertAdjacentHTML('beforeend', '<input id="admin-passcode" type="password">') } })
  await sleep(300)
  is(await panelCount(pg) === 0 && await formState(pg) === null, 'the repo admin\'s own passcode screen (#admin-passcode) is left alone')
  await pg.close()
}

// ================================================================================================ SETTINGS
head('settings: the section under the heading')
{
  const W = world({ info: { status: 200, body: { set: false } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  const where = await pg.evaluate(() => {
    const secs = document.querySelectorAll('[data-sporta-passcode-section]')
    const s = secs[0]
    const prev = s && s.previousElementSibling
    return { count: secs.length, afterHeader: !!prev && prev.classList.contains('admin-page-header'), heading: s && s.querySelector('h2') && s.querySelector('h2').textContent }
  })
  is(where.count === 1 && where.afterHeader, 'one section, directly under the Settings heading', JSON.stringify(where))
  is(where.heading === 'Passcode for this browser', 'with its heading', where.heading)
  is(mine(W, 'passcode_info').length === 1 && mine(W, 'passcode_info')[0].method === 'GET', 'the state is read once, with a GET')
  const s = await pg.evaluate(() => ({
    status: document.querySelector('[data-sporta-passcode-section] [role="status"]').textContent,
    save: document.querySelector('#spc-password') && document.querySelector('.spc-btn--primary').textContent,
    saveDisabled: document.querySelector('.spc-btn--primary').disabled,
    dropHidden: document.querySelector('.spc-btn--ghost').hidden,
  }))
  is(s.status === 'No passcode is set.' && s.save === 'Set passcode', 'with no passcode: "No passcode is set." and "Set passcode"', JSON.stringify(s))
  is(s.saveDisabled && s.dropHidden, 'the save waits for the password and six digits, and there is nothing to remove')
  await pg.close()
}

head('settings: set, refuse, change, remove')
{
  const W = world({ info: { status: 200, body: { set: false } }, set: { status: 403, body: { error: 'wrong_password' } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '12a456')
  is(await pg.inputValue('#spc-code') === '12456' && await pg.locator('.spc-btn--primary').isDisabled(), 'the new passcode keeps digits only, and five digits do not save')
  await pg.fill('#spc-code', '123456')
  is(!(await pg.locator('.spc-btn--primary').isDisabled()), 'six digits and a password do')
  await pg.click('.spc-btn--primary')
  await sleep(250)
  const post = mine(W, 'passcode_set')
  is(post.length === 1 && post[0].method === 'POST' && post[0].headers['x-sporta-admin'] === '1', 'set = one POST to passcode_set, with the session header')
  is(post[0] && JSON.stringify(JSON.parse(post[0].body)) === JSON.stringify({ password: PASSWORD, passcode: '123456' }), 'its body is the password and the passcode', post[0] && post[0].body)
  is(await pg.textContent('.spc-msg') === 'That password is not right.', 'a wrong password is worded', await pg.textContent('.spc-msg'))
  await pg.close()
}
{
  const W = world({ info: { status: 200, body: { set: false } }, set: { status: 200, body: { set: true } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '123456')
  await pg.click('.spc-btn--primary')
  await sleep(250)
  const s = await pg.evaluate(() => ({
    msg: document.querySelector('.spc-msg').textContent,
    status: document.querySelector('[data-sporta-passcode-section] [role="status"]').textContent,
    save: document.querySelector('.spc-btn--primary').textContent,
    dropHidden: document.querySelector('.spc-btn--ghost').hidden,
    pw: document.getElementById('spc-password').value,
  }))
  is(s.msg === 'Passcode saved.' && s.status === 'A passcode is set.', 'saved: the words say so, and the status changes', JSON.stringify(s))
  is(s.save === 'Change passcode' && !s.dropHidden && s.pw === '', 'then the button says Change, Remove shows, the password box is emptied')
  await pg.fill('#spc-password', PASSWORD)
  await pg.click('.spc-btn--ghost')
  await sleep(250)
  const del = mine(W, 'passcode_clear')
  is(del.length === 1 && del[0].method === 'POST', 'remove = one POST to passcode_clear')
  is(del[0] && Object.keys(JSON.parse(del[0].body)).join(',') === 'password', 'and its body carries the password only, never a passcode', del[0] && del[0].body)
  is(await pg.textContent('.spc-msg') === 'Passcode removed.' && await pg.textContent('[data-sporta-passcode-section] [role="status"]') === 'No passcode is set.', 'removed: worded, and the status goes back to none')
  await pg.close()
}

head('settings: every refusal is worded')
{
  const W = world({ info: { status: 200, body: { set: true } }, set: { status: 401, body: { error: 'not_signed_in' } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '123456')
  await pg.click('.spc-btn--primary')
  await sleep(200)
  is(await pg.textContent('.spc-msg') === 'Your admin session has ended. Reload this page and sign in again.', '401 is a session that ended, not a wrong password', await pg.textContent('.spc-msg'))
  W.set = { status: 429, body: { error: 'rate_limited' } }
  await pg.click('.spc-btn--primary')
  await sleep(200)
  is(await pg.textContent('.spc-msg') === 'Too many attempts. Wait a few minutes, then try again.', '429 says so', await pg.textContent('.spc-msg'))
  W.set = { status: 400, body: { error: 'invalid_passcode' } }
  await pg.click('.spc-btn--primary')
  await sleep(200)
  is(await pg.textContent('.spc-msg') === 'The passcode must be exactly six digits.', 'a refused shape says so', await pg.textContent('.spc-msg'))
  W.set = { status: 500, body: { error: 'db_unreachable' } }
  await pg.click('.spc-btn--primary')
  await sleep(200)
  is(await pg.textContent('.spc-msg') === 'Could not save. Check the password and try again.', 'anything else is the generic line', await pg.textContent('.spc-msg'))
  W.abort = true
  await pg.click('.spc-btn--primary')
  await sleep(250)
  is(await pg.textContent('.spc-msg') === 'Cannot reach the server. Check that the site is up, then retry.', 'no answer at all is said as no answer', await pg.textContent('.spc-msg'))
  W.abort = false
  await pg.close()
}
{
  const W = world({ info: { status: 500, body: { error: 'x' } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  is(await pg.textContent('[data-sporta-passcode-section] [role="status"]') === 'Could not read the passcode setting.', 'a failed read says so')
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '123456')
  is(!(await pg.locator('.spc-btn--primary').isDisabled()), 'and the form stays usable')
  await pg.close()
}

head('settings: Arabic reads right to left, and the repo admin\'s own section switches it off')
{
  const W = world({ info: { status: 200, body: { set: false } } })
  const pg = await open(W, { path: '/backends/settings', lang: 'ar', email: null })
  await settleSettings(pg)
  const a = await pg.evaluate(() => ({ h: document.querySelector('[data-sporta-passcode-section] h2').textContent, dir: getComputedStyle(document.documentElement).direction }))
  is(a.h === 'رمز المرور لهذا المتصفح' && a.dir === 'rtl', 'Arabic heading, right to left', JSON.stringify(a))
  await pg.close()
}
{
  const W = world({ info: { status: 200, body: { set: false } } })
  const pg = await open(W, { path: '/backends/settings', email: null, before: () => { document.querySelector('main.admin-content').insertAdjacentHTML('beforeend', '<h2 id="passcode-heading">x</h2>') } })
  await sleep(300)
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-passcode-section]').length) === 0, 'the repo admin\'s own Settings section (#passcode-heading) is left alone')
  await pg.close()
}

// ================================================================================================ review fixes
// Found by the independent review of 61e060c5 (see the commit message). Each block fails on the commit as it was.
head('review: "Use my password instead" is not undone when the screen is rebuilt')
{
  const W = world({ status: { status: 200, body: { enabled: true } } })
  const pg = await open(W)
  await settle(pg)
  await pg.click('form[data-sporta-passcode-panel] button[type="button"]')
  // The compiled app replaces its sign-in form with a fresh element (same markup, none of the block's marks).
  await pg.evaluate(() => { const f = document.getElementById('admin-password').form; const n = f.cloneNode(true); n.removeAttribute('data-sporta-passcode'); n.style.display = ''; f.replaceWith(n) })
  await sleep(300)
  is(await panelCount(pg) === 0 && await formShown(pg), 'a rebuilt form after "Use my password instead" shows the password form, not the step again', `panels ${await panelCount(pg)}, server asked ${mine(W, 'passcode_status').length} times`)
  await pg.close()
}
head('review: the passcode leaves the field after any answer; a rate limit is worded')
{
  const W = world({ login: { status: 500, body: { error: 'db_unreachable' } } })
  const pg = await open(W)
  await settle(pg)
  await pg.fill('#sporta-passcode-input', '123456')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await pg.inputValue('#sporta-passcode-input') === '' && (await panelCount(pg)) === 1, 'a server error clears the passcode from the field and keeps the step', JSON.stringify(await pg.inputValue('#sporta-passcode-input')))
  W.login = { status: 423, body: { error: 'locked' } }
  await pg.fill('#sporta-passcode-input', '654321')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await pg.inputValue('#sporta-passcode-input') === '', 'an account lock clears it too', JSON.stringify(await pg.inputValue('#sporta-passcode-input')))
  W.login = { status: 429, body: { error: 'too_many_attempts', retry_after: 60 } }
  await pg.fill('#sporta-passcode-input', '111222')
  await pg.click('form[data-sporta-passcode-panel] button[type="submit"]')
  await sleep(300)
  is(await alertText(pg) === 'Too many attempts. Wait a few minutes, then try again.', 'a rate limit (429) is worded as one, not as a server failure', await alertText(pg))
  await pg.close()
}

head('review: an answer without the expected JSON is never read as success')
{
  const W = world({ info: { status: 200, body: null }, set: { status: 200, body: null } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  is(await pg.textContent('[data-sporta-passcode-section] [role="status"]') === 'Could not read the passcode setting.', 'a 200 without the status answer is a failed read, not "No passcode is set."', await pg.textContent('[data-sporta-passcode-section] [role="status"]'))
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '123456')
  await pg.click('.spc-btn--primary')
  await sleep(250)
  const s = await pg.evaluate(() => ({ msg: document.querySelector('.spc-msg').textContent, pw: document.getElementById('spc-password').value, code: document.getElementById('spc-code').value }))
  is(s.msg === 'Could not save. Check the password and try again.' && s.pw === PASSWORD && s.code === '123456', 'a 200 without the answer is not "Passcode saved." and keeps the typed values', JSON.stringify(s))
  await pg.close()
}

head('review: a request that is never answered is given up')
{
  const W = world({ info: { status: 200, body: { set: false } } })
  const pg = await open(W, { path: '/backends/settings', email: null })
  await settleSettings(pg)
  W.hang = true
  await pg.fill('#spc-password', PASSWORD)
  await pg.fill('#spc-code', '123456')
  await pg.click('.spc-btn--primary')
  await sleep(16500)
  const s = await pg.evaluate(() => ({ msg: document.querySelector('.spc-msg').textContent, save: !document.querySelector('.spc-btn--primary').disabled, busy: document.querySelector('[data-sporta-passcode-section] form').getAttribute('aria-busy') }))
  is(s.msg === 'Cannot reach the server. Check that the site is up, then retry.' && s.save, 'a save with no answer is given up after 15 seconds and the button comes back', JSON.stringify(s))
  W.hang = false
  await pg.close()
}

// ================================================================================================ the block
head('block: its code')
{
  const code = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
  is(BLOCK.length > 4000 && /window\.__sportaPasscode/.test(BLOCK), 'the block is there, with its double-run guard')
  is(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|console\./.test(code), 'no markup from strings, no eval, no console')
  is(!/https?:\/\//.test(BLOCK.replace(/\/\*[\s\S]*?\*\//g, '')), 'no address in the code (no host but the page\'s own)')
  const keys = [...code.matchAll(/localStorage\.(get|set|remove)Item\(([^)]*)\)/g)].map((m) => m[2].trim())
  is(keys.length > 0 && keys.every((k) => k === 'EMAIL_KEY' || k === 'EMAIL_KEY, v'), 'storage is used for one key only, the address', JSON.stringify(keys))
  // Every route name the block spells out (the Settings saves pass theirs in as a variable, so match the names themselves).
  // 'passcode_locked' is an answer token the sign-in compares against, not a route.
  const routes = [...new Set([...code.matchAll(/'(passcode_[a-z]+)/g)].map((m) => m[1]))].filter((r) => r !== 'passcode_locked').sort()
  is(JSON.stringify(routes) === JSON.stringify(['passcode_clear', 'passcode_info', 'passcode_login', 'passcode_set', 'passcode_status']),
    'the only routes are the five passcode routes', JSON.stringify(routes))
  is(/'X-Sporta-Admin': '1'/.test(code), 'every request carries X-Sporta-Admin')
  // Two mentions of remember(: its definition and the one call, which runs only on a checked address.
  is((code.match(/\bremember\(/g) || []).length === 2 && /if \(validEmail\(v\)\) remember\(v\)/.test(code),
    'the address is stored in one place only, and only after it has been checked as an address')
}

head('mutation: without the block the sign-in shows no passcode step')
{
  const W = world({ status: { status: 200, body: { enabled: true } } })
  const pg = await open(W, { js: WITHOUT })
  await sleep(500)
  const killed = (await panelCount(pg)) === 0 && (await formState(pg)) === null && mine(W, 'passcode_status').length === 0
  is(killed, 'the mutant (block removed) shows no step and asks nothing: the checks above would fail on it')
  await pg.close()
}

for (const c of contexts) await c.close().catch(() => {})
await browser.close()
is(pageErrors.length === 0, 'no page error in any run', pageErrors.slice(0, 3).join(' | '))
console.log(`\n${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
