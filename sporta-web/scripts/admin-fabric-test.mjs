// The Fabric dialog (block "ADMIN FABRIC", public/sporta-admin-brands.js): a "Fabric" button beside the Catalogue's Prices button
// opens one dialog listing the products. Each product's composition is edited on its own row (materials, and with the percent
// option, a share per material that adds up to 100) and saved with product_fabric_save.
//
//   npm run test:admin-fabric   (no database, no PHP: the admin API is a fake that applies the same rules as fabric.php, answered
//                                by route interception; the REAL add-on file runs in Chromium; the Prices button is the live one's markup)
//
// What is asserted:
//   0. static: markers once; no innerHTML, console, eval, storage or interval; the only write is product_fabric_save;
//   1. the button sits beside Prices, once; none without Prices; nothing is read until it is pressed;
//   2. one read of the product list; each product shows what is stated now, or "Not stated"; opening writes nothing;
//   3. materials only: choose and add, Save sends the list without percentages, the row shows what was saved;
//   4. the percent option: shares that do not add to 100 show the total and block Save; 100 saves the shares as numbers;
//   5. at most four materials; the same material twice is refused and the reason is shown on the row;
//   6. Clear sends an empty list; the refusal for a database without the column and a signed-out answer are shown on the row;
//   7. Escape asks before it throws changes away;
//   8. MUTATION: without the total rule, without the four-material cap, without the duplicate rule, the matching check turns red.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN FABRIC - begin')
const END = ADDON.indexOf('/* ===== ADMIN FABRIC - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
function is(ok, msg, detail = '') {
  if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) }
}
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- the fake admin API: the same rules as fabric.php
const MATS = ['cotton', 'polyester', 'elastane', 'nylon', 'viscose', 'modal', 'wool', 'linen', 'bamboo']
function fakeRules(list) {
  if (!Array.isArray(list)) return 'fabric_invalid'
  if (list.length === 0) return null
  if (list.length > 4) return 'fabric_too_many'
  const seen = {}
  let withPct = 0, without = 0, sum = 0
  for (const e of list) {
    if (!MATS.includes(e.material)) return 'fabric_unknown_material'
    if (seen[e.material]) return 'fabric_duplicate'
    seen[e.material] = true
    if (e.percent == null) { without++; continue }
    if (!Number.isInteger(e.percent) || e.percent < 1 || e.percent > 100) return 'fabric_percent_invalid'
    withPct++; sum += e.percent
  }
  if (withPct && without) return 'fabric_percent_partial'
  if (withPct && sum !== 100) return 'fabric_percent_total'
  return null
}
function makeServer(opts = {}) {
  const products = [
    { id: 1, slug: 'tee-a', name_en: 'Tee A', name_ar: 'تي شيرت أ', fabric: null, active: 1 },
    { id: 2, slug: 'hoodie-b', name_en: 'Hoodie B', name_ar: 'هودي ب', fabric: [{ material: 'cotton', percent: 80 }, { material: 'elastane', percent: 20 }], active: 1 },
    { id: 3, slug: 'legacy-d', name_en: 'Legacy D', name_ar: 'قديم د', fabric: [{ material: 'wool', percent: null }], active: 1 },
    { id: 4, slug: 'signout-e', name_en: 'Signout E', name_ar: 'خروج هـ', fabric: null, active: 1 }
  ]
  const calls = []
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
  async function handle(route) {
    const req = route.request()
    const r = new URL(req.url()).searchParams.get('r')
    if (r === 'products_all' && req.method() === 'GET') return json(route, 200, products)
    if (req.method() !== 'POST') return json(route, 405, { error: 'method_not_allowed' })
    const body = JSON.parse(req.postData() || '{}')
    calls.push({ r, body })
    if (r !== 'product_fabric_save') return json(route, 404, { error: 'not_found' })
    if (opts.signedOutSlug && body.slug === opts.signedOutSlug) return json(route, 401, { error: 'unauthorized' })
    const p = products.find((x) => x.slug === body.slug)
    if (!p) return json(route, 404, { error: 'product_not_found' })
    if (p.slug === 'legacy-d') return json(route, 409, { error: 'fabric_not_migrated' })
    const code = fakeRules(body.fabric)
    if (code) return json(route, 400, { error: code })
    p.fabric = body.fabric.length ? body.fabric : null
    return json(route, 200, { slug: p.slug, fabric: p.fabric })
  }
  return { products, calls, handle }
}

// ---------------------------------------------------------------- the page: a header with the live Prices button, the block, the fake API
const CATALOGUE_HTML = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"></head><body>
  <main class="admin-content"><div class="catalog-heading"><h1>Catalogue</h1>
    <div class="catalog-heading__actions"><button type="button" class="btn-x" data-sporta-prices-open="1">Prices</button></div></div>
  </main></body></html>`
const PLAIN_HTML = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"></head><body><main><h1>Catalogue</h1></main></body></html>`

async function openEditor(browser, block, opts = {}, html = CATALOGUE_HTML) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const page = await ctx.newPage()
  const server = makeServer(opts)
  await page.route('https://admin.test/api/admin.php**', (route) => server.handle(route))
  await page.route('https://admin.test/backends**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto('https://admin.test/backends')
  await page.addScriptTag({ content: block })
  // the block places its button on a short delay after the page loads (and on a click), so give it that delay
  await page.waitForTimeout(900)
  return { ctx, page, server, close: () => ctx.close() }
}
const card = (page, slug) => page.locator(`[data-fab-slug="${slug}"]`)
const sel = (page, slug, i) => card(page, slug).locator('select').nth(i)
const pctBox = (page, slug, i) => card(page, slug).locator('input.fab-pct').nth(i)
const addBtn = (page, slug) => card(page, slug).locator('.fab-acts button').nth(0)
const saveBtn = (page, slug) => card(page, slug).locator('.fab-acts button').nth(1)
const clearBtn = (page, slug) => card(page, slug).locator('.fab-acts button').nth(2)
const fillBtn = (page, slug) => card(page, slug).locator('.fab-acts button').nth(3)
const pctSwitch = (page, slug) => card(page, slug).locator('input[type=checkbox]')
const statusOf = (page, slug) => card(page, slug).locator('.fab-status').textContent()
const totalOf = (page, slug) => card(page, slug).locator('.fab-total').textContent()
const nowOf = (page, slug) => card(page, slug).locator('.fab-now').textContent()
async function openDialog(page) {
  await page.click('[data-sporta-fab-open]')
  await page.waitForSelector('[data-fab-slug="tee-a"]', { timeout: 5000 })
}
async function waitStatus(page, slug, text) {
  await page.waitForFunction(({ slug, text }) => {
    const c = document.querySelector(`[data-fab-slug="${slug}"] .fab-status`)
    return c && c.textContent.indexOf(text) >= 0
  }, { slug, text }, { timeout: 5000 })
}

// ---------------------------------------------------------------- scenarios
async function scenarioStatic() {
  head('0. static')
  is(ADDON.split('/* ===== ADMIN FABRIC - begin').length === 2, 'the block begins once')
  is(ADDON.split('/* ===== ADMIN FABRIC - end').length === 2, 'the block ends once')
  is(BLOCK.length > 4000, 'the block was found and sliced', String(BLOCK.length))
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'console.', 'eval(', 'document.write', 'localStorage', 'sessionStorage', 'setInterval']) {
    is(CODE.indexOf(bad) < 0, `no ${bad}`)
  }
  const posts = [...CODE.matchAll(/post\('([a-z_]+)'/g)].map((m) => m[1])
  is(posts.length === 1 && posts[0] === 'product_fabric_save', 'the only write is product_fabric_save', posts.join(','))
  is((CODE.match(/\?r=products_all/g) || []).length === 1, 'one read of the product list')
}

async function scenarioButton(browser) {
  head('1. the button')
  const ed = await openEditor(browser, BLOCK)
  is(await ed.page.locator('[data-sporta-fab-open]').count() === 1, 'one Fabric button')
  const beside = await ed.page.evaluate(() => {
    const b = document.querySelector('[data-sporta-fab-open]'), pr = document.querySelector('[data-sporta-prices-open]')
    return b.parentNode === pr.parentNode && b.previousElementSibling === pr
  })
  is(beside, 'it sits right after the Prices button')
  is(ed.server.calls.length === 0, 'nothing is read until the button is pressed')
  await ed.close()

  const ed2 = await openEditor(browser, BLOCK, {}, PLAIN_HTML)
  await ed2.page.waitForTimeout(900)
  is(await ed2.page.locator('[data-sporta-fab-open]').count() === 0, 'no button where there is no Prices button')
  await ed2.close()
}

async function scenarioRead(browser) {
  head('2. reading the list')
  const ed = await openEditor(browser, BLOCK)
  await openDialog(ed.page)
  is(ed.server.calls.length === 0, 'opening writes nothing')
  is((await nowOf(ed.page, 'tee-a')).indexOf('Not stated') >= 0, 'a product with no fabric says "Not stated"')
  is((await nowOf(ed.page, 'hoodie-b')).indexOf('Cotton 80%, Elastane 20%') >= 0, 'a product with a composition shows it with its percentages', await nowOf(ed.page, 'hoodie-b'))
  is((await nowOf(ed.page, 'legacy-d')).indexOf('Wool') >= 0, 'a material without a percentage shows without one')
  await ed.close()
}

async function scenarioMaterialsOnly(browser) {
  head('3. materials only')
  const ed = await openEditor(browser, BLOCK)
  const { page, server } = ed
  await openDialog(page)
  await sel(page, 'tee-a', 0).selectOption('cotton')
  await addBtn(page, 'tee-a').click()
  await sel(page, 'tee-a', 1).selectOption('nylon')
  is((await pctSwitch(page, 'tee-a').isChecked()) === false, 'percentages are off by default for a product with none')
  await saveBtn(page, 'tee-a').click()
  await waitStatus(page, 'tee-a', 'Saved')
  const b = server.calls[server.calls.length - 1]
  is(JSON.stringify(b.body.fabric) === JSON.stringify([{ material: 'cotton' }, { material: 'nylon' }]), 'Save sends the materials without percentages', JSON.stringify(b && b.body))
  is((await nowOf(page, 'tee-a')).indexOf('Cotton, Nylon') >= 0, 'the row shows what was saved', await nowOf(page, 'tee-a'))
  await ed.close()
}

async function scenarioPercent(browser, block = BLOCK) {
  head('4. the percent option')
  const ed = await openEditor(browser, block)
  const { page, server } = ed
  await openDialog(page)
  await pctSwitch(page, 'tee-a').check()
  await sel(page, 'tee-a', 0).selectOption('cotton')
  await pctBox(page, 'tee-a', 0).fill('70')
  await addBtn(page, 'tee-a').click()
  await sel(page, 'tee-a', 1).selectOption('elastane')
  await pctBox(page, 'tee-a', 1).fill('20')
  is((await totalOf(page, 'tee-a')).indexOf('90') >= 0, 'the total shows 90 while the shares are short', await totalOf(page, 'tee-a'))
  is(await saveBtn(page, 'tee-a').isDisabled(), 'Save is blocked while the shares do not add to 100')
  is(!(await fillBtn(page, 'tee-a').isDisabled()), '"Fill the rest" is on while the total is short')
  await fillBtn(page, 'tee-a').click()
  is((await pctBox(page, 'tee-a', 1).inputValue()) === '30', '"Fill the rest" puts the missing 30 on the last row', await pctBox(page, 'tee-a', 1).inputValue())
  is((await totalOf(page, 'tee-a')).indexOf('100') >= 0, '"Fill the rest" brings the total to 100')
  is(await fillBtn(page, 'tee-a').isDisabled(), '"Fill the rest" is off once the total is 100')
  await pctBox(page, 'tee-a', 1).fill('20')
  await pctBox(page, 'tee-a', 1).fill('30')
  is((await totalOf(page, 'tee-a')).indexOf('100') >= 0, 'the total shows 100 when they do')
  is(!(await saveBtn(page, 'tee-a').isDisabled()), 'Save is on at 100')
  await saveBtn(page, 'tee-a').click()
  await waitStatus(page, 'tee-a', 'Saved')
  const b = server.calls[server.calls.length - 1]
  is(JSON.stringify(b.body.fabric) === JSON.stringify([{ material: 'cotton', percent: 70 }, { material: 'elastane', percent: 30 }]), 'the shares are sent as numbers', JSON.stringify(b && b.body))
  is((await nowOf(page, 'tee-a')).indexOf('Cotton 70%, Elastane 30%') >= 0, 'the row shows the saved shares', await nowOf(page, 'tee-a'))
  await ed.close()
}

async function scenarioLimits(browser, block = BLOCK) {
  head('5. limits and duplicates')
  const ed = await openEditor(browser, block)
  const { page, server } = ed
  await openDialog(page)
  await sel(page, 'tee-a', 0).selectOption('cotton')
  await addBtn(page, 'tee-a').click()
  await sel(page, 'tee-a', 1).selectOption('cotton')
  is(await saveBtn(page, 'tee-a').isDisabled(), 'the same material twice blocks Save')
  is((await totalOf(page, 'tee-a')).indexOf('listed once') >= 0, 'the duplicate reason is shown on the row', await totalOf(page, 'tee-a'))
  await sel(page, 'tee-a', 1).selectOption('nylon')
  await addBtn(page, 'tee-a').click()
  await sel(page, 'tee-a', 2).selectOption('wool')
  await addBtn(page, 'tee-a').click()
  await sel(page, 'tee-a', 3).selectOption('linen')
  is(await addBtn(page, 'tee-a').isDisabled(), 'at four materials, Add is off')
  is((await card(page, 'tee-a').locator('select').count()) === 4, 'four materials are shown, no fifth')
  is(server.calls.length === 0, 'none of this wrote anything')
  await ed.close()
}

async function scenarioClear(browser) {
  head('6. clear, refusals and sign-out')
  const ed = await openEditor(browser, BLOCK, { signedOutSlug: 'signout-e' })
  const { page, server } = ed
  await openDialog(page)
  await clearBtn(page, 'hoodie-b').click()
  await waitStatus(page, 'hoodie-b', 'Saved')
  const b = server.calls[server.calls.length - 1]
  is(Array.isArray(b.body.fabric) && b.body.fabric.length === 0, 'Clear sends an empty list', JSON.stringify(b && b.body))
  is((await nowOf(page, 'hoodie-b')).indexOf('Not stated') >= 0, 'the row then says "Not stated"')

  await sel(page, 'legacy-d', 0).selectOption('nylon')
  await saveBtn(page, 'legacy-d').click()
  await waitStatus(page, 'legacy-d', 'Ask for the database update')
  is((await statusOf(page, 'legacy-d')).indexOf('not ready') >= 0, 'a database without the column is named, not shown as an SQL error')

  await sel(page, 'signout-e', 0).selectOption('cotton')
  await saveBtn(page, 'signout-e').click()
  await waitStatus(page, 'signout-e', 'session ended')
  is((await statusOf(page, 'signout-e')).indexOf('session ended') >= 0, 'a signed-out answer is shown on the row')
  await ed.close()
}

async function scenarioEscape(browser) {
  head('7. closing with changes asks first')
  const ed = await openEditor(browser, BLOCK)
  const { page } = ed
  await openDialog(page)
  await sel(page, 'tee-a', 0).selectOption('cotton')
  let asked = false
  page.once('dialog', (d) => { asked = true; d.dismiss() })
  await page.keyboard.press('Escape')
  await sleep(300)
  is(asked && (await page.locator('[data-fab="overlay"]').count()) === 1, 'Escape asks, and Cancel keeps the dialog open')
  page.once('dialog', (d) => d.accept())
  await page.keyboard.press('Escape')
  await sleep(300)
  is((await page.locator('[data-fab="overlay"]').count()) === 0, 'accepting closes it')
  await ed.close()
}

// ---------------------------------------------------------------- run the real scenarios against the block as given
async function allScenarios(browser, block) {
  await scenarioButton(browser)
  await scenarioRead(browser)
  await scenarioMaterialsOnly(browser)
  await scenarioPercent(browser, block)
  await scenarioLimits(browser, block)
  await scenarioClear(browser)
  await scenarioEscape(browser)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
await scenarioStatic()
await allScenarios(browser, BLOCK)

// ---------------------------------------------------------------- mutation: each cut-out must turn a check red
head('8. mutation (each cut-out must fail)')
const MUTANTS = [
  {
    name: 'no total rule (shares that do not add to 100 are saved)',
    apply: (s) => s.replace("if (d.on && out.length && sum !== 100) return { ok: false, msg: t('totalBad', { n: sum }), sum: sum, body: null }", 'if (false) return null'),
    run: (b) => scenarioPercent(browser, b)
  },
  {
    name: 'no fill-the-rest (the action does nothing)',
    apply: (s) => s.replace('    f.entry.percent = f.value\n', ''),
    run: (b) => scenarioPercent(browser, b)
  },
  {
    name: 'no four-material cap',
    apply: (s) => s.replace('if (d.entries.length >= MAX_ENTRIES) return\n      d.entries.push', 'd.entries.push').replaceAll('add.disabled = d.entries.length >= MAX_ENTRIES', 'add.disabled = false'),
    run: (b) => scenarioLimits(browser, b)
  },
  {
    name: 'no duplicate rule',
    apply: (s) => s.replace("if (seen[e.material]) return { ok: false, msg: t('dup') }", ''),
    run: (b) => scenarioLimits(browser, b)
  }
]
for (const m of MUTANTS) {
  const mutated = m.apply(BLOCK)
  if (mutated === BLOCK) { is(false, `mutant applied: ${m.name}`, 'the source text was not found'); continue }
  const passBefore = pass, failBefore = fail
  const quiet = console.log
  console.log = () => {}
  let thrown = 0
  try { await m.run(mutated) } catch (e) { thrown++ }
  console.log = quiet
  const newFails = fail - failBefore
  pass = passBefore; fail = failBefore
  is(newFails > 0 || thrown > 0, `mutation red: ${m.name}`, `${newFails} failing check(s), ${thrown} thrown`)
}

await browser.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
