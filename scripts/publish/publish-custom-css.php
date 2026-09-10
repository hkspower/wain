<?php
/**
 * Publish the Extra CSS box.
 *
 *   php /home/<user>/publish-custom-css.php
 *
 * SIX FILES, and two of them are api/. That is the part to read twice:
 *
 *   api/store.php   adds 'css' => '' to the theme defaults. Nothing else.
 *   api/admin.php   validates and stores it — 20 kB, no `</`, no NUL.
 *   assets/theme.js applies it on the storefront and NOT on /backends.
 *   assets/custom-css.js  the box itself, on the panel's Settings screen.
 *   index.html      loads it, after admin-upload.js which it depends on.
 *   .htaccess       adds custom-css.js to the revalidate list.
 *
 * WHY api/ IS SAFE HERE. Both changes are additive: a new key with an empty
 * default, and a new branch that runs only when that key is non-empty. A shop
 * that never opens the box behaves exactly as before, which is checkable — the
 * check below asks the public ?r=theme for the key and expects it EMPTY.
 *
 * WHY THE ORDER OF THE FILES DOES NOT MATTER but the order of the SCRIPTS
 * does. admin-upload.js defines window.sportaUpload and custom-css.js returns
 * immediately without it; index.html loads them as `defer` in document order.
 * A half-published set is a missing box, not a broken panel.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - six paths, named below, nothing derived from input
 *   - each checked against a sha256 recorded here BEFORE it is written
 *   - .htaccess REFUSED unless the live copy is exactly the version this was
 *     made against, with a timestamped backup kept beside it
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing
 *
 * THE CHECK ASKS THE SERVER. `themeCss=empty` is the one that matters: it
 * proves the new key exists and that publishing it changed nothing for a shop
 * that has not used it.
 */

$COMMIT = 'PLACEHOLDER_COMMIT';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/** The .htaccess this was made against — the copy published with the tile fix. */
$HTACCESS_MUST_BE = 'f09e1308cffc48b9e1d1deacabc9e06a8c950e81246e75424aaf354869d376a6';

$FILES = [
    'api/store.php'         => '7935d87f24da5989464c5eb74e0dc853cfa95db7918f2a099b05dd88a91c0392',
    'api/admin.php'         => '4931e44f0307509569b12ee63227250454aeff1bcfa5d863e448e4643f502ea0',
    'assets/theme.js'       => '9e7403a23f64d536ce66b86feb07a264c48d15761d17eb53e608b3c959ae8992',
    'assets/custom-css.js'  => '6f7d96f6fc0facadddd75b67ea84af8036179396595a80eecd1d952169237a99',
    'index.html'            => '6133aee13062e3063f474a4e506f42c45ec6ca09c5686fece05ee8ff0b9aed27',
    '.htaccess'             => '309ce3cf0055a46e7cf403b6655d35fdffbedf10144fd02dff779ddfbbc901d4',
];

$wrote = 0; $same = 0; $bad = []; $failed = []; $refused = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if ($rel === '.htaccess' && is_file($target)) {
        $now = hash_file('sha256', $target);
        if ($now !== $want && $now !== $HTACCESS_MUST_BE) { $refused[] = $rel; continue; }
    }

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 90,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    if ($rel === '.htaccess' && is_file($target)) {
        @copy($target, $ROOT . '/.htaccess.bak-' . date('Ymd-His'));
    }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

$get = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Cache-Control: no-cache'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $body];
};

[, $theme] = $get('/api/api.php?r=theme');
$t = json_decode($theme, true);
$hasKey = is_array($t) && array_key_exists('css', $t);
$isEmpty = $hasKey && trim((string) $t['css']) === '';

[, $home] = $get('/');
[$jsCode, $js] = $get('/assets/custom-css.js');
[, $tjs] = $get('/assets/theme.js');

echo 'CUSTOMCSS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' refused=' . (count($refused) ? implode(',', $refused) : '0')
   . ' themeCss=' . ($hasKey ? ($isEmpty ? 'empty' : 'SET') : 'MISSING-KEY')
   . ' scriptTag=' . (strpos($home, '/assets/custom-css.js') !== false ? 'ok' : 'MISSING')
   . ' boxBytes=' . ($jsCode === 200 ? strlen($js) : 'HTTP' . $jsCode)
   . ' panelGuard=' . (strpos($tjs, 'onPanel') !== false ? 'ok' : 'MISSING')
   . "\n";
