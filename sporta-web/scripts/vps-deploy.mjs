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
// No `curl`, no `wget`, no `require('fs')` and no `$` anywhere in the job, on
// purpose: the Hostinger API's firewall refuses a compose file containing any
// of the first three (each measured: 403 before the request reaches the VPS),
// and Compose interpolates a `$` before the shell ever sees it. Every HTTP
// call here is Node's own fetch/https, including the health checks, the
// download line imports node:fs as an ES module instead of require()-ing it,
// and the bootstrap shell uses no variables. composeCommand() asserts all four.
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
//   scan      Read-only. Runs scripts/live-scan.mjs on the VPS — the
//             server-response checks of scan-server-response.sh plus the web
//             root on disk. No build. `--scan json` runs json-scan.mjs instead:
//             every JSON answer, the manifests, JSON-LD and stray .json/.map.
//             `--scan ports [--edge RULES]` runs port-scan.mjs: every listener
//             on the host, its bind, who answers, the edge firewall.
//             `--scan knet` runs knet-scan.mjs: the card path's files, doors,
//             private config (verdicts, never values), the bank's TLS, the log.
//             `--scan backends` runs admin-scan.mjs: /backends loads, every
//             admin route refuses a stranger, and screens and server agree.
//
// SCOPE. --only api,knet,pay limits plan and apply to those top-level folders
// (or files). That is how the backend ships while the storefront's own source
// is still missing from this repo: the live index.html and its bundle are a
// different build from this one, so a whole-site apply would replace the live
// storefront with this repo's. Scoped, the storefront is not even compared.
//
// WHAT THE PERSON WATCHING SEES. The job's log is read back through the
// Hostinger API, which keeps at most 300 entries, so the output is numbered
// stages with one header line each (`== 2/4 compare (+12.3s)`, seconds since
// the job started), running counts (`copied 25/137`), and a `== SUMMARY`
// block before the final marker. When the live index.html is a build from
// other source (no sporta-build marker), an unscoped plan counts that
// storefront's files — index.html, the hashed assets, sw.js, the sitemaps,
// robots.txt, the manifests — on ONE line and never lists them: they are not
// what a deploy ships, and listing hundreds of hashed assets is how a log
// loses its last lines. The markers the connector session greps for are
// unchanged: PLAN_OK, DEPLOY_OK, DEPLOY_FAIL, ROLLED_BACK, STOREFRONT, and the
// scans' SCAN_DONE. `--quiet` drops the per-file lines (stage headers, counts,
// guards, health, summary and markers stay); `--json` appends ONE line,
// `DEPLOY_JSON {...}`, for an orchestrator to parse — also on failure.
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
//   node scripts/vps-deploy.mjs compose --apply --ref <sha> --confirm <sha> [--allow-shrink] [--replace-storefront]
//   node scripts/vps-deploy.mjs compose --rollback <backup-name>
//   … add --only api,knet,pay to either of the first two to deploy part of the site
//   … add --quiet (fewer lines) and/or --json (a DEPLOY_JSON line at the end) to any of them
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
const ONLY_OK = /^[A-Za-z0-9_.-]+(,[A-Za-z0-9_.-]+)*$/
// --only api,knet,pay → a path is in scope when its first segment is listed
// (a folder) or it IS a listed name (a top-level file).
const ONLY = (process.env.SPORTA_DEPLOY_ONLY ?? '').split(',').filter(Boolean)
const inScope = (p) => ONLY.length === 0 || ONLY.includes(p.split('/')[0])
// Output shape, set by compose --quiet / --json (SPORTA_DEPLOY_QUIET / _JSON).
const QUIET = process.env.SPORTA_DEPLOY_QUIET === '1'
const JSON_OUT = process.env.SPORTA_DEPLOY_JSON === '1'

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
// The storefront bundle: what a Vite build of this repo produces and what the
// live (foreign) build produced from its own source — CLAUDE.md item 5 names
// exactly these as "different in every whole-site plan, never part of a
// deploy". An unscoped plan over a foreign storefront counts them, one line.
const isStorefront = (p) => p === 'index.html' || p.startsWith('assets/') || p === 'sw.js'
  || /^sitemap[\w-]*\.xml$/.test(p) || p === 'robots.txt' || /\.webmanifest$/.test(p)

// STOREFRONT GUARD. This repo's index.html carries <meta name="sporta-build"
// content="sporta-web">. A live index.html without it is a build from some
// other source, and replacing it replaces everything that build does: on
// 2026-11-02 a whole-site apply swapped the live storefront for this repo's
// and took away customer accounts, support tickets, return requests and
// exchange (shoppers), and CRM, support, returns, activity log, SEO, theme,
// fonts, payment settings, MFA and Google sign-in (admin) — none of which
// this repo has a screen for. It was rolled back 13 minutes later.
// So an apply that would change a FOREIGN index.html refuses unless
// --replace-storefront is given. Once this repo's page is live, its own
// marker is there and ordinary deploys go through.
const BUILD_MARK = /<meta\s+name="sporta-build"\s+content="sporta-web"/
const liveIsForeign = () => !BUILD_MARK.test(fs.readFileSync(path.join(LIVE, 'index.html'), 'utf8'))
const foreignStorefront = (r) => r.changed.some((c) => c.p === 'index.html') && liveIsForeign()

// ================================================================ compose
function composeCommand(argv) {
  const opt = { mode: 'plan', ref: '', confirm: '', allowShrink: false, backup: '', only: '', quiet: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') opt.mode = 'apply'
    else if (a === '--allow-shrink') opt.allowShrink = true
    else if (a === '--replace-storefront') opt.replaceStorefront = true
    else if (a === '--quiet') opt.quiet = true
    else if (a === '--json') opt.json = true
    else if (a === '--ref') opt.ref = argv[++i] ?? ''
    else if (a === '--confirm') opt.confirm = argv[++i] ?? ''
    else if (a === '--rollback') { opt.mode = 'rollback'; opt.backup = argv[++i] ?? '' }
    else if (a === '--only') opt.only = argv[++i] ?? ''
    else if (a === '--scan') {
      opt.mode = 'scan'
      // --scan json → scripts/json-scan.mjs; bare --scan → live-scan.mjs.
      if (['json', 'site', 'ports', 'knet', 'backends'].includes(argv[i + 1])) opt.scan = argv[++i]
    }
    // --edge tcp/80@any,tcp/22@1.2.3.4 — the Hostinger firewall rules, read
    // from the API by whoever starts the job (the container cannot).
    else if (a === '--edge') opt.edge = argv[++i]
    else throw new Error(`unknown option ${a}`)
  }
  if (!opt.ref) opt.ref = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (!REF_OK.test(opt.ref) || opt.ref.includes('..')) throw new Error(`not a usable ref: ${opt.ref}`)
  if (opt.mode === 'apply') {
    if (!SHA.test(opt.ref)) throw new Error('apply needs the full 40-character commit SHA as --ref')
    if (opt.confirm !== opt.ref) throw new Error('apply needs --confirm <the same SHA> — a deploy is always of a commit someone named twice')
  }
  if (opt.mode === 'rollback' && !BACKUP_NAME.test(opt.backup)) throw new Error('rollback needs a backup name like deploy-20261101T180000Z-abc1234')
  if (opt.only && !ONLY_OK.test(opt.only)) throw new Error('--only takes top-level names separated by commas, e.g. api,knet,pay')
  if (SHA.test(opt.ref)) {
    // The VPS downloads from GitHub, so a commit that was never pushed is a
    // 404 there. Say so here, where it is cheap.
    try {
      const on = execFileSync('git', ['branch', '-r', '--contains', opt.ref], { encoding: 'utf8' }).trim()
      if (!on) console.error(`warning: ${opt.ref.slice(0, 7)} is on no remote branch — push it first or the VPS cannot download it`)
    } catch { /* not a local commit; GitHub will say */ }
  }

  const tarball = `https://codeload.github.com/${REPO}/tar.gz/${SHA.test(opt.ref) ? opt.ref : `refs/heads/${opt.ref}`}`
  // The bootstrap. Everything after the download runs from the downloaded
  // tree. No shell variable anywhere: a `$` in a compose file is Compose's,
  // not the shell's.
  const script = [
    'set -eu',
    'apk add --no-cache php84 >/dev/null 2>&1 || apk add --no-cache php83 >/dev/null 2>&1 || true',
    'if [ -x /usr/bin/php84 ]; then ln -sf /usr/bin/php84 /usr/local/bin/php; elif [ -x /usr/bin/php83 ]; then ln -sf /usr/bin/php83 /usr/local/bin/php; fi',
    'command -v php >/dev/null || { echo "DEPLOY_FAIL no php for the file audit"; exit 1; }',
    'mkdir -p /work && cd /work',
    'node --input-type=module -e "import { writeFileSync } from \'node:fs\'; const r = await fetch(process.env.SPORTA_DEPLOY_TARBALL); if (!r.ok) { console.error(\'DEPLOY_FAIL download \' + r.status); process.exit(1) } writeFileSync(\'src.tgz\', Buffer.from(await r.arrayBuffer()))"',
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
    if (opt.replaceStorefront) environment.SPORTA_DEPLOY_STOREFRONT = '1'
  }
  if (opt.mode === 'rollback') environment.SPORTA_DEPLOY_BACKUP = opt.backup
  if (opt.only) environment.SPORTA_DEPLOY_ONLY = opt.only
  if (opt.quiet) environment.SPORTA_DEPLOY_QUIET = '1'
  if (opt.json) environment.SPORTA_DEPLOY_JSON = '1'
  if (opt.mode === 'scan' && ['json', 'ports', 'knet', 'backends'].includes(opt.scan)) environment.SPORTA_SCAN_WHICH = opt.scan
  if (opt.edge) {
    if (!/^((tcp|udp)\/\d+(:\d+)?@[\w.:/]+,?)+$/i.test(opt.edge)) throw new Error('bad --edge list')
    environment.SPORTA_PORTS_EDGE = opt.edge
  }
  const volumes = [['plan', 'scan'].includes(opt.mode) ? '/docker/sporta:/sporta:ro' : '/docker/sporta:/sporta']
  // No sshd config mount: the Hostinger API refuses a job that mounts it
  // (403, measured 2026-11-01), and that filter is not ours to get round.
  // port-scan.mjs reports the SSH banner and says the settings were not read.
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
        volumes,
        entrypoint: ['/bin/sh', '-c'],
        command: [script],
      },
    },
  }
  const out = JSON.stringify(doc)   // JSON is YAML; Compose accepts it as is.
  for (const word of ['curl', 'wget', 'require(', '$']) {
    if (out.includes(word)) throw new Error(`compose contains "${word}" — the Hostinger API's firewall refuses the first three and Compose interpolates the last`)
  }
  process.stdout.write(out + '\n')
  console.error(`project: sporta-deploy · mode: ${opt.mode} · ref: ${opt.ref}${opt.only ? ` · only: ${opt.only}` : ''}${opt.quiet ? ' · quiet' : ''}${opt.json ? ' · json' : ''}`)
}

// ==================================================================== run
const T0 = Date.now()
const elapsed = () => ((Date.now() - T0) / 1000).toFixed(1)
const say = (s = '') => console.log(s)
// A per-file line: dropped by --quiet. Headers, counts, guards and markers
// go through say() and are never dropped.
const detail = (s) => { if (!QUIET) say(s) }
// What --json prints as one line at the very end, whichever way the run ends.
const report = { tool: 'vps-deploy', mode: '', ref: '', only: [], stages: [], result: '' }
let jsonSent = false
function emitJson(result, extra = {}) {
  if (!JSON_OUT || jsonSent) return
  jsonSent = true
  say(`DEPLOY_JSON ${JSON.stringify({ ...report, ...extra, result, elapsed_s: Number(elapsed()) })}`)
}
const fail = (msg) => { say(`DEPLOY_FAIL ${msg}`); emitJson('DEPLOY_FAIL', { fail: msg }); process.exit(1) }
// One header line per numbered stage, with the seconds since the job began.
function stage(n, of, name) {
  say(`== ${n}/${of} ${name} (+${elapsed()}s)`)
  report.stages.push({ n, name, at_s: Number(elapsed()) })
}

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
    if (!inScope(p)) continue
    if (isMedia(p)) { held.media++; continue }
    if (neverTouch(p)) { held.never.push(p); continue }
    if (SETUP_TOOLS.has(p)) { held.setup.push(p); continue }
    release.set(p, { sha: sha256(path.join(dist, p)), size: fs.statSync(path.join(dist, p)).size })
  }
  // The live side: skip the photo mounts, backups and old-site leftovers'
  // folders that are not deploy targets; configuration is listed separately.
  const live = new Map()
  for (const p of walk(LIVE, (r) => isMedia(r) || r.startsWith('backups/'))) {
    if (neverTouch(p) || !inScope(p)) continue
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
  // An unscoped plan over a foreign storefront: that build's files are
  // counted, not listed (see the header). Scoped, index.html is not even
  // compared and nothing is set apart.
  const foreign = ONLY.length === 0 && liveIsForeign()
  const sf = foreign ? {
    changed: changed.filter((c) => isStorefront(c.p)).length,
    same: same.filter(isStorefront).length,
    added: added.filter(isStorefront).length,
    liveOnly: liveOnly.filter(isStorefront).length,
    shrinks: shrinks.filter((c) => isStorefront(c.p)).map((c) => c.p),
  } : null
  return { held, release, same, changed, added, liveOnly, shrinks, foreign, storefront: sf }
}

function printPlan(r) {
  const list = (items, n = 25) => {
    const shown = items.slice(0, n).join(' ')
    return items.length > n ? `${shown} … +${items.length - n} more` : shown
  }
  const listed = (p) => !(r.foreign && isStorefront(p))
  say(`release: ${r.release.size} deployable files · held back: ${r.held.setup.length} setup tools, `
    + `${r.held.never.length} live-only config (${r.held.never.join(' ') || 'none'}), ${r.held.media} photos (served from private/media)`)
  say(`compare: same ${r.same.length} · changed ${r.changed.length} · new ${r.added.length} · live-only ${r.liveOnly.length}`)
  if (r.foreign) {
    const s = r.storefront
    const total = s.changed + s.same + s.added + s.liveOnly
    say(`storefront: the live index.html is a foreign build — ${total} of its files compared (changed ${s.changed} · same ${s.same}`
      + ` · new ${s.added} · live-only ${s.liveOnly}${s.shrinks.length ? ` · ${s.shrinks.length} would shrink: ${s.shrinks.join(' ')}` : ''}),`
      + ' counted here and never listed; a whole-site apply refuses without --replace-storefront')
  }
  const rank = (c) => (guarded(c.p) ? 0 : /^assets\//.test(c.p) ? 2 : 1)
  const changed = [...r.changed].filter((c) => listed(c.p)).sort((a, b) => rank(a) - rank(b) || a.p.localeCompare(b.p))
  say(`-- changed (live bytes -> release bytes): ${changed.length} file${changed.length === 1 ? '' : 's'}${QUIET ? ' (names dropped by --quiet)' : ''}`)
  for (const c of changed.slice(0, 60)) {
    const flag = r.shrinks.includes(c) ? '  SHRINKS' : ''
    detail(`  ${c.p} ${c.from} -> ${c.to}${flag}`)
  }
  if (changed.length > 60) detail(`  … +${changed.length - 60} more`)
  const added = r.added.filter(listed)
  const assets = added.filter((p) => p.startsWith('assets/'))
  say(`-- new: ${assets.length} hashed assets; others: ${QUIET ? `${added.length - assets.length} files` : list(added.filter((p) => !p.startsWith('assets/')), 40) || 'none'}`)
  const byDir = {}
  for (const p of r.liveOnly.filter(listed)) {
    const d = p.includes('/') ? p.slice(0, p.indexOf('/')) : '(root)'
    ;(byDir[d] ??= []).push(p)
  }
  say(`-- live-only (on the server, not in this release — never deleted): ${Object.entries(byDir).map(([d, v]) => `${d} ${v.length}`).join(', ') || 'none'}`)
  for (const [d, v] of Object.entries(byDir)) {
    if (d === 'assets') continue          // old hashed bundles; expected
    detail(`  ${d}: ${list(v.map((p) => (d === '(root)' ? p : p.slice(d.length + 1))), 40)}`)
  }
  if (r.shrinks.length) say(`-- SHRINK GUARD: ${r.shrinks.length} file(s) would drop below 70% of their live size — older code over newer: ${list(r.shrinks.map((c) => c.p), 20)}`)
}

// The --only list that would ship everything an unscoped plan found outside
// the storefront bundle: copy-paste for the next, scoped, run.
function scopeHint(r) {
  const names = new Set()
  for (const p of [...r.added, ...r.changed.map((c) => c.p)]) if (!isStorefront(p)) names.add(p.split('/')[0])
  return [...names].sort()
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

// Statuses only, for the JSON line and the summary.
const healthSummary = (h) => ({ ...Object.fromEntries(PROBES.map((p) => [p, h[p].status])), entry: h.asset.status, entry_path: h.assetPath, products: h.products })
const healthLine = (h) => `${PROBES.map((p) => `${p} ${h[p].status}`).join(' · ')} · entry ${h.asset.status} · products ${h.products}`

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
  report.rolled_back = name
  return meta
}

const short = (ref) => (SHA.test(ref) ? ref.slice(0, 7) : ref)

async function run() {
  const mode = process.env.SPORTA_DEPLOY_MODE ?? 'plan'
  const ref = process.env.SPORTA_DEPLOY_REF ?? ''
  Object.assign(report, { mode, ref, only: ONLY })
  if (!['plan', 'apply', 'rollback', 'scan'].includes(mode)) fail(`unknown mode ${mode}`)
  if (!fs.existsSync(path.join(LIVE, 'index.html'))) fail(`${LIVE} is not the site (no index.html) — is /docker/sporta mounted at /sporta?`)
  say(`== VPS DEPLOY mode=${mode} ref=${ref}${ONLY.length ? ` only=${ONLY.join(',')}` : ''}${QUIET ? ' quiet' : ''}`)
  if (ONLY.length && !ONLY_OK.test(ONLY.join(','))) fail('bad --only list')
  if (mode === 'scan') {
    process.env.SPORTA_SCAN_ROOT ??= LIVE
    if (PROBE_BASE) process.env.SPORTA_SCAN_BASE ??= PROBE_BASE
    await import({ json: './json-scan.mjs', ports: './port-scan.mjs', knet: './knet-scan.mjs', backends: './admin-scan.mjs' }[process.env.SPORTA_SCAN_WHICH] ?? './live-scan.mjs')
    return
  }

  if (mode === 'rollback') {
    const name = process.env.SPORTA_DEPLOY_BACKUP ?? ''
    if (!BACKUP_NAME.test(name)) fail('bad backup name')
    stage(1, 2, `restore ${name}`)
    const meta = restore(name)
    stage(2, 2, 'live health')
    const h = await health()
    printHealth(h, 'after rollback')
    say(`== SUMMARY rollback ${name} (+${elapsed()}s)`)
    say(`  restored: ${meta.changed.length} files, removed: ${meta.added.length} files this deploy had added (ref ${short(meta.ref ?? '?')})`)
    say(`  health after: ${healthLine(h)}`)
    emitJson('ROLLED_BACK', { backup: name, restored: meta.changed.length, removed: meta.added.length, health_after: healthSummary(h) })
    return
  }
  if (mode === 'apply') {
    if (!SHA.test(ref) || process.env.SPORTA_DEPLOY_CONFIRM !== ref) fail('apply needs the full SHA as ref AND confirm')
  }
  const OF = mode === 'apply' ? 6 : 4

  // ---- build, exactly as a release is built; VITE_* emptied like publish does
  stage(1, OF, 'build')
  const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  let dist = path.join(web, 'dist')
  if (PREBUILT) {
    dist = PREBUILT
    say(`-- build skipped: using ${dist} (test)`)
  } else {
    const clean = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('VITE_')).map((k) => [k, '']))
    const env = { ...clean, CI: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', npm_config_fund: 'false', npm_config_audit: 'false' }
    say('-- npm ci'); sh('npm', ['ci', '--no-audit', '--no-fund'], web, env)
    say(`-- npm run release (+${elapsed()}s)`); sh('npm', ['run', 'release'], web, env)
    say(`-- file audit (+${elapsed()}s)`)
    const audit = sh('node', ['scripts/file-audit.mjs', 'dist'], web, env).trim().split('\n').slice(-1)[0]
    say(`  ${audit}`)
  }

  stage(2, OF, 'compare')
  const r = plan(dist)
  printPlan(r)
  const compared = r.same.length + r.changed.length + r.added.length + r.liveOnly.length
  say(`  compared ${compared} paths in ${elapsed()}s`)
  report.plan = {
    release: r.release.size, same: r.same.length, changed: r.changed.length, added: r.added.length, live_only: r.liveOnly.length,
    shrinks: r.shrinks.map((c) => c.p), storefront_foreign: r.foreign, storefront: r.storefront,
    // Names, capped: a scoped deploy lists every file; an unscoped one over a
    // foreign storefront leaves that bundle out, as the listing does.
    changed_files: r.changed.map((c) => c.p).filter((p) => !(r.foreign && isStorefront(p))).slice(0, 200),
    added_files: r.added.filter((p) => !(r.foreign && isStorefront(p))).slice(0, 200),
    scope_hint: scopeHint(r),
  }

  stage(3, OF, 'live health')
  const before = await health()
  printHealth(before, 'live now')
  await headers()
  report.health_before = healthSummary(before)

  if (foreignStorefront(r)) {
    say('STOREFRONT the live index.html is a different build (no sporta-build marker) — a whole-site')
    say('           apply would remove what that build has and this one lacks; it refuses without --replace-storefront')
  }
  if (mode === 'plan') {
    stage(4, OF, 'result')
    const hint = scopeHint(r)
    say(`== SUMMARY plan ref=${short(ref)}${ONLY.length ? ` only=${ONLY.join(',')}` : ''} (+${elapsed()}s)`)
    say(`  compared ${compared}: same ${r.same.length} · changed ${r.changed.length} · new ${r.added.length} · live-only ${r.liveOnly.length}`
      + (r.foreign ? ` (storefront, foreign build: ${r.storefront.changed + r.storefront.same + r.storefront.added + r.storefront.liveOnly} counted, not listed)` : ''))
    say(`  an apply of this ref would copy ${r.added.length + r.changed.length} files (${r.changed.length} replaced, ${r.added.length} added)`
      + `${r.shrinks.length ? ` — SHRINK GUARD would refuse ${r.shrinks.length} without --allow-shrink` : ''}`
      + `${foreignStorefront(r) ? ' — STOREFRONT GUARD would refuse without --replace-storefront' : ''}`)
    if (r.foreign && hint.length) say(`  scoped, the same without the storefront: --only ${hint.join(',')}`)
    say(`  health: ${healthLine(before)}`)
    say('PLAN_OK nothing was changed')
    emitJson('PLAN_OK')
    return
  }

  // ---------------------------------------------------------------- apply
  if (foreignStorefront(r) && process.env.SPORTA_DEPLOY_STOREFRONT !== '1') {
    fail('storefront guard: this would replace a live storefront built from other source — '
      + 'deploy with --only api,knet,pay, or pass --replace-storefront if that is really meant')
  }
  if (r.shrinks.length && process.env.SPORTA_DEPLOY_ALLOW_SHRINK !== '1') {
    fail(`shrink guard: ${r.shrinks.map((c) => c.p).join(' ')} — rerun with --allow-shrink only if live really is older`)
  }
  const work = [...r.added, ...r.changed.map((c) => c.p)]
  if (work.length === 0) {
    say(`== SUMMARY apply ref=${short(ref)} (+${elapsed()}s)`)
    say('  nothing to change: every file in scope is already live')
    say('DEPLOY_OK nothing to change')
    emitJson('DEPLOY_OK', { deployed: { added: 0, replaced: 0 } })
    return
  }
  stage(4, OF, 'backup')
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
  report.backup = name

  stage(5, OF, `copy ${work.length} files`)
  // index.html last: a half-finished copy must not be a page asking for
  // assets that have not arrived yet.
  const order = [...work].sort((a, b) => (a === 'index.html') - (b === 'index.html') || a.localeCompare(b))
  // Running count: at most ten progress lines however many files there are,
  // so a whole-site copy stays well inside the 300-entry log.
  const every = Math.max(1, Math.ceil(order.length / 10))
  let done = 0
  for (const p of order) {
    const to = path.join(LIVE, p)
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 })
    fs.copyFileSync(path.join(dist, p), to)
    fs.chmodSync(to, 0o644)
    done++
    if (done % every === 0 || done === order.length) say(`  copied ${done}/${order.length}${done === order.length ? ` (+${elapsed()}s)` : ''}`)
  }

  stage(6, OF, 'verify')
  const after = await health()
  printHealth(after, 'after deploy')
  report.health_after = healthSummary(after)
  const broke = healthBroke(before, after)
  if (broke.length) {
    say(`-- broke: ${broke.join(' · ')} — rolling back`)
    restore(name)
    const h = await health()
    printHealth(h, 'after rollback')
    say(`== SUMMARY apply ref=${short(ref)} (+${elapsed()}s)`)
    say(`  broke: ${broke.join(' · ')}`)
    say(`  rolled back: ${name} — the live tree is as it was`)
    say(`  health after rollback: ${healthLine(h)}`)
    report.health_rollback = healthSummary(h)
    fail('deploy rolled back')
  }
  fs.mkdirSync(RELEASES, { recursive: true })
  fs.writeFileSync(path.join(RELEASES, `${name}.json`), JSON.stringify({ ref, stamp, files: work.length }, null, 1))
  const names = order.slice(0, 30).join(' ') + (order.length > 30 ? ` … +${order.length - 30} more` : '')
  say(`== SUMMARY apply ref=${short(ref)}${ONLY.length ? ` only=${ONLY.join(',')}` : ''} (+${elapsed()}s)`)
  say(`  deployed: ${r.added.length} added, ${r.changed.length} replaced — ${names}`)
  say(`  backup: ${name} (${changedPaths.length} files) under ${BACKUPS}`)
  say(`  rollback: node scripts/vps-deploy.mjs compose --rollback ${name}`)
  say(`  health after: ${healthLine(after)}`)
  say(`DEPLOY_OK ${name} — ${r.added.length} added, ${r.changed.length} replaced. Undo: compose --rollback ${name}`)
  emitJson('DEPLOY_OK', { deployed: { added: r.added.length, replaced: r.changed.length, files: order.slice(0, 200) } })
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'compose') {
  try { composeCommand(rest) } catch (e) { console.error(e.message); process.exit(2) }
} else if (cmd === 'run') {
  run().catch((e) => fail(e.stack ?? e.message))
} else {
  console.error('usage: node scripts/vps-deploy.mjs compose [--ref R] [--apply --confirm SHA [--allow-shrink]] [--rollback NAME] [--only a,b] [--quiet] [--json]\n'
    + '       node scripts/vps-deploy.mjs run   (inside the VPS job)')
  process.exit(2)
}
