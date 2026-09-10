/**
 * Contrast that is TOO HIGH — the check nothing else here does.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/glare-audit.mjs
 *   THEME=light node scripts/glare-audit.mjs
 *
 * Every contrast rig in this repo asks whether a pair reaches a floor: 4.5:1
 * for body text, 3:1 for large, 3:1 for a control's edge. None of them has an
 * opinion about a pair that goes far past it, and on a DARK screen that is a
 * real problem with a name.
 *
 * WHY A CEILING EXISTS AT ALL. Pure white on near-black is about 18:1, and on
 * black 21:1 — the maximum the sRGB gamut can produce. At that separation the
 * light from the glyphs bleeds into the dark around them: the strokes look
 * furred, the counters fill in, and the text appears to vibrate. It is called
 * halation, it is worse for readers with astigmatism (a large minority), and
 * it is why Material Design puts dark-theme body text at 87% white rather than
 * 100%, and why nearly every considered dark interface does something similar.
 * It is not a WCAG failure — WCAG has no ceiling — which is exactly why it
 * needs its own check rather than waiting to be caught by one of the others.
 *
 * IT IS A DARK-THEME QUESTION. Black on white at 21:1 is the most legible
 * combination there is and has been the default of printed text for five
 * centuries; the light theme is measured and printed here for completeness,
 * but nothing is failed on it. The ceiling applies where the glyphs are the
 * bright thing.
 *
 * Two thresholds, and the reasoning for each is in the code below.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const APP = process.env.APP ?? 'http://127.0.0.1:4173'
const THEME = process.env.THEME ?? 'dark'

const PAGES = [
  ['site', BASE, '/'], ['site', BASE, '/shop'], ['site', BASE, '/cart'],
  ['site', BASE, '/checkout'], ['site', BASE, '/about'], ['site', BASE, '/contact'],
  ['site', BASE, '/returns'], ['site', BASE, '/returns/request'], ['site', BASE, '/card'],
  ['site', BASE, '/product/cloudsoft-jacket-army-green'],
  ['app ', APP, '/'], ['app ', APP, '/shop'], ['app ', APP, '/cart'],
  ['app ', APP, '/account'], ['app ', APP, '/exchange'],
]

/**
 * GLARE, at 18:1. That is pure white, or within a shade of it, on this shop's
 * near-black. Nothing needs to be that bright and nothing here was designed to
 * be: the palette's own body colour is #eaecee on #141619, which is 15.0:1 —
 * chosen, deliberately, to sit below this. A pair at 18 is a #ffffff that
 * escaped the ramp, and that is a fault rather than a preference.
 */
const GLARE = 18
/**
 * HOT, at 15:1. Above the palette's own top pair and worth the owner's eye,
 * but defensible — a heading meant to shout, a badge meant to be found. These
 * are reported and never failed. The line is drawn at the ramp's own maximum
 * on purpose: it makes the question "is this still the palette?" rather than
 * a number invented for the occasion.
 */
const HOT = 15

let fails = 0, measured = 0
const glare = []
const hot = []
const fills = []
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + extra : ''}`)
}

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
  // Tailwind v4 answers getComputedStyle with oklab() and lab(). Paint the
  // colour and read the pixel — and read the alpha from the PIXEL, because
  // getImageData is not premultiplied and dividing the channels by the alpha
  // turns every translucent colour white. That bug lived in site-contrast.mjs
  // for months and is the reason this comment is here.
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
      v = d[3] > 0 ? { rgb: [d[0], d[1], d[2]], a: d[3] / 255 } : null
    }
    _seen.set(s, v)
    return v
  }
  const over = (c, bg) => c.rgb.map((v, i) => v * c.a + bg[i] * (1 - c.a))
  const hex = (c) => '#' + c.slice(0, 3)
    .map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')).join('')

  // THE PAGE'S OWN COLOUR. `getComputedStyle(body).backgroundColor` is
  // rgba(0,0,0,0) on the app — React Native Web paints its own root instead —
  // and reading that as black made every white panel look like 21:1 glare on a
  // black page. Forty-six of them, all imaginary. Walk body then html, and if
  // neither paints anything opaque, the page is whatever the browser puts
  // behind it, which is white.
  const pageColour = () => {
    for (const n of [document.body, document.documentElement]) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a >= 0.85) return c.rgb
    }
    return [255, 255, 255]
  }

  const groundOf = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null      // a photograph
      const c = parse(cs.backgroundColor)
      if (c && c.a >= 0.85) return c.rgb
    }
    return pageColour()
  }

  const out = { text: [], fills: [] }
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') continue

    // --- text: only elements with words of their OWN, or a wrapper is counted
    // once per descendant and one pair reads as twenty.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    if (own) {
      const fg = parse(cs.color)
      const g = groundOf(el)
      if (fg && g && fg.a >= 0.5) {
        const painted = over(fg, g)
        // ONLY WHERE THE TEXT IS THE BRIGHT THING. Halation is light glyphs
        // bleeding into a dark ground; dark text on a light ground is the
        // most legible pairing there is and 21:1 is its normal, correct
        // value. Without this the file fails every light-mode page, which is
        // exactly what it did on its first run.
        const bright = lum(painted) > lum(g)
        out.text.push({
          bright,
          ratio: Math.round(ratio(painted, g) * 100) / 100,
          fg: hex(painted), bg: hex(g),
          size: Math.round(parseFloat(cs.fontSize)),
          weight: cs.fontWeight,
          text: (el.textContent ?? '').trim().slice(0, 30),
        })
      }
    }

    // --- BRIGHT AREAS. A white panel on a dark page is a glare source in a
    // way a white word is not: it is the same luminance over hundreds of times
    // the area, and it is what makes a phone at night painful. Only blocks big
    // enough to matter are counted.
    const own_bg = parse(cs.backgroundColor)
    if (own_bg && own_bg.a >= 0.85 && r.width * r.height > 20000) {
      const page = pageColour()
      {
        const painted = over(own_bg, page)
        const rr = ratio(painted, page)
        // Again only where the PANEL is the bright thing — a dark card on a
        // light page is not a glare source.
        if (rr >= 15 && lum(painted) > lum(page)) {
          out.fills.push({
            ratio: Math.round(rr * 100) / 100,
            color: hex(painted), on: hex(page),
            area: Math.round(r.width * r.height),
            tag: el.tagName.toLowerCase(),
            cls: (el.className?.toString?.() ?? '').slice(0, 40),
          })
        }
      }
    }
  }
  return out
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// colorScheme, not just the website's localStorage key. The app has no such
// key — it reads useColorScheme, i.e. prefers-color-scheme — so setting
// `sporta_theme` moved the website into dark and left the app in light. Every
// app page then came back as dark text on white, which this file duly reported
// as glare. It is not: see the guard below.
const p = await b.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: THEME === 'light' ? 'light' : 'dark',
})

for (const [half, base, path] of PAGES) {
  const where = `${half} ${path}`
  try {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await p.evaluate((t) => localStorage.setItem('sporta_theme', t), THEME)
    await p.goto(base + path, { waitUntil: 'networkidle' })
  } catch (e) {
    check(false, `${where} loads`, String(e).slice(0, 80))
    continue
  }
  await p.waitForTimeout(1100)

  const { text, fills: bright } = await p.evaluate(SCAN)
  measured += text.length
  const lit = text.filter((t) => t.bright).length

  let bad = 0
  for (const t of text) {
    if (!t.bright) continue                 // dark on light: not a ceiling case
    if (t.ratio >= GLARE) { glare.push({ ...t, where }); bad++ }
    else if (t.ratio >= HOT) hot.push({ ...t, where })
  }
  for (const f of bright) fills.push({ ...f, where })

  // Only the dark theme is failed. See the note at the top: black on white is
  // the most legible pairing there is, and a ceiling on it would be nonsense.
  if (THEME === 'dark') {
    const lits = text.filter((t) => t.bright)
    check(bad === 0, `${where.padEnd(40)} ${text.length} runs, ${lit} light-on-dark, brightest ${
      lits.length ? Math.max(...lits.map((t) => t.ratio)).toFixed(1) : '—'}:1`,
      `${bad} at or past ${GLARE}:1`)
  } else {
    console.log(`--   ${where.padEnd(40)} ${text.length} runs, brightest ${
      text.length ? Math.max(...text.map((t) => t.ratio)).toFixed(1) : '—'}:1 (light theme, not judged)`)
  }
}

const list = (title, rows, n = 12) => {
  if (!rows.length) return
  console.log(`\n--- ${title} (${rows.length}) ---`)
  const byPair = new Map()
  for (const r of rows) {
    const k = `${r.ratio}:1  ${r.fg ?? r.color} on ${r.bg ?? r.on}`
    if (!byPair.has(k)) byPair.set(k, { n: 0, eg: r })
    byPair.get(k).n++
  }
  for (const [k, v] of [...byPair.entries()].sort((a, c) => c[1].n - a[1].n).slice(0, n)) {
    console.log(`  ${k}  x${v.n}   e.g. ${v.eg.where} "${v.eg.text ?? v.eg.cls}"`)
  }
}

list(`GLARE — ${GLARE}:1 or more, on a dark page`, glare)
list(`hot — ${HOT}:1 to ${GLARE}:1, reported for the owner's eye`, hot)
list('large bright fills — a panel is a glare source a word is not', fills, 8)

console.log(`\n${measured} runs of text measured in the ${THEME} theme, across ${PAGES.length} pages`)
if (THEME !== 'dark') console.log('the light theme is measured but never failed — see the note at the top')
console.log(fails ? `${fails} pages carry text at or past ${GLARE}:1`
                  : `all ok — nothing on a dark page is brighter than ${GLARE}:1`)
await b.close()
process.exit(fails ? 1 : 0)
