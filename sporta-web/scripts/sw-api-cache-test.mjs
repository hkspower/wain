// The service worker must never keep an answer from the API, and must never keep anything the server
// marked no-store. Found by reading public/sw.js: the network-first branch stored every same-origin 200
// that was not HTML, whatever its Cache-Control said, and served the stored copy whenever the network
// failed. The API marks its answers no-store on purpose (an order's status, a stock figure, the admin's
// lists): the copy outlived logout, and on a device with no network it showed the last order it had seen.
//
// This runs the real worker file in a sandboxed context with a fake cache, a fake network and a fake
// fetch event, and checks what it stores and what it answers when the network is down.
//
//   npm run test:sw-api-cache
//   SW_FILE=/path/to/older/sw.js npm run test:sw-api-cache     (the same checks against another copy: a mutation check)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SW_FILE = process.env.SW_FILE || join(ROOT, 'public/sw.js')
const SRC = readFileSync(SW_FILE, 'utf8')
const ORIGIN = 'https://www.sporta.com.kw'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }

const flush = () => new Promise((r) => setTimeout(r, 0))
const keyOf = (req) => (typeof req === 'string' ? req : req.url)

// One worker, one fake cache, one fake network. `online` decides whether the network answers.
function worker(network) {
  const listeners = {}
  const stores = new Map()
  const store = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name) }
  const caches = {
    async open(name) {
      const m = store(name)
      return { add: async () => {}, put: async (req, res) => { m.set(keyOf(req), res) } }
    },
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
    async match(req) {
      for (const m of stores.values()) { const hit = m.get(keyOf(req)); if (hit) return hit.clone() }
      return undefined
    },
  }
  const ctx = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    location: { origin: ORIGIN },
    caches,
    fetch: (req) => network(req),
    Response, Headers, URL, Promise, console,
  }
  vm.createContext(ctx)
  vm.runInContext(SRC, ctx)
  const cached = (url) => { for (const [name, m] of stores) if (m.has(ORIGIN + url)) return name; return null }
  // Dispatch one GET. `answered` says whether the worker took the request; when it did not, the browser
  // sends it to the network itself, so the same fake network answers (or fails, and `res` is null).
  async function get(path) {
    const req = { url: ORIGIN + path, method: 'GET', mode: 'cors' }
    const ev = { request: req, respondWith(p) { ev.answer = p }, waitUntil(p) { ev.waits.push(p) }, waits: [] }
    listeners.fetch(ev)
    if (!ev.answer) {
      let res = null
      try { res = await network(req) } catch { res = null }
      return { answered: false, res }
    }
    const res = await ev.answer
    await Promise.all(ev.waits)
    await flush(); await flush()
    return { answered: true, res }
  }
  return { get, cached }
}

const json = (body, headers = {}) => new Response(body, {
  status: 200, headers: { 'content-type': 'application/json', ...headers },
})

// The network: `answers` maps a path to a response factory; `down` makes every request fail.
function network(answers, state) {
  return async (req) => {
    const u = new URL(req.url)
    state.calls.push(u.pathname + u.search)
    if (state.down) throw new TypeError('network down')
    const make = answers[u.pathname + u.search] || answers[u.pathname]
    if (!make) return new Response('not found', { status: 404 })
    return make()
  }
}

// ---- 1. an order-status answer (no-store, as the server sends it) is not kept
{
  const path = '/api/api.php?r=status&id=SP1A2B3C4D5'
  const state = { down: false, calls: [] }
  const w = worker(network({ [path]: () => json('{"status":"paid","name":"A. Customer"}', { 'cache-control': 'no-store' }) }, state))
  const online = (await w.get(path)).res
  is(online && online.status === 200, 'online: the order status reaches the page')
  is(w.cached(path) === null, 'online: the order status is NOT stored by the service worker', w.cached(path) ? `stored in ${w.cached(path)}` : '')

  state.down = true
  const offline = (await w.get(path)).res
  is(!(offline && offline.status === 200), 'offline: the stored order status is NOT served again',
    offline && offline.status === 200 ? 'a 200 was answered from the cache' : '')
}

// ---- 2. an admin read (also /api/, also no-store) is not kept, and is not served offline
{
  const path = '/api/admin.php?r=orders'
  const state = { down: false, calls: [] }
  const w = worker(network({ [path]: () => json('{"orders":[]}', { 'cache-control': 'no-store' }) }, state))
  await w.get(path)
  is(w.cached(path) === null, 'admin reads under /api/ are NOT stored', w.cached(path) ? `stored in ${w.cached(path)}` : '')
  state.down = true
  const offline = (await w.get(path)).res
  is(!(offline && offline.status === 200), 'offline: an admin read is NOT answered from the cache',
    offline && offline.status === 200 ? 'a 200 was answered from the cache' : '')
}

// ---- 3. anything the server marks no-store is not kept, whatever its path (a guard behind the path rule)
{
  const path = '/robots.txt'
  const state = { down: false, calls: [] }
  const w = worker(network({ [path]: () => new Response('User-agent: *', { status: 200, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } }) }, state))
  await w.get(path)
  is(w.cached(path) === null, 'a same-origin file answered no-store is NOT stored (the header decides, not only the path)',
    w.cached(path) ? `stored in ${w.cached(path)}` : '')
}

// ---- 4. the offline shell still works where it should: a fingerprinted script is stored and served offline
{
  const path = '/assets/index-abc123.js'
  const state = { down: false, calls: [] }
  const w = worker(network({ [path]: () => new Response('console.log(1)', { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=31536000, immutable' } }) }, state))
  await w.get(path)
  is(w.cached(path) !== null, 'regression: a fingerprinted script is still stored for offline use')
  state.down = true
  const offline = (await w.get(path)).res
  is(offline && offline.status === 200, 'regression: and still answered from the cache when the network is down')
}

// ---- 5. payment pages are never touched by the worker (unchanged rule)
{
  const path = '/knet/pay.php?x=1'
  const state = { down: false, calls: [] }
  const w = worker(network({ [path]: () => json('{"ok":true}', { 'cache-control': 'no-store' }) }, state))
  const { answered } = await w.get(path)
  is(!answered, 'payment routes are passed straight to the network (the worker does not answer them)')
  is(w.cached(path) === null, 'payment routes are not stored')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
