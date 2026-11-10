// READ-ONLY audit of the LIVE product page: layout, tap targets, text sizes, contrast, images, what is above the
// fold, layout shift. Three products (a sized one, one on sale, one sold out when the catalogue has them), at 390,
// 768 and 1280px, in Arabic and English. Clicks nothing, types nothing, submits nothing.
//
// Run on the VPS in the Playwright image (npm i playwright@1.49.0 with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), like
// live-product-desc-scan.mjs. Output is compact on purpose: the job log is capped at 300 entries.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const j = await (await fetch(B + '/api/api.php?r=products')).json()
const list = Array.isArray(j) ? j : (j.products || [])
const pick = []
const add = (p) => { if (p && !pick.includes(p.slug)) pick.push(p.slug) }
// The public list carries no stock and no sizes, so the picks are by what it does carry: a product with several
// photos, one on sale, and one in a clothing category (the size ladder). SLUGS overrides the choice.
const photos = (p) => [p && p.image, ...((p && Array.isArray(p.images)) ? p.images : [])].filter((x) => typeof x === 'string' && x && !/unavailable/.test(x))
const hasPhoto = (p) => photos(p).length > 0
console.log('SAMPLE ' + JSON.stringify(list.slice(0, 3).map((p) => ({ slug: p.slug, image: p.image, images: p.images, on_sale: p.on_sale, category: p.category }))).slice(0, 700))
if (process.env.SLUGS) for (const s of process.env.SLUGS.split(',')) pick.push(s.trim())
add(list.find((p) => photos(p).length > 1))
add(list.find((p) => hasPhoto(p) && p.on_sale))
add(list.find((p) => hasPhoto(p) && /shirt|jacket|hood|short|pant|legging/i.test(p.slug)))
add(list.find(hasPhoto))
add(list[1])
console.log('PRODUCTS ' + list.length + ' audit ' + pick.join(',') + ' keys ' + Object.keys(list[0] || {}).join(','))

const b = await chromium.launch()
for (const slug of pick.slice(0, 3)) {
  for (const lang of ['ar', 'en']) {
    for (const w of [390, 768, 1280]) {
      const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } })
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        window.__cls = 0; window.__lcp = 0
        try {
          window.__shifts = []
          const nm = (n) => !n ? '?' : (n.nodeType === 1 ? n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].slice(0, 3).join('.') : '') : '#text')
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; if (e.value > 0.005) window.__shifts.push(e.value.toFixed(3) + '@' + Math.round(e.startTime) + ' ' + (e.sources || []).slice(0, 3).map((x) => nm(x.node) + ' ' + Math.round(x.previousRect.y) + '>' + Math.round(x.currentRect.y) + ' h' + Math.round(x.previousRect.height) + '>' + Math.round(x.currentRect.height)).join(' , ')) } }).observe({ type: 'layout-shift', buffered: true })
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
        } catch (e) { /* older engine */ }
      })
      const url = B + '/product/' + slug + (lang === 'en' ? '?lang=en' : '')
      const resp = await page.goto(url, { waitUntil: 'networkidle' }).catch(() => null)
      await page.waitForTimeout(1200)
      const r = await page.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight
        const main = document.querySelector('main') || document.body
        const sq = (s) => (s || '').replace(/\s+/g, ' ').trim()
        const vis = (e) => { const c = getComputedStyle(e); const q = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.05 && q.width > 0 && q.height > 0 }
        const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + [...e.classList].slice(0, 3).join('.') : '')
        const rgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
        const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c } return { r: 255, g: 255, b: 255, a: 1 } }
        const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], taps: [], small: [], contrast: [], imgs: [], outline: [], fold: {}, links: [] }
        for (const e of main.querySelectorAll('*')) {
          if (!vis(e)) continue
          const q = e.getBoundingClientRect()
          if (q.right > vw + 1 || q.left < -1) { if (out.wide.length < 6 && !e.closest('[class*=overflow-x], [class*=scroll]')) out.wide.push(name(e) + ' ' + Math.round(q.left) + '..' + Math.round(q.right)) }
        }
        for (const e of main.querySelectorAll('a[href],button,input,select,textarea,[role=button]')) {
          if (!vis(e)) continue
          const q = e.getBoundingClientRect()
          if ((q.width < 44 || q.height < 44) && out.taps.length < 14) out.taps.push(name(e) + ' "' + sq(e.textContent || e.getAttribute('aria-label') || '').slice(0, 18) + '" ' + Math.round(q.width) + 'x' + Math.round(q.height))
        }
        const seen = new Set()
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = sq(n.nodeValue); const e = n.parentElement
          if (!t || !e || !vis(e)) continue
          const c = getComputedStyle(e); const fs = parseFloat(c.fontSize)
          if (fs < 12 && out.small.length < 8) out.small.push(fs + 'px "' + t.slice(0, 22) + '" ' + name(e))
          const fg = rgb(c.color); if (!fg) continue
          const bg = bgOf(e); const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
          const big = fs >= 24 || (fs >= 18.66 && Number(c.fontWeight) >= 700)
          const key = name(e) + c.color
          if (ratio < (big ? 3 : 4.5) && !seen.has(key) && out.contrast.length < 10 && Number(c.opacity) > 0.9) { seen.add(key); out.contrast.push(ratio.toFixed(2) + ' ' + fs + 'px "' + t.slice(0, 20) + '" ' + name(e) + ' ' + c.color) }
        }
        for (const i of main.querySelectorAll('img')) {
          if (!vis(i)) continue
          const q = i.getBoundingClientRect(); const nw = i.naturalWidth, nh = i.naturalHeight
          const fit = getComputedStyle(i).objectFit
          const dist = nw && nh && fit === 'fill' ? Math.abs((q.width / q.height) / (nw / nh) - 1) : 0
          if (out.imgs.length < 10) out.imgs.push({ src: (i.currentSrc || i.src).replace(location.origin, '').slice(-60), box: Math.round(q.width) + 'x' + Math.round(q.height), nat: nw + 'x' + nh, fit, alt: i.alt ? 1 : 0, lazy: i.loading || '', broken: nw === 0 ? 1 : 0, distort: Number(dist.toFixed(2)), over: nw ? Number((nw / (q.width * devicePixelRatio)).toFixed(1)) : 0, top: Math.round(q.top + scrollY) })
        }
        const kids = (root, depth) => { for (const e of root.children) { if (!vis(e)) continue; const q = e.getBoundingClientRect(); if (q.height < 8) continue; out.outline.push('  '.repeat(depth) + name(e) + ' y' + Math.round(q.top + scrollY) + ' h' + Math.round(q.height) + ' w' + Math.round(q.width)); if (depth < 2 && out.outline.length < 60) kids(e, depth + 1) } }
        kids(main, 0); out.outline = out.outline.slice(0, 60)
        const y = (sel) => { const e = [...main.querySelectorAll(sel)].find(vis); return e ? Math.round(e.getBoundingClientRect().top) + '..' + Math.round(e.getBoundingClientRect().bottom) : 'none' }
        const btn = (re) => { const e = [...document.querySelectorAll('button')].find((x) => vis(x) && re.test(sq(x.textContent))); if (!e) return 'none'; const q = e.getBoundingClientRect(); return Math.round(q.top) + '..' + Math.round(q.bottom) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' pos=' + getComputedStyle(e.closest('[class*=fixed],[class*=sticky]') || e).position }
        out.fold = { vh, price: y('[class*=price], .text-accent'), sizeCard: y('[class*=size]'), desc: y('[class*=desc]'), h1: y('h1'), h1text: sq((main.querySelector('h1') || {}).textContent).slice(0, 40), h1n: document.querySelectorAll('h1').length, firstImg: y('img'), add: btn(/add|أضف|السلة|bag/i), buy: btn(/buy|اشتر/i), docH: document.documentElement.scrollHeight }
        out.links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href')).filter((h) => /sporta-/.test(h)).map((h) => h.replace(/^\//, '').replace(/\.css.*/, ''))
        out.cls = Number(window.__cls.toFixed(4)); out.lcp = Math.round(window.__lcp); out.shifts = (window.__shifts || []).slice(0, 6)
        out.text = sq(main.innerText).slice(0, 700)
        return out
      }).catch((e) => ({ error: String(e).slice(0, 200) }))
      const tag = slug + ' ' + lang + ' ' + w
      console.log('PAGE ' + tag + ' status ' + (resp ? resp.status() : '?') + ' overflowX ' + r.overflowX + ' cls ' + r.cls + ' lcp ' + r.lcp + ' fold ' + JSON.stringify(r.fold))
      if (r.error) console.log('ERR ' + tag + ' ' + r.error)
      if (r.shifts && r.shifts.length) console.log('SHIFTS ' + tag + ' ' + r.shifts.join(' || '))
      if (r.wide && r.wide.length) console.log('WIDE ' + tag + ' ' + r.wide.join(' | '))
      if (r.taps && r.taps.length) console.log('TAPS ' + tag + ' ' + r.taps.join(' | '))
      if (r.small && r.small.length) console.log('SMALL ' + tag + ' ' + r.small.join(' | '))
      if (r.contrast && r.contrast.length) console.log('CONTRAST ' + tag + ' ' + r.contrast.join(' | '))
      if (r.imgs) console.log('IMGS ' + tag + ' ' + JSON.stringify(r.imgs))
      if (lang === 'ar' && (w === 390 || w === 1280) || slug === pick[0] && w === 390) { console.log('OUTLINE ' + tag + ' ' + (r.outline || []).join(' ; ')); console.log('TEXT ' + tag + ' ' + r.text) }
      if (slug === pick[0] && lang === 'ar' && w === 390) console.log('CSS ' + (r.links || []).join(','))
      await ctx.close()
    }
  }
}
await b.close()
console.log('AUDIT_DONE')
