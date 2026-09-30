<?php
/**
 * Is the CBK gateway — KNET and T-Pay — ready to take money on this server?
 *
 *   php /home/<user>/live-pay-check.php
 *
 * READ-ONLY, and it prints NO VALUE, ever: only "set", "PLACEHOLDER" or
 * "MISSING". pay/config.php holds the merchant's ClientId, ClientSecret and
 * ENCRP_KEY, and this file is fetched over plain HTTP from a PUBLIC repository
 * by a cron job. A diagnostic that leaks the credentials it is checking would
 * hand over a working payment gateway.
 *
 * WHY IT EXISTS. T-Pay and KNET are the same integration on the same hosted
 * gateway — CBK's Integration & Reference Manual v2.93, one set of credentials,
 * one checkout URL, and `tij_MerchPayType` choosing the face of it. So "is
 * T-Pay working?" is not a question about T-Pay code; it is a question about
 * whether three credentials are present and which environment is selected. That
 * is checkable in a second and was previously answerable only by trying a real
 * payment.
 *
 * PLACEHOLDER IS ITS OWN ANSWER, and the important one. config.example.php
 * ships YOUR_CLIENT_ID and the sandbox carries SANDBOX_NOT_A_REAL_*; both are
 * "present" to any check that only asks whether a key is non-empty, and both
 * mean the shop cannot take a payment. Reporting them as set is exactly the
 * lie this is here to prevent.
 *
 * ONE LINE, because cron returns only the last one.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$cfg = @include $ROOT . '/pay/config.php';
if (!is_array($cfg)) { echo "PAY failed=no-config\n"; exit; }

/** set / PLACEHOLDER / MISSING — never the value itself. */
$state = static function (string $k) use ($cfg): string {
    $v = trim((string) ($cfg[$k] ?? ''));
    if ($v === '') return 'MISSING';
    // The two shapes that are present and useless.
    if (stripos($v, 'YOUR_') === 0 || stripos($v, 'SANDBOX_NOT_A_REAL') !== false
        || stripos($v, 'CHANGEME') !== false) {
        return 'PLACEHOLDER';
    }
    return 'set';
};

$creds = [];
foreach (['client_id', 'client_secret', 'encrp_key'] as $k) {
    $creds[] = $k . '=' . $state($k);
}

$env = trim((string) ($cfg['env'] ?? ''));
// 'test' is the ONLY value that selects the test gateway; anything else, or
// nothing at all, is treated as live. Worth printing the raw word rather than
// a yes/no, because 'production ', 'Production' and 'prod' all mean live here
// and all look wrong to a reader expecting one spelling.
$base = $env === 'test'
    ? (string) ($cfg['test_base'] ?? '')
    : (string) ($cfg['production_base'] ?? '');

// pay_type pins the gateway to one face. '' lets the shopper choose on CBK's
// page; the shop normally passes ?paytype= per order instead, so '' is the
// expected value here and a pinned one is worth noticing.
$pt = trim((string) ($cfg['pay_type'] ?? ''));

// The return URL must be THIS shop over https, or CBK sends the customer —
// and the payment result — somewhere else.
$ret = trim((string) ($cfg['return_url'] ?? ''));
$retOk = $ret !== '' && stripos($ret, 'https://') === 0
      && stripos($ret, 'sporta.com.kw') !== false;

echo 'PAY ' . implode(' ', $creds)
   . ' env=' . ($env === '' ? '(unset)' : $env)
   . ' gateway=' . ($base === '' ? 'MISSING' : parse_url($base, PHP_URL_HOST))
   . ' payType=' . ($pt === '' ? 'shopper-chooses' : $pt)
   . ' returnUrl=' . ($retOk ? 'ok' : 'CHECK')
   . "\n";
