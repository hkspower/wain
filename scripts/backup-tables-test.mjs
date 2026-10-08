/**
 * The backup carries every table the owner or a customer writes — and nothing that would let a copy of
 * the file be used as a way in.
 *
 *   bash scripts/sandbox.sh            # MariaDB must be up; the rig copies the sandbox, never writes it
 *   node scripts/backup-tables-test.mjs
 *
 * WHAT BROKE (2026-10-08). BACKUP_TABLES was fourteen tables while the owner's work had gone into
 * eighteen more, so the daily file and the Backup card's download left out colours and fits, search
 * text, the home banner, the category pictures, the logo, the share picture, returns, customer notes,
 * the books, suppliers and purchase orders, stock history and size charts. Adding them needed four more
 * things, and each is held here:
 *   - binary columns (the pictures are mediumblob) are base64, or json_encode() fails and the card
 *     downloads an EMPTY file with a 200;
 *   - the primary key is read from the schema: the old code assumed `id`, product_variants' key is
 *     `sku`, and a restore deleted every size row and wrote none back;
 *   - a table the file does not name is kept, or every older backup would wipe the new tables;
 *   - the rows are streamed, not collected into one array.
 * And the payment secrets the Payments screen keeps in settings.knet, which the old comment said were
 * "not database rows", are nulled on export and kept from the live shop on restore.
 *
 * Runs against a SCRATCH COPY of the shop (scripts/scratch-shop.mjs): a restore is delete-then-insert
 * of thirty-two tables, which the shared sandbox cannot spare, and every mutation below is written into
 * the copy's backup-build.php, which only the scratch server serves.
 *
 *   A. The lists. BACKUP_TABLES and BACKUP_EXCLUDED read out of backup-build.php by PHP itself; every
 *      table a fully-migrated install has (the GENERATED manifest in scripts/live/live-schema-full.php)
 *      and every table in the database is in exactly one of them; the owner tables named in the
 *      2026-10-08 review are all in BACKUP_TABLES; nothing in BACKUP_TABLES is a session, credential,
 *      log, outbox or counter table.
 *   B. Export (the card) and the daily file (cron-backup.php): every listed table, with the database's
 *      row count — and every listed table HAS rows here (fixtures are planted where the sandbox has
 *      none), so a count of 0 = 0 cannot pass by covering nothing. Every picture decodes to the exact
 *      bytes in the database (sha256 both sides). The two hold the same tables and counts.
 *   C. Secrets: none of the planted ones appears in either file, raw or base64 — the second factor, the
 *      emailed code, the six payment secrets, and the sessions, passkeys, device tokens, reset and
 *      sign-in codes, push keys and Wallet tokens of the excluded tables. The payment IDs DO travel.
 *   D. Restore round trip: export, change the shop (search text, a journal line, a stray supplier, a
 *      category picture's bytes, a product's whole size ladder, the payment ID and one payment secret),
 *      preview (it must see each change), restore, and require every table back exactly as it was by
 *      CHECKSUM TABLE — product_variants included — with the payment secret the shop saved AFTER the
 *      backup kept, the payment ID reverted, and the excluded tables untouched.
 *   E. An older file (format 1: the fourteen tables) restores its tables and KEEPS the eighteen it does
 *      not name; a file with no payment-settings row keeps the shop's saved secrets (and only them);
 *      a newer format is refused; a file holding rows for a table this shop lacks is refused
 *      by name and changes nothing; a table missing from the shop does not break the export or the
 *      daily file; bad base64 and a non-scalar value are refused as bad_backup_file.
 *   F. Size and memory: the old builder (git HEAD) and the new writer over the same database with real
 *      photographs and pictures in it — the new one's peak memory over its starting point must stay
 *      below half the largest single table, which is what "one row at a time" means.
 *   G. MUTATIONS in the copy, each required to make a named check fail.
 *   H. scripts/backup-test.mjs, the original rig, run against this scratch copy and required to pass.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { scratchShop, adminClient, schemaManifest } from './scratch-shop.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html/'
const sha = (b) => createHash('sha256').update(b).digest('hex')
const b64 = (s) => Buffer.from(s).toString('base64')

// THE DECISION RECORD. Owner data the 2026-10-08 review named, plus the original fourteen and size_charts
// (editable in /backends). A mutation that drops any of these from BACKUP_TABLES fails by name.
const MUST_BACK_UP = [
  'brands', 'products', 'product_variants', 'product_images', 'customers', 'orders', 'order_items', 'reviews',
  'discounts', 'blocked_customers', 'hero_slides', 'settings', 'admin_users', 'assistant_qa',
  'product_attrs', 'product_seo', 'home_banner', 'category_art', 'site_images', 'seo_image',
  'return_requests', 'return_request_items', 'customer_notes', 'accounts', 'journal_entries', 'journal_lines',
  'suppliers', 'variant_supplier', 'purchase_orders', 'purchase_order_items', 'stock_log', 'size_charts',
]
// Shapes that must never be backed up: sessions, credentials, codes, logs, outboxes, counters, caches.
const NEVER = /(_sessions|_passkeys|_devices|_password_resets|_login_codes|_known_ips|_ip_geo|_outbox|_log$|^rate_|_subscriptions|_registrations|_thumbs$|^wallet_passes$|^order_location$)/
const NEVER_EXCEPT = new Set(['stock_log'])   // stock history is the inventory's record, restored with the stock it explains

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + String(extra).slice(0, 300) : ''}`)
}

const shop = await scratchShop('backup')
const one = (q) => shop.sql(q).trim().split('\n')[0] ?? ''
const n = (t) => Number(one(`select count(*) from \`${t}\``))
const phpJson = (code, ...args) => JSON.parse(execFileSync('php', ['-r', code, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }))
const lists = (file) => phpJson('require $argv[1]; echo json_encode(["tables" => BACKUP_TABLES, "excluded" => array_keys(BACKUP_EXCLUDED), "redact" => BACKUP_REDACT_SETTINGS]);', file)
const checksums = (tables) => {
  const out = {}
  for (const line of shop.sql(`checksum table ${tables.map((t) => '`' + t + '`').join(', ')}`).trim().split('\n')) {
    const [name, sum] = line.split('\t')
    out[name.split('.').pop()] = sum
  }
  return out
}
const cfg = JSON.parse(execFileSync('php', ['-r', 'echo json_encode(require $argv[1]);', shop.apiDir + '/config.php'], { encoding: 'utf8' }))

const SECRETS = {
  totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  emailOtp: sha('RIG_SECRET_EMAIL_OTP'),
  tranportal_password: 'RIG_SECRET_TRANPORTAL_PW', resource_key: 'RIG_SECRET_RESOURCE_KEY1',
  cbk_client_secret: 'RIG_SECRET_CBK_CLIENT', cbk_encrp_key: 'RIG_SECRET_CBK_ENCRP',
  cbk_test_client_secret: 'RIG_SECRET_CBK_TEST_CLIENT', cbk_test_encrp_key: 'RIG_SECRET_CBK_TEST_ENCRP',
  session: sha('RIG_SECRET_SESSION'), passkey: 'RIG_SECRET_ADMIN_PASSKEY_PUB', device: 'RIG_SECRET_DEVICE_PASS',
  reset: 'RIG_SECRET_RESET_CODE', customerPasskey: 'RIG_SECRET_CUSTOMER_PASSKEY', loginCode: sha('RIG_SECRET_LOGIN_CODE'),
  push: 'RIG_SECRET_PUSH_AUTH', wallet: 'RIG_SECRET_WALLET_AUTH',
  // customers' password hashes (owner, 2026-10-07: never in a backup) — bcrypt-shaped, 60 characters
  customerHash: '$2y$10$RIGSECRETCUSTOMERHASHONEaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  customerHash2: '$2y$10$RIGSECRETCUSTOMERHASHTWObbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  customerHash3: '$2y$10$RIGSECRETCUSTOMERHASHTHREEcccccccccccccccccccccccccc', dbPass: cfg.db_pass_real ?? 'localdev', cron: cfg.cron_key,
}

/* ------------------------------------------------------------------ fixtures (scratch database only) */
function seed() {
  const php = `<?php
$db = new PDO('mysql:host=localhost;dbname=' . $argv[1] . ';charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pub = $argv[2];
$S = json_decode($argv[3], true);
$blob = function (string $sql, array $vals, array $lobs) use ($db) {
    $st = $db->prepare($sql);
    foreach ($vals as $i => $v) $st->bindValue($i + 1, $v, in_array($i, $lobs, true) ? PDO::PARAM_LOB : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
    $st->execute();
};
$all = ''; for ($i = 0; $i < 256; $i++) $all .= chr($i);   // every byte value, so base64 is exercised in full
foreach (['men', 'women', 'accessories', 'outlet'] as $tile) foreach (['desktop', 'mobile', 'desktop-rtl', 'mobile-rtl'] as $v) foreach (['webp', 'jpg'] as $fmt) {
    $crop = str_starts_with($v, 'mobile') ? 'mobile' : 'desktop';
    $bytes = file_get_contents("$pub/cats/$crop/art-$tile" . (str_ends_with($v, '-rtl') ? '-rtl' : '') . ".$fmt");
    if ($tile === 'men' && $v === 'desktop' && $fmt === 'webp') $bytes = $all . $bytes;
    $blob('insert into category_art (tile, variant, fmt, bytes, etag) values (?, ?, ?, ?, ?)', [$tile, $v, $fmt, $bytes, md5($bytes)], [3]);
}
foreach ([['logo', 'png', 'logo.png'], ['logo', 'webp', 'logo.webp'], ['logo-white', 'png', 'logo-white.png'], ['logo-white', 'webp', 'logo-white.webp'], ['features', 'webp', 'assets/features.webp']] as [$name, $fmt, $f]) {
    $bytes = file_get_contents("$pub/$f");
    $blob('insert into site_images (name, fmt, bytes, etag) values (?, ?, ?, ?)', [$name, $fmt, $bytes, md5($bytes)], [2]);
}
$og = file_get_contents("$pub/og-image.png");
$blob('insert into seo_image (id, image, image_type, image_w, image_h, etag) values (1, ?, ?, 1200, 630, ?)', [$og, 'png', md5($og)], [0]);
$slugs = $db->query('select slug from products order by id')->fetchAll(PDO::FETCH_COLUMN);
$hero = file_get_contents("$pub/hero/desktop/cardio-men.webp");
$db->exec('delete from home_banner');
$blob('insert into home_banner (id, enabled, product, title_en, image, image_type, image_w, image_h, etag) values (1, 0, ?, ?, ?, ?, 1600, 635, ?)', [$slugs[0], 'Rig banner', $hero, 'webp', md5($hero)], [2]);
// Product photographs, as the panel stores them: data: URIs in a longtext. Real pictures, so the size
// and memory measurements below are about the shop rather than about a fixture.
$files = glob("$pub/cats/*/art-*.webp");
for ($i = 0; $i < 48; $i++) {
    $f = $files[$i % count($files)];
    $uri = 'data:image/webp;base64,' . base64_encode(file_get_contents($f) . str_repeat(chr($i), 16));
    $db->prepare('insert into product_images (slug, sort, image, image_hash) values (?, ?, ?, ?)')->execute([$slugs[$i % count($slugs)], $i, $uri, hash('sha256', $uri)]);
}
$order = $db->query('select id from orders order by id limit 1')->fetchColumn();
$item = $db->query('select id from order_items where order_id = ' . (int) $order . ' order by id limit 1')->fetchColumn();
$sku = $db->query('select sku from product_variants order by sku limit 1')->fetchColumn();
$acc = $db->query('select id from accounts order by id limit 2')->fetchAll(PDO::FETCH_COLUMN);
$admin = $db->query("select id from admin_users where email = 'manager@sporta.com.kw'")->fetchColumn();
$db->exec("insert into product_attrs (slug, colour, fits) values ('$slugs[0]', 'black', 'slim')");
$db->exec("insert into product_seo (slug, title_en, title_ar, desc_en, desc_ar) values ('$slugs[0]', 'Rig search title', 'عنوان', 'Rig desc', 'وصف')");
$db->exec("insert into hero_slides (sort, active, title_en, title_ar) values (0, 0, 'Rig slide', 'شريحة')");
$db->exec("insert into assistant_qa (q_ar, q_en, a_ar, a_en) values ('سؤال', 'Rig question', 'جواب', 'Rig answer')");
foreach ([['rig-backup@example.invalid', '96555590777', 'customerHash'], ['rig-backup2@example.invalid', '96555590771', 'customerHash2'], ['rig-backup3@example.invalid', '96555590772', 'customerHash3']] as [$e, $ph, $k]) {
    $db->prepare("insert into customers (email, phone, name, password_hash) values (?, ?, 'Rig Customer', ?)")->execute([$e, $ph, $S[$k]]);
}
$db->exec("insert into customer_notes (phone, note, tags) values ('96555590777', 'Rig note', 'vip')");
$db->exec("insert into blocked_customers (phone, scope, reason, blocked_by) values ('96555590778', 'cod', 'rig', 'rig')");
$db->exec("insert into reviews (order_id, rating, comment) values ($order, 5, 'Rig review')");
$db->exec("insert into discounts (code, label, type, value) values ('RIGBACKUP', 'Rig discount', 'percent', 10)");
$db->exec("insert into return_requests (ref, order_id, kind, phone) values ('RRIGBACKUP1', $order, 'exchange', '96555590777')");
$rr = $db->lastInsertId();
$db->exec("insert into return_request_items (request_id, order_item_id, qty, want_size) values ($rr, $item, 1, 'L')");
$db->exec("insert into journal_entries (entry_date, memo, source, source_ref, kind) values (curdate(), 'Rig entry', 'manual', 'RIG1', 'rig')");
$je = $db->lastInsertId();
$db->exec("insert into journal_entries (entry_date, memo, source, source_ref, kind, reverses_id) values (curdate(), 'Rig reversal', 'manual', 'RIG2', 'rig', $je)");
$je2 = $db->lastInsertId();
$db->exec("update journal_entries set reversed_by_id = $je2 where id = $je");
foreach ([[$je, $acc[0], '1.500', '0'], [$je, $acc[1], '0', '1.500'], [$je2, $acc[1], '1.500', '0'], [$je2, $acc[0], '0', '1.500']] as [$e, $a, $d, $c]) {
    $db->exec("insert into journal_lines (entry_id, account_id, debit, credit, memo) values ($e, $a, $d, $c, 'rig')");
}
$db->exec("insert into suppliers (name, contact, lead_days) values ('Rig supplier', 'rig@example.invalid', 10)");
$sup = $db->lastInsertId();
$db->exec("insert into variant_supplier (sku, supplier_id) values ('$sku', $sup)");
$db->exec("insert into purchase_orders (supplier_id, status, note) values ($sup, 'open', 'Rig PO')");
$po = $db->lastInsertId();
$db->exec("insert into purchase_order_items (po_id, sku, qty, cost_aed) values ($po, '$sku', 3, 12.50)");
// The secrets.
$db->prepare("update admin_users set totp_secret = ?, totp_enabled = 1, email_otp_hash = ?, email_otp_expires = now() + interval 1 day where id = ?")->execute([$S['totp'], $S['emailOtp'], $admin]);
$knet = ['tranportal_id' => 'RIGID123', 'mode' => 'official', 'env' => 'test', 'lang_en' => 'EN', 'cbk_client_id' => 'RIGCLIENTID',
         'cbk_test_client_id' => 'RIGTESTCLIENTID'];
foreach (['tranportal_password', 'resource_key', 'cbk_client_secret', 'cbk_encrp_key', 'cbk_test_client_secret', 'cbk_test_encrp_key'] as $k) $knet[$k] = $S[$k];
$db->prepare("insert into settings (name, value) values ('knet', ?) on duplicate key update value = values(value)")->execute([json_encode($knet, JSON_UNESCAPED_UNICODE)]);
$db->prepare("insert into admin_sessions (sid_hash, admin_id, method) values (?, ?, 'password')")->execute([$S['session'], $admin]);
$blob("insert into admin_passkeys (admin_id, credential_id, public_key, alg) values (?, ?, ?, -7)", [$admin, 'rigcred', $S['passkey']], [1, 2]);
$db->prepare("insert into admin_devices (admin_id, token_hash, pass_hash, expires_at) values (?, ?, ?, now() + interval 1 day)")->execute([$admin, hash('sha256', 'rigdevice'), $S['device']]);
$db->prepare("insert into admin_password_resets (admin_id, code_hash, expires_at) values (?, ?, now() + interval 1 day) on duplicate key update code_hash = values(code_hash)")->execute([$admin, $S['reset']]);
$cust = $db->query("select id from customers where email = 'rig-backup@example.invalid'")->fetchColumn();
$blob("insert into customer_passkeys (customer_id, credential_id, public_key, alg) values (?, ?, ?, -7)", [$cust, 'rigccred', $S['customerPasskey']], [1]);
$db->prepare("insert into customer_login_codes (email, code_hash, expires_at) values ('rig-backup@example.invalid', ?, now() + interval 1 day)")->execute([$S['loginCode']]);
$db->prepare("insert into push_subscriptions (endpoint, endpoint_hash, p256dh, auth) values ('https://push.example.invalid/rig', ?, 'rigp256', ?)")->execute([hash('sha256', 'rigpush'), $S['push']]);
$db->prepare("insert into wallet_passes (serial, phone, name, auth_token) values ('RIGSERIAL1', '96555590777', 'Rig', ?)")->execute([$S['wallet']]);
echo json_encode(['ok' => true]);
`
  writeFileSync(shop.dir + '/seed.php', php)
  const r = spawnSync('php', [shop.dir + '/seed.php', shop.db, PUB, JSON.stringify(SECRETS)], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('seeding the scratch database failed: ' + r.stdout + r.stderr)
}

const BUILD = () => shop.apiDir + '/backup-build.php'
const originalBuild = () => readFileSync(ROOT + 'sporta-site/public_html/api/backup-build.php', 'utf8')
function mutate(from, to) {
  const src = readFileSync(BUILD(), 'utf8')
  if (!src.includes(from)) return false
  writeFileSync(BUILD(), src.replace(from, to))
  return true
}
const unmutate = () => writeFileSync(BUILD(), originalBuild())

// The checks that a mutation run re-uses: export -> { table counts ok, pictures exact, secrets absent }.
async function exportChecks(call) {
  const out = []
  const c = (ok, name, extra = '') => out.push({ ok: !!ok, name, extra })
  const exp = await call('backup_export')
  c(exp.status === 200 && exp.body?.tables, 'the Backup card export answers 200 with tables', `${exp.status} ${exp.text.length}b ${exp.text.slice(0, 120)}`)
  const L = lists(BUILD())
  for (const t of L.tables) {
    const db = n(t)
    const got = Array.isArray(exp.body?.tables?.[t]) ? exp.body.tables[t].length : -1
    c(got === db, `${t}: exported with the database's row count`, `db=${db} export=${got}`)
  }
  const pictures = []
  for (const [t, key, col] of [['category_art', ['tile', 'variant', 'fmt'], 'bytes'], ['site_images', ['name', 'fmt'], 'bytes'], ['seo_image', ['id'], 'image'], ['home_banner', ['id'], 'image']]) {
    for (const row of shop.rows(`select ${key.join(', ')}, sha2(\`${col}\`, 256) as h from ${t}`)) {
      const f = (exp.body?.tables?.[t] || []).find((x) => key.every((k) => String(x[k]) === row[k]))
      const ok = f && typeof f[col] === 'string' && sha(Buffer.from(f[col], 'base64')) === row.h
      if (!ok) pictures.push(`${t}:${key.map((k) => row[k]).join('/')}`)
    }
  }
  c(pictures.length === 0, 'every picture in the export decodes to exactly the bytes in the database', pictures.join(' '))
  // Only meaningful on a real export: an error body contains no secret either.
  const real = exp.status === 200 && !!exp.body?.tables
  const text = exp.text
  const leaked = Object.entries(SECRETS).filter(([, v]) => v && (text.includes(v) || text.includes(b64(v)))).map(([k]) => k)
  c(real && leaked.length === 0, 'no planted secret appears in the export, raw or base64', real ? leaked.join(' ') : 'no export to search')
  const excludedPresent = L.excluded.filter((t) => exp.body?.tables && t in exp.body.tables)
  c(real && excludedPresent.length === 0, 'no excluded table is in the export', real ? excludedPresent.join(' ') : 'no export to search')
  return { out, exp }
}

// THE LARGEST TABLE, measured by its own bytes in the first export — not by information_schema's
// data_length. That is an InnoDB statistic: every delete-and-reinsert restore below leaves the old pages
// behind and the background stats refresh picks them up when it likes, so product_images read 6.5 MB,
// then 12.6 MB, then 18.9 MB across one run while its rows never changed. A bar that moves between runs
// let the buffered-queries mutation (a steady 7.3 MB peak) pass one run in three. The export is the same
// bytes every time.
const largestTable = () => Math.max(0, ...Object.values(exp0?.tables ?? {}).map((rows) => Buffer.byteLength(JSON.stringify(rows))))

const bcryptLike = (h) => typeof h === 'string' && /^\$2y\$\d\d\$/.test(h) && h.length === 60

// The three rig customers back as seeded (customerRestore() and the restores above change their hashes),
// so the leak checks a mutation run re-uses still have the planted hashes to look for.
const resetCustomers = () => {
  for (const [e, k] of [['rig-backup@example.invalid', 'customerHash'], ['rig-backup2@example.invalid', 'customerHash2'], ['rig-backup3@example.invalid', 'customerHash3']]) {
    shop.sql(`update customers set password_hash = '${SECRETS[k]}' where email = '${e}'`)
  }
}

// Restores exp0 after three changes the backup never saw: customer 1 changed the password, customer 2's
// id now belongs to another email, customer 3 is gone (and the file carries an old hash for them, as a
// format-2 file from before 2026-10-07 does). Then once more with customer 3 gone and no hash at all.
async function customerRestore(call) {
  const id2 = one("select id from customers where email = 'rig-backup2@example.invalid'")
  shop.sql("update customers set password_hash = 'A_CHANGED_AFTER_BACKUP' where email = 'rig-backup@example.invalid'")
  shop.sql("update customers set email = 'rig-swapped@example.invalid' where email = 'rig-backup2@example.invalid'")
  shop.sql("delete from customers where email = 'rig-backup3@example.invalid'")
  const file = JSON.parse(JSON.stringify(exp0))
  file.tables.customers.find((c) => c.email === 'rig-backup3@example.invalid').password_hash = SECRETS.customerHash3
  const p = await call('backup_preview', { data: file })
  const im = await call('backup_import', { data: file, confirm: true, token: p.body?.token })
  const h = (e) => one(`select coalesce((select password_hash from customers where email = '${e}'), 'NONE')`)
  const r = { ok: im.status === 200, text: im.text.slice(0, 160), id2, a: h('rig-backup@example.invalid'), b: h('rig-backup2@example.invalid'),
    bId: one("select id from customers where email = 'rig-backup2@example.invalid'"), c: h('rig-backup3@example.invalid') }
  shop.sql("delete from customers where email = 'rig-backup3@example.invalid'")
  const p2 = await call('backup_preview', { data: exp0 })
  await call('backup_import', { data: exp0, confirm: true, token: p2.body?.token })
  r.d = h('rig-backup3@example.invalid')
  resetCustomers()
  return r
}

const keyedRight = (preview) => ['product_variants', 'category_art', 'site_images'].every((t) => preview?.tables?.[t]?.backup_count === n(t) && n(t) > 1)

let exp0 = null
try {
  // Signed in BEFORE the fixtures: seed() switches the account's second factor on, and a sign-in after
  // that would stop at the code prompt — every route below would then answer not_signed_in.
  shop.sql('delete from rate_limit; delete from rate_bucket')
  const call = await adminClient(shop.base)
  seed()
  const signedIn = await call('me')
  check(signedIn.status === 200 && signedIn.body && signedIn.body.email, 'signed in to the scratch panel, still signed in after the fixtures', signedIn.text.slice(0, 120))

  /* ---------------------------------------------------------------- A. the lists */
  const L = lists(BUILD())
  check(L.tables.length >= 32 && L.excluded.length >= 20, 'A BACKUP_TABLES and BACKUP_EXCLUDED read out of backup-build.php', `tables=${L.tables.length} excluded=${L.excluded.length}`)
  const both = L.tables.filter((t) => L.excluded.includes(t))
  check(both.length === 0, 'A no table is in both lists', both.join(' '))
  const manifestTables = Object.keys(schemaManifest())
  const dbTables = shop.sql('show tables').trim().split('\n')
  for (const [label, set] of [['the generated schema manifest', manifestTables], ['the database', dbTables]]) {
    const undecided = set.filter((t) => !L.tables.includes(t) && !L.excluded.includes(t))
    check(set.length >= 40 && undecided.length === 0, `A every table in ${label} is either backed up or excluded with a reason`, `${set.length} tables; undecided: ${undecided.join(' ')}`)
  }
  const missing = MUST_BACK_UP.filter((t) => !L.tables.includes(t))
  check(missing.length === 0, 'A every owner table named in the review is backed up', missing.join(' '))
  const risky = L.tables.filter((t) => NEVER.test(t) && !NEVER_EXCEPT.has(t))
  check(risky.length === 0, 'A nothing backed up is a session, credential, log, outbox, counter or cache table', risky.join(' '))
  const empty = L.tables.filter((t) => n(t) === 0)
  check(empty.length === 0, 'A every backed-up table has rows here, so a matching count proves something', empty.join(' '))

  /* ---------------------------------------------------------------- B + C. export and the daily file */
  const { out, exp } = await exportChecks(call)
  for (const r of out) check(r.ok, 'B ' + r.name, r.extra)
  exp0 = exp.body
  if (!exp0?.tables) throw new Error('the export failed, so nothing after it can be measured')
  check(exp0?.format === 2 && exp0?.binary?.category_art?.includes('bytes') && Array.isArray(exp0?.absent) && exp0.absent.length === 0,
    'B the file says format 2, names its binary columns, and no table is absent here', JSON.stringify({ f: exp0?.format, b: exp0?.binary, a: exp0?.absent }))
  const knet = JSON.parse((exp0?.tables?.settings || []).find((r) => r.name === 'knet')?.value || '{}')
  check(knet.tranportal_id === 'RIGID123' && knet.cbk_client_id === 'RIGCLIENTID' && L.redact.knet.every((k) => knet[k] === null),
    'C settings.knet: the payment IDs travel, the six payment secrets are null', JSON.stringify(knet))
  const me = (exp0?.tables?.admin_users || []).find((a) => a.email === 'manager@sporta.com.kw')
  check(me && me.totp_secret === null && Number(me.totp_enabled) === 0 && me.email_otp_hash === null && me.password_hash,
    'C admin_users: the second factor and the pending emailed code are null; the password hash travels (a restore must still let the owner in)')

  const custs = exp0?.tables?.customers || []
  check(custs.length >= 3 && custs.every((c) => c.password_hash === null && c.email) && exp0?.redacted?.customers?.includes('password_hash'),
    'C customers: every password hash is null (the email and the rest travel), and the file says so', JSON.stringify(custs.map((c) => [c.email, c.password_hash])))

  const cron = await fetch(`${shop.base}/api/cron-backup.php?key=${encodeURIComponent(cfg.cron_key)}`)
  const cj = await cron.json().catch(() => null)
  check(cron.status === 200 && cj?.ok === true && cj.tables === L.tables.length && Array.isArray(cj.absent) && cj.absent.length === 0,
    'B the daily file is written and names every table, none absent', JSON.stringify(cj))
  const gzPath = `${shop.dir}/backups/${cj?.file}`
  let file = null
  try { file = JSON.parse(gunzipSync(readFileSync(gzPath)).toString('utf8')) } catch (e) { check(false, 'B the daily file is valid gzipped JSON', String(e)) }
  const mode = existsSync(gzPath) ? (statSync(gzPath).mode & 0o777) : 0
  check(mode === 0o600 && !readdirSync(`${shop.dir}/backups`).some((f) => f.endsWith('.tmp')), 'B the daily file is 0600 and no .tmp is left behind', mode.toString(8))
  const sameShape = file && L.tables.every((t) => (file.tables?.[t]?.length ?? -1) === (exp0?.tables?.[t]?.length ?? -2))
  check(sameShape, 'B the daily file holds the same tables and row counts as the card\'s export')
  const fileText = file ? JSON.stringify(file) : ''
  const leakedFile = Object.entries(SECRETS).filter(([, v]) => v && (fileText.includes(v) || fileText.includes(b64(v)))).map(([k]) => k)
  check(file && leakedFile.length === 0, 'C no planted secret appears in the daily file either', leakedFile.join(' '))
  const pic = file?.tables?.category_art?.find((r) => r.tile === 'men' && r.variant === 'desktop' && r.fmt === 'webp')
  check(pic && sha(Buffer.from(pic.bytes, 'base64')) === one("select sha2(bytes, 256) from category_art where tile='men' and variant='desktop' and fmt='webp'"),
    'B the daily file\'s picture with every byte value 0-255 in it decodes exactly')

  /* ---------------------------------------------------------------- D. restore round trip */
  const before = checksums(L.tables)
  const exclBefore = { admin_passkeys: n('admin_passkeys'), admin_devices: n('admin_devices'), wallet_passes: n('wallet_passes'), push_subscriptions: n('push_subscriptions') }
  const ladderSlug = one('select slug from product_variants group by slug order by count(*) desc limit 1')
  const ladder = Number(one(`select count(*) from product_variants where slug = '${ladderSlug}'`))
  const seoSlug = one('select slug from product_seo limit 1')
  shop.sql(`update product_seo set title_en = 'MUTATED' where slug = '${seoSlug}'`)
  shop.sql('delete from journal_lines order by id limit 1')
  shop.sql("insert into suppliers (name) values ('Stray rig supplier')")
  shop.sql("update category_art set bytes = 'MUTATED' where tile = 'men' and variant = 'desktop' and fmt = 'webp'")
  shop.sql(`delete from product_variants where slug = '${ladderSlug}'`)
  const k2 = JSON.parse(one("select value from settings where name = 'knet'"))
  k2.tranportal_id = 'CHANGEDID'; k2.cbk_client_secret = 'RIG_SECRET_SAVED_AFTER'
  shop.sql(`update settings set value = '${JSON.stringify(k2)}' where name = 'knet'`)

  const pv = await call('backup_preview', { data: exp0 })
  const T = pv.body?.tables || {}
  check(pv.status === 200 && pv.body?.token, 'D preview answers with a token', pv.text.slice(0, 160))
  check(T.product_seo?.changed >= 1 && T.journal_lines?.added >= 1 && T.suppliers?.removed >= 1 && T.category_art?.changed >= 1
    && T.product_variants?.added >= ladder && T.settings?.changed >= 1,
    'D the preview sees every change: search text, journal line, stray supplier, picture bytes, size ladder, payment ID',
    JSON.stringify({ seo: T.product_seo, jl: T.journal_lines, sup: T.suppliers, art: T.category_art, pv: T.product_variants, set: T.settings }))
  check(T.brands?.changed === 0 && T.brands?.removed === 0 && T.brands?.added === 0 && T.site_images?.changed === 0 && T.home_banner?.changed === 0,
    'D and an untouched table — composite-keyed pictures included — reads as unchanged', JSON.stringify({ b: T.brands, s: T.site_images, h: T.home_banner }))
  check(Array.isArray(pv.body?.not_in_file) && pv.body.not_in_file.length === 0 && pv.body?.missing_here?.length === 0, 'D a full file leaves nothing "not in this file"')

  const im = await call('backup_import', { data: exp0, confirm: true, token: pv.body?.token })
  check(im.status === 200 && im.body?.ok === true, 'D the restore succeeds', im.text.slice(0, 200))
  const after = checksums(L.tables)
  const differ = L.tables.filter((t) => !['settings', 'admin_users'].includes(t) && after[t] !== before[t])
  check(differ.length === 0, 'D every table is back exactly as it was (CHECKSUM TABLE), product_variants included', differ.join(' '))
  check(Number(one(`select count(*) from product_variants where slug = '${ladderSlug}'`)) === ladder, `D the deleted size ladder (${ladder} rows) is back — the old restore wrote none`)
  const k3 = JSON.parse(one("select value from settings where name = 'knet'"))
  check(k3.tranportal_id === 'RIGID123', 'D the payment ID went back to the backup\'s', k3.tranportal_id)
  check(k3.cbk_client_secret === 'RIG_SECRET_SAVED_AFTER' && k3.tranportal_password === SECRETS.tranportal_password && k3.cbk_test_encrp_key === SECRETS.cbk_test_encrp_key,
    'D the payment secrets are the ones this shop has saved — not blanked by the null in the file, not reverted', JSON.stringify(k3))
  const otherSettings = shop.rows("select name, value from settings where name <> 'knet' order by name")
  const fileSettings = (exp0.tables.settings || []).filter((r) => r.name !== 'knet').sort((a, b) => a.name.localeCompare(b.name))
  check(JSON.stringify(otherSettings.map((r) => [r.name, r.value])) === JSON.stringify(fileSettings.map((r) => [r.name, r.value])), 'D every other settings row is the file\'s, byte for byte')
  check(one("select totp_secret from admin_users where email = 'manager@sporta.com.kw'") === 'NULL', 'D restoring admin_users switches 2FA off, as the preview warns')
  check(one("select password_hash from customers where email = 'rig-backup@example.invalid'") === SECRETS.customerHash,
    'D a customer keeps the password this shop holds: the null in the file is not written')
  check(Object.entries(exclBefore).every(([t, c]) => n(t) === c), 'D the excluded tables were not touched by the restore', JSON.stringify(exclBefore))
  const again = await call('backup_preview', { data: exp0 })
  const notSame = L.tables.filter((t) => { const d = again.body?.tables?.[t]; return !d || d.unchanged !== n(t) || d.added || d.changed || d.removed })
  check(again.status === 200 && notSame.length === 0, 'D previewing the same file after the restore: every table unchanged, row for row, by its real key', notSame.join(' '))
  check(keyedRight(again.body), 'D the preview counts product_variants (key: sku) and category_art (key: tile+variant+fmt) row by row, not as one row',
    JSON.stringify({ pv: again.body?.tables?.product_variants, art: again.body?.tables?.category_art }))
  const meAgain = await call('me')
  check(meAgain.status === 200 && meAgain.body, 'D the owner is still signed in after the restore', meAgain.text.slice(0, 120))

  /* ---------------------------------------------------------------- D2. customer passwords across a restore */
  {
    const r = await customerRestore(call)
    check(r.ok, 'D2 the restore succeeds', r.text)
    check(r.a === 'A_CHANGED_AFTER_BACKUP', 'D2 a customer who changed the password after the backup keeps the NEW one (matched by email)', r.a)
    check(r.bId === r.id2 && bcryptLike(r.b) && r.b !== SECRETS.customerHash2,
      'D2 the same id holding a DIFFERENT email does not hand its password to the restored customer: a fresh hash nobody knows', `${r.b?.slice(0, 20)}… id ${r.bId}/${r.id2}`)
    check(r.c === SECRETS.customerHash3, 'D2 an older backup that still carries a hash: it is used where this shop has none for that email', r.c?.slice(0, 30))
    check(bcryptLike(r.d) && r.d !== SECRETS.customerHash3, 'D2 a customer this shop does not have, with no hash in the file, gets a fresh one (the column is NOT NULL)', r.d?.slice(0, 20))
  }

  /* ---------------------------------------------------------------- E. other files */
  const ORIGINAL14 = MUST_BACK_UP.slice(0, 14)
  const v1 = { format: 1, exported_at: exp0.exported_at, tables: Object.fromEntries(ORIGINAL14.map((t) => [t, exp0.tables[t]])) }
  const newer = L.tables.filter((t) => !ORIGINAL14.includes(t))
  shop.sql("insert into suppliers (name) values ('Added after the old backup')")
  const keptBefore = checksums(newer)
  const p1 = await call('backup_preview', { data: v1 })
  check(p1.status === 200 && newer.every((t) => p1.body?.not_in_file?.includes(t) && p1.body?.tables?.[t]?.in_file === false),
    'E a format-1 file: the preview names the eighteen newer tables as not in this file', JSON.stringify(p1.body?.not_in_file))
  const i1 = await call('backup_import', { data: v1, confirm: true, token: p1.body?.token })
  check(i1.status === 200 && newer.every((t) => i1.body?.tables?.[t]?.kept === true), 'E and the restore reports each of them kept', i1.text.slice(0, 200))
  const keptAfter = checksums(newer)
  const wiped = newer.filter((t) => keptAfter[t] !== keptBefore[t])
  check(wiped.length === 0 && n('journal_entries') > 0 && one("select count(*) from suppliers where name = 'Added after the old backup'") === '1',
    'E restoring an older backup leaves the books, suppliers, purchase orders and every newer table exactly as they were', wiped.join(' '))

  const v3 = { ...exp0, format: 3 }
  const p3 = await call('backup_preview', { data: v3 })
  const i3 = await call('backup_import', { data: v3, confirm: true, token: p3.body?.token })
  check(i3.status === 400 && i3.body?.error === 'backup_newer_format', 'E a file from a newer format is refused', i3.text.slice(0, 120))

  const bad = JSON.parse(JSON.stringify(exp0))
  bad.tables.category_art[0].bytes = '!!!not base64!!!'
  const pb = await call('backup_preview', { data: bad })
  const ib = await call('backup_import', { data: bad, confirm: true, token: pb.body?.token })
  check(ib.status === 400 && ib.body?.error === 'bad_backup_file', 'E a picture that is not base64 is refused as bad_backup_file', ib.text.slice(0, 120))
  const obj = JSON.parse(JSON.stringify(exp0))
  obj.tables.suppliers[0].name = { nested: 'object' }
  const po = await call('backup_preview', { data: obj })
  const io = await call('backup_import', { data: obj, confirm: true, token: po.body?.token })
  check(io.status === 400 && io.body?.error === 'bad_backup_file', 'E a value that is not a scalar is refused as bad_backup_file', io.text.slice(0, 120))

  // A FILE WITH NO PAYMENT-SETTINGS ROW AT ALL — a backup taken before the Payments screen was first
  // saved. Replacing `settings` used to delete the shop's saved secrets with the row, for good: no backup
  // holds them, by design. Measured before the fix: the knet row was simply gone after the restore.
  const noKnetRestore = async () => {
    const live = JSON.parse(one("select value from settings where name = 'knet'") || '{}')
    const file = JSON.parse(JSON.stringify(exp0))
    file.tables.settings = file.tables.settings.filter((r) => r.name !== 'knet')
    const p = await call('backup_preview', { data: file })
    const i = await call('backup_import', { data: file, confirm: true, token: p.body?.token })
    const after = JSON.parse(one("select coalesce((select value from settings where name = 'knet'), '{}')") || '{}')
    shop.sql(`insert into settings (name, value) values ('knet', '${JSON.stringify(live)}') on duplicate key update value = values(value)`)
    return { status: i.status, text: i.text.slice(0, 160), live, after,
      fixture: L.redact.knet.every((k) => typeof live[k] === 'string' && live[k] !== ''),
      secretsKept: L.redact.knet.every((k) => after[k] === live[k]),
      idsGone: !('tranportal_id' in after) && !('cbk_client_id' in after) && !('mode' in after) }
  }
  {
    const r = await noKnetRestore()
    check(r.fixture, 'E (fixture) the shop has all six payment secrets saved before this restore', JSON.stringify(r.live))
    check(r.status === 200 && r.secretsKept, 'E a file with no payment-settings row: the restore keeps the six secrets this shop has saved', `${r.status} ${JSON.stringify(r.after)}`)
    check(r.idsGone, 'E and only the secrets: the IDs and the mode go back as the file has them (none)', JSON.stringify(r.after))
  }

  shop.sql('rename table customer_notes to customer_notes_aside_rig')
  try {
    const supBefore = n('suppliers')
    const pm = await call('backup_preview', { data: exp0 })
    check(pm.body?.missing_here?.includes('customer_notes'), 'E a file holding rows for a table this shop lacks: the preview names it', JSON.stringify(pm.body?.missing_here))
    const imm = await call('backup_import', { data: exp0, confirm: true, token: pm.body?.token })
    check(imm.status === 400 && imm.body?.error === 'table_not_on_this_shop:customer_notes' && n('suppliers') === supBefore,
      'E and the restore is refused by name, changing nothing', imm.text.slice(0, 120))
    const ea = await call('backup_export')
    check(ea.status === 200 && ea.body?.absent?.includes('customer_notes') && !('customer_notes' in (ea.body?.tables || {})),
      'E a table missing from the shop does not break the export; the file names it absent', ea.text.slice(0, 160))
    const ca = await (await fetch(`${shop.base}/api/cron-backup.php?key=${encodeURIComponent(cfg.cron_key)}`)).json().catch(() => null)
    check(ca?.ok === true && ca.absent?.includes('customer_notes'), 'E nor the daily file', JSON.stringify(ca))
  } finally {
    shop.sql('rename table customer_notes_aside_rig to customer_notes')
  }

  /* ---------------------------------------------------------------- F. size and memory */
  {
    const oldBuilder = shop.dir + '/backup-build-HEAD.php'
    writeFileSync(oldBuilder, execFileSync('git', ['-C', ROOT, 'show', 'HEAD:sporta-site/public_html/api/backup-build.php'], { encoding: 'utf8' }))
    const harness = shop.dir + '/measure.php'
    writeFileSync(harness, `<?php
$db = new PDO('mysql:host=localhost;dbname=' . $argv[1] . ';charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
function store_fail($e, $c = 400) { throw new RuntimeException($e); }
require $argv[2];
$start = memory_get_usage();
if ($argv[3] === 'old') {
    $json = json_encode(backup_build($db), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $bytes = strlen((string) $json); file_put_contents($argv[4], gzencode((string) $json, 6)); unset($json);
} else {
    $gz = gzopen($argv[4], 'wb6'); $bytes = 0;
    backup_write($db, function (string $s) use ($gz, &$bytes) { $bytes += strlen($s); gzwrite($gz, $s); });
    gzclose($gz);
}
echo json_encode(['start' => $start, 'peak' => memory_get_peak_usage(), 'json' => $bytes, 'gz' => filesize($argv[4])]);
`)
    const run = (file, mode) => JSON.parse(execFileSync('php', ['-d', 'memory_limit=1G', harness, shop.db, file, mode, `${shop.dir}/m-${mode}.gz`], { encoding: 'utf8' }))
    const o = run(oldBuilder, 'old')
    const w = run(BUILD(), 'new')
    const largest = largestTable()
    const mb = (x) => (x / 1048576).toFixed(1) + 'MB'
    console.log(`     size  HEAD (14 tables): json ${mb(o.json)} gz ${mb(o.gz)} peak +${mb(o.peak - o.start)}   |   new (${L.tables.length} tables): json ${mb(w.json)} gz ${mb(w.gz)} peak +${mb(w.peak - w.start)}   (largest table ${mb(largest)} in the file)`)
    check(largest > 1048576, 'F the largest table is big enough to measure against (over 1 MB in the file)', mb(largest))
    check(w.peak - w.start < largest / 2, 'F the new writer\'s peak memory stays under half the largest table: it holds one row at a time', `peak +${mb(w.peak - w.start)}, largest ${mb(largest)}`)
    check(w.peak - w.start < (o.peak - o.start) / 3, 'F and it is a fraction of what the old builder needed for fewer tables', `${mb(w.peak - w.start)} vs ${mb(o.peak - o.start)}`)
  }

  /* ---------------------------------------------------------------- G. mutations */
  const mutations = [
    ['product_seo dropped from BACKUP_TABLES', "'product_attrs', 'product_seo',", "'product_attrs',",
      async () => { const L2 = lists(BUILD()); return !L2.tables.includes('product_seo') && MUST_BACK_UP.filter((t) => !L2.tables.includes(t)).join() === 'product_seo' }],
    ['admin_passkeys moved into BACKUP_TABLES', "    'admin_users',\n];", "    'admin_users', 'admin_passkeys',\n];",
      async () => { const r = await exportChecks(call); return r.out.some((x) => !x.ok && /no excluded table|secret/.test(x.name)) }],
    ['base64 of binary columns removed', '$row[$c] = base64_encode((string) $row[$c]);', '$row[$c] = (string) $row[$c];',
      async () => { const r = await exportChecks(call); return r.out.some((x) => !x.ok && /answers 200|picture/.test(x.name)) }],
    ['payment secrets no longer redacted', 'if (array_key_exists($k, $v)) $v[$k] = null;', '/* MUTATED */',
      async () => { const r = await exportChecks(call); return r.out.some((x) => !x.ok && /secret/.test(x.name)) }],
    ['customer password hashes no longer redacted', 'if (array_key_exists($c, $row)) $row[$c] = null;', '/* MUTATED */',
      async () => { const r = await exportChecks(call); return r.out.some((x) => !x.ok && /secret/.test(x.name)) }],
    ['a customer password carried by id, not by email', "return strtolower(trim((string) ($row['email'] ?? '')));", "return (string) ($row['id'] ?? '');",
      async () => { const r = await customerRestore(call); return r.b === SECRETS.customerHash2 }],
    ['the live customer password not kept on restore', "if ($live !== '') $row['password_hash'] = $live;", "if (false) $row['password_hash'] = $live;",
      async () => { const r = await customerRestore(call); return r.a !== 'A_CHANGED_AFTER_BACKUP' }],
    ['primary key back to "id, or name for settings"', "if ((string) $c['k'] === 'PRI') $out[$t]['pk'][] = (string) $c['c'];",
      "if ((string) $c['c'] === ($t === 'settings' ? 'name' : 'id')) $out[$t]['pk'][] = (string) $c['c'];",
      async () => {
        // The restore itself no longer depends on the key (it inserts every row it is given); the PREVIEW
        // does — with the old rule product_variants and category_art have no key, and every row collapses
        // into one.
        const e = await call('backup_export'); const p = await call('backup_preview', { data: e.body })
        return !keyedRight(p.body)
      }],
    ['a table missing from the file treated as empty', "if (!array_key_exists($t, $tables)) { $result[$t] = ['before' => $before, 'kept' => true]; continue; }", '$tables[$t] = $tables[$t] ?? [];',
      async () => {
        const e = await call('backup_export')
        const old = { format: 1, exported_at: e.body.exported_at, tables: Object.fromEntries(ORIGINAL14.map((t) => [t, e.body.tables[t]])) }
        const before = n('journal_entries')
        const p = await call('backup_preview', { data: old }); await call('backup_import', { data: old, confirm: true, token: p.body?.token })
        const wipedNow = n('journal_entries') !== before
        // put the shop back for the mutations that follow
        unmutate(); const p2 = await call('backup_preview', { data: e.body }); await call('backup_import', { data: e.body, confirm: true, token: p2.body?.token })
        return wipedNow
      }],
    ['the live payment secret no longer kept on restore', "if (is_string($l) && $l !== '') $file[$k] = $l;", 'if (false) $file[$k] = $l;',
      async () => {
        const e = await call('backup_export'); const p = await call('backup_preview', { data: e.body })
        await call('backup_import', { data: e.body, confirm: true, token: p.body?.token })
        const k = JSON.parse(one("select value from settings where name = 'knet'"))
        const lost = k.tranportal_password !== SECRETS.tranportal_password
        unmutate()
        shop.sql(`update settings set value = '${JSON.stringify({ ...k, tranportal_password: SECRETS.tranportal_password, resource_key: SECRETS.resource_key, cbk_client_secret: 'RIG_SECRET_SAVED_AFTER', cbk_encrp_key: SECRETS.cbk_encrp_key, cbk_test_client_secret: SECRETS.cbk_test_client_secret, cbk_test_encrp_key: SECRETS.cbk_test_encrp_key })}' where name = 'knet'`)
        return lost
      }],
    ['the saved secrets not written back when the file has no payment-settings row', "if ($t === 'settings') {\n                foreach ($liveSecrets as $name => $live) {", "if (false) {\n                foreach ($liveSecrets as $name => $live) {",
      async () => { const r = await noKnetRestore(); return r.fixture && !r.secretsKept }],
    ['the writer back to buffered queries', '$db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);\n    try {\n        foreach ($present', '$db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);\n    try {\n        foreach ($present',
      async () => {
        const harness = shop.dir + '/measure.php'
        const w = JSON.parse(execFileSync('php', ['-d', 'memory_limit=1G', harness, shop.db, BUILD(), 'new', `${shop.dir}/m-mut.gz`], { encoding: 'utf8' }))
        return !(w.peak - w.start < largestTable() / 2)
      }],
  ]
  for (const [label, from, to, caught] of mutations) {
    if (!mutate(from, to)) { check(false, `G mutation fixture found: ${label}`); continue }
    try {
      check(await caught(), `G MUTATION CAUGHT: ${label}`)
    } catch (e) {
      check(false, `G MUTATION CAUGHT: ${label}`, String(e?.message || e))
    } finally { unmutate() }
  }

  /* ---------------------------------------------------------------- H. the original rig, on this copy */
  {
    const r = spawnSync('node', [ROOT + 'scripts/backup-test.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, BASE: shop.base, BACKUP_TEST_DB: shop.db, BACKUP_TEST_API_DIR: shop.apiDir + '/' },
      timeout: 300000,
    })
    const lines = (r.stdout || '').trim().split('\n')
    const failed = lines.filter((l) => l.startsWith('FAIL'))
    check(r.status === 0, 'H scripts/backup-test.mjs passes against this scratch copy', (failed.join(' | ') || r.stderr || lines.slice(-2).join(' ')).slice(0, 400))
    if (r.status !== 0) console.log(lines.map((l) => '       | ' + l).join('\n'))
  }
} finally {
  unmutate()
  await shop.stop()
}

console.log(fails === 0
  ? '\nall ok — every owner table is in the backup with its pictures intact, no secret travels, older files keep the newer tables, and a restore puts every table back'
  : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
