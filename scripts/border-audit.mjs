/**
 * Every border on the website — all four sides, both themes, both widths.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/border-audit.mjs
 *   BASE=https://www.sporta.com.kw node scripts/border-audit.mjs
 *
 * `site-contrast.mjs` already looks at edges, but only at borderTopWidth and
 * borderTopColor — so a divider drawn with border-bottom alone is judged by
 * the side that was never drawn, and a card whose left edge is the only one
 * that failed passes. It also never sees a Tailwind `ring-*`, which is a
 * box-shadow and invisible to borderColor, and it runs one theme at a time.
 * This is the sweep that covers the rest.
 *
 * ONE thing is a failure here: a border drawn in the colour of what is
 * behind it AND of what is inside it. It exists in the stylesheet and
 * nowhere on screen, and that is breakage rather than taste — no design
 * intends an edge nobody can see. A border only has to differ from ONE of
 * its two sides to be visible, so both must be flat before this fires.
 *
 * Everything else is REPORTED, in three lists:
 *
 *   - controls whose boundary is the only thing identifying them: no label,
 *     no icon, no fill of their own, and an edge under the 3:1 WCAG 1.4.11
 *     asks. These are worth the owner's eye — but they are a look, not a
 *     bug, and this file does not overrule the design. (A button that says
 *     "Continue" is identified by the word and an icon button by its icon;
 *     the standard asks nothing of the hairline round either, which is why
 *     the first cut of this file "found" 1318 of them and was wrong.)
 *   - every quiet hairline under 3:1, grouped by colour pair.
 *   - a census of the distinct edge colours, widths and corner radii the
 *     site actually draws, which is how an inconsistency shows up.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PAGES = ['/', '/shop', '/cart', '/checkout', '/about', '/contact',
               '/product/cloudsoft-jacket-army-green', '/returns', '/privacy', '/terms']
const VIEWS = [
  { name: 'phone  ', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 1000 },
]
const THEMES = ['dark', 'light']

let fails = 0, edges = 0
const quiet = []
const lost = []
const census = { color: new Map(), width: new Map(), radius: new Map() }
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

// The page-side half of the rig. Everything to do with colour has to run in
// the page, because that is the only place that knows what `oklab(...)` is.
const SCAN = () => {
  const lum = (rgb) => {
    const c = rgb.slice(0, 3).map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  // Tailwind v4 hands back oklab() and lab() from getComputedStyle. Reading
  // those three numbers as red, green and blue is a bug this project has
  // written three times. The browser is the only thing that knows the
  // conversion, so it does it: paint the colour, read the pixel.
  const _c = document.createElement('canvas'); _c.width = _c.height = 1
  const _x = _c.getContext('2d', { willReadFrequently: true })
  const _seen = new Map()
  const parse = (s) => {
    if (!s || s === 'none' || s === 'transparent') return null
    if (_seen.has(s)) return _seen.get(s)
    let v
    if (/^rgba?\(/.test(s)) {
      const n = (s.match(/[\d.]+/g) ?? []).map(Number)
      v = n.length >= 3 ? { rgb: n.slice(0, 3), a: n[3] ?? 1 } : null
    } else {
      _x.clearRect(0, 0, 1, 1); _x.fillStyle = '#000'; _x.fillStyle = s
      _x.fillRect(0, 0, 1, 1)
      const d = _x.getImageData(0, 0, 1, 1).data
      // getImageData is NOT premultiplied — `rgba(255,255,255,.15)` comes
      // back as 255,255,255,38, verified in this browser. So the channels
      // are already the colour and the alpha is the fourth number; dividing
      // by it (as the first cut here did, and as site-contrast.mjs did for
      // months) turns every 15%-white hairline into pure white and hides
      // exactly the faint edges this file exists to find.
      v = d[3] > 0 ? { rgb: [d[0], d[1], d[2]], a: d[3] / 255 } : null
    }
    _seen.set(s, v)
    return v
  }
  // A translucent border lands as itself OVER what is behind it. Measuring
  // the raw value calls a 12%-white hairline a bright grey.
  const over = (c, bg) => c.rgb.map((v, i) => v * c.a + bg[i] * (1 - c.a))
  // Clamped, because undoing the canvas's premultiplied alpha can land a
  // rounded channel a shade past 255 and #11d11f123 is not a colour.
  const hex = (c) => '#' + c.slice(0, 3)
    .map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')).join('')

  // What is painted behind `el` — the first ancestor with an opaque enough
  // background. A photograph is unknowable and says so.
  const groundOf = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor)
      if (c && c.a >= 0.85) return c.rgb
    }
    return parse(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255]
  }

  const CONTROL = 'a,button,input,select,textarea,summary,[role="button"],[role="link"],' +
                  '[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[tabindex]:not([tabindex="-1"])'
  const SIDES = ['Top', 'Right', 'Bottom', 'Left']

  const out = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') continue

    const outside = groundOf(el.parentElement ?? el)
    if (!outside) continue                       // sits on a photograph
    // Inside the border is the element's own fill, when it has one. A border
    // is an edge between two areas and is visible if it differs from either.
    const own = parse(cs.backgroundColor)
    const inside = own && own.a > 0 ? over(own, outside) : outside
    const isControl = el.matches(CONTROL)
    // 1.4.11 asks 3:1 of the visual information NEEDED to identify a control.
    // A button that says "Continue" is identified by the word, and a filled
    // one by its fill; in both cases the hairline round it is decoration and
    // the standard does not ask anything of it. What the standard is actually
    // about is the control with nothing else: an icon or an empty box whose
    // only affordance is the edge. That is what this fails.
    const label = (el.textContent ?? '').trim().length > 0 || !!el.querySelector('svg,img')
    const filled = ratio(inside, outside) >= 3
    const bare = isControl && !label && !filled

    const push = (kind, side, colorStr, width) => {
      const c = parse(colorStr)
      if (!c || c.a === 0 || !(width > 0)) return
      const painted = over(c, outside)
      out.push({
        kind, side, width: Math.round(width * 100) / 100,
        ratio: Math.round(Math.max(ratio(painted, outside), ratio(painted, inside)) * 100) / 100,
        outRatio: Math.round(ratio(painted, outside) * 100) / 100,
        inRatio: Math.round(ratio(painted, inside) * 100) / 100,
        color: hex(painted), on: hex(outside),
        radius: cs.borderRadius,
        control: isControl, bare,
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() ?? '').slice(0, 44),
      })
    }

    for (const s of SIDES) {
      if (cs[`border${s}Style`] === 'none' || cs[`border${s}Style`] === 'hidden') continue
      push('border', s.toLowerCase(), cs[`border${s}Color`], parseFloat(cs[`border${s}Width`]))
    }
    if (cs.outlineStyle !== 'none') push('outline', 'all', cs.outlineColor, parseFloat(cs.outlineWidth))
    // Tailwind's ring-* is a box-shadow with a spread and no blur, and
    // borderColor cannot see it. Only those count as an edge — a real drop
    // shadow is not a boundary and would drown the census.
    for (const m of (cs.boxShadow ?? '').matchAll(
      /(?:^|,\s*)(?:inset\s+)?((?:rgba?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]+)\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px/gi)) {
      const [, col, ox, oy, blur, spread] = m
      if (parseFloat(blur) > 1 || parseFloat(spread) <= 0) continue
      if (Math.abs(parseFloat(ox)) > 1 || Math.abs(parseFloat(oy)) > 1) continue
      push('ring', 'all', col, parseFloat(spread))
    }
  }
  return out
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const theme of THEMES) {
  for (const view of VIEWS) {
    const p = await b.newPage({ viewport: { width: view.width, height: view.height } })
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await p.evaluate((t) => localStorage.setItem('sporta_theme', t), theme)

    let invisible = 0, seen = 0
    for (const path of PAGES) {
      await p.goto(BASE + path, { waitUntil: 'networkidle' })
      await p.waitForTimeout(900)
      const rows = await p.evaluate(SCAN)
      seen += rows.length
      edges += rows.length

      for (const e of rows) {
        const k = `${e.color} on ${e.on}`
        census.color.set(k, (census.color.get(k) ?? 0) + 1)
        census.width.set(`${e.kind} ${e.width}px`, (census.width.get(`${e.kind} ${e.width}px`) ?? 0) + 1)
        if (e.kind === 'border' && e.side === 'top') {
          // rounded-full computes as a huge pixel value; say what it means.
          const rad = parseFloat(e.radius) > 999 ? 'full' : e.radius
          census.radius.set(rad, (census.radius.get(rad) ?? 0) + 1)
        }
        const where = `${theme}/${view.name.trim()} ${path} <${e.tag}${e.cls ? ' .' + e.cls : ''}> ${e.kind}-${e.side}`

        if (e.ratio < 1.02) {
          invisible++; fails++
          console.log(`FAIL ${where} — ${e.color} against both sides (${e.outRatio}:1 out, ${e.inRatio}:1 in)`)
        } else if (e.bare && e.ratio < 3) {
          lost.push({ ...e, where })
        } else if (e.ratio < 3) {
          quiet.push({ ...e, theme, view: view.name.trim(), path })
        }
      }
    }
    check(invisible === 0,
      `${theme.padEnd(5)} ${view.name}  ${seen} edges — none drawn in the colour of both its sides`)
    await p.close()
  }
}

const top = (m, n) => [...m.entries()].sort((a, c) => c[1] - a[1]).slice(0, n)

if (lost.length) {
  console.log(`\n--- controls identified by nothing but their edge (reported, not failed) ---`)
  const seen = new Set()
  for (const e of lost) {
    const k = `${e.theme} ${e.path} ${e.tag}.${e.cls}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`  ${String(e.ratio).padStart(5)}:1  ${e.where}`)
  }
  console.log(`  ${seen.size} distinct controls, ${lost.length} edges`)
}

console.log(`\n--- quiet hairlines, under the 3:1 of a control edge (reported, not failed) ---`)
const byPair = new Map()
for (const e of quiet) byPair.set(`${e.color} on ${e.on}`, (byPair.get(`${e.color} on ${e.on}`) ?? 0) + 1)
for (const [pair, n] of top(byPair, 8)) {
  const one = quiet.find((e) => `${e.color} on ${e.on}` === pair)
  console.log(`  ${String(one.ratio).padStart(5)}:1  ${pair}  x${n}`)
}
console.log(`  ${quiet.length} of ${edges} edges, across ${new Set(quiet.map((e) => e.path)).size} pages`)

console.log(`\n--- the census: what the site actually draws ---`)
console.log(`  ${census.color.size} distinct painted edge colours; the commonest:`)
for (const [c, n] of top(census.color, 6)) console.log(`    ${c}  x${n}`)
console.log(`  widths:`)
for (const [w, n] of top(census.width, 10)) console.log(`    ${w}  x${n}`)
console.log(`  corner radii on bordered boxes:`)
for (const [r, n] of top(census.radius, 8)) console.log(`    ${r}  x${n}`)

console.log(`\n${edges} edges measured across ${PAGES.length} pages, ${THEMES.length} themes, ${VIEWS.length} widths`)
console.log(fails ? `${fails} broken` : 'all ok — every border is visible, and every control can be found')
await b.close()
process.exit(fails ? 1 : 0)
