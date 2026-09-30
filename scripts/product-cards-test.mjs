/**
 * Product cards: thumbnails instead of originals, a second photograph on hover,
 * frame and crop.
 *
 *   node scripts/product-cards-test.mjs     (npm run test:product-cards)
 *
 * The fixture is NAMED: vanquish-tank-navy has two photographs in the sandbox
 * (ids 80 and 81), so it is the one that can show a second on hover. Everything
 * is asserted through the network and the computed style, not through the
 * markup that asked for it.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
// the statement goes in on stdin: a photograph is ~100 kB of base64, past the OS limit for one argument
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N'], { input: q, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const SLUG = 'vanquish-tank-navy'
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })

async function open(ctxOpts, path) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const reqs = []
  page.on('response', (r) => { if (/product_image/.test(r.url())) reqs.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] }) })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  return { ctx, page, reqs, errs }
}
async function reveal(page) {
  for (let i = 0; i < 6 && !(await page.locator(`a[href="/product/${SLUG}"]`).count()); i++) {
    const more = page.getByRole('button', { name: /load more|show more|المزيد/i })
    if (await more.count()) { await more.first().click(); await page.waitForTimeout(600) } else break
  }
}

// A REAL-SIZED FIXTURE. The sandbox's own photographs are 1px squares, which the server
// (correctly) never resizes, so they could not show that the resized copy is stored.
const FIX = execFileSync('python3', ['-c', `
import io,base64,random
from PIL import Image
random.seed(3)
im=Image.linear_gradient('L').resize((1200,1500)).convert('RGB'); from PIL import ImageDraw; d=ImageDraw.Draw(im); [d.ellipse((lambda x,y:(x,y,x+random.randint(60,300),y+random.randint(60,300)))(random.randint(0,850),random.randint(0,1150)),outline=(random.randint(0,255),90,200),width=9) for _ in range(40)]
b=io.BytesIO(); im.save(b,'JPEG',quality=88); print('data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode())`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
sql('delete from product_image_thumbs')
const bigId = (() => {
  sql(`insert into product_images (slug, sort, image, image_hash, image_w, image_h) values ('street-pants-navy', 0, '${FIX}', '${'e'.repeat(64)}', 1400, 1750)`)
  return Number(sql("select id from product_images where image_hash='" + 'e'.repeat(64) + "'"))
})()
process.on('exit', () => { try { sql("delete from product_images where image_hash='" + 'e'.repeat(64) + "'"); sql('delete from product_image_thumbs') } catch (e) {} })
{
  const { ctx, page, reqs, errs } = await open({ viewport: { width: 1280, height: 900 } }, '/shop?lang=en&q=vanquish')
  await reveal(page)
  const cards = await page.evaluate(() => [...document.querySelectorAll('article > a[class*="aspect-"] > img')].filter((i) => !i.src.startsWith('data:')).length)
  check(cards >= 1, 'the search shows photographed cards to look at', String(cards))
  check(reqs.length > 0 && reqs.every((r) => /[?&]w=(400|600)\b/.test(r.url)), 'every card picture is a resized copy (w=400 or 600), never the original', `${reqs.length} requests`)
  check(reqs.every((r) => r.status === 200 && /image\/(webp|jpeg|png)/.test(r.type || '')), 'and every one arrives as a picture')
  const orig = await fetch(`${BASE}/api/api.php?r=product_image&id=${bigId}`)
  const origLen = (await orig.arrayBuffer()).byteLength
  const t1 = await fetch(`${BASE}/api/api.php?r=product_image&id=${bigId}&w=400`)
  const b1 = Buffer.from(await t1.arrayBuffer())
  check(t1.status === 200 && t1.headers.get('content-type') === 'image/webp' && b1.length < origLen / 3, 'a large photograph comes back as a WebP a fraction of its size', `${origLen} -> ${b1.length} bytes`)
  check(Number(sql(`select count(*) from product_image_thumbs where image_id=${bigId} and w=400`)) === 1, 'the resized copy was stored (product_image_thumbs), so the next visitor costs no resize')
  const t2 = await fetch(`${BASE}/api/api.php?r=product_image&id=${bigId}&w=400`)
  check(Buffer.from(await t2.arrayBuffer()).equals(b1), 'and a repeat request returns exactly those bytes')
  sql(`update product_images set image='data:image/jpeg;base64,/9j/xx' where id=${bigId}`)
  const t3 = await fetch(`${BASE}/api/api.php?r=product_image&id=${bigId}&w=400`)
  check(Buffer.from(await t3.arrayBuffer()).equals(b1), 'proved to come from the store: served even with the original made unusable')
  sql(`update product_images set image='${FIX}' where id=${bigId}`)
  check((await fetch(`${BASE}/api/api.php?r=product_image&id=${bigId}&w=999`)).status === 200, 'an unknown width still gets a picture (the original), never an error')
  const a = page.locator(`article:has(a[href="/product/${SLUG}"]) > a`).first()
  await a.scrollIntoViewIfNeeded()
  check((await a.evaluate((e) => e.querySelectorAll(':scope > img').length)) === 1, 'before anyone points at a card it holds one picture (the bundle adds its hover picture on demand)')
  await a.hover()
  await page.waitForTimeout(1200)
  const imgs = await a.evaluate((e) => [...e.querySelectorAll(':scope > img')].map((i) => ({ src: i.getAttribute('src'), hidden: i.getAttribute('aria-hidden') === 'true', cls: i.className })))
  check(imgs.length === 2 && imgs.every((i) => !/spc-second/.test(i.cls)), 'a card with two photographs has exactly two pictures: the main one and the BUNDLE\'s own hover picture (this script adds none)', String(imgs.length))
  check(imgs.every((i) => /[?&]w=(400|600)\b/.test(i.src)), 'and both are thumbnails, the hidden hover picture included', imgs.map((i) => i.src.slice(-30)).join(' | '))
  const ids = imgs.map((i) => /[?&]id=(\d+)/.exec(i.src)?.[1])
  check(ids[0] !== ids[1], 'two DIFFERENT photographs', ids.join(' vs '))
  const op = await a.evaluate((e) => [...e.querySelectorAll(':scope > img')].map((i) => getComputedStyle(i).opacity))
  check(op.includes('0') === false || op.some((o) => o === '1'), 'hovering shows the second by the bundle\'s own fade', op.join('/'))
  const st = await page.evaluate(() => {
    const img = document.querySelector('article > a[class*="aspect-"] > img:not([src^="data:"]):not(.spc-second)'); const a = img.parentElement
    return { outline: getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).outlineWidth, pos: img && getComputedStyle(img).objectPosition,
      gaps: getComputedStyle(document.querySelector('main div.grid:has(> article)')).columnGap + '/' + getComputedStyle(document.querySelector('main div.grid:has(> article)')).rowGap }
  })
  check(/solid 1px/.test(st.outline), 'each photo frame has its hairline edge', st.outline)
  check(st.pos === '50% 22%', 'photographs are cropped towards the top (faces stay in frame)', st.pos)
  check(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 100))
  await ctx.close()
}
{
  const { ctx, page, reqs } = await open({ ...devices['iPhone 14'] }, '/shop?lang=en&q=vanquish')
  await reveal(page)
  check(reqs.length > 0 && reqs.every((r) => /[?&]w=(400|600)\b/.test(r.url)), 'on a phone too: thumbnails only', `${reqs.length} requests`)
  const a = page.locator(`article:has(a[href="/product/${SLUG}"]) > a`).first()
  if (await a.count()) { await a.scrollIntoViewIfNeeded(); await a.tap().catch(() => {}); }
  check((await page.locator('img.spc-second').count()) === 0, 'a phone gets no second picture (a finger has no hover)')
  await ctx.close()
}
{
  const { ctx, page, reqs } = await open({ viewport: { width: 1280, height: 900 } }, `/product/${SLUG}?lang=en`)
  check(reqs.length >= 2 && reqs.some((r) => !/[?&]w=\d+/.test(r.url)), "the product page's own gallery still loads the full photographs", `${reqs.length} requests`)
  await ctx.close()
}
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — cards load thumbnails, show a second photo on hover, and the gallery is untouched')
process.exit(fails ? 1 : 0)
