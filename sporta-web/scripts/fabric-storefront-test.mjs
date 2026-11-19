// The product page's fabric line (block "FABRIC-1119", public/sporta-features.js): "Fabric: Cotton 80%, Elastane 20%" under the
// title, drawn from the product's composition in /api/api.php?r=products. Runs the REAL block in Chromium against a fixture of the
// compiled product page's markup and a fake products API that returns the shapes dropin/php-store/api.php sends.
//
//   npm run test:fabric-storefront
//
// What is asserted:
//   0. static: markers once; no innerHTML, console, eval, storage or interval;
//   1. the line sits right after the product title, in English and in Arabic (the language and direction follow the page);
//   2. a product with a composition shows it with its percentages; without percentages, the materials only;
//   3. a product that states no fabric shows no line, and nothing is drawn on another page;
//   4. one request for the product list per page, however many times the page changes; the line is drawn once;
//   5. MUTATION: the line placed elsewhere, or drawn for a product with no fabric, turns a check red.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== FABRIC-1119 (')
const END = ADDON.indexOf('/* ===== FABRIC-1119 - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
function is(ok, msg, detail = '') {
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PRODUCTS = [
  { slug: 'hoodie-b', name_en: 'Hoodie B', name_ar: 'هودي ب', fabric: [{ material: 'cotton', percent: 80 }, { material: 'elastane', percent: 20 }] },
  { slug: 'legacy-d', name_en: 'Legacy D', name_ar: 'قديم د', fabric: [{ material: 'wool', percent: null }, { material: 'nylon', percent: null }] },
  { slug: 'tee-a', name_en: 'Tee A', name_ar: 'تي شيرت أ', fabric: null }
]
function productPage(slug) {
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"></head><body><main>
    <section class="catalog-product-page"><div class="catalog-product-summary">
      <p class="catalog-eyebrow">Brand</p><h1>${slug}</h1><p class="price">KWD 10.000</p>
    </div></section></main></body></html>`
}

async function openPage(browser, { path = '/product/hoodie-b', lang = 'en', block = BLOCK } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  const page = await ctx.newPage()
  let productReads = 0
  // The page route first and the API route second: Playwright matches the LAST registered route first, so the API answers its own calls.
  await page.route('https://shop.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: productPage(path.split('/').pop()) }))
  await page.route('https://shop.test/api/api.php**', async (route) => {
    const r = new URL(route.request().url()).searchParams.get('r')
    if (r === 'products') { productReads++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PRODUCTS) }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.goto('https://shop.test' + path)
  await page.evaluate((l) => {
    document.documentElement.setAttribute('lang', l)
    document.documentElement.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr')
  }, lang)
  await page.addScriptTag({ content: block })
  await page.waitForTimeout(500)
  return { ctx, page, reads: () => productReads, close: () => ctx.close() }
}
const lineText = (page) => page.locator('[data-sporta-fabric]').allTextContents()

async function scenarioStatic() {
  head('0. static')
  is(ADDON.split('/* ===== FABRIC-1119 (').length === 2, 'the block begins once')
  is(ADDON.split('/* ===== FABRIC-1119 - end').length === 2, 'the block ends once')
  is(BLOCK.length > 2000, 'the block was found and sliced', String(BLOCK.length))
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'console.', 'eval(', 'document.write', 'localStorage', 'sessionStorage', 'setInterval']) {
    is(CODE.indexOf(bad) < 0, `no ${bad}`)
  }
}

async function scenarioPlacement(browser) {
  head('1. placement and language')
  const en = await openPage(browser, { path: '/product/hoodie-b', lang: 'en' })
  const after = await en.page.evaluate(() => {
    const n = document.querySelector('[data-sporta-fabric]')
    return n && n.previousElementSibling && n.previousElementSibling.tagName === 'H1'
  })
  is(after === true, 'the line sits right after the product title')
  is((await lineText(en.page))[0] === 'Fabric: Cotton 80%, Elastane 20%', 'English: materials with their percentages', (await lineText(en.page))[0])
  await en.close()

  const ar = await openPage(browser, { path: '/product/hoodie-b', lang: 'ar' })
  const arText = (await lineText(ar.page))[0] || ''
  is(arText.indexOf('الخامة') === 0 && arText.indexOf('80%') >= 0, 'Arabic: the label and the percentages', arText)
  is(await ar.page.evaluate(() => document.querySelector('[data-sporta-fabric]').getAttribute('dir')) === 'rtl', 'Arabic: the line runs right to left')
  await ar.close()
}

async function scenarioMaterialsOnly(browser) {
  head('2. materials without percentages')
  const p = await openPage(browser, { path: '/product/legacy-d', lang: 'en' })
  is((await lineText(p.page))[0] === 'Fabric: Wool, Nylon', 'materials only read as a list with no percentages', (await lineText(p.page))[0])
  await p.close()
}

async function scenarioNoFabric(browser) {
  head('3. no fabric stated, and other pages')
  const none = await openPage(browser, { path: '/product/tee-a', lang: 'en' })
  is((await lineText(none.page)).length === 0, 'a product that states no fabric shows no line')
  await none.close()
  const shop = await openPage(browser, { path: '/shop', lang: 'en' })
  is((await lineText(shop.page)).length === 0, 'nothing is drawn on another page')
  await shop.close()
}

async function scenarioOnce(browser) {
  head('4. one request, drawn once')
  const p = await openPage(browser, { path: '/product/hoodie-b', lang: 'en' })
  // the page changes many times: each change re-checks, but the list is read once and the line is not drawn twice
  for (let i = 0; i < 5; i++) {
    await p.page.evaluate((i) => { const d = document.createElement('i'); d.textContent = String(i); document.querySelector('.catalog-product-summary').appendChild(d) }, i)
    await sleep(120)
  }
  is(p.reads() === 1, 'the product list is read once per page', String(p.reads()))
  is((await lineText(p.page)).length === 1, 'the line is drawn once, however many times the page changed', String((await lineText(p.page)).length))
  await p.close()
}

// ---------------------------------------------------------------- mutation
async function scenarioPlacementAndEmpty(browser, block) {
  const p = await openPage(browser, { path: '/product/hoodie-b', lang: 'en', block })
  const after = await p.page.evaluate(() => {
    const n = document.querySelector('[data-sporta-fabric]')
    return n && n.previousElementSibling && n.previousElementSibling.tagName === 'H1'
  })
  const text = (await lineText(p.page))[0]
  await p.close()
  const q = await openPage(browser, { path: '/product/tee-a', lang: 'en', block })
  const none = (await lineText(q.page)).length
  await q.close()
  is(after === true && text === 'Fabric: Cotton 80%, Elastane 20%' && none === 0, 'placement and the empty case hold (mutant run)', `after=${after} none=${none}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
await scenarioStatic()
await scenarioPlacement(browser)
await scenarioMaterialsOnly(browser)
await scenarioNoFabric(browser)
await scenarioOnce(browser)

head('5. mutation (each cut-out must fail)')
const MUTANTS = [
  { name: 'line placed at the end of the body, not after the title', apply: (s) => s.replace('t2.parentNode.insertBefore(node, t2.nextSibling)', 'document.body.appendChild(node)') },
  { name: 'line drawn even when the product states no fabric', apply: (s) => s.replace("if (!text) { if (node) node.remove(); return }", "if (!text) { text = 'Fabric'; }") }
]
for (const m of MUTANTS) {
  const mutated = m.apply(BLOCK)
  if (mutated === BLOCK) { is(false, `mutant applied: ${m.name}`, 'the source text was not found'); continue }
  const passBefore = pass, failBefore = fail
  const quiet = console.log
  console.log = () => {}
  let thrown = 0
  try { await scenarioPlacementAndEmpty(browser, mutated) } catch (e) { thrown++ }
  console.log = quiet
  const newFails = fail - failBefore
  pass = passBefore; fail = failBefore
  is(newFails > 0 || thrown > 0, `mutation red: ${m.name}`, `${newFails} failing check(s)`)
}

await browser.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
