/**
 * The product banner above "Shop by category", and its /backends editor. 2026-10-01.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/home-banner-test.mjs
 *
 * WHAT IT HOLDS, and each one has a mutation that breaks it:
 *   - THE GATE: get and save answer 401 to a stranger.
 *   - IT FAILS CLOSED: no table, no row, switched off, or a product that is not
 *     on sale with no headline — the public route answers {"banner": null} and
 *     the home page draws nothing. The table is moved aside to prove the first.
 *   - THE PRODUCT DECIDES THE PRICE: a sale put on the product shows on the
 *     banner with the old price struck, with nothing re-saved.
 *   - THE SERVER REFUSES BY NAME: an unknown product, a link that leaves the shop
 *     (//host, https:, javascript:, a backslash), an over-long line, a non-image,
 *     a picture whose bytes are not its type, a picture too small, and "switched
 *     on with nothing to show" — and a refused save changes NOTHING.
 *   - THE PICTURE: served with an ETag that 304s (also W/-weakened), cached for a
 *     year only while the banner is on; while it is off a stranger gets a 404
 *     WITHOUT a cookie and a signed-in admin gets it `private, no-store`.
 *   - THE STOREFRONT, in a real browser: the banner sits directly above the
 *     category section in English and in Arabic (mirrored), its words are TEXT
 *     (an <img onerror> headline stays words), every colour on the white reads at
 *     AA, the button is a 44px target, the page does not scroll sideways, and
 *     /shop draws no banner.
 *   - THE PANEL, under the shipped Content-Security-Policy: the card is on the
 *     Home slides screen above the category pictures and only there; a picture is
 *     chosen, previewed (as data:, never blob:) and saved; the words typed in the
 *     form reach the public route; a field the owner did not touch SURVIVES a save
 *     (the whole row is resent); the product's photograph can be put back; and
 *     switching it off takes it off the home page.
 *
 * The row is put back exactly as it was in a `finally`, blobs included.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const PUBLIC = BASE + '/api/api.php'
const SLUG = 'cheetahs-rugby-t-shirt'      // NAMED: a product with photographs in the sandbox seed

let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const one = (q) => sql(q).trim().split('\n').slice(1)[0]

let cookie = ''
const admin = (route, body) => fetch(`${ADMIN}?r=${route}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))
const pub = async () => {
  const r = await fetch(`${PUBLIC}?r=home_banner&x=${Math.random()}`)
  return { status: r.status, setCookie: r.headers.get('set-cookie'), j: await r.json().catch(() => null) }
}
const picture = async (url, headers = {}) => {
  const r = await fetch(url.startsWith('http') ? url : `${BASE}/api/${url}`, { headers })
  return { status: r.status, type: r.headers.get('content-type'), cc: r.headers.get('cache-control'), etag: r.headers.get('etag'), setCookie: r.headers.get('set-cookie'), bytes: Buffer.from(await r.arrayBuffer()) }
}

const FULL = (over = {}) => ({
  enabled: true, product: SLUG, href: '',
  kicker: { en: '', ar: '' }, title: { en: '', ar: '' }, button: { en: '', ar: '' },
  remove_image: false, ...over,
})

// The panel runs under the SHIPPED policy, read out of .htaccess (category-art-test's reason).
const htaccess = readFileSync(new URL('../sporta-site/public_html/.htaccess', import.meta.url).pathname, 'utf8')
const panelLine = htaccess.split('\n').find((l) => /Header set Content-Security-Policy "/.test(l) && /env=SPORTA_PANEL\s*$/.test(l))
const PANEL_CSP = panelLine ? panelLine.match(/Content-Security-Policy "([^"]+)"/)[1].replace(/;?\s*upgrade-insecure-requests/, '') : null

// Snapshot the row, blobs and all, so the sandbox ends as it began.
sql('drop table if exists home_banner_rig_backup')
sql('create table home_banner_rig_backup as select * from home_banner')
const sale0 = sql(`select concat_ws('|', ifnull(sale_price,'NULL'), ifnull(sale_starts_at,'NULL'), ifnull(sale_ends_at,'NULL')) from products where slug='${SLUG}'`).trim().split('\n')[1]
sql('delete from home_banner')
try { sql('delete from rate_limit; delete from rate_bucket') } catch {}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const errors = []

// Contrast, WCAG 2.x, of an rgb() against white.
// Reads rgb()/rgba() (0-255) and color(srgb …) (0-1), which is what a color-mix() computes to.
const lum = (css) => {
  const nums = String(css).match(/-?\d*\.?\d+/g).map(Number)
  const unit = /^color\(srgb/.test(css) ? 1 : 255
  const [r, g, b] = nums.slice(0, 3).map((v) => { v /= unit; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

async function storefront(lang, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('store: ' + String(e)))
  await page.goto(`${BASE}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const m = await page.evaluate(() => {
    const s = document.querySelector('[data-sporta-home-banner]')
    if (!s) return null
    const a = s.querySelector('a')
    const r = (q) => { const e = s.querySelector(q); return e ? getComputedStyle(e) : null }
    const media = s.querySelector('.sporta-home-banner__media').getBoundingClientRect()
    const body = s.querySelector('.sporta-home-banner__body').getBoundingClientRect()
    const cta = s.querySelector('.sporta-home-banner__cta').getBoundingClientRect()
    return {
      lang: s.getAttribute('data-sporta-home-banner'),
      nextHasTiles: !!(s.nextElementSibling && s.nextElementSibling.querySelector('.cat-tile')),
      href: a.getAttribute('href'),
      title: s.querySelector('.sporta-home-banner__title').textContent,
      titleHasElement: !!s.querySelector('.sporta-home-banner__title *'),
      kicker: s.querySelector('.sporta-home-banner__kicker')?.textContent ?? null,
      price: s.querySelector('.sporta-home-banner__price b')?.textContent ?? null,
      struck: s.querySelector('.sporta-home-banner__price s')?.textContent ?? null,
      button: s.querySelector('.sporta-home-banner__cta').textContent,
      img: s.querySelector('img').getAttribute('src'),
      imgOk: s.querySelector('img').naturalWidth > 0,
      mediaLeft: media.left < body.left,
      ctaH: cta.height,
      colours: {
        title: r('.sporta-home-banner__title')?.color, kicker: r('.sporta-home-banner__kicker')?.color,
        price: r('.sporta-home-banner__price b')?.color, struck: r('.sporta-home-banner__price s')?.color,
        bg: getComputedStyle(a).backgroundColor, cta: r('.sporta-home-banner__cta')?.color, ctaBg: r('.sporta-home-banner__cta')?.backgroundColor,
      },
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
      ran: !!window.__hbx,
    }
  })
  await ctx.close()
  return m
}

const dir = mkdtempSync(join(tmpdir(), 'hbe-'))
try {
  check(!!PANEL_CSP && /img-src 'self' data:/.test(PANEL_CSP) && !/blob:/.test(PANEL_CSP), "the panel's shipped policy was found (data: images, no blob:)")

  /* ----------------------------------------------------------- the gate -- */
  for (const [route, body] of [['home_banner_get'], ['home_banner_save', {}]]) {
    const r = await fetch(`${ADMIN}?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: body ? '{}' : undefined })
    check(r.status === 401, `${route} answers 401 to a stranger`, `got ${r.status}`)
  }

  /* ----------------------------------------------------- fails closed ---- */
  let p = await pub()
  check(p.status === 200 && p.j && p.j.banner === null, 'no row: the public route answers {"banner": null}', JSON.stringify(p.j))
  check(!p.setCookie, 'and sets no cookie (the storefront sets none)', p.setCookie || '')
  sql('rename table home_banner to home_banner_rig_aside')
  try {
    p = await pub()
    check(p.status === 200 && p.j?.banner === null, 'NO TABLE: still {"banner": null}, not an error', `${p.status} ${JSON.stringify(p.j)}`)
  } finally { sql('rename table home_banner_rig_aside to home_banner') }

  /* --------------------------------------------------------- sign in ------ */
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await pctx.newPage()
  page.on('pageerror', (e) => errors.push('panel: ' + String(e)))
  if (PANEL_CSP) {
    await page.route('**/backends**', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const resp = await route.fetch()
      await route.fulfill({ response: resp, headers: { ...resp.headers(), 'content-security-policy': PANEL_CSP } })
    })
  }
  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  cookie = (await pctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')

  sql('rename table home_banner to home_banner_rig_aside')
  try {
    const g = await admin('home_banner_get')
    check(g.status === 200 && g.j?.ready === false, 'no table: the panel is told the shop is not ready', JSON.stringify(g.j))
    const s = await admin('home_banner_save', FULL())
    check(s.status === 503 && s.j?.error === 'home_banner_not_ready', 'and a save is refused as not ready', `${s.status} ${s.j?.error}`)
  } finally { sql('rename table home_banner_rig_aside to home_banner') }

  /* ------------------------------------------ the product decides ------ */
  let s = await admin('home_banner_save', FULL({ enabled: false }))
  check(s.status === 200 && s.j?.banner === null, 'saved switched OFF: the save answers banner null', JSON.stringify(s.j))
  p = await pub()
  check(p.j?.banner === null, 'off: the public route answers null')
  s = await admin('home_banner_save', FULL())
  p = await pub()
  const name = JSON.parse(execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-N', '-e',
    `select json_object('en', name_en, 'ar', name_ar, 'price', price) from products where slug='${SLUG}'`], { encoding: 'utf8' }).trim())
  check(p.j?.banner?.title?.en === name.en && p.j.banner.title.ar === name.ar, 'on, no headline: the headline is the product’s name in each language', JSON.stringify(p.j?.banner?.title))
  check(p.j.banner.href === `/product/${SLUG}`, 'no link: the button goes to the product’s page', p.j.banner.href)
  check(Math.abs(p.j.banner.price - Number(name.price)) < 1e-9 && p.j.banner.on_sale === false && p.j.banner.list_price === null, 'the price is the product’s', JSON.stringify([p.j.banner.price, p.j.banner.list_price]))
  check(/^api\.php\?r=product_image&id=\d+/.test(p.j.banner.image || ''), 'the picture is the product’s photograph', p.j.banner.image)
  check(p.j.banner.button.en === 'Shop now' && p.j.banner.button.ar === 'تسوّق الآن', 'an empty button label is "Shop now" / "تسوّق الآن"')

  sql(`update products set sale_price = 5.500, sale_starts_at = null, sale_ends_at = null where slug='${SLUG}'`)
  p = await pub()
  check(p.j?.banner?.price === 5.5 && p.j.banner.on_sale === true && Math.abs(p.j.banner.list_price - Number(name.price)) < 1e-9, 'A SALE PUT ON THE PRODUCT shows on the banner with nothing re-saved', JSON.stringify([p.j?.banner?.price, p.j?.banner?.list_price]))
  sql(`update products set sale_price = null where slug='${SLUG}'`)

  // A product that is no longer on sale, and no headline: nothing to say.
  sql(`update home_banner set product = 'no-such-product-rig' where id = 1`)
  p = await pub()
  check(p.j?.banner === null, 'a product that is gone, with no headline: nothing is drawn', JSON.stringify(p.j))
  sql(`update home_banner set title_en = 'Rig headline' where id = 1`)
  p = await pub()
  check(p.j?.banner?.title?.ar === 'Rig headline' && p.j.banner.price === null && p.j.banner.href === '/shop', 'with a headline: drawn without a price, Arabic borrowing the English, linking to /shop', JSON.stringify(p.j?.banner))

  /* --------------------------------------------- the server refuses ---- */
  s = await admin('home_banner_save', FULL({ kicker: { en: 'KEEP ME', ar: 'ابقَ' }, title: { en: 'Before', ar: 'قبل' } }))
  const before = one('select concat_ws("|", enabled, product, kicker_en, title_en, href, ifnull(etag, "-"), updated_at) from home_banner where id = 1')
  const png = (w, h) => {
    // a real PNG from PHP's own GD, so the server's measuring is tested against a picture it did not make up
    return execFileSync('php', ['-r', `$i = imagecreatetruecolor(${w}, ${h}); imagefill($i, 0, 0, imagecolorallocate($i, 200, 60, 20)); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());`], { encoding: 'utf8' })
  }
  const okPng = 'data:image/png;base64,' + png(400, 300)
  const refuse = async (what, body, token) => {
    const r = await admin('home_banner_save', body)
    check(r.status >= 400 && r.j?.error === token, `refused: ${what}`, `${r.status} ${r.j?.error}`)
  }
  await refuse('a product that does not exist', FULL({ product: 'no-such-product-rig' }), 'banner_unknown_product')
  for (const href of ['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '/\\evil.example', '/shop now', 'shop']) {
    await refuse(`the link ${JSON.stringify(href)}`, FULL({ href }), 'banner_bad_link')
  }
  await refuse('a headline over 90 characters', FULL({ title: { en: 'x'.repeat(91), ar: '' } }), 'banner_text_too_long')
  await refuse('a picture that is not a data: URI', FULL({ image: 'https://evil.example/a.png' }), 'banner_bad_format')
  await refuse('PNG bytes labelled as a jpeg', FULL({ image: okPng.replace('image/png', 'image/jpeg') }), 'banner_not_an_image')
  await refuse('a picture under 200px', FULL({ image: 'data:image/png;base64,' + png(150, 300) }), 'banner_wrong_size')
  await refuse('switched on with no product, no headline and no picture', FULL({ product: '' }), 'banner_needs_content')
  const after = one('select concat_ws("|", enabled, product, kicker_en, title_en, href, ifnull(etag, "-"), updated_at) from home_banner where id = 1')
  check(before === after, 'and none of those refusals changed the row', `${before} -> ${after}`)
  s = await admin('home_banner_save', FULL({ href: '/women?sort=new#top', kicker: { en: 'KEEP ME', ar: 'ابقَ' } }))
  check(s.status === 200 && s.j?.banner?.href === '/women?sort=new#top', 'a link to a page in the shop is accepted', `${s.status} ${s.j?.banner?.href}`)

  /* ------------------------------------------------------ the picture --- */
  s = await admin('home_banner_save', FULL({ image: okPng }))
  p = await pub()
  const imgUrl = p.j?.banner?.image || ''
  check(/^api\.php\?r=home_banner_image&v=[0-9a-f]{12}$/.test(imgUrl), 'an uploaded picture wins over the product’s photograph', imgUrl)
  let pic = await picture(imgUrl)
  check(pic.status === 200 && pic.type === 'image/png' && pic.bytes.equals(Buffer.from(okPng.split(',')[1], 'base64')), 'it is served byte for byte, as what it is', `${pic.status} ${pic.type} ${pic.bytes.length}b`)
  check(/max-age=31536000/.test(pic.cc || '') && /immutable/.test(pic.cc || '') && !pic.setCookie, 'cached for a year while the banner is on, and no cookie', pic.cc)
  check((await picture(imgUrl, { 'If-None-Match': pic.etag })).status === 304, 'its ETag answers 304')
  check((await picture(imgUrl, { 'If-None-Match': 'W/' + pic.etag })).status === 304, 'and so does a CDN-weakened one (W/…)')
  s = await admin('home_banner_save', FULL({ enabled: false }))
  pic = await picture(imgUrl)
  check(pic.status === 404 && !pic.setCookie, 'OFF: a stranger is answered 404, and no session is started to say so', `${pic.status} cookie=${pic.setCookie || '-'}`)
  pic = await picture(imgUrl, { Cookie: cookie })
  check(pic.status === 200 && /private/.test(pic.cc || '') && /no-store/.test(pic.cc || ''), 'a signed-in admin still gets it, private and no-store (the panel previews it)', `${pic.status} ${pic.cc}`)
  s = await admin('home_banner_save', FULL({ remove_image: true }))
  p = await pub()
  check(/^api\.php\?r=product_image/.test(p.j?.banner?.image || '') && (await picture(imgUrl, { Cookie: cookie })).status === 404, 'removing the picture puts the product’s photograph back, and the old picture is gone', p.j?.banner?.image)

  /* ---------------------------------------------------- the storefront -- */
  s = await admin('home_banner_save', FULL({
    kicker: { en: 'NEW SEASON', ar: 'موسم جديد' },
    title: { en: '<img src=x onerror="window.__hbx=1">Train hard', ar: 'تمرّن بقوة' },
    button: { en: 'Shop the tee', ar: 'تسوّق' },
  }))
  for (const lang of ['en', 'ar']) {
    const m = await storefront(lang)
    check(!!m && m.lang === lang, `${lang}: the banner is drawn`, JSON.stringify(m)?.slice(0, 80))
    if (!m) continue
    check(m.nextHasTiles, `${lang}: directly above the "Shop by category" section`)
    check(m.href === `/product/${SLUG}`, `${lang}: it links to the product`, m.href)
    check(lang === 'en' ? m.title === '<img src=x onerror="window.__hbx=1">Train hard' && !m.titleHasElement && !m.ran : m.title === 'تمرّن بقوة', `${lang}: the owner’s words are TEXT, never markup (the <img onerror> headline never ran)`, m.title)
    check(m.kicker === (lang === 'en' ? 'NEW SEASON' : 'موسم جديد') && m.button === (lang === 'en' ? 'Shop the tee' : 'تسوّق'), `${lang}: kicker and button in the visitor’s language`)
    check(/8[.,٫]000/.test(m.price || '') && m.struck === null, `${lang}: the price is the product’s, no struck price when not on sale`, String(m.price))
    check(m.imgOk, `${lang}: the photograph loads`, m.img)
    check(lang === 'en' ? m.mediaLeft : !m.mediaLeft, `${lang}: the photograph is on the reading-start side (mirrored in Arabic)`)
    const c = m.colours
    const worst = Math.min(ratio(c.title, c.bg), ratio(c.kicker, c.bg), ratio(c.price, c.bg), ratio(c.cta, c.ctaBg))
    check(worst >= 4.5, `${lang}: every colour on the banner reads at AA (worst ${worst.toFixed(2)}:1)`, JSON.stringify(c))
    check(m.ctaH >= 44, `${lang}: the button is a 44px target`, String(m.ctaH))
    check(!m.sideways, `${lang}: the page does not scroll sideways at 390px`)
  }
  const desk = await storefront('en', 1280)
  check(!!desk && desk.nextHasTiles && desk.mediaLeft, 'desktop: drawn above the categories too')
  {
    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    await pg.goto(`${BASE}/shop?lang=en`, { waitUntil: 'networkidle' })
    await pg.waitForTimeout(500)
    check((await pg.locator('[data-sporta-home-banner]').count()) === 0, '/shop draws no banner')
    await ctx.close()
  }
  sql(`update products set sale_price = 5.500 where slug='${SLUG}'`)
  {
    const m = await storefront('en')
    check(!!m && /5[.,]500/.test(m.price || '') && /8[.,]000/.test(m.struck || ''), 'on sale: the sale price, and the old price struck', `${m?.price} / ${m?.struck}`)
    check(!!m && ratio(m.colours.struck, m.colours.bg) >= 4.5, 'the struck price reads at AA too', m?.colours.struck)
  }
  sql(`update products set sale_price = null where slug='${SLUG}'`)
  s = await admin('home_banner_save', FULL({ enabled: false }))
  check((await storefront('en')) === null, 'switched off: the home page draws nothing')

  /* --------------------------------------------------------- the panel ---- */
  // A field the owner never touches must survive the panel's save.
  s = await admin('home_banner_save', FULL({ enabled: false, kicker: { en: 'UNTOUCHED', ar: 'لم يُلمس' }, button: { en: 'Go', ar: 'اذهب' } }))
  await page.locator(':text-is("Slides"):visible').first().click()
  await page.waitForSelector('[data-sporta-home-banner-editor] select', { timeout: 10000 })
  check((await page.locator('[data-sporta-home-banner-editor]').count()) === 1, 'the card is on the Home slides screen')
  await page.waitForSelector('[data-sporta-category-art]', { timeout: 10000 })
  await page.waitForTimeout(400)
  check(await page.evaluate(() => document.querySelector('[data-sporta-home-banner-editor]').nextElementSibling?.hasAttribute('data-sporta-category-art')), 'directly above the category pictures — the home page’s own order')
  const card = page.locator('[data-sporta-home-banner-editor]')
  check(await card.locator('[data-hbe="product"]').inputValue() === SLUG, 'it loads the saved product')
  check(await card.locator('[data-hbe="kicker-en"]').inputValue() === 'UNTOUCHED', 'and the saved words')

  // A picture red on its left half, blue on its right.
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600
    const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 450, 600); g.fillStyle = '#0000ff'; g.fillRect(450, 0, 450, 600)
    return c.toDataURL('image/png').split(',')[1]
  })
  const pngPath = join(dir, 'split.png')
  writeFileSync(pngPath, Buffer.from(b64, 'base64'))
  await card.locator('input[type=file]').setInputFiles(pngPath)
  await page.waitForFunction(() => /Your new picture/.test(document.querySelector('[data-sporta-home-banner-editor]')?.textContent || ''), null, { timeout: 8000 })
  const prevSrc = await card.locator('[data-hbe-preview] img').evaluateAll((is) => is.map((i) => i.getAttribute('src').slice(0, 15)))
  check(prevSrc.length === 2 && prevSrc.every((x) => x.startsWith('data:image/')), 'the preview draws the chosen picture in English and Arabic, as data: (never blob:)', prevSrc.join())
  check((await card.locator('[data-hbe-preview] a[href]').count()) === 2 && (await card.locator('[data-hbe-preview] [inert]').count()) === 2, 'the preview is a picture of the banner, not a link out of the panel')
  await card.locator('[data-hbe="title-en"]').fill('Panel headline')
  await card.locator('[data-hbe="title-ar"]').fill('عنوان اللوحة')
  await page.waitForTimeout(250)
  check((await card.locator('[data-hbe-preview] .sporta-home-banner__title').first().textContent()) === 'Panel headline', 'the preview follows the typing')
  await card.locator('[data-hbe="enabled"]').check()
  const saveReq = page.waitForResponse((r) => r.url().includes('r=home_banner_save'), { timeout: 30000 })
  await card.getByRole('button', { name: 'Save banner' }).click()
  check((await saveReq).status() === 200, 'Save banner is accepted')
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-home-banner-editor]')?.textContent || ''), null, { timeout: 8000 })
  p = await pub()
  check(p.j?.banner?.title?.en === 'Panel headline' && p.j.banner.title.ar === 'عنوان اللوحة', 'the words typed in the panel are on the public route', JSON.stringify(p.j?.banner?.title))
  check(p.j?.banner?.kicker?.en === 'UNTOUCHED' && p.j.banner.button.ar === 'اذهب', 'and the fields the owner did not touch SURVIVED the save', JSON.stringify([p.j?.banner?.kicker, p.j?.banner?.button]))
  pic = await picture(p.j?.banner?.image || 'x')
  const px = await page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const at = (x) => Array.from(g.getImageData(x, Math.floor(img.height / 2), 1, 1).data.slice(0, 3))
    return { w: img.width, h: img.height, left: at(10), right: at(img.width - 10) }
  }, `${BASE}/api/${p.j?.banner?.image}`)
  check(pic.status === 200 && px.w === 900 && px.h === 600 && px.left[0] > 200 && px.right[2] > 200, 'the uploaded picture is served whole: 900x600, red left, blue right', JSON.stringify(px))

  await card.getByRole('button', { name: 'Use the product’s photograph' }).click()
  const save2 = page.waitForResponse((r) => r.url().includes('r=home_banner_save'), { timeout: 30000 })
  await card.getByRole('button', { name: 'Save banner' }).click()
  await save2
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sporta-home-banner-editor]')?.textContent || ''), null, { timeout: 8000 })
  p = await pub()
  check(/^api\.php\?r=product_image/.test(p.j?.banner?.image || ''), '"Use the product’s photograph" puts it back', p.j?.banner?.image)

  await card.locator('[data-hbe="enabled"]').uncheck()
  const save3 = page.waitForResponse((r) => r.url().includes('r=home_banner_save'), { timeout: 30000 })
  await card.getByRole('button', { name: 'Save banner' }).click()
  await save3
  await page.waitForTimeout(300)
  check((await pub()).j?.banner === null, 'unticking "Show the banner" and saving takes it off the home page')

  await page.locator(':text-is("Orders"):visible').first().click()
  await page.waitForSelector('.admin-content h1:has-text("Orders")', { timeout: 8000 })
  await page.waitForTimeout(600)
  check((await page.locator('[data-sporta-home-banner-editor]').count()) === 0, 'the card removes itself on another screen')
  check(errors.length === 0, 'no script errors on the shop or in the panel', errors.join(' | ').slice(0, 300))
  await pctx.close()
} finally {
  try {
    sql('delete from home_banner')
    sql('insert into home_banner select * from home_banner_rig_backup')
    sql('drop table home_banner_rig_backup')
  } catch (e) { console.log('RESTORE FAILED: ' + e.message); fails++ }
  const [sp, ss, se] = (sale0 || 'NULL|NULL|NULL').split('|')
  const v = (x) => (x === 'NULL' ? 'null' : `'${x}'`)
  sql(`update products set sale_price = ${v(sp)}, sale_starts_at = ${v(ss)}, sale_ends_at = ${v(se)} where slug='${SLUG}'`)
  await browser.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — the product banner is drawn from the owner’s row, refuses what it must, and is edited from the panel')
process.exit(fails ? 1 : 0)
