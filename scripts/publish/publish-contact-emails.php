<?php
/**
 * Publish two stacked, unpublished changes in one run: the raised product
 * photo cap, and the four admin-only email fields.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-contact-emails.php && php r.php
 *
 * WHAT IT CARRIES, and why both go together rather than each getting its own
 * publish: api/store.php has moved twice since the live server last saw it —
 * once raising STORE_PRODUCT_IMAGE_MAX 900000 -> 1100000, once adding the
 * `contact_emails` settings default — and there is only ONE store.php on the
 * server. Splitting this into two publishes would mean the second one still
 * has to carry every earlier change anyway, since each publish always ships
 * the file as it stands at ITS commit, not a diff.
 *
 *   api/store.php         STORE_PRODUCT_IMAGE_MAX raised; STORE_SETTING_DEFAULTS
 *                          gains contact_emails (all empty, so a shop that
 *                          never opens the new card is unaffected).
 *   api/admin.php          GET ?r=contact_emails, and a settings_save branch
 *                          for it.
 *   assets/admin-upload.js MAX_BASE64 raised to match store.php exactly — a
 *                          browser re-encoding under the OLD cap while the
 *                          server accepts a bigger one costs nothing, but
 *                          leaving it behind would silently under-use the
 *                          raise.
 *   assets/contact-emails.js  the new card on the website panel's Settings
 *                          screen: alternative, orders, B2B and customers
 *                          email. Admin-only — nothing here reaches the
 *                          storefront.
 *   index.html             the one new <script> tag that loads it.
 *   sw.js                  VERSION bump, ALREADY covers this: a brand-new
 *                          fixed-name asset (contact-emails.js) needs no
 *                          bump on its own, but admin-upload.js is a MODIFIED
 *                          existing one and does. Published so the live
 *                          docroot matches the repository exactly.
 *
 * NO SCHEMA CHANGE. contact_emails writes into the `settings` table, which
 * already exists. Until the owner saves once there is no row, and every read
 * falls back to STORE_SETTING_DEFAULTS's all-empty default — so the shop's
 * behaviour on the first request after this publish is unchanged for anyone
 * who has not opened the new card.
 *
 * ORDER: the three PHP-adjacent/JS files that admin.php's route depends on
 * having a place to run (store.php, admin.php) go first, then the two static
 * assets, then index.html which references them, then sw.js last — matching
 * publish-rules.php's own reasoning: a script without its index.html tag is
 * inert, and an index.html tag without the script is a 404 for a deferred
 * script. Neither half alone is dangerous; the PHP files are what could 500
 * a live request if half-written, so they go first.
 *
 * THE CSP IS UNCHANGED. index.html only gains a <script src>, and edits no
 * inline script — every sha256 the policy names still matches. Asked of the
 * SERVER at the end, not assumed.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - six paths, named below, nothing derived from input
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

$COMMIT = 'a1418e991feabe83137421faaafa2cdbb782aeb4';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/store.php'               => '8d5222eea02da0a1a04df42ee6796d8f0d1420a7c056cc7c1dfb83e9a3acdcdb',
    'api/admin.php'                => '14bb8c0d6464b35667c5ae2fe48d6b6bf8e576b8b1b3540a37e45966f911456b',
    'assets/admin-upload.js'       => 'e3a341cf26333e8768d42fcfceddf26f466b34468965c599d753aeb01bc0b0f8',
    'assets/contact-emails.js'     => '7fde704b6141b250eebe18731e67b71078ea27e5f464341cb8341e89732ef673',
    'index.html'                   => '947a9520f1af77f4c87121ec840eb023f451038a2a3dc8d129f4754ce0e18a0c',
    'sw.js'                        => 'ba6921ca6de96b3b2968bb9e50a30545b1c2b4f82efddb7ec7f1bf8129108ff8',
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

/* THE QUESTION THIS PUBLISH IS FOR, in two parts: does the new admin-only
   route exist and answer with the four empty fields it should on a shop that
   has never saved one, and — the leak check — is it ABSENT from the public
   ?r=slides the way knet's credentials are? Answering it needs a session, so
   this is the one thing an unauthenticated publish cannot verify directly;
   it checks what it can without a login and leaves the rest to admin-live's
   own kind of check, run separately against production if ever needed. */
$j = json_decode($slides, true);
$leak = is_array($j) && (isset($j['alternative']) || isset($j['orders']) || isset($j['b2b']) || isset($j['customers']))
      ? 'LEAKED' : 'none';

/* The CSP still names every inline script the served page carries. */
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

echo 'EMAILS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $homeCode . '/' . strlen($html)
   . ' api=' . $prodCode . '/' . strlen($products)
   . ' slides=' . $slidesCode
   . ' publicLeak=' . $leak
   . ' cardTag=' . (strpos($html, '/assets/contact-emails.js') !== false ? 'ok' : 'MISSING')
   . ' card=' . $serve('/assets/contact-emails.js')[2]
   . ' uploadCard=' . $serve('/assets/admin-upload.js')[2]
   . ' BLOCKED=' . $blocked
   . "\n";
