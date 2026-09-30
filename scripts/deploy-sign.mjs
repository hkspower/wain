/**
 * Sign and send a deploy to api/deploy.php. The client that did not exist.
 *
 * WHY THIS IS THE FIX. The endpoint has been on the live server since before it
 * was tracked, and it has NEVER successfully deployed: manifest=none,
 * artifacts=0, and all three lines of its log are `FAIL bad_signature`. Two of
 * those are from the same address one minute apart, which is something retrying
 * and getting the signature wrong every time. The endpoint was never the
 * problem; nothing could talk to it.
 *
 *   node scripts/deploy-sign.mjs --url <https artifact> [options]
 *
 *   --url      the artifact. MUST be https on raw.githubusercontent.com,
 *              github.com or codeload.github.com — the endpoint's allow-list.
 *   --sha256   the artifact's hash. Omitted, it is computed by downloading the
 *              artifact and hashing it here.
 *   --version  a label stored in the manifest. Defaults to the short git sha.
 *   --endpoint defaults to https://www.sporta.com.kw/api/deploy.php
 *   --secret-file  where to read the shared secret. Defaults to $SPORTA_DEPLOY_SECRET.
 *   --dry-run  print what would be sent, sign nothing, send nothing.
 *
 * THE FOUR THINGS THAT MAKE A SIGNATURE VERIFY, all of which are easy to get
 * wrong and each of which produces the same opaque `bad_signature`:
 *
 *   1. The HMAC is over the EXACT REQUEST BODY BYTES. Serialise once, sign that
 *      string, send that same string. Re-serialising between signing and
 *      sending — a different key order, a space after a colon — changes the
 *      hash and nothing says so.
 *   2. The header is `X-Deploy-Signature` and the value is PREFIXED `sha256=`.
 *   3. The secret is `trim()`ed on the server, so a trailing newline in the
 *      file is fine — but only because both sides trim. This trims too.
 *   4. `ts` is seconds, not milliseconds, and must be within ±600s of the
 *      server's clock. Milliseconds land ~55,000 years in the future and are
 *      refused as `stale_request`, which at least names itself.
 *
 * THE SECRET IS NEVER PRINTED and never passed on the command line, where it
 * would sit in shell history and in the process list for every user on the
 * machine. A file or the environment, and nothing else.
 */
import { readFileSync } from 'node:fs'
import { createHmac, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return fallback
}
const flag = (name) => argv.includes(`--${name}`)

const ALLOWED = ['raw.githubusercontent.com', 'github.com', 'codeload.github.com']

const url = arg('url')
if (!url) {
  console.error('usage: node scripts/deploy-sign.mjs --url <https artifact> [--sha256 X]'
    + ' [--version V] [--endpoint URL] [--secret-file PATH] [--dry-run]')
  process.exit(2)
}

// Checked HERE as well as on the server, so the failure names itself locally
// instead of coming back as a 400 from a request that need not have been made.
let host
try { const u = new URL(url); host = u.host; if (u.protocol !== 'https:') throw new Error('not https') }
catch (e) { console.error(`bad --url: ${e.message}`); process.exit(2) }
if (!ALLOWED.includes(host)) {
  console.error(`host not allowed: ${host}\nthe endpoint accepts only: ${ALLOWED.join(', ')}`)
  process.exit(2)
}

const endpoint = arg('endpoint', 'https://www.sporta.com.kw/api/deploy.php')
const dry = flag('dry-run')

/* ------------------------------------------------------------- the artifact */
let sha = (arg('sha256') || '').toLowerCase()
if (!sha) {
  // Hashing what WE fetched is not proof the server will fetch the same bytes;
  // it is the same artifact by URL, and the server verifies independently
  // before writing anything. That second check is the one that matters.
  process.stderr.write(`hashing ${url} …\n`)
  const r = await fetch(url)
  if (!r.ok) { console.error(`could not fetch the artifact: ${r.status}`); process.exit(1) }
  const buf = Buffer.from(await r.arrayBuffer())
  sha = createHash('sha256').update(buf).digest('hex')
  process.stderr.write(`  ${buf.length} bytes, sha256 ${sha}\n`)
}
if (!/^[a-f0-9]{64}$/.test(sha)) { console.error(`bad --sha256: ${sha}`); process.exit(2) }

let version = arg('version')
if (!version) {
  try { version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { version = 'unknown' }
}

/* ---------------------------------------------------------------- the body */
// Serialised ONCE. This exact string is hashed and this exact string is sent.
const body = JSON.stringify({ url, sha256: sha, version, ts: Math.floor(Date.now() / 1000) })

if (dry) {
  console.log('would POST to', endpoint)
  console.log('body:', body)
  console.log('(dry run — nothing signed, nothing sent)')
  process.exit(0)
}

/* --------------------------------------------------------------- the secret */
const secretFile = arg('secret-file')
let secret = process.env.SPORTA_DEPLOY_SECRET || ''
if (secretFile) secret = readFileSync(secretFile, 'utf8')
secret = secret.trim()                       // the server trims too — rule 3
if (!secret) {
  console.error('no secret. Set SPORTA_DEPLOY_SECRET or pass --secret-file PATH.'
    + '\nIt is never accepted as a command-line value: that would put it in shell'
    + '\nhistory and in the process list for every user on the machine.')
  process.exit(2)
}

const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Deploy-Signature': sig },
  body,                                       // the same string that was signed
})
const text = await res.text()
let json = null; try { json = JSON.parse(text) } catch {}

console.log(`${res.status} ${json ? JSON.stringify(json) : text.slice(0, 400)}`)

// The two failures worth explaining, because the endpoint's own message cannot.
if (json?.error === 'bad_signature') {
  console.error('\nThe body was signed with a different secret, or a different body was sent'
    + '\nthan the one signed. This client serialises once and sends that same string,'
    + '\nso the likeliest cause is the secret: it must match storage/deploy.secret'
    + '\non the server exactly, after trimming.')
}
if (json?.error === 'stale_request') {
  console.error('\n`ts` must be within 600 seconds of the SERVER clock, in seconds.')
}
process.exit(res.ok && json?.ok ? 0 : 1)
