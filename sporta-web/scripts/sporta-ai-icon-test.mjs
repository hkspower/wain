// The Sporta AI icon (brand/sporta-ai/) — geometry, files and README — rig-free.
//
//   node scripts/sporta-ai-icon-test.mjs            run the checks
//   node scripts/sporta-ai-icon-test.mjs --preview  also (re)write brand/sporta-ai/preview.png
//   DIR=/path/to/another/sporta-ai node scripts/sporta-ai-icon-test.mjs
//     the same suite against another copy of the folder — how a mutation check
//     proves the suite FAILS on the first version of the icon (the four-point
//     "AI sparkle" whose bounding box sat 1.25 units high in its viewBox).
//
// Not `npm run` anything that needs the shared test rig: no database, no PHP, no
// dev server, no network. The geometry is checked WITHOUT a browser by flattening
// the SVG paths here and filling them with the nonzero rule, so the numbers do not
// depend on a renderer. A real Chromium (CHROMIUM_PATH, default
// /opt/pw-browsers/chromium) cross-checks the cut-out and the README's CSS rule on
// the repo's own launcher markup; without one those sections are SKIPPED, loudly.
//
// What it holds (each line is a defect found in review of the first version):
//   SHAPE     the mark is a stopwatch whose dial carries the Sporta S swoosh, NOT a
//             sparkle: no four-point star path, S ink is large enough to read at
//             16 px, the swoosh is wound the opposite way to the disc so the mono
//             file really is a cut-out.
//   RIM       the S never comes closer to the dial rim than ~1.2 px at 16 px, so
//             the orange ring survives anti-aliasing on every ground.
//   CENTRE    the ink's bounding box is centred in the 48 x 48 viewBox on both axes
//             (the first version was 1.25 units high).
//   FILES     six-plus SVGs: fills only (no stroke, text, filter, style, href), the
//             brand colours exactly, master == concept D, the three variants share
//             one pair of paths, mono == both paths in ONE path with currentColor.
//   README    its data URI is the on-dark file, its JSX snippet carries the real
//             paths, no path outside the repo, every file it names exists, its
//             selectors match the repo's own translations, and its contrast table
//             matches the WCAG arithmetic.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const DIR = path.resolve(process.env.DIR ?? path.join(WEB, '..', 'brand', 'sporta-ai'))
const PREVIEW = process.argv.includes('--preview')

let fails = 0
let skipped = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => {
  fails++
  console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`)
}
const skip = (n, d = '') => {
  skipped++
  console.log(`SKIP ${n}${d ? `  — ${d}` : ''}`)
}
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (s) => console.log(`\n== ${s}`)
const f2 = (n) => (Math.round(n * 100) / 100).toString()

const read = (name) => {
  try {
    return readFileSync(path.join(DIR, name), 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// A small SVG path engine. The icon files are written with ABSOLUTE commands
// M L H V C Q A Z only (asserted below), which is all this needs.
// ---------------------------------------------------------------------------
const CMD_RE = /([MLHVCQAZ])([^MLHVCQAZ]*)/g
const nums = (s) => (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number)

function pathCommands(d) {
  const out = []
  for (const m of d.matchAll(CMD_RE)) out.push([m[1], nums(m[2])])
  return out
}

/** Flatten a path into subpaths: arrays of [x, y] (always closed for filling). */
function flatten(d) {
  const subs = []
  let cur = null
  let x = 0
  let y = 0
  const push = (px, py) => {
    cur.push([px, py])
    x = px
    y = py
  }
  for (const [c, a] of pathCommands(d)) {
    if (c === 'M') {
      cur = []
      subs.push(cur)
      push(a[0], a[1])
    } else if (c === 'L') push(a[0], a[1])
    else if (c === 'H') push(a[0], y)
    else if (c === 'V') push(x, a[0])
    else if (c === 'Q') {
      const [x0, y0] = [x, y]
      for (let i = 1; i <= 24; i++) {
        const t = i / 24
        const u = 1 - t
        cur.push([u * u * x0 + 2 * u * t * a[0] + t * t * a[2], u * u * y0 + 2 * u * t * a[1] + t * t * a[3]])
      }
      x = a[2]
      y = a[3]
    } else if (c === 'C') {
      const [x0, y0] = [x, y]
      for (let i = 1; i <= 24; i++) {
        const t = i / 24
        const u = 1 - t
        cur.push([
          u * u * u * x0 + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4],
          u * u * u * y0 + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5],
        ])
      }
      x = a[4]
      y = a[5]
    } else if (c === 'A') {
      // circular arcs only (rx == ry, no rotation): endpoint -> centre form, SVG 1.1 F.6.5
      const [rx, , , large, sweep, ex, ey] = a
      const dx = (x - ex) / 2
      const dy = (y - ey) / 2
      const co = Math.sqrt(Math.max(0, (rx * rx - dx * dx - dy * dy) / (dx * dx + dy * dy))) * (large === sweep ? -1 : 1)
      const cxp = co * dy
      const cyp = -co * dx
      const cx = cxp + (x + ex) / 2
      const cy = cyp + (y + ey) / 2
      let t0 = Math.atan2(y - cy, x - cx)
      let t1 = Math.atan2(ey - cy, ex - cx)
      if (sweep && t1 < t0) t1 += 2 * Math.PI
      if (!sweep && t1 > t0) t1 -= 2 * Math.PI
      if (Math.abs(t1 - t0) < 1e-9) t1 = t0 + (sweep ? 1 : -1) * 2 * Math.PI
      for (let i = 1; i <= 90; i++) {
        const t = t0 + ((t1 - t0) * i) / 90
        cur.push([cx + rx * Math.cos(t), cy + rx * Math.sin(t)])
      }
      x = ex
      y = ey
    } else if (c === 'Z') {
      x = cur[0][0]
      y = cur[0][1]
    }
  }
  return subs
}

/** Shoelace area; positive = clockwise on screen (y grows downward). */
const signedArea = (poly) => {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    s += ax * by - bx * ay
  }
  return s / 2
}

const RES = 8 // samples per viewBox unit
const SIZE = 48 * RES
/** Fill with the NONZERO rule at pixel centres; returns a Uint8Array(SIZE*SIZE). */
function fill(d) {
  const subs = flatten(d)
  const img = new Uint8Array(SIZE * SIZE)
  for (let row = 0; row < SIZE; row++) {
    const yy = (row + 0.5) / RES
    const xs = []
    for (const poly of subs) {
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i]
        const [bx, by] = poly[(i + 1) % poly.length]
        if (ay === by) continue
        if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) {
          xs.push([ax + ((yy - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1])
        }
      }
    }
    xs.sort((p, q) => p[0] - q[0])
    let wn = 0
    for (let i = 0; i < xs.length - 1; i++) {
      wn += xs[i][1]
      if (wn !== 0) {
        const c0 = Math.max(0, Math.ceil(xs[i][0] * RES - 0.5))
        const c1 = Math.min(SIZE - 1, Math.ceil(xs[i + 1][0] * RES - 0.5) - 1)
        for (let c = c0; c <= c1; c++) img[row * SIZE + c] = 1
      }
    }
  }
  return img
}
const count = (img) => img.reduce((s, v) => s + v, 0)
const bboxOf = (poly) => {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

// ---------------------------------------------------------------------------
// 1. Files
// ---------------------------------------------------------------------------
head('FILES  the six SVGs are plain filled paths')
const FILES = {
  master: 'sporta-ai-icon.svg',
  onDark: 'sporta-ai-icon-on-dark.svg',
  mono: 'sporta-ai-icon-mono.svg',
  conceptD: 'concept-d.svg',
}
const ALL = readdirSync(DIR).filter((n) => n.endsWith('.svg'))
is(ALL.length >= 6, `${ALL.length} SVG files in the folder`, ALL.join(', '))
const svgs = {}
for (const [k, n] of Object.entries(FILES)) svgs[k] = read(n)
for (const n of ALL) {
  const s = read(n)
  const hits = ['stroke', 'href', '<text', '<filter', '<style', '<script', '<image', '<use', 'onload', '<foreignObject']
    .filter((w) => s.toLowerCase().includes(w.toLowerCase()))
  is(hits.length === 0, `${n}: fills only (no ${hits.join(', ') || 'stroke/text/filter/style/href'})`)
  is(/viewBox="0 0 48 48"/.test(s) && s.includes('xmlns="http://www.w3.org/2000/svg"'), `${n}: viewBox 0 0 48 48, namespace set`)
}
try {
  execFileSync('xmllint', ['--noout', ...ALL.map((n) => path.join(DIR, n))], { stdio: 'pipe' })
  ok('xmllint: every SVG is well-formed XML')
} catch (e) {
  if (e.code === 'ENOENT') skip('xmllint not installed')
  else bad('xmllint', String(e.stderr ?? e.message).slice(0, 200))
}

const pathsOf = (s) => [...s.matchAll(/<path\s+fill="([^"]+)"\s+d="([^"]+)"\s*\/>/g)].map((m) => ({ fill: m[1], d: m[2] }))
const master = pathsOf(svgs.master ?? '')
const onDark = pathsOf(svgs.onDark ?? '')
const mono = pathsOf(svgs.mono ?? '')
is(master.length === 2 && onDark.length === 2, 'master and on-dark carry exactly two paths (dial body, swoosh)')
is(mono.length === 1 && mono[0].fill === 'currentColor', 'mono is ONE path filled currentColor')
is(
  master[0]?.fill === '#E0561C' && master[1]?.fill === '#171A1E',
  'master colours: body #E0561C (light grounds), swoosh #171A1E',
)
is(
  onDark[0]?.fill === '#FF7B17' && onDark[1]?.fill === '#171A1E',
  'on-dark colours: body #FF7B17 (bright orange on charcoal), swoosh #171A1E',
)
const bodyD = master[0]?.d ?? ''
const swooshD = master[1]?.d ?? ''
is(onDark[0]?.d === bodyD && onDark[1]?.d === swooshD, 'master and on-dark share ONE pair of paths (only the body colour differs)')
is(mono[0]?.d === bodyD + swooshD, 'mono path is the body followed by the swoosh, byte for byte')
is(svgs.conceptD === svgs.master, 'concept-d.svg is byte-identical to the master (D is the chosen concept)')
const conceptC = read('concept-c.svg') ?? ''
is(conceptC !== svgs.master, 'concept-c.svg (the four-point spark) is no longer the master')
// A four-point star is mirror-symmetric; the Sporta S is not (it is a half-turn shape like the logo).
// Overlap (intersection over union) of the swoosh with its own left-right mirror: 1.0 for the old spark.
{
  const swm = fill(swooshD)
  let inter = 0
  let uni = 0
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const a = swm[r * SIZE + c]
      const b = swm[r * SIZE + (SIZE - 1 - c)]
      if (a && b) inter++
      if (a || b) uni++
    }
  }
  is(!(bodyD + swooshD).includes('C23.3 20.5 21 24 10 26'), 'the old spark path is gone from the master')
  is(inter / uni < 0.75, `the swoosh is not mirror-symmetric like a star (self-overlap ${f2(inter / uni)} < 0.75; the spark was 1.00)`)
}
const cmds = new Set(pathCommands(bodyD + swooshD).map((c) => c[0]))
is([...cmds].every((c) => 'MLHVCQAZ'.includes(c)) && !/[a-z]/.test(bodyD.replace(/e-?\d/gi, '') + swooshD), 'paths use absolute M L H V C Q A Z only')

// ---------------------------------------------------------------------------
// 2. Geometry
// ---------------------------------------------------------------------------
head('SHAPE / RIM / CENTRE  measured on the flattened paths (no browser)')
const bodySubs = flatten(bodyD)
const swooshSubs = flatten(swooshD)
const disc = bodySubs[0]
const dBox = bboxOf(disc)
const R = (dBox.x1 - dBox.x0) / 2
const DCX = (dBox.x0 + dBox.x1) / 2
const DCY = (dBox.y0 + dBox.y1) / 2
is(Math.abs(R - 18) < 0.05 && Math.abs(DCX - 24) < 0.05, `dial is a circle r=${f2(R)} centred on x=${f2(DCX)}`, `centre y=${f2(DCY)}`)
const ink = bodySubs.flat()
const iBox = bboxOf(ink)
const inkCx = (iBox.x0 + iBox.x1) / 2
const inkCy = (iBox.y0 + iBox.y1) / 2
is(Math.abs(inkCy - 24) <= 0.25, `ink bounding box is vertically centred in the viewBox`, `y ${f2(iBox.y0)}..${f2(iBox.y1)}, centre ${f2(inkCy)} (viewBox centre 24)`)
is(Math.abs(inkCx - 24) <= 0.25, `ink bounding box is horizontally centred in the viewBox`, `x ${f2(iBox.x0)}..${f2(iBox.x1)}, centre ${f2(inkCx)}`)
is(
  Math.min(iBox.x0, iBox.y0, 48 - iBox.x1, 48 - iBox.y1) >= 1.5,
  'nothing within 1.5 units of the viewBox edge (no clipping when a host crops the box)',
  `margins ${f2(iBox.x0)} / ${f2(iBox.y0)} / ${f2(48 - iBox.x1)} / ${f2(48 - iBox.y1)}`,
)
is(bodySubs.length >= 3, `body has ${bodySubs.length} subpaths: dial, crown, stem${bodySubs.length > 3 ? ', side pusher (reads as a stopwatch, not a money bag)' : ''}`)
is(bodySubs.length >= 4, 'a side pusher is drawn (a round disc with a neck and an S alone reads as a money bag)')

// Winding: the swoosh is a HOLE in the mono file only if wound the other way.
const discArea = signedArea(disc)
const swArea = signedArea(swooshSubs[0])
is(swooshSubs.length === 1, 'the swoosh is one closed outline')
is(discArea > 0 && swArea < 0, 'swoosh winds opposite to the dial (a true cut-out under nonzero)', `dial ${f2(discArea)}, swoosh ${f2(swArea)}`)

const swPts = swooshSubs.flat()
const maxR = Math.max(...swPts.map(([x, y]) => Math.hypot(x - DCX, y - DCY)))
const rim = R - maxR
is(
  rim * (16 / 48) >= 1.2,
  `orange ring never thinner than 1.2 px at 16 px (rim ${f2(rim)} units = ${f2((rim * 16) / 48)} px)`,
  `swoosh reaches r=${f2(maxR)} of ${f2(R)}`,
)
// every direction, not just the four axes: bin the swoosh outline by angle
let worst = Infinity
for (const [x, y] of swPts) worst = Math.min(worst, R - Math.hypot(x - DCX, y - DCY))
is(Math.abs(worst - rim) < 1e-9 && worst >= 3.5, 'rim clearance holds in every direction (min over the whole outline)', `${f2(worst)} units`)
const sBox = bboxOf(swPts)
is(
  Math.abs((sBox.x0 + sBox.x1) / 2 - DCX) < 0.6 && Math.abs((sBox.y0 + sBox.y1) / 2 - DCY) < 0.6,
  'swoosh is centred on the dial',
  `swoosh centre ${f2((sBox.x0 + sBox.x1) / 2)}, ${f2((sBox.y0 + sBox.y1) / 2)} vs dial ${f2(DCX)}, ${f2(DCY)}`,
)

// Pixel work on the nonzero fill.
const body = fill(bodyD)
const sw = fill(swooshD)
const monoImg = fill(mono[0]?.d ?? '')
const swArea16 = (count(sw) / (RES * RES))
is(swArea16 / (Math.PI * R * R) >= 0.15, `swoosh covers ${f2((100 * swArea16) / (Math.PI * R * R))}% of the dial (>= 15% so it survives 16 px)`)
let thick = 0
{
  // thickest part of the stroke: largest inscribed disc, by brute force on a coarse grid
  const step = RES / 2
  for (let row = 0; row < SIZE; row += step) {
    for (let col = 0; col < SIZE; col += step) {
      if (!sw[row * SIZE + col]) continue
      let r = 0
      outer: for (r = 1; r < 8 * RES; r++) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI
          const px = Math.round(col + r * Math.cos(a))
          const py = Math.round(row + r * Math.sin(a))
          if (px < 0 || py < 0 || px >= SIZE || py >= SIZE || !sw[py * SIZE + px]) break outer
        }
      }
      thick = Math.max(thick, (2 * r) / RES)
    }
  }
}
is(thick * (16 / 48) >= 1.8, `thickest stroke ${f2(thick)} units = ${f2((thick * 16) / 48)} px at 16 px (>= 1.8 px)`)

let mismatch = 0
let holeCovered = 0
for (let i = 0; i < body.length; i++) {
  const want = body[i] && !sw[i] ? 1 : 0
  if (monoImg[i] !== want) mismatch++
  if (sw[i] && monoImg[i]) holeCovered++
}
is(mismatch === 0, 'mono fill == body minus swoosh, pixel for pixel (nonzero rule, 8x supersampled)', `${mismatch} differing samples`)
is(holeCovered === 0, 'no swoosh sample is covered in the mono file (nothing left inside the cut-out)')
let outside = 0
for (let i = 0; i < sw.length; i++) if (sw[i] && !body[i]) outside++
is(outside === 0, 'the swoosh lies wholly on the dial body')

// ---------------------------------------------------------------------------
// 3. README
// ---------------------------------------------------------------------------
head('README  every claim it makes is checked against the files')
const readme = read('README.md') ?? ''
is(readme.length > 0, 'README.md present')
is(!/\/tmp\//.test(readme) && !/\/home\//.test(readme), 'README names no path outside the repo (/tmp, /home)')
const named = [...readme.matchAll(/`((?:[\w.-]+\/)*[\w.-]+\.(?:svg|png))`/g)].map((m) => m[1])
const missing = [...new Set(named)].filter((n) => !n.includes('/') && !existsSync(path.join(DIR, n)))
is(missing.length === 0, `every bare file name the README mentions exists in the folder (${new Set(named).size} names)`, missing.join(', '))
is(/spark[^\n]*\(rejected\)|rejected[^\n]*spark/i.test(readme), 'README marks the spark concept as rejected')
is(/Gemini|generic .*spark|AI sparkle/i.test(readme), 'README says why the spark was dropped (generic sparkle)')

const uriMatch = readme.match(/content: url\("(data:image\/svg\+xml,[^"]+)"\)/)
is(!!uriMatch, 'README carries the data URI for the live apply step')
if (uriMatch) {
  const decoded = decodeURIComponent(uriMatch[1].replace('data:image/svg+xml,', ''))
  const want = (svgs.onDark ?? '').trim().replace(/"/g, "'")
  is(decoded === want, 'README data URI decodes to exactly sporta-ai-icon-on-dark.svg')
  is(!/[<>#]/.test(uriMatch[1].replace('data:image/svg+xml,', '')), 'data URI is percent-encoded for < > # (valid inside CSS url())')
}
const jsx = readme.match(/export function SportaAiIcon[\s\S]*?\n```/)
is(!!jsx, 'README carries the SportaAiIcon JSX snippet')
if (jsx) {
  const jd = [...jsx[0].matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({ fill: m[1], d: m[2] }))
  is(jd.length === 2 && jd[0].d === onDark[0]?.d && jd[1].d === onDark[1]?.d, 'JSX snippet carries the real on-dark paths (not placeholders)')
  is(jd[0]?.fill === '#FF7B17' && jd[1]?.fill === '#171A1E', 'JSX snippet uses the on-dark colours')
}

// selectors and line numbers vs the repo's own source
const tr = readFileSync(path.join(WEB, 'src/i18n/translations.js'), 'utf8')
const asst = readFileSync(path.join(WEB, 'src/components/Assistant.jsx'), 'utf8').split('\n')
const panel = readFileSync(path.join(WEB, 'src/components/AssistantPanel.jsx'), 'utf8').split('\n')
is(tr.includes("open: 'افتح مساعد سبورتا'") && readme.includes('button[aria-label="افتح مساعد سبورتا"]'), 'Arabic launcher selector matches translations.js (assistant.open)')
is(tr.includes("open: 'Open the Sporta assistant'") && readme.includes('button[aria-label="Open the Sporta assistant"]'), 'English launcher selector matches translations.js (assistant.open)')
is((tr.match(/title: 'سبورتا AI'/g) ?? []).length >= 2 && readme.includes('[role="dialog"][aria-label="سبورتا AI"] > header img'), 'panel selector matches translations.js (assistant.title, both languages)')
const lineOf = (re) => Number((readme.match(re) ?? [])[1])
const launcherLine = lineOf(/Assistant\.jsx`\s*:\s*(\d+)/)
const panelLine = lineOf(/AssistantPanel\.jsx`\s*:\s*(\d+)/)
is(asst[launcherLine - 1]?.includes('/favicon-192.png'), `README line number for the launcher image is right (Assistant.jsx:${launcherLine})`)
is(panel[panelLine - 1]?.includes('/favicon-192.png'), `README line number for the panel image is right (AssistantPanel.jsx:${panelLine})`)
const htaccess = readFileSync(path.join(WEB, 'public/.htaccess'), 'utf8')
is(/img-src[^"\n]*'self'[^"\n]*data:/.test(htaccess), "the CSP lets a data: image through (img-src 'self' data:), so the live CSS rule needs no new file")
is(/NOT measured|not measured/i.test(readme), 'README still says the live launcher markup was NOT measured (it was not)')

// WCAG contrast arithmetic vs the table
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const cr = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const pairs = [
  ['#E0561C', '#FFFFFF', 3.81],
  ['#E0561C', '#171A1E', 4.59],
  ['#FF7B17', '#171A1E', 6.73],
  ['#E0561C', '#E2DBCE', 2.77],
]
for (const [a, b, want] of pairs) {
  const got = cr(a, b)
  is(Math.abs(got - want) < 0.006 && readme.includes(String(want)), `contrast ${a} / ${b} = ${f2(got)} and the README says ${want}`)
}
is(cr('#E0561C', '#E2DBCE') < 3 && /beige[\s\S]{0,200}mono/i.test(readme), 'on beige the README sends people to the mono file (full colour is below 3:1)')

// ---------------------------------------------------------------------------
// 4. Browser cross-check (optional)
// ---------------------------------------------------------------------------
let chromium = null
try {
  chromium = (await import('playwright')).chromium
} catch {
  /* handled below */
}
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
let browser = null
if (chromium) {
  try {
    browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
  } catch (e) {
    browser = null
  }
}

async function pixels(page, clip) {
  const png = await page.screenshot({ clip, omitBackground: false })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return { w: c.width, h: c.height, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) }
  }, png.toString('base64'))
}
const px = (p, x, y) => {
  const i = (Math.round(y) * p.w + Math.round(x)) * 4
  return p.data.slice(i, i + 4)
}
const near = (a, hex, tol = 6) => [1, 3, 5].every((k, j) => Math.abs(a[j] - parseInt(hex.slice(k, k + 2), 16)) <= tol)

head('BROWSER  the mono cut-out, the 16 px ring and the README CSS rule in real Chromium')
if (!browser) {
  skip('Chromium not available', `set CHROMIUM_PATH (tried ${exe}); the geometry checks above do not need it`)
} else {
  const page = await browser.newPage({ viewport: { width: 700, height: 500 }, deviceScaleFactor: 1 })
  const uri = (s) => 'data:image/svg+xml,' + encodeURIComponent(s)
  // mono on a charcoal ground in orange text colour: the swoosh must show the GROUND
  await page.setContent(
    `<body style="margin:0;background:#171A1E"><div style="color:#FF7B17;width:192px;height:192px">${svgs.mono?.replace('width="48" height="48"', 'width="192" height="192"')}</div></body>`,
  )
  const m = await pixels(page, { x: 0, y: 0, width: 192, height: 192 })
  const S = 192 / 48
  // a point certainly inside the swoosh: its first outline vertex nudged inward is awkward, so scan for one
  // a point well inside the ink: swoosh at +-1.5 units in all four directions around it
  let inside = null
  const E = Math.round(1.5 * RES)
  for (let row = E; row < SIZE - E && !inside; row += 4)
    for (let col = E; col < SIZE - E; col += 4)
      if (sw[row * SIZE + col] && sw[row * SIZE + col - E] && sw[row * SIZE + col + E] && sw[(row - E) * SIZE + col] && sw[(row + E) * SIZE + col]) {
        inside = [col / RES, row / RES]
        break
      }
  is(inside && near(px(m, inside[0] * S, inside[1] * S), '#171A1E'), 'mono: the swoosh is cut out (a sample well inside it shows the ground colour)', inside ? `at ${f2(inside[0])}, ${f2(inside[1])}` : '')
  is(near(px(m, DCX * S - 10 * S, DCY * S), '#FF7B17'), 'mono: the dial body beside the swoosh is the text colour')

  // the 16 px ring: render at 16 px and read the horizontal row through the dial centre
  await page.setContent(
    `<body style="margin:0;background:#171A1E"><img id="i" width="16" height="16" style="display:block" src="${uri((svgs.onDark ?? '').replace(/width="48" height="48"/, 'width="16" height="16"'))}"></body>`,
  )
  await page.waitForFunction(() => document.getElementById('i').complete)
  const small = await pixels(page, { x: 0, y: 0, width: 16, height: 16 })
  const row = Math.round((DCY * 16) / 48)
  const orange = (c) => c[0] > 200 && c[1] > 90 && c[2] < 80
  let leftEdge = -1
  let rightEdge = -1
  for (let x = 0; x < 16; x++) if (orange(px(small, x, row))) { if (leftEdge < 0) leftEdge = x; rightEdge = x }
  // between the rim and the swoosh there must be at least one fully orange pixel on each side
  let inkSeen = false
  let ringLeft = 0
  let ringRight = 0
  for (let x = leftEdge; x <= rightEdge; x++) {
    const c = px(small, x, row)
    if (!orange(c) && c[0] < 120) inkSeen = true
    else if (orange(c) && !inkSeen) ringLeft++
  }
  inkSeen = false
  for (let x = rightEdge; x >= leftEdge; x--) {
    const c = px(small, x, row)
    if (!orange(c) && c[0] < 120) inkSeen = true
    else if (orange(c) && !inkSeen) ringRight++
  }
  is(ringLeft >= 1 && ringRight >= 1, 'on-dark at 16 px: a solid orange pixel on each side of the swoosh on the centre row (the ring is not broken)', `left ${ringLeft}, right ${ringRight}`)
  let ink16 = 0
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = px(small, x, y); if (c[0] > 20 && c[0] < 90 && c[2] < 90) ink16++ }
  is(ink16 >= 10, 'on-dark at 16 px: the swoosh leaves at least 10 charcoal-ish pixels inside the dial', `${ink16}`)

  // README CSS rule on the repo's own launcher / panel markup
  const css = (readme.match(/```css\n([\s\S]*?)```/) ?? [])[1] ?? ''
  const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#FF7B17"/></svg>')
  const markup = `
    <button aria-label="افتح مساعد سبورتا" style="display:flex;background:#171A1E;border:0;padding:8px"><img id="ar" src="${favicon}" alt="" width="192" height="192" style="width:20px;height:20px"></button>
    <button aria-label="Open the Sporta assistant" style="display:flex;background:#171A1E;border:0;padding:8px"><img id="en" src="${favicon}" alt="" width="192" height="192" style="width:20px;height:20px"></button>
    <div role="dialog" aria-label="سبورتا AI"><header style="background:#171A1E;padding:8px"><img id="pn" src="${favicon}" alt="" width="192" height="192" style="width:28px;height:28px"></header></div>`
  async function shotOf(id, withCss) {
    await page.setContent(`<body style="margin:0;background:#fff">${withCss ? `<style>${css}</style>` : ''}${markup}</body>`)
    await page.waitForTimeout(150)
    const r = await page.evaluate((i) => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }, id)
    const p = await pixels(page, r)
    let charcoal = 0
    for (let i = 0; i < p.data.length; i += 4) if (near(p.data.slice(i, i + 4), '#171A1E', 12)) charcoal++
    return { r, charcoal }
  }
  if (!css) bad('README has a ```css block with the live rule')
  else {
    for (const [id, label, size] of [['ar', 'Arabic launcher', 20], ['en', 'English launcher', 20], ['pn', 'panel header', 28]]) {
      const withRule = await shotOf(id, true)
      const without = await shotOf(id, false)
      is(without.charcoal === 0, `${label}: WITHOUT the rule the old image is shown (mutation: no charcoal swoosh pixels)`)
      is(withRule.charcoal > 6 && withRule.r.width === size, `${label}: WITH the rule the new mark replaces it at ${size}px`, `${withRule.charcoal} swoosh pixels`)
    }
  }
  if (PREVIEW) {
    const bgs = [['#FFFFFF', 'master', '#E0561C'], ['#171A1E', 'onDark', '#FF7B17'], ['#E2DBCE', 'mono', '#171A1E'], ['#E0561C', 'mono', '#171A1E']]
    const sizes = [16, 20, 24, 32, 48, 96]
    const rows = bgs.map(([bg, key, color]) => {
      const svg = svgs[key]
      const cells = sizes.map((s) => `<img width="${s}" height="${s}" src="${uri(svg.replace('currentColor', color).replace(/width="48" height="48"/, `width="${s}" height="${s}"`))}">`).join('')
      return `<div style="display:flex;align-items:flex-end;gap:16px;padding:12px 16px;background:${bg}">${cells}<span style="font:11px sans-serif;color:${bg === '#171A1E' || bg === '#E0561C' ? '#fff' : '#171A1E'}">${key} on ${bg}</span></div>`
    })
    await page.setViewportSize({ width: 560, height: 4 * 124 })
    await page.setContent(`<body style="margin:0">${rows.join('')}</body>`)
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(DIR, 'preview.png'), fullPage: true })
    ok('preview.png written', 'all treatments, 16 to 96 px, rendered from these exact files')
  }
  await browser.close()
}
if (PREVIEW && !browser) bad('--preview needs Chromium (set CHROMIUM_PATH)')

console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}${skipped ? `  (${skipped} skipped)` : ''}`)
process.exit(fails === 0 ? 0 : 1)
