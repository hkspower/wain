// READ-ONLY probe of the LIVE header's top bar while a page loads: its height, text and markup at every change,
// so a layout shift under it (measured 0.17 on the phone home page, 0.056 on every other page) can be traced to
// what arrived late. Loads pages, reads the DOM. Clicks nothing, types nothing, sends nothing.
//
//   PATHS   pages, comma separated (default /,/shop)       WIDTHS  window widths (default 390,360,1280)
//
// Run on the VPS in the Playwright image, like live-images-scan.mjs. Compact output: the job log keeps 300 entries.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const PATHS = (process.env.PATHS || '/,/shop').split(',')
const WIDTHS = (process.env.WIDTHS || '390,360,1280').split(',').map(Number)
const b = await chromium.launch()
for (const lang of ['ar', 'en']) {
  for (const w of WIDTHS) {
    for (const path of PATHS) {
      const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 800 } })
      const page = await ctx.newPage()
      const tag = path + ' ' + lang + ' ' + w
      await page.goto(B + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'commit' }).catch(() => null)
      const t0 = Date.now()
      let last = ''
      while (Date.now() - t0 < 6000) {
        const s = await page.evaluate(() => {
          const h = (e) => (e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : -1)
          const hd = document.querySelector('header'); const tb = document.querySelector('.topbar')
          const kids = tb ? [...tb.children].map((c) => c.tagName.toLowerCase() + '.' + [...c.classList].slice(0, 2).join('.') + ' ' + Math.round(c.getBoundingClientRect().width) + 'x' + h(c)).join(' ; ') : ''
          return JSON.stringify({ header: h(hd), topbar: h(tb), cls: tb ? tb.className : '', text: tb ? tb.innerText.replace(/\s+/g, ' ').slice(0, 90) : '', kids, nav: h(document.querySelector('.navbar-main')), sec: h(document.querySelector('.navbar-secondary')) })
        }).catch(() => '')
        if (s && s !== last) { console.log('T ' + tag + ' +' + (Date.now() - t0) + ' ' + s); last = s }
        await page.waitForTimeout(40)
      }
      const fin = await page.evaluate(() => {
        const tb = document.querySelector('.topbar'); if (!tb) return 'none'
        const c = getComputedStyle(tb)
        return JSON.stringify({ html: tb.outerHTML.slice(0, 900), parent: tb.parentElement.tagName + '.' + tb.parentElement.className.slice(0, 80), display: c.display, pad: c.padding, minH: c.minHeight, fs: c.fontSize, lh: c.lineHeight, wrap: c.flexWrap, gap: c.gap, ws: c.whiteSpace })
      }).catch(() => 'err')
      if (w === WIDTHS[0] && path === PATHS[0]) console.log('FIN ' + tag + ' ' + fin)
      await ctx.close()
    }
  }
}
await b.close()
console.log('PROBE_DONE')
