/**
 * The bulk photograph uploader on the WEBSITE's /backends Catalogue screen.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/product-photos-site-test.mjs
 *
 * WHAT IT PROVES, and each is a distinct way this could look right and be wrong:
 *
 *   1. THE CARD IS ON Catalogue AND NOWHERE ELSE. An overlay attached to the
 *      wrong screen — or to every screen — is the commonest failure of this
 *      pattern and invisible if you only look at the page you wrote it for.
 *   2. SEVERAL FILES LAND ON ONE GARMENT. This is the difference between this
 *      screen and the brand-logo one: `x-1.jpg`, `x-2.jpg`, `x-3.jpg` all fold
 *      to the same slug and must all be queued for it, in filename order.
 *   3. A FILE THAT MATCHES NOTHING IS NOT UPLOADED. The logo screen fills the
 *      ticked brands in order; here that would scatter a shoot across the wrong
 *      garments, and undoing it means deleting photographs one at a time from
 *      products you have to find first. It must wait for a person.
 *   4. Upload writes ROWS. The card saying "3 uploaded" proves a promise
 *      resolved; only `select count(*) from product_images` proves it arrived.
 *   5. THE PHOTOGRAPHS GO TO THE RIGHT GARMENT and are APPENDED — sort order
 *      continuing from what was there, not replacing it.
 *
 * MUTATION-TESTED, and one of the mutations taught something. Uploading the
 * unmatched file too fails three assertions, as it should. But removing the
 * trailing-number strip from fold() fails NOTHING — because the substring pass
 * covers the same case: `cagliari-calcio-backpack-1` still contains
 * `cagliari-calcio-backpack`. Two independent rules reach the same answer, so
 * no single-rule mutation can prove the assertion is live. Removing BOTH does:
 * `0 matched`, `Upload 0`. The redundancy is a feature, not a bug — it is worth
 * knowing it is there rather than believing one rule is load-bearing when it is
 * not.
 *
 * It writes to the sandbox database and deletes exactly what it inserted.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

/** A real 8x8 PNG — decoded by createImageBitmap here and by
 *  getimagesizefromstring on the server, so a placeholder string fails in the
 *  middle and reads as a broken overlay. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4EyaDFTEMLQkA0KhTgWqEqHIAAAAASUVORK5CYII='

// A named fixture, not `limit 1`. This one is real in the seeded catalogue and
// its slug is long enough that the substring pass cannot confuse it.
const SLUG = 'cagliari-calcio-backpack'

const before = {
  photos: Number(sql(`select count(*) from product_images where slug='${SLUG}'`)),
  total: Number(sql('select count(*) from product_images')),
}

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

  // --- 1. the right screen, and only it ------------------------------------
  check((await p.locator('.spp').count()) === 0, 'the card is absent on Overview')
  await p.getByText('Brands', { exact: true }).first().click()
  await p.waitForTimeout(1800)
  check((await p.locator('.spp').count()) === 0, 'and absent on Brands')
  // …where the OTHER card belongs, which also proves the two do not collide.
  check((await p.locator('.sbl').count()) === 1, 'and the brand-logo card is still the one on Brands')

  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(3000)
  check((await p.locator('.spp').count()) === 1, 'and present exactly once on Catalogue')
  check((await p.locator('.sbl').count()) === 0, 'with the brand-logo card gone')

  // Give the per-garment counts a moment; they are one request each.
  await p.waitForTimeout(6000)
  const head = await p.locator('.spp').innerText()
  check(/garments have a photograph|counting photographs/.test(head),
    'it reads the catalogue from the server', head.split('\n')[1] ?? '')

  // --- 2 + 3. three for one garment, one for nothing -----------------------
  await dropFiles(p, [`${SLUG}-3.png`, `${SLUG}-1.png`, `${SLUG}-2.png`, 'DSC_0099.png'])
  await p.waitForTimeout(1500)

  const queued = await p.locator('.spp').innerText()
  check((queued.match(/matched by name/g) || []).length === 3,
    'all three files named after the garment are matched to it',
    `${(queued.match(/matched by name/g) || []).length} matched`)
  check(/no match — choose a garment/.test(queued), 'and the fourth is left for a person to place')
  check(/Upload 3/.test(queued), 'the button offers only the three that are placed',
    queued.match(/Upload \d+/)?.[0] ?? '')

  // Filename order, not drop order: -1 before -2 before -3.
  const names = await p.locator('.spp-name').allInnerTexts()
  check(names[0].includes('-1') && names[1].includes('-2') && names[2].includes('-3'),
    'and they are queued in filename order, not the order they were dropped',
    names.slice(0, 3).join(', '))

  // --- 4 + 5. the write lands, on the right garment, appended --------------
  await p.locator('.spp-go').click()
  await p.waitForTimeout(12000)

  const after = Number(sql(`select count(*) from product_images where slug='${SLUG}'`))
  check(after === before.photos + 3, `three photographs were added to ${SLUG}`,
    `${before.photos} before, ${after} after`)
  check(Number(sql('select count(*) from product_images')) === before.total + 3,
    'and three in the table overall — none went to another garment')
  check(sql(`select min(sort) from product_images where slug='${SLUG}'`) === String(before.photos),
    'appended, not inserted at the front',
    `first new sort = ${sql(`select min(sort) from product_images where slug='${SLUG}' and sort >= ${before.photos}`)}`)

  const done = await p.locator('.spp').innerText()
  check(/3 photograph\(s\) uploaded/.test(done), 'the card says so', done.split('\n').pop() ?? '')
  check(/no match — choose a garment/.test(done), 'and the unplaced file is still waiting')

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  // Exactly what was inserted, by sort position — not `delete where slug=`,
  // which would take the seed's photographs too if there ever are any.
  sql(`delete from product_images where slug='${SLUG}' and sort >= ${before.photos}`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — a whole shoot lands on the right garments')
process.exit(fails ? 1 : 0)
