// npm run test:images-live-scan - the parsers and the findings of scripts/images-live-scan.mjs on files built here (no server, no database).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { sniff } from './images-live-scan.mjs'
import { photoPng } from './lib/test-photo.mjs'

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }

// a JPEG: SOI, an APP1 Exif block (little endian; IFD0 holds Make and, when asked, the GPS pointer to a GPS IFD with one entry), SOF0 w x h, SOS
const jpeg = ({ w = 800, h = 1000, exif = false, gps = false } = {}) => {
  const parts = [Buffer.from([0xff, 0xd8])]
  if (exif) {
    const n = gps ? 2 : 1
    const ifd0 = Buffer.alloc(2 + n * 12 + 4)
    ifd0.writeUInt16LE(n, 0)
    ifd0.writeUInt16LE(0x010f, 2); ifd0.writeUInt16LE(2, 4); ifd0.writeUInt32LE(4, 6); ifd0.write('Cam\0', 10, 'ascii')
    const gpsOff = 8 + ifd0.length
    if (gps) { ifd0.writeUInt16LE(0x8825, 14); ifd0.writeUInt16LE(4, 16); ifd0.writeUInt32LE(1, 18); ifd0.writeUInt32LE(gpsOff, 22) }
    const gpsIfd = Buffer.alloc(2 + 12 + 4); gpsIfd.writeUInt16LE(1, 0); gpsIfd.writeUInt16LE(2, 2)   // one entry (the latitude reference)
    const tiff = Buffer.concat([Buffer.from('II*\0', 'ascii'), Buffer.from([8, 0, 0, 0]), ifd0, ...(gps ? [gpsIfd] : [])])
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])
    const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2)
    parts.push(Buffer.from([0xff, 0xe1]), len, body)
  }
  const sof = Buffer.alloc(17); sof.writeUInt16BE(17 - 0, 0); sof[2] = 8; sof.writeUInt16BE(h, 3); sof.writeUInt16BE(w, 5); sof[7] = 3
  parts.push(Buffer.from([0xff, 0xc0]), sof.subarray(0, 17), Buffer.from([0xff, 0xda, 0, 2]))
  return Buffer.concat(parts)
}
const webpVp8x = (w, h) => { const b = Buffer.alloc(30); b.write('RIFF', 0); b.writeUInt32LE(22, 4); b.write('WEBPVP8X', 8); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b }

is(sniff(jpeg({ w: 800, h: 1000 })).w === 800 && sniff(jpeg({ w: 800, h: 1000 })).h === 1000, 'a JPEG: its pixel size is read from the SOF marker')
is(sniff(jpeg({ exif: true })).exif === true && sniff(jpeg({ exif: true })).gps === false, 'a JPEG with an EXIF block and no GPS: EXIF yes, GPS no')
is(sniff(jpeg({ exif: true, gps: true })).gps === true, 'a JPEG whose EXIF holds a GPS IFD: GPS yes')
is(sniff(jpeg()).exif === false && sniff(jpeg()).gps === false, 'a JPEG with no EXIF: neither')
const png = photoPng(64, 80); is(sniff(png).kind === 'png' && sniff(png).w === 64 && sniff(png).h === 80, 'a PNG: size from the IHDR')
is(sniff(webpVp8x(640, 800)).kind === 'webp' && sniff(webpVp8x(640, 800)).w === 640 && sniff(webpVp8x(640, 800)).h === 800, 'a WebP (VP8X): size from the header')
is(sniff(Buffer.from('<?php echo 1; ?>')).kind === 'other', 'a PHP file under an image name is "other"')

const dir = mkdtempSync(join(tmpdir(), 'imgscan-'))
try {
  mkdirSync(join(dir, 'products', 'responsive'), { recursive: true })
  const P = join(dir, 'products')
  writeFileSync(join(P, 'with-gps.jpg'), jpeg({ w: 900, h: 1125, exif: true, gps: true }))
  writeFileSync(join(P, 'camera-only.jpg'), jpeg({ w: 900, h: 1125, exif: true }))
  writeFileSync(join(P, 'clean.jpg'), jpeg({ w: 1600, h: 1600 }))
  writeFileSync(join(P, 'copy-of-clean.jpg'), jpeg({ w: 1600, h: 1600 }))
  writeFileSync(join(P, 'logo.png'), photoPng(300, 300))
  writeFileSync(join(P, 'shell.php.jpg'), '<?php system($_GET[0]); ?>')
  writeFileSync(join(P, '.hidden'), 'x')
  writeFileSync(join(P, 'responsive', 'clean-320.webp'), webpVp8x(320, 400)); writeFileSync(join(P, 'responsive', 'clean-640.webp'), webpVp8x(640, 800))
  writeFileSync(join(P, 'responsive', 'clean-800.webp'), webpVp8x(800, 1000)); writeFileSync(join(P, 'responsive', 'gone-800.webp'), webpVp8x(800, 1000))
  writeFileSync(join(P, 'responsive', 'notes.txt'), 'x')
  const r = spawnSync(process.execPath, [new URL('./images-live-scan.mjs', import.meta.url).pathname, '--media', P], { encoding: 'utf8' })
  const t = r.stdout
  is(r.status === 0 && /IMAGES_SCAN_DONE/.test(t), 'the scan runs to its end (exit 0)', r.stderr.slice(0, 200))
  is(/with a GPS position inside it: 1\b/.test(t) && /with-gps\.jpg/.test(t) && !/camera-only\.jpg, |names only, never the coordinates\): camera-only/.test(t), 'it names the one file that carries a GPS position, and not the camera-only one')
  is(/with an EXIF block: 2\b/.test(t), 'two files carry an EXIF block')
  is(/extension does not match the bytes: 1\b[\s\S]*shell\.php\.jpg: other/.test(t), 'a PHP file with an image extension is flagged')
  is(/dotfile/.test(t) && /\.hidden/.test(t), 'a dotfile is listed')
  is(/groups: 1\b[\s\S]*clean\.jpg = copy-of-clean\.jpg|groups: 1\b[\s\S]*copy-of-clean\.jpg = clean\.jpg/.test(t), 'two identical files under two names are one group')
  is(/photos with both -320\.webp and -640\.webp: 1 of /.test(t), 'only the photo with both small copies is counted as having them')
  is(/photos with an 800 px copy too: 1\b/.test(t), 'a photo with a -800.webp is counted as having its 800 px copy')
  is(/small copies whose original is gone: 1\n\s+gone\b/.test(t) && !/clean-800|\n\s+clean\n/.test(t.split('small copies whose original')[1] || ''), 'an -800.webp whose photo exists is NOT an orphan (the false positive of the first live scan); one whose photo is gone is')
  is(/other files in responsive\/ \(not a size the shop writes\): 1\n\s+notes\.txt/.test(t), 'a stray file in responsive/ is listed')
  is(!/[0-9]{1,3}\.[0-9]{3,}[, ]+[0-9]{1,3}\.[0-9]{3,}/.test(t), 'no coordinates are printed anywhere')
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
