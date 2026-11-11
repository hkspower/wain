// Turns the "CAP <file> <i>/<n> <base64 of gzip>" lines of scripts/live-capture.mjs (taken from a saved job log, a tool-result file or
// a session transcript: any text that holds them) back into files.
//
//   node scripts/live-capture-unpack.mjs <log-or-transcript> <out-dir> [prefix] [needle]
//
// A capture run ends with the line CAPTURE_DONE. A transcript can hold several runs; with a `needle` (any text that only the wanted
// run holds, e.g. "CAP shop-out-ar.html") only the LAST run that contains it is read, so the `live.css` of one run is never mixed
// with another's.
//
// Every file is rebuilt from its numbered chunks (a chunk seen twice is the same chunk), gunzipped and written to
// <out-dir>/<prefix><file>. A file with a missing chunk is reported and skipped, never written half. `live.css` (the union of the
// rules every captured state matched) is rewritten once per capture run, so with several runs in one log pass a prefix per run and
// a log holding only that run (the chunks of two runs of the same file name would be mixed otherwise).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'

const [src, out, prefix = '', needle = ''] = process.argv.slice(2)
if (!src || !out) { console.error('usage: live-capture-unpack.mjs <log> <out-dir> [prefix] [needle]'); process.exit(2) }
let text = readFileSync(src, 'utf8')
if (needle) {
  const runs = text.split('CAPTURE_DONE').filter((r) => r.includes(needle + ' '))
  if (!runs.length) { console.error('no capture run contains ' + needle); process.exit(1) }
  text = runs[runs.length - 1]
}
const files = new Map()
for (const m of text.matchAll(/CAP ([A-Za-z0-9._-]+) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)/g)) {
  const [, name, i, n, b64] = m
  const f = files.get(name) ?? { n: Number(n), parts: new Map() }
  if (f.n !== Number(n)) { f.parts = new Map(); f.n = Number(n) }
  f.parts.set(Number(i), b64)
  files.set(name, f)
}
mkdirSync(out, { recursive: true })
let wrote = 0
for (const [name, f] of files) {
  const missing = []
  for (let i = 1; i <= f.n; i++) if (!f.parts.has(i)) missing.push(i)
  if (missing.length) { console.log(`SKIP ${name}: chunks ${missing.join(',')} of ${f.n} missing`); continue }
  const body = gunzipSync(Buffer.from([...Array(f.n).keys()].map((k) => f.parts.get(k + 1)).join(''), 'base64'))
  writeFileSync(join(out, prefix + name), body)
  console.log(`WROTE ${prefix}${name} ${body.length} bytes`)
  wrote++
}
console.log(`${wrote} of ${files.size} files`)
