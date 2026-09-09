<?php
/**
 * The hero banners: what size they actually are, and what that costs.
 *
 *   php /home/<user>/live-hero-check.php
 *
 * READ-ONLY. It reads dimensions and byte counts and prints NO IMAGE DATA and
 * no configuration value — it is fetched over plain HTTP from a public
 * repository by a cron job.
 *
 * WHY IT EXISTS. sporta-ui.css carries a long, careful history of the hero's
 * SHAPE — 2.52 shipped, 1.65, 1.90 capped at 60svh on desktop, 2.10 on the
 * phone — and not one line about the PIXELS. Those are two different questions
 * and only one of them has ever been measured:
 *
 *   SHAPE decides how much of the picture is cropped. The box is object-fit:
 *   cover over a 2.52:1 image, so a 1.90 box keeps about 75% of the width.
 *
 *   PIXELS decide whether what survives the crop is SHARP. A 1600px-wide
 *   artwork, cropped to 75%, leaves 1200px of real picture. Painted across a
 *   1280px box on a 2x display that is 2560 device pixels asked of 1200 — a
 *   little over twice upscaled, which is the difference between a photograph
 *   and a smear, and no CSS can put it back.
 *
 * So this reports the source dimensions, the aspect each one actually is, the
 * weight, and what each would have to be to survive the crop at 1x and 2x.
 * The arithmetic is the point: "improve the quality" is answerable with a
 * number the owner can hand to whoever makes the artwork.
 *
 * ONE LINE PER SLIDE plus a summary, and cron returns only the last line — so
 * the summary is last, deliberately.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "HERO failed=no-config\n"; exit; }

try {
    $db = new PDO(
        'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
        (string) $cfg['db_user'], (string) $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) { echo "HERO failed=no-db\n"; exit; }

// MEASURED IN A BROWSER, not read off the CSS. The first version of this file
// took 1.90 and 75% from the comments in sporta-ui.css and was wrong on both:
// 1.90 is the RATIO, but the 60svh cap binds on every ordinary window, so the
// box a 1280x900 laptop actually paints is 1280x540 — an aspect of 2.37, which
// crops only 6% of a 2.52:1 source, not 25%.
//
//   desktop 1280x900   box 1280x540  aspect 2.37  keeps 94%
//   phone   393x852    box 393x187   aspect 2.10  keeps 83%
//
// The correction matters because it moves the fault. Cropping was never the
// problem; RESOLUTION is. Both boxes are served the same file whatever the
// device pixel ratio — there is no 2x asset — so a DPR-2 laptop wants 2560
// device pixels and gets 1504, and a DPR-3 phone wants 1179 and gets 833.
const BOX_W   = 1280;   // an ordinary laptop; wider screens exist and are worse
const RATIO   = 2.37;   // the box the 60svh cap actually produces there
const KEEP    = 0.94;   // share of a 2.52:1 source left after cropping to 2.37
const DPR     = 2;      // what an ordinary laptop or phone has today

$rows = $db->query(
    'select id, sort, active, image_w w, image_h h,
            length(image) bytes,
            substring(image, 1, 24) head,
            focal_x, focal_y
       from hero_slides order by sort, id'
)->fetchAll();

// NO SLIDES IS THE NORMAL STATE, not an error, and reporting only that would
// leave the question unanswered. With the table empty the shop draws the five
// banners SHIPPED IN THE DOCROOT, so measure those instead — they are the
// pictures a visitor is actually looking at.
if (!$rows) {
    $shipped = [];
    foreach (['desktop', 'mobile'] as $kind) {
        $dir = $ROOT . '/hero/' . $kind;
        if (!is_dir($dir)) continue;
        $w = 0; $h = 0; $kb = 0; $n = 0;
        foreach (glob($dir . '/*.webp') ?: [] as $f) {
            $sz = @getimagesize($f);
            if (!$sz) continue;
            $w = max($w, (int) $sz[0]); $h = max($h, (int) $sz[1]);
            $kb += (int) round(filesize($f) / 1024); $n++;
        }
        if ($n) $shipped[] = $kind . '=' . $n . 'x' . $w . 'x' . $h
                           . '/' . round($w / max($h, 1), 2) . ':1/' . $kb . 'kB total';
    }
    $need = (int) round(BOX_W / KEEP) * DPR;
    echo 'HERO slides=0 (the shipped banners are in use) ' . implode(' ', $shipped)
       . ' needForDpr' . DPR . '=' . $need . "px\n";
    exit;
}

$soft = 0; $narrow = 0; $heavy = 0; $bits = [];

foreach ($rows as $r) {
    $w = (int) $r['w']; $h = (int) $r['h'];
    $kb = (int) round(((int) $r['bytes']) * 0.75 / 1024);   // base64 -> real bytes
    $ar = $h > 0 ? round($w / $h, 2) : 0;

    // What actually survives the crop, and what it is painted across.
    $usable = (int) round($w * KEEP);
    $need1x = (int) round(BOX_W / KEEP);        // source width for a crisp 1x
    $need2x = $need1x * DPR;

    if ($w < $need1x) $narrow++;
    if ($w < $need2x) $soft++;
    if ($kb > 400)    $heavy++;

    // Format, from the data: URI prefix. Not decoded — the head is enough.
    $fmt = 'other';
    foreach (['webp', 'jpeg', 'png', 'avif'] as $f) {
        if (stripos((string) $r['head'], 'image/' . $f) !== false) { $fmt = $f; break; }
    }

    $bits[] = '#' . $r['sort'] . ':' . $w . 'x' . $h . '/' . $ar . ':1/' . $kb . 'kB/' . $fmt
            . ($r['active'] ? '' : '/OFF')
            . ' usable=' . $usable;
}

echo 'HEROSLIDES ' . implode('  ', $bits) . "\n";
echo 'HERO slides=' . count($rows)
   . ' box=' . BOX_W . 'px@' . RATIO . ':1 keeps=' . (int) (KEEP * 100) . '%'
   . ' needFor1x=' . (int) round(BOX_W / KEEP) . 'px'
   . ' needFor2x=' . (int) round(BOX_W / KEEP) * 2 . 'px'
   . ' tooNarrowFor1x=' . $narrow
   . ' tooNarrowFor2x=' . $soft
   . ' over400kB=' . $heavy . "\n";
