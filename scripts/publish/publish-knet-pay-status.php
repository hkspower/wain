<?php
/**
 * Publish the CBK gateway status added to admin.php's `?r=knet` route —
 * "make knet ingrration setup and backends", 2026-09-17.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-knet-pay-status.php && php r.php
 *
 * WHAT THIS SHIPS. One file: api/admin.php. `?r=knet` GET now also reads
 * pay/config.php — never fatal if it is missing or unreadable — and reports
 * whether the three CBK credentials (client_id, client_secret, encrp_key)
 * are still placeholders, plus the environment. Booleans only, never the
 * credential values. The Tranportal ID half of the route (tranportal_id,
 * source) is unchanged.
 *
 * WHY THIS MATTERS ENOUGH TO PUBLISH CAREFULLY. This route sits behind
 * payments — the same file `pay.php` and `cbk.php` are read alongside — and
 * CLAUDE.md records this project's own history of pay/config.php shipping
 * with every credential present and none of them real. The change here is
 * READ-ONLY (a GET route reading a file it was not reading before) and
 * touches no write path, but it is still admin.php, so the publisher
 * verifies every write against a recorded sha256 before and after, the same
 * as every other file this project publishes.
 *
 * Verified locally: test:admin-contract, test:admin-live and
 * test:admin-browser — the last two against the real admin.php + MariaDB
 * and a real browser — all green, including a mutation test that flips
 * pay/config.php to look real and back, confirming the new field is read
 * live rather than cached.
 *
 * $COMMIT pins the ARTIFACT; fetch this script from HEAD, per the standing
 * rule that a publisher's own pin does not decide where it is fetched from.
 * Full forty characters, per test:publish-pin.
 */

$COMMIT = '424b0c40a3bbcfec2083a04f2a330f1b966894f3';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'api/admin.php' => 'e58d0438f17672eb3275a32df494d14ea00d6520a56f02ea69b3ea3815528d33',
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

    // php -l on the fetched body BEFORE it ever touches the live file — this
    // is api/admin.php, the file every payment and admin route runs through,
    // and a syntax error here would take the whole panel and every payment
    // route down at once. Written to a throwaway path only for the lint.
    $lintTmp = sys_get_temp_dir() . '/.lint-' . bin2hex(random_bytes(6)) . '.php';
    file_put_contents($lintTmp, $body);
    exec('php -l ' . escapeshellarg($lintTmp) . ' 2>&1', $lintOut, $lintCode);
    @unlink($lintTmp);
    if ($lintCode !== 0) { $failed[] = $rel . '/php-lint:' . implode(' ', $lintOut); break; }

    $tmp = dirname($target) . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else { $failed[] = $rel . '/write'; break; }
}

/* -------------------------------------------------------- verify, live --- */
$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $out];
};

// Confirm the route STILL WORKS after the write. `/` is the storefront's own
// smoke check that nothing on the shop broke; admin.php?r=me with no
// X-Sporta-Admin header answers 400 by design (store_require_admin_header()
// runs before anything else) — a 500 here instead would mean the new code
// path fataled at runtime despite passing php -l above.
[$hc, $hBody] = $fetch('/');
[$ac] = $fetch('/api/admin.php?r=me');

echo 'KNETPAYSTATUS wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($hBody)
   . ' admin_me=' . $ac
   . "\n";
