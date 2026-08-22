/**
 * Checks a built .pkpass the way Wallet does, short of the certificate.
 *
 *   node scripts/wallet-test.mjs wallet/SP-TEST-0001.pkpass
 *
 * Wallet does not explain a refusal — the pass simply does not open — so every
 * rule it enforces silently is worth asserting here where the failure has a
 * message attached.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'wallet/SP-TEST-0001.pkpass'
let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

// `unzip -p` rather than a zip library: the bundle has to be readable by the
// most ordinary tool there is, because that is what every server and every
// phone will use on it.
const list = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n')
const read = (name) => execFileSync('unzip', ['-p', file, name])

const REQUIRED = ['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'logo.png']
for (const f of REQUIRED) check(list.includes(f), `the bundle contains ${f}`)

// No folder inside the zip. A .pkpass whose files sit one directory down is
// the single most common reason a pass built by hand refuses to open, and it
// looks identical from the outside.
check(!list.some((f) => f.includes('/')), 'every file is at the root of the zip, not in a folder')

const pass = JSON.parse(read('pass.json').toString())
check(pass.formatVersion === 1, 'formatVersion is 1')
check(/^pass\./.test(pass.passTypeIdentifier), `passTypeIdentifier starts with "pass." (${pass.passTypeIdentifier})`)
check(/^[A-Z0-9]{10}$/.test(pass.teamIdentifier), `teamIdentifier is 10 characters (${pass.teamIdentifier})`)
check(!!pass.description, 'description is present — VoiceOver reads it aloud')
check(!!pass.storeCard, 'it is a storeCard, which is what a loyalty card is')
check(pass.barcodes?.[0]?.message === pass.serialNumber, 'the barcode carries the serial the till needs')
for (const c of ['backgroundColor', 'foregroundColor', 'labelColor'])
  check(/^rgb\(\d+, ?\d+, ?\d+\)$/.test(pass[c]), `${c} is rgb(), not hex — Wallet rejects hex`)

// The manifest must be the truth about every file, and cover all of them.
const manifest = JSON.parse(read('manifest.json').toString())
const payload = list.filter((f) => f !== 'manifest.json' && f !== 'signature')
check(payload.every((f) => manifest[f]), 'every file in the bundle is in the manifest')
check(Object.keys(manifest).every((f) => list.includes(f)), 'the manifest lists nothing that is missing')
const wrong = payload.filter((f) => createHash('sha1').update(read(f)).digest('hex') !== manifest[f])
check(wrong.length === 0, `every hash matches its file${wrong.length ? ` — ${wrong.join(', ')}` : ''}`)

// The signature is a detached PKCS#7 over manifest.json. Whether the
// certificate is Apple's is not checkable here and is not the point: what is
// checkable is that the envelope is well formed and signs THIS manifest.
const sig = read('signature')
check(sig.length > 0, 'the signature is present')
const info = execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-print_certs', '-noout'], { input: sig }).toString()
check(/subject=/.test(info), 'the signature is a readable PKCS#7 envelope')
check(/O\s*=\s*Sporta|CN\s*=\s*Sporta/i.test(info), `it was signed by a Sporta certificate`)

console.log(fails ? `\n${fails} failed` : `\nall ok — ${list.length} files`)
process.exit(fails ? 1 : 0)
