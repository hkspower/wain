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

/* THE CHEST PRINTS ARE OPTIONAL, and off by default since 2026-09-11 — the
 * owner asked for the banner without them. The whole mark pipeline is KEPT
 * rather than deleted: it is measured, mutation-tested and correct (hue 27/28
 * against the brand's 26, shading taken from the fabric itself, masked to the
 * letterform), and `--marks` brings it straight back. Deleting the branch you
 * are not taking decides for everyone who comes after, and this project has
 * already paid once for that and once for the reverse. */
const marks = process.argv.includes('--marks')

/* THE COPY, in one place, because it is the part most likely to change and the
 * part the owner owns. The shipped frames set the pattern and it is followed
 * rather than invented: a small English category line, a headline in the orange
 * band, the Arabic beneath it, and a three-term strapline last
 * ("MEN'S TRAINING" / "BODY BUILDING" / كمال الأجسام / "STRENGTH · MUSCLE · POWER").
 *
 * "ALL BLACK" stated a colour. A commercial hero has to name something you can
 * SHOP, so the headline is the range and the Arabic is its true counterpart
 * rather than a literal translation — تشكيلة is the word a Gulf retailer uses
 * for an edit or a collection, which is what "EDIT" means here. The strapline
 * moves from an attribute list to the training cycle, so it reads as a reason
 * to buy rather than as three adjectives.
 *
 * NOTHING HERE IS A CLAIM ABOUT THE SHOP. No price, no delivery promise, no
 * discount — those are facts the owner sets in /backends and they go stale in a
 * raster the moment they change. */
const COPY = {
  eyebrow: 'NEW IN &middot; MEN &amp; WOMEN',
  headline: 'THE BLACK EDIT',
  arabic: 'تشكيلة الأسود',
  strapline: 'TRAIN &middot; PERFORM &middot; RECOVER',
}
if (!SRC) { console.error('usage: node scripts/make-hero-black.mjs <photo.png> [--write]'); process.exit(1) }

const R = 'sporta-site/public_html/'
const b64 = (p) => readFileSync(p).toString('base64')
const font = (p) => 'data:font/woff2;base64,' + b64(R + 'fonts/' + p)

/** 2.52:1 — the artwork ratio the hero's own CSS floor is built around. */
const W = 3200, H = Math.round(3200 / 2.52)   // 1270

/* THE PHONE CROP, which is the constraint that decides this layout and which
 * nothing here had accounted for. The hero is object-fit: cover with
 * object-position: 15% center, and under 768px the box is aspect-ratio 2.10/1
 * (sporta-ui.css:319, 402-403). A 2.52:1 file in a 2.10 box shows
 *
 *     2.10 / 2.52 = 83.3% of the width
 *     at object-position 15%  ->  the window runs 2.5% .. 85.8%
 *
 * so the right-hand 14.2% of the artwork is DISCARDED on every phone. The
 * shipped banners survive that because their single athlete sits well inside;
 * a pair pushed to the right edge does not. Rendered and checked: the woman was
 * being sliced vertically through her face on a 390px screen.
 *
 * So the photograph is shifted LEFT until her right edge lands inside the
 * window, and the orange band is shortened to make room rather than the figures
 * being scaled down — scaling them would leave them floating in a 1270px band
 * they no longer fill. */
const PHONE_EDGE = 0.858 * W          // 2746 — nothing that matters may sit right of this
const SHIFT = -233                    // photo left offset, derived from the woman's edge

/* WHY -233 AND NOT -453. The first value was set while an orange S sat on each
 * chest; with the prints gone the picture showed what they had been masking —
 * roughly 735px of dead black between the woman and the right edge, with the
 * pair crowded toward the type instead of anchored to the frame. Moving them
 * right fills that void and doubles the gap between the man's arm and the
 * band's tail. The limit is the phone crop above: the woman's right edge lands
 * at 2685 against a crop line of 2746, so she clears it by 61px. There is no
 * more room than that — do not shift further right without re-measuring. */

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
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0a0b0c; }
  .stage { position: relative; width: ${W}px; height: ${H}px; font-family: Plex, system-ui, sans-serif; }

  /* The photograph, cropped to 2.52:1 from the top so the figures keep their
     headroom and the crop takes the empty floor instead of their faces. */
  .shot { position: absolute; inset: 0; overflow: hidden; }
  .shot img { position: absolute; left: ${SHIFT}px; top: 0; width: ${W}px; }

  /* A soft wash back to black across the left, so the type never sits on a
     lit patch of backdrop. */
  /* The wash back to black across the left, so the type never sits on a lit
     patch of backdrop — and the plate is #0a0b0c rather than the #0d0e10 token
     because the PHOTOGRAPH's own backdrop measures ~10.5 where it ends. With
     the token, columns ran 10.5 up to x=2740 and then jumped to a flat 13.93:
     a 3.4-level vertical step down the right of the banner, which reads as a
     printing fault rather than as a background. */
  .wash { position: absolute; inset: 0;
          background: linear-gradient(90deg, #0a0b0c 0%, #0a0b0c 22%, rgba(10,11,12,.88) 31%,
                                              rgba(10,11,12,.34) 34%, rgba(10,11,12,0) 40%); }

  .type { position: absolute; left: 190px; top: 232px; width: 1750px; }
  .lock { width: 560px; display: block; }
  .eyebrow { margin-top: 62px; color: #eaecee; font-weight: 600; font-size: 60px;
             letter-spacing: .22em; }

  /* THE ORANGE BAND RUNS THE FULL WIDTH, edge to edge, and the athletes stand
     IN FRONT OF IT. A full-width band drawn over the photograph would paint
     across their torsos; drawn under it, the photograph's own opaque black
     backdrop would hide it completely. So the figures are cut out of the
     photograph and laid back on top — the band passes behind them.

     The cutout is a luminance mask, which works here only because the backdrop
     really is near-black: measured on this photograph, columns 0-760 of the
     mask are entirely empty, the two figures run 0.43-0.79 solid, and the dip
     to 0.09 at column 1160 is the real gap between them. The garments sit at
     mean 32.7 against a backdrop near 10, so the threshold has honest room.

     No angled tail any more: a tail is how a band ENDS, and this one does not. */
  .band { position: absolute; left: 0; top: 612px; height: 212px; width: 100%;
          background: #f5821f; display: flex; align-items: center; }

  /* The figures, put back over the band. Same geometry as .shot img exactly, or
     they would sit a pixel off their own shadow. */
  .cutout { position: absolute; left: ${SHIFT}px; top: 0; width: ${W}px; }
  .band h1 { color: #171a1e; font-weight: 700; font-size: 130px; letter-spacing: .01em;
             padding-left: 190px; line-height: 1; }

  .ar { position: absolute; left: 190px; top: 876px; color: #eaecee; font-weight: 700;
        font-size: 82px; direction: rtl; }
  .tag { position: absolute; left: 194px; top: 1004px; color: #a6acb2; font-weight: 600;
         font-size: 38px; letter-spacing: .3em; }

  /* THE S ON THE GARMENTS, PRINTED RATHER THAN PASTED.
     A flat overlay reads as a sticker because it ignores the cloth: it keeps
     its own even tone across folds the fabric plainly has, and it sits on the
     picture plane while the chest is turned. Three things fix that, and the
     middle one does most of the work:

       1. the mark is put on the BODY's plane — a small rotate and skew taken
          from the way each figure stands, not from the frame;
       2. the PHOTOGRAPH ITSELF is composited back over the mark in overlay blend,
          clipped to the mark's own box, so every fold, shadow and rim highlight
          on that piece of shirt modulates the print exactly as it modulates the
          cloth around it — the shading is the real shading, not an invented one;
       3. a sub-pixel blur and a hair of transparency, because a screen print on
          jersey has no razor edge and this photograph has a focus falloff the
          mark has to share. */
  .mark { position: absolute; overflow: hidden; opacity: .93;
          filter: blur(.25px) saturate(.98);
          -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
          -webkit-mask-position: 0 0; mask-position: 0 0; }
  .mark .s   { position: absolute; left: 0; top: 0; display: block; }
  /* SHADING ONLY, PIVOTED ON MID-GREY. The first version blended the photograph
     in overlay, and overlay against a near-black shirt multiplies: measured, the
     brand's 255,124,23 (hue 26) printed as 197,13,5 (hue 3) — the green channel
     collapsed and the mark went RED. A brand mark that is nearly the brand
     colour is the same failure as a logo that is nearly the logo.
     So the fabric layer is reduced to LUMINANCE, lifted until its mid-tone sits
     on 50% grey and flattened, then blended in soft-light — which is identity at
     mid-grey. The folds still push either side of it; the hue does not move. */
  .mark .fab { position: absolute; mix-blend-mode: soft-light; opacity: .88;
               filter: grayscale(1) brightness(5.6) contrast(.42); }
</style>
<div class="stage">
  <div class="shot"><img src="data:image/png;base64,${b64(SRC)}"></div>
  <div class="wash"></div>

  ${marks ? `
  <div class="mark" id="m1">
    <img class="s" src="data:image/png;base64,${b64(R + 'logo-white.png')}">
    <img class="fab" src="data:image/png;base64,${b64(SRC)}">
  </div>
  <div class="mark" id="m2">
    <img class="s" src="data:image/png;base64,${b64(R + 'logo-white.png')}">
    <img class="fab" src="data:image/png;base64,${b64(SRC)}">
  </div>` : ''}

  <div class="type">
    <img class="lock" src="data:image/png;base64,${b64(R + 'logo-white.png')}">
    <div class="eyebrow">${COPY.eyebrow}</div>
  </div>
  <div class="band"><h1>${COPY.headline}</h1></div>
  <img class="cutout" id="cutout">
  <div class="ar">${COPY.arabic}</div>
  <div class="tag">${COPY.strapline}</div>
</div>
<script>
  /* Only the S, cropped out of the lockup by the orange run measured in the
     file (x 0..165 of 800), and placed on each chest. */
  const S_W = 165, LOCK_W = 800, LOCK_H = 246
  const PHOTO_W = ${W}

  /* cx, cy, w in the PHOTOGRAPH's own pixels; rot/skew put the mark on the
     plane the chest is actually turned to. */
  function markAt(el, cx, cy, w, rot, skew) {
    const scale = w / S_W
    const h = LOCK_H * scale
    const left = cx - w / 2, top = cy - h / 2

    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    el.style.transform = 'rotate(' + rot + 'deg) skewY(' + skew + 'deg)'
    el.style.transformOrigin = '50% 50%'

    // the lockup, scaled so its S is exactly w wide; the container clips the rest
    el.querySelector('.s').style.width = (LOCK_W * scale) + 'px'

    /* AND THE CONTAINER IS MASKED TO THE LETTERFORM, not left as a box. The
       shading layer below fills its rectangle, and soft-light over the
       transparent corners painted a visible grey PANEL around the S — the mark
       looked appliqued onto a patch. Masking the whole container with the same
       lockup, at the same size and origin, means the fabric's shading exists
       only inside the glyph. */
    const m = 'url(' + el.querySelector('.s').src + ')'
    el.style.webkitMaskImage = m
    el.style.maskImage = m
    el.style.webkitMaskSize = (LOCK_W * scale) + 'px auto'
    el.style.maskSize = (LOCK_W * scale) + 'px auto'

    // the photograph, put back exactly where it sits in the stage, so the piece
    // of shirt showing through the mark's box is the SAME piece of shirt
    const fab = el.querySelector('.fab')
    fab.style.width = PHOTO_W + 'px'
    fab.style.left = (${SHIFT} - left) + 'px'
    fab.style.top = -top + 'px'
  }

  /* Centres and widths in the PHOTOGRAPH's own 2560-space, then mapped into the
     banner and shifted with it. The widths are 200 and 130 rather than the 118
     and 74 used before, because the mark is judged at the size it is SEEN: at
     the 1600-wide deliverable those land at 125px and 81px, and on a 390px
     phone — where cover scales the artwork to ~468px wide — at 37px and 24px.
     The previous pair came out at 22px and 14px there, which is a smudge, not
     a logo. */
  const k = PHOTO_W / 2560
  const SH = ${SHIFT}
  if (${marks}) {
    markAt(document.getElementById('m1'), 1560 * k + SH, 755 * k, 200 * k, -4, 3)
    markAt(document.getElementById('m2'), 2065 * k + SH, 755 * k, 130 * k, -3, 2)
  }
</script>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.setContent(html, { waitUntil: 'networkidle' })

/* Build the figure cutout from the photograph itself and hand it to the layer
   above the band. lo/hi are a smoothstep across the gap between the backdrop
   and the garments — wide enough that hair and rim light feather rather than
   cut, narrow enough that the backdrop stays fully transparent. */
await page.evaluate(async ({ src, w, t, radius }) => {
  const i = new Image(); i.src = src; await i.decode()
  const h = Math.round(i.height * w / i.width)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const k = c.getContext('2d', { willReadFrequently: true })
  k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high'
  k.drawImage(i, 0, 0, w, h)
  const im = k.getImageData(0, 0, w, h), px = im.data

  /* A PLAIN LUMINANCE RAMP LEAKED, and the leak is what a straight threshold
     always does here: the garments are dark, so their shadowed panels sat
     part-transparent and the orange band showed THROUGH the clothing — visible
     mottling across the man's shoulder and a soft orange cloud where the
     backdrop's own rim glow sits. Both are the same fault read two ways.

     So: a hard threshold, then a morphological CLOSE approximated by a box blur
     and a steep remap. A hole smaller than the blur radius fills; a gap larger
     than it stays open — which is exactly the behaviour needed, because the
     real gap between the two figures is ~60px wide and must NOT be bridged
     while a 10px shadow inside a sleeve must be.

     AND THE MASK IS DELIBERATELY OVER-INCLUSIVE, because the measured
     distributions say no threshold can be exact. At the cutout's working scale:

       backdrop beside the figures   p5 9.4   p50 10.4   p95 11.4   (flat)
       the woman's torso             p5 7.0   p25 16.2   p50 44.0
       the man's torso               p5 10.4  p25 31.1   p50 41.5

     The darkest fifth of both garments sits AT OR BELOW the backdrop next to
     them, so the two populations genuinely overlap and any cut costs something.
     Erring tight puts ORANGE THROUGH A SHIRT; erring loose leaves a thin dark
     halo around the figures where they meet the band, which reads as their own
     shadow. The remap window is therefore biased low, which dilates. */
  const a = new Float32Array(w * h)
  for (let q = 0, o = 0; q < w * h; q++, o += 4) {
    const l = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]
    a[q] = l > t ? 1 : 0
  }

  // separable box blur over the alpha only
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (radius * 2 + 1)
      sum -= a[y * w + Math.min(w - 1, Math.max(0, x - radius))]
      sum += a[y * w + Math.min(w - 1, Math.max(0, x + radius + 1))]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      a[y * w + x] = sum / (radius * 2 + 1)
      sum -= tmp[Math.min(h - 1, Math.max(0, y - radius)) * w + x]
      sum += tmp[Math.min(h - 1, Math.max(0, y + radius + 1)) * w + x]
    }
  }

  // steep remap: closes what the blur filled, keeps a 1-2px feather at the edge
  for (let q = 0, o = 0; q < w * h; q++, o += 4) {
    let v = (a[q] - 0.20) / (0.50 - 0.20)
    v = v < 0 ? 0 : v > 1 ? 1 : v
    px[o + 3] = Math.round(v * v * (3 - 2 * v) * 255)
  }
  /* STRAY MASS AT THE PHOTOGRAPH'S RIGHT EDGE, and a weight threshold is the
     WRONG TOOL for it. A ragged dark patch was punching into the band; the
     first guess was a speck, so columns carrying under 3% of the heaviest
     column's alpha were dropped. It survived — measured, those columns carry
     9% to 14%, rising to 21% at the very edge. It is not a speck, it is a tall
     bright strip in the photograph's own right margin, and no percentage floor
     separates it from a figure without also eating one.

     What DOES separate them is connectedness. The figures are two contiguous
     runs of heavy columns; the artifact is a separate run beyond the woman,
     with nothing but backdrop between. So the columns are labelled into runs
     and a run is kept only if it PEAKS like a person — a quarter of the
     heaviest column. The artifact peaks at 21% and goes; both figures peak far
     above and stay. The inter-figure gap is preserved because they are two
     runs, not one, and each is judged on its own peak. */
  const colSum = new Float32Array(w)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) colSum[x] += px[(y * w + x) * 4 + 3]
  let maxCol = 0
  for (let x = 0; x < w; x++) if (colSum[x] > maxCol) maxCol = colSum[x]

  const live = maxCol * 0.01          // a column with anything in it at all
  const peak = maxCol * 0.25          // what a run must reach to be a person
  const keep = new Uint8Array(w)
  for (let x = 0; x < w; x++) {
    if (colSum[x] < live) continue
    let end = x, hi = 0
    while (end < w && colSum[end] >= live) { if (colSum[end] > hi) hi = colSum[end]; end++ }
    if (hi >= peak) for (let q = x; q < end; q++) keep[q] = 1
    x = end
  }
  for (let x = 0; x < w; x++) {
    if (keep[x] && x >= 14 && x <= w - 15) continue
    for (let y = 0; y < h; y++) px[(y * w + x) * 4 + 3] = 0
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < 14; y++) px[(y*w+x)*4+3] = 0
  for (let x = 0; x < w; x++) for (let y = h - 14; y < h; y++) px[(y*w+x)*4+3] = 0

  k.putImageData(im, 0, 0)
  const el = document.getElementById('cutout')
  await new Promise((r) => { el.onload = r; el.src = c.toDataURL('image/png') })
}, { src: 'data:image/png;base64,' + b64(SRC), w: W, t: 12, radius: 12 })

await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(600)

/* The headline must not run into the figures — the band is full width now, so
   nothing stops it but this measurement. */
const fit = await page.evaluate(() => {
  /* MEASURE THE GLYPHS, NOT THE BOX. The first version read
     .eyebrow.getBoundingClientRect(), and .eyebrow is a block div inside a
     1750px container — so it reported 1940 whatever the text said, and a
     perfectly well-fitting line was trimmed on the strength of it. A Range over
     the text node measures what is actually drawn. */
  const ink = (sel) => {
    const el = document.querySelector(sel)
    const r = document.createRange()
    r.selectNodeContents(el)
    return Math.round(r.getBoundingClientRect().right)
  }
  return { headlineEnds: ink('.band h1'), eyebrowEnds: ink('.eyebrow'),
           arabicEnds: ink('.ar'), strapEnds: ink('.tag') }
})
console.log(`ink ends — headline ${fit.headlineEnds}  eyebrow ${fit.eyebrowEnds}`
  + `  arabic ${fit.arabicEnds}  strapline ${fit.strapEnds}   (the man's left edge is ~1296)`)
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
