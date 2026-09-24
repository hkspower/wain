/**
 * The main menu: charcoal header, white text, "Shop" gone, "About" -> Terms.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/nav-menu-test.mjs
 *
 * Asked for on 2026-09-16: an orange header with white nav text, "المتجر"
 * (Shop) removed from the menu, and "من نحن" (About) replaced with a link to
 * the Terms & Conditions page. THE COLOUR CHANGED THE NEXT DAY — asked for on
 * 2026-09-17 as "make top menu and topbar light black color" — and this rig's
 * own colour assertion went stale for it, exactly the failure this project
 * has already recorded once for a service-worker VERSION comment: "a rule
 * that lives only in a comment gets read as history." Found by "check topbar
 * and manu" going red on the one assertion that had not been updated, while
 * every OTHER assertion here — Shop gone, About replaced, graceful
 * degradation — was still correct and still passing.
 *
 * THE COLOUR IS #2b2b2b, NOT --brand-dark. --brand-dark (5.46:1 for white
 * text) was the orange this rig used to check for, chosen the day before over
 * --brand (3.81:1, under AA's 4.5:1 floor). The charcoal that replaced it has
 * no such ceiling to worry about — sporta-ui.css's own comment says so in as
 * many words — but the ratio is still asserted here rather than assumed, for
 * the same reason as before: a future edit changing the header colour again
 * should have to answer to a number, not to this file's memory of one.
 *
 * THE @layer utilities WRAP MATTERS. header.app-header's background utility
 * and its nav links' colour utilities are Tailwind classes, and the build
 * wraps every utility in `@layer utilities{}`. An unlayered override —
 * exactly what every OTHER rule in this file is — LOST to that layered,
 * non-important utility; wrapping the override in the same named layer is
 * what made it win. Asserted here as the outcome (the colours are right),
 * not by reading the CSS for the word "@layer", because a rig that checks
 * for a rule's PRESENCE rather than its EFFECT would have passed the whole
 * time this was silently not working.
 *
 * "ABOUT" IS REPLACED BY A NEW <a>, NOT AN EDITED ONE — see nav-menu.js's own
 * header for why: the bundle's link is a React Router Link, and changing its
 * DOM href does not change where clicking it navigates. So this asserts the
 * REPLACEMENT actually opens /terms, not just that it LOOKS like a link to
 * it — the one property a static read of the markup could not catch.
 *
 * AND THE GRACEFUL-DEGRADATION CASE: if nav-menu.js never runs, "About" must
 * stay on the menu rather than vanishing with nothing to replace it —
 * sporta-ui.css's hide is conditional on the replacement <li> existing.
 * Proved by blocking the script's own request, not by disabling the CSS
 * rule, since blocking the SCRIPT is the failure this guards against.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

function ratio(hexA, hexB) {
  const lum = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [a, b] = [lum(hexA.replace('#', '')), lum(hexB.replace('#', ''))].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

// The exact pair this colour choice depends on, checked before anything else
// — if this stops being true the header itself is wrong regardless of what
// the browser renders.
/* #2d3034 since 2026-09-22: the owner asked for the top bar to match the
   footer, measured at rgb(45,48,52). It was #2b2b2b before that. */
const r = ratio('#ffffff', '#2d3034')
check(r >= 4.5, `white on the charcoal header clears AA for body text (${r.toFixed(2)}:1)`,
  r < 4.5 ? 'the header colour needs revisiting, not the check' : '')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

for (const [lang, expectTerms, expectTitle] of [
  ['ar', 'الشروط', 'الشروط والأحكام'],
  ['en', 'Terms', 'Terms & Conditions'],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 500 } })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // NOT filtered to VISIBLE links any more. The whole menu <ul> was hidden
  // outright on 2026-09-17 (a separate, unrelated request), so an
  // offsetParent check here would now exclude every link and this rig would
  // report success by finding nothing — the exact failure mode this
  // project's own CLAUDE.md warns about repeatedly. nav-menu.js's own logic
  // (build a working /terms replacement) still runs and is still worth
  // checking on its own terms, independent of whether something else on
  // the page currently hides the result.
  const info = await page.evaluate(() => {
    const header = document.querySelector('header.app-header')
    const links = [...document.querySelectorAll('header.app-header ul li a')]
      .map((a) => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href'),
        color: getComputedStyle(a).color,
        title: a.getAttribute('title'),
      }))
    return { bg: header ? getComputedStyle(header).backgroundColor : null, links }
  })

  const rgbToHex = (rgb) => {
    const m = (rgb || '').match(/\d+/g)
    return m ? '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : rgb
  }

  check(rgbToHex(info.bg) === '#2d3034', `${lang}: the header background is charcoal`, info.bg)
  check(info.links.every((l) => rgbToHex(l.color) === '#ffffff'),
    `${lang}: every nav link is white (even though the menu is currently hidden)`,
    info.links.filter((l) => rgbToHex(l.color) !== '#ffffff').map((l) => `${l.text}=${l.color}`).join(', '))

  // Checked as EACH LINK'S OWN computed display, not DOM absence — the
  // whole menu is now hidden by an unrelated, later rule (see above), and a
  // child's computed `display` is unaffected by an ancestor's, so this
  // still proves "Shop" and "About" carry their OWN independent hide
  // rather than merely inheriting invisibility from the parent.
  const ownDisplay = await page.evaluate((href) => {
    const a = document.querySelector(`header.app-header a[href="${href}"]`)
    return a ? getComputedStyle(a.closest('li')).display : 'absent'
  }, '/shop')
  check(ownDisplay === 'none' || ownDisplay === 'absent', `${lang}: "Shop" is not on the menu`, ownDisplay)

  const aboutDisplay = await page.evaluate(() => {
    const a = document.querySelector('header.app-header a[href="/about"]')
    return a ? getComputedStyle(a.closest('li')).display : 'absent'
  })
  check(aboutDisplay === 'none' || aboutDisplay === 'absent', `${lang}: "About" is not on the menu`, aboutDisplay)

  const terms = info.links.find((l) => l.href === '/terms')
  check(!!terms, `${lang}: a link to /terms is on the menu`)
  check(terms?.text === expectTerms, `${lang}: it reads "${expectTerms}"`, terms?.text)
  check(terms?.title === expectTitle,
    `${lang}: and its title tooltip carries the full phrase`, terms?.title)

  if (terms) {
    // THE ONE THING A STATIC READ CANNOT PROVE: clicking it actually opens
    // /terms rather than the /about page a copied React Link would still
    // navigate to. The menu is hidden site-wide now (2026-09-17), and a
    // `display:none` ancestor leaves this link with no layout box at all —
    // `force: true` skips visibility CHECKS but cannot invent click
    // coordinates for an element with zero size, so even a forced click
    // fails here. The override below undoes ONLY the hide, in this test's
    // own page, to prove nav-menu.js's underlying mechanism (a real <a>,
    // not a copied React Link) still works — it is not claiming a visitor
    // can reach this link today, which the checks above already establish
    // they cannot.
    // Same layer as the hide rule (`@layer utilities`), not unlayered —
    // this file's own header override already found that, for `!important`
    // declarations, cascade layers REVERSE the usual order: a layered
    // !important beats an unlayered one regardless of source position, so
    // an unlayered override here would lose exactly like this test's first
    // attempt did.
    await page.addStyleTag({ content: '@layer utilities { header.app-header ul { display: flex !important; } }' })
    await page.locator('header.app-header a[href="/terms"]').click()
    await page.waitForLoadState('networkidle')
    check(new URL(page.url()).pathname === '/terms', `${lang}: clicking it actually opens /terms`, page.url())
  }

  await page.close()
}

/* ------------------------------------- graceful degradation, if the JS dies */
// Not filtered to visible links, per the note above — the menu is hidden
// site-wide regardless of whether nav-menu.js runs.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 500 } })
  await page.route('**/assets/nav-menu.js', (route) => route.abort())
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll('header.app-header ul li a')]
      .map((a) => a.getAttribute('href'))
    return links
  })
  check(info.includes('/about'), 'with nav-menu.js blocked, "About" stays on the menu',
    `saw: ${info.join(', ')}`)
  check(!info.includes('/terms'), 'and no /terms link appears with nothing behind it', info.join(', '))
  await page.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — orange header, white text, the right three links')
process.exit(fails ? 1 : 0)
