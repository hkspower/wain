// npm run test:cat-tiles-wip   (static: reads files, no browser, no server, no database)
//
// The GRIDSTYLE section of public/sporta-cat-tiles.css ([gs-t1]..[gs-t3], owner: "improve grids style", 2026-11-11) is unreviewed
// work. It was moved on 2026-11-14 to addons-src/wip/sporta-cat-tiles-wip.css, a folder that Vite, make-package.mjs, file-audit and
// vps-deploy never read. This guard keeps it that way:
//   1. the shipped file carries none of the WIP markers (a future edit that puts the section back into public/ fails here);
//   2. the WIP file still exists and holds the whole section (nothing was deleted);
//   3. nothing under public/ refers to the WIP folder or file (no page or script can start loading it);
//   4. the "on" state, the shipped file with the WIP section put in front of its SIZES section, keeps SIZES as the last section
//      (its suite cuts the file at that marker and requires nothing after it).
// npm run test:grid-style measures the same "on" state in a browser; ops/release/release-addons-1.mjs runs this guard for the file.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const SHIPPED = join(PUB, 'sporta-cat-tiles.css')
const WIP = join(ROOT, 'addons-src', 'wip', 'sporta-cat-tiles-wip.css')
const SIZES = '/* ==== SIZES: HOME PAGE'
const WIP_MARKERS = ['/* ==== GRIDSTYLE', '[gs-t1]', '[gs-t2]', '[gs-t3]']
const WIP_REFERENCES = ['sporta-cat-tiles-wip', 'addons-src/wip', 'cat-tiles-wip']

let fails = 0, passes = 0
const ok = (c, m, d = '') => { if (c) passes++; else fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c || !d ? '' : '  - ' + d)) }

// 1. the shipped file
const shipped = readFileSync(SHIPPED, 'utf8')
for (const m of WIP_MARKERS) ok(!shipped.includes(m), `public/sporta-cat-tiles.css does not contain ${m}`)
ok(shipped.indexOf(SIZES) > 0, 'public/sporta-cat-tiles.css still has its SIZES section')

// 2. the WIP file
ok(existsSync(WIP), 'addons-src/wip/sporta-cat-tiles-wip.css exists (the work is kept, not deleted)')
const wip = existsSync(WIP) ? readFileSync(WIP, 'utf8') : ''
ok(wip.includes('/* ==== GRIDSTYLE:') && wip.includes('[gs-t1]') && wip.includes('[gs-t2]') && wip.includes('[gs-t3]'),
  'the WIP file holds the whole GRIDSTYLE section ([gs-t1], [gs-t2], [gs-t3])')
ok(!wip.includes(SIZES), 'the WIP file holds only the GRIDSTYLE section, not the SIZES section')

// 3. nothing under public/ points at the WIP folder or file
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const refs = []
for (const f of walk(PUB)) {
  if (statSync(f).size > 8e6) continue
  const t = readFileSync(f, 'utf8')
  if (WIP_REFERENCES.some((r) => t.includes(r))) refs.push(relative(ROOT, f))
}
ok(refs.length === 0, 'no file under public/ refers to the WIP folder or file', refs.join(', '))
ok(!existsSync(join(PUB, 'sporta-cat-tiles-wip.css')) && !existsSync(join(PUB, 'addons-src')), 'no copy of the WIP file or folder under public/')

// 4. the "on" state keeps SIZES last
const at = shipped.indexOf(SIZES)
const on = shipped.slice(0, at) + wip + shipped.slice(at)
const marks = [...on.matchAll(/\/\* ==== /g)].map((m) => m.index)
ok(marks.length > 0 && marks[marks.length - 1] === on.indexOf(SIZES), 'with the WIP section composed in, SIZES is still the last section of the file')

console.log(`\n${passes + fails} checks, ${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
