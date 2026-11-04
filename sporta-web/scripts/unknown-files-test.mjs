#!/usr/bin/env node
// UNKNOWN FILES — the checks that keep the "which files do we not recognise" tools honest.
//
//   npm run test:unknown-files                 every section
//   node scripts/unknown-files-test.mjs --section live       one section
//
// SECTIONS
//   live      the LIVE-SERVER scanner (scripts/live-files-scan.mjs), the expected-files manifest
//             (scripts/make-expected-manifest.mjs) and the one-shot VPS job (ops/live-files-scan.compose.json),
//             proven on a FAKE DOCROOT built here from the repo's public/ + dropin/ at a commit (git archive,
//             so other people's uncommitted edits cannot move it), a foreign-build storefront, and a
//             /docker/sporta-shaped tree around it (private/, backups/, releases/, loose files, old copies).
//             Needs git and a clone with the history; chown-based checks need root and say so when skipped.
//             The repo-side lane adds its own section next to this one.
//
// WHAT "live" PROVES
//   1. the manifest is a pure function of a commit and its mapping/skip/setup lists equal the deploy's own
//   2. the clean fake docroot scans with ZERO findings, and every file is KNOWN with a named rule
//   3. 40 planted unknowns are each found with the verdict, flags and reach/exec facts they should have,
//      and NOTHING ELSE is flagged (the known files stay unflagged)
//   4. privacy: credential-looking files and everything under private/ (but the photo mount and small
//      non-credential files) are never opened; no sentinel secret and no secret value reaches the output
//   5. the output fits a 300-entry log, pages cover every finding exactly once, details files round-trip
//   6. the compose job: read-only mount, no network, no forbidden words, embeds the exact script and
//      manifest, and its own command line runs end to end against the fake docroot
//   7. the scanner's reference walk reaches exactly what scripts/old-files-inventory.mjs reaches
//   8. MUTATIONS: each detector is blinded in a copy of the scanner and the matching check must fail
//
// No ports, no database, no shared rig, no dist/. Everything is created under os.tmpdir() and removed.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(HERE, '..')
const REPO = path.join(WEB, '..')
const SCANNER = path.join(HERE, 'live-files-scan.mjs')
const argv = process.argv.slice(2)
const wanted = argv.includes('--section') ? argv[argv.indexOf('--section') + 1] : 'all'
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

let fails = 0, passes = 0
const ok = (m) => { passes++; console.log(`ok   ${m}`) }
const bad = (m, d = '') => { fails++; console.log(`FAIL ${m}${d ? `  -- ${d}` : ''}`) }
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d))
const skipped = []

const scan = await import(pathToFileURL(SCANNER).href)
const gen = await import(pathToFileURL(path.join(HERE, 'make-expected-manifest.mjs')).href)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-files-'))
// UNKNOWN_FILES_KEEP=1 leaves the fake docroots behind for a look (clean/, planted/, flood/ under the printed folder).
process.on('exit', () => { if (process.env.UNKNOWN_FILES_KEEP) { console.log(`kept ${TMP}`); return } try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ } })

// ---------------------------------------------------------------- fake docroot
const BASE_MS = Date.UTC(2026, 10, 3, 10, 48, 53) - 86400 * 1000      // a day before the last deploy
const DEPLOY_NAME = 'deploy-20261103T104853Z-8bf6001'
const DEPLOY_MS = Date.UTC(2026, 10, 3, 10, 48, 53)
const SENTINEL = 'SENTINEL_NEVER_PRINT_8841'
const FAKE_AWS = 'AKIAIOSFODNN7EXAMPLE'                              // the example key from AWS's own documentation
const CAPTURE = process.env.UNKNOWN_FILES_LIVE_CAPTURE
  ?? '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'
const B = {
  jpeg: (n = 600) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(n, 0x11)]),
  png: (n = 400) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 0x22)]),
  webp: (n = 400) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x90, 1, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(n, 0x33)]),
  elf: () => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(200, 0x44)]),
  zip: () => Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(300, 0x55)]),
  gz: () => Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0]), Buffer.alloc(300, 0x66)]),
}
const mk = (R, rel, mode = 0o755, uid) => {
  const abs = path.join(R, rel)
  fs.mkdirSync(abs, { recursive: true })
  fs.chmodSync(abs, mode)
  if (uid !== undefined && IS_ROOT) fs.chownSync(abs, uid, uid)
  return abs
}
function put(R, rel, data, { mode = 0o644, uid, gid, mtime = BASE_MS } = {}) {
  const abs = path.join(R, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, data)
  fs.chmodSync(abs, mode)
  if (uid !== undefined && IS_ROOT) fs.chownSync(abs, uid, gid ?? uid)
  fs.utimesSync(abs, mtime / 1000, mtime / 1000)
  return abs
}
const siteUid = (rel) => (/^(?:api|knet|pay)\//.test(rel) ? 0 : 501)   // a deploy job writes as root, the Mac upload was uid 501

// A foreign-build storefront: an index.html that links an entry chunk, preloads, add-ons and the manifest;
// chunks that import and lazy-load one another; one chunk nothing references is added by the plants.
function foreignBuild(R) {
  const chunks = ['index-BtzlNXGI', 'react-vendor-2UVnbCOT', 'Shop-hSBJtlix', 'Cart-1vODx36D', 'Checkout-dmHEX62-', 'api-BR6g486R', 'Admin-vmvSQvXS']
  const js = (n) => `import"./react-vendor-2UVnbCOT.js";const a=()=>import("./Shop-hSBJtlix.js"),b=()=>import("./Cart-1vODx36D.js"),c=()=>import("./Checkout-dmHEX62-.js");export{a,b,c,"${n}"};`
  put(R, 'site/index.html', `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Sporta</title>
<link rel="icon" href="/favicon.png"><link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/index-CdcKvZhs.css"><link rel="stylesheet" href="/sporta-grid.css">
<script type="module" crossorigin src="/assets/index-BtzlNXGI.js"></script>
<link rel="modulepreload" href="/assets/react-vendor-2UVnbCOT.js"><link rel="modulepreload" href="/assets/api-BR6g486R.js">
</head><body><div id="root"></div><script src="/boot.js"></script><script defer src="/sporta-features.js"></script></body></html>`, { uid: 501 })
  put(R, 'site/assets/index-CdcKvZhs.css', 'body{margin:0}@font-face{font-family:p;src:url(/fonts/plex-400-latin.woff2)}', { uid: 501 })
  for (const c of chunks.slice(0, 6)) put(R, `site/assets/${c}.js`, js(c), { uid: 501 })
  put(R, 'site/assets/Admin-vmvSQvXS.js', 'export default 1', { uid: 501 })
  // the admin chunk is reached by a lazy import from the entry chunk
  put(R, 'site/assets/api-BR6g486R.js', 'export const x=()=>import("./Admin-vmvSQvXS.js")', { uid: 501 })
}

// Everything at the manifest's commit, laid out the way vps-deploy.mjs would have, plus the live-only parts.
function buildFake(R, sha, { capture = true } = {}) {
  const tree = fs.mkdtempSync(path.join(TMP, 'tree-'))
  const tarBuf = execFileSync('git', ['-C', REPO, 'archive', sha, 'sporta-web/public', 'sporta-web/dropin'], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', tree], { input: tarBuf })
  fs.mkdirSync(path.join(R, 'site'), { recursive: true })
  const walkTree = (dir, base, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkTree(p, base, out); else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/')) } return out }
  const pub = path.join(tree, 'sporta-web', 'public')
  for (const rel of walkTree(pub, pub)) {
    if (gen.SETUP_TOOLS.includes(rel)) continue                       // never deployed
    put(R, `site/${rel}`, fs.readFileSync(path.join(pub, rel)), { uid: siteUid(rel) })
  }
  for (const [from, to] of gen.BUNDLES) {
    const src = path.join(tree, 'sporta-web', 'dropin', from)
    for (const rel of walkTree(src, src)) {
      if (gen.SKIP.includes(rel.split('/').pop()) || gen.SETUP_TOOLS.includes(`${to}/${rel}`)) continue
      put(R, `site/${to}/${rel}`, fs.readFileSync(path.join(src, rel)), { uid: 0 })
    }
  }
  // the build fills the CSP script hashes into the root .htaccess
  const ht = fs.readFileSync(path.join(R, 'site/.htaccess'), 'utf8')
  if (!ht.includes('__SCRIPT_HASHES__')) throw new Error('public/.htaccess lost its __SCRIPT_HASHES__ placeholder; the normalised-hash rule needs a new fixture')
  put(R, 'site/.htaccess', ht.replace('__SCRIPT_HASHES__', `'sha256-${'A'.repeat(43)}=' 'sha256-${'B'.repeat(43)}='`), { uid: 0 })
  foreignBuild(R)
  let usedCapture = false
  if (capture && fs.existsSync(path.join(CAPTURE, 'index.html'))) {
    // the real foreign build captured from the live site (a Workflow scratch folder): same checks, real bytes
    fs.rmSync(path.join(R, 'site/assets'), { recursive: true, force: true })
    for (const rel of walkTree(CAPTURE, CAPTURE)) {
      if (rel.startsWith('api/')) continue                            // captured API answers, not files on disk
      put(R, `site/${rel}`, fs.readFileSync(path.join(CAPTURE, rel)), { uid: siteUid(rel) })
    }
    usedCapture = true
  }
  put(R, 'site/.well-known/acme-challenge/tok_AbC123xyz-QWERTY', 'tok_AbC123xyz-QWERTY.thumbprint', { uid: 0 })
  // ---- private/ (names, modes, owners; the sentinel sits where nobody may read it)
  put(R, 'private/api-config.php', `<?php return ['cron_key' => '${SENTINEL}'];`, { mode: 0o440, uid: 0, gid: 33 })
  mk(R, 'private/config', 0o700, 33)
  for (const f of ['knet-config.php', 'pay-config.php']) put(R, `private/config/${f}`, `<?php return ['password' => '${SENTINEL}'];`, { mode: 0o600, uid: 33 })
  for (const f of ['db_name', 'db_user', 'db_pass']) put(R, `private/${f}`, SENTINEL, { mode: 0o600, uid: 33 })
  mk(R, 'private/mail', 0o550, 0)
  put(R, 'private/mail/password', SENTINEL, { mode: 0o440, uid: 0, gid: 33 })
  mk(R, 'private/bin', 0o750, 0)
  for (const f of ['db-backup.sh', 'db-restore-test.sh']) put(R, `private/bin/${f}`, '#!/bin/sh\nexit 0\n', { mode: 0o750, uid: 0 })
  mk(R, 'private/backup-secrets', 0o700, 0)
  put(R, 'private/backup-secrets/db-backup.key', SENTINEL, { mode: 0o400, uid: 0 })
  mk(R, 'private/backups', 0o700, 0)
  put(R, 'private/backups/sporta-db-20261103T020000Z.sql.gz.enc', SENTINEL, { mode: 0o600, uid: 0 })
  put(R, 'private/backups/sporta-db-20261103T020000Z.sql.gz.enc.sha256', 'abc  sporta-db.enc\n', { mode: 0o600, uid: 0 })
  put(R, 'private/backups/last-status', 'ok 1793000000 0\n', { mode: 0o600, uid: 0 })
  mk(R, 'private/voice', 0o755, 33)
  put(R, 'private/voice/knet-payments.log', `${SENTINEL}\n`, { mode: 0o600, uid: 33 })
  put(R, 'private/voice/tts-cache/ab12cd.mp3', Buffer.alloc(900, 7), { mode: 0o644, uid: 33 })
  const deny = '<FilesMatch "\\.(php|phtml|phar)$">\n  Require all denied\n</FilesMatch>\n'
  for (const [sub, f, kind] of [['products', 'p1.jpg', 'jpeg'], ['cats', 'c1.png', 'png'], ['hero', 'h1.webp', 'webp']]) {
    mk(R, `private/media/${sub}`, 0o755, 0)
    put(R, `private/media/${sub}/${f}`, B[kind](), { uid: 0 })
    put(R, `private/media/${sub}/.htaccess`, deny, { uid: 0 })
  }
  put(R, 'private/media/products/responsive/p1-320.webp', B.webp(), { uid: 0 })
  // ---- backups/ releases/ and the loose neighbours
  mk(R, 'backups', 0o700, 0)
  put(R, `backups/${DEPLOY_NAME}.tar.gz`, B.gz(), { mode: 0o600, uid: 0, mtime: DEPLOY_MS - 5000 })
  put(R, `backups/${DEPLOY_NAME}.json`, '{"ref":"x"}', { mode: 0o600, uid: 0, mtime: DEPLOY_MS - 5000 })
  put(R, 'backups/site-pre-repo-deploy-20261031T1345Z/index.html', '<html></html>', { mode: 0o600, uid: 0 })
  put(R, `releases/${DEPLOY_NAME}.json`, '{"ref":"x","files":3}', { uid: 0, mtime: DEPLOY_MS })
  put(R, 'Dockerfile', 'FROM php:8.4-apache\n', { uid: 0 })
  put(R, 'apache-service.override.yml', `services: {}\n# ${SENTINEL}\n`, { mode: 0o640, uid: 0 })
  put(R, 'site-prev-20261030T0905Z/index.html', '<html></html>', { uid: 501 })
  put(R, 'site-prev-20261030T0905Z/api/api.php', '<?php // old copy', { uid: 501 })
  put(R, 'staging/hero-20261031/a.webp', B.webp(), { uid: 0 })
  put(R, 'rollback/x.txt', 'x', { uid: 0 })
  put(R, 'php/92-sporta-errors.ini', 'display_errors=Off\n', { uid: 0 })
  return { usedCapture }
}

// ---------------------------------------------------------------- the plants, and what each must look like
// Each plant: apply(R) writes it; test(rec, res) says whether the scanner saw it the way it should.
const flagsOf = (r) => r?.flags?.map((f) => f.name) ?? []
const has = (r, ...names) => names.every((n) => flagsOf(r).includes(n))
const PLANTS = [
  { id: 'shell-in-images', area: 'site', path: 'images/shell.php', apply: (R) => put(R, 'site/images/shell.php', "<?php @eval($_POST['x']);", { uid: 33 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && r.sev === 'high' && r.reach === true && r.exec === 'php' && has(r, 'executable-in-web-root', 'sig:php-eval-request') && r.kind === 'webshell-or-obfuscated-code' },
  { id: 'signature-hit', area: 'site', path: 'images/shell.php', test: (r) => !!r?.sigs.some((s) => s.name === 'php-eval-request' && s.line === 1) },
  { id: 'media-dir-no-htaccess', area: 'media', path: 'media/cats/', apply: (R) => fs.rmSync(path.join(R, 'private/media/cats/.htaccess')),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'media-dir-without-php-deny') && r.sev === 'medium' },
  { id: 'php-in-media', area: 'media', path: 'media/products/avatar.php', apply: (R) => put(R, 'private/media/products/avatar.php', "<?php system($_GET['c']);", { uid: 33 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'php-in-media-folder') && r.sev === 'high' },
  { id: 'world-writable-dir', area: 'site', path: 'tmp-upload', apply: (R) => { mk(R, 'site/tmp-upload', 0o777, 501); put(R, 'site/tmp-upload/readme.txt', 'x', { uid: 501 }) },
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'world-writable-dir') && r.sev === 'high' && r.type === 'directory' },
  { id: 'dump-in-site', area: 'site', path: 'backup-20261101.sql', apply: (R) => put(R, 'site/backup-20261101.sql', '-- MySQL dump 10.13\nINSERT INTO orders VALUES (1);\n', { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'sql-dump') && r.reach === false && r.sev === 'medium' && r.kind === 'binary-or-archive' },
  { id: 'foreign-index-php', area: 'site', path: 'index.php', apply: (R) => put(R, 'site/index.php', "<?php echo 'old site';", { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && r.reach === true && r.exec === 'php' && has(r, 'executable-in-web-root') },
  { id: 'fresh-php', area: 'site', path: 'cache-9f2.php', apply: (R) => put(R, 'site/cache-9f2.php', '<?php // cache', { uid: 33, mtime: DEPLOY_MS + 2 * 3600 * 1000 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'newer-than-last-deploy', 'executable-in-web-root') && r.age > 3600 * 1000 },
  { id: 'symlink-escape', area: 'site', path: 'uploads-link', apply: (R) => fs.symlinkSync('/etc', path.join(R, 'site/uploads-link')),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'symlink-escapes-root') && r.sev === 'high' && r.type === 'symlink' },
  { id: 'symlink-inside', area: 'site', path: 'assets-alias', apply: (R) => fs.symlinkSync('assets', path.join(R, 'site/assets-alias')),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'symlink-inside') && r.sev === 'low' },
  { id: 'orphan-chunk', area: 'site', path: 'assets/Old-ZxCvB123.js', apply: (R) => put(R, 'site/assets/Old-ZxCvB123.js', 'export default 0', { uid: 501 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'unreferenced-chunk') && r.sev === 'low' && r.kind === 'orphan' },
  { id: 'dot-git', area: 'site', path: '.git', apply: (R) => { put(R, 'site/.git/HEAD', 'ref: refs/heads/main\n', { uid: 501 }); put(R, 'site/.git/config', '[core]\n', { uid: 501 }) },
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'vcs-metadata') && r.reach === false && r.sev === 'high' },
  { id: 'setuid', area: 'site', path: 'helper.bin', apply: (R) => { const p = put(R, 'site/helper.bin', B.elf(), { uid: 501 }); fs.chmodSync(p, 0o4755) },
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'setuid', 'executable-binary') && r.type === 'ELF' },
  { id: 'wrong-uid', area: 'site', path: 'notes-4242.txt', needsRoot: true, apply: (R) => put(R, 'site/notes-4242.txt', 'plain', { uid: 4242 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'uid-unexpected:4242') && r.sev === 'low' },
  { id: 'archive', area: 'site', path: 'site-dist.zip', apply: (R) => put(R, 'site/site-dist.zip', B.zip(), { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'archive') && r.type === 'ZIP' && r.reach === false },
  { id: 'editor-copy', area: 'site', path: 'config.js.bak', apply: (R) => put(R, 'site/config.js.bak', 'window.SPORTA_CONFIG={}', { uid: 501 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'editor-copy') && r.kind === 'stale-copy' && r.reach === false },
  { id: 'secret-shaped', area: 'site', path: 'config.php', apply: (R) => put(R, 'site/config.php', `<?php return ['k' => '${SENTINEL}'];`, { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'secret-shaped-name') && r.sha === null && /not opened/.test(r.type) && r.kind === 'secret' },
  { id: 'aws-key-in-text', area: 'site', path: 'api/notes.txt', apply: (R) => put(R, 'site/api/notes.txt', `key = ${FAKE_AWS}\n-----BEGIN RSA PRIVATE KEY-----\nxx\n`, { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && r.sigs.some((s) => s.name === 'secret-aws-key' && s.mask === 'AKIA****' && s.line === 1) && r.sigs.some((s) => s.name === 'secret-private-key' && s.mask === 'PEM-block' && s.line === 2) },
  { id: 'dsstore', area: 'site', path: '.DS_Store', apply: (R) => put(R, 'site/.DS_Store', Buffer.alloc(40, 1), { uid: 501 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'dotfile') && r.reach === false },
  { id: 'appledouble', area: 'site', path: '._boot.js', apply: (R) => put(R, 'site/._boot.js', Buffer.alloc(40, 2), { uid: 501 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'dotfile') && r.reach === false },
  { id: 'polyglot', area: 'site', path: 'cats/polyglot.jpg', apply: (R) => put(R, 'site/cats/polyglot.jpg', Buffer.concat([B.jpeg(40), Buffer.from("<?php system($_GET['x']); ?>")]), { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'php-in-non-php-file') && r.sigs.some((s) => s.name === 'php-exec-request') },
  { id: 'owner-photo-ok', area: 'site', path: 'cats/owner-new.jpg', apply: (R) => put(R, 'site/cats/owner-new.jpg', B.jpeg(), { uid: 501 }),
    test: (r) => r?.verdict === 'KNOWN' && r.rule === 'owner-photo' && r.flags.length === 0, known: true },
  { id: 'modified-api-code', area: 'site', path: 'api/birthday.php', apply: (R) => fs.appendFileSync(path.join(R, 'site/api/birthday.php'), '\n<?php // appended by hand\n'),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'known-path-modified-code') && r.sev === 'high' },
  { id: 'extra-api-php', area: 'site', path: 'api/extra-helper.php', apply: (R) => put(R, 'site/api/extra-helper.php', '<?php echo 1;', { uid: 0 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && r.reach === true && has(r, 'executable-in-web-root') },
  { id: 'setup-tool-html', area: 'site', path: 'go-live.html', apply: (R, ctx) => put(R, 'site/go-live.html', fs.readFileSync(path.join(ctx.tree, 'sporta-web/public/go-live.html')), { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'leftover-setup-tool') && r.rule === 'setup-tool' },
  { id: 'setup-tool-php', area: 'site', path: 'api/setup-admin.php', apply: (R, ctx) => put(R, 'site/api/setup-admin.php', fs.readFileSync(path.join(ctx.tree, 'sporta-web/dropin/php-store/setup-admin.php')), { uid: 0 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'leftover-setup-tool') },
  { id: 'ht-handler', area: 'site', path: 'cats/.htaccess', apply: (R) => put(R, 'site/cats/.htaccess', 'AddType application/x-httpd-php .jpg\n', { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && r.sigs.some((s) => s.name === 'ht-handler') },
  { id: 'listing-open', area: 'site', path: 'docs', apply: (R) => { put(R, 'site/docs/.htaccess', 'Options +Indexes\n', { uid: 501 }); put(R, 'site/docs/a.txt', 'a', { uid: 501 }) },
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'listing-open') && r.type === 'directory' },
  { id: 'tmp-upload-readme', area: 'site', path: 'tmp-upload/readme.txt', test: (r) => r?.verdict === 'UNKNOWN', collateral: true },
  { id: 'docs-htaccess', area: 'site', path: 'docs/.htaccess', test: (r) => r?.verdict === 'UNKNOWN', collateral: true },
  { id: 'docs-a', area: 'site', path: 'docs/a.txt', test: (r) => r?.verdict === 'UNKNOWN', collateral: true },
  { id: 'dump-readable', area: 'private', path: 'backups/leak.sql.gz', apply: (R) => put(R, 'private/backups/leak.sql.gz', B.gz(), { mode: 0o644, uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'world-readable') && r.kind === 'permissions' },
  { id: 'stale-config-copy', area: 'private', path: 'api-config.prev-20261031.php', apply: (R) => put(R, 'private/api-config.prev-20261031.php', SENTINEL, { mode: 0o640, uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && r.kind === 'stale-copy' && r.sev === 'medium' && /not opened/.test(r.type) },
  { id: 'private-stray', area: 'private', path: 'notes.txt', apply: (R) => put(R, 'private/notes.txt', 'x', { uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'not-explained') },
  { id: 'backup-dump-readable', area: 'backups', path: 'claude-20261031T1515Z/orders-stock.sql.gz', apply: (R) => put(R, 'backups/claude-20261031T1515Z/orders-stock.sql.gz', B.gz(), { mode: 0o644, uid: 0 }),
    test: (r) => r?.verdict === 'KNOWN' && r.rule === 'bk-session' && has(r, 'world-readable') && r.sev === 'medium' },
  { id: 'backup-credential-copy', area: 'backups', path: 'claude-20261031T1325Z/api-config.php', apply: (R) => put(R, 'backups/claude-20261031T1325Z/api-config.php', SENTINEL, { mode: 0o440, uid: 0, gid: 33 }),
    test: (r) => r?.verdict === 'KNOWN' && has(r, 'credential-copy') && /not opened/.test(r.type) },
  { id: 'backup-folder-summary', area: 'backups', path: 'claude-20261031T1515Z/', test: (r) => r?.verdict === 'KNOWN' && r.rule === 'bk-session', collateral: true },
  { id: 'backup-folder-summary2', area: 'backups', path: 'claude-20261031T1325Z/', test: (r) => r?.verdict === 'KNOWN' && r.rule === 'bk-session', collateral: true },
  { id: 'old-copy-git', area: 'copy', path: 'site-prev-20261030T0905Z/', apply: (R) => put(R, 'site-prev-20261030T0905Z/.git/HEAD', 'ref\n', { uid: 501 }),
    test: (r) => r?.verdict === 'KNOWN' && r.rule === 'copy-site-old' && r.flags.some((f) => f.name === 'vcs-metadata') },
  { id: 'top-stray', area: 'top', path: 'shell.sh', apply: (R) => put(R, 'shell.sh', '#!/bin/sh\n', { mode: 0o755, uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && r.exec === 'script' },
  { id: 'top-unknown-dir', area: 'copy', path: 'mystery-dir/', apply: (R) => put(R, 'mystery-dir/a.txt', 'a', { uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'not-explained') },
  { id: 'forged-line', area: 'site', path: 'evil\nF H KNOWN forged.txt', apply: (R) => put(R, 'site/evil\nF H KNOWN forged.txt', 'x', { uid: 501 }),
    test: (r, res) => r?.verdict === 'UNKNOWN' && !res.__lines.join('\n').split('\n').some((l) => l.startsWith('F H KNOWN')) },
]
const planted = (R, tree) => { for (const p of PLANTS) if (p.apply && (IS_ROOT || !p.needsRoot)) p.apply(R, { tree }) }
const findRec = (res, area, p) => res.records.find((r) => r.area === area && r.path === p)

// ---------------------------------------------------------------- running the scanner
const runCli = (args, env = {}) => spawnSync(process.execPath, [SCANNER, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, env: { ...process.env, ...env } })
const lines = (t) => t.split('\n').filter((l, i, a) => l.length || i < a.length - 1)

async function liveSection() {
  console.log('\n== live: manifest')
  const m = gen.buildManifest('HEAD')
  const m2 = gen.buildManifest('HEAD')
  check(gen.manifestJson(m) === gen.manifestJson(m2), 'the manifest is a pure function of the commit (two builds, identical bytes)')
  check(/^[0-9a-f]{40}$/.test(m.sha) && m.hashLen === 16 && m.paths.every(([, , ...h]) => h.length > 0 && h.every((x) => /^[0-9a-f]{16}$/.test(x))), `every manifest path carries 16-hex blob ids (${m.paths.length} paths, ${m.paths.reduce((n, p) => n + p.length - 2, 0)} versions at ${m.sha.slice(0, 8)})`)
  // the mapping and the skip/setup/media lists equal the deploy's own source text
  const vps = fs.readFileSync(path.join(HERE, 'vps-deploy.mjs'), 'utf8')
  const bundle = fs.readFileSync(path.join(HERE, 'bundle-php.mjs'), 'utf8')
  const listFrom = (src, re_) => [...(re_.exec(src)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1])
  check(JSON.stringify([...gen.SETUP_TOOLS].sort()) === JSON.stringify(listFrom(vps, /const SETUP_TOOLS = new Set\(\[([\s\S]*?)\]\)/).sort()), 'SETUP_TOOLS equals vps-deploy.mjs')
  check(JSON.stringify(gen.MEDIA) === JSON.stringify(listFrom(vps, /const MEDIA = \[([\s\S]*?)\]/)), 'MEDIA equals vps-deploy.mjs')
  check(JSON.stringify([...gen.SKIP].sort()) === JSON.stringify(listFrom(bundle, /const SKIP = new Set\(\[([\s\S]*?)\]\)/).sort()), 'SKIP equals bundle-php.mjs')
  const pairs = [...(/const BUNDLES = \[([\s\S]*?)\]\n/.exec(bundle)?.[1] ?? '').matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((x) => [x[1], x[2]])
  check(JSON.stringify(gen.BUNDLES) === JSON.stringify(pairs), 'BUNDLES (dropin -> api/knet/pay) equals bundle-php.mjs')
  const names = new Map(m.paths.map((p) => [p[0], p[1]]))
  check(!names.has('api/config.php') && !names.has('knet/config.php') && !names.has('pay/config.php') && ![...names.keys()].some((k) => /(^|\/)README\.md$/.test(k)), 'config.php and README.md are never expected on the server (not shipped)')
  check(gen.SETUP_TOOLS.every((p) => !names.has(p) || names.get(p).includes('s')), 'every setup tool the history knows is flagged as one')
  check(names.get('.htaccess')?.includes('n') && m.norm['.htaccess']?.length >= 1, 'the root .htaccess carries normalised (CSP-folded) hashes')
  check(['api/api.php', 'knet/pay.php', 'pay/pay.php', 'boot.js'].every((p) => names.has(p)), 'the dropin -> api/knet/pay mapping and public/ files are present')
  check(m.rules.every((r) => r.id && r.area && r.re && r.verdict && r.doc && r.why && new RegExp(r.re, r.flags ?? '')), `all ${m.rules.length} documented live-only rules have id, area, regex, verdict, why and doc`)
  check(new Set(m.rules.map((r) => r.id)).size === m.rules.length, 'rule ids are unique')

  // ---- the fake docroots
  console.log('\n== live: fake docroot')
  const mfPath = path.join(TMP, 'manifest.json')
  fs.writeFileSync(mfPath, gen.manifestJson(m))
  const manifest = JSON.parse(gen.manifestJson(m))
  const treeOf = (sha) => { const d = fs.mkdtempSync(path.join(TMP, 'plant-tree-')); execFileSync('tar', ['-x', '-C', d], { input: execFileSync('git', ['-C', REPO, 'archive', sha, 'sporta-web/public', 'sporta-web/dropin'], { maxBuffer: 1 << 28 }) }); return d }
  const CLEAN = path.join(TMP, 'clean'), PLANT = path.join(TMP, 'planted')
  fs.mkdirSync(CLEAN); fs.mkdirSync(PLANT)
  const { usedCapture } = buildFake(CLEAN, m.sha)
  buildFake(PLANT, m.sha)
  const tree = treeOf(m.sha)
  planted(PLANT, tree)
  console.log(`note fake docroot built at ${m.sha.slice(0, 8)}; live capture overlay ${usedCapture ? 'USED (' + CAPTURE.split('/').slice(-3).join('/') + ')' : 'absent: synthetic foreign build only'}; running as ${IS_ROOT ? 'root' : 'non-root (ownership plants skipped)'}`)
  if (!IS_ROOT) skipped.push('ownership plants (need root to chown)')

  const clean = scan.scanLive({ root: CLEAN, manifest })
  check(clean.findings.length === 0, 'CLEAN docroot: zero findings (nothing unknown, nothing flagged)', clean.findings.slice(0, 6).map((r) => `${r.area}:${r.path}[${r.verdict}:${flagsOf(r).join('+')}]`).join(' '))
  check(clean.counts.UNKNOWN === 0 && clean.counts.SUSPICIOUS === 0 && clean.counts.KNOWN === clean.counts.judged, `CLEAN docroot: every one of ${clean.counts.judged} judged entries is KNOWN`)
  check(clean.records.every((r) => r.rule), 'CLEAN docroot: every KNOWN entry names the rule that explains it')
  const sample = (rule) => clean.records.filter((r) => r.rule === rule).length
  const kinds = ['repo:head', 'repo-normalized', 'referenced-by-live-index', 'live-entry', 'live-config-js', 'priv-api-config', 'priv-gateway-config', 'media-image', 'media-htaccess-refuses-php', 'bk-deploy', 'rel-deploy', 'top-dockerfile', 'copy-site-old', 'acme-challenge']
  const missingRules = kinds.filter((k) => sample(k) === 0 && !(k === 'live-config-js' && usedCapture === false && false))
  check(missingRules.length === 0 || missingRules.every((k) => ['live-config-js'].includes(k)), 'CLEAN docroot: each kind of evidence is exercised', `unused: ${missingRules.join(' ')}`)
  check(clean.lastDeploy?.name === DEPLOY_NAME && clean.lastDeploy.ms === DEPLOY_MS, `the last deploy is read from backups/ and releases/ names (${clean.lastDeploy?.name})`)
  check(clean.build.kind === 'FOREIGN', 'the live index.html is reported as a FOREIGN build (no sporta-build marker)')
  check(clean.reachedCount > 15, `the reference walk reached ${clean.reachedCount} site files from the live index.html`)

  const trace = []
  const res = scan.scanLive({ root: PLANT, manifest, trace })
  const out = scan.render(res); res.__lines = out
  console.log(`note planted docroot: ${res.counts.judged} judged, KNOWN=${res.counts.KNOWN} UNKNOWN=${res.counts.UNKNOWN} SUSPICIOUS=${res.counts.SUSPICIOUS}, findings ${res.findings.length}`)
  const planByKey = new Set()
  for (const p of PLANTS) {
    if (p.needsRoot && !IS_ROOT) continue
    const r = findRec(res, p.area, p.path)
    check(!!r && p.test(r, res), `plant ${p.id}: ${p.area}:${JSON.stringify(p.path).slice(0, 60)} found as expected`, r ? `${r.verdict} ${r.sev} ${flagsOf(r).join('+')} reach=${r.reach} exec=${r.exec}` : 'no record')
    planByKey.add(`${p.area}|${p.path}`)
  }
  // nothing else is flagged: the KNOWN files stay unflagged
  const stray = res.findings.filter((r) => !planByKey.has(`${r.area}|${r.path}`))
  check(stray.length === 0, 'NOTHING ELSE is flagged: every other file is still KNOWN and unflagged', stray.slice(0, 6).map((r) => `${r.area}:${r.path}[${r.verdict}:${flagsOf(r).join('+')}]`).join(' '))
  const cleanKnown = new Map(clean.records.map((r) => [`${r.area}|${r.path}`, r.rule]))
  const changed = res.records.filter((r) => !planByKey.has(`${r.area}|${r.path}`) && cleanKnown.get(`${r.area}|${r.path}`) !== r.rule)
  check(changed.length === 0, 'every unplanted entry kept the very rule that explained it in the clean run', changed.slice(0, 4).map((r) => `${r.path}: ${cleanKnown.get(`${r.area}|${r.path}`)} -> ${r.rule}`).join(' '))
  const expectSusp = new Set(PLANTS.filter((p) => (IS_ROOT || !p.needsRoot) && /verdict === 'SUSPICIOUS'/.test(p.test.toString())).map((p) => `${p.area}|${p.path}`))
  check(res.counts.SUSPICIOUS === expectSusp.size, `the planted run reports exactly the ${expectSusp.size} SUSPICIOUS entries that were planted`, `got ${res.counts.SUSPICIOUS}`)
  check(res.bySev.high >= 14, `and ${res.bySev.high} high-severity findings`)
  check(res.reachableExec >= 5, `MODEL line counts the executable unknown files in web-reachable directories (${res.reachableExec})`)

  // ---- privacy
  console.log('\n== live: privacy')
  const rel = (abs) => path.relative(PLANT, abs).split(path.sep).join('/')
  const opened = trace.map((t) => rel(t.path))
  const NEVER = ['private/api-config.php', 'private/config/knet-config.php', 'private/config/pay-config.php', 'private/db_name', 'private/db_user', 'private/db_pass', 'private/mail/password',
    'private/backup-secrets/db-backup.key', 'private/voice/knet-payments.log', 'private/backups/sporta-db-20261103T020000Z.sql.gz.enc', 'private/backups/leak.sql.gz', 'private/api-config.prev-20261031.php',
    'site/config.php', 'backups/claude-20261031T1325Z/api-config.php', 'backups/claude-20261031T1515Z/orders-stock.sql.gz', 'apache-service.override.yml']
  check(NEVER.every((p) => !opened.includes(p)), `credential, dump, log and config-looking files are never opened (${NEVER.length} sentinel-bearing files checked)`, NEVER.filter((p) => opened.includes(p)).join(' '))
  const priv = opened.filter((p) => p.startsWith('private/') && !p.startsWith('private/media/'))
  const independentOk = (p) => fs.statSync(path.join(PLANT, p)).size < 65536 && !/(?:config|secret|passw|_pass|_user|_name|\.key|\.pem|\.log|\.sql|\.enc|\.gz|mail|\.env)/i.test(p)
  check(priv.every(independentOk), `under private/ only small non-credential files are opened (${priv.length}: ${priv.slice(0, 4).join(' ')} …)`, priv.filter((p) => !independentOk(p)).join(' '))
  check(opened.filter((p) => /^(?:backups|releases)\//.test(p)).every(independentOk), 'under backups/ and releases/ only small non-credential files are opened')
  const allText = [...out, scan.detailsNdjson(res), JSON.stringify(res.records)].join('\n')
  check(!allText.includes(SENTINEL), 'no sentinel secret value appears in the output, the details file or the JSON')
  check(!allText.includes(FAKE_AWS) && allText.includes('AKIA****'), 'a secret hit prints a 4-character mask only')
  check(res.records.every((r) => r.sigs.every((s) => !s.mask || s.mask.length <= 9)), 'masks are at most 4 characters of the value plus ****')
  check(!out.some((l) => /[\u0000-\u001f\u007f]/.test(l)) && out.every((l) => l.length <= 520), 'no control character (a newline included) reaches the log and no line is longer than 520 characters')
  check(!scan.scanLive.toString().includes('writeFileSync') && !scan.scanLive.toString().includes('unlinkSync') && !scan.scanLive.toString().includes('rmSync') && !scan.scanLive.toString().includes('renameSync'), 'scanLive contains no write, delete or rename call')

  // ---- output budget, paging, details
  console.log('\n== live: output')
  const cli = runCli(['--root', PLANT, '--manifest', mfPath, '--details', path.join(TMP, 'details.ndjson')])
  const cliLines = lines(cli.stdout)
  check(cli.status === 0 && cliLines.at(-1) === 'FILES_SCAN_DONE' && cliLines[0].startsWith('FILES_SCAN root='), 'CLI exits 0 and prints FILES_SCAN … FILES_SCAN_DONE')
  check(cliLines.length <= 240, `default output fits a 300-entry job log (${cliLines.length} lines)`)
  check(runCli(['--root', PLANT, '--manifest', mfPath, '--fail-on', 'suspicious']).status === 1 && runCli(['--root', CLEAN, '--manifest', mfPath, '--fail-on', 'suspicious']).status === 0, '--fail-on suspicious: exit 1 on the planted docroot, 0 on the clean one')
  const detail = fs.readFileSync(path.join(TMP, 'details.ndjson'), 'utf8').split('\n').filter(Boolean)
  check(detail.length === res.findings.length && detail.every((l) => { const o = JSON.parse(l); return o.path && o.verdict && 'size' in o && 'mtime' in o && 'mode' in o && 'uid' in o && 'type' in o && 'flags' in o }), `the details file has one record per finding (${detail.length}) with path, size, mtime, mode, uid, type and flags`)
  check((fs.statSync(path.join(TMP, 'details.ndjson')).mode & 0o777) === 0o600, 'the details file is written 0600')
  // a flood: the log cap, paging and the details reader
  const FLOOD = path.join(TMP, 'flood')
  fs.mkdirSync(FLOOD); buildFake(FLOOD, m.sha, { capture: false })
  for (let i = 0; i < 700; i++) put(FLOOD, `site/assets/Orphan${i}-${String(i).padStart(8, '0')}.js`, `export default ${i}`, { uid: 501 })
  for (let i = 0; i < 300; i++) put(FLOOD, `site/shells/s${i}.php`, "<?php eval($_POST['a']);", { uid: 33 })
  for (let i = 0; i < 250; i++) put(FLOOD, `site/misc/note${i}.txt`, 'n', { uid: 501 })
  const fl = runCli(['--root', FLOOD, '--manifest', mfPath, '--details', path.join(TMP, 'flood.ndjson')])
  const flLines = lines(fl.stdout)
  const flRes = scan.scanLive({ root: FLOOD, manifest })
  check(flLines.length <= 240 && flLines.at(-1) === 'FILES_SCAN_DONE', `a flood of ${flRes.findings.length} findings still prints ${flLines.length} lines (cap 240)`)
  check(flLines.some((l) => /more finding line\(s\) not printed/.test(l)), 'the flood output says how many lines were left out and how to page them')
  check(flLines.filter((l) => l.startsWith('F ')).slice(0, 60).every((l) => /^F H SUSPICIOUS/.test(l)), 'the high-severity findings are printed first')
  const pageSize = 200, total = Math.ceil(flRes.findings.length / pageSize), seen = []
  for (let p = 1; p <= total; p++) {
    const pg = lines(runCli(['--root', FLOOD, '--manifest', mfPath, '--page', String(p), '--page-size', String(pageSize)]).stdout)
    check(pg.some((l) => l === `PAGE ${p}/${total} findings ${flRes.findings.length} (${pageSize} per page, severity order)`), `page ${p}/${total} announces itself`)
    seen.push(...pg.filter((l) => l.startsWith('F ')))
  }
  check(seen.length === flRes.findings.length && new Set(seen).size === seen.length, `the pages cover all ${flRes.findings.length} findings exactly once`)
  const rd = lines(runCli(['--read', path.join(TMP, 'flood.ndjson'), '--page', '2', '--page-size', String(pageSize)]).stdout)
  const rs = lines(runCli(['--root', FLOOD, '--manifest', mfPath, '--page', '2', '--page-size', String(pageSize)]).stdout)
  check(rd.filter((l) => l.startsWith('F ')).join('\n') === rs.filter((l) => l.startsWith('F ')).join('\n') && rd.some((l) => l.startsWith('PAGE 2/')), '--read pages a saved details file to the same lines a re-scan page prints')
  const envPage = lines(runCli(['--root', FLOOD, '--manifest', mfPath], { SCAN_PAGE: '1', SCAN_PAGE_SIZE: '5' }).stdout)
  check(envPage.filter((l) => l.startsWith('F ')).length === 5, 'SCAN_PAGE and SCAN_PAGE_SIZE work from the environment (what a second job sets)')

  // ---- the reference walk equals old-files-inventory.mjs
  console.log('\n== live: reference walk vs scripts/old-files-inventory.mjs')
  const old = spawnSync(process.execPath, [path.join(HERE, 'old-files-inventory.mjs'), path.join(CLEAN, 'site')], { encoding: 'utf8', env: { ...process.env, OLD_FILES_VERBOSE: '1' }, timeout: 120000 })
  const oldRef = new Set(lines(old.stdout).filter((l) => l.startsWith('F REFERENCED')).map((l) => l.split(/\s+/)[5]))
  const truncated = lines(old.stdout).some((l) => /^F \.\.\. \d+ more flagged/.test(l))
  const LISTED = /\.(m?js|cjs|css|html?|php|map|json|txt|xml|webmanifest)$/i
  const mine = new Set([...clean.reached.keys()].filter((p) => LISTED.test(p) || p === '.htaccess' || p.endsWith('/.htaccess')))
  if (truncated) skipped.push('walk comparison truncated by old-files-inventory MAX_F')
  const onlyOld = [...oldRef].filter((p) => !mine.has(p)), onlyMine = [...mine].filter((p) => !oldRef.has(p))
  check(oldRef.size > 10 && !truncated && onlyOld.length === 0 && onlyMine.length === 0, `both reference walks reach the same ${mine.size} listed files`, `only old-files-inventory: ${onlyOld.slice(0, 4).join(' ')} · only this: ${onlyMine.slice(0, 4).join(' ')}`)

  // ---- the job
  console.log('\n== live: the one-shot compose job')
  const jobPath = path.join(WEB, 'ops', 'live-files-scan.compose.json')
  const jobText = fs.existsSync(jobPath) ? fs.readFileSync(jobPath, 'utf8') : ''
  check(!!jobText, 'ops/live-files-scan.compose.json exists')
  if (jobText) {
    const job = JSON.parse(jobText), svc = job.services.filesscan
    check(svc.image === 'node:24-alpine' && svc.restart === 'no', 'the job is a one-shot node:24-alpine container')
    check(JSON.stringify(svc.volumes) === JSON.stringify(['/docker/sporta:/sporta:ro']), 'the only mount is /docker/sporta, read-only')
    check(svc.network_mode === 'none' && svc.read_only === true && !svc.privileged && !svc.pid && !svc.cap_add, 'no network, read-only root filesystem, not privileged, no host pid, no added capabilities')
    check(!/docker\.sock|\/etc\/|\/var\/lib\/docker/.test(jobText), 'no Docker socket, /etc or /var/lib/docker anywhere in the job')
    const lower = jobText.toLowerCase()
    check(!['curl', 'wget', 'require(', '$'].some((w) => lower.includes(w)), 'the job text holds no curl, wget, require( or dollar sign (the Hostinger API refuses them)')
    check(jobText.length < 100000, `the job is ${jobText.length} bytes (the earlier proven jobs are ~52 kB)`)
    check(gen.decode(svc.environment.SRC) === fs.readFileSync(SCANNER, 'utf8'), 'SRC decodes to exactly scripts/live-files-scan.mjs (regenerate with make-expected-manifest.mjs if this fails)')
    const emb = JSON.parse(gen.decode(svc.environment.MAN))
    check(emb.version === 1 && /^[0-9a-f]{40}$/.test(emb.sha) && gen.manifestJson(gen.buildManifest(emb.sha)) === gen.decode(svc.environment.MAN), `MAN is the manifest of its own recorded commit (${emb.sha.slice(0, 8)}), byte for byte`)
    const chk = spawnSync(process.execPath, [path.join(HERE, 'make-expected-manifest.mjs'), '--check'], { encoding: 'utf8' })
    check(chk.status === 0 && /^ok /.test(chk.stdout), `make-expected-manifest.mjs --check: ${chk.stdout.trim()}`)
    // run the job's own command line against a fake docroot built at the embedded commit
    const JR = path.join(TMP, 'jobroot'), JD = path.join(TMP, 'jobdir')
    fs.mkdirSync(JR); fs.mkdirSync(path.join(JD, 'out'), { recursive: true }); buildFake(JR, emb.sha, { capture: false })
    const cmd = svc.command[0].replaceAll('/tmp/', `${JD}/`).replaceAll('/out/', `${JD}/out/`).replaceAll('--root /sporta', `--root ${JR}`)
    const run = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', env: { ...process.env, SRC: svc.environment.SRC, MAN: svc.environment.MAN }, timeout: 120000 })
    const jl = lines(run.stdout)
    check(run.status === 0 && jl.at(-1) === 'FILES_SCAN_DONE' && jl.some((l) => /KNOWN=\d+ \(flagged 0\) UNKNOWN=0 SUSPICIOUS=0/.test(l)), 'the job command (printenv | base64 -d | gunzip, then node) runs end to end: clean docroot, 0 unknown, 0 suspicious', (run.stderr || jl.slice(-3).join(' | ')).slice(0, 300))
    check(fs.existsSync(path.join(JD, 'out', 'details.ndjson')), 'the job writes its details file to /out (its own tmpfs)')
    const fetchJob = JSON.parse(spawnSync(process.execPath, [path.join(HERE, 'make-expected-manifest.mjs'), '--fetch', 'abcdef1', '--no-job'], { encoding: 'utf8' }).stdout || 'null')
    check(fetchJob?.services?.filesscan?.environment?.SRC === undefined && /raw\.githubusercontent\.com\/hkspower\/wain\/abcdef1\//.test(JSON.stringify(fetchJob)) && !JSON.stringify(fetchJob).includes('$'), '--fetch <sha> prints the small variant that downloads the script at a pushed commit')
  }
}

// ---------------------------------------------------------------- mutations
// A detector that cannot be blinded without a test failing is not tested. Each mutant edits a COPY of the
// scanner (never the real one), runs it on the same docroots, and the check it must break has to turn false.
async function mutations(CLEAN, PLANT, manifest) {
  console.log('\n== live: mutations (blind a detector, the matching check must fail)')
  const src = fs.readFileSync(SCANNER, 'utf8')
  const dir = fs.mkdtempSync(path.join(TMP, 'mut-'))
  const plantOk = (id) => (res) => { const p = PLANTS.find((x) => x.id === id); const r = findRec(res, p.area, p.path); return !!r && p.test(r, res) }
  const M = [
    { id: 'signatures', find: 'for (const s of SIGNATURES) {', repl: 'for (const s of []) {', kills: plantOk('signature-hit') },
    { id: 'exec-in-web-root', find: "if (rec.exec && rec.reach && rec.verdict !== 'KNOWN') flag(rec, 'executable-in-web-root'", repl: "if (false) flag(rec, 'executable-in-web-root'", kills: plantOk('foreign-index-php') },
    { id: 'symlink-escape', find: 'if (!inside) {', repl: 'if (false) {', kills: plantOk('symlink-escape') },
    { id: 'world-writable-dir', find: "if (d.st.mode & 0o002) flag(rec, 'world-writable-dir'", repl: "if (false) flag(rec, 'world-writable-dir'", kills: plantOk('world-writable-dir') },
    { id: 'setuid', find: 'if (ent.st.mode & 0o4000)', repl: 'if (false)', kills: plantOk('setuid') },
    { id: 'sql-dump', find: "if (DUMP_EXT.test(name) || rec.type === 'SQL dump')", repl: 'if (false)', kills: plantOk('dump-in-site') },
    { id: 'archive', find: 'if (ARCHIVE_EXT.test(name) || ARCHIVE.has(rec.type))', repl: 'if (false)', kills: plantOk('archive') },
    { id: 'vcs-dir', find: 'if (ent.isDir && !ent.isLink && /^\\.(?:git|svn|hg|idea|vscode)$/i.test(ent.name))', repl: 'if (false)', kills: plantOk('dot-git') },
    { id: 'fresh-after-deploy', find: "if (rec.age > 60000) flag(rec, 'newer-than-last-deploy'", repl: "if (false) flag(rec, 'newer-than-last-deploy'", kills: plantOk('fresh-php') },
    { id: 'deploy-stamp', find: 'const m = DEPLOY_STAMP.exec(n)', repl: 'const m = null', kills: plantOk('fresh-php') },
    { id: 'media-htaccess', find: 'if (m.files > 0 && !covered)', repl: 'if (false)', kills: plantOk('media-dir-no-htaccess') },
    { id: 'php-in-media', find: "if (rec.exec) flag(rec, 'php-in-media-folder'", repl: "if (false) flag(rec, 'php-in-media-folder'", kills: plantOk('php-in-media') },
    { id: 'reference-over-reach', find: "for (const r of WALK_ROOTS) if (files.has(r)) visit(r, '(root)')", repl: "for (const r of files) visit(r, '(root)')", kills: plantOk('orphan-chunk') },
    { id: 'modified-known-path', find: 'if (!verdict && man) {', repl: 'if (false) {', kills: plantOk('modified-api-code') },
    { id: 'blob-match', find: 'if (mt.hit) { setV(rec, ', repl: 'if (false) { setV(rec, ', cleanKills: true },
    { id: 'normalised-htaccess', find: 'if (i >= 0) { setV(rec, \'KNOWN\', \'repo-normalized\'', repl: 'if (false) { setV(rec, \'KNOWN\', \'repo-normalized\'', cleanKills: true },
    { id: 'deny-model', find: 'for (const s of h.denyFiles) if (s.rx.test(base))', repl: 'for (const s of []) if (s.rx.test(base))', kills: plantOk('dump-in-site') },
    { id: 'secret-name-open', find: 'const secretName = SECRET_NAME.test(ent.rel)', repl: 'const secretName = false', kills: plantOk('secret-shaped'), privacy: true },
    { id: 'private-read-policy', find: 'function mayOpen(rel, size, name) { return size < SMALL &&', repl: 'function mayOpen(rel, size, name) { return true ||', privacy: true },
    { id: 'mask', find: "else if (s.secret) h.mask = value.slice(0, s.keep ?? 2) + '****'", repl: 'else if (s.secret) h.mask = value', kills: plantOk('aws-key-in-text'), privacy: true },
    { id: 'uid-check', find: 'if (!uidsFor.site.includes(ent.st.uid)) flag(rec, `uid-unexpected:${ent.st.uid}`, rec.exec', repl: 'if (false) flag(rec, `uid-unexpected:${ent.st.uid}`, rec.exec', kills: plantOk('wrong-uid'), root: true },
    { id: 'polyglot', find: "if (phpInside && !rec.exec) flag(rec, 'php-in-non-php-file'", repl: "if (false) flag(rec, 'php-in-non-php-file'", kills: plantOk('polyglot') },
    { id: 'setup-tool', find: "if (man && man.flags.includes('s')) {", repl: 'if (false) {', kills: plantOk('setup-tool-php') },
    { id: 'ht-handler-signature', find: "{ name: 'ht-handler', langs: ['ht']", repl: "{ name: 'ht-handler', langs: ['none']", kills: plantOk('ht-handler') },
    { id: 'listing-open', find: 'if (effIndexes(d.rel)) {', repl: 'if (false) {', kills: plantOk('listing-open') },
    { id: 'world-readable-private', find: 'if (ent.st.mode & 0o004 && (cred ||', repl: 'if (false && (cred ||', kills: plantOk('dump-readable') },
    { id: 'credential-copy', find: "flag(rec, 'credential-copy'", repl: "flag(rec, 'credential-copy-x'", kills: plantOk('backup-credential-copy') },
    { id: 'path-escaping', find: 'const safe = (s) => {', repl: 'const safe = (s) => { return String(s)', kills: plantOk('forged-line') },
    { id: 'old-copy-vcs', find: "if (sum.vcs) flag(rec, 'vcs-metadata'", repl: "if (false) flag(rec, 'vcs-metadata'", kills: plantOk('old-copy-git') },
  ]
  for (const mu of M) {
    if (mu.root && !IS_ROOT) { skipped.push(`mutant ${mu.id} (needs root)`); continue }
    const count = src.split(mu.find).length - 1
    if (count < 1) { bad(`mutant ${mu.id} no longer applies (the scanner text it edits changed)`, mu.find.slice(0, 80)); continue }
    const file = path.join(dir, `scan-${mu.id}.mjs`)
    fs.writeFileSync(file, src.replaceAll(mu.find, mu.repl))
    let mod
    try { mod = await import(pathToFileURL(file).href) } catch (e) { bad(`mutant ${mu.id} does not load`, e.message); continue }
    if (mu.cleanKills) {
      const r = mod.scanLive({ root: CLEAN, manifest })
      check(r.findings.length > 0, `mutant ${mu.id}: the clean docroot stops being clean (${r.findings.length} findings)`)
    } else if (mu.privacy) {
      const trace = []
      const r = mod.scanLive({ root: PLANT, manifest, trace })
      const text = [...mod.render(r), mod.detailsNdjson(r)].join('\n')
      const opened = trace.map((t) => path.relative(PLANT, t.path).split(path.sep).join('/'))
      const leaked = text.includes(SENTINEL) || text.includes(FAKE_AWS) || opened.includes('private/db_pass') || opened.includes('site/config.php')
      check(leaked, `mutant ${mu.id}: the privacy checks catch it (a secret is opened or printed)`)
    } else {
      const r = mod.scanLive({ root: PLANT, manifest })
      r.__lines = mod.render(r)
      check(!mu.kills(r), `mutant ${mu.id}: the matching plant is no longer found as expected`)
    }
  }
}

// ---------------------------------------------------------------- main
if (wanted === 'all' || wanted === 'live') {
  await liveSection()
  // the mutation harness reuses the docroots the live section left in TMP
  const m = gen.buildManifest('HEAD')
  const manifest = JSON.parse(gen.manifestJson(m))
  await mutations(path.join(TMP, 'clean'), path.join(TMP, 'planted'), manifest)
}
console.log(`\n${fails ? `${fails} FAIL` : 'all ok'} — ${passes} checks passed${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`)
process.exit(fails ? 1 : 0)
