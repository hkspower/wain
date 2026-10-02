/**
 * The customer account sheet in the top bar. node scripts/customer-account-ui-test.mjs (sandbox on :4300)
 * Registers a real customer through the real UI, plants one order against it, and removes both.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
const EMAIL = 'ui-rig@example.com', TRACK = 'SPUIRIG0001'
const clean = () => { sql(`delete from orders where track_id='${TRACK}'`); sql(`delete from customers where email='${EMAIL}'`); sql('delete from rate_limit') }
clean()
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
    for (const lang of ['en', 'ar']) {
      const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })
      const p = await ctx.newPage()
      await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800)
      const L = `${name} ${lang}:`
      const btn = p.locator('[data-cua-btn]')
      check(await btn.count() === 1, `${L} one account button in the top bar`)
      const bb = await btn.boundingBox()
      const bag = await p.locator('header button[aria-label^="Bag"], header button[aria-label^="الحقيبة"]').first().boundingBox()
      check(bb && bag && Math.abs(bb.width - bag.width) < 1 && Math.abs(bb.height - bag.height) < 1 && (!touch || (bb.width >= 44 && bb.height >= 44)), `${L} it is the bag's own size (and a 44px target on a phone)`, JSON.stringify(bb && [Math.round(bb.width), Math.round(bb.height)]))
      check(bb && bag && (bb.x + bb.width <= bag.x + 1 || bag.x + bag.width <= bb.x + 1), `${L} and clear of the bag`)
      check((await btn.getAttribute('aria-label')) === (lang === 'ar' ? 'حسابي' : 'My account'), `${L} named in the page's language`)
      check((await ctx.cookies()).length === 0, `${L} a visitor who has not opened it holds no cookie (storefront stays cookie-free)`)
      await ctx.close()
    }
  }

  // the server-drawn category pages carry the same icon, and it works
  for (const lang of ['en', 'ar']) {
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const q = await c2.newPage()
    await q.goto(`${BASE}/men?lang=${lang}`, { waitUntil: 'networkidle' }); await q.waitForTimeout(1500)
    check(await q.locator('[data-cua-btn]').count() === 1, `category page ${lang}: the account icon is in its header too`)
    const tb = await q.evaluate(() => Math.round(document.querySelector('header.app-header').getBoundingClientRect().height))
    check(tb <= 140, `category page ${lang}: header is slimmer (was ~210px with the promo strip)`, tb + 'px')
    await q.locator('[data-cua-btn]').click(); await q.waitForTimeout(500)
    check(await q.locator('.cua-sheet').isVisible(), `category page ${lang}: and it opens the sheet`)
    await c2.close()
  }

  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800)
  await p.locator('[data-cua-btn]').click()
  const sheet = p.locator('.cua-sheet')
  check(await sheet.isVisible() && await sheet.getAttribute('role') === 'dialog', 'it opens a dialog')
  check((await ctx.cookies()).length === 0, 'and opening it still sets no cookie')
  // sign in with nothing
  await p.locator('#cua-email').fill('nobody@example.com'); await p.locator('#cua-pw').fill('whatever-123456')
  await p.locator('.cua-go').click(); await p.waitForTimeout(700)
  check((await p.locator('.cua-err').innerText()).includes('Wrong email or password'), 'a wrong sign-in says so', await p.locator('.cua-err').innerText())
  // register: short password refused in words
  await p.locator('.cua-tab').nth(1).click()
  await p.locator('#cua-email').fill(EMAIL); await p.locator('#cua-pw').fill('short')
  // THE SIGN-UP FORM, improved 2026-10-02: a live length meter, a consent line, and every
  // mistake shown beside its own box (and the box focused) before anything is sent.
  check(await p.locator('.cua-perk').isVisible(), 'the sign-up view says what an account is for')
  check((await p.locator('.cua-meter small').innerText()).startsWith('5 / 12'), 'the meter counts as you type', await p.locator('.cua-meter small').innerText())
  const hrefs = await p.locator('.cua-consent a').evaluateAll((as) => as.map((a) => new URL(a.href).pathname + new URL(a.href).search))
  check(hrefs.join() === '/terms?lang=en,/privacy?lang=en', 'the consent line links the Terms and the Privacy Policy', hrefs.join())
  let reqs = 0; p.on('request', (r) => { if (r.url().includes('customer_register')) reqs++ })
  await p.locator('.cua-go').click(); await p.waitForTimeout(400)
  check((await p.locator('#cua-pw-err').innerText()).includes('12 characters') && await p.locator('#cua-pw').getAttribute('aria-invalid') === 'true', 'a short password is refused in plain words, under its own box', await p.locator('#cua-pw-err').innerText().catch(() => ''))
  check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'cua-pw'), 'and that box takes focus')
  check(reqs === 0, 'and nothing was sent to the server for it')
  await p.locator('#cua-email').fill('not-an-email'); await p.locator('#cua-pw').fill('correct horse battery'); await p.locator('.cua-go').click(); await p.waitForTimeout(300)
  check(await p.locator('#cua-email-err').isVisible() && reqs === 0, 'a bad email is caught in the browser, beside the email box')
  await p.locator('#cua-email').fill(EMAIL)
  await p.locator('#cua-pw').fill('1234'); await p.locator('#cua-pw').fill('correct horse battery')
  check((await p.locator('.cua-meter small').innerText()).includes('✓') && await p.locator('.cua-meter.ok').count() === 1, 'twelve characters turns the meter green')
  await p.locator('#cua-name').fill('<img src=x onerror=window.__x=1>Ali')
  await p.locator('#cua-phone').fill('+965 5551-2345'); await p.locator('#cua-phone').blur()
  check(await p.locator('#cua-phone').inputValue() === '55512345', 'a phone typed as +965 5551-2345 is tidied to 8 digits', await p.locator('#cua-phone').inputValue())
  await p.locator('#cua-phone').fill('12345'); await p.locator('.cua-go').click(); await p.waitForTimeout(300)
  check(await p.locator('#cua-phone-err').isVisible() && reqs === 0, 'a wrong phone is caught beside the phone box')
  await p.locator('#cua-phone').fill('55512345')
  await p.locator('.cua-go').click(); await p.waitForTimeout(1200)
  check((await p.locator('.cua-welcome').innerText()).includes('ready'), 'a new account is welcomed')
  check((await p.locator('.cua-h').innerText()).startsWith('Hello'), 'registering lands on the account view', await p.locator('.cua-h').innerText())
  check(await p.evaluate(() => !window.__x && !document.querySelector('.cua-sheet img')), 'a name with markup is shown as text, never run')
  const ck = (await ctx.cookies()).find((c) => c.name === 'sporta_shopper')
  check(!!ck && ck.httpOnly && ck.sameSite === 'Lax', 'only now a cookie appears, HttpOnly and SameSite=Lax (so the bank redirect keeps them signed in)', JSON.stringify(ck && [ck.httpOnly, ck.sameSite]))
  check(await p.locator('[data-cua-btn]').getAttribute('data-signed') === '1', 'the top-bar icon shows signed-in')
  check((await p.locator('.cua-orders').innerText()).includes('No orders yet') && (await p.locator('.cua-orders').innerText()).includes('while signed in'), 'no orders yet — and it says why the list is empty')
  // an order linked to this customer shows up
  const cid = sql(`select id from customers where email='${EMAIL}'`)
  sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_id, created_at) values ('${TRACK}', 12.5, 'paid', 'knet', 'shipped', 'Rig', '55512345', ${cid}, now())`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  check(!(await sheet.isVisible().catch(() => false)), 'Escape closes it')
  check(await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-cua-btn')), 'and focus returns to the icon')
  await p.locator('[data-cua-btn]').click(); await p.waitForTimeout(1200)
  const txt = await p.locator('.cua-orders').innerText()
  check(txt.includes(TRACK) && txt.includes('12.500') && txt.includes('Paid') && txt.includes('Shipped'), 'reopened, the order appears with its amount and status', txt.replace(/\n/g, ' | ').slice(0, 90))
  // reload keeps the session
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  check(await p.locator('[data-cua-btn]').getAttribute('data-signed') === '1', 'a reload is still signed in')
  // sign out
  await p.locator('[data-cua-btn]').click(); await p.locator('.cua-out').click(); await p.waitForTimeout(900)
  check(await p.locator('.cua-tabs').isVisible(), 'sign out returns to the sign-in form')
  check(await p.locator('[data-cua-btn]').getAttribute('data-signed') === '0', 'and the icon goes back')
  const me = await p.evaluate(async () => (await fetch('/api/api.php?r=customer_me', { credentials: 'same-origin' })).json())
  check(me.customer === null, 'the server agrees nobody is signed in')
  // registering an address that already has an account is answered beside the email box
  await p.locator('.cua-tab').nth(1).click()   // the sheet is still open on the sign-in form after signing out
  await p.locator('#cua-email').fill(EMAIL); await p.locator('#cua-pw').fill('another long password'); await p.locator('.cua-go').click(); await p.waitForTimeout(800)
  check((await p.locator('#cua-email-err').innerText()).includes('already has an account') && await p.evaluate(() => document.activeElement.id === 'cua-email'), 'an address that already has an account is said so under the email box, which takes focus')
  // sign in again, Arabic
  await p.keyboard.press('Escape')
  await p.goto(`${BASE}/?lang=ar`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  await p.locator('[data-cua-btn]').click()
  check(await p.locator('.cua-sheet').getAttribute('dir') === 'rtl' && (await p.locator('.cua-tab').first().innerText()) === 'تسجيل الدخول', 'Arabic: right-to-left and in Arabic')
  await p.locator('#cua-email').fill(EMAIL); await p.locator('#cua-pw').fill('correct horse battery')
  await p.locator('.cua-go').click(); await p.waitForTimeout(1200)
  check((await p.locator('.cua-h').innerText()).startsWith('أهلاً'), 'Arabic: signing in works', await p.locator('.cua-h').innerText())
  await ctx.close()
} finally { clean(); await b.close() }
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
