/**
 * The main menu: orange header, white text, "Shop" gone, "About" -> Terms.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/nav-menu-test.mjs
 *
 * Asked for on 2026-09-16: an orange header with white nav text, "المتجر"
 * (Shop) removed from the menu, and "من نحن" (About) replaced with a link to
 * the Terms & Conditions page.
 *
 * THE COLOUR IS --brand-dark, NOT --brand. site-contrast.mjs found white nav
 * text on --brand at 3.81:1 across every page — under AA's 4.5:1 floor for
 * text this size. --brand-dark is 5.46:1 and is still unambiguously orange —
 * the same tone this shop already uses for the outlet category tile. That
 * measurement is re-asserted here rather than only trusted to the site-wide
 * rig, because it is the reason this colour and not the obvious one was
 * picked, and a future edit changing the header colour should have to answer
 * to this number specifically.
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
const r = ratio('#ffffff', '#b8430f')
check(r >= 4.5, `white on --brand-dark clears AA for body text (${r.toFixed(2)}:1)`,
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

  const info = await page.evaluate(() => {
    const header = document.querySelector('header.app-header')
    const links = [...document.querySelectorAll('header.app-header ul li a')]
      .filter((a) => a.closest('li').offsetParent !== null)
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

  check(rgbToHex(info.bg) === '#b8430f', `${lang}: the header background is --brand-dark`, info.bg)
  check(info.links.every((l) => rgbToHex(l.color) === '#ffffff'),
    `${lang}: every visible nav link is white`,
    info.links.filter((l) => rgbToHex(l.color) !== '#ffffff').map((l) => `${l.text}=${l.color}`).join(', '))

  check(!info.links.some((l) => l.href === '/shop'), `${lang}: "Shop" is not on the menu`)
  check(!info.links.some((l) => l.href === '/about'), `${lang}: "About" is not on the menu`)

  const terms = info.links.find((l) => l.href === '/terms')
  check(!!terms, `${lang}: a link to /terms is on the menu`)
  check(terms?.text === expectTerms, `${lang}: it reads "${expectTerms}"`, terms?.text)
  check(terms?.title === expectTitle,
    `${lang}: and its title tooltip carries the full phrase`, terms?.title)

  if (terms) {
    // THE ONE THING A STATIC READ CANNOT PROVE: clicking it actually opens
    // /terms rather than the /about page a copied React Link would still
    // navigate to.
    // Scoped to the header: the footer has always had its own "Terms" link,
    // and shortening the header's label from "Terms & Conditions" to
    // "Terms" newly collides with it by text alone — a real ambiguity a
    // page-wide getByRole would now hit, not a fixture-only concern.
    await page.locator('header.app-header')
      .getByRole('link', { name: expectTerms, exact: true }).click()
    await page.waitForLoadState('networkidle')
    check(new URL(page.url()).pathname === '/terms', `${lang}: clicking it actually opens /terms`, page.url())
  }

  await page.close()
}

/* ------------------------------------- graceful degradation, if the JS dies */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 500 } })
  await page.route('**/assets/nav-menu.js', (route) => route.abort())
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll('header.app-header ul li a')]
      .filter((a) => a.closest('li').offsetParent !== null)
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
