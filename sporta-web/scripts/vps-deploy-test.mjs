// scripts/vps-deploy.mjs, proved against a throwaway "live site".
//
// The deploy writes into the production web root, so every promise it makes is
// checked here with the real code: the plan changes nothing; apply refuses an
// unconfirmed commit and older-code-over-newer; it never touches config.js,
// the setup tools or files only the server has; it backs up what it replaces;
// rollback restores exactly; and a deploy that breaks the site undoes itself.
//
// The "live site" is a copy of dist/ with the differences a real server has,
// served by php -S with the VPS's private-config layout, so the health checks
// hit a real store API reading a real database.
//
//   npm run test:vps-deploy     (needs dist/ — npm run release — and the sandbox)
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const DIST = join(WEB, 'dist')
const PORT = 8121

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

for (const need of [join(DIST, 'index.html'), join(DIST, 'api', 'store.php'), join(WEB, 'dropin', 'php-store', 'config.php')]) {
  if (!fs.existsSync(need)) { console.error(`missing ${need} — run npm run release and npm run sandbox first`); process.exit(1) }
}

const T = fs.mkdtempSync(join(tmpdir(), 'sporta-vpsdeploy-'))
const ROOT = join(T, 'sporta')
const LIVE = join(ROOT, 'site')
const md5 = (f) => createHash('md5').update(fs.readFileSync(f)).digest('hex')
const tree = (dir) => {
  const out = {}
  for (const p of fs.readdirSync(dir, { recursive: true })) {
    const abs = join(dir, String(p))
    if (fs.statSync(abs).isFile()) out[String(p)] = md5(abs)
  }
  return out
}
const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------- the server as it really is
fs.cpSync(DIST, LIVE, { recursive: true })
fs.writeFileSync(join(LIVE, 'config.js'), 'window.SPORTA_CONFIG={"live":true}\n')
// Live's store.php is far bigger than the repo's (measured: 112 kB vs 60 kB).
fs.appendFileSync(join(LIVE, 'api', 'store.php'), `\n// ${'live-only code '.repeat(5000)}\n`)
// A name the release cannot contain — boot.js and the add-ons ship from public/ now.
fs.writeFileSync(join(LIVE, 'server-only-addon.js'), '// live-only add-on\n')
fs.writeFileSync(join(LIVE, 'robots.txt'), 'User-agent: *\nDisallow: /old\n')
fs.rmSync(join(LIVE, 'sitemap.xml'))
for (const tool of ['knet/selftest.php', 'knet/setup-config.php', 'go-live.html', 'api/setup-admin.php', 'api/preflight.php']) {
  fs.rmSync(join(LIVE, tool), { force: true })
}
// Private configs above the web root, as on the VPS.
const PRIV = join(T, 'private')
fs.mkdirSync(join(PRIV, 'config'), { recursive: true })
fs.copyFileSync(join(WEB, 'dropin', 'php-store', 'config.php'), join(PRIV, 'api-config.php'))
for (const [from, to] of [['php-knet', 'knet-config.php'], ['php-cbk', 'pay-config.php']]) {
  const src = join(WEB, 'dropin', from, 'config.php')
  if (fs.existsSync(src)) fs.copyFileSync(src, join(PRIV, 'config', to))
}
// php -S stands in for Apache + .htaccess: real files (and PHP) as they are,
// the SPA routes as index.html, anything else a 404.
fs.writeFileSync(join(T, 'router.php'), `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = $_SERVER['DOCUMENT_ROOT'];
if ($uri !== '/' && is_file($root . $uri)) return false;
if ($uri === '/' || preg_match('#^/(shop|cart|checkout|about|contact|wishlist|track|returns|terms|privacy|review|backends(/.*)?|product/[^/]+|payment/result|invoice/[A-Za-z0-9]+)/?$#', $uri)) {
  header('Content-Type: text/html; charset=utf-8'); readfile($root . '/index.html'); return true;
}
http_response_code(404); readfile($root . '/index.html'); return true;
`)

const server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', LIVE, join(T, 'router.php')], {
  env: { ...process.env, SPORTA_API_CONFIG_FILE: join(PRIV, 'api-config.php'), SPORTA_PRIVATE_CONFIG_DIR: join(PRIV, 'config') },
  stdio: 'ignore',
})
for (let i = 0; i < 50; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}
await run('mariadb', ['sporta', '-e', 'delete from rate_limit']).catch(() => {})

const SHA = 'a'.repeat(40)
const deploy = async (env, dist = DIST) => {
  try {
    const { stdout } = await run('node', [join(HERE, 'vps-deploy.mjs'), 'run'], {
      env: { ...process.env, SPORTA_DEPLOY_ROOT: ROOT, SPORTA_DEPLOY_DIST: dist, SPORTA_DEPLOY_PROBE_BASE: `http://127.0.0.1:${PORT}`, ...env },
      maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, out: stdout }
  } catch (e) { return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` } }
}

try {
  head('compose: what is handed to the Hostinger API')
  {
    const c = async (args) => {
      try { return { code: 0, out: (await run('node', [join(HERE, 'vps-deploy.mjs'), 'compose', ...args])).stdout } }
      catch (e) { return { code: e.code, out: `${e.stdout ?? ''}${e.stderr ?? ''}` } }
    }
    const plan = await c(['--ref', 'main'])
    const doc = JSON.parse(plan.out)
    const svc = doc.services.deploy
    is(svc.volumes[0] === '/docker/sporta:/sporta:ro', 'a plan mounts the server READ-ONLY', svc.volumes[0])
    is(!/curl|wget|require\(/.test(plan.out), 'no curl, wget or require( anywhere (the API firewall refuses each)')
    is(svc.command[0].includes('$$p') && !/[^$]\$p\b/.test(svc.command[0]), 'shell variables are escaped for Compose ($$)')
    is(svc.environment.SPORTA_DEPLOY_TARBALL === 'https://codeload.github.com/hkspower/wain/tar.gz/refs/heads/main',
       'a branch ref downloads that branch from GitHub', svc.environment.SPORTA_DEPLOY_TARBALL)
    const noConfirm = await c(['--apply', '--ref', SHA])
    is(noConfirm.code !== 0 && noConfirm.out.includes('--confirm'), 'apply without --confirm is refused')
    const branchApply = await c(['--apply', '--ref', 'main', '--confirm', 'main'])
    is(branchApply.code !== 0, 'apply of a branch name (not a commit) is refused')
    const applyOk = await c(['--apply', '--ref', SHA, '--confirm', SHA])
    const a = JSON.parse(applyOk.out).services.deploy
    is(a.volumes[0] === '/docker/sporta:/sporta' && a.environment.SPORTA_DEPLOY_CONFIRM === SHA,
       'apply with the SHA named twice gets a writable mount')
    const scan = JSON.parse((await c(['--scan', '--ref', 'main'])).out).services.deploy
    is(scan.volumes[0] === '/docker/sporta:/sporta:ro' && scan.environment.SPORTA_DEPLOY_MODE === 'scan',
       'a scan mounts the server read-only')
    const jscan = JSON.parse((await c(['--scan', 'json', '--ref', 'main'])).out).services.deploy
    is(jscan.environment.SPORTA_SCAN_WHICH === 'json' && jscan.volumes[0].endsWith(':ro'), '--scan json selects the JSON scan, read-only')
    const pscan = JSON.parse((await c(['--scan', 'ports', '--edge', 'tcp/80@any,tcp/22@178.61.10.104', '--ref', 'main'])).out).services.deploy
    is(pscan.environment.SPORTA_SCAN_WHICH === 'ports' && pscan.environment.SPORTA_PORTS_EDGE === 'tcp/80@any,tcp/22@178.61.10.104'
       && pscan.volumes.length === 1 && pscan.volumes[0].endsWith(':ro') && !/\/etc\//.test(JSON.stringify(pscan)),
       '--scan ports: one read-only mount, nothing under /etc (the API refuses it)', pscan.volumes.join(' '))
    is((await c(['--scan', 'ports', '--edge', 'tcp/80@any;reboot', '--ref', 'main'])).code !== 0, 'a malformed --edge is refused')
    const rs = JSON.parse((await c(['--apply', '--ref', SHA, '--confirm', SHA, '--replace-storefront'])).out).services.deploy
    is(rs.environment.SPORTA_DEPLOY_STOREFRONT === '1', '--replace-storefront is passed to the job')
    is(!('SPORTA_DEPLOY_STOREFRONT' in a.environment), 'and is off unless asked for')
    const rb = await c(['--rollback', '../../etc'])
    is(rb.code !== 0, 'a rollback name that is not a deploy backup is refused')
  }

  head('plan changes nothing')
  {
    const before = tree(LIVE)
    const p = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: 'main' })
    is(p.code === 0 && p.out.includes('PLAN_OK'), 'the plan runs', p.out.split('\n').find((l) => l.startsWith('compare:')) ?? p.out.slice(-200))
    is(sameTree(before, tree(LIVE)), 'the live tree is byte-for-byte unchanged')
    is(/api\/store\.php \d+ -> \d+\s+SHRINKS/.test(p.out), 'older store.php over newer is flagged SHRINKS')
    is(/\(root\): [^\n]*server-only-addon\.js/.test(p.out), 'a file only the server has is listed as live-only')
    is(/held back: 5 setup tools/.test(p.out), 'the five setup tools are held back', /held back: [^\n]*/.exec(p.out)?.[0])
    is(/HEALTH live now\n\s+\/ 200 · \/shop 200 · \/checkout 200 · \/backends 200 · \/api\/api\.php\?r=products 200/.test(p.out),
       'the probes reach the site and its API')
  }

  head('apply refuses what it should')
  {
    const before = tree(LIVE)
    const wrong = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: 'b'.repeat(40) })
    is(wrong.code !== 0 && wrong.out.includes('DEPLOY_FAIL'), 'a confirm that does not match the ref is refused')
    const shrink = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA })
    is(shrink.code !== 0 && shrink.out.includes('shrink guard'), 'older code over newer stops the deploy', /DEPLOY_FAIL[^\n]*/.exec(shrink.out)?.[0])
    is(sameTree(before, tree(LIVE)), 'and nothing was written')

    // A live page from another build (no sporta-build marker): the storefront
    // guard stops a whole-site apply before anything is written, and --only
    // still goes through untouched by it.
    const page = fs.readFileSync(join(LIVE, 'index.html'), 'utf8')
    fs.writeFileSync(join(LIVE, 'index.html'), page.replace(/<meta\s+name="sporta-build"[^>]*>/, '').replace('</head>', '<!-- other build --></head>'))
    const foreign = tree(LIVE)
    const plan2 = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: SHA })
    is(/STOREFRONT the live index\.html is a different build/.test(plan2.out), 'a plan says when the live storefront is a different build')
    const sf = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1' })
    is(sf.code !== 0 && /storefront guard/.test(sf.out), 'a whole-site apply over a foreign storefront is refused', /DEPLOY_FAIL[^\n]*/.exec(sf.out)?.[0])
    is(sameTree(foreign, tree(LIVE)), 'and nothing was written')
    fs.writeFileSync(join(LIVE, 'index.html'), page)
  }

  let backup = ''
  head('apply')
  {
    const liveConfig = md5(join(LIVE, 'config.js'))
    const a = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1' })
    backup = /DEPLOY_OK (deploy-\d{8}T\d{6}Z-a{7})/.exec(a.out)?.[1] ?? ''
    is(a.code === 0 && backup !== '', 'the deploy goes through', /DEPLOY_OK[^\n]*|DEPLOY_FAIL[^\n]*/.exec(a.out)?.[0])
    is(md5(join(LIVE, 'api', 'store.php')) === md5(join(DIST, 'api', 'store.php')), 'a changed file is replaced')
    is(md5(join(LIVE, 'sitemap.xml')) === md5(join(DIST, 'sitemap.xml')), 'a missing file is added')
    is(md5(join(LIVE, 'config.js')) === liveConfig, 'config.js is untouched')
    is(fs.existsSync(join(LIVE, 'server-only-addon.js')), 'the live-only file is still there — nothing is deleted')
    is(!fs.existsSync(join(LIVE, 'knet', 'selftest.php')) && !fs.existsSync(join(LIVE, 'go-live.html')),
       'the setup tools did not come back')
    const mode = fs.statSync(join(LIVE, 'api', 'store.php')).mode & 0o777
    is(mode === 0o644, 'files land as 644', mode.toString(8))
    is(fs.existsSync(join(ROOT, 'backups', `${backup}.tar.gz`)) && fs.existsSync(join(ROOT, 'releases', `${backup}.json`)),
       'a backup and a release record are written')
  }

  head('rollback')
  {
    const r = await deploy({ SPORTA_DEPLOY_MODE: 'rollback', SPORTA_DEPLOY_BACKUP: backup })
    is(r.code === 0 && r.out.includes(`ROLLED_BACK ${backup}`), 'the named backup is restored', /ROLLED_BACK[^\n]*/.exec(r.out)?.[0])
    is(fs.statSync(join(LIVE, 'api', 'store.php')).size > fs.statSync(join(DIST, 'api', 'store.php')).size,
       'store.php is the live one again')
    is(fs.readFileSync(join(LIVE, 'robots.txt'), 'utf8').includes('/old'), 'robots.txt is the live one again')
    is(!fs.existsSync(join(LIVE, 'sitemap.xml')), 'the file the deploy added is gone again')
  }

  head('--only deploys part of the site')
  {
    // The live storefront is a different build from this repo's: a scoped
    // deploy must not compare it, let alone replace it.
    fs.writeFileSync(join(LIVE, 'index.html'), '<!-- the live storefront, another build -->\n'
      + fs.readFileSync(join(DIST, 'index.html'), 'utf8'))
    const liveIndex = md5(join(LIVE, 'index.html'))
    const p = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: 'main', SPORTA_DEPLOY_ONLY: 'api' })
    const planPart = p.out.split('== HEALTH')[0]
    is(p.code === 0 && /only=api/.test(p.out) && !/^\s+index\.html /m.test(planPart) && /api\/store\.php/.test(planPart),
       'a scoped plan compares only that folder', /compare: [^\n]*/.exec(p.out)?.[0])
    const a = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA,
      SPORTA_DEPLOY_ALLOW_SHRINK: '1', SPORTA_DEPLOY_ONLY: 'api,knet,pay' })
    const name = /DEPLOY_OK (deploy-\d{8}T\d{6}Z-a{7})/.exec(a.out)?.[1]
    is(a.code === 0 && Boolean(name), 'a backend-only deploy goes through', /DEPLOY_OK[^\n]*|DEPLOY_FAIL[^\n]*/.exec(a.out)?.[0])
    is(md5(join(LIVE, 'api', 'store.php')) === md5(join(DIST, 'api', 'store.php')), 'the backend is replaced')
    is(md5(join(LIVE, 'index.html')) === liveIndex && md5(join(LIVE, 'robots.txt')) !== md5(join(DIST, 'robots.txt')),
       'and the storefront and its root files are untouched')
    if (name) await deploy({ SPORTA_DEPLOY_MODE: 'rollback', SPORTA_DEPLOY_BACKUP: name })
  }

  head('the live scan')
  {
    // A secret that slipped into the web root: the scan must say so twice —
    // once because it is served, once because it is on disk at all.
    fs.writeFileSync(join(LIVE, '.env'), 'DB_PASS=leaked\n')
    const s = await deploy({ SPORTA_DEPLOY_MODE: 'scan', SPORTA_DEPLOY_REF: 'main' })
    is(/SCAN_DONE bad=\d+ warn=\d+/.test(s.out), 'the scan runs to its summary', /SCAN_DONE[^\n]*/.exec(s.out)?.[0] ?? s.out.slice(-200))
    is(/BAD\s+\/\.env -> 200\s+\*\*\*EXPOSED/.test(s.out), 'a served .env is reported EXPOSED')
    is(/BAD\s+secrets-shaped files in the web root: [^\n]*\.env/.test(s.out), 'and the file on disk is reported too')
    is(/ok\s+products: \d+/.test(s.out) && /ok\s+\/shop -> 200/.test(s.out), 'the routes and the API are probed')
    fs.rmSync(join(LIVE, '.env'))

    // The JSON scan, against the same stand-in: a stray source map must be
    // reported as served.
    fs.writeFileSync(join(LIVE, 'assets', 'app.js.map'), '{"version":3,"sources":["src/App.jsx"]}')
    const j = await deploy({ SPORTA_DEPLOY_MODE: 'scan', SPORTA_DEPLOY_REF: 'main', SPORTA_SCAN_WHICH: 'json' })
    is(/SCAN_DONE bad=\d+ warn=\d+/.test(j.out) && /== 3\. Refusals/.test(j.out), 'the JSON scan runs to its summary',
       /SCAN_DONE[^\n]*/.exec(j.out)?.[0] ?? j.out.slice(-200))
    is(/ok\s+\?r=products -> 200/.test(j.out) && /every name_ar is real Arabic text/.test(j.out),
       'it reads the real catalogue through the store API')
    is(/BAD\s+\/assets\/app\.js\.map is SERVED/.test(j.out), 'a served source map is reported')
    fs.rmSync(join(LIVE, 'assets', 'app.js.map'))

    // The port scan, on a planted socket table: MariaDB on every interface,
    // the stand-in site on loopback, QUIC bound, and a cloud-init drop-in
    // that turns passwords back on beneath a main file that says no.
    const PN = join(T, 'proc-net'), SSH = join(T, 'ssh')
    fs.mkdirSync(PN, { recursive: true }); fs.mkdirSync(join(SSH, 'sshd_config.d'), { recursive: true })
    const row = (i, local, st) => `   ${i}: ${local} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000     0        0 ${100 + i} 1 0 100 0 0 10 0`
    const hdr = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
    fs.writeFileSync(join(PN, 'tcp'), [hdr, row(0, '00000000:0016', '0A'), row(1, '00000000:0CEA', '0A'),
      row(2, `0100007F:${PORT.toString(16).toUpperCase().padStart(4, '0')}`, '0A'), row(3, '0100007F:9C40', '01')].join('\n') + '\n')
    fs.writeFileSync(join(PN, 'tcp6'), [hdr, row(0, '00000000000000000000000000000000:01BB', '0A')].join('\n') + '\n')
    fs.writeFileSync(join(PN, 'udp'), [hdr, row(0, '00000000:01BB', '07')].join('\n') + '\n')
    fs.writeFileSync(join(SSH, 'sshd_config'), 'Include /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication no\nPermitRootLogin prohibit-password\n')
    fs.writeFileSync(join(SSH, 'sshd_config.d', '50-cloud-init.conf'), 'PasswordAuthentication yes\n')
    const ports = async (edge) => deploy({ SPORTA_DEPLOY_MODE: 'scan', SPORTA_DEPLOY_REF: 'main', SPORTA_SCAN_WHICH: 'ports',
      SPORTA_PORTS_PROC: PN, SPORTA_PORTS_SSHD: SSH, ...(edge ? { SPORTA_PORTS_EDGE: edge } : {}) })
    const p1 = await ports()
    is(/SCAN_DONE bad=0 /.test(p1.out), 'the port scan runs; the default edge rules are not a finding', /SCAN_DONE[^\n]*/.exec(p1.out)?.[0] ?? p1.out.slice(-300))
    is(new RegExp(`ok\\s+tcp ${PORT}\\s+127\\.0\\.0\\.1 · HTTP \\d{3}.*loopback only`).test(p1.out), 'a loopback listener is asked who it is (HTTP) and passes')
    is(/WARN tcp 3306\s+0\.0\.0\.0 .*MySQL\/MariaDB on every interface/.test(p1.out), 'a database on every interface is flagged even behind the firewall')
    is(!/tcp 40000/.test(p1.out), 'an established connection is not a listener')
    is(/ok\s+tcp 443\s+\[::\]/.test(p1.out) && /WARN udp 443 \(HTTP\/3\)/.test(p1.out), 'IPv6 any is decoded; QUIC bound while the edge drops UDP is flagged')
    is(/WARN PasswordAuthentication yes/.test(p1.out), 'a cloud-init drop-in outranks the main sshd_config (first value wins)')
    const p2 = await ports('tcp/80@any,tcp/443@any,tcp/22@any,tcp/3306@any')
    is(/BAD\s+tcp 22 is open to the whole internet/.test(p2.out) && /BAD\s+tcp 3306 .*AND the firewall lets it in/.test(p2.out),
       'SSH or a database open to anyone at the edge is BAD')
  }

  head('a deploy that breaks the site undoes itself')
  {
    // A release whose page asks for an entry chunk that does not exist: the
    // white screen a half-finished upload gives.
    const broken = join(T, 'dist-broken')
    fs.cpSync(DIST, broken, { recursive: true })
    const html = fs.readFileSync(join(broken, 'index.html'), 'utf8')
    fs.writeFileSync(join(broken, 'index.html'), html.replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/, '/assets/index-MISSING0.js'))
    const before = tree(LIVE)
    const b = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1' }, broken)
    is(b.code !== 0 && /broke: [^\n]*entry chunk/.test(b.out), 'the broken entry chunk is caught', /-- broke:[^\n]*/.exec(b.out)?.[0])
    is(b.out.includes('ROLLED_BACK'), 'and rolled back without being asked')
    const after = tree(LIVE)
    const diff = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k])
    is(diff.length === 0, 'the live tree is exactly as it was', diff.slice(0, 5).join(', ') || 'identical')
  }
} finally {
  server.kill()
  fs.rmSync(T, { recursive: true, force: true })
}

console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
