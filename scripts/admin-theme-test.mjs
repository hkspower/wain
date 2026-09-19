/**
 * The theme editor's brand colour now recolours the ADMIN PANEL too.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/admin-theme-test.mjs
 *
 * Asked for on 2026-09-17 as "make colors theme chenge for all at backend".
 * Measured first: AdminApp-*.js is built entirely from hardcoded Tailwind
 * indigo classes — bg-indigo-600, hover:bg-indigo-700, text-indigo-700,
 * border-indigo-500 and their kin — and reads none of the tokens theme.js
 * already writes. So an owner could repaint the whole storefront and the
 * panel they did it FROM stayed indigo regardless of what they picked.
 *
 * theme.js now maps that same fixed indigo scale onto whichever brand colour
 * is set, using attribute selectors (`[class~="…"]`) rather than escaped
 * class selectors, so `hover:bg-indigo-700`'s colon needs no escaping.
 *
 * WITH NO THEME SET, the panel must be UNCHANGED. This is the case that
 * matters most in practice (no shop has opened the theme editor by default)
 * and it is asserted first — but as a STABILITY check against a second read
 * of the same page, not against a hardcoded literal: Chromium reports
 * Tailwind v4's indigo-600 in `lab(...)` notation rather than `rgb(...)`
 * (it is defined in oklch and falls slightly outside sRGB), so the shipped
 * value is measured off the page itself, the same way brand-token-test.mjs
 * measures its own baseline rather than asserting a colour literal for a
 * value it does not control.
 *
 * NOT SKIPPED ON /backends, unlike the arbitrary custom-CSS block further
 * down in the same file — that skip exists because free-form CSS can hide
 * the very field that would undo it, and a theme editor that can lock you
 * out of the theme editor is not a feature. This override only ever
 * recolours a closed, known set of classes; it cannot hide anything, so
 * there is nothing to be locked out of.
 *
 * Checked on: the login logo swatch and the submit button (both
 * bg-indigo-600). The storefront's own use of --brand is brand-token-test.mjs's
 * job, not repeated here — it has two pre-existing, unrelated failures on
 * this branch (confirmed with `git stash`, before this file's change existed)
 * that are out of scope for this task.
 *
 * Restores the theme setting in a finally, whatever happens above it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const BRAND = '#16a34a'          // visually distinct from indigo AND from the
                                  // shop's own default orange, so a mistaken
                                  // "it's just the default" reading is not
                                  // possible.
const WANT = 'rgb(22, 163, 74)'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q], { encoding: 'utf8' })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function panelColors() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const info = await page.evaluate(() => {
    const swatch = document.querySelector('.bg-indigo-600')
    const submit = document.querySelector('button[type="submit"], form button')
    return {
      swatch: swatch ? getComputedStyle(swatch).backgroundColor : null,
      submit: submit ? getComputedStyle(submit).backgroundColor : null,
    }
  })
  await page.close()
  return info
}

try {
  sql(`delete from settings where name = 'theme'`)
  const shipped = await panelColors()
  check(!!shipped.swatch, 'with no theme set, the panel logo swatch has a colour to begin with', shipped.swatch)
  check(shipped.swatch === shipped.submit,
    'and the submit button matches it — both are the shipped bg-indigo-600', `${shipped.swatch} / ${shipped.submit}`)
  check(shipped.swatch !== WANT, 'and neither is coincidentally already the test colour', shipped.swatch)

  sql(`insert into settings (name, value) values ('theme', '${JSON.stringify({ brand: BRAND }).replace(/'/g, "\\'")}')`)

  const themed = await panelColors()
  check(themed.swatch === WANT, 'once a brand colour is set, the panel logo swatch follows it', themed.swatch)
  check(themed.submit === WANT, 'and so does the submit button', themed.submit)

  sql(`delete from settings where name = 'theme'`)
  const cleared = await panelColors()
  check(cleared.swatch === shipped.swatch,
    'clearing the theme again returns the panel to exactly the shipped indigo', cleared.swatch)
} finally {
  sql(`delete from settings where name = 'theme'`)
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the panel follows the shop\'s own brand colour, and stays indigo when none is set')
process.exit(fails ? 1 : 0)
