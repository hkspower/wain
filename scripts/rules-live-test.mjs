/**
 * assets/rules-live.js — the storefront says what /backends says.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/rules-live-test.mjs
 *
 * Drives a real browser against the sandbox twice:
 *
 *   AT THE DEFAULTS  the shop's copy is untouched ("14-day", "1 KWD") and all
 *                    six governorates are offered. The script must be a no-op
 *                    for a shop whose owner never changed a rule.
 *   WITH RULES SET   3-day returns, a 2.500 KWD fee and four governorates: the
 *                    copy follows in both languages (Arabic count agreement
 *                    included), product PRICES are left alone, the checkout
 *                    hides the two switched-off governorates, and an area
 *                    auto-fill that lands on one is put back to "choose" in
 *                    React's own state, with a note saying why.
 *
 * The rules row is written straight into the sandbox's settings table and the
 * ORIGINAL row is put back in a finally: a rig that leaves a 3-day window
 * behind changes what every later rig measures.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cagliari-calcio-sweatshirt-navy'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta',
  '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names', '-e', q], { encoding: 'utf8' })
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const original = sql("select value from settings where name = 'rules'").trim()
const base = original ? JSON.parse(original) : {}
const setRules = (v) => sql(`replace into settings (name, value) values ('rules', '${esc(JSON.stringify(v))}')`)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

async function pageText(path) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  const t = await p.evaluate(() => document.body.innerText)
  await p.close()
  return t
}

async function checkoutPage(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/product/${SLUG}?lang=en`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /^M$/ }).first().click()
  await p.getByRole('button', { name: /^Add$/ }).first().click()
  await p.waitForTimeout(500)
  await p.goto(`${BASE}/checkout${lang}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return { p, ctx }
}

const offered = (p) => p.evaluate(() => [...document.getElementById('f-governorate').options]
  .filter((o) => o.value && !o.hidden && !o.disabled).map((o) => o.value))

try {
  /* ------------------------------------------------------- 1. defaults */
  setRules({ ...base, return_days: 14, delivery_fee_fils: 1000,
    governorates: ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'] })
  {
    const en = await pageText(`/product/${SLUG}?lang=en`)
    check(/14-day/.test(en) && /1 KWD/.test(en), 'at the defaults the product page copy is untouched',
      en.match(/.{0,30}(day|KWD).{0,20}/g)?.join(' | '))
    const { p, ctx } = await checkoutPage('?lang=en')
    const opts = await offered(p)
    check(opts.length === 6, 'at the defaults all six governorates are offered', opts.join(','))
    await ctx.close()
  }

  /* ---------------------------------------------------- 2. rules changed */
  setRules({ ...base, return_days: 3, delivery_fee_fils: 2500,
    governorates: ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer'] })
  {
    const en = await pageText(`/product/${SLUG}?lang=en`)
    check(/3-day returns/.test(en), 'English: "Free 3-day returns"', en.match(/.{0,20}-day.{0,20}/g)?.join(' | '))
    check(!/14-day|14 days/.test(en), 'English: no "14-day" left on the product page')
    check(/2\.500 KWD/.test(en) && !/\b1 KWD\b/.test(en), 'English: the fee reads 2.500 KWD',
      en.match(/.{0,25}KWD.{0,10}/g)?.join(' | '))
    // \s, not a space: the bundle prints prices with a NO-BREAK space (U+00A0),
    // and a literal space made this check fail on a correct page.
    check(/10\.000\s*KWD|KWD\s*10\.000/.test(en), 'English: the product PRICE is untouched (10.000 KWD)')

    const ar = await pageText(`/product/${SLUG}`)
    check(/٣ أيام/.test(ar), 'Arabic: 3 days in the plural form "٣ أيام", not "٣ يومًا"',
      ar.match(/.{0,20}(يوم|أيام).{0,10}/g)?.join(' | '))
    check(!/١٤\s*يوم/.test(ar), 'Arabic: no "١٤ يومًا" left on the product page')
    check(/٢\.٥٠٠ د\.ك/.test(ar), 'Arabic: the fee reads ٢.٥٠٠ د.ك', ar.match(/.{0,20}د\.ك.{0,5}/g)?.join(' | '))

    const home = await pageText('/?lang=en')
    check(!/14-day|14 days/.test(home), 'English home page: no "14" returns copy left')

    const { p, ctx } = await checkoutPage('?lang=en')
    const opts = await offered(p)
    check(opts.join(',') === 'capital,hawalli,farwaniya,mubarak-al-kabeer',
      'the checkout offers only the four governorates in the rule', opts.join(','))

    // What the bundle's area auto-fill does: set the value through the
    // select's own change event. The script must put it back.
    await p.evaluate(() => {
      const s = document.getElementById('f-governorate')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'jahra')
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await p.waitForTimeout(400)
    const after = await p.evaluate(() => ({
      v: document.getElementById('f-governorate').value,
      note: document.querySelector('[data-sporta-gov-note]')?.textContent || '',
    }))
    check(after.v === '', 'a switched-off governorate set by auto-fill is put back to "choose"', JSON.stringify(after))
    check(/Jahra/.test(after.note), 'and a note under the field names it', after.note)

    // React's state, not only the DOM: choosing an allowed one must stick and
    // clear the note, which it only does if React is still driving the field.
    await p.selectOption('#f-governorate', 'hawalli')
    await p.waitForTimeout(400)
    const ok = await p.evaluate(() => ({
      v: document.getElementById('f-governorate').value,
      note: !!document.querySelector('[data-sporta-gov-note]'),
    }))
    check(ok.v === 'hawalli' && !ok.note, 'choosing an allowed governorate afterwards works and clears the note',
      JSON.stringify(ok))
    await ctx.close()
  }
} finally {
  if (original) sql(`replace into settings (name, value) values ('rules', '${esc(original)}')`)
  else sql("delete from settings where name = 'rules'")
  await browser.close()
  const back = sql("select value from settings where name = 'rules'").trim()
  check(back === original, 'the original rules row was restored for the next rig')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the shop says, and offers, what /backends says')
process.exit(fails ? 1 : 0)
