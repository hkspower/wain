<?php
/**
 * Can the owner still sign in, and is the way in still shut to everyone else?
 * READ-ONLY, and it PRINTS NO SECRET.
 *
 * WHY, TODAY. store.php and admin.php were both republished — the two files
 * every admin request loads — and a fatal in either is the whole panel rather
 * than one feature. "The shop still answers" is not that check: the storefront
 * and the panel are different code paths and the API answering products proves
 * nothing about login.
 *
 * IT CANNOT ACTUALLY SIGN IN, and says so rather than implying otherwise: that
 * needs the owner's password, which is not something to put in a public
 * repository or a cron command. What it can prove is the SHAPE of every answer
 * around sign-in, and every one of these has a specific way of being wrong that
 * looks like nothing from outside:
 *
 *   - a 500 anywhere is the fatal this exists to catch;
 *   - a 200 on a data route WITHOUT a session is the gate gone;
 *   - bad credentials answering anything but 401 means the login path broke;
 *   - a MISSING route answers 400/404 and reads exactly like a refusal.
 *
 * THE THROTTLE IS THE REASON THIS IS PACED AND CLASSIFIED. `admin` is limited
 * to 60 requests in 20 minutes per IP, and a run that reads its own throttling
 * as "everything is refused, the gate holds" would report success on a server
 * whose gate was wide open — this project's favourite way to be lied to, and
 * already recorded twice. An UNNAMED 429 or 503 is counted as THROTTLED, never
 * as a refusal, and the run says INCONCLUSIVE when it meets one.
 *
 * UNNAMED is the word that had to be added. Counting every 503 as the limiter
 * swept up `google_login`'s own 503 google_not_configured — the correct answer
 * on a shop that has not pasted a client id, which is this shop on purpose — so
 * every run ended INCONCLUSIVE while every check inside it had passed. A verdict
 * that is always inconclusive is a verdict nobody reads, and it would have hidden
 * a real throttled run the day one happened. The limiter refuses without naming
 * an application error; a feature refusing itself says which feature.
 */

$bits = [];
$throttled = 0;

$call = static function (string $route, ?array $body = null, bool $header = true) use (&$throttled): array {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=' . $route);
    $h = ['Host: www.sporta.com.kw'];
    if ($header) $h[] = 'X-Sporta-Admin: 1';
    if ($body !== null) $h[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 25,
        CURLOPT_POST => $body !== null,
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // PARSE FIRST, then decide what the status means.
    //
    // json_decode() returns null for the body `null` AND for a body it could
    // not read, and this checker reported both as `not-json`. `me` answers 200
    // with literally `null` to a signed-out browser — by design, documented,
    // identical on the sandbox — so the one route whose whole job is to say
    // "nobody is signed in" read as a broken response on every run.
    $j    = json_decode($out, true);
    $isJson = json_last_error() === JSON_ERROR_NONE;

    // AND A 503 IS NOT AUTOMATICALLY THE LIMITER. `google_login` answers
    // 503 google_not_configured on a shop that has not pasted a client id —
    // which is this shop, deliberately — and counting that as rate limiting
    // made every run say INCONCLUSIVE while every check in it had in fact
    // succeeded. A verdict that is always inconclusive is a verdict nobody
    // reads. The limiter does not name an application error; the feature does.
    $named = $isJson && is_array($j) && isset($j['error']) ? (string) $j['error'] : '';
    $limiterish = $named === '' || $named === 'rate_limited' || $named === 'too_many';
    if (($code === 429 || $code === 503) && $limiterish) $throttled++;

    return [$code, $isJson ? $j : 'BAD-JSON', strlen($out)];
};

// Paced: the limiter counts every one of these, and a burst turns the whole run
// into a measurement of the limiter.
$pause = static function (): void { usleep(400000); };

/* -------------------------------------------------- 1. the session question */
// `me` sits ABOVE the gate and answers 200 with null for a signed-out browser.
// That is not a bug and has been confirmed identical on the sandbox — it is the
// route the panel asks "am I signed in?", and it must keep answering.
[$c, $j] = $call('me');
$bits[] = 'me=' . $c . '/' . ($j === 'BAD-JSON' ? 'not-json'
    : ($j === null ? 'null' : ((($j['data'] ?? $j) === null) ? 'null' : 'ACCOUNT')));
$pause();

/* ------------------------------------------- 2. the password path still runs */
// A deliberately wrong password. 401 is the login path working; 500 is the
// fatal; anything else means the route changed shape.
[$c, $j] = $call('login', ['email' => 'nobody@example.invalid', 'password' => 'not-the-password']);
$err = is_array($j) ? ($j['error'] ?? 'none') : ($j === 'BAD-JSON' ? 'not-json' : 'null');
$bits[] = 'badLogin=' . $c . '/' . $err;
$pause();

/* ------------------------------------- 3. the header the gate insists on */
// store_require_admin_header() answers 400 without it. Its absence would mean
// a cross-origin form could reach routes a custom header keeps it away from.
[$c] = $call('login', ['email' => 'x@example.invalid', 'password' => 'x'], false);
$bits[] = 'noHeader=' . $c;
$pause();

/* --------------------------------------------------- 4. the gate itself */
// A data route with no session. 401 is the gate; 200 is the gate GONE, which
// is the one result here that would be an emergency.
foreach (['stats', 'orders', 'rules'] as $route) {
    [$c] = $call($route);
    $bits[] = $route . '=' . $c;
    $pause();
}

/* ------------------------------------------------ 5. Google sign-in, today */
// Above the gate by design. `enabled=0` is the expected state until a client id
// is pasted in, and a bad token must be 401 rather than 500 — the new code path
// is the one most likely to carry a fatal.
[$c, $j] = $call('google_config');
$bits[] = 'gConfig=' . $c . '/' . (is_array($j) ? ('enabled=' . (!empty($j['enabled']) ? 1 : 0)) : 'not-json');
$pause();

[$c, $j] = $call('google_login', ['credential' => 'not.a.token']);
$bits[] = 'gBadToken=' . $c . '/' . (is_array($j) ? ($j['error'] ?? 'none') : 'not-json');
$pause();

/* ------------------------------------------------------ 6. the cookie flags */
// Asked of a real response rather than read from a file: LiteSpeed ignores the
// Header edit directives this shop used to rely on, which is why the flags are
// set where the cookie is made. No session is created here, so this reports
// only whether anything sets a cookie it should not.
$ch = curl_init('https://127.0.0.1/api/admin.php?r=me');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
                        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1'],
                        CURLOPT_TIMEOUT => 25]);
$raw = (string) curl_exec($ch);
$hsz = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);
$head = substr($raw, 0, $hsz);
$bits[] = 'setCookie=' . (preg_match_all('/^set-cookie:/im', $head) ?: 0);

/* ------------------------------------------- 7. and the key cache, if any */
// The JWKS cache is a TRUST ANCHOR — whoever can write it chooses the keys that
// decide whether a token is genuine. It must be in the account's own storage at
// 0600, never a shared temp directory. Reported as state, and its CONTENT is
// never printed (it is public key material, but the habit is the point).
$cache = '/home/u130124229/domains/sporta.com.kw/storage/google-jwks.json';
$bits[] = 'jwksCache=' . (is_file($cache)
    ? substr(sprintf('%o', fileperms($cache)), -4) . '/' . filesize($cache) . 'b'
    : 'none-yet');
$stray = sys_get_temp_dir() . '/sporta-google-jwks.json';
$bits[] = 'jwksInTmp=' . (is_file($stray) ? 'YES-STALE' : 'no');

echo 'LOGIN ' . implode(' ', $bits)
   . ' | throttled=' . $throttled
   . ($throttled ? ' VERDICT=INCONCLUSIVE-throttled' : ' VERDICT=read-these')
   . "\n";
