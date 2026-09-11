/**
 * The brand-logo uploader ON THE WEBSITE's own /backends panel.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/brand-logos-site-test.mjs
 *
 * The app has its own screen for this and its own rig (brand-logos-test.mjs).
 * They are two different programs against one server, so a green run there
 * says nothing about the website — which is the panel the owner actually opens
 * in a browser.
 *
 * WHAT IT PROVES, and each is a distinct way an overlay can look right and be
 * wrong:
 *
 *   1. THE CARD APPEARS ON Brands AND NOWHERE ELSE. An overlay that attaches
 *      to the wrong screen — or to every screen — is the commonest failure of
 *      this pattern, and it is invisible if you only ever look at the page you
 *      wrote it for.
 *   2. A file named after a brand lands on that brand; a file named after
 *      nothing lands on a TICKED one.
 *   3. Upload writes to MariaDB. The card saying "1 uploaded" proves a
 *      function returned; only the row proves the request arrived.
 *   4. THE BRAND'S NAME SURVIVES. brand_save is one route for create and
 *      rename, so the overlay must resend name_en, name_ar, slug and sort with
 *      every logo. An overlay that sent only the logo would blank the name
 *      while appearing to upload a picture — the most damaging thing this code
 *      could plausibly do, and nothing on screen would show it.
 *   5. The panel's own Brands screen still works — the overlay adds, it does
 *      not replace.
 *
 * It writes to the sandbox database and puts it back.
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

/** A real 8x8 PNG. It is decoded twice on the way through — createImageBitmap
 *  in the browser and getimagesizefromstring on the server — so a placeholder
 *  string fails in the middle and reads as a broken overlay. 2x2 was the first
 *  try and Chromium refused to decode it while file(1) called it valid. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4EyaDFTEMLQkA0KhTgWqEqHIAAAAASUVORK5CYII='

// Named fixtures, not `order by id limit 1`.
const NAMED = 'gymshark'
const PICKED = 'vanquish'

const before = {
  named: sql(`select name_en from brands where slug='${NAMED}'`),
  picked: sql(`select name_en from brands where slug='${PICKED}'`),
  count: sql('select count(*) from brands'),
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 950 } })
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

  // --- 1. not on the wrong screen ------------------------------------------
  check((await p.locator('.sbl').count()) === 0, 'the card is absent on Overview')

  await p.getByText('Orders', { exact: true }).first().click()
  await p.waitForTimeout(1500)
  check((await p.locator('.sbl').count()) === 0, 'and absent on Orders')

  await p.getByText('Brands', { exact: true }).first().click()
  await p.waitForTimeout(2500)
  check((await p.locator('.sbl').count()) === 1, 'and present exactly once on Brands')

  const head = await p.locator('.sbl').innerText()
  check(/brands have no logo|brands have a logo/.test(head), 'it counts the brands from the server', head.split('\n')[1] ?? '')
  check(/Upload 0/.test(head), 'and offers nothing to upload yet')

  // --- 5. the panel's own screen is intact ---------------------------------
  check((await p.getByText('Edit', { exact: true }).count()) > 0,
    "the panel's own brand rows are still there")

  // --- 2. tick one brand, then drop two files ------------------------------
  await p.locator('.sbl-chip', { hasText: 'None' }).click()
  await p.waitForTimeout(200)
  await p.locator('.sbl-row', { hasText: before.picked }).locator('input[type=checkbox]').check()
  await p.waitForTimeout(300)

  await dropFiles(p, [`${NAMED}-logo.png`, 'IMG_4821.png'])
  await p.waitForTimeout(1200)

  const queued = await p.locator('.sbl').innerText()
  check(/matched by name/.test(queued), 'a file named after a brand is matched by name')
  check(/filled in order/.test(queued), 'and a file named after nothing fills the ticked brand')
  check(!/had nowhere to go/.test(queued), 'neither file was orphaned')
  check(/Upload 2/.test(queued), 'the button counts both', queued.match(/Upload \d+/)?.[0] ?? '')

  // --- 3. the write lands ---------------------------------------------------
  const go = p.locator('.sbl-go')
  if (!(await go.count())) check(false, 'there is an Upload button to press')
  else {
    await go.click()
    await p.waitForTimeout(8000)
  }

  check(sql(`select logo is not null from brands where slug='${NAMED}'`) === '1',
    `${NAMED} has a logo in the database`)
  check(sql(`select logo is not null from brands where slug='${PICKED}'`) === '1',
    `${PICKED} has one too`)

  // --- 4. and the names are untouched --------------------------------------
  check(sql(`select name_en from brands where slug='${NAMED}'`) === before.named,
    `${NAMED} still has its name`)
  check(sql(`select name_en from brands where slug='${PICKED}'`) === before.picked,
    `${PICKED} still has its name`)
  check(sql('select count(*) from brands') === before.count,
    'and no brand was created as a side effect',
    `${before.count} before, ${sql('select count(*) from brands')} after`)

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  sql(`update brands set logo = null where slug in ('${NAMED}','${PICKED}')`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the website panel takes a folder of logos')
process.exit(fails ? 1 : 0)
