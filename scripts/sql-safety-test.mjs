/**
 * No .sql file may overwrite something the owner typed into /backends.
 *
 *   bash scripts/sandbox.sh      (only for the MariaDB it leaves running)
 *   node scripts/sql-safety-test.mjs
 *
 * WHY THIS EXISTS, AND WHY A COMMENT WAS NOT ENOUGH. IMPORT-THIS-ONE.sql
 * promises in its own header that it "does NOT delete or overwrite existing
 * orders, prices or stock counts", and it is the file the owner is told to
 * import. It did. Measured 2026-09-04: a product hand-priced at 99.500 came
 * back as the seed's 10.000 after one import, with its name and description
 * reverted with it.
 *
 * That was fixed the same day — IN ONE COPY. On 2026-09-10 the same clause was
 * still live in `api/seed.mysql.sql` and `api/install.mysql.sql`, and
 * `sporta-mac-check.sh` was still telling the owner to import the second one.
 * A third instance, `cost_aed` in the product_variants clause, had survived
 * BOTH passes: the comment beside it said "stock deliberately NOT updated",
 * which is true, and the wholesale cost sat one line away in the same
 * statement being overwritten every import.
 *
 * So: fixed twice, escaped twice, and each time the fix was a careful edit
 * with a careful comment. The thing a comment cannot do is fail.
 *
 * WHAT COUNTS AS "THE OWNER TYPED IT" IS READ FROM admin.php, not listed here.
 * The panel's save routes are the definition of an editable column, so the rig
 * asks them rather than carrying a copy that can go stale in the other
 * direction — a column added to product_save next year is covered the day it
 * lands. The extraction asserts it found a plausible number of columns first,
 * because a regex that silently matches nothing would make every check below
 * pass on an empty set. That is this repository's most repeated lesson.
 *
 * TWO HALVES, because either alone can be fooled:
 *
 *   STATIC   — no `on duplicate key update` in any tracked .sql may name an
 *              editable column. Catches the bug at the line that causes it,
 *              in files that are never imported by a test.
 *   MEASURED — for each importable bundle: import it, make the edits an owner
 *              would make through the panel, import the SAME FILE again, and
 *              require every edit to survive. This is the property the header
 *              actually promises, asked of MariaDB rather than of a regex.
 *
 * It creates and drops its own scratch databases and touches nothing else.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const sql = (db, q) => sh('mariadb', ['-uroot', db, '-N', '-e', q])
const root = (q) => sh('mariadb', ['-uroot', '-e', q])

// ---------------------------------------------------------------- the panel
/** Columns /backends writes, read out of admin.php's save routes.
 *
 *  Deliberately generous: anything that looks like a column name inside the
 *  route's body counts. A false POSITIVE here makes the rig stricter, which is
 *  the safe direction for a check about not clobbering the owner's work; a
 *  false negative is what lets a bug through. */
const ADMIN = readFileSync('sporta-site/public_html/api/admin.php', 'utf8')
const routeBody = (name) => {
  const at = ADMIN.indexOf(`'${name}'`)
  if (at < 0) return ''
  return ADMIN.slice(at, at + 2200)
}
const CANDIDATES = [
  'name_en', 'name_ar', 'desc_en', 'desc_ar', 'price', 'category', 'active',
  'cost_aed', 'stock', 'sort', 'slug', 'size', 'logo',
]
const editable = new Set()
for (const route of ['product_save', 'brand_save', 'variant_save', 'set_stock']) {
  const body = routeBody(route)
  for (const c of CANDIDATES) if (new RegExp(`\\b${c}\\b`).test(body)) editable.add(c)
}
// A regex that matches nothing would make every check below vacuous.
check(editable.size >= 6, 'the editable-column set was actually extracted from admin.php',
  `${editable.size}: ${[...editable].sort().join(', ')}`)

// ---------------------------------------------------------------- static
const FILES = sh('git', ['ls-files', '*.sql']).split('\n').filter(Boolean)
check(FILES.length > 10, 'and the repository has .sql files to check', `${FILES.length} files`)

const offenders = []
for (const f of FILES) {
  const text = readFileSync(f, 'utf8')
  // The clause runs to the terminating semicolon, which may be lines away.
  const re = /on\s+duplicate\s+key\s+update([\s\S]*?);/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const clause = m[1]
    for (const col of editable) {
      // `col = values(col)` is the overwrite. `col = col` is the no-op idiom
      // and is exactly what this file exists to keep in place.
      if (new RegExp(`\\b${col}\\s*=\\s*values\\s*\\(`, 'i').test(clause)) {
        offenders.push(`${f.replace('sporta-site/', '')} writes ${col}`)
      }
    }
  }
}
check(offenders.length === 0,
  'no .sql overwrites a column the owner can edit in /backends',
  offenders.slice(0, 8).join('; '))

// ---------------------------------------------------------------- measured
/** Import a file, edit it as the owner would, import again, compare. */
const survives = (file, db) => {
  root(`drop database if exists ${db}; create database ${db} character set utf8mb4 collate utf8mb4_unicode_ci`)
  execFileSync('bash', ['-c', `mariadb -uroot ${db} < ${JSON.stringify(file)}`], { stdio: 'ignore' })

  // A fixture chosen by position is a fixture chosen at random — name it.
  const slug = sql(db, "select slug from products order by slug limit 1")
  const sku = sql(db, "select sku from product_variants where cost_aed is not null order by sku limit 1")
  const brand = sql(db, "select slug from brands order by slug limit 1")
  if (!slug || !sku || !brand) return { skipped: true }

  root(`use ${db};
    update products set price = 99.500, name_en = 'OWNER RENAMED', active = 0 where slug = '${slug}';
    update product_variants set cost_aed = 1234.00 where sku = '${sku}';
    update brands set name_en = 'OWNER BRAND' where slug = '${brand}';`)

  const read = () => sql(db, `select concat_ws('|',
      (select concat(price,'/',name_en,'/',active) from products where slug='${slug}'),
      (select cost_aed from product_variants where sku='${sku}'),
      (select name_en from brands where slug='${brand}'))`)

  const before = read()
  execFileSync('bash', ['-c', `mariadb -uroot ${db} < ${JSON.stringify(file)}`], { stdio: 'ignore' })
  const after = read()
  root(`drop database ${db}`)
  return { before, after, ok: before === after }
}

// Only the files that are whole, importable bundles — a part file assumes the
// schema already exists and would fail for a reason that is not this one.
const BUNDLES = [
  'sporta-site/database-sql/IMPORT-THIS-ONE.sql',
  'sporta-site/public_html/api/install.mysql.sql',
]
for (const f of BUNDLES) {
  const db = 'sqlsafe_' + f.replace(/\W+/g, '_').slice(-24)
  let r
  try { r = survives(f, db) } catch (e) { r = { error: String(e).slice(0, 120) } }
  if (r.error) { check(false, `${f.replace('sporta-site/', '')} imports at all`, r.error); continue }
  if (r.skipped) { check(false, `${f.replace('sporta-site/', '')} seeded rows to edit`); continue }
  check(r.ok, `${f.replace('sporta-site/', '')} — the owner's edits survive a re-import`,
    r.ok ? r.after : `before ${r.before} -> after ${r.after}`)
}

console.log(fails
  ? `\n${fails} failed`
  : "\nall ok — importing twice cannot cost the owner a price, a name or a wholesale cost")
process.exit(fails ? 1 : 0)
