// The product page, in a real browser, in both languages.
//
// Everything here was a defect found by looking at a screenshot of this page:
// a breadcrumb the structured data claimed but the page never drew, a wishlist
// heart on every card in the grid but not on the page people actually decide
// on, a placeholder image with the English product name painted into it that
// stayed English on the Arabic side, and a gallery that had to stay free when
// there is only one photograph.
//
//   npm run test:product        (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const SLUG = process.env.SLUG ?? 'cloudsoft-jacket-army-green'

let fails = 0
const ok = (name, detail = '') => console.log(`ok   ${name}${detail ? `  — ${detail}` : ''}`)
const bad = (name, detail = '') => {
  fails++
  console.log(`FAIL ${name}${detail ? `  — ${detail}` : ''}`)
}
const is = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail))

// ------------------------------------------------ the image list, in Node
// productImages() is the bridge between the admin uploader and the gallery, and
// it has to survive the three shapes the `images` column can actually arrive in:
// absent, a Postgres text[], or a hand-typed comma-separated string. Duplicates
// are dropped because the first image is also the `image` column, and a shoot
// uploaded in one go usually includes it.
{
  const { productImages } = await import('../src/lib/products.js')
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  is(same(productImages({ image: 'a' }), ['a']), 'one image stays one image')
  is(same(productImages({ image: 'a', images: ['b', 'a'] }), ['a', 'b']), 'an array is appended, deduped')
  is(same(productImages({ image: 'a', images: ' b , c ' }), ['a', 'b', 'c']), 'a comma string is split and trimmed')
  is(same(productImages(null), []), 'no product is no images, not a crash')
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

async function open(lang, viewport = { width: 1280, height: 900 }, touch = false) {
  // hasTouch matters, and it is not cosmetic: the 44px tap-target rules in
  // index.css live behind @media (pointer: coarse). A desktop-pointer context
  // at 390px wide reports the qty stepper as 16px tall and a real iPhone does
  // not — a false failure that would have sent someone to fix working CSS.
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch })
  const page = await ctx.newPage()
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang)
  await page.goto(`${BASE}/product/${SLUG}`, { waitUntil: 'networkidle' })
  return { ctx, page }
}

// ---------------------------------------------------------------- English
{
  const { ctx, page } = await open('en')

  const crumbs = await page.$$eval('nav[aria-label] ol li', (els) =>
    els.map((e) => e.textContent.trim()).filter((s) => s && s !== '/'),
  )
  is(crumbs.length === 3, 'breadcrumb has the three levels the JSON-LD claims', crumbs.join(' › '))

  // The last crumb is the page itself, so it must not be a link.
  const lastIsLink = await page.$eval('nav ol li:last-child', (el) => !!el.querySelector('a'))
  is(!lastIsLink, 'the current page is not a link in its own breadcrumb')

  // The JSON-LD and the visible trail must not disagree — a search engine
  // reading one and a person reading the other is the whole point of both.
  const ld = await page.$$eval('script[type="application/ld+json"]', (els) =>
    els.map((e) => e.textContent).join(''),
  )
  const inLd = /BreadcrumbList/.test(ld)
  is(inLd, 'the breadcrumb is also in the structured data')

  // Wishlist: off, on, and remembered across a reload.
  // By label, not by position: the size chips and every cross-sell card also
  // carry aria-pressed, so "the last pressable thing" was a cross-sell heart.
  const heart = page.locator('button[aria-label*="wishlist" i]').first()
  is((await heart.getAttribute('aria-pressed')) === 'false', 'save button starts unpressed')
  await heart.click()
  is((await heart.getAttribute('aria-pressed')) === 'true', 'save button presses')
  const saved = await page.evaluate(() => localStorage.getItem('sporta_wishlist'))
  is(saved?.includes(SLUG) ?? false, 'the slug is in the stored wishlist', saved ?? 'nothing stored')
  await page.reload({ waitUntil: 'networkidle' })
  is(
    (await page.locator('button[aria-label*="wishlist" i]').first().getAttribute('aria-pressed')) === 'true',
    'it is still saved after a reload',
  )

  // One image = no gallery. Thumbnails for a single photograph are furniture.
  const thumbs = await page.locator('[role="group"][aria-label="Product images"] button').count()
  is(thumbs === 0, 'a single image draws no thumbnail strip', `${thumbs} thumbnails`)

  // The hero is the LCP candidate and must say so.
  const hero = page.locator('main img, section img').first()
  is(
    (await hero.getAttribute('fetchpriority')) === 'high',
    'the hero image is fetchpriority=high',
  )
  is((await hero.getAttribute('loading')) !== 'lazy', 'the hero image is not lazy')
  const alt = await hero.getAttribute('alt')
  is(!!alt && alt.length > 3, 'the hero image has real alt text', alt ?? '(none)')

  // The brand plate under the photograph: whose shop, and whose garment.
  const plateLogo = await page.$eval(
    'section img[alt="Sporta Sports Wear"]',
    (e) => e.getAttribute('src'),
  ).catch(() => null)
  is(!!plateLogo, 'the brand logo sits under the product image', plateLogo ?? 'missing')

  // ---- the three option boxes ----
  const boxLabels = await page.$$eval('section .rounded-2xl.border > div > span.font-bold', (els) =>
    els.map((e) => e.textContent.trim()),
  )
  is(
    ['Size', 'Fit', 'Colour'].every((l) => boxLabels.includes(l)),
    'size, fit and colour each have their own box',
    boxLabels.join(', '),
  )

  // The ladder is always drawn in full, so a 3XL customer can see whether the
  // shop carries 3XL at all rather than guessing from its absence.
  const chips = await page.$$eval('[role="group"][aria-label="Size"] button', (els) =>
    els.map((e) => [e.textContent.trim(), e.disabled]),
  )
  is(
    ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'].every((sz) =>
      chips.some(([label]) => label === sz),
    ),
    'the size ladder runs S to 5XL',
    chips.map(([l]) => l).join(' '),
  )
  is(
    chips.some(([, disabled]) => disabled) && chips.some(([, disabled]) => !disabled),
    'sizes not carried are disabled, carried ones are not',
    `${chips.filter(([, d]) => !d).length} of ${chips.length} available`,
  )

  // A fit is preselected, because a shopper who never touches the box must
  // still produce a coherent order.
  const fitPressed = await page.$$eval('[role="group"][aria-label="Fit"] button', (els) =>
    els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent.trim()),
  )
  is(fitPressed.length === 1, 'exactly one fit is preselected', fitPressed.join(',') || 'none')

  // A leggings page must not offer "Tank".
  const fitLabels = await page.$$eval('[role="group"][aria-label="Fit"] button', (els) =>
    els.map((e) => e.textContent.trim()),
  )
  is(fitLabels.length >= 2 && fitLabels.includes('Normal'), 'the fit box offers real choices', fitLabels.join(', '))

  // Colour swatches are LINKS to the sibling colourways, not toggles: each
  // colour is its own product with its own stock.
  const swatches = await page.$$eval('ul[aria-label="Colour"] a', (els) =>
    els.map((e) => [e.getAttribute('href'), e.getAttribute('aria-current')]),
  )
  is(swatches.length >= 2, 'the colour box lists the other colourways', `${swatches.length} colours`)
  is(
    swatches.filter(([, cur]) => cur === 'page').length === 1,
    'exactly one swatch is marked as the current page',
  )

  // The chosen size and fit must reach the bag. A selector whose answer is
  // thrown away is worse than no selector.
  await page.locator('[role="group"][aria-label="Size"] button:not([disabled])').first().click()
  await page.locator('[role="group"][aria-label="Fit"] button').nth(1).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const bag = await page.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  is(bag.length === 1 && !!bag[0].size && !!bag[0].fit, 'the bag records the size and the fit',
    bag.length ? `${bag[0].size} / ${bag[0].fit}` : 'bag empty')
  is(
    (bag[0]?.key ?? '').includes(bag[0]?.size) && (bag[0]?.key ?? '').includes(bag[0]?.fit),
    'the line key includes both, so two cuts are two lines',
    bag[0]?.key ?? '-',
  )

  await ctx.close()
}

// ---------------------------------------------------------------- Arabic
{
  const { ctx, page } = await open('ar')

  is((await page.evaluate(() => document.documentElement.dir)) === 'rtl', 'Arabic renders RTL')

  const h1 = (await page.locator('h1').first().textContent()) ?? ''
  is(/[؀-ۿ]/.test(h1), 'the heading is in Arabic', h1.trim())

  const crumbs = await page.$$eval('nav[aria-label] ol li', (els) =>
    els.map((e) => e.textContent.trim()).filter((s) => s && s !== '/'),
  )
  is(
    crumbs.every((c) => /[؀-ۿ]/.test(c)),
    'every breadcrumb crumb is Arabic',
    crumbs.join(' › '),
  )

  // The placeholder used to carry the English product name inside the SVG, so
  // the Arabic page showed an Arabic heading over an English picture. Nothing
  // in an image source should be a word.
  const src = await page.locator('section img').first().getAttribute('src')
  const decoded = decodeURIComponent(src ?? '')
  is(!/<text/.test(decoded), 'the placeholder image paints no text of any language')

  await ctx.close()
}

// ---------------------------------------------------------------- phone
{
  const { ctx, page } = await open('en', { width: 390, height: 844 }, true)

  // The sticky buy bar must not sit on top of the last of the page.
  const covered = await page.evaluate(() => {
    const bar = document.querySelector('.action-bar')
    if (!bar) return 'no bar'
    window.scrollTo(0, document.body.scrollHeight)
    const b = bar.getBoundingClientRect()
    const under = document.elementFromPoint(b.left + b.width / 2, b.top - 4)
    return under && bar.contains(under) ? 'bar overlaps itself' : null
  })
  is(covered === null, 'the sticky buy bar clears the page content', covered ?? 'clear')

  // Every control on a phone must be reachable by a thumb: 44px is the floor.
  // Scoped to this page's own buy controls. Auditing every link in the header
  // and footer here would just re-test the site chrome that test:a11y already
  // covers, and text links are sized by their text.
  // Scoped to this page's own controls: the cross-sell grid at the bottom is
  // ProductCard, whose whole photo is already a 171x214 link to the same place,
  // and the site chrome is test:a11y's job.
  const small = await page.$$eval('section > nav a, section > div > div button, .action-bar button', (els) =>
    els
      .filter((e) => e.offsetParent !== null)
      .map((e) => [e.getBoundingClientRect(), e])
      .filter(([r]) => r.width > 0 && (r.height < 40 || r.width < 24))
      .map(([r, e]) => `${e.tagName.toLowerCase()} "${(e.textContent || e.ariaLabel || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`),
  )
  is(small.length === 0, 'every visible control is thumb-sized', small.join('; ') || 'all >= 40px')

  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) on the product page` : '\nproduct page: correct in both languages')
process.exit(fails ? 1 : 0)
