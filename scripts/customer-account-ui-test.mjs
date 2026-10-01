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
  await p.locator('.cua-go').click(); await p.waitForTimeout(700)
  check((await p.locator('.cua-err').innerText()).includes('12 characters'), 'a short password is refused in plain words', await p.locator('.cua-err').innerText())
  await p.locator('#cua-pw').fill('correct horse battery'); await p.locator('#cua-name').fill('<img src=x onerror=window.__x=1>Ali'); await p.locator('#cua-phone').fill('55512345')
  await p.locator('.cua-go').click(); await p.waitForTimeout(1200)
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
