// A stand-in for /backends' world, in one Node process: the built site (a dist/
// directory, served with the SPA fallback that .htaccess gives production) plus
// a mock of /api/admin.php that answers the way the real one does.
//
// Used by scripts/profiles-screen-test.mjs. Nothing here touches the shared
// test rig: no MariaDB, no PHP, no fixed port (the server listens on port 0 and
// the caller reads the port the OS gave it). Sign-in is out of scope on purpose:
// `me` answers 200 as a signed-in session does, the way the other admin suites
// stand the session in.
//
// The data is made up. Names are "Test Customer", Arabic placeholders and one
// that is markup on purpose; emails are example.com; phones are 9650000xxxx.
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

// ------------------------------------------------------------ made-up customers
// 47 profiles = two full pages of 20 and a last page of 7, so "more" is true,
// true, false. Index 0 is the newest.
export const XSS_NAME = '<img src=x onerror="window.__xss=1"> Mallory'
const ARABIC = ['عميل تجريبي', 'عميلة تجريبية', 'خالد المطيري', 'نورة العجمي']
const ENGLISH = ['Test Customer', 'Sample Buyer', 'Khalid Example', 'Noura Example', 'Demo Shopper']
const AREAS = ['Salmiya', 'Hawalli', 'Jabriya', 'Mishref', 'Kuwait City']
const GOV = ['hawalli', 'hawalli', 'hawalli', 'hawalli', 'capital']

export function makeProfiles(n = 47) {
  return Array.from({ length: n }, (_, i) => {
    const id = 400 + i
    let name = i % 4 === 1 ? `${ARABIC[i % ARABIC.length]} ${i}` : `${ENGLISH[i % ENGLISH.length]} ${i}`
    if (i === 3) name = XSS_NAME
    // A 70-character address with no break opportunity: the layout check at 390px.
    const email = i === 5 ? `${'long'.repeat(15)}@example.com` : `customer${i}@example.com`
    return {
      id,
      name,
      email,
      phone: `9650000${String(1000 + i)}`,
      created_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')} 10:15:00`,
      last_login_at: null, // the column does not exist on any live database yet
      order_count: i % 5,
      paid_total: (i % 5) * 9.5,
      last_order_at: i % 5 ? `2026-10-${String(1 + (i % 28)).padStart(2, '0')} 18:40:00` : null,
    }
  })
}

function makeOrders(profile) {
  const n = profile.order_count
  return Array.from({ length: n }, (_, k) => {
    const a = (profile.id + k) % 2 // two different addresses over the orders
    return {
      id: 9000 + profile.id * 10 + k,
      track_id: `SPTEST${profile.id}${k}`,
      amount: 9.5 + k,
      payment_method: ['knet', 'cod', 'tpay'][k % 3],
      payment_status: ['paid', 'pending', 'failed', 'review'][k % 4],
      fulfilment_status: ['delivered', 'unfulfilled', 'cancelled', 'packed'][k % 4],
      customer_name: profile.name,
      customer_phone: profile.phone,
      customer_governorate: GOV[a],
      customer_area: AREAS[a],
      customer_block: String(1 + a),
      customer_street: String(2 + a),
      customer_building: String(3 + a),
      customer_floor: null,
      customer_flat: null,
      customer_note: null,
      created_at: `2026-10-${String(20 - k).padStart(2, '0')} 1${k}:20:00`,
      paid_at: null,
      fulfilled_at: null,
    }
  })
}

// ---------------------------------------------------------------------- server
export async function startMockAdmin({ distDir }) {
  const profiles = makeProfiles()
  const log = [] // every request: { n, method, path, query, admin, aborted, done }
  const state = {
    // Hooks the test sets to make the server misbehave on cue.
    profilesDelay: (q) => (q.startsWith('slow') ? 1500 : 0),
    profilesFail: null, // (q, page) => { status, body, headers } | null
    detailFail: null, // (id) => { status, body } | null
    blockPaths: null, // (pathname) => true to answer 404 (a chunk that "never arrived")
    delayPaths: null, // (pathname) => milliseconds to hold a static file back (a slow connection)
  }

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }

  async function api(req, res, url, entry) {
    const r = url.searchParams.get('r') ?? ''
    const signedIn = req.headers['x-sporta-admin'] === '1'
    entry.admin = signedIn
    if (r === 'me') return json(res, 200, { email: 'owner@example.com' })
    // Every data route wants the admin header, as admin.php does.
    if (!signedIn) return json(res, 401, { error: 'not_signed_in' })

    if (r === 'profiles_list') {
      const q = (url.searchParams.get('q') ?? '').trim()
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1
      entry.q = q
      entry.page = page
      const fail = state.profilesFail?.(q, page)
      if (fail) return json(res, fail.status, fail.body, fail.headers)
      const wait = state.profilesDelay(q)
      if (wait) await new Promise((ok) => setTimeout(ok, wait))
      if (entry.aborted) return
      let rows = profiles
      if (q) {
        const needle = q.toLowerCase()
        rows = profiles.filter((p) => [p.name, p.email, p.phone].some((v) => v.toLowerCase().includes(needle)))
      }
      if (q.startsWith('slow')) rows = [{ ...profiles[0], id: 990, name: 'SLOW RESULT' }]
      const slice = rows.slice((page - 1) * 20, (page - 1) * 20 + 21)
      return json(res, 200, { profiles: slice.slice(0, 20), page, has_more: slice.length > 20 })
    }

    if (r === 'profile_detail') {
      const id = Number.parseInt(url.searchParams.get('id') ?? '', 10)
      entry.id = id
      const fail = state.detailFail?.(id)
      if (fail) return json(res, fail.status, fail.body)
      const p = profiles.find((x) => x.id === id)
      if (!p) return json(res, 404, { error: 'not_found' })
      const orders = makeOrders(p)
      return json(res, 200, {
        profile: { id: p.id, name: p.name, email: p.email, phone: p.phone, created_at: p.created_at, last_login_at: null },
        orders,
        summary: { orders: orders.length, paid_total: orders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.amount, 0) },
      })
    }

    // The other screens only need to open without falling over.
    if (r === 'stats') {
      return json(res, 200, { paid_count: 6, paid_revenue: '61.000', pending_count: 5, review_count: 2, failed_count: 2, unfulfilled_count: 3,
        paid_today: 1, revenue_today: '9.000', paid_7d: 4, revenue_7d: '38.000', cod_awaiting_count: 2, cod_awaiting_amount: '13.000' })
    }
    if (r === 'revenue') return json(res, 200, Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(17 + i).padStart(2, '0')}`, revenue: String(5 + ((i * 7) % 23)) })))
    if (r === 'slides') return json(res, 200, { slides: [], hero: { speed_ms: 6500, shuffle: false, size: 'tall', autoplay: true } })
    if (['orders', 'items', 'products_state', 'products_all', 'variants', 'brands', 'discounts', 'blocked'].includes(r)) return json(res, 200, [])
    return json(res, 404, { error: 'unknown_route' })
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const entry = { n: log.length, method: req.method, path: url.pathname, query: url.search, admin: null, aborted: false, done: false, bytes: 0 }
    log.push(entry)
    // "Closed before we finished answering" is how a browser-side abort shows.
    res.on('close', () => { if (!res.writableFinished) entry.aborted = true; entry.done = true })
    try {
      if (url.pathname === '/api/admin.php') return await api(req, res, url, entry)
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' })

      if (state.blockPaths?.(url.pathname)) { res.writeHead(404); return res.end('blocked') }
      const hold = state.delayPaths?.(url.pathname) ?? 0
      if (hold) { await new Promise((ok) => setTimeout(ok, hold)); if (entry.aborted) return }

      // Static files, with the fallback .htaccess gives the known routes.
      const clean = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
      let file = join(distDir, clean)
      if (!file.startsWith(distDir + sep) && file !== distDir) { res.writeHead(403); return res.end() }
      let info = await stat(file).catch(() => null)
      if (info?.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null) }
      if (!info) {
        // An asset that is not there must 404 (a hashed chunk from an older
        // deploy is exactly that); only a route falls back to the shell.
        if (extname(url.pathname)) { res.writeHead(404); return res.end('not found') }
        file = join(distDir, 'index.html')
      }
      const body = await readFile(file)
      entry.bytes = body.length
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
      res.end(body)
    } catch (e) {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(e?.message ?? e))
    }
  })

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    log,
    state,
    profiles,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()) }),
  }
}
