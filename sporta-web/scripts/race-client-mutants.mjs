// Mutation check for scripts/race-client-test.mjs (lane K3). One behaviour is taken out of a fixed file at a time, the suite is
// run against the broken copy, and the run is only "killed" when the assertions that guard THAT behaviour fail. A mutant the
// suite does not notice is a hole in the suite, and the script exits non-zero.
//
//   node scripts/race-client-mutants.mjs                 every mutant
//   node scripts/race-client-mutants.mjs G01 V02         just these
//
// How a mutant is run: the broken copy is written under a scratch directory and the suite is pointed at it with
// SPORTA_GUARDS_JS (public/birthday.js) / SPORTA_GOV_JS (public/sporta-gov-autopick.js) for the live add-ons, or, for the repo's
// own app (src/), a copy of the working tree is mutated, built with scripts/checkout-split-harness.mjs and passed as
// SPORTA_SRC_DIST. The checkout mutants (K*) mutate a copy that has the Checkout.jsx patch applied
// (SPORTA_CHECKOUT_PATCH=<path to checkout-races.patch>; without it they are skipped, not passed).
//
// Needs the live capture for the G and V mutants, like the suite (SPORTA_LIVE_CAPTURE).
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildSite, copyTree, workDir, rmrf } from './checkout-split-harness.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(WEB, f), 'utf8')
const SCRATCH = join(process.env.SPLIT_WORK || tmpdir(), 'race-client-mutants')
mkdirSync(SCRATCH, { recursive: true })

// swap(from, to): replace one exact piece of text; the mutant is invalid (and says so) if the piece is not there exactly once
const swap = (from, to) => (src) => {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`mutation anchor found ${n} times: ${from.slice(0, 70)}`)
  return src.replace(from, to)
}

// expect: prefixes of the FAIL lines that must appear (every one of them)
const MUTANTS = [
  // ---- public/birthday.js : the bag guard, the code box, the way back from the bank
  { id: 'G01', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A1.1', 'A2.1', 'A3.1', 'A6 merge'],
    what: 'the bag guard is never installed', mutate: swap('    SP.setItem = set; SP.getItem = get\n', '') },
  { id: 'G02', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A1.1', 'A6 merge: a line the other tab removed'],
    what: 'a line the other tab removed is put back (the merge keeps every line of this tab)', mutate: swap('if (!was || qty(mine[i]) !== qty(was) || mine[i].price !== was.price) out.push(mine[i])', 'out.push(mine[i])') },
  { id: 'G03', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A4'],
    what: 'a hidden tab never refreshes itself', mutate: swap('if (stale && document.hidden && !standDown() && safeToReload())', 'if (false)') },
  { id: 'G04', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A5'],
    what: 'a hidden tab reloads wherever it is (a checkout with a typed name too)', mutate: swap('function safeToReload() {', 'function safeToReload() { return true') },
  { id: 'G05', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A6 when the repo app'],
    what: 'the guard does not stand down for the repo app', mutate: swap("function standDown() { return !!window.__sportaCartOwn }", 'function standDown() { return false }') },
  { id: 'G06', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A6 merge: a quantity cannot be pushed below 1'],
    what: 'a merged quantity may fall below 1', mutate: swap('line.qty = Math.min(99, Math.max(1, qty(t) + delta))', 'line.qty = Math.min(99, qty(t) + delta)') },
  { id: 'G07', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'A', expect: ['A6 merge: concurrent quantity changes'],
    what: 'a quantity change replaces the other tab\'s quantity instead of adding to it', mutate: swap('if (delta) line.qty = Math.min(99, Math.max(1, qty(t) + delta))', 'if (delta) line.qty = Math.min(99, Math.max(1, qty(m)))') },
  { id: 'G08', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'C', expect: ['C2b'],
    what: 'Enter in the code box is not held while a request is out', mutate: swap('if (apply && apply.disabled) { e.preventDefault(); e.stopPropagation() }', '') },
  { id: 'G09', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'B', expect: ['B2.1', 'B3.1'],
    what: 'a restored checkout that is stuck is not reloaded', mutate: swap('try { if (document.querySelector(\'form[aria-busy="true"]\')) location.reload() } catch (err) { /* ignore */ }', '') },
  { id: 'G10', file: 'public/birthday.js', env: 'SPORTA_GUARDS_JS', sections: 'B', expect: ['B4'],
    what: 'every restored checkout is reloaded, stuck or not', mutate: swap('if (document.querySelector(\'form[aria-busy="true"]\')) location.reload()', 'location.reload()') },
  // ---- public/sporta-gov-autopick.js
  { id: 'V01', file: 'public/sporta-gov-autopick.js', env: 'SPORTA_GOV_JS', sections: 'D', expect: ['D1.1'],
    what: 'the auto-pick puts its older area text back over what the customer typed', mutate: swap('if (a.value || gov.value !== want) return;', '') },
  { id: 'V02', file: 'public/sporta-gov-autopick.js', env: 'SPORTA_GOV_JS', sections: 'E', expect: ['E4b', 'E4c'],
    what: 'a late start leaves the old pin in the drawn quick checkout', mutate: swap("if (scrubStored() && onCheckout() && document.querySelector('.purchase-quick'))", 'if (false)') },
  { id: 'V03', file: 'public/sporta-gov-autopick.js', env: 'SPORTA_GOV_JS', sections: 'E', expect: ['E1c'],
    what: 'the answer of an abandoned lookup is written into the page that came back', mutate: swap("  function arrived(mine, pos) {\n    if (mine !== token) return;\n", "  function arrived(mine, pos) {\n") },
  // ---- the repo's own app (src/)
  { id: 'S01', file: 'src/lib/cart.jsx', build: true, sections: 'F', expect: ['F1b.1', 'F3'],
    what: 'the bag does not listen to the other tabs', mutate: swap("window.addEventListener('storage', onStorage)", '') },
  { id: 'S02', file: 'src/lib/cart.jsx', build: true, sections: 'F', expect: ['F5 '],
    what: 'a restored or re-shown tab does not read the bag again', mutate: swap("window.addEventListener('pageshow', onShow)", '') },
  { id: 'S03', file: 'src/lib/cart.jsx', build: true, sections: 'F', expect: ['F5b'],
    what: 'a tab that becomes visible again does not read the bag again', mutate: swap("document.addEventListener('visibilitychange', onVisible)", '') },
  { id: 'S04', file: 'src/pages/TrackOrder.jsx', build: true, sections: 'F', expect: ['F4'],
    what: 'an older lookup may overwrite a newer one', mutate: swap('if (mine !== ticket.current) return\n      if (!row)', 'if (!row)') },
  // ---- the repo checkout WITH the patch (races/K3/checkout-races.patch)
  { id: 'K01', file: 'src/pages/Checkout.jsx', build: true, patch: true, sections: 'H', expect: ['H1'],
    what: 'the code box answers every Enter', mutate: swap('if (!entered || asking.current) return', 'if (!entered) return') },
  { id: 'K02', file: 'src/pages/Checkout.jsx', build: true, patch: true, sections: 'H', expect: ['H2'],
    // two layers each hide an answer for a bag that is gone (the late-answer check in the code box, and the key the summary
    // compares); the mutant takes out both, because either alone is enough to pass
    what: 'a code answered for an old bag is applied to the new one',
    mutate: (src) => swap('const appliedNow = applied && applied.cartKey === cartKey ? applied : null', 'const appliedNow = applied')(
      swap("if (cartKeyNow.current !== askedFor) { setState({ busy: false, error: '' }); return }", '')(src)) },
  { id: 'K03', file: 'src/pages/Checkout.jsx', build: true, patch: true, sections: 'H', expect: ['H3'],
    what: 'the checkout restored from the cache stays busy', mutate: swap("window.addEventListener('pageshow', onShow)", '') },
]

const want = process.argv.slice(2)
const list = MUTANTS.filter((m) => !want.length || want.includes(m.id))
let survived = 0, skipped = 0
const rows = []
for (const m of list) {
  process.stdout.write(`${m.id}  ${m.what} ... `)
  const env = { ...process.env, SPORTA_SECTIONS: m.sections, RACE_ROUNDS: '1' }
  let cleanup = null
  try {
    if (m.patch && !process.env.SPORTA_CHECKOUT_PATCH) { console.log('SKIPPED (set SPORTA_CHECKOUT_PATCH to the patch file)'); skipped++; continue }
    if (m.build) {
      const dir = workDir('race-mutant')
      cleanup = dir
      const root = copyTree(dir)
      if (m.patch) execFileSync('patch', ['-p1', '-i', process.env.SPORTA_CHECKOUT_PATCH], { cwd: dir, stdio: 'pipe' })
      writeFileSync(join(root, m.file), m.mutate(readFileSync(join(root, m.file), 'utf8')))
      env.SPORTA_SRC_DIST = buildSite(root, join(dir, 'dist'))
      if (m.patch) env.SPORTA_CHECKOUT_PATCHED = '1'
    } else {
      const f = join(SCRATCH, `${m.id}-${m.file.split('/').pop()}`)
      writeFileSync(f, m.mutate(read(m.file)))
      env[m.env] = f
    }
  } catch (e) {
    console.log('INVALID — ' + e.message); survived++; continue
  }
  const r = spawnSync(process.execPath, [join(WEB, 'scripts/race-client-test.mjs')], { env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 20 * 60 * 1000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'))
  const missing = m.expect.filter((p) => !fails.some((l) => l.slice(5).startsWith(p)))
  const killed = missing.length === 0
  if (!killed) survived++
  rows.push({ id: m.id, killed, fails: fails.length })
  console.log(killed ? `killed (${fails.length} failing assertions)` : `SURVIVED — expected failures not seen: ${missing.join(', ')}`)
  if (cleanup) rmrf(cleanup)
}
console.log(`\n${rows.filter((r) => r.killed).length} killed, ${survived} survived or invalid${skipped ? `, ${skipped} skipped` : ''} of ${list.length}`)
process.exit(survived ? 1 : 0)
