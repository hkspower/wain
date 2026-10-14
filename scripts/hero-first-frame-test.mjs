/**
 * The hero from its FIRST frame — 2026-10-01, extended 2026-10-14.
 *
 *   bash scripts/sandbox.sh && node scripts/hero-first-frame-test.mjs
 *   ONLY=size,picture,heading,top   (any of them) narrows it
 *
 * ONE HEIGHT (2026-10-01, "fix main hero slide layout, sometimes half view"). Measured with the live
 * shop's Size (Full), a FIRST visit painted the default Tall strip and grew only when ?r=slides
 * answered. So, for each of the three Sizes, on a phone and a desktop, first and return visit: every
 * frame from the first paint to three seconds in shows the hero at one height. Run twice: with the
 * sandbox's hero_slides EMPTY (the shipped banner and the bundle's drawn slides) and with the live
 * shop's seven slides seeded (scripts/_hero-seed.mjs).
 *
 * ONE PICTURE (2026-10-14, "the first frame"). A first visit used to paint three pictures in a row:
 * the boot shell's old dark banner, then the bundle's drawn slide while ?r=slides was in flight, then
 * the real first photo — 7.0s into a throttled phone visit, with LCP on the drawn banner. With the
 * live shop's slides, on a real phone descriptor (the server picks the phone picture by User-Agent)
 * and a 1280 desktop, throttled as a shopper is, first and return visit, it asserts:
 *
 *   - the ONE picture preloaded is the URL the carousel finally shows, at high priority;
 *   - that picture is downloaded once (the carousel reuses the preload), nothing under /hero/ (the
 *     old banner, the drawn slides) is requested at all, and ?r=slides is asked over the network once;
 *   - every picture ever visible in the hero, frame by frame, is that one URL;
 *   - THE PIXELS AGREE: every screencast frame's hero is that picture, that picture still arriving
 *     (painted top-down), or still empty, and once the picture has appeared no frame goes back to
 *     empty (the gap between React clearing the shell and its photo painting);
 *   - every LCP candidate is that picture, and LCP is when it first shows (not a later repaint).
 *
 * Full on a phone and a desktop (the live Size), and a phone in Tall, where api.php hands a phone the
 * BANNER rather than its phone picture — the boot script's copy of that rule must agree in both.
 *
 * And the other half, so the fix cannot win by breaking the empty shop: with hero_slides EMPTY the
 * page carries no data-hero-slides, the shell preloads and draws the shipped banner exactly as
 * before, and the bundle's drawn slide shows with its picture loaded.
 *
 * ONE HEADING (2026-10-14). The first slide's title is the home page's <h1>, and the caption was
 * display:none, so the page had none. Exactly one h1 in the accessibility tree, the first slide's
 * title, in both languages; on a phone the caption paints nothing and nothing in it takes focus, and
 * from 1024px it is drawn in the photo with the shown slide's Shop link focusable (2026-10-14).
 *
 * ONE TOP (2026-10-14). The shell's header had no room for the menu bar (assets/menu-bar.js, inside
 * header.app-header since 2026-10-02), so the hero dropped 43-46px when React mounted. At
 * 390/412/768/1280/1920, every frame from the first to the settled page has the hero's top within
 * 1px of the settled top — and at least one of them was the shell, or the check measured nothing.
 *
 * Every comparison first asserts it measured something: a hero that never rendered has a perfectly
 * steady height of nothing, and a page that painted no frames shows no wrong picture.
 *
 * SANDBOX ONLY: it rewrites hero_slides and the `hero` settings row, and puts both back exactly.
 * DUMP=<dir> saves every screencast frame the pixel check classified, named by its class.
 */
import { chromium, devices } from 'playwright'
import { snapshotHero, restoreHero, seedLiveHero, setHero, sql } from './_hero-seed.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ONLY = (process.env.ONLY || 'size,picture,heading,top').split(',')
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const strip = (o) => { const c = { ...o }; delete c.defaultBrowserType; return c }
const PHONE = strip(devices['Pixel 7'])
const DESKTOP = { viewport: { width: 1280, height: 800 }, userAgent: devices['Desktop Chrome'].userAgent }
// the measurement agent's shopper: a mid-range phone on 3G-ish, an ordinary desktop line
const THROTTLE = {
  phone: { net: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }, cpu: 4 },
  desktop: { net: { latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 }, cpu: 1 },
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
const saved = snapshotHero()
const empty = () => sql('delete from hero_slides')

// ------------------------------------------------------------------ one height, every Size
const HEIGHTS = () => {
  window.__hero = []
  const t0 = performance.now()
  const tick = () => {
    const sec = document.querySelector('section[aria-roledescription="carousel"]')
    const shell = document.querySelector('.boot-hero')
    const el = sec || (shell && getComputedStyle(shell).display !== 'none' ? shell : null)
    if (el) window.__hero.push([Math.round(performance.now() - t0), sec ? 'hero' : 'shell', Math.round(el.getBoundingClientRect().height)])
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
async function heights(state) {
  for (const size of ['full', 'tall', 'short']) {
    setHero({ size, autoplay: false })
    const home = await (await fetch(`${BASE}/?lang=en`)).text()
    const shop = await (await fetch(`${BASE}/shop?lang=en`)).text()
    check(new RegExp(`<html[^>]*\\bdata-hero-size="${size}"`).test(home), `${state} ${size}: the home page's <html> carries the shop's Size`, (home.match(/<html[^>]*>/) || [''])[0].slice(0, 90))
    check(!/<html[^>]*\bdata-hero-(size|slides|desktop)=/.test(shop), `${state} ${size}: /shop's does not (it has no hero)`)
    for (const [name, opts] of [['phone', PHONE], ['desktop', DESKTOP]]) {
      const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
      await ctx.addInitScript(HEIGHTS)
      const page = await ctx.newPage()
      for (const visit of ['first', 'return']) {
        await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(3100)
        const s = await page.evaluate(() => window.__hero)
        const L = `${state} ${size} ${name} ${visit} visit:`
        check(s.length > 20 && s.some(([, k]) => k === 'hero'), `${L} the hero was measured from its first frame`, `${s.length} frames`)
        const hs = [...new Set(s.map(([, , h]) => h))]
        const trail = s.filter((x, i) => i === 0 || x[2] !== s[i - 1][2]).map(([t, k, h]) => `${t}ms ${k}=${h}`).join(' -> ')
        check(Math.max(...hs) - Math.min(...hs) <= 1, `${L} one height from the first frame to the last`, trail)
      }
      await ctx.close()
    }
  }
}

// ------------------------------------------------------------------ one picture
/* Runs in the page from before the first byte: every animation frame, which pictures are VISIBLE in
   the hero (the shell's, the carousel's, the drawn slides'), and every LCP candidate. */
const PICTURES = () => {
  window.__seen = []; window.__lcp = []; window.__nav = performance.timeOrigin
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), url: (e.url || '').replace(location.origin, ''), tag: e.element ? e.element.tagName : null, size: e.size }) }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch {}
  const shown = (img, box) => {
    if (!img.complete || !img.naturalWidth) return false
    const cs = getComputedStyle(img); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    // the picture's own box, clipped by its frame (the slow zoom scales a picture past its frame,
    // and a neighbour's frame ends exactly where the hero does), and then by the hero
    const a = img.getBoundingClientRect(), p = img.parentElement.getBoundingClientRect()
    const w = Math.min(a.right, p.right, box.right) - Math.max(a.left, p.left, box.left)
    const h = Math.min(a.bottom, p.bottom, box.bottom) - Math.max(a.top, p.top, box.top)
    return w > 2 && h > 2 && w * h > 0.02 * box.width * box.height
  }
  const tick = () => {
    const urls = new Set()
    const sec = document.querySelector('section[aria-roledescription="carousel"]')
    const shell = document.querySelector('.boot-hero')
    const host = sec || shell
    if (host) {
      const box = host.getBoundingClientRect()
      for (const img of host.querySelectorAll('img')) if (shown(img, box)) urls.add((img.currentSrc || img.src).replace(location.origin, ''))
    }
    const key = [...urls].sort().join(' ')
    const last = window.__seen[window.__seen.length - 1]
    if (!last || last.key !== key) window.__seen.push({ t: Math.round(performance.now()), key })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/* A screencast frame's hero, as a 16 x 6 grid of mean RGB, decoded in a page of its own. */
async function grids(dec, frames, rect, vw) {
  return dec.evaluate(async ({ frames, rect, vw }) => {
    const out = []
    for (const f of frames) {
      const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + f.data)).blob())
      const s = bmp.width / vw
      const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0)
      // the top 12px are skipped: the mounted header's drop shadow (0 2px 10px) falls there and the
      // shell's header has none, which would read as a different picture in a short strip
      const x0 = Math.round(rect.left * s), y0 = Math.round((rect.top + 12) * s), w = Math.round(rect.width * s), h = Math.round((Math.min(rect.height, f.vh - rect.top) - 12) * s)
      const d = g.getImageData(x0, y0, w, h).data
      const GX = 16, GY = 6, cells = []
      for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
        let r = 0, gg = 0, b = 0, n = 0
        for (let y = Math.floor(gy * h / GY); y < Math.floor((gy + 1) * h / GY); y += 2) for (let x = Math.floor(gx * w / GX); x < Math.floor((gx + 1) * w / GX); x += 2) {
          const i = (y * w + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++
        }
        cells.push([r / n, gg / n, b / n])
      }
      out.push({ t: f.t, cells })
    }
    return out
  }, { frames, rect, vw })
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const diff = (a, b) => a.reduce((s, c, i) => s + Math.abs(c[0] - b[i][0]) + Math.abs(c[1] - b[i][1]) + Math.abs(c[2] - b[i][2]), 0) / (a.length * 3)
const flat = (a) => { const l = a.map(lum); return Math.max(...l) - Math.min(...l) < 12 }
/* A picture still arriving is painted top-down: its first rows are the picture and the rest is the
   empty box. That is the same picture loading, not a second one. */
const GX = 16
const partial = (a, ref) => {
  const rows = []
  for (let r = 0; r * GX < a.length; r++) {
    const x = a.slice(r * GX, r * GX + GX), y = ref.slice(r * GX, r * GX + GX)
    rows.push(diff(x, y) < 14 ? 'm' : flat(x) ? 'e' : 'o')
  }
  return /^m+o?e+$/.test(rows.join(''))   // the row the decode has reached is part one, part the other
}
const rowsOf = (a, ref) => { let o = ''; for (let r = 0; r * GX < a.length; r++) { const x = a.slice(r * GX, r * GX + GX); o += diff(x, ref.slice(r * GX, r * GX + GX)) < 14 ? 'm' : flat(x) ? 'e' : 'o' } return o }

async function onePicture() {
  const dec = await (await browser.newContext()).newPage()
  // api.php hands a phone its phone picture only in the Full size; in Tall it gets the banner, and
  // the boot script's ported rule must agree in both.
  for (const [name, opts, size, dev] of [['phone', PHONE, 'full', 'phone'], ['desktop', DESKTOP, 'full', 'desktop'], ['phone-tall', PHONE, 'tall', 'phone']].filter((r) => !process.env.RUNS || process.env.RUNS.split(',').includes(r[0]))) {
    setHero({ size, autoplay: false })
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
    await ctx.addInitScript(PICTURES)
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE[dev].net })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE[dev].cpu })
    const reqs = new Map()
    cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url.replace(BASE, ''), bytes: 0, cached: false }))
    cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.cached = true })
    cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache)) r.cached = true })
    cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength })
    let frames = []
    cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data, vh: opts.viewport.height }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
    for (const visit of size === 'full' ? ['first', 'return'] : ['first']) {
      const L = `picture ${name} ${visit} visit:`
      reqs.clear(); frames = []
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: opts.viewport.width, maxHeight: opts.viewport.height, everyNthFrame: 1 })
      const t0 = Date.now() / 1000
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
      await page.waitForFunction(() => { const i = document.querySelector('section[aria-roledescription="carousel"] [aria-hidden="false"] img[src*="slide_image"]'); return i && i.complete && i.naturalWidth }, null, { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await cdp.send('Page.stopScreencast')
      const st = await page.evaluate(() => {
        const cur = document.querySelector('section[aria-roledescription="carousel"] [aria-hidden="false"] img[src*="slide_image"]')
        const sec = document.querySelector('section[aria-roledescription="carousel"]')
        const r = sec ? sec.getBoundingClientRect() : null
        return {
          final: cur ? (cur.currentSrc || cur.src).replace(location.origin, '') : '',
          preloads: [...document.querySelectorAll('link[rel=preload][as=image]')].map((l) => [l.href.replace(location.origin, ''), l.getAttribute('fetchpriority')]),
          seen: window.__seen, lcp: window.__lcp,
          rect: r && { left: r.left, top: r.top, width: r.width, height: r.height },
          bridge: sec ? getComputedStyle(sec).backgroundImage.replace(location.origin, '') : '',
          // what is drawn OVER the picture once the app mounts (css/93-hero-polish.css, 2026-10-14):
          // the controls' pill and, from 1024px, the headline. Not the picture; masked out below.
          overlays: sec ? [sec.querySelector(':scope > div.absolute.bottom-2'), sec.querySelector('[aria-hidden="false"] [class~="md:min-h-[var(--hero-h-md,640px)]"] > div')]
            .filter((e) => e && e.getClientRects().length && getComputedStyle(e).clipPath !== 'inset(50%)')
            .map((e) => { const q = e.getBoundingClientRect(); return { left: q.left - 6, top: q.top - 6, right: q.right + 6, bottom: q.bottom + 6 } }) : [],
        }
      })
      const final = st.final
      check(/slide_image/.test(final), `${L} the carousel settled on a photo slide`, final)
      const phonePic = dev === 'phone' && size === 'full'
      check(phonePic ? /mobile=1/.test(final) : !/mobile=1/.test(final), `${L} and it is the ${phonePic ? 'phone' : 'desktop'} picture ?r=slides gives this device in ${size}`, final)
      const pics = st.preloads.filter(([h]) => /slide_image|\/hero\//.test(h))
      check(pics.length === 1 && pics[0][0] === final && pics[0][1] === 'high', `${L} the one hero picture preloaded IS the one the carousel shows, at high priority`, JSON.stringify(pics))
      const all = [...reqs.values()]
      const got = all.filter((r) => r.url === final)
      const fetched = got.filter((r) => r.bytes > 0 && !r.cached)
      check(visit === 'first' ? fetched.length === 1 : fetched.length === 0, `${L} that picture is downloaded ${visit === 'first' ? 'once' : 'never (it is cached)'}`, `${fetched.length} network fetch(es), ${got.length} request(s)`)
      const drawn = all.filter((r) => /^\/hero\//.test(r.url))
      check(drawn.length === 0, `${L} nothing under /hero/ is requested (no old banner, no drawn slide)`, drawn.map((r) => r.url).join(' '))
      const lists = all.filter((r) => /r=slides(&|$)/.test(r.url) && !r.cached)
      check(lists.length === 1, `${L} ?r=slides is asked over the network once`, String(lists.length))
      const keys = [...new Set(st.seen.map((s) => s.key).filter(Boolean).flatMap((k) => k.split(' ')))]
      check(st.seen.length > 1 && keys.length === 1 && keys[0] === final, `${L} every picture ever visible in the hero is that one`, keys.join(' | ') || '(none seen)')
      check(st.bridge === `url("${final}")`, `${L} the picture laid behind the carousel (for the frames between the shell and the photo) is that one too`, st.bridge)
      const shownAt = (st.seen.find((s) => s.key) || {}).t
      // the pixels
      check(frames.length > 5 && !!st.rect, `${L} the screencast recorded the visit`, `${frames.length} frames`)
      if (frames.length > 5 && st.rect) {
        const g = await grids(dec, frames, st.rect, opts.viewport.width)
        // The pill and the headline appear at mount and the shell has neither, so the cells they
        // cover are not compared: each is replaced, in every frame and the reference alike, by the
        // mean of its row's other cells. An empty frame stays flat; a photo frame stays the photo.
        // (Hiding them with an injected style was tried first and changed what it measured: a
        // blank frame appeared on a phone's return visit that the page without it never shows.)
        const vh = opts.viewport.height, y0 = st.rect.top + 12, hh = Math.min(st.rect.height, vh - st.rect.top) - 12
        const mask = Array.from({ length: 16 * 6 }, (_, i) => {
          const gx = i % 16, gy = Math.floor(i / 16)
          const cx0 = st.rect.left + gx * st.rect.width / 16, cx1 = cx0 + st.rect.width / 16, cy0 = y0 + gy * hh / 6, cy1 = cy0 + hh / 6
          return st.overlays.some((o) => o.left < cx1 && o.right > cx0 && o.top < cy1 && o.bottom > cy0)
        })
        for (const fr of g) for (let gy = 0; gy < 6; gy++) {
          const keep = [...Array(16).keys()].filter((gx) => !mask[gy * 16 + gx]).map((gx) => fr.cells[gy * 16 + gx])
          if (!keep.length || keep.length === 16) continue
          const m = [0, 1, 2].map((c) => keep.reduce((t, v) => t + v[c], 0) / keep.length)
          for (let gx = 0; gx < 16; gx++) if (mask[gy * 16 + gx]) fr.cells[gy * 16 + gx] = m
        }
        check(st.overlays.length >= 1, `${L} the controls drawn over the picture were found and masked`, `${st.overlays.length} overlay(s), ${mask.filter(Boolean).length} of 96 cells`)
        const ref = g[g.length - 1].cells
        let firstMatch = -1, other = [], gaps = []
        for (const [i, fr] of g.entries()) {
          const dd = diff(fr.cells, ref)
          const k = dd < 14 ? 'match' : flat(fr.cells) ? 'empty' : firstMatch < 0 && partial(fr.cells, ref) ? 'arriving' : 'other'
          if (k === 'match' && firstMatch < 0) firstMatch = i
          if (k === 'other') other.push(`${Math.round((fr.t - t0) * 1000)}ms d=${dd.toFixed(0)} rows=${rowsOf(fr.cells, ref)}`)
          if (process.env.DUMP) (await import('node:fs')).writeFileSync(`${process.env.DUMP}/${name}-${visit}-${String(i).padStart(3, '0')}-${k}-${Math.round((fr.t - t0) * 1000)}ms-d${dd.toFixed(0)}.jpg`, Buffer.from(frames[i].data, 'base64'))
          if (k === 'empty' && firstMatch >= 0) gaps.push(`${Math.round((fr.t - t0) * 1000)}ms`)
        }
        check(firstMatch >= 0, `${L} the picture appears in the frames`, firstMatch >= 0 ? `first at ${Math.round((g[firstMatch].t - t0) * 1000)}ms` : '')
        check(other.length === 0, `${L} no frame shows a different picture`, other.slice(0, 6).join(', '))
        check(gaps.length === 0, `${L} once shown, no frame goes back to an empty hero`, gaps.slice(0, 6).join(', '))
      }
      // In Full the hero IS the largest thing on the first screen; in Tall (an 84px strip on a phone)
      // a category tile is, rightly, so there only "no other hero picture" is asked.
      const lc = size === 'full' ? st.lcp.filter((e) => e.size > 50000) : st.lcp.filter((e) => /slide_image|\/hero\//.test(e.url))
      check((size !== 'full' || lc.length > 0) && lc.every((e) => e.url === final), `${L} every ${size === 'full' ? 'large LCP candidate' : 'hero LCP candidate'} is that picture`, lc.map((e) => `${e.t}ms ${e.tag} ${e.url.slice(-40)}`).join(' ; '))
      const lastLcp = st.lcp[st.lcp.length - 1]
      if (size === 'full') check(lastLcp && shownAt !== undefined && lastLcp.t - shownAt < 250, `${L} LCP is when the picture first shows, not a later repaint of it`, lastLcp ? `LCP ${lastLcp.t}ms ${lastLcp.tag}, picture first visible ${shownAt}ms` : 'no LCP')
      console.log(`     ${name} ${visit}: picture visible in the DOM at ${shownAt}ms, LCP ${lastLcp ? lastLcp.t + 'ms ' + lastLcp.tag : '-'}`)
    }
    await ctx.close()
  }
  await dec.context().close()
}

/* With hero_slides EMPTY the boot shell is exactly what it was: the shipped banner, preloaded and
   drawn, and the bundle's drawn slide visible with its picture. */
async function emptyShop() {
  setHero({ size: 'full', autoplay: false })
  const home = await (await fetch(`${BASE}/`)).text()
  check(!/<html[^>]*\bdata-hero-(slides|desktop|phone|focal)=/.test(home), 'empty: the home page carries no slide attributes', (home.match(/<html[^>]*>/) || [''])[0])
  for (const [name, opts] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
    await ctx.addInitScript(() => { window.__shell = null; const mo = new MutationObserver(() => { const i = document.querySelector('.boot-hero-pic img'); if (i && !window.__shell) window.__shell = { src: i.getAttribute('src'), attr: document.documentElement.getAttribute('data-hero-shell') } }); mo.observe(document, { childList: true, subtree: true }) })
    const page = await ctx.newPage()
    const dev = name === 'phone' ? 'mobile' : 'desktop'
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    const s = await page.evaluate(() => ({
      shell: window.__shell,
      preloads: [...document.querySelectorAll('link[rel=preload][as=image]')].map((l) => l.href.replace(location.origin, '')),
      slides: document.documentElement.hasAttribute('data-hero-slides'),
      drawn: [...document.querySelectorAll('section[aria-roledescription="carousel"] .hero-strength img')].filter((i) => i.complete && i.naturalWidth && getComputedStyle(i).display !== 'none').length,
    }))
    check(!s.slides, `empty ${name}: no data-hero-slides on <html>`)
    check(s.preloads.includes(`/hero/${dev}/bodybuilding-men.webp`), `empty ${name}: the shell preloads the shipped banner, as before`, s.preloads.join(' '))
    check(s.shell && s.shell.src === `/hero/${dev}/bodybuilding-men.webp` && s.shell.attr === 'on', `empty ${name}: a first visit's shell draws it, as before`, JSON.stringify(s.shell))
    check(s.drawn > 0, `empty ${name}: the bundle's drawn slide shows, with its picture loaded`, `${s.drawn} picture(s)`)
    await ctx.close()
  }
}

// ------------------------------------------------------------------ one heading
/* The first slide's title is the page's <h1>; the caption is hidden from the eye, not from a screen
   reader, and nothing in it can take focus. Both languages, a phone and a desktop. */
async function oneHeading() {
  for (const [name, opts] of [['phone', PHONE], ['desktop', DESKTOP]]) for (const lang of ['ar', 'en']) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => { const i = document.querySelector('section[aria-roledescription="carousel"] [aria-hidden="false"] img[src*="slide_image"]'); return i && i.complete }, null, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(500)
    const { nodes } = await (await ctx.newCDPSession(page)).send('Accessibility.getFullAXTree')
    const h1 = nodes.filter((x) => !x.ignored && x.role?.value === 'heading' && (x.properties || []).some((q) => q.name === 'level' && q.value.value === 1)).map((x) => x.name?.value)
    const want = sql(`select title_${lang} from hero_slides where active = 1 order by sort, id limit 1`)
    check(h1.length === 1 && h1[0] === want, `heading ${name} ${lang}: exactly one <h1> in the accessibility tree, the first slide's title`, JSON.stringify(h1))
    const cap = await page.evaluate(() => {
      const h = document.querySelector('section[aria-roledescription="carousel"] h1')
      const r = h && h.getBoundingClientRect()
      const focusable = [...document.querySelectorAll('section[aria-roledescription="carousel"] a, section[aria-roledescription="carousel"] [class~="md:min-h-[var(--hero-h-md,640px)]"] *')]
        .filter((e) => (e.tagName === 'A' || e.tabIndex >= 0) && e.getClientRects().length && !e.closest('[aria-hidden="true"]'))
      return { box: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null, painted: h ? getComputedStyle(h.parentElement).clipPath : '', focusable: focusable.length }
    })
    if (name === 'phone') {
      check(cap.painted === 'inset(50%)', `heading ${name} ${lang}: the caption paints nothing (screen-reader-only)`, JSON.stringify(cap))
      check(cap.focusable === 0, `heading ${name} ${lang}: nothing in the hero's caption can take focus`, String(cap.focusable))
    } else {
      // from 1024px the owner chose the headline and Shop button IN the photo (2026-10-14):
      // drawn, and the shown slide's Shop link is the one thing in the caption that takes focus
      check(cap.painted !== 'inset(50%)' && /^[1-9]\d+x[1-9]\d+$/.test(cap.box || ''), `heading ${name} ${lang}: the caption is drawn in the photo (1024px and up)`, JSON.stringify(cap))
      check(cap.focusable === 1, `heading ${name} ${lang}: only the shown slide's Shop link takes focus`, String(cap.focusable))
    }
    await ctx.close()
  }
}

// ------------------------------------------------------------------ one top
async function oneTop() {
  for (const [name, opts] of [
    ['390', strip(devices['iPhone 13'])], ['412', PHONE],
    ['768', { viewport: { width: 768, height: 1024 } }], ['1280', DESKTOP], ['1920', { viewport: { width: 1920, height: 1080 } }],
  ]) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
    await ctx.addInitScript(() => {
      window.__tops = []
      const tick = () => {
        const sec = document.querySelector('section[aria-roledescription="carousel"]'); const shell = document.querySelector('.boot-hero')
        const el = sec || shell
        if (el) window.__tops.push([sec ? 'hero' : 'shell', Math.round(el.getBoundingClientRect().top * 10) / 10])
        if (window.__tops.length < 600) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // menu-bar.js is a deferred script at the END of the page; on a slow line it runs after React has
    // painted the header. Held back here, so the frames without the bar are in the measurement.
    await ctx.route(/\/assets\/menu-bar\.js/, async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.continue() })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })   // so the shell lives for several frames
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
    const t = await page.evaluate(() => window.__tops)
    const bar = await page.evaluate(() => !!document.querySelector('header.app-header > .sp-menubar'))
    const settled = t.length ? t[t.length - 1][1] : NaN
    const shellTops = t.filter(([k]) => k === 'shell').map(([, v]) => v)
    const off = t.filter(([, v]) => Math.abs(v - settled) > 1)
    check(shellTops.length > 0 && t.some(([k]) => k === 'hero') && bar, `top ${name}: the shell, the mounted hero and the menu bar were all measured`, `${shellTops.length} shell frame(s) of ${t.length}, bar ${bar ? 'in' : 'MISSING'}`)
    check(off.length === 0, `top ${name}: the hero's top is within 1px of the settled ${settled}px in every frame`,
      `shell ${[...new Set(shellTops)].join('/')}px` + (off.length ? `; ${off.length} frame(s) off: ${[...new Set(off.map(([k, v]) => `${k} ${v}px`))].join(', ')}` : ''))
    await ctx.close()
  }
}

try {
  if (ONLY.includes('size')) { empty(); await heights('empty'); seedLiveHero(); await heights('seeded') }
  if (ONLY.includes('picture')) { empty(); await emptyShop(); seedLiveHero({ size: 'full', autoplay: false }); await onePicture() }
  if (ONLY.includes('heading')) { seedLiveHero({ size: 'full', autoplay: false }); await oneHeading() }
  if (ONLY.includes('top')) { seedLiveHero({ size: 'full', autoplay: false }); await oneTop() }
} finally {
  restoreHero(saved)
  await browser.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — one height, one picture and one top from the hero\'s first frame')
process.exit(fails ? 1 : 0)
