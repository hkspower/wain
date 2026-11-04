#!/usr/bin/env node
// ADMIN CODE SPLITTING + THE PROFILES SCREEN, in a real browser against a real build.
//
//   npm run test:profiles-split
//
// Rig-free: it builds the current tree into a SCRATCH directory (never dist/), serves it from its own Node
// server on a port the OS picks, and answers /api/admin.php from a mock (scripts/lib/admin-mock-server.mjs:
// made-up customers, no database, no PHP, no shared test rig). Sign-in is out of scope: `me` answers 200.
//
// WHAT IS PROVEN
//   Build     every admin screen (Overview, Orders, Profiles, Catalogue, Brands, Slides, Promotions, Discounts,
//             Inventory, Settings) is its own chunk; no chunk imports a screen chunk statically (so none of them
//             rides along with the shell or with another screen); AdminApp is the shell only, and its size
//             before (112,044 bytes at b9c60cbc, measured) and after is printed raw / gzip / brotli.
//             SPLIT_BASELINE_REF=<git ref> rebuilds that ref and prints the first load of /backends before and after.
//   Precache  scripts/sw-precache.mjs keeps every admin chunk (shell, ten screens, API client, notice box, image helper,
//             stylesheet) out of the service worker's install for shoppers, and keeps every storefront chunk in.
//   Loading   opening /backends requests the shell and the FIRST tab's chunk, nothing else; every other chunk
//             (Profiles included) is requested only when its tab shows intent (hover, focus, touch) or is opened,
//             and exactly once however often the tab is visited; a deep link from the Overview alerts still lands
//             on Orders with its filter.
//   Profiles  the list renders the mock rows 20 a page and pages forward and back; search waits for a pause in
//             typing (one request per pause, none while typing), resets to page 1, goes out as UTF-8, and a request
//             the next query made pointless is ABORTED (the server sees the connection close) and can never land
//             on the newer results; Enter searches at once; the empty state, a 429 (with the server's
//             retry_after), a 500, a 401 and a 404 each show their own message, and Try again recovers; a profile
//             opens (account, delivery addresses used, orders), takes focus, Escape / Back returns to the same
//             search with no new request and focus on the row; names that are markup stay text; Arabic names are
//             dir="auto"; nothing read from the server reaches localStorage, sessionStorage or the console; every
//             request carries X-Sporta-Admin.
//   Enum      (added in review) an order whose payment method or status reads "__proto__", "constructor" or
//             "toString" is shown as text; it used to turn the whole profile into "Profiles stopped working".
//   Storage   (added in review) with the service worker ON, as in production, nothing from /api/admin.php (customer
//             names, emails, phones, addresses) is left in Cache Storage. True today only because public/sw.js clones
//             the response too late; the mutant below shows what a "fixed" worker would store.
//   Failure   a chunk that will not load shows a retry (and a reload button), does not loop, recovers on "Try
//             again" once it can load, and leaving the screen and coming back tries it afresh.
//   Fallback  while a chunk travels the content area holds at least 70vh (the shell does not move, layout shift stays
//             in Google's "good" band).
//   Layout    at 390 (touch, light, Arabic/RTL and English/LTR) and 768/1280: no horizontal page overflow with a
//             70-character email, every tap target in the screen is at least 40px, the search box is 16px, cards
//             replace the table on the phone.
//   MUTATION  thirteen mutants are built and run: Profiles imported eagerly, a screen importing another
//             screen, search without its pause, without its abort, names without dir="auto", a retry that retries
//             nothing, tabs that no longer warm their chunk, a first tab fetched only after the session check, a
//             table frame that lets the page widen, a fallback with no height, a precache script that skips the
//             admin by name again, a plain table lookup for the payment method (the "__proto__" crash), and a
//             service worker that does cache what it fetches. Each must fail the check(s) that guard it.
//
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium-1243/chrome-linux64/chrome), SPLIT_SCRATCH (where the
// builds go; default the OS temp dir), SPLIT_KEEP=1 keeps them, SPLIT_BASELINE_REF=<ref> adds the before/after table,
// SPLIT_SKIP_MUTANTS=1 skips the mutant builds, SPLIT_MUTANTS_ONLY=1 runs nothing but them, SPLIT_ONLY_MUTANT=<label> runs one.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib'
import { XSS_NAME, startMockAdmin } from './lib/admin-mock-server.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js')
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : undefined)
const BEFORE_ADMINAPP_RAW = 112044 // bytes: vite build of b9c60cbc (all eight screens in the AdminApp chunk)

// ------------------------------------------------------------------- reporting
let pass = 0, fail = 0
let sink = null // while set, results are collected (a mutant run), not printed
const is = (ok, msg, detail = '') => {
  if (sink) { sink.push({ ok: !!ok, msg }); return }
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
async function until(fn, ms = 8000, step = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return false
    await sleep(step)
  }
}
const kb = (n) => (n / 1000).toFixed(2) + ' kB'

// --------------------------------------------------------------------- scratch
const SCRATCH = await mkdtemp(join(process.env.SPLIT_SCRATCH || tmpdir(), 'profiles-split-'))
const cleanup = async () => { if (!process.env.SPLIT_KEEP) await rm(SCRATCH, { recursive: true, force: true }).catch(() => {}) }

function build(root, outDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')))
  execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: root, env, stdio: 'pipe', maxBuffer: 64 << 20 })
}

// A copy of the source tree with edits applied, for a mutant. src/ and the top-level FILES (index.html, the
// configs, tailwind.config.js ...) are copied: Vite resolves a symlinked index.html to its real path outside the
// root and refuses to emit it. The top-level DIRECTORIES (node_modules, public, scripts ...) are linked.
async function mutantRoot(label, edits) {
  const dir = join(SCRATCH, 'mut-' + label)
  await mkdir(dir, { recursive: true })
  await cp(join(ROOT, 'src'), join(dir, 'src'), { recursive: true })
  for (const ent of readdirSync(ROOT, { withFileTypes: true })) {
    const name = ent.name
    if (['src', 'dist', '.git'].includes(name) || name.startsWith('.env')) continue
    if (ent.isDirectory()) await symlink(join(ROOT, name), join(dir, name))
    else await cp(join(ROOT, name), join(dir, name))
  }
  for (const { file, from, to, all } of edits) {
    const p = join(dir, file)
    const text = await readFile(p, 'utf8')
    const n = text.split(from).length - 1
    if (n === 0 || (!all && n !== 1)) throw new Error(`mutant ${label}: ${JSON.stringify(from.slice(0, 60))} found ${n} times in ${file}`)
    await writeFile(p, all ? text.split(from).join(to) : text.replace(from, () => to))
  }
  return dir
}

// ----------------------------------------------------------------- build facts
const brotli = (buf) => brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length
const gz = (buf) => gzipSync(buf, { level: 9 }).length

function analyse(dist) {
  const dir = join(dist, 'assets')
  const chunks = {}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const buf = readFileSync(join(dir, f))
    const src = buf.toString('utf8')
    chunks[f] = {
      file: f,
      name: f.replace(/-[A-Za-z0-9_-]{8}\.js$/, ''),
      raw: buf.length, gz: gz(buf), br: brotli(buf), src,
      statics: [...src.matchAll(/(?:from|import)\s*["']\.\/([\w.~@-]+\.js)["']/g)].map((m) => m[1]),
      dynamics: [...src.matchAll(/import\(\s*[`"']\.\/([\w.~@-]+\.js)[`"']\s*\)/g)].map((m) => m[1]),
    }
  }
  return chunks
}
const SCREENS = [
  // id, tab label, heading, intent used to warm it in the loading test
  ['overview', 'Overview', 'Overview', null],
  ['orders', 'Orders', 'Orders', 'hover'],
  ['profiles', 'Profiles', 'Profiles', 'click'],
  ['catalog', 'Catalogue', 'Catalogue', 'focus'],
  ['brands', 'Brands', 'Brands', 'touch'],
  ['slides', 'Slides', 'Home slides', 'click'],
  ['promos', 'Promotions', 'Promotions', 'click'],
  ['discounts', 'Discounts', 'Discounts', 'click'],
  ['stock', 'Inventory', 'Inventory', 'click'],
  ['settings', 'Settings', 'Settings', 'click'],
]
const CHUNK_OF = { overview: 'Overview', orders: 'Orders', profiles: 'Profiles', catalog: 'Catalog', brands: 'Brands', slides: 'Slides', promos: 'Promotions', discounts: 'Discounts', stock: 'Inventory', settings: 'Settings' }
const SCREEN_CHUNKS = Object.values(CHUNK_OF)
const byName = (chunks, name) => Object.values(chunks).filter((c) => c.name === name)

function staticChecks(chunks, tag = '') {
  const t = (s) => (tag ? `${s} [${tag}]` : s)
  const own = SCREEN_CHUNKS.map((n) => byName(chunks, n))
  is(own.every((l) => l.length === 1), t('every one of the ten screens is its own chunk'), SCREEN_CHUNKS.filter((n, i) => own[i].length !== 1).join(', ') + ' missing')
  const screenFiles = new Set(own.flat().map((c) => c.file))
  const importers = Object.values(chunks).filter((c) => c.statics.some((s) => screenFiles.has(s)))
  is(importers.length === 0, t('no chunk imports a screen chunk statically (a screen cannot ride along with the shell or another screen)'), importers.map((c) => `${c.name} -> ${c.statics.filter((s) => screenFiles.has(s)).join()}`).join('; '))
  const dyn = new Set(Object.values(chunks).flatMap((c) => c.dynamics))
  is([...screenFiles].every((f) => dyn.has(f)), t('every screen chunk is reached by import(), including Profiles'), [...screenFiles].filter((f) => !dyn.has(f)).join())
  const app = byName(chunks, 'AdminApp')[0]
  is(!!app, t('an AdminApp chunk exists'))
  if (app) {
    is(app.raw <= BEFORE_ADMINAPP_RAW * 0.2, t(`AdminApp is the shell only: ${kb(app.raw)} raw, at most 20% of the ${kb(BEFORE_ADMINAPP_RAW)} it was`), `${app.raw} bytes`)
    is(!app.src.includes('Name, email or phone'), t('the Profiles screen\'s code is not in the AdminApp chunk'))
  }
  const holders = Object.values(chunks).filter((c) => c.src.includes('Name, email or phone'))
  is(holders.length === 1 && holders[0].name === 'Profiles', t('the Profiles screen\'s code exists in exactly one chunk, its own'), holders.map((c) => c.name).join())
  return { app }
}

// ------------------------------------------------------------------- browser
async function newPage(browser, server, { w = 1280, h = 800, phone = false, rtl = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block', locale: 'en-GB' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const seen = { errors: [], console: [] }
  page.on('pageerror', (e) => seen.errors.push(e.message))
  page.on('console', (m) => seen.console.push(`${m.type()}: ${m.text()}`))
  // Nothing outside this server: fonts and the like are not under test, and a request to the internet is a leak.
  await page.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort())
  await page.goto(`${server.origin}/backends${rtl ? '' : '?lang=en'}`, { waitUntil: 'load' })
  return { ctx, page, seen }
}
const chunkCount = (server, name) => server.log.filter((e) => e.path.startsWith(`/assets/${name}-`) && e.path.endsWith('.js')).length
const requestedChunks = (server) => [...new Set(server.log.filter((e) => e.path.startsWith('/assets/') && e.path.endsWith('.js')).map((e) => e.path.slice(8).replace(/-[A-Za-z0-9_-]{8}\.js$/, '')))]
const listReqs = (server) => server.log.filter((e) => e.path === '/api/admin.php' && e.query.includes('r=profiles_list'))
const heading = (page, text) => page.locator('main').getByRole('heading', { name: text, exact: true })
const sideTab = (page, label) => page.locator('aside nav').getByRole('button', { name: label, exact: true })
const rows = (page) => page.locator('[data-profiles-list] tbody tr')

// ------------------------------------------------------------------ the groups
async function groupLoading(browser, server) {
  head('Loading: the shell and one tab on open, every other chunk on intent')
  const { ctx, page, seen } = await newPage(browser, server)
  await heading(page, 'Overview').waitFor()
  const opened = requestedChunks(server)
  const otherScreens = SCREEN_CHUNKS.filter((n) => n !== 'Overview')
  is(opened.includes('AdminApp') && opened.includes('Overview'), 'opening /backends requests the AdminApp shell and the first tab (Overview)', opened.join())
  is(otherScreens.every((n) => !opened.includes(n)), 'opening /backends requests no other screen\'s chunk', opened.filter((n) => otherScreens.includes(n)).join())
  is(!opened.includes('downscaleImage'), 'the image-resize helper (Brands and Slides only) is not requested on open')
  is(listReqs(server).length === 0, 'opening /backends does not ask for the profile list')

  // The first tab's chunk travels BESIDE the session check, not after it (else: AdminApp, then `me`, then Overview).
  {
    const s2 = await startMockAdmin({ distDir: server.distDir })
    s2.state.meDelay = 900
    const w = await newPage(browser, s2)
    await heading(w.page, 'Overview').waitFor()
    const me = s2.log.filter((e) => e.query.includes('r=me')).at(-1)
    const ov = s2.log.filter((e) => e.path.startsWith('/assets/Overview-')).at(-1)
    is(ov && me && ov.t0 < me.t1 - 400, 'the first tab\'s chunk is requested while the session check is still out (not after it answers)', ov && me ? `Overview asked at +${ov.t0 - me.t0}ms, me answered at +${me.t1 - me.t0}ms` : 'missing entries')
    await w.ctx.close()
    await s2.close()
  }
  let current = 'Overview'
  for (const [id, label, h, intent] of SCREENS.filter((s) => s[3])) {
    const name = CHUNK_OF[id]
    const tab = sideTab(page, label)
    is(chunkCount(server, name) === 0, `${name}: not requested before its tab shows intent`)
    if (intent === 'hover') await tab.hover()
    else if (intent === 'focus') await tab.focus()
    else if (intent === 'touch') await tab.dispatchEvent('touchstart')
    else await tab.hover()
    if (intent !== 'click') {
      const warmed = await until(() => chunkCount(server, name) >= 1, 6000)
      is(warmed, `${name}: ${intent === 'hover' ? 'hovering' : intent === 'focus' ? 'focusing' : 'touching'} its tab fetches its chunk ahead of the click`)
      is(await heading(page, current).isVisible(), `${name}: warming does not navigate (${current} is still open)`)
    }
    await tab.click()
    await heading(page, h).waitFor()
    current = h
    is(true, `${name}: its tab opens the screen ("${h}")`)
    is(chunkCount(server, name) === 1, `${name}: its chunk was requested exactly once`, `${chunkCount(server, name)} requests`)
    if (id === 'profiles') is(listReqs(server).length === 1, 'Profiles: opening the tab asks for the list once')
    if (id === 'orders') is(!requestedChunks(server).includes('downscaleImage'), 'Orders: opening it does not fetch the image helper')
  }
  // Back to tabs already loaded: no second request, no Suspense flash.
  await sideTab(page, 'Overview').click()
  await heading(page, 'Overview').waitFor()
  await sideTab(page, 'Orders').click()
  await heading(page, 'Orders').waitFor()
  is(SCREEN_CHUNKS.every((n) => chunkCount(server, n) === 1), 'every screen chunk was requested exactly once over the whole visit', SCREEN_CHUNKS.map((n) => `${n}:${chunkCount(server, n)}`).join(' '))
  is(requestedChunks(server).includes('downscaleImage'), 'the image helper was fetched once Brands/Slides were opened')
  is(seen.errors.length === 0, 'no page errors while walking every tab', seen.errors.join(' | '))
  await ctx.close()

  // The Overview alert -> Orders deep link, with its filter, as it worked before the split.
  const b = await newPage(browser, server)
  await heading(b.page, 'Overview').waitFor()
  server.log.length = 0
  await b.page.getByRole('button', { name: 'Show them' }).click()
  await heading(b.page, 'Orders').waitFor()
  is(await b.page.getByRole('button', { name: 'review', exact: true }).getAttribute('aria-pressed') === 'true', 'the Overview alert opens Orders on its "review" filter')
  is(await until(() => server.log.some((e) => e.query.includes('r=orders') && e.query.includes('payment=review')), 4000), 'and the orders request carries payment=review')
  await b.ctx.close()
}

async function groupProfiles(browser, server, only = null) {
  const on = (k) => !only || only.includes(k)
  head('Profiles: list, paging, search, states, detail')
  const { ctx, page, seen } = await newPage(browser, server)
  await heading(page, 'Overview').waitFor()
  const storageBefore = await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]))
  server.log.length = 0
  await sideTab(page, 'Profiles').click()
  await rows(page).first().waitFor()
  const P = server.profiles

  if (on('list')) {
    is(await rows(page).count() === 20, 'the first page shows 20 profiles', `${await rows(page).count()}`)
    const first = listReqs(server)[0]
    is(listReqs(server).length === 1 && first.page === 1 && first.q === '', 'one request: page 1, no search term')
    const t = await page.locator('[data-profiles-list] thead th').allTextContents()
    is(t.join('|') === 'Name|Email|Phone|Joined|Last login|Orders|Paid|Last order', 'the table has Name, Email, Phone, Joined, Last login, Orders, Paid, Last order', t.join('|'))
    const r0 = await rows(page).nth(0).innerText()
    is(/Test Customer 0/.test(r0) && /customer0@example\.com/.test(r0) && /9650000/.test(r0) && /KWD\s0\.000/.test(r0), 'a row carries name, email, phone, order count and paid total (KWD, 3 places)', r0.replace(/\s+/g, ' '))
    const r2 = await rows(page).nth(2).innerText()
    is(/KWD\s19\.000/.test(r2) && /\b2\b/.test(r2) && /Oct 3, 2026|3 Oct 2026/.test(r2), 'paid total, order count and last order date show', r2.replace(/\s+/g, ' '))
    is((await rows(page).nth(0).locator('td').nth(4).innerText()).trim() === '—', 'last login is a dash where the column does not exist (null)')
    // Paging.
    is(await page.getByRole('button', { name: 'Previous', exact: true }).isDisabled() && await page.getByRole('button', { name: 'More', exact: true }).isEnabled(), 'page 1: Previous is disabled, More is enabled (has_more)')
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await until(async () => (await rows(page).first().locator('button').getAttribute('data-profile-id')) === String(P[20].id))
    is(listReqs(server).at(-1).page === 2 && await rows(page).count() === 20, 'More asks for page 2 and shows the next 20')
    is(await rows(page).first().locator('button').getAttribute('data-profile-id') === String(P[20].id), 'page 2 starts at the 21st profile')
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await until(async () => (await rows(page).count()) === 7)
    is(await rows(page).count() === 7 && await page.getByRole('button', { name: 'More', exact: true }).isDisabled(), 'page 3 holds the last 7 and More is disabled (has_more false)')
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await until(async () => (await rows(page).count()) === 20)
    is(listReqs(server).at(-1).page === 2 && await page.getByText('Page 2', { exact: true }).isVisible(), 'Previous goes back to page 2')
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await until(async () => (await rows(page).first().locator('button').getAttribute('data-profile-id')) === String(P[0].id))
  }

  if (on('search')) {
    const search = page.getByRole('searchbox')
    is(await search.getAttribute('maxlength') === '80', 'the search box is capped at 80 characters, as the server is')
    is(await search.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)) >= 16, 'the search box is 16px or larger (no zoom on a phone)')
    // One request per pause.
    const before = listReqs(server).length
    await search.click()
    await page.keyboard.type('khal', { delay: 70 })
    await sleep(140)
    is(listReqs(server).length === before, 'typing "khal": no request goes out while the keys are still coming')
    await until(() => listReqs(server).length === before + 1, 4000)
    await sleep(700)
    const sent = listReqs(server).slice(before)
    is(sent.length === 1 && sent[0].q === 'khal' && sent[0].page === 1, 'after the pause: exactly one request, for "khal", page 1', JSON.stringify(sent.map((e) => e.q)))
    const want = P.filter((p) => [p.name, p.email, p.phone].some((v) => v.toLowerCase().includes('khal')))
    await until(async () => (await rows(page).count()) === Math.min(20, want.length))
    is(await rows(page).count() === Math.min(20, want.length) && (await rows(page).allInnerTexts()).every((t) => /khal/i.test(t)), `the list narrows to the ${want.length} matching profiles`, `${await rows(page).count()} rows`)
    // A new search starts on page 1.
    await search.fill('')
    await until(async () => (await rows(page).count()) === 20)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await until(() => listReqs(server).at(-1).page === 2)
    await search.fill('Test')
    await until(() => listReqs(server).at(-1).q === 'Test')
    is(listReqs(server).at(-1).page === 1, 'changing the search while on page 2 goes back to page 1')
    await sleep(300)
    // Arabic goes out as UTF-8 and comes back.
    await search.fill('عميل')
    await until(() => listReqs(server).at(-1).q === 'عميل')
    await until(async () => (await rows(page).count()) > 0 && (await rows(page).allInnerTexts()).every((t) => /عمي/.test(t)))
    is((await rows(page).allInnerTexts()).every((t) => /عمي/.test(t)), 'an Arabic search term reaches the server intact (UTF-8) and finds Arabic names')
    // Enter does not wait.
    await search.fill('Demo')
    const n0 = listReqs(server).length
    await search.press('Enter')
    is(await until(() => listReqs(server).length > n0, 250, 20), 'Enter searches at once, without waiting for the pause')
    await until(async () => (await rows(page).count()) > 0 && (await rows(page).allInnerTexts()).every((t) => /Demo/.test(t)))
    await sleep(450)

    // A stale request is aborted, and cannot land on newer results.
    const nStale = listReqs(server).length
    await search.fill('slowpoke')
    await until(() => listReqs(server).length > nStale && listReqs(server).at(-1).q === 'slowpoke', 4000)
    const slow = listReqs(server).at(-1)
    await search.fill('Shopper')
    await until(() => listReqs(server).at(-1).q === 'Shopper', 4000)
    is(await until(() => slow.aborted, 2500), 'the request for the old search is ABORTED (the server saw the connection close)')
    await until(async () => (await rows(page).count()) > 0 && (await rows(page).allInnerTexts()).every((t) => /Shopper/.test(t)))
    await sleep(1700) // past the stale answer's own delay
    const texts = await rows(page).allInnerTexts()
    is(texts.length > 0 && texts.every((t) => /Shopper/.test(t)) && !texts.some((t) => /SLOW RESULT/.test(t)), 'the slow answer to the old search never appears over the new results', texts.slice(0, 2).join(' / ').replace(/\s+/g, ' '))
    await page.getByRole('button', { name: 'Clear search' }).click()
    await until(async () => (await rows(page).count()) === 20)
    is(await search.inputValue() === '' && await search.evaluate((e) => e === document.activeElement), 'the clear button empties the box, reloads the list and keeps focus in the box')
  }

  if (on('states')) {
    const search = page.getByRole('searchbox')
    // Empty.
    await search.fill('zzzzqq')
    await page.getByText('No profiles match that search').waitFor()
    is(await page.getByRole('button', { name: 'Clear the search' }).isVisible(), 'a search with no match shows the empty state with a way out')
    await page.getByRole('button', { name: 'Clear the search' }).click()
    await until(async () => (await rows(page).count()) === 20)
    // 429.
    server.state.profilesFail = (q) => (q === 'throttle' ? { status: 429, body: { error: 'too_many_attempts', retry_after: 17 }, headers: { 'Retry-After': '17' } } : null)
    await search.fill('throttle')
    await page.getByText(/Try again in 17 seconds/).waitFor()
    is(true, 'a 429 says how long to wait, from the server\'s retry_after (17 seconds)')
    is(await rows(page).count() === 0 && await page.getByRole('button', { name: 'Try again' }).isVisible(), 'the 429 clears the rows (no stale results under an error) and offers Try again')
    server.state.profilesFail = null
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByText('No profiles match that search').waitFor()
    is(true, 'Try again recovers once the server answers')
    // 500.
    server.state.profilesFail = (q) => (q === 'boom' ? { status: 500, body: { error: 'failed' } } : null)
    await search.fill('boom')
    await page.getByText(/HTTP 500/).waitFor()
    is(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'a 500 shows its status and offers Try again')
    server.state.profilesFail = null
    await search.fill('')
    await until(async () => (await rows(page).count()) === 20)
    is(true, 'clearing the search after the failure loads the list again')
    // 401 and the missing table.
    server.state.profilesFail = (q) => (q === 'signedout' ? { status: 401, body: { error: 'not_signed_in' } } : null)
    await search.fill('signedout')
    await page.getByText(/session has ended/).waitFor()
    is(await page.getByRole('button', { name: 'Try again' }).count() === 0, 'a 401 says the session ended and offers no pointless retry')
    server.state.profilesFail = (q) => (q === 'notable' ? { status: 503, body: { error: 'no_table' } } : null)
    await search.fill('notable')
    await page.getByText(/not set up on this database/).waitFor()
    is(true, 'a missing customer_accounts table (503 no_table) says so')
    server.state.profilesFail = null
    await search.fill('')
    await until(async () => (await rows(page).count()) === 20)
  }

  if (on('detail')) {
    const search = page.getByRole('searchbox')
    await search.fill('Demo')
    await until(async () => (await rows(page).count()) > 0 && (await rows(page).allInnerTexts()).every((t) => /Demo/.test(t)))
    await sleep(350)
    const lists = listReqs(server).length
    const opener = page.locator('[data-profile-id="404"]:visible')
    await opener.click()
    await heading(page, 'Demo Shopper 4').waitFor()
    is(server.log.filter((e) => e.query.includes('r=profile_detail&id=404')).length === 1, 'opening a profile makes one profile_detail request')
    is(await page.locator('[data-profiles-list]').isHidden(), 'the list is out of sight while a profile is open')
    is(await page.locator('[data-profile-detail] h1').evaluate((e) => e === document.activeElement), 'focus moves to the profile heading')
    const a = await page.locator('[data-profile-detail] ul li').allInnerTexts()
    is(a.length === 2 && a.every((t) => /Block|Street|Building/.test(t)), 'two distinct delivery addresses from four orders, each once', a.join(' || ').replace(/\s+/g, ' '))
    is(/4 orders/.test((await page.locator('[data-profile-detail]').innerText()).replace(/\s+/g, ' ')) || /Orders\s*4/.test((await page.locator('[data-profile-detail]').innerText()).replace(/\s+/g, ' ')), 'the summary counts the 4 orders')
    is(/KWD\s9\.500/.test(await page.locator('[data-profile-detail]').innerText()), 'the paid total counts only paid orders (KWD 9.500)')
    is(await page.locator('[data-profile-detail] tbody tr').count() === 4, 'the orders table lists the 4 orders')
    is(/Not recorded/.test(await page.locator('[data-profile-detail]').innerText()), 'last login reads "Not recorded" when the server has no such column')
    await page.keyboard.press('Escape')
    await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
    is(await search.inputValue() === 'Demo' && await rows(page).count() > 0, 'Escape returns to the same search, results still there')
    is(listReqs(server).length === lists, 'going back makes no new list request')
    is(await opener.evaluate((e) => e === document.activeElement), 'focus returns to the row that was opened')
    // Back button, and a profile that has gone.
    server.state.detailFail = (id) => (id === 409 ? { status: 404, body: { error: 'not_found' } } : null)
    await search.fill('')
    await until(async () => (await rows(page).count()) === 20)
    await page.locator('[data-profile-id="409"]:visible').click()
    await page.getByText('This profile no longer exists.').waitFor()
    is(true, 'a profile that is gone (404) says so')
    await page.getByRole('button', { name: '← All profiles' }).click()
    await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
    is(true, 'the Back button returns to the list')
    server.state.detailFail = null
    // Markup in a name stays text.
    await page.locator('[data-profile-id="403"]:visible').click()
    await heading(page, XSS_NAME).waitFor()
    is(await page.evaluate(() => window.__xss === undefined) && await page.locator('main img').count() === 0, 'a name that is an <img onerror> tag is shown as text, nothing runs, no element is created')
    await page.keyboard.press('Escape')
    await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
    is((await page.locator('[data-profile-id="403"]:visible').innerText()).includes('<img src=x'), 'the same name in the list is text too')
  }

  if (on('enum')) {
    // FOUND IN REVIEW: METHOD['__proto__'] is Object.prototype, an object, and React refuses an object as a child (error
    // #31), so one order whose payment_method read "__proto__" turned the whole detail into "Profiles stopped working".
    // The value is the server's (an enum), not a customer's, but a screen that dies on a string is not a screen to trust.
    // Statuses are looked up in tables too ('constructor' is a function, 'toString' another): none may take it down.
    const P2 = P[2]
    const hostile = ['__proto__', 'constructor', 'toString'].map((v, k) => ({
      id: 91000 + k, track_id: `SPPROTO${k}`, amount: 5, payment_method: v, payment_status: v, fulfilment_status: v,
      customer_name: 'x', customer_phone: '1', customer_governorate: 'hawalli', customer_area: 'Salmiya', customer_block: '1',
      customer_street: '2', customer_building: '3', created_at: '2026-10-01 10:00:00',
    }))
    const match = (u) => u.pathname === '/api/admin.php' && u.searchParams.get('r') === 'profile_detail' && u.searchParams.get('id') === String(P2.id)
    await page.route(match, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      profile: { id: P2.id, name: P2.name, email: P2.email, phone: P2.phone, created_at: P2.created_at, last_login_at: null },
      orders: hostile, summary: { orders: 3, paid_total: 0 } }) }))
    await page.locator(`[data-profile-id="${P2.id}"]:visible`).click()
    // Either the profile or, if the screen fell over, its error box: wait for whichever comes, then judge.
    await page.locator('[data-profile-detail] h1, main [role="alert"]').first().waitFor()
    const fell = await page.locator('main [role="alert"]').count()
    const body = await (fell ? page.locator('main') : page.locator('[data-profile-detail]')).innerText()
    is(!fell && /SPPROTO0/.test(body) && /SPPROTO2/.test(body), 'an order whose method/status read "__proto__", "constructor" or "toString" shows as text, the screen does not fall over', fell ? `the screen fell over: ${body.replace(/\s+/g, ' ').slice(0, 70)}` : '')
    is(!fell && /__proto__/.test(body), 'and the odd value is shown as the text it is')
    if (!fell) {
      await page.keyboard.press('Escape')
      await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
    }
    await page.unroute(match)
  }

  if (on('rtl')) {
    // Arabic names in the English admin are dir="auto".
    const ar = P.find((p) => /[؀-ۿ]/.test(p.name))
    const btn = page.locator(`[data-profile-id="${ar.id}"]:visible`)
    is(await btn.getAttribute('dir') === 'auto', 'an Arabic name in the list carries dir="auto"')
    is(await btn.evaluate((e) => e.matches(':dir(rtl)')), 'and it resolves to right-to-left, while the English names beside it stay left-to-right')
    const en = page.locator('[data-profile-id="400"]:visible')
    is(await en.evaluate((e) => e.matches(':dir(ltr)')), 'an English name stays left-to-right')
    await btn.click()
    await heading(page, ar.name).waitFor()
    is(await page.locator('[data-profile-detail] h1 bdi').getAttribute('dir') === 'auto', 'the profile heading isolates the name with dir="auto"')
    await page.keyboard.press('Escape')
    await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
  }

  if (on('privacy')) {
    const storageAfter = await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]))
    is(storageAfter === storageBefore, 'no localStorage or sessionStorage key was created while using Profiles', `${storageBefore} -> ${storageAfter}`)
    const dump = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))
    is(!/example\.com|Test Customer|9650000|Mallory|Khalid/.test(dump), 'nothing about a customer is in localStorage, sessionStorage or a cookie')
    const logged = seen.console.filter((m) => /example\.com|Test Customer|9650000|Mallory|Khalid|عميل/.test(m))
    is(logged.length === 0, 'no customer data reaches the console', logged.slice(0, 2).join(' | '))
    const bad = server.log.filter((e) => e.path === '/api/admin.php' && e.admin !== true)
    is(bad.length === 0, 'every admin.php request carried X-Sporta-Admin: 1', bad.map((e) => e.query).join())
    is(seen.errors.length === 0, 'no page errors during the whole Profiles session', seen.errors.join(' | '))
  }
  await ctx.close()
}

// ------------------------------------------- the service worker keeps no customer data
// The suite's other pages run with the service worker blocked (it is not what they test). In production it is on, and
// its last rule is "network first, cache as a fallback" for EVERY same-origin GET that is not /knet/, /pay/ or config.js:
// /api/admin.php included. Whether an admin answer (customer names, emails, phones, delivery addresses) then lands in
// Cache Storage is decided by one line of public/sw.js: it clones the response AFTER handing it to the page, which
// throws "body already used", so nothing is stored. That is a bug standing guard over customer data. This group pins the
// RESULT (nothing from admin.php is in Cache Storage with the worker running), so the day that line is "fixed" this
// fails and the fix has to come with /api/ in the worker's never-cache list.
async function groupStorage(browser, server, tag = '') {
  const t = (s) => (tag ? `${s} [${tag}]` : s)
  head('Storage: with the service worker ON, no customer data is kept in Cache Storage' + (tag ? ` (${tag})` : ''))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow', locale: 'en-GB' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await page.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort())
  // localhost is a secure context (as https is in production), which main.jsx needs to register the worker.
  await page.goto(`http://localhost:${server.port}/backends?lang=en`, { waitUntil: 'load' })
  await heading(page, 'Overview').waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload({ waitUntil: 'load' })
  await heading(page, 'Overview').waitFor()
  is(await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 8000), t('a service worker controls /backends (the production situation)'))
  await sideTab(page, 'Profiles').click()
  await rows(page).first().waitFor()
  await page.locator('[data-profile-id="404"]:visible').click()
  await heading(page, 'Demo Shopper 4').waitFor()
  await sleep(900) // the worker's cache.put is not awaited by anything
  const kept = await page.evaluate(async () => {
    const urls = [], text = []
    for (const k of await caches.keys()) {
      const c = await caches.open(k)
      for (const req of await c.keys()) {
        if (!/admin\.php/.test(req.url)) continue
        urls.push(new URL(req.url).search)
        text.push(await (await c.match(req)).text())
      }
    }
    return { urls, text: text.join('\n') }
  })
  is(kept.urls.length === 0, t('no /api/admin.php answer (profile list, profile detail, stats) is in Cache Storage'), kept.urls.join(' '))
  is(!/example\.com|Demo Shopper|9650000/.test(kept.text), t('and no customer name, email or phone is'))
  await ctx.close()
}

async function groupFailure(browser, server) {
  head('Failure: a chunk that will not load')
  const { ctx, page } = await newPage(browser, server)
  await heading(page, 'Overview').waitFor()
  server.state.blockPaths = (p) => /\/assets\/Profiles-/.test(p)
  await sideTab(page, 'Profiles').click()
  const alert = page.locator('main [role="alert"]')
  await alert.waitFor()
  const text = await alert.innerText()
  is(/Profiles could not be loaded/.test(text) && await alert.getByRole('button', { name: 'Try again' }).isVisible(), 'a chunk that will not load shows "could not be loaded" and a Try again button', text.replace(/\s+/g, ' ').slice(0, 90))
  is(await alert.getByRole('button', { name: 'Reload the page' }).isVisible(), 'and a Reload the page button, for a page that is stale after a deploy')
  await sleep(900)
  const tries = chunkCount(server, 'Profiles')
  is(tries >= 1 && tries <= 3, 'the failure does not loop: the chunk was asked for a bounded number of times', `${tries} requests`)
  await sleep(600)
  is(chunkCount(server, 'Profiles') === tries, 'and no more requests follow while it sits there')
  await alert.getByRole('button', { name: 'Try again' }).click()
  await alert.waitFor()
  is(chunkCount(server, 'Profiles') > tries && await alert.isVisible(), 'Try again asks for the chunk again and, while it is still blocked, shows the failure again')
  server.state.blockPaths = null
  await alert.getByRole('button', { name: 'Try again' }).click()
  await heading(page, 'Profiles').waitFor()
  await rows(page).first().waitFor()
  is(true, 'once the chunk can load, Try again recovers and the Profiles list appears')
  const n = chunkCount(server, 'Profiles')
  await sideTab(page, 'Overview').click()
  await heading(page, 'Overview').waitFor()
  await sideTab(page, 'Profiles').click()
  await heading(page, 'Profiles').waitFor()
  is(chunkCount(server, 'Profiles') === n, 'after recovery, switching away and back does not fetch the chunk again')

  // Leave a failed screen and come back later: a fresh try, no button needed.
  server.state.blockPaths = (p) => /\/assets\/Discounts-/.test(p)
  await sideTab(page, 'Discounts').click()
  await page.locator('main [role="alert"]').waitFor()
  await sideTab(page, 'Overview').click()
  await heading(page, 'Overview').waitFor()
  server.state.blockPaths = null
  await sideTab(page, 'Discounts').click()
  await heading(page, 'Discounts').waitFor()
  is(true, 'leaving a screen that failed and coming back tries it afresh (no button press)')
  await ctx.close()
}

async function groupFallback(browser, server) {
  head('Fallback: a held-open content area while a chunk travels')
  for (const phone of [false, true]) {
    const { ctx, page } = await newPage(browser, server, phone ? { w: 390, h: 844, phone: true } : {})
    const tag = phone ? '390px' : '1280px'
    await page.waitForSelector('main h1')
    server.state.delayPaths = (p) => (/\/assets\/Orders-/.test(p) ? 1400 : 0)
    await page.evaluate(() => {
      window.__cls = 0
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: false })
    })
    const chrome = () => page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width].map((v) => Math.round(v)) }
      return { side: r('.admin-sidebar'), tabbar: r('.m-tabbar'), header: r('.m-header') }
    })
    const still = await chrome()
    const tab = phone ? page.locator('.m-tabbar__item', { hasText: 'Orders' }) : sideTab(page, 'Orders')
    await tab.click()
    const fb = page.locator('.admin-screen-fallback')
    await fb.waitFor({ timeout: 3000 })
    const box = await fb.boundingBox()
    const vh = page.viewportSize().height
    is(box.height >= vh * 0.69, `[${tag}] the fallback holds the content area at 70vh or more (${Math.round(box.height)}px of ${vh}px)`)
    is(await fb.getAttribute('role') === 'status' && await fb.getAttribute('aria-busy') === 'true' && /Loading Orders/.test(await fb.innerText()), `[${tag}] the fallback is a status region, busy, and names the screen`)
    const during = await chrome()
    is(JSON.stringify(during) === JSON.stringify(still), `[${tag}] the sidebar, header and tab bar do not move while it is up`, JSON.stringify([still, during]))
    await heading(page, 'Orders').waitFor()
    await sleep(300)
    is(await fb.count() === 0, `[${tag}] the fallback is gone once the screen is there`)
    const after = await chrome()
    is(JSON.stringify(after) === JSON.stringify(still), `[${tag}] and the chrome is where it was`)
    const cls = await page.evaluate(() => window.__cls)
    is(cls < 0.1, `[${tag}] layout shift across the tab switch is in Google's "good" band (${cls.toFixed(4)} < 0.1)`)
    server.state.delayPaths = null
    await ctx.close()
  }
}

async function groupLayout(browser, server) {
  head('Layout: phone, tablet, desktop; English (LTR) and Arabic (RTL)')
  const overflow = (page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }))
  const targets = (page, scope) => page.evaluate((sc) => {
    const root = document.querySelector(sc)
    const out = []
    for (const e of root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], .m-row')) {
      const cs = getComputedStyle(e)
      const b = e.getBoundingClientRect()
      if (cs.display === 'none' || cs.visibility === 'hidden' || b.width === 0 || b.height === 0) continue
      out.push({ what: `${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''}:${(e.innerText || e.placeholder || '').trim().slice(0, 18)}`, w: Math.round(b.width), h: Math.round(b.height) })
    }
    return out
  }, scope)
  for (const rtl of [false, true]) {
    const dir = rtl ? 'RTL' : 'LTR'
    // ---- phone
    {
      const { ctx, page } = await newPage(browser, server, { w: 390, h: 844, phone: true, rtl })
      await page.locator('main').waitFor()
      await page.locator('.m-tabbar__item', { hasText: 'Profiles' }).tap()
      await page.locator('[data-profiles-list] .m-row').first().waitFor()
      is(await page.evaluate(() => document.documentElement.dir) === (rtl ? 'rtl' : 'ltr'), `[390 ${dir}] the page really is ${dir}`)
      is(await page.locator('[data-profiles-list] table.admin-table').first().isHidden() && await page.locator('[data-profiles-list] .m-list').isVisible(), `[390 ${dir}] cards replace the table`)
      is(await page.locator('.m-tabbar__item', { hasText: 'Profiles' }).getAttribute('aria-current') === 'true', `[390 ${dir}] the Profiles tab is in the bar and marked current`)
      let o = await overflow(page)
      is(o.page <= 0 && o.main <= 0, `[390 ${dir}] the list has no horizontal overflow (with a 70-character email)`, JSON.stringify(o))
      const longCard = page.locator('.m-row', { hasText: 'longlonglong' })
      const lb = await longCard.boundingBox()
      is(lb.x >= -0.5 && lb.x + lb.width <= 390.5, `[390 ${dir}] the long-email card stays inside the screen`, JSON.stringify(lb))
      await page.getByRole('button', { name: 'More', exact: true }).scrollIntoViewIfNeeded()
      let t = await targets(page, '[data-profiles-list]')
      const small = t.filter((x) => x.h < 40 || x.w < 40)
      is(t.length >= 20 && small.length === 0, `[390 ${dir}] every tap target in the list is 40px or more (${t.length} measured)`, small.map((x) => `${x.what} ${x.w}x${x.h}`).join('; '))
      is(await page.getByRole('searchbox').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)) >= 16, `[390 ${dir}] the search box is 16px`)
      await page.locator('[data-profile-id="404"]:visible').tap()
      await page.locator('[data-profile-detail] h1').waitFor()
      await page.locator('[data-profile-detail] .m-list .m-row').first().waitFor()
      o = await overflow(page)
      is(o.page <= 0 && o.main <= 0, `[390 ${dir}] the profile has no horizontal overflow`, JSON.stringify(o))
      t = await targets(page, '[data-profile-detail]')
      const small2 = t.filter((x) => x.h < 40 || x.w < 40)
      is(small2.length === 0, `[390 ${dir}] the Back button is a 40px target`, small2.map((x) => `${x.what} ${x.w}x${x.h}`).join('; '))
      await page.locator('[data-profile-detail]').getByRole('button', { name: '← All profiles' }).tap()
      await page.locator('[data-profiles-list]').waitFor({ state: 'visible' })
      await page.getByRole('searchbox').fill('longlong')
      await page.locator('[data-profiles-list] .m-row').first().waitFor()
      o = await overflow(page)
      is(o.page <= 0, `[390 ${dir}] a one-result list does not overflow either`, JSON.stringify(o))
      await ctx.close()
    }
    // ---- tablet and desktop
    for (const w of [768, 1280]) {
      const { ctx, page } = await newPage(browser, server, { w, h: 900, rtl })
      await sideTab(page, 'Profiles').click()
      await rows(page).first().waitFor()
      const o = await overflow(page)
      is(o.page <= 0 && o.main <= 0, `[${w} ${dir}] no horizontal overflow of the page or the content area (the table scrolls in its own frame if it must)`, JSON.stringify(o))
      if (w === 1280) {
        const wrap = await page.locator('.profiles-table-wrap').evaluate((e) => [e.scrollWidth, e.clientWidth])
        is(wrap[0] <= wrap[1], `[1280 ${dir}] all eight columns fit at 1280px without sideways scrolling`, wrap.join('/'))
        const em = await page.locator('.profiles-cell-email').nth(5).evaluate((e) => ({ clipped: e.scrollWidth > e.clientWidth, w: e.clientWidth }))
        is(em.clipped && em.w <= 280, `[1280 ${dir}] the 70-character email is clipped with an ellipsis, not stretched across the table`, JSON.stringify(em))
      }
      await ctx.close()
    }
  }
}

// ---------------------------------------------------- the service worker's precache
// scripts/sw-precache.mjs fills sw.js with every chunk a shopper might need so the shop opens offline. It used to
// skip the admin by NAME (/^AdminApp-/). With ten screens as their own chunks, none named AdminApp, a name filter
// would have put the whole admin into every shopper's install; the script now skips what only the admin reaches.
async function precacheChecks(dist, chunks, script = join(ROOT, 'scripts/sw-precache.mjs'), tag = '') {
  const t = (s) => (tag ? `${s} [${tag}]` : s)
  const copy = join(SCRATCH, 'dist-sw' + tag.replace(/\W/g, ''))
  await rm(copy, { recursive: true, force: true })
  await cp(dist, copy, { recursive: true })
  execFileSync(process.execPath, [script, copy], { stdio: 'pipe' })
  const sw = readFileSync(join(copy, 'sw.js'), 'utf8')
  const list = [...(/const PRECACHE = \[([^\]]*)\]/.exec(sw)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const inList = (file) => list.includes('/assets/' + file)
  const adminJs = [...SCREEN_CHUNKS, 'AdminApp', 'api', 'Notice', 'downscaleImage'].flatMap((n) => byName(chunks, n)).map((c) => c.file)
  const adminCss = readdirSync(join(dist, 'assets')).filter((f) => /^AdminApp-.*\.css$/.test(f))
  const leaked = [...adminJs, ...adminCss].filter(inList)
  is(list.length > 20, t('the precache list was written'), `${list.length} entries`)
  is(leaked.length === 0, t('no admin chunk is in the shoppers\' precache (shell, ten screens, api client, notice box, image helper, stylesheet)'), leaked.join(', '))
  const shop = ['index', 'react-vendor', 'Shop', 'Cart', 'Checkout', 'ProductDetail'].flatMap((n) => byName(chunks, n)).map((c) => c.file)
  is(shop.length >= 6 && shop.every(inList), t('every storefront chunk is still precached (index, React, Shop, Cart, Checkout, Product)'), shop.filter((f) => !inList(f)).join(', '))
  return list
}

// ------------------------------------------------------------ first-load bytes
async function firstLoad(browser, dist) {
  const server = await startMockAdmin({ distDir: dist })
  const { ctx, page } = await newPage(browser, server)
  await page.locator('main h1').first().waitFor()
  await sleep(500)
  const files = [...new Set(server.log.filter((e) => e.path !== '/api/admin.php' && e.bytes > 0 && /\.(js|css|html)$|^\/backends$|^\/$/.test(e.path === '/backends' ? '/backends' : e.path)).map((e) => (e.path === '/backends' ? '/index.html' : e.path)))]
  let raw = 0, g = 0, b = 0
  const list = []
  for (const f of files) {
    const buf = readFileSync(join(dist, f))
    raw += buf.length; g += gz(buf); b += brotli(buf)
    list.push(`${f.replace(/^\/assets\//, '')} ${buf.length}`)
  }
  const fonts = server.log.filter((e) => e.path.startsWith('/fonts/')).reduce((s, e) => s + e.bytes, 0)
  await ctx.close()
  await server.close()
  return { raw, gz: g, br: b, count: files.length, fonts, list }
}

// ------------------------------------------------------------------- mutants
async function mutant(browser, label, edits, run, expect) {
  if (process.env.SPLIT_ONLY_MUTANT && process.env.SPLIT_ONLY_MUTANT !== label) return // debugging aid: one mutant at a time
  const root = await mutantRoot(label, edits)
  const dist = join(SCRATCH, 'dist-mut-' + label)
  build(root, dist)
  const server = await startMockAdmin({ distDir: dist })
  const results = []
  sink = results
  try { await run({ dist, server }) } catch (e) { results.push({ ok: false, msg: `run aborted: ${String(e.message).split('\n')[0]}` }) }
  sink = null
  await server.close()
  const failed = results.filter((r) => !r.ok)
  const caught = failed.filter((r) => expect.test(r.msg))
  is(caught.length > 0, `MUTANT ${label}: caught (${failed.length} of ${results.length} checks fail; ${caught.length} the intended ones)`, failed.length ? 'first failure: ' + failed[0].msg : 'no check failed: the suite does not notice this change')
  if (caught.length) console.log(`       e.g. FAIL ${caught[0].msg.slice(0, 150)}`)
}

// ============================================================================= main
let browser, server
try {
  head('Build: the current tree into a scratch directory (never dist/)')
  const DIST = join(SCRATCH, 'dist')
  build(ROOT, DIST)
  const chunks = analyse(DIST)
  const { app } = staticChecks(chunks)
  const row = (n, c) => `${n.padEnd(14)} raw ${String(c.raw).padStart(7)}  gzip ${String(c.gz).padStart(6)}  brotli ${String(c.br).padStart(6)}`
  console.log(`\n  AdminApp before: raw ${BEFORE_ADMINAPP_RAW} (b9c60cbc, measured)`)
  if (app) console.log(`  AdminApp after:  ${row('', app).trim()}  (${Math.round((1 - app.raw / BEFORE_ADMINAPP_RAW) * 100)}% smaller)`)
  for (const n of SCREEN_CHUNKS) for (const c of byName(chunks, n)) console.log('    ' + row(n, c))
  for (const n of ['api', 'Notice', 'downscaleImage', 'preload-helper']) for (const c of byName(chunks, n)) console.log('    ' + row(n + ' (shared)', c))

  head('Service worker precache: shoppers do not download the admin')
  await precacheChecks(DIST, chunks)

  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

  const MUTANTS_ONLY = !!process.env.SPLIT_MUTANTS_ONLY // debugging aid: skip everything but the mutants
  head('First load of /backends (JS, CSS, HTML; fonts are the same either way)')
  const after = MUTANTS_ONLY ? { count: 0, raw: 0, gz: 0, br: 0, fonts: 0, list: [] } : await firstLoad(browser, DIST)
  console.log(`  after:  ${after.count} files  raw ${after.raw}  gzip ${after.gz}  brotli ${after.br}   (+ ${after.fonts} bytes of fonts)`)
  console.log(`          ${after.list.join('\n          ')}`)
  if (process.env.SPLIT_BASELINE_REF && !MUTANTS_ONLY) {
    const ref = process.env.SPLIT_BASELINE_REF
    const base = join(SCRATCH, 'base')
    await mkdir(base, { recursive: true })
    execFileSync('tar', ['-x', '-C', base], { input: execFileSync('git', ['-C', ROOT, 'archive', ref, '.'], { maxBuffer: 1 << 30 }), maxBuffer: 1 << 30 })
    await symlink(join(ROOT, 'node_modules'), join(base, 'node_modules'))
    build(base, join(SCRATCH, 'dist-base'))
    const before = await firstLoad(browser, join(SCRATCH, 'dist-base'))
    console.log(`  before (${ref}): ${before.count} files  raw ${before.raw}  gzip ${before.gz}  brotli ${before.br}   (+ ${before.fonts} bytes of fonts)`)
    console.log(`          ${before.list.join('\n          ')}`)
    console.log(`  first load, JS+CSS+HTML: raw ${before.raw} -> ${after.raw} (${after.raw - before.raw}), brotli ${before.br} -> ${after.br} (${after.br - before.br})`)
    is(after.br < before.br, `the first load of /backends is lighter than at ${ref} (brotli ${before.br} -> ${after.br})`)
  }

  if (!MUTANTS_ONLY) {
    server = await startMockAdmin({ distDir: DIST })
    await groupLoading(browser, server)
    server.log.length = 0
    await groupProfiles(browser, server)
    server.log.length = 0
    await groupFailure(browser, server)
    await groupFallback(browser, server)
    await groupLayout(browser, server)
    await groupStorage(browser, server)
    await server.close()
    server = null
  }

  if (!process.env.SPLIT_SKIP_MUTANTS) {
    head('MUTATION: each change below must be caught')
    const SHELL_RUN = async ({ dist, server: s }) => {
      staticChecks(analyse(dist), 'mutant')
      await groupLoading(browser, s)
    }
    {
      // The precache script as it was: skip by name. Not a source build, so it is run directly.
      const src = readFileSync(join(ROOT, 'scripts/sw-precache.mjs'), 'utf8')
      const needle = 'const SKIP = adminOnly(DIST, all)'
      if (!src.includes(needle)) throw new Error('mutant sw-by-name: needle not found in scripts/sw-precache.mjs')
      const mutantScript = join(SCRATCH, 'sw-precache-by-name.mjs')
      await writeFile(mutantScript, src.replace(needle, 'const SKIP = new Set(all.filter((f) => /^AdminApp-/.test(f)))'))
      const results = []
      sink = results
      try { await precacheChecks(DIST, chunks, mutantScript, 'by name') } catch (e) { results.push({ ok: false, msg: `run aborted: ${String(e.message).split('\n')[0]}` }) }
      sink = null
      const failed = results.filter((r) => !r.ok && /precache/.test(r.msg))
      is(failed.length > 0, `MUTANT sw-by-name: caught (precache skipping the admin by name lets ${results.filter((r) => !r.ok).length} check(s) fail)`, 'no check failed')
      if (failed.length) console.log(`       e.g. FAIL ${failed[0].msg.slice(0, 150)}`)
    }
    {
      // The worker as someone would "fix" it: clone BEFORE handing the response to the page, so the cache write works.
      // That stores every same-origin GET it sees, /api/admin.php among them. Run directly on a copy of the built sw.js.
      const copy = join(SCRATCH, 'dist-sw-clones')
      await cp(DIST, copy, { recursive: true })
      const swPath = join(copy, 'sw.js')
      const sw = readFileSync(swPath, 'utf8')
      const needle = 'if (CACHEABLE(request, res)) caches.open(SHELL).then((c) => c.put(request, res.clone()))'
      if (!sw.includes(needle)) throw new Error('mutant sw-clones: needle not found in sw.js')
      await writeFile(swPath, sw.replace(needle, 'if (CACHEABLE(request, res)) { const keep = res.clone(); caches.open(SHELL).then((c) => c.put(request, keep)) }'))
      const s = await startMockAdmin({ distDir: copy })
      const results = []
      sink = results
      try { await groupStorage(browser, s, 'worker clones in time') } catch (e) { results.push({ ok: false, msg: `run aborted: ${String(e.message).split('\n')[0]}` }) }
      sink = null
      await s.close()
      const failed = results.filter((r) => !r.ok && /Cache Storage|customer name/.test(r.msg))
      is(failed.length > 0, `MUTANT sw-clones-in-time: caught (a worker that does cache lets ${results.filter((r) => !r.ok).length} check(s) fail)`, 'no check failed: the suite would not notice customer data in Cache Storage')
      if (failed.length) console.log(`       e.g. FAIL ${failed[0].msg.slice(0, 150)}`)
    }
    await mutant(browser, 'eager-profiles', [
      { file: 'src/admin/screens.js', from: "const LOADERS = {", to: "import ProfilesEager from './Profiles'\nconst LOADERS = {" },
      { file: 'src/admin/screens.js', from: "profiles: () => import('./Profiles'),", to: "profiles: () => Promise.resolve({ default: ProfilesEager })," },
    ], SHELL_RUN, /Profiles|AdminApp|screen chunk|own chunk/)
    await mutant(browser, 'screen-imports-screen', [
      { file: 'src/admin/Orders.jsx', from: "import { Notice } from './Notice'", to: "import { Notice } from './Overview'" },
      { file: 'src/admin/Overview.jsx', from: "export default function Overview(", to: "export { Notice }\nexport default function Overview(" },
    ], async ({ dist }) => staticChecks(analyse(dist), 'mutant'), /no chunk imports a screen chunk/)
    await mutant(browser, 'no-debounce', [
      { file: 'src/admin/Profiles.jsx', from: 'const DEBOUNCE_MS = 300', to: 'const DEBOUNCE_MS = 0' },
    ], ({ server: s }) => groupProfiles(browser, s, ['search']), /pause|while the keys|exactly one request/)
    await mutant(browser, 'no-abort', [
      { file: 'src/admin/Profiles.jsx', from: '    return () => ac.abort()\n  }, [query, page, reload])', to: '    return () => {}\n  }, [query, page, reload])' },
    ], ({ server: s }) => groupProfiles(browser, s, ['search']), /ABORTED|slow answer/)
    await mutant(browser, 'proto-lookup', [
      // The lookups as they were: a plain table index, which answers for "__proto__".
      { file: 'src/admin/Profiles.jsx', from: 'methodLabel(o.payment_method)', to: '(METHOD[o.payment_method] ?? o.payment_method)', all: true },
    ], ({ server: s }) => groupProfiles(browser, s, ['enum']), /__proto__/)
    await mutant(browser, 'no-dir-auto', [
      { file: 'src/admin/Profiles.jsx', from: ' dir="auto"', to: '', all: true },
    ], ({ server: s }) => groupProfiles(browser, s, ['rtl']), /dir="auto"|right-to-left/)
    await mutant(browser, 'retry-retries-nothing', [
      { file: 'src/admin/ScreenHost.jsx', from: '  retry = () => {\n    retryScreen(this.props.id)\n', to: '  retry = () => {\n' },
    ], ({ server: s }) => groupFailure(browser, s), /recovers|Try again/)
    await mutant(browser, 'no-warm-on-intent', [
      { file: 'src/admin/AdminApp.jsx', from: '{...warmProps(tb.id)}', to: '', all: true },
    ], ({ server: s }) => groupLoading(browser, s), /ahead of the click/)
    await mutant(browser, 'first-tab-not-warmed', [
      { file: 'src/admin/AdminApp.jsx', from: '    loadScreen(FIRST_TAB).catch(() => {})\n', to: '' },
    ], ({ server: s }) => groupLoading(browser, s), /first tab's chunk is requested while/)
    await mutant(browser, 'table-frame-not-contained', [
      { file: 'src/styles/admin.css', from: '  contain: inline-size;\n', to: '' },
    ], ({ server: s }) => groupLayout(browser, s), /768 (LTR|RTL)\] no horizontal overflow/)
    await mutant(browser, 'fallback-has-no-height', [
      { file: 'src/admin/ScreenHost.jsx', from: 'admin-screen-fallback min-h-[70vh] space-y-5', to: 'admin-screen-fallback space-y-5' },
    ], ({ server: s }) => groupFallback(browser, s), /holds the content area/)
  }
} catch (e) {
  fail++
  console.log('FAIL the suite crashed: ' + (e?.stack ?? e))
} finally {
  await server?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
