/**
 * The Social media setup in /backends and the icons it puts in the footer.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/social-links-test.mjs
 *
 * Asked for 2026-10-01: a Social media setup in the panel, and footer icons linking to Snapchat,
 * Instagram, YouTube, TikTok and WhatsApp Business. Three halves, because each fails alone:
 *
 *   SERVER   what is typed is normalised to ONE https URL on that network's own domain, and
 *            anything else is refused BY NAME — including the lookalikes (instagram.com.evil.com,
 *            evil.com/instagram.com), http, credentials in the URL, javascript:, and a network's
 *            bare front page. These icons sit in the footer of every page; a pasted redirect must
 *            never turn one into a link to a stranger. A visitor cannot save at all.
 *   PANEL    the card is on Settings and nowhere else, saves through settings_save, and refills
 *            from the server's answer (so what it shows is what was kept).
 *   FOOTER   five icons in the shop's order, each pointing where the owner said, opening in a
 *            new tab with rel=noopener and an accessible name; Snapchat and YouTube exist only
 *            once filled in, and an EMPTY box never takes away the three the footer already had.
 *
 * The `social` settings row is put back (deleted) at the end.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const saved = sql("select quote(value) from settings where name = 'social'") || null

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1300 } })

const admin = (route, body) => ctx.request.post(`${BASE}/api/admin.php?r=${route}`, {
  headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false,
})
const save = async (v) => { const r = await admin('settings_save', { name: 'social', value: v }); return { status: r.status(), body: await r.json().catch(() => null) } }
const pub = async () => (await (await fetch(`${BASE}/api/api.php?r=social`)).json())

try {
  // ---------------------------------------------------------------- SERVER
  const anon = await fetch(`${BASE}/api/admin.php?r=settings_save`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: JSON.stringify({ name: 'social', value: { instagram: 'x' } }) })
  check(anon.status === 401, 'a visitor cannot save the social links', String(anon.status))

  await admin('login', { email: EMAIL, password: PASSWORD })
  const good = await save({ instagram: '@sporta.kw', snapchat: 'https://www.snapchat.com/add/sporta.kw', youtube: '@sportakw', tiktok: 'tiktok.com/@sporta.kw', whatsapp: '55512345' })
  check(good.status === 200 && !good.body?.error, 'valid links in several spellings are accepted', JSON.stringify(good.body))
  const p = await pub()
  check(p.instagram === 'https://www.instagram.com/sporta.kw', 'an Instagram handle becomes its profile link', p.instagram)
  check(p.snapchat === 'https://www.snapchat.com/add/sporta.kw', 'a Snapchat link is kept', p.snapchat)
  check(p.youtube === 'https://www.youtube.com/@sportakw', 'a YouTube @handle becomes a channel link', p.youtube)
  check(p.tiktok === 'https://www.tiktok.com/@sporta.kw', 'a bare tiktok.com/@name gains https', p.tiktok)
  check(p.whatsapp === 'https://wa.me/96555512345', 'an eight-digit Kuwaiti number becomes a wa.me link with 965', p.whatsapp)
  const wl = await save({ whatsapp: 'https://wa.link/abc123' })
  check((await pub()).whatsapp === 'https://wa.link/abc123' && wl.status === 200, 'a wa.link business link is accepted')

  const refuse = async (kind, value, why) => {
    const r = await save({ [kind]: value })
    check(r.status === 400 && r.body?.error === `invalid_${kind}`, `refused: ${why}`, `${value} -> ${r.status} ${r.body?.error ?? ''}`)
  }
  await refuse('instagram', 'https://evil.com/sporta', 'a link to another site')
  await refuse('instagram', 'https://instagram.com.evil.com/sporta', 'a lookalike host (instagram.com.evil.com)')
  await refuse('instagram', 'https://evil.com/instagram.com/sporta', 'the network name in the path of another host')
  await refuse('instagram', 'http://www.instagram.com/sporta', 'plain http')
  await refuse('instagram', 'javascript:alert(1)', 'a javascript: link')
  await refuse('instagram', 'https://user:pw@www.instagram.com/sporta', 'credentials in the URL')
  await refuse('youtube', 'https://www.youtube.com/', "YouTube's front page, which is not a channel")
  await refuse('tiktok', 'sporta kw', 'a handle with a space')
  await refuse('whatsapp', 'call me', 'text where a number is expected')
  await refuse('snapchat', 'https://www.tiktok.com/@x', "another network's link in the wrong box")

  // ----------------------------------------------------------------- PANEL
  sql("delete from settings where name = 'social'")
  const page = await ctx.newPage()
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
  const card = page.locator('[data-sporta-panel="social"]')
  check(await card.count() === 0, 'the card is not on the sign-in screen')
  await page.getByText('Orders', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.getByText('Settings', { exact: true }).first().click(); await page.waitForTimeout(2200)
  check(await card.count() === 1 && await card.locator('input').count() === 5, 'the Social media card is on Settings with five fields')
  await page.getByText('Orders', { exact: true }).first().click(); await page.waitForTimeout(1500)
  check(await card.count() === 0, 'and it is gone on another screen')
  await page.getByText('Settings', { exact: true }).first().click(); await page.waitForTimeout(2200)

  await card.locator('#ssu-youtube').fill('@sportakw')
  await card.locator('#ssu-snapchat').fill('sporta.kw')
  await card.locator('#ssu-instagram').fill('https://evil.com/x')
  await card.getByRole('button', { name: /^Save social media links$/ }).evaluate((b) => b.click()); await page.waitForTimeout(1200)
  check(/not a Instagram link/i.test(await card.locator('.ssu-note').innerText()), 'a bad link is refused in words, naming the network', await card.locator('.ssu-note').innerText())
  check(await card.locator('#ssu-youtube').inputValue() === '@sportakw', 'and what was typed survives the refusal')
  await card.locator('#ssu-instagram').fill('')
  await card.getByRole('button', { name: /^Save social media links$/ }).evaluate((b) => b.click()); await page.waitForTimeout(1500)
  check(/Saved/.test(await card.locator('.ssu-note').innerText()), 'a good save says so')
  check(await card.locator('#ssu-youtube').inputValue() === 'https://www.youtube.com/@sportakw', 'and the boxes show what the server kept (the handle became a link)', await card.locator('#ssu-youtube').inputValue())
  const row = JSON.parse(sql("select value from settings where name='social'") || '{}')
  check(row.youtube === 'https://www.youtube.com/@sportakw' && row.snapchat === 'https://www.snapchat.com/add/sporta.kw', 'and it is stored', JSON.stringify(row))
  await page.close()

  // ---------------------------------------------------------------- FOOTER
  const read = (pg) => pg.evaluate(() => { const first = document.querySelector('footer a[href*="instagram.com"]'); const row = first ? first.parentElement : null; return row ? [...row.children].filter((a) => a.tagName === 'A') : [] }).then(() => pg.evaluate(() => { const first = document.querySelector('footer a[href*="instagram.com"]'); const row = first ? first.parentElement : null; return (row ? [...row.querySelectorAll('a')] : []).filter((a) => /instagram|snapchat|tiktok|youtube|wa\.me|whatsapp/.test(a.href)).map((a) => ({ href: a.href, label: a.getAttribute('aria-label'), target: a.target, rel: a.rel, hidden: a.hidden, order: 0 })) }))
  const shop = await ctx.newPage()
  await shop.goto(`${BASE}/?lang=en`); await shop.waitForTimeout(3500)
  let icons = (await read(shop)).filter((i) => !i.hidden)
  check(icons.some((i) => /youtube\.com\/@sportakw/.test(i.href)) && icons.some((i) => /snapchat\.com\/add\/sporta\.kw/.test(i.href)),
    'with only Snapchat and YouTube filled in, both icons appear in the footer', JSON.stringify(icons.map((i) => i.href)))
  check(icons.some((i) => /instagram\.com/.test(i.href)) && icons.some((i) => /tiktok\.com/.test(i.href)) && icons.some((i) => /wa\.me|whatsapp/.test(i.href)),
    'and the three the footer already had are still there — an empty box takes nothing away')
  const yt = icons.find((i) => /youtube/.test(i.href))
  check(yt?.target === '_blank' && /noopener/.test(yt?.rel ?? '') && yt?.label === 'YouTube', 'the icons open in a new tab with rel=noopener and an accessible name', JSON.stringify(yt))

  await save({ instagram: 'sporta.kw', snapchat: 'sporta.kw', youtube: '@sportakw', tiktok: '@sporta.kw', whatsapp: '55512345' })
  await shop.reload(); await shop.waitForTimeout(3500)
  icons = (await read(shop)).filter((i) => !i.hidden)
  const order = icons.map((i) => (i.href.match(/instagram|snapchat|tiktok|youtube|wa\.me|whatsapp/) ?? [''])[0].replace('whatsapp', 'wa.me'))
  check(JSON.stringify(order) === JSON.stringify(['instagram', 'snapchat', 'tiktok', 'youtube', 'wa.me']), 'all five sit in the shop\'s order', order.join(' '))
  check(icons.find((i) => /wa\.me/.test(i.href))?.href === 'https://wa.me/96555512345', 'WhatsApp points at the Business link set in the panel')
  check(icons.every((i) => i.label), 'every icon has an accessible name', JSON.stringify(icons.map((i) => i.label)))
  const ar = await ctx.newPage()
  await ar.goto(`${BASE}/?lang=ar`); await ar.waitForTimeout(3500)
  const arLabels = (await read(ar)).filter((i) => !i.hidden).map((i) => i.label)
  check(arLabels.includes('يوتيوب') && arLabels.includes('سناب شات'), 'and in Arabic the names are Arabic', arLabels.join(' | '))

  // THE ROW DOES NOT GROW. An earlier draft made a fresh Snapchat/YouTube clone on every pass
  // (the clone still carried Instagram's link, so nothing ever found it) — a loop that added
  // hundreds of nodes. Count the row, wait, count again.
  const rowSize = () => shop.evaluate(() => document.querySelector('footer a[href*="instagram.com"]').parentElement.children.length)
  const n1 = await rowSize(); await shop.waitForTimeout(2500); const n2 = await rowSize()
  check(n1 === 5 && n2 === 5, 'the icon row holds exactly five icons and does not grow', `${n1} then ${n2}`)

  // clearing the new two removes their icons again
  await save({ instagram: '', snapchat: '', youtube: '', tiktok: '', whatsapp: '' })
  await shop.reload(); await shop.waitForTimeout(3500)
  icons = (await read(shop)).filter((i) => !i.hidden)
  check(!icons.some((i) => /youtube|snapchat/.test(i.href)), 'clearing Snapchat and YouTube removes their icons', JSON.stringify(icons.map((i) => i.href)))
  const m1 = await rowSize(); await shop.waitForTimeout(2500); const m2 = await rowSize()
  check(m1 === m2 && m2 <= 5, 'and the emptied row is stable too (hidden, never re-made)', `${m1} then ${m2}`)
} finally {
  if (saved !== null) sql(`insert into settings (name, value) values ('social', ${saved}) on duplicate key update value = ${saved}`)
  else sql("delete from settings where name = 'social'")
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — setup, refusals and footer icons')
process.exit(fails ? 1 : 0)
