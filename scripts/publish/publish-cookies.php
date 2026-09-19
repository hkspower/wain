<?php
/**
 * Publish the three .htaccess files with the dead cookie rewrites removed.
 *
 *   php /home/<user>/publish-cookies.php
 *
 * WHY. Five `Header edit Set-Cookie` lines — two in the storefront's .htaccess,
 * three each-way in pay/ and knet/ — were meant to add Secure, HttpOnly and
 * SameSite to any cookie that arrived without them. LiteSpeed DOES NOT
 * IMPLEMENT `Header edit`. It emitted each directive as a header literally
 * named `edit:`, so the rules protected nothing and every response, including
 * every payment response, carried its own configuration back to the client.
 * Measured on this server before the change: `edit=2` on the home page.
 *
 * Nothing is lost. store_session_start() in api/store.php is the only place a
 * session starts here and it already sets the flags on the cookie params;
 * pay/ and knet/ set no cookies at all.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. It comes over plain HTTP from a PUBLIC
 * repository, so it is written so that anyone able to influence that fetch
 * gains nothing:
 *
 *   - It writes ONLY the three paths named below. No parameter, no input.
 *   - Each is checked against the sha256 recorded here BEFORE it is written.
 *   - Pinned to one COMMIT, not a branch.
 *   - Temp file + rename, so a request never sees half an .htaccess.
 *   - It deletes nothing, and creates no directory.
 *
 * AND ONE THING BEYOND THE USUAL, BECAUSE THIS FILE IS NOT LIKE THE OTHERS. A
 * broken .htaccess does not degrade the shop, it takes it down with a 500. So
 * each target is BACKED UP beside itself before the write, and after all three
 * are in place the shop is fetched over the loopback: if it does not answer
 * 200, every backup is rolled straight back and the run reports it. A publish
 * that cannot verify itself has no business touching this file.
 *
 * Re-running it is a no-op: a file already matching its hash is skipped.
 */

$COMMIT = '5fcfaa4f0e52405f6d4dfd67c242e0a6be62480d';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    ".htaccess" => "9d76edaa17334f5984464d17049e9b4d5e4b0c0a0ce839645b76e2535918cc8c",
    "pay/.htaccess" => "88334a62281adfacc9fff3d9696299a8be5f0336649a52553ce783d5781d818b",
    "knet/.htaccess" => "75d8e990375bfd2c0e1f6304886d120aeb3676720d58ea2f40faabe224a6ba03",
];

/** Is the shop still answering? Over the loopback with the Host header, which
 *  works whether or not the name resolves — see CLAUDE.md. */
function pub_shop_ok(): bool {
    $ch = curl_init('https://127.0.0.1/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code === 200 && is_string($body) && strlen($body) > 1000;
}

$wrote = 0; $same = 0; $bad = []; $failed = []; $backups = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // One at a time: three parallel fetches of this host have returned empty
    // files in this project before.
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
    if (!is_dir(dirname($target))) { $failed[] = $rel; continue; }

    // The backup comes first, and only if there is something to back up.
    if (is_file($target)) {
        $bk = $target . '.bak-' . date('Ymd-His');
        if (!@copy($target, $bk)) { $failed[] = $rel; continue; }
        $backups[$target] = $bk;
    }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

// THE CHECK THAT MAKES THE WRITE REVERSIBLE.
$shop = 'notchecked';
if ($wrote > 0) {
    if (pub_shop_ok()) {
        $shop = 'ok';
    } else {
        $shop = 'ROLLEDBACK';
        foreach ($backups as $target => $bk) @copy($bk, $target);
        $shop .= pub_shop_ok() ? '-recovered' : '-STILLDOWN';
    }
}

echo 'COOKIES wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES)
   . ' shop=' . $shop . "\n";
