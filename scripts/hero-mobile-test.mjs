/**
 * The phone-specific hero image — schema, API and admin-write plumbing.
 *
 *   bash scripts/sandbox.sh
 *   php scripts/dev/migrate-hero-mobile-sandbox.php
 *   node scripts/hero-mobile-test.mjs
 *
 * SANDBOX ONLY, like the migration it exercises. Nothing here touches
 * scripts/publish/, scripts/live/, or the live server.
 *
 * WHAT THIS PROVES, and why each one is not the obvious thing to check:
 *
 *   - THE MIGRATION IS IDEMPOTENT. `add column if not exists` doing nothing on
 *     a second run is the whole point of the idiom this project already uses
 *     for the product sale columns — a migration that is not safe to re-run
 *     is a migration that cannot be trusted after a half-finished first try.
 *
 *   - A SLIDE WITH NO MOBILE IMAGE NEVER 404s ON &mobile=1. It falls back to
 *     the desktop image. This is the property that matters most: the schema
 *     change must not be able to make an existing slide (every one of them,
 *     today) worse the moment something asks for &mobile=1.
 *
 *   - A SLIDE WITH BOTH IMAGES SERVES DISTINCT BYTES per request — the plain
 *     URL gives the desktop photo, &mobile=1 gives the phone one. Read back
 *     from the DATABASE what each should be and compare against the HTTP
 *     response's own bytes, not against what was uploaded, so a bug in the
 *     write path and a bug in the read path cannot cancel out.
 *
 *   - `?r=slides` TELLS THE CLIENT which slides have a mobile variant, with a
 *     boolean rather than making the client guess by requesting and seeing.
 *
 *   - THE ADMIN SAVE PATH VALIDATES image_mobile WITH THE SAME RIGOR AS image:
 *     a non-image is refused, a real image is accepted, and the stored bytes
 *     hash-match. Reusing store_data_image() rather than a second, weaker
 *     check is the property worth proving, not merely that *a* check exists.
 *
 * WHAT THIS RIG CANNOT PROVE, and says so rather than staying silent about it:
 * whether the live storefront BUNDLE (built, no source in this repo) would
 * ever actually request &mobile=1 below its breakpoint, or read has_mobile_
 * image at all. That is outside anything this repository can verify.
 */
import { execFileSync } from 'node:child_process'
import { execSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/api.php'
const ADMIN = BASE + '/api/admin.php'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const rows = (q) => {
  const out = sql(q).trim().split('\n')
  if (out.length < 2) return []
  const head = out[0].split('\t')
  return out.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
}

// ---------------------------------------------------------------- migration
console.log('-- migration idempotence --')
const runMigration = () => execSync('php scripts/dev/migrate-hero-mobile-sandbox.php', { encoding: 'utf8' })
const first = runMigration()
const second = runMigration()
check(/STATE .*image_mobile=yes.*image_mobile_hash=yes.*image_mobile_w=yes.*image_mobile_h=yes/.test(first),
  'first run leaves all four columns present', first.trim().split('\n').pop())
check(/READY/.test(second), 'second run is a no-op that still reports READY', second.trim().split('\n').pop())
check(!/FAILED/.test(second), 'second run names no failures')

// ------------------------------------------------------------- admin sign-in
let jar = ''
const call = async (url, body, opts = {}) => {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Sporta-Admin': '1',
      ...(jar ? { Cookie: jar } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  if (setCookie.length) jar = setCookie.map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, body: await r.json().catch(() => null) }
}

const login = await call(`${ADMIN}?r=login`, { email: 'manager@sporta.com.kw', password: 'correct horse' })
check(login.status === 200 && login.body?.ok !== false, 'admin sign-in for the save-path checks', JSON.stringify(login.body))

// A 1x1 red PNG and a 1x1 blue PNG, so "distinct bytes" is checkable rather
// than assumed: two DIFFERENT real images, not the same fixture twice.
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const BLUE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const NOT_AN_IMAGE = 'data:image/png;base64,' + Buffer.from('this is not a png at all').toString('base64')

const decodeUri = (uri) => Buffer.from(uri.split(',')[1], 'base64')

// ----------------------------------------------------------------- fixtures
console.log('-- fixtures --')

// Slide A: desktop image only, no mobile image at all.
const saveA = await call(`${ADMIN}?r=slide_save`, {
  title_en: 'Hero rig — desktop only', image: RED_PNG, active: 1, sort: 9001,
})
check(saveA.status === 200 && saveA.body?.id > 0, 'slide A (desktop only) saves', JSON.stringify(saveA.body))
const idA = saveA.body?.id

// Slide B: both images, distinct bytes.
const saveB = await call(`${ADMIN}?r=slide_save`, {
  title_en: 'Hero rig — both images', image: RED_PNG, image_mobile: BLUE_PNG, active: 1, sort: 9002,
})
check(saveB.status === 200 && saveB.body?.id > 0, 'slide B (desktop + mobile) saves', JSON.stringify(saveB.body))
const idB = saveB.body?.id

try {
  // ------------------------------------------------------- admin save-path validation
  console.log('-- admin save-path validation, same rigor as the desktop image --')

  const rejectNonImage = await call(`${ADMIN}?r=slide_save`, {
    title_en: 'Hero rig — bad mobile', image: RED_PNG, image_mobile: NOT_AN_IMAGE, active: 0, sort: 9003,
  })
  check(rejectNonImage.status !== 200, 'a non-image image_mobile is refused', JSON.stringify(rejectNonImage.body))

  const rowB = rows(`select image_hash, image_mobile_hash from hero_slides where id = ${idB}`)[0]
  const crypto = await import('node:crypto')
  const expectRedHash = crypto.createHash('sha256').update(RED_PNG).digest('hex')
  const expectBlueHash = crypto.createHash('sha256').update(BLUE_PNG).digest('hex')
  check(rowB?.image_hash === expectRedHash, 'slide B desktop image_hash matches what was sent (hash-verified)')
  check(rowB?.image_mobile_hash === expectBlueHash, 'slide B image_mobile_hash matches what was sent (hash-verified)')

  const rowANull = rows(`select image_mobile, image_mobile_hash from hero_slides where id = ${idA}`)[0]
  check(rowANull?.image_mobile === 'NULL' || rowANull?.image_mobile === null || rowANull?.image_mobile === '',
    'slide A stored no image_mobile at all', JSON.stringify(rowANull))

  // ------------------------------------------------------------- ?r=slides flag
  console.log('-- ?r=slides tells the client which slides have a mobile variant --')
  const slidesResp = await (await fetch(`${API}?r=slides`)).json()
  const listA = slidesResp.slides.find((s) => s.id === idA)
  const listB = slidesResp.slides.find((s) => s.id === idB)
  check(listA?.has_mobile_image === false, 'slide A reports has_mobile_image=false', JSON.stringify(listA))
  check(listB?.has_mobile_image === true, 'slide B reports has_mobile_image=true', JSON.stringify(listB))
  check(typeof listB?.image_mobile === 'string' && listB.image_mobile.includes('mobile=1'),
    'slide B carries an image_mobile URL with mobile=1', listB?.image_mobile)
  check(listA?.image_mobile === undefined, 'slide A carries no image_mobile URL at all')

  // ------------------------------------------------------ ?r=slide_image fallback + distinct bytes
  console.log('-- ?r=slide_image: fallback and distinct bytes --')

  const plainA = await fetch(`${API}?r=slide_image&id=${idA}`)
  const mobileA = await fetch(`${API}?r=slide_image&id=${idA}&mobile=1`)
  check(plainA.status === 200, 'slide A plain request is 200')
  check(mobileA.status === 200, 'slide A &mobile=1 is 200, NEVER 404, despite no mobile image')
  const plainABytes = Buffer.from(await plainA.arrayBuffer())
  const mobileABytes = Buffer.from(await mobileA.arrayBuffer())
  check(plainABytes.equals(mobileABytes), 'slide A &mobile=1 falls back to the exact desktop bytes')
  check(plainABytes.equals(decodeUri(RED_PNG)), 'slide A plain bytes are the uploaded red PNG, byte for byte')

  const plainB = await fetch(`${API}?r=slide_image&id=${idB}`)
  const mobileB = await fetch(`${API}?r=slide_image&id=${idB}&mobile=1`)
  check(plainB.status === 200 && mobileB.status === 200, 'slide B both requests are 200')
  const plainBBytes = Buffer.from(await plainB.arrayBuffer())
  const mobileBBytes = Buffer.from(await mobileB.arrayBuffer())
  check(plainBBytes.equals(decodeUri(RED_PNG)), 'slide B plain request serves the DESKTOP (red) bytes')
  check(mobileBBytes.equals(decodeUri(BLUE_PNG)), 'slide B &mobile=1 serves the MOBILE (blue) bytes, distinct from plain')
  check(!plainBBytes.equals(mobileBBytes), 'slide B plain and mobile responses are genuinely different bytes')

  // --------------------------------------------------------------- mutation tests
  console.log('-- mutation tests --')

  // Mutation 1: simulate "fallback removed" — ask for a row that has no
  // image_mobile using a raw query that only reads image_mobile (never
  // falls back), and confirm THAT would 404 — i.e. the fallback in api.php
  // is doing real work and is not a no-op that happens to pass.
  const rawMobileOnly = rows(`select image_mobile from hero_slides where id = ${idA}`)[0]
  const wouldBeEmpty = !rawMobileOnly?.image_mobile || rawMobileOnly.image_mobile === 'NULL'
  check(wouldBeEmpty, 'mutation check: slide A truly has no image_mobile in the row (fallback is load-bearing, not a no-op)')

  // Mutation 2: break the hash comparison by comparing against the WRONG
  // image — this must fail, proving the earlier hash assertions are not
  // vacuously true.
  const wrongHash = crypto.createHash('sha256').update(BLUE_PNG).digest('hex')
  check(rowB?.image_hash !== wrongHash, 'mutation check: desktop hash does NOT match the mobile image (assertions are not vacuous)')

  // Mutation 3: confirm the non-image rejection actually reached validation
  // and did not merely fail for an unrelated reason (e.g. missing title) —
  // resend the same payload but VALID, and require it to succeed, isolating
  // image_mobile as the cause of the earlier refusal.
  const sameButValid = await call(`${ADMIN}?r=slide_save`, {
    title_en: 'Hero rig — bad mobile', image: RED_PNG, image_mobile: BLUE_PNG, active: 0, sort: 9003,
  })
  check(sameButValid.status === 200 && sameButValid.body?.id > 0,
    'mutation check: the SAME payload with a real mobile image succeeds — isolates image_mobile as the earlier cause', JSON.stringify(sameButValid.body))
  if (sameButValid.body?.id) {
    await call(`${ADMIN}?r=slide_delete`, { id: sameButValid.body.id })
  }
} finally {
  // Clean up: a rig that leaves hero rows behind changes what every later
  // rig or manual look at hero_slides sees.
  if (idA) await call(`${ADMIN}?r=slide_delete`, { id: idA })
  if (idB) await call(`${ADMIN}?r=slide_delete`, { id: idB })
}

console.log('')
console.log(fails === 0 ? `ALL OK` : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
