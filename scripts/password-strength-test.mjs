/**
 * store_password_is_weak(): the twelve-character floor stops a short
 * password, not a bad one that happens to be long enough. This proves the
 * function refuses the obvious ways to clear that floor with nothing real
 * behind it, and — just as important — does not refuse a genuinely random
 * one of the same length.
 *
 * PHP RUNS THE REAL FUNCTION, via a tiny harness that requires store.php and
 * calls it directly, so this is exercising the exact code the two routes
 * call rather than a description of it.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const STORE = new URL('../sporta-site/public_html/api/store.php', import.meta.url).pathname
const ADMIN = new URL('../sporta-site/public_html/api/admin.php', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

const dir = mkdtempSync(join(tmpdir(), 'pwstrength-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const harness = join(dir, 'check.php')
writeFileSync(harness, `<?php
require '${STORE}';
$in = json_decode(file_get_contents('php://stdin'), true);
$out = [];
foreach ($in['cases'] as $name => $c) {
    $out[$name] = store_password_is_weak($c['password'], $c['email'] ?? '');
}
echo json_encode($out);
`)

const check = (cases) => {
  const raw = execFileSync('php', [harness], { input: JSON.stringify({ cases }), encoding: 'utf8' })
  return JSON.parse(raw)
}

console.log('store_password_is_weak()\n')

const cases = {
  allSameChar:      { password: 'aaaaaaaaaaaa' },
  allSameDigit:     { password: '111111111111' },
  ascendingDigits:  { password: '123456789012' },
  descendingDigits: { password: '987654321098' },
  ascendingLetters: { password: 'abcdefghijkl' },
  keyboardCommon:   { password: 'qwertyuiop12' },
  brandName:        { password: 'sportakuwait' },
  isTheEmail:       { password: 'manager@sporta.com.kw', email: 'manager@sporta.com.kw' },
  emailLocalPart:   { password: 'manager-is-cool', email: 'manager@sporta.com.kw' },
  // These must NOT be refused — a real, unrelated password of the same
  // length, and one that merely CONTAINS a short ascending run without
  // being one all the way through.
  genuine:          { password: 'Xk9$mQ2vLp7z' },
  containsShortRun: { password: 'Xk9-123-mQvL' },
  unrelatedToEmail: { password: 'Xk9$mQ2vLp7z', email: 'manager@sporta.com.kw' },
}

const r = check(cases)

const MUST_REFUSE = [
  ['allSameChar', 'every character the same'],
  ['allSameDigit', 'every digit the same'],
  ['ascendingDigits', 'a straight ascending digit run'],
  ['descendingDigits', 'a straight descending digit run'],
  ['ascendingLetters', 'a straight ascending letter run'],
  ['keyboardCommon', 'a common keyboard-walk password'],
  ['brandName', "the shop's own name"],
  ['isTheEmail', 'the account\'s own email address as the password'],
  ['emailLocalPart', "the email's local part embedded in the password"],
]
for (const [k, why] of MUST_REFUSE) {
  r[k] !== null ? ok(`refused: ${why}`) : bad(`refused: ${why}`, `accepted (got ${JSON.stringify(r[k])})`)
}

const MUST_ACCEPT = [
  ['genuine', 'a genuinely random password'],
  ['containsShortRun', 'a password that merely contains a short run, not one made of it'],
  ['unrelatedToEmail', 'a random password that happens to share no substring with the email'],
]
for (const [k, why] of MUST_ACCEPT) {
  r[k] === null ? ok(`accepted: ${why}`) : bad(`accepted: ${why}`, `refused as ${JSON.stringify(r[k])}`)
}

/* ===== both doors that set a password call it, in addition to the length check */
{
  const admin = execFileSync('cat', [ADMIN], { encoding: 'utf8' })

  // Sliced to the NEXT top-level route rather than a fixed character count —
  // a fixed window is exactly the mistake this file has made before: a route
  // with enough comment above its check runs past a short window and the
  // extractor reports the check missing when it is only later than expected.
  const nextRouteAfter = (marker) => {
    const start = admin.indexOf(marker)
    const next = admin.indexOf("\nif ($r === '", start + marker.length)
    return admin.slice(start, next === -1 ? admin.length : next)
  }

  const registerBlock = nextRouteAfter("$r === 'register'")
  const registerCalls = /store_password_is_weak\s*\(/.test(registerBlock)
  registerCalls
    ? ok('register calls store_password_is_weak()')
    : bad('register calls store_password_is_weak()', 'the first admin account can still pick a weak one')

  const acctBlock = nextRouteAfter("$r === 'account_update'")
  const acctCalls = /store_password_is_weak\s*\(/.test(acctBlock)
  acctCalls
    ? ok('account_update calls store_password_is_weak()')
    : bad('account_update calls store_password_is_weak()', 'a password CHANGE can still pick a weak one')

  // The length check alone must not be treated as sufficient at either door —
  // this is the exact gap the function exists to close, restated as a guard
  // against someone "simplifying" one call site back out.
  const lengthOnlyRegister = /strlen\(\$pass\)\s*<\s*12/.test(registerBlock) && !registerCalls
  lengthOnlyRegister && bad('register does not rely on length alone', 'the twelve-char floor alone lets "123456789012" through')
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
