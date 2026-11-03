// Fetch-only (GET): read the live bundle's strings and the public checkout_config. No page loads.
const B = 'https://www.sporta.com.kw'
const CFG = JSON.parse(process.env.CFG || '{}')
const log = (...a) => console.log(a.join(' '))
const TRM = {}
'0627A 0623O 0625I 0622M 0621Q 0624W 0626J 0628b 0629p 062At 062Bv 062Cj 062DH 062Ex 062Fd 0630* 0631r 0632z 0633s 0634C 0635S 0636D 0637T 0638Z 0639E 063Ag 0641f 0642q 0643k 0644l 0645m 0646n 0647h 0648w 064Ay 0649Y 064BF 064CN 064DK 064Ea 064Fu 0650i 0651~ 0652o 0640_ 060C` 061F@ 061B# 066A!'.split(' ').forEach((e) => { TRM[String.fromCharCode(parseInt(e.slice(0, 4), 16))] = e.slice(4) })
const tr = (s) => Array.from(String(s)).map((ch) => {
  const c = ch.codePointAt(0)
  if (c < 128) return ch
  if (TRM[ch]) return TRM[ch]
  if (c >= 0x660 && c <= 0x669) return '^' + (c - 0x660)
  return '{' + c.toString(16) + '}'
}).join('')
if (CFG.config) {
  for (const r of CFG.config) {
    const t = await (await fetch(B + '/api/api.php?r=' + r)).text()
    log('API', r, t.length, tr(t.replace(/\s+/g, ' ').slice(0, CFG.cfgMax || 1800)))
  }
}
if (CFG.needles) {
  const html = await (await fetch(B + '/')).text()
  const m = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)
  const js = await (await fetch(B + m[0])).text()
  log('JS', m[0], js.length)
  for (const nd of CFG.needles) {
    let i = 0, n = 0
    const hits = []
    while ((i = js.indexOf(nd, i)) !== -1 && n < (CFG.max || 3)) { hits.push(i); i += nd.length; n++ }
    log('NEEDLE', tr(nd), 'total=' + (js.split(nd).length - 1))
    for (const h of hits) log('  CTX', tr(js.slice(Math.max(0, h - (CFG.w || 220)), h + nd.length + (CFG.w || 220)).replace(/\s+/g, ' ')))
  }
}
log('DONE')
