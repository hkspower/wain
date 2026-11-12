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
// MODES (they combine):
//   (default)                the working tree: git ls-files, untracked, ignored
//   --history                the whole git history: secrets, name sweep, bloat
//   --package <stageDir>     classify and audit an already staged package tree
//   --package-build <dir>    stage the web package in <dir> the way
//                            make-package.mjs does (vite build into the scratch
//                            dir, never the repo's dist/), then --package it
//
// The LIVE server is the other half of this check: scripts/live-files-scan.mjs
// and the one-shot job ops/live-files-scan.compose.json. They share the idea
// (rules -> KNOWN / UNKNOWN / SUSPICIOUS), not code, because the job must carry
// one self-contained script.
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
// TEST HOOK  UFS_BLIND=D-PHP-EVAL,S-NAMED  turns those detectors off (and J-VARNAME / J-TESTZONE, the two secret-judging rules). Only
// unknown-files-test.mjs sets it: it is how the suite proves each detector is
// load-bearing (blind it, watch the planted finding stop being reported, watch
// the test's assertion fail).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
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
  err(`cannot read the manifest ${MANIFEST_PATH}: ${e.message}`); process.exit(2)
}
const RULES = (MAN.rules || []).map((r) => ({ ...r, test: globsRe(r.glob) }))
const ZONES = (MAN.zones || []).map((z) => ({ zone: z.zone, test: globsRe(z.glob) }))
const zoneOf = (p) => (ZONES.find((z) => z.test(p)) || { zone: 'other' }).zone
const ALLOW = (MAN.content_allow || []).map((a) => ({ ...a, test: globsRe(a.path) }))
const ACK = (MAN.acknowledged || []).map((a) => ({ ...a, test: globsRe(a.path) }))
const PLACEHOLDERS = new Set((MAN.secret_placeholders || []).map((s) => String(s)))
const EXEC_OK = (MAN.executables || []).map(globRe)
const TEST_ZONE = (MAN.test_credential_globs || []).map(globRe)
const NONASCII_OK = (MAN.name_nonascii_ok || []).map(globRe)
// Hosts that shipped (web / client zone) script may talk to or load from. Anything else injected or beaconed to is a skimmer shape.
const OK_HOSTS = (MAN.shipped_js_hosts && MAN.shipped_js_hosts.length ? MAN.shipped_js_hosts : ['sporta.com.kw']).map((h) => esc(h)).join('|')
const HOST_NOT_OURS = `https?:\\/\\/(?!(?:www\\.)?(?:${OK_HOSTS})\\b)`
const JS_FOREIGN_SCRIPT = new RegExp(`createElement\\s*\\(\\s*['"]script['"]\\s*\\)[\\s\\S]{0,300}?\\.src\\s*=\\s*['"\`]${HOST_NOT_OURS}|<script\\b[^>]*\\bsrc\\s*=\\s*['"]${HOST_NOT_OURS}`, 'gi')
const JS_FOREIGN_SEND = new RegExp(`(?:sendBeacon\\s*\\(|new\\s+Image\\s*\\(\\s*\\)\\s*\\.src\\s*=|\\bfetch\\s*\\(|\\.open\\s*\\(\\s*['"][A-Z]+['"]\\s*,)\\s*['"\`]${HOST_NOT_OURS}`, 'g')
const MCP_OK = new Set(MAN.mcp_servers_ok || [])

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
det('D-NUL-IN-TEXT', 'low', 'other', 'raw NUL byte inside a source or text file')
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
det('S-ENVLINE', 'high', 'secret', 'credential assigned an unquoted literal (env / yaml / ini style line)', { suspicious: true })
det('S-TEST-CRED', 'low', 'secret', 'literal test credential in a test, rig or fixture')
// added by the independent verification of 2026-11-04 (ops/FILES-SCAN.md, "Verifier's addendum"): shapes that the
// first set let through when they were planted on a path a rule already explained
det('D-HT-HANDLER', 'high', 'webshell-or-obfuscated-code', 'web-server handler override or auto_prepend_file (makes any file name run as PHP, or runs a file before every script)', { suspicious: true })
det('D-HT-REDIRECT', 'medium', 'webshell-or-obfuscated-code', 'RewriteRule / Redirect / ProxyPass that sends requests to a host that is not ours', { suspicious: true })
det('D-PHP-STREAM-INC', 'high', 'webshell-or-obfuscated-code', 'include / require of a data:, php:, phar:, expect: or remote stream', { suspicious: true })
det('D-PHP-CALLBACK-REQ', 'high', 'webshell-or-obfuscated-code', 'a callback chosen by the request (array_map, usort, call_user_func, preg_replace_callback ...)', { suspicious: true })
det('D-PHP-EXTRACT-REQ', 'high', 'webshell-or-obfuscated-code', 'extract() / parse_str() of request data into variables', { suspicious: true })
det('D-PHP-DROPPER', 'high', 'webshell-or-obfuscated-code', 'PHP that reads request data and writes a .php file', { suspicious: true })
det('D-JS-DYNEXEC', 'high', 'webshell-or-obfuscated-code', 'string execution without eval: setTimeout(decoded), constructor chain, import(data:)', { suspicious: true })
det('D-JS-FOREIGN', 'high', 'webshell-or-obfuscated-code', 'script injected from, or data sent to, a host the manifest does not list (skimmer shape)', { suspicious: true })
det('D-BIDI-IN-SOURCE', 'high', 'webshell-or-obfuscated-code', 'bidi override or zero-width character inside shipped source (Trojan Source)', { suspicious: true })
det('D-CONFIG-EXEC', 'high', 'other', 'configuration file that runs commands: npm install hooks, Claude hooks, an extra MCP server, an auto-run task, an external rewrite', { suspicious: true })
det('S-NPM', 'high', 'secret', 'npm access token', { suspicious: true })
det('S-SENDGRID', 'high', 'secret', 'SendGrid API key', { suspicious: true })
det('S-TELEGRAM', 'high', 'secret', 'Telegram bot token', { suspicious: true })
det('S-DOSHOP', 'high', 'secret', 'DigitalOcean or Shopify access token', { suspicious: true })
det('D-PACKAGE-AUDIT', 'medium', 'other', 'file-audit.mjs refuses the staged package')
det('D-SENSITIVE-DATA', 'medium', 'other', 'business-confidential data in a public repository')

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
    files.set(name, { path: name, badUtf8, raw: rawName, ...o })
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
    f.abs = f.badUtf8 ? Buffer.concat([Buffer.from(ROOT + path.sep), f.raw]) : path.join(ROOT, f.path)
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
  { id: 'S-PRIVKEY', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----([\s\S]{0,4000}?)(?:-----END|$)/g, group: 1, none: true },
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
  // provider formats the first table lacked (the verifier's pickaxe over the whole history found none of them committed)
  { id: 'S-NPM', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'S-SENDGRID', re: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g },
  { id: 'S-TELEGRAM', re: /\b\d{8,10}:AA[A-Za-z0-9_\-]{33}\b/g },
  { id: 'S-DOSHOP', re: /\bdop_v1_[a-f0-9]{64}\b|\bshp(?:at|ss|ca|pa)_[a-f0-9]{32}\b/g },
  { id: 'S-ENVLINE', re: /^[ \t]*(?:export[ \t]+)?([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|APIKEY|PRIVATE_?KEY|CLIENT_?SECRET|ENCRP_?KEY|RESOURCE_?KEY|CRON_?KEY|DB_?PASS)[A-Za-z0-9_]*)[ \t]*[=:][ \t]*([^\s'"`#$<{(\[][^\s#'"`]{7,})/gm, group: 2, keyGroup: 1 },
  { id: 'S-NAMED', re: new RegExp(`(?:^|[^A-Za-z0-9_])([A-Za-z0-9_]*(?:${KEYWORDS})[A-Za-z0-9_]*)['"\\]]?\\s*(?:=>|:=|:|=)\\s*(['"\`])([^'"\`\\n\\r]{6,200})\\2`, 'gi'), group: 3, keyGroup: 1 },
]
const PLACEHOLDER_RE = /(^|[^a-z])(your|change[-_ ]?me|changeme|replace|insert|example|placeholder|sample|dummy|fake|redacted|todo|tbd|not[-_ ]?set|none|null|undefined|xxxx+|\*\*\*+|\.\.\.|lorem|foo|bar|baz|test|demo|sandbox|secret|password|token|apikey|api[-_]key)([^a-z]|$)/i
const CODEY_RE = /^\s*[$%<{(\[]|\$\{|\$_|\$[A-Za-z_]|getenv|process\.env|import\.meta|\)\s*$|\([^)]*\)$|=>|\bfunction\b|%s|\{\{|^[A-Za-z_]+\(|\.\.\.|^https?:\/\/[^@]*$/
function judge(value, ctx) {
  const v = value.trim()
  if (PLACEHOLDERS.has(v)) return { verdict: 'placeholder', why: 'documented placeholder' }
  if (v.length < 8) return { verdict: 'placeholder', why: 'too short to be a secret' }
  // A literal that embeds the NAME of a configuration variable ("the-value-of-ALMUHALLAB_LEAD_SECRET") says where the
  // secret lives; it is not the secret. This was the history scan's only "real" hit that could have been live, and it
  // was a sample payload. The rest of the literal must be lowercase words (a random mixed-case string is not excused).
  if (on('J-VARNAME')) {
    const nm = v.match(/[A-Z]{3,}(?:_[A-Z0-9]{2,})+/)
    if (nm && nm[0].length >= 8) {
      const rest = v.replace(nm[0], '')
      if (!/[A-Z]/.test(rest) && /^[a-z0-9 ._:\/-]*$/.test(rest)) return { verdict: 'placeholder', why: 'names a configuration variable' }
    }
  }
  if (CODEY_RE.test(v) && !/^[A-Za-z0-9+\/=_\-]{32,}$/.test(v)) return { verdict: 'placeholder', why: 'expression, variable or URL, not a literal' }
  if (/^(?:\/|\.{1,2}\/|~\/|[A-Za-z]:\\)[\w.\/\\@+-]+$/.test(v)) return { verdict: 'placeholder', why: 'a file path' }
  if (/^(?:\/[^\s\/]|\^|\(\?|\\[dwsb.(\[])/.test(v) && /[\\^$()\[\]|]/.test(v)) return { verdict: 'placeholder', why: 'a regular expression' }
  if (/^--[\w-]+$/.test(v)) return { verdict: 'placeholder', why: 'a CSS custom property name' }
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(v)) return { verdict: 'placeholder', why: 'an email address, not a password' }
  // hyphenated words are a fixture in a test ("a-long-enough-test-token") but a human-chosen shared secret anywhere else
  if (ctx?.testZone && /^[a-z]{1,10}(?:[-_][a-z0-9]{1,10}){2,}$/i.test(v) && !/\d{3}/.test(v)) return { verdict: 'placeholder', why: 'hyphenated words in a test' }
  if (/^(.)\1+$/.test(v) || /^(0123456789|abcdefghij|12345678)/i.test(v)) return { verdict: 'placeholder', why: 'repeated or sequential characters' }
  const h = entropy(v)
  if (PLACEHOLDER_RE.test(v) && h < 4.2) return { verdict: 'placeholder', why: 'placeholder wording' }
  if (/^[a-z][a-z \-_]{7,}$/i.test(v) && h < 3.6) return { verdict: 'placeholder', why: 'plain words' }
  if (/\s/.test(v) && (v.length < 40 || v.split(/\s+/).length >= 3)) return { verdict: 'placeholder', why: 'prose' }
  const inTest = ctx?.testZone
  // A test folder excuses a fixture, not any random-looking literal: a real 24-character password pasted into
  // scripts/ or ops/ used to be filed as a "test credential" (low, never blocking). Mixed-case alphanumeric with
  // high entropy and no fixture wording is reported as probable instead.
  if (on('J-TESTZONE') && inTest && v.length >= 20 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && h >= 4.0 && !/^(canary|test|fake|dummy|sample|mock|race-|pool-|xss-|rdp-|sandbox)/i.test(v))
    return { verdict: 'probable', why: `mixed-case alphanumeric literal, entropy ${h.toFixed(1)}, ${v.length} characters, in a test zone: random-looking, not waved through as a fixture` }
  if (inTest && (!(v.length >= 32 && h >= 4.2) || /^(canary|test|fake|dummy|sample|mock|race-|pool-|xss-|rdp-|sandbox)/i.test(v))) return { verdict: 'test', why: 'literal in a test / rig / fixture' }
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
      if (!p.none && /EXAMPLE|XXXXXXXX/i.test(value || '') && !p.keyGroup) { hits.push({ id: p.id, verdict: 'placeholder', line: 0 }); continue }
      if (!p.none && value === undefined) continue
      let v
      if (p.none) {
        // a header with a short or self-declared fake body is a fixture, not a key
        const body = (m[p.group] || '').replace(/[^A-Za-z0-9+\/=]/g, '')
        v = body.length < 100 || /fake|example|not.?a.?real|dummy|placeholder/i.test(m[p.group] || '')
          ? { verdict: ctx?.testZone ? 'test' : 'placeholder', why: 'private-key header with a short or fake body' }
          : { verdict: 'real', why: 'a private key block exists' }
      }
      else if (p.id === 'S-NAMED' || p.id === 'S-ENVLINE') v = judge(value, ctx)
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
  // PHP by name, or by content in a file whose name says it is something else (a shell called logo.jpg).
  // A script that merely CONTAINS the text "<?php" (a test writing a fixture, this very tool) is not PHP.
  const notPhpFamily = JS_EXT.test(p) || MARKUP_EXT.test(p) || SH_EXT.test(p) || PY_EXT.test(p) || DOC_EXT.test(p)
  const isPhp = phpName || (!notPhpFamily && /<\?php/.test(text))
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
    hit('D-PHP-EXEC', ev(/(?<![\w$>:])(?<!function\s+)(?:system|exec|passthru|shell_exec|popen|proc_open|pcntl_exec)\s*\(/g), { severity: zone === 'web' ? 'high' : 'medium' })
    hit('D-PHP-EXEC', ev(/`[^`\n]{2,120}`(?=\s*;)/g), { severity: 'medium' })
    hit('D-PHP-USERINC', ev(/\b(?:include|require)(?:_once)?\s*\(?\s*\$_(?:GET|POST|REQUEST|COOKIE)|\b(?:file_put_contents|fwrite|fputs|move_uploaded_file|copy|unlink|rename)\s*\([^;]{0,160}\$_(?:GET|POST|REQUEST|COOKIE|FILES)\b/g))
    hit('D-PHP-VARFUNC', ev(/(?<![\w>:\-])\$[A-Za-z_]\w*\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE|SERVER)\b|@?\$_(?:GET|POST|REQUEST|COOKIE)\s*\[[^\]]*\]\s*\(/g))
    hit('D-CHR-BUILD', ev(/(?:chr\s*\(\s*\d+\s*\)\s*\.\s*){6,}/g))
    // ---- shapes the first set let through (verifier's plants, 2026-11-04)
    hit('D-PHP-STREAM-INC', ev(/\b(?:include|require)(?:_once)?\s*\(?\s*['"](?:data|php|phar|expect|zip|glob|ftp|https?):/gi))
    hit('D-PHP-CALLBACK-REQ', ev(/\b(?:array_map|call_user_func(?:_array)?|register_shutdown_function|register_tick_function|iterator_apply|forward_static_call(?:_array)?|preg_replace_callback(?:_array)?)\s*\(\s*(?:@\s*)?\$_(?:GET|POST|REQUEST|COOKIE|SERVER)\b|\b(?:usort|uasort|uksort|array_walk(?:_recursive)?|array_filter|array_reduce)\s*\([^,;]{1,80},\s*@?\$_(?:GET|POST|REQUEST|COOKIE)\b|\bpreg_replace_callback\s*\(\s*[^,;]{1,80},\s*@?\$_(?:GET|POST|REQUEST|COOKIE)\b/g))
    hit('D-PHP-VARFUNC', ev(/\(\s*@?\$_(?:GET|POST|REQUEST|COOKIE)\s*\[[^\]]*\]\s*\)\s*\(|\$[A-Za-z_]\w*\s*\(\s*(?:file_get_contents|stream_get_contents|fgets|fread)\s*\([^)]{0,40}php:\/\/input|\$[A-Za-z_]\w*\s*\(\s*(?:getallheaders|apache_request_headers)\s*\(\s*\)\s*\[/g))
    hit('D-PHP-EXTRACT-REQ', ev(/\b(?:extract|parse_str)\s*\(\s*@?\$_(?:GET|POST|REQUEST|COOKIE)\b/g))
    // a dropper: the file reads the request (or stdin) AND writes a literal .php path
    if (/\$_(?:GET|POST|REQUEST|COOKIE|FILES)\b|php:\/\/input|getallheaders\s*\(/.test(text))
      hit('D-PHP-DROPPER', ev(/\b(?:file_put_contents|fopen|fwrite|rename|copy)\s*\(\s*['"][^'"\n]*\.(?:php\d?|phtml|phar|inc)['"]/gi))
  }
  // ---- Apache / PHP configuration: a handler override makes any file name run as PHP; auto_prepend_file runs a file first
  if (/(^|\/)\.htaccess$|\.ini$/i.test(p)) {
    hit('D-HT-HANDLER', ev(/^\s*(?:AddHandler\s|AddType\s+application\/x-httpd-php|SetHandler\s+(?!none\b)|php_flag\s+engine\s+on|php_(?:value|flag)\s+auto_(?:prepend|append)_file|auto_(?:prepend|append)_file\s*=)/gim))
    if (/\.htaccess$/i.test(p)) hit('D-HT-REDIRECT', ev(/^\s*(?:RewriteRule\s+\S+\s+https?:\/\/(?!www\.sporta\.com\.kw)\S+|Redirect(?:Match)?\s+(?:\d+\s+)?\S+\s+https?:\/\/(?!www\.sporta\.com\.kw)\S+|ProxyPass(?:Match)?\s)/gim))
  }
  // ---- shipped source: bidi override / zero-width characters make code read differently from what it does
  // (U+202A-202E and the zero-width set only: the isolates U+2066-2069 and the marks U+200E/F are ordinary Arabic typography)
  if ((zone === 'web' || zone === 'client') && (isPhp || isJs)) {
    // evidence is printed as code points: a raw right-to-left override in a report would garble the report itself
    const bd = []
    let n = 0
    for (const m of text.matchAll(/[\u202A-\u202E\u200B\u2060\uFEFF]/g)) { n++; if (bd.length < 3) bd.push(`U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} @${lineOf(text, m.index)}`) }
    if (n) emit('D-BIDI-IN-SOURCE', p, `${n} hit(s): ${bd.join(', ')}${n > bd.length ? ` (+${n - bd.length} more)` : ''}`, { count: n, confidence: 'high' })
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
      // string execution that does not say eval, and the two shapes of a card skimmer (verifier's plants, 2026-11-04)
      hit('D-JS-DYNEXEC', ev(/\b(?:setTimeout|setInterval)\s*\(\s*(?:atob|unescape|String\.fromCharCode|decodeURIComponent)\s*\(|\.constructor\s*\.\s*constructor\s*\(|\[\s*['"]constructor['"]\s*\]\s*\[\s*['"]constructor['"]\s*\]|\bimport\s*\(\s*['"`]data:|\b(?:window|self|globalThis)\s*\[\s*['"][a-z]{2,5}['"]\s*\+\s*['"][a-z]{2,5}['"]\s*\]\s*\(/g))
      hit('D-JS-FOREIGN', ev(JS_FOREIGN_SCRIPT))
      if (!MARKUP_EXT.test(p)) hit('D-JS-FOREIGN', ev(JS_FOREIGN_SEND))
    }
    hit('D-JS-DECODE', ev(/\beval\s*\(\s*(?:atob|unescape|String\.fromCharCode|decodeURIComponent)\s*\(|\bFunction\s*\(\s*(?:atob|unescape)\s*\(/g))
  }
  if (/\.svg$/i.test(p)) hit('D-SVG-ACTIVE', ev(/<script\b|\son[a-z]+\s*=|javascript:/gi))
  // download-and-run: in shell, and (new) in the Node / Python scripts the Claude settings allow to run unprompted (`node scripts/*`)
  if (SH_EXT.test(p) || /\.(m?js|cjs|py)$/i.test(p)) hit('D-SHELL-PIPE', ev(/\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba)?sh\b|\b(?:ba|z)?sh\s+(?:-c\s+)?["']?(?:\$\(|<\()\s*(?:curl|wget)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b|\bsource\s+<\(\s*(?:curl|wget)\b|\b(?:exec|eval)\s*\(\s*(?:urllib|requests)[^\n]{0,160}\.(?:read|text|content)\s*\(/g))
  if (/\.sql$/i.test(p)) {
    const ins = (text.match(/^INSERT INTO\s+`?(\w+)`?/gim) || [])
    const sensitive = ins.filter((s) => /`?(orders?|customers?|admin_users?|users?|sessions?|payments?|addresses|tickets?|support|subscribers?|tokens?)`?$/i.test(s.replace(/^INSERT INTO\s+/i, ''))).length
    if (/^-- (?:MySQL dump \d|Dump completed on|phpMyAdmin SQL Dump|Server version:\s)/im.test(text) || sensitive > 3)
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
const PHP_OPEN = Buffer.from('<?php'), EVAL_B = Buffer.from('eval(')
// "<?=" is 3 bytes: it occurs by chance in about one random 2 MB image in ten. Only the shapes a payload takes count.
const SHORT_TAG = /<\?=\s*(?:\$|`|(?:system|exec|eval|passthru|shell_exec|base64_decode|file_put_contents)\b)/
// extension -> what sniffBinary() must say
const EXT_KIND = [[/\.png$/i, 'PNG image'], [/\.jpe?g$/i, 'JPEG image'], [/\.gif$/i, 'GIF image'], [/\.webp$/i, 'WebP image'], [/\.ico$/i, 'ICO image'], [/\.woff2?$/i, 'web font'], [/\.pdf$/i, 'PDF document'], [/\.zip$/i, 'zip archive']]

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

// Configuration files that RUN things. The first set looked at their names only, so an install hook added to the
// existing package.json, a hook in .claude/settings.json or one more MCP server was "known" by rule and unflagged.
// `npm ci` (which vps-deploy.mjs runs) executes preinstall / install / postinstall / prepare of the root package.
const NPM_INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack']
function configExec(p, text) {
  const base = path.posix.basename(p)
  const interesting = base === 'package.json' || base === '.mcp.json' || base === 'vercel.json' || /(^|\/)\.claude\/settings(\.local)?\.json$/.test(p) || /(^|\/)\.vscode\/tasks\.json$/.test(p)
  if (!interesting) return
  let j
  try { j = JSON.parse(text.replace(/^\uFEFF/, '').replace(/^\s*\/\/.*$/gm, '')) } catch { return }
  if (!j || typeof j !== 'object') return
  const say = (what, extra = {}) => emit('D-CONFIG-EXEC', p, what, { confidence: 'high', ...extra })
  if (base === 'package.json') {
    const s = j.scripts && typeof j.scripts === 'object' ? j.scripts : {}
    const hooks = NPM_INSTALL_HOOKS.filter((k) => s[k])
    if (hooks.length) say(`npm install-time script(s) ${hooks.join(', ')}: they run on every npm ci / npm install, including the one vps-deploy.mjs runs`)
    for (const sect of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const odd = Object.entries(j[sect] || {}).filter(([, v]) => /^(?:git(?:\+\w+)?|https?|github|file|link):|^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(String(v)))
      if (odd.length) say(`${sect} from a URL or path instead of the registry: ${odd.slice(0, 3).map(([k]) => k).join(', ')}`, { severity: 'medium' })
    }
  }
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(p)) {
    if (j.hooks && Object.keys(j.hooks).length) say(`hooks (${Object.keys(j.hooks).join(', ')}) run shell commands on session events, unprompted`)
    if (j.apiKeyHelper || j.awsAuthRefresh || j.awsCredentialExport) say('a credential helper command runs on every session')
    if (j.env && Object.keys(j.env).some((k) => /^(ANTHROPIC_BASE_URL|HTTPS?_PROXY|NODE_OPTIONS|LD_PRELOAD|BASH_ENV)$/.test(k))) say('an environment override that can redirect traffic or inject code', { severity: 'medium' })
  }
  if (base === '.mcp.json') {
    const extra = Object.keys(j.mcpServers || {}).filter((k) => !MCP_OK.has(k))
    if (extra.length) say(`MCP server(s) not in ops/known-files.json "mcp_servers_ok": ${extra.join(', ')} (an MCP server is a program the session starts)`)
  }
  if (base === 'vercel.json') {
    const out = [...(j.rewrites || []), ...(j.redirects || [])].filter((r) => /^https?:\/\/(?!www\.sporta\.com\.kw)/i.test(String(r?.destination || '')))
    if (out.length) say(`${out.length} rewrite/redirect(s) to a host that is not ours`, { severity: 'medium' })
  }
  if (/(^|\/)\.vscode\/tasks\.json$/.test(p) && /"runOn"\s*:\s*"folderOpen"/.test(text)) say('a task that runs when the folder is opened')
}

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
    else if (/[^\x20-\x7e]/.test(p) && !NONASCII_OK.some((r) => r.test(p)))
      // a Cyrillic "а", a right-to-left override, a zero-width space or a decomposed accent makes a name that reads as another file;
      // the repository has no non-ASCII path, so any one is reported (ops/known-files.json "name_nonascii_ok" lists the exceptions)
      emit('D-NAME-ODD', p, `non-ASCII character(s) in the name: ${[...p].filter((c) => c.codePointAt(0) > 126).slice(0, 4).map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')} (a lookalike, bidi override, zero-width or decomposed character)`, { confidence: 'high' })
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
    // KNET's plug-in download (KNET-IPAYPIPE-CHECK.md D10): keystore.bin + resource.cgn/.cgz decrypt to the
    // Tranportal id, password and resource key with literals that are the same in every copy of the plug-in.
    if (/^keystore\.bin$|\.cg[nz]$/i.test(base))
      emit('D-KEYFILE', p, 'KNET plug-in credentials file (keystore.bin / resource.cgn / .cgz)', { confidence: 'high' })
    if (/(^|[-_. ])(bak|old|orig|swp|tmp|temp|backup|copy|final|untitled|draft|save|rej|sav|new|scratch|wip|junk)([-_. ]|$)|~$|\(\d+\)|\.swp$|\.DS_Store$|^_[A-Za-z0-9]/i.test(base))
      emit('D-BACKUP-NAME', p, 'name suggests a copy, backup or scratch file (leading underscore, bak/old/tmp/copy/final/wip ...)', { confidence: 'low' })
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
    if (buf && !f.isLink && f.size > 6e6 && !PHP_EXT.test(p) && !/\.(md|txt)$/i.test(p)) {
      // the scan reads the first 6 MB only: a payload appended behind a big photo must not hide past that
      try {
        const fd2 = fs.openSync(f.abs, 'r'), tail = Buffer.alloc(1 << 20)
        fs.readSync(fd2, tail, 0, tail.length, f.size - tail.length)
        fs.closeSync(fd2)
        if (tail.includes(PHP_OPEN) || SHORT_TAG.test(tail.toString('latin1'))) emit('D-POLYGLOT', p, `${kb(f.size)} file with a PHP open tag in its last MiB (past the 6 MB the scan reads in full)`, { confidence: 'high' })
      } catch { /* unreadable tail: the first-6-MB checks stand */ }
    }
    if (buf && !f.isLink) {
      const sniff = sniffBinary(buf)
      const looksBinary = buf.subarray(0, 8192).includes(0)
      f.type = sniff
      if (f.size >= 512 && f.size <= 6e6 && !f.ignored && !f.badUtf8) {
        const h = sha256(buf)
        f.hash = h
        if (!dupes.has(h)) dupes.set(h, [])
        dupes.get(h).push(p)
      }
      const codeExt = JS_EXT.test(p) || PHP_EXT.test(p) || SH_EXT.test(p) || PY_EXT.test(p) || MARKUP_EXT.test(p) || DOC_EXT.test(p)
      // A name that promises an image or font must be one: a decoy keeps the label and changes the bytes.
      const want = EXT_KIND.find(([re]) => re.test(p))
      if (want && sniff !== want[1] && !(want[1] === 'JPEG image' && sniff === 'JPEG image') && f.size > 0)
        emit('D-BINARY-UNK', p, `extension says ${want[1]} but the bytes are: ${sniff || (looksBinary ? 'unrecognised binary' : 'text')}`, { confidence: 'high' })
      let binaryHandled = false
      if ((looksBinary && !(codeExt && !sniff)) || (sniff && !codeExt)) {
        binaryHandled = true
        if (!BINARY_OK.test(sniff) && !rule?.binary_ok) {
          if (/archive/.test(sniff) || ARCHIVE_EXT.test(p)) {
            if (!rule?.archive_ok) emit('D-ARCHIVE', p, `${sniff || 'archive by extension'}, ${kb(f.size)}`, { confidence: 'high' })
          } else if (!ARCHIVE_EXT.test(p) && !want) {
            emit('D-BINARY-UNK', p, `${sniff || 'unrecognised binary content'}, ${kb(f.size)}`, { confidence: sniff ? 'high' : 'medium' })
          }
        }
        if (!PHP_EXT.test(p) && !/\.(md|txt)$/i.test(p) && (buf.includes(PHP_OPEN) || SHORT_TAG.test(buf.toString('latin1'))))
          emit('D-POLYGLOT', p, `${sniff || 'binary'} file contains a PHP open tag`, { confidence: 'high' })
        if ((IMG_EXT.test(p) || FONT_EXT.test(p)) && buf.includes(EVAL_B)) emit('D-POLYGLOT', p, `${sniff || 'binary'} file contains eval(`, { confidence: 'medium' })
        if (/zip/.test(sniff)) await inspectZip(f, buf, out)
      }
      if (!binaryHandled) {
        let body = buf
        if (looksBinary) {
          emit('D-NUL-IN-TEXT', p, `a source/text file with raw NUL byte(s) (first at offset ${buf.indexOf(0)}): git treats it as binary and most scanners stop reading at it`, { confidence: 'high' })
          body = Buffer.from(buf.filter((x) => x !== 0))
        }
        const cd = contentDetect(f, body, zone)
        if (cd && cd.text !== undefined) {
          configExec(p, cd.text)
          if (!MAN.no_secret_scan?.some((g) => globRe(g).test(p))) {
            const hits = scanSecrets(cd.text, { testZone: isTestZone(p) || !!rule?.test_values })
            noteSecrets(f, hits, out, /[\w.+-]+@sporta\.com\.kw/i.test(cd.text))
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
  // ---------- test credentials: one finding per class, not one per file
  for (const [addr, label] of [[true, 'also name an @sporta.com.kw address (REPO-SCAN secrets-7: confirm the live password for that address is different)'], [false, 'name no real address']]) {
    const group = (out.testCreds || []).filter((x) => x.realAddr === addr)
    if (!group.length) continue
    emit('S-TEST-CRED', `test credentials in ${group.length} file(s)`, `${group.reduce((n, x) => n + x.count, 0)} literal(s); the files ${label}: ${group.map((x) => `${x.path} x${x.count}`).slice(0, 14).join(', ')}${group.length > 14 ? ' ...' : ''}`, { count: group.length, severity: addr ? 'medium' : 'low', confidence: 'medium', file: group[0].path, action: 'keep; none may equal a live credential' })
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
  // who mentions each side tree by name (a plain text search: tokens in the reference index need a file extension)
  const treeRefs = new Map((MAN.trees || []).map((t) => [t.dir, new Map()]))
  if (treeRefs.size) {
    for (const f of files.values()) {
      if (!f.present || f.isLink || f.dir || f.ignored || f.size === 0 || f.size > 1.5e6 || IMG_EXT.test(f.path) || FONT_EXT.test(f.path) || ARCHIVE_EXT.test(f.path)) continue
      if (RULES.some((r) => r.refsource === false && r.test(f.path))) continue
      let t
      try { const b = fs.readFileSync(f.abs); if (b.subarray(0, 4096).includes(0)) continue; t = b.toString('utf8') } catch { continue }
      for (const [dir, m] of treeRefs) if (!f.path.startsWith(dir + '/') && t.includes(dir + '/')) m.set(f.path, CODE_REF_EXT.test(f.path) ? 'code' : 'doc')
    }
  }
  for (const tree of MAN.trees || []) {
    const mine = [...files.values()].filter((f) => f.present && f.path.startsWith(tree.dir + '/'))
    const refs = treeRefs.get(tree.dir)
    let same = 0, diff = 0
    for (const f of mine) {
      const twin = files.get('sporta-web/public/' + path.posix.basename(f.path))
      if (twin?.present && f.hash) (sha256(fs.readFileSync(twin.abs)) === f.hash ? same++ : diff++)
    }
    const code = [...refs].filter(([, k]) => k === 'code').map(([r]) => r), docs = [...refs].filter(([, k]) => k === 'doc').map(([r]) => r)
    out.trees[tree.dir] = { what: tree.what, files: mine.length, bytes: mine.reduce((n, f) => n + f.size, 0), referenced_from: [...code.slice(0, 8).map((r) => `${r} (code)`), ...docs.slice(0, 4).map((r) => `${r} (doc)`)], code_refs: code.length, doc_refs: docs.length, twins_identical: same, twins_differ: diff, ships: tree.ships }
  }
  const all = [...files.values()]
  out.testCreds = out.testCreds || []
  out.unusedRules = RULES.filter((r) => !r.optional && !out.byRule.has(r.id)).map((r) => r.id)
  out.counts = {
    tracked: tracked.length, tracked_present: tracked.filter((f) => f.present).length, tracked_missing_on_disk: tracked.filter((f) => !f.present).length,
    untracked: all.filter((f) => !f.tracked && !f.ignored).length, ignored_entries: all.filter((f) => f.ignored).length,
    ignored_dirs: all.filter((f) => f.dir).length,
    scanned: all.filter((f) => f.present && !f.dir).length,
    known_by_rule: all.filter((f) => f.status === 'known' && f.rule).length,
    known_by_reference: all.filter((f) => f.status === 'known' && !f.rule).length,
    unknown: all.filter((f) => f.status === 'unknown').length,
    named_only_in_docs: all.filter((f) => f.status === 'doc-only').length,
    entries: all.length,
  }
  out.fileList = all
  return out
}
function bump(m, rule, size) { const e = m.get(rule.id) || { id: rule.id, purpose: rule.purpose, owner: rule.owner, files: 0, bytes: 0, web: !!rule.web }; if (size !== 0 || true) { e.files++; e.bytes += size } m.set(rule.id, e) }

// Secret hits become ONE finding per (file, detector, verdict): the lines are
// listed, the values never.
function noteSecrets(f, hits, out, realAddr = false) {
  const real = hits.filter((h) => h.verdict !== 'placeholder')
  if (!real.length) return
  const by = new Map()
  for (const h of real) { const k = h.id + '|' + h.verdict; (by.get(k) || by.set(k, []).get(k)).push(h) }
  for (const [k, list] of by) {
    const [id, verdict] = k.split('|')
    const lines = list.slice(0, 6).map((h) => `${h.key ? h.key + ' ' : ''}@${h.line} ${h.masked}`).join('; ')
    if (verdict === 'test') {
      ;(out.testCreds ||= []).push({ path: f.path, count: list.length, realAddr, lines })
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
    if (/(^|\/)(config\.php|\.env.*|.*\.(pem|key|p12|sql\.gz|cgn|cgz)|keystore\.bin|\.cbk_token\.json|\.htpasswd)$/i.test(e.name) && !/config\.example\.php$/.test(e.name)) rec.names_of_note.push(e.name)
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

// ===================================================================== PACKAGE
// Stage the web package the way make-package.mjs does, but ONLY into a scratch
// directory: the repo's dist/ and SPORTA-GO-LIVE.zip are never touched. The
// build is `vite build --outDir <scratch>` (the vite config writes nowhere
// else), then the same copy steps make-package/bundle-php/sw-precache perform.
const PKG_SKIP = new Set(['config.php', 'README.md', '.cbk_token.json'])
const BUNDLES = [['php-knet', 'knet'], ['php-cbk', 'pay'], ['php-store', 'api']]
function cpDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name)
    if (filter && !filter(s)) continue
    if (e.isDirectory()) cpDir(s, d, filter)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}
function buildStage(stage) {
  if (fs.existsSync(stage) && fs.readdirSync(stage).length) { err(`${stage} is not empty: pass a new or empty directory`); process.exit(2) }
  const dist = path.join(stage, '.vite-out'), pub = path.join(stage, 'public_html')
  fs.mkdirSync(pub, { recursive: true })
  err('staging: vite build into the scratch directory (this takes a while on a busy machine)')
  const vite = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js')
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir'], {
    cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VITE_PAY_BASE_URL: '', VITE_CBK_BASE_URL: '', VITE_PHP_API_URL: '' },
  })
  if (r.status !== 0) { err('vite build failed'); process.exit(2) }
  cpDir(dist, pub)
  fs.rmSync(dist, { recursive: true, force: true })
  for (const [from, to] of BUNDLES) cpDir(path.join(WEB, 'dropin', from), path.join(pub, to), (s) => !PKG_SKIP.has(path.basename(s)))
  // sw-precache writes dist/sw.js only; csp-hashes is hard-wired to the repo's dist/, so its one edit is repeated here
  spawnSync(process.execPath, [path.join(WEB, 'scripts', 'sw-precache.mjs'), pub], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'] })
  try {
    const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8')
    const hp = path.join(pub, '.htaccess'), ht = fs.readFileSync(hp, 'utf8')
    const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
      .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
    if (hashes.length) fs.writeFileSync(hp, ht.replace('__SCRIPT_HASHES__', hashes.join(' ')))
  } catch { /* the audit reports a missing .htaccess */ }
  for (const forbidden of ['knet/config.php', 'pay/config.php', 'api/config.php', '.env', '.env.deploy']) fs.rmSync(path.join(pub, forbidden), { force: true })
  const sql = path.join(stage, 'database-sql')
  fs.mkdirSync(sql, { recursive: true })
  fs.copyFileSync(path.join(WEB, 'dropin', 'php-store', 'install.mysql.sql'), path.join(sql, 'IMPORT-THIS-ONE.sql'))
  ;['schema.mysql', 'seed.mysql', 'brands.mysql', 'promo.mysql'].forEach((n, i) => fs.copyFileSync(path.join(WEB, 'dropin', 'php-store', n + '.sql'), path.join(sql, `${i + 1}-${n}.sql`)))
  fs.copyFileSync(path.join(WEB, 'scripts', 'mac-check.sh'), path.join(stage, 'sporta-mac-check.sh'))
  fs.writeFileSync(path.join(stage, 'README-FIRST.txt'), 'written by make-package.mjs (its text is a template inside that script; not reproduced here)\n')
}
async function scanPackage(stage) {
  const pub = fs.existsSync(path.join(stage, 'public_html')) ? path.join(stage, 'public_html') : stage
  const list = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const a = path.join(d, e.name)
      if (e.isDirectory()) walk(a)
      else if (e.isFile() || e.isSymbolicLink()) list.push(path.relative(stage, a).split(path.sep).join('/'))
    }
  })(stage)
  list.sort()
  const prules = (MAN.package_rules || []).map((r) => ({ ...r, test: globsRe(r.glob) }))
  const res = { stage, files: list.length, bytes: 0, known: 0, unknown: [], differs: [], by_rule: {}, findings_from: 0 }
  const before = findings.length
  for (const rel of list) {
    const abs = path.join(stage, rel)
    const st = fs.lstatSync(abs)
    res.bytes += st.size
    const inPub = rel.startsWith('public_html/') ? rel.slice('public_html/'.length) : (pub === stage ? rel : null)
    let rule = prules.find((r) => r.test(rel))
    let how = rule ? rule.id : ''
    let srcRel = ''
    // a file in public_html/api|knet|pay must be a dropin source file; any other root file must be a public/ file
    if (!rule && inPub !== null) {
      const top = inPub.split('/')[0]
      const map = BUNDLES.find(([, to]) => to === top)
      const src = map ? path.join(WEB, 'dropin', map[0], inPub.slice(top.length + 1)) : path.join(WEB, 'public', inPub)
      // bundle-php.mjs never copies these names, so a staged copy has no source even if the rig left one in dropin/
      if (!PKG_SKIP.has(path.basename(inPub)) && fs.existsSync(src) && fs.statSync(src).isFile()) {
        rule = { id: map ? 'PKG-BACKEND-SOURCE' : 'PKG-PUBLIC-SOURCE' }
        srcRel = path.relative(ROOT, src).split(path.sep).join('/')
        how = `${rule.id}: ${path.relative(ROOT, src)}`
        if (!(MAN.package_regenerated || []).some((g) => globRe(g).test(rel)) && sha256(fs.readFileSync(abs)) !== sha256(fs.readFileSync(src))) res.differs.push(`${rel} differs from ${path.relative(ROOT, src)}`)
      }
    }
    if (rule) { res.known++; res.by_rule[rule.id || how] = (res.by_rule[rule.id || how] || 0) + 1 }
    else { res.unknown.push(rel); emit('D-UNKNOWN', `package:${rel}`, `in the staged package, but no package rule and no source file in public/ or dropin/ (${kb(st.size)})`, { severity: 'high', confidence: 'high', file: rel }) }
    // the same content detectors as the tree
    if (st.size > 0 && st.size <= 6e6 && !st.isSymbolicLink()) {
      const buf = fs.readFileSync(abs)
      const fake = { path: srcRel || 'package/' + rel.replace(/^public_html\//, ''), size: st.size, zone: 'web' }
      const sniff = sniffBinary(buf)
      if (buf.subarray(0, 8192).includes(0) || sniff) {
        if (!PHP_EXT.test(rel) && (buf.includes(PHP_OPEN) || SHORT_TAG.test(buf.toString('latin1')))) emit('D-POLYGLOT', `package:${rel}`, `${sniff || 'binary'} file contains a PHP open tag`, { confidence: 'high', file: rel })
        if (sniff && !BINARY_OK.test(sniff) && !/archive/.test(sniff)) emit('D-BINARY-UNK', `package:${rel}`, `${sniff}, ${kb(st.size)}`, { confidence: 'high', file: rel })
      } else {
        const before2 = findings.length
        contentDetect(fake, buf, 'web')
        for (let i = before2; i < findings.length; i++) { findings[i].where = `package:${rel}`; findings[i].file = rel }
        const hits = scanSecrets(buf.toString('utf8'), { testZone: false }).filter((h) => h.verdict !== 'placeholder' && h.verdict !== 'test')
        if (hits.length) for (const h of hits.slice(0, 4)) emit(h.id, `package:${rel}`, `${h.verdict}: line ${h.line} ${h.key || ''} ${h.masked}`, { confidence: 'medium', file: rel })
      }
    }
    if (/(^|\/)(config\.php|\.env|\.env\.deploy|\.cbk_token\.json)$/.test(rel)) emit('D-ENVFILE', `package:${rel}`, 'credential file inside the staged package (file-audit.mjs forbids it)', { confidence: 'high', file: rel })
  }
  res.findings_from = findings.length - before
  // file-audit.mjs is the package's own audit: run it on the staged tree
  const fa = spawnSync(process.execPath, [path.join(WEB, 'scripts', 'file-audit.mjs'), pub], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const tail = (fa.stdout || '').trim().split('\n')
  const faOut = fa.stdout || ''
  const hi = (faOut.match(/--- HIGH ---\n([\s\S]*?)(?:\n--- |\n-{20,}|\n\d+ high)/) || [, ''])[1].split('\n').map((l) => l.trim()).filter(Boolean)
  res.file_audit = { exit: fa.status, summary: tail[tail.length - 1] || '', high: hi.slice(0, 12) }
  if (fa.status !== 0) emit('D-PACKAGE-AUDIT', 'package:file-audit', `file-audit.mjs exits ${fa.status} on the staged package (${res.file_audit.summary}), so make-package.mjs would refuse to write the zip and publish-ftps.mjs would refuse to upload: ${hi.slice(0, 8).join(' ')}`, { confidence: 'high', file: 'sporta-web/scripts/make-package.mjs', action: 'remove the source-path strings from the shipped files named, or teach file-audit.mjs to ignore comments' })
  return res
}

// ===================================================================== HISTORY
const HIST_SKIP_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|psd|woff2?|ttf|otf|eot|glb|gltf|bin|mp[34]|wav|ogg|mov|pdf|zip|gz|tgz|7z|rar|map|wasm|so|dll|exe|a|o|pyc|svgz|tiff?|heic|fbx|obj|unitypackage|meta|lock|dds|tga|psb|ai|webm|ttc)$/i
const HIST_SKIP_NAME = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$|(^|\/)(node_modules|dist)\//
const NAME_SWEEP = [
  ['config-or-env', /(^|\/)(config\.php|\.env(\.[^/]+)?|[^/]*\.env|\.htpasswd|\.netrc|\.npmrc|\.pgpass|\.my\.cnf|\.cbk_token[^/]*)$/i],
  ['key-or-cert', /\.(pem|key|p12|pfx|jks|keystore|ppk|p8|mobileprovision|cgn|cgz)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$|(^|\/)keystore\.bin$/i],
  ['database', /\.(sqlite3?|db|sql\.gz|dump|mdb)$/i],
  ['sql', /\.sql$/i],
  ['archive', /\.(zip|tar|tgz|gz|7z|rar|bz2|xz|jar|war|apk|ipa)$/i],
  ['backup-or-log', /\.(bak|old|orig|swp|log)$|~$/i],
]
async function streamLines(args, onLine) {
  const p = spawn('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
  const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity })
  for await (const l of rl) onLine(l)
  await new Promise((res) => p.on('close', res))
}
// Reads many blobs through ONE `git cat-file --batch`, never holding more than one in memory.
async function streamBlobs(shas, onBlob) {
  if (!shas.length) return
  const p = spawn('git', ['cat-file', '--batch'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] })
  p.stdin.on('error', () => {})
  p.stdin.end(shas.join('\n') + '\n')
  let acc = Buffer.alloc(0), cur = null
  for await (const chunk of p.stdout) {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk
    for (;;) {
      if (!cur) {
        const nl = acc.indexOf(10)
        if (nl < 0) break
        const hdr = acc.toString('latin1', 0, nl).split(' ')
        acc = acc.subarray(nl + 1)
        if (hdr[1] === 'missing') continue
        cur = { sha: hdr[0], size: Number(hdr[2]) }
      }
      if (acc.length < cur.size + 1) break
      onBlob(cur.sha, acc.subarray(0, cur.size))
      acc = acc.subarray(cur.size + 1); cur = null
    }
  }
  await new Promise((res) => p.on('close', res))
}
const iso = (ct) => new Date(Number(ct) * 1000).toISOString().slice(0, 10)
async function scanHistory() {
  initGit()
  if (!IS_GIT) { err('--history needs a git checkout'); process.exit(2) }
  const t0 = Date.now()
  const log = (m) => err(`[history ${Math.round((Date.now() - t0) / 1000)}s] ${m}`)
  const H = { notes: [] }
  // 1. every object
  const blobs = new Map()
  let nCommits = 0
  for (const l of git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize) %(objectsize:disk)']).toString().split('\n')) {
    const [sha, type, size, disk] = l.split(' ')
    if (type === 'blob') blobs.set(sha, { size: +size, disk: +disk })
    else if (type === 'commit') nCommits++
  }
  H.objects = { blobs: blobs.size, commits: nCommits, raw_bytes: [...blobs.values()].reduce((n, b) => n + b.size, 0), disk_bytes: [...blobs.values()].reduce((n, b) => n + b.disk, 0) }
  try { H.pack = git(['count-objects', '-vH']).toString().split('\n').filter((l) => /size-pack|in-pack|^count|^size:/.test(l)).join('; ') } catch { /* optional */ }
  log(`${blobs.size} blobs, ${nCommits} commits`)
  // 2. a path for every blob, and the commit that first carried it
  const pathOf = new Map()
  await streamLines(['rev-list', '--objects', '--all'], (l) => { const i = l.indexOf(' '); if (i > 0) { const s = l.slice(0, i); if (blobs.has(s) && !pathOf.has(s)) pathOf.set(s, l.slice(i + 1)) } })
  const first = new Map(), adds = [], versions = new Map()
  let cur = null
  const ZERO = /^0+$/
  await streamLines(['log', '--all', '--topo-order', '--reverse', '--root', '--no-renames', '--raw', '--no-abbrev', '--format=%x01%H%x09%ct%x09%an%x09%s'], (l) => {
    if (l.charCodeAt(0) === 1) { const [h, ct, an, ...s] = l.slice(1).split('\t'); cur = { commit: h, ct, author: an, subject: s.join('\t') }; return }
    if (l[0] !== ':' || !cur) return
    const tab = l.indexOf('\t')
    const [, , , nsha, st] = l.slice(1, tab).split(' ')
    const pth = l.slice(tab + 1)
    if (ZERO.test(nsha)) return
    if (!first.has(nsha)) first.set(nsha, { ...cur, path: pth })
    if (st === 'A') adds.push({ path: pth, sha: nsha, ...cur })
    if (/\.(png|jpe?g|webp|gif|pdf|zip|glb|mp[34]|wav)$/i.test(pth)) { let s = versions.get(pth); if (!s) versions.set(pth, (s = new Set())); s.add(nsha) }
  })
  log(`provenance for ${first.size} blobs`)
  // 3. what is still in HEAD
  const inHeadSha = new Set(), inHeadPath = new Set(); let headBytes = 0
  for (const l of git(['ls-tree', '-r', '-l', 'HEAD']).toString().split('\n')) {
    const m = l.match(/^\d+ blob ([0-9a-f]+)\s+(\S+)\t(.*)$/)
    if (m) { inHeadSha.add(m[1]); inHeadPath.add(m[3]); headBytes += Number(m[2]) || 0 }
  }
  H.head = { files: inHeadPath.size, bytes: headBytes }
  const where = (sha) => first.get(sha)?.path || pathOf.get(sha) || '(unknown path)'
  const origin = (sha) => { const f = first.get(sha); return f ? { commit: f.commit.slice(0, 8), date: iso(f.ct), subject: f.subject.slice(0, 90), author: f.author } : null }
  // 4. bloat: top blobs, directories, repeated binaries
  H.top_blobs = (!on('H-BLOAT') ? [] : [...blobs]).sort((a, b) => b[1].size - a[1].size).slice(0, 40).map(([sha, b]) => ({ sha: sha.slice(0, 10), size: b.size, disk: b.disk, path: where(sha), in_head: inHeadSha.has(sha), first: origin(sha) }))
  const dirAgg = new Map(), extAgg = new Map(), topAgg = new Map()
  for (const [sha, b] of blobs) {
    const p = where(sha), seg = p.split('/')
    // moved: the same path exists under sporta-web/ in HEAD (scripts/x became sporta-web/scripts/x), so this was the shop's own earlier layout, not another project
    const moved = seg.length > 1 && inHeadPath.has('sporta-web/' + p)
    const tl = topAgg.get(seg[0]) || { name: seg[0], is_dir: seg.length > 1, blobs: 0, raw: 0, disk: 0, in_head_blobs: 0, moved: 0 }
    if (moved) tl.moved++
    tl.blobs++; tl.raw += b.size; tl.disk += b.disk; if (inHeadSha.has(sha)) tl.in_head_blobs++
    topAgg.set(seg[0], tl)
    const key = seg.length > 2 ? seg.slice(0, 2).join('/') : seg[0]
    const d = dirAgg.get(key) || { dir: key, blobs: 0, raw: 0, disk: 0, in_head_blobs: 0, moved: 0 }
    if (moved) d.moved++
    d.blobs++; d.raw += b.size; d.disk += b.disk; if (inHeadSha.has(sha)) d.in_head_blobs++
    dirAgg.set(key, d)
    const ext = (path.posix.extname(p) || '(none)').toLowerCase()
    const e = extAgg.get(ext) || { ext, blobs: 0, raw: 0, disk: 0 }
    e.blobs++; e.raw += b.size; e.disk += b.disk; extAgg.set(ext, e)
  }
  H.by_dir = [...dirAgg.values()].sort((a, b) => b.disk - a.disk).slice(0, 25)
  H.top_level = [...topAgg.values()].sort((a, b) => b.disk - a.disk).slice(0, 30)
  H.by_ext = [...extAgg.values()].sort((a, b) => b.disk - a.disk).slice(0, 14)
  H.dead_weight = { blobs_not_in_head: [...blobs.keys()].filter((s) => !inHeadSha.has(s)).length, disk_bytes_not_in_head: [...blobs].filter(([s]) => !inHeadSha.has(s)).reduce((n, [, b]) => n + b.disk, 0) }
  H.repeated = [...versions].filter(([p, s]) => s.size >= 4 && /\.(png|jpe?g|webp|gif|pdf|zip|glb|mp[34]|wav)$/i.test(p))
    .map(([p, s]) => ({ path: p, versions: s.size, raw: [...s].reduce((n, x) => n + (blobs.get(x)?.size || 0), 0), in_head: inHeadPath.has(p) })).sort((a, b) => b.raw - a.raw).slice(0, 15)
  // 5. name sweep: sensitive-looking names ever ADDED
  const sweep = new Map()
  for (const a of (on('H-NAMES') ? adds : [])) {
    for (const [cls, re] of NAME_SWEEP) {
      if (!re.test(a.path) || /\.(example|sample|dist|template)(\.[a-z]+)?$/i.test(a.path)) continue
      const k = cls + '|' + a.path
      if (!sweep.has(k)) sweep.set(k, { class: cls, path: a.path, versions: 0, first_commit: a.commit.slice(0, 8), first_date: iso(a.ct), first_subject: a.subject.slice(0, 80), size: blobs.get(a.sha)?.size || 0, in_head: inHeadPath.has(a.path) })
      sweep.get(k).versions++
      break
    }
  }
  H.name_sweep = [...sweep.values()].sort((a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : a.first_date < b.first_date ? -1 : 1))
  H.name_sweep_counts = H.name_sweep.reduce((m, x) => ((m[x.class] = (m[x.class] || 0) + 1), m), {})
  // 6. contents: secrets in every text blob, once per blob
  const pick = (!on('H-SECRETS') ? [] : [...blobs]).filter(([sha, b]) => b.size > 0 && b.size <= 3e6 && !HIST_SKIP_EXT.test(where(sha)) && !HIST_SKIP_NAME.test(where(sha))).map(([sha]) => sha)
  H.scanned_blobs = pick.length
  H.scanned_bytes = pick.reduce((n, s) => n + blobs.get(s).size, 0)
  log(`scanning ${pick.length} text blobs (${kb(H.scanned_bytes)}) for secrets`)
  const groups = new Map(), summary = { placeholder: 0, test: 0, probable: 0, real: 0 }
  const dumps = []
  let done = 0
  await streamBlobs(pick, (sha, buf) => {
    if (++done % 2500 === 0) log(`${done}/${pick.length} blobs`)
    if (buf.subarray(0, 8192).includes(0)) return
    const text = buf.toString('utf8')
    const p = where(sha)
    if (/\.sql$/i.test(p)) {
      const ins = (text.match(/^INSERT INTO\s+`?(\w+)`?/gim) || [])
      const sens = ins.filter((s) => /`?(orders?|customers?|admin_users?|users?|sessions?|payments?|addresses|tickets?|support|subscribers?|tokens?)`?$/i.test(s.replace(/^INSERT INTO\s+/i, ''))).length
      if (/^-- (?:MySQL dump \d|Dump completed on|phpMyAdmin SQL Dump|Server version:\s)/im.test(text) || sens > 3) dumps.push({ path: p, sha: sha.slice(0, 10), inserts: ins.length, sensitive: sens, first: origin(sha), in_head: inHeadSha.has(sha) })
    }
    for (const h of scanSecrets(text, { testZone: isTestZone(p) })) {
      summary[h.verdict] = (summary[h.verdict] || 0) + 1
      if (h.verdict === 'placeholder' || h.verdict === 'test') continue
      const k = h.id + '|' + h.fp
      let g = groups.get(k)
      if (!g) groups.set(k, (g = { id: h.id, verdict: h.verdict, why: h.why, key: h.key, masked: h.masked, ct: Infinity, commit: '', date: '', subject: '', paths: new Set(), blobs: new Set(), in_head: false, lines: new Set() }))
      const o = first.get(sha)
      if (o && Number(o.ct) < g.ct) { g.ct = Number(o.ct); g.commit = o.commit.slice(0, 8); g.date = iso(o.ct); g.subject = o.subject.slice(0, 80) }
      g.paths.add(p); g.blobs.add(sha); g.lines.add(h.line)
      if (inHeadSha.has(sha)) g.in_head = true
    }
  })
  log('secret scan done')
  H.secret_totals = summary
  H.secret_groups = [...groups.values()].map((g) => ({ id: g.id, verdict: g.verdict, why: g.why, key: g.key, masked: g.masked, first_commit: g.commit, first_date: g.date, first_subject: g.subject, blobs: g.blobs.size, paths: [...g.paths].slice(0, 5), path_count: g.paths.size, in_head: g.in_head }))
    .sort((a, b) => (a.verdict === b.verdict ? (a.first_date < b.first_date ? -1 : 1) : a.verdict === 'real' ? -1 : 1))
  H.sql_dumps = dumps
  // 7. archives in history: names of note + secrets inside text members
  const zipShas = (!on('H-ZIPS') ? [] : [...blobs]).filter(([sha, b]) => /\.zip$/i.test(where(sha)) && b.size <= 45e6).map(([sha]) => sha)
  H.zips = []
  await streamBlobs(zipShas, (sha, buf) => {
    const ents = zipEntries(buf)
    const rec = { path: where(sha), sha: sha.slice(0, 10), bytes: buf.length, members: ents ? ents.length : 0, first: origin(sha), in_head: inHeadSha.has(sha), names_of_note: [], secrets: 0, php: 0, note: '' }
    if (!ents) { rec.note = 'not a readable zip'; H.zips.push(rec); return }
    let budget = 80e6
    for (const e of ents) {
      if (e.name.endsWith('/')) continue
      if (/(^|\/)(config\.php|\.env(\..+)?|.*\.(pem|key|p12|cgn|cgz)|keystore\.bin|\.cbk_token\.json|\.htpasswd|.*\.sql\.gz)$/i.test(e.name) && !/(config\.example\.php|\.env\.example)$/.test(e.name)) rec.names_of_note.push(e.name)
      if (PHP_EXT.test(e.name)) rec.php++
      if (budget <= 0 || /\.(png|jpe?g|gif|webp|woff2?|ttf|mp[34]|wav|glb|pdf|ico)$/i.test(e.name)) continue
      const d = zipRead(buf, e)
      if (!d || d.subarray(0, 4096).includes(0)) continue
      budget -= d.length
      for (const h of scanSecrets(d.toString('utf8'), { testZone: isTestZone(e.name) })) if (h.verdict === 'real' || h.verdict === 'probable') rec.secrets++
    }
    H.zips.push(rec)
  })
  H.zips.sort((a, b) => b.bytes - a.bytes)
  log('archive scan done')
  H.proposal = proposeCleanup(H, [...dirAgg.values()])
  return H
}
function proposeCleanup(H, allDirs) {
  // Whole top-level paths with NO blob in HEAD and NOT ONE file that moved into sporta-web/ (so: other projects).
  // A folder that mixes the shop's early layout with other projects (scripts/, docs/, public/) is never purged
  // whole: only its sub-folders that never moved are proposed.
  const ghost = (H.top_level || []).filter((d) => d.in_head_blobs === 0 && d.disk > 5 * 1048576)
  const other = ghost.filter((d) => d.moved === 0)
  const layout = ghost.filter((d) => d.moved > 0)
  // Inside a folder that was the shop's earlier layout, only the sub-folders that never moved.
  const sub = (allDirs || []).filter((d) => d.dir.includes('/') && layout.some((l) => d.dir.startsWith(l.name + '/')) && d.in_head_blobs === 0 && d.moved === 0 && d.disk > 5 * 1048576)
  const targets = [...other.map((d) => ({ name: d.name, dir: d.is_dir, disk: d.disk, raw: d.raw, blobs: d.blobs })), ...sub.map((d) => ({ name: d.dir, dir: true, disk: d.disk, raw: d.raw, blobs: d.blobs }))]
  const flags = targets.map((d) => `--path ${JSON.stringify(d.name)}`).join(' ')
  return {
    note: 'PROPOSAL ONLY. None of this was run. It is the owner\'s decision: it rewrites a public history.',
    paths_not_in_head: targets,
    kept_as_earlier_layout: layout.map((d) => ({ name: d.name, disk: d.disk, moved_share: Number((d.moved / d.blobs).toFixed(2)) })),
    saves_packed_bytes: targets.reduce((n, d) => n + d.disk, 0),
    commands: [
      'git clone --mirror <repo-url> sporta-purge.git && cd sporta-purge.git        # a fresh mirror; never run filter-repo in the working clone',
      'git filter-repo --analyze                                                  # writes .git/filter-repo/analysis/*.txt: check the sizes against this report',
      `git filter-repo ${flags} --invert-paths    # drops paths that have no blob in HEAD and no file that moved into sporta-web/`,
      'git count-objects -vH && git gc --prune=now --aggressive                    # measure the new pack',
      'git push --force --mirror <repo-url>                                        # only after the owner has read the blast radius below',
    ],
    blast_radius: [
      'Every commit from the oldest touched one onwards gets a new SHA, on every branch and tag (the 20+ claude/* branches included).',
      'CLAUDE.md, GO-LIVE.md and the deploy logs cite SHAs (baseline 1eb487aa, deploy-...-8bf6001): they stop resolving. vps-deploy.mjs "refuses older-code-over-newer" and fetches by SHA, so its baseline must be re-recorded.',
      'Every existing clone and fork keeps the old objects, GitHub keeps refs/pull/* and cached views until support runs a GC, and anyone who cloned already has the data. A rewrite shrinks FUTURE clones; it does not un-publish.',
      'It revokes nothing. A secret found in history stays valid until it is rotated at its provider; rotate first, rewrite second (or never).',
    ],
  }
}

// ===================================================================== REPORT
function finalize(parts) {
  const sevOrder = (f) => SEV[f.severity]
  findings.sort((a, b) => sevOrder(a) - sevOrder(b) || (a.where < b.where ? -1 : a.where > b.where ? 1 : a.detector < b.detector ? -1 : 1))
  let n = 0
  for (const f of findings) {
    f.id = `F-${String(++n).padStart(3, '0')}`
    const a = isAcknowledged(f)
    if (a) { f.documented = true; f.acknowledged = a.status !== 'open'; f.ack_note = a.note || '' }
    if (!f.who_probably) f.who_probably = whoIs(f)
    if (!f.action) f.action = DEFAULT_ACTION[f.detector] || 'investigate'
  }
  const blocking = findings.filter((f) => !f.acknowledged && (f.suspicious || f.severity === 'high' || f.detector === 'D-UNKNOWN'))
  return { blocking }
}
const DEFAULT_ACTION = {
  'D-UNKNOWN': 'add a rule to ops/known-files.json if it belongs; otherwise investigate who made it',
  'D-ORPHAN': 'document it in package.json / a README, or git rm in a normal commit', 'D-BACKUP-NAME': 'ignore or git rm',
  'D-GENERATED': 'git rm --cached and ignore', 'D-TRACKED-IGNORED': 'git rm --cached in a normal commit', 'D-STALE-COPY': 'git rm in a normal commit',
  'D-DUPLICATE': 'keep one master and copy at build time', 'D-ARCHIVE': 'investigate; git rm --cached if it is a build output',
  'S-TEST-CRED': 'keep; confirm none equals a live credential', 'D-BINARY-UNK': 'investigate',
  'D-HT-HANDLER': 'remove the directive and find out who added it; if a deploy ever shipped it, treat the server as exposed', 'D-HT-REDIRECT': 'remove it unless the owner added it',
  'D-CONFIG-EXEC': 'remove the hook / server / rewrite, or add it to the manifest with the owner who wants it', 'D-BIDI-IN-SOURCE': 'remove the character; compare the file with its last reviewed version',
}
function whoIs(f) {
  const file = f.file || f.where
  if (provenance.map && provenance.map.has(file)) return provenance.map.get(file)
  if (/^package:/.test(f.where)) return 'staged package (built from this tree)'
  try {
    const st = fs.lstatSync(path.join(ROOT, file))
    if (st.isFile() || st.isSymbolicLink()) return `not in git history: untracked or ignored, last modified ${new Date(st.mtimeMs).toISOString().slice(0, 10)}`
  } catch { /* an aggregate finding has no single file */ }
  if (/^neighbour:|^site:/.test(f.where)) return 'live server'
  return ''
}
function loadProvenance() {
  provenance.map = new Map()
  if (!IS_GIT) return
  try {
    // oldest add wins: git log prints newest first, so later lines overwrite
    const txt = git(['log', '--diff-filter=A', '--no-renames', '--name-only', '--format=%x01%h %ad %an: %s', '--date=short']).toString()
    let cur = ''
    for (const l of txt.split('\n')) {
      if (l.charCodeAt(0) === 1) cur = l.slice(1, 110)
      else if (l) provenance.map.set(l, cur)
    }
  } catch { /* provenance is a convenience */ }
}
function sevCount(list) { const c = { high: 0, medium: 0, low: 0 }; for (const f of list) c[f.severity]++; return c }
function consoleReport(R) {
  const c = R.counts || {}
  const say = (s) => console.log(s)
  say('='.repeat(78))
  say(`UNKNOWN FILES SCAN  head ${R.head}  manifest ${path.relative(ROOT, MANIFEST_PATH)} (${RULES.length} rules, ${ACK.length} acknowledged)`)
  say('='.repeat(78))
  if (R.tree) {
    say(`scanned ${c.scanned} files + ${c.ignored_dirs} ignored folders = ${c.entries} entries (tracked ${c.tracked_present}, untracked ${c.untracked}, ignored entries ${c.ignored_entries}${c.ignored_dirs ? ` of which ${c.ignored_dirs} folders classified as one entry each` : ''})`)
    say(`KNOWN by rule ${c.known_by_rule}   KNOWN by reference ${c.known_by_reference}   UNKNOWN ${c.unknown}   named only in docs ${c.named_only_in_docs}   SUSPICIOUS files ${R.suspicious_files.length}`)
  }
  const sc = sevCount(R.findings)
  say(`findings: ${sc.high} high, ${sc.medium} medium, ${sc.low} low   tolerated ${R.findings.filter((f) => f.acknowledged).length}   documented-open ${R.findings.filter((f) => f.documented && !f.acknowledged).length}   blocking ${R.blocking.length}   allow-listed hits ${R.allowed.length}`)
  say('')
  const QUIET = new Set(['D-BACKUP-NAME', 'D-ORPHAN', 'S-TEST-CRED', 'D-DUPLICATE'])
  for (const f of R.findings.filter((x) => x.severity !== 'low' || !QUIET.has(x.detector))) {
    say(`${f.id} ${f.severity.toUpperCase().padEnd(6)} ${f.kind.padEnd(27)} ${f.acknowledged ? '[ack] ' : ''}${f.where}`)
    say(`        ${f.evidence}`)
  }
  const lows = R.findings.filter((x) => x.severity === 'low' && QUIET.has(x.detector))
  if (lows.length) {
    const by = {}
    for (const f of lows) by[f.detector] = (by[f.detector] || 0) + 1
    say(`\nlow, summarised: ${Object.entries(by).map(([k, v]) => `${k} x${v}`).join(', ')}  (full list: --json / --md)`)
  }
  if (R.history) {
    const h = R.history
    say(`\nHISTORY  ${h.objects.commits} commits, ${h.objects.blobs} blobs, ${kb(h.objects.raw_bytes)} raw / ${kb(h.objects.disk_bytes)} packed; HEAD tree ${h.head.files} files, ${kb(h.head.bytes)}`)
    say(`  text blobs scanned ${h.scanned_blobs} (${kb(h.scanned_bytes)}); secret hits: real ${h.secret_totals.real || 0}, probable ${h.secret_totals.probable || 0}, test ${h.secret_totals.test || 0}, placeholder ${h.secret_totals.placeholder || 0}; distinct real/probable values ${h.secret_groups.length}`)
    say(`  name sweep ${JSON.stringify(h.name_sweep_counts)}; zips ${h.zips.length}; SQL dumps ${h.sql_dumps.length}`)
  }
  if (R.package) say(`\nPACKAGE  ${R.package.files} files, ${kb(R.package.bytes)}; known ${R.package.known}, unknown ${R.package.unknown.length}; differs from source ${R.package.differs.length}; file-audit: ${R.package.file_audit.summary}`)
}
function mdEsc(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ') }
function toMarkdown(R) {
  const L = []
  const c = R.counts || {}
  L.push('# Unknown files scan', '', `Head \`${R.head}\`. Tool version ${VERSION}. Deterministic: the same tree gives the same report.`, '')
  if (R.tree) {
    L.push('## Counts', '', '| | |', '|---|---|',
      `| files scanned | ${c.scanned} |`, `| tracked (present) | ${c.tracked_present} |`, `| untracked, not ignored | ${c.untracked} |`, `| ignored entries (folders count once) | ${c.ignored_entries} |`,
      `| KNOWN by a manifest rule | ${c.known_by_rule} |`, `| KNOWN by a code/config reference | ${c.known_by_reference} |`, `| UNKNOWN | ${c.unknown} |`, `| named only in documentation | ${c.named_only_in_docs} |`, `| SUSPICIOUS files | ${R.suspicious_files.length} |`, '')
    L.push('## Rules that explain files', '', '| rule | files | bytes | purpose | owner | ships to web |', '|---|---|---|---|---|---|')
    for (const r of R.rules) L.push(`| ${r.id} | ${r.files} | ${r.bytes} | ${mdEsc(r.purpose)} | ${mdEsc(r.owner)} | ${r.web ? 'yes' : 'no'} |`)
    L.push('')
    L.push('## UNKNOWN files', '')
    if (!R.unknown.length) L.push('None.', '')
    for (const u of R.unknown) L.push(`- \`${u.path}\` (${u.status}, ${kb(u.size)}${u.how ? ', ' + u.how : ''})`)
    L.push('', '## SUSPICIOUS files', '')
    if (!R.suspicious_files.length) L.push('None.', '')
    for (const s of R.suspicious_files) L.push(`- \`${s}\``)
  }
  L.push('', '## Findings', '', '| id | sev | kind | where | evidence | who probably | action | conf | ack |', '|---|---|---|---|---|---|---|---|---|')
  for (const f of R.findings) L.push(`| ${f.id} | ${f.severity} | ${f.kind} | \`${mdEsc(f.where)}\` | ${mdEsc(f.evidence)} | ${mdEsc(f.who_probably)} | ${mdEsc(f.action)} | ${f.confidence} | ${f.acknowledged ? 'yes' : ''} |`)
  if (R.allowed.length) {
    L.push('', '## Allow-listed content hits (reviewed, tolerated)', '', '| detector | file | count | reason |', '|---|---|---|---|')
    for (const a of R.allowed) L.push(`| ${a.detector} | \`${a.where}\` | ${a.count} | ${mdEsc(a.reason)} |`)
  }
  if (R.archives?.length) {
    L.push('', '## Archives in the tree', '')
    for (const a of R.archives) L.push(`- \`${a.path}\`: ${a.members} members, dated ${a.oldest} to ${a.newest}, ${kb(a.bytes)}; credential-shaped names: ${a.names_of_note.length}; secret hits: ${a.secrets.length}; against the tree: ${a.compared.identical} identical, ${a.compared.differs} differ, ${a.compared.nocounterpart} without a counterpart`)
  }
  if (R.trees && Object.keys(R.trees).length) {
    L.push('', '## Side trees', '')
    for (const [d, t] of Object.entries(R.trees)) L.push(`- \`${d}/\` — ${t.what}: ${t.files} files, ${kb(t.bytes)}; named from outside by ${t.referenced_from.length ? t.referenced_from.join(', ') : 'nothing'}; twins in sporta-web/public: ${t.twins_identical} identical, ${t.twins_differ} differ; ships: ${t.ships}`)
  }
  if (R.package) {
    const p = R.package
    L.push('', '## Package', '', `Staged tree: ${p.files} files, ${kb(p.bytes)}. Known ${p.known}, unknown ${p.unknown.length}, differing from their source ${p.differs.length}.`, `file-audit.mjs: exit ${p.file_audit.exit}, ${p.file_audit.summary}`)
    for (const u of p.unknown) L.push(`- UNKNOWN in package: \`${u}\``)
    for (const d of p.differs.slice(0, 20)) L.push(`- ${d}`)
  }
  if (R.history) {
    const h = R.history
    L.push('', '## History', '', `${h.objects.commits} commits, ${h.objects.blobs} blobs (${kb(h.objects.raw_bytes)} raw, ${kb(h.objects.disk_bytes)} in pack). HEAD tree: ${h.head.files} files, ${kb(h.head.bytes)}. Blobs no longer in HEAD: ${h.dead_weight.blobs_not_in_head} (${kb(h.dead_weight.disk_bytes_not_in_head)} packed).`, '')
    L.push('### Secret scan', '', `Text blobs scanned: ${h.scanned_blobs} (${kb(h.scanned_bytes)}). Hits: real ${h.secret_totals.real || 0}, probable ${h.secret_totals.probable || 0}, test credential ${h.secret_totals.test || 0}, placeholder ${h.secret_totals.placeholder || 0}.`, '')
    L.push('| type | verdict | first commit | files | blobs | in HEAD | masked |', '|---|---|---|---|---|---|---|')
    for (const g of h.secret_groups.slice(0, 80)) L.push(`| ${g.id} ${g.key || ''} | ${g.verdict} | ${g.first_commit} ${g.first_date} | ${mdEsc(g.paths.slice(0, 2).join(', '))}${g.path_count > 2 ? ` (+${g.path_count - 2})` : ''} | ${g.blobs} | ${g.in_head ? 'yes' : 'no'} | ${g.masked} |`)
    L.push('', '### Sensitive names ever added', '', '| class | path | versions | first | size | in HEAD |', '|---|---|---|---|---|---|')
    for (const s of h.name_sweep.filter((x) => x.class !== 'sql' && x.class !== 'archive').slice(0, 80)) L.push(`| ${s.class} | \`${mdEsc(s.path)}\` | ${s.versions} | ${s.first_commit} ${s.first_date} | ${kb(s.size)} | ${s.in_head ? 'yes' : 'no'} |`)
    L.push('', '### Archives ever committed', '', '| path | size | members | first | in HEAD | credential-shaped names | secret hits |', '|---|---|---|---|---|---|---|')
    for (const z of h.zips.slice(0, 40)) L.push(`| \`${mdEsc(z.path)}\` | ${kb(z.bytes)} | ${z.members} | ${z.first ? z.first.commit + ' ' + z.first.date : ''} | ${z.in_head ? 'yes' : 'no'} | ${z.names_of_note.length} | ${z.secrets} |`)
    L.push('', '### Largest blobs ever committed', '', '| size | packed | path | first commit | in HEAD |', '|---|---|---|---|---|')
    for (const b of h.top_blobs) L.push(`| ${kb(b.size)} | ${kb(b.disk)} | \`${mdEsc(b.path)}\` | ${b.first ? b.first.commit + ' ' + b.first.date : ''} | ${b.in_head ? 'yes' : 'no'} |`)
    L.push('', '### What explains the pack (by directory, packed size)', '', '| directory | blobs | raw | packed | blobs in HEAD |', '|---|---|---|---|---|')
    for (const d of h.by_dir) L.push(`| \`${mdEsc(d.dir)}\` | ${d.blobs} | ${kb(d.raw)} | ${kb(d.disk)} | ${d.in_head_blobs} |`)
    L.push('', '### Cleanup proposal (not run)', '', h.proposal.note, '', '```sh', ...h.proposal.commands, '```', '', 'Blast radius:', ...h.proposal.blast_radius.map((x) => `- ${x}`))
  }
  return L.join('\n') + '\n'
}

// ===================================================================== MAIN
async function main() {
  const R = { tool: 'unknown-files-scan', version: VERSION }
  initGit()
  R.head = HEAD()
  const stage = opt('--package-build')
  if (stage) buildStage(path.resolve(stage))
  const pkgDir = stage ? path.resolve(stage) : opt('--package')
  if (!has('--no-tree')) {
    loadProvenance()
    const t = await scanTree()
    R.tree = true
    R.counts = t.counts
    R.rules = [...t.byRule.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
    R.unknown = t.unknown.map((f) => ({ path: f.path, status: f.status, size: f.size, how: f.how || '', tracked: !!f.tracked }))
    R.test_credentials = t.testCreds.map((x) => ({ path: x.path, literals: x.count, names_real_address: x.realAddr, where: x.lines }))
    R.unused_rules = t.unusedRules
    R.archives = t.archives; R.trees = t.trees; R.duplicates = t.duplicates; R.stale = t.stale
    R.files = t.fileList.map((f) => [f.path, f.status || '', f.rule || '', f.how || '']).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }
  if (pkgDir) R.package = await scanPackage(path.resolve(pkgDir))
  if (has('--history')) R.history = await scanHistory()
  const { blocking } = finalize()
  R.findings = findings.map((f) => ({ id: f.id, detector: f.detector, severity: f.severity, where: f.where, kind: f.kind, title: f.title, evidence: f.evidence, who_probably: f.who_probably, action: f.action, confidence: f.confidence, suspicious: f.suspicious, acknowledged: !!f.acknowledged, documented: !!f.documented, ack_note: f.ack_note || '' }))
  R.blocking = blocking.map((f) => f.id)
  R.allowed = allowedHits.sort((a, b) => (a.where < b.where ? -1 : 1))
  R.suspicious_files = [...new Set(findings.filter((f) => f.suspicious).map((f) => f.file))].sort()
  if (R.history) R.history.secret_groups = R.history.secret_groups.map((g) => g)
  if (opt('--json')) fs.writeFileSync(path.resolve(opt('--json')), JSON.stringify(R, null, 1) + '\n')
  if (opt('--md')) fs.writeFileSync(path.resolve(opt('--md')), toMarkdown(R))
  if (!has('--quiet')) {
    consoleReport(R)
    if (has('--list')) for (const [p, s, r, h] of R.files || []) console.log(`${s.padEnd(8)} ${(r || '-').padEnd(24)} ${p}${h ? '  ' + h : ''}`)
  }
  process.exit(blocking.length ? 1 : 0)
}
main().catch((e) => { err(String(e && e.stack || e)); process.exit(2) })
