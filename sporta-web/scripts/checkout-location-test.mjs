// The optional "share my location" control on the checkout, proven in a real browser. Rig-free: no database, no
// server, no build. The page is scripts/fixtures/checkout-location.mjs (the live delivery form's markup and a
// React-like controlled textarea) served from a made-up https origin, and the code under test is the REAL file
// public/sporta-gov-autopick.js.
//
//   npm run test:checkout-location
//
// What is proven (the letters are the report sections):
//   A  nothing is asked before the tap: zero geolocation calls on load, scroll, focus and typing; the tap makes
//      exactly one call with high accuracy, a 12 s timeout and a 60 s maximumAge
//   B  grant: ONE line at the end of the note, label per page language, 6-decimal rounding, the accuracy shown
//      honestly, React state followed (not just the node), no raw coordinates on screen, the maps link opens in a
//      new tab with noopener, the form is never submitted
//   C  deny / timeout / unavailable / no API: the right sentence, the note untouched, the control usable again
//   D  accuracy worse than 500 m: said, still added, "try again" REPLACES the line (never two)
//   E  the 280 limit (and a smaller maxlength): 270 + link refused, an exact fit accepted, the customer's words
//      never cut
//   F  remove, edit-then-remove, a deleted line returns the control to idle, a remembered line is shown
//   G  double tap and a tap while busy make one request; busy state is announced
//   H  language switch in place (ar/en), re-render survival (node, whole grid), navigation away and back, SPA
//      back button, no mutation storm
//   I  Permissions-Policy: hidden while geolocation=() blocks the call (the header is live as (self) now; this is
//      the safety net if it ever says () again), shown for (self) and when the API cannot tell. Safari and Firefox
//      have no document.permissionsPolicy, so there the control is always shown (modelled with the API removed)
//   J  zero third-party requests, none after the tap, nothing outside the control changes (DOM diff, geometry,
//      mutation records), the add-on's older governorate auto-pick still works
//   K  390 and 1280 px, RTL/LTR logical edges, 44 px targets, contrast 4.5:1 in light and dark, focus order and
//      the keyboard ring in the brand orange, keyboard activation keeps focus
//   L  static: no dollar sign / inline handler in the add-on, .htaccess changes ONLY geolocation, Checkout.jsx and
//      translations carry the same strings and the same note-line contract
//   N  the line is NEVER persisted: the storefront's "remember these details" writes the whole form (note
//      included) to localStorage "sporta.delivery" and the quick checkout prints and submits it, so an old pin
//      would ride on the next order. A seeded profile is scrubbed on load (both write orders), a write stores
//      no line, getItem never returns one, SPA navigation to /checkout re-scrubs, the in-page note keeps its
//      line, every other key/field passes through byte for byte (value, return, exception), installed once
//   O  the review's LOW findings: evaluating the file twice behaves like once; a lookup that never answers ends
//      (25 s watchdog) and a late answer is ignored; a timeout is retried ONCE with low accuracy; 0,0 / null /
//      NaN / out of range are refused; the helper sentence says where the location goes (both languages)
//   P  the repo source (src/lib/delivery.js) strips the same line with the same pattern: pure-function tests,
//      saveDelivery / loadDelivery against a fake localStorage, and a corpus run through BOTH implementations
//
// Mutation check: SPORTA_GOV_JS=<path to a file> points the suite at another add-on; an EMPTY file must fail (the
// number of failures is in the commit message). The suite also proves, in-process, that it can tell the module
// from its absence. scripts/checkout-location-mutants.mjs removes ONE behaviour at a time from the add-on and
// requires the suite to fail for each (SPORTA_SECTIONS=M,N,O,... runs only those sections, for speed).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixture } from './fixtures/checkout-location.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON_FILE = process.env.SPORTA_GOV_JS || join(ROOT, 'public/sporta-gov-autopick.js')
const ADDON = readFileSync(ADDON_FILE, 'utf8')
const ORIGIN = 'https://sporta.test'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const near = (a, b, t) => Math.abs(a - b) <= t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// A section that throws (a control that is not there, a wait that times out) is ONE failure and the run goes on,
// so the mutation check reports a count instead of dying at the first tap.
const ONLY = process.env.SPORTA_SECTIONS ? process.env.SPORTA_SECTIONS.split(',') : null
const section = async (title, fn) => {
  if (ONLY && !ONLY.includes(title.slice(0, 1))) return
  head(title)
  try { await fn() } catch (e) { fail++; console.log('FAIL ' + title.slice(0, 1) + ' section aborted — ' + String(e.message || e).split('\n')[0]) }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

const KUWAIT = { latitude: 29.37591234, longitude: 47.97744567, accuracy: 24.6 }
const LINK = 'https://www.google.com/maps?q=29.375912,47.977446'
const LINE_EN = 'Location: ' + LINK
const LINE_AR = 'الموقع: ' + LINK
const HINT_EN = 'Helps the driver find you. Added to your delivery note and shared only with the shop and the delivery team.'
const HINT_AR = 'يساعد المندوب في الوصول إليك. يُضاف إلى ملاحظة التوصيل ويصل إلى المتجر وفريق التوصيل فقط.'
const OLD_EN = 'A location is in your note. Remove it if you are somewhere else now.'
const OLD_AR = 'يوجد موقع في ملاحظتك. أزله إن كنت في مكان آخر الآن.'

// Everything one scenario needs. `mode` changes what getCurrentPosition does: real | timeout | unavailable | hang |
// throw | absent. Every call is counted (and its options kept) by a wrapper installed before any page script.
async function open(o = {}) {
  const { lang = 'ar', w = 390, h = 844, grant = true, geo = KUWAIT, mode = 'real', note = '', maxlength, policy = 'geolocation=(self)', dark = false, addon = ADDON,
    saved, savedRaw, appAfter = false, ready = '#f-note', fastDog = false, noPolicyApi = false } = o
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US',
    permissions: grant ? ['geolocation'] : [], geolocation: geo,
  })
  const external = [], requests = []
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url())
    requests.push(u.href)
    if (u.origin !== ORIGIN) { external.push(u.href); return route.abort() }
    if (u.pathname === '/sporta-gov-autopick.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: addon })
    const headers = policy ? { 'permissions-policy': policy } : {}
    return route.fulfill({ contentType: 'text/html; charset=utf-8', headers, body: fixture(lang, { note, maxlength, themeDark: dark, saved, savedRaw, appAfter }) })
  })
  // Runs before any page script, so the add-on wraps THIS setItem/getItem: the spy is the "native" layer. It records
  // what the native layer is given, throws QuotaExceededError for the key "boom" or a value containing QUOTA, and
  // keeps the real functions for tests that need to write an unscrubbed value behind the add-on's back.
  await ctx.addInitScript(`(function () {
      var SP = Storage.prototype, os = SP.setItem, og = SP.getItem;
      window.__sets = []; window.__nativeSet = function (st, k, v) { return os.call(st, k, v) }; window.__nativeGet = function (st, k) { return og.call(st, k) };
      SP.setItem = function (k, v) {
        window.__sets.push([this === window.localStorage ? 'l' : 's', String(k), String(v)]);
        if (k === 'boom' || String(v).indexOf('QUOTA') >= 0) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return os.apply(this, arguments);
      };
      window.__timeouts = []; var st = window.setTimeout;
      window.setTimeout = function (f, ms) {
        window.__timeouts.push(ms);
        var a = Array.prototype.slice.call(arguments); if (${fastDog ? 'true' : 'false'} && ms === 25000) a[1] = 300;
        return st.apply(window, a);
      };
      if (${noPolicyApi ? 'true' : 'false'}) { try { Object.defineProperty(Document.prototype, 'permissionsPolicy', { value: undefined, configurable: true }); Object.defineProperty(Document.prototype, 'featurePolicy', { value: undefined, configurable: true }); } catch (e) {} }
    })();
    window.__geoMode = ${JSON.stringify(mode)}; window.__geoCalls = 0; window.__geoOpts = []; window.__watch = 0;
    (function () {
      if (window.__geoMode === 'absent') { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); return }
      var g = navigator.geolocation; if (!g) return
      var orig = g.getCurrentPosition.bind(g), ow = g.watchPosition.bind(g)
      g.getCurrentPosition = function (ok, err, opts) {
        window.__geoCalls++; window.__geoOpts.push(opts)
        var m = window.__geoMode
        if (m === 'timeout') { setTimeout(function () { err({ code: 3, message: 'Timeout' }) }, 30); return }
        if (m === 'timeout-once' && window.__geoCalls === 1) { setTimeout(function () { err({ code: 3, message: 'Timeout' }) }, 30); return }
        if (m === 'late') { setTimeout(function () { ok({ coords: { latitude: 29.37, longitude: 47.97, accuracy: 10 } }) }, 1600); return }
        var bad = { nullcoords: { latitude: null, longitude: null, accuracy: 10 }, nan: { latitude: NaN, longitude: 47.9, accuracy: 10 }, range: { latitude: 91, longitude: 47.9, accuracy: 10 }, lng: { latitude: 29.3, longitude: 181, accuracy: 10 }, str: { latitude: 'abc', longitude: '47.9', accuracy: 10 } }[m]
        if (bad) { setTimeout(function () { ok({ coords: bad }) }, 30); return }
        if (m === 'unavailable') { setTimeout(function () { err({ code: 2, message: 'Position unavailable' }) }, 30); return }
        if (m === 'hang') return
        if (m === 'throw') throw new Error('boom')
        return orig(ok, err, opts)
      }
      g.watchPosition = function () { window.__watch++; return ow.apply(g, arguments) }
    })()`)
  const pg = await ctx.newPage()
  pg.setDefaultTimeout(4000)
  const errors = []
  pg.on('pageerror', (e) => errors.push(String(e)))
  await pg.goto(ORIGIN + '/checkout')
  await pg.waitForSelector(ready)
  await sleep(350)   // the add-on's first pass (script is defer) and its debounce
  return { pg, ctx, external, requests, errors }
}
const done = async (s) => { await s.ctx.close() }

const note = (pg) => pg.$eval('#f-note', (e) => e.value)
const stateNote = (pg) => pg.evaluate(() => window.__state.note)
const count = (pg) => pg.evaluate(() => document.querySelectorAll('#sporta-loc').length)
const btnText = (pg) => pg.$eval('#sporta-loc-btn', (e) => e.textContent).catch(() => null)
const status = (pg) => pg.$eval('#sporta-loc-status', (e) => e.textContent).catch(() => null)
const hint = (pg) => pg.$eval('#sporta-loc-hint', (e) => e.textContent).catch(() => null)
const act = (pg) => pg.$eval('#sporta-loc-btn', (e) => e.getAttribute('data-act')).catch(() => null)
const calls = (pg) => pg.evaluate(() => window.__geoCalls)
async function tap(pg) {
  await pg.click('#sporta-loc-btn')
  await pg.waitForFunction(() => { const b = document.getElementById('sporta-loc-btn'); return b && !b.disabled }, null, { timeout: 8000 })
  await sleep(60)
}
const settle = () => sleep(450)

// ---------------------------------------------------------------------------------------------------------------
await section('M  the suite can tell the module from its absence', async () => {
{
  const withIt = await open()
  const without = await open({ addon: '' })
  is((await count(withIt.pg)) === 1, 'M1 with the real file the control is on the page')
  is((await count(without.pg)) === 0, 'M2 with an EMPTY add-on there is no control (the suite is not blind)')
  await done(withIt); await done(without)
}

})
await section('A  nothing is asked before the tap', async () => {
{
  const s = await open()
  const { pg } = s
  await pg.mouse.wheel(0, 600); await pg.focus('#f-note'); await pg.keyboard.type('Blue gate'); await pg.fill('#f-street', 'Street 4'); await settle()
  is((await calls(pg)) === 0, 'A1 zero getCurrentPosition calls after load, scroll, focus and typing')
  is((await pg.evaluate(() => window.__watch)) === 0, 'A2 watchPosition is never used (no tracking)')
  await tap(pg)
  is((await calls(pg)) === 1, 'A3 the tap makes exactly one call')
  const o = await pg.evaluate(() => window.__geoOpts[0])
  is(o && o.enableHighAccuracy === true && o.timeout === 12000 && o.maximumAge === 60000, 'A4 options: high accuracy, 12 s timeout, 60 s maximumAge', JSON.stringify(o))
  is(s.errors.length === 0, 'A5 no page errors', s.errors.join('|'))
  await done(s)
}

})
await section('B  grant', async () => {
for (const lang of ['ar', 'en']) {
  const s = await open({ lang })
  const { pg } = s
  const LINE = lang === 'ar' ? LINE_AR : LINE_EN
  is(await pg.$eval('#f-note', (e) => e.value) === '', `B1 ${lang} the note starts empty`)
  await tap(pg)
  is((await note(pg)) === LINE, `B2 ${lang} the note is exactly the label + maps link, 6 decimals (rounded, not cut)`, await note(pg))
  is((await stateNote(pg)) === LINE, `B3 ${lang} React state holds it (native setter + input event), not just the node`)
  const st = await status(pg)
  is(/25/.test(st) && (lang === 'ar' ? /تقارب/.test(st) : /about 25 m/.test(st)), `B4 ${lang} accuracy shown honestly: "${st}"`)
  is((await btnText(pg)) === (lang === 'ar' ? 'إزالة' : 'Remove') && (await act(pg)) === 'remove', `B5 ${lang} the button becomes Remove`)
  const vis = await pg.$eval('#sporta-loc', (e) => e.innerText)
  is(!/\d+\.\d{3,}/.test(vis), `B6 ${lang} raw coordinates are not shown on screen`, vis.replace(/\n/g, ' / '))
  const a = await pg.$eval('#sporta-loc-open', (e) => ({ href: e.href, target: e.target, rel: e.rel, text: e.textContent, shown: getComputedStyle(e).display !== 'none' }))
  is(a.href === LINK && a.target === '_blank' && /noopener/.test(a.rel) && a.shown, `B7 ${lang} "${a.text}" opens the map link in a new tab with rel noopener`, JSON.stringify(a))
  is((await pg.evaluate(() => window.__submits)) === 0, `B8 ${lang} the form was not submitted`)
  is(await pg.$eval('#sporta-loc-btn', (e) => e.type) === 'button', `B9 ${lang} real <button type=button>`)
  is((await calls(pg)) === 1, `B10 ${lang} one geolocation call`)
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'Gate 3, blue door' })
  await tap(s.pg)
  is((await note(s.pg)) === 'Gate 3, blue door ' + LINE_EN, 'B11 an existing note keeps its words; the line follows after ONE space, on the same line')
  is(!(await note(s.pg)).includes('\n'), 'B12 no newline anywhere (the server deletes control characters)')
  await done(s)
}
{
  const s = await open({ lang: 'en', geo: { latitude: 29.3, longitude: 47.9, accuracy: 3.2 } })
  await tap(s.pg)
  is((await note(s.pg)) === 'Location: https://www.google.com/maps?q=29.300000,47.900000', 'B13 coordinates are padded to 6 decimals', await note(s.pg))
  is(/about 3 m/.test(await status(s.pg)), 'B14 accuracy 3.2 m is reported as 3 m')
  await done(s)
}

})
await section('C  deny / timeout / unavailable / no API', async () => {
{
  const cases = [
    ['denied', { grant: false }, { en: /Location is turned off for this site\. You can still place your order\./, ar: /متوقفة لهذا المتجر/ }],
    ['timeout', { mode: 'timeout' }, { en: /Could not get your location\. Your order is not affected\./, ar: /تعذّر تحديد موقعك/ }],
    ['unavailable', { mode: 'unavailable' }, { en: /Could not get your location\. Your order is not affected\./, ar: /طلبك لا يتأثر/ }],
    ['thrown', { mode: 'throw' }, { en: /Could not get your location\. Your order is not affected\./, ar: /تعذّر/ }],
    ['no API', { mode: 'absent' }, { en: /Could not get your location\. Your order is not affected\./, ar: /تعذّر/ }],
  ]
  for (const [name, opts, re] of cases) for (const lang of ['en', 'ar']) {
    const s = await open({ lang, note: 'Gate 3', ...opts })
    await tap(s.pg)
    const st = await status(s.pg)
    is(re[lang].test(st), `C1 ${name} ${lang} says: "${st.slice(0, 70)}"`)
    is((await note(s.pg)) === 'Gate 3' && (await stateNote(s.pg)) === 'Gate 3', `C2 ${name} ${lang} the note is untouched`)
    is((await act(s.pg)) === 'share' && !(await s.pg.$eval('#sporta-loc-btn', (e) => e.disabled)), `C3 ${name} ${lang} the control is usable again`)
    is((await s.pg.evaluate(() => window.__submits)) === 0, `C4 ${name} ${lang} nothing submitted`)
    if (name === 'denied') is(/browser settings/.test(st) || lang === 'ar', 'C5 denied (en) explains how to turn it on in one sentence')
    await done(s)
  }
}

})
await section('D  accuracy worse than 500 m', async () => {
{
  const s = await open({ lang: 'en', geo: { latitude: 29.3759, longitude: 47.9774, accuracy: 900 } })
  const { pg } = s
  await tap(pg)
  is((await note(pg)) === 'Location: https://www.google.com/maps?q=29.375900,47.977400', 'D1 still added')
  is(/only accurate to about 900 m/.test(await status(pg)), 'D2 and it says so', await status(pg))
  is(await pg.$eval('#sporta-loc-retry', (e) => getComputedStyle(e).display !== 'none' && e.textContent === 'Try again'), 'D3 "Try again" is offered')
  await s.ctx.setGeolocation({ latitude: 29.3111, longitude: 47.4822, accuracy: 20 })
  await pg.click('#sporta-loc-retry')
  await pg.waitForFunction(() => !document.getElementById('sporta-loc-btn').disabled)
  await sleep(80)
  const v = await note(pg)
  is((v.match(/Location:/g) || []).length === 1, 'D4 trying again REPLACES the line (one line, never two)', v)
  is(/q=29\.3111(00)?,47\.4822(00)?/.test(v) && !/29\.3759/.test(v), 'D5 and it holds the new position', v)
  const ro = await pg.evaluate(() => window.__geoOpts[1])
  is(ro && ro.maximumAge === 0 && ro.enableHighAccuracy === true && ro.timeout === 12000, 'D4b "Try again" asks for a FRESH reading (maximumAge 0): the 60 s cache would hand back the same poor fix', JSON.stringify(ro))
  is(/about 20 m/.test(await status(pg)) && (await pg.$eval('#sporta-loc-retry', (e) => getComputedStyle(e).display)) === 'none', 'D6 now precise: normal message, no retry button')
  await done(s)
}

})
await section('E  the note limit', async () => {
{
  const mk = (n) => 'a'.repeat(n)
  const cases = [
    ['280 / en, 270 chars', { lang: 'en', note: mk(270) }, false],
    ['280 / en, 221 chars', { lang: 'en', note: mk(221) }, false],
    ['280 / en, 220 chars (exact fit)', { lang: 'en', note: mk(220) }, true],
    ['280 / ar, 222 chars (exact fit, shorter label)', { lang: 'ar', note: mk(222) }, true],
    ['280 / ar, 223 chars', { lang: 'ar', note: mk(223) }, false],
    ['maxlength 150 / en, 91 chars', { lang: 'en', note: mk(91), maxlength: 150 }, false],
    ['maxlength 150 / en, 90 chars (exact fit)', { lang: 'en', note: mk(90), maxlength: 150 }, true],
    ['no maxlength attribute -> 280 / en, 220 chars', { lang: 'en', note: mk(220), maxlength: null }, true],
    ['no maxlength attribute -> 280 / en, 221 chars', { lang: 'en', note: mk(221), maxlength: null }, false],
    ['maxlength 400 is capped at the server\'s 280 / en, 250 chars', { lang: 'en', note: mk(250), maxlength: 400 }, false],
  ]
  for (const [name, opts, fits] of cases) {
    const s = await open(opts)
    const before = opts.note
    await tap(s.pg)
    const v = await note(s.pg)
    const lim = opts.maxlength && opts.maxlength < 280 ? opts.maxlength : 280
    if (fits) {
      is(v.length <= lim && v.startsWith(before + ' ') && /maps\?q=/.test(v) && (await stateNote(s.pg)) === v, `E1 ${name}: accepted, ${v.length} <= ${lim}`, String(v.length))
      if (name.includes('exact fit') && !opts.maxlength) is(v.length === 280, 'E2 ' + name + ': uses all 280')
    } else {
      const st = await status(s.pg)
      is(v === before && (await stateNote(s.pg)) === before, `E1 ${name}: refused, the note is exactly as typed (not cut)`)
      is(/too long to add the location|طويلة جد/.test(st), `E3 ${name}: says "${st}"`)
      is((await act(s.pg)) === 'share', `E4 ${name}: the control stays idle`)
    }
    await done(s)
  }
}

})
await section('F  remove, edit, deleted line, remembered line', async () => {
{
  const s = await open({ lang: 'en', note: 'Gate 3' })
  const { pg } = s
  await tap(pg)
  await pg.click('#sporta-loc-btn')   // now "Remove"
  await sleep(80)
  is((await note(pg)) === 'Gate 3' && (await stateNote(pg)) === 'Gate 3', 'F1 Remove deletes the line and its separator, nothing else; React state follows')
  is((await act(pg)) === 'share' && (await btnText(pg)) === 'Share my location (optional)', 'F2 back to idle')
  is(/Location removed\./.test(await status(pg)), 'F3 and says so')
  await tap(pg)
  is((await note(pg)) === 'Gate 3 ' + LINE_EN, 'F4 sharing again after a removal writes one line')
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'Gate 3' })
  const { pg } = s
  await tap(pg)
  await pg.focus('#f-note'); await pg.keyboard.press('Control+Home'); await pg.keyboard.type('Blue ')
  is((await note(pg)) === 'Blue Gate 3 ' + LINE_EN && (await act(pg)) === 'remove', 'F5 typing BEFORE the line: the control still tracks it')
  await pg.keyboard.press('Control+End'); await pg.keyboard.type(' call me')
  await settle()
  is((await note(pg)) === 'Blue Gate 3 ' + LINE_EN + ' call me' && (await act(pg)) === 'remove', 'F6 typing AFTER the line: still tracked')
  await pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(pg)) === 'Blue Gate 3 call me' && (await stateNote(pg)) === 'Blue Gate 3 call me', 'F7 Remove takes out the line and ONE space, keeps the customer\'s later words', await note(pg))
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'Gate 3' })
  const { pg } = s
  await tap(pg)
  await pg.focus('#f-note'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('My own words')
  await settle()
  is((await act(pg)) === 'share' && (await note(pg)) === 'My own words', 'F8 the customer deletes the line by hand: the control returns to idle')
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'Gate 3 ' + LINE_EN })
  const { pg } = s
  is((await act(pg)) === 'remove' && (await status(pg)) === OLD_EN && !/earlier/.test(await status(pg)), 'F9 a line the control did not write this session (pasted) is shown as "in your note", with Remove; nothing claims it was "added earlier" (it can no longer come back from storage, see N)', await status(pg))
  is(await pg.$eval('#sporta-loc-open', (e) => e.href) === LINK, 'F10 and its map link is the one in the note')
  await pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(pg)) === 'Gate 3', 'F11 Remove clears it')
  await done(s)
}
{
  const s = await open({ lang: 'en', note: LINE_EN + ' then more' })
  await s.pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(s.pg)) === 'then more', 'F12 a line at the START leaves no leading space when removed', JSON.stringify(await note(s.pg)))
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'x ' + LINE_EN + ' y ' + LINE_AR })
  await s.pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(s.pg)) === 'x y', 'F13 two lines (cannot be made here, but could be pasted) both go on Remove', JSON.stringify(await note(s.pg)))
  await done(s)
}

})
await section('G  double tap, tap while busy', async () => {
{
  const s = await open({ lang: 'en' })
  await s.pg.dblclick('#sporta-loc-btn'); await settle()
  const v = await note(s.pg)
  is((await calls(s.pg)) === 1 || (v === '' && (await calls(s.pg)) === 2), 'G1 a double tap does not stack requests', 'calls=' + (await calls(s.pg)))
  is((v.match(/Location:/g) || []).length <= 1, 'G2 and never writes two lines', v)
  await done(s)
}
{
  const s = await open({ lang: 'en', mode: 'hang' })
  const { pg } = s
  await pg.click('#sporta-loc-btn')
  const b = await pg.$eval('#sporta-loc-btn', (e) => ({ disabled: e.disabled, busy: e.getAttribute('aria-busy'), text: e.textContent }))
  is(b.disabled && b.busy === 'true' && b.text === 'Finding your location…', 'G3 while locating: disabled, aria-busy, "Finding your location…"', JSON.stringify(b))
  is(/Finding your location/.test(await status(pg)), 'G4 the live region says it too')
  await pg.evaluate(() => { const x = document.getElementById('sporta-loc-btn'); x.click(); x.click() })
  is((await calls(pg)) === 1, 'G5 more taps while busy make no second request')
  await done(s)
}

})
await section('H  language switch, re-render, navigation', async () => {
{
  const s = await open({ lang: 'ar' })
  const { pg } = s
  is((await btnText(pg)) === 'مشاركة موقعي (اختياري)' && (await hint(pg)) === HINT_AR, 'H1 ar idle: the exact Arabic button and helper line')
  await pg.evaluate(() => window.__lang('en')); await settle()
  is((await btnText(pg)) === 'Share my location (optional)' && (await hint(pg)) === HINT_EN, 'H2 switching to English relabels the SAME control in place')
  is((await pg.$eval('#sporta-loc', (e) => e.getAttribute('aria-label'))) === 'Delivery location (optional)', 'H3 the region label follows')
  await tap(pg)
  is((await note(pg)) === LINE_EN, 'H4 shared in English: English label')
  await pg.evaluate(() => window.__lang('ar')); await settle()
  is((await btnText(pg)) === 'إزالة' && /تقارب 25 م/.test(await status(pg)), 'H5 back to Arabic while a location is on: Arabic status, the note line is left as it was written', await status(pg))
  is((await note(pg)) === LINE_EN && (await count(pg)) === 1, 'H6 the language change did not touch the note or duplicate the control')
  await done(s)
}
{
  const s = await open({ lang: 'en', note: 'Gate 3' })
  const { pg } = s
  await tap(pg)
  const want = 'Gate 3 ' + LINE_EN
  // harness validity: a plain assignment is undone by a render, which is what the native setter avoids
  await pg.evaluate(() => { document.getElementById('f-note').value = 'plain assignment' })
  await pg.evaluate(() => window.__rerender('node')); await settle()
  is((await note(pg)) === want, 'H7 (harness) a plain value assignment does not move React state: the next render restores the real note', await note(pg))
  is((await count(pg)) === 1 && (await act(pg)) === 'remove', 'H8 after the note node is replaced the control is still there once, still tracking the line')
  const adj = await pg.evaluate(() => { const n = document.getElementById('sporta-loc'); return n.previousElementSibling === document.getElementById('f-note').parentElement && n.parentElement.id === 'addr-grid' })
  is(adj, 'H9 and it sits directly after the (new) note wrapper, inside the same grid')
  await pg.evaluate(() => window.__rerender('grid')); await settle()
  is((await count(pg)) === 1 && (await act(pg)) === 'remove' && (await note(pg)) === want, 'H10 after the WHOLE grid is rebuilt (the control wiped) it is put back once, state intact')
  await pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(pg)) === 'Gate 3' && (await stateNote(pg)) === 'Gate 3', 'H11 Remove still reaches React state after re-renders')
  await done(s)
}
{
  const s = await open({ lang: 'en' })
  const { pg } = s
  await tap(pg)
  const c1 = await calls(pg)
  await pg.evaluate(() => window.__go('/shop')); await settle()
  is((await count(pg)) === 0, 'H12 off /checkout the control is gone')
  await pg.evaluate(() => window.__go('/checkout')); await settle()
  is((await count(pg)) === 1 && (await act(pg)) === 'remove' && (await note(pg)) === LINE_EN, 'H13 back on /checkout: one control, the line still in the note, shown as such')
  is((await calls(pg)) === c1, 'H14 navigating asked for nothing')
  await pg.goBack(); await settle()
  is((await count(pg)) === 0, 'H15 the back button (popstate) removes it too')
  await pg.goForward(); await settle()
  is((await count(pg)) === 1, 'H16 and forward brings it back')
  await done(s)
}
{
  const s = await open({ lang: 'en', mode: 'hang' })
  const { pg } = s
  await pg.click('#sporta-loc-btn')
  await pg.evaluate(() => window.__go('/shop')); await settle()
  await pg.evaluate(() => window.__go('/checkout')); await settle()
  is((await count(pg)) === 1 && (await act(pg)) === 'share' && !(await pg.$eval('#sporta-loc-btn', (e) => e.disabled)), 'H17 leaving while a lookup is pending: the control comes back idle, not stuck busy')
  await done(s)
}
{
  const s = await open({ lang: 'en' })
  const { pg } = s
  await pg.evaluate(() => { window.__recs = 0; new MutationObserver((r) => { window.__recs += r.length }).observe(document.getElementById('sporta-loc'), { subtree: true, childList: true, characterData: true, attributes: true }) })
  await pg.focus('#f-street'); await pg.keyboard.type('Street number twenty four'); await pg.focus('#f-note'); await pg.keyboard.type('hello there'); await sleep(900)
  is((await pg.evaluate(() => window.__recs)) === 0, 'H18 idle, typing elsewhere and in the note: zero mutations inside the control (no storm)', String(await pg.evaluate(() => window.__recs)))
  await done(s)
}

})
await section('I  Permissions-Policy', async () => {
{
  const blocked = await open({ lang: 'en', policy: 'geolocation=()' })
  const supports = await blocked.pg.evaluate(() => { const p = document.permissionsPolicy || document.featurePolicy; return !!(p && p.allowsFeature) })
  if (!supports) console.log('note: this Chromium has no document.permissionsPolicy; the hide-while-blocked checks are skipped')
  else {
    const allowed = await blocked.pg.evaluate(() => (document.permissionsPolicy || document.featurePolicy).allowsFeature('geolocation'))
    is(allowed === false, 'I1 (harness) the browser reports geolocation as blocked under geolocation=()')
    is((await count(blocked.pg)) === 0, 'I2 blocked by the header (Chromium reports it): the control is NOT shown (a tap could only fail)')
    is((await calls(blocked.pg)) === 0, 'I3 and nothing is requested')
  }
  await done(blocked)
  {
    // Safari and Firefox expose no document.permissionsPolicy: under a geolocation=() header they cannot tell, so the
    // control is shown and a refused call is handled like any denied lookup. (Modelled by removing the API.)
    const s = await open({ lang: 'en', policy: 'geolocation=()', noPolicyApi: true, grant: false })
    is((await s.pg.evaluate(() => !(document.permissionsPolicy || document.featurePolicy))), 'I5 (harness) this page has no permissionsPolicy API, like Safari and Firefox')
    is((await count(s.pg)) === 1, 'I6 without the API the control is shown even if the header says geolocation=() (it cannot know)')
    await tap(s.pg)
    is(/turned off for this site/.test(await status(s.pg)) && (await note(s.pg)) === '', 'I7 and a refused tap is handled: the denied sentence, the note untouched')
    await done(s)
  }
  for (const [label, policy] of [['geolocation=(self)', 'geolocation=(self)'], ['no header', ''], ['other features only', 'camera=(), microphone=()']]) {
    const s = await open({ lang: 'en', policy })
    is((await count(s.pg)) === 1, `I4 ${label}: the control is shown`)
    await done(s)
  }
}

})
await section('J  network, nothing else changes', async () => {
{
  const s = await open({ lang: 'en' })
  const { pg } = s
  const before = s.requests.length
  await tap(pg); await sleep(300)
  is(s.external.length === 0, 'J1 zero third-party requests', s.external.join(','))
  is(s.requests.length === before, 'J2 not one request of any kind after the tap (no map tile, no beacon)', s.requests.slice(before).join(','))
  is(s.requests.every((u) => u.startsWith(ORIGIN + '/')), 'J3 every request of the whole session is same-origin')
  await done(s)
}
{
  const snap = (pg) => pg.evaluate(() => {
    const c = document.getElementById('sporta-loc'); const clone = document.documentElement.cloneNode(true)
    const cc = clone.querySelector('#sporta-loc'); if (cc) cc.remove()
    const fields = [...document.querySelectorAll('input,select,textarea')].filter((e) => e.id !== 'f-note').map((e) => e.id + '=' + e.value)
    const rects = [...document.querySelectorAll('header, h1, legend, label, input, select, textarea')].filter((e) => !(c && c.contains(e)) && (e.compareDocumentPosition(document.getElementById('f-note')) & Node.DOCUMENT_POSITION_FOLLOWING || e.id === 'f-note'))
      .map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, e.id, Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)].join(':') })
    return { html: clone.outerHTML, fields, rects, active: document.activeElement && document.activeElement.id, title: document.title, lang: document.documentElement.lang }
  })
  const plain = await open({ lang: 'en', addon: '' })
  const withIt = await open({ lang: 'en' })
  const A = await snap(plain.pg), B = await snap(withIt.pg)
  is(A.html === B.html, 'J4 with the add-on, the page minus the control is byte-identical to the page without it', A.html === B.html ? '' : 'differs')
  is(JSON.stringify(A.rects) === JSON.stringify(B.rects), 'J5 every element before the control stays exactly where it was (position and size)')
  await withIt.pg.evaluate(() => { window.__out = []; new MutationObserver((rs) => { rs.forEach((r) => { if (!r.target.closest || !r.target.closest('#sporta-loc')) { if (!(r.target.nodeType === 1 && r.target.id === 'sporta-loc')) window.__out.push(r.type + ':' + (r.target.id || r.target.nodeName)) } }) }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }) })
  await tap(withIt.pg)
  const out = await withIt.pg.evaluate(() => window.__out)
  is(out.length === 0, 'J6 the tap changes no DOM node outside the control (mutation records)', out.join(','))
  const C = await snap(withIt.pg)
  is(A.html === C.html, 'J7 after sharing, the page minus the control is still identical (only the note\'s value property changed)')
  is(JSON.stringify(B.fields) === JSON.stringify(C.fields) && JSON.stringify(B.rects) === JSON.stringify(C.rects.slice(0, B.rects.length)) && B.lang === C.lang && B.title === C.title, 'J8 every other field value, the title and the language are unchanged')
  await done(plain); await done(withIt)
}
{
  const s = await open({ lang: 'en' })
  const { pg } = s
  await pg.fill('#f-area', 'Salmiya'); await pg.focus('#f-street'); await sleep(500)
  is((await pg.$eval('#f-governorate', (e) => e.value)) === 'hawalli' && (await pg.$eval('#f-area', (e) => e.value)) === 'Salmiya', 'J9 the older add-on feature still works: a known area picks its governorate and keeps the typed area')
  await done(s)
}

})
await section('K  layout, targets, contrast, focus', async () => {
for (const [w, h] of [[390, 844], [1280, 800]]) for (const lang of ['ar', 'en']) {
  const s = await open({ lang, w, h, geo: { latitude: 29.3759, longitude: 47.9774, accuracy: 900 } })
  const { pg } = s
  const geom = async () => pg.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }
    const grid = document.getElementById('addr-grid'), n = document.getElementById('sporta-loc')
    const show = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' ? r(e) : null }
    return { grid: r(grid), n: r(n), note: r(document.getElementById('f-note')), btn: show('sporta-loc-btn'), open: show('sporta-loc-open'), retry: show('sporta-loc-retry'),
      overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth }
  })
  let g = await geom()
  const tag = `${w}px ${lang}`
  is(near(g.n.l, g.grid.l, 1) && near(g.n.r, g.grid.r, 1), `K1 ${tag} the control spans the whole grid row (both columns at 1280)`, `${g.n.l}-${g.n.r} vs ${g.grid.l}-${g.grid.r}`)
  is(g.n.t >= g.note.b - 1, `K2 ${tag} it sits below the note`)
  is(g.btn.h >= 44 && g.btn.w >= 44, `K3 ${tag} the main button is at least 44x44 (${Math.round(g.btn.w)}x${Math.round(g.btn.h)})`)
  is(lang === 'ar' ? near(g.btn.r, g.grid.r, 1.5) : near(g.btn.l, g.grid.l, 1.5), `K4 ${tag} logical start edge: the button starts at the ${lang === 'ar' ? 'right' : 'left'} edge`)
  is(g.overflow <= 0 && g.n.r <= w + 0.5 && g.n.l >= -0.5, `K5 ${tag} no sideways overflow`)
  await tap(pg)
  g = await geom()
  is(g.btn.h >= 44 && g.open && g.open.h >= 44 && g.open.w >= 44 && g.retry && g.retry.h >= 44, `K6 ${tag} Remove, the maps link and Try again are all at least 44 px tall`, `${Math.round(g.btn.h)}/${g.open && Math.round(g.open.h)}/${g.retry && Math.round(g.retry.h)}`)
  is(g.overflow <= 0, `K7 ${tag} no overflow in the done state`)
  await done(s)
}
for (const dark of [false, true]) {
  const s = await open({ lang: 'en', dark, geo: { latitude: 29.3759, longitude: 47.9774, accuracy: 900 } })
  const { pg } = s
  const probe = (id) => pg.evaluate((id) => {
    const e = document.getElementById(id); const cs = getComputedStyle(e)
    let bg = null, p = e
    while (p) { const c = getComputedStyle(p).backgroundColor; if (c && !/rgba\(.*, 0\)|transparent/.test(c)) { bg = c; break } p = p.parentElement }
    return { color: cs.color, bg: bg || 'rgb(255, 255, 255)' }
  }, id)
  const check = async (label) => {
    for (const id of ['sporta-loc-btn', 'sporta-loc-status', 'sporta-loc-hint', 'sporta-loc-open', 'sporta-loc-retry']) {
      const shown = await pg.$eval('#' + id, (e) => getComputedStyle(e).display !== 'none')
      if (!shown) continue
      const { color, bg } = await probe(id)
      const r = ratio(color, bg)
      is(r >= 4.5, `K8 ${dark ? 'dark' : 'light'} ${label} #${id} text ${color} on ${bg} = ${r.toFixed(2)}:1`)
    }
  }
  await check('idle')
  await tap(pg)
  await check('done')
  const ring = await pg.evaluate(() => getComputedStyle(document.getElementById('sporta-loc-btn')).borderTopColor)
  const lineRatio = ratio(ring, dark ? 'rgb(23, 26, 30)' : 'rgb(255, 255, 255)')
  is(lineRatio >= 3, `K9 ${dark ? 'dark' : 'light'} the button border is a 3:1 control edge (${lineRatio.toFixed(2)}:1)`)
  await done(s)
}
{
  const s = await open({ lang: 'en' })
  const { pg } = s
  await pg.focus('#f-note')
  await pg.keyboard.press('Tab')
  is((await pg.evaluate(() => document.activeElement.id)) === 'sporta-loc-btn', 'K10 focus order: the note, then the control')
  const ring = await pg.$eval('#sporta-loc-btn', (e) => { const c = getComputedStyle(e); return { s: c.outlineStyle, w: c.outlineWidth, c: c.outlineColor } })
  is(ring.s === 'solid' && ring.w === '3px' && ring.c === 'rgb(224, 86, 28)', 'K11 the keyboard ring is 3 px in the brand orange #E0561C', JSON.stringify(ring))
  is(ratio('rgb(224, 86, 28)', 'rgb(255, 255, 255)') >= 3, 'K12 and that orange is a 3:1 indicator on the white card')
  await pg.keyboard.press('Enter')
  await pg.waitForFunction(() => document.getElementById('sporta-loc-btn').getAttribute('data-act') === 'remove')
  await sleep(120)
  is((await note(pg)) === LINE_EN, 'K13 Enter on the button shares (keyboard activation)')
  is((await pg.evaluate(() => document.activeElement.id)) === 'sporta-loc-btn', 'K14 and focus is still on the control afterwards (a disabled button does not strand it)')
  await pg.keyboard.press('Tab')
  is((await pg.evaluate(() => document.activeElement.id)) === 'sporta-loc-open', 'K15 done: Tab goes Remove -> Open in Maps')
  await pg.keyboard.press('Tab')
  is((await pg.evaluate(() => document.activeElement.type + ':' + document.activeElement.closest('label')?.className.includes('tap-row'))) === 'checkbox:true', 'K16 then straight on to the next control of the form (remember details); no hidden stops')
  await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Space')
  await sleep(100)
  is((await note(pg)) === '' && (await stateNote(pg)) === '', 'K17 Space on Remove removes the line (note was empty before)')
  await pg.mouse.click(5, 5)
  await pg.click('#sporta-loc-btn'); await sleep(200)
  const mouseRing = await pg.$eval('#sporta-loc-btn', (e) => getComputedStyle(e).outlineStyle)
  is(mouseRing === 'none', 'K18 a mouse tap does not draw the keyboard ring', mouseRing)
  const roles = await pg.$eval('#sporta-loc', (e) => ({ role: e.getAttribute('role'), label: !!e.getAttribute('aria-label'), st: e.querySelector('#sporta-loc-status').getAttribute('role'), live: e.querySelector('#sporta-loc-status').getAttribute('aria-live'), desc: e.querySelector('#sporta-loc-btn').getAttribute('aria-describedby') }))
  is(roles.role === 'group' && roles.label && roles.st === 'status' && roles.live === 'polite' && roles.desc === 'sporta-loc-hint', 'K19 labelled group, polite live status, hint attached to the button', JSON.stringify(roles))
  await done(s)
}

})
await section('L  static checks', async () => {
{
  const js = readFileSync(join(ROOT, 'public/sporta-gov-autopick.js'), 'utf8')
  is(!js.includes('$'), 'L1 the add-on has no dollar sign (the installer runs through docker compose)')
  is(!/\son[a-z]+\s*=\s*["']/i.test(js) && !/\.setAttribute\(\s*['"]on/i.test(js) && !/\beval\(|new Function\(/.test(js), 'L2 no inline event handler, eval or Function (the CSP forbids inline script)')
  const loc = js.split('Sporta checkout: OPTIONAL')[1] || ''
  const code = loc.slice(loc.indexOf("(function () {"))   // the code, not the header comment
  is(!/indexedDB|document\.cookie|XMLHttpRequest|fetch\(|sendBeacon|navigator\.permissions|WebSocket|new Image|\.src\s*=/.test(code), 'L3 the location code sends nothing (no fetch, XHR, beacon, image, socket, cookie, indexedDB) and does not use navigator.permissions')
  is((code.match(/STORE_KEY/g) || []).length >= 4 && (code.match(/'sporta\.delivery'/g) || []).length === 1 && !/localStorage\.|sessionStorage\./.test(code), 'L3b the only storage the code names is the one exact key "sporta.delivery", through Storage.prototype and window[name]; it never calls localStorage.* directly')
  is(/\b(rawSet)\.(call|apply)\(/.test(code) && (code.match(/setItem/g) || []).length <= 8 && !/\.setItem\([^)]*(lat|lng|coords)/.test(code), 'L3c it never writes coordinates to storage: setItem is only forwarded or used to write a cleaned value of the key')
  is(/header is live|live since|deploy-20261103T104853Z-8bf6001/.test(js) && !/safe to ship\s+before the header/i.test(js) && /Safari and Firefox do not expose document\.permissionsPolicy/.test(js), 'L3d the file comments say the header is live now and that Safari/Firefox have no document.permissionsPolicy (no "ship before the header" claim)')
  const ht = readFileSync(join(ROOT, 'public/.htaccess'), 'utf8')
  const pp = ht.split('\n').find((l) => /Header set Permissions-Policy/.test(l)) || ''
  const feats = Object.fromEntries([...pp.matchAll(/([a-z-]+)=(\([^)]*\))/g)].map((m) => [m[1], m[2]]))
  is(feats.geolocation === '(self)', 'L4 .htaccess: geolocation=(self)', pp)
  const others = Object.entries(feats).filter(([k]) => k !== 'geolocation')
  is(others.length === 12 && others.every(([, v]) => v === '()'), 'L5 .htaccess: the other 12 features stay disabled', others.map(([k]) => k).join(','))
  const jsx = readFileSync(join(ROOT, 'src/pages/Checkout.jsx'), 'utf8')
  const tr = readFileSync(join(ROOT, 'src/i18n/translations.js'), 'utf8')
  is(/function LocationNote\(/.test(jsx) && /<LocationNote\b/.test(jsx), 'L6 Checkout.jsx has the LocationNote component and renders it')
  is(/useEffect\(\(\) => \{\s*alive\.current = true\s*return \(\) => \{ alive\.current = false/.test(jsx), 'L6b Checkout.jsx sets alive.current = true INSIDE the effect (StrictMode mount-cleanup-mount leaves it true)')
  is(/stripLocation[\s\S]*from '\.\.\/lib\/delivery'/.test(jsx.slice(0, 1200)) && !/const LOCATION_LINE_SRC|function stripLocation/.test(jsx), 'L6c Checkout.jsx imports the pattern and the stripper from lib/delivery.js (one definition, not a copy)')
  is(/enableHighAccuracy: true/.test(jsx) && /timeout: 12000/.test(jsx) && /maximumAge: fresh === true \? 0 : 60000/.test(jsx), 'L7 Checkout.jsx uses the same geolocation options')
  const hintOk = tr.includes("locHint: '" + HINT_EN + "'") && tr.includes("locHint: '" + HINT_AR + "'") && tr.includes("locDoneOld: '" + OLD_EN + "'") && tr.includes("locDoneOld: '" + OLD_AR + "'")
  is(hintOk, 'L10 translations.js carries the same helper sentence and "in your note" sentence as the add-on, in both languages')
  const keys = ['locShare', 'locHint', 'locLocating', 'locDone', 'locDoneWeak', 'locOpen', 'locRemove', 'locRetry', 'locRemoved', 'locDenied', 'locFail', 'locTooLong', 'locRegion', 'locLabel']
  is(keys.every((k) => (tr.match(new RegExp('\\b' + k + ':', 'g')) || []).length === 2), 'L8 translations.js has all ' + keys.length + ' location strings in BOTH languages')
  const comp = jsx.slice(jsx.indexOf('function LocationNote'))
  is(/' '/.test(comp) && !/\\n/.test(comp.slice(0, 4000)), 'L9 Checkout.jsx joins the line with one space, never a newline')
}

})

await section('N  the location line is never persisted', async () => {
const KEY = 'sporta.delivery'
const PROFILE = { name: 'Sara Ali', phone: '55512345', governorate: 'hawalli', area: 'Salmiya', block: '4', street: 'Street 12', building: '5', floor: '2', flat: '7', note: '' }
const withNote = (n) => ({ ...PROFILE, note: n })
const stored = (pg, store = 'localStorage') => pg.evaluate(([st, k]) => window.__nativeGet(window[st], k), [store, KEY])
const parsed = async (pg, store) => { const v = await stored(pg, store); try { return JSON.parse(v) } catch (e) { return v } }
const sets = (pg) => pg.evaluate(() => window.__sets.filter((x) => x[1] === 'sporta.delivery'))
{
  // N1: a customer who ticked "remember" in the minutes since the feature went live. Both languages' labels, the app
  // reading AFTER the add-on (a deferred module behind it).
  for (const [name, saved] of [['en label', withNote('Gate 3 ' + LINE_EN)], ['ar label', withNote('Gate 3 ' + LINE_AR)], ['line only', withNote(LINE_EN)], ['line first', withNote(LINE_AR + ' then more')]]) {
    const s = await open({ lang: 'en', saved, appAfter: true, ready: 'form.purchase-quick' })
    const p = await parsed(s.pg)
    const want = { ...saved, note: { 'en label': 'Gate 3', 'ar label': 'Gate 3', 'line only': '', 'line first': 'then more' }[name] }
    is(JSON.stringify(p) === JSON.stringify(want), `N1 ${name}: the stored profile no longer has the line and every other field is exactly as saved`, JSON.stringify(p))
    const q = await s.pg.evaluate(() => ({ quick: !!document.querySelector('form.purchase-quick'), ta: !!document.getElementById('f-note'), ctl: document.querySelectorAll('#sporta-loc').length, note: document.getElementById('quick-note').textContent, html: document.body.innerHTML }))
    is(q.quick && !q.ta && q.ctl === 0, `N2 ${name}: a complete saved profile opens the QUICK checkout (no textarea, no location control)`)
    is(q.note === want.note && !/maps|Location|الموقع/.test(q.note) && !/google\.com\/maps/.test(q.html), `N3 ${name}: the quick checkout prints the note WITHOUT the pin (so the next order cannot carry it)`, q.note)
    await done(s)
  }
}
{
  // N4: the app reads BEFORE the add-on (inline script, then the deferred add-on): the first paint may have read the
  // old value, but the STORAGE is scrubbed so the visit after this one is clean.
  const s = await open({ lang: 'en', saved: withNote('Gate 3 ' + LINE_EN), appAfter: false, ready: 'form.purchase-quick' })
  const p = await parsed(s.pg)
  is(p && p.note === 'Gate 3', 'N4 app-first order: the stored note is scrubbed on load', JSON.stringify(p))
  await done(s)
}
{
  // N5: a write of the form with a location line stores no line; the page keeps its own
  const s = await open({ lang: 'en', note: 'Gate 3' })
  const { pg } = s
  for (const [id, v] of [['f-name', 'Sara Ali'], ['f-phone', '55512345'], ['f-area', 'Salmiya'], ['f-block', '4'], ['f-street', 'Street 12'], ['f-building', '5']]) await pg.fill('#' + id, v)
  await pg.selectOption('#f-governorate', 'hawalli')
  await tap(pg)
  const before = await note(pg)
  is(before === 'Gate 3 ' + LINE_EN, 'N5a the customer shared a location')
  await pg.evaluate(() => window.__save(true))
  const p = await parsed(pg)
  is(p && p.note === 'Gate 3' && p.name === 'Sara Ali' && p.phone === '55512345' && p.governorate === 'hawalli' && p.area === 'Salmiya' && p.block === '4' && p.street === 'Street 12' && p.building === '5' && p.floor === '' && p.flat === '', 'N5 the saved form has the customer\'s words and every other field, and no location line', JSON.stringify(p))
  const sv = await sets(pg)
  is(sv.length === 1 && !/maps|Location|الموقع/.test(sv[0][2]), 'N6 the NATIVE setItem was handed the cleaned value (nothing with a pin ever reached storage)', JSON.stringify(sv))
  is((await pg.evaluate(() => window.localStorage.getItem('sporta.delivery.remember'))) === '1', 'N7 the remember flag next to it is written as before')
  await sleep(700)
  is((await note(pg)) === before && (await stateNote(pg)) === before && (await act(pg)) === 'remove', 'N8 the IN-PAGE note (textarea and React state) keeps its line, and the control still tracks it')
  await pg.click('#sporta-loc-btn'); await sleep(80)
  is((await note(pg)) === 'Gate 3' && (await stateNote(pg)) === 'Gate 3', 'N9 and Remove still works afterwards')
  // the same customer, next visit: quick checkout, no pin
  await pg.evaluate(() => window.__save(true))
  await pg.reload(); await pg.waitForSelector('form.purchase-quick'); await sleep(350)
  const nq = await pg.$eval('#quick-note', (e) => e.textContent)
  is(nq === 'Gate 3' && (await count(pg)) === 0, 'N10 reload: the quick checkout prints "Gate 3" only (home order, then office order: no stale pin)', nq)
  await done(s)
}
{
  // N11: remember unticked removes the key as before; a note with only the line stores an empty note
  const s = await open({ lang: 'en', note: '' })
  await tap(s.pg)
  await s.pg.evaluate(() => window.__save(true))
  is((await parsed(s.pg)).note === '', 'N11 a note that is ONLY the line is stored empty')
  await s.pg.evaluate(() => window.__save(false))
  is((await stored(s.pg)) === null, 'N12 "remember" unticked still removes the saved details (removeItem untouched)')
  await done(s)
}
{
  // N13: everything that is not our line passes through byte for byte
  const s = await open({ lang: 'en' })
  const { pg } = s
  const plain = '{ "note" : "Gate 3 , blue door" ,"name":"Sara", "zeta":1,"alpha":[1,2] }\n'
  await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, plain])
  is((await stored(pg)) === plain, 'N13 a profile without a line is stored byte for byte (not re-serialised: spacing and key order kept)')
  const other = JSON.stringify({ note: 'x ' + LINE_EN, street: 'near ' + LINE_EN })
  for (const k of ['other', 'sporta.delivery.remember', 'sporta.delivery2', 'Sporta.delivery', 'sporta.deliver']) {
    await pg.evaluate(([kk, v]) => localStorage.setItem(kk, v), [k, other])
    is((await pg.evaluate((kk) => window.__nativeGet(localStorage, kk), k)) === other, `N14 key "${k}" is stored unchanged even when its value holds a pin (only the exact key is touched)`)
  }
  await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ note: 'a ' + LINE_EN + ' b', street: 'near ' + LINE_EN, floor: LINE_AR, extra: { note: LINE_EN + ' z' } })])
  const p = await parsed(pg)
  is(p.note === 'a b' && p.street === 'near ' + LINE_EN && p.floor === LINE_AR && p.extra.note === 'z', 'N15 only NOTE fields lose the line; another field that happens to contain one is untouched', JSON.stringify(p))
  for (const raw of ['not json maps?q=1 ' + LINE_EN, '"' + LINE_EN + '"', JSON.stringify({ note: 5, x: LINE_EN }), JSON.stringify([LINE_EN])]) {
    await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, raw])
    is((await stored(pg)) === raw, `N16 an unexpected shape is left alone, not guessed at: ${raw.slice(0, 28)}`)
  }
  // sessionStorage: same key, same rule; other keys untouched
  await pg.evaluate(([k, v]) => { sessionStorage.setItem(k, v); sessionStorage.setItem('keep', v) }, [KEY, JSON.stringify({ note: 'w ' + LINE_AR })])
  is((await parsed(pg, 'sessionStorage')).note === 'w', 'N17 sessionStorage "sporta.delivery" is cleaned the same way')
  is((await pg.evaluate(() => window.__nativeGet(sessionStorage, 'keep'))) === JSON.stringify({ note: 'w ' + LINE_AR }), 'N18 and another sessionStorage key is not')
  await done(s)
}
{
  // N19: the wrapper keeps the native contract
  const s = await open({ lang: 'en' })
  const { pg } = s
  const r = await pg.evaluate((k) => {
    const out = {}
    out.ret = localStorage.setItem('plain', 'v')
    out.retKey = localStorage.setItem(k, '{"note":"n"}')
    out.getPlain = localStorage.getItem('plain'); out.getMissing = localStorage.getItem('missing'); out.len = localStorage.length
    try { localStorage.setItem('boom', '1'); out.boom = 'no throw' } catch (e) { out.boom = e.name }
    try { localStorage.setItem(k, JSON.stringify({ note: 'QUOTA ' + 'Location: https://www.google.com/maps?q=29.375912,47.977446' })); out.quota = 'no throw' } catch (e) { out.quota = e.name }
    out.after = window.__nativeGet(localStorage, k)
    try { localStorage.setItem(k) } catch (e) { out.argc = e.name }
    out.fn = [Storage.prototype.setItem.length, Storage.prototype.getItem.length]
    return out
  }, KEY)
  is(r.ret === undefined && r.retKey === undefined, 'N19 setItem returns undefined, as before')
  is(r.getPlain === 'v' && r.getMissing === null && r.len === 2, 'N20 getItem returns the value / null as before; length is right', JSON.stringify(r))
  is(r.boom === 'QuotaExceededError', 'N21 an exception from the native layer (quota) reaches the caller unchanged, for an unrelated key', r.boom)
  is(r.quota === 'QuotaExceededError' && r.after === '{"note":"n"}', 'N22 and for the saved-details key: it throws too, and the earlier stored value is untouched', r.quota + ' / ' + r.after)
  is(r.argc === 'TypeError', 'N23 setItem with a missing argument still throws TypeError (arguments forwarded as given)', r.argc)
  is(r.fn[0] <= 2 && r.fn[1] <= 1, 'N24 the wrappers do not claim extra parameters', r.fn.join())
  await done(s)
}
{
  // N25: installed once, however often the file is evaluated
  const s = await open({ lang: 'en' })
  const { pg } = s
  const f1 = await pg.evaluate(() => { window.__f = Storage.prototype.setItem; window.__g = Storage.prototype.getItem; return !!Storage.prototype.setItem.__sportaLoc && !!Storage.prototype.getItem.__sportaLoc })
  is(f1, 'N25 the wrappers are installed (marked)')
  await pg.addScriptTag({ content: ADDON }); await pg.addScriptTag({ content: ADDON }); await sleep(300)
  is(await pg.evaluate(() => window.__f === Storage.prototype.setItem && window.__g === Storage.prototype.getItem), 'N26 evaluating the file again does not wrap again (same function objects)')
  await pg.evaluate(([k]) => { window.__sets.length = 0; localStorage.setItem(k, JSON.stringify({ note: 'q Location: https://www.google.com/maps?q=1.000000,2.000000' })) }, [KEY])
  const sv = await sets(pg)
  is(sv.length === 1 && JSON.parse(sv[0][2]).note === 'q', 'N27 after three evaluations one setItem still reaches the native layer exactly once, cleaned', JSON.stringify(sv))
  await done(s)
}
{
  // N28/N29: reads and SPA navigation
  const s = await open({ lang: 'en' })
  const { pg } = s
  const dirty = JSON.stringify(withNote('Gate 3 ' + LINE_EN))
  await pg.evaluate(([k, v]) => window.__nativeSet(localStorage, k, v), [KEY, dirty])   // behind the wrapper's back (another tab, an older script)
  is((await pg.evaluate((k) => localStorage.getItem(k), KEY)) === JSON.stringify(withNote('Gate 3')), 'N28 getItem never hands the app a stored pin (the app reads the cleaned value)')
  await pg.evaluate(() => window.__go('/shop')); await settle()
  await pg.evaluate(([k, v]) => window.__nativeSet(localStorage, k, v), [KEY, dirty])
  await pg.evaluate(() => window.__go('/checkout')); await settle()
  is((await stored(pg)) === JSON.stringify(withNote('Gate 3')), 'N29 navigating (SPA) to /checkout re-scrubs a value that was stored meanwhile')
  await pg.evaluate(() => window.__go('/shop')); await settle()
  await pg.evaluate(([k, v]) => window.__nativeSet(localStorage, k, v), [KEY, dirty]); await sleep(400)
  is((await stored(pg)) === dirty, 'N30 off /checkout nothing is rewritten in the background (the pass runs on /checkout only; the getItem filter covers reads)')
  await done(s)
}
{
  // N31: a rewrite happens only when something changed (no write storm)
  const s = await open({ lang: 'en', saved: withNote('Gate 3') })
  await s.pg.evaluate(() => window.__sets.length = 0)
  await s.pg.evaluate(() => { window.__go('/shop'); window.__go('/checkout') }); await sleep(900)
  is((await sets(s.pg)).length === 0, 'N31 a clean profile is never rewritten by the add-on')
  await done(s)
}

})
await section('O  the review findings: double evaluation, watchdog, retry, bad coordinates, wording', async () => {
{
  const idle = async (s) => s.pg.evaluate(() => new Promise((res) => { let n = 0; const o = new MutationObserver((l) => { n += l.length }); o.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { o.disconnect(); res(n) }, 3000) }))
  const one = await open({ lang: 'en' })
  const two = await open({ lang: 'en' })
  await two.pg.addScriptTag({ content: ADDON }); await two.pg.addScriptTag({ content: ADDON }); await sleep(400)
  const a = await idle(one), b = await idle(two)
  is(a <= 2 && b <= a + 1, 'O1 evaluating the file twice more: mutations over 3 s are like ONE instance (' + b + ' vs ' + a + '), not a ping-pong')
  is((await count(two.pg)) === 1 && (await two.pg.evaluate(() => document.documentElement.getAttribute('data-sporta-loc-js'))) === '1', 'O2 one control, one marker on <html>')
  await tap(two.pg)
  is((await calls(two.pg)) === 1 && (await note(two.pg)) === LINE_EN, 'O3 and one tap makes one lookup and one line (two live instances would answer twice)')
  await done(one); await done(two)
}
{
  // watchdog: the real value is 25000; the harness shortens exactly that delay to 300 ms
  const s = await open({ lang: 'en', mode: 'hang', fastDog: true, note: 'Gate 3' })
  const { pg } = s
  await pg.click('#sporta-loc-btn')
  is(await pg.$eval('#sporta-loc-btn', (e) => e.disabled), 'O4 a lookup that never answers shows "Finding your location"')
  await pg.waitForFunction(() => !document.getElementById('sporta-loc-btn').disabled, null, { timeout: 4000 })
  is(/Could not get your location/.test(await status(pg)) && (await act(pg)) === 'share' && (await note(pg)) === 'Gate 3', 'O5 the watchdog ends it as a failure: the failure sentence, the control usable, the note untouched', await status(pg))
  is((await pg.evaluate(() => window.__timeouts.filter((x) => x === 25000).length)) === 1, 'O6 the watchdog asks for exactly 25 s (25000 ms), once')
  await done(s)
}
{
  const s = await open({ lang: 'en', mode: 'late', fastDog: true, note: 'Gate 3' })
  const { pg } = s
  await pg.click('#sporta-loc-btn')
  await pg.waitForFunction(() => !document.getElementById('sporta-loc-btn').disabled, null, { timeout: 4000 })
  await sleep(1700)   // the late answer (1.6 s) arrives after the watchdog gave up
  is((await note(pg)) === 'Gate 3' && /Could not get your location/.test(await status(pg)), 'O7 an answer that arrives after the watchdog fired is ignored (no line appears behind the failure message)', await note(pg))
  await done(s)
}
{
  const s = await open({ lang: 'en', mode: 'timeout-once' })
  const { pg } = s
  await tap(pg)
  const o = await pg.evaluate(() => window.__geoOpts)
  is((await calls(pg)) === 2 && o[0].enableHighAccuracy === true && o[1].enableHighAccuracy === false, 'O8 error code 3 (timeout): retried ONCE with enableHighAccuracy:false', JSON.stringify(o))
  is((await note(pg)) === LINE_EN.replace('29.375912,47.977446', '29.375912,47.977446') && /about 25 m/.test(await status(pg)), 'O9 and the retry\'s position is used', await note(pg))
  await done(s)
  const t = await open({ lang: 'en', mode: 'timeout', note: 'Gate 3' })
  await tap(t.pg)
  is((await calls(t.pg)) === 2 && /Could not get your location/.test(await status(t.pg)) && (await note(t.pg)) === 'Gate 3', 'O10 two timeouts in a row: exactly 2 calls (not a loop), then the failure sentence', 'calls=' + (await calls(t.pg)))
  await done(t)
  for (const [mode, opts] of [['unavailable', {}], ['denied', { grant: false }], ['throw', { mode: 'throw' }]]) {
    const u = await open({ lang: 'en', mode: mode === 'denied' ? 'real' : mode, ...opts })
    await tap(u.pg)
    is((await calls(u.pg)) === 1, `O11 ${mode}: no retry (only a timeout is retried)`, 'calls=' + (await calls(u.pg)))
    await done(u)
  }
}
{
  const cases = [['0,0', { mode: 'real', geo: { latitude: 0, longitude: 0, accuracy: 10 } }], ['null coords', { mode: 'nullcoords' }], ['NaN', { mode: 'nan' }], ['lat 91', { mode: 'range' }], ['lng 181', { mode: 'lng' }], ['text', { mode: 'str' }]]
  for (const [name, opts] of cases) for (const lang of ['en', 'ar']) {
    const s = await open({ lang, note: 'Gate 3', ...opts })
    await tap(s.pg)
    const st = await status(s.pg)
    is((lang === 'en' ? /Could not get your location\. Your order is not affected\./ : /تعذّر تحديد موقعك/).test(st) && (await note(s.pg)) === 'Gate 3' && (await stateNote(s.pg)) === 'Gate 3', `O12 ${name} (${lang}): refused with "could not get your location", the note untouched`, st)
    await done(s)
  }
  const ok1 = await open({ lang: 'en', geo: { latitude: 0, longitude: 47.9, accuracy: 10 } })
  await tap(ok1.pg)
  is((await note(ok1.pg)) === 'Location: https://www.google.com/maps?q=0.000000,47.900000', 'O13 a real position ON the equator (lat 0, lng 47.9) is accepted: only exactly 0,0 is refused', await note(ok1.pg))
  await done(ok1)
}
{
  // wording, both languages, and the Arabic rules (tanwin written ـًا, Arabic punctuation, no Latin ,?; between Arabic words)
  const en = await open({ lang: 'en' }), ar = await open({ lang: 'ar' })
  is((await hint(en.pg)) === HINT_EN && /shop and the delivery team/.test(HINT_EN) && !/Sent only with this order/.test(HINT_EN), 'O14 English helper: where the location goes (note, shop and delivery team)', await hint(en.pg))
  is((await hint(ar.pg)) === HINT_AR, 'O15 Arabic helper is the agreed sentence', await hint(ar.pg))
  for (const [label, v] of [['hint', HINT_AR], ['in-note', OLD_AR]]) {
    is(!/[؀-ۿ]\s*[,?;]\s*[؀-ۿ]/.test(v) && !/[؀-ۿ]اً|[؀-ۿ]ةً/.test(v) && !/[0-9]/.test(v) && /[؀-ۿ]/.test(v) && !/[A-Za-z]/.test(v), `O16 Arabic ${label} follows the project rules: no Latin ,?; between Arabic words, tanwin form, no Latin letters or Western digits`)
  }
  is(!/،\s*[،.]/.test(HINT_AR) && HINT_AR.includes('.'), 'O17 Arabic helper: sentences end with a full stop; no Arabic comma is needed or stranded')
  const v = await ar.pg.$eval('#sporta-loc-hint', (e) => ({ dir: getComputedStyle(e).direction, text: e.textContent }))
  is(v.dir === 'rtl', 'O18 and it renders right-to-left')
  await done(en); await done(ar)
}

})
await section('P  repo source: src/lib/delivery.js strips the same line', async () => {
{
  const src = readFileSync(join(ROOT, 'src/lib/delivery.js'), 'utf8')
  const body = src.replace(/^import .*$/m, '').replace(/\bexport (const|function)\b/g, '$1')
  const store = {}
  const fake = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
  const lib = new Function('governorate', 'normalisePhone', 'localStorage', body + '\nreturn { BLANK, LOCATION_LINE_SRC, LOCATION_MAPS, stripLocation, persistableDelivery, saveDelivery, loadDelivery }')(() => null, () => null, fake)
  const jsSrc = readFileSync(join(ROOT, 'public/sporta-gov-autopick.js'), 'utf8')
  const addonSrc = (jsSrc.match(/var LINE_SRC = '(.*)';/) || [])[1]
  is(addonSrc === lib.LOCATION_LINE_SRC.replace(/\\/g, '\\\\').replace(/\\\\\\\\/g, '\\\\') || addonSrc === lib.LOCATION_LINE_SRC, 'P1 the add-on and delivery.js hold the SAME pattern text', addonSrc + ' vs ' + lib.LOCATION_LINE_SRC)
  const L = 'Location: ' + LINK, A = 'الموقع: ' + LINK
  const corpus = [['', ''], ['Gate 3', 'Gate 3'], [L, ''], [A, ''], ['Gate 3 ' + L, 'Gate 3'], ['Gate 3 ' + A, 'Gate 3'], [L + ' then more', 'then more'], ['x ' + L + ' y ' + A, 'x y'], ['Gate 3 ' + L + ' call me', 'Gate 3 call me'], ['no pin: https://www.google.com/maps?q=abc', 'no pin: https://www.google.com/maps?q=abc'], ['Location: https://www.google.com/maps?q=29.3,47.9', 'Location: https://www.google.com/maps?q=29.3,47.9'], ['a  ' + L, 'a '], ['Location: https://www.google.com/maps?q=-29.375912,-47.977446', '']]
  for (const [i, [inp, out]] of corpus.entries()) is(lib.stripLocation(inp) === out, `P2.${i} stripLocation(${JSON.stringify(inp.slice(0, 30))}) = ${JSON.stringify(out.slice(0, 30))}`, JSON.stringify(lib.stripLocation(inp)))
  const form = { ...lib.BLANK, name: 'Sara Ali', phone: '55512345', area: 'Salmiya', note: 'Gate 3 ' + L }
  const pf = lib.persistableDelivery(form)
  is(pf.note === 'Gate 3' && form.note === 'Gate 3 ' + L && pf.name === 'Sara Ali', 'P3 persistableDelivery returns a copy with the line out and does not mutate the form (the page keeps its note)')
  const clean = { ...lib.BLANK, note: 'Gate 3' }
  is(lib.persistableDelivery(clean) === clean && lib.persistableDelivery(null) === null && lib.persistableDelivery({ note: 5 }).note === 5, 'P4 a clean form (or no form / no string note) comes back as the same object')
  lib.saveDelivery(form, true)
  is(JSON.parse(store['sporta.delivery']).note === 'Gate 3' && JSON.parse(store['sporta.delivery']).name === 'Sara Ali' && store['sporta.delivery.remember'] === '1' && !/maps/.test(store['sporta.delivery']), 'P5 saveDelivery stores the form without the line (other fields intact), remember flag set')
  lib.saveDelivery(form, false)
  is(!('sporta.delivery' in store) && store['sporta.delivery.remember'] === '0', 'P6 saveDelivery(remember=false) removes the details as before')
  store['sporta.delivery'] = JSON.stringify({ ...form, note: 'Old ' + A })
  is(lib.loadDelivery().note === 'Old' && lib.loadDelivery().area === 'Salmiya', 'P7 loadDelivery drops a line an older visit left behind (belt and braces)')
  store['sporta.delivery'] = '{broken'
  is(JSON.stringify(lib.loadDelivery()) === JSON.stringify(lib.BLANK), 'P8 unreadable storage still loads the blank form')
  // the same corpus through the add-on in a browser (Remove = strip)
  for (const [i, [inp]] of corpus.entries()) {
    if (!/maps\?q=-?\d/.test(inp) || !inp) continue
    const s = await open({ lang: 'en', note: inp })
    await s.pg.click('#sporta-loc-btn'); await sleep(80)
    const got = await note(s.pg)
    is(got === lib.stripLocation(inp), `P9.${i} add-on Remove and delivery.js stripLocation agree on ${JSON.stringify(inp.slice(0, 34))}`, JSON.stringify(got))
    await done(s)
  }
}

})

console.log(`\n${pass} ok, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
