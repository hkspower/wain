<?php
/**
 * Replace the "Sporta Features" hero slide's PHOTOGRAPH, in place — the
 * text (title/subtitle/CTA/sort) is untouched.
 *
 * WHY THIS IS A SEPARATE SCRIPT FROM publish-features-hero-slide.php, NOT A
 * RE-RUN OF IT. That script finds its row by the ARTWORK's own hash — which
 * is exactly the thing that changed here (a visible seam in the first
 * composite was fixed, more padding added, the file re-encoded). Re-running
 * it unmodified would look up a hash that no longer matches ANY row and
 * INSERT A SECOND SLIDE instead of fixing the first — the same shape of
 * mistake CLAUDE.md records elsewhere in this project ("a replacement that
 * matches nothing is a no-op that looks like success"), just one step
 * removed: here a failed match creates a duplicate rather than doing
 * nothing.
 *
 * IDENTIFIED BY title_en = 'Sporta Features' instead — stable across an
 * artwork change, and there is only one row with that title by
 * construction (this project's own publisher for it never runs twice
 * without this same hash problem stopping it).
 *
 * ONLY THE IMAGE COLUMNS MOVE. title_en/title_ar/subtitle_en/subtitle_ar/
 * cta_label_en/cta_label_ar/cta_href/sort/active/focal_x/focal_y are not
 * touched — an owner who had since edited any of those in /backends would
 * not have it silently reverted by a script whose whole job is the
 * photograph.
 *
 * BOTH FILES ARE VERIFIED BEFORE EITHER REACHES THE DATABASE, same as
 * every other publisher here — a hash mismatch, a truncated fetch or a
 * wrong commit on EITHER file aborts before anything is written.
 *
 * $COMMIT is pinned to the full 40-character sha of the commit that
 * replaced both artwork files.
 */

$COMMIT = '0bff524d0000000000000000000000000000000';   // placeholder — see note below

$DESKTOP     = 'sporta-site/assets/hero/features-desktop.webp';
$DESKTOP_SHA = 'aa81344ff4219c57bf9000651afc61cb43a53de486b12ccc848d976359229a86';
$DESKTOP_W   = 1600;
$DESKTOP_H   = 635;

$MOBILE      = 'sporta-site/assets/hero/features-mobile.webp';
$MOBILE_SHA  = '8538feeb01f065c7f0f279cad78d40866f7ff4bce88caf3469291232670f70a3';
$MOBILE_W    = 1200;
$MOBILE_H    = 476;

$TITLE_EN = 'Sporta Features';   // the one stable identifier across an artwork change

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

function fetch_and_verify(string $commit, string $path, string $wantSha): ?string {
    $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $commit . '/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
                            CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200) {
        echo "ART fetch=FAILED path=$path http=$code bytes=" . strlen((string) $body) . "\n";
        return null;
    }
    $got = hash('sha256', $body);
    if ($got !== $wantSha) {
        echo "ART fetch=HASH-MISMATCH path=$path want=" . substr($wantSha, 0, 12)
           . " got=" . substr($got, 0, 12) . "\n";
        return null;
    }
    if (substr($body, 0, 4) !== 'RIFF' || substr($body, 8, 4) !== 'WEBP') {
        echo "ART fetch=NOT-A-WEBP path=$path bytes=" . strlen($body) . "\n";
        return null;
    }
    return $body;
}

$desktopBytes = fetch_and_verify($COMMIT, $DESKTOP, $DESKTOP_SHA);
if ($desktopBytes === null) return;
$mobileBytes = fetch_and_verify($COMMIT, $MOBILE, $MOBILE_SHA);
if ($mobileBytes === null) return;

$desktopUri = 'data:image/webp;base64,' . base64_encode($desktopBytes);
$mobileUri  = 'data:image/webp;base64,' . base64_encode($mobileBytes);
if (strlen($desktopUri) > 1200000 || strlen($mobileUri) > 1200000) {   // STORE_HERO_MAX
    echo "ART uri=TOO-LARGE desktop=" . strlen($desktopUri) . " mobile=" . strlen($mobileUri) . "\n";
    return;
}

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "ART db=NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );

    $find = $pdo->prepare('select id, image_hash from hero_slides where title_en = ? limit 1');
    $find->execute([$TITLE_EN]);
    $row = $find->fetch(PDO::FETCH_ASSOC);
    if (!$row) { echo "ART slide=NOT-FOUND title=\"$TITLE_EN\"\n"; return; }
    $id = (int) $row['id'];

    if ($row['image_hash'] !== $DESKTOP_SHA) {
        $pdo->prepare(
            'update hero_slides
                set image = ?, image_hash = ?, image_w = ?, image_h = ?,
                    image_mobile = ?, image_mobile_hash = ?, image_mobile_w = ?, image_mobile_h = ?
              where id = ?'
        )->execute([
            $desktopUri, $DESKTOP_SHA, $DESKTOP_W, $DESKTOP_H,
            $mobileUri, $MOBILE_SHA, $MOBILE_W, $MOBILE_H,
            $id,
        ]);
    }

    $q = $pdo->prepare(
        'select active, sort, image_w, image_h, image_mobile_w, image_mobile_h,
                length(image) as len, length(image_mobile) as mlen, image_hash
           from hero_slides where id = ?'
    );
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);

    echo "ART id=$id active={$s['active']} sort={$s['sort']}"
       . " desktop={$s['image_w']}x{$s['image_h']}/{$s['len']}b"
       . " mobile={$s['image_mobile_w']}x{$s['image_mobile_h']}/{$s['mlen']}b"
       . " hash=" . substr((string) $s['image_hash'], 0, 12) . "\n";
} catch (Throwable $e) {
    echo "ART db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
