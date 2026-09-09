<?php
/**
 * Publish the brand-logo uploader — and REPAIR THE CSP HASH that has been
 * blocking index.html's boot script since the one-mode change went out.
 *
 *   php /home/<user>/publish-brand-logos.php
 *
 * THREE FILES, and the second is a repair rather than a feature:
 *
 *   assets/brand-logos.js  new. Adds one card to the panel's Brands screen for
 *                          uploading every brand's logo at once. It touches no
 *                          existing element and does nothing outside /backends.
 *   index.html             registers that script, one <script src> line.
 *   .htaccess              ONE STRING CHANGED: the sha256 that allows the
 *                          inline boot script.
 *
 * WHY THE .htaccess CHANGE IS URGENT. That inline script decides the language
 * before the first paint, pins the theme, and caches the hero height. It runs
 * only because a sha256 in the policy names it — and the one-mode change
 * edited the script without updating the hash, so the live server has been
 * REFUSING TO RUN IT. Measured from the server: `hashesAllowed=5
 * inlineScripts=5 allowed=4 BLOCKED=1`. Nothing reports this: the browser
 * writes a console line nobody reads, and the symptoms — a page that flips
 * from English to Arabic, a theme that does not stick, the hero jumping — look
 * like anything but a security header.
 *
 * PUBLISHING THE WHOLE .htaccess IS SAFE HERE, AND IT IS CHECKED. CLAUDE.md
 * warns against writing this file over a rolled-back server, because that
 * carries kilobytes of unrelated change. So this refuses unless the live copy
 * is EXACTLY the version this change was made against — sha256 recorded below.
 * If the server holds anything else, it writes nothing and says so, and the
 * repair becomes a hand-made patch instead.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - three paths, named below, nothing derived from input
 *   - each checked against a sha256 recorded here BEFORE it is written
 *   - .htaccess additionally checked BEFORE, against what it must replace
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing
 *
 * No service-worker bump: index.html is a navigation and brand-logos.js has no
 * content hash, so sw.js treats both network-first.
 */

$COMMIT = 'PLACEHOLDER_COMMIT';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/** The .htaccess this change was made against. Anything else on the server and
 *  the file is left alone: overwriting an unknown copy is how 8 kB of
 *  unrelated change reaches a payment server by accident. */
$HTACCESS_MUST_BE = 'b2171fa61ccd4645f5b12428bb95e0d3332b6477182f6bbd6cee137bf79e20ab';

$FILES = [
    'assets/brand-logos.js' => '6f0452a90b229298b9a0607ca6186d951d2b93aa6e0d254650b2dd34a59f1c74',
    'index.html'            => '8c0142fa72cd1fa037343ca267c2a44be9fd1332ce7c80ca485e092d50828886',
    '.htaccess'             => 'de387e6ad761834edca1334da531d7fc22abbfc5830b7ffeaa32cd765cb49c59',
];

$wrote = 0; $same = 0; $bad = []; $failed = []; $refused = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    if ($rel === '.htaccess' && is_file($target)) {
        $now = hash_file('sha256', $target);
        if ($now !== $want && $now !== $HTACCESS_MUST_BE) {
            $refused[] = $rel;
            continue;
        }
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

    // A timestamped backup of .htaccess before it is replaced. It is the one
    // file here that can take the whole shop down if it is wrong, and a copy
    // beside it is the difference between a rename and a restore.
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

/* THE CHECK IS THE ONE THAT MATTERS: does the server now allow every inline
   script it serves? A byte count would not answer it, and neither would
   reading .htaccess — only comparing the policy it SENDS against the page it
   SENDS does. */
$ch = curl_init('https://127.0.0.1/');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$res  = (string) curl_exec($ch);
$hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$headers = substr($res, 0, $hlen);
$page    = substr($res, $hlen);
preg_match('/content-security-policy:([^\r\n]*)/i', $headers, $m);
preg_match_all("/'sha256-([A-Za-z0-9+\/=]+)'/", $m[1] ?? '', $mm);
$allowed = $mm[1] ?? [];
preg_match_all('/<script(?![^>]*\ssrc=)[^>]*>(.*?)<\/script>/s', $page, $sm);
$blocked = 0;
foreach ($sm[1] as $s) {
    if (!in_array(base64_encode(hash('sha256', $s, true)), $allowed, true)) $blocked++;
}

$ch = curl_init('https://127.0.0.1/assets/brand-logos.js');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
    CURLOPT_TIMEOUT        => 30,
]);
$js = (string) curl_exec($ch);
curl_close($ch);

echo 'BRANDLOGOS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' refused=' . (count($refused) ? implode(',', $refused) : '0')
   . ' inlineBlocked=' . $blocked
   . ' scriptTag=' . (strpos($page, '/assets/brand-logos.js') !== false ? 'ok' : 'MISSING')
   . ' jsBytes=' . strlen($js)
   . "\n";
