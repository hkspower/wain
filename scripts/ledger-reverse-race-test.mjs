/**
 * test:ledger-reverse-race — SEC-02 (2026-10-15): two concurrent reversals of one journal entry.
 *
 * Posts one balanced entry, then starts 20 PHP processes at once, each reversing that entry.
 * Exactly one reversal may post. The others must return null, or be refused, and write nothing.
 *
 * Checks, against the database and not the processes' own answers:
 *   - exactly one entry has reverses_id = the original
 *   - the original's reversed_by_id points at that one reversal
 *   - the cash account nets to zero over the original and its reversal
 *
 * Run `bash scripts/sandbox.sh` first. Every row this test writes is removed afterwards.
 * MUTATE=guard   removes only the claim check: the row lock still stops the double (expected to pass)
 * MUTATE=both    removes the row lock AND the claim check: the double MUST appear (expected to fail)
 */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const accFile = PUB + '/api/accounting.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const accOrig = readFileSync(accFile, 'utf8')
let accMut = accOrig
if (process.env.MUTATE === 'guard' || process.env.MUTATE === 'both') {
  accMut = accMut.replace("throw new RuntimeException('accounting: that entry has already been reversed');", '')
}
if (process.env.MUTATE === 'both') {
  accMut = accMut.replace('select id, entry_date, memo, reversed_by_id from journal_entries where id = ? for update', 'select id, entry_date, memo, reversed_by_id from journal_entries where id = ?')
}
if (accMut !== accOrig) writeFileSync(accFile, accMut)

const marker = Number(sql('select coalesce(max(id),0) from journal_entries'))
let original = null
const runPhp = (code) => new Promise((res) => {
  const c = spawn('php', ['-r', code])
  let out = ''
  c.stdout.on('data', (d) => (out += d))
  c.stderr.on('data', (d) => (out += d))
  c.on('close', () => res(out.trim()))
})
const head = `require "${PUB}/api/store.php"; require "${PUB}/api/accounting.php"; $db = store_db();`

try {
  const revCode = sql("select code from accounts where type = 'revenue' order by id limit 1")
  const cashBaseline = Number(sql(`select coalesce(sum(debit) - sum(credit), 0) from journal_lines l join accounts a on a.id = l.account_id where a.code = '1000'`))
  // Post the original through the real posting function: cash in, revenue out, KWD 10.000.
  const post = await runPhp(`${head} $id = acc_post($db, '2026-10-15', 'SEC-02 rig original', [['code' => '1000', 'debit' => 10000, 'credit' => 0, 'memo' => ''], ['code' => '${revCode}', 'debit' => 0, 'credit' => 10000, 'memo' => '']], 'manual', null, null, 'rig'); echo $id;`)
  original = Number(post)
  check(original > 0, 'the original entry posts', `id ${post}`)

  const N = 20
  // A BARRIER. Twenty processes started a few milliseconds apart each finish before the next begins, so
  // nothing overlaps and a double could never show. Each one waits for the same instant after its own
  // bootstrap, then reverses at once.
  const at = Date.now() / 1000 + 2.0
  const runs = await Promise.all(Array.from({ length: N }, () => runPhp(`${head} while (microtime(true) < ${at.toFixed(3)}) { usleep(500); } try { $r = acc_reverse($db, ${original}, 'SEC-02 race', 'rig'); echo $r === null ? 'NULL' : 'ID:' . $r; } catch (Throwable $e) { echo 'REFUSED'; }`)))
  const posted = runs.filter((x) => x.startsWith('ID:'))
  const refused = runs.filter((x) => x === 'REFUSED' || x === 'NULL')
  check(posted.length === 1, `${N} concurrent reversals of one entry: exactly one posted`, `posted ${posted.length}, refused or null ${refused.length}, other ${N - posted.length - refused.length}`)

  const reversals = Number(sql(`select count(*) from journal_entries where reverses_id = ${original}`))
  check(reversals === 1, 'the database holds exactly one reversal of the original', `${reversals} reversal(s)`)

  const linked = sql(`select reversed_by_id from journal_entries where id = ${original}`)
  check(linked && linked !== 'NULL' && posted.length === 1 && linked === posted[0].slice(3), 'the original points at that one reversal', `reversed_by_id ${linked}`)

  const cashAfter = Number(sql(`select coalesce(sum(debit) - sum(credit), 0) from journal_lines l join accounts a on a.id = l.account_id where a.code = '1000'`))
  check(cashAfter === cashBaseline, 'cash nets back to where it was before the original: the original and its one reversal cancel', `before ${cashBaseline}, after ${cashAfter}`)
} finally {
  if (accMut !== accOrig) writeFileSync(accFile, accOrig)
  // Remove every row this run wrote: reversals first, then the original (a self-referencing foreign key).
  // One session, so the foreign-key switch applies to the deletes. Matched by memo: this rig's own rows only.
  sql(`set foreign_key_checks = 0;
       delete from journal_lines where entry_id in (select id from journal_entries where memo like 'SEC-02%');
       delete from journal_entries where memo like 'SEC-02%';
       set foreign_key_checks = 1;`)
  console.log(fails ? `\n${fails} FAILED` : '\nall ledger-reverse race checks passed')
  process.exitCode = fails ? 1 : 0
}
