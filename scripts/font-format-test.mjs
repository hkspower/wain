/**
 * A font file is what its name says it is.
 *
 *   node scripts/font-format-test.mjs
 *
 * Four of the shop's .woff2 files (Anton and IBM Plex Sans 400/600/700) were
 * UNCOMPRESSED TrueType from 2026-09-19 to 2026-10-01: the subsetting script set
 * the woff2 flavour on its options object, which font.save() never reads. A
 * browser sniffs the first bytes and renders either format, so every font rig
 * passed and the shop looked right — while each first visit downloaded about
 * 140 KB more than it needed to. The only place the fault showed was the file's
 * own signature, so that is what this reads.
 */
import { readdirSync, readFileSync } from 'node:fs'

const DIR = new URL('../sporta-site/public_html/fonts/', import.meta.url).pathname
const SIG = { '.woff2': 'wOF2', '.woff': 'wOFF' }
let fails = 0, seen = 0
for (const f of readdirSync(DIR).sort()) {
  const ext = Object.keys(SIG).find((e) => f.endsWith(e))
  if (!ext) continue
  seen++
  const head = readFileSync(DIR + f).subarray(0, 4).toString('latin1')
  const ok = head === SIG[ext]
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} is ${ok ? SIG[ext] : 'NOT ' + SIG[ext] + ` (starts ${JSON.stringify(head)})`}`)
}
if (seen < 5) { console.log(`FAIL only ${seen} web fonts found in ${DIR}`); fails++ }
console.log(fails ? `\n${fails} failed` : `\nall ok — ${seen} web fonts, each in the format its name promises`)
process.exit(fails ? 1 : 0)
