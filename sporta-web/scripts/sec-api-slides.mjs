#!/usr/bin/env node
// SEC-API follow-up — does ?r=slide_image serve a slide that ?r=slides does not list
// (an inactive / unpublished hero photograph)? Read-only: one GET of the slide list,
// then one GET per id 1..14. Prints ids, status and byte counts only, never image bytes.
import https from 'node:https'
const get = (path) => new Promise((resolve) => {
  const req = https.request({ host: '127.0.0.1', port: 443, path, method: 'GET', servername: 'www.sporta.com.kw',
    checkServerIdentity: () => undefined, headers: { Host: 'www.sporta.com.kw', 'User-Agent': 'sporta-sec-scan' }, timeout: 20000 }, (res) => {
    let n = 0; const ch = []
    res.on('data', (c) => { n += c.length; if (ch.length < 40) ch.push(c) })
    res.on('end', () => resolve({ status: res.statusCode, bytes: n, text: Buffer.concat(ch).toString('utf8'), ct: res.headers['content-type'] }))
  })
  req.on('error', (e) => resolve({ status: 0, bytes: 0, text: '', ct: String(e.code) }))
  req.end()
})
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await get('/api/api.php?r=slides')
const active = new Set((JSON.parse(list.text.length < 20000 ? list.text : '{}').slides ?? []).map((s) => s.id))
console.log('active slide ids from ?r=slides:', [...active].join(','))
const rows = []
for (let id = 1; id <= 14; id++) {
  const r = await get(`/api/api.php?r=slide_image&id=${id}`)
  rows.push(`id${id}:${r.status}/${r.bytes}B${r.status === 200 ? (active.has(id) ? '/listed' : '/NOT-LISTED') : ''}`)
  await pause(300)
}
console.log(rows.join(' '))
console.log('== Done')
