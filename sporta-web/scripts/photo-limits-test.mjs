// The pixel limit for an uploaded product photo (dropin/php-store/photo-limits.php, used by admin.php product_image_upload).
// Runs the REAL file under PHP CLI, with no database.
//
//   npm run test:photo-limits
//
// What is asserted:
//   1. accepted: a camera photograph (4000 x 3000), the largest allowed frame (6000 x 4000 = 24 megapixels), a 1 x 1 picture;
//   2. refused: a side over 6000, the total over 24 megapixels (6001 x 4001), a zero or missing side;
//   3. a real PNG whose HEADER declares 10000 x 10000 (a few hundred bytes of file) is read by getimagesizefromstring and refused;
//   4. MUTATION: without the pixel total, the 6001 x 4001 case turns green and the test goes red.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'dropin/php-store/photo-limits.php')
const SRC = readFileSync(FILE, 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const DRIVER = `<?php
require $argv[1];
$out = [];
// a PNG header only: signature, IHDR with the given size, no image data. getimagesizefromstring reads the header.
function png_header(int $w, int $h): string {
  $ihdr = pack('N', $w) . pack('N', $h) . chr(8) . chr(2) . chr(0) . chr(0) . chr(0);
  $chunk = pack('N', 13) . 'IHDR' . $ihdr . pack('N', crc32('IHDR' . $ihdr));
  return "\\x89PNG\\r\\n\\x1a\\n" . $chunk;
}
$cases = json_decode(file_get_contents($argv[2]), true);
foreach ($cases as $c) {
  if (isset($c['png'])) {
    $info = @getimagesizefromstring(png_header($c['png'][0], $c['png'][1]));
    $out[] = is_array($info) ? (store_photo_size_ok((int)$info[0], (int)$info[1]) ? 'ok' : 'refused') : 'unreadable';
  } else {
    $out[] = store_photo_size_ok($c['w'], $c['h']) ? 'ok' : 'refused';
  }
}
echo json_encode($out);
`

function run(file, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-limits-'))
  const driver = join(dir, 'driver.php'), input = join(dir, 'cases.json')
  writeFileSync(driver, DRIVER)
  writeFileSync(input, JSON.stringify(cases))
  return JSON.parse(execFileSync('php', [driver, file, input], { encoding: 'utf8' }))
}

const ACCEPT = [
  ['a camera photograph 4000 x 3000', { w: 4000, h: 3000 }],
  ['the largest frame 6000 x 4000 (24 megapixels)', { w: 6000, h: 4000 }],
  ['a 1 x 1 picture', { w: 1, h: 1 }]
]
const REFUSE = [
  ['a side over 6000', { w: 6001, h: 1 }],
  ['a height over 6000', { w: 1, h: 6001 }],
  ['over 24 megapixels, inside both sides (5000 x 5000 = 25 megapixels)', { w: 5000, h: 5000 }],
  ['over 24 megapixels and a side over 6000 (6001 x 4001)', { w: 6001, h: 4001 }],
  ['a zero side', { w: 0, h: 100 }],
  ['a zero height', { w: 100, h: 0 }],
  ['a real PNG header declaring 10000 x 10000', { png: [10000, 10000] }]
]

head('1. accepted and refused sizes')
const acc = run(FILE, ACCEPT.map((c) => c[1]))
ACCEPT.forEach((c, i) => is(acc[i] === 'ok', `accepts: ${c[0]}`, acc[i]))
const ref = run(FILE, REFUSE.map((c) => c[1]))
REFUSE.forEach((c, i) => is(ref[i] === 'refused', `refuses: ${c[0]}`, ref[i]))

head('2. mutation (the cut-out must fail)')
const mutated = SRC.replace('return $width * $height <= STORE_PHOTO_MAX_PIXELS;', 'return true;')
if (mutated === SRC) is(false, 'mutant applied: no pixel total', 'the source text was not found')
else {
  const dir = mkdtempSync(join(tmpdir(), 'photo-limits-m-'))
  const f = join(dir, 'photo-limits.php')
  writeFileSync(f, mutated)
  // 5000 x 5000 passes both side limits, so only the pixel total can refuse it
  const m = run(f, [{ w: 5000, h: 5000 }])
  is(m[0] === 'ok', 'mutation red: without the pixel total, 5000 x 5000 is accepted (the test would catch it)', m[0])
}

console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
