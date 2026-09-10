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
 *
 * ---------------------------------------------------------------------------
 * A THROTTLED PROBE CANNOT PROVE A GATE HOLDS, and the first version of this
 * file did not know that. It fired seventy-five requests in a tight loop, the
 * shop's rate limiter answered, and it reported `answering200=0` — which reads
 * as "every route is protected" and would have read exactly the same on a
 * server whose gate was wide open. Every request was simply refused before it
 * got there.
 *
 * So two things changed. Each route's refusal is CLASSIFIED rather than
 * counted: 401 and 403 are the gate, 400/404/405 are the route declining the
 * shape of the request, and 429 or 503 is the throttle — which is not an answer
 * at all. If any route comes back throttled the run says INCONCLUSIVE, because
 * a check that reads its own throttling as success is this project's favourite
 * way to be lied to. And the requests are paced, so it usually does not happen.
 *
 * The header check moved too. It used to ask `me`, which sits ABOVE the gate
 * and never required the header — the sandbox answers 200 with null and always
 * did. It asks a GUARDED route now, where store_require_admin_header() is
 * actually reached.
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

/** One unauthenticated GET. `$header` false omits X-Sporta-Admin. */
$ask = static function (string $route, bool $header = true): int {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=' . $route);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => $header
            ? ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1']
            : ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 20,
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
};

$open = [];        // answered 200 with no session — the fault this looks for
$refused = 0;      // 401/403: the gate
$declined = 0;     // 400/404/405: the route, not the gate
$throttled = [];   // 429/503: no answer at all
$other = [];

foreach ($guarded as $route) {
    $code = $ask($route);
    if ($code === 200)                        $open[] = $route;
    elseif ($code === 401 || $code === 403)   $refused++;
    elseif (in_array($code, [400, 404, 405], true)) $declined++;
    elseif ($code === 429 || $code === 503)   $throttled[] = $route;
    else                                      $other[] = $route . ':' . $code;
    // Paced. Seventy-five requests as fast as curl can make them is what
    // tripped the limiter and made the first run meaningless.
    usleep(120000);
}

// The second, independent guard, asked of a GUARDED route — the only place
// store_require_admin_header() is reached. Both answers are refusals and both
// are correct: 401 when the session check runs first, 400 when the header
// check does. What would be wrong is 200.
$noHeader = count($guarded) ? $ask($guarded[0], false) : 0;

echo 'GATE routes=' . count($seen)
   . ' public=' . count($public) . ':' . implode(',', $public)
   . ' guarded=' . count($guarded)
   . ' answering200=' . (count($open) ? 'OPEN:' . implode(',', $open) : '0')
   . ' gated=' . $refused . ' declined=' . $declined
   . ' throttled=' . (count($throttled) ? 'INCONCLUSIVE:' . count($throttled) : '0')
   . ' other=' . (count($other) ? implode(',', array_slice($other, 0, 4)) : '0')
   . ' withoutHeader=' . $noHeader . (in_array($noHeader, [400, 401], true) ? '-refused' : '-CHECK')
   . "\n";
