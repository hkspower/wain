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
 * NO exec()/shell_exec() HERE, ON PURPOSE. A first version of this script
 * ran `php -l` on the fetched body via exec() before writing, as an extra
 * safety net on the one file every admin and payment route runs through.
 * Live, it produced NO OUTPUT AT ALL — the empty-cron-output trap this
 * project's own notes already name a third way to be misread: not "healthy
 * and silent by design" (this script always echoes something) and not "has
 * not run within the panel's retention" (a per-minute job, checked minutes
 * later), but "ran and died before printing" — `exec` is routinely disabled
 * on shared hosting, and calling a disabled function is a fatal error with
 * nothing in the response to say so. Verified the live file was UNTOUCHED
 * by that failed attempt (the write happens after the lint, so a fatal
 * during it means nothing was ever written) before removing the step
 * rather than working around it. Local `php -l` plus the full test suite —
 * already run before every publish here — is the real safety net.
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
// smoke check that nothing on the shop broke; admin.php?r=me sits ABOVE the
// X-Sporta-Admin gate by design (it answers 200/null even with no session
// and no header — see live-admin-gate.php's own notes on this exact route)
// and answers 500 only on a genuine fatal, which is the one thing removing
// the exec()-based lint above gives up catching before the write rather
// than after it.
[$hc, $hBody] = $fetch('/');
[$ac] = $fetch('/api/admin.php?r=me');

echo 'KNETPAYSTATUS wrote=' . $wrote . ' same=' . $same
   . ' bad=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' | home=' . $hc . '/' . strlen($hBody)
   . ' admin_me=' . $ac
   . "\n";
