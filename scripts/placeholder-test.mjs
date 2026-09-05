/**
 * The Sporta mark on cards that have no photograph.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/placeholder-test.mjs
 *
 * WHAT THE RULE IS. The built storefront already draws a placeholder for a
 * product with no picture — a data: URI SVG, a two-stop dark gradient, one per
 * product. sporta-ui.css paints the shop's mark faintly over it, selected by
 * `img[src^="data:image/svg+xml"]` so it applies to exactly those cards.
 *
 * WHY BOTH DIRECTIONS ARE TESTED. Today every product is a placeholder (0 of
 * 46 have a photograph), so "the mark is on every card" would pass whether the
 * selector were precise or simply `a > img`. The check that matters is the
 * NEGATIVE one: a card with a real photograph must NOT be marked, or the first
 * garment the owner photographs gets a logo stamped across it. That case
 * cannot occur naturally in this database, so the test seeds it.
 *
 * It runs in both colour schemes because the claim "the placeholder is dark in
 * both themes, so a white mark reads" was an assumption until it was measured.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.SITE ?? 'http://127.0.0.1:4300'
/* A 1x1 PNG. Only its EXISTENCE matters — it makes one product stop being a
   placeholder, which is the whole point of the negative case. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const MARKER = 'f'.repeat(64)   // the image_hash this test's row is found by

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

const count = (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll('a[href*="/product/"]')]
    .filter((a) => a.querySelector(':scope > img'))
  let phMarked = 0, phTotal = 0, photoMarked = 0, photoTotal = 0
  for (const a of cards) {
    const img = a.querySelector(':scope > img')
    const isPlaceholder = (img.getAttribute('src') || '').startsWith('data:image/svg+xml')
    const after = getComputedStyle(a, '::after')
    const painted = after.content === '""' && after.backgroundImage.includes('logo-white')
    if (isPlaceholder) { phTotal++; if (painted) phMarked++ }
    else { photoTotal++; if (painted) photoMarked++ }
  }
  return { phMarked, phTotal, photoMarked, photoTotal }
})

const slug = sql("select slug from products where active = 1 order by name_en limit 1")
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

try {
  sql(`insert into product_images (slug, sort, image, image_hash)
       values ('${slug}', 0, '${PNG}', '${MARKER}')`)
  console.log(`--- one product photographed (${slug}), the rest placeholders\n`)

  for (const scheme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: scheme })
    await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    const r = await count(page)
    await page.close()

    check(r.phTotal > 0, `${scheme}: the grid has placeholder cards to mark (${r.phTotal})`)
    check(r.phMarked === r.phTotal,
      `${scheme}: every placeholder carries the mark (${r.phMarked}/${r.phTotal})`)
    /* THE ONE THAT MATTERS. */
    check(r.photoTotal > 0, `${scheme}: and one card has a real photograph (${r.photoTotal})`)
    check(r.photoMarked === 0,
      `${scheme}: which is NOT marked (${r.photoMarked}) — the mark removes itself when a photo arrives`)
  }
} finally {
  sql(`delete from product_images where image_hash = '${MARKER}'`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — marked where there is no photograph, and only there')
process.exit(fails ? 1 : 0)
