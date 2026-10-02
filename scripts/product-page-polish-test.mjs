/**
 * Product page polish: Product data in the server HTML, a real meta description, one Product after render,
 * no echoed description, a usable quantity button, a centred footer. node scripts/product-page-polish-test.mjs
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).trim()
const SLUG = 'cheetahs-rugby-t-shirt'
const saved = sql(`select quote(name_en), quote(desc_en), quote(name_ar) from products where slug='${SLUG}'`).split('\t')
const restore = () => sql(`update products set name_en=${saved[0]}, desc_en=${saved[1]}, name_ar=${saved[2]} where slug='${SLUG}'`)
const stockBefore = sql(`select group_concat(sku,':',stock) from product_variants where slug='${SLUG}'`)
const restoreStock = () => stockBefore.split(',').forEach((x) => { const [sku, n] = x.split(':'); sql(`update product_variants set stock=${n} where sku='${sku}'`) })
const html = async (lang) => (await fetch(`${BASE}/product/${SLUG}?lang=${lang}`)).text()
const ld = (h) => { const m = h.match(/data-seo-ssr="product">(.*?)<\/script>/s); try { return m ? JSON.parse(m[1]) : null } catch { return 'BAD' } }
const meta = (h) => (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  // ---- the server HTML ----
  const en = await html('en'), ar = await html('ar')
  const j = ld(en)
  check(j && j !== 'BAD' && j['@type'] === 'Product' && j.name && j.offers && j.offers.price === '8.000' && j.offers.priceCurrency === 'KWD', 'the server HTML carries Product data with price and currency', j && j.offers && JSON.stringify(j.offers).slice(0, 60))
  check(j.offers.availability.endsWith('InStock') && j.sku === SLUG && /product_image/.test(j.image), 'in stock, a SKU, and the product photograph as the image')
  check(meta(en).includes('KD 8.000') && meta(en).length > 60 && meta(en) !== 'Cheetahs Rugby T-Shirt.', 'an echo-only description gets a real meta description (price, sizes, returns)', meta(en))
  check(/د\.ك/.test(meta(ar)) && /[؀-ۿ]/.test(meta(ar)), 'and the Arabic page gets it in Arabic', meta(ar).slice(0, 60))
  check(ld(ar) && ld(ar).name !== j.name && ld(ar).alternateName === j.name, 'the Arabic page is named in Arabic, with the English name as alternateName')
  // an owner-written description wins untouched
  sql(`update products set desc_en='A heavyweight cotton rugby tee cut for training, with a reinforced collar and a regular fit that holds its shape wash after wash.' where slug='${SLUG}'`)
  check(meta(await html('en')).startsWith('A heavyweight cotton rugby tee'), 'an owner-written description is never replaced (server HTML)')
  restore()
  // out of stock
  sql(`update product_variants set stock=0 where slug='${SLUG}'`)
  check(ld(await html('en')).offers.availability.endsWith('OutOfStock'), 'every size at 0 stock says OutOfStock')
  restoreStock()
  // injection: a name that tries to close the tag
  sql(`update products set name_en='Evil </script><script>window.__x=1</script> & "Tee"' where slug='${SLUG}'`)
  const evil = await html('en'); const ej = ld(evil)
  check(ej && ej !== 'BAD' && ej.name.includes('</script>') && !/<\/script><script>window\.__x/.test(evil.split('data-seo-ssr')[1].split('</head>')[0]), 'a product name containing </script> cannot close the tag (it parses, and stays data)')
  restore()

  // ---- the rendered page ----
  for (const [name, vp, touch] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
    await p.goto(`${BASE}/product/${SLUG}?lang=en`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2200)
    const n = await p.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].filter((s) => /"@type":\s*"Product"/.test(s.textContent)).length)
    check(n === 1, `${name}: one Product after render, not two (server copy dropped once the app writes its own)`, String(n))
    const echo = await p.evaluate(() => [...document.querySelectorAll('main p')].filter((e) => /^Cheetahs Rugby T-Shirt\.?$/.test(e.textContent.trim())).map((e) => !!e.offsetParent))
    check(echo.every((v) => v === false), `${name}: the name is not repeated as the description`, JSON.stringify(echo))
    if (name === 'desktop') {
      const q = await p.evaluate(() => [...document.querySelectorAll('button[aria-label*="quantity"]')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) }))
      check(q.length === 2 && q.every((s) => parseInt(s.split('x')[1]) >= 36 && parseInt(s) >= 36), 'desktop: the quantity buttons are 36px+ each way (were 50x16)', q.join(' '))
      const f = await p.evaluate(() => { const g = [...document.querySelectorAll('footer.app-footer div.grid')].find((e) => /Information/.test(e.textContent)); const r = g.getBoundingClientRect(); return { w: r.width, l: r.left, ta: getComputedStyle(g).textAlign } })
      check(f.w <= 640 && Math.abs(f.l - (1280 - f.w) / 2) < 2 && f.ta === 'center', 'desktop: the footer link columns sit centred under the logo, not at the page edges', JSON.stringify(f))
    }
    await p.context().close()
  }
  // a product WITH its own description still shows it (a seeded one whose text is not just its name)
  const p2 = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await p2.goto(`${BASE}/product/cagliari-calcio-backpack-navy?lang=en`, { waitUntil: 'networkidle' }); await p2.waitForTimeout(2200)
  check(await p2.evaluate(() => [...document.querySelectorAll('main p')].some((e) => /backpack in navy/i.test(e.textContent) && !!e.offsetParent)), 'a product with its own description still shows it')
} finally { restore(); restoreStock(); await b.close() }
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
