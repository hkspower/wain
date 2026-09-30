/**
 * assertTheme(page, wanted) — asks the LIVE PAGE what theme it settled on,
 * rather than trusting that seeding `localStorage.sporta_theme` before load
 * got a rig what it asked for.
 *
 * WHY THIS MUST NOT TRUST THE SEED. Seeding is not getting: several rigs
 * (dark-audit, glare-audit, site-contrast) write `sporta_theme` to
 * localStorage before the page loads and then measure as though that theme
 * is what rendered. As of 2026-09-20 the shop is ONE MODE, DARK ONLY, at the
 * owner's explicit request (the second time — built 2026-09-09, reversed
 * 2026-09-10, asked for again now) — index.html's boot script overwrites
 * `sporta_theme` to `'dark'` unconditionally before any module loads. A rig
 * that seeded 'light' and trusted it would print "the light theme" over
 * every line while actually measuring dark, with every number honestly
 * dark-theme and every heading a lie.
 *
 * So `THEME=light` is refused OUTRIGHT here, before a single pixel is
 * measured — there is no light theme running anywhere to check. `dark` is
 * allowed through, but still VERIFIED against the page's own
 * `documentElement.dataset.theme` rather than assumed, because a future
 * change to the boot script should make this refuse loudly rather than
 * silently agree with a seed that no longer matches reality.
 *
 * This is the same file this project built once before for the identical
 * reason, and it was not restored when the toggle briefly came back
 * (2026-09-10) and one-mode was undone — its absence broke
 * site-contrast.mjs's import outright, caught only by trying to run it.
 */
export async function assertTheme(page, wanted) {
  if (wanted === 'light') {
    throw new Error(
      'THEME=light was asked for, but this shop is one mode, dark only — ' +
      "there is no light theme running anywhere to seed or to measure. " +
      'See this file\'s own header.'
    )
  }

  const settled = await page.evaluate(() => document.documentElement.dataset.theme || null)
  if (settled !== wanted) {
    throw new Error(
      `asked for theme "${wanted}" but the live page settled on "${settled}" — ` +
      'a seed is not a measurement; something changed and this rig would otherwise ' +
      'have printed numbers under the wrong heading.'
    )
  }
}
