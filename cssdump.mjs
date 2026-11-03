// Fetch-only (GET): print the rules of the live stylesheet that matter for colour fixes.
const B = 'https://www.sporta.com.kw'
const CFG = JSON.parse(process.env.CFG || '{}')
const log = (...a) => console.log(a.join(' '))
const html = await (await fetch(B + '/')).text()
const m = /\/assets\/index-[A-Za-z0-9_-]+\.css/.exec(html)
log('CSS', m && m[0])
const css = await (await fetch(B + m[0])).text()
log('CSSLEN', css.length)
const boot = await (await fetch(B + '/boot.js')).text()
log('BOOTLEN', boot.length)
if (CFG.boot) log('BOOT', boot.replace(/\s+/g, ' ').slice(0, CFG.boot))
const flat = []
let pos = 0
while (pos < css.length) {
  const at = css.indexOf('@media', pos)
  const nextRule = css.indexOf('{', pos)
  if (nextRule === -1) break
  if (at !== -1 && at < nextRule) {
    const open = css.indexOf('{', at)
    const cond = css.slice(at, open).trim()
    let d = 1, j = open + 1
    while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++ }
    const inner = css.slice(open + 1, j - 1)
    let p2 = 0
    while (p2 < inner.length) {
      const o2 = inner.indexOf('{', p2); if (o2 === -1) break
      const c2 = inner.indexOf('}', o2); if (c2 === -1) break
      flat.push([cond, inner.slice(p2, o2).trim(), inner.slice(o2 + 1, c2).trim()])
      p2 = c2 + 1
    }
    pos = j
  } else {
    const close = css.indexOf('}', nextRule)
    flat.push(['', css.slice(pos, nextRule).trim(), css.slice(nextRule + 1, close).trim()])
    pos = close + 1
  }
}
log('RULES', flat.length)
for (const kw of CFG.kw || []) {
  const hits = flat.filter((r) => r[1].includes(kw) || (CFG.inBody && r[2].includes(kw)))
  log('KW', kw, 'hits=' + hits.length)
  for (const r of hits.slice(0, CFG.max || 6)) log('  R', (r[0] ? r[0].slice(0, 60) + ' => ' : '') + r[1].slice(0, 160) + ' {' + r[2].slice(0, 300) + '}')
}
log('DONE')
