// The admin add-on split (scripts/split-admin-addon.mjs): a shopper's page must not download the admin code, and
// /backends must still get it, byte for byte.
//   node scripts/admin-loader-test.mjs
//
// 1. the transform on the REAL public/sporta-admin-brands.js: the real code moves unchanged, the loader is tiny, a second
//    run changes nothing, and it refuses a file that is not the add-on;
// 2. in a real browser, with the shipped loader and a stub in place of the real code (so "it ran" is observable):
//    a storefront page requests no admin code, not even after in-app navigation; a page loaded at /backends gets it
//    once, with the same ?v= query; the app moving to /backends later (pushState, replaceState, popstate) gets it once;
// 3. mutation: a loader without the path check fails the same assertions;
// 4. wiring: postbuild runs the split, and .htaccess serves both names no-cache.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { split, LOADER, FULL_NAME, LOADER_MARK } from './split-admin-addon.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const ok = (c, m, d = '') => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c || !d ? '' : '  — ' + d)) }

// ---------------------------------------------------------------- 1 the transform on the real file
const REAL = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'))
const dist = mkdtempSync(join(tmpdir(), 'admin-split-'))
copyFileSync(join(ROOT, 'public/sporta-admin-brands.js'), join(dist, 'sporta-admin-brands.js'))
const r1 = split(dist)
const loader = readFileSync(join(dist, 'sporta-admin-brands.js'))
const full = readFileSync(join(dist, FULL_NAME))
ok(Buffer.compare(full, REAL) === 0, `the real code moved unchanged to ${FULL_NAME} (${REAL.length} B)`)
ok(loader.length < 1500 && loader.includes(LOADER_MARK), `the file the live index.html links is now a ${loader.length} B loader`, String(loader.length))
ok(!/\$\{|\$\(/.test(loader.toString()) && !/=>|\blet\b|\bconst\b|`/.test(loader.toString().replace(/\/\*[\s\S]*?\*\//, '')), 'the loader is plain ES5 (it runs on every shopper page, on old phones)')
const parsed = spawnSync(process.execPath, ['--check', join(dist, 'sporta-admin-brands.js')], { encoding: 'utf8' })
ok(parsed.status === 0, 'the loader parses', parsed.stderr)
const r2 = split(dist)
ok(r2.skipped && Buffer.compare(readFileSync(join(dist, FULL_NAME)), REAL) === 0, 'a second run changes nothing (the full file is not overwritten by the loader)')
const bad = mkdtempSync(join(tmpdir(), 'admin-split-bad-'))
writeFileSync(join(bad, 'sporta-admin-brands.js'), '// something else\n')
let refused = false
try { split(bad) } catch (e) { refused = /refusing/.test(e.message) }
ok(refused && !existsSync(join(bad, FULL_NAME)), 'a file that is not the add-on is refused, nothing is written')
const none = mkdtempSync(join(tmpdir(), 'admin-split-none-'))
let missing = false
try { split(none) } catch (e) { missing = /missing/.test(e.message) }
ok(missing, 'no add-on in dist: refused')

// ---------------------------------------------------------------- 2 in a browser
const STORE = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>t</title><script src="/sporta-admin-brands.js?v=1" defer></script></head><body><div id="root">x</div></body></html>'
const serve = (loaderSrc) => {
  const hits = []
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    hits.push(u.pathname + u.search)
    if (u.pathname === '/sporta-admin-brands.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(loaderSrc) }
    if (u.pathname === '/' + FULL_NAME) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__adminFull = (window.__adminFull || 0) + 1') }
    if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(STORE)   // every route is the SPA shell, like the live site
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, base: 'http://127.0.0.1:' + srv.address().port })))
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

async function scenarios(loaderSrc, label) {
  const { srv, hits, base } = await serve(loaderSrc)
  const res = []
  const fullHits = () => hits.filter((h) => h.startsWith('/' + FULL_NAME)).length
  const open = async (path) => { hits.length = 0; const p = await browser.newPage(); await p.goto(base + path, { waitUntil: 'load' }); await p.waitForTimeout(150); return p }

  let p = await open('/')
  res.push(['storefront /: no admin code requested', fullHits() === 0 && (await p.evaluate(() => window.__adminFull)) === undefined, hits.join(' ')])
  await p.evaluate(() => { history.pushState({}, '', '/shop'); history.replaceState({}, '', '/product/x') })
  await p.waitForTimeout(100)
  res.push(['storefront, after in-app navigation to /shop and /product/x: still none', fullHits() === 0, hits.join(' ')])
  await p.close()

  p = await open('/shop')
  res.push(['storefront /shop: none', fullHits() === 0, hits.join(' ')])
  await p.close()

  p = await open('/backends')
  res.push(['page loaded at /backends: the real code is requested once and runs', fullHits() === 1 && (await p.evaluate(() => window.__adminFull)) === 1, hits.join(' ')])
  res.push(['the ?v= of the loader is passed on', hits.includes('/' + FULL_NAME + '?v=1'), hits.join(' ')])
  await p.evaluate(() => { history.pushState({}, '', '/backends/orders') })
  await p.waitForTimeout(100)
  res.push(['moving around inside /backends does not load it twice', fullHits() === 1 && (await p.evaluate(() => window.__adminFull)) === 1, hits.join(' ')])
  await p.close()

  p = await open('/backends/orders')
  res.push(['page loaded at /backends/orders: loaded once', fullHits() === 1, hits.join(' ')])
  await p.close()

  for (const [how, js] of [
    ['pushState', () => history.pushState({}, '', '/backends')],
    ['replaceState', () => history.replaceState({}, '', '/backends')],
    ['popstate', () => { Object.getPrototypeOf(history).pushState.call(history, {}, '', '/backends'); dispatchEvent(new PopStateEvent('popstate')) }],
  ]) {
    p = await open('/')
    await p.evaluate(js)
    await p.waitForTimeout(150)
    res.push([`the app moves to /backends with ${how}: loaded once, runs once`, fullHits() === 1 && (await p.evaluate(() => window.__adminFull)) === 1, hits.join(' ')])
    await p.close()
  }
  srv.close()
  return res
}

const good = await scenarios(LOADER, 'shipped')
for (const [m, c, d] of good) ok(c, m, d)

// ---------------------------------------------------------------- 3 mutation: no path check = loads on every page
const MUT = LOADER.replace("if (done || location.pathname.indexOf('/backends') !== 0) return", 'if (done) return')
ok(MUT !== LOADER, 'mutation: the path check was found and removed')
const mut = await scenarios(MUT, 'mutant')
ok(mut.some(([, c]) => !c), 'mutation: a loader without the path check FAILS these scenarios', mut.filter(([, c]) => !c).length + ' failing')
await browser.close()

// ---------------------------------------------------------------- 4 wiring
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
ok(/split-admin-addon\.mjs/.test(pkg.scripts.postbuild || ''), 'package.json: postbuild runs the split after the CSP hashes', pkg.scripts.postbuild)
ok(pkg.scripts['test:admin-loader'] === 'node scripts/admin-loader-test.mjs', 'package.json: test:admin-loader')
const ht = readFileSync(join(ROOT, 'public/.htaccess'), 'utf8')
const fm = [...ht.matchAll(/<FilesMatch "([^"]+)">\s*\n\s*Header set Cache-Control "no-cache, must-revalidate"/g)].map((m) => new RegExp(m[1]))
for (const f of ['sporta-admin-brands.js', FULL_NAME]) {
  ok(fm.some((re) => re.test(f)), `.htaccess: ${f} is served no-cache, must-revalidate (a fixed name; a long cache would keep an old admin for a year)`)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
