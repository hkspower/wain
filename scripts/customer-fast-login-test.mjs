/**
 * test:customer-fast-login — the three fast ways in for a shopper, and "Keep me signed in".
 *
 *  A. methods: ?r=customer_signin_methods says what is on (code, passkey, google), no values.
 *  B. email code: a code is sent (always the same answer), a wrong code is refused and counted,
 *     five wrong tries end it, the right code signs in ONCE, a new account is opened for a new
 *     address, and an unverified password account loses its password when the owner proves the
 *     address (the pre-hijack rule).
 *  C. passkey: a REAL browser with a virtual authenticator (user verification on) adds a passkey
 *     from the account sheet, signs out, and signs back in with one tap; a passkey only removes
 *     itself for its own owner; an assertion without user verification is refused.
 *  D. Google: the start redirect carries a signed state and a nonce; a token minted by this rig
 *     (its key planted as the shop's cached Google keys) with that nonce signs in; a wrong nonce,
 *     a tampered state and a token for another client go back with ?signin=failed.
 *  E. remember: unticked gives a cookie with no expiry (ends with the browser), ticked keeps 90 days.
 *  F. the sheet: buttons shown in both languages, no sideways scroll, the code view.
 *
 * Run `bash scripts/sandbox.sh` first. The sandbox serves http://localhost:4300 (WebAuthn refuses
 * an IP address as its site, so this rig uses the name). MUTATE=uv lets a passkey sign in without
 * user verification and must fail C; MUTATE=nonce skips the nonce check and must fail D.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, createSign, createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4300'
const API = `${BASE}/api/api.php?r=`
const ROOT = new URL('..', import.meta.url).pathname
const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-N', '-e', q],
  { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const KEY = 'SANDBOX_NOT_A_REAL_CRON_KEY'
const codeHash = (email, code) => createHmac('sha256', KEY).update(`customer-code|${email}|${code}`).digest('hex')
const CODE_A = 'fast-code@example.com', CODE_NEW = 'fast-new@example.com', SQUAT = 'fast-squat@example.com'
const PK = 'fast-pk@example.com', G = 'fast-google@example.com'
const ALL = [CODE_A, CODE_NEW, SQUAT, PK, G]
const clean = () => {
  sql('delete from rate_limit; delete from rate_bucket')
  const list = ALL.map((e) => `'${e}'`).join(',')
  sql(`delete from customer_passkeys where customer_id in (select id from customers where email in (${list}))`)
  sql(`delete from customer_login_codes where email in (${list})`)
  sql(`delete from customers where email in (${list})`)
}

// ---- tiny cookie jar for fetch
async function req(route, body, jar = {}, opts = {}) {
  const h = { Accept: 'application/json' }
  if (jar.c) h.Cookie = jar.c
  const o = { headers: h, redirect: 'manual' }
  if (body !== undefined) { o.method = 'POST'; h['Content-Type'] = 'application/json'; o.body = JSON.stringify(body) }
  const r = await fetch(route.startsWith('http') ? route : API + route, { ...o, ...opts, headers: { ...h, ...(opts.headers || {}) } })
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []
  for (const c of sc) { const m = c.match(/^([^=]+)=([^;]*)/); if (m && m[2] !== '') jar.c = `${m[1]}=${m[2]}`; jar.raw = c }
  let j = {}; try { j = await r.clone().json() } catch (e) {}
  return { status: r.status, j, r, setCookie: sc }
}

clean()
const MUT = process.env.MUTATE || ''
const customerPhp = `${ROOT}sporta-site/public_html/api/customer.php`
const original = readFileSync(customerPhp, 'utf8')
if (MUT === 'uv') writeFileSync(customerPhp, original.replace("if (($flags & 0x05) !== 0x05)", 'if (!($flags & 0x01))'))
const googlePhp = `${ROOT}sporta-site/public_html/api/customer-google.php`
const gOriginal = readFileSync(googlePhp, 'utf8')
if (MUT === 'nonce') writeFileSync(googlePhp, gOriginal.replace("|| !hash_equals((string) ($state['n'] ?? ''), (string) ($claims['nonce'] ?? ''))", ''))

const storage = `${ROOT}sporta-site/storage`
const hadStorage = existsSync(storage)
const savedGoogle = sql("select value from settings where name = 'google_auth'")
let browser
try {
  // ------------------------------------------------------------------ A
  const m = await req('customer_signin_methods')
  check(m.status === 200 && m.j.code === true && m.j.passkey === true && m.j.google === false,
    'A: methods: code and passkey on, Google off until a client id is set', JSON.stringify(m.j))
  check(!m.setCookie.length, 'A: asking sets no cookie')

  // ------------------------------------------------------------------ B
  const s1 = await req('customer_code_send', { email: CODE_A, lang: 'en' })
  const s2 = await req('customer_code_send', { email: 'not-an-account-9@example.com', lang: 'en' })
  check(s1.status === 200 && s2.status === 200 && JSON.stringify(s1.j) === JSON.stringify(s2.j),
    'B: sending answers the same for any address', `${s1.status} ${s2.status}`)
  check(Number(sql(`select count(*) from customer_login_codes where email = '${CODE_A}' and code_hash regexp '^[0-9a-f]{64}$'`)) === 1,
    'B: one row, holding only a hash of the code')
  check(!s1.setCookie.length, 'B: sending a code sets no cookie')
  for (let i = 0; i < 3; i++) await req('customer_code_send', { email: CODE_A })
  check(Number(sql(`select count(*) from customer_login_codes where email = '${CODE_A}'`)) === 3,
    'B: at most three codes per address in fifteen minutes (the rest answer ok and send nothing)')
  sql(`update customer_login_codes set used_at = now() where email = '${CODE_A}'`)
  sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${CODE_A}', '${codeHash(CODE_A, '482913')}', now() + interval 10 minute)`)
  const wrong = await req('customer_code_verify', { email: CODE_A, code: '000000' })
  check(wrong.status === 401 && wrong.j.error === 'bad_code', 'B: a wrong code is refused', wrong.j.error)
  check(sql(`select attempts from customer_login_codes where email = '${CODE_A}' order by id desc limit 1`) === '1', 'B: and counted')
  const jarB = {}
  const right = await req('customer_code_verify', { email: CODE_A, code: '٤٨٢٩١٣' }, jarB)
  check(right.status === 200 && right.j.customer && right.j.customer.email === CODE_A, 'B: the right code (typed in Arabic digits) signs in', right.status)
  check(sql(`select verified_at is not null from customers where email = '${CODE_A}'`) === '1', 'B: and a new address gets a verified account')
  const me = await req('customer_me', undefined, jarB)
  check(me.j.customer && me.j.customer.email === CODE_A, 'B: customer_me knows them')
  const again = await req('customer_code_verify', { email: CODE_A, code: '482913' })
  check(again.status === 401, 'B: the same code cannot be used twice', again.j.error)
  sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${CODE_A}', '${codeHash(CODE_A, '111222')}', now() + interval 10 minute)`)
  for (let i = 0; i < 5; i++) await req('customer_code_verify', { email: CODE_A, code: '999999' })
  const locked = await req('customer_code_verify', { email: CODE_A, code: '111222' })
  check(locked.status === 401 && locked.j.error === 'code_expired', 'B: after five wrong tries even the right code is refused', locked.j.error)
  const exp = (sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${CODE_NEW}', '${codeHash(CODE_NEW, '333444')}', now() - interval 1 minute)`), await req('customer_code_verify', { email: CODE_NEW, code: '333444' }))
  check(exp.status === 401 && exp.j.error === 'code_expired', 'B: an expired code is refused', exp.j.error)
  // pre-hijack: somebody registers the victim's address with their own password
  const sq = await req('customer_register', { email: SQUAT, password: 'squatter-pass-123' })
  check(sq.status === 200, 'B: (fixture) an account registered with a password, address unproved')
  sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${SQUAT}', '${codeHash(SQUAT, '555666')}', now() + interval 10 minute)`)
  const owner = await req('customer_code_verify', { email: SQUAT, code: '555666' })
  check(owner.status === 200, 'B: the real owner proves the address with a code')
  const squatter = await req('customer_login', { email: SQUAT, password: 'squatter-pass-123' })
  check(squatter.status === 401, 'B: and the squatter\'s password no longer works', squatter.status)

  // ------------------------------------------------------------------ E (remember)
  sql('delete from rate_limit; delete from rate_bucket')
  await req('customer_register', { email: PK, password: 'fast-passkey-pw-1' })
  const keep = await req('customer_login', { email: PK, password: 'fast-passkey-pw-1', remember: true })
  const short = await req('customer_login', { email: PK, password: 'fast-passkey-pw-1', remember: false })
  const ck = (r) => r.setCookie.find((c) => /sporta_shopper=[^;]+/.test(c) && !/=deleted|=;/.test(c)) || ''
  check(/Max-Age=7776000|expires=/i.test(ck(keep)), 'E: ticked: the cookie lasts (90 days)', ck(keep).slice(0, 80))
  check(ck(short) !== '' && !/Max-Age|expires=/i.test(ck(short)), 'E: unticked: the cookie ends when the browser closes', ck(short).slice(0, 80))

  // ------------------------------------------------------------------ C (passkey, real browser)
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) {} })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  // sign in with the password, then add a passkey from the sheet
  await page.click('[data-cua-btn]')
  await page.fill('#cua-email', PK); await page.fill('#cua-pw', 'fast-passkey-pw-1')
  await page.click('.cua-go')
  await page.waitForSelector('.cua-pks .cua-pk', { timeout: 8000 }).catch(() => {})
  check(await page.locator('.cua-pks .cua-pk').innerText().catch(() => '') === 'Turn on Face ID / fingerprint sign-in', 'C: a signed-in account is offered Face ID sign-in')
  await page.click('.cua-pks .cua-pk')
  await page.waitForFunction(() => /this device can sign you in/.test(document.querySelector('.cua-sheet')?.innerText || ''), null, { timeout: 8000 }).catch(() => {})
  check(Number(sql(`select count(*) from customer_passkeys k join customers c on c.id = k.customer_id where c.email = '${PK}'`)) === 1,
    'C: one passkey stored for this customer')
  await page.click('.cua-out'); await page.waitForSelector('.cua-tabs')
  check(await page.locator('.cua-pk').count() === 1, 'C: signed out, the sheet offers "Sign in with Face ID / fingerprint"')
  await page.click('.cua-pk')
  await page.waitForSelector('.cua-out', { timeout: 8000 }).catch(() => {})
  check(await page.locator('.cua-out').count() === 1, 'C: one tap signs back in')
  const meC = await page.evaluate(() => fetch('/api/api.php?r=customer_me').then((r) => r.json()))
  check(meC.customer && meC.customer.email === PK, 'C: as the right customer', meC.customer && meC.customer.email)
  // another customer cannot remove it
  const pkId = sql(`select k.id from customer_passkeys k join customers c on c.id = k.customer_id where c.email = '${PK}'`)
  const other = await req('customer_passkey_remove', { id: Number(pkId || 0) }, jarB)
  check(other.j.ok === false && pkId !== '' && sql(`select count(*) from customer_passkeys where id = ${pkId}`) === '1', 'C: another customer\'s remove changes nothing')
  // no user verification -> refused
  await page.click('.cua-out'); await page.waitForSelector('.cua-tabs')
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false })
  // Ask the authenticator directly with verification "discouraged", so the SERVER is what has to
  // refuse a presence-only assertion (the sheet asks for "required", where the browser refuses first).
  const noUv = await page.evaluate(async () => {
    const b2 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer }
    const u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const post = (r, body) => fetch('/api/api.php?r=' + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, j: await x.json().catch(() => ({})) }))
    const o = (await post('customer_passkey_options_login', {})).j
    const cred = await navigator.credentials.get({ publicKey: { challenge: b2(o.challenge), rpId: o.rpId, userVerification: 'discouraged', allowCredentials: [] } })
    const a = cred.response
    return post('customer_passkey_login', { id: u(cred.rawId), response: { clientDataJSON: u(a.clientDataJSON), authenticatorData: u(a.authenticatorData), signature: u(a.signature) } })
  }).catch((e) => ({ status: 0, j: { error: String(e) } }))
  check(noUv.status === 401, 'C: an assertion without Face ID / fingerprint (presence only) is refused by the server', `${noUv.status} ${noUv.j.error || ''}`)
  await ctx.close()

  // ------------------------------------------------------------------ D (Google)
  sql('delete from rate_limit; delete from rate_bucket')
  const CLIENT = '1234567890-fastlogin.apps.googleusercontent.com', KID = 'fast-' + randomUUID().slice(0, 8)
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  mkdirSync(storage, { recursive: true })
  writeFileSync(`${storage}/google-jwks.json`, JSON.stringify({ keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] }))
  sql(`insert into settings (name, value) values ('google_auth', '${JSON.stringify({ client_id: CLIENT, enabled: true })}') on duplicate key update value = values(value)`)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const mint = (claims) => {
    const now = Math.floor(Date.now() / 1000)
    const h = b64({ alg: 'RS256', kid: KID, typ: 'JWT' })
    const b = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '42', email: G, email_verified: true, name: 'Fast Google', iat: now, exp: now + 3600, ...claims })
    const s = createSign('RSA-SHA256'); s.update(`${h}.${b}`); s.end()
    return `${h}.${b}.${s.sign(privateKey).toString('base64url')}`
  }
  check((await req('customer_signin_methods')).j.google === true, 'D: with a client id set and switched on, Google is offered')
  const start = await fetch(`${BASE}/api/customer-google.php?return=${encodeURIComponent('/shop?x=1')}&remember=1`, { redirect: 'manual' })
  const loc = new URL(start.headers.get('location') || 'http://x/')
  check(start.status === 302 && loc.host === 'accounts.google.com' && loc.searchParams.get('client_id') === CLIENT
    && loc.searchParams.get('response_mode') === 'form_post' && loc.searchParams.get('redirect_uri') === `${BASE}/api/customer-google.php`,
    'D: start goes to Google with this shop\'s client and its own address to come back to', `${start.status} ${loc.host}`)
  check(!(start.headers.getSetCookie?.() || []).length, 'D: and sets no cookie on the way out')
  const nonce = loc.searchParams.get('nonce'), state = loc.searchParams.get('state')
  const post = (fields) => fetch(`${BASE}/api/customer-google.php`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
  const bad1 = await post({ id_token: mint({ nonce: 'someone-elses' }), state })
  check(bad1.status === 303 && /signin=failed/.test(bad1.headers.get('location')), 'D: a token with another visit\'s nonce goes back failed', bad1.headers.get('location'))
  const bad2 = await post({ id_token: mint({ nonce }), state: state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })
  check(bad2.status === 303 && /^\/\?signin=failed/.test(bad2.headers.get('location')), 'D: a tampered state goes back failed (and home, not to its return)', bad2.headers.get('location'))
  const bad3 = await post({ id_token: mint({ nonce, aud: 'another-client.apps.googleusercontent.com' }), state })
  check(/signin=failed/.test(bad3.headers.get('location') || ''), 'D: a token minted for another site goes back failed')
  check(sql(`select count(*) from customers where email = '${G}'`) === '0', 'D: none of those opened an account')
  const good = await post({ id_token: mint({ nonce }), state })
  const gc = (good.headers.getSetCookie?.() || []).find((c) => /sporta_shopper=/.test(c)) || ''
  check(good.status === 303 && good.headers.get('location') === '/shop?x=1&signin=google', 'D: a good token comes back to the page it left, signed in', good.headers.get('location'))
  const jarD = { c: gc.split(';')[0] }
  const meD = await req('customer_me', undefined, jarD)
  check(meD.j.customer && meD.j.customer.email === G && meD.j.customer.name === 'Fast Google', 'D: as the Google address, with its name', JSON.stringify(meD.j.customer || {}))
  const evil = await fetch(`${BASE}/api/customer-google.php?return=${encodeURIComponent('//evil.example/x')}`, { redirect: 'manual' })
  const st2 = new URL(evil.headers.get('location')).searchParams.get('state')
  const ev = await post({ id_token: mint({ nonce: new URL(evil.headers.get('location')).searchParams.get('nonce') }), state: st2 })
  check(ev.headers.get('location') === '/?signin=google', 'D: a return address on another host is replaced by the home page', ev.headers.get('location'))

  // ------------------------------------------------------------------ F (sheet)
  for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 1280]]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: 900 } })
    await c2.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
    const p2 = await c2.newPage()
    await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await p2.click('[data-cua-btn]')
    await p2.waitForSelector('.cua-g', { timeout: 6000 }).catch(() => {})
    const txt = await p2.locator('.cua-sheet').innerText()
    check(await p2.locator('.cua-pk').count() === 1 && await p2.locator('.cua-g').count() === 1, `F [${lang} ${w}]: Face ID and Google buttons are shown`)
    check(lang === 'ar' ? /تذكّرني/.test(txt) && /بالوجه أو البصمة/.test(txt) : /Keep me signed in/.test(txt), `F [${lang}]: in the page's language`)
    const boxes = await p2.$$eval('.cua-alt, .cua-go, .cua-link, .cua-rem', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    check(boxes.every((h) => h >= 44), `F [${lang} ${w}]: every control is at least 44px tall`, boxes.join(','))
    check(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `F [${lang} ${w}]: no sideways scroll`)
    await p2.click('.cua-link')
    check(await p2.locator('#cua-email').count() === 1 && await p2.locator('.cua-back').count() === 1, `F [${lang}]: "email me a code" opens the code view`)
    await p2.fill('#cua-email', 'nobody-fast@example.com'); await p2.click('.cua-go')
    await p2.waitForSelector('#cua-code', { timeout: 6000 }).catch(() => {})
    const codeBox = p2.locator('#cua-code')
    check(await codeBox.count() === 1 && await codeBox.getAttribute('autocomplete') === 'one-time-code' && await codeBox.getAttribute('inputmode') === 'numeric',
      `F [${lang}]: after sending, a one-time-code box with a number pad`)
    check(await p2.evaluate(() => document.activeElement && document.activeElement.id) === 'cua-code', `F [${lang}]: and it has the focus`)
    await c2.close()
  }
  sql("delete from customer_login_codes where email = 'nobody-fast@example.com'")
  // the Google return flag opens the sheet with a message and leaves the address clean
  const c3 = await browser.newContext(); const p3 = await c3.newPage()
  await c3.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) {} })
  await p3.goto(`${BASE}/shop?signin=failed`, { waitUntil: 'networkidle' })
  await p3.waitForSelector('.cua-flash', { timeout: 6000 }).catch(() => {})
  check(/did not complete/.test(await p3.locator('.cua-flash').innerText().catch(() => '')), 'F: ?signin=failed opens the sheet and says so')
  check(!/signin=/.test(p3.url()), 'F: and the flag is removed from the address', p3.url())
  await c3.close()
} finally {
  if (MUT === 'uv') writeFileSync(customerPhp, original)
  if (MUT === 'nonce') writeFileSync(googlePhp, gOriginal)
  if (savedGoogle) sql(`update settings set value = '${savedGoogle.replace(/'/g, "''")}' where name = 'google_auth'`)
  else sql("delete from settings where name = 'google_auth'")
  if (!hadStorage) rmSync(storage, { recursive: true, force: true }); else rmSync(`${storage}/google-jwks.json`, { force: true })
  clean()
  if (browser) await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — Face ID, email code and Google sign-in, and "Keep me signed in"')
process.exit(fails ? 1 : 0)
