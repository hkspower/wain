#!/usr/bin/env node
/**
 * page-alignment-audit.mjs  --  READ-ONLY alignment crawl of the storefront.
 *
 * WHAT IT IS
 *   A measuring tool, not a test. It loads every public route (and the states that
 *   change layout) in Arabic (RTL, bare URL) and English (LTR, ?lang=en) at eight
 *   widths, and writes ONE JSON per page-state with raw geometry plus the flags the
 *   analysts need. Nothing is fixed, nothing is judged "wrong" here beyond the
 *   thresholds below; a deliberate design choice is the analyst's call, so the JSON
 *   keeps the numbers.
 *
 * READ-ONLY GUARANTEES (the same rules as the other live probes in this repo)
 *   - every non-GET/HEAD request is ABORTED in the browser and counted
 *     (`blockedNonGet` in each JSON; BASE may therefore be the live site);
 *   - `submit` events are cancelled in the capture phase and form.submit() /
 *     requestSubmit() are stubbed before any page script runs;
 *   - the only clicks are on fixed, named controls (bag, assistant, language toggle,
 *     size chip, card "choose size", slideshow pause, menu) -- never a submit button,
 *     never anything inside a <form> unless it is type="button"; the click helper
 *     refuses otherwise;
 *   - no sign-in, no order, no field is typed into. Service workers are blocked.
 *   - the bag/wishlist are seeded by writing localStorage BEFORE the app boots, in the
 *     exact shape the compiled bundle stores (`sporta_cart`, `sporta_wishlist`).
 *   - lookups that read an order by id (/track?trackid, /payment/result?trackid,
 *     /invoice/<id>, /review) are GET-only, but they are skipped on a non-mirror BASE
 *     unless LOOKUPS=1 so a probe of the live shop never asks it about a made-up order.
 *
 * USAGE
 *   node scripts/page-alignment-audit.mjs                 # starts the local mirror, all routes, ar+en, 8 widths
 *   BASE=https://www.sporta.com.kw node scripts/page-alignment-audit.mjs   # GET-only against a real server
 *   ROUTES=home,shop,product WIDTHS=390,1280 LANGS=ar OUT=/tmp/x node scripts/page-alignment-audit.mjs
 *   SELFTEST=1 node scripts/page-alignment-audit.mjs      # proves the tool on a broken + a clean fixture
 *
 *   Env:  BASE      origin to audit. Absent: the tool starts MIRROR (node serve.mjs) on a free port.
 *         MIRROR    path of the mirror server (default: the session scratchpad copy).
 *         LANGS     default "ar,en".            WIDTHS  default "320,360,390,430,768,1024,1280,1536".
 *         ROUTES    comma list of route ids (see ROUTE_TABLE) or raw paths ("/about"); default all.
 *         STATES    comma list of state ids; default every state a route lists.
 *         OUT       output dir (default: audits/crawl/data under the session scratchpad).
 *         CHROME    chromium executable (default: /opt/pw-browsers/... when present, else Playwright's own).
 *         SYNTHETIC "1"/"0": add states fed by fixtures the live API did not return (a configured top
 *                   bar, brand logos). Default on only when the tool started the mirror itself.
 *         RESUME    "1": skip page-states whose JSON already exists.
 *         LOOKUPS   "1": allow order-lookup routes on a non-mirror BASE.
 *         LIMIT     max page-states to run (debugging).
 *   Machine budget: ONE browser, at most TWO pages at a time (CONCURRENCY is capped at 2).
 *
 * WHAT IS MEASURED PER PAGE-STATE (thresholds in THRESHOLDS below, copied into every JSON)
 *   doc          scrollWidth vs clientWidth/innerWidth, overflow px, whether the page really pans
 *                sideways (scrollTo probe) or the overflow is masked by overflow-x:hidden.
 *   leaks        every element whose VISIBLE box (clipped by ancestors' overflow, as a browser
 *                paints it) leaves [0, viewport width]. `kind`: scrolls | unreachable (content
 *                beyond the inline-START edge can never be scrolled to) | cut-off-fixed. `root`
 *                marks the element that introduces the leak, not its descendants.
 *   scrollers    intentional overflow-x:auto|scroll strips (brand bar, size ladders) + start gap.
 *   clipped      overflow:hidden boxes whose content is wider than the box (ellipsis/line-clamp
 *                are marked as deliberate truncation, the rest is a silent cut).
 *   ref/edges    the header content edge (`header .navbar-main` minus padding) is the reference
 *                gutter. Every visible block gets startOff/endOff = inline-start/-end distance
 *                from that reference (positive = inside, negative = pokes out). `cls`:
 *                match | full-bleed | gutter-diff (same small inset both sides) | sticks-out |
 *                start-indented | one-sided | narrow-from-start | end-aligned | narrow-centred. Only `primary`
 *                blocks (children of a gutter-defining or full-bleed parent) count as mismatches.
 *   text         every text container: dominant script (Arabic vs Latin letters), computed
 *                direction / dir attribute / text-align, the MEASURED physical side the lines hug
 *                (left|right|centre|fill|mixed), gap from the inline-start edge, and flags
 *                (arabic-in-ltr, latin-sentence-in-rtl, align-opposes-direction, align-opposes-page,
 *                dir-attr-opposes-page).
 *   inputs       form fields: direction, text-align, placeholder script.
 *   iconPairs    icon+label pairs (vertical centre delta, stacked centre delta, side/gap) and
 *                icon-only buttons (icon centre vs box centre).
 *   controls     label centring inside buttons/links (dx, dy).
 *   rows         sibling rows: tops, heights, bottoms, centres, first-text baselines and the
 *                deltas that matter for the row's align-items; for card rows also the image box,
 *                title top/line count, last-text gap and button position of each card.
 *   fixed        every position:fixed|sticky element with its rect, plus overlaps between
 *                fixed elements, and (scrolled to the bottom) fixed elements covering content.
 *   physical     elements with asymmetric PHYSICAL offsets (margin/padding/border/inset/
 *                float/translateX/text-align) and which inline side the big value sits on.
 *                One language cannot tell logical from physical; `pairs/` does (ar vs en twin).
 *   header       logo centre vs viewport centre, header height share.
 *
 * AFTER THE CRAWL
 *   pairs/<route>__<state>__<width>.json   ar vs en twin: edges that do not mirror, physical
 *                                          offsets that stayed on the same physical side, text
 *                                          alignment that did not flip.
 *   summary.json / summary.txt             per page-state counters + the headline numbers.
 *   README.txt                             the field legend (written on every run).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const SCRATCH = '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad'
const env = process.env
const SELFTEST = env.SELFTEST === '1'
const LANGS = (env.LANGS || 'ar,en').split(',').map((s) => s.trim()).filter(Boolean)
const WIDTHS = (env.WIDTHS || '320,360,390,430,768,1024,1280,1536').split(',').map(Number).filter(Boolean)
const OUT = env.OUT || (SELFTEST ? `${SCRATCH}/audits/crawl/selftest` : `${SCRATCH}/audits/crawl/data`)
const MIRROR = env.MIRROR || `${SCRATCH}/mirror/serve.mjs`
const CONCURRENCY = Math.min(2, Math.max(1, Number(env.CONCURRENCY || 2))) // machine budget: two pages at most
const LIMIT = Number(env.LIMIT || 0)
const RESUME = env.RESUME === '1'

/** Thresholds. Copied into every JSON (`meta.thresholds`) so a number can be re-judged. */
export const THRESHOLDS = {
  leakEps: 0.5,        // px a visible box may exceed [0, viewport] before it is a leak (sub-pixel noise)
  edgeEps: 1,          // px a block edge may differ from the header content edge and still "match"
  symEps: 1.5,         // |startOff - endOff| below this = the block is centred between the gutters
  gutterDiffMax: 32,   // symmetric inset up to this = "gutter differs from header"; beyond = deliberate narrow centred column
  textEps: 1.5,        // px tolerance when deciding which side a line of text hugs
  slackMin: 8,         // px of free room needed before "the text hugs the wrong side" can be seen
  iconDy: 1.5,         // icon centre vs label centre (px)
  ctlDelta: 2,         // label centre vs button centre (px)
  rowEps: 1.5,         // sibling tops/heights/baselines (px)
  physMin: 1,          // left/right value difference counted as asymmetric (px)
  overlapMin: 4,       // px^2 of overlap between two fixed boxes / a fixed box and content
}
const CAPS = { leaks: 80, scrollers: 40, clipped: 60, edges: 700, text: 450, inputs: 60, iconPairs: 220, controls: 200, rows: 260, fixed: 40, physical: 300, overlaps: 40 }

const log = (...a) => console.error('[audit]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'x'
const VIEW_H = { 320: 640, 360: 740, 390: 844, 430: 932, 768: 1024, 1024: 768, 1280: 800, 1536: 864 }
const viewH = (w) => VIEW_H[w] || 800

/** A tiny solid-colour PNG (no dependency), used for synthetic brand logos. */
function solidPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/* ===================================================================================
 * IN-PAGE MEASUREMENT. Runs inside the page (serialised by Playwright), so it must be
 * self-contained: no reference to anything outside this function. Pure reads: it never
 * changes the DOM, styles or scroll position (the caller scrolls; this only reads).
 * `cfg.phase`:  'top'    -> the full measurement, page scrolled to the top
 *               'bottom' -> only what depends on the page being scrolled to its end
 * =================================================================================== */
function inPageMeasure(cfg) {
  const T = cfg.T, CAP = cfg.caps
  const doc = document.documentElement, body = document.body
  const VW = doc.clientWidth, VH = window.innerHeight
  const RTL = getComputedStyle(doc).direction === 'rtl'
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
  const rnd = (n) => Math.round(n * 10) / 10
  const dropped = {}
  const capList = (name, arr, n) => { if (arr.length > n) { dropped[name] = arr.length - n; return arr.slice(0, n) } return arr }

  // ---------- caches ----------
  const CSC = new Map(), RC = new Map(), INFO = new Map(), CL = new Map(), FXR = new Map()
  const cs = (el) => { let c = CSC.get(el); if (!c) { c = getComputedStyle(el); CSC.set(el, c) } return c }
  const rect = (el) => { let r = RC.get(el); if (!r) { r = el.getBoundingClientRect(); RC.set(el, r) } return r }
  const isSvgInner = (el) => el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg'

  // ---------- element identity ----------
  // Structural path (tag:nth-child chain). Stored once per page in `paths`; rows refer to it by
  // index (`el`). It is also the key the ar<->en pairing step matches on.
  const PT = [], PI = new Map(), SP = new Map()
  const spath = (el) => {
    let s = SP.get(el)
    if (s) return s
    if (el === doc) s = 'html'
    else if (el === body) s = 'body'
    else s = spath(el.parentElement) + '>' + el.tagName.toLowerCase() + ':' + (Array.prototype.indexOf.call(el.parentElement.children, el) + 1)
    SP.set(el, s)
    return s
  }
  const eid = (el) => { let i = PI.get(el); if (i === undefined) { i = PT.length; PT.push(spath(el)); PI.set(el, i) } return i }
  // Readable selector: the element plus up to two semantic ancestors (utility classes are noise; the exact path is in `paths`).
  const UTIL = /^(?:-?[mp][trblxyse]?-|text-|bg-|border|rounded|flex|grid|gap-|items-|justify-|self-|w-|h-|min-|max-|size-|font-|leading-|tracking-|space-|absolute|relative|fixed|sticky|static|block|inline|hidden|overflow|truncate|shrink|grow|basis|col-|row-|order-|z-|top-|bottom-|left-|right-|start-|end-|inset|opacity|shadow|ring|outline|transition|duration|ease|delay|hover:|focus|active:|disabled:|dark:|sm:|md:|lg:|xl:|2xl:|group|peer|aspect|object-|place-|content-|underline|no-underline|uppercase|lowercase|capitalize|line-clamp|sr-only|cursor|select-|pointer-events|whitespace|break-|list-|table|divide|backdrop|blur|animate|origin|translate|rotate|scale|stroke|fill|will-change|float|clear|visible|invisible|isolate|appearance|accent-|caret-|decoration-|italic|tabular|\[|-)/
  const SEMTAG = new Set(['header', 'nav', 'main', 'footer', 'section', 'aside', 'article', 'form', 'ul', 'ol', 'li', 'table', 'dialog'])
  const seg = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id.slice(0, 24)
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && !UTIL.test(c))
    if (cls.length) s += '.' + cls.slice(0, 2).join('.')
    return s.slice(0, 44)
  }
  const sel = (el) => {
    const parts = [seg(el)]
    let e = el.parentElement, hops = 0
    while (e && e !== body && e !== doc && parts.length < 3 && hops < 8) {
      const t = e.tagName.toLowerCase()
      if (e.id || SEMTAG.has(t) || (e.getAttribute('class') || '').split(/\s+/).some((c) => c && !UTIL.test(c))) parts.unshift(seg(e))
      e = e.parentElement; hops++
    }
    return parts.join(' > ')
  }
  const txtOf = (el, n) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n)

  // ---------- fixed roots / off-canvas ----------
  const fixedRoot = (el) => {
    if (FXR.has(el)) return FXR.get(el)
    let v = null
    if (cs(el).position === 'fixed') v = el
    else if (el.parentElement && el.parentElement !== doc) v = fixedRoot(el.parentElement)
    FXR.set(el, v)
    return v
  }
  // A fixed box that is wholly outside the viewport, fully transparent or hidden is "off canvas":
  // a closed drawer / idle backdrop. Its subtree is not on screen and is ignored by every list.
  const fxOffMemo = new Map()
  const fxOff = (fx) => {
    if (fxOffMemo.has(fx)) return fxOffMemo.get(fx)
    const r = rect(fx), c = cs(fx)
    const v = r.right <= 0.5 || r.left >= VW - 0.5 || r.bottom <= 0.5 || r.top >= VH - 0.5 || c.visibility === 'hidden' || c.display === 'none' || px(c.opacity) < 0.01
    fxOffMemo.set(fx, v)
    return v
  }

  // ---------- visible region (clipped by ancestors' overflow, as the browser paints it) ----------
  const clipParent = (el) => {
    const c = cs(el)
    if (c.position === 'fixed') return null
    let p = el.parentElement
    if (c.position === 'absolute') {
      // an absolute box is only clipped by ancestors on its containing-block chain
      while (p && p !== body) {
        const pc = cs(p)
        if (pc.position !== 'static' || pc.transform !== 'none' || pc.filter !== 'none' || /paint|layout|strict|content/.test(pc.contain)) break
        p = p.parentElement
      }
    }
    return p && p !== body && p !== doc ? p : null
  }
  const clipInfo = (el) => {
    let i = CL.get(el)
    if (i) return i
    const r = rect(el)
    let L = r.left, Tp = r.top, R = r.right, B = r.bottom
    const by = []
    let p = clipParent(el)
    while (p) {
      const pc = cs(p)
      if (pc.overflowX !== 'visible' || pc.overflowY !== 'visible') {
        const pr = rect(p)
        if (pr.width > 0 || pr.height > 0) {
          if (pc.overflowX !== 'visible') { L = Math.max(L, pr.left + px(pc.borderLeftWidth)); R = Math.min(R, pr.right - px(pc.borderRightWidth)) }
          if (pc.overflowY !== 'visible') { Tp = Math.max(Tp, pr.top + px(pc.borderTopWidth)); B = Math.min(B, pr.bottom - px(pc.borderBottomWidth)) }
          by.push(p)
        }
      }
      p = clipParent(p)
    }
    i = { L, T: Tp, R, B, by, empty: R - L <= 0 || B - Tp <= 0 }
    CL.set(el, i)
    return i
  }
  const info = (el) => {
    let i = INFO.get(el)
    if (i) return i
    const c = cs(el), r = rect(el)
    const box = c.display !== 'none' && c.display !== 'contents'
    const fx = fixedRoot(el)
    const clip = box ? clipInfo(el) : null
    const off = fx ? fxOff(fx) : false
    const visible = box && c.visibility === 'visible' && px(c.opacity) > 0.01
    i = { el, c, r, box, fx, clip, off, visible, sizeOk: r.width >= 1 && r.height >= 1,
      seen: visible && r.width >= 1 && r.height >= 1 && !!clip && !clip.empty && !off && !(r.width <= 2 && r.height <= 2) }
    INFO.set(el, i)
    return i
  }

  // ---------- element universe ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'HEAD'])
  const ALL = []
  for (const el of body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName) || isSvgInner(el)) continue
    ALL.push(el)
  }

  // ---------- reference gutter: the header content edge ----------
  const hdrNav = document.querySelector('header .navbar-main') || document.querySelector('header nav') || document.querySelector('header')
  let ref
  if (hdrNav) {
    const r = rect(hdrNav), c = cs(hdrNav)
    ref = { L: r.left + px(c.borderLeftWidth) + px(c.paddingLeft), R: r.right - px(c.borderRightWidth) - px(c.paddingRight), source: sel(hdrNav) }
  } else ref = { L: 0, R: VW, source: 'viewport (no header found)' }
  const fullBleedOf = (r) => r.left <= 0.5 && r.right >= VW - 0.5

  // ---------- script analysis ----------
  const scriptOf = (text) => {
    const ar = (text.match(/\p{Script=Arabic}/gu) || []).filter((ch) => /\p{L}/u.test(ch)).length
    const lat = (text.match(/\p{Script=Latin}/gu) || []).length
    const digits = (text.match(/\p{Nd}/gu) || []).length
    const letters = ar + lat
    let dominant = 'none'
    if (letters === 0) dominant = digits > 0 ? 'num' : 'none'
    else if (ar / letters >= 0.7) dominant = 'ar'
    else if (lat / letters >= 0.7) dominant = 'lat'
    else dominant = 'mixed'
    const latWords = (text.match(/\p{Script=Latin}+/gu) || []).length
    return { dominant, ar, lat, digits, latWords }
  }

  // ---------- text-line geometry ----------
  const rangeRects = (node) => {
    const rg = document.createRange()
    rg.selectNodeContents(node)
    return Array.from(rg.getClientRects()).filter((q) => q.width > 0.5 && q.height > 0.5)
  }
  // Cluster rects into lines (same line = tops within 4 px).
  const toLines = (rects) => {
    const s = rects.slice().sort((a, b) => a.top - b.top || a.left - b.left)
    const lines = []
    for (const q of s) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(q.top - last.t) <= 4) { last.l = Math.min(last.l, q.left); last.r = Math.max(last.r, q.right); last.b = Math.max(last.b, q.bottom) }
      else lines.push({ l: q.left, r: q.right, t: q.top, b: q.bottom })
    }
    return lines
  }
  const textNodesOf = (root, skipSel) => {
    const out = []
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT })
    while (w.nextNode()) {
      const n = w.currentNode, pe = n.parentElement
      if (!pe || SKIP.has(pe.tagName) || pe.closest('svg')) continue
      if (skipSel && pe.closest(skipSel)) continue
      out.push(n)
    }
    return out
  }
  const textContainerOf = (el) => {
    let e = el
    while (e && e !== body) { const d = cs(e).display; if (d === 'inline' || d === 'contents' || d.startsWith('ruby')) e = e.parentElement; else return e }
    return body
  }
  const contentBox = (el) => {
    const r = rect(el), c = cs(el)
    return { L: r.left + px(c.borderLeftWidth) + px(c.paddingLeft), R: r.right - px(c.borderRightWidth) - px(c.paddingRight), T: r.top + px(c.borderTopWidth) + px(c.paddingTop), B: r.bottom - px(c.borderBottomWidth) - px(c.paddingBottom) }
  }
  // Baseline of the first text line: top of its client rect + the font's ascent (canvas metrics).
  const cv = document.createElement('canvas').getContext('2d')
  const ascCache = new Map()
  const ascentOf = (c) => {
    const f = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`
    if (!ascCache.has(f)) { cv.font = f; ascCache.set(f, cv.measureText('x').fontBoundingBoxAscent) }
    return ascCache.get(f)
  }
  const firstLine = (root, skipSel) => {
    const nodes = textNodesOf(root, skipSel)
    for (const n of nodes) {
      const rs = rangeRects(n)
      if (!rs.length) continue
      const q = rs.slice().sort((a, b) => a.top - b.top)[0]
      const a = ascentOf(cs(n.parentElement))
      return { l: q.left, r: q.right, t: q.top, b: q.bottom, mid: (q.top + q.bottom) / 2, base: Number.isFinite(a) ? q.top + a : null }
    }
    return null
  }

  const out = { phase: cfg.phase }

  // =============================== BOTTOM PHASE ===============================
  if (cfg.phase === 'bottom') {
    const scrollY = window.scrollY, maxY = doc.scrollHeight - VH
    out.scrollY = rnd(scrollY); out.maxScrollY = rnd(maxY)
    // fixed boxes on screen (skip scrims: boxes that cover nearly the whole viewport)
    const fx = []
    for (const el of ALL) {
      const i = info(el)
      if (!i.box || i.c.position !== 'fixed' || !i.seen) continue
      const r = i.r
      if (r.width >= VW - 1 && r.height >= VH - 1) continue
      fx.push(el)
    }
    // An open drawer / dialog / assistant panel floats over the page by design: no content-overlap analysis while one is open.
    const modal = ALL.some((el) => { const i = info(el); return i.box && i.c.position === 'fixed' && i.seen && (i.r.width * i.r.height >= 0.5 * VW * VH || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || /drawer|modal|sheet/.test(el.getAttribute('class') || '')) })
    out.modalOpen = modal
    const rows = []
    if (!modal && fx.length) {
      const cands = []
      for (const el of ALL) {
        const i = info(el)
        if (!i.seen || i.fx) continue
        const t = el.tagName
        const interactive = t === 'A' || t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA'
        if (interactive) { cands.push(el); continue }
        if (i.c.display !== 'inline' && Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.data))) cands.push(el)
      }
      for (const f of fx) {
        const fr = rect(f)
        for (const el of cands) {
          if (f.contains(el) || el.contains(f)) continue
          const i = info(el), r = i.r
          const w = Math.min(fr.right, i.clip.R, r.right) - Math.max(fr.left, i.clip.L, r.left)
          const h = Math.min(fr.bottom, i.clip.B, r.bottom) - Math.max(fr.top, i.clip.T, r.top)
          if (w > 0 && h > 0 && w * h >= T.overlapMin) rows.push({ fixed: sel(f), fixedEl: eid(f), content: sel(el), contentEl: eid(el), text: txtOf(el, 40), area: rnd(w * h), overlap: { w: rnd(w), h: rnd(h) }, fixedRect: { l: rnd(fr.left), t: rnd(fr.top), w: rnd(fr.width), h: rnd(fr.height) }, contentRect: { l: rnd(r.left), t: rnd(r.top), w: rnd(r.width), h: rnd(r.height) } })
        }
      }
    }
    out.fixedOverContent = capList('fixedOverContent', rows.sort((a, b) => b.area - a.area), CAP.overlaps)
    // sticky/fixed header rect when scrolled (does it hide on scroll, does it cover anything it should not)
    const hd = document.querySelector('header')
    if (hd) { const r = rect(hd); out.headerAtBottom = { t: rnd(r.top), b: rnd(r.bottom), h: rnd(r.height), class: (hd.getAttribute('class') || '').split(/\s+/).filter((c) => /hidden|stuck|scrolled/.test(c)).join(' ') } }
    // blank space under the footer
    const ft = document.querySelector('footer')
    if (ft) { const r = ft.getBoundingClientRect(); out.footerBottomGap = rnd(doc.scrollHeight - (r.bottom + scrollY)) }
    out.paths = PT
    out.dropped = dropped
    return out
  }

  // =============================== TOP PHASE ===============================
  // ---- document ----
  const hs = cs(doc), bs = cs(body)
  const sw = doc.scrollWidth
  out.doc = {
    dir: hs.direction, htmlLang: doc.getAttribute('lang'), htmlDirAttr: doc.getAttribute('dir'),
    innerWidth: window.innerWidth, clientWidth: VW, innerHeight: VH,
    scrollWidth: sw, bodyScrollWidth: body.scrollWidth, overflowPx: rnd(sw - VW),
    hScroll: sw - VW >= 1, htmlOverflowX: hs.overflowX, bodyOverflowX: bs.overflowX,
    docHeight: doc.scrollHeight, elements: ALL.length,
  }
  // Does the page really pan sideways? (probe; restored right after)
  const sx0 = window.scrollX
  window.scrollTo(RTL ? -200 : 200, 0)
  out.doc.canScrollX = Math.abs(window.scrollX) > 0.5
  out.doc.scrollXProbe = rnd(window.scrollX)
  window.scrollTo(sx0, 0)
  out.doc.maskedOverflow = out.doc.hScroll && !out.doc.canScrollX
  out.ref = { source: ref.source, L: rnd(ref.L), R: rnd(ref.R), gutterLeft: rnd(ref.L), gutterRight: rnd(VW - ref.R), width: rnd(ref.R - ref.L) }

  // ---- leaks (boxes whose visible region leaves the viewport) ----
  const leakSet = new Map()
  for (const el of ALL) {
    const i = info(el)
    if (!i.box || !i.sizeOk || i.off || !i.clip || i.clip.empty) continue
    const overR = i.clip.R - VW, overL = -i.clip.L
    if (overR > T.leakEps || overL > T.leakEps) leakSet.set(el, { overR: Math.max(0, overR), overL: Math.max(0, overL) })
  }
  const leakRows = []
  let leakDesc = 0
  for (const [el, v] of leakSet) {
    const i = info(el)
    const par = el.parentElement
    const pv = par ? leakSet.get(par) : null
    const root = !(pv && ((v.overR > 0 && pv.overR > 0) || (v.overL > 0 && pv.overL > 0)))
    if (!root) { leakDesc++; continue }
    const side = v.overR > 0 && v.overL > 0 ? 'both' : v.overR > 0 ? 'right' : 'left'
    let kind
    if (i.fx) kind = 'cut-off-fixed'
    else if (side === 'both') kind = 'scrolls+unreachable'
    else if ((side === 'right') !== RTL) kind = 'scrolls'   // LTR right / RTL left = inline-end: reachable by scrolling
    else kind = 'unreachable'                                // beyond inline-start: no scroll position reaches it
    const r = i.r
    leakRows.push({ el: eid(el), sel: sel(el), tag: el.tagName.toLowerCase(), text: el.childElementCount === 0 ? txtOf(el, 40) : '', side, overRight: rnd(v.overR), overLeft: rnd(v.overL), kind, fixed: !!i.fx, invisibleBox: !i.visible, rect: { l: rnd(r.left), r: rnd(r.right), t: rnd(r.top), w: rnd(r.width), h: rnd(r.height) }, clippedBy: i.clip.by.slice(0, 2).map(sel) })
  }
  leakRows.sort((a, b) => Math.max(b.overRight, b.overLeft) - Math.max(a.overRight, a.overLeft))
  out.leaks = { count: leakSet.size, roots: leakRows.length, descendants: leakDesc, maxOverRight: leakRows.length ? Math.max(...leakRows.map((x) => x.overRight)) : 0, maxOverLeft: leakRows.length ? Math.max(...leakRows.map((x) => x.overLeft)) : 0, rows: capList('leaks', leakRows, CAP.leaks) }

  // ---- scrollers and clipped containers ----
  const scrollers = [], clipped = []
  for (const el of ALL) {
    const i = info(el)
    if (!i.box || !i.seen) continue
    const c = i.c
    if ((c.overflowX === 'auto' || c.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      const kids = Array.from(el.children).filter((k) => info(k).box)
      const cb = contentBox(el)
      const k0 = kids[0] ? rect(kids[0]) : null
      scrollers.push({ el: eid(el), sel: sel(el), overflowX: c.overflowX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: rnd(el.scrollLeft), scrollbarHidden: c.scrollbarWidth === 'none', snap: c.scrollSnapType !== 'none', children: kids.length, startGap: k0 ? rnd(RTL ? cb.R - k0.right : k0.left - cb.L) : null })
    } else if (c.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && (c.textOverflow === 'ellipsis' || Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.data)) || el.childElementCount > 0)) {
      if (el === doc || el === body) continue
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.data))
      const slider = !ownText && el.scrollWidth >= 1.8 * el.clientWidth   // a carousel/marquee viewport: content is meant to be wider
      clipped.push({ el: eid(el), sel: sel(el), kind: 'x', overflowX: c.overflowX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, over: el.scrollWidth - el.clientWidth, ellipsis: c.textOverflow === 'ellipsis', slider, deliberate: c.textOverflow === 'ellipsis' || slider, text: txtOf(el, 40), hasText: !!txtOf(el, 2) })
    }
    const lc = c.webkitLineClamp
    if (lc && lc !== 'none' && el.scrollHeight > el.clientHeight + 1) clipped.push({ el: eid(el), sel: sel(el), kind: 'line-clamp', lines: lc, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, over: el.scrollHeight - el.clientHeight, deliberate: true, text: txtOf(el, 40), hasText: true })
  }
  out.scrollers = { count: scrollers.length, rows: capList('scrollers', scrollers, CAP.scrollers) }
  out.clipped = { count: clipped.length, silent: clipped.filter((x) => !x.deliberate && x.hasText).length, rows: capList('clipped', clipped, CAP.clipped) }

  // ---- edges: every visible block relative to the header content edge ----
  const LANDMARK = new Set(['header', 'nav', 'main', 'footer', 'aside', 'section', 'article', 'form', 'dialog'])
  const roleOf = (el, c) => {
    const t = el.tagName.toLowerCase()
    if (/^h[1-6]$/.test(t)) return 'heading'
    if (LANDMARK.has(t) || el.getAttribute('role') === 'dialog') return 'landmark'
    if (t === 'img' || t === 'picture' || t === 'video' || t === 'canvas' || t === 'iframe' || t === 'svg') return 'media'
    if (t === 'ul' || t === 'ol' || t === 'dl' || t === 'table') return 'list'
    if (t === 'button' || t === 'input' || t === 'select' || t === 'textarea' || (t === 'a' && c.display !== 'inline')) return 'control'
    if (t === 'p' || t === 'li' || t === 'label' || t === 'blockquote' || t === 'figcaption') return 'text'
    if (c.display === 'grid' || c.display === 'inline-grid' || ((c.display === 'flex' || c.display === 'inline-flex') && el.childElementCount >= 2)) return 'grid'
    if (c.maxWidth !== 'none' || /\b(container|mx-auto)\b/.test(el.getAttribute('class') || '')) return 'container'
    return 'block'
  }
  const RSMEMO = new Map()
  const hasRowSibling = (el, par, r) => {
    if (par.childElementCount < 2) return false
    let kids = RSMEMO.get(par)
    if (!kids) { kids = Array.from(par.children).filter((k) => { if (SKIP.has(k.tagName) || isSvgInner(k)) return false; const ki = info(k); return ki.seen && ki.c.position !== 'absolute' && ki.c.position !== 'fixed' }); RSMEMO.set(par, kids) }
    return kids.some((k) => { if (k === el) return false; const q = rect(k); const o = Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top); return o > 0.5 * Math.min(q.height, r.height) })
  }
  const painted = (c) => (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent') || c.backgroundImage !== 'none' || c.boxShadow !== 'none' || px(c.borderLeftWidth) > 0 || px(c.borderRightWidth) > 0
  const classify = (so, eo, bleed, role, c, r) => {
    if (bleed) return 'full-bleed'
    const sm = Math.abs(so) <= T.edgeEps, em = Math.abs(eo) <= T.edgeEps
    if (sm && em) return 'match'
    if (so < -T.edgeEps || eo < -T.edgeEps) return 'sticks-out'
    if (sm) return 'narrow-from-start'
    if (em) return role === 'landmark' || role === 'container' || role === 'grid' || role === 'block' || role === 'list' ? 'start-indented' : 'end-aligned'
    if (Math.abs(so - eo) <= T.symEps) {
      // Equal inset on both sides. A STRUCTURAL box (section, container, grid, list) with a small inset is a gutter that
      // differs from the header's; a heading/paragraph/control/image, or a box held to its own max-width, is a deliberately
      // narrower centred column.
      const structural = role === 'landmark' || role === 'container' || role === 'grid' || role === 'block' || role === 'list'
      const constrained = c.maxWidth !== 'none' && Math.abs(r.width - px(c.maxWidth)) <= 1
      return structural && !constrained && Math.abs(so) <= T.gutterDiffMax ? 'gutter-diff' : 'narrow-centred'
    }
    return 'one-sided'
  }
  const MISMATCH = new Set(['sticks-out', 'start-indented', 'gutter-diff', 'one-sided'])
  const edgeRows = [], edgeSeen = new Set()
  for (const el of ALL) {
    const i = info(el)
    if (!i.seen || i.c.display === 'inline') continue
    const r = i.r
    if (r.width < 24 || r.height < 8) continue
    const role = roleOf(el, i.c)
    const par = el.parentElement
    if (!par) continue
    const pr = rect(par), pc = cs(par)
    // pass-through wrapper (same box as an already-recorded parent): skip the duplicate
    if (edgeSeen.has(par) && Math.abs(pr.left - r.left) < 0.5 && Math.abs(pr.right - r.right) < 0.5 && Math.abs(pr.top - r.top) < 0.5 && Math.abs(pr.bottom - r.bottom) < 0.5) { edgeSeen.add(el); continue }
    const pcL = pr.left + px(pc.borderLeftWidth) + px(pc.paddingLeft), pcR = pr.right - px(pc.borderRightWidth) - px(pc.paddingRight)
    const parentContentMatches = Math.abs(pcL - ref.L) <= T.edgeEps && Math.abs(pcR - ref.R) <= T.edgeEps
    const parentPadded = (pcL - pr.left) + (pr.right - pcR) > 0.5
    // A full-bleed parent hands the gutter to its children when it adds no inline padding of its own, or when it is a
    // painted band (its padding then IS the gutter its children sit in). An UNPAINTED padded parent whose content box is
    // not the header gutter is itself the mismatch, and its children are not recounted.
    const parentPainted = painted(pc), parentBleed = fullBleedOf(pr)
    // Children of a painted box that does not span the viewport (a card, a bordered panel) sit INSIDE it: their insets are the
    // card's padding, not a gutter. A painted full-bleed band is different: its padding is the page gutter.
    const parentOK = par === body || par.tagName === 'MAIN' || (parentPainted ? parentBleed : (parentContentMatches || (parentBleed && !parentPadded)))
    // Items that share a visual row with a sibling (flex/grid cells, inline chips) are positioned by
    // their row, not by the page gutter: they are never "primary" (the `rows` list measures them).
    const primary = !i.fx && i.c.position !== 'absolute' && parentOK && !hasRowSibling(el, par, r)
    if (role === 'block' && !primary) continue
    const pl = px(i.c.paddingLeft), prr = px(i.c.paddingRight), bl = px(i.c.borderLeftWidth), br = px(i.c.borderRightWidth)
    // Unpainted padded containers are judged on their content box (the padding is the gutter); a painted box (card, band,
    // bordered panel) is what the eye sees, so its border box is compared.
    const useContent = !painted(i.c) && (pl + prr + bl + br > 0) && el.childElementCount > 0 && (role === 'landmark' || role === 'container' || role === 'grid' || role === 'block' || role === 'list')
    const L = r.left + (useContent ? bl + pl : 0), R = r.right - (useContent ? br + prr : 0)
    const so = RTL ? ref.R - R : L - ref.L
    const eo = RTL ? L - ref.L : ref.R - R
    const bleed = fullBleedOf(r) && !useContent
    const cls = i.fx ? 'fixed' : classify(so, eo, bleed, role, i.c, r)
    edgeSeen.add(el)
    edgeRows.push({ el: eid(el), sel: sel(el), role, tag: el.tagName.toLowerCase(), l: rnd(r.left), r: rnd(r.right), t: rnd(r.top), w: rnd(r.width), h: rnd(r.height), startOff: rnd(so), endOff: rnd(eo), usedContentBox: useContent, primary, fullBleed: bleed, fixed: !!i.fx, cls, mismatch: primary && MISMATCH.has(cls) })
  }
  const primRows = edgeRows.filter((x) => x.primary)
  const counts = {}
  for (const x of primRows) counts[x.cls] = (counts[x.cls] || 0) + 1
  const modeMap = new Map()
  for (const x of primRows.filter((y) => y.cls !== 'full-bleed' && y.role !== 'media')) { const k = `${x.startOff}|${x.endOff}`; modeMap.set(k, (modeMap.get(k) || 0) + 1) }
  const modeTop = Array.from(modeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ startOff: Number(k.split('|')[0]), endOff: Number(k.split('|')[1]), blocks: n }))
  out.gutters = { refSource: ref.source, refStart: rnd(RTL ? ref.R : ref.L), refEnd: rnd(RTL ? ref.L : ref.R), blocks: edgeRows.length, primary: primRows.length, byClass: counts, mismatches: primRows.filter((x) => x.mismatch).length, commonOffsets: modeTop }
  out.edges = capList('edges', edgeRows, CAP.edges)

  // ---- text containers ----
  const TB = new Map()
  for (const n of textNodesOf(body)) {
    const cont = textContainerOf(n.parentElement)
    const i = info(cont)
    if (!i.seen) continue
    let b = TB.get(cont)
    if (!b) { b = { nodes: [], text: '' }; TB.set(cont, b) }
    b.nodes.push(n); b.text += n.data
  }
  const physOf = (ta, dir) => ta === 'start' || ta === 'match-parent' ? (dir === 'rtl' ? 'right' : 'left') : ta === 'end' ? (dir === 'rtl' ? 'left' : 'right') : ta
  const effDirAttr = (el) => { const d = el.closest('[dir]'); return d && d !== doc ? d.getAttribute('dir') : null }
  const textRows = []
  const tcounts = { containers: 0, flagged: 0, wrongDirection: 0 }
  const flagCounts = {}
  const pageStartSide = RTL ? 'right' : 'left'
  for (const [cont, b] of TB) {
    const i = info(cont), c = i.c
    const rects = b.nodes.flatMap(rangeRects)
    if (!rects.length) continue
    const lines = toLines(rects)
    const cb = contentBox(cont)
    const minL = Math.min(...lines.map((x) => x.l)), maxR = Math.max(...lines.map((x) => x.r))
    const text = b.text.replace(/\s+/g, ' ').trim()
    const sc = scriptOf(text)
    const eps = T.textEps
    const allLeft = lines.every((x) => Math.abs(x.l - cb.L) <= eps)
    const allRight = lines.every((x) => Math.abs(cb.R - x.r) <= eps)
    const allCentre = lines.every((x) => Math.abs((x.l + x.r) / 2 - (cb.L + cb.R) / 2) <= eps)
    // A box that shares its row with an icon / control / other flex items (inline-flex chips, buttons with icons)
    // is positioned by that layout, not by text-align: the alignment cannot be read off the whole content box.
    const shared = !!cont.querySelector('svg, img, picture, video, canvas, input, select, textarea, button') || (/flex|grid/.test(c.display) && cont.childElementCount > 0) || /^inline-(block|flex|grid)$/.test(c.display)
    const align = shared ? 'shared' : allLeft && allRight ? 'fill' : allLeft ? 'left' : allRight ? 'right' : allCentre ? 'centre' : 'mixed'
    const slack = (cb.R - cb.L) - (maxR - minL)
    const dirC = c.direction, dirAttr = effDirAttr(cont)
    const flags = []
    const hugs = align === 'left' || align === 'right'
    if (sc.dominant === 'ar' && dirC === 'ltr' && align !== 'centre') flags.push('arabic-in-ltr')
    if (sc.dominant === 'lat' && sc.latWords >= 3 && dirC === 'rtl' && align !== 'centre') flags.push('latin-sentence-in-rtl')
    // text-align:end is the LOGICAL way to put a price/number column at the end of the line in either direction: it is not
    // flagged (the row still records textAlign:'end'). Only a physical left/right, or a start/centre that lands on the
    // wrong side, is.
    if (hugs && slack >= T.slackMin && sc.dominant !== 'num' && sc.dominant !== 'none' && c.textAlign !== 'end') {
      if (align === (dirC === 'rtl' ? 'left' : 'right')) flags.push('align-opposes-direction')
      if (align !== pageStartSide) flags.push('align-opposes-page')
    }
    if (dirAttr && dirAttr !== (RTL ? 'rtl' : 'ltr') && dirAttr !== 'auto') flags.push('dir-attr-opposes-page')
    const wrong = flags.some((f) => f === 'arabic-in-ltr' || f === 'latin-sentence-in-rtl' || f === 'align-opposes-direction')
    tcounts.containers++
    if (flags.length) { tcounts.flagged++; for (const f of flags) flagCounts[f] = (flagCounts[f] || 0) + 1 }
    if (wrong) tcounts.wrongDirection++
    textRows.push({
      el: eid(cont), sel: sel(cont), tag: cont.tagName.toLowerCase(), text: text.slice(0, sc.dominant === 'mixed' ? 100 : 60), chars: text.length,
      script: sc.dominant, arLetters: sc.ar, latLetters: sc.lat, latWords: sc.latWords,
      dir: dirC, dirAttr, textAlign: c.textAlign, align, alignPhysicalComputed: physOf(c.textAlign, dirC), lines: lines.length,
      gapStart: rnd(RTL ? cb.R - maxR : minL - cb.L), gapEnd: rnd(RTL ? minL - cb.L : cb.R - maxR), slack: rnd(slack),
      startFromRef: rnd(RTL ? ref.R - maxR : minL - ref.L),
      rect: { l: rnd(minL), r: rnd(maxR), t: rnd(Math.min(...lines.map((x) => x.t))), h: rnd(Math.max(...lines.map((x) => x.b)) - Math.min(...lines.map((x) => x.t))) },
      font: `${(c.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim()} | ${px(c.fontSize)}px/${c.lineHeight} | ${c.fontWeight}`,
      flags, wrongDirection: wrong, fixed: !!i.fx,
    })
  }
  // keep every flagged row, then fill with the rest in document order
  const flaggedT = textRows.filter((x) => x.flags.length), plainT = textRows.filter((x) => !x.flags.length)
  const keepT = flaggedT.concat(plainT.slice(0, Math.max(0, CAP.text - flaggedT.length)))
  if (textRows.length > keepT.length) dropped.text = textRows.length - keepT.length
  out.text = { ...tcounts, flagCounts, scripts: textRows.reduce((m, x) => { m[x.script] = (m[x.script] || 0) + 1; return m }, {}), aligns: textRows.reduce((m, x) => { m[x.align] = (m[x.align] || 0) + 1; return m }, {}), rows: keepT }

  // ---- inputs ----
  const inputRows = []
  for (const el of ALL) {
    const t = el.tagName
    if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') continue
    const i = info(el)
    if (!i.seen || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') continue
    const c = i.c, ph = el.getAttribute('placeholder') || ''
    const sc = scriptOf(ph || (t === 'SELECT' ? (el.selectedOptions[0]?.textContent || '') : ''))
    const phys = physOf(c.textAlign, c.direction)
    const flags = []
    if (ph && sc.dominant === 'ar' && c.direction === 'ltr') flags.push('arabic-placeholder-in-ltr')
    if (ph && sc.dominant === 'lat' && sc.latWords >= 2 && c.direction === 'rtl') flags.push('latin-placeholder-in-rtl')
    if ((phys === 'left' || phys === 'right') && phys !== pageStartSide && sc.dominant !== 'num' && sc.dominant !== 'none') flags.push('align-opposes-page')
    const r = i.r
    inputRows.push({ el: eid(el), sel: sel(el), tag: t.toLowerCase(), type: el.type || null, placeholder: ph.slice(0, 40), script: sc.dominant, dir: c.direction, dirAttr: effDirAttr(el), textAlign: c.textAlign, alignPhysical: phys, rect: { l: rnd(r.left), r: rnd(r.right), t: rnd(r.top), w: rnd(r.width), h: rnd(r.height) }, startOff: rnd(RTL ? ref.R - r.right : r.left - ref.L), endOff: rnd(RTL ? r.left - ref.L : ref.R - r.right), flags })
  }
  out.inputs = { count: inputRows.length, flagged: inputRows.filter((x) => x.flags.length).length, rows: capList('inputs', inputRows, CAP.inputs) }

  // ---- icon + label pairs, icon-only buttons ----
  const iconRows = []
  const isIcon = (el) => {
    const t = el.tagName.toLowerCase()
    if (t !== 'svg' && t !== 'img') return false
    const i = info(el)
    return i.seen && i.r.width >= 8 && i.r.width <= 64 && i.r.height >= 8 && i.r.height <= 64
  }
  for (const icon of ALL) {
    if (!isIcon(icon)) continue
    const ir = rect(icon), icx = (ir.left + ir.right) / 2, icy = (ir.top + ir.bottom) / 2
    // label text = text nodes of the group that are in flow (a count badge pinned with position:absolute is not a label)
    const inFlowText = (g) => textNodesOf(g, 'svg').filter((n) => { let e = n.parentElement; while (e && e !== g) { if (cs(e).position === 'absolute' || cs(e).position === 'fixed') return false; e = e.parentElement } return true })
    let g = icon.parentElement, depth = 0, group = null
    while (g && g !== body && depth < 3) {
      if (inFlowText(g).length) { group = g; break }
      g = g.parentElement; depth++
    }
    const iconsIn = group ? Array.from(group.querySelectorAll('svg, img')).filter(isIcon).length : 0
    const accept = group && iconsIn === 1 && txtOf(group, 200).length <= 60 && rect(group).height <= Math.max(96, ir.height * 3)
    if (accept) {
      const lns = toLines(inFlowText(group).flatMap(rangeRects))
      if (!lns.length) continue
      const fl = { l: Math.min(...lns.map((x) => x.l)), r: Math.max(...lns.map((x) => x.r)), t: lns[0].t, b: lns[0].b }
      const blockMid = (Math.min(...lns.map((x) => x.t)) + Math.max(...lns.map((x) => x.b))) / 2
      const lcx = (fl.l + fl.r) / 2
      const stacked = ir.bottom <= fl.t + 2 || ir.top >= Math.max(...lns.map((x) => x.b)) - 2
      const iconIsLeft = icx < lcx
      const before = RTL ? !iconIsLeft : iconIsLeft
      const gap = stacked ? null : iconIsLeft ? fl.l - ir.right : ir.left - fl.r
      // Single-line label: icon centre vs the line centre. Multi-line: it may sit on the first line OR centre on the whole block.
      const dyFirst = icy - (fl.t + fl.b) / 2, dyBlock = icy - blockMid
      const dy = lns.length === 1 || Math.abs(dyFirst) <= Math.abs(dyBlock) ? dyFirst : dyBlock
      const dx = icx - lcx
      const flags = []
      if (!stacked && Math.abs(dy) > T.iconDy) flags.push('icon-label-vcentre')
      if (stacked && Math.abs(dx) > T.iconDy && (cs(group).textAlign === 'center' || cs(group).alignItems === 'center')) flags.push('icon-label-hcentre')
      iconRows.push({ el: eid(icon), group: eid(group), sel: sel(group), kind: 'icon+label', layout: stacked ? 'stacked' : 'inline', text: txtOf(group, 30), iconRect: { l: rnd(ir.left), t: rnd(ir.top), w: rnd(ir.width), h: rnd(ir.height) }, labelRect: { l: rnd(fl.l), t: rnd(fl.t), w: rnd(fl.r - fl.l), h: rnd(fl.b - fl.t) }, labelLines: lns.length, dyCentre: rnd(dy), dyFirstLine: rnd(dyFirst), dyBlock: rnd(dyBlock), dxCentre: rnd(dx), gap: gap == null ? null : rnd(gap), iconBeforeLabel: before, groupDir: cs(group).direction, flags })
    } else {
      // icon-only control: the icon must sit in the middle of its button
      let b = icon.parentElement, d2 = 0
      while (b && b !== body && d2 < 2 && !(b.tagName === 'BUTTON' || b.tagName === 'A' || b.getAttribute('role') === 'button')) { b = b.parentElement; d2++ }
      if (!b || !(b.tagName === 'BUTTON' || b.tagName === 'A' || b.getAttribute('role') === 'button') || inFlowText(b).length) continue
      if (cs(icon).position === 'absolute') continue   // an overlay badge is placed by its own offsets, not centred
      const br = rect(b)
      if (br.width > 96 || br.height > 96) continue    // a big link/stage that merely contains a small icon is not an icon button
      const dx = icx - (br.left + br.right) / 2, dy = icy - (br.top + br.bottom) / 2
      const flags = []
      if (Math.abs(dx) > T.iconDy || Math.abs(dy) > T.iconDy) flags.push('icon-off-centre')
      iconRows.push({ el: eid(icon), group: eid(b), sel: sel(b), kind: 'icon-only', label: b.getAttribute('aria-label') || '', iconRect: { l: rnd(ir.left), t: rnd(ir.top), w: rnd(ir.width), h: rnd(ir.height) }, boxRect: { l: rnd(br.left), t: rnd(br.top), w: rnd(br.width), h: rnd(br.height) }, dxCentre: rnd(dx), dyCentre: rnd(dy), tap: rnd(Math.min(br.width, br.height)), flags })
    }
  }
  out.iconPairs = { count: iconRows.length, flagged: iconRows.filter((x) => x.flags.length).length, rows: capList('iconPairs', iconRows.sort((a, b) => b.flags.length - a.flags.length), CAP.iconPairs) }

  // ---- label centring inside buttons / links ----
  const ctlRows = []
  for (const el of ALL) {
    const t = el.tagName
    const cls = el.getAttribute('class') || ''
    if (!(t === 'BUTTON' || (t === 'A' && /\bbtn\b|\bbutton\b|chip|pill/.test(cls)) || (t === 'INPUT' && /^(button|submit)$/.test(el.type)))) continue
    const i = info(el)
    if (!i.seen || i.r.height < 20) continue
    if (el.querySelector('svg, img')) continue
    const fl = firstLine(el, null)
    if (!fl) continue
    const lines = toLines(textNodesOf(el).flatMap(rangeRects))
    const l0 = Math.min(...lines.map((x) => x.l)), r0 = Math.max(...lines.map((x) => x.r)), t0 = Math.min(...lines.map((x) => x.t)), b0 = Math.max(...lines.map((x) => x.b))
    const r = i.r
    const centredX = i.c.textAlign === 'center' || i.c.justifyContent === 'center' || (i.c.display.startsWith('inline-') && i.r.width - (r0 - l0) < 40)
    const dx = (l0 + r0) / 2 - (r.left + r.right) / 2, dy = (t0 + b0) / 2 - (r.top + r.bottom) / 2
    const flags = []
    if (centredX && Math.abs(dx) > T.ctlDelta) flags.push('label-off-centre-x')
    if (Math.abs(dy) > T.ctlDelta) flags.push('label-off-centre-y')
    ctlRows.push({ el: eid(el), sel: sel(el), tag: t.toLowerCase(), text: txtOf(el, 30), box: { l: rnd(r.left), t: rnd(r.top), w: rnd(r.width), h: rnd(r.height) }, dx: rnd(dx), dy: rnd(dy), lines: lines.length, centredX, flags })
  }
  out.controls = { count: ctlRows.length, flagged: ctlRows.filter((x) => x.flags.length).length, rows: capList('controls', ctlRows.sort((a, b) => b.flags.length - a.flags.length), CAP.controls) }

  // ---- rows of siblings ----
  const alignOf = (kid, parentC) => { const a = cs(kid).alignSelf; return a !== 'auto' && a !== 'normal' ? a : parentC.alignItems }
  const rowOut = []
  const cardMetrics = (kid) => {
    const kr = rect(kid)
    const media = kid.querySelector('img, picture, [class*="placeholder"], svg[width]')
    const heading = kid.querySelector('h1, h2, h3, h4, [class*="name"], [class*="title"]')
    const btn = kid.querySelector('button')
    const nodes = textNodesOf(kid, 'svg')
    let lastB = null
    for (const n of nodes) for (const q of rangeRects(n)) if (lastB == null || q.bottom > lastB) lastB = q.bottom
    const hl = heading ? toLines(textNodesOf(heading, 'svg').flatMap(rangeRects)) : []
    const mr = media ? rect(media) : null, hr = heading ? rect(heading) : null, bt = btn ? rect(btn) : null
    return { mediaTop: mr ? rnd(mr.top - kr.top) : null, mediaH: mr ? rnd(mr.height) : null, titleTop: hr ? rnd(hr.top - kr.top) : null, titleLines: hl.length || null, lastTextGap: lastB == null ? null : rnd(kr.bottom - lastB), btnTop: bt ? rnd(bt.top - kr.top) : null, btnBottomGap: bt ? rnd(kr.bottom - bt.bottom) : null }
  }
  for (const par of ALL) {
    const pi = info(par)
    if (!pi.seen || par.childElementCount < 2 || par.tagName.toLowerCase() === 'svg') continue
    const kids = Array.from(par.children).filter((k) => {
      if (SKIP.has(k.tagName) || isSvgInner(k)) return false
      const ki = info(k)
      return ki.seen && ki.c.position !== 'absolute' && ki.c.position !== 'fixed'
    })
    if (kids.length < 2) continue
    // cluster kids into visual rows by vertical overlap
    const sorted = kids.slice().sort((a, b) => rect(a).top - rect(b).top || rect(a).left - rect(b).left)
    const groups = []
    for (const k of sorted) {
      const kr = rect(k)
      const g = groups.find((gg) => { const o = Math.min(gg.b, kr.bottom) - Math.max(gg.t, kr.top); return o > 0.5 * Math.min(gg.b - gg.t, kr.height) })
      if (g) { g.items.push(k); g.t = Math.min(g.t, kr.top); g.b = Math.max(g.b, kr.bottom) } else groups.push({ items: [k], t: kr.top, b: kr.bottom })
    }
    for (const g of groups) {
      if (g.items.length < 2) continue
      const pc = pi.c
      const flexish = /flex|grid/.test(pc.display)
      const items = g.items.map((k) => {
        const kr = rect(k)
        const fl = firstLine(k, 'svg')
        return { k, top: kr.top, bottom: kr.bottom, left: kr.left, h: kr.height, w: kr.width, mid: (kr.top + kr.bottom) / 2, base: fl ? fl.base : null }
      })
      const span = (arr) => arr.length ? Math.max(...arr) - Math.min(...arr) : 0
      const topD = span(items.map((x) => x.top)), botD = span(items.map((x) => x.bottom)), hD = span(items.map((x) => x.h)), midD = span(items.map((x) => x.mid))
      const bases = items.map((x) => x.base).filter((v) => v != null)
      const baseD = bases.length >= 2 ? span(bases) : null
      const aligns = new Set(items.map((x) => flexish ? alignOf(x.k, pc) : 'inline'))
      const al = aligns.size === 1 ? Array.from(aligns)[0] : 'mixed'
      const flags = []
      const E = T.rowEps
      if (al === 'mixed') { /* per-item align-self differs: nothing to expect */ }
      else if (al === 'center') { if (midD > E) flags.push('centres-differ') }
      else if (al === 'flex-end' || al === 'end' || al === 'self-end') { if (botD > E) flags.push('bottoms-differ') }
      else if (al === 'baseline' || al === 'first baseline' || al === 'last baseline' || al === 'inline') { if (baseD != null && baseD > E) flags.push('baselines-differ'); else if (baseD == null && al === 'inline' && midD > 8) flags.push('centres-differ') }
      else {
        if (topD > E) flags.push('tops-differ')
        // unequal heights are only VISIBLE when the items paint a box (background, border or shadow)
        if ((al === 'stretch' || al === 'normal') && hD > E && items.every((x) => painted(cs(x.k)))) flags.push('heights-differ')
      }
      // only evaluate the baseline inside rows where it matters regardless of align-items
      const row = { el: eid(par), sel: sel(par), display: pc.display, flexDirection: /flex/.test(pc.display) ? pc.flexDirection : null, flexWrap: /flex/.test(pc.display) ? pc.flexWrap : null, alignItems: pc.alignItems, effectiveAlign: al, n: items.length, siblingsTotal: kids.length, topDelta: rnd(topD), bottomDelta: rnd(botD), heightDelta: rnd(hD), centreDelta: rnd(midD), baselineDelta: baseD == null ? null : rnd(baseD), items: items.slice(0, 12).map((x) => ({ el: eid(x.k), l: rnd(x.left), t: rnd(x.top), w: rnd(x.w), h: rnd(x.h), baseline: x.base == null ? null : rnd(x.base) })), flags }
      // product-card style rows: compare the anatomy of each card
      const sameClass = new Set(items.map((x) => (x.k.getAttribute('class') || '').split(/\s+/).filter((c) => !UTIL.test(c)).join(' '))).size === 1
      const sameWidth = span(items.map((x) => x.w)) <= 2
      if (items.length >= 2 && items.every((x) => x.h >= 80 && x.w >= 60) && /grid|flex/.test(pc.display) && sameClass && sameWidth) {
        const cm = items.slice(0, 12).map((x) => cardMetrics(x.k))
        const dl = {}
        for (const key of ['mediaTop', 'mediaH', 'titleTop', 'lastTextGap', 'btnTop', 'btnBottomGap']) { const vs = cm.map((m) => m[key]).filter((v) => v != null); if (vs.length >= 2) dl[key] = rnd(span(vs)) }
        const tl = cm.map((m) => m.titleLines).filter((v) => v != null)
        row.cards = cm; row.cardDeltas = dl; row.titleLineCounts = Array.from(new Set(tl))
        if (dl.mediaH > E) row.flags.push('card-media-height-differs')
        if (dl.mediaTop > E) row.flags.push('card-media-top-differs')
        if (dl.btnTop > E && dl.btnBottomGap > E) row.flags.push('card-button-position-differs')
        if (row.titleLineCounts.length <= 1 && dl.titleTop > E) row.flags.push('card-title-top-differs')
      }
      rowOut.push(row)
    }
  }
  const flaggedR = rowOut.filter((x) => x.flags.length), plainR = rowOut.filter((x) => !x.flags.length)
  const keepR = flaggedR.concat(plainR.slice(0, Math.max(0, CAP.rows - flaggedR.length)))
  if (rowOut.length > keepR.length) dropped.rows = rowOut.length - keepR.length
  out.rows = { count: rowOut.length, flagged: flaggedR.length, flagCounts: flaggedR.reduce((m, r) => { for (const f of r.flags) m[f] = (m[f] || 0) + 1; return m }, {}), rows: keepR }

  // ---- fixed / sticky ----
  const fixedRows = []
  for (const el of ALL) {
    const i = info(el)
    const pos = i.c.position
    if ((pos !== 'fixed' && pos !== 'sticky') || !i.box) continue
    const r = i.r
    const onScreen = r.right > 0 && r.left < VW && r.bottom > 0 && r.top < VH
    fixedRows.push({ el: eid(el), sel: sel(el), position: pos, z: i.c.zIndex, rect: { l: rnd(r.left), r: rnd(r.right), t: rnd(r.top), b: rnd(r.bottom), w: rnd(r.width), h: rnd(r.height) }, inset: { top: i.c.top, right: i.c.right, bottom: i.c.bottom, left: i.c.left }, onScreen, offCanvas: pos === 'fixed' ? fxOff(el) : false, hiddenVis: i.c.visibility !== 'visible' || px(i.c.opacity) < 0.01, ariaHidden: el.getAttribute('aria-hidden') === 'true', pointerEvents: i.c.pointerEvents, shareOfViewportH: rnd(r.height / VH), cutOff: pos === 'fixed' && onScreen && (r.left < -T.leakEps || r.right > VW + T.leakEps), scrim: r.width >= VW - 1 && r.height >= VH - 1 })
  }
  const live = fixedRows.filter((x) => x.position === 'fixed' && x.onScreen && !x.offCanvas && !x.hiddenVis && !x.scrim)
  const overlaps = []
  for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
    const A = live[a].rect, B = live[b].rect
    const w = Math.min(A.r, B.r) - Math.max(A.l, B.l), h = Math.min(A.b, B.b) - Math.max(A.t, B.t)
    if (w > 0 && h > 0 && w * h >= T.overlapMin) overlaps.push({ a: live[a].sel, b: live[b].sel, area: rnd(w * h), w: rnd(w), h: rnd(h) })
  }
  const hd = document.querySelector('header')
  out.fixed = { count: fixedRows.length, onScreen: live.length, cutOff: fixedRows.filter((x) => x.cutOff).length, overlaps: overlaps.slice(0, CAP.overlaps), overlapCount: overlaps.length, rows: capList('fixed', fixedRows, CAP.fixed), headerHeight: hd ? rnd(rect(hd).height) : null, headerShareOfViewportH: hd ? rnd(rect(hd).height / VH) : null }

  // ---- physical offsets ----
  const physRows = []
  const sideOf = (l, r) => (l > r ? 'left' : 'right')
  const inl = (side) => (side === 'left' ? (RTL ? 'end' : 'start') : (RTL ? 'start' : 'end'))
  for (const el of ALL) {
    const i = info(el)
    if (!i.seen) continue
    const c = i.c
    const push = (kind, l, r, extra) => physRows.push({ el: eid(el), sel: sel(el), kind, left: l, right: r, bigSide: sideOf(Math.abs(l), Math.abs(r)), inlineSide: inl(sideOf(Math.abs(l), Math.abs(r))), magnitude: rnd(Math.abs(Math.abs(l) - Math.abs(r))), ...extra })
    const ml = px(c.marginLeft), mr = px(c.marginRight)
    if (Math.abs(ml - mr) >= T.physMin && c.marginLeft !== 'auto') push('margin', rnd(ml), rnd(mr))
    const pl = px(c.paddingLeft), pr = px(c.paddingRight)
    if (Math.abs(pl - pr) >= T.physMin && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') push('padding', rnd(pl), rnd(pr))
    const bl = px(c.borderLeftWidth), br = px(c.borderRightWidth)
    if (Math.abs(bl - br) >= T.physMin) push('border', rnd(bl), rnd(br))
    if (c.position !== 'static') {
      let ls = null, rs = null
      try { const m = el.computedStyleMap(); ls = String(m.get('left')); rs = String(m.get('right')) } catch (e) { /* no computedStyleMap */ }
      if (ls != null && ((ls === 'auto') !== (rs === 'auto'))) push('inset', ls === 'auto' ? 0 : px(ls), rs === 'auto' ? 0 : px(rs), { anchor: ls === 'auto' ? 'right' : 'left', position: c.position })
    }
    if (c.float === 'left' || c.float === 'right') push('float', c.float === 'left' ? 1 : 0, c.float === 'right' ? 1 : 0, { value: c.float })
    if ((c.textAlign === 'left' || c.textAlign === 'right') && Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.data))) push('text-align', c.textAlign === 'left' ? 1 : 0, c.textAlign === 'right' ? 1 : 0, { value: c.textAlign })
    if (c.transform !== 'none') { const m = c.transform.match(/matrix\(([^)]+)\)/); if (m) { const tx = parseFloat(m[1].split(',')[4]); if (Math.abs(tx) >= 1 && Math.abs(tx) < 4000) push('translateX', tx < 0 ? -tx : 0, tx > 0 ? tx : 0, { tx: rnd(tx) }) } }
  }
  physRows.sort((a, b) => b.magnitude - a.magnitude)
  out.physical = { count: physRows.length, byKind: physRows.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m }, {}), rows: capList('physical', physRows, CAP.physical) }

  // ---- header specifics ----
  const logo = document.querySelector('header .navbar-logo, header a[href="/"]')
  out.header = { present: !!hd, height: hd ? rnd(rect(hd).height) : null }
  if (logo) { const lr = rect(logo); out.header.logoCentreDx = rnd((lr.left + lr.right) / 2 - VW / 2); out.header.logoRect = { l: rnd(lr.left), r: rnd(lr.right), w: rnd(lr.width) } }
  const lm = {}
  for (const nm of ['header', 'main', 'footer']) { const e = document.querySelector(nm); if (e) { const r = rect(e); lm[nm] = { t: rnd(r.top), b: rnd(r.bottom), w: rnd(r.width), h: rnd(r.height) } } }
  out.landmarks = lm

  // ---- loading / sanity ----
  out.sanity = {
    rootChildren: document.getElementById('root') ? document.getElementById('root').childElementCount : null,
    skeletons: document.querySelectorAll('.skeleton').length,
    brokenImages: Array.from(document.images).filter((im) => im.complete && im.naturalWidth === 0 && im.src).length,
    images: document.images.length,
    fontsStatus: document.fonts.status,
    fontFaces: Array.from(document.fonts).reduce((m, f) => { const k = f.status; m[k] = (m[k] || 0) + 1; return m }, {}),
    fontFamiliesUsed: Array.from(new Set(textRows.map((x) => x.font.split(' | ')[0]))).slice(0, 12),
    h1: Array.from(document.querySelectorAll('h1')).map((h) => txtOf(h, 50)),
  }
  out.paths = PT
  out.dropped = dropped
  return out
}

/* ===================================================================================
 * ROUTES AND STATES (Node side)
 * The route list is taken from the compiled router of the live bundle
 * (assets/index-*.js: /, /shop, /product/:slug, /cart, /checkout, /payment/result, /about,
 * /contact, /wishlist, /track, /review, /invoice/:trackId, /returns, /exchange, /account,
 * /support, /terms, /privacy, /backends/*, * -> 404), cross-checked with public/.htaccess
 * (known-route list) and src/App.jsx. `{many}` `{sold}` `{low}` `{brand}` are filled from the
 * API at run time so the same table works on the mirror and on the live shop.
 * =================================================================================== */
const ALL_PUBLIC = ['base']
export const ROUTE_TABLE = [
  { id: 'home', path: '/', states: ['base', 'bag-drawer', 'bag-drawer-filled', 'ai-panel', 'lang-toggle', 'menu-open', 'topbar-long', 'topbar-link-start'] },
  { id: 'shop', path: '/shop', states: ['base', 'bag-drawer-filled'] },
  { id: 'shop-brand', path: '/shop?brand={brand}', states: ALL_PUBLIC },
  { id: 'shop-women', path: '/shop?category=women', states: ALL_PUBLIC },
  { id: 'shop-accessories', path: '/shop?category=accessories', states: ALL_PUBLIC },
  { id: 'shop-search', path: '/shop?q=sculpt', states: ALL_PUBLIC },
  { id: 'shop-noresults', path: '/shop?q=zzzzqq', states: ALL_PUBLIC },
  { id: 'shop-sale', path: '/shop?sale=1', states: ALL_PUBLIC },
  { id: 'product', path: '/product/{many}', states: ['base', 'size-selected', 'bag-drawer-filled', 'ai-panel'] },
  { id: 'product-soldout', path: '/product/{sold}', states: ALL_PUBLIC },
  { id: 'product-low', path: '/product/{low}', states: ALL_PUBLIC },
  { id: 'product-missing', path: '/product/no-such-product-zz', states: ALL_PUBLIC },
  { id: 'cart-empty', path: '/cart', states: ALL_PUBLIC },
  { id: 'cart', path: '/cart', seed: ['cart'], states: ALL_PUBLIC },
  { id: 'checkout-empty', path: '/checkout', states: ALL_PUBLIC },
  { id: 'checkout', path: '/checkout', seed: ['cart'], states: ['base', 'ai-panel'] },
  { id: 'payment-result', path: '/payment/result', states: ALL_PUBLIC },
  { id: 'payment-result-id', path: '/payment/result?trackid=SPA-AUDIT-0000', lookup: true, states: ALL_PUBLIC },
  { id: 'about', path: '/about', states: ALL_PUBLIC },
  { id: 'contact', path: '/contact', states: ALL_PUBLIC },
  { id: 'wishlist-empty', path: '/wishlist', states: ALL_PUBLIC },
  { id: 'wishlist', path: '/wishlist', seed: ['wishlist'], states: ALL_PUBLIC },
  { id: 'track', path: '/track', states: ALL_PUBLIC },
  { id: 'track-lookup', path: '/track?trackid=SPA-AUDIT-0000', lookup: true, states: ALL_PUBLIC },
  { id: 'review', path: '/review', lookup: true, states: ALL_PUBLIC },
  { id: 'invoice', path: '/invoice/SPA-AUDIT-0000', lookup: true, states: ALL_PUBLIC },
  { id: 'returns', path: '/returns', states: ALL_PUBLIC },
  { id: 'exchange', path: '/exchange', states: ALL_PUBLIC },
  { id: 'account', path: '/account', states: ALL_PUBLIC },
  { id: 'support', path: '/support', states: ALL_PUBLIC },
  { id: 'terms', path: '/terms', states: ALL_PUBLIC },
  { id: 'privacy', path: '/privacy', states: ALL_PUBLIC },
  { id: 'notfound', path: '/zz-not-a-page-audit', states: ALL_PUBLIC },
  { id: 'backends', path: '/backends', states: ALL_PUBLIC },
]

/* A state = what is done after the page settles. Every `act` is a click on a fixed, named
 * control; `guardedClick` refuses anything that could submit a form. */
const GUARD = (el) => ({ inForm: !!el.closest('form'), type: el.getAttribute('type'), disabled: el.disabled === true, text: (el.textContent || '').trim().slice(0, 40) })
async function guardedClick(page, selector, { nth = 0, timeout = 4000 } = {}) {
  const loc = page.locator(selector).nth(nth)
  try { await loc.waitFor({ state: 'visible', timeout }) } catch { return { ok: false, why: `no visible match for ${selector}` } }
  const g = await loc.evaluate(GUARD)
  if (g.disabled) return { ok: false, why: `${selector} is disabled` }
  if (g.inForm && g.type !== 'button') return { ok: false, why: `${selector} sits in a form and is not type=button: refused` }
  await loc.click({ timeout })
  return { ok: true }
}
export const STATE_TABLE = {
  base: { label: 'page as loaded' },
  'bag-drawer': { label: 'bag drawer open (empty bag)', act: (p) => guardedClick(p, '.navbar-cart') },
  'bag-drawer-filled': { label: 'bag drawer open (two lines in the bag)', seed: ['cart'], act: (p) => guardedClick(p, '.navbar-cart') },
  'ai-panel': { label: 'Sporta AI panel open', act: (p) => guardedClick(p, '.navbar-ai') },
  'lang-toggle': { label: 'language toggle clicked (starts in `lang`, ends in the other)', act: async (p) => { const r = await guardedClick(p, '.navbar-language'); await p.waitForTimeout(500); return r } },
  'menu-open': {
    label: 'mobile menu open (only if the header has a menu control)',
    act: async (p) => {
      const found = await p.evaluate(() => {
        const cands = Array.from(document.querySelectorAll('header button, header [role="button"]')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
        const m = cands.find((b) => /menu|قائمة|القائمة|nav/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('aria-controls') || '')) || b.hasAttribute('aria-expanded') && !/assistant|launcher/.test(b.className))
        return m ? { sel: m.getAttribute('aria-label') || m.className.slice(0, 40), idx: cands.indexOf(m) } : { none: true, controls: cands.map((b) => (b.getAttribute('aria-label') || b.className || '').toString().slice(0, 40)) }
      })
      if (found.none) return { ok: false, why: 'the header has no menu control: nav links are always visible (header buttons: ' + found.controls.join(' | ') + ')' }
      const r = await guardedClick(p, 'header button, header [role="button"]', { nth: found.idx })
      await p.waitForTimeout(400)
      return r
    },
  },
  'size-selected': {
    label: 'a size chip selected on the product page',
    act: async (p) => {
      const chips = p.locator('main button[type="button"]:not([disabled])').filter({ hasText: /^(XXS|XS|S|M|L|XL|[2-5]XL|ONE|ONE SIZE)$/ })
      const n = await chips.count()
      if (!n) return { ok: false, why: 'no enabled size chip on this page' }
      await chips.nth(Math.min(2, n - 1)).click({ timeout: 4000 })
      await p.waitForTimeout(350)
      return { ok: true }
    },
  },
  'topbar-long': { label: 'SYNTHETIC: top bar with a very long message (centred, brand tone)', synthetic: true, fixtures: { topbar: { enabled: true, live: true, tone: 'brand', alignment: 'center', show_dot: true, href: '', text_en: 'Free delivery across all governorates of Kuwait within 24 hours on every order over 20 KWD, plus free exchange within 14 days', text_ar: 'توصيل مجاني لجميع محافظات الكويت خلال ٢٤ ساعة لكل الطلبات التي تزيد عن ٢٠ دينار كويتي، مع إمكانية الاستبدال المجاني خلال ١٤ يومًا' } } },
  'topbar-link-start': { label: 'SYNTHETIC: top bar start-aligned, silver tone, as a link', synthetic: true, fixtures: { topbar: { enabled: true, live: true, tone: 'silver', alignment: 'start', show_dot: true, href: '/shop', text_en: 'New arrivals are in - shop the sale', text_ar: 'وصلت منتجات جديدة - تسوّق التخفيضات' } } },
}

/* ===================================================================================
 * DISCOVERY: the API (GET) says which products to use, so the table works on any server.
 * =================================================================================== */
async function discover(base) {
  const get = async (r) => { const res = await fetch(`${base}/api/api.php?r=${r}`, { headers: { accept: 'application/json' } }); if (!res.ok) throw new Error(`${r} -> ${res.status}`); return res.json() }
  let products = [], stock = [], brands = []
  try { products = await get('products') } catch (e) { log('discover products:', e.message) }
  try { stock = await get('stock') } catch (e) { log('discover stock:', e.message) }
  try { brands = await get('brands') } catch (e) { log('discover brands:', e.message) }
  products = Array.isArray(products) ? products : products.products || []
  stock = Array.isArray(stock) ? stock : stock.stock || []
  brands = Array.isArray(brands) ? brands : brands.brands || []
  const bySlug = new Map()
  for (const r of stock) { if (!bySlug.has(r.slug)) bySlug.set(r.slug, []); bySlug.get(r.slug).push(r) }
  const inStock = (s) => (bySlug.get(s) || []).filter((r) => Number(r.stock) > 0)
  const many = products.filter((p) => inStock(p.slug).length >= 4)
  const sold = products.filter((p) => (bySlug.get(p.slug) || []).length && !inStock(p.slug).length)
  const low = products.filter((p) => inStock(p.slug).length === 1 && Number(inStock(p.slug)[0].stock) <= 1)
  const pick = (arr, pref) => arr.find((p) => p.slug === pref) || arr[0]
  const pMany = pick(many, 'vanquish-t-shirt-white'), pSold = pick(sold, 'cagliari-calcio-backpack'), pLow = pick(low, 'sculpt-jacket-navy')
  const longest = products.filter((p) => inStock(p.slug).length).sort((a, b) => (b.name_ar || '').length + (b.name_en || '').length - (a.name_ar || '').length - (a.name_en || '').length)[0]
  const line = (p, qty) => {
    const sz = inStock(p.slug)[0]
    return { key: `${p.slug}__${sz.size}__-`, slug: p.slug, size: sz.size, fit: null, name: { en: p.name_en, ar: p.name_ar }, price: Number(p.price), image: p.image || '/product-photo-unavailable.svg', qty }
  }
  const cart = []
  if (pMany) cart.push(line(pMany, 2))
  if (longest && (!pMany || longest.slug !== pMany.slug)) cart.push(line(longest, 1))
  const brand = (brands.find((b) => b.slug === 'ahed') || brands.find((b) => Number(b.has_logo)) || brands[0] || { slug: 'ahed' }).slug
  return {
    many: pMany?.slug || 'vanquish-t-shirt-white', sold: pSold?.slug || 'cagliari-calcio-backpack', low: pLow?.slug || 'sculpt-jacket-navy', brand,
    cart, wishlist: products.slice(0, 6).map((p) => p.slug), products: products.length, brands: brands.map((b) => ({ slug: b.slug, logo: !!Number(b.has_logo) })),
  }
}

/* ===================================================================================
 * PLAN
 * =================================================================================== */
function buildPlan(fx, isMirror, synthetic) {
  const wantRoutes = env.ROUTES ? env.ROUTES.split(',').map((s) => s.trim()).filter(Boolean) : null
  const wantStates = env.STATES ? env.STATES.split(',').map((s) => s.trim()).filter(Boolean) : null
  let routes = ROUTE_TABLE
  if (wantRoutes) {
    routes = []
    for (const w of wantRoutes) {
      const hit = ROUTE_TABLE.find((r) => r.id === w) || ROUTE_TABLE.find((r) => r.path === w)
      routes.push(hit || { id: 'path-' + slug(w), path: w.startsWith('/') ? w : '/' + w, states: ALL_PUBLIC })
    }
  }
  const tasks = []
  for (const rt of routes) {
    if (rt.lookup && !isMirror && env.LOOKUPS !== '1') continue
    const rpath = rt.path.replace('{many}', fx.many).replace('{sold}', fx.sold).replace('{low}', fx.low).replace('{brand}', fx.brand)
    for (const st of rt.states) {
      if (wantStates && !wantStates.includes(st)) continue
      const sdef = STATE_TABLE[st]
      if (!sdef) throw new Error(`unknown state ${st}`)
      if (sdef.synthetic && !synthetic) continue
      for (const w of WIDTHS) for (const lang of LANGS) {
        tasks.push({ id: `${rt.id}__${st}__${lang}__${w}`, routeId: rt.id, path: rpath, state: st, lang, width: w, height: viewH(w), seed: Array.from(new Set([...(rt.seed || []), ...(sdef.seed || [])])), sdef })
      }
    }
  }
  return LIMIT ? tasks.slice(0, LIMIT) : tasks
}
const withLang = (p, lang) => (lang === 'en' ? p + (p.includes('?') ? '&' : '?') + 'lang=en' : p)

/* ===================================================================================
 * SETTLE: wait until the page stops changing (fonts, images, async lists, skeletons).
 * =================================================================================== */
async function settle(page, maxMs = 9000) {
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  const t0 = Date.now()
  let last = '', stable = 0
  while (Date.now() - t0 < maxMs) {
    const sig = await page.evaluate(() => `${document.documentElement.scrollHeight}|${document.body.getElementsByTagName('*').length}|${document.querySelectorAll('.skeleton').length}|${document.fonts.status}`).catch(() => 'x')
    if (sig === last) { if (++stable >= 4) break } else { stable = 0; last = sig }
    await page.waitForTimeout(120)
  }
  await page.evaluate(async () => {
    try { await document.fonts.ready } catch { /* ignore */ }
    const imgs = Array.from(document.images).filter((i) => !i.complete)
    await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 1500))])
    await Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1200))])
  }).catch(() => {})
  return { stable: stable >= 4, ms: Date.now() - t0 }
}

/* Runs before any page script: blocks submit paths and (optionally) seeds the bag/wishlist
 * in the exact shape the compiled bundle stores them. */
const INIT = ({ cart, wishlist }) => {
  try {
    if (cart) localStorage.setItem('sporta_cart', JSON.stringify(cart))
    if (wishlist) localStorage.setItem('sporta_wishlist', JSON.stringify(wishlist))
  } catch { /* storage unavailable */ }
  const bump = () => { window.__auditBlockedSubmits = (window.__auditBlockedSubmits || 0) + 1 }
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); bump() }, true)
  HTMLFormElement.prototype.submit = function () { bump() }
  HTMLFormElement.prototype.requestSubmit = function () { bump() }
}

/* ===================================================================================
 * ONE PAGE-STATE
 * =================================================================================== */
async function runTask(browser, base, task, fx, ctxFixtures) {
  const t0 = Date.now()
  const ctx = await browser.newContext({
    viewport: { width: task.width, height: task.height }, deviceScaleFactor: 1, hasTouch: task.width <= 768,
    locale: task.lang === 'ar' ? 'ar-KW' : 'en-US', timezoneId: 'Asia/Kuwait', colorScheme: 'light', serviceWorkers: 'block',
  })
  const st = { blocked: [], failed: [], external: [], errors: [], pageErrors: [], status: null }
  const fixtures = { ...(ctxFixtures || {}), ...(task.sdef.fixtures || {}) }
  const used = []
  await ctx.route('**/*', async (route) => {
    const req = route.request(), m = req.method(), u = new URL(req.url())
    if (m !== 'GET' && m !== 'HEAD') { st.blocked.push(`${m} ${u.pathname}${u.searchParams.get('r') ? '?r=' + u.searchParams.get('r') : ''}`); return route.abort('blockedbyclient') }
    if (fixtures.topbar && u.pathname.endsWith('/api/api.php') && u.searchParams.get('r') === 'slides') {
      try {
        const resp = await route.fetch()
        const j = await resp.json()
        j.promo_bar = { ...(j.promo_bar || {}), ...fixtures.topbar }
        if (!used.includes('topbar')) used.push('topbar')
        return route.fulfill({ response: resp, json: j })
      } catch { return route.continue() }
    }
    if (fixtures.brandLogos && u.pathname.endsWith('/api/api.php') && u.searchParams.get('r') === 'brand_logo') {
      const s = u.searchParams.get('slug') || ''
      if (!used.includes('brandLogos')) used.push('brandLogos')
      return route.fulfill({ status: 200, contentType: 'image/png', body: solidPng(s === 'vanquish' ? 132 : 180, 60, [150, 156, 162]), headers: { 'cache-control': 'no-store' } })
    }
    return route.continue()
  })
  await ctx.addInitScript(INIT, { cart: task.seed.includes('cart') ? fx.cart : null, wishlist: task.seed.includes('wishlist') ? fx.wishlist : null })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  page.on('console', (m) => { if (m.type() === 'error' && st.errors.length < 8) st.errors.push(m.text().slice(0, 140)) })
  page.on('pageerror', (e) => { if (st.pageErrors.length < 5) st.pageErrors.push(String(e).slice(0, 200)) })
  page.on('requestfailed', (r) => { const u = new URL(r.url()); const own = u.origin === new URL(base).origin; (own ? st.failed : st.external).push(`${u.host}${u.pathname} ${r.failure()?.errorText || ''}`.slice(0, 120)) })
  page.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.origin === new URL(base).origin && st.failed.length < 20) st.failed.push(`${r.status()} ${u.pathname}${u.searchParams.get('r') ? '?r=' + u.searchParams.get('r') : ''}`) })
  const url = base + withLang(task.path, task.lang)
  let resp = null, nav = null
  try { resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 }) } catch (e) { nav = String(e).slice(0, 160) }
  st.status = resp ? resp.status() : null
  const meta = { id: task.id, route: task.routeId, path: task.path, url, state: task.state, stateLabel: task.sdef.label, lang: task.lang, width: task.width, height: task.height, base, seed: task.seed, synthetic: !!task.sdef.synthetic || !!(ctxFixtures && Object.keys(ctxFixtures).length), thresholds: THRESHOLDS, caps: CAPS, tool: 'page-alignment-audit/1', measuredAt: new Date().toISOString() }
  let result = { schema: 'sporta-page-alignment/1', meta }
  try {
    if (nav) { meta.skipped = `navigation failed: ${nav}`; throw new Error('nav') }
    meta.settle = await settle(page)
    // Motion is left at the visitor default (the slideshow shows its pause control only when motion is allowed, which is
    // the layout a real shopper gets). The captured hero settings have autoplay off, so the page is still once settled.
    meta.media = await page.evaluate(() => ({ pointerCoarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })).catch(() => null)
    if (task.sdef.act) {
      const r = await task.sdef.act(page)
      meta.stateApplied = !!r.ok
      if (!r.ok) { meta.skipped = r.why || 'state could not be applied'; throw new Error('skip') }
      meta.settleAfterAct = await settle(page, 3500)
      await page.waitForTimeout(250)
    } else meta.stateApplied = true
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(150)
    const cfgTop = { phase: 'top', T: THRESHOLDS, caps: CAPS }
    const top = await page.evaluate(inPageMeasure, cfgTop)
    // scroll to the end for the fixed-over-content pass, then back
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(350)
    const bottom = await page.evaluate(inPageMeasure, { phase: 'bottom', T: THRESHOLDS, caps: CAPS })
    await page.evaluate(() => window.scrollTo(0, 0))
    meta.langRendered = { dir: top.doc.dir, htmlLang: top.doc.htmlLang, ok: top.doc.dir === (task.state === 'lang-toggle' ? (task.lang === 'ar' ? 'ltr' : 'rtl') : (task.lang === 'ar' ? 'rtl' : 'ltr')) }
    meta.finalPath = new URL(page.url()).pathname + new URL(page.url()).search
    meta.blockedSubmits = await page.evaluate(() => window.__auditBlockedSubmits || 0).catch(() => 0)
    const { paths, dropped, ...topRest } = top
    result = { schema: 'sporta-page-alignment/1', meta, ...topRest, bottom: { ...bottom, paths: undefined, dropped: undefined }, bottomPaths: bottom.paths, paths, dropped: { ...dropped, bottom: bottom.dropped } }
  } catch (e) {
    if (!meta.skipped) meta.error = String(e).slice(0, 300)
  } finally {
    meta.durationMs = Date.now() - t0
    meta.fixturesUsed = used
    meta.blockedNonGet = st.blocked.slice(0, 20)
    meta.httpStatus = st.status
    meta.consoleErrors = st.errors
    meta.pageErrors = st.pageErrors
    meta.failedRequests = Array.from(new Set(st.failed)).slice(0, 20)
    meta.externalFailed = Array.from(new Set(st.external)).slice(0, 10)
    await ctx.close().catch(() => {})
  }
  return result
}

/* ===================================================================================
 * OUTPUT: one JSON per page-state, top-level keys on their own lines (grep-friendly).
 * =================================================================================== */
function writeJson(file, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined)
  fs.writeFileSync(file, '{\n' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',\n') + '\n}\n')
}

/* ===================================================================================
 * PAIRING: the ar page and its en twin (same route, state, width) say what did NOT mirror.
 * Rows are matched by structural path (tag:nth-child chain), which is identical in both
 * languages when the DOM is the same; a row present in only one language is reported as such.
 * =================================================================================== */
function pairUp(ar, en) {
  const pa = ar.paths, pe = en.paths
  const out = { schema: 'sporta-page-alignment-pair/1', route: ar.meta.route, state: ar.meta.state, width: ar.meta.width, ar: ar.meta.id, en: en.meta.id, notes: [] }
  const rnd = (n) => Math.round(n * 10) / 10
  // edges: a mirrored layout has the same start/end offsets in both languages
  const eEn = new Map(en.edges.map((e) => [pe[e.el], e]))
  out.edgeAsymmetry = []
  let matched = 0
  for (const e of ar.edges) {
    const m = eEn.get(pa[e.el])
    if (!m) continue
    matched++
    if (!(e.primary && m.primary)) continue
    // A shrink-wrapped block (narrow-from-start / narrow-centred) is as wide as its TEXT, which differs per
    // language: only its start edge is comparable, and a centred one not at all.
    if (e.cls === 'narrow-centred' || m.cls === 'narrow-centred') continue
    const endComparable = e.cls !== 'narrow-from-start' && m.cls !== 'narrow-from-start'
    const ds = rnd(e.startOff - m.startOff), de = endComparable ? rnd(e.endOff - m.endOff) : 0
    if (Math.abs(ds) > THRESHOLDS.symEps || Math.abs(de) > THRESHOLDS.symEps) out.edgeAsymmetry.push({ sel: e.sel, role: e.role, ar: { startOff: e.startOff, endOff: e.endOff, cls: e.cls }, en: { startOff: m.startOff, endOff: m.endOff, cls: m.cls }, deltaStart: ds, deltaEnd: de })
  }
  out.edgesMatched = matched
  // physical offsets that stayed on the same physical side (so did not flip with direction)
  const phEn = new Map(en.physical.rows.map((r) => [pe[r.el] + '|' + r.kind, r]))
  const phAr = new Map(ar.physical.rows.map((r) => [pa[r.el] + '|' + r.kind, r]))
  out.notMirrored = []; out.onlyInAr = []; out.onlyInEn = []
  for (const r of ar.physical.rows) {
    const m = phEn.get(pa[r.el] + '|' + r.kind)
    if (!m) { out.onlyInAr.push({ sel: r.sel, kind: r.kind, left: r.left, right: r.right, bigSide: r.bigSide }); continue }
    if (m.bigSide === r.bigSide) out.notMirrored.push({ sel: r.sel, kind: r.kind, magnitude: Math.min(r.magnitude, m.magnitude), ar: { left: r.left, right: r.right, bigSide: r.bigSide, inlineSide: r.inlineSide }, en: { left: m.left, right: m.right, bigSide: m.bigSide, inlineSide: m.inlineSide }, note: `the larger ${r.kind} value is on the physical ${r.bigSide} in BOTH languages (inline-${r.inlineSide} in ar, inline-${m.inlineSide} in en): a physical property, not a logical one` })
  }
  for (const r of en.physical.rows) if (!phAr.has(pe[r.el] + '|' + r.kind)) out.onlyInEn.push({ sel: r.sel, kind: r.kind, left: r.left, right: r.right, bigSide: r.bigSide })
  if (ar.dropped?.physical || en.dropped?.physical) out.notes.push('physical rows were capped: onlyInAr/onlyInEn may include rows that exist in the other language below the cap')
  // text hugging a physical side in both languages
  const tEn = new Map(en.text.rows.map((r) => [pe[r.el], r]))
  out.textNotMirrored = []
  for (const r of ar.text.rows) {
    const m = tEn.get(pa[r.el])
    if (!m) continue
    if ((r.align === 'left' || r.align === 'right') && r.align === m.align && r.slack >= THRESHOLDS.slackMin && m.slack >= THRESHOLDS.slackMin) out.textNotMirrored.push({ sel: r.sel, ar: { text: r.text, align: r.align, dir: r.dir, slack: r.slack }, en: { text: m.text, align: m.align, dir: m.dir, slack: m.slack } })
  }
  // icons that change side relative to their label
  const iEn = new Map(en.iconPairs.rows.filter((r) => r.kind === 'icon+label').map((r) => [pe[r.el], r]))
  out.iconSideDiffers = []
  for (const r of ar.iconPairs.rows) {
    if (r.kind !== 'icon+label') continue
    const m = iEn.get(pa[r.el])
    if (m && m.layout === 'inline' && r.layout === 'inline' && m.iconBeforeLabel !== r.iconBeforeLabel) out.iconSideDiffers.push({ sel: r.sel, text: r.text, arIconBeforeLabel: r.iconBeforeLabel, enIconBeforeLabel: m.iconBeforeLabel })
  }
  out.counts = { edgeAsymmetry: out.edgeAsymmetry.length, notMirrored: out.notMirrored.length, textNotMirrored: out.textNotMirrored.length, iconSideDiffers: out.iconSideDiffers.length, onlyInAr: out.onlyInAr.length, onlyInEn: out.onlyInEn.length }
  return out
}

/* ===================================================================================
 * SUMMARY
 * =================================================================================== */
function rowOf(j) {
  const m = j.meta
  const base = { id: m.id, route: m.route, state: m.state, lang: m.lang, width: m.width, measured: !!j.doc, skipped: m.skipped || null, error: m.error || null, synthetic: !!m.synthetic }
  if (!j.doc) return base
  const unreachable = j.leaks.rows.filter((x) => x.kind === 'unreachable' || x.kind === 'cut-off-fixed' || x.kind === 'scrolls+unreachable').length
  const ptw = j.text.rows
  return {
    ...base, htmlDir: j.doc.dir, langOk: m.langRendered?.ok ?? null,
    hScroll: j.doc.hScroll, overflowPx: j.doc.overflowPx, canScrollX: j.doc.canScrollX, maskedOverflow: j.doc.maskedOverflow,
    leakRoots: j.leaks.roots, leakMaxRight: j.leaks.maxOverRight, leakMaxLeft: j.leaks.maxOverLeft, leakUnreachableOrCutOff: unreachable,
    gutterPrimary: j.gutters.primary, gutterMismatches: j.gutters.mismatches, gutterByClass: j.gutters.byClass,
    textContainers: j.text.containers, textFlagged: j.text.flagged, textWrongDirection: j.text.wrongDirection, textFlags: j.text.flagCounts,
    inputsFlagged: j.inputs.flagged, iconPairs: j.iconPairs.count, iconFlagged: j.iconPairs.flagged, controlsFlagged: j.controls.flagged,
    rows: j.rows.count, rowsFlagged: j.rows.flagged, rowFlags: j.rows.flagCounts,
    fixedOverlaps: j.fixed.overlapCount, fixedCutOff: j.fixed.cutOff, fixedOverContent: (j.bottom?.fixedOverContent || []).length,
    physical: j.physical.count, silentClips: j.clipped.silent, scrollers: j.scrollers.count,
    headerHeight: j.header?.height ?? null, logoCentreDx: j.header?.logoCentreDx ?? null,
    consoleErrors: m.consoleErrors.length, pageErrors: m.pageErrors.length, failedRequests: m.failedRequests.length, blockedNonGet: m.blockedNonGet.length, blockedSubmits: m.blockedSubmits || 0,
    renderOk: (j.sanity?.rootChildren ?? 0) > 0, skeletons: j.sanity?.skeletons ?? 0, brokenImages: j.sanity?.brokenImages ?? 0,
  }
}
function summarise(rows, pairRows) {
  const meas = rows.filter((r) => r.measured)
  const by = (arr, f) => arr.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m }, {})
  const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0)
  const hs = meas.filter((r) => r.hScroll)
  const gm = meas.filter((r) => r.gutterMismatches > 0)
  const wd = meas.filter((r) => r.textWrongDirection > 0)
  const H = {
    pageStatesPlanned: rows.length, pageStatesMeasured: meas.length, skipped: rows.length - meas.length,
    overflow: { pageStates: hs.length, real: hs.filter((r) => r.canScrollX).length, masked: hs.filter((r) => r.maskedOverflow).length, byWidth: by(hs, (r) => r.width), byLang: by(hs, (r) => r.lang), byRoute: by(hs, (r) => r.route + '/' + r.state), maxOverflowPx: Math.max(0, ...hs.map((r) => r.overflowPx)) },
    leaks: { pageStatesWithLeakRoots: meas.filter((r) => r.leakRoots > 0).length, leakRoots: sum(meas, 'leakRoots'), unreachableOrCutOff: meas.filter((r) => r.leakUnreachableOrCutOff > 0).length },
    gutters: { pageStatesWithMismatch: gm.length, blocks: sum(meas, 'gutterMismatches'), byWidth: by(gm, (r) => r.width), byLang: by(gm, (r) => r.lang), byRoute: by(gm, (r) => r.route + '/' + r.state), primaryBlocksChecked: sum(meas, 'gutterPrimary') },
    textDirection: { pageStatesWithWrongDirection: wd.length, blocks: sum(meas, 'textWrongDirection'), textContainersChecked: sum(meas, 'textContainers'), flagged: sum(meas, 'textFlagged'), byLang: by(wd, (r) => r.lang), byRoute: by(wd, (r) => r.route + '/' + r.state) },
    components: { iconPairsChecked: sum(meas, 'iconPairs'), iconFlagged: sum(meas, 'iconFlagged'), controlsFlagged: sum(meas, 'controlsFlagged'), rowsChecked: sum(meas, 'rows'), rowsFlagged: sum(meas, 'rowsFlagged'), inputsFlagged: sum(meas, 'inputsFlagged') },
    fixed: { overlappingPageStates: meas.filter((r) => r.fixedOverlaps > 0).length, cutOffPageStates: meas.filter((r) => r.fixedCutOff > 0).length, coveringContentPageStates: meas.filter((r) => r.fixedOverContent > 0).length },
    clipped: { silentClipPageStates: meas.filter((r) => r.silentClips > 0).length },
    langMismatch: meas.filter((r) => r.langOk === false).length,
    errors: { consoleErrorPageStates: meas.filter((r) => r.consoleErrors > 0).length, pageErrorPageStates: meas.filter((r) => r.pageErrors > 0).length, notRendered: meas.filter((r) => !r.renderOk).length },
    readOnly: { blockedNonGetRequests: sum(meas, 'blockedNonGet'), blockedSubmits: sum(meas, 'blockedSubmits') },
  }
  if (pairRows.length) H.pairs = { pairs: pairRows.length, withEdgeAsymmetry: pairRows.filter((p) => p.counts.edgeAsymmetry).length, edgeAsymmetryRows: sum(pairRows.map((p) => p.counts), 'edgeAsymmetry'), withNotMirrored: pairRows.filter((p) => p.counts.notMirrored).length, notMirroredRows: sum(pairRows.map((p) => p.counts), 'notMirrored'), textNotMirroredRows: sum(pairRows.map((p) => p.counts), 'textNotMirrored'), iconSideDiffers: sum(pairRows.map((p) => p.counts), 'iconSideDiffers') }
  return H
}
function summaryText(H) {
  const L = []
  const line = (s = '') => L.push(s)
  line('PAGE ALIGNMENT AUDIT - SUMMARY')
  line(`page-states planned ${H.pageStatesPlanned}, measured ${H.pageStatesMeasured}, skipped ${H.skipped}`)
  line()
  line(`Horizontal overflow (scrollWidth > clientWidth): ${H.overflow.pageStates} page-states (real pan ${H.overflow.real}, masked by overflow-x:hidden ${H.overflow.masked}), max ${H.overflow.maxOverflowPx}px`)
  line('  by width: ' + JSON.stringify(H.overflow.byWidth) + '   by lang: ' + JSON.stringify(H.overflow.byLang))
  line('  by route/state: ' + JSON.stringify(H.overflow.byRoute))
  line(`Boxes leaving the viewport: ${H.leaks.leakRoots} root elements in ${H.leaks.pageStatesWithLeakRoots} page-states; ${H.leaks.unreachableOrCutOff} page-states have content that is unreachable or cut off (fixed)`)
  line(`Gutter mismatches vs the header content edge: ${H.gutters.blocks} blocks in ${H.gutters.pageStatesWithMismatch} page-states (of ${H.gutters.primaryBlocksChecked} primary blocks checked)`)
  line('  by width: ' + JSON.stringify(H.gutters.byWidth) + '   by lang: ' + JSON.stringify(H.gutters.byLang))
  line('  by route/state: ' + JSON.stringify(H.gutters.byRoute))
  line(`Wrong-direction text blocks: ${H.textDirection.blocks} in ${H.textDirection.pageStatesWithWrongDirection} page-states (${H.textDirection.textContainersChecked} text containers checked, ${H.textDirection.flagged} carry any flag)`)
  line('  by route/state: ' + JSON.stringify(H.textDirection.byRoute))
  line(`Components: icon pairs ${H.components.iconPairsChecked} checked / ${H.components.iconFlagged} off; button labels off-centre ${H.components.controlsFlagged}; sibling rows ${H.components.rowsChecked} checked / ${H.components.rowsFlagged} flagged; inputs flagged ${H.components.inputsFlagged}`)
  line(`Fixed: overlapping in ${H.fixed.overlappingPageStates} page-states, cut off in ${H.fixed.cutOffPageStates}, covering content at page end in ${H.fixed.coveringContentPageStates}`)
  line(`Silent clips (overflow hidden, no ellipsis): ${H.clipped.silentClipPageStates} page-states`)
  line(`Language rendered != requested: ${H.langMismatch}; console-error page-states ${H.errors.consoleErrorPageStates}; not rendered ${H.errors.notRendered}`)
  line(`Read-only proof: ${H.readOnly.blockedNonGetRequests} non-GET requests aborted, ${H.readOnly.blockedSubmits} submit attempts cancelled`)
  if (H.pairs) line(`Pairs (ar vs en): ${H.pairs.pairs}; edge asymmetry in ${H.pairs.withEdgeAsymmetry} (${H.pairs.edgeAsymmetryRows} rows); physical offsets not mirrored in ${H.pairs.withNotMirrored} (${H.pairs.notMirroredRows} rows); text not mirrored ${H.pairs.textNotMirroredRows}; icon side differs ${H.pairs.iconSideDiffers}`)
  return L.join('\n') + '\n'
}

const README = `PAGE ALIGNMENT AUDIT - DATA DIRECTORY
=====================================
Written by sporta-web/scripts/page-alignment-audit.mjs (read-only; every non-GET request aborted).

FILES
  <route>__<state>__<lang>__<width>.json   one per page-state (route id, state id, ar|en, viewport width)
  pairs/<route>__<state>__<width>.json      ar vs en twin of the same page-state (what did not mirror)
  summary.json                              one counter row per page-state + headline totals
  summary.txt                               the headline totals, readable
  README.txt                                this file

LANGUAGE RULE: ar = bare URL (dir=rtl, the default); en = ?lang=en (dir=ltr). "inline-start" is the RIGHT edge in ar and the LEFT edge in en.

TOP-LEVEL KEYS OF A PAGE-STATE JSON (each key is on its own line)
  meta        id, route, path, url, state (+label), lang, width/height, seed (bag/wishlist seeded via localStorage), synthetic
              (true = a fixture the live API did not return, see fixturesUsed), settle, langRendered {dir,htmlLang,ok}, skipped
              (reason, when the state does not exist on that page), blockedNonGet (aborted POST etc), blockedSubmits,
              consoleErrors, failedRequests (own origin 4xx/5xx or network), externalFailed (third-party hosts that were unreachable,
              e.g. Adobe Fonts in the sandbox), thresholds, caps.
  doc         scrollWidth vs clientWidth/innerWidth; overflowPx; hScroll (>= 1px); canScrollX (a scrollTo probe really moved the page);
              maskedOverflow (overflow exists but html/body overflow-x:hidden hides the scroll).
  ref         the reference gutter: header content edge = header .navbar-main minus padding (physical L/R, and the gutter px each side).
  leaks       elements whose VISIBLE box (after ancestors' overflow clipping) leaves [0, viewport]. rows[] are the ROOT elements only
              (descendants are counted). kind: scrolls | unreachable (beyond the inline-START edge, no scroll position reaches it) |
              cut-off-fixed (fixed box wider than the viewport) | scrolls+unreachable. overRight/overLeft in px.
  scrollers   intentional overflow-x auto|scroll strips (startGap = gap between the strip's inline-start edge and its first item).
  clipped     overflow:hidden boxes with content wider/taller than the box. deliberate=true when text-overflow:ellipsis or line-clamp;
              silent counts the others (text cut with no sign).
  gutters     summary of the edge classification (byClass), mismatches (primary blocks with cls in sticks-out|start-indented|gutter-diff|one-sided;
              end-aligned = a short control ending on the gutter, narrow-from-start / narrow-centred = a deliberately narrower column: not mismatches),
              commonOffsets (the most common startOff/endOff pairs on the page).
  edges[]     every visible block: role, rect (l,r,t,w,h, viewport px at scroll 0), startOff/endOff = distance of the block's inline-start/-end
              edge (content box when it is a padded container) INSIDE the reference gutter (negative = pokes out), cls, primary
              (child of a gutter-defining or full-bleed parent and not a cell of a row), mismatch.
  text.rows[] every text container: text, script (ar|lat|mixed|num|none = dominant letters), dir (computed direction), dirAttr (nearest dir
              attribute), textAlign (computed), align (MEASURED side the lines hug: left|right|centre|fill|mixed), gapStart/gapEnd (px
              between the container's content edge and the text, in the PAGE's inline terms), slack (free px), startFromRef (text start
              distance from the header gutter), font "Family | 16px/24px | 700", flags, wrongDirection.
              flags: arabic-in-ltr | latin-sentence-in-rtl (>=3 Latin words in an rtl box) | align-opposes-direction (hugs the end of its
              own direction through a physical left/right or a start that landed there; text-align:end is the logical way to end-align
              a price and is NOT flagged) | align-opposes-page (hugs the page's inline-end, same exemption) | dir-attr-opposes-page.
  inputs      form fields: direction, textAlign, placeholder script, flags (arabic-placeholder-in-ltr, latin-placeholder-in-rtl, align-opposes-page).
  iconPairs   kind icon+label (layout inline|stacked, dyCentre = icon centre - first label line centre, gap, iconBeforeLabel in reading
              order) or icon-only (icon centre vs button centre, tap = smaller side). flags: icon-label-vcentre, icon-label-hcentre, icon-off-centre.
  controls    text-only buttons/links: label centre vs box centre (dx, dy). flags label-off-centre-x|y.
  rows        sibling rows (children that share a visual row): topDelta/bottomDelta/heightDelta/centreDelta/baselineDelta, alignItems and the
              effective align; flags tops-differ|heights-differ|centres-differ|bottoms-differ|baselines-differ judged by that align. Card
              rows also carry cards[] (mediaTop, mediaH, titleTop, titleLines, lastTextGap, btnTop, btnBottomGap) and cardDeltas.
  fixed       position:fixed|sticky elements (rect, inset, z, onScreen, offCanvas = a closed drawer/idle scrim), overlaps between on-screen
              fixed boxes, headerHeight and its share of the viewport height.
  bottom      the page scrolled to its end: fixedOverContent (fixed boxes covering links/buttons/text), modalOpen, headerAtBottom,
              footerBottomGap. Its element indices refer to bottomPaths.
  physical    elements with asymmetric PHYSICAL offsets (margin|padding|border|inset|float|text-align|translateX): left/right values,
              bigSide, inlineSide. One language cannot tell logical from physical: see pairs/.notMirrored.
  header      height, logoCentreDx (logo centre - viewport centre), logoRect. landmarks: header/main/footer boxes.
  sanity      rootChildren, skeletons still showing, brokenImages, fontsStatus/fontFaces, fontFamiliesUsed, h1 text.
  paths       structural path of each element, indexed by the \`el\` field in the lists above. dropped = rows cut by a cap.

PAIR FILES: edgeAsymmetry (a primary block whose start/end offsets differ between ar and en: the layout is not a mirror image),
  notMirrored (a physical offset whose larger side is the same physical side in both languages), textNotMirrored (text hugging the same
  physical side in both), iconSideDiffers, onlyInAr / onlyInEn.

LIMITS TO KNOW
  - The mirror serves the captured live bundle, add-ons and API JSON; live products have image=null so cards show the shop's placeholder.
  - A closed drawer / idle scrim (fixed, outside the viewport or transparent) is "offCanvas" and is left out of every list.
  - .htaccess headers and the real HTTP status of unknown routes are NOT applied by the mirror (httpStatus is 200 for the SPA fallback).
  - Synthetic states (meta.synthetic) use a fixture for data the captured API did not return (a configured top bar, brand logos).
  - Adobe Fonts (use.typekit.net) cannot be reached from the sandbox: families from those kits are measured in their fallbacks.
  - Light colour scheme only; no dark mode. No sign-in, so /backends is the sign-in screen only.
`

/* ===================================================================================
 * CRAWL
 * =================================================================================== */
async function startMirror() {
  const proc = spawn(process.execPath, [MIRROR], { env: { ...env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] })
  const base = await new Promise((resolve, reject) => {
    let buf = ''
    const t = setTimeout(() => reject(new Error('mirror did not start in 15s')), 15000)
    proc.stdout.on('data', (d) => { buf += d; const m = buf.match(/MIRROR_UP (http:\/\/127\.0\.0\.1:\d+)/); if (m) { clearTimeout(t); resolve(m[1]) } })
    proc.on('exit', (c) => reject(new Error('mirror exited ' + c)))
  })
  return { base, proc }
}

async function crawl({ base, tasks, fx, ctxFixtures, out }) {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : undefined), args: ['--no-sandbox'] })
  let next = 0, done = 0
  const t0 = Date.now()
  const worker = async (wid) => {
    for (;;) {
      const i = next++
      if (i >= tasks.length) return
      const task = tasks[i]
      const file = path.join(out, task.id + '.json')
      if (RESUME && fs.existsSync(file)) { done++; continue }
      let res
      try { res = await runTask(browser, base, task, fx, ctxFixtures) } catch (e) { res = { schema: 'sporta-page-alignment/1', meta: { id: task.id, route: task.routeId, state: task.state, lang: task.lang, width: task.width, error: String(e).slice(0, 300), consoleErrors: [], pageErrors: [], blockedNonGet: [], failedRequests: [] } } }
      writeJson(file, res)
      done++
      if (done % 20 === 0 || done === tasks.length) log(`${done}/${tasks.length} page-states, ${Math.round((Date.now() - t0) / 1000)}s`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)))
  await browser.close()
}

function finish(out, tasks) {
  const rows = [], byKey = new Map()
  for (const t of tasks) {
    const f = path.join(out, t.id + '.json')
    if (!fs.existsSync(f)) continue
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    rows.push(rowOf(j))
    if (j.doc) byKey.set(`${t.routeId}__${t.state}__${t.width}__${t.lang}`, j)
  }
  const pairRows = []
  fs.mkdirSync(path.join(out, 'pairs'), { recursive: true })
  for (const t of tasks) {
    if (t.lang !== 'ar') continue
    const ar = byKey.get(`${t.routeId}__${t.state}__${t.width}__ar`), en = byKey.get(`${t.routeId}__${t.state}__${t.width}__en`)
    if (!ar || !en) continue
    const p = pairUp(ar, en)
    writeJson(path.join(out, 'pairs', `${t.routeId}__${t.state}__${t.width}.json`), p)
    pairRows.push(p)
  }
  const H = summarise(rows, pairRows)
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ schema: 'sporta-page-alignment-summary/1', generatedAt: new Date().toISOString(), headline: H, pageStates: rows }, null, 1))
  fs.writeFileSync(path.join(out, 'summary.txt'), summaryText(H))
  fs.writeFileSync(path.join(out, 'README.txt'), README)
  return { H, rows, pairRows }
}

/* ===================================================================================
 * SELF-TEST: a deliberately BROKEN fixture and a CLEAN twin. A clean result only means
 * something if the same tool lights up on the broken one.
 * =================================================================================== */
function fixtureHtml(kind, lang) {
  const ar = lang === 'ar'
  const broken = kind === 'broken'
  const T = ar
    ? { title: 'عنوان الصفحة', p: 'هذه فقرة عربية قصيرة لاختبار المحاذاة والاتجاه داخل الصفحة.', short: 'نص قصير', long: 'نص طويل جدا لا يتسع داخل الصندوق الضيق ولا توجد علامة اقتطاع', label: 'زر الإجراء', chip: 'تسوق الآن', ph: 'ابحث عن منتج لديك', c1: 'بطاقة ١', c2: 'بطاقة ٢', c3: 'بطاقة ٣' }
    : { title: 'Page title', p: 'This is a short English paragraph used to test alignment and direction.', short: 'Short text', long: 'A very long line that does not fit inside the narrow box and has no ellipsis', label: 'Action button', chip: 'Shop now', ph: 'Search for a product', c1: 'Card one', c2: 'Card two', c3: 'Card three' }
  const opp = ar ? 'left' : 'right'          // the physical side opposite to the page's inline-start
  const oppDir = ar ? 'ltr' : 'rtl'
  const svg = (style = '') => `<svg width="20" height="20" viewBox="0 0 20 20" style="${style}"><circle cx="10" cy="10" r="8" fill="#E0561C"/></svg>`
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture ${kind}</title>
<style>
*{box-sizing:border-box} body{margin:0;font:16px/24px Arial,sans-serif;color:#171A1E;background:#fff}
header{background:#171A1E;color:#fff;position:sticky;top:0}
.navbar-main{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;max-width:1280px;margin:0 auto;padding:8px 12px}
.navbar-main .r{justify-self:end;display:flex;gap:8px;align-items:center}
.wrap{max-width:1280px;margin:0 auto;padding:0 12px;margin-block:12px}
.row{display:flex;gap:12px}.card{flex:1;min-height:80px;background:#E2DBCE;padding:8px}
.chip{display:inline-flex;gap:6px;line-height:32px;align-items:${broken ? 'flex-start' : 'center'}}
.btn{width:160px;height:48px;display:flex;justify-content:center;align-items:${broken ? 'flex-start' : 'center'};background:#E0561C;border:0;color:#171A1E}
.ib{width:44px;height:44px;display:flex;justify-content:${broken ? 'flex-start' : 'center'};align-items:${broken ? 'flex-start' : 'center'};background:#eee;border:0;padding:0}
.fixa,.fixb{position:fixed;width:56px;height:56px;background:#171A1E;color:#fff;inset-inline-end:16px}
.fixa{bottom:16px}.fixb{bottom:${broken ? '40px' : '90px'};inset-inline-end:${broken ? '30px' : '16px'}}
</style></head><body>
<header><nav class="navbar-main"><button class="ib" aria-label="ai">${svg()}</button><a class="navbar-logo" href="#" style="color:#fff">LOGO</a><div class="r"><button class="ib" aria-label="lang">${svg()}</button></div></nav></header>
<main>
<section class="wrap"><h1 style="margin:0">${T.title}</h1><p>${T.p}</p></section>
${broken ? '<section class="wrap" id="overflow"><div id="over" style="width:140vw;height:12px;background:#c33"></div></section>' : ''}
<section class="wrap" id="gutter" style="${broken ? 'padding:0 28px' : ''}"><h2 style="margin:0">${T.title}</h2></section>
<section class="wrap" id="shift"><div style="display:flex"><span style="${broken ? 'margin-left:30px' : 'margin-inline-start:30px'}">${T.short}</span><span style="margin-inline-start:12px">${T.short}</span></div></section>
<section class="wrap" id="logical"><div style="display:flex"><span style="margin-inline-start:30px">${T.short}</span><span style="margin-inline-start:12px">${T.short}</span></div></section>
<section class="wrap" id="dir">${broken ? `<p id="w3" style="margin:0;text-align:left">${T.short}</p>` : ''}<p id="w1" style="margin:0;${broken ? 'text-align:' + opp : ''}">${T.short}</p><p id="w2" ${broken ? `dir="${oppDir}" style="margin:0;text-align:${opp}"` : 'style="margin:0"'}>${ar ? T.p : T.p}</p></section>
<section class="wrap" id="endcell"><p style="margin:0;text-align:end">${T.short}</p></section>
<section class="wrap" id="chips"><a class="chip" href="#">${svg()}${T.chip}</a></section>
<section class="wrap" id="cards"><div class="row" style="align-items:${broken ? 'flex-start' : 'stretch'}"><div class="card">${T.c1}</div><div class="card" style="${broken ? 'margin-top:8px' : ''}">${T.c2}</div><div class="card">${T.c3}</div></div></section>
<section class="wrap" id="grid"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:stretch"><div class="card">${T.c1}</div><div class="card" style="${broken ? 'min-height:0;height:40px' : ''}">${T.c2}</div><div class="card">${T.c3}</div></div></section>
<section class="wrap" id="btns"><button class="btn">${T.label}</button> <button class="ib" aria-label="x">${svg()}</button></section>
<section class="wrap" id="clip"><div style="width:90px;overflow:hidden;white-space:nowrap;${broken ? '' : 'text-overflow:ellipsis'}">${T.long}</div></section>
<section class="wrap" id="form"><input type="text" placeholder="${T.ph}" ${broken ? `dir="${oppDir}"` : ''} style="width:100%;height:40px"></section>
</main>
<div class="fixa">A</div><div class="fixb">B</div>
</body></html>`
}

async function selftest() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const m = u.pathname.match(/^\/fx\/(broken|clean)$/)
    if (!m) { res.writeHead(404); return res.end('nf') }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(fixtureHtml(m[1], u.searchParams.get('lang') === 'en' ? 'en' : 'ar'))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const widths = [390, 1024]
  const tasks = []
  for (const kind of ['broken', 'clean']) for (const w of widths) for (const lang of ['ar', 'en']) tasks.push({ id: `fx-${kind}__base__${lang}__${w}`, routeId: `fx-${kind}`, path: `/fx/${kind}`, state: 'base', lang, width: w, height: viewH(w), seed: [], sdef: STATE_TABLE.base })
  fs.rmSync(OUT, { recursive: true, force: true })
  await crawl({ base, tasks, fx: { cart: [], wishlist: [] }, ctxFixtures: {}, out: OUT })
  const { rows, pairRows } = finish(OUT, tasks)
  server.close()
  const get = (kind, lang, w) => rows.find((r) => r.id === `fx-${kind}__base__${lang}__${w}`)
  const checks = []
  const ok = (name, cond, detail) => { checks.push({ name, pass: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')) }
  for (const w of widths) for (const lang of ['ar', 'en']) {
    const b = get('broken', lang, w), c = get('clean', lang, w), tag = `${lang}@${w}`
    ok(`broken ${tag}: renders and is measured`, b?.measured)
    ok(`clean  ${tag}: renders and is measured`, c?.measured)
    ok(`broken ${tag}: horizontal overflow found`, b.hScroll && b.overflowPx > 100, { overflowPx: b.overflowPx })
    ok(`clean  ${tag}: no horizontal overflow`, !c.hScroll && c.leakRoots === 0, { overflowPx: c.overflowPx, leakRoots: c.leakRoots })
    ok(`broken ${tag}: leak root named`, b.leakRoots >= 1, { leakRoots: b.leakRoots })
    ok(`broken ${tag}: gutter mismatch found`, b.gutterMismatches >= 1, b.gutterByClass)
    ok(`clean  ${tag}: gutters all match`, c.gutterMismatches === 0, c.gutterByClass)
    ok(`broken ${tag}: wrong-direction text found (>=2)`, b.textWrongDirection >= 2, b.textFlags)
    ok(`clean  ${tag}: no wrong-direction text`, c.textWrongDirection === 0 && c.textFlagged === 0, c.textFlags)
    ok(`broken ${tag}: placeholder direction flagged`, b.inputsFlagged >= 1)
    ok(`clean  ${tag}: inputs fine`, c.inputsFlagged === 0)
    ok(`broken ${tag}: icon misalignment found (>=2)`, b.iconFlagged >= 2, { iconFlagged: b.iconFlagged })
    ok(`clean  ${tag}: icons centred`, c.iconFlagged === 0, { iconFlagged: c.iconFlagged })
    ok(`broken ${tag}: button label off-centre found`, b.controlsFlagged >= 1)
    ok(`clean  ${tag}: button labels centred`, c.controlsFlagged === 0)
    ok(`broken ${tag}: misaligned rows found (>=2)`, b.rowsFlagged >= 2, b.rowFlags)
    ok(`clean  ${tag}: rows aligned`, c.rowsFlagged === 0, c.rowFlags)
    ok(`broken ${tag}: fixed overlap found`, b.fixedOverlaps >= 1)
    ok(`clean  ${tag}: no fixed overlap`, c.fixedOverlaps === 0)
    ok(`broken ${tag}: silent clip found`, b.silentClips >= 1)
    ok(`clean  ${tag}: no silent clip`, c.silentClips === 0)
    ok(`both ${tag}: no non-GET leaked, language rendered as asked`, b.langOk && c.langOk)
  }
  for (const w of widths) {
    const pb = pairRows.find((p) => p.route === 'fx-broken' && p.width === w), pc = pairRows.find((p) => p.route === 'fx-clean' && p.width === w)
    ok(`pairs @${w}: broken has a physical offset that did not mirror`, pb && pb.counts.notMirrored >= 1, pb && pb.notMirrored.map((x) => x.sel + ' ' + x.kind))
    ok(`pairs @${w}: clean (logical offsets) has none`, pc && pc.counts.notMirrored === 0, pc && pc.counts)
    ok(`pairs @${w}: broken text-align:left stayed left in both languages`, pb && pb.counts.textNotMirrored >= 1, pb && pb.textNotMirrored.map((x) => x.sel))
    ok(`pairs @${w}: clean has no edge asymmetry`, pc && pc.counts.edgeAsymmetry === 0, pc && pc.edgeAsymmetry.map((x) => x.sel))
    ok(`pairs @${w}: clean has no text that failed to flip`, pc && pc.counts.textNotMirrored === 0, pc && pc.textNotMirrored.map((x) => x.sel))
  }
  const failed = checks.filter((c) => !c.pass)
  console.log(`\nSELFTEST ${failed.length ? 'FAILED' : 'OK'}: ${checks.length - failed.length}/${checks.length} checks passed (data in ${OUT})`)
  process.exit(failed.length ? 1 : 0)
}

/* ===================================================================================
 * MAIN
 * =================================================================================== */
async function main() {
  if (SELFTEST) return selftest()
  let base = env.BASE ? env.BASE.replace(/\/+$/, '') : null
  let proc = null
  const startedMirror = !base
  if (!base) { ({ base, proc } = await startMirror()); log('mirror up at', base) }
  const stop = () => { if (proc) { try { proc.kill() } catch { /* gone */ } proc = null } }
  process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130) }); process.on('SIGTERM', () => { stop(); process.exit(143) })
  try {
    const synthetic = env.SYNTHETIC != null ? env.SYNTHETIC === '1' : startedMirror
    const ctxFixtures = synthetic && startedMirror ? { brandLogos: true } : {}
    const fx = await discover(base)
    log(`discovered: product=${fx.many} soldout=${fx.sold} low=${fx.low} brand=${fx.brand} cart lines=${fx.cart.length} products=${fx.products}`)
    const tasks = buildPlan(fx, startedMirror, synthetic)
    log(`plan: ${tasks.length} page-states -> ${OUT} (langs ${LANGS.join(',')}; widths ${WIDTHS.join(',')}; ${CONCURRENCY} pages at a time)`)
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ base, startedMirror, synthetic, fixtures: ctxFixtures, discovered: { ...fx, cart: fx.cart.map((c) => c.key) }, tasks: tasks.map((t) => t.id) }, null, 1))
    await crawl({ base, tasks, fx, ctxFixtures, out: OUT })
    const { H } = finish(OUT, tasks)
    console.log(summaryText(H))
  } finally { stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
