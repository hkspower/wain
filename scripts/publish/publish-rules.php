<?php
/**
 * Publish the shop-rules change — six files, one run.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-rules.php && php r.php
 *
 * WHAT IT CARRIES. Nine numbers that were PHP constants — delivery, the new
 * free-delivery threshold, the returns window, the cash-on-delivery limit, the
 * review reward, the discount cap, the governorates served, and which sizes and
 * fits are offered — become a `rules` settings row the owner edits in
 * /backends. See CLAUDE.md, "The shop's numbers are the owner's".
 *
 * NO DATABASE CHANGE. It writes into the `settings` table, which has existed
 * since the schema shipped, so nothing has to be imported and nothing migrates.
 * Until the owner saves once, there is no row at all and every read falls back
 * to the constants — so the shop's behaviour on the first request after this
 * publish is byte-for-byte what it was before. That is the property that makes
 * publishing the three core files survivable.
 *
 * WHY THESE SIX TOGETHER, and why they cannot be split:
 *
 *   store.php     store_rules(), store_delivery_fils(), store_rules_public(),
 *                 and the settings cache being dropped on save.
 *   api.php       the quote and the order both call store_delivery_fils(); the
 *                 governorate gate and the review reward read the rules; and
 *                 ?r=slides carries the public six.
 *   admin.php     ?r=rules to read all nine, and the settings_save branch that
 *                 validates and refuses.
 *   assets/rules.js  the card on the website panel's Settings screen.
 *   index.html    the one <script> tag that loads it.
 *   sw.js         a comment correction only, published so the live docroot goes
 *                 on matching the repository exactly — live-file-check reports
 *                 `differ` otherwise, and a checker that cries wolf is a checker
 *                 nobody reads.
 *
 * api.php calls functions that live in store.php, and admin.php calls both. A
 * partial publish is a fatal error on a live shop: api.php reaching for
 * store_delivery_fils() against an old store.php is `Call to undefined
 * function`, and that is the checkout. One run closes that window to the gap
 * between two renames.
 *
 * index.html WITHOUT rules.js is a 404 for a deferred script — harmless — and
 * rules.js without index.html is a file nobody fetches. Neither is dangerous,
 * which is why the ORDER below puts the three PHP files first: the window that
 * matters is theirs.
 *
 * THE CSP IS UNCHANGED and .htaccess is deliberately NOT in this list. The
 * change to index.html adds a <script src> and edits no inline script, so every
 * sha256 the policy names still matches. npm run test:csp says so, and the
 * check at the end asks the SERVER the same question rather than trusting it.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - six paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in it,
 *     which makes a raw.githubusercontent ref ambiguous — it returns an EMPTY
 *     file and says nothing)
 *   - temp file + rename; deletes nothing
 *   - fetched ONE AT A TIME, because three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *   - IDEMPOTENT: a file already matching its hash is skipped, so re-running
 *     costs nothing and a half-finished run completes on the next one
 */

$COMMIT = 'b4bc82a';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/* The three PHP files first, and store.php before the two that call into it. */
$FILES = [
    'api/store.php'   => 'f7c945e30b2c4d8ccec5f76b19276faddc80754c68934e467c69c328a9b2f439',
    'api/api.php'     => '0d1d2431492a7f5d519e5f698e5263bb8f9eb4295018f56f4536a979d7a283f3',
    'api/admin.php'   => '1e0fbaa6e0b767f1e2f003746e2f0e9a52cb4f67d1249ef9fc222caeed9af65a',
    'assets/rules.js' => 'fa86168f7f56278bb8f2dfc5fc3f447907e89c39940ab2f7932a8a1455c35d31',
    'index.html'      => '5fb809488930b331507178487d0882db153e3a7e5f07b0328f500dc5ce8025b1',
    'sw.js'           => 'ec1ad9209bc87652db350ac3d4d07459289cbe5204cdad941eec2b1454fd5931',
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

/** What the live server serves for a path. The public name is used only as a
 *  Host header — see CLAUDE.md on why this form works whether or not the domain
 *  resolves, and note it bypasses the CDN, which is what we want here. */
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

/* THE QUESTION THIS PUBLISH IS FOR: does the shop now tell a page what its own
   rules are, and are the three internal limits still absent from a PUBLIC
   endpoint? A feature that shipped its own leak would be worse than not
   shipping. */
$j    = json_decode($slides, true);
$r    = is_array($j) && isset($j['rules']) && is_array($j['rules']) ? $j['rules'] : null;
$pub  = $r === null ? 'MISSING'
      : (isset($r['delivery_fee_fils'], $r['return_days'], $r['governorates'], $r['sizes'], $r['fits'])
         ? 'ok:' . count($r) : 'INCOMPLETE:' . implode(',', array_keys($r)));
$leak = $r === null ? 'unknown'
      : (isset($r['cod_open_max']) || isset($r['discount_max_pct']) || isset($r['review_reward_pct'])
         ? 'LEAKED' : 'none');

/* The CSP still names every inline script the served page carries. index.html
   changed, so this is asked of the SERVER rather than assumed — reading
   .htaccess would only say what the repository thinks. */
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

echo 'RULES wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $homeCode . '/' . strlen($html)
   . ' api=' . $prodCode . '/' . strlen($products)
   . ' slides=' . $slidesCode
   . ' publicRules=' . $pub
   . ' internalLimits=' . $leak
   . ' cardTag=' . (strpos($html, '/assets/rules.js') !== false ? 'ok' : 'MISSING')
   . ' card=' . $serve('/assets/rules.js')[2]
   . ' BLOCKED=' . $blocked
   . "\n";
