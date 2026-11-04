// scripts/vps-preflight.mjs, proved on a fake /sporta tree and a PRIVATE MariaDB.
//
// The job runs on the live VPS and prints verdicts about secrets, the schema
// and the orders table, so every promise is checked here with the real code:
// the compose file carries none of the words the Hostinger API refuses, the
// embedded script IS this repo's script, each check says OK on a tree that is
// in order and names the planted fault when one is, the two PREFLIGHT_DONE
// lines count what was printed, and not one canary secret from the fake
// config, the mail password or the database login reaches the output.
//
//   npm run test:vps-preflight     (private MariaDB on its own port; the shared rig is never touched)
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import * as D from './db-schema-diff.mjs'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const REPO = join(WEB, '..')
const TOOL = join(HERE, 'vps-preflight.mjs')

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const md5 = (b) => createHash('md5').update(b).digest('hex')
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0

const T = fs.mkdtempSync(join(tmpdir(), 'sporta-preflight-'))
const compose = (args) => {
  const r = spawnSync('node', [TOOL, 'compose', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const unpack = (b64) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')
const FORBIDDEN = ['curl', 'wget', 'require(', '$']

let inst = null
try {
  head('1. the compose file handed to the Hostinger API')
  const all = compose([])
  is(all.code === 0 && all.out.startsWith('{'), 'compose prints a JSON document', all.err.trim().slice(0, 120))
  const doc = JSON.parse(all.out)
  const svc = doc.services
  is(FORBIDDEN.every((w) => !all.out.includes(w)), 'no curl, wget, require( or $ anywhere in it')
  is(Object.keys(svc).join(',') === 'preflight,preflight-db', 'two services: preflight (files, host network) and preflight-db (database network)')
  is(svc.preflight.network_mode === 'host' && JSON.stringify(svc.preflight.volumes) === '["/docker/sporta:/sporta:ro"]' && !svc.preflight.networks,
     'the file checks run on the host network with /docker/sporta mounted read-only and nothing else')
  is(!svc['preflight-db'].network_mode && JSON.stringify(svc['preflight-db'].networks) === '["sporta-db_default"]'
     && JSON.stringify(doc.networks) === '{"sporta-db_default":{"external":true}}'
     && svc['preflight-db'].volumes.length === 4 && svc['preflight-db'].volumes.every((v) => v.endsWith(':ro'))
     && svc['preflight-db'].volumes[0] === '/docker/sporta/private/api-config.php:/run/sporta-api-config.php:ro',
     'the database checks join the external database network with the config and the three secret files mounted read-only, as the schema-diff job does')
  is(svc.preflight.image === 'node:24-alpine' && svc.preflight.restart === 'no' && svc['preflight-db'].image === 'node:24-alpine'
     && svc.preflight.command[0] === svc['preflight-db'].command[0] && /apk add --no-cache php84 php84-pdo_mysql/.test(svc.preflight.command[0])
     && / && node \/tmp\/p\.mjs run --data \/tmp\/p\.json$/.test(svc.preflight.command[0]),
     'both run node:24-alpine, add php84 + pdo_mysql, and start the embedded script with the embedded data')
  is(svc.preflight.environment.SPORTA_PREFLIGHT_PART === 'fs' && svc['preflight-db'].environment.SPORTA_PREFLIGHT_PART === 'db', 'each service is told which part it is')
  const src = unpack(svc.preflight.environment.SRC)
  const fileSrc = fs.readFileSync(TOOL, 'utf8')
  is(src === fileSrc || src.replace(/^\/\/ salt \d+\n/, '') === fileSrc, 'the embedded script is this repo\'s vps-preflight.mjs, byte for byte')
  const data = JSON.parse(unpack(svc.preflight.environment.DATA))
  const baseline = execFileSync('git', ['-C', REPO, 'rev-parse', '1eb487aa^{commit}'], { encoding: 'utf8' }).trim()
  is(data.baseline === baseline && /^[0-9a-f]{40}$/.test(data.baseline), 'the default baseline is 1eb487aa, resolved to its full SHA', data.baseline.slice(0, 7))
  const bf = Object.keys(data.baseline_files)
  is(bf.includes('api/store.php') && bf.includes('knet/pay.php') && bf.includes('pay/pay.php') && bf.includes('api/.htaccess')
     && !bf.some((p) => /(^|\/)(config\.php|README\.md|\.cbk_token\.json)$/.test(p)) && bf.every((p) => /^[0-9a-f]{32}$/.test(data.baseline_files[p].md5)),
     `the baseline's ${bf.length} api/knet/pay files travel as md5+size, never config.php, README or the token file`)
  const hf = Object.keys(data.head_files)
  is(hf.length === 31 && data.addons.every((a) => hf.includes(a)) && hf.includes('.htaccess') && hf.filter((n) => n.startsWith('fonts/')).length === 8,
     '31 HEAD files travel with it: the 22 add-ons the live index.html links, .htaccess and the 8 fonts', `${hf.length}`)
  is(data.migrations.some((m) => m.file === 'outbox-kinds.mysql.sql' && m.check === 'outbox_kind_ck')
     && data.migrations.some((m) => m.file === 'inventory.mysql.sql' && m.table === 'product_variants' && m.column === 'inventory_version')
     && data.migrations.some((m) => m.file === 'returns.mysql.sql' && m.table === 'return_request_events' && !m.column)
     && !data.migrations.some((m) => /^(install|schema|seed)\.mysql\.sql$/.test(m.file)),
     `the ${data.migrations.length} items the migrations add are listed by file: columns, tables and CHECK names`)
  is(data.proxy_ip === '172.16.1.1' && data.cod_date === '2026-09-30', 'the proxy address and the cash order\'s date are the gate\'s')

  const fsOnly = JSON.parse(compose(['--part', 'fs']).out)
  const dbOnly = JSON.parse(compose(['--part', 'db']).out)
  is(Object.keys(fsOnly.services).join() === 'preflight' && !fsOnly.networks && Object.keys(dbOnly.services).join() === 'preflight-db' && dbOnly.networks,
     '--part fs / --part db print a single-service project (the fallback when the API wants one service)')
  is(compose(['--part', 'x']).code !== 0 && compose(['--baseline', '../x']).code !== 0 && compose(['--nope']).code !== 0, 'a bad part, baseline or option is refused')
  const outFile = join(T, 'written.json')
  const w = compose(['--out', outFile, '--part', 'fs'])
  is(w.code === 0 && w.out === '' && fs.existsSync(outFile) && JSON.parse(fs.readFileSync(outFile, 'utf8')).services.preflight, '--out writes the file instead of printing it')
  const committed = join(WEB, 'ops', 'vps-preflight.compose.json')
  if (fs.existsSync(committed)) {
    const c = fs.readFileSync(committed, 'utf8')
    const cdoc = JSON.parse(c)
    const csrc = unpack(cdoc.services.preflight.environment.SRC).replace(/^\/\/ salt \d+\n/, '')
    is(FORBIDDEN.every((w) => !c.includes(w)) && Object.keys(cdoc.services).join(',') === 'preflight,preflight-db', 'ops/vps-preflight.compose.json is a two-service project with no forbidden word')
    is(csrc === fileSrc, 'and it embeds the current script (otherwise: node scripts/vps-preflight.mjs compose --out ops/vps-preflight.compose.json)')
  } else bad('ops/vps-preflight.compose.json is committed')

  head('2. a fake /sporta tree and a private MariaDB with the repository schema')
  inst = await startPrivateMariadb({ label: 'pf', portFrom: 34400 })
  const PW = randomBytes(12).toString('base64url')
  await inst.sql(`create database pf character set utf8mb4 collate utf8mb4_unicode_ci; create user 'pf'@'127.0.0.1' identified by '${PW}'; grant all on pf.* to 'pf'@'127.0.0.1'; flush privileges`)
  const inv = D.sqlInventory(D.SQLDIR)
  const order = D.toolingOrder(inv)
  const applied = D.applyAll(inst, 'pf', order)
  const broken = applied.filter((a) => !a.ok)
  is(broken.length === 0, `the ${order.length} schema files apply in the tooling order (install parts, then every migration)`, broken.map((b) => `${b.file}: ${b.message}`).join('; ').slice(0, 200))
  await inst.sql("insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, created_at) values ('PF-0930', 12.500, 'pending', 'cod', 'unfulfilled', '2026-09-30 12:00:00'), ('PF-1001', 9.000, 'pending', 'cod', 'unfulfilled', '2026-10-01 09:00:00'), ('PF-NEW', 9.000, 'pending', 'cod', 'unfulfilled', now()), ('PF-CARD', 9.000, 'pending', 'knet', 'unfulfilled', '2026-09-30 13:00:00')", 'pf')
  const id0930 = await inst.sql("select id from orders where track_id = 'PF-0930'", 'pf')

  const ROOT = join(T, 'sporta'), SITE = join(ROOT, 'site'), PRIV = join(ROOT, 'private')
  // api/knet/pay exactly as HEAD has them (what --baseline HEAD embeds), so the
  // tree can be identical to one baseline and differ from the older one.
  for (const [from, to] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    const names = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'HEAD', '--', `sporta-web/dropin/${from}`], { encoding: 'utf8' }).trim().split('\n')
    for (const n of names) {
      if (/(^|\/)(config\.php|README\.md|\.cbk_token\.json)$/.test(n)) continue
      const dest = join(SITE, to, n.slice(`sporta-web/dropin/${from}/`.length))
      fs.mkdirSync(dirname(dest), { recursive: true })
      fs.writeFileSync(dest, execFileSync('git', ['-C', REPO, 'show', `HEAD:${n}`], { maxBuffer: 64 * 1024 * 1024 }))
    }
  }
  fs.writeFileSync(join(SITE, 'api', 'config.php'), '<?php return ["db_pass" => "CANARY-LIVE-CONFIG-PHP"];\n')
  for (const a of data.addons) fs.copyFileSync(join(WEB, 'public', a), join(SITE, a))
  fs.mkdirSync(join(SITE, 'fonts'))
  for (const f of fs.readdirSync(join(WEB, 'public', 'fonts'))) fs.copyFileSync(join(WEB, 'public', 'fonts', f), join(SITE, 'fonts', f))
  const haveDist = fs.existsSync(join(WEB, 'dist', '.htaccess'))
  fs.copyFileSync(haveDist ? join(WEB, 'dist', '.htaccess') : join(WEB, 'public', '.htaccess'), join(SITE, '.htaccess'))
  const page = '<!doctype html><html><head><meta name="sporta-build" content="sporta-web" /></head><body></body></html>\n'
  fs.writeFileSync(join(SITE, 'index.html'), page)
  fs.writeFileSync(join(SITE, 'config.js'), 'window.SPORTA_CONFIG={}\n')
  fs.mkdirSync(join(PRIV, 'mail'), { recursive: true })
  fs.mkdirSync(join(PRIV, 'voice', 'admin-sessions'), { recursive: true })
  fs.writeFileSync(join(PRIV, 'mail', 'msmtprc'), 'account default\npasswordeval /bin/cat /run/sporta-mail/password\n', { mode: 0o440 })
  fs.writeFileSync(join(PRIV, 'mail', 'password'), 'CANARY-MAIL-PASSWORD-7731\n', { mode: 0o440 })
  for (const f of ['db_name', 'db_user', 'db_pass']) fs.writeFileSync(join(PRIV, f), `CANARY-${f.toUpperCase()}-SECRET\n`, { mode: 0o600 })
  if (asRoot) {
    for (const f of ['mail/msmtprc', 'mail/password']) fs.chownSync(join(PRIV, f), 0, 33)
    fs.chownSync(join(PRIV, 'voice'), 33, 33); fs.chownSync(join(PRIV, 'voice', 'admin-sessions'), 33, 33)
  }
  fs.chmodSync(join(PRIV, 'voice'), 0o700); fs.chmodSync(join(PRIV, 'voice', 'admin-sessions'), 0o700)
  const CANARIES = ['CANARY-LIVE-CONFIG-PHP', 'CANARY-MAIL-PASSWORD-7731', 'CANARY-DB_PASS-SECRET', 'CANARY-RATE-LIMIT-SECRET-ab12', 'CANARY-CRON-KEY-cd34', PW]
  const CFG = join(PRIV, 'api-config.php')
  const writeConfig = (over = {}) => {
    const c = { db_host: `127.0.0.1;port=${inst.port}`, db_name: 'pf', db_user: 'pf', db_pass: PW, trusted_proxy_ips: ['172.16.1.1'], cod_hold_hours: 24,
      rate_limit_secret: 'CANARY-RATE-LIMIT-SECRET-ab12', cron_key: 'CANARY-CRON-KEY-cd34', ...over }
    const php = (v) => (Array.isArray(v) ? `[${v.map((x) => `'${x}'`).join(', ')}]` : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "\\'")}'`)
    fs.writeFileSync(CFG, `<?php\n// fake live config\nreturn [\n${Object.entries(c).map(([k, v]) => `    '${k}' => ${php(v)},`).join('\n')}\n];\n`, { mode: 0o440 })
  }
  writeConfig()
  ok('the tree: site/ with HEAD\'s api/knet/pay, the add-ons, fonts, .htaccess and this repo\'s index.html; private/ with the config, mail/, voice/admin-sessions and three secret files', asRoot ? 'owners set (root)' : 'NOT root: owner checks will differ')

  // The job as the VPS runs it: the embedded script and data, decoded.
  const jobs = {}
  for (const [key, args] of [['head', ['--baseline', 'HEAD']], ['base', []]]) {
    const d = JSON.parse(compose(args).out)
    fs.writeFileSync(join(T, `${key}.mjs`), unpack(d.services.preflight.environment.SRC))
    fs.writeFileSync(join(T, `${key}.json`), unpack(d.services.preflight.environment.DATA))
    jobs[key] = { script: join(T, `${key}.mjs`), data: join(T, `${key}.json`) }
  }
  const pf = (part, env = {}, job = jobs.head) => {
    const r = spawnSync('node', [job.script, 'run', '--data', job.data], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, SPORTA_PREFLIGHT_PART: part, SPORTA_PREFLIGHT_ROOT: ROOT, SPORTA_PREFLIGHT_CONFIG: CFG, SPORTA_PREFLIGHT_IFACES: '127.0.0.1,172.16.1.1', ...env },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const lines = (r.stdout ?? '').trim().split('\n')
    const v = {}
    for (const l of lines) {
      const m = /^PREFLIGHT (\S+) (OK|WARN|FAIL) (.*)$/.exec(l)
      if (m) (v[m[1]] ??= []).push({ level: m[2], reason: m[3] })
    }
    const done = /^PREFLIGHT_DONE (\d+) (\d+) (\d+) part=(\w+)$/m.exec(r.stdout ?? '')
    const counted = { OK: 0, WARN: 0, FAIL: 0 }
    for (const l of lines) { const m = /^PREFLIGHT \S+ (OK|WARN|FAIL) /.exec(l); if (m) counted[m[1]]++ }
    return { code: r.status, out, lines, v, done: done ? { ok: +done[1], warn: +done[2], fail: +done[3], part: done[4] } : null, counted,
      leaked: CANARIES.filter((c) => out.includes(c)), one: (n) => v[n]?.[0] ?? { level: '-', reason: '(no line)' } }
  }
  const lv = (r, n) => `${r.one(n).level} ${r.one(n).reason.slice(0, 90)}`

  head('3. the file checks on a tree that is in order')
  {
    const r = pf('fs')
    is(r.code === 0 && r.lines[0] === 'PREFLIGHT_PART fs' && r.done && r.done.part === 'fs' && r.lines.at(-1).startsWith('PREFLIGHT_DONE '), 'the fs part runs from PREFLIGHT_PART to PREFLIGHT_DONE', r.lines.at(-1))
    is(r.done && r.done.ok === r.counted.OK && r.done.warn === r.counted.WARN && r.done.fail === r.counted.FAIL, 'PREFLIGHT_DONE counts exactly the OK, WARN and FAIL lines printed', JSON.stringify(r.done))
    is(r.one('mount').level === 'OK' && r.one('storefront').level === 'OK' && /this repo's build/.test(r.one('storefront').reason), 'mount OK; storefront OK and named as this repo\'s build', lv(r, 'storefront'))
    is(r.one('proxy-address').level === 'OK' && /172\.16\.1\.1 is an address of this host/.test(r.one('proxy-address').reason), 'proxy-address OK when 172.16.1.1 is one of the host\'s addresses', lv(r, 'proxy-address'))
    is(r.one('trusted-proxy').level === 'OK' && /covers 172\.16\.1\.1 \(1 rule, read via php\)/.test(r.one('trusted-proxy').reason), 'trusted-proxy OK, read by PHP from the real config file', lv(r, 'trusted-proxy'))
    is(r.one('mail-password').level === 'OK' && /mode 0440, owner 0:33/.test(r.one('mail-password').reason) === asRoot, 'mail-password OK with its mode and owner (never its content)', lv(r, 'mail-password'))
    is(r.one('voice-owner').level === (asRoot ? 'OK' : 'FAIL') && r.one('admin-sessions').level === (asRoot ? 'OK' : 'FAIL'), 'voice-owner and admin-sessions OK (uid 33, 0700)', `${lv(r, 'voice-owner')} | ${lv(r, 'admin-sessions')}`)
    is(r.one('baseline').level === 'OK' && /api,knet,pay vs [0-9a-f]{7}: \d+\/\d+ live files identical/.test(r.one('baseline').reason), 'baseline OK: the live api/knet/pay are byte-identical to the baseline commit (HEAD here)', lv(r, 'baseline'))
    const addons = r.v.addon ?? []
    is(addons.length === 23 && addons.every((a) => a.level === 'OK') && addons.every((a) => /: same as HEAD \(\d+ B, md5 [0-9a-f]{32}\)/.test(a.reason)),
       `every add-on and .htaccess OK, each with its size and md5 (${addons.length} lines)`, addons.find((a) => a.level !== 'OK')?.reason.slice(0, 100))
    is(r.one('fonts').level === 'OK' && /8\/8 font files same/.test(r.one('fonts').reason) && r.one('addons-summary').level === 'OK' && /31 of 31 public files identical/.test(r.one('addons-summary').reason),
       'fonts 8/8 on one line; summary 31 of 31', `${lv(r, 'fonts')} | ${lv(r, 'addons-summary')}`)
    is(r.done.fail === 0 && r.done.warn === 0, 'nothing warns or fails on a tree that is in order', JSON.stringify(r.done))
    is(r.leaked.length === 0, 'no canary (config secrets, mail password, database login) appears in the output')
  }

  head('4. the file checks, one planted fault at a time')
  {
    let r = pf('fs', { SPORTA_PREFLIGHT_IFACES: '127.0.0.1,10.0.0.5' })
    is(r.one('proxy-address').level === 'WARN' && /is not an address of this host \(2 addresses seen\)/.test(r.one('proxy-address').reason), 'proxy-address WARN when the host has no 172.16.1.1', lv(r, 'proxy-address'))
    writeConfig({ trusted_proxy_ips: [] }); r = pf('fs')
    is(r.one('trusted-proxy').level === 'FAIL' && /does not cover 172\.16\.1\.1 \(0 rules, read via php\) — every shopper would share one rate-limit bucket/.test(r.one('trusted-proxy').reason), 'trusted-proxy FAIL with an empty list, and why it matters', lv(r, 'trusted-proxy'))
    writeConfig({ trusted_proxy_ips: ['10.0.0.0/8', '172.16.1.0/24'] }); r = pf('fs')
    is(r.one('trusted-proxy').level === 'OK' && /\(2 rules, read via php\)/.test(r.one('trusted-proxy').reason), 'a CIDR that covers the address counts', lv(r, 'trusted-proxy'))
    writeConfig({ trusted_proxy_ips: ['10.0.0.0/8', '172.16.2.0/24'] }); r = pf('fs')
    is(r.one('trusted-proxy').level === 'FAIL', 'a CIDR that does not cover it does not', lv(r, 'trusted-proxy'))
    writeConfig(); r = pf('fs', { SPORTA_PREFLIGHT_PHP: '/nonexistent/php' })
    is(r.one('trusted-proxy').level === 'OK' && /read via regex \(php unavailable\)/.test(r.one('trusted-proxy').reason), 'without php the list is read by regex and says so', lv(r, 'trusted-proxy'))
    fs.writeFileSync(CFG, '<?php return [ this is not php ;\n'); r = pf('fs')
    is(r.one('trusted-proxy').level === 'FAIL' && /does not load as an array \(error:ParseError\)/.test(r.one('trusted-proxy').reason), 'a config that does not parse is FAIL by its error class, no message', lv(r, 'trusted-proxy'))
    writeConfig()
    fs.unlinkSync(join(PRIV, 'mail', 'password')); r = pf('fs')
    is(r.one('mail-password').level === 'FAIL' && /private\/mail\/password is missing \(msmtprc is there\)/.test(r.one('mail-password').reason), 'mail-password FAIL when the file is missing (V-1)', lv(r, 'mail-password'))
    fs.writeFileSync(join(PRIV, 'mail', 'password'), 'x\n', { mode: 0o400 }); if (asRoot) fs.chownSync(join(PRIV, 'mail', 'password'), 0, 0); r = pf('fs')
    is(r.one('mail-password').level === (asRoot ? 'FAIL' : 'OK') && (!asRoot || /uid 33 \(www-data\) cannot read it \(mode 0400, owner 0:0\)/.test(r.one('mail-password').reason)), 'FAIL when uid 33 cannot read it', lv(r, 'mail-password'))
    fs.writeFileSync(join(PRIV, 'mail', 'password'), ''); fs.chmodSync(join(PRIV, 'mail', 'password'), 0o444); r = pf('fs')
    is(r.one('mail-password').level === 'FAIL' && /is empty/.test(r.one('mail-password').reason), 'FAIL when it is empty', lv(r, 'mail-password'))
    fs.writeFileSync(join(PRIV, 'mail', 'password'), 'CANARY-MAIL-PASSWORD-7731\n'); fs.chmodSync(join(PRIV, 'mail', 'password'), 0o440); if (asRoot) fs.chownSync(join(PRIV, 'mail', 'password'), 0, 33)
    if (asRoot) {
      fs.chownSync(join(PRIV, 'voice'), 0, 0); r = pf('fs')
      is(r.one('voice-owner').level === 'FAIL' && /owned by uid 0, not 33/.test(r.one('voice-owner').reason), 'voice-owner FAIL when the mount is root\'s', lv(r, 'voice-owner'))
      fs.chownSync(join(PRIV, 'voice'), 33, 33)
      fs.chmodSync(join(PRIV, 'voice', 'admin-sessions'), 0o755); r = pf('fs')
      is(r.one('admin-sessions').level === 'WARN' && /mode 0755 lets other users in/.test(r.one('admin-sessions').reason), 'admin-sessions WARN when other users can read it', lv(r, 'admin-sessions'))
      fs.chmodSync(join(PRIV, 'voice', 'admin-sessions'), 0o700)
    }
    fs.rmSync(join(PRIV, 'voice', 'admin-sessions'), { recursive: true }); r = pf('fs')
    is(r.one('admin-sessions').level === 'WARN' && /does not exist yet — store_admin_session_dir\(\) creates it/.test(r.one('admin-sessions').reason), 'admin-sessions WARN when absent, with what creates it', lv(r, 'admin-sessions'))
    fs.mkdirSync(join(PRIV, 'voice', 'admin-sessions'), { mode: 0o700 }); if (asRoot) fs.chownSync(join(PRIV, 'voice', 'admin-sessions'), 33, 33)

    r = pf('fs', {}, jobs.base)
    is(r.one('baseline').level === 'WARN' && /api,knet,pay vs 1eb487a: \d+ identical, \d+ differ \(api\/[\w.-]+/.test(r.one('baseline').reason) && /\d+ baseline-only — the live backend is not that commit/.test(r.one('baseline').reason),
       'against the older baseline 1eb487aa the same tree is WARN, with the names that differ', lv(r, 'baseline'))
    fs.writeFileSync(join(SITE, 'api', 'left-behind.php'), '<?php // not in any commit\n'); r = pf('fs')
    is(r.one('baseline').level === 'WARN' && /1 live-only \(api\/left-behind\.php\)/.test(r.one('baseline').reason), 'a PHP file on live that no commit has is named as live-only', lv(r, 'baseline'))
    fs.unlinkSync(join(SITE, 'api', 'left-behind.php'))
    fs.writeFileSync(join(SITE, 'api', 'knet-payments.log'), '{"event":"pay.init"}\n'); r = pf('fs')
    is(r.one('baseline').level === 'OK', 'a log file is not a deployable and is not counted', lv(r, 'baseline'))
    fs.unlinkSync(join(SITE, 'api', 'knet-payments.log'))

    fs.appendFileSync(join(SITE, 'sporta-clock.css'), '\n/* live */\n')
    fs.unlinkSync(join(SITE, 'sporta-clock.js'))
    fs.appendFileSync(join(SITE, 'fonts', 'plex-400-latin.woff2'), 'x')
    r = pf('fs')
    const clock = r.v.addon.find((a) => a.reason.startsWith('sporta-clock.css:'))
    const liveClock = fs.readFileSync(join(SITE, 'sporta-clock.css'))
    is(clock && clock.level === 'WARN' && clock.reason === `sporta-clock.css: differs — live ${liveClock.length} B md5 ${md5(liveClock)}, HEAD ${fs.statSync(join(WEB, 'public', 'sporta-clock.css')).size} B md5 ${md5(fs.readFileSync(join(WEB, 'public', 'sporta-clock.css')))}`,
       'an add-on that differs is WARN with the live and HEAD sizes and md5s (what refreshes the manifest\'s captured-live column)', clock?.reason.slice(0, 100))
    const clockJs = r.v.addon.find((a) => a.reason.startsWith('sporta-clock.js:'))
    is(clockJs && clockJs.level === 'FAIL' && /missing on live \(the live index\.html links it: a 404/.test(clockJs.reason), 'a linked add-on missing on live is FAIL', clockJs?.reason.slice(0, 90))
    is(r.one('fonts').level === 'WARN' && /7 same, 1 differ or missing: fonts\/plex-400-latin\.woff2 live \d+ B md5 [0-9a-f]{32} \/ HEAD \d+ B md5 [0-9a-f]{32}/.test(r.one('fonts').reason), 'a font that differs is named on the fonts line', lv(r, 'fonts'))
    is(r.one('addons-summary').level === 'WARN' && /28 of 31 public files identical to HEAD, 2 differ, 1 missing/.test(r.one('addons-summary').reason), 'the summary counts them', lv(r, 'addons-summary'))
    fs.copyFileSync(join(WEB, 'public', 'sporta-clock.css'), join(SITE, 'sporta-clock.css'))
    fs.copyFileSync(join(WEB, 'public', 'sporta-clock.js'), join(SITE, 'sporta-clock.js'))
    fs.copyFileSync(join(WEB, 'public', 'fonts', 'plex-400-latin.woff2'), join(SITE, 'fonts', 'plex-400-latin.woff2'))

    fs.writeFileSync(join(SITE, 'index.html'), '<!doctype html><html><head><!-- other build --></head><body></body></html>\n'); r = pf('fs')
    is(r.one('storefront').level === 'OK' && /foreign build \(no sporta-build marker\): deploy scoped with --only, never --replace-storefront/.test(r.one('storefront').reason), 'a foreign live index.html is named as such, with the deploy rule', lv(r, 'storefront'))
    fs.writeFileSync(join(SITE, 'index.html'), page)
    r = pf('fs', { SPORTA_PREFLIGHT_ROOT: join(T, 'nowhere') })
    is(r.one('mount').level === 'FAIL' && r.done && r.done.fail === 1 && r.done.ok === 0 && /is \/docker\/sporta mounted at \/sporta\?/.test(r.one('mount').reason), 'without the mount the fs part says so and stops: DONE 0 0 1', lv(r, 'mount'))
    r = pf('fs', { SPORTA_PREFLIGHT_DATA: '' }, { script: jobs.head.script, data: join(T, 'missing.json') })
    is(r.one('data').level === 'FAIL' && r.done && r.done.fail === 1, 'without its data file the job fails loudly instead of printing nothing', lv(r, 'data'))
    r = pf('fs')
    is(r.done && r.done.fail === 0 && r.done.warn === 0 && r.leaked.length === 0, 'the tree is back in order, and still no canary in any output')
  }

  head('5. the database checks on a schema that is in order')
  {
    const r = pf('db')
    is(r.code === 0 && r.lines[0] === 'PREFLIGHT_PART db' && r.done && r.done.part === 'db', 'the db part runs from PREFLIGHT_PART to PREFLIGHT_DONE', r.lines.at(-1))
    is(r.done && r.done.ok === r.counted.OK && r.done.warn === r.counted.WARN && r.done.fail === r.counted.FAIL, 'PREFLIGHT_DONE counts exactly the lines printed', JSON.stringify(r.done))
    is(r.one('php').level === 'OK' && /php \d+\.\d+\.\d+ with pdo_mysql/.test(r.one('php').reason) && r.one('config').level === 'OK', 'php with pdo_mysql; the config loads', `${lv(r, 'php')} | ${lv(r, 'config')}`)
    is(r.one('db-connect').level === 'OK' && /connected, session READ ONLY \(server [\d.]+-MariaDB/.test(r.one('db-connect').reason), 'connected with the config\'s own credentials in a READ ONLY session', lv(r, 'db-connect'))
    is(r.one('outbox-kind-ck').level === 'OK' && /CHECK allows new,payment,cancel,reinstate \(outbox-kinds\.mysql\.sql is applied\)/.test(r.one('outbox-kind-ck').reason), 'outbox_kind_ck OK with all four kinds', lv(r, 'outbox-kind-ck'))
    const cod = r.v['cod-order-2026-09-30'] ?? []
    is(cod.length === 1 && cod[0].level === 'WARN' && cod[0].reason.startsWith(`cash order #${id0930}: payment pending, fulfilment unfulfilled, older than the hold — the first cron-stock.php --release after the backend deploy CANCELS it`),
       'the 2026-09-30 cash order: WARN, pending and unfulfilled, the sweeper would cancel it (the card order of that day is not listed)', cod[0]?.reason.slice(0, 110))
    is(r.one('cod-sweep').level === 'WARN' && /^2 unconfirmed cash orders older than the hold: the first --release after the deploy cancels them all/.test(r.one('cod-sweep').reason), 'cod-sweep WARN 2: the two old ones, not the one placed just now', lv(r, 'cod-sweep'))
    const schema = r.v.schema ?? []
    is(schema.length === new Set(data.migrations.map((m) => m.file)).size && schema.every((s) => s.level === 'OK' && /^[\w-]+\.mysql\.sql: (\d+)\/\1 present$/.test(s.reason)),
       `every migration file is OK, n/n present (${schema.length} lines)`, schema.find((s) => s.level !== 'OK')?.reason.slice(0, 100))
    is(r.one('schema-summary').level === 'OK' && new RegExp(`^${schema.length} of ${schema.length} migrations fully present on live \\(\\d+ tables, \\d+ columns seen\\)`).test(r.one('schema-summary').reason), 'schema-summary OK', lv(r, 'schema-summary'))
    is(r.done.fail === 0, 'nothing fails on a schema that is in order', JSON.stringify(r.done))
    is(r.leaked.length === 0 && !r.out.includes('PF-0930') && !/127\.0\.0\.1;port=/.test(r.out), 'no canary, no track id, no host string in the output')
  }

  head('6. the database checks, one planted fault at a time')
  {
    await inst.sql("alter table fulfilment_outbox drop constraint outbox_kind_ck; alter table fulfilment_outbox add constraint outbox_kind_ck check (kind in ('new','payment'))", 'pf')
    let r = pf('db')
    is(r.one('outbox-kind-ck').level === 'FAIL' && /CHECK allows only new,payment — lacks cancel,reinstate: apply outbox-kinds\.mysql\.sql BEFORE the backend release/.test(r.one('outbox-kind-ck').reason), 'the narrow CHECK of an older install is FAIL, naming the migration to apply first', lv(r, 'outbox-kind-ck'))
    await inst.sql('alter table fulfilment_outbox drop constraint outbox_kind_ck', 'pf'); r = pf('db')
    is(r.one('outbox-kind-ck').level === 'WARN' && /no CHECK named outbox_kind_ck/.test(r.one('outbox-kind-ck').reason), 'no constraint at all is WARN (nothing refuses the kinds)', lv(r, 'outbox-kind-ck'))
    D.applyFile(inst, 'pf', join(D.SQLDIR, 'outbox-kinds.mysql.sql'))
    is(pf('db').one('outbox-kind-ck').level === 'OK', 'and OK again once the migration is applied')

    await inst.sql('alter table orders drop column referrer_host; drop table return_request_events', 'pf'); r = pf('db')
    const attr = r.v.schema.find((s) => s.reason.startsWith('attribution.mysql.sql'))
    const ret = r.v.schema.find((s) => s.reason.startsWith('returns.mysql.sql'))
    is(attr && attr.level === 'FAIL' && attr.reason === 'attribution.mysql.sql: 3/4 present — absent: orders.referrer_host', 'a column a migration adds that live lacks is FAIL by name', attr?.reason)
    is(ret && ret.level === 'FAIL' && ret.reason === 'returns.mysql.sql: 2/3 present — absent: table return_request_events', 'a table a migration creates that live lacks is FAIL by name', ret?.reason)
    is(r.one('schema-summary').level === 'FAIL' && new RegExp(`^${r.v.schema.length - 2} of ${r.v.schema.length} migrations fully present`).test(r.one('schema-summary').reason), 'the summary counts the two', lv(r, 'schema-summary'))
    D.applyFile(inst, 'pf', join(D.SQLDIR, 'attribution.mysql.sql')); D.applyFile(inst, 'pf', join(D.SQLDIR, 'returns.mysql.sql'))
    is(pf('db').one('schema-summary').level === 'OK', 'and OK again once they are applied')

    await inst.sql("update orders set fulfilment_status = 'cancelled' where track_id = 'PF-0930'", 'pf'); r = pf('db')
    is(r.one('cod-order-2026-09-30').level === 'OK' && /payment pending, fulfilment cancelled — the sweeper leaves it alone/.test(r.one('cod-order-2026-09-30').reason) && /^1 unconfirmed cash order older than the hold: the first --release after the deploy cancels it and restocks/.test(r.one('cod-sweep').reason),
       'once the order is cancelled it is OK and the sweep count drops to 1', `${lv(r, 'cod-order-2026-09-30')} | ${lv(r, 'cod-sweep')}`)
    await inst.sql("update orders set fulfilment_status = 'unfulfilled' where track_id = 'PF-0930'", 'pf')
    writeConfig({ cod_hold_hours: 0 }); r = pf('db')
    is(r.one('cod-order-2026-09-30').level === 'OK' && /the cash hold is switched off in the config/.test(r.one('cod-order-2026-09-30').reason) && r.one('cod-sweep').level === 'OK' && /switched off/.test(r.one('cod-sweep').reason),
       'with the hold switched off nothing would be cancelled, and the number of hours is never printed', lv(r, 'cod-sweep'))
    is(!/\b24\b/.test(r.v['cod-sweep'][0].reason) && !/\b24\b/.test(pf('db').v['cod-sweep'][0].reason), 'the hold\'s hours (a config value) stay out of the output')
    await inst.sql("delete from orders where track_id = 'PF-0930'", 'pf'); writeConfig(); r = pf('db')
    is(r.one('cod-order-2026-09-30').level === 'WARN' && /no cash order dated 2026-09-30 found/.test(r.one('cod-order-2026-09-30').reason), 'no order of that date is WARN, not silence', lv(r, 'cod-order-2026-09-30'))
    await inst.sql("insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, created_at) values ('PF-0930', 12.500, 'pending', 'cod', 'unfulfilled', '2026-09-30 12:00:00')", 'pf')

    writeConfig({ db_host: '127.0.0.1;port=1' }); r = pf('db')
    is(r.one('db-connect').level === 'FAIL' && /^PDOException:\d+ — could not open a session/.test(r.one('db-connect').reason) && r.done.fail === 5
       && ['outbox-kind-ck', 'cod-order-2026-09-30', 'cod-sweep', 'schema-summary'].every((n) => r.one(n).level === 'FAIL' && /not checked: no database connection/.test(r.one(n).reason)),
       'an unreachable database is FAIL by exception class and code (no message, no host), and the four facts it guards are FAIL "not checked"', lv(r, 'db-connect'))
    is(r.leaked.length === 0 && !/127\.0\.0\.1/.test(r.out), 'and still nothing from the config in the output')
    writeConfig()
    r = pf('db', { SPORTA_PREFLIGHT_PHP: '/nonexistent/php' })
    is(r.one('php').level === 'FAIL' && /no php \(ENOENT\)/.test(r.one('php').reason) && r.done.fail === 5, 'without php the db part is FAIL and the four facts are "not checked"', lv(r, 'php'))
    r = pf('db', { SPORTA_PREFLIGHT_CONFIG: join(T, 'none.php') })
    is(r.one('config').level === 'FAIL' && r.done.fail === 5, 'without the mounted config: FAIL and "not checked"', lv(r, 'config'))
    r = pf('db')
    is(r.done.fail === 0 && r.leaked.length === 0, 'back in order')
  }

  head('7. the verdict command sums a saved log')
  {
    const log = join(T, 'job.log')
    const a = pf('fs'), b = pf('db')
    fs.writeFileSync(log, `${a.lines.join('\n')}\n${b.lines.join('\n')}\n`)
    const r = spawnSync('node', [TOOL, 'verdict', log], { encoding: 'utf8' })
    const total = /^PREFLIGHT_TOTAL (\d+) (\d+) (\d+) parts=(\S+)/m.exec(r.stdout)
    is(r.status === 0 && total && +total[1] === a.done.ok + b.done.ok && +total[2] === a.done.warn + b.done.warn && +total[3] === 0 && total[4] === 'fs,db',
       'PREFLIGHT_TOTAL adds the two parts; exit 0 with no FAIL', total?.[0])
    is(r.stdout.split('\n').filter((l) => /^PREFLIGHT \S+ WARN /.test(l)).length === a.done.warn + b.done.warn && !/^PREFLIGHT \S+ OK /m.test(r.stdout), 'it repeats the WARN and FAIL lines, not the OK ones')
    fs.writeFileSync(log, `${a.lines.join('\n')}\nPREFLIGHT x FAIL planted\nPREFLIGHT_DONE 0 0 1 part=db\n`)
    const r2 = spawnSync('node', [TOOL, 'verdict', log], { encoding: 'utf8' })
    is(r2.status === 1 && /PREFLIGHT_TOTAL \d+ \d+ 1 parts=fs,db/.test(r2.stdout), 'exit 1 when a part has a FAIL')
    fs.writeFileSync(log, `${a.lines.join('\n')}\n`)
    const r3 = spawnSync('node', [TOOL, 'verdict', log], { encoding: 'utf8' })
    is(/parts=fs \(one part only: the other service did not report\)/.test(r3.stdout), 'one PREFLIGHT_DONE line is reported as a half result')
  }
} finally {
  if (inst) inst.stop()
  fs.rmSync(T, { recursive: true, force: true })
}

console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
