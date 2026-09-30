/**
 * An owner-editable body for Privacy, Terms and Returns.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/legal-pages-test.mjs
 *
 * Asked for on 2026-09-17 as "make editer for all policys pages at admin".
 * A `legal` settings row (privacy_en/ar, terms_en/ar, returns_en/ar), read
 * by legal-pages.js on the storefront and written by legal-editor.js's card
 * on the website panel's Settings screen — the same read/write split
 * contact and footer already use (public ?r=legal for the read, admin.php's
 * settings_save for the write).
 *
 * WITH NO OVERRIDE SET, both pages must be UNCHANGED — the bundle's own
 * numbered sections on Privacy, the bundle's own paragraph on Returns. This
 * is the state every shop starts in and it is asserted first.
 *
 * PRIVACY/TERMS ARE A PARAGRAPH LIST, split on blank lines; RETURNS IS A
 * SINGLE STRING, because that page has only ever had one paragraph of
 * prose above its order-lookup card and size/fit picker — those are
 * interactive and must stay exactly as the bundle renders them, which is
 * checked explicitly (the order-lookup input must still be there and still
 * work after an override is applied).
 *
 * SAVED THROUGH THE REAL PANEL UI, not by writing the settings row directly
 * — signs in, opens Settings, types into the actual textarea, clicks the
 * actual Save button. A rig that posts JSON straight at admin.php proves
 * the route works and nothing about whether the card that ships is wired to
 * it.
 *
 * Restores the `legal` setting to empty in a finally, whatever happens
 * above it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q], { encoding: 'utf8' })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function readPrivacyBody() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/privacy?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const info = await page.evaluate(() => {
    const main = document.querySelector('main')
    const wrapper = main.querySelector('[data-sporta-legal="body"]')
    return {
      overridden: !!wrapper,
      paragraphs: wrapper ? [...wrapper.querySelectorAll('p')].map((p) => p.textContent) : null,
      hasBuiltInSections: !!main.querySelector('.space-y-9'),
      title: main.querySelector('h1')?.textContent,
    }
  })
  await page.close()
  return info
}

async function readReturns() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/returns?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const info = await page.evaluate(() => {
    const p = document.querySelector('p.mb-8.max-w-2xl.text-slate-600')
    const orderInput = document.querySelector('input[placeholder*="SP1A2B3C4D"]')
    return {
      text: p ? p.textContent : null,
      overridden: p ? p.getAttribute('data-sporta-legal') === 'returns' : false,
      orderLookupPresent: !!orderInput,
    }
  })
  await page.close()
  return info
}

async function saveThroughPanel(privacyText, returnsText) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('form button')
  await page.waitForTimeout(1200)

  const links = await page.$$('a, button')
  for (const l of links) {
    const t = ((await l.textContent()) || '').trim()
    if (t === 'Settings') { await l.click(); break }
  }
  await page.waitForTimeout(1500)

  const found = await page.evaluate(() => !!document.querySelector('[data-sporta-legal-panel]'))
  if (!found) { await page.close(); return { cardFound: false } }

  await page.evaluate(([pv, rt]) => {
    const card = document.querySelector('[data-sporta-legal-panel]')
    var privacyEn = null
    var returnsEn = null
    var labels = card.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent.trim() === 'Privacy — English') privacyEn = labels[i].nextElementSibling
      if (labels[i].textContent.trim() === 'Returns — English') returnsEn = labels[i].nextElementSibling
    }
    privacyEn.value = pv
    privacyEn.dispatchEvent(new Event('input', { bubbles: true }))
    returnsEn.value = rt
    returnsEn.dispatchEvent(new Event('input', { bubbles: true }))
  }, [privacyText, returnsText])

  const saveBtn = await page.$('[data-sporta-legal-panel] .sle-save')
  await saveBtn.click()
  await page.waitForTimeout(1200)
  const note = await page.$eval('[data-sporta-legal-panel] .sle-note', (el) => el.textContent)
  await page.close()
  return { cardFound: true, note }
}

try {
  sql(`delete from settings where name = 'legal'`)

  {
    const p = await readPrivacyBody()
    check(!p.overridden, 'with no override, Privacy has no override wrapper', String(p.overridden))
    check(p.hasBuiltInSections, 'and its own built-in numbered sections are still there')
    check(p.title === 'Privacy policy', 'and the title is untouched', p.title)

    const r = await readReturns()
    check(!r.overridden, 'with no override, Returns has no override marker')
    check(r.orderLookupPresent, 'and its order-lookup box is still there')
  }

  const save = await saveThroughPanel(
    'From the panel, paragraph one.\n\nAnd paragraph two.',
    'A single custom line for Returns.',
  )
  check(save.cardFound, 'the Settings screen shows the policy-pages card')
  check(/Saved/.test(save.note || ''), 'saving through the real UI reports success', save.note)

  {
    const p = await readPrivacyBody()
    check(p.overridden, 'Privacy now shows the override')
    check(!p.hasBuiltInSections, 'and the bundle\'s own numbered sections are gone, not just hidden behind it')
    check(JSON.stringify(p.paragraphs) === JSON.stringify(['From the panel, paragraph one.', 'And paragraph two.']),
      'as exactly two paragraphs, split on the blank line', JSON.stringify(p.paragraphs))
    check(p.title === 'Privacy policy', 'and the title is STILL untouched', p.title)

    const r = await readReturns()
    check(r.text === 'A single custom line for Returns.', 'Returns shows the override as one line', r.text)
    check(r.orderLookupPresent, 'and its order-lookup box still works, unaffected by the paragraph swap')
  }

  sql(`delete from settings where name = 'legal'`)

  {
    const p = await readPrivacyBody()
    check(!p.overridden, 'clearing the setting removes the override again')
    check(p.hasBuiltInSections, 'and the bundle\'s own sections come back')
  }
} finally {
  sql(`delete from settings where name = 'legal'`)
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — Privacy, Terms and Returns follow the panel\'s own text, and stay built-in when it is empty')
process.exit(fails ? 1 : 0)
