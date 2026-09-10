<?php
/**
 * Is the panel's gate actually holding on the LIVE server?
 *
 *   php /home/<user>/live-admin-gate.php
 *
 * READ-ONLY. Every request it makes is a GET with no session, which is the
 * definition of what must be refused — it cannot change anything even if a gate
 * were missing, and it prints no value from any response.
 *
 * WHY IT EXISTS. scripts/admin-permission-test.mjs proves this against the
 * SANDBOX, and that is the right place for it: it can sign in, mutate, and
 * check the two-axis status model. What it cannot do is tell you whether the
 * file on the live server is the file it tested. `live-file-check` answers that
 * by sha256 — but a matching file served through a different PHP version, a
 * different .htaccess, or an opcache holding yesterday's copy is still a
 * different server. This asks the live one the only question that matters:
 *
 *   with no session, does anything behind the gate answer 200?
 *
 * The route list is read from the LIVE admin.php, not from a list typed here.
 * A list typed here would go stale the first time a route was added, and the
 * new one — the one nobody had checked — would be the one it missed.
 */

$ROOT  = '/home/u130124229/domains/sporta.com.kw/public_html';
$ADMIN = $ROOT . '/api/admin.php';

$src = @file_get_contents($ADMIN);
if ($src === false) { echo "GATE failed=no-admin-php\n"; exit; }

// Where the gate is, and therefore which routes are in front of it.
$gateAt = strpos($src, 'store_require_admin(');
if ($gateAt === false) { echo "GATE failed=no-gate-call\n"; exit; }

preg_match_all('/\$r === \'([a-z_]+)\'/', $src, $m, PREG_OFFSET_CAPTURE);
$seen = [];
$guarded = [];
$public  = [];
foreach ($m[1] as $hit) {
    $name = $hit[0];
    if (isset($seen[$name])) continue;
    $seen[$name] = true;
    if ($hit[1] < $gateAt) $public[] = $name; else $guarded[] = $name;
}

/** One unauthenticated GET, with the header the panel sends. */
$ask = static function (string $route): int {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=' . $route);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1'],
        CURLOPT_TIMEOUT        => 20,
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
};

$open = [];
foreach ($guarded as $route) {
    if ($ask($route) === 200) $open[] = $route;
}

// And the header the gate also requires: without it store_require_admin_header()
// answers 400, which is a second, independent thing that can rot.
$ch = curl_init('https://127.0.0.1/api/admin.php?r=me');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],   // no X-Sporta-Admin
    CURLOPT_TIMEOUT        => 20,
]);
curl_exec($ch);
$noHeader = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo 'GATE routes=' . count($seen)
   . ' public=' . count($public) . ':' . implode(',', $public)
   . ' guarded=' . count($guarded)
   . ' answering200=' . (count($open) ? implode(',', $open) : '0')
   . ' withoutHeader=' . $noHeader . ($noHeader === 400 ? '-refused' : '-CHECK')
   . "\n";
