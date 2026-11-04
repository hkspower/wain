#!/usr/bin/env node
// render-grants.mjs — fills in ops/db/grants.sql and prints SQL for the client.
//
//   node ops/db/render-grants.mjs --db sporta --app-host 172.16.0.0/255.240.0.0 \
//        --job-host 172.16.0.0/255.240.0.0 --secrets /path/to/dir --generate \
//        [--activate web,knet,tpay,ro] | mariadb -h <db> -u <admin> -p...
//
//   node ops/db/render-grants.mjs --db sporta --app-host H --secrets DIR --rotate web,knet
//        prints ALTER USER ... IDENTIFIED BY ... for those accounts only, with
//        FRESH passwords (the old file is kept beside it as <name>.pass.prev)
//
// WHAT IT DOES, AND WHAT IT NEVER DOES
//   * The passwords are generated HERE, from the operating system's CSPRNG
//     (crypto.randomInt), 40 characters of [A-Za-z0-9_-] with at least one of
//     each class (so they pass MariaDB's simple_password_check plugin when it is
//     on), and written to <secrets>/<account>.pass with mode 0600, created
//     exclusively: an existing file is never overwritten except by --rotate.
//     No password is ever printed to a terminal, a log or an error message; the
//     only place one appears in the output is the SQL on stdout, which is meant
//     for a pipe into the client. It refuses to print to a terminal.
//   * It refuses a host pattern that is "anyone": %, an empty string, a pattern
//     that starts with a wildcard, or anything with a quote, backslash, space or
//     semicolon (the value goes into SQL).
//   * It refuses to emit SQL if a placeholder is left over.
//   * It connects to nothing. It reads grants.sql and writes text and key files.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from './make-grants.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const die = (m) => { process.stderr.write(`render-grants: ${m}\n`); process.exit(2) }

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export const PASSWORD_LENGTH = 40
export function passwordOk(pw) {
  return typeof pw === 'string' && pw.length >= 32 && /^[A-Za-z0-9_-]+$/.test(pw)
    && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[-_]/.test(pw)
}
export function newPassword() {
  for (;;) {
    let pw = ''
    for (let i = 0; i < PASSWORD_LENGTH; i++) pw += ALPHABET[randomInt(ALPHABET.length)]
    if (passwordOk(pw)) return pw
  }
}
export function hostOk(h) {
  return typeof h === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\/%-]*$/.test(h) && !/^[%_]/.test(h) && h.length <= 60
}
export const dbOk = (d) => typeof d === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(d)

function readKey(dir, key) {
  const f = join(dir, `${ACCOUNTS[key].user}.pass`)
  if (!existsSync(f)) return null
  return readFileSync(f, 'utf8').replace(/\r?\n$/, '')
}
function writeKey(dir, key, pw, { replace = false } = {}) {
  const f = join(dir, `${ACCOUNTS[key].user}.pass`)
  if (replace && existsSync(f)) renameSync(f, `${f}.prev`)
  const fd = openSync(f, 'wx', 0o600)
  try { writeSync(fd, pw) } finally { closeSync(fd) }
  chmodSync(f, 0o600)
}

/** Pure: returns the SQL for the given options (used by the suite as well). */
export function render({ db, appHost, jobHost, passwords, activate = [], template = readFileSync(join(HERE, 'grants.sql'), 'utf8') }) {
  if (!dbOk(db)) throw new Error('--db must be letters, digits and underscores')
  if (!hostOk(appHost)) throw new Error('--app-host must be the docker network pattern, not a wildcard')
  if (!hostOk(jobHost)) throw new Error('--job-host must be the job network pattern, not a wildcard')
  let sql = template
  sql = sql.split('@@DB@@').join(db).split('@@APP_HOST@@').join(appHost).split('@@JOB_HOST@@').join(jobHost)
  for (const key of Object.keys(ACCOUNTS)) {
    const pw = passwords[key]
    if (!passwordOk(pw)) throw new Error(`password for ${ACCOUNTS[key].user} is missing or too weak`)
    sql = sql.split(`@@PASSWORD_${key.toUpperCase()}@@`).join(pw)
  }
  const left = sql.match(/@@[A-Z_]+@@/)
  if (left) throw new Error(`placeholder left over: ${left[0]}`)
  let out = `SET @sporta_rendered = 1;\n${sql}`
  for (const key of activate) {
    const a = ACCOUNTS[key]
    if (!a) throw new Error(`--activate: unknown account ${key}`)
    out += `ALTER USER '${a.user}'@'${a.host === 'app' ? appHost : jobHost}' ACCOUNT UNLOCK;\n`
  }
  return out
}

export function renderRotate({ appHost, jobHost, passwords, accounts }) {
  if (!hostOk(appHost)) throw new Error('--app-host must be the docker network pattern, not a wildcard')
  if (jobHost !== undefined && !hostOk(jobHost)) throw new Error('--job-host must be the job network pattern, not a wildcard')
  let out = ''
  for (const key of accounts) {
    const a = ACCOUNTS[key]
    if (!a) throw new Error(`--rotate: unknown account ${key}`)
    if (!passwordOk(passwords[key])) throw new Error(`new password for ${a.user} is too weak`)
    const host = a.host === 'app' ? appHost : jobHost
    if (!host) throw new Error(`--job-host is needed to rotate ${a.user}`)
    out += `ALTER USER '${a.user}'@'${host}' IDENTIFIED BY '${passwords[key]}';\n`
  }
  return out + 'FLUSH PRIVILEGES;\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = arg('--secrets')
  if (!dir) die('--secrets <dir> is required (the directory that holds, or will hold, the 0600 password files)')
  const appHost = arg('--app-host'); const jobHost = arg('--job-host'); const db = arg('--db', 'sporta')
  if (process.stdout.isTTY && !flag('--allow-tty')) die('refusing to print SQL with passwords to a terminal: pipe it into the client (| mariadb ...) or redirect it to a 0600 file')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* not ours to chmod */ }
  try {
    if (flag('--rotate') || arg('--rotate')) {
      const accounts = (arg('--rotate') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      if (!accounts.length) die('--rotate takes a list of accounts, e.g. --rotate web,knet')
      const passwords = {}
      for (const k of accounts) { if (!ACCOUNTS[k]) die(`unknown account ${k}`); passwords[k] = newPassword() }
      const sql = renderRotate({ appHost, jobHost, passwords, accounts })
      for (const k of accounts) writeKey(dir, k, passwords[k], { replace: true })
      process.stdout.write(sql)
    } else {
      const passwords = {}
      for (const key of Object.keys(ACCOUNTS)) {
        let pw = readKey(dir, key)
        if (pw === null) {
          if (!flag('--generate')) die(`no password file for ${ACCOUNTS[key].user} in the secrets directory (use --generate to create it)`)
          pw = newPassword(); writeKey(dir, key, pw)
        }
        passwords[key] = pw
      }
      const activate = (arg('--activate') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      process.stdout.write(render({ db, appHost, jobHost, passwords, activate }))
    }
  } catch (e) {
    die(String(e.message).replace(/'[A-Za-z0-9_-]{32,}'/g, "'<hidden>'"))
  }
}
