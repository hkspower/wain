/**
 * The product grid matches the owner's card table (2026-09-30), measured on the
 * rendered shop at a phone width, in both languages.
 *
 *   bash scripts/sandbox.sh && node scripts/product-grid-spec-test.mjs
 *
 * Every row of the table is a number here. The photo-background row is read off
 * a card that HAS a photograph (the sandbox has one); a card with none keeps its
 * placeholder ground on purpose.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && !ok ? '   ' + d : ''}`) }
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number).join(',')
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
for (const lang of ['en', 'ar']) {
  const p = await (await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await p.goto(`${BASE}/shop?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000)
  const m = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('main div.grid > article')]
    const withPhoto = cards.find((a) => a.querySelector('a > img:not([src^="data:"])'))
    const c = cards[0], g = c.parentElement, gs = getComputedStyle(g), cs = getComputedStyle(c)
    const cap = c.children[1], h3 = cap.querySelector('h3'), price = cap.querySelector('.price-card')
    const r0 = cards[0].getBoundingClientRect(), r1 = cards[1].getBoundingClientRect()
    const below = cards.find((x) => x.getBoundingClientRect().top > r0.bottom + 1)
    const photo = c.children[0].getBoundingClientRect()
    const badge = document.querySelector('main article > a > span[class~="rounded-lg"]')
    return {
      n: cards.length, cols: gs.gridTemplateColumns.split(' ').length, ratio: photo.width / photo.height,
      bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth, outline: getComputedStyle(c.children[0]).outlineStyle,
      photoBg: withPhoto ? getComputedStyle(withPhoto.children[0]).backgroundColor : null,
      nameSize: parseFloat(getComputedStyle(h3).fontSize), nameWeight: +getComputedStyle(h3).fontWeight,
      priceSize: parseFloat(getComputedStyle(price).fontSize), priceWeight: +getComputedStyle(price).fontWeight,
      capH: cap.getBoundingClientRect().height, colGap: Math.min(Math.abs(r1.left - r0.right), Math.abs(r0.left - r1.right)), rowGap: below ? below.getBoundingClientRect().top - r0.bottom : null,
      rtl: getComputedStyle(document.documentElement).direction === 'rtl',
      badgeBg: badge ? getComputedStyle(badge).backgroundColor : null, badgeSize: badge ? parseFloat(getComputedStyle(badge).fontSize) : null,
      plus: (() => { const b = c.querySelector('button[aria-label^="Add"], button[aria-label*="Add"], button[aria-label*="أضف"]'); if (!b) return null; const bb = b.getBoundingClientRect(); return [bb.width, getComputedStyle(b, '::before').borderRadius] })(),
      heart: !!c.querySelector('button[aria-pressed]'),
    }
  })
  const L = `${lang}:`
  check(m.n >= 4, `${L} the shop has cards to measure`, String(m.n))
  check(m.cols === 2, `${L} two columns`, String(m.cols))
  check(Math.abs(m.ratio - 0.8) < 0.01, `${L} photo is 4:5`, m.ratio.toFixed(3))
  check(rgb(m.bg) === '21,22,25', `${L} card background is #151619`, m.bg)
  check(m.radius >= 14 && m.radius <= 16, `${L} corner radius 14-16px`, String(m.radius))
  check(m.border === '0px' && m.outline === 'none', `${L} no border or outline`, `${m.border} ${m.outline}`)
  check(m.photoBg && rgb(m.photoBg) === '255,255,255', `${L} a card with a photograph has a white image background`, String(m.photoBg))
  check(m.nameSize >= 14 && m.nameSize <= 15 && m.nameWeight >= 500, `${L} name 14-15px, medium or bold`, `${m.nameSize}/${m.nameWeight}`)
  check(m.priceSize >= 15 && m.priceSize <= 17 && m.priceWeight >= 700, `${L} price 15-17px bold`, `${m.priceSize}/${m.priceWeight}`)
  check(m.capH >= 60 && m.capH <= 85, `${L} product info is at most 85px tall`, String(Math.round(m.capH)))
  check(Math.abs(m.colGap) >= 8 && Math.abs(m.colGap) <= 10 && m.rowGap >= 8 && m.rowGap <= 10, `${L} card spacing 8-10px each way`, `${m.colGap}/${m.rowGap}`)
  check(m.heart, `${L} a wishlist heart is on the card`)
  check(m.plus && m.plus[0] >= 44, `${L} a small round + (44px tap area, painted disc smaller)`, JSON.stringify(m.plus))
  check(m.badgeBg === null || rgb(m.badgeBg) === '224,86,28', `${L} the badge is orange`, String(m.badgeBg))
  check(m.badgeSize === null || m.badgeSize <= 11, `${L} the badge is small`, String(m.badgeSize))
  await p.close()
}
await br.close()
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
