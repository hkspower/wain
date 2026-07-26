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

const ROOT = process.argv[2] ?? '/tmp/v2/public_html'
if (!existsSync(ROOT)) { console.error(`no such directory: ${ROOT}`); process.exit(2) }

const findings = []
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
                  '/pay/config.example.php']
for (const r of REQUIRED) if (!onDisk.has(r)) add('HIGH', `required file absent: ${r}`, '')
// /pay/config.php holds the CBK ClientSecret and ENCRP_KEY; .cbk_token.json is
// a live AccessToken. Neither may ever be in the package.
const FORBIDDEN = ['/knet/config.php', '/pay/config.php', '/pay/.cbk_token.json',
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
