// The storefront's structured data (schema.org JSON-LD) makes only claims the shop can keep.
//   1. The pure builders (src/lib/jsonld.js, the code the app ships): no InStock for a product whose stock is not known,
//      no availability in the shop list at all, a 14-day return policy, a real future priceValidUntil.
//   2. The store facts (index.html) and the legacy generator: no hard-coded priceRange, no paymentAccepted list, and no
//      InStock in the generated ItemList.
//   3. The live add-on (public/sporta-features.js, JSONLD-1117) on a page that carries the old claims: it removes an
//      InStock availability and the two drifting store facts, keeps an OutOfStock, and fixes a script the app adds later.
//      The mutation cuts that section out and must leave the claims in place.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { productJsonLd, itemListJsonLd, graph } from '../src/lib/jsonld.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const hasKey = (o, key) => JSON.stringify(o).includes(`"${key}"`)

const P = { slug: 'vanquish-tee-white', name: { en: 'Vanquish Tee — White', ar: 'تيشيرت فانكويش — أبيض' }, desc: { en: 'Tee', ar: 'تيشيرت' }, price: 8.5, category: 'men', image: '/images/products/vanquish-tee-white.jpg' }
const Q = { slug: 'cap', name: { en: 'Sporta Cap', ar: 'كاب سبورتا' }, price: 4 }

// ---- 1. the builders -----------------------------------------------------------------------------------------------
{
  const unknown = productJsonLd(P, 'en')
  is(!hasKey(unknown.offers, 'availability'), 'a product whose stock is unknown states no availability (it used to say InStock)')
  const inStock = productJsonLd(P, 'en', { inStock: true })
  is(inStock.offers.availability === 'https://schema.org/InStock', 'a product known to be in stock says InStock')
  const sold = productJsonLd(P, 'en', { inStock: false })
  is(sold.offers.availability === 'https://schema.org/OutOfStock', 'a product known to be sold out says OutOfStock')
  const list = itemListJsonLd([P, Q], 'en')
  is(!hasKey(list, 'availability'), 'the shop list states no availability for any product (it used to say InStock for every one)')
  is(list.numberOfItems === 2 && list.itemListElement.length === 2, 'the shop list still carries every product, in order')
  is(list.itemListElement[0].item.offers.price === '8.500' && list.itemListElement[1].item.offers.price === '4.000', 'list prices keep three decimals (KWD)')
  const until = new Date(productJsonLd(P, 'en').offers.priceValidUntil)
  const now = Date.now()
  is(until.getTime() > now && until.getTime() < now + 2 * 366 * 86400000, 'priceValidUntil is a date about a year ahead, not in the past')
  const pol = productJsonLd(P, 'en').offers.hasMerchantReturnPolicy
  is(pol.merchantReturnDays === 14, 'the return policy in the structured data is the 14 days /returns states')
  is(productJsonLd(P, 'en').brand.name === 'Vanquish' && productJsonLd(Q, 'en').brand.name === 'SPORTA', 'brand comes from the product name; the house label otherwise')
  const g = graph({ '@type': 'A' }, null, { '@type': 'B' })
  is(g['@context'] === 'https://schema.org' && g['@graph'].length === 2, 'graph() drops empty nodes and sets the schema.org context')
}

// ---- 2. the store facts and the generator -----------------------------------------------------------------------
{
  const html = read('index.html')
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  const data = m ? JSON.parse(m[1]) : null
  const store = data && data['@graph'].find((n) => n['@type'] === 'OnlineStore')
  is(!!store, 'index.html carries one OnlineStore block, and its JSON parses')
  is(store && !('priceRange' in store), 'OnlineStore has no hard-coded priceRange (it drifts with the catalogue)')
  is(store && !('paymentAccepted' in store), 'OnlineStore has no paymentAccepted list (it drifts with the payment settings)')
  const gen = read('scripts/generate-seo.mjs')
  const block = gen.slice(gen.indexOf("'@type': 'ItemList'"), gen.indexOf("const block = `<!-- seo:itemlist -->"))
  is(block.length > 100 && !block.includes("availability: 'https://schema.org/InStock'"), 'the generated ItemList states no InStock availability')
  const src = read('src/lib/jsonld.js')
  is((src.match(/'https:\/\/schema\.org\/InStock'/g) || []).length === 1, 'jsonld.js names InStock once: in the branch that needs a known stock figure')
}

// ---- 3. the live add-on, on a page that carries the old claims -----------------------------------------------------
const OLD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'OnlineStore', name: 'Sporta', priceRange: 'KWD 3.500 - KWD 24.000', paymentAccepted: 'KNET, Visa, Mastercard' },
  { '@type': 'ItemList', name: 'Sporta catalog', itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Product', name: 'A', offers: { '@type': 'Offer', price: '8.500', availability: 'https://schema.org/InStock' } } }] },
  { '@type': 'Product', name: 'B', offers: { '@type': 'Offer', price: '4.000', availability: 'https://schema.org/OutOfStock' } },
  { '@type': 'Product', name: 'C', offers: { '@type': 'Offer', price: '5.000', availability: 'https://schema.org/InStock' } },
] })}</script></head><body><p>x</p></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function runPage(addOn) {
  const page = await browser.newPage()
  await page.setContent(OLD, { waitUntil: 'load' })
  if (addOn) await page.addScriptTag({ path: join(ROOT, 'public/sporta-features.js') })
  await page.waitForTimeout(150)
  const docs = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)))
  // a script the app writes into <head> after the page is up
  await page.evaluate(() => {
    const s = document.createElement('script'); s.type = 'application/ld+json'; s.dataset.route = 'true'
    s.textContent = JSON.stringify({ '@type': 'Product', name: 'D', offers: { '@type': 'Offer', price: '6.000', availability: 'https://schema.org/InStock' } })
    document.head.appendChild(s)
  })
  await page.waitForTimeout(150)
  const late = await page.evaluate(() => { const s = document.querySelector('script[data-route]'); return JSON.parse(s.textContent) })
  await page.close()
  return { docs, late }
}

{
  const { docs, late } = await runPage(true)
  const flat = docs.flatMap((d) => d['@graph'])
  const store = flat.find((n) => n['@type'] === 'OnlineStore')
  is(store && !('priceRange' in store) && !('paymentAccepted' in store), 'live: the page drops priceRange and paymentAccepted from its store block', JSON.stringify(store))
  is(store && store.name === 'Sporta', 'live: the store block keeps its name and everything else')
  const itemOffer = flat.find((n) => n['@type'] === 'ItemList').itemListElement[0].item.offers
  is(itemOffer && !('availability' in itemOffer) && itemOffer.price === '8.500', 'live: an InStock claim in the shop list is removed, the price kept', JSON.stringify(itemOffer))
  const b = flat.find((n) => n.name === 'B').offers
  is(b.availability === 'https://schema.org/OutOfStock', 'live: an OutOfStock claim is kept (the shop writes it only when it knows)')
  const c = flat.find((n) => n.name === 'C').offers
  is(!('availability' in c) && c.price === '5.000', 'live: an InStock product claim is removed, the price kept')
  is(late && !('availability' in late.offers) && late.offers.price === '6.000', 'live: a structured-data script added to <head> later is fixed as it arrives')
}

// Mutation: the same page with the JSONLD-1117 section cut out of the add-on must still carry the old claims.
{
  const feat = read('public/sporta-features.js')
  const a = feat.indexOf('/* ===== JSONLD-1117'), b = feat.indexOf('/* ===== JSONLD-1117 - end')
  is(a > 0 && b > a, 'mutation set up: the JSONLD-1117 section is found in the add-on')
  const cut = feat.slice(0, a) + feat.slice(b)
  const tmp = join(ROOT, 'scripts', '.json-ld-cut.tmp.js')
  const { writeFileSync, unlinkSync } = await import('node:fs')
  writeFileSync(tmp, cut)
  try {
    const page = await browser.newPage()
    await page.setContent(OLD, { waitUntil: 'load' })
    await page.addScriptTag({ path: tmp })
    await page.waitForTimeout(150)
    const docs = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)))
    await page.close()
    const store = docs.flatMap((d) => d['@graph']).find((n) => n['@type'] === 'OnlineStore')
    is(store && 'priceRange' in store, 'MUTATION: without the section the old priceRange stays on the page, and the check can tell')
  } finally { unlinkSync(tmp) }
}
await browser.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
