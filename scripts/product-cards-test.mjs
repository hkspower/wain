/**
 * The grid's product cards after the 2026-09-28 rebuild
 * (35-product-cards.css + assets/brand-badge.js).
 *
 *   bash scripts/sandbox.sh
 *   node scripts/product-cards-test.mjs
 *
 * Each check is one of the things the rebuild got wrong on its way here, or
 * the property it exists to keep:
 *
 *   - the heart and + keep a 44px TAP area but paint a 32px disc — and the
 *     button's own background is really gone: sporta-dark.css repaints it with
 *     a more specific !important, and the first build showed a white disc
 *     inside a grey 44px ring while every rule looked right;
 *   - the bundle's own sold-out wash and "SOLD OUT" bar are NOT moved — the
 *     first badge rule matched every absolute span and yanked the bar from the
 *     middle of the photo to the top;
 *   - names clamp at two lines, in the body face rather than the display face;
 *   - a branded product shows its brand's name above the product name, in the
 *     page's language, and follows a language switch.
 *
 * One product is set out of stock for the run and its stock put back in a
 * finally; test photos are uploaded through the panel and deleted after.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SOLD = 'cagliari-calcio-sweatshirt-navy'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
  return ok
}
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta',
  '--batch', '--raw', '--skip-column-names', '-e', q], { encoding: 'utf8' })

let jar = ''
const admin = async (r, body) => {
  const res = await fetch(`${BASE}/api/admin.php?r=${r}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(jar ? { Cookie: jar } : {}) },
  })
  const c = res.headers.getSetCookie?.() ?? []
  if (c.length) jar = c.map((x) => x.split(';')[0]).join('; ')
  return res.json().catch(() => null)
}

const stockBefore = sql(`select concat(size,'=',stock) from product_variants where slug='${SOLD}'`).trim().split('\n').filter(Boolean)
const photo = execFileSync('python3', ['-c', `
from PIL import Image; import io,base64
b=io.BytesIO(); Image.new('RGB',(800,1000),(214,210,204)).save(b,'JPEG',quality=80)
print('data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode())`]).toString().trim()

const ids = []
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  check(stockBefore.length > 0, `${SOLD} has stock rows to set to zero`, 'the sold-out check needs a tracked product')
  sql(`update product_variants set stock = 0 where slug = '${SOLD}'`)
  await admin('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  for (const s of [SOLD, 'cagliari-calcio-backpack']) {
    const r = await admin('product_image_add', { slug: s, image: photo })
    if (r?.id) ids.push(r.id)
  }
  check(ids.length === 2, 'uploaded two test photographs')

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await page.goto(`${BASE}/shop?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const m = await page.evaluate((sold) => {
    const cards = [...document.querySelectorAll('main div.grid article')]
    const btn = cards[0]?.querySelector('a[class*="aspect-"] > button')
    const b = btn?.getBoundingClientRect()
    const soldCard = cards.find((c) => c.querySelector(`a[href*="${sold}"]`))
    const photo = soldCard?.querySelector('a[class*="aspect-"]')?.getBoundingClientRect()
    const bar = [...(soldCard?.querySelectorAll('a[class*="aspect-"] > span') ?? [])]
      .find((s) => /sold out/i.test(s.textContent))?.getBoundingClientRect()
    const badge = cards.map((c) => c.querySelector('a[class*="aspect-"] > span[class~="rounded-lg"]')).find(Boolean)
    const h3 = cards[0]?.querySelector('h3')
    return {
      cards: cards.length,
      hit: b && [b.width, b.height],
      bg: btn && getComputedStyle(btn).backgroundColor,
      disc: btn && getComputedStyle(btn, '::before').width,
      bar: bar && photo && { left: bar.left - photo.left, width: bar.width, photoW: photo.width,
        mid: bar.top + bar.height / 2 - (photo.top + photo.height / 2) },
      badgeCleared: (() => {
        if (!badge) return null
        const r = badge.getBoundingClientRect()
        const heart = badge.parentElement.querySelector('button')
        const h = heart.getBoundingClientRect()
        const cs = getComputedStyle(heart, '::before')
        const disc = parseFloat(cs.width)
        const hl = h.left + (h.width - disc) / 2, hr = hl + disc
        return r.right <= hl || r.left >= hr
      })(),
      clamp: h3 && getComputedStyle(h3).webkitLineClamp,
      face: h3 && getComputedStyle(h3).fontFamily.split(',')[0].replace(/"/g, ''),
    }
  }, SOLD)

  // Nothing below means anything on an empty grid.
  check(m.cards > 4, 'the shop grid rendered cards', `${m.cards}`)
  check(m.hit && m.hit[0] >= 44 && m.hit[1] >= 44, 'the heart keeps a 44px tap area', JSON.stringify(m.hit))
  check(m.disc === '32px', 'and paints a 32px disc', m.disc)
  check(m.bg === 'rgba(0, 0, 0, 0)', 'with no 44px background behind the disc (the grey ring)', m.bg)
  check(m.badgeCleared === true, 'the badge does not overlap the heart\'s disc', String(m.badgeCleared))
  check(!!m.bar, 'the bundle\'s own SOLD OUT bar is on the sold-out card')
  if (m.bar) {
    check(Math.abs(m.bar.left) < 1 && Math.abs(m.bar.width - m.bar.photoW) < 1,
      'the SOLD OUT bar still spans the photo edge to edge', JSON.stringify(m.bar))
    check(Math.abs(m.bar.mid) < 2, 'and still sits across the middle of the photo', JSON.stringify(m.bar))
  }
  check(m.clamp === '2', 'product names clamp at two lines, not one', m.clamp)
  check(m.face === 'IBM Plex Sans', 'product names use the body face, not the display face', m.face)

  await page.goto(`${BASE}/shop?q=vanquish&lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const en = await page.evaluate(() => [...document.querySelectorAll('.sporta-brand-name')].map((e) => e.textContent))
  check(en.length > 0 && en.every((t) => t === 'Vanquish'), 'a branded product shows its brand name in English', JSON.stringify(en))
  await page.goto(`${BASE}/shop?q=vanquish`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const ar = await page.evaluate(() => [...document.querySelectorAll('.sporta-brand-name')].map((e) => e.textContent))
  check(ar.length > 0 && ar.every((t) => /[؀-ۿ]/.test(t)), 'and in Arabic on the Arabic shop', JSON.stringify(ar))
  await page.close()
} finally {
  await browser.close()
  for (const id of ids) await admin('product_image_delete', { id })
  for (const kv of stockBefore) {
    const [size, stock] = kv.split('=')
    sql(`update product_variants set stock = ${Number(stock)} where slug = '${SOLD}' and size = '${size}'`)
  }
  const after = sql(`select concat(size,'=',stock) from product_variants where slug='${SOLD}'`).trim().split('\n').filter(Boolean)
  check(JSON.stringify(after) === JSON.stringify(stockBefore), 'the stock was put back as it was')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the cards read, and the bundle\'s own marks are where it put them')
process.exit(fails ? 1 : 0)
