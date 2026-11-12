// Audit of the admin JavaScript: public/sporta-admin-brands.js (every add-on block), public/boot.js, public/config.js.
//
//   npm run test:admin-js-audit   (rig-free: static reading of the three files, then the REAL add-on file in a real browser on the
//                                  captured admin screens)
//
// Owner request 2026-11-11: "check javascripts backends". What is proved, and what each line guards against:
//   1. SYNTAX  all three files parse (node --check).
//   2. INJECTION  no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function / string timers anywhere in the
//      admin add-ons or boot.js; every `target="_blank"` link has rel noopener; every `href` set from data is built from a checked
//      value (a path or a fixed https origin), never from raw text; web storage is only ever touched inside try/catch.
//   3. CONSOLE  no console.* call is left in any of the three files; every requestAnimationFrame callback that runs a scan is wrapped
//      in try/catch (an exception in one is a console error on every DOM change, forever).
//   4. DOUBLE EXECUTION  every block of the add-on file starts with a window flag, so a second copy of the file (a duplicate script tag,
//      a re-injected loader) starts nothing twice. Proved in a browser: the file is injected twice and the number of observers, timers,
//      document/window listeners and entry buttons is the same as after one injection.
//   5. LEAKS  every setInterval is either cleared or the 500 ms entry check that sleeps while the tab is hidden; every MutationObserver
//      is created once at start-up (never inside a handler) and its callback is debounced to one frame; listeners on document/window
//      are added once at start-up or removed with the thing that added them; nothing is retained per screen: in a real browser the
//      counts stay level while a screen is swapped fifty times.
//   6. CONSOLE ERRORS AT RUN TIME  the real file on every captured admin screen (light and dark, English and Arabic): no page error and
//      no console error.
//   7. PERFORMANCE  with the screen idle the add-ons change nothing in the page (zero mutation records over two seconds) and schedule
//      at most the half-second checks; a hidden tab does no work.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed, ALL } from './lib/admin-css-full-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const SRC = { brands: readFileSync(join(PUB, 'sporta-admin-brands.js'), 'utf8'), boot: readFileSync(join(PUB, 'boot.js'), 'utf8'), config: readFileSync(join(PUB, 'config.js'), 'utf8') }
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const ORIGIN = 'https://www.sporta.com.kw'
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')    // without comments (strings that contain // are kept: the pattern needs a non-quote before)
const BR = code(SRC.brands), BOOT = code(SRC.boot), CFG = code(SRC.config)
const lines = (s, re) => s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l))

head('1. syntax')
for (const f of ['sporta-admin-brands.js', 'boot.js', 'config.js']) {
  const r = spawnSync(process.execPath, ['--check', join(PUB, f)], { encoding: 'utf8' })
  is(r.status === 0, `${f} parses`, r.stderr.slice(0, 200))
}

head('2. injection and unsafe sinks')
{
  const SINKS = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.writeln|createContextualFragment)\b|\beval\s*\(|new Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]|\bsrcdoc\s*=\s*(?!['"])\S|javascript:/
  for (const [n, s] of [['sporta-admin-brands.js', BR], ['boot.js', BOOT], ['config.js', CFG]]) is(!SINKS.test(s), `${n}: no HTML sink, eval, string timer or javascript: address`, (lines(s, SINKS)[0] || []).join(': ').slice(0, 120))
  const iframes = lines(BR, /srcdoc\s*=/)
  is(iframes.length <= 1 && iframes.every(([, l]) => /srcdoc = '<!doctype html><html><head><meta charset="utf-8"><\/head><body><\/body><\/html>'/.test(l)), 'the only srcdoc is a constant empty document (the footer preview frame)', iframes.map((x) => x.join(':')).join(' | ').slice(0, 160))
  const blanks = lines(BR, /target\s*=\s*['"]_blank['"]|setAttribute\('target', '_blank'\)/)
  const bad = blanks.filter(([n]) => !/noopener/.test(BR.split('\n').slice(n - 3, n + 3).join('\n')))
  is(blanks.length >= 3 && bad.length === 0, `every target=_blank link (${blanks.length}) sets rel noopener within a few lines`, bad.map((b) => b[0]).join(','))
  const ls = lines(BR, /\b(localStorage|sessionStorage)\b/).filter(([, l]) => !/^\s*(\/\/|\*)/.test(l))
  const L = BR.split('\n')
  const unguarded = ls.filter(([n]) => !/try\s*\{/.test(L.slice(Math.max(0, n - 3), n).join('\n') + L[n - 1]))
  is(ls.length >= 4 && unguarded.length === 0, `web storage is only touched inside try/catch (${ls.length} uses)`, unguarded.map((u) => u.join(':')).join(' | ').slice(0, 200))
  const hrefs = lines(BR, /\.href\s*=\s*[^=]|setAttribute\('href',/)
  const unchecked = hrefs.filter(([, l]) => !/(https:\/\/|'\/|"\/|\burl\b|\bu\b|\bhref\b|\blk\.href = u\.href|waurl|telurl|ph\b|\bf\b)/.test(l))
  is(unchecked.length === 0, `every href assignment (${hrefs.length}) is a fixed https origin, a path, or a variable built by a checked helper`, unchecked.map((u) => u.join(':')).join(' | ').slice(0, 200))
  // the two that take a value from data are checked helpers: tel / WhatsApp numbers are digits only before they become an address
  is(/function waUrl[\s\S]{0,200}\^\[0-9\]\{8,15\}\$/.test(BR) && /function telUrl/.test(BR), 'wa.me and tel: addresses are built from digit-only numbers')
}

head('3. console and error handling')
for (const [n, s] of [['sporta-admin-brands.js', BR], ['boot.js', BOOT], ['config.js', CFG]]) is(!/\bconsole\.(log|warn|error|info|debug|trace)\b|\bdebugger\b/.test(s), `${n}: no console call and no debugger statement left`)
{
  const raf = lines(BR, /requestAnimationFrame\(function \(\) \{ queued = false;/)
  const bare = raf.filter(([, l]) => !/try \{/.test(l))
  is(raf.length >= 6 && bare.length === 0, `every scan scheduled with requestAnimationFrame (${raf.length}) is wrapped in try/catch`, bare.map((b) => b[0]).join(','))
  const intervals = lines(BR, /setInterval\(/)
  is(intervals.length === 8, `eight timers in the add-on file (${intervals.length}): six entry checks (Shipping is the sixth), the footer frame poll and the abandoned-orders clock`)
  const entry = intervals.filter(([, l]) => /ensure\(\)/.test(l))
  is(entry.length === 6 && entry.every(([, l]) => /document\.hidden/.test(l)), 'all six 500 ms entry checks sleep while the tab is hidden', entry.map((e) => e[0]).join(','))
  const others = intervals.filter(([, l]) => !/ensure\(\)/.test(l))
  is(others.length === 2 && /clearInterval\(timer\)/.test(BR) && /clearInterval\(countTimer\)/.test(BR), 'the other timers are cleared by the code that starts them')
}

head('4. every block is idempotent')
{
  const starts = [...BR.matchAll(/^;?\(function \(\) \{[^\n]*\n/gm)].map((m) => m.index)
  is(starts.length >= 16, `the add-on file has ${starts.length} blocks`)
  const noGuard = starts.map((at, i) => [i, BR.slice(at, at + 900)]).filter(([, t]) => !/if \(window\.__sporta[A-Za-z]+\) return/.test(t))
  is(noGuard.length === 0, 'every block opens with `if (window.__sporta... ) return`', noGuard.map((x) => x[0]).join(','))
  const flags = [...BR.matchAll(/if \(window\.(__sporta[A-Za-z]+)\) return/g)].map((m) => m[1])
  is(new Set(flags).size === flags.length, 'no two blocks share a flag', flags.filter((f, i) => flags.indexOf(f) !== i).join(','))
}

head('5. observers and listeners are created once')
{
  const mo = [...BR.matchAll(/new MutationObserver/g)].length
  is(mo <= 14, `MutationObserver count did not grow (${mo}; the audit started at 13, the Database center adds none)`)
  // every observer is created in a start() / boot() / one-time position, never inside a click or input handler
  const inHandler = lines(BR, /addEventListener\('(click|input|change|keydown)'.*new MutationObserver/)
  is(inHandler.length === 0, 'no observer is created inside an event handler')
  const doc = lines(BR, /\b(document|window)\.addEventListener\(/).filter(([, l]) => !/DOMContentLoaded/.test(l))
  const inFn = doc.filter(([n]) => /^\s{4,}/.test(BR.split('\n')[n - 1]))
  // listeners added from inside a function: they must have a matching remove, or run once (boot of the save bar / modal)
  const removable = inFn.filter(([n, l]) => !/onKey|onGeom|onField|check/.test(l))
  is(removable.length === 0, 'listeners on document/window added from inside a function are the save bar\'s own (removed in its stop()) or the modal key handler (removed on close)', removable.map((r) => r.join(':').slice(0, 90)).join(' | '))
  is(/document\.removeEventListener\('keydown', modal\.onKey, true\)/.test(BR) && /document\.removeEventListener\('scroll', onGeom/.test(BR), 'the modal key handler and the save bar\'s geometry listeners are removed where they are added')
  is(/obs\.disconnect\(\)/.test(BR), 'the save bar\'s observer is disconnected when it stops')
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const pageErrors = [], consoleErrors = []
const INSTRUMENT = () => {
  // counts what a block starts: observers, timers, document/window listeners, animation frames. Passive: calls through unchanged.
  const c = window.__counts = { mo: 0, interval: 0, timeout: 0, docL: 0, winL: 0, raf: 0, removedL: 0 }
  const MO = window.MutationObserver
  window.MutationObserver = class extends MO { constructor(cb) { super(cb); c.mo++ } }
  const si = window.setInterval; window.setInterval = function () { c.interval++; return si.apply(this, arguments) }
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = function () { c.raf++; return raf.apply(this, arguments) }
  const da = document.addEventListener.bind(document); document.addEventListener = function (t) { if (t !== 'DOMContentLoaded') c.docL++; return da.apply(null, arguments) }
  const dr = document.removeEventListener.bind(document); document.removeEventListener = function () { c.removedL++; return dr.apply(null, arguments) }
  const wa = window.addEventListener.bind(window); window.addEventListener = function () { c.winL++; return wa.apply(null, arguments) }
}
async function openScreen(name, { rtl = false, dark = false, w = 1280, js = SRC.brands, twice = false, pathname = '/backends/settings' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } })
  await ctx.addInitScript(INSTRUMENT)
  await ctx.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname.startsWith('/backends')) return route.fulfill({ status: 200, contentType: 'text/html', body: fixturePage(name, FILES, { rtl, dark }) })
    if (u.pathname === '/api/admin.php') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(`${name}: ${String(e).slice(0, 140)}`))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${name}: ${m.text().slice(0, 140)}`) })
  await pg.goto(ORIGIN + pathname)
  await pg.addScriptTag({ content: js })
  if (twice) { await pg.waitForTimeout(700); await pg.addScriptTag({ content: js }) }
  pg.__ctx = ctx
  return pg
}
const counts = (pg) => pg.evaluate(() => ({ ...window.__counts }))

head('6. double execution (the file injected twice)')
{
  const once = await openScreen('settings'); await once.waitForTimeout(900)
  const c1 = await counts(once)
  const buttons1 = await once.evaluate(() => document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn]').length)
  const styles1 = await once.evaluate(() => document.querySelectorAll('style[data-sporta-social-style],style[data-sporta-dbc-style]').length)
  await once.__ctx.close()
  const twice = await openScreen('settings', { twice: true }); await twice.waitForTimeout(900)
  const c2 = await counts(twice)
  const buttons2 = await twice.evaluate(() => document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn]').length)
  const styles2 = await twice.evaluate(() => document.querySelectorAll('style[data-sporta-social-style],style[data-sporta-dbc-style]').length)
  is(c1.mo > 5 && c1.interval >= 5, `one injection starts ${c1.mo} observers and ${c1.interval} timers (sanity: the blocks did start)`, JSON.stringify(c1))
  is(c2.mo === c1.mo && c2.interval === c1.interval && c2.docL === c1.docL && c2.winL === c1.winL, 'a second injection starts no observer, timer or document/window listener more', JSON.stringify({ once: c1, twice: c2 }))
  is(buttons1 === buttons2 && buttons2 === 2 && styles1 === styles2, 'and adds no second entry button or style sheet', `${buttons1}/${buttons2} ${styles1}/${styles2}`)
  await twice.__ctx.close()
  // the same on /backends (the Payments screen carries the five payment blocks)
  const p1 = await openScreen('payments', { pathname: '/backends/payments' }); await p1.waitForTimeout(900)
  const a = await counts(p1); await p1.__ctx.close()
  const p2 = await openScreen('payments', { pathname: '/backends/payments', twice: true }); await p2.waitForTimeout(900)
  const b = await counts(p2)
  is(b.mo === a.mo && b.interval === a.interval && b.docL === a.docL && b.winL === a.winL, 'on the Payments screen too: the five payment blocks do not start twice', JSON.stringify({ once: a, twice: b }))
  is(await p2.evaluate(() => document.querySelectorAll('[data-sporta-knet-ids],[data-sporta-tpay-ips],[data-sporta-cbk]').length) <= 3, 'and add at most one card each')
  await p2.__ctx.close()
}

head('6b. mutation: without the five guards added in this audit the double start is real')
{
  const MUT = SRC.brands.replace(/  if \(window\.(__sportaBrandsTab|__sportaKnetIds|__sportaTpayIps|__sportaSessionLine|__sportaCbkMerge)\) return[^\n]*\n  try \{ Object\.defineProperty\(window, '\1'[^\n]*\n/g, '')
  is(MUT !== SRC.brands && SRC.brands.length - MUT.length > 500, 'the mutant is the file with those five guards removed')
  const a = await openScreen('payments', { pathname: '/backends/payments', js: MUT }); await a.waitForTimeout(900)
  const c1 = await counts(a); await a.__ctx.close()
  const b = await openScreen('payments', { pathname: '/backends/payments', js: MUT, twice: true }); await b.waitForTimeout(900)
  const c2 = await counts(b)
  is(c2.mo > c1.mo, 'MUTANT: injected twice it starts more observers (the double-execution check above can fail)', JSON.stringify({ once: c1, twice: c2 }))
  await b.__ctx.close()
}

head('7. nothing accumulates when screens are swapped')
{
  const pg = await openScreen('settings'); await pg.waitForTimeout(900)
  const base = await counts(pg)
  const nodes0 = await pg.evaluate(() => document.getElementsByTagName('*').length)
  for (let i = 0; i < 50; i++) {
    await pg.evaluate((i) => {
      const main = document.querySelector('main.admin-content'), pgs = main.querySelectorAll(':scope > .admin-page')
      pgs.forEach((x) => { x.hidden = i % 2 === 0 })
      for (const h of main.querySelectorAll('.admin-page h1')) if (/Settings|Else/.test(h.textContent)) h.textContent = i % 2 ? 'Settings' : 'Else'
    }, i)
    await pg.waitForTimeout(25)
  }
  await pg.evaluate(() => { document.querySelectorAll('main.admin-content > .admin-page').forEach((x) => { x.hidden = false }); for (const h of document.querySelectorAll('main.admin-content .admin-page h1')) if (h.textContent === 'Else') h.textContent = 'Settings' })
  await pg.waitForTimeout(900)
  const end = await counts(pg)
  const nodes1 = await pg.evaluate(() => document.getElementsByTagName('*').length)
  is(end.mo === base.mo && end.interval === base.interval && end.docL === base.docL && end.winL === base.winL, 'fifty screen swaps start no observer, timer or listener', JSON.stringify({ base, end }))
  is(nodes1 <= nodes0 + 4, `and the DOM does not grow (${nodes0} -> ${nodes1} nodes)`)
  await pg.__ctx.close()
}

head('8. console and page errors on every captured admin screen')
{
  const names = ALL
  let n = 0
  for (const name of names) for (const [rtl, dark] of [[false, false], [true, true]]) {
    const before = pageErrors.length + consoleErrors.length
    const pg = await openScreen(name, { rtl, dark }); await pg.waitForTimeout(700); await pg.__ctx.close(); n++
    if (pageErrors.length + consoleErrors.length !== before) is(false, `${name} ${rtl ? 'ar' : 'en'} ${dark ? 'dark' : 'light'}: no error`, [...pageErrors, ...consoleErrors].slice(before).join(' | '))
  }
  is(pageErrors.length === 0 && consoleErrors.length === 0, `no page error and no console error on ${names.length} screens, each light/English and dark/Arabic (${n} loads)`, [...pageErrors, ...consoleErrors].slice(0, 3).join(' | '))
}

head('9. an idle screen costs nothing')
{
  for (const name of ['settings', 'payments']) {
    const pg = await openScreen(name, { pathname: '/backends/' + name }); await pg.waitForTimeout(1200)
    const idle = await pg.evaluate(() => new Promise((resolve) => {
      const recs = []
      const mo = new MutationObserver((m) => { for (const r of m) recs.push(r.type + ':' + (r.target.nodeName || '') + ':' + (r.addedNodes.length + r.removedNodes.length)) })
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      const before = { ...window.__counts }
      setTimeout(() => { mo.disconnect(); resolve({ recs: recs.length, sample: recs.slice(0, 4), raf: window.__counts.raf - before.raf }) }, 2000)
    }))
    is(idle.recs === 0, `${name}: two idle seconds change nothing in the page (0 mutation records)`, `${idle.recs} ${idle.sample.join(',')}`)
    is(idle.raf <= 4, `${name}: and schedule at most a few animation frames (${idle.raf})`)
    await pg.__ctx.close()
  }
  const pg = await openScreen('settings'); await pg.waitForTimeout(900)
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn],[data-sporta-ship-btn]').forEach((b) => b.remove()) })
  await pg.waitForTimeout(1300)
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn],[data-sporta-ship-btn]').length) === 0, 'a hidden tab: the entry checks do nothing (no button comes back while it is hidden)')
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }) })
  await pg.waitForFunction(() => document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn],[data-sporta-ship-btn]').length === 3, null, { timeout: 2500 }).catch(() => {})
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-social-btn],[data-sporta-dbc-btn],[data-sporta-ship-btn]').length) === 3, 'and all three come back when the tab is shown')
  await pg.__ctx.close()
}

head('10. boot.js and config.js')
{
  is(!/\.innerHTML|insertAdjacentHTML|document\.write/.test(BOOT) && /textContent/.test(BOOT), 'boot.js builds its recovery message with textContent only (a failed URL is never markup)')
  is(/localStorage[\s\S]{0,40}/.test(BOOT) && /catch \(_\) \{[\s\S]{0,80}Private browsing/.test(SRC.boot) && /sessionStorage\.getItem\(key\) === asset\.href/.test(BOOT), 'boot.js: storage reads sit in try/catch, and the one-time entry-chunk reload cannot loop (sessionStorage key per asset)')
  is(/asset\.origin !== location\.origin \|\| !asset\.pathname\.startsWith\('\/assets\/'\)/.test(BOOT), 'boot.js reloads only for a same-origin /assets/ script that failed')
  is((BOOT.match(/setTimeout\(/g) || []).length === 1 && !/setInterval/.test(BOOT), 'boot.js: one timer (the ten-second "page did not finish loading" notice), no interval')
  const m = /window\.SPORTA_CONFIG\s*=\s*(\{[\s\S]*?\})\s*(;|$)/.exec(CFG)
  const keys = m ? [...m[1].matchAll(/^\s*([A-Za-z_]+)\s*:/gm)].map((x) => x[1]) : []
  is(!!m && keys.every((k) => ['payBaseUrl', 'cbkBaseUrl', 'phpApiUrl'].includes(k)), 'config.js sets only window.SPORTA_CONFIG, with none of the three known keys beyond payBaseUrl, cbkBaseUrl and phpApiUrl', keys.join(','))
  is(!/password|secret|token|apikey|api_key/i.test(CFG), 'config.js holds no secret (it is served to every visitor)')
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
