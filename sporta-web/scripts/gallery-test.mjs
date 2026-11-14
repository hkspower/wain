// The product gallery: one photograph stays free; several are a grid on a desktop and a swipe-through carousel on a phone;
// every photograph opens full screen; the brand plate names the brand.
//
// THREE THINGS THIS SUITE EXISTS TO HOLD.
//
// One, the SINGLE-IMAGE case stays free. One frame, and no grid, no carousel, no counter, no thumbnails: the catalogue is
// almost entirely one photograph per product, and every product page must not pay for the layouts that serve almost none.
//
// Two, the MULTI-IMAGE layouts work where a shopper meets them. From md up: two columns, every photograph in view as the box
// scrolls. Below md: a full-width track that snaps one photograph at a time, with an "n / total" counter that follows the
// scroll. Arabic is right to left, so its track scrolls to NEGATIVE offsets, and the counter must read the same in both.
//
// Three, a photograph that is tapped opens full screen on that photograph, and the full-screen view closes and gives the
// page back.
//
//   npm run test:gallery   (needs MariaDB and php -S :8188 router-native, and a built dist)
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SITE = process.env.SITE ?? 'http://127.0.0.1:8188'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const sql = async (q) =>
  (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q])).stdout.trim()

const SLUG = await sql("select slug from products where active = 1 and image is not null limit 1")
   || await sql("select slug from products where active = 1 limit 1")

const LIGHTBOX = '[role=dialog][aria-modal="true"]'
// Counting what is ACTUALLY on screen: the cart drawer sits in the DOM from page load, parked beyond the right edge, so a bare
// role selector reports it. The open lightbox is inset-0 and its box intersects the viewport.
const lightboxOpen = (p) => p.locator(LIGHTBOX).evaluateAll((ds) =>
  ds.filter((d) => {
    const r = d.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0
  }).length)
// The lightbox's photograph: the file name is enough to tell which one it shows.
const lightboxSrc = (p) => p.locator(`${LIGHTBOX} img`).first().getAttribute('src')

const before = {
  images: await sql(`select ifnull(images,'') from products where slug='${SLUG}'`),
  brand: await sql(`select ifnull(brand_slug,'') from products where slug='${SLUG}'`),
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
// Arabic is the default; English is ?lang=en.
const open = async ({ w = 390, lang = 'ar' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 900, hasTouch: w < 900 })
  const p = await ctx.newPage()
  await p.goto(`${SITE}/product/${SLUG}${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)   // stock and brand arrive after the paint
  return p
}

// The phone track and the desktop grid, as the shopper sees them.
const track = (p) => p.evaluate(() => {
  const el = document.querySelector('[aria-roledescription="carousel"]')
  if (!el) return null
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
  return {
    visible: cs.display !== 'none' && r.width > 0,
    left: r.left, width: r.width, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft,
    slides: el.querySelectorAll(':scope > button[aria-roledescription="slide"]').length,
    snap: cs.scrollSnapType, overflowX: cs.overflowX,
    pill: el.nextElementSibling?.textContent.trim() ?? null,
    dir: getComputedStyle(el).direction,
  }
})
const grid = (p) => p.evaluate(() => {
  const el = [...document.querySelectorAll('[role=list]')].find((l) => l.querySelector(':scope > [role=listitem]'))
  if (!el) return null
  const cs = getComputedStyle(el), tiles = [...el.querySelectorAll(':scope > [role=listitem] > button')]
  return {
    display: cs.display, columns: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
    tiles: tiles.length,
    rects: tiles.map((t) => { const r = t.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }),
  }
})
// Scroll the track to photograph n. In Arabic the first photograph is at the right edge and the rest lie to its left, so the
// scroll offsets are negative; asking for the same photograph in either direction is the case this suite is about.
const scrollTo = (p, n) => p.evaluate((k) => {
  const el = document.querySelector('[aria-roledescription="carousel"]')
  const rtl = getComputedStyle(el).direction === 'rtl'
  el.scrollTo({ left: (rtl ? -1 : 1) * k * el.clientWidth, behavior: 'instant' })
}, n)

try {
  // ------------------------------------------------- one photograph: no chrome
  await sql(`update products set images = null, brand_slug = null where slug='${SLUG}'`)
  head('one photograph costs nothing')
  {
    const p = await open()
    is(await p.locator('[role=list]:has(> [role=listitem])').count() === 0 && await p.locator('[aria-roledescription="carousel"]').count() === 0,
       'no grid and no carousel — there is nothing to scroll to')
    is(await p.locator('div.cursor-zoom-in img').count() === 1, 'and exactly one frame and one image are rendered')
    await p.context().close()
  }

  // --------------------------------------------------- more than one: the layouts
  await sql(`update products set images = '/cats/desktop/infobar.jpg,/cats/desktop/art-accessories.jpg,/cats/desktop/infobar.jpg' where slug='${SLUG}'`)

  head('a desktop shows every photograph, two to a row')
  {
    const p = await open({ w: 1280 })
    const g = await grid(p)
    is(g && g.display === 'grid', 'the grid is shown from md up', g && g.display)
    is(g && g.columns === 2, 'in two columns', g && `${g.columns} columns`)
    is(g && g.tiles === 3, 'with all three photographs', g && `${g.tiles} tiles`)
    if (g && g.rects.length === 3) {
      // In Arabic (the default) the grid runs right to left, so the second photograph sits to the LEFT of the first.
      const rtl = await p.evaluate(() => document.documentElement.dir === 'rtl')
      const [a, b, c] = g.rects
      is(Math.abs(a.y - b.y) <= 1 && (rtl ? b.x < a.x : b.x > a.x), `the first two sit side by side, reading ${rtl ? 'right to left' : 'left to right'}`)
      is(c.y > a.y + a.h / 2, 'the third starts a new row')
    }
    const carouselHidden = (await track(p))?.visible !== true
    is(carouselHidden, 'and the phone carousel is not shown at this width')

    // A tap on a frame opens the full-screen view on that frame. The list is the product's own photograph first, then the
    // gallery photographs with duplicates removed, so "the second frame" is whatever the page shows there: compare the two.
    const tileSrc = await p.locator('[role=listitem]').nth(1).locator('img').getAttribute('src')
    await p.locator('[role=listitem]').nth(1).locator('button').click()
    await p.waitForTimeout(400)
    is(await lightboxOpen(p) === 1, 'tapping the second frame opens the full-screen view')
    is(await lightboxSrc(p) === tileSrc, 'on the photograph that was tapped', tileSrc)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
    is(await lightboxOpen(p) === 0, 'and Escape closes it')
    is(await p.evaluate(() => getComputedStyle(document.body).overflow) !== 'hidden',
       'the page scrolls again afterwards — the lock is released, not leaked')
    await p.context().close()
  }

  for (const lang of ['ar', 'en']) {
    head(`a phone swipes one photograph at a time (${lang === 'ar' ? 'Arabic, right to left' : 'English'})`)
    const p = await open({ w: 390, lang })
    const t0 = await track(p)
    const g = await grid(p)
    is(t0 && t0.visible, 'the carousel is shown below md')
    is(g && g.display === 'none', 'the grid is not shown')
    is(t0 && t0.slides === 3, 'with all three photographs as snap points', t0 && `${t0.slides} slides`)
    is(t0 && Math.abs(t0.width - 390) <= 1, 'full width, edge to edge (no page gutter around it)', t0 && `${t0.width}px`)
    is(t0 && t0.snap.includes('mandatory'), 'the track snaps to each photograph', t0 && t0.snap)
    is(t0 && t0.pill === '1 / 3', 'the counter starts at 1 / 3', t0 && t0.pill)
    const rtlWanted = lang === 'ar'
    is(t0 && (t0.dir === 'rtl') === rtlWanted, `the track runs ${rtlWanted ? 'right to left' : 'left to right'}`, t0 && t0.dir)

    await scrollTo(p, 1)
    await p.waitForTimeout(500)
    const t1 = await track(p)
    is(t1 && t1.pill === '2 / 3', 'moving one photograph on reads 2 / 3 (in either direction)', t1 && `${t1.pill}, scrollLeft ${Math.round(t1.scrollLeft)}`)

    await scrollTo(p, 2)
    await p.waitForTimeout(500)
    is((await track(p))?.pill === '3 / 3', 'and the last reads 3 / 3')

    // A tap on the carousel opens the full-screen view on the photograph under the tap.
    await scrollTo(p, 0)
    await p.waitForTimeout(400)
    const slideSrc = await p.locator('[aria-roledescription="carousel"] > button img').first().getAttribute('src')
    await p.locator('[aria-roledescription="carousel"] > button').first().click()
    await p.waitForTimeout(400)
    is(await lightboxOpen(p) === 1, 'tapping the photograph opens the full-screen view')
    is(await lightboxSrc(p) === slideSrc, 'on the photograph that was tapped (the first)', slideSrc)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
    is(await lightboxOpen(p) === 0, 'and Escape closes it')
    await p.context().close()
  }

  // ------------------------------------------------------------- the brand
  await sql(`update products set images = null where slug='${SLUG}'`)
  head('the product page names its brand')
  {
    await sql(`update products set brand_slug = 'vanquish' where slug='${SLUG}'`)
    await sql("update brands set logo = null where slug = 'vanquish'")
    const p = await open()
    // The plate shows the brand's name IN THE PAGE'S LANGUAGE, and the page's language is now Arabic by default — so this has to
    // look for فانكويش, not Vanquish.
    is(/Vanquish|فانكويش/.test(await p.locator('body').innerText()),
       'with no logo uploaded it shows the NAME — better than a gap')
    await p.context().close()

    // And with a logo, the picture, fetched as bytes rather than inlined.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await sql(`update brands set logo = 'data:image/png;base64,${PNG}' where slug = 'vanquish'`)
    const p2 = await open()
    const logo = p2.locator('img[alt="Vanquish"], img[alt="فانكويش"]')
    is(await logo.count() === 1, 'once uploaded, the logo is shown instead')
    const src = await logo.getAttribute('src')
    is(/r=brand_logo/.test(src ?? ''), 'served from the image endpoint, not inlined base64', src?.slice(0, 60))
    is(/[&?]v=/.test(src ?? ''), 'with the content hash, so a year-long cache is safe')
    await p2.context().close()
    await sql("update brands set logo = null where slug = 'vanquish'")
  }
} finally {
  await browser.close()
  // Put the product back exactly as it was, whatever happened above.
  await sql(`update products set images = ${before.images ? `'${before.images}'` : 'null'},
                                 brand_slug = ${before.brand ? `'${before.brand}'` : 'null'}
              where slug='${SLUG}'`)
}

console.log(fails ? `\n${fails} problem(s) in the gallery` : '\nthe gallery shows one photograph free, a grid on a desktop, a swipe carousel on a phone, and names its brand')
