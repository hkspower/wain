/**
 * The home page's brand-logo strip, right under the hero carousel.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/brand-strip-test.mjs
 *
 * Asked for on 2026-09-16 as "under heros make brands logos with images".
 * The strip reads ?r=brands (has_logo, logo_v) — the same fields
 * brand-badge.js already reads off ?r=products — so nothing new is asked of
 * the server.
 *
 * THE ZERO-LOGO CASE IS THE ONE THAT MATTERS MOST, because it is the live
 * shop's actual state: 0 of 8 brands have a logo today. A heading over an
 * empty row would be worse than no section, so the rig asserts that case
 * FIRST, against the sandbox exactly as seeded — no section, no heading, no
 * empty <img>.
 *
 * THEN it seeds ONE brand with a logo (a 1x1 PNG, restored in a finally) and
 * requires the section to appear, directly after the hero — the hero is
 * matched by `section[aria-roledescription]`, checked in BOTH languages
 * because that attribute's value is measured to stay "carousel" even when
 * the page is Arabic (aria-LABEL is what translates).
 *
 * A brand with no logo must be ABSENT from the row, not merely unlabelled —
 * the rig seeds two brands, one with a logo and one without, and asserts the
 * row's length rather than trusting that the visible ones are the right
 * ones.
 *
 * GRACEFUL DEGRADATION: blocking brand-strip.js's own request must leave the
 * hero with no new sibling at all, same shape as nav-menu.js's own guard.
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

// Named brands, not the first two that sort — a fixture chosen by position
// is a fixture chosen at random, per this repository's own standing rule.
const WITH_LOGO = 'gymshark'
const NO_LOGO = 'nba'

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
    const strip = document.querySelector('[data-sporta-brand-strip]')
    return {
      heroRoledesc: hero ? hero.getAttribute('aria-roledescription') : null,
      hasStrip: !!strip,
      isHeroNextSibling: !!(hero && strip && hero.nextElementSibling === strip),
      heading: strip ? strip.querySelector('h2')?.textContent : null,
      logos: strip
        ? [...strip.querySelectorAll('img')].map((i) => ({ alt: i.getAttribute('alt'), src: i.getAttribute('src') }))
        : [],
    }
  })
  await page.close()
  return info
}

try {
  // Make sure neither fixture brand starts with a logo, whatever a previous
  // run left behind.
  sql(`update brands set logo = null where slug in ('${WITH_LOGO}', '${NO_LOGO}')`)

  /* ------------------------------------------------- the live shop's state */
  for (const lang of ['en', 'ar']) {
    const info = await readHome(lang)
    check(info.heroRoledesc === 'carousel', `${lang}: the hero is found by its stable selector`, String(info.heroRoledesc))
    check(!info.hasStrip, `${lang}: with no brand logos, nothing is inserted (matches the live shop today)`)
  }

  /* ------------------------------------------------------------- one logo */
  sql(`update brands set logo = '${PNG}' where slug = '${WITH_LOGO}'`)

  for (const [lang, label] of [['en', 'Shop by brand'], ['ar', 'تسوق حسب الماركة']]) {
    const info = await readHome(lang)
    check(info.hasStrip, `${lang}: the strip appears once a brand has a logo`)
    check(info.isHeroNextSibling, `${lang}: it sits directly after the hero, not somewhere else`)
    check(info.heading === label, `${lang}: the heading reads "${label}"`, info.heading)
    check(info.logos.length === 1, `${lang}: exactly one logo (the brand with none is not shown)`, String(info.logos.length))
    check(!!info.logos[0] && info.logos[0].src.includes('r=brand_logo') && info.logos[0].src.includes(WITH_LOGO),
      `${lang}: the logo's own src asks for that brand's bytes`, info.logos[0]?.src)
  }

  /* --------------------------------------------- graceful degradation, if
     the script never runs */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.route('**/assets/brand-strip.js', (route) => route.abort())
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const hero = document.querySelector('main section[aria-roledescription]')
      return { nextTag: hero?.nextElementSibling?.tagName ?? null, hasStrip: !!document.querySelector('[data-sporta-brand-strip]') }
    })
    check(!info.hasStrip, 'with brand-strip.js blocked, no strip appears')
    check(info.nextTag !== null, 'and the hero keeps whatever the bundle put after it', String(info.nextTag))
    await page.close()
  }
} finally {
  sql(`update brands set logo = null where slug in ('${WITH_LOGO}', '${NO_LOGO}')`)
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the brand strip shows only what has a logo, right under the hero')
process.exit(fails ? 1 : 0)
