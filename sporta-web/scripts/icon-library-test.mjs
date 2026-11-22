// npm run test:icon-library - proves the WHOLE Sporta icon set as a library (brand/iconset/*.svg, every glyph, not only the
// ones a page uses; the storefront and admin proofs are test:iconset and test:admin-iconset):
//   catalogue     the folder and scripts/lib/iconset-catalogue.mjs agree: every glyph is listed once, in one group, and no
//                 group is empty or unknown; names are lower-case with dashes; the set holds at least 95 glyphs
//   format        every source is one well-formed Sporta glyph: 24 grid, one 1.75 stroke, round caps and joins, currentColor,
//                 one non-empty title, only plain shapes (path, circle, rect, ellipse, line, polyline, polygon), no transform,
//                 style, class, image, script or external reference, a filled dot paints nothing but its own fill
//   drawing       no two glyphs draw the same thing
//   geometry      each glyph is drawn inside the grid (Chromium's getBBox: 1.5 to 22.5, so its stroke stays inside 0.6 to 23.4)
//   ink           each glyph paints at 16, 20 and 24px (the canvas of the SVG, measured pixel by pixel), and is not a solid blob
//   preview       brand/iconset/preview.html is what the generator writes, and it shows every group
// plus a MUTATION run: each broken source below must be refused, or the checks are not checking anything.
import { chromium } from 'playwright'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SET, glyphs, preview } from './build-iconset.mjs'
import { CATEGORIES, CATEGORY_OF } from './lib/iconset-catalogue.mjs'

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const WANT_ROOT = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
const SHAPES = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['width', 'height'], ellipse: ['rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'] }
const CHILD_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'fill', 'stroke'])

// Every reason a source is not a Sporta glyph (an empty list = it is one). Pure: the mutation run calls it on bad sources.
export const checkSource = (src) => {
  const errs = []
  const open = src.match(/^<svg\b([^>]*)>/)
  if (!open) return ['no <svg> root element']
  const rootAttrs = [...open[1].matchAll(/([\w:-]+)="([^"]*)"/g)]
  const rootText = open[1].replace(/([\w:-]+)="([^"]*)"/g, '').trim()
  if (rootText) errs.push(`text in the root tag: ${rootText}`)
  const got = Object.fromEntries(rootAttrs.map(([, k, v]) => [k, v]))
  for (const [k, v] of Object.entries(WANT_ROOT)) if (got[k] !== v) errs.push(`root ${k} is ${got[k] ?? 'missing'} (want ${v})`)
  for (const k of Object.keys(got)) if (!(k in WANT_ROOT) && k !== 'data-directional') errs.push(`root attribute ${k} is not allowed`)
  if ('data-directional' in got && got['data-directional'] !== 'true') errs.push('data-directional must be "true" when present')

  const titles = src.match(/<title>[^<]*<\/title>/g) || []
  if (titles.length !== 1) errs.push(`expected one <title>, found ${titles.length}`)
  const title = ((titles[0] || '').match(/<title>([^<]*)<\/title>/) || [])[1] || ''
  if (!title.trim()) errs.push('empty title')
  if (title.length > 90) errs.push('title longer than 90 characters')
  if (title && /^[a-z]/.test(title)) errs.push('title starts with a lower-case letter')

  const body = src.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[^<]*<\/title>/, '')
  if (/<\/[^>]*>/.test(body)) errs.push('a closing tag other than the root (a group or a nested element)')
  let drawn = 0
  for (const [, tag, rest] of body.matchAll(/<([A-Za-z][\w-]*)([^>]*?)\/?>/g)) {
    if (!(tag in SHAPES)) { errs.push(`<${tag}> is not a plain glyph shape`); continue }
    drawn++
    const attrs = Object.fromEntries([...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
    const junk = rest.replace(/([\w:-]+)="([^"]*)"/g, '').replace(/\/$/, '').trim()
    if (junk) errs.push(`<${tag}> has text that is not an attribute: ${junk}`)
    for (const k of Object.keys(attrs)) if (!CHILD_ATTRS.has(k)) errs.push(`<${tag}> attribute ${k} is not allowed`)
    for (const k of SHAPES[tag]) if (attrs[k] === undefined) errs.push(`<${tag}> has no ${k}`)
    if (attrs.fill !== undefined && attrs.fill !== 'none' && attrs.fill !== 'currentColor') errs.push(`<${tag}> fill ${attrs.fill} is not none or currentColor`)
    if (attrs.stroke !== undefined && attrs.stroke !== 'none' && attrs.stroke !== 'currentColor') errs.push(`<${tag}> stroke ${attrs.stroke} is not none or currentColor`)
  }
  if (drawn === 0) errs.push('draws nothing')
  return errs
}

// ---- catalogue ----------------------------------------------------------------------------------------------------
head('the catalogue and the folder agree')
const G = glyphs()
const files = readdirSync(SET).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort()
const listed = Object.keys(CATEGORY_OF).sort()
is(JSON.stringify(files) === JSON.stringify(listed), 'every source in brand/iconset is listed in the catalogue, and only those',
  `only in folder: ${files.filter((n) => !listed.includes(n)).join(', ') || 'none'}; only in catalogue: ${listed.filter((n) => !files.includes(n)).join(', ') || 'none'}`)
is(Object.values(CATEGORY_OF).every((c) => CATEGORIES.includes(c)), 'every glyph is in one of the groups in CATEGORIES')
is(CATEGORIES.every((c) => Object.values(CATEGORY_OF).includes(c)), 'every group holds at least one glyph')
is(files.length >= 95, `the set holds at least 95 glyphs (${files.length} now)`)
is(files.every((n) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n)), 'every glyph name is lower case with dashes')
console.log(`${files.length} glyphs in ${CATEGORIES.length} groups`)

// ---- preview -----------------------------------------------------------------------------------------------------
head('the preview page')
let pv = ''
try { pv = readFileSync(join(SET, 'preview.html'), 'utf8') } catch {}
is(pv === preview(), 'brand/iconset/preview.html is the page the generator writes (npm run build:iconset)')
for (const c of CATEGORIES) is(pv.includes(`<h3 class="cat">${c} <span>`), `the preview shows the group "${c}"`)
is(files.every((n) => pv.includes(`<div class="name">${n}`)), 'the preview shows every glyph by name')

// ---- format -------------------------------------------------------------------------------------------------------
head('every source is one Sporta glyph')
const seen = new Map()
for (const n of files) {
  const errs = checkSource(G[n].src)
  is(errs.length === 0, `${n}.svg is a well-formed Sporta glyph`, errs.join('; '))
  const key = G[n].inner.replace(/\s+/g, '')
  if (seen.has(key)) is(false, `${n}.svg draws the same as ${seen.get(key)}.svg`)
  else { seen.set(key, n); is(true, `${n}.svg draws something of its own`) }
}

// ---- geometry and ink (Chromium) ----------------------------------------------------------------------------------
head('drawn inside the grid, and painted at 16, 20 and 24px')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="host"></div></body></html>')
const items = files.map((n) => ({ n, src: G[n].src }))
const measured = await page.evaluate(async (list) => {
  const host = document.getElementById('host')
  const out = []
  for (const it of list) {
    host.innerHTML = it.src.replace('<svg ', '<svg width="24" height="24" style="display:block" ')
    const svg = host.querySelector('svg')
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    for (const el of svg.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon')) {
      const b = el.getBBox()
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height)
    }
    const ink = {}
    for (const px of [16, 20, 24]) {
      const img = new Image()
      const text = it.src.replace(/currentColor/g, '#000').replace('<svg ', `<svg width="${px}" height="${px}" `)
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text) })
      const c = document.createElement('canvas'); c.width = px; c.height = px
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px); ctx.drawImage(img, 0, 0, px, px)
      const d = ctx.getImageData(0, 0, px, px).data
      let cov = 0
      for (let i = 0; i < d.length; i += 4) cov += (255 - (d[i] + d[i + 1] + d[i + 2]) / 3) / 255
      ink[px] = cov
    }
    out.push({ n: it.n, minX, minY, maxX, maxY, ink })
  }
  return out
}, items)
const inside = (m) => m.minX >= 1.5 && m.minY >= 1.5 && m.maxX <= 22.5 && m.maxY <= 22.5
const MIN_INK = { 16: 4.5, 20: 7, 24: 10 }
for (const m of measured) {
  is(inside(m), `${m.n}.svg is drawn inside the grid (1.5 to 22.5)`, `x ${m.minX.toFixed(2)}..${m.maxX.toFixed(2)}, y ${m.minY.toFixed(2)}..${m.maxY.toFixed(2)}`)
  for (const px of [16, 20, 24]) {
    is(m.ink[px] >= MIN_INK[px], `${m.n}.svg paints ink at ${px}px`, `${m.ink[px].toFixed(1)} < ${MIN_INK[px]}`)
  }
  is(m.ink[24] < 0.5 * 24 * 24, `${m.n}.svg is a line drawing, not a solid blob`, `${m.ink[24].toFixed(0)} of 576 px`)
}

// ---- mutation: broken sources must be refused ---------------------------------------------------------------------
head('mutation: broken sources are refused')
const base = G.bell.src
const MUTANTS = {
  'stroke 2 (not 1.75)': base.replace('stroke-width="1.75"', 'stroke-width="2"'),
  'no title': base.replace(/<title>[^<]*<\/title>/, ''),
  'two titles': base.replace('</svg>', '<title>again</title></svg>'),
  'round caps replaced by butt': base.replace('stroke-linecap="round"', 'stroke-linecap="butt"'),
  'an image element': base.replace('</svg>', '<image href="x.png"/></svg>'),
  'a style attribute': base.replace('<path', '<path style="stroke:red"'),
  'a transform': base.replace('<path', '<path transform="translate(9 0)"'),
  'a group': base.replace('</svg>', '<g><circle cx="5" cy="5" r="1"/></g></svg>'),
  'a hard-coded colour': base.replace('<path', '<path fill="#000"'),
  'a hard-coded stroke colour': base.replace('<path', '<path stroke="#e0561c"'),
  'nothing drawn': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><title>Nothing</title></svg>',
}
for (const [label, src] of Object.entries(MUTANTS)) is(checkSource(src).length > 0, `mutant "${label}" is refused`)
// a shape past the grid must be caught by the browser measure, not the text checks
const OUT = base.replace('</svg>', '<circle cx="23.6" cy="12" r="1"/></svg>')
const [outMeasured] = await page.evaluate(async (list) => {
  const host = document.getElementById('host'); const out = []
  for (const it of list) {
    host.innerHTML = it.src.replace('<svg ', '<svg width="24" height="24" style="display:block" ')
    let maxX = -1e9
    for (const el of host.querySelectorAll('svg path, svg circle')) { const b = el.getBBox(); maxX = Math.max(maxX, b.x + b.width) }
    out.push({ maxX })
  }
  return out
}, [{ src: OUT }])
is(outMeasured.maxX > 22.5, 'a shape past the grid is caught by the measure (x 24.6 > 22.5)', `maxX ${outMeasured.maxX}`)
await browser.close()

if (fails.length) { console.log('\nFAILURES (first 60):'); for (const f of fails.slice(0, 60)) console.log('FAIL ' + f) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
