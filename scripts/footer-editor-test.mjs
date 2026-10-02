/**
 * The Footer card in /backends (texts + link columns) and the columns it puts in the footer.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/footer-editor-test.mjs
 *
 *   SERVER   `footer_links` saves up to 4 columns of 8 links; a blank column or link is dropped;
 *            a half-filled one is refused by name with its position; a target must be a path on
 *            the shop (a #section is fine) or https — javascript:, data:, http:, //host,
 *            backslash and whitespace are refused. A visitor cannot save. The prose save does not
 *            touch the columns (they live in their own row).
 *   PANEL    a collapsed card on Settings only, one Save for both rows, refusal in words with
 *            what was typed kept, refilled from what the server kept.
 *   FOOTER   saved columns replace the two built ones (which are hidden, never removed), in the
 *            language shown, and follow a language switch; an empty list leaves the built footer.
 * Both settings rows are put back at the end.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const keep = Object.fromEntries(['footer', 'footer_links'].map((n) => [n, sql(`select quote(value) from settings where name = '${n}'`) || null]))

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1300 } })
const admin = (route, body) => ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
const save = async (columns) => { const r = await admin('settings_save', { name: 'footer_links', value: { columns } }); return { status: r.status(), body: await r.json().catch(() => null) } }
const pub = async () => (await (await fetch(`${BASE}/api/api.php?r=footer_links`)).json())
const col = (t, links) => ({ title_en: t, title_ar: t + ' ع', links })
const lk = (e, href) => ({ label_en: e, label_ar: e + ' ع', href })

try {
  const anon = await fetch(`${BASE}/api/admin.php?r=settings_save`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: JSON.stringify({ name: 'footer_links', value: { columns: [] } }) })
  check(anon.status === 401, 'a visitor cannot save the footer columns', String(anon.status))
  await admin('login', { email: EMAIL, password: PASSWORD })
  sql("delete from settings where name in ('footer','footer_links')")
  check(JSON.stringify((await pub()).columns) === '[]', 'with nothing saved the public columns are empty (built-in footer stays)')

  const good = await save([col('Help', [lk('Returns', '/returns'), lk('Shipping', '/terms#delivery'), lk('Instagram', 'https://www.instagram.com/sporta.kw')]), { title_en: '', title_ar: '', links: [{ label_en: '', label_ar: '', href: '' }] }, { title_en: '', title_ar: '', links: [] }])
  check(good.status === 200 && !good.body?.error, 'valid columns are accepted', JSON.stringify(good.body))
  const p = await pub()
  check(p.columns.length === 1 && p.columns[0].links.length === 3, 'a blank column and a blank link are dropped', JSON.stringify(p.columns.map((c) => c.links.length)))
  check(p.columns[0].links[1].href === '/terms#delivery', 'a #section on a shop path is kept')

  const refuse = async (cols, err, why) => { const r = await save(cols); check(r.status === 400 && r.body?.error === err, `refused: ${why}`, `${r.status} ${r.body?.error ?? ''}`) }
  for (const [href, why] of [['javascript:alert(1)', 'a javascript: link'], ['data:text/html,x', 'a data: link'], ['http://example.com', 'plain http'], ['//evil.com', 'a protocol-relative host'], ['/\\evil.com', 'a backslash'], ['/a b', 'a space'], ['returns', 'a bare word']]) {
    await refuse([col('X', [lk('L', href)])], 'invalid_footer_link', `${why} (${href})`)
  }
  await refuse([col('X', [{ label_en: '', label_ar: '', href: '/x' }])], 'footer_link_label_1_1', 'a link with no label')
  await refuse([col('X', [{ label_en: 'A', label_ar: '', href: '' }])], 'footer_link_target_1_1', 'a link with no address')
  await refuse([{ title_en: '', title_ar: '', links: [lk('A', '/a')] }], 'footer_column_title_1', 'a column with no title')
  await refuse([col('X', [])].map((c) => ({ ...c, links: [] })).concat([]), 'footer_column_empty_1', 'a titled column with no links')
  check(JSON.stringify((await pub()).columns[0].title_en) === '"Help"', 'a refused save changes nothing')
  const many = await save(Array.from({ length: 6 }, (_, i) => col('C' + i, Array.from({ length: 10 }, (_, j) => lk('L' + j, '/p' + j)))))
  const m = (await pub()).columns
  check(many.status === 200 && m.length === 4 && m.every((c) => c.links.length === 8), 'at most 4 columns of 8 links are kept', `${m.length}x${m[0]?.links.length}`)
  await save([col('Help', [lk('Returns', '/returns'), lk('Instagram', 'https://www.instagram.com/sporta.kw')]), col('Shop', [lk('Track', '/track')])])
  await admin('settings_save', { name: 'footer', value: { tagline_en: 'T' } })
  check((await pub()).columns.length === 2, 'saving the footer prose does not touch the columns')

  // ---------------------------------------------------------------- FOOTER
  const shop = await ctx.newPage()
  await shop.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' }); await shop.waitForTimeout(2500)
  const foot = () => shop.evaluate(() => {
    const f = document.querySelector('footer'), mine = f.querySelector('[data-sporta-footer-links]')
    const h = [...f.querySelectorAll('[data-sporta-footer-hidden]')]
    return { mine: !!mine, titles: mine ? [...mine.querySelectorAll('h2')].map((x) => x.textContent) : [], links: mine ? [...mine.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]) : [],
      hiddenVisible: h.some((x) => x.offsetHeight > 0), builtStill: h.length === 1 && h[0].querySelectorAll('h2').length === 2, count: f.querySelectorAll('[data-sporta-footer-links]').length }
  })
  let s = await foot()
  check(s.mine && s.titles.join() === 'Help,Shop', 'the saved columns are in the footer, in English', s.titles.join())
  check(s.links.length === 3 && s.links[0][1] === '/returns' && s.links[1][2] === '_blank', 'their links point where saved; https opens in a new tab', JSON.stringify(s.links))
  check(!s.hiddenVisible && s.builtStill, 'the built columns are hidden, not removed')
  await shop.evaluate(() => document.documentElement.setAttribute('lang', 'ar')); await shop.waitForTimeout(600)
  s = await foot()
  check(s.titles.join() === 'Help ع,Shop ع', 'a language switch rebuilds them in Arabic', s.titles.join())
  await shop.waitForTimeout(2000)
  check((await foot()).count === 1, 'and the footer does not grow another copy')
  await save([])
  await shop.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' }); await shop.waitForTimeout(2000)
  s = await foot().catch(() => ({ mine: true }))
  check(!s.mine, 'an empty list leaves the built footer alone')

  // ----------------------------------------------------------------- PANEL
  sql("delete from settings where name in ('footer','footer_links')")
  const page = await ctx.newPage()
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
  const card = page.locator('[data-sporta-panel="footer"]')
  check(await card.count() === 0, 'the card is not on the sign-in screen')
  await page.getByText('Orders', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1200)
  await page.getByText('Settings', { exact: true }).first().click(); await page.waitForTimeout(2200)
  check(await card.count() === 1, 'the Footer card is on Settings')
  check(await card.evaluate((d) => d.tagName === 'DETAILS' && !d.open), 'and it starts collapsed (Settings is held to a word cap)')
  await card.locator('summary').evaluate((s) => s.click())
  await card.locator('#fed-tagline-en').fill('Hello footer')
  await card.getByRole('button', { name: 'Add column' }).evaluate((b) => b.click())
  const inputs = card.locator('.fed-col input')
  await inputs.nth(0).fill('Help'); await inputs.nth(2).fill('Returns'); await inputs.nth(4).fill('javascript:x')
  await card.getByRole('button', { name: 'Save footer' }).evaluate((b) => b.click()); await page.waitForTimeout(1500)
  check(/page on this shop/.test(await card.locator('.fed-note').innerText()), 'a bad address is refused in words', await card.locator('.fed-note').innerText())
  check(await inputs.nth(4).inputValue() === 'javascript:x' && await card.locator('#fed-tagline-en').inputValue() === 'Hello footer', 'and what was typed survives the refusal')
  await inputs.nth(4).fill('/returns')
  await card.getByRole('button', { name: 'Save footer' }).evaluate((b) => b.click()); await page.waitForTimeout(1500)
  check(/Saved/.test(await card.locator('.fed-note').innerText()), 'a good save says so')
  const f = await (await fetch(`${BASE}/api/api.php?r=footer`)).json(), l = await pub()
  check(f.tagline_en === 'Hello footer' && l.columns[0]?.links[0]?.href === '/returns', 'both rows were written with one button', `${f.tagline_en} ${l.columns[0]?.links[0]?.href}`)
  await page.getByText('Orders', { exact: true }).first().click(); await page.waitForTimeout(1500)
  check(await card.count() === 0, 'and the card is gone on another screen')
} finally {
  for (const n of ['footer', 'footer_links']) {
    if (keep[n] !== null) sql(`insert into settings (name, value) values ('${n}', ${keep[n]}) on duplicate key update value = ${keep[n]}`)
    else sql(`delete from settings where name = '${n}'`)
  }
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — footer columns, card and storefront')
process.exit(fails ? 1 : 0)
