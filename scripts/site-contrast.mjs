/**
 * Every piece of text on the website, measured against what is actually
 * behind it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/site-contrast.mjs                 # the dark theme (default)
 *   THEME=light node scripts/site-contrast.mjs     # the other one
 *   BASE=https://www.sporta.com.kw node scripts/site-contrast.mjs
 *
 * A palette can be checked on paper — I did, before touching anything, and
 * every pair in the new ramp passed. That is not the same as checking the
 * SHOP, because a swatch table cannot know which text ends up on which
 * surface. This walks the real DOM and asks the browser: for this run of
 * text, what is the nearest ancestor that actually paints a background, and
 * what is the ratio between them?
 *
 * The threshold is WCAG AA: 4.5:1 for body text, 3:1 once the text is large
 * (24px, or 18.66px bold). Text over a photograph is skipped and counted —
 * the ground there is a JPEG, not a colour, and no static check can speak for
 * it.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const THEME = process.env.THEME ?? 'dark'
const PAGES = ['/', '/shop', '/cart', '/checkout', '/about', '/contact',
               '/product/cloudsoft-jacket-army-green', '/returns', '/privacy', '/terms']

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })

let fails = 0, checked = 0, skipped = 0
const worst = []
const faintEdges = new Map()
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await p.evaluate((t) => localStorage.setItem('sporta_theme', t), THEME)

for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  const rows = await p.evaluate(() => {
    // The luminance and ratio maths run IN the page, because that is where
    // the computed colours are. Same formula as WCAG 2.1 relative luminance.
    const lum = (rgb) => {
      const c = rgb.slice(0, 3).map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    // COLOURS DO NOT ALWAYS COME BACK AS rgb(). This stylesheet is Tailwind
    // v4, so getComputedStyle hands back `oklab(0.99 0.00004 0.00002 / .8)`
    // and `lab(84.7 -1.9 -7.9)` for anything built with color-mix. Reading
    // those three numbers as if they were red, green and blue is how the
    // first run of this file reported white-on-black as 1.19:1 and flagged
    // 88 perfectly readable labels. The browser is the only thing that knows
    // the conversion, so it does it: paint the colour and read the pixel.
    const _c = document.createElement('canvas'); _c.width = _c.height = 1
    const _x = _c.getContext('2d', { willReadFrequently: true })
    const _seen = new Map()
    const parse = (s) => {
      if (_seen.has(s)) return _seen.get(s)
      let v
      if (/^rgba?\(/.test(s)) v = (s.match(/[\d.]+/g) ?? []).map(Number)
      else {
        _x.clearRect(0, 0, 1, 1)
        _x.fillStyle = '#000'
        _x.fillStyle = s                       // invalid strings leave it #000
        _x.fillRect(0, 0, 1, 1)
        const d = _x.getImageData(0, 0, 1, 1).data
        // The canvas composites alpha against the black it was cleared to, so
        // the alpha is taken from the string and the channels are undone.
        const a = Number((s.match(/\/\s*([\d.]+)\s*\)/) ?? [])[1] ?? 1)
        v = a > 0 ? [d[0] / a, d[1] / a, d[2] / a, a] : [d[0], d[1], d[2], a]
      }
      _seen.set(s, v)
      return v
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    // What is BEHIND this element: the first ancestor painting something
    // opaque enough to count as the ground.
    const groundOf = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.backgroundImage !== 'none') return { photo: true }
        const c = parse(cs.backgroundColor)
        if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.85)) return { rgb: c }
      }
      const c = parse(getComputedStyle(document.body).backgroundColor)
      return { rgb: c.length >= 3 ? c : [255, 255, 255] }
    }

    const out = []
    for (const el of document.querySelectorAll('*')) {
      // Only elements that render text of their OWN — otherwise a wrapper is
      // measured once per descendant and one real failure reads as twenty.
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
      if (!own) continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      const fg = parse(cs.color)
      if (fg.length < 3 || (fg[3] !== undefined && fg[3] < 0.5)) continue

      const g = groundOf(el)
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const large = size >= 24 || (bold && size >= 18.66)
      const text = (el.textContent ?? '').trim().slice(0, 34)
      if (g.photo) { out.push({ photo: true, text }); continue }
      out.push({
        ratio: ratio(fg, g.rgb), need: large ? 3 : 4.5, text,
        fg: cs.color, bg: `rgb(${g.rgb.slice(0, 3).join(', ')})`,
        cls: (el.className?.toString?.() ?? el.tagName).slice(0, 40),
      })
    }
    return out
  })

  // --- the edges, measured the way the app's colour rig measures them -------
  // Same two standards and the same split, so a border is judged identically
  // whichever half of Sporta it is drawn in. A hairline is the one thing a
  // repaint breaks silently: text that goes wrong is obvious, a boundary that
  // quietly stops existing is not.
  const edges = await p.evaluate(() => {
    const lum = (rgb) => {
      const c = rgb.slice(0, 3).map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    const _c = document.createElement('canvas'); _c.width = _c.height = 1
    const _x = _c.getContext('2d', { willReadFrequently: true })
    const parse = (s) => {
      if (/^rgba?\(/.test(s)) {
        const n = (s.match(/[\d.]+/g) ?? []).map(Number)
        return n.length >= 3 ? { rgb: n.slice(0, 3), a: n[3] ?? 1 } : null
      }
      _x.clearRect(0, 0, 1, 1); _x.fillStyle = '#000'; _x.fillStyle = s
      _x.fillRect(0, 0, 1, 1)
      const d = _x.getImageData(0, 0, 1, 1).data
      const a = Number((s.match(/\/\s*([\d.]+)\s*\)/) ?? [])[1] ?? 1)
      return a > 0 ? { rgb: [d[0] / a, d[1] / a, d[2] / a], a } : null
    }
    // A translucent border does not land as its own colour — it lands as
    // itself OVER whatever is behind. Measuring the raw value would call a
    // 12%-white hairline a bright grey.
    const over = (c, bg) => c.rgb.map((v, i) => v * c.a + bg[i] * (1 - c.a))
    const groundOf = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.backgroundImage !== 'none') return null   // a photograph: unknowable
        const c = parse(cs.backgroundColor)
        if (c && c.a >= 0.85) return c.rgb
      }
      return parse(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255]
    }

    const out = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      if (parseFloat(cs.borderTopWidth) <= 0 || cs.borderTopStyle === 'none') continue
      const bc = parse(cs.borderTopColor)
      if (!bc || bc.a === 0) continue
      const ground = groundOf(el.parentElement ?? el)
      if (!ground) continue
      const painted = over(bc, ground)
      const hex = (c) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
      out.push({
        ratio: Math.round(ratio(painted, ground) * 100) / 100,
        color: hex(painted), on: hex(ground),
        cls: (el.className?.toString?.() ?? el.tagName).slice(0, 40),
      })
    }
    return out
  })

  // A border the exact colour of what it sits on was drawn and cannot be seen.
  // That is a fault at any size, on anything.
  const invisible = edges.filter((e) => e.ratio < 1.02)
  check(invisible.length === 0,
    `${path.padEnd(42)} no border is drawn in its own background colour` +
    (invisible.length ? ` — ${invisible.length}, e.g. ${invisible[0].color} on ${invisible[0].on} (.${invisible[0].cls})` : ''))
  // 1.02–3:1 is reported, never failed — the same call the app's rig makes.
  // WCAG 1.4.11 asks 3:1 of a CONTROL's edge, but this shop's hairlines are
  // deliberately quiet and raising them changes the look of every screen.
  // That is the owner's decision, not this file's.
  const faint = edges.filter((e) => e.ratio >= 1.02 && e.ratio < 3)
  if (faint.length) faintEdges.set(path, faint)

  let bad = 0
  for (const r of rows) {
    if (r.photo) { skipped++; continue }
    checked++
    if (r.ratio < r.need) {
      bad++; fails++
      worst.push(`${path}  ${r.ratio.toFixed(2)}:1 (needs ${r.need})  ${r.fg} on ${r.bg}  "${r.text}"  .${r.cls}`)
    }
  }
  console.log(`${bad ? 'FAIL' : 'ok  '} ${path.padEnd(42)} ${rows.length - bad} readable, ${bad} under AA, ${edges.length} borders`)
}

if (faintEdges.size) {
  console.log('\n--- hairlines under the 3:1 WCAG asks of a control edge (reported, not failed) ---')
  const all = [...faintEdges.values()].flat()
  const byPair = new Map()
  for (const e of all) {
    const k = `${e.color} on ${e.on}`
    byPair.set(k, (byPair.get(k) ?? 0) + 1)
  }
  for (const [pair, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    const one = all.find((e) => `${e.color} on ${e.on}` === pair)
    console.log(`  ${String(one.ratio).padStart(5)}:1  ${pair}  x${n}`)
  }
  console.log(`  ${all.length} borders in total, across ${faintEdges.size} pages`)
}

if (worst.length) {
  console.log('\n--- every run of text under AA ---')
  for (const w of worst.slice(0, 40)) console.log('  ' + w)
}
console.log(`\n${checked} runs of text measured in the ${THEME} theme, ${skipped} skipped over photographs`)
console.log(fails ? `${fails} under AA` : 'all ok — every readable pair meets AA')
await b.close()
process.exit(fails ? 1 : 0)
