#!/usr/bin/env node
// CSS SCAN — read-only. Run ON the VPS inside the Playwright image (the
// sandbox cannot reach www.sporta.com.kw); see GO-LIVE.md "Scanning".
//
//   npm i playwright@1.49.0 csstree-validator@4 && node css-scan.mjs [base]
//
// For each page a shopper (or the owner) opens, it records which stylesheets
// load, then for every stylesheet: HTTP status, content type, compression,
// cache policy, size, how much of it the pages actually use (Chromium CSS
// coverage, summed over all pages), syntax errors (csstree-validator), and
// risk markers (@import chains, !important count, external origins). It also
// reports stylesheet requests that failed and CSP violations that blocked a
// style. Nothing is written anywhere; nothing signs in.
//
// Lines start with ok / WARN / BAD so the counts at the end mean something.
import { chromium } from 'playwright'
import { validate } from 'csstree-validator'

const BASE = (process.argv[2] || 'https://www.sporta.com.kw').replace(/\/$/, '')
const PAGES = [
  ['home ar', '/'], ['home en', '/?lang=en'], ['shop', '/shop'],
  ['product', '/product/cagliari-calcio-sweatshirt-navy'], ['checkout', '/checkout'],
  ['admin sign-in', '/backends'],
]
let bad = 0, warn = 0
const say = (lvl, msg) => { if (lvl === 'BAD') bad++; if (lvl === 'WARN') warn++; console.log(`${lvl.padEnd(5)}${msg}`) }
const short = (u) => u.startsWith(BASE) ? u.slice(BASE.length) : u
const kb = (n) => (n / 1024).toFixed(1) + ' kB'

// CHROMIUM_PATH: run it elsewhere than the Playwright image (e.g. the sandbox).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
const sheets = new Map() // url -> { text, used: Set of [s,e] keys merged later, ranges: [], pages: Set }
const failed = [], csp = [], blocking = new Map()

for (const [name, path] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const pg = await ctx.newPage()
  pg.on('response', (r) => { if (r.request().resourceType() === 'stylesheet' && r.status() >= 400) failed.push(`${r.status()} ${short(r.url())} (on ${name})`) })
  pg.on('requestfailed', (r) => { if (r.resourceType() === 'stylesheet') failed.push(`FAILED ${short(r.url())} ${r.failure()?.errorText} (on ${name})`) })
  pg.on('console', (m) => { const t = m.text(); if (/Content Security Policy/i.test(t) && /style/i.test(t)) csp.push(`${name}: ${t.slice(0, 160)}`) })
  await pg.coverage.startCSSCoverage()
  await pg.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => failed.push(`page ${path}: ${e.message.slice(0, 80)}`))
  for (let i = 0; i < 12; i++) { await pg.mouse.wheel(0, 800); await pg.waitForTimeout(100) }
  await pg.waitForTimeout(400)
  // Render-blocking = a <link rel=stylesheet> in the <head> of the HTML AS
  // SENT (the live page promotes a preload to a stylesheet after it arrives;
  // the finished DOM would wrongly count that one as blocking).
  const html = await (await fetch(BASE + path)).text().catch(() => '')
  // <noscript> fallbacks only apply with JavaScript off: not blocking.
  const headHtml = (html.split(/<\/head>/i)[0] || '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, '')
  for (const m of headHtml.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    // The rel ATTRIBUTE, not an onload="this.rel='stylesheet'" handler.
    const rel = /\srel=["']?([^"'\s>]+)/i.exec(tag)?.[1] || ''
    if (rel.toLowerCase() !== 'stylesheet' || /\smedia=["']?print/i.test(tag)) continue
    const href = /href=["']([^"']+)/i.exec(tag)?.[1]
    if (href) { const u = new URL(href, BASE + '/').href; blocking.set(u, (blocking.get(u) || new Set()).add(name)) }
  }
  const pageUrl = pg.url()
  const cov = await pg.coverage.stopCSSCoverage()
  for (const e of cov) {
    if (!e.url || e.url.startsWith('data:')) continue
    // Coverage reports an inline <style> under the page's own URL.
    const key = e.url === pageUrl || e.url === BASE + path ? 'inline:' + name : e.url
    const s = sheets.get(key) || { text: e.text, ranges: [], pages: new Set() }
    s.ranges.push(...e.ranges); s.pages.add(name)
    if (!s.text && e.text) s.text = e.text
    sheets.set(key, s)
  }
  console.log(`page ${name.padEnd(13)} ${path.padEnd(42)} ${cov.filter((e) => e.url && e.url !== pageUrl).length} stylesheet file(s)`)
  await ctx.close()
}
await browser.close()

const used = (ranges, len) => {
  const r = ranges.map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0])
  let n = 0, cur = -1
  for (const [s, e] of r) { const from = Math.max(s, cur); if (e > from) n += e - from; cur = Math.max(cur, e) }
  return Math.min(n, len)
}

console.log('\n== Stylesheets')
let totalBytes = 0, totalUsed = 0
for (const [url, s] of [...sheets].sort((a, b) => b[1].text.length - a[1].text.length)) {
  const len = s.text.length, u = used(s.ranges, len)
  totalBytes += len; totalUsed += u
  const pct = len ? Math.round((u / len) * 100) : 0
  if (url.startsWith('inline:')) {
    say('ok', `inline <style> on ${url.slice(7)}  ${kb(len)} · used ${pct}%`)
    continue
  }
  const ext = !url.startsWith(BASE)
  let head = null
  try { head = await fetch(url, { headers: { 'accept-encoding': 'br, gzip' } }) } catch (e) { head = null }
  const cc = head?.headers.get('cache-control') || '', enc = head?.headers.get('content-encoding') || 'none', ct = head?.headers.get('content-type') || ''
  const notes = []
  let lvl = 'ok'
  if (!head || head.status !== 200) { lvl = 'BAD'; notes.push('HTTP ' + (head?.status ?? 'unreachable')) }
  if (head && !/text\/css/.test(ct)) { lvl = 'BAD'; notes.push('content-type ' + ct) }
  if (!ext && enc === 'none' && len > 2048) { if (lvl === 'ok') lvl = 'WARN'; notes.push('not compressed') }
  const hashed = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.css/.test(url)
  if (!ext && hashed && !/immutable|max-age=3\d{7}/.test(cc)) { if (lvl === 'ok') lvl = 'WARN'; notes.push('hashed file without long cache') }
  if (!ext && !hashed && /immutable/.test(cc)) { lvl = 'BAD'; notes.push('fixed name cached immutable — edits would never reach visitors') }
  if (ext) { if (lvl === 'ok') lvl = 'WARN'; notes.push('third-party stylesheet') }
  if (len > 30000 && pct < 25) { if (lvl === 'ok') lvl = 'WARN'; notes.push(`mostly unused on these pages`) }
  const imports = (s.text.match(/@import\b/g) || []).length
  if (imports) { if (lvl === 'ok') lvl = 'WARN'; notes.push(imports + ' @import (serial download)') }
  const imp = (s.text.match(/!important/g) || []).length
  const rules = (s.text.match(/\{/g) || []).length
  const faces = (s.text.match(/@font-face/g) || []).length
  const block = blocking.get(url)
  say(lvl, `${short(url)}  ${kb(len)} · ${enc} · used ${pct}% · ${rules} blocks · ${imp} !important${faces ? ' · ' + faces + ' @font-face' : ''}${block ? ' · render-blocking' : ''} · cache "${cc}"${notes.length ? '  — ' + notes.join('; ') : ''}`)
  console.log(`      on: ${[...s.pages].join(', ')}`)
  // Syntax: csstree reports properties/values it does not recognise. Modern
  // features it does not know yet are listed but not counted as BAD.
  if (s.text) {
    let errs = []
    try { errs = (validate(s.text, url) || []) } catch (e) { errs = [{ message: 'parser crashed: ' + e.message }] }
    const parse = errs.filter((e) => /Parse error|Unexpected|Expected|crashed/i.test(e.message))
    const props = errs.filter((e) => !parse.includes(e))
    if (parse.length) { say('BAD', `  ${parse.length} syntax error(s): ` + parse.slice(0, 3).map((e) => `${e.message.split('\n')[0]}${e.line ? ' @' + e.line : ''}`).join(' | ')) }
    if (props.length) {
      const uniq = [...new Set(props.map((e) => (e.property || '') + ': ' + (e.message || '').split('\n')[0]))]
      console.log(`      ${props.length} property/value warning(s) (often newer CSS the validator does not know): ` + uniq.slice(0, 4).join(' | '))
    }
  }
}

console.log('\n== Across pages')
say(totalUsed / Math.max(1, totalBytes) < 0.2 ? 'WARN' : 'ok', `${sheets.size} stylesheets, ${kb(totalBytes)} uncompressed, ${Math.round((totalUsed / Math.max(1, totalBytes)) * 100)}% used on the pages checked`)
const ext = [...sheets.keys()].filter((u) => !u.startsWith(BASE) && !u.startsWith('inline:'))
if (ext.length) say('WARN', `third-party stylesheets (an outside server must answer before text renders in that font): ${[...new Set(ext.map((u) => new URL(u).host))].join(', ')}`)
else say('ok', 'every stylesheet comes from the shop itself')
const blk = [...blocking.keys()]
say(blk.length > 3 ? 'WARN' : 'ok', `${blk.length} render-blocking stylesheet(s) in <head>: ${blk.map(short).join(', ') || 'none'}`)
if (failed.length) for (const f of [...new Set(failed)]) say('BAD', 'stylesheet request failed: ' + f)
else say('ok', 'no stylesheet request failed')
if (csp.length) for (const c of [...new Set(csp)].slice(0, 5)) say('BAD', 'CSP blocked a style: ' + c)
else say('ok', 'no style was blocked by the Content-Security-Policy')
console.log(`\nCSS_SCAN_DONE bad=${bad} warn=${warn}`)
