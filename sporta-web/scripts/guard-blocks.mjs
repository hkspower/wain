// Guards every top-level block of the add-on scripts with one try / catch (JS-01 of JS-SCAN-2026-11-19.md).
//   node scripts/guard-blocks.mjs            report which blocks lack the guard (exit 1 if any)
//   node scripts/guard-blocks.mjs --write    insert the guard; changes nothing else, and running it twice changes nothing more
// The rule itself lives in scripts/lib/js-blocks.mjs and is held by `npm run test:js-guard`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { ADDON_FILES, blocksOf, guardSource } from './lib/js-blocks.mjs'

const PUB = fileURLToPath(new URL('../public/', import.meta.url))
const write = process.argv.includes('--write')
let missing = 0, wrote = 0
for (const name of ADDON_FILES) {
  const path = PUB + name
  if (!existsSync(path)) continue
  const src = readFileSync(path, 'utf8')
  const blocks = blocksOf(src)
  const bad = blocks.filter((b) => !b.guarded)
  missing += bad.length
  console.log(`${name}: ${blocks.length} blocks, ${bad.length} without the guard${bad.length ? ' (lines ' + bad.map((b) => b.line).join(', ') + ')' : ''}`)
  for (const b of bad.filter((x) => x.kind !== 'iife')) console.log(`   NOT FIXABLE HERE: line ${b.line}: ${b.reason}`)
  if (write && bad.some((b) => b.kind === 'iife')) {
    const { out, changed } = guardSource(src)
    new vm.Script(out, { filename: name })   // the result must still parse
    const again = blocksOf(out).filter((b) => b.kind === 'iife' && !b.guarded)
    if (again.length) throw new Error(name + ': ' + again.length + ' blocks still unguarded after the write')
    writeFileSync(path, out)
    wrote += changed
    console.log(`   guarded ${changed} block(s)`)
  }
}
console.log(write ? `done: ${wrote} block(s) guarded` : `${missing} block(s) without the guard`)
process.exitCode = !write && missing ? 1 : 0
