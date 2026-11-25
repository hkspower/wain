// PRODUCT BRAND-1118 (owner, 2026-11-18: "make brand layout at product dont use sporta as product brand"): the product page on the REAL compiled client
// with the live add-ons (needs the capture of the live storefront like test:add-to-cart-ux; skipped with a message otherwise).
//   npm run test:product-brand-1118
// Asserted: a product with no brand tag shows no brand line above the title (the build's "SPORTA / MADE FOR YOUR NEXT MOVE" is hidden), the shop's logo does not
// open the brand plate, there is no brand mark on the photo and the structured data carries no brand (the build wrote "SPORTA"); a product tagged with a real
// brand shows that brand above the title (Arabic name in Arabic), the plate's maker leads (no shop logo), the mark is on the photo and the structured data
// names the brand; a product tagged with the shop's own label "sporta" is treated as having no brand; nothing shifts while the page appears; MUTATIONS.
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
const BRANDS = { gymshark: { brand_slug: 'gymshark', brand_name_en: 'Gymshark', brand_name_ar: 'جيمشارك', brand_has_logo: 0, brand_logo_v: '' }, sporta: { brand_slug: 'sporta', brand_name_en: 'Sporta', brand_name_ar: 'سبورتا', brand_has_logo: 0, brand_logo_v: '' } }
async function open(lang, brand, { js = null, key = 'base', w = 390 } = {}) {
  const s = await srv(key, js)
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: w < 800, isMobile: w < 800 })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} window.__cls = 0; try { new PerformanceObserver((li) => { for (const e of li.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {} }, lang)
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push(e.message))
  await pg.route('**/api/api.php?r=products', async (route) => { const res = await route.fetch(); const rows = await res.json(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.map((r) => (brand && r.slug === SLUG ? { ...r, ...BRANDS[brand] } : r))) }) })
  await pg.route('**/api/api.php?r=brands', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(brand ? [{ slug: BRANDS[brand].brand_slug, name_en: BRANDS[brand].brand_name_en, name_ar: BRANDS[brand].brand_name_ar, has_logo: 0, logo_v: '', products: 3 }] : []) }))
  await pg.goto(`${s.base}/product/${SLUG}?lang=${lang}`, { waitUntil: 'load' })
  await pg.waitForSelector('.campaign-brand-plate', { timeout: 90000 })
  await pg.waitForTimeout(1800)
  return { ctx, pg, errors }
}
const state = (pg) => pg.evaluate(() => {
  const eb = document.querySelector('.catalog-product-summary > .catalog-eyebrow:not([data-sporta-brandline])'), line = document.querySelector('[data-sporta-brandline]')
  const owner = document.querySelector('.campaign-brand-plate__owner'), maker = document.querySelector('.campaign-brand-plate__maker')
  const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent) } catch (e) { return null } }).filter(Boolean)
  const prod = ld.flatMap((x) => (Array.isArray(x) ? x : x['@graph'] || [x])).find((x) => x && x['@type'] === 'Product')
  const nm = maker && maker.querySelector('.campaign-brand-plate__maker-name, .campaign-brand-plate__maker-logo')
  return { eb: eb ? getComputedStyle(eb).visibility : 'none-node', line: line ? line.textContent : null, lineShown: line ? getComputedStyle(line).display : null, owner: owner ? getComputedStyle(owner).display : null, maker: maker ? getComputedStyle(maker).display : null, makerFont: nm ? parseFloat(getComputedStyle(nm).fontSize) : null,
    mark: document.querySelectorAll('[data-sporta-brandmark]').length, brand: prod ? (prod.brand ? (prod.brand.name || prod.brand) : null) : 'no-product-ld', cls: window.__cls, plate: document.querySelector('.campaign-brand-plate').innerText.replace(/\s+/g, ' ').trim() }
})

head('a product with no brand tag')
{
  const { ctx, pg, errors } = await open('en', null)
  const st = await state(pg)
  is(st.line === null && st.eb === 'hidden', 'no brand line above the title, and the build\'s "SPORTA / MADE FOR YOUR NEXT MOVE" is hidden (its box stays, so nothing moves)', JSON.stringify(st))
  is(st.owner === 'none', 'the shop\'s logo does not open the brand plate')
  is(st.mark === 0, 'no brand mark on the photo')
  is(st.brand === null, 'the structured data carries no brand (the build wrote "SPORTA")', JSON.stringify(st.brand))
  is(/100% original/.test(st.plate) && !/^SPORTA/i.test(st.plate), 'the plate keeps its plain note, now "100% original, straight from the brand" (PLATE NOTE 1124)', st.plate)
  is(st.cls < 0.02, 'nothing shifts while the page appears (CLS ' + st.cls.toFixed(4) + ')')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  await ctx.close()
}
head('a product with a real brand')
for (const lang of ['en', 'ar']) {
  const { ctx, pg, errors } = await open(lang, 'gymshark')
  const st = await state(pg), want = lang === 'ar' ? 'جيمشارك' : 'Gymshark'
  is(st.line === want && st.lineShown === 'block' && st.eb === 'hidden', `${lang}: the brand "${want}" is named above the title, the build's line is hidden`, JSON.stringify(st))
  is(st.owner === 'none' && st.maker !== 'none' && /Gymshark|جيمشارك/.test(st.plate), `${lang}: the plate leads with the maker and carries no shop logo`, JSON.stringify(st))
  is(st.mark === 1, `${lang}: the brand mark is on the photo`)
  is(st.brand === want, `${lang}: the structured data names the brand`, JSON.stringify(st.brand))
  is(st.cls < 0.02, `${lang}: nothing shifts (CLS ${st.cls.toFixed(4)})`)
  is(errors.length === 0, `${lang}: no page errors`, errors.join(' | '))
  await ctx.close()
}
head('a product tagged with the shop\'s own label')
{
  const { ctx, pg } = await open('en', 'sporta')
  const st = await state(pg)
  is(st.line === null && st.maker === 'none' && st.mark === 0 && st.brand === null, 'tagged "sporta": no brand line, no maker, no mark, no structured brand', JSON.stringify(st))
  await ctx.close()
}
head('mutations (each must turn the suite red)')
{
  const m1 = JS.replace("if (/^sporta$/i.test(String(bn || '').trim())) {", "if (false) {")
  is(m1 !== JS, 'mutation 1 applies')
  const o = await open('en', null, { js: m1, key: 'm1' }); const st = await state(o.pg)
  is(st.brand !== null, 'without the structured-data fix the page declares brand SPORTA again: caught', JSON.stringify(st.brand)); await o.ctx.close()
  const m2 = JS.replace("var name = makerName(maker), own = !!name && OWN.test(name), real = !!name && !own", "var name = makerName(maker), own = false, real = !!name")
  const o2 = await open('en', 'sporta', { js: m2, key: 'm2' }); const st2 = await state(o2.pg)
  is(st2.line !== null, 'without the own-label rule the shop is named as the brand: caught', JSON.stringify(st2.line)); await o2.ctx.close()
  const m3 = JS.replace("if (!eb.hasAttribute('data-sporta-eyebrow')) eb.setAttribute('data-sporta-eyebrow', '')", '')
  const o3 = await open('en', null, { js: m3, key: 'm3' }); const st3 = await state(o3.pg)
  is(st3.eb !== 'hidden', 'without hiding the build\'s line "SPORTA / MADE FOR YOUR NEXT MOVE" shows again: caught', st3.eb); await o3.ctx.close()
}
await browser.close(); Object.values(servers).forEach((s) => s.server && s.server.close && s.server.close())
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
