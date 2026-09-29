/**
 * The product photo viewer — driven in a real browser. 2026-09-29.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/product-zoom-test.mjs
 *
 * WHAT IT HOLDS, and why each is not the obvious check:
 *   - THE BUNDLE'S OWN LIGHTBOX IS NEVER SHOWN. Its photograph list begins with
 *     the shop's grey placeholder and it opens at index 0, so tapping the photo a
 *     shopper was looking at opened a blank card ("Image 1 of 3" for two photos).
 *     The rig taps the gallery and requires the viewer AND the absence of
 *     [data-gallery-lightbox] — a viewer that opened beside the bundle's would
 *     have passed a check for the viewer alone.
 *   - IT OPENS ON A REAL PHOTOGRAPH, the one showing, not index 0: the fixture
 *     has two photographs with different ids and the first shown must be the
 *     first real one, then the second after a swipe.
 *   - ZOOM IS MEASURED FROM THE TRANSFORM the browser holds, not from a flag:
 *     a two-pointer pinch takes it above 1, a double-tap takes it to 2.5 and back
 *     to 1, the wheel zooms on a desktop, and a pan dragged 5000px is CLAMPED to
 *     the picture's own edges (computed from the rendered sizes, not copied).
 *   - THE SWIPE FOLLOWS THE PAGE'S DIRECTION: left goes forward in English,
 *     right in Arabic. Only the Arabic run can catch a viewer that forgot dir.
 *   - IT LEAVES WHEN TOLD TO and leaves nothing behind: Escape closes, the page
 *     scroll lock is undone, focus returns to where it was.
 *   - IT DOES NOTHING WHERE IT SHOULD NOT: a product with no photograph, and a
 *     tap on a thumbnail button, open no viewer.
 * The fixture photographs are added through the admin API and deleted in a
 * `finally`. Pinch is driven with synthetic pointer events, which is what the
 * viewer listens to; the rig cannot drive a real two-finger gesture.
 */
import { chromium, devices } from 'playwright'
import { deflateSync } from 'node:zlib'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const WITH = 'cagliari-calcio-sweatshirt-navy'
const WITHOUT = 'cagliari-calcio-backpack'

let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

// A tiny solid-colour PNG, 4:5, no dependencies.
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
    let x = 0xffffffff; for (const v of buf) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const row = Buffer.alloc(1 + w * 3); for (let i = 0; i < w; i++) { row[1 + i * 3] = r; row[2 + i * 3] = g; row[3 + i * 3] = b }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let cookie = ''
const admin = async (route, body) => {
  const r = await fetch(`${ADMIN}?r=${route}`, { method: 'POST', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) })
  if (route === 'login') cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, j: await r.json().catch(() => null) }
}

const ids = []
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
try {
  await admin('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  for (const c of [[200, 60, 60], [60, 90, 210]]) {
    const up = await admin('product_image_add', { slug: WITH, image: 'data:image/png;base64,' + png(400, 500, c).toString('base64') })
    if (up.j?.id) ids.push(up.j.id)
  }
  check(ids.length === 2, 'two fixture photographs were added to the product', ids.join())

  const ptr = `(type, id, x, y) => document.querySelector('[data-sporta-zoom] > div').dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: id === 1, bubbles: true }))`
  const scaleOf = () => document.querySelector('[data-sporta-zoom] img') && new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-sporta-zoom] img')).transform).a
  const txOf = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-sporta-zoom] img')).transform).e

  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/product/${WITH}?lang=${lang}`)
    await page.waitForSelector('.group.aspect-square img[src*="product_image"]', { timeout: 10000 })
    await page.waitForTimeout(800)
    const before = await page.evaluate(() => document.documentElement.style.overflow)

    // window's capture phase runs before document's, so this sees focus exactly as the viewer will
    await page.evaluate(() => window.addEventListener('click', () => { window.__zf = document.activeElement }, true))
    await page.tap('.group.aspect-square')
    const focusedBefore = await page.evaluate(() => (window.__zf === document.body ? 'body' : window.__zf.tagName))
    await page.waitForSelector('[data-sporta-zoom]', { timeout: 4000 })
    check(true, `${lang}: tapping the photograph opens the viewer`)
    await page.waitForTimeout(300)
    check((await page.locator('[data-gallery-lightbox]').count()) === 0, `${lang}: and the bundle's own lightbox (the grey placeholder) is NOT opened`)
    const src1 = await page.locator('[data-sporta-zoom] img').getAttribute('src')
    check(src1.includes(`product_image&id=${ids[0]}`), `${lang}: it opens on the first REAL photograph`, src1.slice(-34))
    check((await page.locator('[data-sporta-zoom]').textContent()).includes('1 / 2'), `${lang}: with a 1 / 2 counter`)
    check((await page.evaluate(() => document.documentElement.style.overflow)) === 'hidden', `${lang}: the page behind is locked`)
    check((await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === (lang === 'ar' ? 'إغلاق' : 'Close'), `${lang}: focus moves to Close`)

    // pinch: two pointers moving apart
    await page.evaluate(`(${ptr})('pointerdown', 1, 150, 420)`)
    await page.evaluate(`(${ptr})('pointerdown', 2, 240, 420)`)
    await page.evaluate(`(${ptr})('pointermove', 2, 340, 420)`)
    await page.evaluate(`(${ptr})('pointermove', 1, 100, 420)`)
    const pinched = await page.evaluate(scaleOf)
    await page.evaluate(`(${ptr})('pointerup', 2, 340, 420)`)
    await page.evaluate(`(${ptr})('pointerup', 1, 100, 420)`)
    check(pinched > 1.8, `${lang}: pinching apart zooms in`, `scale ${pinched?.toFixed(2)}`)

    // pan is clamped to the picture's own edges
    await page.evaluate(`(${ptr})('pointerdown', 1, 200, 400)`)
    await page.evaluate(`(${ptr})('pointermove', 1, 5200, 400)`)
    await page.evaluate(`(${ptr})('pointerup', 1, 5200, 400)`)
    await page.waitForTimeout(450)   // let the settle animation finish before reading the transform
    const pan = await page.evaluate(() => {
      const img = document.querySelector('[data-sporta-zoom] img'), st = document.querySelector('[data-sporta-zoom] > div')
      const m = new DOMMatrixReadOnly(getComputedStyle(img).transform)
      return { tx: m.e, s: m.a, bound: (img.clientWidth * m.a - st.clientWidth) / 2 }
    })
    check(Math.abs(pan.tx - pan.bound) <= 1, `${lang}: a 5000px drag stops exactly at the picture's edge`, `tx ${pan.tx.toFixed(0)} <= ${pan.bound.toFixed(0)}`)

    // double-tap toggles: zoomed -> 1, then 1 -> 2.5
    const dbl = async () => { for (let i = 0; i < 2; i++) { await page.evaluate(`(${ptr})('pointerdown', 1, 195, 420)`); await page.evaluate(`(${ptr})('pointerup', 1, 195, 420)`); await page.waitForTimeout(60) } await page.waitForTimeout(260) }
    await dbl()
    check(Math.abs((await page.evaluate(scaleOf)) - 1) < 0.02, `${lang}: double-tap while zoomed returns to 1x`)
    await dbl()
    check(Math.abs((await page.evaluate(scaleOf)) - 2.5) < 0.05, `${lang}: double-tap at 1x zooms to 2.5x`, String((await page.evaluate(scaleOf)).toFixed(2)))
    await dbl()

    // swipe: forward is toward the start edge — left in English, right in Arabic
    const dx = lang === 'ar' ? 200 : -200
    await page.evaluate(`(${ptr})('pointerdown', 1, 195, 420)`)
    await page.evaluate(`(${ptr})('pointermove', 1, ${195 + dx}, 425)`)
    await page.evaluate(`(${ptr})('pointerup', 1, ${195 + dx}, 425)`)
    await page.waitForTimeout(200)
    const src2 = await page.locator('[data-sporta-zoom] img').getAttribute('src')
    check(src2.includes(`product_image&id=${ids[1]}`), `${lang}: swiping ${lang === 'ar' ? 'right' : 'left'} shows the second photograph`, src2.slice(-34))
    check((await page.locator('[data-sporta-zoom]').textContent()).includes('2 / 2'), `${lang}: counter reads 2 / 2`)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    check((await page.locator('[data-sporta-zoom]').count()) === 0, `${lang}: Escape closes it`)
    check((await page.evaluate(() => document.documentElement.style.overflow)) === before, `${lang}: and the scroll lock is undone`)
    check(await page.evaluate(() => document.activeElement === window.__zf), `${lang}: focus goes back to the element that had it (${focusedBefore})`)

    // a thumbnail is a button: the viewer must not steal it
    const thumb = page.locator('button:has(img)').filter({ has: page.locator('img[src*="product_image"]') }).first()
    if (await thumb.count()) {
      await thumb.tap()
      await page.waitForTimeout(300)
      check((await page.locator('[data-sporta-zoom]').count()) === 0, `${lang}: tapping a thumbnail does not open the viewer`)
    }
    check(errors.length === 0, `${lang}: no script errors`, errors.join(' | ').slice(0, 160))
    await ctx.close()
  }

  // a product with no photograph: the viewer stays out of it
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/product/${WITHOUT}?lang=en`)
    await page.waitForSelector('.group.aspect-square', { timeout: 10000 })
    await page.waitForTimeout(600)
    await page.tap('.group.aspect-square')
    await page.waitForTimeout(600)
    check((await page.locator('[data-sporta-zoom]').count()) === 0, 'a product with no photograph opens no viewer')
    await ctx.close()
  }

  // desktop: the wheel zooms
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/product/${WITH}?lang=en`)
    await page.waitForSelector('.group.aspect-square img[src*="product_image"]', { timeout: 10000 })
    await page.waitForTimeout(600)
    await page.locator('.group.aspect-square').click({ position: { x: 200, y: 300 } })
    await page.waitForSelector('[data-sporta-zoom]', { timeout: 4000 })
    check((await page.locator('[data-gallery-lightbox]').count()) === 0, 'desktop: the bundle lightbox is not opened either')
    await page.mouse.move(640, 450)
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(200)
    const s = await page.evaluate(scaleOf)
    check(s > 1.5, 'desktop: the wheel zooms in', `scale ${s?.toFixed(2)}`)
    await page.keyboard.press('0')
    await page.waitForTimeout(400)
    check(Math.abs((await page.evaluate(scaleOf)) - 1) < 0.02, 'desktop: 0 resets the zoom')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    check((await page.locator('[data-sporta-zoom] img').getAttribute('src')).includes(`id=${ids[1]}`), 'desktop: the right arrow goes to the next photograph')
    await ctx.close()
  }
} finally {
  for (const id of ids) await admin('product_image_delete', { id }).catch(() => {})
  await browser.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — the product photo opens on a real picture and zooms, pans and swipes')
process.exit(fails ? 1 : 0)
