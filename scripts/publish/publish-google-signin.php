<?php
/**
 * Publish Google sign-in for /backends — five files, one run.
 *
 * ORDER IS LOAD-BEARING and two of the pairs are coupled the wrong way round if
 * reversed:
 *
 *   1. assets/google-signin.js  before  index.html, because index.html is what
 *      references it. The other order gives every visitor a shell asking for a
 *      script that is not there yet — the exact failure a manifest guard was
 *      added for after it happened once.
 *   2. api/store.php  before  api/admin.php, because store.php DEFINES
 *      store_google_login() and admin.php CALLS it. Reversed, every request to
 *      the admin API is an undefined-function fatal — the whole panel, not one
 *      feature.
 *   3. .htaccess last of the config, because it only WIDENS what is allowed.
 *      Arriving early it permits a script nobody loads yet; arriving late the
 *      button is blocked for a few seconds. Neither breaks anything, and that
 *      is why it is the one with slack.
 *
 * THE FEATURE IS INERT ON ARRIVAL. `google_auth` defaults to an empty client id
 * with enabled false, store_google_login() fails closed on that, and the
 * overlay draws no button and loads nothing third-party. Nothing changes for a
 * shopper or for the owner until a client id is pasted into the new setup card.
 *
 * WHAT DOES CHANGE IMMEDIATELY is the CSP on /backends: accounts.google.com
 * gains script-src, frame-src and connect-src THERE AND NOWHERE ELSE. The
 * storefront policy is untouched, and this script proves that on the live
 * server rather than trusting the Apache rig — the two are not the same server,
 * and a scoped header is exactly the kind of thing LiteSpeed can differ on.
 *
 * $COMMIT pins the files; fetch this script from HEAD. Full forty characters.
 */

$COMMIT = '58f5672d2ea8cd48c174f4f6fd2b431818cca92a';
$ROOT   = '/home/u130124229/domains/sporta.com.kw';
$WEB    = $ROOT . '/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/google-signin.js' => '49eff5cdc6787576e4cb28e3fb67de505ab9c167f920d0d507f498643522eba1',
    'api/store.php'           => '647c7496a08f7fcc88dce7525900afe39938ba7358d8963936e100a47110bb5a',
    'api/admin.php'           => '69272f22147e8fe509e822181e31b1cee8f26b0d900889bf0054bcd7475b097f',
    'index.html'              => '582f1c4049051d65135deebf733b4b02cfb6455d334a7073c46ca44330338fb4',
    '.htaccess'               => '7c073577e89558f769862649394f7b749ec266534da6138ddba66123ee90c6e4',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $WEB . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; break; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; break; }

    // Keep the old .htaccess: it carries the CSP, and a bad one is the whole
    // shop rather than one feature. Outside public_html, so nothing serves it.
    if ($rel === '.htaccess' && is_file($target)) {
        @copy($target, $ROOT . '/storage/htaccess.before-' . gmdate('Ymd-His'));
    }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }   // stop: the order is the safety
}

/* --------------------------------------------------- and ask the live server */
$head = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
                            CURLOPT_NOBODY => false,
                            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                            CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25]);
    $out = (string) curl_exec($ch);
    $sz  = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $rc  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$rc, substr($out, 0, $sz), strlen(substr($out, $sz))];
};
$csp = static function (string $h): string {
    return trim(preg_match('/^content-security-policy:\s*(.*)$/im', $h, $m) ? $m[1] : '');
};

// THE API STILL ANSWERS — the check that matters after touching two PHP files
// every admin request loads. A fatal would be a 500 with an empty body.
[$ac, , $alen] = $head('/api/api.php?r=products');

// THE SCOPING, on the real server. LiteSpeed is not the Apache the rig runs,
// and this header is set from a rewrite-set env var — precisely the kind of
// construct the two can disagree about.
[, $shopH, ] = $head('/');
[, $panelH, ] = $head('/backends');
$shop = $csp($shopH);
$panel = $csp($panelH);

$g = 'https://accounts.google.com';
$panelHas = 0;
foreach (['script-src', 'connect-src', 'frame-src'] as $d) {
    if (preg_match('/(?:^|;)\s*' . $d . '\s+([^;]*)/i', $panel, $m)
        && str_contains($m[1], $g)) $panelHas++;
}

// And the new routes answer. google_config is above the gate and must answer
// without a session; it is also the one that tells the panel whether to draw a
// button at all, so a 404 here is a feature that silently never appears.
$ch = curl_init('https://127.0.0.1/api/admin.php?r=google_config');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false,
                        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_TIMEOUT => 25,
                        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1']]);
$cfgBody = (string) curl_exec($ch);
$cfgCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$cfg = json_decode($cfgBody, true);

echo 'GSI wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | api=' . $ac . '/' . $alen
   . ' cspPanel=' . $panelHas . '/3'
   . ' cspShopClean=' . (str_contains($shop, $g) ? 'NO' : 'yes')
   . ' config=' . $cfgCode . '/' . (is_array($cfg)
        ? ('enabled=' . (!empty($cfg['enabled']) ? 1 : 0)) : 'NOT-JSON')
   . "\n";
