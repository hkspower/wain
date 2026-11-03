// Words-and-colours rules of the live-site add-ons (public/sporta-ui-colours.css and the brand-theme
// public/sporta-brand-theme.css), proven on the live markup and the live stylesheet rules.
//
//   npm run test:words-colours      (no server, no database: a fixture, the live rules, the add-on CSS,
//                                    real Chromium via CHROMIUM_PATH or /opt/pw-browsers/chromium)
//
// Every assertion is a computed colour, a stacking order or rendered pixels, at the widths the scan used,
// in Arabic (RTL, the default) and English (LTR):
//
//   C1  hero text on photo slides   white title and sub-line vs the rendered pixels under the copy block
//                                   (a #ececec photo, the brightest decile of the live slides): 4.5:1 at
//                                   1024-1920px on both slides and both directions; the far side of the
//                                   photo keeps its colour; under 1024px the live vertical scrim is untouched
//   C2  focus ring                  after a real Tab key press the ring is 3:1 or more against the surface it
//                                   is drawn on, on every control the scan flagged; the header, footer, brand
//                                   bar keep #ff7b17 and the hero keeps white; the dark theme is untouched
//   C3  active filter chip          the ring is already its final colour on the first frame (the bundle's
//                                   .transition list fades outline-color in from currentColor = white)
//   C4  sold-out label              the band is the topmost element at its own centre and the veil covers the
//                                   photo; the loading skeleton stays under the photo
//   C5  drawer remove icon          3:1 at rest, the rose hover is untouched, the dark theme is untouched
//   C6  disabled controls           Apply and the minimum-quantity minus read at 3:1 or more; enabled ones don't change
//   C7  off-palette colours         product names / titles / page heading charcoal, orange tints on the
//                                   selected payment method and the notice, orange field halo, rose invalid halo kept
//   C8  primary button              hover = #b8430f + white (5.46:1) on storefront / drawer / hero CTA, not on
//                                   a disabled one; keyboard focus keeps the charcoal label (4.5:1 or more)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as html } from './fixtures/words-colours.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// WC_UI_CSS / WC_BRAND_CSS point the suite at another copy of the add-on (the mutation check uses an empty file
// and the pre-fix version from git).
const UI = readFileSync(process.env.WC_UI_CSS || join(ROOT, 'public/sporta-ui-colours.css'), 'utf8')
const BRAND = readFileSync(process.env.WC_BRAND_CSS || join(ROOT, 'public/sporta-brand-theme.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// ---- colour helpers -------------------------------------------------------------------------------------
const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } }
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const is_ = (c, h) => hex(parse(c)) === h

// Minimal PNG reader (8-bit RGB / RGBA, no interlace: what Chromium's screenshot writes).
const png = (buf) => {
  let p = 8, w = 0, h = 0, ct = 0; const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8)
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17] }
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len))
    p += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[dst + x] = v & 255
    }
  }
  return { w, h, at: (x, y) => ({ r: out[y * stride + x * bpp], g: out[y * stride + x * bpp + 1], b: out[y * stride + x * bpp + 2], a: 1 }) }
}

const open = async (kind, lang, w = 1280, h = 900, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', ...extra })
  const pg = await ctx.newPage()
  await pg.setContent(html(kind, lang, BRAND, UI))
  return { ctx, pg }
}

// In-page helper: the colour a ring is drawn on = the first opaque ancestor, with translucent ones composited.
const BACKDROP = `(el) => {
  const stack = []
  for (let e = el.parentElement; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor, m = c.match(/[\\d.]+/g).map(Number), a = m.length > 3 ? m[3] : 1
    if (a > 0) stack.push(m.slice(0, 3).concat(a))
    if (a >= 1) break
  }
  let bg = [255, 255, 255]
  for (const [r, g, b, a] of stack.reverse()) bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]
  return 'rgb(' + bg.map(Math.round).join(',') + ')'
}`

// ===== C1 hero ===========================================================================================
const SUB_REM = 27 // .campaign-hero-sub max-width: 27rem
for (const lang of ['ar', 'en']) {
  const rtl = lang === 'ar'
  for (const w of [1920, 1600, 1440, 1280, 1100, 1024]) {
    for (const slide of [1, 2]) {
      head(`C1 hero ${lang} ${w}px slide ${slide}`)
      const { ctx, pg } = await open('hero', lang, w, 900)
      await pg.addStyleTag({ content: `.campaign-hero-copy *{color:transparent!important;text-shadow:none!important;border-color:transparent!important;background:none!important}.campaign-hero-cta-icon svg{display:none}.campaign-photo-hero:nth-child(${slide === 1 ? 2 : 1}){display:none}.campaign-brand-bar,section>button{display:none!important}` })
      const m = await pg.evaluate(() => { const c = document.querySelector('.campaign-photo-hero:not([style*=none]) .campaign-hero-copy'); const vis = [...document.querySelectorAll('.campaign-hero-copy')].find((e) => e.offsetParent); const r = vis.getBoundingClientRect(); const s = vis.closest('section').getBoundingClientRect(); return { l: r.left, r: r.right, secTop: s.top, secH: s.height, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) } })
      const y = Math.round(m.secTop + m.secH / 2)
      const img = png(await pg.screenshot({ clip: { x: 0, y, width: w, height: 4 } }))
      // The start edge of the text inside the copy box: the right edge in RTL, the left edge in LTR.
      const subFrom = rtl ? Math.max(m.l, m.r - SUB_REM * m.rem) : m.l, subTo = rtl ? m.r : Math.min(m.r, m.l + SUB_REM * m.rem)
      let minSub = 99, minTitle = 99
      for (let x = Math.floor(m.l) + 1; x < Math.floor(m.r) - 1; x += 4) {
        const px = img.at(x, 1)
        minTitle = Math.min(minTitle, ratio(WHITE, px))
        if (x >= subFrom && x <= subTo) minSub = Math.min(minSub, ratio(over({ r: 255, g: 255, b: 255, a: 0.82 }, px), px))
      }
      is(minTitle >= 3, 'title: white on the photo under the copy block is 3:1 or more (large text)', minTitle.toFixed(2))
      is(minSub >= 4.5, 'sub-line: white at 82% on the photo under its 27rem is 4.5:1 or more', minSub.toFixed(2))
      // The scrim must not eat the whole photograph: the side away from the copy stays the photo's colour.
      const copyAtLeft = (m.l + m.r) / 2 < w / 2
      const far = img.at(copyAtLeft ? w - 8 : 8, 1)
      is(far.r >= 225, 'the far side of the photo keeps its colour', `r=${far.r}`)
      await ctx.close()
    }
  }
  for (const w of [1280, 768]) {
    head(`C1 hero arrows ${lang} ${w}px`)
    const { ctx, pg } = await open('hero', lang, w, 900)
    // The disc is translucent, so measure what is rendered: a pixel inside the disc, left of the icon, with the
    // arrow's own white icon hidden. Both arrows, over the brightest photo.
    await pg.addStyleTag({ content: 'section>button svg{display:none}.campaign-hero-copy{visibility:hidden}.campaign-photo-hero-scrim{display:none}' })
    const discs = await pg.evaluate(() => [...document.querySelectorAll('section[aria-roledescription=carousel] > button')].map((b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width] }))
    for (const [i, [cx, cy, bw]] of discs.entries()) {
      const px = png(await pg.screenshot({ clip: { x: Math.round(cx - bw / 2 + 12), y: Math.round(cy), width: 2, height: 2 } })).at(0, 0)
      is(ratio(WHITE, px) >= 4.5, `arrow ${i + 1}: the white icon on its disc over the bright photo is 4.5:1 or more`, `${hex(px)} ${ratio(WHITE, px).toFixed(2)}`)
    }
    await pg.hover('section[aria-roledescription=carousel] > button:last-of-type'); await pg.waitForTimeout(300)
    const hv = await pg.evaluate(() => getComputedStyle(document.querySelector('section[aria-roledescription=carousel] > button:last-of-type')).backgroundColor)
    is(is_(hv, '#e0561c'), 'the bundle\'s brand-orange hover is untouched', hex(parse(hv)))
    await ctx.close()
  }
  for (const w of [1023, 768, 390]) {
    head(`C1 hero ${lang} ${w}px (under 1024 the live vertical scrim is untouched)`)
    const { ctx, pg } = await open('hero', lang, w, 900)
    const bg = await pg.evaluate(() => [...document.querySelectorAll('.campaign-photo-hero-scrim')].map((e) => getComputedStyle(e).backgroundImage))
    is(bg.every((b) => b.startsWith('linear-gradient(rgba(0, 0, 0, 0) 12%')), 'both slides keep the live vertical gradient', bg[0].slice(0, 60))
    await ctx.close()
  }
}

// ===== C2 / C3 / C8 keyboard focus: one real Tab pass per page ===========================================
// kind -> [name, selector, expected final ring colour or 'light' (= brand dark orange on a light surface)]
const RING = {
  hero: [
    ['hero prev arrow', 'section[aria-roledescription=carousel] > button:first-of-type', '#ffffff'],
    ['hero CTA', '.campaign-hero-cta', '#ffffff'],
    ['brand bar item', '.brand-bar__item', '#ff7b17'],
    ['brand bar link', '.brand-bar__cta', '#ff7b17'],
    ['header link', '.app-header a', '#ff7b17'],
    ['footer link', '.app-footer a', '#ff7b17'],
  ],
  product: [
    ['breadcrumb link', '.catalog-breadcrumb a', 'light'],
    ['wishlist heart', '.catalog-product-page .tap', 'light'],
    ['size-guide button', '#product-size-options > button', 'light'],
    ['size chip', '#product-size-options [role=group] button', 'light'],
    ['quantity plus', '.qty button[aria-label*="crease quantity"]:not([disabled]), .qty button[aria-label="زيادة الكمية"]', 'light'],
    ['primary Add', '.catalog-product-page .btn-primary', 'light'],
  ],
  shop: [
    ['active filter chip', '.catalog-filter.is-active', 'light'],
    ['inactive filter chip', '.catalog-filter:not(.is-active)', 'light'],
    ['card name link', '.catalog-card-info a', 'light'],
  ],
  checkout: [
    ['stepper link', '.purchase-steps a', 'light'],
    ['track link', '.guest-note__body a', 'light'],
    ['quick registration link', '.guest-note > a', 'light'],
    ['checkout primary', '#go', 'light'],
  ],
  legal: [
    ['contents link', '.legal-page__contents a', 'light'],
    ['in-text policy link', '.legal-page p a', 'light'],
  ],
  drawer: [
    ['drawer close X', '.campaign-cart-drawer header button', 'light'],
    ['drawer quantity minus', '.purchase-quantity button', 'light'],
    ['drawer remove', '.cart-drawer__remove', 'light'],
    ['drawer Checkout', '.campaign-cart-drawer .btn-primary', 'light'],
    ['drawer back link', '.campaign-cart-drawer footer a:last-child', 'light'],
  ],
}
const tabPass = async (pg, targets, onStop) => {
  await pg.evaluate((ts) => { ts.forEach(([name, sel]) => { const e = document.querySelector(sel); if (e) e.setAttribute('data-wc', name) }) }, targets)
  const seen = new Set()
  for (let i = 0; i < 80 && seen.size < targets.length; i++) {
    await pg.keyboard.press('Tab')
    const name = await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-wc'))
    if (name && !seen.has(name)) { seen.add(name); await onStop(name) }
  }
  return seen
}
for (const lang of ['ar', 'en']) {
  for (const kind of Object.keys(RING)) {
    for (const w of kind === 'shop' || kind === 'drawer' ? [390, 1280] : [1280]) {
      head(`C2 focus ring ${kind} ${lang} ${w}px`)
      const { ctx, pg } = await open(kind, lang, w, 900)
      const targets = RING[kind]
      const results = {}
      const seen = await tabPass(pg, targets, async (name) => {
        const first = await pg.evaluate(() => getComputedStyle(document.activeElement).outlineColor)
        await pg.waitForTimeout(260) // longer than the bundle's 150ms transition
        results[name] = await pg.evaluate(`(() => { const el = document.activeElement, cs = getComputedStyle(el); return { first: ${JSON.stringify('')}, color: cs.outlineColor, width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset, bd: (${BACKDROP})(el) } })()`)
        results[name].first = first
      })
      for (const [name, , want] of targets) {
        const r = results[name]
        if (!r) { is(false, `${name}: reached by the Tab key`, [...seen].join(',')); continue }
        if (want === 'light') {
          const rr = ratio(parse(r.color), parse(r.bd))
          is(rr >= 3, `${name}: ring ${hex(parse(r.color))} on ${hex(parse(r.bd))} is 3:1 or more`, rr.toFixed(2))
          is(r.style === 'solid' && r.width === '2px', `${name}: still a 2px solid ring (width untouched)`, r.width + ' ' + r.style)
          // C3: no frame in which the ring is a different colour (the bundle fades it in from currentColor).
          is(r.first === r.color, `${name}: the ring is its final colour on the first frame`, `${r.first} -> ${r.color}`)
        } else {
          is(is_(r.color, want), `${name}: ring stays ${want}`, hex(parse(r.color)))
        }
      }
      await ctx.close()
    }
  }
}
{
  head('C2 dark theme is left to the bundle')
  const { ctx, pg } = await open('product', 'ar')
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await tabPass(pg, [['bc', '.catalog-breadcrumb a']], async () => { await pg.waitForTimeout(260) })
  const c = await pg.evaluate(() => getComputedStyle(document.activeElement).outlineColor)
  is(is_(c, '#ff7b17'), 'with data-theme="dark" the ring stays the bundle\'s #ff7b17', hex(parse(c)))
  await ctx.close()
}

// ===== C4 sold-out label ==================================================================================
for (const lang of ['ar', 'en']) {
  for (const w of [390, 1280]) {
    head(`C4 sold-out card ${lang} ${w}px`)
    const { ctx, pg } = await open('shop', lang, w, 900)
    const r = await pg.evaluate(() => {
      const label = document.querySelector('span.bg-ink\\/85'), veil = document.querySelector('span.bg-white\\/55'), cards = [...document.querySelectorAll('.catalog-card-image')]
      const lr = label.getBoundingClientRect(), vr = veil.getBoundingClientRect()
      const top = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e === label ? 'label' : e === veil ? 'veil' : e.tagName.toLowerCase() + '.' + (e.className || '').toString().split(' ')[0]) : 'none' }
      const ok = cards[1].getBoundingClientRect()
      return {
        atLabel: top(lr.left + lr.width / 2, lr.top + lr.height / 2), atVeil: top(vr.left + vr.width / 2, vr.top + vr.height * 0.2), okCard: top(ok.left + ok.width / 2, ok.top + ok.height / 2),
        skel: getComputedStyle(document.querySelector('.image-loading-skeleton')).zIndex, imgZ: getComputedStyle(document.querySelector('.catalog-card-photo')).zIndex,
        lblZ: getComputedStyle(label).zIndex, save: top(vr.right - 20, vr.top + 20), rect: [lr.left, lr.top, lr.width, lr.height],
      }
    })
    is(r.atLabel === 'label', 'the "Sold out" band is the topmost element at its own centre', r.atLabel)
    is(r.atVeil === 'veil', 'the white veil covers the photo', r.atVeil)
    is(r.okCard.startsWith('img'), 'an in-stock card is untouched (the photo is on top)', r.okCard)
    is(r.skel === '0' && r.imgZ === '1', 'the loading skeleton stays at z 0, under the photo at z 1', `skeleton ${r.skel}, photo ${r.imgZ}`)
    is(Number(r.lblZ) > Number(r.imgZ) && Number(r.lblZ) < 10, 'the band sits above the photo and below the wishlist button (z 10)', r.lblZ)
    // Rendered pixels: left edge of the band (no text there) must be dark; with the photo on top it was white.
    const px = png(await pg.screenshot({ clip: { x: Math.round(r.rect[0] + 4), y: Math.round(r.rect[1] + r.rect[3] / 2), width: 2, height: 2 } })).at(0, 0)
    is(ratio(WHITE, px) >= 7, 'the band is painted dark (white text reads at 7:1 or more)', ratio(WHITE, px).toFixed(1))
    await ctx.close()
  }
}

// ===== C5 drawer remove icon, C6 disabled, C7 palette, C8 hover ===========================================
for (const lang of ['ar', 'en']) {
  head(`C5 drawer remove ${lang}`)
  {
    const { ctx, pg } = await open('drawer', lang, 390, 800)
    const rest = await pg.evaluate(() => getComputedStyle(document.querySelector('.cart-drawer__remove')).color)
    is(ratio(parse(rest), WHITE) >= 3, `remove icon ${hex(parse(rest))} on white is 3:1 or more`, ratio(parse(rest), WHITE).toFixed(2))
    await ctx.close()
    const d = await open('drawer', lang, 1280, 800)
    await d.pg.hover('.cart-drawer__remove'); await d.pg.waitForTimeout(250)
    const hov = await d.pg.evaluate(() => getComputedStyle(document.querySelector('.cart-drawer__remove')).color)
    is(is_(hov, '#e11d48'), 'the bundle\'s rose hover is untouched', hex(parse(hov)))
    await d.pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await d.pg.mouse.move(5, 5)
    const dark = await d.pg.evaluate(() => getComputedStyle(document.querySelector('.cart-drawer__remove')).color)
    is(is_(dark, '#90a1b9'), 'dark theme: left to the bundle', hex(parse(dark)))
    await d.ctx.close()
  }

  head(`C6 disabled controls ${lang}`)
  {
    const { ctx, pg } = await open('checkout', lang, 1280, 900)
    const a = await pg.evaluate(() => { const b = document.querySelector('.purchase-checkout-summary input + button'), cs = getComputedStyle(b); return { op: Number(cs.opacity), col: cs.color } })
    const eff = over({ ...parse(a.col), a: a.op }, WHITE)
    is(ratio(eff, WHITE) >= 3, `Apply (disabled) reads ${hex(eff)} on white at 3:1 or more`, ratio(eff, WHITE).toFixed(2))
    is(a.op < 1, 'Apply still looks disabled (opacity under 1)', String(a.op))
    await pg.evaluate(() => { document.querySelector('.purchase-checkout-summary input + button').disabled = false })
    is(await pg.evaluate(() => getComputedStyle(document.querySelector('.purchase-checkout-summary input + button')).opacity) === '1', 'Apply enabled is untouched (opacity 1)')
    await ctx.close()
    const p = await open('product', lang, 1280, 900)
    const q = await p.pg.evaluate(() => { const d = document.querySelector('.qty button[disabled]'), e = document.querySelector('.qty button:not([disabled])'), cs = getComputedStyle(d); return { op: Number(cs.opacity), col: cs.color, eop: getComputedStyle(e).opacity } })
    const qe = over({ ...parse(q.col), a: q.op }, WHITE)
    is(ratio(qe, WHITE) >= 4.5, `minimum-quantity minus reads ${hex(qe)} on white at 4.5:1 or more`, ratio(qe, WHITE).toFixed(2))
    is(q.op < 1 && q.eop === '1', 'the minus still looks disabled, the enabled plus is untouched', `${q.op} / ${q.eop}`)
    await p.ctx.close()
  }

  head(`C7 palette ${lang}`)
  {
    const s = await open('shop', lang, 1280, 900), pr = await open('product', lang, 1280, 900), lg = await open('legal', lang, 1280, 900)
    const ink = (c) => is_(c, '#171a1e')
    const n = await s.pg.evaluate(() => getComputedStyle(document.querySelector('.catalog-card-name')).color)
    is(ink(n), 'product card name is charcoal #171a1e', hex(parse(n)))
    const t = await pr.pg.evaluate(() => getComputedStyle(document.querySelector('.catalog-product-title')).color)
    is(ink(t), 'product title is charcoal #171a1e', hex(parse(t)))
    const h = await lg.pg.evaluate(() => getComputedStyle(document.querySelector('h1.page-heading')).color)
    is(ink(h), 'page heading is charcoal #171a1e (was inherited #18202b)', hex(parse(h)))
    await s.pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    const nd = await s.pg.evaluate(() => getComputedStyle(document.querySelector('.catalog-card-name')).color)
    is(is_(nd, '#0f172b'), 'dark theme: the card name is left to the bundle', hex(parse(nd)))
    await s.ctx.close(); await pr.ctx.close(); await lg.ctx.close()

    const c = await open('checkout', lang, 1280, 900)
    const q = await c.pg.evaluate(() => {
      const sel = document.querySelector('.payment-method--selected'), cs = getComputedStyle(sel), nt = getComputedStyle(document.querySelector('.purchase-notice')), bd = getComputedStyle(document.querySelector('.payment-method__badge'))
      return { bg: cs.backgroundColor, sh: cs.boxShadow, nbg: nt.backgroundColor, nbd: nt.borderTopColor, badge: bd.backgroundColor }
    })
    is(q.bg === 'rgba(224, 86, 28, 0.07)', 'selected payment method: background is the brand orange at 7%', q.bg)
    is(q.sh.includes('rgba(184, 67, 15, 0.9)') && !q.sh.includes('199, 106, 66'), 'selected payment method: shadow is the deep brand orange', q.sh)
    is(q.nbg === 'rgba(224, 86, 28, 0.07)' && q.nbd === 'rgba(224, 86, 28, 0.25)', 'notice: orange tint and border', `${q.nbg} / ${q.nbd}`)
    is(q.badge === 'rgba(224, 86, 28, 0.09)', 'selected payment badge: brand orange tint', q.badge)
    await c.pg.hover('.payment-method--selected'); await c.pg.waitForTimeout(250)
    const hv = await c.pg.evaluate(() => getComputedStyle(document.querySelector('.payment-method--selected')).backgroundColor)
    is(hv === 'rgba(224, 86, 28, 0.1)', 'selected payment method on hover: orange, not terracotta', hv)
    // field halos by keyboard
    const halos = {}
    await tabPass(c.pg, [['good', '#f-name'], ['bad', '#f-bad']], async (name) => { await c.pg.waitForTimeout(260); halos[name] = await c.pg.evaluate(() => getComputedStyle(document.activeElement).boxShadow) })
    is((halos.good || '').includes('rgba(224, 86, 28, 0.22)'), 'a focused field gets the brand-orange halo', halos.good)
    is((halos.bad || '').includes('rgba(225, 29, 72, 0.16)'), 'an invalid field keeps its rose halo', halos.bad)
    await c.ctx.close()
  }

  head(`C8 primary button hover and focus ${lang}`)
  {
    const c = await open('checkout', lang, 1280, 900)
    const read = () => c.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('#go')); return { bg: cs.backgroundColor, col: cs.color } })
    const rest = await read()
    is(is_(rest.bg, '#ff7b17') && is_(rest.col, '#171a1e'), 'rest: charcoal label on #ff7b17', `${hex(parse(rest.bg))} ${hex(parse(rest.col))}`)
    await c.pg.hover('#go'); await c.pg.waitForTimeout(400)
    const hov = await read()
    is(is_(hov.bg, '#b8430f') && is_(hov.col, '#ffffff'), 'hover: white label on #b8430f', `${hex(parse(hov.bg))} ${hex(parse(hov.col))}`)
    is(ratio(parse(hov.col), parse(hov.bg)) >= 4.5, 'hover label is 4.5:1 or more', ratio(parse(hov.col), parse(hov.bg)).toFixed(2))
    await c.pg.hover('#go-off'); await c.pg.waitForTimeout(400)
    const off = await c.pg.evaluate(() => getComputedStyle(document.querySelector('#go-off')).backgroundColor)
    is(is_(off, '#ff7b17'), 'a disabled primary button does not change on hover', hex(parse(off)))
    await c.pg.mouse.move(2, 2)
    await tabPass(c.pg, [['go', '#go']], async () => { await c.pg.waitForTimeout(400) })
    const foc = await read()
    is(is_(foc.col, '#171a1e') && is_(foc.bg, '#ff7b17'), 'keyboard focus keeps the charcoal label on #ff7b17', `${hex(parse(foc.bg))} ${hex(parse(foc.col))}`)
    is(ratio(parse(foc.col), parse(foc.bg)) >= 4.5, 'the focused label is 4.5:1 or more', ratio(parse(foc.col), parse(foc.bg)).toFixed(2))
    await c.ctx.close()

    const d = await open('drawer', lang, 1280, 900)
    await d.pg.hover('.campaign-cart-drawer .btn-primary'); await d.pg.waitForTimeout(400)
    const dv = await d.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('.campaign-cart-drawer .btn-primary')); return [cs.backgroundColor, cs.color] })
    is(is_(dv[0], '#b8430f') && is_(dv[1], '#ffffff'), 'drawer Checkout hover: white on #b8430f', dv.map((x) => hex(parse(x))).join(' '))
    await d.ctx.close()

    const h = await open('hero', lang, 1280, 900)
    const hr = await h.pg.evaluate(() => { const r = document.querySelector('.campaign-hero-cta').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
    const hrest = await h.pg.evaluate(() => getComputedStyle(document.querySelector('.campaign-hero-cta')).backgroundColor)
    await h.pg.mouse.move(hr[0], hr[1]); await h.pg.waitForTimeout(400)
    const hh = await h.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('.campaign-hero-cta')); return [cs.backgroundColor, cs.color] })
    is(is_(hrest, '#ff7b17'), 'hero CTA at rest is #ff7b17', hex(parse(hrest)))
    is(is_(hh[0], '#b8430f') && is_(hh[1], '#ffffff'), 'hero CTA hover: white on #b8430f', hh.map((x) => hex(parse(x))).join(' '))
    await h.ctx.close()
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
