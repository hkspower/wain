#!/usr/bin/env node
// admin-alignment-scan.mjs - alignment of the compiled /backends admin on its captured markup, in light and dark, at 390 / 768 / 1280,
// with <html dir=ltr> (the English shop) AND <html dir=rtl lang=ar> (the DEFAULT: /boot.js sets dir=rtl on /backends too, because
// Arabic is the default language). Read-only: fixtures only, no network, nothing signs in.
//
//   node scripts/admin-alignment-scan.mjs                         # the repo's add-ons (public/)
//   ADDON_DIR=/path/to/live-capture node scripts/admin-alignment-scan.mjs   # the add-ons that are LIVE (a folder holding sporta-*.css)
//   ONLY=orders,inventory VIEWS=768 SCHEMES=light node scripts/admin-alignment-scan.mjs
//   JSON=out.json node scripts/admin-alignment-scan.mjs          # also write every row
//   SELFTEST=1 node scripts/admin-alignment-scan.mjs             # proves the collector on a broken and a clean fixture
//
// WHAT IT MEASURES (per screen x width x scheme)
//   page    scrollWidth vs clientWidth in both directions; every visible, unclipped box that leaves [0, width] (a "leak").
//   mirror  the same page rendered under html dir=ltr and html dir=rtl: every element's box compared. The admin hard-codes
//           dir=ltr lang=en on its root (<div class="admin-shell">), so a healthy page shows ZERO differences; anything that
//           moves is rendered outside that root (a portal, a toast) or built from a physical property.
//   shell   sidebar / content / mobile header / tab bar boxes; the page column's children share one left and right edge.
//   parts   inline icon + label pairs (vertical centre), stacked pairs (horizontal centre), text-only controls (label centre),
//           table header vs body cell alignment and column edges, modal centred in the viewport.
//
// WHAT IT CANNOT KNOW: the admin's OWN stylesheets (AdminApp-*.css and the CRM / Support / Returns / Profiles / SEO / Theme sheets)
// are not in the capture; fixtures/sizes-admin/shell.css stands in for them (its header says what it is built from). So the
// sidebar, the mobile header and the tab bar are the stand-in's geometry, not the live sheet's, and the six screens that live
// only in the missing sheets are not rendered at all. Everything the compiled admin takes from Tailwind utilities, and every
// add-on rule, IS the live rule.
//
// Exit code: 1 when a screen overflows sideways, leaks a box, or moves between ltr and rtl; 0 otherwise.
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium } = require('playwright')
const { serve, NAMES, ADDON_ORDER } = await import(join(ROOT, 'scripts/lib/sizes-admin-page.mjs'))

const VIEWS = [{ id: '390', w: 390, h: 844, touch: true }, { id: '768', w: 768, h: 1024, touch: true }, { id: '1280', w: 1280, h: 800, touch: false }]
const env = process.env

/** Runs inside the page. Pure measurement; returns plain data. */
export function collect() {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const cs = (e) => getComputedStyle(e)
  const vw = document.documentElement.clientWidth
  const sig = (e) => { const c = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'); return e.tagName.toLowerCase() + (c ? '.' + c : '') }
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = cs(e); return c.visibility !== 'hidden' && c.display !== 'none' }
  const all = $$('body *').filter((e) => !(e.closest('svg') && e.tagName.toLowerCase() !== 'svg'))
  const q = (n) => Math.round(n * 10) / 10
  const out = { vw, docW: document.documentElement.scrollWidth, htmlDir: document.documentElement.dir, rects: [], sigs: [], leaks: [], issues: [] }
  out.rects = all.map((e) => { const r = e.getBoundingClientRect(); return [q(r.left), q(r.top), q(r.width), q(r.height)] })
  out.sigs = all.map(sig)
  const clipped = (e) => { for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) if (cs(a).overflowX !== 'visible') return true; return false }
  for (const e of all) {
    if (!vis(e) || cs(e).position === 'fixed') continue
    const r = e.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !clipped(e)) out.leaks.push({ s: sig(e), l: Math.round(r.left), r: Math.round(r.right), t: (e.textContent || '').trim().slice(0, 30) })
  }
  const shell = document.querySelector('.admin-shell')
  out.shellDir = shell ? cs(shell).direction : null
  out.outside = $$('body > *').filter((e) => shell && !e.contains(shell) && !shell.contains(e)).map((e) => ({ s: sig(e), dir: cs(e).direction }))
  const box = (e) => { if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.height)] }
  out.shell = { content: box(document.querySelector('.admin-content')), sidebar: box(document.querySelector('.admin-sidebar')), mHeader: box(document.querySelector('.m-header')), tabbar: box(document.querySelector('.m-tabbar')) }
  const lay = document.querySelector('.admin-page-layout, .admin-page')
  if (lay) { const lr = lay.getBoundingClientRect(); out.edges = [...lay.children].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { s: sig(e), l: q(r.left - lr.left), r: q(lr.right - r.right) } }) }
  // inline icon + label pairs (vertical centre) and stacked pairs (horizontal centre)
  out.icon = []
  for (const b of $$('button, a, summary, [role=button]')) {
    if (!vis(b) || b.closest('[aria-hidden=true]')) continue
    const svg = b.querySelector(':scope > svg, :scope > span > svg')
    const label = [...b.childNodes].find((n) => n.nodeType === 3 && n.data.trim()) || b.querySelector(':scope > span:not(:has(svg))')
    if (!svg || !label) continue
    const sr = svg.getBoundingClientRect()
    let lr
    if (label.nodeType === 3) { const tx = document.createRange(); tx.selectNode(label); lr = tx.getBoundingClientRect() } else lr = label.getBoundingClientRect()
    if (!lr.height) continue
    const stacked = lr.top >= sr.bottom - 2 || sr.top >= lr.bottom - 2
    out.icon.push({ s: sig(b), t: (b.textContent || '').trim().slice(0, 24), stacked, dy: q((sr.top + sr.height / 2) - (lr.top + lr.height / 2)), dx: q((sr.left + sr.width / 2) - (lr.left + lr.width / 2)), lines: Math.round(lr.height / (parseFloat(cs(b).lineHeight) || 20)) })
  }
  // text-only controls: the label's centre against the button's centre (sr-only toggles and tiny buttons are skipped)
  out.ctrl = []; out.nCtrl = 0
  for (const b of $$('button, a.btn, [role=button]')) {
    if (!vis(b) || b.closest('[aria-hidden=true]') || b.querySelector('svg') || !b.textContent.trim() || b.getBoundingClientRect().width < 24 || b.querySelector('.sr-only')) continue
    out.nCtrl++
    const rg = document.createRange(); rg.selectNodeContents(b)
    const t = rg.getBoundingClientRect(), r = b.getBoundingClientRect()
    const dx = (t.left + t.width / 2) - (r.left + r.width / 2), dy = (t.top + t.height / 2) - (r.top + r.height / 2)
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 2) out.ctrl.push({ s: sig(b), t: b.textContent.trim().slice(0, 24), dx: q(dx), dy: q(dy) })
  }
  // tables: header vs first body row, per column
  out.tables = []
  const norm = (x) => (/^(start|left|-webkit-left)$/.test(x) ? 'L' : /^(end|right|-webkit-right)$/.test(x) ? 'R' : x === 'center' ? 'C' : x)
  for (const t of $$('table')) {
    if (!vis(t)) continue
    const ths = $$('thead th', t), row = t.querySelector('tbody tr'); if (!row || !ths.length) continue
    const tds = [...row.children]
    ths.forEach((th, i) => {
      const td = tds[i]; if (!td || !vis(th) || !vis(td)) return
      if (norm(cs(th).textAlign) !== norm(cs(td).textAlign)) out.tables.push({ s: sig(t), col: i, th: (th.textContent || '').trim().slice(0, 14), thA: cs(th).textAlign, tdA: cs(td).textAlign })
      const a = th.getBoundingClientRect(), b = td.getBoundingClientRect()
      if (Math.abs(a.left - b.left) > 1 || Math.abs(a.width - b.width) > 1) out.tables.push({ s: sig(t), col: i, th: (th.textContent || '').trim().slice(0, 14), cellDx: q(a.left - b.left) })
    })
  }
  const modal = document.querySelector('form.admin-editor-modal, [role=dialog]')
  if (modal && vis(modal)) { const r = modal.getBoundingClientRect(); out.modal = { s: sig(modal), centreDx: q((r.left + r.right) / 2 - vw / 2), inShell: !!modal.closest('.admin-shell'), dir: cs(modal).direction } }
  return out
}

/** Compare the two renders of one state. */
export function judge(ltr, rtl) {
  const diffs = []
  if (ltr.rects.length === rtl.rects.length) for (let i = 0; i < ltr.rects.length; i++) { const p = ltr.rects[i], q = rtl.rects[i]; if (p.some((v, k) => Math.abs(v - q[k]) > 0.6)) diffs.push({ s: ltr.sigs[i], ltr: p, rtl: q }) }
  else diffs.push({ s: 'DOM changed between the two renders', ltr: [ltr.rects.length], rtl: [rtl.rects.length] })
  return {
    overflow: Math.max(ltr.docW, rtl.docW) - ltr.vw > 1 ? { ltr: ltr.docW, rtl: rtl.docW, vw: ltr.vw } : null,
    leaks: ltr.leaks.slice(0, 6), mirrorDiffs: diffs.length, mirrorSample: diffs.slice(0, 6),
    outside: rtl.outside.filter((o) => o.dir !== 'ltr'),
    iconOff: ltr.icon.filter((x) => (!x.stacked && Math.abs(x.dy) > 1.5 && x.lines <= 1) || (x.stacked && Math.abs(x.dx) > 2)),
    ctrlOff: ltr.ctrl, tables: ltr.tables, edgeOff: (ltr.edges || []).filter((e) => Math.abs(e.l) > 0.6 || Math.abs(e.r) > 0.6),
    modal: ltr.modal && Math.abs(ltr.modal.centreDx) > 1 ? ltr.modal : null, counts: { elements: ltr.rects.length, iconPairs: ltr.icon.length, controls: ltr.nCtrl },
  }
}

async function render(browser, url, v, scheme) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.touch, colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(120)
  const ltr = await page.evaluate(collect)
  // what /boot.js does on /backends when no language is stored: Arabic. AdminApp keeps dir=ltr on its own root, so only <html> flips.
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar' })
  await page.waitForTimeout(60)
  const rtl = await page.evaluate(collect)
  await ctx.close()
  return { ltr, rtl }
}

async function selftest(browser) {
  const clean = '<!doctype html><html dir="ltr"><body style="margin:0"><div class="admin-shell" dir="ltr"><main class="admin-content"><div class="admin-page-layout"><p>ok</p></div></main></div></body></html>'
  const broken = '<!doctype html><html dir="ltr"><body style="margin:0"><div class="admin-shell" dir="ltr"><main class="admin-content"><div class="admin-page-layout"><div style="width:2000px;height:10px">wide</div></div></main></div><div id="portal" style="margin-inline-start:40px;width:50px;height:10px">x</div></body></html>'
  const run = async (html) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const p = await ctx.newPage(); await p.setContent(html); const a = await p.evaluate(collect); await p.evaluate(() => { document.documentElement.dir = 'rtl' }); const b = await p.evaluate(collect); await ctx.close(); return judge(a, b) }
  const c = await run(clean), b = await run(broken)
  const checks = [
    ['a clean page has no overflow, leak or mirror difference', !c.overflow && !c.leaks.length && !c.mirrorDiffs],
    ['a 2000px box is reported as an overflow', !!b.overflow && b.overflow.ltr >= 2000],
    ['the same box is reported as a leak', b.leaks.some((l) => l.r > 1000)],
    ['an element outside the dir=ltr root that uses margin-inline-start moves between ltr and rtl', b.mirrorDiffs >= 1 && b.mirrorSample.some((d) => d.s.includes('div')) && b.outside.length === 1],
  ]
  let bad = 0
  for (const [n, ok] of checks) { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++ }
  console.log(`${checks.length - bad}/${checks.length} selftest checks passed`)
  return bad ? 1 : 0
}

const exe = env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => existsSync(p))
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] })
if (env.SELFTEST === '1') { const code = await selftest(browser); await browser.close(); process.exit(code) }

const addonDir = env.ADDON_DIR || join(ROOT, 'public')
const addons = Object.fromEntries(ADDON_ORDER.map((f) => [f, existsSync(join(addonDir, f)) ? readFileSync(join(addonDir, f), 'utf8') : '']))
const { server, base } = await serve({ current: addons })
const only = env.ONLY ? env.ONLY.split(',') : NAMES
const views = VIEWS.filter((v) => !env.VIEWS || env.VIEWS.split(',').includes(v.id))
const schemes = (env.SCHEMES || 'light,dark').split(',')
const rows = []
for (const name of only) for (const v of views) for (const scheme of schemes) {
  const { ltr, rtl } = await render(browser, `${base}/__fx/${name}?dark=${scheme === 'dark' ? 1 : 0}`, v, scheme)
  rows.push({ name, view: v.id, scheme, ...judge(ltr, rtl) })
}
await browser.close(); server.close()
if (env.JSON) writeFileSync(env.JSON, JSON.stringify(rows))
const bad = rows.filter((r) => r.overflow || r.leaks.length || r.mirrorDiffs || r.outside.length)
const sum = (k) => rows.reduce((n, r) => n + r.counts[k], 0)
console.log(`admin alignment - add-ons from ${addonDir}`)
console.log(`  ${rows.length} states (${only.length} screens x ${views.length} widths x ${schemes.length} schemes), each rendered with html dir=ltr and dir=rtl: ${sum('elements')} element boxes, ${sum('iconPairs')} icon pairs, ${sum('controls')} text controls`)
console.log(`  sideways overflow: ${rows.filter((r) => r.overflow).length}   leaked boxes: ${rows.filter((r) => r.leaks.length).length}   ltr/rtl differences: ${rows.filter((r) => r.mirrorDiffs).length}   outside the dir=ltr root: ${rows.filter((r) => r.outside.length).length}`)
console.log(`  icon pairs off-centre: ${rows.reduce((n, r) => n + r.iconOff.length, 0)}   table header/body mismatches: ${rows.reduce((n, r) => n + r.tables.length, 0)}   page-column edge mismatches: ${rows.reduce((n, r) => n + r.edgeOff.length, 0)}   modals off-centre: ${rows.filter((r) => r.modal).length}`)
for (const r of bad) console.log(`  ${r.name}@${r.view}/${r.scheme}: ${r.overflow ? `page ${r.overflow.ltr}px in ${r.overflow.vw}px (under dir=rtl ${r.overflow.rtl}px${r.overflow.rtl <= r.overflow.vw + 1 && r.overflow.ltr > r.overflow.vw + 1 ? ': the part past the edge cannot be scrolled to'  : ''}); ` : ''}${r.leaks.length ? `first leak ${r.leaks[0].s} ${r.leaks[0].l}..${r.leaks[0].r}; ` : ''}${r.mirrorDiffs ? `${r.mirrorDiffs} boxes move in rtl, e.g. ${r.mirrorSample[0].s}` : ''}`)
process.exit(bad.length ? 1 : 0)
