// QUIET-1112 check (addons-src/sporta-admin-knet.css): signs in to the SANDBOX admin (qa-admin@sporta.test, npm run sandbox) through a
// local copy of the live build served with the current add-ons (BASE, default http://127.0.0.1:8411), visits every /backends screen
// and prints per screen the distinct text, background and border colours, images, icons and emoji, plus every text under 4.5:1.
// Never point it at the live site: it signs in and clicks through the admin.
import { chromium } from 'playwright'
const B = process.env.BASE || 'http://127.0.0.1:8411'
const W = +(process.env.W || 1280)
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: W, height: 900 } })
const p = await ctx.newPage()
await p.goto(B + '/backends', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.fill('input[type=email], input[name=email], input[autocomplete=username]', 'qa-admin@sporta.test').catch((e) => console.log('no email field', e.message))
await p.fill('input[type=password]', 'correct-horse-battery-kw')
await p.click('form button[type=submit]').catch(() => p.keyboard.press('Enter'))
await p.waitForTimeout(3000)
const signed = await p.evaluate(() => !document.querySelector('input[type=password]'))
console.log('signed in: ' + signed)
const tabs = await p.evaluate(() => [...document.querySelectorAll('nav a, aside a, nav button, aside button, [role=tab]')].map((e) => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter((t) => t && t.length < 40))
const uniq = [...new Set(tabs)]
console.log('nav items: ' + uniq.join(' | '))
const MEASURE = () => {
  const norm = (c) => c.replace(/\s+/g, ' ')
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = 1; const cx = cvs.getContext('2d', { willReadFrequently: true })
  const px = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgUnder = (el) => { for (let e = el; e; e = e.parentElement) { const d = px(getComputedStyle(e).backgroundColor); if (d[3] > 200) return d } return [255, 255, 255, 255] }
  window.__low = window.__low || new Map()
  const txt = new Map(), bg = new Map(), bd = new Map(); let imgs = [], bgimgs = 0, svgs = 0, emoji = 0
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { if (!el.closest('[class*="topbar-editor__preview"]') && !el.disabled && !el.closest(':disabled')) { const a = lum(px(cs.color)), d = lum(bgUnder(el)); const r = (Math.max(a, d) + 0.05) / (Math.min(a, d) + 0.05); if (r < 4.5) { const k = norm(cs.color) + ' on ' + bgUnder(el).slice(0, 3).join(',') + ' ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + (el.getAttribute('aria-pressed') ? '[aria-pressed=' + el.getAttribute('aria-pressed') + ']' : ''); window.__low.set(k, r.toFixed(2) + ' "' + el.textContent.trim().slice(0, 30) + '"') } } const c = norm(cs.color); txt.set(c, (txt.get(c) || 0) + 1); if (/\p{Extended_Pictographic}/u.test(el.textContent)) emoji++ }
    const sel = el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 5).join('.'); window.__ex = window.__ex || {}
    const g = norm(cs.backgroundColor); if (!/rgba\(0, 0, 0, 0\)|transparent/.test(g)) { bg.set(g, (bg.get(g) || 0) + 1); (window.__ex['BG ' + g] = window.__ex['BG ' + g] || new Set()).add(sel) }
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) (window.__ex['TX ' + norm(cs.color)] = window.__ex['TX ' + norm(cs.color)] || new Set()).add(sel)
    if (el.tagName === 'svg') (window.__ex['SVG'] = window.__ex['SVG'] || new Set()).add((el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + [...el.parentElement.classList].slice(0, 4).join('.') : '') + ' > svg')
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') { const d = norm(cs.borderTopColor); bd.set(d, (bd.get(d) || 0) + 1) }
    if (el.tagName === 'IMG') imgs.push((el.getAttribute('src') || '').slice(0, 50) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (el.alt ? ' alt=' + el.alt.slice(0, 20) : ''))
    if (cs.backgroundImage && cs.backgroundImage !== 'none') bgimgs++
    if (el.tagName === 'svg') svgs++
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v)
  return { text: top(txt), bg: top(bg), border: top(bd), imgs, bgimgs, svgs, emoji }
}
const all = { text: new Map(), bg: new Map(), border: new Map() }; let totImg = 0, totSvg = 0, totBgImg = 0, totEmoji = 0
for (const t of uniq.filter((x) => !/sign out|home|^more$/i.test(x))) {
  const h = p.locator('a, button, [role=tab]').filter({ hasText: new RegExp('^\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first()
  if (!(await h.count())) { console.log('skip ' + t); continue }
  await h.click({ timeout: 5000 }).catch((e) => console.log('click fail ' + t)); await p.waitForTimeout(1500)
  const m = await p.evaluate(MEASURE)
  console.log(`\n## ${t}: text colours ${m.text.length}, backgrounds ${m.bg.length}, borders ${m.border.length}, img ${m.imgs.length}, css bg-images ${m.bgimgs}, svg ${m.svgs}, emoji ${m.emoji}`)
  console.log('  text: ' + m.text.slice(0, 10).join('  '))
  console.log('  bg:   ' + m.bg.slice(0, 10).join('  '))
  if (m.imgs.length) console.log('  img:  ' + m.imgs.slice(0, 8).join(' ; '))
  for (const k of ['text', 'bg', 'border']) for (const x of m[k]) { const [c, n] = x.split('×'); all[k].set(c, (all[k].get(c) || 0) + +n) }
  totImg += m.imgs.length; totSvg += m.svgs; totBgImg += m.bgimgs; totEmoji += m.emoji
}
const ex = await p.evaluate(() => Object.fromEntries(Object.entries(window.__ex || {}).map(([k, v]) => [k, [...v].slice(0, 8)])))
for (const [k, v] of Object.entries(ex).sort()) console.log('EX ' + k + ' :: ' + v.join(' , '))
for (const [k, v] of await p.evaluate(() => [...(window.__low || new Map())])) console.log('LOW ' + k + ' :: ' + v)
console.log(`\nTOTAL distinct: text ${all.text.size}, backgrounds ${all.bg.size}, borders ${all.border.size}; img ${totImg}, svg ${totSvg}, css bg-images ${totBgImg}, emoji ${totEmoji}`)
for (const k of ['text', 'bg', 'border']) console.log(k + ': ' + [...all[k]].sort((a, b) => b[1] - a[1]).map(([c, n]) => c + '×' + n).join('  '))
await b.close()
