/**
 * test:payment-cards — the /backends Payments screen, scanned and fixed 2026-10-15.
 *
 *   A  two cards save the SAME rules (payments-screen.js "Ways to pay" and rules.js "Shop rules").
 *      Untick cash on delivery in Ways to pay and save; then change only the delivery fee in Shop
 *      rules and save. Cash on delivery must still be off, and the fee must be the new one.
 *      (Before: Shop rules sent its whole form, so its stale ticks put COD back on.)
 *   B  after the Ways to pay save, the Shop rules card shows COD unticked (it re-reads)
 *   C  every credential field has a label attached (12 were unnamed to a screen reader)
 *   D  the status pills read at 4.5:1 or better (they measured 3.2:1 at 12px)
 *
 * Run `bash scripts/sandbox.sh` first. The rules row is put back exactly as it was.
 * MUTATE=whole makes Shop rules send its whole form again: A fails.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const RULES = ROOT + 'sporta-site/public_html/assets/rules.js'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const rulesOrig = readFileSync(RULES, 'utf8')
if (process.env.MUTATE === 'whole') {
  writeFileSync(RULES, rulesOrig.replace("ask('settings_save', { name: 'rules', value: changed })", "ask('settings_save', { name: 'rules', value: got.value })"))
}
const before = sql("select ifnull((select value from settings where name='rules'),'__NONE__')")
sql('delete from rate_limit; delete from rate_bucket')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const login = await ctx.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: 'manager@sporta.com.kw', password: 'correct horse' } })
  check(login.status() === 200, 'signed in', String(login.status()))
  const page = await ctx.newPage()
  // Start from a known state: all three methods on, the shipped fee.
  await ctx.request.post(`${BASE}/api/admin.php?r=settings_save`, { headers: { 'X-Sporta-Admin': '1' }, data: { name: 'rules', value: { payment_methods: ['knet', 'tpay', 'cod'], delivery_fee_fils: 1000 } } })
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.locator('[data-spps-nav]').first().evaluate((b) => b.click())
  await page.waitForSelector('.srl-save', { timeout: 15000 })
  await page.waitForTimeout(800)

  // A1 — Ways to pay: untick COD and save
  const codBox = page.locator('input.spps-sw').nth(2)
  await codBox.evaluate((b) => { if (b.checked) b.click() })
  await page.getByRole('button', { name: 'Save', exact: true }).first().evaluate((b) => b.click())
  await page.waitForTimeout(1200)
  const afterWays = JSON.parse(sql("select value from settings where name='rules'"))
  check(!afterWays.payment_methods.includes('cod'), 'A the Ways to pay card turns cash on delivery off', JSON.stringify(afterWays.payment_methods))

  // B — the Shop rules card re-read it
  const rulesCod = await page.evaluate(() => { const b = document.querySelector('input[data-list="payment_methods"][data-value="cod"]'); return b ? b.checked : null })
  check(rulesCod === false, 'B the Shop rules card shows cash on delivery unticked after the other card saved', String(rulesCod))

  // A2 — Shop rules: change only the delivery fee and save
  const fee = page.locator('input[data-rule="delivery_fee_fils"]')
  await fee.fill('1.250')
  await page.locator('.srl-save').evaluate((b) => b.click())
  await page.waitForTimeout(1200)
  const afterRules = JSON.parse(sql("select value from settings where name='rules'"))
  check(afterRules.delivery_fee_fils === 1250 || afterRules.delivery_fee_fils === '1250', 'A the Shop rules card saves the new delivery fee', String(afterRules.delivery_fee_fils))
  check(!afterRules.payment_methods.includes('cod'), 'A saving Shop rules does not turn cash on delivery back on', JSON.stringify(afterRules.payment_methods))

  // A3 — the case the fix exists for: the owner is MID-EDIT in Shop rules (so it does not re-read)
  // while Ways to pay saves a change. Type a fee, then switch COD back on in Ways to pay and save,
  // then save Shop rules. Its on-screen COD tick is now stale (off); sending the whole form would
  // switch COD off again.
  await fee.fill('1.500')
  await codBox.evaluate((b) => { if (!b.checked) b.click() })
  await page.getByRole('button', { name: 'Save', exact: true }).first().evaluate((b) => b.click())
  await page.waitForTimeout(1200)
  check(JSON.parse(sql("select value from settings where name='rules'")).payment_methods.includes('cod'), 'A cash on delivery is back on after the Ways to pay save')
  await page.locator('.srl-save').evaluate((b) => b.click())
  await page.waitForTimeout(1200)
  const afterStale = JSON.parse(sql("select value from settings where name='rules'"))
  check(String(afterStale.delivery_fee_fils) === '1500', 'A the fee typed during the other save is saved', String(afterStale.delivery_fee_fils))
  check(afterStale.payment_methods.includes('cod'), 'A a Shop rules save made while its ticks were stale does not undo the other card', JSON.stringify(afterStale.payment_methods))

  // C — labels attached
  const unlabelled = await page.evaluate(() => [...document.querySelectorAll('.spk-input')].filter((i) => !(i.labels && i.labels.length)).length)
  const total = await page.evaluate(() => document.querySelectorAll('.spk-input').length)
  check(total >= 12 && unlabelled === 0, 'C every credential field has its label attached', `${total - unlabelled}/${total}`)

  // D — pill contrast, against the white card the pills sit on
  const pills = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return [0.2126 * r + 0.7152 * g + 0.0722 * b, m[3] ?? 1, m] }
    return [...document.querySelectorAll('.spps-badge')].map((b) => {
      const cs = getComputedStyle(b); const [, a, bg] = lum(cs.backgroundColor)
      const mix = bg.slice(0, 3).map((v) => Math.round(v * a + 255 * (1 - a)))
      const Lb = lum(`rgb(${mix.join(',')})`)[0], Lt = lum(cs.color)[0]
      return [b.textContent, Math.round(((Math.max(Lb, Lt) + 0.05) / (Math.min(Lb, Lt) + 0.05)) * 100) / 100]
    })
  })
  const low = pills.filter(([t, r]) => r < 4.5 && !/^Off/.test(t))
  check(pills.length >= 3 && low.length === 0, 'D every status pill reads at 4.5:1 or better', JSON.stringify(pills))
} finally {
  await browser.close()
  if (process.env.MUTATE) writeFileSync(RULES, rulesOrig)
  if (before === '__NONE__') sql("delete from settings where name='rules'")
  else sql(`update settings set value = '${before.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' where name='rules'`)
  check(readFileSync(RULES, 'utf8') === rulesOrig, 'rules.js is back exactly as it was')
  check(sql("select ifnull((select value from settings where name='rules'),'__NONE__')") === before, 'the rules row is back exactly as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall payment-card checks passed')
  process.exitCode = fails ? 1 : 0
}
