// A stand-in Supabase Storage for scripts/image-uploader-test.mjs. It writes real
// files to disk, so an upload can be hashed on the other side.
//
//   node scripts/test-storage-stub.mjs [outDir] [port]
//
// Why a real server and not Playwright route interception: interception cannot
// see a binary XHR body — postDataBuffer() is empty for a File sent by
// XMLHttpRequest — and "the bytes are unchanged" is the one claim of the uploader
// that must not be taken on trust. On disk it can be hashed.
//
// Reach it through a hostname WITH a subdomain, not 127.0.0.1: supabase-js
// derives its auth storage key from the project ref, which is the first label of
// the host, so a bare IP gives a key the test cannot predict and the fake session
// is never read. Add to /etc/hosts:
//
//   127.0.0.1 stub.supabase.co
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

const OUT = process.argv[2] ?? '/tmp/storage-out'
const PORT = Number(process.argv[3] ?? 8899)
mkdirSync(OUT, { recursive: true })
let peak = 0, live = 0
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
}

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const url = new URL(req.url, 'http://x')

  if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/product-images/')) {
    const key = decodeURIComponent(url.pathname.split('/product-images/')[1])
    live++; peak = Math.max(peak, live)
    const chunks = []
    let got = 0
    req.on('aborted', () => console.log('ABORTED', key, got, 'of', req.headers['content-length']))
    req.on('error', (e) => console.log('REQERR', key, e.message))
    req.on('data', (c) => { chunks.push(c); got += c.length })
    req.on('end', () => {
      console.log('END', key, got, 'of', req.headers['content-length'])
      const body = Buffer.concat(chunks)
      const file = join(OUT, key)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body)
      writeFileSync(`${file}.meta.json`, JSON.stringify({
        contentType: req.headers['content-type'] ?? '',
        auth: String(req.headers.authorization ?? '').startsWith('Bearer '),
        upsert: req.headers['x-upsert'],
        bytes: body.length,
      }))
      // A delay, so the concurrency cap is observable.
      setTimeout(() => {
        live--
        res.writeHead(200, { ...cors, 'content-type': 'application/json' })
        res.end(JSON.stringify({ Key: key }))
      }, 120)
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/storage/v1/object/list/product-images') {
    let names = []
    try {
      names = readdirSync(join(OUT, 'originals')).filter((n) => !n.endsWith('.meta.json'))
    } catch { /* nothing uploaded yet */ }
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    return res.end(JSON.stringify(names.map((n, i) => ({
      id: `id${i}`, name: n, created_at: new Date(2026, 0, 1 + i).toISOString(),
      metadata: { size: statSync(join(OUT, 'originals', n)).size, mimetype: 'image/png' },
    }))))
  }

  if (url.pathname === '/__peak') {
    res.writeHead(200, cors); return res.end(String(peak))
  }
  // Auth, REST and anything else the admin touches.
  res.writeHead(200, { ...cors, 'content-type': 'application/json' })
  res.end(url.pathname.startsWith('/rest/') ? '[]' : '{}')
}).listen(PORT, '127.0.0.1', () => console.log(`storage stub on ${PORT} -> ${OUT}`))
