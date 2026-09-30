<?php
/**
 * Publish the WhatsApp-validation fix in admin.php — held back on request.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-whatsapp-fix.php && php r.php
 *
 * WHAT THIS SHIPS. The contact-details card (assets/panel-settings.js,
 * already live) could save phone, email, address, hours and Instagram from
 * day one, but settings_save validated the shop's own WhatsApp number with
 * store_phone() — the CHECKOUT's validator, which requires a Kuwaiti MOBILE
 * (^[569]\d{7}$). STORE_SETTING_DEFAULTS ships 96522091914, a landline
 * starting 2, so the route refused the shop's own default: opening the
 * contact editor and pressing Save without touching anything failed with
 * invalid_whatsapp and no explanation on screen. This is the one file that
 * fixes it — admin.php alone, nothing else changed.
 *
 * NOTHING ELSE IN admin.php IS TOUCHED by this publish beyond that one
 * validation block; verified by sha256 before writing, same as every other
 * publisher here.
 *
 * $COMMIT pins the file; fetch this script from HEAD. Full forty characters,
 * per test:publish-pin.
 */

$COMMIT = '92f6ee60fe82e7f6da499ea35391de6a0e860bed';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php' => '41f0f7f75d5b72d9bb1d2db5b2ab67f505c8c054c7857102304a77c207fb2504',
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

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }
}

/* -------------------------------------------------------- verify, live --- */
$call = static function (string $route, ?array $body = null): array {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=' . $route);
    $h = ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1'];
    if ($body !== null) $h[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 25,
        CURLOPT_POST => $body !== null, CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($out, true)];
};

// THE SHOP STILL ANSWERS — the check that matters after touching the file
// every admin request loads. A fatal would be a 500 with an empty body.
[$ac, $aj] = $call('me');

// AND THE FIX ITSELF, without a session: settings_save is behind the gate, so
// this can only prove the route still exists and still gates correctly
// (401) — it CANNOT exercise the fixed validator itself without signing in,
// which this script deliberately does not do. That is verified instead by
// scripts/panel-settings-test.mjs against the sandbox, already green.
[$sc] = $call('settings_save', ['name' => 'contact', 'value' => ['whatsapp' => '96522091914']]);

echo 'WHATSAPPFIX wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | me=' . $ac . '/' . ($aj === null ? 'not-json' : 'ok')
   . ' settingsSaveGated=' . $sc
   . "\n";
