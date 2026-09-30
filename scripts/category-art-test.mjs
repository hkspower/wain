/**
 * Category pictures — the home tiles, editable from /backends. 2026-09-29.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/category-art-test.mjs
 *
 * WHAT IT HOLDS, and each one has a mutation that breaks it:
 *   - the gate: list, save and reset all 401 to a stranger.
 *   - PUBLIC SERVING: with nothing replaced, a tile URL answers the shipped
 *     file byte for byte, with an ETag that 304s (also when a CDN weakens it),
 *     and anything that is not one of the four tiles is a 404.
 *   - THE DATABASE WINS, AND THE SHIPPED FILE IS THE FALLBACK. Another tile's
 *     eight pictures are saved as the WOMEN tile, so the served bytes must
 *     differ from the women file and equal the men file — proving the row was
 *     served, not the file. Reset puts the shipped bytes back exactly.
 *   - THE SERVER MEASURES: a desktop-shaped picture in a phone slot, a jpeg in
 *     a webp slot, a non-image, an unknown tile and a set with a picture missing
 *     are each refused, and a refused save changes NOTHING (it is one
 *     transaction).
 *   - THE PANEL, in a real browser: the card is on the Slides screen and only there;
 *     a picture that is red on its left half and blue on its right is chosen,
 *     saved, and the served desktop tile is red-left/blue-right while the ARABIC
 *     tile is blue-left/red-right — read from the pixels of the served files, so
 *     the mirror is proven and not assumed. Restore puts the shipped art back.
 *
 * Every tile is reset in a `finally`: a rig's fixture must not survive it.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const CATS = new URL('../sporta-site/public_html/cats/', import.meta.url).pathname

let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const file = (crop, tile, rtl, fmt) => readFileSync(`${CATS}${crop}/art-${tile}${rtl}.${fmt}`)
const uri = (buf, fmt) => `data:image/${fmt === 'webp' ? 'webp' : 'jpeg'};base64,${buf.toString('base64')}`
const setOf = (tile) => {
  const images = {}
  for (const crop of ['desktop', 'mobile']) for (const rtl of ['', '-rtl'])
    images[crop + rtl] = { webp: uri(file(crop, tile, rtl, 'webp'), 'webp'), jpg: uri(file(crop, tile, rtl, 'jpg'), 'jpg') }
  return images
}
const served = async (crop, tile, rtl, fmt, headers = {}) => {
  const r = await fetch(`${BASE}/cats/${crop}/art-${tile}${rtl}.${fmt}?x=${Math.random()}`, { headers })
  return { status: r.status, etag: r.headers.get('etag'), type: r.headers.get('content-type'), cc: r.headers.get('cache-control'), bytes: Buffer.from(await r.arrayBuffer()) }
}

let cookie = ''
const admin = (route, body) => fetch(`${ADMIN}?r=${route}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))

// THE PANEL RUNS UNDER THE SHIPPED CONTENT-SECURITY-POLICY. The sandbox is php -S
// and sends no CSP at all, so a blob: image (which the live policy refuses:
// img-src has data: and no blob:) worked here and was blocked in production. The
// policy is read OUT of .htaccess — the /backends variant — rather than retyped,
// minus upgrade-insecure-requests (which would turn http://127.0.0.1 into https).
const htaccess = readFileSync(new URL('../sporta-site/public_html/.htaccess', import.meta.url).pathname, 'utf8')
const panelLine = htaccess.split('\n').find((l) => /Header set Content-Security-Policy "/.test(l) && /env=SPORTA_PANEL\s*$/.test(l))
const PANEL_CSP = panelLine ? panelLine.match(/Content-Security-Policy "([^"]+)"/)[1].replace(/;?\s*upgrade-insecure-requests/, '') : null

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
if (PANEL_CSP) {
  await page.route('**/backends**', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const resp = await route.fetch()
    await route.fulfill({ response: resp, headers: { ...resp.headers(), 'content-security-policy': PANEL_CSP } })
  })
}
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  check(!!PANEL_CSP && /img-src 'self' data:/.test(PANEL_CSP) && !/blob:/.test(PANEL_CSP), "the panel's shipped policy was found and it names data: but not blob: for images", (PANEL_CSP || 'NOT FOUND').slice(0, 60))

  /* ----------------------------------------------------------- the gate -- */
  for (const [route, body] of [['cat_art_list'], ['cat_art_save', {}], ['cat_art_reset', {}]]) {
    const r = await fetch(`${ADMIN}?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: body ? '{}' : undefined })
    check(r.status === 401, `${route} answers 401 to a stranger`, `got ${r.status}`)
  }

  /* ------------------------------------------------- public, unreplaced -- */
  const a = await served('desktop', 'women', '', 'webp')
  check(a.status === 200 && a.bytes.equals(file('desktop', 'women', '', 'webp')), 'an unreplaced tile is the shipped file, byte for byte', `${a.bytes.length}b`)
  check(a.type === 'image/webp' && /no-cache/.test(a.cc || ''), 'it revalidates rather than pinning', `${a.type} ${a.cc}`)
  const j = await served('mobile', 'outlet', '-rtl', 'jpg')
  check(j.status === 200 && j.type === 'image/jpeg' && j.bytes.equals(file('mobile', 'outlet', '-rtl', 'jpg')), 'the jpeg fallback and the Arabic name resolve too')
  check((await served('desktop', 'women', '', 'webp', { 'If-None-Match': a.etag })).status === 304, 'a matching ETag answers 304')
  check((await served('desktop', 'women', '', 'webp', { 'If-None-Match': 'W/' + a.etag })).status === 304, 'and so does a CDN-weakened one (W/…)')
  check((await served('desktop', 'women', '', 'webp', { 'If-None-Match': '"nope"' })).status === 200, 'a different tag answers 200')
  for (const bad of ['cats/desktop/art-kids.webp', 'cats/tablet/art-men.webp', 'cats/desktop/art-men.png']) {
    const r = await fetch(`${BASE}/${bad}`)
    check(r.status === 404, `${bad} is a 404`, `got ${r.status}`)
  }

  /* --------------------------------------------------------- sign in ------ */
  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const list0 = await admin('cat_art_list')
  check(list0.status === 200 && list0.j?.ready === true && list0.j.tiles.length === 4 && list0.j.tiles.every((t) => t.replaced === false), 'signed in; the list shows four tiles, none replaced', JSON.stringify(list0.j)?.slice(0, 120))

  /* ----------------------------- the database wins, the file is the fallback */
  const save = await admin('cat_art_save', { tile: 'women', images: setOf('men') })
  check(save.status === 200 && save.j?.ok === true, 'saving eight pictures is accepted', JSON.stringify(save.j))
  const w = await served('desktop', 'women', '', 'webp')
  check(w.bytes.equals(file('desktop', 'men', '', 'webp')) && !w.bytes.equals(file('desktop', 'women', '', 'webp')), 'the WOMEN url now serves the saved row (the men bytes), not the women file')
  const wr = await served('mobile', 'women', '-rtl', 'jpg')
  check(wr.bytes.equals(file('mobile', 'men', '-rtl', 'jpg')), 'every variant is served from its own row (mobile, Arabic, jpeg)')
  const other = await served('desktop', 'men', '', 'webp')
  check(other.bytes.equals(file('desktop', 'men', '', 'webp')), 'another tile is untouched')
  check(w.etag !== a.etag, 'the tag moved with the picture')
  const list1 = await admin('cat_art_list')
  check(list1.j?.tiles.find((t) => t.tile === 'women')?.replaced === true && list1.j.tiles.filter((t) => t.replaced).length === 1, 'the list says exactly one tile is replaced')
  const rs = await admin('cat_art_reset', { tile: 'women' })
  check(rs.status === 200, 'reset is accepted')
  const back = await served('desktop', 'women', '', 'webp')
  check(back.bytes.equals(file('desktop', 'women', '', 'webp')), 'reset puts the shipped bytes back exactly')

  /* ----------------------------------------------------- the server measures */
  const good = setOf('men')
  const refuse = async (what, body, token) => {
    const r = await admin('cat_art_save', body)
    check(r.status >= 400 && (!token || r.j?.error === token), `refused: ${what}`, `${r.status} ${r.j?.error}`)
  }
  await refuse('a desktop-shaped picture in a phone slot', { tile: 'women', images: { ...good, mobile: good.desktop } }, 'cat_art_wrong_size')
  await refuse('a jpeg in a webp slot', { tile: 'women', images: { ...good, desktop: { ...good.desktop, webp: good.desktop.jpg } } }, 'cat_art_bad_format')
  await refuse('bytes that are not an image', { tile: 'women', images: { ...good, desktop: { ...good.desktop, webp: 'data:image/webp;base64,' + Buffer.from('x'.repeat(200)).toString('base64') } } }, 'cat_art_not_an_image')
  await refuse('an unknown tile', { tile: 'kids', images: good }, 'invalid_tile')
  const missing = { ...good }; delete missing['mobile-rtl']
  await refuse('a set with a picture missing', { tile: 'women', images: missing })
  const after = await served('desktop', 'women', '', 'webp')
  check(after.bytes.equals(file('desktop', 'women', '', 'webp')), 'and none of those refusals changed anything (one transaction)')

  /* --------------------------------------------------------- the panel ---- */
  await page.getByText('Slides', { exact: true }).first().click()
  await page.waitForSelector('[data-sporta-category-art]', { timeout: 8000 })
  check((await page.locator('[data-sporta-category-art]').count()) === 1, 'the card is on the Slides screen')
  check((await page.locator('.cta-tile').count()) === 4, 'with a tile for each of the four categories')
  await page.getByText('Orders', { exact: true }).first().click()
  await page.waitForSelector('.admin-content h1:has-text("Orders")', { timeout: 8000 })
  await page.waitForTimeout(600)
  check((await page.locator('[data-sporta-category-art]').count()) === 0, 'and it removes itself on another screen')
  await page.getByText('Slides', { exact: true }).first().click()
  await page.waitForSelector('[data-sporta-category-art]', { timeout: 8000 })

  // A picture red on its left half and blue on its right: the mirror is then
  // visible in the pixels of what the server ends up serving.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1000
    const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 1000, 1000); g.fillStyle = '#0000ff'; g.fillRect(1000, 0, 1000, 1000)
    return c.toDataURL('image/png').split(',')[1]
  })
  const dir = mkdtempSync(join(tmpdir(), 'cta-'))
  const pngPath = join(dir, 'split.png')
  writeFileSync(pngPath, Buffer.from(png, 'base64'))

  const tile = page.locator('.cta-tile').filter({ hasText: 'Outlet' })
  await tile.locator('input[type=file]').setInputFiles(pngPath)
  await page.waitForSelector('.cta-previews canvas', { timeout: 8000 })
  check((await page.locator('.cta-previews canvas').count()) === 2, 'choosing a picture shows the computer crop and the phone crop')
  const sizes = await page.locator('.cta-previews canvas').evaluateAll((cs) => cs.map((c) => `${c.width}x${c.height}`))
  check(sizes.join() === '1216x706,900x570', 'at the two real tile sizes', sizes.join())
  const saveReq = page.waitForResponse((r) => r.url().includes('r=cat_art_save'), { timeout: 30000 })
  await tile.getByRole('button', { name: 'Save picture' }).click()
  const resp = await saveReq
  check(resp.status() === 200, 'Save picture is accepted by the server', String(resp.status()))
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-category-art]')?.textContent || ''), null, { timeout: 8000 })
  const list2 = await admin('cat_art_list')
  check(list2.j?.tiles.find((t) => t.tile === 'outlet')?.replaced === true, 'the outlet tile is now replaced')

  // read the served pictures' pixels in the page
  const px = async (crop, rtl) => page.evaluate(async ({ url }) => {
    const img = new Image(); img.src = url; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const at = (x) => Array.from(g.getImageData(x, Math.floor(img.height / 2), 1, 1).data.slice(0, 3))
    return { w: img.width, h: img.height, left: at(20), right: at(img.width - 20) }
  }, { url: `${BASE}/cats/${crop}/art-outlet${rtl}.webp?x=${Math.random()}` })
  const en = await px('desktop', '')
  const rtl = await px('desktop', '-rtl')
  const ph = await px('mobile', '')
  check(en.w === 1216 && en.h === 706 && ph.w === 900 && ph.h === 570, 'the served pictures are the two tile sizes', `${en.w}x${en.h} ${ph.w}x${ph.h}`)
  check(en.left[0] > 200 && en.left[2] < 60 && en.right[2] > 200 && en.right[0] < 60, 'English: red on the left, blue on the right', JSON.stringify([en.left, en.right]))
  check(rtl.left[2] > 200 && rtl.left[0] < 60 && rtl.right[0] > 200 && rtl.right[2] < 60, 'ARABIC is the mirror: blue on the left, red on the right', JSON.stringify([rtl.left, rtl.right]))

  const restoreReq = page.waitForResponse((r) => r.url().includes('r=cat_art_reset'), { timeout: 15000 })
  await page.locator('.cta-tile').filter({ hasText: 'Outlet' }).getByRole('button', { name: 'Restore original' }).click()
  check((await restoreReq).status() === 200, 'Restore original is accepted')
  const o = await served('desktop', 'outlet', '', 'webp')
  check(o.bytes.equals(file('desktop', 'outlet', '', 'webp')), 'and the shipped outlet art is back, byte for byte')
  check(errors.length === 0, 'no script errors in the panel', errors.join(' | ').slice(0, 200))
} finally {
  for (const t of ['men', 'women', 'accessories', 'outlet']) await admin('cat_art_reset', { tile: t }).catch(() => {})
  await browser.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — the home tiles can be replaced from the panel, and put back')
process.exit(fails ? 1 : 0)
