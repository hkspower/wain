#!/usr/bin/env node
// SIZES-WEIGHT TEST - the page-weight lane of "reduce sizes" (owner, 2026-11-03), rig-free.
//
//   npm run test:sizes-weight
//
// No database, no shared port, no dist/: it makes its own temporary folder, its own Apache (through htaccess-rules-test.mjs,
// which starts and stops a private one) and its own headless Chromium against a throwaway Node server. It skips the parts
// whose tool is missing (ImageMagick with WebP, apache2, Chromium) with a SKIP line and still exits 0 for them.
//
// WHAT IS PROVEN, AND HOW
//  1  scripts/make-image-variants.mjs (the offline small-copy maker)
//       - plan only by default: --dir is read, nothing is created, not even responsive/
//       - originals are byte-identical (sha-256) after a --write run, after a second run and after --force
//       - the copies are real WebP at the asked widths, never wider than the photograph, upright for a phone photograph
//         stored sideways (EXIF Orientation 6), carry the ICC profile and no EXIF, and are far smaller than the original
//       - a second run changes nothing (same bytes, same mtimes, same list); a copy older than its original is remade
//       - odd names, symlinks, folders, a file that is not the picture its extension says and a name that two files would
//         share are skipped and reported, never read as a command line
//       - the list (responsive/variants.txt) names exactly the copies on disk, in the format the add-on parses
//  2  public/sporta-features.js, the "small copies of the product photographs" block, in Chromium against a fixture of the
//     LIVE markup (the compiled bundle's own <img> attributes, read from its chunks 2026-11-02)
//       - with the list: 72/80/48/64px thumbnails and uploaded-photo shop cards get a srcset, the browser fetches the small
//         copy and NOT the original, at 1x and 3x; the original stays in `src`
//       - without the list (404 shell, 200 HTML, wrong header line): the page is untouched and no copy is ever requested
//       - the list names a copy that is not there: the original is shown, the compiled onError (which would swap in the
//         "photo unavailable" placeholder) is never called, and the photograph is not retried on that page
//       - the original is missing too: the compiled onError runs, exactly as without this block
//       - React reusing an <img> for another piece, an <img> that already has the build's srcset, the gallery's main
//         photograph, the full-screen view and anything on /backends are all left alone
//       - REVIEW FIX 2026-11-04: with no list on the server (the state until somebody runs the maker) a full page load used to
//         fetch the list's URL every time and get the 404 error shell; now the miss is remembered for 6 hours (no request, no hook,
//         no observer), a first visit or a miss older than that asks again, a clock set back cannot silence it for ever, and a 5xx
//         for the list (a restart) is neither a miss nor a reason to drop a remembered list
//       - MUTATION: the same checks FAIL when the block is cut out of the file, and the silence check FAILS without its guard
//  3  public/.htaccess, on a real Apache 2.4 (htaccess-rules-test.mjs, which this runs): the 404 shell is compressed, and all
//     23 fixed-name add-ons answer an empty 304 to their own gzip / Brotli ETag. MUTATION: the same run FAILS when the two
//     blocks are taken out of a copy of the file.
//  4  budgets on what ships from public/: no picture over 100 kB, every .webp smaller than the .jpg it sits beside, fonts
//     over 50 kB, and the weight of every add-on the live index.html links, printed (INFO) with the two that are admin-only.
//
// Measured with it (numbers in PERFORMANCE.md, "Page weight lane, 2026-11-03"): 404 shell 27,272 B -> 10,144 B; one page load of
// a returning visitor, 23 add-ons: about 145 kB gzip re-sent -> 23 empty 304s; a 3024x4032 phone photograph on a bag thumbnail:
// the original -> an ~8 kB copy.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { DEFAULT_WIDTHS, MANIFEST_HEADER, displayed, findTool, inspect, main as makeVariants, manifestText, plan, sniff } from './make-image-variants.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const FEATURES = join(PUBLIC, 'sporta-features.js')
const HTACCESS = join(PUBLIC, '.htaccess')

let pass = 0, fail = 0, skipped = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const skip = (why) => { skipped++; console.log('SKIP ' + why) }
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const kB = (n) => (n / 1024).toFixed(1) + ' kB'
const quiet = () => { const lines = []; return { out: (s) => lines.push(s), lines } }

const run = (cmd, args, opt = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opt })
const tool = findTool('')
const WORK = mkdtempSync(join(tmpdir(), 'sporta-sizes-weight-'))
chmodSync(WORK, 0o755) // mkdtemp makes it 0700; the Apache run below serves from inside it as www-data
process.on('exit', () => { try { rmSync(WORK, { recursive: true, force: true }) } catch { /* best effort */ } })

// ------------------------------------------------------------------ fixture photographs (ImageMagick, plus one hand-built EXIF)
/** Insert an EXIF APP1 segment carrying Orientation = n right after the JPEG's SOI. */
function withOrientation(jpeg, n) {
  const tiff = Buffer.concat([Buffer.from('MM\0*\0\0\0\x08', 'latin1'), Buffer.from([0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, n, 0, 0, 0, 0, 0, 0])])
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body])
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)])
}
const magick = (...a) => { const r = run(tool.cmd, a); if (r.status !== 0) throw new Error('magick ' + a.join(' ') + ': ' + (r.stderr || '').slice(0, 200)); }
function photo(path, w, h, seed, q = 88) {
  // plasma has the detail of a photograph (a flat colour would compress to nothing and prove nothing)
  const fmt = path.endsWith('.png') ? 'png8:' : path.endsWith('.webp') ? 'webp:' : ''
  magick('-size', `${w}x${h}`, '-seed', String(seed), 'plasma:fractal', '-blur', '0x1', ...(fmt === 'png8:' ? ['-colors', '256', '-dither', 'None'] : ['-quality', String(q)]), fmt + path)
}

// =========================================================================== 1  the generator
head('1  make-image-variants.mjs: the offline small-copy maker')
// Pure functions first (no tool needed).
{
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(900, 16); png.writeUInt32BE(1200, 20)
  is(sniff(png) === 'png' && inspect(png).w === 900 && inspect(png).h === 1200, 'header reader: PNG size comes from the first bytes only')
  is(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) === null && sniff(Buffer.from('GIF89a......')) === null, 'header reader: SVG and GIF are not pictures it will touch')
  is(displayed({ w: 1600, h: 1000, orientation: 6 }).w === 1000 && displayed({ w: 1600, h: 1000, orientation: 1 }).w === 1600, 'orientation 5-8 swaps the axes the browser draws')
  const src = readFileSync(join(ROOT, 'scripts/make-image-variants.mjs'), 'utf8')
  const removals = (src.match(/\b(?:unlinkSync|rmSync|rmdirSync|rm)\([^)]*\)/g) || []).map((x) => x.replace(/\s+/g, ' '))
  is(removals.length === 2 && removals.includes('rmSync(tmp, { force: true })') && removals.includes('rmSync(dir, { recursive: true, force: true })') && /const dir = mkdtempSync\(/.test(src),
    'the maker deletes only its own temporary file and the scratch folder of its quality self-test (source check of every removal call)', removals.join(' | '))
  is(/execFileSync\(tool\.cmd/.test(src) && !/(^|[^.\w])exec\(|execSync\(|shell: true/m.test(src), 'the converter is run with an argument list, never through a shell (source check)')
}
if (!tool.cmd) skip('ImageMagick with WebP not found (' + (tool.error || '') + '): conversion checks not run')
else {
  const M = join(WORK, 'media')
  mkdirSync(M, { recursive: true })
  photo(join(M, 'jacket-1000x1250.jpg'), 1000, 1250, 1, 86)
  photo(join(M, 'hoodie-black-3fa9c1d2e4.jpg'), 3024, 4032, 2, 92)          // a phone photograph, as the lossless upload keeps it
  photo(join(M, 'png-item-bbbbbbbbbb.png'), 900, 900, 3)
  photo(join(M, 'webp-item-cccccccccc.webp'), 1200, 800, 4, 80)
  photo(join(M, 'tiny-aaaaaaaaaa.jpg'), 300, 300, 5)                         // narrower than the smallest width
  photo(join(WORK, 'side.jpg'), 1600, 1000, 6)
  writeFileSync(join(M, 'sideways-0123456789.jpg'), withOrientation(readFileSync(join(WORK, 'side.jpg')), 6))  // stored 1600x1000, drawn 1000x1600
  writeFileSync(join(M, 'fake.jpg'), 'not a picture')                       // a text file named .jpg
  writeFileSync(join(M, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
  writeFileSync(join(M, '.htaccess'), 'Options -Indexes\n')                  // the media mount's own file
  writeFileSync(join(M, 'bad name.jpg'), readFileSync(join(M, 'tiny-aaaaaaaaaa.jpg')))
  writeFileSync(join(M, '-rf.jpg'), readFileSync(join(M, 'tiny-aaaaaaaaaa.jpg')))
  writeFileSync(join(M, 'msl:evil.jpg'), readFileSync(join(M, 'tiny-aaaaaaaaaa.jpg')))
  photo(join(M, 'twin-dddddddddd.jpg'), 800, 800, 7); photo(join(M, 'twin-dddddddddd.png'), 800, 800, 8)  // same stem
  mkdirSync(join(M, 'subfolder')); photo(join(M, 'subfolder/inner.jpg'), 800, 800, 9)
  try { symlinkSync(join(WORK, 'side.jpg'), join(M, 'link-eeeeeeeeee.jpg')) } catch { /* no symlinks on this file system */ }
  const originals = readdirSync(M).filter((n) => lstatSync(join(M, n)).isFile() && !n.startsWith('.')).map((n) => [n, sha(join(M, n))])

  // ---- plan only (the default)
  let q = quiet()
  let code = makeVariants(['--dir', M], q.out)
  is(code === 0 && !existsSync(join(M, 'responsive')), 'plan only is the default: exit 0 and responsive/ is not even created', q.lines.slice(-1)[0])
  is(/to make/.test(q.lines.join('\n')) && /Pass --write/.test(q.lines.join('\n')), 'the plan says what it would make and how to do it')
  const rows = plan(M, DEFAULT_WIDTHS)
  const by = Object.fromEntries(rows.map((r) => [r.file, r]))
  is(by['jacket-1000x1250.jpg'].outs.every((o) => o.action === 'make'), 'a 1000px photograph gets both 320 and 640')
  is(by['tiny-aaaaaaaaaa.jpg'].outs.every((o) => o.action === 'skip' && /not enlarged/.test(o.why)), 'a 300px photograph gets nothing: never enlarged')
  is(by['sideways-0123456789.jpg'].orientation === 6 && by['sideways-0123456789.jpg'].dw === 1000, 'a sideways phone photograph is planned by the width it is DRAWN at (1000, not 1600)')
  is(/not a readable/.test(by['fake.jpg'].skip) && !by['x.svg'] && !by['.htaccess'], 'a text file named .jpg is skipped; an SVG and the mount\'s .htaccess are not pictures')
  is(by['bad name.jpg'].skip === 'unusual file name' && by['-rf.jpg'].skip === 'unusual file name' && by['msl:evil.jpg'].skip === 'unusual file name', 'names with a space, a leading dash or a colon are skipped (never handed to the converter)')
  is(/same name/.test(by['twin-dddddddddd.png'].skip || '') && by['twin-dddddddddd.jpg'].outs, 'two files that differ only by extension: the second is skipped, not allowed to overwrite the first\'s copies')
  is(by['subfolder/'].skip === 'folder' && !rows.some((r) => r.file === 'inner.jpg'), 'a sub-folder is not entered')
  if (existsSync(join(M, 'link-eeeeeeeeee.jpg'))) is(by['link-eeeeeeeeee.jpg'].skip === 'symbolic link', 'a symbolic link is not followed')
  is(makeVariants(['--dir', join(WORK, 'nope')], quiet().out) === 1 && makeVariants(['--dir', M, '--widths', '10,9000'], quiet().out) === 1 && makeVariants(['--bogus'], quiet().out) === 1, 'bad folder / widths / option: exit 1')
  is(makeVariants(['--dir', M, '--write', '--tool', 'no-such-magick'], quiet().out) === 1 && !existsSync(join(M, 'responsive/jacket-1000x1250-320.webp')), 'a missing converter is an error, not a silent no-op, and writes nothing')

  // ---- --write
  q = quiet()
  code = makeVariants(['--dir', M, '--write'], q.out)
  const R = join(M, 'responsive')
  is(code === 0, '--write exits 0', q.lines.filter((l) => /FAIL/.test(l)).join(' | '))
  const names = readdirSync(R).sort()
  is(names.filter((n) => n.endsWith('.webp')).length === 12 && names.includes('variants.txt') && !names.some((n) => n.startsWith('.tmp')), '6 photographs x 2 widths = 12 copies and the list, no temporary file left behind', names.join(' '))
  is(originals.every(([n, h]) => sha(join(M, n)) === h), 'EVERY original is byte-identical afterwards (sha-256 of ' + originals.length + ' files)')
  is(readdirSync(M).sort().join() === [...originals.map(([n]) => n), '.htaccess', 'responsive', 'subfolder', 'link-eeeeeeeeee.jpg', 'x.svg'].filter((n, i, a) => a.indexOf(n) === i && existsSync(join(M, n))).sort().join(), 'nothing was added to, or removed from, the photographs\' own folder except responsive/')
  const dims = (n) => inspect(readFileSync(join(R, n)))
  const sizeOf = (n) => statSync(join(R, n)).size
  is(dims('jacket-1000x1250-320.webp').w === 320 && dims('jacket-1000x1250-320.webp').h === 400 && dims('jacket-1000x1250-640.webp').w === 640, 'the copies are WebP at exactly 320 and 640 wide, in proportion (1000x1250 -> 320x400)', JSON.stringify(dims('jacket-1000x1250-320.webp')))
  is(sniff(readFileSync(join(R, 'hoodie-black-3fa9c1d2e4-320.webp'))) === 'webp', 'the bytes are WebP, whatever the original was (a JPEG, a PNG and a WebP all gave one)')
  const sw = dims('sideways-0123456789-320.webp')
  is(sw.w === 320 && sw.h === 512, 'a sideways phone photograph (stored 1600x1000, EXIF 6) comes out UPRIGHT: 320x512, not 320x200', JSON.stringify(sw))
  const idv = run(tool.cmd === 'magick' ? 'magick' : 'identify', tool.cmd === 'magick' ? ['identify', '-verbose', join(R, 'sideways-0123456789-320.webp')] : ['-verbose', join(R, 'sideways-0123456789-320.webp')])
  is(!/exif:|Orientation: (RightTop|TopRight|BottomRight|BottomLeft|LeftTop|LeftBottom|TopLeft|RightBottom)/i.test(idv.stdout || '') || /Orientation: Undefined/.test(idv.stdout || ''), 'the copy carries no EXIF and no orientation tag (the pixels are rotated for real)')
  is(sizeOf('hoodie-black-3fa9c1d2e4-320.webp') < statSync(join(M, 'hoodie-black-3fa9c1d2e4.jpg')).size / 50, '3024x4032 phone photograph: the 320 copy is under 1/50 of its bytes', `${kB(sizeOf('hoodie-black-3fa9c1d2e4-320.webp'))} vs ${kB(statSync(join(M, 'hoodie-black-3fa9c1d2e4.jpg')).size)}`)
  is(!existsSync(join(R, 'tiny-aaaaaaaaaa-320.webp')) && !existsSync(join(R, 'fake-320.webp')) && !existsSync(join(R, 'twin-dddddddddd-320.webp.png')), 'no copy of the 300px photograph, the fake, or the skipped names')
  is((statSync(join(R, 'jacket-1000x1250-320.webp')).mode & 0o777) === 0o644 && (statSync(R).mode & 0o777) === 0o755, 'copies are 0644 and the folder 0755 (the web server only reads)')
  const list = readFileSync(join(R, 'variants.txt'), 'utf8')
  is(list.split('\n')[0] === MANIFEST_HEADER && list === manifestText(R), 'the list starts with its header line and is exactly what is on disk', list.replace(/\n/g, ' | '))
  is(/^jacket-1000x1250 320,640$/m.test(list) && /^sideways-0123456789 320,640$/m.test(list) && !/tiny|fake|twin-dddddddddd-320|bad/.test(list.split('\n').slice(1).map((l) => l.split(' ')[0]).filter((s) => !/^(jacket|hoodie|png|webp|sideways|twin)/.test(s)).join()), 'the list names every photograph that has copies, widths ascending, and nothing else')

  // ---- idempotent
  const snap = () => readdirSync(R).sort().map((n) => `${n} ${statSync(join(R, n)).mtimeMs} ${statSync(join(R, n)).size}`).join('\n')
  const before = snap()
  await new Promise((r) => setTimeout(r, 1100))
  q = quiet(); code = makeVariants(['--dir', M, '--write'], q.out)
  is(code === 0 && snap() === before && /0 copy\(ies\) to make, 12 already there/.test(q.lines.join('\n')), 'a second --write changes nothing: same names, sizes, mtimes (the list included)')
  // an original replaced by a newer file of the same name -> its copies are remade, the others are not
  const jp = join(M, 'jacket-1000x1250.jpg'); const old = sizeOf('jacket-1000x1250-320.webp')
  photo(jp, 1000, 1250, 99, 70); const now = new Date(Date.now() + 5000); utimesSync(jp, now, now)
  const rows2 = plan(M, DEFAULT_WIDTHS)
  is(rows2.find((r) => r.file === 'jacket-1000x1250.jpg').outs.every((o) => o.action === 'make') && rows2.find((r) => r.file === 'hoodie-black-3fa9c1d2e4.jpg').outs.every((o) => o.action === 'keep'), 'a copy older than its original is planned again, the others are kept')
  makeVariants(['--dir', M, '--write'], quiet().out)
  is(sizeOf('jacket-1000x1250-320.webp') !== old, 'and --write really remade it')
  const h0 = originals.filter(([n]) => n !== 'jacket-1000x1250.jpg')
  makeVariants(['--dir', M, '--write', '--force'], quiet().out)
  is(h0.every(([n, h]) => sha(join(M, n)) === h), 'after --force the originals are still byte-identical')
  // --quality: honoured, or refused out loud. Never accepted and ignored (this ImageMagick ignores it for WebP: see QUALITY in the maker's header).
  {
    const Q = join(WORK, 'q'); mkdirSync(Q); writeFileSync(join(Q, 'p-1111111111.jpg'), readFileSync(join(M, 'hoodie-black-3fa9c1d2e4.jpg')))
    const lo = quiet(), hi = quiet()
    const c1 = makeVariants(['--dir', Q, '--write', '--widths', '640', '--quality', '40'], lo.out)
    if (c1 === 0) {
      rmSync(join(Q, 'responsive'), { recursive: true })
      makeVariants(['--dir', Q, '--write', '--widths', '640', '--quality', '90'], hi.out)
      const a = (/made +p-1111111111-640\.webp +(\d+) B/.exec(lo.lines.join('\n')) || [])[1], b = (/made +p-1111111111-640\.webp +(\d+) B/.exec(hi.lines.join('\n')) || [])[1]
      is(Number(b) > Number(a) * 1.3, '--quality is honoured by this ImageMagick: q90 is much bigger than q40', `${a} B vs ${b} B`)
    } else {
      is(c1 === 1 && /ignores -quality/.test(lo.lines.join('\n')) && !existsSync(join(Q, 'responsive')), '--quality on an ImageMagick that ignores it for WebP: exit 1, says so, and writes nothing', lo.lines.slice(-1)[0])
    }
  }
  // other widths + list-only
  makeVariants(['--dir', M, '--write', '--widths', '800'], quiet().out)
  is(/^jacket-1000x1250 320,640,800$/m.test(readFileSync(join(R, 'variants.txt'), 'utf8')) && !existsSync(join(R, 'sideways-0123456789-800.webp')) === false, '--widths 800 adds an 800 copy where the photograph is wide enough and the list follows')
  rmSync(join(R, 'variants.txt'))
  q = quiet(); makeVariants(['--dir', M, '--manifest-only', '--write'], q.out)
  is(readFileSync(join(R, 'variants.txt'), 'utf8').startsWith(MANIFEST_HEADER), '--manifest-only --write rebuilds just the list (no converter needed)')
  // a half-written file can never be what the web server reads: a failed conversion leaves nothing behind
  writeFileSync(join(M, 'corrupt-ffffffffff.jpg'), Buffer.concat([readFileSync(join(M, 'tiny-aaaaaaaaaa.jpg')).subarray(0, 700), Buffer.alloc(2000)]))
  photo(join(WORK, 'c.jpg'), 900, 900, 11); const good = readFileSync(join(WORK, 'c.jpg')); writeFileSync(join(M, 'corrupt-ffffffffff.jpg'), Buffer.concat([good.subarray(0, 4000), Buffer.alloc(20)]))
  q = quiet(); code = makeVariants(['--dir', M, '--write'], q.out)
  is(!readdirSync(R).some((n) => n.startsWith('.tmp')), 'a photograph that will not convert leaves no temporary file in responsive/', q.lines.filter((l) => /FAIL/.test(l)).join(' | ') || '(it converted)')
}

// =========================================================================== 2  the add-on block, in Chromium
head('2  sporta-features.js: small copies of the product photographs')
const browserPath = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].filter(Boolean).find((p) => existsSync(p) && statSync(p).isFile())
let chromium = null
try { chromium = (await import('playwright')).chromium } catch { /* not installed */ }
if (!tool.cmd) skip('no ImageMagick: the browser fixture needs real photographs')
else if (!chromium || !browserPath) skip('Playwright or Chromium not found')
else {
  // The photographs the fixture server hands out, and their copies, made by the generator itself.
  const S = join(WORK, 'site-media'); mkdirSync(S, { recursive: true })
  for (const [n, w, h, seed] of [['up-aaaaaaaaaa', 3024, 4032, 21], ['up-bbbbbbbbbb', 3024, 4032, 22], ['up-cccccccccc', 3024, 4032, 23], ['up-dddddddddd', 3024, 4032, 24], ['up-eeeeeeeeee', 3024, 4032, 28],
    ['gal-gggggggggg', 3024, 4032, 29], ['lb-hhhhhhhhhh', 3024, 4032, 30], ['static-item', 1000, 1250, 25], ['unlisted-iiiiiiiiii', 3024, 4032, 26], ['gone-ffffffffff', 3024, 4032, 27]]) photo(join(S, n + '.jpg'), w, h, seed, 90)
  makeVariants(['--dir', S, '--write'], quiet().out)
  const LISTED = readFileSync(join(S, 'responsive/variants.txt'), 'utf8')
  // unlisted-iiiiiiiiii has copies on disk but is taken off the list: "a photograph the list does not name"
  const LIST = LISTED.split('\n').filter((l) => !l.startsWith('unlisted-')).join('\n')
  const SHELL_HTML = '<!doctype html><html><head><title>shell</title></head><body>' + 'x'.repeat(8000) + '</body></html>'
  const PLACEHOLDER = readFileSync(join(PUBLIC, 'product-photo-unavailable.svg'))
  const KEEP = 'sporta.variants.v1'
  const MISS = 'sporta.variants.v1.miss'   // when the page last found out that the server has no list
  const HOUR = 3600 * 1000

  // The compiled app's <img>s, as React makes them: every attribute first, `src` LAST, a listener on the element, then into the page.
  const FIXTURE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title></head>
<body><div id="drawer"></div><div id="cart"></div><div style="height:6000px"></div><div id="grid"></div><div id="gallery"></div><div id="summary"></div><div id="lightbox"></div>
<script>
window.__he = 0
// the compiled onError for product images (index chunk, function he): drop srcset/sizes, then show the placeholder
function he(ev) { var t = ev.currentTarget; window.__he++; t.removeAttribute('srcset'); t.removeAttribute('sizes'); if (t.getAttribute('src') !== '/product-photo-unavailable.svg') t.src = '/product-photo-unavailable.svg' }
window.addImg = function (into, id, attrs) {
  var i = document.createElement('img'); i.id = id
  Object.keys(attrs).forEach(function (k) { if (k !== 'src') i.setAttribute(k, attrs[k]) })
  i.addEventListener('error', he)
  i.setAttribute('src', attrs.src)
  document.getElementById(into).appendChild(i); return i
}
var T = '(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw'
window.firstDraw = function () {
  addImg('drawer', 'drawer-a', { src: '/images/products/up-aaaaaaaaaa.jpg', alt: 'x', width: '72', height: '72', class: 'h-18 w-18 shrink-0 rounded-xl object-cover', style: 'width:72px;height:72px' })
  addImg('cart', 'cart-b', { src: '/images/products/up-bbbbbbbbbb.jpg', alt: 'x', width: '80', height: '80', class: 'cart-line__image h-20 w-20 rounded-lg object-cover', style: 'width:80px;height:80px' })
  addImg('summary', 'sum-c', { src: '/images/products/up-cccccccccc.jpg', alt: '', width: '48', height: '48', loading: 'lazy', decoding: 'async', class: 'h-12 w-12 shrink-0 rounded-lg object-cover', style: 'width:48px;height:48px' })
  addImg('grid', 'card-up', { src: '/images/products/up-dddddddddd.jpg', alt: 'x', loading: 'lazy', decoding: 'async', width: '600', height: '750', class: 'catalog-card-photo relative z-[1] h-full w-full object-contain', style: 'width:calc(50vw - 20px);height:200px' })
  addImg('grid', 'card-static', { src: '/images/products/static-item.jpg', srcset: '/images/products/responsive/static-item-320.webp 320w, /images/products/responsive/static-item-640.webp 640w, /images/products/static-item.jpg 1000w', sizes: T, alt: 'x', loading: 'lazy', width: '600', height: '750', class: 'catalog-card-photo', style: 'width:150px;height:150px' })
  addImg('gallery', 'gal-main', { src: '/images/products/gal-gggggggggg.jpg', alt: 'x', width: '600', height: '600', loading: 'eager', fetchpriority: 'high', class: 'catalog-gallery-photo h-full w-full', style: 'width:300px;height:300px' })
  addImg('gallery', 'gal-thumb', { src: '/images/products/up-eeeeeeeeee.jpg', alt: '', width: '64', height: '64', loading: 'lazy', decoding: 'async', class: 'h-full w-full object-contain', style: 'width:64px;height:64px' })
  addImg('lightbox', 'lightbox-img', { src: '/images/products/lb-hhhhhhhhhh.jpg', alt: 'x', class: 'max-h-full max-w-full object-contain', style: 'max-width:100px' })
  addImg('summary', 'unlisted', { src: '/images/products/unlisted-iiiiiiiiii.jpg', alt: '', width: '48', height: '48', class: 'h-12 w-12', style: 'width:48px;height:48px' })
  addImg('summary', 'logo', { src: '/product-photo-unavailable.svg', alt: '', width: '48', height: '48', class: 'h-12 w-12', style: 'width:48px;height:48px' })
}
// after the deferred add-on script has run (DOMContentLoaded comes after deferred scripts), like the app's first render
document.addEventListener('DOMContentLoaded', function () { if (!window.__manual) firstDraw() })
</script>
<script src="/sporta-features.js" defer></script></body></html>`

  // state the server reads on every request
  const state = { list: 'ok', missing: new Set(), log: [], delayOrig: 0, delayList: 0 }
  const server = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x'); const p = decodeURIComponent(u.pathname)
    state.log.push(p)
    const send = (code, type, body, wait = 0) => { const go = () => { s.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); s.end(body) }; if (wait) setTimeout(go, wait); else go() }
    if (p === '/shop' || p === '/backends/products' || p === '/') return send(200, 'text/html; charset=utf-8', FIXTURE)
    if (p === '/sporta-features.js') return send(200, 'text/javascript; charset=utf-8', readFileSync(state.featuresFile || FEATURES))
    if (p.startsWith('/api/')) return send(200, 'application/json', '[]')
    if (p === '/product-photo-unavailable.svg') return send(200, 'image/svg+xml', PLACEHOLDER)
    if (p === '/images/products/responsive/variants.txt') {
      if (state.list === 'ok') return send(200, 'text/plain', LIST, state.delayList)
      if (state.list === 'html200') return send(200, 'text/html', SHELL_HTML)
      if (state.list === 'noheader') return send(200, 'text/plain', LIST.split('\n').slice(1).join('\n'))
      if (state.list === 'plainhtml') return send(200, 'text/plain', SHELL_HTML)
      if (state.list === '503') return send(503, 'text/html; charset=utf-8', SHELL_HTML)   // a restart during a deploy: not an answer about the list
      return send(404, 'text/html; charset=utf-8', SHELL_HTML)
    }
    if (p.startsWith('/images/products/') && !state.missing.has(p)) {
      const f = join(S, p.slice('/images/products/'.length))
      if (existsSync(f) && statSync(f).isFile() && !p.includes('..')) return send(200, f.endsWith('.webp') ? 'image/webp' : 'image/jpeg', readFileSync(f), p.includes('/responsive/') ? 0 : state.delayOrig)
    }
    return send(404, 'text/html; charset=utf-8', SHELL_HTML)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const BASE = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: browserPath })

  const settle = async (page) => {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(250)
  }
  const info = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); if (!e) return null; return { src: e.getAttribute('src'), srcset: e.getAttribute('srcset'), sizes: e.getAttribute('sizes'), cur: e.currentSrc.replace(location.origin, ''), nat: e.naturalWidth, complete: e.complete } }, id)
  const open = async ({ list = 'ok', missing = [], dpr = 1, width = 390, path = '/shop', features = null, remembered = false, delayOrig = 0, delayList = 0, manual = false, missAge = null } = {}) => {
    Object.assign(state, { list, missing: new Set(missing), log: [], featuresFile: features, delayOrig, delayList })
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: dpr, serviceWorkers: 'block' })
    await ctx.addInitScript(([r, key, text, man, mkey, age]) => {
      if (r) { try { localStorage.setItem(key, text) } catch (e) {} }
      if (age !== null) { try { if (localStorage.getItem(mkey) === null) localStorage.setItem(mkey, String(Date.now() - age)) } catch (e) {} }   // only once: a reload keeps what the page itself wrote
      if (man) window.__manual = true
    }, [remembered, KEEP, LIST, manual, MISS, missAge])
    const page = await ctx.newPage()
    await page.goto(BASE + path); await settle(page)
    // the lazy <img>s sit 6000px down, where the browser has not asked for them yet; scroll to them as a shopper would
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await settle(page)
    return { ctx, page }
  }
  const asked = (re) => state.log.filter((p) => re.test(p))
  const V = (stem, w) => `/images/products/responsive/${stem}-${w}.webp`
  const O = (stem) => `/images/products/${stem}.jpg`
  const origs = (...stems) => asked(new RegExp('^/images/products/(' + stems.join('|') + ')\\.jpg$'))

  // ---- A  the list is remembered from an earlier visit: the first request IS the small copy
  for (const dpr of [1, 3]) {
    const { ctx, page } = await open({ dpr, remembered: true, delayOrig: 400 })
    const d = await info(page, 'drawer-a'), c = await info(page, 'cart-b'), sm = await info(page, 'sum-c'), gt = await info(page, 'gal-thumb')
    is(d.srcset === `${V('up-aaaaaaaaaa', 320)} 320w, ${V('up-aaaaaaaaaa', 640)} 640w` && d.sizes === '72px' && d.src === O('up-aaaaaaaaaa'), `DPR${dpr}: 72px bag thumbnail gets the copies as srcset, sizes="72px", and keeps the original in src`, JSON.stringify(d))
    is(c.cur === V('up-bbbbbbbbbb', 320) && c.sizes === '80px', `DPR${dpr}: 80px cart line shows the 320 copy (${c.cur})`)
    is(sm.cur === V('up-cccccccccc', 320) && sm.sizes === '48px', `DPR${dpr}: 48px checkout row shows the 320 copy (${sm.cur})`)
    is(gt.cur === V('up-eeeeeeeeee', 320) && gt.sizes === '64px', `DPR${dpr}: 64px gallery thumbnail shows the 320 copy`)
    is(origs('up-aaaaaaaaaa', 'up-bbbbbbbbbb', 'up-cccccccccc', 'up-dddddddddd', 'up-eeeeeeeeee').length === 0, `DPR${dpr}: the 3024x4032 originals of all five are NEVER requested (the hook put the srcset on before React's src)`, JSON.stringify(origs('up-aaaaaaaaaa', 'up-bbbbbbbbbb', 'up-cccccccccc', 'up-dddddddddd', 'up-eeeeeeeeee')))
    is(origs('gal-gggggggggg').length === 1 && origs('lb-hhhhhhhhhh').length === 1, `DPR${dpr}: the gallery's main photograph and the full-screen view still get their originals, once each`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open({ dpr: 3, width: 390, remembered: true })
    const k = await info(page, 'card-up')
    is(k.sizes === '(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw' && /-640\.webp$/.test(k.cur), 'DPR3 phone: an uploaded-photo shop card gets the build\'s own sizes value and picks the 640 copy', JSON.stringify(k))
    await ctx.close()
    const w = await open({ dpr: 1, width: 1280, remembered: true })
    const k2 = await info(w.page, 'card-up')
    is(/-320\.webp$/.test(k2.cur), 'DPR1 desktop: the same card (300px) picks the 320 copy (' + k2.cur + ')')
    await w.ctx.close()
  }
  {
    const { ctx, page } = await open({ dpr: 2, remembered: true })
    const st = await info(page, 'card-static'), gm = await info(page, 'gal-main'), lb = await info(page, 'lightbox-img'), un = await info(page, 'unlisted'), lg = await info(page, 'logo')
    is(st.srcset.includes('1000w') && st.sizes.startsWith('(min-width: 1280px)'), 'an <img> that already has the build\'s srcset is left exactly as it was')
    is(gm.srcset === null && gm.cur === O('gal-gggggggggg'), 'the gallery\'s main photograph (zoomed to 2.5x) keeps the original')
    is(lb.srcset === null && lb.cur === O('lb-hhhhhhhhhh'), 'the full-screen view (no width attribute) keeps the original')
    is(un.srcset === null && un.cur === O('unlisted-iiiiiiiiii') && !asked(/unlisted-iiiiiiiiii-/).length, 'a photograph the list does not name is shown as it is, and no copy of it was asked for')
    is(lg.srcset === null && lg.cur === '/product-photo-unavailable.svg', 'an <img> that is not a product photograph is not touched')
    await ctx.close()
  }
  {
    const { ctx, page } = await open({ path: '/backends/products', remembered: true })
    const d = await info(page, 'drawer-a')
    is(d.srcset === null && !asked(/variants\.txt/).length, 'on /backends nothing is touched and the list is not even fetched')
    await ctx.close()
  }

  // ---- B  first visit (nothing remembered): the list is fetched; what is still loading is switched, what has loaded is left alone
  {
    const { ctx, page } = await open({ dpr: 2, delayOrig: 700, delayList: 150 })
    const d = await info(page, 'drawer-a'), c = await info(page, 'sum-c'), g = await info(page, 'gal-thumb')
    is(d.srcset === null && d.cur === O('up-aaaaaaaaaa'), 'first visit, list arrives while an EAGER original is already on its way: it is left to finish (a copy would be a second download)', JSON.stringify(d))
    is(/up-cccccccccc-320\.webp$/.test(c.cur) && /up-eeeeeeeeee-320\.webp$/.test(g.cur), 'first visit: LAZY images that had not been asked for are switched to the copies when the list arrives', JSON.stringify([c.cur, g.cur]))
    is(origs('up-cccccccccc', 'up-eeeeeeeeee', 'up-dddddddddd').length === 0, 'and their 3 MB originals were never requested', JSON.stringify(origs('up-cccccccccc', 'up-eeeeeeeeee', 'up-dddddddddd')))
    const kept = await page.evaluate((k) => localStorage.getItem(k), KEEP)
    is(kept === LIST, 'and the list is remembered for the next visit')
    await ctx.close()
    const slow = await open({ dpr: 2, delayList: 900 })
    const d2 = await info(slow.page, 'drawer-a')
    is(d2.srcset === null && d2.cur === O('up-aaaaaaaaaa') && d2.nat === 3024, 'first visit, list arrives AFTER the original has loaded: the loaded picture is left alone (a copy now would be a second download)', JSON.stringify(d2))
    await slow.ctx.close()
  }

  // ---- C  no list: the page is untouched
  for (const mode of ['404', 'html200', 'plainhtml', 'noheader']) {
    const { ctx, page } = await open({ list: mode, dpr: 3 })
    const all = await Promise.all(['drawer-a', 'cart-b', 'sum-c', 'card-up', 'gal-thumb'].map((i) => info(page, i)))
    is(all.every((x) => x.srcset === null && x.sizes === null && /^\/images\/products\/up-/.test(x.cur) && !x.cur.includes('responsive')), `list = ${mode === '404' ? '404 (the error shell)' : mode === 'html200' ? '200 with HTML' : mode === 'plainhtml' ? '200 text/plain holding HTML' : '200 without the header line'}: no <img> touched, every original shown`, JSON.stringify(all.map((x) => x.srcset)))
    is(!asked(/\/responsive\/(?!variants\.txt|static-item)/).length, `list = ${mode}: not one copy was requested (a miss would cost a 404 and the error page)`, JSON.stringify(asked(/\/responsive\//)))
    await ctx.close()
  }
  {
    // the server stops serving the list (copies deleted): a remembered one is dropped, our srcsets come off, the originals show
    const { ctx, page } = await open({ list: '404', remembered: true, dpr: 1 })
    const d = await info(page, 'drawer-a')
    const kept = await page.evaluate((k) => localStorage.getItem(k), KEEP)
    is(d.srcset === null && d.cur === O('up-aaaaaaaaaa') && kept === null, 'a remembered list the server no longer has is forgotten, our srcsets are taken off, the originals are shown', JSON.stringify({ srcset: d.srcset, cur: d.cur, kept: kept && 'still stored' }))
    await ctx.close()
  }

  // ---- C2  review fix (2026-11-04): a miss is remembered, so a server with no list is not asked on every page load
  {
    // The first version fetched the list on every full page load; until the maker runs the answer is a 404 carrying the whole
    // error shell (19 kB / 6.3 kB Brotli live), uncached, for every visitor, for nothing. Now: ask once, remember the miss for 6 h.
    const t0 = Date.now()   // not "within the last minute": a loaded machine can take longer than that to settle a page
    const { ctx, page } = await open({ list: '404', dpr: 2 })
    const first = asked(/variants\.txt/).length
    const stamp = Number(await page.evaluate((k) => localStorage.getItem(k), MISS))
    is(first === 1 && stamp >= t0 && stamp <= Date.now(), 'no list: the first load asks once and records the miss (a timestamp from during this test)', `asked ${first}, stamp ${stamp}, test started ${t0}`)
    state.log = []
    await page.reload(); await settle(page)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await settle(page)   // the lazy <img>s sit 6000px down
    const hooked = await page.evaluate(() => Element.prototype.setAttribute.sportaSrcset === true)
    is(asked(/variants\.txt/).length === 0 && !hooked, 'and the next full page load, within the 6 hours, does NOT ask again and installs no hook (the block is inert)', `asked ${asked(/variants\.txt/).length}, hook ${hooked}`)
    const all = await Promise.all(['drawer-a', 'cart-b', 'sum-c', 'card-up', 'gal-thumb'].map((i) => info(page, i)))
    is(all.every((x) => x.srcset === null && /^\/images\/products\/up-/.test(x.cur) && !x.cur.includes('responsive')), 'and the page is exactly as it was: every original, no srcset', JSON.stringify(all.map((x) => x.srcset)))
    await ctx.close()
  }
  {
    // the maker has run since: a first visit (nothing recorded) learns it at once ...
    const a = await open({ list: 'ok', dpr: 2 })
    is(asked(/variants\.txt/).length === 1 && (await info(a.page, 'sum-c')).srcset !== null, 'the maker has run: a first visit asks, gets the list and uses it')
    is(await a.page.evaluate((k) => localStorage.getItem(k), MISS) === null, 'a good list leaves no miss behind')
    await a.ctx.close()
    // ... a browser whose miss is 7 hours old asks again, uses the list, and the old miss is removed ...
    const b = await open({ list: 'ok', dpr: 2, missAge: 7 * HOUR })
    is(asked(/variants\.txt/).length === 1 && (await info(b.page, 'sum-c')).srcset !== null && await b.page.evaluate((k) => localStorage.getItem(k), MISS) === null, 'a miss older than 6 hours is asked about again; the list is used and the miss is cleared')
    await b.ctx.close()
    // ... and one whose miss is 5 minutes old does not (the price of the silence, stated in the header comment) ...
    const c = await open({ list: 'ok', dpr: 2, missAge: 5 * 60000 })
    const cs = await info(c.page, 'sum-c')
    is(asked(/variants\.txt/).length === 0 && cs.srcset === null && /^\/images\/products\/up-/.test(cs.cur) && !cs.cur.includes('responsive'), 'a miss from 5 minutes ago is respected: no request, originals shown (the list reaches this browser within 6 hours)')
    await c.ctx.close()
    // ... a clock that was set back (a miss "from the future") cannot silence the block for ever.
    const d = await open({ list: 'ok', dpr: 2, missAge: -2 * HOUR })
    is(asked(/variants\.txt/).length === 1 && (await info(d.page, 'sum-c')).srcset !== null, 'a miss time in the future counts as old: the block asks again')
    await d.ctx.close()
  }
  {
    // a remembered list and a server that now has none: forgotten (as before) AND the miss is recorded, so the next load is silent
    const { ctx, page } = await open({ list: '404', remembered: true, dpr: 1 })
    const kept = await page.evaluate((k) => localStorage.getItem(k), KEEP), miss = await page.evaluate((k) => localStorage.getItem(k), MISS)
    is(kept === null && miss !== null, 'a remembered list the server no longer has is dropped and the miss is recorded')
    await ctx.close()
    // a 503 (the server restarting) is NOT an answer about the list: the remembered one stays in use, no miss is recorded
    const t = await open({ list: '503', remembered: true, dpr: 2 })
    const keptT = await t.page.evaluate((k) => localStorage.getItem(k), KEEP), missT = await t.page.evaluate((k) => localStorage.getItem(k), MISS)
    const dT = await info(t.page, 'drawer-a')
    is(keptT === LIST && missT === null && dT.srcset !== null && /up-aaaaaaaaaa-320\.webp$/.test(dT.cur), 'a 503 for the list leaves a remembered list in use and records no miss', JSON.stringify({ kept: keptT === LIST, miss: missT, cur: dT.cur }))
    await t.ctx.close()
    // ... and with nothing remembered a 503 records no miss either, so the next load asks again
    const u = await open({ list: '503', dpr: 2 })
    is(await u.page.evaluate((k) => localStorage.getItem(k), MISS) === null, 'a 503 with nothing remembered records no miss (the next load asks again)')
    await u.ctx.close()
  }

  // ---- D  the list names a copy that is not there
  {
    const { ctx, page } = await open({ missing: [V('up-aaaaaaaaaa', 320), V('up-aaaaaaaaaa', 640)], dpr: 3, remembered: true })
    const d = await info(page, 'drawer-a')
    const he = await page.evaluate(() => window.__he)
    // (naturalWidth is not asserted: Chromium keeps the density of the failed 320w candidate, so it reports 680 for a 3024px original; the box is CSS-sized)
    is(d.srcset === null && d.sizes === null && d.cur === O('up-aaaaaaaaaa') && d.complete && d.nat > 0, 'a listed copy that 404s: our srcset is removed and the ORIGINAL is shown, decoded', JSON.stringify(d))
    is(he === 0, 'the compiled onError (which would replace the photograph with the "unavailable" placeholder) was never called', 'called ' + he)
    await page.evaluate(() => { window.addImg('drawer', 'again', { src: '/images/products/up-aaaaaaaaaa.jpg', alt: '', width: '72', height: '72', style: 'width:72px;height:72px' }) })
    await settle(page)
    const ag = await info(page, 'again')
    is(ag.srcset === null && ag.cur === O('up-aaaaaaaaaa') && asked(/up-aaaaaaaaaa-(320|640)\.webp/).length === 1, 'and it is not retried on that page: the same photograph added later goes straight to the original', JSON.stringify(asked(/up-aaaaaaaaaa/)))
    const other = await info(page, 'cart-b')
    is(other.srcset !== null && /up-bbbbbbbbbb-320\.webp$/.test(other.cur), 'other photographs keep their copies')
    await ctx.close()
  }
  {
    const { ctx, page } = await open({ missing: [V('gone-ffffffffff', 320), V('gone-ffffffffff', 640), O('gone-ffffffffff')], dpr: 2, remembered: true, list: 'ok' })
    await page.evaluate(() => { window.addImg('drawer', 'gone', { src: '/images/products/gone-ffffffffff.jpg', alt: '', width: '72', height: '72', style: 'width:72px;height:72px' }) })
    await settle(page)
    const g = await info(page, 'gone'); const he = await page.evaluate(() => window.__he)
    is(he === 1 && g.src === '/product-photo-unavailable.svg' && g.nat > 0, 'copy AND original missing: the compiled onError runs once and shows the placeholder, as it does without this block', JSON.stringify(g) + ' he=' + he)
    await ctx.close()
  }

  // ---- E  React changes things under us, and the hook is a faithful setAttribute
  {
    const { ctx, page } = await open({ dpr: 2, remembered: true })
    await page.evaluate(() => { document.getElementById('drawer-a').setAttribute('src', '/images/products/up-bbbbbbbbbb.jpg') })
    await settle(page)
    const a = await info(page, 'drawer-a')
    is(/up-bbbbbbbbbb-320\.webp$/.test(a.cur) && a.srcset.includes('up-bbbbbbbbbb') && !a.srcset.includes('up-aaaaaaaaaa'), 'React reuses the <img> for another piece: the NEW piece\'s copy is shown, the old one\'s srcset is gone', JSON.stringify(a))
    await page.evaluate(() => { document.getElementById('drawer-a').setAttribute('src', '/images/products/unlisted-iiiiiiiiii.jpg') })
    await settle(page)
    const b = await info(page, 'drawer-a')
    is(b.srcset === null && b.sizes === null && b.cur === O('unlisted-iiiiiiiiii'), 'reused for a photograph with no copies: the srcset is removed and the new original shown', JSON.stringify(b))
    await page.evaluate(() => { document.getElementById('drawer-a').src = '/images/products/up-cccccccccc.jpg' })   // the property, not setAttribute: the hook does not see it
    await settle(page)
    const pr = await info(page, 'drawer-a')
    is(pr.srcset === null && pr.cur === O('up-cccccccccc'), 'src assigned as a PROPERTY on an EAGER <img>: the old piece\'s srcset is removed, the new original shows, and no copy is added on top of a request already made', JSON.stringify(pr))
    await page.evaluate(() => { document.getElementById('sum-c').src = '/images/products/up-eeeeeeeeee.jpg' })   // a lazy <img>: the observer path
    await settle(page)
    const pl = await info(page, 'sum-c')
    is(pl.srcset !== null && pl.srcset.includes('up-eeeeeeeeee') && !pl.srcset.includes('up-cccccccccc'), 'src assigned as a PROPERTY on a LAZY <img>: the observer puts the right copy on', JSON.stringify(pl))
    await page.evaluate(() => { var e = document.getElementById('cart-b'); e.setAttribute('srcset', '/images/products/up-cccccccccc.jpg 80w'); e.setAttribute('sizes', '80px') })
    await settle(page)
    const c = await info(page, 'cart-b')
    is(c.srcset === '/images/products/up-cccccccccc.jpg 80w' && c.sizes === '80px', 'if the app puts its own srcset on an <img> we had touched, ours is forgotten and its own stays', JSON.stringify(c))
    await page.evaluate(() => { window.addImg('drawer', 'late', { src: '/images/products/up-dddddddddd.jpg', alt: '', width: '72', height: '72', style: 'width:72px;height:72px' }) })
    await settle(page)
    const l = await info(page, 'late')
    is(/up-dddddddddd-(320|640)\.webp$/.test(l.cur) && l.srcset.includes('up-dddddddddd-320'), 'an <img> made later (the drawer opening) is a copy from its first request (the browser may reuse the 640 copy the card already holds)', JSON.stringify(l))
    // setAttribute itself
    const sa = await page.evaluate(() => {
      const d = document.createElement('div'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), im = document.createElement('img')
      const r1 = d.setAttribute('src', '/images/products/up-aaaaaaaaaa.jpg'), r2 = svg.setAttribute('src', 'x'), r3 = im.setAttribute('src', 12345), r4 = im.setAttribute('data-x', 'y')
      im.setAttribute('width', 72); im.setAttribute('src', '/images/products/up-aaaaaaaaaa.jpg')
      return { r: [r1, r2, r3, r4].map(String), d: d.getAttribute('src'), svg: svg.getAttribute('src'), num: im.getAttribute('data-x'), sets: im.getAttribute('src'), has: im.hasAttribute('srcset'), len: Element.prototype.setAttribute.length, name: Element.prototype.setAttribute.sportaSrcset === true }
    })
    is(sa.r.every((x) => x === 'undefined') && sa.d === '/images/products/up-aaaaaaaaaa.jpg' && sa.svg === 'x' && sa.num === 'y' && sa.sets === '/images/products/up-aaaaaaaaaa.jpg' && sa.has === true && sa.name, 'setAttribute behaves: returns undefined, sets what it is given on a div, an svg and an img, and only an <img> with a listed src gets a srcset', JSON.stringify(sa))
    await ctx.close()
  }

  // ---- F  MUTATION: cut the block out; the "it works" checks must fail
  {
    const full = readFileSync(FEATURES, 'utf8')
    const at = full.indexOf('/* Small copies of the product photographs')
    is(at > 0, 'the block is in sporta-features.js, after the earlier ones')
    const mutant = join(WORK, 'features-without-block.js'); writeFileSync(mutant, at > 0 ? full.slice(0, at) : full)
    const { ctx, page } = await open({ dpr: 3, features: mutant, remembered: true })
    const d = await info(page, 'drawer-a'), k = await info(page, 'card-up')
    is(d.srcset === null && d.cur === O('up-aaaaaaaaaa') && k.cur === O('up-dddddddddd'), 'MUTATION: without the block the bag thumbnail and the card both load the full original (so the checks above can fail)', JSON.stringify([d.cur, k.cur]))
    const o = origs('up-aaaaaaaaaa', 'up-bbbbbbbbbb', 'up-cccccccccc', 'up-dddddddddd', 'up-eeeeeeeeee').length
    is(o === 5, 'MUTATION: ...and the browser really does download those five originals (' + o + ')')
    await ctx.close()
    // MUTATION of the review fix: without the early return on a recent miss, the second load asks for the list again
    const noSilence = join(WORK, 'features-without-silence.js')
    const guard = 'if (!widths && recentMiss()) return'
    is(full.includes(guard), 'the miss guard is in the block (so the mutation below cuts something)')
    writeFileSync(noSilence, full.replace(guard, ''))
    const mm = await open({ list: '404', dpr: 2, features: noSilence })
    state.log = []
    await mm.page.reload(); await settle(mm.page)
    await mm.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await settle(mm.page)
    is(asked(/variants\.txt/).length === 1, 'MUTATION: without the miss guard the second load asks for the list again (so the silence check above can fail)', 'asked ' + asked(/variants\.txt/).length)
    await mm.ctx.close()
  }
  await browser.close(); server.close()
}

// =========================================================================== 3  .htaccess on a real Apache
head('3  public/.htaccess: the 404 shell and the 23 add-ons, on a real Apache 2.4 (htaccess-rules-test.mjs)')
{
  const ht = readFileSync(HTACCESS, 'utf8')
  is(/<If "%\{REQUEST_STATUS\} == 404">[\s\S]*?SetOutputFilter BROTLI_COMPRESS;DEFLATE[\s\S]*?<\/If>/.test(ht), 'source: the 404 status gets the compression filters')
  is(/RequestHeader edit If-None-Match "-\(\?:gzip\|br\)\(\\"\)" "\$1"/.test(ht), 'source: the compression suffix is stripped from If-None-Match before the conditional is evaluated')
  const apache = run('sh', ['-c', 'command -v apache2 || command -v httpd']).stdout.trim()
  if (!apache) skip('apache2 not found: the Apache run is not made')
  else {
    const t0 = Date.now()
    const r = run('node', [join(ROOT, 'scripts/htaccess-rules-test.mjs')], { cwd: ROOT, env: { ...process.env, HTRULES_DIR: join(WORK, 'ht-a'), HTRULES_PORT: '8481', HTRULES_PHP_PORT: '8482' }, maxBuffer: 64 * 1024 * 1024 })
    const out = (r.stdout || '') + (r.stderr || '')
    const summary = (out.match(/^\d+ checks:.*$/m) || [''])[0]
    is(r.status === 0 && /, 0 FAIL/.test(summary) && /0 unexpected-pass/.test(summary), 'the whole .htaccess matrix passes on Apache (' + summary + ')', out.split('\n').filter((l) => /^FAIL|^XPASS/.test(l)).slice(0, 4).join(' | '))
    // htaccess-rules-test.mjs prints only what is not ok, so the proof that each of its checks held is: no FAIL, no XPASS, and
    // the summary line it prints after the 23-file loop does not say "(NOT all)".
    const loop = out.split('\n').find((l) => /add-on files, one page load/.test(l)) || ''
    is(/^\s*23 add-on files/.test(loop) && !/NOT all/.test(loop) && /, 0 B body as 304 now/.test(loop), 'all 23 add-on files answer an empty 304 to their own gzip and Brotli ETag, keep no-cache, and a stale validator still gets the file', loop.trim())
    is(!/^(FAIL|XPASS).*(404 shell|photo copy)/m.test(out), 'the 404 shell is gzip for gzip clients, Brotli for br clients, plain for a client with no compression, and a missing photograph copy costs the compressed shell')
    is(!/htaccess-11/.test(out.split('\n').filter((l) => /^XFAIL/.test(l)).join('\n')) && !/XFAIL.*404 shell/.test(out), 'neither is on the known-defect list any more')
    console.log('   ' + (out.split('\n').find((l) => /add-on files, one page load/.test(l)) || '').trim() + `  [${((Date.now() - t0) / 1000).toFixed(1)} s]`)
    // MUTATION: the same matrix on a copy of the file with the two blocks removed must go red.
    const cut = ht
      .replace(/# ---- The 404 shell is compressed like every other page[\s\S]*?<\/If>\n\n/, '')
      .replace(/  # Revalidation of a COMPRESSED text file answers 304[\s\S]*?RequestHeader edit If-None-Match [^\n]*\n\n/, '')
    is(cut.length < ht.length - 1500 && !/RequestHeader edit If-None-Match/.test(cut) && !/REQUEST_STATUS/.test(cut), 'MUTATION prepared: both blocks cut out of a copy (' + (ht.length - cut.length) + ' bytes of comments and rules)')
    mkdirSync(join(WORK, 'm/a/public'), { recursive: true }); mkdirSync(join(WORK, 'm/b/public'), { recursive: true })
    writeFileSync(join(WORK, 'm/a/public/.htaccess'), ht); writeFileSync(join(WORK, 'm/b/public/.htaccess'), cut)
    const d = run('diff', ['-u', 'a/public/.htaccess', 'b/public/.htaccess'], { cwd: join(WORK, 'm') })
    // diff exits 1 when the files differ; the patch is what htaccess-rules-test.mjs --patch wants (paths a/public/.htaccess)
    const rev = d.stdout
    writeFileSync(join(WORK, 'cut.diff'), rev.replace(/^--- .*$/m, '--- a/public/.htaccess').replace(/^\+\+\+ .*$/m, '+++ b/public/.htaccess'))
    const m = run('node', [join(ROOT, 'scripts/htaccess-rules-test.mjs'), '--patch', join(WORK, 'cut.diff')], { cwd: ROOT, env: { ...process.env, HTRULES_DIR: join(WORK, 'ht-b'), HTRULES_PORT: '8483', HTRULES_PHP_PORT: '8484' }, maxBuffer: 64 * 1024 * 1024 })
    const mo = (m.stdout || '') + (m.stderr || '')
    const fails = mo.split('\n').filter((l) => /^FAIL/.test(l))
    const rel = fails.filter((l) => /COMPRESSED|its own gzip ETag|404 shell|photo copy/i.test(l))
    is(m.status !== 0 && rel.length >= 30, 'MUTATION: without the two blocks the Apache run FAILS on the 304 checks (23 add-ons + 7 files) and the 404-shell checks', `${rel.length} relevant of ${fails.length} FAIL lines, exit ${m.status}`)
  }
}

// =========================================================================== 4  budgets on what ships from public/
head('4  budgets on what ships from public/ (images, fonts, add-ons)')
{
  const walk = (d, o = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p, o); else o.push(p) } return o }
  const files = walk(PUBLIC)
  const pics = files.filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
  const biggest = pics.map((f) => [f, statSync(f).size]).sort((a, b) => b[1] - a[1])
  is(biggest[0][1] <= 100 * 1024, 'no picture in public/ is over 100 kB (a master or a camera file in public/ ships to everyone)', `${biggest[0][0].replace(PUBLIC + '/', '')} ${kB(biggest[0][1])}`)
  console.log('   largest pictures: ' + biggest.slice(0, 4).map(([f, n]) => `${f.replace(PUBLIC + '/', '')} ${kB(n)}`).join(' ; '))
  const pairs = pics.filter((f) => f.endsWith('.webp')).map((f) => [f, f.replace(/\.webp$/, '.jpg')]).filter(([, j]) => existsSync(j))
  is(pairs.length >= 10 && pairs.every(([w, j]) => statSync(w).size < statSync(j).size), `every one of the ${pairs.length} .webp is smaller than the .jpg beside it (otherwise it is not worth serving first)`, pairs.filter(([w, j]) => statSync(w).size >= statSync(j).size).map(([w]) => w).join(','))
  const fonts = files.filter((f) => f.endsWith('.woff2'))
  is(fonts.length === 8 && fonts.every((f) => statSync(f).size <= 50 * 1024), 'fonts: eight subset WOFF2 files, none over 50 kB', fonts.map((f) => `${f.split('/').pop()} ${kB(statSync(f).size)}`).filter((s) => parseFloat(s.split(' ')[1]) > 50).join(','))
  is(!files.some((f) => /\/(brand|masters?)\//i.test(f) || /-original\./i.test(f)), 'no brand master or "-original" file in public/ (CLAUDE.md: masters live in /brand/)')
  // INFO: what every shopper page load downloads from the add-ons the live index.html links.
  const LINKED = ['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js', 'sporta-clock.js', 'sporta-checkout-a11y.js',
    'sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css',
    'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
  let raw = 0, gz = 0, br = 0
  const rows = LINKED.map((f) => { const b = readFileSync(join(PUBLIC, f)); const g = gzipSync(b, { level: 6 }).length, r = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length; raw += b.length; gz += g; br += r; return [f, b.length, g, r] })
  is(LINKED.every((f) => existsSync(join(PUBLIC, f))), 'all 23 files the live index.html links exist in public/')
  console.log(`INFO  the 23 linked fixed-name files, every shopper page load: ${kB(raw)} raw, ${kB(gz)} gzip, ${kB(br)} brotli`)
  for (const [f, a, g, r] of rows.sort((x, y) => y[1] - x[1]).slice(0, 5)) console.log(`INFO    ${f.padEnd(26)} ${kB(a).padStart(9)} raw ${kB(r).padStart(9)} br${/admin/.test(f) ? '   <- admin-only code, linked by the STOREFRONT page (lane D / owner decision)' : ''}`)
  is(true, 'INFO lines above are a report, not a limit: the add-ons belong to other lanes')
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`)
process.exit(fail ? 1 : 0)
