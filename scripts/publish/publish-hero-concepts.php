<?php
/**
 * Replace the current single-slide hero (the all-black banner) with three
 * AI-generated sportswear concepts as a rotating carousel.
 *
 * SAME SHAPE AS publish-hero-slide.php, for three rows instead of one — read
 * that file's header first, all of its reasoning applies here: hero_slides is
 * a database write, not a file publish; no title/subtitle/CTA (generic
 * concept art, nothing burnt in to caption); idempotent by image_hash rather
 * than by id, so re-running is safe and a re-render with new bytes becomes a
 * new row rather than a silent overwrite.
 *
 * FOCAL_Y IS ALWAYS 50 AND DOES NOTHING AT THIS BOX RATIO. Measured directly:
 * at object-fit: cover with the CURRENT desktop hero (height: 100svh), the box
 * is proportionally TALLER than the 2.52:1 artwork, so `cover` scales the
 * image to match the box's HEIGHT and only crops the SIDES — there is no
 * vertical slack for a vertical focal point to move within. FOCAL_X is what
 * actually matters here, eyeballed per image from where the subject sits
 * horizontally in each 3200x1270 frame.
 *
 * THE OLD BANNER IS DEACTIVATED, NOT DELETED. Matched by image_hash so a
 * second run of this script does not deactivate a slide that was never the
 * old banner; `active = 0` keeps the row and its data: URI intact, so the
 * owner can revert with one UPDATE if these three do not work out.
 *
 * $COMMIT PINS THE ARTWORK, NOT THIS SCRIPT. Fetch the script itself from
 * HEAD; an older copy of a publisher silently does less and says so only in
 * a number.
 */

$COMMIT = '__COMMIT__';

// [repo path, sha256, focal_x, sort]
$OLD_BANNER_SHA = 'c805e838a29d5e55da0c33155ddb0769c537309b5b476040170e08eade37848e';
$SLIDES = [
    ['assets/hero/sportswear-runner.webp',     '3a865a180d82e3d7d0b04c87cd3217f21dd770dc74646a1c2dfd171ee6e15e46', 43, 20],
    ['assets/hero/sportswear-activewear.webp', '00627d0f4f2cf452b8cd1580fcedeb50523af32ab9b5917872b831c4db25f66e', 62, 21],
    ['assets/hero/sportswear-training.webp',   '4eb6db0632cce9fc592a273657450bc977314614530d001e765aba375c2ea54c', 48, 22],
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

// Deactivate the old banner by its own hash — never by "every slide with no
// title", which would also catch these three on a second run.
$deact = $pdo->prepare('update hero_slides set active = 0 where image_hash = ? and active = 1');
$deact->execute([$OLD_BANNER_SHA]);
$deactivated = $deact->rowCount();

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

echo "OLD-BANNER deactivated=$deactivated\n";
foreach ($results as $r) echo "SLIDE $r\n";
echo "activeSlides=$live\n";
