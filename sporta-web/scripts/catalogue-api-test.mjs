// CATALOGUE V2, SERVER SIDE (slice A of CATALOGUE-V2.md) against the real PHP and a real MariaDB, no mocks:
//
//   npm run test:catalogue-api      (needs the rig's MariaDB: `bash scripts/sandbox.sh`; it makes its OWN database, its OWN docroot and its OWN
//                                    php servers, so no product, setting or rate-limit row of the shared rig is read or written)
//
// What is built: dropin/php-store/catalogue.php (the builder, the settings, the ETag), api.php `?r=catalogue`, admin.php `catalogue_settings` /
// `catalogue_settings_save`, seo-page.php (the JSON-LD CollectionPage + ItemList and the owner's title / intro in the head of /catalogue).
// Asserted, each in its own section:
//   DEFAULTS     with no settings row the payload is today's page: the same products, prices and sale state as ?r=products, the default order (men,
//                women, hoodies and jackets, accessories, then any other), every switch on, 9 a page, no wording of its own;
//   LISTING      AUTO-HIDE products (no name, price 0, no SKU row, no photo, inactive) are absent; an owner-hidden slug and category are absent; sold-out
//                products go with show_sold_out=false and not otherwise; a size's stock STATE is in the answer, never a quantity;
//   ORDER        pinned (the owner's order) first, then featured, then the owner's category order, then the name; categories follow, hidden ones left out;
//   PHOTOS       the photo is a file that EXISTS (a stale products.image falls back to the slug's file), image_small only when the 640 px copy exists;
//   NO SECRETS   every key at every level is on the contract's list, no SKU, quantity, cost or customer value appears anywhere in the public or admin answer;
//   REVISION     stable across calls, unchanged by what a visitor cannot see (a stock count inside the same state, a description), changed by each thing
//                they can (price, a size selling out, a name, a photo, each setting);
//   304          the right validator (also with -gzip / -br / W/, in a list, and *) answers 304 with no body and the same ETag, a wrong one 200; HEAD; the
//                method and rate limits;
//   SETTINGS     the admin read and save: whitelisted field by field, strings stripped and capped, per_page 6 / 9 / 12, switches strict through
//                store_admin_switch, slugs must exist, a refused save changes NOTHING (also when only the last field is wrong), a field left out keeps its
//                value, a damaged stored row reads as the default of each field (never "off"); 401 without a session, 400/403 without the header or JSON;
//                one activity row per good save and none per refused one;
//   JSON-LD      /catalogue (ar and en) carries one valid CollectionPage + ItemList of the same products in the same order (at most 100), escaped, with
//                offers (price KWD, availability) unless the owner hides prices; no other page carries it; an empty shop publishes none; the owner's
//                title and intro are the head's title and description;
//   MUTATIONS    each rule above is cut from a copy of the source, and the matching check goes red (and green again when it is put back).
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = join(WEB, 'dropin', 'php-store')
const DB = 'sqlinst_catalogue_v2'
const API_PORT = Number(process.env.CATALOGUE_API_PORT ?? 8398)
const SEO_PORT = Number(process.env.CATALOGUE_SEO_PORT ?? 8399)
const API = `http://127.0.0.1:${API_PORT}/api`
const SITE = `http://127.0.0.1:${SEO_PORT}`
const ADMIN_PASS = 'correct-horse-battery-kw'
const DB_PASS = 'test-pass'

let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
if (spawnSync('php', ['-v']).error || spawnSync('mariadb', ['-e', 'select 1']).status !== 0) { console.log('SKIP php or MariaDB is not available (run bash scripts/sandbox.sh)'); process.exit(0) }

// ------------------------------------------------------------------------------------------------------------ the private tree
// <tmp>/api = a copy of dropin/php-store with its own config.php; <tmp>/images/products = the media folder (the code finds it as dirname(api) + /images/products);
// <tmp>/index.html = the shell seo-page.php renders into. Everything is removed at the end.
const tmp = mkdtempSync(join(tmpdir(), 'catalogue-api-'))
const apiDir = join(tmp, 'api'), photoDir = join(tmp, 'images', 'products')
cpSync(STORE, apiDir, { recursive: true, filter: (p) => !/(^|\/)config\.php$/.test(p) })
mkdirSync(photoDir, { recursive: true }); mkdirSync(join(photoDir, 'responsive'), { recursive: true }); mkdirSync(join(tmp, 'sessions'), { recursive: true })
writeFileSync(join(apiDir, 'config.php'), `<?php return [
  'db_host' => '127.0.0.1', 'db_name' => '${DB}', 'db_user' => 'sporta', 'db_pass' => '${DB_PASS}', 'cron_key' => 'catalogue-test-cron-key-0123456789',
  'order_cooldown_seconds' => 0, 'admin_session_dir' => ${JSON.stringify(join(tmp, 'sessions'))},
  'hide_products_without_photo' => true, 'hide_products_without_sku' => true,
];\n`)
writeFileSync(join(tmp, 'index.html'), '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>home</title><meta name="description" content="home"></head><body><div id="root"></div></body></html>')
writeFileSync(join(tmp, 'seo-router.php'), `<?php require ${JSON.stringify(join(apiDir, 'seo-page.php'))};\n`)
const servers = [
  spawn('php', ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${API_PORT}`, '-t', tmp], { stdio: 'ignore' }),
  spawn('php', ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${SEO_PORT}`, join(tmp, 'seo-router.php')], { stdio: 'ignore' }),
]
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', DB, '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
const cleanup = async () => {
  for (const s of servers) { try { s.kill() } catch (e) { /* gone */ } }
  rmSync(tmp, { recursive: true, force: true })
  await run('mariadb', ['-e', `drop database if exists ${DB}`]).catch(() => {})
}
process.on('exit', () => { for (const s of servers) { try { s.kill() } catch (e) { /* gone */ } } })

await run('mariadb', ['-e', `drop database if exists ${DB}; create database ${DB} character set utf8mb4 collate utf8mb4_unicode_ci; grant all on ${DB}.* to 'sporta'@'localhost'; grant all on ${DB}.* to 'sporta'@'127.0.0.1'`])
{
  // the same load order as scripts/sandbox.sh: install, then every additive migration
  const skip = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  const files = ['install.mysql.sql', ...(await run('ls', [STORE])).stdout.split('\n').filter((f) => f.endsWith('.mysql.sql') && !skip.has(f))]
  for (const f of files) {
    const r = spawnSync('mariadb', [DB], { input: readFileSync(join(STORE, f)), encoding: 'utf8' })
    if (r.status !== 0 && f === 'install.mysql.sql') { console.log(`!! install.mysql.sql failed: ${r.stderr}`); await cleanup(); process.exit(1) }
  }
}
await sql('delete from products; delete from product_variants; delete from brands; delete from settings')
const hash = spawnSync('php', ['-r', `echo password_hash(${JSON.stringify(ADMIN_PASS)}, PASSWORD_DEFAULT);`], { encoding: 'utf8' }).stdout
await sql(`insert into admin_users (email, password_hash) values ('qa-admin@sporta.test', '${hash}')`)
for (let i = 0; i < 80; i++) { try { await fetch(`${API}/api.php?r=slides`); await fetch(SITE + '/'); break } catch (e) { await new Promise((r) => setTimeout(r, 100)) } }

// ------------------------------------------------------------------------------------------------------------ fixtures
const photo = (name) => writeFileSync(join(photoDir, name), 'x')
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const q = (v) => (v === null ? 'null' : `'${String(v).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`)
// slug, name_en, name_ar, price, category, o: sale_price / sale_ends_at / featured / featured_sort / brand / image / images / active / desc, variants [size, stock]
const P = async (slug, en, ar, price, category, o = {}, variants = [['M', 3]]) => {
  await sql(`insert into products (slug, name_en, name_ar, price, sale_price, sale_starts_at, sale_ends_at, category, brand_slug, image, images, active, featured, featured_sort, desc_en)
    values (${q(slug)}, ${q(en)}, ${q(ar)}, ${price}, ${o.sale ?? 'null'}, null, ${o.saleEnd ? q(o.saleEnd) : 'null'}, ${q(category)}, ${q(o.brand ?? null)}, ${q(o.image ?? null)}, ${q(o.images ?? null)}, ${o.active ?? 1}, ${o.featured ?? 0}, ${o.sort ?? 0}, ${q(o.desc ?? 'd')})`)
  for (const [size, stock] of variants) await sql(`insert into product_variants (sku, slug, size, stock, cost_aed, unit_cost_kwd) values ('SKU-SECRET-${slug}-${size}', ${q(slug)}, ${q(size)}, ${stock}, 12.34, 3.456)`)
}
await sql(`insert into brands (slug, name_en, name_ar, logo, active, sort) values ('vanquish', 'Vanquish', 'فانكويش', ${q(LOGO)}, 1, 1), ('nba', 'NBA', 'إن بي إيه', null, 1, 2), ('empty-brand', 'Empty', 'فارغ', null, 1, 3), ('off-brand', 'Off', 'مطفأ', null, 0, 4)`)
await P('zz-men-a', 'Alpha Tee', 'ألفا', '10.000', 'men', { brand: 'vanquish' }, [['M', 4711], ['L', 0]])
await P('zz-men-b', 'Bravo Shorts', 'برافو', '12.500', 'men', { sale: '10.000' }, [['S', 3]])
await P('zz-men-c', 'Charlie Cap', 'تشارلي', '8.000', 'men', { sale: '5.000', saleEnd: '2020-01-01 00:00:00' }, [['M', 1]])
await P('zz-women-a', 'Echo Leggings', 'إيكو', '15.000', 'women', { featured: 1, sort: 1 }, [['M', 2], ['XXL', 2]])
await P('zz-women-b', 'Delta Top', 'دلتا', '9.000', 'women', {}, [['M', 0], ['L', 0]])
await P('zz-out-a', 'Foxtrot Coat', 'فوكستروت', '40.000', 'outerwear', { brand: 'nba' }, [['L', 9]])
await P('zz-acc-a', 'Golf Bag', 'غولف', '5.000', 'accessories', {}, [['ONE', 4]])
await P('zz-extra-a', 'Hotel Gloves', 'هوتيل', '6.000', 'Sport Extras', { brand: 'off-brand' }, [['M', 2]])
await P('zz-evil', 'Evil </script><b>x</b> & "q" \' tag', 'شرير', '3.000', 'men', {}, [['M', 1]])
await P('zz-dbimg', 'India Jacket', 'هند', '20.000', 'outerwear', { image: '/images/products/zz-dbimg-upload-ab12cd34ef.jpg', images: '/images/products/zz-dbimg-upload-ab12cd34ef.jpg,/images/products/zz-dbimg-extra.png' }, [['M', 2]])
await P('zz-ghost', 'Juliet Hoodie', 'جولييت', '22.000', 'outerwear', { image: '/images/products/zz-ghost-missing.jpg' }, [['M', 2]])
// hidden by the shop's own rules (AUTO-HIDE) and by being inactive
await P('zz-noname', '', '', '7.000', 'men', {}, [['M', 2]])
await P('zz-free', 'Kilo Free', 'مجاني', '0.000', 'men', {}, [['M', 2]])
await P('zz-nophoto', 'Lima NoPhoto', 'ليما', '7.000', 'men', {}, [['M', 2]])
await P('zz-nosku', 'Mike NoSku', 'مايك', '7.000', 'men', {}, [])
await P('zz-inactive', 'November Off', 'نوفمبر', '7.000', 'men', { active: 0 }, [['M', 2]])
for (const f of ['zz-men-a', 'zz-men-b', 'zz-men-c', 'zz-women-a', 'zz-women-b', 'zz-out-a', 'zz-acc-a', 'zz-extra-a', 'zz-evil', 'zz-ghost', 'zz-nosku', 'zz-noname', 'zz-free', 'zz-inactive']) photo(`${f}.jpg`)
photo('zz-dbimg-upload-ab12cd34ef.jpg'); photo('zz-dbimg-extra.png'); photo('zz-men-a-view-2.jpg'); photo('zz-men-a.png')
writeFileSync(join(photoDir, 'responsive', 'zz-men-a-640.webp'), 'x')
const LISTED = ['zz-men-a', 'zz-men-b', 'zz-men-c', 'zz-women-a', 'zz-women-b', 'zz-out-a', 'zz-acc-a', 'zz-extra-a', 'zz-evil', 'zz-dbimg', 'zz-ghost']
const AUTO_HIDDEN = ['zz-noname', 'zz-free', 'zz-nophoto', 'zz-nosku']

// ------------------------------------------------------------------------------------------------------------ http helpers
let rl = 0
const pub = async (qs = 'r=catalogue', init = {}) => {
  if (!init.keepLimit && ++rl % 40 === 0) await sql('delete from rate_limit')
  return fetch(`${API}/api.php?${qs}`, init)
}
const cat = async () => (await pub()).json()
let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    headers: { 'Content-Type': opts.contentType ?? 'application/json', ...(opts.noHeader ? {} : { 'X-Sporta-Admin': '1' }), ...(cookie && !opts.noCookie ? { Cookie: cookie } : {}) },
    method: opts.method ?? 'GET', body: opts.body,
  })
  const set = res.headers.get('set-cookie'); if (set && !opts.noCookie) cookie = set.split(';')[0]
  const text = await res.text()
  let body = null; try { body = JSON.parse(text) } catch (e) { /* not json */ }
  return { status: res.status, body, text }
}
const post = (route, body, opts = {}) => admin(route, { method: 'POST', body: JSON.stringify(body), ...opts })
const save = (s) => post('catalogue_settings_save', s)
const events = async () => Number(await sql("select count(*) from admin_activity_log where action_key = 'catalogue_settings_save'"))
const reset = () => sql("delete from settings where name = 'catalogue'")
const slugs = (p) => p.products.map((x) => x.slug)
const seoPage = async (path) => (await fetch(SITE + path)).text()
const ldOf = (html) => { const m = html.match(/<script type="application\/ld\+json" data-sporta-ssr-catalogue="true">([\s\S]*?)<\/script>/); return m ? { raw: m[1], json: JSON.parse(m[1]) } : null }

await sql('delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null')
const signIn = await post('login', { email: 'qa-admin@sporta.test', password: ADMIN_PASS })
is(signIn.status === 200, 'the admin signs in on the private store', `${signIn.status} ${signIn.text.slice(0, 120)}`)

// ================================================================================================================ the probes
// Each rule is ONE function that answers true when the rule holds; the sections call them, and the mutation section calls them again against a
// copy of the source with the rule cut.
const probes = {
  async autoHide() { const p = await cat(); return AUTO_HIDDEN.every((s) => !slugs(p).includes(s)) && !slugs(p).includes('zz-inactive') && slugs(p).includes('zz-men-a') },
  async hiddenSlug() { await reset(); await save({ hidden_slugs: ['zz-men-a'] }); const p = await cat(); await reset(); return !slugs(p).includes('zz-men-a') && slugs(p).includes('zz-men-b') },
  async hiddenCategory() { await reset(); await save({ hidden_categories: ['women'] }); const p = await cat(); await reset(); return !p.products.some((x) => x.category === 'women') && !p.categories.some((c) => c.slug === 'women') && p.products.length > 0 },
  async soldOut() { await reset(); const a = await cat(); await save({ show_sold_out: false }); const b = await cat(); await reset(); return slugs(a).includes('zz-women-b') && !slugs(b).includes('zz-women-b') && slugs(b).includes('zz-women-a') },
  async pinned() {
    await reset(); await save({ pinned_slugs: ['zz-acc-a', 'zz-out-a'] }); const p = await cat(); await reset()
    return slugs(p).slice(0, 2).join() === 'zz-acc-a,zz-out-a' && p.products[0].pinned === true && p.products.filter((x) => x.pinned).length === 2
  },
  async categoryOrder() { await reset(); await save({ categories_order: ['accessories', 'men'] }); const p = await cat(); await reset(); return p.categories.map((c) => c.slug).slice(0, 2).join() === 'accessories,men' && p.products.find((x) => !x.featured).category === 'accessories' },
  async noQuantity() {
    const raw = await (await pub()).text(); const adminRaw = (await admin('catalogue_settings')).text
    // a KEY called stock / qty / quantity / sku / cost*, or a seeded value (the 4711 count, the SKU text, the two costs); "sku" as a reason TOKEN is fine
    const re = /4711|SKU-SECRET|12\.34|3\.456|"(stock|qty|quantity|sku|cost[a-z_]*)":/i
    return !re.test(raw) && !re.test(adminRaw)
  },
  async revisionStable() { const a = await cat(); await new Promise((r) => setTimeout(r, 1100)); const b = await cat(); return a.revision === b.revision && a.generated_at !== b.generated_at },
  async revisionSetting() { await reset(); const a = await cat(); await save({ title_en: 'Rev Test' }); const b = await cat(); await reset(); return a.revision !== b.revision },
  async etag304() { const a = await pub(); const r = await pub('r=catalogue', { headers: { 'If-None-Match': a.headers.get('etag') } }); return r.status === 304 && (await r.text()) === '' },
  async etagGzip() { const a = await pub(); const e = a.headers.get('etag'); const r = await pub('r=catalogue', { headers: { 'If-None-Match': e.replace(/"$/, '-gzip"') } }); return r.status === 304 },
  async etagWeak() { const a = await pub(); const r = await pub('r=catalogue', { headers: { 'If-None-Match': 'W/' + a.headers.get('etag') } }); return r.status === 304 },
  async etagWrong() { const r = await pub('r=catalogue', { headers: { 'If-None-Match': '"000000000000"' } }); return r.status === 200 && (await r.json()).count > 0 },
  async rateLimit() {
    await sql('delete from rate_limit'); let last = 0
    for (let i = 0; i < 125; i++) { last = (await pub('r=catalogue', { keepLimit: true })).status; if (last === 429) break }
    await sql('delete from rate_limit'); return last === 429
  },
  async stripTags() { await reset(); const r = await save({ title_en: '<b>Hi</b> there' }); await reset(); return r.status === 200 && r.body.settings.title_en === 'Hi there' },
  async perPageStrict() { await reset(); const r = await save({ per_page: 7 }); await reset(); return r.status === 400 && r.body.error === 'invalid_per_page' },
  async noHalfSave() {
    await reset(); await save({ title_en: 'Before' }); const r = await save({ title_en: 'After', per_page: 7 }); const g = await admin('catalogue_settings'); await reset()
    return r.status === 400 && g.body.settings.title_en === 'Before'
  },
  async activityRow() { await reset(); const a = await events(); await save({ title_en: 'Logged' }); const b = await events(); await reset(); return b === a + 1 },
  async photoExists() { const p = await cat(); const g = p.products.find((x) => x.slug === 'zz-ghost'); return g.image === '/images/products/zz-ghost.jpg' },
  async smallCopy() { const p = await cat(); const a = p.products.find((x) => x.slug === 'zz-men-a'), b = p.products.find((x) => x.slug === 'zz-men-b'); return a.image_small === '/images/products/responsive/zz-men-a-640.webp' && b.image_small === null },
  async ldEscaped() { const ld = ldOf(await seoPage('/catalogue?lang=en')); return ld !== null && !/<|>|&|'/.test(ld.raw) && ld.json.mainEntity.itemListElement.some((i) => i.item.name.includes('</script>')) },
  async ldOnlyCatalogue() { for (const p of ['/', '/shop', '/about', '/product/zz-men-a']) if (/data-sporta-ssr-catalogue/.test(await seoPage(p))) return false; return ldOf(await seoPage('/catalogue')) !== null },
  async ldNoPrices() { await reset(); await save({ show_prices: false }); const ld = ldOf(await seoPage('/catalogue?lang=en')); await reset(); return ld !== null && ld.json.mainEntity.itemListElement.every((i) => !('offers' in i.item)) },
  async ldTitle() { await reset(); await save({ title_en: 'Owner Catalogue Title', intro_en: 'Owner intro words' }); const h = await seoPage('/catalogue?lang=en'); await reset(); return /<title>Owner Catalogue Title — Sporta<\/title>/.test(h) && /name="description" content="Owner intro words"/.test(h) },
}

// ================================================================================================================ DEFAULTS
head('DEFAULTS: no settings row is today\'s page')
await reset()
{
  const res = await pub()
  const p = await res.json()
  const old = await (await pub('r=products')).json()
  is(res.status === 200 && /^[0-9a-f]{12}$/.test(p.revision) && /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(p.generated_at), 'the route answers 200 with a 12-hex revision and a UTC generated_at', `${res.status} ${p.revision}`)
  is(JSON.stringify(Object.keys(p)) === JSON.stringify(['revision', 'generated_at', 'count', 'settings', 'categories', 'brands', 'products']), 'the top-level keys are the contract\'s, in its order', Object.keys(p).join())
  is(JSON.stringify(p.settings) === JSON.stringify({ title_ar: '', title_en: '', intro_ar: '', intro_en: '', note_ar: '', note_en: '', show_prices: true, show_sold_out: true, show_sizes: true, show_brand: true, cover: true, per_page: 9 }), 'the default settings: no wording, every switch on, 9 a page', JSON.stringify(p.settings))
  is(p.count === p.products.length && p.count === LISTED.length, 'count equals the products listed', `${p.count} / ${p.products.length} / ${LISTED.length}`)
  is([...slugs(p)].sort().join() === [...old.map((x) => x.slug)].sort().join() && [...slugs(p)].sort().join() === [...LISTED].sort().join(), 'with defaults the catalogue lists EXACTLY what ?r=products lists (the shop\'s own AUTO-HIDE listing)')
  const off = p.products.filter((x) => { const o = old.find((y) => y.slug === x.slug); return !(o && o.price === x.price && o.list_price === x.list_price && o.on_sale === x.on_sale && o.featured === x.featured && o.category.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') === x.category) }).map((x) => x.slug)
  is(off.length === 0, 'price, list price, sale state, featured and category agree with ?r=products for every product', off.join())
  const byCat = (s) => p.products.filter((x) => x.category === s).length
  is(p.categories.map((c) => c.slug).join() === 'men,women,outerwear,accessories,sport-extras', 'default category order: men, women, hoodies and jackets, accessories, then any other', p.categories.map((c) => c.slug).join())
  is(p.categories.every((c) => c.count === byCat(c.slug) && c.name_ar && c.name_en), 'every category has both names and a count equal to its products')
  is(p.categories[2].name_en === 'Hoodies & Jackets' && p.categories[2].name_ar === 'هوديز وجواكيت' && p.categories[4].name_en === 'Sport extras', 'known names, and an unknown category is the slug made readable')
  const order = p.products.filter((x) => !x.featured && !x.pinned).map((x) => x.category)
  is(JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => p.categories.findIndex((c) => c.slug === a) - p.categories.findIndex((c) => c.slug === b))), 'products follow the category order (featured ones float above it)')
  const women = p.products.filter((x) => x.category === 'women')
  is(women[0].slug === 'zz-women-a' && women[0].featured === true, 'a featured product comes first inside the order')
  const men = p.products.filter((x) => x.category === 'men').map((x) => x.name_en)
  is(JSON.stringify(men) === JSON.stringify([...men].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))), 'then by name (case-insensitive)', men.join(' | '))
  const b = p.brands
  is(b.map((x) => x.slug).join() === 'nba,vanquish' && b.find((x) => x.slug === 'vanquish').count === 1, 'brands: only active brands with a product in the catalogue (the empty and the switched-off one are left out), by name', JSON.stringify(b.map((x) => [x.slug, x.count])))
  is(/^\/api\/api\.php\?r=brand_logo&slug=vanquish&v=[0-9a-f]{12}$/.test(b.find((x) => x.slug === 'vanquish').logo) && b.find((x) => x.slug === 'nba').logo === null && b.find((x) => x.slug === 'nba').name_ar === 'إن بي إيه', 'a brand carries its logo URL (the hashed brand_logo route) or null, and its Arabic name')
  const logo = await fetch(`http://127.0.0.1:${API_PORT}${b.find((x) => x.slug === 'vanquish').logo}`)
  is(logo.status === 200 && logo.headers.get('content-type') === 'image/png', 'and that URL serves the logo')
  is(p.products.find((x) => x.slug === 'zz-extra-a').brand === null && p.products.find((x) => x.slug === 'zz-men-a').brand === 'vanquish', 'a product of a switched-off brand has no brand')
  const bravo = p.products.find((x) => x.slug === 'zz-men-b'), charlie = p.products.find((x) => x.slug === 'zz-men-c')
  is(bravo.price === 10 && bravo.list_price === 12.5 && bravo.pct_off === 20 && bravo.on_sale === true, 'a live sale: price is the sale price, list_price the struck one, pct_off rounded', JSON.stringify([bravo.price, bravo.list_price, bravo.pct_off]))
  is(charlie.price === 8 && charlie.on_sale === false && charlie.pct_off === 0, 'an ended sale is no sale (the window is resolved on the server)')
  is((await pub('r=catalogue', { method: 'HEAD' })).status === 200, 'HEAD answers 200')
}

// ================================================================================================================ LISTING
head('LISTING: AUTO-HIDE, owner hide, sold-out')
{
  const p = await cat()
  for (const s of AUTO_HIDDEN) is(!slugs(p).includes(s), `${s} (AUTO-HIDE) is absent`)
  is(!slugs(p).includes('zz-inactive'), 'an inactive product is absent')
  is(await probes.autoHide(), 'probe: AUTO-HIDE products absent, a complete product present')
  const sizes = p.products.find((x) => x.slug === 'zz-men-a').sizes
  is(JSON.stringify(sizes) === JSON.stringify([{ size: 'M', in_stock: true }, { size: 'L', in_stock: false }]) && p.products.find((x) => x.slug === 'zz-men-a').in_stock === true, 'sizes carry a stock STATE only (S M L XL ... ONE order), and the product is in stock when one size is', JSON.stringify(sizes))
  const w = p.products.find((x) => x.slug === 'zz-women-a').sizes.map((x) => x.size)
  is(w.join() === 'M,2XL', 'XXL is folded to 2XL like everywhere else', w.join())
  is(p.products.find((x) => x.slug === 'zz-women-b').in_stock === false && p.products.find((x) => x.slug === 'zz-women-b').sizes.every((x) => x.in_stock === false), 'a product with every size at 0 is sold out and says so')
  is(p.products.find((x) => x.slug === 'zz-women-b') !== undefined, 'a sold-out product stays in by default')
  is(await probes.soldOut(), 'probe: show_sold_out=false removes sold-out products, true keeps them')
  is(await probes.hiddenSlug(), 'probe: an owner-hidden slug is absent')
  is(await probes.hiddenCategory(), 'probe: an owner-hidden category removes its products and its chip')
  // the SKU rule (ON in this private config) reads the same table the shop reads
  await sql("insert into product_variants (sku, slug, size, stock) values ('SKU-SECRET-zz-nosku-M', 'zz-nosku', 'M', 1)")
  is(slugs(await cat()).includes('zz-nosku'), 'giving the SKU-less product a size row lists it (nothing was deleted, the row just came back)')
  await sql("delete from product_variants where slug = 'zz-nosku'")
  is(!slugs(await cat()).includes('zz-nosku'), 'and taking it away hides it again')
  // a sale-priced product with no list price above zero is still hidden by the price rule
  await sql("update products set price = 0, sale_price = 4 where slug = 'zz-acc-a'")
  is(!slugs(await cat()).includes('zz-acc-a'), 'a sale price never rescues a missing base price')
  await sql("update products set price = 5, sale_price = null where slug = 'zz-acc-a'")
}

// ================================================================================================================ ORDER
head('ORDER: pinned, featured, category order')
is(await probes.pinned(), 'probe: pinned products come first in the owner\'s order and are marked pinned')
is(await probes.categoryOrder(), 'probe: categories_order puts the owner\'s categories first, products follow')
{
  await reset(); await save({ pinned_slugs: ['zz-acc-a'], categories_order: ['outerwear'] })
  const p = await cat()
  is(p.products[0].slug === 'zz-acc-a' && p.products[1].slug === 'zz-women-a' && p.products[2].category === 'outerwear', 'pinned, then featured, then the owner\'s category order', slugs(p).slice(0, 4).join())
  is(p.categories.map((c) => c.slug).join() === 'outerwear,men,women,accessories,sport-extras', 'categories: the owner\'s first, the rest in the default order', p.categories.map((c) => c.slug).join())
  await reset()
}

// ================================================================================================================ PHOTOS
head('PHOTOS: files that exist')
{
  const p = await cat()
  const a = p.products.find((x) => x.slug === 'zz-men-a'), db = p.products.find((x) => x.slug === 'zz-dbimg'), ghost = p.products.find((x) => x.slug === 'zz-ghost')
  is(a.image === '/images/products/zz-men-a.jpg' && a.images.join() === '/images/products/zz-men-a.jpg,/images/products/zz-men-a.png,/images/products/zz-men-a-view-2.jpg', 'the main photo is the slug\'s file (jpg before png), the views follow', a.images.join())
  is(a.images.includes('/images/products/zz-men-a-view-2.jpg') && a.images.length === 3, 'every photo of the product that exists is listed (main, the other type, the view)')
  is(db.image === '/images/products/zz-dbimg-upload-ab12cd34ef.jpg' && db.images.join() === '/images/products/zz-dbimg-upload-ab12cd34ef.jpg,/images/products/zz-dbimg-extra.png', 'an uploaded photo named by products.image comes first and its extra pictures follow', db.images.join())
  is(await probes.photoExists(), 'probe: a products.image whose file is gone falls back to the slug\'s own file (the client never probes names)')
  is(await probes.smallCopy(), 'probe: image_small is the 640 px copy only when that file exists')
  await sql("update products set image = '//evil.example/x.jpg', images = '/images/../../etc/passwd.jpg,data:image/png;base64,AAA,/images/products/zz-dbimg-extra.png' where slug = 'zz-ghost'")
  const g = (await cat()).products.find((x) => x.slug === 'zz-ghost')
  is(g.images.includes('/images/products/zz-ghost.jpg') && g.images.length === 2 && g.images.every((x) => /^\/images\/products\/[A-Za-z0-9_.-]+$/.test(x)), 'an off-site, traversal or data: picture value is never advertised (only real files of the media folder are)', g.images.join())
  await sql("update products set image = '/images/products/zz-ghost-missing.jpg', images = null where slug = 'zz-ghost'")
}

// ================================================================================================================ NO SECRETS
head('NO SECRETS: nothing but the contract\'s keys')
{
  const p = await cat()
  const ALLOW = {
    top: ['revision', 'generated_at', 'count', 'settings', 'categories', 'brands', 'products'],
    settings: ['title_ar', 'title_en', 'intro_ar', 'intro_en', 'note_ar', 'note_en', 'show_prices', 'show_sold_out', 'show_sizes', 'show_brand', 'cover', 'per_page'],
    category: ['slug', 'name_ar', 'name_en', 'count'], brand: ['slug', 'name_ar', 'name_en', 'logo', 'count'],
    product: ['slug', 'name_ar', 'name_en', 'category', 'brand', 'price', 'list_price', 'pct_off', 'on_sale', 'featured', 'pinned', 'in_stock', 'sizes', 'image', 'image_small', 'images'],
    size: ['size', 'in_stock'],
  }
  const same = (got, want) => JSON.stringify([...got].sort()) === JSON.stringify([...want].sort())
  is(same(Object.keys(p), ALLOW.top) && same(Object.keys(p.settings), ALLOW.settings), 'top-level and settings keys are exactly the contract\'s')
  is(p.categories.every((c) => same(Object.keys(c), ALLOW.category)) && p.brands.every((c) => same(Object.keys(c), ALLOW.brand)), 'category and brand keys are exactly the contract\'s')
  is(p.products.every((x) => same(Object.keys(x), ALLOW.product) && x.sizes.every((s) => same(Object.keys(s), ALLOW.size))), 'every product and size has exactly the contract\'s keys (walked: no quantity, SKU, cost, customer or admin list)')
  const walk = (v, path = '') => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [path + '.' + k, ...walk(x, path + '.' + k)]) : [])
  const keys = walk(p).map((k) => k.split('.').pop())
  is(!keys.some((k) => /^(stock|qty|quantity|sku|cost|cost_aed|unit_cost_kwd|customer|email|phone|hidden_slugs|pinned_slugs|hidden_categories|categories_order)$/i.test(k)), 'no key anywhere is a stock, quantity, SKU, cost, customer or the owner\'s private lists')
  is(await probes.noQuantity(), 'probe: the seeded stock count (4711), SKUs and costs appear nowhere in the public or the admin answer')
  const adminRes = await admin('catalogue_settings')
  is(!adminRes.text.includes(DB_PASS) && !adminRes.text.includes('cron-key') && !adminRes.text.includes(cookie.split('=')[1] ?? 'x!'), 'the admin answer carries no password, cron key or session id')
}

// ================================================================================================================ REVISION
head('REVISION: changes if, and only if, something visible changes')
{
  is(await probes.revisionStable(), 'probe: the revision is stable across calls (generated_at moves, the revision does not)')
  const rev = async () => (await cat()).revision
  const r0 = await rev()
  await sql("update product_variants set stock = 4 where slug = 'zz-men-a' and size = 'M'")
  is((await rev()) === r0, 'a stock COUNT that stays in the same state (4711 -> 4) does not change it (and shows the count is not in the payload)')
  await sql("update products set desc_en = 'a brand new description nobody sees here' where slug = 'zz-men-a'")
  is((await rev()) === r0, 'a description (not in the payload) does not change it')
  await sql("update product_variants set cost_aed = 99 where slug = 'zz-men-a'")
  is((await rev()) === r0, 'a cost does not change it')
  await sql("update products set price = 11 where slug = 'zz-men-a'")
  const r1 = await rev(); is(r1 !== r0, 'a price change does')
  await sql("update product_variants set stock = 0 where slug = 'zz-men-a' and size = 'M'")
  const r2 = await rev(); is(r2 !== r1, 'a size selling out does')
  await sql("update products set name_en = 'Alpha Tee 2' where slug = 'zz-men-a'")
  const r3 = await rev(); is(r3 !== r2, 'a name change does')
  photo('zz-men-a-view-3.jpg')
  const r4 = await rev(); is(r4 !== r3, 'a new photo file does')
  await sql("update products set sale_price = 9, sale_ends_at = null where slug = 'zz-men-a'")
  const r5 = await rev(); is(r5 !== r4, 'a sale starting does')
  await sql("update products set featured = 1 where slug = 'zz-men-b'")
  const r6 = await rev(); is(r6 !== r5, 'a product becoming featured (the order changes) does')
  await sql("update product_variants set stock = 4711 where slug = 'zz-men-a' and size = 'M'; update products set price = 10, name_en = 'Alpha Tee', sale_price = null, featured = 0 where slug = 'zz-men-a'; update products set featured = 0 where slug = 'zz-men-b'")
  unlinkSync(join(photoDir, 'zz-men-a-view-3.jpg'))
  is((await rev()) === r0, 'putting everything back gives the first revision again (it is a function of what is visible)')
  is(await probes.revisionSetting(), 'probe: a setting change changes it')
  await reset()
}

// ================================================================================================================ 304
head('304: the ETag')
{
  const res = await pub()
  const etag = res.headers.get('etag'), rev = (await res.json()).revision
  is(etag === `"${rev}"` && res.headers.get('cache-control') === 'no-cache', 'a 200 carries ETag "<revision>" and Cache-Control: no-cache', `${etag} ${res.headers.get('cache-control')}`)
  const ok = await pub('r=catalogue', { headers: { 'If-None-Match': etag } })
  is(ok.status === 304 && (await ok.text()) === '' && ok.headers.get('etag') === etag && ok.headers.get('cache-control') === 'no-cache', 'the right validator answers 304, no body, the same ETag and no-cache')
  is(await probes.etagGzip(), 'probe: "<rev>-gzip" (what mod_deflate makes the browser send back) answers 304')
  const br = await pub('r=catalogue', { headers: { 'If-None-Match': etag.replace(/"$/, '-br"') } })
  is(br.status === 304, '"<rev>-br" answers 304')
  is(await probes.etagWeak(), 'probe: W/"<rev>" answers 304')
  is((await pub('r=catalogue', { headers: { 'If-None-Match': `"zzz", ${etag.replace(/"$/, '-gzip"')}` } })).status === 304, 'a list of validators with the right one answers 304')
  is((await pub('r=catalogue', { headers: { 'If-None-Match': '*' } })).status === 304, '* answers 304')
  is(await probes.etagWrong(), 'probe: a wrong validator answers 200 with the body')
  is((await pub('r=catalogue', { headers: { 'If-None-Match': '"' + rev.slice(0, 11) + '"' } })).status === 200 && (await pub('r=catalogue', { headers: { 'If-None-Match': etag.replace('"', '"x') } })).status === 200, 'a near-miss validator is not a match')
  await sql("update products set price = 11.5 where slug = 'zz-men-b'")
  is((await pub('r=catalogue', { headers: { 'If-None-Match': etag } })).status === 200, 'after a visible change the old validator is a 200 again')
  await sql("update products set price = 12.5 where slug = 'zz-men-b'")
  const head1 = await pub('r=catalogue', { method: 'HEAD' })
  is(head1.status === 200 && head1.headers.get('etag') === etag && (await head1.text()) === '', 'HEAD carries the ETag and no body')
  const post1 = await pub('r=catalogue', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  is(post1.status === 405, 'POST is refused (405)', `${post1.status}`)
  is(post1.headers.get('etag') === null, 'an error answer carries no ETag')
  is((await pub('r[]=catalogue')).status === 404, 'r[]=catalogue is the empty route, not the catalogue')
  is(await probes.rateLimit(), 'probe: the 121st request in a minute is a 429 (the route is throttled like content, 120 a minute)')
  await sql('delete from rate_limit')
}

// ================================================================================================================ SETTINGS
head('SETTINGS: the admin read and save')
await reset()
{
  const no1 = await admin('catalogue_settings', { noCookie: true }), no2 = await post('catalogue_settings_save', { title_en: 'x' }, { noCookie: true })
  is(no1.status === 401 && no2.status === 401, 'with no session both routes answer 401', `${no1.status} ${no2.status}`)
  const hd = await post('catalogue_settings_save', { title_en: 'NoHeader' }, { noHeader: true })
  is(hd.status === 400 || hd.status === 403, 'a save without the X-Sporta-Admin header is refused', `${hd.status}`)
  const ct = await admin('catalogue_settings_save', { method: 'POST', body: JSON.stringify({ title_en: 'x' }), contentType: 'text/plain' })
  is(ct.status === 403 || ct.status === 415, 'a body that is not application/json is refused', `${ct.status}`)
  is((await sql("select count(*) from settings where name = 'catalogue'")) === '0', 'and none of them wrote anything')
  const bigBody = await admin('catalogue_settings_save', { method: 'POST', body: JSON.stringify({ title_en: 'x'.repeat(70000) }) })
  is(bigBody.status === 413 || bigBody.status === 400, 'a body over 64 KB is refused', `${bigBody.status}`)

  const g = await admin('catalogue_settings')
  const b = g.body
  is(g.status === 200 && JSON.stringify(b.settings) === JSON.stringify(b.defaults), 'the read: the settings equal the defaults when nothing is saved', JSON.stringify(b.settings))
  is(b.defaults.per_page === 9 && b.defaults.hidden_slugs.length === 0 && b.limits.per_page.join() === '6,9,12' && b.limits.title === 80, 'the read carries the defaults and the limits (the editor holds no copy of the rules)')
  is(b.products.length === 16 && b.products.some((x) => x.slug === 'zz-inactive'), 'the read lists EVERY product (16 fixtures), listed or not')
  const reason = (s) => b.products.find((x) => x.slug === s).hidden_reasons.join()
  is(reason('zz-noname') === 'name' && reason('zz-free') === 'price' && reason('zz-nophoto') === 'photo' && reason('zz-nosku') === 'sku' && reason('zz-men-a') === '', 'each AUTO-HIDE product says why (name, price, photo, sku) and a complete one says nothing', [reason('zz-noname'), reason('zz-free'), reason('zz-nophoto'), reason('zz-nosku')].join('|'))
  is(b.products.find((x) => x.slug === 'zz-men-a').listed === true && b.products.find((x) => x.slug === 'zz-noname').listed === false && b.products.find((x) => x.slug === 'zz-inactive').listed === false && b.products.find((x) => x.slug === 'zz-inactive').active === false, 'listed and active are told apart')
  is(b.products.filter((x) => x.in_catalogue).length === LISTED.length, 'in_catalogue is the public list')
  is(b.share.page.ar === 'https://www.sporta.com.kw/catalogue' && b.share.page.en === 'https://www.sporta.com.kw/catalogue?lang=en' && b.share.pdf.ar === 'https://www.sporta.com.kw/catalogue?pdf=ar' && b.share.pdf.en === 'https://www.sporta.com.kw/catalogue?pdf=en', 'share links: the page and the live PDF in both languages', JSON.stringify(b.share.page) + JSON.stringify(b.share.pdf))
  is(b.share.categories.find((c) => c.slug === 'men').pdf.en === 'https://www.sporta.com.kw/catalogue?cat=men&pdf=en' && b.share.categories.find((c) => c.slug === 'men').page.en === 'https://www.sporta.com.kw/catalogue?cat=men&lang=en' && b.share.brands.find((c) => c.slug === 'vanquish').page.ar === 'https://www.sporta.com.kw/catalogue?brand=vanquish', 'and per category and per brand')
  is(b.status.in_catalogue === LISTED.length && b.status.listed === LISTED.length && b.status.on_sale === 1 && b.status.sold_out === 1 && b.status.hidden_by_rules === 4 && b.status.hidden_by_owner === 0 && b.status.revision === (await cat()).revision, 'status: counts, sale, sold out, hidden, and the live revision', JSON.stringify(b.status))
  is(b.categories.map((c) => c.slug).join() === 'men,women,outerwear,accessories,sport-extras' && b.categories.find((c) => c.slug === 'men').count === 4, 'the editor\'s categories (listed products) in the effective order', b.categories.map((c) => c.slug + c.count).join())

  // a good save
  const ev0 = await events()
  const s1 = await save({ title_ar: 'كتالوج سبورتا', title_en: '<b>Sporta</b>   Catalogue', intro_en: 'Line one\nLine two', note_ar: 'ملاحظة', per_page: 12, show_sizes: false })
  is(s1.status === 200 && s1.body.settings.title_en === 'Sporta Catalogue' && s1.body.settings.intro_en === 'Line one Line two' && s1.body.settings.per_page === 12 && s1.body.settings.show_sizes === false && s1.body.settings.show_prices === true, 'a good save is stored whitelisted (tags stripped, spaces collapsed, newline removed) and the answer is the new read', JSON.stringify(s1.body?.settings))
  is((await events()) === ev0 + 1, 'the save left exactly one row in the admin activity log')
  const pubSet = (await cat()).settings
  is(pubSet.title_ar === 'كتالوج سبورتا' && pubSet.title_en === 'Sporta Catalogue' && pubSet.per_page === 12 && pubSet.show_sizes === false, 'the public route carries the saved wording and switches immediately')
  is(!('hidden_slugs' in pubSet) && !('pinned_slugs' in pubSet), 'the public settings are the PUBLIC subset (no hidden or pinned lists)')
  const s2 = await save({ show_prices: false })
  is(s2.status === 200 && s2.body.settings.title_en === 'Sporta Catalogue' && s2.body.settings.per_page === 12 && s2.body.settings.show_prices === false, 'a field the request leaves out keeps its value (a tab saves only its own)')
  const s3 = await save({ settings: { note_en: 'wrapped' } })
  is(s3.status === 200 && s3.body.settings.note_en === 'wrapped' && s3.body.settings.show_prices === false, '{"settings": {...}} is accepted as well')
  const s4 = await save({ show_prices: 1, per_page: '6' })
  is(s4.status === 200 && s4.body.settings.show_prices === true && s4.body.settings.per_page === 6, '1 / 0 and a digit string are accepted for a switch and per_page')
  await reset()

  // refusals: each is a 400 with its own token and changes nothing
  await save({ title_en: 'Keep me', hidden_slugs: ['zz-men-b'] })
  const before = await sql("select value from settings where name = 'catalogue'")
  const evR = await events()
  const bad = [
    ['a title over 80 characters', { title_en: 'x'.repeat(81) }, 'invalid_title_en'],
    ['an intro over 400 characters', { intro_ar: 'ن'.repeat(401) }, 'invalid_intro_ar'],
    ['a note over 200 characters', { note_en: 'y'.repeat(201) }, 'invalid_note_en'],
    ['a title that is not a string', { title_ar: 5 }, 'invalid_title_ar'],
    ['a title that is an array', { title_ar: ['a'] }, 'invalid_title_ar'],
    ['per_page 7', { per_page: 7 }, 'invalid_per_page'],
    ['per_page "nine"', { per_page: 'nine' }, 'invalid_per_page'],
    ['per_page null', { per_page: null }, 'invalid_per_page'],
    ['show_prices "false" (a string would have switched it on)', { show_prices: 'false' }, 'invalid_show_prices'],
    ['show_sold_out null', { show_sold_out: null }, 'invalid_show_sold_out'],
    ['cover 2', { cover: 2 }, 'invalid_cover'],
    ['hidden_slugs not a list', { hidden_slugs: 'zz-men-a' }, 'invalid_hidden_slugs'],
    ['hidden_slugs with an object', { hidden_slugs: { a: 'zz-men-a' } }, 'invalid_hidden_slugs'],
    ['hidden_slugs with a slug that does not exist', { hidden_slugs: ['no-such-product'] }, 'unknown_product'],
    ['pinned_slugs with a bad slug', { pinned_slugs: ['../x'] }, 'invalid_pinned_slugs'],
    ['pinned_slugs with a number', { pinned_slugs: [7] }, 'invalid_pinned_slugs'],
    ['pinned_slugs with 3 slugs that do not exist', { pinned_slugs: ['zz-bulk-1', 'zz-bulk-2', 'zz-bulk-3'] }, 'unknown_product'],
    ['categories_order with an unknown category', { categories_order: ['nonexistent'] }, 'unknown_category'],
    ['hidden_categories with a bad slug', { hidden_categories: ['Men'] }, 'invalid_hidden_categories'],
    ['a valid title, then the last field wrong (no half-save)', { title_en: 'Half saved', hidden_categories: 'x' }, 'invalid_hidden_categories'],
  ]
  for (const [label, body, token] of bad) {
    const r = await save(body)
    is(r.status === 400 && r.body?.error === token, `refused: ${label}`, `${r.status} ${r.text.slice(0, 80)}`)
  }
  is((await sql("select value from settings where name = 'catalogue'")) === before, 'after all of those the stored row is byte-for-byte what it was (nothing half-saved)')
  is((await events()) === evR, 'and a refused save leaves no activity row')
  is(await probes.stripTags(), 'probe: markup is stripped from a saved string')
  is(await probes.perPageStrict(), 'probe: per_page must be 6, 9 or 12')
  is(await probes.noHalfSave(), 'probe: a valid title next to an invalid per_page is not saved')
  is(await probes.activityRow(), 'probe: a save leaves one activity row')
  const dup = await save({ pinned_slugs: ['zz-acc-a', 'zz-acc-a', 'zz-out-a'] })
  is(dup.status === 200 && dup.body.settings.pinned_slugs.join() === 'zz-acc-a,zz-out-a', 'duplicate slugs are folded, the order kept')
  const full = await save({ hidden_slugs: ['zz-men-a'], pinned_slugs: [], categories_order: ['accessories'], hidden_categories: ['sport-extras'] })
  is(full.status === 200 && full.body.products.find((x) => x.slug === 'zz-men-a').hidden_from_catalogue === true && full.body.products.find((x) => x.slug === 'zz-men-a').in_catalogue === false && full.body.products.find((x) => x.slug === 'zz-extra-a').category_hidden === true && full.body.status.hidden_by_owner === 2 && full.body.status.in_catalogue === LISTED.length - 2, 'the read shows an owner-hidden product and category as such', JSON.stringify(full.body.status))
  is(full.body.categories.find((c) => c.slug === 'sport-extras').hidden === true, 'a hidden category stays in the editor\'s list, marked hidden (so it can be shown again)')
  await reset()

  // a damaged stored row reads as the default of each field, never as "off"
  await sql(`insert into settings (name, value) values ('catalogue', ${q(JSON.stringify({ per_page: 99, show_prices: 'off', show_sold_out: false, title_en: 5, intro_en: 'x'.repeat(500), intro_ar: 'y'.repeat(5000), hidden_slugs: 'oops', pinned_slugs: ['zz-acc-a', 'ghost-slug', 7, '../x'], categories_order: ['nonexistent', 'accessories'], hidden_categories: { a: 1 }, surprise: true }))})`)
  const dm = await cat(), dr = (await admin('catalogue_settings')).body.settings
  is(dm.settings.per_page === 9 && dm.settings.show_prices === true && dm.settings.title_en === '' && dm.settings.intro_en.length === 400 && dm.settings.intro_ar === '', 'a damaged row: a bad per_page, switch or title reads as the default, a long intro is cut to its limit, an absurd one is the default', JSON.stringify(dm.settings))
  is(dm.settings.show_sold_out === false && !slugs(dm).includes('zz-women-b'), 'while its valid fields still apply (show_sold_out false)')
  is(dr.hidden_slugs.length === 0 && dr.pinned_slugs.join() === 'zz-acc-a' && dr.categories_order.join() === 'accessories' && dr.hidden_categories.length === 0 && !('surprise' in dr), 'bad lists read empty, unknown and malformed slugs are dropped, unknown keys are never carried', JSON.stringify(dr))
  is(dm.products[0].slug === 'zz-acc-a' && dm.products.length > 0, 'and the catalogue is NOT hidden by a damaged row')
  await sql("update settings set value = 'not json at all' where name = 'catalogue'")
  const dm2 = await cat()
  is(dm2.count === LISTED.length && dm2.settings.per_page === 9, 'a row that is not JSON at all is the defaults')
  await reset()
}

// ================================================================================================================ JSON-LD
head('JSON-LD: what a crawler reads without a script')
{
  const route = await cat()
  for (const lang of ['ar', 'en']) {
    const html = await seoPage(lang === 'ar' ? '/catalogue' : '/catalogue?lang=en')
    const ld = ldOf(html)
    is(ld !== null && (html.match(/application\/ld\+json/g) ?? []).length === 1, `${lang}: exactly one JSON-LD block, parsed as JSON`)
    const j = ld.json
    is(j['@context'] === 'https://schema.org' && j['@type'] === 'CollectionPage' && j.mainEntity['@type'] === 'ItemList' && j.inLanguage === lang, `${lang}: a CollectionPage with an ItemList`)
    is(j.url === (lang === 'ar' ? 'https://www.sporta.com.kw/catalogue' : 'https://www.sporta.com.kw/catalogue?lang=en') && j.name && j.description, `${lang}: url, name and description`, j.url)
    const items = j.mainEntity.itemListElement
    is(j.mainEntity.numberOfItems === items.length && items.length === route.count, `${lang}: numberOfItems is the number of items, equal to the route's count`, `${items.length} / ${route.count}`)
    is(items.every((i, n) => i['@type'] === 'ListItem' && i.position === n + 1), `${lang}: positions run 1..n`)
    is(items.map((i) => i.item.url.replace('https://www.sporta.com.kw/product/', '').replace('?lang=en', '')).join() === slugs(route).join(), `${lang}: the same products in the same order as ?r=catalogue`)
    const first = items[0].item, rp = route.products[0]
    is(first.name === rp[lang === 'ar' ? 'name_ar' : 'name_en'] && first.url.endsWith(lang === 'en' ? '?lang=en' : rp.slug), `${lang}: names and product URLs are in the page's language`, first.name)
    is(first.image === 'https://www.sporta.com.kw' + rp.image && first.offers['@type'] === 'Offer' && first.offers.priceCurrency === 'KWD' && first.offers.price === rp.price.toFixed(3) && /^https:\/\/schema\.org\/(In|OutOf)Stock$/.test(first.offers.availability), `${lang}: image, and offers with price (3 decimals), KWD and availability`, JSON.stringify(first.offers))
    const sold = items.find((i) => i.item.url.includes('zz-women-b')), instock = items.find((i) => i.item.url.includes('zz-women-a'))
    is(sold.item.offers.availability === 'https://schema.org/OutOfStock' && instock.item.offers.availability === 'https://schema.org/InStock', `${lang}: a sold-out product is OutOfStock`)
    is(items.find((i) => i.item.url.includes('zz-men-b')).item.offers.price === '10.000', `${lang}: a sale product is quoted at its sale price`)
  }
  is(await probes.ldEscaped(), 'probe: the block holds no raw < > & or \' (an evil product name cannot close the script tag)')
  const rawAr = ldOf(await seoPage('/catalogue?lang=en')).raw
  is(/\\u003C(\\\/|\/)?script/i.test(rawAr), 'the markup characters are hex-escaped, and the JSON still parses back to the original name')
  is(await probes.ldOnlyCatalogue(), 'probe: only /catalogue has the block (not /, /shop, /about or a product page)')
  is(ldOf(await seoPage('/catalogue/')) !== null, '/catalogue/ (trailing slash) has it too')
  is(await probes.ldNoPrices(), 'probe: with show_prices off the structured data carries no offers')
  is(await probes.ldTitle(), 'probe: the owner\'s title and intro are the head\'s title and description (the SEO screen\'s override still outranks them)')
  await reset(); await save({ title_ar: 'عنوان المالك', intro_ar: 'مقدمة المالك' })
  const ar = await seoPage('/catalogue')
  is(/<title>عنوان المالك — سبورتا<\/title>/.test(ar) && /content="مقدمة المالك"/.test(ar), 'Arabic: the same, with the Arabic suffix')
  await reset()
  const e1 = (await fetch(SITE + '/catalogue')).headers.get('etag')
  await sql("update products set price = 7 where slug = 'zz-acc-a'")
  const e2 = (await fetch(SITE + '/catalogue')).headers.get('etag')
  const e304 = await fetch(SITE + '/catalogue', { headers: { 'If-None-Match': e2 } })
  await sql("update products set price = 5 where slug = 'zz-acc-a'")
  is(e1 && e2 && e1 !== e2 && e304.status === 304, 'the page\'s own ETag follows the catalogue (a price change is a new page) and its 304 works')
  const hidden = await save({ hidden_slugs: ['zz-men-a'] })
  const ld2 = ldOf(await seoPage('/catalogue'))
  is(hidden.status === 200 && !ld2.json.mainEntity.itemListElement.some((i) => i.item.url.endsWith('zz-men-a')), 'an owner-hidden product leaves the structured data too')
  await reset()
  // an unknown page, a product page and the home page are untouched
  const home = await seoPage('/?lang=en')
  is(/<title>Sporta \| Sportswear/.test(home) && !/CollectionPage/.test(home), 'the home page head is untouched')
  const missing = await fetch(SITE + '/catalogue/x')
  is(missing.status === 404 && !/CollectionPage/.test(await missing.text()), '/catalogue/x is still the app\'s 404 with no catalogue data')

  // more than 100 products: the cap
  const bulk = Array.from({ length: 205 }, (_, i) => `zz-bulk-${String(i).padStart(3, '0')}`)
  await sql(`insert into products (slug, name_en, name_ar, price, category) values ${bulk.map((s) => `('${s}', 'Bulk ${s}', 'مجموعة', 3.000, 'men')`).join(',')}`)
  await sql(`insert into product_variants (sku, slug, size, stock) values ${bulk.map((s) => `('SKU-B-${s}', '${s}', 'M', 1)`).join(',')}`)
  for (const s of bulk) photo(`${s}.jpg`)
  const big = await cat(), bigLd = ldOf(await seoPage('/catalogue?lang=en'))
  is(big.count === LISTED.length + 205 && bigLd.json.mainEntity.itemListElement.length === 100 && bigLd.json.mainEntity.numberOfItems === 100, 'with 216 products the route lists all and the structured data stops at 100', `${big.count} / ${bigLd.json.mainEntity.itemListElement.length}`)
  is(bigLd.json.mainEntity.itemListElement.map((i) => i.item.url.replace('https://www.sporta.com.kw/product/', '').replace('?lang=en', '')).join() === slugs(big).slice(0, 100).join(), 'and they are the first 100 of the route\'s order')
  const two = await save({ pinned_slugs: bulk.slice(0, 200) }), three = await save({ pinned_slugs: bulk.slice(0, 201) })
  is(two.status === 200 && two.body.settings.pinned_slugs.length === 200 && three.status === 400 && three.body.error === 'invalid_pinned_slugs', 'a list of 200 slugs is saved, 201 is refused (the limit is 200 each)', `${two.status} ${three.status} ${three.body?.error}`)
  await reset()
  await sql("delete from products where slug like 'zz-bulk-%'; delete from product_variants where slug like 'zz-bulk-%'")

  // an empty shop
  const savedProducts = await sql("select count(*) from products")
  await sql('update products set active = 0')
  const empty = await cat(), emptyHtml = await fetch(SITE + '/catalogue')
  const emptyText = await emptyHtml.text()
  is(empty.count === 0 && empty.products.length === 0 && empty.categories.length === 0 && empty.brands.length === 0 && /^[0-9a-f]{12}$/.test(empty.revision), 'an empty shop: count 0, empty lists, still a valid revision')
  is(emptyHtml.status === 200 && !/CollectionPage|data-sporta-ssr-catalogue/.test(emptyText) && /<title>/.test(emptyText), 'and /catalogue still renders its head, with no structured data (nothing is published for an empty list)')
  is(Number(savedProducts) > 0, '(the products were only switched off)')
  await sql('update products set active = 1 where slug not in (\'zz-inactive\')')
  is(await probes.autoHide(), 'switching them back on restores the catalogue')
}

// ================================================================================================================ MUTATIONS
head('MUTATIONS: cut a rule from a copy of the source and the check goes red')
{
  const MUTANTS = [
    ['AUTO-HIDE filter', 'catalogue.php', '$rows = store_filter_listable($db, $rows);', '', 'autoHide'],
    ['owner-hidden slugs', 'catalogue.php', "if (isset($hiddenSlug[$slug])) continue;", '', 'hiddenSlug'],
    ['owner-hidden categories', 'catalogue.php', 'if (isset($hiddenCat[$p[\'category\']])) continue;', '', 'hiddenCategory'],
    ['sold-out removal', 'catalogue.php', "if (!$s['show_sold_out'] && !$p['in_stock']) continue;", '', 'soldOut'],
    ['pinned products', 'catalogue.php', "$p['pinned'] = isset($pinnedPos[$slug]);", "$p['pinned'] = false;", 'pinned'],
    ['the owner\'s category order', 'catalogue.php', "array_merge($settings['categories_order'], STORE_CATALOGUE_DEFAULT_ORDER)", 'STORE_CATALOGUE_DEFAULT_ORDER', 'categoryOrder'],
    ['no quantity in the answer', 'catalogue.php', "'in_stock' => (bool)$in];", "'in_stock' => (bool)$in, 'stock' => 4711];", 'noQuantity'],
    ['revision ignores generated_at', 'catalogue.php', "(string)$json), 0, 12)", "(string)$json . microtime()), 0, 12)", 'revisionStable'],
    ['revision includes the settings', 'catalogue.php', "unset($body['revision'], $body['generated_at']);", "unset($body['revision'], $body['generated_at'], $body['settings']);", 'revisionSetting'],
    ['the 304 itself', 'catalogue.php', "if (store_catalogue_etag_matches((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), $etag)) {", 'if (false) {', 'etag304'],
    ['-gzip / -br stripping', 'catalogue.php', "'~-(gzip|br)\"$~'", "'~-zzz\"$~'", 'etagGzip'],
    ['weak validator stripping', 'catalogue.php', "'~^W/~'", "'~^NEVER/~'", 'etagWeak'],
    ['a wrong validator is not a match', 'catalogue.php', "if ($tag === $etag || $tag === '*') return true;", 'return true;', 'etagWrong'],
    ['the rate limit', 'api.php', "'catalogue'       => [120, 60],", "'catalogue'       => null,", 'rateLimit'],
    ['tag stripping', 'catalogue.php', '$v = strip_tags($v);', '', 'stripTags'],
    ['per_page whitelist', 'catalogue.php', "elseif ($strict) store_fail('invalid_per_page');", '', 'perPageStrict'],
    ['validate before writing', 'catalogue.php', '$clean = store_catalogue_clean($merged, true, $knownProducts, $knownCategories);', "store_setting_save($db, 'catalogue', array_replace($current, array_intersect_key($in, $current))); $clean = store_catalogue_clean($merged, true, $knownProducts, $knownCategories);", 'noHalfSave'],
    ['the activity log entry', 'admin.php', "'site_icon_save', 'site_icon_reset', 'catalogue_settings_save',", "'site_icon_save', 'site_icon_reset',", 'activityRow'],
    ['photo existence check', 'catalogue.php', "&& is_file($root . $one)) $out[] = $one;", ') $out[] = $one;', 'photoExists'],
    ['small copy existence check', 'catalogue.php', "return is_file(dirname(__DIR__) . $rel) ? $rel : null;", 'return $rel;', 'smallCopy'],
    ['JSON-LD escaping', 'seo-page.php', "\">' . json_encode($ld, $jsonFlags) . '</script>'", "\">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>'", 'ldEscaped'],
    ['JSON-LD only on /catalogue', 'seo-page.php', "if ($db !== null && $route['kind'] === 'page' && $route['path'] === '/catalogue') {", "if ($db !== null && $route['kind'] === 'page') {", 'ldOnlyCatalogue'],
    ['JSON-LD prices follow show_prices', 'catalogue.php', 'if ($showPrices) {', 'if (true) {', 'ldNoPrices'],
    ['the owner\'s title in the head', 'seo-page.php', "if ($own !== '') $title = $own", "if (false) $title = $own", 'ldTitle'],
  ]
  for (const [label, file, from, to, probe] of MUTANTS) {
    const path = join(apiDir, file), orig = readFileSync(path, 'utf8')
    const n = orig.split(from).length - 1
    if (n !== 1) { is(false, `mutant "${label}": the source text to cut occurs exactly once`, `${n} times`); continue }
    const green = await probes[probe]()
    writeFileSync(path, orig.replace(from, () => to))
    let red
    try { red = !(await probes[probe]().catch(() => false)) } finally { writeFileSync(path, orig) }
    const again = await probes[probe]()
    is(green && red && again, `mutant "${label}": green, RED with the rule cut, green again when restored`, `${green}/${red}/${again}`)
  }
  // the item cap and the empty-list rule need their own data
  const catPath = join(apiDir, 'catalogue.php'), catSrc = readFileSync(catPath, 'utf8')
  {
    const bulk = Array.from({ length: 12 }, (_, i) => `zz-cap-${i}`)
    await sql(`insert into products (slug, name_en, name_ar, price, category) values ${bulk.map((s) => `('${s}', 'Cap ${s}', 'ك', 3.000, 'men')`).join(',')}`)
    await sql(`insert into product_variants (sku, slug, size, stock) values ${bulk.map((s) => `('SKU-C-${s}', '${s}', 'M', 1)`).join(',')}`)
    for (const s of bulk) photo(`${s}.jpg`)
    const count = async () => ldOf(await seoPage('/catalogue?lang=en')).json.mainEntity.itemListElement.length
    const full = await count()
    writeFileSync(catPath, catSrc.replace('const STORE_CATALOGUE_JSONLD_MAX = 100;', 'const STORE_CATALOGUE_JSONLD_MAX = 5;'))
    const capped = await count()
    writeFileSync(catPath, catSrc)
    is(full === LISTED.length + 12 && capped === 5, 'mutant "the item cap": the list is capped by STORE_CATALOGUE_JSONLD_MAX (5 with the constant at 5, all with it at 100)', `${full} / ${capped}`)
    await sql("delete from products where slug like 'zz-cap-%'; delete from product_variants where slug like 'zz-cap-%'")
    await sql('update products set active = 0')
    const none = async () => !/data-sporta-ssr-catalogue/.test(await seoPage('/catalogue'))
    const green = await none()
    writeFileSync(catPath, catSrc.replace("if ($products === []) return null;", ''))
    const red = !(await none())
    writeFileSync(catPath, catSrc)
    is(green && red, 'mutant "nothing for an empty shop": an empty list publishes no JSON-LD; with the rule cut an empty ItemList is published', `${green}/${red}`)
    await sql('update products set active = 1 where slug not in (\'zz-inactive\')')
  }
}

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
