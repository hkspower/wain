#!/usr/bin/env node
// UNKNOWN FILES SCAN — which files does nothing in this project explain?
//
// A CHECK, never a clean-up. READ-ONLY: it deletes nothing, moves nothing,
// rewrites no history and writes only the report files it is told to (--json,
// --md) and, for --package-build, a scratch stage directory it is given.
//
// A file is UNKNOWN when nothing explains it: no rule in ops/known-files.json
// (a glob -> purpose -> owner -> expected? -> ships-to-web? table), and no
// build/test/deploy/doc reference from another file. It is SUSPICIOUS when its
// bytes or its name look like something an attacker or a past session left
// behind: web-shell and obfuscation shapes, executable bits, PHP where PHP does
// not belong, keys, dumps, archives, case collisions. A file can be KNOWN and
// still carry a finding (a stale copy, a tracked build output, an orphan
// script): "known" means someone owns the explanation, not that it is right.
//
// MODES (they combine, except --live):
//   (default)                the working tree: git ls-files, untracked, ignored
//   --history                the whole git history: secrets, name sweep, bloat
//   --package <stageDir>     classify and audit an already staged package tree
//   --package-build <dir>    stage the web package in <dir> the way
//                            make-package.mjs does (vite build into the scratch
//                            dir, never the repo's dist/), then --package it
//   --live <root>            the live server: walk <root>/site and neighbours
//                            (for the one-shot VPS job; no git, no network)
//   --make-job [file]        write ops/live-files-scan.compose.json
//   --check-job [file]       exit 1 if that file no longer matches this script
//
// OPTIONS
//   --root <dir>      repository root (default: the checkout this file is in)
//   --manifest <f>    rules file (default: sporta-web/ops/known-files.json)
//   --json <f>        write the result as JSON      --md <f>  as Markdown
//   --quiet           no console report             --list    print every file
//
// EXIT CODE  1 when there is an UNKNOWN file, a SUSPICIOUS file, or a HIGH
// finding that the manifest has not acknowledged; 0 otherwise; 2 on a usage or
// environment error. Acknowledged findings are still printed and counted, never
// hidden: the manifest's "acknowledged" list is where an owner decision lives.
//
// SECRETS are never printed. A hit shows file, line, type and at most the first
// four characters of the value plus its length; a private-key block shows
// nothing but that one exists.
//
// TEST HOOK  UFS_BLIND=D-PHP-EVAL,S-NAMED  turns those detectors off. Only
// unknown-files-test.mjs sets it: it is how the suite proves each detector is
// load-bearing (blind it, watch the planted finding stop being reported, watch
// the test's assertion fail).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { gzipSync, gunzipSync, inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const VERSION = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const BLIND = new Set((process.env.UFS_BLIND || '').split(',').map((s) => s.trim()).filter(Boolean))
const on = (id) => !BLIND.has(id)
const err = (s) => process.stderr.write(s + '\n')

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 52).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

// ------------------------------------------------------------------ helpers
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
function globRe(g) {
  let s = '', i = 0
  while (i < g.length) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { s += '(?:.*/)?'; i += 3; continue }
        s += '.*'; i += 2; continue
      }
      s += '[^/]*'; i++; continue
    }
    if (c === '?') { s += '[^/]'; i++; continue }
    if (c === '{') {
      const j = g.indexOf('}', i)
      if (j > i) { s += '(?:' + g.slice(i + 1, j).split(',').map(esc).join('|') + ')'; i = j + 1; continue }
    }
    s += esc(c); i++
  }
  return new RegExp('^' + s + '$')
}
const globsRe = (g) => { const list = (Array.isArray(g) ? g : [g]).map(globRe); return (p) => list.some((r) => r.test(p)) }
function entropy(s) {
  if (!s) return 0
  const f = new Map()
  for (const ch of s) f.set(ch, (f.get(ch) || 0) + 1)
  let h = 0
  for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p) }
  return h
}
// A masked value: at most four leading characters, never for short secrets.
const mask = (v) => `${v.slice(0, Math.min(4, Math.floor(v.length / 4)))}…(${v.length})`
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MiB' : n >= 1024 ? (n / 1024).toFixed(0) + ' kB' : n + ' B')
const SEV = { high: 0, medium: 1, low: 2 }
const lineOf = (text, idx) => { let n = 1; for (let i = text.indexOf('\n'); i >= 0 && i < idx; i = text.indexOf('\n', i + 1)) n++; return n }

// File families. PHP is judged by name AND by content: a webshell is named
// logo.png.
const PHP_EXT = /\.(php[0-9]?|phtml|phar|pht|inc)$/i
const JS_EXT = /\.(m?js|cjs|jsx|ts|tsx)$/i
const MARKUP_EXT = /\.(html?|svg|xml)$/i
const SH_EXT = /\.(sh|bash)$/i
const PY_EXT = /\.py$/i
const DOC_EXT = /\.(md|txt|json|sql|patch|csv|lock|cnf|ini|ya?ml|toml|webmanifest|awk|glsl|dart|example|css|gitignore|cjs\.map|map)$/i
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i
const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i
const ARCHIVE_EXT = /\.(zip|tar|tgz|gz|bz2|xz|7z|rar|jar|war|apk|ipa|phar|zst)$/i
const MEDIA_DIR = /(^|\/)(images?|img|uploads?|media|cats|hero|fonts|assets|brand|photos?|products|thumbs?)\//i

// ----------------------------------------------------------------- manifest
const MANIFEST_PATH = path.resolve(opt('--manifest', path.join(WEB, 'ops', 'known-files.json')))
let MAN
try { MAN = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) } catch (e) {
  if (!has('--make-job') && !has('--check-job') && !opt('--live')) { err(`cannot read the manifest ${MANIFEST_PATH}: ${e.message}`); process.exit(2) }
  MAN = { rules: [] }
}
const RULES = (MAN.rules || []).map((r) => ({ ...r, test: globsRe(r.glob) }))
const ZONES = (MAN.zones || []).map((z) => ({ zone: z.zone, test: globsRe(z.glob) }))
const zoneOf = (p) => (ZONES.find((z) => z.test(p)) || { zone: 'other' }).zone
const ALLOW = (MAN.content_allow || []).map((a) => ({ ...a, test: globsRe(a.path) }))
const ACK = (MAN.acknowledged || []).map((a) => ({ ...a, test: globsRe(a.path) }))
const PLACEHOLDERS = new Set((MAN.secret_placeholders || []).map((s) => String(s)))
const EXEC_OK = (MAN.executables || []).map(globRe)
const TEST_ZONE = (MAN.test_credential_globs || []).map(globRe)

// ------------------------------------------------------------------ findings
const findings = []
const allowedHits = []
const DET = {}
function det(id, severity, kind, title, extra = {}) { DET[id] = { id, severity, kind, title, ...extra }; return id }

// path / name detectors
det('D-PHP-IN-MEDIA', 'high', 'webshell-or-obfuscated-code', 'PHP file in a static / media / upload directory', { suspicious: true })
det('D-PHP-IN-STATIC', 'high', 'wrong-place', 'PHP file inside a folder that is copied to the web root as static files', { suspicious: true })
det('D-DOUBLE-EXT', 'high', 'webshell-or-obfuscated-code', 'executable extension combined with a decoy extension', { suspicious: true })
det('D-KEYFILE', 'high', 'secret', 'key or credential file by name', { suspicious: true })
det('D-ENVFILE', 'high', 'secret', 'environment / credential file by name', { suspicious: true })
det('D-EXEC-BIT', 'medium', 'permissions', 'executable bit on a file that is not a script', { suspicious: true })
det('D-SYMLINK', 'medium', 'permissions', 'symbolic link', { suspicious: true })
det('D-PERM-WORLD', 'medium', 'permissions', 'world-writable or setuid/setgid file on disk', { suspicious: true })
det('D-CASE-COLLIDE', 'high', 'other', 'two paths differ only by case or Unicode normalisation', { suspicious: true })
det('D-NAME-ODD', 'medium', 'other', 'file name is not valid UTF-8, has control characters, a leading dash or trailing space', { suspicious: true })
det('D-BACKUP-NAME', 'low', 'generated-or-scratch', 'file name looks like a backup, copy or scratch file')
det('D-HIDDEN', 'medium', 'other', 'hidden file or folder that is not on the allow-list', { suspicious: true })
det('D-TRACKED-IGNORED', 'medium', 'stale-copy', 'tracked file that .gitignore says must not be tracked')
det('D-GENERATED', 'low', 'generated-or-scratch', 'build / editor / cache output')
det('D-ARCHIVE', 'medium', 'binary-or-archive', 'archive file')
det('D-BINARY-UNK', 'medium', 'binary-or-archive', 'binary file that is not an image, font or document', { suspicious: true })
det('D-ORPHAN', 'low', 'orphan', 'known by a rule, but no other file names it')
det('D-STALE-COPY', 'medium', 'stale-copy', 'copy of a file that has moved on')
det('D-DUPLICATE', 'low', 'duplicate', 'byte-identical copies')
det('D-SQL-DUMP', 'medium', 'binary-or-archive', 'SQL file that looks like a data dump', { suspicious: true })
det('D-LARGE', 'low', 'history-bloat', 'large file in the working tree')
det('D-UNKNOWN', 'medium', 'orphan', 'nothing in the project explains this file')
// content detectors
det('D-PHP-EVAL', 'high', 'webshell-or-obfuscated-code', 'eval() in PHP', { suspicious: true })
det('D-PHP-ASSERT', 'high', 'webshell-or-obfuscated-code', 'assert() fed a variable', { suspicious: true })
det('D-PHP-CREATEFN', 'high', 'webshell-or-obfuscated-code', 'create_function()', { suspicious: true })
det('D-PHP-PREG-E', 'high', 'webshell-or-obfuscated-code', 'preg_replace with the /e modifier', { suspicious: true })
det('D-PHP-DECODE', 'high', 'webshell-or-obfuscated-code', 'decode chain (gzinflate / str_rot13 / base64 of a literal blob)', { suspicious: true })
det('D-PHP-EXEC', 'high', 'webshell-or-obfuscated-code', 'process-execution primitive in PHP', { suspicious: true })
det('D-PHP-USERINC', 'high', 'webshell-or-obfuscated-code', 'request data reaches include / require / file_put_contents / move_uploaded_file', { suspicious: true })
det('D-PHP-VARFUNC', 'high', 'webshell-or-obfuscated-code', 'variable function called with request data', { suspicious: true })
det('D-PHP-SHELLSIG', 'high', 'webshell-or-obfuscated-code', 'known web-shell signature', { suspicious: true })
det('D-CHR-BUILD', 'medium', 'webshell-or-obfuscated-code', 'string built from chr() calls', { suspicious: true })
det('D-HEX-STRING', 'medium', 'webshell-or-obfuscated-code', 'long hex / octal escaped string', { suspicious: true })
det('D-JS-EVAL', 'medium', 'webshell-or-obfuscated-code', 'eval / new Function / document.write(unescape) in web-served script', { suspicious: true })
det('D-JS-DECODE', 'high', 'webshell-or-obfuscated-code', 'eval of a decoded string (atob / fromCharCode / unescape)', { suspicious: true })
det('D-LONGLINE', 'low', 'webshell-or-obfuscated-code', 'very long single line in hand-written code')
det('D-ENTROPY', 'medium', 'webshell-or-obfuscated-code', 'high-entropy blob in code', { suspicious: true })
det('D-POLYGLOT', 'high', 'webshell-or-obfuscated-code', 'executable code inside an image / font / archive', { suspicious: true })
det('D-SVG-ACTIVE', 'medium', 'webshell-or-obfuscated-code', 'script or event handler inside an SVG', { suspicious: true })
det('D-SHELL-PIPE', 'medium', 'webshell-or-obfuscated-code', 'shell script that downloads and runs, or decodes and runs', { suspicious: true })
// secrets
det('S-PRIVKEY', 'high', 'secret', 'private key block', { suspicious: true })
det('S-AWS', 'high', 'secret', 'AWS access key id', { suspicious: true })
det('S-AWS-SECRET', 'high', 'secret', 'AWS secret access key', { suspicious: true })
det('S-GCP', 'high', 'secret', 'Google API key', { suspicious: true })
det('S-GCP-SA', 'high', 'secret', 'GCP service-account JSON', { suspicious: true })
det('S-AZURE', 'high', 'secret', 'Azure storage key', { suspicious: true })
det('S-GITHUB', 'high', 'secret', 'GitHub token', { suspicious: true })
det('S-STRIPE', 'high', 'secret', 'Stripe live key', { suspicious: true })
det('S-SLACK', 'high', 'secret', 'Slack token or webhook', { suspicious: true })
det('S-ANTHROPIC', 'high', 'secret', 'Anthropic API key', { suspicious: true })
det('S-OPENAI', 'high', 'secret', 'OpenAI-style API key', { suspicious: true })
det('S-ELEVEN', 'high', 'secret', 'ElevenLabs API key', { suspicious: true })
det('S-JWT', 'high', 'secret', 'JSON web token (n8n / Supabase style API key)', { suspicious: true })
det('S-BEARER', 'high', 'secret', 'bearer token literal', { suspicious: true })
det('S-DSN', 'high', 'secret', 'database URL with a password', { suspicious: true })
det('S-N8N', 'high', 'secret', 'n8n API key header literal', { suspicious: true })
det('S-HOSTINGER', 'high', 'secret', 'Hostinger token literal', { suspicious: true })
det('S-NAMED', 'high', 'secret', 'credential assigned a literal value', { suspicious: true })
det('S-TEST-CRED', 'low', 'secret', 'literal test credential in a test, rig or fixture')

const provenance = { map: null }   // path -> "author date subject (sha)", filled once
function isAcknowledged(f) { return ACK.find((a) => a.test(f.where) && (!a.detector || a.detector === f.detector) && (!a.kind || a.kind === f.kind)) }
function pushFinding(f) { findings.push(f); return f }
// emit(): the one place a detector hit becomes a finding, so the allow-list
// and the blind hook apply to all of them.
function emit(detId, where, evidence, extra = {}) {
  if (!on(detId)) return null
  const d = DET[detId]
  const count = extra.count ?? 1
  const allow = ALLOW.find((a) => (!a.detector || a.detector === detId) && a.test(where))
  if (allow && (allow.max === undefined || count <= allow.max)) { allowedHits.push({ detector: detId, where, count, reason: allow.reason || '' }); return null }
  const sev = extra.severity || d.severity
  return pushFinding({
    detector: detId, severity: sev, where, kind: extra.kind || d.kind, title: d.title,
    evidence: allow ? `${evidence} (allow-list permits ${allow.max}, found ${count})` : evidence,
    who_probably: extra.who || '', action: extra.action || '', confidence: extra.confidence || 'medium',
    suspicious: !!d.suspicious, file: extra.file || where.split(' ')[0].split(':')[0],
  })
}

// ------------------------------------------------------------------- git
const ROOT = path.resolve(opt('--root', (() => {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: WEB, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return path.resolve(WEB, '..') }
})()))
function git(args, o = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...o })
}
let IS_GIT = false
function initGit() { try { git(['rev-parse', '--is-inside-work-tree']); IS_GIT = true } catch { IS_GIT = false } }
const HEAD = () => { try { return git(['rev-parse', '--short=8', 'HEAD']).toString().trim() } catch { return '(no git)' } }

// ------------------------------------------------------------ the inventory
// Every file the tree has: tracked (git ls-files -s), untracked and not
// ignored, and ignored. Ignored folders come back collapsed (node_modules/,
// dist/): they are classified as ONE entry and their contents are not read,
// because they are somebody's build output, not source.
function splitZ(buf) {
  const out = []; let s = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) { out.push(buf.subarray(s, i)); s = i + 1 }
  if (s < buf.length) out.push(buf.subarray(s))
  return out
}
function inventory() {
  const files = new Map()
  const add = (rawName, o) => {
    const name = rawName.toString('utf8')
    const badUtf8 = !Buffer.from(name, 'utf8').equals(rawName)
    if (files.has(name)) return
    files.set(name, { path: name, badUtf8, ...o })
  }
  if (IS_GIT) {
    for (const rec of splitZ(git(['ls-files', '-z', '-s']))) {
      const tab = rec.indexOf(9)
      const [mode, sha] = rec.subarray(0, tab).toString('latin1').split(' ')
      add(rec.subarray(tab + 1), { mode, blob: sha, tracked: true })
    }
    for (const rec of splitZ(git(['ls-files', '-z', '-o', '--exclude-standard']))) add(rec, { mode: null, tracked: false })
    for (const rec of splitZ(git(['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory']))) {
      const n = rec.toString('utf8')
      add(rec, { mode: null, tracked: false, ignored: true, dir: n.endsWith('/') })
    }
  } else {
    ;(function walk(d) {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = d ? d + '/' + e.name : e.name
        if (e.name === '.git') continue
        if (e.isDirectory()) { walk(rel); continue }
        add(Buffer.from(rel), { mode: e.isSymbolicLink() ? '120000' : null, tracked: false })
      }
    })('')
  }
  for (const f of files.values()) {
    f.abs = path.join(ROOT, f.path)
    try {
      const st = fs.lstatSync(f.abs)
      f.size = st.size; f.diskMode = st.mode; f.isLink = st.isSymbolicLink(); f.mtime = st.mtimeMs; f.present = true
    } catch { f.present = false; f.size = 0 }
    if (f.mode === '120000') f.isLink = true
    f.exec = f.mode === '100755'
  }
  return files
}

// ------------------------------------------------------------ classification
function classify(f) {
  for (const r of RULES) {
    if (r.tracked === true && !f.tracked) continue
    if (r.tracked === false && f.tracked) continue
    if (r.test(f.path)) return r
  }
  return null
}

// Reference index: every path-looking token in every readable text file, by
// base name. A reference is LOOSE on purpose (a bare base name counts), the
// same direction old-files-inventory.mjs errs in: towards "explained".
const TOKEN = /[A-Za-z0-9_@.\/\-]{3,220}/g
const REF_EXT = /\.(m?js|cjs|jsx|tsx?|json|php|sql|sh|py|html?|css|md|txt|xml|png|jpe?g|webp|svg|ico|gif|woff2?|zip|webmanifest|ya?ml|toml|patch|cnf|ini|awk|glsl|dart|pyc|mp[34]|wav|pdf|glb|gitignore|htaccess|example|csv)$/i
const CODE_REF_EXT = /\.(m?js|cjs|jsx|ts|tsx|json|php|sh|py|html?|css|ya?ml|toml|awk|cnf)$/i
function buildRefIndex(files, skipFile) {
  const idx = new Map()
  for (const f of files.values()) {
    if (!f.present || f.isLink || f.dir || f.size === 0 || f.size > 1.5e6) continue
    if (IMG_EXT.test(f.path) || FONT_EXT.test(f.path) || ARCHIVE_EXT.test(f.path) || /\.(pdf|glb|mp[34]|wav)$/i.test(f.path)) continue
    if (skipFile(f)) continue
    let t
    try { const b = fs.readFileSync(f.abs); if (b.subarray(0, 4096).includes(0)) continue; t = b.toString('utf8') } catch { continue }
    const kind = CODE_REF_EXT.test(f.path) || /(^|\/)(\.gitignore|\.htaccess|\.mcp\.json)$/.test(f.path) ? 'code' : 'doc'
    const seen = new Set()
    for (const m of t.matchAll(TOKEN)) {
      let tok = m[0].replace(/^(\.\/|\/)+/, '').replace(/^(\.\.\/)+/, '').replace(/[.\-\/]+$/, '')
      if (!REF_EXT.test(tok)) continue
      if (seen.has(tok)) continue
      seen.add(tok)
      const base = tok.slice(tok.lastIndexOf('/') + 1)
      if (!base) continue
      let l = idx.get(base)
      if (!l) idx.set(base, (l = []))
      if (l.length < 40) l.push({ ref: f.path, tok, kind })
    }
  }
  return idx
}
function referrersOf(p, idx) {
  const base = p.slice(p.lastIndexOf('/') + 1)
  const out = []
  for (const r of idx.get(base) || []) {
    if (r.ref === p) continue
    const exact = r.tok === base ? 'basename' : (p === r.tok || p.endsWith('/' + r.tok)) ? 'path' : null
    if (exact) out.push({ ref: r.ref, kind: r.kind, how: exact })
  }
  return out
}

// ---------------------------------------------------------------- secrets
// One table, used on the working tree and on every blob of the history. A
// pattern says WHERE a value is; judge() says whether the value is real.
const KEYWORDS = 'password|passwd|passphrase|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|encrp[_-]?key|resource[_-]?key|cron[_-]?key|db[_-]?pass|mysql[_-]?pass|token'
const SECRET_PATTERNS = [
  { id: 'S-PRIVKEY', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, none: true },
  { id: 'S-AWS', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g },
  { id: 'S-AWS-SECRET', re: /aws_?secret_?access_?key['"\s:=]+([A-Za-z0-9\/+=]{40})(?![A-Za-z0-9\/+=])/gi, group: 1 },
  { id: 'S-GCP', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { id: 'S-GCP-SA', re: /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"/g, none: true },
  { id: 'S-AZURE', re: /AccountKey=([A-Za-z0-9+\/=]{40,})/g, group: 1 },
  { id: 'S-GITHUB', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { id: 'S-STRIPE', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b|\bwhsec_[0-9a-zA-Z]{24,}\b/g },
  { id: 'S-SLACK', re: /\bxox[abprs]-[0-9A-Za-z\-]{10,}\b|hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g },
  { id: 'S-ANTHROPIC', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { id: 'S-OPENAI', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{40,}\b/g },
  { id: 'S-ELEVEN', re: /\bsk_[a-f0-9]{40,}\b/g },
  { id: 'S-JWT', re: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g },
  { id: 'S-BEARER', re: /Authorization['"\s:=]+Bearer\s+([A-Za-z0-9._\-]{24,})/gi, group: 1 },
  { id: 'S-DSN', re: /\b(?:mysql|mysqli|pgsql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@\/'"`]+:([^\s@\/'"`]{3,})@[^\s'"`]+/gi, group: 1 },
  { id: 'S-N8N', re: /x-n8n-api-key['"\s:=]+['"`]?([A-Za-z0-9._\-]{20,})/gi, group: 1 },
  { id: 'S-HOSTINGER', re: /(?:HOSTINGER|HPANEL)[A-Z_]*(?:TOKEN|KEY|PASSWORD)['"\s:=]+['"`]?([A-Za-z0-9|_\-]{20,})/g, group: 1 },
  { id: 'S-NAMED', re: new RegExp(`(?:^|[^A-Za-z0-9_])([A-Za-z0-9_]*(?:${KEYWORDS})[A-Za-z0-9_]*)['"\\]]?\\s*(?:=>|:=|:|=)\\s*(['"\`])([^'"\`\\n\\r]{6,200})\\2`, 'gi'), group: 3, keyGroup: 1 },
]
const PLACEHOLDER_RE = /(^|[^a-z])(your|change[-_ ]?me|changeme|replace|insert|example|placeholder|sample|dummy|fake|redacted|todo|tbd|not[-_ ]?set|none|null|undefined|xxxx+|\*\*\*+|\.\.\.|lorem|foo|bar|baz|test|demo|secret|password|token|apikey|api[-_]key)([^a-z]|$)/i
const CODEY_RE = /^\s*[$%<{(\[]|\$\{|\$_|\$[A-Za-z_]|getenv|process\.env|import\.meta|\)\s*$|\([^)]*\)$|=>|\bfunction\b|%s|\{\{|^[A-Za-z_]+\(|\.\.\.|^https?:\/\/[^@]*$/
function judge(value, ctx) {
  const v = value.trim()
  if (PLACEHOLDERS.has(v)) return { verdict: 'placeholder', why: 'documented placeholder' }
  if (v.length < 8) return { verdict: 'placeholder', why: 'too short to be a secret' }
  if (CODEY_RE.test(v) && !/^[A-Za-z0-9+\/=_\-]{32,}$/.test(v)) return { verdict: 'placeholder', why: 'expression, variable or URL, not a literal' }
  if (/^(.)\1+$/.test(v) || /^(0123456789|abcdefghij|12345678)/i.test(v)) return { verdict: 'placeholder', why: 'repeated or sequential characters' }
  const h = entropy(v)
  if (PLACEHOLDER_RE.test(v) && h < 4.2) return { verdict: 'placeholder', why: 'placeholder wording' }
  if (/^[a-z][a-z \-_]{7,}$/i.test(v) && h < 3.6) return { verdict: 'placeholder', why: 'plain words' }
  if (/[\s]/.test(v) && v.length < 40) return { verdict: 'placeholder', why: 'prose' }
  const inTest = ctx?.testZone
  if (inTest && !(v.length >= 32 && h >= 4.2)) return { verdict: 'test', why: 'literal in a test / rig / fixture' }
  if (v.length >= 20 && h >= 3.8) return { verdict: 'real', why: `entropy ${h.toFixed(1)} bits/char over ${v.length} characters` }
  if (v.length >= 12 && h >= 3.0) return { verdict: 'probable', why: `entropy ${h.toFixed(1)}, ${v.length} characters` }
  return { verdict: 'probable', why: 'literal value, short or low entropy' }
}
// Scan one text for secrets. Returns hits: {id, line, key, verdict, why, masked, fp}.
function scanSecrets(text, ctx = {}) {
  const hits = []
  for (const p of SECRET_PATTERNS) {
    if (!on(p.id)) continue
    p.re.lastIndex = 0
    let n = 0
    for (const m of text.matchAll(p.re)) {
      if (++n > 60) break
      const value = p.none ? '' : (p.group ? m[p.group] : m[0])
      if (!p.none && value === undefined) continue
      let v
      if (p.none) v = { verdict: 'real', why: 'a private key block exists' }
      else if (p.id === 'S-NAMED') v = judge(value, ctx)
      else if (['S-DSN', 'S-BEARER', 'S-N8N', 'S-HOSTINGER'].includes(p.id)) v = judge(value, ctx)
      else if (p.id === 'S-JWT') v = /^eyJhbGciOiJub25l/.test(value) ? { verdict: 'placeholder', why: 'alg none' } : { verdict: 'real', why: 'JWT-shaped token' }
      else v = { verdict: ctx?.testZone ? 'test' : 'real', why: 'provider key format' }
      if (v.verdict === 'placeholder') { hits.push({ id: p.id, verdict: 'placeholder', line: 0 }); continue }
      hits.push({
        id: p.id, line: lineOf(text, m.index), key: p.keyGroup ? m[p.keyGroup] : '', verdict: v.verdict, why: v.why,
        masked: p.none ? '(no value shown)' : mask(value), fp: p.none ? 'key-block' : sha256(value).slice(0, 16),
      })
    }
  }
  return hits
}
const isTestZone = (p) => TEST_ZONE.some((r) => r.test(p)) || /(^|\/)(fixtures?|__tests__|tests?)\//.test(p) || /(-|\.)test\.[cm]?js$/.test(p)

// ------------------------------------------------------------ content scan
const SHELL_SIG = /\b(?:c99(?:shell)?|r57(?:shell)?|b374k|wso(?:2)?\s*shell|FilesMan|WebShell|PHPSpy|Weevely|China\s*Chopper|IndoXploit|alfa\s*shell|Mini\s*Shell)\b|eval\(\s*(?:base64_decode|gzinflate|str_rot13)|\$GLOBALS\[\s*['"]\w+['"]\s*\]\s*\(/gi
function contentDetect(f, buf, zone) {
  const p = f.path
  const phpName = PHP_EXT.test(p)
  const head = buf.subarray(0, 8192)
  const binary = head.includes(0)
  if (binary) return { binary: true }
  const text = buf.toString('utf8')
  const isPhp = phpName || (!DOC_EXT.test(p) && !IMG_EXT.test(p) && /<\?(?:php|=)/.test(text))
  const isJs = JS_EXT.test(p) || MARKUP_EXT.test(p)
  const code = isPhp || isJs || SH_EXT.test(p) || PY_EXT.test(p)
  const ev = (re, max = 3) => { const out = []; let c = 0; re.lastIndex = 0; for (const m of text.matchAll(re)) { c++; if (out.length < max) out.push({ line: lineOf(text, m.index), tok: m[0].replace(/\s+/g, '').slice(0, 24) }) } return { count: c, lines: out } }
  const show = (r) => r.lines.map((l) => `${l.tok} @${l.line}`).join(', ') + (r.count > r.lines.length ? ` (+${r.count - r.lines.length} more)` : '')
  const hit = (id, r, extra) => { if (r.count) emit(id, p, `${r.count} hit(s): ${show(r)}`, { count: r.count, confidence: 'high', ...extra }) }
  if (isPhp) {
    hit('D-PHP-EVAL', ev(/\beval\s*\(/g))
    hit('D-PHP-ASSERT', ev(/\bassert\s*\(\s*\$/g))
    hit('D-PHP-CREATEFN', ev(/\bcreate_function\s*\(/g))
    hit('D-PHP-PREG-E', ev(/preg_replace\s*\(\s*(['"])(?:(?!\1)[^\\]|\\.)*\/[imsxuADSUXJ]*e[imsxuADSUXJ]*\1/g))
    const dec = ev(/\b(?:gzinflate|gzuncompress|gzdecode|str_rot13|convert_uudecode)\s*\(|base64_decode\s*\(\s*['"][A-Za-z0-9+\/=\s]{80,}['"]/g)
    hit('D-PHP-DECODE', dec)
    hit('D-PHP-EXEC', ev(/\b(?:system|exec|passthru|shell_exec|popen|proc_open|pcntl_exec)\s*\(/g), { severity: zone === 'web' ? 'high' : 'medium' })
    hit('D-PHP-EXEC', ev(/`[^`\n]{2,120}`(?=\s*;)/g), { severity: 'medium' })
    hit('D-PHP-USERINC', ev(/\b(?:include|require)(?:_once)?\s*\(?\s*\$_(?:GET|POST|REQUEST|COOKIE)|\b(?:file_put_contents|fwrite|fputs|move_uploaded_file|copy|unlink|rename)\s*\([^;]{0,160}\$_(?:GET|POST|REQUEST|COOKIE|FILES)\b/g))
    hit('D-PHP-VARFUNC', ev(/(?<![\w>:\-])\$[A-Za-z_]\w*\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE|SERVER)\b|@?\$_(?:GET|POST|REQUEST|COOKIE)\s*\[[^\]]*\]\s*\(/g))
    hit('D-CHR-BUILD', ev(/(?:chr\s*\(\s*\d+\s*\)\s*\.\s*){6,}/g))
  }
  if (isPhp || isJs || SH_EXT.test(p)) hit('D-PHP-SHELLSIG', ev(SHELL_SIG))
  if (code) {
    hit('D-HEX-STRING', ev(/(?:\\x[0-9a-fA-F]{2}){20,}|(?:\\[0-7]{3}){20,}/g))
    // entropy: a long base64/hex run that is not a data: URI or a hash
    let blob = null
    for (const m of text.matchAll(/[A-Za-z0-9+\/=_\-]{160,}/g)) {
      const pre = text.slice(Math.max(0, m.index - 40), m.index)
      if (/data:[a-z\/+\-]+;base64,$/i.test(pre) || /base64,$/i.test(pre) || /^[0-9a-f]+$/i.test(m[0]) && m[0].length < 200) continue
      if (entropy(m[0]) >= 4.7) { blob = { line: lineOf(text, m.index), len: m[0].length }; break }
    }
    if (blob) emit('D-ENTROPY', p, `${blob.len}-character high-entropy run @${blob.line}`, { confidence: 'medium' })
    // long lines: hand-written code does not have them
    let maxLine = 0, maxAt = 0, ln = 1
    for (const l of text.split('\n')) { if (l.length > maxLine) { maxLine = l.length; maxAt = ln } ln++ }
    const limit = isPhp ? 4000 : 30000
    if (maxLine > limit) emit('D-LONGLINE', p, `a ${maxLine}-character line @${maxAt}`, { severity: isPhp ? 'medium' : 'low' })
  }
  if (isJs && !PY_EXT.test(p)) {
    if (zone === 'web' || zone === 'client') {
      hit('D-JS-EVAL', ev(/\beval\s*\(|\bnew\s+Function\s*\(|document\.write\s*\(\s*unescape/g))
    }
    hit('D-JS-DECODE', ev(/\beval\s*\(\s*(?:atob|unescape|String\.fromCharCode|decodeURIComponent)\s*\(|\bFunction\s*\(\s*(?:atob|unescape)\s*\(/g))
  }
  if (/\.svg$/i.test(p)) hit('D-SVG-ACTIVE', ev(/<script\b|\son[a-z]+\s*=|javascript:/gi))
  if (SH_EXT.test(p)) hit('D-SHELL-PIPE', ev(/\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba)?sh\b/g))
  if (/\.sql$/i.test(p)) {
    const ins = (text.match(/^INSERT INTO\s+`?(\w+)`?/gim) || [])
    const sensitive = ins.filter((s) => /`?(orders?|customers?|admin_users?|users?|sessions?|payments?|addresses|tickets?|support|subscribers?|tokens?)`?$/i.test(s.replace(/^INSERT INTO\s+/i, ''))).length
    if (/^-- (?:MySQL dump|Dump completed|Host:\s)|^-- (?:phpMyAdmin|Server version)/im.test(text) || sensitive > 3)
      emit('D-SQL-DUMP', p, `looks like a dump: ${ins.length} INSERT statements, ${sensitive} into customer/order/account tables`, { confidence: 'medium' })
  }
  return { binary: false, text }
}
function sniffBinary(buf) {
  const h = buf.subarray(0, 16)
  const is = (...b) => b.every((x, i) => h[i] === x)
  if (is(0x7f, 0x45, 0x4c, 0x46)) return 'ELF executable'
  if (is(0x4d, 0x5a)) return 'Windows PE executable'
  if (is(0xca, 0xfe, 0xba, 0xbe) || is(0xcf, 0xfa, 0xed, 0xfe) || is(0xfe, 0xed, 0xfa, 0xce)) return 'Mach-O / Java class'
  if (h.toString('latin1', 0, 15) === 'SQLite format 3') return 'SQLite database'
  if (is(0x50, 0x4b, 0x03, 0x04) || is(0x50, 0x4b, 0x05, 0x06)) return 'zip archive'
  if (is(0x1f, 0x8b)) return 'gzip archive'
  if (is(0x42, 0x5a, 0x68)) return 'bzip2 archive'
  if (is(0x37, 0x7a, 0xbc, 0xaf)) return '7z archive'
  if (is(0x52, 0x61, 0x72, 0x21)) return 'rar archive'
  if (is(0x00, 0x61, 0x73, 0x6d)) return 'WebAssembly module'
  if (is(0x25, 0x50, 0x44, 0x46)) return 'PDF document'
  if (is(0x89, 0x50, 0x4e, 0x47)) return 'PNG image'
  if (is(0xff, 0xd8, 0xff)) return 'JPEG image'
  if (h.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'WebP image'
  if (h.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'WAV audio'
  if (h.toString('latin1', 0, 3) === 'GIF') return 'GIF image'
  if (h.toString('latin1', 0, 4) === 'wOF2' || h.toString('latin1', 0, 4) === 'wOFF') return 'web font'
  if (is(0x00, 0x01, 0x00, 0x00) || h.toString('latin1', 0, 4) === 'OTTO' || h.toString('latin1', 0, 4) === 'true') return 'font'
  if (is(0x00, 0x00, 0x01, 0x00)) return 'ICO image'
  if (h.toString('latin1', 0, 4) === 'glTF') return 'glb model'
  if (is(0xa7, 0x0d, 0x0d, 0x0a) || (h[2] === 0x0d && h[3] === 0x0a && h[0] >= 0x80)) return 'Python bytecode'
  if (h.toString('latin1', 0, 3) === 'ID3' || is(0xff, 0xfb) || is(0xff, 0xf3)) return 'MP3 audio'
  return ''
}
const BINARY_OK = /^(PNG image|JPEG image|WebP image|GIF image|ICO image|web font|font|PDF document)$/
const PHP_OPEN = Buffer.from('<?php'), PHP_SHORT = Buffer.from('<?='), EVAL_B = Buffer.from('eval(')

// ------------------------------------------------------------------ zips
function zipEntries(buf) {
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (e < 0) return null
  const total = buf.readUInt16LE(e + 10), cd = buf.readUInt32LE(e + 16)
  const out = []; let p = cd
  for (let i = 0; i < total && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32)
    out.push({
      name: buf.toString('utf8', p + 46, p + 46 + nl), method: buf.readUInt16LE(p + 10),
      dosDate: buf.readUInt16LE(p + 14), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), lho: buf.readUInt32LE(p + 42),
    })
    p += 46 + nl + el + cl
  }
  return out
}
function zipRead(buf, ent) {
  if (ent.usize > 8e6) return null
  const p = ent.lho
  if (buf.readUInt32LE(p) !== 0x04034b50) return null
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28)
  const data = buf.subarray(start, start + ent.csize)
  try { return ent.method === 0 ? data : ent.method === 8 ? inflateRawSync(data) : null } catch { return null }
}
const dosDate = (d) => `${1980 + (d >> 9)}-${String((d >> 5) & 15).padStart(2, '0')}-${String(d & 31).padStart(2, '0')}`

// ------------------------------------------------------------------ the scan
async function scanTree() {
  initGit()
  const files = inventory()
  const out = { counts: {}, byRule: new Map(), unknown: [], suspicious: new Set(), files: [], archives: [], trees: {}, duplicates: [] }
  const present = [...files.values()].filter((f) => f.present || f.dir)
  const idx = buildRefIndex(files, (f) => RULES.find((r) => r.refsource === false && r.test(f.path)) !== undefined || f.ignored)
  const dupes = new Map()
  const lowerSeen = new Map(), nfcSeen = new Map()
  const tracked = [...files.values()].filter((f) => f.tracked)
  const ignoredTracked = IS_GIT ? new Set(splitZ(git(['ls-files', '-z', '-c', '-i', '--exclude-standard'])).map((b) => b.toString('utf8'))) : new Set()

  for (const f of [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const p = f.path
    const zone = zoneOf(p)
    f.zone = zone
    f.status = null
    const rule = classify(f)
    // ---------- path / name detectors (they apply to known files too)
    if (f.badUtf8 || /[\x00-\x1f\x7f]|^-|\s$|\\/.test(p)) emit('D-NAME-ODD', p, `name is not clean (${f.badUtf8 ? 'invalid UTF-8' : 'control character, leading dash, trailing space or backslash'})`, { confidence: 'high' })
    if (IS_GIT) {
      const lk = p.toLowerCase(), nk = p.normalize('NFC')
      if (lowerSeen.has(lk) && lowerSeen.get(lk) !== p) emit('D-CASE-COLLIDE', p, `differs only by case from ${lowerSeen.get(lk)}`, { confidence: 'high' })
      else lowerSeen.set(lk, p)
      if (nfcSeen.has(nk) && nfcSeen.get(nk) !== p) emit('D-CASE-COLLIDE', p, `differs only by Unicode normalisation from ${nfcSeen.get(nk)}`, { confidence: 'high' })
      else nfcSeen.set(nk, p)
    }
    if (f.dir) {
      f.status = rule ? 'known' : 'unknown'
      f.rule = rule?.id
      if (!rule) out.unknown.push(f)
      else bump(out.byRule, rule, 0)
      continue
    }
    if (!f.present) { f.status = 'missing'; continue }
    const base = path.posix.basename(p)
    if (f.isLink) emit('D-SYMLINK', p, 'symbolic link (never followed by this scan)', { confidence: 'high' })
    if (f.exec && !EXEC_OK.some((r) => r.test(p))) emit('D-EXEC-BIT', p, 'mode 100755 on a file that is not on the executables allow-list', { confidence: 'high' })
    if (f.present && !f.isLink && (f.diskMode & 0o6000 || f.diskMode & 0o002)) emit('D-PERM-WORLD', p, `mode ${(f.diskMode & 0o7777).toString(8)} on disk`, { confidence: 'high' })
    if (/\.(php[0-9]?|phtml|phar|pht|inc)\.[a-z0-9]{2,5}$/i.test(base) && !/\.(php|inc)\.(example|dist|txt|md|sample|bak)$/i.test(base))
      emit('D-DOUBLE-EXT', p, 'PHP extension followed by another extension (Apache AddHandler runs it)', { severity: 'medium', confidence: 'medium' })
    if (/\.(jpe?g|png|gif|webp|ico|svg|txt|css|js|woff2?|pdf|zip|mp[34])\.(php[0-9]?|phtml|phar|pht)$/i.test(base))
      emit('D-DOUBLE-EXT', p, 'decoy extension followed by a PHP extension', { confidence: 'high' })
    if (PHP_EXT.test(base) && MEDIA_DIR.test(p) && !/(^|\/)dropin\//.test(p) && !/(^|\/)(scripts|ops)\//.test(p))
      emit('D-PHP-IN-MEDIA', p, 'PHP in a folder of images / fonts / uploads / assets', { confidence: 'high' })
    if (PHP_EXT.test(base) && /^sporta-web\/public\/|^sporta-html5\/|^brand\//.test(p))
      emit('D-PHP-IN-STATIC', p, 'public/ is copied to the web root verbatim, so this file would be served and run', { confidence: 'high' })
    if (/^(\.env(\..+)?|.*\.env|\.htpasswd|\.netrc|\.npmrc|\.pgpass|\.my\.cnf|credentials?(\.json)?|secrets?\.(json|ya?ml)|\.cbk_token.*)$/i.test(base) && !/\.(example|sample|dist|template)$/i.test(base) && !/^\.env\.deploy\.example$/.test(base))
      emit('D-ENVFILE', p, 'credential/environment file by name', { confidence: 'high' })
    if (/\.(pem|key|p12|pfx|jks|keystore|ppk|p8|mobileprovision|kdbx)$|^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(base))
      emit('D-KEYFILE', p, 'key / certificate file by name', { confidence: 'high' })
    if (/(^|[-_. ])(bak|old|orig|swp|tmp|temp|backup|copy|final|untitled|draft|save|rej|sav|new)([-_. ]|$)|~$|\(\d+\)|\.swp$|\.DS_Store$/i.test(base))
      emit('D-BACKUP-NAME', p, 'name suggests a copy, backup or scratch file', { confidence: 'low' })
    if (/^\.|\/\./.test(p) && !(MAN.hidden_ok || []).some((g) => globRe(g).test(p)))
      emit('D-HIDDEN', p, 'hidden path component not on the allow-list', { confidence: 'medium' })
    if (/(^|\/)(__pycache__|\.idea|\.vscode-test|\.cache|\.parcel-cache|\.next|coverage|\.nyc_output|Thumbs\.db|\.DS_Store)(\/|$)|\.(pyc|pyo|class|log|tsbuildinfo)$/i.test(p) && !f.ignored)
      emit('D-GENERATED', p, 'build, editor or cache output', { confidence: 'high' })
    if (f.tracked && ignoredTracked.has(p)) emit('D-TRACKED-IGNORED', p, '.gitignore forbids this path but it is tracked (the rule is not being applied)', { confidence: 'high' })
    // ---------- content
    let status = rule ? 'known' : null
    let how = rule ? `rule ${rule.id}` : ''
    let buf = null
    if (!f.ignored || !/(^|\/)(node_modules|dist)\//.test(p)) {
      try {
        const fd = fs.openSync(f.abs, 'r')
        const n = Math.min(f.size, 6e6)
        buf = Buffer.alloc(n)
        fs.readSync(fd, buf, 0, n, 0)
        fs.closeSync(fd)
      } catch { buf = null }
    }
    if (buf && !f.isLink) {
      const sniff = sniffBinary(buf)
      const looksBinary = buf.subarray(0, 8192).includes(0)
      f.type = sniff
      if (f.size >= 512 && f.size <= 6e6 && !f.ignored) {
        const h = sha256(buf)
        f.hash = h
        if (!dupes.has(h)) dupes.set(h, [])
        dupes.get(h).push(p)
      }
      if (looksBinary || sniff) {
        if (!IMG_EXT.test(p) || !/image/.test(sniff)) {
          // extension-label vs bytes: a "png" that is not a PNG is a decoy
          if (IMG_EXT.test(p) && sniff && !/image/.test(sniff) && !/^(ICO image)$/.test(sniff)) emit('D-BINARY-UNK', p, `image extension but the bytes are: ${sniff}`, { confidence: 'high' })
        }
        if (!BINARY_OK.test(sniff) && !rule?.binary_ok) {
          if (/archive/.test(sniff) || ARCHIVE_EXT.test(p)) {
            if (!rule?.archive_ok) emit('D-ARCHIVE', p, `${sniff || 'archive by extension'}, ${kb(f.size)}`, { confidence: 'high' })
          } else if (!ARCHIVE_EXT.test(p)) {
            emit('D-BINARY-UNK', p, `${sniff || 'unrecognised binary content'}, ${kb(f.size)}`, { confidence: sniff ? 'high' : 'medium' })
          }
        }
        if (!PHP_EXT.test(p) && (buf.includes(PHP_OPEN) || buf.includes(PHP_SHORT)) && !/\.(md|txt)$/i.test(p))
          emit('D-POLYGLOT', p, `${sniff || 'binary'} file contains a PHP open tag (<?php)`, { confidence: 'high' })
        if (IMG_EXT.test(p) || FONT_EXT.test(p) || ARCHIVE_EXT.test(p)) {
          if (buf.includes(EVAL_B) && !/zip|archive/i.test(sniff)) emit('D-POLYGLOT', p, `${sniff || 'binary'} file contains eval(`, { confidence: 'medium' })
        }
        if (/archive/.test(sniff) && /zip/.test(sniff)) await inspectZip(f, buf, out)
      } else {
        const cd = contentDetect(f, buf, zone)
        if (cd && cd.text !== undefined) {
          if (!MAN.no_secret_scan?.some((g) => globRe(g).test(p))) {
            const hits = scanSecrets(cd.text, { testZone: isTestZone(p) })
            noteSecrets(f, hits, out)
          }
        }
      }
    }
    // ---------- classification
    let refs = []
    if (!status) {
      refs = referrersOf(p, idx)
      const code = refs.filter((r) => r.kind === 'code')
      if (code.length) { status = 'known'; how = `referenced by ${code[0].ref}` }
    }
    if (rule && rule.refs === 'required') {
      refs = refs.length ? refs : referrersOf(p, idx)
      if (!refs.length) emit('D-ORPHAN', p, `${rule.id} explains what it is, but no file in the repo names it`, { confidence: 'medium', action: 'document or remove' })
      f.refCount = refs.length
    }
    if (rule?.flag) emit(rule.flag.detector || 'D-STALE-COPY', p, rule.flag.evidence || rule.purpose, { severity: rule.flag.severity, kind: rule.flag.kind, action: rule.flag.action, confidence: 'high' })
    if (!status) {
      status = refs.length ? 'doc-only' : 'unknown'
      how = refs.length ? `named only in ${refs[0].ref}` : ''
    }
    f.status = status; f.rule = rule?.id; f.how = how
    if (rule) bump(out.byRule, rule, f.size)
    if (status === 'unknown' || status === 'doc-only') {
      out.unknown.push(f)
      emit('D-UNKNOWN', p, status === 'doc-only' ? `no rule; named only in documentation (${refs[0].ref})` : `no rule in the manifest and no file references it (${f.tracked ? 'tracked' : f.ignored ? 'ignored' : 'untracked'}, ${kb(f.size)})`, { confidence: 'high', severity: zone === 'web' ? 'high' : 'medium' })
    }
    if (f.size > 1.5e6 && !rule?.large_ok && !f.ignored) emit('D-LARGE', p, `${kb(f.size)} in the working tree`, { confidence: 'high' })
  }
  // ---------- duplicate families (aggregate, not one finding per pair)
  const fam = new Map()
  for (const [h, list] of dupes) {
    if (list.length < 2) continue
    const key = [...new Set(list.map((x) => (x.startsWith('sporta-web/') ? x.split('/').slice(0, 2).join('/') : x.split('/')[0])))].sort().join(' = ')
    const e = fam.get(key) || { files: 0, bytes: 0, examples: [] }
    e.files += list.length - 1; e.bytes += (fs.lstatSync(path.join(ROOT, list[0])).size) * (list.length - 1)
    if (e.examples.length < 4) e.examples.push(list.join(' = '))
    fam.set(key, e)
  }
  for (const [key, e] of fam) {
    out.duplicates.push({ family: key, extra_copies: e.files, bytes: e.bytes, examples: e.examples })
    if (e.bytes > 4096) emit('D-DUPLICATE', key, `${e.files} byte-identical extra copies (${kb(e.bytes)}), e.g. ${e.examples[0]}`, { confidence: 'high', file: e.examples[0].split(' = ')[0] })
  }
  // ---------- stale copies: sporta-live/* vs sporta-web/public/*
  const stale = { same: 0, differs: [], unique: [] }
  for (const f of files.values()) {
    if (!f.present || !f.path.startsWith('sporta-live/') || !f.hash) continue
    const twin = files.get('sporta-web/public/' + path.posix.basename(f.path))
    if (!twin || !twin.present) { stale.unique.push(f.path); continue }
    const th = sha256(fs.readFileSync(twin.abs))
    if (th === f.hash) stale.same++; else stale.differs.push(`${f.path} (${f.size} B) vs ${twin.path} (${twin.size} B)`)
  }
  out.stale = stale
  if (stale.differs.length) emit('D-STALE-COPY', 'sporta-live/', `${stale.differs.length} add-on copies differ from sporta-web/public (${stale.same} identical, ${stale.unique.length} have no twin); e.g. ${stale.differs[0]}`, { confidence: 'high', file: 'sporta-live/MANIFEST.md', action: 'git rm the diverged copies in a normal commit, keep the unique sources, fix MANIFEST.md' })
  // ---------- the other trees
  for (const tree of MAN.trees || []) {
    const mine = [...files.values()].filter((f) => f.present && f.path.startsWith(tree.dir + '/'))
    const refs = new Map()
    for (const f of mine) for (const r of referrersOf(f.path, idx)) if (!r.ref.startsWith(tree.dir + '/')) refs.set(r.ref, r.kind)
    let same = 0, diff = 0
    for (const f of mine) {
      const twin = files.get('sporta-web/public/' + path.posix.basename(f.path))
      if (twin?.present && f.hash) (sha256(fs.readFileSync(twin.abs)) === f.hash ? same++ : diff++)
    }
    out.trees[tree.dir] = { what: tree.what, files: mine.length, bytes: mine.reduce((n, f) => n + f.size, 0), referenced_from: [...refs].slice(0, 12).map(([r, k]) => `${r} (${k})`), twins_identical: same, twins_differ: diff, ships: tree.ships }
  }
  const all = [...files.values()]
  out.counts = {
    tracked: tracked.length, tracked_present: tracked.filter((f) => f.present).length, tracked_missing_on_disk: tracked.filter((f) => !f.present).length,
    untracked: all.filter((f) => !f.tracked && !f.ignored).length, ignored_entries: all.filter((f) => f.ignored).length,
    ignored_dirs: all.filter((f) => f.dir).length,
    scanned: all.filter((f) => f.present && !f.dir).length,
    known_by_rule: all.filter((f) => f.status === 'known' && f.rule).length,
    known_by_reference: all.filter((f) => f.status === 'known' && !f.rule).length,
    unknown: all.filter((f) => f.status === 'unknown').length,
    named_only_in_docs: all.filter((f) => f.status === 'doc-only').length,
    ignored_dir_entries_classified: all.filter((f) => f.dir && f.status === 'known').length,
  }
  out.fileList = all
  return out
}
function bump(m, rule, size) { const e = m.get(rule.id) || { id: rule.id, purpose: rule.purpose, owner: rule.owner, files: 0, bytes: 0, web: !!rule.web }; if (size !== 0 || true) { e.files++; e.bytes += size } m.set(rule.id, e) }

// Secret hits become ONE finding per (file, detector, verdict): the lines are
// listed, the values never.
function noteSecrets(f, hits, out) {
  const real = hits.filter((h) => h.verdict !== 'placeholder')
  if (!real.length) return
  const by = new Map()
  for (const h of real) { const k = h.id + '|' + h.verdict; (by.get(k) || by.set(k, []).get(k)).push(h) }
  for (const [k, list] of by) {
    const [id, verdict] = k.split('|')
    const lines = list.slice(0, 6).map((h) => `${h.key ? h.key + ' ' : ''}@${h.line} ${h.masked}`).join('; ')
    if (verdict === 'test') {
      emit('S-TEST-CRED', f.path, `${list.length} literal(s) in a test/rig/fixture: ${lines}`, { count: list.length, confidence: 'medium', action: 'keep; make sure none equals a live credential' })
      continue
    }
    emit(id, f.path, `${verdict}: ${list.length} hit(s) — ${list[0].why}; ${lines}`, { count: list.length, confidence: verdict === 'real' ? 'high' : 'medium', action: 'rotate if ever live; remove the literal; see ops/FILES-SCAN.md' })
  }
}
async function inspectZip(f, buf, out) {
  const ents = zipEntries(buf)
  if (!ents) return
  const rec = { path: f.path, bytes: f.size, members: ents.length, newest: '', oldest: '', secrets: [], names_of_note: [], compared: { identical: 0, differs: 0, nocounterpart: 0 }, diffs: [] }
  const dates = ents.map((e) => dosDate(e.dosDate)).sort()
  rec.oldest = dates[0]; rec.newest = dates[dates.length - 1]
  let budget = 64e6
  const MAP = MAN.zip_member_map || []
  for (const e of ents) {
    if (e.name.endsWith('/')) continue
    const base = path.posix.basename(e.name)
    if (/(^|\/)(config\.php|\.env.*|.*\.(pem|key|p12|sql\.gz)|\.cbk_token\.json|\.htpasswd)$/i.test(e.name) && !/config\.example\.php$/.test(e.name)) rec.names_of_note.push(e.name)
    const data = budget > 0 ? zipRead(buf, e) : null
    if (!data) continue
    budget -= data.length
    if (!data.subarray(0, 4096).includes(0)) {
      const hits = scanSecrets(data.toString('utf8'), { testZone: false }).filter((h) => h.verdict !== 'placeholder')
      for (const h of hits) rec.secrets.push(`${e.name}@${h.line} ${h.id} ${h.verdict} ${h.masked}`)
      if (PHP_EXT.test(e.name)) {
        const t = data.toString('utf8')
        if (/\beval\s*\(|\bassert\s*\(\s*\$|create_function\s*\(|gzinflate\s*\(/.test(t)) rec.secrets.push(`${e.name} contains eval/assert/create_function/gzinflate`)
      }
    }
    // compare with the tree: map api/x.php -> sporta-web/dropin/php-store/x.php etc.
    let twin = null
    for (const m of MAP) if (e.name.startsWith(m.prefix)) { twin = m.to + e.name.slice(m.prefix.length); break }
    if (!twin && !e.name.includes('/')) twin = MAN.zip_root_twin ? MAN.zip_root_twin + e.name : null
    const tp = twin && path.join(ROOT, twin)
    if (tp && fs.existsSync(tp)) {
      if (sha256(fs.readFileSync(tp)) === sha256(data)) rec.compared.identical++
      else { rec.compared.differs++; if (rec.diffs.length < 8) rec.diffs.push(`${e.name} (${data.length} B) vs ${twin} (${fs.statSync(tp).size} B)`) }
    } else rec.compared.nocounterpart++
  }
  out.archives.push(rec)
  if (rec.names_of_note.length) emit('D-ARCHIVE', f.path, `archive contains credential-shaped member names: ${rec.names_of_note.slice(0, 5).join(', ')}`, { severity: 'high', kind: 'secret', confidence: 'high' })
  if (rec.secrets.length) emit('D-ARCHIVE', f.path, `archive members with secret/eval hits: ${rec.secrets.slice(0, 4).join('; ')}`, { severity: 'high', kind: 'secret', confidence: 'medium' })
}

// @@PART2@@
