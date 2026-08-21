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

// The copy has to survive whatever is behind it, in BOTH modes.
// Climbing from the kicker rather than guessing which div carries the plate:
// React Native Web renders a stack of wrappers and the painted one is not the
// one holding the text.
const plate = await p.evaluate(() => {
  // From the LEAF that holds the kicker. Searching for a div whose text merely
  // starts with it matches an outer wrapper, and climbing from there walks
  // straight past the plate to the tile's own ground — which is how this check
  // first reported a missing plate that was there all along.
  let el = [...document.querySelectorAll('*')].find(
    (d) => d.children.length === 0 && d.textContent?.trim() === 'معدات الأداء',
  )
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)
    if (!m) continue
    const a = m[3] === undefined ? 1 : +m[3]
    if (a > 0) return { r: +m[0], g: +m[1], b: +m[2], a }
  }
  return null
})
check(!!plate && plate.a > 0.3 && plate.r < 90 && plate.g < 90 && plate.b < 90,
  `the copy sits on a dark plate, not bare on the picture (${JSON.stringify(plate)})`)

await p.screenshot({ path: `/tmp/art-${MODE}.png` })
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
