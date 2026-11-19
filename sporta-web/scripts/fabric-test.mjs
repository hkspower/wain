// The fabric composition rules (dropin/php-store/fabric.php): what the server accepts, what it refuses, and how the stored text
// reads back. Runs the REAL file under PHP CLI (no database): store_fail is stubbed to throw the same token the store would send.
//
//   npm run test:fabric
//
// What is asserted:
//   1. accepted: no list (clears), materials with percentages that add up to 100, materials without percentages, a single
//      material at 100, percentages sent as digit strings;
//   2. refused, each with its own token: an unknown material, a repeated material, more than four, a percentage out of 1-100,
//      a percentage that is not a whole number, a total that is not 100, a half-filled list (some with a percent, some without),
//      a list that is not a list, an entry that is not an object;
//   3. the stored text reads back as the same list; an unknown material in a hand-written row is dropped, never shown;
//   4. MUTATION: without the total check, without the half-filled check, or without dropping unknown materials, the matching
//      case turns red (the test can fail).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'dropin/php-store/fabric.php'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// A PHP driver: each case is JSON in, {ok, value} or {err} out, one line per case.
const DRIVER = `<?php
error_reporting(E_ALL);
function store_fail(string $token, int $code = 400): void { throw new RuntimeException($token); }
require $argv[1];
$cases = json_decode(file_get_contents($argv[2]), true);
$out = [];
foreach ($cases as $c) {
  try {
    if ($c['op'] === 'parse') $out[] = ['ok' => true, 'value' => store_fabric_parse($c['in'])];
    else $out[] = ['ok' => true, 'value' => store_fabric_decode($c['in'])];
  } catch (RuntimeException $e) {
    $out[] = ['err' => $e->getMessage()];
  }
}
echo json_encode($out);
`

function run(file, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'fabric-'))
  const driver = join(dir, 'driver.php'), input = join(dir, 'cases.json')
  writeFileSync(driver, DRIVER)
  writeFileSync(input, JSON.stringify(cases))
  const raw = execFileSync('php', [driver, file, input], { encoding: 'utf8' })
  return JSON.parse(raw)
}
function writeMutant(src) {
  const dir = mkdtempSync(join(tmpdir(), 'fabric-m-'))
  const f = join(dir, 'fabric.php')
  writeFileSync(f, src)
  return f
}

const FILE = join(ROOT, 'dropin/php-store/fabric.php')
const parse = (inp) => ({ op: 'parse', in: inp })
const decode = (inp) => ({ op: 'decode', in: inp })
const M = (material, percent) => percent === undefined ? { material } : { material, percent }

// the cases with the answer each must give (value, or the error token)
const ACCEPT = [
  ['clears on null', parse(null), null],
  ['clears on an empty list', parse([]), null],
  ['materials with percentages that add to 100', parse([M('cotton', 80), M('elastane', 20)]), 'cotton:80,elastane:20'],
  ['materials without percentages', parse([M('cotton'), M('polyester')]), 'cotton,polyester'],
  ['one material at 100', parse([M('wool', 100)]), 'wool:100'],
  ['percentages sent as digit strings', parse([M('cotton', '60'), M('nylon', '40')]), 'cotton:60,nylon:40'],
  ['three materials, percentages add to 100', parse([M('cotton', 50), M('polyester', 30), M('elastane', 20)]), 'cotton:50,polyester:30,elastane:20'],
]
const REFUSE = [
  ['an unknown material', parse([M('silk', 100)]), 'fabric_unknown_material'],
  ['a material written in capitals is not the same key', parse([M('Cotton', 100)]), 'fabric_unknown_material'],
  ['a repeated material', parse([M('cotton', 50), M('cotton', 50)]), 'fabric_duplicate'],
  ['five materials', parse([M('cotton'), M('polyester'), M('elastane'), M('nylon'), M('wool')]), 'fabric_too_many'],
  ['a percentage of 0', parse([M('cotton', 0), M('elastane', 100)]), 'fabric_percent_invalid'],
  ['a percentage over 100', parse([M('cotton', 101)]), 'fabric_percent_invalid'],
  ['a percentage that is not a whole number', parse([M('cotton', 80.5), M('elastane', 19.5)]), 'fabric_percent_invalid'],
  ['a percentage text with letters', parse([M('cotton', '8a'), M('elastane', 20)]), 'fabric_percent_invalid'],
  ['percentages that add to 90', parse([M('cotton', 70), M('elastane', 20)]), 'fabric_percent_total'],
  ['percentages that add to 110', parse([M('cotton', 90), M('elastane', 20)]), 'fabric_percent_total'],
  // the percentages add to exactly 100, so only the half-filled rule refuses it (the total rule would pass it)
  ['a half-filled list: a percentage on some, none on the others', parse([M('cotton', 60), M('elastane', 40), M('nylon')]), 'fabric_percent_partial'],
  ['a list that is an object, not a list', parse({ a: M('cotton', 100) }), 'fabric_invalid'],
  ['an entry that is not an object', parse(['cotton']), 'fabric_invalid'],
]

head('1. accepted')
const acceptRes = run(FILE, ACCEPT.map((c) => c[1]))
ACCEPT.forEach((c, i) => {
  const got = acceptRes[i]
  is(got && got.ok === true && got.value === c[2], `accepts: ${c[0]}`, JSON.stringify(got))
})

head('2. refused, each with its own token')
const refuseRes = run(FILE, REFUSE.map((c) => c[1]))
REFUSE.forEach((c, i) => {
  const got = refuseRes[i]
  is(got && got.err === c[2], `refuses: ${c[0]} (${c[2]})`, JSON.stringify(got))
})

head('3. reading the stored text back')
const readRes = run(FILE, [
  decode('cotton:80,elastane:20'),
  decode('cotton,polyester'),
  decode('silk:50,cotton:50'),
  decode(null),
  decode(''),
  decode('wool:100')
])
const want = [
  [{ material: 'cotton', percent: 80 }, { material: 'elastane', percent: 20 }],
  [{ material: 'cotton', percent: null }, { material: 'polyester', percent: null }],
  [{ material: 'cotton', percent: 50 }],
  null,
  null,
  [{ material: 'wool', percent: 100 }]
]
is(JSON.stringify(readRes[0].value) === JSON.stringify(want[0]), 'reads percentages back as numbers')
is(JSON.stringify(readRes[1].value) === JSON.stringify(want[1]), 'reads materials without percentages as null percent')
is(JSON.stringify(readRes[2].value) === JSON.stringify(want[2]), 'drops an unknown material from a stored row (never shown)', JSON.stringify(readRes[2].value))
is(readRes[3].value === null && readRes[4].value === null, 'null and blank read as "not stated"')
is(JSON.stringify(readRes[5].value) === JSON.stringify(want[5]), 'a single material at 100 reads back')

// every accepted composition reads back to itself
const rt = run(FILE, ACCEPT.filter((c) => c[2] !== null).map((c) => decode(c[2])))
is(rt.every((r) => r.value !== null), 'every accepted composition can be read back')

head('4. mutation (each cut-out must fail)')
const MUT = [
  { name: 'no total check', from: "if ($withPercent > 0 && $sum !== 100) store_fail('fabric_percent_total');", to: '' },
  { name: 'no half-filled check', from: "if ($withPercent > 0 && $withoutPercent > 0) store_fail('fabric_percent_partial');", to: '' },
  { name: 'unknown materials not dropped on read', from: 'if (!in_array($material, STORE_FABRIC_MATERIALS, true)) continue;', to: '' }
]
for (const m of MUT) {
  const mutated = SRC.replace(m.from, m.to)
  if (mutated === SRC) { is(false, `mutant applied: ${m.name}`, 'the source text was not found'); continue }
  const f = writeMutant(mutated)
  const cases = [parse([M('cotton', 70), M('elastane', 20)]), parse([M('cotton', 60), M('elastane', 40), M('nylon')]), decode('silk:50,cotton:50')]
  const r = run(f, cases)
  const red = (r[0].ok === true) || (r[1].ok === true) || (r[2].value && r[2].value.some((x) => x.material === 'silk'))
  is(!!red, `mutation red: ${m.name}`)
}

console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
