/**
 * Size, fit and colour pick-lists in /backends — server routes and the card.
 *
 *   node scripts/product-attrs-test.mjs        (npm run test:product-attrs)
 *
 * The fixture is NAMED (tekno-shorts-black), not "the first product": a fixture
 * chosen by position is chosen at random. Everything it changes is put back.
 *
 * What is asserted, and why each is worth a line:
 *  - the gate (401 to a stranger) on both routes;
 *  - the lists come from the SERVER, and the sizes/fits are the rules' subset;
 *  - a save is read back, and the product row itself (price, names, active) is
 *    byte-identical afterwards — the route must touch nothing else;
 *  - every refusal is by name AND changes nothing (colour, sizes and the
 *    attrs row are re-read after each);
 *  - a size with stock cannot be removed, one at stock 0 can;
 *  - the card in the real panel: appears on Catalogue, offers only the server's
 *    options, disables a stocked size's box, saves, and leaves other screens.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ADMIN = BASE + '/api/admin.php'
const SLUG = 'tekno-shorts-black'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()

let cookie = ''
const admin = (route, body) => fetch(`${ADMIN}?r=${route}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))

const productRow = () => sql(`select slug,name_en,name_ar,price,active,category from products where slug='${SLUG}'`)
const sizesNow = () => sql(`select size,stock from product_variants where slug='${SLUG}' order by size`)
const attrsNow = () => sql(`select colour,coalesce(fits,'-') from product_attrs where slug='${SLUG}'`)

const startVariants = sizesNow()
const startRow = productRow()
// EXACT rows, sku and cost included. The first version re-inserted a slug-derived SKU
// for every size, which REPLACED the imported supplier codes (A-TEK-BL-M …) with
// derived ones — and the sandbox's next import then added the supplier rows back,
// leaving the fixture with two ladders and this rig failing on its own leftovers.
const startFull = sql(`select sku, size, stock, coalesce(cost_aed,'NULL') from product_variants where slug='${SLUG}'`).split('\n').map((l) => l.split('\t'))
const restore = () => {
  sql(`delete from product_attrs where slug='${SLUG}'`)
  sql(`delete from product_variants where slug='${SLUG}'`)
  for (const [sku, size, stock, cost] of startFull) {
    sql(`insert into product_variants (sku,slug,size,stock,cost_aed) values ('${sku}','${SLUG}','${size}',${stock},${cost === 'NULL' ? 'null' : cost})`)
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  check(startVariants.split('\n').length === 8, 'the named fixture is there with eight sizes', startVariants.replace(/\n/g, ' | ').slice(0, 60))

  for (const [route, body] of [['product_attrs'], ['product_attrs_save', {}]]) {
    const r = await fetch(`${ADMIN}?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: body ? '{}' : undefined })
    check(r.status === 401, `${route} answers 401 to a stranger`, `got ${r.status}`)
  }

  await page.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await page.locator('input[type=password]').count()) {
    await page.fill('input[autocomplete=username], input[type=email]', 'manager@sporta.com.kw')
    await page.fill('input[type=password]', 'correct horse')
    await page.locator('form button, button').first().click()
    await page.waitForTimeout(1600)
  }
  cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')

  /* -------------------------------------------------------- the lists ---- */
  const a0 = await admin('product_attrs')
  check(a0.status === 200 && a0.j?.ready === true, 'signed in; the route answers and the shop is set up', JSON.stringify(a0.j)?.slice(0, 80))
  check(a0.j.colours.length >= 15 && a0.j.colours.every((c) => c.key && c.en && c.ar && /^#[0-9a-f]{6}$/i.test(c.hex)), 'colours come from the server, each with English, Arabic and a hex')
  check(new Set(a0.j.colours.map((c) => c.key)).size === a0.j.colours.length, 'colour keys are unique')
  check(a0.j.sizes.includes('M') && a0.j.fits.includes('normal'), 'sizes and fits are the shop\'s own lists', `${a0.j.sizes.length} sizes, ${a0.j.fits.length} fits`)
  check(a0.j.variants[SLUG]?.length === 8, 'the fixture\'s eight size rows are reported with their stock')

  /* --------------------------------------------- a save, read back -------- */
  const ok = await admin('product_attrs_save', { slug: SLUG, colour: 'black', fits: ['normal', 'slim'], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] })
  check(ok.status === 200 && ok.j?.ok === true, 'a valid save is accepted', JSON.stringify(ok.j))
  check(attrsNow() === 'black\tnormal,slim', 'colour and fits are stored', attrsNow())
  check(productRow() === startRow, 'the product row itself is byte-identical (price, names, active)')
  const a1 = await admin('product_attrs')
  check(a1.j.rows[SLUG]?.colour === 'black' && a1.j.rows[SLUG].fits.join() === 'normal,slim', 'and read back through the route')

  /* --------------------------------- every refusal is named, none writes --- */
  const before = () => attrsNow() + '|' + sizesNow().replace(/\n/g, ',')
  const refuse = async (what, body, token) => {
    const s = before()
    const r = await admin('product_attrs_save', body)
    check(r.status >= 400 && new RegExp(token).test(JSON.stringify(r.j)), `${what} is refused as ${token}`, `${r.status} ${JSON.stringify(r.j)}`)
    check(before() === s, `  and nothing was written by it`)
  }
  const all = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']
  await refuse('a colour that is not in the list', { slug: SLUG, colour: 'navy-ish', fits: [], sizes: all }, 'invalid_colour')
  await refuse('a fit the shop does not offer', { slug: SLUG, colour: 'black', fits: ['baggy'], sizes: all }, 'invalid_fit')
  await refuse('a size the shop does not offer', { slug: SLUG, colour: 'black', fits: [], sizes: [...all, '9XL'] }, 'invalid_size')
  await refuse('no sizes at all', { slug: SLUG, colour: 'black', fits: [], sizes: [] }, 'at_least_one_size')
  await refuse('a product that does not exist', { slug: 'no-such-garment', colour: 'black', fits: [], sizes: all }, 'product_not_found')
  await refuse('removing a size that has stock', { slug: SLUG, colour: 'black', fits: [], sizes: all.filter((s) => s !== 'XL') }, 'size_has_stock:XL:20')

  /* ----------------------------------- a size at stock 0 can be removed ---- */
  const vs = await admin('variant_save', { slug: SLUG, size: '5XL', stock: 0 })
  check(vs.status === 200, 'the fixture\'s 5XL is set to stock 0 through the panel\'s own route')
  const rm = await admin('product_attrs_save', { slug: SLUG, colour: 'black', fits: ['normal'], sizes: all.filter((s) => s !== '5XL') })
  check(rm.status === 200 && !sizesNow().includes('5XL'), 'a size at stock 0 is removed', sizesNow().split('\n').length + ' rows')
  check(sizesNow().split('\n').filter((l) => l.split('\t')[1] === '20').length === 7, 'the seven others kept their stock of 20')
  const add = await admin('product_attrs_save', { slug: SLUG, colour: 'black', fits: [], sizes: all })
  check(add.status === 200 && /5XL\t0/.test(sizesNow()), 'adding it back creates a stock-0 row', sizesNow().split('\n').pop())
  check(sql(`select count(*) from product_variants where slug='${SLUG}' and size='5XL'`) === '1', 'as ONE row (no second row for the size)')
  check(attrsNow() === 'black\t-', 'no fits chosen is stored as "every fit" (NULL), the shipped behaviour', attrsNow())

  /* ------------------------------------------------------- the card ------- */
  await page.getByText('Catalogue', { exact: true }).first().click()
  await page.waitForSelector('[data-sporta-attrs]', { timeout: 8000 })
  check((await page.locator('[data-sporta-attrs]').count()) === 1, 'the card is on the Catalogue screen')
  await page.waitForFunction(() => document.querySelector('[data-sporta-attrs] select option[value="' + 'tekno-shorts-black' + '"]'), null, { timeout: 8000 })
  await page.locator('[data-sporta-attrs] select').selectOption(SLUG)
  await page.waitForSelector('[data-sporta-attrs] [data-colour]')
  check((await page.locator('[data-sporta-attrs] [data-colour]').count()) === a0.j.colours.length, 'a swatch for every colour the server lists')
  check((await page.locator('[data-sporta-attrs] [data-size]').count()) === a0.j.sizes.length && (await page.locator('[data-sporta-attrs] [data-fit]').count()) === a0.j.fits.length, 'a box for every size and fit the server lists — and no others')
  check(await page.locator('[data-sporta-attrs] [data-size="M"]').isDisabled(), 'a size with stock has its box disabled')
  check((await page.locator('[data-sporta-attrs] [data-colour="black"]').getAttribute('aria-pressed')) === 'true', 'the saved colour shows as pressed')
  await page.locator('[data-sporta-attrs] [data-colour="cherry-red"]').click()
  await page.locator('[data-sporta-attrs] [data-fit="slim"]').check()
  await page.getByRole('button', { name: 'Save size, fit and colour' }).click()
  await page.waitForFunction(() => /Saved\./.test(document.querySelector('[data-sporta-attrs]')?.textContent || ''), null, { timeout: 8000 })
  check(attrsNow().startsWith('cherry-red\t'), 'pressing Save writes the colour picked in the panel', attrsNow())
  check(productRow() === startRow, 'and again the product row is untouched')
  await page.getByText('Orders', { exact: true }).first().click()
  await page.waitForSelector('.admin-content h1:has-text("Orders")', { timeout: 8000 })
  await page.waitForTimeout(600)
  check((await page.locator('[data-sporta-attrs]').count()) === 0, 'the card removes itself on another screen')
  check(errors.length === 0, 'no script errors in the panel', errors.join(' | ').slice(0, 120))
} catch (e) {
  fails++
  console.log('FAIL ' + (e?.stack ?? e))
} finally {
  restore()
  await browser.close()
}
check(sizesNow() === startVariants && attrsNow() === '' && productRow() === startRow, 'the fixture is exactly as it was found')
console.log(fails ? `\n${fails} failed` : '\nall ok — colour, fit and size are picked from fixed lists, and nothing else moves')
process.exit(fails ? 1 : 0)
