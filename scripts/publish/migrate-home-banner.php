<?php
/**
 * Create the home_banner table on the LIVE database — the product banner above
 * "Shop by category", edited from /backends. 2026-10-01.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-home-banner.php && php c.php
 *
 * RUN IT AFTER publish-all.php, because it reads the statement from the
 * published api/homebanner.mysql.sql rather than carrying a second copy of it:
 * one home for the schema, so this script and the file cannot drift apart.
 * Without that file it does nothing and says so.
 *
 * ORDER IS OTHERWISE NOT CRITICAL: until the table exists ?r=home_banner answers
 * {"banner": null}, the home page draws no banner, and the panel card says the
 * shop is not set up yet. Nothing breaks either way.
 *
 * IDEMPOTENT (`create table if not exists`), and it reports STATE rather than its
 * own verb, so a per-minute job's last-run output reads the same on every run.
 * It ADDS and NEVER DROPS, and it never writes a row: the banner stays off until
 * the owner switches it on.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php';
$sqlPath = $root . '/api/homebanner.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/homebanner.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$sql = (string) file_get_contents($sqlPath);
if (stripos($sql, 'create table if not exists home_banner') === false || preg_match('/\b(drop|delete|truncate|alter)\b/i', $sql)) {
    line('api/homebanner.mysql.sql is not the expected create statement — nothing done');
    exit;
}
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }
try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

try { $db->exec($sql); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }

$has = 'no'; $rows = '?'; $enabled = '-';
try { $has = $db->query("show tables like 'home_banner'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
try { $rows = (string) $db->query('select count(*) from home_banner')->fetchColumn(); } catch (Throwable $e) {}
try { $v = $db->query('select enabled from home_banner where id = 1')->fetchColumn(); $enabled = $v === false ? '-' : ((int) $v ? 'on' : 'off'); } catch (Throwable $e) {}
line("STATE home_banner=$has rows=$rows enabled=$enabled");
line($has === 'yes' ? 'READY — the panel can save the banner; the home page shows it once it is switched on.' : 'NOT READY — the panel card will say so.');
