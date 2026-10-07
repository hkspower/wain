// test:panel-phone-type — on a 390px phone, no /backends content text is under 13px (2026-10-07). The tab bar is 12px.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const EXE = execSync('ls -d /opt/pw-browsers/chromium-1194/*/chrome').toString().trim()
const SCREENS = ['Overview','Orders','Catalogue','Brands','Slides','Promotions','Discounts','Inventory','Settings','Payments','SEO','Setup','Reviews','Sporta AI','Notifications','Security']
const b = await chromium.launch({ executablePath: EXE }); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await ctx.newPage()
await p.goto('http://127.0.0.1:4300/backends', { waitUntil: 'networkidle' })
await p.fill('input[autocomplete^=username], input[type=email]', 'manager@sporta.com.kw'); await p.fill('input[type=password]', 'correct horse'); await p.locator('form button').first().click(); await p.waitForTimeout(2000)
const all = {}; const small = {}
for (const n of SCREENS) {
  await p.evaluate((n) => [...document.querySelectorAll('.admin-shell button, .admin-shell a')].find((e) => e.textContent.trim() === n)?.click(), n); await p.waitForTimeout(1200)
  const r = await p.evaluate(() => { const o = []; for (const el of document.querySelectorAll('.admin-shell *')) { const t = [...el.childNodes].filter(x => x.nodeType === 3 && x.textContent.trim()).map(x=>x.textContent.trim()).join(' '); if (!t || !el.offsetParent) continue; const cs = getComputedStyle(el); o.push([parseFloat(cs.fontSize), t.length, el.tagName + '.' + String(el.className).slice(0, 40), t.slice(0, 30), !!el.closest('.admin-content')]) } return o })
  for (const [fs, len, sel, t, inC] of r) { all[fs] = (all[fs] || 0) + len; if (fs < 14) { const k = fs + ' ' + sel + (inC ? '' : ' [chrome]'); (small[k] ||= { n: 0, ex: t, s: new Set() }); small[k].n += len; small[k].s.add(n) } }
}
console.log('chars by px:', Object.entries(all).sort((a,b)=>a[0]-b[0]).map(([k,v])=>k+':'+v).join(' '))
const tooSmall = Object.entries(small).filter(([k]) => parseFloat(k) < 13 && !/\[chrome\]/.test(k)); const desk = await (async () => { await p.setViewportSize({ width: 1280, height: 900 }); return 0 })(); console.log(tooSmall.length ? 'FAIL text under 13px on a phone: ' + tooSmall.map(([k, v]) => k + ' ' + v.ex).join(' ; ') : 'all ok — no panel text under 13px on a phone'); if (tooSmall.length) process.exitCode = 1
await b.close()
