// Publish to Hostinger over FTPS — the bridge that works with SSH switched off.
//
//   node scripts/publish-ftps.mjs                 # build, then upload
//   node scripts/publish-ftps.mjs --dry-run       # list what would change, upload nothing
//   node scripts/publish-ftps.mjs --no-build      # upload the existing dist/
//   node scripts/publish-ftps.mjs --setup-tools   # also send go-live.html + selftest.php
//
// WHY FTPS AND NOT A DEPLOY ENDPOINT
// The obvious "bridge" is a PHP script on the server that accepts an upload.
// The live server already had one — sporta-deploy.php, sitting in the web root,
// answering to anyone on the internet who requested it. That is not a bridge,
// it is a way in, and it is being deleted rather than rebuilt.
//
// FTPS adds no attack surface at all: Hostinger already runs the server, it
// already authenticates, and it is not SSH, so it keeps working with SSH off.
// The credentials are Hostinger's own FTP account, revocable in hPanel.
import { Client } from 'basic-ftp'
import { readFileSync, readdirSync, statSync, existsSync, createReadStream } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { Writable } from 'node:stream'
import { config as loadEnv } from 'dotenv'

const web = resolve(new URL('..', import.meta.url).pathname)
loadEnv({ path: join(web, '.env.deploy') })

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_BUILD = argv.includes('--no-build')
const SETUP_TOOLS = argv.includes('--setup-tools')

const cfg = JSON.parse(readFileSync(join(web, 'deploy.config.json'), 'utf8'))
const REMOTE = (cfg.ftp?.remoteDir ?? '/public_html').replace(/\/$/, '')

// ---------------------------------------------------------------------------
// Files whose server copy always wins. Hard-coded, not configuration: these
// hold the live database and Tranportal credentials and exist only on the
// server, and a configuration mistake that overwrote them would cost real money.
const NEVER_OVERWRITE = ['config.js', 'knet/config.php', 'pay/config.php', 'api/config.php']
// Never sent under any circumstance.
const NEVER_SEND = ['.env', '.env.deploy', '.DS_Store']
// GO-LIVE tells the owner to DELETE these once the site is set up, because each
// one reveals configuration state. Re-uploading them on every publish would
// silently undo that cleanup — so they are excluded by default and only sent
// when asked for explicitly.
const SETUP_ONLY = ['go-live.html', 'knet/selftest.php', 'knet/setup-config.php',
                    'api/setup-admin.php', 'api/preflight.php']
// Must arrive, and must be verified afterwards. Listing them is not enough: the
// verify step used to check only files that happened to be in the upload set,
// so if one had been filtered out it would have been skipped in silence and the
// run would still have reported success.
const MUST_VERIFY = ['.htaccess', 'knet/.htaccess', 'index.html']
// Left over from the previous site. Each is either a way in or a way to serve
// the old site by accident. Reported after publishing, since publish never
// deletes anything.
const DANGEROUS_LEFTOVERS = [
  'index.php', 'sporta-deploy.php', 'sporta-deploy-config.php', 'sporta-dist.zip',
  '.env', 'config.php', 'config-dist.php', 'knet-config.php', 'knet-lib.php',
  'knet-pay.php', 'knet-response.php', 'knet.log', 'deploy.config.json',
  'deployhostinger.mjs', 'package.json', 'vite.config.ts', 'README-knet.md',
  '_headers', 'sitemap-static.xml', 'push-sw.js', '.deploy-manifest.json',
]

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const log = (s = '') => console.log(s)
const fail = (m) => { console.error(c(31, `\n✖ ${m}\n`)); process.exit(1) }

const host = process.env.FTP_HOST || cfg.ftp?.host
const port = Number(process.env.FTP_PORT || cfg.ftp?.port || 21)
const user = process.env.FTP_USER || cfg.ftp?.user
const password = process.env.FTP_PASSWORD
if (!host || !user) {
  fail('Set FTP_HOST and FTP_USER in .env.deploy — copy them from hPanel → Files → FTP Accounts.\n' +
       '  Do not guess the host: ftp.sporta.com.kw has no DNS record.')
}
if (!password && !DRY) fail('Set FTP_PASSWORD in .env.deploy. It is git-ignored; never commit it.')

// ---------------------------------------------------------------- 1. build
const outputDir = join(web, cfg.build?.outputDir ?? 'dist')
if (!NO_BUILD) {
  log(c(36, '▸ Building'))
  // The VITE_ variables are emptied, exactly as make-package.mjs does it. This
  // is not tidiness: whatever is in the developer's .env would otherwise be
  // baked into the bundle as a fallback, so a missing config.js on the server
  // would quietly fall back to those values instead of failing closed — and a
  // dev or staging backend URL could end up compiled into production. It
  // also keeps what publish sends identical to what the audited zip contains.
  execFileSync('npm', ['run', 'release'], {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, VITE_PAY_BASE_URL: '', VITE_CBK_BASE_URL: '', VITE_PHP_API_URL: '' },
  })
}
if (!existsSync(outputDir)) fail(`No build output at ${outputDir}. Run without --no-build.`)

// ---------------------------------------------------------------- 2. inventory
const found = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    statSync(p).isDirectory() ? walk(p) : found.push(p)
  }
})(outputDir)

const rel = (p) => relative(outputDir, p).split('\\').join('/')
const all = found.map((p) => ({ abs: p, rel: rel(p) })).filter((f) => !/\.map$/.test(f.rel))

const skipped = { held: [], setup: [], never: [] }
const upload = all.filter((f) => {
  if (NEVER_SEND.includes(f.rel)) { skipped.never.push(f.rel); return false }
  if (NEVER_OVERWRITE.includes(f.rel)) { skipped.held.push(f.rel); return false }
  if (!SETUP_TOOLS && SETUP_ONLY.includes(f.rel)) { skipped.setup.push(f.rel); return false }
  return true
})

// Order is deliberate: index.html LAST. It names the hashed asset files, so if a
// run dies part-way through, an old index.html pointing at assets that are all
// present is a working site, while a new index.html pointing at assets that have
// not arrived yet is a white screen.
upload.sort((a, b) => (a.rel === 'index.html') - (b.rel === 'index.html') || a.rel.localeCompare(b.rel))

// Refuse to proceed if anything that must be verified is not being sent.
const missingCritical = MUST_VERIFY.filter((r) => !upload.some((f) => f.rel === r))
if (missingCritical.length) {
  fail(`These must be uploaded and are not in the set: ${missingCritical.join(', ')}\n` +
       '  Refusing to publish a partial site rather than skip the check quietly.')
}

if (skipped.held.length) log(c(33, `  server copy wins, not sent: ${skipped.held.join(', ')}`))
if (skipped.setup.length) {
  log(c(33, `  setup tools NOT sent: ${skipped.setup.join(', ')}`))
  log(c(90, '    (GO-LIVE says delete these once set up. Pass --setup-tools if you still need them.)'))
}

// The audit that gates the zip runs here too, so publishing cannot become a way
// around it.
log(c(36, '▸ Auditing the build'))
try {
  execFileSync('node', [join(web, 'scripts', 'file-audit.mjs'), outputDir], { stdio: 'inherit' })
} catch {
  fail('file audit failed — nothing was uploaded')
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

log()
log(c(36, '▸ Publishing to ') + `${user}@${host}:${port}${REMOTE}`)
log(`  ${upload.length} file(s)${DRY ? c(33, '   [DRY RUN — nothing will be written]') : ''}`)

if (DRY) {
  for (const f of upload) log(`    ${f.rel}`)
  log(c(33, '\nDry run only — no connection was opened, so this cannot confirm the host'))
  log(c(33, 'or the credentials are right. Re-run without --dry-run to publish.'))
  process.exit(0)
}

// ---------------------------------------------------------------- 3. upload
const client = new Client(30_000)
client.ftp.verbose = false
let sent = 0

try {
  // secure:true is explicit FTPS (AUTH TLS). Plain FTP would put the password
  // and every byte of the site on the wire in clear text.
  // SNI must not be a bare IP — RFC 6066 forbids it and Node warns.
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host)
  await client.access({
    host, port, user, password, secure: true,
    secureOptions: {
      ...(isIp ? {} : { servername: host }),
      rejectUnauthorized: process.env.FTP_INSECURE !== '1',
    },
  })
  await client.ensureDir(REMOTE)

  // Parents before children — a lexical sort gives that for free.
  const dirs = [...new Set(upload.map((f) => dirname(f.rel)).filter((d) => d !== '.'))].sort()
  for (const d of dirs) await client.ensureDir(`${REMOTE}/${d}`)

  for (const f of upload) {
    await client.uploadFrom(createReadStream(f.abs), `${REMOTE}/${f.rel}`)
    sent++
    process.stdout.write(`\r  uploaded ${sent}/${upload.length}  ${f.rel.slice(0, 44).padEnd(44)}`)
  }
  process.stdout.write('\n')

  // ------------------------------------------------------------- 4. verify
  log(c(36, '▸ Verifying'))
  const download = async (remotePath) => {
    const chunks = []
    await client.downloadTo(new Writable({ write(ch, _e, cb) { chunks.push(ch); cb() } }), remotePath)
    return Buffer.concat(chunks)
  }
  for (const r of MUST_VERIFY) {
    const remote = createHash('sha256').update(await download(`${REMOTE}/${r}`)).digest('hex')
    if (sha(join(outputDir, r)) !== remote) fail(`${r} does not match after upload — the server copy is wrong`)
    log(c(32, `  ✓ ${r} matches byte for byte`))
  }

  // --------------------------------------- 5. config.js: create, never clobber
  const root = await client.list(REMOTE)
  const rootNames = root.map((i) => i.name)
  if (rootNames.includes('config.js')) {
    log(c(32, '  ✓ config.js left untouched on the server'))
  } else {
    // A first publish to a fresh server would otherwise leave no config.js at
    // all, and the storefront would render while refusing every order.
    await client.uploadFrom(createReadStream(join(outputDir, 'config.js')), `${REMOTE}/config.js`)
    log(c(33, '  ! config.js was missing — uploaded the blank template.'))
    log(c(33, '    Edit it in File Manager if the site needs non-default endpoints.'))
  }
  const knetNames = (await client.list(`${REMOTE}/knet`).catch(() => [])).map((i) => i.name)
  log(knetNames.includes('config.php')
    ? c(32, '  ✓ knet/config.php left untouched on the server')
    : c(33, '  ! knet/config.php is not on the server — payments cannot work until you create it\n' +
            '    (copy knet/config.example.php to knet/config.php and fill in five values)'))

  // ----------------------------------------- 5b. permissions, actually set
  // deploy.config.json has declared filePermissions 644 and dirPermissions 755
  // since it was written, and nothing ever applied them: files landed with
  // whatever the FTP account's umask happened to be. On a shared host that is
  // the difference between "the web server can read this" and "every other
  // account on the box can write it".
  //
  // 644 / 755 is the correct pair here and not a rule of thumb: PHP runs as the
  // account's own user, so nothing needs group or world write, and a directory
  // needs execute to be traversable at all. 777 — the thing people reach for
  // when an upload will not work — makes every file on this account writable by
  // anything else running on the machine.
  //
  // Only the uploaded set is touched, so config.js and knet/config.php are out
  // of reach by construction: they are filtered out before this point and their
  // modes stay whatever the owner set in File Manager.
  //
  // Best effort by design, and LAST on purpose. SITE CHMOD is an optional FTP
  // extension; some servers refuse it and some drop the control connection on an
  // unknown command. Running it before the byte-for-byte verify would let a
  // refused mode change turn a publish that had already put a correct site on
  // the server into a failed one — so it runs after everything that matters has
  // been confirmed. One clear line beats 300 identical errors, so the first
  // refusal stops the attempt.
  const FILE_MODE = String(cfg.upload?.filePermissions ?? '644')
  const DIR_MODE = String(cfg.upload?.dirPermissions ?? '755')
  const chmod = async (mode, path) => {
    await client.send(`SITE CHMOD ${mode} ${path}`)
  }
  let chmodOk = 0
  let chmodRefused = null
  for (const [mode, paths] of [
    [DIR_MODE, dirs.map((d) => `${REMOTE}/${d}`)],
    [FILE_MODE, upload.map((f) => `${REMOTE}/${f.rel}`)],
  ]) {
    for (const path of paths) {
      if (chmodRefused) break
      try {
        await chmod(mode, path)
        chmodOk++
      } catch (e) {
        chmodRefused = e?.message ?? String(e)
      }
    }
  }
  if (chmodRefused) {
    log(c(33, `  ! SITE CHMOD refused after ${chmodOk} file(s): ${chmodRefused.slice(0, 90)}`))
    log(c(33, `    Set ${FILE_MODE} on files and ${DIR_MODE} on folders in hPanel File Manager,`))
    log(c(33, '    or leave them: Hostinger\'s default umask is usually already correct.'))
  } else {
    log(c(32, `  ✓ ${chmodOk} path(s) set to ${FILE_MODE}/${DIR_MODE}`))
  }


  // --------------------- 6. what is on the server that should not be
  // Publish never deletes, so leftovers from the previous site survive forever
  // unless someone is told about them.
  const present = new Set([...rootNames, ...knetNames.map((n) => `knet/${n}`)])
  const leftovers = DANGEROUS_LEFTOVERS.filter((n) => present.has(n))
  const staleSetup = SETUP_ONLY.filter((n) => present.has(n) && !SETUP_TOOLS)
  if (leftovers.length || staleSetup.length) {
    log()
    log(c(33, '▸ Still on the server, and not part of this site — delete in File Manager:'))
    for (const n of leftovers) log(c(33, `    ${n}`))
    for (const n of staleSetup) log(c(33, `    ${n}   (reveals configuration state)`))
    if (leftovers.includes('index.php')) {
      log(c(31, '\n  index.php is the serious one: if .htaccess is ever lost, Hostinger'))
      log(c(31, '  serves it instead of the React app and the OLD site comes back.'))
    }
    if (leftovers.includes('sporta-deploy.php')) {
      log(c(31, '\n  sporta-deploy.php is a deploy endpoint reachable from the internet.'))
      log(c(31, '  Delete it — this bridge replaces it and needs nothing on the server.'))
    }
  }

  log(c(32, `\n✔ Published ${sent} file(s) to ${host}${REMOTE}\n`))
} catch (e) {
  fail(`FTPS failed: ${e.message}`)
} finally {
  client.close()
}
