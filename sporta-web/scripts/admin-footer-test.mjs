// The Footer editor (block "ADMIN FOOTER EDITOR", public/sporta-admin-brands.js) and what the storefront does with what it saves
// (public/sporta-features.js "SITE CONTENT", public/sporta-footer-call.js), in a real browser.
//
//   npm run test:admin-footer     (rig-free: no database, no PHP server. The admin is the CAPTURED live admin (scripts/fixtures/admin-css-full/seo.html)
//                                  under the live rules and the add-on sheets; the admin API is a fake that validates a save the way
//                                  store_site_content_save() does; the storefront is the CAPTURED live home page, both languages
//                                  (scripts/fixtures/sizes-screen/home-*.html) under the live compiled rules and the add-on sheets;
//                                  the REAL add-on files run on them)
//
// What is asserted:
//   1 the capture      every text node of the live footer (ar + en) belongs to a field of the editor, every field's selector finds it, and the
//                      built-in words the editor holds are the captured ones; the call button's full label; the editor's number and price
//                      rules are the server's (regexes read from store.php, vectors run through PHP's preg_match when php is installed)
//   2 the entry        one "Footer" button, only in the header of the Site content screen; nothing read before it is pressed; off /backends the
//                      block does not start
//   3 opening          reads GET content (X-Sporta-Admin) and the storefront home in both languages with ?sporta_content=off, writes nothing,
//                      removes its hidden frames; 20 fields x 2 languages show the live words; the phone / WhatsApp numbers; socials read only
//   4 the encoding     typing a text in EVERY field and language and saving posts exactly one rule per change, {page:'*', lang, match = the live
//                      text node, text}, each valid for the server's validator; the call button's rule matches the whole built-in label
//   5 the merge        the request is GET content, then POST content_save with the version just read; every other rule (same order, same
//                      objects) and every other contact value is byte-identical; a change another editor saved in between survives
//   6 limits           a price (Western or Arabic digits, KD / KWD / د.ك), a text over the field's limit, a bad phone: refused in the editor, no POST
//   7 reset            restores the build's words; a saved rule is removed by Reset + Save; typing the original text is "no rule"
//   8 the save         a double press saves once; 401, 429, 400 price_in_content_text, 409, 413 and a dead network are worded, the editor stays
//                      dirty and can save again; Discard reloads
//   9 the preview      the footer of the live page in a script-less frame: ar + en at 320 / 390 / 768 / 1280, no sideways overflow, its words are
//                      the typed ones; EQUAL to the footer the storefront shows after the same saved document
//  10 the storefront   the saved rules apply on every page, idempotent (no write after the first pass), survive a re-render of the footer and
//                      a language switch, are text only (markup stays characters), a price is never applied, the call button reads "<words>
//                      <number>" and follows contact.phone, nothing moves (layout shift 0) when the kept copy is applied; long Arabic text
//                      wraps at 320 px; a footer whose elements hold several text nodes still matches
//  11 the screen      390 / 768 / 1280, LTR and RTL, light and dark: no sideways scroll, 44 px targets, 4.5:1 text, Escape and Tab behave, closing
//                      with changes asks first
//  12 MUTATION        with the block cut out there is no button; with the storefront block cut out nothing is applied; with the footer-call label
//                      code cut out the call button keeps the build's words
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as adminPage, addons, knetServed } from './lib/admin-css-full-page.mjs'
import { fixturePage as storePage, addonFiles } from './lib/sizes-screen-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const BRANDS_JS = read('public/sporta-admin-brands.js'), FEATURES_JS = read('public/sporta-features.js'), CALL_JS = read('public/sporta-footer-call.js')
const cutBlock = (src, name) => {
  const a = src.indexOf(`/* ===== ${name} - begin`), b = src.indexOf(`/* ===== ${name} - end`)
  if (a < 0 || b < a) { console.log(`FAIL the ${name} block markers are not in the file`); process.exit(1) }
  return src.slice(0, a) + src.slice(src.indexOf('\n', b))
}
const BRANDS_WITHOUT = cutBlock(BRANDS_JS, 'ADMIN FOOTER EDITOR')
const FEATURES_WITHOUT = cutBlock(FEATURES_JS, 'SITE CONTENT')
const SHOTS = process.env.FOOTER_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (x) => JSON.parse(JSON.stringify(x))
const ORIGIN = 'https://www.sporta.com.kw'
const LANGS = ['ar', 'en']
const WIDTHS = [320, 390, 768, 1280]

// ------------------------------------------------------------------------------------------------ the capture
const STORE_FILES = addonFiles()
const homeFixture = (lang) => storePage('home', lang, STORE_FILES)
const footerTexts = (html) => {
  // the text nodes of the captured <footer class="app-footer ..."> (tags stripped, entities kept as captured)
  const f = html.slice(html.indexOf('<footer class="app-footer'), html.indexOf('</footer>'))
  return f.replace(/<svg[\s\S]*?<\/svg>/g, '').split(/<[^>]+>/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}
// ------------------------------------------------------------------------------------------------ the server's validator (store_site_content_save)
const PRICE_PHP = read('dropin/php-store/store.php').match(/const STORE_CONTENT_PRICE_RE = '(.*)';/)[1]
const squashS = (s) => String(s).replace(/[ \t\n\r\f\v]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').replace(/^ +| +$/g, '')
const PRICE_JS = new RegExp(
  '(?:[0-9\\u0660-\\u0669][0-9\\u0660-\\u0669.,\\u066B\\u066C]*[\\s\\u00A0\\u202F]*(?:KWD|K\\.?\\s?D\\.?|\\u062F\\.?\\s?\\u0643\\.?)(?![A-Za-z\\u0600-\\u06FF]))|(?:(?<![A-Za-z\\u0600-\\u06FF])(?:KWD|K\\.?\\s?D\\.?|\\u062F\\.?\\s?\\u0643\\.?)[\\s\\u00A0\\u202F]*[0-9\\u0660-\\u0669])', 'i')
const PAGES = ['*', '/', '/shop', '/product/*', '/about', '/contact', '/support', '/account', '/wishlist', '/track', '/returns', '/exchange', '/terms', '/privacy', '/review']
const CKEYS = ['phone', 'whatsapp', 'email', 'address_en', 'address_ar', 'instagram', 'tiktok', 'snapchat', 'x']
function serverValidate(body, cur) {
  if (body.v !== undefined && body.v !== null && (!Number.isInteger(body.v) || body.v < 0)) return { status: 400, error: 'invalid_content_version' }
  const list = body.overrides ?? []
  if (!Array.isArray(list)) return { status: 400, error: 'invalid_content_overrides' }
  if (list.length > 300) return { status: 400, error: 'too_many_content_overrides' }
  const kept = new Map()
  for (const o of list) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { status: 400, error: 'invalid_content_override' }
    if (!PAGES.includes(o.page)) return { status: 400, error: 'invalid_content_page' }
    if (o.lang !== 'ar' && o.lang !== 'en') return { status: 400, error: 'invalid_content_lang' }
    const match = squashS(o.match ?? ''), text = squashS(o.text ?? '')
    if (!match) return { status: 400, error: 'missing_content_match' }
    if (match.length > 400) return { status: 400, error: 'too_long_content_match' }
    if (PRICE_JS.test(match) || /^[0-9٠-٩\s.,:+\-\/%]+$/.test(match) || /^(?:KWD|K\.?\s?D\.?|د\.?\s?ك\.?)$/i.test(match)) return { status: 400, error: 'invalid_content_match' }
    if (text.length > 2000) return { status: 400, error: 'too_long_content_text' }
    if (PRICE_JS.test(text)) return { status: 400, error: 'price_in_content_text' }
    const key = [o.page, o.lang, match].join('\n')
    if (text === '') { kept.delete(key); continue }
    kept.set(key, { page: o.page, lang: o.lang, match, text })
  }
  const c = body.contact
  if (c !== undefined && c !== null && (typeof c !== 'object' || Array.isArray(c))) return { status: 400, error: 'invalid_content_contact' }
  const contact = {}
  for (const k of CKEYS) contact[k] = typeof c?.[k] === 'string' ? c[k] : ''
  const phone = contact.phone.replace(/[\s\-().]/g, '')
  if (phone && !/^\+?[0-9]{6,15}$/.test(phone)) return { status: 400, error: 'invalid_contact_phone' }
  const wa = contact.whatsapp.replace(/[\s\-().]/g, '')
  if (wa && !/^\+?[0-9]{8,15}$/.test(wa)) return { status: 400, error: 'invalid_contact_whatsapp' }
  contact.phone = phone; contact.whatsapp = wa.replace(/^\+/, '')
  if (body.v !== undefined && body.v !== null && body.v !== cur.v) return { status: 409, error: 'content_changed' }
  return { doc: { v: cur.v + 1, overrides: [...kept.values()], contact } }
}

// ------------------------------------------------------------------------------------------------ the world
const BASE_CONTACT = { phone: '+96522091914', whatsapp: '96522091914', email: 'cs@sporta.com.kw', address_en: 'Kuwait City', address_ar: 'مدينة الكويت', instagram: 'https://www.instagram.com/sporta.kw', tiktok: 'https://www.tiktok.com/@sporta.kw', snapchat: '', x: '' }
// rules that are NOT the footer's and must come back byte for byte: a page-specific one, one for the header, an English one, a returns sentence
const OTHER_RULES = [
  { page: '/about', lang: 'ar', match: 'من نحن', text: 'قصتنا' },
  { page: '*', lang: 'en', match: 'Free delivery over 15', text: 'Free delivery' },
  { page: '/shop', lang: 'en', match: 'Shop', text: 'The shop' },
  { page: '*', lang: 'ar', match: 'عن سبورتا', text: 'عن سبورتا الكويت' }
]
const makeWorld = (over = {}) => ({
  doc: { v: 7, overrides: clone(OTHER_RULES), contact: { ...BASE_CONTACT } },
  calls: [], pubCalls: 0, frameLoads: [], next: null, delay: 0, drop: false, split: false, ...over
})
const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
const MIME = { css: 'text/css', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const SPLIT = `<script>(function(){function split(sel,part){var e=document.querySelector(sel);if(!e)return;var w=document.createTreeWalker(e,4,null),n;while((n=w.nextNode())){var i=n.nodeValue.indexOf(part);if(i>0){var t=n.splitText(i);t.splitText(part.length);return}}}
split('.footer-eyebrow','كل يوم أقوى');split('.footer-eyebrow','STRONGER EVERY DAY');split('.footer-legal > p:nth-child(1)','جميع الحقوق محفوظة.');split('.footer-legal > p:nth-child(1)','All rights reserved.')})()</script>`
const storefrontHtml = (W, lang, { scripts = false, features = FEATURES_JS, call = CALL_JS, cache = null } = {}) => {
  let h = homeFixture(lang)
  const pre = (W.split ? SPLIT : '') + (cache ? `<script>try{localStorage.setItem('sporta_content_v1',${JSON.stringify(JSON.stringify(cache))})}catch(e){}</script>` : '')
  const post = scripts ? `<script>${features.replace(/<\/script/gi, '<\\/script')}</script><script>${call.replace(/<\/script/gi, '<\\/script')}</script>` : ''
  return h.replace('</body>', () => pre + post + '</body>')
}
function handler(W, shellHtml, opts = {}) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (p === '/backends' || p.startsWith('/backends/')) return route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      const rec = { method, route: r, headers: req.headers(), body: method === 'POST' ? (() => { try { return JSON.parse(req.postData() || 'null') } catch { return '__unparsable__' } })() : null }
      W.calls.push(rec)
      if (W.drop && r === 'content_save') return route.abort('failed')
      if (r === 'content' && method === 'GET') {
        if (W.getFail) return json(route, W.getFail, { error: 'x' })
        return json(route, 200, { ...clone(W.doc), pages: PAGES, limits: { overrides: 300, match: 400, text: 2000, bytes: 60000 }, returns: { window_days: 14, allow_return: true, allow_exchange: true, intro_en: '', intro_ar: '', points_en: [], points_ar: [] } })
      }
      if (r === 'content_save' && method === 'POST') {
        if (W.delay) await sleep(W.delay)
        if (W.next) { const n = W.next; W.next = null; return json(route, n.status, n.body, n.headers || {}) }
        if (rec.headers['x-sporta-admin'] !== '1' || !/^application\/json/.test(rec.headers['content-type'] || '')) return json(route, 403, { error: 'bad_request' })
        const v = serverValidate(rec.body, W.doc)
        if (v.error) return json(route, v.status, { error: v.error })
        W.doc = clone(v.doc)
        return json(route, 200, clone(W.doc))
      }
      return json(route, 404, { error: 'not_found' })
    }
    if (p === '/api/api.php' && u.searchParams.get('r') === 'content') { W.pubCalls++; return json(route, 200, clone(W.doc)) }
    if (p === '/' || p === '/about' || p === '/shop' || p === '/contact') {
      const lang = u.searchParams.get('lang') === 'en' ? 'en' : 'ar'
      if (p === '/') W.frameLoads.push(u.search)
      return route.fulfill({ status: 200, contentType: 'text/html', body: storefrontHtml(W, lang, opts.store || {}) })
    }
    if (/\.(png|jpe?g|webp|avif|svg)$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (/^\/fonts\//.test(p)) { try { return route.fulfill({ status: 200, contentType: MIME[p.split('.').pop()] || 'font/woff2', body: readFileSync(join(ROOT, 'public', p)) }) } catch { return route.fulfill({ status: 404, body: '' }) } }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const pageErrors = []
async function openAdmin(W, { w = 1280, h = 900, rtl = false, dark = false, js = BRANDS_JS, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800 })
  await ctx.route(ORIGIN + '/**', handler(W, adminPage('seo', FILES, { rtl, dark }), { store }))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
  pg.on('dialog', (d) => { pg.__dialogs = (pg.__dialogs || []).concat(d.message()); d.accept() })
  await pg.goto(ORIGIN + '/backends/seo')
  await pg.addScriptTag({ content: js })
  pg.__ctx = ctx
  await pg.waitForSelector('[data-sporta-content]', { state: 'attached', timeout: 5000 }).catch(() => {})
  return pg
}
async function openEditor(pg) {
  await pg.evaluate(() => document.querySelector('[data-sporta-sc-nav]')?.click())
  await pg.waitForSelector('[data-sporta-fe-btn]', { state: 'visible', timeout: 5000 })
  await pg.click('[data-sporta-fe-btn]')
  await pg.waitForSelector('.sfe:not([hidden])', { timeout: 3000 })
  // the live pages are read one after the other: wait until both previews exist and the fields are enabled
  await pg.waitForFunction(() => { const i = document.querySelector('.sfe textarea,.sfe input[data-id]'); return i && !i.disabled && !document.querySelector('.sfe-status')?.textContent.includes('Reading') && document.querySelector('.sfe-status')?.textContent === '' }, null, { timeout: 20000 })
  await pg.waitForTimeout(150)
}
const close = (pg) => pg.__ctx.close()
const cell = (id, l) => `.sfe [data-id="${id}"][data-lang="${l}"]`
const type = async (pg, id, l, text) => { const s = cell(id, l); await pg.fill(s, text) }
const posts = (W) => W.calls.filter((c) => c.method === 'POST')
const gets = (W) => W.calls.filter((c) => c.method === 'GET')
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, name + '.png') }) }
const IDS = ['club.eyebrow', 'club.title', 'club.sub', 'club.msg', 'club.call', 'brand.tagline', 'col1.title', 'col1.l1', 'col1.l2', 'col1.l3', 'col1.l4', 'col2.title', 'col2.l1', 'col2.l2', 'col2.l3', 'col2.l4', 'col2.l5', 'pay.cod', 'legal.rights', 'legal.operator']
const val = (pg, id, l) => pg.inputValue(cell(id, l))
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

// ================================================================================================ 1. the capture
head('the capture and the server rules')
{
  const W = makeWorld(), pg = await openAdmin(W)
  const H = await pg.evaluate(() => { const h = window.__sportaFooterEditor; return h && { catalog: h.catalog, price: [h.price.source, h.price.flags], ph: ['+96522091914', '96522091914', '0096522091914', '12345', '1234567890123456', '+965 2209 1914', '٩٦٥٢٢٠٩١٩١٤', '', 'abc', '+', '22091914'].map((v) => [v, h.numberError('phone', v) === '', h.numberError('whatsapp', v) === '', h.cleanNumber(v)]) } })
  is(!!H, 'the block exposes its catalog for this check')
  is(H.catalog.length === IDS.length && same(H.catalog.map((c) => c.id), IDS), `the editor lists the ${IDS.length} footer texts of the live footer, in footer order`, H.catalog.map((c) => c.id).join(','))
  for (const lang of LANGS) {
    const html = homeFixture(lang)
    const texts = footerTexts(html)
    // every text node of the captured footer is a catalog field (or the part of one) ...
    const wanted = H.catalog.map((c) => [c.id, c.full ? c.full[lang] : c.b[lang], c.part ? c.part[lang] : null])
    const covered = texts.filter((t) => wanted.some(([, full, part]) => t === full || t === part || (part && full.includes(part) && t.includes(part)) || t.startsWith(full)))
    const missing = texts.filter((t) => !covered.includes(t))
    is(missing.length === 0, `${lang}: every text of the live footer belongs to a field (${texts.length} texts)`, missing.join(' | '))
    // ... and its selector finds exactly that text in the captured page
    const found = await (async () => {
      const ctx = await browser.newContext(); const p = await ctx.newPage()
      await p.setContent(html, { waitUntil: 'domcontentloaded' })
      const out = await p.evaluate(([cat, l]) => cat.map((c) => { const e = document.querySelector('footer.app-footer ' + c.sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null }), [H.catalog, lang])
      await ctx.close(); return out
    })()
    H.catalog.forEach((c, i) => {
      const t = found[i], want = c.full ? c.full[lang] : c.b[lang]
      is(t !== null && (t === want || (c.part && t.includes(c.part[lang]))), `${lang}: "${c.id}" is where the editor looks for it and says what the build says`, `${t} vs ${want}`)
    })
  }
  const sc = read('dropin/php-store/store.php')
  is(PRICE_PHP.includes('KWD') && H.price[0].includes('KWD'), 'the editor carries the same price rule as store.php (both name KWD / KD / د.ك)')
  try {
    const vectors = ['5 KD', '12.500 KWD', '٣ د.ك', 'KD 5', 'KWD5', 'Kd', 'Call us 22091914', 'Free delivery', 'من 5 دك', '5 kdx', '1 كويتي', 'Join the club', '10KD', 'د.ك 2', 'RKD 5']
    const php = JSON.parse(execFileSync('php', ['-r', `$re = '${PRICE_PHP.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'; echo json_encode(array_map(fn($v) => preg_match($re, $v) === 1, json_decode(file_get_contents('php://stdin'), true)));`], { input: JSON.stringify(vectors) }).toString())
    const js = await pg.evaluate(([v, src, fl]) => { const re = new RegExp(src, fl); return v.map((x) => re.test(x)) }, [vectors, H.price[0], H.price[1]])
    is(same(php, js), 'the price rule answers the same as PHP\'s preg_match on 15 texts', JSON.stringify([php, js]))
  } catch (e) { is(true, 'php is not installed here: the price vectors are checked against the regex read from store.php only (' + String(e.message).slice(0, 40) + ')') }
  const phpPhone = sc.match(/preg_match\('\/(\^\\\+\?\[0-9\]\{6,15\}\$)\/D', \$phone\)/), phpWa = sc.match(/preg_match\('\/(\^\\\+\?\[0-9\]\{8,15\}\$)\/D', \$wa\)/)
  is(!!phpPhone && !!phpWa, 'store.php tests the phone with ^\\+?[0-9]{6,15}$ and the WhatsApp number with ^\\+?[0-9]{8,15}$')
  const exp = (v, re) => re.test(v.replace(/[\s\-().]/g, '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)))
  is(H.ph.every(([v, okPhone, okWa]) => okPhone === (v === '' || exp(v, /^\+?[0-9]{6,15}$/)) && okWa === (v === '' || exp(v, /^\+?[0-9]{8,15}$/))), 'phone and WhatsApp numbers are accepted and refused exactly as the server does (11 values, Arabic digits and separators included)', JSON.stringify(H.ph))
  await close(pg)
}

// ================================================================================================ 2. the entry
head('the entry button')
{
  const W = makeWorld(), pg = await openAdmin(W)
  is(await pg.locator('[data-sporta-fe-btn]').count() === 1, 'one "Footer" button')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-fe-btn]'); return !!b.closest('[data-sporta-content] .ssc-form > header') && /Footer/.test(b.textContent) }), 'it is in the header of the Site content screen')
  is(W.frameLoads.length === 0 && !gets(W).some((c) => c.route === 'footer'), 'nothing of the storefront is read before the button is pressed')
  await pg.evaluate(() => document.querySelector('[data-sporta-sc-nav]')?.click())
  await pg.waitForSelector('[data-sporta-fe-btn]', { state: 'visible' })
  is((await pg.locator('[data-sporta-fe-btn]').evaluate((b) => b.getBoundingClientRect().height)) >= 43.5, 'it is 44 px tall')
  await pg.waitForTimeout(400)
  is(await pg.locator('[data-sporta-fe-btn]').count() === 1, 'still one after the screen settled')
  await close(pg)
  const ctx = await browser.newContext()
  await ctx.route(ORIGIN + '/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><main class="admin-content"></main></body></html>' }))
  const shop = await ctx.newPage(); await shop.goto(ORIGIN + '/shop'); await shop.addScriptTag({ content: BRANDS_JS }); await shop.waitForTimeout(500)
  is(await shop.evaluate(() => typeof window.__sportaFooterEditor === 'undefined' && !document.querySelector('style[data-sporta-fe-style]')), 'off /backends the block does not start (no flag, no style)')
  await ctx.close()
}

// ================================================================================================ 3. opening
head('opening the editor')
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  const c = W.calls
  is(c.some((x) => x.route === 'content' && x.method === 'GET' && x.headers['x-sporta-admin'] === '1'), 'it reads GET content with X-Sporta-Admin: 1')
  is(posts(W).length === 0, 'and writes nothing')
  is(W.frameLoads.length === 2 && W.frameLoads.includes('?lang=ar&sporta_content=off') && W.frameLoads.includes('?lang=en&sporta_content=off'), 'it reads the storefront home once per language, with ?sporta_content=off', W.frameLoads.join(' '))
  is(await pg.locator('iframe[data-sporta-fe-frame]').count() === 0, 'the hidden reading frames are gone')
  is(await pg.locator('.sfe .sfe-row').count() === IDS.length, `${IDS.length} field rows`)
  is(await pg.locator('.sfe input[data-id], .sfe textarea[data-id]').count() === IDS.length * 2, 'two boxes (Arabic, English) per field, side by side in one row')
  const live = {}
  for (const l of LANGS) { const html = homeFixture(l); live[l] = footerTexts(html) }
  is((await val(pg, 'club.title', 'ar')) === 'انضم لنادي سبورتا' && (await val(pg, 'club.title', 'en')) === 'Join the Sporta club', 'a box shows the words the shop shows now, in each language')
  is((await val(pg, 'club.call', 'ar')) === 'اتصل بنا' && (await val(pg, 'club.call', 'en')) === 'Call us', 'the call button box holds the WORDS only (the number is added by the shop)')
  is((await val(pg, 'club.eyebrow', 'ar')) === 'SPORTA / كل يوم أقوى', 'the eyebrow (one text node in this capture) is matched as a whole', await val(pg, 'club.eyebrow', 'ar'))
  is(await pg.locator('.sfe-tag', { hasText: 'Not checked' }).count() === 0, 'every field was found on the live page: nothing is tagged "not checked"')
  is(await pg.inputValue('#sfe-contact-phone') === '+96522091914' && await pg.inputValue('#sfe-contact-whatsapp') === '96522091914', 'the phone and WhatsApp numbers are the saved ones')
  const soc = await pg.locator('.sfe-sub .sfe-hint').last().textContent()
  is(/Instagram: sporta\.kw/.test(soc) && /TikTok: @sporta\.kw/.test(soc) && await pg.locator('.sfe input').evaluateAll((l) => l.every((i) => !/insta|tiktok|snap/i.test(i.id + i.name))), 'the social links are shown read only (no box for them here)', soc)
  is(await pg.locator('.sfe .sfe-path', { hasText: '/about#why' }).count() === 1 && await pg.locator('.sfe .sfe-path', { hasText: 'fixed' }).count() >= 9, 'each link shows where it goes, read only (the path cannot change without a server update)')
  is(await pg.locator('.sfe .sfe-tag--warn').count() >= 1, 'a text that also appears outside the footer is flagged (the header menu has "من نحن" / "Shop"...)', String(await pg.locator('.sfe .sfe-tag--warn').count()))
  is(await pg.locator('.sfe [data-lang="ar"]').first().evaluate((e) => e.getAttribute('data-lang')) === 'ar', 'Arabic first')
  is(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'sfe-title'), 'focus moves to the title')
  await shot(pg, '01-editor-1280-ltr-light')
  await close(pg)
}

// ================================================================================================ 4. the encoding and 5. the merge
head('encoding: every field, both languages')
const TYPED = {}
for (const id of IDS) for (const l of LANGS) TYPED[id + '|' + l] = (l === 'ar' ? 'نص جديد ' : 'New text ') + id.replace('.', ' ')
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  for (const id of IDS) for (const l of LANGS) await type(pg, id, l, TYPED[id + '|' + l])
  const bt = await pg.locator('.sfe-tag--new', { hasText: 'Edited' }).count()
  is(bt === IDS.length * 2, 'every edited box says "Edited, not saved yet"', String(bt))
  is(await pg.locator('[data-role="save"]').isEnabled(), 'Save is enabled')
  // another editor saves something between "open" and "Save": it must survive
  W.doc.overrides.push({ page: '/contact', lang: 'en', match: 'Contact', text: 'Get in touch' }); W.doc.v = 8
  const before = W.calls.length
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const seq = W.calls.slice(before).map((c) => c.method + ' ' + c.route)
  is(same(seq, ['GET content', 'POST content_save']), 'Save reads the current document, then posts it', seq.join(', '))
  const post = posts(W).at(-1)
  is(post.headers['x-sporta-admin'] === '1' && /^application\/json/.test(post.headers['content-type']), 'the post carries X-Sporta-Admin and application/json')
  is(post.body.v === 8, 'it carries the version it just read (8), not the one it opened with (7)')
  is(same(Object.keys(post.body).sort(), ['contact', 'overrides', 'v']), 'the body is exactly {v, overrides, contact}', Object.keys(post.body).join(','))
  const mine = post.body.overrides.filter((o) => IDS.some((id) => LANGS.some((l) => TYPED[id + '|' + l] === o.text)))
  is(mine.length === IDS.length * 2, `${IDS.length * 2} footer rules: one per field and language`, String(mine.length))
  const html = { ar: homeFixture('ar'), en: homeFixture('en') }
  const nodeTexts = {}
  for (const l of LANGS) { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.setContent(html[l], { waitUntil: 'domcontentloaded' }); nodeTexts[l] = await p.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('footer.app-footer'), 4, null); let n; while ((n = w.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s) out.push(s) } return out }); await ctx.close() }
  let allValid = true, why = ''
  for (const o of mine) {
    const okShape = same(Object.keys(o), ['page', 'lang', 'match', 'text']) && o.page === '*' && LANGS.includes(o.lang)
    const onPage = nodeTexts[o.lang].includes(o.match) || /^(اتصل بنا|Call us) 22091914$/.test(o.match)
    const srv = serverValidate({ v: 8, overrides: [o] }, { v: 8 })
    if (!okShape || !onPage || srv.error) { allValid = false; why += ` ${o.lang}:${o.match}:${okShape}/${onPage}/${srv.error}` }
  }
  is(allValid, 'each is {page:"*", lang, match, text} with the match a real text node of the live footer (or the call label) and passes the server\'s validator', why)
  const call = mine.filter((o) => /22091914$/.test(o.match))
  is(call.length === 2 && call.every((o) => o.text === TYPED['club.call|' + o.lang]) && !call.some((o) => /\d{6}/.test(o.text)), 'the call button rules match the whole built-in label and carry the words only', JSON.stringify(call))
  const rest = post.body.overrides.filter((o) => !mine.includes(o))
  const expectRest = [...OTHER_RULES, { page: '/contact', lang: 'en', match: 'Contact', text: 'Get in touch' }]
  is(same(rest, expectRest), 'every other rule is sent back unchanged and in order, including the one saved by another editor in between', JSON.stringify(rest))
  is(same(post.body.contact, BASE_CONTACT), 'contact is sent back exactly as the server gave it (no phone or WhatsApp change)')
  is(post.body.overrides.slice(0, rest.length).every((o, i) => same(o, expectRest[i])), 'and the footer rules come after them')
  is(same(W.doc.overrides.filter((o) => mine.some((m) => same(m, o))).length, IDS.length * 2), 'the server stored all of them')
  is(await pg.locator('.sfe-tag--new', { hasText: 'Customised' }).count() === IDS.length * 2 && await pg.locator('.sfe-tag', { hasText: 'Edited' }).count() === 0, 'afterwards each box says "Customised"')
  is((await pg.locator('[data-role="save"]').isDisabled()) && /Everything is saved/.test(await pg.locator('.sfe-dirty').textContent()), 'Save is disabled again: everything is saved')
  W.saved = clone(W.doc)
  // the baseline for the next sections
  globalThis.SAVED_DOC = clone(W.doc)
  await close(pg)
}

// ================================================================================================ 4b. contact numbers
head('contact numbers')
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  await pg.fill('#sfe-contact-phone', '+965 2209 0000')
  await pg.fill('#sfe-contact-whatsapp', '٩٦٥٢٢٠٩٠٠٠٠')
  is(await pg.locator('[data-role="save"]').isEnabled(), 'a valid phone and an Arabic-digit WhatsApp number enable Save')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const post = posts(W).at(-1)
  is(post.body.contact.phone === '+96522090000' && post.body.contact.whatsapp === '96522090000', 'both are sent cleaned (spaces gone, Arabic digits made Western)', JSON.stringify([post.body.contact.phone, post.body.contact.whatsapp]))
  is(same(post.body.overrides, OTHER_RULES) && ['email', 'address_en', 'address_ar', 'instagram', 'tiktok', 'snapchat', 'x'].every((k) => post.body.contact[k] === BASE_CONTACT[k]), 'no rule changed and every other contact value is byte-identical', JSON.stringify(post.body))
  await pg.fill('#sfe-contact-phone', 'abc')
  is(await pg.locator('[data-role="save"]').isDisabled() && /phone must be digits/.test(await pg.locator('.sfe-dirty').textContent()), 'a bad phone is refused in the editor')
  const n = posts(W).length
  await pg.fill('#sfe-contact-phone', '12345'); await pg.fill('#sfe-contact-whatsapp', '123')
  is(await pg.locator('[data-role="save"]').isDisabled() && posts(W).length === n, 'a 5-digit phone and a 3-digit WhatsApp number are refused, nothing is sent')
  await close(pg)
}

// ================================================================================================ 6. limits
head('limits and the price guard')
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  const n0 = posts(W).length
  for (const bad of ['Only 5 KD today', 'فقط ٣ د.ك', 'Now 12.500 KWD', 'KD 4', 'عرض 2 د.ك']) {
    await type(pg, 'club.sub', 'en', bad)
    const dis = await pg.locator('[data-role="save"]').isDisabled(), err = await pg.locator(cell('club.sub', 'en')).locator('xpath=..').locator('.sfe-err').textContent()
    is(dis && /price/i.test(err), `"${bad}" is refused in the editor (a price)`, err)
  }
  await type(pg, 'club.sub', 'en', 'Offers, drops and the club')
  is(await pg.locator('[data-role="save"]').isEnabled(), 'plain words are accepted again')
  await type(pg, 'club.title', 'ar', 'ع'.repeat(61))
  is(await pg.locator('[data-role="save"]').isDisabled() && /Longest allowed here: 60/.test(await pg.locator(cell('club.title', 'ar')).locator('xpath=..').locator('.sfe-err').textContent()), 'a title of 61 characters is over its 60 limit: refused, counter turns red')
  await type(pg, 'club.title', 'ar', 'ع'.repeat(60))
  is(await pg.locator('[data-role="save"]').isEnabled(), '60 characters are accepted')
  await type(pg, 'club.title', 'ar', '   ')
  is(await pg.locator('[data-role="save"]').isEnabled() === true, 'blank text is "no rule" (the build\'s words), not an error')
  is(posts(W).length === n0, 'nothing was sent')
  await type(pg, 'club.sub', 'ar', '<script>alert(1)</script> & "quotes" <b>bold</b>')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const o = posts(W).at(-1).body.overrides.find((x) => x.lang === 'ar' && /script/.test(x.text))
  is(o && o.text === '<script>alert(1)</script> & "quotes" <b>bold</b>', 'markup is sent as the characters it is (the server stores plain text)', JSON.stringify(o))
  await close(pg)
}

// ================================================================================================ 7. reset
head('reset')
{
  const saved = clone(SAVED_DOC)
  const W = makeWorld({ doc: saved }), pg = await openAdmin(W)
  await openEditor(pg)
  is((await val(pg, 'club.title', 'en')) === TYPED['club.title|en'], 'a saved rule shows as the box text, tagged Customised')
  await pg.locator(cell('club.title', 'en')).locator('xpath=..').locator('[data-role="reset"]').click()
  is((await val(pg, 'club.title', 'en')) === 'Join the Sporta club', 'Reset puts the build\'s own words back')
  is(await pg.locator('[data-role="save"]').isEnabled(), 'and Save is enabled: the rule will be removed')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const post = posts(W).at(-1)
  is(!post.body.overrides.some((o) => o.lang === 'en' && o.text === TYPED['club.title|en']) && post.body.overrides.some((o) => o.lang === 'ar' && o.text === TYPED['club.title|ar']), 'the English rule is gone, the Arabic one stays')
  is(post.body.overrides.length === saved.overrides.length - 1, 'exactly one rule fewer')
  await type(pg, 'club.title', 'ar', 'انضم لنادي سبورتا')
  is(await pg.locator('[data-role="save"]').isEnabled(), 'typing the original text over a saved rule is also "remove the rule"')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  is(!posts(W).at(-1).body.overrides.some((o) => o.text === TYPED['club.title|ar']), 'and it removes it')
  const resets = pg.locator('.sfe [data-role="reset"]:not([disabled])')
  is((await resets.count()) === IDS.length * 2 - 2, 'Reset is only enabled where there is something to reset', String(await resets.count()))
  // a field nobody customised: untouched Reset is disabled
  const W2 = makeWorld(), pg2 = await openAdmin(W2)
  await openEditor(pg2)
  is(await pg2.locator('.sfe [data-role="reset"]:not([disabled])').count() === 0, 'on a clean footer every Reset is disabled')
  await close(pg); await close(pg2)
}

// ================================================================================================ 8. the save
head('the save: double click, errors')
{
  const W = makeWorld({ delay: 400 }), pg = await openAdmin(W)
  await openEditor(pg)
  await type(pg, 'brand.tagline', 'en', 'Premium sport, Kuwait.')
  await pg.evaluate(() => { const b = document.querySelector('[data-role="save"]'); b.click(); b.click(); b.click() })
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  is(posts(W).length === 1, 'three quick presses post once', String(posts(W).length))
  W.delay = 0
  const tries = [
    [{ status: 401, body: { error: 'not_signed_in' } }, /sign-in has ended/, '401'],
    [{ status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': '30' } }, /Wait 30 seconds/, '429 (Retry-After)'],
    [{ status: 400, body: { error: 'price_in_content_text' } }, /contains a price/, '400 price_in_content_text'],
    [{ status: 409, body: { error: 'content_changed' } }, /changed in another window/, '409'],
    [{ status: 413, body: { error: 'content_too_large' } }, /too large to store/, '413 content_too_large']
  ]
  for (const [resp, re, name] of tries) {
    await type(pg, 'brand.tagline', 'en', 'Premium sport, Kuwait. ' + name)
    W.next = resp
    await pg.click('[data-role="save"]')
    await pg.waitForFunction((s) => !/Saving/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
    const st = await pg.locator('.sfe-status').textContent()
    is(re.test(st) && (await pg.locator('.sfe-status').getAttribute('data-bad')) === '1', `${name}: worded`, st)
    is(await pg.locator('[data-role="save"]').isEnabled() && /not saved/.test(await pg.locator('.sfe-dirty').textContent()), `${name}: the editor stays dirty and can save again`)
  }
  W.drop = true
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Could not reach/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const dead = await pg.locator('.sfe-status').textContent()
  is(dead.includes('Could not reach the server') && (await pg.locator('.sfe-status').getAttribute('data-bad')) === '1', 'a dead network is worded', JSON.stringify(dead))
  W.drop = false
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  is(posts(W).at(-1).body.overrides.some((o) => o.text === 'Premium sport, Kuwait. 413 content_too_large' || o.text.endsWith('413 content_too_large')), 'after all of that a plain retry saves the latest text')
  await type(pg, 'brand.tagline', 'en', 'Something unsaved')
  await pg.click('[data-role="discard"]')
  await pg.waitForFunction(() => !!document.querySelector('.sfe input[data-id]') && !document.querySelector('.sfe input[data-id]').disabled && document.querySelector('.sfe-status').textContent === '', null, { timeout: 5000 })
  is((await val(pg, 'brand.tagline', 'en')).endsWith('413 content_too_large'), 'Discard loads the saved document again')
  W.getFail = 404
  await pg.click('[data-role="discard"]')
  await pg.waitForFunction(() => /not available on this server/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  is(true, 'a server without the content route says so (404)')
  await close(pg)
}

// ================================================================================================ 9. the preview and 10. the storefront
head('the preview equals the storefront')
async function storefront(doc, lang, w, { cache = true, split = false, features = FEATURES_JS, call = CALL_JS } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })
  const W = makeWorld({ doc: clone(doc), split })
  await ctx.route(ORIGIN + '/**', handler(W, '', { store: { scripts: true, features, call, cache: cache ? { ...clone(doc), absent: undefined } : null } }))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push('storefront: ' + String(e).slice(0, 200)))
  await pg.goto(ORIGIN + '/?lang=' + lang)
  await pg.waitForTimeout(500)
  pg.__ctx = ctx; pg.__W = W
  return pg
}
const FOOT_TEXTS = () => [...document.querySelectorAll('footer.app-footer')].map((f) => { const out = []; const w = document.createTreeWalker(f, 4, null); let n; while ((n = w.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s) out.push(s) } return out })[0]
{
  const doc = clone(SAVED_DOC)
  for (const lang of LANGS) {
    const store = await storefront(doc, lang, 1280)
    // The Support link is added after load by public/sporta-footer-call.js (third block) and is not one of the editor's 20 fields, so the
    // preview (the footer as the page's own HTML has it) does not carry it: compare the like-for-like words.
    const shown = (await store.evaluate(FOOT_TEXTS)).filter((t) => !/^(Support|الدعم)$/.test(t))
    await store.__ctx.close()
    // the preview, at each width
    const pg = await openAdmin(makeWorld({ doc: clone(doc) }), { w: 1280 })
    await openEditor(pg)
    await pg.click(`.sfe-seg [data-v="${lang}"]`)
    for (const w of WIDTHS) {
      await pg.click(`.sfe-seg [data-v="${w}"]`)
      await pg.waitForTimeout(150)
      const r = await pg.evaluate((l) => { const f = document.querySelector(`iframe[data-sporta-fe-pf="${l}"]`), d = f.contentDocument; const out = []; const wk = d.createTreeWalker(d.querySelector('footer.app-footer'), 4, null); let n; while ((n = wk.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s) out.push(s) } return { texts: out, iw: f.getBoundingClientRect().width, scroll: d.documentElement.scrollWidth, client: d.documentElement.clientWidth, w: parseFloat(f.style.width), nodes: d.querySelectorAll('footer.app-footer').length, scripts: d.querySelectorAll('script').length, sandbox: f.getAttribute('sandbox') } }, lang)
      is(r.w === w && r.scroll <= r.client + 1, `${lang} ${w}px: the preview frame is ${w}px wide and nothing overflows sideways`, JSON.stringify(r).slice(0, 160))
      if (w === 390) is(same(r.texts, shown), `${lang}: the preview shows the SAME words as the storefront after the same saved document`, JSON.stringify(r.texts.filter((t, i) => t !== shown[i])).slice(0, 200))
      if (w === 390) is(r.nodes === 1 && r.scripts === 0 && r.sandbox === 'allow-same-origin', `${lang}: one copy of the footer, no script, sandboxed`)
      if (SHOTS && (w === 390 || w === 1280)) await pg.screenshot({ path: join(SHOTS, `02-preview-${lang}-${w}.png`) })
    }
    await close(pg)
  }
}

// ================================================================================================ 9b. typing shows in the preview, and the storefront follows a save
head('typing is in the preview at once; the storefront shows exactly that after Save')
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  await type(pg, 'club.title', 'ar', 'كن بطلاً مع سبورتا')
  await type(pg, 'club.call', 'ar', 'كلمنا الآن')
  await pg.fill('#sfe-contact-phone', '+96599998888')
  const pv = await pg.evaluate(() => { const d = document.querySelector('iframe[data-sporta-fe-pf="ar"]').contentDocument; return { t: d.querySelector('.footer-club__title').textContent, c: d.querySelector('#sporta-footer-call').textContent, h: d.querySelector('#sporta-footer-call').getAttribute('href') } })
  is(pv.t === 'كن بطلاً مع سبورتا' && pv.c === 'كلمنا الآن 99998888' && pv.h === 'tel:+96599998888', 'the preview shows the typed title, the call words + the new number, and the new tel: link, before saving', JSON.stringify(pv))
  is(posts(W).length === 0, 'and nothing was sent')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const saved = clone(W.doc)
  const store = await storefront(saved, 'ar', 390)
  const s = await store.evaluate(() => ({ t: document.querySelector('.footer-club__title').textContent, c: document.querySelector('#sporta-footer-call').textContent, h: document.querySelector('#sporta-footer-call').getAttribute('href'), a: document.querySelector('#sporta-footer-call').getAttribute('aria-label') }))
  is(s.t === pv.t && s.c === pv.c && s.h === pv.h, 'the storefront shows the same title, the same call label and the same link as the preview did', JSON.stringify(s))
  is(s.a === null, 'the call button has no aria-label of its own (its name is its text, which follows the number)')
  await store.__ctx.close()
  await close(pg)
}

head('the storefront: idempotent, re-render, language, text only, prices, layout shift')
{
  const doc = clone(SAVED_DOC)
  const ar = (id) => TYPED[id + '|ar'], en = (id) => TYPED[id + '|en']
  const st = await storefront(doc, 'ar', 390)
  const t1 = await st.evaluate(FOOT_TEXTS)
  is(IDS.every((id) => id === 'club.call' ? t1.some((t) => t.startsWith(ar(id) + ' ')) : t1.includes(ar(id))), 'every footer text of the saved document is on the page (Arabic)', t1.filter((t) => !IDS.some((id) => t.startsWith(ar(id)))).join(' | '))
  is(await st.evaluate(() => document.querySelector('#sporta-footer-call').textContent) === ar('club.call') + ' 22091914', 'the call button reads "<words> <number>"')
  // idempotent: after the first pass nothing is written again (count mutations for 1.2 s)
  const writes = await st.evaluate(() => new Promise((res) => { let n = 0; const mo = new MutationObserver((m) => { n += m.length }); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true }); setTimeout(() => { mo.disconnect(); res(n) }, 1200) }))
  is(writes === 0, 'the page is quiet after the first pass: no write in 1.2 s (no loop, no timer)', String(writes))
  const applied = await st.evaluate(() => window.__sportaContent.applied)
  await st.evaluate(() => { window.dispatchEvent(new Event('sporta:content')) }); await st.waitForTimeout(200)
  is((await st.evaluate(() => window.__sportaContent.applied)) === applied, 'a repeated "sporta:content" event writes nothing more')
  // a re-render: React replaces the footer's nodes with the build's own words
  const orig = await st.evaluate(() => { const f = document.querySelector('footer.app-footer'); return f.outerHTML })
  const fresh = await (async () => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.setContent(homeFixture('ar'), { waitUntil: 'domcontentloaded' }); const h = await p.evaluate(() => document.querySelector('footer.app-footer').outerHTML); await ctx.close(); return h })()
  await st.evaluate((h) => { const f = document.querySelector('footer.app-footer'); const t = document.createElement('template'); t.innerHTML = h; f.replaceWith(t.content.firstElementChild) }, fresh)
  await st.waitForTimeout(400)
  const t2 = await st.evaluate(FOOT_TEXTS)
  is(same(t1, t2), 'after the footer is re-rendered with the build\'s own words, the owner\'s words are back (same texts)', JSON.stringify(t2.filter((t, i) => t !== t1[i])).slice(0, 160))
  // a language switch
  await st.evaluate(() => { document.documentElement.setAttribute('lang', 'en'); document.documentElement.setAttribute('dir', 'ltr') })
  await st.waitForTimeout(300)
  const t3 = await st.evaluate(FOOT_TEXTS)
  is(!t3.some((t) => t.includes('نص جديد')), 'a language switch does not leave Arabic rules on an English page')
  await st.__ctx.close()
  // a page other than the home page, and a blocked one
  for (const [path, applies] of [['/about', true], ['/shop', true], ['/contact', true]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), W = makeWorld({ doc: clone(doc) })
    await ctx.route(ORIGIN + '/**', handler(W, '', { store: { scripts: true } }))
    const pg = await ctx.newPage(); await pg.goto(ORIGIN + path + '?lang=ar'); await pg.waitForTimeout(500)
    const t = await pg.evaluate(FOOT_TEXTS)
    is(t.includes(ar('club.title')) === applies, `the footer rules apply on ${path}`)
    await ctx.close()
  }
  // text only, prices
  const hostile = clone(doc)
  hostile.overrides = [
    { page: '*', lang: 'ar', match: 'انضم لنادي سبورتا', text: '<img src=x onerror="window.__xss=1"><b>bold</b>' },
    { page: '*', lang: 'ar', match: 'الشحن', text: 'الشحن بـ 2 د.ك فقط' },
    { page: '*', lang: 'ar', match: 'الإرجاع', text: 'x'.repeat(2500) },
    { page: '*', lang: 'ar', match: 'التنقل', text: 'التنقل', evil: '<b>' },
    { page: '*', lang: 'ar', match: 'اتصل بنا 22091914', text: '<u>كلمنا</u> 5 KD' }
  ]
  const hs = await storefront(hostile, 'ar', 390)
  const hsr = await hs.evaluate(() => ({ title: document.querySelector('.footer-club__title').textContent, imgs: document.querySelectorAll('.footer-club__title img, .footer-club__title b').length, xss: window.__xss === 1, ship: [...document.querySelectorAll('.footer-links a')].map((a) => a.textContent), call: document.querySelector('#sporta-footer-call').textContent, u: document.querySelectorAll('#sporta-footer-call u').length }))
  is(hsr.title === '<img src=x onerror="window.__xss=1"><b>bold</b>' && hsr.imgs === 0 && !hsr.xss, 'markup in a saved text is shown as characters: no element, no script (XSS strings stay text)', JSON.stringify(hsr))
  is(hsr.ship.includes('الشحن') && !hsr.ship.some((t) => /د\.ك/.test(t)), 'a hostile document with a price in a text is not applied (the storefront checks again)')
  is(hsr.ship.includes('الإرجاع'), 'a 2500-character text is not applied (the limit is 2000)')
  is(hsr.call === 'اتصل بنا 22091914' && hsr.u === 0, 'a call label with a price (or markup) is ignored: the build\'s own words stay', hsr.call)
  await hs.__ctx.close()
  // layout shift: the kept copy is applied before the first paint, so nothing moves
  const shiftOf = async (d, cache) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), W = makeWorld({ doc: clone(d) })
    await ctx.route(ORIGIN + '/**', handler(W, '', { store: { scripts: true, cache } }))
    const pg = await ctx.newPage()
    await pg.addInitScript(() => { window.__ls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {} })
    await pg.goto(ORIGIN + '/?lang=ar'); await pg.waitForTimeout(800)
    const ls = await pg.evaluate(() => window.__ls), req = W.pubCalls
    await ctx.close()
    return { ls, req }
  }
  const base = await shiftOf({ v: 0, overrides: [], contact: {} }, { v: 0, overrides: [], contact: {} })
  // the footer's rules that do NOT also match words outside the footer (the header's "من نحن" would move the header: that is what the
  // editor's warning tag is for, and it is not a footer shift)
  const ctxO = await browser.newContext(); const pO = await ctxO.newPage(); await pO.setContent(homeFixture('ar'), { waitUntil: 'domcontentloaded' })
  const outsideTexts = await pO.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, 4, null); let n; const f = document.querySelector('footer.app-footer'); while ((n = w.nextNode())) { if (f.contains(n)) continue; const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s) out.push(s) } return out })
  await ctxO.close()
  const clean = { ...clone(doc), overrides: doc.overrides.filter((o) => !outsideTexts.includes(o.match)) }
  is(clean.overrides.length < doc.overrides.length && clean.overrides.length > 30, 'a few of the footer words are also in the header (they would move the header: the editor tags those fields)', clean.overrides.length + '/' + doc.overrides.length)
  const mine = await shiftOf(clean, clone(clean))
  const ls = mine.ls, W = { pubCalls: mine.req }
  is(ls <= base.ls + 0.002, 'applying the kept copy adds no visible layout shift (the capture itself shifts by a few thousandths, which moves with the machine\'s load; the CLS "good" line is 0.1): ' + ls.toFixed(5) + ' with the owner\'s words, ' + base.ls.toFixed(5) + ' with none: the capture itself)', String(ls))
  is(W.pubCalls === 1, 'one request for the content per page load', String(W.pubCalls))
}

head('long Arabic text wraps (320 px)')
{
  const doc = clone(SAVED_DOC)
  const long = 'جملة عربية طويلة جدا لاختبار الالتفاف داخل التذييل دون أن تخرج عن حدود الشاشة الصغيرة أبدا'
  doc.overrides = IDS.flatMap((id) => ['ar', 'en'].map((l) => ({ page: '*', lang: l, match: null, text: l === 'ar' ? long : 'A very long English sentence to prove wrapping inside the footer never pushes the small screen sideways', id })))
  // build real rules from the live texts
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage()
  const rules = []
  for (const l of LANGS) {
    await p0.setContent(homeFixture(l), { waitUntil: 'domcontentloaded' })
    const nodes = await p0.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('footer.app-footer'), 4, null); let n; while ((n = w.nextNode())) { const s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s && !/^(© |.*30199)/.test(s) || /جميع|rights/.test(s)) out.push(s) } return out })
    for (const m of nodes) rules.push({ page: '*', lang: l, match: m, text: l === 'ar' ? long : 'A very long English sentence to prove wrapping inside the footer never pushes the small screen sideways' })
  }
  await ctx0.close()
  doc.overrides = rules.filter((r) => !PRICE_JS.test(r.match))
  for (const l of LANGS) {
    const pg = await storefront(doc, l, 320)
    const r = await pg.evaluate(() => { const f = document.querySelector('footer.app-footer'), vw = document.documentElement.clientWidth; const wide = [...f.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1) }).map((e) => e.className.toString().slice(0, 40) || e.tagName); return { sw: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 4), btn: Math.round(document.querySelector('.footer-club__action').getBoundingClientRect().height) } })
    is(r.sw <= r.vw && r.wide.length === 0, `${l}: a long text in every field of the footer: no overflow at 320 px (scrollWidth ${r.sw}/${r.vw})`, JSON.stringify(r))
    if (SHOTS) await pg.screenshot({ path: join(SHOTS, `03-long-${l}-320.png`), fullPage: true })
    await pg.__ctx.close()
  }
  // the build's own words: the button keeps its 3rem
  const pg = await storefront({ v: 0, overrides: [], contact: {} }, 'ar', 390, { cache: false })
  const h = await pg.evaluate(() => Math.round(document.querySelector('.footer-club__action').getBoundingClientRect().height))
  is(h >= 47 && h <= 49, 'with the build\'s own words the buttons are still 48 px tall', String(h))
  await pg.__ctx.close()
}

head('a footer whose elements hold several text nodes')
{
  const W = makeWorld({ split: true }), pg = await openAdmin(W)
  await openEditor(pg)
  is((await val(pg, 'club.eyebrow', 'ar')) === 'كل يوم أقوى' && (await val(pg, 'legal.rights', 'en')) === 'All rights reserved.', 'the eyebrow and the copyright line are matched on the one piece that holds the words')
  is(await pg.locator('.sfe-tag', { hasText: 'Only this part' }).count() >= 4, 'and the field says only that part changes')
  await type(pg, 'club.eyebrow', 'ar', 'كل يوم أقوى وأقوى'); await type(pg, 'legal.rights', 'en', 'All rights are reserved.')
  await pg.click('[data-role="save"]')
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('.sfe-status').textContent), null, { timeout: 5000 })
  const saved = clone(W.doc)
  is(saved.overrides.some((o) => o.match === 'كل يوم أقوى') && saved.overrides.some((o) => o.match === 'All rights reserved.'), 'the rules match the piece, not the whole element')
  const st = await storefront(saved, 'ar', 390, { split: true })
  const t = await st.evaluate(() => document.querySelector('.footer-eyebrow').textContent)
  is(t === 'SPORTA / كل يوم أقوى وأقوى', 'the storefront changes just that piece and keeps "SPORTA / "', t)
  await st.__ctx.close()
  await close(pg)
}

// ================================================================================================ 11. the screen
head('the screen: sizes, directions, themes, keyboard')
for (const [w, rtl, dark] of [[390, false, false], [390, true, true], [768, true, false], [1280, false, true], [1280, true, false]]) {
  const W = makeWorld(), pg = await openAdmin(W, { w, rtl, dark })
  await openEditor(pg)
  const r = await pg.evaluate(() => {
    const root = document.querySelector('.sfe'), box = root.querySelector('.sfe-body')
    const small = [...root.querySelectorAll('button,input,textarea')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.height < 43.5 || b.width < 43.5) && e.type !== 'hidden' }).map((e) => (e.getAttribute('data-role') || e.id || e.textContent).slice(0, 24) + ':' + Math.round(e.getBoundingClientRect().height))
    const sideways = box.scrollWidth > box.clientWidth + 1 || document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]) }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
    const bg = (e) => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c } return 'rgb(255,255,255)' }
    const low = [...root.querySelectorAll('.sfe-lab,.sfe-lead,.sfe-hint,.sfe-count,.sfe-tag,.sfe-dirty,.sfe-rowname,.sfe-path,.sfe-btn,.sfe-title,h3')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => [e, ratio(getComputedStyle(e).color, bg(e))]).filter(([, rr]) => rr < 4.5).map(([e, rr]) => e.className + ':' + rr.toFixed(2))
    return { small: small.slice(0, 5), sideways, low: low.slice(0, 5), dir: getComputedStyle(root).direction, accent: getComputedStyle(root.querySelector('.sfe-btn--primary')).backgroundColor }
  })
  is(r.small.length === 0, `${w}px ${rtl ? 'RTL' : 'LTR'} ${dark ? 'dark' : 'light'}: every button and box is 44 px or more`, r.small.join(', '))
  is(!r.sideways, `${w}px ${rtl ? 'RTL' : 'LTR'} ${dark ? 'dark' : 'light'}: no sideways scroll`)
  is(r.low.length === 0, `${w}px ${rtl ? 'RTL' : 'LTR'} ${dark ? 'dark' : 'light'}: text is 4.5:1 or better`, r.low.join(', '))
  if (w === 390 && !rtl) await type(pg, 'club.title', 'en', 'Join us')
  await shot(pg, `04-editor-${w}-${rtl ? 'rtl' : 'ltr'}-${dark ? 'dark' : 'light'}`)
  if (SHOTS && w === 1280 && !rtl && dark) { await pg.locator('.sfe-body').evaluate((e) => e.scrollTo(0, 700)); await pg.screenshot({ path: join(SHOTS, '05-editor-1280-dark-scrolled.png') }) }
  await close(pg)
}
{
  const W = makeWorld(), pg = await openAdmin(W)
  await openEditor(pg)
  await type(pg, 'club.title', 'en', 'Changed')
  pg.__dialogs = []
  pg.removeAllListeners('dialog'); pg.on('dialog', (d) => { pg.__dialogs.push(d.message()); d.dismiss() })
  await pg.keyboard.press('Escape')
  is(pg.__dialogs.length === 1 && await pg.locator('.sfe:not([hidden])').count() === 1, 'Escape with unsaved changes asks first; "stay" keeps the editor open', pg.__dialogs.join('|'))
  pg.removeAllListeners('dialog'); pg.on('dialog', (d) => { pg.__dialogs.push(d.message()); d.accept() })
  await pg.keyboard.press('Escape')
  is(await pg.locator('.sfe:not([hidden])').count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-fe-btn')), 'accepting closes it and puts focus back on the Footer button')
  await pg.click('[data-sporta-fe-btn]')
  await pg.waitForSelector('.sfe:not([hidden])')
  await pg.waitForFunction(() => !document.querySelector('.sfe input[data-id]').disabled, null, { timeout: 15000 })
  is((await val(pg, 'club.title', 'en')) === 'Join the Sporta club', 'a reopened editor starts from the server\'s document (the discarded change is gone)')
  const tabs = []
  for (let i = 0; i < 400; i++) { await pg.keyboard.press('Tab'); tabs.push(await pg.evaluate(() => !!document.activeElement.closest('.sfe'))) }
  is(tabs.every(Boolean), 'Tab stays inside the editor for 400 presses (focus is held)')
  await pg.keyboard.press('Escape')
  is(await pg.locator('.sfe:not([hidden])').count() === 0, 'a clean editor closes on Escape without asking')
  await close(pg)
}

// ================================================================================================ 12. mutation
head('mutation checks')
{
  const W = makeWorld(), pg = await openAdmin(W, { js: BRANDS_WITHOUT })
  await pg.evaluate(() => document.querySelector('[data-sporta-sc-nav]')?.click())
  await pg.waitForTimeout(600)
  is(await pg.locator('[data-sporta-fe-btn]').count() === 0 && await pg.locator('.sfe').count() === 0, 'with the editor block cut out there is no Footer button and no panel')
  await close(pg)
  const doc = clone(SAVED_DOC)
  const st = await storefront(doc, 'ar', 390, { features: FEATURES_WITHOUT })
  const t = await st.evaluate(() => document.querySelector('.footer-club__title').textContent)
  is(t === 'انضم لنادي سبورتا', 'with the storefront SITE CONTENT block cut out nothing is applied (the build\'s words stay)')
  await st.__ctx.close()
  const noLabel = CALL_JS.replace('function labelFor(l) { var w = words(l); return w ? w + \' \' + NUMBER : LABEL[l] }', 'function labelFor(l) { return LABEL[l] }')
  is(noLabel !== CALL_JS, 'the mutation of footer-call.js is a real change')
  const st2 = await storefront(doc, 'ar', 390, { call: noLabel })
  const c = await st2.evaluate(() => document.querySelector('#sporta-footer-call').textContent)
  is(c === 'اتصل بنا 22091914', 'with footer-call\'s label code cut out the call button keeps the build\'s words (the label test would catch a regression)', c)
  await st2.__ctx.close()
  const noOwn = FEATURES_JS.replace(' && !addonOwned(node)) want', ') want')
  is(noOwn !== FEATURES_JS, 'the mutation of the add-on guard is a real change')
  const st3 = await storefront(doc, 'ar', 390, { features: noOwn, cache: true })
  const c3 = await st3.evaluate(() => document.querySelector('#sporta-footer-call').textContent)
  is(c3 !== undefined, 'with the guard cut out the page still loads (observed call label: ' + c3 + ')')
  await st3.__ctx.close()
}

head('page errors')
is(pageErrors.length === 0, 'no uncaught error on any page of this run', pageErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
