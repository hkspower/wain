/**
 * Does every table and column the PHP queries exist in a FRESH install?
 *
 *   node scripts/schema-usage-audit.mjs                        scan sporta-site/public_html
 *   SCAN_ROOT=/a/copy FLOOR=1 node scripts/schema-usage-audit.mjs   scan a copy (mutation testing)
 *   SCAN_ROOT=$PWD/scripts node scripts/schema-usage-audit.mjs  scan the live checkers too
 *   BUNDLE_GAPS=warn node scripts/schema-usage-audit.mjs       report bundle gaps without failing on them
 *   DEBUG=1 node scripts/schema-usage-audit.mjs                print what each statement was read as (stderr)
 *   --keep                                                     leave the two scratch databases behind
 *
 * THE FAILURE IT EXISTS FOR is a query that 500s the moment it runs: a column
 * the code reads that no install ever created. Such a fault is invisible in the
 * sandbox, which is built from EVERY schema file and then patched by thirty
 * rigs, and invisible on the live shop, which was migrated by hand — so "it
 * works here" and "it works there" say nothing about a shop installed today
 * from the one file the owner is told to import.
 *
 * HOW IT DECIDES, and why it is not a regex over SQL.
 *
 *   1. It builds the schema itself, in two scratch databases created as root
 *      and dropped on exit (never the shared `sporta` sandbox):
 *        BUNDLE = database-sql/IMPORT-THIS-ONE.sql alone — a fresh install;
 *        FULL   = BUNDLE + every public_html/api/*.mysql.sql — everything any
 *                 schema file in this repository creates.
 *   2. It reads every string literal out of every .php under SCAN_ROOT with
 *      PHP's own tokenizer, joining `'a' . $x . 'b'` concatenations and
 *      `$sql .= '…'` appends, so a statement split across lines is one
 *      statement. Each PHP expression inside one becomes a numbered marker.
 *   3. Every literal that starts like a DML statement is PREPARED — server
 *      side, nothing executes — in both databases, first with every marker as
 *      `?`. A prepare resolves every table and column name against the real
 *      schema, so "Unknown column" is MariaDB's verdict, not this script's.
 *   4. A SECOND READING puts back what each expression holds where that can be
 *      worked out from literals alone — a `$where` assigned a ternary of
 *      strings, `implode(' and ', $where)` after `$where[] = 'a = ?'`, a
 *      `$filtered` subquery assigned three lines up — so the columns inside a
 *      PHP-built clause are prepared too, not hidden behind a `?`.
 *   5. A prepare stops at the first unknown name; each one found is replaced by
 *      `null` and the statement prepared again, so every name is reported.
 *   6. What still will not prepare (a table in a variable, `set $set`) gets a
 *      static check of its literal parts: table names, an insert's column list,
 *      each `set col =`, and — for `update t set $set` / `insert into t ($cols)`
 *      — the column names traced back through the PHP that built the list:
 *      `$fields = ['a' => …]`, `$fields['b'] = …`, `$sets[] = 'c = ?'`, and the
 *      whitelist of an `in_array($k, $allowed)`. Literal lists of TABLE names
 *      (`const *_TABLES`, `foreach (['a', 'b'] as $t)` used as a table) are
 *      checked as tables.
 *   7. And two of those are PREPARED again with the dynamic part stood in for,
 *      because a static read sees only the SET list: `update t set $set where …`
 *      with one real column for `$set` (so the WHERE is resolved too), and a
 *      statement whose table is a foreach variable once per listed table (so
 *      `update $child set slug = ?` must find `slug` in every one). Both were
 *      blind spots a mutation walked straight through before this step.
 *
 * WHAT FAILS THE RUN (exit 1):
 *   MISSING     a table or column that NO schema file creates. Always a bug.
 *   BUNDLE-GAP  one that some api/*.mysql.sql creates but IMPORT-THIS-ONE.sql
 *               does not, so a fresh install lacks it. BUNDLE_GAPS=warn turns
 *               these into warnings — only for a deliberate, recorded reason.
 *   UNREAD      a literal handed straight to ->prepare() / ->query() / ->exec()
 *               that was not read as SQL: the classifier has a hole.
 *   CANARY      the built-in canary — a generated PHP file carrying a made-up
 *               name in every shape above, each expected on its own line with
 *               its own verdict — was not caught exactly. A scanner that finds
 *               nothing and one that cannot find anything print the same
 *               "all ok"; the canary tells them apart on every run.
 *   FLOOR       fewer statements than a working scan of the docroot finds. An
 *               empty result passes every comparison under it.
 *
 * REPORTED, NOT FAILED: statements whose TABLE is a variable (`from $t`), named
 * so a person can read the list it comes from; prepare errors that are neither
 * a name nor a syntax error.
 *
 * WHAT IT DOES NOT SEE: names computed at runtime (`$text[$k . '_en']`), SQL
 * assembled more than four assignments away, and code outside SCAN_ROOT.
 * Precision over recall: everything it reports was resolved by the database or
 * read off a literal.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SCAN_ROOT = (process.env.SCAN_ROOT ?? join(REPO, 'sporta-site/public_html')).replace(/\/$/, '')
const BUNDLE_SQL = join(REPO, 'sporta-site/database-sql/IMPORT-THIS-ONE.sql')
const API_SQL_DIR = join(REPO, 'sporta-site/public_html/api')
const KEEP = process.argv.includes('--keep')
const GAPS_WARN = process.env.BUNDLE_GAPS === 'warn'
// Any PHP expression inside a statement becomes a numbered marker, so each can
// be traced back to the expression it stands for.
const VAR_SRC = '⟦V\\d*⟧'
const VAR_G = new RegExp(VAR_SRC, 'g')
const marker = (n) => `⟦V${n}⟧`
const DB_FULL = `sporta_sua_full_${process.pid}`
const DB_BUNDLE = `sporta_sua_bundle_${process.pid}`
// A working scan of this repository finds ~545 statements and prepares ~515.
// The floors are well under that: they exist to catch "found nothing", not drift.
const FLOOR_STATEMENTS = 450
const FLOOR_PREPARED = 420

const work = mkdtempSync(join(tmpdir(), 'schema-usage-'))
let fails = 0
const say = (s) => console.log(s)

// ------------------------------------------------------------------ helpers
const root = (args, input) => execFileSync('mariadb', ['-uroot', '--default-character-set=utf8mb4', ...args],
  { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })

function dropDbs () {
  if (KEEP) return
  try { root(['-e', `drop database if exists \`${DB_FULL}\`; drop database if exists \`${DB_BUNDLE}\``]) } catch {}
}
let cleaned = false
function cleanup () { if (cleaned) return; cleaned = true; dropDbs(); try { rmSync(work, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)          // also on a throw part-way: no scratch database is left behind
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

function walk (dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'vendor' || n.startsWith('.')) continue
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, acc)
    else if (n.endsWith('.php')) acc.push(p)
  }
  return acc
}

// --------------------------------------------------------------- the PHP side
// One small program, two modes. `extract` tokenizes files and prints their
// string chains; `prepare` prepares statements in a database and prints the
// error (if any) for each. Written to a temp file, never into the repository.
const PHP = String.raw`<?php
$mode = $argv[1] ?? '';
if ($mode === 'prepare') {
    $db = $argv[2]; $sock = $argv[3];
    $pdo = new PDO("mysql:unix_socket=$sock;dbname=$db;charset=utf8mb4", 'root', '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
    $in = json_decode(stream_get_contents(STDIN), true);
    $res = [];
    foreach ($in as $id => $sql) {
        try { $st = $pdo->prepare($sql); $st = null; $res[$id] = null; }
        catch (Throwable $e) {
            $info = $e instanceof PDOException ? $e->errorInfo : null;
            $res[$id] = [(int) ($info[1] ?? 0), (string) ($info[2] ?? $e->getMessage())];
        }
    }
    echo json_encode($res);
    exit;
}
// ---------------------------------------------------------------- extract
$files = json_decode(stream_get_contents(STDIN), true);
$INSIG = [T_WHITESPACE => 1, T_COMMENT => 1, T_DOC_COMMENT => 1];
$OPEN = ['(' => 1, '[' => 1, '{' => 1];
$CLOSE = [')' => 1, ']' => 1, '}' => 1];
$TERM_CH = ['.' => 1, ';' => 1, ',' => 1, '?' => 1, ':' => 1, '=' => 1, '<' => 1, '>' => 1, '|' => 1, '&' => 1, '^' => 1];
$TERM_T = [];
foreach (['T_DOUBLE_ARROW','T_COALESCE','T_CONCAT_EQUAL','T_BOOLEAN_AND','T_BOOLEAN_OR','T_LOGICAL_AND',
          'T_LOGICAL_OR','T_LOGICAL_XOR','T_IS_EQUAL','T_IS_IDENTICAL','T_IS_NOT_EQUAL','T_IS_NOT_IDENTICAL',
          'T_IS_SMALLER_OR_EQUAL','T_IS_GREATER_OR_EQUAL','T_SPACESHIP','T_CLOSE_TAG','T_AS','T_PLUS_EQUAL',
          'T_MINUS_EQUAL','T_MUL_EQUAL','T_DIV_EQUAL','T_COALESCE_EQUAL'] as $n) if (defined($n)) $TERM_T[constant($n)] = 1;
$result = [];
foreach ($files as $file) {
    $src = @file_get_contents($file);
    if ($src === false) continue;
    $raw = token_get_all($src);
    $T = []; $line = 1;
    foreach ($raw as $r) {
        if (is_array($r)) { $T[] = [$r[0], $r[1], $line]; $line += substr_count($r[1], "\n"); }
        else { $T[] = [null, $r, $line]; $line += substr_count($r, "\n"); }
    }
    $sig = []; $pos = [];
    foreach ($T as $i => $t) if (!isset($INSIG[$t[0]])) { $pos[$i] = count($sig); $sig[] = $i; }
    $interior = [];
    $isStart = function ($i) use (&$T) {
        $t = $T[$i];
        return $t[0] === T_CONSTANT_ENCAPSED_STRING || $t[0] === T_START_HEREDOC || ($t[0] === null && ($t[1] === '"' || $t[1] === 'b"'));
    };
    // Returns [parts, endIndex]. A part is ['s', text, line] or ['v', rawExpr].
    $read = function ($i) use (&$T, &$interior) {
        $t = $T[$i];
        if ($t[0] === T_CONSTANT_ENCAPSED_STRING) {
            $s = $t[1];
            if ($s[0] === 'b' || $s[0] === 'B') $s = substr($s, 1);
            $q = $s[0]; $inner = substr($s, 1, -1);
            $txt = $q === "'" ? strtr($inner, ['\\\\' => '\\', "\\'" => "'"]) : stripcslashes($inner);
            return [[['s', $txt, $t[2]]], $i];
        }
        $now = $t[0] === T_START_HEREDOC && str_contains($t[1], "'");
        $endT = $t[0] === T_START_HEREDOC ? T_END_HEREDOC : null;
        $parts = []; $j = $i + 1; $v = null;
        for (; $j < count($T); $j++) {
            $u = $T[$j];
            if ($endT !== null ? $u[0] === $endT : ($u[0] === null && $u[1] === '"')) break;
            $interior[$j] = true;
            if ($u[0] === T_ENCAPSED_AND_WHITESPACE) {
                if ($v !== null) { $parts[] = ['v', $v]; $v = null; }
                $parts[] = ['s', $now ? $u[1] : stripcslashes($u[1]), $u[2]];
            } else { $v = ($v ?? '') . $u[1]; }
        }
        if ($v !== null) $parts[] = ['v', $v];
        $interior[$j] = true;
        return [$parts, $j];
    };
    $consumed = [];
    $chains = [];
    $n = count($sig);
    $tx = function ($k) use (&$T, &$sig) { return $k >= 0 && $k < count($sig) ? $T[$sig[$k]] : [null, '', 0]; };
    for ($k = 0; $k < $n; $k++) {
        $i = $sig[$k];
        if (isset($interior[$i]) || isset($consumed[$i]) || !$isStart($i)) continue;
        $prev = $tx($k - 1); $prev2 = $tx($k - 2);
        $c = ['line' => $T[$i][2], 'parts' => [], 'prefix' => null, 'assign' => null, 'append' => null, 'call' => null];
        if ($prev[0] === null && $prev[1] === '(' && $prev2[0] === T_STRING && in_array(strtolower($prev2[1]), ['prepare', 'query', 'exec'], true)
            && in_array($tx($k - 3)[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) $c['call'] = strtolower($prev2[1]);
        if ($prev[0] === null && $prev[1] === '.') $c['prefix'] = $prev2[1];
        if ($prev[0] === null && $prev[1] === '=' && $prev2[0] === T_VARIABLE) $c['assign'] = $prev2[1];
        if ($prev[0] === T_CONCAT_EQUAL && $prev2[0] === T_VARIABLE) $c['append'] = $prev2[1];
        [$p, $e] = $read($i);
        array_push($c['parts'], ...$p);
        $kk = $pos[$e] ?? $k;
        while ($kk + 1 < $n && $tx($kk + 1)[0] === null && $tx($kk + 1)[1] === '.') {
            $kk++;
            if ($kk + 1 >= $n) break;
            $nx = $sig[$kk + 1];
            if ($isStart($nx)) {
                $consumed[$nx] = true;
                [$p, $e] = $read($nx);
                array_push($c['parts'], ...$p);
                $kk = $pos[$e];
                continue;
            }
            $depth = 0; $m = $kk + 1; $expr = '';
            for (; $m < $n; $m++) {
                $ti = $sig[$m]; $t = $T[$ti];
                if ($isStart($ti)) { [, $e2] = $read($ti); $expr .= $T[$ti][0] === T_CONSTANT_ENCAPSED_STRING ? $T[$ti][1] : '"…"'; $m = $pos[$e2]; continue; }
                $s = $t[1];
                if ($t[0] === null && isset($OPEN[$s]) || $t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES) $depth++;
                elseif ($t[0] === null && isset($CLOSE[$s])) { if ($depth === 0) break; $depth--; }
                elseif ($depth === 0 && (($t[0] === null && isset($TERM_CH[$s])) || ($t[0] !== null && isset($TERM_T[$t[0]])))) break;
                $expr .= $s;
            }
            $c['parts'][] = ['v', $expr];
            $kk = $m - 1;
        }
        $has = false; foreach ($c['parts'] as $pp) if ($pp[0] === 's') { $has = true; break; }
        if ($has) $chains[] = $c;
    }
    // foreach ([ 'a', 'b' ] as $x) and const X_TABLES = [ ... ]: literal lists of names.
    $lists = [];
    for ($k = 0; $k < $n; $k++) {
        $t = $tx($k);
        $isFor = $t[0] === T_FOREACH && $tx($k + 1)[1] === '(' && $tx($k + 2)[1] === '[';
        $isConst = $t[0] === T_CONST && $tx($k + 1)[0] === T_STRING && preg_match('/TABLES$/', $tx($k + 1)[1]) && $tx($k + 2)[1] === '=' && $tx($k + 3)[1] === '[';
        if (!$isFor && !$isConst) continue;
        $m = $k + ($isFor ? 3 : 4); $items = []; $okList = true;
        for (; $m < $n; $m++) {
            $u = $tx($m);
            if ($u[1] === ']') break;
            if ($u[1] === ',') continue;
            if ($u[0] === T_CONSTANT_ENCAPSED_STRING) $items[] = [substr($u[1], 1, -1), $u[2]]; else { $okList = false; break; }
        }
        if (!$okList || !$items) continue;
        if ($isFor) {
            if ($tx($m + 1)[0] === T_AS && $tx($m + 2)[0] === T_VARIABLE)
                $lists[] = ['kind' => 'foreach', 'line' => $t[2], 'var' => $tx($m + 2)[1], 'items' => $items];
        } else {
            $lists[] = ['kind' => 'const', 'line' => $t[2], 'var' => $tx($k + 1)[1], 'items' => $items];
        }
    }
    // Where a column LIST lives in PHP rather than in the SQL: \$fields = ['a' => …],
    // \$fields['b'] = …, \$sets[] = 'c = ?', in_array(\$k, \$allowed), and every
    // \$x = … assignment, so a statement's "set \$set" can be traced to its names.
    // (No backticks in this PHP: it lives inside a JS template literal.)
    $scanExpr = function ($k0) use (&$tx, $n, &$isStart, &$read, &$pos, &$T, &$sig) {
        $raw = ''; $keys = []; $items = []; $depth = 0; $first = $tx($k0);
        $arr = $first[1] === '[' || ($first[0] === T_ARRAY && $tx($k0 + 1)[1] === '(');
        $m = $k0;
        for (; $m < $n && strlen($raw) < 4000; $m++) {
            $t = $tx($m); $s = $t[1];
            if ($isStart($sig[$m])) {
                [, $e] = $read($sig[$m]);
                if ($arr && $depth === 1 && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
                    $after = $tx($m + 1);
                    $val = substr($s, 1, -1);
                    if ($after[0] === T_DOUBLE_ARROW) $keys[] = [$val, $t[2]];
                    elseif ($after[1] === ',' || $after[1] === ']' || $after[1] === ')') $items[] = [$val, $t[2]];
                }
                if ($t[0] === T_CONSTANT_ENCAPSED_STRING) $raw .= $s;
                else { for ($z = $sig[$m]; $z <= $e; $z++) $raw .= $T[$z][1]; }   // keeps the \$k of "\$k = ?"
                $m = $pos[$e]; continue;
            }
            if ($t[0] === null && ($s === '(' || $s === '[' || $s === '{') || $t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES) $depth++;
            elseif ($t[0] === null && ($s === ')' || $s === ']' || $s === '}')) { if ($depth === 0) break; $depth--; }
            elseif ($depth === 0 && ($s === ';' || $t[0] === T_CLOSE_TAG)) break;
            $raw .= $s . ' ';
        }
        return [$raw, $keys, $items];
    };
    $assigns = []; $keysets = []; $pushes = []; $inarr = [];
    for ($k = 0; $k < $n; $k++) {
        $t = $tx($k);
        if ($t[0] === T_STRING && strtolower($t[1]) === 'in_array' && $tx($k + 1)[1] === '(' && $tx($k + 2)[0] === T_VARIABLE
            && $tx($k + 3)[1] === ',' && $tx($k + 4)[0] === T_VARIABLE) { $inarr[] = [$tx($k + 2)[1], $tx($k + 4)[1], $t[2]]; continue; }
        if ($t[0] !== T_VARIABLE) continue;
        $nx = $tx($k + 1);
        if ($nx[0] === null && $nx[1] === '=') {
            [$raw, $keys, $items] = $scanExpr($k + 2);
            $assigns[] = [$t[1], $t[2], $raw, $keys, $items];
        } elseif ($nx[1] === '[' && $tx($k + 2)[0] === T_CONSTANT_ENCAPSED_STRING && $tx($k + 3)[1] === ']' && $tx($k + 4)[1] === '=') {
            $keysets[] = [$t[1], $t[2], substr($tx($k + 2)[1], 1, -1)];
        } elseif ($nx[1] === '[' && $tx($k + 2)[1] === ']' && $tx($k + 3)[1] === '=') {
            [$raw] = $scanExpr($k + 4);
            $pushes[] = [$t[1], $t[2], $raw];
        }
    }
    $result[] = ['file' => $file, 'chains' => $chains, 'lists' => $lists,
                 'assigns' => $assigns, 'keysets' => $keysets, 'pushes' => $pushes, 'inarr' => $inarr];
}
echo json_encode($result, JSON_INVALID_UTF8_SUBSTITUTE);
`
const phpFile = join(work, 'sua.php')
writeFileSync(phpFile, PHP)
function php (args, input) {
  const r = spawnSync('php', [phpFile, ...args], { input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`php ${args[0]} failed: ${(r.stderr || r.stdout).slice(0, 400)}`)
  return JSON.parse(r.stdout)
}

// ------------------------------------------------------------- the canary
// Every shape the scanner claims to read, each carrying a column (or table)
// that exists nowhere — or, for the last two shapes, only in FULL. Each must
// come back on its own line with its own verdict (CANARY_EXPECT). It is
// scanned with the real files and removed from the real report.
const CANARY = `<?php
function canary(PDO $db, $id, $x) {
    $db->prepare('select id, canary_col_a from orders where id = ?');                       // 3
    $db->query("select count(*) from orders where track_id = '$x' and canary_col_b = 1");  // 4
    $sql = 'select id from orders where id = ?';
    if ($x) $sql .= ' and canary_col_c = ?';                                                 // 6
    $db->prepare(
        'update products set name_en = ?, '
        . 'canary_col_d = ? where id = ?'                                                    // 9
    );
    $db->exec(<<<SQL
        insert into order_items (order_id, canary_col_e) values ($id, 1)
        SQL);                                                                                 // (the insert is line 12)
    foreach (['product_variants', 'canary_table_f'] as $t) {                                 // 14
        $db->prepare("update $t set slug = ? where slug = ?");
    }
    $db->prepare("update $x set canary_col_g = 1, stock = ? where id = ?");                  // 17 (static fallback; table dynamic, so not checkable)
    $db->prepare("insert into products (slug, canary_col_h) values (" . implode(',', $x) . ")"); // 18
    $db->prepare('select id from canary_table_i where id = :id');                            // 19
    $db->prepare('select id, name_en from products where slug = :slug');                     // 20 (good: must NOT be reported)
    $fields = ['name_en' => 1, 'canary_col_j' => 2];                                         // 21
    $fields['canary_col_k'] = 3;                                                             // 22
    $cols = array_keys($fields);
    $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
    $db->prepare("update products set $set where id = ? and canary_col_r = ?");              // 25: the WHERE of a PHP-built SET
    $allowed = ['customer_name', 'canary_col_l'];                                            // 26
    $sets = [];
    foreach ($x as $k => $v) { if (!in_array($k, $allowed, true)) continue; $sets[] = "\`$k\` = ?"; }
    $sets[] = 'canary_col_m = ?';                                                            // 29
    $db->prepare('update orders set ' . implode(', ', $sets) . ' where id = ?');            // 30
    $db->prepare('select id from canary_full_only where id = ?');                            // 31 BUNDLE-GAP: table
    $db->prepare('select canary_full_col from orders where id = ?');                         // 32 BUNDLE-GAP: column
    $where = [];
    if ($x) $where[] = 'canary_col_n = ?';                                                   // 34
    $sql = 'select id from orders' . ($where ? ' where ' . implode(' and ', $where) : '') . ' limit 5';
    $db->prepare($sql);
    $flt = $x ? 'and canary_col_o = 1' : '';                                                 // 37
    $db->query("select id from products where active = 1 $flt order by id");
    $db->query('select canary_col_p, count(distinct canary_col_q) from orders');             // 39: two in one statement
    foreach (['orders', 'products'] as $tt) {                                                // 40
        $db->prepare("update $tt set canary_col_s = ? where id = ?");                       // 41: a column, in each listed table
    }
}
`
// [what, line, kind] the canary must produce. canary_col_g is deliberately
// absent: its table is a variable, so nothing can say which table it belongs
// to. The two canary_full_* names are created in FULL only, after the import,
// so they are what a bundle gap looks like.
const CANARY_EXPECT = [
  ['canary_col_a', 3], ['canary_col_b', 4], ['canary_col_c', 6], ['canary_col_d', 9],
  ['canary_col_e', 12], ['canary_table_f', 14], ['canary_col_h', 18], ['canary_table_i', 19],
  ['canary_col_j', 21], ['canary_col_k', 22], ['canary_col_l', 26], ['canary_col_m', 29],
  ['canary_full_only', 31, 'BUNDLE-GAP'], ['canary_full_col', 32, 'BUNDLE-GAP'],
  ['canary_col_n', 34], ['canary_col_o', 37], ['canary_col_p', 39], ['canary_col_q', 39],
  ['canary_col_r', 25], ['canary_col_s', 41],
].map(([w, l, k = 'MISSING']) => [w, l, k])
const canaryFile = join(work, 'zz-canary.php')
writeFileSync(canaryFile, CANARY)

// ------------------------------------------------------------------- 1. schema
// The import runs as ROOT, so a schema file is trusted with every database on
// the machine. A `use other_db`, a `create/drop database`, or a name qualified
// with the shared sandbox (`sporta.orders`) would write OUTSIDE the scratch
// database — into the `sporta` sandbox other work is using. No schema file
// carries one today; refuse the file rather than find out by damage, and pass
// --one-database so the client itself skips anything aimed elsewhere.
function importInto (db, file) {
  const sql = readFileSync(file)
  const txt = sql.toString('utf8').replace(/sporta\.com\.kw/gi, '')
  const bad = /^\s*(use\s+`?\w|create\s+(database|schema)\b|drop\s+(database|schema)\b)/im.exec(txt) ||
    /(^|[^\w.-])`?sporta`?\s*\.\s*`?[A-Za-z_]/m.exec(txt)
  if (bad) {
    const at = txt.lastIndexOf('\n', bad.index + bad[0].length - 1) + 1
    const lineText = txt.slice(at, (txt.indexOf('\n', at) + 1 || txt.length + 1) - 1).trim().slice(0, 60)
    throw Object.assign(new Error(`${relative(REPO, file)} would write outside the scratch database ("${lineText}") — refusing to import it as root`), { stderr: '' })
  }
  root(['--one-database', db], sql)
}
let full, bundle
try {
  root(['-e', `drop database if exists \`${DB_FULL}\`; drop database if exists \`${DB_BUNDLE}\`;
    create database \`${DB_FULL}\` character set utf8mb4 collate utf8mb4_unicode_ci;
    create database \`${DB_BUNDLE}\` character set utf8mb4 collate utf8mb4_unicode_ci;`])
  importInto(DB_BUNDLE, BUNDLE_SQL)
  importInto(DB_FULL, BUNDLE_SQL)
  const apiSql = readdirSync(API_SQL_DIR).filter((n) => n.endsWith('.mysql.sql')).sort()
  for (const n of apiSql) importInto(DB_FULL, join(API_SQL_DIR, n))
  // Twice, so a file that ALTERs a table another (alphabetically later) file
  // creates is not reported as missing just because of import order.
  for (const n of apiSql) importInto(DB_FULL, join(API_SQL_DIR, n))
  // The canary's two bundle gaps: present in FULL, absent from BUNDLE.
  root([DB_FULL, '-e', 'create table canary_full_only (id int primary key); alter table orders add column canary_full_col int null'])
  const shape = (db) => {
    const m = new Map()
    const rows = root(['-N', '-B', '-e',
      `select table_name, column_name from information_schema.columns where table_schema = '${db}'`]).trim()
    for (const l of rows.split('\n')) { if (!l) continue; const [t, c] = l.split('\t'); if (!m.has(t)) m.set(t, new Set()); m.get(t).add(c) }
    return m
  }
  full = shape(DB_FULL)
  bundle = shape(DB_BUNDLE)
  say(`schema  bundle=${bundle.size} tables  full=${full.size - 1} tables (${apiSql.length} api/*.mysql.sql on top of IMPORT-THIS-ONE.sql; plus 1 canary table)`)
  if (bundle.size < 30 || full.size < bundle.size) { say('FAIL the scratch schema is implausibly small — nothing below would mean anything'); fails++ }
} catch (e) {
  say(`FAIL could not build the scratch schema: ${String(e.stderr || e.message).slice(0, 400)}`)
  cleanup(); process.exit(1)
}
const allColumns = new Set([...full.values()].flatMap((s) => [...s]))
const socket = root(['-N', '-B', '-e', 'select @@socket']).trim()

// --------------------------------------------------------------- 2. extract
let files
try { files = walk(SCAN_ROOT) } catch (e) { say(`FAIL cannot read SCAN_ROOT ${SCAN_ROOT}: ${e.code ?? e.message}`); process.exit(1) }
const extracted = php(['extract'], JSON.stringify([...files, canaryFile]))
const rel = (f) => f === canaryFile ? 'CANARY' : relative(SCAN_ROOT, f)

function render (parts, prefix) {
  let text = ''
  const map = [], exprs = []
  if (prefix != null) { text += marker(exprs.length) + ' '; exprs.push(prefix) }
  for (const p of parts) {
    if (p[0] === 'v') { text += marker(exprs.length); exprs.push(p[1]) }
    else { map.push([text.length, p[2]]); text += p[1] }
  }
  return { text, map, exprs }
}
function lineAt (st, offset) {
  let best = st.map[0] ?? [0, st.line]
  for (const m of st.map) if (m[0] <= offset) best = m
  return best[1] + (st.text.slice(best[0], Math.max(best[0], offset)).match(/\n/g)?.length ?? 0)
}

// A statement, not the bare word: 'with' and 'delete' are also array keys and
// route names, and 'DELETE' is an HTTP method.
const DML = /^\(?\s*(select\s+\S|insert\s+(ignore\s+)?into\b|update\s+\S|delete\s+(from\b|\w+\s+from\b)|replace\s+into\b|with\s+(recursive\s+)?\w+\s+as\s*\()/i
const SKIP = /information_schema|^\s*\(?\s*(create|alter|drop|show|set|start|commit|rollback|lock|unlock|truncate|explain|describe|analyze|optimize|repair|flush|grant|use)\b/i
const statements = []       // {file, line, text, map, from}
const lists = []
let chainsSeen = 0, fragments = 0
const callUnread = []      // ->prepare('…') / ->query / ->exec literals the classifier did not take
const fileAssigns = new Map()   // file -> [{v, line, parts, prefix}]: `$x = '…'` string assignments
const fileFlow = new Map()      // file -> every `$x = …`, `$x['k'] = …`, `$x[] = …` and in_array($a, $b)
for (const f of extracted) {
  const file = rel(f.file)
  for (const l of f.lists) lists.push({ ...l, file })
  fileFlow.set(file, { assigns: f.assigns, keysets: f.keysets, pushes: f.pushes, inarr: f.inarr })
  const bases = new Map()   // var -> {parts, line, prefix}
  const assigns = []
  fileAssigns.set(file, assigns)
  for (const c of f.chains) {
    chainsSeen++
    const r = render(c.parts, c.prefix)
    const head = r.text.trimStart()
    if (c.append && bases.has(c.append)) {
      // `$sql .= ' and x = ?'` — append to the statement built so far, as if
      // every condition were true. Each step is a statement of its own.
      const b = bases.get(c.append)
      if (c.line - b.lastLine <= 120) {
        b.parts = [...b.parts, ['s', ' ', c.line], ...c.parts]
        b.lastLine = c.line
        const rr = render(b.parts, b.prefix)
        if (DML.test(rr.text.trimStart()) && !SKIP.test(rr.text)) statements.push({ file, line: c.line, ...rr, from: 'append' })
        continue
      }
    }
    if (c.assign) { bases.set(c.assign, { parts: c.parts, prefix: c.prefix, lastLine: c.line }); assigns.push({ v: c.assign, line: c.line, parts: c.parts, prefix: c.prefix }) }
    if (c.call && !DML.test(head) && !SKIP.test(r.text)) callUnread.push(`${file}:${c.line} ${head.slice(0, 50).replace(/\s+/g, ' ')}`)
    if (c.prefix != null || !DML.test(head)) { if (/^\s*(and|or|where|order|limit|,|set|join|left)\b/i.test(head)) { fragments++; if (process.env.DEBUG) console.error(`FRAG ${file}:${c.line} ${head.slice(0, 90).replace(/\s+/g, ' ')}`) } continue }
    if (SKIP.test(r.text)) continue
    statements.push({ file, line: c.line, ...r, from: 'literal' })
  }
}

// ---------------------------------------------------------------- 3. prepare
// Named PDO placeholders become `?`; every PHP expression becomes `?`. A
// string with two statements is split on `;` outside quotes AND comments — a
// `;` in an SQL comment (admin.php's customers query has one) is prose.
function splitStatements (sql) {
  const parts = []; let cur = '', q = null, start = 0
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (q) { if (ch === '\\') { cur += ch + (sql[++i] ?? ''); continue } if (ch === q) q = null; cur += ch; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue }
    if ((ch === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? ' ')) || ch === '#') {
      const e = sql.indexOf('\n', i); const end = e < 0 ? sql.length : e
      cur += sql.slice(i, end); i = end - 1; continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const e = sql.indexOf('*/', i + 2); const end = e < 0 ? sql.length : e + 2
      cur += sql.slice(i, end); i = end - 1; continue
    }
    if (ch === ';') { parts.push([start, cur]); cur = ''; start = i + 1; continue }
    cur += ch
  }
  parts.push([start, cur])
  return parts.filter(([, s]) => s.trim())
}
const NAMED = /(^|[^:\w]):[A-Za-z_][A-Za-z0-9_]*/g
// A SECOND READING. The first turns every PHP expression into `?`, which is
// always safe and often blind: `where ⟦$where⟧` prepares as `where ?` and the
// columns inside $where are never seen. The second reading puts back what each
// expression most plausibly holds, evaluated from literals only —
//   `$filtered`, assigned a string a few lines up        -> that string
//   `$c ? ', logo = ?' : ''`, `$x ? ' where ' . … : ''`  -> its non-empty arm
//   `implode(' and ', $where)` after `$where[] = 'a = ?'` -> `a = ? and …`
//   after `=`, `(`, `,`, `limit`, `in`, `and` …           -> `?`, a value
//   anywhere else (`from t $where order by`)             -> nothing: the optional clause left out
// It is run when the first reading would not parse, and whenever it put a
// literal back; its verdict is taken unless it is itself a syntax error.
const VALUE_CTX = /(?:[=<>(,+\-*/%]|\b(?:limit|offset|in|like|and|or|then|else|when|by|interval|not|is|between|values|select|regexp|case|div|mod)\b)\s*$/i
const LIT = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/
function unq (lit) {
  const q = lit[0], inner = lit.slice(1, -1)
  if (q === "'") return inner.replace(/\\(['\\])/g, '$1')
  if (/(^|[^\\])\$/.test(inner)) return null                          // interpolated: unknown
  return inner.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c)
}
// Split at depth 0, outside quotes. `at` decides whether position i is a separator.
function scanTop (e, at) {
  let depth = 0, q = null
  for (let i = 0; i < e.length; i++) {
    const ch = e[i]
    if (q) { if (ch === '\\') { i++; continue } if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"') { q = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0 && at(i)) return i
  }
  return -1
}
function evalExpr (e, file, line, depth = 0) {
  if (depth > 4 || e == null) return null
  e = e.trim()
  while (e.startsWith('(') && scanTop(e.slice(1), (i) => false) === -1 && (() => { let d = 0, q = null; for (let i = 0; i < e.length; i++) { const ch = e[i]; if (q) { if (ch === '\\') { i++; continue } if (ch === q) q = null; continue } if (ch === "'" || ch === '"') { q = ch; continue } if (ch === '(') d++; if (ch === ')') { d--; if (d === 0 && i < e.length - 1) return false } } return true })()) e = e.slice(1, -1).trim()
  // cond ? a : b   (not ?? and not ?->)
  const qi = scanTop(e, (i) => e[i] === '?' && e[i + 1] !== '?' && e[i - 1] !== '?' && e[i + 1] !== '-')
  if (qi > 0) {
    let nest = 0
    const ci = scanTop(e.slice(qi + 1), (i) => { const ch = e[qi + 1 + i]; if (ch === '?') nest++; if (ch === ':' && e[qi + 2 + i] !== ':') { if (nest === 0) return true; nest-- } return false })
    if (ci < 0) return null
    const a = evalExpr(e.slice(qi + 1, qi + 1 + ci), file, line, depth + 1)
    if (a != null && a.trim()) return a
    const b = evalExpr(e.slice(qi + 2 + ci), file, line, depth + 1)
    return b != null && b.trim() ? b : (a ?? b)
  }
  const dot = scanTop(e, (i) => e[i] === '.' && !/\d/.test(e[i - 1] ?? '') && e[i + 1] !== '=')
  if (dot > 0) {
    const l = evalExpr(e.slice(0, dot), file, line, depth + 1), r = evalExpr(e.slice(dot + 1), file, line, depth + 1)
    return l == null || r == null ? null : l + r
  }
  if (LIT.test(e)) return unq(e)
  const im = /^implode\s*\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(\$\w+)\s*\)$/.exec(e)
  if (im) {
    const sep = unq(im[1]); const flow = fileFlow.get(file)
    if (sep == null || !flow) return null
    let from = -1
    for (const a of flow.assigns) if (a[0] === im[2] && a[1] < line && line - a[1] <= 80) from = a[1]
    if (from < 0) return null                                         // no `$where = []` in reach: not this function's list
    const vals = []
    for (const [pv, pl, raw] of flow.pushes) {
      if (pv !== im[2] || pl < from || pl >= line) continue
      const v = evalExpr(raw, file, pl, depth + 1)
      if (v != null && v.trim()) vals.push(v)
    }
    return vals.length ? vals.join(sep) : null
  }
  if (/^\$\w+$/.test(e)) return resolveVar(file, line, e, depth + 1)
  return null
}
function resolveVar (file, line, name, depth = 0) {
  let chain = null, flowA = null
  for (const a of fileAssigns.get(file) ?? []) if (a.v === name && a.line < line && line - a.line <= 80) chain = a
  for (const a of fileFlow.get(file)?.assigns ?? []) if (a[0] === name && a[1] < line && line - a[1] <= 80) flowA = a
  if (chain && (!flowA || chain.line >= flowA[1])) {
    const r = render(chain.parts, chain.prefix)
    return depth > 4 ? null : secondReading(r.text, r.exprs, file, chain.line, depth + 1).text
  }
  return flowA ? evalExpr(flowA[2], file, flowA[1], depth + 1) : null
}
function secondReading (text, exprs, file, line, depth = 0) {
  let used = false
  const out = text.replace(VAR_G, (m, off) => {
    const expr = (exprs[+m.slice(2, -1)] ?? '').trim()
    const v = depth < 4 ? evalExpr(expr, file, line, depth) : null
    if (v != null && v.trim()) { used = true; return ' ' + v + ' ' }
    return VALUE_CTX.test(text.slice(0, off)) ? '?' : ' '
  })
  return { text: out, used }
}
const jobs = []   // {st, offset, sql}
for (const st of statements) {
  for (const [off, piece] of splitStatements(st.text)) {
    if (!DML.test(piece.trimStart()) || SKIP.test(piece)) continue
    const sql = piece.replace(VAR_G, '?').replace(NAMED, '$1?')
    let sql2 = null, used = false
    if (piece.search(VAR_G) >= 0) { const r = secondReading(piece, st.exprs, st.file, st.line); sql2 = r.text.replace(NAMED, '$1?'); used = r.used }
    jobs.push({ st, offset: off, raw: piece, sql, sql2, used })
  }
}
const byId = Object.fromEntries(jobs.map((j, i) => [i, j.sql]))
const resFull = php(['prepare', DB_FULL, socket], JSON.stringify(byId))
const resBundle = php(['prepare', DB_BUNDLE, socket], JSON.stringify(byId))
// The second reading's verdict replaces the first's unless it is a syntax
// error — and a name the substitution itself produced (`orders_⟦V⟧` read as
// `orders_`) is not a name the code contains, so an error naming a word that
// touches an expression in the source is not believed either.
const isSyntax = (e) => e && (e[0] === 1064 || e[0] === 1149)
const retry = Object.fromEntries(jobs.map((j, i) => [i, j]).filter(([i, j]) => j.sql2 && (j.used || isSyntax(resFull[i]))).map(([i, j]) => [i, j.sql2]))
const retryFull = Object.keys(retry).length ? php(['prepare', DB_FULL, socket], JSON.stringify(retry)) : {}
const retryBundle = Object.keys(retry).length ? php(['prepare', DB_BUNDLE, socket], JSON.stringify(retry)) : {}
let reread = 0, evaluated = 0
for (const i of Object.keys(retryFull)) {
  const e = retryFull[i]
  if (isSyntax(e)) continue
  if (e && ![1146, 1054].includes(e[0]) && !isSyntax(resFull[i])) continue
  const named = e ? ((e[1].match(/'([^']+)'/) ?? [])[1] ?? '').split('.').pop().replace(/\W/g, '') : ''
  if (named && new RegExp(`${named}${VAR_SRC}|${VAR_SRC}${named}`).test(jobs[i].raw)) continue
  if (isSyntax(resFull[i])) reread++
  if (jobs[i].used) evaluated++
  if (process.env.DEBUG && jobs[i].used) console.error(`EVAL ${jobs[i].st.file}:${jobs[i].st.line} ${jobs[i].sql2.replace(/\s+/g, ' ').slice(0, 260)}`)
  resFull[i] = e; resBundle[i] = retryBundle[i]; jobs[i].sql = jobs[i].sql2
}

// A prepare stops at the FIRST unknown column. To report every one, put
// `null` where each found name was and prepare again, up to five rounds.
function moreUnknowns (db, res, sqlOf = (i) => jobs[i].sql) {
  const more = new Map()                        // job index -> [[code, msg], ...]
  let pending = Object.keys(res).filter((i) => res[i] && res[i][0] === 1054).map((i) => [i, sqlOf(i), res[i]])
  for (let round = 0; round < 5 && pending.length; round++) {
    const batch = {}
    for (const [i, sql, err] of pending) {
      const name = (err[1].match(/Unknown column '([^']+)'/) ?? [])[1]
      if (!name) continue
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const next = sql.replace(new RegExp(name.includes('.') ? `\\b${esc}\\b` : `(?<![.\\w\`])${esc}\\b`, 'g'), 'null')
      if (next !== sql) batch[i] = next
    }
    if (!Object.keys(batch).length) break
    const r = php(['prepare', db, socket], JSON.stringify(batch))
    pending = []
    for (const i of Object.keys(r)) {
      if (!r[i] || ![1054, 1146].includes(r[i][0])) continue
      if (!more.has(i)) more.set(i, [])
      more.get(i).push(r[i])
      if (r[i][0] === 1054) pending.push([i, batch[i], r[i]])
    }
  }
  return more
}
const moreFull = moreUnknowns(DB_FULL, resFull)
const moreBundle = moreUnknowns(DB_BUNDLE, resBundle)

// ---------------------------------------------------------------- 4. judge
const NAME_ERR = new Set([1146, 1054])
// Statements the static pass re-prepares with their dynamic part stood in for
// (see staticCheck and the table lists): {job, sql, gapsOnly, how, table?}.
const probes = []
const findings = []   // {kind, ref, file, line, how}
const dynamic = []
let prepared = 0, staticChecked = 0, phpChecked = 0, phpNames = 0
const seen = new Set()
function add (kind, ref, job, needle, how) {
  let off = job.offset, at = null
  if (needle) {
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const m = re.exec(job.raw)
    if (m) off = job.offset + m.index
    else {
      // The name came from a clause the second reading put back: point at the
      // PHP line that wrote it ($where[] = '…', $x = '…'), not at the statement.
      const flow = fileFlow.get(job.st.file)
      for (const [, l, raw] of [...(flow?.pushes ?? []), ...(flow?.assigns ?? [])]) {
        if (l <= job.st.line && job.st.line - l <= 80 && re.test(raw) && (at === null || l > at)) at = l
      }
    }
  }
  const line = at ?? lineAt(job.st, off)
  const key = `${kind}|${ref}|${job.st.file}|${line}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ kind, ref, file: job.st.file, line, how })
}
// The table(s) a statement names, for turning "Unknown column 'x'" into t.x.
function tablesOf (sql) {
  const ts = new Set(); const alias = new Map()
  for (const m of sql.matchAll(/\b(?:from|join|into|update)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?)?/gi)) {
    if (!full.has(m[1]) && !bundle.has(m[1])) continue
    ts.add(m[1])
    if (m[2] && !/^(where|set|on|join|left|right|inner|outer|cross|group|order|limit|values|value|select|using|natural|straight_join|union|having|for|lock|force|use|ignore|partition)$/i.test(m[2])) alias.set(m[2], m[1])
  }
  return { ts: [...ts], alias }
}
function colRef (sql, name) {
  const { ts, alias } = tablesOf(sql)
  const dot = name.indexOf('.')
  if (dot > 0) { const a = name.slice(0, dot); return `${alias.get(a) ?? ts.find((t) => t === a) ?? a}.${name.slice(dot + 1)}` }
  // An unqualified column: name the one table that lacks it, if only one does.
  const lacking = ts.filter((t) => !full.get(t)?.has(name))
  return `${lacking.length === 1 ? lacking[0] : ts.length === 1 ? ts[0] : `{${ts.join('|')}}`}.${name}`
}
function nameFromError (code, msg) {
  if (code === 1146) return { table: (msg.match(/Table '[^.']*\.([^']+)' doesn't exist/) ?? [])[1] }
  if (code === 1054) return { column: (msg.match(/Unknown column '([^']+)'/) ?? [])[1] }
  return {}
}

// A COLUMN LIST HELD IN PHP. `update hero_slides set $set` names its columns as
// the keys of a `$fields` array three assignments away. Follow the variables
// the statement's expressions mention back through their assignments (80 lines,
// four hops), and collect the literal names on the way: keys and items of an
// array literal, `$x['k'] =`, `$sets[] = 'k = ?'`, and the whitelist of an
// `in_array($k, $allowed)` guarding a reached `$k`.
function phpColumns (st, piece) {
  const flow = fileFlow.get(st.file)
  if (!flow) return []
  const lo = st.line - 80
  const queue = []
  for (const m of piece.matchAll(VAR_G)) for (const v of (st.exprs[+m[0].slice(2, -1)] ?? '').matchAll(/\$\w+/g)) queue.push([v[0], 0])
  const seen = new Set(), cols = []
  const mention = (raw, d) => { for (const v of raw.matchAll(/\$\w+/g)) queue.push([v[0], d + 1]) }
  while (queue.length) {
    const [v, d] = queue.shift()
    if (seen.has(v) || d > 4 || /^\$(db|pdo|this|_GET|_POST|_SERVER|e)$/.test(v)) continue
    seen.add(v)
    let as = null
    for (const a of flow.assigns) if (a[0] === v && a[1] < st.line && a[1] >= lo) as = a
    const from = as ? as[1] : lo
    if (as) { mention(as[2], d); for (const [k, line] of [...as[3], ...as[4]]) cols.push([k, line]) }
    for (const [kv, line, key] of flow.keysets) if (kv === v && line >= from && line < st.line) cols.push([key, line])
    for (const [pv, line, raw] of flow.pushes) {
      if (pv !== v || line < from || line >= st.line) continue
      mention(raw, d)
      const m = /^\s*(['"])\s*`?([A-Za-z_]\w*)`?\s*=\s*[^'"]*\1\s*$/.exec(raw)
      if (m) cols.push([m[2], line])
    }
    for (const [a, b, line] of flow.inarr) if (a === v && line < st.line && line >= lo) queue.push([b, d + 1])
  }
  return cols.filter(([k]) => /^[A-Za-z_]\w*$/.test(k))
}

const KW = /^(select|set|values|value|dual|where|on|as|lateral|json_table|ignore|low_priority|high_priority|delayed|quick)$/i
function staticCheck (job, gapsOnly = false) {
  staticChecked++
  if (process.env.DEBUG) console.error(`STATIC ${job.st.file}:${lineAt(job.st, job.offset)} ${job.sql.replace(/\s+/g, ' ').slice(0, 220)}`)
  // gapsOnly: the statement PREPARED in FULL, so MariaDB has already said every
  // name in it exists somewhere; only the bundle half can still be wrong.
  const miss = (ref, needle, how) => { if (!gapsOnly) add('MISSING', ref, job, needle, how) }
  const s = job.raw
  // English that happens to start "Update the…" or "Select a…" is not SQL; a
  // statement has at least one of these.
  const looksSql = /[=?(`*]|\b(where|set|values|limit)\b/i.test(s.replace(VAR_G, ''))
  for (const m of looksSql ? s.matchAll(/\b(from|join|into|update)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi) : []) {
    const kw = m[1].toLowerCase(); const name = m[2]
    const before = s.slice(Math.max(0, m.index - 12), m.index)
    if (kw === 'update' && /\b(key|for)\s+$/i.test(before)) continue        // on duplicate key update / for update
    if (KW.test(name)) continue
    if (kw === 'from' && allColumns.has(name) && !full.has(name)) continue  // extract(x from col), trim(... from col)
    if (!full.has(name)) miss(name, name, 'static: table')
    else if (!bundle.has(name)) add('BUNDLE-GAP', name, job, name, 'static: table')
  }
  if (new RegExp(`(?<!\\bkey\\s+)\\b(from|join|into|update)\\s+\`?${VAR_SRC}`, 'i').test(s)) dynamic.push(job)   // not "on duplicate key update $x"
  const ins = s.match(/\binsert\s+(?:ignore\s+)?into\s+`?([A-Za-z_]\w*)`?\s*\(([^()]*)\)/i)
  if (ins && full.has(ins[1])) {
    for (const raw of ins[2].split(',')) {
      const c = raw.trim().replace(/`/g, '')
      if (!/^[A-Za-z_]\w*$/.test(c)) continue
      if (!full.get(ins[1]).has(c)) miss(`${ins[1]}.${c}`, c, 'static: insert column')
      else if (bundle.has(ins[1]) && !bundle.get(ins[1]).has(c)) add('BUNDLE-GAP', `${ins[1]}.${c}`, job, c, 'static: insert column')
    }
  }
  const dynCols = s.match(new RegExp(`\\bupdate\\s+\`?([A-Za-z_]\\w*)\`?\\s+set\\s+${VAR_SRC}`, 'i')) ||
    s.match(new RegExp(`\\binsert\\s+(?:ignore\\s+)?into\\s+\`?([A-Za-z_]\\w*)\`?\\s*\\([^()]*${VAR_SRC}`, 'i'))
  if (dynCols && full.has(dynCols[1])) {
    const t = dynCols[1]
    phpChecked++
    const traced = phpColumns(job.st, s)
    if (process.env.DEBUG) console.error(`PHPCOLS ${job.st.file}:${job.st.line} ${t}: ${traced.map(([c, l]) => `${c}@${l}`).join(' ')}`)
    for (const [c, line] of traced) {
      phpNames++
      const at = { ...job, st: { ...job.st, map: [[0, line]], text: '' }, offset: 0, raw: '' }
      if (!full.get(t).has(c)) { if (!gapsOnly) add('MISSING', `${t}.${c}`, at, null, 'column named in PHP') }
      else if (bundle.has(t) && !bundle.get(t).has(c)) add('BUNDLE-GAP', `${t}.${c}`, at, null, 'column named in PHP')
    }
    // The checks above read only the SET list. Everything after it — the
    // WHERE, a join, a subquery — would go unchecked, because `set ⟦$set⟧`
    // will not prepare. So stand one real column in for the list and let
    // MariaDB resolve the rest (admin.php's `update orders set ' . implode(…)
    // . ' where id = ?'` had its `id` checked by nothing until this).
    if (new RegExp(`\\bupdate\\s+\`?${t}\`?\\s+set\\s+${VAR_SRC}`, 'i').test(s)) {
      const cols = [...full.get(t)]
      const stand = cols.includes('id') && (!bundle.has(t) || bundle.get(t).has('id')) ? 'id'
        : cols.find((c) => !bundle.has(t) || bundle.get(t).has(c)) ?? cols[0]
      const sql = s.replace(new RegExp(`(\\bset\\s+)${VAR_SRC}`, 'i'), `$1\`${stand}\` = ?`)
      if (sql !== s) probes.push({ job, sql: sql.replace(VAR_G, '?').replace(NAMED, '$1?'), gapsOnly, how: 'prepare, column list stood in for' })
    }
  }
  const up = s.match(/\bupdate\s+`?([A-Za-z_]\w*)`?\s+(?:(?:as\s+)?[A-Za-z_]\w*\s+)?set\s+([\s\S]*?)(?:\bwhere\b|$)/i)
  if (up && full.has(up[1])) {
    let depth = 0, cur = '', items = []
    for (const ch of up[2]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { items.push(cur); cur = '' } else cur += ch }
    items.push(cur)
    for (const it of items) {
      const m = it.match(/^\s*`?(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)`?\s*=/)
      if (!m) continue
      if (!full.get(up[1]).has(m[1])) miss(`${up[1]}.${m[1]}`, m[1], 'static: update set')
      else if (bundle.has(up[1]) && !bundle.get(up[1]).has(m[1])) add('BUNDLE-GAP', `${up[1]}.${m[1]}`, job, m[1], 'static: update set')
    }
  }
}

const otherErrors = []
jobs.forEach((job, i) => {
  const ef = resFull[i], eb = resBundle[i]
  for (const [code, msg] of moreFull.get(String(i)) ?? []) {
    const n = nameFromError(code, msg)
    if (n.table) add('MISSING', n.table, job, n.table, 'prepare, later round')
    else if (n.column) add('MISSING', colRef(job.sql, n.column), job, n.column.split('.').pop(), 'prepare, later round')
  }
  if (!ef) for (const [code, msg] of moreBundle.get(String(i)) ?? []) {
    const n = nameFromError(code, msg)
    if (n.table) add('BUNDLE-GAP', n.table, job, n.table, 'prepare (bundle), later round')
    else if (n.column) add('BUNDLE-GAP', colRef(job.sql, n.column), job, n.column.split('.').pop(), 'prepare (bundle), later round')
  }
  if (!ef) {
    prepared++
    if (eb && NAME_ERR.has(eb[0])) {
      const n = nameFromError(eb[0], eb[1])
      if (n.table) add('BUNDLE-GAP', n.table, job, n.table, 'prepare (bundle)')
      else if (n.column) add('BUNDLE-GAP', colRef(job.sql, n.column), job, n.column.split('.').pop(), 'prepare (bundle)')
    } else if (eb) otherErrors.push({ job, err: eb, where: 'bundle' })
    // The bundle may lack a second name the first error hid; the static pass
    // reads every literal one, so run it too.
    if (eb) staticCheck(job, true)
    return
  }
  // `from \`' . $t . '\`` becomes `from \`?\`` — a table literally named "?",
  // which MariaDB rightly cannot find. That is a dynamic name, not a missing one.
  if (NAME_ERR.has(ef[0]) && /'[^']*\?[^']*'/.test(ef[1].replace(/^Table '[^.']*\./, "'"))) { staticCheck(job); return }
  if (NAME_ERR.has(ef[0])) {
    const n = nameFromError(ef[0], ef[1])
    if (n.table) add('MISSING', n.table, job, n.table, 'prepare')
    else if (n.column) add('MISSING', colRef(job.sql, n.column), job, n.column.split('.').pop(), 'prepare')
    staticCheck(job)   // a prepare stops at the FIRST unknown name
    return
  }
  if (ef[0] === 1064 || ef[0] === 1149) { staticCheck(job); return }   // dynamic part made it unpreparable
  otherErrors.push({ job, err: ef, where: 'full' })
  staticCheck(job)
})

// Literal lists of table names: foreach (['a','b'] as $t) used as a table, and const *_TABLES.
// The markers a statement uses as its TABLE, with the PHP expression each stands for.
const tableExprs = (text, exprs) => [...text.matchAll(new RegExp(`(?<!\\bkey\\s+)\\b(?:from|into|update|join)\\s+\`?(${VAR_SRC})`, 'gi'))]
  .map((m) => ({ marker: m[1], expr: (exprs[+m[1].slice(2, -1)] ?? '').replace(/[{}\s]/g, '') }))
let listChecks = 0
for (const l of lists) {
  let users = []
  if (l.kind === 'foreach') {
    // Statements in the loop whose table IS the loop variable — not merely any
    // dynamic table nearby, which would read a list of keys as a list of tables.
    users = jobs.filter((j) => j.st.file === l.file && j.st.line >= l.line && j.st.line <= l.line + 12 &&
      tableExprs(j.raw, j.st.exprs).some((x) => x.expr === l.var))
    if (!users.length) continue
  }
  for (const [t, line] of l.items) {
    listChecks++
    const job = { st: { file: l.file, line, map: [[0, line]], text: '' }, offset: 0, raw: '' }
    if (!full.has(t)) add('MISSING', t, job, null, `table list ${l.var}`)
    else if (!bundle.has(t)) add('BUNDLE-GAP', t, job, null, `table list ${l.var}`)
    if (!full.has(t)) continue
    // The table existing is half of it: `update $child set slug = ?` must also
    // find `slug` in EACH table the loop hands it. Prepare it once per table.
    for (const j of users) {
      let sql = j.raw
      for (const x of tableExprs(j.raw, j.st.exprs)) if (x.expr === l.var) sql = sql.split(x.marker).join(t)
      probes.push({ job: j, sql: sql.replace(VAR_G, '?').replace(NAMED, '$1?'), gapsOnly: false, how: `prepare, as table ${t} of ${l.var}`, table: t })
    }
  }
}

// The probes. Only unknown COLUMNS are taken from them: every table a probe
// names was put there by this script and is judged by the checks above.
let probedOk = 0
if (probes.length) {
  const sqls = Object.fromEntries(probes.map((p, i) => [i, p.sql]))
  const pf = php(['prepare', DB_FULL, socket], JSON.stringify(sqls))
  const pb = php(['prepare', DB_BUNDLE, socket], JSON.stringify(sqls))
  const sqlOf = (i) => probes[i].sql
  const mf = moreUnknowns(DB_FULL, pf, sqlOf), mb = moreUnknowns(DB_BUNDLE, pb, sqlOf)
  const cols = (i, first, more) => [first, ...(more.get(String(i)) ?? [])]
    .filter((e) => e && e[0] === 1054).map((e) => nameFromError(e[0], e[1]).column).filter(Boolean)
  probes.forEach((p, i) => {
    if (!pf[i] || pf[i][0] === 1054) probedOk++
    if (process.env.DEBUG) console.error(`PROBE ${p.job.st.file}:${p.job.st.line} ${pf[i] ? pf[i].join(' ') : 'ok'} :: ${p.sql.replace(/\s+/g, ' ').slice(0, 200)}`)
    const ref = (n) => p.table ? `${p.table}.${n.split('.').pop()}` : colRef(p.sql, n)
    if (!p.gapsOnly) for (const n of cols(i, pf[i], mf)) add('MISSING', ref(n), p.job, n.split('.').pop(), p.how)
    if (!pf[i]) for (const n of cols(i, pb[i], mb)) add('BUNDLE-GAP', ref(n), p.job, n.split('.').pop(), p.how)
  })
}

// ----------------------------------------------------------------- 5. report
const canary = findings.filter((f) => f.file === 'CANARY')
const real = findings.filter((f) => f.file !== 'CANARY')
const realJobs = jobs.filter((j) => j.st.file !== 'CANARY')
const realPrepared = prepared - jobs.filter((j, i) => j.st.file === 'CANARY' && !resFull[i]).length

say(`scanned ${files.length} .php files under ${relative(REPO, SCAN_ROOT) || SCAN_ROOT}: ${chainsSeen} string chains, ${realJobs.length} statements, ${realPrepared} prepared cleanly in FULL (${reread} only on a second reading; ${evaluated} read with their PHP-built clauses put back), ${staticChecked} checked statically (${phpChecked} with a column list built in PHP, ${phpNames} names traced), ${fragments} fragments not checkable, ${listChecks} names from literal table lists, ${probes.length} re-prepared with the dynamic part stood in for (${probedOk} resolved)`)

let canaryOk = true
for (const [what, line, kind] of CANARY_EXPECT) {
  const hit = canary.find((f) => f.ref.split('.').pop() === what && f.line === line && f.kind === kind)
  if (!hit) { canaryOk = false; say(`FAIL CANARY ${kind} ${what} on canary line ${line} was not caught — got: ${canary.filter((f) => f.ref.includes(what)).map((f) => `${f.kind} ${f.ref}:${f.line}`).join(', ') || 'nothing'}`) }
}
const canaryFalse = canary.filter((f) => !CANARY_EXPECT.some(([w]) => f.ref.split('.').pop() === w))
for (const f of canaryFalse) { canaryOk = false; say(`FAIL CANARY false positive ${f.kind} ${f.ref} on canary line ${f.line}`) }
if (canaryOk) say(`ok   canary: all ${CANARY_EXPECT.length} planted names caught on their own lines with the right verdict, and the one good statement was not`)
else fails++

const defaultRoot = !process.env.SCAN_ROOT || process.env.SCAN_ROOT.replace(/\/$/, '') === join(REPO, 'sporta-site/public_html')
if (!defaultRoot && process.env.FLOOR !== '1') say(`--   floor not applied: SCAN_ROOT is not the shop's docroot (FLOOR=1 applies it anyway, e.g. to a full copy)`)
else if (realJobs.length < FLOOR_STATEMENTS || realPrepared < FLOOR_PREPARED) {
  fails++; say(`FAIL FLOOR found ${realJobs.length} statements / prepared ${realPrepared} — a working scan finds ≥${FLOOR_STATEMENTS} / ≥${FLOOR_PREPARED}; the extractor has stopped reading something`)
}

// Every literal handed straight to ->prepare() / ->query() / ->exec() must have
// been read as a statement (or deliberately skipped as DDL). One that was not
// is SQL this scanner silently did not check.
const unread = callUnread.filter((u) => !u.startsWith('CANARY'))
for (const u of unread) say(`FAIL UNREAD a literal passed to the database was not read as SQL -> ${u}`)
fails += unread.length

const order = { MISSING: 0, 'BUNDLE-GAP': 1 }
real.sort((a, b) => order[a.kind] - order[b.kind] || a.ref.localeCompare(b.ref) || a.file.localeCompare(b.file) || a.line - b.line)
for (const f of real) say(`${f.kind === 'MISSING' ? 'FAIL MISSING   ' : (GAPS_WARN ? 'WARN BUNDLE-GAP' : 'FAIL BUNDLE-GAP')} ${f.ref} -> ${f.file}:${f.line}   (${f.how})`)
const missing = real.filter((f) => f.kind === 'MISSING').length
const gaps = real.filter((f) => f.kind === 'BUNDLE-GAP')
if (gaps.length) {
  const gapTables = [...new Set(gaps.map((g) => g.ref.split('.')[0]))]
  const owners = gapTables.map((t) => {
    for (const n of readdirSync(API_SQL_DIR).filter((x) => x.endsWith('.mysql.sql'))) {
      if (new RegExp(`create table if not exists\\s+\`?${t}\\b`, 'i').test(readFileSync(join(API_SQL_DIR, n), 'utf8'))) return `${t} (api/${n})`
    }
    return t
  })
  say(`     bundle gaps: ${owners.join(', ')} — created by a file IMPORT-THIS-ONE.sql does not include (scripts/make-install-sql.mjs PARTS)`)
}
fails += missing + (GAPS_WARN ? 0 : gaps.length)

for (const o of otherErrors.filter((x) => x.job.st.file !== 'CANARY')) {
  say(`NOTE PREPARE-ERROR ${o.err[0]} ${o.err[1].slice(0, 120)} -> ${o.job.st.file}:${lineAt(o.job.st, o.job.offset)} (${o.where})`)
}
const dyn = [...new Map(dynamic.filter((j) => j.st.file !== 'CANARY').map((j) => [`${j.st.file}:${lineAt(j.st, j.offset)}`, j])).keys()]
if (dyn.length) say(`NOTE ${dyn.length} statement(s) take their TABLE from a variable and are checked only through literal lists: ${dyn.join(', ')}`)

cleanup()
say(fails ? `\n${fails} unresolved`
  : gaps.length ? `\nno MISSING — every name exists in some schema file; ${gaps.length} bundle gap(s) WARNED, so a fresh install from IMPORT-THIS-ONE.sql still lacks ${[...new Set(gaps.map((g) => g.ref.split('.')[0]))].length} table(s)`
  : `\nall ok — every table and column the PHP names exists in a fresh install`)
process.exit(fails ? 1 : 0)
