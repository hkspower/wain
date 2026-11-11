// READ-ONLY follow-up to live-align-probe.mjs: measures the specific blocks that probe flagged, so each finding can
// be confirmed or dismissed with numbers. Loads pages and reads the DOM; clicks nothing, types nothing, POSTs nothing.
// Insets are from the inline-START side of the viewport (right in Arabic, left in English): s = start, e = end.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const out = (s) => process.stdout.write(s + '\n')
const PROD = process.env.PROD || '/product/cagliari-calcio-backpack'
const JOBS = [
  ['/', [390, 1280], ['header .navbar-main', 'header .navbar-logo', 'header .navbar-tools', 'header .navbar-actions', '.campaign-photo-hero-content', '.campaign-hero-copy', '.campaign-hero-title', '.campaign-hero-sub', '.campaign-hero-cta', '.campaign-hero-cta-icon', '.campaign-category__arrow', '.home-section-heading', '.home-shop-link']],
  ['/', [768, 1280], ['#sporta-features', '.sporta-features', '.sporta-features__item', '.sporta-features__item .home-feature-icon', '.sporta-features__item .home-feature-title', '.home-features-wrap', '.home-features']],
  [PROD, [390, 768, 1280], ['nav[aria-label*="readcrumb"], .catalog-breadcrumb', '.catalog-product-gallery, .catalog-gallery', '.catalog-product-summary', '.catalog-product-summary h1', '.catalog-product-summary > div.flex', '.catalog-product-summary > div.flex > *', '#product-size-options', '.product-purchase-row', '.product-purchase-row .btn-primary', '.product-purchase-row .btn-primary svg', '.catalog-product-quantity', '.catalog-product-reassurance']],
  ['/returns', [390, 1280], ['section.returns-system__policy', 'section.returns-system__policy > *', '.returns-system__policy-links', '.returns-system__policy-links a']],
  ['/no-such-page-align', [390, 1280], ['main section', 'main section > *', 'main h1', 'main p', 'main a.btn']],
  ['/shop', [390, 1280], ['.catalog-toolbar', '.catalog-toolbar > *', '.catalog-sort', '.catalog-sort-select', '.catalog-grid, .product-grid']],
  ['/privacy', [390, 1280], ['.legal-page', '.legal-page h1', '.legal-page h2', '.legal-page ul', '.legal-page li', '.legal-page__support']],
  ['/account', [390], ['.customer-account__card', '.customer-account__switch', '.customer-account__switch button']],
  ['/cart', [390, 1280], ['.purchase-empty', '.purchase-empty > *']],
]
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const PART = process.env.PART || 'all'
if (process.env.JOBS_B64) JOBS.splice(0, JOBS.length, ...JSON.parse(Buffer.from(process.env.JOBS_B64, 'base64').toString()))
const pick = PART === 'a' ? JOBS.slice(0, 3) : PART === 'b' ? JOBS.slice(3) : JOBS
for (const [path, widths, sels] of pick) for (const lang of ['ar', 'en']) for (const w of widths) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage()
  try {
    await p.goto(B + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'networkidle', timeout: 40000 }).catch(() => null)
    await p.waitForTimeout(1500)
    await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } scrollTo(0, 0) })
    await p.waitForTimeout(500)
    const res = await p.evaluate((sels) => {
      const cw = document.documentElement.clientWidth, rtl = getComputedStyle(document.documentElement).direction === 'rtl'
      const r1 = (n) => Math.round(n * 10) / 10
      const vis = (e) => { const c = getComputedStyle(e); const q = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && q.width > 0 && q.height > 0 }
      const ink = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rr = [...rg.getClientRects()].filter((x) => x.width > 0.5 && x.height > 0.5); if (!rr.length) return null; return { left: Math.min(...rr.map((x) => x.left)), right: Math.max(...rr.map((x) => x.right)), top: Math.min(...rr.map((x) => x.top)), bottom: Math.max(...rr.map((x) => x.bottom)) } }
      const S = (q) => rtl ? cw - q.right : q.left, E = (q) => rtl ? q.left : cw - q.right
      const lines = []
      for (const sel of sels) {
        let els = []; try { els = [...document.querySelectorAll(sel)].filter(vis) } catch (e) { lines.push(sel + ' BADSEL'); continue }
        if (!els.length) { lines.push(sel + ' none'); continue }
        const desc = els.slice(0, 6).map((e) => {
          const q = e.getBoundingClientRect(), c = getComputedStyle(e), k = ink(e)
          let t = 's' + r1(S(q)) + ' e' + r1(E(q)) + ' y' + r1(q.top + scrollY) + ' ' + r1(q.width) + 'x' + r1(q.height)
          if (k) t += ' ink s' + r1(S(k)) + ' e' + r1(E(k)) + ' ym' + r1((k.top + k.bottom) / 2 - q.top)
          t += ' ta:' + c.textAlign + (c.direction !== (rtl ? 'rtl' : 'ltr') ? ' dir:' + c.direction : '') + ' pi:' + c.paddingInlineStart + '/' + c.paddingInlineEnd
          if (parseFloat(c.borderInlineStartWidth)) t += ' bis:' + c.borderInlineStartWidth
          if (/flex|grid/.test(c.display)) t += ' ' + c.display + ':' + c.flexDirection + ' jc:' + c.justifyContent + ' ai:' + c.alignItems
          if (c.transform !== 'none') t += ' tf:' + c.transform.slice(0, 30)
          if (e.tagName === 'svg' || e.querySelector('svg')) { const s = e.tagName === 'svg' ? e : e.querySelector('svg'); const sq = s.getBoundingClientRect(); const pth = s.querySelector('path,polyline,line'); t += ' svg y' + r1((sq.top + sq.bottom) / 2 - q.top) + ' sx' + r1(S(sq)) + ' ' + (pth ? (pth.getAttribute('d') || pth.getAttribute('points') || '').slice(0, 22) : '') + (getComputedStyle(s).transform !== 'none' ? ' stf:' + getComputedStyle(s).transform.slice(0, 26) : '') }
          const txt = (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 12)
          return (txt ? '"' + txt + '" ' : '') + t
        })
        lines.push(sel + ' [' + els.length + '] ' + desc.join(' ; '))
      }
      return lines
    }, sels)
    for (const l of res) out('D ' + lang + ' ' + w + ' ' + path + ' | ' + l)
  } catch (e) { out('ERR ' + path + ' ' + String(e).slice(0, 120)) }
  await ctx.close()
}
await b.close()
out('DETAIL_DONE')
