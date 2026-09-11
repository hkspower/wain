/**
 * Google sign-in for /backends: the token verification, and every way a real
 * Google token still must not sign somebody in.
 *
 * NODE MINTS, PHP VERIFIES. The rig generates an RSA key, publishes it as a
 * JWKS and signs tokens with Node's crypto; the real `store_google_verify()` is
 * then asked about them. That is deliberately a CROSS-IMPLEMENTATION check —
 * PHP verifying a signature PHP produced would pass even if the hand-rolled
 * JWK-to-PEM conversion were wrong in a way both sides shared. Here, anything
 * wrong in that conversion makes a definitely-valid token fail.
 *
 * THE KEY SET IS INJECTED AS A FUNCTION ARGUMENT, which is the only reason this
 * is testable at all — and the reason it is an argument rather than a setting
 * is that nothing reachable from a REQUEST may substitute a key set. Production
 * passes null and verifies against Google alone.
 *
 * WHAT IS NOT TESTED HERE, said plainly: the browser half. Google's own script
 * mints the token in a real page against a real client id, and neither exists
 * in a sandbox. What this proves is that a token which has been minted is
 * accepted only when every claim is right.
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

const CLIENT = '1234567890-abcdefghijklmnop.apps.googleusercontent.com'
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
    iss: 'https://accounts.google.com', aud: CLIENT,
    sub: '1029384756', email: 'manager@sporta.com.kw', email_verified: true,
    iat: now, exp: now + 3600, ...claims,
  })
  if (alg === 'none') return `${head}.${body}.`
  const s = createSign('RSA-SHA256'); s.update(`${head}.${body}`); s.end()
  let sig = s.sign(key).toString('base64url')
  if (breakSig) sig = sig.slice(0, -4) + (sig.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  return `${head}.${body}.${sig}`
}

console.log(`google sign-in — RS256, kid ${KID}\n`)

/* ------------------------------------------------ the PHP side of the bridge */
const dir = mkdtempSync(join(tmpdir(), 'gauth-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const harness = join(dir, 'verify.php')
writeFileSync(harness, `<?php
require '${STORE}';
$in = json_decode(file_get_contents('php://stdin'), true);
$out = [];
foreach ($in['tokens'] as $name => $tok) {
    $c = store_google_verify($tok, $in['client'], $in['jwks']);
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
  wrongAud:        mint({ aud: 'somebody-elses-client-id.apps.googleusercontent.com' }),
  wrongIssuer:     mint({ iss: 'https://evil.example.com' }),
  expired:         mint({ iat: now - 7200, exp: now - 3600 }),
  futureIat:       mint({ iat: now + 600 }),
  unverifiedEmail: mint({ email_verified: false }),
  noEmail:         mint({ email: '' }),
  algNone:         mint({}, { alg: 'none' }),
  unknownKid:      mint({}, { kid: 'not-a-key-we-know' }),
  tamperedSig:     mint({}, { breakSig: true }),
  evStringTrue:    mint({ email_verified: 'true' }),
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
  ['wrongAud',        'a token minted for ANOTHER site\'s client id'],
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
r.evStringTrue !== null
  ? ok('email_verified as the string "true" is accepted', 'both shapes occur in the wild')
  : bad('email_verified as the string "true" is accepted')
r.upperEmail && r.upperEmail.email === 'manager@sporta.com.kw'
  ? ok('the email is lower-cased before it is looked up', 'Manager@Sporta.Com.KW')
  : bad('the email is lower-cased before it is looked up', JSON.stringify(r.upperEmail))

/* ===================================== 4. an unconfigured shop has no way in */
{
  const out = verify({ good: tokens.good }, '')
  out.good === null
    ? ok('an empty client id refuses everything', 'the feature fails closed')
    : bad('an empty client id refuses everything', 'a shop that never configured this has a Google route in')
}

/* ============================ 5. and the routes exist, above the gate */
{
  const admin = execFileSync('cat',
    [new URL('../sporta-site/public_html/api/admin.php', import.meta.url).pathname],
    { encoding: 'utf8' })
  const gateAt = admin.indexOf('store_require_admin(')
  const cfgAt = admin.indexOf("$r === 'google_config'")
  const logAt = admin.indexOf("$r === 'google_login'")
  if (cfgAt < 0 || logAt < 0) bad('both Google routes exist', `config=${cfgAt} login=${logAt}`)
  else if (gateAt >= 0 && (cfgAt > gateAt || logAt > gateAt)) {
    bad('both Google routes are ABOVE the admin gate',
        'a sign-in route behind the gate needs the session it exists to create')
  } else ok('both Google routes exist and are above the admin gate')
}

/* ===== 6. THE SECOND FACTOR IS NOT SKIPPED — the check that matters most */
// Signing in with Google proves an EMAIL. An admin who enrolled an
// authenticator did so to require something beyond an email, and a Google path
// that called store_admin_grant() straight away would silently undo that for
// exactly the accounts that had taken the trouble.
{
  const store = execFileSync('cat', [STORE], { encoding: 'utf8' })
  const fn = store.slice(store.indexOf('function store_google_login('))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1)
  const setsPending = /pending_admin_id/.test(body)
  const guards = /hasTotp|totp_enabled/.test(body)
  setsPending && guards
    ? ok('Google sign-in still asks for an enrolled second factor', 'same pending marker as the password path')
    : bad('Google sign-in still asks for an enrolled second factor',
          `pendingMarker=${setsPending} totpCheck=${guards} — it would hand over the shop on an email alone`)
  // And it must not invent accounts: admin_users stays the allow-list.
  const inserts = /insert\s+into\s+admin_users/i.test(body)
  inserts
    ? bad('Google sign-in never creates an admin account', 'it inserts into admin_users')
    : ok('Google sign-in never creates an admin account', 'admin_users stays the allow-list')
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
