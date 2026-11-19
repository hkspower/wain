// JS-01 (JS-SCAN-2026-11-19.md): every top-level block of every add-on script is ONE try / catch, so a block that throws costs that block and
// nothing after it. An uncaught throw in a classic script stops the rest of the FILE; before this rule 59 of 79 blocks could do that.
//
// Held here:
//   1. every block of the ten add-on files follows the rule (read from the syntax tree, not from text) and every file still parses
//   2. the guard tool is idempotent on the shipped files, and on a file that has an unguarded block it adds the two lines and nothing else
//   3. behaviour, in a real VM: with an unguarded throwing block the next block never runs; with the guard it does
//   4. the rule has teeth: a block added without the guard, a block that follows another with no ";", a guard that only wraps part of the body
//   5. the one window.open of the catalogue engine carries 'noopener' (JS-02)
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { ADDON_FILES, blocksOf, guardSource } from './lib/js-blocks.mjs'

const PUB = fileURLToPath(new URL('../public/', import.meta.url))
let bad = 0, good = 0
const ok = (cond, msg, extra = '') => { if (cond) { good++; console.log('ok   ' + msg) } else { bad++; console.log('FAIL ' + msg + (extra ? '  — ' + extra : '')) } }
const head = (t) => console.log('\n=== ' + t + ' ' + '='.repeat(Math.max(3, 70 - t.length)))
const subsequence = (small, big) => { let i = 0; for (const l of big) if (i < small.length && l === small[i]) i++; return i === small.length }

head('1. every block of every add-on file is guarded')
let total = 0
for (const name of ADDON_FILES) {
  const path = PUB + name
  if (!existsSync(path)) { ok(false, name + ' exists'); continue }
  const src = readFileSync(path, 'utf8')
  let parses = true; try { new vm.Script(src, { filename: name }) } catch (e) { parses = false }
  ok(parses, `${name} parses as a classic script`)
  const B = blocksOf(src)
  total += B.length
  const bads = B.filter((b) => !b.guarded)
  ok(B.length > 0 && bads.length === 0, `${name}: all ${B.length} top-level block(s) are one try / catch`, bads.map((b) => 'line ' + b.line + (b.reason ? ' ' + b.reason : '')).join('; '))
}
ok(total >= 75, `${total} blocks in all (the number can grow, not shrink below what shipped)`)

head('2. the guard tool changes nothing on the shipped files, and only adds two lines per block elsewhere')
for (const name of ADDON_FILES) {
  const src = readFileSync(PUB + name, 'utf8')
  const g = guardSource(src)
  ok(g.changed === 0 && g.out === src, `${name}: running the tool again changes nothing`)
}
{
  const sample = ";(function () {\n  'use strict'\n  var a = 1   // keep\n  window.q = a\n})()\n;(function () {   // second block\n  window.r = 2\n})()\n"
  const g = guardSource(sample)
  ok(g.changed === 2, 'a sample with two unguarded blocks gets two guards', 'changed ' + g.changed)
  ok(g.out.split('\n').length - sample.split('\n').length === 4, 'two lines per block were added (try { and } catch (e) {})')
  ok(subsequence(sample.split('\n'), g.out.split('\n')), 'every original line is still there, in order, untouched')
  ok(/\{   \/\/ second block\n  try \{\n/.test(g.out), 'a trailing comment on the opening line stays on its line (the try goes below it)')
  ok(blocksOf(g.out).every((b) => b.guarded) && guardSource(g.out).changed === 0, 'the result follows the rule and is stable')
  new vm.Script(g.out)
  ok(true, 'the result parses')
}

head('3. behaviour: one block throws, the next one still runs')
{
  const run = (code) => { const ctx = vm.createContext({ window: {} }); let err = null; try { vm.runInContext(code, ctx) } catch (e) { err = e } return { err, win: ctx.window } }
  const two = ";(function () {\n  'use strict'\n  window.first = 1\n  null.boom\n  window.afterBoom = 1\n})()\n;(function () {\n  'use strict'\n  window.second = 1\n})()\n"
  const before = run(two)
  ok(before.err && before.win.second === undefined, 'unguarded: the throw stops the file, the second block never runs', before.err ? '' : 'it did not throw')
  const after = run(guardSource(two).out)
  ok(!after.err && after.win.second === 1, 'guarded: no error escapes, the second block runs')
  ok(after.win.first === 1 && after.win.afterBoom === undefined, 'guarded: the failing block keeps what ran before the throw and loses the rest of itself only')
  const early = ";(function () {\n  'use strict'\n  if (window.__x) return\n  window.__x = 1\n  window.done = 1\n})()\n"
  const r1 = run(guardSource(early).out)
  ok(!r1.err && r1.win.done === 1, 'a block that starts with `if (window.__flag) return` still returns early and still runs when the flag is unset')
}

head('4. the rule has teeth')
{
  const base = readFileSync(PUB + 'sporta-clock.js', 'utf8')
  const mutant = base + "\n;(function () {\n  'use strict'\n  document.title = 'x'\n})()\n"
  const B = blocksOf(mutant)
  ok(B.length === 2 && B.filter((b) => !b.guarded).length === 1, 'a block added without the guard is found (1 of 2)')
  const half = ";(function () {\n  'use strict'\n  var a = document.body.firstChild.nodeName\n  try { window.z = a } catch (e) {}\n})()\n"
  ok(blocksOf(half).some((b) => !b.guarded), 'a block whose try covers only the END of its body is not guarded (the first line can still throw)')
  const noCatch = ";(function () {\n  'use strict'\n  try { window.z = 1 } finally { window.y = 1 }\n})()\n"
  ok(blocksOf(noCatch).some((b) => !b.guarded), 'try / finally with no catch is not a guard')
  const asi = "(function () { window.a = 1 })()\n(function () { window.b = 1 })()\n"
  ok(blocksOf(asi).some((b) => b.kind === 'other'), 'a block that follows another with no ";" is parsed as a call of the first one and is reported')
}

head('5. JS-02: the catalogue download fallback opens its window with noopener')
{
  const src = readFileSync(PUB + 'sporta-catalogue.js', 'utf8')
  const opens = [...src.matchAll(/window\.open\s*\(([^)]*)\)/g)].map((m) => m[1])
  ok(opens.length >= 1 && opens.every((a) => /'noopener'/.test(a)), `every window.open (${opens.length}) names 'noopener'`)
}

console.log(`\n${good} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
