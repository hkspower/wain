/**
 * A REAL deploy, end to end, against a local copy of the live endpoint.
 *
 * WHAT THIS PROVES THAT test:deploy-endpoint CANNOT. That rig drives the guard
 * chain — method, signature, replay window, sha shape, host allow-list — and
 * every one of its checks is satisfied by an endpoint that refuses everything.
 * It says so in its own header: the download, the checksum, the extraction, the
 * wrapper collapse, the copy and the manifest were all untested, because they
 * need a real artifact on one of three GitHub hosts.
 *
 * So this rig fetches one. `scripts/fixtures/deploy-demo.zip` is committed to
 * this public repository, which makes raw.githubusercontent.com — an
 * allow-listed host — serve it without weakening anything to suit a test.
 *
 * IT NEVER TOUCHES THE LIVE SHOP. The endpoint derives every path from
 * dirname(__DIR__, 2), so a temporary <domain>/public_html/api/ tree with a
 * sibling storage/ is a complete, isolated installation. The live server is
 * never contacted.
 *
 * THE FIXTURE IS WRAPPED ON PURPOSE — `sporta-deploy-demo/…` — because that is
 * the shape GitHub produces and the shape the wrapper-collapse and the
 * protected-path fix are both about. A flat fixture would exercise neither.
 *
 * REQUIRES THE FIXTURE TO BE PUSHED. raw.githubusercontent serves committed
 * bytes, so an unpushed commit 404s. That is reported as its own state rather
 * than as a deploy failure, because the two look identical from the response.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createHmac, createHash } from 'node:crypto'

const SRC = new URL('../sporta-site/public_html/api/deploy.php', import.meta.url).pathname
const FIX = new URL('./fixtures/deploy-demo.zip', import.meta.url).pathname

let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

const zipBytes = readFileSync(FIX)
const zipSha = createHash('sha256').update(zipBytes).digest('hex')
const sha = (s) => execFileSync('git', ['rev-parse', s], { encoding: 'utf8' }).trim()
const HEAD = sha('HEAD')
const RAW = `https://raw.githubusercontent.com/hkspower/wain/${HEAD}/scripts/fixtures/deploy-demo.zip`

console.log(`deploy end to end — fixture ${zipBytes.length}b sha ${zipSha.slice(0, 12)}\n`)

// THE FIXTURE MUST BE REACHABLE, and that is a different failure from a deploy
// that went wrong. Checked first and named for itself.
{
  const r = await fetch(RAW)
  const got = r.ok ? createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex') : null
  if (!r.ok) {
    bad('the fixture is reachable on an allow-listed host',
        `${r.status} — commit and PUSH scripts/fixtures/deploy-demo.zip, then re-run (HEAD ${HEAD.slice(0, 8)})`)
    console.log(`\nFAILED — ${fail} of ${pass + fail}`)
    process.exit(1)
  }
  got === zipSha
    ? ok('the fixture is reachable and matches the local bytes', `${zipSha.slice(0, 12)}`)
    : bad('the fixture is reachable and matches the local bytes', `served ${got?.slice(0, 12)}`)
}

/* ------------------------------------------------------------- the install */
const base = mkdtempSync(join(tmpdir(), 'deploye2e-'))
const web = join(base, 'public_html')
mkdirSync(join(web, 'api'), { recursive: true })
mkdirSync(join(base, 'storage'), { recursive: true })
cpSync(SRC, join(web, 'api', 'deploy.php'))
const SECRET = 'e2e-rig-secret-0123456789abcdef'
writeFileSync(join(base, 'storage', 'deploy.secret'), SECRET + '\n')

const PORT = 4398
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', web], { stdio: 'ignore' })
process.on('exit', () => { try { srv.kill() } catch {}; rmSync(base, { recursive: true, force: true }) })
for (let i = 0; i < 60; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/api/deploy.php`); break } catch {}
  await new Promise(r => setTimeout(r, 150))
}

// Signed exactly as scripts/deploy-sign.mjs signs: serialise once, hash that
// string, send that string.
const deploy = async (url, hash, version = 'e2e') => {
  const body = JSON.stringify({ url, sha256: hash, version, ts: Math.floor(Date.now() / 1000) })
  const r = await fetch(`http://127.0.0.1:${PORT}/api/deploy.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'X-Deploy-Signature': 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex') },
    body,
  })
  let j = null; try { j = JSON.parse(await r.text()) } catch {}
  return { status: r.status, json: j }
}

/* ================================================== 1. a deploy that works */
const first = await deploy(RAW, zipSha, 'v1')
if (first.status !== 200 || !first.json?.ok) {
  bad('a signed deploy of a real artifact succeeds',
      `${first.status} ${JSON.stringify(first.json)}`)
} else {
  ok('a signed deploy of a real artifact succeeds',
     `deployed=${first.json.deployed} removed=${first.json.removed} v=${first.json.version}`)
}

// THE FILES ARE ON DISK. `deployed=2` is the endpoint's own count, and a count
// is not a file — this is the check that the bytes actually arrived where a
// visitor would find them.
{
  const a = join(web, 'deploy-selftest.txt')
  const b = join(web, 'deploy-demo', 'nested.txt')
  existsSync(a) && existsSync(b)
    ? ok('both files landed in the web root, nested directory created',
         'deploy-selftest.txt, deploy-demo/nested.txt')
    : bad('both files landed in the web root, nested directory created',
          `top=${existsSync(a)} nested=${existsSync(b)}`)
}

// THE WRAPPER WAS COLLAPSED. If it had not been, the files would be at
// public_html/sporta-deploy-demo/… — served at the wrong URL, with the deploy
// reporting success either way.
{
  existsSync(join(web, 'sporta-deploy-demo'))
    ? bad('the GitHub wrapper directory was collapsed',
          'public_html/sporta-deploy-demo/ exists — every file is at the wrong path')
    : ok('the GitHub wrapper directory was collapsed', 'no sporta-deploy-demo/ in the web root')
}

// THE CONTENT IS THE ARTIFACT'S, not an empty file the copy happened to create.
{
  const t = existsSync(join(web, 'deploy-selftest.txt'))
    ? readFileSync(join(web, 'deploy-selftest.txt'), 'utf8') : ''
  t.includes('prove the endpoint works')
    ? ok('the deployed file has the artifact\'s content', `${t.length} bytes`)
    : bad('the deployed file has the artifact\'s content', `${t.length} bytes`)
}

// THE MANIFEST, which is what makes the NEXT deploy able to prune.
{
  const m = join(base, 'storage', 'deploy', 'manifest.json')
  if (!existsSync(m)) bad('a manifest was written')
  else {
    const j = JSON.parse(readFileSync(m, 'utf8'))
    const files = j.files ?? []
    files.length === 2 && files.every(f => !f.startsWith('sporta-deploy-demo'))
      ? ok('a manifest was written, with collapsed paths', files.join(', '))
      : bad('a manifest was written, with collapsed paths', JSON.stringify(files))
  }
}

/* ============================ 1b. THE REAL CLIENT, not a copy of its logic */
// Everything above signs inline, which tests a REPRODUCTION of the signing
// rules and would go on passing after deploy-sign.mjs broke. The client is the
// deliverable — the thing that did not exist and the reason the endpoint had
// never worked — so it is run as a program, exactly as the owner would run it.
{
  const secretPath = join(base, 'storage', 'deploy.secret')
  let out = '', code = 0
  try {
    out = execFileSync('node', [
      new URL('./deploy-sign.mjs', import.meta.url).pathname,
      '--url', RAW,
      '--sha256', zipSha,
      '--version', 'via-client',
      '--endpoint', `http://127.0.0.1:${PORT}/api/deploy.php`,
      '--secret-file', secretPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { code = e.status ?? 1; out = (e.stdout || '') + (e.stderr || '') }

  const okLine = /^200 .*"ok":true/m.test(out)
  code === 0 && okLine
    ? ok('scripts/deploy-sign.mjs deploys for real', out.trim().split('\n').pop().slice(0, 90))
    : bad('scripts/deploy-sign.mjs deploys for real', `exit=${code} ${out.trim().slice(0, 200)}`)

  // And the version it sent reached the manifest, which proves the body the
  // client built is the body the server parsed — not merely that something
  // with a valid signature arrived.
  const m = join(base, 'storage', 'deploy', 'manifest.json')
  const v = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')).version : null
  v === 'via-client'
    ? ok('the client\'s own payload is what the server stored', `version=${v}`)
    : bad('the client\'s own payload is what the server stored', `version=${v}`)
}

// THE SECRET MUST NOT BE ACCEPTED ON THE COMMAND LINE, where it would sit in
// shell history and in the process list for every user on the machine.
{
  let out = '', code = 0
  try {
    out = execFileSync('node', [new URL('./deploy-sign.mjs', import.meta.url).pathname,
      '--url', RAW, '--sha256', zipSha, '--secret', 'hunter2',
      '--endpoint', `http://127.0.0.1:${PORT}/api/deploy.php`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPORTA_DEPLOY_SECRET: '' } })
  } catch (e) { code = e.status ?? 1; out = (e.stdout || '') + (e.stderr || '') }
  code !== 0 && /no secret/i.test(out)
    ? ok('the client refuses a secret passed on the command line', 'exits, explaining why')
    : bad('the client refuses a secret passed on the command line', `exit=${code} ${out.slice(0, 120)}`)
}

/* ===================================== 2. the checksum guard, with real bytes */
{
  const r = await deploy(RAW, 'b'.repeat(64), 'wrong-hash')
  r.status === 422 && r.json?.error === 'checksum_mismatch'
    ? ok('a wrong sha256 is refused after the download', '422 checksum_mismatch')
    : bad('a wrong sha256 is refused after the download', `${r.status} ${r.json?.error}`)
}

/* ============================ 3. an artifact carrying PHP is refused outright */
// The repository's own zip, from codeload — full of .php, and the closest thing
// to the mistake this endpoint exists to prevent.
{
  const url = `https://codeload.github.com/hkspower/wain/zip/${HEAD}`
  const r0 = await fetch(url)
  if (!r0.ok) {
    bad('an artifact containing .php is refused', `could not fetch the repo zip: ${r0.status}`)
  } else {
    const buf = Buffer.from(await r0.arrayBuffer())
    const h = createHash('sha256').update(buf).digest('hex')
    const r = await deploy(url, h, 'repo-zip')
    r.status === 422 && r.json?.error === 'executable_in_artifact'
      ? ok('an artifact containing .php is refused', `422 executable_in_artifact (${(buf.length / 1048576).toFixed(1)} MB zip)`)
      : bad('an artifact containing .php is refused', `${r.status} ${r.json?.error}`)
  }
}

/* ========================= 4. and nothing protected was written, ever */
// THE FIRST VERSION OF THIS CHECK FAILED FOR THE WRONG REASON, which is worth
// keeping in view: it listed protected directories that EXIST, and `api/`
// exists because this rig put deploy.php in it. "A check that fails for the
// wrong reason is more expensive than one that passes for the wrong reason,
// because it looks like work to do."
//
// The invariant is not "api/ is absent" — it cannot be. It is that no protected
// directory gained ANYTHING from the deploy, and that the endpoint is still the
// file it was.
{
  const before = { 'api': ['deploy.php'] }       // what the rig itself created
  const problems = []
  for (const dir of ['api', 'knet', 'pay', 'storage', 'admin', 'queue', 'orders']) {
    const p = join(web, dir)
    if (!existsSync(p)) continue
    const now = readdirSync(p).sort()
    const want = (before[dir] ?? []).sort()
    const added = now.filter(f => !want.includes(f))
    if (added.length) problems.push(`${dir}/ gained ${added.join(',')}`)
  }
  // And the endpoint is byte-for-byte what it was — an artifact that could
  // overwrite deploy.php would be the worst outcome available here.
  const liveSha = existsSync(join(web, 'api', 'deploy.php'))
    ? createHash('sha256').update(readFileSync(join(web, 'api', 'deploy.php'))).digest('hex') : null
  const srcSha = createHash('sha256').update(readFileSync(SRC)).digest('hex')
  if (liveSha !== srcSha) problems.push('api/deploy.php was modified')

  problems.length === 0
    ? ok('no protected path gained anything and the endpoint is unchanged',
         `7 directories checked, deploy.php ${srcSha.slice(0, 12)}`)
    : bad('no protected path gained anything and the endpoint is unchanged', problems.join('; '))
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
