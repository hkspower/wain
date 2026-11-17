// META-1117: the search description and the heading of the pages that need them, on the LIVE (compiled) storefront.
//
//   1. The add-on block (public/sporta-features.js, between its markers) is loaded ON ITS OWN into a page the test
//      serves: a product page with a short description becomes its name and the shop's line; a long description is
//      left alone; /track gets its full sentence; a category page gets its name as heading and title; /shop without a
//      category, a noindex page and an unknown category are untouched.
//   2. The compiled app writes its own text after the page is up: the add-on writes it again (it watches the page).
//   3. The copy in the add-on is the copy in src/i18n/translations.js and src/lib/products.js (drift guard).
//   4. Mutation: with the block cut out, the short description stays, and the check can tell.
//
//   npm run test:meta-1117
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const feat = read('public/sporta-features.js')
const START = feat.indexOf('/* ===== META-1117')
const END = feat.indexOf('/* ===== META-1117 - end ===== */')
is(START > 0 && END > START, 'the META-1117 block is in the add-on, between its markers')
const BLOCK = feat.slice(START, END + '/* ===== META-1117 - end ===== */'.length)

const EN_FALLBACK = 'Sporta sportswear in Kuwait. Same-day delivery, KNET and cash on delivery.'
const AR_FALLBACK = 'من سبورتا الكويت، توصيل في نفس اليوم، كي نت ودفع عند الاستلام.'
const EN_TRACK = 'Track a Sporta order with your order number. Payment and delivery status in real time.'
const AR_TRACK = 'تتبّع طلبك من سبورتا برقم الطلب. حالة الدفع والتوصيل لحظة بلحظة.'
const LONG = 'Premium sportswear in Kuwait. Activewear, gym clothing, hoodies and accessories, same-day delivery, KNET and cash on delivery.'

// ---- 3. drift guard: the add-on's copy is the copy the source ships
{
  const tr = read('src/i18n/translations.js')
  const pr = read('src/lib/products.js')
  is(tr.includes(`productFallback: '${EN_FALLBACK}'`), 'drift: the English product line matches seo.productFallback')
  is(tr.includes(`productFallback: '${AR_FALLBACK}'`), 'drift: the Arabic product line matches seo.productFallback')
  is(tr.includes(`track: '${EN_TRACK}'`), 'drift: the English track description matches seo.track')
  is(tr.includes(`track: '${AR_TRACK}'`), 'drift: the Arabic track description matches seo.track')
  // the add-on carries its own copy: the same strings, checked against the add-on's text too
  for (const s of [EN_FALLBACK, AR_FALLBACK, EN_TRACK, AR_TRACK]) {
    is(BLOCK.includes(s), `drift: the add-on carries the source text "${s.slice(0, 28)}…"`)
  }
  const cats = { women: ['Women', 'نساء'], men: ['Men', 'رجال'], outerwear: ['Hoodies & Jackets', 'هوديز وجواكيت'], accessories: ['Accessories', 'إكسسوارات'] }
  for (const [id, [en, ar]] of Object.entries(cats)) {
    is(pr.includes(`{ id: '${id}', name: { en: '${en}', ar: '${ar}' } }`), `drift: category ${id} is named the same as the shop's list`)
    is(BLOCK.includes(`${id}: '${en}'`) && BLOCK.includes(`${id}: '${ar}'`), `drift: the add-on names category ${id} the same way`)
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

const page_ = (lang, { desc = '', h1 = '', robots, title = 'Sporta' } = {}) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>` +
  `<meta name="description" content="${desc}"><meta property="og:description" content="${desc}">` +
  `<meta name="twitter:description" content="${desc}">` +
  (robots ? `<meta name="robots" content="${robots}">` : '') +
  `</head><body><h1>${h1}</h1></body></html>`

async function run({ url, html, block = BLOCK, after }) {
  const page = await browser.newPage()
  await page.route('http://sporta.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto(url, { waitUntil: 'load' })
  if (block) await page.addScriptTag({ content: block })
  await page.waitForTimeout(120)
  if (after) { await page.evaluate(after); await page.waitForTimeout(150) }
  const out = await page.evaluate(() => ({
    desc: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    og: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? null,
    tw: document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? null,
    h1: document.querySelector('h1')?.textContent ?? null,
    title: document.title,
  }))
  await page.close()
  return out
}

// ---- 1. the cases
{
  const name = 'حقيبة ظهر كالياري كالتشو'
  const r = await run({ url: 'http://sporta.test/product/cagliari-calcio-backpack?lang=ar',
    html: page_('ar', { desc: 'حقيبة ظهر', h1: name }) })
  is(r.desc === `${name} — ${AR_FALLBACK}`, 'product (ar): a short description becomes the name and the shop line', r.desc)
  is(r.og === r.desc && r.tw === r.desc, 'product (ar): the Open Graph and Twitter descriptions carry the same text')
  is(r.h1 === name, 'product (ar): the heading is left as the product name')
}
{
  const r = await run({ url: 'http://sporta.test/product/cagliari-calcio-backpack?lang=en', html: page_('en', { desc: 'Backpack', h1: 'Cagliari Calcio Backpack' }) })
  is(r.desc === `Cagliari Calcio Backpack — ${EN_FALLBACK}`, 'product (en): the English form, same rule', r.desc)
  is(r.desc.length >= 70, 'product (en): the result is at least 70 characters')
}
{
  const r = await run({ url: 'http://sporta.test/product/long-one', html: page_('en', { desc: LONG, h1: 'Long one' }) })
  is(r.desc === LONG, 'product: a description that is already long is left as it is')
}
{
  const r = await run({ url: 'http://sporta.test/product/gone', html: page_('en', { desc: 'Backpack', h1: 'Not found', robots: 'noindex, follow' }) })
  is(r.desc === 'Backpack', 'product: a noindex page (not found) is not rewritten')
}
{
  const r = await run({ url: 'http://sporta.test/track', html: page_('ar', { desc: 'تتبع الطلب', h1: 'تتبع طلبك', title: 'تتبع طلبك — سبورتا' }) })
  is(r.desc === AR_TRACK, '/track (ar): the full sentence replaces the one-line instruction', r.desc)
}
{
  const r = await run({ url: 'http://sporta.test/track', html: page_('en', { desc: 'Enter the order number from your confirmation.', h1: 'Track your order' }) })
  is(r.desc === EN_TRACK, '/track (en): the English sentence', r.desc)
}
{
  const r = await run({ url: 'http://sporta.test/shop?category=men', html: page_('en', { desc: 'Shop sportswear in Kuwait', h1: 'Shop sportswear in Kuwait', title: 'Shop — Sporta' }) })
  is(r.h1 === 'Men', 'category (en): /shop?category=men has the heading Men', r.h1)
  is(r.title === 'Men — Sporta', 'category (en): and the title Men — Sporta', r.title)
}
{
  const r = await run({ url: 'http://sporta.test/shop?category=outerwear', html: page_('ar', { desc: 'تسوق', h1: 'تسوق الملابس الرياضية في الكويت', title: 'تسوق — سبورتا' }) })
  is(r.h1 === 'هوديز وجواكيت', 'category (ar): /shop?category=outerwear has the Arabic name as heading', r.h1)
  is(r.title === 'هوديز وجواكيت — سبورتا', 'category (ar): and the Arabic title', r.title)
}
{
  const r = await run({ url: 'http://sporta.test/shop', html: page_('en', { h1: 'Shop sportswear in Kuwait', title: 'Shop — Sporta' }) })
  is(r.h1 === 'Shop sportswear in Kuwait' && r.title === 'Shop — Sporta', '/shop with no category keeps the shop heading and title')
}
{
  const r = await run({ url: 'http://sporta.test/shop?category=nonsense', html: page_('en', { h1: 'Shop sportswear in Kuwait', title: 'Shop — Sporta' }) })
  is(r.h1 === 'Shop sportswear in Kuwait', '/shop with an unknown category keeps the shop heading')
}
// ---- 2. the app writes its own text after the page is up; the add-on writes it again
{
  const r = await run({ url: 'http://sporta.test/shop?category=women', html: page_('en', { h1: 'Shop sportswear in Kuwait', title: 'Shop — Sporta' }),
    after: () => { document.querySelector('h1').textContent = 'Shop sportswear in Kuwait' } })
  is(r.h1 === 'Women', 'the app re-renders the shop heading: the add-on puts the category name back', r.h1)
}
{
  const r = await run({ url: 'http://sporta.test/product/cagliari-calcio-backpack?lang=en', html: page_('en', { desc: 'Backpack', h1: 'Cagliari Calcio Backpack' }),
    after: () => {
      document.querySelector('meta[name="description"]').setAttribute('content', 'Backpack')
      document.querySelector('h1').textContent = 'Cagliari Calcio Backpack'
    } })
  is(r.desc === `Cagliari Calcio Backpack — ${EN_FALLBACK}`, 'the app writes a short description after load: the add-on writes its text again', r.desc)
}
// ---- 4. mutation: without the block the short description stays
{
  const r = await run({ url: 'http://sporta.test/product/cagliari-calcio-backpack?lang=en', html: page_('en', { desc: 'Backpack', h1: 'Cagliari Calcio Backpack' }), block: '' })
  is(r.desc === 'Backpack', 'MUTATION: without the block the short description stays, so the check above can tell')
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
