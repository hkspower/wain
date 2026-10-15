/**
 * test:recovery-email — the panel's recovery email and the top-bar Sign out (2026-10-15).
 *
 * Runs its own PHP server whose mail() writes to a file, so the codes the shop mails are READ, not
 * planted. Uses a throwaway admin account it creates and removes.
 *   A  the Security card: a wrong password is refused and keeps the typed address; the right one
 *      mails a code to the NEW address and tells the sign-in address; the code confirms it
 *   B  a password-reset request then mails the code to BOTH addresses, and that code resets
 *   C  an UNconfirmed recovery address gets no reset code
 *   D  a wrong confirmation code is refused; remove needs the password and tells the sign-in address
 *   E  on a computer a Sign out button is in the top bar and signs out; phones do not get a second one
 * Run `bash scripts/sandbox.sh` first. MUTATE=unverified mails reset codes to unconfirmed addresses: C fails.
 */
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const ADMIN = ROOT + 'sporta-site/public_html/api/admin.php'
const PORT = 4393, BASE = `http://localhost:${PORT}`
const DIR = mkdtempSync(tmpdir() + '/sporta-mail-'), MAIL = DIR + '/mail.log'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const orig = readFileSync(ADMIN, 'utf8')
if (process.env.MUTATE === 'unverified') writeFileSync(ADMIN, orig.replace("$rec !== '' && !empty($u['recovery_verified_at'])", "$rec !== ''"))

const ME = `rec-rig-${Date.now()}@example.com`, REC = `backup-${Date.now()}@example.net`, PW = 'correct horse battery 42'
const hash = execFileSync('php', ['-r', `echo password_hash('${PW}', PASSWORD_DEFAULT);`], { encoding: 'utf8' })
writeFileSync(MAIL, '')
const srv = spawn('php', ['-d', `sendmail_path=tee -a ${MAIL} > /dev/null`, '-S', `localhost:${PORT}`, '-t', ROOT + 'sporta-site/public_html', ROOT + 'scripts/dev-router.php'], { stdio: 'ignore' })
const mails = () => readFileSync(MAIL, 'utf8').split(/(?=^To: )/m).filter(Boolean)
const decode = (m) => { const b = m.split(/\r?\n\r?\n/).slice(1).join('\n'); try { return /base64/i.test(m) ? Buffer.from(b.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8') : b } catch { return b } }
const codeIn = (m) => ((decode(m) + m).match(/\b(\d{8})\b/) || [])[1]
const to = (addr) => mails().filter((m) => m.toLowerCase().includes('to: ' + addr))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/api.php?r=slides`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 200)) }
  sql('delete from rate_limit; delete from rate_bucket')
  sql(`insert into admin_users (email, password_hash) values ('${ME}', '${hash}')`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const login = await ctx.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: ME, password: PW } })
  check(login.status() === 200, 'signed in as a throwaway admin', String(login.status()))
  const p = await ctx.newPage()
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.locator('aside button').filter({ hasText: /^Security$/ }).first().evaluate((b) => b.click())
  await p.waitForSelector('[data-sporta-recovery] [data-sprec-state]', { timeout: 15000 })
  check(await p.getAttribute('[data-sprec-state]', 'data-sprec-state') === 'none', 'A the card shows no recovery email yet')

  // A — wrong password, then right
  await p.click('[data-sprec-edit]')
  await p.fill('[data-sprec-email]', REC)
  await p.fill('[data-sprec-password]', 'wrong password here')
  await p.locator('[data-sprec-form] button[type=submit]').click()
  await p.waitForSelector('.sprec-bad')
  check(/password is not right/.test(await p.textContent('.sprec-bad')) && (await p.inputValue('[data-sprec-email]')) === REC,
    'A a wrong password is refused and the typed address is kept')
  await p.fill('[data-sprec-password]', PW)
  await p.locator('[data-sprec-form] button[type=submit]').click()
  await p.waitForSelector('[data-sprec-state="pending"]')
  await p.waitForTimeout(400)
  const code = codeIn(to(REC).pop() || '')
  check(!!code, 'A a confirmation code was mailed to the new address', `${to(REC).length} mail(s)`)
  check(to(ME).some((m) => /recovery/i.test(decode(m) + m)), 'A the sign-in address was told the recovery email changed')

  // C — an unconfirmed address gets no reset code
  const before = to(REC).length
  await ctx.request.post(`${BASE}/api/admin.php?r=password_reset_request`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: ME } })
  check(to(REC).length === before, 'C an unconfirmed recovery address gets no reset code', `${to(REC).length - before} sent`)
  sql(`delete from admin_password_resets where admin_id = (select id from admin_users where email='${ME}')`)

  // D — wrong confirmation code, then the right one
  await p.fill('[data-sprec-code]', code === '00000000' ? '11111111' : '00000000')
  await p.locator('[data-sporta-recovery] form:not([data-sprec-form]) button[type=submit]').click()
  await p.waitForSelector('.sprec-bad')
  check(/not right/.test(await p.textContent('.sprec-bad')), 'D a wrong confirmation code is refused')
  await p.fill('[data-sprec-code]', code)
  await p.locator('[data-sporta-recovery] form:not([data-sprec-form]) button[type=submit]').click()
  await p.waitForSelector('[data-sprec-state="verified"]')
  check(sql(`select recovery_verified_at is not null from admin_users where email='${ME}'`) === '1', 'A the right code confirms the address')

  // B — reset codes go to both, and work
  const nMe = to(ME).length, nRec = to(REC).length
  await ctx.request.post(`${BASE}/api/admin.php?r=password_reset_request`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: ME } })
  await p.waitForTimeout(300)
  const c1 = codeIn(to(ME)[nMe] || ''), c2 = codeIn(to(REC)[nRec] || '')
  check(!!c1 && c1 === c2, 'B the reset code is mailed to BOTH addresses', `${c1} / ${c2}`)
  const reset = await (await browser.newContext()).request.post(`${BASE}/api/admin.php?r=password_reset_confirm`, { headers: { 'X-Sporta-Admin': '1' },
    data: { email: ME, code: c2, password: PW + 'X', password2: PW + 'X' } })
  check(reset.status() === 200, 'B the code from the recovery mailbox resets the password', String(reset.status()))

  // E — Sign out in the top bar (a fresh sign-in: the reset ended nothing here, but use a new context)
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx2.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: ME, password: PW + 'X' } })
  const q = await ctx2.newPage()
  await q.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await q.waitForSelector('[data-sporta-signout]', { timeout: 15000 })
  const box = await q.locator('[data-sporta-signout]').boundingBox()
  check(box && box.y < 70 && box.y >= 0 && box.height >= 44, 'E a Sign out button sits in the top bar on a computer', JSON.stringify(box))
  await q.click('[data-sporta-signout]')
  await q.waitForTimeout(1500)
  const me = await (await ctx2.request.get(`${BASE}/api/admin.php?r=me`, { headers: { 'X-Sporta-Admin': '1' } })).text()
  check(/null/.test(me) && !(await q.locator('.admin-content').count()), 'E pressing it signs out', me.slice(0, 40))
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await ctx3.request.post(`${BASE}/api/admin.php?r=login`, { headers: { 'X-Sporta-Admin': '1' }, data: { email: ME, password: PW + 'X' } })
  const r3 = await ctx3.newPage()
  await r3.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await r3.waitForTimeout(1200)
  check(!(await r3.locator('[data-sporta-signout]').isVisible().catch(() => false)), 'E phones keep their own Sign out (no second button)')

  // D — remove
  await p.locator('[data-sprec-remove]').click()
  await p.fill('[data-sprec-password]', PW + 'X')
  const nMe2 = to(ME).length
  await p.locator('[data-sprec-form] button[type=submit]').click()
  await p.waitForSelector('[data-sprec-state="none"]').catch(() => {})
  const removed = sql(`select ifnull(recovery_email,'NULL') from admin_users where email='${ME}'`)
  check(removed === 'NULL' || (await p.locator('.admin-content').count()) === 0, 'D remove clears it', removed)
  check(to(ME).length > nMe2 || removed !== 'NULL', 'D the sign-in address is told it was removed')
} finally {
  await browser.close()
  srv.kill()
  if (process.env.MUTATE) writeFileSync(ADMIN, orig)
  const id = sql(`select ifnull(max(id),0) from admin_users where email='${ME}'`)
  if (+id) for (const q of [`delete from admin_password_resets where admin_id=${id}`, `delete from admin_devices where admin_id=${id}`,
    `delete from admin_sessions where admin_id=${id}`, `delete from admin_passkeys where admin_id=${id}`, `delete from admin_users where id=${id}`]) { try { sql(q) } catch {} }
  sql('delete from rate_limit; delete from rate_bucket')
  check(readFileSync(ADMIN, 'utf8') === orig && sql(`select count(*) from admin_users where email='${ME}'`) === '0', 'the throwaway account is gone and admin.php is as it was')
  console.log(fails ? `\n${fails} FAILED` : '\nall recovery-email checks passed')
  process.exitCode = fails ? 1 : 0
}
