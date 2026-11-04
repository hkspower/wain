#!/usr/bin/env node
// verify-accounts.mjs — signs in AS each account and proves, from the outside, that
// it can do what grants.sql says and nothing else. It changes no row.
//
//   node ops/db/verify-accounts.mjs --db sporta --host <db host> [--port 3306] \
//        --secrets <dir with the <account>.pass files> [--accounts web,knet,tpay,ro,migrate]
//
// Run it after grants.sql is applied and BEFORE any config file is switched to
// a new account (ops/db/README.md, step 4): it is the "does the new account
// work" check that needs no customer, no order and no payment.
//
// WHY IT CHANGES NOTHING. (TRUNCATE, CREATE TRIGGER, CREATE VIEW, CREATE DATABASE and
// CREATE USER are deliberately NOT probed: allowed by mistake, they would act. DROP ... IF
// EXISTS <absent name> checks the same privileges and cannot. GRANT is probed as a REVOKE from an absent
// account, for the same reason.) Every data probe is shaped so that it matches zero
// rows even when the account IS allowed, and the server checks the privilege
// before it looks at any row:
//     SELECT * FROM t WHERE 1=0                  UPDATE t SET c = c WHERE 1=0
//     INSERT INTO t (c) SELECT NULL WHERE 1=0    DELETE FROM t WHERE 1=0
// The structural probes are the same: CREATE TABLE IF NOT EXISTS <an existing
// table>, ALTER TABLE ... ADD COLUMN IF NOT EXISTS <an existing column>, DROP
// TABLE IF EXISTS <a name that does not exist>, SET GLOBAL x = x. If an account
// is wrongly allowed one of them, the probe is a no-op and the report says
// FAIL; nothing is created, altered or dropped either way.
//
// WHAT IT NEEDS: the `mariadb` command-line client, grants.sql (it reads the
// expected privileges from it, so the file and the check cannot disagree) and
// the 0600 password files render-grants.mjs wrote. It prints no password.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from './accounts.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PERMISSION = new Set([1044, 1045, 1142, 1143, 1227, 1370, 1095, 1290])

/** account key -> { db:Set, tables:{t:{kinds:Set, cols:Set}} } read from grants.sql */
export function expectedFromGrants(text = readFileSync(join(HERE, 'grants.sql'), 'utf8')) {
  const byUser = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, a]) => [a.user, { key: k, db: new Set(), tables: {} }]))
  const all = new Set()
  for (const line of text.split('\n')) {
    const m = line.match(/^GRANT (.+) ON `@@DB@@`\.(`([a-z_0-9]+)`|\*) TO '([a-z_]+)'@/)
    if (!m || !byUser[m[4]]) continue
    const [, privs, , table, user] = m
    if (!table) { for (const p of privs.split(',')) byUser[user].db.add(p.trim()); continue }
    all.add(table)
    const t = (byUser[user].tables[table] ??= { kinds: new Set(), cols: new Set() })
    const cm = privs.match(/^UPDATE \(([^)]*)\)$/)
    if (cm) for (const c of cm[1].split(',')) t.cols.add(c.trim())
    else for (const p of privs.split(',')) t.kinds.add(p.trim())
  }
  return { byUser, tables: [...all].sort() }
}

function cli({ host, port, user, pw, db }, input, extra = []) {
  return new Promise((resolve) => {
    const p = spawn(process.env.MARIADB_BIN || 'mariadb', ['--no-defaults', `-h${host}`, `-P${port}`, `-u${user}`, '--batch', '--silent', '--force', '--default-character-set=utf8mb4', ...extra, db],
      { env: { ...process.env, MYSQL_PWD: pw } })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => resolve({ out: '', err: String(e.message), code: -1 }))
    p.on('close', (code) => resolve({ out, err, code }))
    p.stdin.on('error', () => { /* client exited first */ })
    p.stdin.end(input)
  })
}

export async function verifyAccount({ db, host, port, key, pw, expected, tables }) {
  const a = ACCOUNTS[key]
  const exp = expected.byUser[a.user]
  const conn = { host, port, user: a.user, pw, db }
  const results = []
  const add = (name, ok, detail = '') => results.push({ name, ok, detail })

  const first = await cli(conn, 'select 1')
  if (first.code !== 0) { add('signs in', false, (first.err.match(/ERROR (\d+)[^\n]*/) ?? [first.err.split('\n')[0]])[0].slice(0, 90)); return results }
  add('signs in', true)

  // no global power, no GRANT OPTION, only the database-wide privileges grants.sql names
  const sg = await cli(conn, 'show grants')
  const lines = sg.out.split('\n').filter(Boolean)
  const globalPower = lines.filter((l) => /ON \*\.\*/.test(l) && !/^GRANT USAGE ON/.test(l))
  add('has no global privilege (only USAGE)', globalPower.length === 0, globalPower[0]?.slice(0, 90))
  add('has no GRANT OPTION anywhere', !lines.some((l) => /WITH GRANT OPTION/.test(l)))
  const dbWide = new Set()
  for (const l of lines) { const m = l.match(/^GRANT (.+) ON `[^`]+`\.\* TO/); if (m) for (const p of m[1].split(',')) dbWide.add(p.trim()) }
  add('database-wide privileges are exactly the expected ones', [...dbWide].sort().join() === [...exp.db].sort().join(), `[${[...dbWide].sort().join(',')}] expected [${[...exp.db].sort().join(',')}]`)

  // what it can see: only the tables it is granted (the old-build tables stay invisible), or everything for the read-only account
  const seen = (await cli(conn, `select table_name from information_schema.tables where table_schema = '${db}'`)).out.split('\n').filter(Boolean).sort()
  const granted = Object.keys(exp.tables).sort()
  if (a.special === 'readonly') add('sees every table, including the old build\'s', seen.length >= tables.length, `${seen.length} tables`)
  else if (a.special === 'migrate') add('sees every table (its database-wide CREATE/ALTER/INDEX make them visible) but is granted data access to the repo tables only', granted.every((t) => seen.includes(t)), `${seen.length} visible, ${granted.length} granted`)
  else add('sees exactly the tables it is granted, none of the old build\'s', seen.join() === granted.join(), seen.filter((t) => !granted.includes(t)).slice(0, 3).join(',') || `${seen.length} tables`)

  // first column of every table it can see (for the probes' column lists)
  const colRows = (await cli(conn, `select table_name, column_name from information_schema.columns where table_schema = '${db}' order by table_name, ordinal_position`)).out.split('\n').filter(Boolean).map((l) => l.split('\t'))
  const cols = {}
  for (const [t, c] of colRows) (cols[t] ??= []).push(c)

  // build the probe list: [expect 'allow'|'deny', label, sql]
  const probes = []
  const q = (n) => '`' + n + '`'
  const probe = (expect, label, sql) => probes.push({ expect, label, sql })
  for (const t of tables) {
    const e = exp.tables[t]
    const hasDbSelect = exp.db.has('SELECT')
    const c1 = cols[t]?.[0] ?? 'id'
    const canSelect = hasDbSelect || e?.kinds.has('SELECT')
    probe(canSelect ? 'allow' : 'deny', `SELECT ${t}`, `select * from ${q(t)} where 1=0`)
    // every column in the list: with a partial list a NOT NULL column without a default is error 1364 even for zero rows
    const all = (cols[t] ?? [c1]).map(q)
    probe(e?.kinds.has('INSERT') ? 'allow' : 'deny', `INSERT ${t}`, `insert into ${q(t)} (${all.join(', ')}) select ${all.map(() => 'null').join(', ')} where 1=0`)
    probe(e?.kinds.has('DELETE') ? 'allow' : 'deny', `DELETE ${t}`, `delete from ${q(t)} where 1=0`)
    // The code takes row locks with SELECT ... FOR UPDATE (orders, product_variants, fulfilment_outbox, ...). MariaDB asks for SELECT
    // only (measured on 10.11), but MySQL 8 also wants UPDATE, DELETE or LOCK TABLES. So the server this is run against says whether a
    // WRITER account (one that has some INSERT / DELETE / UPDATE on the table) may lock rows: a surprise here is an outage on the first
    // cron run, and this finds it before any config is switched. Zero rows, no lock is taken.
    if (a.special !== 'readonly' && a.special !== 'migrate' && canSelect && (e?.kinds.has('INSERT') || e?.kinds.has('DELETE') || e?.kinds.has('UPDATE') || e?.cols.size)) {
      probe('allow', `SELECT ... FOR UPDATE ${t}`, `select * from ${q(t)} where 1=0 for update`)
    }
    if (e?.kinds.has('UPDATE')) probe('allow', `UPDATE ${t} (table-wide)`, `update ${q(t)} set ${q(c1)} = ${q(c1)} where 1=0`)
    else if (e?.cols.size) {
      for (const c of e.cols) probe('allow', `UPDATE ${t}.${c}`, `update ${q(t)} set ${q(c)} = ${q(c)} where 1=0`)
      const other = (cols[t] ?? []).filter((c) => !e.cols.has(c))
      for (const c of [other[0], other.includes('amount') ? 'amount' : null].filter(Boolean)) probe('deny', `UPDATE ${t}.${c} (not granted)`, `update ${q(t)} set ${q(c)} = ${q(c)} where 1=0`)
    } else probe('deny', `UPDATE ${t}`, `update ${q(t)} set ${q(c1)} = ${q(c1)} where 1=0`)
  }
  const t0 = tables.includes('orders') ? 'orders' : tables[0]
  const c0 = cols[t0]?.[0] ?? 'id'
  const migrate = a.special === 'migrate'
  probe(migrate ? 'allow' : 'deny', 'CREATE TABLE', `create table if not exists ${q(t0)} (a int)`)
  probe(migrate ? 'allow' : 'deny', 'ALTER TABLE', `alter table ${q(t0)} add column if not exists ${q(c0)} bigint`)
  // every one of these is a no-op when the account IS allowed (the thing it names does not exist, or already does)
  probe('deny', 'DROP TABLE', 'drop table if exists sporta_verify_absent')
  probe('deny', 'DROP VIEW', 'drop view if exists sporta_verify_absent')
  probe('deny', 'DROP DATABASE', 'drop database if exists sporta_verify_absent')
  probe('deny', 'CREATE USER (needs CREATE USER)', "drop user if exists 'sporta_verify_absent'@'localhost'")
  // REVOKE, not GRANT: both need GRANT OPTION, but a GRANT to an account that does not exist CREATES it, with no password, when the
  // granting account also has the global CREATE USER privilege and the server's sql_mode lacks NO_AUTO_CREATE_USER (measured; without
  // CREATE USER the server answers 1410). This tool must not add an account when it is run against the very fault it exists to find.
  // REVOKE cannot create anything: refused with 1142 without GRANT OPTION, answered 1141 ("no such grant") with it, which the report
  // shows as ALLOWED.
  probe('deny', 'GRANT (needs GRANT OPTION)', `revoke select on ${q(db)}.${q(t0)} from 'sporta_verify_absent'@'localhost'`)
  probe('deny', 'SELECT mysql.user', 'select 1 from mysql.user where 1=0')
  probe('deny', 'INTO OUTFILE (needs FILE)', "select 1 into outfile '/nonexistent-dir/sporta-verify'")
  probe('deny', 'SET GLOBAL', 'set global max_connections = @@global.max_connections')
  probe('deny', 'LOCK TABLES', `lock tables ${q(t0)} read`)
  probe('deny', 'CREATE TEMPORARY TABLE', 'create temporary table sporta_verify_tmp (a int)')

  // one session, one statement per line, --force: line N of the errors is probe N
  const run = await cli(conn, `${probes.map((p) => `${p.sql};`).join('\n')}\n`)
  const errAt = {}
  for (const m of run.err.matchAll(/ERROR (\d+) \([^)]*\) at line (\d+)/g)) errAt[Number(m[2])] = Number(m[1])
  // the client counts a statement at the line where it ENDS; ours are one per line
  probes.forEach((p, i) => {
    const code = errAt[i + 1] ?? 0
    if (p.expect === 'allow') add(`may ${p.label}`, code === 0, code ? `error ${code}` : '')
    else add(`may NOT ${p.label}`, PERMISSION.has(code), code ? `error ${code}` : 'it was ALLOWED')
  })
  return results
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  const db = arg('--db', 'sporta'), host = arg('--host'), port = arg('--port', '3306'), dir = arg('--secrets')
  const want = (arg('--accounts') ?? 'web,knet,tpay,ro,migrate').split(',').map((s) => s.trim()).filter(Boolean)
  if (!host || !dir) { console.error('verify-accounts: --host and --secrets are required'); process.exit(2) }
  if (!/^[A-Za-z0-9_]{1,64}$/.test(db)) { console.error('verify-accounts: bad --db'); process.exit(2) }
  const expected = expectedFromGrants()
  let bad = 0
  for (const key of want) {
    const a = ACCOUNTS[key]
    if (!a) { console.error(`verify-accounts: unknown account ${key}`); process.exit(2) }
    const f = join(dir, `${a.user}.pass`)
    if (!existsSync(f)) { console.log(`FAIL ${a.user}: no password file`); bad++; continue }
    const res = await verifyAccount({ db, host, port, key, pw: readFileSync(f, 'utf8').replace(/\r?\n$/, ''), expected, tables: expected.tables })
    const failed = res.filter((r) => !r.ok)
    console.log(`${failed.length ? 'FAIL' : 'ok  '} ${a.user}: ${res.length - failed.length} of ${res.length} checks`)
    for (const f2 of failed.slice(0, 12)) console.log(`       ${f2.name}${f2.detail ? ` — ${f2.detail}` : ''}`)
    bad += failed.length
  }
  process.exit(bad ? 1 : 0)
}
