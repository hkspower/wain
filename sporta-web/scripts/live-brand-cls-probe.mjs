// READ-ONLY probe: which elements move on /shop?brand=<slug> while it loads (live-site-scan.mjs measured CLS 0.078 ar 390,
// 0.085 en 390, 0.033 ar 1280 on /shop?brand=vanquish; every other shop page 0-0.002). Lists every layout-shift entry with
// its sources (element, rect before and after), then the markup of the page head above the grid, so a fixture can copy it.
// Loads pages and reads the DOM. Clicks nothing, types nothing, sends nothing.
//
//   PATHS   pages, comma separated (default /shop?brand=vanquish,/shop?brand=nike)   WIDTHS (default 390,1280)
//
// Run on the VPS in the Playwright image (see CLAUDE.md, "Probing the live site"). No dollar sign anywhere in this file:
// it is pasted into a compose heredoc.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const PATHS = (process.env.PATHS || '/shop?brand=vanquish,/shop?brand=nike').split(',')
const WIDTHS = (process.env.WIDTHS || '390,1280').split(',').map(Number)
const MARKUP = process.env.MARKUP !== '0'
const b = await chromium.launch()
for (const lang of ['ar', 'en']) {
  for (const w of WIDTHS) {
    for (const path of PATHS) {
      const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 800 } })
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        window.__ls = []
        const d = (n) => {
          if (!n || !n.tagName) return String(n && n.nodeName)
          const p = n.parentElement
          return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + [...n.classList].slice(0, 4).join('.') + ' "' + (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '" < ' + (p ? p.tagName.toLowerCase() + '.' + [...p.classList].slice(0, 3).join('.') : '')
        }
        const r = (x) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)].join(',')
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              if (e.hadRecentInput) continue
              window.__ls.push({ v: Number(e.value.toFixed(4)), t: Math.round(e.startTime), s: (e.sources || []).map((s) => d(s.node) + ' [' + r(s.previousRect) + ' -> ' + r(s.currentRect) + ']') })
            }
          }).observe({ type: 'layout-shift', buffered: true })
        } catch (e) { /* older engine */ }
      })
      const sep = path.includes('?') ? '&' : '?'
      await page.goto(B + path + (lang === 'en' ? sep + 'lang=en' : ''), { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
      await page.waitForTimeout(2500)
      const res = await page.evaluate(() => window.__ls).catch(() => [])
      const tag = path + ' ' + lang + ' ' + w
      const sum = res.reduce((a, e) => a + e.v, 0)
      console.log('CLS ' + tag + ' ' + sum.toFixed(3) + ' entries ' + res.length)
      for (const e of res) console.log('  LS ' + e.v + ' @' + e.t + ' | ' + e.s.join(' || '))
      if (MARKUP && w === WIDTHS[0] && lang === 'ar') {
        const m = await page.evaluate(() => {
          const main = document.querySelector('main') || document.body
          const grid = main.querySelector('.product-grid, [class*="grid"]')
          const out = []
          // everything in main that sits ABOVE the product grid, with its box and computed sizing
          const walk = (el, depth) => {
            if (depth > 7) return
            for (const c of el.children) {
              if (grid && c.contains(grid) && c !== grid) { const bx = c.getBoundingClientRect(); out.push('  '.repeat(depth) + '<' + c.tagName.toLowerCase() + ' class="' + c.className + '"> ' + Math.round(bx.y) + '/' + Math.round(bx.height)); walk(c, depth + 1); continue }
              if (c === grid) { out.push('  '.repeat(depth) + '[GRID ' + c.className + ' y ' + Math.round(c.getBoundingClientRect().y) + ']'); continue }
              const bx = c.getBoundingClientRect(); const cs = getComputedStyle(c)
              out.push('  '.repeat(depth) + 'BOX y ' + Math.round(bx.y) + ' h ' + Math.round(bx.height) + ' w ' + Math.round(bx.width) + ' minH ' + cs.minHeight + ' ar ' + cs.aspectRatio + ' :: ' + c.outerHTML.replace(/src="data:[^"]{60,}"/g, 'src="data:..."').replace(/\s+/g, ' ').slice(0, 1400))
            }
          }
          walk(main, 0)
          const imgs = [...main.querySelectorAll('img')].filter((i) => !grid || !grid.contains(i)).map((i) => { const bx = i.getBoundingClientRect(); return (i.getAttribute('src') || '').slice(0, 70) + ' nat ' + i.naturalWidth + 'x' + i.naturalHeight + ' box ' + Math.round(bx.width) + 'x' + Math.round(bx.height) + ' attrs w=' + i.getAttribute('width') + ' h=' + i.getAttribute('height') + ' cls=' + i.className })
          return out.join('\n') + '\nIMGS ' + imgs.join(' ; ')
        }).catch((e) => 'err ' + e.message)
        for (const line of m.split('\n')) console.log('M ' + tag + ' ' + line.slice(0, 1500))
      }
      await ctx.close()
    }
  }
}
await b.close()
console.log('PROBE_DONE')
