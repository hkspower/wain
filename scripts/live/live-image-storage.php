<?php
// READ-ONLY. Where the shop's pictures live and how big they are: database tables (data: URIs and blobs) and image folders.
// Prints counts and sizes only — never a picture, a name or an address.
//   wget -nv -O r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-image-storage.php && php r.php
//   php scripts/live/live-image-storage.php          (from a checkout: the sandbox database and the repository's docroot)
//
// THE COLUMNS ARE THE SCHEMA'S, READ FROM THE .mysql.sql FILES THAT CREATE THEM (2026-10-08). The first version asked for
// columns that do not exist — product_images.data and .product_id (they are image and slug: 1-schema.mysql.sql),
// product_image_thumbs.data, category_art.data and site_images.data (all three are `bytes`), seo_image.data (`image`) — and
// answered every failure with "(table missing)". So five tables that were THERE read as absent, which is the opposite of
// a measurement. A failed query is now classified by its error number: 1146 is a missing table, 1054 an unknown column —
// named, and almost always a bug in THIS FILE (or a migrate-*.php not yet run here) — and anything else is printed as its
// number. `SCAN_ROOT=$PWD/scripts node scripts/schema-usage-audit.mjs` prepares every query below against a fresh install.
//
// `IMG answered=N/8` comes before the verdict, because a run that answered nothing and a run that found nothing to report
// would otherwise print the same thing.
$LIVE = '/home/u130124229/domains/sporta.com.kw/public_html';
$onLive = is_file($LIVE . '/api/config.php');
$ROOT = $onLive ? $LIVE : dirname(__DIR__, 2) . '/sporta-site/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$mb = fn ($b) => number_format($b / 1048576, 2) . 'MB';
line('IMGSTORE where=' . ($onLive ? 'live' : 'checkout'));
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
try {
    $db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    line('NO-DB connect-error=' . (int) ($e instanceof PDOException ? ($e->errorInfo[1] ?? $e->getCode()) : 0));
    return;
}
$t = $db->query("select table_name n, coalesce(data_length,0)+coalesce(index_length,0) b from information_schema.tables where table_schema = database()")->fetchAll(PDO::FETCH_KEY_PAIR);
arsort($t); $tot = array_sum($t);
line('DB total=' . $mb($tot) . ' tables=' . count($t));
line('DB top: ' . implode(' ', array_map(fn ($k) => $k . '=' . $mb($t[$k]), array_slice(array_keys($t), 0, 8))));
$asked = 0; $answered = 0; $missing = []; $bugs = [];
$q = function (string $table, string $label, string $sql) use ($db, $t, &$asked, &$answered, &$missing, &$bugs) {
    $asked++;
    try {
        $r = $db->query($sql)->fetch(PDO::FETCH_NUM);
        $answered++;
        line($table . ' ' . $label . ' ' . implode(' ', array_map(fn ($v) => $v ?? '0', $r)));
    } catch (Throwable $e) {
        $no = $e instanceof PDOException ? (int) ($e->errorInfo[1] ?? 0) : 0;
        if ($no === 1146 && !isset($t[$table])) { $missing[] = $table; line("$table missing:$table"); }
        // Named, because 1054 has two causes this line cannot tell apart: a column this script got wrong,
        // or one a migrate-*.php adds that has not been run here yet (hero_slides.image_mobile on an older
        // database). live-schema-full.php says which. An identifier is all the message carries.
        elseif ($no === 1054) {
            $bugs[] = $table;
            $col = preg_match("/Unknown column '([A-Za-z0-9_.]{1,64})'/", $e->getMessage(), $m) ? $m[1] : '?';
            line("$table QUERY-BUG unknown-column:$col (this database has no such column: a mistake in this script, or a migration not run yet)");
        }
        else { $bugs[] = $table; line("$table error=$no" . (isset($t[$table]) ? ' (the table exists)' : '')); }
    }
};
// product_images, hero_slides.image(_mobile), brands.logo: base64 data: URIs in longtext/mediumtext (1-schema.mysql.sql).
$q('product_images', 'rows/bytes/max/products', 'select count(*), coalesce(sum(length(image)),0), coalesce(max(length(image)),0), count(distinct slug) from product_images');
// productthumbs.mysql.sql: resized copies as raw bytes in `bytes`.
$q('product_image_thumbs', 'rows/bytes', 'select count(*), coalesce(sum(length(bytes)),0) from product_image_thumbs');
$q('brands', 'with-logo/bytes/max', "select coalesce(sum(logo is not null and logo <> ''),0), coalesce(sum(length(logo)),0), coalesce(max(length(logo)),0) from brands");
// The phone picture is a column of its own (image_mobile, 1-schema.mysql.sql), and as large as the banner.
$q('hero_slides', 'rows/bytes/max/mobileRows/mobileBytes', 'select count(*), coalesce(sum(length(image)),0), coalesce(max(length(image)),0), coalesce(sum(image_mobile is not null),0), coalesce(sum(length(image_mobile)),0) from hero_slides');
// categoryart.mysql.sql, siteimages.mysql.sql: raw bytes in `bytes`.
$q('category_art', 'rows/bytes', 'select count(*), coalesce(sum(length(bytes)),0) from category_art');
$q('site_images', 'rows/bytes', 'select count(*), coalesce(sum(length(bytes)),0) from site_images');
// homebanner.mysql.sql, seo.mysql.sql: one row each, the picture in `image` (mediumblob).
$q('home_banner', 'bytes', 'select coalesce(sum(length(image)),0) from home_banner');
$q('seo_image', 'bytes', 'select coalesce(sum(length(image)),0) from seo_image');
line("IMG answered=$answered/$asked missing=" . count($missing) . ($missing ? ' [' . implode(' ', array_unique($missing)) . ']' : '')
    . ' queryErrors=' . count($bugs) . ($bugs ? ' [' . implode(' ', array_unique($bugs)) . ']' : ''));
function dsize(string $d): array { $n = 0; $b = 0; if (!is_dir($d)) return [0, 0]; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)); foreach ($it as $f) if ($f->isFile()) { $n++; $b += $f->getSize(); } return [$n, $b]; }
foreach (['images', 'cats', 'hero', 'assets', 'fonts', 'api/fonts'] as $d) { [$n, $b] = dsize("$ROOT/$d"); line("DIR $d files=$n size=" . $mb($b)); }
foreach (['images/_uploads', 'images/brands', 'images/heros'] as $d) { [$n, $b] = dsize("$ROOT/$d"); if ($n || is_dir("$ROOT/$d")) line("DIR $d files=$n size=" . $mb($b)); }
if ($onLive) {
    $home = '/home/u130124229'; [$n, $b] = dsize("$home/backups"); line("DIR ~/backups files=$n size=" . $mb($b));
    [$n, $b] = dsize($ROOT); line("DOCROOT files=$n size=" . $mb($b));
    line('DISK free=' . $mb((float) @disk_free_space($home)) . ' total=' . $mb((float) @disk_total_space($home)));
} else {
    [$n, $b] = dsize($ROOT); line("DOCROOT files=$n size=" . $mb($b) . ' (the repository checkout; ~/backups and DISK are live-only)');
}
line('VERDICT ' . ($bugs ? 'QUERY-ERRORS - the numbers above are incomplete' : ($answered === 0 ? 'nothing answered'
    : ($missing ? 'ok - ' . count($missing) . ' table(s) not created on this database yet (live-schema-full.php names the migrate-*.php)' : 'ok'))));
