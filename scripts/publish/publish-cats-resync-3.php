<?php
/**
 * Re-sync stage 3 of 3: the category-art MOBILE files, second half (7).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-cats-resync-3.php && php r.php
 *
 * See publish-cats-resync-1.php for the full explanation — this is the same
 * verify/re-sync job, split into three stages, covering the remainder of
 * cats/mobile.
 */

$COMMIT = 'ea61ad7cb882889582bd56b7562ece080efbe0a2';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'cats/mobile/art-outlet.webp'      => 'e7b180b78f02ef9fc7f1cc376070c42d7508e062dbc3eb0fc5e92ee95417dfcf',
    'cats/mobile/art-women-rtl.jpg'    => '5f6d6a54ee334c137164d8243b4902470918290a84d87ae4033553e891df094f',
    'cats/mobile/art-women-rtl.webp'   => '35b26d9ccc04b0f332b38cc3d44ac49bec1528b796af9f973a25aa208270a785',
    'cats/mobile/art-women.jpg'        => '17ea92c07c35388232b7cb0bcfe5c273d90797694c937b4ce576b1d2ffb37f14',
    'cats/mobile/art-women.webp'       => '39f47a5bf0c652e5e8cdedc9386e74ffab3042dfc9241124f36b2cb105a6927b',
    'cats/mobile/infobar.jpg'          => '3f737a054397e2946c175444e14c76c7eb2356dc81be7cd504afa05fb9494a16',
    'cats/mobile/infobar.webp'         => '4f553a7affcdfdb7b367508df5b725d3ef8d000e676339e11a2b10958b9c19c8',
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

echo 'CATS-RESYNC-3-MOBILE-B wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
