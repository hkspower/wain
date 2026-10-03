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
 *
 * THE CAPTION SINCE 2026-10-01 ("white background with orange font, make more
 * spacing"): white, with the name and price in the shop's orange for text on white,
 * every line of it readable there (4.5:1, computed from the rendered colours, so a
 * rule that loses to the dark theme's silver is caught), more padding, and more room
 * between the cards. And a card that is both on sale and a bestseller keeps its two
 * pills apart — the rule meant to do that had never applied.
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
// and a BESTSELLER on sale, so a card carries both pills: without one, "the two pills stay apart"
// compares nothing and passes on any CSS at all. The bundle's "Bestseller" pill is NOT the API's
// `featured` — it is baked into the bundle's own product list by slug (measured: featured = 1 drew
// no pill) — so the sale goes on a product the bundle already calls a bestseller.
const BEST = 'cagliari-calcio-backpack'
const hadBestSale = sql(`select coalesce(sale_price,'NULL') from products where slug='${BEST}'`)
sql(`update products set sale_price = price - 1 where slug='${BEST}'`)
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
try {
  for (const lang of ['en', 'ar']) {
    const p = await (await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
    await p.goto(`${BASE}/shop?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
    const m = await p.evaluate((slug) => {
      const cards = [...document.querySelectorAll('main div.grid > article')]
      const mine = cards.find((a) => a.querySelector(`:scope > a[href="/product/${slug}"]`))   // its OWN photo link: other cards' colour circles link to products too
      // PLAIN = name and price only: no colour/size rows, no struck price, and no brand line either
      // (a brand adds a line). And in a row of plain cards: a row's captions are kept level on
      // purpose, so a plain card beside a sale card is stretched to the sale card's height.
      const isPlain = (a) => !a.querySelector('.cardopt') && !a.querySelector('s') && !a.querySelector('[data-sporta-brand-chip]')
      const rowOf = (a) => cards.filter((x) => Math.abs(x.getBoundingClientRect().top - a.getBoundingClientRect().top) < 2)
      const plain = cards.find((a) => isPlain(a) && rowOf(a).every(isPlain))
      // THE CAPTION WITHOUT ITS ROWS (2026-10-03): since the colour circles and size boxes most
      // cards carry rows, so a fully plain card may not exist. The 85px cap is then measured on
      // a card with no struck price and no brand line that is the TALLEST in its row (so not
      // stretched), less its rows, their margin and one caption gap. Null fails: it must never
      // pass on nothing.
      const noRows = (() => {
        const ok = (a) => !a.querySelector('s') && !a.querySelector('[data-sporta-brand-chip]')
        const tallest = (a) => rowOf(a).every((x) => x.getBoundingClientRect().height <= a.getBoundingClientRect().height + 0.5)
        const a = cards.find((x) => ok(x) && tallest(x))
        if (!a) return null
        const cap = a.children[1], box = cap.querySelector(':scope > .cardopt'), cs = getComputedStyle(cap), h3 = cap.querySelector('h3')
        // ...and a one-line name gets back the 12px kept under it for the + when there are no rows (44-)
        const less = box ? box.getBoundingClientRect().height + parseFloat(getComputedStyle(box).marginBottom) + parseFloat(cs.rowGap || cs.gap || 0)
          - (h3.classList.contains('gnf') && !h3.classList.contains('gnf-wrap') ? 12 : 0) : 0
        return { slug: a.querySelector('a').getAttribute('href'), h: cap.getBoundingClientRect().height - less,
          extra: Math.max(0, h3.getBoundingClientRect().height - parseFloat(getComputedStyle(h3).lineHeight)) }
      })()
      const c = cards[0], gs = getComputedStyle(c.parentElement), cs = getComputedStyle(c)
      const box = (e) => e.getBoundingClientRect()
      const r0 = box(cards[0]), r1 = box(cards[1])
      const below = cards.find((x) => box(x).top > r0.bottom + 1)
      const photoLink = c.children[0], photo = box(photoLink)
      const heart = mine.querySelector('button[aria-pressed]'), plus = [...mine.querySelectorAll('a > button:not([aria-pressed])')].sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]  // the quick-add size chooser is another overlay's node: take the visible + at the bottom
      const ch = box(mine), hb = box(heart), pb = box(plus)
      const badge = mine.querySelector('.sale-chip'), bb = badge && box(badge)
      const cap = mine.children[1], price = cap.querySelector('.price-card'), old = price.querySelector('s'), h3 = cap.querySelector('h3')
      // the colour is a ringed circle in the caption since 2026-10-03 (card-options.js), not a "● colour" line
      const colour = cap.querySelector('.cardopt-colour[aria-current="true"]')
      const optBox = cap.querySelector(':scope > .cardopt'), size0 = cap.querySelector('.cardopt-size'), disc0 = cap.querySelector('.cardopt-colour__disc')
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
        nameLines: Math.round(box(h3).height / (parseFloat(getComputedStyle(h3).lineHeight) || 1)), nameWrapFallback: h3.classList.contains('gnf-wrap'),
        nameClear: (() => { const r = document.createRange(); r.selectNodeContents(h3); const t = r.getBoundingClientRect(), pr = plus.getBoundingClientRect(); return +(pr.top - t.bottom).toFixed(1) })(),
        nameAlign: getComputedStyle(h3).textAlign, nameSize: parseFloat(getComputedStyle(h3).fontSize), nameWeight: +getComputedStyle(h3).fontWeight,
        priceSize: parseFloat(getComputedStyle(price).fontSize), priceWeight: +getComputedStyle(price).fontWeight,
        oldDeco: old ? getComputedStyle(old).textDecorationLine : null, oldSize: old ? parseFloat(getComputedStyle(old).fontSize) : null,
        colourText: colour && colour.getAttribute('aria-label'), dot: colour && getComputedStyle(colour.querySelector('.cardopt-colour__disc')).backgroundColor,
        oldColourLines: document.querySelectorAll('.sporta-card-colour').length,
        plusClearOfRows: optBox ? (() => { const pr = plus.getBoundingClientRect(); return [...optBox.querySelectorAll('.cardopt-size, .cardopt-colour')].every((e) => { const r = e.getBoundingClientRect(); return !(r.left < pr.right && pr.left < r.right && r.top < pr.bottom && pr.top < r.bottom) }) && +(pr.top - optBox.getBoundingClientRect().bottom).toFixed(1) >= 0 })() : null,
        rowLefts: [disc0 && disc0.getBoundingClientRect().left - ch.left, size0 && size0.getBoundingClientRect().left - ch.left],
        noRows,
        order: [...cap.children].map((e) => e.className.split(' ')[0] || e.tagName),
        capPlainH: capP ? box(capP).height : null,
        // the whole name is shown since 2026-10-02 (no ellipsis): each wrapped line adds one line-height
        capPlainExtra: capP && capP.querySelector('h3') ? Math.max(0, box(capP.querySelector('h3')).height - parseFloat(getComputedStyle(capP.querySelector('h3')).lineHeight)) : 0,
        capBg: getComputedStyle(cap).backgroundColor, capPad: [parseFloat(getComputedStyle(cap).paddingTop), parseFloat(getComputedStyle(cap).paddingLeft)],
        nameColour: getComputedStyle(h3).color, priceColour: getComputedStyle(price).color,
        // every line of the caption against its white: rgb() and color(srgb …) both parsed, so a
        // colour-mix() result is read as what it is rather than skipped
        lines: [...cap.querySelectorAll('.sporta-brand-name, h3, .cardopt-size:not(:disabled) .cardopt-size__t, .price-card, .price-card s, .price-card del')]
          .filter((e) => e.getBoundingClientRect().width > 0 && e.textContent.trim())
          .map((e) => ({ what: e.tagName === 'H3' ? 'name' : e.tagName === 'S' || e.tagName === 'DEL' ? 'old price' : e.className.split(' ')[0], colour: getComputedStyle(e).color })),
        // any card carrying BOTH a sale chip and a bestseller pill: their boxes must not meet
        pillClash: cards.map((a) => [a.querySelector(':scope > a > .sale-chip'), a.querySelector(':scope > a > span[class~="bg-brand"][class~="rounded-lg"]')])
          .filter(([x, y]) => x && y).map(([x, y]) => { const p = box(x), q = box(y); return p.bottom > q.top && q.bottom > p.top && p.right > q.left && q.right > p.left }),
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
    // more room since 2026-10-01 (the owner's "make more spacing"; it was 8-10px each way)
    check(Math.round(m.colGap) === 12 && Math.round(m.rowGap) === 12, `${L} card spacing 12px across and down on a phone (2026-10-03)`, `${m.colGap}/${m.rowGap}`)
    check(rgb(m.capBg) === '255,255,255' && m.capPad[0] >= 12 && m.capPad[1] >= 12, `${L} the caption is white, with at least 12px inside it`, `${m.capBg} ${m.capPad}`)
    check(rgb(m.nameColour) === '23,26,30' && rgb(m.priceColour) === '194,65,12', `${L} the name is the dark ink and the price the orange that reads on white (2026-10-03)`, `${m.nameColour} / ${m.priceColour}`)
    const lum = (c) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number); const f = /^color\(/.test(c) ? v : v.map((x) => x / 255); return f.map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0) }
    const ratios = m.lines.map((l) => ({ what: l.what, r: +((1.05) / (lum(l.colour) + 0.05)).toFixed(2) }))
    check(ratios.length >= 3 && ratios.every((x) => x.r >= 4.5), `${L} every line of the caption reads on its white (AA, ${ratios.length} lines measured)`, ratios.map((x) => `${x.what} ${x.r}`).join(', '))
    check(m.pillClash.length >= 1 && m.pillClash.every((x) => !x), `${L} a card both on sale and a bestseller keeps its two pills apart (${m.pillClash.length} such card(s))`, JSON.stringify(m.pillClash))
    check(m.heartRight <= 8 && m.heartTop <= 10 && /0, 0, 0, 0|transparent/.test(m.heartDisc), `${L} an outline heart at the top-RIGHT in both languages, no disc`, `${m.heartRight}/${m.heartTop} ${m.heartDisc}`)
    check(m.plusRight <= 8 && m.plusBottom <= 8 && !m.plusInPhoto && rgb(m.plusDisc) === '245,99,21', `${L} the orange + sits at the caption's bottom-right, off the photograph`, `${m.plusRight}/${m.plusBottom} inPhoto=${m.plusInPhoto} ${m.plusDisc}`)
    check(m.badgeLeft !== null && m.badgeLeft <= 14 && m.badgeTop <= 14 && m.badgeRadius >= 10 && rgb(m.badgeBg) === '207,74,11', `${L} the sale badge is an orange pill at the top-LEFT`, `${m.badgeLeft}/${m.badgeTop} r${m.badgeRadius} ${m.badgeBg}`)
    check(m.nameAlign === 'left' && Math.abs(m.nameLeft - m.priceLeft) <= 2, `${L} name and price are left-aligned on one edge`, `${m.nameAlign} ${m.nameLeft}/${m.priceLeft}`)
    check(m.rowLefts.every((x) => x !== null && Math.abs(x - m.nameLeft) <= 2), `${L} the first colour disc and the first size box start on the name's edge too`, `${m.rowLefts} / ${m.nameLeft}`)
    // 2026-10-02: one line, shrunk to fit (grid-name-fit.js), 14px at most and 10px at least
    check(m.nameSize >= 10 && m.nameSize <= 15 && m.nameWeight >= 500, `${L} name 10-15px (shrunk to fit), medium or bold`, `${m.nameSize}/${m.nameWeight}`)
    check(m.nameLines === 1 || m.nameWrapFallback, `${L} the name is ONE line (or the 10px floor wrapped it rather than cutting it)`, `${m.nameLines} lines, wrapFallback=${m.nameWrapFallback}`)
    check(m.nameWrapFallback || m.nameClear >= 0, `${L} the + button does not touch a one-line name`, `${m.nameClear}px between the name text and the +`)
    check(m.plusClearOfRows === true, `${L} the + button does not touch the colour circles or the size boxes`, String(m.plusClearOfRows))
    check(m.priceSize >= 15 && m.priceSize <= 17 && m.priceWeight >= 700, `${L} price 15-17px bold`, `${m.priceSize}/${m.priceWeight}`)
    check(m.oldDeco === 'line-through' && m.oldSize <= 13, `${L} the old price is small and struck through`, `${m.oldDeco} ${m.oldSize}`)
    check(m.colourText && /Cherry Red|أحمر كرزي/.test(m.colourText) && rgb(m.dot) === '143,29,44' && m.oldColourLines === 0, `${L} the card's own colour is a ringed circle with its swatch (no "● colour" line)`, `${m.colourText} ${m.dot} old=${m.oldColourLines}`)
    check(m.capPlainH === null || (m.capPlainH >= 50 && m.capPlainH - m.capPlainExtra <= 85.5), `${L} a plain card's caption is 85px or less, plus one line for each extra line of a wrapped name`, `${m.capPlainH} (name adds ${m.capPlainExtra})`)
    check(m.noRows !== null && m.noRows.h >= 50 && m.noRows.h - m.noRows.extra <= 85.5, `${L} without its colour and size rows, a caption is still 85px or less (plus a wrapped name's extra lines)`, JSON.stringify(m.noRows))
    await p.close()
  }
} finally {
  await br.close()
  sql(hadAttr ? `update product_attrs set colour='${hadAttr}' where slug='${SLUG}'` : `delete from product_attrs where slug='${SLUG}'`)
  sql(hadSale === 'NULL' ? `update products set sale_price = NULL where slug='${SLUG}'` : `update products set sale_price = ${hadSale} where slug='${SLUG}'`)
  sql(hadBestSale === 'NULL' ? `update products set sale_price = NULL where slug='${BEST}'` : `update products set sale_price = ${hadBestSale} where slug='${BEST}'`)
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
