#!/usr/bin/env node
// ADD-ON RELEASE 1 — the one-command runner.
//
//   npm run release:addons-1                      prove the release on the current tree
//   npm run release:addons-1 -- --apply <sha> <sha>   ... and print the apply command for that commit
//
// What it is for. Reviewed add-on work (CSS and JS files the live index.html links,
// plus the slimmed fonts) has been piling up in the branch since the last deploy,
// deploy-20261103T104853Z-8bf6001. The deploy route is scripts/vps-deploy.mjs, a
// one-shot Docker Compose job that the Hostinger API runs on the VPS, and the
// connector is a TOOL CALL in a Claude session, not a shell command. So this script
// does everything that can be done without the connector, in one go, and prints the
// exact lines the connector session then runs. It never deploys anything itself.
//
// The seven steps, in order:
//   1  tree and HEAD      clean working tree; HEAD's message free of "do not deploy",
//                         "NOT READY" and "WIP snapshot" (--allow-wip turns the refusal
//                         into a warning, for a dry run on an unclean branch)
//   2  manifest           every file in the release exists, is committed, and every
//                         backend route or PHP file it names exists in the LIVE backend
//                         (commit 1eb487aa — see CLAUDE.md item 5); the files held back
//                         are listed with the reason, and the reason is re-checked
//   3  file audit         scripts/file-audit.mjs over a release build, exactly as the
//                         VPS job runs it (it aborts there on a HIGH finding; better to
//                         learn that here). Default: `npm run release` into dist/ and
//                         audit dist/. --dist <dir> audits a tree built elsewhere.
//   4  suites             the rig-free proving suites (Chromium against fixtures of the
//                         live markup; no database, no shared port), one at a time, with
//                         a table of counts
//   5  sizes              raw / gzip / brotli bytes of every file, and against a capture
//                         of the live files when --live-dir points at one
//   6  commands           the vps-deploy PLAN command and its compose JSON (written to
//                         --out), and with --apply <sha> <sha> the APPLY command and
//                         compose JSON, the backup name pattern, the rollback line and
//                         the post-deploy read-only checks
//   7  summary            PASS, or FAIL with the first failing line; exit code 1 on FAIL
//
// Safety rules of vps-deploy.mjs are untouched: this script only CALLS its `compose`
// mode (which is local and prints JSON) and never its `run` mode. The SHA twice, the
// backups, the shrink guard, the foreign-storefront guard, the keep-list, the
// auto-rollback and the DEPLOY_OK / DEPLOY_FAIL markers all stay where they are.
//
// Options
//   --allow-wip          warn instead of refusing a HEAD whose message says do-not-deploy
//   --apply <sha> <sha>  also print and write the apply command for that commit (full
//                        40-character SHA, twice — vps-deploy's own rule)
//   --dist <dir>         audit this release tree instead of building one into dist/
//   --skip-audit         skip step 3 (the VPS job still runs it)
//   --skip-suites        skip step 4
//   --suites a,b,c       run only these suites (names from the table below)
//   --live-dir <dir>     a capture of the live add-on files (and fonts/), for the size delta
//   --out <dir>          where the compose JSON files and suite logs go
//                        (default: <tmpdir>/sporta-release-addons-1)
//   --manifest           print the manifest (IN / OUT with reasons) and exit
//
// Exit code: 0 PASS, 1 FAIL (first failing line printed last), 2 bad usage.
import { spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')   // sporta-web
const REPO = path.resolve(WEB, '..')
const PUB = path.join(WEB, 'public')

// ------------------------------------------------------------------ live facts
// The backend the live site runs (CLAUDE.md item 5: the live api/, knet/ and pay/ PHP
// was byte-identical to this commit). A route or file an add-on needs must exist HERE.
const LIVE_BACKEND = '1eb487aa6480195adeab1b0273884d566a01bfb7'
// The last deploy of anything (CLAUDE.md item 5) and the commit it shipped.
const LAST_DEPLOY = { name: 'deploy-20261103T104853Z-8bf6001', sha: '8bf600168ea085743d45f9231bbfe560105dc0c4' }
const STORE_DIR = 'sporta-web/dropin/php-store'

// ------------------------------------------------------------------ the manifest
// IN: deployable now, against the live backend 1eb487aa and the live database.
// `routes` is what a script is KNOWN to call; step 2 verifies each against the live
// backend and fails on any route the script names that is not declared here, so a
// future edit that calls something new trips the runner instead of the live site.
// `suites` are the proving suites (names from SUITES below). `what` is the owner-facing
// line: what changes on the site.
const IN = [
  { file: 'sporta-product-fix.css', suites: ['sizes-product', 'add-to-cart-ux', 'product-desc', 'icons-polish'],
    what: 'Product page: the size ladder, option cards and buy row are tighter (sizes lane C); the description keeps its line breaks; Add to bag sits beside Buy now in the phone bar with a readable sold-out and "in your bag" state (U3); focus never lands under the stuck buy row.' },
  { file: 'sporta-brand-theme.css', suites: ['words-colours', 'icons-polish'],
    what: 'Buttons, hover and keyboard focus in the brand orange; the bundle\'s leftover terracotta and slate tints replaced; a visible focus halo on fields.' },
  { file: 'sporta-home-trim.css', suites: ['home-features', 'about-page', 'icons-polish'],
    what: 'About page: one scale for every number; the features band as deployed on 2026-11-03.' },
  { file: 'sporta-cart-drawer.css', suites: ['cart-ux', 'sizes-screen'],
    what: 'Bag drawer: sticky checkout bar whose total never hides under the button at 130% text, no silent delete at quantity 1, focus kept, shadow strip gone, Arabic size label beside its name (U2); smaller drawer type (sizes lane B).' },
  { file: 'sporta-grid.css', suites: ['shop-header', 'images-layout', 'icons-polish'],
    what: 'Shop, brand, category and search pages: shorter phone header, 14px menu tabs, 3px focus ring; the footer stays under the fold while the grid loads.' },
  { file: 'sporta-bag-touch.css', suites: ['cart-ux', 'menu-layout', 'icons-polish'],
    what: 'Bag page: the sticky bottom checkout bar and its touch targets (U2); the phone tab row can scroll to its first tab; header and menu layout.' },
  { file: 'sporta-cat-tiles.css', suites: ['sizes-screen'],
    what: 'Home page tiles and brand strip at the reduced sizes (sizes lane B).' },
  { file: 'sporta-admin-knet.css', suites: ['admin-light', 'admin-payments', 'admin-polish', 'sizes-admin', 'icons-polish'],
    what: '/backends: the Payments (KNET) screen stays light in every dark state (owner: no dark mode for knet); compact table density (sizes admin lane); polish of cards, notices and fields. Shipped as the commented source file (the slim build is NOT switched in).' },
  { file: 'sporta-returns-touch.css', suites: ['sizes-screen'],
    what: 'About, policy and editorial pages at the reduced sizes (sizes lane B).' },
  { file: 'sporta-clock.css', suites: ['icons-polish'],
    what: 'The header clock face drawn at the icon sizes of the icons polish.' },
  { file: 'sporta-ui-colours.css', suites: ['words-colours', 'icons-polish'],
    what: 'Readable hero text and slide arrows on photo slides, a keyboard focus ring that meets contrast, the sold-out band in front of the photo, a darker bag-drawer remove icon, disabled controls that still read (live scan C1-C6); dark-theme guards for the light colours.' },
  { file: 'sporta-checkout-a11y.css', suites: ['checkout-ux', 'checkout-a11y', 'sizes-screen'],
    what: 'Checkout: first field above the pay bar on phones, delivery page about 480px shorter, discount code and note behind links, a "Delivery - Free" row read in order by a screen reader, greyed (not see-through) disabled pay button, sticky pay button with the total (U1); 44px touch targets, selected radio and focus ring in the dark orange (cash-04..13); footer and checkout headings at the reduced sizes.' },
  { file: 'sporta-shadows.css', suites: ['icons-polish'],
    what: 'Storefront icons: one stroke scale in two screen-pixel tiers, Arabic ink alignment, the AI launcher label from 640px.' },
  { file: 'sporta-images.css', suites: ['images-layout', 'icons-polish'],
    what: 'Product gallery on a short laptop window keeps the photo and the buy box on screen.' },
  { file: 'sporta-features.js', api: 'api.php', routes: ['stock', 'brands', 'brand_logo'],
    suites: ['add-to-cart-ux', 'sizes-product', 'race-client', 'shop-header', 'about-page', 'sizes-weight'],
    what: 'Add to bag answers "Added" (announced to screen readers), asks for a size when none is chosen, says "In your bag" for the last unit and ignores a double tap (U3); a failed stock answer no longer makes the product page re-ask on every render; the /shop?brand= banner, the maker-mark link and the About page brand names come from the live brands list; small WebP copies of product photographs are used on cards and thumbnails ONCE the server has them (see the note on variants.txt).' },
  { file: 'sporta-footer-call.js', suites: ['cart-ux'],
    what: 'Bag drawer and bag page accessibility: the sticky bar, no silent delete at quantity 1, focus kept on the row (U2, second block).' },
  { file: 'sporta-gov-autopick.js', suites: ['checkout-location', 'race-client'],
    what: 'Checkout: the governorate is picked from the area; the optional "Share my location" line is stripped from the remembered details on write and on load, so a quick checkout can never send a stale pin (the promised stale-pin fix).' },
  { file: 'sporta-checkout-a11y.js', suites: ['checkout-ux', 'checkout-a11y'],
    what: 'Checkout: phone number checked on blur, the scrolling bag list reachable by keyboard, the sticky pay button (U1 script half).' },
  { file: 'birthday.js', api: 'birthday.php', routes: ['get', 'set'], suites: ['race-client', 'sizes-weight'],
    what: 'Three guards (K3 races): the bag is merged between tabs instead of one tab overwriting another, Enter in the discount box does nothing while a request is out, and the checkout form is unstuck when the shopper comes back from the bank with the Back button. The birthday field itself is unchanged.' },
  { file: 'fonts', dir: true, suites: ['fonts-used', 'admin-polish'],
    what: 'The eight font files carry only the weights the site uses (253,472 to 221,968 bytes, pixel-identical on 140 page states). Same names as live, so a plain file copy.' },
]

// OUT: held back, with the reason. A `routes` entry is re-checked against the live
// backend in step 2 so the reason stays true (or stops being true, visibly).
const OUT = [
  { file: 'sporta-admin-brands.js', api: 'admin.php', routes: ['brand_products'], files: ['abandoned.php'],
    why: 'calls admin.php?r=brand_products and abandoned.php, neither in the live backend 1eb487aa, and says "30 days" (the 30-day sign-in ships with the API). Goes with the backend release (CLAUDE.md item 5).' },
  { file: '.htaccess', why: 'release 2 (HANDOFF.md): 304 revalidation of the compressed add-ons, the compressed 404 shell, the per-file CSP for /pay (read the live pay-config hosts first).' },
  { file: 'backends-offline.css', why: 'not linked by the live index.html, and a file it does not link is never loaded.' },
  { file: 'boot.js', same: true, why: 'HEAD is byte-identical to live (checked against the 2026-11-02 capture): nothing to deploy.' },
  { file: 'sporta-clock.js', same: true, why: 'HEAD is byte-identical to live: nothing to deploy.' },
  { file: 'config.js', why: 'live-only configuration; vps-deploy.mjs never touches it (keep-list).' },
  { file: 'index.html, assets/, sw.js, sitemaps, robots.txt, site.webmanifest', why: 'the foreign storefront build; never part of a deploy (CLAUDE.md item 5). The add-on URLs it links keep their ?v= query, which is fine: the live .htaccess serves every add-on no-cache, must-revalidate, so a replaced file reaches a returning visitor on the next page load.' },
]

// The proving suites. All rig-free: Chromium (playwright) against fixtures of the live
// markup or the repo's own throwaway build; no MariaDB, no shared port, no dist/.
// `test:contrast` (vite preview on 4173), `test:vps-deploy` (dist/) and
// `test:addons-brands` (the OUT file) are deliberately not here.
const SUITES = [
  { name: 'checkout-ux', script: 'test:checkout-ux' },
  { name: 'cart-ux', script: 'test:cart-ux' },
  { name: 'add-to-cart-ux', script: 'test:add-to-cart-ux' },
  { name: 'race-client', script: 'test:race-client' },
  { name: 'checkout-location', script: 'test:checkout-location' },
  { name: 'checkout-a11y', script: 'test:checkout-a11y' },
  { name: 'sizes-screen', script: 'test:sizes-screen' },
  { name: 'sizes-product', script: 'test:sizes-product' },
  { name: 'sizes-admin', script: 'test:sizes-admin' },
  { name: 'sizes-weight', script: 'test:sizes-weight' },
  { name: 'admin-polish', script: 'test:admin-polish' },
  { name: 'admin-light', script: 'test:admin-light' },
  { name: 'admin-payments', script: 'test:admin-payments' },
  { name: 'fonts-used', script: 'test:fonts-used' },
  { name: 'home-features', script: 'test:home-features' },
  { name: 'icons-polish', script: 'test:icons-polish' },
  { name: 'menu-layout', script: 'test:menu-layout' },
  { name: 'shop-header', script: 'test:shop-header' },
  { name: 'words-colours', script: 'test:words-colours' },
  { name: 'images-layout', script: 'test:images-layout' },
  { name: 'about-page', script: 'test:about-page' },
  { name: 'product-desc', script: 'test:product-desc' },
]
const SUITE_TIMEOUT_MS = 30 * 60 * 1000

// ------------------------------------------------------------------ options
const opt = { allowWip: false, apply: null, dist: '', skipAudit: false, skipSuites: false, suites: null, liveDir: process.env.SPORTA_LIVE_DIR ?? '', out: '', manifest: false, withHtaccess: false }
{
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    if (x === '--allow-wip') opt.allowWip = true
    else if (x === '--with-htaccess') opt.withHtaccess = true
    else if (x === '--apply') { opt.apply = [a[++i] ?? '', a[++i] ?? ''] }
    else if (x === '--dist') opt.dist = a[++i] ?? ''
    else if (x === '--skip-audit') opt.skipAudit = true
    else if (x === '--skip-suites') opt.skipSuites = true
    else if (x === '--suites') opt.suites = (a[++i] ?? '').split(',').filter(Boolean)
    else if (x === '--live-dir') opt.liveDir = a[++i] ?? ''
    else if (x === '--out') opt.out = a[++i] ?? ''
    else if (x === '--manifest') opt.manifest = true
    else if (x === '-h' || x === '--help') { usage(); process.exit(0) }
    else { console.error(`unknown option ${x}`); usage(); process.exit(2) }
  }
}
function usage() {
  console.error('usage: node ops/release/release-addons-1.mjs [--allow-wip] [--apply <sha> <sha>] [--dist <dir>|--skip-audit]\n'
    + '         [--skip-suites] [--suites a,b] [--live-dir <dir>] [--out <dir>] [--with-htaccess] [--manifest]')
}
if (!opt.out) opt.out = path.join(os.tmpdir(), 'sporta-release-addons-1')
fs.mkdirSync(path.join(opt.out, 'suites'), { recursive: true })

// --with-htaccess moves .htaccess from OUT to IN. HEAD's .htaccess is what went live on
// 2026-11-03 plus two blocks (the 304 answer to a compressed ETag, and the compressed
// 404 shell); the /pay CSP change is an UNAPPLIED patch, not in HEAD. Why one would:
// without the 304 line, a returning visitor whose browser revalidates the no-cache
// add-ons gets every one of them in full on every page load (measured against this file
// on Apache 2.4.58; not yet confirmed on the live server) — about 48 kB Brotli today and
// about 123 kB after this release. HANDOFF.md lists .htaccess as release 2; this flag is
// the decision to ship those two blocks with release 1, and it is the owner's to make.
if (opt.withHtaccess) {
  const i = OUT.findIndex((f) => f.file === '.htaccess')
  if (i >= 0) OUT.splice(i, 1)
  IN.push({ file: '.htaccess', suites: ['htaccess-rules', 'sizes-weight'],
    what: 'Returning visitors get an empty 304 instead of the whole file when they re-check an add-on; the 404 page is sent compressed. The script hashes in the CSP are filled at build time, as on 2026-11-03. (Guarded by the shrink rule of vps-deploy; it only grows here.)' })
  SUITES.push({ name: 'htaccess-rules', script: 'test:htaccess-rules' })
}

// ------------------------------------------------------------------ helpers
const failures = []
const warnings = []
const suiteRows = []
let dryRun = false   // set when --allow-wip waved a step-1 refusal through: the output is a rehearsal, not a release proof
const say = (s = '') => console.log(s)
const ok = (s) => say(`  ok    ${s}`)
const warn = (s) => { warnings.push(s); say(`  WARN  ${s}`) }
const bad = (s) => { failures.push(s); say(`  FAIL  ${s}`) }
const step = (n, title) => say(`\n[${n}/7] ${title}`)
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
// Quiet: a blob that does not exist at the baseline is an answer, not an error to print.
const gitTry = (...args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
const liveBlob = (p) => gitTry('show', `${LIVE_BACKEND}:${STORE_DIR}/${p}`)
const kb = (n) => `${(n / 1024).toFixed(1)} kB`
const gz = (b) => zlib.gzipSync(b, { level: 6 }).length
const br = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length
const SHA = /^[0-9a-f]{40}$/
const onlyList = () => IN.map((f) => f.file).join(',')   // a dir is its own top-level name for --only
const pad = (s, n) => String(s).padEnd(n)
const rpad = (s, n) => String(s).padStart(n)

// Every file the release ships, as served paths (a dir expands to its files).
function releasePaths() {
  const out = []
  for (const f of IN) {
    if (f.dir) for (const e of fs.readdirSync(path.join(PUB, f.file)).sort()) out.push(`${f.file}/${e}`)
    else out.push(f.file)
  }
  return out
}

if (opt.manifest) {
  say('ADD-ON RELEASE 1 — manifest')
  say(`live backend: ${LIVE_BACKEND.slice(0, 8)} · last deploy: ${LAST_DEPLOY.name}`)
  say('\nIN (deployable now):')
  for (const f of IN) say(`  ${pad(f.file, 28)} suites: ${f.suites.join(', ')}${f.routes ? ` · routes: ${f.api} ${f.routes.join(',')}` : ''}`)
  say('\nOUT (held back):')
  for (const f of OUT) say(`  ${pad(f.file, 28)} ${f.why}`)
  say(`\n--only ${onlyList()}`)
  process.exit(0)
}

// ================================================================== 0 header
say('ADD-ON RELEASE 1 — runner')
say(`repo ${REPO}`)
const headSha = git('rev-parse', 'HEAD').trim()
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim()
say(`HEAD ${headSha} (${branch}) · node ${process.versions.node} · out ${opt.out}`)
if (Number(process.versions.node.split('.')[0]) < 24) {
  warn(`the pinned toolchain is Node 24 (sporta-web/.nvmrc); this box runs v${process.versions.node}. The suites are the same; a release build here may differ from the VPS job's (node:24-alpine).`)
}

// ================================================================== 1 tree and HEAD
step(1, 'tree and HEAD')
{
  // Both refusals here are waved through by --allow-wip, which makes the rest a DRY RUN
  // (nothing it prints is a release proof, and no apply compose file is written).
  const refuse = (line) => { if (opt.allowWip) { dryRun = true; warn(`${line} [--allow-wip: dry run]`) } else bad(line) }
  const dirty = git('status', '--porcelain', '--untracked-files=normal').split('\n').filter(Boolean)
  if (dirty.length) {
    refuse(`working tree is not clean (${dirty.length} path(s)): ${dirty.slice(0, 6).join(' · ')}${dirty.length > 6 ? ' …' : ''} — commit or stash first; a deploy is of a commit, never of a tree`)
  } else ok('working tree clean')

  const msg = git('log', '-1', '--format=%B', 'HEAD')
  const subject = msg.split('\n')[0]
  const hit = /do not deploy|not ready|wip snapshot/i.exec(msg)
  if (hit) refuse(`HEAD's message says "${hit[0]}" (${subject.slice(0, 90)}) — cut the clean release commit first (ops/release/RELEASE-1-COMMIT.txt)`)
  else ok(`HEAD's message is clean: ${subject.slice(0, 90)}`)

  // Informational: the snapshots that carried release-1 edits since the last deploy.
  const snaps = git('log', '--format=%h %s', `${LAST_DEPLOY.sha}..HEAD`, '--', ...releasePaths().map((p) => `sporta-web/public/${p}`))
    .split('\n').filter((l) => /wip snapshot/i.test(l))
  if (snaps.length) say(`  note  ${snaps.length} WIP-snapshot commit(s) since ${LAST_DEPLOY.name} touched release-1 files; their content was reviewed by the lane commits that followed (see RELEASE-1-COMMIT.txt)`)

  const remote = gitTry('branch', '-r', '--contains', headSha)
  if (remote && remote.trim()) ok(`HEAD is on a remote branch (${remote.trim().split('\n')[0].trim()}) — the VPS can download it`)
  else warn('HEAD is on no remote branch: push it before the plan, or the VPS job cannot download the tarball')

  if (failures.length) finish()
}

// ================================================================== 2 manifest
step(2, `manifest: ${IN.length} entries IN, ${OUT.length} OUT, checked against the live backend ${LIVE_BACKEND.slice(0, 8)}`)
{
  if (!liveBlob('api.php')) bad(`cannot read ${STORE_DIR}/api.php at ${LIVE_BACKEND.slice(0, 8)} — is the baseline commit in this clone?`)
  const tracked = new Set(git('ls-files', '--', 'sporta-web/public').split('\n').filter(Boolean).map((p) => p.replace(/^sporta-web\/public\//, '')))

  // Route and file tokens a script names. Deliberately broad (comments included): a
  // route named only in a comment is harmless to declare, a call missed is not.
  const routeTokens = (text) => {
    const r = new Set()
    for (const m of text.matchAll(/\br=([a-z_]+)/g)) r.add(m[1])
    for (const m of text.matchAll(/\b(?:call|request)\((?:'(?:GET|POST)',\s*)?'([a-z_]+)'/g)) r.add(m[1])
    return [...r].sort()
  }
  const phpTokens = (text) => [...new Set([...text.matchAll(/\b([a-z-]+\.php)\b/g)].map((m) => m[1]))].sort()
  // api.php / admin.php dispatch with `$r === 'name'`; birthday.php with
  // `in_array($route, ['get', 'set'], true)`. Either way the name is quoted on a line
  // that handles the route variable.
  const hasRoute = (php, route) => { const t = liveBlob(php); return !!t && new RegExp(`^.*\\$(?:r|route)\\b.*'${route}'.*$`, 'm').test(t) }

  for (const f of IN) {
    const abs = path.join(PUB, f.file)
    if (!fs.existsSync(abs)) { bad(`${f.file}: missing from public/`); continue }
    const paths = f.dir ? fs.readdirSync(abs).map((e) => `${f.file}/${e}`) : [f.file]
    const untracked = paths.filter((p) => !tracked.has(p))
    if (untracked.length) { bad(`${f.file}: not committed: ${untracked.join(' ')}`); continue }
    if (f.dir || /\.css$|^\.htaccess$/.test(f.file)) { ok(`${pad(f.file, 26)} ${f.dir ? `${paths.length} files` : f.file === '.htaccess' ? 'apache rules' : 'css'} · no backend dependency`); continue }
    const text = fs.readFileSync(abs, 'utf8')
    const php = phpTokens(text).filter((p) => p !== f.api)
    const routes = routeTokens(text)
    const undeclared = routes.filter((r) => !(f.routes ?? []).includes(r))
    const missing = (f.routes ?? []).filter((r) => !hasRoute(f.api, r))
    const missingPhp = php.filter((p) => !liveBlob(p))
    if (f.routes && !liveBlob(f.api)) bad(`${f.file}: ${f.api} does not exist in the live backend`)
    if (missing.length) bad(`${f.file}: route(s) absent from the live ${f.api}: ${missing.join(', ')} — not deployable before the API release`)
    if (missingPhp.length) bad(`${f.file}: names PHP file(s) absent from the live backend: ${missingPhp.join(', ')}`)
    if (undeclared.length) bad(`${f.file}: names route(s) the manifest does not declare: ${undeclared.join(', ')} — check each against ${LIVE_BACKEND.slice(0, 8)} and declare it`)
    if (!missing.length && !missingPhp.length && !undeclared.length) {
      ok(`${pad(f.file, 26)} ${f.routes ? `${f.api} r=${f.routes.join(',')}: all in the live backend` : 'no backend call'}${php.length ? ` · files ${php.join(',')} exist live` : ''}`)
    }
  }
  say('  -- held back:')
  for (const f of OUT) {
    let proof = ''
    if (f.routes) {
      const absent = f.routes.filter((r) => !hasRoute(f.api, r))
      const absentFiles = (f.files ?? []).filter((p) => !liveBlob(p))
      proof = ` [re-checked: ${absent.length ? `${f.api} lacks ${absent.join(',')}` : `${f.api} HAS ${f.routes.join(',')} now?`}${absentFiles.length ? `; no ${absentFiles.join(',')} live` : ''}]`
      if (!absent.length && !absentFiles.length) warn(`${f.file}: the reason it is held back no longer holds against ${LIVE_BACKEND.slice(0, 8)} — re-decide`)
    }
    if (f.same) {
      // HEAD vs the live capture when one is given; else say what we know.
      const lp = opt.liveDir ? path.join(opt.liveDir, f.file) : ''
      if (lp && fs.existsSync(lp)) {
        const same = fs.readFileSync(lp).equals(fs.readFileSync(path.join(PUB, f.file)))
        if (!same) warn(`${f.file}: HEAD differs from the capture in --live-dir; it is listed as unchanged — re-decide`)
        else proof = ' [byte-identical to the capture]'
      }
    }
    say(`  out   ${pad(f.file, 26)} ${f.why}${proof}`)
  }
}

// ================================================================== 3 file audit
step(3, 'file audit (what the VPS job runs before it compares anything)')
if (opt.skipAudit) warn('audit skipped (--skip-audit); the VPS job will still run it and abort on a HIGH finding')
else {
  const dist = opt.dist ? path.resolve(opt.dist) : path.join(WEB, 'dist')
  if (!opt.dist) {
    say('  building into dist/ with `npm run release` (VITE_* emptied, as publish and the VPS job do) …')
    const clean = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('VITE_')).map((k) => [k, '']))
    const r = spawnSync('npm', ['run', '-s', 'release'], { cwd: WEB, encoding: 'utf8', env: { ...process.env, ...clean, CI: '1' }, maxBuffer: 64 * 1024 * 1024 })
    fs.writeFileSync(path.join(opt.out, 'release-build.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`)
    if (r.status !== 0) bad(`npm run release exited ${r.status} (log: ${path.join(opt.out, 'release-build.log')})`)
  }
  if (!failures.some((l) => l.startsWith('npm run release'))) {
    if (!fs.existsSync(path.join(dist, 'index.html'))) bad(`${dist} has no index.html — not a release tree`)
    else {
      const r = spawnSync('node', ['scripts/file-audit.mjs', dist], { cwd: WEB, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
      fs.writeFileSync(path.join(opt.out, 'file-audit.log'), text)
      const summary = /(\d+) high, (\d+) medium, (\d+) low/.exec(text)
      const highs = []
      const lines = text.split('\n')
      const at = lines.findIndex((l) => l.trim() === '--- HIGH ---')
      if (at >= 0) for (let i = at + 1; i < lines.length && !/^--- (MED|LOW) ---/.test(lines[i].trim()); i++) if (lines[i].trim()) highs.push(lines[i].trim())
      if (r.status === 0) ok(`file audit clean: ${summary ? summary[0] : 'no summary line'} (${dist})`)
      else {
        bad(`file audit failed (${summary ? summary[0] : `exit ${r.status}`}) — vps-deploy.mjs aborts at this step on the VPS`)
        for (const h of highs.slice(0, 12)) say(`        ${h}`)
        if (highs.some((h) => /referenced file missing: \/(pages|lib|i18n)\//.test(h))) {
          say('        ^ these are COMMENTS that mention src/… paths; file-audit reads "src/…" as a src= reference. Reword the comments')
          say('          (assistant.php, birthday.js, sporta-admin-brands.js) or teach the audit the difference. Not a shipping bug.')
        }
      }
    }
  }
}

// ================================================================== 4 suites
step(4, 'proving suites (rig-free; one at a time)')
if (opt.skipSuites) warn('suites skipped (--skip-suites)')
else {
  const scripts = JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8')).scripts ?? {}
  const chosen = opt.suites ? SUITES.filter((s) => opt.suites.includes(s.name)) : SUITES
  const unknown = (opt.suites ?? []).filter((n) => !SUITES.some((s) => s.name === n))
  if (unknown.length) bad(`unknown suite name(s): ${unknown.join(', ')}`)
  say(`  ${pad('suite', 20)} ${pad('script', 24)} ${rpad('passed', 7)} ${rpad('failed', 7)} ${rpad('secs', 5)}  result`)
  for (const s of chosen) {
    if (!scripts[s.script]) { bad(`${s.name}: package.json has no ${s.script}`); continue }
    process.stdout.write(`  ${pad(s.name, 20)} ${pad(s.script, 24)} running …`)
    const t0 = Date.now()
    const r = spawnSync('npm', ['run', '-s', s.script], { cwd: WEB, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL' })
    const secs = Math.round((Date.now() - t0) / 1000)
    const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    const log = path.join(opt.out, 'suites', `${s.name}.log`)
    fs.writeFileSync(log, text)
    // "N passed, M failed" · "N ok, M failed" · "N of M checks passed" ·
    // "N checks: A ok, B expected-fail (known defects), C unexpected-pass, D FAIL" (htaccess-rules)
    let passed = null, failed = null
    const m1 = [...text.matchAll(/(\d+) (?:passed|ok), (\d+) failed/g)].pop()
    const m2 = [...text.matchAll(/(\d+) of (\d+) checks passed/g)].pop()
    const m3 = [...text.matchAll(/\d+ checks: (\d+) ok, \d+ expected-fail[^\n]*?(\d+) FAIL/g)].pop()
    if (m1) { passed = Number(m1[1]); failed = Number(m1[2]) }
    else if (m2) { passed = Number(m2[1]); failed = Number(m2[2]) - Number(m2[1]) }
    else if (m3) { passed = Number(m3[1]); failed = Number(m3[2]) }
    const timedOut = r.error && r.error.code === 'ETIMEDOUT'
    const good = r.status === 0 && failed === 0 && passed !== null && !timedOut
    const result = timedOut ? 'TIMEOUT' : r.status !== 0 ? `exit ${r.status}` : passed === null ? 'no summary line' : failed ? 'FAIL' : 'ok'
    process.stdout.write(`\r  ${pad(s.name, 20)} ${pad(s.script, 24)} ${rpad(passed ?? '-', 7)} ${rpad(failed ?? '-', 7)} ${rpad(secs, 5)}  ${result}\n`)
    suiteRows.push({ ...s, passed, failed, secs, status: result, log })
    if (!good) {
      const firstFail = text.split('\n').find((l) => /^FAIL\b|^\s*FAIL\b|Error:/.test(l)) ?? ''
      bad(`${s.name}: ${result}${firstFail ? ` — ${firstFail.trim().slice(0, 140)}` : ''} (log: ${log})`)
    }
  }
  const total = suiteRows.reduce((a, r) => ({ p: a.p + (r.passed ?? 0), f: a.f + (r.failed ?? 0) }), { p: 0, f: 0 })
  say(`  ${suiteRows.length} suite(s): ${total.p} passed, ${total.f} failed`)
  // Which IN file has no suite in this run.
  const ran = new Set(suiteRows.filter((r) => r.status === 'ok').map((r) => r.name))
  for (const f of IN) {
    const covered = f.suites.filter((n) => ran.has(n))
    if (!covered.length && !opt.suites) bad(`${f.file}: none of its suites passed in this run (${f.suites.join(', ')})`)
    else if (!covered.length) warn(`${f.file}: none of its suites ran (--suites)`)
  }
}

// ================================================================== 5 sizes
step(5, `sizes: HEAD bytes (raw / gzip / brotli)${opt.liveDir ? ` against the capture ${opt.liveDir}` : ' — pass --live-dir <capture> for the live delta'}`)
{
  // Text files travel compressed (Apache: Brotli, else gzip); fonts are already
  // compressed (woff2) and travel as they are, so only their raw bytes mean anything.
  const rows = []
  for (const p of releasePaths()) {
    const h = fs.readFileSync(path.join(PUB, p))
    const text = !/\.woff2?$/.test(p)
    const hs = text ? [h.length, gz(h), br(h)] : [h.length, null, null]
    let ls = null, same = false
    const lp = opt.liveDir ? path.join(opt.liveDir, p) : ''
    if (lp && fs.existsSync(lp)) { const l = fs.readFileSync(lp); ls = text ? [l.length, gz(l), br(l)] : [l.length, null, null]; same = l.equals(h) }
    rows.push({ p, text, hs, ls, same })
  }
  const col = (v, n) => rpad(v === null || v === undefined ? '-' : v, n)
  const line = (name, hs, ls, tail = '') => say(`  ${pad(name, 34)} ${ls ? `${col(ls[0], 8)} ${col(ls[1], 7)} ${col(ls[2], 7)}` : `${col(null, 8)} ${col(null, 7)} ${col(null, 7)}`} -> ${col(hs[0], 8)} ${col(hs[1], 7)} ${col(hs[2], 7)}${tail}`)
  const sum = (list, pick) => list.reduce((a, r) => { const v = pick(r); return v ? a.map((x, i) => x + (v[i] ?? 0)) : a }, [0, 0, 0])
  say(`  ${pad('file', 34)} ${rpad('live', 8)} ${rpad('gz', 7)} ${rpad('br', 7)}    ${rpad('HEAD', 8)} ${rpad('gz', 7)} ${rpad('br', 7)}`)
  const texts = rows.filter((r) => r.text), fonts = rows.filter((r) => !r.text)
  for (const r of texts) line(r.p, r.hs, r.ls, r.same ? '  (same)' : '')
  const tH = sum(texts, (r) => r.hs), tL = sum(texts.filter((r) => r.ls), (r) => r.ls), nL = texts.filter((r) => r.ls).length
  line('TEXT TOTAL', tH, opt.liveDir ? tL : null)
  if (fonts.length) {
    for (const r of fonts) line(r.p, r.hs, r.ls, r.same ? '  (same)' : '')
    const fH = sum(fonts, (r) => r.hs), fL = sum(fonts.filter((r) => r.ls), (r) => r.ls)
    line('FONTS TOTAL (raw; served as is)', [fH[0], null, null], opt.liveDir ? [fL[0], null, null] : null)
  }
  if (opt.liveDir) {
    say(`  ${nL} of ${texts.length} text files found in the capture: on the wire the add-ons go from about ${kb(tL[2])} Brotli to ${kb(tH[2])} per first visit`
      + ` (${kb(tL[1])} to ${kb(tH[1])} gzip). The live index.html links every add-on on every page, so this is paid on the first page view;`)
    say('  a returning visitor revalidates each file (no-cache, must-revalidate) and, until the .htaccess 304 line is live, is sent it again in full (see --with-htaccess).')
    if (fonts.length && !fonts.some((r) => r.ls)) say('  fonts: no live copies in the capture; their raw size is what the plan\'s "changed" lines will show (the names are the same as live).')
  }
  fs.writeFileSync(path.join(opt.out, 'sizes.json'), JSON.stringify(rows, null, 1))
}

// ================================================================== 6 commands
step(6, 'what the connector session runs (it starts each compose file with vps_docker_create, project "sporta-deploy", VM 2058651, and reads the log)')
{
  const only = onlyList()
  const planCmd = `node scripts/vps-deploy.mjs compose --ref ${headSha} --only ${only}`
  say('  PLAN (read-only; /docker/sporta is mounted read-only in the job):')
  say(`    cd sporta-web && ${planCmd} > plan.compose.json`)
  const plan = spawnSync('node', ['scripts/vps-deploy.mjs', 'compose', '--ref', headSha, '--only', only], { cwd: WEB, encoding: 'utf8' })
  // compose prints its "project · mode · ref" line and any warning on stderr; keep the warnings.
  const notes = (s) => s.split('\n').filter((l) => /warning/i.test(l)).join(' · ')
  if (plan.status === 0) {
    fs.writeFileSync(path.join(opt.out, 'plan.compose.json'), plan.stdout)
    ok(`plan compose written: ${path.join(opt.out, 'plan.compose.json')} (${plan.stdout.length} bytes)${notes(plan.stderr) ? ` · ${notes(plan.stderr)}` : ''}`)
  } else bad(`vps-deploy compose (plan) exited ${plan.status}: ${plan.stderr.trim()}`)
  say('    read the log: "release: N deployable files", "-- changed (live bytes -> release bytes)" must list ONLY the files above,')
  say('    "== HEALTH live now" all 200, then PLAN_OK. Anything else in "changed" means the --only list or the live side moved.')

  if (opt.apply) {
    const [a, b] = opt.apply
    if (!SHA.test(a) || !SHA.test(b)) bad(`--apply needs the full 40-character SHA twice (got "${a.slice(0, 12)}" / "${b.slice(0, 12)}")`)
    else if (a !== b) bad('--apply: the two SHAs differ — a deploy is of a commit someone named twice')
    else {
      if (a !== headSha) warn(`--apply ${a.slice(0, 7)} is not HEAD (${headSha.slice(0, 7)}): the plan above is for HEAD; plan that commit too`)
      const applyCmd = `node scripts/vps-deploy.mjs compose --apply --ref ${a} --confirm ${a} --only ${only}`
      say('  APPLY (writes; backs up every file it replaces; rolls itself back if a page that answered 200 stops):')
      say(`    cd sporta-web && ${applyCmd} > apply.compose.json`)
      if (dryRun) bad('apply compose NOT written: this is a dry run (--allow-wip waved a refusal through); run again on a clean tree with a clean HEAD')
      else {
        const ap = spawnSync('node', ['scripts/vps-deploy.mjs', 'compose', '--apply', '--ref', a, '--confirm', a, '--only', only], { cwd: WEB, encoding: 'utf8' })
        if (ap.status === 0) {
          fs.writeFileSync(path.join(opt.out, 'apply.compose.json'), ap.stdout)
          ok(`apply compose written: ${path.join(opt.out, 'apply.compose.json')}${notes(ap.stderr) ? ` · ${notes(ap.stderr)}` : ''}`)
        } else bad(`vps-deploy compose (apply) exited ${ap.status}: ${ap.stderr.trim()}`)
      }
      say(`    success = the log ends with "DEPLOY_OK deploy-<YYYYMMDD>T<HHMMSS>Z-${a.slice(0, 7)} — N added, M replaced"; anything else is not a deploy.`)
      say(`    backup:  /docker/sporta/backups/deploy-<stamp>-${a.slice(0, 7)}.tar.gz + .json (the files it replaced)`)
      say(`    undo:    node scripts/vps-deploy.mjs compose --rollback deploy-<stamp>-${a.slice(0, 7)}   (then vps_docker_create it; the log says ROLLED_BACK)`)
    }
  } else {
    say('  APPLY: run again with --apply <sha> <sha> (the full SHA of the clean release commit, twice) once the plan log reads as above.')
  }
  say('  AFTER the deploy, read-only, in this order:')
  say('    1. node scripts/vps-deploy.mjs compose --scan            (live-scan.mjs on the VPS = scan-server-response: TLS, redirects, headers, cache tiers)')
  say('    2. re-capture the live add-ons and pages (the plan\'s "changed" list is the file list); SIZES_LIVE_DIR=<capture> node scripts/make-sizes-fixtures.mjs refreshes the fixtures')
  say('    3. MODE=colors SCHEME=dark node scripts/admin-payments-scan.mjs   (Playwright image on the VPS; the Payments screen must read light in dark mode; admin calls are answered with made-up data, no sign-in)')
  say('       before the deploy the same scan takes CSS_URL=https://raw.githubusercontent.com/hkspower/wain/<sha>/sporta-web/public/sporta-admin-knet.css')
  say('    4. a read-only look at /checkout (ar and en, never submitted), /shop?brand=<slug>, a product page\'s size ladder, /cart — measure the DOM, not screenshots')
  say('    5. vps_docker_delete every scratch project; then move CLAUDE.md item 5 (what is live) and note the backup name')
}

// ================================================================== 7 summary
finish()

function finish() {
  step(7, 'summary')
  const result = {
    head: headSha, branch, node: process.versions.node, only: onlyList(), suites: suiteRows, warnings, failures,
    pass: failures.length === 0, dryRun, out: opt.out, at: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(opt.out, 'result.json'), JSON.stringify(result, null, 1))
  if (warnings.length) say(`  ${warnings.length} warning(s)`)
  if (failures.length) {
    say(`  FAIL — ${failures.length} failure(s). First: ${failures[0]}`)
    say(`  result: ${path.join(opt.out, 'result.json')}`)
    process.exit(1)
  }
  say(`  ${dryRun ? 'DRY RUN (not a release proof: see the step-1 warnings)' : 'PASS'} — ${IN.length} manifest entries checked; result: ${path.join(opt.out, 'result.json')}`)
  process.exit(0)
}
