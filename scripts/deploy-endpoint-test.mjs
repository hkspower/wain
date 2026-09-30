/**
 * api/deploy.php — the guard chain, and the three defects found on 2026-09-11.
 *
 * WHAT THIS ENDPOINT IS. A signed POST that downloads a zip from an allow-listed
 * host, verifies its sha256, and copies its contents into the live web root. It
 * is the most dangerous thing on the shop by construction, and until today it
 * was in no commit and had no test. It has also never once succeeded:
 * manifest=none, artifacts=0, and every line of its log is a FAIL.
 *
 * TWO KINDS OF CHECK, AND THE DIFFERENCE IS STATED RATHER THAN BLURRED.
 *
 *   1. THE GUARD CHAIN, END TO END, against a real PHP server: method,
 *      signature, replay window, sha shape, host allow-list. These run the
 *      endpoint and read what it answers.
 *
 *   2. isProtectedEntry(), by EXTRACTING THE REAL FUNCTION from deploy.php and
 *      running it. Not a copy pasted into this rig — the source text is read
 *      from the file under test, so editing the function changes what runs
 *      here. deploy.php cannot simply be included: its first statement after
 *      the declarations is a method check that exits.
 *
 * WHAT IS NOT TESTED HERE, SAID PLAINLY. The download, the checksum and the
 * extraction need an artifact on one of three GitHub hosts, so they cannot be
 * driven from a local fixture without weakening the allow-list — which would
 * be changing production to suit a test. The size cap is likewise unreachable
 * without a real download, so it is guarded structurally below and that is
 * weaker than a measurement. Both are named rather than quietly skipped.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const SRC = new URL('../sporta-site/public_html/api/deploy.php', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

const php = readFileSync(SRC, 'utf8')
console.log(`deploy endpoint — ${SRC.split('/').slice(-2).join('/')}, ${php.length} bytes\n`)

/* ============================================================ 1. the layout */
// deploy.php derives every path from dirname(__DIR__, 2), so it needs a real
// <domain>/public_html/api/ tree with a sibling storage/ — the same shape as
// the server. Anything less and the secret is never found.
const base = mkdtempSync(join(tmpdir(), 'deploytest-'))
const web = join(base, 'public_html')
mkdirSync(join(web, 'api'), { recursive: true })
mkdirSync(join(base, 'storage'), { recursive: true })
cpSync(SRC, join(web, 'api', 'deploy.php'))
const SECRET = 'rig-secret-not-a-real-one-0123456789'
writeFileSync(join(base, 'storage', 'deploy.secret'), SECRET + '\n')

const PORT = 4399
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', web], { stdio: 'ignore' })
const done = () => { try { srv.kill() } catch {} ; rmSync(base, { recursive: true, force: true }) }
process.on('exit', done)

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/deploy.php`); return true } catch {}
    await new Promise(r => setTimeout(r, 150))
  }
  return false
}
if (!await up()) { bad('the test server started'); console.log('\nFAILED'); process.exit(1) }
ok('the test server started', `127.0.0.1:${PORT}`)

const post = async (payload, { sign = true, secret = SECRET } = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const h = { 'Content-Type': 'application/json' }
  if (sign) h['X-Deploy-Signature'] = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const r = await fetch(`http://127.0.0.1:${PORT}/api/deploy.php`, { method: 'POST', headers: h, body })
  let j = null; try { j = JSON.parse(await r.text()) } catch {}
  return { status: r.status, error: j?.error ?? null, json: j }
}
const GOOD_SHA = 'a'.repeat(64)
const now = () => Math.floor(Date.now() / 1000)

/* ====================================================== 2. the guard chain */
{
  const r = await fetch(`http://127.0.0.1:${PORT}/api/deploy.php`)
  const j = await r.json().catch(() => null)
  r.status === 405 && j?.error === 'method_not_allowed'
    ? ok('GET is refused', '405 method_not_allowed')
    : bad('GET is refused', `${r.status} ${j?.error}`)
}
{
  const r = await post({ url: 'https://raw.githubusercontent.com/x/y/z.zip', sha256: GOOD_SHA, ts: now() },
                       { sign: false })
  r.status === 401 && r.error === 'bad_signature'
    ? ok('an unsigned POST is refused', '401 bad_signature')
    : bad('an unsigned POST is refused', `${r.status} ${r.error}`)
}
{
  const r = await post({ url: 'https://raw.githubusercontent.com/x/y/z.zip', sha256: GOOD_SHA, ts: now() },
                       { secret: 'the-wrong-secret' })
  r.status === 401 && r.error === 'bad_signature'
    ? ok('a POST signed with the wrong secret is refused', '401 bad_signature')
    : bad('a POST signed with the wrong secret is refused', `${r.status} ${r.error}`)
}
// THE SIGNATURE MUST ACTUALLY PASS FOR SOMETHING, or every check above is
// satisfied by an endpoint that refuses the world and the suite proves nothing.
{
  const r = await post({ url: 'https://evil.example.com/a.zip', sha256: GOOD_SHA, ts: now() })
  r.status === 400 && r.error === 'host_not_allowed'
    ? ok('a correctly signed POST gets PAST the signature', 'reaches host_not_allowed')
    : bad('a correctly signed POST gets PAST the signature', `${r.status} ${r.error}`)
}
{
  const r = await post({ url: 'https://raw.githubusercontent.com/x/y/z.zip', sha256: 'nope', ts: now() })
  r.status === 400 && r.error === 'bad_sha256'
    ? ok('a malformed sha256 is refused', '400 bad_sha256')
    : bad('a malformed sha256 is refused', `${r.status} ${r.error}`)
}
{
  const r = await post({ url: 'https://raw.githubusercontent.com/x/y/z.zip', sha256: GOOD_SHA, ts: now() - 3600 })
  r.status === 400 && r.error === 'stale_request'
    ? ok('a replayed request outside the window is refused', '400 stale_request')
    : bad('a replayed request outside the window is refused', `${r.status} ${r.error}`)
}
{
  const r = await post({ url: 'http://raw.githubusercontent.com/x/y/z.zip', sha256: GOOD_SHA, ts: now() })
  r.status === 400 && r.error === 'host_not_allowed'
    ? ok('plain http is refused even on an allowed host', '400 host_not_allowed')
    : bad('plain http is refused even on an allowed host', `${r.status} ${r.error}`)
}

/* ============================ 3. isProtectedEntry, the REAL function, run */
// Extracted from the file under test rather than reproduced here. A copy would
// go on passing after the original was broken, which is the whole failure this
// repository keeps recording.
const grab = (name) => {
  const i = php.indexOf(`function ${name}(`)
  if (i < 0) return null
  let d = 0, started = false
  for (let j = i; j < php.length; j++) {
    if (php[j] === '{') { d++; started = true }
    else if (php[j] === '}') { d--; if (started && d === 0) return php.slice(i, j + 1) }
  }
  return null
}
const consts = php.match(/const PROTECTED_PATHS = \[[\s\S]*?\];/)
const fnA = grab('isProtected')
const fnB = grab('isProtectedEntry')
if (!consts || !fnA || !fnB) {
  bad('the real functions were extracted from deploy.php',
      `PROTECTED_PATHS=${!!consts} isProtected=${!!fnA} isProtectedEntry=${!!fnB}`)
} else {
  ok('the real functions were extracted from deploy.php', `${fnA.length + fnB.length} bytes of source`)

  const cases = [
    // [entry, wrapped, expected, why]
    ['wain-abc123/api/config.php', true,  true,  'a GitHub archive touching api/'],
    ['wain-abc123/assets/app.css', true,  false, 'an ordinary file in a wrapped archive'],
    ['wain-abc123/.htaccess',      true,  true,  'the rewrite rules, wrapped'],
    ['wain-abc123',                true,  false, 'the wrapper directory itself'],
    ['api/config.php',             false, true,  'an unwrapped archive touching api/'],
    ['assets/app.css',             false, false, 'an ordinary unwrapped file'],
    ['knet/pay.php',               false, true,  'the payment directory'],
    ['storage/deploy.secret',      false, true,  'the secret itself'],
  ]
  const harness = `<?php
${consts[0]}
${fnA}
${fnB}
$cases = json_decode('${JSON.stringify(cases.map(c => [c[0], c[1]]))}', true);
$out = [];
foreach ($cases as $c) { $out[] = isProtectedEntry($c[0], (bool)$c[1]) ? 1 : 0; }
echo json_encode($out);
`
  const hp = join(base, 'harness.php')
  writeFileSync(hp, harness)
  let got = null
  try { got = JSON.parse(execFileSync('php', [hp], { encoding: 'utf8' })) } catch (e) {
    bad('the extracted functions ran', String(e.message).slice(0, 120))
  }
  if (got) {
    const wrong = cases.map((c, i) => [c, got[i]]).filter(([c, g]) => Boolean(g) !== c[2])
    if (wrong.length) {
      bad('isProtectedEntry judges every case correctly',
          wrong.map(([c, g]) => `${c[0]} wrapped=${c[1]} got=${!!g} want=${c[2]} (${c[3]})`).join('; '))
    } else {
      ok('isProtectedEntry judges every case correctly', `${cases.length} cases, wrapped and not`)
    }
    // THE CASE THE OLD CODE GOT WRONG, called out on its own so a failure names
    // the actual regression rather than "one of eight".
    const i = 0
    Boolean(got[i]) === true
      ? ok('a wrapped archive touching api/ is refused', 'the defect fixed on 2026-09-11')
      : bad('a wrapped archive touching api/ is refused',
            'isProtected() tested the first segment, which is the wrapper — the check was inert')
  }
}

/* ============ 3a2. isDangerous — the guarantee the header makes, tested */
// Found 2026-09-11 by re-reading the file: the `.php` regex was the ONLY
// execution guard, and `PROTECTED_PATHS` lists `.htaccess` but isProtected()
// tests the FIRST segment, so it guarded the web root's own and nothing deeper.
// assets/.user.ini, assets/.htaccess, assets/x.php5 and assets/x.pht were all
// accepted and written — and .user.ini alone is arbitrary code execution via
// auto_prepend_file, which makes "no .php in an artifact" mean nothing.
{
  const fnD = grab('isDangerous')
  const namesConst = php.match(/const DANGEROUS_NAMES = \[[\s\S]*?\];/)
  if (!fnD || !namesConst) {
    bad('isDangerous exists in deploy.php', `fn=${!!fnD} names=${!!namesConst}`)
  } else {
    const CASES = [
      ['assets/.user.ini',     true,  'PHP per-directory config — auto_prepend_file is code execution'],
      ['assets/.htaccess',     true,  'can map any extension to the PHP handler'],
      ['deep/a/b/.user.ini',   true,  'at any depth, not just the first segment'],
      ['assets/.htpasswd',     true,  'credentials'],
      ['assets/x.php5',        true,  'commonly mapped to PHP'],
      ['assets/x.pht',         true,  'likewise'],
      ['assets/x.PHP',         true,  'case must not matter'],
      ['assets/x.phar',        true,  'a PHP archive'],
      ['assets/app.css',       false, 'an ordinary asset must still deploy'],
      ['assets/logo.webp',     false, 'likewise'],
      ['deploy-selftest.txt',  false, 'and the e2e fixture must still deploy'],
    ]
    const hp2 = join(base, 'danger.php')
    writeFileSync(hp2, `<?php\n${namesConst[0]}\n${fnD}\n`
      + `$c = json_decode('${JSON.stringify(CASES.map(c => c[0]))}', true);\n`
      + `$o = []; foreach ($c as $x) { $o[] = isDangerous($x) ? 1 : 0; } echo json_encode($o);\n`)
    let got = null
    try { got = JSON.parse(execFileSync('php', [hp2], { encoding: 'utf8' })) } catch (e) {
      bad('isDangerous ran', String(e.message).slice(0, 120))
    }
    if (got) {
      const wrong = CASES.map((c, i) => [c, got[i]]).filter(([c, g]) => Boolean(g) !== c[1])
      wrong.length
        ? bad('isDangerous refuses everything that can become code, and nothing else',
              wrong.map(([c, g]) => `${c[0]} got=${!!g} want=${c[1]} (${c[2]})`).join('; '))
        : ok('isDangerous refuses everything that can become code, and nothing else',
             `${CASES.length} cases`)
    }
  }
}

// AND BOTH LOOPS CALL IT. The entry loop sees zip names and the copy loop sees
// collapsed relative paths — different strings — so a guard wired into only one
// of them is the inert layer this file has already had once.
{
  const entryLoop = /if \(isDangerous\(\$n\)\)/.test(php)
  const copyLoop = /isProtected\(\$rel\)\s*\|\|\s*isDangerous\(\$rel\)/.test(php)
  entryLoop && copyLoop
    ? ok('both the entry check and the copy loop call isDangerous')
    : bad('both the entry check and the copy loop call isDangerous',
          `entryLoop=${entryLoop} copyLoop=${copyLoop} — a guard on one string is a guard on neither`)
}

// A PARTIAL DEPLOY MUST NOT PRUNE. @copy failing was silent, so the response
// said ok:true with a smaller count — and the prune then deleted the still-good
// OLD file for being absent from the short new manifest. The replacement did
// not arrive AND the original was removed.
{
  /partial_deploy/.test(php) && /if \(\$failed\)/.test(php)
    ? ok('a failed copy stops the deploy before the prune', 'partial_deploy, manifest not rewritten')
    : bad('a failed copy stops the deploy before the prune',
          'a silent @copy failure still reports success and then prunes the file it failed to replace')
}

/* ===================== 3b. and the STAGING LOOP actually calls it */
// MUTATION TESTING PUT THIS HERE. The checks above run isProtectedEntry and
// prove it correct — and reverting the call site to the old `isProtected($n)`
// passed all thirteen of them, because a rig that exercises a function never
// notices which function the program uses. A correct helper nobody calls is
// exactly the inert layer this fix existed to remove, restored.
{
  const loop = php.slice(php.indexOf('for ($i = 0; $i < $za->numFiles; $i++) {',
                                     php.indexOf('refuse traversal')))
  const seg = loop.slice(0, loop.indexOf('\n}\n') + 1)
  if (!seg.includes('numFiles')) {
    bad('the zip-entry loop was found', 'could not locate it to check the call site')
  } else if (/isProtectedEntry\(\s*\$n\s*,\s*\$wrapped\s*\)/.test(seg)) {
    ok('the zip-entry loop calls isProtectedEntry with the wrapped flag')
  } else if (/[^a-zA-Z]isProtected\(\s*\$n\s*\)/.test(seg)) {
    bad('the zip-entry loop calls isProtectedEntry with the wrapped flag',
        'it calls isProtected($n) — inert on a wrapped GitHub archive, which is every archive this deploys')
  } else {
    bad('the zip-entry loop calls isProtectedEntry with the wrapped flag',
        'neither call found — the protected-path check may have gone entirely')
  }
}

/* ================================ 4. the two fixes a local rig cannot drive */
// Structural, and weaker than a measurement — said so in the header. Both need
// a real download from an allow-listed host to exercise.
{
  const m = php.match(/CURLOPT_PROGRESSFUNCTION\s*=>\s*fn\(([^)]*)\)/)
  if (!m) bad('the download size cap has a progress callback')
  else {
    const args = m[1].split(',').map(s => s.trim()).filter(Boolean)
    args.length >= 3
      ? ok('the size cap reads the bytes RECEIVED, not only the declared total', `${args.length} args`)
      : bad('the size cap reads the bytes RECEIVED, not only the declared total',
            `${args.length} args — with only the declared total, a chunked response caps at nothing`)
  }
}
{
  /\$rel\s*=\s*ltrim\(str_replace\(\$stage/.test(php)
    ? bad('the staged path is stripped as a PREFIX', 'str_replace($stage, ...) replaces anywhere')
    : ok('the staged path is stripped as a PREFIX', 'substr, not str_replace')
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
