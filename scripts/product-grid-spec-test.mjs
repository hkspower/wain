/**
 * The product grid matches the owner's card picture (2026-09-30), measured on the
 * rendered shop at a phone width, in both languages.
 *
 *   bash scripts/sandbox.sh && node scripts/product-grid-spec-test.mjs
 *
 * The picture's numbers were sampled from the screenshot's pixels (card #0e1116,
 * photo 1.09:1, orange pill top-left, outline heart top-right, orange + bottom-
 * right, everything else left-aligned); the table the owner sent first supplies
 * the type sizes and the caption height. Needs a photographed product and a
 * coloured one to look at; the rig sets a colour in the sandbox and puts it back.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && !ok ? '   ' + d : ''}`) }
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number).join(',')
const SLUG = 'cheetahs-rugby-t-shirt'
const hadAttr = sql(`select colour from product_attrs where slug='${SLUG}'`)
const hadSale = sql(`select coalesce(sale_price,'NULL') from products where slug='${SLUG}'`)
sql(`replace into product_attrs (slug, colour) values ('${SLUG}', 'cherry-red')`)
sql(`update products set sale_price = 6.5 where slug='${SLUG}'`)
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
try {
  for (const lang of ['en', 'ar']) {
    const p = await (await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
    await p.goto(`${BASE}/shop?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
    const m = await p.evaluate((slug) => {
      const cards = [...document.querySelectorAll('main div.grid > article')]
      const mine = cards.find((a) => a.querySelector(`a[href="/product/${slug}"]`))
      const plain = cards.find((a) => !a.querySelector('.sporta-card-colour') && !a.querySelector('s'))
      const c = cards[0], gs = getComputedStyle(c.parentElement), cs = getComputedStyle(c)
      const box = (e) => e.getBoundingClientRect()
      const r0 = box(cards[0]), r1 = box(cards[1])
      const below = cards.find((x) => box(x).top > r0.bottom + 1)
      const photoLink = c.children[0], photo = box(photoLink)
      const heart = mine.querySelector('button[aria-pressed]'), plus = [...mine.querySelectorAll('a > button:not([aria-pressed])')].sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]  // the quick-add size chooser is another overlay's node: take the visible + at the bottom
      const ch = box(mine), hb = box(heart), pb = box(plus)
      const badge = mine.querySelector('.sale-chip'), bb = badge && box(badge)
      const cap = mine.children[1], price = cap.querySelector('.price-card'), old = price.querySelector('s'), h3 = cap.querySelector('h3')
      const colour = cap.querySelector('.sporta-card-colour')
      const capP = plain && plain.children[1]
      return {
        cols: gs.gridTemplateColumns.split(' ').length, ratio: photo.width / photo.height, bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius),
        border: cs.borderTopWidth, outline: getComputedStyle(photoLink).outlineStyle,
        photoBg: getComputedStyle(mine.children[0].querySelector('img') || mine.children[0]).backgroundColor,
        colGap: Math.min(Math.abs(r1.left - r0.right), Math.abs(r0.left - r1.right)), rowGap: below ? box(below).top - r0.bottom : null,
        heartRight: ch.right - hb.right, heartTop: hb.top - ch.top, heartDisc: getComputedStyle(heart, '::before').backgroundColor,
        plusRight: ch.right - pb.right, plusBottom: ch.bottom - pb.bottom, plusDisc: getComputedStyle(plus, '::before').backgroundColor, plusInPhoto: pb.top < box(mine.children[0]).bottom,
        badgeLeft: bb ? bb.left - ch.left : null, badgeTop: bb ? bb.top - ch.top : null, badgeBg: badge ? getComputedStyle(badge).backgroundColor : null,
        badgeRadius: badge ? parseFloat(getComputedStyle(badge).borderTopLeftRadius) : null, badgeH: bb ? bb.height : null,
        nameAlign: getComputedStyle(h3).textAlign, nameSize: parseFloat(getComputedStyle(h3).fontSize), nameWeight: +getComputedStyle(h3).fontWeight,
        priceSize: parseFloat(getComputedStyle(price).fontSize), priceWeight: +getComputedStyle(price).fontWeight,
        oldDeco: old ? getComputedStyle(old).textDecorationLine : null, oldSize: old ? parseFloat(getComputedStyle(old).fontSize) : null,
        colourText: colour && colour.textContent.trim(), dot: colour && getComputedStyle(colour.querySelector('i')).backgroundColor,
        order: [...cap.children].map((e) => e.className.split(' ')[0] || e.tagName),
        capPlainH: capP ? box(capP).height : null,
        nameLeft: (() => { const r = document.createRange(); r.selectNodeContents(h3); return r.getBoundingClientRect().left - ch.left })(),
        priceLeft: (() => { const r = document.createRange(); r.selectNodeContents(price); return r.getBoundingClientRect().left - ch.left })(),
      }
    }, SLUG)
    const L = `${lang}:`
    check(m.cols === 2, `${L} two columns on a phone`, String(m.cols))
    check(Math.abs(m.ratio - 0.8) < 0.01, `${L} the photo is 4:5 (one shape everywhere since 2026-10-01)`, m.ratio.toFixed(3))
    check(rgb(m.bg) === '14,17,22', `${L} card background is the picture's #0e1116`, m.bg)
    check(m.radius >= 14 && m.radius <= 16, `${L} corner radius 14-16px`, String(m.radius))
    check(m.border === '1px' && m.outline === 'none', `${L} a faint 1px card edge, and no outline on the photo`, `${m.border} ${m.outline}`)
    check(rgb(m.photoBg) === '255,255,255', `${L} a photographed card has a white image background`, m.photoBg)
    check(m.colGap >= 8 && m.colGap <= 10 && m.rowGap >= 8 && m.rowGap <= 10, `${L} card spacing 8-10px each way`, `${m.colGap}/${m.rowGap}`)
    check(m.heartRight <= 8 && m.heartTop <= 10 && /0, 0, 0, 0|transparent/.test(m.heartDisc), `${L} an outline heart at the top-RIGHT in both languages, no disc`, `${m.heartRight}/${m.heartTop} ${m.heartDisc}`)
    check(m.plusRight <= 8 && m.plusBottom <= 8 && !m.plusInPhoto && rgb(m.plusDisc) === '245,99,21', `${L} the orange + sits at the caption's bottom-right, off the photograph`, `${m.plusRight}/${m.plusBottom} inPhoto=${m.plusInPhoto} ${m.plusDisc}`)
    check(m.badgeLeft !== null && m.badgeLeft <= 14 && m.badgeTop <= 14 && m.badgeRadius >= 10 && rgb(m.badgeBg) === '207,74,11', `${L} the sale badge is an orange pill at the top-LEFT`, `${m.badgeLeft}/${m.badgeTop} r${m.badgeRadius} ${m.badgeBg}`)
    check(m.nameAlign === 'left' && Math.abs(m.nameLeft - m.priceLeft) <= 2, `${L} name and price are left-aligned on one edge`, `${m.nameAlign} ${m.nameLeft}/${m.priceLeft}`)
    check(m.nameSize >= 14 && m.nameSize <= 15 && m.nameWeight >= 500, `${L} name 14-15px, medium or bold`, `${m.nameSize}/${m.nameWeight}`)
    check(m.priceSize >= 15 && m.priceSize <= 17 && m.priceWeight >= 700, `${L} price 15-17px bold`, `${m.priceSize}/${m.priceWeight}`)
    check(m.oldDeco === 'line-through' && m.oldSize <= 13, `${L} the old price is small and struck through`, `${m.oldDeco} ${m.oldSize}`)
    check(m.colourText && /Cherry Red|أحمر كرزي/.test(m.colourText) && rgb(m.dot) === '143,29,44', `${L} a colour line with its dot`, `${m.colourText} ${m.dot}`)
    check(m.capPlainH === null || (m.capPlainH >= 50 && m.capPlainH <= 85), `${L} a plain card's caption is 85px or less`, String(m.capPlainH))
    await p.close()
  }
} finally {
  await br.close()
  sql(hadAttr ? `update product_attrs set colour='${hadAttr}' where slug='${SLUG}'` : `delete from product_attrs where slug='${SLUG}'`)
  sql(hadSale === 'NULL' ? `update products set sale_price = NULL where slug='${SLUG}'` : `update products set sale_price = ${hadSale} where slug='${SLUG}'`)
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
