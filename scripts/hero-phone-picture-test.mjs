/**
 * A phone is handed the phone picture — 2026-09-29.
 *
 *   bash scripts/sandbox.sh && node scripts/hero-phone-picture-test.mjs
 *
 * The storefront bundle never asks for &mobile=1, so ?r=slides answers a phone
 * with the phone picture in `image`, `width` and `height`. This rig asks the
 * SAME route with three different User-Agents and requires that a phone gets
 * the mobile URL and dimensions, a desktop and an iPad get the wide banner,
 * and a slide with no phone picture is never changed. It also requires that
 * the answer carries Vary: User-Agent, and that there IS a slide with a phone
 * picture to test against — an empty comparison passes everything.
 *
 * ONLY IN FULL, SINCE 2026-10-01. Tall and Short make the phone hero a 66-84px
 * strip, where a 4:5 phone picture shows about a sixth of itself and the
 * banner about half, so a phone gets the banner there. The rig sets the Size
 * itself, Full for the phone checks and Tall for that one, and puts back the
 * sandbox's own setting afterwards.
 * SANDBOX ONLY: it adds and removes one slide row of its own.
 */
import { execFileSync } from 'node:child_process'
const API = (process.env.BASE ?? 'http://127.0.0.1:4300') + '/api/api.php?r=slides'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', q], { encoding: 'utf8' })
const UA = {
  phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
}
const get = async (ua) => { const r = await fetch(API, { headers: { 'User-Agent': ua, 'Cache-Control': 'no-cache' } }); return { vary: r.headers.get('vary'), j: await r.json() } }

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
sql(`insert into hero_slides (sort, active, title_en, image, image_hash, image_w, image_h, image_mobile, image_mobile_hash, image_mobile_w, image_mobile_h)
     values (9101, 1, 'phone-rig-both', '${PNG}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3200, 1270, '${PNG}', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1080, 1350),
            (9102, 1, 'phone-rig-desktop-only', '${PNG}', 'cccccccccccccccccccccccccccccccc', 3200, 1270, null, null, null, null)`)
const savedHero = sql(`select value from settings where name = 'hero'`).split('\n')[1] ?? null
const setSize = (size) => sql(`insert into settings (name, value) values ('hero', '${JSON.stringify({ speed_ms: 6500, shuffle: false, autoplay: true, ...(savedHero ? JSON.parse(savedHero) : {}), size })}')
  on duplicate key update value = values(value)`)
try {
  setSize('full')
  const find = (j, t) => j.slides.find(s => s.title_en === t)
  const d = await get(UA.desktop)
  const both = find(d.j, 'phone-rig-both'), only = find(d.j, 'phone-rig-desktop-only')
  check(!!both && !!only, 'the rig can see both of its slides')
  check(!/mobile=1/.test(both.image) && both.width === 3200, 'a desktop gets the wide banner', both.image.slice(-40))
  check((d.vary || '').toLowerCase().includes('user-agent'), 'the answer carries Vary: User-Agent', String(d.vary))
  for (const k of ['phone', 'android']) {
    const p = await get(UA[k]); const b = find(p.j, 'phone-rig-both'), o = find(p.j, 'phone-rig-desktop-only')
    check(/mobile=1/.test(b.image) && b.width === 1080 && b.height === 1350, `${k}: the phone picture, with the phone picture's own size`, `${b.image.slice(-32)} ${b.width}x${b.height}`)
    check(!/mobile=1/.test(o.image) && o.width === 3200, `${k}: a slide with no phone picture is untouched`)
  }
  const t = await get(UA.ipad); const tb = find(t.j, 'phone-rig-both')
  check(!/mobile=1/.test(tb.image) && tb.width === 3200, 'an iPad gets the wide banner')
  // a strip: the banner shows about half of itself there, the phone picture about a sixth
  setSize('tall')
  const st = await get(UA.phone); const sb = find(st.j, 'phone-rig-both')
  check(st.j.hero?.size === 'tall', 'the rig really switched the Size to Tall', String(st.j.hero?.size))
  check(!/mobile=1/.test(sb.image) && sb.width === 3200, 'in Tall a phone gets the wide banner (its strip suits the banner)', `${sb.image.slice(-32)} ${sb.width}x${sb.height}`)
} finally {
  sql(`delete from hero_slides where title_en in ('phone-rig-both','phone-rig-desktop-only')`)
  if (savedHero) sql(`update settings set value = '${savedHero.replace(/'/g, "''")}' where name = 'hero'`)
  else sql(`delete from settings where name = 'hero'`)
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — a phone gets its own picture in Full, the banner in a strip, nothing else changes')
process.exit(fails ? 1 : 0)
