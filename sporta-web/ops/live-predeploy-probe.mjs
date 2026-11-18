// READ-ONLY pre-deploy probe of the live shop (2026-11-18, the release gate of the full backend release).
// Run ON the VPS in node:24-alpine (see the compose in CLAUDE.md "pre-deploy probe"): the store config, the three database
// secret files and /docker/sporta are mounted read-only, the job is on the sporta-db_default network. It sends only SELECTs
// (the session is READ ONLY) and prints counts, booleans and product slugs. It never prints a secret, a host, a user name,
// a database name, a row of customer data or an order number.
//
// WHY. Two independent reviewers found two things the release would change on the live shop that no suite can see, because
// they depend on the live configuration and the live photo folder:
//   1. store_gateway_db_matches (store.php, new in this release) hides KNET and T-Pay from checkout unless the gateway config's
//      mysql host, name and USER equal the store's db_*. If the live values differ the card options vanish the minute the file
//      is copied. This prints, per gateway and per key, whether it is equal, borrowed from the store, or DIFFERENT.
//   2. product-listable.php (new) hides an active product that has no photo file. The live products.image / images columns are
//      empty (the photographs are files named after the slug), so a product without a file disappears from the product list and
//      the sitemap. This prints how many, and which.
//   3. Order numbers must be at least 10 characters in the new order route (guest orders): prints the shortest live one.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { MySQL, credentials, phpConfig, scrub } from '../scripts/db-schema-live-diff.mjs'

const CFG = process.env.PROBE_CONFIG ?? '/run/sporta-api-config.php'
const say = (s) => console.log(s)
const store = phpConfig(CFG)
const same = (a, b) => a === b

say('== 1 gateway database match (as store_gateway_db_matches reads it)')
const lit = (src, k) => {
  const m = src.match(new RegExp(`['"]${k}['"]\\s*=>\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")\\s*[,\\]]`))
  if (m) return (m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1')
  const f = src.match(new RegExp(`['"]${k}['"]\\s*=>[^\\n]*?file_get_contents\\(\\s*['"]([^'"]+)['"]`))
  return f && existsSync(f[1]) ? readFileSync(f[1], 'utf8').replace(/\r?\n$/, '') : undefined
}
const isLocal = (h) => ['localhost', '127.0.0.1', '::1'].includes(String(h).trim().replace(/^\[|\]$/g, '').toLowerCase())
for (const [name, path] of [['knet', (process.env.PROBE_PRIVATE ?? '/sporta/private') + '/knet-config.php'], ['tpay', (process.env.PROBE_PRIVATE ?? '/sporta/private') + '/pay-config.php']]) {
  if (!existsSync(path)) { say(`${name}: config file not found at the expected place (nothing compared)`); continue }
  const src = readFileSync(path, 'utf8')
  const out = []
  let all = true
  for (const [gw, own] of [['mysql_host', 'db_host'], ['mysql_name', 'db_name'], ['mysql_user', 'db_user']]) {
    const g = (lit(src, gw) ?? '').trim(), o = String(store[own] ?? '').trim()
    let verdict
    if (o === '') { verdict = 'STORE VALUE UNREADABLE'; all = false }
    else if (g === '') verdict = 'borrowed from the store (ok)'
    else if (gw === 'mysql_host' && isLocal(g) && isLocal(o)) verdict = 'equal (both local)'
    else if (same(g, o)) verdict = 'equal'
    else { verdict = 'DIFFERENT'; all = false }
    out.push(`${gw}: ${verdict}`)
  }
  say(`${name}: ${out.join(' | ')} => store_gateway_db_matches would be ${all ? 'TRUE (gateway stays on checkout)' : 'FALSE (gateway would disappear from checkout)'}`)
}

const creds = credentials({ config: CFG })
const conn = new MySQL(creds)
try {
  await conn.connect()
  await conn.query('set session transaction read only')
  say('== 2 products the new list would hide (no name, no price or no photo file)')
  const rows = (await conn.query("select slug, name_en, name_ar, price, image, images from products where active = 1 order by slug")).rows
  const dirs = ['/sporta/site/images/products', '/sporta/private/media/products']
  const photo = (dir) => {
    const have = new Set()
    if (!existsSync(dir)) return null
    for (const f of readdirSync(dir)) { const m = /^([a-z0-9-]+?)(?:-view-\d+)?\.(jpe?g|png|webp)$/.exec(f); if (m) have.add(m[1]) }
    return have
  }
  const sets = dirs.map(photo)
  say(`active products: ${rows.length}; photo folders: ${dirs.map((d, i) => `${d} ${sets[i] ? sets[i].size + ' slugs with a file' : 'absent'}`).join('; ')}`)
  const hidden = { name: [], price: [], photo: [] }
  for (const r of rows) {
    const hasName = (r[1] ?? '').trim() !== '' || (r[2] ?? '').trim() !== ''
    const hasPrice = Number.isFinite(Number(r[3])) && Number(r[3]) > 0
    const hasField = (r[4] ?? '').trim() !== '' || (r[5] ?? '').trim() !== ''
    const hasFile = sets.some((s) => s && s.has(r[0]))
    if (!hasName) hidden.name.push(r[0])
    if (!hasPrice) hidden.price.push(r[0])
    if (!hasField && !hasFile) hidden.photo.push(r[0])
  }
  say(`WOULD BE HIDDEN: no name ${hidden.name.length}, no price ${hidden.price.length}, no photo (column empty AND no file in either folder) ${hidden.photo.length} of ${rows.length}`)
  if (hidden.photo.length) say(`no-photo slugs: ${hidden.photo.join(' ')}`)
  say('== 3 order numbers')
  const t = (await conn.query('select count(*), min(char_length(track_id)), sum(char_length(track_id) < 10) from orders')).rows[0]
  say(`orders: ${t[0]}; shortest order number ${t[1]} characters; shorter than 10: ${t[2]}`)
} catch (e) {
  say(`PROBE FAILED: ${scrub(e.message, [creds.password])}`)
  process.exitCode = 1
} finally { try { conn.end() } catch { /* closed */ } }
say('PROBE_DONE')
