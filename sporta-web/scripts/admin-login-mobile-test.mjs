// The /backends sign-in screens: full mobile and light (owner, 2026-11-12: "make login backends full mobile, make it light").
//
//   npm run test:admin-login-mobile      (rig-free: postcss + real Tailwind + Chromium; no database, no server, no sandbox)
//
// What is under test: the LOGINLIGHT section of addons-src/sporta-admin-knet.css (through the repo's own slim build, i.e. the file
// that ships) and the ADMIN LOGIN KEYBOARD block of public/sporta-admin-brands.js, on the LIVE markup of every signed-out screen
// (scripts/fixtures/admin-login/markup.mjs: sign-in, code, code with an error, recovery code, forgot password, forced change),
// under the live chunk's own .admin-login rules (fixtures/admin-login/live.css), the live build's real dark rules
// (fixtures/admin-dark-rules.css: the storefront sheet BEFORE the add-ons, the admin chunk AFTER them, as the page orders them)
// and every add-on stylesheet the live index.html links, in its order.
//
//   1. LIGHT ONLY   five html/device states (light; dark class + data-theme on a dark device; the same on a light device = a
//                   stored choice; data-theme only = the first paint; a stored LIGHT choice on a dark device, which today fires the
//                   build's dark: utilities): every element's computed colours, backgrounds, borders, shadows, outline, caret and
//                   placeholder are IDENTICAL to the light state, at rest and in hover / focus states, at 390 and 1280px;
//                   text contrast >= 4.5:1 (3:1 for large text) in the light state.
//   2. LIGHT WEIGHT the page is one flat colour (no gradient), the card has one small shadow, fields have none, no transform and no
//                   transition on fields and buttons.
//   3. FULL MOBILE  320x568, 360x740, 390x844, 430x932 and sideways 568x320, 844x390, 932x430: no sideways scroll, the screen IS
//                   the page (full width, at least the screen's height, no frame), the content column centred and at most 30rem,
//                   inputs 16px or larger (no iOS focus zoom), every target 44px or larger, the right input types and
//                   autocomplete tokens, the safe areas on all four sides, the same in a right-to-left root; the desktop card keeps
//                   its split layout at 1280.
//   4. KEYBOARD     a fake visualViewport (Chromium cannot open an on-screen keyboard) shrinks by a phone keyboard's height while a
//                   field has focus: the submit button ends above the keyboard and the field stays in view; closing it removes the
//                   padding; missing attributes are filled in and existing ones left alone; no page error.
//   5. MUTATION     the same checks with the LOGINLIGHT section cut out of the source, and with the keyboard block cut out of the
//                   script, must FAIL (each run prints how many checks failed; the suite fails if a mutant survives).
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generated } from './build-addon-css.mjs'
import { STATES } from './fixtures/admin-login/markup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'addons-src/sporta-admin-knet.css'), 'utf8')
const SEC_A = '/* ==== LOGINLIGHT:', SEC_B = '/* ==== SIZES:'
const JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const JS_A = '/* ===== ADMIN LOGIN KEYBOARD - begin', JS_B = '/* ===== ADMIN LOGIN KEYBOARD - end ======================================= */'
const LIVE_LOGIN = readFileSync(join(ROOT, 'scripts/fixtures/admin-login/live.css'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const cutAt = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), cutAt), DARK_ADMIN = DARK.slice(cutAt)
// The add-on stylesheets the live index.html links, in the live order (measured 2026-11-12); admin-knet is the one under test.
const ADDONS = ['sporta-product-fix', 'sporta-brand-theme', 'sporta-home-trim', 'sporta-cart-drawer', 'sporta-grid', 'sporta-bag-touch', 'sporta-cat-tiles', 'sporta-admin-knet', 'sporta-returns-touch', 'sporta-clock', 'sporta-ui-colours', 'sporta-checkout-a11y', 'sporta-shadows', 'sporta-images']
const addonCss = (knet) => ADDONS.map((n) => n === 'sporta-admin-knet' ? knet : readFileSync(join(ROOT, 'public', n + '.css'), 'utf8')).join('\n')
// The storefront sheet's base the login reads (fonts and the brand variables; the real values come from sporta-brand-theme.css).
const BASE = ':root{--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b}html{font-size:clamp(16px,15.5px + .104vw,17px);font-family:system-ui,sans-serif}body{margin:0}'

const sectionCut = (src) => { const a = src.indexOf(SEC_A), b = src.indexOf(SEC_B); return a < 0 || b < a ? src : src.slice(0, a) + src.slice(b) }
const ON = generated('sporta-admin-knet', SRC)
const OFF = generated('sporta-admin-knet', sectionCut(SRC))
const JS_OFF = JS.indexOf(JS_A) < 0 ? JS : JS.slice(0, JS.indexOf(JS_A)) + JS.slice(JS.indexOf(JS_B) + JS_B.length)

const classes = [...new Set(Object.values(STATES).flatMap((h) => [...h.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'admin-login-fixture.css') })).css

let pass = 0, fail = 0, quiet = false, mfail = 0
const fails = []
const is = (ok, msg, d = '') => { if (ok) { pass++; if (!quiet) console.log('ok   ' + msg) } else { fail++; mfail++; fails.push(msg); if (!quiet) console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }

const NO_MOTION = '*,*::before,*::after{animation:none!important}'
const ORIGIN = 'https://admin.test'
const pageHtml = (knet, body, attrs, withJs) => `<!doctype html><html lang="ar" dir="rtl" ${attrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${TW}</style><style>${BASE}</style><style>${DARK_INDEX}</style><style>${addonCss(knet)}</style><style>${LIVE_LOGIN}</style><style>${DARK_ADMIN}</style><style>${NO_MOTION}</style></head><body><div id="root">${body}</div>${withJs ? '<script src="/sporta-admin-brands.js"></script>' : ''}</body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
async function open({ knet = ON, state = 'login', attrs = '', device = 'light', w = 390, h = 844, js = null, init = null, mobile = true }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: device, isMobile: mobile && w < 1024, hasTouch: mobile && w < 1024 })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  if (init) await pg.addInitScript(init)
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/backends') return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(knet, STATES[state], attrs, js !== null) })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: js || '' })
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    return route.fulfill({ status: 204, body: '' })
  })
  await pg.goto(ORIGIN + '/backends')
  await pg.waitForTimeout(50)
  return { ctx, pg, errs }
}

// ------------------------------------------------------------------------------------------------ 1. light only
const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'outlineColor', 'outlineStyle', 'caretColor', 'textDecorationColor', 'colorScheme', 'opacity']
const SCENARIOS = [
  { name: 'dark class + data-theme, dark device', device: 'dark', attrs: 'class="dark" data-theme="dark"' },
  { name: 'stored dark on a light device', device: 'light', attrs: 'class="dark" data-theme="dark"' },
  { name: 'first paint (data-theme only), dark device', device: 'dark', attrs: 'data-theme="dark"' },
  { name: 'stored LIGHT on a dark device (the dark: utilities)', device: 'dark', attrs: 'data-theme="light"' },
]
async function snapshot(o) {
  const { ctx, pg } = await open(o)
  const read = async () => pg.evaluate((props) => {
    const out = []
    for (const e of [document.querySelector('.admin-login'), ...document.querySelectorAll('.admin-login *')]) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none') continue
      const r = {}
      for (const k of props) r[k] = cs[k]
      if (e.tagName === 'INPUT') r.placeholder = getComputedStyle(e, '::placeholder').color
      if (e.tagName === 'LI') r.before = getComputedStyle(e, '::before').color
      out.push([e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.') + ' "' + (e.textContent || '').trim().slice(0, 18) + '"', r])
    }
    return out
  }, PROPS)
  const res = { rest: await read(), states: {} }
  // states: hover and keyboard focus on each field and each button (the submit enabled, as it is once the form is filled)
  await pg.evaluate(() => document.querySelectorAll('.admin-login button[disabled]').forEach((b) => b.removeAttribute('disabled')))
  const targets = await pg.evaluate(() => [...document.querySelectorAll('.admin-login input, .admin-login button')].map((e, i) => { e.setAttribute('data-t', i); return i }))
  for (const i of targets) {
    const loc = pg.locator(`[data-t="${i}"]`)
    const pick = () => loc.evaluate((e, props) => { const cs = getComputedStyle(e); const r = {}; for (const k of props) r[k] = cs[k]; return r }, PROPS)
    await loc.hover({ force: true }).catch(() => {}); const hov = await pick(); await pg.mouse.move(0, 0)
    await pg.keyboard.press('Shift'); await loc.focus(); const foc = await pick(); await loc.evaluate((e) => e.blur())
    res.states[i] = { hov, foc }
  }
  await ctx.close()
  return res
}
const diff = (a, b) => {
  const out = []
  if (a.rest.length !== b.rest.length) out.push(`element count ${a.rest.length} vs ${b.rest.length}`)
  for (let i = 0; i < Math.min(a.rest.length, b.rest.length); i++) for (const k of Object.keys(a.rest[i][1])) if (a.rest[i][1][k] !== b.rest[i][1][k]) out.push(`${a.rest[i][0]} ${k}: ${a.rest[i][1][k]} -> ${b.rest[i][1][k]}`)
  for (const i of Object.keys(a.states)) for (const s of ['hov', 'foc']) for (const k of PROPS) if (a.states[i][s][k] !== b.states[i]?.[s]?.[k]) out.push(`target ${i} ${s} ${k}: ${a.states[i][s][k]} -> ${b.states[i]?.[s]?.[k]}`)
  return out
}
async function lightOnly(knet) {
  head('1. light only')
  for (const w of [390, 1280]) for (const state of Object.keys(STATES)) {
    const ref = await snapshot({ knet, state, w, h: w < 1024 ? 844 : 860 })
    for (const sc of SCENARIOS) {
      const got = await snapshot({ knet, state, w, h: w < 1024 ? 844 : 860, attrs: sc.attrs, device: sc.device })
      const d = diff(ref, got)
      is(d.length === 0, `${state} @${w}: ${sc.name} = light (${ref.rest.length} elements, ${Object.keys(ref.states).length} controls x hover/focus)`, `${d.length} differences: ${d.slice(0, 3).join(' | ')}`)
    }
  }
  // contrast of every text in the light state (canvas-resolved colours, so oklch() is handled)
  for (const state of Object.keys(STATES)) {
    const { ctx, pg } = await open({ knet, state, attrs: 'class="dark" data-theme="dark"', device: 'dark' })
    const low = await pg.evaluate(() => {
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
      const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0.5) return c } return [255, 255, 255, 1] }
      const bad = []
      for (const e of document.querySelectorAll('.admin-login *')) {
        if (e.closest('.admin-login__brand-panel')) continue   // the dark brand panel is the build's (desktop only)
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        if (!own) continue
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const fg = rgba(cs.color), bg = bgOf(e)
        const a = fg[3], mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
        const l1 = L(mix), l2 = L(bg), cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
        const op = Number(cs.opacity) < 1 || e.closest('button[disabled]')
        if (!op && cr < (big ? 3 : 4.5)) bad.push(`${e.tagName} "${e.textContent.trim().slice(0, 20)}" ${cr.toFixed(2)}`)
      }
      return bad
    })
    is(low.length === 0, `${state}: every text >= 4.5:1 (3:1 large) in a dark theme state`, low.slice(0, 3).join(' | '))
    await ctx.close()
  }
}

// ------------------------------------------------------------------------------------------------ 2. light weight
async function lightWeight(knet) {
  head('2. light weight')
  for (const [w, h] of [[390, 844], [1280, 860]]) {
    const { ctx, pg } = await open({ knet, state: 'login', w, h })
    const m = await pg.evaluate(() => {
      const root = getComputedStyle(document.querySelector('.admin-login')), shell = getComputedStyle(document.querySelector('.admin-login__shell'))
      const blur = (s) => s === 'none' ? 0 : Math.max(...[...s.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)].map((x) => Number(x[3])))
      const ctl = [...document.querySelectorAll('.admin-login :is(input, button):not(.admin-login__reveal)')].map((e) => getComputedStyle(e))   // the reveal's translateY(-50%) places it, it is not an effect
      return { img: root.backgroundImage, shellShadow: shell.boxShadow, shellBlur: blur(shell.boxShadow), layers: shell.boxShadow === 'none' ? 0 : shell.boxShadow.split(/,(?![^(]*\))/).length,
        fieldShadow: [...document.querySelectorAll('.admin-login__input')].map((e) => getComputedStyle(e).boxShadow),
        trans: ctl.filter((c) => parseFloat(c.transitionDuration) > 0).length, xf: ctl.filter((c) => c.transform !== 'none').length }
    })
    is(m.img === 'none', `@${w}: the page is one flat colour (no gradient)`, m.img.slice(0, 60))
    is(m.layers <= 1 && m.shellBlur <= 12, `@${w}: the card has at most one small shadow (blur <= 12px)`, m.shellShadow)
    is(m.fieldShadow.every((s) => s === 'none'), `@${w}: fields carry no shadow at rest`, m.fieldShadow.join(' | '))
    is(m.trans === 0 && m.xf === 0, `@${w}: no transition and no transform on fields and buttons (the Show button's centring aside)`, `${m.trans} with a transition, ${m.xf} with a transform`)
    await ctx.close()
  }
}

// ------------------------------------------------------------------------------------------------ 3. full mobile
const PHONES = [[320, 568], [360, 740], [390, 844], [430, 932], [568, 320], [844, 390], [932, 430]]
const TOKENS = { 'admin-email': ['email', 'username'], 'admin-password': ['password', 'current-password'], 'admin-reset-email': ['email', 'email'], 'admin-first-password': ['password', 'new-password'], 'admin-first-confirm': ['password', 'new-password'] }
async function fullMobile(knet) {
  head('3. full mobile')
  for (const [w, h] of PHONES) for (const state of Object.keys(STATES)) for (const rtl of [false, true]) {
    const { ctx, pg } = await open({ knet, state, w, h, attrs: rtl ? '' : '' })
    if (rtl) await pg.evaluate(() => document.querySelector('.admin-login').setAttribute('dir', 'rtl'))
    const m = await pg.evaluate(() => {
      const R = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }
      const shell = R('.admin-login__shell'), scs = getComputedStyle(document.querySelector('.admin-login__shell'))
      const panelEl = document.querySelector('.admin-login__form-panel'), pcs = getComputedStyle(panelEl), panel = R('.admin-login__form-panel')
      const ctl = [...document.querySelectorAll('.admin-login :is(input, button, a)')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 16), w: r.width, h: r.height, fs: parseFloat(getComputedStyle(e).fontSize), tag: e.tagName } })
      const content = [...panelEl.querySelectorAll(':scope > *, form')].map((e) => e.getBoundingClientRect()).filter((r) => r.width)
      const cl = Math.min(...content.map((r) => r.left)), cr = Math.max(...content.map((r) => r.right))
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const last = [...panelEl.querySelectorAll('*')].reduce((b, e) => Math.max(b, e.getBoundingClientRect().bottom), 0)
      return { rem, last, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, shell, radius: parseFloat(scs.borderTopLeftRadius), border: parseFloat(scs.borderTopWidth), shadow: scs.boxShadow, panel, pad: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => parseFloat(pcs[k])), ctl, cl, cr,
        inputs: [...document.querySelectorAll('.admin-login input')].map((e) => [e.id, e.type, e.getAttribute('autocomplete'), e.getAttribute('inputmode')]) }
    })
    const tag = `${state} ${w}x${h}${rtl ? ' rtl' : ''}`
    is(m.sw <= m.vw, `${tag}: no sideways scroll`, `${m.sw} > ${m.vw}`)
    is(Math.abs(m.shell.w - m.vw) < 1 && m.shell.h >= m.vh - 1 && m.radius === 0 && m.border === 0 && m.shadow === 'none', `${tag}: the screen is the page (full width, full height, no frame)`, `shell ${Math.round(m.shell.w)}x${Math.round(m.shell.h)} r${m.radius} b${m.border}`)
    is(m.panel.w <= 30 * m.rem + 1 && Math.abs((m.panel.l) - (m.vw - m.panel.r)) <= 1, `${tag}: one centred column, at most 30rem`, `panel ${Math.round(m.panel.l)}..${Math.round(m.panel.r)}`)
    is(m.pad.every((p) => p >= 19.5), `${tag}: content padded on all four sides (>= 1.25rem, more where the safe area is larger)`, m.pad.join(','))
    is(m.cl >= m.panel.l + 19 && m.cr <= m.panel.r - 19, `${tag}: the content stays inside the padding`, `${Math.round(m.cl)}..${Math.round(m.cr)}`)
    const small = m.ctl.filter((c) => c.h < 44 || c.w < 44)
    is(!small.length, `${tag}: every target is 44px or larger (${m.ctl.length})`, small.map((c) => `${c.id} ${Math.round(c.w)}x${Math.round(c.h)}`).join(' | '))
    const zoom = m.ctl.filter((c) => c.tag === 'INPUT' && c.fs < 16)
    is(!zoom.length, `${tag}: every field is 16px or larger (no focus zoom on iOS)`, zoom.map((c) => `${c.id} ${c.fs}px`).join(' | '))
    if (!rtl && w === 390) {
      const wrong = m.inputs.filter(([id, type, ac, im]) => id === 'admin-auth-code' ? !(type === 'text' && (state === 'recovery' ? ac === 'off' : ac === 'one-time-code' && im === 'numeric')) : TOKENS[id] && !(TOKENS[id][0] === type && TOKENS[id][1] === ac))
      is(!wrong.length, `${state}: input types and autocomplete tokens (email/username, current-password, one-time-code + numeric, new-password)`, JSON.stringify(wrong))
    }
    if (!rtl && w === 390 && h === 844 && ['login', 'code', 'recovery', 'forgot'].includes(state)) is(m.sh <= m.vh, `${tag}: fits the screen, nothing to scroll`, `${m.sh}px`)
    // taller than the screen only by the content itself: no 600px minimum, no empty band under the last control
    is(m.sh <= m.vh || m.panel.b - m.last <= m.pad[2] + 1, `${tag}: no empty band under the content (page ${m.sh}px for a ${m.vh}px screen)`, `${Math.round(m.panel.b - m.last)}px under the last control`)
    if (!rtl && w === 844 && state === 'login') is(m.sh < 709, `${tag}: a phone held sideways scrolls less than the live 709px`, `${m.sh}px`)
    if (!rtl && w === 320 && state === 'login') is(m.sh < 660, `${tag}: a 320x568 phone scrolls less than the live 660px`, `${m.sh}px`)
    await ctx.close()
  }
  // the safe areas: Chromium cannot emulate a notch, so the rule itself is read
  const sec = SRC.slice(SRC.indexOf(SEC_A), SRC.indexOf(SEC_B))
  is(['top', 'right', 'bottom', 'left'].every((s) => sec.includes(`env(safe-area-inset-${s})`)), 'the phone padding reads all four safe-area insets (the live viewport meta has viewport-fit=cover)')
  // desktop keeps its card
  const { ctx, pg } = await open({ knet, state: 'login', w: 1280, h: 860, mobile: false })
  const d = await pg.evaluate(() => { const s = document.querySelector('.admin-login__shell'), r = s.getBoundingClientRect(), b = document.querySelector('.admin-login__brand-panel'); return { w: r.width, cols: getComputedStyle(s).gridTemplateColumns.split(' ').length, radius: parseFloat(getComputedStyle(s).borderTopLeftRadius), brand: getComputedStyle(b).display, sh: document.documentElement.scrollHeight } })
  is(d.cols === 2 && d.brand === 'flex' && d.radius > 0 && d.w > 1000 && d.sh <= 860, '1280x860: the desktop card keeps its split layout, brand panel and corners, and fits', JSON.stringify(d))
  await ctx.close()
}

// ------------------------------------------------------------------------------------------------ 4. keyboard
const FAKE_VV = () => {
  const vv = new EventTarget()
  vv.width = innerWidth; vv.height = innerHeight; vv.offsetTop = 0; vv.offsetLeft = 0; vv.pageTop = 0; vv.scale = 1
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true })
  window.__vv = vv
}
async function keyboard(js) {
  head('4. keyboard')
  for (const [state, field, w, h, kb] of [['login', '#admin-password', 390, 844, 336], ['login', '#admin-email', 320, 568, 260], ['code', '#admin-auth-code', 390, 844, 336], ['forgot', '#admin-reset-email', 360, 740, 300], ['change', '#admin-first-confirm', 390, 844, 336], ['login', '#admin-password', 844, 390, 180]]) {
    const { ctx, pg, errs } = await open({ knet: ON, state, w, h, js, init: FAKE_VV })
    await pg.waitForTimeout(30)
    await pg.focus(field)
    await pg.evaluate((kb) => { window.__vv.height = innerHeight - kb; window.__vv.dispatchEvent(new Event('resize')) }, kb)
    await pg.waitForTimeout(420)
    const m = await pg.evaluate(() => {
      const f = document.activeElement, form = f.closest('form')
      const btn = [...form.querySelectorAll('button')].find((b) => (b.getAttribute('type') || 'submit') === 'submit')
      return { visible: window.__vv.offsetTop + window.__vv.height, btn: btn.getBoundingClientRect().bottom, fieldTop: f.getBoundingClientRect().top, kb: document.querySelector('.admin-login').style.getPropertyValue('--sporta-login-kb'), y: scrollY }
    })
    const tag = `${state} ${w}x${h}, ${kb}px keyboard, ${field}`
    is(m.kb === kb + 'px', `${tag}: the keyboard height is handed to the CSS`, m.kb || '(none)')
    is(m.btn <= m.visible - 8, `${tag}: the submit button ends above the keyboard`, `button bottom ${Math.round(m.btn)}, keyboard top ${m.visible} (scrolled ${m.y})`)
    is(m.fieldTop >= 0, `${tag}: the focused field stays in view`, `field top ${Math.round(m.fieldTop)}`)
    await pg.evaluate(() => { window.__vv.height = innerHeight; window.__vv.dispatchEvent(new Event('resize')); document.activeElement.blur() })
    await pg.waitForTimeout(420)
    is(await pg.evaluate(() => document.querySelector('.admin-login').style.getPropertyValue('--sporta-login-kb')) === '', `${tag}: closing the keyboard removes the padding`)
    is(!errs.length, `${tag}: no page error`, errs.join(' | ').slice(0, 160))
    await ctx.close()
  }
  // attributes: filled in where missing, never changed
  for (const state of ['code', 'recovery', 'change', 'login']) {
    const { ctx, pg } = await open({ knet: ON, state, js, init: FAKE_VV })
    const first = await pg.evaluate(() => document.querySelector('.admin-login input').id)
    await pg.focus('#' + first)
    await pg.waitForTimeout(30)
    const a = await pg.evaluate(() => [...document.querySelectorAll('.admin-login input')].map((e) => ({ id: e.id, ac: e.getAttribute('autocomplete'), cap: e.getAttribute('autocapitalize'), cor: e.getAttribute('autocorrect'), sp: e.getAttribute('spellcheck'), ek: e.getAttribute('enterkeyhint') })))
    const pw = a.filter((x) => x.id !== 'admin-email' && x.id !== 'admin-reset-email')
    is(pw.every((x) => x.cap === 'none' && x.cor === 'off' && x.sp === 'false'), `${state}: code and password fields carry autocapitalize=none, autocorrect=off, spellcheck=false`, JSON.stringify(pw))
    if (state === 'code' || state === 'recovery') is(a[0].ek === 'done' && a[0].ac === (state === 'code' ? 'one-time-code' : 'off'), `${state}: the code field gets enterkeyhint=done and keeps its own autocomplete`, JSON.stringify(a[0]))
    if (state === 'login') is(a[1].ek === 'go' && a[0].ek === 'next', 'login: the build\'s own enterkeyhint values are left alone', JSON.stringify(a))
    await ctx.close()
  }
}

// ------------------------------------------------------------------------------------------------ run
const static_ = () => {
  head('0. static')
  const sec = SRC.slice(SRC.indexOf(SEC_A), SRC.indexOf(SEC_B))
  is(SRC.indexOf(SEC_A) > 0 && SRC.indexOf(SEC_A) < SRC.indexOf(SEC_B), 'the LOGINLIGHT section exists, before SIZES (the last section)')
  const sels = []
  postcss.parse(sec).walkRules((r) => { for (const s of r.selectors) sels.push(s.replace(/\s+/g, ' ')) })
  const loose = sels.filter((s) => !s.startsWith(':is(html, html.dark) body .admin-login'))
  is(sels.length >= 20 && !loose.length, `every selector (${sels.length}) opens with :is(html, html.dark) body .admin-login: nothing outside the sign-in screens`, loose.slice(0, 2).join(' | '))
  const media = []; postcss.parse(sec).walkAtRules('media', (a) => media.push(a.params))
  is(!media.some((p) => /prefers-color-scheme/.test(p)), 'no device colour-scheme query (light in every state, not a second dark theme)')
  is(!/gradient|backdrop-filter|filter:|animation|@keyframes|@import|url\(/.test(sec.replace(/\/\*[\s\S]*?\*\//g, '')), 'no gradient, filter, animation, import or url() in the section (light weight)')
  const bytes = generated('sporta-admin-knet', SRC).length - OFF.length
  is(bytes < 5200, `the section adds ${bytes} bytes to the shipped file (budget 5200)`)
  is(JS.includes(JS_A) && JS.includes(JS_B) && JS.includes('window.__sportaLoginKeyboard'), 'the keyboard block is in sporta-admin-brands.js with its double-run guard')
  is(JS_OFF.length < JS.length, 'the mutation cut finds the keyboard block')
}

static_()
await lightOnly(ON)
await lightWeight(ON)
await fullMobile(ON)
await keyboard(JS)
const passOn = pass, failOn = fail

head('5. mutation: the same checks must fail without the CSS section / the script block')
quiet = true
const mut = async (name, fn) => { mfail = 0; const p0 = pass, f0 = fail, n0 = fails.length; await fn(); const killed = mfail > 0; pass = p0; fail = f0; fails.length = n0; quiet = false; is(killed, `mutant "${name}" is caught (${mfail} checks fail)`); quiet = true }
await mut('LOGINLIGHT cut: light only', () => lightOnly(OFF))
await mut('LOGINLIGHT cut: light weight', () => lightWeight(OFF))
await mut('LOGINLIGHT cut: full mobile', () => fullMobile(OFF))
await mut('keyboard block cut', () => keyboard(JS_OFF))
quiet = false

await browser.close()
console.log(`\n${pass} passed, ${fail} failed` + (fail ? '\n' + fails.slice(0, 20).map((f) => '  - ' + f).join('\n') : ''))
process.exit(fail ? 1 : 0)
