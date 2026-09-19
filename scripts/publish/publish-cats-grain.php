<?php
/**
 * Publish the grain fix for the repaired category tiles — 16 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-cats-grain.php && php r.php
 *
 * Follow-up to publish-cats-repair.php. That publish fixed the severe
 * pixelation on art-outlet, art-men, art-men-rtl and art-accessories, but
 * the feathered Gaussian blur it used left a completely flat, textureless
 * wash — reported directly, and visible on art-outlet especially, where the
 * rebuilt region covers ~60% of the frame. This adds a low-amplitude
 * luminance-noise layer into the blurred patches before compositing, so the
 * result reads as a soft photographic background rather than a smudge.
 * Same feathered boundaries and pixel dimensions as the previous publish —
 * texture only, no re-crop.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: sixteen named
 * paths, each checked against the sha256 recorded here before it is
 * written, pinned to one commit, fetched one at a time, idempotent.
 */

$COMMIT = '9445936b5b3deab4bb43c8938d284a0051c27ab5';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    "cats/desktop/art-outlet.jpg" => "520868be8d7e6106db4e947b2d3ce828d3d444e08c79127669cefc740671ffd4",
    "cats/desktop/art-outlet.webp" => "3d35f12daaf4dfb82fe7d29aa9c4a6119f239145c1e65c525379287ae4bd3453",
    "cats/mobile/art-outlet.jpg" => "884485d6fef4b55ef08afdf73e4fe77c14507b9db105c4cb4a554195ac97122c",
    "cats/mobile/art-outlet.webp" => "e7b180b78f02ef9fc7f1cc376070c42d7508e062dbc3eb0fc5e92ee95417dfcf",
    "cats/desktop/art-men.jpg" => "2ee4fef26cdf4667a565141d2655b46584dcf1bdee7213e70bdfd467f5d116b8",
    "cats/desktop/art-men.webp" => "f7e8a8002ac372143b56637ffe181f71acebaf00e741e067ecd4bc519bbbe77f",
    "cats/mobile/art-men.jpg" => "bf944a6fd28cfb728165249d3c9c0a8aff36f124cba1756b98b07a6df6ba6dfb",
    "cats/mobile/art-men.webp" => "c951eac317c0bc7927ff1e7e501b96ba0a99ecf0b177a59633609b422354f769",
    "cats/desktop/art-men-rtl.jpg" => "6328496365bc0724247ddcc40c01a5ad52202c19d7f364bf3f1d7f52c997511e",
    "cats/desktop/art-men-rtl.webp" => "29858eda177209f75d1796c90e798de79f6e675accd239b984e17e8ce2c95e7d",
    "cats/mobile/art-men-rtl.jpg" => "81e4a80d66418eb1a6f9d3b23ff61c7c842125990e4d2c72a3ced95ae22663f3",
    "cats/mobile/art-men-rtl.webp" => "ee5077e94b133aa71ec10f03fe2e95c48b98c7ee96840d3e158bde147e6e1541",
    "cats/desktop/art-accessories.jpg" => "911167c5ed7d93a7ceb10d4d7e19124e64c9022ecf18fc7fce2e8b03918ec77a",
    "cats/desktop/art-accessories.webp" => "11db33701a7cc653907409e6cb0e1a880c26bc2c3e985308d00f7dfdec098fa4",
    "cats/mobile/art-accessories.jpg" => "1f5d8bc652e9983832904fd62010a3b61baae009b96c68f702628fb4663280f6",
    "cats/mobile/art-accessories.webp" => "50d77d35db0aaa62c83dd14ea39edbb4bdfb7f45b34e29911a85b416cac57fd6",
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

echo 'CATS-GRAIN wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
