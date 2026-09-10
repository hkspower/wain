/**
 * The category tiles: the right format, and the right composition.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/tile-art-test.mjs
 *
 * WHAT WENT WRONG, and it took a census of every image request to see it. The
 * tile component renders TWO <picture> blocks. The first asks for the plain
 * name `/cats/<crop>/<id>.jpg` and carries one jpeg. Only when that ERRORS does
 * it fall to the second — and the second is the good one: webp sources, and the
 * `-rtl` suffix that selects the Arabic composition.
 *
 * A rewrite in .htaccess used to bridge the plain name onto `art-<id>.jpg`. It
 * was added to remove four 404s, and it did. It also meant the second block
 * never rendered, so for as long as it existed:
 *
 *   every tile was JPEG          285 kB against 203 kB of webp, desktop
 *                                212 kB against 145 kB, phone crop
 *   Arabic got the ENGLISH frame the whole Arabic composition exists to avoid
 *
 * Neither symptom is visible from the server, and neither rig looked: one
 * asserted the plain name was 200 (the bridge made it so) and the other
 * asserted nothing 404s (the bridge made that so too). A workaround can be
 * correct and its side effects still unmeasured.
 *
 * SO THIS TESTS THE THING THAT MATTERS — what the browser actually fetched:
 *
 *   1. Every tile picture that loads is WEBP, not JPEG.
 *   2. In Arabic the men tile fetches the -rtl frame; in English it does not.
 *   3. The four plain-name 404s are present and are exactly four — they are how
 *      the component finds its better path, and if they ever stop happening the
 *      bridge is back and the two symptoms above are back with it.
 *   4. Nothing is left broken on the page: no <img> with naturalWidth 0.
 *
 * It writes nothing.
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

/** Every /cats/ request a home-page load makes, with its status. */
async function census(url, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const hits = []
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname
    if (path.startsWith('/cats/')) hits.push({ path, status: r.status() })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const broken = await page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src)
  )
  await ctx.close()
  return { hits, broken }
}

console.log(`--- the category tiles, at ${BASE}\n`)

for (const [label, url, width] of [
  ['Arabic, desktop', `${BASE}/`, 1280],
  ['English, desktop', `${BASE}/?lang=en`, 1280],
  ['Arabic, phone', `${BASE}/`, 390],
]) {
  const { hits, broken } = await census(url, width)
  const loaded = hits.filter((h) => h.status === 200 && /art-/.test(h.path))
  const dead = hits.filter((h) => h.status === 404)
  const arabic = label.startsWith('Arabic')

  // 1. webp, not jpeg. infobar is excluded: it is asked for by its real name
  // and was never part of this and must stay untouched.
  const tiles = loaded.filter((h) => !/infobar/.test(h.path))
  const jpegs = tiles.filter((h) => /\.jpe?g$/.test(h.path))
  check(tiles.length >= 4, `${label}: four tiles load`, `${tiles.length} pictures`)
  check(jpegs.length === 0, `${label}: every tile is webp`,
    jpegs.length ? jpegs.map((j) => j.path.split('/').pop()).join(', ') : '')

  // 2. the composition
  const rtl = tiles.some((h) => /art-men-rtl\./.test(h.path))
  check(arabic ? rtl : !rtl,
    arabic
      ? `${label}: the men tile is the Arabic composition`
      : `${label}: the men tile is the English composition`,
    tiles.filter((h) => /men/.test(h.path)).map((h) => h.path.split('/').pop()).join(', '))

  // 3. the deliberate 404s
  const plain = dead.filter((h) => /\/(men|women|accessories|outlet)\.(jpe?g|webp)$/.test(h.path))
  check(plain.length === 4,
    `${label}: the four plain-name probes 404, as they must`,
    `${plain.length} of them` + (plain.length !== 4 ? ' — the name bridge is back' : ''))
  check(dead.length === plain.length,
    `${label}: and nothing else under /cats/ 404s`,
    dead.filter((h) => !plain.includes(h)).map((h) => h.path).join(', '))

  // 4. nothing visibly broken
  check(broken.length === 0, `${label}: every image on the page rendered`,
    broken.slice(0, 2).join(', '))
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — webp everywhere, and Arabic gets its own frame')
process.exit(fails ? 1 : 0)
