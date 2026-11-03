#!/usr/bin/env node
// SEC-HTACCESS SCAN — read-only security scan of the .htaccess layer of the LIVE site.
//
// Runs ON the VPS in a one-shot node:alpine job with /docker/sporta mounted read-only
// (see CLAUDE.md, "Probing the live site"). Two modes, chosen by SEC_MODE:
//
//   files   Lists every .htaccess on disk (size, mode, owner, sha256), downloads the repo
//           copies at SEC_SHA from raw.githubusercontent.com and prints an exact unified
//           diff of each pair, then lists files on disk that are protected ONLY by a deny
//           rule (backups, logs, dotfiles, php outside the entry points). Bytes of
//           .htaccess files are printed; nothing else is.
//   probe   GET/HEAD/OPTIONS only (plus TRACE, to confirm it is refused) against the
//           host's own Traefik on 127.0.0.1 with the real Host header and SNI, exactly as
//           scripts/live-scan.mjs does. About 200 requests, 120 ms apart. It never sends
//           a body, a credential, a cookie or a key, and never prints a config body: a
//           response from a config-like path is reported as status / type / length /
//           "starts with <?php" only.
//
// Writes nothing on the server (the mount is read-only; temp files go to the container's
// own /tmp). Prints no secret value: bodies that look like they carry one are redacted.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import crypto from 'node:crypto'
import tls from 'node:tls'
import { spawnSync } from 'node:child_process'

const MODE = process.env.SEC_MODE || 'probe'
const SHA = process.env.SEC_SHA || 'HEAD'
const HOST = 'www.sporta.com.kw'
const BARE = 'sporta.com.kw'
const SITE = process.env.SEC_SITE || '/sporta/site'
const PRIVATE = process.env.SEC_PRIVATE || '/sporta/private'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const say = (s = '') => console.log(s)
const chunked = (lines, n = 40) => { for (let i = 0; i < lines.length; i += n) say(lines.slice(i, i + n).join('\n')) }

// ---------------------------------------------------------------- files mode
async function files() {
  say(`SEC_FILES start sha=${SHA}`)
  // 1. every .htaccess on disk (site/ and the private media mounts)
  const found = []
  const visit = (dir, depth) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 5 && !/^(backups|node_modules)$/.test(e.name)) visit(abs, depth + 1) }
      else if (e.name === '.htaccess') found.push(abs)
    }
  }
  visit(SITE, 0)
  visit(path.join(PRIVATE, 'media'), 0)
  say('== .htaccess files on disk (path size mode uid:gid sha256)')
  for (const f of found) {
    const st = fs.statSync(f)
    const b = fs.readFileSync(f)
    say(`${f.replace('/sporta/', '')} ${b.length} ${(st.mode & 0o7777).toString(8)} ${st.uid}:${st.gid} ${sha256(b)}`)
  }

  // 2. repo copies at SEC_SHA and the unified diffs
  const repo = {
    '/.htaccess': 'sporta-web/public/.htaccess',
    '/api/.htaccess': 'sporta-web/dropin/php-store/.htaccess',
    '/knet/.htaccess': 'sporta-web/dropin/php-knet/.htaccess',
    '/pay/.htaccess': 'sporta-web/dropin/php-cbk/.htaccess',
  }
  fs.mkdirSync('/tmp/sec', { recursive: true })
  for (const [live, rp] of Object.entries(repo)) {
    const liveFile = path.join(SITE, live)
    say(`\n== DIFF ${live}  (live ${liveFile.replace('/sporta/', '')}  vs repo ${rp} @ ${SHA.slice(0, 8)})`)
    if (!fs.existsSync(liveFile)) { say('LIVE FILE MISSING'); continue }
    const r = await fetch(`https://raw.githubusercontent.com/hkspower/wain/${SHA}/${rp}`)
    if (!r.ok) { say(`repo download failed ${r.status}`); continue }
    const repoBytes = Buffer.from(await r.arrayBuffer())
    const liveBytes = fs.readFileSync(liveFile)
    say(`live ${liveBytes.length} bytes sha256 ${sha256(liveBytes)}`)
    say(`repo ${repoBytes.length} bytes sha256 ${sha256(repoBytes)}`)
    const a = `/tmp/sec/live${live.replaceAll('/', '_')}`
    const b = `/tmp/sec/repo${live.replaceAll('/', '_')}`
    fs.writeFileSync(a, liveBytes)
    fs.writeFileSync(b, repoBytes)
    const d = spawnSync('diff', ['-u', a, b], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    if (d.status === 0) say('IDENTICAL')
    else {
      const lines = (d.stdout || d.stderr || '').split('\n').map((l) => (l.length > 800 ? l.slice(0, 800) + ' …[cut]' : l))
      say(`${lines.length} diff lines`)
      chunked(lines.slice(0, 330))
      if (lines.length > 330) say('… diff truncated')
    }
  }

  // 3. key directive lines of the LIVE root file (the file is public config, not a secret)
  const liveRoot = path.join(SITE, '.htaccess')
  if (fs.existsSync(liveRoot)) {
    say('\n== LIVE root .htaccess: Header / Options / php_ / Require / Expires directives (non-comment)')
    const lines = fs.readFileSync(liveRoot, 'utf8').split('\n')
    const keep = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /^\s*(Header|Options|php_|Require|Expires|FileETag|TraceEnable|ServerSignature|ErrorDocument|DirectorySlash|DirectoryIndex|<FilesMatch|<Files|RedirectMatch|SetEnvIf|AddType|AddHandler|SetHandler|RemoveHandler)/.test(l))
    chunked(keep.map(([n, l]) => `${n}: ${l.trim().slice(0, 900)}`))
  }

  // 4. the media mounts' own .htaccess (PHP must not run there)
  for (const f of found.filter((x) => x.includes('/private/'))) {
    say(`\n== ${f.replace('/sporta/', '')} (full bytes)`)
    say(fs.readFileSync(f, 'utf8'))
  }

  // 5. files on disk that are protected ONLY by a deny rule or by PHP not being executed
  const RISKY = /(\.(bak|old|orig|save|swp|sql|log|jsonl|sh|env|zip|tar|gz|tgz|mjs|ts|md|map|csv|db|sqlite|ini)|~|\.php\.[a-z]+)$/i
  const rows = []
  const walk = (dir, depth) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const abs = path.join(dir, e.name)
      const rel = abs.slice(SITE.length)
      if (e.isDirectory()) {
        if (/^\/(backups)$/.test(rel)) { rows.push(['DIR', rel, '', '', '', 'backups dir inside web root']); continue }
        if (depth < 4 && !/\/(images|cats|hero)$/.test(rel)) walk(abs, depth + 1)
        if (e.name.startsWith('.') && e.name !== '.well-known') rows.push(['DIR', rel, '', '', '', 'dot-directory'])
        continue
      }
      if (e.name === '.htaccess') continue
      const reasons = []
      if (e.name.startsWith('.')) reasons.push('dotfile')
      if (RISKY.test(e.name)) reasons.push('risky-extension')
      if (/\.php$/i.test(e.name) && !/^\/(api|knet|pay)\//.test(rel)) reasons.push('php-outside-entry-folders')
      if (/^(error_log|php_errors|access|debug)/i.test(e.name) || /config|secret|token|credential|passw/i.test(e.name)) reasons.push('name-looks-sensitive')
      if (reasons.length) {
        let st = null
        try { st = fs.lstatSync(abs) } catch { /* ignore */ }
        rows.push(['FILE', rel, st ? st.size : '?', st ? (st.mode & 0o7777).toString(8) : '?', st ? `${st.uid}:${st.gid}` : '?', reasons.join(',')])
      }
    }
  }
  walk(SITE, 0)
  say(`\n== files in the web root that only a deny rule (or non-execution) protects: ${rows.length}`)
  chunked(rows.slice(0, 120).map((r) => r.join(' ')))
  // permissions of the web-root top level
  try {
    const st = fs.statSync(SITE)
    say(`\nsite/ dir mode ${(st.mode & 0o7777).toString(8)} owner ${st.uid}:${st.gid}`)
    const worldW = []
    const ww = (dir, depth) => {
      let ents
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const abs = path.join(dir, e.name)
        let s
        try { s = fs.lstatSync(abs) } catch { continue }
        if (s.mode & 0o002 && !s.isSymbolicLink()) worldW.push(abs.slice(SITE.length))
        if (e.isDirectory() && depth < 4) ww(abs, depth + 1)
      }
    }
    ww(SITE, 0)
    say(`world-writable entries under site/: ${worldW.length} ${worldW.slice(0, 15).join(' ')}`)
    const wr = found.filter((f) => (fs.statSync(f).mode & 0o022) !== 0)
    say(`group/world-writable .htaccess files: ${wr.length} ${wr.join(' ')}`)
  } catch (e) { say(`perm check failed: ${e.message}`) }
  say('SEC_FILES done')
}

// ---------------------------------------------------------------- probe mode
let reqCount = 0
function request(url, { method = 'GET', headers = {}, sni, insecure = false, max = 24000 } = {}) {
  return new Promise((resolve) => {
    reqCount++
    const u = new URL(url)
    const base = process.env.SEC_BASE ? new URL(process.env.SEC_BASE) : null   // tests only: plain HTTP, no TLS
    const secure = !base && u.protocol === 'https:'
    const lib = secure ? https : http
    const started = Date.now()
    const rawPath = url.slice(url.indexOf('/', url.indexOf('//') + 2))
    const req = lib.request({
      host: '127.0.0.1', port: base ? Number(base.port) : secure ? 443 : 80, path: rawPath, method,
      headers: { Host: u.host, 'User-Agent': 'sporta-sec-htaccess-scan', 'Accept-Encoding': 'identity', ...(base ? { 'X-Forwarded-Proto': 'https' } : {}), ...headers },
      timeout: 20000,
      ...(secure ? {
        servername: sni ?? u.hostname,
        rejectUnauthorized: !insecure,
        checkServerIdentity: (_h, cert) => (insecure ? undefined : tls.checkServerIdentity(sni ?? u.hostname, cert)),
      } : {}),
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c) })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, ms: Date.now() - started, size, buf: Buffer.concat(chunks) }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, raw: [], ms: 0, size: 0, buf: Buffer.from(e.message) }))
    req.end()
  })
}
const SENSITIVE_PATH = /(config|secret|token|credential|passw|\.env|htpasswd|\.git|\.sql|backup|\.zip|\.log|error_log|\.bak|\.old|\.save|~|store\.php|cron-auth|setup-admin|preflight|selftest|setup-config|deploy|\.npmrc|\.user\.ini|knet\.php|cbk\.php|crm\.php|returns\.php|customer-auth)/i
const SECRETISH = /(pass|secret|token|api[_-]?key|private|bearer|BEGIN [A-Z ]*KEY|db_|mysql_|resource_key|client_?secret|encrp|authorization)/i
const isShell = (r) => /id="root"/.test(r.buf.toString('utf8', 0, 6000)) && /html/i.test(r.headers['content-type'] || '')

function line(label, r, p) {
  const ct = (r.headers['content-type'] || '').split(';')[0]
  const head = r.buf.toString('latin1', 0, 8)
  let snip = ''
  if (r.status === 0) snip = `ERR ${r.buf.toString()}`
  else if (isShell(r)) snip = '[spa shell]'
  else if (SENSITIVE_PATH.test(p)) snip = `[not printed: sensitive path; starts<?php=${head.startsWith('<?php')} len=${r.size}]`
  else if (/^(text|application\/(json|xml|javascript|manifest))/.test(ct) || /\+(json|xml)/.test(ct)) {
    const t = r.buf.toString('utf8', 0, 200).replace(/\s+/g, ' ').slice(0, 80)
    snip = SECRETISH.test(r.buf.toString('utf8', 0, 4000)) ? '[redacted: secret-like content]' : t
  } else snip = `[${ct || 'no type'}]`
  const cc = r.headers['cache-control'] ? ` cc="${r.headers['cache-control'].slice(0, 60)}"` : ''
  const loc = r.headers.location ? ` ->${r.headers.location.slice(0, 90)}` : ''
  return `${label} ${r.status} ${ct || '-'} ${r.size}b${cc}${loc} :: ${snip}`
}

async function hops(url, extra = {}) {
  const trail = []
  let cur = url
  let last
  for (let n = 0; n < 6; n++) {
    last = await request(cur, { headers: extra, insecure: true })
    await sleep(120)
    trail.push(last.status)
    if (![301, 302, 307, 308].includes(last.status) || !last.headers.location) break
    cur = new URL(last.headers.location, cur).toString()
  }
  return { n: trail.length - 1, trail: trail.join('>'), final: cur.slice(0, 80), lastLoc: last.headers.location || '' }
}

async function probe() {
  say(`SEC_PROBE start`)
  const home = await request(`https://${HOST}/`)
  if (home.status === 0) { say(`UNREACHABLE ${home.buf.toString()}`); return }
  const homeHtml = home.buf.toString('utf8')
  say(`home ${home.status} ${home.size}b server=${home.headers.server || '-'} x-powered-by=${home.headers['x-powered-by'] || '-'} via=${home.headers.via || '-'} etag=${home.headers.etag || '-'} cc=${home.headers['cache-control'] || '-'}`)

  // 1. response headers on key URLs (full header names list + the security ones)
  say('\n== HEADERS')
  const HDR = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'x-permitted-cross-domain-policies', 'cache-control', 'set-cookie', 'access-control-allow-origin', 'x-robots-tag', 'server', 'x-powered-by', 'etag', 'content-type', 'content-encoding', 'vary']
  const hdrTargets = ['/', '/shop', '/nonexistent-zz1', '/robots.txt', '/config.js', '/sw.js', '/api/api.php?r=zzunknown', '/api/api.php', '/api/admin.php', '/knet/pay.php', '/pay/pay.php', '/api/config.php', '/backends', '/images/products/']
  for (const p of hdrTargets) {
    const r = await request(`https://${HOST}${p}`)
    await sleep(120)
    say(`-- ${p} -> ${r.status} (${r.size}b)`)
    const out = []
    for (const h of HDR) {
      let v = r.headers[h]
      if (v === undefined) continue
      if (Array.isArray(v)) v = v.join(' || ')
      if (h === 'set-cookie') v = String(v).replace(/=[^;]*/g, '=<v>')
      out.push(`${h}: ${String(v).slice(0, 700)}`)
    }
    const missing = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cache-control'].filter((h) => r.headers[h] === undefined)
    say(out.join('\n'))
    say(`MISSING: ${missing.join(',') || 'none'}`)
  }

  // 2. the path battery
  const A = []
  const add = (group, list) => list.forEach((p) => A.push([group, p]))
  add('dot', ['/.env', '/.git/config', '/.git/HEAD', '/.git/', '/.gitignore', '/.htaccess', '/.htpasswd', '/.DS_Store', '/.well-known/security.txt', '/.well-known/', '/.well-known/acme-challenge/zz', '/.well-known/hostinger-challenge/zz', '/.cbk_token.json', '/.user.ini', '/.npmrc', '/.deploy-manifest.json', '/._index.html', '/api/.htaccess', '/knet/.htaccess', '/pay/.htaccess'])
  add('cfg', ['/api/config.php', '/api/config.php.bak', '/api/config.php~', '/api/config.php.save', '/api/config.php.old', '/api/config.phps', '/api/config-path.php', '/api/config.example.php', '/api/seo-config.php', '/api/seo-runtime.php', '/api/store.php', '/api/cron-auth.php', '/api/birthday-lib.php', '/api/crm.php', '/api/returns.php', '/api/customer-auth.php', '/api/preflight.php', '/api/setup-admin.php', '/knet/config.php', '/knet/config.example.php', '/knet/knet.php', '/knet/selftest.php', '/knet/setup-config.php', '/pay/config.php', '/pay/config.example.php', '/pay/cbk.php', '/pay/.cbk_token.json', '/go-live.html', '/selftest.php', '/setup-config.php', '/sporta-deploy.php', '/sporta-deploy-config.php', '/adminer.php', '/phpmyadmin/'])
  add('entry', ['/api/admin.php', '/api/admin-google.php', '/api/profiles.php', '/api/customer.php', '/api/support.php', '/api/assistant.php', '/api/birthday.php', '/api/seo-page.php', '/api/sitemap-index.php', '/api/sitemap-products.php', '/api/index.php', '/api/cron-stock.php', '/api/cron-fulfilment.php', '/api/cron-voice.php', '/api/cron-birthday.php', '/api/cron-whatsapp.php', '/admin', '/admin.php', '/panel.php', '/index.php'])
  add('bak', ['/backup.zip', '/backups/', '/backup/', '/site.zip', '/sporta-dist.zip', '/SPORTA-GO-LIVE.zip', '/SPORTA-BACKEND.zip', '/public_html.zip', '/www.zip', '/db.sql', '/dump.sql', '/schema.mysql.sql', '/api/schema.mysql.sql', '/api/install.mysql.sql', '/api/seed.mysql.sql', '/api/inventory.mysql.sql', '/knet-payments.log', '/cbk-payments.log', '/knet/knet-payments.log', '/pay/cbk-payments.log', '/error_log', '/api/error_log', '/knet/error_log', '/php_errors.log', '/api/php_errors.log', '/access.log', '/debug.log'])
  add('vcs', ['/package.json', '/package-lock.json', '/node_modules/', '/composer.json', '/composer.lock', '/vendor/', '/vendor/autoload.php', '/sporta-web/', '/dropin/', '/scripts/', '/README.md', '/CLAUDE.md', '/SERVER-LAYOUT.md', '/Dockerfile', '/docker-compose.yml', '/vite.config.js', '/deploy.config.json', '/.env.deploy', '/src/', '/src/main.jsx', '/knet/README.md', '/pay/README.md'])
  add('dir', ['/images/', '/assets/', '/api/', '/knet/', '/pay/', '/cats/', '/icons/', '/fonts/', '/hero/', '/api', '/backends/', '/backends'])
  add('trick', ['/API/config.php', '/Api/api.php', '/api/CONFIG.PHP', '/api/config.php%00', '/api/config.php%2e', '/api/config.php%20', '/api/config.php.', '/api/config.php/', '/api/config.php/x', '/api//config.php', '/api/;/config.php', '/api/..;/', '/api/%2e%2e/api/config.php', '/api/%252e%252e/api/config.php', '/api/./config.php', '/api/x/../config.php', '/%2e%65nv', '/%2e/%2e/api/config.php', '/api/config%2ephp', '/api/config.php%0a', '/api/config.php%23', '/api/config.php%3f', '/api%2fconfig.php', '/api/%63onfig.php', '/..%2f..%2fetc/passwd', '/.%2e/etc/passwd', '/api/api.php/../config.php', '/api/store.php/x.css', '/api/store.php%2f', '/api/api.php/x'])
  add('mv', ['/config', '/robots', '/sitemap', '/logo', '/api/config', '/api/store', '/knet/config', '/pay/config', '/api/admin'])
  add('route', ['/account', '/support', '/cart', '/checkout', '/payment/result', '/invoice/ABC123', '/product/zz-none', '/track', '/women', '/men', '/privacy-policy', '/shipping', '/index.html', '/image/cache/catalog/x.jpg', '/zz-not-a-route', '/shop/', '/shop/x'])
  // source maps next to the real bundle files
  const assets = [...new Set([...homeHtml.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))[^"]*"/g)].map((m) => m[1]))].slice(0, 8)
  for (const a of assets) A.push(['map', `${a}.map`])
  say(`\n== PATHS (${A.length}) — format: group path status type size [cc] [->location] :: first 80 bytes (never for sensitive paths)`)
  let buf = []
  const flags = []
  for (const [g, p] of A) {
    const r = await request(`https://${HOST}${p}`, { insecure: true })
    await sleep(120)
    const shell = isShell(r)
    let flag = ''
    const sensitiveGroup = ['dot', 'cfg', 'bak', 'vcs', 'trick', 'map'].includes(g)
    if (sensitiveGroup && r.status === 200 && !shell) flag = ' !!200'
    else if (sensitiveGroup && r.status === 200 && shell && !['/.well-known/', '/.well-known/security.txt'].includes(p)) flag = ' !soft200-shell'
    if (r.status >= 500) flag += ' !5xx'
    if (g === 'dir' && r.status === 200 && !shell && /<title>Index of|Parent Directory/i.test(r.buf.toString('utf8', 0, 2000))) flag += ' !!LISTING'
    buf.push(`${g} ${p} ${line('', r, p).trim()}${flag}`)
    if (flag) flags.push(`${p} ${r.status}${flag}`)
    if (buf.length >= 20) { say(buf.join('\n')); buf = [] }
  }
  if (buf.length) say(buf.join('\n'))
  say(`FLAGGED: ${flags.length ? flags.join(' | ') : 'none'}`)

  // 3. methods and CORS
  say('\n== METHODS / CORS')
  for (const [m, p, h] of [['OPTIONS', '/', {}], ['OPTIONS', '/api/api.php', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }], ['OPTIONS', '/api/admin.php', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-sporta-admin' }], ['TRACE', '/', {}], ['TRACE', '/api/api.php', {}], ['GET', '/api/api.php', { Origin: 'https://evil.example' }], ['GET', '/api/admin.php', { Origin: 'https://evil.example' }], ['HEAD', '/', {}], ['HEAD', '/shop', {}], ['HEAD', '/api/config.php', {}], ['HEAD', '/robots.txt', {}]]) {
    const r = await request(`https://${HOST}${p}`, { method: m, headers: h })
    await sleep(120)
    const hs = ['allow', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-methods', 'access-control-allow-headers', 'content-type', 'content-length', 'cache-control', 'etag', 'content-security-policy', 'x-content-type-options'].filter((k) => r.headers[k] !== undefined).map((k) => `${k}=${String(r.headers[k]).slice(0, k === 'content-security-policy' ? 40 : 80)}`)
    say(`${m} ${p}${h.Origin ? ' [Origin evil]' : ''} -> ${r.status} ${hs.join(' ')} ${m === 'TRACE' && r.status === 200 ? '!!TRACE-ECHO ' + r.buf.toString('utf8', 0, 60).replace(/\s+/g, ' ') : ''}`)
  }
  // ETag shape: MTime+Size = two hex parts; Apache default with inode = three
  for (const p of ['/robots.txt', '/logo.png']) {
    const r = await request(`https://${HOST}${p}`)
    await sleep(120)
    say(`ETAG ${p} ${r.headers.etag || '-'} (${(r.headers.etag || '').replace(/"|W\//g, '').split('-').length} parts)`)
  }

  // 4. Host / SNI variants (SNI stays www so Traefik routes to the same entrypoint; only Host changes)
  say('\n== HOST HEADER VARIANTS (GET /)')
  const base = await request(`https://${HOST}/`)
  for (const hv of [BARE, '187.7.78.123', 'localhost', 'srv2058651.hstgr.cloud', 'wain', 'mawsoool', 'almuhallab', `${HOST}.evil.example`, `${HOST}:8080`, 'WWW.SPORTA.COM.KW']) {
    const r = await request(`https://${HOST}/`, { headers: { Host: hv }, insecure: true })
    await sleep(120)
    const title = (r.buf.toString('utf8', 0, 4000).match(/<title>([^<]{0,60})/i) || [])[1] || ''
    say(`Host: ${hv} -> ${r.status} ${r.size}b same-as-home=${r.size === base.size && r.status === base.status} loc=${(r.headers.location || '-').slice(0, 80)} title="${title}" server=${r.headers.server || '-'}`)
  }
  for (const [k, v] of [['X-Forwarded-Host', 'evil.example'], ['X-Forwarded-Proto', 'http'], ['X-Forwarded-For', '203.0.113.9'], ['X-Original-URL', '/api/config.php'], ['X-Rewrite-URL', '/api/config.php']]) {
    const r = await request(`https://${HOST}/shop`, { headers: { [k]: v } })
    await sleep(120)
    say(`${k}: ${v} on /shop -> ${r.status} loc=${(r.headers.location || '-').slice(0, 80)} ${r.size}b`)
  }

  // 5. redirect hops
  say('\n== REDIRECT HOPS (status trail)')
  for (const u of [`http://${BARE}/shop`, `http://${HOST}/shop`, `https://${BARE}/shop`, `http://187.7.78.123/shop`, `https://${HOST}/index.html`, `https://${HOST}/index.php`, `https://${HOST}/panel.php`, `http://${BARE}/women`, `https://${HOST}/backends/`, `http://${BARE}/%0d%0aX-Inject:1`, `http://${BARE}//evil.example/`, `http://${BARE}/%5Cevil.example`, `http://${BARE}/api/config.php`]) {
    const h = await hops(u)
    say(`${u} -> ${h.n} hop(s) ${h.trail} final=${h.final}${/[\r\n]|%0d|%0a/i.test(h.lastLoc) ? ' loc-has-encoded-crlf(ok-if-%0d%0a)' : ''}`)
  }
  // raw Location of the CRLF probe, to confirm it is escaped, not split
  const crlf = await request(`http://${BARE}/%0d%0aX-Inject:1`, { insecure: true })
  say(`CRLF probe raw headers: ${crlf.raw.filter((_, i) => i % 2 === 0).join(',').slice(0, 300)} injected=${crlf.headers['x-inject'] !== undefined}`)

  // 6. plain-HTTP port 80: what does a non-TLS visitor get
  const p80 = await request(`http://${HOST}/api/api.php?r=zzunknown`, { insecure: true })
  say(`\nhttp://www /api -> ${p80.status} loc=${p80.headers.location || '-'}`)

  // 7. files on disk that exist only behind a deny rule: do they answer?
  say('\n== ON-DISK RISKY FILES: HTTP status')
  const RISKY = /(\.(bak|old|orig|save|swp|sql|log|jsonl|sh|env|zip|tar|gz|tgz|mjs|ts|md|map|csv|db|sqlite|ini)|~)$/i
  const risky = []
  const walk = (dir, depth) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const abs = path.join(dir, e.name)
      const rel = abs.slice(SITE.length)
      if (e.isDirectory()) { if (depth < 4 && !/\/(images|cats|hero|backups)$/.test(rel)) walk(abs, depth + 1) }
      else if (e.name !== '.htaccess' && (e.name.startsWith('.') || RISKY.test(e.name) || (/\.php$/i.test(e.name) && !/^\/(api|knet|pay)\//.test(rel)) || /^(error_log|php_errors)/i.test(e.name))) risky.push(rel)
    }
  }
  walk(SITE, 0)
  say(`${risky.length} candidate file(s) on disk`)
  const rr = []
  for (const rel of risky.slice(0, 20)) {
    const r = await request(`https://${HOST}${rel.split('/').map(encodeURIComponent).join('/')}`, { insecure: true })
    await sleep(120)
    rr.push(`${rel} -> ${r.status}${r.status === 200 && !isShell(r) ? ' !!200' : ''}`)
  }
  chunked(rr, 25)
  say(`\nSEC_PROBE done requests=${reqCount}`)
}

if (MODE === 'files') await files()
else await probe()
