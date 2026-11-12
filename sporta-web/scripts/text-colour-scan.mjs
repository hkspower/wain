import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
// Text colour scan (MONO-1112 in public/sporta-ui-colours.css): every visible text element on 16 shop pages, ar 390 /
// ar 1280 / en 390, with the menu and the bag drawer open: is it black (#171a1e) or white, and is it 4.5:1 against its
// background (photo-aware)? Run against a copy of the live storefront served with the current add-ons, or the live site
// itself from the VPS (read-only: GET only, nothing submitted). BASE=<origin> node scripts/text-colour-scan.mjs
const B = process.env.BASE || 'http://127.0.0.1:8411'
const extra = process.env.EXTRA_CSS ? readFileSync(process.env.EXTRA_CSS, 'utf8') : ''
const prods = await (await fetch(B + '/api/api.php?r=products')).json()
const slug = prods[0].slug
const PAGES = ['/', '/shop', '/product/' + slug, '/cart', '/checkout', '/about', '/returns', '/exchange', '/contact', '/account', '/track', '/support', '/terms', '/privacy', '/wishlist', '/no-such-page']
const b = await chromium.launch()
const bad = new Map(); let total = 0, mono = 0
const STATES = [['', null], ['menu', 'header button[aria-expanded="false"][aria-controls], header button[aria-label*="القائمة"], header button[aria-label*="menu" i]'], ['bag', 'header a[href="/cart"], header button[aria-label*="حقيب"], header button[aria-label*="bag" i]']]
for (const [lang, w] of [['ar', 390], ['ar', 1280], ['en', 390]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: process.env.DARK ? 'dark' : 'light' })
  await ctx.addInitScript(([l, s, p, css, DARKMODE]) => {
    try { if (DARKMODE) localStorage.setItem('sporta_theme', 'dark'); localStorage.setItem('lang', l); localStorage.setItem('sporta_cart', JSON.stringify([{ slug: s, name: { en: p.name_en, ar: p.name_ar }, price: p.price, qty: 1, size: 'M', fit: null, key: s + '__M__-', image: p.image }])) } catch (e) {}
    if (css) document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st) })
  }, [lang, slug, prods[0], extra, !!process.env.DARK])
  const page = await ctx.newPage()
  await page.route('**/*', (r) => (['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort()))
  for (const path of PAGES) for (const [state, sel] of STATES) {
    if (state && path !== '/' && path !== '/product/' + slug) continue
    await page.goto(B + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(900)
    if (sel) { const h = await page.$(sel); if (!h) continue; await h.click().catch(() => {}); await page.waitForTimeout(700) }
    const found = await page.evaluate(() => {
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = 1; const cx = cvs.getContext('2d', { willReadFrequently: true }); const rgb = (c) => { const m = c.match(/\/ *([\d.]+)\)$|rgba\([^)]*, *([\d.]+)\)$/); const a = m ? Number(m[1] ?? m[2]) : (c === 'transparent' ? 0 : 1); cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; if (a === 0) return [255, 255, 255, 0]; if (a < 1) { cx.fillStyle = '#000000'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); } return [d[0], d[1], d[2], a] }
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const bgOf = (el) => {
        const r = el.getBoundingClientRect()
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e)
          if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return 'photo'
          const im = [...e.querySelectorAll(':scope > img, :scope > picture img, :scope > div > img')].find((i) => { const q = i.getBoundingClientRect(); return q.left <= r.left + 2 && q.right >= r.right - 2 && q.top <= r.top + 2 && q.bottom >= r.bottom - 2 && !i.contains(el) })
          if (im && e !== el) return 'photo'
          const c = rgb(cs.backgroundColor); if (c[3] >= 0.5) return c
        }
        return [255, 255, 255, 1]
      }
      const out = []; const seen = new Set()
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n; (n = walk.nextNode());) {
        const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) continue
        const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el)
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
        if (cs.visibility === 'hidden' || r.width === 0 || r.height === 0 || +cs.opacity === 0 || el.closest('[aria-hidden="true"], script, style, noscript')) continue
        const c = rgb(cs.color); const bg = bgOf(el)
        const isBlack = c[3] === 1 && ((c[0] === 23 && c[1] === 26 && c[2] === 30) || (c[0] + c[1] + c[2] === 0))
        const isWhite = c[3] === 1 && c[0] === 255 && c[1] === 255 && c[2] === 255
        let ratio = null
        if (bg !== 'photo') { const a = lum(c), d = lum(bg); ratio = (Math.max(a, d) + 0.05) / (Math.min(a, d) + 0.05) }
        const err = !!el.closest('[role="alert"], .text-red-600, .text-red-700, .text-rose-600, [class*="error"]')
        const path = []; for (let e = el; e && e !== document.body && path.length < 4; e = e.parentElement) path.unshift(e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 3).join('.') : ''))
        out.push({ ok: isBlack || isWhite, c: cs.color, bg: bg === 'photo' ? 'photo' : 'rgb(' + bg.slice(0, 3).join(',') + ')', ratio, err, t: t.slice(0, 36), path: path.join(' > ') })
      }
      return out
    })
    for (const f of found) {
      total++; if (f.ok) mono++
      const lowContrast = f.ratio !== null && f.ratio < 4.5
      if (f.ok && !lowContrast) continue
      const k = (f.ok ? 'LOWCONTRAST ' : (f.err ? 'ERROR-RED ' : 'COLOUR ')) + f.c + ' on ' + f.bg + ' | ' + f.path
      if (!bad.has(k)) bad.set(k, { n: 0, ex: lang + w + ' ' + path + (state ? ' [' + state + ']' : '') + ' "' + f.t + '" ' + (f.ratio ? f.ratio.toFixed(2) : '') })
      bad.get(k).n++
    }
  }
  await ctx.close()
}
await b.close()
console.log(`text elements ${total}, black/white ${mono}, other ${total - mono}`)
const rows = [...bad.entries()].sort((a, b) => a[0].localeCompare(b[0]))
for (const [k, v] of rows) console.log(v.n + '  ' + k + '  || ' + v.ex)
