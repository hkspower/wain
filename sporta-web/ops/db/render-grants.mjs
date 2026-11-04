#!/usr/bin/env node
// render-grants.mjs — fills in ops/db/grants.sql and prints SQL for the client.
//
//   node ops/db/render-grants.mjs --db sporta --app-host 172.18.0.% \
//        --job-host 172.18.0.% --secrets /path/to/dir --generate \
//        [--activate web,knet,tpay,ro] [--only knet,tpay] [--additive] | mariadb -h <db> -u <admin> -p...
//
//   node ops/db/render-grants.mjs --db sporta --app-host H --secrets DIR --rotate web,knet
//        prints ALTER USER ... for those accounts only, with FRESH passwords
//        (the old file is kept beside it as <name>.pass.prev)
//
//   node ops/db/render-grants.mjs --app-host H --job-host H --unlock migrate
//   node ops/db/render-grants.mjs --app-host H --job-host H --lock migrate,ro
//        prints ALTER USER ... ACCOUNT UNLOCK / LOCK for those accounts and nothing else
//
// WHAT IT DOES, AND WHAT IT NEVER DOES
//   * The passwords are generated HERE, from the operating system's CSPRNG
//     (crypto.randomInt), 40 characters of [A-Za-z0-9_-] with at least one of
//     each class, and written to <secrets>/<account>.pass with mode 0600,
//     created exclusively: an existing file is never overwritten except by
//     --rotate. No password is ever printed to a terminal, a log or an error
//     message.
//   * The SERVER IS SENT ONLY THE HASH. MariaDB writes `CREATE USER ... IDENTIFIED
//     BY 'plaintext'` verbatim into its general log, its slow-query log and the
//     statement history of performance_schema (measured), so the SQL this tool
//     prints carries `IDENTIFIED VIA mysql_native_password USING '*HASH'` (the
//     same value `SHOW CREATE USER` prints): the account signs in with the
//     password in the 0600 file, and no log of the server ever holds it.
//     (The password-policy plugins only look at plaintext; the length and
//     character classes are enforced here instead.)
//   * It refuses a host pattern that is "anyone" or close to it: %, an empty
//     string, any wildcard that is not a trailing `.%` after whole octets
//     (`1%`, `1.%.%.%`), a netmask that is not a contiguous mask of at least 8
//     bits (`0.0.0.0/0.0.0.0` is "anybody"), and anything with a quote,
//     backslash, space or semicolon (the value goes into SQL).
//   * --only limits the output to the named accounts' blocks; --additive leaves
//     out the "empty the account, then grant again" step. A live account that is
//     emptied has NO privilege until its grants are back (seconds for the whole
//     file, measured): use --additive for a re-apply while the shop is running.
//   * It refuses to emit SQL if a placeholder is left over, and refuses to print
//     SQL that carries a password hash to a terminal.
//   * It connects to nothing. It reads grants.sql and writes text and key files.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { createHash, randomInt } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from './accounts.mjs'

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
/** mysql_native_password: '*' + upper(hex(sha1(sha1(password)))). The value `SHOW CREATE USER` prints. */
export function nativeHash(pw) {
  const inner = createHash('sha1').update(pw, 'utf8').digest()
  return `*${createHash('sha1').update(inner).digest('hex').toUpperCase()}`
}

// ------------------------------------------------------------ host patterns
const octet = (s) => /^(0|[1-9]\d{0,2})$/.test(s) && Number(s) <= 255
/** A contiguous netmask of at least 8 bits: 255.0.0.0 and narrower. 0.0.0.0 and 128.0.0.0 are "anybody". */
function maskBits(m) {
  const o = m.split('.')
  if (o.length !== 4 || !o.every(octet)) return -1
  const n = o.reduce((a, b) => a * 256 + Number(b), 0)
  let bits = 0
  while (bits < 32 && (n >>> (31 - bits)) & 1) bits++
  const expect = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (n >>> 0) === expect ? bits : -1
}
/**
 * The only shapes accepted for a host the accounts are bound to:
 *   172.18.0.5                       one IPv4 address
 *   172.18.0.%   172.18.%   10.%     whole leading octets, then one trailing .%
 *   172.16.0.0/255.240.0.0           address/netmask, mask contiguous and at least /8
 *   fd00::5                          one IPv6 address
 *   localhost  or  db.internal       a name with no wildcard at all
 * Everything else is refused: a wildcard anywhere else (`1%`, `1.%.%.%`, `a%`) is a
 * pattern that matches far more than a docker network, and `0.0.0.0/0.0.0.0` is the
 * netmask spelling of `%`.
 */
export function hostOk(h) {
  if (typeof h !== 'string' || h.length === 0 || h.length > 60) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/%-]*$/.test(h)) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h.split('.').every(octet) && h !== '0.0.0.0'
  let m = h.match(/^((?:\d+\.){1,3})%$/)
  if (m) { const o = m[1].slice(0, -1).split('.'); return o.every(octet) && Number(o[0]) > 0 }
  m = h.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return m[1].split('.').every(octet) && maskBits(m[2]) >= 8
  if (h.includes('%') || h.includes('_') || h.includes('/')) return false
  if (h.includes(':')) return /^[0-9A-Fa-f:]+$/.test(h) && (h.match(/:/g) ?? []).length >= 2 && !/^:+$/.test(h)
  return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h)
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

const accountList = (names, what) => {
  const keys = [...new Set(names)]
  for (const k of keys) if (!ACCOUNTS[k]) throw new Error(`${what}: unknown account ${k}`)
  return keys
}

/** Keep the header, the footer and the blocks of the chosen accounts; drop the other blocks. */
export function selectBlocks(sql, keys) {
  const keep = new Set(keys)
  const out = []
  let inside = null
  for (const line of sql.split('\n')) {
    const b = line.match(/^-- BEGIN ACCOUNT ([a-z]+)$/)
    if (b) { inside = b[1]; if (!ACCOUNTS[inside]) throw new Error(`grants.sql names an unknown account ${inside}`) }
    if (inside === null || keep.has(inside)) out.push(line)
    if (/^-- END ACCOUNT [a-z]+$/.test(line)) inside = null
  }
  return out.join('\n')
}

/** Pure: returns the SQL for the given options (used by the suite as well). */
export function render({ db, appHost, jobHost, passwords, activate = [], only, additive = false, template = readFileSync(join(HERE, 'grants.sql'), 'utf8') }) {
  if (!dbOk(db)) throw new Error('--db must be letters, digits and underscores')
  if (!hostOk(appHost)) throw new Error('--app-host must be the docker network pattern, not a wildcard')
  if (!hostOk(jobHost)) throw new Error('--job-host must be the job network pattern, not a wildcard')
  const keys = only ? accountList(only, '--only') : Object.keys(ACCOUNTS)
  if (!keys.length) throw new Error('--only names no account')
  for (const k of accountList(activate, '--activate')) if (!keys.includes(k)) throw new Error(`--activate: ${k} is not among the accounts being rendered`)
  let sql = only ? selectBlocks(template, keys) : template
  if (additive) sql = sql.split('\n').filter((l) => !/^REVOKE ALL PRIVILEGES, GRANT OPTION FROM /.test(l)).join('\n')
  sql = sql.split('@@DB@@').join(db).split('@@APP_HOST@@').join(appHost).split('@@JOB_HOST@@').join(jobHost)
  for (const key of keys) {
    const pw = passwords[key]
    if (!passwordOk(pw)) throw new Error(`password for ${ACCOUNTS[key].user} is missing or too weak`)
    sql = sql.split(`@@HASH_${key.toUpperCase()}@@`).join(nativeHash(pw))
  }
  const left = sql.match(/@@[A-Z_]+@@/)
  if (left) throw new Error(`placeholder left over: ${left[0]}`)
  let out = `SET @sporta_rendered = 1;\n${sql}`
  for (const key of activate) {
    const a = ACCOUNTS[key]
    out += `ALTER USER '${a.user}'@'${a.host === 'app' ? appHost : jobHost}' ACCOUNT UNLOCK;\n`
  }
  return out
}

export function renderRotate({ appHost, jobHost, passwords, accounts }) {
  if (!hostOk(appHost)) throw new Error('--app-host must be the docker network pattern, not a wildcard')
  if (jobHost !== undefined && !hostOk(jobHost)) throw new Error('--job-host must be the job network pattern, not a wildcard')
  let out = ''
  for (const key of accountList(accounts, '--rotate')) {
    const a = ACCOUNTS[key]
    if (!passwordOk(passwords[key])) throw new Error(`new password for ${a.user} is too weak`)
    const host = a.host === 'app' ? appHost : jobHost
    if (!host) throw new Error(`--job-host is needed to rotate ${a.user}`)
    out += `ALTER USER '${a.user}'@'${host}' IDENTIFIED VIA mysql_native_password USING '${nativeHash(passwords[key])}';\n`
  }
  return out + 'FLUSH PRIVILEGES;\n'
}

/** ALTER USER ... ACCOUNT LOCK / UNLOCK for the named accounts. No password, no secret. */
export function renderLockState({ appHost, jobHost, accounts, lock }) {
  if (!hostOk(appHost)) throw new Error('--app-host must be the docker network pattern, not a wildcard')
  if (jobHost !== undefined && !hostOk(jobHost)) throw new Error('--job-host must be the job network pattern, not a wildcard')
  let out = ''
  for (const key of accountList(accounts, lock ? '--lock' : '--unlock')) {
    const a = ACCOUNTS[key]
    const host = a.host === 'app' ? appHost : jobHost
    if (!host) throw new Error(`--job-host is needed for ${a.user}`)
    out += `ALTER USER '${a.user}'@'${host}' ACCOUNT ${lock ? 'LOCK' : 'UNLOCK'};\n`
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = (f) => (arg(f) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const appHost = arg('--app-host'); const jobHost = arg('--job-host'); const db = arg('--db', 'sporta')
  try {
    if (flag('--lock') || flag('--unlock')) {
      if (flag('--lock') && flag('--unlock')) die('--lock and --unlock are two runs')
      const lock = flag('--lock')
      const accounts = list(lock ? '--lock' : '--unlock')
      if (!accounts.length) die(`${lock ? '--lock' : '--unlock'} takes a list of accounts, e.g. --${lock ? 'lock' : 'unlock'} migrate`)
      process.stdout.write(renderLockState({ appHost, jobHost, accounts, lock }))
      process.exit(0)
    }
    const dir = arg('--secrets')
    if (!dir) die('--secrets <dir> is required (the directory that holds, or will hold, the 0600 password files)')
    if (process.stdout.isTTY && !flag('--allow-tty')) die('refusing to print SQL that carries password hashes to a terminal: pipe it into the client (| mariadb ...) or redirect it to a 0600 file (umask 077)')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch { /* not ours to chmod */ }
    if (flag('--rotate') || arg('--rotate')) {
      const accounts = list('--rotate')
      if (!accounts.length) die('--rotate takes a list of accounts, e.g. --rotate web,knet')
      for (const k of accounts) if (!ACCOUNTS[k]) die(`unknown account ${k}`)
      const passwords = {}
      for (const k of accounts) passwords[k] = newPassword()
      const sql = renderRotate({ appHost, jobHost, passwords, accounts })
      for (const k of accounts) writeKey(dir, k, passwords[k], { replace: true })
      process.stdout.write(sql)
    } else {
      const only = flag('--only') ? list('--only') : undefined
      const keys = only ?? Object.keys(ACCOUNTS)
      for (const k of keys) if (!ACCOUNTS[k]) die(`unknown account ${k}`)
      const passwords = {}
      for (const key of keys) {
        let pw = readKey(dir, key)
        if (pw === null) {
          if (!flag('--generate')) die(`no password file for ${ACCOUNTS[key].user} in the secrets directory (use --generate to create it)`)
          pw = newPassword(); writeKey(dir, key, pw)
        }
        passwords[key] = pw
      }
      process.stdout.write(render({ db, appHost, jobHost, passwords, activate: list('--activate'), only, additive: flag('--additive') }))
    }
  } catch (e) {
    die(String(e.message).replace(/'[A-Za-z0-9_-]{32,}'/g, "'<hidden>'"))
  }
}
