// READ-ONLY scan of the LIVE product descriptions: the catalogue text (public API) checked for empty, mixed-language,
// markup, spacing, punctuation and duplicate problems, and the layout of the description on the product page at 390,
// 768 and 1280px in Arabic and English. Clicks nothing, types nothing. Run on the VPS in the Playwright image
// (npm i playwright@1.49.0 with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), like admin-payments-scan.mjs.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const j = await (await fetch(B + '/api/api.php?r=products')).json()
const list = Array.isArray(j) ? j : (j.products || [])
const AR = /[؀-ۿ]/g, LAT = /[A-Za-z]/g
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const ratio = (s) => { const a = (s.match(AR) || []).length, l = (s.match(LAT) || []).length; return a + l ? a / (a + l) : 0 }
console.log('PRODUCTS ' + list.length + ' keys ' + Object.keys(list[0] || {}).join(','))
const seen = new Map()
const rows = []
for (const p of list) {
  const ar = String(p.desc_ar || ''), en = String(p.desc_en || '')
  const f = []
  if (!norm(ar)) f.push('AR-EMPTY'); else {
    if (ratio(ar) < 0.6) f.push('AR-MOSTLY-LATIN')
    if (/[<>]|&nbsp;|&amp;|\*\*|##/.test(ar)) f.push('AR-MARKUP')
    if (/ {2,}/.test(ar)) f.push('AR-DOUBLE-SPACE')
    if (ar !== ar.trim()) f.push('AR-EDGE-SPACE')
    if (/[؀-ۿ][,?;]/.test(ar) || /[,?;][؀-ۿ]/.test(ar)) f.push('AR-LATIN-PUNCT')
    if (/[0-9]/.test(ar) && /[٠-٩]/.test(ar)) f.push('AR-MIXED-DIGITS')
    if (norm(ar).length < 40) f.push('AR-SHORT'); if (norm(ar).length > 600) f.push('AR-LONG')
    if (/\n/.test(ar)) f.push('AR-NEWLINES')
  }
  if (!norm(en)) f.push('EN-EMPTY'); else {
    if ((en.match(AR) || []).length) f.push('EN-HAS-ARABIC')
    if (/[<>]|&nbsp;|&amp;|\*\*|##/.test(en)) f.push('EN-MARKUP')
    if (/ {2,}/.test(en)) f.push('EN-DOUBLE-SPACE')
    if (en !== en.trim()) f.push('EN-EDGE-SPACE')
    const letters = en.replace(/[^A-Za-z]/g, ''); if (letters.length > 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) f.push('EN-ALLCAPS')
    if (norm(en).length < 40) f.push('EN-SHORT'); if (norm(en).length > 600) f.push('EN-LONG')
  }
  if (norm(ar) && norm(ar) === norm(en)) f.push('AR=EN')
  for (const k of [norm(ar), norm(en)]) if (k) { if (seen.has(k) && seen.get(k) !== p.slug) f.push('DUP-OF-' + seen.get(k)); else seen.set(k, p.slug) }
  const price = Number(p.price), sale = p.sale_price == null ? null : Number(p.sale_price)
  if (!(price > 0)) f.push('PRICE-0'); if (sale != null && sale >= price) f.push('SALE>=PRICE')
  rows.push({ slug: p.slug, f })
  console.log('ROW ' + p.slug + ' | ' + p.price + (sale != null ? '/' + sale : '') + ' | ar ' + norm(ar).length + ' en ' + norm(en).length + ' | ' + (f.join(' ') || 'ok'))
}
const counts = {}
rows.forEach((r) => r.f.forEach((x) => { const k = x.replace(/^DUP-OF-.*/, 'DUP'); counts[k] = (counts[k] || 0) + 1 }))
console.log('FLAG COUNTS ' + JSON.stringify(counts))
for (const p of list) {
  console.log('TEXT ' + p.slug + '\n  AR: ' + norm(p.desc_ar).slice(0, 330) + '\n  EN: ' + norm(p.desc_en).slice(0, 330))
}
// layout of the description on the product page
const withD = list.filter((p) => norm(p.desc_ar).length > 0 && norm(p.desc_en).length > 0)
const by = [...withD].sort((a, b) => norm(a.desc_ar).length - norm(b.desc_ar).length)
const pick = [by[0], by[Math.floor(by.length / 2)], by[by.length - 1]].filter(Boolean)
const empty = list.find((p) => !norm(p.desc_ar) || !norm(p.desc_en))
if (empty) pick.push(empty)
console.log('LAYOUT PICKS ' + pick.map((p) => p.slug).join(', '))
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const probe = (needle) => {
  const leaf = [...document.querySelectorAll('p,div,span,section,li')].filter((e) => e.children.length === 0 && e.textContent.replace(/\s+/g, ' ').trim().startsWith(needle))[0]
  const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.left) + ',' + Math.round(b.top + scrollY) + ',' + Math.round(b.width) + ',' + Math.round(b.height) }
  const h1 = document.querySelector('h1')
  const out = { h1: h1 ? R(h1) + ' fs ' + getComputedStyle(h1).fontSize : 'none', scrollW: document.documentElement.scrollWidth, innerW: innerWidth }
  if (!leaf) { out.desc = 'NOT FOUND'; return out }
  const cs = getComputedStyle(leaf)
  const g = document.createRange(); g.selectNodeContents(leaf)
  const lines = new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size
  const prev = leaf.previousElementSibling, next = leaf.nextElementSibling
  const fs = parseFloat(cs.fontSize), w = leaf.getBoundingClientRect().width
  out.desc = { tag: leaf.tagName, cls: String(leaf.className).slice(0, 90), rect: R(leaf), fs: cs.fontSize, lh: cs.lineHeight, color: cs.color, weight: cs.fontWeight, align: cs.textAlign, dir: cs.direction, ws: cs.whiteSpace, maxW: cs.maxWidth, lines, charsPerLine: Math.round(leaf.textContent.length / Math.max(lines, 1)), measureEm: Math.round(w / fs * 10) / 10, clamp: cs.webkitLineClamp, ovf: cs.overflow, clipped: leaf.scrollHeight > leaf.clientHeight + 1, lang: leaf.closest('[lang]') && leaf.closest('[lang]').getAttribute('lang'), prev: prev ? prev.tagName + '.' + String(prev.className).slice(0, 50) + ' ' + R(prev) : 'none', next: next ? next.tagName + '.' + String(next.className).slice(0, 50) + ' ' + R(next) : 'none', topInViewport: Math.round(leaf.getBoundingClientRect().top + scrollY) }
  const chain = []; let a = leaf.parentElement
  for (let i = 0; i < 4 && a; i++) { chain.push(a.tagName + '.' + String(a.className).split(/\s+/).slice(0, 4).join('.') + ' ' + R(a)); a = a.parentElement }
  out.chain = chain
  return out
}
for (const p of pick) {
  for (const lang of ['ar', 'en']) {
    for (const w of [390, 768, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
      const pg = await ctx.newPage()
      try {
        await pg.goto(B + '/product/' + p.slug + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle', timeout: 90000 })
        await pg.waitForTimeout(1000)
        const txt = norm(lang === 'ar' ? p.desc_ar : p.desc_en)
        console.log('LAYOUT ' + p.slug + ' ' + lang + ' ' + w + ' ' + JSON.stringify(await pg.evaluate(probe, txt.slice(0, 28))))
      } catch (e) { console.log('LAYOUT ' + p.slug + ' ' + lang + ' ' + w + ' ERROR ' + String(e.message).slice(0, 120)) }
      await ctx.close()
    }
  }
}
await browser.close()
console.log('DESC_DONE')
