// The SITE ICON card of the SEO screen (2026-11-18, owner: "make fav icon chenger atteched to seo and database"): the ADMIN SITE ICON block of
// public/sporta-admin-brands.js, in a real browser, against a fake admin.php that answers the way dropin/php-store/site-icon.php does.
//
//   npm run test:admin-site-icon
//
// Asserted:
//   - the card sits under the header of the SEO Editor, only there (not on another screen, gone when the screen goes), once;
//   - it shows what the shop uses now (the shop's own icon, or the custom one with who saved it and when) and reads ONE route, site_icon, writing nothing;
//   - choosing a picture makes THREE PNGs in the browser: exactly 32, 180 and 192 pixels, the centre square of the picture (a wide picture is cropped, not
//     stretched), the 180 drawn on white and the others keeping transparency; nothing is sent until Save is pressed;
//   - the refusals: not an image, an SVG, a file over 8 MB, a picture under 64 px, a file that is not really a picture, a picture too detailed for the row;
//     a small picture warns; a non-square one says it was cropped;
//   - Save posts exactly {icons: {32, 180, 192}} as data:image/png URIs with the admin header, and the card then shows the custom icon through the public URL;
//     a server refusal (each token) or a lost connection keeps the review open and says why, and Save can be pressed again;
//   - "Use the Sporta icon" needs two presses, forgets the first after five seconds, and posts site_icon_reset;
//   - Arabic is right to left; light and dark are readable (4.5:1); the phone layout has no sideways scroll and every control is 44 px;
//   - MUTATIONS: without the white backing of the 180, without the centre crop, without the row-size limit, the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { png as readPng } from './lib/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'public', 'sporta-admin-brands.js'), 'utf8')
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const ORIGIN = 'https://www.sporta.com.kw'

// ---- test pictures, built here as real PNGs
const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]) }
const pngOf = (w, h, pixel) => {   // pixel(x, y) -> [r, g, b, a]
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = []
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) { const p = pixel(x, y); row[1 + x * 4] = p[0]; row[2 + x * 4] = p[1]; row[3 + x * 4] = p[2]; row[4 + x * 4] = p[3] } rows.push(row) }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
const solid = (w, h, c = [255, 123, 23, 255]) => pngOf(w, h, () => c)
const clear = (w, h) => pngOf(w, h, () => [0, 0, 0, 0])
// wide picture: left quarter red, middle half green, right quarter blue - the centre square is all green
const stripes = (w, h) => pngOf(w, h, (x) => (x < w / 4 ? [255, 0, 0, 255] : x >= (w * 3) / 4 ? [0, 0, 255, 255] : [0, 200, 0, 255]))
const noise = (w, h) => { const r = randomBytes(w * h * 3); return pngOf(w, h, (x, y) => { const o = (y * w + x) * 3; return [r[o], r[o + 1], r[o + 2], 255] }) }
const file = (buf, name = 'icon.png', mimeType = 'image/png') => ({ name, mimeType, buffer: buf })
const dimsOf = (uri) => { const b = Buffer.from(uri.split(',')[1], 'base64'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), buf: b } }

// ---- a stand-in for the SEO Editor of the compiled admin: the markup the block hooks into, nothing else
const shell = ({ rtl = false, dark = false, screen = 'seo' } = {}) => `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}" ${dark ? 'class="dark" data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:${dark ? '#0f1419' : '#f4f1ec'};color:${dark ? '#eef2f5' : '#18212a'}}main{padding:1rem;max-width:64rem;margin:0 auto}</style></head><body><main class="admin-content">
${screen === 'seo' ? '<section class="admin-page seo-editor"><div class="admin-page-header"><h1>SEO Editor</h1></div><div class="seo-body"><p>pages and products</p></div></section>' : '<section class="admin-page"><div class="admin-page-header"><h1>Overview</h1></div></section>'}
</main></body></html>`

async function open(W, { w = 1280, h = 900, rtl = false, dark = false, js = SRC, screen = 'seo' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, acceptDownloads: false })
  await ctx.route(ORIGIN + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.pathname.startsWith('/backends')) return route.fulfill({ status: 200, contentType: 'text/html', body: shell({ rtl, dark, screen }) })
    if (u.pathname === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      let body = null; try { body = method === 'POST' ? JSON.parse(req.postData() || 'null') : null } catch (e) { body = '__unparsable__' }
      W.calls.push({ r, method, hdr: req.headers()['x-sporta-admin'] || '', ct: req.headers()['content-type'] || '', body })
      if (W.drop && method === 'POST') return route.abort('failed')
      if (r === 'site_icon') return route.fulfill({ status: W.readStatus ?? 200, contentType: 'application/json', body: JSON.stringify(W.status) })
      if (r === 'site_icon_save') {
        if (W.delay) await sleep(W.delay)
        if (W.refuse) return route.fulfill({ status: W.refuse.status ?? 400, contentType: 'application/json', body: JSON.stringify(W.refuse.body ?? { error: W.refuse.token }) })
        W.status = { custom: true, v: 'abc123def456', sizes: [32, 180, 192], updated_by: 'qa-admin@sporta.test', updated_at: '2026-11-18T10:30:00+00:00' }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(W.status) })
      }
      if (r === 'site_icon_reset') { W.status = { custom: false, v: null, sizes: [32, 180, 192], updated_by: null, updated_at: null }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(W.status) }) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ status: 404, body: 'nf' })
  })
  const pg = await ctx.newPage(), errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await pg.goto(ORIGIN + '/backends/seo')
  await pg.addScriptTag({ content: js })
  await pg.waitForSelector('[data-sporta-sic]', { timeout: 4000 }).catch(() => {})
  await sleep(300)
  pg.__ctx = ctx; pg.__errs = errs
  return pg
}
const world = (over = {}) => ({ calls: [], status: { custom: false, v: null, sizes: [32, 180, 192], updated_by: null, updated_at: null }, ...over })
const close = (pg) => pg.__ctx.close()
const card = (pg) => pg.evaluate(() => {
  const c = document.querySelector('[data-sporta-sic]'); if (!c) return null
  const vis = (n) => !!n && n.getClientRects().length > 0
  const q = (s) => c.querySelector(s)
  return { text: c.innerText.replace(/\s+/g, ' '), note: (q('.sic-note') || {}).textContent || '', noteKind: (q('.sic-note') || {}).getAttribute?.('data-kind') || '', curSrc: q('.sic-now img')?.getAttribute('src'),
    review: vis(q('.sic-review')), changeShown: vis(q('.sic-actions .sic-btn--primary')), resetShown: [...c.querySelectorAll('.sic-btn')].some((b) => /Sporta icon|سبورتا/.test(b.textContent) && vis(b)),
    saveDisabled: q('.sic-review .sic-btn--primary')?.disabled, dir: c.getAttribute('dir'), prev: [...c.querySelectorAll('.sic-prev img')].map((i) => i.getAttribute('src')),
    after: c.previousElementSibling && c.previousElementSibling.classList.contains('admin-page-header'), count: document.querySelectorAll('[data-sporta-sic]').length }
})
const choose = async (pg, f) => { await pg.setInputFiles('[data-sporta-sic] input[type=file]', f); await sleep(500) }
const buttons = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-sporta-sic] .sic-btn')].filter((b) => b.getClientRects().length).map((b) => ({ t: b.textContent, h: Math.round(b.getBoundingClientRect().height) })))
const click = (pg, re) => pg.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('[data-sporta-sic] .sic-btn')].find((x) => r.test(x.textContent) && x.getClientRects().length && !x.disabled); if (b) b.click(); return !!b }, re.source)
const posts = (W) => W.calls.filter((c) => c.method === 'POST')

// ================================================================================================ 1. where it is, what it reads
head('the card on the SEO screen')
{
  const W = world(), pg = await open(W)
  const c = await card(pg)
  is(c && c.count === 1 && c.after === true, 'one card, right under the header of the SEO Editor', JSON.stringify(c && [c.count, c.after]))
  is(/Site icon/.test(c.text) && /Sporta icon/.test(c.text) && c.curSrc === '/favicon-192.png', 'it says the shop uses its own icon and shows it', c.text.slice(0, 120) + ' ' + c.curSrc)
  is(c.changeShown && !c.resetShown && !c.review, '"Change icon" is offered, "Use the Sporta icon" is not (nothing to go back from), no review yet')
  is(W.calls.length === 1 && W.calls[0].r === 'site_icon' && W.calls[0].method === 'GET' && W.calls[0].hdr === '1', 'it read ONE route (site_icon, GET, with the admin header) and wrote nothing', W.calls.map((x) => x.method + ' ' + x.r).join(', '))
  await sleep(1600)
  is(W.calls.length === 1, 'and it does not poll: still one request after a while')
  is(pg.__errs.length === 0, 'no page errors', pg.__errs.join(' | '))
  await close(pg)
}
{
  const pg = await open(world(), { screen: 'overview' })
  is((await card(pg)) === null, 'on another screen there is no card')
  await close(pg)
}
{
  const W = world(), pg = await open(W)
  await pg.evaluate(() => { document.querySelector('.seo-editor').remove() }); await sleep(900)
  is((await card(pg)) === null, 'when the SEO Editor goes the card goes with it')
  await pg.evaluate(() => { const s = document.createElement('section'); s.className = 'admin-page seo-editor'; s.innerHTML = '<div class="admin-page-header"><h1>SEO Editor</h1></div>'; document.querySelector('main').appendChild(s) }); await sleep(900)
  const c = await card(pg)
  is(c && c.count === 1, 'and it comes back (once) when the screen is shown again')
  await close(pg)
}
{
  const W = world({ status: { custom: true, v: 'abc123def456', sizes: [32, 180, 192], updated_by: 'owner@sporta.test', updated_at: '2026-11-18T10:30:00+00:00' } }), pg = await open(W)
  const c = await card(pg)
  is(/Your icon is live/.test(c.text) && /owner@sporta\.test/.test(c.text) && /2026/.test(c.text), 'a custom icon: "Your icon is live", who saved it and when', c.text.slice(0, 160))
  is(c.curSrc === '/api/api.php?r=site_icon&s=192&v=abc123def456' && c.resetShown, 'it is shown through the public picture URL, and "Use the Sporta icon" is offered')
  await close(pg)
}
{
  const W = world({ readStatus: 500, status: { error: 'x' } }), pg = await open(W)
  const c = await card(pg)
  is(c && /could not be read/.test(c.text) && c.changeShown, 'a failed read says so and the card still works', c && c.text.slice(0, 100))
  await close(pg)
}

// ================================================================================================ 2. choosing a picture
head('choosing a picture: three PNGs, made in the browser')
{
  const W = world(), pg = await open(W)
  await choose(pg, file(stripes(400, 200)))
  const c = await card(pg)
  is(c.review && c.prev.length === 3 && c.prev.every((s) => /^data:image\/png;base64,/.test(s)), 'a review with the three previews appears', JSON.stringify(c.prev.map((s) => s.slice(0, 22))))
  const d = c.prev.map(dimsOf)
  is(d[0].w === 32 && d[0].h === 32 && d[1].w === 180 && d[1].h === 180 && d[2].w === 192 && d[2].h === 192, 'exactly 32, 180 and 192 pixels, square', d.map((x) => `${x.w}x${x.h}`).join(' '))
  is(/not square/.test(c.note) && c.noteKind !== 'err', 'a 400 x 200 picture says it was cropped to its centre', c.note)
  const big = readPng(d[2].buf), mid = big.at(96, 96), left = big.at(2, 96), right = big.at(189, 96)
  is(mid.g > 150 && mid.r < 80 && left.g > 150 && left.r < 80 && right.g > 150 && right.b < 80, 'the centre square is used (all green): the red and blue edges are cut off, not squeezed in', JSON.stringify([left, mid, right]))
  is(posts(W).length === 0, 'nothing was sent yet (no POST before Save)', String(posts(W).length))
  await click(pg, /Cancel/)
  const c2 = await card(pg)
  is(!c2.review && c2.changeShown && posts(W).length === 0, 'Cancel closes the review and still sends nothing')
  await close(pg)
}
{
  const W = world(), pg = await open(W)
  await choose(pg, file(clear(300, 300)))
  const c = await card(pg), d = c.prev.map((s) => readPng(dimsOf(s).buf))
  const p180 = d[1].at(2, 2), p32 = d[0].at(2, 2), p192 = d[2].at(2, 2)
  is(p180.r === 255 && p180.g === 255 && p180.b === 255 && p180.a === 255, 'the 180-pixel icon is drawn on WHITE (iOS paints transparency black)', JSON.stringify(p180))
  is(p32.a === 0 && p192.a === 0, 'the 32 and 192 keep their transparency', JSON.stringify([p32, p192]))
  await close(pg)
}
{
  const W = world(), pg = await open(W)
  await choose(pg, file(solid(100, 100)))
  const c = await card(pg)
  is(c.review && /only 100 pixels/.test(c.note), 'a 100-pixel picture is accepted with a blur warning', c.note)
  await close(pg)
}
{
  const W = world(), pg = await open(W)
  const cases = [
    ['an SVG', file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>'), 'x.svg', 'image/svg+xml'), /SVG is not allowed/],
    ['a text file', file(Buffer.from('hello'), 'x.txt', 'text/plain'), /PNG, JPEG or WebP/],
    ['a GIF', file(Buffer.from('GIF89a'), 'x.gif', 'image/gif'), /PNG, JPEG or WebP/],
    ['a file over 8 MB', file(Buffer.alloc(8 * 1024 * 1024 + 10, 1), 'big.png', 'image/png'), /over 8 MB/],
    ['a 40-pixel picture', file(solid(40, 40)), /smaller than 64/],
    ['a "PNG" that is not a picture', file(Buffer.from('not really a png, just some text '.repeat(10)), 'broken.png', 'image/png'), /could not be read/],
    ['a picture too detailed for the row', file(noise(500, 500)), /too detailed/],
  ]
  for (const [label, f, re] of cases) {
    await choose(pg, f)
    const c = await card(pg)
    is(!c.review && re.test(c.note) && c.noteKind === 'err', `refused here, with a sentence: ${label}`, c.note)
  }
  is(posts(W).length === 0, 'and none of them sent anything')
  await close(pg)
}

// ================================================================================================ 3. saving
head('saving, refusals, reset')
{
  const W = world(), pg = await open(W)
  await choose(pg, file(solid(256, 256)))
  const shownPrev = (await card(pg)).prev
  await click(pg, /Save icon/)
  await sleep(600)
  const p = posts(W)
  is(p.length === 1 && p[0].r === 'site_icon_save' && p[0].hdr === '1' && /application\/json/.test(p[0].ct), 'one POST site_icon_save with the admin header and JSON', JSON.stringify(p.map((x) => [x.r, x.hdr])))
  const icons = p[0]?.body?.icons ?? {}
  is(JSON.stringify(Object.keys(icons).sort()) === '["180","192","32"]' && Object.values(icons).every((u) => /^data:image\/png;base64,/.test(u)), 'the body is exactly {icons: {32, 180, 192}} of PNG data URIs', Object.keys(icons).join(','))
  is(icons['32'] === shownPrev[0] && icons['180'] === shownPrev[1] && icons['192'] === shownPrev[2], 'and they are the very pictures the owner reviewed')
  is(Object.keys(p[0].body).join() === 'icons', 'nothing else is in the body', Object.keys(p[0].body).join())
  const c = await card(pg)
  is(!c.review && /Saved\./.test(c.note) && c.noteKind === 'ok' && /Your icon is live/.test(c.text) && c.curSrc === '/api/api.php?r=site_icon&s=192&v=abc123def456' && c.resetShown, 'saved: the card shows the custom icon through the public URL, with a green note', c.note)
  is(pg.__errs.length === 0, 'no page errors', pg.__errs.join(' | '))
  await close(pg)
}
{
  const tokens = [['site_icon_too_large', /too detailed/], ['site_icon_not_png', /could not be read/], ['site_icon_wrong_dimensions', /could not be read/], ['request_too_large', /request_too_large/], ['something_new', /something_new/]]
  for (const [token, re] of tokens) {
    const W = world({ refuse: { token } }), pg = await open(W)
    await choose(pg, file(solid(256, 256)))
    await click(pg, /Save icon/); await sleep(500)
    const c = await card(pg)
    is(c.review && re.test(c.note) && c.noteKind === 'err' && c.saveDisabled === false, `a server refusal "${token}": the review stays open with its reason, Save can be pressed again`, c.note)
    await close(pg)
  }
  const W = world({ refuse: { status: 401, body: { error: 'unauthorized' } } }), pg = await open(W)
  await choose(pg, file(solid(256, 256))); await click(pg, /Save icon/); await sleep(500)
  is(/session ended/.test((await card(pg)).note), 'a 401 says the session ended')
  await close(pg)
  const D = world({ drop: true }), pd = await open(D)
  await choose(pd, file(solid(256, 256))); await click(pd, /Save icon/); await sleep(600)
  const c = await card(pd)
  is(c.review && /could not be saved/.test(c.note) && c.saveDisabled === false, 'a lost connection: "could not be saved", the review stays, Save is back')
  await close(pd)
  const S2 = world({ delay: 600 }), ps = await open(S2)
  await choose(ps, file(solid(256, 256))); await click(ps, /Save icon/); await sleep(150)
  const mid = await card(ps)
  is(mid.saveDisabled === true && /Saving/.test(mid.text), 'while it saves the button says so and cannot be pressed twice')
  await click(ps, /Save icon|Saving/); await sleep(800)
  is(posts(S2).length === 1, 'so one save is one POST', String(posts(S2).length))
  await close(ps)
}
{
  const W = world({ status: { custom: true, v: 'abc123def456', sizes: [32, 180, 192], updated_by: 'o@s.test', updated_at: '2026-11-18T10:30:00+00:00' } }), pg = await open(W)
  await click(pg, /Use the Sporta icon/)
  const a = await card(pg)
  is(/Press again/.test(a.text) && posts(W).length === 0, 'the first press only asks to press again (nothing sent)', a.text.slice(0, 160))
  await sleep(5400)
  const b = await card(pg)
  is(/Use the Sporta icon/.test(b.text) && !/Press again/.test(b.text) && posts(W).length === 0, 'and forgets the first press after five seconds')
  await click(pg, /Use the Sporta icon/); await click(pg, /Press again/); await sleep(500)
  const c = await card(pg)
  is(posts(W).length === 1 && posts(W)[0].r === 'site_icon_reset' && c.curSrc === '/favicon-192.png' && /own Sporta icon/.test(c.text) && !c.resetShown, 'the second press posts site_icon_reset and the card is back on the shop\'s own icon', JSON.stringify(posts(W).map((x) => x.r)))
  await close(pg)
}

// ================================================================================================ 4. language, theme, phone
head('Arabic, dark, phone')
{
  const W = world(), pg = await open(W, { rtl: true })
  const c = await card(pg)
  is(c.dir === 'rtl' && /أيقونة الموقع/.test(c.text) && /أيقونة سبورتا/.test(c.text), 'Arabic: right to left, Arabic words', c.text.slice(0, 100))
  await choose(pg, file(solid(256, 256)))
  const r = await card(pg)
  is(r.review && /معاينة|هذا هو شكلها/.test(r.text) && /تبويب المتصفح/.test(r.text), 'Arabic: the review is in Arabic too')
  await close(pg)
}
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
for (const dark of [false, true]) {
  const W = world({ status: { custom: true, v: 'abc123def456', sizes: [32, 180, 192], updated_by: 'o@s.test', updated_at: '2026-11-18T10:30:00+00:00' } }), pg = await open(W, { dark })
  await choose(pg, file(solid(256, 256)))
  const rows = await pg.evaluate(() => {
    const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return m.slice(0, 3) }
    const bgOf = (n) => { for (let e = n; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba?\(0, 0, 0, 0\)/.test(c) && c !== 'transparent') return parse(c) } return [255, 255, 255] }
    return [...document.querySelectorAll('[data-sporta-sic] :is(h2,p,span,figcaption,button)')].filter((n) => n.getClientRects().length && n.textContent.trim()).map((n) => ({ what: n.tagName + ' ' + n.textContent.trim().slice(0, 30), fg: parse(getComputedStyle(n).color), bg: bgOf(n) }))
  })
  const low = rows.filter((r) => ratio(r.fg, r.bg) < 4.5)
  is(rows.length > 8 && low.length === 0, `${dark ? 'dark' : 'light'}: every text of the card is 4.5:1 or better (${rows.length} checked)`, low.slice(0, 3).map((r) => r.what + ' ' + ratio(r.fg, r.bg).toFixed(2)).join(' | '))
  await close(pg)
}
{
  const W = world({ status: { custom: true, v: 'abc123def456', sizes: [32, 180, 192], updated_by: 'o@s.test', updated_at: '2026-11-18T10:30:00+00:00' } }), pg = await open(W, { w: 390, h: 800 })
  await choose(pg, file(solid(256, 256)))
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const bs = await buttons(pg)
  is(sw <= 0, 'on a phone there is no sideways scroll', String(sw))
  is(bs.length >= 3 && bs.every((b) => b.h >= 44), 'every visible button is 44 px or taller', JSON.stringify(bs))
  await close(pg)
}

// ================================================================================================ 5. mutations
head('mutations: with one rule cut, the matching check goes red')
const MUT = [
  ['without the white backing of the 180', SRC.replace("if (white) { ox.fillStyle = '#ffffff'; ox.fillRect(0, 0, size, size) }", ''),
    async (pg) => { await choose(pg, file(clear(300, 300))); const c = await card(pg); const p = readPng(dimsOf(c.prev[1]).buf).at(2, 2); return p.a === 255 && p.r === 255 } ],
  ['without the centre crop', SRC.replace('sx = Math.floor((d.w - s) / 2), sy = Math.floor((d.h - s) / 2)', 'sx = 0, sy = 0'),
    async (pg) => { await choose(pg, file(stripes(400, 200))); const c = await card(pg); const px = readPng(dimsOf(c.prev[2]).buf); return px.at(2, 96).g > 150 && px.at(2, 96).r < 80 } ],
  ['without the row-size limit', SRC.replace("if (icons[SIZES[i]].length - 'data:image/png;base64,'.length > MAX_B64) throw new Error('heavy')", ''),
    async (pg) => { await choose(pg, file(noise(500, 500))); const c = await card(pg); return !c.review && /too detailed/.test(c.note) } ],
]
for (const [label, text, check] of MUT) {
  if (text === SRC) { is(false, `mutation "${label}": the cut text was found`); continue }
  const run = async (js) => { const pg = await open(world(), { js }); try { return await check(pg) } catch (e) { return 'threw ' + String(e.message).slice(0, 80) } finally { await close(pg) } }
  const good = await run(SRC), bad = await run(text)
  is(good === true, `mutation "${label}": the check passes on the real file`, String(good))
  is(bad === false, `mutation "${label}": and goes red with the rule cut`, String(bad))
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
