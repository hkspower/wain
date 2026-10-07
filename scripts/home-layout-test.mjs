/**
 * The home page's shape and the site's own pictures, edited from /backends (2026-10-04, "make all
 * website full dynamic to edit at backend").
 *
 *   node scripts/home-layout-test.mjs        (npm run test:home-layout)
 *
 *   A. home_layout — gated; menu links validated by name (a //host target, a blank label, an unknown
 *      section, an unknown icon are refused by position); a section left out of the list is appended
 *      switched ON; empty lists mean "the built-in" and the public ?r=slides carries the row.
 *   B. The storefront — the menu bar draws the owner's links (English hrefs carry ?lang=en), the
 *      features section draws the owner's title/rows/icons and drops the band picture when told to,
 *      and the home sections PAINT in the owner's order with a switched-off one not shown. Reset puts
 *      the built-in menu, rows and order back.
 *   C. site_images — gated; a saved logo is what /logo.png and /logo.webp SERVE (bytes compared, not
 *      a status), the features band the same at /assets/features.webp; a jpeg, a wrong name and a
 *      non-image are refused; reset serves the shipped file again.
 *   D. The panel — both cards mount on Home slides; a link added and saved through the editor reaches
 *      the public row; a picture chosen in the Pictures card is served; "Use the shipped picture" works.
 *
 * MUTATE=1 (should FAIL): the href validator skipped in store_home_layout_validate — caught by A.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
const ROOT = new URL('../', import.meta.url).pathname
const STORE_PHP = ROOT + 'sporta-site/public_html/api/store.php'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const md5 = (b) => createHash('md5').update(b).digest('hex')
const keepLayout = sql("select quote(value) from settings where name = 'home_layout'") || null
sql('delete from rate_limit; delete from rate_bucket'); sql('delete from site_images')
const original = readFileSync(STORE_PHP, 'utf8')
if (process.env.MUTATE) writeFileSync(STORE_PHP, original.replace("        $h = store_internal_href($href);\n        if ($h === null) store_fail('menu_target_' . ($i + 1));", "        $h = $href;"))

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const admin = async (route, body) => {
  const r = body
    ? await ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
    : await ctx.request.get(`${BASE}/api/admin.php?r=${route}`, { headers: { 'X-Sporta-Admin': '1' }, failOnStatusCode: false })
  return { status: r.status(), j: await r.json().catch(() => null) }
}
const save = (value) => admin('settings_save', { name: 'home_layout', value })
const pub = async () => (await (await fetch(`${BASE}/api/api.php?r=slides`, { cache: 'no-store' })).json()).layout
const bytesOf = async (path) => { const r = await fetch(BASE + path, { cache: 'no-store' }); return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()), etag: r.headers.get('etag') } }
const LAYOUT = {
  menu: [{ label_en: 'New in', label_ar: 'الجديد', href: '/shop' }, { label_en: 'Women', label_ar: 'نسائي', href: '/women' }, { label_en: 'Contact', label_ar: 'تواصل', href: '/contact' }],
  sections: [{ key: 'features', on: true }, { key: 'categories', on: false }, { key: 'hero', on: true }],
  features: { title_en: 'Why Sporta', title_ar: 'لماذا سبورتا', picture: false, rows: [{ icon: 'shield', text_en: 'Original brands only', text_ar: 'ماركات أصلية فقط' }, { icon: 'truck', text_en: 'Same-day delivery in Kuwait', text_ar: 'توصيل في نفس اليوم' }, { icon: 'gift', text_en: 'Gift wrapping', text_ar: 'تغليف هدايا' }] },
}

try {
  /* ---------------------------------------------------------------- A */
  const anon = await fetch(`${BASE}/api/admin.php?r=settings_save`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: JSON.stringify({ name: 'home_layout', value: LAYOUT }) })
  check(anon.status === 401, 'A1 a visitor cannot save the layout', String(anon.status))
  check((await admin('login', { email: EMAIL, password: PASSWORD })).status === 200, 'A0 signed in')
  let r = await save(LAYOUT)
  check(r.status === 200 && r.j?.menu?.length === 3 && r.j.features.rows.length === 3, 'A2 a full layout saves', JSON.stringify(r.j).slice(0, 120))
  check(r.j?.sections?.map((s) => s.key).join() === 'features,categories,hero,banner,bestsellers' && r.j.sections[1].on === false && r.j.sections[3].on === true, 'A3 sections left out are appended switched ON, the given order and switches kept', JSON.stringify(r.j?.sections))
  const p0 = await pub()
  check(p0 && p0.menu?.length === 3 && p0.features?.title_en === 'Why Sporta', 'A4 ?r=slides carries the row for the storefront')
  const refuse = async (value, err, why) => { const x = await save(value); check(x.status === 400 && String(x.j?.error) === err, `refused: ${why}`, `${x.status} ${x.j?.error}`) }
  // store_internal_href refuses these itself, by its own name, before the position is reached.
  await refuse({ menu: [{ label_en: 'Evil', href: '//evil.com' }] }, 'invalid_link', 'a protocol-relative menu target')
  await refuse({ menu: [{ label_en: 'Out', href: 'https://x.test/' }] }, 'invalid_link', 'an off-site menu target')
  await refuse({ menu: [{ label_en: 'Blank', href: '' }] }, 'menu_target_1', 'a menu link with no target (named by position)')
  await refuse({ menu: [{ label_en: 'Ok', href: '/shop' }, { label_en: '', label_ar: '', href: '/men' }] }, 'menu_label_2', 'a menu link with no label (named by position)')
  await refuse({ sections: [{ key: 'footer' }] }, 'unknown_section', 'an unknown section')
  await refuse({ features: { rows: [{ icon: 'rocket', text_en: 'x' }] } }, 'feature_icon_1', 'an unknown feature icon')
  const after = await pub()
  check(after.menu.length === 3 && after.features.rows.length === 3, 'A5 a refused save changes nothing', JSON.stringify(after).slice(0, 80))
  r = await save({ menu: [{ label_en: '', label_ar: '', href: '' }], sections: [], features: { rows: [{ icon: 'star', text_en: '', text_ar: '' }] } })
  check(r.status === 200 && r.j.menu.length === 0 && r.j.sections.length === 0 && r.j.features.length === 0, 'A6 blank rows are dropped, and all-empty means the built-in', JSON.stringify(r.j))

  /* ---------------------------------------------------------------- B */
  await save(LAYOUT)
  const shop = async (lang, fn) => {
    const c = await browser.newContext({ ...devices['Pixel 7'], locale: lang })
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
    await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800)
    const out = await fn(p); out.errs = errs; await c.close(); return out
  }
  for (const lang of ['en', 'ar']) {
    const s = await shop(lang, (p) => p.evaluate(() => {
      const nav = document.querySelector('[data-sporta-menubar]')
      const links = nav ? [...nav.querySelectorAll('a')].map((a) => [a.textContent.trim(), a.getAttribute('href')]) : []
      const ts = document.querySelector('[data-sporta-trust-strip]')
      const order = ['hero', 'features', 'categories', 'banner', 'bestsellers'].map((k) => { const el = document.querySelector(`[data-home-section="${k}"]`); return el ? [k, getComputedStyle(el).display, Math.round(el.getBoundingClientRect().top + scrollY)] : null }).filter(Boolean)
      return {
        menu: nav && nav.dataset.menu, links,
        title: ts && ts.querySelector('h2').textContent.trim(),
        rows: ts ? [...ts.querySelectorAll('.sts-text')].map((x) => x.textContent.trim()) : [],
        icons: ts ? ts.querySelectorAll('.sts-icon svg').length : 0,
        bg: ts ? getComputedStyle(ts.querySelector('.sts-panel')).backgroundImage : null,
        order, flex: getComputedStyle(document.querySelector('main')).flexDirection,
      }
    }))
    const want = LAYOUT.menu.map((m) => [lang === 'en' ? m.label_en : m.label_ar, m.href + (lang === 'en' ? '?lang=en' : '')])
    check(s.menu === 'own' && JSON.stringify(s.links) === JSON.stringify(want), `B1 ${lang}: the menu bar draws the owner's three links`, JSON.stringify(s.links))
    check(s.title === (lang === 'en' ? 'Why Sporta' : 'لماذا سبورتا') && JSON.stringify(s.rows) === JSON.stringify(LAYOUT.features.rows.map((x) => x['text_' + lang])) && s.icons === 3, `B2 ${lang}: the features section draws the owner's title, rows and icons`, `${s.title} ${JSON.stringify(s.rows)} icons=${s.icons}`)
    check(s.bg === 'none', `B3 ${lang}: the band picture is dropped when switched off`, s.bg)
    const byKey = Object.fromEntries(s.order.map((o) => [o[0], o]))
    check(s.flex === 'column' && byKey.features && byKey.hero && byKey.features[2] < byKey.hero[2], `B4 ${lang}: the features section PAINTS above the hero (the owner's order)`, JSON.stringify(s.order))
    check(byKey.categories && byKey.categories[1] === 'none', `B5 ${lang}: the switched-off categories section is not shown`, JSON.stringify(byKey.categories))
    check(s.errs.length === 0, `B6 ${lang}: no script errors`, s.errs.join(' | ').slice(0, 100))
  }
  await save({ menu: [], sections: [], features: {} })
  const b = await shop('en', (p) => p.evaluate(() => ({
    menu: document.querySelector('[data-sporta-menubar]')?.dataset.menu, n: document.querySelectorAll('[data-sporta-menubar] a').length,
    rows: document.querySelectorAll('[data-sporta-trust-strip] .sts-text').length, bg: getComputedStyle(document.querySelector('[data-sporta-trust-strip] .sts-panel')).backgroundImage,
    flex: getComputedStyle(document.querySelector('main')).flexDirection, marked: document.querySelectorAll('[data-home-section]').length,
    catsShown: getComputedStyle(document.querySelector('main .cat-tile').closest('section')).display,
  })))
  check(b.menu === 'builtin' && b.n === 5 && b.rows === 2 && /features\.webp/.test(b.bg) && b.flex !== 'column' && b.marked === 0 && b.catsShown !== 'none', 'B7 reset: the built-in menu, rows, picture and order are back', JSON.stringify(b))

  /* ---------------------------------------------------------------- C */
  const anonImg = await fetch(`${BASE}/api/admin.php?r=site_images`, { headers: { 'X-Sporta-Admin': '1' } })
  check(anonImg.status === 401, 'C1 a visitor cannot read the pictures state', String(anonImg.status))
  const shippedPng = await bytesOf('/logo.png'), shippedBand = await bytesOf('/assets/features.webp')
  check(shippedPng.status === 200 && shippedPng.type === 'image/png' && shippedPng.etag === `"${md5(shippedPng.body)}"` && /no-cache/.test((await fetch(BASE + '/logo.png')).headers.get('cache-control') || ''), 'C2 with no row /logo.png is the shipped file, no-cache with its own ETag')
  const pg = await ctx.newPage()
  const mk = (w, h, color, fmts) => pg.evaluate(([w, h, color, fmts]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(4, 4, 8, 8); const o = {}; for (const f of fmts) o[f] = c.toDataURL(f === 'png' ? 'image/png' : 'image/webp', 0.9); return o }, [w, h, color, fmts])
  await pg.goto(`${BASE}/backends`, { waitUntil: 'domcontentloaded' })
  const logoImgs = await mk(240, 80, '#1e3a8a', ['png', 'webp'])
  r = await admin('site_image_save', { name: 'logo', images: logoImgs })
  check(r.status === 200 && r.j?.replaced === true, 'C3 a logo saves (png + webp)', JSON.stringify(r.j))
  const wantPng = Buffer.from(logoImgs.png.split(',')[1], 'base64'), wantWebp = Buffer.from(logoImgs.webp.split(',')[1], 'base64')
  const gotPng = await bytesOf('/logo.png'), gotWebp = await bytesOf('/logo.webp')
  check(gotPng.body.equals(wantPng) && gotPng.type === 'image/png' && gotWebp.body.equals(wantWebp) && gotWebp.type === 'image/webp', 'C4 /logo.png and /logo.webp SERVE the saved bytes', `${gotPng.body.length} ${gotWebp.body.length}`)
  const inm = await fetch(BASE + '/logo.png', { headers: { 'If-None-Match': gotPng.etag } })
  check(inm.status === 304, 'C5 the saved logo answers 304 to its own ETag', String(inm.status))
  const band = await mk(1600, 600, '#e0561c', ['webp'])
  r = await admin('site_image_save', { name: 'features', images: band })
  const gotBand = await bytesOf('/assets/features.webp')
  check(r.status === 200 && gotBand.body.equals(Buffer.from(band.webp.split(',')[1], 'base64')), 'C6 the features band is served from its row', String(r.status))
  const bad = async (body, err, why) => { const x = await admin('site_image_save', body); check(x.status === 400 && x.j?.error === err, `refused: ${why}`, `${x.status} ${x.j?.error}`) }
  await bad({ name: 'favicon', images: logoImgs }, 'site_image_bad_name', 'an unknown picture name')
  await bad({ name: 'logo', images: { png: 'data:image/jpeg;base64,/9j/4AAQ', webp: logoImgs.webp } }, 'site_image_bad_format', 'a jpeg where a png is expected')
  await bad({ name: 'logo', images: { png: 'data:image/png;base64,' + Buffer.from('<?php echo 1; ?>'.repeat(8)).toString('base64'), webp: logoImgs.webp } }, 'site_image_not_an_image', 'bytes that are not a PNG')
  await bad({ name: 'logo', images: { png: logoImgs.png } }, 'site_image_bad_format', 'a logo without its webp half')
  const st = await admin('site_images')
  check(st.j?.ready === true && Object.keys(st.j.images.logo.replaced).sort().join() === 'png,webp' && Object.keys(st.j.images['logo-white'].replaced).length === 0, 'C7 the state names which pictures are replaced', JSON.stringify(st.j?.images?.logo?.replaced))
  r = await admin('site_image_reset', { name: 'logo' })
  const back = await bytesOf('/logo.png')
  check(r.status === 200 && back.body.equals(shippedPng.body), 'C8 reset serves the shipped logo again')
  await admin('site_image_reset', { name: 'features' })
  check((await bytesOf('/assets/features.webp')).body.equals(shippedBand.body), 'C9 reset serves the shipped band again')

  /* ---------------------------------------------------------------- D */
  await pg.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((b) => /^\s*Slides\s*$/.test(b.textContent)).click()); await pg.waitForTimeout(2500)
  const cards = await pg.evaluate(() => ({ layout: !!document.querySelector('[data-sporta-home-layout]'), pics: !!document.querySelector('[data-sporta-site-images]'), sections: document.querySelectorAll('[data-hle-sections] [data-key]').length, h1: document.querySelector('.admin-content h1')?.textContent }))
  check(cards.layout && cards.pics && cards.sections === 5, 'D1 both cards mount on Home slides, with the five sections listed', JSON.stringify(cards))
  await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-home-layout] button')].find((b) => /Replace the built-in menu|Add link/.test(b.textContent)).click()); await pg.waitForTimeout(200)
  await pg.evaluate(() => { const row = document.querySelector('[data-hle-menu] .hle-row'); const ins = row.querySelectorAll('input.hle-in'); ins[0].value = 'Sale'; ins[0].dispatchEvent(new Event('input')); ins[1].value = 'تخفيضات'; ins[1].dispatchEvent(new Event('input')); const sel = row.querySelector('select'); sel.value = '/outlet'; sel.dispatchEvent(new Event('change')) })
  await pg.evaluate(() => document.querySelector('[data-hle-sections] [data-key="bestsellers"] input').click())
  await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-home-layout] button')].find((b) => /^Save menu/.test(b.textContent)).click()); await pg.waitForTimeout(1500)
  const saved = await pub()
  check(saved.menu?.length === 1 && saved.menu[0].href === '/outlet' && saved.menu[0].label_ar === 'تخفيضات' && saved.sections.find((s) => s.key === 'bestsellers')?.on === false, 'D2 a link added and a section switched off through the editor reach the public row', JSON.stringify(saved.menu) + ' ' + JSON.stringify(saved.sections))
  check(/Saved/.test(await pg.evaluate(() => document.querySelector('[data-sporta-home-layout] .hle-note')?.textContent)), 'D3 the editor says it saved')
  const png = Buffer.from(logoImgs.png.split(',')[1], 'base64')
  await pg.locator('[data-simg="logo-white"] input[type=file]').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: png }); await pg.waitForTimeout(2500)
  const served = await bytesOf('/logo-white.png')
  const tag = await pg.evaluate(() => document.querySelector('[data-simg="logo-white"] .simg-tag')?.textContent)
  check(served.type === 'image/png' && served.body.length > 100 && tag === 'replaced', 'D4 a picture chosen in the Pictures card is served as the white logo and marked replaced', `${served.type} ${served.body.length} ${tag}`)
  await pg.evaluate(() => [...document.querySelectorAll('[data-simg="logo-white"] button')].find((b) => /shipped/.test(b.textContent)).click()); await pg.waitForTimeout(1500)
  check(Number(sql("select count(*) from site_images where name = 'logo-white'")) === 0, 'D5 "Use the shipped picture" deletes the row')
  await pg.close()

  /* ---------------------------------------------------------------- E. the overlays' words */
  const cat = JSON.parse(readFileSync(ROOT + 'scripts/overlay-strings.json', 'utf8')).strings
  const bsKey = Object.keys(cat).find((k) => cat[k].en === 'Best sellers')
  check(!!bsKey && /^overlay\.home_products\./.test(bsKey), 'E1 the overlay harvest lists the Best sellers heading under an admin-legal key', bsKey)
  const keepText = sql("select quote(value) from settings where name = 'site_text'") || null
  try {
    const v = {}; v[bsKey] = { en: ['Best sellers', 'Top picks'], ar: ['الأكثر مبيعاً', 'مختاراتنا'] }
    const st = await admin('settings_save', { name: 'site_text', value: v })
    check(st.status === 200, 'E2 the Site wording row accepts an overlay key', `${st.status} ${st.j?.error || ''}`)
    for (const lang of ['en', 'ar']) {
      const h = await shop(lang, (p) => p.evaluate(() => [...document.querySelectorAll('main h2')].map((x) => x.textContent.trim())))
      check(h.includes(lang === 'en' ? 'Top picks' : 'مختاراتنا') && !h.includes(lang === 'en' ? 'Best sellers' : 'الأكثر مبيعاً'), `E3 ${lang}: the overlay's heading is swapped on the page`, h.join(' | '))
    }
  } finally {
    sql(keepText ? `insert into settings (name, value) values ('site_text', ${keepText}) on duplicate key update value = values(value)` : "delete from settings where name = 'site_text'")
  }
} finally {
  writeFileSync(STORE_PHP, original)
  sql('delete from site_images')
  sql(keepLayout ? `insert into settings (name, value) values ('home_layout', ${keepLayout}) on duplicate key update value = values(value)` : "delete from settings where name = 'home_layout'")
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — the menu, the sections, the features rows and the pictures are the owner\'s to edit')
process.exit(fails ? 1 : 0)
