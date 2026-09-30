/**
 * The brand-logo FILE route: which names it finds, and what it calls them.
 *
 * WHY THIS RIG EXISTS. `images/<slug>/logo.*` is the owner's only upload route
 * that needs no panel — drop a file in a folder — and it matched exactly three
 * names, `logo.png`, `logo.webp` and `logo.jpg`, with is_file(). Linux is
 * case-sensitive, so `logo.PNG` and `logo.JPG` were invisible, and so was
 * `logo.jpeg`, which is the commoner spelling and what most export dialogues
 * produce. The failure is silent in the worst way: the folder is right, the
 * picture is in it, and the shop serves a placeholder for ever.
 *
 * It also pins the thing that makes a FOUND file still not appear. The route
 * sends `X-Content-Type-Options: nosniff`, so a Content-Type that does not
 * match the bytes is not a detail — the browser REFUSES to draw the image. The
 * old map ended `?? 'image/png'`, which turned any unlisted extension into an
 * unrenderable logo; and an owner who exports a PNG and names it `.jpg` hits
 * the same wall from the other side. The type is read from the file's own
 * first bytes now, and that is asserted here rather than assumed.
 *
 * Every fixture is written and removed by this rig. It touches one brand's
 * folder and puts it back exactly as it found it.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.SPORTA_BASE || 'http://127.0.0.1:4300'
const ROOT = new URL('../sporta-site/public_html', import.meta.url).pathname
const SLUG = process.env.SPORTA_BRAND || 'ahed'
const DIR = join(ROOT, 'images', SLUG)

let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

/* Real, minimal files of each kind. A magic-byte check is only tested by bytes
   that actually carry the magic, so these are genuine images rather than text
   with an image's name — the mistake that would make every assertion below
   pass against a route that looked at the extension alone. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
const WEBP = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

const before = existsSync(DIR) ? readdirSync(DIR) : null
const written = []
const put = (name, buf) => { mkdirSync(DIR, { recursive: true }); const p = join(DIR, name); writeFileSync(p, buf); written.push(p) }
const clear = () => { for (const p of written.splice(0)) rmSync(p, { force: true }) }

const fetchLogo = async () => {
  // A fresh query string each time: the route answers `max-age=31536000,
  // immutable`, and a cached 200 from the previous fixture would make every
  // case after the first agree with the first.
  const r = await fetch(`${BASE}/api/api.php?r=brand_logo&slug=${SLUG}&_=${Math.random()}`,
    { redirect: 'manual' })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, type: r.headers.get('content-type'), len: buf.length, buf }
}

console.log(`brand logo files — ${SLUG} at ${BASE}\n`)

// A route that is already serving something would make "the logo was found"
// true before any fixture existed.
clear()
const empty = await fetchLogo()
const placeholderLen = empty.len
console.log(`     with no file: ${empty.status} ${empty.type} ${empty.len}b   (the placeholder)\n`)

/* ------------------------------------------------- the names that must work */
const NAMES = [
  ['logo.png',  PNG,  'image/png'],
  ['logo.webp', WEBP, 'image/webp'],
  ['logo.jpg',  JPEG, 'image/jpeg'],
  ['logo.jpeg', JPEG, 'image/jpeg'],   // was invisible
  ['logo.PNG',  PNG,  'image/png'],    // was invisible
  ['logo.JPG',  JPEG, 'image/jpeg'],   // was invisible
  ['logo.Webp', WEBP, 'image/webp'],   // was invisible
]
for (const [name, bytes, want] of NAMES) {
  clear()
  put(name, bytes)
  const r = await fetchLogo()
  const served = r.status === 200 && r.len === bytes.length
  if (!served) bad(`${name} is served`, `${r.status} ${r.len}b, wanted ${bytes.length}b`)
  else if ((r.type || '').split(';')[0] !== want) bad(`${name} is served as ${want}`, `got ${r.type}`)
  else ok(`${name} is found and served as ${want}`, `${r.len}b`)
}

/* ------------------------------------ the bytes decide, not the file's name */
clear()
put('logo.jpg', PNG)      // a PNG the owner saved under a .jpg name
{
  const r = await fetchLogo()
  const t = (r.type || '').split(';')[0]
  if (r.status === 200 && t === 'image/png') ok('a PNG named logo.jpg is served as image/png', 'the bytes decide')
  else bad('a PNG named logo.jpg is served as image/png', `${r.status} ${t}`)
}

/* ------------------------------------------- and a non-image is not served */
clear()
put('logo.png', Buffer.from('<?php echo "not an image"; ?>', 'utf8'))
{
  const r = await fetchLogo()
  // It must not come back as an image of any kind. Falling through to the
  // placeholder is the right answer; so is a 404. Serving those bytes under
  // any image/* type is not.
  const t = (r.type || '').split(';')[0]
  const leaked = r.status === 200 && t.startsWith('image/') && r.len !== placeholderLen
  if (leaked) bad('a non-image named logo.png is not served as an image', `${r.status} ${t} ${r.len}b`)
  else ok('a non-image named logo.png is not served as an image', `${r.status} ${t} ${r.len}b`)
}

/* -------------------------------------------------------- put the folder back */
clear()
const after = existsSync(DIR) ? readdirSync(DIR) : null
if (JSON.stringify(before) !== JSON.stringify(after)) {
  bad('the brand folder is left as it was found', `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
} else {
  ok('the brand folder is left as it was found', `${(after || []).length} file(s)`)
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
