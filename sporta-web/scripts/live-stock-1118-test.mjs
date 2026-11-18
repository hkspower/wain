// LIVE STOCK-1118 (owner, 2026-11-18: "use ajax to sizes and colors selecter"): the product page asks the shop for its stock again when a size is tapped, when
// the tab returns and before Add, on the REAL compiled client with the live add-ons (the stock answers are made by route interception).
//   npm run test:live-stock-1118   (rig-free; needs the capture of the live storefront like test:add-to-cart-ux; skipped with a message otherwise)
// Asserted: tapping a size makes ONE GET of api.php?r=stock (no-store); a size the answer says has none is marked (data-sporta-gone, aria-disabled, struck
// through) and cannot be chosen, with a note; the size in hand going to 0 (tab returns) stops Add before it reaches the bag; a size that comes back is released;
// a failed request changes nothing; no POST and no other new request; Arabic note; MUTATIONS.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { liveDir, serveLive, PUB } from './lib/add-to-cart-ux-live.mjs'

const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
if (!liveDir || !existsSync(liveDir())) { console.log('SKIP: the capture of the live storefront is not on this machine'); process.exit(0) }
const JS = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const servers = {}
const srv = async (k, js) => (servers[k] ||= await serveLive(js ? { js: { 'sporta-features.js': js } } : {}))
const SLUG = 'sgomma-t-shirt-navy'
async function open(lang, { js = null, key = 'base', failApi = false } = {}) {
  const s = await srv(key, js)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  const pg = await ctx.newPage(), errors = [], st = { gets: 0, zero: {}, other: [] }
  pg.on('pageerror', (e) => errors.push(e.message))
  pg.on('request', (r) => { if (r.method() !== 'GET' && !/\.(png|jpg|webp)/.test(r.url())) st.other.push(r.method() + ' ' + r.url()) })
  await pg.route('**/api/api.php?r=stock', async (route) => {
    st.gets++
    if (failApi && st.gets > 1) return route.fulfill({ status: 500, body: '{}' })
    const res = await route.fetch()
    const rows = await res.json()
    const out = rows.map((r) => (r.slug === SLUG && st.zero[String(r.size).toUpperCase()] ? { ...r, stock: 0, in_stock: false } : r))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) })
  })
  await pg.goto(`${s.base}/product/${SLUG}?lang=${lang}`, { waitUntil: 'load' })
  await pg.waitForSelector('.product-purchase-row', { timeout: 90000 })
  await pg.waitForFunction(() => document.querySelectorAll('#product-size-options [role="group"] > button').length > 0, null, { timeout: 60000 })
  await pg.waitForTimeout(900); st.gets = 0
  return { ctx, pg, errors, st }
}
const chip = (pg, s) => pg.locator('#product-size-options [role="group"] > button').filter({ hasText: new RegExp(`^${s}$`) }).first()
const bagQty = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('sporta_cart') || '[]').reduce((n, l) => n + (Number(l.qty) || 0), 0) } catch (e) { return -1 } })
const back = (pg) => pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

head('a size is tapped, the stock is asked again')
{
  const { ctx, pg, errors, st } = await open('en')
  await chip(pg, 'M').click(); await pg.waitForTimeout(500)
  is(st.gets === 1, 'tapping a size makes ONE request for the stock', String(st.gets))
  is(await pg.locator('[data-sporta-gone]').count() === 0, 'nothing is marked while every size has stock')
  st.zero.L = true
  await chip(pg, 'S').click(); await pg.waitForTimeout(600)
  is(await chip(pg, 'L').getAttribute('data-sporta-gone') !== null && await chip(pg, 'L').getAttribute('aria-disabled') === 'true', 'L, now sold out in the answer, is marked data-sporta-gone and aria-disabled')
  is(await chip(pg, 'L').evaluate((e) => getComputedStyle(e).textDecorationLine) === 'line-through', 'and struck through')
  const pressedBefore = await chip(pg, 'S').getAttribute('aria-pressed')
  await chip(pg, 'L').click({ force: true }); await pg.waitForTimeout(300)
  is(await chip(pg, 'L').getAttribute('aria-pressed') !== 'true' && await chip(pg, 'S').getAttribute('aria-pressed') === pressedBefore, 'tapping the sold-out size does not choose it (S stays chosen)')
  is(/just sold out/.test(await pg.locator('[data-sporta-gone-note]').textContent().catch(() => '')), 'the note says it has just sold out')
  await pg.locator('.product-purchase-row .btn-primary').click(); await pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 })
  is(await bagQty(pg) === 1, 'a size that is still on offer adds normally')
  is(st.other.length === 0, 'no POST and no other new request', st.other.join(' | '))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await ctx.close()
}
head('the size in hand sells out while the page is open')
{
  const { ctx, pg, st } = await open('en')
  await chip(pg, 'M').click(); await pg.waitForTimeout(500)
  st.zero.M = true
  await back(pg); await pg.waitForTimeout(600)
  is(await chip(pg, 'M').getAttribute('data-sporta-gone') !== null && /just sold out/.test(await pg.locator('[data-sporta-gone-note]').textContent().catch(() => '')), 'the tab coming back asks again: M is marked and the note shows')
  await pg.locator('.product-purchase-row .btn-primary').click(); await pg.waitForTimeout(900)
  is(await bagQty(pg) === 0 && await pg.locator('.sporta-u3-toast[data-open]').count() === 0, 'Add of the sold-out size is stopped before it reaches the bag')
  st.zero.M = false
  await back(pg); await pg.waitForTimeout(600)
  is(await chip(pg, 'M').getAttribute('data-sporta-gone') === null && await pg.locator('[data-sporta-gone-note]').count() === 0, 'a size that has come back is released and the note goes')
  await pg.locator('.product-purchase-row .btn-primary').click(); await pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 })
  is(await bagQty(pg) === 1, '... and Add works again')
  await ctx.close()
}
head('the request fails; Arabic')
{
  const { ctx, pg, st } = await open('en', { failApi: true })
  await chip(pg, 'M').click(); await pg.waitForTimeout(500)
  await chip(pg, 'L').click(); await pg.waitForTimeout(600)
  is(await pg.locator('[data-sporta-gone]').count() === 0 && await chip(pg, 'L').getAttribute('aria-pressed') === 'true', 'a failing stock request changes nothing: the page stays as the app drew it')
  await ctx.close()
}
{
  const { ctx, pg, st } = await open('ar')
  await chip(pg, 'M').click(); await pg.waitForTimeout(400)
  st.zero.M = true; await back(pg); await pg.waitForTimeout(600)
  is(/نفد هذا المقاس/.test(await pg.locator('[data-sporta-gone-note]').textContent().catch(() => '')), 'Arabic: the note is in Arabic')
  await ctx.close()
}
head('mutations (each must turn the suite red)')
{
  const m1 = JS.replace("if (selectedGone() && Date.now() - lastAt < 15000) { e.preventDefault(); e.stopImmediatePropagation(); note(true) } else fetchStock()", "fetchStock()")
  is(m1 !== JS, 'mutation 1 applies')
  const o = await open('en', { js: m1, key: 'm1' })
  await chip(o.pg, 'M').click(); await o.pg.waitForTimeout(500); o.st.zero.M = true; await back(o.pg); await o.pg.waitForTimeout(600)
  await o.pg.locator('.product-purchase-row .btn-primary').click(); await o.pg.waitForTimeout(900)
  is(await bagQty(o.pg) === 1, 'without the Add guard a sold-out size reaches the bag: caught')
  await o.ctx.close()
  const m2 = JS.replace("var gone = known && stock[key] < 1 && !c.disabled", "var gone = false")
  const o2 = await open('en', { js: m2, key: 'm2' })
  await chip(o2.pg, 'M').click(); await o2.pg.waitForTimeout(400); o2.st.zero.L = true; await chip(o2.pg, 'S').click(); await o2.pg.waitForTimeout(600)
  is(await o2.pg.locator('[data-sporta-gone]').count() === 0, 'without marking, a sold-out size stays tappable: caught')
  await o2.ctx.close()
}
await browser.close(); Object.values(servers).forEach((s) => s.server && s.server.close && s.server.close())
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
