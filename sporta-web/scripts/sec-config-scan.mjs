#!/usr/bin/env node
// SEC-CONFIG SCAN - read-only security scan of WHERE THE LIVE CONFIGURATION LIVES
// and whether anyone but the right local user can read it.
//
// Runs ON the VPS in a one-shot node:alpine job with /docker/sporta mounted
// read-only (CLAUDE.md, "Probing the live site"). SEC_MODE picks one part:
//
//   layout  names, types, modes, owners and sizes of /sporta, /sporta/private
//           (the media mounts are summarised, never listed), the backups, the
//           compose/Dockerfile/shell files (printed with every secret-looking
//           value replaced by its key name and length), the payment-log and
//           token-cache directories and the admin-session directory.
//   site    every file under site/ by lstat: PHP files compared with the repo at
//           SEC_SHA by git blob hash (identical / differs / UNKNOWN), webshell
//           signatures in anything that is not byte-identical to the repo,
//           PHP hidden in non-PHP files, leftover setup tools, sensitive-looking
//           names inside the web root, symlinks that leave the web root,
//           world-writable entries and a uid:gid census.
//   keys    the store, KNET and T-Pay config files: key NAMES with a verdict
//           (present-nonempty / present-empty / absent / placeholder / equals the
//           shipped example) and a length bucket. VALUES ARE NEVER PRINTED. The
//           only values shown are on an allow-list of non-secret settings (env
//           mode, public URLs, file paths, numbers).
//   http    GET only, about 150 requests 150 ms apart, through the host's own
//           Traefik exactly as scripts/live-scan.mjs does: is any config file,
//           log, token cache, backup or compose file reachable by URL. A body
//           is never printed; only status, type, length and a few yes/no flags.
//
// Writes nothing (the mount is read-only; the container's own /tmp is not used).
// Sends no body, credential, cookie or key. Prints no secret value.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import crypto from 'node:crypto'
import tls from 'node:tls'
import zlib from 'node:zlib'

const MODE = process.env.SEC_MODE || 'layout'
const SHA = process.env.SEC_SHA || 'HEAD'
const HOST = 'www.sporta.com.kw'
const ROOT = process.env.SEC_ROOT || '/sporta'
const SITE = `${ROOT}/site`
const PRIVATE = `${ROOT}/private`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const say = (s = '') => out.push(s)
const flush = (n = 30) => { for (let i = 0; i < out.length; i += n) console.log(out.slice(i, i + n).join('\n')); out.length = 0 }
const oct = (m) => (m & 0o7777).toString(8).padStart(4, '0')
const own = (st) => `${st.uid}:${st.gid}`
const kind = (st) => (st.isSymbolicLink() ? 'l' : st.isDirectory() ? 'd' : st.isFile() ? 'f' : 'o')
const SENSITIVE = /(config|secret|passw|token|credential|\.env|id_rsa|\.pem|\.key$|\.p12|\.pfx|\.sql|dump|\.sqlite|\.db$|msmtprc|htpasswd|\.log$|\.bak|\.old|\.orig|\.save|~$|\.swp|\.zip|\.tar|\.gz|\.tgz)/i

function lst(p) { try { return fs.lstatSync(p) } catch { return null } }
function ls(p) { try { return fs.readdirSync(p, { withFileTypes: true }) } catch { return [] } }
// Every entry under dir (lstat, symlinks not followed). skip(rel, isDir) prunes.
function walk(dir, skip = () => false, maxDepth = 12) {
  const res = []
  const visit = (d, depth) => {
    for (const e of ls(d)) {
      const abs = path.join(d, e.name)
      const rel = path.relative(dir, abs)
      const st = lst(abs)
      if (!st) continue
      const isDir = st.isDirectory()
      if (skip(rel, isDir)) { res.push({ abs, rel, st, pruned: true }); continue }
      res.push({ abs, rel, st })
      if (isDir && depth < maxDepth) visit(abs, depth + 1)
    }
  }
  visit(dir, 0)
  return res
}

// ------------------------------------------------------------ redaction
// A line of a compose file, Dockerfile or shell script, with any secret-looking
// value replaced by "<redacted len=N>". Key names stay; values do not.
const SECRET_KEY = /(pass|secret|token|key|pwd|auth|credential|salt|private)/i
const KV = /\b([A-Za-z_][A-Za-z0-9_.-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,\[\]{}]+)/g
function redactLine(line) {
  line = line.replace(KV, (all, k, sep, v) => {
    const bare = v.replace(/^['"]|['"]$/g, '')
    if (!SECRET_KEY.test(k) || bare === '' || /^\$\{?[A-Za-z_]/.test(bare)) return all
    if (/^\/(run|var|etc|proc|docker)\//.test(bare)) return all
    return `${k}${sep}<redacted len=${bare.length}>`
  })
  line = line.replace(/(\w+:\/\/)([^\s/:@]+):([^\s@]+)@/g, '$1$2:<redacted>@')
  line = line.replace(/[A-Za-z0-9+\/=_-]{32,}/g, (t) => (/[\/.]/.test(t) && !/^[0-9a-f]{32,}$/.test(t) && !/=/.test(t) ? t : `<redacted len=${t.length}>`))
  return line
}

// ================================================================ layout
function layout() {
  say(`SEC_LAYOUT start sha=${SHA.slice(0, 8)} ${new Date().toISOString()}`)
  say('== A. /sporta top level (type mode uid:gid size-or-entries name)')
  for (const e of ls(ROOT).sort((a, b) => a.name.localeCompare(b.name))) {
    const st = lst(path.join(ROOT, e.name))
    if (!st) continue
    const n = st.isDirectory() ? `${ls(path.join(ROOT, e.name)).length}e` : `${st.size}B`
    say(`${kind(st)} ${oct(st.mode)} ${own(st)} ${n} ${e.name}`)
  }
  const rootSt = lst(ROOT)
  say(`/sporta itself: ${oct(rootSt.mode)} ${own(rootSt)}`)

  say('== B. private/ (media summarised, not listed)')
  const priv = walk(PRIVATE, (rel, isDir) => isDir && /(^|\/)media$/.test(rel) === false && false, 5)
  const media = []
  for (const x of priv) {
    if (/(^|\/)media(\/|$)/.test(x.rel) && x.rel !== 'media') { continue }
    if (x.rel === 'media') { media.push(x); }
    if (/(^|\/)tts-cache\//.test(x.rel)) continue
    const extra = x.st.isSymbolicLink() ? ` -> ${fs.readlinkSync(x.abs)}` : ''
    const flag = kind(x.st) === 'f' && SENSITIVE.test(x.rel) && (x.st.mode & 0o004) ? ' WORLD-READABLE' : ''
    const flag2 = (x.st.mode & 0o002) && !x.st.isSymbolicLink() ? ' WORLD-WRITABLE' : ''
    say(`${kind(x.st)} ${oct(x.st.mode)} ${own(x.st)} ${x.st.isDirectory() ? '' : x.st.size + 'B '}private/${x.rel}${extra}${flag}${flag2}`)
  }
  // tts-cache summary
  for (const d of ['voice/tts-cache']) {
    const dir = path.join(PRIVATE, d)
    if (lst(dir)) {
      const files = walk(dir).filter((x) => x.st.isFile())
      const modes = {}
      for (const f of files) modes[oct(f.st.mode)] = (modes[oct(f.st.mode)] ?? 0) + 1
      say(`private/${d}: ${files.length} files, modes ${JSON.stringify(modes)}, owners ${[...new Set(files.map((f) => own(f.st)))].join(',')}`)
    }
  }
  say('== C. media mounts (summary)')
  const mdir = path.join(PRIVATE, 'media')
  if (lst(mdir)) {
    const all = walk(mdir)
    const ext = {}, odd = [], phpish = [], bad = []
    for (const f of all.filter((x) => x.st.isFile())) {
      const e = path.extname(f.rel).toLowerCase() || path.basename(f.rel)
      ext[e] = (ext[e] ?? 0) + 1
      if (/\.(php\d?|phtml|phar|pht|inc)$/i.test(f.rel)) phpish.push(f.rel)
      if (!/\.(png|jpe?g|webp|gif|avif|ico)$/i.test(f.rel)) odd.push(f.rel)
      // magic-number check of image-named files (first 12 bytes only)
      if (/\.(png|jpe?g|webp|gif)$/i.test(f.rel)) {
        const fd = fs.openSync(f.abs, 'r'); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd)
        const okm = /\.png$/i.test(f.rel) ? b[0] === 0x89 && b[1] === 0x50 : /\.jpe?g$/i.test(f.rel) ? b[0] === 0xff && b[1] === 0xd8
          : /\.webp$/i.test(f.rel) ? b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' : b.toString('latin1', 0, 3) === 'GIF'
        if (!okm) bad.push(f.rel)
      }
    }
    say(`media: ${all.filter((x) => x.st.isFile()).length} files, ${all.filter((x) => x.st.isDirectory()).length} dirs; ext ${JSON.stringify(ext)}`)
    say(`media non-image names: ${odd.length ? odd.slice(0, 20).join(' ') : 'none'}; php-like: ${phpish.length ? phpish.join(' ') : 'none'}; image-named files with wrong magic: ${bad.length ? bad.slice(0, 10).join(' ') : 'none'}`)
    const dm = {}, fm = {}
    for (const x of all) { const m = oct(x.st.mode) + ' ' + own(x.st); (x.st.isDirectory() ? dm : fm)[m] = ((x.st.isDirectory() ? dm : fm)[m] ?? 0) + 1 }
    say(`media dir modes ${JSON.stringify(dm)}; file modes ${JSON.stringify(fm)}`)
    for (const h of all.filter((x) => path.basename(x.rel) === '.htaccess')) {
      say(`-- media/${h.rel} (${h.st.size}B ${oct(h.st.mode)} ${own(h.st)})`)
      for (const l of fs.readFileSync(h.abs, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))) say('   ' + l)
    }
  } else say('no private/media')

  say('== D. admin-session dir, payment logs, token cache (host side of /var/lib/sporta = private/voice)')
  const voice = path.join(PRIVATE, 'voice')
  const vst = lst(voice)
  say(vst ? `private/voice: ${oct(vst.mode)} ${own(vst)}` : 'private/voice: absent')
  for (const n of ['admin-sessions', 'tts-cache', 'knet-payments.log', 'cbk-payments.log', 'pay-payments.log', '.cbk_token.json', 'cbk_token.json']) {
    const st = lst(path.join(voice, n))
    say(`  voice/${n}: ${st ? `${kind(st)} ${oct(st.mode)} ${own(st)} ${st.isFile() ? st.size + 'B mtime ' + st.mtime.toISOString().slice(0, 16) : ''}` : 'ABSENT'}`)
  }
  for (const e of ls(voice)) if (!['admin-sessions', 'tts-cache'].includes(e.name)) {
    const st = lst(path.join(voice, e.name)); if (!st) continue
    if (!['knet-payments.log', 'cbk-payments.log', 'pay-payments.log', '.cbk_token.json', 'cbk_token.json'].includes(e.name)) say(`  voice/${e.name}: ${kind(st)} ${oct(st.mode)} ${own(st)} ${st.isFile() ? st.size + 'B' : ''}`)
  }
  // Anything named like a payment log or token cache anywhere under /sporta outside site
  const hits = walk(ROOT, (rel, isDir) => /^(site|site-[a-z]+-\d+|private\/media)/.test(rel) && isDir || /node_modules/.test(rel), 8)
    .filter((x) => x.st.isFile() && /(payments\.log|cbk_token|token.*\.json)/i.test(x.rel))
  for (const h of hits) say(`  found ${h.rel} ${oct(h.st.mode)} ${own(h.st)} ${h.st.size}B`)

  say('== E. sensitive-named files outside site/ (grouped by top-level dir)')
  const rest = walk(ROOT, (rel, isDir) => isDir && (rel === 'site' || rel === 'private/media' || /node_modules$/.test(rel)), 8)
  const byTop = {}
  for (const x of rest) {
    if (x.pruned || !x.st.isFile()) continue
    const top = x.rel.split('/')[0]
    const g = (byTop[top] ??= { files: 0, sens: [], realCfg: [], worldReadSens: [] })
    g.files++
    const base = path.basename(x.rel)
    if (SENSITIVE.test(base) || /(^|\/)private\//.test(x.rel) && false) {
      if (/^config\.example\.php$/.test(base)) continue
      g.sens.push(x)
      if (/(^|-)config.*\.php$/.test(base) && !/example/.test(base)) g.realCfg.push(x)
      if (x.st.mode & 0o004) g.worldReadSens.push(x)
    }
  }
  for (const [top, g] of Object.entries(byTop).sort()) {
    const wr = g.worldReadSens.filter((x) => !/\.(md|txt)$/.test(x.rel))
    say(`${top}: ${g.files} files; sensitive-named ${g.sens.length}; config-php-like ${g.realCfg.length}; of the sensitive ones world-readable ${wr.length}`)
    for (const x of g.realCfg.slice(0, 12)) say(`   CFG ${oct(x.st.mode)} ${own(x.st)} ${x.st.size}B ${x.rel}`)
    for (const x of wr.slice(0, 8)) say(`   WORLD-READABLE ${oct(x.st.mode)} ${own(x.st)} ${x.st.size}B ${x.rel}`)
  }
  flush()

  say('== F. backups/ (entry mode owner, then sensitive files inside)')
  const bdir = path.join(ROOT, 'backups')
  const bents = ls(bdir).sort((a, b) => a.name.localeCompare(b.name))
  say(`backups: ${bents.length} entries`)
  for (const e of bents) {
    const abs = path.join(bdir, e.name)
    const st = lst(abs)
    if (!st) continue
    if (st.isDirectory()) {
      const inner = walk(abs, () => false, 4).filter((x) => x.st.isFile())
      const sens = inner.filter((x) => SENSITIVE.test(path.basename(x.rel)) && !/\.(html|js|css|mjs)$/.test(x.rel))
      const wr = inner.filter((x) => x.st.mode & 0o004)
      const cfg = inner.filter((x) => /config.*\.php$/i.test(x.rel) && !/example/.test(x.rel))
      say(`d ${oct(st.mode)} ${own(st)} ${inner.length}f ${e.name}${cfg.length ? ' CONFIG-COPIES=' + cfg.map((x) => `${x.rel}(${oct(x.st.mode)} ${own(x.st)})`).join(',') : ''}${sens.length ? ' sens=' + sens.slice(0, 6).map((x) => `${x.rel}(${oct(x.st.mode)})`).join(',') : ''}${wr.length && cfg.length ? ' world-readable-files=' + wr.length : ''}`)
    } else say(`${kind(st)} ${oct(st.mode)} ${own(st)} ${st.size}B ${e.name}${(st.mode & 0o004) && SENSITIVE.test(e.name) ? ' WORLD-READABLE' : ''}`)
  }
  flush()

  say('== G. compose / Dockerfile / shell / ini files under /sporta (depth<=2, not site/backups; values redacted)')
  const cfgFiles = walk(ROOT, (rel, isDir) => isDir && (/^(site|backups|releases|rollback|staging|private\/media|private\/voice)/.test(rel) || /^site-/.test(rel)), 2)
    .filter((x) => x.st.isFile() && /(\.ya?ml|dockerfile|\.sh|\.ini|\.conf|\.env|msmtprc|\.override\.|\.retired|\.bak)/i.test(path.basename(x.rel)))
  for (const f of cfgFiles) {
    const lines = fs.readFileSync(f.abs, 'utf8').split('\n')
    const secrets = lines.map((l, i) => [l, i + 1]).filter(([l]) => !l.trim().startsWith('#') && redactLine(l) !== l)
    say(`-- ${f.rel} ${oct(f.st.mode)} ${own(f.st)} ${f.st.size}B ${lines.length}L; secret-looking assignments: ${secrets.length}${secrets.length ? ' (' + secrets.slice(0, 6).map(([l, n]) => `L${n}`).join(',') + ')' : ''}`)
    if (/\.ya?ml$|dockerfile|\.ini$|msmtprc/i.test(path.basename(f.rel)) && lines.length <= 140) {
      for (const l of lines) if (l.trim() && !l.trim().startsWith('#')) say('   ' + redactLine(l).slice(0, 160))
    }
  }
  flush()
  say('SEC_LAYOUT done')
  flush()
}

// ================================================================ site
async function repoIndex() {
  const idx = new Map()   // basename -> [{sha, path, size}]
  try {
    const r = await fetch(`https://api.github.com/repos/hkspower/wain/git/trees/${SHA}?recursive=1`, { headers: { 'User-Agent': 'sporta-sec-config-scan', Accept: 'application/vnd.github+json' } })
    if (!r.ok) { say(`repo tree: HTTP ${r.status}; falling back to the tarball`); return await tarIndex(idx) }
    const j = await r.json()
    if (j.truncated) say('repo tree: TRUNCATED (comparison may miss files)')
    for (const t of j.tree) {
      if (t.type !== 'blob') continue
      const b = path.basename(t.path)
      if (!idx.has(b)) idx.set(b, [])
      idx.get(b).push({ sha: t.sha, path: t.path, size: t.size })
    }
    say(`repo tree: ${j.tree.length} entries at ${SHA.slice(0, 8)}`)
    return { idx, ok: true }
  } catch (e) { say(`repo tree: failed ${e.message}; falling back to the tarball`); return await tarIndex(idx) }
}
// Fallback: the commit's tarball from codeload (the route vps-deploy.mjs uses), parsed in memory.
async function tarIndex(idx) {
  try {
    const r = await fetch(`https://codeload.github.com/hkspower/wain/tar.gz/${SHA}`)
    if (!r.ok) { say(`tarball: HTTP ${r.status}`); return { idx, ok: false } }
    const tar = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()))
    let off = 0, n = 0
    while (off + 512 <= tar.length) {
      const h = tar.subarray(off, off + 512)
      if (h.every((b) => b === 0)) break
      const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '')
      const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8)
      const type = String.fromCharCode(h[156])
      const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '')
      const full = (prefix ? prefix + '/' : '') + name
      if (type === '0' || type === '\0') {
        const body = tar.subarray(off + 512, off + 512 + size)
        const b = path.basename(full)
        if (/\.(php|phtml|inc)$/i.test(b)) {
          if (!idx.has(b)) idx.set(b, [])
          idx.get(b).push({ sha: blobSha(body), path: full.split('/').slice(1).join('/'), size })
          n++
        }
      }
      off += 512 + Math.ceil(size / 512) * 512
    }
    say(`tarball: ${n} php files indexed at ${SHA.slice(0, 8)}`)
    return { idx, ok: true }
  } catch (e) { say(`tarball failed: ${e.message}`); return { idx, ok: false } }
}
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
const WEBSHELL = [
  ['eval-decode', /eval\s*\(\s*(base64_decode|gzinflate|str_rot13|gzuncompress|rawurldecode)/i],
  ['assert-input', /assert\s*\(\s*\$_(GET|POST|REQUEST|COOKIE)/i],
  ['exec-input', /(system|shell_exec|passthru|exec|popen|proc_open|pcntl_exec)\s*\(\s*\$_(GET|POST|REQUEST|COOKIE|SERVER)/i],
  ['dynamic-call-input', /\$_(GET|POST|REQUEST|COOKIE)\s*\[[^\]]+\]\s*\(/],
  ['preg-e', /preg_replace\s*\(\s*['"][^'"]*\/e['"]/i],
  ['known-shell', /(FilesMan|c99shell|r57shell|b374k|WSO\s*\d|WebShell|Mini\s*Shell|IndoXploit)/i],
  ['file-write-input', /(file_put_contents|fwrite|move_uploaded_file)\s*\([^;]*\$_(GET|POST|REQUEST|FILES)/i],
  ['create_function', /create_function\s*\(/i],
]

async function site() {
  say(`SEC_SITE start sha=${SHA.slice(0, 8)} ${new Date().toISOString()}`)
  const { idx, ok } = await repoIndex()
  const all = walk(SITE, () => false, 12)
  const files = all.filter((x) => x.st.isFile())
  const dirs = all.filter((x) => x.st.isDirectory())
  const links = all.filter((x) => x.st.isSymbolicLink())
  say(`site: ${files.length} files, ${dirs.length} dirs, ${links.length} symlinks, total ${(files.reduce((a, f) => a + f.st.size, 0) / 1048576).toFixed(1)} MB`)
  const siteSt = lst(SITE)
  say(`site root: ${oct(siteSt.mode)} ${own(siteSt)}`)

  say('== A. PHP-executable files under site/ (rel size mode uid:gid verdict)')
  const phpLike = files.filter((x) => /\.(php\d?|phtml|phar|pht|inc|phps)$/i.test(x.rel))
  const counts = { ident: 0, differs: 0, unknown: 0 }
  const suspicious = []
  const rows = []
  for (const f of phpLike) {
    const buf = fs.readFileSync(f.abs)
    const sha = blobSha(buf)
    const base = path.basename(f.rel)
    const cands = idx.get(base) ?? []
    const hit = cands.find((c) => c.sha === sha)
    let verdict
    if (hit) { counts.ident++; verdict = 'ident' }
    else if (cands.length) { counts.differs++; verdict = `DIFFERS(repo ${cands.slice(0, 2).map((c) => c.size + 'B').join('/')})` }
    else { counts.unknown++; verdict = ok ? 'UNKNOWN' : 'unchecked' }
    let sig = ''
    if (!hit) {
      const txt = buf.toString('latin1')
      sig = WEBSHELL.filter(([, re]) => re.test(txt)).map(([n]) => n).join('+')
      if (sig) suspicious.push(`${f.rel}:${sig}`)
    }
    const odd = /\.(phtml|phar|pht|inc|phps|php\d)$/i.test(f.rel) ? ' PHP-ALT-EXT' : ''
    const deep = /^(backups|images|cats|hero|assets|fonts|uploads?|media)\//i.test(f.rel) ? ' PHP-IN-MEDIA-OR-BACKUP-PATH' : ''
    rows.push(`${f.rel} ${f.st.size}B ${oct(f.st.mode)} ${own(f.st)} ${f.st.mtime.toISOString().slice(0, 10)} ${verdict}${sig ? ' SIG=' + sig : ''}${odd}${deep}`)
  }
  say(`php files: ${phpLike.length}; identical to a repo file ${counts.ident}; differ from repo ${counts.differs}; unknown to repo ${counts.unknown}`)
  say('-- not identical (differs/unknown), these are the ones to look at:')
  for (const r of rows.filter((r) => !/ ident( |$)/.test(r))) say('   ' + r)
  say('-- identical (names only):')
  say('   ' + rows.filter((r) => / ident( |$)/.test(r)).map((r) => r.split(' ')[0]).join(' '))
  say(`-- webshell signatures in non-identical php: ${suspicious.length ? suspicious.join(' ') : 'none'}`)
  flush()

  say('== B. PHP source hidden in non-PHP files (images, text, html, js, css, data) - files <=2 MB')
  const hidden = []
  let scanned = 0
  for (const f of files) {
    if (/\.(php\d?|phtml|phar|pht|inc|phps)$/i.test(f.rel) || f.st.size > 2 * 1048576) continue
    if (/\.(woff2?|ttf|otf|mp4|webm|zip|gz|map)$/i.test(f.rel)) continue
    scanned++
    const b = fs.readFileSync(f.abs)
    const t = b.toString('latin1')
    if (/<\?php|<\?=|<\?\s/.test(t)) hidden.push(`${f.rel}(${f.st.size}B ${oct(f.st.mode)})`)
  }
  say(`scanned ${scanned} non-php files; contain a PHP open tag: ${hidden.length ? hidden.slice(0, 25).join(' ') : 'none'}`)

  say('== C. leftover setup tools and sensitive-looking names inside the web root')
  const SETUP = /^(go-live\.html|selftest\.php|setup-config\.php|setup-admin\.php|preflight\.php|sporta-deploy\.php|index\.php|phpinfo\.php|info\.php|test\.php|adminer\.php|shell\.php|wp-.*|xmlrpc\.php|cmd\.php|upload\.php)$/i
  const left = files.filter((x) => SETUP.test(path.basename(x.rel)))
  for (const x of left) say(`SETUP-TOOL ${x.rel} ${x.st.size}B ${oct(x.st.mode)} ${own(x.st)}`)
  if (!left.length) say('no setup tool by name')
  const sens = files.filter((x) => SENSITIVE.test(path.basename(x.rel)) && !/^config\.example\.php$/.test(path.basename(x.rel)) && !/\.(js|css|html|png|jpe?g|webp|woff2?)$/.test(x.rel) || /(^|\/)\./.test(x.rel) && !/(^|\/)\.htaccess$/.test(x.rel) && !/\/\._/.test(x.rel) && !/^\.well-known/.test(x.rel))
  const grouped = {}
  for (const x of sens) { const k = path.dirname(x.rel) + ' [' + (path.extname(x.rel) || path.basename(x.rel)) + ']'; (grouped[k] ??= []).push(x) }
  for (const [k, v] of Object.entries(grouped).sort()) say(`   ${k}: ${v.length}${v.length <= 4 ? ' ' + v.map((x) => `${path.basename(x.rel)}(${oct(x.st.mode)} ${own(x.st)} ${x.st.size}B)`).join(' ') : ' e.g. ' + path.basename(v[0].rel)}`)
  const dot = files.filter((x) => /(^|\/)\._/.test(x.rel) || /\.DS_Store$/.test(x.rel))
  say(`macOS litter (._*, .DS_Store): ${dot.length}`)
  const bak = dirs.filter((d) => /(^|\/)backups$/.test(d.rel))
  for (const b of bak) {
    const inside = walk(b.abs, () => false, 4)
    const f = inside.filter((x) => x.st.isFile())
    say(`WEB-ROOT-BACKUPS ${b.rel}/ ${oct(b.st.mode)} ${own(b.st)}: ${ls(b.abs).length} backup folders, ${f.length} files, php ${f.filter((x) => /\.php$/.test(x.rel)).length}, config-like ${f.filter((x) => /config|\.env|token|passw|secret/i.test(path.basename(x.rel)) && !/example/.test(x.rel)).length}, sql/log/zip ${f.filter((x) => /\.(sql|log|zip|gz|tgz)$/.test(x.rel)).length}`)
  }
  flush()

  say('== D. symlinks (target; flagged when it leaves the web root)')
  if (!links.length) say('none under site/')
  for (const l of links) {
    const t = fs.readlinkSync(l.abs)
    const res = path.resolve(path.dirname(l.abs), t)
    say(`${l.rel} -> ${t} ${res.startsWith(SITE + '/') ? 'inside' : 'LEAVES-WEB-ROOT'}`)
  }
  // private/ and /sporta-level symlinks that point INTO site or out of /sporta
  const outer = walk(ROOT, (rel, isDir) => isDir && !/^(private)$/.test(rel) && rel.split('/').length > 1 || /node_modules|media/.test(rel), 3).filter((x) => x.st.isSymbolicLink())
  for (const l of outer.slice(0, 20)) say(`(outside site) ${l.rel} -> ${fs.readlinkSync(l.abs)}`)

  say('== E. world-writable / setuid / odd owners (whole /sporta, excluding media file bodies)')
  const every = walk(ROOT, (rel, isDir) => isDir && /^private\/media\/.+/.test(rel) || /node_modules/.test(rel), 9)
  const ww = every.filter((x) => !x.st.isSymbolicLink() && (x.st.mode & 0o002))
  const su = every.filter((x) => x.st.mode & 0o6000)
  say(`entries scanned ${every.length}; world-writable ${ww.length}; setuid/setgid ${su.length}`)
  for (const x of ww.slice(0, 25)) say(`   WORLD-WRITABLE ${kind(x.st)} ${oct(x.st.mode)} ${own(x.st)} ${x.rel}`)
  for (const x of su.slice(0, 10)) say(`   SETID ${oct(x.st.mode)} ${own(x.st)} ${x.rel}`)
  const census = {}
  for (const x of every) {
    const top = x.rel.split('/')[0].replace(/-\d{8}T.*$/, '-*').replace(/^site-(prev|failed|next)-.*/, 'site-copies')
    const key = `${top} ${own(x.st)}`
    census[key] = (census[key] ?? 0) + 1
  }
  say('owner census (top-level uid:gid count): ' + Object.entries(census).sort().map(([k, v]) => `${k}=${v}`).join(' | '))
  const sitemodes = {}
  for (const x of files) { const k = oct(x.st.mode) + ' ' + own(x.st); sitemodes[k] = (sitemodes[k] ?? 0) + 1 }
  say('site files mode+owner: ' + JSON.stringify(sitemodes))
  const dm = {}
  for (const x of dirs) { const k = oct(x.st.mode) + ' ' + own(x.st); dm[k] = (dm[k] ?? 0) + 1 }
  say('site dirs mode+owner: ' + JSON.stringify(dm))
  // php files readable by "other" is normal for the web server only if it is not www-data; show who must read them
  const phpPerm = {}
  for (const x of phpLike) { const k = oct(x.st.mode) + ' ' + own(x.st); phpPerm[k] = (phpPerm[k] ?? 0) + 1 }
  say('site php mode+owner: ' + JSON.stringify(phpPerm))
  const writableByWeb = phpLike.filter((x) => x.st.uid === 33 && (x.st.mode & 0o200))
  say(`php files owned by www-data AND owner-writable (a PHP bug could rewrite them): ${writableByWeb.length}${writableByWeb.length ? ' e.g. ' + writableByWeb.slice(0, 5).map((x) => x.rel).join(' ') : ''}`)
  const wdir = dirs.filter((x) => x.st.uid === 33 && (x.st.mode & 0o200))
  say(`site dirs owned by www-data and owner-writable: ${wdir.length}${wdir.length ? ' ' + wdir.slice(0, 8).map((x) => x.rel).join(' ') : ''}`)
  say('SEC_SITE done')
  flush()
}

// ================================================================= keys
// A deliberately PHP-free reader: finds 'key' => <literal> pairs, never evals.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => {
    // remove // and # comments that are not inside quotes (good enough for these flat arrays)
    let q = null
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (q) { if (c === '\\') i++; else if (c === q) q = null } else if (c === "'" || c === '"') q = c
      else if ((c === '/' && l[i + 1] === '/') || c === '#') return l.slice(0, i)
    }
    return l
  }).join('\n')
}
function parseConfig(src) {
  const t = stripComments(src)
  const res = new Map()
  const re = /['"]([A-Za-z0-9_]+)['"]\s*=>\s*/g
  let m
  while ((m = re.exec(t))) {
    const key = m[1]
    let i = re.lastIndex
    const c = t[i]
    let val, raw
    if (c === "'" || c === '"') {
      let j = i + 1; let s = ''
      while (j < t.length && t[j] !== c) { if (t[j] === '\\' && j + 1 < t.length) { s += t[j + 1]; j += 2 } else s += t[j++] }
      val = { type: 'string', v: s }; raw = t.slice(i, j + 1)
    } else if (c === '[' || t.slice(i, i + 5) === 'array') {
      let depth = 0, j = t.indexOf('[', i) >= 0 ? t.indexOf('[', i) : i
      const start = j
      for (; j < t.length; j++) { if (t[j] === '[') depth++; else if (t[j] === ']') { depth--; if (depth === 0) break } }
      const inner = t.slice(start + 1, j)
      const items = [...inner.matchAll(/'([^']*)'|"([^"]*)"|(\b\d+\b)/g)].map((x) => x[1] ?? x[2] ?? x[3])
      val = { type: 'array', v: items }; raw = inner
      re.lastIndex = j
    } else {
      const e = t.slice(i).search(/[,\n]/)
      raw = t.slice(i, e < 0 ? undefined : i + e).trim()
      if (/^(true|false)$/i.test(raw)) val = { type: 'bool', v: raw.toLowerCase() === 'true' }
      else if (/^null$/i.test(raw)) val = { type: 'null' }
      else if (/^-?\d+(\.\d+)?$/.test(raw)) val = { type: 'number', v: Number(raw) }
      else val = { type: 'expr', v: raw }
    }
    if (!res.has(key)) res.set(key, val)
  }
  return res
}
const PLACEHOLDER = /^(your[_ -]|change[_ -]?me|changeme|replace|example|xxx+|todo|placeholder|\.\.\.|<.*>|test_?key|secret|password|123456|admin)/i
const lenBucket = (n) => (n === 0 ? '0' : n < 8 ? '1-7' : n < 16 ? '8-15' : n === 16 ? '16' : n < 32 ? '17-31' : n < 64 ? '32-63' : '64+')
const charClass = (s) => (/^[0-9a-f]+$/i.test(s) ? 'hex' : /^[A-Za-z0-9+\/=_-]+$/.test(s) ? 'alnum/b64' : /\s/.test(s) ? 'has-space' : 'mixed')
const SECRETISH = /(pass|secret|key|token|pwd|_id$|^client_id|tranportal|encrp|salt|oauth)/i
const SHOW_OK = /^(env|language|callback_response|default_method)$|_url$|_base$|_page$|^log_file$|^token_cache_file$|_dir$|_hours$|_minutes$|_seconds$|^mysql_host$|^db_host$|^cron_.*enabled$/
const REQUIRED = {
  api: ['db_host', 'db_name', 'db_user', 'db_pass', 'warehouse_email', 'mail_from', 'mail_reply_to', 'cron_key', 'trusted_proxy_ips', 'rate_limit_secret', 'cod_hold_hours'],
  knet: ['tranportal_id', 'tranportal_password', 'resource_key', 'env', 'response_url', 'error_url', 'result_page_url', 'callback_response', 'log_file', 'mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'],
  tpay: ['client_id', 'client_secret', 'encrp_key', 'test_base', 'production_base', 'env', 'return_url', 'result_page_url', 'token_cache_file', 'log_file', 'mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'],
}
async function rawFile(p) {
  try { const r = await fetch(`https://raw.githubusercontent.com/hkspower/wain/${SHA}/${p}`); return r.ok ? await r.text() : null } catch { return null }
}
function verdict(key, v, example) {
  if (!v) return 'ABSENT'
  if (v.type === 'null') return 'present-empty(null)'
  if (v.type === 'bool') return SHOW_OK.test(key) || !SECRETISH.test(key) ? `bool ${v.v}` : 'bool'
  if (v.type === 'number') return SHOW_OK.test(key) || !SECRETISH.test(key) ? `number ${v.v}` : 'number'
  if (v.type === 'array') {
    const broad = v.v.filter((x) => /^(0\.0\.0\.0\/0|::\/0|\*)$/.test(x) || /\/([0-7])$/.test(x))
    return `array(${v.v.length})${broad.length ? ' BROAD-ENTRY' : ''}${v.v.length === 0 ? ' present-empty' : ''}`
  }
  if (v.type === 'expr') return `dynamic-expression(${/getenv|\$_ENV|\$_SERVER/.test(v.v) ? 'reads environment' : 'other'})`
  const s = v.v
  if (s === '') return 'present-empty'
  const bits = []
  if (example && example.type === 'string' && example.v === s && SECRETISH.test(key)) bits.push('EQUALS-SHIPPED-EXAMPLE')
  else if (SECRETISH.test(key) && (PLACEHOLDER.test(s) || /example\.(com|org)/i.test(s))) bits.push('PLACEHOLDER-LOOKING')
  if (s !== s.trim()) bits.push('LEADING/TRAILING-WHITESPACE')
  if (SHOW_OK.test(key) && !/[@]/.test(s) && !/\?/.test(s)) bits.push(`value=${s}`)
  else bits.push(`present-nonempty len=${lenBucket(s.length)}${key === 'resource_key' ? (s.length === 16 ? ' (is exactly 16)' : ' (NOT 16)') : ''} ${charClass(s)}`)
  return bits.join(' ')
}
async function keys() {
  say(`SEC_KEYS start sha=${SHA.slice(0, 8)} ${new Date().toISOString()} (key names + verdicts only; no secret value is printed)`)
  const find = (name) => {
    const hits = []
    for (const x of walk(ROOT, (rel, isDir) => isDir && (/^(backups|releases|rollback|staging|site-)/.test(rel) || /node_modules|media/.test(rel)), 5)) {
      if (x.st.isFile() && path.basename(x.rel) === name) hits.push(x)
    }
    return hits
  }
  const targets = {
    api: { file: 'private/api-config.php', example: 'sporta-web/dropin/php-store/config.example.php' },
    knet: { file: 'private/config/knet-config.php', example: 'sporta-web/dropin/php-knet/config.example.php' },
    tpay: { file: 'private/config/pay-config.php', example: 'sporta-web/dropin/php-cbk/config.example.php' },
  }
  const parsed = {}
  say('== A. config files by location, mode, owner')
  for (const [k, t] of Object.entries(targets)) {
    const abs = path.join(ROOT, t.file)
    const st = lst(abs)
    if (!st) { say(`${k}: ${t.file} ABSENT`); continue }
    const dir = lst(path.dirname(abs))
    const other = st.mode & 0o007
    say(`${k}: ${t.file} ${oct(st.mode)} ${own(st)} ${st.size}B; parent dir ${oct(dir.mode)} ${own(dir)}; readable-by-others=${other & 4 ? 'YES' : 'no'} writable-by-others=${other & 2 ? 'YES' : 'no'} group-writable=${st.mode & 0o020 ? 'YES' : 'no'}`)
    const src = fs.readFileSync(abs, 'utf8')
    parsed[k] = { map: parseConfig(src), srcLen: src.length, startsPhp: src.startsWith('<?php'), hasBom: src.charCodeAt(0) === 0xfeff }
    const exSrc = await rawFile(t.example)
    parsed[k].example = exSrc ? parseConfig(exSrc) : new Map()
  }
  say('other config-like files in private/ (names, modes):')
  for (const x of walk(PRIVATE, (rel, isDir) => isDir && /media|voice/.test(rel), 4)) {
    if (x.st.isFile() && /config|\.env|secret|passw|token|msmtprc/i.test(x.rel)) say(`   private/${x.rel} ${oct(x.st.mode)} ${own(x.st)} ${x.st.size}B`)
  }
  for (const n of ['config.php', 'config.js', '.env', 'knet-config.php', 'pay-config.php', 'api-config.php']) {
    const hits = walk(SITE, () => false, 8).filter((x) => x.st.isFile() && path.basename(x.rel) === n)
    say(`site/ copies of ${n}: ${hits.length ? hits.map((h) => `${h.rel}(${oct(h.st.mode)} ${own(h.st)} ${h.st.size}B)`).join(' ') : 'none'}`)
  }
  flush()

  for (const [k, p] of Object.entries(parsed)) {
    say(`== B.${k} keys (${targets[k].file}); php-open-tag=${p.startsPhp}; BOM=${p.hasBom}; ${p.map.size} keys parsed`)
    const req = REQUIRED[k]
    for (const key of req) say(`   [required] ${key}: ${verdict(key, p.map.get(key), p.example.get(key))}`)
    const extra = [...p.map.keys()].filter((x) => !req.includes(x))
    say(`   [other keys present] ${extra.map((key) => `${key}=${verdict(key, p.map.get(key), p.example.get(key)).replace(/ ?value=.*/, (m) => m)}`).join(' ; ') || 'none'}`)
    const notInExample = [...p.map.keys()].filter((x) => p.example.size && !p.example.has(x))
    if (notInExample.length) say(`   (keys the shipped example does not mention: ${notInExample.join(',')})`)
    flush()
  }

  say('== C. cross-file checks (booleans only)')
  const get = (k, n) => parsed[k]?.map.get(n)?.v
  const eq = (a, b) => (a !== undefined && b !== undefined && a !== '' ? String(a) === String(b) : null)
  if (parsed.api && parsed.knet) for (const [a, b] of [['db_host', 'mysql_host'], ['db_name', 'mysql_name'], ['db_user', 'mysql_user'], ['db_pass', 'mysql_pass']]) say(`api.${a} == knet.${b}: ${eq(get('api', a), get('knet', b))}`)
  if (parsed.api && parsed.tpay) for (const [a, b] of [['db_host', 'mysql_host'], ['db_name', 'mysql_name'], ['db_user', 'mysql_user'], ['db_pass', 'mysql_pass']]) say(`api.${a} == tpay.${b}: ${eq(get('api', a), get('tpay', b))}`)
  const secrets = []
  for (const [k, p] of Object.entries(parsed)) for (const [n, v] of p.map) if (v.type === 'string' && v.v.length >= 8 && SECRETISH.test(n)) secrets.push([`${k}.${n}`, v.v])
  const reuse = []
  for (let i = 0; i < secrets.length; i++) for (let j = i + 1; j < secrets.length; j++) if (secrets[i][1] === secrets[j][1] && !(/db_pass|mysql_pass/.test(secrets[i][0]) && /db_pass|mysql_pass/.test(secrets[j][0]))) reuse.push(`${secrets[i][0]} == ${secrets[j][0]}`)
  say(`one secret value reused under two different roles: ${reuse.length ? reuse.join('; ') : 'none'}`)
  const logs = ['knet', 'tpay'].map((k) => [k, get(k, 'log_file'), get(k, 'token_cache_file')])
  for (const [k, lf, tc] of logs) {
    for (const [n, v] of [['log_file', lf], ['token_cache_file', tc]]) if (v) say(`${k}.${n}: ${v} -> ${/^\/(var\/www|srv)\//.test(v) && !/\/var\/lib\/sporta/.test(v) ? 'POSSIBLY INSIDE DOCUMENT ROOT' : 'outside the document root'}`)
  }
  const urls = []
  for (const [k, p] of Object.entries(parsed)) for (const [n, v] of p.map) if (/_url$|_base$|_page$/.test(n) && v.type === 'string' && v.v) urls.push(`${k}.${n}=${/^https:\/\/(www\.sporta\.com\.kw|kpay\.com\.kw|kpaytest\.com\.kw|[a-z0-9.-]+\.com\.kw)(\/|$)/.test(v.v) ? 'https ok' : /^http:/.test(v.v) ? 'PLAIN-HTTP' : 'other'}`)
  say(`url schemes: ${urls.join(' ')}`)

  say('== D. mail credentials: files by name/mode (no content), msmtprc key names')
  for (const x of walk(path.join(PRIVATE, 'mail'), () => false, 2)) say(`   mail/${x.rel} ${kind(x.st)} ${oct(x.st.mode)} ${own(x.st)} ${x.st.isFile() ? x.st.size + 'B' : ''}`)
  const ms = path.join(PRIVATE, 'mail', 'msmtprc')
  if (lst(ms)) for (const l of fs.readFileSync(ms, 'utf8').split('\n')) {
    const m = l.match(/^\s*([a-z_]+)\s+(.*)$/i)
    if (m && !l.trim().startsWith('#')) say(`   msmtprc: ${m[1]} ${/^(host|port|tls|tls_starttls|auth|from|protocol|tls_trust_file|logfile|account|syslog|passwordeval)$/.test(m[1]) ? (m[1] === 'passwordeval' && !/^\/bin\/cat \/run\//.test(m[2]) ? '<redacted>' : m[1] === 'logfile' ? m[2] : m[1] === 'from' ? '<address>' : m[2]) : '<redacted len=' + m[2].length + '>'}`)
  }
  say('== E. config.js (public by design): key names only')
  const cjs = path.join(SITE, 'config.js')
  if (lst(cjs)) {
    const t = fs.readFileSync(cjs, 'utf8')
    say(`config.js ${t.length}B ${oct(lst(cjs).mode)}; keys: ${[...t.matchAll(/([A-Za-z_]\w*)\s*:/g)].map((m) => m[1]).join(',') || '(empty object)'}; secret-looking words: ${/(secret|passw|token|api[_-]?key|private)/i.test(t) ? 'YES' : 'none'}`)
  }
  say('SEC_KEYS done')
  flush()
}

// ================================================================== http
function request(p, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = https.request({
      host: '127.0.0.1', port: 443, path: p, method, timeout: 15000,
      headers: { Host: HOST, 'User-Agent': 'sporta-sec-config-scan', 'Accept-Encoding': 'identity', ...headers },
      servername: HOST, checkServerIdentity: (_h, c) => tls.checkServerIdentity(HOST, c),
    }, (res) => {
      const chunks = []; let n = 0
      res.on('data', (c) => { if (n < 65536) { chunks.push(c); n += c.length } })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('latin1'), len: Number(res.headers['content-length'] ?? n) }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message, len: 0 }))
    req.end()
  })
}
const SECRET_WORDS = /(client_secret|encrp_key|tranportal_password|resource_key|db_pass|mysql_pass|cron_key|rate_limit_secret|google_oauth_client_secret|AccessToken|BEGIN [A-Z ]*PRIVATE KEY)/i
async function http_() {
  say(`SEC_HTTP start ${new Date().toISOString()} (GET only; bodies never printed)`)
  const fixed = [
    // the three config files, every spelling
    '/config.php', '/api/config.php', '/knet/config.php', '/pay/config.php',
    '/api/config.example.php', '/knet/config.example.php', '/pay/config.example.php', '/config.example.php',
    '/api/config-path.php', '/api/api-config.php', '/api-config.php', '/knet-config.php', '/pay-config.php',
    '/private/api-config.php', '/private/config/knet-config.php', '/private/config/pay-config.php', '/config/knet-config.php', '/config/pay-config.php',
    '/run/sporta-api-config.php', '/run/sporta-config/knet-config.php',
    // editor leftovers and alternate extensions of the same files
    '/api/config.php.bak', '/api/config.php.old', '/api/config.php.orig', '/api/config.php.save', '/api/config.php~', '/api/config.php.swp', '/api/.config.php.swp', '/api/config.php.txt', '/api/config.inc', '/api/config.php.dist',
    '/knet/config.php.bak', '/knet/config.php.old', '/knet/config.php~', '/pay/config.php.bak', '/pay/config.php.old', '/pay/config.php~',
    // PATH_INFO and case tricks against a <Files> rule
    '/api/config.php/x.css', '/api/config.php/', '/knet/config.php/x', '/pay/config.php/x', '/api/Config.php', '/API/CONFIG.PHP', '/api/CONFIG.PHP', '/api//config.php', '/api/./config.php', '/api/%63onfig.php', '/knet/%63onfig.php', '/pay/%63onfig.php',
    // tokens, logs, session dirs, voice mount
    '/.cbk_token.json', '/pay/.cbk_token.json', '/api/.cbk_token.json', '/cbk_token.json', '/knet-payments.log', '/cbk-payments.log', '/pay-payments.log', '/knet/knet-payments.log', '/pay/cbk-payments.log', '/api/payments.log', '/error.log', '/php_errors.log', '/api/error_log', '/error_log',
    '/var/lib/sporta/knet-payments.log', '/voice/knet-payments.log', '/private/voice/knet-payments.log', '/admin-sessions/', '/var/lib/sporta/admin-sessions/', '/tts-cache/', '/voice/', '/private/voice/', '/private/', '/private/media/', '/private/mail/msmtprc', '/mail/password', '/msmtprc', '/private/mail/password',
    // host-level files
    '/docker-compose.yml', '/docker-compose.yaml', '/compose.yml', '/apache-service.override.yml', '/Dockerfile', '/php/92-sporta-errors.ini', '/.env', '/.env.local', '/.env.production', '/.git/HEAD', '/.git/config', '/.htpasswd', '/.user.ini', '/php.ini',
    // backup/dump roots
    '/backups/', '/backups.zip', '/releases/', '/rollback/', '/staging/', '/site/', '/site-prev-20261030T0905Z/', '/sporta-db-20261027T085057Z.sql.gz', '/backups/sporta-db-20261027T085057Z.sql.gz', '/db.sql', '/dump.sql', '/sporta.sql', '/database.sql', '/sporta-dist.zip', '/site.zip', '/public_html.zip',
    // leftover setup tools (read-only forms; prior scans already request them)
    '/go-live.html', '/knet/selftest.php', '/knet/setup-config.php', '/api/setup-admin.php', '/api/preflight.php', '/sporta-deploy.php',
    // public by design
    '/config.js',
  ]
  // discovered names: sensitive-looking files and every backups/ php/json/sql/htaccess/env inside the web root
  const found = []
  for (const x of walk(SITE, () => false, 8)) {
    if (!x.st.isFile()) continue
    const b = path.basename(x.rel)
    if (/^\._/.test(b) || /\.DS_Store$/.test(b)) continue
    if (/(^|\/)backups\//.test(x.rel) && /\.(php|json|sql|env|log|bak|ini|yml|yaml|sh|htaccess)$|^\.htaccess$|config|passw|secret|token/i.test(b)) found.push('/' + x.rel)
    else if (SENSITIVE.test(b) && !/^config\.example\.php$/.test(b) && !/\.(js|css|html|png|jpe?g|webp|woff2?)$/.test(b)) found.push('/' + x.rel)
    else if (/^(\.env|\.git|\.htpasswd|\.user\.ini)$/.test(b)) found.push('/' + x.rel)
  }
  const paths = [...new Set([...fixed, ...found.slice(0, 70)])]
  say(`paths: ${fixed.length} fixed + ${Math.min(found.length, 70)} discovered on disk (of ${found.length})`)
  const rows = []
  const bad = [], odd = []
  for (const p of paths) {
    const r = await request(p)
    const ct = String(r.headers['content-type'] ?? '').split(';')[0]
    const flags = []
    if (r.status === 200) {
      if (/^<\?php/.test(r.body)) flags.push('STARTS-WITH-<?php')
      if (SECRET_WORDS.test(r.body)) flags.push('SECRET-KEYWORD-IN-BODY')
      if (/'\w+'\s*=>/.test(r.body)) flags.push('PHP-ARRAY-SYNTAX')
      if (/<div id="root"|sporta-build/.test(r.body)) flags.push('spa-shell')
      if (/Index of \//.test(r.body)) flags.push('DIRECTORY-LISTING')
      if (r.body.length === 0) flags.push('empty-body')
    }
    if (r.status === 301 || r.status === 302) flags.push('->' + String(r.headers.location ?? '').replace(/^https:\/\/www\.sporta\.com\.kw/, ''))
    rows.push({ p, status: r.status, ct, len: r.len, flags })
    if (r.status === 200 && p !== '/config.js') (flags.includes('spa-shell') ? odd : bad).push(`${p} ${ct} ${r.len}B ${flags.join(',')}`)
    else if (![403, 404, 410, 301, 308].includes(r.status) && r.status !== 0) odd.push(`${p} -> ${r.status}`)
    await sleep(150)
  }
  const byStatus = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  say(`status histogram: ${JSON.stringify(byStatus)}`)
  say(`-- 200 answers that are NOT the SPA shell (each one needs a look): ${bad.length ? '' : 'none'}`)
  for (const b of bad) say('   ' + b)
  say(`-- other non-403/404 answers: ${odd.length ? '' : 'none'}`)
  for (const b of odd.slice(0, 40)) say('   ' + b)
  // compact map of what answered what, so a verifier can replay a few
  const g403 = rows.filter((r) => r.status === 403).length, g404 = rows.filter((r) => r.status === 404).length
  say(`403: ${g403}  404: ${g404}  total ${rows.length}`)
  say('-- config-specific rows (status, type, flags):')
  for (const r of rows.filter((r) => /config|\.cbk|token|payments\.log|\.env|msmtprc|password|compose|Dockerfile|sql/i.test(r.p)).slice(0, 80)) say(`   ${r.status} ${r.p}${r.flags.length ? ' [' + r.flags.join(',') + ']' : ''}`)
  flush()
  // config.js: public, but must carry no secret keyword
  const cj = rows.find((r) => r.p === '/config.js')
  const cjr = await request('/config.js')
  say(`/config.js ${cjr.status} ${cjr.headers['content-type']} ${cjr.len}B secret-keyword-in-body=${SECRET_WORDS.test(cjr.body) || /(secret|passw|token)/i.test(cjr.body)} cache-control=${cjr.headers['cache-control']}`)
  // The 403 body: does a denial leak a server path or the Apache version?
  const d = await request('/api/config.php')
  say(`denial page for /api/config.php: ${d.status} type=${d.headers['content-type']} len=${d.len} leaks-path=${/\/(var|run|srv|etc)\//.test(d.body)} leaks-apache-version=${/Apache\/\d/.test(d.body)} server-header=${d.headers.server ?? '(none)'} x-powered-by=${d.headers['x-powered-by'] ?? '(none)'}`)
  await sleep(150)
  // Does a PHP warning/notice reach a visitor and name a config path? Only GET of existing public endpoints with a bad route.
  const e1 = await request('/api/api.php?r=__no_such_route__')
  say(`/api/api.php?r=__no_such_route__: ${e1.status} ${e1.headers['content-type']} ${e1.len}B body-names-a-server-path=${/\/(var\/www|run|srv|etc)\//.test(e1.body)} php-warning=${/(Warning|Notice|Fatal error|Stack trace)/.test(e1.body)}`)
  await sleep(150)
  const e2 = await request('/api/admin.php?r=__no_such_route__')
  say(`/api/admin.php?r=__no_such_route__: ${e2.status} ${e2.headers['content-type']} ${e2.len}B body-names-a-server-path=${/\/(var\/www|run|srv|etc)\//.test(e2.body)} php-warning=${/(Warning|Notice|Fatal error|Stack trace)/.test(e2.body)}`)
  say('SEC_HTTP done')
  flush()
}

const run = { layout, site, keys, http: http_ }[MODE]
if (!run) { console.log(`unknown SEC_MODE ${MODE}`); process.exit(2) }
await run()
