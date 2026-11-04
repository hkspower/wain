#!/usr/bin/env node
// make-grants.mjs — builds ops/db/grants.sql from the CODE, not from memory.
//
//   node ops/db/make-grants.mjs            rewrite ops/db/grants.sql
//   node ops/db/make-grants.mjs --check    exit 1 when grants.sql is not what the code asks for
//
// WHY A GENERATOR. A grant list written by hand is true on the day it is
// written. This one is derived: scripts/lib/php-sql-map.php reads every SQL
// string in dropin/php-store, php-knet and php-cbk with PHP's own tokenizer,
// scripts/lib/sql-privileges.mjs turns the strings reachable from each entry
// point into "table -> privilege" (UPDATE down to the column), and this file
// maps entry points to database accounts and prints the GRANTs. When a PHP
// change adds a table or a write, `npm run test:db-least-privilege` goes red
// until grants.sql is regenerated and the new privilege is read by a person.
//
// NOTHING HERE CONNECTS TO A DATABASE. It reads source files and writes text.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, mergePrivs, programPrivileges, schemaTables } from '../../scripts/lib/sql-privileges.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB = join(HERE, '..', '..')
export const DROPIN = join(WEB, 'dropin')
export const OUT = join(HERE, 'grants.sql')

// ------------------------------------------------------------------ the model
// Entry points -> the account that runs them. A file that is not listed is a
// library (included by an entry point) and is reached through its callers.
export const ENTRY = {
  // The storefront and everything a stranger can reach: catalogue, checkout,
  // order status, customer accounts, returns, support, the assistant, SEO pages.
  shop: ['api', 'customer', 'birthday', 'seo-page', 'sitemap-index', 'sitemap-products'].map((e) => `php-store/${e}.php`),
  // The /backends API and its two satellites. setup-admin.php is NOT here: it
  // creates the first admin and is a one-time installer (see `migrate`).
  admin: ['admin', 'admin-google', 'preflight'].map((e) => `php-store/${e}.php`),
  // docker exec ... php cron-*.php (and the same files over HTTP with the key).
  cron: ['cron-stock', 'cron-fulfilment', 'cron-voice', 'cron-birthday', 'cron-whatsapp'].map((e) => `php-store/${e}.php`),
  knet: ['php-knet/pay.php', 'php-knet/callback.php'],
  tpay: ['php-cbk/pay.php', 'php-cbk/callback.php'],
}
// Files each gateway loads: its own, the store core it requires for the
// fulfilment queue (callback.php require_once's api/store.php at run time, a
// path the tokenizer cannot see), and the shared config-path.php rate limiter.
const GATEWAY_FILES = {
  knet: ['php-knet/pay.php', 'php-knet/callback.php', 'php-knet/knet.php', 'php-store/store.php', 'php-store/seo-config.php', 'php-store/config-path.php'],
  tpay: ['php-cbk/pay.php', 'php-cbk/callback.php', 'php-cbk/cbk.php', 'php-store/store.php', 'php-store/seo-config.php', 'php-store/config-path.php'],
}
const GATEWAY_EXTRA_CALLS = ['store_queue_fulfilment']

import { ACCOUNTS, MIGRATE_DB_PRIVS, RO_DB_PRIVS, TABLE_WIDE_UPDATE } from './accounts.mjs'
export { ACCOUNTS, MIGRATE_DB_PRIVS, RO_DB_PRIVS, TABLE_WIDE_UPDATE }

// ------------------------------------------------------------- the derivation
export function phpMap(dropin = DROPIN) {
  const files = [
    ...['php-store', 'php-knet', 'php-cbk'].flatMap((d) =>
      execFileSync('ls', [join(dropin, d)], { encoding: 'utf8' }).split('\n')
        .filter((f) => f.endsWith('.php') && !/^config(\.example)?\.php$/.test(f) && f !== 'selftest.php' && f !== 'setup-config.php')
        .map((f) => join(dropin, d, f))),
  ]
  return JSON.parse(execFileSync('php', [join(WEB, 'scripts/lib/php-sql-map.php'), ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
}
export function repoTables() {
  return schemaTables([join(DROPIN, 'php-store')])
}

/** requirements: role -> { table -> {select, insert, delete, update:Set} } and why. */
export function codeRoles(map = phpMap(), tables = repoTables()) {
  const storeFiles = Object.keys(map).filter((k) => k.startsWith('php-store/'))
  const roles = {}
  const why = {}
  for (const role of ['shop', 'admin', 'cron']) {
    roles[role] = {}; why[role] = {}
    for (const entry of ENTRY[role]) {
      const r = programPrivileges(map, entry, tables, { files: storeFiles })
      mergePrivs(roles[role], r.privs)
      for (const [k, v] of Object.entries(r.why)) why[role][k] ??= v
    }
  }
  for (const role of ['knet', 'tpay']) {
    roles[role] = {}; why[role] = {}
    for (const entry of ENTRY[role]) {
      const r = programPrivileges(map, entry, tables, { files: GATEWAY_FILES[role], extraCalls: GATEWAY_EXTRA_CALLS })
      mergePrivs(roles[role], r.privs)
      for (const [k, v] of Object.entries(r.why)) why[role][k] ??= v
    }
  }
  return { roles, why, storeFiles }
}

/**
 * What the migrations themselves write: every *.mysql.sql beside the code (and
 * the birthday one in sporta-live) read statement by statement, plus
 * setup-admin.php (the one-time first-admin page). DDL is covered by the
 * database-wide CREATE/ALTER/INDEX; this is the DML. A migration that starts to
 * UPDATE or INSERT a table it did not before changes this list, and the suite
 * runs every migration as the migration account to prove it is enough.
 */
export function migrationDml(map = phpMap(), tables = repoTables()) {
  const out = {}
  const dirs = [join(DROPIN, 'php-store'), join(WEB, '..', 'sporta-live', 'birthday')]
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.mysql.sql') && n !== 'install.mysql.sql')) {
      const text = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const st of text.split(/;\s*\n/)) {
        const c = classify(st.trim(), tables)
        if (c) mergePrivs(out, c.privs)
      }
    }
  }
  const setup = programPrivileges(map, 'php-store/setup-admin.php', tables, { files: Object.keys(map).filter((k) => k.startsWith('php-store/')) })
  mergePrivs(out, setup.privs)
  return out
}

/** account -> { table -> {select, insert, delete, update:Set} } */
export function accountNeeds(code = codeRoles(), tables = repoTables(), map = undefined) {
  const out = {}
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    if (a.from) { out[key] = {}; for (const r of a.from) mergePrivs(out[key], code.roles[r]) }
    else if (a.special === 'readonly') out[key] = {}
    else if (a.special === 'migrate') {
      // SELECT everywhere (a migration reads before it alters); INSERT and
      // UPDATE (table-wide) only where the migrations or setup-admin.php write.
      const dml = migrationDml(map ?? phpMap(), tables)
      out[key] = {}
      for (const t of tables) {
        out[key][t] = { select: true, insert: Boolean(dml[t]?.insert), delete: false, update: new Set(dml[t]?.update.size ? ['*'] : []), lock: false, show: false, forUpdate: false }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- the renderer
const q = (s) => '`' + s + '`'
const acct = (a) => `'${a.user}'@'@@${a.host === 'app' ? 'APP_HOST' : 'JOB_HOST'}@@'`

// "table: written by file#function, ..." — the functions (never line numbers,
// which move with every edit) that send the INSERT / UPDATE / DELETE.
function writers(key, table, code) {
  const a = ACCOUNTS[key]
  const seen = new Set()
  for (const r of a.from ?? []) {
    for (const [k, v] of Object.entries(code.why[r] ?? {})) {
      if (!k.startsWith(`${table}:`) || k.endsWith(':select') || k.endsWith(':forUpdate') || k.endsWith(':show')) continue
      seen.add(v.replace(/ \(fragment\)$/, '').replace(/ \(via .*\)$/, '').replace(/ line \d+/, '')
        .replace(/^php-(store|knet|cbk)\//, '').replace(/\.php#/, '#'))
    }
  }
  return [...seen].sort()
}

function grantLines(key, needs, code) {
  const a = ACCOUNTS[key]
  const who = acct(a)
  const lines = []
  if (a.special === 'readonly') {
    lines.push(`GRANT ${RO_DB_PRIVS.join(', ')} ON ${q('@@DB@@')}.* TO ${who};`)
    return lines
  }
  if (a.special === 'migrate') {
    lines.push(`GRANT ${MIGRATE_DB_PRIVS.join(', ')} ON ${q('@@DB@@')}.* TO ${who};`)
  }
  for (const table of Object.keys(needs).sort()) {
    const p = needs[table]
    const kinds = []
    if (p.select) kinds.push('SELECT')
    if (p.insert) kinds.push('INSERT')
    if (p.delete) kinds.push('DELETE')
    const wide = p.update.has('*') || (p.update.size > 0 && Boolean(TABLE_WIDE_UPDATE[table]))
    if (wide) kinds.push('UPDATE')
    const w = a.from ? writers(key, table, code) : []
    if (w.length) lines.push(`-- ${table}: written by ${w.join(', ')}`)
    if (kinds.length) lines.push(`GRANT ${kinds.join(', ')} ON ${q('@@DB@@')}.${q(table)} TO ${who};`)
    if (p.update.size && !wide) {
      lines.push(`GRANT UPDATE (${[...p.update].sort().join(', ')}) ON ${q('@@DB@@')}.${q(table)} TO ${who};`)
    }
  }
  return lines
}

export function buildGrantsSql({ needs = accountNeeds(), code = codeRoles() } = {}) {
  const out = []
  const P = (s = '') => out.push(s)
  P(`-- ===========================================================================`)
  P(`-- Sporta database accounts and privileges — GENERATED by ops/db/make-grants.mjs.`)
  P(`-- Do not edit by hand. Change the PHP or make-grants.mjs and regenerate;`)
  P(`-- \`npm run test:db-least-privilege\` fails when this file and the code disagree.`)
  P(`--`)
  P(`-- WHAT THIS IS. The web application used to connect with one broad account.`)
  P(`-- This file creates the narrow ones: each actor gets exactly the table and`)
  P(`-- column privileges the code can use, and none of: DROP, GRANT OPTION, FILE,`)
  P(`-- PROCESS, RELOAD, SUPER, LOCK TABLES, CREATE TEMPORARY TABLES, TRIGGER, EVENT,`)
  P(`-- EXECUTE, CREATE ROUTINE, CREATE VIEW — and, for every account but the`)
  P(`-- migration one, none of CREATE, ALTER or INDEX either. (The code sends no DDL,`)
  P(`-- no LOCK TABLES and no temporary tables; scripts/lib/php-sql-map.php lists`)
  P(`-- every statement.) The tables of the old storefront build, which no code here`)
  P(`-- reads, are granted to nobody except the read-only backup account.`)
  P(`--`)
  P(`-- HOW TO RUN IT. NEVER feed this file to the client as it is: it holds`)
  P(`-- placeholders (@@DB@@, @@APP_HOST@@, @@JOB_HOST@@, @@PASSWORD_<ACCOUNT>@@).`)
  P(`--   node ops/db/render-grants.mjs --db sporta --app-host <net> --job-host <net> \\`)
  P(`--        --secrets <dir> --generate | mariadb ...`)
  P(`-- fills them in, generates the passwords on the machine that runs it (0600 files,`)
  P(`-- never printed) and refuses a wildcard host. The guard just below makes the`)
  P(`-- client stop at once if this file is piped in unrendered. See ops/db/README.md.`)
  P(`--`)
  P(`-- IDEMPOTENT. CREATE USER IF NOT EXISTS leaves an existing account's password`)
  P(`-- and lock alone; every account is then REVOKEd ALL and re-GRANTed, so running`)
  P(`-- it again converges on exactly this file. (REVOKE then GRANT leaves a window of`)
  P(`-- a few milliseconds with no privileges: run a re-apply outside peak traffic.)`)
  P(`-- Accounts are created LOCKED. Nothing can sign in as one until a person`)
  P(`-- unlocks it (render-grants.mjs --activate ...), so an account that is never`)
  P(`-- used stays unusable.`)
  P(`-- ===========================================================================`)
  P()
  P(`-- Guard: stops here (error 1242) unless render-grants.mjs rendered this file.`)
  P(`SELECT IF(@sporta_rendered = 1, 1, (SELECT 1 UNION ALL SELECT 2)) AS render_grants_first;`)
  P()
  P(`-- ----------------------------------------------------------------- accounts`)
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    P(`-- ${a.user}: ${a.what}`)
    P(`CREATE USER IF NOT EXISTS ${acct(a)} IDENTIFIED BY '@@PASSWORD_${key.toUpperCase()}@@'`)
    P(`  WITH MAX_USER_CONNECTIONS ${a.maxConn} ACCOUNT LOCK;`)
  }
  P()
  P(`-- Anything an earlier run (or a person) granted is removed before the exact set`)
  P(`-- below is granted again.`)
  for (const a of Object.values(ACCOUNTS)) {
    P(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${acct(a)};`)
    P(`ALTER USER ${acct(a)} WITH MAX_USER_CONNECTIONS ${a.maxConn};`)
  }
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    P()
    P(`-- ${'-'.repeat(72)}`)
    P(`-- ${a.user}${a.tier === 2 ? '   (tier 2: needs the store_db() role patch, ops/db/php-roles.patch)' : ''}`)
    P(`-- ${a.what}`)
    if (a.from) P(`-- code roles: ${a.from.join(' + ')}`)
    if (a.special === 'readonly') {
      P(`-- SELECT and SHOW VIEW on the whole database, so a backup includes the old-build tables too.`)
      P(`-- No LOCK TABLES (use mariadb-dump --single-transaction), no TRIGGER, no EVENT, no PROCESS, no RELOAD.`)
    }
    if (a.special === 'migrate') {
      P(`-- CREATE/ALTER/INDEX on the database; SELECT on the repo tables; INSERT/UPDATE only where a`)
      P(`-- migration or setup-admin.php writes one. No DELETE, no DROP: the migrations are additive.`)
    }
    for (const line of grantLines(key, needs[key] ?? {}, code)) P(line)
  }
  P()
  P(`-- -------------------------------------------------------------- activation`)
  P(`-- render-grants.mjs --activate web,knet,tpay,ro appends ALTER USER ... ACCOUNT UNLOCK`)
  P(`-- for the accounts named, and only those.`)
  P(`FLUSH PRIVILEGES;`)
  P()
  return out.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = buildGrantsSql()
  if (process.argv.includes('--check')) {
    const cur = readFileSync(OUT, 'utf8')
    if (cur !== text) { console.error('ops/db/grants.sql is out of date: run node ops/db/make-grants.mjs'); process.exit(1) }
    console.log('ops/db/grants.sql is current')
  } else {
    writeFileSync(OUT, text)
    console.log(`wrote ${OUT} (${text.split('\n').length} lines)`)
  }
}
