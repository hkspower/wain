/**
 * The website's stylesheets: what is dead, and what never matched.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/css-audit.mjs
 *
 * Two questions a stylesheet cannot answer about itself.
 *
 * 1. IS THE FILE REACHED AT ALL. index.html names its stylesheets; anything
 *    in assets/ that nothing names is dead weight that still gets zipped,
 *    uploaded and stored. The build left index-BMXFxrFZ.css behind when the
 *    hash changed, and it rode along in every package after that.
 *
 * 2. CAN EACH RULE EVER FIRE. sporta-dark.css is an override sheet, so every
 *    selector in it is a claim that some element somewhere carries that class.
 *    A rule that can never match is not harmless: it looks like protection and
 *    is counted as such when someone asks whether the dark theme is handled.
 *
 *    IT TAKES TWO SIGNALS, and the first version of this file only had one.
 *    Asking the DOM on ten pages reported eight selectors as dead — .skeleton,
 *    .card, .bg-sand, .bg-white/90 and others — and every one of them was
 *    fine. A skeleton only exists WHILE a page loads and the scan waits for
 *    networkidle; .bg-white/90 is a hover state; .card and .bg-sand are on
 *    routes and conditions the ten pages do not cover. So a selector is only
 *    called dead when the pages never show it AND its class name appears
 *    nowhere in the shipped JavaScript or the built stylesheet — which is the
 *    difference between "not on screen today" and "cannot exist".
 *
 * The palette file is checked, not the 91 KB build output — that is generated
 * from a source this repo does not hold, so its unused rules are Tailwind's
 * business and not something anyone here can act on.
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const ROOT = new URL('../sporta-site/public_html/', import.meta.url).pathname
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PAGES = ['/', '/shop', '/cart', '/checkout', '/about', '/contact',
               '/product/cloudsoft-jacket-army-green', '/returns', '/privacy', '/terms']

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

// --- 1. every .css in assets/, against what index.html names ---------------
console.log('--- stylesheet files')
const html = readFileSync(ROOT + 'index.html', 'utf8')
const onDisk = readdirSync(ROOT + 'assets').filter((f) => f.endsWith('.css'))
for (const f of onDisk) {
  const named = html.includes(`/assets/${f}`)
  const size = readFileSync(ROOT + 'assets/' + f).length
  check(named, `assets/${f} (${size.toLocaleString()} B) is ${named ? 'referenced by index.html' : 'DEAD — nothing references it'}`)
}

// --- 1b. the service worker's precache list, against what is on disk -------
// sw.js names every asset by its content hash. If one is missing the install
// step rejects and the service worker never activates — so the whole offline
// story fails silently, on a file list nothing else checks.
const sw = readFileSync(ROOT + 'sw.js', 'utf8')
const precached = [...sw.matchAll(/"(\/[^"]+\.(?:js|css|woff2|png|webp|jpg|svg))"/g)].map((m) => m[1])
const absent = precached.filter((f) => !existsSync(ROOT + f.replace(/^\//, '')))
check(absent.length === 0,
  `sw.js precaches ${precached.length} files${absent.length ? `, ${absent.length} MISSING: ${absent.join(', ')}` : ', all present'}`)

// --- 2. every selector in the palette, against the real pages --------------
const css = readFileSync(ROOT + 'assets/sporta-dark.css', 'utf8')
// Strip comments, then take the selector list ahead of each block. The
// :root block is a variable declaration, not a claim about the DOM.
const selectors = new Set()
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^}]*\}/g)) {
  for (const sel of m[1].split(',')) {
    const s = sel.trim()
    if (!s || s.startsWith('@') || s.startsWith(':root')) continue
    // The theme attribute is on <html> and is what makes the sheet apply at
    // all; what matters is whether the part AFTER it exists on the page.
    selectors.add(s.replace(/^\[data-theme=['"]?dark['"]?\]\s*/, '').trim())
  }
}
console.log(`\n--- ${selectors.size} selectors in sporta-dark.css, against ${PAGES.length} pages`)

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => localStorage.setItem('sporta_theme', 'dark'))

const hits = new Map([...selectors].map((s) => [s, 0]))
for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)
  const counts = await p.evaluate((sels) => sels.map((s) => {
    try { return document.querySelectorAll(s).length } catch { return -1 }
  }), [...selectors])
  ;[...selectors].forEach((s, i) => {
    if (counts[i] > 0) hits.set(s, hits.get(s) + counts[i])
  })
}
await b.close()

// The second signal: could this class be emitted at all? Read from the built
// bundle and stylesheet, which together are everything the browser can ever be
// given.
// sporta-dark.css is EXCLUDED, and that is the whole correctness of this
// check. Reading it back would mean every selector proves its own existence
// by being written down — a test that can never fail. It was self-fulfilling
// exactly that way until a mutation with an invented class name sailed
// through. What counts as evidence is the code that RENDERS the page: the
// bundle, and the stylesheet the build produced.
const shipped = readdirSync(ROOT + 'assets')
  .filter((f) => (f.endsWith('.js') || f.endsWith('.css')) && f !== 'sporta-dark.css')
  .map((f) => readFileSync(ROOT + 'assets/' + f, 'utf8'))
  .join('\n')
const emitted = (sel) => {
  const cls = sel.replace(/\\/g, '').replace(/^\./, '').split(/[\s\[:]/)[0]
  return cls === '' || cls === 'body' || shipped.includes(cls)
}

const unseen = [...hits.entries()].filter(([, n]) => n === 0).map(([s]) => s)
const dead = unseen.filter((s) => !emitted(s))
const transient = unseen.filter((s) => emitted(s))
const live = [...hits.entries()].filter(([, n]) => n > 0)
for (const [s, n] of live.sort((a, b) => b[1] - a[1])) {
  console.log(`ok   ${String(n).padStart(5)} elements  ${s}`)
}
if (transient.length) {
  console.log(`\n--   ${transient.length} not on screen in this scan, but the code can emit them:`)
  for (const s of transient) console.log(`       ${s}`)
}
check(dead.length === 0,
  dead.length ? `${dead.length} selectors can NEVER fire — the class appears nowhere in the shipped code:\n       ${dead.join('\n       ')}`
              : 'every selector can fire — none is a rule guarding nothing')

console.log(fails ? `\n${fails} failed` : '\nall ok — no dead stylesheet, no selector that never fires')
process.exit(fails ? 1 : 0)
