<?php
/**
 * Create the SEO tables on the LIVE database — product_seo and seo_image, for /backends → SEO. 2026-10-02.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-seo.php && php c.php
 *
 * RUN IT AFTER publish-all.php: it reads the statements from the published api/seo.mysql.sql rather
 * than carrying a second copy. ORDER IS OTHERWISE NOT CRITICAL: until the tables exist, product pages
 * keep their own titles, the share picture is og-image.png, and the SEO screen says it is not set up.
 * robots.txt and the sitemap need no table at all.
 *
 * IDEMPOTENT (`create table if not exists`), ADDS and NEVER DROPS, writes no row, and reports STATE.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgPath = $root . '/api/config.php';
$sqlPath = $root . '/api/seo.mysql.sql';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
if (!is_file($sqlPath)) { line('api/seo.mysql.sql is not on the server — run publish-all.php first. Nothing done.'); exit; }
$sql = (string) file_get_contents($sqlPath);
$code = preg_replace('/^--.*$/m', '', $sql);
if (substr_count(strtolower($code), 'create table if not exists') !== 2 || preg_match('/\b(drop|delete|truncate|alter|insert)\b|\bupdate\s+\w+\s+set\b/i', $code)) {
    line('api/seo.mysql.sql is not the expected two create statements — nothing done');
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

foreach (array_filter(array_map('trim', explode(';', $code))) as $stmt) {
    try { $db->exec($stmt); } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
}
$state = [];
foreach (['product_seo', 'seo_image'] as $t) {
    $has = 'no';
    try { $has = $db->query("show tables like '$t'")->fetchColumn() !== false ? 'yes' : 'no'; } catch (Throwable $e) {}
    $rows = '?';
    try { $rows = (string) $db->query("select count(*) from $t")->fetchColumn(); } catch (Throwable $e) {}
    $state[] = "$t=$has/$rows";
}
line('STATE ' . implode(' ', $state));
line(strpos(implode(' ', $state), '=no') === false ? 'READY — the SEO screen can save product titles and the share picture.' : 'NOT READY — the SEO screen will say so.');
