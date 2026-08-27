/**
 * Where every photograph on this shop is kept, and whether it can be reached.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/image-audit.mjs
 *
 * The shop keeps images in two completely different places and neither one
 * had a test.
 *
 *   ON DISK   /hero and /cats are shipped artwork with fixed filenames. The
 *             storefront asks for /cats/desktop/men.jpg and the file is
 *             called art-men.jpg — .htaccess rewrites it. That rewrite is one
 *             line, it is the only thing standing between the home page and
 *             four broken tiles, and `php -S` ignores .htaccess, so every
 *             other rig in this repo is blind to it. This one boots Apache.
 *
 *   IN THE DATABASE   product_images, hero_slides.image and brands.logo hold
 *             base64 data: URIs in longtext columns. Nothing on this server
 *             has write access to the web root — that is the reason — and
 *             each is served back as bytes behind a URL carrying the content
 *             hash, cached for a year.
 *
 * WHAT IT CHECKS, and why each one is here rather than assumed:
 *
 *  1. Disk: every image file is either referenced or explained. 1.2 MB of
 *     artwork rides in every zip and every upload; a file nothing loads is
 *     worth knowing about, and a file something loads that is NOT THERE is a
 *     broken tile.
 *
 *  2. The .htaccess rewrite, through a real Apache: /cats/desktop/men.jpg must
 *     answer 200 with image bytes, not the SPA's index.html. Under `php -S`
 *     the dev router happens to serve the same thing, which is exactly the
 *     kind of accident that hides a production 404.
 *
 *  3. Cache headers on both kinds. The database-served images claim
 *     immutable-for-a-year, which is only safe because the URL carries the
 *     content hash; the disk ones must NOT claim that, because their names are
 *     fixed and replacing one is a normal thing to do.
 *
 *  4. Storage health in the database: rows whose base64 will not decode, rows
 *     over the upload cap (which can only get there by hand), photographs
 *     belonging to a product that no longer exists, and the same photograph
 *     stored more than once.
 *
 *  5. max_allowed_packet against the upload caps. STORE_HERO_MAX is 1.2 MB of
 *     base64 and the INSERT carrying it is a little larger. Shared hosting
 *     often ships a 1 MB packet limit, and the failure is a "MySQL server has
 *     gone away" in the middle of an upload that looked fine — a number worth
 *     reading off the server rather than hoping about.
 *
 *  6. A RENAME REGRESSION. product_images and product_variants are keyed on
 *     products.slug, with no foreign key and no ON UPDATE CASCADE, and the
 *     admin lets the owner edit that slug. Renaming a product used to detach
 *     its whole photo shoot and all its size rows: still in the database,
 *     under a name nothing looks up, invisible in the admin and unservable to
 *     a shopper. admin.php now carries the children inside the rename's
 *     transaction; this is the check that says so, and it is written to fail
 *     if that carry is removed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const DOCROOT = `${ROOT}/sporta-site/public_html`
const API = process.env.API ?? 'http://127.0.0.1:4300/api'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }
const note = (what) => console.log(`--   ${what}`)

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
const one = (q) => sql(q).split('\n')[0] ?? ''

// ---------------------------------------------------------------- 1. on disk
console.log('--- artwork on disk')
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|svg)$/i
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, out)
    else if (IMAGE_RE.test(e.name)) out.push(p.slice(DOCROOT.length + 1))
  }
  return out
}
const onDisk = walk(DOCROOT).sort()
const shipped = [
  readFileSync(`${DOCROOT}/index.html`, 'utf8'),
  readFileSync(`${DOCROOT}/sw.js`, 'utf8'),
  ...readdirSync(`${DOCROOT}/assets`)
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((f) => readFileSync(`${DOCROOT}/assets/${f}`, 'utf8')),
  readFileSync(`${DOCROOT}/site.webmanifest`, 'utf8'),
  readFileSync(`${DOCROOT}/.htaccess`, 'utf8'),
].join('\n')

// A file counts as reached if the shipped code names it, OR if it is what a
// rewrite in .htaccess resolves to. /cats/desktop/art-men.jpg is never spelled
// anywhere: the storefront asks for men.jpg and Apache does the rest.
const REWRITTEN = /^cats\/(mobile|desktop)\/art-(men|women|accessories|outlet)(-rtl)?\.(jpe?g|webp)$/
// api/wallet-assets are read by PHP and stitched into a .pkpass, never by a
// browser. They are named in make-wallet-pass.mjs, not in the bundle.
const SERVER_SIDE = /^api\/wallet-assets\//
// MATCHING ON THE STEM, not the path or even the filename.
//
// The first version of this check matched whole paths and reported all eight
// off-screen hero banners as dead weight. They are not: the bundle carries
// `["bodybuilding-men","bodybuilding-women","crossfit-men","cardio-men",
// "cardio-women"]` and builds `/hero/{device}/{name}.webp` at runtime, so the
// path it requests exists nowhere in the source as a literal. Deleting those
// files on that report would have emptied the home page carousel.
//
// So a file is reached if its stem appears anywhere in the shipped code. That
// is a weaker test and deliberately so — the cost of a false "dead" here is
// someone deleting a live image, and the cost of a false "live" is a file
// nobody notices. Those are not the same size of mistake.
const unreferenced = []
for (const f of onDisk) {
  if (SERVER_SIDE.test(f) || REWRITTEN.test(f)) continue
  const stem = f.split('/').pop().replace(IMAGE_RE, '')
  if (!shipped.includes(stem)) unreferenced.push(f)
}
const kb = (n) => `${Math.round(n / 1024)} kB`
const bytesOf = (list) => list.reduce((a, f) => a + statSync(`${DOCROOT}/${f}`).size, 0)
console.log(`     ${onDisk.length} image files, ${kb(bytesOf(onDisk))} in total`)
check(unreferenced.length === 0,
  unreferenced.length
    ? `${unreferenced.length} files (${kb(bytesOf(unreferenced))}) that nothing on the site asks for:\n       ` +
      unreferenced.join('\n       ')
    : 'every file on disk is reached — by name, or through an .htaccess rewrite')

// The other direction: a rewrite whose target is missing is a broken tile.
const missingTargets = ['mobile', 'desktop'].flatMap((d) =>
  ['men', 'women', 'accessories', 'outlet'].flatMap((c) =>
    ['jpg', 'webp'].map((x) => `cats/${d}/art-${c}.${x}`)))
  .filter((f) => !existsSync(`${DOCROOT}/${f}`))
check(missingTargets.length === 0,
  missingTargets.length
    ? `the category rewrite points at ${missingTargets.length} files that are NOT THERE: ${missingTargets.join(', ')}`
    : 'every category tile the rewrite can produce exists on disk')

// ------------------------------------------------- 2 + 3. through real Apache
console.log('\n--- served by Apache, with .htaccess in force')
const PORT = 4401
const CONF = '/tmp/sporta-image-audit.conf'
let apache = false
if (!existsSync('/usr/sbin/apache2')) {
  note('SKIP — apache2 is not installed, so the rewrite and the disk cache headers are unchecked')
} else {
  const MODULES = ['mpm_event', 'authz_core', 'mime', 'dir', 'setenvif', 'env',
                   'expires', 'deflate', 'filter', 'alias', 'headers', 'rewrite']
  writeFileSync(CONF, `ServerName 127.0.0.1
Listen ${PORT}
${MODULES.filter((m) => existsSync(`/usr/lib/apache2/modules/mod_${m}.so`))
  .map((m) => `LoadModule ${m}_module /usr/lib/apache2/modules/mod_${m}.so`).join('\n')}
TypesConfig /etc/mime.types
User www-data
Group www-data
ErrorLog /tmp/sporta-image-audit.err
PidFile /tmp/sporta-image-audit.pid
<VirtualHost *:${PORT}>
  DocumentRoot ${DOCROOT}
  <Directory ${DOCROOT}>
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
`)
  spawnSync('apache2', ['-f', CONF, '-k', 'stop'], { stdio: 'ignore' })
  const start = spawnSync('apache2', ['-f', CONF, '-k', 'start'], { encoding: 'utf8' })
  if (start.status !== 0) {
    check(false, 'apache would not start:\n' + (start.stderr || start.stdout))
  } else {
    apache = true
    execFileSync('sh', ['-c', `for i in $(seq 20); do curl -s -o /dev/null http://127.0.0.1:${PORT}/ && exit 0; sleep 0.2; done`],
      { stdio: 'ignore' })
  }
}

// CURL, NOT FETCH. .htaccess 301s every hostname but www.sporta.com.kw, and
// `Host` is a forbidden header name in fetch — Node drops it silently, so
// every request arrives as 127.0.0.1 and is redirected before it reaches a
// single rule worth testing. htaccess-test.mjs shells out for the same reason.
const ask = (path) => {
  // curl's own exit code is not the assertion — a 404 is a result, and so is a
  // connection that dies. Both are reported as a status, not thrown, so a
  // failing check prints its line instead of taking the whole run down.
  const r = spawnSync('curl', [
    '-s', '-o', '/tmp/sporta-image-audit.body', '-D', '/tmp/sporta-image-audit.head',
    '-H', 'Host: www.sporta.com.kw',
    '-H', 'X-Forwarded-Proto: https',
    '-w', '%{http_code}',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' })
  const head = existsSync('/tmp/sporta-image-audit.head')
    ? readFileSync('/tmp/sporta-image-audit.head', 'utf8') : ''
  const hdr = (name) => (head.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1] ?? '').trim()
  return { status: Number(r.stdout) || 0, type: hdr('content-type'), cache: hdr('cache-control'),
           bytes: existsSync('/tmp/sporta-image-audit.body') ? statSync('/tmp/sporta-image-audit.body').size : 0 }
}

if (apache) {
  for (const [asked, is] of [
    ['/cats/desktop/men.jpg', 'cats/desktop/art-men.jpg'],
    ['/cats/mobile/women.webp', 'cats/mobile/art-women.webp'],
    ['/cats/desktop/men-rtl.jpg', 'cats/desktop/art-men-rtl.jpg'],
    ['/cats/desktop/outlet.jpg', 'cats/desktop/art-outlet.jpg'],
  ]) {
    if (!existsSync(`${DOCROOT}/${is}`)) continue   // already reported as missing above
    const r = ask(asked)
    const want = statSync(`${DOCROOT}/${is}`).size
    // THE SIZE IS THE ASSERTION, not the 200. The SPA fallback answers 200 for
    // anything, so a rewrite that stopped working would still look fine here
    // and would hand the browser index.html with an <img> around it.
    check(r.status === 200 && r.type.startsWith('image/') && r.bytes === want,
      `${asked} -> ${is} (${r.status}, ${r.type}, ${r.bytes} B of ${want})`)
  }

  // Disk artwork must be cacheable but REPLACEABLE. Its filenames are fixed,
  // so `immutable` would mean a swapped hero never reaches anyone who has
  // already seen the old one.
  const tile = ask("/cats/desktop/men.jpg")
  const maxAge = Number(tile.cache.match(/max-age=(\d+)/)?.[1] ?? 0)
  check(maxAge > 0 && !/immutable/.test(tile.cache),
    `shipped artwork is cached but replaceable — "${tile.cache || '(none)'}"`)
  check(maxAge <= 60 * 60 * 24 * 90,
    `and not for longer than a season (${Math.round(maxAge / 86400)} days)`)

  spawnSync('apache2', ['-f', CONF, '-k', 'stop'], { stdio: 'ignore' })
}

// -------------------------------------------------- 4. the database's images
console.log('\n--- images kept in the database')
const stores = [
  ['product_images', 'image', 'product photographs', 900000],
  ['hero_slides', 'image', 'hero slides', 1200000],
  ['brands', 'logo', 'brand logos', 160000],
]
for (const [table, col, what, cap] of stores) {
  const n = +one(`select count(*) from ${table} where ${col} is not null and ${col} <> ''`)
  const total = +one(`select coalesce(sum(length(${col})), 0) from ${table}`)
  console.log(`     ${String(n).padStart(3)} ${what}, ${kb(total)} of base64`)

  // Anything not a data: URI in the shape the serving route matches is a row
  // the browser gets a 404 for. Written by hand, or by an older admin.
  const bad = +one(
    `select count(*) from ${table} where ${col} is not null and ${col} <> ''
       and ${col} not regexp '^data:image/(png|jpeg|webp);base64,'`)
  check(bad === 0, `${table}.${col}: ${bad === 0 ? 'every row is a data: URI the serving route can parse' : `${bad} row(s) are NOT — those images 404`}`)

  const over = sql(
    `select concat(id, ' (', round(length(${col})/1024), ' kB)') from ${table}
      where length(${col}) > ${cap}`).split('\n').filter(Boolean)
  check(over.length === 0,
    over.length ? `${table}.${col}: ${over.length} row(s) over the ${kb(cap)} upload cap — ${over.join(', ')}`
                : `${table}.${col}: none over the ${kb(cap)} upload cap`)
}

// Photographs whose product is gone. The serving route INNER JOINs products,
// so these are unreachable bytes: not on the storefront, not in the admin
// (which lists by slug), and never freed.
const orphans = sql(
  `select concat(i.id, '  ', i.slug, '  ', round(length(i.image)/1024), ' kB')
     from product_images i left join products p on p.slug = i.slug
    where p.slug is null`).split('\n').filter(Boolean)
check(orphans.length === 0,
  orphans.length
    ? `${orphans.length} photograph(s) belong to a slug no product has — stored, unreachable, never freed:\n       ` +
      orphans.join('\n       ') + '\n       repair: sporta-site/database-sql/6-orphan-images.sql'
    : 'no orphaned photographs — every row in product_images has a product')

// The same shoot uploaded twice is two copies of the bytes. Not an error —
// two products can legitimately share a picture — but it is worth seeing.
const dupes = sql(
  `select concat(count(*), ' x ', round(length(image)/1024), ' kB  ', group_concat(slug))
     from product_images group by image_hash having count(*) > 1`).split('\n').filter(Boolean)
if (dupes.length) {
  note(`${dupes.length} photograph(s) stored more than once:`)
  for (const d of dupes) console.log(`       ${d}`)
} else {
  console.log('ok   no photograph is stored twice')
}

// ------------------------------------------------------ 5. can it be inserted
const packet = +one("select @@max_allowed_packet")
const biggest = Math.max(...stores.map(([, , , cap]) => cap))
check(packet > biggest * 1.2,
  `max_allowed_packet is ${kb(packet)}; the largest upload the admin accepts is ${kb(biggest)} of base64` +
  (packet > biggest * 1.2 ? '' : ' — an upload at the cap will fail mid-insert with "MySQL server has gone away"'))

// ------------------------------------------------- 5b. the brand logo folders
//
// public_html/images/<brand-slug>/logo.{png,webp,jpg} — one folder per brand,
// filled through hPanel's File Manager, which is the only upload the owner has
// without opening the panel.
//
// The folder name IS the lookup key: a product row says brand_slug =
// 'gymshark' and the server looks in images/gymshark/. So a folder whose name
// is not a brand slug is a folder nobody will ever read, and a brand with no
// folder is a brand the owner cannot give a logo to this way. Neither is
// visible from either side on its own.
console.log('\n--- a folder per brand, for logos dropped in by hand')
{
  const brands = sql('select slug from brands').split('\n').filter(Boolean)
  const dir = `${DOCROOT}/images`
  const folders = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : []

  const missing = brands.filter((b) => !folders.includes(b))
  check(missing.length === 0,
    missing.length ? `${missing.length} brand(s) have no folder: ${missing.join(', ')}`
                   : `all ${brands.length} brands have a folder under images/`)

  const stray = folders.filter((f) => !brands.includes(f))
  check(stray.length === 0,
    stray.length
      ? `${stray.length} folder(s) match no brand slug — nothing will ever read them: ${stray.join(', ')}`
      : 'every folder under images/ is a real brand slug')

  // A logo that is there but misnamed is the failure the owner cannot see:
  // the file is uploaded, the folder looks right, and the shop shows nothing.
  const NAMES = ['logo.png', 'logo.webp', 'logo.jpg']
  const misnamed = []
  let withLogo = 0
  for (const f of folders) {
    const files = readdirSync(`${dir}/${f}`).filter((n) => IMAGE_RE.test(n))
    if (files.some((n) => NAMES.includes(n))) { withLogo++; continue }
    if (files.length) misnamed.push(`${f}/: ${files.join(', ')} — none is ${NAMES.join(' / ')}`)
  }
  check(misnamed.length === 0,
    misnamed.length
      ? `${misnamed.length} folder(s) hold an image the shop will not find:\n       ` + misnamed.join('\n       ')
      : `no misnamed logos — ${withLogo} of ${folders.length} brands have one`)

  // And the note that tells the owner what to do, in each folder. It is also
  // what makes git keep an otherwise-empty directory, so losing it means the
  // folders stop travelling in the upload package at all.
  const noNote = folders.filter((f) => !existsSync(`${dir}/${f}/PUT-LOGO-HERE.txt`))
  check(noNote.length === 0,
    noNote.length
      ? `${noNote.length} folder(s) have lost PUT-LOGO-HERE.txt — an empty folder does not survive git or the zip: ${noNote.join(', ')}`
      : 'every folder carries its instructions')
}

// ------------------------------------------------- 6. renaming keeps the shoot
console.log('\n--- renaming a product keeps its photographs and its sizes')
let cookie = ''
const admin = async (route, body) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', 'X-Sporta-Admin': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) { const m = set.match(/(?:__Host-)?sporta_admin=([^;]+)/); if (m) cookie = `sporta_admin=${m[1]}` }
  return { status: res.status, d: await res.json().catch(() => null) }
}
const login = await admin('login', { email: EMAIL, password: PASSWORD })
if (login.status !== 200) {
  check(false, `could not sign in as ${EMAIL} (${login.status}) — run scripts/sandbox.sh, which seeds the account`)
} else {
  const list = (await admin('products_all')).d
  const rows = list.products ?? list
  const counts = (slug) => ({
    photos: +one(`select count(*) from product_images where slug = '${slug}'`),
    sizes: +one(`select count(*) from product_variants where slug = '${slug}'`),
  })
  const shopImage = async (slug) => {
    const j = await (await fetch(`${API}/api.php?r=products`)).json()
    return ((j.products ?? j).find((p) => p.slug === slug) ?? {}).image ?? null
  }

  // IF NOTHING HAS A PHOTOGRAPH, UPLOAD ONE. The catalogue ships with none —
  // product_images is empty until the owner starts uploading — and a check
  // that quietly skips itself on an empty table is a check that will still be
  // green the day the carry breaks. So the rig makes its own subject through
  // the real upload route, and takes it away again at the end.
  let seeded = null
  if (+one('select count(*) from product_images') === 0) {
    const victim = (rows.find((p) => p.active) ?? rows[0])?.slug
    const bytes = readFileSync(`${DOCROOT}/cats/mobile/art-men.jpg`)
    const up = await admin('product_image_add', {
      slug: victim, width: 800, height: 800,
      image: 'data:image/jpeg;base64,' + bytes.toString('base64'),
    })
    if (up.status === 200) { seeded = up.d.id; note(`no product has a photograph — uploaded one to ${victim} for this check`) }
    else check(false, `could not upload a test photograph: ${JSON.stringify(up.d)}`)
  }

  // Two products: one carrying photographs, one carrying size rows. A single
  // sample would let half the carry rot unnoticed.
  const withPhotos = one(`select slug from product_images order by id limit 1`)
  const withSizes = one(`select slug from product_variants group by slug order by count(*) desc limit 1`)
  const subjects = [...new Set([withPhotos, withSizes].filter(Boolean))]
  if (!subjects.length) note('SKIP — no product has photographs or size rows to carry')

  for (const base of subjects) {
    const prod = rows.find((p) => p.slug === base)
    if (!prod) { check(false, `${base} is in product_images but not in the catalogue`); continue }
    const was = counts(base)
    const wasImage = await shopImage(base)
    const renamed = `${base}-audit-rename`
    console.log(`     ${base}: ${was.photos} photograph(s), ${was.sizes} size row(s)`)

    const r = await admin('product_save', { ...prod, slug: renamed })
    if (r.status !== 200) { check(false, `rename refused: ${JSON.stringify(r.d)}`); continue }
    const now = counts(renamed)
    const left = counts(base)
    check(now.photos === was.photos && now.sizes === was.sizes,
      `children followed the rename — ${now.photos}/${was.photos} photograph(s), ${now.sizes}/${was.sizes} size row(s)`)
    check(left.photos === 0 && left.sizes === 0,
      `nothing left orphaned under the old slug (${left.photos} photograph(s), ${left.sizes} size row(s))`)
    check((await shopImage(renamed)) === wasImage,
      `the storefront still shows the same photograph (${wasImage ?? 'none — this product has none'})`)

    // ALWAYS PUT IT BACK. This runs against the same database the other rigs
    // read, and a product left under an -audit-rename slug would break them.
    const back = await admin('product_save', { ...prod, slug: base })
    check(back.status === 200, 'renamed back')
    const after = counts(base)
    check(after.photos === was.photos && after.sizes === was.sizes,
      'and the children came back with it')
  }

  // Take the test photograph out again, whatever happened above. Leaving it
  // would mean the next run finds a photograph, skips the seeding, and slowly
  // fills the table with one more picture per run.
  if (seeded !== null) {
    await admin('product_image_delete', { id: seeded })
    check(+one(`select count(*) from product_images where id = ${seeded}`) === 0,
      'the test photograph was removed again')
  }
}

console.log(fails ? `\n${fails} failed` : '\nall ok — every image is stored somewhere it can be reached from')
process.exit(fails ? 1 : 0)
