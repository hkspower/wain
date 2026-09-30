<?php
/**
 * Re-sync stage 1 of 3: the category-art DESKTOP files (14).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-cats-resync-1.php && php r.php
 *
 * No content has changed — this just verifies/re-syncs the live cats/desktop
 * directory against what is tracked in the repository, split into three
 * cron jobs (desktop / mobile part 1 / mobile part 2) so each job stays
 * short and each cron output is easy to read on its own.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: every path is
 * checked against the sha256 recorded here before it is written, pinned to
 * one commit, fetched one at a time, idempotent — a file already matching
 * is left untouched and counted in alreadyOk rather than re-fetched.
 */

$COMMIT = 'ea61ad7cb882889582bd56b7562ece080efbe0a2';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'cats/desktop/art-accessories.jpg'  => '911167c5ed7d93a7ceb10d4d7e19124e64c9022ecf18fc7fce2e8b03918ec77a',
    'cats/desktop/art-accessories.webp' => '11db33701a7cc653907409e6cb0e1a880c26bc2c3e985308d00f7dfdec098fa4',
    'cats/desktop/art-men-rtl.jpg'      => '6328496365bc0724247ddcc40c01a5ad52202c19d7f364bf3f1d7f52c997511e',
    'cats/desktop/art-men-rtl.webp'     => '29858eda177209f75d1796c90e798de79f6e675accd239b984e17e8ce2c95e7d',
    'cats/desktop/art-men.jpg'          => '2ee4fef26cdf4667a565141d2655b46584dcf1bdee7213e70bdfd467f5d116b8',
    'cats/desktop/art-men.webp'         => 'f7e8a8002ac372143b56637ffe181f71acebaf00e741e067ecd4bc519bbbe77f',
    'cats/desktop/art-outlet.jpg'       => '520868be8d7e6106db4e947b2d3ce828d3d444e08c79127669cefc740671ffd4',
    'cats/desktop/art-outlet.webp'      => '3d35f12daaf4dfb82fe7d29aa9c4a6119f239145c1e65c525379287ae4bd3453',
    'cats/desktop/art-women-rtl.jpg'    => 'e7480ce599e154f41abcd699fcd964c1f869bd5b8ac57cd666529213ae844406',
    'cats/desktop/art-women-rtl.webp'   => 'e43e8107a12c5fb4c98dd4115bb22c84e80957348b403e1946ed1cf166c2f6f8',
    'cats/desktop/art-women.jpg'        => 'c112320cd2fb4e46005d102a4b8fcdb2c4a16f1bc638482e6afba773ecd23760',
    'cats/desktop/art-women.webp'       => '5e229721e464ea64894fcb41f2a73ed304360556015185a49df467f826d2451a',
    'cats/desktop/infobar.jpg'          => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp'         => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
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

echo 'CATS-RESYNC-1-DESKTOP wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
