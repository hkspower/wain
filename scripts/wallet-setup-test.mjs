/**
 * npm run test:wallet-setup — the /backends card that links the owner's Apple
 * Developer account (api/wallet-setup.php, assets/wallet-setup.js).
 *
 *   bash scripts/sandbox.sh && npm run test:wallet-setup
 *
 * Three layers, because each fails in its own way:
 *
 *   1. The certificate logic, through scripts/wallet-setup-harness.php, against
 *      a stand-in Apple authority (the sandbox cannot reach Apple). Every
 *      refusal is required to leave the files EXACTLY as they were — a check
 *      that refuses correctly but writes half a setup first is the dangerous
 *      kind of correct.
 *   2. The routes behind the admin gate, over HTTP.
 *   3. The card in a real browser: where it appears, the request download,
 *      and the upload failing SAFELY when Apple cannot be reached — which is
 *      exactly the sandbox's situation, and a real one on a bad day.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const HARNESS = new URL('./wallet-setup-harness.php', import.meta.url).pathname
const LIVE_DIR = new URL('../sporta-site/wallet-certs', import.meta.url).pathname

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? `   ${detail}` : ''}`)
}
const run = (c, dir, work) => {
  try { return JSON.parse(execFileSync('php', [HARNESS, c, dir, work], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) }
  catch (e) { try { return JSON.parse(String(e.stdout)) } catch { return { error: 'harness: ' + String(e.stderr || e).slice(0, 160) } } }
}
const snapshot = (dir) => existsSync(dir)
  ? readdirSync(dir).sort().map((f) => f + ':' + readFileSync(join(dir, f)).toString('base64').slice(-24)).join(' ')
  : '(none)'

const work = mkdtempSync(join(tmpdir(), 'wallet-work-'))

console.log('--- 1. the certificate logic')
{
  const dir = join(mkdtempSync(join(tmpdir(), 'wallet-')), 'certs')
  const s0 = run('status', dir, work)
  check(s0.ready === false && s0.team_id === '', 'a fresh shop reads as not linked, with no team id')

  const req = run('request', dir, work)
  check(req.csrOk === true, 'step 1 produces a certificate signing request')
  check(req.csrHasKey === false, 'and the request carries no private key', 'the key must never leave the server')
  check(existsSync(join(dir, 'pending.key')) && !existsSync(join(dir, 'pass.key')),
    'the new key waits as pending.key; nothing is installed yet')

  // Every refusal must leave the files exactly as they were.
  for (const [c, token] of [
    ['wrong-type', 'cert_wrong_pass_type'], ['expired', 'cert_expired'], ['other-key', 'cert_key_mismatch'],
    ['wrong-authority', 'wwdr_unavailable'], ['garbage', 'cert_unreadable'],
  ]) {
    const before = snapshot(dir)
    const r = run(c, dir, work)
    check(r.error === token, `${c}: refused as ${token}`, JSON.stringify(r))
    check(snapshot(dir) === before, `${c}: and nothing on disk changed`)
  }

  const ok = run('install', dir, work)
  check(ok.ready === true, 'Apple’s certificate for our request installs and the shop reads as linked', JSON.stringify(ok))
  check(ok.team_id === 'TEAM123456' && ok.team_source === 'certificate',
    'the Team ID is read from the certificate, not typed', JSON.stringify(ok))
  check(!existsSync(join(dir, 'pending.key')), 'the pending key became the live key')
  const modes = readdirSync(dir).map((f) => (statSync(join(dir, f)).mode & 0o777).toString(8))
  check(modes.every((m) => m === '600'), 'every file is readable by the shop’s account only', modes.join(','))
  check((statSync(dir).mode & 0o777) === 0o700, 'and so is the folder')
  check(run('team', dir, work).team === 'TEAM123456',
    'the certificate’s Team ID wins over one typed in config.php', 'Apple refuses a pass whose team id differs from its certificate')

  // A new request (a renewal, or a mis-click) must not break a working card.
  const liveKey = readFileSync(join(dir, 'pass.key'), 'utf8')
  run('request', dir, work)
  const after = run('status', dir, work)
  check(after.ready === true && readFileSync(join(dir, 'pass.key'), 'utf8') === liveKey,
    'creating a new request leaves the working setup untouched', JSON.stringify(after))
  check(after.request_pending === true, 'and reports the request as waiting')
}

{
  const d = run('empty-dir', '/unused', work).dir
  check(typeof d === 'string' && d.endsWith('/sporta-site/wallet-certs'),
    'an EMPTY wallet_cert_dir (what the live config.php has) means the default folder, not the filesystem root', d)
}

console.log('\n--- 2. the routes')
{
  const r = await fetch(`${BASE}/api/admin.php?r=wallet_setup`, { headers: { 'X-Sporta-Admin': '1' } })
  check(r.status === 401, 'wallet_setup refuses anyone not signed in', `HTTP ${r.status}`)
  const w = await fetch(`${BASE}/api/admin.php?r=wallet_request`, { method: 'POST', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, body: '{}' })
  check(w.status === 401, 'and so does making a request', `HTTP ${w.status}`)
}

console.log('\n--- 3. the card')
const hadDir = existsSync(LIVE_DIR)
const before = snapshot(LIVE_DIR)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1400 }, acceptDownloads: true })
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  const card = () => p.locator('[data-sporta-panel="wallet"]')
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  check(await card().count() === 0, 'the card is not on the sign-in screen')
  await p.locator('input').nth(0).fill('manager@sporta.com.kw')
  await p.locator('input').nth(1).fill('correct horse')
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)
  await p.getByText('Settings', { exact: true }).first().click()
  await p.waitForTimeout(2500)
  check(await card().count() === 1, 'the Apple Wallet card is on Settings')
  const text = await card().innerText()
  check(/Not linked yet|Linked\./.test(text), 'it states whether the shop is linked', text.slice(0, 120))
  check(text.includes('pass.kw.com.sporta.card'), 'and names the exact Pass Type ID to create at Apple')

  const dl = p.waitForEvent('download', { timeout: 10000 })
  await card().getByRole('button', { name: 'Create request' }).click()
  const d = await dl
  const csr = readFileSync(await d.path(), 'utf8')
  check(/BEGIN CERTIFICATE REQUEST/.test(csr) && !/PRIVATE KEY/.test(csr),
    'Create request downloads a request with no private key in it', d.suggestedFilename())
  await p.waitForTimeout(800)

  // The upload in the sandbox's real situation: Apple cannot be reached. A
  // certificate for the key the card just made, from a stand-in authority;
  // the server fetches the REAL Apple intermediates, cannot get them, and
  // must refuse without touching anything.
  const cerPath = join(work, 'upload.cer')
  execFileSync('php', ['-r', `
    $k = file_get_contents('php://stdin');
    $caK = openssl_pkey_new(['private_key_bits' => 2048]);
    $ca = openssl_csr_sign(openssl_csr_new(['commonName' => 'stand-in'], $caK), null, $caK, 30);
    $crt = openssl_csr_sign(openssl_csr_new(['UID' => 'pass.kw.com.sporta.card', 'OU' => 'TEAM123456', 'commonName' => 'x'], $k), $ca, $caK, 30);
    openssl_x509_export($crt, $pem);
    file_put_contents($argv[1], base64_decode(preg_replace('/-----[^-]+-----|\\s/', '', $pem)));
  `, cerPath], { input: readFileSync(join(LIVE_DIR, 'pending.key'), 'utf8') })
  const pendingBefore = snapshot(LIVE_DIR)
  await card().locator('input[type="file"]').setInputFiles(cerPath)
  await card().getByRole('button', { name: 'Upload and link' }).click()
  await p.waitForFunction(() => /could not|Linked|not/i.test(document.querySelector('[data-sporta-panel="wallet"] .spw-note')?.textContent || '')
    && !/Checking/.test(document.querySelector('[data-sporta-panel="wallet"] .spw-note')?.textContent || ''), null, { timeout: 90000 })
  const note = await card().locator('.spw-note').innerText()
  check(/could not confirm the certificate with Apple/.test(note), 'with Apple unreachable, the upload is refused in plain words', note)
  check(snapshot(LIVE_DIR) === pendingBefore, 'and nothing on the server changed')
  check(errors.length === 0, 'no page errors', errors.join(' | '))
} finally {
  await browser.close()
}

// Leave the sandbox's certificate folder as it was found.
if (!hadDir) rmSync(LIVE_DIR, { recursive: true, force: true })
else for (const f of ['pending.key', 'pending.csr']) if (!before.includes(f + ':')) rmSync(join(LIVE_DIR, f), { force: true })
rmSync(work, { recursive: true, force: true })

console.log(fails ? `\n${fails} failed` : '\nall ok — the card links an Apple account safely, and refuses everything else without writing')
process.exit(fails ? 1 : 0)
