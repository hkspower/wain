<?php
/**
 * Publish the ten tracked files the live server does not have.
 *
 *   php /home/<user>/publish-assets.php
 *
 * WHY. live-file-check.php reported `same=163/173 differ=0 missing=10` on
 * 2026-09-09. Nothing live was WRONG — but ten files the repository tracks had
 * never reached the server, and two of them matter:
 *
 *   fonts/Alexandria-400.ttf — api/invoice-pdf.php looks for this font in three
 *     places and, finding none, `return null`s. No PDF invoice is produced AT
 *     ALL, for any order, and nothing reports it: the caller gets null and the
 *     shop carries on. A missing font reads like a cosmetic problem and is not.
 *
 *   images/<brand>/PUT-LOGO-HERE.txt — eight of them, plus images/README.txt.
 *     store_brand_logo_file() (api/store.php) serves a brand logo from
 *     `images/<slug>/logo.png|webp|jpg`, so a logo can be published by dropping
 *     a file in a folder, with no tool and no rebuild. On the server those
 *     eight folders DO NOT EXIST, so there is nowhere to drop one — which is
 *     part of why brandLogos is 0/8. Each .txt names its brand and says what to
 *     put beside it, in Arabic and English. They are the instructions AND the
 *     folders.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. It comes over plain HTTP from a PUBLIC
 * repository, so it is written so that anyone able to influence that fetch
 * gains nothing:
 *
 *   - It writes ONLY the ten paths named below. No parameter, no input, no
 *     loop over a directory.
 *   - Every file is checked against the sha256 recorded here BEFORE it is
 *     written. A byte out of place and it is refused, not written.
 *   - Pinned to one COMMIT, not a branch, so what it fetches cannot change
 *     under it.
 *   - Temp file + rename, so nothing half-written is ever served.
 *   - It deletes nothing.
 *
 * THE ONE THING THIS PUBLISHER DOES THAT THE OTHERS DO NOT is create a
 * directory: the eight brand folders are not there, and the usual publishers
 * treat a missing parent as a failure precisely so that a typo cannot scatter
 * files across the docroot. So the mkdir here is deliberately narrow — only
 * directly under images/, only a name matching the same strict slug pattern
 * store_brand_logo_file() enforces before it will read one. `../` cannot pass
 * it, and nothing outside images/ can be created whatever arrives.
 *
 * Re-running it is a no-op: a file already matching its hash is skipped.
 */

$COMMIT = '55545a5cb9a0a29a0aa301d4385507a6f256f34c';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    "fonts/Alexandria-400.ttf" => "29817527e857c0cf40b4b37f8f307c6f2fcc5044954868ae62455631aed1c124",
    "images/README.txt" => "7a4aa1eedc240ba16a2fb5dea97b84fd1c02eea6a06aadc3baa2a12145f88c78",
    "images/ahed/PUT-LOGO-HERE.txt" => "17016da765f747fb1cb1839dadc9bb98d308104def94d6808f05f2c27e42de04",
    "images/ate/PUT-LOGO-HERE.txt" => "d6b813220734f1af3c0f1dbcee1c099e10dfd007c53113a0ded12a9c6813effc",
    "images/eyesportwear/PUT-LOGO-HERE.txt" => "f193ad1a6900793415dfa76098a5d134a7d3df21af834d075470273e24912168",
    "images/gymshark/PUT-LOGO-HERE.txt" => "b30b0bfc1d9f91c28a82ff2664d7f20655e53ad724523107b64750d4d48c2a18",
    "images/nba/PUT-LOGO-HERE.txt" => "61d8f1501f5f308f7866e51dc07ae1a73244555f5963820d0a353538330e619d",
    "images/rheo/PUT-LOGO-HERE.txt" => "a4b7c2a548abf314ae74fb2f658db993f589697428ce841feb93dee4bf2b16f1",
    "images/sporta/PUT-LOGO-HERE.txt" => "1a3a4e03d799fea20641304473e95ded5b25321badebbffc6d3988985b797300",
    "images/vanquish/PUT-LOGO-HERE.txt" => "7b634c7c39ee98859bfca99b0bcc1b41e536a1e1b74f42780435a244f39d36d1",
];

/** The only directory this script may bring into existence: images/<slug>.
 *  Same pattern store_brand_logo_file() checks a slug against before reading. */
function pub_ensure_dir(string $root, string $rel): bool {
    $dir = dirname($root . '/' . $rel);
    if (is_dir($dir)) return true;
    if (!preg_match('#^images/([a-z0-9][a-z0-9-]{0,63})/[^/]+$#', $rel)) return false;
    return @mkdir($dir, 0755) && is_dir($dir);
}

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    // Already correct? Then this run has nothing to do for it.
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // One at a time, deliberately. Three parallel fetches of this host
    // returned EMPTY FILES earlier in this project -- served to the first
    // request and dropped for the others -- and wget's -q hid it.
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
    if (!pub_ensure_dir($ROOT, $rel)) { $failed[] = $rel; continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

// The font is the one whose absence is silent, so say outright whether the
// invoice generator can now find it, rather than leaving it to be inferred
// from a count.
$font = is_file($ROOT . '/fonts/Alexandria-400.ttf') && is_readable($ROOT . '/fonts/Alexandria-400.ttf');

echo 'ASSETS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES)
   . ' invoiceFont=' . ($font ? 'readable' : 'MISSING') . "\n";
