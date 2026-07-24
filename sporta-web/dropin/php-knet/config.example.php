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

    // --- Optional: update your Supabase "orders" table on result ---
    'supabase_url'         => '',
    'supabase_service_key' => '',
    'orders_table'         => 'orders',
    'orders_match_column'  => 'track_id',
];
