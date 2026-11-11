// READ-ONLY check of the live admin add-on split (scripts/split-admin-addon.mjs). GET only: no sign-in, no form, no POST.
//   run on the VPS (Playwright image), see CLAUDE.md "Probing the live site from a session"
//
// Proves on https://www.sporta.com.kw: a shopper page loads the 1 kB loader and NEVER asks for the admin code; /backends asks for it
// once and it runs (the sign-in screen's own text is changed by it: the compiled build says 8 hours, the add-on says 30 days);
// the caching headers of both names; /favicon.ico answers 200.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
const browser = await chromium.launch()
let bad = 0
const flag = (c, m) => { if (!c) bad++; out((c ? 'ok   ' : 'FAIL ') + m) }
for (const [path, label] of [['/', 'home ar'], ['/?lang=en', 'home en'], ['/shop', 'shop ar'], ['/product/cagliari-calcio-backpack', 'product ar'], ['/backends', 'backends']]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  const reqs = []
  p.on('response', (r) => { const u = new URL(r.url()); if (/sporta-admin-brands|favicon\.ico/.test(u.pathname)) reqs.push({ path: u.pathname + u.search, status: r.status(), cc: r.headers()['cache-control'] || '', len: Number(r.headers()['content-length'] || 0), enc: r.headers()['content-encoding'] || '' }) })
  await p.goto(B + path, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(2500)
  const info = await p.evaluate(() => ({ text: document.body.innerText.slice(0, 600), n: performance.getEntriesByType('resource').filter((e) => /sporta-admin-brands/.test(e.name)).map((e) => e.name.replace(location.origin, '') + ' ' + e.transferSize + 'B') }))
  out(`== ${label} ${path}: ${JSON.stringify(reqs)} | resource timing ${JSON.stringify(info.n)} | page errors ${JSON.stringify(errs)}`)
  if (path !== '/backends') {
    flag(!reqs.some((r) => /full/.test(r.path)), `${label}: the admin code is NOT requested`)
    flag(reqs.some((r) => r.path.startsWith('/sporta-admin-brands.js') && r.status === 200), `${label}: the loader is served (200)`)
  } else {
    flag(reqs.filter((r) => /full/.test(r.path)).length === 1 && reqs.find((r) => /full/.test(r.path)).status === 200, 'backends: the admin code is requested once and served (200)')
    flag(errs.length === 0, 'backends: no page errors')
    out('   sign-in text: ' + JSON.stringify(info.text.replace(/\s+/g, ' ').slice(0, 300)))
    flag(!/8 hours|٨ ساعات|8 ساعات/.test(info.text), 'backends: the old "8 hours" line is gone (the add-on rewrote it)')
  }
  await ctx.close()
}
const ctx = await browser.newContext()
for (const f of ['/sporta-admin-brands.js?v=1', '/sporta-admin-brands.full.js?v=1', '/favicon.ico']) {
  const r = await ctx.request.get(B + f, { headers: { 'accept-encoding': 'gzip' } })
  const h = r.headers()
  const body = await r.body()
  out(`${f} -> ${r.status()} ${h['content-type']} cache-control="${h['cache-control'] || ''}" encoding=${h['content-encoding'] || '-'} wire~${h['content-length'] || '?'}B decoded=${body.length}B`)
  if (f.includes('.js')) flag(/no-cache/.test(h['cache-control'] || ''), f + ' is no-cache')
  if (f.endsWith('favicon.ico')) flag(r.status() === 200 && /icon|png/.test(h['content-type'] || ''), '/favicon.ico answers 200 with an image type')
}
await browser.close()
out(bad ? `PROBE_FAIL ${bad}` : 'PROBE_OK')
