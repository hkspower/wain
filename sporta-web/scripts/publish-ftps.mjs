// Publish to Hostinger over FTPS — the bridge that works with SSH switched off.
//
//   node scripts/publish-ftps.mjs            # build, then upload
//   node scripts/publish-ftps.mjs --dry-run  # list what would change, upload nothing
//   node scripts/publish-ftps.mjs --no-build # upload the existing dist/
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
//
// WHAT IT WILL NOT TOUCH
// config.js and knet/config.php live only on the server and hold the live
// Supabase and Tranportal credentials. They are never uploaded and never
// deleted, whatever the include patterns say. That is enforced here rather than
// left to configuration, because getting it wrong costs real money.
import { Client } from 'basic-ftp'
import { readFileSync, readdirSync, statSync, existsSync, createReadStream } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { config as loadEnv } from 'dotenv'

const web = resolve(new URL('..', import.meta.url).pathname)
loadEnv({ path: join(web, '.env.deploy') })

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_BUILD = argv.includes('--no-build')

const cfg = JSON.parse(readFileSync(join(web, 'deploy.config.json'), 'utf8'))
const REMOTE = cfg.ftp?.remoteDir ?? '/public_html'

// Never uploaded, never deleted. Not configurable on purpose.
const NEVER_TOUCH = ['config.js', 'knet/config.php', '.env', '.env.deploy']

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const log = (s = '') => console.log(s)
const fail = (m) => { console.error(c(31, `\n✖ ${m}\n`)); process.exit(1) }

const host = process.env.FTP_HOST || cfg.ftp?.host
const port = Number(process.env.FTP_PORT || cfg.ftp?.port || 21)
const user = process.env.FTP_USER || cfg.ftp?.user
const password = process.env.FTP_PASSWORD
if (!host || !user) fail('Set FTP_HOST and FTP_USER in .env.deploy (hPanel → Files → FTP Accounts).')
if (!password && !DRY) fail('Set FTP_PASSWORD in .env.deploy. It is git-ignored; never commit it.')

// ---------------------------------------------------------------- 1. build
const outputDir = join(web, cfg.build?.outputDir ?? 'dist')
if (!NO_BUILD) {
  log(c(36, '▸ Building'))
  execFileSync('npm', ['run', 'release'], { cwd: web, stdio: 'inherit' })
}
if (!existsSync(outputDir)) fail(`No build output at ${outputDir}. Run without --no-build.`)

// ---------------------------------------------------------------- 2. inventory
const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    statSync(p).isDirectory() ? walk(p) : files.push(p)
  }
})(outputDir)

const rel = (p) => relative(outputDir, p).split('\\').join('/')
const SKIP = /(^|\/)(\.DS_Store|.*\.map)$/
const upload = files
  .map((p) => ({ abs: p, rel: rel(p) }))
  .filter((f) => !SKIP.test(f.rel) && !NEVER_TOUCH.includes(f.rel))

const held = files.map((p) => rel(p)).filter((r) => NEVER_TOUCH.includes(r))
if (held.length) log(c(33, `  holding back (server copy wins): ${held.join(', ')}`))

// The audit is the same one that gates the zip; publishing must not be a way
// around it.
log(c(36, '▸ Auditing the build'))
try {
  execFileSync('node', [join(web, 'scripts', 'file-audit.mjs'), outputDir], { stdio: 'inherit' })
} catch {
  fail('file audit failed — nothing was uploaded')
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

log()
log(c(36, '▸ Publishing to ') + `${user}@${host}${REMOTE}`)
log(`  ${upload.length} file(s)${DRY ? c(33, '   [DRY RUN — nothing will be written]') : ''}`)

if (DRY) {
  for (const f of upload.slice(0, 40)) log(`    ${f.rel}`)
  if (upload.length > 40) log(`    … and ${upload.length - 40} more`)
  log(c(33, '\nDry run only. Re-run without --dry-run to publish.'))
  process.exit(0)
}

// ---------------------------------------------------------------- 3. upload
const client = new Client(30_000)
client.ftp.verbose = false
let sent = 0

try {
  // secure:true is explicit FTPS (AUTH TLS). Plain FTP would put the password
  // and every byte of the site on the wire in clear text.
  // SNI must not be set to a bare IP — RFC 6066 forbids it and Node warns.
  // Hostinger is reached by hostname, so this only matters when testing.
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host)
  await client.access({
    host, port, user, password, secure: true,
    secureOptions: {
      ...(isIp ? {} : { servername: host }),
      rejectUnauthorized: process.env.FTP_INSECURE !== '1',
    },
  })
  await client.ensureDir(REMOTE)
  await client.cd(REMOTE)

  // Deepest paths last so parent directories exist first.
  const dirs = [...new Set(upload.map((f) => dirname(f.rel)).filter((d) => d !== '.'))].sort()
  for (const d of dirs) await client.ensureDir(`${REMOTE}/${d}`).then(() => client.cd(REMOTE))

  for (const f of upload) {
    if (NEVER_TOUCH.includes(f.rel)) continue // belt and braces
    await client.uploadFrom(createReadStream(f.abs), `${REMOTE}/${f.rel}`)
    sent++
    process.stdout.write(`\r  uploaded ${sent}/${upload.length}  ${f.rel.slice(0, 46).padEnd(46)}`)
  }
  process.stdout.write('\n')

  // ------------------------------------------------------------- 4. verify
  // Uploading without checking is how a truncated .htaccess goes unnoticed for
  // a week. Both .htaccess files are re-downloaded and compared byte for byte,
  // because they are hidden, easy to miss, and the ones that break routing and
  // every security header when wrong.
  log(c(36, '▸ Verifying'))
  const mustMatch = ['.htaccess', 'knet/.htaccess', 'index.html'].filter((r) =>
    upload.some((f) => f.rel === r))
  for (const r of mustMatch) {
    const local = sha(join(outputDir, r))
    const chunks = []
    await client.downloadTo(
      new (await import('node:stream')).Writable({
        write(ch, _e, cb) { chunks.push(ch); cb() },
      }),
      `${REMOTE}/${r}`,
    )
    const remote = createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
    if (local !== remote) fail(`${r} does not match after upload — the server copy is wrong`)
    log(c(32, `  ✓ ${r} matches`))
  }

  // And confirm the untouchables are still there.
  const listing = await client.list(REMOTE)
  const names = listing.map((i) => i.name)
  for (const keep of ['config.js']) {
    log(names.includes(keep)
      ? c(32, `  ✓ ${keep} preserved on the server`)
      : c(33, `  ! ${keep} is not on the server — the site cannot reach Supabase until you create it`))
  }

  log(c(32, `\n✔ Published ${sent} file(s) to ${host}${REMOTE}\n`))
} catch (e) {
  fail(`FTPS failed: ${e.message}`)
} finally {
  client.close()
}
