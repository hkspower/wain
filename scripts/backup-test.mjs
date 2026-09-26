/**
 * The full-shop backup: ?r=backup_export, ?r=backup_preview, ?r=backup_import
 * on the website's /backends.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/backup-test.mjs
 *
 * What this actually has to hold, past "the routes answer 200":
 *
 *   1. The export carries every table CLAUDE.md's owner approved, with REAL
 *      row counts — not an empty shell that would pass by covering nothing.
 *   2. No secret ever appears in the exported bytes: not config.php's DB
 *      password or cron key (this route never reads that file, but the test
 *      greps for its actual values anyway, in case a future column starts
 *      quoting it), and not an admin's TOTP secret, which is dropped on
 *      export precisely because a copy of this file must never be a way to
 *      sign in as the owner.
 *   3. Preview never writes. A row's price is read before and after a
 *      preview call and must be byte-identical.
 *   4. Import refuses without BOTH gates: no confirm, and a confirm with a
 *      token that does not match the payload actually sent.
 *   5. The restore round trip: export, mutate the database (a price edited,
 *      a row added the backup does not have), import the ORIGINAL file back,
 *      and require the edit reverted and the extra row gone — REPLACE, not
 *      merge, exactly as CLAUDE.md's admin.php comment says it must be.
 *
 * And three mutations, applied to the live admin.php and reverted
 * immediately after each is measured, because a guard that has never been
 * seen to fail is a guard nobody has tested:
 *
 *   - drop the `confirm` check           -> import must start succeeding
 *     without it, which is what proves the check was the thing stopping it.
 *   - drop the token check                -> same, for the stale-preview
 *     guard.
 *   - stop dropping totp_secret on export -> the secret must start leaking.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const API = BASE + '/api/admin.php?r='
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'
const ADMIN_PHP = new URL('../sporta-site/public_html/api/admin.php', import.meta.url).pathname
const CONFIG_PHP = new URL('../sporta-site/public_html/api/config.php', import.meta.url).pathname

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const one = (q) => sql(q).trim().split('\n').slice(1)[0]

let jar = ''
const call = async (route, body) => {
  const r = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      'X-Sporta-Admin': '1',
      ...(jar ? { Cookie: jar } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  if (setCookie.length) jar = setCookie.map((c) => c.split(';')[0]).join('; ')
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { /* left null */ }
  return { status: r.status, body: json, text }
}

const BACKUP_TABLES = [
  'brands', 'products', 'product_variants', 'product_images',
  'customers', 'orders', 'order_items', 'reviews', 'discounts',
  'blocked_customers', 'hero_slides', 'settings', 'admin_users', 'assistant_qa',
]

const originalAdminPhp = readFileSync(ADMIN_PHP, 'utf8')
function mutate(from, to, label) {
  const src = readFileSync(ADMIN_PHP, 'utf8')
  if (!src.includes(from)) { check(false, `mutation fixture found: ${label}`, 'the string to mutate is not in admin.php any more'); return false }
  writeFileSync(ADMIN_PHP, src.replace(from, to))
  return true
}
function restore() { writeFileSync(ADMIN_PHP, originalAdminPhp) }

try {
  /* -------------------------------------------------------------- sign in */
  const login = await call('login', { email: EMAIL, password: PASSWORD })
  check(login.status === 200, 'signed in for the rest of the checks', JSON.stringify(login.body))

  /* --------------------------------------------------- fixture: a totp row */
  sql(`update admin_users set totp_secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', totp_enabled = 1
       where email = '${EMAIL}'`)

  /* ----------------------------------------------------------------- 1/2. */
  const exp = await call('backup_export')
  check(exp.status === 200 && !!exp.body?.tables, 'backup_export answers 200 with a tables object', JSON.stringify(exp.body).slice(0, 200))

  for (const t of BACKUP_TABLES) {
    const dbCount = Number(one(`select count(*) from \`${t}\``))
    const gotCount = Array.isArray(exp.body?.tables?.[t]) ? exp.body.tables[t].length : -1
    check(gotCount === dbCount, `${t}: exported row count matches the database`, `db=${dbCount} export=${gotCount}`)
  }

  const bytes = JSON.stringify(exp.body)
  const dbPass = 'localdev'
  const cronKey = 'SANDBOX_NOT_A_REAL_CRON_KEY'
  check(!bytes.includes(dbPass), 'the sandbox DB password never appears in the export')
  check(!bytes.includes(cronKey), 'the sandbox cron key never appears in the export')
  check(!bytes.includes('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'), 'the TOTP secret never appears in the export')
  const adminRow = (exp.body.tables.admin_users || []).find((a) => a.email === EMAIL)
  check(!!adminRow, 'the admin row itself is in the export')
  check(adminRow && adminRow.totp_secret === null, 'totp_secret is exported as null', JSON.stringify(adminRow))
  check(adminRow && Number(adminRow.totp_enabled) === 0, 'totp_enabled is forced off in the export', JSON.stringify(adminRow))

  /* --------------------------------------------------- 3. preview writes nothing */
  const priceBefore = one(`select price from products order by id limit 1`)
  const previewNoop = await call('backup_preview', { data: exp.body })
  check(previewNoop.status === 200 && !!previewNoop.body?.tables, 'backup_preview answers with a diff', JSON.stringify(previewNoop.body).slice(0, 200))
  const priceAfterPreview = one(`select price from products order by id limit 1`)
  check(priceBefore === priceAfterPreview, 'a price is unchanged by preview', `${priceBefore} vs ${priceAfterPreview}`)
  check(previewNoop.body?.tables?.products?.changed === 0 && previewNoop.body?.tables?.products?.removed === 0,
    'previewing the shop’s own current backup shows no changes and nothing removed',
    JSON.stringify(previewNoop.body?.tables?.products))

  const goodToken = previewNoop.body.token

  /* --------------------------------------------- 4. import needs BOTH gates */
  const countBefore = Number(one(`select count(*) from products`))
  const noConfirm = await call('backup_import', { data: exp.body, token: goodToken })
  check(noConfirm.status === 400 && noConfirm.body?.error === 'confirm_required',
    'import without confirm:true is refused', JSON.stringify(noConfirm.body))
  const badToken = await call('backup_import', { data: exp.body, confirm: true, token: 'not-a-real-token' })
  check(badToken.status === 400 && badToken.body?.error === 'stale_or_missing_preview',
    'import with a wrong token is refused', JSON.stringify(badToken.body))
  const countAfterRefusals = Number(one(`select count(*) from products`))
  check(countBefore === countAfterRefusals, 'neither refusal wrote anything', `${countBefore} vs ${countAfterRefusals}`)

  /* --------------------------------------------------- 5. the round trip */
  const targetId = one(`select id from products order by id limit 1`)
  const originalPrice = one(`select price from products where id = ${targetId}`)
  const stolenPhone = '96555590001'

  sql(`update products set price = 999.999 where id = ${targetId}`)
  sql(`delete from blocked_customers where phone = '${stolenPhone}'`)
  sql(`insert into blocked_customers (phone, scope, reason, blocked_by)
       values ('${stolenPhone}', 'cod', 'rig fixture, must vanish on restore', 'rig')`)

  const priceMutated = one(`select price from products where id = ${targetId}`)
  check(priceMutated === '999.999', 'the mutation actually landed before restoring over it', priceMutated)

  const previewAfterMutate = await call('backup_preview', { data: exp.body })
  check(previewAfterMutate.body?.tables?.products?.changed >= 1,
    'preview now reports the mutated product as changed',
    JSON.stringify(previewAfterMutate.body?.tables?.products))
  check(previewAfterMutate.body?.tables?.blocked_customers?.removed >= 1,
    'preview reports the extra blocked number as one that would be REMOVED',
    JSON.stringify(previewAfterMutate.body?.tables?.blocked_customers))

  const restoreCall = await call('backup_import', { data: exp.body, confirm: true, token: previewAfterMutate.body.token })
  check(restoreCall.status === 200 && restoreCall.body?.ok === true, 'restore succeeds', JSON.stringify(restoreCall.body))

  const priceRestored = one(`select price from products where id = ${targetId}`)
  check(priceRestored === originalPrice, 'the price is back to what the backup held', `${priceRestored} vs ${originalPrice}`)
  const stillBlocked = one(`select count(*) from blocked_customers where phone = '${stolenPhone}'`)
  check(stillBlocked === '0', 'the row the backup did not have is gone — REPLACE, not merge', stillBlocked)

  /* ---------------------------------- mutation 1: drop the confirm guard */
  if (mutate(
    "if ((\$b['confirm'] ?? false) !== true) store_fail('confirm_required');",
    "// MUTATED OUT FOR backup-test.mjs",
    'confirm guard'
  )) {
    const noConfirmNowWorks = await call('backup_import', { data: exp.body, token: previewNoop.token || (await call('backup_preview', { data: exp.body })).body.token })
    restore()
    check(noConfirmNowWorks.status !== 400 || noConfirmNowWorks.body?.error !== 'confirm_required',
      'MUTATION CAUGHT: removing the confirm guard lets an unconfirmed import through',
      JSON.stringify(noConfirmNowWorks.body))
  }

  /* ------------------------------------ mutation 2: drop the token guard */
  if (mutate(
    "if ((string) (\$b['token'] ?? '') !== backup_token(\$data)) store_fail('stale_or_missing_preview');",
    "// MUTATED OUT FOR backup-test.mjs",
    'token guard'
  )) {
    const freshPreview = await call('backup_preview', { data: exp.body })
    const badTokenNowWorks = await call('backup_import', { data: exp.body, confirm: true, token: 'still-not-a-real-token' })
    restore()
    check(badTokenNowWorks.status === 200,
      'MUTATION CAUGHT: removing the token guard lets a wrong token through',
      JSON.stringify(badTokenNowWorks.body))
    void freshPreview
  }

  /* ------------------------------ mutation 3: stop dropping totp_secret */
  if (mutate(
    "\$row['totp_secret'] = null;",
    "// MUTATED OUT FOR backup-test.mjs",
    'totp_secret redaction'
  )) {
    sql(`update admin_users set totp_secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', totp_enabled = 1
         where email = '${EMAIL}'`)
    const leaky = await call('backup_export')
    restore()
    const leakyRow = (leaky.body?.tables?.admin_users || []).find((a) => a.email === EMAIL)
    check(leakyRow && leakyRow.totp_secret === 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      'MUTATION CAUGHT: without the redaction the TOTP secret is exported in plain sight',
      JSON.stringify(leakyRow))
  }

} finally {
  restore()
  sql(`delete from blocked_customers where phone = '96555590001'`)
  sql(`update admin_users set totp_secret = null, totp_enabled = 0 where email = '${EMAIL}'`)
}

console.log(fails === 0 ? '\nall ok — backup exports everything, leaks nothing, previews without writing, and restore replaces rather than merges'
  : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
