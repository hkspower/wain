<?php
// Start a CBK payment.
//   GET/POST: amount=1.500 & trackid=ORDER123 (unique) [& ref, udf1..5, lang, paytype]
// Fetches an AccessToken, then auto-submits the NVP form to CBK's hosted page.

declare(strict_types=1);
require __DIR__ . '/cbk.php';
cbk_require_https(); // payments must never run over plain HTTP
$cfg = require __DIR__ . '/config.php';

$amount  = trim((string)($_REQUEST['amount']  ?? ''));
$trackid = trim((string)($_REQUEST['trackid'] ?? ''));
$lang    = trim((string)($_REQUEST['lang'] ?? $cfg['lang'])) === 'ar' ? 'ar' : 'en';
$payType = (string)($_REQUEST['paytype'] ?? $cfg['pay_type']); // '', '1'=KNET, '2'=QR

if ($amount === '' || $trackid === '') {
    http_response_code(400);
    exit('amount and trackid are required');
}

try {
    $token = cbk_get_access_token($cfg);
} catch (Throwable $e) {
    http_response_code(502);
    exit('Payment init failed: could not authenticate with CBK.');
}

$checkoutUrl = cbk_base($cfg) . '/ePay/pg/epay?_v=' . rawurlencode($token);

// Fields per the manual. ENCRP_KEY and AccessToken pass through as-is.
$fields = [
    'tij_MerchantEncryptCode'  => $cfg['encrp_key'],
    'tij_MerchAuthKeyApi'      => $token,
    'tij_MerchantPaymentLang'  => $lang,
    'tij_MerchantPaymentAmount'=> $amount,
    'tij_MerchantPaymentTrack' => $trackid,
    'tij_MerchantPaymentRef'   => (string)($_REQUEST['ref'] ?? ''),
    'tij_MerchantPaymentCurrency' => 'KWD',
    'tij_MerchantUdf1'         => (string)($_REQUEST['udf1'] ?? ''),
    'tij_MerchantUdf2'         => (string)($_REQUEST['udf2'] ?? ''),
    'tij_MerchantUdf3'         => (string)($_REQUEST['udf3'] ?? ''),
    'tij_MerchantUdf4'         => (string)($_REQUEST['udf4'] ?? ''),
    'tij_MerchantUdf5'         => (string)($_REQUEST['udf5'] ?? ''),
    'tij_MerchPayType'         => $payType,
    'tij_MerchReturnUrl'       => $cfg['return_url'],
];

$h = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting to payment…</title></head>
<body onload="document.forms[0].submit()">
  <p style="font-family:sans-serif;text-align:center;margin-top:3rem">
    Redirecting you to the secure payment page…
  </p>
  <form method="post" action="<?= $h($checkoutUrl) ?>" enctype="application/x-www-form-urlencoded">
    <?php foreach ($fields as $name => $value): ?>
      <input type="hidden" name="<?= $h($name) ?>" value="<?= $h($value) ?>">
    <?php endforeach; ?>
    <noscript><button type="submit">Continue to payment</button></noscript>
  </form>
</body></html>
