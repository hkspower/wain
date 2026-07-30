// The admin image uploader, driven in a real browser against a stubbed Storage
// endpoint. Asserts the four things the feature was asked for and the three that
// make it safe:
//   unlimited multi-file · grid preview · lossless (bytes unchanged) · all formats
//   bounded concurrency · SVG refused · HEIC uploads without a preview
//
//   node scripts/image-uploader-test.mjs [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const BASE = process.argv[2] ?? 'http://localhost:4173'
const TMP = '/tmp/uploader-fixtures'
const OUT = '/tmp/storage-out'
// A hostname with a real subdomain, not 127.0.0.1: supabase-js derives its
// auth storage key from the project ref, which is the first label of the host.
// With a bare IP there is no ref, the key is unguessable, and the fake session
// is never read. stub.supabase.co is mapped to 127.0.0.1 in /etc/hosts.
const STORAGE = process.env.STORAGE_STUB ?? 'http://stub.supabase.co:8899'
mkdirSync(TMP, { recursive: true })

let fails = 0
const ok = (pass, what, detail = '') => {
  if (!pass) fails++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`)
}

// Fixtures: real 2000x1400 PNGs, made with the same PIL pipeline the banners
// use. Big enough that a 1600px WebP is genuinely smaller — an 8px test PNG made
// the derivative LARGER than the source, which makeWebVersion correctly declines
// to upload, so the tiny fixture was testing the wrong branch.
execFileSync('python3', ['-c', `
from PIL import Image
import numpy as np, sys
rng = np.random.default_rng(3)
for i in range(1, 13):
    # A gradient with light noise: compresses like a photograph, so the 1600px
    # WebP is genuinely smaller than the source (pure noise does not compress,
    # and made the derivative larger than the original — which makeWebVersion
    # correctly declines to upload, so the fixture was testing the wrong branch).
    # 900x600 is deliberate. At 1800x1200 the twelve decoded previews alone are
    # ~100 MB of RGBA in the renderer on top of the twelve File blobs and twelve
    # WebP encodes, and the tab ran out of memory — which surfaces as XHR
    # "connection dropped" and reads exactly like a server fault. Nothing about
    # the code under test needs a bigger source.
    y, x = np.mgrid[0:600, 0:900]
    a = np.stack([(x % 255), (y % 255), ((x + y + i * 20) % 255)], -1).astype('uint8')
    a = np.clip(a + rng.integers(-8, 8, a.shape), 0, 255).astype('uint8')
    Image.fromarray(a).save(f'${TMP}/photo-{i:02d}.png')
`])
const files = []
for (let i = 1; i <= 12; i++) files.push(`${TMP}/photo-${String(i).padStart(2, '0')}.png`)
writeFileSync(`${TMP}/logo.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
writeFileSync(`${TMP}/IMG_9999.heic`, Buffer.concat([Buffer.from('ftypheic'), Buffer.alloc(2048, 7)]))
writeFileSync(`${TMP}/notes.txt`, 'not an image')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
const p = await ctx.newPage()

// Surfaced, not swallowed. Several rounds of debugging this file were spent
// staring at "the connection dropped" in the UI while the browser was printing
// the actual reason to a console nobody was reading.
const browserErrors = []
p.on('console', (m) => m.type() === 'error' && browserErrors.push(m.text().slice(0, 200)))
p.on('pageerror', (e) => browserErrors.push(`pageerror: ${String(e).split('\n')[0]}`))
p.on('requestfailed', (r) =>
  browserErrors.push(`${r.method()} ${r.url().slice(0, 80)} → ${r.failure()?.errorText}`))

// ------------------------------------------------------------- stub Supabase
// Read back off disk after the run: what the server actually received.
const stored = () => {
  const out = new Map()
  for (const dir of ['originals', 'web']) {
    let names = []
    try { names = readdirSync(`${OUT}/${dir}`) } catch { continue }
    for (const n of names.filter((x) => !x.endsWith('.meta.json'))) {
      const buf = readFileSync(`${OUT}/${dir}/${n}`)
      const meta = JSON.parse(readFileSync(`${OUT}/${dir}/${n}.meta.json`, 'utf8'))
      out.set(`${dir}/${n}`, { sha: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, ...meta })
    }
  }
  return out
}

await p.route('**/config.js', (r) =>
  r.fulfill({
    contentType: 'application/javascript',
    body: `window.SPORTA_CONFIG={supabaseUrl:'${STORAGE}',supabaseAnonKey:'anon.key.x'}`,
  }),
)
// No route stub for /auth/v1: the storage stub already answers it with {}, and
// intercepting it here made supabase-js tear the session down mid-run — which
// aborted every in-flight XHR and surfaced as "the connection dropped".

// The session, under the key supabase-js actually uses.
//
// It derives its storage key from the project ref in the URL, so a hard-coded
// 'sb-stub-auth-token' was never read: getSession() returned null, runQueue
// bailed with not_signed_in, and NOTHING uploaded — while the tiles sat at
// 'queued' forever and the wait timed out looking like a product hang. So the
// key is discovered from the client itself, then the page is reloaded with the
// token in place.
// A real-SHAPED JWT, not the string 'test-token'. supabase-js decodes the
// access token to read its expiry, and a non-JWT made getSession() hand back
// null — so runQueue bailed with not_signed_in and no file ever left the
// browser. It is unsigned; nothing here verifies it, the stub only checks that
// an Authorization: Bearer header arrived.
const jwt = (payload) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}
const ACCESS = jwt({
  sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated',
  aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
})
const SESSION = {
  access_token: ACCESS, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
  user: {
    id: '11111111-1111-1111-1111-111111111111', email: 'owner@sporta.com.kw',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
    created_at: new Date(0).toISOString(),
  },
}
await p.goto(BASE + '/admin', { waitUntil: 'networkidle' })
// supabase-js writes this key only once a session exists, so it cannot be
// discovered on a fresh load — it is derived: sb-<first host label>-auth-token.
const key = `sb-${new URL(STORAGE).hostname.split('.')[0]}-auth-token`
await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, SESSION])
await p.goto(BASE + '/admin', { waitUntil: 'networkidle' })
await p.getByRole('button', { name: 'Images' }).first().click()
await p.waitForTimeout(500)

// --------------------------------------------------- unlimited multi-selection
await p.setInputFiles('input[type=file]:not([webkitdirectory])', files)
await p.waitForTimeout(500)
const tiles = await p.locator('ul li').count()
ok(tiles >= 12, 'accepts every file in one selection', `${tiles} tiles`)

// ------------------------------------------------------------- grid preview
const previews = await p.$$eval('ul li img', (els) =>
  els.map((e) => ({ blob: e.src.startsWith('blob:'), w: e.naturalWidth })),
)
ok(previews.length >= 12 && previews.every((x) => x.blob),
  'every tile previews from an object URL (no decode, no copy)', `${previews.length} previews`)
ok(previews.filter((x) => x.w > 0).length >= 12, 'the previews actually decode')

// ------------------------------------------------- rejected before any bytes go
await p.setInputFiles('input[type=file]:not([webkitdirectory])', [`${TMP}/logo.svg`, `${TMP}/notes.txt`])
await p.waitForTimeout(400)
const body = await p.textContent('body')
ok(/SVG is not accepted/.test(body), 'SVG is refused, with the reason')
ok(/Not an image file/.test(body), 'a non-image is refused')

// ------------------------------------------------------------------ HEIC
await p.setInputFiles('input[type=file]:not([webkitdirectory])', [`${TMP}/IMG_9999.heic`])
await p.waitForTimeout(400)
ok(/HEIC — preview needs Safari/.test(await p.textContent('body')),
  'HEIC is accepted and labelled rather than shown broken')

// ---------------------------------------------------------------- upload
await p.getByRole('button', { name: /^Upload/ }).click()
// Wait for the real condition, not for a guessed duration and not for
// querySelector('button') — which is the FIRST button on the page and never the
// Stop button, so the predicate was true immediately and the assertions ran
// against five uploads instead of twenty-six.
try {
  await p.waitForFunction(
    () => ![...document.querySelectorAll('ul li')].some((li) =>
      /uploading|deriving|%|queued/i.test(li.textContent)),
    null,
    { timeout: 90000 },
  )
} catch {
  // A queue that never drains is a finding, not a reason to stop the suite with
  // a stack trace and no other results.
  ok(false, 'the queue drained', 'still had queued/uploading tiles after 90s')
}
await p.waitForTimeout(600)

const received = stored()
const peakInFlight = Number(await (await fetch(`${STORAGE}/__peak`)).text())
const originals = [...received.keys()].filter((k) => k.startsWith('originals/'))
// On any shortfall, say what the tiles actually reported — chasing a bare
// "0 of 13" through three layers is what cost the most time writing this.
if (originals.length !== 13) {
  console.log('     tiles:', JSON.stringify(await p.$$eval('ul li', (els) =>
    els.slice(0, 6).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)))))
}
ok(originals.length === 13, 'every accepted file was uploaded', `${originals.length} of 13 (12 png + 1 heic)`)
ok(peakInFlight > 1 && peakInFlight <= 4, 'concurrency is bounded, not unlimited', `peak ${peakInFlight} in flight`)

// ----------------------------------------------------- LOSSLESS: bytes match
const localHashes = new Map(
  [...files, `${TMP}/IMG_9999.heic`].map((f) => [
    createHash('sha256').update(readFileSync(f)).digest('hex'),
    f.split('/').pop(),
  ]),
)
const uploadedHashes = originals.map((k) => received.get(k).sha)
const matched = uploadedHashes.filter((h) => localHashes.has(h)).length
const localSizes = new Set([...files, `${TMP}/IMG_9999.heic`].map((f) => readFileSync(f).length))
const sizesMatch = originals.filter((k) => localSizes.has(received.get(k).bytes)).length
ok(matched === 13, 'every original arrived BYTE FOR BYTE — lossless', `${matched} of 13 hashes match`)
ok(sizesMatch === 13, '…and at the original byte length', `${sizesMatch} of 13 sizes match`)
ok(originals.every((k) => received.get(k).auth), 'each upload carried the session bearer token')
ok(originals.every((k) => received.get(k).upsert === 'false'), 'upsert is off, so nothing silently overwrites')
// Guarded: when nothing uploaded, this used to throw and take the whole run
// down BEFORE the browser diagnostics printed — so every debugging round ended
// with a stack trace instead of the reason.
ok(
  originals.length > 0 && received.get(originals[0]).contentType.startsWith('image/'),
  "the file's own Content-Type is sent",
  originals.length ? received.get(originals[0]).contentType : 'nothing uploaded',
)

// ------------------------------------------ derivative is a copy, not a replacement
const web = [...received.keys()].filter((k) => k.startsWith('web/'))
ok(web.length > 0, 'web copies were made alongside the originals', `${web.length}`)
ok(web.every((k) => received.get(k).contentType === 'image/webp'), 'and they are WebP')
ok(!web.some((k) => uploadedHashes.filter((h) => h === received.get(k).sha).length > 1),
  'no original was replaced by its derivative')

await b.close()
if (browserErrors.length) {
  console.log('\nbrowser said:')
  for (const e of [...new Set(browserErrors)].slice(0, 8)) console.log(`  ${e}`)
}
console.log(fails ? `\n${fails} failed` : '\nlossless, unlimited, previewed, and safe')
process.exit(fails ? 1 : 0)
