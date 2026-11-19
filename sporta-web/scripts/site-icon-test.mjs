// SITE ICON (2026-11-18, owner: "make fav icon changer attached to seo and database") against the real PHP and a real MariaDB, no mocks:
//
//   npm run test:site-icon      (needs `bash scripts/sandbox.sh`: MariaDB, php -S :8095 for the API, :8096 for the rendered pages)
//
// The favicon is changed from the SEO screen of /backends and kept in the database (settings rows site_icon, site_icon_32 / _180 / _192, no migration).
// Asserted, each in its own section:
//   - ADMIN ONLY: the three routes refuse a request with no session and one without the admin header;
//   - SAVE: exactly the three sizes, each a real PNG whose own header says that size; everything else is refused with its own token and NOTHING is written
//     (a half-valid upload leaves the shop's icons as they were): a missing size, an unknown size, a JPEG, an SVG, a PNG of the wrong size, a PNG cut short, a
//     picture over the row's limit, base64 that is not base64;
//   - THE PICTURE: api.php?r=site_icon&s=32|180|192&v=<hash> answers the exact bytes with image/png and a one-year immutable cache; another version, another size
//     or no custom icon at all answers 404 with no-store; HEAD works; nothing is served for a size that was not stored;
//   - THE SEO HEAD: a page the renderer serves has the three icon links pointing at those URLs and none of the shell's own, before a custom icon the shell's own
//     are untouched, and after a reset they are back; ?r=content carries {v, urls} (null before);
//   - RESET: the rows go, the public URLs 404, the head is the shell's again; a second reset is harmless;
//   - ACTIVITY: a save and a reset each leave one row in the admin activity log (and a refused save leaves none).
// Everything the suite creates is the four settings rows (restored to their absence at the end).
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { deflateSync, crc32 } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const STORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'dropin', 'php-store')
// The rig's :8096 serves the raw built shell, not the SEO renderer, so the pages under test are served here: a router that hands every path to the REAL
// seo-page.php of this checkout (it finds dist/index.html itself), the way public/.htaccess does for the pages it names.
const tmp = mkdtempSync(join(tmpdir(), 'site-icon-'))
const PORT = Number(process.env.SITE_ICON_PORT ?? 8397)
const SITE = `http://127.0.0.1:${PORT}`
writeFileSync(join(tmp, 'router.php'), `<?php require ${JSON.stringify(join(STORE, 'seo-page.php'))};\n`)
const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, join(tmp, 'router.php')], { stdio: 'ignore', env: { ...process.env } })
for (let i = 0; i < 50; i++) { try { await fetch(SITE + '/'); break } catch (e) { await new Promise((r) => setTimeout(r, 100)) } }
const stop = () => { try { server.kill() } catch (e) { /* gone */ } rmSync(tmp, { recursive: true, force: true }) }
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())

// ---- a real PNG of any size (8-bit RGBA, one colour or noise), built here: signature, IHDR, IDAT, IEND, with their CRCs
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4)
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([len, t, data, crc])
}
const makePng = (w, h, { noise = false, rgb = [255, 123, 23] } = {}) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = noise ? 2 : 6
  const px = noise ? 3 : 4, rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * px)
    for (let x = 0; x < w; x++) {
      const o = 1 + x * px
      if (noise) { const r = randomBytes(3); row[o] = r[0]; row[o + 1] = r[1]; row[o + 2] = r[2] }
      else { row[o] = rgb[0]; row[o + 1] = rgb[1]; row[o + 2] = rgb[2]; row[o + 3] = 255 }
    }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
// A VALID grey PNG made of uncompressed (stored) deflate blocks of white pixels: its base64 is mostly "////", so it is UNDER the 60,000-character cap
// as sent but about twice that once the row is JSON-encoded (every "/" becomes "\/"), i.e. over what settings.value (TEXT, 64 KB) can hold.
const makeSlashHeavyPng = (n) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0
  const rows = Buffer.alloc(n * (1 + n), 0xff)
  for (let y = 0; y < n; y++) rows[y * (1 + n)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))])
}
const uri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`
const good = () => ({ 32: uri(makePng(32, 32)), 180: uri(makePng(180, 180, { rgb: [255, 255, 255] })), 192: uri(makePng(192, 192)) })

let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.noHeader ? {} : { 'X-Sporta-Admin': '1' }), ...(cookie && !opts.noCookie ? { Cookie: cookie } : {}) },
    method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie'); if (set && !opts.noCookie) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
const post = (route, body, opts = {}) => admin(route, { method: 'POST', body: JSON.stringify(body), ...opts })
const pub = (qs, init = {}) => fetch(`${API}/api.php?${qs}`, init)
const rows = async () => Number(await sql("select count(*) from settings where name in ('site_icon','site_icon_32','site_icon_180','site_icon_192')"))
const events = async (action) => Number(await sql(`select count(*) from admin_activity_log where action_key = '${action}'`))
const iconLinks = (html) => [...html.matchAll(/<link\b[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>/gi)].map((m) => m[0])

const cleanup = () => sql("delete from settings where name in ('site_icon','site_icon_32','site_icon_180','site_icon_192'); delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
await cleanup()
const signIn = await post('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
is(signIn.status === 200, 'the admin signs in', `${signIn.status}`)

// ------------------------------------------------------------------------------------------------------------ admin only
{
  const a = await admin('site_icon', { noCookie: true }), b = await post('site_icon_save', { icons: good() }, { noCookie: true }), c = await post('site_icon_reset', {}, { noCookie: true })
  is([a.status, b.status, c.status].every((s) => s === 401 || s === 403), 'with no session all three routes are refused', `${a.status} ${b.status} ${c.status}`)
  const d = await post('site_icon_save', { icons: good() }, { noHeader: true })
  is(d.status >= 400 && d.status < 500, 'a request without the X-Sporta-Admin header is refused (the CSRF header)', `${d.status}`)
  is((await rows()) === 0, 'and nothing was written by any of them')
}

// ------------------------------------------------------------------------------------------------------------ before: no custom icon
{
  const s = await admin('site_icon')
  is(s.status === 200 && s.body.custom === false && s.body.v === null && JSON.stringify(s.body.sizes) === '[32,180,192]', 'before any save: custom=false, the three sizes named', JSON.stringify(s.body))
  const r = await pub('r=site_icon&s=32&v=abcdefabcdef')
  is(r.status === 404 && /no-store/.test(r.headers.get('cache-control') ?? ''), 'before any save the picture URL is a 404 with no-store')
  const content = await (await pub('r=content')).json()
  is('site_icon' in content && content.site_icon === null, '?r=content carries site_icon: null (the storefront changes nothing)')
  const html = await (await fetch(`${SITE}/?lang=en`)).text()
  const links = iconLinks(html)
  is(links.length === 3 && links.every((l) => /href="\/(favicon-32|favicon-192|apple-touch-icon)\.png"/.test(l)), 'the rendered page keeps the shell\'s own three icon links', links.join(' | '))
}

// ------------------------------------------------------------------------------------------------------------ refused uploads write nothing
{
  const g = good(), before = await events('site_icon_save')
  const bad = [
    ['a missing size (no 192)', { 32: g[32], 180: g[180] }, 'site_icon_missing_size'],
    ['an unknown extra size (64)', { ...g, 64: uri(makePng(64, 64)) }, 'site_icon_unknown_size'],
    ['nothing at all', {}, 'site_icon_missing_size'],
    ['a list instead of an object', [g[32], g[180], g[192]], 'site_icon_missing_size'],
    ['a JPEG (data:image/jpeg)', { ...g, 32: uri(Buffer.from('\xff\xd8\xff\xe0' + 'x'.repeat(200), 'latin1'), 'image/jpeg') }, 'site_icon_not_png'],
    ['an SVG', { ...g, 192: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>').toString('base64') }, 'site_icon_not_png'],
    ['a PNG label on bytes that are not a PNG', { ...g, 180: uri(Buffer.from('not a png at all, just text '.repeat(10)), 'image/png') }, 'site_icon_not_png'],
    ['a 32-pixel PNG sent as the 180', { ...g, 180: uri(makePng(32, 32)) }, 'site_icon_wrong_dimensions'],
    ['a rectangle (192 x 100) sent as the 192', { ...g, 192: uri(makePng(192, 100)) }, 'site_icon_wrong_dimensions'],
    ['a PNG cut short (no IEND)', { ...g, 32: uri(makePng(32, 32).subarray(0, -20)) }, 'site_icon_not_png'],
    ['base64 that is not base64', { ...g, 32: 'data:image/png;base64,@@@@' }, 'site_icon_not_png'],
    ['a plain string that is not a data URI', { ...g, 32: 'https://evil.example/x.png' }, 'site_icon_not_png'],
    ['a picture over the row limit (60,000 base64 characters)', { ...g, 192: uri(makePng(192, 192, { noise: true })) }, 'site_icon_too_large'],
    ['a picture under 60,000 characters whose STORED (JSON-escaped) form is over the 64 KB column', { ...g, 192: uri(makeSlashHeavyPng(192)) }, 'site_icon_too_large'],
  ]
  {
    const b64len = Buffer.from(uri(makeSlashHeavyPng(192)).split(',')[1], 'base64').toString('base64').length
    // PHP's json_encode writes "/" as "\/" (JS's JSON.stringify does not), so count the escapes the way the server's stored form has them
    is(b64len < 60000 && JSON.stringify({ png: uri(makeSlashHeavyPng(192)).split(',')[1] }).replaceAll('/', '\\/').length > 65000,'the escape-heavy fixture is under the base64 cap and over the stored-form cap (so it can only be caught by the second check)', `${b64len} chars`)
  }
  for (const [label, icons, token] of bad) {
    const r = await post('site_icon_save', { icons })
    const t = r.body?.error ?? r.body?.token ?? JSON.stringify(r.body)
    is(r.status >= 400 && r.status < 500 && String(t).includes(token), `refused: ${label}`, `${r.status} ${t}`)
  }
  is((await rows()) === 0, 'after all of those nothing is stored (a half-valid upload leaves the shop\'s icons as they were)')
  is((await events('site_icon_save')) === before, 'and a refused save leaves no activity row')
  const wrongType = await fetch(`${API}/admin.php?r=site_icon_save`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Sporta-Admin': '1', Cookie: cookie }, body: JSON.stringify({ icons: g }) })
  is(wrongType.status === 403 || wrongType.status === 415, 'a body that is not application/json is refused', `${wrongType.status}`)
}

// ------------------------------------------------------------------------------------------------------------ a good save
const g = good()
const evBefore = await events('site_icon_save')
const saved = await post('site_icon_save', { icons: g })
is(saved.status === 200 && saved.body.custom === true && /^[0-9a-f]{12}$/.test(saved.body.v) && JSON.stringify(saved.body.sizes) === '[32,180,192]', 'a valid upload is saved: custom=true and a 12-hex version', JSON.stringify(saved.body))
const V = saved.body?.v
is((await rows()) === 4, 'four settings rows exist (the meta row and one per size) - no migration, the settings table')
is(saved.body.updated_by === 'qa-admin@sporta.test' && /^20\d\d-/.test(saved.body.updated_at ?? ''), 'who and when are recorded', `${saved.body.updated_by} ${saved.body.updated_at}`)
is(!JSON.stringify(saved.body).includes('base64'), 'the admin answer carries no picture data')
is((await events('site_icon_save')) === evBefore + 1, 'the save left exactly one row in the admin activity log')
const st = await admin('site_icon')
is(st.body.custom === true && st.body.v === V, 'the status route reports the same version')
{
  const again = await post('site_icon_save', { icons: g })
  is(again.body?.v === V, 'the same picture again is the same version (the hash is of the content)')
  const other = await post('site_icon_save', { icons: { ...g, 32: uri(makePng(32, 32, { rgb: [0, 0, 0] })) } })
  is(other.body?.v && other.body.v !== V, 'a different picture is a different version, so the old URL stops being the icon')
  await post('site_icon_save', { icons: g })
}
// ---- the picture
for (const size of [32, 180, 192]) {
  const r = await pub(`r=site_icon&s=${size}&v=${V}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  const want = Buffer.from(g[size].split(',')[1], 'base64')
  is(r.status === 200 && r.headers.get('content-type') === 'image/png' && bytes.equals(want), `size ${size}: the exact bytes, image/png`, `${r.status} ${r.headers.get('content-type')} ${bytes.length} of ${want.length}`)
  is(/public/.test(r.headers.get('cache-control') ?? '') && /max-age=31536000/.test(r.headers.get('cache-control') ?? '') && /immutable/.test(r.headers.get('cache-control') ?? '') && r.headers.get('x-content-type-options') === 'nosniff', `size ${size}: one-year immutable cache, nosniff`, r.headers.get('cache-control'))
}
{
  const head = await pub(`r=site_icon&s=32&v=${V}`, { method: 'HEAD' })
  is(head.status === 200 && Number(head.headers.get('content-length')) > 60, 'HEAD answers 200 with a length')
  const oldV = await pub('r=site_icon&s=32&v=000000000000')
  is(oldV.status === 404, 'another version is a 404 (a stale link is not handed a new picture under a URL that promised never to change)')
  const noV = await pub('r=site_icon&s=32')
  is(noV.status === 404, 'no version is a 404')
  for (const s of ['64', '0', '32x', '../32', '']) is((await pub(`r=site_icon&s=${encodeURIComponent(s)}&v=${V}`)).status === 404, `size "${s}" is a 404`)
  const post405 = await pub(`r=site_icon&s=32&v=${V}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  is(post405.status >= 400 && post405.status < 500, 'a POST to the picture URL is refused', `${post405.status}`)
}
// ---- the storefront sees it
{
  const content = await (await pub('r=content')).json()
  is(content.site_icon && content.site_icon.v === V && content.site_icon.urls['32'] === `/api/api.php?r=site_icon&s=32&v=${V}` && content.site_icon.urls['180'] === `/api/api.php?r=site_icon&s=180&v=${V}` && content.site_icon.urls['192'] === `/api/api.php?r=site_icon&s=192&v=${V}`, '?r=content carries the version and the three URLs', JSON.stringify(content.site_icon))
  for (const path of ['/?lang=en', '/shop', '/about', '/contact']) {
    const html = await (await fetch(`${SITE}${path}`)).text()
    const links = iconLinks(html)
    const want = ['32x32', '192x192', '180x180'].map((s) => links.filter((l) => l.includes(`sizes="${s}"`)).length)
    is(links.length === 3 && want.join() === '1,1,1' && links.every((l) => l.includes(`v=${V}`) && !/\/(favicon-32|favicon-192|apple-touch-icon)\.png/.test(l)), `${path}: the head has our three icon links and none of the shell's`, links.join(' | '))
    is(/<link rel="apple-touch-icon" sizes="180x180" href="[^"]*s=180/.test(html) && /<link rel="icon" type="image\/png" sizes="32x32" href="[^"]*s=32/.test(html), `${path}: 32 for the tab, 180 for apple-touch-icon, 192 for the large icon`)
  }
  const prod = await (await pub('r=products')).json()
  const slug = prod[0]?.slug
  if (slug) {
    const html = await (await fetch(`${SITE}/product/${slug}`)).text()
    is(iconLinks(html).every((l) => l.includes(`v=${V}`)) && iconLinks(html).length === 3, 'a product page carries them too', slug)
  }
  const html = await (await fetch(`${SITE}/?lang=en`)).text()
  is((html.match(/<link\b[^>]*rel="canonical"/g) ?? []).length === 1 && /<meta name="robots"/.test(html) && /<title>/.test(html), 'the rest of the SEO head is untouched (one canonical, robots, title)')
}

// ------------------------------------------------------------------------------------------------------------ reset
{
  const evR = await events('site_icon_reset')
  const r = await post('site_icon_reset', {})
  is(r.status === 200 && r.body.custom === false && r.body.v === null, 'reset: back to the shop\'s own icons', JSON.stringify(r.body))
  is((await rows()) === 0, 'reset: all four rows are gone')
  is((await events('site_icon_reset')) === evR + 1, 'reset: one activity row')
  is((await pub(`r=site_icon&s=32&v=${V}`)).status === 404, 'reset: the old picture URL is a 404')
  const links = iconLinks(await (await fetch(`${SITE}/?lang=en`)).text())
  is(links.length === 3 && links.every((l) => /href="\/(favicon-32|favicon-192|apple-touch-icon)\.png"/.test(l)), 'reset: the page has the shell\'s own icon links again', links.join(' | '))
  is((await (await pub('r=content')).json()).site_icon === null, 'reset: ?r=content says null again')
  const twice = await post('site_icon_reset', {})
  is(twice.status === 200 && twice.body.custom === false, 'a second reset is harmless')
}

// ------------------------------------------------------------------------------------------------------------ a damaged row never breaks a page
{
  await sql("insert into settings (name, value) values ('site_icon', '{\"v\":\"zzzz\"}') on duplicate key update value = values(value)")
  const html = await (await fetch(`${SITE}/?lang=en`)).text()
  is(iconLinks(html).length === 3 && iconLinks(html).every((l) => /\/(favicon-32|favicon-192|apple-touch-icon)\.png/.test(l)), 'a meta row with a bad version is ignored: the shell\'s icons stay')
  await sql("update settings set value = '{\"v\":\"0123456789ab\"}' where name = 'site_icon'")
  const r = await pub('r=site_icon&s=32&v=0123456789ab')
  is(r.status === 404, 'a meta row whose pictures are not there answers 404, never an error page', `${r.status}`)
  const page = await fetch(`${SITE}/?lang=en`), links = iconLinks(await page.text())
  is(page.status === 200 && links.length === 3 && links.every((l) => /\/(favicon-32|favicon-192|apple-touch-icon)\.png/.test(l)), 'and the page still renders with the shell\'s own icons (it does not advertise links that would 404)', `${page.status} ${links.join(' | ')}`)
  is((await (await pub('r=content')).json()).site_icon === null, '?r=content says null for it as well')
}

await cleanup()
stop()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
