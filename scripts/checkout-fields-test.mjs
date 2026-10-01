/**
 * Checkout fields: bigger, live hints that follow the SERVER'S rules, optional fields tucked
 * away, governorate -> area flow. node scripts/checkout-fields-test.mjs (sandbox on :4300)
 * Reached the way a shopper reaches it — Buy now, a client-side navigation — because a script
 * that only checks the address once at load never sees the checkout that way.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
sql('update product_variants set stock = 20 where stock < 20')
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (lang) => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await p.goto(`${BASE}/product/vanquish-tank-navy?lang=${lang}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1800)
  await p.locator('button').filter({ hasText: /^L$/ }).first().click()
  await p.waitForTimeout(300)
  await p.locator('button').filter({ hasText: lang === 'ar' ? /^اشترِ الآن$/ : /^Buy now$/ }).first().click()
  await p.waitForTimeout(2500)
  return p
}
const msg = (p, f) => p.evaluate((f) => { const l = document.querySelector(`label[for="f-${f}"]`); const m = l && l.parentElement.querySelector('[data-cf-msg]'); return m && !m.hidden ? m.textContent : '' }, f)
const blur = async (p, f, v) => { await p.locator('#f-' + f).fill(v); await p.locator('#f-' + f).blur(); await p.waitForTimeout(250) }

try {
  const p = await open('en')
  check(/\/checkout/.test(p.url()), 'reached /checkout by Buy now (no page load)')
  // 1. bigger
  const sizes = await p.evaluate(() => ['name', 'email', 'governorate', 'area', 'block', 'street', 'building'].map((f) => { const e = document.getElementById('f-' + f); return e && [f, Math.round(e.getBoundingClientRect().height), parseFloat(getComputedStyle(e).fontSize)] }))
  check(sizes.every((s) => s && s[1] >= 50 && s[2] >= 16), 'inputs are at least 50px tall and 16px type', JSON.stringify(sizes))
  // 2. tucked
  const vis = (id) => p.evaluate((id) => { const e = document.getElementById(id); return !!(e && e.offsetParent) }, id)
  check(!(await vis('f-floor')) && !(await vis('f-flat')) && !(await vis('f-note')), 'floor, flat and the note are tucked away at first')
  check(await vis('f-name') && await vis('f-email') && await vis('f-block') && await vis('f-building'), 'every REQUIRED field stays in view')
  check(await p.locator('[data-cf-more]').isVisible(), 'one button offers them')
  await p.locator('[data-cf-more]').click(); await p.waitForTimeout(300)
  check(await vis('f-floor') && await vis('f-flat') && await vis('f-note') && !(await p.locator('[data-cf-more]').isVisible()), 'pressing it opens all three (and the button goes)')
  check(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'f-floor', 'and focus lands on Floor')
  // 3. hints
  await blur(p, 'phone', '123')
  check((await msg(p, 'phone')).includes('8 digits'), 'a short phone says what is needed', await msg(p, 'phone'))
  await blur(p, 'phone', '+965 5551 2345')
  check(await p.locator('#f-phone').inputValue() === '55512345', 'a pasted +965 number is tidied to the 8 digits', await p.locator('#f-phone').inputValue())
  check(await msg(p, 'phone') === '✓', 'and shows a tick')
  await blur(p, 'phone', '٩٩٨٨٧٧٦٦')
  check(await p.locator('#f-phone').inputValue() === '99887766', 'Arabic digits become ASCII')
  await blur(p, 'phone', '45551234')
  check((await msg(p, 'phone')).includes('5, 6 or 9'), 'a number starting with 4 is refused, as the server refuses it')
  await blur(p, 'email', 'nope'); check((await msg(p, 'email')).includes('valid email'), 'a bad email is explained')
  await blur(p, 'email', 'a@b.co'); check(await msg(p, 'email') === '✓', 'a good email ticks')
  await blur(p, 'name', 'A'); check((await msg(p, 'name')).includes('2 letters'), 'a 1-letter name is explained')
  await blur(p, 'name', 'Ali Test'); check(await msg(p, 'name') === '✓', 'a name ticks')
  await p.locator('#f-block').focus(); await p.locator('#f-street').focus(); await p.waitForTimeout(250)
  check((await msg(p, 'block')).includes('block'), 'leaving Block empty says so')
  // untouched fields stay quiet
  const quiet = await p.evaluate(() => { const l = document.querySelector('label[for="f-building"]'); const m = l.parentElement.querySelector('[data-cf-msg]'); return !m || m.hidden })
  check(quiet, 'a field nobody has visited is not scolded')
  // 4. flow
  await p.locator('#f-governorate').selectOption({ index: 1 }); await p.waitForTimeout(400)
  check(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'f-area', 'choosing a governorate moves to Area')
  // bundle error wins: submit with the form incomplete
  await p.locator('button').filter({ hasText: /Pay with|Place order|Confirm/ }).last().click().catch(() => {})
  await p.waitForTimeout(800)
  const dup = await p.evaluate(() => ['name', 'phone', 'email', 'area', 'block', 'street', 'building'].filter((f) => document.getElementById('e-' + f) && (() => { const l = document.querySelector(`label[for="f-${f}"]`); const m = l && l.parentElement.querySelector('[data-cf-msg]'); return m && !m.hidden && m.textContent !== '✓' })()))
  check(dup.length === 0, 'where the bundle shows its own error, no second message is added', dup.join())
  await p.context().close()

  const a = await open('ar')
  await blur(a, 'phone', '123')
  check((await msg(a, 'phone')).includes('أرقام'), 'Arabic: the hint is in Arabic', await msg(a, 'phone'))
  check((await a.locator('[data-cf-more]').innerText()).includes('أضف'), 'Arabic: the button is in Arabic')
  // the phone rule is the server's: compare with the real store_phone() on awkward inputs
  const cases = ['55512345', '+965 5551 2345', '00965 55512345', '965 55512345', '45551234', '5551234', '555123456', '٩٩٨٨٧٧٦٦', '۹۹۸۸۷۷۶۶', '9655551234', '', '5 5 5 1 2 3 4 5', 'abc']
  const php = execFileSync('php', ['-r', `require 'sporta-site/public_html/api/store.php'; foreach (json_decode(file_get_contents('php://stdin')) as $c) echo store_phone($c) === null ? '0' : '1';`], { input: JSON.stringify(cases), encoding: 'utf8' })
  const mine = await a.evaluate((cs) => cs.map((c) => window.__sportaCheckoutRules.rules.phone(c) ? '1' : '0').join(''), cases)
  check(mine === php, 'the phone rule agrees with the server\'s store_phone() on every awkward input', `page=${mine} server=${php}`)
  await a.context().close()
} finally { await b.close() }
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
