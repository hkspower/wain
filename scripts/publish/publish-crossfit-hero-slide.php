<?php
/**
 * Put the CrossFit hero slide live — imported from the "CrossFit Hero Slide"
 * Claude Design canvas (https://claude.ai/artifact/KmdQ2WBNtt5enSfJkftgh3).
 *
 * WHAT CAME FROM THE CANVAS AND WHAT DID NOT. The canvas's own Specs.dc.html
 * page describes a "kicker" field ("CROSS TRAINING" / "تدريب متقاطع") and a
 * separate mobile FILE per language. Neither exists in the real shop:
 * hero_slides has no kicker column at all, and it holds ONE photograph for
 * both languages — the "-rtl" mirrored composition the canvas mocked up with
 * `transform: scaleX(-1)` is how the category ART system works, not hero
 * slides. The kicker is dropped rather than invented a home for it; the
 * title, subtitle, CTA and photograph are real columns and are carried over.
 *
 * WHY THIS IS A DATABASE WRITE AND NOT A FILE PUBLISH, and why the artwork
 * lives OUTSIDE public_html in sporta-site/assets/hero/ rather than in the
 * docroot's own assets/ — same reasoning as publish-hero-slide.php: a hero
 * slide is a database row, `?r=slide_image` serves it from `hero_slides.image`,
 * and a docroot copy would be a file the server holds for nothing.
 *
 * NO ROWS TODAY MEANS FIVE DRAWN SLIDES. Running this for the first time is
 * not "add a slide to a carousel" — it is the moment the front page stops
 * showing the drawn art and starts showing a photograph, because the bundle
 * falls back to the five shipped banners only when `slides` is empty.
 *
 * FOCAL 62/50 IS THE CANVAS'S OWN CROP. Main.dc.html and Phone.dc.html both
 * render the photograph at `object-position: 62% center`, which is where the
 * athlete sits inside this 2.52:1 frame — a focal point anywhere else re-crops
 * the picture on a phone through empty background instead of the subject.
 *
 * IDEMPOTENT, AND IT REPORTS STATE RATHER THAN ITS OWN VERB — CLAUDE.md's own
 * recorded reason: a per-minute cron job keeps the LAST run's output, and the
 * run that did the work is rarely the one read. This prints the same line
 * whether it just wrote the row or found it already correct, naming both
 * SHAs and the id either way.
 *
 * BOTH FILES ARE VERIFIED BEFORE EITHER REACHES THE DATABASE. A hash mismatch,
 * a truncated fetch or a wrong commit on EITHER file aborts before anything is
 * written — half a slide (a desktop photo with no mobile crop, or the reverse)
 * is worse than none.
 *
 * $COMMIT below is pinned to the full 40-character sha of the commit that
 * added the two files it fetches (394021f…), per this project's own rule that
 * an abbreviated or unresolvable ref is an EMPTY fetch that says nothing.
 */

$COMMIT = '394021f65f8eaf0f3af3180af071bba0069d5650';

$DESKTOP     = 'sporta-site/assets/hero/crossfit-desktop.webp';
$DESKTOP_SHA = '355f09f5eec8db5f9ca195b946c075eeb89f2aee9b3cacdb677a9178bd8b2c9a';
$DESKTOP_W   = 1600;
$DESKTOP_H   = 635;

$MOBILE      = 'sporta-site/assets/hero/crossfit-mobile.webp';
$MOBILE_SHA  = 'ba617279dfd8103ecd10d725f9fc27d8545f86cf5f399a352cc4532aff5b8039';
$MOBILE_W    = 1200;
$MOBILE_H    = 476;

$FX = 62;   // the canvas's own object-position
$FY = 50;

$TITLE_EN    = 'Built for the box';
$TITLE_AR    = 'مصنوع للتحدي';
$SUBTITLE_EN = 'Performance kit for every WOD — built to be chalked, dropped and worn again tomorrow.';
$SUBTITLE_AR = 'ملابس أداء لكل تمرين — تتحمّل الطباشير والسقوط وتعود غدًا.';
$CTA_LABEL_EN = 'Shop now';
$CTA_LABEL_AR = 'تسوّق الآن';
$CTA_HREF     = '/shop';   // must start with / — store_internal_href() refuses anything else

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

// ------------------------------------------------------------------ the bytes
function fetch_and_verify(string $commit, string $path, string $wantSha): ?string {
    $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $commit . '/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
                            CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200) {
        echo "SLIDE fetch=FAILED path=$path http=$code bytes=" . strlen((string) $body) . "\n";
        return null;
    }
    $got = hash('sha256', $body);
    if ($got !== $wantSha) {
        echo "SLIDE fetch=HASH-MISMATCH path=$path want=" . substr($wantSha, 0, 12)
           . " got=" . substr($got, 0, 12) . "\n";
        return null;
    }
    if (substr($body, 0, 4) !== 'RIFF' || substr($body, 8, 4) !== 'WEBP') {
        echo "SLIDE fetch=NOT-A-WEBP path=$path bytes=" . strlen($body) . "\n";
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
    echo "SLIDE uri=TOO-LARGE desktop=" . strlen($desktopUri) . " mobile=" . strlen($mobileUri) . "\n";
    return;
}

// --------------------------------------------------------------------- the db
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "SLIDE db=NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );

    // Identified by the DESKTOP artwork's hash, same as publish-hero-slide.php,
    // so re-running is safe and a re-render with new bytes is a new slide
    // rather than a silent overwrite of something the owner may have edited.
    $find = $pdo->prepare('select id, active from hero_slides where image_hash = ?');
    $find->execute([$DESKTOP_SHA]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        if ((int) $row['active'] !== 1) {
            $pdo->prepare('update hero_slides set active = 1 where id = ?')->execute([$row['id']]);
        }
        $id = (int) $row['id'];
    } else {
        $ins = $pdo->prepare(
            'insert into hero_slides
               (sort, active, title_en, title_ar, subtitle_en, subtitle_ar,
                cta_label_en, cta_label_ar, cta_href,
                image, image_hash, image_w, image_h,
                image_mobile, image_mobile_hash, image_mobile_w, image_mobile_h,
                focal_x, focal_y)
             values (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            0, $TITLE_EN, $TITLE_AR, $SUBTITLE_EN, $SUBTITLE_AR,
            $CTA_LABEL_EN, $CTA_LABEL_AR, $CTA_HREF,
            $desktopUri, $DESKTOP_SHA, $DESKTOP_W, $DESKTOP_H,
            $mobileUri, $MOBILE_SHA, $MOBILE_W, $MOBILE_H,
            $FX, $FY,
        ]);
        $id = (int) $pdo->lastInsertId();
    }

    // THE STATE, read back rather than assumed — a check that cannot fail is
    // not a check.
    $q = $pdo->prepare(
        'select active, image_w, image_h, image_mobile_w, image_mobile_h,
                focal_x, focal_y, title_en, length(image) as len,
                length(image_mobile) as mlen
           from hero_slides where id = ?'
    );
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);
    $live = (int) $pdo->query(
        'select count(*) from hero_slides where active = 1 and image is not null'
    )->fetchColumn();

    echo "SLIDE id=$id active={$s['active']} title=\"{$s['title_en']}\""
       . " desktop={$s['image_w']}x{$s['image_h']}/{$s['len']}b"
       . " mobile={$s['image_mobile_w']}x{$s['image_mobile_h']}/{$s['mlen']}b"
       . " focal={$s['focal_x']}/{$s['focal_y']} activeSlides=$live\n";
} catch (Throwable $e) {
    echo "SLIDE db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
