/**
 * The product page on a phone — order, spacing and centring. 2026-09-29.
 *
 *   bash scripts/sandbox.sh && node scripts/product-phone-layout-test.mjs
 *
 * Asked for as "fix product page mobile alignment and centering and spacing
 * and padding". The worst fault was invisible to every existing rig: the buy
 * row was given `order: 3.5`, which CSS rejects (order is an integer), so it
 * painted FIRST — above the product name — on every phone in both languages.
 * So the first thing asserted is the order the PAGE PAINTS, measured from the
 * boxes and not from the inline style that asked for it.
 *
 * Also asserted, each against a measurement rather than a copy of the rule:
 *   - the blocks follow the specified order and are separated by 16-40px
 *     (a block jammed against the next, or a canyon between two, fails);
 *   - the name and price sit on the page's centre (the owner's choice of
 *     2026-09-04) and the name is padded clear of the heart at BOTH ends;
 *   - the Fit card's label is vertically balanced (its hidden body used to
 *     leave 12px extra underneath);
 *   - the breadcrumb band is not a banner (it was 48px over, 24px under);
 *   - nothing scrolls sideways.
 * Fixture: the sandbox product named below, by slug, not by position.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cheetahs-rugby-t-shirt'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/product/${SLUG}?lang=${lang}`)
  await page.waitForSelector('h1.product-title')
  await page.waitForTimeout(2500)
  const m = await page.evaluate(() => {
    const y = (e) => e.getBoundingClientRect().top + scrollY
    const h1 = document.querySelector('h1.product-title')
    const titleRow = h1.parentElement, col = titleRow.parentElement
    const kids = [...col.children]
    const by = (f) => kids.find(f)
    const price = by(e => e.tagName === 'P' && /items-baseline/.test(e.className))
    const size = by(e => /space-y-3/.test(e.className))
    const buy = by(e => e.tagName === 'DIV' && /flex-wrap/.test(e.className) && e.querySelector('.btn-primary'))
    const list = by(e => e.tagName === 'UL')
    const desc = by(e => e.tagName === 'P' && !/items-baseline/.test(e.className) && !e.hasAttribute('data-pp-echo'))   // a description that only repeats the name is hidden (product-polish.js) and is not a block to measure
    const guide = by(e => e.hasAttribute('data-sporta-size-guide'))
    const blocks = { title: titleRow, price, size, buy, list, desc, guide }
    const boxes = {}
    for (const [k, e] of Object.entries(blocks)) if (e) { const r = e.getBoundingClientRect(); boxes[k] = { top: r.top + scrollY, bottom: r.bottom + scrollY } }
    const range = document.createRange(); range.selectNodeContents(h1)
    const tr = range.getBoundingClientRect()
    const pr = price.querySelector('.font-display').getBoundingClientRect()
    const fitCard = [...document.querySelectorAll('.rounded-2xl.border')].find(e => e.querySelector(':scope > .hidden')) 
    let fit = null
    if (fitCard) { const lab = fitCard.firstElementChild.getBoundingClientRect(), c = fitCard.getBoundingClientRect(); const btn = fitCard.querySelector('button'); const br = btn ? btn.getBoundingClientRect() : lab
      const mid = (lab.top + lab.bottom) / 2; fit = { above: mid - c.top, below: c.bottom - mid } }
    const nav = document.querySelector('main nav.mb-6'); const g = document.querySelector('.group.aspect-square')
    const hdr = document.querySelector('header').getBoundingClientRect().bottom
    return { boxes, titleCentre: (tr.left + tr.right) / 2, priceCentre: (pr.left + pr.right) / 2, W: innerWidth,
      scrollW: document.documentElement.scrollWidth, titlePad: [parseFloat(getComputedStyle(h1).paddingLeft), parseFloat(getComputedStyle(h1).paddingRight)],
      fit, photoL: g.getBoundingClientRect().left, photoR: innerWidth - g.getBoundingClientRect().right, bcAbove: nav.getBoundingClientRect().top - hdr, bcBelow: g.getBoundingClientRect().top - nav.getBoundingClientRect().bottom }
  })
  const order = ['title', 'price', 'size', 'buy', 'list', 'desc', 'guide'].filter(k => m.boxes[k])
  check(m.photoL >= 16 && m.photoR >= 16 && Math.abs(m.photoL - m.photoR) <= 1, `${lang}: the main photograph has space at both sides, at least the 16px page gutter and equal`, `${Math.round(m.photoL)} / ${Math.round(m.photoR)}`)
  check(order.length >= 6, `${lang}: the page has the blocks under test`, order.join(' '))
  const tops = order.map(k => m.boxes[k].top)
  check(tops.every((t, i) => i === 0 || t >= tops[i - 1]), `${lang}: painted top to bottom as title, price, size, buy row, delivery, description, guide`,
    order.map((k, i) => `${k}@${Math.round(tops[i])}`).join(' '))
  const gaps = order.slice(1).map((k, i) => m.boxes[k].top - m.boxes[order[i]].bottom)
  check(gaps.every(g => g >= 16 && g <= 40), `${lang}: every block is 16-40px from the next`, gaps.map(Math.round).join(' '))
  check(Math.abs(m.titleCentre - m.W / 2) <= 2, `${lang}: the name is on the page's centre`, `${Math.round(m.titleCentre)} vs ${m.W / 2}`)
  check(Math.abs(m.priceCentre - m.W / 2) <= 2, `${lang}: the price is on the page's centre`, `${Math.round(m.priceCentre)} vs ${m.W / 2}`)
  check(m.titlePad[0] >= 48 && m.titlePad[1] >= 48, `${lang}: the name is padded clear of the heart at both ends`, m.titlePad.join('/'))
  check(m.fit && Math.abs(m.fit.above - m.fit.below) <= 4, `${lang}: the Fit card's label is vertically balanced`, m.fit ? `${Math.round(m.fit.above)} / ${Math.round(m.fit.below)}` : 'no card')
  check(m.bcAbove <= 28 && m.bcBelow <= 24, `${lang}: the breadcrumb band is not a banner`, `${Math.round(m.bcAbove)} above, ${Math.round(m.bcBelow)} below`)
  check(m.scrollW <= m.W, `${lang}: nothing scrolls sideways`, `${m.scrollW} in ${m.W}`)
  await ctx.close()
}
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nall ok — the product page reads in order, evenly spaced and centred on a phone')
process.exit(fails ? 1 : 0)
