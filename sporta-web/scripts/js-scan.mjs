// JS SCAN of the JavaScript that ships to the browser from public/ (the add-on files the live index.html links, plus the service worker).
//
//   node scripts/js-scan.mjs            static pass + runtime pass (needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>)
//   STATIC_ONLY=1 node scripts/js-scan.mjs     static pass only (no browser)
//   PAGES=/,/shop WIDTHS=390 LANGS=en          narrow the runtime pass
//
// READ-ONLY: it reads the files and drives a private Chromium against a local copy of the storefront. Nothing is written, nothing is sent
// anywhere but to that local server.
//
// STATIC: per file, syntax (compiled, never run), size, strict mode, the top-level blocks (each should be `;(function () { ... })()` with a
// try/catch around its body so one failure cannot stop the next block), the constructs that can run script from text or reach out of the
// page (eval, new Function, document.write, innerHTML / outerHTML / insertAdjacentHTML, on* attributes, javascript: URLs, srcdoc,
// postMessage, window.open, document.cookie, XMLHttpRequest, WebSocket, importScripts), every URL it names, what it keeps in
// localStorage / sessionStorage, console and debugger statements, timers, observers and listeners, and the syntax it needs (const / let /
// arrow / optional chaining / nullish / template literals), which decides the oldest browser it runs on.
//
// RUNTIME: on the real compiled pages with every add-on, in Arabic and English, phone and desktop: page errors, console errors and warnings,
// failed requests, observers and intervals created BY WHICH FILE, how many observer callbacks each file's observers run in 3 seconds of
// an idle page (and how many milliseconds they take), long tasks.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(WEB, 'public')
const FILES = ['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js',
  'sporta-clock.js', 'sporta-checkout-a11y.js', 'sporta-catalogue.js', 'sw.js']
const out = (s = '') => console.log(s)

// ---------------------------------------------------------------- static
// strip comments and string/template/regex contents so a pattern only matches code
function code(src) {
  let o = '', i = 0, n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') o += '\n'; i++ } i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; o += q; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n' && q !== '`') break; if (src[i] === '\n') o += '\n'; i++ }
      o += q; i++; continue
    }
    o += c; i++
  }
  return o
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
const hits = (re, text) => { const r = []; let m; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = g.exec(text))) r.push(m.index); return r }

const SINKS = [
  ['eval', /\beval\s*\(/], ['new Function', /\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"]/], ['document.write', /document\.write(ln)?\s*\(/],
  ['innerHTML', /\.innerHTML\b/], ['outerHTML', /\.outerHTML\b/], ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/],
  ['setAttribute on*', /setAttribute\s*\(\s*['"]on[a-z]+['"]/i], ['srcdoc', /\bsrcdoc\b/], ['postMessage', /\.postMessage\s*\(/],
  ['window.open', /window\.open\s*\(/], ['location write', /\blocation\s*(\.href|\.assign|\.replace)?\s*=[^=]/], ['document.cookie', /document\.cookie/],
  ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /\bWebSocket\b/], ['importScripts', /importScripts\s*\(/], ['sendBeacon', /sendBeacon\s*\(/],
  ['console.*', /\bconsole\.(log|info|warn|error|debug)\s*\(/], ['debugger', /\bdebugger\b/],
]
const FEATURES = [['const / let', /\b(const|let)\s+[A-Za-z_$[{]/], ['arrow =>', /=>/], ['optional ?.', /\?\.[A-Za-z_$[(]/], ['nullish ??', /\?\?/], ['async / await', /\b(async|await)\b/], ['spread ...', /\.\.\./]]

function staticScan(name) {
  const path = join(PUB, name)
  if (!existsSync(path)) { out(`${name}: MISSING`); return null }
  const src = readFileSync(path, 'utf8')
  const c = code(src)
  const r = { name, bytes: Buffer.byteLength(src), lines: src.split('\n').length }
  try { new vm.Script(src, { filename: name }); r.syntax = 'ok' } catch (e) { r.syntax = 'ERROR ' + e.message }
  r.strict = hits(/['"]use strict['"]/, src).length
  // top-level blocks: a line that starts with ;(function / (function / (() => / ;(async
  const blocks = hits(/(^|\n)\s*;?\(\s*(async\s+)?(function|\(\s*\)\s*=>)/, c)
  r.blocks = blocks.length
  // a block is GUARDED when its last statement is `} catch (e) { ... }` inside the closing `})()` (one failure then cannot stop the file);
  // a block that follows another one needs a leading ";" (or the one before it a trailing ";"), or `})()` newline `(function` would CALL
  // the earlier block's result (automatic semicolon insertion does not apply before a parenthesis)
  r.unguarded = []; r.asi = []; r.noTry = []
  blocks.forEach((b, k) => {
    const end = k + 1 < blocks.length ? blocks[k + 1] : c.length
    const body = c.slice(b, end).replace(/\s+$/, '')
    const tail = body.slice(-220)
    const guarded = /\bcatch\b\s*(\([^)]*\))?\s*\{[^{}]*\}\s*\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(tail)
    if (!guarded) { r.unguarded.push(lineOf(c, b)); if (!/\btry\s*\{/.test(body)) r.noTry.push(lineOf(c, b)) }
    if (k > 0) {
      const head = c.slice(b, b + 400).replace(/^\s+/, '')   // a long comment above a block was stripped to blank lines
      const prev = c.slice(blocks[k - 1], b).replace(/\s+$/, '')
      if (!head.startsWith(';') && !prev.endsWith(';')) r.asi.push(lineOf(c, b))
    }
  })
  r.sinks = {}
  for (const [label, re] of SINKS) { const h = hits(re, c); if (h.length) r.sinks[label] = h.slice(0, 30).map((x) => lineOf(c, x)) }
  r.features = Object.fromEntries(FEATURES.map(([l, re]) => [l, hits(re, c).length]).filter(([, n]) => n))
  r.timers = { setInterval: hits(/\bsetInterval\s*\(/, c).length, setTimeout: hits(/\bsetTimeout\s*\(/, c).length, raf: hits(/requestAnimationFrame\s*\(/, c).length }
  r.observers = { MutationObserver: hits(/new\s+MutationObserver/, c).length, ResizeObserver: hits(/new\s+ResizeObserver/, c).length, IntersectionObserver: hits(/new\s+IntersectionObserver/, c).length, PerformanceObserver: hits(/new\s+PerformanceObserver/, c).length }
  r.subtreeObservers = hits(/subtree\s*:\s*true/, c).length
  r.listeners = { add: hits(/\.addEventListener\s*\(/, c).length, remove: hits(/\.removeEventListener\s*\(/, c).length }
  r.globals = [...new Set([...c.matchAll(/\bwindow\.(__?[A-Za-z]\w*|SPORTA\w*|sporta\w*)\s*=[^=]/g)].map((m) => m[1]))]
  r.storage = [...new Set([...src.matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))]
  const urls = [...src.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?:\/[^\s'"`)<>]*)?/g)].map((m) => m[0])
  r.hosts = [...new Set(urls.map((u) => { try { return new URL(u).host } catch { return u } }))].filter((h) => !/^(www\.w3\.org|www\.sporta\.com\.kw)$/.test(h))
  r.fetches = [...new Set([...src.matchAll(/fetch\(\s*([^,)]{0,80})/g)].map((m) => m[1].trim()))].slice(0, 12)
  return r
}

out('=== STATIC ' + '='.repeat(60))
const S = FILES.map(staticScan).filter(Boolean)
const tot = S.reduce((a, r) => a + r.bytes, 0)
out(`${S.length} files, ${(tot / 1024).toFixed(0)} KB (the admin file is ${(S.find((r) => r.name === 'sporta-admin-brands.js').bytes / 1024).toFixed(0)} KB of it; the live loader of that name is about 1 KB and the real code loads only on /backends)`)
for (const r of S) {
  out(`\n[${r.name}] ${(r.bytes / 1024).toFixed(1)} KB, ${r.lines} lines | syntax ${r.syntax} | 'use strict' x${r.strict} | top-level blocks ${r.blocks}${r.unguarded.length ? ` | blocks with NO closing catch: lines ${r.unguarded.join(', ')} (of which no try at all: ${r.noTry.length ? r.noTry.join(', ') : 'none'})` : ' | every block ends in a catch'}${r.asi.length ? ` | MISSING ";" before the block at lines ${r.asi.join(', ')}` : ''}`)
  out(`   timers: ${JSON.stringify(r.timers)} | observers: ${JSON.stringify(r.observers)} (subtree:true x${r.subtreeObservers}) | listeners add ${r.listeners.add} / remove ${r.listeners.remove}`)
  out(`   syntax needed: ${JSON.stringify(r.features)}`)
  const sk = Object.entries(r.sinks).map(([k, v]) => `${k} x${v.length} (lines ${v.slice(0, 8).join(',')}${v.length > 8 ? ',...' : ''})`)
  out(`   constructs: ${sk.length ? sk.join(' | ') : 'none of the watched ones'}`)
  if (r.globals.length) out(`   globals: ${r.globals.join(', ')}`)
  if (r.storage.length) out(`   storage keys: ${r.storage.join(', ')}`)
  if (r.hosts.length) out(`   hosts named: ${r.hosts.join(', ')}`)
  if (r.fetches.length) out(`   fetch targets: ${r.fetches.join(' ; ').slice(0, 300)}`)
}
const bad = S.filter((r) => r.syntax !== 'ok')
out(`\nSTATIC SUMMARY: syntax errors ${bad.length}; blocks with no closing catch ${S.reduce((a, r) => a + r.unguarded.length, 0)} of ${S.reduce((a, r) => a + r.blocks, 0)} (no try at all in ${S.reduce((a, r) => a + r.noTry.length, 0)}); missing ";" before a block ${S.reduce((a, r) => a + r.asi.length, 0)}; eval/new Function ${S.reduce((a, r) => a + (r.sinks.eval || []).length + (r.sinks['new Function'] || []).length, 0)}; document.write ${S.reduce((a, r) => a + (r.sinks['document.write'] || []).length, 0)}; innerHTML/outerHTML/insertAdjacentHTML ${S.reduce((a, r) => a + (r.sinks.innerHTML || []).length + (r.sinks.outerHTML || []).length + (r.sinks.insertAdjacentHTML || []).length, 0)}; console.* ${S.reduce((a, r) => a + (r.sinks['console.*'] || []).length, 0)}`)
if (process.env.STATIC_ONLY) process.exit(bad.length ? 1 : 0)

// ---------------------------------------------------------------- runtime
const { chromium } = await import('playwright')
const { serveLive, liveDir } = await import('./lib/add-to-cart-ux-live.mjs')
if (!liveDir()) { out('\nRUNTIME: SKIP (no capture of the live storefront; set SPORTA_LIVE_CAPTURE=<dir>)'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const PAGES = (process.env.PAGES || '/,/shop,/product/sculpt-jacket-black,/cart,/about,/contact,/account').split(',')
const WIDTHS = (process.env.WIDTHS || '390,1280').split(',').map(Number)
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const BAG = [{ key: 'sculpt-jacket-black__M__-', slug: 'sculpt-jacket-black', size: 'M', fit: null, name: { en: 'Sculpt Jacket — Black', ar: 'جاكيت سكلبت — أسود' }, price: 10, image: '/product-photo-unavailable.svg', qty: 1 }]

const INSTR = () => {
  const W = window
  const st = (W.__js = { mo: {}, moCb: {}, moMs: {}, iv: {}, ro: {}, io: {}, ev: {}, lt: [], rafs: 0 })
  const who = () => {
    for (const l of String(new Error().stack || '').split('\n').slice(2)) {
      const m = l.match(/\/([\w.-]+\.js)(?:\?[^:)]*)?:\d+:\d+/)
      if (m) return /^(index|assets)/.test(m[1]) || /\/assets\//.test(l) ? 'bundle' : m[1]
    }
    return 'unknown'
  }
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }
  const MO = W.MutationObserver
  W.MutationObserver = function (cb) {
    const f = who(); bump(st.mo, f)
    return new MO(function (recs, obs) { const t = performance.now(); try { return cb.call(this, recs, obs) } finally { bump(st.moCb, f); bump(st.moMs, f, performance.now() - t) } })
  }
  W.MutationObserver.prototype = MO.prototype
  for (const [k, slot] of [['ResizeObserver', st.ro], ['IntersectionObserver', st.io]]) {
    const O = W[k]; if (!O) continue
    W[k] = function (cb, o) { bump(slot, who()); return new O(cb, o) }; W[k].prototype = O.prototype
  }
  const SI = W.setInterval
  W.setInterval = function (fn, ms, ...a) { const f = who(); (st.iv[f] = st.iv[f] || []).push(ms); return SI.call(W, fn, ms, ...a) }
  const AEL = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (t, fn, o) { if (this === W || this === document || this === document.body || this === document.documentElement) bump(st.ev, who() + ' ' + (this === W ? 'window' : 'document') + ':' + t); return AEL.call(this, t, fn, o) }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) st.lt.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch (e) {}
}

out('\n=== RUNTIME ' + '='.repeat(59))
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const srv = await serveLive({})
const NOISE = /typekit|fonts\.googleapis|googletagmanager|favicon/i
const agg = { errs: new Map(), warns: new Map(), mo: {}, moCb: {}, moMs: {}, iv: {}, ev: {}, res: new Map(), pageerrors: 0 }
let loads = 0, lt = []
for (const lang of LANGS) for (const w of WIDTHS) for (const path of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript(INSTR)
  await ctx.addInitScript((c) => { try { if (!sessionStorage.getItem('__s')) { localStorage.setItem('sporta_cart', JSON.stringify(c)); sessionStorage.setItem('__s', '1') } } catch (e) {} }, BAG)
  const p = await ctx.newPage()
  const errs = [], warns = [], failed = []
  p.on('pageerror', (e) => { agg.pageerrors++; errs.push('pageerror: ' + String(e.message).slice(0, 160)) })
  p.on('console', (m) => { const t = m.text(); if (NOISE.test(t)) return; if (m.type() === 'error') errs.push('console.error: ' + t.slice(0, 160)); else if (m.type() === 'warning') warns.push(t.slice(0, 160)) })
  p.on('requestfailed', (r) => { if (!NOISE.test(r.url())) failed.push(r.url().replace(srv.base, '').slice(0, 80)) })
  // which URL is behind each "Failed to load resource" line: same-origin answers 4xx/5xx by path, and refused outside hosts by host
  p.on('response', (r) => { if (r.status() >= 400) { const u = r.url().replace(srv.base, ''); const k = r.status() + ' ' + u.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/…').slice(0, 70); agg.res.set(k, (agg.res.get(k) || 0) + 1) } })
  p.on('requestfinished', () => {})
  p.on('request', (r) => { try { const h = new URL(r.url()).host; if (!srv.base.endsWith(h) && !/^(data|blob):/.test(r.url())) agg.res.set('outside host ' + h, (agg.res.get('outside host ' + h) || 0) + 1) } catch (e) {} })
  await p.goto(`${srv.base}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'load' }).catch(() => {})
  await p.waitForTimeout(2500)
  const a = await p.evaluate(() => JSON.parse(JSON.stringify({ moCb: window.__js.moCb, moMs: window.__js.moMs })))
  await p.waitForTimeout(3000)   // an idle page
  const s = await p.evaluate(() => JSON.parse(JSON.stringify(window.__js)))
  const idle = {}, idleMs = {}
  for (const f of Object.keys(s.moCb)) { idle[f] = s.moCb[f] - (a.moCb[f] || 0); idleMs[f] = s.moMs[f] - (a.moMs[f] || 0) }
  loads++
  for (const e of errs) agg.errs.set(e, (agg.errs.get(e) || 0) + 1)
  for (const e of warns) agg.warns.set(e, (agg.warns.get(e) || 0) + 1)
  for (const f of failed) agg.errs.set('requestfailed: ' + f, (agg.errs.get('requestfailed: ' + f) || 0) + 1)
  for (const [f, n] of Object.entries(s.mo)) agg.mo[f] = Math.max(agg.mo[f] || 0, n)
  for (const f of Object.keys(idle)) { agg.moCb[f] = Math.max(agg.moCb[f] || 0, idle[f]); agg.moMs[f] = Math.max(agg.moMs[f] || 0, idleMs[f]) }
  for (const [f, v] of Object.entries(s.iv)) agg.iv[f] = Math.max(agg.iv[f] || 0, v.length)
  lt.push(Math.max(0, ...s.lt))
  out(`[${lang} ${w} ${path}] errors ${errs.length} warnings ${warns.length} failed requests ${failed.length} | observers ${Object.entries(s.mo).map(([f, n]) => f.replace('sporta-', '') + ':' + n).join(' ')} | idle callbacks/3s ${Object.entries(idle).filter(([, n]) => n).map(([f, n]) => f.replace('sporta-', '') + ':' + n + '(' + idleMs[f].toFixed(1) + 'ms)').join(' ') || 'none'} | intervals ${Object.entries(s.iv).map(([f, v]) => f.replace('sporta-', '') + ':' + v.join('/')).join(' ') || 'none'} | longest task ${Math.max(0, ...s.lt)}ms`)
  await ctx.close()
}
await srv.close(); await browser.close()
out(`\nRUNTIME SUMMARY over ${loads} page loads:`)
out(`  distinct errors: ${agg.errs.size}${[...agg.errs].slice(0, 8).map(([e, n]) => `\n    x${n} ${e}`).join('')}`)
out(`  uncaught page errors (real script faults): ${agg.pageerrors}`)
out(`  what the resource errors are (status + folder, or an outside host):${[...agg.res].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([e, n]) => `\n    x${n} ${e}`).join('')}`)
out(`  distinct warnings: ${agg.warns.size}${[...agg.warns].slice(0, 8).map(([e, n]) => `\n    x${n} ${e}`).join('')}`)
out(`  most observers on one page, by file: ${JSON.stringify(agg.mo)}`)
out(`  most observer callbacks in 3 s of an idle page, by file: ${JSON.stringify(agg.moCb)} (ms: ${JSON.stringify(Object.fromEntries(Object.entries(agg.moMs).map(([f, v]) => [f, +v.toFixed(1)])))})`)
out(`  most intervals on one page, by file: ${JSON.stringify(agg.iv)}`)
out(`  longest long task on any load: ${Math.max(0, ...lt)} ms`)
process.exitCode = bad.length || agg.pageerrors ? 1 : 0
