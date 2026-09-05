/**
 * Does IMPORT-THIS-ONE.sql actually install this shop?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/install-sql-test.mjs
 *
 * It is the file the owner is told to import, and the only one. Nothing had
 * ever imported it. Two things were wrong with it and neither was visible from
 * reading it:
 *
 *   IT HAD FALLEN TWO PARTS BEHIND. 7-returns.sql and 8-email-otp.sql were
 *   written after it and never folded in, which is why every hand-over since
 *   has ended with "and run these two by hand". The file's own header said to
 *   rebuild it with scripts/make-install-sql.mjs, and that script did not
 *   exist — a generated file with no generator.
 *
 *   IT NEVER CREATED wallet_passes. api/wallet.mysql.sql said "fresh installs
 *   get this from schema.mysql.sql" and schema.mysql.sql has never created it.
 *   db-audit.php lists the table as optional, so the only sign on a fresh shop
 *   was a warning that reads like a feature nobody switched on.
 *
 * Both were found the same way, and it is the way this file works: import
 * every part into an EMPTY database and diff the result against the database
 * the shop is actually running on. A schema that differs from the working one
 * is the whole bug, whichever direction it differs in.
 *
 * THE REFERENCE IS THE SANDBOX, deliberately. It is built by sandbox.sh from
 * these same parts and then exercised by thirty-odd rigs, so "the shop works
 * on this schema" is a thing the rest of the suite is continuously proving. A
 * hand-written list of expected tables would be a second source of truth, and
 * the one that rots.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = process.env.REF_DB ?? 'sporta'
const TMP = process.env.TMP_DB ?? 'sporta_install_check'
const SQL = new URL('../sporta-site/database-sql/IMPORT-THIS-ONE.sql', import.meta.url)

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}
const sql = (db, q) =>
  execFileSync('mariadb', ['-uroot', db, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
const root = (q) => execFileSync('mariadb', ['-uroot', '-e', q], { encoding: 'utf8' })

// 1. THE COMMITTED FILE IS THE ONE THE GENERATOR PRODUCES.
//
// Regenerate into memory and compare. Without this the file can be edited by
// hand — which its own header forbids — or simply left behind when a part
// changes, and every check below would go on passing against a stale file that
// happens to still import.
const before = readFileSync(SQL, 'utf8')
execFileSync('node', ['scripts/make-install-sql.mjs'], { stdio: 'ignore' })
const after = readFileSync(SQL, 'utf8')
check(before === after,
  'the committed IMPORT-THIS-ONE.sql is what the generator produces',
  'run `npm run make:install` and commit the result')

// 2. IT IMPORTS INTO AN EMPTY DATABASE.
root(`drop database if exists ${TMP}; create database ${TMP} character set utf8mb4 collate utf8mb4_unicode_ci`)
let ok1 = true
try {
  execFileSync('bash', ['-c', `mariadb -uroot ${TMP} < "${SQL.pathname}"`], { stdio: 'pipe' })
} catch (e) {
  ok1 = false
  check(false, 'it imports into an empty database', String(e.stderr ?? e).slice(0, 200))
}
if (ok1) check(true, 'it imports into an empty database')

// 3. AND AGAIN, because the header promises it is safe to re-run and an owner
//    who is unsure WILL run it twice.
try {
  execFileSync('bash', ['-c', `mariadb -uroot ${TMP} < "${SQL.pathname}"`], { stdio: 'pipe' })
  check(true, 'and a second import changes nothing rather than erroring')
} catch (e) {
  check(false, 'and a second import changes nothing rather than erroring',
    String(e.stderr ?? e).slice(0, 200))
}

// 4. THE SCHEMA MATCHES THE SHOP THAT WORKS.
const shape = (db) => sql(db,
  `select table_name, column_name, column_type from information_schema.columns
    where table_schema = '${db}' order by table_name, column_name`)
const a = shape(REF).split('\n')
const b = shape(TMP).split('\n')
const missing = a.filter((l) => !b.includes(l))
const extra = b.filter((l) => !a.includes(l))
check(missing.length === 0,
  `a fresh install builds every table and column the working shop has (${a.length} columns)`,
  `missing: ${missing.slice(0, 6).join(' | ')}`)
check(extra.length === 0,
  'and nothing the working shop does not',
  `extra: ${extra.slice(0, 6).join(' | ')}`)

// 5. AND THE CATALOGUE IS SELLABLE.
//
// Not a schema question. The seed leaves fifteen garments with no rows in
// product_variants, which db-audit.php calls "sold with NO size rows — the
// shop shows no size to pick and the order records none". A fresh install used
// to fail the shop's own audit, and a schema diff alone would never have said
// so, because the tables were all there and empty in the right way.
const sizeless = +sql(TMP,
  `select count(*) from products p left join product_variants v on v.slug = p.slug
    where p.active = 1 and v.slug is null and p.category in ('men','women','outerwear')`)
check(sizeless === 0,
  'every sized garment in a fresh install has sizes to pick',
  `${sizeless} garment(s) would be listed with no size at all`)

const products = +sql(TMP, 'select count(*) from products')
check(products > 0, `and the catalogue is there (${products} products)`)

root(`drop database if exists ${TMP}`)
console.log(fails ? `\n${fails} failed` : '\nall ok — one file, and it installs the shop')
process.exit(fails ? 1 : 0)
