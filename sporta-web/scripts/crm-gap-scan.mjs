#!/usr/bin/env node
// CRM GAP SCAN - how many old (OpenCart-imported) orders the CRM can see, read-only, counts only.
//
//   node scripts/crm-gap-scan.mjs        (credentials as the other live scans)
//
// The CRM keys a contact by the account, or else by a valid phone (crm_all_contacts in dropin/php-store/crm.php). An order with no usable
// phone is NOT a contact (it stays in Orders only). This prints the counts behind that: legacy orders, how many have no or a short phone,
// how many have an e-mail, and the number of distinct e-mails. No name, phone or e-mail is printed.
//
// READ-ONLY: SELECT only, READ ONLY session (the same gate as the other live scans).
import { MySQL, Gate, credentials, scrub } from './db-schema-live-diff.mjs'
import { pathToFileURL } from 'node:url'

const QUERIES = [
  ['LEGACY OPENCART ORDERS', `select count(*) as legacy_orders, sum(customer_phone is null or customer_phone = '') as no_phone, sum(customer_phone is not null and customer_phone <> '' and length(regexp_replace(customer_phone, '[^0-9]', '')) < 8) as short_phone, sum(customer_email is not null and customer_email <> '') as with_email, count(distinct lower(trim(customer_email))) as distinct_emails from orders where utm_campaign = 'opencart-2026-07-15'`],
  ['ALL ORDERS', `select count(*) as all_orders, sum(customer_account_id is not null) as with_account from orders`],
]

async function main() {
  let cred
  try { cred = credentials({}) } catch (e) { console.error('crm-gap-scan: ' + e.message); return 2 }
  const secrets = [cred.password, cred.user]
  const conn = new MySQL(cred)
  try { await conn.connect() } catch (e) { console.error('crm-gap-scan: cannot connect: ' + scrub(e.message, secrets)); return 2 }
  const gate = new Gate(conn)
  try { await gate.readOnly() } catch (e) { console.error('crm-gap-scan: ' + scrub(e.message, secrets)); await gate.end(); return 2 }
  console.log('CRM GAP SCAN (read-only)')
  for (const [title, sql] of QUERIES) {
    console.log('\n== ' + title)
    const r = await gate.query(sql)
    console.log('  ' + r.columns.join(' | '))
    for (const row of r.rows) console.log('  ' + row.map((c) => (c === null ? 'NULL' : c)).join(' | '))
  }
  await gate.end()
  console.log('\nCRM_GAP_SCAN_DONE')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c), (e) => { console.error('crm-gap-scan: ' + e.message); process.exit(2) })
