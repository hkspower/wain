/**
 * The LIVE SHOP'S HERO, recreated in the sandbox for a rig, and put back exactly afterwards.
 *
 *   import { seedLiveHero, restoreHero } from './_hero-seed.mjs'
 *   const saved = snapshotHero()          // before anything is touched
 *   seedLiveHero({ size: 'full', autoplay: false })
 *   ...
 *   restoreHero(saved)                    // in a finally
 *
 * The sandbox's hero_slides is EMPTY, so every hero rig measured the bundle's drawn fallback — a
 * shop no visitor ever sees. The live shop (scripts/live/live-hero-state.php) is: Size Full,
 * autoplay off, seven slides — the five neutral photographs (publish-hero-neutral.php, focal
 * points per publish-hero-focal.php) and two older slides, ids 2 and 3, that have only a desktop
 * picture. Same ids, same sort order, same picture bytes for the five, so a rig sees the URLs and
 * byte counts a visitor gets. The two older slides' pictures are not in this repository; any
 * desktop-only webp stands in for them (only "has no phone picture" matters about them here).
 *
 * The titles are FIXTURES (the live words are the owner's): the five carry one, as the live rows
 * do, because a slide with a title is what puts an <h1> in the hero.
 *
 * RESTORE IS EXACT: the rows, the table's AUTO_INCREMENT, and the `hero` settings row INCLUDING
 * its updated_at (the column auto-updates, so a plain value write would move it). The sandbox
 * database is shared with other work; touching only hero_slides and that one settings row is
 * the contract.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ART = new URL('../sporta-site/assets/hero/', import.meta.url)
const DB = ['-uroot', 'sporta', '--default-character-set=utf8mb4']
export const sql = (q, input) => execFileSync('mariadb', [...DB, '-N', '--raw', '-e', q], { encoding: 'utf8', input, maxBuffer: 1 << 28 }).trim()
const run = (input) => execFileSync('mariadb', DB, { encoding: 'utf8', input, maxBuffer: 1 << 28 })
const q = (s) => s == null ? 'null' : `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Width and height out of a webp's own header (VP8, VP8L or VP8X). */
export function webpSize(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a webp')
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  if (chunk === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)] }
  throw new Error('unknown webp chunk ' + chunk)
}

// id, sort, desktop file, phone file | null, focal x, focal y, title en, title ar
// (the five with a title also carry the "Shop now" button hero-captions.php gave the live ones)
export const LIVE_SLIDES = [
  [8, 0, 'crossfit-neutral-desktop.webp', 'crossfit-neutral-mobile.webp', 50, 25, 'TRAIN HARD. LOOK BETTER.', 'تدرّب بجد. اظهر بمظهر أفضل.'],
  [9, 1, 'features-neutral-desktop.webp', 'features-neutral-mobile.webp', 28, 15, 'Sporta features', 'مزايا سبورتا'],
  [2, 20, 'features-clean-desktop.webp', null, 43, 50, null, null],
  [3, 21, 'crossfit-desktop.webp', null, 62, 50, null, null],
  [5, 23, 'runner-neutral-desktop.webp', 'runner-neutral-mobile.webp', 63, 15, 'Built to move', 'انطلق بقوة'],
  [6, 24, 'activewear-neutral-desktop.webp', 'activewear-neutral-mobile.webp', 68, 15, 'Strength, your way', 'قوتك بأسلوبك'],
  [7, 25, 'training-neutral-desktop.webp', 'training-neutral-mobile.webp', 62, 15, 'Ready to train', 'جاهز للتمرين'],
]

/** Everything restoreHero() needs to put the sandbox back byte for byte. */
export function snapshotHero() {
  const dump = execFileSync('mariadb-dump', ['-uroot', 'sporta', 'hero_slides', '--no-create-info', '--skip-triggers', '--default-character-set=utf8mb4'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const ai = Number(sql(`select auto_increment from information_schema.tables where table_schema = 'sporta' and table_name = 'hero_slides'`)) || 1
  const row = sql(`select concat(value, char(1), updated_at) from settings where name = 'hero'`)
  const [value, updated] = row ? row.split('\x01') : [null, null]
  return { dump, ai, value, updated }
}

export function restoreHero(s) {
  run(`delete from hero_slides;\n${s.dump}\nalter table hero_slides auto_increment = ${Number(s.ai)};`)
  if (s.value === null) sql(`delete from settings where name = 'hero'`)
  else sql(`insert into settings (name, value, updated_at) values ('hero', ${q(s.value)}, ${q(s.updated)})
            on duplicate key update value = values(value), updated_at = values(updated_at)`)
}

/** The hero settings row, written whole (the panel writes it whole too). */
export function setHero({ size = 'full', autoplay = false, shuffle = false, speed_ms = 6500 } = {}) {
  sql(`insert into settings (name, value) values ('hero', ${q(JSON.stringify({ speed_ms, shuffle, size, autoplay }))})
       on duplicate key update value = values(value)`)
}

/** The live shape: seven active slides, and the settings row the live shop has (or as overridden). */
export function seedLiveHero(hero = {}, slides = LIVE_SLIDES) {
  let s = 'delete from hero_slides;\n'
  for (const [id, sort, d, m, fx, fy, ten, tar] of slides) {
    const db = readFileSync(new URL(d, ART)); const [w, h] = webpSize(db)
    const mb = m ? readFileSync(new URL(m, ART)) : null; const [mw, mh] = mb ? webpSize(mb) : [null, null]
    s += `insert into hero_slides (id, sort, active, title_en, title_ar, cta_label_en, cta_label_ar, cta_href,
            image, image_hash, image_w, image_h,
            image_mobile, image_mobile_hash, image_mobile_w, image_mobile_h, focal_x, focal_y) values (
            ${id}, ${sort}, 1, ${q(ten)}, ${q(tar)}, ${ten ? "'Shop now', 'تسوق الآن', '/shop'" : 'null, null, null'},
            'data:image/webp;base64,${db.toString('base64')}',
            '${createHash('sha256').update(db).digest('hex')}', ${w}, ${h},
            ${mb ? `'data:image/webp;base64,${mb.toString('base64')}'` : 'null'},
            ${mb ? `'${createHash('sha256').update(mb).digest('hex')}'` : 'null'}, ${mw ?? 'null'}, ${mh ?? 'null'}, ${fx}, ${fy});\n`
  }
  run(s)
  setHero(hero)
  return slides.map((r) => r[0])
}

/** The URL ?r=slides hands the bundle for a slide's desktop or phone picture (api.php, ?r=slides). */
export function slideUrl(id, phone = false) {
  const col = phone ? 'image_mobile_hash' : 'image_hash'
  const h = sql(`select left(${col}, 16) from hero_slides where id = ${Number(id)}`)
  return `/api/api.php?r=slide_image&id=${id}${phone ? '&mobile=1' : ''}&v=${h}`
}
