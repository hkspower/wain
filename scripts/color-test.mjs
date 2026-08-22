/**
 * Every colour the app actually PAINTS, measured where it lands.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/color-test.mjs
 *
 * scripts/contrast-test.mjs reads the palette and checks a list of pairs
 * somebody wrote down. This opens the app instead. The difference is the whole
 * point: a pair list can only be as complete as the person who wrote it, and
 * it cannot see a hard-coded '#ffffff' in a component, a colour landing on a
 * surface nobody thought to pair it with, or the two of them meeting only on
 * one screen in one language.
 *
 * Three questions, per page, in both light and dark:
 *
 *   1. Is every line of text legible on what is actually behind it? AA is
 *      4.5:1, or 3:1 for large text — the same thresholds a Kuwaiti shopper's
 *      phone in daylight is the real test of.
 *   2. Can you see the edges? A border or an icon carrying meaning needs 3:1
 *      against its surroundings, and a 1px hairline at 1.2:1 is decoration
 *      that somebody believed was a boundary.
 *   3. Is the colour in the palette at all? Every stray hex is a colour that
 *      will not follow the theme when it changes, and will not turn up in
 *      contrast-test.mjs either, because it is in no token.
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'

const ROUTES = [
  '/', '/shop', '/cart', '/checkout', '/account',
  '/product/desert-runner-short', '/order/SP-2601',
]

// ---- the palette, as declared ------------------------------------------
// theme.ts AND catalog.ts: the tiles' and products' ground colours are a
// declared palette too, they simply live where the things they belong to are.
const declared = new Set()
for (const file of ['../src/constants/theme.ts', '../src/lib/catalog.ts']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const m of src.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)) declared.add(m[1].toLowerCase())
}
// Colours the app paints on purpose without a token: pure white and pure
// black on a brand fill, and the wash over a sold-out photograph. Named here
// so the check stays a check rather than a list of known noise.
for (const c of ['#ffffff', '#000000', '#fff', '#000']) declared.add(c)

let fails = 0
const notes = []
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const note = (what) => {
  notes.push(what)
  console.log(`--   ${what}`)
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const scheme of ['light', 'dark']) {
  console.log(`\n=== ${scheme} ===============================================`)
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: scheme,
  })
  // The bundle points at the production shop, which a sandbox cannot reach.
  // Redirected here rather than rebuilt, so what is measured is what ships.
  await ctx.route('https://www.sporta.com.kw/**', async (route) => {
    const req = route.request()
    try {
      const res = await fetch(req.url().replace('https://www.sporta.com.kw', SITE), {
        method: req.method(),
        headers: req.headers(),
        body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData(),
      })
      await route.fulfill({
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
        body: Buffer.from(await res.arrayBuffer()),
      })
    } catch {
      await route.abort()
    }
  })
  const p = await ctx.newPage()

  const strays = new Map()
  const overArt = new Map()

  for (const route of ROUTES) {
    await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 })
    await p.waitForTimeout(1400)

    const found = await p.evaluate(() => {
      // --- colour arithmetic, in the page so it sees computed values ----
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const [r, g, bl, a = '1'] = m[1].split(',').map((v) => parseFloat(v))
        return { r, g, b: bl, a }
      }
      const over = (fg, bg) => ({
        // Straight alpha compositing. A label at 60% opacity on white is not
        // the colour the stylesheet names, and reading the stylesheet is how
        // you conclude it passes when it does not.
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      })
      const ch = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
      const ratio = (x, y) => {
        const [hi, lo] = [lum(x), lum(y)].sort((a, b) => b - a)
        return (hi + 0.05) / (lo + 0.05)
      }
      const hex = (c) =>
        '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

      // What is REALLY behind an element: the first ancestor that paints, with
      // every translucent layer between composited back onto it.
      const backdrop = (el) => {
        const stack = []
        let node = el
        while (node && node !== document.documentElement) {
          const cs = getComputedStyle(node)
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return { art: true }
          const bg = parse(cs.backgroundColor)
          if (bg && bg.a > 0) {
            stack.push(bg)
            if (bg.a === 1) break
          }
          node = node.parentElement
        }
        let base = { r: 255, g: 255, b: 255, a: 1 }
        for (const layer of stack.reverse()) base = over(layer, base)
        return { color: base }
      }

      // Text drawn over a photograph cannot be measured from the DOM — the
      // pixels come from the image, not from a stylesheet. Reported, never
      // silently passed.
      const hasArtBehind = (el) => {
        let node = el
        while (node && node !== document.body) {
          if (node.querySelector?.('[data-expoimage="true"], img, video')) {
            const r = node.getBoundingClientRect()
            const art = node.querySelector('[data-expoimage="true"], img, video')
            const a = art.getBoundingClientRect()
            if (a.width >= r.width * 0.9 && a.height >= r.height * 0.9) return true
          }
          node = node.parentElement
        }
        return false
      }

      const text = []
      const edges = []
      const seen = new Set()

      for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        const box = el.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue

        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(' ')
          .trim()

        // EMOJI ARE PICTURES. A 🛍️ paints its own colours and ignores the
        // `color` it inherits, so measuring that colour against the background
        // says nothing at all — it reported the app's own charcoal ground as
        // an illegible black on 46 product cards. The arrows are the same:
        // they are glyphs the system draws, deliberately left to it.
        const pictorial = own.length > 0 && !/[\p{L}\p{N}]/u.test(own)

        if (own && !pictorial) {
          const fg = parse(cs.color)
          const opacity = parseFloat(cs.opacity)
          if (fg) {
            const bd = backdrop(el)
            if (bd.art || hasArtBehind(el)) {
              text.push({ art: true, text: own.slice(0, 24), color: hex(fg) })
            } else {
              const composited = over({ ...fg, a: fg.a * (isNaN(opacity) ? 1 : opacity) }, bd.color)
              const size = parseFloat(cs.fontSize)
              const weight = parseInt(cs.fontWeight, 10) || 400
              // WCAG "large text": 24px, or 18.66px when bold.
              const large = size >= 24 || (size >= 18.66 && weight >= 700)
              text.push({
                text: own.slice(0, 24),
                fg: hex(composited),
                bg: hex(bd.color),
                size,
                large,
                ratio: Math.round(ratio(composited, bd.color) * 100) / 100,
              })
            }
          }
        }

        // Borders that are actually drawn.
        const bw = parseFloat(cs.borderTopWidth)
        if (bw > 0) {
          const bc = parse(cs.borderTopColor)
          const bd = backdrop(el.parentElement ?? el)
          if (bc && bc.a > 0 && !bd.art) {
            const composited = over(bc, bd.color)
            edges.push({
              ratio: Math.round(ratio(composited, bd.color) * 100) / 100,
              color: hex(composited),
              on: hex(bd.color),
            })
          }
        }

        // Every colour value the page names, for the palette check.
        for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
          const c = parse(cs[prop])
          if (c && c.a > 0) seen.add(hex(c))
        }
      }
      return { text, edges, colors: [...seen] }
    })

    const label = route.padEnd(30)

    // 1. Legibility.
    const illegible = found.text.filter((t) => !t.art && t.ratio < (t.large ? 3 : 4.5))
    check(illegible.length === 0,
      `${label} every line meets AA${illegible.length
        ? ` — ${illegible.length}, worst ${Math.min(...illegible.map((t) => t.ratio))}:1 ` +
          `(${illegible[0].fg} on ${illegible[0].bg}, "${illegible[0].text}")`
        : ` (${found.text.filter((t) => !t.art).length} lines)`}`)

    // Text on a photograph: counted and named, never passed off as checked.
    const onArt = found.text.filter((t) => t.art)
    if (onArt.length) overArt.set(route, onArt.length)

    // 2. Edges, at two different standards, because they are two different
    //    things and one threshold for both would either shout about seams or
    //    stay silent about controls.
    //
    //    A border that is EXACTLY its background is not a border. That is a
    //    failure at any size, on anything: something was drawn and cannot be
    //    seen at all.
    const absent = found.edges.filter((e) => e.ratio < 1.02)
    check(absent.length === 0,
      `${label} no border is drawn in its own background colour${absent.length
        ? ` — ${absent.length}, e.g. ${absent[0].color} on ${absent[0].on}`
        : ''}`)

    //    WCAG 1.4.11 asks 3:1 of anything that marks out a CONTROL — the edge
    //    of a text field is how you know where to type. This shop's hairline
    //    is #e2e4e8 on #f2f3f5, which is 1.15:1, and raising it changes the
    //    look of every screen. So it is reported with its numbers and left to
    //    the owner rather than decided here. See docs-STYLE.md.
    const faint = found.edges.filter((e) => e.ratio >= 1.02 && e.ratio < 3)
    if (faint.length)
      note(`${label} ${faint.length} outlines under the 3:1 WCAG asks of a ` +
           `control edge — faintest ${Math.min(...faint.map((e) => e.ratio))}:1 ` +
           `(${faint[0].color} on ${faint[0].on})`)

    // 3. Palette discipline.
    for (const c of found.colors) if (!declared.has(c)) strays.set(c, (strays.get(c) ?? 0) + 1)
  }

  check(strays.size === 0,
    `no colour outside the palette${strays.size
      ? ` — ${[...strays.entries()].map(([c, n]) => `${c}×${n}`).slice(0, 6).join(', ')}`
      : ''}`)
  for (const [route, n] of overArt)
    note(`${route.padEnd(30)} ${n} lines sit on artwork — not measurable from the DOM`)

  await ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} failed` : `\nall ok — both schemes, ${ROUTES.length} pages`)
process.exit(fails ? 1 : 0)
