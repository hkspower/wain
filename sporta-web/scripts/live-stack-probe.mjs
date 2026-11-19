// READ-ONLY probe of how the live stack is laid out and how it caches (2026-11-19, owner: "Load Balancing / caching").
//
//   SECTION=host|procs|compose|http node live-stack-probe.mjs      (all four when SECTION is unset)
//
// Run on the VPS in node:24-alpine with `network_mode: host` and `pid: host`, /docker/apache and /docker/traefik mounted READ-ONLY at /infra/apache and /infra/traefik
// (see ops/LOAD-CACHE-PROBE.md for the compose). It reads /proc, two compose files and makes GET requests to https://www.sporta.com.kw. It writes nothing, signs in to
// nothing, sends no body and prints NO secret: every environment value, label or argument whose name looks like a credential is printed as ***, and only the
// sporta service of the apache compose file is shown (the other services belong to other sites).
//   host     load average, memory, uptime, CPU pressure
//   procs    CPU and memory per container over a 5 s window (which container is busy), by cgroup id
//   compose  the sporta service (image, restart, healthcheck, limits, volumes, Traefik labels) and Traefik's own command line
//   http     for each kind of URL: status, cache headers, encoding, size, time to first byte (median / p90 of 7 requests after a warm-up) and the answer to a conditional request
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const SECTIONS = (process.env.SECTION || 'host,procs,compose,http').split(',')
const rd = (p) => { try { return readFileSync(p, 'utf8') } catch (e) { return '' } }
const out = (s = '') => console.log(s)
const MASK = /(pass|secret|token|key|users|auth|email|credential)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NCPU = Math.max(1, (rd('/proc/cpuinfo').match(/^processor/gm) || []).length)

if (SECTIONS.includes('host')) {
  out('== HOST')
  const mem = {}; for (const l of rd('/proc/meminfo').split('\n')) { const m = /^(\w+):\s+(\d+) kB/.exec(l); if (m) mem[m[1]] = +m[2] }
  out('cpus ' + NCPU + ' | load ' + rd('/proc/loadavg').trim() + ' | up ' + Math.round(parseFloat(rd('/proc/uptime')) / 60) + ' min')
  out('mem total ' + Math.round(mem.MemTotal / 1024) + ' MB, available ' + Math.round(mem.MemAvailable / 1024) + ' MB, buffers+cache ' + Math.round(((mem.Buffers || 0) + (mem.Cached || 0)) / 1024) + ' MB, swap used ' + Math.round(((mem.SwapTotal || 0) - (mem.SwapFree || 0)) / 1024) + ' MB of ' + Math.round((mem.SwapTotal || 0) / 1024))
  for (const f of ['cpu', 'memory', 'io']) { const t = rd('/proc/pressure/' + f).trim().split('\n')[0]; if (t) out('pressure ' + f + ': ' + t) }
}

if (SECTIONS.includes('procs')) {
  out('== PROCESSES over 5 s (share of the whole machine; container = first 12 characters of its id)')
  const snap = () => {
    const m = new Map()
    for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      const stat = rd('/proc/' + pid + '/stat'); const i = stat.lastIndexOf(')'); if (i < 0) continue
      const f = stat.slice(i + 2).split(' ')
      const comm = stat.slice(stat.indexOf('(') + 1, i)
      const cg = /docker[-/]([0-9a-f]{12})/.exec(rd('/proc/' + pid + '/cgroup'))
      const rss = (parseInt((rd('/proc/' + pid + '/statm').split(' ')[1]) || '0', 10) || 0) * 4096
      m.set(pid, { comm, cid: cg ? cg[1] : 'host', ticks: (parseInt(f[11], 10) || 0) + (parseInt(f[12], 10) || 0), rss })
    }
    return m
  }
  const a = snap(); await sleep(5000); const b = snap()
  const per = new Map()
  for (const [pid, p] of b) {
    const q = a.get(pid); const d = q ? Math.max(0, p.ticks - q.ticks) : 0
    const e = per.get(p.cid) || { n: 0, cpu: 0, rss: 0, comms: {} }
    e.n++; e.cpu += d; e.rss += p.rss; e.comms[p.comm] = (e.comms[p.comm] || 0) + 1; per.set(p.cid, e)
  }
  const rows = [...per.entries()].map(([cid, e]) => ({ cid, n: e.n, cpu: e.cpu / (5 * 100 * NCPU) * 100, rss: e.rss / 1048576, top: Object.entries(e.comms).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, k]) => c + 'x' + k).join(' ') }))
  rows.sort((x, y) => y.cpu - x.cpu || y.rss - x.rss)
  for (const r of rows.slice(0, 16)) out(r.cid.padEnd(12) + ' procs ' + String(r.n).padStart(3) + ' | cpu ' + r.cpu.toFixed(1).padStart(5) + '% | rss ' + r.rss.toFixed(0).padStart(5) + ' MB | ' + r.top)
  out('(' + rows.length + ' groups; the apache-sporta container id is in `vps_docker_list`)')
}

if (SECTIONS.includes('compose')) {
  out('== COMPOSE')
  const mask = (line) => {
    // KEY=value / KEY: value / - KEY=value : the value of anything that looks like a credential is hidden; environment values are hidden in full
    const m = /^(\s*(?:-\s*)?)([^=:#]+?)(\s*[=:]\s*)(.*)$/.exec(line)
    if (!m) return line
    return MASK.test(m[2]) || /basicauth|users=|password|secret|token/i.test(m[4]) ? m[1] + m[2] + m[3] + '***' : line
  }
  const apache = rd('/infra/apache/docker-compose.yml')
  if (!apache) out('apache compose: not readable')
  else {
    const L = apache.split('\n'); const services = []
    L.forEach((l, i) => { const m = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(l); if (m && i > L.findIndex((x) => /^services:/.test(x))) services.push([m[1], i]) })
    out('services in the apache project: ' + services.map((s) => s[0]).join(', '))
    const at = services.findIndex((s) => s[0] === 'sporta')
    if (at < 0) out('no `sporta` service block in the file (the container may come from an override file)')
    else {
      const end = at + 1 < services.length ? services[at + 1][1] : L.length
      let inEnv = false
      for (const l of L.slice(services[at][1], end)) {
        if (!l.trim()) continue
        if (/^\s{4}environment:/.test(l)) { inEnv = true; out(l); continue }
        if (inEnv && /^\s{4}\S/.test(l)) inEnv = false
        if (inEnv) { out(l.replace(/^(\s*-\s*)?([^=:]+)([=:]).*$/, (all, dash, key, sep) => (dash || '') + key + sep + (sep === ':' ? ' ' : '') + '***')); continue }
        out(mask(l))
      }
    }
  }
  for (const f of ['override', 'docker-compose.override.yml']) { if (existsSync('/infra/apache/' + f)) out('note: /infra/apache/' + f + ' exists') }
  const tr = rd('/infra/traefik/docker-compose.yml')
  if (!tr) out('traefik compose: not readable')
  else {
    out('-- traefik compose (command line and ports; values that look like credentials are hidden)')
    for (const l of tr.split('\n')) { if (/^\s*(image|restart|command|ports|networks|volumes|labels|-\s*["']?--|-\s*["']?\d+:\d+|-\s*\/)/.test(l)) out(mask(l)) }
  }
  for (const d of ['/infra/traefik', '/infra/traefik/dynamic', '/infra/traefik/config']) {
    if (!existsSync(d)) continue
    out('files in ' + d + ': ' + readdirSync(d).filter((x) => !/acme|\.json$|\.log$/i.test(x)).join(', '))
    for (const x of readdirSync(d)) {
      if (!/\.(ya?ml|toml)$/.test(x) || /compose/.test(x)) continue
      out('-- ' + d + '/' + x)
      for (const l of rd(d + '/' + x).split('\n').slice(0, 80)) if (l.trim() && !/^\s*#/.test(l)) out(mask(l))
    }
  }
}

if (SECTIONS.includes('http')) {
  out('== HTTP (from the VPS itself: no internet round trip; 1 warm-up + 7 samples, sequential)')
  const BASE = 'https://www.sporta.com.kw'
  const get = async (path, headers = {}) => {
    const t0 = performance.now()
    const r = await fetch(BASE + path, { headers: { 'accept-encoding': 'br, gzip', 'user-agent': 'sporta-stack-probe/1', ...headers }, redirect: 'manual' })
    const ttfb = performance.now() - t0
    const buf = Buffer.from(await r.arrayBuffer())
    return { r, ttfb, total: performance.now() - t0, bytes: buf.length, text: /text|json|xml|javascript/.test(r.headers.get('content-type') || '') ? buf.toString('utf8') : '' }
  }
  const home = await get('/'), shop = await get('/shop')
  const assets = [...new Set([...(home.text.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)).map((m) => m[0])])]
  const entryJs = assets.find((x) => /index-.*\.js$/.test(x)), css = assets.find((x) => /\.css$/.test(x))
  const prods = await get('/api/api.php?r=products')
  let slug = '', image = ''
  try { const j = JSON.parse(prods.text); const list = Array.isArray(j) ? j : j.products || []; slug = (list[0] || {}).slug || ''; image = (list[0] || {}).image || '' } catch (e) { /* the products route is measured below anyway */ }
  const fontM = (css ? (await get(css)).text : '').match(/\/fonts\/[A-Za-z0-9_.-]+\.woff2/)
  const heads = async (p) => (await get(p, { range: 'bytes=0-0' })).r.status
  const photo = slug ? ['jpg', 'png', 'webp', 'jpeg'].map((x) => '/images/products/' + slug + '.' + x) : []
  let photoPath = ''; for (const p of photo) { if ((await heads(p)) < 400) { photoPath = p; break } }
  const targets = [
    ['html shell', '/'], ['html /shop', '/shop'], ['html product (server-rendered head)', slug ? '/product/' + slug : '/product/none'],
    ['entry js (hashed)', entryJs], ['css (hashed)', css], ['font', fontM ? fontM[0] : ''], ['product photo', photoPath], ['product photo small copy', slug ? '/images/products/responsive/' + slug + '-320.webp' : ''],
    ['hero image', '/hero/mobile/strength.webp'], ['logo', '/logo.png'], ['favicon', '/favicon.ico'],
    ['add-on js', '/sporta-features.js'], ['add-on css', '/sporta-shadows.css'], ['service worker', '/sw.js'], ['config.js', '/config.js'], ['boot.js', '/boot.js'],
    ['robots.txt', '/robots.txt'], ['sitemap index', '/sitemap.xml'], ['sitemap products', '/sitemap-products.xml'],
    ['api products', '/api/api.php?r=products'], ['api slides', '/api/api.php?r=slides'], ['api brands', '/api/api.php?r=brands'], ['api content', '/api/api.php?r=content'],
    ['api stock', '/api/api.php?r=stock'], ['api checkout_config', '/api/api.php?r=checkout_config'], ['api text_style', '/api/api.php?r=text_style']
  ].filter((t) => t[1])
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
  out('label'.padEnd(34) + ' status  bytes(enc/dec)   ttfb ms med/p90   cache-control | etag | last-modified | vary | conditional')
  for (const [label, path] of targets) {
    let first = null; const ttfb = [], tot = []
    try {
      await get(path)   // warm-up
      for (let i = 0; i < 7; i++) { const x = await get(path); if (!first) first = x; ttfb.push(x.ttfb); tot.push(x.total); await sleep(120) }
    } catch (e) { out(label.padEnd(34) + ' ERROR ' + String(e.message).slice(0, 80)); continue }
    const h = (n) => first.r.headers.get(n) || ''
    let cond = '-'
    const et = h('etag'), lm = h('last-modified')
    try {
      if (et) cond = 'If-None-Match -> ' + (await get(path, { 'if-none-match': et })).r.status
      else if (lm) cond = 'If-Modified-Since -> ' + (await get(path, { 'if-modified-since': lm })).r.status
    } catch (e) { cond = 'error' }
    out(label.padEnd(34) + ' ' + String(first.r.status).padEnd(5) + ' ' + (h('content-length') || '?').padStart(7) + '/' + String(first.bytes).padEnd(7) + ' ' + pct(ttfb, 0.5).toFixed(0).padStart(5) + '/' + pct(ttfb, 0.9).toFixed(0).padEnd(5) + ' ' + (h('content-encoding') || 'identity') + ' | ' + (h('cache-control') || '(none)') + ' | ' + (et ? et.slice(0, 18) : '-') + ' | ' + (lm ? 'yes' : '-') + ' | ' + (h('vary') || '-') + ' | ' + cond)
  }
  out('assets found on /: ' + assets.length + ' (' + assets.slice(0, 4).join(' ') + (assets.length > 4 ? ' ...' : '') + ')')
}
out('PROBE_DONE')
