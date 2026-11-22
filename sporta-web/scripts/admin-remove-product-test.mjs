// REMOVE PRODUCT (owner request 2026-11-22: "add remove product backends"): the "Remove product" button of the Catalogue header and its
// list dialog (public/sporta-admin-brands.js, block "ADMIN REMOVE PRODUCT"), in a real browser.
//
//   npm run test:admin-remove-product   (rig-free: no database, no PHP. The admin API is a fake answered by route interception that
//                                        answers like product_delete and product_active in admin.php; the REAL add-on file, the real
//                                        public/sporta-admin-knet.css and the fixture Catalogue screen are on the page)
//
// What is asserted:
//   the button   - one "Remove product" in the Catalogue header; not on another screen; still one after a tab change
//   the list     - every product of products_all, newest first; search by name, web name or slug; the admin header on the read
//   two steps    - Remove opens a confirmation in the row and sends NOTHING; Keep it sends nothing; focus lands on Keep it;
//                  only "Remove for good" sends ONE product_delete {id} (admin header, JSON body)
//   removed      - 200 takes the row away and says so; 404 (someone else removed it) takes it away as already removed
//   refused      - 409 product_in_orders / product_has_stock / product_has_stock_history / product_in_use: the row says which rule
//                  holds; "Turn it off instead" appears only on a product that is ON; it sends ONE product_active {id, active:false}
//                  and the row becomes hidden; a hidden product gets its reason and no turn-off button
//   failures     - 401 says the sign-in expired and removes nothing; a dropped connection says nothing was removed
//   closing      - after a change, Close reloads the screen (the compiled list is then fresh); with no change it does not;
//                  Escape closes and returns focus to the button; Tab stays inside the dialog
//   layout       - Arabic labels and an RTL dialog; no sideways scroll at 390 px; 44 px targets in the dialog on a phone; no page error
//   MUTATIONS    - the confirm step, the turn-off offer, the reload and the admin header are each cut in turn; each must turn its check red
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, PRODUCTS, SCREEN, ORDERS, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
const ORIGIN = 'https://sporta.test'
const BEGIN = '/* ===== ADMIN REMOVE PRODUCT - begin'
const END = '/* ===== ADMIN REMOVE PRODUCT - end'
const BLOCK = BRANDS_JS.slice(BRANDS_JS.indexOf(BEGIN), BRANDS_JS.indexOf(END) + END.length)
if (BRANDS_JS.indexOf(BEGIN) < 0 || BRANDS_JS.indexOf(END) < 0 || BRANDS_JS.indexOf(BEGIN) !== BRANDS_JS.lastIndexOf(BEGIN)) {
  console.log('FAIL the ADMIN REMOVE PRODUCT block is missing or appears twice'); process.exit(1)
}

let pass = 0, fail = 0, pageErrors = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const json = (status, body) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) })

// ------------------------------------------------------------------------------------------------ the fake admin API
// The answers follow admin.php: product_delete refuses with 409 and a token, removes the product and its sizes otherwise;
// product_active answers the row with active as the database gives it (a string); every call carries what it was sent with.
function makeApi() {
  return {
    rows: PRODUCTS.map((p) => ({ ...p, listed: p.active === '1' })),
    refuse: { 5: { status: 409, error: 'product_in_orders' }, 4: { status: 409, error: 'product_has_stock' },
      2: { status: 409, error: 'product_has_stock_history' }, 3: { status: 409, error: 'product_in_use' } },
    calls: [], removed: [], switched: [], signedOut: false, drop: null
  }
}
function deleteAnswer(st, body) {
  const id = body && body.id
  if (!Number.isInteger(id) || id < 1) return json(400, { error: 'invalid_product_id' })
  const row = st.rows.find((x) => x.id === id)
  if (!row) return json(404, { error: 'product_not_found' })
  const forced = st.refuse[id]
  if (forced) return json(forced.status, { error: forced.error })
  st.rows = st.rows.filter((x) => x.id !== id)
  st.removed.push(id)
  return json(200, { id, slug: row.slug, deleted: true, sizes_removed: 2 })
}
function activeAnswer(st, body) {
  const id = body && body.id
  if (!Number.isInteger(id) || id < 1) return json(400, { error: 'invalid_product_id' })
  if (typeof body.active !== 'boolean') return json(400, { error: 'invalid_active' })
  const row = st.rows.find((x) => x.id === id)
  if (!row) return json(404, { error: 'product_not_found' })
  row.active = body.active ? '1' : '0'
  row.listed = body.active === true && row.listed
  st.switched.push({ id, active: body.active })
  return json(200, { id, slug: row.slug, active: row.active })
}
async function apiRoute(page, st) {
  await page.route('**/api/admin.php**', async (r) => {
    const req = r.request()
    const name = new URL(req.url()).searchParams.get('r')
    const h = req.headers()
    const body = req.postData() ? JSON.parse(req.postData()) : null
    st.calls.push({ r: name, method: req.method(), body, sporta: h['x-sporta-admin'] || '', type: h['content-type'] || '' })
    if (st.drop === name) return r.abort('failed')
    if (!h['x-sporta-admin']) return r.fulfill(json(400, { error: 'bad_request' }))
    if (st.signedOut) return r.fulfill(json(401, { error: 'not_signed_in' }))
    if (name === 'products_all') return r.fulfill(json(200, st.rows))
    if (name === 'product_delete') return r.fulfill(deleteAnswer(st, body))
    if (name === 'product_active') return r.fulfill(activeAnswer(st, body))
    return r.fulfill(json(404, { error: 'unknown_route' }))
  })
}

// ------------------------------------------------------------------------------------------------ the page
function pageHtml({ ar = false, screen = 'catalogue' }) {
  return `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(screen === 'orders' ? ORDERS : SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`
}
let browser
async function open(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', () => { pageErrors++ })
  const st = makeApi()
  await page.route(`${ORIGIN}/backends**`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(opts) }))
  await page.route('**/fixture.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: FIXTURE_JS }))
  await page.route('**/sporta-admin-brands.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: opts.js || BRANDS_JS }))
  await apiRoute(page, st)
  await page.goto(`${ORIGIN}/backends?tab=catalogue`, { waitUntil: 'load' })
  return { ctx, page, st }
}
const rowOf = (page, id) => page.locator(`[data-spt-rm-row="${id}"]`)
const actOf = (page, id, act) => page.locator(`[data-spt-rm-id="${id}"][data-spt-rm-act="${act}"]`)
const statusOf = (page) => page.locator('[data-spt-rm="status"]').textContent()
const reasonIn = (page, id) => rowOf(page, id).locator('.spt-rm-why').textContent().catch(() => '')
const deletes = (st) => st.calls.filter((c) => c.r === 'product_delete')

async function openDialog(page) {
  await page.locator('.spt-rm-open').click()
  await page.waitForSelector('[role="dialog"] [data-spt-rm-row]', { timeout: 5000 }).catch(() => {})
}
async function removeFor(page, id) {
  await actOf(page, id, 'remove').click()
  await page.waitForSelector(`[data-spt-rm-row="${id}"] .spt-rm-sure`, { timeout: 3000 }).catch(() => {})
}
async function confirmFor(page, id) {
  await actOf(page, id, 'confirm').click()
}

// ------------------------------------------------------------------------------------------------ the flows
async function flowMain() {
  head('the button and the list')
  const { ctx, page, st } = await open(1280)
  is(await page.locator('.spt-rm-open').count() === 1, 'one "Remove product" button on the Catalogue screen')
  is(await page.locator('.admin-page-header .spt-rm-open').count() === 1, 'the button sits in the Catalogue header')
  is((await page.locator('.spt-rm-open').textContent()).trim() === 'Remove product', 'the button says "Remove product"')
  await openDialog(page)
  const listCall = st.calls.find((c) => c.r === 'products_all')
  is(!!listCall && listCall.sporta === '1', 'the list is read with the admin header (products_all)')
  is(await page.locator('[role="dialog"] [data-spt-rm-row]').count() === 6, 'the dialog lists all six products')
  is(await page.locator('[data-spt-rm-row]').first().getAttribute('data-spt-rm-row') === '6', 'newest first, as products_all gives them')
  is(/6 products/.test(await page.locator('[data-spt-rm="count"]').textContent()), 'the count says 6 products')
  await page.locator('#spt-rm-q').fill('air')
  is(await page.locator('[data-spt-rm-row]').count() === 2, 'search "air" narrows to the two Air Max products')
  await page.locator('#spt-rm-q').fill('run-sh')
  is(await page.locator('[data-spt-rm-row]').count() === 1 && (await rowOf(page, 1).count()) === 1, 'search by slug finds one product')
  await page.locator('#spt-rm-q').fill('')
  is(await page.locator('[data-spt-rm-row]').count() === 6, 'clearing the search shows all six')

  head('two steps: nothing is sent before the second click')
  await removeFor(page, 1)
  is(await page.locator('[data-spt-rm-row="1"] .spt-rm-sure').count() === 1, 'Remove opens the confirmation in the row')
  is(/Run Shorts/.test(await page.locator('[data-spt-rm-row="1"] .spt-rm-sure').textContent()), 'the confirmation names the product')
  is(deletes(st).length === 0, 'the confirmation sends nothing', String(deletes(st).length))
  is(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-spt-rm-act')) === 'keep', 'focus lands on "Keep it"')
  await actOf(page, 1, 'keep').click()
  is(await page.locator('[data-spt-rm-row="1"] .spt-rm-sure').count() === 0 && deletes(st).length === 0, '"Keep it" closes the confirmation and sends nothing')
  await removeFor(page, 1)
  await confirmFor(page, 1)
  await page.waitForFunction(() => !document.querySelector('[data-spt-rm-row="1"]'), null, { timeout: 4000 }).catch(() => {})
  const dels = deletes(st)
  is(dels.length === 1 && dels[0].body && dels[0].body.id === 1, 'Remove for good sends ONE product_delete {id: 1}', JSON.stringify(dels.map((c) => c.body)))
  is(!!dels[0] && dels[0].sporta === '1' && /application\/json/.test(dels[0].type), 'the request carries the admin header and a JSON body')
  is(await page.locator('[data-spt-rm-row]').count() === 5, 'the removed product leaves the list (five left)')
  is(/Removed Run Shorts/.test(await statusOf(page)), 'the status says the product was removed')

  head('refused: the rule is named, and a live product can be turned off')
  await removeFor(page, 5)
  await confirmFor(page, 5)
  await page.waitForSelector('[data-spt-rm-row="5"] .spt-rm-why', { timeout: 4000 }).catch(() => {})
  is(/It has been ordered/.test(await reasonIn(page, 5)), 'an ordered product is refused and the row says the order rule')
  is(await actOf(page, 5, 'off').count() === 1, 'a refused live product offers "Turn it off instead"')
  is(await rowOf(page, 5).count() === 1, 'a refused product stays in the list')
  await actOf(page, 5, 'off').click()
  await page.waitForFunction(() => /hidden from the shop/.test(document.querySelector('[data-spt-rm="status"]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {})
  is(st.switched.length === 1 && st.switched[0].id === 5 && st.switched[0].active === false, 'Turn it off instead sends ONE product_active {id: 5, active: false}', JSON.stringify(st.switched))
  is(/Air Max 90 is hidden from the shop/.test(await statusOf(page)), 'the status says the product is hidden from the shop')
  is(/Hidden from the shop/.test(await rowOf(page, 5).textContent()), 'the row now reads "Hidden from the shop"')
  is((await reasonIn(page, 5)) === '', 'the old refusal is cleared once the product is off')

  await removeFor(page, 4)
  await confirmFor(page, 4)
  await page.waitForSelector('[data-spt-rm-row="4"] .spt-rm-why', { timeout: 4000 }).catch(() => {})
  is(/still has stock on the shelf/.test(await reasonIn(page, 4)), 'a product with stock is refused and the row says the stock rule')
  is(await actOf(page, 4, 'off').count() === 1, 'a live product with stock also offers the turn-off')

  await removeFor(page, 2)
  await confirmFor(page, 2)
  await page.waitForSelector('[data-spt-rm-row="2"] .spt-rm-why', { timeout: 4000 }).catch(() => {})
  is(/counted, received or adjusted/.test(await reasonIn(page, 2)), 'a hidden product with stock history gets the history rule')
  is(await actOf(page, 2, 'off').count() === 0, 'a product that is already off gets no turn-off button')

  await removeFor(page, 3)
  await confirmFor(page, 3)
  await page.waitForSelector('[data-spt-rm-row="3"] .spt-rm-why', { timeout: 4000 }).catch(() => {})
  is(/It is in use/.test(await reasonIn(page, 3)), 'an unexpected refusal token is shown as its own sentence')

  head('someone else removed it; the sign-in expired; the connection dropped')
  st.rows = st.rows.filter((x) => x.id !== 6)
  await removeFor(page, 6)
  await confirmFor(page, 6)
  await page.waitForFunction(() => !document.querySelector('[data-spt-rm-row="6"]'), null, { timeout: 4000 }).catch(() => {})
  is(!(await rowOf(page, 6).count()) && /already removed/.test(await statusOf(page)), 'a product already gone is taken away as already removed')
  st.signedOut = true
  await removeFor(page, 4)
  await confirmFor(page, 4)
  await page.waitForFunction(() => /sign-in has expired/.test(document.querySelector('[data-spt-rm="status"]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {})
  is(/sign-in has expired/.test(await statusOf(page)) && (await rowOf(page, 4).count()) === 1, 'an expired sign-in removes nothing and says so')
  st.signedOut = false
  st.drop = 'product_delete'
  await removeFor(page, 4)
  await confirmFor(page, 4)
  await page.waitForFunction(() => /Could not reach the server/.test(document.querySelector('[data-spt-rm="status"]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {})
  is(/Nothing was removed/.test(await statusOf(page)) && (await rowOf(page, 4).count()) === 1, 'a dropped connection says nothing was removed')
  st.drop = null

  head('closing after changes; the tab bar; the keyboard')
  const reloaded = page.waitForEvent('load', { timeout: 4000 }).then(() => true, () => false)
  await page.keyboard.press('Escape')
  is(await reloaded, 'closing after a change reloads the screen, so the compiled list is fresh')
  await page.waitForSelector('.spt-rm-open', { timeout: 4000 }).catch(() => {})
  await page.evaluate((s) => { window.fx.screens.catalogue = s }, SCREEN)
  await page.locator('.admin-sidebar [data-go="orders"]').click()
  await page.locator('.admin-sidebar [data-go="catalogue"]').click()
  await page.waitForTimeout(400)
  is(await page.locator('.spt-rm-open').count() === 1, 'still one button after leaving and coming back to the Catalogue')
  await openDialog(page)
  is(await page.locator('[role="dialog"]').count() === 1, 'the dialog opens again')
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  is(await page.evaluate(() => !!document.querySelector('.spt-rm-dlg') && document.querySelector('.spt-rm-dlg').contains(document.activeElement)), 'Tab stays inside the dialog')
  await ctx.close()
}

async function flowQuiet() {
  head('closing with no change, and Escape')
  const { ctx, page } = await open(1280)
  await openDialog(page)
  const quiet = page.waitForEvent('load', { timeout: 1500 }).then(() => true, () => false)
  await page.locator('.spt-rm-x').click()
  is(!(await quiet) && (await page.locator('[role="dialog"]').count()) === 0, 'closing with no change does not reload')
  await page.locator('.spt-rm-open').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {})
  await page.keyboard.press('Escape')
  is(await page.locator('[role="dialog"]').count() === 0, 'Escape closes the dialog')
  is(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('spt-rm-open')), 'focus returns to the button after Escape')
  await ctx.close()
}

async function flowArabic() {
  head('Arabic, RTL, the phone')
  const { ctx, page } = await open(1280, { ar: true })
  is((await page.locator('.spt-rm-open').textContent()).trim() === 'إزالة منتج', 'the button is in Arabic on an Arabic page')
  await openDialog(page)
  is(await page.locator('.spt-rm-root').getAttribute('dir') === 'rtl', 'the dialog is right to left')
  is(/الإزالة تحذف/.test(await page.locator('.spt-rm-intro').textContent()), 'the intro is in Arabic')
  await removeFor(page, 1)
  is(/هل تريد إزالة/.test(await page.locator('[data-spt-rm-row="1"] .spt-rm-sure').textContent()), 'the confirmation is in Arabic')
  await ctx.close()
}

async function flowPhone() {
  const { ctx, page } = await open(390)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  is(overflow <= 0, 'no sideways scroll at 390 px', String(overflow))
  await openDialog(page)
  await removeFor(page, 1)
  const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('.spt-rm-dlg .spt-rm-btn, .spt-rm-dlg .spt-rm-x')).map((b) => Math.round(b.getBoundingClientRect().height)))
  is(sizes.length > 0 && sizes.every((h) => h >= 44), 'every button in the dialog is 44 px or taller on a phone', JSON.stringify(sizes))
  const overflow2 = await page.evaluate(() => document.querySelector('.spt-rm-dlg').scrollWidth - document.querySelector('.spt-rm-dlg').clientWidth)
  is(overflow2 <= 0, 'the dialog does not scroll sideways on a phone', String(overflow2))
  await ctx.close()
}

async function flowOtherScreens() {
  head('other screens')
  const { ctx, page } = await open(1280, { screen: 'orders' })
  is(await page.locator('.spt-rm-open').count() === 0, 'no button on another screen')
  await ctx.close()
}

// ------------------------------------------------------------------------------------------------ mutations
// Each mutant cuts ONE rule out of the block. The check it must turn red is named, and is run on its own.
const MUTANTS = [
  { name: 'Remove sends at once (no confirmation)', from: "r.st = 'confirm'; S.focus = { id: r.id, act: 'keep' }; draw()", to: 'removeRow(r)',
    check: async (page, st) => { await removeFor(page, 1); await page.waitForTimeout(200); return deletes(st).length === 0 } },
  { name: 'no "Turn it off instead" offer', from: "if (r.why && r.active && r.st === 'idle')", to: 'if (false)',
    check: async (page, st) => { await removeFor(page, 5); await confirmFor(page, 5); await page.waitForSelector('[data-spt-rm-row="5"] .spt-rm-why', { timeout: 3000 }).catch(() => {}); return (await actOf(page, 5, 'off').count()) === 1 } },
  { name: 'no reload after a change', from: 'if (reload) window.location.reload()', to: 'if (reload) void 0',
    check: async (page, st) => { await removeFor(page, 1); await confirmFor(page, 1); await page.waitForTimeout(300); const loaded = page.waitForEvent('load', { timeout: 2500 }).then(() => true, () => false); await page.locator('.spt-rm-x').click(); return await loaded } },
  { name: 'no admin header on the requests', from: "var o = { credentials: 'same-origin', headers: { 'X-Sporta-Admin': '1' } }", to: "var o = { credentials: 'same-origin', headers: {} }",
    check: async (page, st) => (await page.locator('[data-spt-rm-row]').count()) === 6 }
]

async function mutants() {
  head('mutations: each cut must turn its check red')
  for (const m of MUTANTS) {
    if (!BLOCK.includes(m.from)) { is(false, `mutant "${m.name}": its text is in the block`); continue }
    const cut = BLOCK.replace(m.from, () => m.to)
    const js = BRANDS_JS.replace(BLOCK, () => cut)
    const { ctx, page, st } = await open(1280, { js })
    await page.waitForTimeout(150)
    let green = false
    if (await page.locator('.spt-rm-open').count()) {
      await openDialog(page)
      green = await m.check(page, st).catch(() => false)
    }
    await ctx.close()
    is(green === false, `mutant "${m.name}" turns its check red`, green ? 'still green' : '')
  }
  // The real file, the same checks: every one must be green on the unmutated block.
  const { ctx, page, st } = await open(1280)
  await openDialog(page)
  is(await page.locator('[data-spt-rm-row]').count() === 6, 'on the real file the list is there (control)')
  await ctx.close()
}

// ------------------------------------------------------------------------------------------------ run
browser = await chromium.launch()
try {
  await flowMain()
  await flowQuiet()
  await flowArabic()
  await flowPhone()
  await flowOtherScreens()
  await mutants()
  head('errors')
  is(pageErrors === 0, 'no page error on any page', String(pageErrors))
} finally {
  await browser.close()
}
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
