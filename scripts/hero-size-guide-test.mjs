/**
 * The slide editor tells you the right picture size BEFORE you upload, and
 * judges the file you picked before anything is sent.
 *
 *   bash scripts/sandbox.sh && node scripts/hero-size-guide-test.mjs
 *
 * Real browser on the website's /backends (Settings -> Hero slides -> a new
 * slide). Files are made in the page, so no fixture file exists to go stale.
 * It saves nothing: the assertions are all about what the editor says.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && !ok ? '   ' + d : ''}`) }

const src = readFileSync(new URL('../sporta-site/public_html/assets/hero-slides.js', import.meta.url), 'utf8')
check(!/createObjectURL/.test(src), 'no blob: URLs — the live CSP allows data: images and not blob:')

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await (await br.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(`${BASE}/backends`); await p.waitForSelector('input[type=password]', { timeout: 15000 })
await p.locator('input[type=email], input[type=text]').first().fill('manager@sporta.com.kw')
await p.locator('input[type=password]').first().fill('correct horse'); await p.keyboard.press('Enter')
await p.waitForSelector('.admin-content', { timeout: 15000 }); await p.waitForTimeout(1200)
await p.locator('.admin-sidebar button').filter({ hasText: /^\s*Settings\s*$/ }).first().click()
await p.waitForSelector('.hsl', { timeout: 10000 })
const rowsBefore = await p.evaluate(async () => (await (await fetch('/api/admin.php?r=slides', { headers: { 'X-Sporta-Admin': '1' } })).json()).slides.length)
await p.getByRole('button', { name: 'Add a new slide' }).click(); await p.waitForTimeout(600)

const guide = await p.locator('.hsl-guide').innerText()
check(/1600\s*×\s*635/.test(guide) && /2\.52:1/.test(guide) && /1200/.test(guide), 'the size guide names the size, the shape and the minimum before any file is chosen', guide.slice(0, 120))

const png = (w, h) => p.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1] }, [w, h])
const pick = async (idx, w, h, name) => {
  const buf = Buffer.from(await png(w, h), 'base64')
  await p.locator('.hsl-upload input[type=file]').nth(idx).setInputFiles({ name, mimeType: 'image/png', buffer: buf })
  await p.waitForTimeout(700)
  return p.locator('.hsl-verdict').nth(idx).innerText()
}

let v = await pick(0, 1600, 635, 'exact.png')
check(/1600×635/.test(v) && /fits the banner/.test(v) && await p.locator('.hsl-verdict').nth(0).locator('.hsl-badge-ok').count() === 1, 'a right-sized banner is called a fit', v)
v = await pick(0, 2400, 950, 'big.png')
check(/fits the banner/.test(v) && /shrunk to 1600/.test(v), 'a bigger one of the right shape fits, and is told it will be shrunk', v)
v = await pick(0, 1000, 1000, 'square.png')
check(/needs attention/.test(v) && /taller/.test(v) && /1600×635/.test(v) && await p.locator('.hsl-verdict').nth(0).locator('.hsl-badge-warn').count() === 1, 'a square is refused as a fit: taller, top and bottom cut, told the size to crop to', v)
v = await pick(0, 3000, 900, 'wide.png')
check(/wider/.test(v) && /sides will be cut/.test(v), 'a too-wide one says the sides will be cut', v)
v = await pick(0, 800, 317, 'small.png')
check(/soft/.test(v) && /needs attention/.test(v), 'a small one is warned it will look soft', v)
v = await pick(1, 1200, 1500, 'phone.png')
check(/good for phones/.test(v) && /middle/.test(v), 'a phone picture is judged as a phone picture', v)
v = await pick(1, 500, 600, 'phone-small.png')
check(/soft/.test(v) && /needs attention/.test(v), 'a small phone picture is warned', v)

// the preview is redrawn with the picked file (a data: URL, before saving)
await pick(0, 1600, 635, 'exact.png')
const bg = await p.locator('.hsl-preview-art').first().evaluate((e) => e.style.backgroundImage.slice(0, 30))
check(/^url\("data:image\/png/.test(bg), 'the crop preview shows the picked picture before anything is saved', bg)

const rowsAfter = await p.evaluate(async () => (await (await fetch('/api/admin.php?r=slides', { headers: { 'X-Sporta-Admin': '1' } })).json()).slides.length)
check(rowsAfter === rowsBefore, 'nothing was uploaded or saved by choosing files', `${rowsBefore} -> ${rowsAfter}`)
await br.close()
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
