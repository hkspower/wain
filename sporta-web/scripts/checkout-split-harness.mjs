// Shared plumbing for the checkout code-splitting suite and its measurement script.
//
//   scripts/checkout-split-test.mjs      the suite            (npm run test:checkout-split)
//   scripts/checkout-split-measure.mjs   the numbers, no assertions
//   scripts/checkout-split-mutants.mjs   the mutation check
//
// What it gives them, and why each piece is here rather than borrowed:
//
//   * buildSite()    a production build into a scratch directory, with the VITE_ variables
//                    emptied exactly as scripts/make-package.mjs does. It never writes dist/, so
//                    it cannot disturb the shared test rig, and it can build any tree: the
//                    working copy, or a git ref exported next to it (exportRef) to compare with.
//   * serveSite()    a tiny static server for that build with what the real host does that
//                    changes what is measured: Brotli on the wire, a year of `immutable` on the
//                    hashed files, no-cache HTML, the SPA fallback. And a mock /api that
//                    RECORDS every order body, because "the checkout sends the same JSON as
//                    before" can only be proven by reading what it sent.
//   * launch()       Chromium the way the other scripts launch it (CHROMIUM_PATH).
//   * throttle()     the phone profile the project's budgets use: 1.6 Mbps down, 150 ms RTT,
//                    CPU 4x slower.
//
// No database, no PHP, no port from the rig (8095-8100, 8188, 4173): the server takes an
// ephemeral port, and everything it writes goes under the directory it was given.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zc } from 'node:zlib'
import { chromium } from 'playwright'

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(WEB, '..')

// The last commit before the checkout lane touched anything. The comparison build for
// "the same order body as before" is made from this ref, so it stays true however many
// commits land on top.
export const PRE_SPLIT_REF = 'bd1071a3'

export const workDir = (name) => {
  const base = process.env.SPLIT_WORK || tmpdir()
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, `sporta-${name}-`))
}

// Export <ref> of sporta-web into <dest>/sporta-web and link node_modules, so Vite can build it
// without a second install. `git archive` reads the object store only; the working tree is
// never touched.
export function exportRef(ref, dest) {
  mkdirSync(dest, { recursive: true })
  const tar = execFileSync('git', ['-C', REPO, 'archive', ref, 'sporta-web'], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', dest], { input: tar })
  symlinkSync(join(WEB, 'node_modules'), join(dest, 'sporta-web', 'node_modules'))
  return join(dest, 'sporta-web')
}

// A copy of the WORKING tree (what a build needs, nothing else) with node_modules linked, so a mutation
// can be applied to the copy and never to the repo.
export function copyTree(dest) {
  const root = join(dest, 'sporta-web')
  mkdirSync(root, { recursive: true })
  for (const f of ['src', 'public', 'index.html', 'vite.config.js', 'package.json', 'tailwind.config.js', 'postcss.config.js', 'jsconfig.json']) {
    if (existsSync(join(WEB, f))) cpSync(join(WEB, f), join(root, f), { recursive: true })
  }
  symlinkSync(join(WEB, 'node_modules'), join(root, 'node_modules'))
  return root
}

// The Content-Security-Policy the real host sends (public/.htaccess), with __SCRIPT_HASHES__ filled in
// the way scripts/csp-hashes.mjs fills it: the SHA-256 of every inline <script> in the built index.html.
// Two directives are dropped because they can only misbehave on http://127.0.0.1: the upgrade to https
// and the payment hosts a form may post to.
export function contentSecurityPolicy(dist) {
  const ht = readFileSync(join(WEB, 'public', '.htaccess'), 'utf8')
  const policy = /Header set Content-Security-Policy "([^"]+)"/.exec(ht)?.[1]
  if (!policy) throw new Error('no Content-Security-Policy line in public/.htaccess')
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  return policy
    .replace('__SCRIPT_HASHES__', hashes.join(' '))
    .replace(/;\s*upgrade-insecure-requests/, '')
    .replace(/;\s*form-action [^;]*/, '')
}

// vite build <root> -> <outDir>, for any tree whose node_modules resolves (the real one, or a link).
export function buildSite(root, outDir) {
  const vite = join(dirname(createRequire(join(WEB, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js')
  execFileSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: root,
    env: { ...process.env, VITE_PAY_BASE_URL: '', VITE_CBK_BASE_URL: '', VITE_PHP_API_URL: '' },
    stdio: 'pipe',
    maxBuffer: 1 << 26,
  })
  return outDir
}

// ----------------------------------------------------------------------------- the server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.xml', '.txt', '.webmanifest'])

/**
 * Serve a built site. Returns { url, requests, orders, discounts, close }.
 *   csp       send the production Content-Security-Policy with every HTML page (see contentSecurityPolicy).
 *   requests  [{ n, t, method, path, status, bytes }] in the order they were ANSWERED; n counts from 1.
 *             `bytes` is what went over the wire (after Brotli).
 *   orders    the parsed JSON body of every POST /api/api.php?r=order
 *   discounts the parsed JSON body of every POST ...?r=discount
 */
export async function serveSite(dist, { csp = false } = {}) {
  const policy = csp ? contentSecurityPolicy(dist) : null
  const files = new Map() // path -> { buf, br, type, immutable }
  const walk = (dir, rel = '') => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const r = `${rel}/${name}`
      if (statSync(p).isDirectory()) walk(p, r)
      else files.set(r, p)
    }
  }
  walk(dist)
  const cache = new Map()
  const load = (path) => {
    if (cache.has(path)) return cache.get(path)
    const ext = extname(path).toLowerCase()
    const buf = readFileSync(files.get(path))
    const ent = {
      buf,
      br: COMPRESSIBLE.has(ext) ? brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } }) : null,
      type: MIME[ext] || 'application/octet-stream',
      immutable: path.startsWith('/assets/'),
    }
    cache.set(path, ent)
    return ent
  }

  const requests = []
  const orders = []
  const discounts = []
  let n = 0
  const t0 = Date.now()
  const log = (method, path, status, bytes) => requests.push({ n: ++n, t: Date.now() - t0, method, path, status, bytes })

  const readBody = (req) => new Promise((ok) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')))
  })
  const json = (res, status, obj, method, path) => {
    const body = Buffer.from(JSON.stringify(obj))
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(body)
    log(method, path, status, body.length)
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const path = decodeURIComponent(u.pathname)

    // ---- the mock backend: only what the checkout talks to ----
    if (path === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (req.method === 'POST' && r === 'discount') {
        let body = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* leave empty */ }
        discounts.push(body)
        const subtotal = (body.items ?? []).reduce((s, i) => s + 10 * (i.qty ?? 1), 0)
        const code = String(body.code ?? '').toUpperCase()
        if (code === '') return json(res, 200, { subtotal, delivery: 1, total: subtotal + 1, applied: [] }, 'POST', req.url)
        if (code === 'SAVE10') {
          return json(res, 200, { subtotal, delivery: 1, total: subtotal + 1 - 2, applied: [{ label: 'SAVE10', amount: 2 }] }, 'POST', req.url)
        }
        return json(res, 400, { error: 'discount_unknown' }, 'POST', req.url)
      }
      if (req.method === 'POST' && r === 'order') {
        let body = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* leave empty */ }
        orders.push(body)
        return json(res, 200, { track_id: body.track_id || 'SPTEST', amount: 21 }, 'POST', req.url)
      }
      // products, stock, brands, slides, status ...: this server has none. The storefront treats a non-OK
      // answer as "no data" and uses its built-in catalogue, which is all the checkout needs.
      return json(res, 404, { error: 'not_found' }, req.method, req.url)
    }

    // ---- static files, then the SPA fallback ----
    let key = path === '/' ? '/index.html' : path
    if (!files.has(key)) {
      // A path with an extension that is not on disk is a real 404 (a missing chunk must fail, not
      // fall back to HTML). Anything else is a client-side route.
      if (extname(key)) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return log(req.method, req.url, 404, 9)
      }
      key = '/index.html'
    }
    const ent = load(key)
    const headers = {
      'content-type': ent.type,
      'cache-control': ent.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    }
    const wantsBr = ent.br && /\bbr\b/.test(String(req.headers['accept-encoding'] || ''))
    const body = wantsBr ? ent.br : ent.buf
    if (wantsBr) headers['content-encoding'] = 'br'
    headers['content-length'] = body.length
    headers.vary = 'Accept-Encoding'
    if (policy && ent.type.startsWith('text/html')) headers['content-security-policy'] = policy
    res.writeHead(200, headers)
    res.end(body)
    log(req.method, req.url, 200, body.length)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    orders,
    discounts,
    mark: () => requests.length,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok) }),
  }
}

// ----------------------------------------------------------------------------- the browser
export const launch = () =>
  chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  })

// A phone-sized context with no service worker (the app registers one on localhost, and a worker
// would answer requests the server is supposed to be counting).
export const phone = (browser, extra = {}) =>
  browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, serviceWorkers: 'block', ...extra })

// The project's throttled-phone profile (PERFORMANCE.md): 1.6 Mbps, 150 ms, CPU 4x.
export async function throttle(page, { rtt = 150, kbps = 1600, cpu = 4 } = {}) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: rtt, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: (750 * 1000) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  return cdp
}

// The seeded bag and, optionally, a returning shopper's saved details.
export const CART = [
  {
    key: 'cloudsoft-jacket-army-green__L__normal', slug: 'cloudsoft-jacket-army-green', size: 'L', fit: 'normal',
    name: { en: 'Cloudsoft Jacket — Army Green', ar: 'جاكيت كلاودسوفت — أخضر عسكري' }, price: 10, image: '', qty: 2,
  },
]
export const SAVED = {
  name: 'Test Shopper', phone: '99887766', governorate: 'hawalli', area: 'Salmiya',
  block: '4', street: '12', building: '5', floor: '', flat: '', note: '',
}
export const seed = (page, { lang = 'en', saved = null, cart = CART } = {}) =>
  page.addInitScript(([l, c, d]) => {
    try {
      localStorage.setItem('lang', l)
      localStorage.setItem('sporta_cart', JSON.stringify(c))
      if (d) localStorage.setItem('sporta.delivery', JSON.stringify(d))
      else localStorage.removeItem('sporta.delivery')
    } catch { /* storage blocked */ }
  }, [lang, cart, saved])

export const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const rmrf = (p) => { try { rmSync(p, { recursive: true, force: true }) } catch { /* already gone */ } }
export { existsSync }
