// A small closed-loop HTTP load generator for the connection-pool measurements.
//
// `c` workers each send one request, wait for the whole body, record the time, and send the next
// until `requests` have completed or `maxSeconds` has passed. That is how a flood of shoppers looks to
// a server with a bounded number of children: at most `c` requests are in flight, never more.
//
// Every request names a DIFFERENT client in X-Forwarded-For (the rig trusts 127.0.0.1 as the proxy,
// as the live Apache trusts Traefik), because the API throttles per client address (120 reads a
// minute); one address would turn a load test into a measurement of the 429 path.
import http from 'node:http'

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : NaN)

let ipSeq = Math.floor(Math.random() * 40000) * 256
export const nextIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}` }

export function makeAgent(c) { return new http.Agent({ keepAlive: true, maxSockets: c, maxFreeSockets: c, scheduling: 'fifo' }) }

// One request. `build(i)` returns { path, method?, headers?, body? } for request number i.
function once(agent, base, spec) {
  return new Promise((resolve) => {
    const u = new URL(spec.path, base)
    const t0 = process.hrtime.bigint()
    const req = http.request({ agent, host: u.hostname, port: u.port, path: u.pathname + u.search, method: spec.method ?? 'GET',
      headers: { 'X-Forwarded-For': nextIp(), ...(spec.headers ?? {}), ...(spec.body ? { 'Content-Length': Buffer.byteLength(spec.body) } : {}) } }, (res) => {
      let bytes = 0
      res.on('data', (d) => { bytes += d.length })
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode, bytes }))
      res.on('error', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, bytes }))
    })
    req.setTimeout(60000, () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, bytes: 0 }))
    if (spec.body) req.write(spec.body)
    req.end()
  })
}

export async function loadRun({ base, build, concurrency, requests, maxSeconds = 12, agent = null }) {
  const ag = agent ?? makeAgent(concurrency)
  const lat = []
  const statuses = {}
  let next = 0, done = 0, sizeSum = 0
  const t0 = Date.now()
  const worker = async () => {
    for (;;) {
      if (next >= requests || (Date.now() - t0) / 1000 > maxSeconds) return
      const i = next++
      const r = await once(ag, base, build(i))
      done++
      lat.push(r.ms)
      sizeSum += r.bytes
      statuses[r.status] = (statuses[r.status] || 0) + 1
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const secs = (Date.now() - t0) / 1000
  lat.sort((a, b) => a - b)
  if (!agent) ag.destroy()
  return {
    concurrency, completed: done, seconds: +secs.toFixed(2), rps: +(done / secs).toFixed(1),
    p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +pct(lat, 100).toFixed(1),
    mean: +(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length)).toFixed(1),
    ok: Object.entries(statuses).filter(([s]) => +s >= 200 && +s < 300).reduce((a, [, n]) => a + n, 0),
    statuses, avgBytes: Math.round(sizeSum / Math.max(1, done)),
  }
}

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
