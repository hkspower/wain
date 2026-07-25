<?php
// knet/setup-config.php — writes knet/config.php from five secrets.
//
// Run it ON THE SERVER over SSH:
//     cd public_html/knet && php setup-config.php
//
// Everything except the five secrets is already known, so this only asks for
// what it cannot work out, validates each answer, and writes config.php with
// 0600 permissions. Nothing is echoed back to a browser and nothing is stored
// anywhere else.
//
// It also catches the two failures that are silent and expensive:
//   * a resource key that is not exactly 16 bytes — AES-128 needs 16, and a
//     stray space from copy/paste makes KNET reject every transaction with no
//     useful error;
//   * the Supabase ANON key pasted where the SERVICE key belongs — row-level
//     security then blocks order creation, so checkout fails for everyone.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script only runs from the command line.\n");
}

$dir  = __DIR__;
$dest = $dir . '/config.php';

function ask(string $label, bool $secret = false): string
{
    while (true) {
        fwrite(STDOUT, $label);
        if ($secret && stripos(PHP_OS, 'WIN') !== 0) {
            @shell_exec('stty -echo 2>/dev/null');
        }
        $v = fgets(STDIN);
        if ($secret && stripos(PHP_OS, 'WIN') !== 0) {
            @shell_exec('stty echo 2>/dev/null');
            fwrite(STDOUT, "\n");
        }
        if ($v === false) {
            exit("\nAborted.\n");
        }
        // Trim whitespace AND the invisible characters that survive a paste
        // out of a PDF or an email: NBSP, zero-width space, BOM.
        $v = trim($v, " \t\n\r\0\x0B");
        $v = str_replace(["\u{00A0}", "\u{200B}", "\u{FEFF}"], '', $v);
        if ($v !== '') {
            return $v;
        }
        fwrite(STDOUT, "  ! Cannot be empty.\n");
    }
}

function warn(string $m): void { fwrite(STDOUT, "  ! $m\n"); }
function ok(string $m): void   { fwrite(STDOUT, "  ✓ $m\n"); }

fwrite(STDOUT, "\nSporta — KNET configuration\n===========================\n\n");

if (is_file($dest)) {
    fwrite(STDOUT, "config.php already exists.\nOverwrite it? Type 'yes' to replace: ");
    if (trim((string) fgets(STDIN)) !== 'yes') {
        exit("Left untouched.\n");
    }
    @copy($dest, $dest . '.bak-' . date('Ymd-His'));
    ok('Existing file backed up alongside it.');
    fwrite(STDOUT, "\n");
}

// ---------------------------------------------------------------- Tranportal
fwrite(STDOUT, "From CBK / your bank (Tranportal):\n");
$tid  = ask('  Tranportal ID          : ');
$tpw  = ask('  Tranportal password    : ', true);

while (true) {
    $key = ask('  Terminal resource key  : ', true);
    $len = strlen($key);
    if ($len === 16) {
        ok('Resource key is 16 bytes.');
        break;
    }
    warn("That key is $len bytes; AES-128 needs exactly 16.");
    warn('Check for a trailing space or a missing character, then re-enter it.');
}

// ------------------------------------------------------------------ Supabase
fwrite(STDOUT, "\nFrom Supabase (Project settings -> API):\n");

while (true) {
    $sbUrl = rtrim(ask('  Project URL            : '), '/');
    if (preg_match('~^https://[A-Za-z0-9.-]+\.supabase\.(co|in)$~', $sbUrl)) {
        ok('Project URL looks right.');
        break;
    }
    // Self-hosted Supabase and custom domains are legitimate, so warn rather
    // than refuse — but make an obvious typo hard to accept by accident.
    warn('That is not the usual https://<project>.supabase.co form.');
    if (!preg_match('~^https?://~', $sbUrl)) {
        warn('It is not even a URL — re-enter it.');
        continue;
    }
    fwrite(STDOUT, "  Self-hosted or custom domain? Type 'yes' to accept: ");
    if (trim((string) fgets(STDIN)) === 'yes') {
        break;
    }
}

while (true) {
    $sbKey = ask('  SERVICE role key       : ', true);
    $role  = null;

    if (str_starts_with($sbKey, 'eyJ')) {              // classic JWT key
        $parts = explode('.', $sbKey);
        if (count($parts) === 3) {
            $pad  = strtr($parts[1], '-_', '+/');
            $json = json_decode((string) base64_decode($pad . str_repeat('=', (4 - strlen($pad) % 4) % 4)), true);
            $role = $json['role'] ?? null;
        }
    } elseif (str_starts_with($sbKey, 'sb_secret_')) {  // new-style secret key
        $role = 'service_role';
    } elseif (str_starts_with($sbKey, 'sb_publishable_')) {
        $role = 'anon';
    }

    if ($role === 'service_role') {
        ok('That is the service key.');
        break;
    }
    if ($role === 'anon') {
        warn('That is the ANON (public) key, not the service key.');
        warn('With it, row-level security blocks order creation and checkout');
        warn('fails for every customer. Copy the "service_role" key instead.');
        continue;
    }
    warn('Could not confirm this is the service key.');
    fwrite(STDOUT, "  Use it anyway? Type 'yes' to continue: ");
    if (trim((string) fgets(STDIN)) === 'yes') {
        break;
    }
}

// --------------------------------------------------------------------- write
// var_export escapes quotes and backslashes, so a password containing them
// cannot break out of the string and corrupt the config file.
$q      = fn (string $v): string => var_export($v, true);
$eTid   = $q($tid);
$eTpw   = $q($tpw);
$eKey   = $q($key);
$eUrl   = $q($sbUrl);
$eSbKey = $q($sbKey);

$cfg = <<<PHP
<?php
// Live KNET configuration — written by setup-config.php.
// Contains real credentials: never commit it, never upload it, keep it 0600.

return [
    'env' => 'test', // switch to 'production' only after a successful test sale

    'test_url'       => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
    'production_url' => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',

    'tranportal_id'       => {$eTid},
    'tranportal_password' => {$eTpw},
    'resource_key'        => {$eKey},

    'response_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'       => 'https://www.sporta.com.kw/knet/callback.php',
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    'action'        => '1',
    'currency_code' => '414',
    'language'      => 'EN',

    'log_file' => __DIR__ . '/../../knet-payments.log',

    'supabase_url'         => {$eUrl},
    'supabase_service_key' => {$eSbKey},
    'orders_table'         => 'orders',
    'orders_match_column'  => 'track_id',
];

PHP;

if (@file_put_contents($dest, $cfg) === false) {
    exit("\nCould not write $dest — check directory permissions.\n");
}
@chmod($dest, 0600);

fwrite(STDOUT, "\n");
ok("Wrote $dest (0600)");

// ------------------------------------------------------- live sanity checks
fwrite(STDOUT, "\nChecking Supabase...\n");
$probe = function (string $path) use ($sbUrl, $sbKey) {
    $ch = curl_init($sbUrl . '/rest/v1/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_HTTPHEADER     => ['apikey: ' . $sbKey, 'Authorization: Bearer ' . $sbKey],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $body];
};

[$code, $body] = $probe('products?select=slug&limit=5');
if ($code >= 200 && $code < 300) {
    $rows = json_decode((string) $body, true);
    $n = is_array($rows) ? count($rows) : 0;
    if ($n > 0) {
        ok("products table reachable, rows present.");
    } else {
        warn('products table is reachable but EMPTY.');
        warn('Checkout will fail with "Order has no payable amount" until the');
        warn('catalogue is loaded (task B1). Orders are priced from this table.');
    }
} else {
    warn("products query returned HTTP $code — check the URL and key.");
}

[$code2] = $probe('orders?select=track_id&limit=1');
if ($code2 >= 200 && $code2 < 300) {
    ok('orders table reachable.');
} else {
    warn("orders query returned HTTP $code2 — the schema may not be applied yet.");
}

fwrite(STDOUT, <<<TXT

Next
  1. Visit https://www.sporta.com.kw/knet/selftest.php and confirm every line.
  2. Delete selftest.php and this setup script from the server.
  3. Make one test purchase while env is still 'test'.
  4. Only then set 'env' => 'production' in config.php.


TXT);
