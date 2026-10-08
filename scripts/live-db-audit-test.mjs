/**
 * The data audit can run on the LIVE shop: it survives a database that is missing things, it prints
 * nothing it must not, and the sandbox report it replaced is unchanged.
 *
 *   bash scripts/sandbox.sh      (only for the MariaDB it leaves running)
 *   node scripts/live-db-audit-test.mjs
 *
 * scripts/live/live-db-audit.php carries the checks; scripts/db-audit.php asks it for every line. The
 * live run is one file fetched by cron into the home directory, so three properties matter there
 * that never mattered in the sandbox, and each is asserted here against a real MariaDB:
 *
 *   SHAPE     the compact report is a start line, one FAIL/WARN line per finding, and a summary,
 *             and its counts are the full report's counts — the two modes run the same checks.
 *   SURVIVAL  a missing table is `missing:<table>` and the run carries on to the LAST section; a
 *             missing column is `missing-column:<c>`; an unreachable database is one FAIL line.
 *             The old script died on the first such query and printed {"error":"no_table"}, exit 0.
 *   PRIVACY   a track id, a discount code and a free-text governorate planted in the data are
 *             reachable in the sandbox's full report (or "not printed" would prove nothing) and
 *             absent from the compact one.
 *
 * Plus the one live-only false alarm found while writing it: the live shop's accessories carry a
 * `ONE` size row, and the audit knew one-size only as `OS`.
 *
 * Each property has a CONTROL: the same assertion run against a deliberately broken copy of the
 * script, which must fail it. A check that cannot fail is not a check.
 *
 * NOTHING HERE WRITES TO `sporta`. It is read (a mysqldump, and the two read-only audits); every
 * rename and planted row happens in a scratch copy, `sporta_dbaudit_rig`, which is dropped at the end.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(REPO, 'sporta-site/public_html')
// Per run, so two runs at once (npm test beside another agent's) cannot drop each other's copy.
const DB = `sporta_dbaudit_rig_${process.pid}`

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const root = (q, db = '') => execFileSync('mariadb', ['-uroot', ...(db ? [db] : []), '-N', '-e', q], { encoding: 'utf8' }).trim()
const php = (file, args = [], env = {}) => {
  const r = spawnSync('php', [file, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status }
}
const summaryOf = (out) => {
  const m = out.match(/^DBAUDIT checks=(\d+) fails=(\d+) warns=(\d+) .*verdict=(\w+)$/m)
  return m ? { checks: +m[1], fails: +m[2], warns: +m[3], verdict: m[4] } : null
}
const fullSummaryOf = (out) => {
  const m = out.match(/\n(?:(\d+) failed|all ok), (\d+) to look at, out of (\d+) checks\n$/)
  return m ? { checks: +m[3], fails: +(m[1] ?? 0), warns: +m[2] } : null
}

// ------------------------------------------------------------------ SHAPE, on the sandbox (read-only)
console.log('--- the sandbox: both modes, read-only')
{
  let full, compact, fs, cs
  // Other rigs write to the sandbox while this runs; two back-to-back runs can straddle a write.
  for (let i = 0; i < 3; i++) {
    full = php(join(REPO, 'scripts/db-audit.php'))
    compact = php(join(REPO, 'scripts/live/live-db-audit.php'))
    fs = fullSummaryOf(full.out); cs = summaryOf(compact.out)
    if (fs && cs && fs.checks === cs.checks && fs.warns === cs.warns && fs.fails === cs.fails) break
  }
  check(fs !== null, 'scripts/db-audit.php ends with its usual summary line', fs ? `${fs.checks} checks` : full.out.slice(-200))
  check(fs !== null && fs.checks > 50, 'the full report ran a plausible number of checks', String(fs?.checks))
  check(full.code === (fs?.fails ? 1 : 0), 'its exit code still follows its failures', `exit ${full.code}`)
  check(/^ok   /m.test(full.out) && /^--- /m.test(full.out), 'the full report still prints ok lines and section headings')
  check(cs !== null, 'the compact report ends with a DBAUDIT summary', compact.out.split('\n').slice(-2).join(' | '))
  check(cs && fs && cs.checks === fs.checks && cs.warns === fs.warns && cs.fails === fs.fails,
    'the compact counts are the full counts — the same checks ran', `full ${JSON.stringify(fs)} compact ${JSON.stringify(cs)}`)
  const lines = compact.out.trimEnd().split('\n')
  check(/^DBAUDIT start store=repo /.test(lines[0]), 'the compact report opens with its start line', lines[0])
  const body = lines.slice(1, -1)
  check(body.every((l) => /^(FAIL|WARN) /.test(l)), 'every other compact line is a FAIL or a WARN', body.find((l) => !/^(FAIL|WARN) /.test(l)) ?? '')
  check(body.every((l) => [...l].length <= 160), 'no compact line is over 160 characters', String(Math.max(0, ...body.map((l) => [...l].length))))
  check(body.length === (cs?.fails ?? -1) + (cs?.warns ?? -1), 'one compact line per finding', `${body.length} lines`)
  const js = php(join(REPO, 'scripts/db-audit.php'), [], { SPORTA_DB_AUDIT_JSON: '1' })
  let parsed = null
  try { parsed = JSON.parse(js.out) } catch {}
  check(parsed && Array.isArray(parsed.lines) && parsed.checks === parsed.lines.length, 'SPORTA_DB_AUDIT_JSON=1 still gives the machine-readable report')
}

// ------------------------------------------------------------------ a scratch copy, and a tree that points at it
const T = mkdtempSync(join(tmpdir(), 'dbaudit-rig-'))
const tree = (rel) => join(T, rel)
const put = (rel, from) => { mkdirSync(dirname(tree(rel)), { recursive: true }); copyFileSync(from, tree(rel)) }
const bundle = readdirSync(join(DOC, 'assets')).filter((f) => /^index-.*\.js$/.test(f))
try {
  root(`drop database if exists ${DB}; create database ${DB} character set utf8mb4 collate utf8mb4_unicode_ci`)
  execFileSync('bash', ['-c', `mysqldump -uroot --single-transaction --no-tablespaces --default-character-set=utf8mb4 sporta | mariadb -uroot --default-character-set=utf8mb4 ${DB}`])
  check(+root(`select count(*) from information_schema.tables where table_schema = '${DB}'`) > 20, 'the scratch copy has the sandbox\'s tables')

  put('sporta-site/public_html/api/store.php', join(DOC, 'api/store.php'))
  put('sporta-site/public_html/index.html', join(DOC, 'index.html'))
  for (const b of bundle) put(`sporta-site/public_html/assets/${b}`, join(DOC, 'assets', b))
  put('src/app/checkout.tsx', join(REPO, 'src/app/checkout.tsx'))
  put('src/lib/cart.tsx', join(REPO, 'src/lib/cart.tsx'))
  put('scripts/db-audit.php', join(REPO, 'scripts/db-audit.php'))
  put('scripts/live/live-db-audit.php', join(REPO, 'scripts/live/live-db-audit.php'))
  const config = (db) => writeFileSync(tree('sporta-site/public_html/api/config.php'),
    `<?php\nreturn ['db_host' => 'localhost', 'db_name' => '${db}', 'db_user' => 'root', 'db_pass' => ''];\n`)
  config(DB)
  const SRC = readFileSync(join(REPO, 'scripts/live/live-db-audit.php'), 'utf8')
  /** A deliberately broken copy, for a control. The replacement is checked to have matched. */
  const mutant = (name, from, to) => {
    check(SRC.includes(from), `control "${name}": its mutation applies to the current script`)
    writeFileSync(tree(`scripts/live/${name}.php`), SRC.replace(from, to))
    return tree(`scripts/live/${name}.php`)
  }
  const LIVE = tree('scripts/live/live-db-audit.php')
  const FULL = tree('scripts/db-audit.php')

  const base = summaryOf(php(LIVE).out)
  check(base !== null && base.verdict !== '', 'the audit runs against the scratch copy', JSON.stringify(base))

  // ---------------------------------------------------------------- SURVIVAL
  console.log('--- a database that is missing things')
  const rename = (pairs) => root(`rename table ${pairs.map(([a, b]) => `${a} to ${b}`).join(', ')}`, DB)
  const without = (tables, fn) => {
    rename(tables.map((t) => [t, `zz_${t}`]))
    try { return fn() } finally { rename(tables.map((t) => [`zz_${t}`, t])) }
  }
  const scenario = (file) => {
    const c = php(file)
    const j = php(file, [], { SPORTA_DB_AUDIT_JSON: '1' })
    let lines = []
    try { lines = JSON.parse(j.out).lines.map((l) => l.text) } catch {}
    return { c, s: summaryOf(c.out), lines }
  }

  without(['size_charts', 'product_images', 'order_items'], () => {
    const { c, s, lines } = scenario(LIVE)
    check(s !== null, 'three tables gone: the run still ends with its summary', c.out.split('\n').slice(-1)[0])
    check(/^WARN missing:size_charts /m.test(c.out), 'an optional table gone mid-section is WARN missing:size_charts')
    check(/^WARN missing:product_images /m.test(c.out), 'a missing photo table is WARN missing:product_images')
    check(/^FAIL missing:order_items /m.test(c.out), 'a required table gone is FAIL missing:order_items')
    check(/missing=\S*order_items/.test(c.out) && /missing=\S*size_charts/.test(c.out), 'the summary names the missing tables')
    check(!c.out.includes('{"error"'), 'store.php\'s JSON error never reaches the report')
    check(lines.includes('discount rules checked'), 'and the LAST section still ran', `${lines.length} lines`)
    check(lines.includes('every paid order carries a paid_at'), 'and the order checks that need only orders still ran')
    check(c.code === 1, 'exit 1, because a required table is gone', `exit ${c.code}`)
    const f = php(FULL)
    check(fullSummaryOf(f.out) !== null, 'the full report survives it too', f.out.slice(-120).replace(/\n/g, ' | '))
    // CONTROL: a lost() that gives up instead of carrying on must fail the "last section ran" check.
    const m = mutant('rethrow', "function lost(string $title, Throwable $e): void {\n", "function lost(string $title, Throwable $e): void {\n    throw $e;\n")
    let ml = []
    try { ml = JSON.parse(php(m, [], { SPORTA_DB_AUDIT_JSON: '1' }).out).lines.map((l) => l.text) } catch {}
    check(!ml.includes('discount rules checked'), 'control: with lost() re-throwing, the last section does NOT run', `${ml.length} lines`)
  })

  without(['products'], () => {
    const { c, s } = scenario(LIVE)
    check(s !== null && /^FAIL missing:products /m.test(c.out), 'products gone: FAIL missing:products, and the summary still prints')
  })

  without(['settings', 'discounts', 'hero_slides'], () => {
    const { c, s } = scenario(LIVE)
    check(s !== null && ['settings', 'discounts', 'hero_slides'].every((t) => new RegExp(`^FAIL missing:${t} `, 'm').test(c.out)),
      'settings, discounts and hero_slides gone: each is FAIL missing:<table>')
  })

  root('alter table products rename column sale_starts_at to zz_sale_starts_at', DB)
  try {
    const { c, s } = scenario(LIVE)
    check(s !== null && /^FAIL missing-column:sale_starts_at /m.test(c.out), 'a column gone is FAIL missing-column:sale_starts_at')
  } finally {
    root('alter table products rename column zz_sale_starts_at to sale_starts_at', DB)
  }

  config('sporta_dbaudit_no_such_db')
  {
    const c = php(LIVE)
    const s = summaryOf(c.out)
    check(/^FAIL cannot reach the database \(connect error 1049\)/m.test(c.out) && s?.fails === 1 && c.code === 1,
      'an unreachable database is one FAIL line, a summary and exit 1', c.out.trim().split('\n').slice(-2).join(' | '))
    check(!/sporta_dbaudit_no_such_db|root/.test(c.out), 'and the error names neither the database nor the user')
    const f = php(FULL)
    check(f.code === 1, 'the sandbox report now FAILS on a dead database (it used to exit 0)', `exit ${f.code}`)
  }
  rmSync(tree('sporta-site/public_html/api/config.php'))
  {
    // store_config() answers a missing config.php with JSON and exit(0), the same trap as the dead database.
    const c = php(LIVE)
    check(/^FAIL api\/config\.php is missing/m.test(c.out) && summaryOf(c.out)?.fails === 1 && c.code === 1,
      'no api/config.php is one FAIL line, a summary and exit 1', c.out.trim().split('\n').slice(-2).join(' | '))
    check(php(FULL).code === 1, 'and the sandbox report FAILS on it rather than passing', '')
  }
  config(DB)
  {
    const s = summaryOf(php(LIVE).out)
    check(JSON.stringify(s) === JSON.stringify(base), 'every rename was undone: the copy reads as it started', JSON.stringify(s))
  }

  // ---------------------------------------------------------------- PRIVACY
  console.log('--- what it must not print')
  const TRACK = 'SPRRIGSECRET1', CODE = 'RIGSECRET95', GOV = 'Rig Person 7', PHONE = '55500777'
  root(`insert into orders (track_id, amount, subtotal, discount_amount, delivery_fee, customer_governorate, customer_lang, customer_name, customer_phone)
        values ('${TRACK}', 5.000, 4.000, 0, 1.000, '${GOV}', 'ar', 'Rig Secret Person', '${PHONE}');
        insert into discounts (kind, code, label, type, value) values ('code', '${CODE}', 'rig', 'percent', 95)`, DB)
  try {
    const f = php(FULL).out
    check(f.includes(TRACK) && f.includes(CODE) && f.includes(GOV),
      'the planted track id, code and governorate ARE reachable in the sandbox report (so their absence below means something)')
    const c = php(LIVE).out
    check(/^FAIL order #\d+ has no items$/m.test(c), 'compact: the order is named by its number', (c.match(/^FAIL order .*items$/m) ?? [''])[0])
    check(/^FAIL discount #\d+ is 95\.000% /m.test(c), 'compact: the discount is named by its row id')
    check(/^FAIL orders carry governorate '<12 bytes>'/m.test(c), 'compact: the free-text governorate is reported by its length')
    const leaks = [TRACK, CODE, GOV, PHONE, 'Rig Secret Person'].filter((s) => c.includes(s))
    check(leaks.length === 0, 'compact: none of the planted values is printed', leaks.join(', '))
    const m = mutant('noredact', '$redact = $onLive || !$full;', '$redact = false;')
    const mc = php(m).out
    check([TRACK, CODE, GOV].some((s) => mc.includes(s)), 'control: with redaction off, the leak check WOULD see them')

    // THE SERVER'S OWN PATH, which nothing above reaches: $onLive is true only when the live docroot
    // exists, so a copy whose ONLY change is that constant (pointed at the scratch docroot) is the
    // run cron makes — fetched to a home directory, no repository beside it. `--full` there must stay
    // redacted, and the app-source checks must be skipped rather than read from nowhere.
    const LIVE_DOC = "const DBA_LIVE_DOCROOT = '/home/u130124229/domains/sporta.com.kw/public_html';"
    check(SRC.includes(LIVE_DOC), 'the live docroot constant is where the live-shaped copy expects it')
    const asLive = (src) => {
      mkdirSync(tree('home'), { recursive: true })
      writeFileSync(tree('home/r.php'), src.replace(LIVE_DOC, `const DBA_LIVE_DOCROOT = '${tree('sporta-site/public_html')}';`))
      return tree('home/r.php')
    }
    const R = asLive(SRC)
    const lc = php(R).out, lf = php(R, ['--full']).out
    check(/^DBAUDIT start store=live /.test(lc) && summaryOf(lc) !== null, 'live-shaped: it knows it is on the server', lc.split('\n')[0])
    check(fullSummaryOf(lf) !== null && /^ok   /m.test(lf), 'live-shaped --full: every line, and its summary')
    const leaksLive = [TRACK, CODE, GOV, PHONE, 'Rig Secret Person'].filter((s) => lf.includes(s) || lc.includes(s))
    check(leaksLive.length === 0, 'live-shaped: --full and compact print none of the planted values', leaksLive.join(', '))
    check(f.includes("the app's checkout") && !/the app(?:'s| offers| quotes| promises| still)/.test(lf),
      'live-shaped: the app-source checks are skipped there (and do run in the sandbox)')
    check(lf.includes("the website's bundle names all six governorates"), 'live-shaped: the docroot bundle is still read')
    // CONTROL: drop `$onLive ||` and --full on the server prints them.
    const RM = asLive(SRC.replace('$redact = $onLive || !$full;', '$redact = !$full;'))
    check([TRACK, CODE, GOV].some((s) => php(RM, ['--full']).out.includes(s)), 'control: without $onLive in $redact, --full on the server WOULD leak them')
  } finally {
    root(`delete from orders where track_id = '${TRACK}'; delete from discounts where code = '${CODE}'`, DB)
  }

  // ---------------------------------------------------------------- the ONE size
  console.log('--- the live shop\'s one-size rows')
  root(`insert into product_variants (sku, slug, size, stock)
        select upper(concat(substr(slug, 1, 26), '-ONE')), slug, 'ONE', 0 from products
        where category = 'accessories' and slug not in (select slug from product_variants) limit 4`, DB)
  try {
    const n = +root("select count(*) from product_variants where size = 'ONE'", DB)
    check(n > 0, 'the copy now has one-size rows, as the live shop does', `${n} rows`)
    const c = php(LIVE).out
    check(!/size 'ONE' is sold, but the size guide has no measurements/.test(c), 'ONE is a known size: no size-guide warning for a cap')
    check(/is active but every size is out of stock/.test(c), 'a one-size product at stock 0 is still reported out of stock')
    const m = mutant('noone', "['OS', 'ONE']", "['OS']")
    check(/size 'ONE' is sold, but the size guide has no measurements/.test(php(m).out), 'control: without ONE in the list, the false warning comes back')
  } finally {
    root("delete from product_variants where size = 'ONE'", DB)
  }
} finally {
  try { root(`drop database if exists ${DB}`) } catch {}
  rmSync(T, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
