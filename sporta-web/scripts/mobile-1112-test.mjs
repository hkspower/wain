// npm run test:mobile-1112 - proves the MOBILE-1112 section of public/sporta-shadows.css and the MOBILE-1112 block at the end of
// public/sporta-features.js on the CAPTURED LIVE pages under the LIVE compiled rules (scripts/lib/shape-pages.mjs), each page opened with
// the section OFF (the file without it) and ON (the repo file). The audit that found each item is scripts/mobile-1112-audit.mjs.
//   [mob-1] hero dots     OFF: 40px tall, the row spills off a 320px screen and overlaps the slide button by 4px.
//                         ON: 44px tall, contiguous, inside the screen, clear of the button, the dots themselves unchanged; 768px+ untouched
//   [mob-2] footer links  ON: every footer text link 44x44 or more (OFF: some under 44 wide), no two overlap, the footer the same height
//   [mob-3] contents      /terms contents rows 36 -> 44px, none overlap
//   [mob-4] text floor    the listed reading texts are 14px or more (OFF: under 14); no text gets smaller anywhere; no text box newly
//                         overflows its box and no home tile clips more than OFF
//   [mob-5] landscape     844x390 and 568x320: OFF the header stays pinned after a scroll (126-141px of the screen), ON it scrolls away;
//                         at the top of the page it is the same box ON and OFF (no shift); portrait keeps it pinned
//   [mob-6] bottom bar    /checkout at the end of the page: OFF the footer's last lines sit under the pay bar, ON every footer text ends
//                         8px or more above it; a page without a bar keeps its footer
//   global                every page, both languages, light and dark, 320/360/390/430 and 844x390: no sideways scroll ON, and no tap
//                         target that was 44px or more OFF is under 44 ON
//   features.js           [mob-js-1] the hints are added where absent and never overwrite; checkout untouched.
//                         [mob-js-2] in an installed app a window touchmove listener (the compiled pull-to-refresh) no longer sees a drag
//                         on a form page or inside a field / dialog / drawer, a listener at the app root still does, and a drag on the
//                         home page still reaches window; in a browser tab nothing is stopped
//   file + MUTATION       one section, before ICON SET, scoped to .storefront-root; the section removed, and each block removed on
//                         its own, fails checks
//   QUICK=1 narrows the global sweep to 390 and light.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES, start, FILE, ROOT } from './lib/shape-pages.mjs'

let pass = 0, fail = 0
let sink = null
const is = (ok, msg, d = '') => { if (sink) { if (!ok) sink.push(msg); return ok } if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } return ok }
const head = (t) => console.log(`\n=== ${t}`)

const MARK = '/* ==== MOBILE-1112:', END = '/* ==== end MOBILE-1112 */'
const FULL = readFileSync(FILE, 'utf8')
const cut = (css, a, b) => { const i = css.indexOf(a), j = css.indexOf(b, i); return i < 0 || j < 0 ? css : css.slice(0, i) + css.slice(j + b.length) }
const OFF = cut(FULL, MARK, END)
const SECTION = FULL.slice(FULL.indexOf(MARK), FULL.indexOf(END) + END.length)
const BLOCKS = ['mob-1', 'mob-2', 'mob-3', 'mob-4', 'mob-5', 'mob-6']
const withoutBlock = (id) => { const i = FULL.indexOf(`/* [${id}] */`); const n = FULL.indexOf('/* [mob-', i + 5); const j = n < 0 || n > FULL.indexOf(END) ? FULL.indexOf(END) : n; return FULL.slice(0, i) + FULL.slice(j) }
const QUICK = !!process.env.QUICK

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const S = await start(browser)
const pg = (id) => PAGES.find((p) => p.id === id)
const run = async (id, lang, w, css, fn, opts = {}, arg) => { const { p, ctx } = await S.open(pg(id), lang, w, css, opts); try { return await p.evaluate(fn, arg) } finally { await ctx.close() } }

// ---- in-page measurements ---------------------------------------------------------------------------------------------------
const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
const heroM = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const car = document.querySelector('[aria-roledescription="carousel"]')
  const row = [...car.children].find((c) => c.classList.contains('absolute') && c.querySelector(':scope > button'))
  const btns = [...row.children].filter((b) => b.tagName === 'BUTTON')
  const cta = car.querySelector('[aria-hidden="false"] .campaign-hero-cta')
  // a touch at each boundary between two buttons, and 2px inside each edge, lands on a button
  const yc = R(btns[0]).t + R(btns[0]).h / 2
  const seams = btns.slice(1).map((b, i) => { const a = R(btns[i]), c = R(b); const x = (Math.min(a.r, c.r) + Math.max(a.l, c.l)) / 2; const h = document.elementFromPoint(x, yc); return !!h && !!h.closest('button') && row.contains(h) })
  return { vw: document.documentElement.clientWidth, row: R(row), btns: btns.map(R), dots: btns.map((b) => (b.firstElementChild ? R(b.firstElementChild) : null)), cta: cta && R(cta), car: R(car), seams }
}
const footM = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height } }
  const f = document.querySelector('footer.app-footer')
  const links = [...document.querySelectorAll('footer.app-footer .footer-links a.inline-flex')].map(R)
  const overlap = links.some((a, i) => links.some((b, j) => j > i && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5))
  return { fh: f ? f.getBoundingClientRect().height : 0, links, overlap }
}
const contentsM = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height } }
  const a = [...document.querySelectorAll('.legal-page__contents a')].map(R)
  return { a, overlap: a.some((x, i) => i && x.t < a[i - 1].b - 0.5) }
}
const TEXT_SEL = '.customer-account__hint, .customer-account__terms, .sporta-bday__hint, .support-page__field > span, .returns-system label > span, .returns-system label > small, .returns-system__policy li, #tracking-help, .home-feature-sub, .catalog-page p[aria-live="polite"].text-xs'
const textM = (sel) => {
  const out = { listed: [], all: [], over: 0, tileClip: [] }
  document.querySelectorAll(sel).forEach((e) => { if (e.getBoundingClientRect().height > 0) out.listed.push(parseFloat(getComputedStyle(e).fontSize)) })
  document.querySelectorAll('body *').forEach((e) => {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) return
    const r = e.getBoundingClientRect(); if (r.height < 1) return
    out.all.push(parseFloat(getComputedStyle(e).fontSize))
  })
  document.querySelectorAll(sel).forEach((e) => { if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.getBoundingClientRect().height > 0) out.over++ })
  out.tileClip = [...document.querySelectorAll('.campaign-category')].map((t) => t.scrollHeight - t.clientHeight)
  out.docW = document.documentElement.scrollWidth - document.documentElement.clientWidth
  return out
}
const headerM = async () => {
  const h = document.querySelector('.app-header'); const at0 = h.getBoundingClientRect()
  scrollTo({ top: 600, behavior: 'instant' }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const after = h.getBoundingClientRect()
  return { pos: getComputedStyle(h).position, t0: at0.top, h0: at0.height, w0: at0.width, bAfter: after.bottom, y: scrollY }
}
const barM = () => {
  scrollTo({ top: 1e6, behavior: 'instant' })
  const bar = document.querySelector('.action-bar'), f = document.querySelector('footer.app-footer')
  const vis = bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0
  const texts = [...f.querySelectorAll('p, a, span')].filter((e) => e.getBoundingClientRect().height > 0)
  const last = Math.max(...texts.map((e) => e.getBoundingClientRect().bottom))
  return { vis, barTop: vis ? bar.getBoundingClientRect().top : innerHeight, last, pb: parseFloat(getComputedStyle(f).paddingBottom) }
}
const tapsM = () => {
  const out = []
  document.querySelectorAll('a[href], button, summary, select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])').forEach((e, i) => {
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return
    for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return }
    out.push({ i, w: r.width, h: r.height })
  })
  return { taps: out, docW: document.documentElement.scrollWidth - document.documentElement.clientWidth }
}

// ---- the checks (a function of the shadows css, so the mutation run can repeat them) -----------------------------------------------
async function checks(css) {
  // [mob-1]
  for (const lang of ['ar', 'en']) for (const w of [320, 360, 390, 430]) {
    const off = await run('screen/home', lang, w, OFF, heroM, { h: 800 }), on = await run('screen/home', lang, w, css, heroM, { h: 800 })
    if (css === FULL) is(off.btns.every((b) => b.h < 44) && off.cta.b > off.row.t, `[mob-1] ${lang} ${w} OFF: dots ${Math.round(off.btns[0].h)}px tall, button bottom ${Math.round(off.cta.b)} below row top ${Math.round(off.row.t)} (the live defect)`)
    if (css === FULL && w === 320) is(off.row.l < 0 || off.row.r > off.vw, `[mob-1] ${lang} 320 OFF: the row spills off the screen (${Math.round(off.row.l)}..${Math.round(off.row.r)})`)
    const minW = w >= 390 ? 44 : w >= 360 ? 40 : 36
    is(on.btns.every((b) => b.h >= 44 && b.w >= minW - 0.01), `[mob-1] ${lang} ${w}: every dot and the pause button is 44px tall and ${minW}px+ wide`, on.btns.map((b) => `${b.w.toFixed(1)}x${b.h}`).join(' '))
    is(on.btns.every((b) => b.l >= -0.5 && b.r <= on.vw + 0.5), `[mob-1] ${lang} ${w}: the whole row is inside the screen`)
    is(on.seams.every(Boolean), `[mob-1] ${lang} ${w}: a touch on every seam between two controls lands on a control (no gaps)`)
    is(on.cta.b <= on.row.t + 0.5, `[mob-1] ${lang} ${w}: the slide button ends at or above the row (button ${on.cta.b.toFixed(1)}, row ${on.row.t.toFixed(1)})`)
    is(on.dots.every((d, i) => !d || (Math.abs(d.w - off.dots[i].w) < 0.5 && Math.abs(d.h - off.dots[i].h) < 0.5)), `[mob-1] ${lang} ${w}: the dots and the pause icon keep their drawn size`)
    is(JSON.stringify(on.car) === JSON.stringify(off.car) && JSON.stringify(on.cta) === JSON.stringify(off.cta), `[mob-1] ${lang} ${w}: the hero and its button do not move`)
  }
  for (const lang of ['ar', 'en']) { const off = await run('screen/home', lang, 768, OFF, heroM), on = await run('screen/home', lang, 768, css, heroM); is(JSON.stringify(off.btns) === JSON.stringify(on.btns), `[mob-1] ${lang} 768: the row is untouched from 768px`) }
  // [mob-2]
  for (const id of ['screen/home', 'screen/terms', 'support']) for (const lang of ['ar', 'en']) for (const w of [320, 390]) {
    const off = await run(id, lang, w, OFF, footM), on = await run(id, lang, w, css, footM)
    if (css === FULL && lang === 'ar') is(off.links.some((l) => l.w < 44), `[mob-2] ${id} ar ${w} OFF: a footer link is under 44px wide (${Math.round(Math.min(...off.links.map((l) => l.w)))})`)
    is(on.links.length > 5 && on.links.every((l) => l.w >= 44 && l.h >= 43.9), `[mob-2] ${id} ${lang} ${w}: every footer link is 44x44 or more`, on.links.map((l) => Math.round(l.w)).join())
    is(!on.overlap && Math.abs(on.fh - off.fh) < 0.5, `[mob-2] ${id} ${lang} ${w}: no two footer links overlap, and the footer keeps its height`, `${off.fh} -> ${on.fh}`)
  }
  // [mob-3]
  for (const lang of ['ar', 'en']) for (const w of [320, 390]) {
    const off = await run('screen/terms', lang, w, OFF, contentsM), on = await run('screen/terms', lang, w, css, contentsM)
    if (css === FULL) is(off.a.every((a) => a.h < 40), `[mob-3] ${lang} ${w} OFF: the contents rows are ${Math.round(off.a[0].h)}px`)
    is(on.a.length >= 5 && on.a.every((a) => a.h >= 44) && !on.overlap, `[mob-3] ${lang} ${w}: every contents row is 44px or more and none overlap`, on.a.map((a) => a.h.toFixed(1)).join())
  }
  // [mob-4]
  for (const id of ['account-out', 'account-in', 'support', 'returns', 'track', 'screen/home', 'shop']) for (const lang of ['ar', 'en']) for (const w of [320, 390]) {
    const off = await run(id, lang, w, OFF, textM, {}, TEXT_SEL), on = await run(id, lang, w, css, textM, {}, TEXT_SEL)
    if (css === FULL) is(off.listed.some((f) => f < 14), `[mob-4] ${id} ${lang} ${w} OFF: reading text under 14px (${Math.min(...off.listed).toFixed(1)})`)
    is(on.listed.length > 0 && on.listed.every((f) => f >= 14), `[mob-4] ${id} ${lang} ${w}: every listed reading text is 14px or more`, on.listed.filter((f) => f < 14).join())
    const small = (a) => a.filter((f) => f < 14).length
    is(on.all.length === off.all.length && on.all.every((f, i) => f >= off.all[i] - 0.01) && small(on.all) < small(off.all), `[mob-4] ${id} ${lang} ${w}: no text gets smaller, and fewer are under 14px (${small(off.all)} -> ${small(on.all)})`)
    is(on.over === 0 && on.docW === 0 && on.tileClip.every((c, i) => c <= off.tileClip[i]), `[mob-4] ${id} ${lang} ${w}: no listed text overflows, nothing scrolls sideways, no home tile clips more`, `${on.over} ${on.docW} ${off.tileClip}->${on.tileClip}`)
  }
  // [mob-5]
  for (const id of ['screen/home', 'screen/terms', 'support']) for (const lang of ['ar', 'en']) for (const [w, h] of [[844, 390], [568, 320], [932, 430]]) {
    const off = await run(id, lang, w, OFF, headerM, { h }), on = await run(id, lang, w, css, headerM, { h })
    if (css === FULL) is(off.pos === 'sticky' && off.bAfter >= 120, `[mob-5] ${id} ${lang} ${w}x${h} OFF: after a scroll the header still covers ${Math.round(off.bAfter)}px of ${h}`)
    is(on.bAfter <= 0, `[mob-5] ${id} ${lang} ${w}x${h}: after a scroll the header is off the screen (bottom ${Math.round(on.bAfter)})`)
    is(on.t0 === off.t0 && on.h0 === off.h0 && on.w0 === off.w0, `[mob-5] ${id} ${lang} ${w}x${h}: at the top the header is the same box`)
  }
  for (const lang of ['ar', 'en']) { const on = await run('screen/home', lang, 390, css, headerM, { h: 844 }); is(on.pos === 'sticky' && on.bAfter > 100, `[mob-5] ${lang} 390x844 portrait: the header stays pinned`) }
  // [mob-6]
  for (const lang of ['ar', 'en']) for (const w of [320, 390, 768]) {
    const off = await run('screen/checkout', lang, w, OFF, barM, { h: 700 }), on = await run('screen/checkout', lang, w, css, barM, { h: 700 })
    if (!on.vis) { is(on.pb === off.pb || w >= 768, `[mob-6] ${lang} ${w}: no bar shown, footer unchanged`); continue }
    if (css === FULL) is(off.last > off.barTop, `[mob-6] ${lang} ${w} OFF: the footer's last line ends ${Math.round(off.last - off.barTop)}px under the pay bar`)
    is(on.last <= on.barTop - 8, `[mob-6] ${lang} ${w}: every footer text ends 8px or more above the pay bar (${Math.round(on.barTop - on.last)}px)`)
  }
  for (const lang of ['ar', 'en']) { const off = await run('screen/terms', lang, 390, OFF, barM), on = await run('screen/terms', lang, 390, css, barM); is(on.pb === off.pb, `[mob-6] ${lang} /terms (no bar): the footer is unchanged`) }
  { const off = await run('screen/checkout', 'ar', 1280, OFF, barM), on = await run('screen/checkout', 'ar', 1280, css, barM); is(on.pb === off.pb, '[mob-6] 1280: the desktop footer is unchanged') }
}

head('file')
is(FULL.indexOf(MARK) > 0 && FULL.indexOf(MARK, FULL.indexOf(MARK) + 1) < 0 && FULL.indexOf(END) > FULL.indexOf(MARK), 'one MOBILE-1112 section with its end marker')
is(FULL.indexOf(END) < FULL.indexOf('/* ==== ICON SET'), 'the section sits before ICON SET')
{
  const rules = SECTION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').split('}').map((s) => s.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'))
  // top-level commas only (a comma inside :is() or :has() does not start a new selector)
  const parts = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
  const sels = rules.flatMap(parts)
  is(sels.length > 8 && sels.every((x) => x.startsWith('.storefront-root')), 'every selector is scoped to .storefront-root', sels.filter((x) => !x.startsWith('.storefront-root')).join(' | '))
  is(!/!important|url\(|transition|color\s*:/.test(SECTION.replace(/\/\*[\s\S]*?\*\//g, '')), 'no !important, no url(), no transition, no colour')
  is(BLOCKS.every((b) => SECTION.includes(`/* [${b}] */`)), 'every block carries its marker')
}

head('section checks')
await checks(FULL)

head('global sweep: no sideways scroll, no tap target loses its 44px')
{
  const sizes = QUICK ? [[390, 844]] : [[320, 568], [360, 740], [390, 844], [430, 932], [844, 390]]
  const themes = QUICK ? ['light'] : ['light', 'dark']
  let n = 0
  for (const p of PAGES) for (const lang of ['ar', 'en']) for (const theme of themes) for (const [w, h] of sizes) {
    if (p.kind === 'prd' && ![320, 360, 390].includes(w)) continue
    const off = await run(p.id, lang, w, OFF, tapsM, { theme, h }), on = await run(p.id, lang, w, FULL, tapsM, { theme, h })
    const lost = off.taps.filter((t) => { const o = on.taps.find((x) => x.i === t.i); return (t.w >= 44 && o && o.w < 44) || (t.h >= 44 && o && o.h < 44) })
    if (!is(on.docW === 0 && lost.length === 0 && on.taps.length === off.taps.length, `${p.id} ${lang} ${theme} ${w}x${h}: no sideways scroll, no target lost size`, `docW ${on.docW}, lost ${lost.length}`)) continue
    n++
  }
  console.log(`  ${n} page states clean`)
}

head('features.js MOBILE-1112')
{
  const JS = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
  const bi = JS.indexOf('/* ===== MOBILE-1112 ('), be = JS.indexOf('/* ===== MOBILE-1112 - end')
  is(bi > 0 && be > bi && JS.slice(be).split('\n').length <= 2, 'features.js: the MOBILE-1112 block is the last block of the file')
  const BLOCK = JS.slice(bi, be)
  const page = (path, body) => async (standalone, js) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.host === 'fx.test' && u.pathname === path) return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><script>${standalone ? "Object.defineProperty(navigator,'standalone',{get:()=>true});" : ''}</script></head><body>${body}<script>${js}</script></body></html>` }); return r.fulfill({ status: 404, body: '' }) })
    const p = await ctx.newPage(); await p.goto('http://fx.test' + path); await p.waitForTimeout(250)
    return { p, ctx }
  }
  const FORM = '<div id="root" class="storefront-root"><main><form><label class="support-page__field"><span>Order</span><input id="ord" maxlength="30" autocapitalize="characters" dir="ltr"></label><label class="support-page__field"><span>Email</span><input id="em" type="email" autocomplete="email"></label><label><input id="nm" autocomplete="name"></label><input id="nm2" autocomplete="name" autocapitalize="sentences"></form><div class="purchase-flow"><input id="ck" autocomplete="name"></div><div id="plain" style="height:2000px"></div><div role="dialog" id="dlg"><p id="dp">x</p></div><aside class="campaign-cart-drawer"><ul><li id="dl">line</li></ul></aside></main></div>'
  const attrs = () => Object.fromEntries(['ord', 'em', 'nm', 'nm2', 'ck'].map((id) => { const e = document.getElementById(id); return [id, ['autocorrect', 'spellcheck', 'autocomplete', 'autocapitalize'].map((a) => e.getAttribute(a)).join('|')] }))
  for (const [label, js] of [['ON', BLOCK], ['OFF', '']]) {
    const { p, ctx } = await page('/support', FORM)(false, js)
    const a = await p.evaluate(attrs)
    if (label === 'ON') {
      is(a.ord === 'off|false|off|characters', '[mob-js-1] /support order number: autocorrect off, spellcheck false, autocomplete off added', a.ord)
      is(a.em === 'off|false|email|none', '[mob-js-1] e-mail: autocapitalize none, autocorrect off, spellcheck false added', a.em)
      is(a.nm.endsWith('|words') && a.nm2.endsWith('|sentences'), '[mob-js-1] name: autocapitalize words added where absent; a value the app set is kept', `${a.nm} ${a.nm2}`)
      is(a.ck === '||name|', '[mob-js-1] a checkout field is untouched', a.ck)
      // a field React adds later is hinted too
      await p.evaluate(() => { const i = document.createElement('input'); i.id = 'late'; i.type = 'email'; document.querySelector('form').appendChild(i) })
      await p.waitForTimeout(300)
      is(await p.evaluate(() => document.getElementById('late').getAttribute('autocapitalize')) === 'none', '[mob-js-1] a field added after load is hinted')
    } else is(a.ord === '|||characters', '[mob-js-1] OFF: the order field has no autocorrect / spellcheck (the defect)', a.ord)
    await ctx.close()
  }
  // [mob-js-2]: window listener = the compiled pull-to-refresh, #root listener = React's root
  const drag = async (p, id) => p.evaluate(async (id) => {
    window.__w = 0; window.__r = 0
    if (!window.__wired) { window.addEventListener('touchmove', () => window.__w++); document.getElementById('root').addEventListener('touchmove', () => window.__r++); window.__wired = 1 }
    const el = document.getElementById(id); const b = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) { const t = new Touch({ identifier: 1, target: el, clientX: b.left + 5, clientY: b.top + 5 + k * 30 }); el.dispatchEvent(new TouchEvent('touchmove', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true })) }
    return { w: window.__w, r: window.__r }
  }, id)
  for (const [path, standalone, js, cases] of [
    ['/support', true, BLOCK, [['plain', 0], ['ord', 0]]],
    ['/', true, BLOCK, [['plain', 5], ['ord', 0], ['dp', 0], ['dl', 0]]],
    ['/support', false, BLOCK, [['plain', 5], ['ord', 5]]],
    ['/support', true, '', [['plain', 5], ['ord', 5]]],
  ]) {
    const { p, ctx } = await page(path, FORM)(standalone, js)
    for (const [id, want] of cases) {
      const r = await drag(p, id)
      is(r.w === want && r.r === 5, `[mob-js-2] ${js ? 'ON' : 'OFF'} ${standalone ? 'installed app' : 'browser tab'} ${path} drag on #${id}: window sees ${r.w} of 5 (want ${want}), the app root sees ${r.r} of 5`)
    }
    await ctx.close()
  }
}

head('MUTATION')
{
  const m = []; sink = m
  await checks(OFF)
  sink = null
  is(m.length >= 40, `the section removed fails ${m.length} checks`)
  for (const b of BLOCKS) {
    const mm = []; sink = mm
    await checks(withoutBlock(b))
    sink = null
    is(mm.some((x) => x.startsWith(`[${b}]`)), `[${b}] removed on its own fails ${mm.filter((x) => x.startsWith(`[${b}]`)).length} of its checks`)
  }
}

S.close()
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
