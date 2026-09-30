<?php
/**
 * Put the "Sporta Features" hero slide live — a second active photo slide,
 * asked for as "مميزات سبورتا as image at hero slide", added rather than
 * replacing "TRAIN HARD. LOOK BETTER." (the owner's choice out of two
 * offered), showing a photograph rather than a drawn banner (the owner's
 * choice out of two offered for that too).
 *
 * THE HEADLINE IS A DATABASE COLUMN, NOT BURNT INTO THE ARTWORK — same
 * shape as the existing photo slide (id 8, "Built for the box" / "TRAIN
 * HARD. LOOK BETTER."). title_en/title_ar render as real text the bundle
 * draws over the photograph, so they can be edited later without a new
 * image, and so the Arabic renders in the site's own font rather than
 * whatever an image generator's text layer happened to produce — this
 * project has a standing record of AI-rendered non-Latin script coming out
 * garbled, and the safest fix is not to ask an image model to render
 * Arabic at all.
 *
 * WHY THIS IS A DATABASE WRITE AND NOT A FILE PUBLISH, and why the artwork
 * lives OUTSIDE public_html in sporta-site/assets/hero/ rather than in the
 * docroot's own assets/ — same reasoning as publish-crossfit-hero-slide.php:
 * a hero slide is a database row, `?r=slide_image` serves it from
 * `hero_slides.image`, and a docroot copy would be a file the server holds
 * for nothing.
 *
 * SORT = 1, straight after the existing sort = 0 slide, and before the
 * three drawn banners (sort 23-25) — so it is the second slide a shopper
 * sees, not appended to the end behind artwork that predates every photo
 * slide this shop has ever had.
 *
 * FOCAL 18/50 is where the athlete actually sits in THIS composite — she
 * is anchored to the left edge with the full frame's height, not centred
 * the way a straight photograph would be, because the image itself was
 * built by scaling the source onto a wider canvas and extending the dark
 * background to the right (see the artwork's own commit message). A focal
 * point copied from the CrossFit slide's 62/50 would centre on empty
 * background here.
 *
 * IDEMPOTENT, AND IT REPORTS STATE RATHER THAN ITS OWN VERB — CLAUDE.md's
 * own recorded reason: a per-minute cron job keeps the LAST run's output,
 * and the run that did the work is rarely the one read. This prints the
 * same line whether it just wrote the row or found it already correct.
 *
 * BOTH FILES ARE VERIFIED BEFORE EITHER REACHES THE DATABASE. A hash
 * mismatch, a truncated fetch or a wrong commit on EITHER file aborts
 * before anything is written — half a slide is worse than none.
 *
 * $COMMIT is pinned to the full 40-character sha of the commit that added
 * both artwork files, per this project's own rule that an abbreviated or
 * unresolvable ref is an EMPTY fetch that says nothing.
 */

$COMMIT = '000aee1adceab38b347bfede601497ae72001a5e';

$DESKTOP     = 'sporta-site/assets/hero/features-desktop.webp';
$DESKTOP_SHA = '935be8a15aa8a69cebf7b4a5b0fc2172a457bb6c3c98a8a64cb520b3110dfc26';
$DESKTOP_W   = 1600;
$DESKTOP_H   = 635;

$MOBILE      = 'sporta-site/assets/hero/features-mobile.webp';
$MOBILE_SHA  = '98dd62fafb1d3e7e4ffc33bf564135302cce4c6ff9ff1146b149a502057980b4';
$MOBILE_W    = 1200;
$MOBILE_H    = 476;

$FX = 18;   // where the athlete sits in this composite, left-anchored
$FY = 50;

$TITLE_EN    = 'Sporta Features';
$TITLE_AR    = 'مميزات سبورتا';
$SUBTITLE_EN = 'Fast delivery, easy returns, 100% authentic gear';
$SUBTITLE_AR = 'توصيل سريع، إرجاع سهل، منتجات أصلية 100%';
$CTA_LABEL_EN = 'Shop now';
$CTA_LABEL_AR = 'تسوّق الآن';
$CTA_HREF     = '/shop';   // must start with / — store_internal_href() refuses anything else

$SORT = 1;   // straight after the existing sort=0 slide, before the drawn banners (23-25)

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

    // Identified by the DESKTOP artwork's hash, same as publish-crossfit-
    // hero-slide.php, so re-running is safe and a re-render with new bytes
    // is a new slide rather than a silent overwrite of something the owner
    // may have edited.
    $find = $pdo->prepare('select id, active, sort from hero_slides where image_hash = ?');
    $find->execute([$DESKTOP_SHA]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        if ((int) $row['active'] !== 1 || (int) $row['sort'] !== $SORT) {
            $pdo->prepare('update hero_slides set active = 1, sort = ? where id = ?')
                ->execute([$SORT, $row['id']]);
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
            $SORT, $TITLE_EN, $TITLE_AR, $SUBTITLE_EN, $SUBTITLE_AR,
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
        'select active, sort, image_w, image_h, image_mobile_w, image_mobile_h,
                focal_x, focal_y, title_en, length(image) as len,
                length(image_mobile) as mlen
           from hero_slides where id = ?'
    );
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);
    $live = (int) $pdo->query(
        'select count(*) from hero_slides where active = 1 and image is not null'
    )->fetchColumn();

    echo "SLIDE id=$id active={$s['active']} sort={$s['sort']} title=\"{$s['title_en']}\""
       . " desktop={$s['image_w']}x{$s['image_h']}/{$s['len']}b"
       . " mobile={$s['image_mobile_w']}x{$s['image_mobile_h']}/{$s['mlen']}b"
       . " focal={$s['focal_x']}/{$s['focal_y']} activeSlides=$live\n";
} catch (Throwable $e) {
    echo "SLIDE db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
