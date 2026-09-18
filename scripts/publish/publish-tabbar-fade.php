<?php
/**
 * Publish the mobile panel tab bar edge-fade — 3 files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-tabbar-fade.php && php r.php
 *
 * panel-tabbar-fade.js is a NEW file — no sw.js VERSION bump. .htaccess and
 * index.html both changed: the former now names the file in the no-cache
 * FilesMatch list, the latter loads it.
 *
 * SAME SAFETY SHAPE as every publisher in this directory: each path checked
 * against the sha256 recorded here before it is written, pinned to one
 * commit, fetched one at a time, idempotent.
 */

$COMMIT = 'fd5af5ec64eaa43fa170a62c6e1c25256c05ef55';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/panel-tabbar-fade.js' => 'ae3f58547eec7b832159c72285eacae0c0b128adf719398b0d24dd539e535da6',
    '.htaccess'                  => '81674566e4110a0da44f7f71eade6877cb40c5a865910e588153245c9ee7cef7',
    'index.html'                 => '5d9d7110abb71dad1ed6b852c8c45fdb34ffeec855e89732dc998f12b2e0a8f8',
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

echo 'TABBAR-FADE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
