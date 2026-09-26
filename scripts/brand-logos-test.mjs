/**
 * The brand-logo uploader, in a browser, against the REAL admin.php.
 *
 *   bash scripts/sandbox.sh
 *   python3 scripts/serve-dist.py 4173 &
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:4173/api npm run build:web
 *   node scripts/brand-logos-test.mjs
 *
 * ONE ORIGIN, as in production: serve-dist.py passes /api through to the PHP
 * site, so the session cookie and the X-Sporta-Admin header travel without a
 * CORS preflight — the topology Apache gives the live shop.
 *
 * WHAT IT PROVES, and each of these is a separate way the screen could look
 * right and be wrong:
 *
 *   1. A file NAMED AFTER A BRAND lands on that brand. This is the whole point
 *      of the screen; without it the owner assigns eight files by hand and the
 *      dialog would have been quicker.
 *   2. A file named after NOTHING lands on a PICKED brand, and on no other.
 *      The selection has to mean something or it is decoration.
 *   3. Pressing Upload writes to MARIADB. The screen showing a thumbnail
 *      proves React re-rendered; only `select logo is not null from brands`
 *      proves the request arrived.
 *   4. The brand's NAME IS UNCHANGED afterwards. brand_save is one route for
 *      create and rename, so this screen has to resend name_en, name_ar, slug
 *      and sort with every logo — and a screen that sent a blank name would
 *      rename the brand to nothing while appearing to upload a picture. That
 *      is the most damaging thing this code could plausibly do, and it is
 *      invisible on the screen that did it.
 *
 * MUTATION-TESTED, and the first attempt was not a mutation. Prefixing fold()
 * with a constant left both sides of the comparison folded the same way, so
 * every match still succeeded and the rig stayed green — the same shape as a
 * fixture measured through the code under test. Removing the match outright is
 * what proves the assertion: three failures, exactly the three about matching.
 *
 * IT WRITES TO THE SANDBOX DATABASE and puts it back: the two brands it
 * touches have their logo set to NULL again at the end, whatever happened.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

/** A real 8x8 PNG, as bytes. Not a placeholder string: the picture is decoded
 *  TWICE on the way through — once by createImageBitmap() in the browser, when
 *  shrink-image re-encodes it, and once by getImageSizeFromString() on the
 *  server — so anything that is not genuinely an image fails somewhere in the
 *  middle and reads as a broken screen.
 *
 *  IT WAS 2x2 FIRST, and Chromium's createImageBitmap refused to decode that
 *  file — `InvalidStateError`, while `file(1)` called it a valid PNG. The rig
 *  reported "0 uploaded, 2 did not" and the screen was fine. A fixture too
 *  small or too odd for the code under test is a fixture that fails the code
 *  for its own reasons; 8x8 decodes everywhere. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4EyaDFTEMLQkA0KhTgWqEqHIAAAAASUVORK5CYII='

// THE FIXTURE IS NAMED, NOT CHOSEN BY POSITION. `order by id limit 1` picked
// rig@local once in this project and cost three assertions that had nothing to
// do with what was being tested.
const NAMED = 'gymshark'   // matched by filename
const PICKED = 'vanquish'  // matched only because it is selected

const before = {
  named: sql(`select name_en from brands where slug='${NAMED}'`),
  picked: sql(`select name_en from brands where slug='${PICKED}'`),
  count: sql('select count(*) from brands'),
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

/** Drop files onto the page the way a person does — a real DragEvent carrying
 *  a real DataTransfer, which is what use-image-drop listens for. */
const dropFiles = (page, files) =>
  page.evaluate(
    async ({ files, b64 }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      for (const name of files) {
        dt.items.add(new File([bytes], name, { type: 'image/png' }))
      }
      document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { files, b64: PNG_B64 }
  )

try {
  // --- sign in -------------------------------------------------------------
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(2500)

  await p.goto(`${BASE}/backends/brand-logos`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  const screen = await p.locator('body').innerText()
  check(/brands have no logo|brands have a logo/i.test(screen), 'the brand-logo screen loads and counts the brands')
  check(new RegExp(before.named, 'i').test(screen), `and lists the brands (${before.named})`)

  // --- 2. pick one brand, so an unmatched file has somewhere to go ---------
  await p.getByText('None', { exact: true }).first().click()
  await p.waitForTimeout(300)
  // The row is a checkbox; clicking its name selects it.
  await p.getByText(before.picked, { exact: true }).first().click()
  await p.waitForTimeout(400)

  // --- 1 + 2. one file named after a brand, one named after nothing --------
  await dropFiles(p, [`${NAMED}-logo.png`, 'IMG_4821.png'])
  await p.waitForTimeout(1200)

  const queued = await p.locator('body').innerText()
  check(/matched by name/.test(queued), 'a file named after a brand is matched by name')
  check(/filled in order/.test(queued), 'and a file named after nothing fills the picked brand')
  check(!/had nowhere to go/.test(queued), 'neither file was orphaned')
  check(/Upload 2/.test(queued), 'the button counts both', queued.match(/Upload \d+/)?.[0] ?? '')

  // --- 3. the write has to land in MariaDB --------------------------------
  const api = []
  p.on('response', (r) => {
    if (r.url().includes('admin.php')) api.push(`${decodeURIComponent(r.url().split('?')[1] ?? '')} -> ${r.status()}`)
  })
  // Clicked by its exact count, and CHECKED FIRST. When a mutation left only
  // one file queued, this threw a Playwright timeout and the run died with a
  // stack trace instead of reporting three clean failures — a rig that crashes
  // where it should fail hides the two assertions after it.
  const uploadBtn = p.getByText(/^Upload 2$/).first()
  if (!(await uploadBtn.count())) {
    check(false, 'the Upload button offers both files', 'nothing matching "Upload 2" on screen')
  } else {
    await uploadBtn.click()
  }
  await p.waitForTimeout(8000)
  if (process.env.DEBUG) {
    console.log('API:', api.join(' | '))
    console.log('SCREEN:', (await p.locator('body').innerText()).slice(0, 1400))
  }

  const gotNamed = sql(`select logo is not null from brands where slug='${NAMED}'`)
  const gotPicked = sql(`select logo is not null from brands where slug='${PICKED}'`)
  check(gotNamed === '1', `${NAMED} has a logo in the database`, `logo is not null = ${gotNamed}`)
  check(gotPicked === '1', `${PICKED} has one too`, `logo is not null = ${gotPicked}`)

  // --- 4. and the names were not collateral damage ------------------------
  check(sql(`select name_en from brands where slug='${NAMED}'`) === before.named,
    `${NAMED} still has its name`)
  check(sql(`select name_en from brands where slug='${PICKED}'`) === before.picked,
    `${PICKED} still has its name`)
  // AGAINST THE COUNT TAKEN BEFORE, not against itself. This read
  // `count(*) === count(*)` in its first draft, which is true of any database
  // in any state and would have passed while brand_save inserted a ninth brand
  // on every upload — the exact failure it was written to catch, since a
  // missing id makes that route create rather than update.
  check(sql('select count(*) from brands') === before.count,
    'and no brand was created as a side effect', `${before.count} before, ${sql('select count(*) from brands')} after`)

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  // Put the sandbox back whatever happened, so a failing run does not leave
  // two logos behind for the next one to find and call a pass.
  sql(`update brands set logo = null where slug in ('${NAMED}','${PICKED}')`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — pick brands, drop a folder, and the logos land')
process.exit(fails ? 1 : 0)
