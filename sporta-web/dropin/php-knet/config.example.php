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

    // --- Orders database. STRONGLY RECOMMENDED ---
    // When these are set, pay.php charges the amount stored on the order and
    // refuses the payment if it cannot verify it. When they are EMPTY there is
    // no price authority at all and the browser decides what to pay — never run
    // a live storefront that way.
    'supabase_url'         => '',
    'supabase_service_key' => '',
    'orders_table'         => 'orders',
    'orders_match_column'  => 'track_id',
];
