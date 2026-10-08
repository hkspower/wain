#!/usr/bin/env node
/**
 * test:oversize-fixes — the confirmed "large boxes and icons" findings of 2026-10-08, each MEASURED in
 * a real browser after the fix (phones are devices['Pixel 7'], so pointer:coarse applies; computers
 * are a 1280 window with a mouse). Every section names the fault it guards; the numbers in its
 * messages are what the fault measured.
 *
 *   phone-field   checkout mobile number 72px, a box inside a box -> 52px, one field (51-checkout-fields.css)
 *   features      home "Sporta features" band 260px for two rows -> 180px on computers; phones keep the
 *                 owner's 2026-10-07 room (trust-strip.js)
 *   controls      overlay buttons/fields 45-51px at 16.8px on a mouse -> the panel's 40px / 14.7px; touch
 *                 keeps 44px (90-panel-sizes.css). Plus a generic sweep: no control an overlay drew
 *                 (no React fiber) is over 42.5px on a mouse, so a new overlay cannot bring it back.
 *   bell          the fixed bell covered each screen's first thing and the jump bar's last pill (90-)
 *   seo-rows      Product SEO rows 61px for one line -> 45px (seo-screen.js)
 *   cat-grid      Category pictures: 1, 2 or 4 columns, never 3; two per row on a phone (category-art.js)
 *   checkbox      Payments "Ways to pay" boxes 26px -> 20px (payments-screen.js)
 *   setup         Setup mounted 20 other screens' cards (h2 group headings) and left Settings empty (setup-screen.js)
 *   setup-rows    Setup rows on a phone: the pill alone on a line (setup-screen.js)
 *   save-bar      the save bar covered the whole phone tab bar; the toast must clear the bar (panel-save-bar.js)
 *   chart         Overview revenue bars were 0px at every size (90-panel-sizes.css)
 *   bell-phone    the bell a dark 44px tile in the light phone header (notification-center.js)
 *
 *   ONLY=a,b      run some sections.   MUTATE=<name>   serve the file with that fix undone (see MUT
 *   below) — the run must then FAIL, which is how each check was mutation-tested.
 *
 * Writes are refused at the network (every non-GET admin.php call but login is answered {"ok":true}),
 * so nothing here changes the shared sandbox database.
 *
 * MUTATION-TESTED, 2026-10-08 — every MUTATE below was run and failed by name:
 *   phone-field  72px, padding 10px 12px, pale edge, no ring (phone and desktop, en and ar)
 *   phone-focus  no ring on the focused field (4)          features     band 260px at 820/1280/1920 (4)
 *   controls     16.8px text and 45-51px on all 8 screens, the - / + at 44px, Save changes 48.9px (18)
 *   bell-pad     the bell over a button, a card or the h1 on 11 screen/width pairs
 *   bell-jump    the stuck jump bar running under the bell (4)   seo-rows  61px rows, 8px under an open row (3)
 *   cat-grid     3+1 at 1280, 6 columns at 1920 (4)              cat-phone one per row, 1,815px card (2)
 *   cat-editing  the edited tile's Save/Cancel stretched (1)      checkbox  44x26 (1)
 *   setup        20 foreign cards, h2, 18,935px, 60 requests, Settings left without its cards (12)
 *   setup-rows   text under the pill on 19 of 23 rows (6)
 *   save-bar     0 of 5 tabs reachable, Save over the tab bar, a tab tap ignored (6)
 *   save-bar-move  the bar merely moved up 60px: the toast lands on its Save button (2)
 *   chart        bars 0px (2)                                    bell-phone the dark tile back (1)
 */
import { chromium, devices } from 'playwright'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EXE = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
const MUTATE = process.env.MUTATE || ''
const run = (k) => !ONLY.length || ONLY.includes(k)
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !extra ? '' : '   ' + extra}`) }
const r1 = (n) => Math.round(n * 10) / 10

/* ---- mutations: each undoes one fix in the SERVED file, so the rig can be shown to fail ---------- */
const cutBlock = (s, start) => {                     // remove `start … {…}` with its matching brace
  const i = s.indexOf(start); if (i < 0) return s + '\n/* MUTATION ANCHOR MISSING */'
  let d = 0, j = s.indexOf('{', i)
  for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break }
  return s.slice(0, i) + s.slice(j + 1)
}
const rep = (s, a, b) => s.includes(a) ? s.split(a).join(b) : s + '\n/* MUTATION ANCHOR MISSING */'
const MUT = {
  'phone-field': ['sporta-ui.css', (s) => cutBlock(cutBlock(s, 'div:has(> #f-phone) {'), 'div:has(> #f-phone):focus-within {')],
  'phone-focus': ['sporta-ui.css', (s) => cutBlock(s, 'div:has(> #f-phone):focus-within {')],
  features: ['trust-strip.js', (s) => rep(s, 'min-height:180px', 'min-height:260px')],
  controls: ['sporta-ui.css', (s) => cutBlock(s, '@media (hover: hover) and (pointer: fine) {\n  .admin-content :is(')],
  'bell-pad': ['sporta-desktop.css', (s) => rep(s, '.admin-shell main.admin-content { padding-top: 4rem; }', '')],
  'bell-jump': ['sporta-desktop.css', (s) => cutBlock(s, '.admin-content nav.spux-jump {')],
  'seo-rows': ['seo-screen.js', (s) => rep(s, 'padding:0}.spseo-prod[open]{padding-bottom:12px}', 'padding:8px 0}')],
  'cat-grid': ['category-art.js', (s) => rep(rep(s, 'grid-template-columns:minmax(0,1fr);gap:14px}', 'grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:14px}'), '@container (min-width:', '@container (min-width:9999')],
  'cat-phone': ['category-art.js', (s) => rep(s, "'@media (max-width:767.98px){.cta-grid", "'@media (max-width:1px){.cta-grid")],
  'cat-editing': ['category-art.js', (s) => rep(s, '.cta-tile:not(.editing) .cta-btn{', '.cta-tile .cta-btn{')],
  checkbox: ['payments-screen.js', (s) => rep(s, '.spps-sw{width:20px;height:20px;', '.spps-sw{width:44px;height:26px;')],
  setup: ['setup-screen.js', (s) => rep(s, "el('h3', 'spsetup-h'", "el('h2', 'spsetup-h'")],
  'setup-rows': ['setup-screen.js', (s) => rep(s, '.spsetup-body{flex:1 1 170px}', '')],
  'save-bar': ['panel-save-bar.js', (s) => rep(s, "'@media (max-width:767px){body:has(.m-tabbar)", "'@media (max-width:1px){body:has(.m-tabbar)")],
  'save-bar-move': ['panel-save-bar.js', (s) => rep(s, 'padding:8px 16px 68px;clip-path:inset(-40px 0 60px 0)', 'bottom:60px;padding:8px 16px')],
  chart: ['sporta-ui.css', (s) => cutBlock(cutBlock(s, '.admin-content .h-28.items-end > .group {'), '.admin-content .h-28.items-end > .group > span {')],
  'bell-phone': ['notification-center.js', (s) => rep(s, "@media (max-width:767px){html[data-theme='light'] .spnc-btn", "@media (max-width:1px){html[data-theme='light'] .spnc-btn")],
}
if (MUTATE && !MUT[MUTATE]) { console.log('unknown MUTATE=' + MUTATE + '; one of ' + Object.keys(MUT).join(', ')); process.exit(2) }

const b = await chromium.launch({ executablePath: EXE })
const PIXEL = devices['Pixel 7']
async function context(kind, lang = 'en', extra = {}) {
  const opts = kind === 'phone' ? { ...PIXEL } : kind === 'iphone' ? { ...devices['iPhone 13'] } : { viewport: { width: kind, height: 900 } }
  const ctx = await b.newContext({ ...opts, ...extra })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  await ctx.route(/\/api\/admin\.php\?r=/, (r) => {
    const q = r.request()
    if (q.method() !== 'GET' && !/[?&]r=login\b/.test(q.url())) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    return r.continue()
  })
  if (MUTATE) {
    const [file, fn] = MUT[MUTATE]
    await ctx.route(new RegExp('/assets/' + file.replace('.', '\\.') + '(\\?|$)'), async (r) => {
      const resp = await r.fetch(); const body = fn(await resp.text())
      await r.fulfill({ response: resp, body, headers: { ...resp.headers(), 'cache-control': 'no-store' } })
    })
  }
  return ctx
}
async function signIn(p) {
  execSync('mariadb -u sporta -plocaldev sporta -e "delete from rate_limit; delete from rate_bucket"')
  await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await p.locator('input[type=password]').count()) {
    await p.fill('input[autocomplete^=username], input[type=email]', 'manager@sporta.com.kw')
    await p.fill('input[type=password]', 'correct horse')
    await p.locator('form button[type=submit], form button').first().click()
  }
  await p.waitForSelector('.admin-content', { timeout: 15000 })
  await p.waitForTimeout(1200)
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function screen(p, name, phone, wait = 2200) {
  const sel = phone ? '.m-tabbar__item' : '.admin-sidebar button'
  await p.locator(sel).filter({ hasText: new RegExp('^\\s*' + esc(name) + '\\s*$') }).first().click()
  await p.waitForTimeout(wait)
}

/* ============================================================== 1. checkout mobile number */
if (run('phone-field')) {
  const stock = await (await fetch(BASE + '/api/api.php?r=stock')).json()
  const prods = await (await fetch(BASE + '/api/api.php?r=products')).json()
  const list = Array.isArray(prods) ? prods : prods.products || []
  const it = stock.find((r) => r.in_stock && r.stock > 0 && list.some((x) => x.slug === r.slug))
  const pr = list.find((x) => x.slug === it.slug)
  for (const [kind, tag] of [['phone', 'phone'], [1280, 'desktop']]) for (const lang of ['en', 'ar']) {
    const ctx = await context(kind, lang)
    await ctx.addInitScript((row) => { try { if (!localStorage.getItem('sporta_cart_seeded')) { localStorage.setItem('sporta_cart', JSON.stringify([row])); localStorage.setItem('sporta_cart_seeded', '1') } } catch (e) {} },
      { key: `${it.slug}__${it.size}__-`, slug: it.slug, size: it.size, fit: null, name: pr.name_en || pr.name || it.slug, price: Number(pr.price) || 1, qty: 1 })
    const p = await ctx.newPage()
    await p.goto(BASE + '/checkout?lang=' + lang, { waitUntil: 'networkidle' })
    const there = await p.waitForSelector('#f-phone', { timeout: 15000 }).then(() => true, () => false)
    check(there, `${tag} ${lang}: the checkout form is on screen (a real item in the bag)`)
    if (!there) { await ctx.close(); continue }
    await p.waitForTimeout(600)
    const m = await p.evaluate(() => {
      const inp = document.getElementById('f-phone'), w = inp.parentElement, name = document.getElementById('f-name')
      const R = (e) => e.getBoundingClientRect(), cs = (e) => getComputedStyle(e)
      return { wH: R(w).height, nameH: R(name).height, inH: R(inp).height, pad: cs(w).paddingTop + ' ' + cs(w).paddingLeft,
        edge: cs(w).borderTopColor, nameEdge: cs(name).borderTopColor, wL: R(w).left, spanL: R(w.firstElementChild).left, inR: R(inp).right, wR: R(w).right }
    })
    check(Math.abs(m.wH - m.nameH) <= 1, `${tag} ${lang}: the mobile-number field is as tall as Full name (${r1(m.wH)} vs ${r1(m.nameH)}px; was 72-73)`)
    check(m.pad === '0px 0px', `${tag} ${lang}: no padding inside the wrapper, so it is ONE box`, m.pad)
    check(m.inH >= m.wH - 2.5 && m.wR - m.inR <= 1.5 && m.spanL - m.wL <= 1.5, `${tag} ${lang}: +965 and the input fill the field edge to edge`, JSON.stringify(m))
    check(m.edge === m.nameEdge, `${tag} ${lang}: its edge is the same colour as the other fields' (${m.edge})`, m.nameEdge)
    await p.locator('#f-phone').focus(); await p.waitForTimeout(250)
    const ring = await p.evaluate(() => getComputedStyle(document.getElementById('f-phone').parentElement).boxShadow)
    check(ring && ring !== 'none', `${tag} ${lang}: focusing it shows a ring on the field (the input's own outline is clipped)`, ring)
    await p.locator('#f-phone').fill('123'); await p.locator('#f-email').focus(); await p.waitForTimeout(350)
    const bad = await p.evaluate(() => getComputedStyle(document.getElementById('f-phone').parentElement).borderTopColor)
    const [r, g] = (bad.match(/\d+/g) || []).map(Number)
    check(r > g + 60, `${tag} ${lang}: a wrong number still turns the field's edge red (${bad})`)
    await ctx.close()
  }
}

/* ============================================================== 2. features band */
if (run('features')) {
  for (const [kind, lang] of [[1280, 'en'], [1280, 'ar'], [1920, 'ar'], [820, 'en'], ['phone', 'en'], ['phone', 'ar']]) {
    const ctx = await context(kind, lang); const p = await ctx.newPage()
    await p.goto(BASE + '/?lang=' + lang, { waitUntil: 'networkidle' })
    const ok = await p.waitForSelector('.sts-wrap .sts-panel', { timeout: 12000 }).then(() => true, () => false)
    check(ok, `${kind} ${lang}: the features band is on the home page`)
    if (!ok) { await ctx.close(); continue }
    await p.waitForTimeout(500)
    const m = await p.evaluate(() => {
      const pn = document.querySelector('.sts-wrap .sts-panel'), list = pn.querySelector('.sts'), R = (e) => e.getBoundingClientRect(), cs = getComputedStyle(pn)
      return { h: R(pn).height, minH: cs.minHeight, pad: cs.paddingTop + ' ' + cs.paddingLeft, rows: pn.querySelectorAll('.sts-item').length,
        inTop: R(list).top - R(pn).top, inBot: R(pn).bottom - R(list).bottom }
    })
    if (kind === 'phone') {
      check(m.minH === '200px' && m.pad === '36px 28px', `phone ${lang}: the owner's 2026-10-07 phone panel is untouched (min-height ${m.minH}, padding ${m.pad})`)
    } else {
      check(m.h <= 181 && m.rows <= 3, `${kind} ${lang}: the band is 180px for ${m.rows} rows, not 260 (${r1(m.h)}px)`)
      check(m.inTop >= 44 && m.inBot >= 44, `${kind} ${lang}: and keeps about the phone's room around the rows (${r1(m.inTop)} above, ${r1(m.inBot)} below)`)
    }
    await ctx.close()
  }
}

/* ============================================================== 3. overlay controls on a mouse */
const LIST = (() => {   // the class list, parsed out of the stylesheet source rather than restated here
  const css = readFileSync(new URL('../sporta-site/css/90-panel-sizes.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const m = /\.admin-content :is\(([^)]*)\)/.exec(css)
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : []
})()
/* Left as they are, with the reason the stylesheet gives. Not a way out for anything new. */
const KEEP = { 'stc-hex': 'palette row', 'stc-swatch': 'palette row', 'stc-clear': 'palette row', 'crm-cust': 'a three-line customer row' }
if (run('controls')) {
  check(LIST.length >= 50, `the stylesheet's control list was read (${LIST.length} classes)`)
  const ctx = await context(1280); const p = await ctx.newPage()
  await signIn(p)
  let seen = 0, react = 0
  for (const name of ['Inventory', 'Settings', 'Payments', 'SEO', 'Setup', 'Slides', 'Security', 'Orders']) {
    await screen(p, name, false, 2500)
    const m = await p.evaluate(({ list, keep }) => {
      const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0
      const listed = [...document.querySelectorAll(list.map((c) => '.admin-content ' + c).join(','))].filter((e) => vis(e) && e.tagName !== 'TEXTAREA')
      const big = listed.filter((e) => e.getBoundingClientRect().height > 41 || parseFloat(getComputedStyle(e).fontSize) > 15)
        .map((e) => e.className + ' ' + Math.round(e.getBoundingClientRect().height) + '/' + getComputedStyle(e).fontSize)
      const isReact = (e) => Object.keys(e).some((k) => k.startsWith('__reactFiber'))
      const ctl = [...document.querySelectorAll('.admin-content button, .admin-content select, .admin-content input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=color]):not([type=range])')].filter(vis)
      const overlay = ctl.filter((e) => !isReact(e) && !e.closest('[role=dialog], .fixed, .spux-jump') && ![...e.classList].some((c) => keep[c]))
      const stray = overlay.filter((e) => e.getBoundingClientRect().height > 42.5).map((e) => (e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height) + ' "' + (e.textContent || e.placeholder || '').trim().slice(0, 24) + '"')
      return { listed: listed.length, big, overlay: overlay.length, react: ctl.filter(isReact).length, stray }
    }, { list: LIST, keep: KEEP })
    seen += m.listed; react += m.react
    check(m.big.length === 0, `1280 ${name}: every listed overlay control is at most 41px with 14.7px text (${m.listed} measured)`, m.big.slice(0, 6).join(' | '))
    check(m.overlay > 0, `1280 ${name}: the sweep found the overlays' controls (${m.overlay}; the bundle's ${m.react})`)
    check(m.stray.length === 0, `1280 ${name}: no control an overlay drew is taller than 42.5px on a mouse`, m.stray.slice(0, 6).join(' | '))
  }
  check(seen >= 120, `the listed controls were actually found on the screens (${seen})`)
  check(react >= 20, `and the sweep can tell the bundle's controls apart (${react} carry a React fiber)`)
  // the ± step buttons and the save bar's own button
  await screen(p, 'Inventory', false, 2500)
  await p.locator('select[aria-label="Product to edit"]').selectOption({ index: 1 }); await p.waitForTimeout(500)
  const step = await p.evaluate(() => {
    const s = [...document.querySelectorAll('.admin-content .spinv-step')].filter((e) => e.offsetParent), box = document.querySelector('.admin-content .spinv-num')
    return { n: s.length, h: s.map((e) => e.getBoundingClientRect().height), box: box ? box.getBoundingClientRect().height : 0 }
  })
  check(step.n >= 2 && step.h.every((h) => h <= 41 && Math.abs(h - step.box) <= 1.5), `1280 Inventory: the per-size - / + buttons are 40px, as tall as the stock box between them (${step.h.slice(0, 2).map(r1).join('/')} vs ${r1(step.box)}px)`)
  await screen(p, 'Settings', false, 2500)
  await p.locator('.spc-input').first().type('9', { delay: 20 }); await p.waitForTimeout(500)
  const go = await p.evaluate(() => { const g = document.querySelector('.spsb:not([hidden]) .spsb-go'); return g ? [g.getBoundingClientRect().height, getComputedStyle(g).fontSize] : null })
  check(!!go && go[0] <= 41 && parseFloat(go[1]) <= 15, `1280: the save bar's "Save changes" is 40px at 14.7px (${go && r1(go[0])}px, ${go && go[1]}; was 48.9)`)
  await ctx.close()
  // touch keeps its targets
  const pc = await context('phone'); const pp = await pc.newPage()
  await signIn(pp)
  for (const name of ['Inventory', 'Settings']) {
    await screen(pp, name, true, 2500)
    const t = await pp.evaluate((list) => {
      const els = [...document.querySelectorAll(list.map((c) => '.admin-content ' + c).join(','))].filter((e) => e.offsetParent !== null && e.tagName !== 'TEXTAREA')
      return { n: els.length, small: els.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.className + ' ' + Math.round(e.getBoundingClientRect().height)),
        inputs: els.filter((e) => e.tagName === 'INPUT').map((e) => parseFloat(getComputedStyle(e).fontSize)) }
    }, LIST)
    check(t.n > 5 && t.small.length === 0, `phone ${name}: the same ${t.n} controls keep a 44px touch target`, t.small.slice(0, 5).join(' | '))
    check(t.inputs.every((f) => f >= 16), `phone ${name}: and their fields keep 16px text (no iOS zoom)`, t.inputs.join(','))
  }
  await pc.close()
}

/* ============================================================== 4. the bell's gutter (computers) */
if (run('bell')) {
  for (const w of [1280, 1024]) {
    const ctx = await context(w); const p = await ctx.newPage()
    await signIn(p)
    for (const name of ['Discounts', 'Size charts', 'Reviews', 'Notifications', 'Overview', 'Settings', 'Security']) {
      await screen(p, name, false, 1800)
      await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(150)
      const m = await p.evaluate(() => {
        const bell = document.querySelector('[data-sporta-notif] .spnc-btn'); if (!bell) return null
        const B = bell.getBoundingClientRect(), host = document.querySelector('.admin-content')
        const hits = [...host.querySelectorAll('*')].filter((e) => {
          if (e.closest('.spux-jump') || !e.offsetParent) return false
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false
          return r.left < B.right && r.right > B.left && r.top < B.bottom && r.bottom > B.top
        }).map((e) => e.tagName + '.' + String(e.className).split(' ')[0])
        return { hits: hits.slice(0, 4), n: hits.length }
      })
      check(m && m.n === 0, `${w} ${name}: the bell covers nothing on the screen at rest`, m && m.hits.join(', '))
    }
    for (const name of ['Settings', 'Security']) {
      await screen(p, name, false, 2200)
      // twice: a screen change scrolls the page to the top itself, and can land after the first
      for (let i = 0; i < 2; i++) { await p.evaluate(() => window.scrollTo({ top: Math.min(1600, document.documentElement.scrollHeight - innerHeight - 40), behavior: 'instant' })); await p.waitForTimeout(400) }
      const j = await p.evaluate(() => {
        const bar = document.querySelector('.admin-content nav.spux-jump'), bell = document.querySelector('[data-sporta-notif] .spnc-btn')
        if (!bar || !bell) return null
        return { barR: bar.getBoundingClientRect().right, barTop: bar.getBoundingClientRect().top, bellL: bell.getBoundingClientRect().left, acR: document.querySelector('.admin-content').getBoundingClientRect().right, vw: innerWidth }
      })
      check(!!j, `${w} ${name}: the jump bar is on the screen to measure`)
      if (j) {
        check(j.barTop <= 1 && j.barR <= j.bellL, `${w} ${name}: stuck at the top, the jump bar ends left of the bell (${Math.round(j.barR)} < ${Math.round(j.bellL)})`, `bar top ${r1(j.barTop)}`)
        check(j.acR <= j.vw, `${w} ${name}: and the content area still fits the window (${Math.round(j.acR)} in ${j.vw})`)
      }
    }
    await ctx.close()
  }
}

/* ============================================================== 5. SEO product rows */
if (run('seo-rows')) {
  for (const kind of [1280, 'phone']) {
    const ctx = await context(kind); const p = await ctx.newPage()
    await signIn(p); await screen(p, 'SEO', kind === 'phone', 3000)
    await p.waitForSelector('details.spseo-prod', { timeout: 10000 }).catch(() => {})
    const m = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('details.spseo-prod')].filter((e) => e.offsetParent)
      const tops = rows.map((e) => e.getBoundingClientRect().top), pitch = []
      for (let i = 1; i < Math.min(tops.length, 12); i++) pitch.push(tops[i] - tops[i - 1])
      const s = rows[0] && rows[0].querySelector('summary')
      return { n: rows.length, pitch: pitch.length ? Math.max(...pitch.filter((x) => x < 80)) : 0, sumH: s ? s.getBoundingClientRect().height : 0 }
    })
    check(m.n > 10, `${kind}: the Product SEO list is on the screen (${m.n} rows)`)
    check(m.pitch > 0 && m.pitch <= 46, `${kind}: one-line rows are 45px apart, not 61 (${r1(m.pitch)}px)`)
    check(m.sumH >= 43.5, `${kind}: each row's tap target is still 44px (${r1(m.sumH)}px)`)
    if (kind === 1280) {
      await p.locator('details.spseo-prod summary').first().click(); await p.waitForTimeout(300)
      const pb = await p.evaluate(() => getComputedStyle(document.querySelector('details.spseo-prod[open]')).paddingBottom)
      check(pb === '12px', `${kind}: an opened row keeps 12px under its Save button (${pb})`)
    }
    await ctx.close()
  }
}

/* ============================================================== 6. Category pictures grid */
if (run('cat-grid')) {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQklEQVR42u3OMQ0AAAgDIN8/tFvBQwIK6E4yD6tQUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVHxtgFkoTTRe8mGJwAAAABJRU5ErkJggg==', 'base64')
  for (const kind of [1024, 1280, 1366, 1920, 'phone']) {
    const ctx = await context(kind); const p = await ctx.newPage()
    await signIn(p); await screen(p, 'Slides', kind === 'phone', 2800)
    const ok = await p.waitForSelector('.cta-grid .cta-tile', { timeout: 10000 }).then(() => true, () => false)
    check(ok, `${kind}: the Category pictures card is on the Slides screen`)
    if (!ok) { await ctx.close(); continue }
    const m = await p.evaluate(() => {
      const g = document.querySelector('.cta-grid'), tiles = [...g.querySelectorAll('.cta-tile')]
      const rows = {}; tiles.forEach((t) => { const y = Math.round(t.getBoundingClientRect().top); rows[y] = (rows[y] || 0) + 1 })
      return { tiles: tiles.length, perRow: Object.values(rows), cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, card: g.closest('.cta').getBoundingClientRect().height, sw: document.documentElement.scrollWidth, vw: innerWidth }
    })
    const want = kind === 'phone' ? 2 : kind === 1024 ? 2 : 4
    check(m.tiles === 4 && m.cols !== 3 && m.perRow.every((n) => n === m.perRow[0]), `${kind}: four tiles in even rows, never three columns (${m.perRow.join('+')})`)
    check(m.cols === want, `${kind}: ${want} per row (${m.cols})`)
    if (kind === 1280) check(m.card < 520, `1280: the card is about 415px, not 858 (${Math.round(m.card)}px)`)
    if (kind === 'phone') check(m.card < 800, `phone: the card is about 680px, not 1,815 (${Math.round(m.card)}px)`)
    check(m.sw <= m.vw, `${kind}: no sideways scroll (${m.sw} in ${m.vw})`)
    if (kind === 'phone' || kind === 1280) {
      const file = p.locator('.cta-tile input[type=file]').nth(1)
      if (await file.count()) {
        await file.setInputFiles({ name: 'w.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(1200)
        const e = await p.evaluate(() => {
          const t = document.querySelector('.cta-tile.editing'); if (!t) return null
          const g = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect()
          const bt = [...t.querySelectorAll('.cta-btn')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().width)
          return { full: Math.abs(r.width - g.width) <= 1, maxBtn: Math.max(0, ...bt), tileW: r.width, sw: document.documentElement.scrollWidth, vw: innerWidth }
        })
        check(!!e && e.full, `${kind}: the tile being edited spans the whole row`)
        check(!!e && e.maxBtn < e.tileW * 0.9, `${kind}: and its Save / Cancel keep their own width (${e && Math.round(e.maxBtn)} of ${e && Math.round(e.tileW)})`)
        check(!!e && e.sw <= e.vw, `${kind}: editing does not widen the page`)
      }
    }
    await ctx.close()
  }
}

/* ============================================================== 7. Payments checkboxes */
if (run('checkbox')) {
  for (const [kind, want] of [[1280, 20], ['phone', 22]]) {
    const ctx = await context(kind); const p = await ctx.newPage()
    await signIn(p); await screen(p, 'Payments', kind === 'phone', 2500)
    const m = await p.evaluate(() => [...document.querySelectorAll('.spps-sw')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    check(m.length >= 3 && m.every(([w, h]) => w === want && h === want), `${kind}: the "Ways to pay" boxes are ${want}x${want}, not 44x26 (${m.map((x) => x.join('x')).join(', ')})`)
    await ctx.close()
  }
}

/* ============================================================== 8. Setup no longer hosts other screens */
if (run('setup')) {
  for (const kind of ['phone', 1280]) {
    const ctx = await context(kind); const p = await ctx.newPage()
    await signIn(p)
    const reqs = []; p.on('request', (r) => { if (/\/api\/admin\.php/.test(r.url())) reqs.push(r.url()) })
    await screen(p, 'Setup', kind === 'phone', 4500)
    const m = await p.evaluate(() => {
      const root = document.querySelector('.admin-content [data-spsetup]'); if (!root) return null
      const own = /^spsetup-/
      const foreign = [...root.children].filter((c) => ![...c.classList].some((k) => own.test(k))).map((c) => c.className || c.tagName)
      const jump = [...document.querySelectorAll('.admin-content .spux-jump button')].map((x) => x.textContent.trim())
      return { foreign, heads: [...root.querySelectorAll('.spsetup-h')].map((h) => h.tagName), h: document.documentElement.scrollHeight, jump,
        folds: root.querySelectorAll('.pt-toggle').length, groups: root.querySelectorAll('.spsetup-sec').length }
    })
    check(!!m, `${kind}: the Setup checklist is on the screen`)
    if (!m) { await ctx.close(); continue }
    check(m.foreign.length === 0, `${kind}: no other screen's card is mounted inside it (was 20)`, m.foreign.slice(0, 6).join(' | '))
    check(m.groups >= 6 && m.heads.every((t) => t === 'H3'), `${kind}: its ${m.groups} group headings are h3, which no overlay mounts under`, m.heads.join(','))
    check(m.h < (kind === 'phone' ? 6000 : 3200), `${kind}: the screen is ${m.h}px (was 19,682 on a phone, 13,561 at 1280)`)
    check(reqs.length <= 4, `${kind}: opening it asks the server ${reqs.length} time(s), not 68`, reqs.slice(0, 8).join(' '))
    if (m.jump.length) check(m.jump.includes('Payments') && m.jump.includes('Settings') && !m.jump.includes('Payment setup'), `${kind}: the Jump-to bar lists the checklist's own groups only`, m.jump.join(' | '))
    check(m.folds === 0, `${kind}: panel-tidy puts no fold toggle inside it`)
    // the collateral fault: Settings lost its cards after a visit to Setup
    await screen(p, 'Settings', kind === 'phone', 3500)
    const s = await p.evaluate(() => ['.spc', '.ssu', '.stc', '.sdt', '.bkp', '.sle'].map((c) => [c, document.querySelectorAll('.admin-content ' + c).length]))
    check(s.every(([, n]) => n >= 1), `${kind}: after Setup, the Settings screen still has all its cards`, JSON.stringify(s))
    // and every card that used to mount a second copy inside Setup still mounts, once, on its own screen
    if (kind === 1280) for (const [name, cls] of [['Payments', ['.spk', '.srl', '.spw']], ['Catalogue', ['.spa', '.spp']], ['Brands', ['.sbl', '.sbi']]]) {
      await screen(p, name, false, 1500)
      await p.waitForFunction((cls) => cls.every((c) => document.querySelector('.admin-content ' + c)), cls, { timeout: 10000 }).catch(() => {})
      await p.waitForTimeout(800)
      const n = await p.evaluate((cls) => cls.map((c) => [c, document.querySelectorAll('.admin-content ' + c).length]), cls)
      check(n.every(([, k]) => k === 1), `${kind}: ${name} has each of its cards exactly once`, JSON.stringify(n))
    }
    await ctx.close()
  }
}

/* ============================================================== 9. Setup rows on a phone */
if (run('setup-rows')) {
  for (const lang of ['en', 'ar']) {
    const ctx = await context('phone', lang); const p = await ctx.newPage()
    await signIn(p); await screen(p, 'Setup', true, 3500)
    const m = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.spsetup-row')].filter((r) => r.offsetParent)
      const R = (e) => e.getBoundingClientRect()
      const beside = rows.filter((r) => { const d = R(r.querySelector('.spsetup-dot')), bd = R(r.querySelector('.spsetup-body')); return bd.left >= d.right && Math.abs(bd.top - d.top) < 8 }).length
      const aligned = rows.filter((r) => { const go = r.querySelector('.spsetup-go, .spsetup-where'); if (!go) return true; return Math.abs(R(go).left - R(r.querySelector('.spsetup-body')).left) <= 8 }).length
      const hs = rows.map((r) => R(r).height)
      return { n: rows.length, avg: hs.reduce((a, b) => a + b, 0) / (hs.length || 1), max: Math.max(...hs), beside, aligned, sw: document.documentElement.scrollWidth, vw: innerWidth }
    })
    check(m.n >= 15, `phone ${lang}: the checklist rows are on the screen (${m.n})`)
    check(m.beside === m.n, `phone ${lang}: on every row the text sits beside its pill, not under it (${m.beside} of ${m.n})`)
    check(m.aligned === m.n, `phone ${lang}: the button lines up under the text it belongs to (${m.aligned} of ${m.n})`)
    check(m.avg < 150, `phone ${lang}: rows average ${Math.round(m.avg)}px, not 172`)
    check(m.sw <= m.vw, `phone ${lang}: no sideways scroll`)
    await ctx.close()
  }
}

/* ============================================================== 10. save bar on a phone */
if (run('save-bar')) {
  for (const dev of ['phone', 'iphone']) {
    const ctx = await context(dev)
    const p = await ctx.newPage()
    await signIn(p); await screen(p, 'Settings', true, 3000)
    await p.locator('.spc-input').first().tap(); await p.keyboard.type('9'); await p.waitForTimeout(600)
    const m = await p.evaluate(() => {
      const bar = document.querySelector('.spsb:not([hidden])'), tabs = document.querySelector('.m-tabbar'); if (!bar || !tabs) return null
      const B = bar.getBoundingClientRect(), T = tabs.getBoundingClientRect(), go = bar.querySelector('.spsb-go').getBoundingClientRect()
      const items = [...tabs.querySelectorAll('.m-tabbar__item')].filter((t) => { const r = t.getBoundingClientRect(), x = r.left + r.width / 2; return x > 2 && x < innerWidth - 2 })   // the strip scrolls sideways
      const reach = items.map((t) => { const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && !!hit.closest('.m-tabbar') })
      const goHit = document.elementFromPoint(go.left + go.width / 2, go.top + go.height / 2)
      return { barTop: B.top, tabTop: T.top, goBottom: go.bottom, goH: go.height, reach: reach.filter(Boolean).length, items: items.length, goOk: !!goHit && !!goHit.closest('.spsb-go') }
    })
    check(!!m, `${dev}: the save bar came up after an edit`)
    if (!m) { await ctx.close(); continue }
    check(m.reach === m.items && m.items > 2, `${dev}: every tab is reachable while a change is unsaved (${m.reach} of ${m.items})`)
    check(m.goBottom <= m.tabTop + 0.5 && m.goOk && m.goH >= 43.5, `${dev}: "Save changes" sits above the tab bar, tappable, 44px (${r1(m.goBottom)} <= ${r1(m.tabTop)})`)
    // the toast the panel shows after a write must clear the bar (the write is answered here, not sent)
    await p.evaluate(() => fetch('/api/admin.php?r=settings_save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: '{}' }))
    await p.waitForTimeout(500)
    const t = await p.evaluate(() => { const t = document.querySelector('.spux-toast.spux-toast--in'), bar = document.querySelector('.spsb:not([hidden])'); return t && bar ? { tb: t.getBoundingClientRect().bottom, bt: bar.getBoundingClientRect().top } : null })
    if (t) check(t.tb <= t.bt + 0.5, `${dev}: the save toast sits above the bar, not over its button (toast bottom ${r1(t.tb)}, bar top ${r1(t.bt)})`)
    else check(false, `${dev}: a save toast appeared to measure`)
    // and a tab actually changes the screen
    const tab = p.locator('.m-tabbar__item').filter({ hasText: /^\s*Inventory\s*$/ }).first()
    await tab.scrollIntoViewIfNeeded(); const bb = await tab.boundingBox()
    await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1500)
    const h1 = await p.evaluate(() => (document.querySelector('.admin-content h1') || {}).textContent || '')
    check(/Inventory/.test(h1), `${dev}: tapping the Inventory tab leaves Settings with the bar up`, h1)
    await ctx.close()
  }
}

/* ============================================================== 11. revenue chart */
if (run('chart')) {
  const series = []
  for (let i = 0; i < 14; i++) { const d = new Date(Date.UTC(2026, 8, 20 + i)); series.push({ day: d.toISOString().slice(0, 10), revenue: (i === 6 ? 100 : 2 + i * 7).toFixed(3) }) }
  for (const kind of ['phone', 1280]) {
    const ctx = await context(kind)
    await ctx.route(/\/api\/admin\.php\?r=revenue/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(series) }))
    const p = await ctx.newPage()
    await signIn(p); await screen(p, 'Overview', kind === 'phone', 2500)
    const m = await p.evaluate(() => {
      const row = document.querySelector('.admin-content .h-28.items-end'); if (!row) return null
      const cols = [...row.children], bars = cols.map((c) => c.firstElementChild.getBoundingClientRect().height)
      const lab = cols.map((c) => { const s = c.querySelector('span'), r = s.getBoundingClientRect(), cr = c.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - (cr.left + cr.right) / 2) < 1.5 && r.bottom <= cr.bottom + 0.5 })
      return { n: cols.length, bars, colH: cols[0].getBoundingClientRect().height, rowH: row.getBoundingClientRect().height, card: row.closest('section').getBoundingClientRect().height, lab: lab.every(Boolean) }
    })
    check(!!m && m.n === 14, `${kind}: the revenue chart is drawn with the 14 days (${m && m.n})`)
    if (!m) { await ctx.close(); continue }
    const max = Math.max(...m.bars), vals = series.map((s) => +s.revenue), vmax = Math.max(...vals)
    const off = m.bars.map((h, i) => Math.abs(h - Math.max(vals[i] / vmax * 100, 2) / 100 * max))
    check(max >= m.rowH - 30 && max > 60, `${kind}: the biggest day's bar is drawn at ${r1(max)}px of a ${r1(m.rowH)}px chart (was 0)`)
    check(Math.max(...off) <= 1.5, `${kind}: every bar is in proportion to its day's revenue (worst ${r1(Math.max(...off))}px off)`)
    check(m.lab, `${kind}: each date label stays centred under its bar`)
    check(m.card < 205, `${kind}: the card is the size it was (${r1(m.card)}px)`)
    await ctx.close()
  }
}

/* ============================================================== 12. the bell on a phone */
if (run('bell-phone')) {
  for (const kind of ['phone', 1280]) {
    const ctx = await context(kind); const p = await ctx.newPage()
    await signIn(p); await p.waitForSelector('[data-sporta-notif] .spnc-btn', { timeout: 8000 }).catch(() => {})
    const m = await p.evaluate(() => {
      const b = document.querySelector('[data-sporta-notif] .spnc-btn'); if (!b) return null
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b)
      const so = [...document.querySelectorAll('button')].find((x) => /^\s*Sign out\s*$/.test(x.textContent) && x.offsetParent)
      const s = so && so.getBoundingClientRect()
      return { w: r.width, h: r.height, bg: cs.backgroundColor, bd: cs.borderTopColor, theme: document.documentElement.getAttribute('data-theme'),
        clear: !s || r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom }
    })
    check(!!m, `${kind}: the bell is on the screen`)
    if (!m) { await ctx.close(); continue }
    const clearPaint = /rgba\(0, 0, 0, 0\)|transparent/.test(m.bg)
    if (kind === 'phone') {
      check(m.theme === 'light' && clearPaint && /rgba\(0, 0, 0, 0\)|transparent/.test(m.bd), `phone: no dark tile in the light header (background ${m.bg})`)
      check(m.w >= 44 && m.h >= 44 && m.clear, `phone: the tap box is still 44x44 and clear of Sign out (${m.w}x${m.h})`)
    } else check(!clearPaint, `1280: on a computer the bell keeps its plate over scrolling content (${m.bg})`)
    await ctx.close()
  }
}

await b.close()
console.log(fails ? `\n${fails} failed${MUTATE ? ' (MUTATE=' + MUTATE + ')' : ''}` : `\nall ok${MUTATE ? ' — but MUTATE=' + MUTATE + ' was set, so this mutation was NOT caught' : ''}`)
process.exit(fails ? 1 : 0)
