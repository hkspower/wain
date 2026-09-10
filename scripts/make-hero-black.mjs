/**
 * Builds the "all black" hero banner from a generated photograph plus the REAL
 * brand assets.
 *
 *   node scripts/make-hero-black.mjs <photo.png> [--write]
 *
 * WHY THE TYPE IS NOT GENERATED. An image model draws a logo that is nearly the
 * logo, and a nearly-right brand mark is worse than none. So the model produces
 * only the PHOTOGRAPH — two figures in plain black on a near-black ground, left
 * two thirds empty — and everything with brand meaning in it is composited here
 * from the files the shop already ships: logo-white.png for the lockup, its own
 * orange S for the chest marks, and the Plex faces the site loads.
 *
 * The layout is measured off the existing hero frames rather than invented:
 * lockup top-left, white spaced caps under it, a full-bleed orange band with the
 * headline in near-black, Arabic beneath, a thin spaced tagline last.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2]
const write = process.argv.includes('--write')
if (!SRC) { console.error('usage: node scripts/make-hero-black.mjs <photo.png> [--write]'); process.exit(1) }

const R = 'sporta-site/public_html/'
const b64 = (p) => readFileSync(p).toString('base64')
const font = (p) => 'data:font/woff2;base64,' + b64(R + 'fonts/' + p)

/** 2.52:1 — the artwork ratio the hero's own CSS floor is built around. */
const W = 3200, H = Math.round(3200 / 2.52)   // 1270

const html = `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: Plex; src: url(${font('plex-700-latin.woff2')}) format('woff2');
               font-weight: 700; unicode-range: U+0000-024F, U+2000-206F; }
  @font-face { font-family: Plex; src: url(${font('plex-700-arabic.woff2')}) format('woff2');
               font-weight: 700; unicode-range: U+0600-06FF, U+FB50-FDFF, U+FE70-FEFF; }
  @font-face { font-family: Plex; src: url(${font('plex-600-latin.woff2')}) format('woff2');
               font-weight: 600; unicode-range: U+0000-024F, U+2000-206F; }
  @font-face { font-family: Plex; src: url(${font('plex-600-arabic.woff2')}) format('woff2');
               font-weight: 600; unicode-range: U+0600-06FF, U+FB50-FDFF, U+FE70-FEFF; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0d0e10; }
  .stage { position: relative; width: ${W}px; height: ${H}px; font-family: Plex, system-ui, sans-serif; }

  /* The photograph, cropped to 2.52:1 from the top so the figures keep their
     headroom and the crop takes the empty floor instead of their faces. */
  .shot { position: absolute; inset: 0; overflow: hidden; }
  .shot img { position: absolute; left: 0; top: ${-90 * (W / 2560)}px; width: ${W}px; }

  /* A soft wash back to black across the left, so the type never sits on a
     lit patch of backdrop. */
  .wash { position: absolute; inset: 0;
          background: linear-gradient(90deg, #0d0e10 0%, #0d0e10 34%, rgba(13,14,16,.86) 46%,
                                              rgba(13,14,16,.35) 56%, rgba(13,14,16,0) 66%); }

  .type { position: absolute; left: 190px; top: 232px; width: 1750px; }
  .lock { width: 560px; display: block; }
  .eyebrow { margin-top: 62px; color: #eaecee; font-weight: 600; font-size: 60px;
             letter-spacing: .22em; }

  /* Full-bleed orange band with the angled tail the shipped frames use. */
  .band { position: absolute; left: 0; top: 612px; height: 212px; width: 1640px;
          background: #f5821f; clip-path: polygon(0 0, 100% 0, calc(100% - 74px) 100%, 0 100%);
          display: flex; align-items: center; }
  .band h1 { color: #171a1e; font-weight: 700; font-size: 152px; letter-spacing: .01em;
             padding-left: 190px; line-height: 1; }

  .ar { position: absolute; left: 190px; top: 876px; color: #eaecee; font-weight: 700;
        font-size: 82px; direction: rtl; }
  .tag { position: absolute; left: 194px; top: 1004px; color: #a6acb2; font-weight: 600;
         font-size: 38px; letter-spacing: .3em; }

  /* The S on the garments: the shop's own mark, dropped to the fabric with a
     touch of transparency so it reads as print rather than a sticker. */
  .mark { position: absolute; opacity: .86; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
</style>
<div class="stage">
  <div class="shot"><img src="data:image/png;base64,${b64(SRC)}"></div>
  <div class="wash"></div>

  <img class="mark" id="m1" src="data:image/png;base64,${b64(R + 'logo-white.png')}">
  <img class="mark" id="m2" src="data:image/png;base64,${b64(R + 'logo-white.png')}">

  <div class="type">
    <img class="lock" src="data:image/png;base64,${b64(R + 'logo-white.png')}">
    <div class="eyebrow">MEN &amp; WOMEN</div>
  </div>
  <div class="band"><h1>ALL BLACK</h1></div>
  <div class="ar">الأسود بالكامل</div>
  <div class="tag">FOR HIM &middot; FOR HER</div>
</div>
<script>
  /* Only the S, cropped out of the lockup by the orange run measured in the
     file (x 0..165 of 800), and placed on each chest. */
  const S_W = 165, LOCK_W = 800, LOCK_H = 246
  function markAt(el, cx, cy, w) {
    const scale = w / S_W
    el.style.width = (LOCK_W * scale) + 'px'
    el.style.clipPath = 'inset(0 ' + ((1 - S_W / LOCK_W) * 100) + '% 0 0)'
    el.style.left = (cx - w / 2) + 'px'
    el.style.top  = (cy - (LOCK_H * scale) / 2) + 'px'
  }
  const k = ${W} / 2560
  markAt(document.getElementById('m1'), 1664 * k, (704 - 90) * k, 118 * k)
  markAt(document.getElementById('m2'), 2128 * k, (726 - 90) * k, 74 * k)
</script>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(600)
const png = await page.screenshot()

/* webp at both hero sizes, from the one 3200px render — the same Chromium
   canvas the mobile hero rebuild uses, and never an upscale: 1200 and 3200 are
   both <= the render, so this only ever throws pixels away. */
const enc = async (width, q) => {
  const r = await page.evaluate(async ({ b64, width, q }) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode()
    const h = Math.round(i.naturalHeight * (width / i.naturalWidth))
    const c = document.createElement('canvas'); c.width = width; c.height = h
    const k = c.getContext('2d')
    k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high'
    k.drawImage(i, 0, 0, width, h)
    return { data: c.toDataURL('image/webp', q), w: width, h }
  }, { b64: png.toString('base64'), width, q })
  return { bytes: Buffer.from(r.data.split(',')[1], 'base64'), w: r.w, h: r.h }
}

const targets = [
  ['sporta-site/public_html/hero/desktop/all-black.webp', 3200, 0.9],
  ['sporta-site/public_html/hero/mobile/all-black.webp', 1200, 0.82],
]
for (const [path, width, q] of targets) {
  const r = await enc(width, q)
  const out = write ? path : '/tmp/hero/' + path.split('/').slice(-2).join('-')
  writeFileSync(out, r.bytes)
  console.log(`${write ? 'wrote' : 'preview'} ${out}  ${r.w}x${r.h}  ${Math.round(r.bytes.length / 1024)} kB`)
}
if (!write) writeFileSync('/tmp/hero/banner.png', png)
await browser.close()
