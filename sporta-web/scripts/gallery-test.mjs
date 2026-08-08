// The product gallery: the slider, the zoom, and the brand plate.
//
// TWO THINGS THIS SUITE EXISTS TO HOLD.
//
// One, the SINGLE-IMAGE case has to stay free. The catalogue is almost entirely
// one photograph per product, so a track, arrows, dots and a thumbnail strip
// that render whether or not there is anything to slide would be weight paid by
// every product page to serve almost none of them.
//
// Two, the multi-image case has to actually work, and until now it could not:
// productImages() read a `p.images` field that no table had, so the swipe, the
// arrows and the thumbnails were unreachable code. A test that only opened a
// product page would have passed throughout.
//
//   npm run test:gallery   (needs MariaDB and php -S :8188 router-native)
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

// COUNTING WHAT IS ACTUALLY ON SCREEN, and neither obvious way works.
//
// [role=dialog] alone also matches the cart drawer, which is in the DOM from
// page load and parked off-screen — so a bare role selector reports the drawer
// and reads as a broken lightbox.
//
// And `offsetParent !== null` is NOT a visibility test for these: both are
// position:fixed, and a fixed element has no offsetParent by definition. That
// check called the lightbox invisible while it was filling the screen, which is
// a test failing on a feature that worked.
//
// So: does the element's box actually intersect the viewport. The closed drawer
// sits beyond the right edge; the open lightbox is inset-0.
const LIGHTBOX = '[role=dialog][aria-modal="true"]'
const lightboxOpen = (p) => p.locator(LIGHTBOX).evaluateAll((ds) =>
  ds.filter((d) => {
    const r = d.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0
  }).length)

// Which photograph actually occupies the frame. Direction-independent, which
// the transform is not.
const visibleIndex = (p) => p.evaluate(() => {
  const frame = document.querySelector('.aspect-square')
  const r = frame.getBoundingClientRect()
  const mid = r.left + r.width / 2
  return [...frame.querySelectorAll('img')]
    .findIndex((im) => { const b = im.getBoundingClientRect(); return b.left < mid && b.right > mid })
})

const before = {
  images: await sql(`select ifnull(images,'') from products where slug='${SLUG}'`),
  brand: await sql(`select ifnull(brand_slug,'') from products where slug='${SLUG}'`),
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const open = async (w = 390) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 900, hasTouch: w < 900 })
  const p = await ctx.newPage()
  await p.goto(`${SITE}/product/${SLUG}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)   // stock and brand arrive after the paint
  return p
}

try {
  // ------------------------------------------------- one photograph: no chrome
  await sql(`update products set images = null, brand_slug = null where slug='${SLUG}'`)
  head('one photograph costs nothing')
  {
    const p = await open()
    is(await p.locator('button[aria-label^="Image "], button[aria-label^="صورة "]').count() === 0,
       'no thumbnails, no dots — there is nothing to slide to')
    is(await p.locator('.aspect-square img').count() === 1, 'and exactly one image is rendered')
    await p.context().close()
  }

  // --------------------------------------------------- more than one: the slider
  await sql(`update products set images = '/cats/desktop/infobar.jpg,/cats/desktop/art-accessories.jpg' where slug='${SLUG}'`)
  head('more than one photograph gets the slider')
  {
    const p = await open()
    const imgs = await p.locator('.aspect-square img').count()
    is(imgs === 3, 'all three are in the track — sliding is a transform, not a src swap', `${imgs}`)

    const dots = await p.locator('button[aria-label^="Image "], button[aria-label^="صورة "]').count()
    is(dots >= 3, 'and there are controls to reach them', `${dots} buttons`)

    // WHICH IMAGE IS UNDER THE FRAME, not what the transform string says.
    //
    // This asserted `translateX(-100%)`, and that is an LTR fact: a flex row in
    // an RTL document runs the other way, so the correct Arabic transform is
    // +100%. The old assertion passed in English while Arabic showed a BLANK
    // SQUARE — the track slid away from the frame entirely. Asking which image
    // occupies the viewport is the question the shopper actually asks, and it
    // has one answer in both directions.
    is(await visibleIndex(p) === 0, 'it starts on the first photograph')
    await p.locator('button[aria-label^="Image 2"], button[aria-label^="صورة 2"]').first().click()
    await p.waitForTimeout(500)
    is(await visibleIndex(p) === 1, 'choosing the second photograph brings the SECOND one into the frame')
    await p.context().close()
  }

  // ------------------------------------------------------------------ swiping
  head('a finger can swipe it')
  {
    const p = await open()
    const box = await p.locator('.aspect-square').first().boundingBox()
    const rtl = await p.evaluate(() => document.documentElement.dir === 'rtl')

    // WHICH WAY IS "NEXT" DEPENDS ON THE DIRECTION, and this test used to
    // assume it did not. In an RTL document the next photograph sits to the
    // LEFT of the current one, so the finger drags RIGHT to pull it in — a
    // leftward drag correctly goes BACK, which is what it did, and the test
    // called that a failure. Dragging the wrong way and asserting "next" would
    // have hidden a real bug the day the direction logic broke.
    const from = rtl ? 0.2 : 0.8
    const to = rtl ? 0.8 : 0.2
    const path = rtl ? [0.4, 0.55, 0.7, 0.8] : [0.6, 0.45, 0.3, 0.2]

    // A real drag: down, several moves, up. One move is not a gesture and the
    // handler is right to ignore it.
    await p.mouse.move(box.x + box.width * from, box.y + box.height / 2)
    await p.dispatchEvent('.aspect-square', 'pointerdown',
      { pointerId: 1, pointerType: 'touch', clientX: box.x + box.width * from, clientY: box.y + box.height / 2, isPrimary: true })
    for (const f of path) {
      await p.dispatchEvent('.aspect-square', 'pointermove',
        { pointerId: 1, pointerType: 'touch', clientX: box.x + box.width * f, clientY: box.y + box.height / 2, isPrimary: true })
    }
    await p.dispatchEvent('.aspect-square', 'pointerup',
      { pointerId: 1, pointerType: 'touch', clientX: box.x + box.width * to, clientY: box.y + box.height / 2, isPrimary: true })
    await p.waitForTimeout(600)
    is(await visibleIndex(p) === 1,
       `swiping ${rtl ? 'right (RTL)' : 'left (LTR)'} moves to the next photograph`,
       `now showing image ${(await visibleIndex(p)) + 1}`)
    await p.context().close()
  }

  // ----------------------------------------------------------------- the zoom
  head('the photograph opens full screen')
  {
    const p = await open()
    is(await lightboxOpen(p) === 0, 'nothing is open to begin with')

    await p.locator('.aspect-square').first().click()
    await p.waitForTimeout(400)
    is(await lightboxOpen(p) === 1, 'tapping the photograph opens it')

    // Escape has to work: a full-screen overlay with no keyboard exit is a trap.
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
    is(await lightboxOpen(p) === 0, 'and Escape closes it')

    // The page behind must not be left unscrollable after it closes.
    is(await p.evaluate(() => getComputedStyle(document.body).overflow) !== 'hidden',
       'the page scrolls again afterwards — the lock is released, not leaked')
    await p.context().close()
  }

  // ------------------------------------------------------------- the brand
  head('the product page names its brand')
  {
    await sql(`update products set brand_slug = 'vanquish' where slug='${SLUG}'`)
    await sql("update brands set logo = null where slug = 'vanquish'")
    const p = await open()
    // The plate shows the brand's name IN THE PAGE'S LANGUAGE, and the page's
    // language is now Arabic by default — so this has to look for فانكويش, not
    // Vanquish.
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

console.log(fails ? `\n${fails} problem(s) in the gallery` : '\nthe gallery slides, zooms and names its brand')
process.exit(fails ? 1 : 0)
