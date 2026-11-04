#!/usr/bin/env node
// Builds the database-connection hardening patch from the CURRENT tree, as text edits with exact-match guards.
//
//   node ops/db/make-connect-patch.mjs                 write ops/db/db-connect.patch (against the tree) and, when
//                                                      ops/db/php-roles.patch applies, db-connect-after-roles.patch
//   node ops/db/make-connect-patch.mjs --check         exit 1 when either file is stale
//   node ops/db/make-connect-patch.mjs --tree DIR      apply the edits to DIR (a COPY of dropin/) instead
//
// WHY A GENERATOR: the release gate is editing these files. A patch made by hand goes stale on the next commit; this
// one re-derives itself from whatever is there and REFUSES (names the pattern it could not find) when a file moved.
// WHY TWO PATCHES: lane D1's php-roles.patch edits the same `new PDO(` call in store_db(). The edits here replace only
// the OPTIONS ARRAY and the lines around the catch, which php-roles.patch does not touch, so both orders apply; the
// second file is simply the same edits recorded against a tree that already carries the roles patch.
//
// WHAT THE PATCH DOES (details and measurements: ops/db/DB-CONNECT.md)
//   config-path.php  one place for how PHP talks to the database: sporta_db_options(), sporta_db_after_connect(),
//                    sporta_db_statement_seconds(), TLS rules, sporta_db_error_summary()
//   store.php        store_db() uses them; a failed connection is logged as a summary (class, SQLSTATE, code) and the public
//                    answer no longer names WHICH credential is wrong; the global exception handler logs a one-line summary
//                    (it logged nothing before) and still answers a bare JSON token
//   seo-runtime.php, assistant.php, php-knet/knet.php, php-cbk/cbk.php   the same options
//   php-knet/{pay,callback}.php, php-cbk/{pay,callback}.php   a database exception goes to the payment log as a summary, not
//                    as its message (a PDO message carries SQL text and, for a duplicate key, the duplicate value)
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')

export const HELPERS = `

// ============================================================================================
// THE DATABASE CONNECTION: one rule for every PHP file (store, SEO, assistant, KNET, T-Pay)
// ============================================================================================
//
// Before this block each file built its own PDO options: only two set a connect timeout, none turned off stacked
// statements or LOAD DATA LOCAL, none limited how long a statement may run, none could use TLS, and nothing kept a
// database error out of a payment log. A connection is a security boundary; it should be written down once.

/** Seconds one statement may run before MariaDB aborts it, by who is asking. 0 = no limit. */
function sporta_db_statement_seconds(?string $script = null): int {
    $script = basename((string)($script ?? ($_SERVER['SCRIPT_FILENAME'] ?? '')));
    if (str_starts_with($script, 'cron-') || $script === 'setup-admin.php') return 120;                 // batch jobs
    if (in_array($script, ['admin.php', 'admin-google.php', 'preflight.php'], true)) return 30;        // staff screens
    if (in_array($script, ['pay.php', 'callback.php'], true)) return 20;                                // a payment must finish
    return 15;                                                                                           // the public storefront
}

/** Is this host this machine, or a container-network service name (one label, Docker DNS)? Everything else is remote. */
function sporta_db_host_is_local(string $host): bool {
    $h = strtolower(trim((string)preg_replace('/;.*$/', '', $host)));        // ignore a ;port= suffix
    if ($h === '' || $h === 'localhost' || $h === '127.0.0.1' || $h === '::1' || $h[0] === '/') return true;
    if (filter_var($h, FILTER_VALIDATE_IP) !== false) return false;          // any other address literal: remote
    return !str_contains($h, '.');                                           // 'mariadb', 'db': the compose service name
}

/**
 * TLS options for the connection. $prefix is 'db_' (the store) or 'mysql_' (the gateways).
 *   {prefix}tls     'auto' (default): TLS is required when the host is remote, optional (off) when it is local;
 *                   'require': always; 'off': never (an explicit, logged decision)
 *   {prefix}ssl_ca  path of the CA (or the server certificate) that signed the database's certificate
 *   {prefix}ssl_verify  false only for a self-signed lab server
 * A remote host with no CA is REFUSED (RuntimeException), never connected in clear.
 */
function sporta_db_tls_options(array $cfg, string $prefix = 'db_'): array {
    $mode = strtolower((string)($cfg[$prefix . 'tls'] ?? 'auto'));
    $host = (string)($cfg[$prefix . 'host'] ?? '');
    $ca = (string)($cfg[$prefix . 'ssl_ca'] ?? '');
    if ($mode === 'off') return [];
    if ($mode === 'auto' && sporta_db_host_is_local($host) && $ca === '') return [];
    if ($ca === '' || !is_file($ca)) throw new RuntimeException('db_tls_required_but_ca_missing');
    $o = [PDO::MYSQL_ATTR_SSL_CA => $ca];
    if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) $o[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = ($cfg[$prefix . 'ssl_verify'] ?? true) !== false;
    return $o;
}

/** PDO options. $over wins (the store adds FETCH_ASSOC; the SEO and assistant paths use a 3 second connect timeout). */
function sporta_db_options(array $cfg, string $prefix = 'db_', array $over = []): array {
    $o = [
        PDO::ATTR_ERRMODE          => PDO::ERRMODE_EXCEPTION,
        // Real prepared statements: a value is never spliced into SQL text.
        PDO::ATTR_EMULATE_PREPARES => false,
        // A database that stops answering must cost an Apache worker seconds, not a minute.
        PDO::ATTR_TIMEOUT          => 5,
    ];
    // One statement per call: a stacked "; drop table ..." in a query()/exec() string is a syntax error.
    if (defined('PDO::MYSQL_ATTR_MULTI_STATEMENTS')) $o[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;
    // LOAD DATA LOCAL reads a file from the WEB server and sends it to the database: never needed.
    if (defined('PDO::MYSQL_ATTR_LOCAL_INFILE')) $o[PDO::MYSQL_ATTR_LOCAL_INFILE] = false;
    return $over + sporta_db_tls_options($cfg, $prefix) + $o;
}

/** After connecting: the statement time limit (MariaDB max_statement_time, MySQL max_execution_time) and a TLS check. */
function sporta_db_after_connect(PDO $pdo, ?int $seconds = null, array $cfg = [], string $prefix = 'db_'): void {
    $n = $seconds ?? sporta_db_statement_seconds();
    if ($n > 0) {
        try { $pdo->exec('SET SESSION max_statement_time = ' . (int)$n); }
        catch (PDOException $e) {
            try { $pdo->exec('SET SESSION max_execution_time = ' . ((int)$n * 1000)); } catch (PDOException $e2) { /* neither exists */ }
        }
    }
    // If TLS was asked for, prove it was negotiated: an option the server ignored must not become a silent clear-text link.
    if (sporta_db_tls_options($cfg, $prefix) !== []) {
        $row = $pdo->query("show session status like 'Ssl_cipher'")->fetch(PDO::FETCH_NUM);
        if (!$row || (string)($row[1] ?? '') === '') throw new RuntimeException('db_tls_not_negotiated');
    }
}

/** A database exception as one log-safe line: class, SQLSTATE, driver code. NEVER the message (SQL text, duplicate values). */
function sporta_db_error_summary(Throwable $e): string {
    if ($e instanceof PDOException) {
        $info = is_array($e->errorInfo ?? null) ? $e->errorInfo : [];
        $state = (string)($info[0] ?? $e->getCode());
        return sprintf('%s sqlstate=%s code=%d', get_class($e), preg_match('/^[0-9A-Z]{5}$/D', $state) ? $state : 'none', (int)($info[1] ?? 0));
    }
    return get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine();
}

/** For the payment logs: an application exception keeps its message (it is ours); a database one is reduced to its summary. */
function sporta_error_text(Throwable $e): string {
    return $e instanceof PDOException ? sporta_db_error_summary($e) : $e->getMessage();
}
`

// [file, from, to, label]
const EDITS = [
  ['dropin/php-store/store.php',
    `                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    // Real prepared statements. Emulated ones interpolate, and
                    // an endpoint fed raw JSON from the internet does not.
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {`,
    `                // ERRMODE_EXCEPTION, real prepared statements, a connect timeout, one statement per call, no
                // LOAD DATA LOCAL, TLS when the host is remote: sporta_db_options() in config-path.php.
                sporta_db_options($c, 'db_', [PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])
            );
            sporta_db_after_connect($pdo, null, $c, 'db_');   // statement time limit; proves TLS when it was asked for
        } catch (PDOException $e) {
            error_log('Sporta database connection failed: ' . sporta_db_error_summary($e));`,
    'store_db options and catch'],
  ['dropin/php-store/store.php',
    `            store_out(['error' => 'db_unreachable', 'cause' => $which], 500);`,
    `            // The cause names WHICH of the four config values is wrong. That helps the owner on /backends and tells a
            // stranger which credential to attack, so only the staff entry scripts get it.
            $staffScript = in_array(basename((string)($_SERVER['SCRIPT_FILENAME'] ?? '')), ['admin.php', 'admin-google.php', 'preflight.php'], true);
            store_out($staffScript ? ['error' => 'db_unreachable', 'cause' => $which] : ['error' => 'db_unreachable'], 500);
        } catch (RuntimeException $e) {
            // (PDOException is a RuntimeException, hence this comes second.) A TLS setting that cannot be honoured: a remote
            // host with no CA, or TLS not negotiated. Refuse; never fall back to clear text.
            error_log('Sporta database connection refused: ' . $e->getMessage());
            store_out(['error' => 'db_unreachable'], 500);`,
    'store_db cause only for staff'],
  ['dropin/php-store/store.php',
    `set_exception_handler(function (Throwable $e): void {`,
    `set_exception_handler(function (Throwable $e): void {
    // The response stays a bare token, and so does the log: class, SQLSTATE, code, never the message. Before this line an
    // uncaught database error left NO trace anywhere (a handler replaces PHP's own logging), so a 500 was undiagnosable.
    error_log('Sporta uncaught ' . sporta_db_error_summary($e));`,
    'exception handler logs a summary'],
  ['dropin/php-store/seo-runtime.php',
    `        return new PDO(
            "mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4",
            $config['db_user'],
            $config['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
             PDO::ATTR_EMULATE_PREPARES => false,
             PDO::ATTR_TIMEOUT => 3]
        );`,
    `        $pdo = new PDO(
            "mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4",
            $config['db_user'],
            $config['db_pass'],
            sporta_db_options($config, 'db_', [PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3])
        );
        sporta_db_after_connect($pdo, null, $config, 'db_');
        return $pdo;`,
    'seo-runtime'],
  ['dropin/php-store/assistant.php',
    `        return new PDO(
            'mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
            (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
             PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 3]
        );`,
    `        $pdo = new PDO(
            'mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
            (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
            sporta_db_options($cfg, 'db_', [PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3])
        );
        sporta_db_after_connect($pdo, null, $cfg, 'db_');
        return $pdo;`,
    'assistant_db_or_null'],
  ['dropin/php-knet/knet.php',
    `        $pdo = new PDO(
            "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
            $cfg['mysql_user'],
            $cfg['mysql_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );`,
    `        // The shared connection rules (api/config-path.php) when the resolver is there; the standalone drop-in keeps its own.
        $shared = function_exists('sporta_db_options');
        $pdo = new PDO(
            "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
            $cfg['mysql_user'],
            $cfg['mysql_pass'],
            $shared ? sporta_db_options($cfg, 'mysql_') : [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        if ($shared) sporta_db_after_connect($pdo, null, $cfg, 'mysql_');`,
    'knet_pdo'],
  ['dropin/php-cbk/cbk.php',
    `        $pdo = new PDO(
            "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
            $cfg['mysql_user'],
            $cfg['mysql_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );`,
    `        // The shared connection rules (api/config-path.php) when the resolver is there; the standalone drop-in keeps its own.
        $shared = function_exists('sporta_db_options');
        $pdo = new PDO(
            "mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4",
            $cfg['mysql_user'],
            $cfg['mysql_pass'],
            $shared ? sporta_db_options($cfg, 'mysql_') : [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        if ($shared) sporta_db_after_connect($pdo, null, $cfg, 'mysql_');`,
    'cbk_pdo'],
  ['dropin/php-knet/pay.php',
    `    knet_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);
    http_response_code(503);`,
    `    knet_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => function_exists('sporta_error_text') ? sporta_error_text($e) : $e->getMessage()]);
    http_response_code(503);`,
    'knet pay.php log'],
  ['dropin/php-knet/callback.php',
    `            'attempt' => $attempt,
            'error' => $e->getMessage(),
        ]);`,
    `            'attempt' => $attempt,
            'error' => function_exists('sporta_error_text') ? sporta_error_text($e) : $e->getMessage(),
        ]);`,
    'knet callback.php log'],
  ['dropin/php-cbk/callback.php',
    `cbk_log($cfg, 'callback.db_write_failed', ['trackid' => $trackid, 'attempt' => $attempt, 'error' => $e->getMessage()]);`,
    `cbk_log($cfg, 'callback.db_write_failed', ['trackid' => $trackid, 'attempt' => $attempt, 'error' => function_exists('sporta_error_text') ? sporta_error_text($e) : $e->getMessage()]);`,
    'cbk callback.php db_write_failed'],
  ['dropin/php-cbk/callback.php',
    `cbk_log($cfg, 'callback.note_failed', ['error' => $e->getMessage()]);`,
    `cbk_log($cfg, 'callback.note_failed', ['error' => function_exists('sporta_error_text') ? sporta_error_text($e) : $e->getMessage()]);`,
    'cbk callback.php note_failed'],
  ['dropin/php-cbk/pay.php',
    `    cbk_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => $e->getMessage()]);`,
    `    cbk_log($cfg, 'pay.error', ['trackid' => $trackid, 'error' => function_exists('sporta_error_text') ? sporta_error_text($e) : $e->getMessage()]);`,
    'cbk pay.php log'],
]

/** Apply every edit to the tree at $root. Throws (naming the edit) when a pattern is missing or ambiguous. */
export function applyEdits(root) {
  const cp = join(root, 'dropin/php-store/config-path.php')
  const cpText = readFileSync(cp, 'utf8')
  if (cpText.includes('function sporta_db_options')) throw new Error('config-path.php already carries the connection helpers')
  writeFileSync(cp, cpText.replace(/\s*$/, '\n') + HELPERS)
  for (const [file, from, to, label] of EDITS) {
    const p = join(root, file)
    const t = readFileSync(p, 'utf8')
    const n = t.split(from).length - 1
    if (n !== 1) throw new Error(`edit "${label}" in ${file}: pattern found ${n} times (expected exactly 1). The file moved: regenerate by hand.`)
    writeFileSync(p, t.replace(from, () => to))
  }
}

function diffTrees(a, b) {
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U3', 'a/dropin', 'b/dropin'], { cwd: join(a, '..'), encoding: 'utf8' })
  return r.stdout
}

export function buildPatch(variant) {
  const tmp = mkdtempSync(join(tmpdir(), 'connectpatch-'))
  try {
    for (const d of ['a', 'b']) cpSync(join(WEB, 'dropin'), join(tmp, d, 'dropin'), { recursive: true, filter: (x) => !/\/config\.php$/.test(x) })
    if (variant === 'after-roles') {
      const roles = join(HERE, 'php-roles.patch')
      if (!existsSync(roles)) return null
      for (const d of ['a', 'b']) {
        const r = spawnSync('patch', ['-p1', '-s', '-d', join(tmp, d), '-i', roles], { encoding: 'utf8' })
        if (r.status !== 0) return null
      }
    }
    applyEdits(join(tmp, 'b'))
    return diffTrees(join(tmp, 'a'), join(tmp, 'b')).replace(/^diff --git a\/dropin/gm, 'diff --git a/dropin').replace(/a\/a\//g, 'a/').replace(/b\/b\//g, 'b/')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

if (process.argv[1] && process.argv[1].endsWith('make-connect-patch.mjs')) {
  const tIdx = process.argv.indexOf('--tree')
  if (tIdx > 0) { applyEdits(process.argv[tIdx + 1]); console.log('edits applied'); process.exit(0) }
  const out = { 'db-connect.patch': buildPatch('head'), 'db-connect-after-roles.patch': buildPatch('after-roles') }
  let stale = 0
  for (const [f, text] of Object.entries(out)) {
    const p = join(HERE, f)
    if (text === null) { console.log(`skip  ${f} (php-roles.patch is absent or does not apply to this tree)`); continue }
    if (process.argv.includes('--check')) {
      if (!existsSync(p) || readFileSync(p, 'utf8') !== text) { console.log(`STALE ${f}`); stale++ } else console.log(`ok    ${f}`)
    } else { writeFileSync(p, text); console.log(`wrote ${f} (${text.length} bytes)`) }
  }
  process.exit(stale ? 1 : 0)
}
