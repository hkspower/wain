#!/usr/bin/env node
// EMAIL SCAN - the e-mail addresses of the shop's customer accounts and the admin accounts, read-only.
//
//   node scripts/email-scan.mjs            (credentials as the other live scans: --config, or the DB_* / secret-file settings)
//
// WHAT IT CHECKS: the shape of each address; spaces or capitals around it; the same address twice (any case); a domain that looks like a typo of a
// common mail provider (gmial.com, hotmial.com, ...); a customer address never verified (email_verified_at empty). WHAT IT PRINTS: counts, the
// domains in use (domain only), and for each flagged row its id and a MASKED address (two letters, then ***@domain). A full address is never printed.
//
// READ-ONLY: SELECT only, READ ONLY session (the same gate as the other live scans).
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'
import { pathToFileURL } from 'node:url'

const out = (s = '') => console.log(s)
const SHAPE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const TYPO = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmall.com': 'gmail.com', 'gmeil.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'yahho.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com' }

export function mask(addr) {
  const s = String(addr ?? ''), at = s.lastIndexOf('@')
  if (at < 1) return '(no @)'
  return s.slice(0, 2) + '***' + s.slice(at)
}

// Pure check of a list of rows { id, email, verified? } (verified: true | false | null for an admin row that has no verification).
export function checkEmails(rows) {
  const r = { total: rows.length, badShape: [], spaced: [], duplicates: [], typos: [], unverified: [], domains: {} }
  const seen = new Map()
  for (const row of rows) {
    const e = String(row.email ?? '')
    if (e !== e.trim()) r.spaced.push(row)
    const t = e.trim()
    if (!SHAPE.test(t)) { r.badShape.push(row); continue }
    const lower = t.toLowerCase()
    const domain = lower.slice(lower.lastIndexOf('@') + 1)
    r.domains[domain] = (r.domains[domain] || 0) + 1
    if (TYPO[domain]) r.typos.push({ ...row, suggest: TYPO[domain] })
    if (seen.has(lower)) r.duplicates.push(row); else seen.set(lower, row.id)
    if (row.verified === false) r.unverified.push(row)
  }
  return r
}

async function main() {
  let cred
  try { cred = credentials({}) } catch (e) { console.error('email-scan: ' + e.message); return 2 }
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error('email-scan: cannot connect: ' + scrub(e.message, secrets)); return 2 }
  const gate = new Gate(conn)
  try { await gate.readOnly() } catch (e) { console.error('email-scan: ' + scrub(e.message, secrets)); await gate.end(); return 2 }
  const cust = await gate.query(`select id, email, email_verified_at from customer_accounts order by id`).catch(() => gate.query(`select id, email from customer_accounts order by id`))
  const admins = await gate.query(`select id, email from admin_users order by id`).catch((e) => ({ error: e.message }))
  await gate.end()
  const cols = cust.columns
  const custRows = cust.rows.map((row) => { const o = Object.fromEntries(cols.map((c, i) => [c, row[i]])); return { id: o.id, email: o.email, verified: cols.includes('email_verified_at') ? o.email_verified_at != null : null } })
  out('EMAIL SCAN (read-only)')
  for (const [name, rows] of [['CUSTOMER ACCOUNTS', custRows], ['ADMIN ACCOUNTS', admins.error ? [] : admins.rows.map((row) => ({ id: row[0], email: row[1], verified: null }))]]) {
    const r = checkEmails(rows)
    out(`\n== ${name}: ${r.total} address(es)`)
    out(`  bad shape ${r.badShape.length} · spaces around it ${r.spaced.length} · duplicates (any case) ${r.duplicates.length} · provider typos ${r.typos.length} · not verified ${name.startsWith('CUSTOMER') ? r.unverified.length : 'n/a'}`)
    out('  domains: ' + Object.entries(r.domains).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', '))
    for (const x of r.badShape) out(`  id ${x.id}: bad shape ${mask(x.email)}`)
    for (const x of r.spaced) out(`  id ${x.id}: spaces around ${mask(x.email)}`)
    for (const x of r.duplicates) out(`  id ${x.id}: duplicate of another row ${mask(x.email)}`)
    for (const x of r.typos) out(`  id ${x.id}: provider typo ${mask(x.email)} (probably ${x.suggest})`)
  }
  if (admins.error) out('\n(admin_users could not be read: ' + String(admins.error).slice(0, 120) + ')')
  out('\nEMAIL_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('email-scan: ' + e.message); process.exit(2) })
