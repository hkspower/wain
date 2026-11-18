// READ-ONLY smoke probe of the live shop AFTER the full backend release (2026-11-18). GET only, no sign-in, nothing posted, no secret printed.
// Run on the VPS in node:24-alpine with /var/log/sporta-cron.log mounted read-only (optional).
const B = 'https://www.sporta.com.kw'
const say = (s) => console.log(s)
const get = async (p, headers = {}) => {
  try {
    const r = await fetch(B + p, { redirect: 'manual', headers })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, h: r.headers, text: buf.toString('utf8'), bytes: buf.length }
  } catch (e) { return { status: 0, h: new Headers(), text: String(e.message), bytes: 0 } }
}
const j = (t) => { try { return JSON.parse(t) } catch { return null } }

say('== public API')
const products = await get('/api/api.php?r=products')
const plist = j(products.text)
say(`products ${products.status}: ${Array.isArray(plist) ? plist.length : '?'} listed (46 expected: the photo rule is off), cache-control: ${products.h.get('cache-control')}`)
const cc = await get('/api/api.php?r=checkout_config')
const ccj = j(cc.text)
say(`checkout_config ${cc.status}: ${cc.text.slice(0, 300)}`)
for (const r of ['shipping', 'text_style', 'content', 'stock', 'theme', 'brands', 'slides']) {
  const x = await get(`/api/api.php?r=${r}`)
  say(`${r} ${x.status} ${x.bytes} bytes ${x.text.slice(0, 90).replace(/\s+/g, ' ')}`)
}
for (const r of ['status', 'invoice']) {
  const x = await get(`/api/api.php?r=${r}&id=NOSUCH0000000`)
  say(`${r} (unknown order) ${x.status}: ${x.text.slice(0, 60)}`)
}

say('== sitemap')
const sm = await get('/sitemap.xml')
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
say(`sitemap.xml ${sm.status}: ${locs.length} locs`)
for (const l of locs.filter((u) => /product/i.test(u)).slice(0, 3)) {
  const p = new URL(l).pathname
  const x = await get(p)
  say(`${p} ${x.status}: ${(x.text.match(/<url>/g) ?? []).length} urls`)
}

say('== admin loader and compression')
const loader = await get('/sporta-admin-brands.js')
say(`sporta-admin-brands.js ${loader.status} ${loader.bytes} bytes (loader ~1 kB)`)
const full = await get('/sporta-admin-brands.full.js')
say(`sporta-admin-brands.full.js ${full.status} ${full.bytes} bytes (1,097,630 expected raw)`)
for (const enc of ['br', 'gzip']) {
  const x = await get('/sporta-features.js', { 'Accept-Encoding': enc })
  say(`/sporta-features.js with Accept-Encoding ${enc}: ${x.status} content-encoding=${x.h.get('content-encoding')} vary=${x.h.get('vary')}`)
}
const html = await get('/', { 'Accept-Encoding': 'br' })
say(`/ ${html.status} content-encoding=${html.h.get('content-encoding')}`)

say('== deny rules and gateways (GET only)')
for (const p of ['/api/config.php', '/knet/config.php', '/pay/config.php', '/api/.env', '/knet/knet.php', '/api/store.php', '/api/payment-records.php', '/api/refunds.mysql.sql', '/api/dbcenter.php']) {
  const x = await get(p)
  say(`${p} -> ${x.status} ${x.bytes} bytes`)
}
for (const p of ['/knet/pay.php', '/pay/pay.php', '/knet/callback.php', '/pay/callback.php']) {
  const x = await get(p)
  say(`${p} (no parameters) -> ${x.status}${x.h.get('location') ? ' location=' + new URL(x.h.get('location'), B).pathname : ''}`)
}
const adm = await get('/api/admin.php?r=db_center')
say(`/api/admin.php?r=db_center without a session -> ${adm.status} ${adm.text.slice(0, 80)}`)

say('== host cron log')
try {
  const { readFileSync, existsSync } = await import('node:fs')
  const f = '/var/log/sporta-cron.log'
  if (existsSync(f)) {
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    const bad = lines.filter((l) => /fatal|warning|notice|deprecated|parse error|uncaught|exception/i.test(l))
    say(`cron log: ${lines.length} lines; ${bad.length} with a PHP warning/error word; last 6:`)
    for (const l of lines.slice(-6)) say('  ' + l.slice(0, 160))
    for (const l of bad.slice(-5)) say('  BAD ' + l.slice(0, 200))
  } else say('cron log not mounted')
} catch (e) { say('cron log unreadable: ' + e.message) }
say('PROBE_DONE')
