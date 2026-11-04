#!/usr/bin/env node
// FONTS USED WEIGHTS - the guard for "ship only the font weights the site draws".   npm run test:fonts-used
//
//   node scripts/fonts-used-weights-test.mjs                 everything below (about 1 h on a loaded machine; --quick is minutes)
//   node scripts/fonts-used-weights-test.mjs --static-only   layers A, B and the mutants that need no site (no mirror, ~10 min)
//   node scripts/fonts-used-weights-test.mjs --quick         layer C on 8 key states instead of all 35
//   node scripts/fonts-used-weights-test.mjs --write-used    after a FULL crawl, rewrite brand/fonts-original/used-weights.json
//   node scripts/fonts-used-weights-test.mjs --audit         also run scripts/fonts-audit.mjs on the masters and the slim files and compare
//   node scripts/fonts-used-weights-test.mjs --throttle      ...with its slow-network pass (FOUT) as well
//   --resume (continue a stopped site crawl from <report-dir>/states)  --attempts N (loads per state before a difference counts, default 5)  --layers A,B,C,D  --routes home,shop  --no-mutants  --report-dir DIR  --keep  --extra-css a.css,b.css (more stylesheets for the static weight scan)
//   Env: MIRROR (path of the mirror server, default as fonts-audit.mjs) or BASE (an origin, GET only), CHROMIUM_PATH, PAGES (1 or 2),
//        LANGS (ar,en) and WIDTHS (390,1280) as in fonts-audit.mjs.
//
// WHAT IT PROVES, in four layers
//   A FILES    public/fonts is exactly the rebuild of brand/fonts-original + used-weights.json (slim-fonts.mjs --check); every
//              shipped file has the master's glyph count, code points, GSUB/GPOS features and, for Alexandria, a wght axis equal
//              to the used range; every @font-face (repo fonts.css and the compiled stylesheet) names a shipped file and every
//              shipped file is named by one; every preloaded font exists; no stylesheet or script declares a weight under 400
//              (what the trimmed Alexandria cannot draw).
//   B SPECIMEN every glyph of every file, each Alexandria weight in 400-900 and each Plex weight, Latin and Arabic text with
//              kerning, joining and tabular figures, drawn once from the masters and once from the shipped files in the same
//              browser: the screenshots must be byte-identical (otherwise the differing pixels are counted).
//   C SITE     every route and state of the mirror (ar and en, 390 and 1280) is loaded ONCE with the masters and photographed in full;
//              then the SAME document (same DOM, same random choices, same timers) has every @font-face src switched in place to
//              the shipped files and is photographed again: the two pictures must be byte-identical. The per-character text census
//              (which face and which weight really drew each glyph) must be the same for both, must stay inside what the shipped
//              files cover, and must use every shipped file; every face the text needs must be loaded when the picture is taken;
//              no @font-face may end in an error. With --audit, fonts-audit.mjs is run on both sets and the platform fonts, glyph
//              counts, text rectangles (widths) and, with --throttle, the FOUT numbers are compared.
//   D MUTANTS  the checks above must FAIL when the shipped set is wrong: Alexandria cut to 400-700, cut to 500-900, a Plex face
//              missing, an extra file nothing draws, an empty file, and a master swapped for a different weight.
//
// "Drawn weight" is computed per CHARACTER in the page, not read from DevTools: for each text node (plus form values,
// placeholders and ::before/::after text) the element's font-family list is walked against the @font-face rules in the CSSOM, the
// CSS font-matching rule picks the weight group (Plex has 400/600/700 only, so 500 draws 400 and 750/800/850 draw 700; Alexandria
// is variable, so the weight is clamped to the face's range), and the unicode-range picks the file. Every declared font-weight in
// every loaded stylesheet is also resolved against the elements it matches (so :hover/:focus/media-query weights count).
// What it cannot see: text drawn by canvas/images, <option> popups, the live admin's own stylesheets that the capture lacks
// (AdminApp, Returns, Account), and any state that needs a sign-in. The static scan covers the text of every file it can read.
import { chromium } from 'playwright'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, mkdtempSync, copyFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUsed, fontInfo, py } from './slim-fonts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const REPO = path.resolve(WEB, '..')
const ENV = process.env
const ARGV = process.argv.slice(2)
const flag = (n) => ARGV.includes(n)
const opt = (n, d) => { const i = ARGV.indexOf(n); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d }
const list = (s, d) => String(s ?? d).split(',').map((x) => x.trim()).filter(Boolean)

const MASTERS = path.join(REPO, 'brand', 'fonts-original')
const SHIPPED = path.join(WEB, 'public', 'fonts')
const USED_JSON = path.join(MASTERS, 'used-weights.json')
const SCRATCH = '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad'
const MIRROR = ENV.MIRROR || SCRATCH + '/mirror/serve.mjs'
const LANGS = list(ENV.LANGS, 'ar,en')
const WIDTHS = list(ENV.WIDTHS, '390,1280').map(Number)
const PAGES = Math.max(1, Math.min(2, Number(ENV.PAGES || 2)))
const STATIC_ONLY = flag('--static-only')
const QUICK = flag('--quick')
const ATTEMPTS = Number(opt('--attempts', 5))
const NO_MUTANTS = flag('--no-mutants')
const LAYERS = new Set(list(opt('--layers', 'A,B,C,D'), '').map((x) => x.toUpperCase()))
const REPORT = path.resolve(opt('--report-dir', path.join(tmpdir(), 'fonts-used-' + new Date().toISOString().replace(/[:.]/g, '-'))))
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)]
const sha = (b) => createHash('sha256').update(b).digest('hex')
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// ---------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------
const results = []
let section = ''
const head = (s) => { section = s; console.log('\n== ' + s) }
function check(name, ok, detail = '') {
  results.push({ section, name, ok: !!ok, detail })
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (!ok && detail ? '\n          ' + String(detail).split('\n').join('\n          ') : ''))
  return !!ok
}
const note = (s) => console.log('  note  ' + s)

// ---------------------------------------------------------------------------------------------------------------
// Browser, mirror, font proxy
// ---------------------------------------------------------------------------------------------------------------
export const launch = () => {
  const exe = ENV.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(existsSync)
  return chromium.launch({ args: ['--no-sandbox'], ...(exe ? { executablePath: exe } : {}) })
}
export async function startMirror() {
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop() {} }
  const mirrorScript = process.env.MIRROR || MIRROR
  if (!existsSync(mirrorScript)) throw new Error(`no BASE given and the mirror script is missing: ${mirrorScript} (set BASE=https://... or MIRROR=<path to serve.mjs>; or run with --static-only)`)
  const child = spawn(process.execPath, [mirrorScript], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] })
  const base = await new Promise((resolve, reject) => {
    let buf = ''
    const t = setTimeout(() => reject(new Error('the mirror did not report MIRROR_UP within 30s')), 30000)
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/MIRROR_UP (\S+)/); if (m) { clearTimeout(t); resolve(m[1]) } })
    child.on('exit', (c) => reject(new Error('the mirror exited with code ' + c)))
  })
  return { base, stop: () => { try { child.kill('SIGTERM') } catch {} } }
}
// An in-process server: /fonts/<name>.woff2 comes from fontsDir (404 if that file is not there), /__slim/fonts/<name>.woff2 from slimDir (when given),
// everything else from upstream.
// This is how the SAME site is loaded once with the masters and once with the shipped files, with no change to the site.
export function fontProxy(fontsDir, upstream, slimDir = null) {
  const srv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x')
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
      const m = u.pathname.match(/^\/(__slim\/)?fonts\/([^/]+\.woff2)$/)
      if (m && (!m[1] || slimDir)) {
        const f = path.join(m[1] ? slimDir : fontsDir, m[2])
        if (!existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('no such font') }
        const b = readFileSync(f)
        res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': b.length, 'cache-control': 'no-store' })
        return res.end(b)
      }
      const r = await fetch(upstream + req.url, { redirect: 'manual' })
      const b = Buffer.from(await r.arrayBuffer())
      const h = {}
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) h[k] = v })
      res.writeHead(r.status, { ...h, 'content-length': b.length })
      res.end(b)
    } catch (e) { res.writeHead(502); res.end(String(e)) }
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ base: 'http://127.0.0.1:' + srv.address().port, stop: () => srv.close() })))
}

// ---------------------------------------------------------------------------------------------------------------
// LAYER A: files and CSS
// ---------------------------------------------------------------------------------------------------------------
const FILES = ['alexandria-var-arabic', 'alexandria-var-latin', 'plex-400-arabic', 'plex-400-latin', 'plex-600-arabic', 'plex-600-latin', 'plex-700-arabic', 'plex-700-latin'].map((n) => n + '.woff2')

const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
// every weight a stylesheet text declares: font-weight values and the weight token of a font shorthand
export function declaredWeights(cssText) {
  const css = stripCss(cssText)
  const out = []
  for (const m of css.matchAll(/(?:^|[;{\s])font-weight\s*:\s*([^;}!]+)/gi)) out.push(m[1].trim().toLowerCase())
  // font shorthand: [style] [variant] [weight] [stretch] size[/line-height] family. Walk the tokens before the size.
  const PRE = /^(normal|italic|oblique|small-caps|bold|bolder|lighter|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|\d{1,4})$/i
  for (const m of css.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}!]+)/gi)) {
    for (const t of m[1].trim().split(/\s+/)) {
      if (!PRE.test(t)) break // reached the size or the family
      if (/^\d{1,4}$/.test(t) || /^(bold|bolder|lighter)$/i.test(t)) out.push(t.toLowerCase())
    }
  }
  return out
}
// Tailwind's own weight variables (the compiled stylesheet and the repo's build both define them on :root)
const TW = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }
const toNum = (v) => {
  const m = /^var\(--font-weight-([a-z]+)\)$/.exec(v)
  if (m) return TW[m[1]] ?? NaN
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'bold' ? 700 : v === 'normal' ? 400 : NaN
}

function layerA(used, ctx) {
  head('A. FILES AND CSS')
  const shipped = existsSync(SHIPPED) ? readdirSync(SHIPPED).filter((n) => n.endsWith('.woff2')).sort() : []
  const masters = readdirSync(MASTERS).filter((n) => n.endsWith('.woff2')).sort()
  check('shipped font set is the 8 expected files, nothing else', JSON.stringify(shipped) === JSON.stringify([...FILES].sort()), 'shipped: ' + shipped.join(', '))
  check('every shipped file has a master of the same name in brand/fonts-original (and none is missing)', JSON.stringify(shipped) === JSON.stringify(masters), 'masters: ' + masters.join(', '))
  check('no stray file in public/fonts', !existsSync(SHIPPED) || readdirSync(SHIPPED).every((n) => FILES.includes(n)), existsSync(SHIPPED) ? readdirSync(SHIPPED).filter((n) => !FILES.includes(n)).join(', ') : '')

  // rebuild == shipped
  const r = spawnSync(process.execPath, [path.join(HERE, 'slim-fonts.mjs'), '--check'], { encoding: 'utf8', timeout: 20 * 60 * 1000 })
  check('public/fonts is exactly the rebuild of the masters (slim-fonts.mjs --check)', r.status === 0, (r.stdout + r.stderr).trim().split('\n').slice(-12).join('\n'))

  // font-level equality, per file
  for (const n of FILES) {
    if (!existsSync(path.join(SHIPPED, n)) || !existsSync(path.join(MASTERS, n))) continue
    const s = fontInfo(path.join(SHIPPED, n)), m = fontInfo(path.join(MASTERS, n))
    check(`${n}: ${m.glyphs} glyphs, ${m.cmap} code points, features ${m.gsub.concat(m.gpos).join(' ')} all kept`,
      s.glyphs === m.glyphs && JSON.stringify(s.codepoints) === JSON.stringify(m.codepoints) && JSON.stringify(s.gsub) === JSON.stringify(m.gsub) && JSON.stringify(s.gpos) === JSON.stringify(m.gpos),
      `glyphs ${s.glyphs}/${m.glyphs} cmap ${s.cmap}/${m.cmap} gsub ${s.gsub}/${m.gsub} gpos ${s.gpos}/${m.gpos}`)
    check(`${n}: internal name and PostScript name unchanged ("${m.name}")`, s.name === m.name && s.ps === m.ps, `${s.name}/${s.ps} vs ${m.name}/${m.ps}`)
    if (/alexandria/.test(n)) {
      const ax = s.axes?.[0]
      check(`${n}: wght axis ${ax ? ax.min + '-' + ax.max : 'MISSING'} equals the used range ${used.alexandria.min}-${used.alexandria.max}`, ax && ax.tag === 'wght' && ax.min === used.alexandria.min && ax.max === used.alexandria.max, JSON.stringify(s.axes))
    } else {
      check(`${n}: static file, weight class ${s.weightClass}`, !s.axes && s.weightClass === Number(n.match(/plex-(\d+)/)[1]), JSON.stringify(s.axes) + ' class ' + s.weightClass)
    }
  }

  // @font-face blocks: repo + compiled
  const fontsCss = readFileSync(path.join(WEB, 'src/styles/fonts.css'), 'utf8')
  const sources = [['repo src/styles/fonts.css', fontsCss]]
  if (ctx.compiledCss) sources.push(['compiled stylesheet ' + ctx.compiledCssName, ctx.compiledCss])
  for (const [label, css] of sources) {
    const faces = [...stripCss(css).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
      const b = m[1]
      return { family: (b.match(/font-family\s*:\s*([^;]+)/) || [])[1]?.replace(/["']/g, '').trim(), weight: (b.match(/font-weight\s*:\s*([^;]+)/) || [])[1]?.trim(), file: (b.match(/url\(\s*["']?\/fonts\/([^"')]+)["']?\s*\)/) || [])[1] }
    }).filter((f) => f.file)
    const named = new Set(faces.map((f) => f.file))
    check(`${label}: every @font-face names a shipped file (${faces.length} blocks)`, faces.every((f) => shipped.includes(f.file)), faces.filter((f) => !shipped.includes(f.file)).map((f) => f.file).join(', '))
    check(`${label}: every shipped file is named by an @font-face`, shipped.every((f) => named.has(f)), shipped.filter((f) => !named.has(f)).join(', '))
    const alex = faces.filter((f) => /alexandria/i.test(f.file))
    check(`${label}: Alexandria faces declare a weight range that contains the shipped axis ${used.alexandria.min}-${used.alexandria.max}`,
      alex.length > 0 && alex.every((f) => { const [a, b] = (f.weight || '').split(/\s+/).map(Number); return a <= used.alexandria.min && (b ?? a) >= used.alexandria.max }), alex.map((f) => f.weight).join(' | '))
    const plexW = new Set(faces.filter((f) => /plex/i.test(f.file)).map((f) => Number(f.weight)))
    check(`${label}: Plex faces declare exactly the shipped weights ${[...used.plex].sort().join('/')}`, JSON.stringify([...plexW].sort()) === JSON.stringify([...used.plex].sort()), [...plexW].join(','))
  }

  // preloads
  const idx = readFileSync(path.join(WEB, 'index.html'), 'utf8')
  const pre = new Set([...idx.matchAll(/\/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1]))
  for (const sub of ['arabic', 'latin']) for (const p of ['alexandria-var-' + sub, 'plex-400-' + sub]) pre.add(p + '.woff2') // the boot script builds these two names
  check('every font the repo index.html / boot script preloads is a shipped file', [...pre].every((f) => shipped.includes(f)), [...pre].filter((f) => !shipped.includes(f)).join(', '))
  ctx.preloaded = [...pre]
  const bootJs = ctx.bootJs
  if (bootJs) {
    const bp = new Set([...bootJs.matchAll(/\/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1]))
    note(`live boot.js preloads: ${[...bp].join(', ') || '(builds the names at run time)'}`)
  }
}

// STATIC WEIGHT SCAN: every file we can read -> declared weights. A weight under 400 would be drawn lighter by the masters and
// clamped to 400 by the trimmed Alexandria, so any such declaration is a FAIL.
async function staticScan(used, ctx) {
  head('A2. EVERY DECLARED FONT-WEIGHT (static scan)')
  const files = []
  const add = (label, text) => { if (text) files.push([label, text]) }
  for (const f of readdirSync(path.join(WEB, 'src/styles')).filter((n) => n.endsWith('.css'))) add('repo src/styles/' + f, readFileSync(path.join(WEB, 'src/styles', f), 'utf8'))
  for (const f of readdirSync(path.join(WEB, 'public')).filter((n) => n.endsWith('.css'))) add('repo public/' + f, readFileSync(path.join(WEB, 'public', f), 'utf8'))
  add('repo index.html (inline style)', [...readFileSync(path.join(WEB, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'))
  for (const [k, t] of Object.entries(ctx.siteCss || {})) add('site ' + k, t)
  for (const f of list(opt('--extra-css', ''), '')) add('extra ' + path.basename(f), readFileSync(path.resolve(f), 'utf8')) // e.g. the live admin/Account/Returns sheets the capture lacks
  const byVal = new Map()
  for (const [label, text] of files) for (const v of declaredWeights(text)) {
    const n0 = toNum(v.toLowerCase())
    const k = Number.isFinite(n0) && /^var\(/.test(v) ? v.toLowerCase() + ' = ' + n0 : v.toLowerCase()
    if (!byVal.has(k)) byVal.set(k, new Map())
    byVal.get(k).set(label, (byVal.get(k).get(label) || 0) + 1)
  }
  // JS: inline style fontWeight (repo JSX excluding nothing: reading is harmless) and the compiled bundles
  const jsx = []
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(e.name)) jsx.push(p) } }
  walk(path.join(WEB, 'src'))
  const jsWeights = new Map()
  const addJs = (label, text) => { for (const m of text.matchAll(/fontWeight\s*:\s*[`'"]?(\d{3}|bold|bolder|lighter|normal)[`'"]?/g)) { const k = 'js:' + m[1]; if (!jsWeights.has(k)) jsWeights.set(k, new Set()); jsWeights.get(k).add(label) } }
  for (const p of jsx) addJs(path.relative(WEB, p), readFileSync(p, 'utf8'))
  for (const [k, t] of Object.entries(ctx.siteJs || {})) addJs('site ' + k, t)
  const tw = new Map() // Tailwind weight classes in the repo's JSX
  for (const p of jsx) for (const m of readFileSync(p, 'utf8').matchAll(/\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g)) tw.set(m[1], (tw.get(m[1]) || 0) + 1)
  const numOf = (k) => toNum(k.replace(/ = .*$/, ''))
  const rows = [...byVal.entries()].sort((a, b) => (numOf(a[0]) || 1e9) - (numOf(b[0]) || 1e9))
  console.log('  declared value        declarations  in files')
  for (const [v, m] of rows) console.log('  ' + v.padEnd(22) + String([...m.values()].reduce((a, b) => a + b, 0)).padEnd(14) + [...m.keys()].map((k) => k.replace(/^(repo |site )/, '')).slice(0, 4).join(', ') + (m.size > 4 ? ` (+${m.size - 4})` : ''))
  for (const [v, s] of jsWeights) console.log('  ' + v.padEnd(22) + String(s.size).padEnd(14) + [...s].slice(0, 3).join(', '))
  console.log('  Tailwind weight classes in repo JSX: ' + ([...tw.entries()].map(([k, n]) => `font-${k} x${n}`).join(', ') || 'none'))
  const lows = rows.filter(([v]) => numOf(v) < 400 || /^lighter$/.test(v)).map(([v, m]) => `${v} in ${[...m.keys()].join(', ')}`)
  const jsLows = [...jsWeights.keys()].filter((k) => Number(k.slice(3)) < 400).map((k) => `${k} in ${[...jsWeights.get(k)].join(', ')}`)
  const twLows = ['thin', 'extralight', 'light'].filter((c) => tw.has(c)).map((c) => 'font-' + c)
  check(`no stylesheet, inline style or Tailwind class declares a weight under ${used.alexandria.min} (${rows.length} distinct values read in ${files.length} stylesheets and ${jsx.length + Object.keys(ctx.siteJs || {}).length} scripts)`, !lows.length && !jsLows.length && !twLows.length, [...lows, ...jsLows, ...twLows].join('\n'))
  const over = rows.filter(([v]) => numOf(v) > used.alexandria.max).map(([v]) => v)
  check(`no declared weight is above the shipped maximum ${used.alexandria.max}`, !over.length, over.join(', '))
  const vs = files.filter(([, t]) => /font-variation-settings\s*:\s*[^;}]*wght/i.test(stripCss(t))).map(([l]) => l)
  check('no stylesheet sets the wght axis directly with font-variation-settings', !vs.length, vs.join(', '))
  ctx.static = { values: rows.map(([v, m]) => ({ value: v, files: [...m.keys()] })), tailwind: Object.fromEntries(tw) }
}

// ---------------------------------------------------------------------------------------------------------------
// LAYER B: specimen, masters vs shipped, pixel for pixel
// ---------------------------------------------------------------------------------------------------------------
const LAT_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF'
const ARB_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF'

const CPS = new Map()
function specimenHtml(dir, weightsAlex) {
  const b64 = (n) => (existsSync(path.join(dir, n)) ? readFileSync(path.join(dir, n)).toString('base64') : '')
  const face = (fam, w, file, fmtName, range) => `@font-face{font-family:${fam};font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${b64(file)}) format("${fmtName}");unicode-range:${range}}`
  const css = [
    face('SA', '100 900', 'alexandria-var-latin.woff2', 'woff2-variations', LAT_RANGE), face('SA', '100 900', 'alexandria-var-arabic.woff2', 'woff2-variations', ARB_RANGE),
    ...[400, 600, 700].flatMap((w) => [face('SP', w, `plex-${w}-latin.woff2`, 'woff2', LAT_RANGE), face('SP', w, `plex-${w}-arabic.woff2`, 'woff2', ARB_RANGE)]),
  ].join('\n')
  // every code point of the masters (printable only), grouped by script so each line uses one file
  const cps = (n) => (CPS.get(n) || CPS.set(n, fontInfo(path.join(MASTERS, n)).codepoints).get(n)).filter((c) => c > 32 && !(c >= 0x7f && c <= 0x9f) && !(c >= 0x200b && c <= 0x200f) && !(c >= 0x202a && c <= 0x202e) && !(c >= 0x2066 && c <= 0x2069) && c !== 0xfeff && c !== 0xad && c !== 0xa0)
  const str = (a) => a.map((c) => String.fromCodePoint(c)).join(' ')
  const latin = str(cps('plex-400-latin.woff2'))
  const arabic = str(cps('plex-400-arabic.woff2'))
  const alexL = str(cps('alexandria-var-latin.woff2')), alexA = str(cps('alexandria-var-arabic.woff2'))
  const words = 'AVATAR To Ty Wave Fly fi fl ffi 0123456789 1,234.50 KD 12:30 2026-11-04 Sporta Sportswear Nike Adidas Puma'
  const awords = 'سبورتا للملابس الرياضية — تيشيرت إنرجي أحمر وأبيض ١٢٣٤٥٦٧٨٩٠ الإجمالي ٤ قطع د.ك. الحقيبة تسجيل الدخول طلب جديد مُحَمَّد أَلْـحَمْد ﷲ لا إله إلا الله'
  const num = '0123456789 1111 8888 KD 5.000 KD 12.500'
  let body = ''
  for (const w of weightsAlex) {
    body += `<div class="row" style="font-family:SA;font-weight:${w}"><b>Alexandria ${w}</b><p class="s20">${alexL}</p><p class="s20" dir="rtl" lang="ar">${alexA}</p><p class="s16">${words}</p><p class="s16" dir="rtl" lang="ar">${awords}</p><p class="s32" style="font-variant-numeric:tabular-nums">${num}</p><p class="s32">${num}</p></div>`
  }
  for (const w of [400, 500, 600, 650, 700, 800, 900]) {
    body += `<div class="row" style="font-family:SP;font-weight:${w}"><b>Plex ${w}</b><p class="s20">${latin}</p><p class="s20" dir="rtl" lang="ar">${arabic}</p><p class="s16">${words}</p><p class="s16" dir="rtl" lang="ar">${awords}</p><p class="s32">${num}</p></div>`
  }
  return `<!doctype html><meta charset="utf-8"><style>${css}
html{background:#fff;color:#000}body{margin:8px;width:1240px}.row{border-bottom:1px solid #ccc;padding:4px 0}.row b{font:12px sans-serif}p{margin:2px 0;line-height:1.5;word-break:break-all}.s16{font-size:16px}.s20{font-size:20px}.s32{font-size:32px}
*{text-rendering:auto;font-kerning:normal}</style><body>${body}</body>`
}

async function shoot(browser, html, dpr) {
  const ctx = await browser.newContext({ viewport: { width: 1256, height: 900 }, deviceScaleFactor: dpr })
  try {
    const page = await ctx.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.fonts].map((f) => f.load().catch(() => null))); await document.fonts.ready })
    const st = await page.evaluate(() => [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.status))
    const png = await page.screenshot({ fullPage: true, animations: 'disabled' })
    return { png, st }
  } finally { await ctx.close() }
}
// compare two PNGs: bytes first; otherwise decode both in a page and count differing pixels / name the bounding box
export async function diffPng(browser, a, b) {
  if (a.equals(b)) return { equal: true, diffPixels: 0 }
  const ctx = await browser.newContext()
  try {
    const page = await ctx.newPage()
    await page.setContent('<canvas id=c></canvas>')
    return await page.evaluate(async ([x, y]) => {
      const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s })
      const [ia, ib] = await Promise.all([load(x), load(y)])
      if (ia.width !== ib.width || ia.height !== ib.height) return { equal: false, sizeDiffers: [ia.width, ia.height, ib.width, ib.height], diffPixels: -1 }
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data }
      const da = px(ia), db = px(ib)
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, maxd = 0
      const rowPx = new Uint32Array(ia.height), rowX0 = new Int32Array(ia.height).fill(1e9), rowX1 = new Int32Array(ia.height).fill(-1)
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]))
        if (d) {
          n++; maxd = Math.max(maxd, d); const p = i / 4, X = p % ia.width, Y = (p / ia.width) | 0
          x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y)
          rowPx[Y]++; rowX0[Y] = Math.min(rowX0[Y], X); rowX1[Y] = Math.max(rowX1[Y], X)
        }
      }
      // regions: rows with a difference, merged while the gap between them is under 24 px
      const regions = []
      for (let y = 0; y < ia.height; y++) {
        if (!rowPx[y]) continue
        const last = regions[regions.length - 1]
        if (last && y - last.y1 <= 24) { last.y1 = y; last.px += rowPx[y]; last.x0 = Math.min(last.x0, rowX0[y]); last.x1 = Math.max(last.x1, rowX1[y]) }
        else regions.push({ y0: y, y1: y, x0: rowX0[y], x1: rowX1[y], px: rowPx[y] })
      }
      return { equal: n === 0, diffPixels: n, maxChannelDelta: maxd, bbox: n ? [x0, y0, x1, y1] : null, size: [ia.width, ia.height], regions: regions.slice(0, 40) }
    }, [a.toString('base64'), b.toString('base64')])
  } finally { await ctx.close() }
}

async function specimenCompare(browser, masterDir, otherDir, weights, label) {
  const out = []
  const hm = specimenHtml(masterDir, weights), ho = specimenHtml(otherDir, weights)
  for (const dpr of [1, 2]) {
    const m = await shoot(browser, hm, dpr)
    const o = await shoot(browser, ho, dpr)
    const d = await diffPng(browser, m.png, o.png)
    const bad = [...m.st, ...o.st].filter((s) => /error/.test(s))
    out.push({ dpr, ...d, size: pngSize(m.png), faceErrors: bad, loaded: o.st.filter((s) => /loaded/.test(s)).length })
  }
  return out
}

async function layerB(browser, used) {
  head('B. SPECIMEN: masters vs shipped files, same browser')
  const weights = [...new Set([...used.alexandria.used, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900])].filter((w) => w >= used.alexandria.min && w <= used.alexandria.max).sort((a, b) => a - b)
  const r = await specimenCompare(browser, MASTERS, SHIPPED, weights, 'shipped')
  for (const x of r) {
    check(`specimen @${x.dpr}x (${x.size?.join('x') ?? '?'} px: every glyph of all 8 files, Alexandria ${weights.length} weights, Plex 7 weights): shipped files draw byte-identical pixels`, x.equal && !x.faceErrors.length,
      x.equal ? x.faceErrors.join(', ') : `${x.diffPixels} pixels differ, max channel delta ${x.maxChannelDelta}, box ${x.bbox}`)
  }
  return weights
}

// ---------------------------------------------------------------------------------------------------------------
// LAYER C: the site
// ---------------------------------------------------------------------------------------------------------------
const PRODUCT = '/product/energy-t-shirt-red-white'
const SOLDOUT = '/product/cagliari-calcio-backpack'
const CART = [
  { key: 'energy-t-shirt-red-white__M__-', slug: 'energy-t-shirt-red-white', size: 'M', fit: null, name: 'Energy T-Shirt', price: 5, image: '/product-photo-unavailable.svg', qty: 2 },
  { key: 'flash-shorts-green__L__-', slug: 'flash-shorts-green', size: 'L', fit: null, name: 'Flash Shorts', price: 3, image: '/product-photo-unavailable.svg', qty: 1 },
  { key: 'cloudsoft-leggings-grey__L__-', slug: 'cloudsoft-leggings-grey', size: 'L', fit: null, name: 'Cloudsoft Leggings', price: 4.5, image: '/product-photo-unavailable.svg', qty: 1 },
]
const WISHLIST = ['energy-t-shirt-red-white', 'vanquish-t-shirt-white', 'flash-shorts-red']
const DELIVERY = { name: 'Test Shopper', phone: '99887766', governorate: 'capital', area: 'Sharq', block: '1', street: '2', building: '3', floor: '', flat: '', note: '' }
const skipped = (why) => ({ skipped: why })
const clickFirst = async (page, selectors, what) => {
  for (const s of selectors) {
    const el = await page.$(s)
    if (el && (await el.isVisible().catch(() => false))) { await el.click({ timeout: 4000 }); return null }
  }
  return skipped('no ' + what + ' control (looked for ' + selectors.join(' | ') + ')')
}
// the same layout states as scripts/fonts-audit.mjs (kept in step by hand: the states a visitor opens before buying anything)
const ACT = {
  async openBag(page) {
    const s = await clickFirst(page, ['button.navbar-cart', 'header button[aria-label*="bag" i]', 'header button[aria-label*="الحقيبة"]'], 'bag'); if (s) return s
    await page.waitForSelector('aside[role=dialog]:not([aria-hidden=true]):not([inert])', { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600)
  },
  async openAI(page) {
    const s = await clickFirst(page, ['button.navbar-ai', 'button.assistant-launcher', 'button[aria-label*="assistant" i]', 'button[aria-label*="مساعد"]'], 'Sporta AI'); if (s) return s
    await page.waitForSelector('div[role=dialog]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(900)
  },
  async toggleLang(page) {
    const before = await page.evaluate(() => document.documentElement.lang)
    const s = await clickFirst(page, ['button.navbar-language', 'header button[aria-label*="language" i]', 'header button[aria-label*="اللغة"]'], 'language toggle'); if (s) return s
    await page.waitForFunction((b) => document.documentElement.lang !== b, before, { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700)
  },
  async pickSize(page) {
    const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => /^(XS|S|M|L|XL|[2-6]XL|ONE)$/.test((x.textContent || '').trim()) && !x.disabled && x.getAttribute('aria-disabled') !== 'true'); if (b) b.click(); return !!b })
    if (!ok) return skipped('no enabled size chip'); await page.waitForTimeout(500)
  },
  async openSizeGuide(page) {
    const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => /size guide|دليل|المقاسات/i.test(x.textContent || '')); if (b) b.click(); return !!b })
    if (!ok) return skipped('no size-guide button'); await page.waitForTimeout(800)
  },
  async openDetails(page) {
    const n = await page.evaluate(() => { const d = [...document.querySelectorAll('details:not([open])')]; d.forEach((x) => (x.open = true)); return d.length })
    if (!n) return skipped('no closed <details>'); await page.waitForTimeout(500)
  },
  async openMenu(page) { const s = await clickFirst(page, ['header button[aria-label*="menu" i]', 'header button[aria-label*="القائمة"]', 'header button[aria-controls]'], 'menu'); if (s) return s; await page.waitForTimeout(500) },
  async openSearch(page) { const s = await clickFirst(page, ['header button[aria-label*="search" i]', 'header button[aria-label*="بحث"]'], 'search'); if (s) return s; await page.waitForTimeout(700) },
}
export const CATALOGUE = [
  { id: 'home', path: '/' }, { id: 'shop', path: '/shop' }, { id: 'shop-brand', path: '/shop?brand=vanquish' }, { id: 'shop-category', path: '/shop?category=women' },
  { id: 'product', path: PRODUCT }, { id: 'product-size', path: PRODUCT, act: 'pickSize' }, { id: 'product-sizeguide', path: PRODUCT, act: 'openSizeGuide' }, { id: 'product-soldout', path: SOLDOUT },
  { id: 'cart', path: '/cart', seed: { cart: 1 } }, { id: 'cart-empty', path: '/cart' }, { id: 'checkout', path: '/checkout', seed: { cart: 1 } }, { id: 'checkout-quick', path: '/checkout', seed: { cart: 1, delivery: 1 } },
  { id: 'about', path: '/about' }, { id: 'about-faq', path: '/about', act: 'openDetails' }, { id: 'contact', path: '/contact' }, { id: 'wishlist', path: '/wishlist', seed: { wishlist: 1 } }, { id: 'wishlist-empty', path: '/wishlist' },
  { id: 'track', path: '/track' }, { id: 'returns', path: '/returns' }, { id: 'exchange', path: '/exchange' }, { id: 'terms', path: '/terms' }, { id: 'privacy', path: '/privacy' }, { id: 'account', path: '/account' },
  { id: 'support', path: '/support' }, { id: 'review', path: '/review' }, { id: 'payment-result', path: '/payment/result' }, { id: 'invoice', path: '/invoice/SP000000' }, { id: 'notfound', path: '/no-such-page' }, { id: 'backends', path: '/backends' },
  { id: 'bag-open', path: '/', seed: { cart: 1 }, act: 'openBag' }, { id: 'bag-open-empty', path: '/', act: 'openBag' }, { id: 'ai-open', path: '/', act: 'openAI' }, { id: 'ai-open-product', path: PRODUCT, act: 'openAI' },
  { id: 'lang-toggle', path: '/', act: 'toggleLang' }, { id: 'lang-toggle-shop', path: '/shop', act: 'toggleLang' }, { id: 'menu-open', path: '/', act: 'openMenu' }, { id: 'search-open', path: '/', act: 'openSearch' },
]
const QUICK_IDS = ['home', 'shop', 'product', 'cart', 'checkout', 'bag-open', 'ai-open', 'support']
const withLang = (p, lang) => (lang === 'en' ? p + (p.includes('?') ? '&' : '?') + 'lang=en' : p)
export const ctxOptions = (width, lang) => {
  const phone = width <= 767
  return { viewport: { width, height: phone ? 844 : 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', timezoneId: 'Asia/Kuwait', colorScheme: 'light', deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce' }
}
const seedScript = (a) => {
  try {
    if (a.cart && !localStorage.getItem('sporta_cart')) localStorage.setItem('sporta_cart', JSON.stringify(a.cart))
    if (a.wishlist && !localStorage.getItem('sporta_wishlist')) localStorage.setItem('sporta_wishlist', JSON.stringify(a.wishlist))
    if (a.delivery && !localStorage.getItem('sporta.delivery')) { localStorage.setItem('sporta.delivery', JSON.stringify(a.delivery)); localStorage.setItem('sporta.delivery.remember', '1') }
  } catch {}
}
// A screenshot has to be the same page twice. Long timers (slide show, rotating promo text) are what moves it between two loads;
// short ones (UI, debounce) are left alone.
export const freezeScript = () => {
  const si = window.setInterval, st = window.setTimeout
  window.setInterval = (f, ms, ...a) => (ms >= 1500 ? 0 : si(f, ms, ...a))
  window.setTimeout = (f, ms, ...a) => (ms >= 2500 ? 0 : st(f, ms, ...a))
}
// text-size-adjust: Chrome's mobile text autosizer ("font boosting") re-decides a block's text size when the layout width it sees changes,
// and a full-page screenshot changes it for a moment: depending on timing the very same page came out with its headlines scaled or not.
// That is the browser, not the fonts, so it is switched off for the comparison.
export const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}html{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}'

// ---- in the page: per-character census of which face and weight draws what --------------------------------------
function CENSUS() {
  const SKIP = 'script,style,noscript,template,head,title,datalist'
  const parseRanges = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    x = x.replace(/^U\+/i, '')
    if (x.includes('?')) return [parseInt(x.replace(/\?/g, '0'), 16), parseInt(x.replace(/\?/g, 'F'), 16)]
    const [a, b] = x.split('-'); const lo = parseInt(a, 16); return [lo, b ? parseInt(b, 16) : lo]
  })
  const unq = (s) => String(s || '').trim().replace(/^["']|["']$/g, '')
  const wr = (v) => { const p = String(v || '400').trim().split(/\s+/); const f = (x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : parseFloat(x)); const lo = f(p[0]); return [lo, p[1] ? f(p[1]) : lo] }
  const fileOf = (src) => { const m = /url\(["']?([^"')]+)["']?\)/.exec(src || ''); return m ? m[1].split('/').pop().split('?')[0] : '' }
  const faces = [], unreadable = [], declared = [], pseudoBases = new Set()
  const root = getComputedStyle(document.documentElement)
  const resolveVar = (v) => {
    for (let i = 0; i < 4 && /var\(/.test(v); i++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, n, fb) => root.getPropertyValue(n).trim() || fb || '')
    return v.trim()
  }
  const walk = (rules, ctx) => {
    for (const r of rules) {
      if (r.type === 5) {
        faces.push({ family: unq(r.style.getPropertyValue('font-family')), w: wr(r.style.getPropertyValue('font-weight')), style: r.style.getPropertyValue('font-style') || 'normal',
          file: fileOf(r.style.getPropertyValue('src')), ranges: parseRanges(r.style.getPropertyValue('unicode-range') || 'U+0-10FFFF'), urs: r.style.getPropertyValue('unicode-range'), wstr: r.style.getPropertyValue('font-weight') })
      } else if (r.type === 1) {
        let v = r.style.fontWeight
        if (!v) { const f = r.style.getPropertyValue('font'); if (f) { const m = resolveVar(f).split(/\s+/).find((t) => /^(\d{1,4}|bold|bolder|lighter)$/.test(t)); if (m) v = m } }
        if (v) declared.push({ sel: r.selectorText, raw: v, value: resolveVar(v), ctx })
        if (/::?(before|after)\s*(,|$)/.test(r.selectorText || '') && r.style.getPropertyValue('content') && r.style.getPropertyValue('content') !== 'none') {
          for (const s of r.selectorText.split(',')) if (/::?(before|after)\s*$/.test(s.trim())) pseudoBases.add(s.trim().replace(/::?(before|after)\s*$/, '').trim() || '*')
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, ctx)
      } else if (r.cssRules) walk(r.cssRules, ctx + ' ' + (r.conditionText || (r.media && r.media.mediaText) || r.name || r.cssText.split('{')[0]).trim())
    }
  }
  for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules } catch { unreadable.push(sh.href || 'inline'); continue } walk(rs, '') }

  const byFam = new Map()
  for (const f of faces) { const k = f.family.toLowerCase(); if (!byFam.has(k)) byFam.set(k, []); byFam.get(k).push(f) }
  const groupsOf = (fs) => { const seen = new Map(); for (const f of fs) seen.set(f.w.join('-') + '|' + f.style, f.w); return [...seen.values()] }
  const pickGroup = (groups, w) => {
    const inR = groups.findIndex((g) => w >= g[0] && w <= g[1]); if (inR >= 0) return inR
    const idx = groups.map((g, i) => i); const asc = (f) => idx.filter(f).sort((a, b) => groups[a][0] - groups[b][0]); const desc = (f) => idx.filter(f).sort((a, b) => groups[b][1] - groups[a][1])
    let order
    if (w >= 400 && w <= 500) order = [...asc((i) => groups[i][0] > w && groups[i][0] <= 500), ...desc((i) => groups[i][1] < w), ...asc((i) => groups[i][0] > 500)]
    else if (w < 400) order = [...desc((i) => groups[i][1] < w), ...asc((i) => groups[i][0] > w)]
    else order = [...asc((i) => groups[i][0] > w), ...desc((i) => groups[i][1] < w)]
    return order[0]
  }
  const splitFam = (s) => { const out = []; let cur = '', q = ''; for (const ch of s) { if (q) { if (ch === q) q = ''; else cur += ch } else if (ch === '"' || ch === "'") q = ch; else if (ch === ',') { out.push(cur.trim()); cur = '' } else cur += ch } if (cur.trim()) out.push(cur.trim()); return out }
  const cache = new Map(), usedFaces = new Set()
  const resolve = (cp, stack, w) => {
    for (const fam of stack) {
      const fs = byFam.get(fam.toLowerCase()); if (!fs) continue
      const groups = groupsOf(fs); const gi = pickGroup(groups, w); if (gi == null) continue
      const g = groups[gi]
      const face = fs.find((f) => f.w[0] === g[0] && f.w[1] === g[1] && f.ranges.some(([a, b]) => cp >= a && cp <= b))
      if (face && !face.file) return { family: fam, file: 'system:' + fam, got: w, max: w } // a local() face (the metric fallbacks): a device font
      if (face) { usedFaces.add(face); return { family: fam, file: face.file, got: Math.min(Math.max(w, g[0]), g[1]), max: g[1] } }
    }
    return null
  }
  const entries = {}
  const inView = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0 && r.bottom > 0 && r.right > 0 && r.left < innerWidth }
  const count = (text, cs, el, kind) => {
    const stack = splitFam(cs.fontFamily); const w = parseFloat(cs.fontWeight) || 400
    const vis = inView(el) ? 'v' : 'o'
    const fvs = cs.fontVariationSettings !== 'normal' ? cs.fontVariationSettings : ''
    const synth = cs.fontSynthesisWeight !== 'none' ? 1 : 0
    for (const ch of text) {
      if (!/\S/.test(ch) || /\p{Cf}|\p{Cc}/u.test(ch)) continue
      const cp = ch.codePointAt(0)
      const ck = stack.join('|') + '#' + w + '#' + cp
      let r = cache.get(ck); if (r === undefined) { r = resolve(cp, stack, w); cache.set(ck, r) }
      const key = (r ? r.family + '|' + r.file + '|' + w + '|' + r.got + '|' + (synth && w >= 600 && r.max < 600 ? 'SYNTH' : '') : 'system|system:' + (stack[0] || '?') + '|' + w + '|' + w + '|') + '|' + (fvs ? 'FVS:' + fvs : '') + '|' + kind + '|' + vis
      entries[key] = (entries[key] || 0) + 1
    }
  }
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = tw.nextNode()); ) {
    const el = n.parentElement
    if (!el || el.closest(SKIP) || !/\S/.test(n.nodeValue)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || el.closest('[hidden]') && getComputedStyle(el.closest('[hidden]')).display === 'none') continue
    count(n.nodeValue, cs, el, 't')
  }
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const cs = getComputedStyle(el); if (cs.display === 'none') continue
    if (el.tagName === 'SELECT') { const o = el.selectedOptions && el.selectedOptions[0]; if (o) count(o.text, cs, el, 'c'); continue }
    if (el.value && !/^(password|hidden|file|checkbox|radio)$/.test(el.type)) count(el.value, cs, el, 'c')
    if (el.placeholder) { let ps = cs; try { ps = getComputedStyle(el, '::placeholder') } catch {} count(el.placeholder, ps, el, 'p') }
  }
  const unesc = (s) => s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1')
  for (const base of pseudoBases) {
    let els = []; try { els = [...document.querySelectorAll(base)].slice(0, 300) } catch { continue }
    for (const el of els) for (const pe of ['::before', '::after']) {
      const cs = getComputedStyle(el, pe); const c = cs.content
      if (!c || c === 'none' || c === 'normal') continue
      for (const m of c.matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const t = unesc(m[1]); if (t) count(t, cs, el, 'x') }
    }
  }
  // every declared font-weight in every readable stylesheet, resolved against the elements it matches
  const STRIP_PE = /::?(before|after|first-line|first-letter|placeholder|marker|selection|backdrop|-webkit-[a-z-]+|-moz-[a-z-]+)(\([^)]*\))?/gi
  const STRIP_DYN = /:(hover|focus|focus-visible|focus-within|active|visited|target|checked|indeterminate|user-invalid|user-valid|placeholder-shown|autofill|fullscreen|open)\b/gi
  const seenRule = new Set()
  const rules = []
  for (const d of declared) {
    const k = d.sel + '|' + d.value + '|' + d.ctx
    if (seenRule.has(k)) continue; seenRule.add(k)
    const fams = {}; let matches = 0
    for (const s of String(d.sel).split(',')) {
      let q = s.replace(STRIP_PE, '').replace(STRIP_DYN, '').trim()
      if (!q || /[>+~]\s*$/.test(q)) q += '*'
      let els = []; try { els = [...document.querySelectorAll(q)] } catch { continue }
      matches += els.length
      for (const el of els.slice(0, 200)) { const f = splitFam(getComputedStyle(el).fontFamily)[0] || '?'; fams[f] = (fams[f] || 0) + 1 }
    }
    rules.push({ sel: String(d.sel).slice(0, 110), value: d.value, ctx: d.ctx.trim().slice(0, 80), matches, fams })
  }
  const docFonts = [...document.fonts].map((f) => ({ family: unq(f.family), weight: f.weight, status: f.status }))
  // every face the text on screen resolved to must be LOADED by now (a face still "unloaded" means the screenshot shows a fallback)
  const needed = [...usedFaces].map((f) => {
    const ff = [...document.fonts].find((x) => unq(x.family).toLowerCase() === f.family.toLowerCase() && x.weight === f.wstr.trim() && x.unicodeRange === f.urs)
    return { file: f.file, status: ff ? ff.status : 'unmatched' }
  })
  return { entries, rules, unreadable, docFonts, needed, faces: faces.map((f) => ({ family: f.family, w: f.w, file: f.file })), htmlLang: document.documentElement.lang, dir: document.documentElement.dir }
}

// Every font the text on screen needs is LOADED, not just "nothing is loading right now": for each text node the browser is asked
// document.fonts.check(font shorthand, the text) (false = a face that text needs has not arrived) and, when false, told to load it.
// A screenshot taken while the Arabic display face is still on its way draws the headlines in the next family of the stack
// (Plex Bold), which is a different picture of the SAME site - under heavy machine load that happened on about one load in three.
export const fontsSettled = (page) => page.evaluate(async () => {
  const SKIP = 'script,style,noscript,template,head,title,datalist'
  const t0 = performance.now()
  await document.fonts.ready
  for (;;) {
    const need = new Map()
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n; (n = tw.nextNode()); ) {
      const el = n.parentElement
      if (!el || el.closest(SKIP) || !/\S/.test(n.nodeValue)) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const t = n.nodeValue.trim().slice(0, 120)
      need.set(font + '|' + t, [font, t])
    }
    let missing = 0
    await Promise.all([...need.values()].map(async ([f, t]) => { try { if (!document.fonts.check(f, t)) { missing++; await document.fonts.load(f, t) } } catch {} }))
    if (!missing || performance.now() - t0 > 90000) break
    await new Promise((r) => setTimeout(r, 150))
  }
  await document.fonts.ready
})
export async function settle(page, notes) {
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => notes.push('load not seen'))
  await page.waitForFunction(() => !document.querySelector('#root > .boot'), null, { timeout: 20000 }).catch(() => notes.push('boot shell still up'))
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => notes.push('network not idle'))
  await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, null, { timeout: 8000 }).catch(() => notes.push('skeletons left'))
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight, step = Math.max(200, Math.floor(innerHeight * 0.8))
    for (let y = 0; y < h; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) }
    scrollTo(0, 0); await new Promise((r) => setTimeout(r, 300))
  })
  await fontsSettled(page)
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(250)
}

// One page-state on one font set: returns the census, the full-page PNG and the font files the page fetched.
export async function loadState(browser, base, spec, lang, width, wantPng, swap = false) {
  const ctx = await browser.newContext(ctxOptions(width, lang))
  const notes = [], fonts = [], blocked = []
  try {
    const origin = new URL(base).origin
    await ctx.route('**/*', async (route) => {
      const req = route.request(); let u
      try { u = new URL(req.url()) } catch { return route.continue() }
      if (req.method() !== 'GET') { blocked.push(req.method()); return route.abort('blockedbyclient') }
      if (u.origin !== origin) return route.abort('blockedbyclient')
      if (/^\/assets\/[^/]+\.css$/.test(u.pathname)) { // the capture lacks three lazy route stylesheets: an empty stub keeps the real page up (as fonts-audit.mjs does)
        try { const resp = await route.fetch(); if (resp.status() === 404) { notes.push('stub ' + u.pathname); return route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }) } return route.fulfill({ response: resp }) } catch { return route.continue() }
      }
      return route.continue()
    })
    await ctx.addInitScript(freezeScript)
    await ctx.clock.setFixedTime(new Date('2026-11-04T09:30:00Z')) // the header shows a Kuwait-time clock; two loads minutes apart would draw it differently
    if (spec.seed) await ctx.addInitScript(seedScript, { cart: spec.seed.cart ? CART : null, wishlist: spec.seed.wishlist ? WISHLIST : null, delivery: spec.seed.delivery ? DELIVERY : null })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
    page.on('response', (r) => { const u = new URL(r.url()); const m = /\/(__slim\/)?fonts\/([^/]+\.woff2)$/.exec(u.pathname); if (m) fonts.push({ file: m[2], status: r.status(), set: m[1] ? 'slim' : 'master' }) })
    await page.goto(base + withLang(spec.path, lang), { waitUntil: 'load', timeout: 60000 })
    await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {})
    await settle(page, notes)
    if (spec.act) {
      const a = await ACT[spec.act](page)
      if (a && a.skipped) return { skipped: a.skipped }
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      await fontsSettled(page); await page.waitForTimeout(250)
    }
    // One phase = census + (optionally) the full-page picture of the page as it stands.
    const phase = async () => {
      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {})
      const census = await page.evaluate(CENSUS)
      const metrics = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, vv: visualViewport ? visualViewport.scale : 1, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }))
      let png = null
      if (wantPng) {
        await page.evaluate(async () => { scrollTo(0, 0); await Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null))); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })
        await page.waitForTimeout(150); png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', timeout: 90000 }) }
      return { census, png, metrics }
    }
    const A = await phase()
    let B = null
    if (swap) {
      // The SAME document, the SAME DOM and the same random choices: only the font files change. Every @font-face src is
      // pointed at /__slim/fonts/ (the shipped files); the browser rebuilds the faces, loads them, re-lays the text out.
      const n = await page.evaluate(() => {
        let k = 0
        const walk = (rules) => { for (const r of rules) { if (r.type === 5) { const src = r.style.getPropertyValue('src'); if (/\/fonts\/[^"')]+\.woff2/.test(src)) { r.style.setProperty('src', src.replace(/\/fonts\//g, '/__slim/fonts/')); k++ } } else if (r.cssRules) walk(r.cssRules) } }
        for (const sh of document.styleSheets) { try { walk(sh.cssRules) } catch {} }
        return k
      })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      await fontsSettled(page); await page.waitForTimeout(300)
      B = await phase()
      B.swappedRules = n
    }
    return { A, B, fonts, notes, errors, blocked }
  } finally { await ctx.close().catch(() => {}) }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i) } }))
  return out
}

// aggregate entries: key -> glyphs, plus which state-ids each key occurs in
function aggregate(states) {
  const agg = new Map()
  for (const s of states) {
    if (!s.census) continue
    for (const [k, n] of Object.entries(s.census.entries)) {
      const [family, file, req, got, synth, fvs, kind, vis] = k.split('|')
      const key = [family, file, req, got, synth, fvs].join('|')
      if (!agg.has(key)) agg.set(key, { family, file, req: Number(req), got: Number(got), synth, fvs, glyphs: 0, visible: 0, states: new Set(), routes: new Set() })
      const a = agg.get(key); a.glyphs += n; if (vis === 'v') a.visible += n; a.states.add(s.name); a.routes.add(s.id)
    }
  }
  return agg
}
const famLabel = (f) => (/alexandria/i.test(f) ? 'Alexandria' : /plex/i.test(f) ? 'IBM Plex Sans Arabic' : f)
const scriptOf = (file) => (/^system:/.test(file) ? 'system' : /arabic/.test(file) ? 'arabic' : /latin/.test(file) ? 'latin' : 'system')

// the census table: family x script x requested -> drawn, glyphs, pages. Returns rows.
function table(agg) {
  const rows = [...agg.values()].map((a) => ({ family: famLabel(a.family), script: scriptOf(a.file), file: a.file, requested: a.req, drawn: a.got, synth: a.synth, fvs: a.fvs, glyphs: a.glyphs, visible: a.visible, states: a.states.size, routes: a.routes.size }))
  rows.sort((x, y) => x.family.localeCompare(y.family) || x.script.localeCompare(y.script) || x.requested - y.requested)
  return rows
}

// coverage of a font directory against the census rows: what is drawn and not covered, what is shipped and never drawn
async function coverage(dir, rows, used, label) {
  const problems = []
  const info = {}
  for (const n of FILES) {
    const f = path.join(dir, n)
    if (!existsSync(f)) { info[n] = null; continue }
    try { info[n] = fontInfo(f) } catch (e) { info[n] = { error: String(e.message).slice(0, 100) } }
  }
  for (const r of rows) {
    if (r.script === 'system') continue
    const i = info[r.file]
    if (!i) { problems.push(`${r.family} ${r.script}: the page draws ${fmt(r.glyphs)} glyphs from ${r.file}, which is not shipped`); continue }
    if (i.error) { problems.push(`${r.file}: unreadable (${i.error})`); continue }
    if (/alexandria/i.test(r.file)) {
      const ax = i.axes?.[0]
      if (!ax) { problems.push(`${r.file}: not a variable font any more`); continue }
      if (r.drawn < ax.min || r.drawn > ax.max) problems.push(`Alexandria ${r.script}: weight ${r.drawn} (asked ${r.requested}) is drawn on ${fmt(r.glyphs)} glyphs in ${r.states} page-states but the shipped wght axis is only ${ax.min}-${ax.max}`)
    } else {
      const w = Number(r.file.match(/plex-(\d+)/)[1])
      if (i.weightClass !== w) problems.push(`${r.file}: weight class ${i.weightClass}, the name says ${w}`)
      if (r.drawn !== w) problems.push(`Plex: the page asks ${r.requested} and the matcher picked ${r.drawn}, but ${r.file} is a ${w} file`)
    }
    if (r.synth) problems.push(`${r.family} ${r.script}: ${fmt(r.glyphs)} glyphs at ${r.requested} would be synthetic bold`)
  }
  const drawnFiles = new Set(rows.filter((r) => r.script !== 'system').map((r) => r.file))
  for (const n of Object.keys(info)) if (info[n] && !drawnFiles.has(n)) problems.push(`${n} is shipped but no page draws a glyph from it`)
  for (const n of readdirSync(dir)) if (n.endsWith('.woff2') && !FILES.includes(n)) problems.push(`${n} is shipped but no @font-face names it`)
  return problems
}

// ---------------------------------------------------------------------------------------------------------------
async function layerC(holder, mirror, used, masterDir, ctx) {
  const getB = () => holder.get()
  head('C. SITE: every state drawn with the masters, then the same page redrawn with the shipped files')
  const mp = await fontProxy(masterDir, mirror.base, SHIPPED)
  const sp = await fontProxy(SHIPPED, mirror.base) // the same site with the shipped files from the first byte (the fallback comparison)
  try {
    let cat = CATALOGUE
    const want = list(opt('--routes', ''), '')
    if (want.length) cat = CATALOGUE.filter((c) => want.includes(c.id))
    else if (QUICK) cat = CATALOGUE.filter((c) => QUICK_IDS.includes(c.id))
    const tasks = cat.flatMap((spec) => LANGS.flatMap((lang) => WIDTHS.map((w) => ({ spec, lang, width: w, name: `${spec.id}__${lang}__${w}` }))))
    console.log(`  ${tasks.length} page-states (${cat.length} states x ${LANGS.join('/')} x ${WIDTHS.join('/')}), each loaded once with the masters, photographed, then switched in place to the shipped files and photographed again; ${PAGES} at a time`)
    mkdirSync(path.join(REPORT, 'diff'), { recursive: true })
    const t0 = Date.now()
    mkdirSync(path.join(REPORT, 'states'), { recursive: true })
    const out = await mapLimit(tasks, PAGES, async (t, i) => {
      const saved = path.join(REPORT, 'states', t.name + '.json')
      if (flag('--resume') && existsSync(saved)) { const r = JSON.parse(readFileSync(saved, 'utf8')); console.log(`  [${i + 1}/${tasks.length}] ${t.name}: resumed (${r.skipped ? 'skipped' : r.pixel === 'identical' ? 'identical' : 'DIFFERS'})`); return r }
      const res = { name: t.name, id: t.spec.id, lang: t.lang, width: t.width }
      const tState = Date.now()
      // a browser killed from outside (this machine is shared and somebody else's cleanup kills every chrome) is relaunched by the
      // holder; the state is simply measured again, at most twice more
      for (let relaunch = 0; relaunch < 3; relaunch++) {
      delete res.error
      try {
        let tries = 0, last = null
        for (; tries < ATTEMPTS; tries++) {
          const m = await loadState(await getB(), mp.base, t.spec, t.lang, t.width, true, true)
          if (m.skipped) { res.skipped = m.skipped; break }
          res.census = m.A.census; res.censusShipped = m.B.census; res.swappedRules = m.B.swappedRules
          res.fontsMaster = [...new Set(m.fonts.filter((f) => f.set === 'master').map((f) => f.file + ':' + f.status))]
          res.fontsShipped = [...new Set(m.fonts.filter((f) => f.set === 'slim').map((f) => f.file + ':' + f.status))]
          res.notes = m.notes; res.errors = m.errors; res.metrics = m.A.metrics; res.metricsShipped = m.B.metrics
          const d = await diffPng(await getB(), m.A.png, m.B.png)
          last = { d, m }
          ;(res.log ||= []).push(d.equal ? 'identical' : `${d.diffPixels} px in ${(d.regions || []).length} regions, first rows ${d.regions?.[0]?.y0}-${d.regions?.[0]?.y1}, cols ${d.regions?.[0]?.x0}-${d.regions?.[0]?.x1}`)
          if (d.equal) break
          writeFileSync(path.join(REPORT, 'diff', `${t.name}.try${tries}.A.png`), m.A.png); writeFileSync(path.join(REPORT, 'diff', `${t.name}.try${tries}.B.png`), m.B.png)
        }
        // In-place switching has a memory: a page that measures its text while the fonts change (a collapsible, a clamp, a fit) can
        // settle in a different layout than the same page loaded with the new fonts from the start (measured on the repo
        // storefront's /checkout: 3310 px with the masters, 3231 px after the switch, 3310 px again when loaded fresh with the
        // slim files). So when the in-place pictures keep differing, the comparison that decides is a FRESH load with the
        // masters against a FRESH load with the shipped files.
        if (!res.skipped && !last.d.equal && !res.skipped) {
          res.inPlace = last.d
          for (let k = 0; k < ATTEMPTS && !res.skipped; k++) {
            const a = await loadState(await getB(), mp.base, t.spec, t.lang, t.width, true, false)
            const b = await loadState(await getB(), sp.base, t.spec, t.lang, t.width, true, false)
            if (a.skipped || b.skipped) break
            const d2 = await diffPng(await getB(), a.A.png, b.A.png)
            ;(res.log ||= []).push('fresh loads: ' + (d2.equal ? 'identical' : `${d2.diffPixels} px in ${(d2.regions || []).length} regions`))
            last = { d: d2, m: { A: a.A, B: b.A } }
            res.censusShipped = b.A.census; res.census = a.A.census
            res.method = 'fresh loads'
            if (d2.equal) break
            writeFileSync(path.join(REPORT, 'diff', `${t.name}.fresh${k}.master.png`), a.A.png); writeFileSync(path.join(REPORT, 'diff', `${t.name}.fresh${k}.shipped.png`), b.A.png)
          }
        }
        if (!res.skipped) {
          res.attempts = tries + 1
          res.pixel = last.d.equal ? 'identical' : last.d
          if (!last.d.equal) { writeFileSync(path.join(REPORT, 'diff', t.name + '.master.png'), last.m.A.png); writeFileSync(path.join(REPORT, 'diff', t.name + '.shipped.png'), last.m.B.png) }
        }
        break
      } catch (e) { res.error = String(e.message || e).slice(0, 300); if (!/closed|disconnected|crashed|Target/i.test(res.error)) break; console.log(`  ${t.name}: browser went away (${res.error.slice(0, 60)}), relaunching`) }
      }
      res.seconds = Math.round((Date.now() - tState) / 1000)
      writeFileSync(path.join(REPORT, 'states', t.name + '.json'), JSON.stringify(res))
      const done = i + 1
      console.log(`  [${done}/${tasks.length}] ${Math.round((Date.now() - t0) / 1000)}s (${res.seconds}s)  ${t.name}: ${res.error ? 'ERROR ' + res.error : res.skipped ? 'skipped (' + res.skipped.slice(0, 40) + ')' : res.pixel === 'identical' ? 'identical' + (res.attempts > 1 ? ' (attempt ' + res.attempts + ')' : '') : 'DIFFERS ' + JSON.stringify(res.pixel).slice(0, 120)}`)
      return res
    })
    const ok = out.filter((r) => !r.skipped && !r.error)
    const skippedList = out.filter((r) => r.skipped)
    const errList = out.filter((r) => r.error)
    note(`${ok.length} page-states measured, ${skippedList.length} skipped (no such control in this build), ${errList.length} errored`)
    check('every page-state loaded and measured (no tool error)', errList.length === 0, errList.map((r) => r.name + ': ' + r.error).join('\n'))
    const diff = ok.filter((r) => r.pixel !== 'identical')
    check(`full-page screenshots: masters vs shipped files are byte-identical on ${ok.length - diff.length} of ${ok.length} page-states`, diff.length === 0,
      diff.map((r) => `${r.name}: ${r.pixel.diffPixels} px differ, box ${r.pixel.bbox}, max delta ${r.pixel.maxChannelDelta}`).join('\n'))
    const retried = ok.filter((r) => r.attempts > 1)
    if (retried.length) note(`${retried.length} page-states needed another load to hold still (page timing, not fonts: a state is identical if ANY load gives byte-equal pictures, a real font difference would show in every load): ` + retried.map((r) => r.name + ' [' + r.log.join(' | ') + ']').join('; '))
    // census equality
    const censusDiff = ok.filter((r) => JSON.stringify(r.census.entries) !== JSON.stringify(r.censusShipped.entries))
    check('per-character census (face, requested weight, drawn weight) is the same for masters and shipped files on every page-state', censusDiff.length === 0, censusDiff.slice(0, 5).map((r) => r.name).join(', '))
    const notLoaded = ok.filter((r) => [...r.census.needed, ...r.censusShipped.needed].some((f) => f.status !== 'loaded'))
    check('every font face the visible text resolves to is LOADED when the page is measured and photographed (no fallback in a screenshot)', notLoaded.length === 0,
      notLoaded.slice(0, 6).map((r) => r.name + ': ' + [...r.census.needed, ...r.censusShipped.needed].filter((f) => f.status !== 'loaded').map((f) => f.file + ' ' + f.status).join(', ')).join('\n'))
    const noSwap = ok.filter((r) => !r.method && (!r.swappedRules || !r.fontsShipped.length))
    check('the in-place switch really loaded the shipped files (/__slim/fonts/*) on every page-state', noSwap.length === 0, noSwap.slice(0, 6).map((r) => `${r.name}: ${r.swappedRules} rules rewritten, ${r.fontsShipped.length} slim fonts fetched`).join('\n'))
    const fontErr = ok.filter((r) => [...r.census.docFonts, ...r.censusShipped.docFonts].some((f) => f.status === 'error') || [...(r.fontsMaster || []), ...(r.fontsShipped || [])].some((f) => !/:200$/.test(f)))
    check('no @font-face ends in an error and no font request fails, on any page-state', fontErr.length === 0, fontErr.slice(0, 5).map((r) => r.name).join(', '))
    const pageErr = ok.filter((r) => r.errors.length)
    if (pageErr.length) note(`page errors on ${pageErr.length} states (also present with the masters; not font related): ${[...new Set(pageErr.flatMap((r) => r.errors))].slice(0, 3).join(' | ')}`)

    const agg = aggregate(ok.map((r) => ({ ...r, census: r.census })))
    const rows = table(agg)
    ctx.rows = rows; ctx.states = ok
    // print the table
    console.log('\n  family                script   requested drawn    glyphs   visible  page-states  routes')
    for (const r of rows) console.log('  ' + r.family.padEnd(22) + r.script.padEnd(9) + String(r.requested).padEnd(10) + String(r.drawn).padEnd(9) + fmt(r.glyphs).padStart(7) + fmt(r.visible).padStart(10) + String(r.states).padStart(11) + String(r.routes).padStart(8) + (r.synth ? '  SYNTHETIC BOLD' : '') + (r.fvs ? '  fvs=' + r.fvs : ''))
    const problems = await coverage(SHIPPED, rows, used, 'shipped')
    check('every weight drawn on the crawl is inside what the shipped files cover, and every shipped file is drawn', problems.length === 0, problems.join('\n'))
    const drawnFiles = new Set(rows.filter((r) => r.script !== 'system').map((r) => r.file))
    check('every preloaded font file is one the crawl draws', (ctx.preloaded || []).every((f) => drawnFiles.has(f)), (ctx.preloaded || []).filter((f) => !drawnFiles.has(f)).join(', '))
    const sys = rows.filter((r) => r.script === 'system')
    note('glyphs drawn by something other than the brand faces (device fonts; same with the masters): ' + (sys.map((r) => `${fmt(r.glyphs)} in ${r.file}`).join('; ') || 'none'))
    check('no element sets font-variation-settings (the wght axis is only reached through font-weight)', !rows.some((r) => r.fvs), rows.filter((r) => r.fvs).map((r) => r.fvs).join(', '))

    // declared rules (hover, focus, media queries) resolved against the elements they match
    const rules = new Map()
    for (const r of ok) for (const x of r.census.rules) { const k = x.sel + '|' + x.value + '|' + x.ctx; if (!rules.has(k)) rules.set(k, { ...x, fams: {} }); const e = rules.get(k); e.matches = Math.max(e.matches, x.matches); for (const [f, n] of Object.entries(x.fams)) e.fams[f] = Math.max(e.fams[f] || 0, n) }
    const rl = [...rules.values()]
    const alexW = new Set(), unres = [], plexOnly = []
    for (const x of rl) {
      const w = parseFloat(x.value)
      const fams = Object.keys(x.fams)
      if (!Number.isFinite(w)) { if (/bolder|lighter/.test(x.value)) unres.push(x); continue }
      if (fams.some((f) => /alexandria/i.test(f))) alexW.add(w)
      else if (!fams.length) unres.push(x)
      else plexOnly.push(x)
    }
    const declaredVals = [...new Set(rl.map((x) => x.value))].sort((a, b) => parseFloat(a) - parseFloat(b))
    note(`${rl.length} declared font-weight rules in the loaded stylesheets, values: ${declaredVals.join(' ')}`)
    note(`resolved against the page: Alexandria elements ${[...alexW].sort((a, b) => a - b).join(' ')}; ${plexOnly.length} rules only reach Plex-first elements; ${unres.length} rules match no element on any crawled state (family unknown)`)
    const lowRules = rl.filter((x) => parseFloat(x.value) < used.alexandria.min)
    check(`no loaded stylesheet declares a weight under ${used.alexandria.min} (hover/focus/media rules included)`, lowRules.length === 0, lowRules.map((x) => `${x.value} on ${x.sel} ${x.ctx}`).join('\n'))
    const stateless = [...new Set(out.filter((r) => r.census).flatMap((r) => r.census.unreadable))]
    if (stateless.length) note('unreadable (cross-origin) stylesheets: ' + stateless.join(', '))
    ctx.declared = { alexandria: [...alexW].sort((a, b) => a - b), unresolved: unres.map((x) => ({ sel: x.sel, value: x.value, ctx: x.ctx })), values: declaredVals }
    ctx.siteFontFiles = (() => { const m = new Map(); for (const r of ok) for (const f of new Set(r.fontsMaster || [])) { const k = f.split(':')[0]; m.set(k, (m.get(k) || 0) + 1) } return m })()
    writeFileSync(path.join(REPORT, 'site-results.json'), JSON.stringify({ rows, states: out.map((r) => ({ name: r.name, pixel: r.pixel, attempts: r.attempts, skipped: r.skipped, error: r.error, fonts: r.fontsShipped, notes: r.notes })), declared: ctx.declared }, null, 1))
  } finally { mp.stop(); sp.stop() }
}

// ---------------------------------------------------------------------------------------------------------------
// --write-used
// ---------------------------------------------------------------------------------------------------------------
function writeUsed(ctx, specimenWeights) {
  const rows = ctx.rows
  const alex = rows.filter((r) => /alexandria/i.test(r.family))
  const used = [...new Set(alex.map((r) => r.drawn))].sort((a, b) => a - b)
  const widen = [...used, ...(ctx.declared?.alexandria || []), ...(ctx.declared?.unresolved || []).map((x) => parseFloat(x.value)).filter(Number.isFinite)]
  const range = [Math.min(...widen), Math.max(...widen)]
  const plexFaces = {}
  for (const r of rows.filter((x) => /plex/i.test(x.family))) plexFaces[r.drawn] = { glyphs: (plexFaces[r.drawn]?.glyphs || 0) + r.glyphs }
  const snapped = {}
  for (const r of rows.filter((x) => /plex/i.test(x.family) && x.requested !== x.drawn)) snapped[r.requested] = r.drawn
  const total = rows.reduce((a, r) => a + r.glyphs, 0)
  const json = {
    schema: 1,
    note: 'Written by scripts/fonts-used-weights-test.mjs --write-used from a full crawl; read by scripts/slim-fonts.mjs. Weights are CSS font-weight values; "drawn" is what CSS font matching resolves them to.',
    generated: new Date().toISOString().slice(0, 10),
    crawl: { states: ctx.states.length, langs: LANGS, widths: WIDTHS, glyphs: total, source: ENV.BASE ? 'BASE ' + ENV.BASE : 'local mirror of the captured live storefront' },
    alexandria: { wght: { used, range, glyphs: Object.fromEntries(used.map((w) => [w, alex.filter((r) => r.drawn === w).reduce((a, r) => a + r.glyphs, 0)])), neverDrawn: `1-${range[0] - 1}`, masterAxis: [100, 900] } },
    plex: { faces: plexFaces, snapped, neverDrawn: [400, 600, 700].filter((w) => !plexFaces[w]) },
    declared: ctx.declared,
    table: rows.filter((r) => r.script !== 'system').map((r) => ({ family: r.family, script: r.script, requested: r.requested, drawn: r.drawn, glyphs: r.glyphs, pageStates: r.states, routes: r.routes })),
  }
  writeFileSync(USED_JSON, JSON.stringify(json, null, 1) + '\n')
  console.log('  wrote ' + path.relative(REPO, USED_JSON) + ': Alexandria used ' + used.join(' ') + ', range ' + range.join('-') + '; Plex faces ' + Object.keys(plexFaces).join(' '))
}

// ---------------------------------------------------------------------------------------------------------------
// LAYER D: mutants
// ---------------------------------------------------------------------------------------------------------------
async function layerD(browser, used, ctx, weights) {
  head('D. MUTANTS: the checks must fail when the shipped set is wrong')
  const base = mkdtempSync(path.join(tmpdir(), 'fonts-mutant-'))
  const mk = (name) => { const d = path.join(base, name); mkdirSync(d); for (const n of FILES) copyFileSync(path.join(SHIPPED, n), path.join(d, n)); return d }
  const cut = (dir, lo, hi) => { for (const s of ['latin', 'arabic']) py({ cmd: 'slim', src: path.join(MASTERS, `alexandria-var-${s}.woff2`), dst: path.join(dir, `alexandria-var-${s}.woff2`), limit: [lo, hi], glyphNames: false }) }
  const rows = ctx.rows
  const have = !!rows
  try {
    // 1 cut to 400-700: the crawl draws 800, 850 and 900
    let d = mk('cut-400-700'); cut(d, 400, 700)
    if (have) { const p = await coverage(d, rows, used); check('MUTANT Alexandria cut to 400-700: coverage check fails', p.some((x) => /Alexandria/.test(x) && /(800|850|900)/.test(x)), p.join('\n') || 'it passed') }
    let r = await specimenCompare(browser, MASTERS, d, weights.filter((w) => w <= 900), 'cut-400-700')
    check('MUTANT Alexandria cut to 400-700: the specimen pixel diff is non-zero', r.every((x) => !x.equal), r.map((x) => `${x.dpr}x diff ${x.diffPixels}`).join(', '))
    // 2 cut to 500-900: the crawl draws 400
    d = mk('cut-500-900'); cut(d, 500, 900)
    if (have) { const p = await coverage(d, rows, used); check('MUTANT Alexandria cut to 500-900: coverage check fails (weight 400 is drawn)', p.some((x) => /Alexandria/.test(x) && /weight 400/.test(x)), p.join('\n') || 'it passed') }
    r = await specimenCompare(browser, MASTERS, d, weights, 'cut-500-900')
    check('MUTANT Alexandria cut to 500-900: the specimen pixel diff is non-zero', r.every((x) => !x.equal), r.map((x) => `${x.dpr}x diff ${x.diffPixels}`).join(', '))
    // 3 a Plex face missing
    d = mk('no-plex-600'); rmSync(path.join(d, 'plex-600-latin.woff2'))
    if (have) { const p = await coverage(d, rows, used); check('MUTANT plex-600-latin missing: coverage check fails', p.some((x) => /plex-600-latin/.test(x)), p.join('\n') || 'it passed') }
    // 4 an extra file nothing names
    d = mk('extra'); copyFileSync(path.join(SHIPPED, 'plex-400-latin.woff2'), path.join(d, 'plex-500-latin.woff2'))
    if (have) { const p = await coverage(d, rows, used); check('MUTANT extra plex-500-latin.woff2 that no @font-face names: coverage check fails', p.some((x) => /plex-500-latin/.test(x)), p.join('\n') || 'it passed') }
    // 5 a Plex file replaced by another weight's bytes
    d = mk('swapped'); copyFileSync(path.join(SHIPPED, 'plex-700-latin.woff2'), path.join(d, 'plex-600-latin.woff2'))
    if (have) { const p = await coverage(d, rows, used); check('MUTANT plex-600-latin holds the 700 bytes: coverage check fails', p.some((x) => /plex-600-latin/.test(x) && /weight class 700/.test(x)), p.join('\n') || 'it passed') }
    r = await specimenCompare(browser, MASTERS, d, [400], 'swapped')
    check('MUTANT plex-600-latin holds the 700 bytes: the specimen pixel diff is non-zero', r.every((x) => !x.equal), r.map((x) => `${x.dpr}x diff ${x.diffPixels}`).join(', '))
    // 6 a truncated file: the face errors out
    d = mk('truncated'); writeFileSync(path.join(d, 'plex-400-arabic.woff2'), readFileSync(path.join(SHIPPED, 'plex-400-arabic.woff2')).subarray(0, 4000))
    r = await specimenCompare(browser, MASTERS, d, [400], 'truncated')
    check('MUTANT plex-400-arabic truncated: the specimen reports a font error or a pixel difference', r.every((x) => x.faceErrors.length > 0 || !x.equal), r.map((x) => `${x.dpr}x diff ${x.diffPixels} errors ${x.faceErrors.length}`).join(', '))
    // 7 the declared-weight scan: a stylesheet asking for 300
    check('MUTANT a stylesheet that declares font-weight:300 and font:300 14px x is seen by the static scan', declaredWeights('.a{font-weight:300}.b{font:300 14px/1 x}').map(toNum).filter((w) => w < 400).length === 2)
    const spell = declaredWeights('a{font-weight:800}b{font-weight : Bold}c{font:italic 650 12px/1.2 x}d{FONT-WEIGHT:100}e{font:normal normal 600 1rem a}')
    check('the static scan reads every spelling: 800, Bold, 100, a shorthand with italic, a shorthand with two normals', JSON.stringify(spell) === JSON.stringify(['800', 'bold', '100', '650', '600']), JSON.stringify(spell))
  } finally { if (!flag('--keep')) rmSync(base, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------------------------------------------
// --audit: fonts-audit.mjs on both font sets
// ---------------------------------------------------------------------------------------------------------------
async function auditCompare(mirror, masterDir, used) {
  head('C2. fonts-audit.mjs on the masters and on the shipped files')
  const px = await Promise.all([fontProxy(masterDir, mirror.base), fontProxy(SHIPPED, mirror.base)])
  const dirs = [path.join(REPORT, 'audit-masters'), path.join(REPORT, 'audit-shipped')]
  try {
    const runOne = (proxy, out) => new Promise((resolve) => {
      mkdirSync(out, { recursive: true })
      const want = list(opt('--routes', ''), '')
      const env = { ...ENV, BASE: proxy.base, OUT: out, LANGS: LANGS.join(','), WIDTHS: WIDTHS.join(','), EXTERNAL: 'block', STUB_MISSING_CSS: '1', PAGES: String(PAGES), THROTTLE: flag('--throttle') ? '1' : '0' }
      if (want.length) env.ROUTES = want.join(','); else if (QUICK) env.ROUTES = QUICK_IDS.join(',')
      const c = spawn(process.execPath, [path.join(HERE, 'fonts-audit.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let tail = ''; c.stdout.on('data', (d) => { tail = (tail + d).slice(-600) }); c.stderr.on('data', (d) => { tail = (tail + d).slice(-600) })
      c.on('exit', (code) => resolve({ code, tail }))
    })
    console.log('  running fonts-audit.mjs twice (masters, then shipped); this is the slow part')
    const a = await runOne(px[0], dirs[0]); const b = await runOne(px[1], dirs[1])
    check('fonts-audit.mjs finished on both font sets', a.code === 0 && b.code === 0, a.tail + '\n' + b.tail)
    const files = readdirSync(dirs[0]).filter((n) => /^[a-z0-9-]+__(ar|en)__\d+\.json$/.test(n))
    let states = 0, bad = []
    const pfNames = (d) => d.platformFonts.map((f) => f.ps || f.name)
    for (const n of files) {
      if (!existsSync(path.join(dirs[1], n))) { bad.push(n + ': missing in shipped run'); continue }
      const m = JSON.parse(readFileSync(path.join(dirs[0], n), 'utf8')), s = JSON.parse(readFileSync(path.join(dirs[1], n), 'utf8'))
      if (m.skipped || s.skipped || m.error || s.error) continue
      states++
      const mp = pfNames(m).sort(), sp = pfNames(s).sort()
      if (JSON.stringify(mp) !== JSON.stringify(sp)) bad.push(`${n}: platform fonts ${mp} vs ${sp}`)
      const gm = {}, gs = {}
      for (const r of m.runs) if (r.vis === 'visible') for (const [i, c] of r.pf || []) gm[m.platformFonts[i].ps] = (gm[m.platformFonts[i].ps] || 0) + c
      for (const r of s.runs) if (r.vis === 'visible') for (const [i, c] of r.pf || []) gs[s.platformFonts[i].ps] = (gs[s.platformFonts[i].ps] || 0) + c
      if (JSON.stringify(Object.entries(gm).sort()) !== JSON.stringify(Object.entries(gs).sort())) bad.push(`${n}: glyph counts by platform font differ`)
      if (m.runs.length !== s.runs.length) bad.push(`${n}: ${m.runs.length} vs ${s.runs.length} text runs`)
      else for (let i = 0; i < m.runs.length; i++) { if (JSON.stringify(m.runs[i].rect) !== JSON.stringify(s.runs[i].rect)) { bad.push(`${n}: run ${i} rect ${m.runs[i].rect} vs ${s.runs[i].rect} (${m.runs[i].txt})`); break } }
      const nb = (d) => d.runs.reduce((a, r) => a + (r.vis === 'visible' ? (r.glyphs || 0) - (r.brandGlyphs || 0) : 0), 0)
      if (nb(m) !== nb(s)) bad.push(`${n}: non-brand glyphs ${nb(m)} vs ${nb(s)}`)
      if ([...(s.documentFonts || [])].some((f) => f.status === 'error')) bad.push(n + ': a font face errored')
    }
    check(`fonts-audit: same platform fonts, same glyph counts per font, same text rectangles and zero new fallback glyphs on ${states} page-states`, bad.length === 0 && states > 0, bad.slice(0, 8).join('\n'))
    if (flag('--throttle')) {
      const tf = readdirSync(dirs[0]).filter((n) => n.startsWith('throttled__'))
      let tb = []
      for (const n of tf) {
        if (!existsSync(path.join(dirs[1], n))) continue
        const m = JSON.parse(readFileSync(path.join(dirs[0], n), 'utf8')), s = JSON.parse(readFileSync(path.join(dirs[1], n), 'utf8'))
        if (!m.derived || !s.derived) continue
        const dm = m.derived, ds = s.derived
        // FOUT in glyphs at the first text, and layout shift from font swaps: the shipped set must not be worse
        if ((ds.firstTextGlyphsNonBrand ?? 0) > (dm.firstTextGlyphsNonBrand ?? 0) + 24) tb.push(`${n}: first-screen fallback glyphs ${dm.firstTextGlyphsNonBrand} -> ${ds.firstTextGlyphsNonBrand}`)
        if ((ds.clsFromFontSwap ?? 0) > (dm.clsFromFontSwap ?? 0) + 0.005) tb.push(`${n}: CLS from font swap ${dm.clsFromFontSwap} -> ${ds.clsFromFontSwap}`)
        if ((ds.foitRiskAtFirstText || []).length) tb.push(`${n}: FOIT risk`)
        note(`${n}: fontBytesTotal ${fmt(dm.fontBytesTotal)} -> ${fmt(ds.fontBytesTotal)}, fallback glyphs at first text ${dm.firstTextGlyphsNonBrand} -> ${ds.firstTextGlyphsNonBrand}, CLS from fonts ${dm.clsFromFontSwap} -> ${ds.clsFromFontSwap}`)
      }
      check(`slow network (1.6 Mbps, CPU x4): no more fallback glyphs, no layout shift from fonts, no hidden text (${tf.length} runs)`, tb.length === 0 && tf.length > 0, tb.join('\n'))
    }
  } finally { px.forEach((p) => p.stop()) }
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  mkdirSync(REPORT, { recursive: true })
  console.log('fonts-used-weights: report dir ' + REPORT)
  const used = readUsed()
  console.log(`used-weights.json: Alexandria wght ${used.alexandria.min}-${used.alexandria.max} (${used.alexandria.used.join(' ')}), Plex faces ${[...used.plex].sort().join(' ')}`)
  const ctx = {}
  let mirror = null
  if (!STATIC_ONLY) {
    mirror = await startMirror()
    // the compiled stylesheet and the add-ons, read through the mirror: their @font-face rules and weights are part of the proof
    try {
      const html = await (await fetch(mirror.base + '/')).text()
      const css = {}, js = {}
      for (const m of html.matchAll(/(?:href|src)="(\/[^"?]+\.(css|js))(?:\?[^"]*)?"/g)) {
        const r = await fetch(mirror.base + m[1]); if (r.status !== 200) continue
        const t = await r.text(); ;(m[2] === 'css' ? css : js)[m[1]] = t
        if (m[2] === 'css' && /\/assets\/index-/.test(m[1])) { ctx.compiledCss = t; ctx.compiledCssName = m[1] }
        if (m[1] === '/boot.js') ctx.bootJs = t
      }
      const entry = /\/assets\/(index-[^"]+\.js)/.exec(html)
      if (entry) { const r = await fetch(mirror.base + '/assets/' + entry[1]); if (r.status === 200) js['/assets/' + entry[1]] = await r.text() }
      ctx.siteCss = css; ctx.siteJs = js
    } catch (e) { note('could not read the site stylesheets through the mirror: ' + e.message) }
  }
  const browser = await launch()
  const holder = { browser, async get() { if (!this.browser.isConnected()) { console.log('  (relaunching the browser)'); this.browser = await launch() } return this.browser } }
  try {
    if (LAYERS.has('A')) { layerA(used, ctx); await staticScan(used, ctx) }
    const weights = LAYERS.has('B') || LAYERS.has('D') ? await layerB(browser, used) : []
    if (!STATIC_ONLY && LAYERS.has('C')) {
      await layerC(holder, mirror, used, MASTERS, ctx)
      if (flag('--write-used')) {
        if (QUICK || opt('--routes', '')) console.log('  --write-used refused: it needs a FULL crawl (no --quick, no --routes)')
        else writeUsed(ctx, weights)
      }
    }
    if (!STATIC_ONLY && flag('--audit')) await auditCompare(mirror, MASTERS, used)
    if (!NO_MUTANTS && LAYERS.has('D')) await layerD(browser, used, ctx, weights)
  } finally { await holder.browser.close().catch(() => {}); mirror && mirror.stop() }
  const failed = results.filter((r) => !r.ok)
  writeFileSync(path.join(REPORT, 'results.json'), JSON.stringify({ results, failed: failed.length }, null, 1))
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. report: ${REPORT}`)
  if (failed.length) { console.log('FAILED:\n' + failed.map((f) => '  [' + f.section + '] ' + f.name).join('\n')); process.exit(1) }
  console.log('FONTS_USED_OK')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
