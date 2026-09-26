<?php
/**
 * Replace the three (too-dark) sportswear hero slides with a brightened pass
 * of the same three images — gamma 0.72, same crop/composition, same subjects.
 *
 * SAME SHAPE AS publish-hero-concepts.php, which this supersedes. Idempotent
 * by image_hash, so re-running is safe; a re-render with new bytes (which
 * this is, deliberately) becomes a NEW row rather than a silent overwrite of
 * the old one, and the old three are deactivated by their own hashes below —
 * never by "every slide with no title", which would also catch these three on
 * a second run of this same script.
 *
 * $COMMIT PINS THE ARTWORK, NOT THIS SCRIPT. Fetch the script itself from
 * HEAD; an older copy of a publisher silently does less and says so only in
 * a number.
 */

$COMMIT = '691bc2e93769c2722a905bdba4eecd1ba0cd3d58';

// The three DARK versions this replaces — deactivated by hash, kept in the
// table (not deleted) so the owner can revert with one UPDATE.
$OLD_HASHES = [
    '3a865a180d82e3d7d0b04c87cd3217f21dd770dc74646a1c2dfd171ee6e15e46', // dark runner
    '00627d0f4f2cf452b8cd1580fcedeb50523af32ab9b5917872b831c4db25f66e', // dark activewear
    '4eb6db0632cce9fc592a273657450bc977314614530d001e765aba375c2ea54c', // dark training
];
// [repo path, sha256, focal_x, sort]
$SLIDES = [
    ['assets/hero/sportswear-runner.webp',     '20f9508f1f28500ef237804ca4048bb7ddbcb7ef92a30e1f697faa541ff993c2', 43, 23],
    ['assets/hero/sportswear-activewear.webp', 'e8cf8307ae182263251f4a8b74a8d3e16f7751c890b9669c337f20310e7b75a4', 62, 24],
    ['assets/hero/sportswear-training.webp',   '1fc04cc9840a7ff9346e75a05929555352534fcc00f4fd37f38724c5d9ade0f8', 48, 25],
];
$W = 3200;
$H = 1270;
$FY = 50;

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "PUBLISH db=NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]
    );
} catch (Throwable $e) {
    echo "PUBLISH db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
    return;
}

// Deactivate the three dark versions by their own hashes.
$deactivated = 0;
$deact = $pdo->prepare('update hero_slides set active = 0 where image_hash = ? and active = 1');
foreach ($OLD_HASHES as $h) {
    $deact->execute([$h]);
    $deactivated += $deact->rowCount();
}

$results = [];
foreach ($SLIDES as [$path, $sha, $fx, $sort]) {
    $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
                            CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200) {
        $results[] = "$path fetch=FAILED http=$code bytes=" . strlen((string) $body);
        continue;
    }
    $got = hash('sha256', $body);
    if ($got !== $sha) {
        $results[] = "$path fetch=HASH-MISMATCH want=" . substr($sha, 0, 12) . " got=" . substr($got, 0, 12);
        continue;
    }
    if (substr($body, 0, 4) !== 'RIFF' || substr($body, 8, 4) !== 'WEBP') {
        $results[] = "$path fetch=NOT-A-WEBP bytes=" . strlen($body);
        continue;
    }

    $uri = 'data:image/webp;base64,' . base64_encode($body);
    if (strlen($uri) > 1200000) {
        $results[] = "$path uri=TOO-LARGE len=" . strlen($uri);
        continue;
    }

    $find = $pdo->prepare('select id, active from hero_slides where image_hash = ?');
    $find->execute([$sha]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        if ((int) $row['active'] !== 1) {
            $pdo->prepare('update hero_slides set active = 1, sort = ? where id = ?')->execute([$sort, $row['id']]);
        }
        $id = (int) $row['id'];
    } else {
        $ins = $pdo->prepare(
            'insert into hero_slides (sort, active, image, image_hash, image_w, image_h, focal_x, focal_y)
             values (?, 1, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([$sort, $uri, $sha, $W, $H, $fx, $FY]);
        $id = (int) $pdo->lastInsertId();
    }

    $q = $pdo->prepare('select active, image_w, image_h, focal_x from hero_slides where id = ?');
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);
    $results[] = basename($path) . " id=$id active={$s['active']} dims={$s['image_w']}x{$s['image_h']} focal={$s['focal_x']}";
}

$live = (int) $pdo->query('select count(*) from hero_slides where active = 1 and image is not null')->fetchColumn();

echo "OLD-DARK-SLIDES deactivated=$deactivated\n";
foreach ($results as $r) echo "SLIDE $r\n";
echo "activeSlides=$live\n";
