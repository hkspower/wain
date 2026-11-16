// The stock list shows the price the shop charges (dropin/php-store/admin.php, route variants): the same number the product shows.
//
//   npm run test:admin-inventory-price     (private MariaDB + PHP; never the shared rig, a config.php or the network)
//
// What is proved, on a database built from the repo's own migrations and through the real routes over php -S:
//   0. static: the variants route selects the sale columns, prices with store_effective_price (the one rule the product feed and
//      the checkout use) and answers list_price and on_sale;
//   1. a product on a running sale: the stock list's price is the sale price, list_price is the list price, on_sale is true, and
//      the public product feed sends the same price for that product;
//   2. a sale that has ended, a sale that has not started, and a product with no sale: the price is the list price, on_sale is
//      false, and the public feed agrees with the stock list for each;
//   3. the route is still signed-in only (401 without a session), needs the X-Sporta-Admin header (400), and is GET only (405);
//   4. MUTATION: with the route answering the list price again, check 1 fails (so the suite asserts something).
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { startPrivateMariadb, toolsPresent } from './lib/private-mariadb.mjs'
import { applyAll, sqlInventory, toolingOrder, freshDb } from './db-schema-diff.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PHPDIR = join(ROOT, 'dropin/php-store')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ADMIN = readFileSync(join(PHPDIR, 'admin.php'), 'utf8')
const API_FILE = readFileSync(join(PHPDIR, 'api.php'), 'utf8')

// ------------------------------------------------------------------------------------------ 0 static
head('0. the route prices like the product feed')
{
  const at = ADMIN.indexOf("if ($r === 'variants')")
  const blk = at > 0 ? ADMIN.slice(at, ADMIN.indexOf('\n}\n', at) + 3) : ''
  is(at > 0 && /p\.sale_price,\s*p\.sale_starts_at,\s*p\.sale_ends_at/.test(blk), 'the variants route selects the sale columns')
  is(/store_effective_price\(\[/.test(blk) && /\(float\)store_kwd\(\$eff\['fils'\]\)/.test(blk), 'and prices with store_effective_price, the same rule as the product feed')
  is(/\$row\['list_price'\]/.test(blk) && /\$row\['on_sale'\]/.test(blk), 'it also answers list_price and on_sale')
  is(/store_effective_price\(\$row\)/.test(API_FILE), 'the public product feed uses the same store_effective_price')
}

// ------------------------------------------------------------------------------------------ private database
const tp = toolsPresent()
const phpOk = spawnSync('php', ['-v']).status === 0
if (tp.missing.length || !phpOk) {
  console.log(`\nSKIP the database part: missing ${[...tp.missing, ...(phpOk ? [] : ['php'])].join(', ')}`)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

const work = mkdtempSync(join(tmpdir(), 'inv-price-'))
const inst = await startPrivateMariadb({ label: 'inv', portFrom: 34310 })
const DB = 'invprice_' + randomBytes(3).toString('hex')
const servers = []

try {
  const inv = sqlInventory(PHPDIR)
  await freshDb(inst, DB)
  const res = applyAll(inst, DB, toolingOrder(inv), PHPDIR)
  const bad = res.filter((r) => !r.ok)
  is(bad.length === 0, `the repo's migrations apply on a fresh database (${res.length} files)`, bad.map((b) => `${b.file}: ${b.message}`).join('; '))
  const sql = (q) => inst.sql(q, DB)

  // four products, four states of the same list price
  // an image path: the public feed lists a product only when it has a photo (product-listable.php); no file is needed for that
  await sql(`insert into products (slug, name_en, name_ar, price, sale_price, sale_starts_at, sale_ends_at, category, active, image) values
    ('sale-running', 'Running sale', 'Running sale ar', 10.000, 7.500, '2020-01-01 00:00:00', null, 'tops', 1, '/images/products/test-photo.jpg'),
    ('sale-ended', 'Ended sale', 'Ended sale ar', 10.000, 7.500, '2020-01-01 00:00:00', '2020-02-01 00:00:00', 'tops', 1, '/images/products/test-photo.jpg'),
    ('sale-future', 'Future sale', 'Future sale ar', 10.000, 7.500, '2999-01-01 00:00:00', null, 'tops', 1, '/images/products/test-photo.jpg'),
    ('no-sale', 'No sale', 'No sale ar', 12.250, null, null, null, 'tops', 1, '/images/products/test-photo.jpg')`)
  await sql(`insert into product_variants (sku, slug, size, stock) values
    ('SR-M', 'sale-running', 'M', 3), ('SE-M', 'sale-ended', 'M', 3), ('SF-M', 'sale-future', 'M', 3), ('NS-M', 'no-sale', 'M', 3)`)
  await sql(`insert into admin_users (email, password_hash) values ('inv-admin@sporta.test', '${spawnSync('php', ['-r', "echo password_hash('correct-horse-battery-kw', PASSWORD_BCRYPT);"], { encoding: 'utf8' }).stdout.trim()}')`)

  // the site: the repo's api folder, its config outside it (the same arrangement as the other database suites)
  const site = join(work, 'site'); mkdirSync(site)
  cpSync(PHPDIR, join(site, 'api'), { recursive: true })
  rmSync(join(site, 'api/config.php'), { force: true })
  const cfgFile = join(work, 'api-config.php')
  mkdirSync(join(work, 'sess'))
  writeFileSync(cfgFile, `<?php\nreturn ['db_host' => '127.0.0.1;port=${inst.port}', 'db_name' => '${DB}', 'db_user' => 'root', 'db_pass' => '', 'session_secret' => '${randomBytes(16).toString('hex')}', 'admin_session_dir' => '${join(work, 'sess')}'];\n`)
  const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const serve = async (dir) => {
    const port = await freePort()
    const p = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { env: { ...process.env, SPORTA_API_CONFIG_FILE: cfgFile }, stdio: 'ignore' })
    servers.push(p)
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/api/api.php?r=products`); break } catch { await sleep(150) } }
    return `http://127.0.0.1:${port}/api`
  }
  const BASE = await serve(site)
  const call = async (base, route, { method = 'GET', headers = {}, cookie = '', body } = {}) => {
    const r = await fetch(`${base}/admin.php?r=${route}`, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
    const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* not json */ }
    return { status: r.status, json: j, text: t, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] }
  }
  const H = { 'X-Sporta-Admin': '1' }

  head('1-2. the stock list and the product feed agree, sale or not')
  const anon = await call(BASE, 'variants', { headers: H })
  is(anon.status === 401, 'the stock list needs a signed-in admin (401 without a session)', String(anon.status))
  const login = await call(BASE, 'login', { method: 'POST', headers: H, body: { email: 'inv-admin@sporta.test', password: 'correct-horse-battery-kw' } })
  const cookie = login.set.map((s) => s.split(';')[0]).join('; ')
  is(login.status === 200 && cookie.includes('='), 'the test admin signs in', String(login.status) + login.text.slice(0, 120))
  is((await call(BASE, 'variants', { cookie })).status === 400, 'a session without the X-Sporta-Admin header -> 400')
  is((await call(BASE, 'variants', { method: 'POST', cookie, headers: H, body: {} })).status === 405, 'POST -> 405')

  const listed = await call(BASE, 'variants', { cookie, headers: H })
  const feed = await (await fetch(`${BASE}/api.php?r=products`)).json()
  const bySku = Object.fromEntries((listed.json || []).map((r) => [r.sku, r]))
  const bySlug = Object.fromEntries((Array.isArray(feed) ? feed : []).map((p) => [p.slug, p]))
  const WANT = [
    ['SR-M', 'sale-running', 7.5, 10, true],
    ['SE-M', 'sale-ended', 10, 10, false],
    ['SF-M', 'sale-future', 10, 10, false],
    ['NS-M', 'no-sale', 12.25, 12.25, false],
  ]
  for (const [sku, slug, price, list, on] of WANT) {
    const r = bySku[sku] || {}
    is(r.price === price && r.list_price === list && r.on_sale === on, `${slug}: the stock list shows ${price} (list ${list}, on sale ${on})`, JSON.stringify(r))
    is(bySlug[slug] && bySlug[slug].price === r.price, `${slug}: the public feed sends the same price (${bySlug[slug]?.price})`, JSON.stringify(bySlug[slug] || null))
  }

  head('4. MUTATION: the list price back in the route')
  // the route with its one line changed to the list price, served from its own copy; check 1 must fail on it
  const TARGET = "$row['price'] = $eff === null ? null : (float)store_kwd($eff['fils']);"
  is(ADMIN.includes(TARGET), 'the mutation target is in admin.php (so the mutant really differs)')
  const mut = join(work, 'mut'); mkdirSync(mut)
  cpSync(site, mut, { recursive: true })
  writeFileSync(join(mut, 'api/admin.php'), ADMIN.replace(TARGET, "$row['price'] = $row['list_price'];"))
  const MUT = await serve(mut)
  const mutLogin = await call(MUT, 'login', { method: 'POST', headers: H, body: { email: 'inv-admin@sporta.test', password: 'correct-horse-battery-kw' } })
  const mutCookie = mutLogin.set.map((s) => s.split(';')[0]).join('; ')
  const mutList = await call(MUT, 'variants', { cookie: mutCookie, headers: H })
  const mutSr = (mutList.json || []).find((r) => r.sku === 'SR-M') || {}
  is(!(mutSr.price === 7.5), 'MUTATION: with the list price in the route, the running sale does NOT show 7.5 (the check above would fail)', String(mutSr.price))
} finally {
  for (const p of servers) { try { p.kill() } catch { /* gone */ } }
  inst.stop()
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
