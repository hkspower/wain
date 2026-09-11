/**
 * NO FILTERS ON THE SHOP — the guard for it, and for what it must NOT remove.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/no-filters-test.mjs
 *   BASE=https://www.sporta.com.kw node scripts/no-filters-test.mjs
 *
 * Asked for on 2026-09-09: the shop shows everything, always. Three narrowing
 * controls went — the category pills, the size row and the fit row — and they
 * went by CSS, because the storefront is a prebuilt bundle with no source in
 * this repository.
 *
 * A CSS REMOVAL IS ONLY AS GOOD AS ITS SELECTOR, and the selectors here match
 * on Tailwind utility classes plus structure (`.mb-8:has(> button[aria-pressed])`,
 * `.mb-8:has(.filter-scroller)`) because the bundle gives those rows no id and
 * no class of their own. A utility-class selector that matches one row too many
 * takes a control off a page nobody thought to look at — so half of this rig is
 * the OTHER pages, checking that their controls are still there.
 *
 * The product page is the one that matters most: it has a size picker built
 * from the same OptionBox component and its own `aria-pressed` buttons, and if
 * the selector reached it a customer could not choose a size, which means they
 * could not buy anything. That is the failure this rig exists for.
 *
 * WHAT MUST STAY ON THE SHOP: the sort control (sorting narrows nothing) and
 * the grid itself. A rig that only asserted "the filters are gone" would pass
 * just as happily if the whole page had gone.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
  if (!ok) fails++
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

/** Everything a person could actually see and press on the page in front of
 *  us. `offsetParent === null` is display:none or a hidden ancestor — which is
 *  exactly what the removal does, and what a broken selector would do to the
 *  wrong element. */
const survey = () =>
  page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null
    const all = (sel) => [...document.querySelectorAll(sel)]
    return {
      // THE ROWS, not every toggle button on the page. The first version of
      // this rig counted `button[aria-pressed]` and reported 12 visible on a
      // shop whose filters were correctly hidden — they were the WISHLIST
      // HEARTS on the product cards, which carry aria-pressed for exactly the
      // right reason. A count that sweeps up unrelated controls fails for a
      // reason that has nothing to do with what is being tested.
      categoryRows: all('.mb-8:has(> button[aria-pressed])').length,
      visibleCategoryRows: all('.mb-8:has(> button[aria-pressed])').filter(vis).length,
      scrollers: all('.filter-scroller').length,
      visibleScrollers: all('.filter-scroller').filter(vis).length,
      // Anything this removal's selectors reach. On any page but the shop it
      // must be zero: a utility-class selector that matches one row too many
      // is the failure this rig exists for.
      hiddenByUs: all('.mb-8:has(> button[aria-pressed]), .mb-8:has(.filter-scroller)').length,
      selects: all('select').filter(vis).length,
      visiblePressables: all('button[aria-pressed]').filter(vis).length,
      allPressables: all('button[aria-pressed]').length,
      cards: all('a[href^="/product/"]').filter(vis).length,
      addButtons: all('button').filter((b) => vis(b) && /add|أضف|buy|اشتر/i.test(b.textContent || ''))
        .length,
    }
  })

const open = async (path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  // The grid is rendered after /api?r=products answers; waiting for a card is
  // waiting for the page to be the page, and it fails loudly rather than
  // measuring an empty shell.
  await page.waitForSelector('a[href^="/product/"], main', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

console.log(`--- no filters, at ${BASE}\n`)

// ── the shop ───────────────────────────────────────────────────────────────
await open('/shop')
const shop = await survey()

check(shop.cards > 0, 'the shop still lists products', `cards=${shop.cards}`)
check(shop.categoryRows > 0, 'the category row is still in the DOM', `found=${shop.categoryRows}`)
check(shop.visibleCategoryRows === 0, 'and it is not visible', `visible=${shop.visibleCategoryRows}`)
check(shop.scrollers > 0, 'the size and fit rows are still in the DOM', `found=${shop.scrollers}`)
check(shop.visibleScrollers === 0, 'and neither is visible', `visible=${shop.visibleScrollers}`)
check(shop.selects > 0, 'the SORT control is untouched', `selects=${shop.selects}`)

// ── the product page, which shares the same components ─────────────────────
const href = await page.evaluate(
  () => document.querySelector('a[href^="/product/"]')?.getAttribute('href') ?? null
)
if (!href) {
  check(false, 'a product page could be reached to check its size picker')
} else {
  await open(href)
  const product = await survey()
  check(
    product.hiddenByUs === 0,
    'these selectors reach NOTHING on a product page',
    `matched=${product.hiddenByUs} at ${href}`
  )
  check(
    product.visiblePressables > 0,
    'and its size picker is still on screen',
    `visible toggles=${product.visiblePressables}`
  )
  // NOT the same assertion as the one above, and this is the pair that a
  // mutation exposed. `hiddenByUs` asks whether the two selectors WRITTEN in
  // sporta-ui.css reach this page — so it goes on saying no while a DIFFERENT,
  // wider selector quietly hides something. Mutating the rule to
  // `div:has(> button[aria-pressed])` did exactly that: it took the wishlist
  // heart off the product page, and the rig passed.
  //
  // So the invariant is stated without naming a selector: on a product page,
  // NOTHING that can be toggled may be hidden, by any rule, from anywhere.
  check(
    product.allPressables === product.visiblePressables,
    'and nothing else on it was hidden by any rule',
    `inDom=${product.allPressables} visible=${product.visiblePressables}`
  )
  check(product.addButtons > 0, 'and can still be added to the bag', `buttons=${product.addButtons}`)
}

await browser.close()
console.log(
  fails
    ? `\n${fails} failed`
    : '\nall ok — the shop narrows nothing, and every other control survived'
)
process.exit(fails ? 1 : 0)
