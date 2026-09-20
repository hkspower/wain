/**
 * The home page's brand-logo strip is REMOVED.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/brand-strip-test.mjs
 *
 * Built on 2026-09-16 as "under heros make brands logos with images", and
 * removed at the owner's request on 2026-09-20 as "remove brands slide".
 * assets/brand-strip.js itself is left in the repository, undeployed — only
 * its <script> tag in index.html was taken out, which is the whole revert if
 * it is ever wanted back.
 *
 * A REMOVAL NEEDS ITS OWN TEST, not just deleting the old one: a script that
 * once asserted the strip APPEARS would have to be deleted anyway, and
 * deleting the coverage is how a re-added `<script>` tag — a merge, a copy-
 * paste from an old branch — would go unnoticed forever. This mutation-tests
 * the removal itself: seed a brand with a logo (the condition that used to
 * make the strip appear) and require that NOTHING renders regardless.
 *
 * SEEDING A LOGO IS THE POINT, not a leftover from the old rig. Without it,
 * "no strip" is trivially true of the live shop's actual 0-of-8-logos state
 * and proves nothing about the removal — the strip was already invisible for
 * an unrelated reason. This is the same distinction the old rig itself drew
 * between "the zero-logo case" and "the strip appears once a brand has a
 * logo"; this file keeps only the seeding half and inverts the assertion.
 *
 * Restores the brands table in a finally, whatever happens above it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q], { encoding: 'utf8' })

// A named brand, not the first one that sorts — a fixture chosen by position
// is a fixture chosen at random, per this repository's own standing rule.
const WITH_LOGO = 'gymshark'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function readHome(lang) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => {
    const main = document.querySelector('main')
    const hero = main ? main.querySelector('section[aria-roledescription]') : null
    return {
      heroRoledesc: hero ? hero.getAttribute('aria-roledescription') : null,
      hasStrip: !!document.querySelector('[data-sporta-brand-strip]'),
      nextTag: hero?.nextElementSibling?.tagName ?? null,
    }
  })
  await page.close()
  return info
}

try {
  // A brand WITH a logo — the exact condition that used to make the strip
  // appear — so this proves the removal rather than the old zero-logo state.
  sql(`update brands set logo = '${PNG}' where slug = '${WITH_LOGO}'`)

  for (const lang of ['en', 'ar']) {
    const info = await readHome(lang)
    check(info.heroRoledesc === 'carousel', `${lang}: the hero is still found by its stable selector`, String(info.heroRoledesc))
    check(!info.hasStrip, `${lang}: no strip appears even with a logo seeded`)
    check(info.nextTag !== null, `${lang}: the hero keeps whatever the bundle put after it`, String(info.nextTag))
  }

  // The script itself is not even requested — the tag is gone from
  // index.html, not merely made to fail silently.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    let requested = false
    page.on('request', (r) => { if (r.url().includes('/assets/brand-strip.js')) requested = true })
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    check(!requested, 'brand-strip.js is not even requested — the <script> tag is gone, not just broken')
    await page.close()
  }
} finally {
  sql(`update brands set logo = null where slug = '${WITH_LOGO}'`)
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the brand strip stays gone, even with a logo that used to trigger it')
process.exit(fails ? 1 : 0)
