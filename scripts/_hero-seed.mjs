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
 *
 * THE POLISHED SHAPE (2026-10-14), for a rig that measures the shop AFTER
 * scripts/publish/publish-hero-polish.php: seedPolishedHero() seeds polishedSlides() — the five
 * carrying the polish desktop and SQUARE phone files, ids 2 and 3 present but switched off, and
 * autoplay on every 6.5 s. Its subtitles are the live slides' own, READ out of the publishers that
 * wrote them (hero-captions.php, and update-crossfit-hero-text.php for the owner's CrossFit line),
 * never typed here; Sporta features has none on record and gets none. LIVE_SLIDES is unchanged.
 *
 * A slide tuple may carry three optional trailing fields — active (default 1), subtitle_en,
 * subtitle_ar (default null) — so an eight-field tuple seeds exactly what it always did.
 *
 * HERO_SEED_DB names another database for a rig that must not share the sandbox's (default
 * `sporta`); it needs the same hero_slides and settings tables.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ART = new URL('../sporta-site/assets/hero/', import.meta.url)
const PUB = new URL('./publish/', import.meta.url)
const DBNAME = process.env.HERO_SEED_DB || 'sporta'
if (!/^\w+$/.test(DBNAME)) throw new Error('HERO_SEED_DB is not a plain database name')
const DB = ['-uroot', DBNAME, '--default-character-set=utf8mb4']
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
  const dump = execFileSync('mariadb-dump', ['-uroot', DBNAME, 'hero_slides', '--no-create-info', '--skip-triggers', '--default-character-set=utf8mb4'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const ai = Number(sql(`select auto_increment from information_schema.tables where table_schema = '${DBNAME}' and table_name = 'hero_slides'`)) || 1
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
  for (const [id, sort, d, m, fx, fy, ten, tar, active = 1, sen = null, sar = null] of slides) {
    const db = readFileSync(new URL(d, ART)); const [w, h] = webpSize(db)
    const mb = m ? readFileSync(new URL(m, ART)) : null; const [mw, mh] = mb ? webpSize(mb) : [null, null]
    s += `insert into hero_slides (id, sort, active, title_en, title_ar, subtitle_en, subtitle_ar, cta_label_en, cta_label_ar, cta_href,
            image, image_hash, image_w, image_h,
            image_mobile, image_mobile_hash, image_mobile_w, image_mobile_h, focal_x, focal_y) values (
            ${id}, ${sort}, ${active ? 1 : 0}, ${q(ten)}, ${q(tar)}, ${q(sen)}, ${q(sar)}, ${ten ? "'Shop now', 'تسوق الآن', '/shop'" : 'null, null, null'},
            'data:image/webp;base64,${db.toString('base64')}',
            '${createHash('sha256').update(db).digest('hex')}', ${w}, ${h},
            ${mb ? `'data:image/webp;base64,${mb.toString('base64')}'` : 'null'},
            ${mb ? `'${createHash('sha256').update(mb).digest('hex')}'` : 'null'}, ${mw ?? 'null'}, ${mh ?? 'null'}, ${fx}, ${fy});\n`
  }
  run(s)
  setHero(hero)
  return slides.map((r) => r[0])
}

/** The subtitles the live slides were given, keyed by title_en, READ out of the two publishers that
 *  wrote them — hero-captions.php (Built to move, Strength your way, Ready to train) and
 *  update-crossfit-hero-text.php (the owner's CrossFit line) — so a seed carries the exact words. */
export function liveSubtitles() {
  const STR = `('(?:[^'\\\\]|\\\\.)*'|"[^"\\\\]*")`
  const unq = (t) => t[0] === '"' ? t.slice(1, -1) : t.slice(1, -1).replace(/\\(['\\])/g, '$1')
  const out = {}
  const cap = readFileSync(new URL('hero-captions.php', PUB), 'utf8')
  for (const m of cap.matchAll(new RegExp(`'[0-9a-f]{16}'\\s*=>\\s*\\[\\s*${STR},\\s*${STR},\\s*${STR},\\s*${STR}\\s*\\]`, 'g'))) {
    out[unq(m[2])] = { en: unq(m[4]), ar: unq(m[3]) }    // [title_ar, title_en, subtitle_ar, subtitle_en]
  }
  const cf = readFileSync(new URL('update-crossfit-hero-text.php', PUB), 'utf8')
  const v = (k) => { const m = cf.match(new RegExp(`^\\$${k}\\s*=\\s*${STR};`, 'm')); if (!m) throw new Error(`update-crossfit-hero-text.php has no $${k}`); return unq(m[1]) }
  out[v('TITLE_EN')] = { en: v('SUBTITLE_EN'), ar: v('SUBTITLE_AR') }
  if (Object.keys(out).length !== 4) throw new Error(`expected 4 live subtitles, read ${Object.keys(out).length}`)
  return out
}

/** The live shape after publish-hero-polish.php: the five on the polish files (desktop 2560, SQUARE
 *  phone), ids 2 and 3 kept but switched off, subtitles as the live rows carry them. Same ids, sort
 *  order, focal points and titles as LIVE_SLIDES. */
export function polishedSlides() {
  const sub = liveSubtitles()
  const polish = { 'crossfit-neutral-desktop.webp': 'crossfit', 'features-neutral-desktop.webp': 'features',
    'runner-neutral-desktop.webp': 'runner', 'activewear-neutral-desktop.webp': 'activewear', 'training-neutral-desktop.webp': 'training' }
  return LIVE_SLIDES.map(([id, sort, d, m, fx, fy, ten, tar]) => {
    const n = polish[d]
    if (!n) return [id, sort, d, m, fx, fy, ten, tar, 0, null, null]          // ids 2 and 3: switched off, not deleted
    return [id, sort, `${n}-polish-desktop-2560.webp`, `${n}-polish-phone.webp`, fx, fy, ten, tar, 1, sub[ten]?.en ?? null, sub[ten]?.ar ?? null]
  })
}

/** seedLiveHero() with the polished shape: autoplay on every 6.5 s unless overridden. */
export function seedPolishedHero(hero = {}) {
  return seedLiveHero({ autoplay: true, speed_ms: 6500, ...hero }, polishedSlides())
}

/** The URL ?r=slides hands the bundle for a slide's desktop or phone picture (api.php, ?r=slides). */
export function slideUrl(id, phone = false) {
  const col = phone ? 'image_mobile_hash' : 'image_hash'
  const h = sql(`select left(${col}, 16) from hero_slides where id = ${Number(id)}`)
  return `/api/api.php?r=slide_image&id=${id}${phone ? '&mobile=1' : ''}&v=${h}`
}
