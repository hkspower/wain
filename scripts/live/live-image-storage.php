<?php
// READ-ONLY. Where the shop's pictures live and how big they are: database tables (data: URIs) and image folders.
// Prints counts and sizes only — never a picture, a name or an address.
//   wget -qO s.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-image-storage.php && php s.php
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$mb = fn ($b) => number_format($b / 1048576, 2) . 'MB';
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
$db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$t = $db->query("select table_name n, coalesce(data_length,0)+coalesce(index_length,0) b from information_schema.tables where table_schema = database()")->fetchAll(PDO::FETCH_KEY_PAIR);
arsort($t); $tot = array_sum($t);
line('DB total=' . $mb($tot) . ' tables=' . count($t));
line('DB top: ' . implode(' ', array_map(fn ($k) => $k . '=' . $mb($t[$k]), array_slice(array_keys($t), 0, 8))));
$q = function (string $label, string $sql) use ($db) { try { $r = $db->query($sql)->fetch(PDO::FETCH_NUM); line($label . ' ' . implode(' ', array_map(fn ($v) => $v ?? '0', $r))); } catch (Throwable $e) { line($label . ' (table missing)'); } };
$q('product_images rows/bytes/max/products', 'select count(*), coalesce(sum(length(data)),0), coalesce(max(length(data)),0), count(distinct product_id) from product_images');
$q('product_image_thumbs rows/bytes', 'select count(*), coalesce(sum(length(data)),0) from product_image_thumbs');
$q('brands with-logo/bytes/max', "select sum(logo is not null and logo <> ''), coalesce(sum(length(logo)),0), coalesce(max(length(logo)),0) from brands");
$q('hero_slides rows/bytes/max', 'select count(*), coalesce(sum(length(image)),0), coalesce(max(length(image)),0) from hero_slides');
$q('category_art rows/bytes', 'select count(*), coalesce(sum(length(data)),0) from category_art');
$q('home_banner bytes', 'select coalesce(sum(length(image)),0) from home_banner');
$q('site_images rows/bytes', 'select count(*), coalesce(sum(length(data)),0) from site_images');
$q('seo_image bytes', 'select coalesce(sum(length(data)),0) from seo_image');
function dsize(string $d): array { $n = 0; $b = 0; if (!is_dir($d)) return [0, 0]; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)); foreach ($it as $f) if ($f->isFile()) { $n++; $b += $f->getSize(); } return [$n, $b]; }
foreach (['images', 'cats', 'hero', 'assets', 'fonts', 'api/fonts'] as $d) { [$n, $b] = dsize("$ROOT/$d"); line("DIR $d files=$n size=" . $mb($b)); }
foreach (['images/_uploads', 'images/brands', 'images/heros'] as $d) { [$n, $b] = dsize("$ROOT/$d"); if ($n || is_dir("$ROOT/$d")) line("DIR $d files=$n size=" . $mb($b)); }
$home = '/home/u130124229'; [$n, $b] = dsize("$home/backups"); line("DIR ~/backups files=$n size=" . $mb($b));
[$n, $b] = dsize("$home/domains/sporta.com.kw/public_html"); line("DOCROOT files=$n size=" . $mb($b));
line('DISK free=' . $mb((float) @disk_free_space($home)) . ' total=' . $mb((float) @disk_total_space($home)));
