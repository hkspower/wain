<?php
// READ-ONLY probe, run on the VPS as a one-shot compose job: which products have a photograph on the live server,
// and which do not. It runs ONE statement (a SELECT inside a read-only transaction) and lists one folder. It writes
// nothing and never prints a secret. Mounts it needs (see the job that carries it): /run/sporta-api-config.php (the
// store config, which loads the database login from /run/secrets), and /media/products (the photo folder, read-only).
//
// A product HAS a photo when either:
//   referenced   products.image or one of products.images names a file that is in the folder, or
//   by-slug      the folder holds <slug>.jpg|jpeg|png|webp|avif (the shop finds photos by slug; see the notes in
//                public/sporta-features.js and PERFORMANCE.md).
// dead-reference  the row names a file that is NOT in the folder and there is no slug file.
// none            neither: the shopper sees the grey "no photo" plate for this product.
//
// Output: one line per product, then a summary. Kept under the 300-line log cap of the Hostinger API.
declare(strict_types=1);

$cfg = require '/run/sporta-api-config.php';
$dir = '/media/products';
$exts = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

$files = [];
foreach (scandir($dir) ?: [] as $f) {
    if ($f === '.' || $f === '..' || $f === '.htaccess' || is_dir($dir . '/' . $f)) continue;
    $files[strtolower($f)] = $f;
}

$dsn = 'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4';
$pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('set session transaction read only');
$pdo->beginTransaction();
$rows = $pdo->query('select slug, active, category, image, images from products order by slug')->fetchAll(PDO::FETCH_ASSOC);
$pdo->commit();

$nameOf = static function (string $p): string {
    $path = parse_url(trim($p), PHP_URL_PATH);
    return strtolower(basename($path === null || $path === false ? trim($p) : $path));
};

$referencedNames = [];
$counts = ['referenced' => 0, 'by-slug' => 0, 'dead-reference' => 0, 'none' => 0];
$byActive = ['active' => 0, 'hidden' => 0];
$missingActive = [];
$deadRefs = [];

echo 'folder files: ' . count($files) . ', product rows: ' . count($rows) . "\n";
foreach ($rows as $r) {
    $slug = (string) $r['slug'];
    $refs = [];
    if (is_string($r['image']) && trim($r['image']) !== '') $refs[] = trim($r['image']);
    foreach (explode(',', (string) $r['images']) as $x) {
        if (trim($x) !== '') $refs[] = trim($x);
    }
    $refNames = array_map($nameOf, $refs);
    foreach ($refNames as $n) $referencedNames[$n] = true;
    $refOk = array_values(array_filter($refNames, static fn(string $n): bool => isset($files[$n])));
    $refDead = array_values(array_diff($refNames, array_keys($files)));

    $slugFile = null;
    foreach ($exts as $e) {
        if (isset($files[$slug . '.' . $e])) { $slugFile = $files[$slug . '.' . $e]; break; }
    }

    if ($refOk) $status = 'referenced';
    elseif ($slugFile !== null) $status = 'by-slug';
    elseif ($refDead) $status = 'dead-reference';
    else $status = 'none';
    $counts[$status]++;

    $isActive = (int) $r['active'] === 1;
    $byActive[$isActive ? 'active' : 'hidden']++;
    if ($status === 'none' || $status === 'dead-reference') {
        if ($isActive) $missingActive[] = $slug;
    }
    if ($refDead) $deadRefs[] = $slug . ' -> ' . implode(', ', $refDead);

    $shown = $refs ? implode(', ', $refs) : '-';
    echo sprintf("%-14s %-6s %-10s %s%s\n", $status, $isActive ? 'active' : 'hidden', (string) $r['category'], $slug,
        $status === 'referenced' || $status === 'dead-reference' ? '   [' . $shown . ']' : '');
}

$orphans = [];
foreach ($files as $lower => $name) {
    if (isset($referencedNames[$lower])) continue;
    $stem = pathinfo($lower, PATHINFO_FILENAME);
    $isSlugFile = false;
    foreach ($rows as $r) {
        if (str_starts_with($lower, (string) $r['slug'] . '.')) { $isSlugFile = true; break; }
    }
    if (!$isSlugFile) $orphans[] = $name;
}

echo "\nSUMMARY\n";
echo 'referenced ' . $counts['referenced'] . ', by-slug ' . $counts['by-slug'] . ', dead-reference ' . $counts['dead-reference'] . ', none ' . $counts['none'] . "\n";
echo 'active ' . $byActive['active'] . ', hidden ' . $byActive['hidden'] . "\n";
echo 'active products with no photo (' . count($missingActive) . '): ' . implode(', ', $missingActive) . "\n";
echo 'dead references (' . count($deadRefs) . "): " . ($deadRefs ? implode(' | ', $deadRefs) : 'none') . "\n";
echo 'folder files named after no product (' . count($orphans) . '): ' . implode(', ', array_slice($orphans, 0, 40)) . (count($orphans) > 40 ? ' ...' : '') . "\n";
