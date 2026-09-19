/**
 * Where the panel's overlay cards appear — and where they must not.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/panel-placement-test.mjs
 *
 * WHY. Every card in assets/ is injected into a panel whose source is not in
 * this repository, so "which screen is this on" is a question about a DOM
 * neither side owns. The Google and Apple sign-in cards got it wrong in the
 * quietest possible way: they appended to `main` on any /backends path, and
 * the panel keeps that container across screen changes — so "Sign in with
 * Google" was the FIRST HEADING on the Catalogue, on Settings, on everything.
 * Nothing failed; the cards worked perfectly, in fourteen places at once.
 *
 * SO THIS TESTS THE ABSENCE, which is the half that was missing. A card that
 * mounts is easy to check and was never the problem. `panel-cards-test.mjs`
 * counts the cards on Settings and would have gone on passing while they piled
 * up everywhere else.
 *
 * IT ALSO TESTS THAT THEY COME DOWN AGAIN. Mounting on the right screen is not
 * enough: the panel swaps content in place, so a card that only ever appends
 * is still on the Catalogue a moment after you leave Security. The walk below
 * goes Security -> Catalogue -> Security on purpose.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

/**
 * A garment with a photograph, because no product on this shop has one.
 *
 * WITHOUT IT the thumbnail check below never runs — and a conditional that is
 * usually skipped is a check that reports nothing while looking like a pass.
 * The live shop is photos=0/46, so "usually" here means "always": the branch
 * would have been dead from the day it was written.
 */
const seeded = sql(`select slug from products where active = 1 order by id limit 1`)
const seedPhoto = () => {
  const uri = execFileSync('php', ['-r', `
    $im = imagecreatetruecolor(600, 750);
    imagefilledrectangle($im, 0, 0, 600, 750, imagecolorallocate($im, 190, 90, 30));
    ob_start(); imagejpeg($im, null, 88); $b = ob_get_clean();
    echo 'data:image/jpeg;base64,' . base64_encode($b);
  `], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  execFileSync('mariadb', ['-uroot', 'sporta', '-e',
    `delete from product_images where slug = '${seeded}';
     insert into product_images (slug, sort, image, image_hash, image_w, image_h)
     values ('${seeded}', 0, '${uri}', sha2('placement-rig', 256), 600, 750)`])
}

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}

/** The panel's own headings on whatever screen is showing. */
const heads = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.admin-content h1, .admin-content h2')].map((h) => h.textContent.trim()))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  seedPhoto()

  // ---- the storefront: the assistant launcher is gone ----------------------
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)

  const launcher = await page.evaluate(() => {
    // The same signature assistant-icon.js matches on, and for its reason: the
    // aria-label is "Open the Sporta assistant" in English and
    // "افتح مساعد سبورتا" in Arabic, sharing no substring a selector could
    // catch. Fixed to the corner plus aria-expanded is what identifies it.
    const all = [...document.querySelectorAll('[aria-expanded]')]
    const found = all.filter((e) => getComputedStyle(e).position === 'fixed')
    return {
      count: found.length,
      shown: found.filter((e) => getComputedStyle(e).display !== 'none').length,
    }
  })
  check(launcher.count >= 1,
    `the assistant launcher is still in the page (${launcher.count})`,
    'nothing matched — this rig cannot tell "hidden" from "never there", so it must find it first')
  check(launcher.shown === 0,
    'and it is not displayed',
    `${launcher.shown} still visible — the icon was asked to go, the feature was not`)

  // ---- the panel ----------------------------------------------------------
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('input').nth(0).fill(EMAIL)
  await page.locator('input').nth(1).fill(PASSWORD)
  await page.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await page.waitForTimeout(3000)

  const go = async (name) => {
    await page.getByText(name, { exact: true }).first().click()
    await page.waitForTimeout(2500)
    return heads(page)
  }

  const onSecurity = async (where, want) => {
    const h = await heads(page)
    const g = h.includes('Sign in with Google')
    const a = h.includes('Sign in with Apple')
    check(g === want, `${where}: the Google card is ${want ? 'there' : 'not there'}`, JSON.stringify(h))
    check(a === want, `${where}: the Apple card is ${want ? 'there' : 'not there'}`, JSON.stringify(h))
  }

  console.log('\n--- the sign-in cards belong to Security')
  await go('Security')
  await onSecurity('Security', true)

  // Its own headings, to prove the screen really is Security and this rig is
  // not just reading a card it put there itself.
  const sec = await heads(page)
  check(sec.includes('Two-factor sign-in') || sec.includes('Your details'),
    'and that screen is Security', JSON.stringify(sec))

  console.log('\n--- and nowhere else')
  for (const screen of ['Catalogue', 'Settings', 'Orders']) {
    await go(screen)
    await onSecurity(screen, false)
  }

  console.log('\n--- they come back on returning')
  await go('Security')
  await onSecurity('Security again', true)

  // ---- the products list carries a thumbnail url --------------------------
  console.log('\n--- the products list carries a photograph url')
  const products = await page.evaluate(async () => {
    const r = await fetch('/api/admin.php?r=products_all', {
      headers: { 'X-Sporta-Admin': '1' },
      credentials: 'include',
    })
    const j = await r.json()
    const rows = Array.isArray(j) ? j : (j.products ?? [])
    return {
      status: r.status,
      count: rows.length,
      hasKey: rows.length > 0 && 'thumb' in rows[0],
      bytes: JSON.stringify(j).length,
      sample: rows.find((x) => x.thumb) ?? null,
    }
  })
  check(products.status === 200 && products.count > 0,
    `?r=products_all answers with rows (${products.count})`)
  check(products.hasKey, 'every row carries a `thumb` key, null or not')
  // THE SIZE IS THE POINT of sending a url instead of the bytes. Forty-six
  // data URIs would be megabytes; this is the whole catalogue.
  check(products.bytes < 120000,
    `and the whole response is ${(products.bytes / 1024).toFixed(1)} kB`,
    'something is sending image bytes in this list')
  check(products.sample !== null,
    'the seeded garment came back with one',
    'the rig planted a photograph and the list did not report it — the join is wrong')
  if (products.sample) {
    check(/[?&]w=\d+/.test(products.sample.thumb),
      `and it asks for a thumbnail rather than the upload (${products.sample.thumb})`)
    check(/^api\.php\?r=product_image/.test(products.sample.thumb),
      'as a relative url the client absolutises, not as bytes',
      products.sample.thumb)
  }

  console.log(fails === 0
    ? '\nall ok — the cards are where they belong, the launcher is gone, the list is light'
    : `\n${fails} failed`)
} finally {
  sql(`delete from product_images where slug = '${seeded}'`)
  await browser.close()
}

process.exit(fails === 0 ? 0 : 1)
