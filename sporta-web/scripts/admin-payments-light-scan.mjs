// READ-ONLY comparison of the LIVE /backends Payments screen in a light device and a dark device, with or without a
// candidate stylesheet applied on top. The question it answers (owner decision 2026-11-03, "no dark mode for knet"):
// is the Payments screen painted EXACTLY the same in both, and does any part of it paint a dark surface?
//
//   node scripts/admin-payments-light-scan.mjs                                  the page as served (the live add-on)
//   CSS_URL=<raw url of sporta-admin-knet.css> node ...                         the candidate applied on top
//   BLOCK_ADDON=1 node ...                                                      the compiled admin alone
//   W=390 node ...                                                              another width (default 1280)
//
// For every element of the content area that holds the screen it compares, light device against dark device, the
// computed color, background, background-image, four border colours, box-shadow, outline colour, caret and accent colour
// and the ::placeholder colour; it measures the contrast of every text node and field; it lists every element that
// paints a dark surface. Like admin-payments-scan.mjs, every admin API call is answered HERE with made-up data: nothing
// reaches the real admin.php, nothing is saved, no credential is typed. Run it on the VPS in the Playwright image.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const CSS = process.env.CSS_URL ? await (await fetch(process.env.CSS_URL)).text() : ''
const W = Number(process.env.W || 1280)
const off = { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false }
const FAKE = {
  me: { email: 'owner@example.com' },
  payment_config: {
    knet: { installed: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm', response_url: B + '/knet/callback.php', error_url: B + '/knet/callback.php', result_page_url: B + '/payment-result', ...off, credentials: { test: off, production: off } },
    tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: B + '/pay/callback.php', result_page_url: B + '/payment-result', has_client_id: false, has_client_secret: false, has_encrp_key: false },
  },
  payment_status: {
    knet: { installed: true, ready: false, mode: 'test', gateway_host: 'kpaytest.com.kw', checks: { merchant_credentials: false, resource_key: false, return_urls: true, orders_database: true, environment: true } },
    tpay: { installed: true, ready: false, mode: 'test', gateway_host: 'pgtest.cbk.com', checks: { merchant_credentials: false, encrypted_account_key: false, return_urls: true, orders_database: true, environment: true } },
  },
  payment_identifiers: { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } },
  payment_server_ips: { server_ip_1: '', server_ip_2: '' },
  payment_knet_via_cbk: { enabled: false, tpay_ready: false },
}
const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'outlineColor', 'caretColor', 'accentColor', 'textDecorationColor']
const browser = await chromium.launch({ args: ['--no-sandbox'] })
async function measure(scheme) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, locale: 'en-US', colorScheme: scheme })
  const pg = await ctx.newPage()
  await pg.route('**/api/admin.php**', (route) => {
    const r = new URL(route.request().url()).searchParams.get('r') || ''
    const body = route.request().method() === 'GET' && r in FAKE ? FAKE[r] : r === 'me' ? FAKE.me : route.request().method() === 'GET' ? [] : {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  if (process.env.BLOCK_ADDON) await pg.route('**/sporta-admin-knet.css*', (route) => route.abort())
  await pg.goto(B + '/backends', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(900)
  let t = pg.locator('a[href*="payment" i]')
  if ((await t.count()) === 0) t = pg.locator('text=/Payments/i')
  if ((await t.count()) > 0) { await t.first().evaluate((el) => el.click()); await pg.waitForTimeout(2500) }
  if (CSS) { await pg.addStyleTag({ content: CSS }); await pg.waitForTimeout(500) }
  const data = await pg.evaluate((props) => {
    const content = document.querySelector('.payment-settings') && document.querySelector('.payment-settings').closest('.admin-content')
    if (!content) return { error: 'no Payments screen found' }
    const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
    const g = cv.getContext('2d', { willReadFrequently: true })
    const num = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
    const mix = (a, b) => [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1]
    const lm = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const bgOf = (e) => { const L = []; for (let x = e; x; x = x.parentElement) { const c = num(getComputedStyle(x).backgroundColor); if (c[3] > 0) L.push(c); if (c[3] >= 1) break } let col = [255, 255, 255, 1]; for (let i = L.length - 1; i >= 0; i--) col = mix(L[i], col); return col }
    const sig = (e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    const out = { rows: [], low: [], dark: [], probes: 0, scheme: getComputedStyle(document.querySelector('.payment-settings')).colorScheme, html: document.documentElement.className + ' | ' + document.documentElement.dataset.theme }
    for (const e of [content, ...content.querySelectorAll('*')]) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none') continue
      const r = { s: sig(e), p: {} }
      for (const k of props) r.p[k] = cs[k]
      if (e.tagName === 'INPUT') r.p.placeholder = getComputedStyle(e, '::placeholder').color
      out.rows.push(r)
      const bg = num(cs.backgroundColor)
      if (bg[3] > 0.5 && lm(bg) < 0.25 && e.getBoundingClientRect().width > 0) out.dark.push(sig(e) + ' ' + cs.backgroundColor)
      if (cs.visibility === 'hidden' || !e.getBoundingClientRect().width) continue
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
      const list = []
      if (own) list.push([own, cs.color])
      if (e.tagName === 'INPUT' && e.type !== 'checkbox') list.push([e.placeholder || e.value, getComputedStyle(e, '::placeholder').color])
      for (const [label, color] of list) {
        const b = bgOf(e), f = mix(num(color), b)
        const [hi, lo] = [lm(f), lm(b)].sort((x, y) => y - x)
        const ratio = (hi + 0.05) / (lo + 0.05), px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
        const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
        out.probes++
        if (ratio < need) out.low.push(ratio.toFixed(2) + ' ' + sig(e) + ' "' + String(label).slice(0, 24) + '"')
      }
    }
    return out
  }, PROPS)
  await ctx.close()
  return data
}
const L = await measure('light'), D = await measure('dark')
console.log('LIGHTCMP width ' + W + ' | candidate css ' + (CSS ? 'yes (' + CSS.length + ' bytes)' : 'no') + ' | add-on ' + (process.env.BLOCK_ADDON ? 'blocked' : 'as served'))
if (L.error || D.error) { console.log('ERROR ' + (L.error || D.error)); await browser.close(); process.exit(1) }
for (const [n, d] of [['light device', L], ['dark device', D]]) console.log(`${n}: html [${d.html}] screen color-scheme ${d.scheme} | ${d.rows.length} elements | ${d.probes} text/field probes, ${d.low.length} under limit | ${d.dark.length} dark surfaces`)
let nd = 0; const ex = []; const els = new Set()
L.rows.forEach((r, i) => { const q = D.rows[i]; if (!q || q.s !== r.s) { nd++; ex.push('structure differs at ' + i); return } for (const k of Object.keys(r.p)) if (r.p[k] !== q.p[k]) { nd++; els.add(i); if (ex.length < 14) ex.push(`${r.s} ${k}: ${r.p[k]} -> ${q.p[k]}`) } })
console.log(`paint differences dark vs light: ${nd} property differences on ${els.size} of ${L.rows.length} elements`)
ex.forEach((x) => console.log('  ' + x.slice(0, 200)))
D.low.slice(0, 12).forEach((x) => console.log('  under limit (dark): ' + x))
L.low.slice(0, 6).forEach((x) => console.log('  under limit (light): ' + x))
D.dark.slice(0, 12).forEach((x) => console.log('  dark surface (dark device): ' + x))
await browser.close()
