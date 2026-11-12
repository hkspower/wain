// The checkout's payment-method list (store_public_checkout_setting -> checkout_config) and the /backends KNET status must
// agree, and both must refuse a gateway that would fail AFTER the order exists. Proven on the real functions:
//   1. one placeholder rule for every gateway secret (store_placeholder_secret), not four prefixes in one place and one in another;
//   2. the orders database rule (store_gateway_db_matches): a gateway block naming another database is not ready;
//   3. KNET through CBK ("one setup"): KNET is ready exactly when the CBK side is, and the Tranportal fields are not used;
//   4. the checkout's list never offers a method the server would refuse (the storefront reads checkout_config; see
//      checkout-onepage-test for the browser side).
//   node scripts/checkout-methods-test.mjs      (needs the sandbox config and the rig's gateway configs, npm run sandbox)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = join(ROOT, 'dropin', 'php-store')
let fails = 0
const ok = (c, m, d = '') => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c || !d ? '' : '  — ' + d)) }

const T = mkdtempSync(join(tmpdir(), 'checkout-methods-'))
const KNET_BASE = join(ROOT, 'dropin', 'php-knet', 'config.php')
const CBK_BASE = join(ROOT, 'dropin', 'php-cbk', 'config.php')
for (const f of [KNET_BASE, CBK_BASE]) if (!readFileSync(f, 'utf8').includes('return')) { console.log('!! missing rig config ' + f); process.exit(2) }

// One PHP process per call keeps the cases independent (static caches inside store_config() would otherwise leak).
function php(code, env = {}) {
  const head = `<?php require_once ${JSON.stringify(join(STORE, 'store.php'))};\n`
  const file = join(T, 'case.php')
  writeFileSync(file, head + code)
  // As on the VPS: the store's own config file is named explicitly whenever the private directory is set (store_config
  // fails closed without it, by design; config-path.php).
  const base = { SPORTA_API_CONFIG_FILE: join(STORE, 'config.php') }
  const out = execFileSync('php', [file], { env: { ...process.env, ...base, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return out.trim()
}

// The gateway configs the cases edit: copies of the rig's own, so every case starts from a config the rig proves works.
const knetFile = join(T, 'knet-config.php')
const dirForPay = join(T, 'private')
rmSync(dirForPay, { recursive: true, force: true })
copyFileSync(KNET_BASE, knetFile)
const payBase = readFileSync(CBK_BASE, 'utf8')

// The store's database name, read the same way the gateways read it (the rig's store config).
const storeDb = php(`$c = store_config(); echo json_encode(['db_name' => $c['db_name'] ?? '', 'db_user' => $c['db_user'] ?? '', 'db_host' => $c['db_host'] ?? '']);`)
const SDB = JSON.parse(storeDb)
ok(!!SDB.db_name, 'the rig store config names a database (the database rule has something to compare)', storeDb)

// ---------------------------------------------------------------- 1 one placeholder rule
const ph = JSON.parse(php(`echo json_encode([
  'YOUR_' => store_placeholder_secret('YOUR_TRANPORTAL_ID'),
  'PASTE_' => store_placeholder_secret('PASTE_HERE'),
  'CHANGE_ME' => store_placeholder_secret('change_me_now'),
  'PROVIDED_BY_' => store_placeholder_secret('PROVIDED_BY_BANK'),
  'empty' => store_placeholder_secret('   '),
  'real' => store_placeholder_secret('tran89000'),
  'real_with_word' => store_placeholder_secret('ABC_YOUR_KEY'),
]);`))
ok(ph.YOUR_ && ph.PASTE_ && ph.CHANGE_ME && ph.PROVIDED_BY_ && ph.empty, 'every placeholder prefix and an empty value are refused by the one rule')
ok(!ph.real && !ph.real_with_word, 'a real value (even one containing a placeholder word after the start) is accepted')
const adminSrc = readFileSync(join(STORE, 'admin.php'), 'utf8')
ok(/store_placeholder_secret\(\$value\)/.test(adminSrc) && !/str_starts_with\(trim\(\$value\), \$placeholder\)/.test(adminSrc),
  '/backends status uses the same placeholder rule (no second, weaker copy in admin.php)')

// ---------------------------------------------------------------- 2 the database rule
// Arrays are passed as JSON and decoded in PHP, so quoting cannot go wrong.
const dbCase = (cfg) => JSON.parse(php(`$cfg = json_decode(${JSON.stringify(JSON.stringify(cfg))}, true); $store = json_decode(${JSON.stringify(JSON.stringify(SDB))}, true); echo json_encode(['ok' => store_gateway_db_matches($cfg, $store)]);`)).ok
const same = { mysql_host: SDB.db_host, mysql_name: SDB.db_name, mysql_user: SDB.db_user }
ok(dbCase(same) === true, 'a gateway block naming the store database is accepted')
ok(dbCase({}) === true, 'no mysql_* block at all borrows the store database (the rule both loaders follow)')
ok(dbCase({ ...same, mysql_name: SDB.db_name + '_other' }) === false, 'a block naming ANOTHER database is refused (pay.php would answer Unknown order after the order exists)')
ok(dbCase({ ...same, mysql_user: 'someone_else' }) === false, 'a different database user is refused too')
ok(dbCase({ ...same, mysql_host: 'db.elsewhere.example' }) === false, 'a different database host is refused too')

// ---------------------------------------------------------------- 3 readiness through the real loader
const ready = (method, path) => php(`echo store_gateway_ready(${JSON.stringify(method)}, ${JSON.stringify(path)}) ? 'yes' : 'no';`, { SPORTA_PRIVATE_CONFIG_DIR: dirForPay })
const gw = (path, env) => php(`echo store_gateway_ready(${JSON.stringify(env.method)}, ${JSON.stringify(path)}) ? 'yes' : 'no';`, { SPORTA_PRIVATE_CONFIG_DIR: env.dir ?? dirForPay })

const base = gw(knetFile, { method: 'knet', dir: dirForPay })
ok(base === 'yes', 'the rig KNET config (a config the KNET suite proves works) is ready to be offered', base)

const placeholderKnet = join(T, 'knet-placeholder.php')
{ let s = readFileSync(KNET_BASE, 'utf8'); s = s.replace(/(['"]tranportal_password['"]\s*=>\s*)[^,\n]*/, "$1'PASTE_YOUR_PASSWORD'"); writeFileSync(placeholderKnet, s) }
ok(gw(placeholderKnet, { method: 'knet' }) === 'no', 'a placeholder Tranportal password is NOT ready (KNET hidden, not offered and then refused)')

const dbOther = join(T, 'knet-dbother.php')
{ let s = readFileSync(KNET_BASE, 'utf8'); s = s.replace(/(['"]mysql_name['"]\s*=>\s*)[^,\n]*/, `$1'${SDB.db_name}_other'`); writeFileSync(dbOther, s) }
ok(gw(dbOther, { method: 'knet' }) === 'no', 'a KNET block naming another database is NOT ready')

// KNET through CBK: the Tranportal fields are placeholders; CBK is real -> KNET is ready; CBK placeholder -> not ready.
const knetPh = join(T, 'knet-ph-via.php')
{ let s = readFileSync(KNET_BASE, 'utf8'); s = s.replace(/(['"]tranportal_password['"]\s*=>\s*)[^,\n]*/, "$1'PASTE_YOUR_PASSWORD'"); writeFileSync(knetPh, s) }
const cbkDir = join(T, 'private-cbk')
rmSync(cbkDir, { recursive: true, force: true })
execFileSync('mkdir', ['-p', cbkDir])
const payFile = join(cbkDir, 'pay-config.php')
{ let s = payBase; s = s.replace(/\);\s*$/, "  'knet_via_cbk' => true,\n);"); writeFileSync(payFile, s) }
const cbkReal = gw(knetPh, { method: 'knet', dir: cbkDir })
// The CBK side's own readiness decides it. The rig CBK config is what test:tpay proves; read whether it is ready on its own.
const cbkOwn = php(`$c = require ${JSON.stringify(payFile)}; echo store_payment_config_ready('tpay', $c) ? 'yes' : 'no';`, { SPORTA_PRIVATE_CONFIG_DIR: cbkDir })
ok(cbkReal === cbkOwn && cbkOwn === 'yes', 'with knet_via_cbk on, KNET is ready exactly when the CBK side is (and the placeholder Tranportal fields do not matter)', `knet=${cbkReal} cbk=${cbkOwn}`)

const cbkNoSwitch = join(cbkDir, 'pay-config.php')
{ let s = payBase; s = s.replace(/\);\s*$/, "  'knet_via_cbk' => false,\n);"); writeFileSync(cbkNoSwitch, s) }
ok(gw(knetPh, { method: 'knet', dir: cbkDir }) === 'no', 'with knet_via_cbk OFF, a placeholder Tranportal password keeps KNET hidden', '')

// A CBK side with a placeholder secret (switch on) must hide KNET even though the Tranportal fields are real.
const cbkBad = join(cbkDir, 'pay-config.php')
{ let s = payBase; s = s.replace(/\);\s*$/, "  'knet_via_cbk' => true,\n);"); s = s.replace(/(['"]client_secret['"]\s*=>\s*)[^,\n]*/, "$1'PASTE_YOUR_SECRET'"); writeFileSync(cbkBad, s) }
ok(gw(knetFile, { method: 'knet', dir: cbkDir }) === 'no', 'with knet_via_cbk on and a placeholder CBK secret, KNET is hidden (it would fail at CBK)')

// ---------------------------------------------------------------- 4 the checkout list and the storefront contract
const list = JSON.parse(php(`echo json_encode(store_checkout_availability(['methods' => ['knet', 'cod'], 'default_method' => 'knet', 'delivery_fee_fils' => 1000, 'notice_en' => '', 'notice_ar' => ''], function ($m) { return $m === 'cod'; }));`))
ok(JSON.stringify(list.methods) === '["cod"]' && list.default_method === 'cod', 'when KNET is not ready the list is cod only and the default moves to cod')
const sf = readFileSync(join(ROOT, 'src', 'pages', 'Checkout.jsx'), 'utf8')
ok(/phpCheckoutConfig\(\)/.test(sf) && /methods=\{methods\}/.test(sf), 'the storefront reads checkout_config and passes the list to the payment choice')
const pm = readFileSync(join(ROOT, 'src', 'components', 'PaymentMethods.jsx'), 'utf8')
ok(/methods \?\? \['cod'\]/.test(pm) && /options = all\.filter/.test(pm), 'the choice shows only the offered methods, cash on delivery until the server answers')
const ck = readFileSync(join(ROOT, 'src', 'lib', 'checkout.js'), 'utf8')
ok(/payment_method_unavailable/.test(ck), 'a refused method reaches the shopper as its own reason, not a generic failure')

rmSync(T, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
