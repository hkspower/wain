#!/usr/bin/env node
// LIVE FILES SCAN — every file on the live server that nothing in the project explains.
//
// READ-ONLY. It lstat()s, hashes and prints. It never writes inside the tree it scans, never
// follows a symlink, never deletes, moves or chmods anything, and opens no network connection.
// Made for ONE one-shot VPS job (node:24-alpine, /docker/sporta mounted read-only at /sporta);
// ops/live-files-scan.compose.json is that job, made by scripts/make-expected-manifest.mjs.
// This is the LIVE half of the unknown-files check (the repo half is the other lane's tool);
// scripts/old-files-inventory.mjs stays what it was — a per-chunk report on the web root — and this
// tool answers the wider question: what is on the whole /sporta tree that we cannot explain?
//
// WHAT "UNKNOWN" MEANS HERE. A file is KNOWN only because a line of evidence says so, and the
// line is printed next to it (the `rule=`):
//   repo:<head|oldN>      its bytes are, exactly, a version of that path committed in the repo
//                         (git blob id match; the manifest carries every version ever committed)
//   repo-normalized       the root .htaccess: same as a committed version once the build-filled CSP
//                         script hashes are folded back to the placeholder
//   referenced-by-live-index   reached from the live index.html / .htaccess / robots / sitemap /
//                         manifest / sw.js by the same reference walk old-files-inventory.mjs makes
//                         (the live storefront is a FOREIGN build; "expected" there = referenced)
//   <rule id>             a documented live-only file (manifest "rules": config.js, backups named by
//                         vps-deploy.mjs, the private/ layout, ...), each with the doc that says so
// Everything else is UNKNOWN. A SUSPICIOUS file is one that is unknown (or known-but-wrong) AND
// carries a risk signal: it can run, it matches a webshell/obfuscation/secret signature, it is a
// dump or archive in the web root, it escapes the root by symlink, it is newer than the last deploy
// and executable, and so on. The verdict never deletes anything: see ops/FILES-SCAN.md for what to
// do with each class (a separate owner-approved job MOVES files to a quarantine folder).
//
// WHAT IT READS (privacy rules, asserted by test:unknown-files):
//   site/        every file up to 1 MB is read to hash it and look for signatures, EXCEPT names that
//                look like credentials (config.php, .env*, *.pem, ...): those are never opened.
//   private/media  product photos are public by design: first 4 KiB (type, PHP-in-image check).
//   everything else (private/, backups/, releases/, loose files, old site copies): NAMES, sizes, modes
//                and owners only. A file is opened only if it is under 64 kB AND its name does not look
//                like config/credential/dump/log. Nothing under private/ is ever printed except its
//                name, size, mode, owner and (for such small files) a sha256 prefix.
// Output never contains file CONTENT: a signature hit prints its name, the line number and, for a
// secret, a mask of at most 4 characters. Paths are data (they are escaped and cut at 140 chars).
//
// REACHABLE / EXECUTES are a MODEL of the .htaccess files found in the tree (FilesMatch/Files
// "Require all denied", RewriteRule ... [F], RedirectMatch 404, Options -Indexes). They are an upper
// bound: the container's own Apache config, Traefik and mod_rewrite redirects (index.php -> /) are
// not modelled, so a file reported reach=Y may still be refused; a live GET (live-scan.mjs) is the
// confirmation. A file reported reach=N is denied by a rule that is itself one config line.
//
// Usage on the VPS (a one-shot job; the compose command holds no dollar sign and no curl/wget/require):
//   node live-files-scan.mjs --root /sporta --manifest /tmp/m.json [--details /out/details.ndjson]
//   node live-files-scan.mjs --root /sporta --manifest /tmp/m.json --page 2          (next 200 findings)
//   node live-files-scan.mjs --read /out/details.ndjson --page 2                    (page a saved file)
// Options: --page-size N (200) · --max-lines N (230) · --verdict SUSPICIOUS,UNKNOWN · --area site
//          --uids site=0,501;private=0,33 · --fail-on suspicious · --json (the whole result as JSON)
//
// Shared with the repo-side lane: SIGNATURES + scanText below are one module's worth of detectors;
// if the other lane's tool exports the same list, import it from there and delete this copy.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// ============================================================ 1. SIGNATURES
// name, languages, severity, finding kind. `strong` ones also run on files the live page references
// (a foreign bundle legitimately contains eval-ish words, so only the unmistakable ones do).
// `secret` ones print a mask (the first `keep` characters + ****) and nothing else of the value.
const re = (s, f = '') => new RegExp(s, f)
export const SIGNATURES = [
  { name: 'php-eval-request', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\b(?:eval|assert|create_function)\\s*\\(\\s*[^;\\n]{0,100}\\$_(?:GET|POST|REQUEST|COOKIE|SERVER|FILES)\\b', 'i') },
  { name: 'php-exec-request', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\b(?:system|shell_exec|passthru|exec|popen|proc_open|pcntl_exec)\\s*\\(\\s*[^;\\n]{0,100}\\$_(?:GET|POST|REQUEST|COOKIE)\\b', 'i') },
  { name: 'php-backtick-request', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('`[^`\\n]{0,60}\\$_(?:GET|POST|REQUEST|COOKIE)\\b[^`\\n]{0,60}`') },
  { name: 'php-decode-chain', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\b(?:eval|assert)\\s*\\(\\s*(?:@\\s*)?(?:gzinflate|gzuncompress|gzdecode|str_rot13|base64_decode|strrev|convert_uudecode|hex2bin|rawurldecode|urldecode)\\s*\\(', 'i') },
  { name: 'php-variable-function-request', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\$[A-Za-z_]\\w*\\s*\\(\\s*\\$_(?:GET|POST|REQUEST|COOKIE)\\s*\\[') },
  { name: 'php-preg-e', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\bpreg_replace\\s*\\(\\s*([\'"])[^\'"\\n]{1,200}/[a-z]*e[a-z]*\\1', 'i') },
  { name: 'php-include-request', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\b(?:include|require)(?:_once)?\\s*\\(?\\s*\\$_(?:GET|POST|REQUEST|COOKIE)\\b', 'i') },
  { name: 'php-known-shell', langs: ['php'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\b(?:c99shell|r57shell|FilesMan|b374k|WSO_VERSION|IndoXploit|Fx29Sh|China\\s+Chopper|PHP\\s+Shell|webshell)\\b', 'i') },
  { name: 'php-upload-write', langs: ['php'], sev: 'medium', kind: 'webshell-or-obfuscated-code',
    re: re('\\bmove_uploaded_file\\s*\\(') },
  { name: 'php-long-literal', langs: ['php'], sev: 'medium', kind: 'webshell-or-obfuscated-code',
    re: re('([\'"])[A-Za-z0-9+/=]{900,}\\1') },
  { name: 'php-hex-escapes', langs: ['php'], sev: 'medium', kind: 'webshell-or-obfuscated-code',
    test: (t) => { const m = t.match(/\\x[0-9a-f]{2}/gi); return m && m.length >= 60 ? { index: t.search(/\\x[0-9a-f]{2}/i) } : null } },
  { name: 'php-auto-prepend', langs: ['php', 'ht'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('auto_(?:prepend|append)_file', 'i') },
  // A handler override in an .htaccess makes any file name run as PHP (a .jpg shell).
  { name: 'ht-handler', langs: ['ht'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('^\\s*(?:AddHandler\\s|AddType\\s+application/x-httpd-php|SetHandler\\s+(?!none\\b)|php_flag\\s+engine\\s+on)', 'im') },
  { name: 'js-miner', langs: ['js'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('coinhive|cryptonight|webminer|authedmine|jsecoin|coin-hive', 'i') },
  { name: 'js-eval-decode', langs: ['js'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('\\beval\\s*\\(\\s*(?:atob|unescape|String\\.fromCharCode)\\s*\\(') },
  { name: 'js-write-unescape', langs: ['js'], sev: 'high', kind: 'webshell-or-obfuscated-code', strong: true,
    re: re('document\\.write\\s*\\(\\s*unescape\\s*\\(') },
  // Card-skimmer shape: a card field word followed by a send to a host that is not ours or the bank's.
  { name: 'js-skimmer', langs: ['js'], sev: 'high', kind: 'webshell-or-obfuscated-code',
    re: re('(?:card[-_ ]?number|cardnumber|cvv|cvc)[^\\n]{0,300}(?:sendBeacon|new\\s+Image\\s*\\(\\s*\\)\\s*\\.src|XMLHttpRequest|fetch)\\s*\\(?[^\\n]{0,200}https?://(?!www\\.sporta\\.com\\.kw|fonts\\.g|kpay|pg\\.cbk|pgtest\\.cbk)', 'i') },
  // Secrets (any file type). `mask` replaces the value entirely; `keep` is how many characters show.
  { name: 'secret-private-key', langs: ['*'], sev: 'high', kind: 'secret', strong: true, mask: 'PEM-block',
    re: re('-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----') },
  { name: 'secret-aws-key', langs: ['*'], sev: 'high', kind: 'secret', strong: true, secret: true, keep: 4,
    re: re('\\b(AKIA[0-9A-Z]{16})\\b') },
  { name: 'secret-stripe-live', langs: ['*'], sev: 'high', kind: 'secret', strong: true, secret: true, keep: 4,
    re: re('\\b(sk_live_[0-9a-zA-Z]{10,})\\b') },
  { name: 'secret-github-token', langs: ['*'], sev: 'high', kind: 'secret', strong: true, secret: true, keep: 4,
    re: re('\\b(gh[pousr]_[A-Za-z0-9]{30,})\\b') },
  { name: 'secret-slack-token', langs: ['*'], sev: 'high', kind: 'secret', strong: true, secret: true, keep: 4,
    re: re('\\b(xox[baprs]-[A-Za-z0-9-]{10,})\\b') },
  { name: 'secret-google-api-key', langs: ['*'], sev: 'high', kind: 'secret', strong: true, secret: true, keep: 4,
    re: re('\\b(AIza[0-9A-Za-z_-]{30,})\\b') },
  // A credential assigned to a literal. Noisy in other people's bundles, so never on `strong` runs.
  { name: 'secret-assignment', langs: ['php', 'ht', 'any'], sev: 'high', kind: 'secret', secret: true, keep: 2,
    re: re('\\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\\b["\']?\\s*[:=]>?\\s*["\']([^"\'\\s$<>{}()]{8,80})["\']', 'i') },
]

const lineOf = (text, index) => { let n = 1; for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }
// `lang`: 'php' | 'js' | 'ht' | 'any'. `tier`: 'all' or 'strong'. Returns [{name, sev, kind, line, mask?}].
export function scanText(text, lang, tier = 'all', extraLangs = []) {
  const langs = new Set([lang, ...extraLangs])
  const hits = []
  for (const s of SIGNATURES) {
    if (tier === 'strong' && !s.strong) continue
    if (!s.langs.includes('*') && !s.langs.some((l) => langs.has(l))) continue
    let idx = -1, value = ''
    if (s.test) { const r = s.test(text); if (r) idx = r.index } else {
      const m = s.re.exec(text)
      if (m) { idx = m.index; value = m[1] ?? '' }
    }
    if (idx < 0) continue
    const h = { name: s.name, sev: s.sev, kind: s.kind, line: lineOf(text, idx) }
    if (s.mask) h.mask = s.mask
    else if (s.secret) h.mask = value.slice(0, s.keep ?? 2) + '****'
    hits.push(h)
  }
  return hits
}

// ============================================================ 2. SMALL HELPERS
const ONE_MB = 1024 * 1024
const SMALL = 64 * 1024               // outside site/ and media/, only files below this are ever opened
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
// The id git gives a file's bytes: sha1("blob <size>\0" + bytes). The manifest holds these, so a live
// file can be compared with every committed version without the repo or git being present.
export const gitBlobId = (b) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')
// The build writes the inline-script hashes into the root .htaccess in place of a placeholder
// (scripts/csp-hashes.mjs); folding the run of 'sha256-…' tokens back makes it comparable.
export const normHt = (text) => text.replace(/'sha256-[A-Za-z0-9+/=]+'(?: 'sha256-[A-Za-z0-9+/=]+')*/g, '__SCRIPT_HASHES__')
const octal = (m) => (m & 0o7777).toString(8).padStart(4, '0')
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16) + 'Z' : '-')
const sevRank = { high: 0, medium: 1, low: 2 }
const maxSev = (a, b) => (sevRank[a] <= sevRank[b] ? a : b)
// A path is data. Cut it and escape anything that could break a log line (or smuggle text into it).
const safe = (s) => {
  let t = String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
  if (t.length > 140) t = t.slice(0, 137) + '...'
  return /^[A-Za-z0-9._\-/~@+,=%:]+$/.test(t) ? t : JSON.stringify(t)
}

// "What kind of bytes is this", by the first bytes. Never returns content.
export function sniff(h) {
  if (!h || h.length === 0) return 'empty'
  const s = (a, b) => h.subarray(a, b).toString('latin1')
  if (h[0] === 0x89 && s(1, 4) === 'PNG') return 'PNG'
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'JPEG'
  if (s(0, 4) === 'GIF8') return 'GIF'
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'WebP'
  if (s(4, 12) === 'ftypavif' || s(4, 12) === 'ftypavis') return 'AVIF'
  if (s(0, 4) === 'wOF2' || s(0, 4) === 'wOFF') return 'WOFF'
  if (s(0, 4) === 'OTTO' || (h[0] === 0 && h[1] === 1 && h[2] === 0 && h[3] === 0)) return 'TTF/OTF'
  if (s(0, 4) === 'PK\x03\x04' || s(0, 4) === 'PK\x05\x06') return 'ZIP'
  if (h[0] === 0x1f && h[1] === 0x8b) return 'gzip'
  if (s(0, 3) === 'BZh') return 'bzip2'
  if (s(0, 4) === 'Rar!') return 'RAR'
  if (h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf) return '7z'
  if (h.length > 262 && s(257, 262) === 'ustar') return 'tar'
  if (s(0, 4) === '%PDF') return 'PDF'
  if (h[0] === 0x7f && s(1, 4) === 'ELF') return 'ELF'
  if (h[0] === 0x4d && h[1] === 0x5a) return 'PE/DOS'
  if (s(0, 15) === 'SQLite format 3') return 'SQLite'
  const t = s(0, Math.min(h.length, 512)).replace(/^\ufeff/, '').replace(/^\xef\xbb\xbf/, '')
  if (/^#!/.test(t)) return 'shell script'
  if (/^<\?(?:php|=)/i.test(t)) return 'PHP'
  if (/^-----BEGIN [A-Z ]+-----/.test(t)) return 'PEM block'
  if (/^--\s*(?:MySQL|MariaDB|phpMyAdmin|Dump|SQL)/i.test(t) || /^\s*(?:CREATE TABLE|INSERT INTO|DROP TABLE|\/\*!\d{5})/i.test(t)) return 'SQL dump'
  if (/^<\?xml/i.test(t)) return /<svg/i.test(t) ? 'SVG' : 'XML'
  if (/^\s*<svg/i.test(t)) return 'SVG'
  if (/^\s*<!doctype html|^\s*<html/i.test(t)) return 'HTML'
  let printable = 0
  for (let i = 0; i < Math.min(h.length, 512); i++) { const c = h[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128) printable++ }
  if (printable / Math.min(h.length, 512) > 0.95) return /^\s*[\[{]/.test(t) ? 'JSON/text' : 'text'
  return 'data'
}
const IMAGE = new Set(['PNG', 'JPEG', 'GIF', 'WebP', 'AVIF'])
const FONT = new Set(['WOFF', 'TTF/OTF'])
const ARCHIVE = new Set(['ZIP', 'gzip', 'bzip2', 'RAR', '7z', 'tar'])

const PHP_RUN = /\.php$/i
const PHP_ALT = /\.(?:php[3-8]|phtml|pht|phar|phps|inc)$/i
const PHP_DOUBLE = /\.(?:php\d?|phtml|phar)\.[a-z0-9]{1,6}$/i
const SCRIPT_EXT = /\.(?:cgi|pl|py|sh|bash|rb|jsp|aspx?|exe|bat|cmd)$/i
// 'php' runs under the container's handler; 'php-alt' runs on a stock mod_php; 'script' on a CGI.
export const execKind = (name) => (PHP_RUN.test(name) ? 'php' : PHP_ALT.test(name) || PHP_DOUBLE.test(name) ? 'php-alt' : SCRIPT_EXT.test(name) ? 'script' : null)
// Never opened, anywhere: the name alone says "credential".
const SECRET_NAME = /(?:^|\/)(?:config\.php|\.env(?:\.[\w.-]*)?|\.cbk_token\.json|\.htpasswd|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?(?:\.\w+)?|[\w.-]*\.(?:pem|key|p12|pfx|kdbx)|db_(?:name|user|pass)|(?:api|knet|pay)-config[\w.-]*\.php|password|[\w.-]*secret[\w.-]*|[\w.-]*(?:compose|override)[\w.-]*\.ya?ml)$/i
// Not credentials but not for reading either: customer data, payment trail, archives.
const SENSITIVE_NAME = /(?:\.(?:sql|dump)(?:\.\w+)*|\.log|\.jsonl|\.tar(?:\.gz)?|\.tgz|\.zip|\.7z|\.rar|\.enc|\.gpg|\.age)$/i
// A copy of a gateway/store config or a key file: old credentials kept around.
const CRED_COPY = /(?:^|\/)(?:(?:api|knet|pay)-config(?:[.-][\w.-]*)?\.php|[\w.-]*\.(?:key|pem)|db_pass)$/i
const EDITOR_COPY = /(?:~|\.(?:bak|old|orig|save|swp|swo|tmp|temp|copy|rej|disabled)|\.bak[-_.][\w.-]*|\.(?:php|js|css|html?|json|conf)[-_.](?:bak|old|orig|prev|copy|\d{6,}))$/i
const ARCHIVE_EXT = /\.(?:zip|tar|gz|tgz|bz2|xz|rar|7z)$/i
const DUMP_EXT = /\.(?:sql|dump)(?:\.gz)?$/i
const LOG_EXT = /\.(?:log|jsonl)$/i

// ============================================================ 3. THE .htaccess MODEL
const toRx = (src) => { try { return src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src) } catch { return null } }
export function parseHt(text) {
  const out = { denyFiles: [], denyNames: [], rewriteF: [], redirect404: [], rewriteOn: false, indexes: null, index: null, denyAll: false, handlers: 0 }
  const stack = []
  let cond = false
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t || t[0] === '#') continue
    let m
    if ((m = /^<FilesMatch\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*>$/i.exec(t))) { stack.push({ type: 'fm', src: m[1] ?? m[2] ?? m[3], deny: false }); continue }
    if ((m = /^<Files\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*>$/i.exec(t))) { stack.push({ type: 'f', name: m[1] ?? m[2] ?? m[3], deny: false }); continue }
    if (/^<\/(?:FilesMatch|Files)\s*>/i.test(t)) {
      const s = stack.pop()
      if (s?.deny && s.type === 'fm') { const rx = toRx(s.src); if (rx) out.denyFiles.push({ src: s.src, rx }) }
      else if (s?.deny && s.type === 'f') out.denyNames.push({ name: s.name })
      continue
    }
    if (/^<\/[A-Za-z]+/.test(t)) { stack.pop(); continue }
    if (/^<[A-Za-z]+/.test(t) && !t.endsWith('/>')) { stack.push({ type: 'other' }); continue }
    const top = stack.at(-1)
    if (/^Require\s+all\s+denied\b/i.test(t) || /^Deny\s+from\s+all\b/i.test(t)) {
      if (top && (top.type === 'fm' || top.type === 'f')) top.deny = true
      else if (!stack.some((s) => s.type === 'fm' || s.type === 'f')) out.denyAll = true
      continue
    }
    if (/^RewriteEngine\s+On\b/i.test(t)) { out.rewriteOn = true; continue }
    if (/^RewriteCond\b/i.test(t)) { cond = true; continue }
    if ((m = /^RewriteRule\s+(?:"([^"]*)"|(\S+))\s+(\S+)(?:\s+\[([^\]]*)\])?/i.exec(t))) {
      const flags = (m[4] ?? '').split(',').map((x) => x.trim().toUpperCase())
      // Only an UNCONDITIONAL "- [F]" / "- [G]" is a standing refusal; one behind a RewriteCond is not.
      if (!cond && m[3] === '-' && (flags.includes('F') || flags.includes('G'))) { const rx = toRx(m[1] ?? m[2]); if (rx) out.rewriteF.push({ src: m[1] ?? m[2], rx }) }
      cond = false
      continue
    }
    if ((m = /^RedirectMatch\s+(?:404|403|410|gone)\s+(\S+)/i.exec(t))) { const rx = toRx(m[1]); if (rx) out.redirect404.push({ src: m[1], rx }); continue }
    if ((m = /^Options\s+(.*)$/i.exec(t))) {
      const toks = m[1].split(/\s+/)
      if (toks.includes('-Indexes')) out.indexes = false
      else if (toks.includes('+Indexes') || toks.includes('Indexes')) out.indexes = true
      continue
    }
    if ((m = /^DirectoryIndex\s+(.*)$/i.exec(t))) { out.index = m[1].split(/\s+/); continue }
    if (/^(?:AddHandler|SetHandler|AddType\s+application\/x-httpd-php|php_value\s+auto_)/i.test(t)) out.handlers++
  }
  return out
}
// reach(rel) -> { denied, by }. FilesMatch/Files/Require/RedirectMatch are inherited down the tree;
// rewrite rules are NOT (the nearest .htaccess decides — measured under Apache, see CLAUDE.md).
export function makeDenyModel(htByDir) {
  return (rel) => {
    const segs = rel.split('/'), base = segs.at(-1)
    const dirs = ['']
    for (let i = 0; i < segs.length - 1; i++) dirs.push(segs.slice(0, i + 1).join('/'))
    let nearest = null
    for (const d of dirs) {
      const h = htByDir.get(d)
      if (!h) continue
      nearest = d
      if (h.denyAll) return { denied: true, by: `${d || '.'}/.htaccess Require all denied` }
      for (const s of h.denyFiles) if (s.rx.test(base)) return { denied: true, by: `FilesMatch ${s.src.slice(0, 40)}` }
      for (const s of h.denyNames) if (s.name === base) return { denied: true, by: `Files ${s.name}` }
      for (const s of h.redirect404) if (s.rx.test('/' + rel)) return { denied: true, by: `RedirectMatch ${s.src.slice(0, 40)}` }
    }
    if (nearest !== null) {
      const h = htByDir.get(nearest)
      const sub = nearest ? rel.slice(nearest.length + 1) : rel
      if (h.rewriteOn) for (const r of h.rewriteF) if (r.rx.test(sub)) return { denied: true, by: `RewriteRule ${r.src.slice(0, 40)}` }
    }
    return { denied: false, by: '' }
  }
}
// Does a (media-folder) .htaccess refuse PHP? It must both deny/disable and name php.
export const refusesPhp = (text) => /php|phtml|phar/i.test(text) && /(?:Require\s+all\s+denied|Deny\s+from\s+all|php_flag\s+engine\s+off|RemoveHandler|SetHandler\s+none|RemoveType)/i.test(text)

// ============================================================ 4. THE REFERENCE WALK
// The same rules as scripts/old-files-inventory.mjs (it is a script with no exports, so this is a
// port; unknown-files-test.mjs runs both on one docroot and compares what they reach).
const ORIGIN = 'https://www.sporta.com.kw'
const FOLLOW = /\.(m?js|cjs|css|html?|json|webmanifest|xml|txt|map|php|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico)$/i
const LIT = /["'`]([^"'`\s<>(){}\\]{1,300}?\.(?:m?js|cjs|css|html?|json|webmanifest|xml|txt|map|php|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico))(?:[?#][^"'`\s]*)?["'`]/gi
const ATTR = /\b(?:src|href|content|poster|data-src|action)\s*=\s*["']([^"']+)["']/gi
const SRCSET = /\bsrcset\s*=\s*["']([^"']+)["']/gi
const CSSURL = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi
const CSSIMP = /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi
const SMAP = /sourceMappingURL=([^\s*'"]+)/g
const LOC = /<(?:[\w-]+:)?loc>\s*([^<\s]+)\s*</gi
const WALK_ROOTS = ['index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'sw.js', 'llms.txt', 'backends-offline.html']
const BACKUP_DIR = /^(backups?|rollback|old|bak)$/i

function candidates(raw, from) {
  let r = String(raw).trim()
  if (!r || r.length > 400) return []
  try { r = decodeURI(r) } catch { /* keep */ }
  r = r.split('#')[0].split('?')[0]
  if (r.startsWith(ORIGIN)) r = r.slice(ORIGIN.length) || '/'
  else if (r.startsWith('//www.sporta.com.kw')) r = r.slice('//www.sporta.com.kw'.length) || '/'
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return []
  if (r.includes('${') || r.includes('*')) return []
  const base = path.posix.dirname(from)
  const norm = (p) => { const n = path.posix.normalize(p).replace(/^\/+/, ''); return n.startsWith('..') ? null : n }
  let out
  if (r.startsWith('/')) out = [norm(r)]
  else if (r.startsWith('./') || r.startsWith('../')) out = [norm(path.posix.join(base, r))]
  else out = [norm(path.posix.join(base, r)), norm(r)]
  return out.filter((x) => x !== null).map((p) => (p === '' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p))
}
function refsOf(rel, text) {
  const out = []
  const ext = path.posix.extname(rel).toLowerCase(), base = path.posix.basename(rel)
  const push = (re_, s) => { for (const m of s.matchAll(re_)) out.push(m[1]) }
  if (ext === '.html' || ext === '.htm') {
    push(ATTR, text)
    for (const m of text.matchAll(SRCSET)) for (const part of m[1].split(',')) out.push(part.trim().split(/\s+/)[0])
    push(LIT, text)
  } else if (ext === '.css') { push(CSSURL, text); push(CSSIMP, text) }
  else if (['.js', '.mjs', '.cjs'].includes(ext)) { push(LIT, text); push(SMAP, text) }
  else if (ext === '.json' || ext === '.webmanifest' || ext === '.map') push(LIT, text)
  else if (ext === '.xml') push(LOC, text)
  else if (base === 'robots.txt') { for (const m of text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) out.push(m[1]) }
  else if (ext === '.txt') {
    push(LIT, text)
    for (const m of text.matchAll(/https:\/\/www\.sporta\.com\.kw(\/[^\s)\]>"']+)/g)) out.push(m[1])
  } else if (base === '.htaccess') {
    for (const line of text.split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue
      const w = t.split(/\s+/)
      if (/^RewriteRule$/i.test(w[0]) && w[2] && w[2] !== '-') out.push(w[2])
      else if (/^ErrorDocument$/i.test(w[0]) && w[2]) out.push(w[2])
      else if (/^DirectoryIndex$/i.test(w[0])) out.push(...w.slice(1))
    }
  }
  return out
}
// files: Set of site-relative file paths; readText(rel) -> string. Returns Map rel -> first referrer.
export function referenceWalk(files, readText) {
  const reached = new Map(), queue = []
  const visit = (rel, from) => { if (!reached.has(rel)) { reached.set(rel, from); queue.push(rel) } }
  for (const r of WALK_ROOTS) if (files.has(r)) visit(r, '(root)')
  const parseable = (rel) => /\.(m?js|cjs|css|html?|json|webmanifest|xml|txt|map)$/i.test(rel) || path.posix.basename(rel) === '.htaccess'
  const inBackup = (rel) => rel.split('/').slice(0, -1).some((s) => BACKUP_DIR.test(s))
  while (queue.length) {
    const rel = queue.shift()
    if (!parseable(rel) || inBackup(rel)) continue
    for (const raw of refsOf(rel, readText(rel))) {
      const hit = candidates(raw, rel).find((c) => files.has(c))
      if (hit) visit(hit, rel)
    }
  }
  return reached
}

// ============================================================ 5. THE MANIFEST
export function loadManifest(obj) {
  if (!obj || obj.version !== 1 || !Array.isArray(obj.paths)) throw new Error('not an expected-files manifest (version 1)')
  const byPath = new Map()
  for (const [p, flags, ...h] of obj.paths) byPath.set(p, { flags, h })
  const rules = (obj.rules ?? []).map((r) => ({ ...r, rx: new RegExp(r.re, r.flags ?? '') }))
  return { raw: obj, sha: obj.sha, hashLen: obj.hashLen ?? 16, byPath, norm: obj.norm ?? {}, rules, uids: obj.uids ?? {}, versions: obj.paths.reduce((n, p) => n + p.length - 2, 0) }
}
function repoMatch(mf, rel, blobId) {
  const e = mf.byPath.get(rel)
  if (!e) return { path: false }
  const pre = blobId.slice(0, mf.hashLen)
  const i = e.h.indexOf(pre)
  if (i < 0) return { path: true, flags: e.flags, hit: false }
  const gone = e.flags.includes('g')
  return { path: true, flags: e.flags, hit: true, label: !gone && i === 0 ? 'head' : `old${i}` }
}

// ============================================================ 6. THE SCAN
const AREA_OF_TOP = (name) => (name === 'site' ? 'site' : name === 'private' ? 'private' : name === 'backups' ? 'backups' : name === 'releases' ? 'releases' : null)
const DEFAULT_UIDS = { site: [0, 501], private: [0, 33], backups: [0], releases: [0], top: [0, 501], copy: [0, 501, 33], media: [0, 33, 501] }
const DEPLOY_STAMP = /deploy-(\d{8})T(\d{6})Z-[0-9a-f]{7}/
const stampMs = (d, t) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6))

// Every open goes through here: O_NOFOLLOW (a symlink swapped in at the last moment is refused), O_NONBLOCK
// (a FIFO can never hang the job) and an fstat that must say "regular file" before a byte is read.
export function makeIo(trace) {
  const note = (op, p) => { if (trace) trace.push({ op, path: p }) }
  const C = fs.constants
  const openRegular = (abs) => {
    let fd
    try { fd = fs.openSync(abs, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK) } catch { return null }
    try { if (fs.fstatSync(fd).isFile()) return fd } catch { /* fall through */ }
    fs.closeSync(fd)
    return null
  }
  const readFd = (fd, max) => {
    try {
      const chunks = []
      let total = 0
      for (;;) {
        const b = Buffer.alloc(Math.min(1 << 16, max - total))
        if (b.length === 0) break
        const got = fs.readSync(fd, b, 0, b.length, null)
        if (got === 0) break
        chunks.push(b.subarray(0, got)); total += got
      }
      return Buffer.concat(chunks)
    } catch { return null } finally { fs.closeSync(fd) }
  }
  return {
    head(abs, n = 4096) { note('head', abs); const fd = openRegular(abs); return fd === null ? null : readFd(fd, n) },
    read(abs, max = 2 * ONE_MB) { note('read', abs); const fd = openRegular(abs); return fd === null ? null : readFd(fd, max) },
  }
}

export function scanLive(opts) {
  const root = path.resolve(opts.root ?? '/sporta')
  const io = makeIo(opts.trace)
  const mf = loadManifest(opts.manifest)
  const uidsFor = { ...DEFAULT_UIDS, ...mf.uids, ...(opts.uids ?? {}) }
  const maxEntries = opts.maxEntries ?? 400000
  const records = []
  const areaStats = {}
  let walked = 0, truncated = false, unreadable = 0
  const stat = (area) => (areaStats[area] ??= { files: 0, dirs: 0, links: 0, bytes: 0, known: 0, unknown: 0, suspicious: 0, flagged: 0, summarised: 0 })

  // ---- generic walk (sorted, lstat only, symlinks reported never followed)
  function walk(absDir, relDir, visit) {
    let ents
    try { ents = fs.readdirSync(absDir, { withFileTypes: true }) } catch { unreadable++; return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (walked >= maxEntries) { truncated = true; return }
      const abs = path.join(absDir, e.name), rel = relDir ? `${relDir}/${e.name}` : e.name
      let st
      try { st = fs.lstatSync(abs) } catch { unreadable++; continue }
      walked++
      const ent = { abs, rel, name: e.name, st, isLink: st.isSymbolicLink(), isDir: st.isDirectory(), isFile: st.isFile() }
      const r = visit(ent)
      if (ent.isDir && r !== 'skip') walk(abs, rel, visit)
    }
  }
  const mkRec = (area, ent, relInArea) => ({
    area, path: relInArea, size: ent.st.size, mtime: ent.st.mtimeMs, mode: octal(ent.st.mode), uid: ent.st.uid, gid: ent.st.gid,
    type: '-', sha: null, reach: null, exec: null, executes: null, age: null, verdict: 'UNKNOWN', rule: null, why: '', kind: 'other', sev: 'low', flags: [], sigs: [],
    _mode: ent.st.mode,
  })
  const flag = (rec, name, sev, kind) => { rec.flags.push({ name, sev, kind }); rec.sev = maxSev(rec.sev, sev) }
  const hasFlag = (rec, ...names) => rec.flags.some((f) => names.includes(f.name))

  // ---- top level
  let topNames
  try { topNames = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch (e) { throw new Error(`cannot read ${root}: ${e.message}`) }

  // ---- deploy stamps (names only): the newest deploy we can prove
  let lastDeploy = null, lastDeployName = null, lastDeploySrc = 'none'
  for (const dirName of ['backups', 'releases']) {
    let names = []
    try { names = fs.readdirSync(path.join(root, dirName)) } catch { /* absent */ }
    for (const n of names) {
      const m = DEPLOY_STAMP.exec(n)
      if (!m) continue
      const ms = stampMs(m[1], m[2])
      if (lastDeploy === null || ms > lastDeploy) { lastDeploy = ms; lastDeployName = m[0]; lastDeploySrc = dirName }
    }
  }

  // ================================================================ site/
  const siteAbs = path.join(root, 'site')
  const siteEntries = new Map()
  const htByDir = new Map()
  const siteDirs = []
  let build = { kind: 'missing' }
  if (fs.existsSync(siteAbs)) {
    walk(siteAbs, '', (ent) => {
      if (ent.isDir && !ent.isLink && /^\.(?:git|svn|hg|idea|vscode)$/i.test(ent.name)) { siteEntries.set(ent.rel, { ...ent, vcs: true }); return 'skip' }
      siteEntries.set(ent.rel, ent)
      if (ent.isDir && !ent.isLink) siteDirs.push(ent)
      if (ent.isFile && ent.name === '.htaccess' && ent.st.size < 256 * 1024) {
        const buf = io.read(ent.abs)
        if (buf) htByDir.set(path.posix.dirname(ent.rel) === '.' ? '' : path.posix.dirname(ent.rel), parseHt(buf.toString('utf8')))
      }
    })
    const idx = siteEntries.get('index.html')
    if (idx?.isFile) {
      const b = io.read(idx.abs)
      build = { kind: b && /<meta\s+name="sporta-build"\s+content="sporta-web"/.test(b.toString('utf8')) ? 'sporta-web' : 'FOREIGN', size: idx.st.size, mtime: idx.st.mtimeMs, sha: b ? sha256(b).slice(0, 12) : '-' }
    }
  }
  const denyModel = makeDenyModel(htByDir)
  const textCache = new Map()
  const readText = (rel) => {
    if (textCache.has(rel)) return textCache.get(rel)
    const e = siteEntries.get(rel)
    let t = ''
    if (e?.isFile && e.st.size <= 2 * ONE_MB && !SECRET_NAME.test(rel)) { const b = io.read(e.abs); if (b) t = b.toString('utf8') }
    textCache.set(rel, t)
    return t
  }
  const siteFileSet = new Set([...siteEntries].filter(([, e]) => e.isFile).map(([r]) => r))
  const reached = referenceWalk(siteFileSet, readText)

  const rulesFor = (area) => mf.rules.filter((r) => r.area === area)
  const siteRules = rulesFor('site')

  // Apply a documented-live-only rule to one record. Returns the rule or null.
  function matchRule(rules, relInArea, rec, ctx) {
    for (const r of rules) {
      if (!r.rx.test(relInArea)) continue
      if (r.maxSize != null && rec.size > r.maxSize) continue
      if (r.magic === 'image' && !IMAGE.has(rec.type)) continue
      if (r.magic === 'font' && !FONT.has(rec.type)) continue
      if (r.noPhp && (ctx.phpInside || rec.exec === 'php' || rec.exec === 'php-alt')) continue
      return r
    }
    return null
  }

  function judgeSiteFile(ent) {
    const rec = mkRec('site', ent, ent.rel)
    const a = stat('site'); a.files++; a.bytes += ent.st.size
    const name = ent.name
    rec.exec = execKind(name)
    const den = denyModel(ent.rel)
    rec.reach = !den.denied
    rec.deniedBy = den.by
    const secretName = SECRET_NAME.test(ent.rel)
    let buf = null, head = null
    if (ent.isLink) {
      rec.type = 'symlink'
      let target = ''
      try { target = fs.readlinkSync(ent.abs) } catch { /* unreadable */ }
      const resolved = path.resolve(path.dirname(ent.abs), target)
      const inside = resolved === siteAbs || resolved.startsWith(siteAbs + path.sep)
      rec.why = `-> ${safe(target)}`
      if (!inside) {
        const inRoot = resolved.startsWith(root + path.sep)
        setV(rec, 'SUSPICIOUS', 'symlink-escapes-root', 'other')
        flag(rec, 'symlink-escapes-root', inRoot ? 'medium' : 'high', 'other')
        rec.why += inRoot ? ' (leaves site/ for the rest of /sporta)' : ' (leaves /sporta)'
      } else { setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'symlink-inside', 'low', 'other') }
      return finish(rec, ent)
    }
    if (!ent.isFile) {
      rec.type = 'special file (not opened)'
      setV(rec, 'SUSPICIOUS', null, 'other'); flag(rec, 'special-file', 'high', 'other')
      rec.why = 'a FIFO, socket or device node in the web root'
      return finish(rec)
    }
    if (secretName) rec.type = 'secret-shaped name (not opened)'
    else if (ent.st.size <= ONE_MB) buf = io.read(ent.abs)
    else head = io.head(ent.abs, 4096)
    const sample = buf ? buf.subarray(0, 4096) : head
    if (!secretName) rec.type = sniff(sample)
    if (buf) rec.sha = sha256(buf)
    const blob = buf ? gitBlobId(buf) : null
    // `<?php` anywhere in what we hold (a shell appended to a photo), `<?=` only at the start: three random
    // bytes spell it in about 1 photo in 30, five never do.
    const phpInside = (!!buf && /<\?php\s/i.test(buf.toString('latin1'))) || (!!sample && /<\?(?:php\b|=)/i.test(sample.toString('latin1')))
    const isHt = name === '.htaccess'

    // ---- the verdict, strictest evidence first
    const man = mf.byPath.get(ent.rel)
    let verdict = null
    if (man && man.flags.includes('s')) {
      setV(rec, 'SUSPICIOUS', 'setup-tool', 'wrong-place')
      rec.why = 'a setup tool the owner was told to delete (vps-deploy.mjs never deploys it)'
      flag(rec, 'leftover-setup-tool', 'high', 'wrong-place')
      verdict = 'done'
    }
    let exact = false
    if (!verdict && blob) {
      const mt = repoMatch(mf, ent.rel, blob)
      if (mt.hit) { setV(rec, 'KNOWN', `repo:${mt.label}`, 'other'); exact = true; verdict = 'done' }
    }
    if (!verdict && buf && mf.norm[ent.rel]) {
      const h = sha256(Buffer.from(normHt(buf.toString('utf8')))).slice(0, mf.hashLen)
      const i = mf.norm[ent.rel].indexOf(h)
      if (i >= 0) { setV(rec, 'KNOWN', 'repo-normalized', 'other'); rec.why = 'a committed version once the build-filled CSP script hashes are folded back'; verdict = 'done' }
    }
    if (!verdict) {
      const r = matchRule(siteRules, ent.rel, rec, { phpInside })
      if (r && r.verdict === 'KNOWN') { setV(rec, 'KNOWN', r.id, r.kind ?? 'other'); rec.why = r.why; verdict = 'done' }
      else if (r) { setV(rec, r.verdict, r.id, r.kind ?? 'other'); rec.why = r.why; flag(rec, r.id, r.sev ?? 'low', r.kind); verdict = 'done' }
    }
    if (!verdict && man) {
      // Our path, but bytes that match no committed version. Code is the dangerous case.
      const code = rec.exec === 'php' || rec.exec === 'php-alt'
      setV(rec, code ? 'SUSPICIOUS' : 'UNKNOWN', null, 'other')
      rec.why = 'path is ours (in the repo manifest) but the bytes are no version committed up to the manifest commit (a hand edit, or a deploy newer than that commit)'
      flag(rec, code ? 'known-path-modified-code' : 'known-path-modified', code ? 'high' : 'medium', 'other')
      verdict = 'done'
    }
    if (!verdict && reached.has(ent.rel) && !rec.exec && !secretName) {
      if (/\.map$/i.test(name)) { setV(rec, 'UNKNOWN', null, 'generated-or-scratch'); flag(rec, 'source-map', 'low', 'generated-or-scratch') }
      else { setV(rec, 'KNOWN', 'referenced-by-live-index', 'other'); rec.why = `reached from ${reached.get(ent.rel)}` }
      verdict = 'done'
    }
    if (!verdict) {
      setV(rec, 'UNKNOWN', null, 'other')
      if (/^assets\//.test(ent.rel) && /\.(m?js|css)$/i.test(name)) { flag(rec, 'unreferenced-chunk', 'low', 'orphan'); rec.why = 'a hashed chunk the live index.html no longer reaches (old build)' }
      else if (/^(?:cats|hero|images\/products)\//.test(ent.rel)) { flag(rec, 'media-folder-in-site', 'low', 'wrong-place'); rec.why = 'photo folders are served from private/media; a file here is invisible' }
      else flag(rec, 'not-explained', 'low', 'orphan')
    }

    // ---- facts that hold whatever the verdict
    if (rec.exec && rec.reach) rec.executes = rec.exec
    if (ent.st.mode & 0o002) flag(rec, 'world-writable', rec.exec ? 'high' : 'medium', 'permissions')
    if (ent.st.mode & 0o4000) flag(rec, 'setuid', 'high', 'permissions')
    if (ent.st.mode & 0o2000) flag(rec, 'setgid', 'medium', 'permissions')
    if (!uidsFor.site.includes(ent.st.uid)) flag(rec, `uid-unexpected:${ent.st.uid}`, rec.exec ? 'medium' : 'low', 'permissions')
    if (rec.verdict !== 'KNOWN') {
      if (ent.st.mode & 0o111 && !rec.exec) flag(rec, 'exec-bit', 'low', 'permissions')
      if (name[0] === '.' && !isHt) flag(rec, 'dotfile', 'low', 'generated-or-scratch')
      if (EDITOR_COPY.test(name)) flag(rec, 'editor-copy', rec.reach ? 'medium' : 'low', 'stale-copy')
      if (ent.st.size > 10 * ONE_MB) flag(rec, 'large-file', 'medium', 'binary-or-archive')
      if (lastDeploy !== null) {
        rec.age = ent.st.mtimeMs - lastDeploy
        if (rec.age > 60000) flag(rec, 'newer-than-last-deploy', rec.exec ? 'high' : 'low', 'other')
      }
    } else if (lastDeploy !== null) rec.age = ent.st.mtimeMs - lastDeploy
    if (secretName) flag(rec, 'secret-shaped-name', 'high', 'secret')
    // Content-type facts. An exact committed file was reviewed as code; the only thing worth saying about a
    // shipped .sql (schema, seed with cost prices) is that it must NOT be readable by URL.
    if (exact) {
      if (DUMP_EXT.test(name) && rec.reach) flag(rec, 'sql-dump', 'high', 'binary-or-archive')
    } else {
      if (DUMP_EXT.test(name) || rec.type === 'SQL dump') flag(rec, 'sql-dump', rec.reach ? 'high' : 'medium', 'binary-or-archive')
      if (ARCHIVE_EXT.test(name) || ARCHIVE.has(rec.type)) flag(rec, 'archive', rec.reach ? 'high' : 'medium', 'binary-or-archive')
      // payment and access trails belong above the web root (SERVER-LAYOUT.md); a denied rule is one config line
      if (LOG_EXT.test(name)) flag(rec, 'log-in-web-root', rec.reach ? 'high' : 'medium', 'secret')
      if (rec.type === 'ELF' || rec.type === 'PE/DOS' || rec.type === 'shell script') flag(rec, 'executable-binary', 'high', 'binary-or-archive')
      if (phpInside && !rec.exec) flag(rec, 'php-in-non-php-file', 'high', 'webshell-or-obfuscated-code')
      if (rec.type === 'PEM block') flag(rec, 'secret-private-key', 'high', 'secret')
      if (PHP_DOUBLE.test(name)) flag(rec, 'double-extension', 'high', 'webshell-or-obfuscated-code')
    }
    if (rec.exec && rec.reach && rec.verdict !== 'KNOWN') flag(rec, 'executable-in-web-root', 'high', 'webshell-or-obfuscated-code')
    else if (rec.exec && !rec.reach && rec.verdict !== 'KNOWN') flag(rec, 'executable-denied-by-rule', 'medium', 'webshell-or-obfuscated-code')

    // ---- signatures: not on an exact repo match (already reviewed code), strong ones only on referenced bundles
    if (buf && !exact && !secretName) {
      const tier = rec.rule === 'referenced-by-live-index' ? 'strong' : 'all'
      const lang = isHt || /\.user\.ini$|^php\.ini$/i.test(name) ? 'ht' : rec.exec || PHP_ALT.test(name) ? 'php' : /\.(?:m?js|cjs|html?|svg|xml)$/i.test(name) ? 'js' : 'any'
      const hits = scanText(buf.toString('latin1'), lang, tier, phpInside ? ['php'] : [])
      for (const h of hits) { rec.sigs.push(h); flag(rec, `sig:${h.name}`, h.sev, h.kind) }
    }

    // ---- escalation: unknown + a risk signal = SUSPICIOUS
    if (rec.verdict === 'UNKNOWN' && rec.flags.some((f) => f.sev === 'high' || ESCALATE.test(f.name))) { rec.verdict = 'SUSPICIOUS'; rec.sev = maxSev(rec.sev, 'medium') }
    // ... and a KNOWN file that now carries a signature or secret is not clean either
    if (rec.verdict === 'KNOWN' && rec.sigs.some((s) => s.sev === 'high')) { rec.verdict = 'SUSPICIOUS'; rec.why = `${rec.rule}: ${rec.why} — but it carries a signature` }
    return finish(rec, ent)
  }
  // Unknown + any high-severity signal is SUSPICIOUS; a dump, an archive, a credential-shaped name or a
  // polyglot is suspicious in the web root even where a rule happens to refuse it today.
  const ESCALATE = /^(?:sql-dump|archive|log-in-web-root|secret-shaped-name|php-in-non-php-file|double-extension|executable-binary|vcs-metadata)$/
  function setV(rec, verdict, rule, kind) { rec.verdict = verdict; rec.rule = rule; if (kind) rec.kind = kind }
  function finish(rec) {
    if (rec.verdict === 'SUSPICIOUS' && rec.sev === 'low') rec.sev = 'medium'
    // The finding's kind is the kind of its worst flag (a webshell signature outranks "not explained").
    const worst = rec.flags.filter((f) => f.kind).sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || (a.kind === 'orphan') - (b.kind === 'orphan'))[0]
    if (worst) rec.kind = worst.kind
    records.push(rec)
    return rec
  }

  const siteStat = stat('site')
  for (const [rel, ent] of siteEntries) {
    if (ent.vcs) {
      const rec = mkRec('site', ent, rel)
      rec.type = 'directory'; rec.reach = !denyModel(rel + '/x').denied
      setV(rec, 'SUSPICIOUS', null, 'secret'); flag(rec, 'vcs-metadata', 'high', 'secret')
      rec.why = 'version-control metadata in the web root: the repository (and its history) can be rebuilt from it'
      let n = 0
      ;(function count(d) { let es; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return } for (const e of es) { if (n > 5000) return; n++; if (e.isDirectory()) count(path.join(d, e.name)) } })(ent.abs)
      rec.why += ` (${n} entries inside, not listed)`
      siteStat.dirs++
      finish(rec)
      continue
    }
    if (ent.isDir && !ent.isLink) { siteStat.dirs++; continue }
    if (ent.isLink) { siteStat.links++ }
    judgeSiteFile(ent)
  }
  // directories: writable by anyone, setgid, macOS leftovers, listing open
  let dirsListingOpen = 0, dirsNoIndexListingOff = 0
  const effIndexes = (rel) => { const parts = rel ? rel.split('/') : []; for (let i = parts.length; i >= 0; i--) { const h = htByDir.get(parts.slice(0, i).join('/')); if (h && h.indexes !== null) return h.indexes } return true }
  const indexNames = (htByDir.get('')?.index ?? ['index.html', 'index.php']).map((s) => s.toLowerCase())
  for (const d of [{ rel: '', abs: siteAbs, st: fs.existsSync(siteAbs) ? fs.lstatSync(siteAbs) : null }, ...siteDirs]) {
    if (!d.st) continue
    const rec = mkRec('site', d, d.rel || '.')
    rec.type = 'directory'
    if (d.st.mode & 0o002) flag(rec, 'world-writable-dir', 'high', 'permissions')
    if (d.st.mode & 0o2000) flag(rec, 'setgid-dir', 'low', 'permissions')
    if (!uidsFor.site.includes(d.st.uid)) flag(rec, `uid-unexpected:${d.st.uid}`, 'low', 'permissions')
    if (/^(?:__MACOSX|\.Trash|\.AppleDouble)$/i.test(path.posix.basename(d.rel))) flag(rec, 'macos-leftover-dir', 'low', 'generated-or-scratch')
    if (/^(?:backups?|rollback|old|bak|tmp|temp|cache|uploads?)$/i.test(path.posix.basename(d.rel)) && d.rel) flag(rec, 'scratch-or-backup-dir-in-web-root', 'medium', 'stale-copy')
    let names = []
    try { names = fs.readdirSync(d.abs).map((x) => x.toLowerCase()) } catch { /* skip */ }
    if (names.length && !names.some((n) => indexNames.includes(n))) {
      if (effIndexes(d.rel)) { flag(rec, 'listing-open', 'medium', 'other'); dirsListingOpen++ } else dirsNoIndexListingOff++
    }
    if (rec.flags.length) { setV(rec, 'UNKNOWN', null, rec.kind); rec.why = rec.why || 'directory'; if (hasFlag(rec, 'world-writable-dir')) rec.verdict = 'SUSPICIOUS'; rec.isDir = true; finish(rec) }
  }

  // ================================================================ private/ (names, never contents)
  const privAbs = path.join(root, 'private')
  const privRules = rulesFor('private')
  const mediaDirsWithFiles = new Map()   // media subfolder -> { files }
  const mediaHt = new Map()              // media/.../.htaccess -> does it refuse PHP
  function mayOpen(rel, size, name) { return size < SMALL && !SECRET_NAME.test(rel) && !SENSITIVE_NAME.test(name) }
  function judgeNameOnly(area, ent, relInArea, rules, uidKey) {
    const rec = mkRec(area, ent, relInArea)
    const a = stat(area)
    if (ent.isLink) { a.links++; rec.type = 'symlink'; let t = ''; try { t = fs.readlinkSync(ent.abs) } catch { /* x */ } rec.why = `-> ${safe(t)}`; flag(rec, 'symlink', 'medium', 'other'); setV(rec, 'UNKNOWN', null, 'other'); return finish(rec) }
    a.files++; a.bytes += ent.st.size
    rec.exec = execKind(ent.name)
    if (!ent.isFile) { rec.type = 'special file (not opened)'; setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'special-file', 'medium', 'other'); rec.why = 'a FIFO, socket or device node'; return finish(rec) }
    let sample = null
    if (mayOpen(relInArea, ent.st.size, ent.name)) {
      const b = io.read(ent.abs)
      if (b) { rec.sha = sha256(b).slice(0, 32); sample = b.subarray(0, 4096); rec.type = sniff(sample) }
    } else rec.type = SECRET_NAME.test(relInArea) ? 'credential-shaped (not opened)' : 'not opened'
    // a file inside a backup folder is explained by the folder's name
    const ruleRel = (area === 'backups' || area === 'releases') && relInArea.includes('/') ? relInArea.split('/')[0] + '/' : relInArea
    const r = matchRule(rules, ruleRel, rec, { phpInside: false })
    if (r) { setV(rec, r.verdict, r.id, r.kind ?? 'other'); rec.why = r.why; if (r.verdict !== 'KNOWN') flag(rec, r.id, r.sev ?? 'medium', r.kind) }
    else { setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'not-explained', 'low', 'orphan'); rec.why = 'no documented rule names this file' }
    // permissions are the whole point of a names-and-modes pass
    const cred = SECRET_NAME.test(relInArea)
    if (ent.st.mode & 0o002) flag(rec, 'world-writable', 'high', 'permissions')
    if (ent.st.mode & 0o4000) flag(rec, 'setuid', 'high', 'permissions')
    if (ent.st.mode & 0o004 && (cred || SENSITIVE_NAME.test(ent.name))) flag(rec, 'world-readable', cred ? 'high' : 'medium', 'permissions')
    if (r?.maxMode && (ent.st.mode & 0o777 & ~parseInt(r.maxMode, 8))) flag(rec, 'mode-wider-than-documented', cred ? 'high' : 'medium', 'permissions')
    if (!(uidsFor[uidKey] ?? []).includes(ent.st.uid)) flag(rec, `uid-unexpected:${ent.st.uid}`, 'low', 'permissions')
    if (r?.uids && !r.uids.includes(ent.st.uid)) flag(rec, `uid-unexpected:${ent.st.uid}`, 'medium', 'permissions')
    if (CRED_COPY.test(relInArea) && area !== 'private') flag(rec, 'credential-copy', 'medium', 'secret')
    if (EDITOR_COPY.test(ent.name) && rec.verdict !== 'KNOWN') flag(rec, 'editor-copy', 'low', 'stale-copy')
    if (lastDeploy !== null) rec.age = ent.st.mtimeMs - lastDeploy
    return finish(rec)
  }
  function judgeMediaFile(ent, relInArea) {
    const rec = mkRec('media', ent, relInArea)
    const a = stat('media'); a.files++; a.bytes += ent.st.size
    const sub = relInArea.split('/').slice(0, 2).join('/')    // media/products
    const m = mediaDirsWithFiles.get(sub) ?? { files: 0 }
    mediaDirsWithFiles.set(sub, m)
    rec.exec = execKind(ent.name)
    if (ent.isLink) { rec.type = 'symlink'; flag(rec, 'symlink', 'medium', 'other'); setV(rec, 'UNKNOWN', null, 'other'); return finish(rec) }
    if (!ent.isFile) { rec.type = 'special file (not opened)'; setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'special-file', 'medium', 'other'); return finish(rec) }
    const head = io.head(ent.abs, 4096)
    rec.type = sniff(head)
    const phpInside = !!head && /<\?(?:php|=)/i.test(head.toString('latin1'))
    if (ent.name === '.htaccess') {
      const b = io.read(ent.abs)
      const refuses = !!b && refusesPhp(b.toString('utf8'))
      mediaHt.set(relInArea, refuses)
      if (b) for (const h of scanText(b.toString('latin1'), 'ht', 'all')) { rec.sigs.push(h); flag(rec, `sig:${h.name}`, h.sev, h.kind) }
      setV(rec, refuses ? 'KNOWN' : 'UNKNOWN', refuses ? 'media-htaccess-refuses-php' : null, 'other')
      rec.why = refuses ? 'refuses PHP in the photo folder' : '.htaccess in the photo folder that does not refuse PHP'
      if (!refuses) flag(rec, 'media-htaccess-does-not-refuse-php', 'high', 'permissions')
    } else {
      m.files++
      const r = matchRule(rulesFor('media'), relInArea, rec, { phpInside })
      if (r) { setV(rec, 'KNOWN', r.id, r.kind ?? 'other'); rec.why = r.why } else setV(rec, 'UNKNOWN', null, 'other')
      if (!r) flag(rec, 'not-an-image', 'medium', 'wrong-place')
      if (rec.exec) flag(rec, 'php-in-media-folder', 'high', 'webshell-or-obfuscated-code')
      if (phpInside && !rec.exec) flag(rec, 'php-in-non-php-file', 'high', 'webshell-or-obfuscated-code')
      if (rec.type === 'ELF' || rec.type === 'shell script' || ARCHIVE.has(rec.type) || rec.type === 'SQL dump') flag(rec, 'not-an-image', 'high', 'binary-or-archive')
    }
    if (ent.st.mode & 0o002) flag(rec, 'world-writable', 'medium', 'permissions')
    if (!uidsFor.media.includes(ent.st.uid)) flag(rec, `uid-unexpected:${ent.st.uid}`, 'low', 'permissions')
    if (rec.verdict === 'UNKNOWN' && rec.flags.some((f) => /^(?:php-in-media-folder|php-in-non-php-file|not-an-image|media-htaccess-does-not-refuse-php)$/.test(f.name) && sevRank[f.sev] === 0)) rec.verdict = 'SUSPICIOUS'
    if (rec.verdict === 'KNOWN' && rec.flags.some((f) => f.name === 'php-in-non-php-file')) rec.verdict = 'SUSPICIOUS'
    return finish(rec)
  }
  if (fs.existsSync(privAbs)) {
    walk(privAbs, '', (ent) => {
      if (ent.isDir && !ent.isLink) {
        stat('private').dirs++
        const rec = mkRec('private', ent, ent.rel)
        rec.type = 'directory'
        if (ent.st.mode & 0o002) flag(rec, 'world-writable-dir', 'high', 'permissions')
        if (ent.st.mode & 0o004 && /^(?:config|backup-secrets|mail|backups)$/.test(ent.rel)) flag(rec, 'world-readable-dir', 'medium', 'permissions')
        if (rec.flags.length) { setV(rec, 'UNKNOWN', null, 'permissions'); rec.why = 'directory'; rec.isDir = true; finish(rec) }
        return
      }
      if (/^media\//.test(ent.rel)) { judgeMediaFile(ent, ent.rel); return }
      judgeNameOnly('private', ent, ent.rel, privRules, 'private')
    })
    // A photo folder with files and no .htaccess that refuses PHP: the "uploads .htaccess is missing" case.
    for (const [sub, m] of mediaDirsWithFiles) {
      const covered = mediaHt.get(`${sub}/.htaccess`) === true || mediaHt.get('media/.htaccess') === true
      if (m.files > 0 && !covered) {
        const rec = mkRec('media', { st: fs.lstatSync(path.join(privAbs, sub)), name: sub }, `${sub}/`)
        rec.type = 'directory'; rec.isDir = true
        setV(rec, 'UNKNOWN', null, 'permissions'); rec.why = `${m.files} photo file(s) and no .htaccess that refuses PHP (an uploaded .php would run)${mediaHt.has(`${sub}/.htaccess`) ? ' — the folder .htaccess exists but does not' : ''}`
        flag(rec, 'media-dir-without-php-deny', 'medium', 'permissions')
        finish(rec)
      }
    }
  }

  // ================================================================ backups/ and releases/ (names, sizes, modes)
  const backupsAbs = path.join(root, 'backups'), relAbs = path.join(root, 'releases')
  for (const [area, abs] of [['backups', backupsAbs], ['releases', relAbs]]) {
    if (!fs.existsSync(abs)) continue
    const rules = rulesFor(area)
    // The folder itself: backups hold dumps and credential copies, so it must not be listable or enterable by everyone.
    try {
      const st0 = fs.lstatSync(abs)
      if (area === 'backups' && st0.mode & 0o005) {
        const rec = mkRec(area, { st: st0, name: area }, './')
        rec.type = 'directory'; rec.isDir = true
        setV(rec, 'UNKNOWN', null, 'permissions'); flag(rec, 'world-readable-dir', 'medium', 'permissions')
        rec.why = 'the backups folder can be entered by every host user (it holds dumps and copies of configs): chmod 700'
        finish(rec)
      }
    } catch { /* unreadable */ }
    // One summary per top-level entry; individual lines only for what is sensitive or odd.
    const tops = new Map()
    walk(abs, '', (ent) => {
      const top = ent.rel.split('/')[0]
      const t = tops.get(top) ?? { files: 0, bytes: 0, php: 0, newest: 0, sensitive: 0, dir: false }
      tops.set(top, t)
      if (ent.isDir && !ent.isLink) { stat(area).dirs++; t.dir = true; if (ent.st.mode & 0o002) { const rec = mkRec(area, ent, ent.rel); rec.type = 'directory'; rec.isDir = true; flag(rec, 'world-writable-dir', 'high', 'permissions'); setV(rec, 'UNKNOWN', null, 'permissions'); finish(rec) } return }
      t.files++; t.bytes += ent.st.size; t.newest = Math.max(t.newest, ent.st.mtimeMs)
      if (/\.php$/i.test(ent.name)) t.php++
      const sensitive = SECRET_NAME.test(ent.rel) || SENSITIVE_NAME.test(ent.name)
      const odd = ent.isLink || (ent.st.mode & 0o6002) || (sensitive && (ent.st.mode & 0o004)) || CRED_COPY.test(ent.name) || (ent.st.mode & 0o111 && !ent.isDir && /\.(?:sh|php)$/i.test(ent.name))
      if (odd) { t.sensitive++; judgeNameOnly(area, ent, ent.rel, rules, area) } else { const a = stat(area); a.files++; a.bytes += ent.st.size; a.summarised++ }
    })
    for (const [top, t] of tops) {
      // Verdict for the top-level entry itself, by name.
      const fake = { st: { size: t.bytes, mtimeMs: t.newest, mode: 0o644, uid: 0, gid: 0, isSymbolicLink: () => false }, name: top, abs: path.join(abs, top) }
      const rec = mkRec(area, fake, top + (t.dir ? '/' : ''))
      rec.size = t.bytes; rec.mtime = t.newest; rec.type = t.dir ? `directory (${t.files} files)` : 'file'; rec.mode = '-'; rec.uid = -1; rec.isSummary = true
      const rr = matchRule(rules, top + (t.dir ? '/' : ''), rec, { phpInside: false }) ?? matchRule(rules, top, rec, { phpInside: false })
      if (rr) { setV(rec, rr.verdict, rr.id, rr.kind ?? 'stale-copy'); rec.why = rr.why } else { setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'not-explained', 'low', 'orphan'); rec.why = 'no documented rule names this entry' }
      if (t.php) rec.why += ` · ${t.php} .php file(s) inside`
      if (lastDeploy !== null) rec.age = t.newest - lastDeploy
      if (t.dir) rec.size = t.bytes
      // the stat above counted files; only the summary row is added here
      records.push(rec)
    }
  }

  // ================================================================ loose files and old site copies at /sporta
  const topRules = rulesFor('top'), copyRules = rulesFor('copy')
  for (const e of topNames) {
    if (AREA_OF_TOP(e.name)) continue
    const abs = path.join(root, e.name)
    let st
    try { st = fs.lstatSync(abs) } catch { unreadable++; continue }
    walked++
    if (st.isDirectory() && !st.isSymbolicLink()) {
      // an old site copy / staging / rollback folder: counted and summarised, never listed file by file
      const sum = { files: 0, bytes: 0, php: 0, newest: 0, ww: 0, setuid: 0, vcs: 0, links: 0 }
      walk(abs, '', (ent) => {
        if (ent.isDir && !ent.isLink) { if (/^\.git$/i.test(ent.name)) sum.vcs++; if (ent.st.mode & 0o002) sum.ww++; return }
        if (ent.isLink) { sum.links++; return }
        sum.files++; sum.bytes += ent.st.size; sum.newest = Math.max(sum.newest, ent.st.mtimeMs)
        if (/\.(?:php\d?|phtml|phar)$/i.test(ent.name)) sum.php++
        if (ent.st.mode & 0o002) sum.ww++
        if (ent.st.mode & 0o6000) sum.setuid++
      })
      const a = stat('copy'); a.dirs++; a.files += sum.files; a.bytes += sum.bytes; a.summarised += sum.files
      const rec = mkRec('copy', { st, name: e.name, abs }, e.name + '/')
      rec.size = sum.bytes; rec.mtime = sum.newest || st.mtimeMs; rec.type = `directory (${sum.files} files, ${sum.php} php)`; rec.isSummary = true
      const r = matchRule(copyRules, e.name + '/', rec, { phpInside: false })
      if (r) { setV(rec, r.verdict, r.id, r.kind ?? 'stale-copy'); rec.why = r.why } else { setV(rec, 'UNKNOWN', null, 'other'); flag(rec, 'not-explained', 'low', 'orphan'); rec.why = 'a folder under /docker/sporta that no document names' }
      if (sum.vcs) flag(rec, 'vcs-metadata', 'medium', 'secret')
      if (sum.ww) flag(rec, `world-writable-entries:${sum.ww}`, 'medium', 'permissions')
      if (sum.setuid) flag(rec, `setuid-entries:${sum.setuid}`, 'high', 'permissions')
      if (sum.links) flag(rec, `symlinks:${sum.links}`, 'low', 'other')
      if (!uidsFor.copy.includes(st.uid)) flag(rec, `uid-unexpected:${st.uid}`, 'low', 'permissions')
      if (rec.verdict === 'UNKNOWN' && (sum.vcs || sum.setuid)) rec.verdict = 'SUSPICIOUS'
      if (lastDeploy !== null) rec.age = rec.mtime - lastDeploy
      records.push(rec)
    } else {
      judgeNameOnly('top', { abs, rel: e.name, name: e.name, st, isLink: st.isSymbolicLink(), isDir: false, isFile: st.isFile() }, e.name, topRules, 'top')
    }
  }

  // ================================================================ totals
  for (const r of records) {
    const a = stat(r.area === 'media' ? 'media' : r.area)
    if (r.isDir || r.isSummary) { /* counted with their files */ }
    if (r.verdict === 'KNOWN') a.known++; else if (r.verdict === 'UNKNOWN') a.unknown++; else a.suspicious++
    if (r.flags.length || r.verdict !== 'KNOWN') a.flagged++
  }
  const ranked = [...records].sort(cmpRec)
  const findings = ranked.filter((r) => r.verdict !== 'KNOWN' || r.flags.length)
  const counts = { KNOWN: 0, UNKNOWN: 0, SUSPICIOUS: 0, flaggedKnown: 0, judged: records.length }
  const bySev = { high: 0, medium: 0, low: 0 }, byKind = {}, byRule = {}
  for (const r of records) {
    counts[r.verdict]++
    if (r.verdict === 'KNOWN' && r.flags.length) counts.flaggedKnown++
    if (r.verdict === 'KNOWN') byRule[r.rule ?? '-'] = (byRule[r.rule ?? '-'] ?? 0) + 1
  }
  for (const r of findings) { bySev[r.sev]++; byKind[r.kind] = (byKind[r.kind] ?? 0) + 1 }
  // Which committed version is live: head, or how many versions behind (the add-ons are deployed by hand and by job).
  const versions = { head: 0, older: 0, behind: [] }
  for (const r of records) {
    const m = /^repo:(head|old(\d+))$/.exec(r.rule ?? '')
    if (!m) continue
    if (m[1] === 'head') versions.head++
    else { versions.older++; versions.behind.push([r.path, Number(m[2])]) }
  }
  versions.behind.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const reachableExec = records.filter((r) => r.area === 'site' && r.executes && r.verdict !== 'KNOWN').length
  const newestSite = records.filter((r) => r.area === 'site' && !r.isDir).reduce((m, r) => Math.max(m, r.mtime), 0)
  return {
    root, manifestSha: mf.sha, manifestFiles: mf.byPath.size, manifestVersions: mf.versions, walked, truncated, unreadable,
    build, lastDeploy: lastDeploy === null ? null : { name: lastDeployName, ms: lastDeploy, src: lastDeploySrc }, newestSite,
    areas: areaStats, counts, bySev, byKind, byRule, versions, reachableExec, dirsListingOpen, dirsNoIndexListingOff,
    reachedCount: reached.size, reached, records: ranked, findings,
  }
}
function cmpRec(a, b) {
  const v = { SUSPICIOUS: 0, UNKNOWN: 1, KNOWN: 2 }
  return sevRank[a.sev] - sevRank[b.sev] || v[a.verdict] - v[b.verdict] || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.area + a.path < b.area + b.path ? -1 : 1)
}

// ============================================================ 7. OUTPUT
const age = (ms) => {
  if (ms === null || ms === undefined) return '-'
  const s = ms < 0 ? '-' : '+', a = Math.abs(ms) / 1000
  return a < 3600 ? `${s}${Math.round(a / 60)}m` : a < 172800 ? `${s}${Math.round(a / 3600)}h` : `${s}${Math.round(a / 86400)}d`
}
export function fmtRecord(r) {
  const sig = r.sigs.map((s) => `${s.name}@${s.line}${s.mask ? ':' + s.mask : ''}`).join(',')
  const fl = r.flags.map((f) => f.name).join(',')
  const reach = r.reach === null || r.reach === undefined ? '-' : r.reach ? 'Y' : 'N'
  const ex = r.exec ? (r.executes ? r.exec : r.exec + '(denied)') : '-'
  return `${r.sev[0].toUpperCase()} ${r.verdict.padEnd(10)} ${r.kind} ${r.area}:${safe(r.path)} sz=${r.size} mt=${iso(r.mtime)} md=${r.mode} uid=${r.uid} ty=${safe(r.type)} sha=${r.sha ? r.sha.slice(0, 12) : '-'} rch=${reach} ex=${ex} age=${age(r.age)}`
    + `${r.rule ? ' rule=' + r.rule : ''}${fl ? ' flags=' + fl : ''}${sig ? ' sig=' + sig : ''}${r.why && r.verdict !== 'KNOWN' ? ' why=' + safe(r.why.slice(0, 110)) : ''}`
}
// Low findings are grouped by the folder they sit in (two levels deep at most), so 700 old chunks are one line.
const groupDir = (r) => r.path.replace(/\/$/, '').split('/').slice(0, -1).slice(0, 2).join('/') || '(root)'
function groupKey(r) { return `${r.sev}|${r.verdict}|${r.kind}|${r.flags.find((f) => f.sev === r.sev)?.name ?? r.rule ?? '-'}|${r.area}:${groupDir(r)}` }
export function render(res, o = {}) {
  const maxLines = o.maxLines ?? 230
  const L = []
  const A = res.areas
  L.push(`FILES_SCAN root=${res.root} walked=${res.walked}${res.truncated ? ' TRUNCATED' : ''} unreadable=${res.unreadable} manifest=${String(res.manifestSha).slice(0, 8)} paths=${res.manifestFiles} versions=${res.manifestVersions}`)
  L.push(`BUILD index.html ${res.build.kind}${res.build.sha ? ` sha=${res.build.sha} size=${res.build.size} mtime=${iso(res.build.mtime)}` : ''}`)
  L.push(`DEPLOY last=${res.lastDeploy ? `${res.lastDeploy.name} (${iso(res.lastDeploy.ms)}, from ${res.lastDeploy.src}/)` : 'none found'} newest_site_file=${iso(res.newestSite)}`)
  L.push(`COUNTS judged=${res.counts.judged} KNOWN=${res.counts.KNOWN} (flagged ${res.counts.flaggedKnown}) UNKNOWN=${res.counts.UNKNOWN} SUSPICIOUS=${res.counts.SUSPICIOUS} · findings high=${res.bySev.high} medium=${res.bySev.medium} low=${res.bySev.low}`)
  L.push(`KINDS ${Object.entries(res.byKind).sort().map(([k, n]) => `${k}=${n}`).join(' ') || 'none'}`)
  L.push(`MODEL executable+unknown in web-reachable dirs=${res.reachableExec} · dirs listing OPEN=${res.dirsListingOpen} (listing refused by -Indexes: ${res.dirsNoIndexListingOff}) · reference walk reached ${res.reachedCount} site files`)
  for (const [a, s] of Object.entries(A)) L.push(`AREA ${a} files=${s.files} dirs=${s.dirs} links=${s.links} bytes=${s.bytes} summarised=${s.summarised} · KNOWN=${s.known} UNKNOWN=${s.unknown} SUSPICIOUS=${s.suspicious}`)
  L.push(`REPO_VERSIONS ${res.versions.head} files are exactly the repo's current (HEAD of the manifest) version; ${res.versions.older} are an OLDER committed version${res.versions.behind.length ? ` (most behind: ${res.versions.behind.slice(0, 6).map(([p, n]) => `${safe(p)}=${n} back`).join(' ')})` : ''}`)
  const folded = {}
  for (const [k, n] of Object.entries(res.byRule)) { const key = /^repo:old\d+$/.test(k) ? 'repo:old' : k; folded[key] = (folded[key] ?? 0) + n }
  const rules = Object.entries(folded).sort((a, b) => b[1] - a[1])
  L.push(`RULES ${rules.slice(0, 14).map(([k, n]) => `${k}=${n}`).join(' ')}${rules.length > 14 ? ` … +${rules.length - 14} more rules` : ''}`)
  // findings: one line each for high/medium/suspicious, grouped lines for the low rest, inside the line budget
  const f = res.findings.filter((r) => (!o.verdict || o.verdict.includes(r.verdict)) && (!o.area || r.area === o.area))
  const room = Math.max(10, maxLines - L.length - 3)
  const isMajor = (r) => r.sev !== 'low' || r.verdict === 'SUSPICIOUS'
  const major = f.filter(isMajor), minor = f.filter((r) => !isMajor(r))
  const groups = new Map()
  for (const r of minor) { const k = groupKey(r); const g = groups.get(k) ?? { n: 0, bytes: 0, ex: [], r }; g.n++; g.bytes += r.size; if (g.ex.length < 3) g.ex.push(path.posix.basename(r.path)); groups.set(k, g) }
  const groupList = [...groups.values()]
  let gShow = Math.min(groupList.length, Math.max(6, Math.floor(room / 5)))
  const mShow = Math.min(major.length, room - gShow)
  gShow = Math.min(groupList.length, room - mShow)
  L.push(`-- findings: ${f.length} (${major.length} high/medium/suspicious, ${minor.length} low in ${groupList.length} groups) --`)
  for (const r of major.slice(0, mShow)) L.push('F ' + fmtRecord(r))
  for (const g of groupList.slice(0, gShow)) {
    L.push(`G ${g.r.sev[0].toUpperCase()} ${g.r.verdict} ${g.r.kind} ${safe(g.r.area + ':' + groupDir(g.r))} count=${g.n} bytes=${g.bytes}${g.r.rule ? ' rule=' + g.r.rule : ''} flags=${g.r.flags.map((x) => x.name).join(',') || '-'} e.g. ${g.ex.map(safe).join(' ')}`)
  }
  const hidden = (major.length - mShow) + (groupList.length - gShow)
  if (hidden > 0) L.push(`F ... ${hidden} more finding line(s) not printed: page every finding, ${o.pageSize ?? 200} per page, with --page 1 (SCAN_PAGE=1), same order`)
  L.push('FILES_SCAN_DONE')
  return L
}
export function renderPage(findings, page, pageSize, header = []) {
  const total = Math.max(1, Math.ceil(findings.length / pageSize))
  const L = [...header, `PAGE ${page}/${total} findings ${findings.length} (${pageSize} per page, severity order)`]
  for (const r of findings.slice((page - 1) * pageSize, page * pageSize)) L.push('F ' + fmtRecord(r))
  L.push(page < total ? `PAGE_MORE next=${page + 1}` : 'PAGE_END')
  return L
}
const strip = (r) => { const { _mode, ...rest } = r; return rest }
export const detailsNdjson = (res) => res.findings.map((r) => JSON.stringify(strip(r))).join('\n') + '\n'

// ============================================================ 8. CLI
function parseUids(s) {
  const out = {}
  for (const part of String(s ?? '').split(';').filter(Boolean)) { const [k, v] = part.split('='); out[k.trim()] = v.split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x)) }
  return out
}
async function main() {
  const argv = process.argv.slice(2)
  const arg = (f, env) => { const i = argv.indexOf(f); if (i >= 0) return argv[i + 1]; return env && process.env[env] ? process.env[env] : undefined }
  const has = (f) => argv.includes(f)
  const pageSize = Number(arg('--page-size', 'SCAN_PAGE_SIZE') ?? 200)
  const pageArg = arg('--page', 'SCAN_PAGE')
  const page = pageArg ? Math.max(1, Number(pageArg)) : 0
  const verdict = (arg('--verdict', 'SCAN_VERDICT') ?? '').split(',').filter(Boolean)
  const area = arg('--area', 'SCAN_AREA')
  const readFile = arg('--read')
  if (readFile) {
    const rows = fs.readFileSync(readFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => (!verdict.length || verdict.includes(r.verdict)) && (!area || r.area === area))
    for (const l of renderPage(rows, page || 1, pageSize, [`DETAILS_FILE ${readFile}`])) console.log(l)
    return
  }
  const manifestPath = arg('--manifest', 'SCAN_MANIFEST')
  if (!manifestPath) { console.error('FILES_SCAN_FAIL --manifest <expected-files manifest.json> is required (make-expected-manifest.mjs makes it)'); process.exit(2) }
  const root = arg('--root', 'SCAN_ROOT') ?? '/sporta'
  if (!fs.existsSync(path.join(root, 'site', 'index.html'))) { console.log(`FILES_SCAN_FAIL ${root}/site has no index.html — is /docker/sporta mounted read-only at ${root}?`); process.exit(1) }
  const res = scanLive({ root, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), uids: parseUids(arg('--uids', 'SCAN_UIDS')) })
  const details = arg('--details', 'SCAN_DETAILS')
  if (details) { try { fs.writeFileSync(details, detailsNdjson(res), { mode: 0o600 }) } catch (e) { console.log(`FILES_SCAN_NOTE could not write ${details}: ${e.code ?? e.message}`) } }
  if (has('--json')) { const { reached, ...rest } = res; console.log(JSON.stringify({ ...rest, records: res.records.map(strip), findings: undefined })); return }
  const lines = page
    ? renderPage(res.findings.filter((r) => (!verdict.length || verdict.includes(r.verdict)) && (!area || r.area === area)), page, pageSize, render(res, { maxLines: 12 }).slice(0, 5))
    : render(res, { maxLines: Number(arg('--max-lines', 'SCAN_MAX_LINES') ?? 230), pageSize, verdict: verdict.length ? verdict : null, area })
  for (const l of lines) console.log(l)
  if (arg('--fail-on', 'SCAN_FAIL_ON') === 'suspicious' && res.counts.SUSPICIOUS > 0) process.exit(1)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.log(`FILES_SCAN_FAIL ${e.message}`); process.exit(1) })
}
