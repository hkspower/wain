/**
 * The photograph thumbnails in the website panel — do they actually appear?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/panel-photo-preview-test.mjs
 *
 * WHY THIS EXISTS, AND IT IS THE WHOLE POINT: no check anywhere in this
 * repository ever asserted that a preview image DECODED.
 *
 * product-photos-manage-test.mjs covers this card thoroughly — it reorders on
 * the server, deletes on the server, counts the tiles — and the only thing it
 * asks about an image is that the QUEUED file's src begins with "blob:". It
 * never touches the existing-photograph grid's src at all. So this shipped:
 *
 *   admin.php returns `api.php?r=product_image&id=19&v=…`, relative, because
 *   its comment says "the website serves the panel from the same folder". The
 *   panel is at /backends, so the browser asked for /backends/api.php?… and
 *   .htaccess rewrote that to the SPA shell.
 *
 *   Measured: HTTP 200, Content-Type text/html, 51,754 bytes. Every tile in
 *   the grid fetched the front page and drew the browser's broken-image glyph.
 *
 * THE 200 IS WHY IT LASTED. Nothing failed. No error event, no console line,
 * no 404 in a log — a perfectly successful request for the wrong thing. An
 * assertion about the src STRING would not have caught it either, because the
 * string was exactly what the server sent. The only question that finds this
 * is whether the browser ended up with pixels.
 *
 * So: naturalWidth. It is zero for a broken image, for an image that never
 * loaded, and for HTML served as an image — and it cannot be faked by a
 * correct-looking URL.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'correct horse'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

/* A REAL PHOTOGRAPH, at the size shrink-image actually produces. A 2x2 pixel
   fixture would be narrower than every thumbnail width and so would take the
   "already small enough" path out of store_image_thumb — proving the tile
   loads while proving nothing about resizing. 1400 is LONGEST_EDGE. */
const SOURCE_W = 1400
const SOURCE_H = 1750

const makePhoto = () =>
  execFileSync('php', ['-r', `
    $im = imagecreatetruecolor(${SOURCE_W}, ${SOURCE_H});
    for ($y = 0; $y < ${SOURCE_H}; $y += 10) {
      $c = imagecolorallocate($im, 200 - (int)($y/20), 90, 30 + (int)($y/20));
      imagefilledrectangle($im, 0, $y, ${SOURCE_W}, $y + 9, $c);
    }
    ob_start(); imagejpeg($im, null, 90); $b = ob_get_clean();
    echo 'data:image/jpeg;base64,' . base64_encode($b);
  `], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const slug = sql(`select slug from products where active = 1 order by id limit 1`)
const name = sql(`select name_en from products where slug = '${slug}'`)
const kept = sql(`select count(*) from product_images where slug = '${slug}'`)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const p = await ctx.newPage()

try {
  check(Number(kept) === 0,
    `the garment under test starts with no photographs (${slug})`,
    'this rig would be reordering real seed data — clear it first')

  const uri = makePhoto()
  execFileSync('mariadb', ['-uroot', 'sporta', '-e',
    `insert into product_images (slug, sort, image, image_hash, image_w, image_h)
     values ('${slug}', 0, ?, sha2('preview-rig', 256), ${SOURCE_W}, ${SOURCE_H})`
      .replace('?', `'${uri}'`)])

  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await p.waitForTimeout(3000)

  await p.getByText('Catalogue', { exact: true }).first().click()
  // counts() asks the server for every garment's photographs before the manage
  // rows can render.
  await p.waitForTimeout(9000)

  // Two words is enough to find the row and avoids the em dash some product
  // names carry, which does not survive every encoding on the way here.
  const words = name.split(/\s+/).slice(0, 2).join(' ')
  const toggle = p.locator('.spm-toggle', { hasText: new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  check((await toggle.count()) === 1, `the garment has a manage row (${words})`)
  if ((await toggle.count()) !== 1) throw new Error('cannot reach the grid')

  await toggle.click()
  await p.waitForTimeout(1500)

  const img = p.locator('.spm-thumb-wrap img').first()
  // The card replaces an image that fails to load with a "could not load"
  // box, so a missing <img> is itself a diagnosis rather than a puzzle —
  // name it, or this failure reads as "the grid did not render".
  const broke = await p.locator('.spm-thumb-bad').count()
  check((await img.count()) === 1, 'expanding renders one thumbnail',
    broke > 0
      ? 'the tile reported "could not load" — the url did not resolve to an image'
      : 'no thumbnail element at all')

  const shot = await img.evaluate((e) => ({
    naturalWidth: e.naturalWidth,
    naturalHeight: e.naturalHeight,
    currentSrc: e.currentSrc,
    alt: e.alt,
    box: { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) },
  }))

  console.log(`\n     ${shot.currentSrc}`)
  console.log(`     decoded ${shot.naturalWidth}x${shot.naturalHeight}, drawn ${shot.box.w}x${shot.box.h}\n`)

  // THE ASSERTION THAT WAS MISSING. Zero means a broken image — including the
  // 51 kB of HTML this card used to be served, which arrived with a 200.
  check(shot.naturalWidth > 0,
    `the thumbnail actually decoded (${shot.naturalWidth}x${shot.naturalHeight})`,
    'naturalWidth is 0 — the browser got something that is not an image')

  check(/\/api\//.test(shot.currentSrc),
    'its url resolved under /api/, not against the panel path',
    shot.currentSrc)

  check(shot.naturalWidth === 200,
    'and it is the 200px thumbnail, not the full-size original',
    `got ${shot.naturalWidth}px — the ?w= parameter did not take`)

  // 4:5, matching what the shop's grid crops to. A square here shows the owner
  // a picture the storefront will never display.
  const ratio = shot.box.w / shot.box.h
  check(Math.abs(ratio - 0.8) < 0.02,
    `the tile is the shop's 4:5 crop (${shot.box.w}x${shot.box.h})`,
    `ratio ${ratio.toFixed(2)}, expected 0.80`)

  check(shot.alt.trim().length > 0,
    `it carries an alt (${JSON.stringify(shot.alt)})`,
    'the tile is a control with no label but "↑ ↓ ✕" beside it')

  // THE BYTES, not the element: what the server actually answered with. This
  // is the check that names the original bug in its own terms.
  const served = await p.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' })
    return { status: r.status, type: r.headers.get('content-type') || '', bytes: (await r.blob()).size }
  }, shot.currentSrc)
  console.log(`     served: HTTP ${served.status} ${served.type} ${served.bytes} bytes`)
  check(/^image\//.test(served.type),
    `the response is an image, not the SPA shell (${served.type})`,
    'this is exactly what a relative url under /backends returns — with a 200')
  check(served.bytes < 20000,
    `and it is thumbnail-sized (${served.bytes} bytes)`,
    'the full-size original is being sent to draw an 88px tile')

  console.log(
    fails === 0
      ? '\nall ok — the preview is a picture, at thumbnail size, in the shop’s own crop'
      : `\n${fails} failed`,
  )
} finally {
  sql(`delete from product_images where slug = '${slug}'`)
  await browser.close()
}

process.exit(fails === 0 ? 0 : 1)
