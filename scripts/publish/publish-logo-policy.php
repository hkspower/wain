<?php
/**
 * Publish the brand-logo extension fix, the returns-policy repair, the promo
 * bar's balanced wrap and the panel warnings — five files, one run.
 *
 * WHY ONE SCRIPT, AND WHY THIS ORDER. Two of the five are COUPLED and the
 * coupling is fatal, not cosmetic: api.php calls store_brand_logo_mime(), and
 * that function lives in store.php. Published the wrong way round there is a
 * window in which every request to the API is a fatal "undefined function" —
 * the whole shop, not one feature. store.php FIRST is safe in both directions:
 * the new function simply sits there unused until api.php arrives.
 *
 * This is the same hazard CLAUDE.md records for index.html and .htaccess, where
 * the CSP names the inline scripts by hash. A file that CALLS and a file that
 * DEFINES are one change.
 *
 * sw.js LAST, for the reason publish-grid.php gives: in the window between the
 * writes, a visitor who activates the new worker before the assets land drops
 * their caches and re-fetches the OLD file — freeing the pin and re-pinning to
 * the same bytes. Assets first makes that window harmless.
 *
 * WHAT IS IN IT
 *
 *   api/store.php + api/api.php
 *     - images/<slug>/logo.* matched exactly three names with is_file(), and
 *       Linux is case-sensitive: logo.jpeg, logo.PNG and logo.JPG were
 *       invisible. This is the owner's only upload route that needs no panel.
 *     - the Content-Type now comes from the file's own first bytes. The route
 *       sends nosniff, so a type that does not match the bytes means the
 *       browser REFUSES to draw the logo.
 *     - ?r=products labelled products from the frozen products.no_exchange
 *       column while the returns route decided with category === 'women'. Ten
 *       outerwear garments disagreed: told non-exchangeable, exchanged anyway.
 *
 *   assets/sporta-ui.css   the promo bar's two lines are balanced rather than
 *                          318px + a 62px orphan on every common phone.
 *   assets/rules.js        warns, where the owner is standing, that the returns
 *                          window and the governorate list are stated in fixed
 *                          text the storefront bundle cannot follow.
 *   sw.js                  sporta-ui.css and rules.js are fixed-name assets.
 *
 * Every file is verified against a recorded sha256 BEFORE it is written, so a
 * wrong commit, an empty fetch or a tampered body writes nothing at all —
 * the guard that has repeatedly caught ordinary mistakes here.
 *
 * $COMMIT PINS THE FILES, NOT THIS SCRIPT. Fetch the script from HEAD.
 * The FULL forty characters: an abbreviated sha 404s on raw.githubusercontent,
 * measured 2026-09-11, and an unresolvable ref is an empty fetch.
 */

$COMMIT = '1f55f5a00d657df0f23647cf0b0e40650ea4a5f6';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// ORDER IS LOAD-BEARING. store.php defines, api.php calls; assets before sw.js.
$FILES = [
    'api/store.php'        => '96b4f976c31d9577747076fb1fd85e1283e6c78cbda0fefa94ce1f6079377860',
    'api/api.php'          => '2058f295b2cabf7dd071922cdb8915658033bd661a58706b8b08099be334ed6b',
    'assets/sporta-ui.css' => 'cbfcd021edf9d22e62d25b97aede98bd36ffc6b2c4f8090baacb393aa75e257b',
    'assets/rules.js'      => '5c1af19d34b7642e10a54865fdbd3d7017c64d29c14ac879e6d3c707c9fd0e51',
    'sw.js'                => '40825bb51e876d46e6d7ff1285d0bfe2719452c9a15712dfb4c2016e6c98b1e9',
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

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    // Written to a scratch name and renamed, so a reader never sees half a
    // file — and on PHP source that half would be a parse error served to
    // every visitor.
    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel . '/write';

    // A COUPLED PAIR MUST NOT BE LEFT HALF-PUBLISHED. If store.php did not
    // land, api.php must not be written over a server whose store.php lacks
    // the function it is about to call.
    if ($rel === 'api/store.php' && ($failed || $bad)) break;
}

/* ------------------------------------------------------- and ask the server */
$get = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $body];
};

// THE API STILL ANSWERS. This is the check that matters after touching two PHP
// files that every request loads: a fatal would be a 500 with an empty body,
// and it would be the whole shop.
[$pc, $pb] = $get('/api/api.php?r=products');
$rows = json_decode($pb, true);
$rows = is_array($rows) ? ($rows['products'] ?? $rows) : [];

// And the policy the listing now states must be the one the returns route
// enforces — the bug this publishes the fix for, asked of the live catalogue
// rather than assumed from the bytes.
$mismatch = 0; $n = 0;
foreach ($rows as $p) {
    if (!is_array($p) || !isset($p['category'])) continue;
    $n++;
    if ((bool)($p['no_exchange'] ?? false) !== (($p['category'] ?? '') === 'women')) $mismatch++;
}

echo 'PUBLISH wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | api=' . $pc . '/' . strlen($pb) . ' products=' . $n
   . ' labelMismatch=' . $mismatch . "\n";
