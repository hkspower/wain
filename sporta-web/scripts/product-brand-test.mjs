// A product's brand, from the admin screen to the product page.
//
// THE GAP THIS CLOSES. The brands table has existed for a while and the admin
// could manage it, but nothing ever recorded WHICH brand a garment was — the
// list was eight rows nobody could reach from a product. So the product page
// showed the shop's own mark and the AHED supplier line and could not say the
// thing in the photograph is a Vanquish tee.
//
// What is checked here is the whole chain, because every link of it is new:
// the column, the admin's validation, the logo endpoint's caching and its
// refusals, and the fact that the storefront's own products payload does NOT
// carry the base64.
//
//   npm run test:brand     (needs MariaDB and php -S :8095 php-store)
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const sql = async (q) =>
  (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q])).stdout.trim()

await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])

// A real 1x1 PNG, base64. Small, and genuinely a PNG — the endpoint checks the
// magic number, so a made-up string would be refused for the right reason and
// prove nothing about the happy path.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const DATA_URI = `data:image/png;base64,${PNG}`

// Admin session, for the save route.
const jar = []
const admin = async (route, body) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Sporta-Admin': '1',
      ...(jar.length ? { Cookie: jar.join('; ') } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) { const v = c.split(';')[0]; if (!jar.includes(v)) jar.push(v) }
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

await sql("update admin_users set locked_until = null, fail_count = 0").catch(() => {})
await admin('login', { email: 'cs@sporta.com.kw', password: 'correct-horse-battery-kw' })

const SLUG = await sql("select slug from products where active = 1 limit 1")

// ------------------------------------------------------- the admin's half
head('the admin decides which brand a product is')
{
  const good = await admin('product_save', await productPayload(SLUG, 'vanquish'))
  is(good.status === 200, 'a real brand saves', `${good.status}`)
  is((await sql(`select brand_slug from products where slug='${SLUG}'`)) === 'vanquish',
     'and it is recorded against the product')

  // A TYPO MUST NOT SAVE. The product page would simply show no brand, and
  // "the logo did not appear" is a far harder thing to diagnose than a save
  // that refused.
  const bad1 = await admin('product_save', await productPayload(SLUG, 'vanquishh'))
  is(bad1.status === 400 && bad1.body.error === 'unknown_brand',
     'an invented brand is REFUSED, not stored', `${bad1.status} ${bad1.body.error ?? ''}`)
  is((await sql(`select brand_slug from products where slug='${SLUG}'`)) === 'vanquish',
     'and the previous brand is untouched by the attempt')

  const cleared = await admin('product_save', await productPayload(SLUG, ''))
  is(cleared.status === 200 && (await sql(`select ifnull(brand_slug,'-') from products where slug='${SLUG}'`)) === '-',
     'and an empty value clears it — a product can go back to having no brand')

  await admin('product_save', await productPayload(SLUG, 'vanquish'))
}

// Read the product back and hand it straight to product_save. Building the
// payload from the row rather than from literals means this suite does not
// silently blank a column it forgot to send.
async function productPayload(slug, brand) {
  const r = await admin('products_all')
  const p = (r.body ?? []).find((x) => x.slug === slug)
  return { ...p, brand_slug: brand }
}

// ------------------------------------------------------ the storefront half
head('the storefront learns the brand without paying for the logo')
{
  const products = await (await fetch(`${API}/api.php?r=products`)).json()
  const row = products.find((p) => p.slug === SLUG)
  is(row?.brand_slug === 'vanquish', 'the products payload carries the brand', row?.brand_slug)

  // THE SIZE PROPERTY. A logo is a data: URI capped at 160 kB and /api is
  // no-store, so a logo inside this response would be re-downloaded on every
  // page for every product that shares the brand.
  const raw = JSON.stringify(products)
  is(!raw.includes('data:image'), 'and NOT the base64 — /api is no-store, this is fetched on every visit')

  const brands = await (await fetch(`${API}/api.php?r=brands`)).json()
  is(!JSON.stringify(brands).includes('data:image'),
     'the brands list does not carry it either', `${brands.length} brands`)
  const v = brands.find((b) => b.slug === 'vanquish')
  is(typeof v?.logo_v === 'string' && v.logo_v.length === 12,
     'it carries a content hash instead, so the bytes can be cached for a year', v?.logo_v)
}

// ------------------------------------------------------------- the bytes
head('the logo is served as an image, cached and guarded')
{
  const before = await fetch(`${API}/api.php?r=brand_logo&slug=vanquish`)
  is(before.status === 404, 'a brand with no logo yet is a 404, not an empty image', `${before.status}`)

  await sql(`update brands set logo = '${DATA_URI}' where slug = 'vanquish'`)
  const res = await fetch(`${API}/api.php?r=brand_logo&slug=vanquish`)
  const buf = Buffer.from(await res.arrayBuffer())
  is(res.status === 200, 'once uploaded it is served', `${res.status}`)
  is(res.headers.get('content-type') === 'image/png', 'as an image', res.headers.get('content-type'))
  // The decoded bytes, not the base64 — that is the whole saving.
  is(buf.length === Buffer.from(PNG, 'base64').length, 'decoded, not as base64', `${buf.length} bytes`)
  is(buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG', 'and it really is a PNG')

  const cc = res.headers.get('cache-control') ?? ''
  is(cc.includes('immutable') && cc.includes('31536000'),
     'cached for a year and immutable — safe because the URL carries the hash', cc)
  is(res.headers.get('x-content-type-options') === 'nosniff',
     'and it can only ever be read as an image')

  // The hash must MOVE when the logo does, or a year-long cache is a year-long
  // stale logo.
  const v1 = (await (await fetch(`${API}/api.php?r=brands`)).json()).find((b) => b.slug === 'vanquish').logo_v
  await sql(`update brands set logo = 'data:image/png;base64,${PNG}AA' where slug = 'vanquish'`)
  const v2 = (await (await fetch(`${API}/api.php?r=brands`)).json()).find((b) => b.slug === 'vanquish').logo_v
  is(v1 !== v2, 'changing the logo changes the hash, so the cache cannot go stale', `${v1} -> ${v2}`)
}

head('the endpoint refuses what it should')
{
  is((await fetch(`${API}/api.php?r=brand_logo&slug=nosuchbrand`)).status === 404,
     'an unknown brand is a 404')
  is((await fetch(`${API}/api.php?r=brand_logo&slug=`)).status === 404, 'an empty slug is a 404')

  // An SVG can carry script and would be served from our own origin. The
  // brands admin refuses one on the way in; this is the second gate.
  await sql(`update brands set logo = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' where slug = 'ate'`)
  is((await fetch(`${API}/api.php?r=brand_logo&slug=ate`)).status === 404,
     'an SVG is refused even if one reaches the table — it can carry script')
  await sql("update brands set logo = null where slug = 'ate'")

  // Inactive brands are not shop-window data.
  await sql("update brands set active = 0 where slug = 'vanquish'")
  is((await fetch(`${API}/api.php?r=brand_logo&slug=vanquish`)).status === 404,
     'a hidden brand does not serve its logo')
  await sql("update brands set active = 1, logo = null where slug = 'vanquish'")
}

await sql(`update products set brand_slug = null where slug = '${SLUG}'`)
console.log(fails ? `\n${fails} problem(s) in the product/brand link` : '\nproducts know their brand, and the logo is served once')
process.exit(fails ? 1 : 0)
