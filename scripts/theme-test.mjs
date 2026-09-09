/**
 * The theme editor, end to end, in a real browser.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/theme-test.mjs
 *
 * WHY BOTH DIRECTIONS. Every field defaults to '' and empty means "leave the
 * built stylesheet alone", so a shop that has never opened the editor must be
 * PIXEL-IDENTICAL to one without this feature. That is the half a test would
 * skip: it is easy to prove a saved colour arrives, and the promise that
 * matters more is that an unsaved one changes nothing.
 *
 * WHY IT READS getComputedStyle RATHER THAN THE <style> TAG. Writing the right
 * CSS text is not the claim; the claim is that the browser APPLIES it. The
 * override carries no !important on purpose, so it wins only by being last in
 * the document — and a rule that is present and losing looks exactly like a
 * rule that is present and winning if you only read the tag.
 *
 * THE TARGETS WERE MEASURED, NOT ASSUMED. The first draft of theme.js set
 * --font-display, --font-sans, --space and `.dark`. None of those exist in the
 * built CSS: fonts are hardcoded font-family declarations, spacing is
 * Tailwind's --spacing, there is no bare --radius (only -md/-lg/-xl), and dark
 * is [data-theme=dark]. This asserts against the real names so the next edit
 * cannot quietly go back to inventing them.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.SITE ?? 'http://127.0.0.1:4300'

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

/** What the BROWSER ends up with, not what the stylesheet says. */
const read = (page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  return {
    brand: cs.getPropertyValue('--brand').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    accentText: cs.getPropertyValue('--accent-text').trim(),
    spacing: cs.getPropertyValue('--spacing').trim(),
    radiusLg: cs.getPropertyValue('--radius-lg').trim(),
    bodyFont: getComputedStyle(document.body).fontFamily,
    tags: document.querySelectorAll('style[data-sporta-theme]').length,
  }
})

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

try {
  // ---- 1. no theme saved: the built values, untouched ---------------------
  clearTheme()
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const before = await read(page)
  await page.close()

  console.log('--- nothing saved')
  check(before.tags === 1, `the override stylesheet is present but empty (${before.tags} tag)`)
  check(before.brand === '#e0561c', `--brand is the built value (${before.brand})`)
  check(before.accent === '243 75% 59%', `--accent is the built value (${before.accent})`)
  check(before.spacing === '.25rem' || before.spacing === '0.25rem',
    `--spacing is the built value (${before.spacing})`)
  check(/Alexandria/.test(before.bodyFont), `body still uses Alexandria (${before.bodyFont.slice(0, 40)})`)

  // ---- 2. a theme saved: every field reaches the browser -------------------
  setTheme({
    brand: '#0a7d5a', accent: '160 84% 39%',
    accent_text_light: '160 90% 24%', accent_text_dark: '160 70% 70%',
    font_head: 'Georgia', font_body: 'Verdana',
    radius: '1rem', space: '0.375rem',
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const after = await read(page)

  console.log('\n--- a theme saved')
  check(after.brand === '#0a7d5a', `--brand is the owner's (${after.brand})`)
  check(after.accent === '160 84% 39%', `--accent is the owner's (${after.accent})`)
  /* THE MODE HAS TO BE SET BEFORE THIS IS ASKED. The first version of this
     check asserted the light value on a freshly loaded page and failed —
     because the shop DEFAULTS TO DARK (data-theme="dark", sporta_theme
     "dark"), so what it was reading was correctly the dark one. The code was
     right and the test was wrong. Both values are now checked in the mode each
     belongs to, which is the only way either assertion means anything. */
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(200)
  const light = await read(page)
  check(light.accentText === '160 90% 24%',
    `in light mode --accent-text is the LIGHT value (${light.accentText})`)
  check(after.spacing === '0.375rem', `--spacing is the owner's (${after.spacing})`)
  /* One knob, three corners, proportions kept: 1rem base -> lg is 1rem. */
  check(after.radiusLg === '1rem', `--radius-lg scaled from the one value (${after.radiusLg})`)
  check(/Verdana/.test(after.bodyFont), `body uses the owner's face (${after.bodyFont.slice(0, 40)})`)
  check(/Alexandria/.test(after.bodyFont),
    'and the built stack is still behind it, so a missing face degrades to today')

  // ---- 3. dark mode gets its OWN accent text ------------------------------
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(200)
  const dark = await read(page)
  check(dark.accentText === '160 70% 70%',
    `[data-theme=dark] gets the dark accent text, not the light one (${dark.accentText})`)
  await page.close()

  // ---- 4. and it all goes away again --------------------------------------
  clearTheme()
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const gone = await read(page)
  await page.close()

  console.log('\n--- cleared again')
  check(gone.brand === '#e0561c', `--brand is back to the built value (${gone.brand})`)
  check(/Alexandria/.test(gone.bodyFont) && !/Verdana/.test(gone.bodyFont),
    'and the built font is back — clearing is the way out of a bad edit')
} finally {
  clearTheme()
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the theme applies, and an empty one changes nothing')
process.exit(fails ? 1 : 0)
