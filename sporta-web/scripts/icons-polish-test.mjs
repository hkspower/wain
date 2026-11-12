// ICONS POLISH - the "Icons" sections of public/sporta-shadows.css and public/sporta-clock.css, and the icon files.
//
//   npm run test:icons-polish         (no rig: fixtures + the real add-on files + headless Chromium + node)
//
// Part 1, the storefront's inline SVG icons (the compiled build, so only add-on CSS can change them), on the captured
// live markup + the recorded live rules + real Tailwind + the add-ons the live index.html links, at 320 / 390 / 768 /
// 1280 wide, Arabic RTL (the default) and English LTR:
//   stroke      every icon is drawn with one of two screen-px weights (1.5px up to a 20px box, 1.75px from 21px), on the
//               SHAPES (vector-effect on the <svg> never did anything: strokes scaled with the box, 0.95 to 1.75px)
//   scale       every icon box is on 14 / 16 / 18 / 20 / 22 (the features tile is rem-sized by sporta-home-trim.css)
//   pixels      an icon in a whole-pixel button starts on a whole pixel (a 17px icon in 44px sat at x=13.5)
//   alignment   an icon beside a label is within 1.25px of the vertical centre of mass of the label's pixels (Arabic ink
//               sits lower in the line than Latin); icon-only controls stay centred in their box
//   contrast    every icon, and the clock face ring, is at least 3:1 against its real background
//   targets     icon-only controls are at least 43.5px (2.75rem at the live root size) and, outside the header, 44px
//   states      hover scales the AI launcher's icon like its neighbours, keeps the stroke; keyboard focus draws a ring
//   direction   in RTL the returns arrow is mirrored and no other icon is; in LTR none is
//   displacement  before / after boxes: no icon moves more than the intended amount
//   always      nothing overflows sideways
//   mutation    with the Icons sections cut from both files, this same suite must fail (the count is printed)
// Part 2, node only: PNG headers against what the manifest, index.html and the og tags declare; the app-icon defects
// measured on public/ (reported as NOTE: the files are the owner's to replace); the corrected set in brand/icons-polish/
// (byte-identical to what scripts/make-icons-polish.mjs makes, whole S, padded, maskable inside the safe circle);
// the "photo coming soon" tile; the Sporta AI icon concepts (validity, 16/24/32px, both grounds: information for the
// owner, nothing is chosen or wired in).
//
// LIVE CHECK lines at the end list what the capture cannot show and must be measured on the live site.
import { chromium } from 'playwright'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { page, measure, inkCentre, cut, sectionOf, MARK, FILES, ROOT } from './lib/icons-polish-page.mjs'
import { KINDS } from './fixtures/icons-polish.mjs'
import { png, pngHeader } from './lib/png.mjs'
import { build as buildIcons, SET as ICON_SET, SHAPE } from './make-icons-polish.mjs'

const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const WIDTHS = [320, 390, 768, 1280]
const LANGS = ['ar', 'en']
const PLACEHOLDER = readFileSync(join(ROOT, 'public/product-photo-unavailable.svg'))

let pass = 0, fail = 0, quiet = false
const failures = []
const is = (ok, msg, detail = '') => {
  if (ok) pass++; else { fail++; failures.push(msg) }
  if (!quiet) console.log((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && detail ? '  - ' + detail : ''))
}
const note = (msg) => { if (!quiet) console.log('NOTE ' + msg) }
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`) }
const near = (a, b, t) => Math.abs(a - b) <= t
const f1 = (n) => (Math.round(n * 100) / 100).toString()

// Part 1 expectations ------------------------------------------------------------------------------------------
const SCALE = new Set([14, 16, 18, 20, 22])
const TIER = (attr) => (attr >= 21 ? 1.75 : 1.5)
// icon-only controls (the icon is the only content): centred, targets, whole pixels
const ICON_ONLY = ['header.ai@phone', 'header.bag', 'footer.insta', 'footer.tiktok', 'footer.wa', 'drawer.close', 'drawer.minus', 'drawer.plus', 'drawer.remove', 'card.heart', 'card.add', 'gallery.zoom', 'gallery.arrow', 'product.minus', 'product.plus', 'tile.arrow']
const HEADER = new Set(['header.ai', 'header.bag', 'header.globe'])
// icons beside a label whose ink alignment is asserted (id -> kind)
const LABELLED = ['header.ai', 'header.globe', 'footer.club', 'footer.cod', 'drawer.note', 'product.sizeguide', 'product.r1', 'product.r2', 'product.r3', 'product.oos']
// the most an icon may move (px) between the live CSS and the section, per id: the box snap and the alignment nudge
const MOVE = { 'product.r1': 2.6, 'product.r2': 2.6, 'product.r3': 2.6 }

const suite = async (br, overrides, label) => {
  const BEFORE = Object.fromEntries(FILES.map((f) => [f, cut(read(f))]))
  for (const lang of LANGS) for (const w of WIDTHS) for (const kind of KINDS) {
    head(`${label} ${lang} ${w}px ${kind}`)
    const mk = async (ov, dpr) => {
      const ctx = await br.newContext({ viewport: { width: w, height: 1200 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', deviceScaleFactor: dpr })
      const pg = await ctx.newPage()
      await pg.route('https://fixture.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: PLACEHOLDER }))
      await pg.setContent(page(kind, lang, ov)); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(60)
      return pg
    }
    const pg = await mk(overrides, 2), base = await mk(BEFORE, 2)
    const M = await pg.evaluate(measure), B = await base.evaluate(measure)
    await base.context().close()
    const rtl = lang === 'ar'
    const icons = Object.values(M).filter((r) => r.id && r.attrW && r.rect.w > 0 && r.display !== 'none')
    const tag = (r) => `${r.id}`

    is(M.__page.over <= 0, 'nothing overflows sideways', `${M.__page.over}px`)
    // stroke -------------------------------------------------------------------------------------------------
    for (const r of icons) {
      const want = r.id.startsWith('home.feature') ? 1.75 : TIER(r.attrW)
      is(r.ve === 'non-scaling-stroke' && near(r.stroke, want, 0.01), `${tag(r)} stroke is ${want}px on the shapes`, `ve=${r.ve} stroke=${f1(r.stroke)} (sw ${r.sw}) attr ${r.attrW}`)
    }
    // scale --------------------------------------------------------------------------------------------------
    for (const r of icons) {
      if (r.id.startsWith('home.feature') || r.id === 'drawer.mark') continue
      is(SCALE.has(Math.round(r.rect.w)) && near(r.rect.w, r.rect.h, 0.01) && near(r.rect.w, Math.round(r.rect.w), 0.01), `${tag(r)} box ${f1(r.rect.w)}px is on the 14/16/18/20/22 scale`, `${f1(r.rect.w)}x${f1(r.rect.h)}`)
    }
    // whole pixels + centred (icon-only controls) ---------------------------------------------------------------
    for (const r of icons) {
      const id = r.id === 'header.ai' && w < 640 ? 'header.ai@phone' : r.id
      if (!ICON_ONLY.includes(id)) continue
      is(near(r.dx, 0, 0.51) && near(r.dy, 0, 0.51), `${tag(r)} stays centred in its control`, `dx ${f1(r.dx)} dy ${f1(r.dy)}`)
      if (Number.isInteger(Math.round(r.box.w * 100) / 100) && Number.isInteger(Math.round(r.box.h * 100) / 100)) {
        is(near(r.offL, Math.round(r.offL), 0.02) && near(r.offT, Math.round(r.offT), 0.02), `${tag(r)} starts on a whole pixel in its ${f1(r.box.w)}px control`, `offset ${f1(r.offL)}, ${f1(r.offT)}`)
      }
    }
    // contrast -----------------------------------------------------------------------------------------------
    for (const r of icons) {
      if (r.id === 'drawer.mark') continue
      is(r.contrast >= 3, `${tag(r)} is ${f1(r.contrast)}:1 against its background (3:1)`, `fg ${r.fg} bg ${r.bg} op ${r.opacity}`)
    }
    if (M['header.dot']) is(M['header.dot'].contrast >= 3, `announcement dot is ${f1(M['header.dot'].contrast)}:1 (3:1)`)
    if (M.__clock) is(M.__clock.contrast >= 3, `clock face ring is ${f1(M.__clock.contrast)}:1 against the header (3:1)`, M.__clock.stroke)
    // targets --------------------------------------------------------------------------------------------------
    for (const r of icons) {
      const id = r.id === 'header.ai' && w < 640 ? 'header.ai@phone' : r.id
      if (!ICON_ONLY.includes(id) && !HEADER.has(r.id)) continue
      if (r.id === 'tile.arrow') continue
      const min = HEADER.has(r.id) ? 43.5 : 43.99
      is(r.box.w >= min && r.box.h >= min, `${tag(r)} control is ${f1(r.box.w)}x${f1(r.box.h)} (min ${min})`)
    }
    // direction ------------------------------------------------------------------------------------------------
    for (const r of icons) {
      const mirrored = rtl && (r.id === 'home.feature0' || r.id === 'product.r3')
      is(r.flipped === mirrored, `${tag(r)} ${mirrored ? 'is mirrored in RTL (a directional arrow)' : 'is not mirrored (not directional)'}`, `flipped=${r.flipped}`)
    }
    // displacement (before / after) ----------------------------------------------------------------------------
    for (const r of icons) {
      const b = B[r.id]; if (!b || !b.rect.w || r.id === 'drawer.mark') continue
      if (b.label && r.label && b.label.lines !== r.label.lines) { note(`${r.id}: its label went from ${b.label.lines} to ${r.label.lines} line(s) at ${w}px in ${lang} (a 1px wider icon tipped a line that was within 1px of full; the English copy here is the repo's wording, the live copy is not known)`); continue }
      const cx = (m) => m.rect.x + m.rect.w / 2, cy = (m) => m.rect.y + m.rect.h / 2
      const lim = MOVE[r.id] ?? (LABELLED.includes(r.id) ? 1.6 : 1.1)
      const dxx = Math.abs(cx(r) - cx(b)), dyy = Math.abs(cy(r) - cy(b))
      // the icon's own box may grow by one px; its centre moves by the layout the larger box causes (<= 1px) and the nudge (<= 1px)
      is(Math.abs(r.rect.w - b.rect.w) <= 1.01 && dxx <= lim + 0.5 && dyy <= lim, `${tag(r)} moved ${f1(dxx)}, ${f1(dyy)}px and changed size by ${f1(r.rect.w - b.rect.w)}px (limit ${lim})`)
    }
    // states (1280 only: hover needs a pointer) ---------------------------------------------------------------------
    if (w === 1280 && kind === 'header') {
      for (const sel of ['.navbar-ai', '.navbar-language', '.navbar-cart']) {
        await pg.hover(sel); await pg.waitForTimeout(320)
        const st = await pg.evaluate((s) => { const svg = document.querySelector(s + ' svg.sporta-icon'), cs = getComputedStyle(svg); return { sc: cs.transform === 'none' ? 1 : new DOMMatrix(cs.transform).a, sw: parseFloat(cs.strokeWidth) } }, sel)
        const sc = st.sc
        is(near(sc, 1.08, 0.02), `${sel} icon grows 8% on hover`, `scale ${f1(sc)}`)
        is(near(st.sw, sel === '.navbar-cart' ? 1.75 : 1.5, 0.01), `${sel} icon keeps its stroke on hover`, `${st.sw}`)
      }
      await pg.mouse.move(0, 700)
    }
    // keyboard focus: every icon control draws a ring that is visible against what is behind it -------------------
    {
      const ring = []
      await pg.evaluate(() => document.body.focus())
      for (let i = 0; i < 24; i++) {
        await pg.keyboard.press('Tab')
        const info = await pg.evaluate(() => {
          const a = document.activeElement; if (!a || a === document.body) return null
          const cs = getComputedStyle(a), ic = a.querySelector(':scope > .sporta-icon, :scope > [data-ic]')
          if (!ic) return null
          const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
          const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
          const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3])]
          let bg = [255, 255, 255]; const stack = []
          for (let n = a.parentElement; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break }
          for (const c of stack.reverse()) bg = over(c, bg)
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
          const L = ([r, g, b]) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
          const oc = over(rgba(cs.outlineColor), bg), [hi, lo] = [L(oc), L(bg)].sort((x, y) => y - x)
          return { id: ic.getAttribute('data-ic'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), ratio: (hi + 0.05) / (lo + 0.05), color: cs.outlineColor }
        })
        if (info) ring.push(info)
      }
      for (const r of [...new Map(ring.map((q) => [q.id, q])).values()]) is(r.style !== 'none' && r.width >= 2 && r.ratio >= 3, `${r.id} focus ring ${r.width}px, ${f1(r.ratio)}:1 against what is behind it`, `${r.style} ${r.color}`)
    }
    await pg.context().close()

    // alignment: icon centre vs the centre of mass of the label's pixels (needs a high-DPR page) ------------------------
    const ids = LABELLED.filter((id) => M[id] && M[id].label && M[id].display !== 'none' && M[id].rect.w > 0)
    if (ids.length) {
      const hp = await mk(overrides, 4), hb = await mk(BEFORE, 4)
      const hm = await hp.evaluate(measure), bm = await hb.evaluate(measure)
      for (const id of ids) {
        const r = hm[id]; if (!r.label || r.label.lines !== 1) { note(`${id}: label wraps onto ${r.label?.lines} lines here, centring on the block is not measured`); continue }
        const ink = await inkCentre(hp, r.label, 4), ic = r.rect.y + r.rect.h / 2
        const bi = bm[id]?.label ? await inkCentre(hb, bm[id].label, 4) : null
        const before = bi ? bi.centroid - (bm[id].rect.y + bm[id].rect.h / 2) : NaN
        if (!ink) continue
        const d = ink.centroid - ic
        is(Math.abs(d) <= 1.25, `${id} is level with its label: ink centre ${d >= 0 ? '+' : ''}${f1(d)}px from the icon centre (was ${f1(before)}; limit 1.25)`)
      }
      await hp.context().close(); await hb.context().close()
    }
  }
}

// ======================================================================================================================
const br = await chromium.launch({ executablePath: CHROMIUM })

// the sections must exist, at the end of their files
for (const f of FILES) {
  const t = read(f), i = t.indexOf(MARK)
  is(i > 0 && t.indexOf(MARK, i + 1) < 0, `${f} carries one Icons section`)
  // sporta-shadows.css: the ICON SET section (2026-11-11) supersedes these rules and is the file's last section by rule;
  // later storefront sections go before it. Elsewhere the Icons section is still the last one.
  const set = f === 'public/sporta-shadows.css' ? t.indexOf('/* ==== ICON SET') : -1
  if (set > 0) is(i > 0 && i < set && !/^\s*\/\* ==== (?!ICON SET|end ICON SET)/m.test(t.slice(set + 10)), `${f}: the Icons section comes before ICON SET, and ICON SET is the last section of the file`)
  else is(i > 0 && !/^\s*\/\* ==== (?!ICONS|end ICONS)/m.test(t.slice(i + 10)), `${f}: the Icons section is the last section of the file`)
}
const SH = read('public/sporta-shadows.css')
// no icon rule outside the storefront, and the tokens are the only numbers in one place
is(!/\.admin-shell/.test(sectionOf(SH)), 'the shadows Icons section never names the admin')
is(/--sporta-icon-stroke:\s*1\.5px/.test(SH) && /--sporta-icon-stroke-lg:\s*1\.75px/.test(SH), 'the two stroke tokens are defined once')
// files the lane must not touch
const SECTIONLESS = ['public/sporta-ui-colours.css', 'public/sporta-brand-theme.css', 'public/sporta-home-trim.css', 'public/sporta-grid.css', 'public/sporta-product-fix.css', 'public/sporta-images.css', 'public/sporta-bag-touch.css', 'public/sporta-checkout-a11y.css', 'public/sporta-admin-knet.css']
for (const f of SECTIONLESS) is(!read(f).includes(MARK), `${f} has no Icons section (not this lane's file)`)

// ICONS_FILES_ONLY=1 skips Part 1 (a few minutes) while the file checks are being worked on.
const CSS_PART = !process.env.ICONS_FILES_ONLY
if (CSS_PART) await suite(br, {}, 'icons')
// mutation: cut the sections, the suite must fail ------------------------------------------------------------------
if (CSS_PART) {
  const p0 = pass, f0 = fail, fl0 = failures.length
  quiet = true
  await suite(br, Object.fromEntries(FILES.map((f) => [f, cut(read(f))])), 'mutation')
  quiet = false
  const mutFails = fail - f0, list = failures.slice(fl0)
  pass = p0; fail = f0; failures.length = fl0
  console.log(`\nmutation check: with the Icons sections cut, the suite FAILS ${mutFails} checks`)
  const FAM = [['stroke', /stroke is/], ['scale', /scale\b/], ['whole pixel', /whole pixel/], ['alignment', /level with its label/], ['contrast', /:1 against|:1 \(3:1\)/], ['direction', /mirrored/], ['hover', /on hover/], ['focus ring', /focus ring/], ['displacement', /moved .* and changed size/], ['targets', /control is/]]
  for (const [name, re] of FAM) console.log(`  ${name.padEnd(13)} ${list.filter((m) => re.test(m)).length}`)
  is(mutFails >= 100, `the suite fails without the sections (${mutFails} failures; needs 100 or more)`)
}

// ======================================================================================================================
// Part 2: the icon FILES (node, no rig). `known` reports a defect that is the owner's to fix (the files in public/ are not
// touched by this lane): printed as NOTE with its numbers; STRICT_ICONS=1 turns each into a failure.
const known = (ok, msg, detail = '') => { if (ok) is(true, msg); else if (process.env.STRICT_ICONS) is(false, msg, detail); else note(`KNOWN DEFECT (owner decision, see brand/icons-polish/README.md): ${msg} - ${detail}`) }
const PNG = (p) => png(readFileSync(join(ROOT, p)))
const stats = (P, thr = 16) => {
  let x1 = P.w, y1 = P.h, x2 = -1, y2 = -1, maxR = 0, tr = 0; const cx = (P.w - 1) / 2, cy = (P.h - 1) / 2
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) { const p = P.at(x, y); if (p.a < 255) tr++; if (p.a > thr) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); maxR = Math.max(maxR, Math.hypot(x - cx, y - cy)) } }
  let xs = x2; while (xs > 0 && ![...Array(P.h).keys()].some((y) => P.at(xs, y).a > 128)) xs--
  let run = 0; for (let c = xs; c > xs - 3 && c >= 0; c--) { let n = 0; for (let y = 0; y < P.h; y++) if (P.at(c, y).a > 128) n++; run = Math.max(run, n) }
  return { x1, y1, x2, y2, padL: x1 / P.w, padT: y1 / P.h, padR: (P.w - 1 - x2) / P.w, padB: (P.h - 1 - y2) / P.h, maxR: maxR / P.w, tr: tr / (P.w * P.h), edgeRun: run }
}

head('PNG headers against what the manifests, index.html and the og tags declare')
{
  const html = read('index.html')
  for (const [name, mf] of [['site.webmanifest', JSON.parse(read('public/site.webmanifest'))], ['backends.webmanifest', JSON.parse(read('public/backends.webmanifest'))]]) {
    for (const ic of mf.icons) {
      const f = join(ROOT, 'public', ic.src.replace(/^\//, ''))
      is(existsSync(f), `${name}: ${ic.src} exists`)
      if (!existsSync(f) || ic.type !== 'image/png') continue
      const h = pngHeader(readFileSync(f))
      is(`${h.w}x${h.h}` === ic.sizes, `${name}: ${ic.src} is ${h.w}x${h.h}, declared ${ic.sizes}`)
    }
    is(mf.icons.some((i) => i.sizes === '192x192' && /any/.test(i.purpose || 'any')), `${name} declares a 192x192 icon`)
    is(mf.icons.some((i) => i.sizes === '512x512' && /any/.test(i.purpose || 'any')), `${name} declares a 512x512 icon`)
    is(mf.icons.some((i) => i.purpose === 'maskable'), `${name} declares a maskable icon`)
    const any = mf.icons.find((i) => i.sizes === '512x512' && i.purpose === 'any'), mask = mf.icons.find((i) => i.purpose === 'maskable')
    known(!(any && mask && any.src === mask.src), `${name}: the maskable icon is its own file, not the "any" file`, `both are ${any?.src}`)
  }
  for (const m of html.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*?sizes="(\d+)x(\d+)"[^>]*?href="([^"]+)"/g)) {
    const h = pngHeader(readFileSync(join(ROOT, 'public', m[4].replace(/^\//, ''))))
    is(h.w === +m[2] && h.h === +m[3], `index.html: ${m[1]} ${m[4]} is ${h.w}x${h.h}, declared ${m[2]}x${m[3]}`)
  }
  const og = pngHeader(readFileSync(join(ROOT, 'public/og-image.png')))
  is(og.w === +html.match(/og:image:width" content="(\d+)/)[1] && og.h === +html.match(/og:image:height" content="(\d+)/)[1], `og-image.png is ${og.w}x${og.h}, as og:image:width/height say`)
  is(og.w / og.h > 1.85 && og.w / og.h < 1.95 && og.w >= 1200, 'og-image.png is the 1.91:1 card at 1200px or more')
  for (const f of ['logo.png', 'logo-white.png']) { const h = pngHeader(readFileSync(join(ROOT, 'public', f))); is(h.w >= 396, `${f} is ${h.w}px wide: sharp at the header's 132px on a 3x phone (396px)`) }
}

head('the app icons in public/ (measured; the owner decides what replaces them)')
{
  const fav = stats(PNG('public/favicon.png')), apple = stats(PNG('public/apple-touch-icon.png'))
  note(`favicon.png 512: ink spans x ${fav.x1}-${fav.x2}, y ${fav.y1}-${fav.y2}; padding L ${(fav.padL * 100).toFixed(1)}% T ${(fav.padT * 100).toFixed(1)}% R ${(fav.padR * 100).toFixed(1)}% B ${(fav.padB * 100).toFixed(1)}%; farthest ink ${(fav.maxR * 100).toFixed(1)}% of the width from the centre; right edge is a ${fav.edgeRun}px vertical run; ${(fav.tr * 100).toFixed(0)}% transparent`)
  known(fav.padT >= 0.04 && fav.padB >= 0.04, 'favicon.png keeps 4% padding above and below the S', `top ${(fav.padT * 100).toFixed(1)}%, bottom ${(fav.padB * 100).toFixed(1)}%`)
  known(fav.edgeRun <= 0.05 * 512, 'favicon.png keeps the S whole (its right bowl is not cut flat)', `a ${fav.edgeRun}px vertical edge at the right (the master S ends in a point)`)
  known(fav.maxR <= 0.40, 'the file declared maskable keeps its ink inside the 40% safe circle', `ink reaches ${(fav.maxR * 100).toFixed(1)}%`)
  known(apple.tr < 0.01, 'apple-touch-icon.png is opaque (iOS paints transparent black)', `${(apple.tr * 100).toFixed(0)}% transparent`)
}

head('the corrected set in brand/icons-polish/')
{
  const D = 'brand/icons-polish'
  const made = buildIcons()
  for (const f of made) {
    const path = join(ROOT, '..', D, f.file)
    is(existsSync(path) && readFileSync(path).equals(f.png), `${D}/${f.file} is exactly what scripts/make-icons-polish.mjs makes`)
    if (!existsSync(path)) continue
    const P = png(readFileSync(path)), st = stats(P), s = f.size
    is(P.w === s && P.h === s && P.hasAlpha, `${f.file} is ${s}x${s}, RGBA`)
    if (f.bg) {
      is(st.tr === 0 && [0, 1, 2].every((c) => near(Object.values(P.at(0, 0))[c], f.bg[c], 1)) && near(P.at(s - 1, s - 1).r, f.bg[0], 1), `${f.file} is opaque charcoal #171A1E edge to edge (full bleed)`)
      const R = (() => { let m = 0; const c = (s - 1) / 2; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const p = P.at(x, y); if (Math.abs(p.r - f.bg[0]) + Math.abs(p.g - f.bg[1]) + Math.abs(p.b - f.bg[2]) > 120) m = Math.max(m, Math.hypot(x - c, y - c)) } return m / s })()
      is(R <= (f.radius ?? 0.4) + 0.02 && R <= 0.43, `${f.file}: the S stays inside the safe circle (farthest solid ink ${(R * 100).toFixed(1)}% of the width, limit 40% for maskable)`)
    } else {
      is(st.tr > 0.7 && P.at(0, 0).a === 0, `${f.file} is transparent around the S`)
      is(st.padT >= 0.04 && st.padB >= 0.04 && st.padL >= 0.04 && st.padR >= 0.04, `${f.file} keeps 4% padding on every side (${(st.padL * 100).toFixed(1)}/${(st.padT * 100).toFixed(1)}/${(st.padR * 100).toFixed(1)}/${(st.padB * 100).toFixed(1)}%)`)
      if (s >= 192) { const was = stats(PNG(`public/${f.file}`)).edgeRun; is(st.edgeRun <= 0.6 * was, `${f.file} keeps the S whole: its right edge is a ${st.edgeRun}px vertical run (the cut file has ${was}px)`) }
    }
    // the S is the brand orange
    const o = []; for (let y = 0; y < s; y += 2) for (let x = 0; x < s; x += 2) { const p = P.at(x, y); if (p.a > 250 && p.r > 235 && p.b < 60) o.push(p) }
    is(o.length > 0 && o.every((p) => p.g > 90 && p.g < 150), `${f.file}: the S is the logo orange`)
    if (s === 32) { let ink = 0; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (P.at(x, y).a > 128) ink++; is(ink / (s * s) >= 0.08, `${f.file}: the S covers ${(ink / (s * s) * 100).toFixed(0)}% of a 32px tab icon (reads at 16px)`) }
  }
  note(`master S ${SHAPE.w} x ${SHAPE.h} (farthest ink ${(SHAPE.maxR / SHAPE.h * 100).toFixed(1)}% of its height from the box centre)`)
  const README = readFileSync(join(ROOT, '..', D, 'README.md'), 'utf8')
  for (const f of [...ICON_SET.map((s) => s.file), 'product-photo-unavailable.svg', 'preview.png']) is(README.includes(f), `README names ${f}`)
  for (const f of ['public/favicon.png', 'public/favicon-192.png', 'public/favicon-32.png', 'public/apple-touch-icon.png', 'public/product-photo-unavailable.svg', 'public/site.webmanifest', 'public/backends.webmanifest']) is(README.includes(f.replace('public/', '')) , `README says what happens to ${f}`)
  is(existsSync(join(ROOT, '..', D, 'preview.png')), 'preview.png exists')
}

head('the "photo coming soon" tile: public/ file vs brand/icons-polish/ file, rendered at the sizes the shop shows it')
{
  const OLD = readFileSync(join(ROOT, 'public/product-photo-unavailable.svg')), NEW = readFileSync(join(ROOT, '..', 'brand/icons-polish/product-photo-unavailable.svg'))
  const render = async (svg, w) => {
    const ctx = await br.newContext({ viewport: { width: w + 20, height: Math.round(w * 1.25) + 20 }, deviceScaleFactor: 1 }), pg = await ctx.newPage()
    await pg.route('https://fixture.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: svg }))
    await pg.setContent(`<base href="https://fixture.test/"><body style="margin:10px;background:#fff"><img src="/p.svg" width="${w}" height="${Math.round(w * 1.25)}" style="display:block">`)
    await pg.waitForTimeout(100)
    const P = png(await pg.screenshot({ clip: { x: 10, y: 10, width: w, height: Math.round(w * 1.25) } })); await ctx.close(); return P
  }
  const camera = (P) => { // slate line pixels (#6F7882 and its anti-aliasing): bbox width and height of the glyph
    let x1 = P.w, x2 = -1, y1 = P.h, y2 = -1
    for (let y = Math.floor(P.h * 0.25); y < Math.floor(P.h * 0.6); y++) for (let x = 0; x < P.w; x++) { const p = P.at(x, y); if (p.b > p.r + 3 && p.r < 215) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y) } }
    return { w: x2 - x1 + 1, h: y2 - y1 + 1, x1, y1, y2 }
  }
  const dark = (P, y1, y2, x1, x2) => { let n = 0; for (let y = Math.floor(y1); y < y2; y++) for (let x = Math.floor(x1); x < x2; x++) { const p = P.at(x, y); if (p.r < 150 && p.g < 150) n++ } return n }
  for (const w of [72, 169, 300, 301, 340]) {
    const o = await render(OLD, w), n = await render(NEW, w), co = camera(o), cn = camera(n)
    note(`${w}px wide: camera glyph ${co.w}px (public/) -> ${cn.w}px (new)`)
    if (w <= 169) is(cn.w >= 1.3 * co.w && cn.w >= 0.3 * w, `at ${w}px the new camera glyph is ${cn.w}px, ${(cn.w / co.w).toFixed(1)}x the current ${co.w}px (a deliberate badge, not a smudge)`)
    // the copy: dark pixels in the band where "SPORTA" sits in the full tile (about 66-72% down); the compact tile has none
    const band = (P) => dark(P, P.h * 0.665, P.h * 0.715, P.w * 0.3, P.w * 0.7)
    if (w <= 300) is(band(n) === 0, `at ${w}px the new tile drops the copy (it would be ${Math.round(w / 600 * 24)}px tall)`, `${band(n)} dark pixels in the copy band`)
    else is(band(n) > 8, `at ${w}px the new tile keeps its copy`, `${band(n)} dark pixels`)
  }
}

head('the Sporta AI icon concepts: validity, 16 / 24 / 32px and both grounds (information for the owner; nothing is chosen or wired in)')
{
  const dir = join(ROOT, '..', 'brand', 'sporta-ai'), files = readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()
  const GROUND = { white: '#ffffff', beige: '#e2dbce', charcoal: '#171a1e' }
  const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const ctx = await br.newContext({ viewport: { width: 200, height: 100 }, deviceScaleFactor: 1 }), pg = await ctx.newPage()
  is(files.length >= 7, `brand/sporta-ai has ${files.length} SVG files (concepts a-d, the master, on-dark and mono)`)
  for (const f of files) {
    const svg = readFileSync(join(dir, f), 'utf8')
    const v = await pg.evaluate((t) => { const d = new DOMParser().parseFromString(t, 'image/svg+xml'); return { err: !!d.querySelector('parsererror'), vb: d.documentElement.getAttribute('viewBox'), bad: [...d.querySelectorAll('script,style,filter,image,use,foreignObject,text')].map((e) => e.tagName), href: /href=|url\(/.test(t) } }, svg)
    is(!v.err && v.vb === '0 0 48 48' && !v.bad.length && !v.href, `${f} is well-formed, viewBox 0 0 48 48, no script / style / filter / text / external reference`, JSON.stringify(v))
    const fills = [...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toLowerCase()))]
    const mono = /currentColor/.test(svg)
    const grounds = f.includes('on-dark') ? ['charcoal'] : mono ? ['white', 'beige', 'charcoal'] : ['white', 'beige', 'charcoal']
    const cells = []
    for (const g of grounds) {
      const colour = mono ? (g === 'charcoal' ? '#ff7b17' : '#171a1e') : null
      const src = mono ? svg.replace(/currentColor/g, colour) : svg
      const ratios = (mono ? [colour] : fills).map((c) => [c, ratio(c, GROUND[g])])
      for (const s of [16, 24, 32]) {
        await pg.setContent(`<body style="margin:0;background:${GROUND[g]}"><img src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}" width="${s}" height="${s}" style="display:block;margin:10px">`)
        const P = png(await pg.screenshot({ clip: { x: 10, y: 10, width: s, height: s } })), bg = P.at(0, 0)
        let n = 0, edge = 0
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const p = P.at(x, y), d = Math.max(Math.abs(p.r - bg.r), Math.abs(p.g - bg.g), Math.abs(p.b - bg.b)); if (d > 12) { n++; if (d <= 150) edge++ } }
        if (s === 16 && g === grounds[0]) is(n / (s * s) > 0.2, `${f} on ${g} at 16px draws ${(n / (s * s) * 100).toFixed(0)}% ink (not blank)`)
        cells.push(`${g[0]}${s}:${(n / (s * s) * 100).toFixed(0)}%/${(edge / Math.max(1, n) * 100).toFixed(0)}%edge`)
      }
      const intended = (f.includes('on-dark') && g === 'charcoal') || (!f.includes('on-dark') && g === 'white') || mono
      if (intended && !f.startsWith('concept-')) is(ratios.every(([c, r]) => c === '#171a1e' && g === 'charcoal' ? true : r >= 3 || c === '#171a1e'), `${f} on ${g}: its colours ${ratios.map(([c, r]) => c + ' ' + r.toFixed(2) + ':1').join(', ')} (3:1)`)
      else note(`${f} on ${g}: ${ratios.map(([c, r]) => c + ' ' + r.toFixed(2) + ':1').join(', ')}`)
    }
    note(`${f}: ink share / partly-covered edge pixels at 16/24/32px, by ground: ${cells.join(' ')}`)
  }
  await ctx.close()
}

console.log(`
LIVE CHECK (repeat on https://www.sporta.com.kw when the Hostinger connector is back; the capture has every icon <svg> empty except the three features-band glyphs):
  1. Paths and sizes: for every svg.sporta-icon on /, /shop, a product page, the bag drawer, checkout and the footer: width attribute, the path d of each shape, getComputedStyle(svg).strokeWidth, getComputedStyle(path).vectorEffect (expect 'non-scaling-stroke' with these sections), the rendered box.
  2. Direction: in dir=rtl read getComputedStyle(svg).transform and .scale and the ancestors' transforms for the product gallery arrows (.catalog-gallery-arrow), the hero slider arrows, .campaign-category__arrow, the breadcrumb chevrons and the size-guide / share glyphs; the truck in the features band and the reassurance rows (owner choice: mirror or not).
  3. The returns glyph elsewhere: every svg whose first path d starts "M8 3 4 7 8 11" (the rule mirrors all of them in RTL: check the product-page reassurance row and the footer if present).
  4. Dark theme (data-theme=dark, or prefers-color-scheme: dark): the drawer, product card and product page icon colours and focus rings; the capture has no dark rules for them.
  5. Sizes in the wild: the home category tile arrow, gallery arrow / zoom, search overlay, share, wishlist heart on the product page, toasts, checkout radio / COD icons, the "photo unavailable" camera at the card / bag / checkout-line sizes.
  6. The English strings (the capture is Arabic): the drawer note and the reassurance rows at 320px, because a 1px wider icon can tip a nearly full line onto two.
  7. Header action boxes: 2.75rem is 43.7px at 390px wide (the menu layout lane owns that row).
  8. Accessible names: every icon-only button has aria-label (the capture shows them on the header, drawer, footer socials, card buttons); look for icon-only controls with none in the gallery, hero and tile arrows.
  9. The admin: run scripts/admin-icon-scan.mjs (desktop and phone, ar and en) and read the ICON lines.`)

await br.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
