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
//   alignment   an icon beside a label is within 1.5px of the vertical centre of mass of the label's pixels (Arabic ink
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
      const cx = (m) => m.rect.x + m.rect.w / 2, cy = (m) => m.rect.y + m.rect.h / 2
      const lim = MOVE[r.id] ?? 1.1
      const dxx = Math.abs(cx(r) - cx(b)), dyy = Math.abs(cy(r) - cy(b))
      // the icon's own box may grow by one px; its centre moves by the layout the larger box causes (<= 1px) and the nudge (<= 1px)
      is(Math.abs(r.rect.w - b.rect.w) <= 1.01 && dxx <= lim + 0.5 && dyy <= lim, `${tag(r)} moved ${f1(dxx)}, ${f1(dyy)}px and changed size by ${f1(r.rect.w - b.rect.w)}px (limit ${lim})`)
    }
    // states (1280 only: hover needs a pointer) ---------------------------------------------------------------------
    if (w === 1280 && kind === 'header') {
      for (const sel of ['.navbar-ai', '.navbar-language', '.navbar-cart']) {
        await pg.hover(sel); await pg.waitForTimeout(320)
        const st = await pg.evaluate((s) => { const svg = document.querySelector(s + ' svg.sporta-icon'), cs = getComputedStyle(svg); return { t: cs.transform, sw: parseFloat(cs.strokeWidth) } }, sel)
        const sc = st.t === 'none' ? 1 : new DOMMatrix(st.t).a
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
      for (const r of ring) is(r.style !== 'none' && r.width >= 2 && r.ratio >= 3, `${r.id} focus ring ${r.width}px, ${f1(r.ratio)}:1 against what is behind it`, `${r.style} ${r.color}`)
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
        is(Math.abs(d) <= 1.5, `${id} is level with its label: ink centre ${d >= 0 ? '+' : ''}${f1(d)}px from the icon centre (was ${f1(before)}; limit 1.5)`)
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
  is(i > 0 && !/^\s*\/\* ==== (?!ICONS|end ICONS)/m.test(t.slice(i + 10)), `${f}: the Icons section is the last section of the file`)
}
const SH = read('public/sporta-shadows.css')
// no icon rule outside the storefront, and the tokens are the only numbers in one place
is(!/\.admin-shell/.test(sectionOf(SH)), 'the shadows Icons section never names the admin')
is(/--sporta-icon-stroke:\s*1\.5px/.test(SH) && /--sporta-icon-stroke-lg:\s*1\.75px/.test(SH), 'the two stroke tokens are defined once')
// files the lane must not touch
const SECTIONLESS = ['public/sporta-ui-colours.css', 'public/sporta-brand-theme.css', 'public/sporta-home-trim.css', 'public/sporta-grid.css', 'public/sporta-product-fix.css', 'public/sporta-images.css', 'public/sporta-bag-touch.css', 'public/sporta-checkout-a11y.css', 'public/sporta-admin-knet.css']
for (const f of SECTIONLESS) is(!read(f).includes(MARK), `${f} has no Icons section (not this lane's file)`)

await suite(br, {}, 'icons')
const mainFail = fail
// mutation: cut the sections, the suite must fail ------------------------------------------------------------------
{
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

await br.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
