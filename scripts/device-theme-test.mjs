/**
 * Phone and desktop theme overrides, 2026-10-02.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/device-theme-test.mjs
 *
 * Proves, in a real browser:
 *   1. the panel card saves a PHONE override through settings_save;
 *   2. the storefront applies it below 768px and NOT at 1280px, and a desktop
 *      override the other way round (read back as the computed header colour);
 *   3. the older whole-row editors keep the overrides (a save from the
 *      Buttons and bars card is made, then the row is read back);
 *   4. a bad device colour is refused by name.
 * Restores the theme row in a finally.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'
const PHONE = '#16a34a', DESK = '#7c3aed', ALL = '#334455'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).trim()
const saved = sql("select quote(value) from settings where name = 'theme'") || null
const row = () => JSON.parse(sql("select value from settings where name = 'theme'") || '{}')
const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function headerVar(width) {
  const pg = await browser.newPage({ viewport: { width, height: 900 } })
  await pg.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pg.waitForFunction(() => (document.querySelector('style[data-sporta-theme]') || {}).textContent, null, { timeout: 8000 }).catch(() => {})
  const v = await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sp-header-bg').trim())
  await pg.close()
  return v
}

try {
  sql(`delete from settings where name = 'theme'`)
  sql(`delete from rate_limit`)
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  check(await p.locator('.sdt').count() === 0, 'the card is not on the sign-in screen')
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)
  await p.getByText('Settings', { exact: true }).first().click()
  await p.waitForTimeout(3000)

  check(await p.locator('.sdt').count() === 1, 'the Phone and desktop card is on Settings')
  const tabs = await p.locator('.sdt [role=tab]').allInnerTexts()
  check(tabs.join('|') === 'Phone|Desktop', 'it has a Phone and a Desktop tab', tabs.join('|'))

  // Phone header colour + phone-only CSS
  await p.fill('[data-sdt="phone:header_bg"]', PHONE)
  await p.fill('[data-sdt="phone:css"]', '.sdt-probe{color:red}')
  await p.click('[data-save="phone"]')
  await p.waitForTimeout(1500)
  let r = row()
  check(r.phone && r.phone.header_bg === PHONE, 'the phone override is stored', JSON.stringify(r.phone))
  check(r.phone && r.phone.css === '.sdt-probe{color:red}', 'with its phone-only CSS')
  check(!r.desktop || Object.keys(r.desktop).length === 0, 'and nothing was written for desktop', JSON.stringify(r.desktop))

  // Desktop
  await p.click('.sdt [data-tab=desktop]')
  await p.fill('[data-sdt="desktop:header_bg"]', DESK)
  await p.click('[data-save="desktop"]')
  await p.waitForTimeout(1500)
  r = row()
  check(r.desktop && r.desktop.header_bg === DESK, 'the desktop override is stored', JSON.stringify(r.desktop))
  check(r.phone && r.phone.header_bg === PHONE, 'and saving desktop kept phone', JSON.stringify(r.phone))

  // Old card saves the all-devices header — must keep both overrides.
  await p.fill('[data-hex="header_bg"]', ALL)
  await p.click('.stc-save')
  await p.waitForTimeout(1500)
  r = row()
  check(r.header_bg === ALL, 'the all-devices card still saves its own colour', r.header_bg)
  check(r.phone?.header_bg === PHONE && r.desktop?.header_bg === DESK,
    'and keeps both device overrides', JSON.stringify([r.phone, r.desktop]))

  // Refusal
  await p.click('.sdt [data-tab=phone]')
  const res = await p.evaluate(async () => {
    const t = await (await fetch('/api/api.php?r=theme', { cache: 'no-store' })).json()
    delete t.desktop
    t.phone = { brand: 'orange' }
    const x = await fetch('/api/admin.php?r=settings_save', { method: 'POST', credentials: 'include',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'theme', value: t }) })
    return x.json()
  })
  check(res.error === 'invalid_theme_phone_brand', 'a bad phone colour is refused by name', res.error)
  check(row().phone?.header_bg === PHONE, 'and the refusal changed nothing')
  check(errors.length === 0, 'no page errors in the panel', errors.join(' | '))
  await p.close()

  // Storefront
  const phone = await headerVar(390)
  const desk = await headerVar(1280)
  check(phone === PHONE, 'a phone-width shop uses the phone header colour', phone)
  check(desk === DESK, 'a desktop-width shop uses the desktop header colour', desk)
  const pg = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await pg.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  const bg = await pg.evaluate(() => { const h = document.querySelector('header'); return h && getComputedStyle(h).backgroundColor })
  check(bg === rgb(PHONE), 'and the phone header really paints it', bg)
  await pg.close()

  // Clear phone → falls back to all-devices
  sql(`update settings set value = json_set(value, '$.phone', json_object()) where name = 'theme'`)
  const back = await headerVar(390)
  check(back === ALL, 'an empty phone override falls back to the all-devices colour', back)
} finally {
  sql(`delete from settings where name = 'theme'`)
  if (saved && saved !== 'NULL') sql(`insert into settings (name, value) values ('theme', ${saved})`)
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — phone and desktop each get their own theme')
process.exit(fails ? 1 : 0)
