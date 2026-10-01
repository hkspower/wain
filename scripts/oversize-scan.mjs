/**
 * A scan for OVER-SIZED text and boxes. Read-only; prints outliers, fails nothing.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/oversize-scan.mjs
 *
 * For each page, in both languages and three widths, it measures what the browser actually painted:
 *   TEXT     any visible text run bigger than 40px (the shop's own display headings and the 76px
 *            category titles are listed too, so they can be judged rather than assumed);
 *   BOXES    a control or card that is taller than 60% of the screen, or any element wider than the
 *            screen (which is what makes a page scroll sideways);
 *   BUTTONS  taller than 72px, or a text button wider than the page's content column;
 *   ICONS    an <svg> or small image drawn larger than 64px;
 *   CLIPPED  text cut off by its own box (scrollWidth > clientWidth with overflow hidden).
 * It counts the elements it looked at per page: a scan that saw nothing proves nothing.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PAGES = ['/', '/shop', '/product/vanquish-tank-navy', '/cart', '/about', '/contact', '/returns', '/returns/request', '/track', '/men', '/terms']
const WIDTHS = [[390, 844], [768, 1024], [1280, 800]]
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
const findings = new Map()
let looked = 0
const add = (kind, key, detail) => { const k = kind + '|' + key; const e = findings.get(k) ?? { kind, key, detail, n: 0 }; e.n++; findings.set(k, e) }

for (const [w, h] of WIDTHS) for (const lang of ['en', 'ar']) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800 })
  for (const path of PAGES) {
    await p.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(2300)
    const r = await p.evaluate(({ w, h }) => {
      const out = []
      let seen = 0
      const vis = (e, s, r) => s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 1 && r.height > 1
      for (const e of document.querySelectorAll('body *')) {
        if (e.closest('svg') && e.tagName !== 'svg') continue
        const s = getComputedStyle(e), r = e.getBoundingClientRect()
        if (!vis(e, s, r)) continue
        seen++
        const label = (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')).slice(0, 60)
        const text = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 28)
        const fs = parseFloat(s.fontSize)
        if (text && fs > 40) out.push(['TEXT', `${Math.round(fs)}px`, `${label} "${text}"`])
        if (r.right > w + 2 && s.position !== 'fixed' && !e.closest('[class*="overflow-x"], .filter-scroller, [aria-roledescription="carousel"]') && r.left < w && !e.closest('[class*="snap"], [role="group"]')) out.push(['WIDER', `${Math.round(r.right)}>${w}`, label])
        const tag = e.tagName
        // a link that CONTAINS a picture is a card, not a button — cards are meant to be tall
        if ((tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'A' && !e.querySelector('img, picture, div'))) && r.height > 72 && r.width < w) out.push(['TALL-CONTROL', `${Math.round(r.height)}px`, `${label} "${text}"`])
        if (tag === 'BUTTON' && text && r.width > w - 8) out.push(['FULL-WIDTH-BUTTON', `${Math.round(r.width)}px`, `${label} "${text}"`])
        if (tag === 'svg' && (r.width > 64 || r.height > 64)) out.push(['ICON', `${Math.round(r.width)}x${Math.round(r.height)}`, label + (e.parentElement ? ' in ' + e.parentElement.tagName.toLowerCase() : '')])
        if (['ARTICLE', 'SECTION', 'FORM', 'ASIDE', 'FIGURE'].includes(tag) && r.height > h * 1.6 && r.height > 900 && !e.closest('footer') ) out.push(['TALL-BOX', `${Math.round(r.height)}px (${(r.height / h).toFixed(1)} screens)`, label])
        if (text && s.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 3 && !/ellipsis/.test(s.textOverflow) && e.clientWidth > 0 && s.overflowX !== 'auto' && s.overflowX !== 'scroll') out.push(['CLIPPED', `${e.scrollWidth}>${e.clientWidth}`, `${label} "${text}"`])
      }
      return { seen, out, sideways: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) }
    }, { w, h })
    looked += r.seen
    if (r.sideways > 0) add('SIDEWAYS', `${path} ${w}px ${lang}`, `+${r.sideways}px`)
    for (const [kind, size, label] of r.out) add(kind, `${label} @${size}`, `${path} ${w}px ${lang}`)
  }
  await p.close()
}
await browser.close()
console.log(`looked at ${looked} painted elements across ${PAGES.length} pages x ${WIDTHS.length} widths x 2 languages\n`)
const by = {}
for (const f of findings.values()) (by[f.kind] ??= []).push(f)
for (const [kind, list] of Object.entries(by)) {
  console.log(`== ${kind} (${list.length})`)
  for (const f of list.sort((a, b) => b.n - a.n).slice(0, 12)) console.log(`   x${String(f.n).padEnd(3)} ${f.key}   e.g. ${f.detail}`)
}
if (!Object.keys(by).length) console.log('nothing oversized found')
