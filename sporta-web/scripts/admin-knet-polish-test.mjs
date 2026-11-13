// The KNETPOLISH section of addons-src/sporta-admin-knet.css, proven on the live-markup Payments fixture WITH the real
// public/sporta-admin-brands.js running on it (the script is what retires the T-Pay card and form and builds the "CBK connection" block,
// so the rules that depend on that are only meaningful with it).
//
//   npm run test:admin-knet-polish     (no sandbox; ADDON_FILE=<path to a SOURCE file> measures another file as "on": the mutation check passes
//                                       the source without the section and the suite must FAIL)
//
// "off" = the source with the KNETPOLISH block cut out, "on" = the whole source, both through the repo's own slim build
// (scripts/build-addon-css.mjs generated()), because that is the file that ships. English and Arabic (dir=rtl), 390 / 768 / 1024 / 1280 / 1440px,
// the light admin and a dark device with the live build's real dark rules (the Payments screen is light only).
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
const A = SRC.indexOf('/* ==== KNETPOLISH:'), B = SRC.indexOf('/* ==== SIZES:')
const OFF_CSS = generated('sporta-admin-knet', A >= 0 ? SRC.slice(0, A) + SRC.slice(B) : SRC)
const ON_CSS = generated('sporta-admin-knet', SRC)
// ADMIN_ADDON=<path under sporta-web> runs the same checks on another copy of the add-on (the trim release file).
const JS = readFileSync(join(ROOT, process.env.ADMIN_ADDON || 'public/sporta-admin-brands.js'), 'utf8')
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const cutAt = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), cutAt), DARK_ADMIN = DARK.slice(cutAt)

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
// [BC-03] Windows High Contrast drops the box-shadow focus ring, so the field focus rule needs a forced-colours outline.
head('forced colours')
is(/@media \(forced-colors: active\)\s*\{\s*\.admin-shell [\s\S]*?outline:\s*2px solid Highlight !important/.test(SRC), '[BC-03] a focused field keeps a 2px outline in forced colours (the box-shadow ring is dropped there)')

const classes = [...new Set([...BODY_HTML.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'x.css') })).css
const ORIGIN = 'https://admin.test'
const SHAPE = { knet: { installed: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm', response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result', has_tranportal_id: true, has_tranportal_password: true, has_resource_key: true, credentials: {} }, tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com/cbkgateway', production_base: 'https://pg.cbk.com/cbkgateway', return_url: 'https://www.sporta.com.kw/pay/return', result_page_url: 'https://www.sporta.com.kw/payment/result', has_client_id: true, has_client_secret: true, has_encrp_key: false } }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
async function measure(lang, w, css, dark = false, longLabel = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
  const p = await ctx.newPage(); const rtl = lang === 'ar'
  await p.route(`${ORIGIN}/backends`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"${dark ? ' class="dark" data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=${w},initial-scale=1"><style>${TW}</style><style>${LIVE}</style>${dark ? `<style>${DARK_INDEX}</style>` : ''}<style>${css}</style>${dark ? `<style>${DARK_ADMIN}</style>` : ''}</head><body style="margin:0"><div id="root">${BODY_HTML}</div><script src="${ORIGIN}/addon.js"></script></body></html>` }))
  await p.route(`${ORIGIN}/addon.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: JS }))
  await p.route(`${ORIGIN}/api/admin.php**`, (r) => {
    const route = new URL(r.request().url()).searchParams.get('r'); const j = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
    if (route === 'payment_config') return j(SHAPE)
    if (route === 'payment_identifiers') return j({ env: 'test', test: { merchant_id: '6261', terminal_id: '626101' }, production: { merchant_id: '', terminal_id: '' } })
    if (route === 'payment_server_ips') return j({ server_ip_1: '187.7.78.123', server_ip_2: '' })
    if (route === 'payment_knet_via_cbk') return j({ enabled: false, tpay_ready: true })
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
  })
  await p.goto(`${ORIGIN}/backends`); await p.waitForSelector('[data-sporta-cbk]', { timeout: 15000 }).catch(() => null); await p.waitForTimeout(400)
  // The address fields with one correct value are folded into a summary (PAYMENTS TRIM, test:admin-trim). [kp-4] measures the
  // grid's rows with every field laid out, so open them first ("Show fields"), as an operator editing them would.
  await p.evaluate(() => { const b = document.querySelector('[data-sporta-fixed="cbk"] button'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click() }); await p.waitForTimeout(100)
  if (longLabel) await p.evaluate(() => { const l = [...document.querySelectorAll('[data-sporta-cbk] label > span')].find((s) => /ENCRP_KEY/.test(s.textContent)); if (l) l.firstChild.nodeValue = 'Encrypted Account Key (ENCRP_KEY) with a long explanatory name that has to wrap onto a second line ' })
  const m = await p.evaluate(() => {
    const q = (s) => document.querySelector(s), r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
    const cs = (e, pe) => getComputedStyle(e, pe)
    const card = q('section.payment-gateway-card:not([data-sporta-tpay-retired])'), form = q('form.payment-gateway-editor:not([data-sporta-tpay-retired])')
    const cbk = q('[data-sporta-cbk]'), ids = q('[data-sporta-knet-ids]')
    const panel = (e) => e && ({ border: cs(e).borderTopWidth + ' ' + cs(e).borderTopColor, radius: cs(e).borderTopLeftRadius, bg: cs(e).backgroundColor, pad: cs(e).paddingTop })
    const btn = (e) => { const b = e && [...e.querySelectorAll('button')].find((x) => /Save|حفظ/.test(x.textContent)); return b && ({ bg: cs(b).backgroundColor, color: cs(b).color, border: cs(b).borderTopColor }) }
    const cbkGrid = cbk && cbk.querySelector('.grid')
    const rows = []
    if (cbkGrid && cs(cbkGrid).gridTemplateColumns.split(' ').length === 2) {
      const kids = [...cbkGrid.children]; let i = 0
      while (i < kids.length) { const span2 = cs(kids[i]).gridColumnEnd === 'span 2'; if (span2 || i === kids.length - 1) { i++; continue } rows.push([kids[i], kids[i + 1]]); i += 2 }
    }
    const inp = (l) => l.querySelector('input')
    const inputs = [...document.querySelectorAll('form.payment-gateway-editor:not([data-sporta-tpay-retired]) input:not([type=checkbox])')]
    const ph = inputs.find((i) => i.placeholder && /Leave blank|اتركه فارغ/.test(i.placeholder))
    return {
      vw: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
      card: card && r(card), form: form && r(form), settings: r(q('.payment-settings')),
      retired: [...document.querySelectorAll('[data-sporta-tpay-retired]')].filter((e) => cs(e).display !== 'none' && !e.matches('option')).length, retiredN: document.querySelectorAll('[data-sporta-tpay-retired]').length,
      cbk: panel(cbk), ids: panel(ids), cbkBtn: btn(cbk), idsBtn: btn(ids), formBtn: (() => { const b = [...form.querySelectorAll(':scope > div button')].find((x) => /Save KNET/.test(x.textContent)); return b && cs(b).backgroundColor })(),
      states: [...cbk.querySelectorAll('.payment-secret-field__state')].map((s) => cs(s).color),
      misaligned: rows.filter(([a, b]) => Math.abs(r(inp(a)).b - r(inp(b)).b) > 1).length, rowsN: rows.length,
      phFont: ph && cs(ph, '::placeholder').fontFamily, phSize: ph && cs(ph, '::placeholder').fontSize, ellipsis: inputs.filter((i) => cs(i).textOverflow !== 'ellipsis').length, inputsN: inputs.length,
      urlCut: inputs.filter((i) => i.type === 'text' && /^https:/.test(i.value) && i.scrollWidth > i.clientWidth + 1).map((i) => i.value.slice(8, 24)),
    }
  })
  await ctx.close(); return m
}
const near = (a, b, t = 1) => Math.abs(a - b) <= t
const REM = 16

for (const lang of ['en', 'ar']) {
  for (const w of [390, 768, 1024, 1280, 1440]) {
    head(`${lang} ${w}px`)
    const off = await measure(lang, w, OFF_CSS), on = await measure(lang, w, ON_CSS)
    is(on.retiredN >= 2 && on.retired === 0, 'the script retired the T-Pay card and form and they stay hidden', `retired ${on.retiredN}, visible ${on.retired}`)
    is(on.overflow <= 0, 'no sideways scroll', `overflow ${on.overflow}`)
    // [kp-1]
    is(on.form.w <= 56 * REM + 1, '[kp-1] the editor is never wider than 56rem', `${on.form.w.toFixed(0)}`)
    is(near(on.card.w, on.form.w), '[kp-1] the KNET card and the KNET editor are the same width', `card ${on.card.w.toFixed(0)} editor ${on.form.w.toFixed(0)}`)
    if (w >= 1024 && w < 1280) is(!near(off.card.w, off.form.w, 20), '[kp-1] add-on off: the card was half the width of the editor under it (the live defect)', `card ${off.card.w.toFixed(0)} editor ${off.form.w.toFixed(0)}`)
    if (w >= 1280) is(off.form.w < off.settings.w * 0.55, '[kp-1] add-on off: the editor was one half of the screen, the other half empty (the live defect)', `editor ${off.form.w.toFixed(0)} of ${off.settings.w.toFixed(0)}`)
    if (w >= 1280) is(on.form.w > off.form.w + 100, '[kp-1] the editor is far wider than the half column it had', `${off.form.w.toFixed(0)} -> ${on.form.w.toFixed(0)}`)
    if (w < 1024) is(near(on.form.w, off.form.w) && near(on.card.w, off.card.w), '[kp-1] under 1024px nothing changed (it was one column already)', `${off.form.w.toFixed(0)}/${on.form.w.toFixed(0)}`)
    // [kp-2]
    is(JSON.stringify(on.cbk) === JSON.stringify(on.ids) && on.cbk.border === '1px rgb(217, 223, 229)' && on.cbk.radius === '14px' && on.cbk.bg === 'rgb(251, 252, 253)', '[kp-2] the CBK block is a panel exactly like the Merchant ID panel', `${JSON.stringify(on.cbk)} vs ${JSON.stringify(on.ids)}`)
    is(JSON.stringify(on.cbkBtn) === JSON.stringify(on.idsBtn) && on.cbkBtn.bg === 'rgb(255, 255, 255)' && on.formBtn !== 'rgb(255, 255, 255)', '[kp-2] its save button is the quiet outlined one, the form\'s own save stays filled', `${JSON.stringify(on.cbkBtn)} / form ${on.formBtn}`)
    is(JSON.stringify(off.cbk) !== JSON.stringify(off.ids), '[kp-2] add-on off: it was not a panel (the live defect)', JSON.stringify(off.cbk))
    // [kp-3]
    is(on.states.length >= 3 && on.states.every((c) => c === 'rgb(51, 65, 85)'), '[kp-3] the Saved / Not set labels are slate, not indigo', on.states.join(' '))
    is(off.states.every((c) => c === 'rgb(67, 56, 202)'), '[kp-3] add-on off: they were indigo (the live defect)', off.states.join(' '))
    // [kp-4]
    if (w >= 768) {
      is(on.rowsN >= 3 && on.misaligned === 0, '[kp-4] the fields of every row end on one line', `${on.misaligned} of ${on.rowsN} rows misaligned`)
      const lo = await measure(lang, w, OFF_CSS, false, true), ln = await measure(lang, w, ON_CSS, false, true)
      is(lo.misaligned > 0 && ln.misaligned === 0, '[kp-4] with a long label that wraps: misaligned without the rule, aligned with it', `off ${lo.misaligned}, on ${ln.misaligned}`)
    }
    // [kp-5]
    is(on.phFont && !/mono/i.test(on.phFont) && on.phSize === '13px', '[kp-5] a placeholder is set in the UI font at 13px', `${on.phFont} ${on.phSize}`)
    is(/mono/i.test(off.phFont || ''), '[kp-5] add-on off: it was monospace (the live defect)', off.phFont)
    is(on.ellipsis === 0, '[kp-5] every editor field ends an overflowing value in an ellipsis', `${on.ellipsis} of ${on.inputsN} do not`)
    if (w >= 1280) is(on.urlCut.length < off.urlCut.length || off.urlCut.length === 0, '[kp-5]/[kp-1] fewer URL values cut off than before', `${off.urlCut.length} -> ${on.urlCut.length}`)
  }
}
// light only: a dark device must see the same panel
for (const w of [390, 1280]) {
  head(`dark device, ${w}px`)
  const d = await measure('en', w, ON_CSS, true)
  is(d.cbk.border === '1px rgb(217, 223, 229)' && d.cbk.bg === 'rgb(251, 252, 253)' && d.cbkBtn.bg === 'rgb(255, 255, 255)' && d.states.every((c) => c === 'rgb(51, 65, 85)'), 'the CBK panel, its button and its labels stay light under the live dark rules', JSON.stringify({ cbk: d.cbk, btn: d.cbkBtn, st: d.states }))
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
