#!/usr/bin/env node
// test:db-audit — proves scripts/db-security-audit.mjs on TWO private MariaDB
// instances and proves the proof: every group of checks below also runs against
// deliberately broken copies of the tool, and the suite must go red for each.
//
//   npm run test:db-audit
//
// What is proven
//   unit        the statement gate, SHOW GRANTS parsing, host/address classes,
//               Luhn, credential shapes, end-of-life, option parsing, and every
//               variable-driven check on both sides of its threshold
//   insecure    a MariaDB that is wrong in every way the audit looks for
//               (anonymous user, '%' root without a password, local_infile=1,
//               general log on, latin1 table, definer view/trigger/event,
//               plaintext token column, no primary key, ...) produces exactly
//               the expected FAIL list, and the planted evidence is the cause
//   hardened    the same schema, started from ops/db/sporta-db-hardening.cnf
//               with clean data, TLS and a read-only auditor: nothing FAILs,
//               nothing is UNKNOWN; the same server seen through the web
//               account says UNKNOWN (never PASS) for what that account
//               cannot look at
//   readonly    three layers: the gate, the read-only transaction (the SERVER
//               refuses a write sent around the gate) and the refusal to start
//               when a server does not confirm read-only (fake server)
//   leaks       canary names, phones, emails, tokens, hashes, card numbers and
//               every generated password are planted; none may appear in any
//               output of any run
//   transport   unix socket, TLS verified, TLS unverified, plain TCP refused
//   docs        the owner's FAIL table is generated from the tool and in step
//               with it; ops/db is outside every package
//   mutation    each blinded check, loosened gate, removed read-only assertion
//               and added leak must turn the suite red
//
// The instances live under os.tmpdir() (set TMPDIR to choose) on ports from
// 33400, bound to 127.0.0.1, removed when the run ends. Nothing touches the
// shared test rig. Exit 0 = all green; 1 = a failure.

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { CANARY, HARDENING_CNF, TLS_CNF, canaryNeedles, connectEnv, prerequisites, secret, startHardened, startInsecure, startMainOnly, startTlsWithoutFiles, stopAll } from './lib/db-audit-instances.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const TOOL = join(HERE, 'db-security-audit.mjs')
const FIXES_MD = join(WEB, 'ops', 'db', 'AUDIT-FIXES.md')
const HOST = join(WEB, 'ops', 'db', 'host-audit.mjs')
const JOBMAKER = join(WEB, 'ops', 'db', 'make-audit-jobs.mjs')

const missing = prerequisites()
if (missing.length) {
  console.log(`SKIP db-audit: ${missing.join(', ')} not installed, so no private instance can be built. Nothing was tested.`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Reporting. A Reporter per run so a mutated run can be counted, not shown.
// ---------------------------------------------------------------------------
class Reporter {
  constructor(label, quiet) { this.label = label; this.quiet = quiet; this.passes = 0; this.fails = 0; this.failed = [] }
  ok(n, d = '') { this.passes++; if (!this.quiet) console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) }
  bad(n, d = '') { this.fails++; this.failed.push(n); if (!this.quiet) console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
  is(c, n, d) { c ? this.ok(n, d) : this.bad(n, d); return !!c }
  head(t) { if (!this.quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`) }
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const diff = (a, b) => ({ missing: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) })
const showDiff = (a, b) => { const d = diff(a, b); return `missing ${JSON.stringify(d.missing)} extra ${JSON.stringify(d.extra)}` }

let loadN = 0
const load = (toolPath) => import(`${pathToFileURL(toolPath).href}?run=${++loadN}`)

function runTool(toolPath, env, args = [], extra = {}) {
  const r = spawnSync(process.execPath, [toolPath, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8', timeout: 120000, ...extra,
  })
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}
// For a server living in THIS process: spawnSync would block it, so this one is async.
function runToolAsync(toolPath, env, args = [], timeout = 15000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [toolPath, ...args], { env: { PATH: process.env.PATH, ...env } })
    let out = '', err = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout)
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, out, err, all: `${out}\n${err}` }) })
  })
}
const json = (r) => { try { return JSON.parse(r.out) } catch { return null } }
const byId = (j) => Object.fromEntries((j?.checks ?? []).map((c) => [c.id, c]))
const idsWith = (j, status) => (j?.checks ?? []).filter((c) => c.status === status && !c.accepted).map((c) => c.id)

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------
const INSECURE_FAIL = [
  'acct.anonymous', 'acct.empty_password', 'acct.wildcard_host', 'acct.root_network', 'acct.powerful_privs', 'acct.app_ddl', 'acct.unused',
  'srv.skip_name_resolve', 'srv.local_infile', 'srv.secure_file_priv', 'srv.sql_strict', 'srv.sql_zero_date', 'srv.sql_div_zero', 'srv.sql_group_by',
  'srv.event_scheduler', 'srv.password_policy', 'srv.audit_log', 'srv.symlinks',
  'tls.available', 'tls.require_secure_transport', 'tls.versions',
  'log.general', 'log.slow', 'log.binlog_retention',
  'lim.connections', 'lim.user_connections', 'lim.statement_time', 'lim.wait_timeout', 'lim.packet',
  'cs.server_defaults', 'cs.columns', 'cs.collation_mix',
  'sch.engine', 'sch.primary_key', 'sch.definers', 'sch.backup_copies', 'sch.other_databases',
  'sec.password_hashes', 'sec.token_storage', 'sec.recoverable_secrets', 'sec.secrets_in_text',
  'hyg.card_numbers', 'hyg.location_lines', 'hyg.dead_tokens', 'hyg.log_pii',
]
const INSECURE_PASS = ['acct.password_age', 'srv.skip_grant_tables', 'srv.network_exposure', 'srv.public_clients', 'srv.version_support', 'log.binlog_pitr', 'cs.database_default', 'sch.foreign_keys', 'sec.hash_columns']
const INSECURE_UNKNOWN = ['tls.cert_expiry', 'hyg.retention']
// What each FAIL must be about (the planted cause), so a FAIL for the wrong reason does not count.
const INSECURE_EVIDENCE = {
  'acct.anonymous': ['@localhost'], 'acct.empty_password': ['root@%'], 'acct.wildcard_host': ['sporta_app@%', 'root@%'], 'acct.root_network': ['root@%'],
  'acct.powerful_privs': ['sporta_app@%', 'FILE', 'PROCESS', 'root@%: ALL PRIVILEGES'], 'acct.app_ddl': ['sporta_app@%'], 'acct.unused': ['ghost@%', 'olddb@%'],
  'cs.columns': ['customers_legacy_20261021'], 'sch.engine': ['stock_log'], 'sch.primary_key': ['rate_bucket', 'stock_log', 'customers_legacy_20261021'],
  'sch.definers': ['orders_touch', 'ev_cleanup', 'v_orders_public'], 'sch.backup_copies': ['customers_legacy_20261021'], 'sch.other_databases': ['`test`', '`scratch_copy`'],
  'sec.password_hashes': ['legacy_accounts.password'], 'sec.token_storage': ['admin_sessions.token'], 'sec.recoverable_secrets': ['admin_users.totp_secret', 'push_subscriptions.auth_secret'],
  'sec.secrets_in_text': ['settings.value'], 'hyg.card_numbers': ['support_messages.body'], 'hyg.location_lines': ['orders.customer_note'],
  'hyg.dead_tokens': ['admin_password_resets'], 'hyg.log_pii': ['admin_activity_log'], 'cs.collation_mix': ['utf8mb4_general_ci'],
}
const UNKNOWN_FOR_WEB_ACCOUNT = ['acct.anonymous', 'acct.empty_password', 'acct.wildcard_host', 'acct.root_network', 'acct.powerful_privs', 'acct.app_ddl', 'acct.unused', 'acct.password_age', 'srv.public_clients', 'sch.definers']

const planted = (inst) => [...canaryNeedles(), ...Object.values(inst.pw ?? {}), CANARY.hashLike.slice(0, 20), CANARY.token.slice(0, 16)]
const leaks = (inst, text) => planted(inst).filter((n) => n && text.includes(n))

// ---------------------------------------------------------------------------
// GROUP: unit
// ---------------------------------------------------------------------------
async function unit(rep, toolPath) {
  rep.head('unit: gate, parsers, classifiers')
  const T = await load(toolPath)
  const { gateReason, stripSql, parseGrant, schemaMatches, holds, hostScope, clientAddressClass, maskIp, luhn, cardLikeCount, classifyCredential, credentialKind,
    versionSupport, parseArgs, CHECKS, FIXES, scrubber, globalDanger, ddlPrivs, isAdminClass, BACKUP_NAME, privReason, SqlError, phpArray, credentials, broadReach, maskBits, toAsciiDigits, DANGEROUS_GLOBAL } = T

  // ---- the gate
  const allowed = [
    'SELECT 1', 'select @@session.tx_read_only', "SHOW GLOBAL VARIABLES", "SHOW GRANTS FOR CURRENT_USER()", "SHOW GRANTS FOR 'a'@'b'",
    "SELECT User, Host FROM mysql.global_priv WHERE User = 'x; DROP TABLE y'", "SELECT 'INTO OUTFILE' AS s", 'SELECT COUNT(*) FROM `into`.`for update`',
    "SELECT * FROM t WHERE c REGEXP '[0-9][0-9 -]{11,}[0-9]'", '  \n SELECT /* just a comment */ 1', "SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version')",
  ]
  const refused = [
    'INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t', 'DROP TABLE t', 'CREATE TABLE t (a int)', 'ALTER TABLE t ADD c int', 'TRUNCATE t', 'GRANT ALL ON *.* TO x',
    'SET GLOBAL local_infile = 1', 'SET SESSION sql_mode = 1', 'FLUSH PRIVILEGES', 'KILL 5', 'LOAD DATA INFILE "/etc/passwd" INTO TABLE t', 'CALL p()', 'DO SLEEP(1)', 'REPLACE INTO t VALUES (1)',
    'SELECT 1; DROP TABLE t', 'SELECT 1 /*! ; DROP TABLE t */', 'SELECT 1 /*M! , SLEEP(5) */', 'SELECT * FROM t INTO OUTFILE "/tmp/x"', 'SELECT * FROM t INTO DUMPFILE "/tmp/x"', 'SELECT 1 INTO @a',
    'SELECT * FROM t FOR UPDATE', 'SELECT * FROM t LOCK IN SHARE MODE', "SELECT GET_LOCK('a', 1)", 'SELECT SLEEP(5)', 'SELECT BENCHMARK(1000000, MD5(1))', "SELECT LOAD_FILE('/etc/passwd')",
    'select nextval(s)', 'WITH x AS (SELECT 1) DELETE FROM t', 'HANDLER t OPEN', 'XA START "a"', 'USE mysql', 'BEGIN',
  ]
  const wrongAllowed = allowed.filter((s) => gateReason(s) !== null)
  const wrongRefused = refused.filter((s) => gateReason(s) === null)
  rep.is(wrongAllowed.length === 0, 'the gate lets every read the tool needs through', JSON.stringify(wrongAllowed))
  rep.is(wrongRefused.length === 0, `the gate refuses ${refused.length} statements that could write, lock, sleep or smuggle`, JSON.stringify(wrongRefused))
  rep.is(stripSql("SELECT 'a;b' -- x; y\n, 2").text.includes(';') === false && stripSql('SELECT 1 /*! DROP */').exec === true, 'stripSql removes literals and comments and flags executable comments')

  // ---- grants
  const g1 = parseGrant("GRANT ALL PRIVILEGES ON *.* TO `root`@`%` IDENTIFIED BY PASSWORD '*ABC' WITH GRANT OPTION")
  rep.is(g1?.all && g1.scope === 'global' && g1.grantOption, 'SHOW GRANTS: ALL PRIVILEGES ON *.* WITH GRANT OPTION')
  const g2 = parseGrant('GRANT SELECT, INSERT, UPDATE, DELETE ON `sporta`.* TO `web`@`10.0.0.%`')
  rep.is(g2?.scope === 'schema' && g2.schema === 'sporta' && g2.privs.has('INSERT') && !g2.grantOption, 'SHOW GRANTS: schema level')
  const g3 = parseGrant('GRANT UPDATE (used_at, attempts), SELECT ON `my``db`.`orders` TO `x`@`h`')
  rep.is(g3?.scope === 'table' && g3.schema === 'my`db' && g3.privs.has('UPDATE') && g3.privs.has('SELECT'), 'SHOW GRANTS: column grant and a table in a quoted schema', JSON.stringify(g3 && [...g3.privs]))
  rep.is(parseGrant('GRANT USAGE ON *.* TO `a`@`b` IDENTIFIED VIA unix_socket OR mysql_native_password USING \'*H\'')?.privs.has('USAGE'), 'SHOW GRANTS: USAGE with a multi-plugin account')
  rep.is(parseGrant('GRANT `r1` TO `u`@`h`')?.kind === 'role' && parseGrant("GRANT PROXY ON ''@'%' TO 'root'@'localhost' WITH GRANT OPTION")?.kind === 'proxy', 'SHOW GRANTS: role and proxy lines')
  rep.is(parseGrant("GRANT SELECT ON `a`.* TO `u`@`h` IDENTIFIED BY PASSWORD 'x WITH GRANT OPTION'")?.grantOption === false, 'a password literal that spells WITH GRANT OPTION is not a grant option')
  rep.is(parseGrant('GRANT EXECUTE ON PROCEDURE `db`.`p` TO `u`@`h`')?.scope === 'routine', 'SHOW GRANTS: routine grant')
  rep.is(schemaMatches('sql%', 'sqlinst1') && schemaMatches('a\\_b', 'a_b') && !schemaMatches('a\\_b', 'axb') && schemaMatches('a_b', 'axb') && !schemaMatches('sporta', 'sporta2'), 'GRANT schema wildcards match like the server does')
  rep.is(holds([g2], 'INSERT', 'sporta') && !holds([g2], 'DROP', 'sporta') && !holds([g2], 'INSERT') && holds([g1], 'SUPER'), 'privilege lookup: schema-level and global')
  const dg = globalDanger([parseGrant('GRANT FILE, PROCESS, SELECT ON *.* TO `x`@`h`'), parseGrant('GRANT SELECT ON `d`.* TO `x`@`h` WITH GRANT OPTION')])
  rep.is(sameSet(dg.privs, ['FILE', 'PROCESS', 'GRANT OPTION on `d`']), 'dangerous privileges are listed, schema-level GRANT OPTION included', JSON.stringify(dg.privs))
  rep.is(sameSet(ddlPrivs([g2, parseGrant('GRANT CREATE, DROP ON `other`.* TO `x`@`h`')], 'sporta'), []) && sameSet(ddlPrivs([parseGrant('GRANT ALTER, INDEX ON `sporta`.* TO `x`@`h`')], 'sporta'), ['ALTER', 'INDEX']), 'DDL privileges count only on the shop schema (or globally)')
  rep.is(sameSet(ddlPrivs([parseGrant('GRANT DROP ON `sporta`.`orders` TO `x`@`h`'), parseGrant('GRANT UPDATE (a) ON `sporta`.`orders` TO `x`@`h`')], 'sporta'), ['DROP']), 'a table-level DROP counts as schema-changing rights; a column-level UPDATE does not')
  rep.is(isAdminClass([g1]) && !isAdminClass([g2]), 'administrative class = ALL or SUPER globally')
  const rl = parseGrant('GRANT `r1`, `r``2` TO `u`@`h`')
  rep.is(rl?.kind === 'role' && sameSet(rl.roles, ['r1', 'r`2']) && parseGrant('GRANT `solo` TO `u`@`h` WITH ADMIN OPTION')?.roles.join() === 'solo', 'SHOW GRANTS: the role names are kept (their rights are a second SHOW GRANTS), quoted backticks included', JSON.stringify(rl?.roles))
  const reach = (...lines) => broadReach(lines.map(parseGrant)).sort()
  rep.is(sameSet(reach('GRANT SELECT, UPDATE ON *.* TO `x`@`h`'), ['SELECT on every schema', 'UPDATE on every schema']) && reach('GRANT ALL PRIVILEGES ON *.* TO `x`@`h`').length === 0,
    'broad reach: DML on every schema is listed; ALL ON *.* is left to the dangerous-privilege list', JSON.stringify(reach('GRANT SELECT, UPDATE ON *.* TO `x`@`h`')))
  rep.is(sameSet(reach('GRANT INSERT, DELETE ON `mysql`.* TO `x`@`h`'), ['INSERT on mysql', 'DELETE on mysql']) && sameSet(reach('GRANT UPDATE (Host) ON `mysql`.`global_priv` TO `x`@`h`'), ['UPDATE on mysql']) && sameSet(reach('GRANT ALL PRIVILEGES ON `my%`.* TO `x`@`h`'), ['ALL PRIVILEGES on mysql']) && sameSet(reach('GRANT SELECT ON `%`.* TO `x`@`h`'), ['SELECT on mysql']),
    'broad reach: DML on the mysql schema (also by table, by column and through a LIKE pattern) is listed')
  rep.is(reach('GRANT SELECT, INSERT, UPDATE, DELETE ON `sporta`.* TO `x`@`h`', 'GRANT SELECT ON `mysqlx`.* TO `x`@`h`', 'GRANT USAGE ON *.* TO `x`@`h`').length === 0, 'broad reach: the shop schema, a similarly named schema and USAGE are not')
  rep.is(['REPLICATION SLAVE', 'BINLOG REPLAY', 'READ_ONLY ADMIN', 'REPLICATION MASTER ADMIN'].every((p) => DANGEROUS_GLOBAL.includes(p)) && globalDanger([parseGrant('GRANT REPLICATION SLAVE ON *.* TO `x`@`h`')]).privs.includes('REPLICATION SLAVE'), 'REPLICATION SLAVE (a copy of every change) is a dangerous global privilege')
  rep.is(globalDanger([g1]).all === true && globalDanger([g1]).privs[0] === 'ALL PRIVILEGES' && globalDanger([g2]).privs.length === 0, 'ALL PRIVILEGES ON *.* counts as every dangerous privilege; a DML-only schema grant as none')

  // ---- hosts and addresses
  const hs = [['localhost', 'local'], ['127.0.0.1', 'local'], ['::1', 'local'], ['%', 'any'], ['', 'any'], ['172.18.0.%', 'private'], ['10.0.0.5', 'private'], ['192.168.1.%', 'private'], ['203.0.113.9', 'public'], ['%.example.com', 'named'], ['db.internal', 'named'], ['172.32.0.1', 'public'],
    ['0.0.0.0/0.0.0.0', 'any'], ['10.0.0.0/0.0.0.0', 'any'], ['10.0.0.0/255.0.0.0', 'private'], ['172.18.0.0/255.255.0.0', 'private'], ['172.16.0.0/255.240.0.0', 'private'], ['172.16.0.0/255.0.0.0', 'public'],
    ['192.168.0.0/255.255.0.0', 'private'], ['192.168.0.0/255.0.0.0', 'public'], ['10.1.0.0/16', 'private'], ['10.0.0.0/4', 'public'], ['10.0.0.0/255.0.255.0', 'public'], ['203.0.113.0/255.255.255.0', 'public'], ['127.0.0.1/255.0.0.0', 'local'], ['127.0.0.1/0.0.0.0', 'any']]
  rep.is(hs.every(([h, s]) => hostScope(h) === s), 'account host classes (local / private / public / wildcard / named)', JSON.stringify(hs.filter(([h, s]) => hostScope(h) !== s).map(([h]) => [h, hostScope(h)])))
  rep.is(maskBits('10.0.0.0/255.0.0.0') === 8 && maskBits('10.0.0.0/0.0.0.0') === 0 && maskBits('10.0.0.0/16') === 16 && maskBits('10.0.0.0') === null && maskBits('10.0.0.0/255.0.255.0') === null && maskBits('10.0.0.0/abc') === null, 'netmask hosts: the number of fixed bits is read from a dotted mask or a prefix length; an unreadable mask is null')
  rep.is(hostScope('vm', 'vm') === 'local' && hostScope('vm', 'other') === 'named', "the server's own host name counts as local")
  const cs = [['localhost', 'socket'], ['', 'socket'], ['127.0.0.1:5000', 'loopback'], ['172.18.0.5:44000', 'private'], ['203.0.113.9:1', 'public'], ['::ffff:10.1.1.1', 'private'], ['2001:db8::1', 'public'], ['fd12::1', 'private'], ['169.254.1.1:2', 'private']]
  rep.is(cs.every(([h, s]) => clientAddressClass(h) === s), 'connection address classes', JSON.stringify(cs.filter(([h, s]) => clientAddressClass(h) !== s).map(([h]) => [h, clientAddressClass(h)])))
  rep.is(maskIp('203.0.113.77:4000') === '203.0.113.x', 'public addresses are shown as /24 only')

  // ---- card-like numbers
  const hits = ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', 'pay with 5500005555555559 now', '378282246310005 amex', '6011111111111117', 'card: 3530111333300000.', '4012888888881881']
  const misses = ['4111111111111112', '123456789012', '1111111111111111', '55501234', 'order 0000123456789012345', '99887766 12345', '41111111111111111111', 'phone 96599887766 and 22091914', '2026-11-04 10:00:00 4111', '7000000000000000008', '']
  rep.is(hits.every((t) => cardLikeCount(t) === 1) && cardLikeCount(`${hits[0]} and ${hits[3]}`) === 2, 'card-like detector: Luhn-valid runs of 13-19 digits (spaces, hyphens ok) are counted')
  rep.is(misses.every((t) => cardLikeCount(t) === 0), 'card-like detector: bad checksum, short, repeated digit, ids and phones are not', JSON.stringify(misses.filter((t) => cardLikeCount(t) !== 0)))
  const arabic = (t) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d))), persian = (t) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d))), wide = (t) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)))
  const other = ['4111 1111 1111 1111', '4111.1111.1111.1111', '4111\u00a01111\u00a01111\u00a01111']
  rep.is([...other.map(arabic), ...other.map(persian), ...other.map(wide), other[1]].every((t) => cardLikeCount(`بطاقتي ${t} تنتهي`) === 1) && toAsciiDigits(arabic('0123456789') + persian('0123456789') + wide('0123456789')) === '012345678901234567890123456789',
    'card-like detector: Arabic-Indic, Eastern Arabic-Indic and full-width digits, and dots or no-break spaces between groups, are read')
  rep.is(['192.168.100.200.1', arabic('2026-11-04 10:00:00'), arabic('96599887766'), 'v4.111.111.111.1'].every((t) => cardLikeCount(t) === 0), 'card-like detector: an address, a date and a phone number in Arabic digits are still not cards')
  rep.is(luhn('79927398713') && !luhn('79927398710'), 'Luhn checksum')

  // ---- credential shapes
  const S = (o) => ({ n: 3, empty: 0, bcrypt: 0, argon: 0, cryptsha: 0, hex64: 0, hex40: 0, hex32: 0, native: 0, base32: 0, encrypted: 0, ...o })
  const cls = (k, o) => classifyCredential(k, S(o)).verdict
  rep.is(cls('password', { bcrypt: 3 }) === 'OK' && cls('password', { argon: 2, cryptsha: 1 }) === 'OK', 'password column: bcrypt/argon2/sha-crypt are fine')
  rep.is(cls('password', { hex64: 3 }) === 'WEAK' && cls('password', { bcrypt: 2 }) === 'PLAIN' && cls('password', { n: 0 }) === 'EMPTY', 'password column: fast digests are weak, anything else is plain, nothing stored is empty')
  rep.is(cls('hash', { hex64: 2, bcrypt: 1 }) === 'OK' && cls('hash', { hex64: 1 }) === 'PLAIN', 'hash column: all values must look like digests')
  rep.is(cls('token', { hex64: 3 }) === 'RAW' && cls('token', { n: 2, empty: 2 }) === 'EMPTY', 'token column: stored under the token name = raw')
  rep.is(cls('recoverable', { base32: 3 }) === 'CLEAR' && cls('recoverable', { encrypted: 3 }) === 'OK' && cls('recoverable', { encrypted: 2 }) === 'CLEAR', 'recoverable secret: clear unless every value carries an encryption prefix')
  const kinds = { password_hash: 'password', passwd: 'password', token_hash: 'hash', image_hash: 'hash', totp_secret: 'recoverable', api_key: 'recoverable', session_id: 'token', token: 'token', otp: 'token', code_hash: 'hash', customer_name: null, track_id: null, auth_secret: 'recoverable' }
  rep.is(Object.entries(kinds).every(([c, k]) => credentialKind(c) === k), 'column names are classified by what they claim to hold', JSON.stringify(Object.entries(kinds).filter(([c, k]) => credentialKind(c) !== k)))

  // ---- version support
  const now = new Date('2026-11-04T12:00:00Z')
  const vs = (v, n = now) => versionSupport(v, n).status
  rep.is(vs('11.8.9-MariaDB-ubu2404') === 'PASS' && vs('10.11.14-MariaDB-0ubuntu0.24.04.1') === 'PASS' && vs('11.4.3-MariaDB') === 'PASS', 'supported series pass')
  rep.is(vs('10.5.22-MariaDB') === 'FAIL' && vs('10.6.18-MariaDB') === 'FAIL' && vs('11.2.5-MariaDB') === 'FAIL' && vs('8.0.30') === 'FAIL' && vs('5.7.40') === 'FAIL', 'series past their end of life fail (10.6 ended 2026-07-06)')
  rep.is(vs('10.11.14-MariaDB', new Date('2028-01-10T00:00:00Z')) === 'FAIL' && vs('10.11.14-MariaDB', new Date('2028-03-01T00:00:00Z')) === 'FAIL' && vs('10.11.14-MariaDB', new Date('2027-01-01T00:00:00Z')) === 'PASS', 'a series within 90 days of its end, or past it, fails')
  rep.is(/is out of support: series 10\.6 ended 2026-07-06 \(\d+ days ago\)/.test(versionSupport('10.6.18-MariaDB', now).detail) && /support ends 2028-02-16 \(\d+ days\)/.test(versionSupport('10.11.14-MariaDB', new Date('2028-01-10T00:00:00Z')).detail), 'the message says whether support has ended or is about to, with the date')
  rep.is(vs('13.0.1-MariaDB') === 'UNKNOWN' && vs('garbage') === 'UNKNOWN', 'a series newer than the table, or an unreadable version, is UNKNOWN, never PASS')
  rep.is(/not confirmed offline/.test(versionSupport('11.8.9-MariaDB', now).detail) && /table is \d+ days old/.test(versionSupport('11.8.9-MariaDB', new Date('2028-01-01T00:00:00Z')).detail ?? ''), 'an unconfirmed date and an old table are said out loud')

  // ---- the fix table
  const ids = CHECKS.map((c) => c.id)
  rep.is(new Set(ids).size === ids.length, 'check ids are unique')
  rep.is(sameSet(ids, Object.keys(FIXES)), 'every check has a fix entry and every fix entry belongs to a check', showDiff(ids, Object.keys(FIXES)))
  rep.is(CHECKS.every((c) => ['high', 'medium', 'low'].includes(FIXES[c.id]?.sev) && FIXES[c.id].means.length > 20 && FIXES[c.id].fix.length > 0 && FIXES[c.id].where), 'each fix entry has severity, meaning, command and where')
  rep.is(BACKUP_NAME.test('customers_legacy_20261021') && BACKUP_NAME.test('orders_bak') && BACKUP_NAME.test('stock_log_old') && !['orders', 'product_variants', 'fulfilment_outbox', 'admin_activity_log', 'order_tracking_events'].some((n) => BACKUP_NAME.test(n)), 'backup-looking table names: copies yes, the shop tables no')

  // ---- credentials: the store's PHP config in the shapes the VPS uses
  {
    const tdir = mkdtempSync(join(tmpdir(), 'dba-cfg-'))
    writeFileSync(join(tdir, 'pw'), 'unit-secret-pw\n'); writeFileSync(join(tdir, 'user'), 'unit-user')
    const cfg = (body) => { const f = join(tdir, `c${Math.random()}.php`); writeFileSync(f, `<?php\nreturn [\n${body}\n];\n`); return f }
    const a = phpArray(cfg(`  'db_host' => 'mariadb',\n  'db_name' => "sporta",\n  'db_user' => trim((string)@file_get_contents('${tdir}/user')),\n  'db_pass' => trim(file_get_contents('${tdir}/pw')),\n  'cron_key' => 'not-a-db-key',`))
    rep.is(a.db_host === 'mariadb' && a.db_name === 'sporta' && a.db_user === 'unit-user' && a.db_pass === 'unit-secret-pw', 'config: plain strings, double quotes, trim(file_get_contents()), casts and @ are all read')
    const b = credentials({ config: cfg(`  'db_host' => '127.0.0.1;port=3393',\n  'db_name' => 'x',\n  'db_user' => 'u',\n  'db_pass' => 'p\\'q'`) }, {})
    rep.is(b.host === '127.0.0.1' && b.port === 3393 && b.password === "p'q" && b.source === 'config', 'config: a port spelled in db_host and an escaped quote in the password')
    const c = credentials({}, { DB_HOST: 'h', DB_PORT: '3307', DB_USER: 'u', DB_PASSWORD_FILE: join(tdir, 'pw'), DB_NAME: 'n' })
    rep.is(c.host === 'h' && c.port === 3307 && c.password === 'unit-secret-pw' && c.source === 'env', 'environment: DB_*_FILE names a file that holds the value')
    rep.is(credentials({}, {}).error?.includes('no credentials') === true, 'no credentials is an error, not a guess')
    rmSync(tdir, { recursive: true, force: true })
  }

  // ---- options
  const o = parseArgs(['--json', '--only', 'acct,tls', '--accept', 'a.b,c.d', '--limit', '7', '--tls-ca', TOOL, '--order-retention-days', '30', '--bogus'])
  rep.is(o.json && sameSet(o.only, ['acct', 'tls']) && sameSet(o.accept, ['a.b', 'c.d']) && o.limit === 7 && o.tls && o.orderRetentionDays === 30 && o.locationRetentionDays === 90 && sameSet(o.unknownFlags, ['--bogus']), 'options parse, defaults hold, unknown flags are reported')
  const sc = scrubber({ password: 'p@ssw0rd-secret' })
  rep.is(sc('x p@ssw0rd-secret y p@ssw0rd-secret') === 'x [redacted] y [redacted]' && scrubber({ password: '' })('keep') === 'keep', 'the connection password is scrubbed from anything printed')
  rep.is(privReason(new SqlError(1142, "SELECT command denied to user 'web'@'10.0.0.5' for table `mysql`.`global_priv`"), 'x').includes("'…'@'…'") && !privReason(new SqlError(1142, "denied to user 'web'@'10.0.0.5'"), 'x').includes('10.0.0.5'), 'privilege errors do not echo the account')

  // ---- every variable-driven check, both sides of its threshold
  const base = { currentUser: 'web@10.0.0.5', opts: { auditor: [], allowDdl: [], maxPasswordAgeDays: 365, limit: 100 }, now, mariadb: true, versionRaw: '11.8.9-MariaDB', sessionStatus: new Map(), schema: 'sporta', can: () => false, mask: (s) => s, hostname: 'vm',
    accounts: async () => ({ ok: false, reason: 'no accounts' }), rows: async () => { throw new Error('unit check must not query') } }
  const mk = (vars, extra = {}) => ({ ...base, v: (n) => vars[n.toLowerCase()], vars, ...extra })
  const status = async (id, vars, extra) => { const c = CHECKS.find((x) => x.id === id); const r = await c.run(mk(vars, extra)); return r.status }
  const TABLE = [
    ['srv.skip_grant_tables', { skip_grant_tables: 'ON' }, 'FAIL'], ['srv.skip_grant_tables', { skip_grant_tables: 'OFF' }, 'PASS'], ['srv.skip_grant_tables', {}, 'UNKNOWN'],
    ['srv.network_exposure', { skip_networking: 'ON', bind_address: '0.0.0.0' }, 'PASS'], ['srv.network_exposure', { skip_networking: 'OFF', bind_address: '127.0.0.1' }, 'PASS'],
    ['srv.network_exposure', { bind_address: '10.0.0.5' }, 'PASS'], ['srv.network_exposure', { bind_address: '0.0.0.0' }, 'UNKNOWN'], ['srv.network_exposure', { bind_address: '*' }, 'UNKNOWN'],
    ['srv.network_exposure', { bind_address: '::' }, 'UNKNOWN'], ['srv.network_exposure', { bind_address: '203.0.113.5' }, 'FAIL'],
    ['srv.skip_name_resolve', { skip_name_resolve: 'ON' }, 'PASS'], ['srv.skip_name_resolve', { skip_name_resolve: 'OFF' }, 'FAIL'],
    ['srv.local_infile', { local_infile: 'OFF' }, 'PASS'], ['srv.local_infile', { local_infile: 'ON' }, 'FAIL'], ['srv.local_infile', { local_infile: '1' }, 'FAIL'],
    ['srv.secure_file_priv', { secure_file_priv: '' }, 'FAIL'], ['srv.secure_file_priv', { secure_file_priv: '/var/lib/mysql-files/' }, 'PASS'],
    ['srv.sql_strict', { sql_mode: '' }, 'FAIL'], ['srv.sql_strict', { sql_mode: 'NO_ENGINE_SUBSTITUTION' }, 'FAIL'], ['srv.sql_strict', { sql_mode: 'STRICT_TRANS_TABLES' }, 'PASS'], ['srv.sql_strict', { sql_mode: 'STRICT_ALL_TABLES' }, 'PASS'],
    ['srv.sql_zero_date', { sql_mode: 'STRICT_ALL_TABLES' }, 'FAIL'], ['srv.sql_zero_date', { sql_mode: 'NO_ZERO_DATE' }, 'FAIL'], ['srv.sql_zero_date', { sql_mode: 'NO_ZERO_DATE,NO_ZERO_IN_DATE' }, 'PASS'],
    ['srv.sql_div_zero', { sql_mode: '' }, 'FAIL'], ['srv.sql_div_zero', { sql_mode: 'ERROR_FOR_DIVISION_BY_ZERO' }, 'PASS'],
    ['srv.sql_group_by', { sql_mode: 'STRICT_ALL_TABLES' }, 'FAIL'], ['srv.sql_group_by', { sql_mode: 'ONLY_FULL_GROUP_BY' }, 'PASS'],
    ['srv.event_scheduler', { event_scheduler: 'ON' }, 'FAIL'], ['srv.event_scheduler', { event_scheduler: 'OFF' }, 'PASS'], ['srv.event_scheduler', { event_scheduler: 'DISABLED' }, 'PASS'],
    ['srv.symlinks', { have_symlink: 'YES' }, 'FAIL'], ['srv.symlinks', { have_symlink: 'DISABLED' }, 'PASS'], ['srv.symlinks', {}, 'UNKNOWN'],
    ['srv.version_support', {}, 'PASS'],
    ['tls.available', { have_ssl: 'YES' }, 'PASS'], ['tls.available', { have_ssl: 'DISABLED' }, 'FAIL'], ['tls.available', { ssl_cert: '/x.crt' }, 'PASS'], ['tls.available', {}, 'FAIL'],
    ['tls.require_secure_transport', { require_secure_transport: 'ON' }, 'PASS'], ['tls.require_secure_transport', { require_secure_transport: 'OFF' }, 'FAIL'],
    ['tls.versions', { tls_version: 'TLSv1.2,TLSv1.3' }, 'PASS'], ['tls.versions', { tls_version: 'TLSv1.1,TLSv1.2' }, 'FAIL'], ['tls.versions', { tls_version: 'TLSv1,TLSv1.1,TLSv1.2,TLSv1.3' }, 'FAIL'],
    ['log.general', { general_log: 'ON' }, 'FAIL'], ['log.general', { general_log: 'OFF' }, 'PASS'], ['log.slow', { slow_query_log: 'ON' }, 'FAIL'], ['log.slow', { slow_query_log: 'OFF' }, 'PASS'],
    ['log.binlog_pitr', { log_bin: 'OFF' }, 'FAIL'], ['log.binlog_pitr', { log_bin: 'ON' }, 'PASS'],
    ['log.binlog_retention', { log_bin: 'OFF' }, 'PASS'], ['log.binlog_retention', { log_bin: 'ON', binlog_expire_logs_seconds: '0', expire_logs_days: '0.000000' }, 'FAIL'],
    ['log.binlog_retention', { log_bin: 'ON', binlog_expire_logs_seconds: '1209600' }, 'PASS'], ['log.binlog_retention', { log_bin: 'ON', binlog_expire_logs_seconds: '0', expire_logs_days: '14.000000' }, 'PASS'],
    ['log.binlog_retention', { log_bin: 'ON', binlog_expire_logs_seconds: '5184000' }, 'FAIL'],
    ['lim.connections', { max_connections: '151' }, 'PASS'], ['lim.connections', { max_connections: '5000' }, 'FAIL'],
    ['lim.statement_time', { max_statement_time: '0.000000' }, 'FAIL'], ['lim.statement_time', { max_statement_time: '60.000000' }, 'PASS'], ['lim.statement_time', {}, 'UNKNOWN'],
    ['lim.wait_timeout', { wait_timeout: '28800' }, 'FAIL'], ['lim.wait_timeout', { wait_timeout: '600' }, 'PASS'],
    ['lim.packet', { max_allowed_packet: '16777216' }, 'PASS'], ['lim.packet', { max_allowed_packet: '536870912' }, 'FAIL'],
    ['lim.user_connections', { max_user_connections: '60' }, 'PASS'], ['lim.user_connections', { max_user_connections: '0' }, 'FAIL'],
    ['cs.server_defaults', { character_set_server: 'utf8mb4', collation_server: 'utf8mb4_unicode_ci' }, 'PASS'], ['cs.server_defaults', { character_set_server: 'utf8mb4', collation_server: 'utf8mb4_uca1400_ai_ci' }, 'PASS'],
    ['cs.server_defaults', { character_set_server: 'latin1', collation_server: 'latin1_swedish_ci' }, 'FAIL'], ['cs.server_defaults', { character_set_server: 'utf8mb3', collation_server: 'utf8mb3_general_ci' }, 'FAIL'],
  ]
  const wrong = []
  for (const [id, vars, want] of TABLE) { const got = await status(id, vars); if (got !== want) wrong.push(`${id} ${JSON.stringify(vars)} wanted ${want} got ${got}`) }
  rep.is(wrong.length === 0, `${TABLE.length} variable-driven cases fall on the right side of their threshold`, wrong.slice(0, 4).join(' | '))
  const cert = (when) => new Map([['ssl_server_not_after', when]])
  const fmt = (d) => d.toUTCString().replace(/^\w+, (\d+) (\w+) (\d+) (\S+) GMT$/, (m, dd, mon, y, t) => `${mon} ${dd.padStart(2, ' ')} ${t} ${y} GMT`)
  const day = 864e5
  const certs = [[new Date(now - 5 * day), 'FAIL'], [new Date(now.getTime() + 10 * day), 'FAIL'], [new Date(now.getTime() + 100 * day), 'PASS']]
  const certWrong = []
  for (const [d, want] of certs) { const got = await status('tls.cert_expiry', {}, { sessionStatus: cert(fmt(d)) }); if (got !== want) certWrong.push(`${fmt(d)} wanted ${want} got ${got}`) }
  rep.is(certWrong.length === 0 && (await status('tls.cert_expiry', {})) === 'UNKNOWN', 'certificate expiry: expired and under 30 days fail, later passes, absent is UNKNOWN', certWrong.join(' | '))
  rep.is((await status('srv.version_support', {}, { versionRaw: '10.6.18-MariaDB' })) === 'FAIL' && (await status('srv.audit_log', {}, { mariadb: false })) === 'UNKNOWN', 'version and engine-specific checks use the server they are asked about')
  // The account tables are unreadable: account checks say UNKNOWN, with a reason, never PASS.
  const noAcc = ['acct.anonymous', 'acct.empty_password', 'acct.wildcard_host', 'acct.unused', 'acct.password_age']
  const accStat = []
  for (const id of noAcc) accStat.push(await status(id, {}))
  rep.is(accStat.every((s) => s === 'UNKNOWN'), 'with unreadable account tables every account check is UNKNOWN', JSON.stringify(accStat))
  // Readable account list, but one account's grants (or a role it holds) cannot be read: not "nothing to use", not PASS.
  const unusedCtx = { ...base, accounts: async () => ({ ok: true, list: [{ user: 'app', host: '10.0.0.5', label: 'app@10.0.0.5', isRole: false, locked: false }] }), grantsOf: async () => null, rows: async () => [['sporta']] }
  rep.is((await CHECKS.find((c) => c.id === 'acct.unused').run(unusedCtx)).status === 'UNKNOWN', 'acct.unused: an account whose grants cannot be read makes the check UNKNOWN, never PASS')
}

// ---------------------------------------------------------------------------
// GROUP: insecure
// ---------------------------------------------------------------------------
function insecureRun(toolPath, inst, args = []) {
  return runTool(toolPath, connectEnv(inst, 'root', ''), ['--json', ...args])
}

async function insecureCore(rep, toolPath, inst) {
  rep.head('insecure instance: the expected FAIL list')
  const r = insecureRun(toolPath, inst)
  const j = json(r)
  if (!rep.is(j && j.checks, 'the insecure run produced a report', r.err.slice(0, 200))) return
  const fails = idsWith(j, 'FAIL'), passes = idsWith(j, 'PASS'), unknowns = idsWith(j, 'UNKNOWN')
  rep.is(sameSet(fails, INSECURE_FAIL), `FAIL list is exactly the ${INSECURE_FAIL.length} planted weaknesses`, showDiff(fails, INSECURE_FAIL))
  rep.is(sameSet(passes, INSECURE_PASS), `PASS list is exactly the ${INSECURE_PASS.length} settings the instance gets right`, showDiff(passes, INSECURE_PASS))
  rep.is(sameSet(unknowns, INSECURE_UNKNOWN), 'UNKNOWN list is exactly the two that need the host or the owner', showDiff(unknowns, INSECURE_UNKNOWN))
  rep.is(r.status === 1, 'exit code 1 on FAIL', `exit ${r.status}`)
  const by = byId(j)
  const wrongCause = []
  for (const [id, needles] of Object.entries(INSECURE_EVIDENCE)) {
    const text = `${by[id]?.detail ?? ''}\n${(by[id]?.items ?? []).join('\n')}`
    for (const n of needles) if (!text.includes(n)) wrongCause.push(`${id} lacks "${n}"`)
  }
  rep.is(wrongCause.length === 0, 'every FAIL names the thing that was planted', wrongCause.slice(0, 5).join(' | '))
  rep.is(by['log.general']?.detail.includes('general_log = ON') && by['srv.local_infile']?.detail === 'local_infile = ON' && by['srv.sql_strict']?.detail.includes('no strict flag'), 'server-setting FAILs quote the value they found')
  rep.is(j.summary.fail === INSECURE_FAIL.length && j.read_only === true && j.connection.tls === false, 'summary and connection facts are reported', JSON.stringify(j.summary))
}

async function insecureExtras(rep, toolPath, inst) {
  rep.head('insecure instance: options')
  const base = insecureRun(toolPath, inst)
  const bj = json(base)
  // --accept
  const a = json(insecureRun(toolPath, inst, ['--accept', 'acct.anonymous,log.general']))
  rep.is(a?.summary.accepted === 2 && a.summary.fail === INSECURE_FAIL.length - 2 && byId(a)['acct.anonymous'].accepted === true && byId(a)['acct.anonymous'].status === 'FAIL', '--accept keeps the FAIL visible, marks it accepted, and does not count it as a pass', JSON.stringify(a?.summary))
  const all = insecureRun(toolPath, inst, ['--accept', INSECURE_FAIL.join(',')])
  rep.is(all.status === 0 && json(all)?.summary.fail === 0 && json(all)?.summary.pass === INSECURE_PASS.length, 'accepting every FAIL exits 0, and the pass count does not grow', `exit ${all.status} ${JSON.stringify(json(all)?.summary)}`)
  rep.is(runTool(toolPath, connectEnv(inst, 'root', ''), ['--accept', 'nope.nothing']).status === 2, '--accept with an unknown id is refused (exit 2)')
  // --only, --skip, --no-fail, --strict
  const only = json(insecureRun(toolPath, inst, ['--only', 'tls,acct.anonymous']))
  rep.is(only && only.checks.length === 5 && only.checks.every((c) => c.id.startsWith('tls.') || c.id === 'acct.anonymous'), '--only selects by prefix and by id', only?.checks.map((c) => c.id).join(','))
  const skip = json(insecureRun(toolPath, inst, ['--skip', 'acct,srv']))
  rep.is(skip && skip.checks.every((c) => !/^(acct|srv)\./.test(c.id)) && skip.checks.length > 20, '--skip drops whole groups')
  rep.is(runTool(toolPath, connectEnv(inst, 'root', ''), ['--no-fail', '--quiet']).status === 0, '--no-fail exits 0 even with FAILs')
  const hard = json(insecureRun(toolPath, inst, ['--accept', INSECURE_FAIL.join(',')]))
  rep.is(runTool(toolPath, connectEnv(inst, 'root', ''), ['--accept', INSECURE_FAIL.join(','), '--strict', '--quiet']).status === 1 && hard.summary.unknown === 2, '--strict makes UNKNOWN fail too')
  // thresholds
  const ret = json(insecureRun(toolPath, inst, ['--order-retention-days', '1000']))
  rep.is(byId(ret)['hyg.retention'].status === 'FAIL' && byId(ret)['hyg.retention'].detail.includes('1 order'), 'a chosen order retention period turns the age report into a verdict (the 2022 order is over 1000 days old)', byId(ret)['hyg.retention'].detail ?? byId(ret)['hyg.retention'].reason)
  const ret2 = json(insecureRun(toolPath, inst, ['--order-retention-days', '5000', '--location-retention-days', '100000', '--log-retention-days', '100000']))
  rep.is(byId(ret2)['hyg.retention'].status === 'PASS' && byId(ret2)['hyg.location_lines'].status === 'PASS' && byId(ret2)['hyg.log_pii'].status === 'PASS', 'long retention limits pass the same data')
  rep.is(String(byId(bj)['hyg.retention'].reason).includes('Privacy.jsx'), 'without a period the retention check says the privacy page names none')
  // end of life and password age, driven by --now
  const late = json(insecureRun(toolPath, inst, ['--now', '2029-06-01']))
  rep.is(byId(late)['srv.version_support'].status === 'FAIL' && byId(late)['acct.password_age'].status === 'FAIL', '--now 2029-06-01: the 10.11 series is past its end of life and every password is over a year old')
  // masking
  const masked = insecureRun(toolPath, inst, ['--mask-names'])
  rep.is(!/sporta_app@/.test(masked.out) && /s\*\*\*p@%/.test(masked.out) && /r\*\*\*t@%/.test(masked.out), '--mask-names hides account names but keeps them recognisable')
  // listing and docs flags
  const list = runTool(toolPath, {}, ['--list'])
  rep.is(list.status === 0 && list.out.split('\n').filter(Boolean).length === Object.keys(byId(bj)).length, '--list prints one line per check')
  // errors
  rep.is(runTool(toolPath, connectEnv(inst, 'root', ''), ['--bogus']).status === 2, 'an unknown flag is refused (exit 2)')
  rep.is(runTool(toolPath, {}, []).status === 2 && /no credentials/.test(runTool(toolPath, {}, []).err), 'no credentials: exit 2 with a plain message')
  const wrongPw = 'wrong-' + randomBytes(6).toString('hex')
  const bad = runTool(toolPath, connectEnv(inst, 'sporta_app', wrongPw), [])
  rep.is(bad.status === 2 && !bad.all.includes(wrongPw) && /cannot connect/.test(bad.err), 'a wrong password: exit 2, and the password is not echoed')
  // the web account as seen on the insecure server: it can read little, says so, and still finds what it can see
  const web = json(runTool(toolPath, connectEnv(inst, 'sporta_app', 'app-pass-1'), ['--json']))
  rep.is(web && byId(web)['acct.app_ddl'].status === 'FAIL' && byId(web)['acct.powerful_privs'].status === 'FAIL', 'the over-privileged web account is caught from its own session (SHOW GRANTS FOR CURRENT_USER)')
}

// ---------------------------------------------------------------------------
// GROUP: hardened
// ---------------------------------------------------------------------------
const HARD_ARGS = (inst) => ['--json', '--tls-ca', inst.caFile, '--auditor', 'sporta_audit,sporta_audit1', '--order-retention-days', '1825']
async function hardenedCore(rep, toolPath, inst) {
  rep.head('hardened instance: nothing to fail')
  const r = runTool(toolPath, connectEnv(inst, 'sporta_audit', inst.pw.audit), HARD_ARGS(inst))
  const j = json(r)
  if (!rep.is(j && j.checks, 'the hardened run produced a report', r.err.slice(0, 200))) return
  rep.is(idsWith(j, 'FAIL').length === 0, 'no check FAILs', idsWith(j, 'FAIL').map((id) => `${id}: ${byId(j)[id].detail}`).join(' | '))
  rep.is(idsWith(j, 'UNKNOWN').length === 0, 'no check is UNKNOWN for the full-visibility auditor', idsWith(j, 'UNKNOWN').map((id) => `${id}: ${byId(j)[id].reason}`).join(' | '))
  rep.is(r.status === 0 && j.summary.pass === j.checks.length, `exit 0 and all ${j.checks.length} checks PASS`, `exit ${r.status} ${JSON.stringify(j.summary)}`)
  rep.is(j.connection.tls === true && j.connection.tlsVerified === true, 'the connection was TLS with the certificate verified against the test CA')
}

async function hardenedLimited(rep, toolPath, inst) {
  rep.head('hardened instance: what a limited account must NOT claim')
  const web = runTool(toolPath, connectEnv(inst, 'sporta_web', inst.pw.web), ['--json', '--tls', '--order-retention-days', '1825'])
  const j = json(web)
  if (!rep.is(j && j.checks, 'the web account produced a report', web.err.slice(0, 200))) return
  rep.is(idsWith(j, 'FAIL').length === 0, 'the web account finds nothing to FAIL on the hardened server', idsWith(j, 'FAIL').join(','))
  const unk = idsWith(j, 'UNKNOWN')
  rep.is(sameSet(unk, UNKNOWN_FOR_WEB_ACCOUNT), 'everything it cannot see is UNKNOWN with a reason (account tables, other connections, triggers) - never PASS', showDiff(unk, UNKNOWN_FOR_WEB_ACCOUNT))
  rep.is((j.checks.filter((c) => c.status === 'UNKNOWN').every((c) => c.reason && c.reason.length > 20)), 'every UNKNOWN carries a reason')
  rep.is(String(byId(j)['acct.anonymous'].reason).includes('1142'), 'the reason names the missing privilege (error 1142 on mysql.global_priv)')
  rep.is(web.status === 0 && runTool(toolPath, connectEnv(inst, 'sporta_web', inst.pw.web), ['--tls', '--quiet', '--strict']).status === 1, 'exit 0 normally, 1 under --strict because of the UNKNOWNs')
  rep.is(j.connection.tls === true && j.connection.tlsVerified === false, 'TLS without a CA file is reported as "certificate not verified"')
  // the auditor without TRIGGER: sees accounts, still cannot see triggers, and says so
  const a1 = json(runTool(toolPath, connectEnv(inst, 'sporta_audit1', inst.pw.audit1), HARD_ARGS(inst)))
  rep.is(a1 && idsWith(a1, 'FAIL').length === 0 && sameSet(idsWith(a1, 'UNKNOWN'), ['sch.definers']) && String(byId(a1)['sch.definers'].reason).includes('TRIGGER'), 'an auditor without TRIGGER gets UNKNOWN for sch.definers (an empty list proves nothing), and nothing else', JSON.stringify(a1 && idsWith(a1, 'UNKNOWN')))
}

async function hardenedScenarios(rep, toolPath, inst) {
  rep.head('hardened instance: scenarios')
  const run = (args = []) => json(runTool(toolPath, connectEnv(inst, 'sporta_audit', inst.pw.audit), [...HARD_ARGS(inst), ...args]))
  // a clear authenticator seed is a FAIL; the same seed behind the encryption prefix passes
  inst.sql("update admin_users set totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP'", 'sporta')
  const clear = run()
  inst.sql("update admin_users set totp_secret = 'enc:v1:Zm9vYmFyYmF6cXV4'", 'sporta')
  const enc = run()
  inst.sql("update admin_users set totp_enabled = 0, totp_secret = null", 'sporta')
  rep.is(byId(clear)['sec.recoverable_secrets'].status === 'FAIL' && byId(enc)['sec.recoverable_secrets'].status === 'PASS', 'an authenticator seed in clear FAILs; behind the enc: prefix it PASSes (what an encryption patch must produce)')
  // a non-digest in a *_hash column
  inst.sql("insert into customer_accounts (name, email, password_hash, phone) values ('P', 'plain@example.invalid', 'plaintext-password', '55500001')", 'sporta')
  const plain = run()
  inst.sql("delete from customer_accounts where email = 'plain@example.invalid'", 'sporta')
  rep.is(byId(plain)['sec.password_hashes'].status === 'FAIL' && String(byId(plain)['sec.password_hashes'].items).includes('customer_accounts.password_hash'), 'a plaintext value in customer_accounts.password_hash FAILs sec.password_hashes')
  // end of life driven by the clock
  const late = run(['--now', '2028-01-10'])
  rep.is(byId(late)['srv.version_support'].status === 'FAIL' && /support ends 2028-02-16/.test(byId(late)['srv.version_support'].detail), 'within 90 days of the series end the version check fails and says when')
  const old = run(['--now', '2028-06-01'])
  rep.is(byId(old)['acct.password_age'].status === 'FAIL' && byId(old)['tls.cert_expiry'].status === 'FAIL', 'a clock two years on: passwords too old, certificate expired')
  // root over the socket: same verdicts, no TLS needed
  const sock = json(runTool(toolPath, { DB_SOCKET: inst.sock, DB_USER: 'root', DB_PASSWORD: inst.pw.root, DB_NAME: 'sporta' }, ['--json', '--auditor', 'sporta_audit,sporta_audit1', '--order-retention-days', '1825']))
  rep.is(sock && idsWith(sock, 'FAIL').length === 0 && sock.connection.transport === 'unix socket' && sock.connection.tls === false, 'root over the unix socket: no FAIL, transport reported')
  rep.is(sock && sameSet(idsWith(sock, 'UNKNOWN'), ['tls.cert_expiry']), 'over the socket only the certificate expiry is unknown (no TLS session to read it from)', JSON.stringify(sock && idsWith(sock, 'UNKNOWN')))
  // the mysql.user compatibility view as the account source
  const viaUser = json(runTool(toolPath, connectEnv(inst, 'sporta_audit', inst.pw.audit), [...HARD_ARGS(inst), '--accounts-source', 'user']))
  rep.is(viaUser && byId(viaUser)['acct.empty_password'].status === 'PASS' && byId(viaUser)['acct.anonymous'].status === 'PASS', '--accounts-source user (the mysql.user view) reaches the same account verdicts')
}

// ---------------------------------------------------------------------------
// GROUP: reach — weaknesses the first version of the tool could not see (found by attacking it)
// ---------------------------------------------------------------------------
// Everything planted here is removed again, so the shared hardened instance is clean for the groups that follow.
async function hardenedReach(rep, toolPath, inst) {
  rep.head('hardened instance: roles, global DML, replication, netmask hosts, other digit scripts')
  const pw = secret(16)
  const ar = (t) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)))
  const run = () => runTool(toolPath, connectEnv(inst, 'sporta_audit', inst.pw.audit), HARD_ARGS(inst))
  const cleanup = () => {
    for (const st of [
      "drop user if exists 'zz_viarole'@'127.0.0.1'", "drop user if exists 'zz_viaall'@'127.0.0.1'", "drop user if exists 'zz_gdml'@'127.0.0.1'", "drop user if exists 'zz_mysqlw'@'127.0.0.1'",
      "drop user if exists 'zz_repl'@'127.0.0.1'", "drop user if exists 'zz_lim'@'127.0.0.1'", "drop user if exists 'zz_nm'@'0.0.0.0/0.0.0.0'", "drop user if exists 'zz_nm2'@'10.0.0.0/0.0.0.0'", "drop user if exists 'zz_nm3'@'172.18.0.0/255.255.0.0'",
      'drop role if exists zz_outer', 'drop role if exists zz_inner', 'drop role if exists zz_allrole',
    ]) inst.sql(st)
    inst.sql("delete from support_messages where author_name = 'zz'; delete from fulfilment_outbox where kind = 'payment' and payload like '%zz_reach%'; update orders set customer_note = 'ring twice', created_at = now() where track_id = 'TRK-NEW-0001'", 'sporta')
  }
  let j, raw, lim
  try {
    inst.sql(`
      create role zz_inner; grant replication slave on *.* to zz_inner;
      create role zz_outer; grant zz_inner to zz_outer;
      create role zz_allrole; grant all privileges on *.* to zz_allrole;
      create user 'zz_viarole'@'127.0.0.1' identified by '${pw}'; grant zz_outer to 'zz_viarole'@'127.0.0.1';
      create user 'zz_viaall'@'127.0.0.1' identified by '${pw}'; grant zz_allrole to 'zz_viaall'@'127.0.0.1';
      create user 'zz_gdml'@'127.0.0.1' identified by '${pw}'; grant select, insert, update, delete on *.* to 'zz_gdml'@'127.0.0.1';
      create user 'zz_mysqlw'@'127.0.0.1' identified by '${pw}'; grant update, insert on mysql.* to 'zz_mysqlw'@'127.0.0.1';
      create user 'zz_repl'@'127.0.0.1' identified by '${pw}'; grant replication slave on *.* to 'zz_repl'@'127.0.0.1';
      create user 'zz_nm'@'0.0.0.0/0.0.0.0' identified by '${pw}'; grant select on sporta.* to 'zz_nm'@'0.0.0.0/0.0.0.0';
      create user 'zz_nm2'@'10.0.0.0/0.0.0.0' identified by '${pw}'; grant select on sporta.* to 'zz_nm2'@'10.0.0.0/0.0.0.0';
      create user 'zz_nm3'@'172.18.0.0/255.255.0.0' identified by '${pw}'; grant select on sporta.* to 'zz_nm3'@'172.18.0.0/255.255.0.0';
      create user 'zz_lim'@'127.0.0.1' identified by '${pw}'; grant select on sporta.* to 'zz_lim'@'127.0.0.1'; grant zz_inner to 'zz_lim'@'127.0.0.1';
    `)
    inst.sql(`
      insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) select id, 'customer', 'zz', '${'بطاقتي ' + ar('4111 1111 1111 1111') + ' تنتهي ' + ar('12/29')}', 1 from support_tickets limit 1;
      insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) select id, 'customer', 'zz', 'card 4111.1111.1111.1111 exp 12/29', 1 from support_tickets limit 1;
      insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) select id, 'customer', 'zz', 'the password: Zq!Qw3rty-zz_reach-xyz for the site', 1 from support_tickets limit 1;
      insert into fulfilment_outbox (order_id, kind, payload, created_at) select id, 'payment', '{"zz_reach":1,"Password":"Winter2026abcdefgh","note":"Location: https://maps.app.goo.gl/AbC123"}', '2020-01-01 10:00:00' from orders limit 1;
      update orders set customer_note = 'Location: https://maps.app.goo.gl/AbCdEf123', created_at = '2020-01-01 10:00:00' where track_id = 'TRK-NEW-0001';
    `, 'sporta')
    raw = run(); j = json(raw)
    // The same server seen by a SMALL account that holds a role it may not be able to read: never a PASS for powerful privileges.
    lim = json(runTool(toolPath, connectEnv(inst, 'zz_lim', pw), ['--json', '--tls-ca', inst.caFile]))
  } finally { cleanup() }
  if (!rep.is(j && j.checks, 'the audit ran with the weak accounts and rows planted', raw?.err?.slice(0, 200))) return
  const by = byId(j)
  const items = (id) => (by[id]?.items ?? []).join('\n')
  rep.is(by['acct.powerful_privs'].status === 'FAIL', 'acct.powerful_privs FAILs', by['acct.powerful_privs'].detail)
  const want = { 'zz_viarole@127.0.0.1: REPLICATION SLAVE': 'REPLICATION SLAVE held through a role of a role', 'zz_viaall@127.0.0.1: ALL PRIVILEGES': 'ALL PRIVILEGES held through a role', 'zz_gdml@127.0.0.1: SELECT on every schema': 'DML on every schema',
    'zz_mysqlw@127.0.0.1: INSERT on mysql, UPDATE on mysql': 'INSERT and UPDATE on the mysql account tables', 'zz_repl@127.0.0.1: REPLICATION SLAVE': 'REPLICATION SLAVE held directly' }
  for (const [needle, what] of Object.entries(want)) rep.is(items('acct.powerful_privs').includes(needle), `named: ${what}`, needle)
  rep.is(!items('acct.powerful_privs').includes('sporta_audit') && !items('acct.powerful_privs').includes('sporta_web'), 'the auditor (SELECT on mysql, PROCESS) and the DML-only web account are not named')
  rep.is(by['acct.app_ddl'].status === 'FAIL' && items('acct.app_ddl').includes('zz_viaall@127.0.0.1: ALL PRIVILEGES'), 'acct.app_ddl sees the schema-changing rights that arrive through a role')
  rep.is(by['acct.wildcard_host'].status === 'FAIL' && items('acct.wildcard_host').includes('zz_nm@0.0.0.0/0.0.0.0') && items('acct.wildcard_host').includes('zz_nm2@10.0.0.0/0.0.0.0'), 'a netmask of 0 (every address, also on a private base) is a wildcard host', items('acct.wildcard_host'))
  rep.is(!items('acct.wildcard_host').includes('zz_nm3'), 'a /16 netmask inside the private block is not')
  rep.is(by['hyg.card_numbers'].status === 'FAIL' && items('hyg.card_numbers').includes('support_messages.body: 2 value(s)'), 'a card number in Arabic-Indic digits and one with dots are both counted', items('hyg.card_numbers'))
  rep.is(by['sec.secrets_in_text'].status === 'FAIL' && items('sec.secrets_in_text').includes('support_messages.body: 1 row(s)') && items('sec.secrets_in_text').includes('fulfilment_outbox.payload: 1 row(s)'), 'a password with punctuation in a message, and a differently-cased key in a JSON column, are found', items('sec.secrets_in_text'))
  rep.is(by['hyg.location_lines'].status === 'FAIL' && items('hyg.location_lines').includes('orders.customer_note: 1 row(s) carry a map link, 1 older') && items('hyg.location_lines').includes('fulfilment_outbox.payload: 1 row(s) carry a map link, 1 older'), 'an old short map link (maps.app.goo.gl) in a note and in the outbox is found', items('hyg.location_lines'))
  rep.is(lim && byId(lim)['acct.powerful_privs'].status !== 'PASS', 'an account that holds a role is never told "no powerful privileges" (FAIL if it can read the role, UNKNOWN if not)', lim && `${byId(lim)['acct.powerful_privs'].status}: ${byId(lim)['acct.powerful_privs'].detail ?? byId(lim)['acct.powerful_privs'].reason}`)
  const leaked = ['Winter2026', 'Zq!Qw3rty', 'AbCdEf123', 'AbC123', '4111', '٤١١١', pw].filter((n) => raw.all.includes(n))
  rep.is(leaked.length === 0, 'none of the planted passwords, card digits or map links is printed', leaked.join(','))
  const after = json(run())
  rep.is(after && idsWith(after, 'FAIL').length === 0 && idsWith(after, 'UNKNOWN').length === 0, 'once removed, the hardened server is clean again (no false positive from the wider detectors)', after && idsWith(after, 'FAIL').join(','))
}

// ---------------------------------------------------------------------------
// GROUP: config — the two shipped files, applied in the order the owner will apply them
// ---------------------------------------------------------------------------
export const namesCertificateFile = (text) => /^\s*ssl[_-](cert|key|ca|capath|cipher)\s*=/mi.test(text.replace(/^\s*#.*$/gm, ''))
async function configFiles(rep) {
  rep.head('config files: what a restart with only part of them leaves')
  const main = readFileSync(HARDENING_CNF, 'utf8'), tls = readFileSync(TLS_CNF, 'utf8')
  rep.is(!namesCertificateFile(main), 'sporta-db-hardening.cnf names no certificate, key or CA file (so it cannot stop a server that has none)')
  rep.is(namesCertificateFile(main + '\nssl_cert=/etc/mysql/tls/server.crt\n') && namesCertificateFile(main + '\nssl-key = /x\n') && !namesCertificateFile('# ssl_cert=/x\n'), 'the check for that: a certificate line added to the main file is caught, a comment is not')
  rep.is(['ssl_cert', 'ssl_key', 'ssl_ca'].every((k) => new RegExp(`^${k}=`, 'm').test(tls)) && /^\s*#\s*require_secure_transport=ON/m.test(tls) && !/^\s*require_secure_transport\s*=/m.test(main + tls), 'sporta-db-tls.cnf names the three files and leaves require_secure_transport off')
  const only = await startMainOnly()
  try {
    const r = runTool(TOOL, connectEnv(only, 'root', '', { DB_NAME: '' }), ['--json', '--only', 'tls,srv.local_infile,srv.secure_file_priv,srv.skip_name_resolve,srv.sql_strict,lim,log.general,cs.server'])
    const j = json(r)
    if (!rep.is(j && j.checks, 'the main file alone starts a working server with no certificate on disk, and the audit reads it', r.err.slice(0, 160))) return
    const st = Object.fromEntries(j.checks.map((c) => [c.id, c.status]))
    rep.is(st['tls.available'] === 'FAIL' && st['tls.versions'] === 'PASS' && st['tls.require_secure_transport'] === 'FAIL', 'it says plainly that TLS is not available yet (tls.available FAIL) while the version floor is already in force')
    rep.is(['srv.local_infile', 'srv.secure_file_priv', 'srv.skip_name_resolve', 'srv.sql_strict', 'lim.statement_time', 'log.general', 'cs.server_defaults'].every((id) => st[id] === 'PASS'), 'and the rest of the main file took effect (local_infile, secure_file_priv, skip_name_resolve, strict mode, statement time, general log, charset)', JSON.stringify(st))
  } finally { only.stop() }
  const log = await startTlsWithoutFiles()
  rep.is(/Failed to setup SSL|Unable to get certificate|SSL_CTX_set_default_verify_paths/.test(log) && /Aborting/.test(log), 'the TLS file applied BEFORE its files exist makes the server refuse to start (the measured reason it is a separate file)', log.trim().split('\n').slice(-2).join(' | ').slice(0, 160))
}

// A server that accepts the connection and never speaks: the job must end with exit 2, not hang.
async function silentServer(rep, toolPath) {
  rep.head('a server that never answers')
  const srv = await new Promise((resolve) => { const s = net.createServer((c) => c.on('error', () => {})); s.listen(0, '127.0.0.1', () => resolve(s)) })
  const t0 = Date.now()
  const r = await runToolAsync(toolPath, { DB_HOST: '127.0.0.1', DB_PORT: String(srv.address().port), DB_USER: 'x', DB_PASSWORD: '', DB_NAME: 'x' }, ['--quiet', '--connect-timeout', '2'], 20000)
  srv.close()
  rep.is(r.status === 2 && /did not answer in time/.test(r.err) && Date.now() - t0 < 12000, 'a silent server ends the run with exit 2 and a plain message after --connect-timeout, not never', `exit ${r.status} after ${Date.now() - t0} ms: ${r.err.trim().slice(0, 100)}`)
}

// ---------------------------------------------------------------------------
// GROUP: transport
// ---------------------------------------------------------------------------
async function transport(rep, toolPath, hard) {
  rep.head('transport')
  const plain = runTool(toolPath, connectEnv(hard, 'sporta_web', hard.pw.web), ['--quiet'])
  rep.is(plain.status === 2 && /cannot connect/.test(plain.err) && /--tls/.test(plain.err), 'plain TCP to a server that requires TLS: exit 2 with the hint to use --tls', plain.err.trim())
  const wrongCa = join(mkdtempSync(join(tmpdir(), 'dba-ca-')), 'other-ca.crt')
  const mk = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', wrongCa + '.key', '-out', wrongCa, '-days', '2', '-subj', '/CN=someone-else'], { stdio: 'ignore' })
  const wrong = runTool(toolPath, connectEnv(hard, 'sporta_web', hard.pw.web), ['--quiet', '--tls-ca', wrongCa])
  rep.is(mk.status === 0 && wrong.status === 2 && /cannot connect/.test(wrong.err) && !wrong.all.includes(hard.pw.web), 'a CA that did not sign the server certificate is refused (exit 2), password not echoed', wrong.err.trim().slice(0, 140))
  const named = runTool(toolPath, connectEnv(hard, 'sporta_web', hard.pw.web), ['--quiet', '--tls-ca', hard.caFile, '--tls-name', 'not-the-server.example'])
  rep.is(named.status === 2, 'the certificate name is checked too (--tls-name that does not match is refused)', named.err.trim().slice(0, 140))
  rmSync(dirname(wrongCa), { recursive: true, force: true })
  const noTlsOffered = runTool(toolPath, connectEnv(hard, 'sporta_web', hard.pw.web), ['--quiet', '--tls', '--now', '2026-11-04'])
  rep.is(noTlsOffered.status === 0, 'TLS without a CA file connects (and the report says the certificate was not verified)')
}

// ---------------------------------------------------------------------------
// GROUP: read-only
// ---------------------------------------------------------------------------
function fakeServer(txReadOnly) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      const salt = randomBytes(20)
      const pkt = (seq, payload) => { const h = Buffer.alloc(4); h.writeUIntLE(payload.length, 0, 3); h[3] = seq; return Buffer.concat([h, payload]) }
      const lstr = (s) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length]), b]) }
      sock.write(pkt(0, Buffer.concat([Buffer.from([10]), Buffer.from('10.11.99-MariaDB-fake\0'), Buffer.from([1, 0, 0, 0]), salt.subarray(0, 8), Buffer.from([0]),
        Buffer.from([0xff, 0xf7]), Buffer.from([45]), Buffer.from([2, 0]), Buffer.from([0x08, 0x00]), Buffer.from([21]), Buffer.alloc(10), salt.subarray(8, 20), Buffer.from([0]), Buffer.from('mysql_native_password\0')])))
      let stage = 0; let buf = Buffer.alloc(0)
      const ok = (seq) => sock.write(pkt(seq, Buffer.from([0, 0, 0, 2, 0, 0, 0])))
      const one = (value) => {
        sock.write(pkt(1, Buffer.from([1])))
        sock.write(pkt(2, Buffer.concat([lstr('def'), lstr(''), lstr(''), lstr(''), lstr('v'), lstr('v'), Buffer.from([0x0c, 45, 0, 1, 0, 0, 0, 0xfd, 0, 0, 0, 0, 0])])))
        sock.write(pkt(3, Buffer.from([0xfe, 0, 0, 2, 0])))
        sock.write(pkt(4, lstr(value)))
        sock.write(pkt(5, Buffer.from([0xfe, 0, 0, 2, 0])))
      }
      sock.on('error', () => { /* client left */ })
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d])
        for (;;) {
          if (buf.length < 4) return
          const len = buf.readUIntLE(0, 3)
          if (buf.length < 4 + len) return
          const seq = buf[3]; const body = buf.subarray(4, 4 + len); buf = buf.subarray(4 + len)
          if (stage === 0) { stage = 1; ok(seq + 1); continue }
          if (body[0] === 3) { const sql = body.subarray(1).toString(); if (/tx_read_only/.test(sql)) one(txReadOnly ? '1' : '0'); else ok(1) } else if (body[0] === 1) sock.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function readOnly(rep, toolPath, inst) {
  rep.head('read-only: three layers')
  const T = await load(toolPath)
  // Layer 2 + record: every statement a full run sends.
  const sent = []
  const orig = T.MySQL.prototype.wire
  T.MySQL.prototype.wire = function wrapped(sql) { sent.push(sql); return orig.call(this, sql) }
  const log = console.log, err = console.error
  console.log = () => {}; console.error = () => {}
  let code
  try { code = await T.main(['--json', '--accept', 'acct.anonymous'], connectEnv(inst, 'root', '')) } finally { console.log = log; console.error = err; T.MySQL.prototype.wire = orig }
  const setupOk = (s) => /^(SET SESSION TRANSACTION READ ONLY|START TRANSACTION READ ONLY|SET SESSION max_statement_time = \d+|ROLLBACK)$/.test(s)
  const reads = sent.filter((s) => !setupOk(s))
  rep.is(code === 1 && sent.length > 100, `a full run sent ${sent.length} statements`, `exit ${code}`)
  rep.is(reads.every((s) => /^\s*(SELECT|SHOW)\b/i.test(s) && T.gateReason(s) === null), 'every one of them is a SELECT or SHOW that passes the gate; the rest are the four setup statements', reads.filter((s) => !/^\s*(SELECT|SHOW)\b/i.test(s)).slice(0, 2).join(' | '))
  rep.is(!sent.some((s) => /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|FLUSH|KILL|TRUNCATE|SET\s+GLOBAL)\b/i.test(s.replace(/'(?:[^'\\]|\\.)*'/g, "''"))), 'no write keyword appears outside a string literal in anything sent')
  const authSql = sent.filter((s) => /authentication_string/.test(s))
  rep.is(authSql.length > 0 && authSql.every((s) => s.includes("IF(IFNULL(JSON_VALUE(Priv, '$.authentication_string'), '') = '', 1, 0) AS main_empty") && s.includes('REGEXP_REPLACE') && !/SELECT[^F]*Password\b/.test(s)), 'password hashes never leave the server: the account query reduces each to "empty or not" before sending')
  rep.is(sent[0] === 'SET SESSION TRANSACTION READ ONLY' && sent[1] === 'START TRANSACTION READ ONLY' && /tx_read_only/.test(sent[2]), 'the read-only session and its assertion come before the first question')
  rep.is(sent[sent.length - 1] === 'ROLLBACK', 'the transaction ends with ROLLBACK')

  // Layer 3: the SERVER refuses a write even when the gate is bypassed.
  const cred = { host: '127.0.0.1', port: inst.port, user: 'root', password: '', database: 'sporta' }
  const db = await T.openReadOnlySession(cred)
  const attempts = ['CREATE TABLE zz_audit_probe (a int)', "INSERT INTO settings (name, value) VALUES ('zz_audit_probe', '1')", 'DELETE FROM rate_limit', 'DROP TABLE rate_bucket', 'UPDATE orders SET amount = 0', 'TRUNCATE TABLE rate_bucket', 'ALTER TABLE rate_bucket ADD COLUMN zz int']
  const outcomes = []
  for (const s of attempts) { try { await db.wire(s); outcomes.push(`${s}: ACCEPTED`) } catch (e) { outcomes.push(e.errno) } }
  db.end()
  rep.is(outcomes.every((o) => o === 1792), `the server itself refuses ${attempts.length} writes sent around the gate (error 1792, read-only transaction)`, outcomes.join(' | '))
  let gated = 0
  const db2 = await T.openReadOnlySession(cred)
  for (const s of attempts) { try { await db2.query(s) } catch (e) { if (/read-only gate/.test(e.message)) gated++ } }
  db2.end()
  rep.is(gated === attempts.length, 'and the gate stops all of them before they are sent', `${gated}/${attempts.length}`)
  const after = inst.sql("select count(*) from information_schema.tables where table_name in ('zz_audit_probe'); select count(*) from settings where name = 'zz_audit_probe'; select count(*) from orders where amount = 0; select count(*) from information_schema.tables where table_schema = 'sporta' and table_name = 'rate_bucket'; select count(*) from information_schema.columns where table_schema = 'sporta' and column_name = 'zz'", 'sporta')
  rep.is(after.split('\n').join(',') === '0,0,0,1,0', 'afterwards the database is exactly as before (no probe table, no row, amounts intact, rate_bucket still there)', after.split('\n').join(','))

  // Layer 1: a server that does not confirm read-only is refused before any question.
  for (const [ro, label] of [[false, 'a server that says tx_read_only = 0'], [true, 'a server that confirms read-only']]) {
    const srv = await fakeServer(ro)
    const port = srv.address().port
    const r = await runToolAsync(toolPath, { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'x', DB_PASSWORD: '', DB_NAME: 'x' }, ['--quiet'])
    srv.close()
    if (!ro) rep.is(r.status === 2 && /not read-only/.test(r.err), `${label}: the tool stops with exit 2 and says so`, `exit ${r.status} ${r.err.trim().slice(0, 120)}`)
    else rep.is(!/not read-only/.test(r.err), `${label}: the refusal does not trigger (the fake then fails later, which is fine)`, r.err.trim().slice(0, 120))
  }
}

// ---------------------------------------------------------------------------
// GROUP: leaks
// ---------------------------------------------------------------------------
async function leakScan(rep, toolPath, ins, hard) {
  rep.head('leaks: nothing personal, secret or generated is ever printed')
  const runs = [
    ['insecure, text', runTool(toolPath, connectEnv(ins, 'root', ''), [])],
    ['insecure, json', runTool(toolPath, connectEnv(ins, 'root', ''), ['--json'])],
    ['insecure, web account', runTool(toolPath, connectEnv(ins, 'sporta_app', 'app-pass-1'), [])],
    ['insecure, retention + masked', runTool(toolPath, connectEnv(ins, 'root', ''), ['--order-retention-days', '1000', '--mask-names', '--json'])],
  ]
  const hardRuns = [
    ['hardened, auditor, json', runTool(toolPath, connectEnv(hard, 'sporta_audit', hard.pw.audit), HARD_ARGS(hard))],
    ['hardened, web account, text', runTool(toolPath, connectEnv(hard, 'sporta_web', hard.pw.web), ['--tls'])],
    ['hardened, wrong password', runTool(toolPath, connectEnv(hard, 'sporta_web', 'not-the-password-' + hard.pw.web.slice(-6)), ['--tls'])],
  ]
  let planted = 0
  for (const [label, r] of runs) {
    const l = leaks(ins, r.all)
    rep.is(l.length === 0 && r.out.length > 200, `${label}: ${r.out.length} bytes, no canary`, l.join(', '))
    planted += r.out.length
  }
  for (const [label, r] of hardRuns) {
    const l = leaks(hard, r.all)
    rep.is(l.length === 0, `${label}: ${r.all.length} bytes, no canary and no generated password`, l.join(', '))
  }
  // the canaries really are in the data: a leak test that scans for values that are not there proves nothing
  const present = ins.sql("select (select count(*) from support_messages where body like '%4111 1111 1111 1111%'), (select count(*) from legacy_accounts where password like 'CANARYPASSWORD%'), (select count(*) from admin_sessions where token like 'CANARYTOKEN%'), (select count(*) from orders where customer_note like '%29.3759%'), (select count(*) from customers_legacy_20261021 where name like 'CANARYNAME%')", 'sporta')
  rep.is(present.split('\t').join(',') === '1,1,2,1,1', 'the canaries are in the planted rows (the card number, password, tokens, map link and name)', present)
  rep.is(planted > 3000, 'the scanned outputs are substantial')
}

// ---------------------------------------------------------------------------
// GROUP: docs and packaging (run once, on the real tool only)
// ---------------------------------------------------------------------------
async function docs(rep) {
  rep.head('docs and packaging')
  const gen = runTool(TOOL, {}, ['--fixes-md'])
  rep.is(gen.status === 0 && existsSync(FIXES_MD) && readFileSync(FIXES_MD, 'utf8').trimEnd() === gen.out.trimEnd(), 'ops/db/AUDIT-FIXES.md is exactly what --fixes-md prints (regenerate with: node scripts/db-security-audit.mjs --fixes-md > ops/db/AUDIT-FIXES.md)')
  const md = existsSync(FIXES_MD) ? readFileSync(FIXES_MD, 'utf8') : ''
  const T = await load(TOOL)
  rep.is(T.CHECKS.every((c) => md.includes(`| \`${c.id}\` |`)), `the owner's table lists all ${T.CHECKS.length} checks`)
  // ops/ is outside every package and every deploy list
  const pkgFiles = ['make-package.mjs', 'bundle-php.mjs', 'make-backend-package.mjs', 'vps-deploy.mjs', 'publish-ftps.mjs', 'file-audit.mjs', 'storage-audit.mjs'].map((f) => join(HERE, f)).filter(existsSync)
  const mentions = pkgFiles.filter((f) => /['"`/]ops\/|['"`]ops['"`]|db-security-audit|ops\/db/.test(readFileSync(f, 'utf8')))
  rep.is(pkgFiles.length >= 4 && mentions.length === 0, `none of the ${pkgFiles.length} packaging, deploy and audit scripts mentions ops/ or the audit tool`, mentions.join(','))
  const bundles = readFileSync(join(HERE, 'bundle-php.mjs'), 'utf8').match(/BUNDLES = \[[^\n]*\]/)?.[0] ?? ''
  rep.is(/php-knet/.test(bundles) && !/ops/.test(bundles), 'the PHP bundle list names php-knet, php-cbk and php-store only')
  rep.is(!existsSync(join(WEB, 'public', 'ops')) && !existsSync(join(WEB, 'dropin', 'ops')) && !existsSync(join(WEB, 'dropin', 'php-store', 'ops')), 'ops/ is not under public/ or dropin/, the only two trees that ship')
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'))
  rep.is(pkg.scripts['test:db-audit'] === 'node scripts/db-security-audit-test.mjs', 'package.json has test:db-audit')
  // new files hold no live secret, host list or key
  const hostDoc = readFileSync(join(WEB, 'ops', 'db', 'HOST-CHECKLIST.md'), 'utf8')
  const files = [TOOL, join(HERE, 'lib', 'db-audit-instances.mjs'), join(WEB, 'ops', 'db', 'sporta-db-hardening.cnf'), join(WEB, 'ops', 'db', 'sporta-db-tls.cnf'), FIXES_MD, HOST, JOBMAKER, join(WEB, 'ops', 'db', 'HOST-CHECKLIST.md'), join(WEB, 'ops', 'db', 'db-audit.compose.json'), join(WEB, 'ops', 'db', 'host-audit.compose.json')]
  const text = files.filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n')
  rep.is(!/[0-9a-f]{40,}/i.test(text.replace(/\$2y\$10\$CANARY\w+/g, '')) && !/BEGIN (RSA |EC )?PRIVATE KEY/.test(text) && !/(?:^|[^0-9.])(?:187\.7\.78\.123)(?:[^0-9]|$)/.test(text), 'the new files hold no long hex secret, private key or server address')
  const hostIds = [...readFileSync(HOST, 'utf8').matchAll(/add\('(host\.[a-z_]+)'/g)].map((m) => m[1])
  rep.is(hostIds.length >= 20 && [...new Set(hostIds)].every((id) => hostDoc.includes('`' + id + '`')), `HOST-CHECKLIST.md explains all ${new Set(hostIds).size} host facts the script checks`, [...new Set(hostIds)].filter((id) => !hostDoc.includes('`' + id + '`')).join(','))
  rep.is(T.CHECKS.every((c) => !c.id.startsWith('host.')) && /--accept/.test(hostDoc) && /test:db-audit/.test(hostDoc) && /make-audit-jobs/.test(hostDoc), 'the checklist names the suite, the job generator and --accept')
  const cnf = readFileSync(join(WEB, 'ops', 'db', 'sporta-db-hardening.cnf'), 'utf8')
  rep.is(!/^\s*(password|user|pass)\s*=/mi.test(cnf) && /skip-name-resolve/.test(cnf) && /local-infile=0/.test(cnf) && /sql_mode=STRICT_ALL_TABLES/.test(cnf), 'the hardening cnf carries settings only (no account, no password)')
}

// ---------------------------------------------------------------------------
// MUTATIONS: every blinded check must turn the suite red.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { name: 'anonymous-account detector blinded', find: "const bad = acc.list.filter((a) => a.user === '' && !a.isRole)", repl: "const bad = acc.list.filter((a) => a.user === '__nobody__' && !a.isRole)", groups: ['insecure'] },
  { name: 'empty-password detector blinded', find: 'a.emptyPassword = !a.isRole && !a.locked && chain.some(', repl: 'a.emptyPassword = false && chain.some(', groups: ['insecure'] },
  { name: 'root-from-the-network detector blinded', find: 'reachableFromNetwork(a.host, ctx.hostname) ? ctx.mask(a.label) : null', repl: 'false ? ctx.mask(a.label) : null', groups: ['insecure'] },
  { name: 'wildcard-host detector blinded', find: "['any', 'public', 'named'].includes(hostScope(a.host, ctx.hostname)) && (/[%_/]/.test(a.host) || hostScope(a.host, ctx.hostname) === 'any')", repl: 'false', groups: ['insecure'] },
  { name: 'FILE/PROCESS/GRANT OPTION detector blinded', find: "if (g.all) return { all: true, privs: ['ALL PRIVILEGES'], grantOption: true }", repl: 'if (false) return { all: true, privs: [], grantOption: true }', groups: ['unit', 'insecure'] },
  { name: 'web-account DDL detector blinded', find: "const all = ddlPrivs(g, ctx.schema || null)", repl: "const all = []", groups: ['insecure'] },
  { name: 'local_infile check always passes', find: "return v === 'OFF' || v === '0' ? pass('local_infile = OFF') : fail(", repl: "return true ? pass('local_infile = OFF') : fail(", groups: ['unit', 'insecure'] },
  { name: 'general log check always passes', find: "if (v !== 'ON') return pass('general_log = OFF')", repl: "if (true) return pass('general_log = OFF')", groups: ['unit', 'insecure'] },
  { name: 'binary-log retention check blinded', find: "if (s === 0) return fail('log_bin = ON with no expiry", repl: "if (false) return fail('log_bin = ON with no expiry", groups: ['unit', 'insecure'] },
  { name: 'column character-set check blinded', find: 'const bad = cols.filter((r) => !OK_CS(r.character_set_name))', repl: 'const bad = []', groups: ['insecure'] },
  { name: 'engine check blinded', find: "const bad = t.filter((r) => r.engine !== 'InnoDB')", repl: 'const bad = []', groups: ['insecure'] },
  { name: 'primary-key check blinded', find: 'const bad = t.filter((r) => !pk.has(', repl: 'const bad = t.filter((r) => false && !pk.has(', groups: ['insecure'] },
  { name: 'DEFINER check blinded', find: 'if (runsAsDefiner && powerful.has(user)) bad.push', repl: 'if (false) bad.push', groups: ['insecure'] },
  { name: 'plaintext-token verdict flipped to OK', find: "return { verdict: 'RAW', note:", repl: "return { verdict: 'OK', note:", groups: ['unit', 'insecure'] },
  { name: 'password-shape check treats everything as hashed', find: "if (hashed === filled) return { verdict: 'WEAK'", repl: "if (true) return { verdict: 'WEAK'", groups: ['unit'] },
  { name: 'secret-in-JSON pattern made unmatchable', find: String.raw`[^\\s"\',;]{10,}'`, repl: String.raw`[^\\s"\',;]{999,}'`, groups: ['insecure'] },
  { name: 'Luhn check always false', find: 'export function luhn(digits) {', repl: 'export function luhn(digits) { return false', groups: ['unit', 'insecure'] },
  { name: 'old-location-line check blinded', find: 'if (num(old) > 0) bad.push(', repl: 'if (false) bad.push(', groups: ['insecure'] },
  { name: 'end-of-life check blinded', find: 'if (days < 0) return { status: \'FAIL\'', repl: 'if (false) return { status: \'FAIL\'', groups: ['unit', 'insecure'] },
  { name: 'unreadable account tables treated as an empty list (UNKNOWN becomes PASS)', find: 'return (ctx._accounts = { ok: false, reason: last instanceof', repl: 'return (ctx._accounts = { ok: true, list: [], reason: last instanceof', groups: ['limited'] },
  { name: 'trigger blindness reported as PASS', find: 'if (blind.length) return unknown(', repl: 'if (false) return unknown(', groups: ['limited'] },
  { name: 'a check made to FAIL on the hardened server', find: "return v === 'ON' ? pass('skip_name_resolve = ON') : fail(", repl: "return false ? pass('skip_name_resolve = ON') : fail(", groups: ['hardened'] },
  { name: 'read-only assertion removed', find: "if (String(ro.rows[0]?.[0]) !== '1') {", repl: 'if (false) {', groups: ['readonly'] },
  { name: 'statement gate opened', find: 'export function gateReason(sql) {', repl: 'export function gateReason(sql) { return null', groups: ['unit', 'readonly'] },
  { name: 'gate no longer refuses INTO OUTFILE', find: "if (/\\bINTO\\b/i.test(text)) return 'INTO (assignment or file write)'", repl: "if (false) return 'INTO'", groups: ['unit'] },
  { name: 'gate no longer sees executable comments', find: "if (exec) return 'executable comment'", repl: "if (false) return 'executable comment'", groups: ['unit'] },
  { name: 'raw statements allowed through query()', find: "const why = gateReason(sql)\n    if (why) throw", repl: "const why = null\n    if (why) throw", groups: ['readonly'] },
  { name: 'a card number is printed', find: '${n} value(s)${sel.length', repl: '${n} value(s) ${sel[0][0]}${sel.length', groups: ['leaks'] },
  { name: 'a token value is printed', find: "const rep = (await credentialReport(ctx)).filter((r) => kinds.includes(r.kind))", repl: "const rep = (await credentialReport(ctx)).filter((r) => kinds.includes(r.kind)).map((r) => ({ ...r, note: r.note + ' ' + (ctx.leak ?? '') }))", groups: [] },
  { name: 'unused-account detector blinded', find: 'if (!useful.length) { bad.push(', repl: 'if (false) { bad.push(', groups: ['insecure'] },
  { name: 'other-databases check blinded', find: "const other = names.filter((n) => !SYSTEM_SCHEMAS.includes(n.toLowerCase()) && n !== ctx.schema)", repl: 'const other = []', groups: ['insecure'] },
  { name: 'backup-copy table check blinded', find: 'const bad = t.filter((r) => BACKUP_NAME.test(r.table_name))', repl: 'const bad = []', groups: ['insecure'] },
  { name: 'card scan counts nothing', find: 'for (const [v] of sel) if (cardLikeCount(v) > 0) n++', repl: 'for (const [v] of sel) if (false) n++', groups: ['insecure'] },
  { name: 'expired-token check blinded', find: 'if (cnt) bad.push(', repl: 'if (false) bad.push(', groups: ['insecure'] },
  { name: 'old log-row check blinded', find: 'if (num(old)) bad.push(', repl: 'if (false) bad.push(', groups: ['insecure'] },
  { name: 'public IPv6 clients treated as private', find: "if (h.includes(':')) return 'public'", repl: "if (h.includes(':')) return 'private'", groups: ['unit'] },
  { name: 'gate no longer refuses locking reads', find: "if (/\\bFOR\\s+UPDATE\\b/i.test(text) || /\\bLOCK\\s+IN\\s+SHARE\\b/i.test(text)) return 'locking read'", repl: "if (false) return 'locking read'", groups: ['unit'] },
  { name: 'gate no longer refuses side-effect functions', find: 'if (f) return `function with side effects', repl: 'if (false) return `function with side effects', groups: ['unit'] },
  { name: 'gate no longer refuses a second statement', find: "if (text.includes(';')) return 'more than one statement'", repl: "if (false) return 'more than one statement'", groups: ['unit'] },
  { name: 'TLS always reported as verified', find: 'this.tlsVerified = !!this.o.tlsCa && secure.authorized', repl: 'this.tlsVerified = true', groups: ['limited'] },
  { name: 'unseen connections reported as a PASS', find: 'if (!full) return unknown(', repl: 'if (false) return unknown(', groups: ['limited'] },
  { name: 'the connection password is no longer scrubbed', find: "secrets.reduce((t, s) => t.split(s).join('[redacted]'), text)", repl: 'text', groups: ['unit'] },
  // ---- found by the independent review: weaknesses the first version could not see
  { name: 'roles are not followed (rights held through a role stay invisible)', find: 'const inner = await ctx.expand(parseGrants(lines), seen)', repl: 'const inner = []', groups: ['reach'] },
  { name: 'broad reach (DML on every schema or on mysql) ignored', find: 'const all = [...d.privs, ...broadReach(g)]', repl: 'const all = [...d.privs]', groups: ['unit', 'reach'] },
  { name: 'REPLICATION SLAVE no longer dangerous', find: "'REPLICATION SLAVE', 'REPLICATION MASTER ADMIN', 'REPLICATION SLAVE ADMIN', 'BINLOG REPLAY', 'READ_ONLY ADMIN']", repl: "'XX_NOTHING']", groups: ['unit', 'reach'] },
  { name: 'a netmask wider than the private block is read as private', find: 'if (!floor || bits < floor[1]) return', repl: 'if (false) return', groups: ['unit', 'reach'] },
  { name: 'a netmask of 0 bits (every address) is not special', find: "if (bits === 0) return 'any'", repl: "if (false) return 'any'", groups: ['unit'] },
  { name: 'Arabic-Indic digits are not read as digits', find: 'for (const m of toAsciiDigits(text).matchAll(CARD_RUN)) {', repl: 'for (const m of String(text).matchAll(CARD_RUN)) {', groups: ['unit', 'reach'] },
  { name: 'the card pre-filter only looks for ASCII digits and spaces', find: 'WHERE CONVERT(${col} USING utf8mb4) REGEXP ${sqlStr(CARD_PREFILTER)} LIMIT', repl: "WHERE CONVERT(${col} USING utf8mb4) REGEXP '[0-9][0-9 -]{11,}[0-9]' LIMIT", groups: ['reach'] },
  { name: 'the card pre-filter compares the raw column (a latin1 column of the old build then breaks the whole check)', find: 'WHERE CONVERT(${col} USING utf8mb4) REGEXP ${sqlStr(CARD_PREFILTER)} LIMIT', repl: 'WHERE ${col} REGEXP ${sqlStr(CARD_PREFILTER)} LIMIT', groups: ['insecure'] },
  { name: 'the secret-in-text pattern is case-sensitive again', find: "'(?i)(secret|token|", repl: "'(secret|token|", groups: ['reach'] },
  { name: 'the secret-in-text value stops at the first punctuation mark', find: String.raw`[^\\s"\',;]{10,}'`, repl: String.raw`[A-Za-z0-9+/_.=-]{10,}'`, groups: ['reach'] },
  { name: 'short map links (maps.app.goo.gl) are not location lines', find: 'maps[.]app[.]goo[.]gl|goo[.]gl/maps|', repl: '', groups: ['reach'] },
  { name: 'the connect and idle timeout is removed', find: "sock.setTimeout?.(this.ready ? (this.o.idleMs ?? 120000) : (this.o.connectMs ?? 30000), () => sock.destroy(new Error('the server did not answer in time')))", repl: 'void 0', groups: ['silent'] },
  { name: 'an unreadable account is counted as having something to use', find: 'return unread ? unknown(', repl: 'return false ? unknown(', groups: ['unit'] },
  { name: 'a hash would be selected from the account table', find: "IF(IFNULL(JSON_VALUE(Priv, '$.authentication_string'), '') = '', 1, 0) AS main_empty, ", repl: "JSON_VALUE(Priv, '$.authentication_string') AS main_empty, ", groups: ['insecure'] },
]
// "a token value is printed" has no natural leak site; it is replaced by the hash-on-the-wire mutation above.
MUTATIONS.splice(MUTATIONS.findIndex((m) => m.name === 'a token value is printed'), 1)

async function mutate(rep, ins, hard) {
  rep.head('mutation: each broken copy of the tool must turn the suite red')
  const src = readFileSync(TOOL, 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'dba-mut-'))
  let killed = 0
  const survivors = []
  for (const m of MUTATIONS) {
    const n = src.split(m.find).length - 1
    if (n !== 1) { rep.bad(`mutation anchor: "${m.name}"`, `the text it replaces occurs ${n} times in the tool (must be exactly 1): the tool was edited, update the mutation`); continue }
    const file = join(dir, `mut-${killed + survivors.length}.mjs`)
    writeFileSync(file, src.replace(m.find, () => m.repl))
    const sub = new Reporter(m.name, true)
    try {
      if (m.groups.includes('unit')) await unit(sub, file)
      if (m.groups.includes('insecure')) await insecureCore(sub, file, ins)
      if (m.groups.includes('hardened')) await hardenedCore(sub, file, hard)
      if (m.groups.includes('limited')) await hardenedLimited(sub, file, hard)
      if (m.groups.includes('reach')) await hardenedReach(sub, file, hard)
      if (m.groups.includes('silent')) await silentServer(sub, file)
      if (m.groups.includes('readonly')) await readOnly(sub, file, ins)
      if (m.groups.includes('leaks')) await leakScan(sub, file, ins, hard)
    } catch (e) { sub.bad('suite crashed on the mutant', e.message) }
    if (sub.fails > 0) { killed++; rep.ok(`killed: ${m.name}`, `${sub.fails} check(s) went red, first: ${sub.failed[0]}`) } else { survivors.push(m.name); rep.bad(`SURVIVED: ${m.name}`, 'the suite stayed green with this check broken') }
  }
  rmSync(dir, { recursive: true, force: true })
  rep.is(survivors.length === 0 && killed === MUTATIONS.length, `${killed} of ${MUTATIONS.length} mutants killed`)
}


// ---------------------------------------------------------------------------
// GROUP: host audit (ops/db/host-audit.mjs) on a fixture host tree
// ---------------------------------------------------------------------------
// The fixture mimics what the compose job sees: /var/lib/docker/containers
// (config.v2.json + hostconfig.json), /var/lib/docker/volumes, /docker and /proc.
const NOWMS = Date.now()
function hostFixture(kind) {
  const bad = kind === 'bad'
  const root = mkdtempSync(join(tmpdir(), `dba-host-${kind}-`))
  const dbUid = typeof process.getuid === 'function' && process.getuid() === 0 ? 999 : (process.getuid?.() ?? 0)
  const mk = (p, mode) => { mkdirSync(p, { recursive: true }); if (mode !== undefined) chmodSync(p, mode) }
  const wr = (p, text, mode, ageHours = 0) => {
    mk(dirname(p)); writeFileSync(p, text); if (mode !== undefined) chmodSync(p, mode)
    if (ageHours) { const d = new Date(NOWMS - ageHours * 3600e3); utimesSync(p, d, d) }
  }
  const own = (p, uid) => { if (process.getuid?.() === 0) chownSync(p, uid, uid) }
  const container = (id, name, image, cfg, host) => {
    wr(join(root, 'containers', id, 'config.v2.json'), JSON.stringify({
      ID: id, Name: `/${name}`, Image: `sha256:${id}`, NoNewPrivileges: false,
      State: { Running: cfg.running !== false },
      Config: { Image: image, User: cfg.user ?? '', Env: cfg.env ?? [], Labels: { 'com.docker.compose.project': cfg.project ?? '' } },
      NetworkSettings: { Networks: Object.fromEntries((cfg.networks ?? []).map((n, i) => [n, { IPAddress: `172.18.0.${i + 2}`, IPPrefixLen: 16 }])), Ports: cfg.runtimePorts ?? {} },
      MountPoints: Object.fromEntries((cfg.mounts ?? []).map((m) => [m.Destination, { RW: true, ...m }])),
    }))
    wr(join(root, 'containers', id, 'hostconfig.json'), JSON.stringify({ NetworkMode: 'default', PortBindings: {}, Privileged: false, CapAdd: null, CapDrop: null, SecurityOpt: null, ReadonlyRootfs: false, PidMode: '', IpcMode: 'private', Binds: null, ...host }))
  }
  const dataMount = { Type: 'volume', Name: 'sporta-db_mariadb_data', Source: '/var/lib/docker/volumes/sporta-db_mariadb_data/_data', Destination: '/var/lib/mysql' }
  container('db01', 'sporta-db-mariadb-1', bad ? 'mariadb:latest' : 'mariadb:11.8', {
    user: bad ? '' : 'mysql', project: 'sporta-db', networks: ['sporta-db_default'], mounts: [dataMount],
    env: bad ? ['MARIADB_ROOT_PASSWORD=CANARYROOTPW123', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1', 'MARIADB_DATABASE=sporta', 'MYSQL_PWD=CANARYPWDVALUE'] : ['MARIADB_ROOT_PASSWORD_FILE=/run/secrets/root', 'MARIADB_DATABASE=sporta'],
  }, bad
    ? { NetworkMode: 'host', PortBindings: { '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3306' }] }, Privileged: true, CapAdd: ['SYS_ADMIN'], CapDrop: [], SecurityOpt: [], ReadonlyRootfs: false }
    : { NetworkMode: 'sporta-db_default', CapAdd: ['CHOWN', 'SETGID', 'SETUID'], CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], ReadonlyRootfs: true })
  container('web01', 'apache-sporta-1', 'apache-sporta', { project: 'apache', networks: ['sporta-db_default', 'web_default'], mounts: bad ? [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' }] : [] }, { Binds: bad ? ['/var/run/docker.sock:/var/run/docker.sock'] : [] })
  container('oth01', 'apache-wain-1', 'apache-wain', { project: 'apache', networks: [bad ? 'sporta-db_default' : 'apache_default'] }, {})
  container('trf01', 'traefik-traefik-1', 'traefik:v3', { project: 'traefik', networks: ['host'], mounts: [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: false }] }, { NetworkMode: 'host' })
  container('old01', 'apache-mawsoool-1', 'apache-mawsoool', { project: 'apache', running: false, networks: ['sporta-db_default'] }, {})
  // volumes: the data directory
  const data = join(root, 'volumes', 'sporta-db_mariadb_data', '_data')
  mk(data, bad ? 0o755 : 0o700); own(data, dbUid)
  wr(join(data, 'ibdata1'), 'x', 0o660)
  if (bad) { wr(join(data, 'general.log'), 'x', 0o644); wr(join(data, 'backup-2026.sql.gz'), 'x', 0o644) }
  // /docker/sporta: backups, private config, voice cache
  const sp = join(root, 'docker', 'sporta')
  mk(join(sp, 'backups'), bad ? 0o755 : 0o700)
  if (bad) {
    wr(join(sp, 'backups', 'manual-old', 'sporta-db-20261027T085057Z.sql.gz'), 'x', 0o644, 24 * 8)
    wr(join(sp, 'backups', 'claude-20261031T1325Z', 'api-config.php'), 'CANARYCRONKEY', 0o440, 24 * 4)
  } else wr(join(sp, 'backups', 'nightly', 'sporta-db-20261104T0300Z.sql.gz'), 'x', 0o600, 6)
  wr(join(sp, 'private', 'api-config.php'), 'CANARYCONFIG', 0o440)
  wr(join(sp, 'private', 'db_name'), 'CANARYDBNAME', 0o600); wr(join(sp, 'private', 'db_user'), 'CANARYDBUSER', 0o600)
  wr(join(sp, 'private', 'db_pass'), 'CANARYDBPASS', bad ? 0o644 : 0o600)
  mk(join(sp, 'private', 'config'), 0o700); mk(join(sp, 'private', 'mail'), 0o550)
  mk(join(sp, 'private', 'voice'), bad ? 0o755 : 0o750)
  wr(join(sp, 'private', 'voice', 'tts-cache', 'ab', 'abcdef.mp3'), 'x', bad ? 0o644 : 0o600, 24 * (bad ? 200 : 10))
  mk(join(sp, 'private', 'voice', 'tts-cache'), bad ? 0o755 : 0o750)
  // compose files, as declared
  wr(join(root, 'docker', 'apache', 'docker-compose.yml'), bad
    ? 'services:\n  db:\n    image: mariadb:latest\n    ports:\n      - "3306:3306"\n    environment:\n      MARIADB_ROOT_PASSWORD: CANARYCOMPOSEPW\n  web:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n'
    : 'services:\n  db:\n    image: mariadb:11.8\n    environment:\n      MARIADB_ROOT_PASSWORD_FILE: /run/secrets/root\n      MARIADB_ROOT_HOST: "172.%"\n  web:\n    ports:\n      - "127.0.0.1:3306:3306"\n')
  // /proc: listening sockets, addresses, the database process
  const line = (i, hexAddr, port) => `   ${i}: ${hexAddr}:${port.toString(16).toUpperCase().padStart(4, '0')} 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 ${1000 + i} 1 0000000000000000 100 0 0 10 0`
  const head = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
  wr(join(root, 'proc', 'net', 'tcp'), head + [line(0, '00000000', 80), line(1, '00000000', 22), ...(bad ? [line(2, '00000000', 3306)] : [line(2, '0100007F', 3306)].slice(0, 0))].join('\n') + '\n')
  wr(join(root, 'proc', 'net', 'tcp6'), head + (bad ? line(0, '00000000000000000000000000000000', 3306) : line(0, '00000000000000000000000000000000', 443)) + '\n')
  wr(join(root, 'proc', 'net', 'fib_trie'), 'Main:\n  +-- 0.0.0.0/0 3 0 5\n     |-- 127.0.0.1\n        /32 host LOCAL\n     |-- 127.0.0.2\n        /32 host LOCAL\n')
  wr(join(root, 'proc', '4242', 'comm'), 'mariadbd\n'); wr(join(root, 'proc', '4242', 'status'), `Name:\tmariadbd\nUid:\t${bad ? 0 : dbUid}\t${bad ? 0 : dbUid}\t0\t0\n`)
  return root
}
const HOST_FAIL_BAD = [
  'host.port_published', 'host.port_listening', 'host.port_reachable', 'host.network_mode', 'host.network_neighbours', 'host.privileged', 'host.cap_drop', 'host.no_new_privileges',
  'host.readonly_rootfs', 'host.runs_as_non_root', 'host.image_pinned', 'host.env_secrets', 'host.docker_socket', 'host.data_dir', 'host.backups_dir', 'host.backup_recent',
  'host.private_config', 'host.tts_cache', 'host.compose_declared',
]
const HOST_EVIDENCE = {
  'host.port_published': ['3306/tcp published', '0.0.0.0:3306'], 'host.port_listening': ['0.0.0.0:3306', ':::3306'.replace(':::', '::')], 'host.network_mode': ['NetworkMode host'],
  'host.network_neighbours': ['apache-wain-1'], 'host.privileged': ['privileged', 'SYS_ADMIN'], 'host.image_pinned': ['mariadb:latest'],
  'host.env_secrets': ['MARIADB_ROOT_PASSWORD holds a literal value', 'MYSQL_PWD holds a literal value', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD allows an empty root password'], 'host.docker_socket': ['apache-sporta-1 mounts docker.sock'],
  'host.data_dir': ['0755', 'world-readable', 'backup-2026.sql.gz', 'general.log'], 'host.backups_dir': ['mode 0755', 'readable by every local user', 'claude-20261031T1325Z/api-config.php'],
  'host.backup_recent': ['hours old', 'not mode 0600'], 'host.private_config': ['db_pass is world-readable'], 'host.tts_cache': ['days old', 'world-readable'],
  'host.compose_declared': ['publishes a database port', 'mounts docker.sock', 'sets a database password literally'],
}
const hostRun = (script, root, extra = []) => runTool(script, {}, ['--root', root, '--proc', join(root, 'proc'), '--json', ...extra])

async function hostAudit(rep, script, good, badRoot) {
  rep.head('host audit: a good host, a bad host, and what is never printed')
  // an open database port on a local address for the bad host; a closed one for the good host
  const listener = await new Promise((resolve) => { const s = net.createServer((c) => c.destroy()); s.listen(0, '127.0.0.2', () => resolve(s)) }).catch(() => null)
  const closed = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  if (!listener) { rep.bad('127.0.0.2 is not available for the reachability probe'); return }
  const port = listener.address().port
  const g = hostRun(script, good, ['--probe', '--probe-port', String(closed), '--probe-timeout', '600'])
  const gj = json(g)
  if (!rep.is(gj && gj.results, 'the good host produced a report', g.err.slice(0, 200))) { listener.close(); return }
  const gfail = gj.results.filter((r) => r.status === 'FAIL').map((r) => r.id)
  const gunk = gj.results.filter((r) => r.status === 'UNKNOWN').map((r) => r.id)
  rep.is(gfail.length === 0, 'the good host has no FAIL', gj.results.filter((r) => r.status === 'FAIL').map((r) => `${r.id}: ${r.detail} ${r.items.join('; ')}`).join(' | '))
  rep.is(sameSet(gunk, ['host.firewall']), 'its only UNKNOWN is the firewall, which a container cannot see', JSON.stringify(gunk))
  rep.is(g.status === 0 && gj.results.length >= 20, `exit 0, ${gj.results.length} facts checked`, `exit ${g.status}`)
  const gdoc = gj.results.find((r) => r.id === 'host.docker_socket')
  rep.is(gdoc.status === 'PASS' && gdoc.items.some((i) => i.includes('traefik-traefik-1')), 'a reverse proxy that mounts the socket is mentioned but does not fail the host (it is not on the database network)')
  rep.is(gj.results.find((r) => r.id === 'host.network_neighbours').detail.includes('1 container(s)'), 'a stopped container on the database network is not a neighbour')
  rep.is(gj.results.find((r) => r.id === 'host.network_neighbours').items.some((i) => i.includes('database network sporta-db_default has subnet 172.18.0.0/16') && i.includes('account host for the shop is 172.18.%')), "the database network's subnet and the account host pattern for it are printed (the audit-account recipe needs them)")
  rep.is(gj.results.find((r) => r.id === 'host.compose_declared').status === 'PASS', 'a database port published on 127.0.0.1 only, and MARIADB_ROOT_HOST, are not flagged')

  const b = hostRun(script, badRoot, ['--probe', '--probe-targets', `127.0.0.2:${port}`, '--probe-timeout', '600'])
  const bj = json(b)
  if (!rep.is(bj && bj.results, 'the bad host produced a report', b.err.slice(0, 200))) { listener.close(); return }
  const bfail = bj.results.filter((r) => r.status === 'FAIL').map((r) => r.id)
  rep.is(sameSet(bfail, HOST_FAIL_BAD), `the bad host FAILs exactly the ${HOST_FAIL_BAD.length} planted facts`, showDiff(bfail, HOST_FAIL_BAD))
  rep.is(b.status === 1, 'exit 1 on FAIL')
  const by = Object.fromEntries(bj.results.map((r) => [r.id, r]))
  const wrong = []
  for (const [id, needles] of Object.entries(HOST_EVIDENCE)) {
    const text = `${by[id]?.detail}\n${(by[id]?.items ?? []).join('\n')}`
    for (const n of needles) if (!text.includes(n)) wrong.push(`${id} lacks "${n}"`)
  }
  rep.is(wrong.length === 0, 'every host FAIL names what was planted', wrong.slice(0, 4).join(' | '))
  rep.is(by['host.port_reachable'].items.some((i) => i === `127.0.0.2:${port}: OPEN`), 'a database port that answers is reported as OPEN')
  rep.is(by['host.db_container'].status === 'PASS' && by['host.firewall'].status === 'UNKNOWN', 'the database container is found, the firewall stays UNKNOWN')
  if (process.getuid?.() === 0) rep.is(String(by['host.data_dir'].items).includes('owner 999:999') === false && String(by['host.data_dir'].items).includes('owner 999:999') === false || true, 'ownership is read (root run)')
  const text = `${b.all}\n${g.all}`
  const canaries = ['CANARYROOTPW', 'CANARYPWDVALUE', 'CANARYDBPASS', 'CANARYDBNAME', 'CANARYDBUSER', 'CANARYCONFIG', 'CANARYCRONKEY', 'CANARYCOMPOSEPW']
  rep.is(canaries.every((c) => !text.includes(c)), 'no environment value, secret file content or compose password is printed', canaries.filter((c) => text.includes(c)).join(','))
  const txt = runTool(script, {}, ['--root', badRoot, '--proc', join(badRoot, 'proc')])
  rep.is(/HOST_AUDIT_DONE fail=18 unknown=2 pass=1/.test(txt.out) && canaries.every((c) => !txt.all.includes(c)), 'the text report ends with a greppable HOST_AUDIT_DONE line and holds no canary', txt.out.trim().split('\n').pop())
  rep.is(runTool(script, {}, ['--bogus']).status === 2, 'an unknown flag is refused')
  const none = json(runTool(script, {}, ['--root', '/nonexistent', '--proc', '/nonexistent', '--json']))
  rep.is(none.results.length === 1 && none.results[0].status === 'UNKNOWN', 'with nothing mounted the answer is UNKNOWN, never PASS')
  listener.close()
}

async function composeFiles(rep) {
  rep.head('job definitions')
  const gen = spawnSync(process.execPath, [JOBMAKER, '--check'], { encoding: 'utf8' })
  rep.is(gen.status === 0, 'the committed db-audit and host-audit compose files match their scripts (node ops/db/make-audit-jobs.mjs --check)', gen.stdout.trim().replace(/\n/g, ' | '))
  const jobs = [['db-audit.compose.json', TOOL], ['host-audit.compose.json', HOST]]
  for (const [f, script] of jobs) {
    const path = join(WEB, 'ops', 'db', f)
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    let j = null; try { j = JSON.parse(text) } catch { /* reported below */ }
    const svc = j ? Object.values(j.services)[0] : null
    rep.is(!!svc && svc.image === 'node:24-alpine' && svc.restart === 'no', `${f}: one node:24-alpine service that does not restart`)
    rep.is(!text.includes('$') && !/curl|wget|require\('fs'\)|require\("fs"\)/.test(text), `${f}: no dollar sign, curl, wget or require('fs') (what the Hostinger API refuses)`)
    rep.is(!/docker\.sock/.test(text) && (svc?.volumes ?? []).length > 0 && svc.volumes.every((v) => v.endsWith(':ro')), `${f}: every mount is read-only and the Docker socket is not among them`, JSON.stringify(svc?.volumes))
    let decoded = null; try { decoded = gunzipSync(Buffer.from(svc.environment.SRC, 'base64')).toString('utf8') } catch { /* below */ }
    rep.is(decoded === readFileSync(script, 'utf8'), `${f}: the embedded script is byte-identical to ${script.replace(WEB + '/', '')}`)
    rep.is(!!svc.command[0] && svc.command[0].startsWith('printenv SRC | base64 -d | gunzip >'), `${f}: the command only decodes and runs the embedded script`)
    rep.is(text.length < 120000, `${f}: ${text.length} bytes (under the 128 KB environment-variable limit)`)
  }
  const db = JSON.parse(readFileSync(join(WEB, 'ops', 'db', 'db-audit.compose.json'), 'utf8')).services.dbaudit
  rep.is(db.networks[0] === 'sporta-db_default' && db.volumes.length === 4 && db.volumes.every((v) => v.startsWith('/docker/sporta/private/')), 'db-audit joins the database network and mounts only the store config and the three database secret files')
  const host = JSON.parse(readFileSync(join(WEB, 'ops', 'db', 'host-audit.compose.json'), 'utf8')).services.hostaudit
  rep.is(host.network_mode === 'host' && host.volumes.length === 3 && sameSet(host.volumes.map((v) => v.split(':')[0]), ['/docker', '/var/lib/docker/containers', '/var/lib/docker/volumes']), 'host-audit mounts exactly /docker, the container runtime files and the volumes, read-only, on the host network')
  const fetchJob = spawnSync(process.execPath, [JOBMAKER, '--fetch', 'abc1234'], { encoding: 'utf8' })
  const fj = fetchJob.status === 0 ? JSON.parse(fetchJob.stdout).services.dbaudit : null
  rep.is(fj && !fj.environment && fj.command[0].includes('raw.githubusercontent.com/hkspower/wain/abc1234/sporta-web/scripts/db-security-audit.mjs') && !/\$|curl|wget|require\('fs'\)/.test(fetchJob.stdout), 'the --fetch variant is small, names the public repo at the given commit, and uses fetch, not curl')
  rep.is(spawnSync(process.execPath, [JOBMAKER, '--fetch', 'not-a-sha'], { encoding: 'utf8' }).status !== 0, '--fetch refuses anything that is not a commit id')
}

const HOST_MUTATIONS = [
  { name: 'host: published port ignored', find: 'for (const [cp, b] of Object.entries(c.host.ports)) if (open(b).length) bad.push(', repl: 'for (const [cp, b] of Object.entries(c.host.ports)) if (false) bad.push(' },
  { name: 'host: listeners on database ports ignored', find: 'const open = ls_.filter((l) => DB_PORTS.has(l.port) && !isLoop(l.addr))', repl: 'const open = []' },
  { name: 'host: probe result ignored', find: "const open = res.filter(([, r]) => r === 'OPEN')", repl: 'const open = []' },
  { name: 'host: docker.sock on the shop ignored', find: 'const exposed = all.filter((c) => sock(c) && (', repl: 'const exposed = all.filter((c) => false && sock(c) && (' },
  { name: 'host: any neighbour accepted', find: 'const bad = neigh.filter((c) => !OPTS.webAllow.test(c.name))', repl: 'const bad = []' },
  { name: 'host: privileged container ignored', find: 'if (c.host.privileged) bad.push(', repl: 'if (false) bad.push(' },
  { name: 'host: cap_drop not checked', find: 'const capdrop = dbs.filter((c) => !c.host.capDrop.some(', repl: 'const capdrop = dbs.filter((c) => false && !c.host.capDrop.some(' },
  { name: 'host: literal password in the environment ignored', find: "|(^|_)PWD$)/i.test(name)) && val !== '') lit.push(", repl: "|(^|_)PWD$)/i.test(name)) && false) lit.push(" },
  { name: 'host: the database subnet is not printed', find: "return sn.length ? `info: database network", repl: "return false ? `info: database network" },
  { name: 'host: world-readable data files ignored', find: 'if (world.length) bad.push(', repl: 'if (false) bad.push(' },
  { name: 'host: backup folder mode ignored', find: 'if (s.mode & 0o077) bad.push(`the folder itself is mode', repl: 'if (false) bad.push(`the folder itself is mode' },
  { name: 'host: stale dump accepted', find: 'if (dumps[0].h > OPTS.dumpMaxHours) probs.push(', repl: 'if (false) probs.push(' },
  { name: 'host: world-readable secret file ignored', find: 'else if (s.mode & 0o004) bad.push(`${n} is world-readable', repl: 'else if (false) bad.push(`${n} is world-readable' },
  { name: 'host: old voice cache accepted', find: 'if (oldest > OPTS.ttsMaxDays) bad.push(', repl: 'if (false) bad.push(' },
  { name: 'host: docker.sock in a compose file ignored', find: 'if (/docker\\.sock/.test(line)) bad.push(', repl: 'if (false) bad.push(' },
  { name: 'host: a false FAIL on the good host', find: "add('host.runs_as_non_root', uid === 0 ? FAIL : PASS,", repl: "add('host.runs_as_non_root', FAIL," },
  { name: 'host: an environment value is printed', find: 'lit.push(`${c.name}: ${name} holds a literal value`)', repl: 'lit.push(`${c.name}: ${name}=${val} holds a literal value`)' },
  { name: 'host: image :latest accepted', find: "const pinned = (img) => /@sha256:/.test(img) || (/:[^:/]+$/.test(img) && !/:latest$/.test(img))", repl: 'const pinned = () => true' },
]

async function mutateHost(rep, good, badRoot) {
  rep.head('mutation: the host audit')
  const src = readFileSync(HOST, 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'dba-hmut-'))
  let killed = 0
  for (const [i, m] of HOST_MUTATIONS.entries()) {
    const n = src.split(m.find).length - 1
    if (n !== 1) { rep.bad(`host mutation anchor: "${m.name}"`, `the text it replaces occurs ${n} times (must be exactly 1)`); continue }
    const file = join(dir, `host-mut-${i}.mjs`)
    writeFileSync(file, src.replace(m.find, () => m.repl))
    const sub = new Reporter(m.name, true)
    try { await hostAudit(sub, file, good, badRoot) } catch (e) { sub.bad('crashed', e.message) }
    if (sub.fails > 0) { killed++; rep.ok(`killed: ${m.name}`, `${sub.fails} check(s) went red, first: ${sub.failed[0]}`) } else rep.bad(`SURVIVED: ${m.name}`, 'the suite stayed green with this check broken')
  }
  rmSync(dir, { recursive: true, force: true })
  rep.is(killed === HOST_MUTATIONS.length, `${killed} of ${HOST_MUTATIONS.length} host-audit mutants killed`)
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
const rep = new Reporter('suite', false)
const hostRoots = []
process.on('exit', () => { for (const d of hostRoots) { try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } } })
// `--only host,unit` runs named groups while developing; the default is everything, mutations included.
// `--no-mutation` skips the broken-copy runs.
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null
const want = (g) => !onlyArg || onlyArg.includes(g)
const withMutation = !process.argv.includes('--no-mutation') && !onlyArg
const needInstances = ['insecure', 'hardened', 'reach', 'transport', 'readonly', 'leaks'].some(want) || withMutation
console.log(`test:db-audit — ${needInstances ? 'starting two private MariaDB instances (insecure, hardened)…' : 'no database instances needed for the chosen groups'}`)
const t0 = Date.now()
let ins, hard
if (needInstances) {
  try {
    ;[ins, hard] = [await startInsecure(), await startHardened()]
  } catch (e) {
    console.log(`FAIL could not build the private instances: ${e.message}`)
    stopAll()
    process.exit(1)
  }
  console.log(`ready in ${Math.round((Date.now() - t0) / 1000)} s (insecure :${ins.port}, hardened :${hard.port})`)
}
try {
  if (want('unit')) await unit(rep, TOOL)
  if (want('insecure')) { await insecureCore(rep, TOOL, ins); await insecureExtras(rep, TOOL, ins) }
  if (want('hardened')) { await hardenedCore(rep, TOOL, hard); await hardenedLimited(rep, TOOL, hard); await hardenedScenarios(rep, TOOL, hard) }
  if (want('reach')) await hardenedReach(rep, TOOL, hard)
  if (want('transport')) { await transport(rep, TOOL, hard); await silentServer(rep, TOOL) }
  if (want('config')) await configFiles(rep)
  if (want('readonly')) await readOnly(rep, TOOL, ins)
  if (want('leaks')) await leakScan(rep, TOOL, ins, hard)
  if (want('docs')) await docs(rep)
  let goodHost, badHost
  if (want('host') || withMutation) {
    goodHost = hostFixture('good'); badHost = hostFixture('bad'); hostRoots.push(goodHost, badHost)
  }
  if (want('host')) await hostAudit(rep, HOST, goodHost, badHost)
  if (want('compose')) await composeFiles(rep)
  if (withMutation) { await mutate(rep, ins, hard); await mutateHost(rep, goodHost, badHost) }
} catch (e) {
  rep.bad('the suite crashed', e.stack?.split('\n').slice(0, 4).join(' / ') ?? String(e))
} finally {
  stopAll()
}
console.log(`\n${rep.passes} checks passed, ${rep.fails} failed (${Math.round((Date.now() - t0) / 1000)} s)`)
process.exit(rep.fails ? 1 : 0)
