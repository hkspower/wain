/**
 * /men /women /accessories /outlet — the four category landing pages.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/category-pages-test.mjs
 *
 * Plain HTTP checks against category.php, not a browser: the whole point of
 * this file is that it is server-rendered HTML a crawler gets WITHOUT running
 * any JavaScript, so a fetch is the honest way to ask what it looks like.
 */

const BASE = process.env.BASE ?? 'http://localhost:4300'
let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, body: await res.text() }
}

const SLUGS = ['men', 'women', 'accessories', 'outlet']

for (const slug of SLUGS) {
  const { status, body } = await get(`/${slug}`)
  check(status === 200, `/${slug} answers 200`, `got ${status}`)
  check(body.includes('<title>') && !body.includes('<title></title>'),
    `/${slug} has a real title`)
  check(body.includes(`href="https://www.sporta.com.kw/${slug}"`) || body.includes(`rel="canonical"`),
    `/${slug} carries a canonical link`)
  check(body.includes('hreflang="ar"') && body.includes('hreflang="en"'),
    `/${slug} carries both hreflang alternates`)
  // NO ON-PAGE FILTER CONTROL. This is a dedicated page per category, not a
  // pill row added to /shop — the 2026-09-09 "no filters" decision is about
  // /shop specifically, and this rig makes sure nothing here grew a control
  // that narrows the OTHER pages by accident (aria-pressed is the marker
  // used for exactly this elsewhere in the project).
  check(!body.includes('aria-pressed'), `/${slug} has no filter control of its own`)
}

// A category page's own nav must offer the OTHER three plus "all products" —
// otherwise a shopper who lands on /men from a search result has no way to
// reach /women without going back to Google.
{
  const { body } = await get('/men')
  for (const other of ['women', 'accessories', 'outlet']) {
    check(body.includes(`href="/${other}`), `/men links to /${other}`, )
  }
  check(body.includes('href="/shop'), '/men links to /shop ("all products")')
}

// THE WHITELIST HOLDS. category.php reads $_GET['slug'] straight from the
// query string; only the .htaccess RewriteRule keeps a real visitor to the
// four names, so the script itself has to refuse anything else on its own —
// hitting it directly (as this rig does, bypassing .htaccess) is exactly how
// to find out whether it does.
{
  const { status } = await get('/category.php?slug=women%27%20or%20%271%3D%271')
  check(status === 404, 'an unlisted slug is refused, not queried', `got ${status}`)
}

// EMPTY IS HONEST, NOT BROKEN. /outlet has no products assigned in the
// sandbox seed (same as the live catalogue, which has none either — see
// live-category-breakdown.php) and must still read as a real page, not an
// error or a blank screen.
{
  const { status, body } = await get('/outlet')
  check(status === 200, '/outlet (currently empty) still answers 200')
  check(body.includes('class="empty"') || /\d+ (product|منتج)/.test(body),
    '/outlet shows either an empty-state message or a real count, never neither')
}

// A page with products actually links each card to that product's own page —
// checked by slug shape rather than a specific known slug, so this survives
// the sandbox's seed data changing.
{
  const { body } = await get('/men')
  check(/href="\/product\/[a-z0-9-]+/.test(body), '/men product cards link to /product/<slug>')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the four category pages are real, linked and honest about being empty')
process.exit(fails ? 1 : 0)
