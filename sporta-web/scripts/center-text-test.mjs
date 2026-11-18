// CENTER-1118 of public/sporta-shadows.css (owner, 2026-11-18: "center all text"; scope: headings and short text), proven on the
// captured live markup of home, about, cart, checkout and terms (scripts/fixtures/sizes-screen, the live stylesheet, the add-on
// file, then the sheet sporta-features.js injects, in the order the browser loads them), in both languages at phone and desktop width.
//   npm run test:center-text        (ADDON_FILE=<path> runs another file; the section removed must FAIL)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FX = join(ROOT, 'scripts/fixtures/sizes-screen/')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-shadows.css'), 'utf8')
// "Before": the very same file with the CENTER-1118 section cut out, so every other section of it is in both runs and only this one differs.
const BASE = ADDON.replace(/\/\* ==== CENTER-1118[\s\S]*?\/\* ==== end CENTER-1118 \*\/\n?/, '')
const LIVE = readFileSync(FX + 'live.css', 'utf8'), FEAT = readFileSync(FX + 'features.css', 'utf8'), HEAD = readFileSync(FX + 'head.css', 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const doc = (lang, page, css) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${HEAD}${LIVE}${css}${FEAT}</style></head><body>${readFileSync(FX + `${page}-${lang}.html`, 'utf8')}</body></html>`

// What the section centres: every heading in <main> except the ones it leaves alone (the same exclusions as the CSS), plus the short-text classes.
const TARGETS = 'main :is(h1,h2,h3,h4):not(.sr-only):not(summary *, legend, table *, [role="dialog"] *, .cart-line *, .purchase-stage-title)'
// What it must NOT touch: form furniture, tables, FAQ questions, the cart's item names, the checkout stage title, long text, the footer.
const KEEP = 'main :is(label,input,select,textarea,summary,legend,td,th,.cart-line h3,.purchase-stage-title,.legal-page__section p,.legal-page__section li,.purchase-panel p,.editorial-page p:not(.page-eyebrow,.page-lead,.why-card *)),footer :is(h2,p,li)'

const probe = ({ T, K, M, H }) => {
  const align = (el) => getComputedStyle(el).textAlign
  const sel = (s) => [...document.querySelectorAll(s)]
  const lines = (el) => {
    const r = document.createRange(); r.selectNodeContents(el)
    const out = []
    for (const q of [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1).sort((a, b) => a.top - b.top)) {
      const l = out.find((o) => Math.abs(o.top - q.top) < Math.max(4, q.height / 2))
      if (l) { l.left = Math.min(l.left, q.left); l.right = Math.max(l.right, q.right) } else out.push({ top: q.top, left: q.left, right: q.right })
    }
    return out
  }
  return {
    targets: sel(T).map((el) => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 30), align: align(el) })),
    keep: sel(K).map((el) => align(el)),
    overflow: document.documentElement.scrollWidth - innerWidth,
    // geometry: the text of a heading, line by line, against the middle of the box it sits in (+/- 1px)
    off: sel(T).filter((el) => el.offsetParent !== null && /^(block|flow-root|list-item)$/.test(getComputedStyle(el).display)).map((el) => {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el)
      const mid = (b.left + parseFloat(cs.paddingLeft) + (b.right - parseFloat(cs.paddingRight))) / 2
      const ls = lines(el)
      return { text: el.textContent.trim().slice(0, 24), cls: el.className.toString().slice(0, 30), worst: ls.length ? Math.max(...ls.map((q) => Math.abs((q.left + q.right) / 2 - mid))) : 0 }
    }),
    // blocks that share a row or sit in a narrower box than the section: where the text really lands against the page/tile middle
    mid: Object.fromEntries(Object.entries(M).map(([k, s]) => {
      const el = document.querySelector(s); if (!el) return [k, null]
      const ls = lines(el); if (!ls.length) return [k, null]
      const host = el.closest(H[k] || 'main').getBoundingClientRect()
      const l = Math.min(...ls.map((q) => q.left)), r = Math.max(...ls.map((q) => q.right))
      return [k, Math.abs((l + r) / 2 - (host.left + host.right) / 2)]
    })),
    cssFlags: {
      purchaseHeading: (document.querySelector('.purchase-heading') ? getComputedStyle(document.querySelector('.purchase-heading')).justifyContent : null),
    },
  }
}
const MIDS = {
  home: { sfTitle: '.sf__title', essentials: '#home-essentials-title', gear: '#home-categories-title', heroTitle: '.campaign-hero-title', heroSub: '.campaign-hero-sub', tile: '.campaign-category__title' },
}
const HOSTS = { sfTitle: '.sf', essentials: '.home-section', gear: '.home-section', heroTitle: '.campaign-hero-content', heroSub: '.campaign-hero-content', tile: '.campaign-category' }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const MIN = { home: 12, about: 6, cart: 2, checkout: 2, terms: 8 }
for (const lang of ['ar', 'en']) for (const [w, h] of [[390, 900], [1280, 900]]) for (const page of ['home', 'about', 'cart', 'checkout', 'terms']) {
  const tag = `${page} ${lang} ${w}px`
  const run = async (css) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage()
    await p.addInitScript(([T, K, M, H]) => { T = T; K = K; M = M; H = H }, [TARGETS, KEEP, MIDS[page] || {}, HOSTS])
    await p.setContent(doc(lang, page, css)); await p.waitForTimeout(120)
    const r = await p.evaluate(probe, { T: TARGETS, K: KEEP, M: MIDS[page] || {}, H: HOSTS }); await ctx.close(); return r
  }
  const off = await run(BASE), on = await run(ADDON)
  const changed = on.targets.filter((t) => t.align === 'center').length
  is(on.targets.length >= MIN[page] && on.targets.every((t) => t.align === 'center'), `${tag}: every heading in the page body is centred (${on.targets.length} found)`, JSON.stringify(on.targets.filter((t) => t.align !== 'center').map((t) => t.tag + ' ' + t.text)))
  is(off.targets.some((t) => t.align !== 'center'), `${tag}: without the section, some headings are not centred (the state this changes)`)
  is(on.keep.length >= (page === 'terms' ? 8 : 3) && on.keep.every((a, i) => a === off.keep[i]), `${tag}: form furniture, FAQ, tables, long text, cart names, stage title and the footer keep their alignment (${on.keep.length} checked)`, on.keep.map((a, i) => a === off.keep[i] ? '' : `#${i} ${off.keep[i]}->${a}`).filter(Boolean).join(' '))
  is(on.overflow <= 0, `${tag}: no sideways scroll`, `${on.overflow}px over`)
  const bad = on.off.filter((x) => x.worst > 1.5 && !/^(Your bag|.*items?)$/.test(x.text) && !/purchase-heading/.test(x.cls))
  // a heading's own lines sit on the middle of its box; ones that share a row (flex children) are checked separately below
  is(bad.length === 0, `${tag}: each heading's lines sit on the middle of its box`, JSON.stringify(bad.slice(0, 4)))
  if (page === 'cart') is(on.cssFlags.purchaseHeading === 'center' && off.cssFlags.purchaseHeading !== 'center', `${tag}: "Your bag" and its count are centred as a pair`, `${off.cssFlags.purchaseHeading} -> ${on.cssFlags.purchaseHeading}`)
  if (page === 'home') {
    for (const [k, v] of Object.entries(on.mid)) { const o = off.mid[k]; if (v === null) { is(false, `${tag}: ${k} found`); continue }
      const tol = k === 'tile' ? 40 : 4
      is(v <= tol, `${tag}: ${k} sits on the middle of its section (${v.toFixed(1)}px off; was ${o === null ? '-' : o.toFixed(1)}px)`) }
    const moved = Object.keys(on.mid).filter((k) => off.mid[k] !== null && off.mid[k] - on.mid[k] > 3)
    is(moved.length >= 3 || w < 1000, `${tag}: without the section, the home headers were off-centre and are now centred (${moved.join(', ') || 'none'})`)
  }
}
// The same sheet loads on /backends and in the compiled admin: nothing there may move.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage()
  const adminDoc = (css) => `<!doctype html><html lang="en"><head><style>${css}</style></head><body><div class="admin-shell"><main><h1>Orders</h1><h2>Today</h2><h3>Card</h3><p class="page-eyebrow">x</p></main></div></body></html>`
  const get = async (css) => { await p.setContent(adminDoc(css)); return p.evaluate(() => [...document.querySelectorAll('main > *')].map((e) => getComputedStyle(e).textAlign)) }
  const a0 = await get(''), a1 = await get(ADDON)
  is(a0.every((x, i) => x === a1[i]), 'the admin shell (no .storefront-root) keeps every alignment', `${a0} -> ${a1}`)
  await ctx.close()
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
