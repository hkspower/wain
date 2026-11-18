// BAG-LINK-1118 (owner, 2026-11-18: "fix add to cart button"; the live probe scripts/live-add-to-cart-probe.mjs found that after the last piece of a
// product is added, Buy now becomes a disabled "In your bag" pill that does nothing): the REAL compiled client with the live add-ons.
//   npm run test:bag-link-1118   (rig-free; needs the capture of the live storefront like test:add-to-cart-ux; skipped with a message otherwise)
// Asserted: a product whose only piece is in the bag gets a "View bag" link in the bar (and in the page row) in place of the disabled Buy now; the disabled
// button is hidden, not removed; the link is the bar's pill (near-black, logo orange words, 48px, full width), it opens the bag drawer like the header icon;
// a product that still has pieces gets no link and keeps its Buy now; the link goes when the bag is emptied; Arabic and English; MUTATIONS.
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
async function open(lang, slug, { w = 390, js = null, key = 'base' } = {}) {
  const s = await srv(key, js)
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: w < 800, isMobile: w < 800, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push(e.message))
  await pg.goto(`${s.base}/product/${slug}?lang=${lang}`, { waitUntil: 'load' })
  await pg.waitForSelector('.product-purchase-row', { timeout: 90000 })
  await pg.waitForFunction(() => document.querySelectorAll('#product-size-options [role="group"] > button').length > 0 || !document.getElementById('product-size-options'), null, { timeout: 60000 })
  await pg.waitForTimeout(900)
  return { ctx, pg, errors }
}
const addOne = async (pg) => { await pg.locator('#product-size-options [role="group"] > button:not([disabled])').first().click(); await pg.waitForTimeout(250); await pg.locator('.product-purchase-row .btn-primary').click(); await pg.waitForSelector('.sporta-u3-toast[data-open]', { timeout: 20000 }); await pg.waitForTimeout(500) }
const STOCK1 = 'cloudsoft-leggings-army-green', STOCK10 = 'sgomma-t-shirt-navy'

head('the last piece is in the bag')
for (const lang of ['en', 'ar']) {
  const { ctx, pg, errors } = await open(lang, STOCK1)
  is(await pg.locator('a[data-sporta-viewbag]').count() === 0, `${lang}: before adding there is no View bag link`)
  await addOne(pg)
  await pg.waitForSelector('.action-bar > a[data-sporta-viewbag]', { timeout: 10000 }).catch(() => {})
  const m = await pg.evaluate(() => { const a = document.querySelector('.action-bar > a[data-sporta-viewbag]'), b = document.querySelector('.action-bar > button.btn'); const r = a && a.getBoundingClientRect(), cs = a && getComputedStyle(a); return a ? { txt: a.textContent.trim(), href: a.getAttribute('href'), h: Math.round(r.height), w: Math.round(r.width), bg: cs.backgroundColor, fg: cs.color, hidden: b && getComputedStyle(b).display, kept: !!b, hAttr: b && b.hasAttribute('data-sporta-hidden') } : null })
  is(m && m.txt === (lang === 'ar' ? 'عرض الحقيبة' : 'View bag') && m.href === '/cart', `${lang}: the bar has a "${lang === 'ar' ? 'عرض الحقيبة' : 'View bag'}" link to /cart`, JSON.stringify(m))
  is(m && m.h >= 44 && m.w > 300 && m.bg === 'rgb(23, 26, 30)' && m.fg === 'rgb(255, 123, 23)', `${lang}: it is the bar's pill: 48px, full width, near-black with logo-orange words`, JSON.stringify(m))
  is(m && m.kept && m.hidden === 'none' && m.hAttr, `${lang}: the app's disabled Buy now is hidden, not removed`, JSON.stringify(m))
  await pg.locator('.action-bar > a[data-sporta-viewbag]').click()
  await pg.waitForSelector('aside.cart-drawer', { timeout: 15000 }).catch(() => {})
  is(await pg.locator('aside.cart-drawer').count() === 1 && new URL(pg.url()).pathname.startsWith('/product/'), `${lang}: it opens the bag drawer on the page (no reload), like the header icon`, pg.url())
  is(errors.length === 0, `${lang}: no page errors`, errors.join(' | '))
  await ctx.close()
}
head('a product that still has pieces')
{
  const { ctx, pg } = await open('en', STOCK10)
  await addOne(pg)
  is(await pg.locator('a[data-sporta-viewbag]').count() === 0 && await pg.locator('.action-bar > button.btn').isVisible(), 'a product with pieces left keeps its Buy now and gets no link')
  await ctx.close()
}
head('the bag is emptied')
{
  const { ctx, pg } = await open('en', STOCK1)
  await addOne(pg)
  await pg.waitForSelector('.action-bar > a[data-sporta-viewbag]', { timeout: 10000 })
  await pg.evaluate(() => { localStorage.setItem('sporta_cart', '[]') })
  await pg.reload({ waitUntil: 'load' }); await pg.waitForSelector('.product-purchase-row'); await pg.waitForTimeout(1200)
  is(await pg.locator('a[data-sporta-viewbag]').count() === 0, 'with the bag emptied the link is gone')
  await ctx.close()
}
head('mutations (each must turn the suite red)')
{
  const mut = JS.replace("      viewBag(barBtn, state === 'inbag')\n", '')
  is(mut !== JS, 'the mutation applies')
  const { ctx, pg } = await open('en', STOCK1, { js: mut, key: 'm1' })
  await addOne(pg); await pg.waitForTimeout(800)
  is(await pg.locator('.action-bar > a[data-sporta-viewbag]').count() === 0, 'without the bar call there is no link: caught')
  await ctx.close()
  const mut2 = JS.replace("if (!btn.hasAttribute('data-sporta-hidden')) btn.setAttribute('data-sporta-hidden', '')", '')
  const o2 = await open('en', STOCK1, { js: mut2, key: 'm2' })
  await addOne(o2.pg); await o2.pg.waitForTimeout(800)
  is(await o2.pg.locator('.action-bar > button.btn').isVisible(), 'without hiding, the disabled pill stays beside the link: caught')
  await o2.ctx.close()
}
await browser.close(); Object.values(servers).forEach((s) => s.server && s.server.close && s.server.close())
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
