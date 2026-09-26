/**
 * Every picture on the storefront, as the BROWSER renders it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/image-render-audit.mjs
 *   BASE=https://www.sporta.com.kw node scripts/image-render-audit.mjs
 *
 * WHAT THE OTHER IMAGE RIGS DO NOT ASK. image-audit.mjs proves every picture is
 * stored somewhere reachable and served with the right headers; tile-art-test
 * proves the tiles fetch webp and the Arabic frame. Neither looks at what a
 * picture is doing ON THE PAGE.
 *
 * ---------------------------------------------------------------------------
 * THE FIRST VERSION OF THIS FILE FAILED TWICE, AND BOTH WERE FALSE. It is worth
 * writing down, because the mistake is the reason this version measures what it
 * measures.
 *
 * It failed a missing `width`/`height` pair on the hero and the four tiles, on
 * the grounds that a box with no size jumps when the bytes arrive. Measured, the
 * home page's CLS is 0.0002 and no image is in it: every one of those images is
 * `position:absolute` inside a sized frame, so it is OUT OF FLOW and cannot move
 * anything, attributes or no attributes.
 *
 * It failed `loading="lazy"` on two tiles in the first screenful, on the grounds
 * that the visitor waits for them. Measured on a 390px viewport with no
 * scrolling, they are requested at +202ms alongside everything else — Chrome
 * loads an in-viewport lazy image at layout, so the attribute cost nothing.
 *
 * Both checks were reading an ATTRIBUTE as though it were the FAULT. The
 * attribute is advice to the browser; the fault is what the visitor gets. So
 * every failing check below measures the visitor's side:
 *
 *   BROKEN         the picture did not arrive.
 *   NO alt         a screen reader reads the filename, or nothing at all.
 *   UPSCALED       painted wider than the file is, which no CSS can undo — the
 *                  difference between a photograph and a smear.
 *   SHOVES         an in-flow image that GROWS after layout, measured with
 *                  every image held back 700ms so the growth is reproducible.
 *                  This is the fault "no width/height" was standing in for,
 *                  asked directly: an image sized by attributes, by
 *                  aspect-ratio or by a sized parent all pass, and only one
 *                  that really does push the page down fails.
 *   NEVER REQUESTED
 *                  a first-screen image the browser did not fetch at all
 *                  without scrolling. This is the fault "lazy above the fold"
 *                  was standing in for.
 *
 * REPORTED, NOT FAILED: soft at 2x, more than 3x the pixels shown, and each
 * page's CLS with whatever the browser blamed for it — a number worth watching
 * even when no image is responsible for it.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PAGES = ['/', '/shop', '/about', '/contact', '/cart']

// A phone, because that is what a shopper in Kuwait is holding, and it is the
// viewport where "the first screenful" is smallest and most crowded.
const VIEWPORT = { width: 390, height: 844 }

// How long every image is held back. Long enough to land after first layout,
// short enough that five pages still finish in a minute.
const IMAGE_DELAY_MS = 700

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/** Watch the page's total layout shift, and — separately — watch every image
 *  for the thing that CAUSES one.
 *
 *  WHY NOT JUST READ THE SHIFT'S `sources`. That was the first attempt and a
 *  mutation walked straight through it: an in-flow image with no reserved
 *  height, cache-busted so its bytes land after layout, shoved the whole page
 *  down and was reported as `all ok`. A layout-shift entry blames the elements
 *  that were DISPLACED — everything below the image — and the image that grew
 *  is frequently not among them at all. Asking `is an IMG in e.sources` is
 *  asking the wrong list.
 *
 *  So the fault is measured at its mechanism instead: an image that is IN FLOW
 *  (anything but absolute/fixed) and whose height GROWS after the page has laid
 *  out has, by construction, pushed everything after it. That is true whether
 *  the space was reserved by width/height attributes, by aspect-ratio, or by a
 *  sized parent — which is the whole point, since all three are correct and
 *  only the absence of all of them is a fault. */
const WATCH = () => {
  window.__cls = 0
  window.__lastBlame = ''
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue
      window.__cls += e.value
      window.__lastBlame = (e.sources ?? [])
        .map((s) => (s.node ? s.node.nodeName + String(s.node.className || '').slice(0, 24) : '?'))
        .slice(0, 3).join(' ')
    }
  }).observe({ type: 'layout-shift', buffered: true })

  window.__grew = []
  const seen = new WeakMap()
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      const img = en.target
      const h = Math.round(en.contentRect.height)
      const was = seen.get(img)
      seen.set(img, h)
      window.__observed++
      if (was === undefined) continue
      // Out of flow: it can grow all it likes without moving anything.
      const pos = getComputedStyle(img).position
      if (pos === 'absolute' || pos === 'fixed') continue
      // A 1px settle is the browser rounding, not a shove.
      if (h - was > 4) {
        window.__grew.push({
          src: String(img.currentSrc || img.src || '').split('/').pop().slice(0, 34),
          from: was, to: h,
        })
      }
    }
  })
  const watch = (n) => { if (n.nodeName === 'IMG') { try { ro.observe(n) } catch (e) { /* detached */ } } }

  // AN INIT SCRIPT RUNS BEFORE THERE IS A DOCUMENT TO OBSERVE. Measured:
  // `document.documentElement` is null at this point, so observing it throws
  // `parameter 1 is not of type 'Node'` — and because that killed the rest of
  // this function, the ResizeObserver above was never attached to anything.
  // The rig then reported `ok  no in-flow image grows` against a page with a
  // deliberately unsized image shoving it, twice, because ZERO OBSERVATIONS
  // and NO FAULTS produce identical output. Hence the deferral, and hence the
  // `observed` counter the rig asserts on afterwards.
  window.__observed = 0
  const start = () => {
    const root = document.documentElement || document
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue
        watch(n)
        if (n.querySelectorAll) n.querySelectorAll('img').forEach(watch)
      }
    }).observe(root, { childList: true, subtree: true })
    document.querySelectorAll('img').forEach(watch)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
  const bump = new ResizeObserver(() => {})
  void bump
}

/** Every rendered <img>, measured. */
const survey = (page) =>
  page.evaluate(() => {
    const fold = window.innerHeight
    return [...document.images].map((img) => {
      const r = img.getBoundingClientRect()
      return {
        src: (img.currentSrc || img.src || '').split('/').slice(-1)[0].slice(0, 40),
        // The empty string is a DELIBERATE alt on decoration and is correct;
        // a MISSING attribute is the fault. They are different states and
        // conflating them would fail every scrim and spacer on the page.
        hasAlt: img.hasAttribute('alt'),
        alt: img.getAttribute('alt') ?? null,
        w: Math.round(r.width),
        h: Math.round(r.height),
        natW: img.naturalWidth,
        natH: img.naturalHeight,
        // Above the fold at load, which is what "first screenful" means for
        // the image the page is judged on.
        aboveFold: r.top < fold && r.bottom > 0 && r.width > 0,
        // The browser's own answer to "did you fetch this?", rather than the
        // markup's opinion about whether it ought to.
        loaded: img.complete && img.naturalWidth > 0,
        broken: img.complete && img.naturalWidth === 0,
      }
    })
  })

const all = []
const pageCls = []
for (const path of PAGES) {
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  const page = await ctx.newPage()
  await page.addInitScript(WATCH)
  // EVERY IMAGE ARRIVES LATE, ON PURPOSE. An unsized image only shoves the page
  // when its bytes land after layout, and on a sandbox served from localhost
  // they land inside the first animation frame — so the fault is invisible here
  // and perfectly visible to a shopper on a phone in Kuwait. The first version
  // of this check measured green against a deliberately broken page for exactly
  // that reason. Holding the pixels back for a beat reproduces the shopper's
  // connection, which is the one the fault belongs to.
  await page.route(/\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i, async (route) => {
    await new Promise((r) => setTimeout(r, IMAGE_DELAY_MS))
    await route.continue()
  })
  // NOTHING SCROLLS. The whole question about a first-screen image is what
  // arrives for a visitor who has not moved yet, so moving would answer a
  // different question and always answer it favourably.
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  for (const img of await survey(page)) all.push({ ...img, page: path })
  pageCls.push({
    path,
    ...(await page.evaluate(() => ({
      cls: +(window.__cls ?? 0).toFixed(4),
      grew: window.__grew ?? [],
      observed: window.__observed ?? 0,
      blame: window.__lastBlame ?? '',
    }))),
  })
  await ctx.close()
}
await browser.close()

console.log(`--- ${all.length} rendered images across ${PAGES.length} pages, at ${VIEWPORT.width}px\n`)
check(all.length > 0, 'the pages render images at all', `${all.length} found`)

/** Only pictures that actually painted. A zero-sized img is a decoration the
 *  layout never showed, and judging its resolution is judging nothing. */
const shown = all.filter((i) => i.w > 1 && i.h > 1 && !i.broken)

const broken = all.filter((i) => i.broken)
check(broken.length === 0, 'every image loads',
  broken.map((i) => `${i.page}:${i.src}`).join(', '))

const noAlt = all.filter((i) => !i.hasAlt)
check(noAlt.length === 0, 'every image carries an alt attribute',
  noAlt.map((i) => `${i.page}:${i.src}`).slice(0, 6).join(', '))

const upscaled = shown.filter((i) => i.natW > 0 && i.natW < i.w)
check(upscaled.length === 0, 'no image is painted wider than its own pixels',
  upscaled.map((i) => `${i.page}:${i.src} ${i.natW}px in a ${i.w}px box`).slice(0, 6).join(', '))

// The fault "no width/height" was standing in for, measured at its mechanism.
const shifty = pageCls.flatMap((p) => p.grew.map((s) => `${p.path}:${s.src} ${s.from}px->${s.to}px`))
// THE WATCHER MUST HAVE WATCHED SOMETHING. Asserted before the result is read,
// because a silent setup failure makes "no image grew" indistinguishable from
// "nothing was ever measured" — which is exactly how this check passed against
// a page that was visibly shoving itself about.
const blind = pageCls.filter((p) => p.observed === 0)
check(blind.length === 0, 'the size watcher actually observed images on every page',
  blind.length ? `no observations on ${blind.map((p) => p.path).join(', ')}` : `${pageCls.reduce((n, p) => n + p.observed, 0)} observations`)
check(shifty.length === 0, 'no in-flow image grows after layout and shoves the page',
  shifty.slice(0, 6).join(', '))

// The fault "lazy above the fold" was standing in for. An image in the first
// screenful that the browser never fetched is a hole a visitor sees; one that
// is merely MARKED lazy and fetched anyway is not.
const unfetched = all.filter((i) => i.aboveFold && !i.loaded && !i.broken)
check(unfetched.length === 0, 'every first-screen image is fetched without scrolling',
  unfetched.map((i) => `${i.page}:${i.src}`).slice(0, 6).join(', '))

// ---- reported, not failed -------------------------------------------------
console.log('\n--   layout shift per page (0.1 is the usual "good" ceiling):')
for (const p of pageCls) {
  const note = p.grew.length ? `${p.grew.length} image(s) grew` : p.cls > 0.01 ? `blamed: ${p.blame}` : ''
  console.log(`       ${p.cls > 0.1 ? 'HIGH ' : '     '}${p.path.padEnd(10)} ${String(p.cls).padEnd(8)} ${note}`)
}

const soft = shown.filter((i) => i.natW >= i.w && i.natW < i.w * 2)
if (soft.length) {
  console.log(`\n--   ${soft.length} image(s) are sharp at 1x and soft on a 2x screen:`)
  for (const i of soft.slice(0, 8)) {
    console.log(`       ${i.page}  ${i.src}  ${i.natW}px for a ${i.w}px box (${(i.natW / i.w).toFixed(2)}x)`)
  }
  console.log('     Not a fault — it is what the artwork is. Worth knowing before')
  console.log('     anyone asks why a photograph looks softer on a phone.')
}

const heavy = shown.filter((i) => i.natW > i.w * 3)
if (heavy.length) {
  console.log(`\n--   ${heavy.length} image(s) carry more than 3x the pixels they show:`)
  for (const i of heavy.slice(0, 8)) {
    console.log(`       ${i.page}  ${i.src}  ${i.natW}px for a ${i.w}px box (${(i.natW / i.w).toFixed(1)}x)`)
  }
  console.log('     Downloaded and thrown away. A smaller crop would cost nothing visible.')
}

const decorative = all.filter((i) => i.hasAlt && i.alt === '').length
console.log(`\n--   ${decorative} image(s) declare themselves decorative (alt=""), which is correct for a scrim`)

console.log(fails ? `\n${fails} failed` : '\nall ok — every picture arrives, is labelled, sits still, and is sharp enough for its box')
process.exit(fails ? 1 : 0)
