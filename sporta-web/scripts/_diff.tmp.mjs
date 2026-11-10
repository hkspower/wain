import { chromium } from 'playwright'
import { ALL, addons, serve, knetSource } from './lib/admin-css-full-page.mjs'
import { readFileSync } from 'node:fs'
const BEFORE = readFileSync(process.env.BEFORE, 'utf8'), AFTER = knetSource()
const ref = { current: addons(AFTER) }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const snap = () => [...document.querySelectorAll('body *')].map((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return [c.color, c.backgroundColor, c.borderTopColor, c.borderInlineStartColor, c.borderBottomColor, c.outlineColor + c.outlineStyle, c.boxShadow, c.fontSize, c.fontWeight, Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top), c.textTransform, c.display].join('|') })
const lab = () => [...document.querySelectorAll('body *')].map((e) => (e.tagName.toLowerCase() + '.' + String(e.className.baseVal ?? e.className).split(/\s+/).slice(0, 4).join('.')).slice(0, 60))
const setCss = (css) => { document.querySelector('style[data-addon="sporta-admin-knet.css"]').textContent = css }
const P = ['color', 'bg', 'bt', 'bis', 'bb', 'outline', 'shadow', 'fs', 'fw', 'w', 'h', 'x', 'y', 'tt', 'display']
const agg = new Map()
for (const [vw, vh, touch] of JSON.parse(process.env.VIEWS || '[[390,844,true],[1280,800,false],[768,1024,false]]')) for (const dark of (process.env.DARK ? [true] : [false])) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: touch, hasTouch: touch, colorScheme: dark ? 'dark' : 'light' })
  const pg = await ctx.newPage()
  for (const st of (process.env.ONLY ? process.env.ONLY.split(',') : ALL)) for (const rtl of [0, 1]) {
    await pg.goto(`${base}/__fx/${st}?rtl=${rtl}&dark=${dark ? 1 : 0}`); await pg.evaluate(() => document.fonts.ready)
    await pg.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important }' }); await pg.evaluate(setCss, BEFORE); const a = await pg.evaluate(snap)
    await pg.evaluate(setCss, AFTER); const b = await pg.evaluate(snap); const L = await pg.evaluate(lab)
    a.forEach((x, i) => { if (x !== b[i]) { const xa = x.split('|'), xb = b[i].split('|'); const d = P.filter((p, j) => xa[j] !== xb[j]); const key = `${vw}${touch ? 't' : 'm'} ${L[i]} :: ${d.map((p) => p + ' ' + xa[P.indexOf(p)].slice(0, 22) + '->' + xb[P.indexOf(p)].slice(0, 22)).join('; ')}`.slice(0, 230); agg.set(key, (agg.get(key) || 0) + 1) } })
  }
  await ctx.close()
}
const rows = [...agg].sort((a, b) => b[1] - a[1])
console.log(rows.length, 'kinds of difference'); for (const [k, n] of rows.slice(0, +process.env.MAX || 80)) console.log(n, k)
await browser.close(); server.close()
