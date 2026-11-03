#!/usr/bin/env node
// MAKE-IMAGE-VARIANTS - small WebP copies of the product photographs, made OFFLINE, on the machine that holds them.
//
//   node scripts/make-image-variants.mjs --dir <media/products>                 plan only (DEFAULT): reads, prints, writes nothing
//   node scripts/make-image-variants.mjs --dir <media/products> --write         make the missing copies, then rewrite the list
//   node scripts/make-image-variants.mjs --dir <media/products> --manifest-only --write   only rewrite the list (no conversion tool needed)
//   options:  --widths 320,640   --quality 80   --force   --tool magick|convert
//
// WHY THIS EXISTS
// Uploaded product photographs are LOSSLESS by the owner's decision (2026-11-03): the browser sends the file's own bytes and
// /api/admin.php?r=product_image_upload writes them unchanged, so a phone photograph arrives at 3000-4000 px and up to 10 MiB.
// The compiled storefront gives a small-copy `srcset` only to the ~33 photographs it was built with (its `me()` function, a
// hard-coded file list); every other photograph - everything the admin uploads - is sent to a 72px bag thumbnail, an 80px cart
// line, a 48px checkout row and a 300px shop card at FULL size. The copies this tool makes are SEPARATE FILES beside the
// originals, never a replacement of them:
//
//     <dir>/<stem>.<jpg|jpeg|png|webp>                       the original: opened read-only, never written, moved or deleted
//     <dir>/responsive/<stem>-320.webp, <stem>-640.webp     the copies (the name the compiled `me()` already uses)
//     <dir>/responsive/variants.txt                          the list public/sporta-features.js reads (see MANIFEST below)
//
// WHAT IT PROMISES (each one is asserted by npm run test:sizes-weight)
//   * Dry run by default. Nothing is created - not even responsive/ - without --write.
//   * An original is never modified, renamed or removed (sha-256 compared before and after in the test).
//   * Never enlarges: a width wider than the photograph, as it is DISPLAYED, is skipped. A photograph narrower than the
//     smallest width gets no copy at all and is simply shown as it is.
//   * Idempotent: a copy that exists, is not empty and is not older than its original is left alone; a second --write run
//     changes nothing (same bytes, same mtime). --force remakes copies; it still never touches an original.
//   * Upright: phone photographs are stored sideways with an EXIF Orientation tag and drawn upright by the browser. The copy
//     is rotated for real (-auto-orient), so a portrait photograph does not come out as a landscape copy.
//   * Colour: the ICC profile is kept (a Display-P3 photograph stays P3). EXIF / XMP / IPTC are dropped from the COPY only,
//     which also leaves the location out of every small picture. The original keeps whatever the camera wrote.
//   * Atomic: each copy is written to a hidden temporary name in responsive/ and renamed, so the web server can never send a
//     half-written file; the list is replaced the same way.
//   * Only plain files directly inside --dir with a conservative name ([A-Za-z0-9._-], no leading dot or dash) are read;
//     symlinks, sub-folders, odd names and anything whose first bytes are not JPEG / PNG / WebP are skipped and reported.
//     The decoder is chosen from those bytes, never from the extension.
//
// MANIFEST (responsive/variants.txt)
//   # sporta-variants v1
//   <stem> <w1>,<w2>,...      one line per photograph that has at least one copy, widths ascending
// It records what EXISTS on disk (it is rebuilt by scanning responsive/, so the ~33 copies the build's own photographs
// already have are listed too). The storefront add-on only points an <img> at a copy this list names, so before the list
// exists - or for a photograph it does not name - the page behaves exactly as it does today, and a missing copy is never
// requested (a miss costs a 404 and the site's 27 kB error page).
//
// RUNNING IT ON THE SERVER (the owner's step; the repo cannot reach the VPS from here)
//   The photographs live in /docker/sporta/private/media/products (served as /images/products/). Any machine with Node 22+
//   and ImageMagick built with WebP (`convert -list format | grep WEBP`; Debian: imagemagick + libwebp) can run this:
//     docker run --rm -v /docker/sporta/private/media/products:/m -v <repo>/sporta-web/scripts:/s:ro node:24-bookworm \
//       sh -c 'apt-get update -qq && apt-get install -y -qq imagemagick >/dev/null && node /s/make-image-variants.mjs --dir /m --write'
//   Run it again after every batch of uploads (it only does the new ones). Files it makes are 0644; the web server only reads.
//
// Exit status: 0 ok (including "nothing to do"); 1 bad usage, folder or tool missing; 2 at least one photograph failed.
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFEST_NAME = 'variants.txt'
export const MANIFEST_HEADER = '# sporta-variants v1'
export const DEFAULT_WIDTHS = [320, 640]

// ---------------------------------------------------------------- header parsing (no dependencies)
/** 'jpeg' | 'png' | 'webp' | null, from the first bytes only. */
export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** { w, h, orientation } of the stored pixels; orientation is the EXIF value (1 when absent / not a JPEG). */
export function inspect(b) {
  const kind = sniff(b)
  try {
    if (kind === 'png') return { kind, w: b.readUInt32BE(16), h: b.readUInt32BE(20), orientation: 1 }
    if (kind === 'webp') {
      const t = b.toString('latin1', 12, 16)
      if (t === 'VP8 ') return { kind, w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, orientation: 1 }
      if (t === 'VP8X') return { kind, w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), orientation: 1 }
      if (t === 'VP8L') { const v = b.readUInt32LE(21); return { kind, w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, orientation: 1 } }
      return null
    }
    if (kind === 'jpeg') {
      let i = 2, orientation = 1
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const m = b[i + 1]
        if (m === 0xff) { i++; continue }
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
        const len = b.readUInt16BE(i + 2)
        if (m === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') orientation = exifOrientation(b, i + 10, i + 2 + len) || orientation
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { kind, w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), orientation }
        i += 2 + len
      }
    }
  } catch { /* truncated or hostile header: treated as unreadable below */ }
  return null
}

function exifOrientation(b, t, end) {
  const le = b.toString('latin1', t, t + 2) === 'II'
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  if (u16(t + 2) !== 42) return 0
  const ifd = t + u32(t + 4)
  if (ifd + 2 > end) return 0
  const n = u16(ifd)
  for (let k = 0; k < n && k < 64; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > end) break
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0 }
  }
  return 0
}

/** The width the browser DRAWS the photograph at: orientations 5-8 swap the stored axes. */
export const displayed = (i) => (i.orientation >= 5 ? { w: i.h, h: i.w } : { w: i.w, h: i.h })

// ---------------------------------------------------------------- the plan
const STEM_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const EXT = { jpeg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'] }

/**
 * What would be made. Pure with respect to --write: reads the folder, returns rows, touches nothing.
 * row = { file, stem, kind, w, h, orientation, outs: [{ width, path, action: 'make'|'keep'|'skip', why }] } or { file, skip: why }
 */
export function plan(dir, widths, { force = false } = {}) {
  const rows = []
  const respDir = join(dir, 'responsive')
  for (const name of readdirSync(dir).sort()) {
    if (name === 'responsive') continue
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = lstatSync(full)
    if (st.isSymbolicLink()) { rows.push({ file: name, skip: 'symbolic link' }); continue }
    if (!st.isFile()) { if (st.isDirectory()) rows.push({ file: name + '/', skip: 'folder' }); continue }
    const m = /^(.+)\.([A-Za-z0-9]+)$/.exec(name)
    if (!m || !['jpg', 'jpeg', 'png', 'webp'].includes(m[2].toLowerCase())) continue // not a picture (e.g. the media mount's own .htaccess)
    if (!STEM_OK.test(name)) { rows.push({ file: name, skip: 'unusual file name' }); continue }
    const stem = m[1]
    let head
    try {
      const fd = openSync(full, 'r')
      try { const size = Math.min(st.size, 4 * 1024 * 1024); head = Buffer.alloc(size); readSync(fd, head, 0, size, 0) } finally { closeSync(fd) }
    } catch (e) { rows.push({ file: name, skip: 'unreadable (' + e.code + ')' }); continue }
    const info = inspect(head)
    if (!info) { rows.push({ file: name, skip: 'not a readable JPEG / PNG / WebP' }); continue }
    if (!EXT[info.kind].includes(m[2].toLowerCase())) { rows.push({ file: name, skip: 'extension says ' + m[2] + ', content is ' + info.kind }); continue }
    const d = displayed(info)
    const outs = widths.map((width) => {
      const path = join(respDir, `${stem}-${width}.webp`)
      if (d.w < width) return { width, path, action: 'skip', why: `photograph is ${d.w}px wide, not enlarged to ${width}` }
      let have = null
      try { have = statSync(path) } catch { /* not there */ }
      if (have && have.isFile() && have.size > 0 && have.mtimeMs >= st.mtimeMs && !force) return { width, path, action: 'keep', why: 'already made' }
      return { width, path, action: 'make', why: have ? (force ? 'forced' : 'older than its original or empty') : 'missing' }
    })
    rows.push({ file: name, full, stem, kind: info.kind, w: info.w, h: info.h, orientation: info.orientation, dw: d.w, dh: d.h, outs })
  }
  return rows
}

// ---------------------------------------------------------------- the converter
/** { cmd, args(prefix) } for the first usable ImageMagick with a WebP encoder, or { error }. */
export function findTool(prefer) {
  for (const cmd of prefer ? [prefer] : ['magick', 'convert']) {
    const v = spawnSync(cmd, ['-version'], { encoding: 'utf8' })
    if (v.error || v.status !== 0 || !/ImageMagick/i.test(v.stdout || '')) continue
    const list = spawnSync(cmd, ['-list', 'format'], { encoding: 'utf8' })
    // "    WEBP* WEBP      rw+   WebP Image Format": the row has to exist AND be writable.
    if (!/^\s*WEBP\*?\s+WEBP\s+\S*w\S*\s/m.test(list.stdout || '')) return { error: `${cmd} is installed but has no WebP encoder (convert -list format shows no WEBP row)` }
    return { cmd, version: (v.stdout || '').split('\n')[0].trim() }
  }
  return { error: 'ImageMagick not found (looked for ' + (prefer || 'magick, convert') + '). Install imagemagick with WebP support.' }
}

const MAGICK_FORMAT = { jpeg: 'jpeg', png: 'png', webp: 'webp' }

/** One copy, atomically: temp name in the same folder, then rename. Throws on any failure and leaves no temp file behind. */
export function makeOne(tool, row, out, quality) {
  const tmp = join(out.path, '..', `.tmp-${process.pid}-${row.stem}-${out.width}.webp`)
  try {
    execFileSync(tool.cmd, [
      // A JPEG is decoded already shrunk by 1/2, 1/4 or 1/8 when the result still has twice the wanted width (a 12-megapixel
      // phone photograph is not expanded to 48 MB of pixels to make a 320px copy); the exact size is then a Lanczos resize.
      ...(row.kind === 'jpeg' ? ['-define', `jpeg:size=${out.width * 2}x${out.width * 2}`] : []),
      // The decoder is named from the file's own bytes (jpeg: / png: / webp:), never guessed from a name or an extension.
      `${MAGICK_FORMAT[row.kind]}:${row.full}[0]`,
      '-auto-orient',                 // rotate the pixels for real: the copy carries no Orientation tag
      '+profile', '!icc,*',           // drop every profile EXCEPT the colour one (EXIF incl. GPS, XMP, IPTC go)
      '-filter', 'Lanczos', '-resize', `${out.width}x`,
      '-quality', String(quality),
      '-define', 'webp:method=6',
      `webp:${tmp}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 })
    const made = statSync(tmp)
    if (!made.isFile() || made.size === 0) throw new Error('empty output')
    chmodSync(tmp, 0o644)
    renameSync(tmp, out.path)
    return made.size
  } finally {
    try { rmSync(tmp, { force: true }) } catch { /* already renamed */ }
  }
}

// ---------------------------------------------------------------- the list
/** Rebuild responsive/variants.txt text from what is on disk. Pure: returns the text. */
export function manifestText(respDir) {
  const by = new Map()
  if (existsSync(respDir)) {
    for (const name of readdirSync(respDir)) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)-(\d{2,4})\.webp$/.exec(name)
      if (!m) continue
      const st = lstatSync(join(respDir, name))
      if (!st.isFile() || st.size === 0) continue
      if (!by.has(m[1])) by.set(m[1], new Set())
      by.get(m[1]).add(Number(m[2]))
    }
  }
  const lines = [...by.keys()].sort().map((s) => `${s} ${[...by.get(s)].sort((a, b) => a - b).join(',')}`)
  return MANIFEST_HEADER + '\n' + lines.join('\n') + (lines.length ? '\n' : '')
}

/** Replace the list atomically, and not at all when it would be the same bytes (so a second run changes nothing). */
function writeAtomic(path, text) {
  try { if (readFileSync(path, 'utf8') === text) return false } catch { /* no list yet */ }
  const tmp = join(path, '..', `.tmp-${process.pid}-${MANIFEST_NAME}`)
  writeFileSync(tmp, text, { mode: 0o644 })
  chmodSync(tmp, 0o644)
  renameSync(tmp, path)
  return true
}

// ---------------------------------------------------------------- command line
export function parseArgs(argv) {
  const o = { dir: '', write: false, manifestOnly: false, force: false, widths: DEFAULT_WIDTHS, quality: 80, tool: '', help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '--dir') o.dir = val()
    else if (a === '--write') o.write = true
    else if (a === '--manifest-only') o.manifestOnly = true
    else if (a === '--force') o.force = true
    else if (a === '--tool') o.tool = val()
    else if (a === '--quality') o.quality = Number(val())
    else if (a === '--widths') o.widths = val().split(',').map((x) => Number(x.trim()))
    else if (a === '-h' || a === '--help') o.help = true
    else throw new Error(`unknown option ${a}`)
  }
  if (!Number.isInteger(o.quality) || o.quality < 40 || o.quality > 95) throw new Error('--quality must be a whole number from 40 to 95')
  if (!o.widths.length || o.widths.length > 6 || o.widths.some((w) => !Number.isInteger(w) || w < 64 || w > 4096)) throw new Error('--widths is up to six whole numbers from 64 to 4096, e.g. 320,640')
  o.widths = [...new Set(o.widths)].sort((a, b) => a - b)
  return o
}

export function main(argv, out = (s) => console.log(s)) {
  let o
  try { o = parseArgs(argv) } catch (e) { out('make-image-variants: ' + e.message); return 1 }
  if (o.help || !o.dir) { out(readmeLines().join('\n')); return o.help ? 0 : 1 }
  const dir = resolve(o.dir)
  let st
  try { st = statSync(dir) } catch { st = null }
  if (!st || !st.isDirectory()) { out(`make-image-variants: ${dir} is not a folder`); return 1 }
  const respDir = join(dir, 'responsive')

  if (o.manifestOnly) {
    out(`${o.write ? 'WRITE' : 'PLAN '} list only, ${join(respDir, MANIFEST_NAME)}`)
    const text = manifestText(respDir)
    out(`      ${text.split('\n').length - 2} photograph(s) with copies`)
    if (o.write) { mkdirSync(respDir, { recursive: true, mode: 0o755 }); writeAtomic(join(respDir, MANIFEST_NAME), text) } else out('      (plan only: pass --write to write it)')
    return 0
  }

  const rows = plan(dir, o.widths, { force: o.force })
  const todo = rows.flatMap((r) => (r.outs || []).filter((x) => x.action === 'make').map((x) => [r, x]))
  out(`${o.write ? 'WRITE' : 'PLAN '} ${dir}  widths ${o.widths.join(',')}  quality ${o.quality}  originals are never touched`)
  for (const r of rows) {
    if (r.skip) { out(`  skip  ${r.file}: ${r.skip}`); continue }
    const rot = r.orientation >= 5 ? `, stored sideways (EXIF ${r.orientation}), drawn ${r.dw}x${r.dh}` : ''
    out(`  ${r.file}  ${r.kind} ${r.w}x${r.h}${rot}`)
    for (const x of r.outs) out(`      ${String(x.width).padStart(4)}  ${x.action.padEnd(4)}  ${x.why}`)
  }
  const kept = rows.flatMap((r) => (r.outs || []).filter((x) => x.action === 'keep')).length
  out(`  ${todo.length} copy(ies) to make, ${kept} already there`)
  if (!o.write) { out('  (plan only: nothing was written. Pass --write to make them.)'); return 0 }

  let failed = 0
  if (todo.length) {
    const tool = findTool(o.tool)
    if (tool.error) { out('make-image-variants: ' + tool.error); return 1 }
    out(`  using ${tool.version}`)
    mkdirSync(respDir, { recursive: true, mode: 0o755 })
    for (const [r, x] of todo) {
      try { const n = makeOne(tool, r, x, o.quality); out(`  made  ${r.stem}-${x.width}.webp  ${n} B`) } catch (e) {
        failed++
        out(`  FAIL  ${r.stem}-${x.width}.webp: ${String(e.stderr || e.message).split('\n')[0].slice(0, 160)}`)
      }
    }
  }
  if (existsSync(respDir) || todo.length) {
    mkdirSync(respDir, { recursive: true, mode: 0o755 })
    const text = manifestText(respDir)
    const changed = writeAtomic(join(respDir, MANIFEST_NAME), text)
    out(`  list ${join(respDir, MANIFEST_NAME)}: ${text.split('\n').length - 2} photograph(s)${changed ? '' : ' (unchanged)'}`)
  }
  return failed ? 2 : 0
}

function readmeLines() {
  return [
    'usage: node scripts/make-image-variants.mjs --dir <media/products> [--write] [--widths 320,640] [--quality 80] [--force] [--manifest-only] [--tool magick|convert]',
    '  Plan only unless --write. Makes <dir>/responsive/<stem>-<width>.webp beside the originals and rewrites responsive/variants.txt.',
    '  Originals are opened read-only and are never changed, moved or deleted. See the header of this file.',
  ]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
