/**
 * The SEO screen in /backends: search appearance, share picture, sitemap builder, robots.txt builder
 * and per-product SEO — and what each one changes on the shop.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/seo-setup-test.mjs
 *
 *   DEFAULTS   with nothing saved, /robots.txt is the static file byte for byte and /sitemap.xml lists
 *              the same three sections the static index does — a shop that never opens the screen is
 *              unchanged.
 *   ROBOTS     a blocked AI bot gets `Disallow: /` and nothing else; extra rules reach every group that
 *              is not blocked; Googlebot/Bingbot/* cannot be blocked; a rule that would hide "/", a
 *              product, /shop or a category is refused BY NAME; the protective rules survive any save.
 *   SITEMAP    sections drop out of the index, extra links get their own sitemap in both languages,
 *              excluded products leave the products sitemap; another host and private pages are refused.
 *   SEO        the home title/description and the Google tag appear in the served HTML; a product's own
 *              search title replaces the page's; the share picture becomes og:image and is served;
 *              and after the app has hydrated (it writes its own title) the owner's text is still there.
 *   PANEL      an SEO button beside Settings opens the screen; saving from it reaches the server.
 * Every settings row and both tables are put back at the end.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const DOC = new URL('../sporta-site/public_html/', import.meta.url).pathname
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const keep = Object.fromEntries(['seo', 'crawl'].map((n) => [n, sql(`select quote(value) from settings where name = '${n}'`) || null]))
sql('create table if not exists _rig_product_seo as select * from product_seo')
sql('delete from rate_limit')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } })
const admin = async (route, body) => {
  const r = await ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
  return { status: r.status(), body: await r.json().catch(() => null) }
}
const save = (name, value) => admin('settings_save', { name, value })
const text = async (path) => (await fetch(BASE + path)).text()
const ALL = { pages: true, categories: true, products: true }

try {
  const anon = await fetch(`${BASE}/api/admin.php?r=seo_state`, { headers: { 'X-Sporta-Admin': '1' } })
  check(anon.status === 401, 'a visitor cannot read the SEO state', String(anon.status))
  await admin('login', { email: EMAIL, password: PASSWORD })
  sql("delete from settings where name in ('seo','crawl')"); sql('delete from product_seo'); sql('delete from seo_image')

  // ------------------------------------------------------------- DEFAULTS
  check(await text('/robots.txt') === readFileSync(DOC + 'robots.txt', 'utf8'), 'with nothing saved, /robots.txt is the static file byte for byte')
  const idx0 = [...(await text('/sitemap.xml')).matchAll(/<loc>([^<]+)/g)].map((m) => m[1].replace(/^.*\//, ''))
  const idxStatic = [...readFileSync(DOC + 'sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)/g)].map((m) => m[1].replace(/^.*\//, ''))
  check(idx0.join() === idxStatic.join() && idx0.length === 3, 'and /sitemap.xml lists the same sections as the static index', idx0.join())
  const home0 = await text('/?lang=en')
  check(!/google-site-verification|sporta-seo-own/.test(home0) && /og-image\.png/.test(home0), 'the home page carries no verification tag, no marker, and the built-in share picture')

  // --------------------------------------------------------------- ROBOTS
  let r = await save('crawl', { sections: ALL, block: ['GPTBot', 'CCBot'], disallow: ['/old-campaign', '/tmp*'] })
  check(r.status === 200 && !r.body?.error, 'blocking two AI bots and adding two rules saves', JSON.stringify(r.body))
  const robots = await text('/robots.txt')
  const group = (bot) => (robots.split(/\n(?=User-agent:)/).find((g) => g.startsWith('User-agent: ' + bot)) || '').split('\n\n')[0].trim()
  check(/^User-agent: GPTBot\nDisallow: \/$/.test(group('GPTBot')), 'a blocked bot gets "Disallow: /" and nothing else', JSON.stringify(group('GPTBot')))
  check(/Disallow: \/old-campaign\nDisallow: \/tmp\*/.test(group('Googlebot')) && /Disallow: \/old-campaign/.test(group('*')), 'the extra rules reach Googlebot and the wildcard group')
  check(!/old-campaign/.test(group('GPTBot')), 'and not the blocked group (Disallow: / already covers it)')
  for (const g of ['*', 'Googlebot', 'Bingbot', 'ClaudeBot']) {
    check(['/backends', '/admin', '/api/', '/knet/', '/pay/'].every((p) => group(g).includes('Disallow: ' + p)), `the protective rules survive in ${g}`)
  }
  check(/^Sitemap: https:\/\/www\.sporta\.com\.kw\/sitemap\.xml$/m.test(robots), 'the Sitemap line survives')
  const refuse = async (value, err, why) => { const x = await save('crawl', value); check(x.status === 400 && String(x.body?.error).startsWith(err), `refused: ${why}`, `${x.status} ${x.body?.error}`) }
  await refuse({ sections: ALL, block: ['Googlebot'] }, 'robots_unknown_bot', 'blocking Googlebot')
  await refuse({ sections: ALL, block: ['*'] }, 'robots_unknown_bot', 'blocking the wildcard group')
  for (const [rule, page] of [['/', '/'], ['/*', '/'], ['/prod', '/product/x'], ['/s', '/shop'], ['/m', '/men'], ['/*.xml', '/sitemap.xml']]) {
    await refuse({ sections: ALL, disallow: [rule] }, 'robots_rule_blocks_key_page:' + page, `a rule that hides ${page} (${rule})`)
  }
  await refuse({ sections: ALL, disallow: ['no-slash'] }, 'invalid_robots_rule', 'a rule without a leading slash')
  await refuse({ sections: ALL, disallow: ['/a b'] }, 'invalid_robots_rule', 'a rule with a space')
  check(group('GPTBot').includes('Disallow: /') && (await text('/robots.txt')) === robots, 'a refused save changes nothing')

  // -------------------------------------------------------------- SITEMAP
  const slugs = sql('select slug from products where active = 1 order by slug limit 2').split('\n')
  r = await save('crawl', { sections: { pages: true, categories: false, products: true }, custom: ['/shop?sort=new', 'https://www.sporta.com.kw/about', 'https://sporta.com.kw/track'], exclude: [slugs[0], 'no-such-product'] })
  check(r.status === 200 && r.body.custom.join() === '/shop?sort=new,/about,/track', 'extra links are stored as paths, own host only', r.body?.custom?.join())
  check(r.body.exclude.join() === slugs[0], 'an unknown product is dropped from the exclusions', r.body?.exclude?.join())
  const idx = await text('/sitemap.xml')
  check(!/sitemap-categories/.test(idx) && /sitemap-pages/.test(idx) && /sitemap-custom\.xml/.test(idx), 'a switched-off section leaves the index and the extra links join it')
  const cust = await text('/sitemap-custom.xml')
  check(/<loc>https:\/\/www\.sporta\.com\.kw\/shop\?sort=new&amp;lang=en<\/loc>/.test(cust) && /\/about\?lang=en/.test(cust), 'the extra links are listed in both languages', String(cust.match(/<loc>/g)?.length))
  const prods = await text('/sitemap-products.xml')
  check(!prods.includes('/product/' + slugs[0] + '<') && prods.includes('/product/' + slugs[1] + '<'), 'an excluded product leaves the products sitemap, the next one stays')
  await refuse({ sections: ALL, custom: ['https://evil.com/x'] }, 'invalid_sitemap_link', 'a link on another host')
  await refuse({ sections: ALL, custom: ['/backends'] }, 'sitemap_link_private', 'a private page')
  await refuse({ sections: ALL, custom: ['//evil.com'] }, 'invalid_sitemap_link', 'a protocol-relative host')
  await refuse({ sections: {} }, 'sitemap_empty', 'switching every section off with no links')

  // ------------------------------------------------------------------ SEO
  r = await save('seo', { title_en: 'Sporta — rig title', title_ar: 'عنوان الرِّغ', desc_en: 'Rig description EN', desc_ar: '', google_verification: '<meta name="google-site-verification" content="Rig_Token-123456" />' })
  check(r.status === 200 && r.body.google_verification === 'Rig_Token-123456', 'the pasted Search Console tag is reduced to its code', r.body?.google_verification)
  const homeEn = await text('/?lang=en'), homeAr = await text('/')
  check(homeEn.includes('<title>Sporta — rig title</title>') && homeEn.includes('content="Rig description EN"'), 'the English home page carries the owner\'s title and description')
  check(homeAr.includes('<title>عنوان الرِّغ</title>') && !homeAr.includes('Rig description EN'), 'the Arabic page its own title, and the built-in description where Arabic was left empty')
  check((homeEn.match(/google-site-verification/g) || []).length === 1 && homeEn.includes('content="Rig_Token-123456"'), 'the Google tag is printed once')
  check(!(await text('/about')).includes('google-site-verification'), 'and only on the home page')
  const bad = await save('seo', { google_verification: '"><script>x</script>' })
  check(bad.status === 400 && bad.body?.error === 'invalid_google_verification', 'markup in the verification box is refused', bad.body?.error)

  const ps = await admin('seo_product_save', { slug: slugs[1], title_en: 'Rig product title', desc_en: 'Rig product description' })
  check(ps.status === 200, 'a product search title saves', JSON.stringify(ps.body))
  const pEn = await text(`/product/${slugs[1]}?lang=en`), pAr = await text(`/product/${slugs[1]}`)
  check(pEn.includes('<title>Rig product title</title>') && pEn.includes('"description":"Rig product description"'), 'the product page uses it, in its Product data too')
  check(!pAr.includes('Rig product title'), 'the Arabic page keeps its own (nothing was set in Arabic)')
  const unk = await admin('seo_product_save', { slug: 'no-such-product', title_en: 'x' })
  check(unk.status === 400 && unk.body?.error === 'seo_unknown_product', 'an unknown product is refused')

  const png = execFileSync('python3', ['-c', "import io,sys,base64\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(1200,630),(10,120,200)).save(b,'PNG');sys.stdout.write(base64.b64encode(b.getvalue()).decode())"], { encoding: 'utf8' })
  const small = execFileSync('python3', ['-c', "import io,sys,base64\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(300,200)).save(b,'PNG');sys.stdout.write(base64.b64encode(b.getvalue()).decode())"], { encoding: 'utf8' })
  const tooSmall = await admin('seo_image_save', { image: 'data:image/png;base64,' + small })
  check(tooSmall.status === 400 && tooSmall.body?.error === 'seo_image_wrong_size', 'a picture under 600 × 315 is refused')
  const fake = await admin('seo_image_save', { image: 'data:image/png;base64,' + Buffer.from('<?php echo 1; ?>'.repeat(10)).toString('base64') })
  check(fake.status === 400 && fake.body?.error === 'seo_image_not_an_image', 'a file that is not a picture is refused')
  const up = await admin('seo_image_save', { image: 'data:image/png;base64,' + png })
  const og = (await text('/about')).match(/og:image" content="([^"]+)"/)?.[1] ?? ''
  check(up.status === 200 && /r=seo_image&amp;v=[0-9a-f]{12}/.test(og), 'the share picture becomes og:image on pages without their own', og)
  const img = await fetch(BASE + og.replace('https://www.sporta.com.kw', '').replace('&amp;', '&'))
  check(img.status === 200 && img.headers.get('content-type') === 'image/png' && /immutable/.test(img.headers.get('cache-control')) && !img.headers.get('set-cookie'), 'and it is served: png, immutable, no cookie')
  await admin('seo_image_save', { remove: true })
  check(/og-image\.png/.test(await text('/about')), 'removing it brings the built-in picture back')

  // ----------------------------------------------- AFTER THE APP HAS LOADED
  const shop = await ctx.newPage()
  await shop.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' }); await shop.waitForTimeout(2500)
  const after = await shop.evaluate(() => [document.title, document.querySelector('meta[name="description"]')?.content])
  check(after[0] === 'Sporta — rig title' && after[1] === 'Rig description EN', 'after hydration the owner\'s title and description are still the page\'s', JSON.stringify(after))
  await shop.goto(`${BASE}/product/${slugs[1]}?lang=en`, { waitUntil: 'networkidle' }); await shop.waitForTimeout(2500)
  check(await shop.title() === 'Rig product title', 'and on the product page', await shop.title())
  await shop.evaluate(() => { history.pushState({}, '', '/about?lang=en'); dispatchEvent(new PopStateEvent('popstate')) }); await shop.waitForTimeout(1500)
  check(await shop.title() !== 'Rig product title', 'an in-app move to another page lets the app\'s own title stand', await shop.title())

  // ---------------------------------------------------------------- PANEL
  const page = await ctx.newPage()
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
  await page.getByText('Orders', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1500)
  const nav = page.locator('.admin-sidebar [data-spseo-nav]')
  check(await nav.count() === 1, 'an SEO button sits in the sidebar')
  await nav.evaluate((b) => b.click()); await page.waitForTimeout(2000)
  const scr = page.locator('[data-spseo]')
  check(await scr.count() === 1 && await scr.locator('h2').allInnerTexts().then((h) => ['Search appearance', 'Share picture', 'Sitemap', 'robots.txt', 'Product SEO'].every((x) => h.includes(x))), 'it opens a screen with all five parts', (await scr.locator('h2').allInnerTexts()).join(' | '))
  const visibleOthers = await page.evaluate(() => [...document.querySelector('.admin-content').children].filter((c) => !c.hasAttribute('data-spseo') && c.offsetHeight > 0).length)
  check(visibleOthers === 0, 'and nothing else is drawn under it')
  await scr.getByLabel('Title — English').fill('Panel title EN')
  await scr.getByRole('button', { name: 'Save search appearance' }).evaluate((b) => b.click()); await page.waitForTimeout(1200)
  check(/Panel title EN/.test(await text('/?lang=en')), 'saving from the screen reaches the home page')
  await scr.getByLabel('Extra paths to keep out, one per line (e.g. /old-campaign)').fill('/')
  await scr.getByRole('button', { name: 'Save sitemap & robots' }).evaluate((b) => b.click()); await page.waitForTimeout(1200)
  check(/would hide a page the shop needs/.test(await scr.locator('.spseo-note').nth(2).innerText()), 'a rule that would hide the shop is refused in words', await scr.locator('.spseo-note').nth(2).innerText())
  await scr.getByLabel('Extra paths to keep out, one per line (e.g. /old-campaign)').fill('/panel-rule')
  await scr.getByRole('button', { name: 'Save sitemap & robots' }).evaluate((b) => b.click()); await page.waitForTimeout(1200)
  check((await text('/robots.txt')).includes('Disallow: /panel-rule'), 'and a good one reaches robots.txt')
  await page.getByText('Orders', { exact: true }).first().evaluate((b) => b.click()); await page.waitForTimeout(1200)
  check(await scr.count() === 0, 'another screen closes it')
} finally {
  for (const n of ['seo', 'crawl']) {
    if (keep[n] !== null) sql(`insert into settings (name, value) values ('${n}', ${keep[n]}) on duplicate key update value = ${keep[n]}`)
    else sql(`delete from settings where name = '${n}'`)
  }
  sql('delete from product_seo'); sql('insert into product_seo select * from _rig_product_seo'); sql('drop table _rig_product_seo')
  sql('delete from seo_image')
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — SEO, sitemap and robots.txt')
process.exit(fails ? 1 : 0)
