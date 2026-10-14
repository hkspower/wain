/**
 * test:hero-polish — the hero the owner chose on 2026-10-14, measured in a browser:
 *
 *   - the controls are back, on a dark pill, readable over the bright photos: idle dots and arrow
 *     icons at 3:1 or more against the pill as PAINTED (screenshot pixels, not the CSS asked for)
 *   - autoplay moves on its own (6.5s), the pause button is there and stops it
 *   - from 1024px each slide's headline and Shop button stand in the photo's EMPTY side: never over
 *     the athlete (the focal point the picture is drawn with), the same side in both languages, and
 *     the headline reads at 4.5:1 or more against the photo behind it
 *   - on phones the caption is not drawn (the page keeps its one <h1>), the arrows are hidden, and
 *     the controls' pill sits BELOW the athlete's feet (the square phone pictures were cut so the
 *     feet stand at 83% of the picture, scripts/make-hero-polish.py)
 *
 * Seeds the polished live shape (five photo slides, ids 2 and 3 off, autoplay on) and restores the
 * sandbox exactly. MUTATE=1 drops css/93-hero-polish.css's controls, MUTATE=2 blocks
 * hero-text-side.js, MUTATE=3 hides the pause button again, MUTATE=4 pales the headline: each must fail.
 */
import { chromium, devices } from 'playwright'
import { PNG } from 'pngjs'
import { snapshotHero, restoreHero, seedLiveHero, LIVE_SLIDES } from './_hero-seed.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const MUTATE = process.env.MUTATE ?? ''
const FEET_AT = 0.83
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const polished = LIVE_SLIDES.filter((s) => s[0] !== 2 && s[0] !== 3).map((s) =>
  [s[0], s[1], s[2].replace('neutral-desktop', 'polish-desktop-2560'), s[3] && s[3].replace('neutral-mobile', 'polish-phone'), s[4], s[5], s[6], s[7]])
const FULL_BODY = new Set([9, 5, 6, 7])   // crossfit (8) is waist-up: no feet to clear

const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const px = (png, x, y) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }

async function open(browser, opts, lang) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (MUTATE === '2') await ctx.route('**/assets/hero-text-side.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
  const p = await ctx.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (MUTATE === '1') await p.addStyleTag({ content: 'section[aria-roledescription="carousel"]>div.absolute.bottom-2{display:none!important}' })
  if (MUTATE === '3') await p.addStyleTag({ content: "section[aria-roledescription='carousel']>div.absolute.bottom-2>[aria-label='Pause slideshow'],section[aria-roledescription='carousel']>div.absolute.bottom-2>[aria-label='إيقاف العرض مؤقتًا']{display:none!important}" })
  if (MUTATE === '4') await p.addStyleTag({ content: 'section[aria-roledescription="carousel"] [aria-roledescription="slide"] [class~="md:min-h-[var(--hero-h-md,640px)]"] > div > .display-title{color:#c4c8ce!important}' })
  await p.waitForTimeout(1200)
  return { ctx, p }
}
const current = (p) => p.evaluate(() => document.querySelector('[aria-roledescription="slide"][aria-hidden="false"]')?.getAttribute('aria-label') ?? '')
const goTo = (p, i) => p.evaluate((k) => document.querySelectorAll('section[aria-roledescription="carousel"] > div.absolute.bottom-2 > button[aria-label]')[k + 1].click(), i)

const snap = snapshotHero()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
try {
  seedLiveHero({ autoplay: true, speed_ms: 6500, size: 'full' }, polished)

  // ---- controls, autoplay, pause (desktop, English) ----
  {
    const { ctx, p } = await open(browser, { viewport: { width: 1280, height: 800 } }, 'en')
    const pill = p.locator('section[aria-roledescription="carousel"] > div.absolute.bottom-2')
    const box = await pill.boundingBox().catch(() => null)
    check(!!box && box.width > 120, 'desktop: the controls are on screen', box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'hidden')
    if (box) {
      const png = PNG.sync.read(await pill.screenshot())
      const ground = px(png, 6, png.height / 2)
      const geo = await pill.evaluate((el) => {
        const r0 = el.getBoundingClientRect()
        const dots = [...el.querySelectorAll('button:not([aria-current]) > span')].filter((s) => s.getBoundingClientRect().width).map((s) => { const r = s.getBoundingClientRect(); return [r.left + r.width / 2 - r0.left, r.top + r.height / 2 - r0.top] })
        const arrows = [...el.querySelectorAll(':scope > button.h-8 svg')].filter((s) => s.getBoundingClientRect().width).map((s) => { const r = s.getBoundingClientRect(); return [r.left - r0.left, r.top - r0.top, r.width, r.height] })
        return { dots, arrows }
      })
      const dotC = Math.min(...geo.dots.map(([x, y]) => ratio(px(png, x, y), ground)))
      check(geo.dots.length >= 3 && dotC >= 3, 'desktop: the idle dots read on the pill (3:1)', `${geo.dots.length} dots, worst ${dotC.toFixed(2)}:1`)
      let iconC = 99
      for (const [x, y, w, h] of geo.arrows) { let best = 1; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) best = Math.max(best, ratio(px(png, xx, yy), ground)); iconC = Math.min(iconC, best) }
      check(geo.arrows.length >= 3 && iconC >= 3, 'desktop: the arrow and pause icons read on the pill (3:1)', `${geo.arrows.length} icons, worst ${iconC.toFixed(2)}:1`)
    }
    const pause = p.locator("section[aria-roledescription='carousel'] > div.absolute.bottom-2 > [aria-label='Pause slideshow']")
    check(await pause.isVisible().catch(() => false), 'desktop: the pause button is there')
    await p.mouse.move(2, 790)
    const a = await current(p); await p.waitForTimeout(7200); const b = await current(p)
    check(a !== b, 'autoplay: the hero moves on its own within 7.2s', `${a} -> ${b}`)
    if (await pause.isVisible().catch(() => false)) {
      await pause.click(); await p.mouse.move(2, 790)
      const c = await current(p); await p.waitForTimeout(7200); const d = await current(p)
      check(c === d, 'pause: pressing it stops the hero', `${c} -> ${d}`)
    } else check(false, 'pause: pressing it stops the hero', 'no pause button to press')
    await ctx.close()
  }

  // ---- the headline in the empty side (1280 and 1920, both languages) ----
  const sides = {}
  for (const [tag, vp] of [['1280', { width: 1280, height: 800 }], ['1920', { width: 1920, height: 1080 }]]) for (const lang of ['en', 'ar']) {
    const { ctx, p } = await open(browser, { viewport: vp }, lang)
    // hold the slider still while it is measured: the pointer resting on the hero pauses autoplay
    // (the bundle's own hover rule), and the slow zoom is frozen, so the two screenshots the
    // contrast check compares are of the same picture in the same place
    await p.addStyleTag({ content: 'section[aria-roledescription="carousel"] img{animation:none!important;transform:none!important}' })
    const hb = await p.locator('section[aria-roledescription="carousel"]').boundingBox()
    await p.mouse.move(hb.x + hb.width / 2, hb.y + 8)
    const n = await p.evaluate(() => document.querySelectorAll('[aria-roledescription="slide"]').length)
    for (let i = 0; i < n; i++) {
      await goTo(p, i); await p.waitForTimeout(900)
      const m = await p.evaluate(() => {
        const sec = document.querySelector('section[aria-roledescription="carousel"]'), s = sec.getBoundingClientRect()
        const slide = document.querySelector('[aria-roledescription="slide"][aria-hidden="false"]')
        const img = slide.querySelector('img'), fx = parseFloat((/object-position:\s*([\d.]+)%/.exec(img.getAttribute('style') || '') || [])[1])
        const cap = slide.querySelector('[class~="md:min-h-[var(--hero-h-md,640px)]"] > div'), c = cap.getBoundingClientRect()
        const title = cap.querySelector('.display-title'), t = title.getBoundingClientRect(), btn = cap.querySelector('a'), b = btn ? btn.getBoundingClientRect() : null
        return { W: s.width, left: s.left, top: s.top, fx, side: slide.getAttribute('data-sp-side'), c: [c.left - s.left, c.top - s.top, c.width, c.height], t: [t.left - s.left, t.top - s.top, t.width, t.height], btn: b && b.width > 40 && b.height >= 44, name: title.textContent.trim() }
      })
      const id = `${m.name.slice(0, 18)} ${tag} ${lang}`
      const visible = m.c[2] > 100 && m.c[3] > 40 && m.btn
      check(visible, `${id}: headline and Shop button are drawn`, `caption ${Math.round(m.c[2])}x${Math.round(m.c[3])}`)
      const ax = (m.fx / 100) * m.W, l = m.c[0], r = m.c[0] + m.c[2]
      const clear = m.fx > 55 ? r < ax - 0.15 * m.W : m.fx < 45 ? l > ax + 0.15 * m.W : r < 0.33 * m.W
      check(visible && clear, `${id}: the text stays off the athlete`, `athlete at ${m.fx}% (${Math.round(ax)}px), text ${Math.round(l)}-${Math.round(r)}px, side=${m.side}`)
      if (lang === 'en') sides[`${tag}:${i}`] = m.side; else check(sides[`${tag}:${i}`] === m.side, `${id}: the same side as in English (the photo is not mirrored)`, `${sides[`${tag}:${i}`]} / ${m.side}`)
      if (visible) {
        await p.addStyleTag({ content: 'section[aria-roledescription="carousel"].sp-hide-text [aria-roledescription="slide"] [class~="md:min-h-[var(--hero-h-md,640px)]"] > div > .display-title{color:transparent!important}' })
        const sec = p.locator('section[aria-roledescription="carousel"]')
        const withText = PNG.sync.read(await sec.screenshot())
        await p.evaluate(() => document.querySelector('section[aria-roledescription="carousel"]').classList.add('sp-hide-text'))
        const bare = PNG.sync.read(await sec.screenshot())
        await p.evaluate(() => document.querySelector('section[aria-roledescription="carousel"]').classList.remove('sp-hide-text'))
        const inks = []
        const [tx, ty, tw, th] = m.t
        for (let yy = ty + 2; yy < ty + th - 2; yy += 2) for (let xx = tx + 2; xx < tx + tw - 2; xx += 2) {
          const a = px(withText, xx, yy), g = px(bare, xx, yy)
          if (Math.abs(a[0] - g[0]) + Math.abs(a[1] - g[1]) + Math.abs(a[2] - g[2]) > 120) inks.push(ratio(a, g))
        }
        // the darkest quarter of the letters' pixels, not the single worst: anti-aliased edges blend
        // with the photo by design and would read as low contrast on any text anywhere
        inks.sort((x, y) => y - x)
        const inked = inks.length, core = inked ? inks[Math.floor(inked / 4)] : 0
        check(inked >= 40, `${id}: the contrast check found the headline's letters`, `${inked} ink samples`)
        check(inked >= 40 && core >= 4.5, `${id}: the headline reads against the photo (4.5:1)`, `${inked ? core.toFixed(2) + ':1 (darkest quarter of the letters)' : 'no ink'}`)
      }
    }
    await ctx.close()
  }

  // ---- phones: no caption, no arrows, the pill below the feet ----
  for (const [tag, dev] of [['iPhone 13', devices['iPhone 13']], ['Pixel 7', devices['Pixel 7']]]) for (const lang of ['en', 'ar']) {
    const { ctx, p } = await open(browser, dev, lang)
    const n = await p.evaluate(() => document.querySelectorAll('[aria-roledescription="slide"]').length)
    const h1 = await p.evaluate(() => [...document.querySelectorAll('h1')].length)
    check(h1 === 1, `${tag} ${lang}: the page keeps exactly one <h1>`, `${h1}`)
    for (let i = 0; i < n; i++) {
      await goTo(p, i); await p.waitForTimeout(900)
      const m = await p.evaluate(() => {
        const sec = document.querySelector('section[aria-roledescription="carousel"]'), s = sec.getBoundingClientRect()
        const slide = document.querySelector('[aria-roledescription="slide"][aria-hidden="false"]')
        const id = Number((/[?&]id=(\d+)/.exec(slide.querySelector('img').currentSrc || slide.querySelector('img').src) || [])[1])
        const img = slide.querySelector('img'), r = img.getBoundingClientRect()
        const [ox, oy] = getComputedStyle(img).objectPosition.split(' ').map(parseFloat)
        const sc = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight)
        const drawnH = img.naturalHeight * sc
        const top = r.top - s.top + (r.height - drawnH) * oy / 100
        const pill = sec.querySelector(':scope > div.absolute.bottom-2'), pr = pill.getBoundingClientRect()
        const vis = getComputedStyle(pill, '::before').content !== 'none' ? 7 : 0
        const cap = slide.querySelector('[class~="md:min-h-[var(--hero-h-md,640px)]"] > div').getBoundingClientRect()
        const arrows = [...pill.querySelectorAll(':scope > button.h-8')].filter((b) => !/ause|esume|إيقاف|استئناف/.test(b.getAttribute('aria-label')) && b.getBoundingClientRect().width).length
        return { id, top, drawnH, natW: img.naturalWidth, natH: img.naturalHeight, pillTop: pr.top - s.top + vis, cap: cap.width * cap.height, arrows, ox }
      })
      const tagS = `${tag} ${lang} slide ${i + 1}`
      check(m.natW === m.natH, `${tagS}: the phone picture is square`, `${m.natW}x${m.natH}`)
      check(m.cap <= 1, `${tagS}: no caption drawn over the photo`, `${m.cap}px²`)
      check(m.arrows === 0, `${tagS}: no arrows (phones swipe)`, `${m.arrows}`)
      if (FULL_BODY.has(m.id)) {
        const feet = m.top + FEET_AT * m.drawnH
        check(feet <= m.pillTop - 2, `${tagS}: the controls sit below the athlete's feet`, `feet ${feet.toFixed(0)}px, pill top ${m.pillTop.toFixed(0)}px`)
      }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  restoreHero(snap)
}
console.log(fails ? `\n${fails} failed` : '\nall ok — controls on a pill, autoplay with pause, headlines in the empty side, feet clear on phones')
process.exit(fails ? 1 : 0)
