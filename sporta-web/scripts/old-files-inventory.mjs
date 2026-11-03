#!/usr/bin/env node
// OLD FILES INVENTORY — what is in the live web root, and what nothing loads.
//
// READ-ONLY. No network, no writes: it opens files, hashes them and prints.
// Made for ONE one-shot VPS job (node:24-alpine) with /docker/sporta mounted
// read-only at /sporta, the same way `vps-deploy.mjs plan` mounts it. It walks
// /sporta/site (or the folder given as the first argument, which is how it is
// self-tested on a fake docroot).
//
// WHY. vps-deploy.mjs never deletes a live-only file, and the server's web root
// was built up by hand, by an older shared-hosting copy, by a foreign
// storefront build and by this repo's deploys. So it collects: hashed chunks
// of earlier builds (still fetchable by URL for a year: `immutable`), old
// copies of add-ons, setup tools the owner was told to delete, backups made
// inside site/, and HTML pages nobody links. An old chunk is not harmless:
// whatever it held when it was built — a bug fixed since, a cost table, an
// endpoint retired since — is still public at its URL.
//
// HOW A FILE IS MARKED REFERENCED. Breadth-first from the roots the platform
// fetches by itself (index.html, .htaccess, robots.txt, sitemap.xml,
// site.webmanifest, sw.js, llms.txt), following:
//   HTML  src= / href= / content= / poster= attributes (script src, link href,
//         modulepreload, stylesheet, manifest, icons) plus every quoted path in
//         inline scripts and JSON-LD
//   JS    every quoted string that is a path to a file (static `import … from`,
//         dynamic `import()`, `export … from`, Vite's __vite__mapDeps list,
//         `register('/sw.js')`, the service worker's precache list) and
//         `sourceMappingURL=`
//   CSS   url(…) and @import
//   XML   <loc> (the sitemap index names its children)
//   robots.txt `Sitemap:` lines; .htaccess RewriteRule targets, ErrorDocument,
//         DirectoryIndex
// The matching is deliberately LOOSE: a string that only looks like a path
// still counts as a reference. That errs towards REFERENCED, never towards
// ORPHAN, which is the safe direction for a list that will drive a clean-up.
// A file reached only from an orphan stays an orphan (the walk starts at the
// roots only).
//
// WHAT IS FLAGGED.
//   ORPHAN         a .js/.mjs/.cjs/.css/.json/.txt/.xml file nothing reaches
//   OLD_HTML       an .html/.htm that is not index.html and not a known page
//   SETUP_TOOL     go-live.html, knet/selftest.php, knet/setup-config.php,
//                  api/setup-admin.php, api/preflight.php (to be deleted)
//   PHP_OUTSIDE    a .php outside api/, knet/, pay/
//   MAP            any source map, plus sourceMappingURL in a served script
//   SECRET_SHAPED  config.php / .env / .cbk_token.json in the web root (never
//                  hashed or read; the name is enough)
//   BACKUP         anything under a backups/ (or backup/, rollback/) folder
//                  inside the web root: summarised per folder, with every
//                  .php/.html/.js in it listed, because Apache serves them
// api/, knet/, pay/ are the backend (called by URL, not by link): listed as
// BACKEND in counts only. Images and fonts are followed (so a CSS url() to a
// font is not reported missing) but not inventoried.
//
// OUTPUT. Compact lines, because a Hostinger job log keeps 300 entries:
//   ROOT · BUILD · SEED · SW · SITEMAP · HTACCESS lines first, then
//   F <flag> <size> <mtime> <sha12> <path> [<- referrer] [markers]  (flagged only;
//     markers on old JS/HTML/maps: cost_table, supabase, lovable, old_admin_path,
//     passcode, internal_host, debugger)
//   B <backup dir> files= bytes= php= html= js= newest=
//   DIR <top folder> listed= referenced= orphan= orphan_bytes=
//   MISSING <path> <- <referrer>       (from index.html, sw.js, CSS only)
//   OLD_FILES_EXTRA … then
//   OLD_FILES orphans=<n> html=<n> maps=<n>
//   OLD_FILES_DONE
// OLD_FILES_VERBOSE=1 also prints every REFERENCED file.
//
// Usage on the VPS (a one-shot job; the compose command must contain no
// dollar sign and no curl/wget/require('fs') — the Hostinger API refuses those):
//   node old-files-inventory.mjs            walks /sporta/site
//   node old-files-inventory.mjs <docroot>  walks another folder (self-test)
//
// CLEAN-UP (not done here, ever): move each ORPHAN chunk into a dated folder
// OUTSIDE the web root (/docker/sporta/backups/old-assets-<stamp>/, same
// relative paths), in one job, after re-running this probe against the
// current index.html — never delete in place. Keep anything a precache list
// names, or the service worker fails to install.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(process.argv[2] || process.env.OLD_FILES_ROOT || '/sporta/site')
const VERBOSE = process.env.OLD_FILES_VERBOSE === '1'
const ORIGIN = 'https://www.sporta.com.kw'
const MAX_F = 170           // flagged-file lines before the rest is summarised
const MAX_B = 40            // backup-folder lines
const MAX_FILES = 200000    // a runaway tree stops the walk, not the job

const LISTED = /\.(m?js|cjs|css|html?|php|map|json|txt|xml|webmanifest)$/i
const FOLLOW = /\.(m?js|cjs|css|html?|json|webmanifest|xml|txt|map|php|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico)$/i
const BACKEND = new Set(['api', 'knet', 'pay'])
const KNOWN_HTML = new Set(['index.html', 'backends-offline.html'])
const SETUP_TOOLS = new Set(['go-live.html', 'knet/selftest.php', 'knet/setup-config.php',
  'api/setup-admin.php', 'api/preflight.php'])
const SECRET = /(^|\/)(config\.php|\.env(\.[\w.-]+)?|\.cbk_token\.json)$/
const BACKUP_DIR = /^(backups?|rollback|old|bak)$/i
const ROOTS = ['index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'sw.js', 'llms.txt',
  ...KNOWN_HTML]  // a known page is served on purpose (backends-offline.html: the admin's offline page)

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.log(`OLD_FILES_FAIL ${ROOT} has no index.html — is /docker/sporta mounted at /sporta?`)
  process.exit(1)
}

// ------------------------------------------------------------------ walk
// lstat, never stat: a symlink is reported by name and never followed, so a
// link out of the web root cannot pull the host into the listing.
const all = new Map()   // rel -> { size, mtime, isLink }
let walked = 0, truncated = false
;(function walk(dir) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (walked >= MAX_FILES) { truncated = true; return }
    const abs = path.join(dir, e.name)
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (e.isSymbolicLink()) { all.set(rel, { size: 0, mtime: 0, isLink: true }); walked++; continue }
    if (e.isDirectory()) { walk(abs); continue }
    if (!e.isFile()) continue
    walked++
    let st
    try { st = fs.lstatSync(abs) } catch { continue }
    all.set(rel, { size: st.size, mtime: st.mtimeMs, isLink: false })
  }
})(ROOT)

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { return '' } }
const sha12 = (rel) => {
  if (SECRET.test(rel)) return '-'
  try { return createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 12) } catch { return '?' }
}
const when = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16) : '-')
const top = (rel) => (rel.includes('/') ? rel.split('/')[0] : '(root)')
const inBackup = (rel) => rel.split('/').slice(0, -1).some((s) => BACKUP_DIR.test(s))
const backupDirOf = (rel) => {
  const seg = rel.split('/')
  const i = seg.findIndex((s, k) => k < seg.length - 1 && BACKUP_DIR.test(s))
  // backups/<one folder per backup>/… → summarise at that folder
  return seg.slice(0, Math.min(i + 2, seg.length - 1)).join('/')
}

// --------------------------------------------------------- references
// A raw reference → candidate site paths (first existing one wins).
function candidates(raw, from) {
  let r = String(raw).trim()
  if (!r || r.length > 400) return []
  try { r = decodeURI(r) } catch { /* keep as is */ }
  r = r.split('#')[0].split('?')[0]
  if (r.startsWith(ORIGIN)) r = r.slice(ORIGIN.length) || '/'
  else if (r.startsWith('//www.sporta.com.kw')) r = r.slice('//www.sporta.com.kw'.length) || '/'
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return []   // other origin, data:, mailto:
  if (r.includes('${') || r.includes('*')) return []
  const base = path.posix.dirname(from)
  const norm = (p) => { const n = path.posix.normalize(p).replace(/^\/+/, ''); return n.startsWith('..') ? null : n }
  let out
  if (r.startsWith('/')) out = [norm(r)]
  else if (r.startsWith('./') || r.startsWith('../')) out = [norm(path.posix.join(base, r))]
  else out = [norm(path.posix.join(base, r)), norm(r)]   // bare: sibling first, then from the root
  return out.filter(Boolean).map((p) => (p === '' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p))
}

const LIT = /["'`]([^"'`\s<>(){}\\]{1,300}?\.(?:m?js|cjs|css|html?|json|webmanifest|xml|txt|map|php|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico))(?:[?#][^"'`\s]*)?["'`]/gi
const ATTR = /\b(?:src|href|content|poster|data-src|action)\s*=\s*["']([^"']+)["']/gi
const SRCSET = /\bsrcset\s*=\s*["']([^"']+)["']/gi
const CSSURL = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi
const CSSIMP = /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi
const SMAP = /sourceMappingURL=([^\s*'"]+)/g
const LOC = /<(?:[\w-]+:)?loc>\s*([^<\s]+)\s*</gi

// Which references a file makes, by type. `strict` ones also feed MISSING.
function refsOf(rel, text) {
  const out = [], strict = []
  const ext = path.posix.extname(rel).toLowerCase()
  const base = path.posix.basename(rel)
  const push = (arr, re, s) => { for (const m of s.matchAll(re)) arr.push(m[1]) }
  if (ext === '.html' || ext === '.htm') {
    push(strict, ATTR, text)
    for (const m of text.matchAll(SRCSET)) for (const part of m[1].split(',')) strict.push(part.trim().split(/\s+/)[0])
    push(out, LIT, text)
  } else if (ext === '.css') {
    push(strict, CSSURL, text); push(strict, CSSIMP, text)
  } else if (['.js', '.mjs', '.cjs'].includes(ext)) {
    push(base === 'sw.js' ? strict : out, LIT, text)
    push(out, SMAP, text)
  } else if (ext === '.json' || ext === '.webmanifest' || ext === '.map') {
    push(out, LIT, text)
  } else if (ext === '.xml') {
    push(out, LOC, text)
  } else if (base === 'robots.txt') {
    for (const m of text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) out.push(m[1])
  } else if (ext === '.txt') {
    push(out, LIT, text)
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
  return { out, strict }
}

const reached = new Map()   // rel -> first referrer
const missing = []
const queue = []
const visit = (rel, from) => { if (!reached.has(rel)) { reached.set(rel, from); queue.push(rel) } }
for (const r of ROOTS) if (all.has(r)) visit(r, '(root)')
const parseable = (rel) => /\.(m?js|cjs|css|html?|json|webmanifest|xml|txt|map)$/i.test(rel) || path.posix.basename(rel) === '.htaccess'
while (queue.length) {
  const rel = queue.shift()
  if (!parseable(rel) || inBackup(rel)) continue
  const text = read(rel)
  const { out, strict } = refsOf(rel, text)
  for (const [list, isStrict] of [[strict, true], [out, false]]) {
    for (const raw of list) {
      const cands = candidates(raw, rel)
      const hit = cands.find((c) => all.has(c))
      if (hit) { visit(hit, rel); continue }
      // Only the references whose absence breaks a page are reported missing:
      // the HTML shell's own tags, the service worker's list, CSS url().
      const c = cands[cands.length - 1]
      if (isStrict && c && FOLLOW.test(c) && (rel === 'index.html' || rel === 'sw.js' || rel.endsWith('.css'))) missing.push([c, rel])
    }
  }
}

// ------------------------------------------------------------- classify
const flagged = [], counts = { orphans: 0, html: 0, maps: 0, phpOutside: 0, setup: 0, secret: 0, backupFiles: 0, referenced: 0, backend: 0, links: 0 }
const dirs = new Map(), backups = new Map()
const listed = [...all.keys()].filter((rel) => LISTED.test(rel) || path.posix.basename(rel) === '.htaccess' || SECRET.test(rel)).sort()
for (const rel of listed) {
  const f = all.get(rel)
  const d = top(rel)
  const dd = dirs.get(d) ?? { listed: 0, referenced: 0, orphan: 0, orphanBytes: 0 }
  dirs.set(d, dd); dd.listed++
  const ext = path.posix.extname(rel).toLowerCase()
  const isRef = reached.has(rel)
  if (isRef) { dd.referenced++; counts.referenced++ }
  let flag = null
  if (f.isLink) { flag = 'SYMLINK'; counts.links++ }
  else if (inBackup(rel)) {
    counts.backupFiles++
    const b = backupDirOf(rel)
    const bb = backups.get(b) ?? { files: 0, bytes: 0, php: 0, html: 0, js: 0, newest: 0 }
    backups.set(b, bb)
    bb.files++; bb.bytes += f.size; bb.newest = Math.max(bb.newest, f.mtime)
    if (ext === '.php') bb.php++
    if (ext === '.html' || ext === '.htm') { bb.html++; counts.html++ }
    if (/\.(m?js|cjs)$/.test(ext)) bb.js++
    if (ext === '.map') counts.maps++
    if (/\.(php|html?|m?js|cjs|map)$/.test(ext)) flag = 'BACKUP'
  } else if (SECRET.test(rel)) { flag = 'SECRET_SHAPED'; counts.secret++ }
  else if (SETUP_TOOLS.has(rel)) { flag = 'SETUP_TOOL'; counts.setup++; if (ext === '.html') counts.html++ }
  else if (ext === '.map') { flag = 'MAP'; counts.maps++ }
  else if (ext === '.php' && !BACKEND.has(d)) { flag = 'PHP_OUTSIDE'; counts.phpOutside++ }
  else if (BACKEND.has(d)) { counts.backend++ }
  else if ((ext === '.html' || ext === '.htm') && !KNOWN_HTML.has(rel)) { flag = 'OLD_HTML'; counts.html++ }
  else if (!isRef && path.posix.basename(rel) !== '.htaccess' && !KNOWN_HTML.has(rel)) {
    flag = 'ORPHAN'; counts.orphans++; dd.orphan++; dd.orphanBytes += f.size
  }
  if (flag) flagged.push([flag, rel])
  else if (VERBOSE && isRef) flagged.push(['REFERENCED', rel])
}

// ---------------------------------------------------------------- print
const say = (s) => console.log(s)
const idx = read('index.html')
say(`OLD_FILES_ROOT ${ROOT} walked=${walked}${truncated ? ' TRUNCATED' : ''} listed=${listed.length} referenced=${counts.referenced}`)
say(`BUILD index.html ${/<meta\s+name="sporta-build"\s+content="sporta-web"/.test(idx) ? 'sporta-web (this repo)' : 'FOREIGN (no sporta-build meta)'} sha=${sha12('index.html')} size=${all.get('index.html').size} mtime=${when(all.get('index.html').mtime)}`)
const entry = [...idx.matchAll(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/gi)].map((m) => m[1])
const pre = [...idx.matchAll(/<link[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1])
const scripts = [...idx.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1])
const styles = [...idx.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((h) => !/^https?:/.test(h))
say(`SEED entry=${entry.join(',') || '-'} modulepreload=${pre.length} script_src=${scripts.length} local_css=${styles.length}`)
if (all.has('sw.js')) {
  const sw = read('sw.js')
  const lits = [...sw.matchAll(LIT)].map((m) => m[1])
  // Cache names: a fixed version string means old entries are never rotated.
  const version = (sw.match(/\b(?:VERSION|CACHE_VERSION|CACHE)\s*=\s*["'`]([^"'`]{1,40})["'`]/) || [])[1] || '?'
  const caches = [...new Set([...sw.matchAll(/["'`]((?:sporta|workbox|cache)[\w-]*(?:\$\{\w+\}|-v?[\w.]+)?)["'`]/gi)].map((m) => m[1]))].slice(0, 4)
  const swMissing = lits.filter((l) => !candidates(l, 'sw.js').some((c) => all.has(c)))
  say(`SW sw.js sha=${sha12('sw.js')} mtime=${when(all.get('sw.js').mtime)} paths=${lits.length} missing=${swMissing.length}${swMissing.length ? ' (' + swMissing.slice(0, 6).join(' ') + ')' : ''} addAll=${/\baddAll\s*\(/.test(sw) ? 'yes' : 'no'} skipWaiting=${/skipWaiting/.test(sw) ? 'yes' : 'no'} claim=${/clients\.claim/.test(sw) ? 'yes' : 'no'} version=${version} names=${caches.join(',') || '?'} precache_js=${lits.filter((l) => /\.m?js$/.test(l)).length}`)
} else say('SW none (no sw.js in the web root)')

// The sitemap chain: what robots.txt names, and what answers each name.
const robots = read('robots.txt')
const sm = [...robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1])
say(`SITEMAP robots.txt names ${sm.join(' ') || '(none)'}`)
const hta = read('.htaccess')
const rules = hta.split('\n').map((l) => l.trim()).filter((l) => /sitemap/i.test(l) && /^Rewrite(Rule|Cond)/i.test(l))
for (const name of ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-products.xml']) {
  const rule = rules.find((l) => /^RewriteRule/i.test(l) && l.split(/\s+/)[1]?.replace(/\\/g, '').replace(/^\^|\$$/g, '') === name)
  const target = rule ? rule.split(/\s+/)[2].replace(/^\//, '') : ''
  const php = target && all.has(target)
  const stat = all.has(name)
  const served = php ? `${target} (php; static ${name} ${stat ? 'SHADOWED' : 'absent'})` : stat ? `static ${name} (${all.get(name).size} B, mtime ${when(all.get(name).mtime)})` : 'NOTHING (404)'
  say(`SITEMAP /${name} -> ${served}`)
}
const htaccessFiles = listed.filter((r) => path.posix.basename(r) === '.htaccess' && !inBackup(r))
say(`HTACCESS ${htaccessFiles.length} file(s): ${htaccessFiles.join(' ')}`)

// What an old file still carries. Read only for files nothing loads (and
// backups / old pages): a reachable old chunk is public whatever it holds, so
// these name what a stranger could fetch. The marker NAME is printed, never
// the matched text.
const MARKERS = [
  ['cost_table', /aedPerKwd|AHED_COST_AED|cost_aed/],        // supplier cost (REPO-SCAN webcode-1)
  ['supabase', /supabase/i],
  ['lovable', /lovable/i],
  ['old_admin_path', /["'`]\/admin(?:["'`\/?#])/],
  ['passcode', /AdminPasscode|passcode/i],
  ['internal_host', /187\.7\.78\.123|46\.202\.158\.211|hstgr\.cloud|n8n\.cloud/i],
  ['debugger', /\bdebugger\b/],
]
let marked = 0
const marks = (flag, rel) => {
  if (!['ORPHAN', 'BACKUP', 'OLD_HTML', 'MAP'].includes(flag) || !/\.(m?js|cjs|html?|map)$/i.test(rel) || all.get(rel).isLink) return ''
  const t = read(rel)
  const hit = MARKERS.filter(([, re]) => re.test(t)).map(([n]) => n)
  if (hit.length) marked++
  return hit.length ? ` [${hit.join(',')}]` : ''
}

const order = { SECRET_SHAPED: 0, SETUP_TOOL: 1, PHP_OUTSIDE: 2, MAP: 3, OLD_HTML: 4, BACKUP: 5, SYMLINK: 6, ORPHAN: 7, REFERENCED: 8 }
flagged.sort((a, b) => order[a[0]] - order[b[0]] || a[1].localeCompare(b[1]))
let shown = 0
for (const [flag, rel] of flagged) {
  if (shown >= MAX_F) break
  const f = all.get(rel)
  const via = reached.get(rel)
  say(`F ${flag.padEnd(13)} ${String(f.size).padStart(8)} ${when(f.mtime)} ${f.isLink ? 'symlink     ' : sha12(rel)} ${rel}${via ? ' <- ' + via : ''}${marks(flag, rel)}`)
  shown++
}
if (flagged.length > shown) say(`F ... ${flagged.length - shown} more flagged files not printed (counts below are complete)`)
for (const [flag, rel] of flagged.slice(shown)) marks(flag, rel)   // keep the marked count complete
let bshown = 0
for (const [b, v] of [...backups].sort()) {
  if (bshown++ >= MAX_B) { say(`B ... ${backups.size - MAX_B} more backup folders`); break }
  say(`B ${b} files=${v.files} bytes=${v.bytes} php=${v.php} html=${v.html} js=${v.js} newest=${when(v.newest)}`)
}
for (const [d, v] of [...dirs].sort()) say(`DIR ${d} listed=${v.listed} referenced=${v.referenced} orphan=${v.orphan} orphan_bytes=${v.orphanBytes}`)
const seen = new Set()
for (const [p, from] of missing) {
  const k = p + '|' + from; if (seen.has(k)) continue; seen.add(k)
  if (seen.size > 25) { say('MISSING ... more'); break }
  say(`MISSING ${p} <- ${from}`)
}
// Any script or stylesheet outside backups/ that still names a source map,
// reached or not: an orphan with a map comment is a map someone can ask for.
const smapRefs = listed.filter((r) => /\.(m?js|cjs|css)$/.test(r) && !inBackup(r) && !all.get(r).isLink && /sourceMappingURL=/.test(read(r)))
say(`OLD_FILES_EXTRA referenced=${counts.referenced} backend=${counts.backend} setup_tools=${counts.setup} php_outside=${counts.phpOutside} secret_shaped=${counts.secret} backup_dirs=${backups.size} backup_files=${counts.backupFiles} symlinks=${counts.links} missing=${seen.size} marked=${marked} sourcemap_comments=${smapRefs.length}${smapRefs.length ? ' (' + smapRefs.slice(0, 4).join(' ') + ')' : ''}`)
say(`OLD_FILES orphans=${counts.orphans} html=${counts.html} maps=${counts.maps}`)
say('OLD_FILES_DONE')
