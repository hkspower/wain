/**
 * The picture layers: loaded, missing, and the copy that sits on top of both.
 *
 *   # with images present
 *   EXPO_PUBLIC_ASSET_BASE=http://127.0.0.1:8877 npx expo export --platform web --clear
 *   node scripts/art-test.mjs served
 *
 * `--clear` is not optional when changing an EXPO_PUBLIC_* value. Metro caches
 * the transformed module, and an EXPO_PUBLIC_ variable is inlined AT TRANSFORM
 * TIME — so a rebuild with a new value silently reuses the old one. It cost an
 * hour here: the test reported zero pictures loaded and the code was fine.
 *
 *   # with none (the normal state of a fresh shop)
 *   npx expo export --platform web
 *   node scripts/art-test.mjs missing
 *
 * Both matter. A tile that only works when the photograph exists is a tile that
 * breaks the day someone renames a file on the server, and this app is built to
 * work with no signal at all.
 */
import { chromium } from 'playwright'

const MODE = process.argv[2] === 'served' ? 'served' : 'missing'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const seen = (l) => l.filter({ visible: true })

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${MODE}] ${what}`)
}

await p.goto(BASE + '/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

// Height is measured BEFORE and AFTER the images settle. The whole point of
// positioning the picture absolutely inside a tile of its own height is that a
// slow, late or missing image cannot move the page; nothing else in this file
// would notice if that stopped being true.
const tileBox = async () =>
  p.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (d) => d.children.length === 0 && d.textContent?.trim() === 'معدات الأداء',
    )
    const r = el?.closest('[role="button"]')?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
  })

const before = await tileBox()
await p.waitForTimeout(1500)
const after = await tileBox()
check(!!before && !!after, 'the men tile is on the page')
check(before && after && before.h === after.h,
  `the tile does not resize as images settle (${before?.h} → ${after?.h})`)
check(!!after && after.h >= 120, `the tile keeps its height (${after?.h}px)`)

// What actually rendered inside it.
const imgs = await p.evaluate(() =>
  [...document.querySelectorAll('img')]
    .map((i) => ({
      src: i.currentSrc || i.src,
      w: i.naturalWidth,
      shown: !!(i.offsetWidth || i.offsetHeight),
    }))
    .filter((i) => i.src.includes('/cats/') || i.src.includes('/products/')),
)
const loaded = imgs.filter((i) => i.w > 0)

if (MODE === 'served') {
  check(loaded.length >= 4, `the artwork loads (${loaded.length} pictures decoded)`)
  check(imgs.every((i) => i.shown), 'every requested picture is actually laid out')
} else {
  check(loaded.length === 0, 'nothing is decoded when the server has no pictures')
  // The emoji is the honest offline state — the tile must not go blank.
  check((await seen(p.getByText('🏋️')).count()) > 0, 'the tile falls back to its emoji')
}

// THE COPY SITS STRAIGHT ON THE ARTWORK — no plate. That is the design the
// owner sent, and it puts the burden on two other things instead, both checked
// here: the title must be white, and the ground under the picture must be dark
// enough to carry white on its own for the state where no photograph loads.
const copy = await p.evaluate(() => {
  const leaf = [...document.querySelectorAll('*')].find(
    (d) => d.children.length === 0 && d.textContent?.trim() === 'رجالي',
  )
  if (!leaf) return null
  const colour = getComputedStyle(leaf).color
  let el = leaf
  let ground = null
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)
    if (m && (m[3] === undefined || +m[3] > 0)) {
      ground = { r: +m[0], g: +m[1], b: +m[2] }
      break
    }
  }
  return { colour, ground }
})
const lum = (c) => {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
check(copy?.colour === 'rgb(255, 255, 255)', `the title is white (${copy?.colour})`)
const contrast = copy?.ground ? 1.05 / (lum(copy.ground) + 0.05) : 0
check(contrast >= 4.5,
  `white on the tile ground clears AA for the no-photograph case (${contrast.toFixed(2)}:1)`)

// The arrow chip, in the corner away from the copy.
const arrow = await p.evaluate(() => {
  const leaf = [...document.querySelectorAll('*')].find(
    (d) => d.children.length === 0 && ['↖', '↗'].includes(d.textContent?.trim() ?? ''),
  )
  if (!leaf) return null
  const r = leaf.getBoundingClientRect()
  return { glyph: leaf.textContent.trim(), x: Math.round(r.x), rtl: document.dir === 'rtl' }
})
check(!!arrow, 'the tile has its arrow chip')
check(arrow?.glyph === '↖', `the arrow points the way Arabic reads (${arrow?.glyph})`)
check((arrow?.x ?? 999) < 195, `the chip sits away from the copy (x=${arrow?.x})`)

await p.screenshot({ path: `/tmp/art-${MODE}.png` })
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
