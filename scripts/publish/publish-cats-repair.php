<?php
/**
 * Publish the category-tile repair — 16 files, one run.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-cats-repair.php && php r.php
 *
 * WHY. Every cats/*.jpg and *.webp was inspected VISUALLY — not just checked
 * for existence, size and dimensions, which is all any prior audit had ever
 * done — and four of the seven compositions turned out to have real damage:
 * blocky mosaic/upscale-style corruption, not a rendering bug.
 *
 *   art-outlet       (desktop+mobile)  SEVERE, ~60% of the frame
 *   art-men-rtl      (desktop+mobile)  SEVERE, ~60% of the frame
 *   art-men          (desktop+mobile)  mild, one corner
 *   art-accessories  (desktop+mobile)  mild, around the cap and bottles
 *
 * art-women, art-women-rtl and infobar were already clean and are NOT in
 * this list — they need no republish.
 *
 * art-men-rtl was not patched, it was REGENERATED: art-women-rtl.jpg was
 * confirmed to be an exact horizontal flip of art-women.jpg (same pose, same
 * everything, only JPEG noise) — this shop's established pattern for the
 * Arabic composition — so art-men-rtl is the flip of the separately-repaired
 * art-men.jpg, a verified reconstruction rather than a guess. art-outlet has
 * no such mirror source, so its corrupted region was rebuilt from its own
 * clean boundary strip, stretched and blended. art-men and art-accessories'
 * smaller artifacts were repaired with a masked, feathered blur confined to
 * the damaged pixels only.
 *
 * NO CACHE/VERSION CHANGE NEEDED. .htaccess already marks cats/ as
 * owner-replaceable artwork (SPORTA_REPLACEABLE_IMAGE: a day fresh, then
 * stale-while-revalidate) and sw.js's rule 2b caches these cache-first and
 * quietly refreshes them in the background — both read, not assumed, before
 * deciding this file carries no sw.js edit.
 *
 * WHY IT IS SAFE TO FETCH AND RUN, same shape as publish-cats.php before it:
 *   - sixteen paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not the working branch (its slash makes a
 *     raw.githubusercontent ref ambiguous)
 *   - fetched ONE AT A TIME — concurrent raw.githubusercontent fetches have
 *     produced empty files here before
 *   - temp file + rename; deletes nothing; idempotent
 */

$COMMIT = 'ed1646a84d5fb2ff0a9d2c532f28365f27d9b759';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    "cats/mobile/art-men.jpg" => "5d346297dc19ff982733556b3aa36d4b74c449ec4086748809cb7ac9a70cc74c",
    "cats/mobile/art-men.webp" => "7ed1ec1bdf586ffc6a5b4bb7c07541a6097d3f4dbe79d6a6d2c4105236e66b9a",
    "cats/mobile/art-men-rtl.jpg" => "3762085c6843b6cc865894368999f4dbdcd175c79c4f791ee76914d1166ff8fa",
    "cats/mobile/art-men-rtl.webp" => "e3b123c5ea8ace4b044e807569b5c41d23fdf9f587598bf50bbe914b575cd749",
    "cats/mobile/art-accessories.jpg" => "4cce593ff3305e884728e9ada9e364b7daa7953ca2f2c08fe9e4ab83cbe09320",
    "cats/mobile/art-accessories.webp" => "29d75466c77a2f2893be01fb36291dce27210328e40e77bcacc039b9d8867fe3",
    "cats/mobile/art-outlet.jpg" => "b9e2428680ddf010eb6cf9ddb8b23780a9f5db0cbd7776197cb10a07a374b550",
    "cats/mobile/art-outlet.webp" => "024fdc0bfb517800ffe263ebe824fca137cff2281d49f1e90603a94a52dad817",
    "cats/desktop/art-men.jpg" => "bfa61c4d6536835177f7f478dee89213145125f8ea30a75f6585cbf8298a6ff7",
    "cats/desktop/art-men.webp" => "e094718ad6528bff4ddb533aa15f0808ad169cb2883545f3c6e3fed64b58f0ce",
    "cats/desktop/art-men-rtl.jpg" => "7e9f41837ddc29d982afa1cad6d997d21a0600c3d1b0de20037dec8dda81ee80",
    "cats/desktop/art-men-rtl.webp" => "56ff25724a63e16dabaa16be96d0d84c4fb47b40ce21951790292bcde4f67fe3",
    "cats/desktop/art-accessories.jpg" => "181c22f0640699e638caa0f2918a531da043a68919937a1a5ad031b204fd17e3",
    "cats/desktop/art-accessories.webp" => "38589a900a3922a96e04c3432f3d9eb98095c0ba2c8a9dc404159eb949e9310a",
    "cats/desktop/art-outlet.jpg" => "3b77ef06fae997a86d843739707c10c48cc95e515e582d416107248e3daea6d4",
    "cats/desktop/art-outlet.webp" => "92b8dbe63ccaacb24c9eaef0bf5ae3909c4737d92f14a9f1136d266a6f742918",
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel; continue; }

    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

echo 'CATS-REPAIR wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
