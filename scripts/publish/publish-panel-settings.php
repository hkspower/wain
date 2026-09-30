<?php
/**
 * Publish the website panel's contact-details card — three files, one run.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-panel-settings.php && php r.php
 *
 * WHAT THIS SHIPS. assets/panel-settings.js adds a Contact details card to the
 * website's /backends Settings screen — the only panel that had none, while the
 * app's Settings screen has had one all along — and repairs two paragraphs on
 * that screen that name files this server deliberately does not have
 * (api/setup-admin.php and a File-Manager upload path for product photos,
 * which are actually in MySQL).
 *
 * DELIBERATELY NOT IN THIS RUN: api/admin.php's WhatsApp-validation fix. The
 * card still works for phone, email, address, hours and Instagram; saving a
 * WhatsApp number that is a Kuwaiti MOBILE (^[569]\d{7}$) still works too —
 * only the shop's own landline default (96522091914) will still be refused by
 * settings_save until that file is published separately. Held back on request.
 *
 * ORDER IS LOAD-BEARING, same reasoning as publish-google-signin.php:
 *
 *   1. assets/panel-settings.js  before  index.html, because index.html is
 *      what references it. The other order gives every panel visitor a shell
 *      asking for a script that is not there yet.
 *   2. .htaccess last of the two config files — it only WIDENS the no-cache
 *      list, so arriving early costs nothing and arriving late costs a few
 *      seconds of heuristic caching on a brand-new, previously-nonexistent
 *      file. Neither breaks anything, which is why it goes last.
 *
 * THE CARD DOES NOTHING UNTIL THE OWNER OPENS SETTINGS. It reads the shop's
 * current contact details from api.php?r=contact (a route that already
 * existed) and writes through admin.php?r=settings_save (a route that already
 * existed, unmodified by this run) — so nothing here needs the server to change
 * shape at all. It is inert for shoppers: the overlay checks the URL is
 * /backends before doing anything, and it is excluded from the storefront's
 * CSP scoping already covering that path.
 *
 * $COMMIT pins the files; fetch this script from HEAD. Full forty characters,
 * per test:publish-pin — an abbreviated sha here is a 404 that reports nothing.
 */

$COMMIT = '92f6ee60fe82e7f6da499ea35391de6a0e860bed';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/panel-settings.js' => '0eaa32a8b7972c05e6d3c0dad6cc89a5f0b6eb04ff391d199d5fe9d8efd0ebf2',
    'index.html'               => 'a6e79bd2960b3a45b5f63ef74c40530ccb639adfd309acab453c1fc5882f33dc',
    '.htaccess'                => '8396f0177863e044a8097cab9862c87ff8d415e7ea4e05be2e2cf20e7fd8c22a',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                            CURLOPT_TIMEOUT => 60]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $code !== 200 || $body === '') { $failed[] = $rel . '/http' . $code; break; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; break; }

    // Keep the old .htaccess as a timestamped backup outside public_html — a
    // bad one is the whole shop rather than one feature.
    if ($rel === '.htaccess' && is_file($target)) {
        @mkdir(dirname($ROOT) . '/storage', 0700, true);
        @copy($target, dirname($ROOT) . '/storage/htaccess.before-' . gmdate('Ymd-His'));
    }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }   // stop: the order is the safety
}

/* --------------------------------------------------- and ask the live server */
$head = static function (string $path, array $extraHeaders = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
                            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                            CURLOPT_HTTPHEADER => array_merge(['Host: www.sporta.com.kw'], $extraHeaders),
                            CURLOPT_TIMEOUT => 25]);
    $out = (string) curl_exec($ch);
    $sz  = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $rc  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$rc, substr($out, 0, $sz), strlen(substr($out, $sz))];
};

// THE SHOP STILL ANSWERS — the check that matters after touching index.html and
// .htaccess, which every single page load reads.
[$hc, , $hlen] = $head('/');
[$ac, , $alen] = $head('/api/api.php?r=products');

// THE PANEL STILL LOADS, and the new asset is reachable and un-cached.
[$panelCode] = $head('/backends');
[$jsCode, $jsHead] = $head('/assets/panel-settings.js');
$jsNoCache = stripos($jsHead, 'no-cache') !== false;

// AND CONTACT STILL ANSWERS — the route the new card reads on every open, and
// the one thing that must not have moved.
[$cc, , $clen] = $head('/api/api.php?r=contact');

echo 'PANELSETTINGS wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . $hlen
   . ' api=' . $ac . '/' . $alen
   . ' panel=' . $panelCode
   . ' js=' . $jsCode . '/' . ($jsNoCache ? 'no-cache' : 'CACHEABLE')
   . ' contact=' . $cc . '/' . $clen
   . "\n";
