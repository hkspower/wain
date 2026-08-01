<?php
// Classic KNET (KPG) configuration. Copy to config.php and fill with the
// Tranportal credentials your bank/KNET issued. Keep config.php out of public
// access (see .htaccess). Never commit real credentials.

return [
    // 'test' or 'production'
    'env' => 'test',

    // KNET hosted-payment endpoints (standard KPG URLs).
    'test_url'       => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
    'production_url' => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',

    // --- From your bank / KNET (Tranportal) ---
    'tranportal_id'       => 'YOUR_TRANPORTAL_ID',
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY', // AES key (secret)

    // --- Your URLs (KNET redirects the customer here) ---
    'response_url' => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    // Final page in your React app:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // action 1 = purchase, currency 414 = KWD, language EN.
    'action'        => '1',
    'currency_code' => '414',
    'language'      => 'EN',

    // Payment audit log (append-only, chmod 600 on first write). Put it OUTSIDE
    // public_html so it can never be fetched over HTTP. Set '' to disable —
    // but a payment system with no trail cannot be reconciled or disputed.
    'log_file' => __DIR__ . '/../../knet-payments.log',

    // How the customer gets back to the shop after paying. See the long note
    // in callback.php: KPG either redirects the browser here, or calls this URL
    // server-to-server and reads `REDIRECT=<url>` out of the reply. Which one
    // your Tranportal ID gets is the bank's choice.
    //   'both'     (default) answers correctly in EITHER style — leave it here
    //              unless the bank tells you otherwise.
    //   'redirect' plain HTTP 302, browser-redirect deployments only.
    'callback_response' => 'both',

    // --- ORDERS DATABASE. REQUIRED for a live shop ---
    //
    // This is what gives the SERVER authority over the price. With it, pay.php
    // charges the amount stored on the order and callback.php checks that the
    // amount the bank captured matches. Without it there is no price authority
    // at all — never run a live storefront that way.
    //
    // Use the SAME four values as api/config.php — one database, one set of
    // orders, read by the shop and by both gateways.
    'mysql_host' => 'localhost',
    'mysql_name' => '',
    'mysql_user' => '',
    'mysql_pass' => '',
];
