// READ-ONLY candidate check for the "location line is never persisted" fix, against the LIVE checkout.
//
//   Run ON the VPS in the Playwright image (the sandbox cannot reach www.sporta.com.kw):
//     mkdir -p /w && cd /w && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.49.0
//     node live-location-fix-check.mjs <pushed full commit sha>     (this file is fetched from raw.githubusercontent.com)
//
// PART 0 (discovery, plain fetch): the live index.html's script/link order and every place the compiled bundle names
//   "sporta.delivery" (key + neighbouring read/write code), so the key and the JSON shape are measured, not assumed.
// PART 1 (browser): the candidate public/sporta-gov-autopick.js (fetched at <sha>) is injected into the live /checkout
//   BEFORE the app reads storage (addInitScript) AND replaces the live file when the page requests it (a route), so
//   the file is evaluated twice per page and the guard must make that harmless. A throwaway context adds one in-stock
//   item to the bag (client side), then a complete SYNTHETIC saved-details profile whose note holds a location line is
//   written straight into localStorage behind the page's back (an iframe's native Storage), the page is loaded and:
//     - the stored value must no longer hold the line (read natively, also via the page's own getItem)
//     - if the quick checkout appears, its text must not hold the line; it is then left through its own edit button
//     - the details form works, and the control works end to end with a mocked position (granted geolocation)
//     - the in-page note keeps the line it was given; the stored value still has none after the tap
//   Every request that is not a GET is aborted before it leaves the browser. Nothing is submitted, the order button
//   and "continue" are never pressed, nobody signs in.
import { chromium } from 'playwright'

const SHA = process.argv[2] || process.env.CAND_SHA
if (!/^[0-9a-f]{40}$/.test(SHA || '')) { console.log('usage: node live-location-fix-check.mjs <40-char sha>'); process.exit(2) }
const BASE = 'https://www.sporta.com.kw'
const RAW = `https://raw.githubusercontent.com/hkspower/wain/${SHA}/sporta-web/public/sporta-gov-autopick.js`
const KEY = 'sporta.delivery'
const POS = { latitude: 29.3759, longitude: 47.9774, accuracy: 25 }
const LINE_EN = 'Location: https://www.google.com/maps?q=29.111111,47.222222'
const LINE_AR = 'الموقع: https://www.google.com/maps?q=29.333333,47.444444'
const PROFILE = (note) => ({ name: 'Probe Test', phone: '55500000', governorate: 'hawalli', area: 'Salmiya', block: '1', street: 'Test street', building: '1', floor: '', flat: '', note })
const out = []
const P = (s) => { out.push(s); console.log(s) }
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 sporta-probe' } }); return r.ok ? await r.text() : '' }

// ---------------------------------------------------------------- PART 0
{
  const html = await get(BASE + '/')
  P('[0] index.html bytes ' + html.length)
  const tags = [...html.matchAll(/<(script|link)\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /src=|href=/.test(t) && /\.js|\.css/.test(t))
  tags.forEach((t, i) => P('[0] tag ' + i + ' ' + t.slice(0, 150)))
  const seen = new Set(), queue = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  let n = 0
  while (queue.length && n < 80) {
    const p = queue.shift()
    if (seen.has(p)) continue
    seen.add(p); n++
    const t = await get(BASE + p)
    for (const m of t.matchAll(/["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]/g)) queue.push('/assets/' + m[1])
    for (const m of t.matchAll(/["'`]\/assets\/([A-Za-z0-9_.-]+\.js)["'`]/g)) queue.push('/assets/' + m[1])
    for (const needle of ['sporta.delivery', 'sessionStorage.setItem']) {
      let i = 0, hits = 0
      while ((i = t.indexOf(needle, i)) >= 0 && hits < 5) {
        P('[0] --- ' + p + ' ' + needle + ' @' + i + '\n' + t.slice(Math.max(0, i - 300), i + 450))
        i += needle.length; hits++
      }
    }
  }
  P('[0] scanned ' + n + ' bundle files')
}

// ---------------------------------------------------------------- PART 1
const CAND = await get(RAW)
P('[1] candidate bytes ' + CAND.length + ' from ' + SHA.slice(0, 10) + (CAND.includes('sporta.delivery') ? ' (has the storage rule)' : ' (NO storage rule: wrong sha?)'))
if (!CAND.includes('sporta.delivery')) process.exit(3)

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const q = (lang, p) => BASE + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')

async function session(lang) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', permissions: ['geolocation'], geolocation: POS })
  const stat = { blocked: 0, third: 0, errors: [], addonServed: 0 }
  await ctx.addInitScript(() => { window.__geoCalls = 0; const g = navigator.geolocation; if (g && g.getCurrentPosition) { const o = g.getCurrentPosition.bind(g); g.getCurrentPosition = (...a) => { window.__geoCalls++; return o(...a) } } })
  await ctx.addInitScript(CAND)   // BEFORE the app: this is the "candidate wrapper installed before the app reads storage" case
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.host !== 'www.sporta.com.kw' && !/^(data|blob):/.test(req.url()) && !/typekit/.test(u.host)) stat.third++
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') { stat.blocked++; return route.abort() }
    if (u.host === 'www.sporta.com.kw' && u.pathname === '/sporta-gov-autopick.js') { stat.addonServed++; return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: CAND }) }
    return route.continue()
  })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') stat.errors.push(m.text().slice(0, 140)) })
  page.on('pageerror', (e) => stat.errors.push('pageerror ' + String(e.message).slice(0, 140)))
  return { ctx, page, stat }
}

async function productSlugs(page) {
  try {
    const j = await (await page.request.get(BASE + '/api/api.php?r=products')).json()
    const slugs = []
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (typeof x.slug === 'string' && x.slug) slugs.push(x.slug); else Object.values(x).forEach(walk) } }
    walk(j)
    return [...new Set(slugs)].slice(0, 14)
  } catch (e) { return [] }
}
async function addItem(page, lang) {
  let last = 'no products from the API'
  for (const slug of await productSlugs(page)) {
    await page.goto(q(lang, '/product/' + slug), { waitUntil: 'load' })
    await page.waitForTimeout(2200)
    const act = await page.evaluate(() => { const SZ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'ONE SIZE', 'FREE SIZE']; const size = [...document.querySelectorAll('main button')].find((b) => !b.disabled && SZ.includes((b.textContent || '').trim().toUpperCase())); if (size) size.click(); return size ? 'size ' + size.textContent.trim() : 'no size button' })
    await page.waitForTimeout(500)
    const add = await page.evaluate(() => { const txt = (x) => (x.textContent || '').replace(/\s+/g, ' ').trim(); const b = [...document.querySelectorAll('main button')].filter((x) => !x.disabled).find((x) => !/wish|favou?rite|save|buy now|size|المفضلة|مقاس/i.test(txt(x)) && /^(add|أضف|اضف)/i.test(txt(x))); if (b) { b.click(); return 'clicked ' + txt(b).slice(0, 30) } return 'no add button' })
    await page.waitForTimeout(1500)
    last = slug + ': ' + act + ' / ' + add
    if (/^clicked/.test(add)) return last
  }
  return last
}
// The page's own Storage is wrapped by the candidate; an iframe's Storage is not.
const nativeSet = (page, v) => page.evaluate(([k, val]) => { const f = document.createElement('iframe'); f.style.display = 'none'; document.body.appendChild(f); try { f.contentWindow.Storage.prototype.setItem.call(window.localStorage, k, val) } finally { f.remove() } }, [KEY, v])
const nativeGet = (page) => page.evaluate((k) => { const f = document.createElement('iframe'); f.style.display = 'none'; document.body.appendChild(f); try { return f.contentWindow.Storage.prototype.getItem.call(window.localStorage, k) } finally { f.remove() } }, KEY)

let failures = 0
const check = (ok, msg, detail = '') => { if (!ok) failures++; P((ok ? 'PASS ' : 'FAIL ') + msg + (detail ? '  -- ' + detail : '')) }

for (const lang of ['ar', 'en']) {
  const { ctx, page, stat } = await session(lang)
  const tag = '[' + lang + ']'
  P(tag + ' ITEM ' + (await addItem(page, lang)))
  const line = lang === 'ar' ? LINE_AR : LINE_EN
  const profile = PROFILE('Gate 3 ' + line)
  await nativeSet(page, JSON.stringify(profile))
  const seeded = await nativeGet(page)
  check(seeded.includes('google.com/maps'), tag + ' seeded a complete synthetic profile with a location line (natively, behind the wrapper)')

  // fresh load of /checkout: the candidate is injected before the app, and the live file request is answered by it too
  await page.goto(q(lang, '/checkout'), { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  const after = await nativeGet(page)
  let obj = null; try { obj = JSON.parse(after) } catch (e) { obj = null }
  check(after !== null && !after.includes('google.com/maps'), tag + ' the stored value no longer holds the line after loading /checkout', String(after).slice(0, 160))
  check(obj && obj.note === 'Gate 3' && obj.name === profile.name && obj.phone === profile.phone && obj.area === profile.area && obj.block === profile.block, tag + ' and the rest of the profile is exactly as seeded', JSON.stringify(obj))
  check((await page.evaluate((k) => localStorage.getItem(k), KEY)) === after, tag + ' the page\'s own getItem agrees')
  const view = await page.evaluate(() => {
    const quick = document.querySelector('form.purchase-quick')
    return { quick: !!quick, quickText: quick ? quick.innerText : null, ta: !!document.getElementById('f-note'), ctl: document.querySelectorAll('#sporta-loc').length, marker: document.documentElement.__sportaLocJs === 1, wraps: !!Storage.prototype.setItem.__sportaLoc }
  })
  P(tag + ' VIEW ' + JSON.stringify({ ...view, quickText: view.quickText && view.quickText.slice(0, 200) }))
  check(view.marker && view.wraps && stat.addonServed >= 1, tag + ' the candidate is active (marker, wrapper) and the live file request was answered with it x' + stat.addonServed)
  if (view.quick) {
    check(!/google\.com\/maps|Location:|الموقع:/.test(view.quickText), tag + ' the quick checkout shows the note WITHOUT the pin')
    const left = await page.evaluate(() => { const b = [...document.querySelectorAll('form.purchase-quick button, form.purchase-quick a')].find((x) => /edit|change|تعديل|تغيير|details|بيانات/i.test((x.textContent || '').trim()) && !/pay|continue|order|confirm|ادفع|تأكيد|متابعة|اطلب/i.test((x.textContent || '').trim())); if (b) { b.click(); return 'clicked ' + b.textContent.trim().slice(0, 30) } return 'no edit button' })
    P(tag + ' LEAVE QUICK ' + left)
    await page.waitForTimeout(1200)
  }
  const form = await page.evaluate(() => ({ ta: !!document.getElementById('f-note'), noteValue: (document.getElementById('f-note') || {}).value, ctl: document.querySelectorAll('#sporta-loc').length }))
  check(form.ta && form.ctl === 1, tag + ' the details form shows with exactly one location control', JSON.stringify(form))
  check(form.noteValue === undefined || !/google\.com\/maps/.test(form.noteValue), tag + ' and the note field does not hold the old pin', JSON.stringify(form.noteValue))
  if (form.ta && form.ctl === 1) {
    const mut = await page.evaluate(() => new Promise((res) => { let n = 0; const o = new MutationObserver((l) => { n += l.length }); o.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { o.disconnect(); res(n) }, 3000) }))
    P(tag + ' IDLE MUTATIONS 3s: ' + mut)
    check(mut <= 6, tag + ' no two-instance mutation storm with the file evaluated twice (' + mut + ' records in 3 s)')
    const geo0 = await page.evaluate(() => window.__geoCalls)
    await page.click('#sporta-loc-btn')
    await page.waitForTimeout(2500)
    const t = await page.evaluate(() => ({ note: document.getElementById('f-note').value, status: (document.getElementById('sporta-loc-status') || {}).textContent, btn: (document.getElementById('sporta-loc-btn') || {}).textContent, calls: window.__geoCalls }))
    check(geo0 === 0 && t.calls === 1, tag + ' nothing asked before the tap; one lookup for the tap', geo0 + '/' + t.calls)
    check(/maps\?q=29\.375900,47\.977400/.test(t.note) && (t.note.match(/google\.com\/maps/g) || []).length === 1, tag + ' the control wrote exactly one line with the mocked position', JSON.stringify(t.note))
    await page.focus('#f-note'); await page.keyboard.type(' x'); await page.waitForTimeout(400)
    const typed = await page.evaluate(() => document.getElementById('f-note').value)
    check(typed.endsWith(' x') && (typed.match(/google\.com\/maps/g) || []).length === 1, tag + ' typing after the line works and keeps it (React state follows)', JSON.stringify(typed.slice(-40)))
    const stored2 = await nativeGet(page)
    check(stored2 !== null && !stored2.includes('google.com/maps'), tag + ' after the tap the stored profile STILL has no line (the in-page note keeps its own)')
    const rm = await page.evaluate(() => { const b = [...document.querySelectorAll('#sporta-loc button')].find((x) => /remove|إزالة|حذف/i.test(x.textContent || '')); if (b) { b.click(); return 'clicked ' + b.textContent.trim() } return 'no remove button' })
    await page.waitForTimeout(600)
    P(tag + ' REMOVE ' + rm + ' -> note=' + JSON.stringify(await page.evaluate(() => document.getElementById('f-note').value)))
  }
  P(tag + ' REQUESTS blocked-non-GET=' + stat.blocked + ' third-party=' + stat.third + ' console-errors=' + stat.errors.length + ' ' + JSON.stringify(stat.errors.slice(0, 3)))
  await ctx.close()
}
await browser.close()
P(failures ? 'LOCATION_FIX_CHECK_FAILED ' + failures : 'LOCATION_FIX_CHECK_DONE')
