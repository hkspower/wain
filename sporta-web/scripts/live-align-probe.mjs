// READ-ONLY alignment probe of the LIVE storefront. Loads pages, scrolls, reads the DOM; clicks nothing, types
// nothing, POSTs nothing.
//
// For every page x language x width it prints ONE compact line (flushed as it is measured):
//   ov      sideways scroll (scrollWidth - clientWidth) and elements past the viewport edge that are not clipped
//   hdr/ftr start/end inset of the header's and footer's outermost visible content (inline-start side first,
//           so RTL and LTR numbers compare directly)
//   main    the gutter: most common start inset of row-start blocks sitting on the page canvas, and the end inset
//           of wide blocks
//   OUT     row-start blocks whose start edge is off their context's common inset by > 2px (context = the page
//           canvas, or the nearest boxed ancestor: background, border, shadow). Centred blocks are not counted.
//   RTL     text-align that is not mirrored (left in RTL / right in LTR), flex rows whose DOM order is not mirrored,
//           arrow / chevron icons and whether they are flipped, forced direction:ltr islands
//   ICON    icon centre vs text INK centre (canvas measureText on the computed font) in rows, > 1.5px
//   GAP     grids / wrapped rows whose column or row gaps differ by > 2px
//   CTR     text-align:center blocks whose box centre is off its context centre (> 2px) or ink is off the box
//   SEC     vertical gaps between the main column's stacked sections
//
// Env: BASE, LANGS (ar,en), WIDTHS (360,390,768,1024,1280), PAGES (comma list, optional).
// Run on the VPS in mcr.microsoft.com/playwright:v1.49.0-noble (see CLAUDE.md "Probing the live site").
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const WIDTHS = (process.env.WIDTHS || '360,390,768,1024,1280').split(',').map(Number)
const out = (s) => process.stdout.write(s + '\n')

let slug = ''
try { const t = await (await fetch(B + '/sitemap.xml')).text(); const all = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); let urls = all; for (const u of all.filter((x) => /\.xml/.test(x))) { const tt = await (await fetch(u)).text(); urls = urls.concat([...tt.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) } const p = urls.find((u) => /\/product\//.test(u) && !/lang=/.test(u)); if (p) slug = p.replace(B, '').replace(/&amp;/g, '&') } catch (e) { out('SITEMAP_ERR ' + String(e).slice(0, 80)) }
out('PRODUCT ' + slug)
const PAGES = process.env.PAGES ? process.env.PAGES.split(',') : ['/', '/shop', '/shop?category=men', slug, '/about', '/returns', '/exchange', '/support', '/track', '/contact', '/cart', '/checkout', '/account', '/wishlist', '/privacy', '/terms', '/no-such-page-align'].filter(Boolean)

// Runs inside the page. Returns a compact string.
function measure() {
  const cw = document.documentElement.clientWidth
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl' || document.documentElement.dir === 'rtl'
  const R = (e) => e.getBoundingClientRect()
  const sy = scrollY
  const vis = (e) => { if (!e || !e.getBoundingClientRect) return false; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false; const q = R(e); return q.width > 0.5 && q.height > 0.5 }
  const visDeep = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0 || x.getAttribute('aria-hidden') === 'true') return false } return vis(e) }
  const UT = /^(-?[a-z0-9]+:)|^(p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|w|h|size|min|max|flex|grid|gap|text|bg|border|rounded|shadow|font|leading|tracking|items|justify|self|place|space|inline|block|hidden|relative|absolute|fixed|sticky|overflow|transition|duration|ease|z|top|left|right|bottom|inset|order|col|row|aspect|object|opacity|cursor|select|pointer|truncate|line|whitespace|break|underline|uppercase|lowercase|capitalize|italic|sr|ring|outline|fill|stroke|shrink|grow|basis|translate|scale|rotate|animate|backdrop|blur|from|to|via|container|divide|list|decoration|antialiased|isolate|contents|table|float|clear|visible|invisible|static|lucide|group|peer|dark|start|end)(-|$)/
  const sig = (e) => { if (!e || !e.tagName) return '?'; const cl = [...e.classList]; const sem = cl.filter((c) => !UT.test(c)).slice(0, 2); const pick = sem.length ? sem : cl.slice(0, 1); let s = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (pick.length ? '.' + pick.join('.') : ''); if (!sem.length && !e.id) { const p = e.parentElement; const ps = p ? [...p.classList].filter((c) => !UT.test(c)).slice(0, 1) : []; if (ps.length) s = p.tagName.toLowerCase() + '.' + ps[0] + '>' + s } const t = (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 14); return s + (t ? '"' + t + '"' : '') }
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1 }
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const boxed = (e) => {
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|IMG|SVG|PICTURE|VIDEO|svg)$/.test(e.tagName)) return false
    const q = R(e); if (q.width < 120 || q.height < 40) return false
    const c = getComputedStyle(e)
    if (alpha(c.backgroundColor) > 0.05 && c.backgroundColor !== bodyBg) return true
    if (c.backgroundImage !== 'none') return true
    if (c.boxShadow && c.boxShadow !== 'none') return true
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(c['border' + s + 'Width']) >= 1 && alpha(c['border' + s + 'Color']) > 0.05 && c['border' + s + 'Style'] !== 'none') { if (s === 'Left' || s === 'Right' || parseFloat(c['border' + (s === 'Top' ? 'Bottom' : 'Top') + 'Width']) >= 1) return true }
    return false
  }
  const header = document.querySelector('header'); const footer = document.querySelector('footer')
  const root = document.querySelector('main') || document.body
  const inChrome = (e) => (header && header.contains(e)) || (footer && footer.contains(e))
  const scroller = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const c = getComputedStyle(x); if (/(auto|scroll)/.test(c.overflowX)) return x } return null }
  const posOut = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'absolute') return true } return false }
  const ins = (q, ctx) => rtl ? { s: ctx.right - q.right, e: q.left - ctx.left } : { s: q.left - ctx.left, e: ctx.right - q.right }
  const r1 = (n) => Math.round(n * 10) / 10
  const parts = []

  // ---- overflow
  const ov = document.documentElement.scrollWidth - cw
  const leaks = []
  for (const e of document.body.querySelectorAll('*')) {
    if (leaks.length > 40) break
    const q = R(e); if (!(q.right > cw + 1 || q.left < -1) || q.width < 1 || q.height < 1) continue
    if (!vis(e)) continue
    let clipped = false
    for (let x = e.parentElement; x && x !== document.documentElement; x = x.parentElement) { const c = getComputedStyle(x); if (c.position === 'fixed' && (R(x).right <= 0 || R(x).left >= cw)) { clipped = true; break } if (c.overflowX !== 'visible' && x !== document.body) { const xq = R(x); if (xq.right <= cw + 1 && xq.left >= -1) { clipped = true; break } } }
    const c = getComputedStyle(e); if (c.position === 'fixed' && (q.right <= 0 || q.left >= cw)) clipped = true
    if (!clipped && !leaks.some((l) => l.e.contains(e))) leaks.push({ e, px: Math.round(Math.max(q.right - cw, -q.left)) })
  }
  parts.push('ov' + ov + (leaks.length ? ' leak:' + leaks.slice(0, 3).map((l) => sig(l.e) + '+' + l.px).join(',') : ''))

  // ---- header / footer edges
  const edge = (box) => { if (!box) return '-'; let s = 1e9, en = 1e9; for (const e of box.querySelectorAll('a,button,img,svg,input,span,p,h1,h2,h3,h4,li,small,div')) { if (!vis(e) || e.closest('svg') && e.tagName !== 'svg' || posOut(e) && !box.contains(e)) continue; if (e.tagName === 'DIV' && !(e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue; const q = R(e); if (q.width >= cw - 1) continue; const v = ins(q, { left: 0, right: cw }); if (v.s >= 0) s = Math.min(s, v.s); if (v.e >= 0) en = Math.min(en, v.e) } return (s > 1e8 ? '-' : r1(s)) + '/' + (en > 1e8 ? '-' : r1(en)) }
  parts.push('hdr ' + edge(header) + ' ftr ' + edge(footer))

  // ---- contexts and candidates
  const ctxOf = new Map()
  const ctxFor = (e) => { for (let x = e.parentElement; x && x !== root.parentElement; x = x.parentElement) { if (x === root) return root; if (ctxOf.has(x) ? ctxOf.get(x) : (ctxOf.set(x, boxed(x)), ctxOf.get(x))) return x } return root }
  const all = [...root.querySelectorAll('*')].filter((e) => !inChrome(e) && !e.closest('svg') && e.tagName !== 'svg')
  const cands = []
  for (const e of all) {
    const c = getComputedStyle(e)
    if (c.display === 'inline' || c.display === 'contents' || c.display === 'none') continue
    if (!visDeep(e)) continue
    const tag = e.tagName
    const direct = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    const isBox = boxed(e)
    if (!(direct || isBox || /^(IMG|INPUT|SELECT|TEXTAREA|BUTTON|TABLE|FORM|PICTURE|VIDEO|IFRAME|A)$/.test(tag))) continue
    if (tag === 'A' && !direct && !isBox && !e.querySelector('img,svg')) continue
    if (posOut(e) || scroller(e)) continue
    const q = R(e); if (q.width < 4 || q.height < 4) continue
    const ctx = ctxFor(e)
    const cq = ctx === root ? { left: 0, right: cw, top: -1e9, bottom: 1e9, width: cw } : R(ctx)
    if (q.width >= cq.width - 1) continue // full bleed inside its context
    cands.push({ e, q, ctx, cq, v: ins(q, cq), c, direct })
  }
  // row-start: no other candidate of the same context overlaps vertically and starts nearer the start side
  const byCtx = new Map(); for (const k of cands) { if (!byCtx.has(k.ctx)) byCtx.set(k.ctx, []); byCtx.get(k.ctx).push(k) }
  const outl = new Map(); let canvasMode = null, canvasEnd = null, nRow = 0
  for (const [ctx, list] of byCtx) {
    const rs = list.filter((a) => !list.some((b) => b !== a && !b.e.contains(a.e) && !a.e.contains(b.e) && Math.min(a.q.bottom, b.q.bottom) - Math.max(a.q.top, b.q.top) > 0.5 * Math.min(a.q.height, b.q.height) && b.v.s < a.v.s - 2))
    nRow += rs.length
    const hist = new Map(); for (const a of rs) { const k = Math.round(a.v.s); hist.set(k, (hist.get(k) || 0) + 1) }
    let mode = null, best = -1; for (const [k, n] of hist) if (n > best || (n === best && k < mode)) { best = n; mode = k }
    if (ctx === root) { canvasMode = mode; const eh = new Map(); for (const a of rs.filter((x) => x.q.width > cw * 0.5)) { const k = Math.round(a.v.e); eh.set(k, (eh.get(k) || 0) + 1) } let bb = -1; for (const [k, n] of eh) if (n > bb) { bb = n; canvasEnd = k } }
    if (mode === null || rs.length < 2) continue
    for (const a of rs) {
      const d = a.v.s - mode
      if (Math.abs(d) <= 2) continue
      if (Math.abs(a.v.s - a.v.e) <= 2) continue // centred in its context
      const ta = a.c.textAlign; if (ta === 'center' && a.q.width > a.cq.width * 0.8) continue
      // skip if its parent is itself an outlier with the same start edge (report the outermost only)
      let dup = false; for (const b of rs) if (b !== a && b.e.contains(a.e) && Math.abs(b.v.s - a.v.s) < 1) { dup = true; break }
      if (dup) continue
      const key = sig(a.e).replace(/".*$/, '') + '@' + (ctx === root ? 'canvas' : sig(ctx).replace(/".*$/, ''))
      const o = outl.get(key) || { key, n: 0, s: r1(a.v.s), mode, sample: sig(a.e), d }
      o.n++; outl.set(key, o)
    }
  }
  parts.push('main ' + canvasMode + '/' + canvasEnd + ' rows' + nRow)
  const ol = [...outl.values()].sort((a, b) => Math.abs(b.d) * (b.n > 1 ? 1.5 : 1) - Math.abs(a.d) * (a.n > 1 ? 1.5 : 1))
  if (ol.length) parts.push('OUT[' + ol.length + '] ' + ol.slice(0, 7).map((o) => o.sample + '@' + o.key.split('@')[1] + ' s' + o.s + ' vs' + o.mode + (o.n > 1 ? ' x' + o.n : '')).join(' ; '))

  // ---- RTL / LTR correctness (whole page incl. header and footer)
  const pageEls = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('svg') && e.tagName !== 'svg')
  const badAlign = new Map(), badFlex = new Map(), ltrIsl = new Map(), inkOff = new Map()
  for (const e of pageEls) {
    if (!vis(e)) continue
    const c = getComputedStyle(e)
    const direct = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (direct && c.display !== 'inline') {
      const wrong = rtl ? c.textAlign === 'left' : c.textAlign === 'right'
      if (wrong && R(e).width > 40) { const k = sig(e).replace(/".*$/, ''); if (!badAlign.has(k)) badAlign.set(k, sig(e) + ' ta:' + c.textAlign + (c.direction !== (rtl ? 'rtl' : 'ltr') ? ' dir:' + c.direction : '')) }
      // ink start vs content start for single-line start-aligned text whose first node is text
      const first = [...e.childNodes].find((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
      const startAligned = c.textAlign === 'start' || (rtl ? c.textAlign === 'right' : c.textAlign === 'left') || (c.textAlign === 'justify')
      if (first && first.nodeType === 3 && startAligned && c.direction === (rtl ? 'rtl' : 'ltr') && !/flex|grid/.test(c.display)) {
        const rg = document.createRange(); rg.selectNodeContents(e); const rects = [...rg.getClientRects()].filter((x) => x.width > 0)
        const q = R(e); const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.4
        if (rects.length && q.height < lh * 1.6) {
          const inkS = rtl ? Math.max(...rects.map((x) => x.right)) : Math.min(...rects.map((x) => x.left))
          const boxS = rtl ? q.right - parseFloat(c.paddingRight) - parseFloat(c.borderRightWidth) : q.left + parseFloat(c.paddingLeft) + parseFloat(c.borderLeftWidth)
          const d = rtl ? boxS - inkS : inkS - boxS
          if (Math.abs(d) > 3 && parseFloat(c.textIndent) === 0) { const k = sig(e).replace(/".*$/, ''); if (!inkOff.has(k)) inkOff.set(k, sig(e) + ' ink' + r1(d)) }
        }
      }
    }
    if (rtl && c.direction === 'ltr' && e.parentElement && getComputedStyle(e.parentElement).direction === 'rtl') { const k = sig(e).replace(/".*$/, ''); if (!ltrIsl.has(k)) ltrIsl.set(k, sig(e)) }
    if (/flex/.test(c.display) && /^row/.test(c.flexDirection)) {
      const kids = [...e.children].filter((k) => vis(k) && !/absolute|fixed/.test(getComputedStyle(k).position))
      if (kids.length >= 2) {
        const a = R(kids[0]), b = R(kids[kids.length - 1])
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.4 * Math.min(a.height, b.height)
        if (sameRow && Math.abs(a.left - b.left) > 2) {
          const firstIsStart = c.direction === 'rtl' ? a.right > b.right : a.left < b.left
          const pageStart = rtl ? a.right > b.right : a.left < b.left
          if (!pageStart) { const k = sig(e).replace(/".*$/, ''); if (!badFlex.has(k)) badFlex.set(k, sig(e) + ' ' + c.flexDirection + (c.direction !== (rtl ? 'rtl' : 'ltr') ? ' dir:' + c.direction : '') + (firstIsStart ? '' : ' reversed')) }
        }
      }
    }
  }
  const arrows = new Map()
  for (const s of document.querySelectorAll('svg')) {
    if (!visDeep(s)) continue
    const cls = s.getAttribute('class') || ''
    const m = /(chevron|arrow|caret)[a-z-]*(left|right|start|end|back|forward)/i.exec(cls) || /(chevron|arrow)/i.exec(cls)
    if (!m) continue
    let flip = false
    for (let x = s, i = 0; x && i < 4; x = x.parentElement, i++) { const t = getComputedStyle(x).transform; if (t && t !== 'none') { const mm = new DOMMatrix(t); if (mm.a < -0.5) flip = !flip } }
    const host = s.closest('a,button,li,nav,[role=button]') || s.parentElement
    const k = m[0] + (flip ? ' flipped' : '') + ' in ' + sig(host).replace(/".*$/, '')
    arrows.set(k, (arrows.get(k) || 0) + 1)
  }
  const rtlParts = []
  if (badAlign.size) rtlParts.push('ta[' + badAlign.size + '] ' + [...badAlign.values()].slice(0, 4).join(','))
  if (badFlex.size) rtlParts.push('flex[' + badFlex.size + '] ' + [...badFlex.values()].slice(0, 4).join(','))
  if (inkOff.size) rtlParts.push('inkstart[' + inkOff.size + '] ' + [...inkOff.values()].slice(0, 3).join(','))
  if (ltrIsl.size) rtlParts.push('ltr[' + ltrIsl.size + '] ' + [...ltrIsl.values()].slice(0, 4).join(','))
  if (arrows.size) rtlParts.push('arrows ' + [...arrows.entries()].slice(0, 6).map(([k, n]) => k + (n > 1 ? ' x' + n : '')).join(','))
  if (rtlParts.length) parts.push('RTL ' + rtlParts.join(' | '))

  // ---- icon vs text ink centre
  const cv = document.createElement('canvas').getContext('2d')
  const inkMid = (node, rect) => {
    const pc = getComputedStyle(node.parentElement)
    cv.font = pc.fontStyle + ' ' + pc.fontWeight + ' ' + pc.fontSize + ' ' + pc.fontFamily
    const m = cv.measureText(node.textContent.trim())
    const fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent
    if (!fa || !fd) return (rect.top + rect.bottom) / 2
    const base = rect.top + rect.height * fa / (fa + fd)
    return base + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
  }
  const iconBad = new Map(); let iconN = 0
  for (const s of document.querySelectorAll('svg')) {
    if (s.parentElement && s.parentElement.closest('svg')) continue
    if (!visDeep(s)) continue
    const sq = R(s); if (sq.width < 8 || sq.width > 40 || sq.height < 8 || sq.height > 40) continue
    let host = null
    for (let x = s.parentElement, i = 0; x && i < 3; x = x.parentElement, i++) { if (R(x).height > 90) break; const w = document.createTreeWalker(x, NodeFilter.SHOW_TEXT); let n, ok = false; while ((n = w.nextNode())) if (n.textContent.trim() && !n.parentElement.closest('svg') && vis(n.parentElement)) { ok = true; break } if (ok) { host = x; break } }
    if (!host) continue
    const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n, mids = []
    while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('svg') || !vis(n.parentElement)) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const rr of rg.getClientRects()) { if (rr.width < 1) continue; if (Math.min(rr.bottom, sq.bottom) - Math.max(rr.top, sq.top) > 0) mids.push(inkMid(n, rr)) } if (mids.length) break }
    if (!mids.length) continue
    iconN++
    const dy = (sq.top + sq.bottom) / 2 - mids[0]
    if (Math.abs(dy) > 1.5) { const k = sig(host).replace(/".*$/, ''); const o = iconBad.get(k) || { s: sig(host), dy: r1(dy), n: 0 }; o.n++; iconBad.set(k, o) }
  }
  parts.push('icons' + iconN)
  if (iconBad.size) parts.push('ICON[' + iconBad.size + '/' + iconN + '] ' + [...iconBad.values()].sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy)).slice(0, 5).map((o) => o.s + ' dy' + o.dy + (o.n > 1 ? ' x' + o.n : '')).join(' ; '))

  // ---- gaps in grids / wrapped rows
  const gapBad = []
  for (const e of pageEls) {
    const c = getComputedStyle(e)
    if (!(c.display.includes('grid') || (c.display.includes('flex') && (c.flexWrap === 'wrap' || /^row/.test(c.flexDirection))))) continue
    const kids = [...e.children].filter((k) => vis(k) && !/absolute|fixed/.test(getComputedStyle(k).position))
    if (kids.length < 3 || !vis(e)) continue
    const rows = []
    for (const k of kids) { const q = R(k); let row = rows.find((r) => Math.abs(r.top - q.top) < 3); if (!row) { row = { top: q.top, items: [] }; rows.push(row) } row.items.push(q) }
    const cg = [], rgp = []
    for (const r of rows) { r.items.sort((a, b) => a.left - b.left); for (let i = 1; i < r.items.length; i++) cg.push(r.items[i].left - r.items[i - 1].right) }
    rows.sort((a, b) => a.top - b.top)
    for (let i = 1; i < rows.length; i++) rgp.push(Math.min(...rows[i].items.map((q) => q.top)) - Math.max(...rows[i - 1].items.map((q) => q.bottom)))
    const spread = (a) => a.length > 1 ? Math.max(...a) - Math.min(...a) : 0
    const sizes = kids.map((k) => Math.round(R(k).width)); const similar = Math.max(...sizes) - Math.min(...sizes) < 0.25 * Math.max(...sizes)
    if (!similar) continue
    if (spread(cg) > 2 || (c.display.includes('grid') && spread(rgp) > 2)) gapBad.push(sig(e).replace(/".*$/, '') + ' n' + kids.length + ' col' + r1(Math.min(...cg)) + '-' + r1(Math.max(...cg)) + (rgp.length ? ' row' + r1(Math.min(...rgp)) + '-' + r1(Math.max(...rgp)) : ''))
  }
  if (gapBad.length) parts.push('GAP[' + gapBad.length + '] ' + [...new Set(gapBad)].slice(0, 4).join(' ; '))

  // ---- centring
  const ctrBad = new Map()
  for (const k of cands) {
    if (k.c.textAlign !== 'center' || !k.direct) continue
    const q = k.q
    const ctxMid = (k.cq.left + k.cq.right) / 2
    const boxMid = (q.left + q.right) / 2
    const rg = document.createRange(); rg.selectNodeContents(k.e); const rects = [...rg.getClientRects()].filter((x) => x.width > 0 && x.top < q.top + parseFloat(k.c.lineHeight || 20) + 2)
    let inkD = 0
    if (rects.length) { const l = Math.min(...rects.map((x) => x.left)), r = Math.max(...rects.map((x) => x.right)); const cl = q.left + parseFloat(k.c.paddingLeft) + parseFloat(k.c.borderLeftWidth), cr = q.right - parseFloat(k.c.paddingRight) - parseFloat(k.c.borderRightWidth); inkD = (l + r) / 2 - (cl + cr) / 2 }
    const boxD = boxMid - ctxMid
    const pc = k.e.parentElement ? getComputedStyle(k.e.parentElement) : null
    const inChips = pc && /flex|grid/.test(pc.display) && k.e.parentElement.children.length > 2
    const alone = !inChips && !cands.some((o) => o !== k && o.ctx === k.ctx && !o.e.contains(k.e) && !k.e.contains(o.e) && Math.min(o.q.bottom, q.bottom) - Math.max(o.q.top, q.top) > 0.5 * Math.min(o.q.height, q.height))
    // a centred line is judged against its own box; the box against its context only when the box is narrower
    if (Math.abs(inkD) > 2 || (alone && Math.abs(boxD) > 2 && q.width < k.cq.width * 0.95)) { const key = sig(k.e).replace(/".*$/, ''); if (!ctrBad.has(key)) ctrBad.set(key, sig(k.e) + ' box' + r1(boxD) + ' ink' + r1(inkD) + '@' + (k.ctx === root ? 'canvas' : sig(k.ctx).replace(/".*$/, ''))) }
  }
  if (ctrBad.size) parts.push('CTR[' + ctrBad.size + '] ' + [...ctrBad.values()].slice(0, 5).join(' ; '))

  // ---- section rhythm: the first element under main with 3+ stacked visible children
  let col = root
  for (let i = 0; i < 5; i++) { const kids = [...col.children].filter(vis); if (kids.length === 1) col = kids[0]; else break }
  const kids = [...col.children].filter((k) => vis(k) && !/absolute|fixed/.test(getComputedStyle(k).position))
  if (kids.length >= 2) { const g = []; for (let i = 1; i < kids.length; i++) g.push(Math.round(R(kids[i]).top - R(kids[i - 1]).bottom)); parts.push('SEC ' + sig(col).replace(/".*$/, '') + ' ' + g.slice(0, 12).join('/')) }
  if (sy) scrollTo(0, sy)
  return parts.join(' || ')
}

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
for (const lang of LANGS) for (const w of WIDTHS) for (const path of PAGES) {
  const t0 = Date.now()
  const ctx = await b.newContext({ viewport: { width: w, height: w < 700 ? 800 : w < 1100 ? 900 : 800 } })
  const page = await ctx.newPage()
  const url = path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : '')
  let line
  try {
    await page.goto(B + url, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => null)
    await page.waitForTimeout(1200)
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)) } scrollTo(0, 0) })
    await page.waitForTimeout(700)
    line = await page.evaluate(measure)
  } catch (e) { line = 'ERR ' + String(e).replace(/\s+/g, ' ').slice(0, 160) }
  out('P ' + lang + ' ' + w + ' ' + path + ' | ' + line + ' | ' + Math.round((Date.now() - t0) / 1000) + 's')
  await ctx.close()
}
await b.close()
out('ALIGN_DONE')
