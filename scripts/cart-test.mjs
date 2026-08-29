/**
 * Adding to the bag, from a phone, the way a shopper does it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/cart-test.mjs
 *
 * checkout-test.mjs starts where this one ends: it takes a full bag through to
 * an order. Nothing covered the step before that — tapping أضف and finding out
 * whether anything happened — and on a phone that step is carried by a pinned
 * bar, a toast and a number in the header, none of which had a test.
 *
 * WHAT IT ASSERTS.
 *
 *   THE BAR IS IN REACH. أضف and اشترِ الآن live in a `position: fixed`
 *     `.action-bar`, so a shopper does not have to scroll a 3100px page to
 *     buy. It is height 0 on desktop, which is why every measurement here is
 *     taken at 393x850 with touch on — `@media (pointer: coarse)` and the
 *     phone layout both need `hasTouch` and `isMobile`, and without them this
 *     rig would quietly measure the desktop page and pass on nothing.
 *
 *   THE TAP IS ANSWERED, three ways at once, because one of them is not
 *     enough: a `role=status` naming the garment AND the size (so you know
 *     WHICH thing went in), and the count in the header going up (so you can
 *     still tell a minute later). A confirmation a screen reader never hears
 *     is a button that did nothing.
 *
 *   AND THE ANSWER GOES AWAY. A toast that never clears stops being a
 *     confirmation and becomes furniture — and worse, the next tap has nothing
 *     to say, because the message is already on screen.
 *
 *   THE BAR DOES NOT EAT THE END OF THE PAGE, which is what this rig was
 *     written for. A fixed element is out of flow, so nothing below reserves
 *     room for it: `.app-footer` computed `padding-bottom: 0` against a 73px
 *     bar, and the copyright and the trading name sat underneath it at every
 *     scroll position, on every page carrying the bar. There is no further
 *     down to scroll, so they simply could not be read.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PRODUCT = '/product/vanquish-tank-navy'
const PHONE = { width: 393, height: 850 }

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

// hasTouch AND isMobile, both. The phone layout and every `pointer: coarse`
// rule in the stylesheet are invisible without them.
const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
await page.goto(BASE + PRODUCT)
await page.waitForTimeout(2600)

/** The header's bag count, as a number a shopper could read. */
const bagCount = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('header a, header button')]
    .find((e) => /^[\d٠-٩]+$/.test(e.textContent.trim()))
  if (!el) return 0
  // Arabic-Indic digits are what the shop prints; normalise before comparing.
  return +el.textContent.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
})

console.log('--- the bar')
{
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.action-bar')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const btns = [...el.querySelectorAll('button')].map((b) => ({
      t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height),
    }))
    return { pos: getComputedStyle(el).position, top: Math.round(r.top), h: Math.round(r.height), btns }
  })
  check(bar !== null && bar.pos === 'fixed', 'the buy bar is pinned, not somewhere down the page', bar?.pos)
  check(bar !== null && bar.top < PHONE.height && bar.top > 0,
    'and on screen without scrolling', `top ${bar?.top} of ${PHONE.height}`)
  check(!!bar?.btns.some((b) => /^أضف$/.test(b.t)), 'it carries Add', bar?.btns.map((b) => b.t).join(' | '))
  check(!!bar?.btns.some((b) => /اشترِ الآن/.test(b.t)), 'and Buy now')
  // 44 is the AAA target and what a bar you tap while walking should clear.
  check(bar !== null && bar.btns.every((b) => b.h >= 44),
    'both big enough to hit', bar?.btns.map((b) => `${b.t}:${b.h}`).join(' '))
}

console.log('\n--- tapping Add')
{
  const before = await bagCount()
  await page.locator('button').filter({ hasText: /^L$/ }).first().click()
  await page.waitForTimeout(250)
  await page.locator('.action-bar button').filter({ hasText: /^أضف$/ }).first().click()
  await page.waitForTimeout(500)

  const said = await page.evaluate(() => {
    const e = [...document.querySelectorAll('[role=status]')].find((x) => /أُضيف/.test(x.textContent))
    if (!e) return null
    const r = e.getBoundingClientRect()
    const bar = document.querySelector('.action-bar').getBoundingClientRect()
    return { text: e.textContent.trim(), overlapsBar: r.bottom > bar.top && r.top < bar.bottom }
  })
  check(said !== null, 'the shop says so, in a role=status a screen reader will read')
  check(!!said && /تانك|فانكويش/.test(said.text), 'naming the garment', said?.text.slice(0, 40))
  check(!!said && /\bL\b/.test(said.text), 'and the size, so you know WHICH one went in', said?.text.slice(0, 40))
  check(!said?.overlapsBar, 'and it does not sit under the bar it appeared above')

  const after = await bagCount()
  check(after === before + 1, `and the header count goes ${before} -> ${before + 1}`, `got ${after}`)

  // A SECOND TAP MUST ALSO COUNT. Repeat adds are how a shopper buys two.
  await page.locator('.action-bar button').filter({ hasText: /^أضف$/ }).first().click()
  await page.waitForTimeout(500)
  check(await bagCount() === before + 2, 'a second tap adds a second one')
}

console.log('\n--- and then gets out of the way')
{
  await page.waitForTimeout(8000)
  const gone = await page.evaluate(() =>
    ![...document.querySelectorAll('[role=status]')].some((x) => /أُضيف/.test(x.textContent)))
  check(gone, 'the confirmation clears itself instead of becoming furniture')
}

console.log('\n--- the end of the page')
{
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  const covered = await page.evaluate(() => {
    const bar = document.querySelector('.action-bar').getBoundingClientRect()
    const hit = []
    document.querySelectorAll('body *').forEach((e) => {
      if (e.children.length) return
      const t = (e.textContent || '').trim(); if (!t) return
      const r = e.getBoundingClientRect(); if (!r.height) return
      let n = e, inBar = false
      while (n && n !== document.body) {
        if (getComputedStyle(n).position === 'fixed') { inBar = true; break }
        n = n.parentElement
      }
      if (!inBar && r.bottom > bar.top && r.top < window.innerHeight) hit.push(t.slice(0, 34))
    })
    return hit
  })
  check(covered.length === 0,
    'scrolled all the way down, the bar covers nothing — including the shop\'s own legal lines',
    covered.join(' | '))
}

await ctx.close()

console.log('\n--- and none of it on desktop')
{
  const d = await browser.newContext({ viewport: { width: 1280, height: 850 } })
  const dp = await d.newPage()
  await dp.goto(BASE + PRODUCT)
  await dp.waitForTimeout(2600)
  const h = await dp.evaluate(() => {
    const el = document.querySelector('.action-bar')
    return el ? Math.round(el.getBoundingClientRect().height) : 0
  })
  check(h === 0, 'the pinned bar takes no room on a desktop, so the phone fix stays a phone fix', `height ${h}`)
  await d.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the bag says what went in, and gives the page back')
process.exit(fails ? 1 : 0)
