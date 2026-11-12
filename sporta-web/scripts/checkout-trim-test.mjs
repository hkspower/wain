// TRIM-1112 (owner, 2026-11-12: "remove any unneeded fields" on the checkout form): the TRIM-1112 section of
// public/sporta-checkout-a11y.css and the TRIM-1112 block at the end of public/sporta-checkout-a11y.js, proven in a real
// browser.
//
//   npm run test:checkout-trim
//
// Which fields are unneeded was decided from the server, not from the screen (dropin/php-store/api.php, r=order):
//   required by the server  name, phone, governorate, area, block, street, building (house)   -> untouched, always shown
//   optional, but stored and printed in the courier's message (store.php fulfilment payload, cron-fulfilment.php)
//                           floor, flat, note (the location control writes one line into the note). Owner (2026-11-12):
//                           floor and flat stay ALWAYS visible; only the note + location are folded behind ONE link
//   ignored by the server   none. The live form has no avenue and no e-mail field (captured markup).
// So nothing is deleted: the optional part sits behind "More address details (optional)" at every width.
//
// Two layers:
//   A  FIXTURES (always runs): the captured LIVE checkout markup (scripts/fixtures/sizes-screen/checkout-{ar,en}.html)
//      under the live compiled rules and every add-on stylesheet in the live order (scripts/lib/cart-ux-page.mjs), with the
//      real public/sporta-checkout-a11y.js served as a file, at /checkout. Arabic (RTL) and English, 320/360/390/768/1280.
//      [A1] one link, a real <button aria-expanded=false>, in the address grid, right after the floor + flat row
//      [A2] closed: the note, the location control and the U1 note link take no space; the seven required fields AND
//           floor + flat are all visible
//      [A3] 44px tall, 14px text, AA contrast (label and its second line), the "+" mark on the start side (RTL/LTR), within
//           the grid, no sideways scroll, the label in the page's language (and it follows a language switch in place)
//      [A4] the link opens the part (note focused; note, location shown; the U1 link marked open, so there is
//           never a second link) and hides itself; Enter and Space work from the keyboard
//      [A5] NEVER hides a field that holds something: a value in the note (in the markup before the
//           script runs, or typed/put back later), aria-invalid on a folded field, an error inside, focus inside
//      [A6] fails safe: without the script nothing is hidden; a script that throws leaves nothing hidden
//      [A7] no layout shift on load (the link is placed in the same task as the script runs, before the first paint)
//   B  THE REAL APP (when the capture of the live build is on this machine: UX_LIVE_DIR, default the scratchpad's
//      scan-words/live): the compiled Checkout chunk with the live /api JSON, every POST answered locally.
//      [B1] guest form ar 390 / en 1280: the link is in the DOM on the first animation frame the form exists (no shift),
//           closed, the optional part hidden; CLS entries that moved the link: 0
//      [B2] the order POST body is BYTE-IDENTICAL with and without TRIM-1112 (both files cut), for (a) only the required
//           fields and (b) floor, flat and a note typed (the note behind the opened link with TRIM, directly without)
//      [B3] a remembered floor/flat is shown with the link closed; a remembered note opens the link by itself (no hidden value); "Edit details" from the
//           quick checkout opens it too; a step change (Payment and back) keeps it open with the note
//      [B4] dark theme: the link reads 4.5:1
//
// MUTATION (built in, layer A + B1): the suite re-runs its checks with the whole CSS section cut, with each numbered block cut
// ([trim-link], [trim-fold]) and with the JS block cut, and requires each cut to fail. CHECKOUT_TRIM_CSS=<file> /
// CHECKOUT_TRIM_JS=<file> serve another stylesheet / script (an EMPTY file must fail). Env: CHROMIUM_PATH, UX_LIVE_DIR,
// CHECKOUT_TRIM_SKIP_REAL=1 (layer A only), CHECKOUT_TRIM_SKIP_MUTANTS=1.
// As built (2026-11-12, floor + flat always visible, capture of the live build of 2026-11-03): 207 checks + 4 mutation checks,
// 0 failed. Cuts: CSS section 39 fail, [trim-link] 10, [trim-fold] 29, JS block 15.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, addonFiles, fixturePage } from './lib/cart-ux-page.mjs'

const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_FILE = process.env.CHECKOUT_TRIM_CSS || join(PUB, 'sporta-checkout-a11y.css')
const JS_FILE = process.env.CHECKOUT_TRIM_JS || join(PUB, 'sporta-checkout-a11y.js')
const CSS = readFileSync(CSS_FILE, 'utf8')
const JS = readFileSync(JS_FILE, 'utf8')
const ADDONS = addonFiles()

// ---- cuts ---------------------------------------------------------------------------------------------------------
const CSS_START = '/* ==== TRIM-1112', CSS_NEXT = '/* ==== SIZES:'
const JS_START = '/* ==== TRIM-1112', JS_END = '/* ==== end TRIM-1112 */'
const cutCss = (css) => { const a = css.indexOf(CSS_START); if (a < 0) return css; const b = css.indexOf(CSS_NEXT, a); return css.slice(0, a) + (b < 0 ? '' : css.slice(b)) }
const cutJs = (js) => { const a = js.indexOf(JS_START); if (a < 0) return js; const b = js.indexOf(JS_END, a); return js.slice(0, a) + (b < 0 ? '' : js.slice(b + JS_END.length)) }
const cutBlock = (css, id) => {
  const a = css.indexOf(`/* [${id}] */`)
  if (a < 0) return css
  const rest = css.slice(a + 5)
  const n = rest.search(/\n\/\* (\[|====)/)
  return css.slice(0, a) + (n < 0 ? '' : css.slice(a + 5 + n + 1))
}

let pass = 0, fail = 0, quiet = false
const fails = []
const is = (ok, msg, detail = '') => {
  if (ok) { pass++; if (!quiet) console.log('ok   ' + msg) } else { fail++; fails.push(msg); if (!quiet) console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, t) => Math.abs(a - b) <= t
const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const WORDS = {
  en: { label: 'More address details (optional)', sub: 'Delivery note, location' },
  ar: { label: 'تفاصيل إضافية للعنوان (اختياري)', sub: 'ملاحظة التوصيل، الموقع' },
}
const REQUIRED = ['f-name', 'f-phone', 'f-governorate', 'f-area', 'f-block', 'f-street', 'f-building']

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

// ==================================================================================================== A: the fixture
const ORIGIN = 'https://sporta.test'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const FMIME = { woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' }

// o: lang w h css js(null = no script) mutate(markup -> markup) throwIn
async function openFx(o) {
  const { lang = 'ar', w = 390, h = 844, css = CSS, js = JS, mutate = null, throwIn = false } = o
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', hasTouch: w < 768, isMobile: w < 768 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname === '/checkout') {
      let html = fixturePage('checkout', lang, { ...ADDONS, 'sporta-checkout-a11y.css': css })
      if (mutate) html = mutate(html)
      const pre = `<script>window.__cls=0;window.__shifts=[];try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.hadRecentInput)return;var hit=(e.sources||[]).some(function(s){var n=s.node;if(n&&n.nodeType===3)n=n.parentElement;return !!(n&&n.closest&&n.closest('.sporta-trim, fieldset:has(#f-block)'))});if(hit)window.__cls+=e.value;window.__shifts.push((e.sources||[]).map(function(s){return s.node&&s.node.className?String(s.node.className).slice(0,40):String(s.node&&s.node.nodeName)}).join('|'))})}).observe({type:'layout-shift',buffered:true})}catch(e){}` +
        (throwIn ? `(function(){var o=Element.prototype.closest;Element.prototype.closest=function(){if(new Error().stack.indexOf('sporta-checkout-a11y.js')>=0&&window.__trimThrow)throw new Error('injected');return o.apply(this,arguments)}})();window.__trimThrow=true;` : '') + `</script>`
      html = html.replace('<head>', '<head>' + pre)
      if (js !== null) html = html.replace('</body>', '<script src="/sporta-checkout-a11y.js"></script></body>')
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    }
    if (u.pathname === '/sporta-checkout-a11y.js') return route.fulfill({ contentType: 'text/javascript', body: js || '' })
    const f = PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) return route.fulfill({ contentType: FMIME[f.split('.').pop()] || 'application/octet-stream', body: readFileSync(f) })
    return route.fulfill({ contentType: 'image/png', body: PNG })
  })
  await page.goto(ORIGIN + '/checkout', { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(150)
  return { page, ctx, errors }
}

// What a check needs, read in the page.
const SNAP = (REQ) => {
  const q = (s) => document.querySelector(s)
  const vis = (el) => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden'
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height } }
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m[3] === undefined || Number(m[3]) > 0.9)) return c } return 'rgb(255, 255, 255)' }
  const btns = [...document.querySelectorAll('.sporta-trim')]
  const b = btns[0] || null
  const block = document.getElementById('f-block')
  const grid = block && block.closest('fieldset > .grid')
  const floor = document.getElementById('f-floor'), row = floor && floor.closest('.grid')
  const note = document.getElementById('f-note'), wrap = note && note.closest('.purchase-field')
  const loc = document.getElementById('sporta-loc'), u1 = q('.sporta-fold--note')
  const label = b && b.querySelector('.sporta-trim__label'), sub = b && b.querySelector('.sporta-trim__sub')
  const mark = label && getComputedStyle(label, '::before')
  const lr = label && rect(label)
  // the "+" mark: where its box is, from the label's text (a Range over the text node)
  let textR = null
  if (label && label.firstChild) { const rg = document.createRange(); rg.selectNodeContents(label); const rs = rg.getClientRects(); if (rs.length) textR = { l: rs[0].left, r: rs[rs.length - 1].right } }
  return {
    n: btns.length,
    tag: b && b.tagName, type: b && b.type, exp: b && b.getAttribute('aria-expanded'),
    inGrid: !!(b && grid && b.parentNode === grid),
    beforeRow: !!(b && row && b.previousElementSibling === row),
    nextIsRowOrU1: !!(b && b.nextElementSibling && (b.nextElementSibling === wrap || b.nextElementSibling === u1)),
    shown: vis(b), r: rect(b), grid: rect(grid),
    label: label && label.textContent, sub: sub && sub.textContent,
    lfs: label && parseFloat(getComputedStyle(label).fontSize), sfs: sub && parseFloat(getComputedStyle(sub).fontSize),
    color: label && getComputedStyle(label).color, scolor: sub && getComputedStyle(sub).color, bg: b && bgOf(b),
    markW: mark && parseFloat(mark.width), lr, textR,
    row: vis(row), flat: vis(document.getElementById('f-flat')), floorShown: vis(floor), note: vis(wrap), loc: vis(loc), locAttached: !!loc, u1: vis(u1), u1exp: u1 && u1.getAttribute('aria-expanded'),
    req: REQ.map((id) => [id, vis(document.getElementById(id))]),
    focus: document.activeElement && document.activeElement.id,
    docW: document.documentElement.scrollWidth, vw: innerWidth, dir: getComputedStyle(document.documentElement).direction,
    formH: q('form.purchase-checkout-layout') && q('form.purchase-checkout-layout').getBoundingClientRect().height,
    values: ['f-floor', 'f-flat', 'f-note'].map((id) => document.getElementById(id) && document.getElementById(id).value),
    cls: window.__cls, shifts: window.__shifts,
  }
}

// All of layer A's checks, for one css/js variant. Returns nothing; counts into is().
const WIDTHS = [[320, 700], [360, 740], [390, 844], [768, 1024], [1280, 900]]
const heights = {}
async function layerA(v) {
  for (const lang of ['ar', 'en']) {
    for (const [w, h] of WIDTHS) {
      const tag = `${lang} ${w}px`
      head(`A ${tag}`)
      const { page, ctx, errors } = await openFx({ lang, w, h, css: v.css, js: v.js })
      const s = await page.evaluate(SNAP, REQUIRED)
      const W = WORDS[lang]
      is(s.n === 1 && s.tag === 'BUTTON' && s.type === 'button' && s.exp === 'false', `[A1] ${tag}: one closed <button type=button aria-expanded=false>`, JSON.stringify([s.n, s.tag, s.type, s.exp]))
      is(s.inGrid && s.beforeRow && s.nextIsRowOrU1, `[A1] ${tag}: placed in the address grid, right after the floor + flat row, before the note`, JSON.stringify([s.inGrid, s.beforeRow, s.nextIsRowOrU1]))
      is(s.shown && !s.note && !s.loc && !s.u1 && s.locAttached, `[A2] ${tag}: closed, the note, the location control and the U1 note link take no space`, JSON.stringify({ shown: s.shown, note: s.note, loc: s.loc, u1: s.u1 }))
      is(s.row && s.floorShown && s.flat, `[A2] ${tag}: floor and flat are always visible (owner decision)`, JSON.stringify({ row: s.row, floor: s.floorShown, flat: s.flat }))
      is(s.req.every((x) => x[1]), `[A2] ${tag}: all seven required fields are visible`, s.req.filter((x) => !x[1]).map((x) => x[0]).join(','))
      is(s.r && s.r.h >= 44 && s.lfs >= 14 && s.sfs >= 14, `[A3] ${tag}: 44px tall, 14px label and second line`, s.r && `${s.r.h} ${s.lfs} ${s.sfs}`)
      is(s.color && ratio(s.color, s.bg) >= 4.5 && ratio(s.scolor, s.bg) >= 4.5, `[A3] ${tag}: label and second line 4.5:1`, s.color && `${ratio(s.color, s.bg).toFixed(2)} ${ratio(s.scolor, s.bg).toFixed(2)}`)
      is(s.label === W.label && s.sub === W.sub, `[A3] ${tag}: the words are in the page's language`, `${s.label} / ${s.sub}`)
      is(s.markW >= 18 && s.textR && s.lr && (lang === 'ar' ? s.textR.r < s.lr.r - 18 : s.textR.l > s.lr.l + 18), `[A3] ${tag}: the "+" mark sits on the start side (${lang === 'ar' ? 'right' : 'left'})`, JSON.stringify([s.markW, s.lr, s.textR]))
      is(s.grid && s.r && s.r.l >= s.grid.l - 0.5 && s.r.r <= s.grid.r + 0.5 && near(lang === 'ar' ? s.r.r : s.r.l, lang === 'ar' ? s.grid.r : s.grid.l, 1), `[A3] ${tag}: inside the grid and aligned to its start edge`, JSON.stringify([s.r, s.grid]))
      is(s.docW <= s.vw && s.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `[A3] ${tag}: no sideways scroll, ${lang === 'ar' ? 'RTL' : 'LTR'}`, `${s.docW} > ${s.vw}`)
      // (the fixture's own font swap nudges the header and the summary by a hair: that is the page's, not this add-on's)
      is(s.cls === 0, `[A7] ${tag}: no layout shift of the address part or the link on load`, `${s.cls} ${JSON.stringify(s.shifts)}`)
      const closedH = s.formH
      // open by tap / click
      await page.click('.sporta-trim')
      await sleep(80)
      const o = await page.evaluate(SNAP, REQUIRED)
      is(!o.shown && o.exp === 'true' && o.row && o.flat && o.note && o.loc && o.focus === 'f-note', `[A4] ${tag}: the link opens the note and the location control, focuses the note and steps aside`, JSON.stringify({ shown: o.shown, row: o.row, note: o.note, loc: o.loc, focus: o.focus }))
      is(!o.u1 && (o.u1exp === null || o.u1exp === 'true'), `[A4] ${tag}: no second link: the U1 note link is marked open`, `${o.u1} ${o.u1exp}`)
      is(o.docW <= o.vw, `[A4] ${tag}: open, no sideways scroll`, `${o.docW}`)
      heights[`${tag}`] = [closedH, o.formH]
      if (w === 390 || w === 1280) {
        // language switch in place
        await page.evaluate((l) => document.documentElement.setAttribute('lang', l), lang === 'ar' ? 'en' : 'ar')
        await sleep(50)
        const lbl = await page.evaluate(() => document.querySelector('.sporta-trim .sporta-trim__label').textContent)
        is(lbl === WORDS[lang === 'ar' ? 'en' : 'ar'].label, `[A3] ${tag}: the label follows a language switch in place`, lbl)
      }
      is(errors.length === 0, `${tag}: no page error`, errors.join('; '))
      await ctx.close()
    }
  }
  // keyboard
  for (const key of ['Enter', ' ']) {
    const { page, ctx } = await openFx({ lang: 'ar', w: 390, h: 844, css: v.css, js: v.js })
    await page.focus('#f-flat')
    await page.keyboard.press('Tab')
    const at = await page.evaluate(() => document.activeElement && document.activeElement.className)
    await page.keyboard.press(key === ' ' ? 'Space' : key)
    await sleep(80)
    const o = await page.evaluate(SNAP, REQUIRED)
    is(at === 'sporta-trim' && o.exp === 'true' && o.note && o.focus === 'f-note', `[A4] keyboard: Tab from flat lands on the link, ${key === ' ' ? 'Space' : key} opens it and focus moves to the note`, `${at} ${o.exp} ${o.focus}`)
    await ctx.close()
  }
  // never hide a value
  const setIn = (id, val) => (html) => html.replace(new RegExp(`(<input id="${id}"[^>]*?)value=""`), `$1value="${val}"`)
  const cases = [
    ['a note in the markup (remembered)', (html) => html.replace(/(<textarea id="f-note"[^>]*>)<\/textarea>/, '$1Gate is green</textarea>')],
    ['aria-invalid on a folded field', (html) => html.replace(/<textarea id="f-note"/, '<textarea aria-invalid="true" id="f-note"')],
    ['an error message inside the folded part', (html) => html.replace(/(<textarea id="f-note"[^>]*><\/textarea>)/, '$1<p id="e-note" role="alert">Too long</p>')],
  ]
  for (const lang of ['ar', 'en']) {
    for (const [name, mutate] of cases) {
      const { page, ctx } = await openFx({ lang, w: 390, h: 844, css: v.css, js: v.js, mutate })
      const s = await page.evaluate(SNAP, REQUIRED)
      is(s.exp === 'true' && !s.shown && s.row && s.flat && s.note, `[A5] ${lang}: ${name}: open by itself, nothing hidden`, JSON.stringify({ exp: s.exp, row: s.row, note: s.note, values: s.values }))
      is(s.cls === 0, `[A5] ${lang}: ${name}: opened before the first paint (no shift)`, String(s.cls))
      await ctx.close()
    }
  }
  // a value that arrives later (the app putting it back, autofill): the native setter + input event, and a value attribute
  for (const [name, how] of [
    ['a note set later + input event', () => { const f = document.getElementById('f-note'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, 'Call first'); f.dispatchEvent(new Event('input', { bubbles: true })) }],
    ['a note put back by a re-render (new text node)', () => { const t = document.getElementById('f-note'); t.textContent = 'Call first'; t.value = 'Call first' }],
  ]) {
    const { page, ctx } = await openFx({ lang: 'en', w: 390, h: 844, css: v.css, js: v.js })
    await page.evaluate(how)
    await sleep(60)
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.exp === 'true' && s.row && s.note, `[A5] ${name}: the link opens by itself`, JSON.stringify({ exp: s.exp, values: s.values }))
    await ctx.close()
  }
  // focus inside the folded part (a script or assistive tech moving focus there) opens it
  {
    const { page, ctx } = await openFx({ lang: 'ar', w: 1280, h: 900, css: v.css, js: v.js })
    await page.evaluate(() => { const b = document.getElementById('sporta-loc-btn'); b.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    await sleep(60)
    const s = await page.evaluate(SNAP, REQUIRED)
    // a hidden button cannot take real focus; the check is that the open link stays open once something inside asks
    await page.click('.sporta-trim'); await sleep(50)
    await page.focus('#f-note'); await page.evaluate(() => document.activeElement.blur())
    const s2 = await page.evaluate(SNAP, REQUIRED)
    is(s2.exp === 'true' && s2.note, '[A5] once open it never closes by itself (focus leaves, the note is empty)', JSON.stringify({ before: s.exp, after: s2.exp }))
    await ctx.close()
  }
  // fail safe
  {
    const { page, ctx } = await openFx({ lang: 'ar', w: 390, h: 844, css: v.css, js: null })
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.n === 0 && s.row && s.note && s.loc, '[A6] without the script: no link and nothing hidden (CSS alone hides nothing)', JSON.stringify({ n: s.n, row: s.row, note: s.note }))
    await ctx.close()
  }
  {
    const { page, ctx, errors } = await openFx({ lang: 'ar', w: 390, h: 844, css: v.css, js: v.js, throwIn: true })
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.note && s.row && (s.n === 0 || s.exp === 'true'), '[A6] a script that throws: nothing of the optional part is left hidden', JSON.stringify({ n: s.n, exp: s.exp, note: s.note }))
    is(errors.length === 0, '[A6] the throw does not escape as a page error', errors.join('; '))
    await ctx.close()
  }
}

// ==================================================================================================== B: the real app
const LIVE = process.env.UX_LIVE_DIR || '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
const REAL = !process.env.CHECKOUT_TRIM_SKIP_REAL && existsSync(join(LIVE, 'index.html')) && existsSync(join(LIVE, 'assets'))
let BASE = null, server = null
const serve = { css: CSS, js: JS }
if (REAL) {
  const MIME = { js: 'text/javascript', css: 'text/css', json: 'application/json', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
  const ADDON = /^\/(sporta-[\w-]+\.(css|js)|boot\.js|config\.js|birthday\.js)$/
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  server = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x')
    const send = (code, type, body) => { s.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); s.end(body) }
    if (u.pathname === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (r === 'slide_image') return send(200, 'image/png', readFileSync(join(PUB, 'og-image.png')))
      const f = join(LIVE, 'api', r + '.json')
      return existsSync(f) ? send(200, 'application/json', readFileSync(f)) : send(404, 'application/json', '{"error":"not_found"}')
    }
    // the variant is chosen per page by a query on the add-on URL the page cannot set, so per context instead: a header
    if (u.pathname === '/sporta-checkout-a11y.css') return send(200, 'text/css', serve.css)
    if (u.pathname === '/sporta-checkout-a11y.js') return send(200, 'text/javascript', serve.js)
    if (u.pathname === '/payment/knet-official.png') return send(200, 'image/png', PNG1)
    const roots = ADDON.test(u.pathname) ? [PUB, LIVE] : [LIVE, PUB]
    for (const root of roots) {
      const f = root + u.pathname
      if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) return send(200, MIME[f.split('.').pop()] || 'application/octet-stream', readFileSync(f))
    }
    if (/\.\w+$/.test(u.pathname)) return send(404, 'text/plain', 'nf')
    send(200, MIME.html, readFileSync(join(LIVE, 'index.html')))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  BASE = 'http://127.0.0.1:' + server.address().port
}

const ITEMS = [
  { key: 'cagliari-calcio-sweatshirt-navy__2XL__-', slug: 'cagliari-calcio-sweatshirt-navy', size: '2XL', fit: null, name: { en: 'Cagliari Calcio Sweatshirt — Navy', ar: 'سويت شيرت كالياري كالتشو — كحلي' }, price: 10, image: '/product-photo-unavailable.svg', qty: 1 },
  { key: 'cagliari-calcio-backpack-navy__ONE__-', slug: 'cagliari-calcio-backpack-navy', size: 'ONE', fit: null, name: { en: 'Cagliari Calcio Backpack — Navy', ar: 'حقيبة ظهر كالياري كالتشو — كحلي' }, price: 9, image: '/product-photo-unavailable.svg', qty: 2 },
]
const SAVED = { name: 'Mohammed Alotaibi', phone: '55512345', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '7', floor: '', flat: '', note: '' }

async function openReal(o = {}) {
  const lang = o.lang || 'ar', w = o.w || 390, h = o.h || 844
  const touch = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const page = await ctx.newPage()
  const log = { posts: [], errors: [] }
  await page.addInitScript(([items, lang, saved, theme]) => {
    try {
      localStorage.setItem('sporta_onepage', 'off') // the live three screens; the ONEPAGE block has its own suite
      localStorage.setItem('sporta_cart', JSON.stringify(items)); localStorage.setItem('lang', lang)
      if (saved) localStorage.setItem('sporta.delivery', JSON.stringify(saved))
      if (theme) { localStorage.setItem('sporta_theme', theme); localStorage.setItem('sporta_theme_explicit', '1') }
    } catch (e) { /* ignore */ }
    window.__mine = 0
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) for (const x of e.sources || []) if (x.node && x.node.closest && x.node.closest('.sporta-trim')) window.__mine++ }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { /* ignore */ }
    window.__ff = null
    new MutationObserver(() => { if (window.__ff) return; if (document.getElementById('f-floor')) { window.__ff = { pending: true }; requestAnimationFrame(() => { const b = document.querySelector('.sporta-trim'); const r = document.getElementById('f-floor').closest('.grid'), n = document.getElementById('f-note'); window.__ff = { link: !!b, exp: b && b.getAttribute('aria-expanded'), rowH: r ? r.getBoundingClientRect().height : -1, noteH: n ? n.getBoundingClientRect().height : -1 } }) } }).observe(document, { childList: true, subtree: true })
    let n = 0; const g = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = function (a) { if (a instanceof Uint32Array) { for (let i = 0; i < a.length; i++) a[i] = 0x1234567 + (n++) * 7919; return a } return g(a) }
  }, [ITEMS, lang, o.saved || null, o.theme || null])
  await page.route('**/api/api.php?r=discount*', (route) => {
    const sub = ITEMS.reduce((a, i) => a + i.price * i.qty, 0)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subtotal: sub, delivery: 0, total: sub, total_fils: sub * 1000, applied: [] }) })
  })
  await page.route('**/api/api.php?r=checkout_config*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ delivery_fee: 1, methods: ['knet', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' }) }))
  await page.route('**/api/api.php?r=order*', (route) => {
    const raw = route.request().postData()
    log.posts.push(raw)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ track_id: JSON.parse(raw).track_id, amount: 20 }) })
  })
  await page.route(/\/(knet|pay)\/pay\.php|\/payment\/result/, (route) => route.abort())
  page.on('pageerror', (e) => log.errors.push(String(e)))
  await page.goto(BASE + '/checkout?lang=' + lang, { waitUntil: 'domcontentloaded', timeout: 240000 })
  return { page, ctx, log }
}
async function ready(page, kind = 'flow') {
  await page.waitForSelector(kind === 'quick' ? '.purchase-quick' : '.purchase-checkout-layout', { timeout: 240000 })
  await page.waitForFunction(() => { const b = document.querySelector('.purchase-paybar button[type=submit], .purchase-quick__submit'); return !!b && !b.disabled }, null, { timeout: 240000 })
  if (kind === 'flow') await page.waitForSelector('#sporta-loc', { state: 'attached', timeout: 8000 }).catch(() => {})
  await sleep(400)
}
const next = (page) => page.evaluate(() => { const b = document.querySelector('.purchase-paybar button[type=submit]:not([disabled])') || document.querySelector('form button[type=submit]:not([disabled])'); b.click() })
async function fillRequired(page, lang) {
  await page.fill('#f-name', lang === 'ar' ? 'محمد العتيبي' : 'Mohammed Alotaibi')
  await page.fill('#f-phone', '55512345')
  await page.selectOption('#f-governorate', 'hawalli')
  await page.fill('#f-area', lang === 'ar' ? 'السالمية' : 'Salmiya')
  await page.fill('#f-block', '4'); await page.fill('#f-street', '12'); await page.fill('#f-building', '7')
}

async function layerB1(v, tags) {
  for (const [lang, w, h] of [['ar', 390, 844], ['en', 1280, 900]]) {
    serve.css = v.css; serve.js = v.js
    const tag = `real ${lang} ${w}px`
    head(`B ${tag}`)
    const { page, ctx, log } = await openReal({ lang, w, h })
    await ready(page)
    const ff = await page.evaluate(() => window.__ff)
    is(ff && ff.link && ff.exp === 'false' && ff.noteH === 0 && ff.rowH > 0, `[B1] ${tag}: on the first frame the form exists, the link is there, closed, the note already hidden, floor + flat shown`, JSON.stringify(ff))
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.n === 1 && s.shown && s.row && s.flat && !s.note && !s.loc && !s.u1 && s.req.every((x) => x[1]), `[B1] ${tag}: one link; note and location hidden; the seven required fields and floor + flat shown`, JSON.stringify({ n: s.n, row: s.row, note: s.note, loc: s.loc, u1: s.u1 }))
    is(s.label === WORDS[lang].label && s.r && s.r.h >= 44, `[B1] ${tag}: the label in the page's language, 44px`, `${s.label} ${s.r && s.r.h}`)
    const mine = await page.evaluate(() => window.__mine)
    is(mine === 0, `[B1] ${tag}: no layout-shift entry moved the link`, String(mine))
    is(log.errors.length === 0, `[B1] ${tag}: no page error`, log.errors.join('; '))
    await ctx.close()
  }
}

async function journey(v, o) {
  serve.css = v.css; serve.js = v.js
  const { page, ctx, log } = await openReal(o)
  await ready(page)
  await fillRequired(page, o.lang)
  if (o.extra) {
    await page.fill('#f-floor', '3'); await page.fill('#f-flat', '12') // always visible: typed before the link is touched
    if (await page.$('.sporta-trim[aria-expanded="false"]')) await page.click('.sporta-trim')
    // without TRIM-1112, a phone still has the U1 note link
    if (await page.isVisible('.sporta-fold--note[aria-expanded="false"]').catch(() => false)) await page.click('.sporta-fold--note')
    await page.fill('#f-floor', '3'); await page.fill('#f-flat', '12'); await page.fill('#f-note', o.lang === 'ar' ? 'البوابة خضراء' : 'Green gate')
  }
  await next(page); await page.waitForSelector('.purchase-payment', { timeout: 30000 }); await sleep(300)
  await next(page); await sleep(900)
  await page.evaluate(() => document.querySelector('.purchase-paybar button[type=submit]').click())
  await sleep(1800)
  const out = { posts: log.posts.slice(), errors: log.errors.slice() }
  await ctx.close()
  return out
}

async function layerB(v) {
  await layerB1(v)
  head('B order body with and without TRIM-1112')
  const none = { css: cutCss(v.css), js: cutJs(v.js) }
  for (const [name, o] of [['required only, ar 390', { lang: 'ar', w: 390, h: 844 }], ['floor + flat + note, en 1280', { lang: 'en', w: 1280, h: 900, extra: true }], ['floor + flat + note, ar 390', { lang: 'ar', w: 390, h: 844, extra: true }]]) {
    const a = await journey(v, o)
    const b = await journey(none, o)
    is(a.posts.length === 1 && b.posts.length === 1 && a.posts[0] === b.posts[0], `[B2] ${name}: the order POST body is byte-identical with and without TRIM-1112 (${a.posts[0] ? a.posts[0].length : 0} bytes)`, `${a.posts.length}/${b.posts.length} ${a.posts[0] === b.posts[0] ? '' : 'DIFFERENT'}`)
    const c = JSON.parse(a.posts[0] || '{}').customer || {}
    is(o.extra ? c.floor === '3' && c.flat === '12' && c.note.length > 3 : c.floor === '' && c.flat === '' && c.note === '', `[B2] ${name}: floor/flat/note are sent as typed ("" when left closed, as the live build sends a blank field)`, JSON.stringify([c.floor, c.flat, c.note]))
    is(!('amount' in JSON.parse(a.posts[0] || '{}')), `[B2] ${name}: no price in the body`, '')
  }
  serve.css = v.css; serve.js = v.js
  head('B remembered details, Edit details, step change')
  {
    const { page, ctx } = await openReal({ lang: 'ar', w: 390, h: 844, saved: { ...SAVED, building: '', floor: '3', flat: '12' } })
    await ready(page)
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.exp === 'false' && s.row && s.flat && s.values[0] === '3' && s.values[1] === '12', '[B3] a remembered floor/flat (form shown because the house is missing): shown, the link stays closed (the note is empty)', JSON.stringify({ exp: s.exp, row: s.row, values: s.values }))
    await ctx.close()
  }
  {
    const { page, ctx } = await openReal({ lang: 'en', w: 390, h: 844, saved: { ...SAVED, note: 'Ring twice' } })
    await ready(page, 'quick')
    await page.click('.purchase-quick__delivery button[type=button]')
    await page.waitForSelector('#f-note', { timeout: 30000 }); await sleep(300)
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.exp === 'true' && s.note && s.values[2] === 'Ring twice', '[B3] quick checkout -> Edit details with a remembered note: open by itself, the note is shown', JSON.stringify({ exp: s.exp, note: s.note, values: s.values }))
    await ctx.close()
  }
  {
    const { page, ctx } = await openReal({ lang: 'ar', w: 390, h: 844 })
    await ready(page)
    await fillRequired(page, 'ar')
    await page.click('.sporta-trim'); await page.fill('#f-note', 'البوابة خضراء')
    await next(page); await page.waitForSelector('.purchase-payment', { timeout: 30000 }); await sleep(300)
    await page.click('.purchase-stage-panel > button[type=button]'); await page.waitForSelector('#f-note', { timeout: 30000 }); await sleep(400)
    const s = await page.evaluate(SNAP, REQUIRED)
    is(s.exp === 'true' && s.note && s.values[2] === 'البوابة خضراء', '[B3] Payment and back: the link is still open with the note', JSON.stringify({ exp: s.exp, note: s.note, values: s.values }))
    await ctx.close()
  }
  head('B dark theme')
  {
    const { page, ctx } = await openReal({ lang: 'ar', w: 390, h: 844, theme: 'dark' })
    await ready(page)
    const s = await page.evaluate(SNAP, REQUIRED)
    const th = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    is(th === 'dark' && s.color && ratio(s.color, s.bg) >= 4.5 && ratio(s.scolor, s.bg) >= 4.5, `[B4] dark theme: the link reads 4.5:1 (${s.color && ratio(s.color, s.bg).toFixed(2)}:1 on ${s.bg})`, `${th} ${s.color} ${s.bg}`)
    await ctx.close()
  }
}

// ==================================================================================================== run
const abort = (what) => (e) => { fail++; console.log(`FAIL ${what} aborted - ` + String(e.message || e).split('\n')[0]) }
await layerA({ css: CSS, js: JS }).catch(abort('layer A'))
if (REAL) await layerB({ css: CSS, js: JS }).catch(abort('layer B'))
else console.log('\n(layer B skipped: no capture of the live build at UX_LIVE_DIR)')
const realPass = pass, realFail = fail
console.log('\nform height closed -> open (px): ' + Object.entries(heights).map(([k, [a, b]]) => `${k} ${Math.round(a)}->${Math.round(b)}`).join(', '))

if (!process.env.CHECKOUT_TRIM_SKIP_MUTANTS) {
  console.log('\n=== mutation check ' + '='.repeat(48))
  const cuts = [
    ['CSS section cut', { css: cutCss(CSS), js: JS }],
    ['[trim-link] cut', { css: cutBlock(CSS, 'trim-link'), js: JS }],
    ['[trim-fold] cut', { css: cutBlock(CSS, 'trim-fold'), js: JS }],
    ['JS block cut', { css: CSS, js: cutJs(JS) }],
  ]
  const results = []
  for (const [name, v] of cuts) {
    const p0 = pass, f0 = fail
    quiet = true
    if (v.css === CSS && v.js === JS) { quiet = false; results.push([name, -1]); continue }
    // a cut can make a step impossible (no link to click): the throw counts as a failure and the variant ends there
    try { await layerA(v) } catch (e) { fail++ }
    try { if (REAL) await layerB1(v) } catch (e) { fail++ }
    quiet = false
    const failed = fail - f0
    results.push([name, failed])
    pass = p0; fail = f0
  }
  for (const [name, n] of results) is(n > 0, `mutation: ${name} -> ${n} checks fail`, n < 0 ? 'the cut changed nothing (marker missing?)' : '')
}
await browser.close()
if (server) server.close()
console.log(`\n${pass} passed, ${fail} failed` + (process.env.CHECKOUT_TRIM_SKIP_MUTANTS ? '' : ` (checks before the mutation pass: ${realPass} passed, ${realFail} failed)`))
process.exit(fail ? 1 : 0)
