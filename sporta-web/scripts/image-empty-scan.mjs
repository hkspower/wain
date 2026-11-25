#!/usr/bin/env node
// EMPTY-IMAGE SCAN - which products have no photo, read-only, names only where the name IS the finding.
//
//   node scripts/image-empty-scan.mjs --media-dir /sporta/private/media/products     (the one-shot VPS job; credentials as the price scan)
//
// THE RULE (the same one dropin/php-store/product-listable.php uses): a product has a photo when its image or images column is set, OR a file
// named <slug>.<ext> or <slug>-view-<n>.<ext> is in the photo folder. This prints: how many active products have no photo, which ones (slug and
// name only), which are hidden from the shop because of it, and any photo file that no product uses (orphans). No customer data is read.
//
// READ-ONLY: SELECT only, in a READ ONLY session (the same gate as the other live scans). The folder is only listed, never opened for writing.
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
const out = (s = '') => console.log(s)
const EXT = /\.(jpe?g|png|webp|gif|avif)$/i

// The file names that count as a photo of a slug: <slug>.<ext> and <slug>-view-<n>.<ext>. A name that is a responsive copy (-320.webp) is a copy
// of a photo, so it counts for its base name only.
export function photoSlugs(files) {
  const set = new Set()
  for (const f of files) {
    if (!EXT.test(f)) continue
    const base = f.replace(EXT, '').replace(/-(320|640|800|1200)$/, '').replace(/-view-\d+$/, '')
    set.add(base)
  }
  return set
}

export function classify(products, slugsWithFiles) {
  const noPhoto = [], orphanFileSlugs = new Set(slugsWithFiles)
  let withColumn = 0, withFile = 0
  for (const p of products) {
    const hasColumn = String(p.image ?? '').trim() !== '' || String(p.images ?? '').trim() !== ''
    if (hasColumn) withColumn++
    else if (slugsWithFiles.has(p.slug)) withFile++
    orphanFileSlugs.delete(p.slug)
    if (!hasColumn && !slugsWithFiles.has(p.slug)) noPhoto.push(p)
  }
  return { withColumn, withFile, noPhoto, orphans: [...orphanFileSlugs].sort() }
}

export async function main() {
  const dir = arg('media-dir')
  let cred
  try { cred = credentials({ config: arg('config') }) } catch (e) { console.error('image-empty-scan: ' + e.message); return 2 }
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error('image-empty-scan: cannot connect: ' + scrub(e.message, secrets)); return 2 }
  const gate = new Gate(conn)
  try { await gate.readOnly() } catch (e) { console.error('image-empty-scan: ' + scrub(e.message, secrets)); await gate.end(); return 2 }
  const r = await gate.query(`select slug, name_en, active, image, images from products order by slug`)
  await gate.end()
  const cols = r.columns, products = r.rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
  let files = []
  try { files = dir ? readdirSync(dir) : [] } catch (e) { console.error('image-empty-scan: cannot list the photo folder: ' + e.message); return 2 }
  const slugsWithFiles = photoSlugs(files)
  const active = products.filter((p) => Number(p.active) === 1)
  const { withColumn, withFile, noPhoto, orphans } = classify(active, slugsWithFiles)
  out('EMPTY-IMAGE SCAN (read-only)')
  out(`products ${products.length} · active ${active.length} · photo files ${files.filter((f) => EXT.test(f)).length} · slugs with a file ${slugsWithFiles.size}`)
  out(`active with an image column ${withColumn} · active with a photo file only ${withFile} · NO PHOTO ${noPhoto.length}`)
  out('\nactive products with no photo (slug | name):')
  for (const p of noPhoto) out(`  ${p.slug} | ${String(p.name_en ?? '').slice(0, 60)}`)
  out(`\nphoto files no active or inactive product uses: ${orphans.length}`)
  for (const s of orphans.slice(0, 40)) out(`  ${s}`)
  out('\nEMPTY_IMAGE_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('image-empty-scan: ' + e.message); process.exit(2) })
