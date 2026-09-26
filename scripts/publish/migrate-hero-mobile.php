<?php
/**
 * Add the hero_slides mobile-image columns to the LIVE database.
 *
 *   wget -qO h.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-hero-mobile.php && php h.php
 *
 * THIS MUST RUN BEFORE api/api.php AND api/admin.php ARE PUBLISHED, and that
 * ordering is not a preference. The new ?r=slides and ?r=slide_image code
 * SELECTs image_mobile/image_mobile_hash/image_mobile_w/image_mobile_h
 * unconditionally. Publish the code against a table without those columns
 * and the query fails — which is not a degraded feature, it is the HOME PAGE
 * HERO CAROUSEL 500ing for every visitor, on the page that loads first. The
 * columns are nullable and unused by the old code, so running this first is
 * invisible until the code arrives; running it second is an outage.
 *
 * IDEMPOTENT, and it reports STATE rather than its own verb. `add column if
 * not exists` does nothing on a second run, and the output names what IS
 * THERE afterwards rather than what this run did, because a per-minute cron
 * job's captured output is the LAST run's, and "I added it" read one minute
 * later is indistinguishable from a path that was always wrong.
 * `heroSlides.image_mobile=yes` reads the same on every run, which is the
 * point.
 *
 * IT ADDS AND NEVER DROPS. No DROP, no ALTER of an existing column, no data
 * touched. The worst a repeat run can do is nothing.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }

try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) {
    line('DB connect failed: ' . $e->getMessage());
    exit;
}

try {
    $db->exec("alter table hero_slides add column if not exists image_mobile longtext null");
    $db->exec("alter table hero_slides add column if not exists image_mobile_hash char(64) null");
    $db->exec("alter table hero_slides add column if not exists image_mobile_w int null");
    $db->exec("alter table hero_slides add column if not exists image_mobile_h int null");
} catch (Throwable $e) {
    line('ALTER failed: ' . $e->getMessage());
    exit;
}

// STATE, not verb — read back what actually exists now.
$cols = $db->query("show columns from hero_slides like 'image_mobile%'")
    ->fetchAll(PDO::FETCH_COLUMN);
sort($cols);

$slideCount = (int) $db->query('select count(*) from hero_slides')->fetchColumn();

line('heroSlides.image_mobile=' . (in_array('image_mobile', $cols, true) ? 'yes' : 'NO')
    . ' .image_mobile_hash=' . (in_array('image_mobile_hash', $cols, true) ? 'yes' : 'NO')
    . ' .image_mobile_w=' . (in_array('image_mobile_w', $cols, true) ? 'yes' : 'NO')
    . ' .image_mobile_h=' . (in_array('image_mobile_h', $cols, true) ? 'yes' : 'NO')
    . ' rows=' . $slideCount);

line(count($cols) === 4
    ? 'READY — api/api.php and api/admin.php may be published now.'
    : 'NOT READY — do not publish api.php/admin.php yet.');
