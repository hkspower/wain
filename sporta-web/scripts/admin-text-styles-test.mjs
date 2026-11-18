// The text style editor (block "ADMIN TEXT STYLES", public/sporta-admin-brands.js): a dialog opened from the Settings screen's
// header of the live, compiled admin, where the owner picks the fonts, the text size and the heading weight for each language.
//
//   npm run test:admin-text-styles   (no database, no PHP: the admin API is a fake that behaves like admin.php, answered by route
//                                     interception; the REAL add-on file runs in Chromium)
// The server half is the TEXT STYLE section of scripts/admin-storefront-sync-test.mjs, the storefront half scripts/text-style-test.mjs.
//
// What is asserted:
//   0. static: markers; no interval, observer, HTML sink or console; no web storage; only two kinds of write (text_style, theme);
//   1. the button: one, in the Settings header, none on another screen; nothing is requested until a press;
//   2. opening: three reads; the controls show what is saved; the fonts offered are the two built-in faces and the uploaded ones;
//      the sample follows the size, the weight and the fonts; Save is off until something changes;
//   3. saving the text style only: ONE write, the four numbers; the theme is not touched;
//   4. saving fonts: the theme is read again and written back with its colours, radius and dark switch exactly as read; only the fonts change;
//   5. both: text style first, then the theme; a failed theme write after a good text write says so and keeps only the fonts as unsaved;
//   6. a refused value (the server's error) is shown in words and the theme is not written; a 401 and a 429 say what they are;
//   7. the server without the route (404): the dialog says so and offers nothing to save; a failed read offers "Try again";
//   8. Reset puts the designed look in the controls; closing with unsaved changes asks; Escape closes; focus returns to the button;
//   9. Arabic and right to left; a phone-size screen (no sideways scroll, controls 44px or more);
//  10. MUTATION: without the colours in the theme write, saving the text style when it did not change, or without the close question,
//      the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN TEXT STYLES - begin')
const END = ADDON.indexOf('/* ===== ADMIN TEXT STYLES - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const FONT_ID = 'abcdef0123456789abcd'
const SIZES = [90, 95, 100, 105, 110, 115, 120], WEIGHTS = [0, 600, 700, 800, 900]
const THEME = { brand: '#c76a42', accent: '#99452b', canvas: '#fafafa', radius: '24', dark: true, fonts: { body_en: 'plex', display_en: 'alexandria', body_ar: 'plex', display_ar: 'alexandria' }, font_assets: {} }

const SHELL = (lang, other) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font-family:system-ui,sans-serif}
.admin-page-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
</style></head><body>
<main class="admin-content"><section class="admin-page"><header class="admin-page-header">${other ? '<h1>Catalogue</h1>' : `<h1>${lang === 'ar' ? 'الإعدادات' : 'Settings'}</h1>`}</header><p>screen</p></section></main>
<script src="/sporta-admin-brands.js"></script></body></html>`

// one page: the real add-on, the fake admin API (it behaves like admin.php), every call recorded
async function open(browser, o = {}) {
  const { addon = ADDON, lang = 'en', other = false, viewport = { width: 1280, height: 900 } } = o
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const st = {
    ts: { size_en: 100, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0, ...(o.ts || {}) }, theme: JSON.parse(JSON.stringify(THEME)),
    fonts: [{ id: FONT_ID, name: 'Tajawal Regular', path: `/fonts/custom/${FONT_ID}.woff2`, format: 'woff2', bytes: 20000 }],
    calls: [], posts: [], routeMissing: false, failTheme: false, failTs: null, fail: false, status: null, ...(o.st || {}),
  }
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', async (d) => { st.lastDialog = d.message(); if (st.dialogAnswer === false) await d.dismiss(); else await d.accept() })
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/backends') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SHELL(lang, other) })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: addon })
    if (u.pathname !== '/api/admin.php') return route.fulfill({ status: 404, body: '' })
    const r = u.searchParams.get('r'), method = route.request().method()
    st.calls.push({ method, r })
    const json = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
    if (st.status) return json(st.status, { error: 'x' })
    if (method === 'GET' && r === 'text_style_settings') return st.routeMissing ? json(404, { error: 'not_found' }) : st.fail ? json(500, { error: 'failed' }) : json(200, { ...st.ts, sizes: SIZES, weights: WEIGHTS })
    if (method === 'GET' && r === 'theme_settings') return json(200, st.theme)
    if (method === 'GET' && r === 'font_list') return json(200, st.fonts)
    if (method === 'POST' && r === 'settings_save') {
      const b = JSON.parse(route.request().postData() || '{}')
      st.posts.push(b)
      if (b.name === 'text_style') {
        if (st.failTs) return json(400, { error: st.failTs })
        const v = b.value || {}
        for (const L of ['en', 'ar']) {
          if (!SIZES.includes(v['size_' + L])) return json(400, { error: 'invalid_text_size' })
          if (!WEIGHTS.includes(v['heading_weight_' + L])) return json(400, { error: 'invalid_heading_weight' })
        }
        st.ts = { size_en: v.size_en, size_ar: v.size_ar, heading_weight_en: v.heading_weight_en, heading_weight_ar: v.heading_weight_ar }
        return json(200, st.ts)
      }
      if (b.name === 'theme') {
        if (st.failTheme) return json(500, { error: 'server_error' })
        for (const f of Object.values((b.value || {}).fonts || {})) if (!(f === 'plex' || f === 'alexandria' || f === 'custom:' + FONT_ID)) return json(400, { error: 'invalid_font_choice' })
        st.theme = { ...st.theme, ...b.value }
        return json(200, st.theme)
      }
    }
    return json(404, { error: 'not_found' })
  })
  await page.goto('https://admin.test/backends')
  await page.waitForTimeout(900)
  return { ctx, page, st, errors }
}

const BTN = '[data-sporta-ts-btn]', DLG = '[data-sporta-ts-dialog]'
const openDialog = async (page) => { await page.locator(BTN).click(); await page.waitForSelector(`${DLG} [data-ts="save"]`, { timeout: 5000 }); await page.waitForFunction(() => !document.querySelector('[data-sporta-ts-dialog] form, [data-sporta-ts-dialog] .sts-cards')?.parentElement?.hidden, null, { timeout: 5000 }).catch(() => {}) }
const sel = (L, k) => `${DLG} [data-ts-lang="${L}"] select[data-ts="${k}"]`
const saveBtn = (page) => page.locator(`${DLG} [data-ts="save"]`)
const status = (page) => page.locator(`${DLG} .sts-status`).innerText().then((s) => s.trim())
const val = (page, L, k) => page.locator(sel(L, k)).inputValue()
const optionsOf = (page, L, k) => page.$$eval(sel(L, k) + ' option', (os) => os.map((o) => [o.value, o.textContent, o.selected]))
const posts = (st, name) => st.posts.filter((p) => p.name === name)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })

try {
  // ------------------------------------------------------------------------------------------- 0 static
  head('0. the block')
  is(BEGIN >= 0 && END > BEGIN, 'the block is in public/sporta-admin-brands.js with its begin and end markers')
  is(!/setInterval/.test(CODE), 'no interval in the block (the admin timer count does not change)')
  is(!/MutationObserver|requestAnimationFrame/.test(CODE), 'no observer and no animation-frame scan')
  is(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(CODE), 'no HTML sink, no eval: every text is set with textContent')
  is(!/console\./.test(CODE), 'no console output in the block')
  is(!/localStorage|sessionStorage/.test(CODE), 'no web storage: nothing is kept on the device')
  const writes = [...CODE.matchAll(/request\('([a-z_]+)',\s*\{/g)].map((m) => m[1])
  is(writes.length > 0 && writes.every((w) => w === 'settings_save'), 'the only write route is settings_save', writes.join(','))
  is(/name: 'text_style'/.test(CODE) && /name: 'theme'/.test(CODE) && !/name: '(?!text_style|theme)/.test(CODE), 'and only for the two settings it edits (text_style, theme)')

  // ------------------------------------------------------------------------------------------- 1 the button
  head('1. the button')
  {
    let { ctx, page, st, errors } = await open(browser)
    is((await page.locator(BTN).count()) === 1, 'one button in the Settings header')
    is((await page.locator(BTN).innerText()) === 'Text styles', 'it says "Text styles"')
    is(await page.locator('.admin-page-header').locator(BTN).count() === 1, 'it is inside the page header')
    // (the other blocks of the add-on make their own reads on the Settings screen: the passcode and the AI switch)
    is(!st.calls.some((c) => ['text_style_settings', 'theme_settings', 'font_list', 'settings_save'].includes(c.r)), 'nothing of this editor is requested until the button is pressed', st.calls.map((c) => c.r).join(','))
    is(errors.length === 0, 'no page error', errors.join('|'))
    await ctx.close()
    ;({ ctx, page } = await open(browser, { other: true }))
    is((await page.locator(BTN).count()) === 0, 'none on another screen')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 2 opening
  head('2. opening and reading')
  {
    const { ctx, page, st, errors } = await open(browser, { ts: { size_en: 110, size_ar: 95, heading_weight_en: 900, heading_weight_ar: 600 } })
    await openDialog(page)
    is(['text_style_settings', 'theme_settings', 'font_list'].every((r) => st.calls.some((c) => c.r === r && c.method === 'GET')) && st.calls.every((c) => c.method === 'GET'), 'three reads, no write', st.calls.map((c) => c.method + ' ' + c.r).join(','))
    is((await val(page, 'en', 'size_en')) === '110' && (await val(page, 'ar', 'size_ar')) === '95', 'the sizes are what is saved (110 / 95)')
    is((await val(page, 'en', 'heading_weight_en')) === '900' && (await val(page, 'ar', 'heading_weight_ar')) === '600', 'the heading weights are what is saved (900 / 600)')
    is((await val(page, 'en', 'display_en')) === 'alexandria' && (await val(page, 'en', 'body_en')) === 'plex' && (await val(page, 'ar', 'display_ar')) === 'alexandria', 'the fonts are the theme\'s four choices')
    const opts = await optionsOf(page, 'en', 'display_en')
    is(opts.map((o) => o[0]).join() === `plex,alexandria,custom:${FONT_ID}` && opts[2][1] === 'Tajawal Regular', 'the offer is the two built-in faces and the uploaded font, by its name', JSON.stringify(opts))
    is((await optionsOf(page, 'en', 'size_en')).map((o) => o[0]).join() === SIZES.join(), 'the sizes offered are the server\'s list')
    const w = await optionsOf(page, 'en', 'heading_weight_en')
    is(w.map((o) => o[0]).join() === WEIGHTS.join() && w[0][1] === 'As designed', 'the weights offered are the server\'s list, 0 reading "As designed"', JSON.stringify(w.map((o) => o[1])))
    const prev = await page.$$eval(`${DLG} .sts-prev`, (ps) => ps.map((p) => ({ v: p.style.getPropertyValue('--p'), h: getComputedStyle(p.querySelector('.sts-prev-h')).fontWeight, f: p.querySelector('.sts-prev-h').style.fontFamily, b: p.querySelector('.sts-prev-b').style.fontFamily })))
    is(prev[0].v === '1.1' && prev[1].v === '0.95', 'the samples are scaled by the sizes (1.1 and 0.95)', JSON.stringify(prev.map((p) => p.v)))
    is(prev[0].h === '900' && prev[1].h === '600', 'the sample headings carry the weights', JSON.stringify(prev.map((p) => p.h)))
    is(/Alexandria/.test(prev[0].f) && /Plex/.test(prev[0].b), 'the sample uses the chosen faces', `${prev[0].f} | ${prev[0].b}`)
    is(await saveBtn(page).isDisabled(), 'Save is off while nothing changed')
    is(!(await page.locator(`${DLG} .sts-btn`).filter({ hasText: 'Try again' }).isVisible()), '"Try again" is not shown after a good read (the hidden attribute holds against the button styles)')
    is((await page.locator(`${DLG} .sts-foot`).innerText()).includes('Everything is saved'), 'and the footer says everything is saved')
    is(errors.length === 0, 'no page error (a font file the browser cannot load is not an error)', errors.join('|'))
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 3 text style only
  head('3. saving the sizes and weights')
  {
    const { ctx, page, st } = await open(browser)
    await openDialog(page)
    await page.selectOption(sel('en', 'size_en'), '110')
    is(!(await saveBtn(page).isDisabled()), 'a change turns Save on')
    is((await page.locator(`${DLG} .sts-foot`).innerText()).includes('Unsaved changes'), 'and the footer says so')
    is((await page.$eval(`${DLG} [data-ts-lang="en"] .sts-prev`, (p) => p.style.getPropertyValue('--p'))) === '1.1', 'the English sample grew at once')
    is((await page.$eval(`${DLG} [data-ts-lang="ar"] .sts-prev`, (p) => p.style.getPropertyValue('--p'))) === '1', 'the Arabic sample did not')
    await page.selectOption(sel('ar', 'heading_weight_ar'), '700')
    is((await page.$eval(`${DLG} [data-ts-lang="ar"] .sts-prev-h`, (h) => h.style.fontWeight)) === '700', 'a weight shows in that language\'s sample')
    await saveBtn(page).click()
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    is(st.posts.length === 1 && st.posts[0].name === 'text_style' && JSON.stringify(st.posts[0].value) === JSON.stringify({ size_en: 110, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 700 }),
      'ONE write: the four numbers, nothing else', JSON.stringify(st.posts))
    is(st.calls.filter((c) => c.r === 'theme_settings').length === 1, 'the theme is not re-read when no font changed (only the opening read)')
    is((await status(page)).startsWith('Saved') && (await saveBtn(page).isDisabled()), 'it says Saved and Save is off again')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 4 fonts
  head('4. saving fonts')
  {
    const { ctx, page, st } = await open(browser)
    await openDialog(page)
    await page.selectOption(sel('en', 'display_en'), 'plex')
    await page.selectOption(sel('ar', 'body_ar'), `custom:${FONT_ID}`)
    is((await page.locator(`${DLG} [data-ts-lang="ar"] .sts-note`).first().isVisible()), 'choosing an uploaded font shows the note about its own weights')
    const f = await page.$eval(`${DLG} [data-ts-lang="ar"] .sts-prev-b`, (p) => p.style.fontFamily)
    is(f.includes(`Sporta Uploaded ${FONT_ID}`), 'its sample uses the uploaded face', f)
    const readsBefore = st.calls.filter((c) => c.r === 'theme_settings').length
    await saveBtn(page).click()
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    is(posts(st, 'text_style').length === 0, 'the sizes and weights are NOT written when only fonts changed')
    is(st.calls.filter((c) => c.r === 'theme_settings').length === readsBefore + 1, 'the theme is read again just before it is written')
    const t = posts(st, 'theme')
    is(t.length === 1, 'one theme write', `${t.length}`)
    is(t[0] && t[0].value.brand === THEME.brand && t[0].value.accent === THEME.accent && t[0].value.canvas === THEME.canvas && t[0].value.radius === THEME.radius && t[0].value.dark === true,
      'the colours, the radius and the dark switch are sent back exactly as they were read', JSON.stringify(t[0] && t[0].value))
    is(t[0] && JSON.stringify(t[0].value.fonts) === JSON.stringify({ body_en: 'plex', display_en: 'plex', body_ar: `custom:${FONT_ID}`, display_ar: 'alexandria' }), 'only the fonts differ', JSON.stringify(t[0] && t[0].value.fonts))
    is(JSON.stringify(Object.keys(t[0].value).sort()) === JSON.stringify(['accent', 'brand', 'canvas', 'dark', 'fonts', 'radius']), 'and nothing else is sent (no font_assets)', Object.keys(t[0].value).join())
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 5 both, partial
  head('5. both, and a failure half way')
  {
    let { ctx, page, st } = await open(browser)
    await openDialog(page)
    await page.selectOption(sel('en', 'size_en'), '105'); await page.selectOption(sel('ar', 'display_ar'), 'plex')
    await saveBtn(page).click()
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    is(st.posts.map((p) => p.name).join() === 'text_style,theme', 'the text style is written first, then the theme', st.posts.map((p) => p.name).join())
    await ctx.close()
    ;({ ctx, page, st } = await open(browser, { st: { failTheme: true } }))
    await openDialog(page)
    await page.selectOption(sel('en', 'size_en'), '105'); await page.selectOption(sel('ar', 'display_ar'), 'plex')
    await saveBtn(page).click()
    await page.waitForFunction(() => /not/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    const s = await status(page)
    is(s.startsWith('The sizes and weights were saved, but the fonts were not:') && /server could not do that \(server_error\)/.test(s), 'a theme write that fails after a good text write says exactly that', s)
    is(!(await saveBtn(page).isDisabled()), 'Save stays on: the fonts are still unsaved')
    st.failTheme = false
    const before = st.posts.length
    await saveBtn(page).click()
    await page.waitForFunction(() => /^Saved/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    is(st.posts.slice(before).map((p) => p.name).join() === 'theme', 'the second Save writes only the theme (the text style was already saved)', st.posts.slice(before).map((p) => p.name).join())
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 6 refused and signed out
  head('6. what the server says')
  {
    for (const [label, opt, text] of [['a refused size', { st: { failTs: 'invalid_text_size' } }, 'That text size is not allowed.'], ['a refused weight', { st: { failTs: 'invalid_heading_weight' } }, 'That heading weight is not allowed.']]) {
      const { ctx, page, st } = await open(browser, opt)
      await openDialog(page)
      await page.selectOption(sel('en', 'size_en'), '120'); await page.selectOption(sel('en', 'display_en'), 'plex')
      await saveBtn(page).click()
      await page.waitForFunction(() => document.querySelector('[data-sporta-ts-dialog] .sts-status')?.getAttribute('data-bad') === '1', null, { timeout: 5000 })
      is((await status(page)) === text && posts(st, 'theme').length === 0, `${label}: shown in words, and the theme is not written after it`, await status(page))
      await ctx.close()
    }
    for (const [code, text] of [[401, 'The session ended. Sign in again.'], [429, 'Too many requests. Wait a minute.']]) {
      const { ctx, page, st } = await open(browser)
      await openDialog(page)
      await page.selectOption(sel('en', 'size_en'), '120')
      st.status = code
      await saveBtn(page).click()
      await page.waitForFunction(() => document.querySelector('[data-sporta-ts-dialog] .sts-status')?.getAttribute('data-bad') === '1', null, { timeout: 5000 })
      is((await status(page)) === text, `HTTP ${code}: "${text}"`, await status(page))
      await ctx.close()
    }
  }

  // ------------------------------------------------------------------------------------------- 7 not yet / failed read
  head('7. the server without the route, and a failed read')
  {
    let { ctx, page, st } = await open(browser, { st: { routeMissing: true } })
    await openDialog(page).catch(() => {})
    await page.waitForFunction(() => /next server update/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
    is(!(await page.locator(`${DLG} .sts-cards`).isVisible()), '404: the form is not offered', '')
    is(st.posts.length === 0, '404: nothing was written')
    await ctx.close()
    ;({ ctx, page, st } = await open(browser, { st: { fail: true } }))
    await page.locator(BTN).click()
    await page.waitForFunction(() => !!document.querySelector('[data-sporta-ts-dialog] .sts-btn:not([data-ts]):not([hidden])'), null, { timeout: 5000 })
    is(/server could not do that \(failed\)/.test(await status(page)) || (await status(page)).length > 0, 'a failed read says so', await status(page))
    st.fail = false
    await page.locator(`${DLG} .sts-btn`).filter({ hasText: 'Try again' }).click()
    await page.waitForSelector(`${DLG} [data-ts="save"]`)
    await page.waitForFunction(() => !!document.querySelector('[data-sporta-ts-dialog] select option'), null, { timeout: 5000 })
    is((await val(page, 'en', 'size_en')) === '100', '"Try again" reads again and shows the form')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 8 reset, close, focus
  head('8. reset, close, focus')
  {
    const { ctx, page, st } = await open(browser, { ts: { size_en: 120, size_ar: 90, heading_weight_en: 900, heading_weight_ar: 700 } })
    await openDialog(page)
    await page.locator(`${DLG} [data-ts="reset"]`).click()
    is((await val(page, 'en', 'size_en')) === '100' && (await val(page, 'ar', 'size_ar')) === '100' && (await val(page, 'en', 'heading_weight_en')) === '0' && (await val(page, 'ar', 'heading_weight_ar')) === '0', 'Reset puts 100% and "as designed" in all four boxes')
    is((await val(page, 'en', 'display_en')) === 'alexandria' && (await val(page, 'en', 'body_en')) === 'plex', 'and the designed fonts')
    is(!(await saveBtn(page).isDisabled()) && posts(st, 'text_style').length === 0, 'Reset changes the draft only: nothing is written until Save')
    st.dialogAnswer = false
    await page.locator(`${DLG} [data-ts="close"]`).click()
    is((await page.locator(DLG).count()) === 1 && /Discard/.test(st.lastDialog || ''), 'Close with unsaved changes asks first, and "cancel" keeps the dialog', st.lastDialog || '')
    st.dialogAnswer = true
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-sporta-ts-dialog]'), null, { timeout: 3000 })
    is((await page.locator(DLG).count()) === 0, 'Escape asks too, and on "OK" closes it')
    is(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-ts-btn')), 'focus returns to the button')
    await page.locator(BTN).click()
    await page.waitForSelector(`${DLG} [data-ts="save"]`)
    is((await val(page, 'en', 'size_en')) === '120', 'reopening shows what is SAVED, not the discarded draft')
    st.lastDialog = null
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-sporta-ts-dialog]'), null, { timeout: 3000 })
    is(!st.lastDialog, 'with nothing changed Escape closes without asking')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 9 arabic, phone
  head('9. Arabic and a phone')
  {
    let { ctx, page } = await open(browser, { lang: 'ar' })
    is((await page.locator(BTN).innerText()) === 'أنماط النص', 'the button is in Arabic')
    await openDialog(page)
    is((await page.$eval(`${DLG} [role="dialog"]`, (d) => d.getAttribute('dir'))) === 'rtl', 'the dialog is right to left')
    is((await page.locator(`${DLG} .sts-title`).innerText()) === 'أنماط النص' && /حجم النص/.test(await page.locator(`${DLG} .sts-lab`).allInnerTexts().then((t) => t.join(' '))), 'its texts are Arabic')
    is((await page.$eval(`${DLG} [data-ts-lang="en"] .sts-prev`, (c) => c.getAttribute('dir'))) === 'ltr' && (await page.$eval(`${DLG} [data-ts-lang="ar"] .sts-prev`, (c) => c.getAttribute('dir'))) === 'rtl', 'each sample is in its own language\'s direction (what a visitor reads), the controls follow the admin\'s')
    is((await page.$eval(`${DLG} [data-ts-lang="en"]`, (c) => c.closest('[dir]').getAttribute('dir'))) === 'rtl', 'the cards\' controls follow the admin\'s right-to-left direction')
    await ctx.close()
    ;({ ctx, page } = await open(browser, { viewport: { width: 390, height: 780 } }))
    await openDialog(page)
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: [...document.querySelectorAll('[data-sporta-ts-dialog] select, [data-sporta-ts-dialog] button')].map((e) => e.getBoundingClientRect().height).filter((x) => x > 0), box: document.querySelector('[data-sporta-ts-dialog] .sts-box').getBoundingClientRect().toJSON() }))
    is(m.sw <= m.cw && m.box.left >= 0 && m.box.right <= m.cw, 'at 390px: no sideways scroll, the dialog fits the screen', `${m.sw}/${m.cw}`)
    is(Math.min(...m.h) >= 44, 'every select and button is at least 44px tall', `${Math.min(...m.h)}`)
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------- 10 mutation
  head('10. mutation: the checks fail without each behaviour')
  {
    const mutate = (a, b) => { const out = ADDON.replace(a, b); if (out === ADDON) throw new Error('mutation did not apply: ' + a); return out }
    const colours = async (addon) => {
      const { ctx, page, st } = await open(browser, { addon })
      await openDialog(page); await page.selectOption(sel('en', 'display_en'), 'plex'); await saveBtn(page).click()
      await page.waitForFunction(() => /Saved|not/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
      const t = posts(st, 'theme')[0]; await ctx.close()
      return !!(t && t.value.brand === THEME.brand && t.value.canvas === THEME.canvas && t.value.dark === true)
    }
    is((await colours(ADDON)) === true && (await colours(mutate('{ brand: th.brand, accent: th.accent, canvas: th.canvas, radius: th.radius, dark: !!th.dark, fonts: d.fonts }', '{ fonts: d.fonts }'))) === false,
      'without the colours in the theme write the colour check fails')
    const unchanged = async (addon) => {
      const { ctx, page, st } = await open(browser, { addon })
      await openDialog(page); await page.selectOption(sel('en', 'display_en'), 'plex'); await saveBtn(page).click()
      await page.waitForFunction(() => /Saved|not/.test(document.querySelector('[data-sporta-ts-dialog] .sts-status')?.textContent || ''), null, { timeout: 5000 })
      const n = posts(st, 'text_style').length; await ctx.close(); return n
    }
    is((await unchanged(ADDON)) === 0 && (await unchanged(mutate("var step1 = textChanged ? request(", "var step1 = true ? request("))) === 1, 'writing the sizes when they did not change is caught')
    const asks = async (addon) => {
      const { ctx, page, st } = await open(browser, { addon })
      st.dialogAnswer = false
      await openDialog(page); await page.selectOption(sel('en', 'size_en'), '120')
      await page.locator(`${DLG} [data-ts="close"]`).click()
      const still = (await page.locator(DLG).count()) === 1; await ctx.close(); return still
    }
    is((await asks(ADDON)) === true && (await asks(mutate("if (!force && dirty() && !window.confirm(t('discard'))) return", ''))) === false, 'closing without the question is caught')
  }
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
