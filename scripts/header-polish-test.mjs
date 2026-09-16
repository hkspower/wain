/**
 * The orange header, four small follow-ups asked for after the first design
 * review: a tap/hover state on the nav, a seam between the promo strip and
 * the nav row, a bigger logo lockup, and a shadow separating the sticky
 * header from whatever scrolls under it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/header-polish-test.mjs
 *
 * Asked for on 2026-09-17, all four in one pass. None of them are contrast
 * or accessibility fixes — the AA numbers from the header's own original
 * commit are untouched (site-contrast.mjs already re-checks those) — these
 * are the visual polish items from that review.
 *
 * NAV HOVER/ACTIVE: the bundle's only hover feedback was a colour swap
 * (hover:text-brand-bright) tuned for the OLD dark header, invisible on a
 * touchscreen anyway since there is no hover state on a phone. A background
 * tint on :hover and :active gives visible feedback either way.
 *
 * THE PROMO/HEADER SEAM: the promo strip (`bg-ink-steel`) and the nav row
 * share one <header>, so painting the header orange left the strip's own
 * opaque dark background sitting on it with a hard edge. A hairline in the
 * shop's own ember ties the two together without changing the strip's own
 * background (its text reads worse on orange).
 *
 * THE LOGO: "SPORTS WEAR" is baked into logo-white.png/webp, not separate
 * text, so it cannot be resized alone. The whole lockup ships at h-8/md:h-9
 * against a 600x184 source — a plain scale-up (2.25rem/2.5rem) makes the
 * tagline more legible without new artwork or changing its proportions.
 * Matched structurally (`nav > a img`), NOT by the link's aria-label — that
 * label reads "Sporta — home" in English and "سبورتا — الرئيسية" in
 * Arabic, so an attribute-suffix selector would have silently missed one of
 * them. Checked in both languages for exactly this reason.
 *
 * THE SHADOW: at 390px the header sits flush against the hero image below
 * it, with nothing to say where one ends and the other begins. A drop
 * shadow costs no layout — unlike padding, which would eat into the hero
 * height this project has already fought hard to protect.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/* --------------------------------------------------------- 1. nav hover --- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 300 } })
  await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // The menu was hidden site-wide on 2026-09-17 (a later, separate
  // request), so it has no layout box for a real mouse to hover over.
  // Same-layer override as nav-menu-test.mjs uses for its own click test —
  // `@layer utilities`, not unlayered, because layered `!important` beats
  // unlayered `!important` regardless of source order. This still checks
  // the hover RULE itself works; it does not claim a visitor can trigger
  // it today.
  await page.addStyleTag({ content: '@layer utilities { header.app-header ul { display: flex !important; } }' })

  const before = await page.evaluate(() => {
    const l = [...document.querySelectorAll('header.app-header ul li a')]
      .find((a) => a.textContent.trim() === 'Contact')
    return getComputedStyle(l).backgroundColor
  })
  check(before === 'rgba(0, 0, 0, 0)', 'before hover, the nav link has no background', before)

  const link = await page.locator('header.app-header ul li a', { hasText: 'Contact' })
  const box = await link.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)

  const hovered = await page.evaluate(() => {
    const l = [...document.querySelectorAll('header.app-header ul li a')]
      .find((a) => a.textContent.trim() === 'Contact')
    return { bg: getComputedStyle(l).backgroundColor, color: getComputedStyle(l).color }
  })
  check(hovered.bg === 'rgba(0, 0, 0, 0.15)', 'on hover, a background tint appears', hovered.bg)
  check(hovered.color === 'rgb(255, 255, 255)', 'and the text stays white, not the bundle\'s own orange hover', hovered.color)
  await page.close()
}

/* ------------------------------------------------------------ 2. seam --- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 300 } })
  await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const border = await page.evaluate(() => {
    const p = document.querySelector('header.app-header > p')
    return getComputedStyle(p).borderBottomWidth + ' ' + getComputedStyle(p).borderBottomStyle
  })
  check(border === '1px solid', 'the promo strip gets a 1px border, tying it to the header below', border)
  await page.close()
}

/* ------------------------------------------------------------- 3. logo --- */
// Measured against 2.5rem TIMES THE PAGE'S OWN ROOT FONT SIZE, not a fixed
// pixel count — this shop's root font-size is ~16.83px, not the 16px
// browser default, so a hardcoded "40px" expectation would fail on a
// correct render. Same shape as brand-token-test.mjs's own near() check:
// derive the expectation from what the page itself reports.
for (const lang of ['en', 'ar']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 300 } })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const { h, rootPx } = await page.evaluate(() => {
    const img = document.querySelector('header.app-header nav > a img')
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize)
    return { h: img ? img.getBoundingClientRect().height : null, rootPx }
  })
  const want = 2.5 * rootPx
  check(h !== null && Math.abs(h - want) < 1,
    `${lang}: the logo renders at 2.5rem (up from the shipped 2.25rem/9)`, `got=${h}px want=${want.toFixed(1)}px`)
  await page.close()
}

/* ------------------------------------------------------------ 4. shadow --- */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 400 } })
  await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const shadow = await page.evaluate(() => {
    const h = document.querySelector('header.app-header')
    return getComputedStyle(h).boxShadow
  })
  check(shadow !== 'none' && shadow !== '', 'the header casts a shadow, separating it from the hero below', shadow)

  // Costs no layout: the hero's own position is unaffected — same
  // assertion shape as the hero-size rig's own floor/cap checks.
  const heroTop = await page.evaluate(() => {
    const hero = document.querySelector('main section[aria-roledescription]')
    return hero ? Math.round(hero.getBoundingClientRect().top) : null
  })
  const headerBottom = await page.evaluate(() => {
    const h = document.querySelector('header.app-header')
    return Math.round(h.getBoundingClientRect().bottom)
  })
  check(heroTop === headerBottom, 'and the hero still sits flush against the header — no padding was added', `hero=${heroTop} header=${headerBottom}`)
  await page.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — hover feedback, the promo seam, the bigger logo and the header shadow all land')
process.exit(fails ? 1 : 0)
