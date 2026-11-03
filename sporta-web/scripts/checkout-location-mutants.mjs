// Mutation check for public/sporta-gov-autopick.js (the optional checkout location control and its
// "never persisted" rule). For each behaviour added in the 2026-11-03 stale-pin fix it makes a copy of the add-on
// WITHOUT that one behaviour, points scripts/checkout-location-test.mjs at the copy (SPORTA_GOV_JS) and requires
// the suite to FAIL. A mutation that does not apply to the source (the text moved) is itself an error, so this
// cannot go quietly green.
//
//   node scripts/checkout-location-mutants.mjs            (all)       node scripts/checkout-location-mutants.mjs guard
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'public/sporta-gov-autopick.js'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'loc-mutants-'))

// [name, sections to run, [from, to]...]
const M = [
  ['guard', 'M,N,O', ["if (window.__sportaLocJs || (root0 && root0.__sportaLocJs)) return;", '']],
  ['set-wrapper', 'M,N', ['SP.setItem = set; SP.getItem = get;', 'SP.getItem = get;']],
  ['get-filter', 'M,N', ['SP.setItem = set; SP.getItem = get;', 'SP.setItem = set;']],
  ['load-scrub', 'M,N', ['  install();\n  scrubStored();', '  install();']],
  ['navigation-scrub', 'M,N', ['if (onCheckout()) scrubStored();', '']],
  ['exact-key-only', 'M,N', ['function isKey(k) { try { return k === STORE_KEY || String(k) === STORE_KEY; } catch (e) { return false; } }', 'function isKey(k) { return true; }']],
  ['note-field-only', 'M,N', ["if (k === 'note' && typeof val === 'string') {", "if (typeof val === 'string') {"]],
  ['json-only-when-changed', 'M,N', ['return changed ? JSON.stringify(data) : v;', 'return JSON.stringify(data);']],
  ['session-storage', 'M,N', ["['localStorage', 'sessionStorage'].forEach", "['localStorage'].forEach"]],
  ['watchdog', 'M,O', ['var WATCHDOG_MS = 25000;', 'var WATCHDOG_MS = 2147483647;']],
  ['late-answer-ignored', 'M,O', ["if (mine === token && busy) { token++; finish(token, 'fail'); }", "if (mine === token && busy) { finish(token, 'fail'); }"]],
  ['retry-on-timeout', 'M,O', ['err.code === 3 && !retried && mine === token', 'false']],
  ['retry-only-once', 'M,O', ['err.code === 3 && !retried && mine === token', 'err.code === 3 && mine === token']],
  ['reject-zero-zero', 'M,O', [' || (lat === 0 && lng === 0)', '']],
  ['reject-null', 'M,O', ['c.latitude === null || c.longitude === null || ', '']],
  ['reject-out-of-range', 'M,O', ['|| Math.abs(lat) > 90 || Math.abs(lng) > 180', '']],
  ['helper-en', 'M,H,O', ['Added to your delivery note and shared only with the shop and the delivery team.', 'Sent only with this order.']],
  ['helper-ar', 'M,H,O', ['يُضاف إلى ملاحظة التوصيل ويصل إلى المتجر وفريق التوصيل فقط.', 'ويُرسل مع هذا الطلب فقط.']],
  ['not-added-earlier', 'M,F', ['A location is in your note. Remove it if you are somewhere else now.', 'Location added earlier. Remove it if you are somewhere else now.']],
]

const only = process.argv[2]
let bad = 0
for (const [name, sections, ...edits] of M) {
  if (only && only !== name) continue
  let src = SRC
  for (const [from, to] of edits) {
    if (src.split(from).length !== 2) { console.log(`ERROR ${name}: the text to remove is not in the add-on exactly once`); bad++; src = null; break }
    src = src.replace(from, () => to)
  }
  if (src === null) continue
  const file = join(dir, name + '.js')
  writeFileSync(file, src)
  const r = spawnSync('node', [join(ROOT, 'scripts/checkout-location-test.mjs')], { env: { ...process.env, SPORTA_GOV_JS: file, SPORTA_SECTIONS: sections }, encoding: 'utf8', timeout: 900000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'))
  const ok = r.status !== 0 && fails.length > 0
  if (!ok) bad++
  console.log(`${ok ? 'killed ' : 'SURVIVED'} ${name.padEnd(24)} ${fails.length} failing check(s)${fails[0] ? '  e.g. ' + fails[0].slice(5, 90) : ''}`)
}
console.log(bad ? `\n${bad} mutation(s) not caught` : '\nevery mutation is caught by the suite')
process.exit(bad ? 1 : 0)
