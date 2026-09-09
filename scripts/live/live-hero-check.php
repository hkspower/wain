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

// The widest box the art is painted into, and the share of the width that
// survives object-fit: cover at that ratio. Both from sporta-ui.css.
const BOX_W   = 1280;   // an ordinary laptop; wider screens exist and are worse
const RATIO   = 1.90;   // --hero-h-md
const KEEP    = 0.75;   // share of a 2.52:1 source left after cropping to 1.90

$rows = $db->query(
    'select id, sort, active, image_w w, image_h h,
            length(image) bytes,
            substring(image, 1, 24) head,
            focal_x, focal_y
       from hero_slides order by sort, id'
)->fetchAll();

if (!$rows) { echo "HERO slides=0 — the shop has no banners\n"; exit; }

$soft = 0; $narrow = 0; $heavy = 0; $bits = [];

foreach ($rows as $r) {
    $w = (int) $r['w']; $h = (int) $r['h'];
    $kb = (int) round(((int) $r['bytes']) * 0.75 / 1024);   // base64 -> real bytes
    $ar = $h > 0 ? round($w / $h, 2) : 0;

    // What actually survives the crop, and what it is painted across.
    $usable = (int) round($w * KEEP);
    $need1x = (int) round(BOX_W / KEEP);        // source width for a crisp 1x
    $need2x = $need1x * 2;

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
