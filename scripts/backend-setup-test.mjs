/**
 * The 2026-10-04 backend work ("improve all backend setup"), measured:
 *
 *   node scripts/backend-setup-test.mjs        (npm run test:backend-setup)
 *
 *   A. setup_status — gated; one row per item with a STATE and never a value; placeholder credentials
 *      are their own state (the sandbox's SANDBOX_NOT_A_REAL_* CBK keys read as "placeholder", not ready).
 *   B. The Setup screen — a nav button, rows drawn from the route, "Open …" lands on the named screen,
 *      the bundle's screen comes back on any other nav click.
 *   C. panel-tidy — Settings cards fold, the fold is remembered across a reload, Collapse all / Expand all,
 *      the heading's accessible name is untouched, and focusing a field inside a folded card opens it.
 *   D. cron-backup.php — refuses without the key, writes a gzipped backup OUTSIDE the docroot at 0600 in a
 *      0700 directory, the file is the same export the Backup card gives (same tables, TOTP secret null),
 *      retention keeps the newest N, and the state it prints names counts, never rows.
 *
 * Mutations (MUTATE=1): setup_status printing a credential value (A catches it by scanning the body for
 * the sandbox's own placeholder strings and the cron key).
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'
const ROOT = new URL('../', import.meta.url).pathname
const ADMIN_PHP = ROOT + 'sporta-site/public_html/api/admin.php'
const BACKUP_DIR = ROOT + 'backups'   // dirname(public_html/api, 3) from the sandbox's docroot
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const cfg = JSON.parse(execFileSync('php', ['-r', 'echo json_encode(require $argv[1]);', ROOT + 'sporta-site/public_html/api/config.php'], { encoding: 'utf8' }))
const payCfg = JSON.parse(execFileSync('php', ['-r', 'echo json_encode((array) @include $argv[1]);', ROOT + 'sporta-site/public_html/pay/config.php'], { encoding: 'utf8' }))
sql('delete from rate_limit')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const admin = async (route, body) => {
  const r = body
    ? await ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
    : await ctx.request.get(`${BASE}/api/admin.php?r=${route}`, { headers: { 'X-Sporta-Admin': '1' }, failOnStatusCode: false })
  const text = await r.text()
  let j = null; try { j = JSON.parse(text) } catch {}
  return { status: r.status(), j, text }
}
const original = readFileSync(ADMIN_PHP, 'utf8')
const restore = () => writeFileSync(ADMIN_PHP, original)

try {
  /* ------------------------------------------------------------------ A. setup_status */
  const anon = await fetch(`${BASE}/api/admin.php?r=setup_status`, { headers: { 'X-Sporta-Admin': '1' } })
  check(anon.status === 401, 'A1 a visitor cannot read the setup state', String(anon.status))
  const login = await admin('login', { email: EMAIL, password: PASSWORD })
  check(login.status === 200, 'A0 signed in', String(login.status))
  const st = await admin('setup_status')
  const items = st.j?.items || []
  check(st.status === 200 && items.length >= 20, 'A2 the route lists the setup items', `${st.status} ${items.length}`)
  const states = new Set(items.map((i) => i.state))
  check([...states].every((s) => ['ready', 'partial', 'placeholder', 'missing'].includes(s)), 'A3 every item carries one of the four states', [...states].join())
  const cbk = items.find((i) => i.key === 'cbk')
  check(cbk?.state === 'placeholder', 'A4 the sandbox\'s SANDBOX_NOT_A_REAL_* bank credentials read as "placeholder", not ready', JSON.stringify(cbk))
  const secrets = [cfg.cron_key, cfg.db_pass, payCfg.client_secret, payCfg.encrp_key, payCfg.client_id].filter((v) => typeof v === 'string' && v.length >= 6)
  check(secrets.length >= 2 && secrets.every((v) => !st.text.includes(v)), 'A5 no credential value appears in the body — states only', secrets.filter((v) => st.text.includes(v)).map((v) => v.slice(0, 4) + '…').join())
  check(!/"(token|secret|password|key_value|client_secret)"\s*:/.test(st.text), 'A6 and no field is named like a secret')
  const sum = st.j?.summary || {}
  check(Object.values(sum).reduce((a, b) => a + b, 0) === items.length, 'A7 the summary adds up to the item count', JSON.stringify(sum))
  const photos = items.find((i) => i.key === 'product_photos')
  const want = Number(sql('select count(distinct p.slug) from products p join product_images i on i.slug = p.slug where p.active = 1'))
  check(photos && photos.with === want, 'A8 the product-photos count is the database\'s', `${photos?.with} vs ${want}`)
  if (process.env.MUTATE) {
    writeFileSync(ADMIN_PHP, original.replace("$add('cron_key', $keys($cfg, ['cron_key']), 'config');", "$add('cron_key', $keys($cfg, ['cron_key']), 'config', ['value' => (string) ($cfg['cron_key'] ?? '')]);"))
    const leaky = await admin('setup_status'); restore()
    check(!leaky.text.includes(cfg.cron_key), 'MUTATION (should FAIL): the route printing the cron key is caught by A5')
  }

  /* ------------------------------------------------------------------ B. the Setup screen */
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  const nav = await p.$$('.admin-sidebar button[data-spsetup-nav]')
  check(nav.length === 1, 'B1 one Setup button in the sidebar', String(nav.length))
  await nav[0].click(); await p.waitForTimeout(2000)
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-spsetup-item]')].map((r) => [r.dataset.spsetupItem, r.dataset.state]))
  check(rows.length === items.length && rows.every(([k, s]) => items.find((i) => i.key === k)?.state === s), 'B2 the screen draws one row per item with the route\'s state', `${rows.length} rows`)
  check(await p.evaluate(() => [...document.querySelectorAll('.admin-content > *')].filter((n) => !n.hasAttribute('data-spsetup') && getComputedStyle(n).display !== 'none' && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE').length === 0), 'B3 the bundle\'s screen is hidden while Setup is open')
  check(await p.evaluate(() => [...document.querySelectorAll('.spsetup-where')].some((n) => /api\/config\.php/.test(n.textContent))), 'B4 server-side keys say they live in api/config.php')
  await p.evaluate(() => [...document.querySelectorAll('.spsetup-go')].find((b) => /Open SEO/.test(b.textContent)).click()); await p.waitForTimeout(1500)
  check(await p.evaluate(() => !document.querySelector('[data-spsetup]') && !!document.querySelector('[data-spseo]')), 'B5 "Open SEO" closes Setup and opens the SEO screen')
  await p.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((b) => /^\s*Orders\s*$/.test(b.textContent)).click()); await p.waitForTimeout(1500)
  check(await p.evaluate(() => !document.querySelector('[data-spsetup]') && !document.querySelector('.admin-content.spsetup-on') && /Orders/.test(document.querySelector('.admin-content h1')?.textContent || '')), 'B6 another nav click gives the bundle its screen back')

  /* ------------------------------------------------------------------ C. panel-tidy */
  await p.evaluate(() => localStorage.removeItem('sporta_panel_tidy'))
  await p.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((b) => /^\s*Settings\s*$/.test(b.textContent)).click()); await p.waitForTimeout(2500)
  const cards = await p.evaluate(() => [...document.querySelectorAll('.admin-content > section.pt-card')].map((s) => ({ title: s.querySelector(':scope > h2').textContent.trim(), closed: s.classList.contains('pt-closed'), h: s.getBoundingClientRect().height })))
  check(cards.length >= 3 && cards.every((c) => !c.closed), 'C1 Settings cards are foldable and start OPEN', `${cards.length} cards`)
  check(await p.evaluate(() => !!document.querySelector('.admin-content > .pt-bar')), 'C2 a Collapse all / Expand all bar is there')
  const title0 = cards[0].title
  const nameBefore = await p.evaluate(() => document.querySelector('.admin-content > section.pt-card > h2').textContent.trim())
  await p.evaluate(() => document.querySelector('.admin-content > section.pt-card > .pt-toggle').click()); await p.waitForTimeout(300)
  const after = await p.evaluate(() => { const s = document.querySelector('.admin-content > section.pt-card'); return { closed: s.classList.contains('pt-closed'), h: s.getBoundingClientRect().height, name: s.querySelector(':scope > h2').textContent.trim(), expanded: s.querySelector(':scope > .pt-toggle').getAttribute('aria-expanded') } })
  check(after.closed && after.h < cards[0].h / 2 && after.expanded === 'false', 'C3 the toggle folds the card', `${Math.round(cards[0].h)} -> ${Math.round(after.h)}px`)
  check(after.name === nameBefore && after.name === title0, 'C4 the heading\'s text is untouched by the toggle', after.name)
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  await p.evaluate(() => [...document.querySelectorAll('.admin-sidebar button')].find((b) => /^\s*Settings\s*$/.test(b.textContent)).click()); await p.waitForTimeout(2500)
  check(await p.evaluate((t) => { const s = [...document.querySelectorAll('.admin-content > section.pt-card')].find((x) => x.querySelector(':scope > h2').textContent.trim() === t); return s && s.classList.contains('pt-closed') }, title0), 'C5 the fold survives a reload (remembered per card title)')
  // The save bar writes a result into a card's note; a refusal must not stay behind a fold.
  const noted = await p.evaluate(async (t) => { const s = [...document.querySelectorAll('.admin-content > section.pt-card')].find((x) => x.querySelector(':scope > h2').textContent.trim() === t); const n = s.querySelector('p[class$="-note"], p[class*="-note"]') || s.querySelector('p:last-of-type'); if (!n) return 'no-note'; n.textContent = 'Refused: rig'; await new Promise((r) => setTimeout(r, 100)); return s.classList.contains('pt-closed') ? 'still-closed' : 'opened' }, title0)
  check(noted === 'opened', 'C6 a note written into a folded card (a save result) opens it', noted)
  await p.evaluate(() => [...document.querySelectorAll('.pt-bar button')].find((b) => /Collapse all/.test(b.textContent)).click()); await p.waitForTimeout(300)
  const heights = await p.evaluate(() => ({ closed: document.querySelectorAll('.admin-content > section.pt-closed').length, all: document.querySelectorAll('.admin-content > section.pt-card').length, page: document.documentElement.scrollHeight }))
  check(heights.closed === heights.all, 'C7 Collapse all folds every card', JSON.stringify(heights))
  await p.evaluate(() => [...document.querySelectorAll('.pt-bar button')].find((b) => /Expand all/.test(b.textContent)).click()); await p.waitForTimeout(300)
  check(await p.evaluate(() => document.querySelectorAll('.admin-content > section.pt-closed').length === 0 && localStorage.getItem('sporta_panel_tidy') === '{}'), 'C8 Expand all opens them and forgets the folds')
  check(await p.evaluate(() => document.querySelectorAll('.admin-content [data-spseo] .pt-toggle, .admin-content [data-spsetup] .pt-toggle').length === 0), 'C9 the overlay screens\' own sections get no fold')
  check(errs.length === 0, 'C10 no script errors on the panel', errs.join(' | ').slice(0, 120))
  await p.close()

  /* ------------------------------------------------------------------ D. cron-backup.php */
  rmSync(BACKUP_DIR, { recursive: true, force: true })
  const noKey = await fetch(`${BASE}/api/cron-backup.php`)
  check(noKey.status === 403 && !existsSync(BACKUP_DIR), 'D1 without the key: 403 and nothing written', String(noKey.status))
  const wrongKey = await fetch(`${BASE}/api/cron-backup.php?key=${encodeURIComponent(cfg.cron_key + 'x')}`)
  check(wrongKey.status === 403 && !existsSync(BACKUP_DIR), 'D2 with a wrong key: 403 and nothing written', String(wrongKey.status))
  sql(`update admin_users set totp_secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' where email = '${EMAIL}'`)
  const run = await fetch(`${BASE}/api/cron-backup.php?key=${encodeURIComponent(cfg.cron_key)}`)
  const rj = await run.json().catch(() => null)
  check(run.status === 200 && rj?.ok === true && rj.tables >= 10 && rj.rows > 0, 'D3 with the key: a backup is written and the state names tables and rows', JSON.stringify(rj))
  const files = existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).filter((f) => /^sporta-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)) : []
  check(files.length === 1 && files[0] === rj?.file, 'D4 one file, named by the date, in <home>/backups outside the docroot', files.join())
  const dirMode = existsSync(BACKUP_DIR) ? (statSync(BACKUP_DIR).mode & 0o777) : 0
  const fileMode = files[0] ? (statSync(`${BACKUP_DIR}/${files[0]}`).mode & 0o777) : 0
  check(dirMode === 0o700 && fileMode === 0o600, 'D5 directory 0700, file 0600', `${dirMode.toString(8)} ${fileMode.toString(8)}`)
  let data = null
  try { data = JSON.parse(gunzipSync(readFileSync(`${BACKUP_DIR}/${files[0]}`)).toString('utf8')) } catch {}
  const exp = await admin('backup_export')
  check(data && exp.j && Object.keys(data.tables || {}).sort().join() === Object.keys(exp.j.tables || {}).sort().join(), 'D6 the file holds the same tables as the Backup card\'s export', Object.keys(data?.tables || {}).length + ' tables')
  const me = (data?.tables?.admin_users || []).find((a) => a.email === EMAIL)
  check(me && me.totp_secret === null, 'D7 the TOTP secret is null in the file (the same redaction as the card)', JSON.stringify(me && { email: me.email, totp_secret: me.totp_secret }))
  check(!JSON.stringify(rj).includes(EMAIL) && !/"rows":\s*\[/.test(JSON.stringify(rj)), 'D8 the state printed names no row and no email')
  // retention: plant old files beyond the keep count and run again
  mkdirSync(BACKUP_DIR, { recursive: true })
  for (let i = 1; i <= 16; i++) writeFileSync(`${BACKUP_DIR}/sporta-2020-01-${String(i).padStart(2, '0')}.json.gz`, 'x')
  const run2 = await (await fetch(`${BASE}/api/cron-backup.php?key=${encodeURIComponent(cfg.cron_key)}`)).json().catch(() => null)
  const left = readdirSync(BACKUP_DIR).filter((f) => /^sporta-.*\.json\.gz$/.test(f)).sort()
  check(run2?.kept === 14 && run2.removed === 3 && left.length === 14 && left[left.length - 1] === rj.file && !left.includes('sporta-2020-01-01.json.gz'), 'D9 retention keeps the newest 14 and removes the oldest', `kept=${run2?.kept} removed=${run2?.removed} left=${left.length}`)
} finally {
  restore()
  sql(`update admin_users set totp_secret = null where email = '${EMAIL}'`)
  rmSync(BACKUP_DIR, { recursive: true, force: true })
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — a setup checklist that shows states only, foldable cards, and a daily backup outside the docroot')
process.exit(fails ? 1 : 0)
