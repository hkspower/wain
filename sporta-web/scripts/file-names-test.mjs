// File-name rules for the whole repository: rig-free, no server, no database, no
// network. It reads `git ls-files` (plus untracked files that are not ignored)
// and the bytes of those files, and fails on the four things that have bitten
// this site because the owner's Mac and the production Apache disagree about
// what a file name means.
//
//   node scripts/file-names-test.mjs        (npm run test:file-names)
//
//   1. CASE.  macOS and Windows ignore case, the production Apache (Linux) does
//      not. A reference to /Logo.PNG that works on the Mac and 404s live is
//      invisible locally. Checked: two tracked names equal ignoring case (files
//      and directories, with Unicode NFC folding because macOS normalises too);
//      every relative import / require / url() / <script src> / PHP require and
//      every site-absolute /path.ext reference in index.html, src/, public/,
//      the PHP drop-ins, the SEO generators and the HTML5 fallback, resolved
//      CASE-SENSITIVELY against the file list (a miss, or a match that differs
//      only by case, fails); scripts named in package.json; script / command
//      names in the docs; and the file names that .htaccess and the live
//      add-on list spell out.
//   2. URL-SAFE NAMES.  Anything that becomes a URL (public/, the three PHP
//      drop-ins, the HTML5 fallback) must be lowercase ASCII, [a-z0-9._-],
//      no space, parenthesis, plus, percent, comma, apostrophe or non-ASCII,
//      no leading dot (except .htaccess), no trailing dot, 100 characters at
//      most per name, and no stray double extension.
//   3. EXTENSION vs CONTENT.  The first bytes must agree with the extension
//      (.jpg that is a PNG, .webp that is not RIFF/WEBP, .woff2 that is not
//      wOF2 ...), an .svg carries no script, a .json parses, a .js / .css that
//      is really HTML (a captive-portal page saved as a script: sw.js has a
//      guard for exactly that), no 0-byte file, no BOM on a script / PHP / JSON
//      file, no CRLF in a PHP / shell / .htaccess file.
//   4. CONVENTIONS.  The add-on set (sporta-*.css|js plus boot / birthday /
//      config / backends-offline) is the list CLAUDE.md says the live
//      index.html links, and every one of them is in the no-cache FilesMatch
//      of public/.htaccess; scripts end -test / -scan / -check / -audit /
//      -rig; nothing shipped is named wip / tmp / old / copy / final / backup /
//      v2; compiled bytecode is not tracked.
//
// An exception is only ever an entry in ALLOW below, with the reason beside it.
// Every exception that was used is printed at the end; an entry nothing used is
// printed as UNUSED so a fixed problem does not leave a silent hole behind.
// This suite changes nothing and reads nothing outside the repository.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'

// FILE_NAMES_ROOT points the suite at another checkout (a throwaway clone with a deliberate
// mutation), which is how the suite itself is proven to fail when it should.
const TOP = (process.env.FILE_NAMES_ROOT ? process.env.FILE_NAMES_ROOT.replace(/\/?$/, '/') : fileURLToPath(new URL('../../', import.meta.url)))
const git = (...a) => execFileSync('git', a, { cwd: TOP, encoding: 'utf8', maxBuffer: 64 << 20 })

let failures = 0
let checks = 0
const bad = []
const fail = (rule, what) => { failures++; bad.push(`  FAIL [${rule}] ${what}`) }
const ok = (cond, rule, what) => { checks++; if (!cond) fail(rule, what); return cond }

// ------------------------------------------------------------- exceptions
// rule -> [{ test: string | RegExp, why }]. A string matches the whole subject.
const ALLOW = {
  // Names that are not URL-safe, but never become a URL.
  'served-name': [
    { test: /^sporta-web\/dropin\/(README|php-(knet|cbk)\/README)\.md$/,
      why: 'documentation inside dropin/. bundle-php.mjs skips README.md (SKIP set), so it never reaches dist/. Uppercase by the repo\'s doc convention.' },
    { test: 'sporta-html5/README.md',
      why: 'the HTML5 fallback is a source tree nobody uploads verbatim (make-package.mjs deliberately does not package it); its README is documentation, and its .htaccess would not deny a .md if it ever were uploaded.' },
    { test: /^sporta-web\/dropin\/n8n\//,
      why: 'dropin/n8n/ is not in BUNDLES (php-knet, php-cbk, php-store only): an n8n workflow export, never served.' },
    { test: /^sporta-web\/dropin\/php-store\/[a-z0-9-]+\.mysql\.sql$/,
      why: 'double extension by design (<topic>.mysql.sql, numbered by make-package.mjs); the folder .htaccess denies .*\\.sql by name.' },
    { test: /\/config\.example\.php$/,
      why: 'config.example.php: the template the owner copies to config.php; each drop-in .htaccess denies it by name.' },
  ],
  // Tracked files whose bytes need an exception from ONE named check.
  'content-nul': [
    { test: 'sporta-web/scripts/lib/sitemap.mjs',
      why: 'a raw NUL byte (0x00) typed inside the string literal that joins file contents for the lastmod hash (scripts/lib/sitemap.mjs line 42). Valid JavaScript, but git, grep and GitHub treat the file as binary (no diff, silent grep skips). A real defect, fix = write \'\\0\' - left alone because this suite changes no existing file.' },
  ],
  // Tracked files whose bytes need an exception from every content check.
  content: [
    { test: 'brand/hero/__pycache__/grade.cpython-311.pyc',
      why: 'compiled Python bytecode that is tracked by mistake (REPO-SCAN hygiene-11 / secrets-5: git rm --cached). brand/ never ships, so it is only noise.' },
    { test: 'SPORTA-BACKEND.zip',
      why: 'tracked build artifact, stale since 2026-10-31 (REPO-SCAN). Checked as a zip by magic number only.' },
  ],
  // Site-absolute references whose target is not a repo file.
  'runtime-ref': [
    { test: /^\/photos\/jacket-(back|detail)\.jpg$/,
      why: 'placeholder TEXT in the admin product form, not a request (src/admin/Products.jsx).' },
    { test: /^\/(config\.php|knet\/config\.php|pay\/config\.php|api\/config\.php|knet-config\.php|config-dist\.php|sporta-deploy\.php|sporta-deploy-config\.php|\.deploy-manifest\.json|deploy\.config\.json|package\.json|deployhostinger\.mjs|smoke-cbk\.mjs|api\.php)$/,
      why: 'public/go-live.html lists files that must NOT be on the server, or live only there (credentials, old deploy endpoints). They are named in order to be checked for absence.' },
    { test: /^\/(about|contact|returns|shop|product)\.html$/,
      why: 'scripts/generate-seo.mjs prints the sporta-html5 page names it writes; they are files of the fallback site, not of the web root.' },
    { test: /^\/(sporta-dist\.zip|\.cbk_token\.json|\.\.\/\.\.\/\.cbk_token\.json)$/,
      why: 'named in order to say they must NOT be in the web root: go-live.html checks sporta-dist.zip for absence; the CBK AccessToken cache is written by pay/ at runtime above the web root (SERVER-LAYOUT.md).' },
    { test: '/kpg/PaymentHTTP.htm',
      why: 'the bank\'s own KNET payment page path on the gateway host (knet.php), not a path on this site.' },
  ],
  // PHP files whose require / include targets live in a different folder when deployed.
  'php-require': [
    { test: /^sporta-live\/birthday\//,
      why: 'sporta-live/birthday/*.php are copies of dropin/php-store/birthday*.php and cron-birthday.php; they load store.php, cron-auth.php and customer-auth.php from the api/ folder they are deployed into (the siblings exist only in dropin/php-store).' },
  ],
  // Relative references whose target is not a tracked file.
  'relative-ref': [],
  // Paths the owner is told to use. KNOWN DEFECTS are marked as such so they print on every run.
  'doc-path': [
    { test: /^sporta-web\/scripts\/make-package\.mjs \/cats\/(men|women|accessories|outlet)\.jpg$/,
      why: 'KNOWN DEFECT (filenames-2): README-FIRST step 4c tells the owner to upload cats/men.jpg etc., but CategoryTile.jsx (and the live bundle) read cats/mobile/<id>.jpg and cats/desktop/<id>.jpg, so a photo uploaded as the zip says is never requested. Fix in make-package.mjs, SERVER-LAYOUT.md and Home.jsx comments.' },
    { test: 'SERVER-LAYOUT.md /api/index.php',
      why: 'KNOWN DEFECT (filenames-3): the tree in SERVER-LAYOUT.md lists knet/api/index.php "JSON API for the mobile app". dropin/php-knet has no api/ folder and the mobile app calls /api/api.php (sporta-app/lib/services/api.dart). A leftover from before the native backend.' },
    { test: /^(GO-LIVE\.md|SERVER-LAYOUT\.md|README\.md|sporta-web\/README\.md|KNET\.md|sporta-web\/NATIVE-BACKEND\.md|sporta-web\/scripts\/make-package\.mjs|sporta-web\/dropin\/[\w/-]*README\.md) \/(api|knet|pay)\/(config|\.cbk_token)\.(php|json)$/,
      why: 'the server-only files the owner creates (config.php) or the gateway writes (.cbk_token.json); never in the repo or the zip by design.' },
  ],
  // Commands / script names in the docs that are not in the repo.
  'doc-name': [
    { test: 'npm run deploy',
      why: 'CLAUDE.md and GO-LIVE.md name the deleted SFTP script in order to say it is gone.' },
  ],
}
const used = new Map()
const allowed = (rule, subject) => {
  for (const e of ALLOW[rule] ?? []) {
    const hit = typeof e.test === 'string' ? e.test === subject : e.test.test(subject)
    if (hit) { used.set(e, (used.get(e) ?? 0) + 1); return e }
  }
  return null
}

// -------------------------------------------------------------- file list
const listed = [
  ...git('ls-files', '-z').split('\0'),
  ...git('ls-files', '-z', '-o', '--exclude-standard').split('\0'),
].filter(Boolean)
const files = [...new Set(listed)]
  .filter((p) => !/(^|\/)(node_modules|dist)\//.test(p))
  .filter((p) => { try { return lstatSync(TOP + p).isFile() } catch { return false } })
  .sort()
const conv = {}
const fileSet = new Set(files)
const lowerMap = new Map()           // lower-case, NFC -> [names]
const fold = (s) => s.normalize('NFC').toLowerCase()
for (const f of files) lowerMap.set(fold(f), [...(lowerMap.get(fold(f)) ?? []), f])
const bytes = new Map()
const read = (p) => { if (!bytes.has(p)) bytes.set(p, readFileSync(TOP + p)); return bytes.get(p) }
const text = (p) => read(p).toString('utf8')
const TEXT_EXT = /\.(html?|css|js|jsx|mjs|cjs|json|xml|txt|php|webmanifest|sql|sh|md|py|awk|ini|glsl|yml|yaml|svg)$/i
const isText = (p) => TEXT_EXT.test(p) || /(^|\/)(\.htaccess|\.gitignore|\.nvmrc|\.node-version|\.env[\w.]*)$/.test(p)
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1)

console.log(`file-names: ${files.length} files (${listed.length - files.length > 0 ? 'duplicates and missing skipped' : 'tracked + untracked'})`)

// =========================================================== 1. CASE: names
{
  for (const [k, names] of lowerMap) {
    ok(names.length === 1, 'case', `names equal ignoring case / Unicode form: ${names.join(' = ')}`)
  }
  // Directories: a/Foo/x and a/foo/y are a collision even when no FILE collides.
  const dirs = new Map()
  for (const f of files) {
    const parts = f.split('/')
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      const s = dirs.get(fold(d)) ?? new Set()
      s.add(d); dirs.set(fold(d), s)
    }
  }
  for (const [, set] of dirs) ok(set.size === 1, 'case', `directories equal ignoring case: ${[...set].join(' = ')}`)
}

// Portability of EVERY tracked name (the owner's Mac, a Windows checkout, a zip):
// no character Windows forbids, no reserved device name, no trailing dot or space,
// and paths short enough for the 260-character Windows limit with room to spare.
{
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
  for (const f of files) {
    checks++
    const why = []
    for (const seg of f.split('/')) {
      if (/[<>:"\\|?*\x00-\x1f]/.test(seg)) why.push(`"${seg}" has a character Windows forbids`)
      if (RESERVED.test(seg.replace(/\..*$/, ''))) why.push(`"${seg}" is a reserved device name on Windows`)
      if (/[. ]$/.test(seg)) why.push(`"${seg}" ends in a dot or space`)
      if (seg.length > 100) why.push(`"${seg.slice(0, 20)}..." is ${seg.length} characters`)
    }
    if (f.length > 150) why.push(`path is ${f.length} characters`)
    if (why.length) fail('portable-name', `${f}: ${why.join('; ')}`)
  }
}

// ======================================================== 1b. CASE: references
// A reference resolves when the EXACT string is a tracked file. A string that
// resolves only when case is ignored is the Mac-works / Linux-404 bug.
const resolveRel = (fromFile, ref) => {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), ref))
  return base
}
const checkExact = (rule, from, ref, target, tries, allowRule) => {
  checks++
  for (const t of tries) if (fileSet.has(t)) return true
  for (const t of tries) {
    const alt = lowerMap.get(fold(t))
    if (alt) { fail('case', `${from}: "${ref}" matches only ignoring case -> ${alt[0]} (works on macOS, 404s on Linux)`); return false }
  }
  if (allowRule && allowed(allowRule, ref)) return true
  fail(rule, `${from}: "${ref}" resolves to no tracked file (tried ${tries.slice(0, 3).join(', ')})`)
  return false
}

// ---- JS / CSS relative imports (case-sensitive) -------------------------
{
  const exts = ['', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '/index.js', '/index.jsx']
  const re = /(?:\bimport\s[^'";]*?from\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*|@import\s+(?:url\()?\s*|\bexport\s[^'";]*?from\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g
  for (const f of files.filter((p) => /\.(jsx?|mjs|cjs|css)$/.test(p) && !/^brand\//.test(p))) {
    for (const m of text(f).matchAll(re)) {
      const ref = m[2].split('?')[0]
      const base = resolveRel(f, ref)
      checkExact('import', f, ref, base, exts.map((e) => base + e))
    }
  }
}

// ---- PHP require / include with __DIR__ or dirname(__DIR__) -------------
{
  const re = /\b(?:require|include)(?:_once)?\s*\(?\s*(dirname\(__DIR__\)|__DIR__)\s*\.\s*(['"])(\/[^'"]+)\2/g
  const re2 = /dirname\(__DIR__\)\s*\.\s*(['"])(\/[^'"]+\.php)\1/g
  for (const f of files.filter((p) => /\.php$/.test(p))) {
    if (allowed('php-require', f)) continue
    const t = text(f)
    for (const m of t.matchAll(re)) {
      const dir = m[1] === '__DIR__' ? posix.dirname(f) : posix.dirname(posix.dirname(f))
      const target = posix.normalize(dir + m[3])
      if (m[1] !== '__DIR__') continue                // handled below with its fallbacks
      if (/config\.php$/.test(m[3])) continue         // server-only by design
      checkExact('php-require', f, m[3], target, [target], null)
    }
    // dirname(__DIR__) . '/api/x.php' is the deployed layout (api/ is the bundled php-store);
    // the drop-ins fall back to ../php-store/. Either spelling must exist with exact case.
    for (const m of t.matchAll(re2)) {
      const rel = m[2]
      const asApi = rel.replace(/^\/api\//, '/php-store/')
      const target = posix.normalize(posix.dirname(posix.dirname(f)) + (rel.startsWith('/api/') ? asApi : rel))
      if (/\/(?:pay|knet|api)\/config\.php$/.test(rel) || /config\.php$/.test(rel)) continue   // server-only by design
      if (/^\/(?:\.cbk_token\.json|\.\.)/.test(rel)) continue
      const alt = rel.startsWith('/api/') ? [target, posix.dirname(posix.dirname(f)) + rel.replace(/^\/api\//, '/php-store/')] : [target]
      checkExact('php-require', f, rel, target, alt, null)
    }
  }
}

// ---- the served trees, for site-absolute references ----------------------
// web: sporta-web/public + the three drop-ins at /api /knet /pay
// html5: the no-build fallback, served from its own root
const served = { web: new Map(), html5: new Map() }
for (const f of files) {
  if (f.startsWith('sporta-web/public/')) served.web.set('/' + f.slice('sporta-web/public/'.length), f)
  else if (f.startsWith('sporta-html5/')) served.html5.set('/' + f.slice('sporta-html5/'.length), f)
  else {
    const m = /^sporta-web\/dropin\/(php-store|php-knet|php-cbk)\/(.+)$/.exec(f)
    if (m && !/^(README\.md|config\.php|\.cbk_token\.json)$/.test(m[2])) {
      served.web.set(`/${{ 'php-store': 'api', 'php-knet': 'knet', 'php-cbk': 'pay' }[m[1]]}/${m[2]}`, f)
    }
  }
}
served.web.set('/index.html', 'sporta-web/index.html')
const servedLower = {
  web: new Map([...served.web.keys()].map((k) => [fold(k), k])),
  html5: new Map([...served.html5.keys()].map((k) => [fold(k), k])),
}
// Hashed bundler output: /assets/<name>-<hash>.<ext> exists only in dist/.
const BUNDLED = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(js|css|woff2?|png|jpe?g|webp|svg)$/

const EXTS = 'png|jpe?g|webp|svg|gif|ico|css|js|mjs|json|webmanifest|xml|txt|woff2?|html?|php|mp3|mp4|webm|pdf|zip|ttf|otf'
const ABS = new RegExp(
  '(?:^|[\\s"\'`(=,;\\[{>])(?:https:\\/\\/www\\.sporta\\.com\\.kw)?(\\/[A-Za-z0-9_@~%+.\\-\\/]*[A-Za-z0-9_\\-]\\.(?:' + EXTS + '))(?=[\\s"\'`)?#,;\\]}<>\\\\]|$)', 'gm')

const absSources = (site) => files.filter((p) => {
  if (!isText(p) || /^brand\//.test(p) || /\.(md|sql)$/i.test(p)) return false
  if (site === 'html5') return p.startsWith('sporta-html5/')
  return /^sporta-web\/(index\.html|vite\.config\.js|src\/|public\/|dropin\/|scripts\/(generate-seo|build-html5)\.mjs|scripts\/lib\/sitemap\.mjs)/.test(p)
})
for (const site of ['web', 'html5']) {
  const map = served[site]
  for (const f of absSources(site)) {
    const seen = new Set()
    // .htaccess comments explain rules with example paths (/sub/.token.json); only live lines are references.
    const body = baseOf(f) === '.htaccess' ? text(f).replace(/^\s*#.*$/gm, '') : text(f)
    for (const m of body.matchAll(ABS)) {
      const ref = m[1]
      if (seen.has(ref)) continue
      // A PHP file's '/store.php' is a __DIR__-relative include (checked by the php-require rule), not a URL.
      if (f.endsWith('.php') && ref.endsWith('.php')) continue
      seen.add(ref)
      checks++
      if (map.has(ref) || BUNDLED.test(ref)) continue
      // vite's own root: /src/main.jsx in index.html
      if (site === 'web' && fileSet.has('sporta-web' + ref)) continue
      const near = servedLower[site].get(fold(ref))
      if (near) { fail('case', `${f}: "${ref}" matches only ignoring case -> ${near} (works on macOS, 404s on Linux)`); continue }
      if (allowed('runtime-ref', ref)) continue
      fail('abs-ref', `${f}: "${ref}" is not a file the ${site === 'web' ? 'web root (public/ + /api /knet /pay)' : 'HTML5 fallback'} serves`)
    }
  }
}

// ---- relative url() / src= / href= inside CSS, HTML and the manifests ----
{
  const skip = (r) => !r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|%23|\$|\{|<|data:|mailto:|tel:)/i.test(r) || r.includes('${') || r.startsWith('/')
  for (const f of files.filter((p) => /\.(css|html?|webmanifest)$/.test(p) && !/^brand\//.test(p))) {
    const t = text(f)
    const refs = []
    if (/\.css$/.test(f)) for (const m of t.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) refs.push(m[2])
    else if (/\.html?$/.test(f)) for (const m of t.matchAll(/\b(?:src|href|poster)\s*=\s*(['"])([^'"]*)\1/gi)) refs.push(m[2])
    else for (const m of t.matchAll(/"src"\s*:\s*"([^"]+)"/g)) refs.push(m[1])
    for (const r of refs) {
      if (skip(r)) continue
      const clean = r.split(/[?#]/)[0]
      if (!/\.[A-Za-z0-9]{2,5}$/.test(clean)) continue            // a route, not a file
      const target = resolveRel(f, clean)
      checkExact('relative-ref', f, r, target, [target], 'relative-ref')
    }
  }
}

// ---- package.json scripts and the scripts the docs name ------------------
{
  const pkgPath = 'sporta-web/package.json'
  const pkg = JSON.parse(text(pkgPath))
  const names = new Set(Object.keys(pkg.scripts))
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    for (const m of cmd.matchAll(/\b(?:node|bash|sh)\s+((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js|sh|py|php))/g)) {
      const target = posix.normalize('sporta-web/' + m[1])
      checkExact('package-script', `package.json script "${name}"`, m[1], target, [target], null)
    }
  }
  const baseExact = new Set(files.map(baseOf))
  const baseLower = new Map(files.map((f) => [fold(baseOf(f)), baseOf(f)]))
  const docs = files.filter((p) => /\.(md|txt|sh)$/i.test(p) && !/^brand\//.test(p) && !/^sporta-web\/node_modules/.test(p))
  const stale = []
  for (const f of docs) {
    const t = text(f)
    // `node scripts/x.mjs`, `bash x.sh`, `scripts/x.mjs`
    for (const m of t.matchAll(/(?:\bnode|\bbash|\bsh|\bpython3?)\s+(?:[\w.\/-]*\/)?([\w.-]+\.(?:mjs|cjs|sh|py))\b|\bscripts\/([\w.-]+\.(?:mjs|cjs|sh|py|php))\b/g)) {
      const b = m[1] ?? m[2]
      checks++
      if (baseExact.has(b)) continue
      if (baseLower.has(fold(b))) { fail('case', `${f}: names "${b}" but the file is ${baseLower.get(fold(b))}`); continue }
      if (allowed('doc-name', b)) continue
      stale.push(`${f}: ${b}`)
    }
    for (const m of t.matchAll(/\bnpm run ([a-z][\w:-]*)/g)) {
      checks++
      if (names.has(m[1])) continue
      const near = [...names].find((n) => n.toLowerCase() === m[1].toLowerCase())
      if (near) { fail('case', `${f}: "npm run ${m[1]}" but the script is "${near}"`); continue }
      if (['build', 'dev', 'start', 'test'].includes(m[1])) continue
      if (allowed('doc-name', 'npm run ' + m[1])) continue
      stale.push(`${f}: npm run ${m[1]}`)
    }
  }
  globalThis.__staleDocs = stale
}

// ---- .htaccess: the file names the rules spell out -----------------------
{
  const baseExact = new Set(files.map(baseOf))
  const baseLower = new Map(files.map((f) => [fold(baseOf(f)), baseOf(f)]))
  for (const f of files.filter((p) => baseOf(p) === '.htaccess')) {
    const t = text(f)
    // <Files "name">  and  RewriteCond %{DOCUMENT_ROOT}/path -f  and ErrorDocument
    for (const m of t.matchAll(/<Files\s+"([^"]+)">/g)) {
      checks++
      const n = m[1]
      if (baseExact.has(n)) continue
      const near = baseLower.get(fold(n))
      if (near) fail('case', `${f}: <Files "${n}"> but the file is ${near}; Apache matches case-sensitively`)
      // a <Files> for a file that only lives on the server (config.js, sw.js are in public/) is fine; report the rest
      else if (!/^(config\.php|index\.php)$/.test(n)) fail('htaccess-name', `${f}: <Files "${n}"> names no tracked file`)
    }
    for (const m of t.matchAll(/RewriteCond\s+%\{DOCUMENT_ROOT\}(\/[^\s]+)\s+-f/g)) {
      checks++
      const hit = served.web.has(m[1])
      if (!hit && servedLower.web.get(fold(m[1]))) fail('case', `${f}: RewriteCond DOCUMENT_ROOT${m[1]} -f differs by case from ${servedLower.web.get(fold(m[1]))}`)
      else if (!hit) fail('htaccess-name', `${f}: RewriteCond DOCUMENT_ROOT${m[1]} -f names a file nothing serves, so the rule never fires`)
    }
    for (const m of t.matchAll(/^ErrorDocument\s+\d+\s+(\/\S+)/gm)) {
      checks++
      const map = f.startsWith('sporta-html5/') ? served.html5 : served.web
      ok(map.has(m[1]), 'htaccess-name', `${f}: ErrorDocument ${m[1]} is not a served file`)
    }
    // Names inside FilesMatch / RewriteRule regexes: \.-escaped words with a dotted extension.
    for (const m of t.matchAll(/(?:FilesMatch\s+"([^"]+)"|RewriteRule\s+"?\^?([A-Za-z0-9_\\.\-]+\\\.[a-z]{2,5})\$?"?\s)/g)) {
      const pat = m[1] ?? m[2]
      if (/\(\?i\)/.test(pat)) continue                       // declared case-insensitive
      for (const tok of pat.matchAll(/(?<![\\\w-])([A-Za-z0-9][A-Za-z0-9_-]*(?:\\\.[A-Za-z0-9]{1,5})+)(?![\w-])/g)) {
        const name = tok[1].replace(/\\\./g, '.')
        checks++
        if (baseExact.has(name)) continue
        const near = baseLower.get(fold(name))
        if (near) fail('case', `${f}: a rule names "${name}" but the file is ${near}; the pattern is case-sensitive`)
      }
    }
  }
}

// ---- file paths the owner is TOLD to use (README-FIRST, GO-LIVE, SERVER-LAYOUT) ----
// A packaged instruction that names a file the code never reads is the quietest
// kind of case/name bug: the owner does exactly what it says and nothing happens.
{
  const docs = ['sporta-web/scripts/make-package.mjs', 'GO-LIVE.md', 'SERVER-LAYOUT.md', 'README.md', 'sporta-web/README.md', 'KNET.md', 'sporta-web/NATIVE-BACKEND.md', 'sporta-web/dropin/README.md', 'sporta-web/dropin/php-knet/README.md', 'sporta-web/dropin/php-cbk/README.md']
  const re = /(?<![\w./-])(?:public_html\/)?((?:cats|hero|fonts|api|knet|pay|images)\/[\w./-]*[\w-]\.(?:jpe?g|webp|png|php|sql|woff2|js|css|json|svg|htaccess))(?![\w-])/g
  for (const f of docs.filter((d) => fileSet.has(d))) {
    const seen = new Set()
    for (const m of text(f).matchAll(re)) {
      const url = '/' + m[1]
      if (seen.has(url)) continue
      seen.add(url)
      checks++
      if (served.web.has(url)) continue
      const near = servedLower.web.get(fold(url))
      if (near) { fail('case', `${f}: tells the owner "${m[1]}" but the file is ${near}`); continue }
      if (allowed('doc-path', f + ' ' + url)) continue
      fail('doc-path', `${f}: tells the owner about "${m[1]}", which nothing in the repo serves or reads`)
    }
  }
}

// ---- a fixed-name file must not be served as immutable for a year ----------
// public/.htaccess marks  -<8+ chars>.js|css  immutable (hashed bundles). The pattern
// is not anchored, so any add-on with a long second word (sporta-admin-brands.js)
// matches it too; the later no-cache FilesMatch is what saves it. A NEW fixed-name
// .js/.css that is in neither list would be pinned in browsers for a year.
{
  const ht = text('sporta-web/public/.htaccess')
  const imm = /<FilesMatch\s+"(-\[A-Za-z0-9_-\]\{8,\}\\\.\(js\|css\)\$)">/.exec(ht)
  const noc = /<FilesMatch\s+"(\^\(boot\\\.js\|[^"]+)">/.exec(ht)
  if (ok(!!imm && !!noc, 'convention', 'public/.htaccess: the immutable-hash FilesMatch or the add-on no-cache FilesMatch was not found')) {
    const reI = new RegExp(imm[1]), reN = new RegExp(noc[1])
    for (const f of files.filter((p) => /^sporta-web\/public\/.+\.(js|css)$/.test(p))) {
      const n = baseOf(f)
      if (reI.test(n)) ok(reN.test(n), 'convention', `${f}: matches the immutable one-year cache rule and is not in the no-cache list, so a changed file would be stuck in browsers`)
    }
  }
}

// ---- a public file or folder must not shadow an SPA route ----------------
// .htaccess: "real files and directories always win", so public/shop/ or
// public/privacy.html would answer /shop and /privacy instead of the app.
{
  const app = text('sporta-web/src/App.jsx')
  const routes = new Set([...app.matchAll(/path=(['"])\/?([a-z0-9-]+)[/'":]/g)].map((m) => m[2]))
  ;['backends', 'product', 'payment', 'invoice'].forEach((r) => routes.add(r))
  const tops = new Set()
  for (const f of files.filter((p) => p.startsWith('sporta-web/public/'))) tops.add(f.slice('sporta-web/public/'.length).split('/')[0])
  for (const t of ['api', 'knet', 'pay']) tops.add(t)
  for (const t of tops) {
    const stem = t.replace(/\.[^.]+$/, '')
    ok(!routes.has(t) && !(t !== stem && routes.has(stem) && /\.html?$/.test(t)), 'convention', `public/${t} shadows the /${stem} route (real files and directories win over the SPA rewrite)`)
  }
  conv.routes = [...routes].sort()
}

// ======================================================== 2. URL-safe names
{
  const SERVED = /^(sporta-web\/public\/|sporta-web\/dropin\/|sporta-html5\/)/
  const DOUBLE_OK = /\.(mysql\.sql|example\.php|tex\.png)$/
  for (const f of files.filter((p) => SERVED.test(p))) {
    if (allowed('served-name', f)) continue
    const rel = f.replace(/^sporta-web\/public\/|^sporta-web\/dropin\/(php-store|php-knet|php-cbk)\/|^sporta-html5\//, '')
    for (const seg of rel.split('/')) {
      checks++
      if (seg === '.htaccess') continue
      const why = []
      if (/[^\x21-\x7e]/.test(seg)) why.push('space / control / non-ASCII')
      if (/[ ()+%,'"&;=@!#$*?<>|:\\[\]{}~^`]/.test(seg)) why.push('URL-unsafe character')
      if (/[A-Z]/.test(seg)) why.push('uppercase')
      if (/^\./.test(seg)) why.push('leading dot')
      if (/\.$/.test(seg)) why.push('trailing dot')
      if (seg.length > 100) why.push(`${seg.length} characters`)
      if (/\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(seg) && !DOUBLE_OK.test(seg) && !/\.(min|d)\.\w+$/.test(seg)) why.push('double extension')
      if (/^-|--|__/.test(seg)) why.push('leading dash or doubled separator')
      if (why.length) fail('served-name', `${f}: segment "${seg}": ${why.join(', ')}`)
    }
  }
}

// ============================================ 3. extension vs content (bytes)
const MAGIC = {
  png: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  gif: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
  ico: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  woff2: (b) => b.subarray(0, 4).toString('latin1') === 'wOF2',
  woff: (b) => b.subarray(0, 4).toString('latin1') === 'wOFF',
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5),
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
}
const sniffImage = (b) => (MAGIC.png(b) ? 'png' : MAGIC.jpg(b) ? 'jpg' : MAGIC.webp(b) ? 'webp' : MAGIC.gif(b) ? 'gif' : null)
const countBy = {}
for (const f of files) {
  const b = read(f)
  const ext = (/\.([A-Za-z0-9]+)$/.exec(baseOf(f))?.[1] ?? '').toLowerCase()
  const ex = allowed('content', f)
  checks++
  if (b.length === 0) { if (!ex) fail('content', `${f}: 0 bytes`); continue }
  if (ex) continue
  countBy[ext] = (countBy[ext] ?? 0) + 1
  if (MAGIC[ext]) {
    if (!MAGIC[ext](b)) {
      const real = sniffImage(b)
      fail('content', `${f}: extension .${ext} but the bytes are ${real ? real.toUpperCase() : 'not ' + ext.toUpperCase()}`)
    }
    continue
  }
  if (ext === 'pyc') { fail('content', `${f}: compiled bytecode is tracked`); continue }
  if (!isText(f)) continue
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart()
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  if (b.includes(0) && !allowed('content-nul', f)) fail('content', `${f}: text extension but contains a NUL byte at offset ${b.indexOf(0)} (git, grep and GitHub treat the file as binary)`)
  if (bom && /^(php|js|jsx|mjs|cjs|json|css|sh|webmanifest|htaccess)$/.test(ext || 'htaccess')) fail('content', `${f}: byte-order mark before the first character`)
  if (/(^|\.)(php|sh)$/.test(baseOf(f)) || baseOf(f) === '.htaccess') {
    if (b.includes(0x0d)) fail('content', `${f}: CRLF line endings in a server-side script / .htaccess`)
  }
  if (/^(js|jsx|mjs|cjs|css)$/.test(ext) && /^<(?:!doctype|html|head|body|\?xml)/i.test(head)) fail('content', `${f}: .${ext} whose content is HTML (a captive-portal or error page saved as a script)`)
  if (ext === 'php' && !/^<\?php/.test(b.toString('utf8', 0, 8).replace(/^﻿/, ''))) fail('content', `${f}: .php that does not start with <?php (any byte before it is sent as output)`)
  if (ext === 'json' || ext === 'webmanifest') {
    try { JSON.parse(b.toString('utf8').replace(/^﻿/, '')) } catch (e) { fail('content', `${f}: .${ext} does not parse as JSON (${String(e.message).slice(0, 60)})`) }
  }
  if (ext === 'xml') ok(/^<\?xml|^<[a-z]/i.test(head), 'content', `${f}: .xml that does not start with XML`)
  if (ext === 'html' || ext === 'htm') ok(/^<!doctype html|^<html|^<!--|^<\?php/i.test(head), 'content', `${f}: .html that does not start like a page`)
  if (ext === 'svg') {
    const s = b.toString('utf8')
    ok(/<svg[\s>]/.test(s), 'content', `${f}: .svg without an <svg> element`)
    const danger = /<script\b|\son[a-z]+\s*=|javascript:|<foreignObject\b|<!ENTITY|<iframe\b|xlink:href\s*=\s*["']\s*(?:https?:|data:text)/i.exec(s)
    ok(!danger, 'content', `${f}: .svg carries active content (${danger?.[0]}); an SVG served from our own origin runs it`)
  }
}

// ============================================================ 4. conventions
{
  const pub = files.filter((p) => /^sporta-web\/public\/[^/]+$/.test(p)).map(baseOf)
  const addons = pub.filter((n) => /^sporta-.+\.(css|js)$/.test(n))
  // The list CLAUDE.md gives for what the live index.html links, plus the loaders.
  const CSS = ['sporta-product-fix', 'sporta-brand-theme', 'sporta-home-trim', 'sporta-cart-drawer', 'sporta-grid', 'sporta-bag-touch', 'sporta-cat-tiles', 'sporta-admin-knet', 'sporta-returns-touch', 'sporta-clock', 'sporta-ui-colours', 'sporta-checkout-a11y', 'sporta-shadows', 'sporta-images'].map((n) => n + '.css')
  const JS = ['sporta-features', 'sporta-admin-brands', 'sporta-footer-call', 'sporta-gov-autopick', 'sporta-clock', 'sporta-checkout-a11y'].map((n) => n + '.js')
  const expected = new Set([...CSS, ...JS])
  for (const n of addons) ok(expected.has(n), 'convention', `public/${n}: an add-on the live index.html is not known to link (a file not in the list is never loaded; CLAUDE.md item 5)`)
  for (const n of expected) ok(addons.includes(n), 'convention', `public/${n} is in the live add-on list but is not tracked`)
  conv.addons = addons
  // The specials by design: loaded by name from the live index.html or by the browser.
  const SPECIAL = ['boot.js', 'config.js', 'birthday.js', 'sw.js', 'backends-offline.css', 'backends-offline.html', 'backends-icon.svg', 'backends.webmanifest', 'go-live.html', 'product-photo-unavailable.svg']
  conv.special = SPECIAL.filter((n) => pub.includes(n))
  for (const n of SPECIAL) ok(pub.includes(n), 'convention', `public/${n} is a named special file (live index.html / browser / service worker) but is not tracked`)

  // Every add-on and loader is in the no-cache FilesMatch of public/.htaccess.
  const ht = text('sporta-web/public/.htaccess')
  const line = /<FilesMatch\s+"(\^\(boot\\\.js\|[^"]+)">/.exec(ht)
  if (ok(!!line, 'convention', 'public/.htaccess: the add-on no-cache FilesMatch (starting ^(boot\\.js|) was not found')) {
    const re = new RegExp(line[1])
    for (const n of [...addons, 'boot.js', 'birthday.js', 'backends-offline.css']) {
      ok(re.test(n), 'convention', `public/${n} is not matched by the add-on no-cache FilesMatch in public/.htaccess`)
    }
    const BUILT = new Set(['sporta-admin-brands.full.js'])
    // And the reverse: every alternative names a file that exists.
    const alts = line[1].replace(/^\^\(/, '').replace(/\)\$$/, '')
    const expand = (s) => { const m = /\(([^()|]+(?:\|[^()|]+)*)\)/.exec(s); return m ? m[1].split('|').flatMap((o) => expand(s.replace(m[0], o))) : [s] }
    for (const a of alts.split('|').flatMap(() => []).concat(expand(alts.replace(/\|(?![^()]*\))/g, '\u0001')).flatMap((x) => x.split('\u0001')))) {
      const name = a.replace(/\\\./g, '.')
      // Made at build time from public/sporta-admin-brands.js (scripts/split-admin-addon.mjs): the loader's target, never linked by index.html.
      ok(pub.includes(name) || BUILT.has(name), 'convention', `public/.htaccess no-cache list names "${name}" but public/ has no such file`)
    }
  }

  // Scripts
  const sc = files.filter((p) => /^sporta-web\/scripts\/[^/.][^/]*$/.test(p)).map(baseOf)
  const KINDS = /-(test|scan|check|audit|rig|mutants|regression|probe|doctor|manager|watch|deploy|stub|gateway|bank|mta|voice|whatsapp)\.(mjs|php|sh|py)$/
  conv.scriptsWithoutKind = sc.filter((n) => !KINDS.test(n))
  const pkg = JSON.parse(text('sporta-web/package.json'))
  const pk = JSON.stringify(pkg.scripts)
  const doc = files.filter((p) => /\.(md|txt|sh|mjs|js)$/.test(p) && !/^brand\//.test(p)).map((p) => [p, text(p)])
  conv.orphans = []
  for (const n of sc.filter((n) => /-(test|scan|check|audit)\.(mjs)$/.test(n))) {
    if (pk.includes('scripts/' + n)) continue
    const refs = doc.filter(([p, t]) => p !== 'sporta-web/scripts/' + n && t.includes(n))
    if (!refs.length) conv.orphans.push(n)
  }
  conv.testNotInPackage = sc.filter((n) => /-test\.mjs$/.test(n) && !pk.includes('scripts/' + n))
  // test scripts follow <topic>-test.mjs and have an npm script test:<topic>
  for (const n of sc.filter((n) => /-test\.mjs$/.test(n))) ok(/^[a-z0-9]+(-[a-z0-9]+)*-test\.mjs$/.test(n), 'convention', `scripts/${n}: not <lowercase-words>-test.mjs`)

  // Internal state leaking into a name that ships.
  const SHIPPED = /^(sporta-web\/(public|dropin)\/|sporta-html5\/)/
  const LEAK = /(^|[/._-])(wip|scratch|tmp|temp|old|copy|final|backup|bak|v2|v3|draft|untitled|todo|orig|new)([/._-]|$)/i
  for (const f of files.filter((p) => SHIPPED.test(p))) ok(!LEAK.test(f.replace(/^sporta-web\/(public|dropin)\/|^sporta-html5\//, '')), 'convention', `${f}: a shipped name that leaks working state`)
  for (const f of files.filter((p) => SHIPPED.test(p))) ok(!/(^|\/)(test|tests|__tests__|fixtures?|mocks?)(\/|$)/i.test(f), 'convention', `${f}: a test / fixture folder inside a shipped tree`)

  // Docs
  const md = files.filter((p) => /\.md$/.test(p) && !/^brand\//.test(p))
  conv.docsUpper = md.filter((p) => /^[A-Z0-9][A-Z0-9-]*\.md$/.test(baseOf(p)))
  conv.docsOther = md.filter((p) => !/^[A-Z0-9][A-Z0-9-]*\.md$/.test(baseOf(p)))
  conv.datedReports = md.filter((p) => /-\d{4}-\d{2}-\d{2}\.md$/.test(p))
  for (const p of conv.datedReports) ok(/^[A-Z0-9][A-Z0-9-]*-\d{4}-\d{2}-\d{2}\.md$/.test(baseOf(p)), 'convention', `${p}: a dated report is UPPERCASE-WORDS-YYYY-MM-DD.md`)
  conv.fixtures = files.filter((p) => /^sporta-web\/scripts\/fixtures\//.test(p))
  conv.compiledStems = (() => {
    // src/lib/cart.jsx and src/pages/Cart.jsx build chunks cart-<hash>.js and Cart-<hash>.js
    const m = new Map()
    for (const f of files.filter((p) => /^sporta-web\/src\/.*\.(jsx?|css)$/.test(p))) {
      const stem = baseOf(f).replace(/\.[^.]+$/, '')
      m.set(stem.toLowerCase(), [...(m.get(stem.toLowerCase()) ?? []), f])
    }
    return [...m.values()].filter((v) => new Set(v.map((x) => baseOf(x).replace(/\.[^.]+$/, ''))).size > 1)
  })()
}

// ================================================================== report
console.log(`file-names: ${checks} checks`)
const stale = globalThis.__staleDocs ?? []
console.log(`\nINFO  add-ons (${conv.addons.length} sporta-*.css|js in public/): ${conv.addons.join(' ')}`)
console.log(`INFO  specials by design (${conv.special.length}): ${conv.special.join(' ')}`)
console.log(`INFO  scripts with no recognised -test/-scan/-check/-audit/... suffix (${conv.scriptsWithoutKind.length}): ${conv.scriptsWithoutKind.join(' ')}`)
console.log(`INFO  scan/check/audit scripts in no package.json script and named by no doc or script (${conv.orphans.length}): ${conv.orphans.join(' ') || 'none'}`)
console.log(`INFO  *-test.mjs not in package.json (${conv.testNotInPackage.length}): ${conv.testNotInPackage.join(' ') || 'none'}`)
console.log(`INFO  docs UPPERCASE.md ${conv.docsUpper.length}, other ${conv.docsOther.length}: ${conv.docsOther.join(' ')}; dated reports ${conv.datedReports.length}`)
console.log(`INFO  fixtures (${conv.fixtures.length}) under scripts/fixtures/`)
console.log(`INFO  source stems that differ only by case (chunk names cart-<hash>.js vs Cart-<hash>.js): ${conv.compiledStems.map((v) => v.map((x) => x.replace('sporta-web/src/', '')).join(' + ')).join(' ; ') || 'none'}`)
console.log(`INFO  doc commands / script names that match no file (${stale.length}): ${stale.slice(0, 12).join(' | ')}${stale.length > 12 ? ' ...' : ''}`)

const usedList = [...used.entries()]
console.log(`\nEXCEPTIONS used (${usedList.length}):`)
for (const [e, n] of usedList) console.log(`  x${n}  ${typeof e.test === 'string' ? e.test : e.test.source}\n        why: ${e.why}`)
for (const rule of Object.keys(ALLOW)) for (const e of ALLOW[rule]) if (!used.has(e)) console.log(`UNUSED exception [${rule}] ${typeof e.test === 'string' ? e.test : e.test.source} (nothing needs it any more; delete it)`)

if (failures) {
  console.log(`\n${bad.join('\n')}`)
  console.log(`\nfile-names: ${failures} FAILED of ${checks} checks`)
  process.exit(1)
}
console.log(`\nfile-names: ${checks} checks, 0 failed`)
