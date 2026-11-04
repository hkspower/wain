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
    is(!plan.out.includes('$'), 'no $ anywhere either (Compose would interpolate it; the bootstrap uses no shell variable)')
    is(!('SPORTA_DEPLOY_QUIET' in svc.environment) && !('SPORTA_DEPLOY_JSON' in svc.environment), 'a plain plan is neither quiet nor json')
    const qj = JSON.parse((await c(['--ref', 'main', '--quiet', '--json'])).out).services.deploy
    is(qj.environment.SPORTA_DEPLOY_QUIET === '1' && qj.environment.SPORTA_DEPLOY_JSON === '1' && qj.volumes[0].endsWith(':ro'),
       '--quiet and --json reach the job as environment, still read-only')
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
    const bscan = JSON.parse((await c(['--scan', 'backends', '--ref', 'main'])).out).services.deploy
    is(bscan.environment.SPORTA_SCAN_WHICH === 'backends' && bscan.volumes[0].endsWith(':ro'), '--scan backends selects the admin scan, read-only')
    const kscan = JSON.parse((await c(['--scan', 'knet', '--ref', 'main'])).out).services.deploy
    is(kscan.environment.SPORTA_SCAN_WHICH === 'knet' && kscan.volumes.length === 1 && kscan.volumes[0].endsWith(':ro'), '--scan knet selects the KNET scan, read-only')
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

    // What the person watching sees: four numbered stages with the seconds
    // since the job began, a running count, a summary block, then the marker.
    const stages = [...p.out.matchAll(/^== (\d)\/4 ([a-z ]+) \(\+\d+\.\d+s\)$/gm)].map((m) => `${m[1]} ${m[2]}`)
    is(stages.join(', ') === '1 build, 2 compare, 3 live health, 4 result', 'a plan prints its four stages, numbered, each with elapsed seconds', stages.join(', '))
    is(/^  compared \d+ paths in \d+\.\d+s$/m.test(p.out) && /^-- changed \(live bytes -> release bytes\): \d+ files$/m.test(p.out), 'the compare stage says how many paths it compared and how many differ')
    const lines = p.out.trim().split('\n')
    const sumAt = lines.findIndex((l) => /^== SUMMARY plan ref=main \(\+\d+\.\d+s\)$/.test(l))
    is(sumAt > 0 && /^  compared \d+: same \d+ · changed \d+ · new \d+ · live-only \d+$/.test(lines[sumAt + 1])
       && /^  an apply of this ref would copy \d+ files \(\d+ replaced, \d+ added\) — SHRINK GUARD would refuse 1 without --allow-shrink$/.test(lines[sumAt + 2])
       && lines.at(-1) === 'PLAN_OK nothing was changed',
       'the summary block names the counts and the guard that would refuse, and PLAN_OK is the last line', lines.slice(sumAt, sumAt + 3).join(' | '))
    is(!/^storefront:/m.test(p.out), 'no storefront line when the live page is this repo\'s own build')

    // --json: one DEPLOY_JSON line at the very end, with the same facts.
    const pj = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: 'main', SPORTA_DEPLOY_JSON: '1' })
    const jl = pj.out.trim().split('\n')
    const jsonLine = jl.at(-1)
    let j = null
    try { j = JSON.parse(jsonLine.replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
    is(jsonLine.startsWith('DEPLOY_JSON {') && j && jl.filter((l) => l.startsWith('DEPLOY_JSON')).length === 1 && jl.at(-2) === 'PLAN_OK nothing was changed',
       '--json appends exactly one DEPLOY_JSON line after the marker')
    const compare = /compare: same (\d+) · changed (\d+) · new (\d+) · live-only (\d+)/.exec(pj.out)
    is(j && j.tool === 'vps-deploy' && j.mode === 'plan' && j.result === 'PLAN_OK' && j.stages.length === 4 && typeof j.elapsed_s === 'number'
       && j.plan.same === Number(compare[1]) && j.plan.changed === Number(compare[2]) && j.plan.added === Number(compare[3]) && j.plan.live_only === Number(compare[4])
       && j.plan.shrinks.includes('api/store.php') && j.plan.changed_files.includes('api/store.php') && j.health_before['/'] === 200 && j.health_before.products > 0,
       'the JSON carries mode, result, the four stages, the compare counts, the shrink list and the health statuses',
       j ? `${Object.keys(j).join(',')}; plan ${JSON.stringify({ same: j.plan.same, changed: j.plan.changed, shrinks: j.plan.shrinks })}` : jsonLine.slice(0, 120))

    // --quiet: the per-file lines go, the counts, guards, health and markers stay.
    const pq = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: 'main', SPORTA_DEPLOY_QUIET: '1' })
    is(pq.code === 0 && !/^\s+api\/store\.php \d+ -> /m.test(pq.out) && /^-- changed \(live bytes -> release bytes\): \d+ files \(names dropped by --quiet\)$/m.test(pq.out)
       && /^compare: same/m.test(pq.out) && /SHRINK GUARD: 1 file\(s\)[^\n]*api\/store\.php/.test(pq.out) && /HEALTH live now/.test(pq.out)
       && /^== SUMMARY plan/m.test(pq.out) && pq.out.trim().endsWith('PLAN_OK nothing was changed'),
       '--quiet drops the per-file lines and keeps the counts, the shrink guard, the health and the markers')
    is(pq.out.trim().split('\n').length < lines.length, 'so a quiet plan is shorter', `${pq.out.trim().split('\n').length} < ${lines.length} lines`)
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
    // The foreign build's files are counted on one line, never listed: in this
    // fixture index.html and robots.txt differ and sitemap.xml is missing.
    is(/^storefront: the live index\.html is a foreign build — \d+ of its files compared \(changed 2 · same \d+ · new 1 · live-only 0(?: · \d+ would shrink: [^)]+)?\), counted here and never listed; a whole-site apply refuses without --replace-storefront$/m.test(plan2.out)
       && !/^\s+index\.html \d+ -> /m.test(plan2.out) && /SHRINK GUARD would refuse \d+ without --allow-shrink — STOREFRONT GUARD would refuse without --replace-storefront/.test(plan2.out),
       'an unscoped plan over a foreign storefront counts that bundle on one line and lists none of it', /^storefront:[^\n]*/m.exec(plan2.out)?.[0]?.slice(0, 120))
    is(/^  scoped, the release set without the storefront: --only [\w.,-]*api[\w.,-]*$/m.test(plan2.out) && !/--only [^\n]*index\.html/.test(plan2.out),
       'and prints the --only list that would ship the rest', /--only [^\n]*/.exec(plan2.out)?.[0]?.slice(0, 100))
    // The hint is the RELEASE SET (backend folders, .htaccess, fonts, root
    // add-ons), never an icon or a logo, and it says it is a scope, not a
    // verdict on each add-on: a root add-on that differs is in it, a root
    // image that is new is named apart.
    // Planted: a root image missing on live (new), this repo's own offline
    // stylesheet missing on live (new, a root .css that is NOT an add-on the
    // live page links), and a changed root add-on.
    fs.rmSync(join(LIVE, 'favicon.png'))
    fs.rmSync(join(LIVE, 'backends-offline.css'))
    fs.appendFileSync(join(LIVE, 'sporta-grid.css'), '\n/* live */\n')
    const plan3 = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_JSON: '1' })
    const hintLine = /^  scoped, the release set without the storefront: --only ([\w.,-]+)$/m.exec(plan3.out)?.[1] ?? ''
    const hintNames = hintLine.split(',')
    is(hintNames.includes('api') && hintNames.includes('sporta-grid.css') && !hintNames.includes('favicon.png') && !hintNames.includes('backends-offline.css')
       && hintNames.every((n) => /^(api|knet|pay|\.htaccess|fonts|boot\.js|birthday\.js|sporta-[\w.-]+\.(js|css))$/.test(n)),
       'the --only hint carries the backend and a changed sporta-* add-on, never a root image or a root .css that is not an add-on', hintLine.slice(0, 100))
    is(/^  \(a scope, not a verdict: an add-on that calls a route or reads a key the live backend lacks ships with the api release, never before it — the release manifest decides per file; 2 other root files differ and are left out: backends-offline\.css favicon\.png\)$/m.test(plan3.out),
       'and the next line says it is a scope, not a verdict, and names the two root files it left out', /^  \(a scope[^\n]*/m.exec(plan3.out)?.[0]?.slice(0, 160))
    {
      let j = null
      try { j = JSON.parse(plan3.out.trim().split('\n').at(-1).replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
      is(j && j.plan.scope_hint.includes('sporta-grid.css') && j.plan.scope_hint.includes('api') && !j.plan.scope_hint.includes('favicon.png') && j.plan.scope_other.join() === 'backends-offline.css,favicon.png',
         'the JSON carries the same split: scope_hint and scope_other', j ? `${j.plan.scope_hint.join(',')} | ${j.plan.scope_other.join(',')}` : 'no JSON')
    }
    fs.copyFileSync(join(DIST, 'favicon.png'), join(LIVE, 'favicon.png'))
    fs.copyFileSync(join(DIST, 'backends-offline.css'), join(LIVE, 'backends-offline.css'))
    fs.copyFileSync(join(DIST, 'sporta-grid.css'), join(LIVE, 'sporta-grid.css'))
    const sf = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1', SPORTA_DEPLOY_JSON: '1' })
    is(sf.code !== 0 && /storefront guard/.test(sf.out), 'a whole-site apply over a foreign storefront is refused', /DEPLOY_FAIL[^\n]*/.exec(sf.out)?.[0])
    is(sameTree(foreign, tree(LIVE)), 'and nothing was written')
    {
      let j = null
      try { j = JSON.parse(sf.out.trim().split('\n').at(-1).replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
      is(j && j.result === 'DEPLOY_FAIL' && /storefront guard/.test(j.fail) && j.plan.storefront_foreign === true && j.health_before['/'] === 200,
         'a refused apply still ends with its DEPLOY_JSON line (result DEPLOY_FAIL, the reason, the plan so far)', j ? `${j.result}: ${j.fail?.slice(0, 60)}` : 'no JSON')
    }

    // A foreign storefront with a BIG bundle: 400 live-only hashed assets and
    // every shipped asset differing. The log the connector reads back keeps
    // 300 entries, so the plan must count them, not list them.
    const extra = []
    for (let i = 0; i < 400; i++) { const f = `assets/old-${i}-Ab12Cd34.js`; fs.writeFileSync(join(LIVE, f), `// old ${i}\n`); extra.push(f) }
    const touched = fs.readdirSync(join(LIVE, 'assets')).filter((f) => !f.startsWith('old-'))
    for (const f of touched) fs.appendFileSync(join(LIVE, 'assets', f), '\n/* live */')
    const big = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: SHA })
    const bigLines = big.out.trim().split('\n')
    const sfLine = /^storefront: [^\n]*/m.exec(big.out)?.[0] ?? ''
    is(big.code === 0 && bigLines.length < 300, `a whole-site plan over a foreign bundle of ${touched.length + 400} files prints ${bigLines.length} lines (cap 300)`)
    is(new RegExp(`changed ${touched.length + 2} · same \\d+ · new 1 · live-only 400`).test(sfLine) && !/^\s+assets\//m.test(big.out) && !/^\s+index\.html \d+ -> /m.test(big.out),
       'the bundle is counted on the storefront line and not one of its files is listed', sfLine.slice(0, 110))
    const liveOnlyBefore = Number(/live-only (\d+)/.exec(/^compare: [^\n]*/m.exec(plan2.out)[0])[1])
    is(new RegExp(`^compare: same \\d+ · changed ${touched.length + 2 + 1} · new \\d+ · live-only ${liveOnlyBefore + 400}$`, 'm').test(big.out),
       'the compare counts still include it (nothing is hidden, only not listed)', /^compare: [^\n]*/m.exec(big.out)?.[0])
    const scoped = await deploy({ SPORTA_DEPLOY_MODE: 'plan', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_ONLY: 'api,knet,pay' })
    is(scoped.code === 0 && !/^storefront:/m.test(scoped.out) && !/live-only 400/.test(scoped.out), 'a scoped plan does not compare the bundle at all, so it has no storefront line')
    for (const f of extra) fs.rmSync(join(LIVE, f))
    for (const f of touched) fs.copyFileSync(join(DIST, 'assets', f), join(LIVE, 'assets', f))
    fs.writeFileSync(join(LIVE, 'index.html'), page)
    is(sameTree(before, tree(LIVE)), 'the fixture is back as it was')
  }

  let backup = ''
  head('apply')
  {
    const liveConfig = md5(join(LIVE, 'config.js'))
    const a = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1', SPORTA_DEPLOY_JSON: '1' })
    backup = /DEPLOY_OK (deploy-\d{8}T\d{6}Z-a{7})/.exec(a.out)?.[1] ?? ''
    is(a.code === 0 && backup !== '', 'the deploy goes through', /DEPLOY_OK[^\n]*|DEPLOY_FAIL[^\n]*/.exec(a.out)?.[0])
    // Six stages, a running copy count, then the summary block and the marker.
    const stages = [...a.out.matchAll(/^== (\d)\/6 (build|compare|live health|backup|copy \d+ files|verify) \(\+\d+\.\d+s\)$/gm)].map((m) => `${m[1]} ${m[2].replace(/ \d+ files$/, '')}`)
    is(stages.join(', ') === '1 build, 2 compare, 3 live health, 4 backup, 5 copy, 6 verify', 'an apply prints its six stages, numbered, with elapsed seconds', stages.join(', '))
    const copied = [...a.out.matchAll(/^  copied (\d+)\/(\d+)/gm)]
    is(copied.length >= 1 && copied.length <= 11 && copied.at(-1)[1] === copied.at(-1)[2] && /^== 5\/6 copy \d+ files/m.test(a.out),
       'the copy stage shows a running count and ends at n/n', copied.map((m) => `${m[1]}/${m[2]}`).join(' '))
    const al = a.out.trim().split('\n')
    const sumAt = al.findIndex((l) => /^== SUMMARY apply ref=aaaaaaa \(\+\d+\.\d+s\)$/.test(l))
    is(sumAt > 0 && /^  deployed: \d+ added, \d+ replaced — /.test(al[sumAt + 1]) && al[sumAt + 2].startsWith(`  backup: ${backup} (`) && al[sumAt + 2].endsWith(` files) under ${join(ROOT, 'backups')}`)
       && al[sumAt + 3] === `  rollback: node scripts/vps-deploy.mjs compose --rollback ${backup}` && /^  health after: \/ 200 · /.test(al[sumAt + 4])
       && al[sumAt + 5].startsWith(`DEPLOY_OK ${backup}`) && al.at(-1).startsWith('DEPLOY_JSON {'),
       'the summary block says what was deployed, the backup name, the rollback command and the health, then DEPLOY_OK', al.slice(sumAt, sumAt + 4).join(' | ').slice(0, 200))
    {
      let j = null
      try { j = JSON.parse(al.at(-1).replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
      is(j && j.result === 'DEPLOY_OK' && j.backup === backup && j.deployed.replaced === j.plan.changed && j.deployed.added === j.plan.added
         && j.deployed.files.includes('api/store.php') && j.stages.length === 6 && j.health_after['/'] === 200 && j.health_before['/api/api.php?r=products'] === 200,
         'the apply JSON names the backup, the counts, the files and both health checks', j ? `${j.result} ${j.backup} ${JSON.stringify(j.deployed).slice(0, 60)}` : 'no JSON')
    }
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
    const r = await deploy({ SPORTA_DEPLOY_MODE: 'rollback', SPORTA_DEPLOY_BACKUP: backup, SPORTA_DEPLOY_JSON: '1' })
    is(r.code === 0 && r.out.includes(`ROLLED_BACK ${backup}`), 'the named backup is restored', /ROLLED_BACK[^\n]*/.exec(r.out)?.[0])
    {
      let j = null
      try { j = JSON.parse(r.out.trim().split('\n').at(-1).replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
      is(new RegExp(`^== 1/2 restore ${backup} \\(\\+\\d+\\.\\d+s\\)$`, 'm').test(r.out) && /^== 2\/2 live health/m.test(r.out) && new RegExp(`^== SUMMARY rollback ${backup}`, 'm').test(r.out)
         && /^  restored: \d+ files, removed: \d+ files this deploy had added \(ref aaaaaaa\)$/m.test(r.out) && j && j.result === 'ROLLED_BACK' && j.backup === backup && j.restored > 0,
         'a rollback prints its two stages, a summary and a ROLLED_BACK JSON result', j ? `${j.result} restored ${j.restored} removed ${j.removed}` : 'no JSON')
    }
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

  head('the KNET scan')
  {
    // A payment log with a week of events and one older line.
    const LOG = join(T, 'knet-payments.log')
    const now = Date.now(), at = (h) => new Date(now - h * 3600000).toISOString()
    fs.writeFileSync(LOG, [
      { ts: at(2), event: 'pay.init', trackid: 'X1' }, { ts: at(3), event: 'pay.init', trackid: 'X2' },
      { ts: at(5), event: 'pay.init', trackid: 'X3' }, { ts: at(4), event: 'callback.received', result: 'CAPTURED' },
      { ts: at(6), event: 'pay.reject', reason: 'order_not_found' }, { ts: at(24 * 30), event: 'pay.init', trackid: 'OLD' },
    ].map((j) => JSON.stringify(j)).join('\n') + '\n', { mode: 0o600 })
    const knet = (extra = {}) => deploy({ SPORTA_DEPLOY_MODE: 'scan', SPORTA_DEPLOY_REF: 'main', SPORTA_SCAN_WHICH: 'knet',
      SPORTA_KNET_PRIVATE: PRIV, SPORTA_KNET_LOG: LOG, ...extra })
    const k = await knet()
    is(/SCAN_DONE bad=0 warn=\d+/.test(k.out), 'the KNET scan runs clean on a working card path', /SCAN_DONE[^\n]*/.exec(k.out)?.[0] ?? k.out.slice(-400))
    is(/ok\s+\/knet\/pay\.php with no track id -> 400/.test(k.out) && /ok\s+pay\.php, injection in a POST body -> 400/.test(k.out),
       'pay.php is asked only what it refuses before the log')
    is(/passes knet_assert_payment_config/.test(k.out) && /AES-128 trandata round trip with the live key/.test(k.out)
       && /orders database configured/.test(k.out), "the live knet.php loads the private config and runs pay.php's own checks")
    is(/last 7 days: 5 entries — pay\.init 3/.test(k.out) && /refusals: order_not_found 1/.test(k.out),
       'the payment log is summarised by counts, older lines left out')
    // Not one secret in the output: the credentials and the database login.
    const { stdout: vals } = await run('php', ['-r', `$c = require '${join(PRIV, 'config', 'knet-config.php')}';`
      + ` echo json_encode(array_map(fn ($k) => (string) ($c[$k] ?? ''), ['tranportal_id', 'tranportal_password', 'resource_key', 'mysql_user', 'mysql_pass']));`])
    const secrets = JSON.parse(vals).filter((v) => v.length >= 4)
    // The domain and the paths are not secrets, and a test database user
    // called "sporta" is a substring of both; take them out before looking.
    const shown = k.out.replaceAll('www.sporta.com.kw', '').replaceAll(T, '').replaceAll(/\/sporta\b/g, '').replaceAll(/sporta-[a-z-]+/g, '')
    const leaked = secrets.filter((v) => shown.includes(v))
    is(secrets.length >= 2 && leaked.length === 0, 'no config value appears in the output', `${secrets.length} values checked, ${leaked.length} leaked`)
    is(!/X1|X2|X3|CAPTURED/.test(k.out.split('== 5.')[1] ?? ''), 'and no log content either')

    // A key that is one byte short, and a tool left in the web root.
    const PRIV2 = join(T, 'private-badkey')
    fs.mkdirSync(join(PRIV2, 'config'), { recursive: true })
    fs.copyFileSync(join(PRIV, 'api-config.php'), join(PRIV2, 'api-config.php'))
    await run('php', ['-r', `$c = require '${join(PRIV, 'config', 'knet-config.php')}'; $c['resource_key'] = substr($c['resource_key'], 0, 15);`
      + ` file_put_contents('${join(PRIV2, 'config', 'knet-config.php')}', '<?php return ' . var_export($c, true) . ';');`])
    fs.writeFileSync(join(LIVE, 'knet', 'selftest.php'), '<?php echo "x";')
    const k2 = await knet({ SPORTA_KNET_PRIVATE: PRIV2 })
    is(/BAD\s+pay\.php would refuse every payment: resource_key must be exactly 16 bytes/.test(k2.out), 'a 15-byte resource key is BAD, named by the validator')
    is(/BAD\s+knet\/selftest\.php is on the server/.test(k2.out), 'a self-test left on the server is BAD')
    fs.rmSync(join(LIVE, 'knet', 'selftest.php'))
  }

  head('the admin scan')
  {
    const adm = (extra = {}) => deploy({ SPORTA_DEPLOY_MODE: 'scan', SPORTA_DEPLOY_REF: 'main', SPORTA_SCAN_WHICH: 'backends', ...extra })
    await run('mariadb', ['sporta', '-e', 'delete from rate_limit']).catch(() => {})
    const a1 = await adm()
    is(/SCAN_DONE bad=\d+ warn=\d+/.test(a1.out) && /== 4\. The screens and the server agree/.test(a1.out), 'the admin scan runs to its summary',
       /SCAN_DONE[^\n]*/.exec(a1.out)?.[0] ?? a1.out.slice(-300))
    is(/ok\s+\/backends -> 200/.test(a1.out) && /reachable from index\.html, all on disk/.test(a1.out), 'the admin page and every chunk it can reach are found')
    is(/ok\s+signed out, all \d+ protected routes answer 401 not_signed_in/.test(a1.out), 'every protected admin route refuses a stranger')
    is(/POST login without X-Sporta-Admin -> 400 bad_request/.test(a1.out), 'sign-in without the CSRF header is refused (no attempt counted)')
    is(/all \d+ \?r= routes written into the bundle are served/.test(a1.out), 'every route the screens build is served')
    // This repo's admin cannot answer the MFA step the server can ask for —
    // the scan must say so (it is why the old build stays live).
    is(/BAD\s+the server can ask for a MFA code \(need_code\) and no screen handles it/.test(a1.out), "a sign-in step the screens cannot answer is BAD")
    // A chunk deleted from the server is a screen that breaks when opened.
    const chunk = fs.readdirSync(join(LIVE, 'assets')).find((f) => /^AdminApp-.*\.js$/.test(f))
    const moved = join(T, 'moved-chunk.js')
    fs.renameSync(join(LIVE, 'assets', chunk), moved)
    const a2 = await adm()
    is(new RegExp(`BAD\\s+\\d+ referenced file\\(s\\) missing from assets/: [^\\n]*${chunk.replace('.', '\\.')}`).test(a2.out), 'a missing admin chunk is BAD, by name')
    fs.renameSync(moved, join(LIVE, 'assets', chunk))
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
    const b = await deploy({ SPORTA_DEPLOY_MODE: 'apply', SPORTA_DEPLOY_REF: SHA, SPORTA_DEPLOY_CONFIRM: SHA, SPORTA_DEPLOY_ALLOW_SHRINK: '1', SPORTA_DEPLOY_JSON: '1' }, broken)
    is(b.code !== 0 && /broke: [^\n]*entry chunk/.test(b.out), 'the broken entry chunk is caught', /-- broke:[^\n]*/.exec(b.out)?.[0])
    is(b.out.includes('ROLLED_BACK'), 'and rolled back without being asked')
    const after = tree(LIVE)
    const diff = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k])
    is(diff.length === 0, 'the live tree is exactly as it was', diff.slice(0, 5).join(', ') || 'identical')
    {
      const bl = b.out.trim().split('\n')
      let j = null
      try { j = JSON.parse(bl.at(-1).replace(/^DEPLOY_JSON /, '')) } catch { /* not JSON */ }
      const sumAt = bl.findIndex((l) => /^== SUMMARY apply ref=aaaaaaa/.test(l))
      is(sumAt > 0 && /^  broke: [^\n]*entry chunk/.test(bl[sumAt + 1]) && /^  rolled back: deploy-\d{8}T\d{6}Z-a{7} — the live tree is as it was$/.test(bl[sumAt + 2])
         && bl[sumAt + 4] === 'DEPLOY_FAIL deploy rolled back' && j && j.result === 'DEPLOY_FAIL' && j.fail === 'deploy rolled back' && /^deploy-/.test(j.rolled_back)
         && j.health_after.entry !== 200 && j.health_rollback.entry === 200,
         'the summary says what broke and that it was rolled back; the JSON carries DEPLOY_FAIL, the backup rolled back and all three health checks',
         j ? `${j.result} rolled_back=${j.rolled_back} entry after=${j.health_after?.entry} rollback=${j.health_rollback?.entry}` : bl.slice(sumAt, sumAt + 5).join(' | ').slice(0, 200))
    }
  }
} finally {
  server.kill()
  fs.rmSync(T, { recursive: true, force: true })
}

console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
