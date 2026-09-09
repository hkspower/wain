<?php
/**
 * One line of .htaccess: brand-logos.js joins the revalidate list.
 *
 *   php /home/<user>/publish-htaccess-cache.php
 *
 * WHY. assets/ has a rule that caches CONTENT-HASHED build output for a year,
 * and a named list of the hand-written files that must revalidate instead
 * because their names never change. brand-logos.js was published without being
 * added to that list, so it matched nothing and fell to heuristic caching —
 * roughly a tenth of the time since Last-Modified, which for a file published
 * today is hours and grows.
 *
 * Its stale-copy failure is the quiet kind. The upload card on the panel's
 * Brands screen keeps whatever behaviour the cached copy had, on the one person
 * who most needs the new one, and the server cannot see that it happened —
 * the same shape as track-guard.js, which is why the list carries a comment
 * saying "the price is remembering to add to it".
 *
 * `npm run test:htaccess` caught it, and caught it AFTER the publish. It checks
 * every un-hashed file in assets/ rather than the list, which is the only
 * reason forgetting is ever noticed.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - REFUSED unless the live copy is exactly the version this was made
 *     against, so an unknown .htaccess is never overwritten
 *   - a timestamped backup is kept beside it
 *   - pinned to one COMMIT, not a branch
 *
 * The check asks the SERVER what header it now sends for that file. Reading
 * .htaccess back would only prove the bytes arrived; LiteSpeed deciding to
 * apply the directive is a separate question, and this project has been bitten
 * by exactly that difference before.
 */

$COMMIT = '94fb9be';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$WANT   = 'f574b112851ddbf79bd1ce6a773d7304de37f8684047a19714efb9ddee8b1202';
$MUSTBE = 'de387e6ad761834edca1334da531d7fc22abbfc5830b7ffeaa32cd765cb49c59';

$target = $ROOT . '/.htaccess';
$state  = 'unknown';

$now = is_file($target) ? hash_file('sha256', $target) : '';
if ($now === $WANT) {
    $state = 'alreadyOk';
} elseif ($now !== $MUSTBE) {
    $state = 'REFUSED-unexpected-live-copy';
} else {
    $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
                  . '/sporta-site/public_html/.htaccess');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') {
        $state = 'fetch-failed';
    } elseif (hash('sha256', $body) !== $WANT) {
        $state = 'hashMismatch';
    } else {
        @copy($target, $ROOT . '/.htaccess.bak-' . date('Ymd-His'));
        $tmp = $ROOT . '/.pub-' . bin2hex(random_bytes(6));
        $ok  = @file_put_contents($tmp, $body) === strlen($body);
        if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
        @unlink($tmp);
        $state = ($ok && hash_file('sha256', $target) === $WANT) ? 'wrote' : 'write-failed';
        if ($state === 'wrote') @chmod($target, 0644);
    }
}

/** The header the server actually sends for a path. */
$head = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOBODY         => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $h = (string) curl_exec($ch);
    curl_close($ch);
    return preg_match('/cache-control:\s*([^\r\n]*)/i', $h, $m) ? trim($m[1]) : 'NONE';
};

echo 'HTCACHE ' . $state
   . ' brandLogos="' . $head('/assets/brand-logos.js') . '"'
   . ' footer="' . $head('/assets/footer.js') . '"'
   . "\n";
