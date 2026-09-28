/**
 * The product page's big photograph is 4:5 portrait at EVERY width.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/product-photo-shape-test.mjs
 *
 * WHY THIS EXISTS. On 2026-09-23 the viewer was set to 4:5 and its comment
 * said "same on mobile and desktop". It was not: an older phone rule with a
 * more specific selector kept the box LANDSCAPE (1.25:1, 390x312) below
 * 1024px, so every portrait product photo lost its top and bottom on phones
 * for five days while the stylesheet said otherwise. Nothing measured it.
 *
 * It uploads a real 4:5 photograph through the panel's own route (the sandbox
 * has none, and a placeholder SVG is not what a shopper sees), measures the
 * rendered box at phone, tablet and desktop widths in both languages, and
 * requires the box to have the PHOTO'S shape — so nothing is cropped — then
 * deletes the photo in a finally.
 */
import { chromium } from 'playwright'
import zlib from 'node:zlib'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cagliari-calcio-sweatshirt-navy'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
  return ok
}

// A 400x500 PNG, built here so the rig needs no fixture file and no image library.
function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 180; raw[o + 1] = y < h / 5 ? 200 : 60; raw[o + 2] = 30
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let jar = ''
const admin = async (r, body) => {
  const res = await fetch(`${BASE}/api/admin.php?r=${r}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(jar ? { Cookie: jar } : {}) },
  })
  const c = res.headers.getSetCookie?.() ?? []
  if (c.length) jar = c.map((x) => x.split(';')[0]).join('; ')
  return { status: res.status, body: await res.json().catch(() => null) }
}

const login = await admin('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
check(login.status === 200, 'signed in to the sandbox panel', JSON.stringify(login.body))
const up = await admin('product_image_add', { slug: SLUG, image: 'data:image/png;base64,' + png(400, 500).toString('base64') })
check(up.status === 200 && up.body?.id, 'uploaded a 4:5 test photograph', JSON.stringify(up.body))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const cases = [
    ['phone 390', 390, 844, true, '?lang=en'], ['phone 390 ar', 390, 844, true, ''],
    ['small phone 360', 360, 740, true, ''], ['tablet 820', 820, 1180, true, ''],
    ['desktop 1280', 1280, 900, false, '?lang=en'],
  ]
  let measured = 0
  for (const [label, w, h, mob, lang] of cases) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob })
    await p.goto(`${BASE}/product/${SLUG}${lang}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(700)
    const m = await p.evaluate((id) => {
      const img = [...document.querySelectorAll('main img')]
        .find((i) => i.src.includes(`id=${id}&`) && i.getBoundingClientRect().width > 150)
      if (!img) return null
      const r = img.getBoundingClientRect()
      return { w: r.width, h: r.height, nat: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit }
    }, up.body?.id)
    await p.close()
    // A viewer that was never found must fail here, not pass every ratio check below.
    if (!check(!!m, `${label}: the photograph's main viewer was found`)) continue
    measured++
    const box = m.w / m.h
    check(Math.abs(box - m.nat) < 0.02,
      `${label}: the box has the photo's own 4:5 shape, so nothing is cropped`,
      `box ${Math.round(m.w)}x${Math.round(m.h)} (${box.toFixed(2)}) against photo ${m.nat.toFixed(2)}, object-fit ${m.fit}`)
  }
  check(measured === cases.length, `measured every width (${measured}/${cases.length})`)
} finally {
  await browser.close()
  if (up.body?.id) {
    const del = await admin('product_image_delete', { id: up.body.id })
    check(del.body?.deleted === 1, 'the test photograph was deleted again', JSON.stringify(del.body))
  }
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the whole garment shows, on every screen')
process.exit(fails ? 1 : 0)
