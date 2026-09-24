/**
 * The four surfaces the brand does not reach, end to end, in a real browser.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/surface-colours-test.mjs
 *
 * WHAT IT IS FOR. theme-test.mjs already proves the BRAND reaches the shop.
 * These four do not follow the brand and never have:
 *
 *   header.app-header          an !important declaration inside
 *                              `@layer utilities` — and for important
 *                              declarations the cascade REVERSES layer order,
 *                              so a layered important beats an unlayered one.
 *                              Nothing assets/theme.js could emit would ever
 *                              have won it.
 *   .m-tabbar                  the website PANEL's mobile tab bar — the
 *   .m-tabbar__item[current]   bundle's own replacement for the desktop
 *                              sidebar under 768px. Its current item is
 *                              #4f46e5, Tailwind's stock indigo, hard-coded in
 *                              the bundle's CSS. theme.js already remaps the
 *                              panel's indigo, but only where it is a utility
 *                              CLASS — this one is a literal hex in a rule, so
 *                              the remap has always missed it.
 *   .skip-link / .bg-brand     the dark theme's secondary fill, which used
 *                              --sp-silver — also the prose colour in four
 *                              other rules, so it could not simply be
 *                              repointed.
 *
 * IT READS THE PAINTED COLOUR, NEVER THE VARIABLE. This repository's most
 * expensive theming lesson is that `--brand` existed on :root, was read by one
 * rule in the whole stylesheet, and an editor writing it moved the skip link
 * and nothing else — while every check that asked whether the token was SET
 * passed. `--accent` was worse: declared, read nowhere, a control that did
 * nothing at all. So every assertion here is getComputedStyle on a real
 * element, and a variable being present proves nothing to it.
 *
 * IT ASSERTS IT FOUND THE ELEMENTS FIRST, and stops if it did not. A rig that
 * queries four selectors and compares four nulls passes every comparison under
 * it and reports success — the shape CLAUDE.md records as this project's
 * favourite way to be lied to, from the suite that found 0 controls to the
 * watcher that observed nothing. The first version of THIS file hit it: the
 * tab bar is panel chrome and is not on the storefront at all, and the guard
 * is what said so rather than four green lines about nulls.
 *
 * TWO PAGES, because the surfaces live in two places: the header and the
 * secondary fill are the shop's, the tab bar is the panel's and needs a
 * session. One browser context holds the cookie across all three phases.
 *
 * BOTH DIRECTIONS, because the promise that matters most is the boring one: a
 * shop that has never opened the picker must be pixel-identical to one without
 * the feature. Proving a saved colour arrives is the easy half.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

const setTheme = (obj) =>
  sql(`insert into settings (name, value) values ('theme', '${JSON.stringify(obj)}')
       on duplicate key update value = values(value)`)
const clearTheme = () => sql(`delete from settings where name = 'theme'`)

/** '#2b2b2b' -> 'rgb(43, 43, 43)', which is what getComputedStyle returns. */
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/** Relative luminance of an 'rgb(r, g, b)' string, for the derivation check. */
const lum = (s) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '')
  if (!m) return null
  const ch = [+m[1], +m[2], +m[3]].map((v) => {
    const u = v / 255
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

const readShop = (page) => page.evaluate(() => {
  const at = (sel, prop) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).getPropertyValue(prop).trim() : null
  }
  return {
    foundHeader: !!document.querySelector('header.app-header'),
    foundSecondary: !!document.querySelector('.skip-link'),
    header: at('header.app-header', 'background-color'),
    secondary: at('.skip-link', 'background-color'),
    theme: document.documentElement.getAttribute('data-theme'),
  }
})

const readPanel = (page) => page.evaluate(() => {
  const bar = document.querySelector('.m-tabbar')
  const current = document.querySelector('.m-tabbar__item[aria-current="true"]')
  const items = Array.from(document.querySelectorAll('.m-tabbar__item'))
  const other = items.find((i) => i !== current) ?? null
  return {
    foundBar: !!bar,
    foundCurrent: !!current,
    display: bar ? getComputedStyle(bar).display : null,
    tabbar: bar ? getComputedStyle(bar).backgroundColor : null,
    tabCurrent: current ? getComputedStyle(current).color : null,
    tabInactive: other ? getComputedStyle(other).color : null,
  }
})

// A phone, because `.m-tabbar` only exists under 768px — the bundle replaces
// it with a sidebar above that, so measuring at 1280 would read a bar that is
// not on the page.
const PHONE = { width: 390, height: 844 }

/* #2d3034 since 2026-09-22: the owner asked for the top bar to match the
   footer, measured at rgb(45,48,52). It was #2b2b2b before that. */
const SHIPPED = { header: '#2d3034', tabbar: '#ffffff', tabCurrent: '#4f46e5', secondary: '#a6acb2' }
const CHOSEN = {
  header_bg: '#123456',
  tabbar_bg: '#0a0b0d',
  tabbar_active: '#00ff88',
  secondary_bg: '#ff00aa',
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true })

/** theme.js fetches before it can write anything; without the wait the read
 *  races the override and reports the built values whatever was saved. */
const settle = (p) => p.waitForTimeout(1300)

try {
  clearTheme()

  const shop = await ctx.newPage()
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await settle(shop)

  const panel = await ctx.newPage()
  await panel.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await panel.waitForTimeout(1200)
  await panel.locator('input').nth(0).fill(EMAIL)
  await panel.locator('input').nth(1).fill(PASSWORD)
  await panel.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await panel.waitForTimeout(3000)

  // ---- 0. the rig can see what it is about to judge -------------------------
  console.log('--- the elements exist')
  let s = await readShop(shop)
  let p = await readPanel(panel)

  check(s.foundHeader, 'header.app-header is on the shop')
  check(s.foundSecondary, '.skip-link is on the shop (the secondary fill)')
  check(s.theme === 'dark', `the shop is on the dark theme (${s.theme})`)
  check(p.foundBar, 'the panel has a mobile tab bar at 390px')
  check(p.foundCurrent, 'the tab bar has a current item')
  check(p.display != null && p.display !== 'none', `the tab bar is displayed (${p.display})`)

  // Everything below compares colours. If the finds above failed, those
  // comparisons are between nulls and would pass — so stop rather than print a
  // page of green about elements that are not there.
  if (fails > 0) {
    console.log('\nthe rig could not find what it measures — every result below would be meaningless')
    process.exit(1)
  }

  // ---- 1. nothing saved: the shipped literals, untouched --------------------
  console.log('\n--- nothing saved')
  check(s.header === rgb(SHIPPED.header), `the header is the built charcoal (${s.header})`)
  check(s.secondary === rgb(SHIPPED.secondary), `the secondary fill is the built silver (${s.secondary})`)
  check(p.tabbar === rgb(SHIPPED.tabbar), `the tab bar is the built white (${p.tabbar})`)
  check(p.tabCurrent === rgb(SHIPPED.tabCurrent), `the current tab is the built indigo (${p.tabCurrent})`)

  // ---- 2. a theme saved: every surface actually moves -----------------------
  setTheme(CHOSEN)
  await shop.reload({ waitUntil: 'networkidle' }); await settle(shop)
  await panel.reload({ waitUntil: 'networkidle' }); await panel.waitForTimeout(2500)
  s = await readShop(shop)
  p = await readPanel(panel)

  console.log('\n--- the owner picked four colours')
  check(s.header === rgb(CHOSEN.header_bg), `the header followed (${s.header})`)
  check(s.secondary === rgb(CHOSEN.secondary_bg), `the secondary fill followed (${s.secondary})`)
  check(p.tabbar === rgb(CHOSEN.tabbar_bg), `the tab bar followed (${p.tabbar})`)
  check(p.tabCurrent === rgb(CHOSEN.tabbar_active), `the current tab followed (${p.tabCurrent})`)

  // THE DERIVED HALF. The owner sets one tab-bar colour; the hairline and the
  // inactive labels are worked out from it in theme.js.
  //
  // THE FIRST VERSION OF THIS CHECK WAS "the label is lighter than the bar",
  // AND IT PASSED THE MUTATION. Deleting the derivation leaves the CSS falling
  // back to the shipped slate #64748b — which IS lighter than a near-black bar,
  // so the assertion was satisfied by precisely the failure it existed to
  // catch. It was measuring a property the bug happens to have.
  //
  // So it names the thing instead: if the label is still the shipped literal,
  // the derivation did not run, whatever its luminance. Then, separately, that
  // the result is actually readable — because a derivation that runs and
  // produces something unreadable is a different bug, and one check cannot
  // fail for two reasons and still say which.
  check(
    p.tabInactive !== null && p.tabInactive !== rgb('#64748b'),
    `the inactive labels were derived, not left at the shipped slate (${p.tabInactive})`,
    'theme.js emitted no --sp-tabbar-text, so the CSS fell back',
  )
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b)
    if (la === null || lb === null) return null
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const r = ratio(p.tabInactive, p.tabbar)
  check(
    r !== null && r >= 4.5,
    `and they are readable on it (${r === null ? 'unmeasurable' : r.toFixed(1) + ':1'})`,
    'the derived label does not meet AA against the bar the owner chose',
  )

  // ---- 3. cleared again: the way back ---------------------------------------
  clearTheme()
  await shop.reload({ waitUntil: 'networkidle' }); await settle(shop)
  await panel.reload({ waitUntil: 'networkidle' }); await panel.waitForTimeout(2500)
  s = await readShop(shop)
  p = await readPanel(panel)

  console.log('\n--- cleared again')
  check(s.header === rgb(SHIPPED.header), `the header is back (${s.header})`)
  check(s.secondary === rgb(SHIPPED.secondary), `the secondary fill is back (${s.secondary})`)
  check(p.tabbar === rgb(SHIPPED.tabbar), `the tab bar is back (${p.tabbar})`)
  check(p.tabCurrent === rgb(SHIPPED.tabCurrent), `the current tab is back (${p.tabCurrent})`)

  console.log(
    fails === 0
      ? '\nall ok — four surfaces the brand cannot reach, each one the owner’s and each one reversible'
      : `\n${fails} failed`,
  )
} finally {
  clearTheme()
  await browser.close()
}

process.exit(fails === 0 ? 0 : 1)
