/**
 * Apple sign-in for /backends: the token verification, and every way a real
 * Apple token still must not sign somebody in.
 *
 * SAME SHAPE AS google-auth-test.mjs, deliberately — NODE MINTS, PHP
 * VERIFIES. The rig generates an RSA key, publishes it as a JWKS and signs
 * tokens with Node's crypto; the real `store_apple_verify()` is then asked
 * about them. A cross-implementation check: PHP verifying a signature PHP
 * produced would pass even if the shared JWK-to-PEM conversion were wrong in
 * a way both sides shared — that function is exercised by google-auth-test
 * too, so a break there would fail both rigs, not just this one.
 *
 * THE KEY SET IS INJECTED AS A FUNCTION ARGUMENT for the same reason as the
 * Google rig: nothing reachable from a request may substitute a key set in
 * production, which always passes null.
 *
 * WHAT IS NOT TESTED HERE: the browser half. Apple's own script mints the
 * token in a real page against a real Services ID, and neither exists in a
 * sandbox — this proves only that a minted token is accepted exclusively
 * when every claim is right.
 */
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const STORE = new URL('../sporta-site/public_html/api/store.php', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

const CLIENT = 'com.sporta.web.signin'
const KID = 'test-key-' + randomUUID().slice(0, 8)

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const JWKS = [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }]

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64url')

const mint = (claims = {}, { kid = KID, alg = 'RS256', breakSig = false, key = privateKey } = {}) => {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg, kid, typ: 'JWT' })
  const body = b64({
    iss: 'https://appleid.apple.com', aud: CLIENT,
    sub: '001029.abcdef1234567890.1029', email: 'manager@sporta.com.kw', email_verified: 'true',
    iat: now, exp: now + 3600, ...claims,
  })
  if (alg === 'none') return `${head}.${body}.`
  const s = createSign('RSA-SHA256'); s.update(`${head}.${body}`); s.end()
  let sig = s.sign(key).toString('base64url')
  if (breakSig) sig = sig.slice(0, -4) + (sig.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  return `${head}.${body}.${sig}`
}

console.log(`apple sign-in — RS256, kid ${KID}\n`)

/* ------------------------------------------------ the PHP side of the bridge */
const dir = mkdtempSync(join(tmpdir(), 'aauth-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const harness = join(dir, 'verify.php')
writeFileSync(harness, `<?php
require '${STORE}';
$in = json_decode(file_get_contents('php://stdin'), true);
$out = [];
foreach ($in['tokens'] as $name => $tok) {
    $c = store_apple_verify($tok, $in['client'], $in['jwks']);
    $out[$name] = $c === null ? null : ['email' => $c['email'], 'sub' => $c['sub'] ?? null];
}
echo json_encode($out);
`)

const verify = (tokens, client = CLIENT) => {
  const raw = execFileSync('php', [harness], {
    input: JSON.stringify({ tokens, client, jwks: JWKS }), encoding: 'utf8',
  })
  return JSON.parse(raw)
}

const now = Math.floor(Date.now() / 1000)
const tokens = {
  good:            mint(),
  wrongAud:        mint({ aud: 'com.somebody-elses.services-id' }),
  wrongIssuer:     mint({ iss: 'https://evil.example.com' }),
  expired:         mint({ iat: now - 7200, exp: now - 3600 }),
  futureIat:       mint({ iat: now + 600 }),
  unverifiedEmail: mint({ email_verified: 'false' }),
  noEmail:         mint({ email: '' }),
  algNone:         mint({}, { alg: 'none' }),
  unknownKid:      mint({}, { kid: 'not-a-key-we-know' }),
  tamperedSig:     mint({}, { breakSig: true }),
  evBoolTrue:      mint({ email_verified: true }),
  upperEmail:      mint({ email: 'Manager@Sporta.Com.KW' }),
}
// Signed by a DIFFERENT key, with a kid we DO publish — the attack the kid
// lookup exists to stop, and the one a rig that only tries unknown kids misses.
{
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
  tokens.otherKey = mint({}, { key: other.privateKey })
}

const r = verify(tokens)

/* ============================================ 1. a good token, and it is good */
r.good && r.good.email === 'manager@sporta.com.kw'
  ? ok('a correctly signed token verifies', 'PHP accepted a signature Node made')
  : bad('a correctly signed token verifies',
        `${JSON.stringify(r.good)} — if this is null the JWK-to-PEM conversion is wrong`)

/* ================================= 2. every way it must be refused */
const MUST_REFUSE = [
  ['wrongAud',        'a token minted for ANOTHER site\'s Services ID'],
  ['wrongIssuer',     'a token from another issuer'],
  ['expired',         'an expired token'],
  ['futureIat',       'a token issued in the future'],
  ['unverifiedEmail', 'an unverified email address'],
  ['noEmail',         'a token with no email'],
  ['algNone',         'alg: none'],
  ['unknownKid',      'a kid we do not publish'],
  ['tamperedSig',     'a tampered signature'],
  ['otherKey',        'a valid signature by the WRONG key under a known kid'],
]
for (const [k, why] of MUST_REFUSE) {
  r[k] === null ? ok(`refused: ${why}`) : bad(`refused: ${why}`, `accepted as ${JSON.stringify(r[k])}`)
}

/* ============================================== 3. the two tolerated shapes */
r.evBoolTrue !== null
  ? ok('email_verified as a real boolean is accepted', 'Apple sends both shapes')
  : bad('email_verified as a real boolean is accepted')
r.upperEmail && r.upperEmail.email === 'manager@sporta.com.kw'
  ? ok('the email is lower-cased before it is looked up', 'Manager@Sporta.Com.KW')
  : bad('the email is lower-cased before it is looked up', JSON.stringify(r.upperEmail))

/* ===================================== 4. an unconfigured shop has no way in */
{
  const out = verify({ good: tokens.good }, '')
  out.good === null
    ? ok('an empty client id refuses everything', 'the feature fails closed')
    : bad('an empty client id refuses everything', 'a shop that never configured this has an Apple route in')
}

/* ============================ 5. and the routes exist, above the gate */
{
  const admin = execFileSync('cat',
    [new URL('../sporta-site/public_html/api/admin.php', import.meta.url).pathname],
    { encoding: 'utf8' })
  // THE TOP-LEVEL GATE, NOT ANY CALL TO THE SAME FUNCTION. apple_save (like
  // google_save) makes its own inline `store_require_admin()` call, indented
  // inside its own `if` block, well before the real gate that guards every
  // route below it. A bare indexOf finds whichever occurs first in the file
  // and, once apple_save's own call sits ahead of apple_config/apple_login,
  // reports them as "below" a gate that was never the real one — the exact
  // trap CLAUDE.md records for the admin-gate checker that swept `me` and
  // `logout` into the guarded set by matching an indented call. The real gate
  // is UNINDENTED (column 0); every route-scoped call sits inside an `if`.
  const gateMatch = admin.match(/^\S.*store_require_admin\(/m)
  const gateAt = gateMatch ? admin.indexOf(gateMatch[0]) : -1
  const cfgAt = admin.indexOf("$r === 'apple_config'")
  const logAt = admin.indexOf("$r === 'apple_login'")
  if (cfgAt < 0 || logAt < 0) bad('both Apple routes exist', `config=${cfgAt} login=${logAt}`)
  else if (gateAt >= 0 && (cfgAt > gateAt || logAt > gateAt)) {
    bad('both Apple routes are ABOVE the admin gate',
        'a sign-in route behind the gate needs the session it exists to create')
  } else ok('both Apple routes exist and are above the admin gate')
}

/* ===== 6. THE SECOND FACTOR IS NOT SKIPPED — the check that matters most */
{
  const store = execFileSync('cat', [STORE], { encoding: 'utf8' })
  const fn = store.slice(store.indexOf('function store_apple_login('))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1)
  const setsPending = /pending_admin_id/.test(body)
  const guards = /hasTotp|totp_enabled/.test(body)
  setsPending && guards
    ? ok('Apple sign-in still asks for an enrolled second factor', 'same pending marker as the password path')
    : bad('Apple sign-in still asks for an enrolled second factor',
          `pendingMarker=${setsPending} totpCheck=${guards} — it would hand over the shop on an email alone`)
  const inserts = /insert\s+into\s+admin_users/i.test(body)
  inserts
    ? bad('Apple sign-in never creates an admin account', 'it inserts into admin_users')
    : ok('Apple sign-in never creates an admin account', 'admin_users stays the allow-list')
}

/* ========== 7. THE KEY CACHE IS A TRUST ANCHOR, so where it lives matters */
{
  const store = execFileSync('cat', [STORE], { encoding: 'utf8' })
  const fn = store.slice(store.indexOf('function store_apple_jwks('))
  const raw = fn.slice(0, fn.indexOf('\n}\n') + 1)
  const body = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  const usesTemp = /sys_get_temp_dir\s*\(/.test(body)
  usesTemp
    ? bad('the key cache is NOT in a shared temp directory',
          'sys_get_temp_dir() — on shared hosting that is a key-injection path into sign-in')
    : ok('the key cache is NOT in a shared temp directory')

  const privateDir = /storage/.test(body), mode0600 = /0600/.test(body)
  privateDir && mode0600
    ? ok('it caches in the account\'s own storage at 0600', 'the sibling of public_html, unreachable over HTTP')
    : bad('it caches in the account\'s own storage at 0600',
          `storage=${privateDir} mode0600=${mode0600}`)

  const nullsOut = /\$file\s*=\s*is_dir\([^)]*\)\s*&&\s*is_writable\([^)]*\)\s*\?[^:]*:\s*null/.test(body)
  nullsOut && /if\s*\(\s*\$file\s*===\s*null\s*\)\s*return\s*\[\]/.test(body)
    ? ok('an unusable private directory means NO cache, not a shared one')
    : bad('an unusable private directory means NO cache, not a shared one',
          'the unhappy path must not reach a world-writable location')

  // ONE MORE THAN GOOGLE'S OWN CHECK: the two caches must not be the SAME
  // file. Sharing one would let an Apple JWKS refetch failure serve Google's
  // stale keys to an Apple token, or the reverse — two unrelated key sets
  // with nothing in common but a filename.
  const googleFn = store.slice(store.indexOf('function store_google_jwks('))
  const googleBody = googleFn.slice(0, googleFn.indexOf('\n}\n') + 1)
  const appleFile = (body.match(/'\/?([a-z-]+\.json)'/) || [])[1]
  const googleFile = (googleBody.match(/'\/?([a-z-]+\.json)'/) || [])[1]
  appleFile && googleFile && appleFile !== googleFile
    ? ok('the Apple and Google key caches are separate files', `${googleFile} / ${appleFile}`)
    : bad('the Apple and Google key caches are separate files', `google=${googleFile} apple=${appleFile}`)
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
