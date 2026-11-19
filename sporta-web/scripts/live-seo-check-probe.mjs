// READ-ONLY live probe of the SEO LIVE CHECK card (2026-11-19): runs the block of public/sporta-admin-brands.js against the REAL site, from a browser on the VPS.
//
//   SHA=<pushed commit> node live-seo-check-probe.mjs        (in mcr.microsoft.com/playwright:v1.49.0-noble, `npm i playwright@1.49.0` first)
//
// How: it opens https://www.sporta.com.kw/robots.txt (a plain text page of the real origin), changes the address bar to /backends/seo with history.replaceState,
// adds the markup of the SEO Editor's header, injects ONLY the ADMIN SEO LIVE CHECK block (read from GitHub at SHA; the page's CSP is bypassed for the injection,
// nothing else is) and presses "Check live pages". The block then makes the same GET requests it makes in the admin: robots.txt, the sitemaps and every listed
// page, without cookies. Nothing is submitted, signed in or written. It prints the card's own findings: tiles, files and the pages with problems.
import { chromium } from 'playwright'

const SHA = process.env.SHA
if (!/^[0-9a-f]{40}$/.test(SHA || '')) { console.log('PROBE_FAIL set SHA to a full pushed commit'); process.exit(1) }
const raw = (path) => 'https://raw.githubusercontent.com/hkspower/wain/' + SHA + '/sporta-web/' + path
const full = await (await fetch(raw('public/sporta-admin-brands.js'))).text()
const a = full.indexOf('/* ===== ADMIN SEO LIVE CHECK - begin'), z = full.indexOf('/* ===== ADMIN SEO LIVE CHECK - end')
if (a < 0 || z < a) { console.log('PROBE_FAIL the block is not in the file at that commit'); process.exit(1) }
const block = full.slice(a, full.indexOf('*/', z) + 2)
console.log('block ' + block.length + ' bytes from ' + SHA.slice(0, 7))

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))
const reqs = []
page.on('request', (r) => { try { const u = new URL(r.url()); if (u.host === 'www.sporta.com.kw') reqs.push(r.method() + ' ' + u.pathname + u.search) } catch (e) { /* not a URL */ } })
await page.goto('https://www.sporta.com.kw/robots.txt', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  history.replaceState(null, '', '/backends/seo')
  document.documentElement.setAttribute('lang', 'en')
  const s = document.createElement('section'); s.className = 'admin-page seo-editor'
  s.innerHTML = '<div class="admin-page-header"><h1>SEO Editor</h1></div>'
  document.body.appendChild(s)
})
await page.addScriptTag({ content: block })
await page.waitForSelector('[data-sporta-slc]', { timeout: 6000 })
const before = reqs.length
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-sporta-slc] .slc-btn')].find((x) => /Check live pages/.test(x.textContent)); b.click() })
const t0 = Date.now()
const ok = await page.waitForFunction(() => /Checked \d+ pages|Stopped|could not finish/.test(document.querySelector('[data-sporta-slc] .slc-status')?.textContent || ''), null, { timeout: 150000 }).then(() => true, () => false)
console.log('finished ' + ok + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s; requests made by the card: ' + (reqs.length - before) + ', methods: ' + [...new Set(reqs.slice(before).map((r) => r.split(' ')[0]))].join(','))
const out = await page.evaluate(() => {
  const c = document.querySelector('[data-sporta-slc]')
  const rows = (i) => [...c.querySelectorAll('.slc-list')[i].querySelectorAll(':scope > li')].map((li) => ({
    path: li.querySelector('.slc-path').textContent, w: li.querySelector('details').getAttribute('data-w'), chips: [...li.querySelectorAll('.slc-chip')].map((x) => x.textContent).join('/'),
    issues: [...li.querySelectorAll('.slc-iss li')].map((x) => x.getAttribute('data-sev') + ': ' + x.querySelector('span').textContent)
  }))
  return { status: c.querySelector('.slc-status').textContent, tiles: [...c.querySelectorAll('.slc-tile')].map((t) => t.innerText.replace(/\s+/g, ' ')), files: rows(0), pages: c.querySelectorAll('.slc-list')[1] ? rows(1) : [], only: c.querySelector('.slc-only input')?.checked }
})
console.log('STATUS ' + out.status)
console.log('TILES ' + out.tiles.join(' | '))
for (const f of out.files) console.log('FILE ' + f.path + ' [' + f.w + '] ' + f.chips + (f.issues.length ? '  -> ' + f.issues.join(' ; ') : ''))
// the list is cut to pages with problems by default; show the first 60 of what is listed, then the clean count
const bad = out.pages.filter((p) => p.w !== 'ok')
console.log('PAGES shown ' + out.pages.length + ' (filter on: ' + out.only + '), with problems ' + bad.length)
for (const p of bad.slice(0, 60)) console.log('PAGE ' + p.path + ' [' + p.w + '] ' + p.chips + '  -> ' + p.issues.filter((i) => !/^info/.test(i)).join(' ; '))
// every issue kind, counted
const kinds = {}
for (const p of out.pages) for (const i of p.issues) { const k = i.replace(/[0-9]+/g, 'N').slice(0, 70); kinds[k] = (kinds[k] || 0) + 1 }
console.log('KINDS ' + JSON.stringify(kinds))
console.log('PAGE_ERRORS ' + errs.length + (errs.length ? ' ' + errs.join(' | ') : ''))
await browser.close()
console.log('PROBE_DONE')
