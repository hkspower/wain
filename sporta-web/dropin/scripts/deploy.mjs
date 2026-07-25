// Config-driven Hostinger deploy runner.
//
// Reads deploy.config.json (SSH target, build, upload globs/permissions,
// verification) and credentials from .env.deploy, then:
//   1. builds            (config.build.command)
//   2. uploads over SFTP (mirror, include/exclude, file/dir permissions)
//   3. verifies          (.htaccess hash, critical files, healthcheck)
//   4. notifies          (config.notify webhooks)
//
// Usage:
//   node scripts/deploy.mjs                 # build + deploy + verify
//   node scripts/deploy.mjs --no-build      # skip build (deploy existing dist)
//   node scripts/deploy.mjs --config other.json
//
// Credentials in .env.deploy (never commit):
//   HOSTINGER_SSH_PASSWORD=...        (or)
//   HOSTINGER_SSH_KEY_PATH=~/.ssh/id_ed25519
//   HOSTINGER_SSH_PASSPHRASE=...      (optional, for an encrypted key)
//
// Deps: ssh2-sftp-client, dotenv (both in package.json devDependencies).

import { config as loadEnv } from 'dotenv'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, relative, resolve } from 'node:path'

loadEnv({ path: '.env.deploy' })

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const NO_BUILD = argv.includes('--no-build')
const CONFIG_PATH = arg('--config') || 'deploy.config.json'

// --- helpers ---------------------------------------------------------------

const log = (m) => console.log(m)
const step = (m) => console.log(`\n▶ ${m}`)
function fail(m, err) {
  console.error(`\n✖ ${m}${err ? `\n  ${err.message || err}` : ''}\n`)
  process.exit(1)
}
const expandHome = (p) => (p?.startsWith('~') ? join(homedir(), p.slice(1)) : p)
const mode = (s, dflt) => (s ? parseInt(s, 8) : dflt)

// Minimal glob -> RegExp (supports **, *, ?). Matched against posix paths.
function globToRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$')
}
const matchesAny = (path, patterns) => patterns.some((p) => globToRe(p).test(path))

// Recursively list files under dir as { abs, rel(posix) }.
function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) out.push(...walk(abs, base))
    else out.push({ abs, rel: relative(base, abs).split(/[\\/]/).join('/') })
  }
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// --- load config -----------------------------------------------------------

if (!existsSync(CONFIG_PATH)) fail(`Config not found: ${CONFIG_PATH}`)
let cfg
try {
  cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
} catch (e) {
  fail(`Could not parse ${CONFIG_PATH}`, e)
}

const ssh = cfg.ssh || {}
const outputDir = resolve(cfg.build?.outputDir || 'dist')
const remoteDir = ssh.remoteDir || '/public_html'
const filePerm = mode(cfg.upload?.filePermissions, 0o644)
const dirPerm = mode(cfg.upload?.dirPermissions, 0o755)
const include = cfg.upload?.include?.length ? cfg.upload.include : ['**/*']
const exclude = cfg.upload?.exclude || []
const mirror = !!cfg.upload?.mirror

const PASSWORD = process.env.HOSTINGER_SSH_PASSWORD
const KEY_PATH = expandHome(process.env.HOSTINGER_SSH_KEY_PATH)
const PASSPHRASE = process.env.HOSTINGER_SSH_PASSPHRASE

if (!ssh.host) fail('deploy.config.json: ssh.host is required')
if (!ssh.user) fail('deploy.config.json: ssh.user is required')
if (!PASSWORD && !KEY_PATH) {
  fail('Set HOSTINGER_SSH_PASSWORD or HOSTINGER_SSH_KEY_PATH in .env.deploy')
}

// --- 1. build --------------------------------------------------------------

if (!NO_BUILD && cfg.build?.command) {
  step(`Building: ${cfg.build.command}`)
  try {
    execSync(cfg.build.command, { stdio: 'inherit' })
  } catch (e) {
    fail('Build failed', e)
  }
}
if (!existsSync(outputDir)) fail(`Output dir not found: ${outputDir} (build first?)`)

// --- collect files to upload ----------------------------------------------

const files = walk(outputDir).filter(
  (f) => matchesAny(f.rel, include) && !matchesAny(f.rel, exclude),
)
if (!files.length) fail(`No files to upload from ${outputDir} after include/exclude filtering`)

log(`\n▶ Target   ${ssh.user}@${ssh.host}:${ssh.port || 22} ${remoteDir}`)
log(`  Files    ${files.length}  (mirror: ${mirror ? 'yes' : 'no'})`)

// --- SFTP session ----------------------------------------------------------

const { default: SftpClient } = await import('ssh2-sftp-client')
const sftp = new SftpClient()

const remotePath = (rel) => posix.join(remoteDir, rel)
const ensuredDirs = new Set()
async function ensureRemoteDir(dir) {
  if (ensuredDirs.has(dir) || dir === '/' || dir === '.') return
  await sftp.mkdir(dir, true).catch(() => {})
  await sftp.chmod(dir, dirPerm).catch(() => {})
  ensuredDirs.add(dir)
}

try {
  const conn = { host: ssh.host, port: ssh.port || 22, username: ssh.user }
  if (KEY_PATH) {
    conn.privateKey = readFileSync(resolve(KEY_PATH))
    if (PASSPHRASE) conn.passphrase = PASSPHRASE
  } else {
    conn.password = PASSWORD
  }
  await sftp.connect(conn)

  // 2. upload
  step('Uploading')
  if (mirror && (await sftp.exists(remoteDir))) {
    // Mirror deletes remote files that no longer exist locally. Anything the
    // SERVER owns must be kept or the deploy destroys it — most importantly
    // knet/config.php, which holds the live Tranportal credentials and is
    // deliberately never uploaded. (This used to delete the whole of
    // public_html unconditionally, payment endpoints included.)
    const keep = ['.well-known', 'knet', '.env', ...(cfg.upload?.keep || [])]
    for (const item of await sftp.list(remoteDir)) {
      if (keep.includes(item.name) || item.name.startsWith('.')) {
        log(`  · kept    ${item.name}`)
        continue
      }
      const p = posix.join(remoteDir, item.name)
      if (item.type === 'd') await sftp.rmdir(p, true).catch(() => {})
      else await sftp.delete(p).catch(() => {})
    }
  }
  await ensureRemoteDir(remoteDir)

  let n = 0
  for (const f of files) {
    const rp = remotePath(f.rel)
    await ensureRemoteDir(posix.dirname(rp))
    await sftp.fastPut(f.abs, rp)
    await sftp.chmod(rp, filePerm).catch(() => {})
    n++
    if (n % 10 === 0 || n === files.length) process.stdout.write(`\r  ${n}/${files.length}`)
  }
  process.stdout.write('\n')

  // 3. verify
  await verify(sftp)
} catch (e) {
  await sftp.end().catch(() => {})
  await notify(cfg.notify?.onFailure, { ok: false, error: String(e?.message || e) })
  fail('Deploy failed', e)
}
await sftp.end().catch(() => {})

await notify(cfg.notify?.onSuccess, { ok: true, files: files.length })
log('\n✓ Deploy complete.\n')

// --- 4. verification -------------------------------------------------------

async function verify(sftp) {
  const v = cfg.verify
  if (!v) return
  step('Verifying')

  // critical files present
  for (const rel of v.criticalFiles || []) {
    const rp = remotePath(rel)
    if (!(await sftp.exists(rp))) fail(`Critical file missing on server: ${rel}`)
    log(`  ✓ present  ${rel}`)
  }

  // .htaccess hash + permission compare
  if (v.htaccess?.local && v.htaccess?.remote) {
    const localPath = resolve(v.htaccess.local)
    if (existsSync(localPath)) {
      const stat = await sftp.stat(v.htaccess.remote).catch(() => null)
      if (!stat) fail(`.htaccess missing on server: ${v.htaccess.remote}`)
      const remoteBuf = await sftp.get(v.htaccess.remote)
      const localHash = sha256(readFileSync(localPath))
      const remoteHash = sha256(Buffer.isBuffer(remoteBuf) ? remoteBuf : Buffer.from(remoteBuf))
      if (localHash !== remoteHash) fail('.htaccess hash mismatch between local and server')
      if (v.htaccess.expectedPermissions) {
        const want = mode(v.htaccess.expectedPermissions)
        const got = stat.mode & 0o777
        if (got !== want) log(`  ! .htaccess perms ${got.toString(8)} (expected ${want.toString(8)})`)
      }
      log('  ✓ .htaccess matches')
    } else {
      log(`  ! skipped .htaccess check (local ${v.htaccess.local} not found)`)
    }
  }

  // healthcheck
  if (v.healthcheck?.url) {
    const { url, expectStatusRange = [200, 399], retries = 3, retryDelayMs = 3000, userAgent } =
      v.healthcheck
    let lastStatus = 0
    for (let i = 1; i <= retries; i++) {
      try {
        const res = await fetch(url, { headers: userAgent ? { 'User-Agent': userAgent } : {} })
        lastStatus = res.status
        if (res.status >= expectStatusRange[0] && res.status <= expectStatusRange[1]) {
          log(`  ✓ healthcheck ${url} -> ${res.status}`)
          return
        }
      } catch (e) {
        lastStatus = `error: ${e.message}`
      }
      if (i < retries) await new Promise((r) => setTimeout(r, retryDelayMs))
    }
    fail(`Healthcheck failed for ${url} (last: ${lastStatus})`)
  }
}

// --- notify ----------------------------------------------------------------

async function notify(targets, payload) {
  if (!targets?.length) return
  for (const t of targets) {
    const url = typeof t === 'string' ? t : t?.url
    if (!url) continue
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      /* non-fatal */
    }
  }
}
