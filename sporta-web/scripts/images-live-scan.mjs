#!/usr/bin/env node
// IMAGES LIVE SCAN - the product photos on the server, read-only.
//
//   node scripts/images-live-scan.mjs --media /media/products [--config /run/sporta-api-config.php]      (the one-shot VPS job)
//
// READS: the files of the media mount (default /media/products: the folder the admin's product_image_upload writes and the web server serves as
// /images/products/), one level of responsive/ under it, and - when a config is given - the product rows' slug, active, image and images
// columns (no customer data). PRINTS: counts, sizes, formats, pixel sizes, aspect ratios, which files carry camera metadata (the EXIF block) and
// which of those carry a GPS position (the fact only, NEVER the coordinates), orphans and missing files, file modes. Nothing is written, moved or
// opened for writing; the DB session is READ ONLY and gated to SELECT / SHOW (db-schema-live-diff.mjs).
//
// WHY: the owner decided (2026-11-03) that uploaded photos are LOSSLESS: the browser sends the file's own bytes and the route writes them unchanged, so
// the EXIF the camera wrote - including the location, if it was on - stays in the file the shop publishes. This is the check of what is there.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
const L = []
const out = (s = '') => { L.push(s); console.log(s) }
const head = (t) => out(`\n== ${t}`)

// ---- image headers ------------------------------------------------------------------------------------------------------------
const readHead = (file, n = 262144) => { const fd = openSync(file, 'r'); try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, 0); return b.subarray(0, got) } finally { closeSync(fd) } }
export function sniff(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const t = buf.toString('ascii', 12, 16)
    if (t === 'VP8 ') return { kind: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { kind: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 } }
    if (t === 'VP8X') return { kind: 'webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
    return { kind: 'webp', w: 0, h: 0 }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf)
  return { kind: 'other', w: 0, h: 0 }
}
function jpeg(buf) {
  const r = { kind: 'jpeg', w: 0, h: 0, exif: false, gps: false, make: false }
  let p = 2
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) { p++; continue }
    const m = buf[p + 1]
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { p += m === 0xff ? 1 : 2; continue }
    const len = buf.readUInt16BE(p + 2)
    if (m === 0xe1 && buf.toString('ascii', p + 4, p + 10) === 'Exif\0\0') exif(buf.subarray(p + 10, p + 2 + len), r)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { r.h = buf.readUInt16BE(p + 5); r.w = buf.readUInt16BE(p + 7); break }
    if (m === 0xda) break
    p += 2 + len
  }
  return r
}
// the TIFF block: IFD0 entries; tag 0x8825 is the GPS IFD pointer (its presence is all that is reported), 0x010f the camera make
function exif(t, r) {
  r.exif = true
  if (t.length < 8) return
  const le = t.toString('ascii', 0, 2) === 'II'
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o))
  try {
    const ifd = u32(4), n = u16(ifd)
    for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= t.length; i++) {
      const tag = u16(ifd + 2 + i * 12)
      if (tag === 0x8825) { const g = u32(ifd + 2 + i * 12 + 8); if (g > 0 && g + 2 <= t.length && u16(g) > 0) r.gps = true }
      if (tag === 0x010f) r.make = true
    }
  } catch { /* a damaged block: reported as EXIF without a GPS finding */ }
}

// ---- the scan -------------------------------------------------------------------------------------------------------------------
const EXT_OK = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const mb = (n) => (n / 1048576).toFixed(2)
export function listDir(dir) {
  const rows = []
  for (const name of readdirSync(dir)) {
    const f = join(dir, name), st = lstatSync(f)
    rows.push({ name, f, st })
  }
  return rows
}
export function scanFiles(dir) {
  const files = [], odd = [], dirs = []
  for (const { name, f, st } of listDir(dir)) {
    if (st.isDirectory()) { dirs.push(name); continue }
    if (st.isSymbolicLink()) { odd.push(`${name}: a symbolic link`); continue }
    if (!st.isFile()) { odd.push(`${name}: not a regular file`); continue }
    const ext = extname(name).toLowerCase()
    if (name.startsWith('.')) { odd.push(`${name}: a dotfile (${st.size} bytes)`); continue }
    if (!EXT_OK.has(ext)) { odd.push(`${name}: extension ${ext || '(none)'} (${st.size} bytes)`); continue }
    const head = readHead(f), info = sniff(head)
    files.push({ name, f, ext, bytes: st.size, mode: st.mode & 0o777, uid: st.uid, ...info, stem: basename(name, ext) })
  }
  return { files, odd, dirs }
}

async function dbProducts(cfg) {
  const { MySQL, Gate, credentials, scrub } = await import('./db-schema-live-diff.mjs')
  const cred = credentials({ config: cfg })
  const conn = new MySQL(cred)
  const secrets = [cred.password, cred.user]
  try { await conn.connect() } catch (e) { return { error: 'cannot connect: ' + scrub(e.message, secrets) } }
  const gate = new Gate(conn)
  try {
    await gate.readOnly()
    const r = await gate.query('select slug, active, image, images from products order by slug')
    await gate.end()
    return { rows: r.rows.map(([slug, active, image, images]) => ({ slug, active: active === '1', image, images })) }
  } catch (e) { await gate.end(); return { error: scrub(e.message, secrets) } }
}

async function main() {
  const media = arg('media') ?? '/media/products'
  if (!existsSync(media)) { console.error('images-live-scan: no such folder ' + media); return 2 }
  out(`IMAGES LIVE SCAN (read-only; folder ${media})`)
  const { files, odd, dirs } = scanFiles(media)
  const resp = existsSync(join(media, 'responsive')) ? scanFiles(join(media, 'responsive')) : { files: [], odd: [], dirs: [] }

  head('THE FOLDER')
  out(`  files: ${files.length} (${mb(files.reduce((a, f) => a + f.bytes, 0))} MB) · sub-folders: ${dirs.join(', ') || '(none)'} · responsive/ files: ${resp.files.length} (${mb(resp.files.reduce((a, f) => a + f.bytes, 0))} MB)`)
  const byExt = {}; for (const f of files) byExt[f.kind] = (byExt[f.kind] ?? 0) + 1
  out('  formats (read from the bytes): ' + Object.entries(byExt).map(([k, v]) => `${k} ${v}`).join(' · '))
  const wrongExt = files.filter((f) => (f.kind === 'jpeg' && !['.jpg', '.jpeg'].includes(f.ext)) || (f.kind === 'png' && f.ext !== '.png') || (f.kind === 'webp' && f.ext !== '.webp') || f.kind === 'other')
  out(`  extension does not match the bytes: ${wrongExt.length}` + wrongExt.slice(0, 20).map((f) => `\n    ${f.name}: ${f.kind}`).join(''))
  out(`  odd entries (dotfiles, links, other extensions): ${odd.length}` + odd.slice(0, 20).map((s) => `\n    ${s}`).join(''))
  const modes = {}; for (const f of files) modes[f.mode.toString(8)] = (modes[f.mode.toString(8)] ?? 0) + 1
  out('  file modes: ' + Object.entries(modes).map(([k, v]) => `${k} x${v}`).join(' · ') + ' · world-writable: ' + files.filter((f) => f.mode & 0o002).length)
  out('  folder .htaccess (denies PHP there): ' + (existsSync(join(media, '.htaccess')) ? 'present' : 'ABSENT'))

  head('SIZE (the web server sends the file as it is: a large one is downloaded in full by every card that has no small copy)')
  const big = files.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 10)
  out('  largest 10: ' + big.map((f) => `${f.name} ${mb(f.bytes)} MB ${f.w}x${f.h}`).join(' · '))
  out(`  over 1 MB: ${files.filter((f) => f.bytes > 1048576).length} · over 3 MB: ${files.filter((f) => f.bytes > 3145728).length} · over 8 MB: ${files.filter((f) => f.bytes > 8388608).length}`)
  const small = files.filter((f) => f.w && f.h && Math.min(f.w, f.h) < 800)
  out(`  under 800 px on the short side (soft on a retina phone / the 2.5x zoom): ${small.length}` + small.slice(0, 15).map((f) => `\n    ${f.name} ${f.w}x${f.h}`).join(''))
  const under1200 = files.filter((f) => f.w && f.h && Math.max(f.w, f.h) < 1200)
  out(`  under 1200 px on the long side: ${under1200.length}`)
  const off = files.filter((f) => f.w && f.h && Math.abs(f.w / f.h - 0.8) > 0.03)
  const squareish = off.filter((f) => Math.abs(f.w / f.h - 1) <= 0.03)
  out(`  not 4:5 (the card frame; object-fit contain leaves bands): ${off.length} of ${files.length} (${squareish.length} are square)`)
  const ratios = {}; for (const f of files) if (f.w && f.h) { const r = (f.w / f.h).toFixed(2); ratios[r] = (ratios[r] ?? 0) + 1 }
  out('  aspect ratios (w/h): ' + Object.entries(ratios).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} x${v}`).join(' · '))

  head('CAMERA METADATA (EXIF) IN THE FILES THE SHOP PUBLISHES')
  const jpegs = files.filter((f) => f.kind === 'jpeg')
  const withExif = jpegs.filter((f) => f.exif), withGps = jpegs.filter((f) => f.gps)
  out(`  JPEG files: ${jpegs.length} · with an EXIF block: ${withExif.length} · with a GPS position inside it: ${withGps.length}`)
  out('  files with a GPS position (names only, never the coordinates): ' + (withGps.length ? withGps.map((f) => f.name).join(', ') : 'none'))
  out(`  PNG / WebP files carry no EXIF block in this scan (not parsed): ${files.length - jpegs.length}`)

  head('IDENTICAL FILES UNDER TWO NAMES (a photo uploaded for two products)')
  const hashes = new Map()
  for (const f of files) { const h = createHash('sha256').update(readFileSync(f.f)).digest('hex'); (hashes.get(h) ?? hashes.set(h, []).get(h)).push(f.name) }
  const dup = [...hashes.values()].filter((v) => v.length > 1)
  out(`  groups: ${dup.length}` + dup.slice(0, 15).map((v) => `\n    ${v.join(' = ')}`).join(''))

  head('SMALL COPIES (responsive/): the 320 and 640 px WebP the cards and the gallery ask for')
  const stems = new Set(files.map((f) => f.stem))
  const have = new Set(resp.files.map((f) => f.name))
  const noSmall = [...stems].filter((s) => !(have.has(`${s}-320.webp`) && have.has(`${s}-640.webp`)))
  out(`  photos with both -320.webp and -640.webp: ${stems.size - noSmall.length} of ${stems.size}`)
  out(`  photos missing a small copy: ${noSmall.length}` + noSmall.slice(0, 30).map((s) => `\n    ${s}`).join(''))
  const respStems = resp.files.map((f) => f.name.replace(/-(320|640)\.webp$/, '')).filter((s, i, a) => a.indexOf(s) === i)
  const orphanSmall = respStems.filter((s) => !stems.has(s))
  out(`  small copies whose original is gone: ${orphanSmall.length}` + orphanSmall.slice(0, 15).map((s) => `\n    ${s}`).join(''))
  out('  variants.txt (the list the storefront reads): ' + (have.has('variants.txt') || existsSync(join(media, 'responsive', 'variants.txt')) ? 'present' : 'ABSENT'))

  const cfg = arg('config')
  if (cfg) {
    head('AGAINST THE PRODUCT ROWS (slug, active, image, images; read-only)')
    const p = await dbProducts(cfg)
    if (p.error) out('  (could not read the products: ' + p.error + ')')
    else {
      const slugs = new Set(p.rows.map((r) => r.slug))
      const active = p.rows.filter((r) => r.active)
      const fileBySlug = (s) => files.some((f) => f.stem === s)
      const noFile = active.filter((r) => !fileBySlug(r.slug) && !(r.image && files.some((f) => r.image.endsWith('/' + f.name))))
      out(`  products: ${p.rows.length} (active ${active.length}) · active with no photo file: ${noFile.length}` + noFile.slice(0, 30).map((r) => `\n    ${r.slug}`).join(''))
      const named = p.rows.filter((r) => r.image)
      const missing = named.filter((r) => { const base = r.image.split('/').pop(); return !files.some((f) => f.name === base) })
      out(`  rows whose image column names a file that is NOT in the folder: ${missing.length}` + missing.slice(0, 20).map((r) => `\n    ${r.slug}: ${r.image}`).join(''))
      const orphans = files.filter((f) => !slugs.has(f.stem) && !p.rows.some((r) => r.image && r.image.endsWith('/' + f.name) ) && !p.rows.some((r) => r.images && r.images.includes(f.name)) && !/-\d+$/.test(f.stem))
      out(`  files that no product row names or matches by slug: ${orphans.length}` + orphans.slice(0, 30).map((f) => `\n    ${f.name}`).join(''))
      const bySlugOnly = active.filter((r) => !r.image && fileBySlug(r.slug)).length
      out(`  active products shown only because a file carries their slug (their image column is empty): ${bySlugOnly}`)
    }
  }
  out('\nIMAGES_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('images-live-scan: ' + e.message); process.exit(2) })
