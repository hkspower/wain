// The admin Save bar (block "ADMIN SAVE BAR" at the end of public/sporta-admin-brands.js), in a real browser,
// on fixtures that follow the Save patterns measured on the live compiled /backends (scripts/admin-save-scan.mjs).
//
//   npm run test:admin-save      (no database, no PHP, no rig: a fake origin, real Tailwind, the REAL add-on file)
//
// Owner request 2026-11-03: "add save buttons every page backends". The block adds no save logic: while a screen's
// own Save is out of view (or covered) it shows one bar with the same words that clicks the real one. What is asserted,
// at 390x844 and 1280x800, light and dark device:
//
//   - the bar shows only where the real Save is out of reach (long page form, inner scroll box, drawer, modal that
//     scrolls itself, the phone's sticky Save row under the tab bar), and never on a short form, a short modal, a
//     screen with no Save (autosave toggles, a Search/Apply filter form), a tiny inline form nobody typed in, or while a
//     confirm dialog without a Save is on top;
//   - label equal to the real button's text, aria-label equal, 44px minimum height, inside the viewport, above the phone
//     tab bar (and not lifted when the z80 backdrop already covers the tab bar), one z-index above the overlay;
//   - disabled and busy states are mirrored live (aria-disabled / aria-busy / "Saving..."), a click while disabled or
//     busy does nothing, a click calls the real handler exactly once (a double click too), native `required`
//     validation still blocks an empty form;
//   - the bar goes when the real Save scrolls into view, and the scroll container's padding is put back byte for byte;
//     with the bar up, the last field can be scrolled clear of it;
//   - a React-like re-render (the Save node replaced, the whole screen rebuilt) leaves ONE bar that still works;
//   - nothing else on the page changes (DOM diff of the app root), the head gains one <style>, the body one bar;
//   - the bar is the last tab stop, Enter on it saves, the focus ring shows; text contrast is 4.5:1 or better in the
//     enabled and disabled states, light and dark; no slide animation under prefers-reduced-motion;
//   - a burst of DOM changes costs at most one pass per frame and an idle page costs none;
//   - evaluated twice, the file still makes one bar; on the storefront nothing runs, and a single-page navigation into
//     and out of /backends starts and stops it;
//   - Cancel / Delete are never offered as a Save: a long form whose only out-of-view button is a Cancel (type=button or
//     type=submit), a submit "Delete product", and a scrolling modal with a submit Cancel and Delete get no bar, even after
//     a field was typed in;
//   - MUTATION CHECK: with the block cut out of the file the same checks fail, and so do copies of the block whose finder
//     counts Cancel / Delete as a Save or skips its refusal list.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, CONFIRM, ALL_HTML, FIXTURE_CSS, FIXTURE_JS, render } from './fixtures/admin-save.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = BRANDS.indexOf('/* ===== ADMIN SAVE BAR - begin')
const END_MARK = '/* ===== ADMIN SAVE BAR - end'
const END = BRANDS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN SAVE BAR block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS.slice(0, BEGIN) + BRANDS.slice(BRANDS.indexOf('\n', END))

let pass = 0, fail = 0
let sink = null                      // while set, results are collected (mutation run), not printed
const is = (ok, msg, detail = '') => {
  if (sink) { sink.push({ ok: !!ok, msg }); return }
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const classes = [...new Set([...ALL_HTML.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'admin-save-fixture.css') })).css

const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
const page = (path, name) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sporta</title><style>${TW}</style><style>${FIXTURE_CSS}</style><script src="/fixture.js" defer></script><script src="/sporta-admin-brands.js" defer></script></head><body><div id="root">${path === '/' ? '<main><h1>Storefront</h1><p>Shop</p></main>' : render(name)}</div></body></html>`

let brandsText = BRANDS
async function open(browser, { w, h, dark, reduced }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', reducedMotion: reduced ? 'reduce' : 'no-preference', isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await pg.addInitScript(() => {
    window.__obs = 0
    const o = MutationObserver.prototype.observe
    MutationObserver.prototype.observe = function () { window.__obs++; return o.apply(this, arguments) }
  })
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    const p = u.pathname
    if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FIXTURE_JS + `;window.FX_CONFIRM=${JSON.stringify(CONFIRM)}` })
    if (p === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: brandsText })
    if (p.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    if (p === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: page(p, u.searchParams.get('fx')) })
  })
  return { ctx, pg, errors }
}
const load = async (pg, name) => { await pg.goto(`${ORIGIN}/backends?fx=${name}`); await pg.waitForTimeout(650) }
const settle = (pg, ms = 620) => pg.waitForTimeout(ms)

// ---- in-page helpers (pg.evaluate serialises them)
const BARSEL = '[data-sporta-savebar]'
const barState = (pg) => pg.evaluate((sel) => {
  const all = document.querySelectorAll(sel)
  const b = all[0]
  if (!b) return { count: 0, shown: false }
  const btn = b.querySelector('button')
  const r = b.getBoundingClientRect(), br = btn.getBoundingClientRect(), cs = getComputedStyle(btn)
  return { count: all.length, shown: !b.hidden && r.height > 0, label: btn.textContent, aria: btn.getAttribute('aria-label'), ariaDisabled: btn.getAttribute('aria-disabled'), ariaBusy: btn.getAttribute('aria-busy'),
    rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }, btnH: br.height, color: cs.color, bg: cs.backgroundColor, tone: b.getAttribute('data-tone'), z: +getComputedStyle(b).zIndex, anim: getComputedStyle(b).animationName,
    outline: cs.outlineStyle, last: document.body.lastElementChild === b, vw: innerWidth, vh: innerHeight }
}, BARSEL)
const real = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), disabled: e.disabled, top: r.top, bottom: r.bottom, h: innerHeight } }, sel)
const scrollBox = (pg, sel, y) => pg.evaluate(([s, yy]) => {
  const e = s === 'window' ? document.scrollingElement : document.querySelector(s)
  e.scrollTop = yy === 'max' ? e.scrollHeight : yy
}, [sel, y])
const intoView = (pg, sel) => pg.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel)
const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const saves = (pg, n) => pg.evaluate((k) => window.fx.saves[k] || 0, n)

// Where each pattern's real Save is, which box scrolls, and what is expected. "touch" runs before the checks that need the bar.
const CASES = {
  'topbar-window': { sel: '.topbar-editor__save', box: 'window', save: 'topbar', label: 'Saved', disabled: true, show: { phone: true, desktop: true } },
  'topbar-inner': { sel: '.topbar-editor__save', box: '#inner', save: 'topbar', label: 'Saved', disabled: true, show: { phone: true, desktop: true } },
  'orders-drawer': { sel: '[data-save=customer]', box: '#orders-overlay aside', save: 'customer', label: 'Save customer details', overlay: '#orders-overlay', show: { phone: true, desktop: true } },
  'catalogue-modal': { sel: '.admin-editor-actions button[type=submit]', box: '.admin-editor-modal', save: 'product', label: 'Save product', overlay: '#cat-overlay', show: { phone: true, desktop: false } },
  'slides-modal': { sel: '#slides-overlay button[type=submit]', box: '#slides-overlay', save: 'slide', label: 'Save slide', overlay: '#slides-overlay', show: { phone: true, desktop: true } },
  'support-drawer': { sel: '.support-admin__editor button[type=submit]', box: '.support-admin__drawer', save: 'ticket', label: 'Save ticket', overlay: '#support-overlay', show: { phone: false, desktop: false } },
  'short-form': { sel: 'form[data-save=short] button', box: 'window', save: 'short', label: 'Save', show: { phone: false, desktop: false } },
  'short-modal': { sel: 'form[data-save=discount] button', box: 'window', save: 'discount', label: 'Save', show: { phone: false, desktop: false } },
  'crm-inline': { sel: '#crm-create button', box: 'window', save: 'crm', label: 'Create contact', show: { phone: false, desktop: false } },
  'no-save': { sel: null, box: 'window', show: { phone: false, desktop: false } },
  // Buttons the finder must refuse: Cancel / Delete are never a Save, in view or not, touched or not.
  'cancel-button': { sel: null, box: 'window', touch: true, show: { phone: false, desktop: false } },
  'cancel-submit': { sel: null, box: 'window', touch: true, show: { phone: false, desktop: false } },
  'delete-submit': { sel: null, box: 'window', touch: true, show: { phone: false, desktop: false } },
  'delete-modal': { sel: null, box: '#delete-overlay', touch: true, show: { phone: false, desktop: false } },
  'confirm-over-form': { sel: '.topbar-editor__save', box: 'window', save: 'topbar', label: 'Saved', show: { phone: true, desktop: true } },
}

const VIEWS = [['phone', 390, 844], ['desktop', 1280, 800]]
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

// ---- the checks that run for every pattern and every view and scheme
async function checkShow(pg, name, vn, dark) {
  const c = CASES[name], want = c.show[vn]
  const st = await barState(pg)
  is(st.shown === want, `${name} @${vn}${dark ? ' dark' : ''}: the bar is ${want ? 'shown' : 'not shown'} at load`, `shown=${st.shown}`)
  return st
}

async function checkShownBar(pg, name, vn, dark, st) {
  const c = CASES[name]
  const r = await real(pg, c.sel)
  const tag = `${name} @${vn}${dark ? ' dark' : ''}`
  is(st.label === r.text, `${tag}: bar label equals the real button's text`, `"${st.label}" vs "${r.text}"`)
  is(st.aria === st.label, `${tag}: aria-label equals the label`, st.aria)
  is(st.btnH >= 44, `${tag}: the button is at least 44px tall`, String(st.btnH))
  is(st.rect.l >= -0.5 && st.rect.r <= st.vw + 0.5 && st.rect.b <= st.vh + 0.5 && st.rect.t >= 0, `${tag}: the bar is inside the viewport`, JSON.stringify(st.rect))
  is(st.rect.w <= 720.5, `${tag}: no wider than 720px`, String(st.rect.w))
  if (c.disabled !== undefined) is((st.ariaDisabled === 'true') === c.disabled, `${tag}: disabled state mirrored (${c.disabled})`, String(st.ariaDisabled))
  is(st.last, `${tag}: the bar is the last element in the body (last tab stop)`)
  is(contrast(st.color, st.bg) >= 4.5, `${tag}: text contrast ${contrast(st.color, st.bg).toFixed(2)}:1 is 4.5 or better`)
  is(st.tone === (dark ? 'dark' : 'light'), `${tag}: ${dark ? 'dark' : 'light'} tone`, st.tone)
  const oz = c.overlay ? await pg.evaluate((s) => +getComputedStyle(document.querySelector(s)).zIndex, c.overlay) : 0
  if (vn === 'phone') {
    const tb = await pg.evaluate(() => document.querySelector('.m-tabbar').getBoundingClientRect().top)
    if (!c.overlay || oz <= 40) is(st.rect.b <= tb + 0.5, `${tag}: the bar sits above the phone tab bar`, `${st.rect.b} vs ${tb}`)
    else is(Math.abs(st.rect.b - st.vh) < 1.5, `${tag}: the z${oz} overlay already covers the tab bar, so the bar is not lifted`, `${st.rect.b} vs ${st.vh}`)
  }
  if (c.overlay) is(st.z === oz + 1, `${tag}: one z-index above the overlay (z${oz})`, `${st.z}`)
  else is(st.z < 40, `${tag}: below the modals (z-index ${st.z})`)
}

async function checkInteract(pg, name, vn, errors) {
  const c = CASES[name], tag = `${name} @${vn}`
  // padding: the last field can be scrolled clear of the bar
  const pad = await pg.evaluate(([boxSel, sel]) => {
    const box = boxSel === 'window' ? document.documentElement : document.querySelector(boxSel)
    const b = document.querySelector('[data-sporta-savebar]')
    const bt = b.getBoundingClientRect().top
    const bottom = boxSel === 'window' ? innerHeight : Math.min(box.getBoundingClientRect().bottom, innerHeight)
    return { have: parseFloat(getComputedStyle(box).paddingBottom), need: bottom - bt }
  }, [c.box, c.sel])
  is(pad.have >= pad.need - 0.5, `${tag}: bottom padding (${pad.have}px) reserves the bar's ${Math.round(pad.need)}px`)

  // clicking while disabled does nothing
  const st = await barState(pg)
  const before = await saves(pg, c.save)
  if (st.ariaDisabled === 'true') {
    await pg.click(BARSEL + ' button', { force: true })
    await settle(pg, 150)
    is((await saves(pg, c.save)) === before, `${tag}: a click on the disabled bar does not reach the real handler`)
  }
}

async function checkClickOnce(pg, name, vn) {
  const c = CASES[name], tag = `${name} @${vn}`
  await pg.evaluate((n) => { window.fx.saves[n] = 0 }, c.save)
  // a required field must block the submit like the real button would
  if (name === 'slides-modal') {
    await pg.click(BARSEL + ' button')
    await settle(pg, 200)
    is((await saves(pg, c.save)) === 0, `${tag}: native required validation still blocks an empty form through the bar`)
    await pg.evaluate(() => { const i = document.querySelector('#slides-overlay input[required]'); i.value = 'Title'; i.dispatchEvent(new Event('input', { bubbles: true })) })
    await settle(pg, 400)
  }
  await pg.dblclick(BARSEL + ' button')
  await settle(pg, 250)
  is((await saves(pg, c.save)) === 1, `${tag}: a (double) click runs the real handler exactly once`, String(await saves(pg, c.save)))
  await settle(pg, 700)
}

async function checkReveal(pg, name, vn) {
  const c = CASES[name], tag = `${name} @${vn}`
  const y = await pg.evaluate(([sel, boxSel]) => {
    const box = boxSel === 'window' ? document.scrollingElement : document.querySelector(boxSel)
    document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' })
    return box.scrollTop
  }, [c.sel, c.box])
  await settle(pg)
  const st = await barState(pg)
  is(!st.shown, `${tag}: the bar goes when the real Save scrolls into view`)
  const y2 = await pg.evaluate(([boxSel]) => (boxSel === 'window' ? document.scrollingElement : document.querySelector(boxSel)).scrollTop, [c.box])
  is(Math.abs(y2 - y) <= 1, `${tag}: and the page does not jump under the reader when it goes`, `${y} -> ${y2}`)
  // back to the top: the bar returns, and once the scroll position is inside the page proper the padding is gone
  await scrollBox(pg, c.box, 0)
  if (c.box !== 'window') await scrollBox(pg, 'window', 0)
  await settle(pg)
  is((await barState(pg)).shown, `${tag}: and comes back when the Save scrolls out of view again`)
  await intoView(pg, c.sel)
  await settle(pg)
  await scrollBox(pg, c.box, 0)
  if (c.box !== 'window') await scrollBox(pg, 'window', 0)
  await settle(pg)
  await scrollBox(pg, c.box, 0)
}

async function checkRerender(pg, name, vn) {
  const c = CASES[name], tag = `${name} @${vn}`
  await pg.evaluate(() => { document.querySelector('[data-sporta-savebar]').__keep = 1 })
  const sel = c.sel
  await pg.evaluate((s) => window.fx.rerender(s), sel)
  await settle(pg)
  let st = await barState(pg)
  const same = await pg.evaluate(() => !!document.querySelector('[data-sporta-savebar]').__keep)
  is(st.count === 1 && st.shown && same, `${tag}: replacing the Save node keeps the one bar (no flicker, no duplicate)`, `count=${st.count} shown=${st.shown}`)
  await pg.evaluate(() => window.fx.rerenderAll())
  await settle(pg)
  st = await barState(pg)
  is(st.count === 1 && st.shown, `${tag}: rebuilding the whole screen keeps exactly one bar`, `count=${st.count} shown=${st.shown}`)
  if (c.disabled) return                            // the disabled Save cannot be clicked: nothing to count
  await pg.evaluate((n) => { window.fx.saves[n] = 0 }, c.save)
  if (name === 'slides-modal') await pg.evaluate(() => { const i = document.querySelector('#slides-overlay input[required]'); i.value = 'T'; i.dispatchEvent(new Event('input', { bubbles: true })) })
  await pg.click(BARSEL + ' button')
  await settle(pg, 300)
  is((await saves(pg, c.save)) === 1, `${tag}: after a re-render the bar still reaches the new button, once`, String(await saves(pg, c.save)))
  await settle(pg, 800)
}

async function checkKeyboard(pg, name, vn) {
  const c = CASES[name], tag = `${name} @${vn}`
  await pg.keyboard.press('Shift')
  await pg.evaluate(() => document.querySelector('[data-sporta-savebar] button').focus())
  const o = await pg.evaluate(() => { const b = document.querySelector('[data-sporta-savebar] button'); const cs = getComputedStyle(b); return { tag: b.tagName, tab: b.tabIndex, outline: cs.outlineStyle, w: parseFloat(cs.outlineWidth), focus: document.activeElement === b } })
  is(o.tag === 'BUTTON' && o.tab >= 0 && o.focus, `${tag}: a real <button> that takes keyboard focus`)
  is(o.outline !== 'none' && o.w >= 2, `${tag}: a visible focus ring (${o.outline} ${o.w}px)`)
  if (c.save && !c.disabled) {
    await pg.evaluate((n) => { window.fx.saves[n] = 0 }, c.save)
    if (name === 'slides-modal') await pg.evaluate(() => { const i = document.querySelector('#slides-overlay input[required]'); i.value = 'T'; i.dispatchEvent(new Event('input', { bubbles: true })) })
    await pg.keyboard.press('Enter')
    await settle(pg, 300)
    is((await saves(pg, c.save)) === 1, `${tag}: Enter on the bar runs the real handler once`, String(await saves(pg, c.save)))
    await settle(pg, 800)
  }
}

async function checkStorm(pg, name, vn) {
  const tag = `${name} @${vn}`
  const t0 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  await settle(pg, 900)
  const t1 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  is(t1 - t0 <= 1, `${tag}: an idle page costs no passes`, `${t1 - t0} passes in 900ms`)
  const frames = 40
  await pg.evaluate((f) => window.fx.noise(f, 120), frames)
  const t2 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  is(t2 - t1 <= frames + 4, `${tag}: ${frames} frames of 120 DOM changes cost at most one pass per frame`, `${t2 - t1} passes`)
  await settle(pg, 900)
  const t3 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  await settle(pg, 900)
  const t4 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  is(t4 - t3 === 0, `${tag}: the bar's own writes do not trigger more passes`, `${t4 - t3}`)
}

// ================================================================== the run
for (const dark of [false, true]) {
  for (const [vn, w, h] of VIEWS) {
    head(`${vn} ${w}x${h}, ${dark ? 'dark' : 'light'} device`)
    const { ctx, pg, errors } = await open(browser, { w, h, dark })
    for (const name of Object.keys(CASES)) {
      const c = CASES[name]
      await load(pg, name)
      if (name === 'confirm-over-form') {
        const a = await checkShow(pg, name, vn, dark)
        await pg.evaluate(() => window.fx.confirm(true)); await settle(pg)
        is(!(await barState(pg)).shown, `${name} @${vn}${dark ? ' dark' : ''}: no bar while a dialog without a Save is on top`)
        await pg.evaluate(() => window.fx.confirm(false)); await settle(pg)
        is((await barState(pg)).shown, `${name} @${vn}${dark ? ' dark' : ''}: the bar is back when the dialog closes`)
        if (!dark) is(a.shown, 'confirm-over-form: bar was up before the dialog')
        continue
      }
      if (name === 'no-save') {
        let any = false
        for (const y of [0, 600, 1500, 'max']) { await scrollBox(pg, 'window', y); await settle(pg, 400); any = any || (await barState(pg)).shown }
        is(!any, `no-save @${vn}${dark ? ' dark' : ''}: no bar at any scroll position (autosave toggles, Search/Apply filter, Push button)`)
        continue
      }
      if (name === 'crm-inline') {
        await scrollBox(pg, 'window', 'max'); await settle(pg)
        is(!(await barState(pg)).shown, `crm-inline @${vn}${dark ? ' dark' : ''}: a 2-field inline form nobody typed in is not chased down the page`)
        await pg.evaluate(() => { const i = document.querySelector('#crm-create input'); i.focus({ preventScroll: true }); i.value = 'Sam'; i.dispatchEvent(new Event('input', { bubbles: true })) })
        await settle(pg)
        const st = await barState(pg)
        is(st.shown && st.label === 'Create contact', `crm-inline @${vn}${dark ? ' dark' : ''}: once a field in it is touched and it is out of view, "Create contact" is offered`, st.label)
        await scrollBox(pg, 'window', 0); await settle(pg)
        is(!(await barState(pg)).shown, `crm-inline @${vn}${dark ? ' dark' : ''}: and goes when the form is back in view`)
        continue
      }
      if (name === 'support-drawer') {
        const st0 = await checkShow(pg, name, vn, dark)
        // two Saves in one drawer: the one beside the field being typed in
        await pg.evaluate(() => { const t = document.querySelector('textarea[name=reply]'); t.focus({ preventScroll: true }); t.value = 'Hello'; t.dispatchEvent(new Event('input', { bubbles: true })) })
        await settle(pg)
        const st = await barState(pg)
        is(st.shown && st.label === 'Send customer reply' && st.ariaDisabled === null, `support-drawer @${vn}${dark ? ' dark' : ''}: typing in the reply offers "Send customer reply", enabled`, `${st.shown} ${st.label} ${st.ariaDisabled}`)
        if (vn === 'phone') {
          const vh = st.vh
          is(Math.abs(st.rect.b - vh) < 1.5, `support-drawer @phone${dark ? ' dark' : ''}: the z80 backdrop already covers the tab bar, so the bar is not lifted`, `${st.rect.b} vs ${vh}`)
        }
        if (!dark) {
          await pg.evaluate(() => { document.querySelector('#reply-save').scrollIntoView({ block: 'center', behavior: 'instant' }) })
          await settle(pg)
          is(!(await barState(pg)).shown, 'support-drawer: and goes when the reply button is in view')
          await pg.evaluate(() => { const t = document.querySelector('textarea[name=reply]'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.support-admin__drawer').scrollTop = 0 })
          await settle(pg)
          const off = await barState(pg)
          is(off.shown && off.ariaDisabled === 'true', 'support-drawer: the reply emptied again, the bar mirrors the disabled Send', `${off.shown} ${off.ariaDisabled}`)
        }
        continue
      }
      const st = await checkShow(pg, name, vn, dark)
      if (!c.show[vn]) {
        // not shown at load: scrolling the page must not conjure one either
        for (const y of [200, 'max']) { await scrollBox(pg, c.box, y); await settle(pg, 400) }
        is(!(await barState(pg)).shown, `${name} @${vn}${dark ? ' dark' : ''}: and none appears when scrolled`)
        if (c.touch) {
          // the reader types in the form (the strongest reason to chase a button down the page) and scrolls away from it
          await scrollBox(pg, c.box, 0); await settle(pg, 300)
          await pg.evaluate(() => { const i = document.querySelector('input[name=f1]'); i.focus({ preventScroll: true }); i.value = 'x'; i.dispatchEvent(new Event('input', { bubbles: true })) })
          await settle(pg)
          is(!(await barState(pg)).shown, `${name} @${vn}${dark ? ' dark' : ''}: a Cancel / Delete button is not offered as a Save even after a field was typed in`)
          await scrollBox(pg, c.box, 'max'); await settle(pg, 400)
          is((await pg.evaluate(() => document.querySelectorAll('[data-sporta-savebar]:not([hidden])').length)) === 0, `${name} @${vn}${dark ? ' dark' : ''}: and none is up at the end of the form either`)
        }
        continue
      }
      await checkShownBar(pg, name, vn, dark, st)
      if (name === 'orders-drawer') {
        // the second Save: disabled until the select changes, busy while saving
        await pg.evaluate(() => { const s = document.querySelector('select[data-enables]'); s.focus({ preventScroll: true }); s.value = 'packed'; s.dispatchEvent(new Event('change', { bubbles: true })) })
        await settle(pg)
        const s2 = await barState(pg)
        is(s2.shown && s2.label === 'Save status' && s2.ariaDisabled === null, `orders-drawer @${vn}${dark ? ' dark' : ''}: changing the status offers "Save status", enabled (two Saves, the nearest wins)`, `${s2.label} ${s2.ariaDisabled}`)
        await pg.evaluate(() => { const t = document.querySelector('input[name=f1]'); t.focus({ preventScroll: true }) })
        await settle(pg)
        is((await barState(pg)).label === 'Save customer details', `orders-drawer @${vn}${dark ? ' dark' : ''}: focus back in the customer section, the bar follows`)
      }
      if (dark) {
        // dark: the colours were read from the page behind the bar
        const bgLum = lum(st.bg)
        is(bgLum < 0.5, `${name} @${vn} dark: the button is readable on a dark page`, st.bg)
        continue
      }
      await checkInteract(pg, name, vn, errors)
      if (c.disabled === undefined || name === 'orders-drawer') {
        if (name === 'orders-drawer') {
          // busy: click -> disabled + aria-busy + "Saving..." mirrored, a click then does nothing
          await pg.evaluate(() => { window.fx.saves.customer = 0; document.querySelector('input[name=f1]').focus({ preventScroll: true }) }); await settle(pg)
          await pg.click(BARSEL + ' button')
          await pg.waitForTimeout(150)
          const b = await barState(pg)
          is(b.ariaBusy === 'true' && b.ariaDisabled === 'true' && /^Saving/.test(b.label), `orders-drawer @${vn}: while saving the bar shows "${b.label}", aria-busy and disabled`, JSON.stringify([b.label, b.ariaBusy, b.ariaDisabled]))
          const d = await pg.evaluate(() => { const e = document.querySelector('[data-save=customer]'); const bar = document.querySelector('[data-sporta-savebar] button'); return { real: [e.textContent, e.disabled, e.getAttribute('aria-busy')], same: e.textContent.replace(/\s+/g, ' ').trim() === bar.textContent } })
          is(d.same, `orders-drawer @${vn}: the busy label equals the real button's`, JSON.stringify(d.real))
          await pg.click(BARSEL + ' button', { force: true }).catch(() => {})
          await pg.waitForTimeout(100)
          is((await saves(pg, 'customer')) === 1, `orders-drawer @${vn}: clicks while busy do not submit again`, String(await saves(pg, 'customer')))
          await settle(pg, 900)
          const a = await barState(pg)
          is(a.label === 'Save customer details' && a.ariaBusy === null && a.ariaDisabled === null, `orders-drawer @${vn}: and the bar is a live Save again afterwards`, JSON.stringify([a.label, a.ariaBusy, a.ariaDisabled]))
        } else await checkClickOnce(pg, name, vn)
      }
      if (c.disabled) {
        // Topbar: dirty the form and the same bar becomes a live Save
        await pg.evaluate(() => { const i = document.querySelector('.topbar-editor input[name=f1]'); i.focus({ preventScroll: true }); i.value = 'x'; i.dispatchEvent(new Event('input', { bubbles: true })) })
        await settle(pg)
        const d = await barState(pg)
        is(d.ariaDisabled === null && d.label === 'Save changes', `${name} @${vn}: dirtying the form turns the bar into a live "Save changes"`, `${d.label} ${d.ariaDisabled}`)
        await checkClickOnce(pg, name, vn)
      }
      await checkRerender(pg, name, vn)
      await checkKeyboard(pg, name, vn)
      if (name === 'catalogue-modal') {
        // at the very end the sticky row has come out from under the tab bar: the Save is reachable, the bar steps aside, nothing is covered
        await scrollBox(pg, c.box, 'max'); await settle(pg)
        const m = await pg.evaluate(() => {
          const r = document.querySelector('.admin-editor-actions button[type=submit]').getBoundingClientRect(), l = document.querySelector('[data-last]').getBoundingClientRect()
          const b = document.querySelector('[data-sporta-savebar]'), t = document.querySelector('.m-tabbar').getBoundingClientRect().top
          return { barShown: !b.hidden, realBottom: r.bottom, tab: t, lastBottom: l.bottom, barTop: b.getBoundingClientRect().top }
        })
        is(m.realBottom <= m.tab + 0.5 || m.barShown, `${name} @${vn}: scrolled to the end the Save is reachable (above the tab bar, or the bar is up)`, JSON.stringify(m))
        is(m.barShown ? m.lastBottom <= m.barTop + 0.5 : m.lastBottom <= m.tab, `${name} @${vn}: and the last field is clear of the bar / tab bar`, JSON.stringify(m))
        await scrollBox(pg, c.box, 0); await settle(pg)
        is((await barState(pg)).shown, `${name} @${vn}: back at the top the sticky row is under the tab bar again and the bar is back`)
      } else await checkReveal(pg, name, vn)
      // DOM diff: the bar up, then the Save in view; the app root must be identical (except the padding we add)
      await scrollBox(pg, c.box, 0); await scrollBox(pg, 'window', 0); await settle(pg)
      if ((await barState(pg)).shown) {
        const A = await pg.evaluate(() => document.getElementById('root').innerHTML.replace(/padding-bottom:\s*[^;"]*;?\s?/g, ''))
        await intoView(pg, c.sel); await settle(pg)
        const B = await pg.evaluate(() => document.getElementById('root').innerHTML.replace(/padding-bottom:\s*[^;"]*;?\s?/g, ''))
        const norm = (x) => x.replace(/ style=""/g, '')
        is(norm(A) === norm(B), `${name} @${vn}: nothing in the app changes while the bar is up (DOM identical but the padding)`)
        const extra = await pg.evaluate(() => ({ styles: document.querySelectorAll('style[data-sporta-savebar-css]').length, bars: document.querySelectorAll('[data-sporta-savebar]').length, headKids: document.head.children.length, bodyKids: [...document.body.children].map((e) => e.tagName + (e.id ? '#' + e.id : '')) }))
        is(extra.styles === 1 && extra.bars === 1, `${name} @${vn}: one style element and one bar`, JSON.stringify(extra))
        is(extra.bodyKids.filter((k) => !/^(SCRIPT|DIV)/.test(k)).length === 0, `${name} @${vn}: the body gets nothing but the one bar`, extra.bodyKids.join(','))
        await scrollBox(pg, c.box, 0); await scrollBox(pg, 'window', 0); await settle(pg)
      }
      await checkStorm(pg, name, vn)
    }
    is(errors.length === 0, `${vn} ${dark ? 'dark' : 'light'}: no console errors or page errors (CSP included)`, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }
}

// ---- reduced motion
head('reduced motion')
for (const reduced of [false, true]) {
  const { ctx, pg } = await open(browser, { w: 390, h: 844, dark: false, reduced })
  await load(pg, 'topbar-window')
  const st = await barState(pg)
  is(st.shown && (reduced ? st.anim === 'none' : st.anim !== 'none'), `prefers-reduced-motion: ${reduced ? 'reduce -> no slide animation' : 'no-preference -> slide-in animation'}`, st.anim)
  await ctx.close()
}

// ---- disabled mirror: Returns-like Save disabled until a change, the bar says so, and a native click does nothing
head('twice, storefront, navigation')
{
  const { ctx, pg, errors } = await open(browser, { w: 390, h: 844, dark: false })
  await load(pg, 'topbar-window')
  await pg.evaluate(() => window.fx.noise(30, 50)); await settle(pg)
  const t0 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  await pg.evaluate(() => window.fx.noise(30, 50))
  const per1 = (await pg.evaluate(() => window.__sportaSaveBar.ticks)) - t0
  await pg.evaluate(BRANDS)                                      // the file evaluated a second time
  await pg.evaluate(BRANDS)
  await settle(pg)
  const t1 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  await pg.evaluate(() => window.fx.noise(30, 50))
  const per2 = (await pg.evaluate(() => window.__sportaSaveBar.ticks)) - t1
  const st = await barState(pg)
  is(st.count === 1 && st.shown, 'the file evaluated three times still makes one bar', `count=${st.count}`)
  is(per2 <= 34 && per2 <= per1 + 2, 'and does not multiply the work', `${per1} -> ${per2} passes for the same 30 frames`)
  is(errors.length === 0, 'no errors when evaluated twice', errors.join(' | '))
  await ctx.close()
}
{
  const { ctx, pg, errors } = await open(browser, { w: 390, h: 844, dark: false })
  await pg.goto(`${ORIGIN}/`); await settle(pg)
  const s = await pg.evaluate(() => ({ bars: document.querySelectorAll('[data-sporta-savebar]').length, styles: document.querySelectorAll('style[data-sporta-savebar-css]').length, observers: window.__obs, ticks: window.__sportaSaveBar && window.__sportaSaveBar.ticks }))
  is(s.bars === 0 && s.styles === 0, 'storefront: no bar, no style element')
  is(s.observers === 0 && s.ticks === 0, 'storefront: no observer started and no pass run', JSON.stringify(s))
  await pg.evaluate(([html]) => window.fx.navigate('/backends?fx=topbar-window', html), [render('topbar-window')]); await settle(pg, 900)
  is((await barState(pg)).shown, 'single-page navigation into /backends starts the bar')
  const tk = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  await pg.evaluate(() => window.fx.navigate('/', '<main><h1>Storefront</h1></main>')); await settle(pg, 900)
  is(!(await barState(pg)).shown, 'single-page navigation back to the storefront hides it')
  await pg.evaluate(() => window.fx.noise(20, 50)); await settle(pg)
  const tk2 = await pg.evaluate(() => window.__sportaSaveBar.ticks)
  is(tk2 - tk <= 3, 'and stops watching the page (no passes on the storefront)', `${tk2 - tk} passes`)
  is(errors.length === 0, 'no errors across the navigation', errors.join(' | '))
  await ctx.close()
}

// ---- MUTATION CHECK: the same checks must fail with the block cut out of the file
head('mutation check')
{
  brandsText = WITHOUT
  sink = []
  for (const [vn, w, h] of VIEWS) {
    const { ctx, pg } = await open(browser, { w, h, dark: false })
    for (const name of ['topbar-window', 'orders-drawer', 'slides-modal', 'catalogue-modal']) {
      if (name === 'catalogue-modal' && vn === 'desktop') continue
      await load(pg, name)
      await checkShow(pg, name, vn, false)
    }
    await ctx.close()
  }
  const failed = sink.filter((x) => !x.ok).length, total = sink.length
  sink = null
  brandsText = BRANDS
  is(failed >= 1 && failed === total, `with the block cut out, the "bar is shown" checks fail (${failed} of ${total})`)
}
// The finder's refusals must be pinned too: break each rule in a copy of the block and the Cancel / Delete fixtures must
// start showing a bar. A mutant that does not apply (the line moved) fails the run, so the check cannot rot into a no-op.
const MUTANTS = [
  ['a label starting with Cancel counts as a Save', 'var save = SAVE.test(lead)', 'var save = SAVE.test(lead) || /^cancel/i.test(lead)', ['cancel-button', 'cancel-submit', 'delete-modal']],
  ['the Cancel / Delete / ... refusal list is not consulted', 'if (!save && NOT.test(lead)) return false', '', ['cancel-submit', 'delete-submit', 'delete-modal']],
  ['a label starting with Delete counts as a Save', 'var save = SAVE.test(lead)', 'var save = SAVE.test(lead) || /^delete/i.test(lead)', ['delete-submit', 'delete-modal']],
]
for (const [what, from, to, names] of MUTANTS) {
  const at = BRANDS.indexOf(from, BEGIN)
  is(at > BEGIN && at < END, `mutant "${what}" applies to the block`, 'the line it edits moved')
  if (!(at > BEGIN && at < END)) continue
  brandsText = BRANDS.slice(0, at) + to + BRANDS.slice(at + from.length)
  sink = []
  const { ctx, pg } = await open(browser, { w: 390, h: 844, dark: false })
  for (const name of names) {
    await load(pg, name)
    await pg.evaluate(() => { const i = document.querySelector('input[name=f1]'); i.focus({ preventScroll: true }); i.value = 'x'; i.dispatchEvent(new Event('input', { bubbles: true })) })
    await settle(pg)
    is(!(await barState(pg)).shown, `${name}: no bar`)
  }
  await ctx.close()
  const failed = sink.filter((x) => !x.ok).length
  sink = null
  brandsText = BRANDS
  is(failed >= 1, `mutant "${what}" is caught: a Cancel / Delete fixture shows a bar (${failed} of ${names.length} fixtures fail)`)
}

await browser.close()
console.log(`\n${pass} ok, ${fail} failed`)
process.exit(fail ? 1 : 0)
