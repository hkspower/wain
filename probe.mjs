import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const log = (...a) => console.log(a.join(' '))
const J = (o) => JSON.stringify(o)
// ASCII transliteration of Arabic so the log (which escapes non-ASCII) stays readable.
const TRM = {}
'0627A 0623O 0625I 0622M 0621Q 0624W 0626J 0628b 0629p 062At 062Bv 062Cj 062DH 062Ex 062Fd 0630* 0631r 0632z 0633s 0634C 0635S 0636D 0637T 0638Z 0639E 063Ag 0641f 0642q 0643k 0644l 0645m 0646n 0647h 0648w 064Ay 0649Y 064BF 064CN 064DK 064Ea 064Fu 0650i 0651~ 0652o 0640_ 060C` 061F@ 061B# 066A!'.split(' ').forEach((e) => { TRM[String.fromCharCode(parseInt(e.slice(0, 4), 16))] = e.slice(4) })
const tr = (s) => Array.from(String(s)).map((ch) => {
  const c = ch.codePointAt(0)
  if (c < 128) return ch
  if (TRM[ch]) return TRM[ch]
  if (c >= 0x660 && c <= 0x669) return '^' + (c - 0x660)
  return '{' + c.toString(16) + '}'
}).join('')
const CF = Object.assign({ langs: ['ar'], vps: [[1280, 800]], steps: ['home'], w: true, c: true, f: true, h: true, pal: true }, JSON.parse(process.env.CFG || '{}'))

// shared helpers inside every page
const HELP = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { cx.fillStyle = '#010203'; cx.fillStyle = c; cx.clearRect(0, 0, 1, 1); cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)] }
  const hex = (c) => { const q = rgba(c); return '#' + q.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') + (q[3] < 1 ? '/' + q[3] : '') }
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const x = lum(a[0], a[1], a[2]), y = lum(b[0], b[1], b[2]); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) }
  const stackBg = (el) => { let bg = [255, 255, 255]; let art = false; const chain = []; for (let n = el; n; n = n.parentElement) chain.push(n); chain.reverse(); for (const n of chain) { const cs = getComputedStyle(n); if (cs.backgroundImage !== 'none') art = true; const c = rgba(cs.backgroundColor); if (c[3] > 0) bg = over(c, bg) } return { bg, art } }
  window.__ls = { rgba, hex, lum, ratio, over, stackBg }
}

const TEXTS = (scope) => {
  const root = (scope && document.querySelector(scope)) || document.body
  const out = []; const seen = new Set()
  const add = (k, s) => { s = (s || '').replace(/\s+/g, ' ').trim(); if (!s) return; const key = k + '|' + s; if (seen.has(key)) return; seen.add(key); out.push([k, s.slice(0, 400)]) }
  if (!scope) { add('title', document.title); const md = document.querySelector('meta[name=description]'); if (md) add('meta', md.content) }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = tw.nextNode())) {
    const el = n.parentElement
    if (!el || el.closest('script,style,noscript,template')) continue
    if (!n.textContent.trim()) continue
    let b = el
    while (b.parentElement && b !== root && /^inline|^contents/.test(getComputedStyle(b).display)) b = b.parentElement
    const vis = el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    add(vis ? 'T' : 'H', b.innerText && vis ? b.innerText : n.textContent)
  }
  const at = [['alt', 'alt'], ['aria-label', 'l'], ['placeholder', 'p'], ['title', 't'], ['aria-description', 'd']]
  for (const el of root.querySelectorAll('[alt],[aria-label],[placeholder],[title],[aria-description]')) for (const [a, k] of at) if (el.hasAttribute(a)) add('@' + k, el.getAttribute(a))
  for (const el of root.querySelectorAll('input[type=submit],input[type=button]')) add('@v', el.value)
  return out
}

const COLLECT = (scope) => {
  const L = window.__ls
  const root = (scope && document.querySelector(scope)) || document.body
  const items = []; const fields = []; const pal = { b: {}, o: {} }; const links = []
  const fns = []; const ffs = []; window.__lsFns = fns; window.__lsFfs = ffs
  const P = (it, fn, el) => { const st = L.stackBg(el); it.eb = st.bg; it.art = st.art ? 1 : 0; items.push(it); fns.push(fn) }
  const effOp = (el) => { let o = 1; for (let a = el; a; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o }
  const sig = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 3).join('.')
  const clipped = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.clip && cs.clip !== 'auto') return true; if (cs.clipPath && /inset\(\s*50%/.test(cs.clipPath)) return true; if (/sr-only/.test(a.className || '')) return true; const r = a.getBoundingClientRect(); if (r.width <= 2 && r.height <= 2 && cs.overflow !== 'visible') return true } return false }
  const W = document.documentElement.scrollWidth
  const ok = (r) => r.width > 1 && r.height > 1 && r.right > 0 && r.left < W && r.bottom > 0
  const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = tw.nextNode())) {
    const s = n.textContent.trim(); if (!s) continue
    const el = n.parentElement
    if (!el || el.closest('script,style,noscript,template,[aria-hidden="true"],option')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const op = effOp(el); if (op < 0.02) continue
    if (clipped(el)) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    const rs = [...rg.getClientRects()].filter(ok)
    if (!rs.length) continue
    const node = n
    P({ k: 't', s: s.slice(0, 26), e: sig(el), c: L.rgba(cs.color), op: +op.toFixed(2), px: parseFloat(cs.fontSize), w: +cs.fontWeight, l: el.closest('a') ? 1 : 0, d: el.closest('[disabled],[aria-disabled="true"]') ? 1 : 0, r: rs.slice(0, 3).map(R) }, () => { const g = document.createRange(); g.selectNodeContents(node); return [...g.getClientRects()].filter(ok).slice(0, 3).map(R) }, el)
  }
  for (const sv of root.querySelectorAll('button svg, a svg, [role=button] svg')) {
    const host = sv.closest('button,a,[role=button]'); if (host.textContent.trim()) continue
    const r = sv.getBoundingClientRect(); const cs = getComputedStyle(sv)
    if (!ok(r) || cs.visibility === 'hidden' || effOp(sv) < 0.02 || clipped(sv)) continue
    const col = (cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) ? cs.stroke : cs.fill
    if (col === 'none') continue
    P({ k: 'i', s: (host.getAttribute('aria-label') || '').slice(0, 20), e: sig(host), c: L.rgba(col), op: +effOp(sv).toFixed(2), px: 24, w: 400, l: 0, d: host.matches(':disabled,[aria-disabled="true"]') ? 1 : 0, r: [R(r)] }, () => [R(sv.getBoundingClientRect())], host)
  }
  const fsig = new Set()
  for (const f of root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')) {
    const r = f.getBoundingClientRect(); if (!ok(r)) continue
    const cs = getComputedStyle(f)
    const inner = [Math.round(r.left + 10), Math.round(r.top + 8), Math.max(4, Math.round(r.width - 20)), Math.max(4, Math.round(r.height - 16))]
    const innerFn = () => { const q = f.getBoundingClientRect(); return [[Math.round(q.left + 10), Math.round(q.top + 8), Math.max(4, Math.round(q.width - 20)), Math.max(4, Math.round(q.height - 16))]] }
    if (f.placeholder) { const pc = getComputedStyle(f, '::placeholder'); P({ k: 'p', s: f.placeholder.slice(0, 22), e: sig(f), c: L.rgba(pc.color), op: +effOp(f).toFixed(2), px: parseFloat(cs.fontSize), w: +cs.fontWeight, l: 0, d: f.disabled ? 1 : 0, r: [inner] }, innerFn, f) }
    const fs = sig(f); if (!fsig.has(fs)) { fsig.add(fs); P({ k: 'f', s: 'field:' + f.type, e: fs, c: L.rgba(cs.color), op: 1, px: parseFloat(cs.fontSize), w: +cs.fontWeight, l: 0, d: f.disabled ? 1 : 0, r: [inner] }, innerFn, f) }
    fields.push({ e: sig(f), t: f.type, n: (f.name || f.id || '').slice(0, 16), r: R(r), bw: parseFloat(cs.borderTopWidth) || 0 })
    ffs.push(() => R(f.getBoundingClientRect()))
  }
  const addPal = (m, key, e) => { const x = m[key] || (m[key] = { n: 0, e }); x.n++ }
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el); if (cs.display === 'none') continue
    const bgc = cs.backgroundColor
    if (bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') { const r = el.getBoundingClientRect(); if (r.width > 8 && r.height > 8) addPal(pal.b, L.hex(bgc), sig(el)) }
    for (const sd of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + sd + 'Width']) > 0 && cs['border' + sd + 'Style'] !== 'none') { const h = L.hex(cs['border' + sd + 'Color']); if (!h.endsWith('/0')) addPal(pal.o, h, sig(el)) }
  }
  for (const a of root.querySelectorAll('p a, li a, td a, dd a')) {
    const par = a.closest('p,li,td,dd'); if (!par) continue
    if (par.textContent.replace(a.textContent, '').trim().length < 12) continue
    const cs = getComputedStyle(a); const ps = getComputedStyle(par)
    links.push({ s: a.textContent.trim().slice(0, 22), c: L.hex(cs.color), pc: L.hex(ps.color), u: cs.textDecorationLine, fw: cs.fontWeight + '/' + ps.fontWeight })
  }
  return { items, fields, pal, links: links.slice(0, 8) }
}

const HIDE = () => new Promise((res) => {
  const st = document.createElement('style'); st.id = 'ls-hide'
  st.textContent = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important}'
  document.head.appendChild(st)
  requestAnimationFrame(() => requestAnimationFrame(() => res({ items: window.__lsFns.map((f) => { try { return f() } catch (e) { return [] } }), fields: window.__lsFfs.map((f) => { try { return f() } catch (e) { return null } }) })))
})

const MEASURE = async ([items, fields, url, ox, oy]) => {
  const L = window.__ls
  const img = new Image(); img.src = url; await img.decode()
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
  const grab = (x, y, w, h) => { x = Math.round(x - ox); y = Math.round(y - oy); w = Math.round(w); h = Math.round(h); const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(cv.width, x + w), y1 = Math.min(cv.height, y + h); if (x1 <= x0 || y1 <= y0) return null; return { d: cx.getImageData(x0, y0, x1 - x0, y1 - y0), w: x1 - x0, h: y1 - y0 } }
  const med = (a) => { a = a.slice().sort((p, q) => p - q); return a[Math.floor(a.length / 2)] }
  const hx = (v) => '#' + v.map((q) => q.toString(16).padStart(2, '0')).join('')
  const bad = []; let n = 0; let minR = 99; let misN = 0
  for (const it of items) {
    const px = []
    const pushRect = (r, ring) => {
      const rects = ring ? [[r[0] - 5, r[1] - 5, r[2] + 10, 3], [r[0] - 5, r[1] + r[3] + 2, r[2] + 10, 3], [r[0] - 5, r[1] - 2, 3, r[3] + 4], [r[0] + r[2] + 2, r[1] - 2, 3, r[3] + 4]] : [r]
      for (const q of rects) {
        const g = grab(q[0], q[1], q[2], q[3]); if (!g) continue
        const step = Math.max(1, Math.floor(Math.sqrt((g.w * g.h) / 900)))
        for (let y = 0; y < g.h; y += step) for (let x = 0; x < g.w; x += step) { const o = (y * g.w + x) * 4; px.push([g.d.data[o], g.d.data[o + 1], g.d.data[o + 2]]) }
      }
    }
    for (const r of it.r) pushRect(r, it.k === 'i')
    if (!px.length) continue
    const a = it.c[3] * it.op
    let rs = px.map((b) => L.ratio(L.over([it.c[0], it.c[1], it.c[2], a], b), b)).sort((p, q) => p - q)
    const bgm = [med(px.map((b) => b[0])), med(px.map((b) => b[1])), med(px.map((b) => b[2]))]
    let mis = 0
    if (!it.art && it.eb && Math.max(Math.abs(bgm[0] - it.eb[0]), Math.abs(bgm[1] - it.eb[1]), Math.abs(bgm[2] - it.eb[2])) > 28) { mis = 1; misN++; const rr = L.ratio(L.over([it.c[0], it.c[1], it.c[2], a], it.eb), it.eb); rs = [rr, rr, rr] }
    const p10 = rs[Math.floor(rs.length * 0.1)]; const md = rs[Math.floor(rs.length / 2)]
    n++; if (p10 < minR) minR = p10
    const need = it.k === 'i' ? 3 : ((it.px >= 24 || (it.w >= 700 && it.px >= 18.66)) ? 3 : 4.5)
    if (p10 + 0.005 < need) {
      const bg = mis ? it.eb : bgm
      bad.push({ mis, k: it.k, s: it.s, e: it.e, fg: hx(L.over([it.c[0], it.c[1], it.c[2], a], bg)), bg: hx(bg), px: Math.round(it.px), w: it.w, need, p10: +p10.toFixed(2), md: +md.toFixed(2), l: it.l, d: it.d, sp: +(rs[rs.length - 1] - rs[0]).toFixed(1) })
    }
  }
  const fb = []
  for (const f of fields) {
    const cxm = f.r[0] + f.r[2] / 2
    const gp = (x, y) => { const g = grab(x, y, 1, 1); return g ? [g.d.data[0], g.d.data[1], g.d.data[2]] : null }
    const out = gp(cxm, f.r[1] - 4); if (!out) continue
    let best = 1; const bw = Math.max(1, Math.round(f.bw))
    for (let dy = -1; dy <= bw; dy++) { const e = gp(cxm, f.r[1] + dy); if (e) best = Math.max(best, L.ratio(e, out)) }
    const inn = gp(cxm, f.r[1] + bw + 4); const fill = inn ? L.ratio(inn, out) : 1
    const edge = Math.max(best, fill)
    if (edge < 3) fb.push({ e: f.e, t: f.t, n: f.n, edge: +edge.toFixed(2), bw: f.bw })
  }
  return { bad, n, minR: +minR.toFixed(2), fb, misN }
}

const META = () => ({
  canon: (document.querySelector('link[rel=canonical]') || {}).href,
  alt: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => l.hreflang + '=' + l.href.replace('https://www.sporta.com.kw', '')),
  og: ['og:title', 'og:description', 'og:locale'].map((p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.content.slice(0, 200) : '' }),
  ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent.replace(/\s+/g, ' ').slice(0, 1500)),
})

const FOCUS = () => {
  const L = window.__ls
  const el = document.activeElement
  if (!el || el === document.body) return null
  if (!el.__lsid) el.__lsid = Math.random().toString(36).slice(2)
  const cs = getComputedStyle(el)
  const oc = L.rgba(cs.outlineColor)
  const hasOl = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && oc[3] > 0
  const par = el.parentElement ? L.stackBg(el.parentElement) : { bg: [255, 255, 255], art: false }
  let ratio = null
  if (hasOl) ratio = +L.ratio(L.over(oc, par.bg), par.bg).toFixed(2)
  return { id: el.__lsid, e: el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 3).join('.'), fv: el.matches(':focus-visible'), os: cs.outlineStyle, ow: cs.outlineWidth, oc: L.hex(cs.outlineColor), oo: cs.outlineOffset, bs: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 70), r: ratio, art: par.art, t: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18), y: Math.round(el.getBoundingClientRect().top) }
}

const MARKBTNS = () => {
  const L = window.__ls
  const seen = new Set(); const out = []
  let i = 0
  for (const el of document.querySelectorAll('a.btn, button.btn, a[class*="btn-"], button[class*="btn-"], button[type=submit], .btn')) {
    if (el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect(); if (r.width < 20 || r.height < 20 || r.right < 0 || r.left > innerWidth) continue
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
    const cs = getComputedStyle(el)
    const key = [...el.classList].slice(0, 4).join('.') + cs.backgroundColor + cs.color
    if (seen.has(key)) continue; seen.add(key)
    el.setAttribute('data-ls-h', String(i))
    out.push({ i, e: el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 4).join('.'), s: el.textContent.trim().slice(0, 18) })
    if (++i >= 7) break
  }
  return out
}
const BTNSTATE = (i) => {
  const L = window.__ls
  const el = document.querySelector('[data-ls-h="' + i + '"]'); if (!el) return null
  const cs = getComputedStyle(el); const st = L.stackBg(el)
  const fg = L.rgba(cs.color)
  return { fg: L.hex(cs.color), bg: L.hex(cs.backgroundColor), stack: '#' + st.bg.map((v) => v.toString(16).padStart(2, '0')).join(''), r: +L.ratio(L.over(fg, st.bg), st.bg).toFixed(2), bd: L.hex(cs.borderTopColor), bw: cs.borderTopWidth, tx: cs.textDecorationLine, art: st.art }
}

// ---------- node side ----------
const br = await chromium.launch({ args: ['--no-sandbox'] })
const classify = (h) => {
  const m = /^#([0-9a-f]{6})/.exec(h); if (!m) return '?'
  const r = parseInt(m[1].slice(0, 2), 16) / 255, g = parseInt(m[1].slice(2, 4), 16) / 255, b = parseInt(m[1].slice(4, 6), 16) / 255
  if (['e0561c', 'b8430f', 'ff7b17', '171a1e', 'e2dbce', 'ffffff', '000000'].includes(m[1])) return 'BRAND'
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let hh = 0
  if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360 }
  if (s < 0.12) return 'grey'
  if (hh >= 195 && hh <= 270 && s < 0.5) return 'SLATE(h' + Math.round(hh) + ')'
  if (hh >= 8 && hh <= 38 && s >= 0.45) return 'ORANGE-nonbrand(h' + Math.round(hh) + ')'
  if (hh >= 15 && hh <= 60 && s < 0.45) return 'warm'
  return 'HUE' + Math.round(hh)
}
const chunk = (arr, n) => { const o = []; let cur = ''; for (const s of arr) { if (cur.length + s.length > n) { o.push(cur); cur = '' } cur += s + ' || ' } if (cur) o.push(cur); return o }

for (const lang of CF.langs) for (const [vw, vh] of CF.vps) {
  const tag = lang + vw
  const ctx = await br.newContext({ viewport: { width: vw, height: vh }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', colorScheme: CF.dark ? 'dark' : 'light' })
  await ctx.route('**/*', (r) => { const q = r.request(); if (!['GET', 'HEAD'].includes(q.method()) || /\/(backends|knet\/|pay\/)/.test(q.url())) return r.abort(); return r.continue() })
  await ctx.addInitScript(HELP)
  if (CF.themeKey) await ctx.addInitScript((k) => { try { localStorage.setItem(k, 'dark') } catch (e) { } }, CF.themeKey)
  const pg = await ctx.newPage()
  let net = {}
  pg.on('response', (r) => { const u = r.url(); if (u.indexOf('sporta.com.kw/api') > -1) net[r.request().method() + ' ' + u.replace(B, '').slice(0, 80) + ' ' + r.status()] = 1 })
  pg.on('requestfailed', (r) => { const u = r.url(); if (u.indexOf('sporta.com.kw') > -1) net['FAIL ' + r.method() + ' ' + u.replace(B, '').slice(0, 80)] = 1 })
  const netLog = (label) => { const k = Object.keys(net); if (k.length) log('NET', tag, label, J(k.slice(0, 14))); net = {} }
  const U = (p) => B + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')
  const go = async (p) => { const r = await pg.goto(U(p), { waitUntil: 'load', timeout: 90000 }).catch(() => null); await pg.waitForTimeout(1800); return r ? r.status() : 'ERR' }
  const seenW = new Set(); const cfAgg = {}; const palAgg = { t: {}, b: {}, o: {} }; const focAgg = {}; const fbAll = []
  let prod = null
  const settle = async () => {
    await pg.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)) } window.scrollTo(0, 0); await document.fonts.ready; await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 2500) }))) })
    await pg.waitForTimeout(350)
  }
  const info = async (label, st) => {
    const i = await pg.evaluate(() => ({ h1: (document.querySelector('h1') || {}).textContent, ov: document.documentElement.scrollWidth - innerWidth, dir: document.documentElement.dir, hl: document.documentElement.lang, th: document.documentElement.dataset.theme, bodyBg: getComputedStyle(document.body).backgroundColor, bodyCol: getComputedStyle(document.body).color }))
    if (CF.meta) { const m = await pg.evaluate(META); log('META', tag, label, tr(J({ c: m.canon, a: m.alt, og: m.og }))); for (const l of m.ld) log('LD', tag, label, tr(l)) }
    log('PG', tag, label, 'st=' + st, 'ov=' + i.ov, 'dir=' + i.dir + '/' + i.hl, 'th=' + i.th, 'bodyBg=' + i.bodyBg, 'h1=' + tr((i.h1 || '').trim().slice(0, 50)))
  }
  const words = async (label, scope) => {
    const ws = await pg.evaluate(TEXTS, scope || null)
    const fresh = []; let dup = 0
    for (const [k, s] of ws) { const key = k + '|' + s; if (seenW.has(key)) { dup++; continue } seenW.add(key); fresh.push((k === 'T' ? '' : k + ':') + tr(s)) }
    log('W', tag, label, 'n=' + ws.length, 'new=' + fresh.length, 'seenBefore=' + dup)
    for (const c of chunk(fresh, 3200)) log('W|' + tag + '|' + label, c)
    // raw-string checks
    const ar = lang === 'ar'
    const flags = []
    for (const [k, s] of ws) {
      if (k === 'H' && !ar) continue
      if (ar) {
        const lat = s.match(/[A-Za-z][A-Za-z'\-.]*/g)
        if (lat) flags.push('LATIN[' + lat.slice(0, 5).join(',') + ']:' + tr(s).slice(0, 70))
        if (/اً|اٌ|اٍ/.test(s)) flags.push('TANWIN-ORDER:' + tr(s).slice(0, 70))
        if (/[؀-ۿ]\s?[,;?]|[,;?]\s?[؀-ۿ]/.test(s)) flags.push('LATIN-PUNCT:' + tr(s).slice(0, 70))
        if (/ـ/.test(s)) flags.push('TATWEEL:' + tr(s).slice(0, 50))
        if (/  | /.test(s)) flags.push('SPACE:' + tr(s).slice(0, 50))
      } else if (/[؀-ۿ]/.test(s)) flags.push('ARABIC-IN-EN:' + tr(s).slice(0, 70))
      if (/lorem|ipsum|todo|tbd|xxx|dummy|sample text|coming soon|placeholder/i.test(s)) flags.push('PLACEHOLDER:' + tr(s).slice(0, 70))
    }
    const all = ws.filter((x) => x[0] !== 'H').map((x) => x[1]).join(' ')
    const ai = (all.match(/[٠-٩]/g) || []).length, wi = (all.match(/[0-9]/g) || []).length
    flags.push('DIGITS arabicIndic=' + ai + ' western=' + wi)
    const dupT = {}; for (const [k, s] of ws) if (k === 'T' && s.length > 14) dupT[s] = (dupT[s] || 0) + 1
    for (const s in dupT) if (dupT[s] > 1) flags.push('DUP x' + dupT[s] + ':' + tr(s).slice(0, 60))
    for (const c of chunk([...new Set(flags)], 3200)) log('WF|' + tag + '|' + label, c)
  }
  const aggCF = (label, bad) => {
    for (const b of bad) {
      const key = [b.k, b.fg, b.bg, b.px, b.e, b.d, b.mis].join('|')
      const x = cfAgg[key] || (cfAgg[key] = { pages: new Set(), n: 0, ex: [], b })
      x.pages.add(label); x.n++; if (x.ex.length < 2 && !x.ex.includes(tr(b.s))) x.ex.push(tr(b.s))
      if (b.p10 < x.b.p10) x.b = b
    }
  }
  const scan = async (label, scope, opts) => {
    opts = opts || {}
    await settle()
    if (CF.w && !opts.nowords) await words(label, scope)
    await pg.waitForTimeout(250)
    const col = await pg.evaluate(COLLECT, scope || null)
    if (CF.pal) {
      for (const it of col.items) { const h = '#' + it.c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') + (it.c[3] * it.op < 0.99 ? '/' + (it.c[3] * it.op).toFixed(2) : ''); const x = palAgg.t[h] || (palAgg.t[h] = { n: 0, e: it.e, pg: new Set() }); x.n++; x.pg.add(label) }
      for (const [m, src] of [['b', col.pal.b], ['o', col.pal.o]]) for (const h in src) { const x = palAgg[m][h] || (palAgg[m][h] = { n: 0, e: src[h].e, pg: new Set() }); x.n += src[h].n; x.pg.add(label) }
    }
    if (col.links.length) log('LNK', tag, label, J(col.links.map((l) => [tr(l.s), l.c, l.pc, l.u, l.fw])))
    if (!CF.c) return
    if (!col.items.length) { log('CP', tag, label, 'no items'); return }
    const fresh = await pg.evaluate(HIDE)
    col.items.forEach((it, i) => { it.r = fresh.items[i] || [] })
    col.items = col.items.filter((it) => it.r.length)
    col.fields.forEach((f, i) => { if (fresh.fields[i]) f.r = fresh.fields[i] })
    let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0
    const grow = (r) => { x0 = Math.min(x0, r[0] - 8); y0 = Math.min(y0, r[1] - 8); x1 = Math.max(x1, r[0] + r[2] + 8); y1 = Math.max(y1, r[1] + r[3] + 8) }
    for (const it of col.items) for (const r of it.r) grow(r)
    for (const f of col.fields) grow(f.r)
    x0 = Math.max(0, x0); y0 = Math.max(0, y0)
    const dims = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])
    y1 = Math.min(y1, dims[1], 15000)
    const buf = await pg.screenshot({ fullPage: true, clip: { x: x0, y: y0, width: Math.min(x1, dims[0]) - x0, height: y1 - y0 }, type: 'png' })
    await pg.evaluate(() => { const s = document.getElementById('ls-hide'); if (s) s.remove() })
    const res = await pg.evaluate(MEASURE, [col.items, col.fields, 'data:image/png;base64,' + buf.toString('base64'), x0, y0]).catch((e) => ({ err: String(e.message).slice(0, 200) }))
    if (res.err) { log('CERR', tag, label, res.err); return }
    aggCF(label, res.bad)
    for (const f of res.fb) fbAll.push(label + ':' + f.e + ':' + f.t + ':' + f.n + ':' + f.edge)
    log('CP', tag, label, 'measured=' + res.n, 'min_p10=' + res.minR, 'fail=' + res.bad.length, 'fieldEdges<3=' + res.fb.length, 'items=' + col.items.length, 'stackFallback=' + res.misN, 'png=' + Math.round(buf.length / 1024) + 'k')
  }
  const focusPass = async (label, nTabs) => {
    if (!CF.f) return
    await pg.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur() })
    const ids = new Set(); let ok = 0, noInd = [], low = [], auto = 0
    for (let i = 0; i < nTabs; i++) {
      await pg.keyboard.press('Tab')
      await pg.waitForTimeout(260)
      const r = await pg.evaluate(FOCUS).catch(() => null)
      if (!r) continue
      if (ids.has(r.id)) break
      ids.add(r.id)
      const key = [r.e, r.os, r.ow, r.oc, r.bs].join('|')
      if (!focAgg[key]) focAgg[key] = { n: 0, ex: tr(r.t), pg: new Set(), r }
      focAgg[key].n++; focAgg[key].pg.add(label)
      const none = (r.os === 'none' || parseFloat(r.ow) <= 0 || r.oc.endsWith('/0')) && r.bs === 'none'
      if (none) noInd.push(r.e + '(' + tr(r.t) + ')'); else if (r.os === 'auto') auto++; else if (r.r !== null && r.r < 3 && !r.art) low.push(r.e + ' ' + r.oc + ' ' + r.r); else ok++
    }
    log('FOC', tag, label, 'tabs=' + ids.size, 'ok=' + ok, 'uaAuto=' + auto, 'noIndicator=' + J(noInd.slice(0, 8)), 'lowContrast=' + J(low.slice(0, 6)))
  }
  const hoverPass = async (label) => {
    if (!CF.h) return
    const bts = await pg.evaluate(MARKBTNS)
    const rows = []
    for (const b of bts) {
      const before = await pg.evaluate(BTNSTATE, b.i); if (!before) continue
      let after = null
      try { await pg.hover('[data-ls-h="' + b.i + '"]', { timeout: 3500 }); await pg.waitForTimeout(350); after = await pg.evaluate(BTNSTATE, b.i) } catch (e) { after = { err: 'nohover' } }
      await pg.mouse.move(2, 2)
      rows.push([b.e.slice(0, 40), tr(b.s), 'rest', before.fg, 'on', before.bg === '#00000000' || before.bg.endsWith('/0') ? before.stack : before.bg, before.r, 'bd', before.bd + '/' + before.bw, 'HOVER', after && !after.err ? [after.fg, 'on', after.bg.endsWith('/0') ? after.stack : after.bg, after.r, after.tx].join(' ') : 'n/a'].join(' '))
    }
    log('HOV', tag, label, J(rows))
  }
  const chooseSize = () => pg.evaluate(() => {
    const g = [...document.querySelectorAll('[role=group],[role=radiogroup]')].find((x) => /size|مقاس/i.test(x.getAttribute('aria-label') || ''))
    const b = g && [...g.querySelectorAll('button,[role=radio]')].find((x) => !x.disabled && x.getAttribute('aria-disabled') !== 'true')
    if (b) { b.click(); return b.textContent.trim() }
    return null
  })

  try {
    for (const step of CF.steps) {
      if (step === 'home') {
        const st = await go('/')
        await pg.evaluate(() => { const p = [...document.querySelectorAll('button')].find((x) => /pause|إيقاف/i.test(x.getAttribute('aria-label') || '')); if (p) p.click() })
        await info('home', st)
        const dots = await pg.evaluate(() => document.querySelectorAll('button[class*="group/dot"]').length)
        if (CF.hero && dots) {
          for (let i = 0; i < dots; i++) {
            await pg.evaluate((k) => { document.querySelectorAll('button[class*="group/dot"]')[k].click() }, i)
            await pg.waitForTimeout(1100)
            const sc = await pg.evaluate(() => { let el = document.querySelector('button[class*="group/dot"]'); while (el && el.getBoundingClientRect().height < 250) el = el.parentElement; if (!el) return null; el.setAttribute('data-ls-scope', '1'); return '[data-ls-scope="1"]' })
            if (sc) await scan('hero' + (i + 1), sc, { nowords: true })
          }
        }
        await scan('home')
        await focusPass('home', 24)
        await hoverPass('home')
      } else if (step === 'shop') {
        const st = await go('/shop'); await info('shop', st)
        prod = await pg.evaluate(() => { const b = [...document.querySelectorAll('.catalog-card-add')].find((x) => !x.disabled); if (!b) return null; let el = b; while (el && !el.querySelector('a[href^="/product"]')) el = el.parentElement; const a = el && el.querySelector('a[href^="/product"]'); return a ? a.getAttribute('href') : null })
        log('PROD', tag, prod)
        await scan('shop')
        await focusPass('shop', 14)
      } else if (step === 'product') {
        const st = await go(CF.prod || prod || '/product/cloudsoft-jacket-army-green'); await info('product', st)
        const sz = await chooseSize(); log('SIZE', tag, sz)
        await pg.waitForTimeout(500)
        await scan('product')
        await focusPass('product', 30)
        await hoverPass('product')
      } else if (step === 'drawer') {
        const add = await pg.evaluate(() => {
          const no = /pay|checkout|order|buy|now|ادفع|اطلب|إتمام|اشتر|الآن/i
          const yes = /\badd\b|bag|cart|حقيب|سلة|أضف/i
          const b = [...document.querySelectorAll('button.btn-primary')].find((x) => !x.disabled && !x.closest('header,footer') && yes.test(x.textContent) && !no.test(x.textContent))
          if (b) { b.click(); return b.textContent.trim() }
          return null
        })
        log('ADD', tag, tr(add || 'NONE'))
        await pg.waitForTimeout(1200)
        const open = await pg.evaluate(() => { const d = document.querySelector('.campaign-cart-drawer'); if (!d) return 'nodrawer'; const r = d.getBoundingClientRect(); return (r.left < innerWidth - 20 && r.right > 20) ? 'open' : 'closed' })
        if (open === 'closed') { await pg.evaluate(() => { const b = document.querySelector('.navbar-cart,[class*="navbar-cart"]'); if (b) b.click() }); await pg.waitForTimeout(1200) }
        log('DRAWER', tag, open, await pg.evaluate(() => { const d = document.querySelector('.campaign-cart-drawer'); const r = d && d.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') : 'none' }), 'ls=' + tr(await pg.evaluate(() => (localStorage.getItem('sporta_cart') || '').slice(0, 200))))
        await scan('drawer', '.campaign-cart-drawer')
        await pg.evaluate(() => { const c = document.querySelector('.campaign-cart-drawer header button'); if (c) c.click() })
        await pg.waitForTimeout(500)
      } else if (step === 'checkout') {
        const st = await go('/checkout'); await info('checkout', st)
        await scan('checkout')
        await focusPass('checkout', 45)
        await hoverPass('checkout')
        // validation on blur only: focus a field, Tab away. No submit, no Enter.
        const flds = await pg.evaluate(() => [...document.querySelectorAll('form input:not([type=hidden]):not([type=checkbox]):not([type=radio])')].filter((i) => i.getBoundingClientRect().width > 0).slice(0, 3).map((i, k) => { i.setAttribute('data-ls-f', String(k)); return i.name || i.id })).catch(() => [])
        for (let k = 0; k < flds.length; k++) { try { await pg.focus('[data-ls-f="' + k + '"]', { timeout: 2000 }); await pg.keyboard.press('Tab') } catch (e) { } }
        await pg.waitForTimeout(500)
        const errs = await pg.evaluate(() => [...document.querySelectorAll('[role=alert],[aria-invalid="true"],.text-red-500,.text-red-600,.text-rose-600,[class*="error"]')].map((e) => (e.getAttribute('aria-invalid') ? 'INVALID:' + (e.name || e.id) : (e.textContent || '').trim().slice(0, 80))).filter(Boolean).slice(0, 8))
        log('CKERR', tag, J(errs.map(tr)))
        // payment options: clicking a radio only changes client state
        const radios = await pg.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map((r, k) => { r.setAttribute('data-ls-r', String(k)); return (r.name || '') + ':' + (r.value || '') + ':' + (r.checked ? 'checked' : '') }))
        log('RADIOS', tag, J(radios))
        for (let k = 0; k < Math.min(radios.length, 5); k++) {
          await pg.evaluate((kk) => { const r = document.querySelector('[data-ls-r="' + kk + '"]'); if (r && !r.checked) { const l = r.closest('label') || r; l.click() } }, k)
          await pg.waitForTimeout(450)
          if (CF.w) await words('checkout-pay' + k)
          if (CF.c && k === Math.min(radios.length, 5) - 1) await scan('checkout-lastpay', null, { nowords: true })
        }
        const sub = await pg.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.closest('header,footer')).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 40) + (b.disabled ? '(DIS)' : '')).slice(0, 14))
        log('CKBTNS', tag, J(sub.map(tr)))
      } else {
        const st = await go('/' + step); await info(step, st)
        await scan(step)
        await focusPass(step, 20)
      }
      netLog(step)
    }
  } catch (e) { log('FAIL', tag, String(e.message).slice(0, 300)) }
  // aggregated outputs
  const cfl = Object.values(cfAgg).sort((a, b) => a.b.p10 - b.b.p10).map((x) => [x.b.k + (x.b.d ? '/DIS' : '') + (x.b.l ? '/LINK' : '') + (x.b.mis ? '/STACK' : ''), x.b.fg, 'on', x.b.bg, x.b.px + 'px/' + x.b.w, 'need' + x.b.need, 'p10=' + x.b.p10, 'med=' + x.b.md, 'spread=' + x.b.sp, x.b.e, '"' + x.ex.join('~') + '"', 'x' + x.n, [...x.pages].join(',')].join(' '))
  log('CF', tag, 'distinctFailures=' + cfl.length)
  for (const c of chunk(cfl, 3000)) log('CF|' + tag, c)
  if (fbAll.length) log('FIELDEDGE', tag, J(fbAll.slice(0, 12)))
  if (CF.pal) for (const m of ['t', 'b', 'o']) {
    const rows = Object.entries(palAgg[m]).sort((a, b) => b[1].n - a[1].n).slice(0, 30).map(([h, x]) => h + '=' + classify(h) + ' x' + x.n + ' ' + x.e.slice(0, 28) + ' [' + [...x.pg].slice(0, 4).join(',') + (x.pg.size > 4 ? '+' + (x.pg.size - 4) : '') + ']')
    for (const c of chunk(rows, 3000)) log('PAL' + m + '|' + tag, c)
  }
  const fl = Object.values(focAgg).map((x) => x.r.e + ' ol=' + x.r.os + '/' + x.r.ow + '/' + x.r.oc + '/off' + x.r.oo + ' bs=' + x.r.bs.slice(0, 40) + ' ratio=' + x.r.r + (x.r.art ? '(art)' : '') + ' x' + x.n + ' "' + x.ex + '" [' + [...x.pg].slice(0, 3).join(',') + ']')
  for (const c of chunk(fl, 3000)) log('FOCAGG|' + tag, c)
  await ctx.close()
}
await br.close()
log('DONE')
