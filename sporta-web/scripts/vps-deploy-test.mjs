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
fs.writeFileSync(join(LIVE, 'boot.js'), '// live-only add-on\n')
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
    is(/\(root\): [^\n]*boot\.js/.test(p.out), 'a file only the server has is listed as live-only')
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
    is(fs.existsSync(join(LIVE, 'boot.js')), 'the live-only file is still there — nothing is deleted')
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
