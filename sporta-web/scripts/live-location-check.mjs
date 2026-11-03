// READ-ONLY check of the optional "Share my location" control on the LIVE checkout, as served.
//
//   Run ON the VPS in the Playwright image (the sandbox cannot reach www.sporta.com.kw):
//     mkdir -p /w && cd /w && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.49.0
//     node live-location-check.mjs            (fetched from raw.githubusercontent.com at a pushed commit)
//
// What it does: a throwaway browser context adds ONE in-stock item to the bag (client side only), opens
// /checkout, and looks at the control that public/sporta-gov-autopick.js builds. The context has the
// browser's geolocation permission granted and a made-up position in Kuwait City. It taps the control once,
// reads the note, taps Remove. Every request that is not a GET is aborted before it leaves the browser, the
// order button is never pressed, no form is submitted, nobody signs in.
//
// It reports, per language (ar, en) at 390x844 and per page:
//   - the Permissions-Policy header of /checkout (must say geolocation=(self))
//   - document.permissionsPolicy.allowsFeature('geolocation')
//   - geolocation calls BEFORE any tap (must be 0)
//   - the control: present once, where, its text; after a tap the note value, the status line; after Remove the note
//   - a context with the permission DENIED: the message shown, and that the page still works
//   - third-party requests (must be 0), console errors, DOM mutations over 3 s of idle
//   - the control must be ABSENT on /, /shop, a product page and /returns
import { chromium } from 'playwright'

const BASE = 'https://www.sporta.com.kw'
const POS = { latitude: 29.3759, longitude: 47.9774, accuracy: 25 }
const out = []
const P = (s) => { out.push(s); console.log(s) }

const browser = await chromium.launch({ args: ['--no-sandbox'] })

async function session(lang, grant) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: lang === 'ar' ? 'ar-KW' : 'en-US',
    permissions: grant ? ['geolocation'] : [],
    geolocation: POS,
  })
  await ctx.addInitScript(() => {
    window.__geoCalls = 0
    const g = navigator.geolocation
    if (g && g.getCurrentPosition) {
      const orig = g.getCurrentPosition.bind(g)
      g.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a) }
    }
  })
  const page = await ctx.newPage()
  const stat = { blocked: 0, third: 0, errors: [] }
  await page.route('**/*', (route) => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.host !== 'www.sporta.com.kw' && !/^(data|blob):/.test(req.url())) {
      if (!/typekit/.test(u.host)) stat.third++
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') { stat.blocked++; return route.abort() }
    return route.continue()
  })
  page.on('console', (m) => { if (m.type() === 'error') stat.errors.push(m.text().slice(0, 140)) })
  page.on('pageerror', (e) => stat.errors.push('pageerror ' + String(e.message).slice(0, 140)))
  return { ctx, page, stat }
}

const q = (lang, p) => BASE + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')

async function productSlugs(page) {
  try {
    const r = await page.request.get(BASE + '/api/api.php?r=products')
    const j = await r.json()
    const slugs = []
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (typeof x.slug === 'string' && x.slug) slugs.push(x.slug); else Object.values(x).forEach(walk) } }
    walk(j)
    return [...new Set(slugs)].slice(0, 14)
  } catch (e) { return [] }
}

async function addItem(page, lang) {
  const slugs = await productSlugs(page)
  let last = 'no products from the API'
  for (const slug of slugs) {
    await page.goto(q(lang, '/product/' + slug), { waitUntil: 'load' })
    await page.waitForTimeout(2200)
    const act = await page.evaluate(() => {
      const SZ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'ONE SIZE', 'FREE SIZE']
      const bs = [...document.querySelectorAll('main button')]
      const size = bs.find((b) => !b.disabled && SZ.includes((b.textContent || '').trim().toUpperCase()))
      if (size) size.click()
      return size ? 'size ' + size.textContent.trim() : 'no size button'
    })
    await page.waitForTimeout(500)
    const add = await page.evaluate(() => {
      const txt = (x) => (x.textContent || '').replace(/\s+/g, ' ').trim()
      const bs = [...document.querySelectorAll('main button')].filter((x) => !x.disabled)
      const b = bs.find((x) => !/wish|favou?rite|save|buy now|size|المفضلة|مقاس/i.test(txt(x)) && /^(add|أضف|اضف)/i.test(txt(x)))
      if (b) { b.click(); return 'clicked ' + txt(b).slice(0, 30) }
      return 'no add button'
    })
    await page.waitForTimeout(1500)
    last = slug + ': ' + act + ' / ' + add
    if (/^clicked/.test(add)) return last
  }
  return last
}

const ctlInfo = (page) => page.evaluate(() => {
  const root = document.getElementById('sporta-loc')
  const ta = document.getElementById('f-note')
  const r = root ? root.getBoundingClientRect() : null
  return {
    count: document.querySelectorAll('#sporta-loc').length,
    parentIsGridOfNote: !!(root && ta && root.parentElement === ta.parentElement.parentElement),
    box: r ? [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)].join(',') : null,
    btn: (document.getElementById('sporta-loc-btn') || {}).textContent || null,
    status: ((document.getElementById('sporta-loc-status') || {}).textContent || '').trim(),
    note: ta ? ta.value : null,
    allows: document.permissionsPolicy ? document.permissionsPolicy.allowsFeature('geolocation') : 'n/a',
    geoCalls: window.__geoCalls,
    buttons: root ? [...root.querySelectorAll('button')].map((b) => (b.textContent || '').trim() + (b.disabled ? '[disabled]' : '')) : [],
  }
})

for (const lang of ['ar', 'en']) {
  // ---- granted
  {
    const { ctx, page, stat } = await session(lang, true)
    const tag = '[' + lang + ' granted]'
    P(tag + ' ITEM ' + (await addItem(page, lang)))
    const resp = await page.goto(q(lang, '/checkout'), { waitUntil: 'load' })
    await page.waitForTimeout(3500)
    P(tag + ' HEADER permissions-policy: ' + (resp.headers()['permissions-policy'] || '(none)').split(',').filter((x) => /geolocation/.test(x)).join(','))
    const a = await ctlInfo(page)
    P(tag + ' BEFORE TAP ' + JSON.stringify(a))
    // mutations over 3 s of idle
    const muts = await page.evaluate(() => new Promise((res) => { let n = 0; const o = new MutationObserver((l) => { n += l.length }); o.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { o.disconnect(); res(n) }, 3000) }))
    P(tag + ' IDLE MUTATIONS 3s: ' + muts)
    if (a.count === 1) {
      await page.click('#sporta-loc-btn')
      await page.waitForTimeout(2500)
      const b = await ctlInfo(page)
      P(tag + ' AFTER TAP ' + JSON.stringify(b))
      // typing after the line is added must keep it and let React state follow
      await page.focus('#f-note')
      await page.keyboard.type(' x')
      await page.waitForTimeout(300)
      P(tag + ' AFTER TYPING note=' + JSON.stringify(await page.evaluate(() => document.getElementById('f-note').value)))
      const rm = await page.evaluate(() => { const b = [...document.querySelectorAll('#sporta-loc button')].find((x) => /remove|إزالة|حذف/i.test(x.textContent || '')); if (b) { b.click(); return 'clicked ' + b.textContent.trim() } return 'no remove button' })
      await page.waitForTimeout(600)
      const c = await ctlInfo(page)
      P(tag + ' REMOVE ' + rm + ' -> note=' + JSON.stringify(c.note) + ' status=' + JSON.stringify(c.status))
    }
    P(tag + ' REQUESTS blocked-non-GET=' + stat.blocked + ' third-party=' + stat.third + ' console-errors=' + stat.errors.length + ' ' + JSON.stringify(stat.errors.slice(0, 3)))
    await ctx.close()
  }
  // ---- denied
  {
    const { ctx, page, stat } = await session(lang, false)
    const tag = '[' + lang + ' denied]'
    P(tag + ' ITEM ' + (await addItem(page, lang)))
    await page.goto(q(lang, '/checkout'), { waitUntil: 'load' })
    await page.waitForTimeout(3500)
    const a = await ctlInfo(page)
    if (a.count === 1) {
      await page.click('#sporta-loc-btn')
      await page.waitForTimeout(2000)
      P(tag + ' AFTER TAP ' + JSON.stringify(await ctlInfo(page)))
    } else P(tag + ' control count ' + a.count)
    P(tag + ' REQUESTS blocked-non-GET=' + stat.blocked + ' third-party=' + stat.third + ' console-errors=' + stat.errors.length)
    await ctx.close()
  }
}

// ---- the control must be absent elsewhere
{
  const { ctx, page } = await session('ar', true)
  for (const p of ['/', '/shop', '/returns', '/about', '/privacy']) {
    await page.goto(BASE + p, { waitUntil: 'load' })
    await page.waitForTimeout(1800)
    P('[absent?] ' + p + ' #sporta-loc count=' + (await page.evaluate(() => document.querySelectorAll('#sporta-loc').length)))
  }
  await ctx.close()
}
await browser.close()
P('LOCATION_CHECK_DONE')
