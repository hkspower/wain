#!/usr/bin/env node
// ADMIN SCAN — /backends on www.sporta.com.kw, checked from the VPS without
// signing in.
//
//   node scripts/vps-deploy.mjs compose --scan backends
//
// Four questions:
//   1. does the admin LOAD — the page, and every script and stylesheet it can
//      reach, followed from index.html through every lazy chunk on disk (a
//      missing chunk is a screen that white-screens only when opened);
//   2. is it SHUT to strangers — every admin.php route answers a signed-out
//      request with 401 JSON, the sign-in steps refuse a request without the
//      X-Sporta-Admin header, nothing leaks a trace;
//   3. is it HIDDEN — noindex, no-store on the API, robots.txt, no /admin or
//      /backends/ alias;
//   4. do the screens and the server AGREE — every ?r= route the live admin
//      bundle builds is one the live PHP serves, and which admin.php routes no
//      screen uses (a feature the owner cannot reach).
//
// It NEVER TRIES TO SIGN IN. Five failures lock an account for fifteen
// minutes, and the throttle's client bucket is keyed on the address PHP sees —
// behind Traefik that can be shared — so a scan must not spend attempts. The
// only POSTs carry no X-Sporta-Admin header, which every sign-in step refuses
// before it reads the body or counts anything. Every other request is a GET,
// and every route that changes something is POST-only.
//
// Test hooks: SPORTA_SCAN_BASE / SPORTA_SCAN_ROOT, as for the other scans.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const HOST = 'www.sporta.com.kw'
const BASE = process.env.SPORTA_SCAN_BASE ?? ''
const ROOT = process.env.SPORTA_SCAN_ROOT ?? '/sporta/site'
const HERE = path.dirname(fileURLToPath(import.meta.url))

let bad = 0, warn = 0
const ok = (s) => console.log(`ok   ${s}`)
const w = (s) => { warn++; console.log(`WARN ${s}`) }
const b = (s) => { bad++; console.log(`BAD  ${s}`) }
const head = (s) => console.log(`\n== ${s}`)

function request(p, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const base = BASE ? new URL(BASE) : null
    const lib = base ? http : https
    const h = { Host: HOST, 'User-Agent': 'sporta-admin-scan', 'Accept-Encoding': 'identity', ...headers }
    if (body !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(body) }
    const req = lib.request({
      host: base ? base.hostname : '127.0.0.1', port: base ? Number(base.port) : 443, path: p, method, headers: h, timeout: 15000,
      ...(base ? {} : { servername: HOST, checkServerIdentity: (_h, c) => tls.checkServerIdentity(HOST, c) }),
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }))
    if (body !== null) req.write(body)
    req.end()
  })
}
const json = (t) => { try { return JSON.parse(t) } catch { return undefined } }
const TRACE = /SQLSTATE|Fatal error|Stack trace|Warning:|Notice:|<br \/>|\/var\/www|\/run\/sporta|PDOException/

// ==================================================================== 1
head('1. The admin loads')
const page = await request('/backends')
if (page.status !== 200 || !/<script/i.test(page.text)) b(`/backends -> ${page.status}`)
else ok(`/backends -> 200 (${page.text.length} B of HTML)`)
const indexHtml = fs.existsSync(path.join(ROOT, 'index.html')) ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : ''
// /backends may be served through api/seo-page.php, which puts the page's own
// title and meta into index.html — so the HTML differs by design. What must
// match is the app it starts: the entry script.
const entryOf = (h) => /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/.exec(h)?.[1] ?? /src="(\/assets\/index-[^"]+\.js)"/.exec(h)?.[1] ?? ''
if (page.status === 200 && indexHtml && page.text !== indexHtml) {
  const served = entryOf(page.text), disk = entryOf(indexHtml)
  served && served === disk ? ok(`/backends starts the same app as index.html (${served}), with its own meta`)
    : b(`/backends starts ${served || 'no script'}, index.html starts ${disk || 'no script'} — the admin page is a different app`)
}

// Every asset reachable from index.html, through every chunk import, on disk.
const ASSETS = path.join(ROOT, 'assets')
const seen = new Set(), missing = new Set()
const refsIn = (text) => [...new Set([
  ...[...text.matchAll(/\/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1]),
  ...[...text.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)].map((m) => m[1]),
  ...[...text.matchAll(/["'`]assets\/([\w.-]+\.(?:js|css))["'`]/g)].map((m) => m[1]),
])]
const queue = [...new Set([...refsIn(indexHtml), ...refsIn(page.text ?? '')])]
while (queue.length && seen.size < 600) {
  const f = queue.shift()
  if (seen.has(f)) continue
  seen.add(f)
  const p = path.join(ASSETS, f)
  if (!fs.existsSync(p)) { missing.add(f); continue }
  if (f.endsWith('.js')) for (const r of refsIn(fs.readFileSync(p, 'utf8'))) if (!seen.has(r)) queue.push(r)
}
const reachable = [...seen].filter((f) => !missing.has(f))
missing.size ? b(`${missing.size} referenced file(s) missing from assets/: ${[...missing].slice(0, 6).join(', ')} — the screens that load them break`)
  : ok(`${reachable.length} scripts and stylesheets reachable from index.html, all on disk`)
const adminChunks = reachable.filter((f) => /^(AdminApp|Admin|admin)[\w-]*\.js$/.test(f))
if (!adminChunks.length) b('no admin chunk (AdminApp-*.js) is reachable from index.html')
for (const f of adminChunks.slice(0, 4)) {
  const r = await request(`/assets/${f}`)
  const cc = String(r.headers['cache-control'] ?? '')
  r.status === 200 ? ok(`/assets/${f} -> 200 (${Math.round(r.text.length / 1024)} kB${/immutable/.test(cc) ? ', immutable' : ''})`)
    : b(`/assets/${f} -> ${r.status}`)
}
for (const f of ['/backends.webmanifest', '/backends-icon.svg', '/backends-offline.html', '/backends-offline.css']) {
  if (!fs.existsSync(path.join(ROOT, f))) continue
  const r = await request(f)
  r.status === 200 ? ok(`${f} -> 200`) : b(`${f} -> ${r.status}`)
}

// ==================================================================== 2
head('2. Shut to strangers')
const apiDir = path.join(ROOT, 'api')
const adminPhp = fs.existsSync(path.join(apiDir, 'admin.php')) ? fs.readFileSync(path.join(apiDir, 'admin.php'), 'utf8') : ''
if (!adminPhp) b('api/admin.php missing — there is no admin API')
const wallAt = adminPhp.indexOf('store_require_admin()')
const routes = [...new Set([...adminPhp.matchAll(/\$r === '([a-z_]+)'/g)].map((m) => m[1]))]
const open = new Set(adminPhp.slice(0, Math.max(0, wallAt)).match(/\$r === '([a-z_]+)'/g)?.map((s) => s.slice(8, -1)) ?? [])
ok(`admin.php serves ${routes.length} routes; ${open.size} sit before the sign-in wall (${[...open].join(', ')})`)
{
  const leaks = [], wrong = []
  for (const r of routes.filter((x) => !open.has(x))) {
    const res = await request(`/api/admin.php?r=${r}`, { headers: { 'X-Sporta-Admin': '1' } })
    const j = json(res.text)
    if (TRACE.test(res.text)) leaks.push(r)
    if (!(res.status === 401 && j && j.error === 'not_signed_in')) wrong.push(`${r} ${res.status}`)
  }
  wrong.length ? b(`signed out, ${wrong.length} route(s) do not answer 401 not_signed_in: ${wrong.slice(0, 8).join(', ')}`)
    : ok(`signed out, all ${routes.length - open.size} protected routes answer 401 not_signed_in`)
  leaks.length ? b(`error trace or server path in: ${leaks.join(', ')}`) : ok('no trace or server path in any of them')
}
{
  const me = await request('/api/admin.php?r=me', { headers: { 'X-Sporta-Admin': '1' } })
  me.status === 200 && me.text.trim() === 'null' ? ok('?r=me signed out -> 200 null')
    : me.status === 409 ? b('?r=me -> 409 no_admin_account — there is no admin account at all')
      : b(`?r=me signed out -> ${me.status} ${me.text.slice(0, 60)}`)
  const cookie = String(me.headers['set-cookie'] ?? '')
  if (cookie) {
    const flags = ['secure', 'httponly', 'samesite=strict'].filter((f) => !cookie.toLowerCase().includes(f))
    flags.length && !BASE ? b(`admin session cookie lacks ${flags.join(', ')}`) : ok('admin session cookie: Secure, HttpOnly, SameSite=Strict')
  }
  const ct = String(me.headers['content-type'] ?? '')
  ;/^application\/json/.test(ct) ? ok(`admin API Content-Type ${ct}`) : b(`admin API Content-Type "${ct}"`)
}
// CSRF: each sign-in step refuses a request without the header, before it
// reads the body — so this counts no attempt and sends no email.
for (const r of ['login', 'login_code', 'logout', 'forgot_password', 'reset_password', 'change_initial_password'].filter((x) => open.has(x))) {
  const res = await request(`/api/admin.php?r=${r}`, { method: 'POST', body: '{}' })
  ;[400, 403].includes(res.status) && json(res.text)?.error ? ok(`POST ${r} without X-Sporta-Admin -> ${res.status} ${json(res.text).error}`)
    : b(`POST ${r} without X-Sporta-Admin -> ${res.status} — the CSRF header is not enforced`)
}

// ==================================================================== 3
head('3. Hidden')
if (BASE) w('header checks skipped under SPORTA_SCAN_BASE (php -S reads no .htaccess)')
else {
  const api = await request('/api/admin.php?r=me', { headers: { 'X-Sporta-Admin': '1' } })
  ;/no-store/.test(String(api.headers['cache-control'] ?? '')) ? ok('admin API no-store') : b(`admin API Cache-Control "${api.headers['cache-control'] ?? ''}"`)
  ;/no-store|no-cache/.test(String(page.headers['cache-control'] ?? '')) ? ok(`/backends Cache-Control ${page.headers['cache-control']}`) : w(`/backends Cache-Control "${page.headers['cache-control'] ?? ''}"`)
  const robotsTag = String(page.headers['x-robots-tag'] ?? '')
  const metaNoindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(page.text)
  robotsTag.includes('noindex') || metaNoindex ? ok(`/backends is noindex (${robotsTag ? 'X-Robots-Tag' : 'meta robots'})`)
    : w('/backends has no noindex — only robots.txt keeps it out of search results')
  ;/frame-ancestors|SAMEORIGIN|DENY/i.test(`${page.headers['content-security-policy'] ?? ''} ${page.headers['x-frame-options'] ?? ''}`)
    ? ok('/backends cannot be framed by another site') : b('/backends can be framed (clickjacking)')
}
{
  const robots = await request('/robots.txt')
  ;/^Disallow:\s*\/backends/im.test(robots.text) ? ok('robots.txt disallows /backends') : w('robots.txt does not disallow /backends')
  // The aliases are Apache's rewrite rules to judge; php -S in the tests has none.
  for (const p of BASE ? [] : ['/admin', '/admin/', '/backends/', '/wp-admin', '/administrator']) {
    const r = await request(p)
    ;[403, 404, 410].includes(r.status) || (r.status >= 300 && r.status < 400 && !/backends/.test(String(r.headers.location ?? '')))
      ? ok(`${p} -> ${r.status}`) : b(`${p} -> ${r.status}${r.headers.location ? ` ${r.headers.location}` : ''} — an alias for the admin`)
  }
}

// ==================================================================== 4
head('4. The screens and the server agree')
{
  // The compiled screens plus the add-on scripts the page loads from the web
  // root (sporta-*.js): some admin routes are only called from an add-on.
  const addOns = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((f) => /^sporta-.*\.js$/.test(f)) : []
  const bundle = [
    ...reachable.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ASSETS, f), 'utf8')),
    ...addOns.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')),
  ].join('\n')
  const served = new Set()
  for (const f of fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter((x) => x.endsWith('.php')) : []) {
    for (const m of fs.readFileSync(path.join(apiDir, f), 'utf8').matchAll(/\$r\s*===\s*'([a-z_]+)'|case '([a-z_]+)'/g)) served.add(m[1] ?? m[2])
  }
  // Routes the screens build into URLs (`?r=name`, `&r=name`, `r=${…}` aside).
  // Only inside a string literal, and followed by the end of the name: a bare
  // [?&]r= also matches minified code such as `a?r=null:b`.
  const called = [...new Set([...bundle.matchAll(/["'`][^"'`\n]{0,160}?[?&]r=([a-z_]{2,40})(?=["'`&#])/g)].map((m) => m[1]))]
  const unknown = called.filter((r) => !served.has(r))
  unknown.length ? b(`the live bundle calls ${unknown.length} route(s) no PHP file serves: ${unknown.join(', ')}`)
    : ok(`all ${called.length} ?r= routes written into the bundle are served by the live PHP`)
  // admin.php routes no screen mentions: a feature with no way in.
  const quoted = (r) => new RegExp(`["'\`]${r}(["'\`&]|$)`).test(bundle) || bundle.includes(`r=${r}`)
  const unused = routes.filter((r) => !quoted(r))
  const used = routes.length - unused.length
  // A route the LIVE screens never call may still be this repo's admin's
  // (src/admin, shipped with the scan): not dead code, a screen the live
  // build lacks. Only a route neither admin calls is worth a warning.
  const repoSrc = path.join(HERE, '..', 'src')
  const repoText = fs.existsSync(repoSrc)
    ? fs.readdirSync(repoSrc, { recursive: true }).filter((f) => /\.(jsx?|tsx?)$/.test(f)).map((f) => fs.readFileSync(path.join(repoSrc, f), 'utf8')).join('\n')
    : ''
  const repoOnly = unused.filter((r) => new RegExp(`["'\`]${r}["'\`&]`).test(repoText))
  const dead = unused.filter((r) => !repoOnly.includes(r))
  ok(`${used} of ${routes.length} admin routes are called by the live screens`)
  if (repoOnly.length) ok(`  ${repoOnly.length} more are this repo's admin's only — the live build has no screen for: ${repoOnly.join(', ')}`)
  dead.length ? w(`no admin calls ${dead.length} route(s): ${dead.slice(0, 12).join(', ')}${dead.length > 12 ? ' …' : ''}`)
    : ok('no admin route is dead code')
  // Sign-in steps the server can ask for, and whether the screens answer them.
  for (const [step, word] of [['MFA code', 'need_code'], ['forced password change', 'need_password_change']]) {
    if (!adminPhp.includes(word)) continue
    bundle.includes(word) ? ok(`the sign-in screen handles the ${step} step (${word})`)
      : b(`the server can ask for a ${step} (${word}) and no screen handles it — that account cannot sign in`)
  }
}

console.log(`\nSCAN_DONE bad=${bad} warn=${warn}`)
