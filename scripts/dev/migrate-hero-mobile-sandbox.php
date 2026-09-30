<?php
/**
 * The SANDBOX twin of scripts/publish/migrate-hero-mobile.php: the same four
 * nullable hero_slides columns, against the local MariaDB that sandbox.sh
 * starts, so test:hero-mobile can prove the migration is idempotent before the
 * live one is ever run.
 *
 *   php scripts/dev/migrate-hero-mobile-sandbox.php
 *
 * test:hero-mobile has called this path since 2026-09-20 and the file was
 * never committed, so the test died on "Could not open input file" before a
 * single check ran. Same statements, same STATE-not-verb output as the live
 * script; only the connection differs.
 */

function line(string $s): void { echo $s, "\n"; }

try {
    $db = new PDO('mysql:host=127.0.0.1;dbname=sporta;charset=utf8mb4', 'sporta', 'localdev',
                  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    line('FAILED connect: ' . $e->getMessage() . ' — run bash scripts/sandbox.sh');
    exit(1);
}

try {
    $db->exec('alter table hero_slides add column if not exists image_mobile longtext null');
    $db->exec('alter table hero_slides add column if not exists image_mobile_hash char(64) null');
    $db->exec('alter table hero_slides add column if not exists image_mobile_w int null');
    $db->exec('alter table hero_slides add column if not exists image_mobile_h int null');
} catch (Throwable $e) {
    line('FAILED alter: ' . $e->getMessage());
    exit(1);
}

$cols = $db->query("show columns from hero_slides like 'image_mobile%'")->fetchAll(PDO::FETCH_COLUMN);
$has = fn (string $c) => in_array($c, $cols, true) ? 'yes' : 'NO';
line('STATE heroSlides.image_mobile=' . $has('image_mobile')
   . ' .image_mobile_hash=' . $has('image_mobile_hash')
   . ' .image_mobile_w=' . $has('image_mobile_w')
   . ' .image_mobile_h=' . $has('image_mobile_h'));
line(count($cols) === 4 ? 'READY' : 'NOT READY');
