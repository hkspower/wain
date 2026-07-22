// Deploy the built site to Hostinger over SFTP, FTPS, or FTP.
//
// Drop this in your project's scripts/ folder. It matches the npm scripts
// already in package.json:
//   npm run deploy            (mode from env, default ftp)
//   npm run deploy:sftp       HOSTINGER_DEPLOY_MODE=sftp
//   npm run deploy:ftp        HOSTINGER_DEPLOY_MODE=ftp
//   npm run deploy:ftps       HOSTINGER_DEPLOY_MODE=ftps
//   npm run deploy:full:sftp  build first, then this over SFTP
//
// Credentials come from a .env file (see .env.example). Never commit .env.
//
// Deps (already in your package.json): ssh2-sftp-client, basic-ftp, dotenv.

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// --- Config ----------------------------------------------------------------

const MODE = (process.env.HOSTINGER_DEPLOY_MODE || 'ftp').toLowerCase() // ftp | ftps | sftp
const HOST = process.env.HOSTINGER_HOST
const USER = process.env.HOSTINGER_USER
const PASSWORD = process.env.HOSTINGER_PASSWORD
const PRIVATE_KEY = process.env.HOSTINGER_PRIVATE_KEY // optional path, sftp only
const REMOTE_DIR = process.env.HOSTINGER_REMOTE_DIR || '/public_html'
const LOCAL_DIR = resolve(process.env.HOSTINGER_LOCAL_DIR || 'dist')
// Mirror mode deletes remote files not present locally. Enable with
// DEPLOY_CLEAN=true (npm run deploy:sftp:mirror sets this).
const CLEAN = /^(1|true|yes)$/i.test(process.env.DEPLOY_CLEAN || '')

const DEFAULT_PORT = MODE === 'sftp' ? 22 : 21
const PORT = Number(process.env.HOSTINGER_PORT || DEFAULT_PORT)

// --- Validation ------------------------------------------------------------

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

if (!existsSync(LOCAL_DIR)) {
  fail(`Local build folder not found: ${LOCAL_DIR}\n  Run "npm run build" first, or set HOSTINGER_LOCAL_DIR.`)
}
if (!HOST) fail('Missing HOSTINGER_HOST in .env')
if (!USER) fail('Missing HOSTINGER_USER in .env')
if (!PASSWORD && !(MODE === 'sftp' && PRIVATE_KEY)) {
  fail('Missing HOSTINGER_PASSWORD in .env (or HOSTINGER_PRIVATE_KEY for SFTP)')
}

console.log(`\n▶ Deploying to Hostinger`)
console.log(`  mode      ${MODE}`)
console.log(`  host      ${HOST}:${PORT}`)
console.log(`  user      ${USER}`)
console.log(`  local     ${LOCAL_DIR}`)
console.log(`  remote    ${REMOTE_DIR}`)
console.log(`  clean     ${CLEAN ? 'yes (mirror)' : 'no'}\n`)

// --- SFTP ------------------------------------------------------------------

async function deploySftp() {
  const { default: SftpClient } = await import('ssh2-sftp-client')
  const sftp = new SftpClient()
  const conn = { host: HOST, port: PORT, username: USER }
  if (PRIVATE_KEY) {
    const { readFileSync } = await import('node:fs')
    conn.privateKey = readFileSync(resolve(PRIVATE_KEY))
    if (PASSWORD) conn.passphrase = PASSWORD
  } else {
    conn.password = PASSWORD
  }

  await sftp.connect(conn)
  try {
    if (CLEAN && (await sftp.exists(REMOTE_DIR))) {
      // Remove contents but keep the directory itself.
      for (const item of await sftp.list(REMOTE_DIR)) {
        const p = `${REMOTE_DIR}/${item.name}`
        if (item.type === 'd') await sftp.rmdir(p, true)
        else await sftp.delete(p)
      }
    }
    await sftp.mkdir(REMOTE_DIR, true).catch(() => {})
    await sftp.uploadDir(LOCAL_DIR, REMOTE_DIR)
  } finally {
    await sftp.end()
  }
}

// --- FTP / FTPS ------------------------------------------------------------

async function deployFtp(secure) {
  const ftp = await import('basic-ftp')
  const client = new ftp.Client(30_000)
  client.ftp.verbose = false
  try {
    await client.access({ host: HOST, port: PORT, user: USER, password: PASSWORD, secure })
    await client.ensureDir(REMOTE_DIR)
    if (CLEAN) await client.clearWorkingDir()
    // ensureDir leaves us in REMOTE_DIR as the working dir.
    await client.uploadFromDir(LOCAL_DIR)
  } finally {
    client.close()
  }
}

// --- Run -------------------------------------------------------------------

try {
  if (MODE === 'sftp') await deploySftp()
  else if (MODE === 'ftps') await deployFtp(true)
  else await deployFtp(false)
  console.log('\n✓ Deploy complete.\n')
} catch (err) {
  fail(`Deploy failed: ${err?.message || err}`)
}
