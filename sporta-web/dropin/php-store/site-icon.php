<?php
// SITE ICON - the favicon, changed from /backends and kept in the database (owner, 2026-11-18: "make fav icon changer attached to seo and database").
//
// WHERE IT LIVES. Four rows of the existing `settings` table, no migration:
//   site_icon      {"v":"<12 hex>","sizes":[32,180,192],"by":"<admin e-mail>","at":"<ISO time>"}      the meta row, written LAST
//   site_icon_32   {"png":"<base64>"}      the browser tab / bookmark icon
//   site_icon_180  {"png":"<base64>"}      the iPhone / iPad home-screen icon (apple-touch-icon; drawn on white: iOS paints transparency black)
//   site_icon_192  {"png":"<base64>"}      the Android / search-result icon
// A picture is a row, not a file - the rule for brand logos and hero slides. An upload endpoint would be another way to write into the web root.
// (settings.value is a TEXT column, 64 KB: one row per size, and a size whose PNG is over STORE_SITE_ICON_MAX_B64 is refused with a clear message.)
//
// WHO SEES IT.
//   - the SEO head: api/seo-page.php swaps the shell's <link rel="icon"> / <link rel="apple-touch-icon"> for these URLs on every page it renders
//     (home, shop, product, about, contact ... - the pages a crawler reads), so the icon is part of the SEO a search engine fetches;
//   - the rest of the storefront (the cart, checkout, account pages that are served from the shell directly): ?r=content carries the same
//     {v, urls} and sporta-features.js points the page's icon links at it;
//   - the picture itself: api.php?r=site_icon&s=32|180|192&v=<hash>, bytes with a one-year immutable cache (the hash is the URL).
// With no custom icon every one of these does nothing and the shell's own /favicon-32.png, /favicon-192.png and /apple-touch-icon.png stay.
//
// WHAT IT ACCEPTS. Exactly the three sizes, each a PNG whose own header says that size in pixels (the browser makes them from one picture the
// owner chose), a real PNG from signature to IEND. Not SVG (it can carry script), not JPEG/WebP (an apple-touch-icon must be PNG), nothing the
// header contradicts. The admin screen shows the three previews before it saves.
declare(strict_types=1);

const STORE_SITE_ICON_SIZES = [32, 180, 192];
// base64 characters per size: settings.value is TEXT (65,535 bytes) and the JSON wrapper is ~10 bytes, so 60,000 leaves room and still holds a
// 192-pixel logo (typically 10-40 kB of PNG, 14-54 kB of base64).
const STORE_SITE_ICON_MAX_B64 = 60000;

function store_site_icon_row_name(int $size): string { return 'site_icon_' . $size; }

// PNG signature, a first chunk IHDR of 13 bytes, and the file ends with the 12-byte IEND chunk. Returns [width, height] or null.
function store_site_icon_png_dimensions(string $bytes): ?array {
    if (strlen($bytes) < 67 || !str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) return null;
    if (substr($bytes, 12, 4) !== 'IHDR' || unpack('N', substr($bytes, 8, 4))[1] !== 13) return null;
    if (substr($bytes, -12) !== "\x00\x00\x00\x00IEND\xaeB`\x82") return null;
    $w = unpack('N', substr($bytes, 16, 4))[1];
    $h = unpack('N', substr($bytes, 20, 4))[1];
    return [$w, $h];
}

/** Validate the admin's upload: {"32": "data:image/png;base64,...", "180": ..., "192": ...} and nothing else. Fails with a token on the first problem.
 *  @return array<int, string> size => base64 (no prefix) */
function store_site_icon_validate(mixed $icons): array {
    if (!is_array($icons) || array_is_list($icons) && $icons !== []) store_fail('site_icon_missing_size');
    foreach (array_keys($icons) as $k) {
        if (!in_array((string)$k, array_map('strval', STORE_SITE_ICON_SIZES), true)) store_fail('site_icon_unknown_size');
    }
    $out = [];
    foreach (STORE_SITE_ICON_SIZES as $size) {
        $v = $icons[(string)$size] ?? $icons[$size] ?? null;
        if (!is_string($v) || $v === '') store_fail('site_icon_missing_size');
        if (!preg_match('#^data:image/png;base64,([A-Za-z0-9+/]+={0,2})$#D', trim($v), $m)) store_fail('site_icon_not_png');
        if (strlen($m[1]) > STORE_SITE_ICON_MAX_B64) store_fail('site_icon_too_large');
        // settings.value is TEXT (64 KB) and store_setting_save() JSON-encodes the value, which escapes every "/" (a base64 picture is full of them):
        // measure the stored form, not the raw string, or a picture under the cap above could still be cut by the column and read back damaged.
        if (strlen((string)json_encode(['png' => $m[1]])) > 65000) store_fail('site_icon_too_large');
        $bytes = base64_decode($m[1], true);
        if ($bytes === false) store_fail('site_icon_not_png');
        $dim = store_site_icon_png_dimensions($bytes);
        if ($dim === null) store_fail('site_icon_not_png');
        if ($dim[0] !== $size || $dim[1] !== $size) store_fail('site_icon_wrong_dimensions');
        $out[$size] = $m[1];
    }
    return $out;
}

/** The meta row, or null when no custom icon is set (or its row is damaged: then the shell's own icons stay). */
function store_site_icon_meta(PDO $db): ?array {
    $row = store_setting_row($db, 'site_icon');
    $v = $row['v'] ?? null;
    if (!is_string($v) || !preg_match('/^[0-9a-f]{12}$/D', $v)) return null;
    return ['v' => $v, 'sizes' => STORE_SITE_ICON_SIZES, 'by' => (string)($row['by'] ?? ''), 'at' => (string)($row['at'] ?? '')];
}

/** Public: the version and the three URLs the head and the storefront use, or null. */
function store_site_icon_urls(PDO $db): ?array {
    $meta = store_site_icon_meta($db);
    if ($meta === null) return null;
    // the pictures must be there too: a meta row left behind by a hand edit must not advertise three links that 404 (one tiny query per page)
    $have = $db->query("select name from settings where name in ('site_icon_32', 'site_icon_180', 'site_icon_192')")->fetchAll(PDO::FETCH_COLUMN);
    if (count($have) !== count(STORE_SITE_ICON_SIZES)) return null;
    $urls = [];
    foreach (STORE_SITE_ICON_SIZES as $size) $urls[(string)$size] = '/api/api.php?r=site_icon&s=' . $size . '&v=' . $meta['v'];
    return ['v' => $meta['v'], 'urls' => $urls];
}

/** One size's PNG bytes, or null (no such size, no custom icon, or a row that does not decode). */
function store_site_icon_bytes(PDO $db, int $size): ?string {
    if (!in_array($size, STORE_SITE_ICON_SIZES, true)) return null;
    if (store_site_icon_meta($db) === null) return null;
    $png = store_setting_row($db, store_site_icon_row_name($size))['png'] ?? null;
    if (!is_string($png) || $png === '') return null;
    $bytes = base64_decode($png, true);
    return $bytes === false || store_site_icon_png_dimensions($bytes) === null ? null : $bytes;
}

/** The admin's view: no picture data, only what the screen needs to show and to bust its preview. */
function store_site_icon_status(PDO $db): array {
    $meta = store_site_icon_meta($db);
    if ($meta === null) return ['custom' => false, 'v' => null, 'sizes' => STORE_SITE_ICON_SIZES, 'updated_by' => null, 'updated_at' => null];
    return ['custom' => true, 'v' => $meta['v'], 'sizes' => STORE_SITE_ICON_SIZES, 'updated_by' => $meta['by'] ?: null, 'updated_at' => $meta['at'] ?: null];
}

/** Save the three sizes and the meta row in one transaction (the meta row last: a reader never sees a version whose pictures are not there yet). */
function store_site_icon_save(PDO $db, array $b64BySize, string $by): array {
    $v = substr(hash('sha256', implode('|', array_map(static fn (int $s): string => $s . ':' . $b64BySize[$s], STORE_SITE_ICON_SIZES))), 0, 12);
    $db->beginTransaction();
    try {
        foreach (STORE_SITE_ICON_SIZES as $size) store_setting_save($db, store_site_icon_row_name($size), ['png' => $b64BySize[$size]]);
        store_setting_save($db, 'site_icon', ['v' => $v, 'sizes' => STORE_SITE_ICON_SIZES, 'by' => mb_substr($by, 0, 120), 'at' => gmdate('c')]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        foreach (array_merge(['site_icon'], array_map('store_site_icon_row_name', STORE_SITE_ICON_SIZES)) as $n) store_setting_row($db, $n, true);
        throw $e;
    }
    return store_site_icon_status($db);
}

/** Back to the shop's own icons: the rows go (the meta row first, so the icon stops being offered before its pictures disappear). */
function store_site_icon_reset(PDO $db): array {
    $names = array_merge(['site_icon'], array_map('store_site_icon_row_name', STORE_SITE_ICON_SIZES));
    $db->beginTransaction();
    try {
        foreach ($names as $n) $db->prepare('delete from settings where name = ?')->execute([$n]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    } finally {
        foreach ($names as $n) store_setting_row($db, $n, true);
    }
    return store_site_icon_status($db);
}
