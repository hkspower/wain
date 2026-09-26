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
 * 3. DOES THE RULE WIN. This is the one that matters most for an override
 *    sheet and the one nothing else could see. A rule can parse, match a real
 *    element, and still lose — to a longer selector, to an inline style, to a
 *    later declaration. It then sits in the file looking correct while the
 *    element paints something else entirely. So every colour this sheet
 *    declares is read back off a real element as a COMPUTED value and compared
 *    with what the rule asked for.
 *
 *    The expectations are derived from the stylesheet, not written down beside
 *    it: each declaration's var(--sp-…) is resolved from the file's own :root
 *    block. A hand-kept list would drift from the sheet the first time either
 *    changed, and then check the wrong thing quietly.
 *
 * The palette file is checked, not the 91 KB build output — that is generated
 * from a source this repo does not hold, so its unused rules are Tailwind's
 * business and not something anyone here can act on.
 *
 * 4. EVERY IMAGE A url() NAMES, DOES IT EXIST. sw.js's precache list is
 *    already checked against disk (1b, above) — but that is a DIFFERENT list
 *    from what the hand-written CSS itself asks the browser to fetch as a
 *    background. A url() typo in sporta-ui.css would not fail to precache
 *    (the path is never in PRECACHE), would not 404 loudly (a missing
 *    background-image just paints nothing), and nothing here checked it —
 *    the entire site has exactly one such reference (`/logo-white.webp`, the
 *    placeholder mark on a product card with no photo), and it went
 *    unaudited because it is neither an `<img>` font-audit.mjs and
 *    image-audit.mjs watch, nor an `@font-face` src, nor a precache entry.
 *
 *    WHAT THIS DELIBERATELY DOES NOT ASSERT: that the source is no bigger
 *    than THIS ONE USE needs. logo-white.webp is a SHARED FILE —
 *    index.html's boot logo, and the standalone card.html and
 *    returns-request.html pages, both declare a bigger box than this CSS
 *    mark ever renders, and the built bundle may use it elsewhere at a size
 *    nothing here can see. A first draft of this check measured "needless"
 *    against the CSS mark alone and would have called a correctly-sized
 *    shared asset oversized — the exact shape this repository already
 *    records under "a workaround can be right and its side effects
 *    unmeasured." So the OTHER known consumers are read out of their own
 *    markup and reported alongside, and nothing is asserted about the size
 *    beyond "not upscaled by this one use" — which is safe precisely because
 *    it can never produce a false failure against a shared file.
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

// --- 1c. every url() image reference in the HAND-WRITTEN CSS, against disk -
// A DIFFERENT list from sw.js's precache array above: this is what a url()
// property in the stylesheet itself asks the browser to fetch. Neither
// image-audit.mjs (which walks <img>/<picture>) nor font-audit.mjs (@font-face
// src) nor the precache check above would catch a typo here — a missing
// background-image just paints nothing, silently, on the exact cards a shop
// with no product photos shows every visitor.
const handWritten = ['sporta-ui.css', 'sporta-dark.css']
const cssUrls = []
for (const f of handWritten) {
  const body = readFileSync(ROOT + 'assets/' + f, 'utf8')
  for (const m of body.matchAll(/url\(\s*['"]?(\/[^'")]+\.(?:png|jpe?g|gif|webp|avif|svg))['"]?\s*\)/g)) {
    cssUrls.push({ file: f, path: m[1] })
  }
}
// It must find something. A pattern that stopped matching (a build renaming
// how url() is written, say) would report a clean sweep for the wrong reason
// — the same shape as every other "found nothing" trap this repository has
// paid for.
check(cssUrls.length > 0, `found ${cssUrls.length} image url() reference(s) in the hand-written CSS`)
for (const { file, path } of cssUrls) {
  check(existsSync(ROOT + path.replace(/^\//, '')), `${file}: url('${path}') resolves to a real file`)
}

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

// --- what each rule CLAIMS a colour becomes, read out of the sheet ----------
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
// ONLY the blocks the audited pages are under: `:root` and the dark theme.
// Reading every --sp-* in the file let the later `dark-white` block's
// --sp-silver (#d0d0d0) stand in for the dark one, and 29 correctly painted
// labels were reported as outranked.
const vars = {}
for (const b of clean.matchAll(/(:root(?:\[data-theme='dark'\])?)\s*\{([^}]*)\}/g))
  for (const m of b[2].matchAll(/(--sp-[a-z-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
const PROP = { 'background-color': 'backgroundColor', color: 'color', 'border-color': 'borderTopColor' }
const claims = []
for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const sels = m[1].split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith(':root'))
  if (!sels.length) continue
  for (const d of m[2].split(';')) {
    const [rawProp, ...rest] = d.split(':')
    const prop = PROP[rawProp?.trim()]
    if (!prop) continue
    let want = rest.join(':').replace('!important', '').trim()
    want = want.replace(/var\((--sp-[a-z-]+)\)/g, (_, v) => vars[v] ?? _)
    // Only flat hex is comparable; alpha values composite against whatever is
    // behind and are covered by site-contrast.mjs instead.
    if (!/^#[0-9a-f]{6}$/i.test(want)) continue
    for (const sel of sels) {
      claims.push([sel.replace(/^\[data-theme=['"]?dark['"]?\]\s*/, '').trim(), prop, want.toLowerCase()])
    }
    // claims stay in FILE ORDER — the page-side check relies on it below.
  }
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => localStorage.setItem('sporta_theme', 'dark'))

const hits = new Map([...selectors].map((s) => [s, 0]))
const overridden = new Set()
// Set once, on the widest page that has one — /shop, the only page with a
// grid of placeholder cards. Filled in below.
let placeholderMark = null
for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)

  // --- 1c continued: is the ONE url() image upscaled by what it paints here
  // Measured against the WIDEST placeholder card on the page — a photo-less
  // shop shows the mark on every one of them, so the widest card is the
  // worst case for this one consumer's need.
  if (path === '/shop' && placeholderMark === null) {
    placeholderMark = await p.evaluate(async () => {
      const els = [...document.querySelectorAll(
        'a[href*="/product/"]:has(> img[src^="data:image/svg+xml"]), '
        + '.product-gallery:has(> img[src^="data:image/svg+xml"])',
      )]
      if (!els.length) return { count: 0 }
      let widest = els[0]
      for (const el of els) if (el.getBoundingClientRect().width > widest.getBoundingClientRect().width) widest = el
      const cs = getComputedStyle(widest, '::after')
      const box = widest.getBoundingClientRect()
      const url = (cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1]
      const pct = parseFloat(cs.backgroundSize) || 100
      let natural = null
      if (url) {
        natural = await new Promise((res) => {
          const im = new Image()
          im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
          im.onerror = () => res(null)
          im.src = url
        })
      }
      return { count: els.length, cardW: box.width, markPct: pct, natural }
    })
  }
  const counts = await p.evaluate((sels) => sels.map((s) => {
    try { return document.querySelectorAll(s).length } catch { return -1 }
  }), [...selectors])
  ;[...selectors].forEach((s, i) => {
    if (counts[i] > 0) hits.set(s, hits.get(s) + counts[i])
  })

  const lost = await p.evaluate((cl) => {
    const hex = (s) => {
      const m = (s.match(/[\d.]+/g) || []).map(Number)
      return m.length >= 3 ? '#' + m.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : s
    }
    // AN ELEMENT CAN MATCH SEVERAL RULES IN THIS SHEET, and then the last one
    // wins — that is the cascade doing its job, not a failure. The wishlist
    // heart is .text-slate-600 AND .bg-white/95; the second deliberately makes
    // it an ink icon on a silver disc, and reading it against the first
    // reported a bug where the rendering is exactly right. So the value to
    // expect is the LAST claim in file order that matches this element and
    // sets this property. Anything else painting it is genuinely foreign.
    const out = []
    for (let i = 0; i < cl.length; i++) {
      const [sel, prop, want] = cl[i]
      // Deliberate later overrides in sporta-ui.css, by element: the hero's
      // `bg-ink` is painted #000 at the owner's request ("remove black",
      // under the black top bar). Sample another element for that selector.
      const OVERRIDDEN = '[class~="isolate"][class~="overflow-hidden"][class~="bg-ink"], [class~="shrink-0"][class~="bg-ink"]'
      let el
      try { el = [...document.querySelectorAll(sel)].find((e) => !e.matches(OVERRIDDEN)) } catch { continue }
      if (!el) continue
      let expected = want
      for (let j = i + 1; j < cl.length; j++) {
        const [s2, p2, w2] = cl[j]
        if (p2 !== prop) continue
        try { if (el.matches(s2)) expected = w2 } catch {}
      }
      const got = hex(getComputedStyle(el)[prop]).toLowerCase()
      if (got !== expected) out.push(`${sel}  ${prop} = ${got}, this sheet asks ${expected}`)
    }
    return out
  }, claims)
  for (const l of lost) overridden.add(`${path}  ${l}`)
}
await b.close()

// --- 1c concluded: does the source cover the render without upscaling ------
console.log('\n--- the placeholder mark, measured rather than assumed')
if (!placeholderMark || placeholderMark.count === 0) {
  // NOT a failure by itself — a shop with real product photos would show
  // none of these, and that is the point of the feature. It only becomes
  // worth asking about below, where the count is reported.
  console.log('ok   no photo-less product cards on /shop today — the mark painted nowhere to measure')
} else {
  const { count, cardW, markPct, natural } = placeholderMark
  console.log(`     ${count} photo-less card(s) on /shop; widest is ${Math.round(cardW)}px, mark at ${markPct}%`)
  check(!!natural, `the mark's own image loaded and reported its size${natural ? '' : ' — background-image url() resolved to nothing the browser could decode'}`)
  if (natural) {
    const renderedW = cardW * (markPct / 100)
    check(natural.w >= renderedW,
      `the source (${natural.w}px) is not upscaled by the CSS mark even at 1x (needs ${Math.round(renderedW)}px)`)

    // WHAT THIS DOES NOT ASSERT, on purpose: that the source is no LARGER than
    // this one use needs. logo-white.webp is a SHARED FILE — index.html's
    // boot logo (width=132/preloaded fetchpriority=high), and the standalone
    // card.html/returns-request.html brand mark (width=140), both declare a
    // bigger box than this CSS mark ever renders, and the built bundle may use
    // it elsewhere at a size nothing here can see. A check that measured
    // "needless" against this ONE consumer would have called a correctly-sized
    // shared asset oversized and pointed at shrinking a file that OTHER pages
    // need at full size — the exact shape CLAUDE.md already records: "a
    // workaround can be right and its side effects unmeasured." Reported, not
    // failed, and the other declared consumers are read out of their own
    // markup rather than a number kept here.
    const declared = []
    for (const file of ['index.html', 'card.html', 'returns-request.html']) {
      const m = readFileSync(ROOT + file, 'utf8')
        .match(/<img[^>]*src="\/logo-white\.webp"[^>]*width="(\d+)"/)
      if (m) declared.push({ file, w: Number(m[1]) })
    }
    const widest = declared.reduce((a, b) => (b.w > a.w ? b : a), { file: 'this CSS mark', w: renderedW })
    console.log(`     natural width ${natural.w}px; the widest KNOWN declared use is ${widest.file}`
      + ` at ${Math.round(widest.w)}px (×3 retina = ${Math.round(widest.w * 3)}px) — shared file, not resized on this evidence alone`)
  }
}

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
check(overridden.size === 0,
  overridden.size
    ? `${overridden.size} declarations are outranked — the rule matches but something else paints it:\n       ${[...overridden].join('\n       ')}`
    : `all ${claims.length} colour declarations win where they match`)

check(dead.length === 0,
  dead.length ? `${dead.length} selectors can NEVER fire — the class appears nowhere in the shipped code:\n       ${dead.join('\n       ')}`
              : 'every selector can fire — none is a rule guarding nothing')

console.log(fails ? `\n${fails} failed` : '\nall ok — no dead stylesheet, no selector that never fires')
process.exit(fails ? 1 : 0)
