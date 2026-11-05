// APPLY ONE MIGRATION TO THE LIVE DATABASE: abandoned.mysql.sql, and nothing else.
//
//   node scripts/db-apply-abandoned.mjs --config /run/sporta-api-config.php            (plan: read-only)
//   node scripts/db-apply-abandoned.mjs --config /run/sporta-api-config.php --apply    (creates the table)
//
// WHY THIS EXISTS. The live database lacks abandoned_followup, which abandoned.php uses without a check, so the
// Abandoned orders screen cannot work until it exists. The owner approved applying exactly this one additive file
// before the deploy (2026-11-05). This script is the only write path for it: it refuses every other file, it
// checks the table is absent before it writes, and it is idempotent (the statement is CREATE TABLE IF NOT EXISTS).
//
// WHAT IT TOUCHES. One new table, abandoned_followup, with a foreign key to orders(id). No existing table, column,
// row or index is read for writing or changed. Nothing is deleted. So there is nothing to back up beforehand: the
// only effect is one empty table, and it can be removed with DROP TABLE abandoned_followup if ever needed.
//
// CREDENTIALS. Read the same way the schema job reads them (the api config file, or the three secret files the job
// mounts). A password is never printed; every error message is scrubbed of it.
//
// It runs with NO dependencies (the MySQL text client in db-schema-live-diff.mjs) so it works in a bare node:24-alpine
// job, like the schema job does.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MySQL, credentials, scrub, splitStatements } from './db-schema-live-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MIGRATION = 'abandoned.mysql.sql'
export const MIGRATION_PATH = resolve(HERE, '..', 'dropin', 'php-store', MIGRATION)
export const TABLE = 'abandoned_followup'

// The one statement this may send. Anything else in the file is a refusal, not a silent skip.
export function migrationStatements(text) {
  const stmts = splitStatements(text).map((s) => s.text.trim()).filter(Boolean)
  if (stmts.length !== 1) throw new Error(`refused: ${MIGRATION} must hold exactly one statement, found ${stmts.length}`)
  const s = stmts[0]
  if (!/^create\s+table\s+if\s+not\s+exists\s+abandoned_followup\b/i.test(s)) {
    throw new Error(`refused: the statement is not CREATE TABLE IF NOT EXISTS ${TABLE}`)
  }
  // "on delete cascade" is part of the foreign key, not a write: it is taken out before the check.
  const bare = s.replace(/on\s+delete\s+cascade/ig, ' ')
  if (/\b(drop|alter|truncate|delete|insert|update|replace|rename)\b/i.test(bare)) {
    throw new Error('refused: the statement contains a write other than the CREATE TABLE')
  }
  return [s]
}

async function tableExists(conn) {
  const r = await conn.query(`select count(*) from information_schema.tables where table_schema = database() and table_name = '${TABLE}'`)
  return Number(r.rows[0][0]) === 1
}

async function main(argv) {
  const args = { config: null, apply: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i]
    else if (argv[i] === '--apply') args.apply = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  const sql = migrationStatements(readFileSync(MIGRATION_PATH, 'utf8'))
  const creds = credentials({ config: args.config })
  const conn = new MySQL(creds)
  const secrets = [creds.password]
  try {
    await conn.connect()
    const present = await tableExists(conn)
    console.log(`database: ${creds.database}; ${TABLE}: ${present ? 'already present' : 'absent'}`)
    if (present) { console.log('nothing to do'); return 0 }
    if (!args.apply) { console.log(`plan: run 1 statement from ${MIGRATION} (CREATE TABLE ${TABLE}). Re-run with --apply to do it.`); return 0 }
    await conn.query(sql[0])
    const after = await tableExists(conn)
    if (!after) { console.error(`FAILED: ${TABLE} is still absent after the statement`); return 1 }
    console.log(`APPLIED: ${TABLE} created from ${MIGRATION}`)
    return 0
  } catch (e) {
    console.error(`FAILED: ${scrub(e.message, secrets)}`)
    return 1
  } finally {
    try { conn.end() } catch { /* closed */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => { console.error(`FAILED: ${e.message}`); process.exitCode = 1 })
}
