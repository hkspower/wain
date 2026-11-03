#!/usr/bin/env node
// PLUGINS INVENTORY — everything plugged into the shop that the repo can see,
// each item marked KNOWN (named and explained in CLAUDE.md or the docs, with an
// owner decision) or UNKNOWN (explained nowhere). Rig-free: no server, no
// database, no network, no writes. It reads the working tree and prints a table.
//
//   node scripts/plugins-inventory.mjs                  (npm run audit:plugins)
//   node scripts/plugins-inventory.mjs --live-index <captured live index.html>
//   node scripts/plugins-inventory.mjs --no-home        (skip the session-harness hooks)
//
// Exit 0 when every item is KNOWN; exit 1 when an UNKNOWN item exists. "Plug" is
// read broadly: a script, stylesheet, font kit, beacon or widget the page loads;
// an outbound host the backend talks to; an npm package with an install script;
// an MCP server; a hook that runs commands; a script that downloads and runs
// code; a Docker image by tag; a CI/deploy-platform file.
//
// WHAT IS CHECKED
//   1. PAGE   The repo index.html and (with --live-index) the captured live page:
//             every script/link/iframe tag, inline scripts, external hosts. The
//             add-on files in public/ against the add-on list the live index.html
//             links (CLAUDE.md item 5) and sporta-live/MANIFEST.md: a file in
//             public/ that nothing links never loads (dead add-on); a linked name
//             with no file in public/ cannot be deployed from here.
//   2. HOSTS  Every https?://host in shipped code (index.html, public/, src/, the
//             three PHP drop-ins) against KNOWN_HOSTS below.
//   3. WIDGETS Analytics / pixel / chat / captcha / share tokens in shipped code.
//   4. NPM    package-lock.json: packages with an install script, packages not
//             resolved from registry.npmjs.org, dependencies nothing imports,
//             lifecycle scripts in package.json (preinstall/postinstall/prepare).
//   5. MCP    .mcp.json servers: command, version pin, env values must be
//             ${VAR} references (a literal key in a committed file is on GitHub).
//   6. HOOKS  Repo: .claude/settings.json hooks, .github/ (must not exist),
//             .husky/, pre-commit, lefthook, vercel.json and other platform files.
//             Session harness (~/.claude/launcher-settings.json, settings.json):
//             listed for information, outside the repo, never a failure.
//   7. SCRIPTS scripts/ that download and run code (codeload/raw.githubusercontent
//             + exec), `npx` without a version pin, Docker images by tag.
//
// ALLOW-LIST WITH REASONS — an item is KNOWN only because a line here says why.
// Add a line when the owner decides something; never to make the run green.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve, relative, basename, extname } from 'node:path'
import { homedir } from 'node:os'

const WEB = resolve(new URL('..', import.meta.url).pathname)
const ROOT = resolve(WEB, '..')
const argv = process.argv.slice(2)
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const LIVE_INDEX = argOf('--live-index')
const SKIP_HOME = argv.includes('--no-home')

// ---------------------------------------------------------------------------
// 1. The add-ons the LIVE index.html links (CLAUDE.md item 5, measured 2026-11-03).
//    A new add-on file is never loaded until the owner adds a tag to the live page.
const LIVE_ADDONS_CSS = [
  'sporta-product-fix', 'sporta-brand-theme', 'sporta-home-trim', 'sporta-cart-drawer',
  'sporta-grid', 'sporta-bag-touch', 'sporta-cat-tiles', 'sporta-admin-knet',
  'sporta-returns-touch', 'sporta-clock', 'sporta-ui-colours', 'sporta-checkout-a11y',
  'sporta-shadows', 'sporta-images',
]
const LIVE_ADDONS_JS = [
  'boot', 'config', 'birthday', 'sporta-features', 'sporta-admin-brands',
  'sporta-footer-call', 'sporta-gov-autopick', 'sporta-clock', 'sporta-checkout-a11y',
]
// Files in public/ that are not add-ons and are loaded by something other than a
// tag in index.html (the reason says what loads them).
const PUBLIC_LOADED_BY = {
  'sw.js': 'registered by src/main.jsx and by the live bundle (navigator.serviceWorker.register)',
  'site.webmanifest': '<link rel=manifest> in index.html',
  'backends.webmanifest': 'swapped in by boot.js on /backends (PWA for the admin)',
  'backends-icon.svg': 'icon named in backends.webmanifest',
  'backends-offline.html': 'offline fallback for /backends served by the service worker / .htaccess (REPO-SCAN hygiene: listed in sporta-live/MANIFEST.md)',
  'backends-offline.css': 'stylesheet of backends-offline.html (.htaccess cache rule names it)',
  'go-live.html': 'SETUP TOOL: GO-LIVE.md says delete it from the server once set up; publish-ftps.mjs does not send it without --setup-tools',
  'product-photo-unavailable.svg': 'placeholder image, src/components/ProductGallery.jsx and sporta-cat-tiles.css',
  'llms.txt': 'AI-crawler summary, cached by .htaccess, linked from robots.txt policy',
  'robots.txt': 'crawler policy (disallows /backends)',
  'sitemap.xml': 'sitemap index (generate-seo.mjs)',
  'sitemap-pages.xml': 'child sitemap (generate-seo.mjs)',
  'sitemap-products.xml': 'child sitemap (generate-seo.mjs)',
  '.htaccess': 'Apache config (GO-LIVE.md: hidden, the most common thing to miss on upload)',
  'og-image.png': 'og:image in index.html and seo-page.php',
  'logo.png': 'brand master copy for light backgrounds (CLAUDE.md Brand identity)',
  'logo-white.png': 'brand master copy for dark backgrounds (CLAUDE.md Brand identity)',
  'logo-white.webp': 'header logo, preloaded in index.html',
  'favicon.png': '512px icon, manifests and HeroSlider',
  'favicon-32.png': 'tab icon (index.html)',
  'favicon-192.png': 'install icon (index.html, manifests)',
  'apple-touch-icon.png': 'iOS home-screen icon (index.html)',
}

// ---------------------------------------------------------------------------
// 2. Outbound hosts in shipped code. Reason = where it is documented.
const KNOWN_HOSTS = {
  'www.sporta.com.kw': 'the shop itself; canonical origin (CLAUDE.md "Going live")',
  'sporta.com.kw': 'apex spelling, 301 to www in .htaccess',
  'wa.me': 'WhatsApp click-to-chat to the shop number +965 2209 1914 (Footer, Contact, Returns, sporta-features.js; WHATSAPP.md)',
  'www.instagram.com': 'the shop\'s Instagram, sameAs in JSON-LD and footer (index.html)',
  'www.tiktok.com': 'the shop\'s TikTok, sameAs in JSON-LD and footer (index.html)',
  'schema.org': 'JSON-LD @context (CLAUDE.md "Product structured data")',
  'www.w3.org': 'SVG / XML namespaces',
  'www.sitemaps.org': 'sitemap XML namespace (generate-seo.mjs)',
  'use.typekit.net': 'Adobe Fonts kits qkv4ztg + xgg6rku linked by the LIVE index.html (VPS-SCAN-2026-10-31 CSS scan finding 1); allowed in the .htaccess CSP font-src/style-src; loaded async by boot.js',
  'p.typekit.net': 'Adobe Fonts beacon host, preconnect in the live index.html and CSP style-src',
  'kpay.com.kw': 'KNET production gateway (KNET.md; dropin/php-knet)',
  'kpaytest.com.kw': 'KNET test gateway (KNET.md; dropin/php-knet)',
  'pg.cbk.com': 'CBK hosted gateway, T-Pay production (dropin/php-cbk/README.md)',
  'pgtest.cbk.com': 'CBK hosted gateway, T-Pay test (dropin/php-cbk/README.md)',
  'graph.facebook.com': 'WhatsApp Cloud API, cron-whatsapp.php, config key whatsapp_api_base (WHATSAPP.md)',
  'api.anthropic.com': 'Sporta AI assistant, config key ai_url (SPORTA-AI-VOICE.md); server-side only, key in api/config.php on the server',
  'api.elevenlabs.io': 'assistant voice (TTS), config keys tts_* (SPORTA-AI-VOICE.md); server-side only',
  'accounts.google.com': 'admin Google sign-in, dropin/php-store/admin-google.php (CLAUDE.md item 4: live admin feature)',
  'oauth2.googleapis.com': 'admin Google sign-in token exchange (admin-google.php)',
  'www.googleapis.com': 'admin Google sign-in userinfo (admin-google.php)',
  'www.google.com': 'Google Maps link written into the order note by the checkout "Share my location" control (CLAUDE.md item 5, deployed 2026-11-03)',
  '127.0.0.1': 'loopback: sandbox/test configuration only (config.example.php, test fixtures)',
  'localhost': 'loopback: Vite dev / preview, service-worker guard in main.jsx',
  'claude.ai': 'session link left in a CSS comment (REPO-SCAN-2026-11-03 webcode-15: strip from served CSS); not fetched',
  'evil.com': 'allow-list comment / test fixture in the PHP drop-ins; never fetched',
  'react.dev': 'React warning URLs inside the vendor bundle; never fetched',
  'reactrouter.com': 'react-router warning URLs inside the vendor bundle; never fetched',
  'github.com': 'polyfill hint URL inside the vendor bundle; never fetched',
}
// Hosts that are KNOWN only in the no-build fallback and the Flutter skeleton,
// never in sporta-web (the live site self-hosts its fonts; REPO-SCAN webcode-20).
const FALLBACK_ONLY_HOSTS = {
  'fonts.googleapis.com': 'sporta-html5 fallback and sporta-app load Google Fonts at runtime (REPO-SCAN webcode-20, hygiene-9: archive or fix)',
  'fonts.gstatic.com': 'same (Google Fonts file host)',
}

// ---------------------------------------------------------------------------
// 3. Third-party widget tokens. Word-bounded so "Crisp sunset" (a theme name in
//    the bundle) and "live chat" (an assistant keyword) do not match.
const WIDGETS = [
  ['Google Analytics / gtag', /\bgtag\s*\(|googletagmanager\.com|google-analytics\.com|\bGTM-[A-Z0-9]{4,}\b/],
  ['Meta pixel', /\bfbq\s*\(|connect\.facebook\.net/],
  ['Microsoft Clarity', /clarity\.ms/],
  ['Hotjar', /hotjar\.com|\bhj\s*\(\s*['"]/],
  ['tawk.to', /tawk\.to/],
  ['Crisp chat', /crisp\.chat|client\.crisp/],
  ['Intercom', /intercomcdn|widget\.intercom\.io|\bIntercom\s*\(/],
  ['Zendesk', /zdassets\.com|zendesk\.com/],
  ['Sentry', /sentry\.io|sentry-cdn|@sentry\//],
  ['PostHog', /posthog\.com|\bposthog\.init/],
  ['reCAPTCHA', /recaptcha/i],
  ['Turnstile', /challenges\.cloudflare\.com|turnstile/i],
  ['hCaptcha', /hcaptcha/i],
  ['AddThis / ShareThis', /addthis|sharethis/i],
  ['Disqus', /disqus\.com/],
  ['JivoChat', /jivosite|jivochat/i],
  ['Smartsupp', /smartsupp/i],
  ['Tidio', /tidio/i],
  ['LiveChat', /livechatinc\.com|cdn\.livechat/i],
  ['WhatsApp widget script', /wa\.me\/[^'"]*widget|whatsapp-widget|elfsight/i],
]

// ---------------------------------------------------------------------------
// 4. npm. Reasons for the exceptions.
const KNOWN_INSTALL_SCRIPTS = {
  fsevents: 'macOS file watcher, optional dependency of vite/chokidar and playwright; never installed on Linux',
}
const KNOWN_UNIMPORTED_DEPS = {
  autoprefixer: 'not imported: Tailwind v4 bundles it (postcss.config.js says so); removable',
}
const KNOWN_LIFECYCLE = {
  postbuild: 'node scripts/csp-hashes.mjs — writes the inline-script hashes into dist/.htaccess (vite.config.js nonBlockingCss)',
}

// ---------------------------------------------------------------------------
// 5. MCP servers the repo may configure.
const KNOWN_MCP = {
  elevenlabs: { command: 'uvx', pin: 'elevenlabs-mcp==0.11.0', why: 'CLAUDE.md "ElevenLabs MCP": pinned, key only as ${ELEVENLABS_API_KEY}; places phone calls and spends credits once on' },
}

// ---------------------------------------------------------------------------
// 6. Platform / CI files. KNOWN with a decision; everything else is UNKNOWN.
const KNOWN_PLATFORM_FILES = {
  'vercel.json': 'turns Vercel deploys OFF for the working branch (commit 2dd7b57e). Implies a Vercel GitHub app is installed outside the repo: REPO-SCAN hygiene-16 says confirm with the owner and uninstall it',
  '.vscode/settings.json': 'editor format-on-save; runs nothing',
  '.vscode/extensions.json': 'recommends expo.vscode-expo-tools (Expo era leftover, REPO-SCAN hygiene-12); runs nothing',
  '.claude/settings.json': 'Claude Code permission allow-list; no hooks (REPO-SCAN hygiene-17: pre-approves publish/ftp/node scripts)',
  '.mcp.json': 'see MCP section',
}
const FORBIDDEN_PLATFORM = {
  '.github': 'CLAUDE.md item 2: no GitHub Actions workflow, ever',
  '.husky': 'git hooks that run commands on commit',
  '.pre-commit-config.yaml': 'pre-commit hooks',
  'lefthook.yml': 'git hooks',
  'netlify.toml': 'Netlify deploy config',
  '_headers': 'Netlify header file (make-package.mjs strips it)',
  '_redirects': 'Netlify redirects',
  'supabase': 'Supabase is gone (CLAUDE.md "Backend: ONE")',
  '.devcontainer': 'runs a container build on open',
  '.idea': 'IDE project files',
  '.cursor': 'agent rules outside CLAUDE.md',
  'now.json': 'old Vercel config',
  'render.yaml': 'Render deploy config',
  'fly.toml': 'Fly deploy config',
  'Procfile': 'Heroku deploy config',
  '.lovable': 'Lovable era (CLAUDE.md item 2)',
}

// ---------------------------------------------------------------------------
// 7. Scripts: images and download+run.
const KNOWN_IMAGES = {
  'node:24-alpine': 'one-shot VPS jobs (vps-deploy.mjs, scans) — CLAUDE.md probing rules',
  'php:8.4-apache': 'the live apache-sporta image (CLAUDE.md item 4)',
  'mcr.microsoft.com/playwright:v1.49.0-noble': 'browser probes on the VPS (CLAUDE.md probing rules)',
  'alpine': 'sporta-apex-redirect idle container (VPS-SCAN-2026-10-31)',
}
const KNOWN_DOWNLOADERS = {
  'vps-deploy.mjs': 'downloads codeload.github.com/hkspower/wain/tar.gz/<sha> inside the deploy job and runs its own copy (GO-LIVE.md "Deploying to the VPS"); apk adds php84 unpinned from Alpine for the file audit',
}
// Scripts may fetch THIS repo's own files at a pushed sha to compare them with the
// live site (CLAUDE.md probing rules); they do not execute what they fetch.
const OWN_REPO = /(raw\.githubusercontent\.com|codeload\.github\.com)\/hkspower\/wain\b/
const KNOWN_NPX = { vite: 'local devDependency', playwright: 'local devDependency' }

// ===========================================================================
const rows = []
const add = (name, kind, where, known, risk, action) => rows.push({ name, kind, where, known: known ? 'KNOWN' : 'UNKNOWN', risk, action })
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')
const read = (p) => readFileSync(p, 'utf8')

function walk(dir, keep = () => true, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p, keep, out) }
    else if (keep(p)) out.push(p)
  }
  return out
}
const TEXT_EXT = new Set(['.js', '.jsx', '.mjs', '.css', '.html', '.php', '.txt', '.xml', '.webmanifest', '.json', '.md', ''])
const isText = (p) => TEXT_EXT.has(extname(p)) || basename(p) === '.htaccess'

// Files that ship: the page, the add-ons, the app source, the three PHP drop-ins.
const SHIPPED = [
  join(WEB, 'index.html'),
  ...walk(join(WEB, 'public'), isText),
  ...walk(join(WEB, 'src'), isText),
  ...walk(join(WEB, 'dropin'), isText),
]

// ---------------------------------------------------------------------------
// 1. PAGE
function pageTags(html, label) {
  const tags = html.match(/<(script|link|iframe|embed|object)\b[^>]*>/gi) || []
  const inline = (html.match(/<script\b(?![^>]*\bsrc=)(?![^>]*type="application\/(ld\+)?json")[^>]*>/gi) || []).length
  const srcs = []
  for (const t of tags) {
    const m = t.match(/\b(?:src|href)="([^"]+)"/i)
    if (m) srcs.push({ tag: t.slice(0, 7), url: m[1] })
  }
  return { tags, inline, srcs, label }
}

const repoHtml = read(join(WEB, 'index.html'))
const repoPage = pageTags(repoHtml, 'sporta-web/index.html')
add('repo index.html', 'page', 'sporta-web/index.html', true, 'info',
  `${repoPage.srcs.length} src/href tags, ${repoPage.inline} inline script(s) (the language/theme boot, hashed into the CSP by csp-hashes.mjs); external: ${[...new Set(repoPage.srcs.map((s) => s.url).filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host))].join(', ') || 'none'}`)

let liveLinked = null
if (LIVE_INDEX) {
  const liveHtml = read(resolve(LIVE_INDEX))
  const live = pageTags(liveHtml, LIVE_INDEX)
  liveLinked = { css: new Set(), js: new Set(), external: [] }
  for (const s of live.srcs) {
    if (/^https?:/.test(s.url)) { liveLinked.external.push(s.url); continue }
    const m = s.url.match(/^\/([a-z0-9-]+)\.(css|js)(\?v=\d+)?$/)
    if (m) liveLinked[m[2]].add(m[1])
  }
  add('live index.html (captured)', 'page', rel(resolve(LIVE_INDEX)), true, 'info',
    `${live.srcs.length} src/href tags, ${live.inline} inline script(s), ${liveLinked.css.size} add-on css, ${liveLinked.js.size} add-on js, external: ${liveLinked.external.join(' ') || 'none'}`)
  for (const u of liveLinked.external) {
    const host = new URL(u).host
    const known = host in KNOWN_HOSTS
    add(u, 'live external resource', 'live index.html', known, known ? 'low' : 'high', known ? KNOWN_HOSTS[host] : 'not documented anywhere: find out who added it; remove or document')
  }
  const docCss = new Set(LIVE_ADDONS_CSS), docJs = new Set(LIVE_ADDONS_JS)
  for (const n of liveLinked.css) if (!docCss.has(n)) add(`${n}.css`, 'add-on linked live', 'live index.html', false, 'medium', 'linked by the live page but not in the CLAUDE.md item 5 list: document it')
  for (const n of liveLinked.js) if (!docJs.has(n)) add(`${n}.js`, 'add-on linked live', 'live index.html', false, 'medium', 'linked by the live page but not in the CLAUDE.md item 5 list: document it')
  for (const n of docCss) if (!liveLinked.css.has(n)) add(`${n}.css`, 'add-on in the list', 'CLAUDE.md item 5', false, 'medium', 'in the documented list but NOT linked by the captured live page: the list is stale or the page changed')
  for (const n of docJs) if (!liveLinked.js.has(n)) add(`${n}.js`, 'add-on in the list', 'CLAUDE.md item 5', false, 'medium', 'in the documented list but NOT linked by the captured live page: the list is stale or the page changed')
}

// public/ add-on files vs the linked list; every other public file must have a loader.
const manifestDoc = existsSync(join(ROOT, 'sporta-live/MANIFEST.md')) ? read(join(ROOT, 'sporta-live/MANIFEST.md')) : ''
const publicFiles = readdirSync(join(WEB, 'public'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
const linkedCss = new Set(liveLinked ? liveLinked.css : LIVE_ADDONS_CSS)
const linkedJs = new Set(liveLinked ? liveLinked.js : LIVE_ADDONS_JS)
for (const f of publicFiles) {
  const ext = extname(f), base = basename(f, ext)
  if (f === 'sw.js') { add(f, 'service worker', 'public/sw.js', true, 'low', PUBLIC_LOADED_BY[f]); continue }
  if (f in PUBLIC_LOADED_BY) { add(f, 'public file', `public/${f}`, true, f === 'go-live.html' ? 'medium' : 'low', PUBLIC_LOADED_BY[f]); continue }
  if (ext === '.css' || ext === '.js') {
    const linked = ext === '.css' ? linkedCss.has(base) : linkedJs.has(base)
    const inManifest = manifestDoc.includes('`' + f + '`') || manifestDoc.includes('`' + base + '.css` / `.js`')
    if (linked) add(f, `add-on ${ext.slice(1)}`, `public/${f}`, true, 'low', `linked by the live index.html${inManifest ? '; repo copy mapped in sporta-live/MANIFEST.md' : '; NOT in sporta-live/MANIFEST.md'}`)
    else add(f, `dead add-on ${ext.slice(1)}`, `public/${f}`, false, 'medium', 'nothing links it, so it never loads: add the tag to the live page or delete the file')
    continue
  }
  if (/\.(png|webp|jpg|jpeg|svg|ico|woff2?)$/.test(f)) { add(f, 'asset', `public/${f}`, true, 'low', 'static image/font'); continue }
  add(f, 'public file', `public/${f}`, false, 'medium', 'no loader known for it: document what serves it or delete it')
}
for (const n of linkedCss) if (!publicFiles.includes(n + '.css')) add(n + '.css', 'add-on with no file', 'public/', false, 'high', 'the live page links it but this repo has no such file: cannot be deployed or reviewed from here')
for (const n of linkedJs) if (!publicFiles.includes(n + '.js')) add(n + '.js', 'add-on with no file', 'public/', false, 'high', 'the live page links it but this repo has no such file: cannot be deployed or reviewed from here')

// Service worker: what it precaches and whether it imports anything.
const sw = read(join(WEB, 'public/sw.js'))
const precache = (sw.match(/const PRECACHE = \[([^\]]*)\]/) || [, ''])[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
const swImports = sw.match(/importScripts\(([^)]*)\)/g) || []
add('sw.js precache', 'service worker', 'public/sw.js', swImports.length === 0, swImports.length ? 'high' : 'low',
  swImports.length ? `importScripts: ${swImports.join(' ')}` : `precaches ${precache.join(' ')} (+ built chunks via scripts/sw-precache.mjs); no importScripts`)

// Manifests.
for (const m of ['site.webmanifest', 'backends.webmanifest']) {
  const j = JSON.parse(read(join(WEB, 'public', m)))
  const ext = JSON.stringify(j).match(/https?:\/\/[^"]+/g) || []
  add(m, 'web manifest', `public/${m}`, ext.length === 0, 'low', ext.length ? `absolute URLs: ${ext.join(' ')}` : `start_url ${j.start_url}, ${j.icons.length} icons, same-origin only`)
}

// ---------------------------------------------------------------------------
// 2. HOSTS in shipped code
const hostHits = new Map()
for (const p of SHIPPED) {
  const txt = read(p)
  for (const m of txt.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|127\.0\.0\.1|localhost)\b/gi)) {
    const h = m[1].toLowerCase()
    if (!hostHits.has(h)) hostHits.set(h, new Set())
    hostHits.get(h).add(rel(p))
  }
}
for (const [h, files] of [...hostHits].sort()) {
  const where = [...files].slice(0, 3).join(', ') + (files.size > 3 ? ` (+${files.size - 3})` : '')
  if (h in KNOWN_HOSTS) add(h, 'outbound host', where, true, 'low', KNOWN_HOSTS[h])
  else if (h in FALLBACK_ONLY_HOSTS) add(h, 'outbound host', where, false, 'medium', `${FALLBACK_ONLY_HOSTS[h]} — but it appears in sporta-web, which self-hosts fonts`)
  else add(h, 'outbound host', where, false, 'high', 'not documented anywhere: find who added it, then remove or document')
}
// The fallback and the Flutter skeleton are reported but do not ship.
for (const [dir, label] of [['sporta-html5', 'no-build fallback'], ['sporta-app', 'Flutter skeleton']]) {
  const hosts = new Set()
  for (const p of walk(join(ROOT, dir), isText)) for (const m of read(p).matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase())
  const odd = [...hosts].filter((h) => !(h in KNOWN_HOSTS) && !(h in FALLBACK_ONLY_HOSTS))
  add(dir, label, `${dir}/`, odd.length === 0, 'low', odd.length ? `undocumented hosts: ${odd.join(' ')}` : `hosts: ${[...hosts].sort().join(' ')} (Google Fonts at runtime: REPO-SCAN webcode-20 / hygiene-9, archive or fix); not live`)
}

// ---------------------------------------------------------------------------
// 3. WIDGETS
for (const [name, re] of WIDGETS) {
  const hits = SHIPPED.filter((p) => re.test(read(p))).map(rel)
  if (hits.length) add(name, 'third-party widget', hits.slice(0, 3).join(', '), false, 'high', 'a widget nobody documented: identify who added it; remove it or record the owner decision')
}
add('analytics / pixel / chat / captcha / share widgets', 'third-party widget', 'index.html, public/, src/, dropin/', true, 'low', `none of ${WIDGETS.length} families found in shipped code`)

// ---------------------------------------------------------------------------
// 4. NPM
const pkg = JSON.parse(read(join(WEB, 'package.json')))
const lock = JSON.parse(read(join(WEB, 'package-lock.json')))
let installScripts = 0, offRegistry = 0, total = 0
for (const [k, v] of Object.entries(lock.packages)) {
  if (!k) continue
  total++
  const name = k.replace(/^.*node_modules\//, '')
  if (v.hasInstallScript) {
    installScripts++
    const known = name in KNOWN_INSTALL_SCRIPTS
    add(`${name}@${v.version}`, 'npm install script', k, known, known ? 'low' : 'high', known ? KNOWN_INSTALL_SCRIPTS[name] : 'runs code at npm install: read its install script, pin or remove')
  }
  if (v.resolved && !/^https:\/\/registry\.npmjs\.org\//.test(v.resolved)) {
    offRegistry++
    add(`${name}@${v.version}`, 'npm off-registry', v.resolved, false, 'high', 'not from registry.npmjs.org: a tarball or git URL nobody vetted')
  }
}
add('package-lock.json', 'npm lock', 'sporta-web/package-lock.json', true, 'info', `lockfileVersion ${lock.lockfileVersion}, ${total} packages, ${installScripts} with install scripts, ${offRegistry} off-registry`)
const codeFiles = [...walk(join(WEB, 'src'), isText), ...walk(join(WEB, 'scripts'), isText), join(WEB, 'vite.config.js'), join(WEB, 'postcss.config.js'), join(WEB, 'tailwind.config.js')].filter(existsSync)
const codeText = codeFiles.map(read).join('\n')
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const esc = dep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const used = new RegExp(`['"]${esc}(/[^'"]*)?['"]`).test(codeText)
  if (used) continue
  const known = dep in KNOWN_UNIMPORTED_DEPS
  add(dep, 'npm dependency not imported', 'sporta-web/package.json', known, known ? 'low' : 'medium', known ? KNOWN_UNIMPORTED_DEPS[dep] : 'nothing imports it: remove it or say what uses it')
}
for (const s of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prebuild', 'postbuild']) {
  if (!pkg.scripts?.[s]) continue
  const known = s in KNOWN_LIFECYCLE
  add(`npm ${s}`, 'npm lifecycle script', `package.json: ${pkg.scripts[s]}`, known, known ? 'low' : 'high', known ? KNOWN_LIFECYCLE[s] : 'runs automatically: document it or remove it')
}

// ---------------------------------------------------------------------------
// 5. MCP
const mcpPath = join(ROOT, '.mcp.json')
if (existsSync(mcpPath)) {
  const mcp = JSON.parse(read(mcpPath))
  for (const [name, s] of Object.entries(mcp.mcpServers || {})) {
    const spec = KNOWN_MCP[name]
    const args = (s.args || []).join(' ')
    const pinned = spec && s.command === spec.command && args.includes(spec.pin)
    const literal = Object.entries(s.env || {}).filter(([, v]) => !/^\$\{[A-Z0-9_]+\}$/.test(String(v)) && !/^\//.test(String(v)))
    const ok = Boolean(spec) && pinned && literal.length === 0
    add(`mcp:${name}`, 'MCP server', `.mcp.json: ${s.command} ${args}`, ok, ok ? 'medium' : 'high',
      ok ? spec.why : (!spec ? 'server not in the allow-list' : !pinned ? `expected pin ${spec.pin}` : `literal env value(s): ${literal.map(([k]) => k).join(', ')} (a committed secret)`))
  }
} else add('.mcp.json', 'MCP', ROOT, true, 'info', 'absent')

// ---------------------------------------------------------------------------
// 6. HOOKS and platform files
for (const [f, why] of Object.entries(KNOWN_PLATFORM_FILES)) {
  if (!existsSync(join(ROOT, f))) continue
  if (f.endsWith('.json') && f.startsWith('.claude')) {
    const j = JSON.parse(read(join(ROOT, f)))
    const hooks = Object.entries(j.hooks || {})
    add(f, 'agent settings', f, hooks.length === 0, hooks.length ? 'high' : 'low', hooks.length ? `hooks that run commands: ${hooks.map(([k, v]) => k + ': ' + JSON.stringify(v)).join('; ')}` : `${why}; enabledPlugins: ${JSON.stringify(j.enabledPlugins || {})}`)
    continue
  }
  if (f === '.mcp.json') continue
  add(f, 'platform file', f, true, f === 'vercel.json' ? 'medium' : 'low', why)
}
for (const [f, why] of Object.entries(FORBIDDEN_PLATFORM)) {
  if (existsSync(join(ROOT, f)) || existsSync(join(WEB, f))) add(f, 'platform file', existsSync(join(ROOT, f)) ? f : `sporta-web/${f}`, false, 'high', `${why}: must not exist`)
}
add('.github/ (root and sporta-web)', 'CI', ROOT, true, 'low', 'absent — CLAUDE.md item 2 holds')
for (const f of walk(ROOT, (p) => /\.(ya?ml)$/.test(p) && !/node_modules|\/dist\//.test(p))) {
  if (basename(f) === 'pubspec.yaml') continue
  add(basename(f), 'yaml config', rel(f), false, 'medium', 'a YAML file in the repo that no rule explains (CI? compose?)')
}

if (!SKIP_HOME) {
  const home = join(homedir(), '.claude')
  for (const f of ['launcher-settings.json', 'settings.json', 'settings.local.json']) {
    const p = join(home, f)
    if (!existsSync(p)) continue
    let j; try { j = JSON.parse(read(p)) } catch { continue }
    for (const [event, groups] of Object.entries(j.hooks || {})) {
      for (const g of groups) for (const h of g.hooks || []) {
        add(`${event} hook`, 'session harness hook (outside the repo)', `~/.claude/${f}: ${h.command}`, true, 'info',
          event === 'Stop' ? 'checks git status and EXITS 2 with a message when there are uncommitted or unpushed changes; it runs no git commit and no git push itself (read 2026-11-03)' : 'prints a notice when the environment setup script failed; runs no program')
      }
    }
  }
  const deny = (() => { try { return JSON.parse(read(join(home, 'launcher-settings.json'))).permissions?.deny?.length } catch { return undefined } })()
  if (deny !== undefined) add('harness permissions', 'session harness (outside the repo)', '~/.claude/launcher-settings.json', true, 'info', `${deny} deny rules protect the hook files and the remote dir; not part of the shop`)
}

// ---------------------------------------------------------------------------
// 7. SCRIPTS: download+run, images, npx
const scriptFiles = walk(join(WEB, 'scripts'), (p) => /\.(mjs|js|sh|py)$/.test(p))
const images = new Map()
const SELF = basename(new URL(import.meta.url).pathname)
for (const p of scriptFiles) {
  const name = basename(p)
  if (name === SELF) continue
  const txt = read(p)
  const host = txt.match(/https?:\/\/(codeload\.github\.com|raw\.githubusercontent\.com|github\.com)\//)
  if (host) {
    // The repository is a literal path in the URL, or the REPO constant vps-deploy.mjs builds the URL from.
    const lit = txt.match(/https?:\/\/(?:codeload\.github\.com|raw\.githubusercontent\.com|github\.com)\/([\w.-]+\/[\w.-]+)/)
    const konst = txt.match(/REPO\s*=\s*['"]([\w.-]+\/[\w.-]+)['"]/)
    const dl = [null, host[1], lit ? lit[1] : konst ? konst[1] : '<dynamic>']
    const own = dl[2] === 'hkspower/wain' && (OWN_REPO.test(txt) || Boolean(konst))
    const runs = /tar xzf[^\n]*\n[^\n]*exec node|exec node sporta-web/.test(txt)
    if (runs) {
      const known = name in KNOWN_DOWNLOADERS
      add(name, 'script downloads and runs code', `sporta-web/scripts/${name}: ${dl[1]}/${dl[2]}`, known, known ? 'medium' : 'high', known ? KNOWN_DOWNLOADERS[name] : 'fetches code from the network and runs it: pin to a commit sha and document')
    } else {
      add(name, 'script fetches repo files', `sporta-web/scripts/${name}: ${dl[1]}/${dl[2]}`, own, own ? 'low' : 'high', own ? 'fetches this repo\'s own files at a pushed sha to compare with the live site; executes nothing fetched (CLAUDE.md probing rules)' : 'fetches from a repository that is not hkspower/wain: find out whose')
    }
  }
  for (const m of txt.matchAll(/image:\s*['"`]([a-z0-9][a-z0-9./_-]*(?::[a-z0-9._-]+)?)['"`]/gi)) {
    const img = m[1]
    if (img.length < 3 || !/[:/]/.test(img)) continue // test fixtures like image: 'a'
    if (!images.has(img)) images.set(img, new Set())
    images.get(img).add(name)
  }
  for (const m of txt.matchAll(/\bnpx\s+(?:-y\s+)?(@?[a-z0-9][\w./-]*)(@[\w.^~-]+)?/g)) {
    const [, tool, ver] = m
    if (ver && /@\d/.test(ver)) continue
    if (tool in KNOWN_NPX) continue
    if (/^(--|-)/.test(tool)) continue
    add(`npx ${tool}`, 'npx without a pin', `sporta-web/scripts/${name}`, false, 'medium', 'npx without @version runs whatever the registry serves today: pin it')
  }
}
for (const [img, files] of [...images].sort()) {
  const known = img in KNOWN_IMAGES
  const tagged = img.includes(':')
  add(img, 'docker image', [...files].slice(0, 3).join(', ') + (files.size > 3 ? ` (+${files.size - 3})` : ''), known && tagged, known && tagged ? 'low' : 'medium', known ? (tagged ? KNOWN_IMAGES[img] : 'no tag: resolves to :latest; pin it') : 'image nobody documented: name why it is used')
}
for (const [img, why] of Object.entries(KNOWN_IMAGES)) if (!images.has(img)) add(img, 'docker image', 'docs only', true, 'info', `${why}; not named in any script`)

// ===========================================================================
// Print
const W = { name: 46, kind: 30, where: 48, known: 7, risk: 6 }
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
console.log(['name', 'kind', 'where', 'known', 'risk', 'action'].map((h) => cut(h, W[h] || 0)).join(' | '))
console.log('-'.repeat(160))
for (const r of rows) console.log([cut(r.name, W.name), cut(r.kind, W.kind), cut(r.where, W.where), cut(r.known, W.known), cut(r.risk, W.risk), r.action].join(' | '))
const unknown = rows.filter((r) => r.known === 'UNKNOWN')
console.log('-'.repeat(160))
console.log(`${rows.length} items, ${rows.length - unknown.length} KNOWN, ${unknown.length} UNKNOWN${LIVE_INDEX ? ' (live index compared)' : ' (documented live add-on list used; pass --live-index <capture> to compare the real page)'}`)
if (unknown.length) {
  console.log('\nUNKNOWN items (each needs an owner decision, then a line in the allow-list of this script):')
  for (const r of unknown) console.log(`  - ${r.name} [${r.kind}] at ${r.where}: ${r.action}`)
  process.exit(1)
}
