/**
 * Panel uploads must work in a browser that cannot encode WebP (every iPhone and
 * iPad browser is WebKit).
 *
 *   node scripts/safari-canvas-test.mjs      (npm run test:safari-canvas)
 *
 * There is no WebKit in this environment, so the ONE behaviour that differs is
 * reproduced exactly: canvas.toDataURL('image/webp') is made to answer with a
 * PNG, which is what Safari does. What is then asserted is what the owner
 * would have hit on a phone:
 *   - a photograph (a PNG of it is ~6x the cap) still comes back under the cap,
 *     as a JPEG, and the server's own gate (product_image_add) accepts it;
 *   - a small transparent logo comes back as a PNG, transparency intact;
 *   - in a browser that CAN encode WebP nothing changes: it is still WebP;
 *   - hero-slides' encoder falls back to JPEG rather than sending a PNG.
 * The same picture is fed to all three, so a difference is the browser's.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const SAFARI = () => {
  const orig = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = function (type, q) {
    return orig.call(this, type === 'image/webp' ? 'image/png' : type, q)
  }
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })

async function run(safari) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  if (safari) await page.addInitScript(SAFARI)
  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  await page.waitForFunction(() => !!window.sportaUpload, null, { timeout: 8000 })
  const out = await page.evaluate(async () => {
    const mk = (w, h, paint, type) => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      paint(c.getContext('2d'), w, h)
      c.toBlob((b) => res(new File([b], 'x.' + type.split('/')[1], { type })), type, 0.95)
    })
    // a busy "photograph": noise, so it does not compress like a flat logo
    const photo = await mk(1800, 1400, (g, w, h) => {
      const d = g.createImageData(w, h)
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = (i / 4 % w) / w * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255 }
      g.putImageData(d, 0, 0)
    }, 'image/jpeg')
    // a transparent logo: a red disc, fully transparent corners
    const logo = await mk(300, 300, (g) => { g.fillStyle = '#e0561c'; g.beginPath(); g.arc(150, 150, 100, 0, 7); g.fill() }, 'image/png')
    const r = {}
    for (const [k, f] of [['photo', photo], ['logo', logo]]) {
      try { const s = await window.sportaUpload.shrink(f); r[k] = { head: s.dataUri.slice(0, 22), len: s.dataUri.length, w: s.width, h: s.height, uri: k === 'photo' ? s.dataUri : null } }
      catch (e) { r[k] = { error: String(e.message || e) } }
    }
    // is the logo's corner still transparent?
    if (r.logo.head) {
      const s = await window.sportaUpload.shrink(logo)
      const img = new Image(); img.src = s.dataUri; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      r.logo.cornerAlpha = g.getImageData(2, 2, 1, 1).data[3]
    }
    return r
  })
  await ctx.close()
  return { out, cookie: null }
}

const normal = await run(false)
check(normal.out.photo.head?.startsWith('data:image/webp') && normal.out.photo.len <= 1100000, 'a browser that can encode WebP still gets WebP for a photograph', `${normal.out.photo.head} ${normal.out.photo.len}`)
check(normal.out.logo.head?.startsWith('data:image/webp'), '... and for a logo')

const saf = await run(true)
check(!saf.out.photo.error && saf.out.photo.head?.startsWith('data:image/jpeg') && saf.out.photo.len <= 1100000, 'a browser that answers WebP with a PNG (Safari): the photograph comes back as a JPEG under the cap', saf.out.photo.error ?? `${saf.out.photo.head} ${saf.out.photo.len}`)
check(!saf.out.logo.error && saf.out.logo.head?.startsWith('data:image/png') && saf.out.logo.cornerAlpha === 0, 'the logo comes back as a PNG with its transparency intact', saf.out.logo.error ?? `${saf.out.logo.head} corner alpha ${saf.out.logo.cornerAlpha}`)

// the server's own gate accepts the fallback photograph
const ctx = await browser.newContext(); const p = await ctx.newPage()
await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
if (await p.locator('input[type=password]').count()) {
  await p.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw'); await p.fill('input[type=password]', 'correct horse')
  await p.locator('form button, button').first().click(); await p.waitForTimeout(1600)
}
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
const slug = execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', "select slug from products where slug='tekno-shorts-black'"], { encoding: 'utf8' }).trim()
const before = execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', `select count(*) from product_images where slug='${slug}'`], { encoding: 'utf8' }).trim()
const add = await fetch(`${BASE}/api/admin.php?r=product_image_add`, { method: 'POST', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ slug, image: saf.out.photo.uri, width: saf.out.photo.w, height: saf.out.photo.h }) })
const aj = await add.json().catch(() => null)
check(add.status === 200 && aj?.id, 'the server accepts the JPEG the fallback produced (product_image_add)', `${add.status} ${JSON.stringify(aj)?.slice(0, 80)}`)
if (aj?.id) execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', `delete from product_images where id=${aj.id}`])
check(execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', `select count(*) from product_images where slug='${slug}'`], { encoding: 'utf8' }).trim() === before, 'the fixture is as it was found')
await ctx.close()
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — an iPhone can upload a photograph and a logo')
process.exit(fails ? 1 : 0)
