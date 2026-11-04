#!/usr/bin/env node
// VPS PREFLIGHT — read-only verdicts on the live server BEFORE a backend release.
//
// The release gate (ops/handoff/HANDOFF.md, "Live requirements") lists facts
// about the live VPS that must be true before the api/knet/pay release ships,
// and none of them can be seen from a session without the Hostinger
// connector. This builds the one-shot Docker Compose job that checks them on
// the VPS and prints one verdict line per fact:
//
//   PREFLIGHT <name> OK|WARN|FAIL <short reason>
//   ...
//   PREFLIGHT_DONE <n_ok> <n_warn> <n_fail> part=<fs|db>
//
// Never a configuration value, never a secret, never a row: names, counts,
// sizes, md5s of PUBLIC files and status words only. scripts/vps-preflight-test.mjs
// plants canary secrets in a fake tree and fails if one appears in the output.
//
// TWO SERVICES in one project, because two facts need two different networks:
//   preflight     network_mode host (the only way to see whether 172.16.1.1 —
//                 the address the gate says Traefik connects from — is an
//                 address of this host, i.e. a Docker bridge gateway), with
//                 /docker/sporta mounted read-only at /sporta: the config's
//                 trusted_proxy_ips, the mail password file, the voice mount's
//                 owner, the admin-sessions directory, the live api/knet/pay
//                 against a baseline commit, the live add-ons against HEAD.
//   preflight-db  on the database network (sporta-db_default, external), with
//                 the store config and the three secret files mounted exactly
//                 as ops/db/schema-diff.compose.json mounts them: PHP (php84 +
//                 pdo_mysql) requires the config and opens a READ ONLY session;
//                 the outbox_kind_ck CHECK, the 2026-09-30 cash order and what
//                 the sweeper would do to it, and every column, table and CHECK
//                 the migrations add, present or absent, by name.
// Each service ends with its own PREFLIGHT_DONE line (tagged part=fs / part=db);
// the job's verdict is the two added together. `--part fs` or `--part db`
// prints a single-service project, for a run one at a time.
//
// Nothing in the compose file is fetched from the network: the script and its
// data (the baseline's md5s, HEAD's add-on md5s, the migrations' column names)
// travel gzip+base64 in the environment, the way the other ops jobs do, so the
// job runs even for a commit that was never pushed. No curl, wget, require(
// or $ anywhere in it (asserted; the Hostinger API refuses the first three and
// Compose interpolates the last).
//
// Usage:
//   node scripts/vps-preflight.mjs compose [--baseline <ref>] [--part fs|db|all] [--out FILE]
//       Prints the compose JSON (default: both parts, baseline 1eb487aa — the
//       commit the live backend was last verified byte-identical to).
//   node scripts/vps-preflight.mjs run --data FILE          (inside the job)
//   node scripts/vps-preflight.mjs verdict <logfile>        sums the PREFLIGHT_DONE lines of a saved log
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(HERE, '..')
const REPO_ROOT = path.join(WEB, '..')
const BASELINE_DEFAULT = '1eb487aa'
const PROXY_IP = '172.16.1.1'
const COD_DATE = '2026-09-30'
// The add-on files the live index.html links (CLAUDE.md item 5); config.js is
// live-only configuration and never compared.
const ADDONS = [
  'sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css',
  'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css',
  'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css',
  'boot.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js',
  'sporta-clock.js', 'sporta-checkout-a11y.js',
]
const BUNDLES = [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]
const BUNDLE_SKIP = new Set(['config.php', 'README.md', '.cbk_token.json'])   // scripts/bundle-php.mjs never ships these
const neverTouch = (p) => /(^|\/)config\.php$/.test(p) || /(^|\/)\.cbk_token\.json$/.test(p) || /\.log$/.test(p)
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

// ================================================================ compose
function migrationItems(dir) {
  const out = []
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mysql.sql') && !['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql'].includes(f)).sort()
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '')
    for (const m of src.matchAll(/alter\s+table\s+`?(\w+)`?\s+([\s\S]*?);/gi)) {
      const table = m[1]
      for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?`?(\w+)`?/gi)) out.push({ file: f, table, column: c[1] })
      for (const c of m[2].matchAll(/add\s+constraint\s+`?(\w+)`?\s+check/gi)) out.push({ file: f, table, check: c[1] })
    }
    for (const m of src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?`?(\w+)`?\s*\(/gi)) out.push({ file: f, table: m[1] })
  }
  return out
}

function baselineFiles(ref) {
  const sha = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', `${ref}^{commit}`], { encoding: 'utf8' }).trim()
  const out = {}
  for (const [from, to] of BUNDLES) {
    const names = execFileSync('git', ['-C', REPO_ROOT, 'ls-tree', '-r', '--name-only', sha, '--', `sporta-web/dropin/${from}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    for (const n of names) {
      if (BUNDLE_SKIP.has(path.basename(n))) continue
      const buf = execFileSync('git', ['-C', REPO_ROOT, 'show', `${sha}:${n}`], { maxBuffer: 64 * 1024 * 1024 })
      out[`${to}/${n.slice(`sporta-web/dropin/${from}/`.length)}`] = { md5: md5(buf), size: buf.length }
    }
  }
  return { sha, files: out }
}

function headFiles() {
  const out = {}
  const add = (name, file) => { if (fs.existsSync(file)) { const b = fs.readFileSync(file); out[name] = { md5: md5(b), size: b.length } } else out[name] = null }
  for (const a of ADDONS) add(a, path.join(WEB, 'public', a))
  // The live .htaccess is a BUILD output (postbuild fills the CSP script
  // hashes into it), so it is compared with dist/.htaccess when a build is
  // there, never with public/.htaccess; without a build it is only measured.
  add('.htaccess', path.join(WEB, 'dist', '.htaccess'))
  const fonts = path.join(WEB, 'public', 'fonts')
  if (fs.existsSync(fonts)) for (const f of fs.readdirSync(fonts).sort()) add(`fonts/${f}`, path.join(fonts, f))
  return out
}

// gzip + base64, re-salted until the text carries none of the words the
// Hostinger API refuses (base64 of random bytes can spell "curl" by chance).
function packed(text, salt) {
  for (let i = 0; i < 64; i++) {
    const b64 = gzipSync(Buffer.from(salt(i)), { level: 9 }).toString('base64')
    if (!/curl|wget|require\(|\$/.test(b64)) return b64
  }
  throw new Error('could not encode without a forbidden word')
}

const JOB_CMD = [
  'apk add --no-cache php84 php84-pdo_mysql >/dev/null 2>&1 || apk add --no-cache php83 php83-pdo_mysql >/dev/null 2>&1 || true',
  'if [ -x /usr/bin/php84 ]; then ln -sf /usr/bin/php84 /usr/local/bin/php; elif [ -x /usr/bin/php83 ]; then ln -sf /usr/bin/php83 /usr/local/bin/php; fi',
  'printenv SRC | base64 -d | gunzip > /tmp/p.mjs',
  'printenv DATA | base64 -d | gunzip > /tmp/p.json',
  'node /tmp/p.mjs run --data /tmp/p.json',
].join(' && ')

export function buildCompose({ baseline = BASELINE_DEFAULT, part = 'all' } = {}) {
  const base = baselineFiles(baseline)
  const data = {
    tool: 'vps-preflight', baseline: base.sha, baseline_files: base.files, head_files: headFiles(),
    migrations: migrationItems(path.join(WEB, 'dropin', 'php-store')), proxy_ip: PROXY_IP, cod_date: COD_DATE, addons: ADDONS,
  }
  const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const SRC = packed(source, (i) => (i ? `// salt ${i}\n${source}` : source))
  const DATA = packed(JSON.stringify(data), (i) => JSON.stringify(i ? { ...data, salt: i } : data))
  const services = {}
  if (part === 'all' || part === 'fs') {
    services.preflight = {
      image: 'node:24-alpine', restart: 'no', network_mode: 'host',
      environment: { SRC, DATA, SPORTA_PREFLIGHT_PART: 'fs' },
      volumes: ['/docker/sporta:/sporta:ro'],
      entrypoint: ['/bin/sh', '-c'], command: [JOB_CMD],
    }
  }
  if (part === 'all' || part === 'db') {
    services['preflight-db'] = {
      image: 'node:24-alpine', restart: 'no',
      environment: { SRC, DATA, SPORTA_PREFLIGHT_PART: 'db' },
      volumes: [
        '/docker/sporta/private/api-config.php:/run/sporta-api-config.php:ro',
        '/docker/sporta/private/db_name:/run/secrets/sporta_db_name:ro',
        '/docker/sporta/private/db_user:/run/secrets/sporta_db_user:ro',
        '/docker/sporta/private/db_pass:/run/secrets/sporta_db_pass:ro',
      ],
      networks: ['sporta-db_default'],
      entrypoint: ['/bin/sh', '-c'], command: [JOB_CMD],
    }
  }
  const doc = { services }
  if (services['preflight-db']) doc.networks = { 'sporta-db_default': { external: true } }
  const out = JSON.stringify(doc)
  for (const word of ['curl', 'wget', 'require(', '$']) {
    if (out.includes(word)) throw new Error(`compose contains "${word}"`)
  }
  return { json: out, data }
}

function composeCommand(argv) {
  const opt = { baseline: BASELINE_DEFAULT, part: 'all', out: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--baseline') opt.baseline = argv[++i] ?? ''
    else if (a === '--part') opt.part = argv[++i] ?? ''
    else if (a === '--out') opt.out = argv[++i] ?? ''
    else throw new Error(`unknown option ${a}`)
  }
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(opt.baseline) || opt.baseline.includes('..')) throw new Error(`not a usable baseline ref: ${opt.baseline}`)
  if (!['all', 'fs', 'db'].includes(opt.part)) throw new Error('--part takes fs, db or all')
  const { json, data } = buildCompose(opt)
  if (opt.out) fs.writeFileSync(opt.out, json + '\n')
  else process.stdout.write(json + '\n')
  console.error(`project: sporta-preflight · part: ${opt.part} · baseline: ${data.baseline.slice(0, 7)} · ${Object.keys(data.baseline_files).length} baseline files · ${Object.keys(data.head_files).length} HEAD files · ${data.migrations.length} migration items${opt.out ? ` · written to ${opt.out}` : ''}`)
}

// ==================================================================== run
// What PHP is asked, in both parts: load the config (values stay in PHP), say
// whether trusted_proxy_ips covers the proxy address and, with --db, open a
// READ ONLY session and read the schema facts and the cash orders of the day.
// It prints ONE JSON line of verdict data: booleans, counts, names, statuses.
// No message of any exception is ever printed (a PDO message carries the
// host name): the class and the numeric code only.
const PHP_PROBE = String.raw`<?php
error_reporting(0); ini_set('display_errors', '0');
$out = ['php' => PHP_VERSION, 'pdo_mysql' => extension_loaded('pdo_mysql'), 'config' => 'unread'];
$file = (string)getenv('SPORTA_PREFLIGHT_CONFIG');
$withDb = in_array('--db', $argv, true);
$proxyIp = (string)(getenv('SPORTA_PREFLIGHT_PROXY_IP') ?: '172.16.1.1');
$codDate = (string)(getenv('SPORTA_PREFLIGHT_COD_DATE') ?: '2026-09-30');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $codDate)) $codDate = '2026-09-30';
$say = function () use (&$out) { echo json_encode($out), "\n"; exit(0); };
try {
    $cfg = require $file;
    if (!is_array($cfg)) throw new RuntimeException('not an array');
    $out['config'] = 'array';
} catch (Throwable $e) { $out['config'] = 'error:' . get_class($e); $say(); }
$rules = $cfg['trusted_proxy_ips'] ?? [];
if (is_string($rules)) $rules = preg_split('/[\s,]+/', $rules, -1, PREG_SPLIT_NO_EMPTY);
$covers = false; $n = 0;
if (is_array($rules)) foreach ($rules as $r) {
    $r = trim((string)$r); if ($r === '') continue; $n++;
    if ($r === $proxyIp) { $covers = true; continue; }
    if (preg_match('#^(\d+\.\d+\.\d+\.\d+)/(\d+)$#', $r, $m)) {
        $bits = (int)$m[2]; $ipl = ip2long($proxyIp); $nl = ip2long($m[1]);
        if ($ipl !== false && $nl !== false && $bits >= 0 && $bits <= 32) {
            $mask = $bits === 0 ? 0 : ((0xFFFFFFFF << (32 - $bits)) & 0xFFFFFFFF);
            if (($ipl & $mask) === ($nl & $mask)) $covers = true;
        }
    }
}
$out['trusted_proxy'] = ['covers' => $covers, 'rules' => $n];
$raw = $cfg['cod_hold_hours'] ?? null;
$hold = ($raw === null || $raw === '') ? 24 : max(0, min(720, (int)$raw));
$out['cod_hold_on'] = $hold > 0;
if (!$withDb) $say();
if (!extension_loaded('pdo_mysql')) { $out['db'] = 'no-pdo_mysql'; $say(); }
try {
    $pdo = new PDO('mysql:host=' . (string)($cfg['db_host'] ?? 'localhost') . ';dbname=' . (string)($cfg['db_name'] ?? '') . ';charset=utf8mb4',
        (string)($cfg['db_user'] ?? ''), (string)($cfg['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    $pdo->exec('set session transaction read only');
    $pdo->beginTransaction();
    $out['db'] = 'connected';
    $out['server'] = (string)$pdo->query('select version()')->fetchColumn();
} catch (Throwable $e) { $out['db'] = 'error:' . get_class($e) . ':' . (int)$e->getCode(); $say(); }
try {
    $q = $pdo->prepare("select check_clause as c from information_schema.check_constraints where constraint_schema = database() and table_name = 'fulfilment_outbox' and constraint_name = 'outbox_kind_ck'");
    $q->execute(); $clause = $q->fetchColumn();
    $tables = [];
    foreach ($pdo->query("select table_name as t from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE'")->fetchAll() as $r) $tables[] = $r['t'];
    $cols = [];
    foreach ($pdo->query("select table_name as t, column_name as c from information_schema.columns where table_schema = database()")->fetchAll() as $r) $cols[] = $r['t'] . '.' . $r['c'];
    $checks = [];
    foreach ($pdo->query("select table_name as t, constraint_name as c from information_schema.check_constraints where constraint_schema = database()")->fetchAll() as $r) $checks[] = $r['t'] . '.' . $r['c'];
    $kinds = null;
    if ($clause !== false && $clause !== null) { $kinds = []; if (preg_match_all("/'(\w+)'/", (string)$clause, $mm)) $kinds = $mm[1]; }
    $out['outbox'] = ['table' => in_array('fulfilment_outbox', $tables, true), 'kinds' => $kinds];
    $out['schema'] = ['tables' => $tables, 'columns' => $cols, 'checks' => $checks];
    $rows = [];
    if (in_array('orders', $tables, true)) {
        $q = $pdo->prepare("select id, payment_status, fulfilment_status, (created_at < (now() - interval ? hour)) as old from orders where payment_method = 'cod' and created_at >= ? and created_at < date_add(?, interval 1 day) order by id");
        $q->execute([max(1, $hold), $codDate, $codDate]);
        foreach ($q->fetchAll() as $r) {
            $rows[] = ['id' => (int)$r['id'], 'payment' => (string)$r['payment_status'], 'fulfilment' => (string)$r['fulfilment_status'],
                'would_cancel' => $hold > 0 && $r['payment_status'] === 'pending' && $r['fulfilment_status'] === 'unfulfilled' && (int)$r['old'] === 1];
        }
        $q = $pdo->prepare("select count(*) as n from orders where payment_method = 'cod' and payment_status = 'pending' and fulfilment_status = 'unfulfilled' and created_at < (now() - interval ? hour)");
        $q->execute([max(1, $hold)]);
        $out['cod_sweep'] = $hold > 0 ? (int)$q->fetchColumn() : 0;
    } else { $out['cod_sweep'] = null; }
    $out['cod_orders'] = $rows;
    $pdo->rollBack();
} catch (Throwable $e) { $out['query'] = 'error:' . get_class($e) . ':' . (int)$e->getCode(); }
$say();
`

const V = { ok: 0, warn: 0, fail: 0 }
function verdict(name, level, reason) {
  V[level]++
  console.log(`PREFLIGHT ${name} ${level.toUpperCase()} ${reason}`)
}
const names = (list, n = 12) => list.slice(0, n).join(' ') + (list.length > n ? ` … +${list.length - n} more` : '')
const errName = (e) => `${e?.constructor?.name ?? 'Error'}${e?.code ? ` ${e.code}` : ''}`

function phpProbe(configFile, withDb, env) {
  const php = env.SPORTA_PREFLIGHT_PHP || 'php'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sporta-preflight-'))
  const file = path.join(tmp, 'probe.php')
  fs.writeFileSync(file, PHP_PROBE)
  try {
    const r = spawnSync(php, ['-d', 'display_errors=0', file, ...(withDb ? ['--db'] : [])], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...env, SPORTA_PREFLIGHT_CONFIG: configFile },
    })
    if (r.error) return { error: `no php (${r.error.code ?? 'spawn failed'})` }
    const line = (r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).at(-1)
    if (!line) return { error: `php exited ${r.status} without a verdict line` }
    try { return JSON.parse(line) } catch { return { error: 'php printed something that is not JSON' } }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// A regex reading of trusted_proxy_ips, for when PHP is not there to ask or
// cannot load the config: a `[...]` or `array(...)` list of quoted entries,
// or one quoted string of comma/space-separated entries (what the PHP side
// also accepts).
function regexTrustedProxy(configFile, ip) {
  const src = fs.readFileSync(configFile, 'utf8')
  const m = /['"]trusted_proxy_ips['"]\s*=>\s*(?:\[([^\]]*)\]|array\s*\(([^)]*)\)|(['"])([^'"]*)\3)/.exec(src)
  if (!m) return { covers: false, rules: 0, found: false }
  const rules = m[4] !== undefined
    ? m[4].split(/[\s,]+/).filter(Boolean)
    : [...(m[1] ?? m[2] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  const covers = rules.some((r) => r === ip || (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(r) && cidrHas(r, ip)))
  return { covers, rules: rules.length, found: true }
}
function cidrHas(cidr, ip) {
  const [net, bitsS] = cidr.split('/')
  const bits = Number(bitsS)
  const toLong = (a) => a.split('.').reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0)
  if (bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return ((toLong(net) & mask) >>> 0) === ((toLong(ip) & mask) >>> 0)
}

function statOrNull(p) { try { return fs.statSync(p) } catch { return null } }
const readableBy33 = (st) => (st.uid === 33 && (st.mode & 0o400) !== 0) || (st.gid === 33 && (st.mode & 0o040) !== 0) || (st.mode & 0o004) !== 0
const octal = (st) => '0' + (st.mode & 0o777).toString(8)

function walk(root) {
  const out = []
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) visit(abs)
      else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  if (fs.existsSync(root)) visit(root)
  return out.sort()
}

function runFs(data, env) {
  const ROOT = env.SPORTA_PREFLIGHT_ROOT || '/sporta'
  const SITE = `${ROOT}/site`
  const PRIV = `${ROOT}/private`
  const configFile = env.SPORTA_PREFLIGHT_CONFIG || `${PRIV}/api-config.php`
  const ip = data.proxy_ip

  // 1. the mount
  if (!fs.existsSync(`${SITE}/index.html`)) { verdict('mount', 'fail', `${SITE}/index.html not found — is /docker/sporta mounted at /sporta?`); return }
  verdict('mount', 'ok', `${SITE} is the web root (index.html found)`)

  // 2. whose storefront is live
  try {
    const foreign = !/<meta\s+name="sporta-build"\s+content="sporta-web"/.test(fs.readFileSync(`${SITE}/index.html`, 'utf8'))
    verdict('storefront', 'ok', foreign
      ? 'live index.html is a foreign build (no sporta-build marker): deploy scoped with --only, never --replace-storefront'
      : 'live index.html is this repo\'s build (sporta-build marker present)')
  } catch (e) { verdict('storefront', 'fail', `index.html unreadable (${errName(e)})`) }

  // 3. the proxy address is one of this host's (a Docker bridge gateway)
  try {
    const addrs = env.SPORTA_PREFLIGHT_IFACES !== undefined
      ? env.SPORTA_PREFLIGHT_IFACES.split(',').filter(Boolean)
      : Object.values(os.networkInterfaces()).flat().map((i) => i.address)
    if (addrs.includes(ip)) verdict('proxy-address', 'ok', `${ip} is an address of this host (a bridge gateway: what Traefik on the host network connects from)`)
    else verdict('proxy-address', 'warn', `${ip} is not an address of this host (${addrs.length} addresses seen) — confirm what Traefik connects from in the apache container's access log before trusting it`)
  } catch (e) { verdict('proxy-address', 'fail', `could not list interfaces (${errName(e)})`) }

  // 4. trusted_proxy_ips covers it. PHP is asked first (the list as the API
  // sees it). This service mounts /docker/sporta read-only and NONE of the
  // /run/secrets/* files the live config reads its database login from
  // (ops/db/README.md), so a config that throws without them is read by regex
  // instead, and the line says so: the db service, which mounts them, is the
  // one whose `config` verdict says whether the config loads.
  try {
    if (!fs.existsSync(configFile)) verdict('trusted-proxy', 'fail', 'the store config was not found where the VPS keeps it (private/api-config.php)')
    else {
      const p = phpProbe(configFile, false, env)
      let tp, via
      if (!p.error && p.config === 'array') { tp = { ...p.trusted_proxy, found: true }; via = 'php' }
      else {
        tp = regexTrustedProxy(configFile, ip)
        via = p.error ? 'regex (php unavailable)'
          : `regex (php could not load the config: ${p.config.replace(/^error:/, '')} — this service mounts no secret file; the db part's config line says whether it loads)`
      }
      if (!tp.found) verdict('trusted-proxy', 'fail', p.error ? 'php is unavailable and no trusted_proxy_ips list is readable by regex in the config'
        : `the store config does not load as an array (${p.config}) and no trusted_proxy_ips list is readable by regex — the API would fail closed`)
      else if (tp.covers) verdict('trusted-proxy', 'ok', `trusted_proxy_ips covers ${ip} (${tp.rules} rule${tp.rules === 1 ? '' : 's'}, read via ${via})`)
      else verdict('trusted-proxy', 'fail', `trusted_proxy_ips does not cover ${ip} (${tp.rules} rule${tp.rules === 1 ? '' : 's'}, read via ${via}) — every shopper would share one rate-limit bucket: one order a minute shop-wide`)
    }
  } catch (e) { verdict('trusted-proxy', 'fail', `could not read the config (${errName(e)})`) }

  // 5. the mail password file (LIVE-SECURITY-SCAN V-1): msmtp reads it on every send
  try {
    const st = statOrNull(`${PRIV}/mail/password`)
    const rc = statOrNull(`${PRIV}/mail/msmtprc`)
    if (!st) verdict('mail-password', 'fail', `private/mail/password is missing${rc ? ' (msmtprc is there)' : ' and so is msmtprc'} — msmtp cannot send: the warehouse and password mails are dead (V-1, open since 10-31)`)
    else if (!st.isFile()) verdict('mail-password', 'fail', 'private/mail/password is not a regular file')
    else if (st.size === 0) verdict('mail-password', 'fail', 'private/mail/password is empty')
    else if (!readableBy33(st)) verdict('mail-password', 'fail', `private/mail/password exists but uid 33 (www-data) cannot read it (mode ${octal(st)}, owner ${st.uid}:${st.gid})`)
    else verdict('mail-password', 'ok', `private/mail/password present, readable by uid 33 (mode ${octal(st)}, owner ${st.uid}:${st.gid})${rc ? '' : ' — but msmtprc is missing'}`)
  } catch (e) { verdict('mail-password', 'fail', `could not stat (${errName(e)})`) }

  // 6. the voice mount (/var/lib/sporta in the container): payment logs, tts-cache, admin sessions
  try {
    const st = statOrNull(`${PRIV}/voice`)
    if (!st || !st.isDirectory()) verdict('voice-owner', 'fail', 'private/voice (the container\'s /var/lib/sporta) is missing: payment logs and the admin-session directory have nowhere to go')
    else if (st.uid !== 33) verdict('voice-owner', 'fail', `private/voice is owned by uid ${st.uid}, not 33 (www-data): PHP cannot write payment logs, tts-cache or admin sessions there`)
    else verdict('voice-owner', 'ok', `private/voice owned by uid 33 (mode ${octal(st)})`)
    const ad = statOrNull(`${PRIV}/voice/admin-sessions`)
    if (!ad) verdict('admin-sessions', 'warn', 'private/voice/admin-sessions does not exist yet — store_admin_session_dir() creates it (0700) on the first sign-in after the API release; every admin signs in again once')
    else if (!ad.isDirectory()) verdict('admin-sessions', 'fail', 'private/voice/admin-sessions exists but is not a directory')
    else if (ad.uid !== 33) verdict('admin-sessions', 'fail', `private/voice/admin-sessions is owned by uid ${ad.uid}, not 33: sessions cannot be written`)
    else if ((ad.mode & 0o077) !== 0) verdict('admin-sessions', 'warn', `private/voice/admin-sessions exists (owner 33) but mode ${octal(ad)} lets other users in; 0700 expected`)
    else verdict('admin-sessions', 'ok', `private/voice/admin-sessions exists, owner 33, mode ${octal(ad)}`)
  } catch (e) { verdict('voice-owner', 'fail', `could not stat (${errName(e)})`) }

  // 7. the live backend against the baseline commit (plan-style, names only)
  try {
    const expected = data.baseline_files
    const seen = new Set()
    const same = [], differ = [], liveOnly = []
    for (const [, dir] of BUNDLES) {
      for (const rel of walk(`${SITE}/${dir}`)) {
        const p = `${dir}/${rel}`
        if (neverTouch(p)) continue
        seen.add(p)
        const buf = fs.readFileSync(`${SITE}/${p}`)
        const e = expected[p]
        if (!e) liveOnly.push(p)
        else if (e.md5 === md5(buf)) same.push(p)
        else differ.push(p)
      }
    }
    const baseOnly = Object.keys(expected).filter((p) => !seen.has(p))
    const label = `api,knet,pay vs ${data.baseline.slice(0, 7)}`
    if (!differ.length && !liveOnly.length) verdict('baseline', 'ok', `${label}: ${same.length}/${same.length} live files identical${baseOnly.length ? `; not on live (expected: setup tools): ${names(baseOnly, 8)}` : ''}`)
    else verdict('baseline', 'warn', `${label}: ${same.length} identical, ${differ.length} differ${differ.length ? ` (${names(differ)})` : ''}, ${liveOnly.length} live-only${liveOnly.length ? ` (${names(liveOnly)})` : ''}, ${baseOnly.length} baseline-only — the live backend is not that commit: pick the baseline the release diff starts from`)
  } catch (e) { verdict('baseline', 'fail', `could not compare (${errName(e)})`) }

  // 8. the add-ons, .htaccess and fonts against HEAD: sizes and md5s of PUBLIC files
  try {
    let differing = 0, missing = 0, total = 0
    const fontsSame = [], fontsOff = []
    for (const [name, head] of Object.entries(data.head_files)) {
      const isFont = name.startsWith('fonts/')
      const st = statOrNull(`${SITE}/${name}`)
      if (!head) {
        if (name === '.htaccess') verdict('addon', 'warn', st ? `.htaccess: live ${st.size} B md5 ${md5(fs.readFileSync(`${SITE}/.htaccess`))} — not compared (no dist/.htaccess at compose time: run npm run release first)` : '.htaccess: missing on live')
        else verdict('addon', 'warn', `${name}: not in HEAD's public/ (listed as a live add-on)`)
        continue
      }
      total++
      if (!st || !st.isFile()) {
        missing++
        if (isFont) fontsOff.push(`${name} missing`)
        else verdict('addon', isFont ? 'warn' : 'fail', `${name}: missing on live (the live index.html links it: a 404 for every visitor)`)
        continue
      }
      const m = md5(fs.readFileSync(`${SITE}/${name}`))
      if (m === head.md5) { if (isFont) fontsSame.push(name); else verdict('addon', 'ok', `${name}: same as HEAD (${st.size} B, md5 ${m})`) }
      else {
        differing++
        if (isFont) fontsOff.push(`${name} live ${st.size} B md5 ${m} / HEAD ${head.size} B md5 ${head.md5}`)
        else verdict('addon', 'warn', `${name}: differs — live ${st.size} B md5 ${m}, HEAD ${head.size} B md5 ${head.md5}`)
      }
    }
    if (fontsSame.length + fontsOff.length) {
      if (!fontsOff.length) verdict('fonts', 'ok', `${fontsSame.length}/${fontsSame.length} font files same as HEAD`)
      else verdict('fonts', 'warn', `${fontsSame.length} same, ${fontsOff.length} differ or missing: ${fontsOff.join('; ')}`)
    }
    verdict('addons-summary', differing || missing ? 'warn' : 'ok', `${total - differing - missing} of ${total} public files identical to HEAD, ${differing} differ, ${missing} missing — the ones that differ are what an add-on release ships`)
  } catch (e) { verdict('addons-summary', 'fail', `could not compare (${errName(e)})`) }
}

function runDb(data, env) {
  const configFile = env.SPORTA_PREFLIGHT_CONFIG || '/run/sporta-api-config.php'
  const skip = (why) => {
    for (const n of ['outbox-kind-ck', `cod-order-${data.cod_date}`, 'cod-sweep', 'schema-summary']) verdict(n, 'fail', `not checked: ${why}`)
  }
  if (!fs.existsSync(configFile)) { verdict('config', 'fail', 'the store config is not mounted at /run/sporta-api-config.php'); skip('no config'); return }
  const p = phpProbe(configFile, true, env)
  if (p.error) { verdict('php', 'fail', `${p.error} — apk add php84 php84-pdo_mysql did not give a working php`); skip('no php'); return }
  verdict('php', p.pdo_mysql ? 'ok' : 'fail', `php ${p.php}${p.pdo_mysql ? ' with pdo_mysql' : ' WITHOUT pdo_mysql'}`)
  if (p.config !== 'array') { verdict('config', 'fail', `the store config does not load as an array (${p.config})`); skip('config does not load'); return }
  verdict('config', 'ok', 'the store config loads (values stay in PHP; nothing is printed)')
  if (!p.pdo_mysql) { skip('no pdo_mysql'); return }
  if (p.db !== 'connected') { verdict('db-connect', 'fail', `${p.db.replace(/^error:/, '')} — could not open a session with the config\'s credentials from the database network`); skip('no database connection'); return }
  verdict('db-connect', 'ok', `connected, session READ ONLY (server ${p.server})`)
  if (p.query) { verdict('db-query', 'fail', `${p.query.replace(/^error:/, '')} while reading information_schema`); skip('a query failed'); return }

  // the outbox CHECK
  const ob = p.outbox
  if (!ob.table) verdict('outbox-kind-ck', 'fail', 'table fulfilment_outbox is missing (schema.mysql.sql never applied?)')
  else if (ob.kinds === null) verdict('outbox-kind-ck', 'warn', 'no CHECK named outbox_kind_ck on fulfilment_outbox: any kind is accepted (the sweeper works; outbox-kinds.mysql.sql would add the constraint back)')
  else {
    const need = ['new', 'payment', 'cancel', 'reinstate']
    const lacking = need.filter((k) => !ob.kinds.includes(k))
    if (!lacking.length) verdict('outbox-kind-ck', 'ok', `CHECK allows ${ob.kinds.join(',')} (outbox-kinds.mysql.sql is applied)`)
    else verdict('outbox-kind-ck', 'fail', `CHECK allows only ${ob.kinds.join(',')} — lacks ${lacking.join(',')}: apply outbox-kinds.mysql.sql BEFORE the backend release or the cash sweeper's cancel is refused (error 4025) and the order keeps its stock`)
  }

  // the cash order of the day, and the sweep
  const cod = p.cod_orders ?? []
  const name = `cod-order-${data.cod_date}`
  if (p.cod_sweep === null) verdict(name, 'fail', 'table orders is missing')
  else if (!cod.length) verdict(name, 'warn', `no cash order dated ${data.cod_date} found`)
  for (const o of cod) {
    if (o.would_cancel) verdict(name, 'warn', `cash order #${o.id}: payment ${o.payment}, fulfilment ${o.fulfilment}, older than the hold — the first cron-stock.php --release after the backend deploy CANCELS it and puts its stock back (within 15 minutes of the copy); mark it packed, paid or cancelled first if that is not wanted`)
    else verdict(name, 'ok', `cash order #${o.id}: payment ${o.payment}, fulfilment ${o.fulfilment} — the sweeper leaves it alone${p.cod_hold_on ? '' : ' (the cash hold is switched off in the config)'}`)
  }
  if (p.cod_sweep !== null) {
    if (p.cod_sweep > 0) verdict('cod-sweep', 'warn', `${p.cod_sweep} unconfirmed cash order${p.cod_sweep === 1 ? '' : 's'} older than the hold: the first --release after the deploy cancels ${p.cod_sweep === 1 ? 'it' : 'them all'} and restocks`)
    else verdict('cod-sweep', 'ok', p.cod_hold_on ? 'no unconfirmed cash order older than the hold: the first --release cancels nothing' : 'the cash hold is switched off in the config: the sweeper cancels no cash order')
  }

  // every column, table and CHECK the migrations add
  const tables = new Set(p.schema.tables), cols = new Set(p.schema.columns), checks = new Set(p.schema.checks)
  const byFile = new Map()
  for (const it of data.migrations) {
    if (!byFile.has(it.file)) byFile.set(it.file, { present: [], absent: [] })
    const b = byFile.get(it.file)
    const key = it.column ? `${it.table}.${it.column}` : it.check ? `${it.table}.${it.check}` : it.table
    const has = it.column ? cols.has(key) : it.check ? checks.has(key) : tables.has(it.table)
    ;(has ? b.present : b.absent).push(it.column ? key : it.check ? `CHECK ${key}` : `table ${it.table}`)
  }
  let filesOk = 0
  for (const [file, b] of byFile) {
    const n = b.present.length + b.absent.length
    if (!b.absent.length) { filesOk++; verdict('schema', 'ok', `${file}: ${n}/${n} present`) }
    else verdict('schema', 'fail', `${file}: ${b.present.length}/${n} present — absent: ${names(b.absent, 10)}`)
  }
  verdict('schema-summary', filesOk === byFile.size ? 'ok' : 'fail', `${filesOk} of ${byFile.size} migrations fully present on live (${tables.size} tables, ${cols.size} columns seen)`)
}

function runCommand(argv) {
  let dataFile = process.env.SPORTA_PREFLIGHT_DATA ?? ''
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--data') dataFile = argv[++i] ?? ''
  const part = process.env.SPORTA_PREFLIGHT_PART || 'fs'
  console.log(`PREFLIGHT_PART ${part}`)
  let data
  try { data = JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch (e) { verdict('data', 'fail', `the job's data file could not be read (${errName(e)})`) }
  if (data) {
    try { (part === 'db' ? runDb : runFs)(data, process.env) } catch (e) { verdict('run', 'fail', `the ${part} checks threw ${errName(e)}`) }
  }
  console.log(`PREFLIGHT_DONE ${V.ok} ${V.warn} ${V.fail} part=${part}`)
}

// Sum the PREFLIGHT_DONE lines of a saved log (both parts) into one verdict.
function verdictCommand(argv) {
  const text = fs.readFileSync(argv[0], 'utf8')
  const parts = [...text.matchAll(/^PREFLIGHT_DONE (\d+) (\d+) (\d+)(?: part=(\w+))?/gm)]
  if (!parts.length) { console.log('no PREFLIGHT_DONE line in the log'); process.exit(2) }
  const sum = parts.reduce((a, m) => ({ ok: a.ok + Number(m[1]), warn: a.warn + Number(m[2]), fail: a.fail + Number(m[3]) }), { ok: 0, warn: 0, fail: 0 })
  for (const l of text.split('\n')) if (/^PREFLIGHT \S+ (WARN|FAIL) /.test(l)) console.log(l)
  console.log(`PREFLIGHT_TOTAL ${sum.ok} ${sum.warn} ${sum.fail} parts=${parts.map((m) => m[4] ?? '?').join(',')}${parts.length < 2 ? ' (one part only: the other service did not report)' : ''}`)
  process.exit(sum.fail ? 1 : 0)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'compose') {
  try { composeCommand(rest) } catch (e) { console.error(e.message); process.exit(2) }
} else if (cmd === 'run') {
  runCommand(rest)
} else if (cmd === 'verdict') {
  verdictCommand(rest)
} else if (cmd !== undefined || import.meta.url === `file://${process.argv[1]}`) {
  console.error('usage: node scripts/vps-preflight.mjs compose [--baseline REF] [--part fs|db|all] [--out FILE]\n'
    + '       node scripts/vps-preflight.mjs run --data FILE      (inside the VPS job)\n'
    + '       node scripts/vps-preflight.mjs verdict LOGFILE')
  process.exit(2)
}
