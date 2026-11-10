// TEMP scan (deleted after use)
import { chromium } from 'playwright'
import { ALL as NAMES, addons, serve, KNET, knetSource } from './lib/admin-css-full-page.mjs'
import { readFileSync } from 'node:fs'
const FILES = addons(process.env.CSS ? readFileSync(process.env.CSS, 'utf8') : knetSource())
const ref = { current: FILES }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const VIEWS = [{ id: '320', w: 320, h: 568, touch: true }, { id: '360', w: 360, h: 640, touch: true }, { id: '390', w: 390, h: 844, touch: true }, { id: '768t', w: 768, h: 1024, touch: true }, { id: '1280', w: 1280, h: 800, touch: false }]
const only = process.env.ONLY ? process.env.ONLY.split(',') : NAMES
const scan = () => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const cs = (e) => getComputedStyle(e)
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = cs(e); if (c.visibility === 'hidden' || c.display === 'none') return false; for (let p = e; p; p = p.parentElement) { const q = cs(p); if (q.display === 'none' || q.visibility === 'hidden' || +q.opacity === 0) return false } return true }
  const cls = (e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().replace(/\s+/g, ' ')
  const id = (e) => (e.tagName.toLowerCase() + '.' + cls(e).split(' ').slice(0, 6).join('.')).slice(0, 90)
  const vw = document.documentElement.clientWidth, vh = innerHeight
  const out = { vw, docW: document.documentElement.scrollWidth, over: [], taps: [], labels: [], small: [], contrast: [], modal: [], clip: [] }
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] } const p = m[1].split(/[ ,\/]+/).map(parseFloat); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]) }
  const bgOf = (e) => { let stack = []; for (let p = e; p; p = p.parentElement) { const c = cs(p); if (c.backgroundImage !== 'none' && /gradient/.test(c.backgroundImage)) { const m = c.backgroundImage.match(/rgba?\([^)]+\)/); if (m) { stack.push(parse(m[0])); if (parse(m[0])[3] >= 1) break } } const b = parse(c.backgroundColor); if (b[3] > 0) { stack.push(b); if (b[3] >= 1) break } } let base = [255, 255, 255, 1]; if (document.documentElement.classList.contains('dark') && !stack.some((s) => s[3] >= 1)) base = parse(cs(document.body).backgroundColor)[3] ? parse(cs(document.body).backgroundColor) : [16, 21, 26, 1]; for (const s of stack.reverse()) base = [0, 1, 2].map((i) => s[i] * s[3] + base[i] * (1 - s[3])).concat(1); return base }
  const scrollsX = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const c = cs(p); if (/(auto|scroll|hidden|clip)/.test(c.overflowX) && p !== document.documentElement && p !== document.body) return true } return false }
  $$('body *').forEach((e) => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return
    if (!vis(e)) return
    const r = e.getBoundingClientRect(), c = cs(e)
    if ((r.right > vw + 1 || r.left < -1) && !scrollsX(e) && c.position !== 'fixed' && !e.closest('.sr-only') && !/sr-only/.test(cls(e)) && r.width > 2) out.over.push(id(e) + ' L' + Math.round(r.left) + ' R' + Math.round(r.right))
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
    if (hasText && !e.closest('[class*="__preview"]')) {
      const fs = parseFloat(c.fontSize)
      if (fs < 11.95) out.small.push(id(e) + ' ' + fs.toFixed(1))
      const fg = parse(c.color), bg = bgOf(e); const f2 = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]))
      const L1 = lum(f2), L2 = lum(bg), cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)
      const big = fs >= 24 || (fs >= 18.66 && +c.fontWeight >= 700)
      const dis = e.closest(':disabled, [aria-disabled="true"]')
      if (cr < (big ? 3 : 4.5) && !dis) out.contrast.push(id(e) + ' ' + cr.toFixed(2) + ' fg ' + c.color + ' on ' + bg.map(Math.round).slice(0, 3).join(',') + ' "' + e.textContent.trim().slice(0, 18) + '"')
    }
    if (e.matches('a[href], button, summary, input:not([type=hidden]):not([type=file]), select, textarea, [role="button"]') && !e.closest('[aria-hidden="true"]') && !e.closest('[class*="__preview"]')) {
      const isBox = e.matches('input[type=checkbox], input[type=radio]')
      let w = r.width, h = r.height
      if (isBox) { const l = e.closest('label'); if (l) { const lr = l.getBoundingClientRect(); w = lr.width; h = lr.height } }
      const inline = e.matches('a') && c.display === 'inline'
      if ((w < 43.5 || h < 43.5) && !inline) out.taps.push(id(e) + (isBox ? '[label]' : '') + ' ' + Math.round(w) + 'x' + Math.round(h) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16) + '"')
    }
  })
  $$('[role="dialog"], form.admin-editor-modal, .admin-editor-modal').filter(vis).forEach((m) => { const r = m.getBoundingClientRect(), c = cs(m); let sc = false; for (let p = m; p; p = p.parentElement) { const q = cs(p); if (/(auto|scroll)/.test(q.overflowY) && p.scrollHeight >= p.clientHeight) { sc = true; break } } out.modal.push(id(m) + ' top ' + Math.round(r.top) + ' h ' + Math.round(r.height) + ' vh ' + vh + ' scroll:' + sc + ' ovY ' + c.overflowY + ' maxH ' + c.maxHeight + ' pos ' + c.position) })
  return out
}
const agg = {}
const add = (k, item, where) => { (agg[k] ||= new Map()); const m = agg[k]; if (!m.has(item)) m.set(item, new Set()); m.get(item).add(where) }
for (const v of VIEWS.filter((x) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(x.id))) for (const rtl of (process.env.RTL ? [true] : process.env.LTR ? [false] : [false, true])) for (const dark of (process.env.DARK ? [true] : process.env.LIGHT ? [false] : [false, true])) {
  if (process.env.FAST && (rtl && dark)) continue
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, isMobile: v.touch, hasTouch: v.touch, colorScheme: dark ? 'dark' : 'light', locale: 'en-US' })
  const pg = await ctx.newPage()
  for (const state of only) {
    await pg.goto(`${base}/__fx/${state}?rtl=${rtl ? 1 : 0}&dark=${dark ? 1 : 0}`, { waitUntil: 'load' })
    await pg.evaluate(() => document.fonts.ready)
    const o = await pg.evaluate(scan)
    const where = `${state}@${v.id}${rtl ? 'r' : ''}${dark ? 'd' : ''}`
    if (o.docW > o.vw + 1) add('PAGE-OVERFLOW', `${state} +${o.docW - o.vw}`, `${v.id}${rtl ? 'r' : ''}`)
    const norm = (s) => s.replace(/ L-?\d+ R-?\d+/, '')
    for (const x of o.over) add('over', state + ' ' + norm(x), `${v.id}${rtl ? 'r' : ''}`)
    if (v.touch) for (const x of o.taps) add('taps', state + ' ' + x.replace(/ \d+x\d+/, (m) => m), `${v.id}`)
    for (const x of o.small) add('small', x, state)
    for (const x of o.contrast) add(dark ? 'contrast-dark' : 'contrast-light', x, state)
    if (!rtl && !dark) for (const x of o.modal) add('modal', state + ' ' + x, v.id)
  }
  await ctx.close()
}
for (const [k, m] of Object.entries(agg)) { console.log(`\n##### ${k} (${m.size})`); let n = 0; for (const [item, w] of m) { if (n++ > (+process.env.MAX || 60)) { console.log('  ...'); break } console.log('  ' + item + '   [' + [...w].slice(0, 8).join(' ') + (w.size > 8 ? ' +' + (w.size - 8) : '') + ']') } }
await browser.close(); server.close()
