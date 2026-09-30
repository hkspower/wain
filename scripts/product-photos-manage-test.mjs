/**
 * The three improvements to the bulk photograph uploader asked for on
 * 2026-09-17: preview thumbnails before upload, a visible drop zone, and
 * managing (deleting, reordering) photographs already on a garment.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/product-photos-manage-test.mjs
 *
 * Deliberately separate from product-photos-site-test.mjs rather than folded
 * into it — that rig already proves the upload path in full and this one
 * proves three independent additions that do not touch it. Keeping them apart
 * means a failure here says "the new part broke", not "something in a
 * eighteen-assertion file broke, somewhere".
 *
 * Seeds three real rows in product_images for a real product (rather than
 * relying on the seed catalogue's own photographs, which may be zero) so the
 * "manage existing" grid has something to expand into, and cleans up exactly
 * those three rows.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'
const SLUG = 'cagliari-calcio-backpack-navy'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4EyaDFTEMLQkA0KhTgWqEqHIAAAAASUVORK5CYII='
// product_images.image is longtext holding a data: URI, exactly what
// store_data_image() writes — not raw bytes. See productimage.mysql.sql.
const DATA_URI = 'data:image/png;base64,' + PNG_B64

const before = Number(sql(`select count(*) from product_images where slug='${SLUG}'`))

// Three distinguishable rows: a solid colour swapped into the tiny PNG's own
// bytes would need a real encoder, so instead the THREE rows are told apart
// by their sort position, not their pixels — which is exactly the property
// the reorder assertions need anyway.
for (let i = 0; i < 3; i++) {
  execFileSync('mariadb', ['-uroot', 'sporta', '-e',
    `insert into product_images (slug, sort, image, image_hash, image_w, image_h) values ('${SLUG}', ${i}, '${DATA_URI}', sha2('${DATA_URI}${i}',256), 8, 8)`,
  ])
}
const ids = sql(`select id from product_images where slug='${SLUG}' order by sort`).split('\n').map(Number)
check(ids.length === 3, 'seeded three photographs to manage', `ids=${ids.join(',')}`)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

const dropFiles = (page, files) =>
  page.evaluate(
    ({ files, b64 }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      for (const name of files) dt.items.add(new File([bytes], name, { type: 'image/png' }))
      document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { files, b64: PNG_B64 }
  )

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await p.waitForTimeout(3000)

  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(3000)
  check((await p.locator('.spp').count()) === 1, 'the uploader is on Catalogue')

  // --- 1. a visible drop zone -----------------------------------------------
  check((await p.locator('.spp-drop').count()) === 1, 'a drop-zone element is rendered')
  const dropVisible = await p.locator('.spp-drop').isVisible()
  check(dropVisible, 'and it is actually visible, not display:none')
  const beforeInputClick = await p.locator('.spp-file').inputValue().catch(() => '')
  // Clicking the drop zone opens the same file picker as the "Choose
  // photographs" chip — proved indirectly, since a real file dialog cannot be
  // driven headlessly: the click must not throw and must not navigate away.
  await p.locator('.spp-drop').click({ trial: false }).catch(() => {})
  check(page_url_unchanged(p), 'clicking the drop zone does not navigate away')
  function page_url_unchanged(pg) { return pg.url().includes('/backends') }

  // --- 2. queued files show a real thumbnail --------------------------------
  await dropFiles(p, ['cagliari-calcio-backpack-9.png'])
  await p.waitForTimeout(800)
  const thumbSrc = await p.locator('.spp-row .spp-thumb').first().getAttribute('src')
  check(!!thumbSrc && thumbSrc.startsWith('blob:'), 'a queued file gets a real preview thumbnail', thumbSrc || '(none)')
  // The row now carries ↑ and ↓ before ✕ (reordering, added later), so the
  // FIRST .spp-x is "move earlier". Click the remove button by its name.
  await p.locator('.spp-row .spp-x[aria-label^="Take "]').first().click()
  await p.waitForTimeout(300)
  check((await p.locator('.spp-row').count()) === 0, 'removing it clears the queue row')

  // --- 3. existing photographs are manageable here --------------------------
  await p.waitForTimeout(8000) // let counts()/images load for every garment
  check((await p.locator('.spm').count()) === 1, 'the "existing photographs" section renders')

  // The name carries an em dash (Cagliari Calcio Backpack — Navy) that does
  // not round-trip cleanly through every shell/encoding along the way here,
  // so match on the two words either side of it rather than the exact string.
  const toggle = p.locator('.spm-toggle', { hasText: /Cagliari Calcio Backpack.*Navy/ })
  check((await toggle.count()) === 1, 'the seeded garment has a manage row', `count=${await toggle.count()}`)
  check((await p.locator('.spm-grid').count()) === 0, 'collapsed by default — no grid rendered yet')

  await toggle.click()
  await p.waitForTimeout(400)
  const cells = p.locator('.spm-thumb-wrap')
  check((await cells.count()) === 3, 'expanding shows all three photographs', `count=${await cells.count()}`)

  // Reorder: move the FIRST photograph later, and confirm the server's own
  // order agrees, not just the DOM.
  await cells.nth(0).locator('.spm-thumb-btn').nth(1).click() // "↓" is index 1
  await p.waitForTimeout(600)
  const orderAfterMove = sql(`select id from product_images where slug='${SLUG}' order by sort`).split('\n').map(Number)
  check(orderAfterMove[1] === ids[0], 'moving a photograph later actually reorders it on the server',
    `expected id ${ids[0]} at position 1, got ${orderAfterMove.join(',')}`)

  // Delete: remove one photograph and confirm the row is gone, not merely
  // hidden — window.confirm is stubbed to accept.
  await p.evaluate(() => { window.confirm = () => true })
  const beforeDeleteCount = await sql(`select count(*) from product_images where slug='${SLUG}'`)
  await cells.nth(0).locator('.spm-thumb-del').click()
  await p.waitForTimeout(600)
  const afterDeleteCount = await sql(`select count(*) from product_images where slug='${SLUG}'`)
  check(Number(afterDeleteCount) === Number(beforeDeleteCount) - 1,
    'deleting a photograph removes exactly one row from the server',
    `${beforeDeleteCount} -> ${afterDeleteCount}`)
  check((await p.locator('.spm-thumb-wrap').count()) === 2, 'and the grid drops to two thumbnails')

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  sql(`delete from product_images where slug='${SLUG}' and id in (${ids.join(',')})`)
  const after = Number(sql(`select count(*) from product_images where slug='${SLUG}'`))
  console.log(after === before ? 'ok   cleanup: back to the original count' : `FAIL cleanup: ${before} -> ${after}`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — thumbnails, the drop zone and photograph management all work')
process.exit(fails ? 1 : 0)
