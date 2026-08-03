// File-level audit of the deployable package.
//
// site-audit.mjs asks whether the pages behave; url-audit.mjs asks which hosts
// they talk to. This asks the third question: is every file that ships correct,
// needed, and actually reachable once it lands on the server?
//
// The checks here are chosen for how this site is actually deployed — dragged
// from a Mac into a Linux host through a browser file manager. That route has
// its own failure modes, and they are all silent:
//
//   * Case. macOS is case-insensitive, Linux is not. A reference to Logo.png
//     when the file is logo.png works on the machine that built it and 404s in
//     production. Nothing catches this locally.
//   * A byte-order mark before <?php. PHP then emits those bytes before any
//     header() call, so pay.php cannot redirect to KNET — "headers already
//     sent", and the payment silently dies at the last step.
//   * Editor droppings and source maps uploaded alongside the site.
//
//   node scripts/file-audit.mjs [packageDir]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, extname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

// Default to the real build output, NOT a scratch directory.
//
// This used to default to /tmp/v2/public_html — a staging tree left behind by
// some past run. On any machine where that path is stale or partial,
// `npm run audit:files` audits it happily and reports on a tree nobody is
// shipping: 27 "required file absent" findings for files that were sitting in
// dist/ the whole time, or, worse, a clean bill of health for a directory that
// has nothing to do with the site. An audit whose default target is a
// leftover is an audit that answers a question nobody asked.
//
// make-package.mjs still passes its own staged tree explicitly, which is the
// authoritative run — it refuses to write the zip if this fails.
const ROOT = process.argv[2] ?? new URL('../dist/', import.meta.url).pathname
if (!existsSync(ROOT)) { console.error(`no such directory: ${ROOT}`); process.exit(2) }

const findings = []

// `vite build` alone produces the browser bundle and nothing else — the PHP
// endpoints are copied in by `npm run bundle:php`, which `release` and
// `package` run and `build` does not. Auditing that tree lists every endpoint
// as a missing required file: twenty findings describing one situation, and
// none of them the actual advice. Say the actual advice instead.
if (!['api', 'knet', 'pay'].some((d) => existsSync(join(ROOT, d)))) {
  console.error(`${ROOT} has no /api, /knet or /pay — this looks like the output of a bare`)
  console.error('`vite build`. Run `npm run release` (or `npm run package`) and audit that.')
  process.exit(2)
}
// `where` is a file for most checks and a list of referrers for the reference
// checks; the report labelled both "referenced by:", which read as though a
// zero-byte file were being referenced by itself.
const add = (sev, what, where = '', label = 'file') => findings.push({ sev, what, where, label })
const addRef = (sev, what, where) => add(sev, what, where, 'referenced by')

// ---------------------------------------------------------------- inventory
const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    statSync(p).isDirectory() ? walk(p) : files.push(p)
  }
})(ROOT)

const rel = (p) => relative(ROOT, p)
const TEXT = /\.(html?|css|js|mjs|json|xml|txt|php|webmanifest|sql|sh|md)$/i
const bytesOf = (p) => readFileSync(p)
const totalBytes = files.reduce((n, f) => n + statSync(f).size, 0)

// ---------------------------------------------------- 1. empty + leftovers
for (const f of files) {
  const size = statSync(f).size
  const name = basename(f)
  if (size === 0) add('HIGH', 'zero-byte file', rel(f))
  if (/\.(map)$/i.test(name)) add('MED', 'source map shipped — exposes original source', rel(f))
  if (/^\.DS_Store$|~$|\.(bak|orig|swp|tmp|save)$/i.test(name)) add('MED', 'editor/OS leftover', rel(f))
  // __MACOSX is what Finder puts inside a zip: one shadow file per real file,
  // carrying resource forks and the original names. It does NOT begin with a
  // dot, so every rule written to catch .DS_Store misses it entirely, and it
  // survives as a browsable directory listing the whole site's contents. It
  // appears whenever a folder is re-zipped on a Mac and uploaded.
  if (name === '__MACOSX') add('HIGH', 'Finder zip leftover — delete this folder', rel(f))
  if (/^\._/.test(name)) add('MED', 'macOS resource fork (created by zipping on a Mac)', rel(f))
  if (/\.(env|pem|key|p12|sql\.gz)$/i.test(name)) add('HIGH', 'credential-shaped file in web root', rel(f))
}

// ------------------------------------------- 2. encoding, BOM, line endings
for (const f of files.filter((f) => TEXT.test(f))) {
  const buf = bytesOf(f)
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  if (hasBom && extname(f) === '.php') {
    add('HIGH', 'BOM before <?php — bytes are sent before any header(), so this script cannot redirect or set headers', rel(f))
  } else if (hasBom) {
    add('LOW', 'byte-order mark', rel(f))
  }
  // Valid UTF-8 matters: half this site is Arabic.
  const text = buf.toString('utf8')
  if (text.includes('�')) add('HIGH', 'invalid UTF-8 (replacement character present)', rel(f))
  if (/\.(php|sh)$/i.test(f) && buf.includes(0x0d)) {
    add('MED', 'CRLF line endings in a server-side script', rel(f))
  }
}

// -------------------------------------------------- 3. case collisions
const lower = new Map()
for (const f of files) {
  const k = rel(f).toLowerCase()
  if (lower.has(k)) add('HIGH', `two files differ only by case: ${rel(f)} vs ${lower.get(k)}`, '')
  else lower.set(k, rel(f))
}

// ------------------------------- 4. referenced assets exist, with exact case
// Collect every same-origin path any shipped text file points at.
const referenced = new Map() // path -> Set(referrer)   — strict: drives the HIGH "missing file" check
const mentioned = new Set()  //                          — loose: only decides what counts as an orphan
// Two passes, deliberately. The strict pattern must not invent a missing file
// out of a string that merely looks like a path, so it insists on an actual
// attribute. But it is blind to the two forms the bundler emits — `src:` with a
// colon in minified JSX, and a full canonical URL in the meta tags — and
// reporting logo-white.png as an orphan because of that is just as wrong.
// The extension is up to 12 characters: `{2,5}` cut `site.webmanifest` down to
// "/site.webma" and reported that phantom as missing.
const EXT = '[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{2,12}'
// Three details here were each found by deliberately renaming a file and
// watching the audit stay silent:
//   * the optional quote after the attribute name — in JSON, which is how
//     site.webmanifest names its icons, the key arrives as `"src": "/x.png"`;
//   * the JSON-LD keys. The ONLY reference to logo.png anywhere on the site is
//     `"logo": "https://www.sporta.com.kw/logo.png"` in the structured data, so
//     without them a rename to Logo.png would silently break the logo Google
//     shows beside the brand and nothing would have said so;
//   * the optional canonical origin, because that reference is an absolute URL.
const ATTR = 'href|src|content|action|logo|image|contentUrl|thumbnailUrl|url\\('
const ORIGIN = '(?:https:\\/\\/www\\.sporta\\.com\\.kw)?'
const REF_RE = new RegExp(`(?:${ATTR})["']?\\s*[=:]?\\s*["'\`]?${ORIGIN}(\\/${EXT})`, 'g')
const LOOSE_RE = new RegExp(`(?:https:\\/\\/www\\.sporta\\.com\\.kw)?(\\/${EXT})`, 'g')
for (const f of files.filter((f) => TEXT.test(f))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(REF_RE)) {
    const p = m[1].split('?')[0]
    if (!referenced.has(p)) referenced.set(p, new Set())
    referenced.get(p).add(rel(f))
  }
  for (const m of text.matchAll(LOOSE_RE)) mentioned.add(m[1].split('?')[0])
}

const onDisk = new Set(files.map((f) => '/' + rel(f)))
const onDiskLower = new Map([...onDisk].map((p) => [p.toLowerCase(), p]))
for (const [p, refs] of referenced) {
  if (onDisk.has(p)) continue
  const caseMatch = onDiskLower.get(p.toLowerCase())
  if (caseMatch) {
    addRef('HIGH', `case mismatch: referenced ${p}, file is ${caseMatch} — works on macOS, 404s on the Linux server`,
           [...refs].join(', '))
  } else if (!/^\/(shop|cart|checkout|about|contact|wishlist|track|returns|admin|product|payment)/.test(p)) {
    addRef('HIGH', `referenced file missing: ${p}`, [...refs].join(', '))
  }
}

// -------------------------------------------------------- 5. orphaned files
// Anything never mentioned anywhere, and not something the platform fetches by
// convention.
const CONVENTION = /^\/(index\.html|robots\.txt|sitemap[\w-]*\.xml|site\.webmanifest|favicon\.\w+|apple-touch-icon\.png|llms\.txt|\.htaccess|config\.js|go-live\.html)$/
for (const p of onDisk) {
  if (referenced.has(p) || mentioned.has(p) || CONVENTION.test(p)) continue
  if (p.startsWith('/assets/')) continue          // hashed, referenced from the bundle graph
  if (p.startsWith('/knet/')) continue            // endpoints, called by URL not by link
  if (p.startsWith('/pay/')) continue             // ditto — the CBK hosted gateway
  if (p.startsWith('/api/')) continue             // the native backend; called by URL
  if (p.startsWith('/cats/')) continue            // category art; CategoryTile assembles these
                                                  // URLs from parts, so no literal appears
  // The hero slides. HeroSlider and the boot script both build
  // /hero/<device>/<id><-rtl>.webp from parts, so no literal ever appears —
  // the same reason /cats is exempt. But a blanket exemption is one-sided: it
  // stops a MISSING file being caught (REQUIRED below covers that) and it also
  // stops an EXTRA one being caught, which is how two stale banner-*.webp from
  // an earlier design sat in dist/ and shipped inside the zip. So the exemption
  // is limited to the names that are actually expected.
  if (/^\/hero\/(desktop|mobile)\/(strength|cardio|arena)(-rtl)?\.webp$/.test(p)) continue
  add('LOW', `never referenced by anything shipped: ${p}`, '')
}

// ------------------------------------------------- 6. duplicate content
const byHash = new Map()
for (const f of files) {
  const h = createHash('sha256').update(bytesOf(f)).digest('hex')
  byHash.set(h, [...(byHash.get(h) ?? []), rel(f)])
}
for (const [, group] of byHash) {
  if (group.length > 1) {
    const kb = (statSync(join(ROOT, group[0])).size / 1024).toFixed(0)
    add('LOW', `identical files (${kb} kB each): ${group.join(' = ')}`, '')
  }
}

// ---------------------------------------------------------- 7. PHP parses
for (const f of files.filter((f) => f.endsWith('.php'))) {
  try {
    execFileSync('php', ['-l', f], { stdio: 'pipe' })
  } catch (e) {
    add('HIGH', `PHP syntax error: ${String(e.stdout ?? e.message).split('\n')[0]}`, rel(f))
  }
}

// ---------------------------------------------- 8. structural must-haves
const REQUIRED = ['/index.html', '/.htaccess', '/knet/.htaccess', '/config.js',
                  '/robots.txt', '/sitemap.xml', '/site.webmanifest',
                  '/knet/pay.php', '/knet/callback.php', '/knet/knet.php', '/knet/config.example.php',
                  // The CBK hosted gateway — the only one that can do T-Pay.
                  '/pay/.htaccess', '/pay/pay.php', '/pay/callback.php', '/pay/cbk.php',
                  '/pay/config.example.php',
                  // The native backend. schema/seed ship on purpose — they are
                  // what the owner imports in phpMyAdmin — and the folder's
                  // .htaccess denies them by name so shipping is not serving.
                  '/api/.htaccess', '/api/api.php', '/api/admin.php', '/api/store.php',
                  '/api/config.example.php', '/api/cron-fulfilment.php',
                  // The install check. It is how the owner finds out WHY the
                  // shop is not working, so it going missing is the failure
                  // that hides every other failure.
                  '/api/preflight.php',
                  '/api/install.mysql.sql',
                  '/api/schema.mysql.sql', '/api/seed.mysql.sql', '/api/promo.mysql.sql',
                  // The shipped hero: three slides, each with an LTR and an RTL
                  // composition, each in a desktop and a phone crop. Miss one
                  // and that slide silently drops to the drawn silhouette for
                  // one language or one device class — which looks like a
                  // design choice rather than a missing file, so it is asserted.
                  ...['strength', 'cardio', 'arena'].flatMap((id) =>
                    ['desktop', 'mobile'].flatMap((d) =>
                      ['', '-rtl'].map((v) => `/hero/${d}/${id}${v}.webp`))),
                 ]
for (const r of REQUIRED) if (!onDisk.has(r)) add('HIGH', `required file absent: ${r}`, '')
// /pay/config.php holds the CBK ClientSecret and ENCRP_KEY; .cbk_token.json is
// a live AccessToken. Neither may ever be in the package.
const FORBIDDEN = ['/knet/config.php', '/pay/config.php', '/pay/.cbk_token.json',
                   '/api/config.php',
                   '/.env', '/.env.deploy']
for (const r of FORBIDDEN) if (onDisk.has(r)) add('HIGH', `must never ship: ${r}`, '')

// ------------------------------------------------------------------ report
const order = { HIGH: 0, MED: 1, LOW: 2 }
findings.sort((a, b) => order[a.sev] - order[b.sev])

console.log('='.repeat(74))
console.log(`FILE AUDIT — ${ROOT}`)
console.log(`${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB on disk`)
console.log('='.repeat(74))

const byExt = new Map()
for (const f of files) {
  const e = extname(f) || basename(f)
  byExt.set(e, { n: (byExt.get(e)?.n ?? 0) + 1, b: (byExt.get(e)?.b ?? 0) + statSync(f).size })
}
console.log('\nBY TYPE')
for (const [e, v] of [...byExt].sort((a, b) => b[1].b - a[1].b)) {
  console.log(`  ${e.padEnd(16)} ${String(v.n).padStart(3)} file(s)  ${(v.b / 1024).toFixed(0).padStart(6)} kB`)
}

console.log('\nLARGEST')
for (const f of [...files].sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 8)) {
  console.log(`  ${(statSync(f).size / 1024).toFixed(0).padStart(6)} kB  ${rel(f)}`)
}

console.log('\n' + '-'.repeat(74))
if (!findings.length) console.log('No problems.')
else {
  let last = ''
  for (const f of findings) {
    if (f.sev !== last) { console.log(`\n--- ${f.sev} ---`); last = f.sev }
    console.log(`  ${f.what}${f.where ? `\n      ${f.label}: ${f.where}` : ''}`)
  }
}
console.log(`\n${findings.filter((f) => f.sev === 'HIGH').length} high, ` +
            `${findings.filter((f) => f.sev === 'MED').length} medium, ` +
            `${findings.filter((f) => f.sev === 'LOW').length} low`)
process.exit(findings.some((f) => f.sev === 'HIGH') ? 1 : 0)
