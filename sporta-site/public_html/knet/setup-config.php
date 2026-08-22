<?php
// knet/setup-config.php — writes knet/config.php from the secrets it asks for.
//
// Run it from a PHP command line ON THE SERVER:
//     cd public_html/knet && php setup-config.php
//
// This host has no shell (SSH is off for good), so in practice config.php is
// written by hand in hPanel File Manager and knet/selftest.php does the
// validating instead. This script stays for hosts that do have a CLI.
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
//   * an orders database that is not actually reachable — without it the
//     server has no authority over the price, pay.php has no amount to charge
//     and every card payment is refused with a blunt 400.

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

// ------------------------------------------------------------ orders database
// The SAME database api/config.php uses. Both gateways settle rows in the one
// orders table the shop writes, so these four values must match exactly.
fwrite(STDOUT, "\nThe orders database (same values as api/config.php):\n");
$dbHost = ask('  MySQL host             : ');
$dbName = ask('  MySQL database name    : ');
$dbUser = ask('  MySQL user             : ');
$dbPass = ask('  MySQL password         : ', true);

// Prove it before writing it. A config that names an unreachable database
// looks configured and refuses every payment.
try {
    $probe = new PDO(
        "mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4",
        $dbUser,
        $dbPass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $n = (int) $probe->query('select count(*) from orders')->fetchColumn();
    ok("Connected; the orders table is readable ($n orders).");
    $p = (int) $probe->query('select count(*) from products')->fetchColumn();
    if ($p === 0) {
        warn('The products table is EMPTY. Orders are priced from it, so');
        warn('checkout will fail until the catalogue is loaded.');
    } else {
        ok("The products table holds $p products to price orders from.");
    }
} catch (Throwable $e) {
    warn('Could not read the orders table: ' . $e->getMessage());
    warn('Card payments will be refused until this connects.');
    fwrite(STDOUT, "  Write the config anyway? Type 'yes' to continue: ");
    if (trim((string) fgets(STDIN)) !== 'yes') {
        exit("Nothing written.\n");
    }
}

// --------------------------------------------------------------------- write
// var_export escapes quotes and backslashes, so a password containing them
// cannot break out of the string and corrupt the config file.
$q      = fn (string $v): string => var_export($v, true);
$eTid   = $q($tid);
$eTpw   = $q($tpw);
$eKey   = $q($key);
$eHost  = $q($dbHost);
$eName  = $q($dbName);
$eUser  = $q($dbUser);
$ePass  = $q($dbPass);

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

    'mysql_host' => {$eHost},
    'mysql_name' => {$eName},
    'mysql_user' => {$eUser},
    'mysql_pass' => {$ePass},
];

PHP;

if (@file_put_contents($dest, $cfg) === false) {
    exit("\nCould not write $dest — check directory permissions.\n");
}
@chmod($dest, 0600);

fwrite(STDOUT, "\n");
ok("Wrote $dest (0600)");

fwrite(STDOUT, <<<TXT

Next
  1. Visit https://www.sporta.com.kw/knet/selftest.php and confirm every line.
  2. Delete selftest.php and this setup script from the server.
  3. Make one test purchase while env is still 'test'.
  4. Only then set 'env' => 'production' in config.php.


TXT);
