/**
 * test:product-page-layout — the product-page review of 2026-10-08, measured in a real browser.
 *
 *   bash scripts/sandbox.sh && node scripts/product-page-layout-test.mjs
 *
 * The owner approved these, each in its stress-tested (refined) form; every one is CSS, and every
 * check below reads what the PAGE does (painted boxes, computed colours, pixels), never the rule:
 *
 *   P1  86-product-sizes.css     only the sizes a piece is made in; a sold-out size says so in
 *                                words; the "not carried" hint goes; hint lines centred
 *   P5  87-product-desktop.css   computer: the description paints after the delivery list, and a
 *                                product with no size rows keeps a normal price-to-Add gap
 *   P6  87-product-desktop.css   computer: the trail band 24/16px; 8 sizes and 5 fits one row each
 *                                from 1100px; six fits as 3 + 3; no line holding a single button
 *   P7  89-product-selected.css  the chosen size / fit / adviser answer is dark with white letters;
 *                                the current colour has a dark ring; an owner Secondary colour is
 *                                used with a readable ink
 *   P8  88-product-phone-order   phone: the colour box paints before the size box (2+ colours only)
 *   P9  88-product-phone-order   phone: the name follows the photo; the logo strip paints after
 *                                the buying column
 *   P10 05-, 06-, 40-, 89-product-display-fixes: (a) the sticky photo stops below the header,
 *       (b) the closed bag drawer paints no shadow AND still slides shut, (d) the buy bar's room is
 *       reserved once, (e) the size guide's headings sit over their columns, (f) the photo
 *       placeholder is the light one, (g) the quantity stepper is as tall as Add
 *   ADV 89-advisor-chips.css     the size adviser's answer chips are never cut off
 *
 * Fixtures, by slug: cloudsoft-jacket-army-green (3 colours, made in M and L — M is made SOLD OUT
 * here by intercepting ?r=stock, nothing is written to the database), cheetahs-rugby-t-shirt (one
 * colour, all eight sizes), gymshark-phone-strap (one-size accessory: a ONE row at stock 0 is
 * injected, the live shop's shape), energy-t-shirt-red-white (six fits), cagliari-calcio-backpack
 * (no size rows), sgomma-t-shirt-navy (the adviser). Phone = Pixel 7 (pointer: coarse), computer =
 * 1280x900, English and Arabic.
 *
 * MUTATE=<key> serves the built stylesheets with that fix's rules taken out (the files on disk are
 * not touched) and the run must FAIL: P1, P1L (the sold-out label only), P5, P5E (the :empty rule),
 * P6, P6T (the trail), P7, P8, P9, P10a, P10b, P10B (the drawer rule replaced by the first draft,
 * which snapped the drawer shut), P10d, P10e, P10f, P10g, ADV. ONLY=P1,P7 runs a subset.
 */
import { chromium, devices } from 'playwright'
import { PNG } from 'pngjs'
import postcss from 'postcss'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
const MUT = process.env.MUTATE || ''
const run = (k) => !ONLY.length || ONLY.includes(k)
let fails = 0, oks = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; else oks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

const MULTI = 'cloudsoft-jacket-army-green', ONECOL = 'cheetahs-rugby-t-shirt', STRAP = 'gymshark-phone-strap'
const SIXFIT = 'energy-t-shirt-red-white', NOROWS = 'cagliari-calcio-backpack', ADVISOR = 'sgomma-t-shirt-navy'
const SOLD_EN = 'Sold out', SOLD_AR = 'نفذت الكمية'
const NOTCARRIED = /Struck-through sizes are not carried|المقاسات المشطوبة غير متوفرة/

/* ---- mutations: the built CSS served without one fix (selector substring [+ property] [+ media]) */
const STRIP = {
  P1: [{ sel: 'carried in this piece' }, { sel: 'غير متوفرة في هذه القطعة' }, { sel: '[role=group] ~ p.mt-2' }, { sel: '.rounded-2xl > .min-h-10 > p' }, { sel: '.mt-6.space-y-3 .rounded-2xl > p' }],
  P1L: [{ sel: '::after', also: 'carried in this piece' }],
  P5: [{ sel: '> p.mt-3.text-lg', prop: 'order' }],
  P5E: [{ sel: '.space-y-3:empty', media: 'min-width' }],
  P6: [{ sel: 'section.mx-auto.max-w-5xl:has(h1.product-title) .space-y-3 .rounded-2xl div.flex.flex-wrap.gap-2' }],
  P6T: [{ sel: 'section.mx-auto.max-w-5xl:has(h1.product-title)', prop: 'padding-top', media: 'min-width' }, { sel: '> nav.mb-6', prop: 'margin-bottom', media: 'min-width' }],
  P7: [{ sel: 'button[aria-pressed="true"]:not(:disabled)' }, { sel: 'li > a[aria-current="page"]', also: 'main:not(.admin-content)' }],
  P8: [{ sel: 'main .mt-6.space-y-3 > .rounded-2xl:has(> ul)' }],
  P9: [{ sel: '> .md\\:sticky', prop: 'display' }, { sel: '> .md\\:sticky > .rounded-2xl', prop: 'order' }],
  P10a: [{ sel: '> .md\\:sticky', prop: 'top' }],
  P10b: [{ sel: 'aside.cart-drawer.pointer-events-none' }],
  P10B: [{ sel: 'aside.cart-drawer.pointer-events-none', replace: 'box-shadow: none !important; visibility: hidden; transition: transform .3s ease-out, visibility 0s linear .3s' }],
  P10d: [{ sel: '4\\.75rem' }],
  P10e: [{ sel: '[data-sporta-size-guide] th' }],
  P10f: [{ sel: '.group.aspect-square img[src^="data:image/svg"]' }],
  P10g: [{ sel: 'flex-wrap:has(> .btn-primary) > .rounded-full.border' }],
  ADV: [{ sel: '.filter-scroller', also: '[role="dialog"]', not: 'aria-pressed' }],
}
if (MUT && !STRIP[MUT]) { console.log(`FAIL unknown MUTATE=${MUT}`); process.exit(2) }
function strip(css, specs) {
  const root = postcss.parse(css)
  let hits = 0
  root.walkRules((rule) => {
    for (const s of specs) {
      if (!rule.selector.includes(s.sel) || (s.also && !rule.selector.includes(s.also)) || (s.not && rule.selector.includes(s.not))) continue
      if (s.media) { const at = rule.parent && rule.parent.type === 'atrule' ? rule.parent.params : ''; if (!at.includes(s.media)) continue }
      if (s.replace) { rule.removeAll(); rule.append(s.replace); hits++; continue }
      if (s.prop) { rule.walkDecls(s.prop, (d) => { d.remove(); hits++ }); continue }
      rule.remove(); hits++
      break
    }
  })
  return { css: root.toString(), hits }
}
let mutHits = 0

/* ---- one page in one context */
async function open(slug, { dev = 'phone', lang = 'en', sold = [], addOne = [], width } = {}) {
  const opts = dev === 'phone' ? devices['Pixel 7'] : { viewport: { width: width ?? 1280, height: 900 } }
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l); localStorage.removeItem('sporta_cart') } catch (e) {} }, lang)
  if (MUT) await ctx.route(/\/assets\/sporta-(ui|mobile|desktop)\.css/, async (route) => {
    const r = await route.fetch(); const out = strip(await r.text(), STRIP[MUT]); mutHits += out.hits
    await route.fulfill({ response: r, body: out.css, headers: { ...r.headers(), 'content-type': 'text/css' } })
  })
  if (sold.length || addOne.length) await ctx.route('**/api/api.php?r=stock*', async (route) => {
    const r = await route.fetch(); const j = await r.json()
    for (const [s, z] of sold) for (const row of j) if (row.slug === s && row.size === z) { row.stock = 0; row.in_stock = false }
    for (const [s, n] of addOne) j.push({ slug: s, size: 'ONE', sku: s.slice(0, 26).toUpperCase() + '-ONE', stock: n, in_stock: n > 0 })
    await route.fulfill({ response: r, json: j })
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/product/${slug}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('h1.product-title')
  await p.waitForTimeout(1200)
  return { ctx, p, tag: `[${dev}${width ? width : ''} ${lang}] ${slug.split('-').slice(0, 2).join('-')}` }
}

/* in-page helpers, installed on every page we measure */
const HELPERS = () => {
  window.__h = {
    vis: (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' },
    box: (e) => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, w: r.width, h: r.height, cx: r.left + r.width / 2 } },
    rgb: (c) => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)] },
    lum: (rgb) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) },
    contrast: (a, b) => { const la = __h.lum(a), lb = __h.lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) },
    textMid: (e) => { const r = document.createRange(); r.selectNodeContents(e); const rs = [...r.getClientRects()].filter((x) => x.width); return rs.map((x) => x.left + x.width / 2) },
    lines: (row) => { const L = {}; for (const k of row.children) { const r = k.getBoundingClientRect(); if (!r.width) continue; const y = Math.round(r.top); (L[y] = L[y] || []).push(r) } return Object.values(L) },
    sizeRow: () => document.querySelector('main .mt-6.space-y-3 [role=group][aria-label]:not(#fit-options *)'),
    textCol: () => document.querySelector('h1.product-title').parentElement.parentElement,
  }
}
const prep = (p) => p.evaluate(HELPERS)
const meanLum = (png) => { let s = 0, n = 0; for (let i = 0; i < png.data.length; i += 4) { s += png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114; n++ } return s / n }
const DEVS = ['phone', 'desktop'], LANGS = ['en', 'ar']

try {
  /* ============================================================== P1: sizes, sold out, hints */
  if (run('P1')) for (const dev of DEVS) for (const lang of LANGS) {
    const { ctx, p, tag } = await open(MULTI, { dev, lang, sold: [[MULTI, 'M']] }); await prep(p)
    const api = await p.evaluate(async (slug) => (await (await fetch('/api/api.php?r=products')).json()).find((x) => x.slug === slug).size_options.map((o) => o.size), MULTI)
    const m = await p.evaluate(() => {
      const row = __h.sizeRow()
      const vis = [...row.querySelectorAll(':scope > button')].filter(__h.vis)
      const M = vis.find((b) => b.querySelector('span').textContent.trim() === 'M')
      const L = vis.find((b) => b.querySelector('span').textContent.trim() === 'L')
      const block = document.querySelector('main .mt-6.space-y-3')
      const hintTexts = [...block.querySelectorAll('p')].filter(__h.vis).map((e) => e.textContent.trim())
      // every visible hint line under the size and colour cards, centred on its card
      const offs = [...block.querySelectorAll('.rounded-2xl > p, .rounded-2xl > .min-h-10 > p')].filter(__h.vis).map((e) => {
        const card = e.closest('.rounded-2xl').getBoundingClientRect(); const mid = card.left + card.width / 2
        return Math.max(...__h.textMid(e).map((x) => Math.abs(x - mid)))
      })
      return {
        labels: vis.map((b) => b.querySelector('span').textContent.trim()),
        heights: vis.map((b) => Math.round(b.getBoundingClientRect().height)),
        mAfter: M ? getComputedStyle(M, '::after').content : null, mDis: M ? M.disabled : null, lDis: L ? L.disabled : null,
        hintTexts, offs, scrollW: document.documentElement.scrollWidth, W: innerWidth,
      }
    })
    const want = lang === 'ar' ? SOLD_AR : SOLD_EN
    check(JSON.stringify(m.labels) === JSON.stringify(api), `${tag} P1: only the sizes the piece is made in are drawn (= ?r=products size_options)`, `${m.labels.join(' ')} vs ${api.join(' ')}`)
    check(m.mDis === true && m.mAfter === `"${want}"` && m.lDis === false, `${tag} P1: the sold-out M is disabled and says "${want}" under the letter; L is choosable`, `after=${m.mAfter}`)
    check(m.heights.length && m.heights.every((h) => h === m.heights[0] && h >= 44), `${tag} P1: the size boxes keep one height, at least 44px`, m.heights.join('/'))
    check(!m.hintTexts.some((t) => NOTCARRIED.test(t)), `${tag} P1: no "struck-through sizes are not carried" hint`, m.hintTexts.join(' | '))
    check(m.offs.length >= 2 && m.offs.every((o) => o <= 2), `${tag} P1: every hint line is centred under its centred buttons`, m.offs.map((o) => o.toFixed(1)).join(' '))
    check(m.scrollW <= m.W, `${tag} P1: nothing scrolls sideways`, `${m.scrollW} in ${m.W}`)
    if (dev === 'phone') {   // the Fit card's note appears only when the chooser is opened on a phone
      await p.locator('button[aria-controls="fit-options"]').click(); await p.waitForTimeout(300)
      const f = await p.evaluate(() => { const card = document.querySelector('#fit-options').closest('.rounded-2xl'); const e = [...card.querySelectorAll(':scope > p')].find(__h.vis); if (!e) return null; const c = card.getBoundingClientRect(); return Math.max(...__h.textMid(e).map((x) => Math.abs(x - (c.left + c.width / 2)))) })
      check(f !== null && f <= 2, `${tag} P1: the Fit card's note, opened on a phone, is centred`, f === null ? 'no note' : `${f.toFixed(1)}px off`)
    }
    await ctx.close()
    if (lang === 'en') {
      const a = await open(ONECOL, { dev, lang }); await prep(a.p)
      const n = await a.p.evaluate(() => [...__h.sizeRow().querySelectorAll(':scope > button')].filter(__h.vis).length)
      check(n === 8, `${a.tag} P1: a piece made in every size still shows all eight`, String(n))
      await a.ctx.close()
      const s = await open(STRAP, { dev, lang, addOne: [[STRAP, 0]] }); await prep(s.p)
      const o = await s.p.evaluate(() => { const row = __h.sizeRow(); if (!row) return null; const v = [...row.querySelectorAll(':scope > button')].filter(__h.vis); return v.map((b) => `${b.querySelector('span').textContent.trim()}|${b.disabled}|${getComputedStyle(b, '::after').content}`) })
      check(o && o.length === 1 && o[0] === `ONE|true|"${SOLD_EN}"`, `${s.tag} P1: a one-size accessory (ONE at stock 0, the live shape) shows one box, "ONE / Sold out" — not eight struck clothing sizes`, o ? o.join(' ') : 'no size row')
      await s.ctx.close()
    }
  }

  /* ============================================================== P5: computer, description last */
  if (run('P5')) for (const lang of LANGS) {
    for (const width of [820, 1280]) {
      const { ctx, p, tag } = await open(MULTI, { dev: 'desktop', lang, width }); await prep(p)
      const m = await p.evaluate(() => {
        const col = __h.textCol(); const kids = [...col.children]
        const by = (f) => kids.find(f)
        const get = { title: by((e) => e.querySelector('h1.product-title')), price: by((e) => e.tagName === 'P' && /items-baseline/.test(e.className)),
          size: by((e) => /space-y-3/.test(e.className)), buy: by((e) => e.tagName === 'DIV' && /flex-wrap/.test(e.className) && e.querySelector('.btn-primary')),
          list: by((e) => e.tagName === 'UL'), desc: by((e) => e.tagName === 'P' && /text-lg/.test(e.className)) }
        const b = {}; for (const [k, e] of Object.entries(get)) if (e && __h.vis(e)) b[k] = __h.box(e)
        const icon = get.list && get.list.querySelector('li svg'); const rr = document.createRange(); if (get.desc) rr.selectNodeContents(get.desc)
        const dr = get.desc && __h.vis(get.desc) ? [...rr.getClientRects()][0] : null
        const ar = document.documentElement.dir === 'rtl'
        return { b, edge: icon && dr ? (ar ? Math.abs(icon.getBoundingClientRect().right - dr.right) : Math.abs(icon.getBoundingClientRect().left - dr.left)) : null, scrollW: document.documentElement.scrollWidth, W: innerWidth }
      })
      const order = ['title', 'price', 'size', 'buy', 'list', 'desc'].filter((k) => m.b[k])
      const tops = order.map((k) => m.b[k].top)
      if (lang === 'en') check(!!m.b.desc, `${tag} P5: the fixture has a visible description`)
      check(order.length >= 5 && tops.every((t, i) => i === 0 || t >= tops[i - 1]), `${tag} P5: painted as name, price, choices, Add row, delivery list${m.b.desc ? ', description' : ''}`, order.map((k, i) => `${k}@${Math.round(tops[i])}`).join(' '))
      if (m.b.desc) {
        const gap = m.b.desc.top - m.b.list.bottom
        check(gap >= 16 && gap <= 32, `${tag} P5: the description sits 16-32px under the delivery list`, `${Math.round(gap)}px`)
        check(m.edge !== null && m.edge <= 2, `${tag} P5: its start edge is level with the delivery list's icons`, m.edge === null ? '-' : `${m.edge.toFixed(1)}px`)
      }
      check(m.scrollW <= m.W, `${tag} P5: nothing scrolls sideways`)
      await ctx.close()
    }
    const { ctx, p, tag } = await open(NOROWS, { dev: 'desktop', lang }); await prep(p)
    const g = await p.evaluate(() => { const col = __h.textCol(); const price = [...col.children].find((e) => e.tagName === 'P' && /items-baseline/.test(e.className)); const buy = [...col.children].find((e) => e.querySelector && e.querySelector('.btn-primary')); return buy.getBoundingClientRect().top - price.getBoundingClientRect().bottom })
    check(g >= 16 && g <= 40, `${tag} P5: a product with no size rows keeps a 16-40px price-to-Add gap (no doubled flex margin)`, `${Math.round(g)}px`)
    await ctx.close()
  }

  /* ============================================================== P6: computer, trail and rows */
  if (run('P6')) for (const lang of LANGS) {
    for (const slug of [ONECOL, MULTI, SIXFIT]) {
      const { ctx, p, tag } = await open(slug, { dev: 'desktop', lang }); await prep(p)
      const m = await p.evaluate(() => {
        const sec = document.querySelector('h1.product-title').closest('section'), nav = sec.querySelector(':scope > nav'), grid = nav.nextElementSibling
        const rows = [...document.querySelectorAll('main .mt-6.space-y-3 [role=group]')].map((r) => ({ label: r.getAttribute('aria-label'), lines: __h.lines(r).map((l) => l.length), n: [...r.children].filter((k) => k.getBoundingClientRect().width).length,
          off: Math.max(0, ...__h.lines(r).map((rs) => { const c = r.closest('.rounded-2xl').getBoundingClientRect(); return Math.abs((Math.min(...rs.map((x) => x.left)) + Math.max(...rs.map((x) => x.right))) / 2 - (c.left + c.width / 2)) })),
          minW: Math.min(...[...r.children].map((k) => k.getBoundingClientRect()).filter((x) => x.width).map((x) => Math.min(x.width, x.height))) }))
        return { above: nav.getBoundingClientRect().top - sec.getBoundingClientRect().top, below: grid.getBoundingClientRect().top - nav.getBoundingClientRect().bottom, rows }
      })
      if (slug === ONECOL) check(Math.abs(m.above - 24) <= 2 && Math.abs(m.below - 16) <= 2, `${tag} P6: the trail band is 24px over and 16px under, give or take the trail's own sub-pixel line (was 50 / 25)`, `${Math.round(m.above)} / ${Math.round(m.below)}`)
      for (const r of m.rows) {
        if (r.n === 8 || r.n === 5) check(r.lines.length === 1, `${tag} P6: ${r.n} ${r.label} buttons sit on one row`, r.lines.join('+'))
        if (r.n === 6) check(r.lines.length === 2 && r.lines[0] === 3 && r.lines[1] === 3, `${tag} P6: six fits are two even rows of three`, r.lines.join('+'))
        if (r.n > 1) check(r.lines.every((c) => c > 1), `${tag} P6: no ${r.label} line holds a single button`, r.lines.join('+'))
        check(r.off <= 2 && r.minW >= 44, `${tag} P6: ${r.label} buttons stay centred and at least 44px`, `${r.off.toFixed(1)}px off, smallest ${Math.round(r.minW)}px`)
      }
      await ctx.close()
    }
  }

  /* ============================================================== P7: chosen size / fit / colour */
  if (run('P7')) for (const dev of DEVS) for (const lang of LANGS) {
    const { ctx, p, tag } = await open(MULTI, { dev, lang, sold: [[MULTI, 'M']] }); await prep(p)
    await p.locator('main [role=group] > button:not([disabled])', { hasText: /^L$/ }).first().click(); await p.waitForTimeout(300)
    const m = await p.evaluate(() => {
      const row = __h.sizeRow(); const L = [...row.children].find((b) => b.getAttribute('aria-pressed') === 'true'); const M = [...row.children].find((b) => b.disabled && __h.vis(b))
      const s = L && getComputedStyle(L), fill = L && __h.rgb(s.backgroundColor), ink = L && __h.rgb(s.color)
      const cur = document.querySelector('main .rounded-2xl ul > li > a[aria-current="page"]'), cs = cur && getComputedStyle(cur)
      const fitOn = document.querySelector('#fit-options [aria-pressed="true"]'), fs = fitOn && __h.vis(fitOn) ? getComputedStyle(fitOn) : null
      return { picked: L ? L.textContent.trim() : null, fill, ink, vsWhite: L ? __h.contrast(fill, [255, 255, 255]) : 0, label: L ? __h.contrast(fill, ink) : 0,
        vsSold: L && M ? __h.contrast(fill, __h.rgb(getComputedStyle(M).backgroundColor)) : null,
        ring: cs ? __h.rgb(cs.borderTopColor) : null, ringW: cs ? parseFloat(cs.borderTopWidth) : 0, inset: cs ? /inset/.test(cs.boxShadow) : false,
        fit: fs ? __h.contrast(__h.rgb(fs.backgroundColor), [255, 255, 255]) : null }
    })
    check(m.picked === 'L' && m.vsWhite >= 15 && m.label >= 15, `${tag} P7: the chosen size is dark with white letters`, `fill ${m.fill} ink ${m.ink}: ${m.vsWhite.toFixed(2)}:1 vs white, label ${m.label.toFixed(2)}:1`)
    check(m.vsSold !== null && m.vsSold >= 10, `${tag} P7: "chosen" cannot be mistaken for the sold-out size`, m.vsSold === null ? 'no sold-out box' : `${m.vsSold.toFixed(2)}:1`)
    check(m.ring && m.ring.join() === '23,26,30' && m.ringW >= 1 && m.inset, `${tag} P7: the colour being viewed has a firm dark ring`, `${m.ring} ${m.ringW}px inset=${m.inset}`)
    if (dev === 'desktop') check(m.fit !== null && m.fit >= 15, `${tag} P7: the chosen fit is dark too`, m.fit === null ? 'no fit chip' : `${m.fit.toFixed(2)}:1`)
    // the owner's Secondary button colour, as theme.js would set it on :root
    if (dev === 'desktop' && lang === 'en') for (const [hex, wantInk] of [['#a6acb2', 'dark'], ['#e0561c', 'dark'], ['#eaecee', 'dark'], ['#1d2f55', 'white']]) {
      await p.evaluate((h) => { let s = document.getElementById('t-sec'); if (!s) { s = document.createElement('style'); s.id = 't-sec'; document.head.appendChild(s) } s.textContent = `:root{--sp-secondary-bg:${h}}` }, hex)
      await p.waitForTimeout(450)   // the chips carry the bundle's `transition`: read the settled colour
      const o = await p.evaluate(() => { const L = [...__h.sizeRow().children].find((b) => b.getAttribute('aria-pressed') === 'true'); const s = getComputedStyle(L); const f = __h.rgb(s.backgroundColor), i = __h.rgb(s.color); const cur = getComputedStyle(document.querySelector('main .rounded-2xl ul > li > a[aria-current="page"]')); const ring = __h.rgb(cur.borderTopColor); return { f, i, c: __h.contrast(f, i), ringVsWhite: __h.contrast(ring, [255, 255, 255]) } })
      const hexRgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
      check(o.f.join() === hexRgb.join() && o.c >= 4.5 && (wantInk === 'white' ? o.i.join() === '255,255,255' : o.i.every((v) => v < 40)), `${tag} P7: an owner Secondary colour ${hex} fills the chosen size, with ${wantInk} ink`, `fill ${o.f} ink ${o.i}, ${o.c.toFixed(2)}:1`)
      check(o.ringVsWhite >= 3, `${tag} P7: ...and the colour ring stays visible on the white card`, `${o.ringVsWhite.toFixed(2)}:1`)
    }
    await ctx.close()
  }

  /* ============================================================== P8: phone, colour before size */
  if (run('P8')) for (const lang of LANGS) {
    for (const dev of DEVS) {
      const { ctx, p, tag } = await open(MULTI, { dev, lang }); await prep(p)
      const m = await p.evaluate(() => {
        const block = document.querySelector('main .mt-6.space-y-3')
        const colour = [...block.children].find((e) => e.querySelector(':scope > ul a[href^="/product/"]')), size = [...block.children].find((e) => e.querySelector('[role=group]:not(#fit-options *)'))
        const fit = document.querySelector('#fit-options').closest('.rounded-2xl')
        return { c: __h.box(colour), s: __h.box(size), f: __h.box(fit), domSizeFirst: !!(size.compareDocumentPosition(colour) & Node.DOCUMENT_POSITION_FOLLOWING) }
      })
      if (dev === 'phone') {
        check(m.c.bottom <= m.s.top && Math.abs(m.s.top - m.c.bottom - 12) <= 1, `${tag} P8: the colour box paints first, 12px above the size box`, `colour ${Math.round(m.c.top)}-${Math.round(m.c.bottom)}, size ${Math.round(m.s.top)}`)
        check(Math.abs(m.f.top - m.s.bottom - 12) <= 1, `${tag} P8: size to fit is still 12px`, `${Math.round(m.f.top - m.s.bottom)}px`)
      } else check(m.c.top >= m.f.bottom, `${tag} P8: a computer keeps size, fit, colour (screen order = Tab order)`, `colour ${Math.round(m.c.top)} fit ${Math.round(m.f.bottom)}`)
      check(m.domSizeFirst, `${tag} P8: the DOM (screen-reader and Tab) order is unchanged`)
      await ctx.close()
    }
    // a one-colour piece has no colour box: its choices keep their order and their 12px (the block is a
    // flex column on every product since the :has()-gated draft cost /shop its scroll; same layout)
    const { ctx, p, tag } = await open(ONECOL, { dev: 'phone', lang }); await prep(p)
    const d = await p.evaluate(() => {
      const block = document.querySelector('main .mt-6.space-y-3'), kids = [...block.children].filter(__h.vis).map(__h.box)
      return { n: kids.length, colour: !!block.querySelector('ul a[href^="/product/"]'), gaps: kids.slice(1).map((k, i) => Math.round(k.top - kids[i].bottom)), top: Math.round(kids[0].top - __h.box(block).top) }
    })
    check(!d.colour && d.n >= 2 && d.top === 0 && d.gaps.every((g) => g === 12), `${tag} P8: a one-colour piece keeps size then fit, 12px apart, from the block's top`, JSON.stringify(d))
    await ctx.close()
  }

  /* ============================================================== P9: phone, the name after the photo */
  if (run('P9')) for (const lang of LANGS) for (const dev of DEVS) for (const slug of [MULTI, ONECOL]) {
    const { ctx, p, tag } = await open(slug, { dev, lang }); await prep(p)
    const m = await p.evaluate(() => {
      const g = document.querySelector('.group.aspect-square'), strip = document.querySelector('main div.rounded-2xl:has(> picture > img[src*="logo-white"])')
      const col = __h.textCol(), title = document.querySelector('h1.product-title').parentElement
      return { g: __h.box(g), strip: strip && __h.box(strip), col: __h.box(col), title: __h.box(title) }
    })
    if (dev === 'phone') {
      const gap = m.title.top - m.g.bottom
      check(gap >= 16 && gap <= 40, `${tag} P9: the name follows the photo (16-40px)`, `${Math.round(gap)}px`)
      check(m.strip && m.strip.top >= m.col.bottom + 16, `${tag} P9: the logo strip paints after the buying column`, m.strip ? `strip ${Math.round(m.strip.top)}, column ends ${Math.round(m.col.bottom)}` : 'no strip')
    } else check(m.strip && Math.abs(m.strip.top - m.g.bottom - 16) <= 2, `${tag} P9: a computer keeps the strip under the photo`, m.strip ? `${Math.round(m.strip.top - m.g.bottom)}px` : 'no strip')
    await ctx.close()
  }

  /* ============================================================== P10 */
  if (run('P10')) {
    // (a) the stuck photo column stops below the header
    for (const lang of LANGS) {
      const { ctx, p, tag } = await open(MULTI, { dev: 'desktop', lang }); await prep(p)
      // scroll INTO the stuck range: just past the point where the column's own top would pass under the
      // header (10px), well before the grid row ends and carries it away (the range is the text column's
      // extra length — 124px en / 74px ar on this product at 1280; a short page has no stuck range at all)
      const a = await p.evaluate(async () => {
        const col = document.querySelector('.md\\:sticky'), text = __h.textCol(), hdr = document.querySelector('header.app-header')
        const c = __h.box(col), t = __h.box(text), range = t.bottom - c.bottom
        window.scrollTo({ top: c.top - hdr.getBoundingClientRect().bottom + 10, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 250))
        return { range, g: document.querySelector('.group.aspect-square').getBoundingClientRect().top, h: hdr.getBoundingClientRect().bottom, carried: col.getBoundingClientRect().top > c.top - scrollY + 1 }
      })
      check(a.range > 30 && a.carried && a.g >= a.h + 4, `${tag} P10a: scrolled, the stuck photo stays below the header (rounded corners whole)`, `photo top ${Math.round(a.g)}, header bottom ${Math.round(a.h)}, stuck range ${Math.round(a.range)}px`)
      await ctx.close()
    }
    // (b) the closed drawer paints nothing at the page's end edge, and still slides shut
    for (const [dev, lang] of [['desktop', 'en'], ['phone', 'ar'], ['desktop', 'ar']]) {
      const { ctx, p, tag } = await open(MULTI, { dev, lang }); await prep(p)
      const edge = async () => {
        const x = await p.evaluate(() => document.documentElement.dir === 'rtl' ? 0 : document.documentElement.clientWidth - 1)
        const png = PNG.sync.read(await p.screenshot({ clip: { x, y: 420, width: 1, height: 40 } }))
        return Math.min(...Array.from({ length: png.height }, (_, i) => png.data[i * png.width * 4]))
      }
      const e0 = await edge()
      const vis0 = await p.evaluate(() => getComputedStyle(document.querySelector('aside.cart-drawer')).visibility)
      check(e0 >= 250 && vis0 === 'hidden', `${tag} P10b: the closed bag drawer paints no shadow down the page's end edge`, `edge ${e0}/255, drawer ${vis0}`)
      await p.locator('header.app-header button[aria-label^="Bag"], header.app-header button[aria-label^="الحقيبة"]').first().click()
      await p.waitForTimeout(600)
      const open1 = await p.evaluate(() => { const d = document.querySelector('aside.cart-drawer'); const s = getComputedStyle(d); return { v: s.visibility, sh: s.boxShadow !== 'none', x: d.getBoundingClientRect().left } })
      check(open1.v === 'visible' && open1.sh, `${tag} P10b: the open drawer is visible with its shadow`, JSON.stringify(open1))
      const slide = await p.evaluate(() => new Promise((res) => {
        const d = document.querySelector('aside.cart-drawer'); const x0 = d.getBoundingClientRect().left; const xs = []
        d.querySelector('header button').click()
        const t0 = performance.now()
        const tick = () => { const r = d.getBoundingClientRect(); xs.push([Math.round(performance.now() - t0), Math.round(r.left), getComputedStyle(d).visibility]); if (performance.now() - t0 < 520) requestAnimationFrame(tick); else res({ x0, xs }) }
        requestAnimationFrame(tick)
      }))
      const xEnd = slide.xs[slide.xs.length - 1][1]
      const mid = slide.xs.filter(([t, x, v]) => t > 20 && t < 260 && v === 'visible' && x !== Math.round(slide.x0) && x !== xEnd)
      check(mid.length >= 3, `${tag} P10b: the drawer still SLIDES shut (visible, in between, for several frames)`, `${mid.length} in-between frames; ${slide.xs.filter((_, i) => i % 4 === 0).map((s) => s.join(':')).join(' ')}`)
      check(slide.xs[slide.xs.length - 1][2] === 'hidden' && (await edge()) >= 250, `${tag} P10b: ...and is hidden once it is off screen`)
      await ctx.close()
    }
    // (d) (e) (f) (g)
    for (const dev of DEVS) for (const lang of LANGS) {
      const { ctx, p, tag } = await open(ONECOL, { dev, lang }); await prep(p)
      const png = PNG.sync.read(await p.locator('.group.aspect-square').screenshot())
      const lum = meanLum(png)
      check(lum >= 180, `${tag} P10f: "photo coming soon" is the light panel the cards use`, `mean brightness ${Math.round(lum)}/255`)
      const g = await p.evaluate(() => { const row = document.querySelector('h1.product-title').parentElement.parentElement.querySelector(':scope > div.flex-wrap:has(> .btn-primary)'); const st = row.querySelector(':scope > .rounded-full.border'); const add = row.querySelector('.btn-primary'); return { st: st.getBoundingClientRect().height, add: add.getBoundingClientRect().height, btns: [...st.querySelectorAll('button')].map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]) } })
      check(Math.abs(g.st - g.add) <= 1 && g.btns.every(([w, h]) => w >= 44 && h >= 44), `${tag} P10g: the quantity stepper is as tall as Add and its - / + are at least 44px`, `stepper ${Math.round(g.st)} Add ${Math.round(g.add)}, buttons ${g.btns.map((b) => b.join('x')).join(' ')}`)
      if (dev === 'phone') {
        const e = await p.evaluate(() => {
          const t = document.querySelector('[data-sporta-size-guide] table'); if (!t) return null
          const rtl = getComputedStyle(t).direction === 'rtl'
          const ths = [...t.querySelectorAll('thead th')], tds = [...t.querySelectorAll('tbody tr:first-child td')]
          const ink = (c) => { const r = document.createRange(); r.selectNodeContents(c); return r.getBoundingClientRect() }
          return ths.map((th, i) => { const a = ink(th), b = tds[i] && ink(tds[i]); return b ? Math.abs(rtl ? a.right - b.right : a.left - b.left) : 99 })
        })
        check(e && e.length >= 2 && e.every((o) => o <= 2), `${tag} P10e: the size guide's headings sit over their columns`, e ? e.map((o) => o.toFixed(1)).join(' / ') : 'no size guide')
        const d = await p.evaluate(async () => {
          const cards = [...document.querySelectorAll('main article')]; const last = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom))
          const foot = document.querySelector('footer.app-footer'); const gap = foot.getBoundingClientRect().top - last
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 300))
          const texts = [...foot.querySelectorAll('p, a, span')].filter((x) => x.getBoundingClientRect().height && x.textContent.trim())
          const lastText = Math.max(...texts.map((x) => x.getBoundingClientRect().bottom)); const bar = document.querySelector('.action-bar').getBoundingClientRect().top
          return { gap, lastText, bar }
        })
        check(d.gap <= 120, `${tag} P10d: the buy bar's room is reserved once (last card to footer)`, `${Math.round(d.gap)}px (was 176)`)
        check(d.lastText <= d.bar, `${tag} P10d: scrolled to the end, the footer's last line still clears the buy bar`, `text ends ${Math.round(d.lastText)}, bar ${Math.round(d.bar)}`)
      }
      await ctx.close()
    }
  }

  /* ============================================================== ADV: the adviser's chips */
  if (run('ADV')) for (const [dev, lang, width] of [['desktop', 'en', 1280], ['desktop', 'ar', 1280], ['desktop', 'en', 820], ['phone', 'en'], ['phone', 'ar']]) {
    const { ctx, p, tag } = await open(ADVISOR, { dev, lang, width: dev === 'desktop' ? width : undefined }); await prep(p)
    await p.getByRole('button', { name: lang === 'ar' ? /مقاسي|مقاسك/ : /What is my size/ }).first().click()
    await p.waitForSelector('[role=dialog] .filter-scroller'); await p.waitForTimeout(400)
    const measure = () => p.evaluate(() => {
      const card = document.querySelector('[role=dialog] .card')
      const rows = [...document.querySelectorAll('[role=dialog] .filter-scroller')].map((r) => { const rr = r.getBoundingClientRect(); return { over: r.scrollWidth - r.clientWidth, cut: [...r.children].filter((c) => { const b = c.getBoundingClientRect(); return b.left < rr.left - 0.5 || b.right > rr.right + 0.5 }).map((c) => c.textContent.trim()) } })
      const pressed = [...document.querySelectorAll('[role=dialog] .filter-scroller > button[aria-pressed="true"]')].map((b) => { const s = getComputedStyle(b); const f = __h.rgb(s.backgroundColor); return Math.min(__h.contrast(f, [255, 255, 255]), __h.contrast(f, __h.rgb(s.color))) })
      return { rows, pressed, card: card.scrollWidth - card.clientWidth, cardH: card.getBoundingClientRect().height, vh: innerHeight }
    })
    for (const tab of [null, 1]) {
      if (tab !== null) { await p.locator('[role=dialog] .filter-scroller').first().locator('button').nth(tab).click(); await p.waitForTimeout(300) }
      const m = await measure(); const which = tab === null ? 'opening tab' : '"I know my usual size" tab'
      if (dev === 'desktop') {
        check(m.rows.length >= 2 && m.rows.every((r) => r.over <= 1 && !r.cut.length), `${tag} ADV: on the ${which} every answer chip is whole`, m.rows.map((r) => `${r.over}${r.cut.length ? ' cut:' + r.cut.join(',') : ''}`).join(' | '))
        check(m.cardH <= Math.min(m.vh, 720), `${tag} ADV: the dialog still fits a 720px window`, `${Math.round(m.cardH)}px`)
      }
      check(m.card <= 1, `${tag} ADV: on the ${which} the dialog card does not scroll sideways`, `${m.card}px over`)
      if (tab === null) check(m.pressed.length >= 2 && m.pressed.every((c) => c >= 15), `${tag} P7: the adviser's chosen answers are dark with white letters, like the page's`, m.pressed.map((c) => c.toFixed(2)).join(' / '))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (MUT) console.log(`\nMUTATE=${MUT}: ${mutHits} rule(s) taken out of the served stylesheets`)
if (MUT && !mutHits) { console.log('FAIL the mutation matched nothing in the built CSS — it tested nothing'); fails++ }
console.log(fails ? `\n${fails} FAILED (${oks} ok)` : `\nall ok (${oks}) — the product page's sizes, order, colours and display fixes hold`)
process.exit(fails ? 1 : 0)
