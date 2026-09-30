<?php
/**
 * What is actually in the hero carousel, right now — read-only.
 *
 *   php /home/<user>/live-hero-slides-check.php
 *
 * Asked for after publishing the CrossFit hero slide this session: with that
 * row live, the carousel is no longer the five drawn banners alone, and
 * nothing before this checked what the OTHER active rows actually look like
 * — dimensions, whether a mobile crop exists, the focal point, and whether
 * the desktop and mobile bytes it claims to hold are the sizes it claims.
 *
 * READ-ONLY. No output is a secret: dimensions, byte lengths and hashes, none
 * of it is what CLAUDE.md's own rule about invoice PDFs or KNET credentials
 * is about.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );

    $rows = $pdo->query(
        "select id, sort, active, title_en, title_ar, image_w, image_h,
                image_mobile_w, image_mobile_h, focal_x, focal_y,
                length(image) ilen, length(image_mobile) mlen,
                image_hash, image_mobile_hash
           from hero_slides where active = 1 order by sort"
    )->fetchAll(PDO::FETCH_ASSOC);

    foreach ($rows as $r) {
        // A slide with a title is a PHOTO slide (real text rendered over it);
        // one with no title is one of the five DRAWN banners, whose headline
        // is burnt into the artwork and whose text columns are null on purpose.
        $kind = $r['title_en'] !== null ? 'photo' : 'drawn';
        $ratioD = ((int)$r['image_w'] && (int)$r['image_h'])
            ? round((int)$r['image_w'] / (int)$r['image_h'], 3) : null;
        $ratioM = ((int)($r['image_mobile_w'] ?? 0) && (int)($r['image_mobile_h'] ?? 0))
            ? round((int)$r['image_mobile_w'] / (int)$r['image_mobile_h'], 3) : null;

        echo "SLIDE id={$r['id']} sort={$r['sort']} kind=$kind"
           . " title=" . ($r['title_en'] !== null ? "\"{$r['title_en']}\"" : 'null')
           . " desktop={$r['image_w']}x{$r['image_h']}"
           . " ratio=" . ($ratioD ?? 'n/a')
           . " bytes={$r['ilen']}"
           . " mobile=" . ($r['image_mobile_w'] ?? 'NONE') . "x" . ($r['image_mobile_h'] ?? '')
           . " mratio=" . ($ratioM ?? 'n/a')
           . " mbytes=" . ($r['mlen'] ?? 0)
           . " focal={$r['focal_x']}/{$r['focal_y']}"
           . " hash=" . substr((string)$r['image_hash'], 0, 10)
           . " mhash=" . ($r['image_mobile_hash'] ? substr((string)$r['image_mobile_hash'], 0, 10) : 'none')
           . "\n";
    }
    echo "SUMMARY count=" . count($rows)
       . " noMobile=" . count(array_filter($rows, fn($r) => empty($r['image_mobile_w'])))
       . "\n";
} catch (Throwable $e) {
    echo "ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
