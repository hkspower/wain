// Audits the built site on the viewports modern phones actually report, and
// reports the four things that break a mobile storefront: horizontal scroll,
// touch targets too small for a thumb, form fields that make iOS zoom the page
// on focus, and vh units that jump when the browser chrome hides.
//
// Needs dist/ served on :8188. Run scripts/mobile-safe-area-test.mjs alongside
// it — this file cannot see safe-area insets, because a headless browser
// reports them all as 0.
//
// Touch-target thresholds are tiered on purpose: controls and primary
// navigation are held to the 44px in Apple's HIG, dense footer link lists to
// the 24px floor in WCAG 2.5.8. Product-card titles are reported but allowed
// at 24px+ — the card image directly above is a much larger link to the same
// page, which is the "equivalent link" exception in that same criterion.

// Audits the built site on the viewports modern phones actually report.
import { chromium } from 'playwright'

const DEVICES = [
  { name: 'iPhone 16 Pro',      w: 402, h: 874, dpr: 3, safeTop: 59, safeBottom: 34 },
  { name: 'iPhone 16 Pro Max',  w: 440, h: 956, dpr: 3, safeTop: 59, safeBottom: 34 },
  { name: 'iPhone 15',          w: 393, h: 852, dpr: 3, safeTop: 59, safeBottom: 34 },
  { name: 'iPhone SE 3',        w: 375, h: 667, dpr: 2, safeTop: 20, safeBottom: 0 },
  { name: 'Pixel 9',            w: 412, h: 915, dpr: 2.6, safeTop: 24, safeBottom: 24 },
  { name: 'Galaxy S24',         w: 360, h: 780, dpr: 3, safeTop: 24, safeBottom: 24 },
  { name: 'Z Fold 5 (folded)',  w: 344, h: 882, dpr: 2.6, safeTop: 24, safeBottom: 24 },
]
const ROUTES = ['/', '/shop', '/product/rheo-seamless-set', '/cart', '/checkout', '/returns', '/track']

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})

const findings = []
const note = (dev, route, kind, detail) => findings.push({ dev, route, kind, detail })

for (const d of DEVICES) {
  for (const route of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: d.w, height: d.h },
      deviceScaleFactor: d.dpr,
      isMobile: true,
      hasTouch: true,
    })
    // Seed a cart so /cart and /checkout render their real content.
    await ctx.addInitScript(() =>
      localStorage.setItem('sporta_cart', JSON.stringify([
        { slug: 'rheo-seamless-set', qty: 1, price: 24, name: { en: 'RHEO Seamless Set', ar: 'طقم ريو سيملس' }, image: '' },
      ])))
    const p = await ctx.newPage()
    await p.goto('http://www.sporta.com.kw' + route, { waitUntil: 'networkidle' })
    await p.waitForTimeout(150)

    const r = await p.evaluate(() => {
      const out = { overflow: [], small: [], zoomy: [], vh: [], headerH: 0, firstContentY: null }
      const vw = document.documentElement.clientWidth
      out.docW = document.documentElement.scrollWidth

      const header = document.querySelector('header')
      if (header) out.headerH = Math.round(header.getBoundingClientRect().height)

      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const b = el.getBoundingClientRect()
        if (b.width === 0 && b.height === 0) continue

        // horizontal overflow (ignore fixed overlays, they are viewport-anchored)
        if (el.closest('.cart-drawer, [role=dialog], .action-bar')) continue
        if (cs.position !== 'fixed' && (b.right > vw + 1 || b.left < -1) && b.width <= vw + 2) {
          const tag = el.tagName + '.' + String(el.className || '').slice(0, 40)
          if (!out.overflow.some((o) => o.tag === tag)) {
            out.overflow.push({ tag, left: Math.round(b.left), right: Math.round(b.right) })
          }
        }

        // touch targets: interactive elements smaller than 44x44
        const interactive = el.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button]') && !el.closest('.cart-drawer, [role=dialog]')
        if (interactive && b.height > 0) {
          const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 34)
          const inFooter = !!el.closest('footer')
          const min = inFooter ? 24 : 44
          if (b.height < min || (!inFooter && b.width < min)) {
            out.small.push({ label, w: Math.round(b.width), h: Math.round(b.height), min })
          }
        }

        // iOS zooms the page when a focused field has font-size < 16px
        if (el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')) {
          const fs = parseFloat(cs.fontSize)
          if (fs < 16) out.zoomy.push({ id: el.id || el.name || el.type, fs })
        }

        // vh units break when mobile browser chrome shrinks the viewport
        for (const prop of ['height', 'minHeight']) {
          const v = el.style[prop]
          if (v && v.includes('vh') && !v.includes('dvh')) out.vh.push(el.tagName + ' ' + prop + ':' + v)
        }
      }
      // where the real content starts, i.e. how much the header eats
      const main = document.querySelector('main') || document.body
      const fc = main.querySelector('h1, section, div')
      if (fc) out.firstContentY = Math.round(fc.getBoundingClientRect().top)
      return out
    })

    if (r.docW > d.w + 1) note(d.name, route, 'H-SCROLL', `scrollWidth ${r.docW} > ${d.w}`)
    for (const o of r.overflow.slice(0, 3)) note(d.name, route, 'overflow', `${o.tag} [${o.left}..${o.right}]`)
    const uniqSmall = [...new Map(r.small.map((s) => [s.label + s.w + s.h, s])).values()]
    for (const s of uniqSmall) note(d.name, route, `tap<${s.min}`, `"${s.label}" ${s.w}x${s.h}`)
    for (const z of r.zoomy) note(d.name, route, 'iOS-zoom', `${z.id} font-size ${z.fs}px`)
    for (const v of [...new Set(r.vh)]) note(d.name, route, 'vh-unit', v)
    if (route === '/') note(d.name, route, 'INFO', `header ${r.headerH}px = ${Math.round((r.headerH / d.h) * 100)}% of viewport`)

    await ctx.close()
  }
}

// safe-area support check (one pass)
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true })
const p = await ctx.newPage()
await p.goto('http://www.sporta.com.kw/', { waitUntil: 'networkidle' })
const sa = await p.evaluate(() => {
  const meta = document.querySelector('meta[name=viewport]')?.content ?? ''
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText) } catch { return [] } }).join('\n')
  return {
    viewportFitCover: meta.includes('viewport-fit=cover'),
    usesSafeArea: /safe-area-inset/.test(css),
    manifest: !!document.querySelector('link[rel=manifest]'),
    themeColor: document.querySelector('meta[name=theme-color]')?.content === '#171A1E',
    appleCapable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    tapHighlight: /tap-highlight-color/.test(css),
    overscroll: /overscroll-behavior/.test(css),
  }
})
await browser.close()

console.log('\n===== GLOBAL MOBILE CAPABILITIES =====')
for (const [k, v] of Object.entries(sa)) console.log(`  ${v === true || v > 1 ? 'ok  ' : 'MISS'}  ${k}: ${v}`)

console.log('\n===== FINDINGS BY KIND =====')
const byKind = {}
for (const f of findings) (byKind[f.kind] ??= []).push(f)
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n## ${kind}  (${list.length})`)
  const seen = new Set()
  for (const f of list) {
    const key = f.kind + f.detail + f.route
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`   ${f.route.padEnd(30)} ${f.detail}   [${f.dev}]`)
  }
}
