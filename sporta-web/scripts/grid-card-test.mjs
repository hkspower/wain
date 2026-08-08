// The product grid's quick-add, against the real server.
//
// THE BUG THIS EXISTS FOR. The card called add(product) with no size, always.
// The server refuses a size-less line for anything that HAS sizes
// (`size_required_<slug>`), so tapping + on a garment built a bag that checkout
// would not accept — and the checkout has no size picker to fix it with. The
// shopper met a generic "we could not place your order" at the last step of
// buying, naming neither the item nor the reason.
//
// It is checked here by carrying the bag the grid produces all the way to the
// order endpoint, because that is the only place the mistake showed. Asserting
// that the button "adds to the cart" is exactly what a test would have said
// while the bug was live.
//
//   npm run test:grid
//   (needs MariaDB, php -S :8095 php-store, php -S :8188 router-native)
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
// THE ROUTER RIG, NOT `vite preview`. Preview serves static files and answers
// /api/api.php with the SPA shell, so the stock table never loads and every
// card falls into the "sizes unknown" branch. The garment case then passes for
// entirely the wrong reason — unknown is treated as sized — while the
// accessory and sold-out cases fail. A rig that cannot tell the branches apart
// cannot test them.
const SITE = process.env.SITE ?? 'http://127.0.0.1:8188'
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const sql = async (q) =>
  (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q])).stdout.trim()

// A garment (has size rows) and an accessory (has none). Chosen from the
// database rather than hard-coded, so this keeps working as the catalogue moves.
const SIZED = await sql(
  "select v.slug from product_variants v join products p on p.slug = v.slug where p.active = 1 group by v.slug limit 1")
const SIZELESS = await sql(
  "select p.slug from products p where p.active = 1 and not exists (select 1 from product_variants v where v.slug = p.slug) limit 1")

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// Open the grid and find one product's card, scrolling until it is rendered —
// the shop pages in and only draws the first batch.
async function cardFor(page, slug) {
  await page.goto(`${SITE}/shop`, { waitUntil: 'networkidle' })
  let card = page.locator(`article:has(a[href$="/product/${slug}"])`).first()
  for (let i = 0; i < 15 && !(await card.count()); i++) {
    await page.mouse.wheel(0, 2200)
    await page.waitForTimeout(350)
    card = page.locator(`article:has(a[href$="/product/${slug}"])`).first()
  }
  // Stock arrives after the first paint and only refines the card; wait for it
  // so the button under test is in its settled state.
  await page.waitForTimeout(600)
  return card
}

const bag = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))

// Hand the bag to the REAL order endpoint. This is the assertion that matters:
// a cart the shop will not accept is not a cart.
async function checkout(items, track) {
  const res = await fetch(`${API}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track,
      items: items.map((i) => ({ slug: i.slug, qty: i.qty, size: i.size, fit: i.fit })),
      customer: {
        name: 'Grid Probe', phone: '99887766', governorate: 'hawalli',
        area: 'Salmiya', block: '4', street: '12', building: '5',
      },
      payment_method: 'cod',
    }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
await sql("delete from order_items where order_id in (select id from orders where track_id like 'SPGRID%')")
await sql("delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'SPGRID%')")
await sql("delete from orders where track_id like 'SPGRID%'")

// ------------------------------------------------------------- the garment
head('quick-add on a GARMENT does not build a bag the shop refuses')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const card = await cardFor(page, SIZED)
  is(await card.count() === 1, 'the card is on the grid', SIZED)

  const btn = card.locator('button').last()
  const label = await btn.getAttribute('aria-label')
  // The label must describe what the tap DOES. A button that says "add" and
  // navigates instead is precisely what a screen-reader user cannot recover
  // from — they are told one thing and given another.
  is(/choose|اختر/i.test(label ?? ''), 'its button offers to CHOOSE A SIZE, not to add', label)

  await btn.click({ force: true })
  await page.waitForTimeout(700)

  is((await bag(page)).length === 0, 'tapping it adds NOTHING to the bag')
  is(page.url().includes(`/product/${SIZED}`),
     'it goes to the product page, where the size is', page.url().replace(SITE, ''))
  await page.close()
}

// ----------------------------------------------------------- the accessory
head('quick-add on an ACCESSORY still works in one tap')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const card = await cardFor(page, SIZELESS)
  is(await card.count() === 1, 'the card is on the grid', SIZELESS)

  await card.locator('button').last().click({ force: true })
  await page.waitForTimeout(700)

  const items = await bag(page)
  is(items.length === 1 && items[0].slug === SIZELESS, 'one tap puts it in the bag')
  is(page.url().endsWith('/shop'), 'and the shopper stays on the grid')

  // The whole point: this bag has to survive the checkout.
  const res = await checkout(items, 'SPGRIDACC1')
  is(res.status === 200 && res.body.order_id, 'and the shop ACCEPTS that bag', `${res.status}`)
  await page.close()
}

// ------------------------------- what the old behaviour would have produced
head('the bag the OLD card built is still refused by the server')
{
  // Not a regression test for the card — a statement of why the card changed.
  // If this ever starts passing, the server stopped enforcing sizes and the
  // card's navigation is no longer protecting anything.
  const res = await checkout([{ slug: SIZED, qty: 1, size: null, fit: null }], 'SPGRIDOLD1')
  is(res.status === 400 && String(res.body.error ?? '').startsWith('size_required_'),
     'a size-less line for a garment is rejected', `${res.status} ${res.body.error ?? ''}`)
}

// --------------------------------------------------------------- sold out
head('a sold-out product cannot be quick-added')
{
  // Take every size of the garment to zero and reload. The stock table is
  // cached for two minutes IN MEMORY, so a fresh page is a fresh cache.
  const before = await sql(`select group_concat(concat(size,':',stock)) from product_variants where slug='${SIZED}'`)
  await sql(`update product_variants set stock = 0 where slug = '${SIZED}'`)
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const card = await cardFor(page, SIZED)
    const text = await card.innerText()
    is(/sold out|نفد/i.test(text), 'the card says it is sold out', text.split('\n')[0])
    // Hidden rather than merely disabled: a control the shopper cannot use
    // should not sit there inviting the tap.
    const visible = await card.locator('button:not([disabled])').count()
    is(visible <= 1, 'and the quick-add is gone — only the wishlist heart remains', `${visible} enabled button(s)`)
    await page.close()
  } finally {
    // Put the shelf back exactly as it was, whatever happened above.
    for (const pair of before.split(',')) {
      const [size, stock] = pair.split(':')
      await sql(`update product_variants set stock = ${Number(stock)} where slug='${SIZED}' and size='${size}'`)
    }
  }
  const after = await sql(`select group_concat(concat(size,':',stock)) from product_variants where slug='${SIZED}'`)
  is(after === before, 'and the test put the stock back', after)
}

await browser.close()
await sql("delete from order_items where order_id in (select id from orders where track_id like 'SPGRID%')")
await sql("delete from fulfilment_outbox where order_id in (select id from orders where track_id like 'SPGRID%')")
await sql("delete from orders where track_id like 'SPGRID%'")

console.log(fails ? `\n${fails} problem(s) in the product grid` : '\nthe grid only ever builds a bag the shop accepts')
process.exit(fails ? 1 : 0)
