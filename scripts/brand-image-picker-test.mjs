/**
 * npm run test:brand-image-picker — the folder-picker half of brand logos
 * ("select the images from file manager then assign their brand at backend",
 * 2026-09-27): images/_uploads/brand_image_candidates + brand_image_assign,
 * against the real admin.php, plus the panel card in a real browser.
 *
 *   bash scripts/sandbox.sh && npm run test:brand-image-picker
 *
 * Three layers:
 *   1. The gate — both routes refuse a caller who is not signed in.
 *   2. The routes themselves — a folder of real pictures (plus one non-image
 *      and one path-traversal attempt) driven through both routes, checking
 *      every refusal leaves the folder and the database exactly as they were.
 *   3. The card, in a real browser, end to end: pick a thumbnail, pick a
 *      brand, and read the brand's logo back changed.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const UPLOAD_DIR = new URL('../sporta-site/public_html/images/_uploads', import.meta.url).pathname
const ARCHIVE_DIR = UPLOAD_DIR + '/_assigned'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

const jar = []
const req = async (url, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  if (jar.length) headers.Cookie = jar.join('; ')
  const res = await fetch(url, { ...opts, headers })
  const setC = res.headers.getSetCookie?.() ?? []
  for (const c of setC) {
    const pair = c.split(';')[0]
    const name = pair.split('=')[0]
    const i = jar.findIndex((k) => k.split('=')[0] === name)
    if (i >= 0) jar[i] = pair; else jar.push(pair)
  }
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

// 1x1 PNG and a genuinely different 1x1 PNG (red vs blue), so "which bytes
// landed on the brand" is checkable rather than assumed.
const PNG_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64')
const PNG_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAACUlEQVR4nGP4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC', 'base64')

// Leave nothing behind, whatever a mid-run failure does. Anything this run
// itself created in _uploads/ or _assigned/, gone; the brand's original logo,
// restored.
const cleanupNames = ['sporta-rig-red.png', 'sporta-rig-blue.png', 'sporta-rig-notimage.txt']
function cleanupFiles() {
  for (const n of cleanupNames) {
    rmSync(UPLOAD_DIR + '/' + n, { force: true })
    rmSync(ARCHIVE_DIR + '/' + n, { force: true })
  }
}

const main = async () => {
  mkdirSync(UPLOAD_DIR, { recursive: true })
  cleanupFiles()

  console.log('--- 1. the gate')
  {
    const list = await req(`${ADMIN}?r=brand_image_candidates`, { headers: { 'X-Sporta-Admin': '1' } })
    check(list.status === 401, 'brand_image_candidates refuses anyone not signed in', `HTTP ${list.status}`)
    const assign = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' }, body: JSON.stringify({ name: 'x', brand_id: 1 }),
    })
    check(assign.status === 401, 'and so does assigning', `HTTP ${assign.status}`)
  }

  const login = await req(`${ADMIN}?r=login`, {
    method: 'POST', headers: { 'X-Sporta-Admin': '1' },
    body: JSON.stringify({ email: 'manager@sporta.com.kw', password: 'correct horse' }),
  })
  check(login.status === 200 && !login.body?.error, 'signed in to the panel', JSON.stringify(login.body))
  if (login.body?.error) return

  const brands = (await req(`${ADMIN}?r=brands`, { headers: { 'X-Sporta-Admin': '1' } })).body
  check(Array.isArray(brands) && brands.length > 0, 'read the brand list', JSON.stringify(brands).slice(0, 120))
  const brandA = brands.find((b) => b.slug === 'ahed') ?? brands[0]
  const brandB = brands.find((b) => b.slug === 'rheo' && b.id !== brandA.id) ?? brands[1]
  const originalLogoA = brandA.logo

  console.log('\n--- 2. the routes, against real files')
  try {
    writeFileSync(UPLOAD_DIR + '/sporta-rig-red.png', PNG_RED)
    writeFileSync(UPLOAD_DIR + '/sporta-rig-blue.png', PNG_BLUE)
    writeFileSync(UPLOAD_DIR + '/sporta-rig-notimage.txt', 'not a picture')

    const list1 = (await req(`${ADMIN}?r=brand_image_candidates`, { headers: { 'X-Sporta-Admin': '1' } })).body
    check(Array.isArray(list1), 'the candidate list answers', JSON.stringify(list1).slice(0, 120))
    const names1 = (list1 ?? []).map((c) => c.name)
    check(names1.includes('sporta-rig-red.png') && names1.includes('sporta-rig-blue.png'),
      'both real pictures are listed', JSON.stringify(names1))
    check(!names1.includes('sporta-rig-notimage.txt'),
      'the non-image file is silently skipped, not listed as a candidate', JSON.stringify(names1))
    const red = (list1 ?? []).find((c) => c.name === 'sporta-rig-red.png')
    check(!!red && /^data:image\/(png|webp);base64,/.test(red.dataUri ?? ''),
      'the picture carries its own data: URI thumbnail, ready to draw with no second request',
      JSON.stringify(red).slice(0, 120))

    // A refusal must change nothing: not the folder, not the database.
    const before = readdirSync(UPLOAD_DIR).sort()
    const traversal = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ name: '../../../../etc/passwd', brand_id: brandA.id }),
    })
    check(traversal.status === 404 && traversal.body?.error === 'image_not_found',
      'a path-traversal name is refused as image_not_found, not served or written', JSON.stringify(traversal.body))
    const missing = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ name: 'sporta-rig-notimage.txt', brand_id: brandA.id }),
    })
    check(missing.status === 404 && missing.body?.error === 'image_not_found',
      'the non-image file cannot be assigned either', JSON.stringify(missing.body))
    const badBrand = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ name: 'sporta-rig-red.png', brand_id: 999999 }),
    })
    check(badBrand.status === 404 && badBrand.body?.error === 'brand_not_found',
      'an unknown brand id is refused', JSON.stringify(badBrand.body))
    check(JSON.stringify(readdirSync(UPLOAD_DIR).sort()) === JSON.stringify(before),
      'none of those three refusals moved or removed a single file')

    // The real assignment.
    const assigned = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ name: 'sporta-rig-red.png', brand_id: brandA.id }),
    })
    check(assigned.status === 200 && !assigned.body?.error, 'assigning the red picture succeeds',
      JSON.stringify(assigned.body).slice(0, 120))
    check(assigned.body?.logo === 'data:image/png;base64,' + PNG_RED.toString('base64'),
      'the brand’s logo is exactly the bytes that were assigned, byte for byte')
    check(assigned.body?.name_en === brandA.name_en && assigned.body?.slug === brandA.slug,
      'the brand’s own name and slug survived untouched — this route never resends brand_save’s four fields')

    check(!existsSync(UPLOAD_DIR + '/sporta-rig-red.png'), 'the source file left the upload folder')
    check(existsSync(ARCHIVE_DIR + '/sporta-rig-red.png'),
      'and landed in _assigned/ — archived, not deleted')

    const list2 = (await req(`${ADMIN}?r=brand_image_candidates`, { headers: { 'X-Sporta-Admin': '1' } })).body
    const names2 = (list2 ?? []).map((c) => c.name)
    check(!names2.includes('sporta-rig-red.png'),
      'the assigned picture is no longer offered as a candidate', JSON.stringify(names2))
    check(names2.includes('sporta-rig-blue.png'),
      'the OTHER picture is still there — assigning one does not touch the rest')

    // Re-uploading a file of the same name after archiving must not collide.
    writeFileSync(UPLOAD_DIR + '/sporta-rig-red.png', PNG_BLUE)
    const reassigned = await req(`${ADMIN}?r=brand_image_assign`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ name: 'sporta-rig-red.png', brand_id: brandB.id }),
    })
    check(reassigned.status === 200 && !reassigned.body?.error,
      'a second file with the same name assigns without colliding with the archived first one',
      JSON.stringify(reassigned.body).slice(0, 120))
    check(existsSync(ARCHIVE_DIR + '/sporta-rig-red.png') && existsSync(ARCHIVE_DIR + '/sporta-rig-red-2.png'),
      'both archived copies exist under distinct names', readdirSync(ARCHIVE_DIR).join(','))
  } finally {
    // Restore the state this run changed, whatever happened above.
    await req(`${ADMIN}?r=brand_save`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ id: brandA.id, name_en: brandA.name_en, name_ar: brandA.name_ar,
        slug: brandA.slug, sort: brandA.sort, logo: originalLogoA ?? '' }),
    })
    cleanupFiles()
  }

  console.log('\n--- 3. the card, in a real browser')
  {
    writeFileSync(UPLOAD_DIR + '/sporta-rig-blue.png', PNG_BLUE)
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    try {
      const p = await browser.newPage({ viewport: { width: 1400, height: 1400 } })
      const errors = []
      p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
      const card = () => p.locator('[data-sporta-panel="brand-image-picker"]')
      await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(1500)
      await p.locator('input').nth(0).fill('manager@sporta.com.kw')
      await p.locator('input').nth(1).fill('correct horse')
      await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
      await p.waitForTimeout(3000)
      await p.getByText('Brands', { exact: true }).first().click()
      await p.waitForTimeout(2000)
      check(await card().count() === 1, 'the card is on the Brands screen')

      await card().locator('.sbi-cell').first().click()
      await p.waitForTimeout(300)
      check(await card().locator('.sbi-brandlist .sbi-chip').count() > 0,
        'picking a thumbnail shows the list of brands to assign it to')
      const targetName = brandA.name_en
      await card().locator('.sbi-chip', { hasText: targetName }).first().click()
      await p.waitForFunction(() => {
        const n = document.querySelector('[data-sporta-panel="brand-image-picker"] .sbi-note')
        return n && /now uses that picture/.test(n.textContent || '')
      }, null, { timeout: 15000 })
      const note = await card().locator('.sbi-note').innerText()
      check(/now uses that picture/.test(note), 'the panel confirms the assignment in plain words', note)
      check(errors.length === 0, 'no page errors', errors.join(' | '))
    } finally {
      await browser.close()
    }
    // Restore again — the browser pass assigned brandA a second time.
    await req(`${ADMIN}?r=brand_save`, {
      method: 'POST', headers: { 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ id: brandA.id, name_en: brandA.name_en, name_ar: brandA.name_ar,
        slug: brandA.slug, sort: brandA.sort, logo: originalLogoA ?? '' }),
    })
    cleanupFiles()
  }

  console.log(fails ? `\n${fails} failed` : '\nall ok — pictures dropped in a folder become brand logos, safely')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
