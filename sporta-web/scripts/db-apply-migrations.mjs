#!/usr/bin/env node
// APPLY THE TWO PENDING LIVE MIGRATIONS: customers.mysql.sql, then refunds.mysql.sql, and nothing else.
//
//   node scripts/db-apply-migrations.mjs --config /run/sporta-api-config.php                              (plan: read-only)
//   node scripts/db-apply-migrations.mjs --config /run/sporta-api-config.php --apply --backup-dir DIR      (backup, apply, verify)
//
// WHY THIS EXISTS. The read-only live schema diff of 2026-11-18 (SCHEMA_DIFF_EXIT=1) found the live database without these two files'
// objects: `order_refunds`, `payment_alerts`, `orders.refunded_amount`, `orders.gateway_attempt_ref`, the widened
// `orders_payment_status_ck`, `customer_email_verifications`, `customer_accounts.apple_sub` (+ its unique index) and `email_verified_at`.
// The owner said "apply the two migrations" the same day. Both files are additive and idempotent (every statement is IF NOT EXISTS or a
// DROP ... IF EXISTS followed by its ADD), and the repo suites prove running them twice changes nothing. This is the only write path for
// them: it reads the two files from the repo, REFUSES any statement that is not on the short allow-list below, and does not run
// anything else.
//
// WHAT IT TOUCHES. New tables (order_refunds, payment_alerts, customer_email_verifications), new nullable / defaulted columns on
// `orders` and `customer_accounts`, two new indexes, and the CHECK on orders.payment_status, whose list only GROWS (the old values are
// all still allowed, so no existing row can fail it). No row is read for writing, changed or deleted.
//
// BEFORE THE FIRST WRITE (apply only): the pre-flight must pass (the tables the new foreign keys point at exist and their id columns
// have the same type), then `orders` and `customer_accounts` are copied, whole, to --backup-dir as JSON (mode 0600, directory 0700) with
// their CREATE TABLE text, and the copy is READ BACK and its row counts compared with the table. A backup that does not read back
// stops the run before any statement. The files hold e-mail addresses and password hashes: nothing in them is ever printed.
//
// AFTER: every object is looked up again, row counts must equal the pre-flight counts, and the run ends with MIGRATIONS_OK or
// MIGRATIONS_FAIL. A statement that was already applied is skipped, so a half-finished run is finished by running it again.
//
// UNDO (only if ever needed; nothing reads these objects until the matching PHP is deployed):
//   drop table payment_alerts, order_refunds, customer_email_verifications;
//   alter table orders drop column refunded_amount, drop column gateway_attempt_ref;
//   alter table customer_accounts drop index uq_customer_apple_sub, drop column apple_sub, drop column email_verified_at;
//   alter table orders drop constraint orders_payment_status_ck, add constraint orders_payment_status_ck check (payment_status in ('pending','paid','failed','review'));
// (the last one only while no order is 'refunded' or 'voided'); the backup directory holds the two tables as they were.
//
// It runs with NO dependencies (the MySQL text client of db-schema-live-diff.mjs), so it works in a bare node:24-alpine job.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MySQL, credentials, scrub, splitStatements } from './db-schema-live-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DIR = resolve(HERE, '..', 'dropin', 'php-store')
export const FILES = ['customers.mysql.sql', 'refunds.mysql.sql']
// The only constraints this may drop (each is re-added by the next statement of the same file).
const DROPPABLE = new Set(['orders_payment_status_ck', 'payment_alerts_gateway_ck'])
// What the final state of those two CHECKs must contain (the widened lists).
const FINAL_CHECK = { orders_payment_status_ck: 'voided', payment_alerts_gateway_ck: 'cbk' }
const BACKED_UP = ['orders', 'customer_accounts']
const MAX_ROWS = 200000

export class Refused extends Error {}

/** One statement -> what it is, or Refused. The allow-list is the whole safety of this tool. */
export function classify(text) {
  const s = text.replace(/\s+/g, ' ').trim()
  // a foreign key's own ON DELETE / ON UPDATE action is not a write
  const bare = s.replace(/on (delete|update) (cascade|set null|restrict|no action)/ig, ' ')
  if (/\b(truncate|delete\s+from|insert\s|update\s|replace\s|rename\s|grant\s|revoke\s|drop\s+(table|column|index|database|schema|primary|foreign|key|view|trigger|event|procedure|function)|alter\s+table\s+\S+\s+(modify|change|drop\s+column|drop\s+index|drop\s+primary|drop\s+foreign))\b/i.test(bare)) {
    throw new Refused(`refused: a write or a drop that is not on the allow-list: ${s.slice(0, 80)}`)
  }
  let m
  if ((m = /^create table if not exists `?(\w+)`? \(/i.exec(s))) return { kind: 'table', table: m[1], label: `create table ${m[1]}` }
  if ((m = /^alter table `?(\w+)`? add column if not exists `?(\w+)`? /i.exec(s))) return { kind: 'column', table: m[1], column: m[2], label: `add column ${m[1]}.${m[2]}` }
  if ((m = /^alter table `?(\w+)`? drop constraint if exists `?(\w+)`?$/i.exec(s))) {
    if (!DROPPABLE.has(m[2])) throw new Refused(`refused: drop constraint ${m[2]} is not one this tool may drop`)
    return { kind: 'dropcheck', table: m[1], name: m[2], label: `drop constraint ${m[1]}.${m[2]} (re-added next)` }
  }
  if ((m = /^alter table `?(\w+)`? add constraint `?(\w+)`? check ?\(/i.exec(s))) return { kind: 'check', table: m[1], name: m[2], label: `add check ${m[1]}.${m[2]}` }
  if ((m = /^create (unique )?index if not exists `?(\w+)`? on `?(\w+)`? ?\(/i.exec(s))) return { kind: 'index', table: m[3], name: m[2], unique: !!m[1], label: `create ${m[1] ? 'unique ' : ''}index ${m[3]}.${m[2]}` }
  throw new Refused(`refused: not on the allow-list: ${s.slice(0, 80)}`)
}

/** The statements of the two files, in order, each classified. */
export function loadStatements(dir = DIR, files = FILES) {
  const out = []
  for (const f of files) {
    for (const st of splitStatements(readFileSync(join(dir, f), 'utf8'))) out.push({ file: f, line: st.line, text: st.text, c: classify(st.text) })
  }
  return out
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")
const baseType = (t) => String(t ?? '').toLowerCase().replace(/\(\d+\)/, '').replace(/\s+/g, ' ').trim()

/** Is the object a statement creates already there (in its FINAL state)? null for a drop. */
export async function present(q, c) {
  const one = async (sql) => (await q(sql)).rows
  switch (c.kind) {
    case 'table': return Number((await one(`select count(*) from information_schema.tables where table_schema = database() and table_name = '${esc(c.table)}'`))[0][0]) === 1
    case 'column': return Number((await one(`select count(*) from information_schema.columns where table_schema = database() and table_name = '${esc(c.table)}' and column_name = '${esc(c.column)}'`))[0][0]) === 1
    case 'index': return Number((await one(`select count(*) from information_schema.statistics where table_schema = database() and table_name = '${esc(c.table)}' and index_name = '${esc(c.name)}'`))[0][0]) >= 1
    case 'check': {
      const r = await one(`select check_clause from information_schema.check_constraints where constraint_schema = database() and table_name = '${esc(c.table)}' and constraint_name = '${esc(c.name)}'`)
      if (!r.length) return false
      const need = FINAL_CHECK[c.name]
      return need ? String(r[0][0]).toLowerCase().includes(need) : true
    }
    case 'dropcheck': return null
    default: return null
  }
}

/** What must be true before anything is written. Returns { problems: [], counts: {}, version }. */
export async function preflight(q) {
  const problems = []
  const rows = async (sql) => (await q(sql)).rows
  const type = async (table, col) => (await rows(`select column_type from information_schema.columns where table_schema = database() and table_name = '${table}' and column_name = '${col}'`))[0]?.[0]
  const need = [['orders', 'id', 'int unsigned'], ['admin_users', 'id', 'int unsigned'], ['customer_accounts', 'id', 'bigint unsigned']]
  for (const [t, c, want] of need) {
    const got = await type(t, c)
    if (got === undefined) problems.push(`${t}.${c} does not exist`)
    else if (baseType(got) !== want) problems.push(`${t}.${c} is ${got}, the new foreign keys need ${want}`)
  }
  for (const [t, c] of [['orders', 'amount'], ['orders', 'pay_attempt'], ['orders', 'payment_status']]) {
    if ((await type(t, c)) === undefined) problems.push(`${t}.${c} does not exist (a new column is placed after it)`)
  }
  const counts = {}
  for (const t of BACKED_UP) {
    try { counts[t] = Number((await rows(`select count(*) from \`${t}\``))[0][0]) } catch (e) { problems.push(`cannot count ${t}: ${e.message}`) }
    if (counts[t] > MAX_ROWS) problems.push(`${t} has ${counts[t]} rows, more than the ${MAX_ROWS} this tool backs up as JSON`)
  }
  const version = (await rows('select version()'))[0][0]
  return { problems, counts, version }
}

/** Copy the two tables whole to DIR and read the copy back. Returns the manifest text. */
export async function backup(q, dir, counts) {
  if (existsSync(dir)) throw new Error(`refused: ${dir} already exists (a backup is never written over)`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lines = [`pre-migration copy of ${BACKED_UP.join(', ')}; written by scripts/db-apply-migrations.mjs`]
  let schema = ''
  for (const t of BACKED_UP) {
    const { columns, rows } = await q(`select * from \`${t}\``)
    const body = JSON.stringify({ table: t, columns, rows })
    const file = join(dir, `${t}.json`)
    writeFileSync(file, body, { mode: 0o600 })
    const back = JSON.parse(readFileSync(file, 'utf8'))
    if (back.rows.length !== counts[t] || rows.length !== counts[t]) throw new Error(`the copy of ${t} does not match the table (${back.rows.length} rows read back, ${counts[t]} counted)`)
    lines.push(`${t}.json  ${back.rows.length} rows  sha256 ${createHash('sha256').update(body).digest('hex')}`)
    schema += `-- ${t}\n${(await q(`show create table \`${t}\``)).rows[0][1]}\n\n`
  }
  schema += `-- orders checks\n${(await q(`select constraint_name, check_clause from information_schema.check_constraints where constraint_schema = database() and table_name = 'orders'`)).rows.map((r) => r.join(' : ')).join('\n')}\n`
  writeFileSync(join(dir, 'schema.txt'), schema, { mode: 0o600 })
  const manifest = lines.join('\n') + '\n'
  writeFileSync(join(dir, 'MANIFEST.txt'), manifest, { mode: 0o600 })
  return manifest
}

export async function run(q, { apply = false, backupDir = null, log = console.log } = {}) {
  const items = loadStatements()
  const pre = await preflight(q)
  log(`database: ${pre.version}; orders ${pre.counts.orders ?? '?'} rows, customer_accounts ${pre.counts.customer_accounts ?? '?'} rows`)
  if (pre.problems.length) { for (const p of pre.problems) log(`PREFLIGHT FAIL ${p}`); return { ok: false, reason: 'preflight' } }
  log('preflight ok: the id columns the new foreign keys point at have the right types')

  // what is there already, statement by statement (the drop of a CHECK follows its re-add)
  const state = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.c.kind === 'dropcheck') {
      const add = items.slice(i + 1).find((x) => x.c.kind === 'check' && x.c.name === it.c.name && x.file === it.file)
      state.push(add ? await present(q, add.c) : false)
    } else state.push(await present(q, it.c))
  }
  const todo = state.filter((s) => !s).length
  items.forEach((it, i) => log(`${state[i] ? 'there ' : 'TODO  '} ${it.file}:${it.line}  ${it.c.label}`))
  log(`${todo} of ${items.length} statements still to apply`)
  if (!apply) { log('PLAN ONLY: nothing was changed. Re-run with --apply --backup-dir DIR to back up, apply and verify.'); return { ok: true, plan: true, todo } }
  if (todo === 0) { log('nothing to do'); return { ok: true, todo: 0 } }
  if (!backupDir) { log('refused: --apply needs --backup-dir'); return { ok: false, reason: 'no backup dir' } }

  log(`backup: ${backupDir}`)
  const manifest = await backup(q, backupDir, pre.counts)
  for (const l of manifest.trim().split('\n').slice(1)) log(`  ${l}`)

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    // the state is read again NOW: an earlier statement of this run may have made a later one unnecessary
    const already = it.c.kind === 'dropcheck'
      ? await (async () => { const add = items.slice(i + 1).find((x) => x.c.kind === 'check' && x.c.name === it.c.name && x.file === it.file); return add ? await present(q, add.c) : false })()
      : await present(q, it.c)
    if (already) { log(`skip  ${it.file}:${it.line}  ${it.c.label}`); continue }
    try { await q(it.text) } catch (e) { log(`FAIL  ${it.file}:${it.line}  ${it.c.label}: ${e.message}`); return { ok: false, reason: 'statement', at: `${it.file}:${it.line}` } }
    log(`ok    ${it.file}:${it.line}  ${it.c.label}`)
  }

  // verify
  const bad = []
  for (const it of items) if (it.c.kind !== 'dropcheck' && !(await present(q, it.c))) bad.push(`${it.file}:${it.line} ${it.c.label} is missing`)
  const after = await preflight(q)
  for (const t of BACKED_UP) if (after.counts[t] !== pre.counts[t]) bad.push(`${t} had ${pre.counts[t]} rows and has ${after.counts[t]}`)
  if (bad.length) { for (const b of bad) log(`VERIFY FAIL ${b}`); return { ok: false, reason: 'verify' } }
  log(`verified: ${items.filter((i) => i.c.kind !== 'dropcheck').length} objects present, row counts unchanged (orders ${after.counts.orders}, customer_accounts ${after.counts.customer_accounts})`)
  return { ok: true, applied: todo }
}

async function main(argv) {
  const args = { config: null, apply: false, backupDir: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i]
    else if (argv[i] === '--apply') args.apply = true
    else if (argv[i] === '--backup-dir') args.backupDir = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  loadStatements() // refuses before any connection if a statement is off the list
  const creds = credentials({ config: args.config })
  const conn = new MySQL(creds)
  const secrets = [creds.password]
  try {
    await conn.connect()
    if (!args.apply) await conn.query('set session transaction read only')
    const r = await run((sql) => conn.query(sql), { apply: args.apply, backupDir: args.backupDir, log: (l) => console.log(scrub(l, secrets)) })
    console.log(r.ok ? (r.plan ? 'PLAN_OK' : 'MIGRATIONS_OK') : `MIGRATIONS_FAIL (${r.reason}${r.at ? ' at ' + r.at : ''})`)
    return r.ok ? 0 : 1
  } catch (e) {
    console.log(`MIGRATIONS_FAIL ${scrub(e.message, secrets)}`)
    return 1
  } finally { try { conn.end() } catch { /* closed */ } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => { console.log(`MIGRATIONS_FAIL ${e.message}`); process.exitCode = 1 })
}
