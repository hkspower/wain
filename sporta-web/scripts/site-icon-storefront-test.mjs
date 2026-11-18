// The storefront's side of the SITE ICON (2026-11-18): the SITE CONTENT block of public/sporta-features.js points the page's icon links at the favicon the owner
// picked in the SEO screen. The pages the SEO renderer serves already carry them; this is for the pages it does not (the cart, the checkout, the account
// pages are served from the shell) and for a visit that starts from the copy the browser kept.
//
//   npm run test:site-icon-storefront
//
// Asserted: the answer of ?r=content carries {site_icon: {v, urls}} and the three links (32 tab, 192 large, 180 apple-touch) are rewritten to those URLs, no
// link is added when the shell has them, and one is made when the shell lacks it; a kept copy is applied at once and on a page the block leaves alone
// (/cart: nothing is asked for there); only the exact URL shape the server writes is accepted (an off-site address, another version, another size, an extra
// field: ignored, the page keeps its icons); when the owner goes back to the Sporta icon the links are put back (and a link the block made is removed);
// nothing else about the page changes; and with the rule cut out the matching check goes red.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FEATURES = readFileSync(join(ROOT, 'public', 'sporta-features.js'), 'utf8')
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const ORIGIN = 'https://www.sporta.com.kw'
const V = '0123456789ab'
const urls = (v = V) => ({ 32: `/api/api.php?r=site_icon&s=32&v=${v}`, 180: `/api/api.php?r=site_icon&s=180&v=${v}`, 192: `/api/api.php?r=site_icon&s=192&v=${v}` })
const SHELL_LINKS = '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" /><link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" /><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />'
const page = (links = SHELL_LINKS) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Sporta</title>${links}</head><body><main id="main"><h1>Hello</h1></main></body></html>`
const links = (pg) => pg.evaluate(() => [...document.head.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map((l) => [l.getAttribute('rel'), l.getAttribute('sizes'), l.getAttribute('href'), l.hasAttribute('data-sporta-icon-orig')]))
const hrefOf = (ls, rel, sizes) => (ls.find((l) => l[0] === rel && (sizes === undefined || l[1] === sizes)) || [])[2]

async function open({ path = '/', answer, kept, shell = SHELL_LINKS, js = FEATURES, status = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  const asked = []
  if (kept) await ctx.addInitScript((k) => { try { localStorage.setItem('sporta_content_v1', JSON.stringify(k)) } catch (e) { /* ignore */ } }, kept)
  await ctx.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'content') { asked.push(u.search); return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(answer ?? {}) }) }
    if (u.pathname === '/api/api.php' || u.pathname.startsWith('/images') || u.pathname.endsWith('.png') || u.pathname.endsWith('.css')) return route.fulfill({ status: 404, body: 'nf' })
    return route.fulfill({ status: 200, contentType: 'text/html', body: page(shell) })
  })
  const pg = await ctx.newPage(), errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await pg.goto(ORIGIN + path)
  await pg.addScriptTag({ content: js })
  await pg.waitForTimeout(700)
  pg.__ctx = ctx; pg.__asked = asked; pg.__errs = errs
  return pg
}
const close = (pg) => pg.__ctx.close()
const doc = (over = {}) => ({ v: 3, overrides: [], contact: {}, returns: {}, site_icon: { v: V, urls: urls() }, ...over })

head('the answer carries the icon')
{
  const pg = await open({ answer: doc() })
  const ls = await links(pg)
  is(ls.length === 3 && hrefOf(ls, 'icon', '32x32') === urls()[32] && hrefOf(ls, 'icon', '192x192') === urls()[192] && hrefOf(ls, 'apple-touch-icon') === urls()[180], 'the three links of the shell now point at the custom icon', JSON.stringify(ls.map((l) => l[2])))
  is(pg.__asked.length === 1, 'one request for the answer, none more for the icon (the picture is fetched by the browser from the link)', String(pg.__asked.length))
  is(ls.every((l) => l[3] === true), 'each link remembers what it had (to put it back)')
  is(pg.__errs.length === 0, 'no page errors', pg.__errs.join(' | '))
  await close(pg)
}
{
  const pg = await open({ answer: doc(), shell: '' })
  const ls = await links(pg)
  is(ls.length === 3 && hrefOf(ls, 'icon', '32x32') === urls()[32] && hrefOf(ls, 'apple-touch-icon') === urls()[180], 'a shell with no icon links gets the three made', JSON.stringify(ls))
  await close(pg)
}
{
  const pg = await open({ answer: { v: 1, overrides: [], contact: {}, site_icon: null } })
  const ls = await links(pg)
  is(JSON.stringify(ls.map((l) => l[2])) === '["/favicon-32.png","/favicon-192.png","/apple-touch-icon.png"]' && ls.every((l) => l[3] === false), 'no custom icon (null): the links are exactly the shell\'s', JSON.stringify(ls.map((l) => l[2])))
  await close(pg)
}
{
  const pg = await open({ answer: { v: 1, overrides: [], contact: {} } })
  is((await links(pg)).map((l) => l[2]).join() === '/favicon-32.png,/favicon-192.png,/apple-touch-icon.png', 'an answer from a server that does not know the field changes nothing')
  await close(pg)
}

head('the kept copy, and the pages the block leaves alone')
{
  const pg = await open({ path: '/cart', kept: doc(), answer: doc() })
  const ls = await links(pg)
  is(hrefOf(ls, 'apple-touch-icon') === urls()[180] && hrefOf(ls, 'icon', '32x32') === urls()[32], '/cart: the kept copy is applied at once')
  is(pg.__asked.length === 0, '/cart: and nothing is asked for (the block leaves that page alone)', String(pg.__asked.length))
  await close(pg)
}
{
  const pg = await open({ kept: doc(), answer: doc() })
  is(hrefOf(await links(pg), 'apple-touch-icon') === urls()[180], 'a normal page: the kept copy and the fresh answer agree, one request', String(pg.__asked.length))
  await close(pg)
}
{
  const pg = await open({ kept: doc({ site_icon: { v: 'aaaaaaaaaaaa', urls: urls('aaaaaaaaaaaa') } }), answer: doc() })
  const ls = await links(pg)
  is(hrefOf(ls, 'apple-touch-icon') === urls()[180] && ls.length === 3, 'a newer version in the fresh answer replaces the kept one', JSON.stringify(ls.map((l) => l[2])))
  await close(pg)
}

head('hostile or damaged answers change nothing')
{
  const bad = [
    ['an off-site address', { v: V, urls: { ...urls(), 32: 'https://evil.example/x.png' } }],
    ['a javascript: address', { v: V, urls: { ...urls(), 192: 'javascript:alert(1)' } }],
    ['another version in a URL', { v: V, urls: { ...urls(), 180: urls('ffffffffffff')[180] } }],
    ['a version that is not 12 hex', { v: 'ZZZZZZZZZZZZ', urls: urls('ZZZZZZZZZZZZ') }],
    ['a missing size', { v: V, urls: { 32: urls()[32], 180: urls()[180] } }],
    ['a string instead of an object', 'x'],
    ['a path with a query that carries more', { v: V, urls: { ...urls(), 32: urls()[32] + '&x=<script>' } }],
  ]
  for (const [label, ic] of bad) {
    const pg = await open({ answer: { v: 1, overrides: [], contact: {}, site_icon: ic } })
    const ls = await links(pg)
    is(ls.map((l) => l[2]).join() === '/favicon-32.png,/favicon-192.png,/apple-touch-icon.png', `${label}: ignored, the page keeps its icons`, ls.map((l) => l[2]).join())
    await close(pg)
  }
}

{
  // an extra, unknown size beside the three exact ones is simply not read: the three are applied, nothing else is made
  const pg = await open({ answer: { v: 1, overrides: [], contact: {}, site_icon: { v: V, urls: { ...urls(), 64: '/api/api.php?r=site_icon&s=64&v=' + V } } } })
  const ls = await links(pg)
  is(ls.length === 3 && hrefOf(ls, 'apple-touch-icon') === urls()[180], 'an extra size in the answer is not read: the three exact ones apply and no fourth link appears', JSON.stringify(ls.map((l) => l[2])))
  await close(pg)
}

head('back to the Sporta icon')
{
  const pg = await open({ kept: doc(), answer: { v: 1, overrides: [], contact: {}, site_icon: null } })
  const ls = await links(pg)
  is(ls.map((l) => l[2]).join() === '/favicon-32.png,/favicon-192.png,/apple-touch-icon.png' && ls.every((l) => l[3] === false), 'a kept copy that still names a favicon and a fresh answer that does not: the links are put back', ls.map((l) => l[2]).join())
  await close(pg)
  const p2 = await open({ shell: '', kept: doc(), answer: { v: 1, overrides: [], contact: {}, site_icon: null } })
  is((await links(p2)).length === 0, 'and the links the block had made are removed again (the shell had none)')
  await close(p2)
}

head('mutations: with one rule cut, the matching check goes red')
const MUT = [
  ['without the URL shape check', FEATURES.replace("if (okUrl('32') && okUrl('180') && okUrl('192')) out.site_icon", 'if (true) out.site_icon'),
    async () => { const pg = await open({ answer: { v: 1, overrides: [], contact: {}, site_icon: { v: V, urls: { ...urls(), 32: 'https://evil.example/x.png' } } }, js: null }); return null }],
  ['without applying the kept copy at start', FEATURES.replace("applyIcon()   // from the kept copy, before anything is asked: also on the pages this block otherwise leaves alone", ''),
    async (js) => { const pg = await open({ path: '/cart', kept: doc(), answer: doc(), js }); const ok = hrefOf(await links(pg), 'apple-touch-icon') === urls()[180]; await close(pg); return ok }],
  ['without putting the links back', FEATURES.replace('else { kept[k].setAttribute(\'href\', orig); kept[k].removeAttribute(\'data-sporta-icon-orig\') }', ''),
    async (js) => { const pg = await open({ kept: doc(), answer: { v: 1, overrides: [], contact: {}, site_icon: null }, js }); const ok = (await links(pg)).map((l) => l[2]).join() === '/favicon-32.png,/favicon-192.png,/apple-touch-icon.png'; await close(pg); return ok }],
]
// the first mutant needs the hostile answer served through the cut file
MUT[0][2] = async (js) => { const pg = await open({ answer: { v: 1, overrides: [], contact: {}, site_icon: { v: V, urls: { ...urls(), 32: 'https://evil.example/x.png' } } }, js }); const ok = (await links(pg)).map((l) => l[2]).join() === '/favicon-32.png,/favicon-192.png,/apple-touch-icon.png'; await close(pg); return ok }
for (const [label, text, check] of MUT) {
  if (text === FEATURES) { is(false, `mutation "${label}": the cut text was found`); continue }
  const good = await check(FEATURES), bad = await check(text)
  is(good === true, `mutation "${label}": the check passes on the real file`, String(good))
  is(bad === false, `mutation "${label}": and goes red with the rule cut`, String(bad))
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
