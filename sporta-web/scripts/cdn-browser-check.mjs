// READ-ONLY "what does a real browser request" probe of the LIVE storefront, for the CDN check (lane: browser).
//
// For each page it records every request through the Chrome DevTools protocol (host, type, status, transfer and
// decoded size, content-encoding, cache-control, served from cache / service worker / network, failures) plus
// the in-page view (images natural vs rendered, fonts, preloads, CSP violations, layout shifts, paint timings).
// Pages: / (Arabic, the default), /shop, the first product page of /shop, /checkout (one throwaway client-side bag item,
// never the order button), /about, /returns, and /?lang=en. Then a second visit of / in the SAME context (warm cache,
// service worker), then / with every host except www.sporta.com.kw aborted (font provider blocked), then / with the
// font provider held for 6 s and then dropped (slow provider).
//
// Safety: GET only. The init script rejects any non-GET fetch / XHR / beacon and cancels form submits in the page, the
// blocked contexts also abort non-GET at the network, and every request the browser makes is logged with its method so
// a violation would show up (NONGET lines). No sign-in, no form is submitted, the order button is never pressed.
// Request budget: about 250 requests to the live site in total (BUDGET), each section is skipped when it is exhausted.
//
// Run on the VPS in mcr.microsoft.com/playwright:v1.49.0-noble (npm i playwright@1.49.0, browsers preinstalled).
// Latency numbers measure the SERVER side network (the VPS), never a visitor in Kuwait.
import { chromium } from 'playwright'

const E = process.env
const BASE = 'https://www.sporta.com.kw'
const HOST = 'www.sporta.com.kw'
const BUDGET = Number(E.BUDGET || 250)
const VW = 390, VH = 844, DPR = 2
const P = (s) => console.log(s)
const T0 = Date.now()
let siteReqs = 0

// ---------------- in-page init: observers, CSP listener, non-GET guard ----------------
const INIT = () => {
  window.__cls = 0; window.__sh = []; window.__lcp = null; window.__fcp = null; window.__csp = []; window.__blocked = []
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue
        window.__cls += e.value
        window.__sh.push([Math.round(e.startTime), +e.value.toFixed(4), (e.sources || []).map((s) => (s.node ? s.node.nodeName + '.' + String(s.node.className && s.node.className.baseVal !== undefined ? s.node.className.baseVal : s.node.className || '').split(' ')[0].slice(0, 22) : '?')).join(',').slice(0, 70)])
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((l) => {
      const es = l.getEntries(); const e = es[es.length - 1]
      window.__lcp = { t: Math.round(e.startTime), url: String(e.url || '').slice(-50), el: e.element ? e.element.tagName + '.' + String(e.element.className && e.element.className.baseVal !== undefined ? e.element.className.baseVal : e.element.className || '').split(' ')[0].slice(0, 26) : '', size: e.size }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = Math.round(e.startTime)
    }).observe({ type: 'paint', buffered: true })
  } catch (e) {}
  try {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push((e.violatedDirective || '') + ' blocked=' + String(e.blockedURI || '').slice(0, 80) + ' doc=' + String(e.documentURI || '').slice(-30))
    }, true)
  } catch (e) {}
  try {
    const of = window.fetch
    window.fetch = function (i, o) {
      const m = String((o && o.method) || (i && i.method) || 'GET').toUpperCase()
      if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { window.__blocked.push(m + ' ' + String((i && i.url) || i).slice(0, 80)); return Promise.reject(new TypeError('blocked non-GET by probe')) }
      return of.apply(this, arguments)
    }
    const xo = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (m) {
      if (String(m).toUpperCase() !== 'GET' && String(m).toUpperCase() !== 'HEAD' && String(m).toUpperCase() !== 'OPTIONS') { window.__blocked.push('XHR ' + m + ' ' + String(arguments[1]).slice(0, 80)); throw new Error('blocked non-GET by probe') }
      return xo.apply(this, arguments)
    }
    navigator.sendBeacon = function (u) { window.__blocked.push('BEACON ' + String(u).slice(0, 80)); return false }
    document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.__blocked.push('SUBMIT') }, true)
  } catch (e) {}
}

// ---------------- CDP network recorder ----------------
async function attachNet(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  const R = new Map(); const list = []
  const keep = ['content-encoding', 'cache-control', 'content-length', 'content-type', 'age', 'via', 'server', 'x-cache', 'cf-cache-status', 'cf-ray', 'x-served-by', 'alt-svc', 'expires', 'etag', 'last-modified', 'x-cache-status', 'x-powered-by', 'content-security-policy', 'strict-transport-security', 'vary', 'x-sporta-cache', 'traefik']
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.redirectResponse) {
      const prev = R.get(e.requestId)
      if (prev) { prev.status = e.redirectResponse.status; prev.t1 = e.timestamp; prev.redir = String((e.redirectResponse.headers || {}).location || (e.redirectResponse.headers || {}).Location || '').slice(0, 80) }
    }
    const rec = { url: e.request.url, method: e.request.method, type: e.type, t0: e.timestamp, init: (e.initiator && e.initiator.type) || '', status: 0, dec: 0, enc: 0, encRecv: 0, h: {}, mem: false, disk: false, sw: false, fail: '', t1: 0, mime: '', proto: '', ip: '', done: false }
    R.set(e.requestId, rec); list.push(rec)
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = R.get(e.requestId); if (!r) return
    const resp = e.response
    r.status = resp.status; r.mime = resp.mimeType || ''; r.proto = resp.protocol || ''; r.ip = resp.remoteIPAddress || ''
    r.disk = !!resp.fromDiskCache; r.sw = !!resp.fromServiceWorker; r.type = e.type || r.type
    const h = {}; for (const k of Object.keys(resp.headers || {})) { const lk = k.toLowerCase(); if (keep.includes(lk)) h[lk] = String(resp.headers[k]).slice(0, 400) }
    r.h = h
    r.tResp = e.timestamp
  })
  cdp.on('Network.dataReceived', (e) => { const r = R.get(e.requestId); if (r) { r.dec += e.dataLength || 0; r.encRecv += e.encodedDataLength || 0 } })
  cdp.on('Network.loadingFinished', (e) => { const r = R.get(e.requestId); if (r) { r.t1 = e.timestamp; r.enc = e.encodedDataLength || 0; r.done = true } })
  cdp.on('Network.loadingFailed', (e) => { const r = R.get(e.requestId); if (r) { r.t1 = e.timestamp; r.fail = (e.errorText || 'failed') + (e.blockedReason ? ' blocked=' + e.blockedReason : '') + (e.canceled ? ' canceled' : '') } })
  cdp.on('Network.requestServedFromCache', (e) => { const r = R.get(e.requestId); if (r) r.mem = true })
  return { list, cdp }
}

const hostOf = (u) => { try { return new URL(u).host } catch (e) { return '?' } }
const pathOf = (u) => { try { const x = new URL(u); return (x.host === HOST ? '' : x.host) + x.pathname + (x.search ? x.search.slice(0, 40) : '') } catch (e) { return u.slice(0, 60) } }
const kb = (n) => Math.round(n / 102.4) / 10
// how was it delivered
const how = (r) => (r.sw ? 'sw' : r.mem ? 'mem' : r.disk ? 'disk' : r.status === 304 ? '304' : r.fail ? 'fail' : 'net')
const transfer = (r) => (how(r) === 'net' || how(r) === '304' ? (r.enc || r.encRecv || 0) : 0)
const nominal = (r) => Math.max(r.dec || 0, Number((r.h || {})['content-length'] || 0), r.enc || 0)
const isText = (r) => /text|json|javascript|svg|xml|manifest/i.test(r.mime || '')

function summarise(tag, list, t0abs) {
  const L = list.filter((r) => r.url.indexOf('data:') !== 0 && r.url.indexOf('blob:') !== 0)
  const nData = list.length - L.length
  const site = L.filter((r) => hostOf(r.url) === HOST), third = L.filter((r) => hostOf(r.url) !== HOST)
  const types = {}
  for (const r of L) { const k = r.type || '?'; if (!types[k]) types[k] = { n: 0, tr: 0, nom: 0 }; types[k].n++; types[k].tr += transfer(r); types[k].nom += nominal(r) }
  const tot = L.reduce((a, r) => a + transfer(r), 0), nom = L.reduce((a, r) => a + nominal(r), 0)
  const delivered = {}
  for (const r of L) delivered[how(r)] = (delivered[how(r)] || 0) + 1
  const hosts = {}
  for (const r of L) { const h = hostOf(r.url); if (!hosts[h]) hosts[h] = { n: 0, tr: 0, types: {}, st: {}, ex: [] }; const o = hosts[h]; o.n++; o.tr += transfer(r); o.types[r.type] = (o.types[r.type] || 0) + 1; o.st[r.status || (r.fail ? 'F' : 0)] = (o.st[r.status || (r.fail ? 'F' : 0)] || 0) + 1; if (o.ex.length < 3) o.ex.push(pathOf(r.url).slice(0, 70)) }
  const lastEnd = Math.max(0, ...L.filter((r) => r.t1).map((r) => (r.t1 - t0abs) * 1000))
  return { L, site, third, nData, types, tot, nom, delivered, hosts, lastEnd: Math.round(lastEnd) }
}

function printSummary(tag, S, extra) {
  const ty = Object.entries(S.types).map(([k, v]) => k + ':' + v.n + '/' + kb(v.tr) + 'KB' + (v.nom > v.tr * 1.3 + 2000 ? '(dec ' + kb(v.nom) + ')' : '')).join(' ')
  P(tag + ' SUM reqs ' + S.L.length + ' (site ' + S.site.length + ', thirdparty ' + S.third.length + ', data: ' + S.nData + ') transfer ' + kb(S.tot) + 'KB decoded ' + kb(S.nom) + 'KB hosts ' + Object.keys(S.hosts).length + ' delivered ' + JSON.stringify(S.delivered) + ' lastReqEnd ' + S.lastEnd + 'ms ' + (extra || ''))
  P(tag + ' TYPES ' + ty)
  for (const [h, o] of Object.entries(S.hosts)) {
    if (h === HOST) continue
    P(tag + ' HOST ' + h + ' n ' + o.n + ' ' + kb(o.tr) + 'KB types ' + JSON.stringify(o.types) + ' status ' + JSON.stringify(o.st) + ' ex ' + o.ex.join(' ; '))
  }
  const top = [...S.L].sort((a, b) => nominal(b) - nominal(a)).slice(0, 10)
  P(tag + ' TOP10 ' + top.map((r) => kb(nominal(r)) + 'KB/tr' + kb(transfer(r)) + ' ' + r.type + ' ' + String(r.mime).replace(/^(image|text|application|font)\//, '') + ' ce=' + ((r.h || {})['content-encoding'] || '-') + ' ' + how(r) + ' ' + pathOf(r.url).slice(-44)).join(' | '))
  // text without compression
  const nc = S.L.filter((r) => hostOf(r.url) === HOST && isText(r) && nominal(r) > 1400 && !(r.h || {})['content-encoding'] && how(r) === 'net' && r.status === 200)
  P(tag + ' UNCOMPRESSED text>1.4KB: ' + (nc.length ? nc.slice(0, 6).map((r) => pathOf(r.url).slice(-40) + ' ' + kb(nominal(r)) + 'KB ' + r.mime).join(' | ') : 'none'))
  // cache-control by type for first-party
  const cc = {}
  for (const r of S.site) { if (r.status === 0 || r.fail) continue; const k = (r.type || '?') + ' | ' + ((r.h || {})['cache-control'] || 'NONE').slice(0, 60); cc[k] = (cc[k] || 0) + 1 }
  P(tag + ' CC ' + Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k, v]) => v + 'x ' + k).join(' ;; '))
  const protos = {}; for (const r of S.L) if (r.proto) protos[r.proto] = (protos[r.proto] || 0) + 1
  P(tag + ' PROTO ' + JSON.stringify(protos) + ' ips ' + JSON.stringify([...new Set(S.L.map((r) => hostOf(r.url) + '=' + r.ip).filter((x) => x.indexOf('=') < x.length - 1))].slice(0, 6)))
  const bad = S.L.filter((r) => r.status >= 400 || r.fail)
  P(tag + ' FAILS ' + (bad.length ? bad.slice(0, 8).map((r) => (r.fail || r.status) + ' ' + r.type + ' ' + pathOf(r.url).slice(-50)).join(' | ') : 'none'))
  const redirs = S.L.filter((r) => r.status >= 300 && r.status < 400)
  if (redirs.length) P(tag + ' REDIRECTS ' + redirs.slice(0, 5).map((r) => r.status + ' ' + pathOf(r.url).slice(-40) + '->' + (r.redir || '')).join(' | '))
}

// ---------------- in-page report ----------------
const DOMREPORT = async () => {
  const out = {}
  const nav = performance.getEntriesByType('navigation')[0] || {}
  out.nav = { dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), ttfb: Math.round(nav.responseStart || 0), docEnd: Math.round(nav.responseEnd || 0), proto: nav.nextHopProtocol, enc: nav.encodedBodySize, dec: nav.decodedBodySize }
  out.fcp = window.__fcp; out.lcp = window.__lcp; out.cls = +window.__cls.toFixed(4); out.sh = window.__sh.slice(0, 5)
  out.csp = window.__csp.slice(0, 6); out.blocked = window.__blocked.slice(0, 5)
  out.lang = document.documentElement.lang + '/' + document.documentElement.dir
  out.title = document.title.slice(0, 50)
  out.textLen = (document.body.innerText || '').length
  const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily.slice(0, 110) + ' w' + getComputedStyle(e).fontWeight : null }
  out.fam = { body: cs('body'), h1: cs('h1'), h2: cs('h2'), btn: cs('button'), a: cs('a'), nav: cs('header') }
  out.fontsStatus = document.fonts.status
  out.fonts = [...document.fonts].map((f) => f.family.replace(/"/g, '') + '/' + f.weight + '/' + f.style + '/' + f.status)
  out.preload = [...document.querySelectorAll('link[rel=preload],link[rel=modulepreload],link[rel=preconnect],link[rel=dns-prefetch],link[rel=prefetch]')].map((l) => l.rel + (l.as ? ':' + l.as : '') + ' ' + String(l.href).replace(location.origin, '').slice(-60) + (l.crossOrigin !== null ? ' cors' : ''))
  out.sheets = [...document.querySelectorAll('link[rel=stylesheet],link[rel=preload][as=style]')].map((l) => l.rel + ' ' + String(l.href).replace(location.origin, '').slice(-70) + ' media=' + (l.media || '-'))
  out.scripts = [...document.querySelectorAll('script[src]')].map((s) => String(s.src).replace(location.origin, '').slice(-50) + (s.async ? ' async' : '') + (s.defer ? ' defer' : '') + (s.type === 'module' ? ' module' : ''))
  const faces = []
  for (const sh of document.styleSheets) {
    try {
      for (const r of sh.cssRules) {
        if (r.constructor.name === 'CSSFontFaceRule') faces.push(r.style.getPropertyValue('font-family').replace(/"/g, '') + ' w' + r.style.getPropertyValue('font-weight') + ' display=' + (r.style.getPropertyValue('font-display') || 'UNSET') + ' src=' + (r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/) || ['', '?'])[1].replace(location.origin, '').slice(-46))
      }
    } catch (e) { faces.push('SHEET-UNREADABLE ' + String(sh.href || 'inline').slice(-40)) }
  }
  out.faces = faces.slice(0, 14)
  // images: displayed vs natural
  const imgs = []
  for (const im of document.images) {
    const b = im.getBoundingClientRect()
    if (!im.currentSrc || im.currentSrc.indexOf('data:') === 0) continue
    imgs.push({ src: im.currentSrc, bw: b.width, bh: b.height, nw: im.naturalWidth, nh: im.naturalHeight, ss: !!im.getAttribute('srcset'), ld: im.getAttribute('loading') || '', vis: b.width > 0 && b.height > 0 })
  }
  out.imgs = imgs
  out.dpr = devicePixelRatio
  // service worker + cache storage
  try {
    out.swCtl = !!(navigator.serviceWorker && navigator.serviceWorker.controller)
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []
    out.swRegs = regs.map((r) => (r.active ? r.active.state : '-') + ' ' + r.scope.replace(location.origin, '') + ' ' + (r.active ? r.active.scriptURL.replace(location.origin, '') : ''))
    const names = window.caches ? await caches.keys() : []
    out.caches = []
    for (const n of names) { const c = await caches.open(n); const ks = await c.keys(); out.caches.push(n + '=' + ks.length + ' [' + ks.slice(0, 12).map((k) => k.url.replace(location.origin, '').slice(-34)).join(',') + ']') }
  } catch (e) { out.swErr = String(e.message).slice(0, 60) }
  return out
}

const REAL = async (urls) => {
  const res = {}
  await Promise.all(urls.map((u) => new Promise((ok) => {
    const im = new Image(); const to = setTimeout(() => ok(), 6000)
    im.onload = () => { res[u] = [im.naturalWidth, im.naturalHeight]; clearTimeout(to); ok() }
    im.onerror = () => { clearTimeout(to); ok() }
    im.src = u
  })))
  return res
}

function imageReport(tag, D, S, real) {
  const byUrl = new Map(); for (const r of S.L) byUrl.set(r.url, r)
  const rows = []
  for (const m of D.imgs) {
    if (m.ss && real[m.src]) { m.nw = real[m.src][0]; m.nh = real[m.src][1] }
    const rec = byUrl.get(m.src)
    const bytes = rec ? nominal(rec) : 0
    const css = m.bw ? m.nw / m.bw : 0
    rows.push({ src: m.src, bw: Math.round(m.bw), bh: Math.round(m.bh), nw: m.nw, nh: m.nh, bytes, mime: rec ? rec.mime : '?', css: +css.toFixed(2), dev: +(css / D.dpr).toFixed(2), ld: m.ld, vis: m.vis })
  }
  const vis = rows.filter((r) => r.vis && r.bw >= 24)
  const over2 = vis.filter((r) => r.css > 2 && r.nw > 0)
  const overDev = vis.filter((r) => r.dev > 2 && r.nw > 0)
  const nonWebp = rows.filter((r) => r.bytes > 40000 && !/webp|avif|svg/.test(r.mime))
  const imgBytes = S.L.filter((r) => r.type === 'Image').reduce((a, r) => a + nominal(r), 0)
  P(tag + ' IMG imgs ' + rows.length + ' visible>=24px ' + vis.length + ' imageBytes ' + kb(imgBytes) + 'KB; natural>2x CSS width: ' + over2.length + '; natural>2x DEVICE px (dpr' + D.dpr + '): ' + overDev.length + '; >40KB and not WebP/AVIF: ' + nonWebp.length)
  const fmt = (r) => pathOf(r.src).slice(-40) + ' box ' + r.bw + 'x' + r.bh + ' nat ' + r.nw + 'x' + r.nh + ' ' + kb(r.bytes) + 'KB ' + String(r.mime).replace('image/', '') + ' x' + r.css + 'css/x' + r.dev + 'dev'
  if (overDev.length) P(tag + ' IMG-OVER-DEVICE ' + overDev.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map(fmt).join(' | '))
  else if (over2.length) P(tag + ' IMG-OVER-CSS(not device) ' + over2.sort((a, b) => b.bytes - a.bytes).slice(0, 4).map(fmt).join(' | '))
  if (nonWebp.length) P(tag + ' IMG-NOT-WEBP ' + nonWebp.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map(fmt).join(' | '))
}

// ---------------- context helpers ----------------
async function newCtx(browser, opts) {
  opts = opts || {}
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, locale: opts.lang === 'en' ? 'en-US' : 'ar-KW', timezoneId: 'Asia/Kuwait', serviceWorkers: opts.noSw ? 'block' : 'allow' })
  await ctx.addInitScript(INIT)
  ctx.on('request', (rq) => {
    if (hostOf(rq.url()) === HOST) siteReqs++
    const m = rq.method()
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') P('NONGET ' + m + ' ' + rq.url().slice(0, 100))
  })
  return ctx
}

const scrollSteps = async (page) => {
  for (let i = 0; i < 5; i++) { await page.evaluate((v) => window.scrollTo(0, v), Math.round(VH * 0.8 * (i + 1))); await page.waitForTimeout(300) }
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.scrollTo(0, 0))
}

// one full measured page load
async function loadPage(ctx, tag, urlPath, opts) {
  opts = opts || {}
  const page = opts.page || await ctx.newPage()
  const net = await attachNet(page)
  const errs = []
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /Content Security Policy/i.test(t)) errs.push(m.type() + ': ' + t.slice(0, 170)) })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 120)))
  let status = 0
  const tg = Date.now()
  try { const r = await page.goto(BASE + urlPath, { waitUntil: 'load', timeout: 60000 }); status = r ? r.status() : 0 } catch (e) { P(tag + ' GOTO_FAIL ' + String(e.message).slice(0, 120)) }
  const gotoMs = Date.now() - tg
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch (e) {}
  await page.waitForTimeout(opts.settle || 1500)
  const firstTs = Math.min(...net.list.map((r) => r.t0).concat([1e12]))
  const pre = summarise(tag, net.list.slice(), firstTs)
  const preCount = pre.L.length, preBytes = pre.tot
  if (!opts.noScroll) await scrollSteps(page)
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }) } catch (e) {}
  const S = summarise(tag, net.list.slice(), firstTs)
  let D = {}
  try { D = await page.evaluate(DOMREPORT) } catch (e) { P(tag + ' DOM_FAIL ' + String(e.message).slice(0, 100)) }
  const fulls = [...new Set((D.imgs || []).filter((m) => m.ss).map((m) => m.src))].slice(0, 40)
  let real = {}
  if (fulls.length && siteReqs < BUDGET) { try { real = await page.evaluate(REAL, fulls) } catch (e) {} }
  const nv = D.nav || {}
  P(tag + ' LOAD ' + urlPath + ' status ' + status + ' lang ' + D.lang + ' title ' + JSON.stringify(D.title) + ' | load ' + nv.load + 'ms dcl ' + nv.dcl + 'ms ttfb ' + nv.ttfb + 'ms docEnd ' + nv.docEnd + 'ms FCP ' + D.fcp + ' LCP ' + JSON.stringify(D.lcp) + ' CLS ' + D.cls + ' | before-scroll reqs ' + preCount + ' ' + kb(preBytes) + 'KB lastEnd ' + pre.lastEnd + 'ms | wall ' + gotoMs + 'ms')
  printSummary(tag, S, '')
  imageReport(tag, D, S, real)
  if (D.sh && D.sh.length) P(tag + ' SHIFTS ' + JSON.stringify(D.sh))
  P(tag + ' CSP-EVENTS ' + (D.csp && D.csp.length ? JSON.stringify(D.csp) : 'none') + ' | CONSOLE ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : 'none') + ' | probe-blocked-nonGET ' + JSON.stringify(D.blocked || []))
  const nongetNet = S.L.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && r.method !== 'OPTIONS')
  if (nongetNet.length) P(tag + ' NONGET-ON-WIRE ' + nongetNet.map((r) => r.method + ' ' + pathOf(r.url)).join(' | '))
  return { page, net, S, D, pre, firstTs, status, errs }
}

const fontReport = (tag, R, serverDoc) => {
  const D = R.D, S = R.S
  const fonts = S.L.filter((r) => r.type === 'Font')
  const firstFontEnd = fonts.length ? Math.round(Math.min(...fonts.filter((r) => r.t1).map((r) => (r.t1 - R.firstTs) * 1000))) : null
  const lastFontEnd = fonts.length ? Math.round(Math.max(...fonts.filter((r) => r.t1).map((r) => (r.t1 - R.firstTs) * 1000))) : null
  P(tag + ' FONTS requests ' + fonts.length + ' (' + kb(fonts.reduce((a, r) => a + nominal(r), 0)) + 'KB) hosts ' + JSON.stringify([...new Set(fonts.map((r) => hostOf(r.url)))]) + ' fontsStatus ' + D.fontsStatus + ' FCP ' + D.fcp + 'ms firstFontEnd ' + firstFontEnd + 'ms lastFontEnd ' + lastFontEnd + 'ms (net-time base) | files ' + fonts.map((r) => pathOf(r.url).slice(-34) + ' ' + kb(nominal(r)) + 'KB ' + how(r) + ' cc=' + ((r.h || {})['cache-control'] || '-').slice(0, 34)).join(' ; '))
  P(tag + ' FONTFACES-IN-DOM ' + JSON.stringify(D.fonts) + ' | families-in-rules ' + JSON.stringify(D.faces))
  P(tag + ' FAMILY body ' + D.fam.body + ' | h1 ' + D.fam.h1 + ' | h2 ' + D.fam.h2 + ' | button ' + D.fam.btn)
  P(tag + ' PRELOAD/LINKS ' + JSON.stringify(D.preload) + ' | SHEETS ' + JSON.stringify(D.sheets))
}

// Typekit stylesheet fetched from Node (not the live shop): font-display, families, weights
async function typekitCss(D) {
  const urls = [...new Set((D.sheets || []).map((s) => (s.match(/https:\/\/[^ ]*typekit[^ ]*/) || [])[0]).filter(Boolean))]
  // sheets list prints paths relative to origin; absolute hrefs stay absolute
  const alt = (D.sheets || []).filter((s) => /typekit/.test(s)).map((s) => s.split(' ')[1])
  for (const u of [...new Set(urls.concat(alt))].slice(0, 2)) {
    try {
      const r = await fetch(u.indexOf('http') === 0 ? u : 'https://' + u.replace(/^\/+/, ''))
      const t = await r.text()
      const faces = [...t.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0])
      const fam = faces.map((f) => ((f.match(/font-family:\s*"?([^";]+)/) || [])[1] || '?') + ' w' + ((f.match(/font-weight:\s*([^;]+)/) || [])[1] || '?') + ' ' + ((f.match(/font-style:\s*([^;]+)/) || [])[1] || '') + ' display=' + ((f.match(/font-display:\s*([^;}]+)/) || [])[1] || 'UNSET'))
      P('TYPEKIT-CSS ' + u.slice(0, 70) + ' status ' + r.status + ' bytes ' + t.length + ' cc=' + (r.headers.get('cache-control') || '-') + ' faces ' + faces.length + ' ' + JSON.stringify(fam.slice(0, 8)) + ' families-used ' + JSON.stringify([...new Set((t.match(/font-family:\s*[^;}]+/g) || []).filter((x) => !/@font/.test(x)).slice(0, 6))]))
    } catch (e) { P('TYPEKIT-CSS fetch failed ' + String(e.message).slice(0, 80)) }
  }
}

const budgetLeft = (need) => BUDGET - siteReqs >= need

const run = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  P('START ' + new Date().toISOString() + ' chromium ' + browser.version() + ' budget ' + BUDGET + ' viewport ' + VW + 'x' + VH + '@' + DPR)
  let homeR = null
  try {
    // ===== 1. home, Arabic, cold =====
    const ctx = await newCtx(browser)
    homeR = await loadPage(ctx, 'HOME-AR', '/')
    const dr = (homeR.S.L[0] || {})
    P('HOME-AR DOC-HEADERS status ' + dr.status + ' proto ' + dr.proto + ' ip ' + dr.ip + ' headers ' + JSON.stringify(dr.h || {}).slice(0, 900))
    fontReport('HOME-AR', homeR)
    await typekitCss(homeR.D)
    P('HOME-AR SW swCtl ' + homeR.D.swCtl + ' regs ' + JSON.stringify(homeR.D.swRegs) + ' caches ' + JSON.stringify(homeR.D.caches) + ' swErr ' + (homeR.D.swErr || '-'))
    P('HOME-AR SCRIPTS ' + JSON.stringify(homeR.D.scripts))
    // service worker initiated requests
    // ===== 2. home, warm (same context, new tab) =====
    await homeR.page.waitForTimeout(3000)
    await homeR.page.close()
    if (budgetLeft(30)) {
      const w = await loadPage(ctx, 'HOME-WARM', '/', { noScroll: false })
      const d = w.S.delivered
      const netRecs = w.S.L.filter((r) => how(r) === 'net' || how(r) === '304')
      P('HOME-WARM VERDICT total ' + w.S.L.length + ' | delivered ' + JSON.stringify(d) + ' | network (200/304) ' + netRecs.length + ' = ' + kb(w.S.tot) + 'KB | cold was ' + homeR.S.L.length + ' reqs ' + kb(homeR.S.tot) + 'KB | swControlled ' + w.D.swCtl)
      P('HOME-WARM NETWORK-HITS ' + (netRecs.length ? netRecs.slice(0, 14).map((r) => r.status + ' ' + r.type + ' ' + how(r) + ' ' + kb(transfer(r)) + 'KB ' + pathOf(r.url).slice(-44)).join(' | ') : 'none'))
      const swd = w.S.L.filter((r) => r.sw)
      P('HOME-WARM FROM-SERVICE-WORKER ' + swd.length + ': ' + swd.slice(0, 8).map((r) => r.type + ' ' + pathOf(r.url).slice(-36)).join(' | '))
      await w.page.close()
    } else P('HOME-WARM SKIPPED budget')
    await ctx.close()
  } catch (e) { P('SECTION1_FAIL ' + String(e.stack || e.message).slice(0, 300)) }

  // ===== 3. shop -> first product -> bag -> checkout =====
  let slug = ''
  try {
    if (budgetLeft(60)) {
      const ctx = await newCtx(browser, { noSw: true })
      const shop = await loadPage(ctx, 'SHOP', '/shop')
      slug = await shop.page.evaluate(() => { const a = document.querySelector('a[href*="/product/"]'); return a ? a.getAttribute('href') : '' })
      P('SHOP first product link ' + slug)
      await shop.page.close()
      if (slug && budgetLeft(40)) {
        const prod = await loadPage(ctx, 'PRODUCT', slug.replace(/^https?:\/\/[^/]+/, ''))
        // add one item to the throwaway client-side bag
        const tryAdd = async (page) => {
          const act = await page.evaluate(() => {
            const SZ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'ONE SIZE', 'FREE SIZE']
            const bs = [...document.querySelectorAll('main button')]
            const size = bs.find((b) => !b.disabled && SZ.includes((b.textContent || '').trim().toUpperCase()))
            if (size) size.click()
            return size ? 'size ' + size.textContent.trim() : 'no size button'
          })
          await page.waitForTimeout(500)
          const add = await page.evaluate(() => {
            const txt = (x) => (x.textContent || '').replace(/\s+/g, ' ').trim()
            const bs = [...document.querySelectorAll('main button')].filter((x) => !x.disabled)
            const b = bs.find((x) => !/wish|favou?rite|save|buy now|size|المفضلة|مقاس/i.test(txt(x)) && /^(add|أضف|اضف)/i.test(txt(x)))
            if (b) { b.click(); return 'clicked ' + txt(b).slice(0, 30) }
            return 'no add button'
          })
          await page.waitForTimeout(1500)
          return act + ' / ' + add
        }
        let res = await tryAdd(prod.page)
        P('PRODUCT ADD ' + res)
        let page = prod.page
        if (!/clicked/.test(res) && budgetLeft(60)) {
          // first product may be out of stock: take in-stock candidates from the public products API (GET)
          try {
            const j = await (await fetch(BASE + '/api/api.php?r=products')).json()
            siteReqs++
            const slugs = []
            const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (typeof x.slug === 'string' && x.slug) slugs.push(x.slug); else Object.values(x).forEach(walk) } }
            walk(j)
            for (const s of [...new Set(slugs)].slice(1, 4)) {
              if (!budgetLeft(45)) break
              await page.goto(BASE + '/product/' + s, { waitUntil: 'load' }); await page.waitForTimeout(2000)
              res = await tryAdd(page)
              P('PRODUCT ADD alt ' + s + ' ' + res)
              if (/clicked/.test(res)) break
            }
          } catch (e) { P('PRODUCT ADD alt failed ' + String(e.message).slice(0, 80)) }
        }
        await page.close()
        if (/clicked/.test(res) && budgetLeft(30)) {
          const co = await loadPage(ctx, 'CHECKOUT', '/checkout', { settle: 2500 })
          P('CHECKOUT NOTE measured after the product page in the same context: cached shared assets show as mem/disk. bag content: ' + (await co.page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120))))
          await co.page.close()
        } else P('CHECKOUT SKIPPED (no item added or budget) ' + res)
      }
      await ctx.close()
    } else P('SHOP/PRODUCT/CHECKOUT SKIPPED budget')
  } catch (e) { P('SECTION3_FAIL ' + String(e.stack || e.message).slice(0, 300)) }

  // ===== 4. about, returns (cold, fresh context each) =====
  for (const p of ['/about', '/returns']) {
    try {
      if (!budgetLeft(30)) { P('PAGE ' + p + ' SKIPPED budget (used ' + siteReqs + ')'); continue }
      const ctx = await newCtx(browser, { noSw: true })
      const r = await loadPage(ctx, p.slice(1).toUpperCase(), p, { noScroll: false })
      await r.page.close(); await ctx.close()
    } catch (e) { P('PAGE_FAIL ' + p + ' ' + String(e.message).slice(0, 100)) }
  }

  // ===== 5. home, English =====
  try {
    if (budgetLeft(45)) {
      const ctx = await newCtx(browser, { noSw: true, lang: 'en' })
      const r = await loadPage(ctx, 'HOME-EN', '/?lang=en')
      fontReport('HOME-EN', r)
      await r.page.close(); await ctx.close()
    } else P('HOME-EN SKIPPED budget (used ' + siteReqs + ')')
  } catch (e) { P('SECTION5_FAIL ' + String(e.message).slice(0, 120)) }

  // ===== 6. third parties BLOCKED =====
  try {
    if (budgetLeft(45)) {
      const ctx = await newCtx(browser, { noSw: true })
      const blockedHosts = {}
      await ctx.route('**/*', (route) => {
        const rq = route.request(); const h = hostOf(rq.url())
        const m = rq.method()
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') return route.abort('blockedbyclient')
        if (h !== HOST) { blockedHosts[h] = (blockedHosts[h] || 0) + 1; return route.abort('blockedbyclient') }
        return route.continue()
      })
      const r = await loadPage(ctx, 'HOME-BLOCKED', '/')
      P('HOME-BLOCKED aborted third-party hosts ' + JSON.stringify(blockedHosts))
      fontReport('HOME-BLOCKED', r)
      const D = r.D, H = homeR ? homeR.D : null
      P('HOME-BLOCKED RENDER textLen ' + D.textLen + (H ? ' (normal ' + H.textLen + ')' : '') + ' CLS ' + D.cls + (H ? ' (normal ' + H.cls + ')' : '') + ' FCP ' + D.fcp + (H ? ' (normal ' + H.fcp + ')' : '') + ' LCP ' + JSON.stringify(D.lcp) + (H ? ' (normal ' + JSON.stringify(H.lcp) + ')' : '') + ' load ' + D.nav.load + (H ? ' (normal ' + H.nav.load + ')' : ''))
      await r.page.close(); await ctx.close()
    } else P('HOME-BLOCKED SKIPPED budget (used ' + siteReqs + ')')
  } catch (e) { P('SECTION6_FAIL ' + String(e.message).slice(0, 120)) }

  // ===== 7. font provider SLOW: typekit held 6 s then dropped =====
  try {
    if (budgetLeft(45)) {
      const ctx = await newCtx(browser, { noSw: true })
      let held = 0
      await ctx.route('**/*', (route) => {
        const rq = route.request(); const h = hostOf(rq.url())
        const m = rq.method()
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') return route.abort('blockedbyclient')
        if (/typekit\.net/.test(h)) { held++; setTimeout(() => { route.abort('timedout').catch(() => {}) }, 6000); return }
        return route.continue()
      })
      const r = await loadPage(ctx, 'HOME-SLOWFONT', '/', { noScroll: true })
      P('HOME-SLOWFONT held typekit requests ' + held)
      fontReport('HOME-SLOWFONT', r)
      P('HOME-SLOWFONT RENDER textLen ' + r.D.textLen + ' CLS ' + r.D.cls + ' FCP ' + r.D.fcp + ' LCP ' + JSON.stringify(r.D.lcp) + ' load ' + r.D.nav.load)
      await r.page.close(); await ctx.close()
    } else P('HOME-SLOWFONT SKIPPED budget (used ' + siteReqs + ')')
  } catch (e) { P('SECTION7_FAIL ' + String(e.message).slice(0, 120)) }

  await browser.close()
  P('END siteRequests(counted via context events incl. SW) ' + siteReqs + ' elapsed ' + Math.round((Date.now() - T0) / 1000) + 's')
}

run().catch((e) => { P('PROBE_FAIL ' + String(e.stack || e.message).slice(0, 400)); process.exit(0) })
