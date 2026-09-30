<?php
/**
 * Publish the website panel's session-lock fix and its tab-bar re-centring —
 * three files, one run.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-panel-nav-speed.php && php r.php
 *
 * WHAT IT CARRIES. Two independent fixes for the website's own /backends
 * panel, described at length in the commit that made them — "Website
 * /backends: release the session lock, and centre the active tab":
 *
 *   api/admin.php                    session_write_close() right after the
 *                                     auth check, for every route but
 *                                     account_update — releases the PHP
 *                                     session's exclusive file lock so the
 *                                     Catalogue screen's ~46 concurrent
 *                                     product_images requests can actually
 *                                     run concurrently on the live server's
 *                                     multi-worker PHP, instead of queuing
 *                                     up behind each other's entire
 *                                     execution the way a single lock forces.
 *   assets/panel-tabbar-autocenter.js  new file: re-centres the mobile tab
 *                                     bar's active tab on mount and on every
 *                                     tap, so a tab found by scrolling does
 *                                     not have to be found again from
 *                                     scratch next time.
 *   index.html                       the one new <script> tag that loads it.
 *
 * NO SCHEMA CHANGE, no new settings row — admin.php's change is a single
 * `session_write_close()` call reached by every route already in production
 * use; the new asset is additive and does nothing outside /backends.
 *
 * ORDER: admin.php first, since it is the file whose correctness matters —
 * a half-written PHP file is a fatal error on every admin request, where a
 * missing/half-loaded <script> is at worst inert. The two static files after
 * it, index.html last since it is what makes the new one load at all.
 *
 * THE CSP IS UNCHANGED. index.html only gains a <script src>, and edits no
 * inline script — every sha256 the policy names still matches. Asked of the
 * SERVER at the end, not assumed.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - three paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in
 *     it, which makes a raw.githubusercontent ref ambiguous — it returns an
 *     EMPTY file and says nothing)
 *   - temp file + rename; deletes nothing
 *   - fetched ONE AT A TIME — three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *   - IDEMPOTENT: a file already matching its hash is skipped, so re-running
 *     costs nothing and a half-finished run completes on the next one
 */

$COMMIT = '7dae809aefff5f34e29877faafed7574ce19754a';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php'                          => '362a4b36fbc359009e929966ae821a6861f9b7062d0ce8fd05f80b26bba27610',
    'assets/panel-tabbar-autocenter.js'       => '9820eae1f3bce01ad6e13e21d583202f47bf9b4146a140a1a874b978d24eaaf9',
    'index.html'                              => '5f1856a52348b07dfeddc0d4944a57e1f235028866583497653022062d6f45da',
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
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path — over the loopback, by Host
 *  header, which works whether or not the domain resolves and bypasses the
 *  CDN, which is what we want here. */
$serve = static function (string $path, array $extra = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $extra),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size), $code];
};

[$headHtml, $html, $homeCode] = $serve('/');
[, $slides, $slidesCode]      = $serve('/api/api.php?r=slides');
[, $products, $prodCode]      = $serve('/api/api.php?r=products');

/* admin.php's edit is behind a login and cannot be exercised anonymously
   here; what CAN be checked without one is that the storefront routes are
   still exactly as healthy as before the write. */
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

echo 'PANELNAV wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $homeCode . '/' . strlen($html)
   . ' api=' . $prodCode . '/' . strlen($products)
   . ' slides=' . $slidesCode
   . ' cardTag=' . (strpos($html, '/assets/panel-tabbar-autocenter.js') !== false ? 'ok' : 'MISSING')
   . ' card=' . $serve('/assets/panel-tabbar-autocenter.js')[2]
   . ' BLOCKED=' . $blocked
   . "\n";
