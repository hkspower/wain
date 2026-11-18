#!/usr/bin/env node
// A FILE-LEVEL RELEASE of the admin add-on.
//
//   node scripts/make-admin-snapshot.mjs --base <live file> --block "ADMIN INVOICES" [--block "..."] [--source public/sporta-admin-brands.js] [--out public/sporta-admin-brands.js]
//   node scripts/make-admin-snapshot.mjs --preset invoices      (= npm run snapshot:admin-invoices)
//
// WHY. `vps-deploy.mjs --only` takes top-level names, and public/sporta-admin-brands.js (the readable source, which the build splits into the
// loader and sporta-admin-brands.full.js) holds blocks whose server routes are NOT live yet (Shipping, Database center, Social, Footer,
// Add sizes ...). Shipping the whole file would put screens on /backends that answer 404. So a release carries the LIVE file plus only the
// blocks that run on routes the live server has: this script writes that file (the base, a blank line, each named block), and the commit that
// holds it is deployed by SHA (the 2026-11-12 scope A did the same by hand) and then reverted on the branch, so the branch keeps the whole
// source. A block is the text from its `/* ===== NAME - begin` line to the end of its `/* ===== NAME - end` line; a block that is already in the
// base is refused (it would run twice), and a block that is not in the source is refused.
//
// The base is a file whose bytes equal what is live: ops/release/sporta-admin-brands.trim-1112.js is the live sporta-admin-brands.full.js of
// 2026-11-12 (compare it with the live size in the deploy PLAN before applying: the plan prints "live bytes -> release bytes").
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
// presets: the live base file and the blocks a named release adds to it
const PRESETS = { invoices: { base: 'ops/release/sporta-admin-brands.trim-1112.js', blocks: ['ADMIN INVOICES'] } }
const preset = PRESETS[opt('--preset')] || {}
const blocks = preset.blocks || args.flatMap((a, i) => (a === '--block' ? [args[i + 1]] : []))
const base = preset.base || opt('--base'), source = opt('--source', 'public/sporta-admin-brands.js'), out = opt('--out', 'public/sporta-admin-brands.js')
if (!base || !blocks.length) { console.error('usage: make-admin-snapshot.mjs --base <live file> --block "NAME" [--block "NAME"] [--source <file>] [--out <file>]'); process.exit(2) }

const baseText = readFileSync(base, 'utf8'), srcText = readFileSync(source, 'utf8')
let text = baseText.replace(/\s+$/, '')
const taken = []
for (const name of blocks) {
  const begin = `/* ===== ${name} - begin`, end = `/* ===== ${name} - end`
  if (baseText.includes(begin)) { console.error(`refused: "${name}" is already in the base file`); process.exit(1) }
  const a = srcText.indexOf(begin), b = srcText.indexOf(end)
  if (a < 0 || b < a || srcText.indexOf(begin, a + 1) >= 0) { console.error(`refused: "${name}" is not in ${source} exactly once, begin before end`); process.exit(1) }
  const eol = srcText.indexOf('\n', b)
  const block = srcText.slice(a, eol < 0 ? srcText.length : eol)
  text += '\n\n' + block
  taken.push([name, block.length])
}
text += '\n'
writeFileSync(out, text)
console.log(`wrote ${out}: ${baseText.length} chars of base + ${taken.map(([n, l]) => `${n} (${l})`).join(' + ')} = ${text.length} chars`)
console.log(`sha256 ${createHash('sha256').update(text).digest('hex')}`)
