/**
 * The category tiles are composed for the language on screen.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/tile-rtl-test.mjs
 *
 * WHAT WENT WRONG. The tiles bake their copy into the artwork, on the reading
 * side, so an Arabic frame needs the figure on the left. Measured 2026-09-10 at
 * 1440x900 and 390x844 with ?lang=ar:
 *
 *     desktop ar   art-men-rtl.webp   art-women.webp    <- the English frame
 *     phone ar     art-men-rtl.webp   art-women.webp    <- the English frame
 *
 * Two separate causes, and fixing either alone changes nothing:
 *
 *   1. The FILES. cats/desktop/art-women-rtl.* did not exist, and
 *      cats/mobile/art-women-rtl had a hand-copied jpg with no webp beside it —
 *      and the <picture> asks for webp first, so the jpg was never reached.
 *   2. The BUNDLE names exactly one tile as having an Arabic frame
 *      (`{id:'men', …, rtlArt:!0}`), so with every file in place the page still
 *      asked for art-women.webp. assets/tile-art.js is the overlay that points
 *      it at the art.
 *
 * WHY THE ENGLISH HALF IS ASSERTED TOO. An overlay that swapped unconditionally
 * would give every English shopper the Arabic composition and would pass any
 * check that only looked at Arabic. The failure is symmetrical and so is this.
 *
 * WHY THE 404 COUNT IS HERE. The tile component renders TWO <picture> blocks
 * and the first deliberately asks for a name that does not exist, so exactly
 * four plain-name 404s per page are CORRECT and this repository has three other
 * rigs that say so. Asserting the number rather than "nothing 404s" is what
 * stops a future bridge file being read as an improvement — and it is how a
 * broken -rtl URL would show up here, as a FIFTH.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

/** The tile artwork a page actually painted, plus every request that was not a
 *  200, so a swap onto a missing file cannot read as a success. */
async function tiles({ w, h, dpr, lang }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })
  const bad = []
  page.on('response', (r) => {
    if (/\/cats\//.test(r.url()) && r.status() !== 200) bad.push(`${r.status()} ${new URL(r.url()).pathname}`)
  })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const art = await page.evaluate(() => {
    const out = {}
    for (const i of document.images) {
      const m = /\/cats\/[^/]+\/(art-[a-z-]+)\.(webp|jpg)/.exec(i.currentSrc || '')
      if (!m) continue
      const id = m[1].replace(/^art-/, '').replace(/-rtl$/, '')
      out[id] = m[1]
      // A painted-but-broken image is the failure this whole fix could cause.
      if (!i.complete || i.naturalWidth === 0) out[id] += '(BROKEN)'
    }
    return out
  })
  await page.close()
  return { art, bad }
}

/* ------------------------------------------------------------ Arabic ------ */

console.log('--- Arabic gets the Arabic composition')
for (const v of [{ w: 1440, h: 900, dpr: 2, lang: 'ar', label: 'desktop' },
                 { w: 390, h: 844, dpr: 3, lang: 'ar', label: 'phone' }]) {
  const { art, bad } = await tiles(v)
  // Found something before concluding anything: an empty page passes every
  // membership test under it.
  check(Object.keys(art).length >= 2, `${v.label}: found the tiles`, Object.keys(art).join(','))
  check(art.men === 'art-men-rtl', `${v.label}: the men's tile is the Arabic frame`, art.men)
  check(art.women === 'art-women-rtl', `${v.label}: the women's tile is the Arabic frame`, art.women)
  check(bad.length === 4, `${v.label}: exactly the four known plain-name 404s`, `${bad.length}: ${bad.join(' | ')}`)
}

/* ----------------------------------------------------------- English ------ */

console.log('\n--- and English is left alone')
for (const v of [{ w: 1440, h: 900, dpr: 2, lang: 'en', label: 'desktop' },
                 { w: 390, h: 844, dpr: 3, lang: 'en', label: 'phone' }]) {
  const { art, bad } = await tiles(v)
  check(art.men === 'art-men', `${v.label}: the men's tile is the English frame`, art.men)
  check(art.women === 'art-women', `${v.label}: the women's tile is the English frame`, art.women)
  check(bad.length === 4, `${v.label}: exactly the four known plain-name 404s`, `${bad.length}`)
}

/* --------------------------------------------- and it survives a re-render */

console.log('\n--- and it survives the language being switched on the page')
{
  // THE OBSERVER'S WHOLE REASON FOR EXISTING. A one-shot swap at load is undone
  // the moment the bundle re-renders the tile, and nothing would report it —
  // the page simply goes back to the English frame under an Arabic shopper.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const before = await page.evaluate(() =>
    (/art-women(-rtl)?/.exec([...document.images].map((i) => i.currentSrc).join(' ')) || [''])[0])

  await page.evaluate(() => {
    document.documentElement.setAttribute('lang', 'ar')
    document.documentElement.setAttribute('dir', 'rtl')
  })
  await page.waitForTimeout(900)
  const after = await page.evaluate(() =>
    (/art-women(-rtl)?/.exec([...document.images].map((i) => i.currentSrc).join(' ')) || [''])[0])

  check(before === 'art-women', 'it starts on the English frame', before)
  check(after === 'art-women-rtl', 'and follows the document into Arabic', after)
  await page.close()
}

/* ------------------------------------ and it never leaves a tile with no art */

console.log('\n--- and if the Arabic artwork is unavailable, today\'s picture stays')
{
  // THE FAILURE THIS COST ONE WRONG FIX TO FIND. The first version relied on
  // the image's own `error` handler to revert the swap; moving the file aside
  // showed the tile painting NOTHING, because `.tile-women` held no <img> to
  // fire an error on — the bundle's own fallback had already taken the layer
  // away. A blank tile on the shop's main navigation, produced by the guard
  // written to prevent it. The swap is preflighted now, and this is that
  // guarantee as a check rather than as a sentence.
  //
  // The file is not moved on disk: a rig that renames repository artwork can
  // lose it if it dies between the two renames, and the browser cannot tell a
  // 404 from a route that was refused.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.route('**/cats/**/art-women-rtl.*', (r) => r.abort())
  await page.goto(`${BASE}/?lang=ar`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const r = await page.evaluate(() => {
    const t = document.querySelector('.tile-women')
    const imgs = [...(t?.querySelectorAll('img') ?? [])]
      .map((i) => ({ file: (i.currentSrc || '').split('/').pop(), painted: i.complete && i.naturalWidth > 0 }))
    return { state: t && t.getAttribute('data-rtl-art'), imgs, found: !!t }
  })
  check(r.found, 'the women\'s tile is on the page at all')
  check(r.state === 'unavailable', 'the overlay marks the artwork unavailable rather than swapping', String(r.state))
  const painted = r.imgs.filter((i) => i.painted)
  check(painted.length > 0, 'and the tile still paints a picture', JSON.stringify(r.imgs))
  check(painted.every((i) => !/-rtl/.test(i.file)), 'which is the English frame, not a broken one',
    painted.map((i) => i.file).join(','))
  await page.close()
}

await browser.close()

console.log(fails ? `\n${fails} failed` : '\nall ok — both tiles follow the language, in both directions')
process.exit(fails ? 1 : 0)
