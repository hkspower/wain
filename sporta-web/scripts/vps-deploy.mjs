#!/usr/bin/env node
// VPS DEPLOY — the live site is the VPS, not the shared-hosting account.
//
// www.sporta.com.kw resolves to 187.7.78.123, a Hostinger VPS: Traefik in front,
// the `apache-sporta` container behind it, serving /docker/sporta/site (bind
// mount). `npm run publish` uploads over FTPS to the old shared-hosting account,
// which no visitor sees any more. This is the route that reaches the live site.
//
// HOW IT WORKS. There is no SSH from here and no deploy endpoint on the server
// (CLAUDE.md: never build one). The Hostinger API can start a one-shot Docker
// Compose project on the VPS, and the repo is public, so:
//
//   1. `node scripts/vps-deploy.mjs compose ...` (anywhere) prints a compose
//      file for that one-shot job. It is handed to the Hostinger API
//      (vps_docker_create, project "sporta-deploy"), and its log is read back.
//   2. On the VPS the job downloads THIS repository at a pinned commit from
//      GitHub with Node's fetch, builds it exactly as `npm run release` does,
//      runs the file audit, and then runs `node scripts/vps-deploy.mjs run`
//      from the downloaded tree — so the deploy logic is always the version
//      that ships with the code being deployed.
//
// No `curl` and no `wget` anywhere in the job, on purpose: the Hostinger API
// refuses a request whose compose file contains either word (measured: 403),
// so every HTTP call here is Node's own. That includes the health checks.
//
// THREE MODES.
//   plan      (default) Read-only. /docker/sporta is mounted read-only. Builds,
//             audits, compares every deployable file with what is live, probes
//             the live site, and prints the plan. Nothing on the server changes.
//   apply     Needs the FULL commit SHA, given twice (--ref and --confirm), so
//             a deploy is always of a commit someone named. Refuses when a PHP,
//             HTML or .htaccess file would shrink below 70% of its live size
//             (the measured way this repo breaks the live site: its store.php
//             was half the live one) unless --allow-shrink. Backs up every file
//             it will overwrite, copies in place (the bind mount stays valid,
//             no container restart), index.html last, then re-probes. Anything
//             that answered 200 before and does not now is rolled back at once.
//   rollback  Restores a named backup made by apply.
//
// NEVER TOUCHED, in any mode: config.js, every config.php, .cbk_token.json,
// logs (all live-only configuration or secrets); the setup tools the owner was
// told to delete (go-live.html, knet/selftest.php, knet/setup-config.php,
// api/setup-admin.php, api/preflight.php); and the photo folders, which the
// apache container serves from /docker/sporta/private/media mounts — a file
// written under site/ there would be invisible anyway. Nothing is ever deleted
// from the live site except a file this same deploy added and then rolled back.
//
// Usage:
//   node scripts/vps-deploy.mjs compose                       plan, current HEAD
//   node scripts/vps-deploy.mjs compose --ref <sha|branch>    plan, that ref
//   node scripts/vps-deploy.mjs compose --apply --ref <sha> --confirm <sha> [--allow-shrink]
//   node scripts/vps-deploy.mjs compose --rollback <backup-name>
//   node scripts/vps-deploy.mjs run                           (on the VPS only)
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const REPO = 'hkspower/wain'
const HOST = 'www.sporta.com.kw'
// /docker/sporta on the host is mounted at /sporta in the job. The override
// and the two below exist for scripts/vps-deploy-test.mjs, which runs the real
// plan/apply/rollback code against a throwaway tree and a local server.
const ROOT = process.env.SPORTA_DEPLOY_ROOT ?? '/sporta'
const LIVE = `${ROOT}/site`
const BACKUPS = `${ROOT}/backups`
const RELEASES = `${ROOT}/releases`
const PROBE_BASE = process.env.SPORTA_DEPLOY_PROBE_BASE ?? ''   // test only: http://127.0.0.1:port
const PREBUILT = process.env.SPORTA_DEPLOY_DIST ?? ''          // test only: skip the build
const SHA = /^[0-9a-f]{40}$/
const REF_OK = /^[A-Za-z0-9._/-]{1,120}$/
const BACKUP_NAME = /^deploy-\d{8}T\d{6}Z-[0-9a-f]{7}$/

// ------------------------------------------------------------------ rules
const MEDIA = ['cats/', 'hero/', 'images/products/']
const SETUP_TOOLS = new Set(['go-live.html', 'knet/selftest.php', 'knet/setup-config.php',
  'api/setup-admin.php', 'api/preflight.php'])
const neverTouch = (p) => p === 'config.js'
  || /(^|\/)config\.php$/.test(p)
  || /(^|\/)\.cbk_token\.json$/.test(p)
  || /\.log$/.test(p)
const isMedia = (p) => MEDIA.some((m) => p.startsWith(m))
// Files whose shrinking means "older code over newer", not "smaller asset".
const guarded = (p) => /\.(php|html)$/.test(p) || path.basename(p) === '.htaccess'

// ================================================================ compose
function composeCommand(argv) {
  const opt = { mode: 'plan', ref: '', confirm: '', allowShrink: false, backup: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') opt.mode = 'apply'
    else if (a === '--allow-shrink') opt.allowShrink = true
    else if (a === '--ref') opt.ref = argv[++i] ?? ''
    else if (a === '--confirm') opt.confirm = argv[++i] ?? ''
    else if (a === '--rollback') { opt.mode = 'rollback'; opt.backup = argv[++i] ?? '' }
    else throw new Error(`unknown option ${a}`)
  }
  if (!opt.ref) opt.ref = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (!REF_OK.test(opt.ref) || opt.ref.includes('..')) throw new Error(`not a usable ref: ${opt.ref}`)
  if (opt.mode === 'apply') {
    if (!SHA.test(opt.ref)) throw new Error('apply needs the full 40-character commit SHA as --ref')
    if (opt.confirm !== opt.ref) throw new Error('apply needs --confirm <the same SHA> — a deploy is always of a commit someone named twice')
  }
  if (opt.mode === 'rollback' && !BACKUP_NAME.test(opt.backup)) throw new Error('rollback needs a backup name like deploy-20261101T180000Z-abc1234')
  if (SHA.test(opt.ref)) {
    // The VPS downloads from GitHub, so a commit that was never pushed is a
    // 404 there. Say so here, where it is cheap.
    try {
      const on = execFileSync('git', ['branch', '-r', '--contains', opt.ref], { encoding: 'utf8' }).trim()
      if (!on) console.error(`warning: ${opt.ref.slice(0, 7)} is on no remote branch — push it first or the VPS cannot download it`)
    } catch { /* not a local commit; GitHub will say */ }
  }

  const tarball = `https://codeload.github.com/${REPO}/tar.gz/${SHA.test(opt.ref) ? opt.ref : `refs/heads/${opt.ref}`}`
  // The bootstrap. Everything after the download runs from the downloaded tree.
  const script = [
    'set -eu',
    'apk add --no-cache php84 >/dev/null 2>&1 || apk add --no-cache php83 >/dev/null 2>&1 || true',
    'for p in php84 php83; do if [ -x /usr/bin/$p ]; then ln -sf /usr/bin/$p /usr/local/bin/php; break; fi; done',
    'command -v php >/dev/null || { echo "DEPLOY_FAIL no php for the file audit"; exit 1; }',
    'mkdir -p /work && cd /work',
    'node -e "fetch(process.env.SPORTA_DEPLOY_TARBALL).then(async r => { if (!r.ok) { console.error(\'DEPLOY_FAIL download \' + r.status); process.exit(1) } require(\'fs\').writeFileSync(\'src.tgz\', Buffer.from(await r.arrayBuffer())) })"',
    'tar xzf src.tgz --strip-components=1',
    'exec node sporta-web/scripts/vps-deploy.mjs run',
  ].join('\n')
  const environment = {
    SPORTA_DEPLOY_MODE: opt.mode,
    SPORTA_DEPLOY_REF: opt.ref,
    SPORTA_DEPLOY_TARBALL: tarball,
  }
  if (opt.mode === 'apply') {
    environment.SPORTA_DEPLOY_CONFIRM = opt.confirm
    if (opt.allowShrink) environment.SPORTA_DEPLOY_ALLOW_SHRINK = '1'
  }
  if (opt.mode === 'rollback') environment.SPORTA_DEPLOY_BACKUP = opt.backup
  const doc = {
    services: {
      deploy: {
        image: 'node:24-alpine',
        restart: 'no',
        // The health checks talk to Traefik on the host's own 443, the way the
        // VPS's cutover script does with --resolve ...:127.0.0.1.
        network_mode: 'host',
        environment,
        // Plan cannot write: the mount itself is read-only.
        volumes: [opt.mode === 'plan' ? '/docker/sporta:/sporta:ro' : '/docker/sporta:/sporta'],
        entrypoint: ['/bin/sh', '-c'],
        // $ is Compose interpolation; $$ is a literal $ for the shell.
        command: [script.replaceAll('$', () => '$$')],
      },
    },
  }
  const out = JSON.stringify(doc)   // JSON is YAML; Compose accepts it as is.
  for (const word of ['curl', 'wget']) {
    if (out.includes(word)) throw new Error(`compose contains "${word}" — the Hostinger API refuses that`)
  }
  process.stdout.write(out + '\n')
  console.error(`project: sporta-deploy · mode: ${opt.mode} · ref: ${opt.ref}`)
}

// ==================================================================== run
const say = (s = '') => console.log(s)
const fail = (msg) => { say(`DEPLOY_FAIL ${msg}`); process.exit(1) }

function sh(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env },
  })
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-25)
    for (const l of tail) say(`  | ${l}`)
    fail(`${cmd} ${args.join(' ')} exited ${r.status}`)
  }
  return r.stdout ?? ''
}

// Every regular file under root, as root-relative paths. Symlinks are listed
// but never followed.
function walk(root, skip = () => false) {
  const out = []
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (skip(rel + (e.isDirectory() ? '/' : ''))) continue
      if (e.isDirectory()) visit(abs)
      else if (e.isFile()) out.push(rel)
    }
  }
  if (fs.existsSync(root)) visit(root)
  return out.sort()
}
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function plan(dist) {
  const held = { setup: [], never: [], media: 0 }
  const release = new Map()
  for (const p of walk(dist)) {
    if (isMedia(p)) { held.media++; continue }
    if (neverTouch(p)) { held.never.push(p); continue }
    if (SETUP_TOOLS.has(p)) { held.setup.push(p); continue }
    release.set(p, { sha: sha256(path.join(dist, p)), size: fs.statSync(path.join(dist, p)).size })
  }
  // The live side: skip the photo mounts, backups and old-site leftovers'
  // folders that are not deploy targets; configuration is listed separately.
  const live = new Map()
  for (const p of walk(LIVE, (r) => isMedia(r) || r.startsWith('backups/'))) {
    if (neverTouch(p)) continue
    live.set(p, { sha: sha256(path.join(LIVE, p)), size: fs.statSync(path.join(LIVE, p)).size })
  }
  const same = [], changed = [], added = [], liveOnly = []
  for (const [p, r] of release) {
    const l = live.get(p)
    if (!l) added.push(p)
    else if (l.sha === r.sha) same.push(p)
    else changed.push({ p, from: l.size, to: r.size })
  }
  for (const p of live.keys()) if (!release.has(p)) liveOnly.push(p)
  const shrinks = changed.filter((c) => guarded(c.p) && c.to < 0.7 * c.from)
  return { held, release, same, changed, added, liveOnly, shrinks }
}

function printPlan(r) {
  const list = (items, n = 25) => {
    const shown = items.slice(0, n).join(' ')
    return items.length > n ? `${shown} … +${items.length - n} more` : shown
  }
  say(`release: ${r.release.size} deployable files · held back: ${r.held.setup.length} setup tools, `
    + `${r.held.never.length} live-only config (${r.held.never.join(' ') || 'none'}), ${r.held.media} photos (served from private/media)`)
  say(`compare: same ${r.same.length} · changed ${r.changed.length} · new ${r.added.length} · live-only ${r.liveOnly.length}`)
  const rank = (c) => (guarded(c.p) ? 0 : /^assets\//.test(c.p) ? 2 : 1)
  const changed = [...r.changed].sort((a, b) => rank(a) - rank(b) || a.p.localeCompare(b.p))
  say('-- changed (live bytes -> release bytes)')
  for (const c of changed.slice(0, 60)) {
    const flag = r.shrinks.includes(c) ? '  SHRINKS' : ''
    say(`  ${c.p} ${c.from} -> ${c.to}${flag}`)
  }
  if (changed.length > 60) say(`  … +${changed.length - 60} more`)
  const assets = r.added.filter((p) => p.startsWith('assets/'))
  say(`-- new: ${assets.length} hashed assets; others: ${list(r.added.filter((p) => !p.startsWith('assets/')), 40) || 'none'}`)
  const byDir = {}
  for (const p of r.liveOnly) {
    const d = p.includes('/') ? p.slice(0, p.indexOf('/')) : '(root)'
    ;(byDir[d] ??= []).push(p)
  }
  say(`-- live-only (on the server, not in this release — never deleted): ${Object.entries(byDir).map(([d, v]) => `${d} ${v.length}`).join(', ') || 'none'}`)
  for (const [d, v] of Object.entries(byDir)) {
    if (d === 'assets') continue          // old hashed bundles; expected
    say(`  ${d}: ${list(v.map((p) => (d === '(root)' ? p : p.slice(d.length + 1))), 40)}`)
  }
  if (r.shrinks.length) say(`-- SHRINK GUARD: ${r.shrinks.length} file(s) would drop below 70% of their live size — older code over newer`)
}

// ------------------------------------------------------------- the probes
function get(pathname, { scheme = 'https', host = HOST } = {}) {
  return new Promise((resolve) => {
    if (PROBE_BASE) scheme = 'http'
    const lib = scheme === 'https' ? https : http
    const base = PROBE_BASE ? new URL(PROBE_BASE) : null
    const req = lib.request({
      host: base ? base.hostname : '127.0.0.1',
      port: base ? Number(base.port) : scheme === 'https' ? 443 : 80,
      path: pathname, method: 'GET',
      headers: { Host: host, 'User-Agent': 'sporta-vps-deploy', 'Accept-Encoding': 'identity' },
      timeout: 20000,
      ...(scheme === 'https' ? {
        servername: HOST,
        checkServerIdentity: (_h, cert) => tls.checkServerIdentity(HOST, cert),
      } : {}),
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { if (body.length < 400000) body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }))
    req.end()
  })
}

const PROBES = ['/', '/shop', '/checkout', '/backends', '/api/api.php?r=products', '/knet/pay.php',
  '/pay/pay.php', '/sitemap.xml', '/robots.txt', '/sw.js', '/config.js', '/no-such-page-sporta-deploy']
// These must answer 200 after a deploy, whatever they answered before.
const MUST = new Set(['/', '/shop', '/checkout', '/backends', '/api/api.php?r=products'])

async function health() {
  const out = {}
  for (const p of PROBES) out[p] = await get(p)
  const home = out['/']
  const asset = /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/.exec(home.body)?.[1]
    ?? /src="(\/assets\/index-[^"]+\.js)"/.exec(home.body)?.[1]
  out.asset = asset ? await get(asset) : { status: 0, headers: {}, body: 'no module script in /' }
  out.assetPath = asset ?? '(none)'
  let n = -1
  try {
    const j = JSON.parse(out['/api/api.php?r=products'].body)
    n = (Array.isArray(j) ? j : j.products ?? []).length
  } catch { /* not JSON */ }
  out.products = n
  return out
}

function printHealth(h, label) {
  say(`== HEALTH ${label}`)
  say('  ' + PROBES.map((p) => `${p} ${h[p].status}`).join(' · '))
  say(`  entry ${h.assetPath} ${h.asset.status} · products in the API: ${h.products}`)
}

async function headers() {
  const h = (await get('/')).headers
  const csp = String(h['content-security-policy'] ?? '')
  say('== HEADERS on /')
  say(`  HSTS ${h['strict-transport-security'] ? 'yes' : 'MISSING'} · CSP ${csp ? 'yes' : 'MISSING'}`
    + ` (${/script-src[^;]*/.exec(csp)?.[0] ?? '-'}${/unsafe-inline/.test(/script-src[^;]*/.exec(csp)?.[0] ?? '') ? ' — UNSAFE-INLINE' : ''})`
    + ` · nosniff ${h['x-content-type-options'] === 'nosniff' ? 'yes' : 'MISSING'}`
    + ` · X-Powered-By ${h['x-powered-by'] ? `PRESENT (${h['x-powered-by']})` : 'absent'}`
    + ` · Server ${h.server ?? '-'}`)
  // One hop to the canonical origin from every other spelling.
  const hops = []
  for (const [scheme, host] of [['http', HOST], ['http', 'sporta.com.kw'], ['https', 'sporta.com.kw']]) {
    const r = await get('/shop?x=1', { scheme, host })
    hops.push(`${scheme}://${host}/shop -> ${r.status} ${r.headers.location ?? ''}`)
  }
  say(`  redirects: ${hops.join(' | ')}`)
}

function healthBroke(before, after) {
  const bad = []
  for (const p of PROBES) {
    if (MUST.has(p) && after[p].status !== 200) bad.push(`${p} ${after[p].status}`)
    else if (before[p].status === 200 && after[p].status !== 200) bad.push(`${p} ${before[p].status}->${after[p].status}`)
  }
  if (after.asset.status !== 200) bad.push(`entry chunk ${after.assetPath} ${after.asset.status}`)
  if (before.products > 0 && after.products <= 0) bad.push(`products ${before.products}->${after.products}`)
  return bad
}

function restore(name) {
  const meta = JSON.parse(fs.readFileSync(path.join(BACKUPS, `${name}.json`), 'utf8'))
  if (meta.changed.length) sh('tar', ['xzf', path.join(BACKUPS, `${name}.tar.gz`), '-C', LIVE], '/')
  for (const p of meta.added) fs.rmSync(path.join(LIVE, p), { force: true })
  say(`ROLLED_BACK ${name}: ${meta.changed.length} restored, ${meta.added.length} added files removed`)
}

async function run() {
  const mode = process.env.SPORTA_DEPLOY_MODE ?? 'plan'
  const ref = process.env.SPORTA_DEPLOY_REF ?? ''
  if (!['plan', 'apply', 'rollback'].includes(mode)) fail(`unknown mode ${mode}`)
  if (!fs.existsSync(path.join(LIVE, 'index.html'))) fail(`${LIVE} is not the site (no index.html) — is /docker/sporta mounted at /sporta?`)
  say(`== VPS DEPLOY mode=${mode} ref=${ref}`)

  if (mode === 'rollback') {
    const name = process.env.SPORTA_DEPLOY_BACKUP ?? ''
    if (!BACKUP_NAME.test(name)) fail('bad backup name')
    restore(name)
    printHealth(await health(), 'after rollback')
    return
  }
  if (mode === 'apply') {
    if (!SHA.test(ref) || process.env.SPORTA_DEPLOY_CONFIRM !== ref) fail('apply needs the full SHA as ref AND confirm')
  }

  // ---- build, exactly as a release is built; VITE_* emptied like publish does
  const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  let dist = path.join(web, 'dist')
  if (PREBUILT) {
    dist = PREBUILT
    say(`-- build skipped: using ${dist} (test)`)
  } else {
    const clean = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('VITE_')).map((k) => [k, '']))
    const env = { ...clean, CI: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', npm_config_fund: 'false', npm_config_audit: 'false' }
    say('-- npm ci'); sh('npm', ['ci', '--no-audit', '--no-fund'], web, env)
    say('-- npm run release'); sh('npm', ['run', 'release'], web, env)
    say('-- file audit')
    const audit = sh('node', ['scripts/file-audit.mjs', 'dist'], web, env).trim().split('\n').slice(-1)[0]
    say(`  ${audit}`)
  }

  const r = plan(dist)
  printPlan(r)
  const before = await health()
  printHealth(before, 'live now')
  await headers()

  if (mode === 'plan') { say('PLAN_OK nothing was changed'); return }

  // ---------------------------------------------------------------- apply
  if (r.shrinks.length && process.env.SPORTA_DEPLOY_ALLOW_SHRINK !== '1') {
    fail(`shrink guard: ${r.shrinks.map((c) => c.p).join(' ')} — rerun with --allow-shrink only if live really is older`)
  }
  const work = [...r.added, ...r.changed.map((c) => c.p)]
  if (work.length === 0) { say('DEPLOY_OK nothing to change'); return }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const name = `deploy-${stamp}-${ref.slice(0, 7)}`
  fs.mkdirSync(BACKUPS, { recursive: true, mode: 0o700 })
  const changedPaths = r.changed.map((c) => c.p)
  if (changedPaths.length) {
    const listFile = `/tmp/${name}.list`
    fs.writeFileSync(listFile, changedPaths.join('\n') + '\n')
    sh('tar', ['czf', path.join(BACKUPS, `${name}.tar.gz`), '-C', LIVE, '-T', listFile], '/')
  }
  fs.writeFileSync(path.join(BACKUPS, `${name}.json`), JSON.stringify({ ref, stamp, changed: changedPaths, added: r.added }, null, 1))
  say(`-- backup ${name} (${changedPaths.length} files), then copying ${work.length}`)

  // index.html last: a half-finished copy must not be a page asking for
  // assets that have not arrived yet.
  const order = [...work].sort((a, b) => (a === 'index.html') - (b === 'index.html') || a.localeCompare(b))
  for (const p of order) {
    const to = path.join(LIVE, p)
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 })
    fs.copyFileSync(path.join(dist, p), to)
    fs.chmodSync(to, 0o644)
  }

  const after = await health()
  printHealth(after, 'after deploy')
  const broke = healthBroke(before, after)
  if (broke.length) {
    say(`-- broke: ${broke.join(' · ')} — rolling back`)
    restore(name)
    printHealth(await health(), 'after rollback')
    fail('deploy rolled back')
  }
  fs.mkdirSync(RELEASES, { recursive: true })
  fs.writeFileSync(path.join(RELEASES, `${name}.json`), JSON.stringify({ ref, stamp, files: work.length }, null, 1))
  say(`DEPLOY_OK ${name} — ${r.added.length} added, ${r.changed.length} replaced. Undo: compose --rollback ${name}`)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'compose') {
  try { composeCommand(rest) } catch (e) { console.error(e.message); process.exit(2) }
} else if (cmd === 'run') {
  run().catch((e) => fail(e.stack ?? e.message))
} else {
  console.error('usage: node scripts/vps-deploy.mjs compose [--ref R] [--apply --confirm SHA [--allow-shrink]] [--rollback NAME]\n'
    + '       node scripts/vps-deploy.mjs run   (inside the VPS job)')
  process.exit(2)
}
