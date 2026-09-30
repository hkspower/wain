<?php
/**
 * Re-sync stage 2 of 3: the category-art MOBILE files, first half (7).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-cats-resync-2.php && php r.php
 *
 * See publish-cats-resync-1.php for the full explanation — this is the same
 * verify/re-sync job, split into three stages, covering the first half of
 * cats/mobile.
 */

$COMMIT = 'ea61ad7cb882889582bd56b7562ece080efbe0a2';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'cats/mobile/art-accessories.jpg'  => '1f5d8bc652e9983832904fd62010a3b61baae009b96c68f702628fb4663280f6',
    'cats/mobile/art-accessories.webp' => '50d77d35db0aaa62c83dd14ea39edbb4bdfb7f45b34e29911a85b416cac57fd6',
    'cats/mobile/art-men-rtl.jpg'      => '81e4a80d66418eb1a6f9d3b23ff61c7c842125990e4d2c72a3ced95ae22663f3',
    'cats/mobile/art-men-rtl.webp'     => 'ee5077e94b133aa71ec10f03fe2e95c48b98c7ee96840d3e158bde147e6e1541',
    'cats/mobile/art-men.jpg'          => 'bf944a6fd28cfb728165249d3c9c0a8aff36f124cba1756b98b07a6df6ba6dfb',
    'cats/mobile/art-men.webp'         => 'c951eac317c0bc7927ff1e7e501b96ba0a99ecf0b177a59633609b422354f769',
    'cats/mobile/art-outlet.jpg'       => '884485d6fef4b55ef08afdf73e4fe77c14507b9db105c4cb4a554195ac97122c',
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

echo 'CATS-RESYNC-2-MOBILE-A wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
