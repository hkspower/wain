// The Shipping panel (block "ADMIN SHIPPING", public/sporta-admin-brands.js) in a real browser.
//
//   npm run test:admin-shipping   (rig-free: the page is the CAPTURED live admin's Settings screen (scripts/fixtures/sizes-admin/settings.html)
//                                  under the live rules and the add-on sheets; the admin API is a fake answered by route interception, shaped
//                                  like admin.php shipping / shipping_save / shipping_preview (the shapes store.php returns, proved by
//                                  test:native); the REAL add-on file runs on it)
//
// What is asserted:
//   - the block: markers once, no markup injection, no storage, no third-party host, three routes only, every CSS rule scoped,
//     idempotent, starts on /backends only;
//   - the entry: one "Shipping" button in the header of Settings, 44 px, not on other screens, nothing read before it is pressed;
//   - load: GET shipping once; the form shows the server's numbers (fils as KWD), open/closed zones, own fees, times;
//   - the preview: the rows are the SERVER's answer (a fake fee the browser could not have computed is shown as sent), the draft is what is
//     sent, the threshold rows appear only with a threshold, an invalid box asks nothing and says why;
//   - save: the body is whole fils (Arabic-Indic digits and a comma read right), the version loaded is sent back, X-Sporta-Admin and JSON;
//     an invalid box sends nothing; all six off sends nothing; 409 / 400 tokens / 401 / 404 / a dead network are each worded;
//   - the save bar can mirror it: a real submit button labelled "Save ..." in a form with many fields;
//   - hostile data (markup in a time text) stays text; 390 / 1280 px, English and Arabic, light and dark: no sideways scroll, 44 px targets,
//     contrast 4.5:1 for the panel's text;
//   - MUTATION CHECK: with the block cut out there is no button; and four mutants of the block (no version sent, a fils parser off by a digit,
//     the server's preview ignored, the switch not read) each fail the checks that guard them.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN SHIPPING - begin')
const END = BRANDS_JS.indexOf('/* ===== ADMIN SHIPPING - end')
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN SHIPPING block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const BLOCK = BRANDS_JS.slice(BEGIN, BRANDS_JS.indexOf('\n', END) < 0 ? BRANDS_JS.length : BRANDS_JS.indexOf('\n', END))
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
const cut = (js) => js.slice(0, BEGIN) + js.slice(BEGIN + BLOCK.length)
const mutate = (from, to) => { if (!BRANDS_JS.includes(from)) { console.log('FAIL mutant source not found: ' + from); process.exit(1) } return BRANDS_JS.replace(from, to) }
const MUTANTS = {
  'no version': mutate("body.v = typeof S.doc.v === 'number' ? S.doc.v : 0", 'body.v = null'),
  'fils parser': mutate('parseInt(frac.slice(0, 3), 10)', 'parseInt(frac.slice(0, 2), 10)'),
  'preview ignored': mutate("if (r.ok && r.body && Array.isArray(r.body.samples)) drawPreview(r.body.samples, '')", "if (r.ok && r.body && Array.isArray(r.body.samples)) drawPreview([], '')"),
  'switch not read': mutate('zones[g] = { enabled: z.on.checked,', 'zones[g] = { enabled: true,'),
}

let pass = 0, fail = 0, quiet = false, tally = []
const is = (ok, msg, detail = '') => { tally.push(!!ok); if (ok) { pass++; if (!quiet) console.log('ok   ' + msg) } else { fail++; if (!quiet) console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ORIGIN = 'https://www.sporta.com.kw'
const GOVS = ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra']

// ------------------------------------------------------------------------------------------------ the fake server
const DOC = () => ({
  v: 3, configured: true, flat_fee_fils: 1000, free_over_fils: 25000,
  zones: Object.fromEntries(GOVS.map((g) => [g, { enabled: g !== 'ahmadi', fee_fils: g === 'jahra' ? 2000 : null, time_en: g === 'jahra' ? '1-2 days' : '', time_ar: g === 'jahra' ? 'خلال يومين' : '' }])),
  governorates: GOVS, limits: { fee_fils: 100000, free_over_fils: 10000000, time: 120 }, express: false,
})
function makeWorld() { return { calls: [], doc: DOC(), next: {}, drop: false, odd: false } }
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
function handler(W, shellHtml) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (p === '/backends' || p.startsWith('/backends/')) return route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      if (r.startsWith('shipping')) W.calls.push({ method, route: r, headers: req.headers(), body: req.postData() })
      if (W.drop && r.startsWith('shipping')) return route.abort('failed')
      const n = W.next[r]
      if (n) { W.next[r] = null; return json(route, n.status, n.body) }
      if (r === 'shipping' && method === 'GET') return json(route, 200, W.doc)
      if (r === 'shipping_save' && method === 'POST') {
        const b = JSON.parse(req.postData() || '{}')
        W.doc = { ...W.doc, v: W.doc.v + 1, flat_fee_fils: b.flat_fee_fils, free_over_fils: b.free_over_fils, zones: b.zones }
        return json(route, 200, W.doc)
      }
      if (r === 'shipping_preview' && method === 'POST') {
        const b = JSON.parse(req.postData() || '{}'), s = b.settings
        // the server's rule (store_shipping_fee_for); W.odd answers a fee no browser rule would give, to prove the rows are the answer
        return json(route, 200, { samples: b.samples.map((x) => {
          const z = s.zones[x.governorate], free = s.free_over_fils > 0 && x.goods_fils >= s.free_over_fils
          const fee = W.odd ? 777 : free ? 0 : (z.fee_fils ?? s.flat_fee_fils)
          return { goods_fils: x.goods_fils, governorate: x.governorate, fee_fils: fee, total_fils: x.goods_fils + fee, free: W.odd ? false : free, available: z.enabled }
        }) })
      }
      return json(route, 404, { error: 'not_found' })
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const pageErrors = []
const SEL = { btn: '[data-sporta-ship-btn]', panel: 'section.ssh' }
async function open(W, { w = 1280, h = 900, rtl = false, dark = false, js = BRANDS_JS, name = 'settings', wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800 })
  await ctx.route(ORIGIN + '/**', handler(W, fixturePage(name, FILES, { rtl, dark })))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  await pg.goto(ORIGIN + '/backends/settings')
  await pg.addScriptTag({ content: js })
  if (wait) await pg.waitForSelector(SEL.btn, { timeout: 4000 }).catch(() => {})
  pg.__ctx = ctx; pg.__W = W
  return pg
}
const close = (pg) => pg.__ctx.close()
async function openPanel(pg) {
  await pg.click(SEL.btn)
  await pg.waitForSelector(SEL.panel + ':not([hidden])')
  await pg.waitForFunction(() => { const f = document.querySelector('.ssh-form'); return (f && !f.hidden && document.querySelector('input[name="ssh_base"]').value) || document.querySelector('.ssh-status[data-bad]') }, null, { timeout: 4000 }).catch(() => {})
  await pg.waitForTimeout(150)
}
const settle = (pg) => pg.waitForTimeout(650)   // the preview waits 400 ms after the last key
const status = (pg) => pg.evaluate(() => document.querySelector('.ssh-status').textContent)
const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll('.ssh-table tbody tr')].map((r) => [r.dataset.gov, ...[...r.cells].map((c) => c.textContent)]))
const calls = (W, route) => W.calls.filter((c) => c.route === route)
const lastBody = (W, route) => { const c = calls(W, route).at(-1); return c ? JSON.parse(c.body) : null }

// ================================================================================================ the core checks (also run on each mutant)
async function core(js) {
  // load + fill
  const W = makeWorld(), pg = await open(W, { js })
  const hasBtn = (await pg.locator(SEL.btn).count()) === 1
  is(hasBtn, 'one "Shipping" button on the Settings screen')
  if (!hasBtn) { await close(pg); return }
  await openPanel(pg)
  const form = await pg.evaluate(() => ({
    base: document.querySelector('input[name="ssh_base"]').value, free: document.querySelector('input[name="ssh_free"]').value,
    on: [...document.querySelectorAll('.ssh-zone')].map((z) => [z.dataset.zone, z.querySelector('input[type=checkbox]').checked, z.querySelector('input[name^="ssh_fee_"]').value]),
    jt: [document.querySelector('input[name="ssh_en_jahra"]').value, document.querySelector('input[name="ssh_ar_jahra"]').value],
  }))
  is(form.base === '1.000' && form.free === '25.000', 'the fees are the server\'s, shown as KWD (1000 fils = 1.000)', JSON.stringify(form))
  is(form.on.length === 6 && form.on.find((z) => z[0] === 'ahmadi')[1] === false && form.on.find((z) => z[0] === 'jahra')[2] === '2.000' && form.on.find((z) => z[0] === 'hawalli')[2] === '', 'six governorates: Ahmadi off, Jahra its own 2.000, the rest empty (= base)', JSON.stringify(form.on))
  is(same(form.jt, ['1-2 days', 'خلال يومين']), 'the delivery times are filled in both languages')
  await settle(pg)
  // the preview
  const pv = lastBody(W, 'shipping_preview')
  is(!!pv && pv.settings.flat_fee_fils === 1000 && pv.samples.length === 8 && pv.samples.at(-1).goods_fils === 25000 && pv.samples.at(-2).goods_fils === 24999, 'the preview sends the draft and 6 + 2 samples (one fil under the threshold, and exactly at it)', JSON.stringify(pv?.samples?.slice(-2)))
  const r1 = await rows(pg)
  is(r1.length === 8 && same(r1.find((r) => r[0] === 'jahra'), ['jahra', 'Jahra · الجهراء', '10.000', '2.000', '12.000']) && /No delivery/.test(r1.find((r) => r[0] === 'ahmadi').join()) && r1.at(-1)[3].startsWith('Free'), 'the table shows the server\'s rows: Jahra 2.000, Ahmadi no delivery, free at the threshold', JSON.stringify(r1))
  W.odd = true
  await pg.fill('input[name="ssh_goods"]', '5'); await settle(pg)
  const r2 = await rows(pg)
  is(r2.length && r2[0][3] === '0.777' && r2[0][4] === '5.777', 'a fee the browser could not have computed is shown exactly as the server sent it (no math in the page)', JSON.stringify(r2[0]))
  W.odd = false
  // save: whole fils, version, header
  await pg.fill('input[name="ssh_base"]', '١٫٢٥')
  await pg.fill('input[name="ssh_fee_capital"]', '0,5')
  await pg.uncheck('input[name="ssh_on_farwaniya"]')
  await pg.fill('input[name="ssh_en_capital"]', 'Same day')
  await settle(pg)
  is(/Changes not saved/.test(await pg.evaluate(() => document.querySelector('.ssh-dirty').textContent)), 'an edit says "Changes not saved yet"')
  await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(300)
  const sb = lastBody(W, 'shipping_save'), sc = calls(W, 'shipping_save').at(-1)
  is(!!sb && sb.flat_fee_fils === 1250 && sb.zones.capital.fee_fils === 500 && sb.zones.hawalli.fee_fils === null && sb.free_over_fils === 25000, 'Save sends whole fils: "١٫٢٥" is 1250, "0,5" is 500, empty is null', JSON.stringify(sb && { b: sb.flat_fee_fils, c: sb.zones.capital.fee_fils }))
  is(!!sb && sb.v === 3, 'and sends back the version it loaded (v3)', String(sb?.v))
  is(!!sb && sb.zones.farwaniya.enabled === false && sb.zones.ahmadi.enabled === false && sb.zones.capital.enabled === true && sb.zones.capital.time_en === 'Same day', 'the switches and the times are sent as set', JSON.stringify(sb?.zones?.farwaniya))
  is(!!sc && sc.headers['x-sporta-admin'] === '1' && /application\/json/.test(sc.headers['content-type'] || ''), 'with X-Sporta-Admin and a JSON body')
  is(/Saved/.test(await status(pg)) && /Everything is saved/.test(await pg.evaluate(() => document.querySelector('.ssh-dirty').textContent)), 'the answer becomes the new baseline: "Saved", "Everything is saved"')
  await pg.fill('input[name="ssh_free"]', '30'); await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(300)
  is(lastBody(W, 'shipping_save')?.v === 4, 'the next save sends the version the last save returned (v4)', String(lastBody(W, 'shipping_save')?.v))
  await close(pg)
}

head('the block')
{
  is(!/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\beval\(|new Function\(|DOMParser/.test(CODE), 'no markup injection, no eval')
  is(!/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(CODE), 'no browser storage and no cookie is touched')
  is(!/https?:\/\//.test(CODE) && !/XMLHttpRequest|sendBeacon|WebSocket|window\.open/.test(CODE), 'no web address, beacon, socket or pop-up')
  const routes = [...CODE.matchAll(/request\('([a-z_]+)'/g)].map((m) => m[1])
  is(same([...new Set(routes)].sort(), ['shipping', 'shipping_preview', 'shipping_save']), 'the only routes named are shipping, shipping_save and shipping_preview', routes.join())
  is((CODE.match(/\bfetch\(/g) || []).length === 1 && /'X-Sporta-Admin': '1'/.test(CODE) && /credentials: 'same-origin'/.test(CODE), 'one fetch call, always with X-Sporta-Admin and the session cookie')
  is(!/toFixed|parseFloat|\*\s*0?\.001|Math\.round\([^)]*\*/.test(CODE), 'no price arithmetic: amounts are read as text into whole fils (no float, no rounding of a product)')
  const cssSrc = CODE.slice(CODE.indexOf('var CSS = ['), CODE.indexOf("].join('\\n')", CODE.indexOf('var CSS = [')))
  const css = new Function('OPEN', 'PAGE', cssSrc.replace('var CSS = ', 'return ') + '].join("\\n")')('data-sporta-ship-state', 'data-sporta-ship')
  const sels = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith('@')).flatMap((x) => x.split(/,(?![^(]*\))/).map((y) => y.trim()))
  const rogue = sels.filter((x) => !/^(\.ssh(?![A-Za-z])|\.ssh-|:is\(html\.dark,html\[data-theme="dark"\]\) \.ssh|body\[data-sporta-ship-state="open"\] main\.admin-content>section\.admin-page:not\(\[data-sporta-ship\]\)$)/.test(x))
  is(sels.length > 40 && rogue.length === 0, `all ${sels.length} rules are scoped to .ssh / .ssh-open or the body switch`, rogue.slice(0, 3).join(' | '))
  is(!/payment-settings/.test(css), 'no rule names the Payments screen (it stays light-only)')
  is((BRANDS_JS.match(/ADMIN SHIPPING - begin/g) || []).length === 1, 'the block appears once')
  is(BLOCK.includes("if (location.pathname.indexOf('/backends') !== 0) return") && BLOCK.includes('if (window.__sportaShipping) return'), 'it starts on /backends only and is idempotent')
  is(/Express delivery/.test(BLOCK) && /Not available yet/.test(BLOCK), 'the panel says express delivery is not offered, and why')
}

head('the entry button')
{
  const W = makeWorld(), pg = await open(W)
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-ship-btn]'); return !!b && !!b.closest('.admin-page-header') && b.closest('.admin-page').querySelector('h1').textContent.trim() === 'Settings' }), 'it sits in the header of Settings')
  is((await pg.evaluate(() => document.querySelector('[data-sporta-ship-btn]').getBoundingClientRect().height)) >= 43.5, 'it is 44 px tall')
  await pg.waitForTimeout(700)
  is(W.calls.length === 0, 'nothing is read before it is pressed')
  await pg.addScriptTag({ content: BRANDS_JS }); await pg.waitForTimeout(700)
  is((await pg.locator(SEL.btn).count()) === 1, 'the file evaluated twice still adds one button')
  await openPanel(pg)
  is(same(W.calls.map((c) => c.route + ':' + c.method).slice(0, 1), ['shipping:GET']) && calls(W, 'shipping').length === 1, 'opening reads GET shipping once')
  is(await pg.evaluate(() => document.body.getAttribute('data-sporta-ship-state') === 'open' && getComputedStyle(document.querySelector('main.admin-content > section.admin-page:not([data-sporta-ship])')).display === 'none' && document.activeElement === document.getElementById('ssh-title')), 'the screen behind is hidden and the title has the focus')
  await pg.click('.ssh-head .ssh-btn'); await pg.waitForTimeout(200)
  is(await pg.evaluate(() => !document.body.hasAttribute('data-sporta-ship-state') && document.querySelector('section.ssh').hidden && document.activeElement === document.querySelector('[data-sporta-ship-btn]')), '"Back" closes it and gives the focus back to the button')
  await pg.click(SEL.btn); await pg.waitForSelector(SEL.panel + ':not([hidden])')
  await pg.click('.admin-sidebar .admin-nav-item >> nth=0'); await pg.waitForTimeout(200)
  is(await pg.evaluate(() => !document.body.hasAttribute('data-sporta-ship-state')), 'any click on the menu closes it')
  is(calls(W, 'shipping').length === 1, 'reopening does not read again (the loaded setup is kept)')
  await close(pg)
  const ov = await open(makeWorld(), { name: 'overview', wait: false }); await ov.waitForTimeout(900)
  is((await ov.locator(SEL.btn).count()) === 0, 'the Overview screen has no button')
  await close(ov)
}

head('load, preview and save')
await core(BRANDS_JS)

head('the save bar')
{
  const pg = await open(makeWorld()); await openPanel(pg)
  const sv = await pg.evaluate(() => { const b = document.querySelector('.ssh-foot button[type=submit]'); return { label: b.textContent, form: b.form && b.form.querySelectorAll('input,select').length } })
  is(/^Save /.test(sv.label) && sv.form >= 3, 'Save is a submit button labelled "Save ..." in a form with many fields, so the save bar mirrors it', JSON.stringify(sv))
  await pg.setViewportSize({ width: 390, height: 700 }); await pg.waitForTimeout(900)
  is(await pg.evaluate(() => { const bar = document.querySelector('[data-sporta-savebar]'); return !!bar && /Save shipping/.test(bar.textContent) }), 'and at 390 px, with Save out of view, the save bar shows "Save shipping"')
  await close(pg)
}

head('refusals and failures')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg)
  const saves = () => calls(W, 'shipping_save').length
  let n = saves()
  await pg.fill('input[name="ssh_base"]', 'abc'); await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(200)
  is(saves() === n && /Base fee/.test(await status(pg)) && await pg.evaluate(() => document.activeElement.name === 'ssh_base'), 'a base fee that is not an amount sends nothing, says why and focuses the box')
  await settle(pg)
  is(/Base fee/.test(await pg.evaluate(() => document.querySelector('.ssh-pnote').textContent)) && (await rows(pg)).length === 0, 'and the preview asks nothing for it and says why')
  await pg.fill('input[name="ssh_base"]', '101'); await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(200)
  is(saves() === n, 'a base fee over 100 KWD sends nothing')
  await pg.fill('input[name="ssh_base"]', '1.2345'); await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(200)
  is(saves() === n, 'four decimals (a quarter of a fil) sends nothing')
  await pg.fill('input[name="ssh_base"]', '1')
  for (const g of GOVS) await pg.uncheck(`input[name="ssh_on_${g}"]`)
  await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(200)
  is(saves() === n && /At least one governorate/.test(await status(pg)), 'all six switched off sends nothing and says one must take deliveries')
  await pg.check('input[name="ssh_on_capital"]')
  const tries = [
    [409, 'shipping_changed', /another window/], [400, 'price_in_shipping_time_ar', /Arabic delivery time cannot contain a price/],
    [400, 'invalid_shipping_zone_fee', /governorate fee/], [401, 'not_signed_in', /sign-in has ended/], [429, 'rate_limited', /Too many/],
    [500, 'weird<b>', /HTTP 500/],
  ]
  for (const [st, tok, re] of tries) {
    W.next.shipping_save = { status: st, body: { error: tok } }
    await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(250)
    is(re.test(await status(pg)) && await pg.evaluate(() => document.querySelector('.ssh-status').getAttribute('data-bad') === '1'), `a ${st} ${tok} is worded`, await status(pg))
  }
  W.drop = true
  await pg.click('.ssh-foot button[type=submit]'); await pg.waitForTimeout(250)
  is(/Could not reach the server/.test(await status(pg)), 'a dead network is worded')
  W.drop = false
  await close(pg)
  const W2 = makeWorld(); W2.next.shipping = { status: 404, body: { error: 'not_found' } }
  const p2 = await open(W2); await openPanel(p2)
  is(/not available until the next update/.test(await status(p2)) && await p2.evaluate(() => document.querySelector('.ssh-form').hidden), 'a server without the route (404): the panel says so and shows no form')
  await p2.waitForTimeout(700)
  is(calls(W2, 'shipping_preview').length === 0 && calls(W2, 'shipping_save').length === 0, 'and sends nothing else')
  await close(p2)
}

head('hostile data')
{
  const W = makeWorld()
  W.doc.zones.jahra.time_en = '<img src=x onerror="window.__pwned=1">'
  W.doc.zones.capital.time_ar = '"><script>window.__pwned=1</script>'
  const pg = await open(W); await openPanel(pg); await settle(pg)
  is(await pg.evaluate(() => !window.__pwned && !document.querySelector('section.ssh img, section.ssh script') && document.querySelector('input[name="ssh_en_jahra"]').value.startsWith('<img')), 'markup in a saved time text is a value in a box, nothing runs')
  is(await pg.evaluate(() => [...document.querySelectorAll('section.ssh *')].every((e) => [...e.attributes].every((a) => !/^on/i.test(a.name)))), 'no on* attribute anywhere in the panel')
  is(!/NaN|undefined|\[object/.test(await pg.evaluate(() => document.querySelector('section.ssh').textContent)), 'no "NaN", "undefined" or "[object" on screen')
  await close(pg)
}

head('layout: widths, languages, themes')
const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
for (const [w, rtl, dark] of [[390, false, false], [390, true, true], [1280, false, true], [1280, true, false]]) {
  const tag = `${w}px ${rtl ? 'ar' : 'en'} ${dark ? 'dark' : 'light'}`
  const pg = await open(makeWorld(), { w, h: 800, rtl, dark }); await openPanel(pg); await settle(pg)
  const m = await pg.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number)
    const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c.slice(0, 3) } return [255, 255, 255] }
    const panel = document.querySelector('section.ssh'), small = [], pairs = []
    for (const e of panel.querySelectorAll('button, input, select')) { const r = e.getBoundingClientRect(); if (r.width && e.type !== 'checkbox' && r.height < 43.5) small.push(e.name || e.textContent.slice(0, 20)) }
    for (const e of panel.querySelectorAll('label.ssh-check')) { const r = e.getBoundingClientRect(); if (r.height < 43.5) small.push('check ' + e.textContent.slice(0, 20)) }
    for (const e of panel.querySelectorAll('h1, h2, h3, p, .ssh-lab, td, th, .ssh-check, .ssh-dirty')) { if (!e.getBoundingClientRect().width || !e.textContent.trim()) continue; pairs.push([e.className || e.tagName, rgb(getComputedStyle(e).color).slice(0, 3), bgOf(e)]) }
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, pairs, dark: getComputedStyle(panel).colorScheme }
  })
  is(m.over <= 0, `${tag}: no sideways scroll`, String(m.over))
  is(m.small.length === 0, `${tag}: every control is 44 px or taller`, m.small.slice(0, 4).join(', '))
  const low = m.pairs.filter(([, f, b]) => contrast(f, b) < 4.5).map(([k, f, b]) => `${k} ${contrast(f, b).toFixed(2)}`)
  is(low.length === 0, `${tag}: text contrast is 4.5:1 or better`, [...new Set(low)].slice(0, 4).join(', '))
  if (dark) is(/dark/.test(m.dark), `${tag}: the panel follows the admin's dark theme`, m.dark)
  await close(pg)
}

head('mutation check')
{
  const pg = await open(makeWorld(), { js: cut(BRANDS_JS), wait: false }); await pg.waitForTimeout(1000)
  is((await pg.locator(SEL.btn).count()) === 0 && (await pg.evaluate(() => typeof window.__sportaShipping)) === 'undefined', 'with the block cut out of the file there is no button and no panel: the suite above fails without it')
  is((await pg.evaluate(() => typeof window.__sportaDbCenter)) !== 'undefined', 'the rest of the add-on file still runs without it')
  await close(pg)
  for (const [name, js] of Object.entries(MUTANTS)) {
    const before = tally.length
    quiet = true
    const savedPass = pass, savedFail = fail
    await core(js)
    const failed = tally.slice(before).filter((x) => !x).length
    pass = savedPass; fail = savedFail; tally.length = before; quiet = false
    is(failed > 0, `mutant "${name}": the core checks catch it`, `${failed} failed`)
  }
}

// ================================================================================================ the storefront half (sporta-features.js, SHIPPING)
// The live checkout asks for its quote with {items, code}; the block adds the governorate it knows and changes nothing else. Proven on a
// stand-in checkout (the governorate <select id="f-governorate"> the compiled page renders), with the REAL sporta-features.js.
head('storefront: the quote carries the governorate')
{
  const FEATURES = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
  const SB = FEATURES.indexOf('/* ===== SHIPPING - begin'), SE = FEATURES.indexOf('/* ===== SHIPPING - end')
  is(SB > 0 && SE > SB, 'the SHIPPING block is in public/sporta-features.js')
  const SCODE = FEATURES.slice(SB, SE).replace(/\/\*[\s\S]*?\*\//g, '')
  is(!/innerHTML|insertAdjacentHTML|eval\(|https?:\/\//.test(SCODE) && !/setItem|removeItem/.test(SCODE), 'no markup, no eval, no other host, storage is only read')
  const NO_BLOCK = FEATURES.slice(0, SB) + FEATURES.slice(FEATURES.indexOf('\n', SE))
  const PUBLIC = { base_fee_fils: 1000, base_fee: 1, free_over_fils: 0, free_over: 0, zones: Object.fromEntries(GOVS.map((g) => [g, { enabled: g !== 'ahmadi', fee_fils: g === 'jahra' ? 2000 : 1000, fee: g === 'jahra' ? 2 : 1, time_en: g === 'jahra' ? '1-2 days <b>' : '', time_ar: g === 'jahra' ? 'خلال يومين' : '' }])) }
  const SHOP = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div class="storefront-root"><form><label for="f-governorate">Governorate</label><div><select id="f-governorate"><option value="">Choose</option>${GOVS.map((g) => `<option value="${g}">${g}</option>`).join('')}</select></div></form></div></body></html>`
  async function shop(js, saved) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const seen = { quotes: [], orders: [], shipping: 0 }
    if (saved) await ctx.addInitScript((g) => { try { localStorage.setItem('sporta.delivery', JSON.stringify({ governorate: g })) } catch (e) {} }, saved)
    await ctx.route(ORIGIN + '/**', async (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/checkout') return route.fulfill({ status: 200, contentType: 'text/html', body: SHOP })
      if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'shipping') { seen.shipping++; return json(route, 200, PUBLIC) }
      if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'discount') { seen.quotes.push(route.request().postData()); return json(route, 200, { subtotal: 10, discount: 0, delivery: 1, total: 11, total_fils: 11000, applied: [] }) }
      if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'order') { seen.orders.push(route.request().postData()); return json(route, 409, { error: 'quote_changed', amount: 12, total_fils: 12000 }) }
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '' })
    })
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => pageErrors.push('shop: ' + String(e).slice(0, 160)))
    await pg.goto(ORIGIN + '/checkout')
    await pg.addScriptTag({ content: js })
    await pg.waitForTimeout(300)
    pg.__ctx = ctx; pg.__seen = seen
    return pg
  }
  // the page's own calls, exactly as the compiled backend module makes them
  const quote = (pg) => pg.evaluate(() => fetch('/api/api.php?r=discount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ items: [{ slug: 'x', qty: 1 }], code: '' }) }).then((r) => r.json()))
  const order = (pg, gov) => pg.evaluate((g) => fetch('/api/api.php?r=order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1' }, credentials: 'include', body: JSON.stringify({ track_id: 'ABCDEF12', items: [{ slug: 'x', qty: 1 }], customer: { governorate: g, name: 'n' }, payment_method: 'knet', discount_code: '', expected_total_fils: 11000 }) }).then((r) => r.json()), gov)

  const p1 = await shop(FEATURES)
  await quote(p1)
  is(same(JSON.parse(p1.__seen.quotes[0]), { items: [{ slug: 'x', qty: 1 }], code: '' }), 'no governorate known yet: the quote goes out exactly as the page wrote it')
  await p1.selectOption('#f-governorate', 'jahra'); await p1.waitForTimeout(300)
  await quote(p1)
  is(same(JSON.parse(p1.__seen.quotes[1]), { items: [{ slug: 'x', qty: 1 }], code: '', governorate: 'jahra' }), 'with Jahra picked, the quote carries governorate: "jahra" and nothing else changes', p1.__seen.quotes[1])
  const body = JSON.stringify({ track_id: 'ABCDEF12', items: [{ slug: 'x', qty: 1 }], customer: { governorate: 'jahra', name: 'n' }, payment_method: 'knet', discount_code: '', expected_total_fils: 11000 })
  const ans = await order(p1, 'jahra')
  is(p1.__seen.orders[0] === body && ans.error === 'quote_changed', 'the order request is never changed (byte for byte) and its answer reaches the page untouched', p1.__seen.orders[0])
  const note = await p1.evaluate(() => { const n = document.querySelector('[data-sporta-ship-note]'); return n && { text: n.textContent, inHost: n.parentElement === document.getElementById('f-governorate').parentElement, html: n.innerHTML } })
  is(!!note && note.text === '1-2 days <b>' && note.inHost && !/<b>/.test(note.html.replace(/&lt;b&gt;/, '')), 'under the field: Jahra\'s delivery time, as text', JSON.stringify(note))
  is(await p1.evaluate(() => document.querySelector('#f-governorate option[value="ahmadi"]').disabled && !document.querySelector('#f-governorate option[value="jahra"]').disabled), 'a switched-off governorate is marked disabled in the list, the others are not')
  await p1.evaluate(() => { const s = document.getElementById('f-governorate'); s.value = 'ahmadi'; s.dispatchEvent(new Event('change', { bubbles: true })) }); await p1.waitForTimeout(300)
  is(/do not deliver/.test(await p1.evaluate(() => (document.querySelector('[data-sporta-ship-note]') || {}).textContent || '')) && await p1.evaluate(() => document.querySelector('[data-sporta-ship-note]').getAttribute('role') === 'alert'), 'picking it anyway says the shop does not deliver there (role=alert)')
  is(p1.__seen.shipping === 1, 'the public shipping read is made once', String(p1.__seen.shipping))
  await p1.__ctx.close()

  const p2 = await shop(FEATURES, 'hawalli')
  await quote(p2)
  is(JSON.parse(p2.__seen.quotes[0]).governorate === 'hawalli', 'a saved address (the quick checkout) gives its governorate to the quote')
  await p2.__ctx.close()
  const p3 = await shop(FEATURES, 'not-a-place')
  await quote(p3)
  is(!('governorate' in JSON.parse(p3.__seen.quotes[0])), 'a saved value that is not one of the six is never sent')
  await p3.__ctx.close()

  const m = await shop(NO_BLOCK)
  await m.selectOption('#f-governorate', 'jahra'); await quote(m)
  is(!('governorate' in JSON.parse(m.__seen.quotes[0])) && !(await m.evaluate(() => document.querySelector('[data-sporta-ship-note]'))), 'MUTATION: without the block the quote has no governorate and no note is shown (the checks above fail without it)')
  await m.__ctx.close()
}

is(pageErrors.length === 0, 'no page errors in the whole run', pageErrors.slice(0, 3).join(' ; '))
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
