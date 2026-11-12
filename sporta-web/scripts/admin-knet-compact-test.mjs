// The KNETCOMPACT-1112 section of addons-src/sporta-admin-knet.css ("make knet backends more compact", owner 2026-11-12), proven on the
// captured live Payments markup (scripts/fixtures/admin-payments.mjs) under the live rules, WITH the real public/sporta-admin-brands.js
// running on it (it retires the T-Pay card and editor, builds the Merchant ID / CBK connection / Merchant Server IP panels and folds the
// one-value address fields into a summary: the screen as the owner sees it).
//
//   npm run test:admin-knet-compact      (no sandbox; ADDON_FILE=<a SOURCE file> measures another file as "on")
//
// "off" = the source with the KNETCOMPACT-1112 block cut out, "on" = the whole source, both through the repo's own slim build
// (scripts/build-addon-css.mjs generated()), because that is the file that ships. English and Arabic (dir=rtl), 390 / 768 / 1280 / 1440px.
// Asserted:
//   [kc-static] the section exists once, before SIZES (which stays last); every selector is scoped to the Payments screen root; it
//               declares no colour, background, border, radius, shadow, outline or font size, and no physical side (RTL);
//   [kc-height] the screen is shorter: >= 25% at 1280 and 1440px, >= 10% at 768px, >= 8% at 390px (the table is printed);
//   [kc-floor]  every button and text field is >= 44px tall on a phone and >= 40px on a mouse screen; the "through CBK" card (the
//               checkbox's label) >= 44px; field labels >= 13px; phone inputs >= 14px (no iOS zoom); no text got smaller;
//   [kc-fit]    no sideways scroll, nothing past the screen's edges, the field grids still two columns from 768px;
//   [kc-look]   every colour, background, edge, radius and shadow on the screen is computed exactly as without the section, in the
//               light admin and under the live build's dark rules (the screen is light only, section 9);
//   [kc-layout] from 1024px the checks sit beside the status tiles and the Merchant ID / IP save buttons end their last field row;
//               from 1200px the four identifiers share one row;
//   [kc-mut]    mutation check: with the section cut out ("on" = "off") the height and layout checks fail.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_HTML, LIVE } from './fixtures/admin-payments.mjs'
import { generated } from './build-addon-css.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(process.env.ADDON_FILE || join(ROOT, 'addons-src/sporta-admin-knet.css'), 'utf8')
const START = '/* ==== KNETCOMPACT-1112:', END = '/* ==== end KNETCOMPACT-1112 */'
const A = SRC.indexOf(START), B = SRC.indexOf(END)
const SECTION = A >= 0 && B > A ? SRC.slice(A, B + END.length) : ''
const OFF_SRC = SECTION ? SRC.slice(0, A) + SRC.slice(B + END.length) : SRC
const OFF_CSS = generated('sporta-admin-knet', OFF_SRC)
const ON_CSS = generated('sporta-admin-knet', SRC)
const JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const cutAt = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), cutAt), DARK_ADMIN = DARK.slice(cutAt)
// The capture has the production gateway as www.kpay.com.kw (made-up data the live admin.php refuses); with every address right the
// summary lists five values, which is the screen the owner has (test:admin-trim does the same).
const BODY = BODY_HTML.replace('https://www.kpay.com.kw/kpg/PaymentHTTP.htm', 'https://kpay.com.kw/kpg/PaymentHTTP.htm')

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; fails.push(msg); console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// ---------------------------------------------------------------- static
head('static: the section in addons-src/sporta-admin-knet.css')
const SCOPE = '.admin-shell .admin-content .payment-settings.admin-page-layout.admin-page-layout--form'
is(!!SECTION && SRC.indexOf(START, A + 1) < 0, 'the KNETCOMPACT-1112 section exists, once')
is(A > 0 && A < SRC.indexOf('/* ==== SIZES:') && !SRC.slice(SRC.indexOf('/* ==== SIZES:') + 5).includes('/* ==== '), 'it sits before the SIZES section, and SIZES stays the last section')
const rules = []
postcss.parse(SECTION || '/* none */').walkRules((r) => rules.push(r))
const selectors = rules.flatMap((r) => r.selectors)
is(selectors.length >= 10 && selectors.every((s) => s.startsWith(SCOPE + ' ') || s.startsWith(SCOPE + ' >') || s === SCOPE || s.startsWith(SCOPE + ' ')), `every selector (${selectors.length}) starts at the Payments screen root`, selectors.filter((s) => !s.startsWith(SCOPE)).join(' | '))
const props = []
postcss.parse(SECTION || '/* none */').walkDecls((d) => props.push(d.prop))
const BANNED = /^(color|background|background-color|border|border-.*|outline|outline-.*|box-shadow|font-size|font|text-shadow|opacity|fill|stroke|accent-color)$/
is(props.length > 0 && !props.some((p) => BANNED.test(p)), 'no colour, background, edge, radius, shadow, outline or font-size declaration (spacing and layout only)', props.filter((p) => BANNED.test(p)).join(', '))
is(!props.some((p) => /(^|-)(left|right|top|bottom)$/.test(p) || /-(left|right|top|bottom)-/.test(p)), 'logical properties only (it mirrors in Arabic)', props.filter((p) => /(left|right|top|bottom)/.test(p)).join(', '))

// ---------------------------------------------------------------- browser
const classes = [...new Set([...BODY.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'x.css') })).css
const ORIGIN = 'https://admin.test'
const SHAPE = { knet: { installed: true, env: 'test', credentials: {} }, tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: 'https://www.sporta.com.kw/pay/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result', has_client_id: true, has_client_secret: true, has_encrp_key: false } }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

async function measure(lang, w, css, { dark = false, open = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
  const p = await ctx.newPage(); const rtl = lang === 'ar'
  await p.route(`${ORIGIN}/backends`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"${dark ? ' class="dark" data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=${w},initial-scale=1"><style>${TW}</style><style>${LIVE}</style>${dark ? `<style>${DARK_INDEX}</style>` : ''}<style>${css}</style>${dark ? `<style>${DARK_ADMIN}</style>` : ''}</head><body style="margin:0"><div id="root">${BODY}</div><script src="${ORIGIN}/addon.js"></script></body></html>` }))
  await p.route(`${ORIGIN}/addon.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: JS }))
  await p.route(`${ORIGIN}/api/admin.php**`, (r) => {
    const route = new URL(r.request().url()).searchParams.get('r'); const j = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
    if (route === 'payment_config') return j(SHAPE)
    if (route === 'payment_identifiers') return j({ env: 'test', test: { merchant_id: '6261', terminal_id: '626101' }, production: { merchant_id: '', terminal_id: '' } })
    if (route === 'payment_server_ips') return j({ server_ip_1: '187.7.78.123', server_ip_2: '' })
    if (route === 'payment_knet_via_cbk') return j({ enabled: false, tpay_ready: true })
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
  })
  await p.goto(`${ORIGIN}/backends`); await p.waitForSelector('[data-sporta-cbk]', { timeout: 15000 }).catch(() => null)
  await p.waitForSelector('[data-sporta-fixed="knet"]', { timeout: 5000 }).catch(() => null); await p.waitForTimeout(300)
  if (open) { await p.evaluate(() => document.querySelectorAll('[data-sporta-fixed] button[aria-expanded="false"]').forEach((b) => b.click())); await p.waitForTimeout(200) }
  const m = await p.evaluate(() => {
    const q = (s) => document.querySelector(s), cs = (e) => getComputedStyle(e)
    const shown = (e) => !!e && cs(e).display !== 'none' && cs(e).visibility !== 'hidden' && e.getClientRects().length > 0 && !e.closest('.sr-only')
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
    const root = q('.payment-settings')
    const form = q('form.payment-gateway-editor:not([data-sporta-tpay-retired])'), card = q('section.payment-gateway-card:not([data-sporta-tpay-retired])')
    const all = [...root.querySelectorAll('*')].filter(shown)
    const LOOK = ['color', 'background-color', 'border-top-color', 'border-inline-start-color', 'border-top-width', 'border-top-left-radius', 'box-shadow', 'outline-color']
    const ids = q('[data-sporta-knet-ids]'), ips = q('[data-sporta-tpay-ips]')
    const saveIn = (panel) => { const b = panel && [...panel.querySelectorAll('button')].find((x) => /^Save/.test(x.textContent.trim())); const g = panel && panel.querySelector(':scope > .grid'); if (!b || !g) return null; const last = [...g.children].filter(shown).pop(); return { btn: r(b), grid: r(g), last: r(last) } }
    const idsGrid = ids && ids.querySelector(':scope > .grid')
    const sr = r(root)
    return {
      vw: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
      outside: all.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < sr.l - 0.5 || b.right > sr.r + 0.5) }).map((e) => e.tagName + '.' + String(e.className).slice(0, 40)).slice(0, 5),
      total: sr.h, card: card ? r(card).h : 0, form: form ? r(form).h : 0,
      parts: Object.fromEntries([['toggle', '.payment-knet-toggle-row'], ['ids', '[data-sporta-knet-ids]'], ['cbk', '[data-sporta-cbk]'], ['ips', '[data-sporta-tpay-ips]'], ['sumKnet', '[data-sporta-fixed="knet"]'], ['sumCbk', '[data-sporta-fixed="cbk"]']].map(([k, s]) => [k, q(s) ? Math.round(r(q(s)).h) : 0])),
      viaCbk: (() => { const l = form && form.querySelector('label.rounded-2xl:has(> input[type="checkbox"])'); return l ? r(l).h : null })(),
      buttons: [...root.querySelectorAll('button')].filter(shown).map((b) => ({ t: (b.textContent.trim() || b.getAttribute('aria-label') || 'switch').slice(0, 24), h: r(b).h })),
      fields: [...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select')].filter(shown).map((i) => ({ h: r(i).h, fs: parseFloat(cs(i).fontSize) })),
      labels: [...root.querySelectorAll('label > span:first-child:not(.sr-only)')].filter(shown).map((s) => parseFloat(cs(s).fontSize)),
      fonts: all.map((e) => parseFloat(cs(e).fontSize)),
      look: all.map((e) => LOOK.map((k) => cs(e).getPropertyValue(k)).join('|')),
      tags: all.map((e) => e.tagName),
      gridCols: [...form.querySelectorAll('.grid.md\\:grid-cols-2')].filter(shown).map((g) => cs(g).gridTemplateColumns.split(' ').length),
      checksBeside: (() => { const d = card && card.querySelector(':scope > dl'), c = card && card.querySelector(':scope > ul'); if (!d || !c) return false; const a = r(d), b = r(c); return (b.l >= a.r - 0.5 || a.l >= b.r - 0.5) && b.t < a.b })(),
      idsSave: saveIn(ids), ipsSave: saveIn(ips),
      idsCols: idsGrid ? cs(idsGrid).gridTemplateColumns.split(' ').length : 0,
    }
  })
  await ctx.close(); return m
}

const WIDTHS = [390, 768, 1280, 1440]
const TARGET = { 390: 0.08, 768: 0.10, 1280: 0.25, 1440: 0.25 }
const table = []
const layoutOk = (on, w) => (w < 1024 || (on.checksBeside && on.idsSave && on.idsSave.btn.t >= on.idsSave.last.t - 0.5 && on.idsSave.btn.b <= on.idsSave.grid.b + 0.5 && on.ipsSave && on.ipsSave.btn.b <= on.ipsSave.grid.b + 0.5)) && (w < 1200 || on.idsCols === 4)
let mutationCaught = 0
for (const lang of ['en', 'ar']) {
  for (const w of WIDTHS) {
    head(`${lang} ${w}px`)
    const off = await measure(lang, w, OFF_CSS), on = await measure(lang, w, ON_CSS)
    const cut = 1 - on.total / off.total
    table.push({ lang, w, off: Math.round(off.total), on: Math.round(on.total), cut, cardOff: Math.round(off.card), cardOn: Math.round(on.card), formOff: Math.round(off.form), formOn: Math.round(on.form), partsOff: off.parts, partsOn: on.parts })
    is(cut >= TARGET[w], `[kc-height] the screen is ${(cut * 100).toFixed(1)}% shorter (${Math.round(off.total)} -> ${Math.round(on.total)}px; target ${TARGET[w] * 100}%)`)
    is(on.card < off.card && on.form < off.form, `[kc-height] both the status card (${Math.round(off.card)} -> ${Math.round(on.card)}) and the editor (${Math.round(off.form)} -> ${Math.round(on.form)}) are shorter`)
    const phone = w < 768, floor = phone ? 44 : 40
    const lowB = on.buttons.filter((b) => b.h < floor - 0.5), lowF = on.fields.filter((f) => f.h < floor - 0.5)
    is(on.buttons.length >= 6 && !lowB.length, `[kc-floor] every button (${on.buttons.length}) is >= ${floor}px tall`, JSON.stringify(lowB))
    is(on.fields.length >= 6 && !lowF.length, `[kc-floor] every text field (${on.fields.length}) is >= ${floor}px tall`, JSON.stringify(lowF))
    is(on.viaCbk === null || on.viaCbk >= 44, `[kc-floor] the "through this CBK setup" card (the checkbox's whole label) is >= 44px (${on.viaCbk && on.viaCbk.toFixed(0)})`)
    is(on.labels.length >= 6 && on.labels.every((f) => f >= 13), `[kc-floor] every field label (${on.labels.length}) is >= 13px`, on.labels.filter((f) => f < 13).join(','))
    if (phone) is(on.fields.every((f) => f.fs >= 14), '[kc-floor] every phone field is set at >= 14px (no iOS zoom)', on.fields.map((f) => f.fs).join(','))
    is(on.fonts.length === off.fonts.length && on.fonts.every((f, i) => f >= off.fonts[i]), `[kc-floor] no text got smaller (${on.fonts.length} elements)`)
    is(on.overflow <= 0 && !on.outside.length, '[kc-fit] no sideways scroll, nothing past the screen\'s edges', `overflow ${on.overflow}; ${on.outside.join(' ')}`)
    if (w >= 768) is(on.gridCols.length >= 3 && on.gridCols.every((n) => n >= 2), `[kc-fit] the field grids stay two columns or more (${on.gridCols.join('/')})`)
    const diff = on.look.map((v, i) => v === off.look[i] ? null : `${on.tags[i]}: ${off.look[i]} -> ${v}`).filter(Boolean)
    is(on.look.length === off.look.length && !diff.length, `[kc-look] every colour, edge, radius and shadow is unchanged (${on.look.length} elements)`, diff.slice(0, 3).join(' ; '))
    if (w >= 1024) {
      is(layoutOk(on, w), `[kc-layout] the checks sit beside the tiles; the Merchant ID / IP saves end their last field row${w >= 1200 ? '; four identifiers in one row' : ''}`, JSON.stringify({ beside: on.checksBeside, idsCols: on.idsCols, ids: on.idsSave, ips: on.ipsSave && on.ipsSave.btn }))
    }
    // The mutant is "on" = "off" (the section cut out): the height target must fail with it, and from 1024px the layout check too.
    const mutantPasses = (1 - off.total / off.total) >= TARGET[w] || (w >= 1024 && layoutOk(off, w))
    if (!mutantPasses) mutationCaught++
  }
}

head('dark device (the screen stays light only)')
for (const w of [390, 1280]) {
  const off = await measure('en', w, OFF_CSS, { dark: true }), on = await measure('en', w, ON_CSS, { dark: true })
  const diff = on.look.map((v, i) => v === off.look[i] ? null : `${on.tags[i]}: ${off.look[i]} -> ${v}`).filter(Boolean)
  is(on.look.length === off.look.length && !diff.length && on.total < off.total, `[kc-look] ${w}px, live dark rules: the same light colours as without the section, and still shorter (${Math.round(off.total)} -> ${Math.round(on.total)})`, diff.slice(0, 3).join(' ; '))
}

head('"Show fields" open (every address field laid out)')
for (const [lang, w] of [['en', 390], ['ar', 390], ['en', 768], ['ar', 1280]]) {
  const off = await measure(lang, w, OFF_CSS, { open: true }), on = await measure(lang, w, ON_CSS, { open: true })
  const floor = w < 768 ? 44 : 40
  is(on.overflow <= 0 && !on.outside.length && on.fields.every((f) => f.h >= floor - 0.5) && on.total < off.total, `${lang} ${w}px: no overflow, fields >= ${floor}px, shorter (${Math.round(off.total)} -> ${Math.round(on.total)})`, `overflow ${on.overflow} ${on.outside.join(' ')}`)
}
await browser.close()

head('mutation check (the section cut out)')
// "on" = "off": every height check above would read 0% and the 1024px+ layout checks would fail.
is(mutationCaught === table.length, `without the section, the height target fails at every width and language, and so does the 1024px+ layout (${mutationCaught} of ${table.length} cases caught)`)

head('before -> after (px; .payment-settings, status card, editor)')
console.log('lang  width   before   after    cut     card before/after   editor before/after')
for (const t of table) console.log(`${t.lang.padEnd(5)} ${String(t.w).padEnd(7)} ${String(t.off).padEnd(8)} ${String(t.on).padEnd(8)} ${(t.cut * 100).toFixed(1).padStart(5)}%   ${String(t.cardOff).padStart(5)} / ${String(t.cardOn).padEnd(10)}   ${String(t.formOff).padStart(5)} / ${t.formOn}`)
if (process.env.VERBOSE) for (const t of table) console.log(t.lang, t.w, JSON.stringify(t.partsOff), '->', JSON.stringify(t.partsOn))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
