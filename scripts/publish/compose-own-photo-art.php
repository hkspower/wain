<?php
/**
 * ONLY THE OWNER'S OWN PRODUCT PHOTOGRAPHS — 2026-10-04 ("only use original product images only",
 * then: replace the generated pictures with your product photos; category tiles, hero slides and the
 * features band all go).
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/compose-own-photo-art.php && php c.php
 *
 * Builds the pictures ON THE SERVER, with GD, from the photographs already uploaded in /backends
 * (product_images) — the container cannot fetch them, and nothing generated is used:
 *
 *  1. CATEGORY TILES (category_art rows, the table /backends -> Home slides -> Category pictures writes):
 *     white ground, the shop's orange band on the far side, the category's own photographs on it as
 *     framed cards. Both crops, both languages (the Arabic layout is laid out mirrored, the photographs
 *     are NOT flipped, so no logo reads backwards), webp + jpg. A category with no photographed product
 *     (Accessories, Outlet today) gets the band alone — no picture is better than someone else's.
 *  2. HERO: the five generated photo slides (matched by their image hashes, publish-hero-neutral.php)
 *     are SWITCHED OFF, not deleted (active = 1 brings any back), and one slide per photographed
 *     category is added, built the same way, with no text over it and a link to the category.
 *     Its rows are marked by a fixed image_hash prefix-free key in title-less rows; a re-run replaces
 *     them rather than adding more.
 *  3. The features band is a CSS change (assets/trust-strip.js), published by publish-all.
 *
 * IDEMPOTENT, reports STATE. Undo for the tiles is one statement: delete from category_art (the
 * shipped files then serve again). Undo for the hero: re-activate the five, deactivate ours.
 */
declare(strict_types=1);
set_time_limit(280);
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';

const ORANGE = [224, 86, 28];
const GENERATED_HERO = [   // the five neutral slides of 2026-10-01 (desktop image hashes)
    'fae0112c1ea5ebe2565eebabbe06f9c0318757a8fa736e37eaaf28c63ba23a9f',
    'aad2f59f893eb2d3fab2ee04f160b97fdbbb925e742fb430b2b7545cd9094e3b',
    '1c113245a75cd13f5cb0100e3d675b22840b491e6c932d8fc97a39cd2a6f0581',
    '79adcfd9075dea0c19ebd3d44ce94dec427555502192e8b8ed3065b1e7609018',
    '3cfbd88622884ba9cc1db7b15048ce391868be0481ecb4992c8c900ac1ed8f46',
];
const OWN_HREF = ['women' => '/women', 'men' => '/men'];

/** One framed photograph: the picture with a white border and a soft shadow, scaled to height $h. */
function card(GdImage $canvas, GdImage $photo, int $x, int $y, int $h): int {
    $pw = imagesx($photo); $ph = imagesy($photo);
    $b = max(6, intdiv($h, 70));
    $ih = $h - 2 * $b; $iw = (int) round($pw * $ih / $ph); $w = $iw + 2 * $b;
    for ($i = 6; $i >= 1; $i--) {   // shadow: a few translucent steps, offset down-right
        $c = imagecolorallocatealpha($canvas, 0, 0, 0, 120 - $i * 4);
        imagefilledrectangle($canvas, $x + $i * 2, $y + $i * 3, $x + $w + $i * 2, $y + $h + $i * 3, $c);
    }
    imagefilledrectangle($canvas, $x, $y, $x + $w, $y + $h, imagecolorallocate($canvas, 255, 255, 255));
    imagecopyresampled($canvas, $photo, $x + $b, $y + $b, 0, 0, $iw, $ih, $pw, $ph);
    return $w;
}
function cardWidth(GdImage $p, int $h): int { $b = max(6, intdiv($h, 70)); return (int) round(imagesx($p) * ($h - 2 * $b) / imagesy($p)) + 2 * $b; }

/** The picture: white ground, orange band (and four thin stripes) on the far side, photographs on it. */
function compose(int $w, int $h, array $photos, bool $rtl, float $bandFrom, float $bandTo, float $photoH): GdImage {
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, true);
    imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 250, 250, 248));
    $mx = fn (float $x): int => (int) round($rtl ? $w - $x : $x);
    $s = $h * 0.25;
    $o = imagecolorallocate($im, ...ORANGE);
    $poly = fn (float $x0, float $x1) => [$mx($x0 + $s), -10, $mx($x1 + $s), -10, $mx($x1 - $s), $h + 10, $mx($x0 - $s), $h + 10];
    imagefilledpolygon($im, $poly($w * $bandFrom, $w * $bandTo), $o);
    $st = imagecolorallocatealpha($im, ORANGE[0], ORANGE[1], ORANGE[2], 90);
    for ($k = 1; $k <= 4; $k++) { $x = $w * $bandFrom - $k * $w * 0.022; imagefilledpolygon($im, $poly($x, $x + $w * 0.006), $st); }
    if ($photos) {
        // The cards must stay on the far side: the bundle prints the category name on the near side,
        // over the white. So the whole fan fits between bandFrom-4% and bandTo+2%, shrinking if needed.
        $ch = (int) round($h * $photoH);
        $fan = function (int $ch) use ($photos) {
            $widths = array_map(fn ($p) => cardWidth($p, $ch), $photos);
            $step = (int) round(max($widths) * 0.62);
            return [$widths, $step, $step * (count($photos) - 1) + end($widths)];
        };
        [$widths, $step, $total] = $fan($ch);
        $room = (int) round($w * ($bandTo - $bandFrom + 0.06));
        if ($total > $room) { $ch = (int) floor($ch * $room / $total); [$widths, $step, $total] = $fan($ch); }
        $centre = $w * ($bandFrom + $bandTo) / 2;
        $left = (int) round($centre - $total / 2);
        $left = max((int) round($w * ($bandFrom - 0.04)), min($left, $w - $total - (int) round($w * 0.02)));
        $y = (int) round(($h - $ch) / 2);
        // English: first photograph at the back-left. Arabic: the same order, laid out from the right.
        foreach ($photos as $i => $p) {
            $x = $left + $i * $step;
            if ($rtl) $x = $w - $x - $widths[$i];
            card($im, $p, $x, $y, $ch);
        }
    }
    return $im;
}
function encode(GdImage $im, string $fmt): string {
    ob_start();
    $fmt === 'webp' ? imagewebp($im, null, 82) : imagejpeg($im, null, 85);
    return (string) ob_get_clean();
}

try {
    $db = store_db();
    // The photographs: per category, the first photo of each STYLE (so three cards are three garments,
    // not one legging in three colours), active products only.
    $q = $db->query('select p.slug, p.category, i.image from products p
                       join product_images i on i.id = (select id from product_images x where x.slug = p.slug order by sort, id limit 1)
                      where p.active = 1 order by p.category, p.slug');
    $byCat = [];
    foreach ($q as $r) {
        [, $stem] = store_colour_from_slug((string) $r['slug']);
        $stem = $stem ?? $r['slug'];
        if (isset($byCat[$r['category']][$stem])) continue;
        if (!preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', (string) $r['image'], $m)) continue;
        $img = @imagecreatefromstring((string) base64_decode($m[2], true));
        if ($img instanceof GdImage) $byCat[$r['category']][$stem] = $img;
    }
    $have = array_map(fn ($a) => count($a), $byCat);
    line('PHOTOS ' . implode(' ', array_map(fn ($c, $n) => "$c=$n", array_keys($have), $have)));

    // ---- 1. category tiles
    $tilesWritten = 0;
    $put = $db->prepare('insert into category_art (tile, variant, fmt, bytes, etag) values (?, ?, ?, ?, ?)
                         on duplicate key update bytes = values(bytes), etag = values(etag)');
    foreach (STORE_CAT_TILES as $tile) {
        $photos = array_values($byCat[$tile] ?? []);
        foreach (STORE_CAT_VARIANTS as $crop => [$w, $h]) {
            $n = $crop === 'desktop' ? 3 : 2;
            foreach (['' => false, '-rtl' => true] as $suffix => $rtl) {
                $im = compose($w, $h, array_slice($photos, 0, $n), $rtl, 0.50, 0.95, 0.80);
                foreach (['webp', 'jpg'] as $fmt) {
                    $bytes = encode($im, $fmt);
                    if (strlen($bytes) > STORE_CAT_MAX_BYTES) { $bytes = $fmt === 'webp' ? (function () use ($im) { ob_start(); imagewebp($im, null, 65); return (string) ob_get_clean(); })() : (function () use ($im) { ob_start(); imagejpeg($im, null, 70); return (string) ob_get_clean(); })(); }
                    $put->execute([$tile, $crop . $suffix, $fmt, $bytes, md5($bytes)]);
                    $tilesWritten++;
                }
                imagedestroy($im);
            }
        }
    }

    // ---- 2. hero: generated slides off, one own-photo slide per photographed category
    $in = implode(',', array_fill(0, count(GENERATED_HERO), '?'));
    $off = $db->prepare("update hero_slides set active = 0 where image_hash in ($in) and active = 1");
    $off->execute(GENERATED_HERO);
    $added = 0;
    foreach (OWN_HREF as $cat => $href) {
        $photos = array_values($byCat[$cat] ?? []);
        if (!$photos) continue;
        $d = compose(3200, 1270, array_slice($photos, 0, 4), false, 0.18, 0.86, 0.82);
        $mo = compose(1080, 1350, array_slice($photos, 0, 2), false, 0.10, 0.92, 0.62);
        $db_ = encode($d, 'webp'); $mb = encode($mo, 'webp');
        imagedestroy($d); imagedestroy($mo);
        $uri = 'data:image/webp;base64,' . base64_encode($db_);
        $muri = 'data:image/webp;base64,' . base64_encode($mb);
        // Ours are the rows whose cta_href is the category AND whose text is empty: replaced, never added twice.
        $ex = $db->prepare("select id from hero_slides where cta_href = ? and coalesce(title_en,'') = '' and coalesce(title_ar,'') = ''
                              and image_hash not in ($in) order by id limit 1");
        $ex->execute(array_merge([$href], GENERATED_HERO));
        $id = $ex->fetchColumn();
        $vals = [$uri, hash('sha256', $db_), $muri, hash('sha256', $mb)];
        if ($id) {
            $db->prepare('update hero_slides set image = ?, image_hash = ?, image_w = 3200, image_h = 1270, image_mobile = ?, image_mobile_hash = ?,
                                 image_mobile_w = 1080, image_mobile_h = 1350, focal_x = 50, focal_y = 50, active = 1 where id = ?')->execute([...$vals, $id]);
        } else {
            $sort = (int) $db->query('select coalesce(min(sort), 0) - 1 from hero_slides')->fetchColumn();
            $db->prepare('insert into hero_slides (sort, active, cta_href, image, image_hash, image_w, image_h, image_mobile, image_mobile_hash,
                                 image_mobile_w, image_mobile_h, focal_x, focal_y) values (?, 1, ?, ?, ?, 3200, 1270, ?, ?, 1080, 1350, 50, 50)')
               ->execute([$sort, $href, ...$vals]);
        }
        $added++;
    }

    $genActive = $db->prepare("select count(*) from hero_slides where image_hash in ($in) and active = 1");
    $genActive->execute(GENERATED_HERO);
    $activeAll = (int) $db->query('select count(*) from hero_slides where active = 1')->fetchColumn();
    $tiles = (int) $db->query('select count(*) from category_art')->fetchColumn();
    line("STATE tileRows=$tiles/32 writtenThisRun=$tilesWritten ownHeroSlides=$added generatedHeroActive=" . $genActive->fetchColumn() . " heroActive=$activeAll");
} catch (Throwable $e) { line('ERROR ' . $e->getMessage()); }
