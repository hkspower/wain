// The /backends "Sporta AI" screen (public/sporta-admin-brands.js, block "ADMIN SPORTA AI"), in a real browser.
//
//   npm run test:assistant-admin-ui      (no sandbox: the markup of the real compiled admin, scripts/fixtures/sizes-admin/orders.html,
//                                         with the abandoned-orders suite's stand-in for React, the real add-on file, and a mocked
//                                         admin API that holds the settings in memory and records every request)
//
// The server half (validation, the key kept write-only, precedence over config.php, the off switch, the Test route) is proven
// against the real PHP and MariaDB by test:assistant-admin. Here: what the owner sees and what the screen sends.
//
// Asserted:
//   entry     one nav button, the panel closed until pressed; pressing shows it alone (?tab=assistant), the compiled sections
//             hidden, our button current; React's own tab closes it; it and Site content close each other
//   prefill   every field from GET, the server values as placeholders, the key box EMPTY with only "a key is saved" shown
//   save      the body carries every field and the typed key once; the key box is emptied; a save with no key typed sends no
//             key; "Remove the saved key" sends ai_key_clear and no key; a refusal is reported in words for its code; the key
//             is never in the DOM, in storage or in a later request
//   test      the Test button posts the chosen language and shows the verdict: answered (with the AI wording), the key
//             refused (401), off; the line shoppers get when the assistant is off
//   absent    a server without the route (404): nothing is added and nothing else is asked
//   phone     at 390px: the menu tile opens it, nothing overflows sideways, every control is at least 44px tall
//   mutant    with the block cut out of the file the entry check FAILS
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixturePage, addonFiles } from './lib/sizes-admin-page.mjs'
import { SHIM_JS, SHIM_CSS } from './lib/abandoned-ui-shim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const cut = (src, name) => {
  const a = src.indexOf(`/* ===== ${name} - begin`), b = src.indexOf(`/* ===== ${name} - end`)
  if (a < 0 || b < a) { console.log(`FAIL the ${name} block markers are missing`); process.exit(1) }
  return src.slice(0, a) + src.slice(src.indexOf('\n', b))
}
const ADDON_WITHOUT = cut(ADDON, 'ADMIN SPORTA AI')
const ORIGIN = 'https://admin.test'
const KEY = 'sk-ant-api03-UItestKEY1234567890abcdefghij'

let pass = 0, fail = 0, quiet = false
const is = (ok, msg, detail = '') => {
  if (quiet) return !!ok
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
  return !!ok
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SERVER = {
  ai_key_set: true, ai_model: 'claude-haiku-5-5', late_hours: 48, handoff_phone: '+965 22091914', handoff_email: 'cs@sporta.com.kw',
  welcome_ar: 'أهلًا بك في سبورتا. أقدر أتحقق من طلبك.', welcome_en: 'Welcome to Sporta. I can check your order.',
}
const DOC0 = {
  enabled: true, ai_enabled: true, welcome_ar: '', welcome_en: 'Hi from the admin', ai_model: '', late_hours: 72,
  handoff_phone: '+965 50001234', handoff_email: '', ai_key_set: true, server: SERVER, ai_active: true, limits: { welcome: 300, late_hours: 720 },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

/** opts: { absent, refuse, testAnswer, addon, width, content } */
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 900 }, hasTouch: (opts.width ?? 1280) < 500 })
  const page = await ctx.newPage()
  const st = { doc: JSON.parse(JSON.stringify(DOC0)), saves: [], tests: [], requests: [], errors: [] }
  page.on('pageerror', (e) => st.errors.push(String(e)))
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/backends') {
      const html = fixturePage('orders', addonFiles())
        .replace('</head>', `<style>${SHIM_CSS}</style></head>`)
        .replace('</body>', '<script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body>')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    }
    if (p === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: SHIM_JS })
    if (p === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: opts.addon ?? ADDON })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r'), method = req.method(), raw = req.postData() || ''
      st.requests.push({ r, method, raw, headers: req.headers() })
      if (r === 'content' && opts.content) {
        return json(200, { v: 0, overrides: [], contact: {}, pages: ['/'], limits: { overrides: 300, match: 400, text: 2000 }, returns: { window_days: 14, allow_return: true, allow_exchange: true, intro_en: '', intro_ar: '', points_en: [], points_ar: [] } })
      }
      if (r === 'assistant_settings' && method === 'GET') return opts.absent ? json(404, { error: 'not_found' }) : json(200, st.doc)
      if (r === 'assistant_settings_save' && method === 'POST') {
        const b = JSON.parse(raw || '{}'); st.saves.push(b)
        if (opts.refuse) return json(400, { error: opts.refuse })
        const d = st.doc
        ;['enabled', 'ai_enabled', 'welcome_ar', 'welcome_en', 'ai_model', 'handoff_phone', 'handoff_email'].forEach((k) => { if (k in b) d[k] = b[k] })
        if ('late_hours' in b) d.late_hours = b.late_hours === '' ? 0 : Number(b.late_hours)
        if (b.handoff_phone === '5000 1234') d.handoff_phone = '+965 50001234'
        if (b.ai_key) d.ai_key_set = true
        if (b.ai_key_clear) d.ai_key_set = false
        d.ai_active = d.ai_enabled && (d.ai_key_set || d.server.ai_key_set)
        return json(200, d)
      }
      if (r === 'assistant_test' && method === 'POST') {
        const b = JSON.parse(raw || '{}'); st.tests.push(b)
        const ar = b.lang === 'ar'
        const shop = ar ? 'أهلًا بك' : 'Hi from the admin'
        const answer = opts.testAnswer ?? 'answered'
        const ai = answer === 'answered' ? { status: 'answered', http: 200, ms: 412, model: 'claude-haiku-5-5' }
          : answer === 'key' ? { status: 'http_error', http: 401, ms: 120, model: 'claude-haiku-5-5' }
          : { status: 'off', http: 0, ms: 0, model: 'claude-haiku-5-5' }
        return json(200, { enabled: st.doc.enabled, lang: ar ? 'ar' : 'en', question: ar ? 'مرحبا' : 'hello', shop_reply: shop,
          ai, reply: answer === 'answered' ? 'Hey! ' + shop : shop, source: answer === 'answered' ? 'shop+ai' : 'shop',
          off_reply: st.doc.enabled ? null : 'The assistant is switched off right now. We are happy to help on WhatsApp or by phone at +965 50001234' })
      }
      return json(404, { error: 'not_found' })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto(`${ORIGIN}/backends`, { waitUntil: 'load' })
  return { ctx, page, st }
}
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(60) } return v }
const status = (page) => page.evaluate(() => (document.querySelector('.sai-status') || {}).textContent || '')

try {
  // ------------------------------------------------------------------ entry + prefill
  head('entry and prefill')
  {
    const { ctx, page, st } = await open()
    const entry = await until(() => page.evaluate(() => !!document.querySelector('nav.admin-sidebar__nav [data-sporta-ai-nav]')))
    is(entry, 'the Sporta AI entry is added to the admin nav')
    is(await page.evaluate(() => document.querySelectorAll('nav.admin-sidebar__nav [data-sporta-ai-nav]').length === 1 && document.querySelector('[data-sporta-ai]').hidden === true),
       'one nav button, and the panel is closed until it is pressed')
    is(await page.evaluate(() => /Sporta AI/.test(document.querySelector('[data-sporta-ai-nav]').textContent) && /سبورتا/.test(document.querySelector('[data-sporta-ai-nav]').textContent)),
       'its label is in English and Arabic')
    await page.click('nav.admin-sidebar__nav [data-sporta-ai-nav]')
    is(await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden && new URLSearchParams(location.search).get('tab') === 'assistant'
       && [...document.querySelectorAll('main.admin-content > section.admin-page')].filter((s) => getComputedStyle(s).display !== 'none').length === 1
       && document.querySelector('[data-sporta-ai-nav]').getAttribute('aria-current') === 'page'
       && !document.querySelector('nav.admin-sidebar__nav .admin-nav-item[aria-current]:not([data-sporta-ai-nav])'))),
       'pressing it shows the panel alone (?tab=assistant), the compiled sections hidden, our entry the only current one')
    const v = await page.evaluate(() => {
      const q = (n) => document.querySelector(`[name="${n}"]`)
      return { enabled: q('sai_enabled').checked, ai: q('sai_ai_enabled').checked, wen: q('sai_welcome_en').value, war: q('sai_welcome_ar').value,
        warPh: q('sai_welcome_ar').placeholder, model: q('sai_ai_model').value, modelPh: q('sai_ai_model').placeholder, hours: q('sai_late_hours').value,
        phone: q('sai_handoff_phone').value, email: q('sai_handoff_email').value, emailPh: q('sai_handoff_email').placeholder,
        key: q('sai_ai_key').value, keyType: q('sai_ai_key').type, keyState: document.querySelector('.sai-pill').textContent,
        clearShown: !q('sai_ai_key_clear').closest('label').hidden, dirty: document.querySelector('.sai-dirty').textContent }
    })
    is(v.enabled && v.ai && v.wen === 'Hi from the admin' && v.war === '' && v.model === '' && v.hours === '72' && v.phone === '+965 50001234' && v.email === '',
       'every field is filled from GET assistant_settings', JSON.stringify(v))
    is(v.warPh === SERVER.welcome_ar && v.modelPh === 'claude-haiku-5-5' && v.emailPh === 'cs@sporta.com.kw', 'an empty field shows the server value as its placeholder')
    is(v.key === '' && v.keyType === 'password' && /key is saved/i.test(v.keyState) && v.clearShown, 'the key box is an empty password field; the card only says a key is saved', v.keyState)
    is(/Everything is saved/.test(v.dirty), 'and says everything is saved')

    // ---- save with a key
    head('save')
    await page.fill('[name="sai_welcome_ar"]', 'هلا والله')
    await page.fill('[name="sai_ai_model"]', 'claude-haiku-5-5')
    await page.fill('[name="sai_late_hours"]', '96')
    await page.fill('[name="sai_handoff_phone"]', '5000 1234')
    await page.fill('[name="sai_handoff_email"]', 'help@sporta.com.kw')
    await page.uncheck('[name="sai_enabled"]')
    await page.fill('[name="sai_ai_key"]', KEY)
    is(/not saved/.test(await page.evaluate(() => document.querySelector('.sai-dirty').textContent)), 'an edit shows "Changes not saved yet"')
    await page.click('button[type="submit"]:has-text("Save Sporta AI")')
    await until(() => st.saves.length === 1 && page.evaluate(() => /Saved\./.test(document.querySelector('.sai-status').textContent)))
    const s1 = st.saves[0] || {}
    is(s1.enabled === false && s1.ai_enabled === true && s1.welcome_ar === 'هلا والله' && s1.welcome_en === 'Hi from the admin' && s1.ai_model === 'claude-haiku-5-5'
       && s1.late_hours === '96' && s1.handoff_phone === '5000 1234' && s1.handoff_email === 'help@sporta.com.kw' && s1.ai_key === KEY && !('ai_key_clear' in s1),
       'Save sends every field and the typed key', JSON.stringify(s1))
    const req1 = st.requests.find((r) => r.r === 'assistant_settings_save')
    is(req1 && req1.headers['x-sporta-admin'] === '1' && /application\/json/.test(req1.headers['content-type']), 'with the X-Sporta-Admin header and a JSON body')
    is(await page.evaluate(() => document.querySelector('[name="sai_ai_key"]').value === '' && document.querySelector('[name="sai_handoff_phone"]').value === '+965 50001234'
       && /Saved\./.test(document.querySelector('.sai-status').textContent) && /Everything is saved/.test(document.querySelector('.sai-dirty').textContent)),
       'after the save the key box is empty again and the form shows what the server stored (the normalised phone)')
    await page.fill('[name="sai_handoff_email"]', 'other@sporta.com.kw')
    await page.press('[name="sai_handoff_email"]', 'Enter')
    await until(() => st.saves.length === 2)
    is(st.saves[1] && !('ai_key' in st.saves[1]) && st.saves[1].handoff_email === 'other@sporta.com.kw', 'Enter in a field saves; a save with no key typed sends no key', JSON.stringify(st.saves[1]))
    await until(() => page.evaluate(() => /Saved\./.test(document.querySelector('.sai-status').textContent)))
    await page.check('[name="sai_ai_key_clear"]')
    await page.click('button[type="submit"]:has-text("Save Sporta AI")')
    await until(() => st.saves.length === 3)
    is(st.saves[2]?.ai_key_clear === true && !('ai_key' in st.saves[2]), '"Remove the saved key" sends ai_key_clear and no key')
    await until(() => page.evaluate(() => /Saved\./.test(document.querySelector('.sai-status').textContent)))
    is(await page.evaluate(() => /No key saved here: the key in the server configuration is used/.test(document.querySelector('.sai-pill').textContent)
       && document.querySelector('[name="sai_ai_key_clear"]').closest('label').hidden), 'then the card says the server key is used, and the remove box goes away')
    await page.fill('[name="sai_ai_key"]', KEY)
    await page.check('[name="sai_ai_key_clear"]').catch(() => null)
    const domHasKey = await page.evaluate((k) => document.documentElement.outerHTML.includes(k) || JSON.stringify(localStorage).includes(k) || JSON.stringify(sessionStorage).includes(k), KEY)
    is(!domHasKey, 'a typed key is never written into the page markup or the browser storage')
    await page.fill('[name="sai_ai_key"]', '')
    const withKey = st.requests.filter((r) => r.raw.includes(KEY))
    is(withKey.length === 1 && withKey[0] === req1, 'and the key is sent in exactly one request (the save it was typed for)', `${withKey.length}`)

    // ---- test button
    head('test')
    await page.selectOption('[name="sai_test_lang"]', 'en')
    await page.click('button:has-text("Test the assistant")')
    await until(() => page.evaluate(() => !document.querySelector('.sai-result').hidden))
    const t = await page.evaluate(() => ({ verdict: document.querySelector('.sai-verdict').textContent, ok: document.querySelector('.sai-verdict').getAttribute('data-ok'),
      dd: [...document.querySelectorAll('.sai-dl dd')].map((d) => d.textContent), dt: [...document.querySelectorAll('.sai-dl dt')].map((d) => d.textContent) }))
    is(st.tests.length === 1 && st.tests[0].lang === 'en', 'Test posts the chosen language', JSON.stringify(st.tests))
    is(/AI answered/.test(t.verdict) && t.ok === '1' && t.dd.includes('hello') && t.dd.includes('Hi from the admin') && t.dd.includes('Hey! Hi from the admin') && t.dd.includes('412 ms'),
       'answered: the verdict, the question, the shop\'s line, the AI wording and the time', JSON.stringify(t))
    is(t.dt.some((x) => /assistant is OFF/.test(x)) && t.dd.some((x) => /switched off right now/.test(x)), 'with the assistant off, it shows the line shoppers get')

    // ---- leaving
    head('leaving')
    await page.click('nav.admin-sidebar__nav .admin-nav-item:not([data-sporta-ai-nav]):not([data-sporta-sc-nav]):not([data-sporta-ab-nav])')
    is(await until(() => page.evaluate(() => document.querySelector('[data-sporta-ai]').hidden && !document.body.hasAttribute('data-sporta-ai-open')
       && !document.querySelector('[data-sporta-ai-nav]').hasAttribute('aria-current'))), "a click on one of the admin's own tabs closes the panel")
    is(st.errors.length === 0, 'no page error', st.errors.join(' | '))
    await ctx.close()
  }

  // ------------------------------------------------------------------ refusals and other verdicts
  head('refusals and verdicts')
  {
    const { ctx, page, st } = await open({ refuse: 'invalid_assistant_handoff_phone', testAnswer: 'key' })
    await until(() => page.evaluate(() => !!document.querySelector('[data-sporta-ai-nav]')))
    await page.click('nav.admin-sidebar__nav [data-sporta-ai-nav]')
    await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden && document.querySelector('[name="sai_late_hours"]').value === '72'))
    await page.fill('[name="sai_handoff_phone"]', 'call me')
    await page.click('button[type="submit"]:has-text("Save Sporta AI")')
    is(await until(() => page.evaluate(() => document.querySelector('.sai-status').getAttribute('data-bad') === '1' && /phone must be a full number/.test(document.querySelector('.sai-status').textContent))),
       'a refused save is reported in words for its code', await status(page))
    is(await page.evaluate(() => document.querySelector('[name="sai_handoff_phone"]').value === 'call me' && /not saved/.test(document.querySelector('.sai-dirty').textContent)),
       'and what was typed is kept, still marked unsaved')
    const n = st.saves.length
    await page.fill('[name="sai_late_hours"]', '900')
    await page.click('button[type="submit"]:has-text("Save Sporta AI")')
    await sleep(300)
    is(st.saves.length === n && /1 to 720/.test(await status(page)), 'hours out of range are refused before anything is sent')
    await page.fill('[name="sai_late_hours"]', '72')
    await page.click('button:has-text("Test the assistant")')
    await until(() => page.evaluate(() => !document.querySelector('.sai-result').hidden))
    is(await page.evaluate(() => /refused the key \(HTTP 401\)/.test(document.querySelector('.sai-verdict').textContent) && document.querySelector('.sai-verdict').getAttribute('data-ok') === '0'),
       'a key the AI service refuses: "refused the key (HTTP 401)"')
    is(st.tests[0]?.lang === 'ar', 'the Test language defaults to Arabic')
    await ctx.close()
    const off = await open({ testAnswer: 'off' })
    await until(() => off.page.evaluate(() => !!document.querySelector('[data-sporta-ai-nav]')))
    await off.page.click('nav.admin-sidebar__nav [data-sporta-ai-nav]')
    await off.page.click('button:has-text("Test the assistant")')
    await until(() => off.page.evaluate(() => !document.querySelector('.sai-result').hidden))
    is(await off.page.evaluate(() => /not active/.test(document.querySelector('.sai-verdict').textContent) && ![...document.querySelectorAll('.sai-dl dt')].some((d) => /Model/.test(d.textContent))),
       'AI phrasing off: "not active", no model line')
    await off.ctx.close()
  }

  // ------------------------------------------------------------------ beside Site content
  head('beside Site content')
  {
    const { ctx, page, st } = await open({ content: true })
    const both = await until(() => page.evaluate(() => !!document.querySelector('nav.admin-sidebar__nav [data-sporta-ai-nav]') && !!document.querySelector('nav.admin-sidebar__nav [data-sporta-sc-nav]')))
    is(both, 'both add-on entries are in the nav')
    await page.click('nav.admin-sidebar__nav [data-sporta-sc-nav]')
    await until(() => page.evaluate(() => !document.querySelector('[data-sporta-content]').hidden))
    await page.click('nav.admin-sidebar__nav [data-sporta-ai-nav]')
    is(await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden && document.querySelector('[data-sporta-content]').hidden
       && !document.body.hasAttribute('data-sporta-sc') && new URLSearchParams(location.search).get('tab') === 'assistant'
       && [...document.querySelectorAll('main.admin-content > section.admin-page')].filter((x) => getComputedStyle(x).display !== 'none').length === 1
       && document.querySelectorAll('nav.admin-sidebar__nav [aria-current="page"]').length === 1)),
       'opening Sporta AI closes Site content (one panel, one current entry, ?tab=assistant)')
    await page.click('nav.admin-sidebar__nav [data-sporta-sc-nav]')
    is(await until(() => page.evaluate(() => document.querySelector('[data-sporta-ai]').hidden && !document.querySelector('[data-sporta-content]').hidden
       && !document.body.hasAttribute('data-sporta-ai-open') && new URLSearchParams(location.search).get('tab') === 'content'
       && document.querySelectorAll('nav.admin-sidebar__nav [aria-current="page"]').length === 1)),
       'and opening Site content closes Sporta AI')
    await page.goBack()
    is(await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden && new URLSearchParams(location.search).get('tab') === 'assistant')),
       'Back returns to Sporta AI')
    is(st.errors.length === 0, 'no page error', st.errors.join(' | '))
    await ctx.close()
  }

  // ------------------------------------------------------------------ deep link
  head('deep link')
  {
    const { ctx, page } = await open()
    await page.goto(`${ORIGIN}/backends?tab=assistant`, { waitUntil: 'load' })
    is(await until(() => page.evaluate(() => !!document.querySelector('[data-sporta-ai]') && !document.querySelector('[data-sporta-ai]').hidden)), '/backends?tab=assistant opens the panel on load')
    await ctx.close()
  }

  // ------------------------------------------------------------------ absent route
  head('a server without the route')
  {
    const { ctx, page, st } = await open({ absent: true })
    await sleep(1500)
    is(await page.evaluate(() => !document.querySelector('[data-sporta-ai-nav]') && !document.querySelector('[data-sporta-ai]') && !document.querySelector('style[data-sporta-ai-style]')),
       '404 on assistant_settings: no entry, no panel, no style added')
    is(st.requests.filter((r) => r.r === 'assistant_settings').length === 1 && !st.requests.some((r) => /^assistant_(settings_save|test)$/.test(r.r)), 'and it is asked exactly once, nothing else')
    await ctx.close()
  }

  // ------------------------------------------------------------------ phone
  head('phone (390px)')
  for (const rtl of [false, true]) {
    const { ctx, page, st } = await open({ width: 390 })
    if (rtl) await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; const s = document.querySelector('.admin-shell'); if (s) { s.dir = 'rtl'; s.lang = 'ar' } })
    await until(() => page.evaluate(() => !!document.querySelector('[data-sporta-ai]')))
    const menu = await page.$('.m-header__menu')
    let opened = false
    if (menu && await menu.isVisible()) {
      await menu.click()
      await until(() => page.evaluate(() => !!document.querySelector('.m-menu-grid [data-sporta-ai-nav]')))
      const tile = await page.$('.m-menu-grid [data-sporta-ai-nav]')
      if (tile) { await tile.click(); opened = await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden && !document.querySelector('.m-menu-layer'))) }
    }
    is(opened, `${rtl ? 'Arabic' : 'English'}: the phone menu has a Sporta AI tile, and it opens the panel (the menu closes)`)
    if (!opened) await page.evaluate(() => document.querySelector('[data-sporta-ai-nav]').click())
    await until(() => page.evaluate(() => !document.querySelector('[data-sporta-ai]').hidden))
    await page.click('button:has-text("Test the assistant")')
    await until(() => page.evaluate(() => !document.querySelector('.sai-result').hidden))
    const m = await page.evaluate(() => {
      const panel = document.querySelector('[data-sporta-ai]')
      const r = panel.getBoundingClientRect()
      const wide = [...panel.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > window.innerWidth + 0.5 || b.left < -0.5) }).map((e) => e.className || e.tagName)
      const small = [...panel.querySelectorAll('button, input:not([type="checkbox"]), select, textarea, label.sai-check')]
        .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).map((e) => (e.name || e.textContent).slice(0, 30) + ':' + e.getBoundingClientRect().height)
      return { docOverflow: document.documentElement.scrollWidth > window.innerWidth, panelOut: r.right > window.innerWidth + 0.5 || r.left < -0.5, wide: wide.slice(0, 5), small,
        header: !!document.querySelector('.m-header__title > strong[data-sporta-ai-title]') && getComputedStyle(document.querySelector('.m-header__title > strong[data-sporta-ai-title]')).display !== 'none' }
    })
    is(!m.docOverflow && !m.panelOut && m.wide.length === 0, `${rtl ? 'Arabic' : 'English'} 390px: nothing overflows sideways`, JSON.stringify(m))
    is(m.small.length === 0, `${rtl ? 'Arabic' : 'English'} 390px: every button, field, select and switch row is at least 44px tall`, m.small.join(', '))
    is(m.header, `${rtl ? 'Arabic' : 'English'} 390px: the phone header says Sporta AI while it is open`)
    is(st.errors.length === 0, 'no page error', st.errors.join(' | '))
    await ctx.close()
  }

  // ------------------------------------------------------------------ mutant
  head('mutation: the block cut out')
  {
    quiet = true
    const { ctx, page } = await open({ addon: ADDON_WITHOUT })
    const entry = await until(() => page.evaluate(() => !!document.querySelector('[data-sporta-ai-nav]')), 2500)
    const caught = is(entry, 'mutant: the Sporta AI entry is added')
    await ctx.close()
    quiet = false
    is(caught === false, 'with the block cut out of sporta-admin-brands.js the entry check FAILS (mutant caught)')
  }
} catch (e) {
  fail++
  console.log('FAIL the suite crashed: ' + (e?.stack || e))
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
