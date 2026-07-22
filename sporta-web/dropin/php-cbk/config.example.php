<?php
// CBK T-Pay configuration. Copy to config.php and fill with the values CBK
// sends you after merchant activation. Keep config.php OUT of public access
// (see .htaccess) and never commit real credentials.

return [
    // --- From CBK merchant onboarding (the PDF / bank email) ---
    'tranportal_id'       => 'YOUR_MERCHANT_ID',        // Merchant / Tranportal ID
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY', // AES key (secret)

    // Gateway URL — CBK gives sandbox and production. Set the active one here.
    // Sandbox (test) and Production are DIFFERENT hosts; swap when going live.
    'gateway_url'         => 'https://PROVIDED_BY_CBK/kpg/PaymentHTTP.htm',

    // --- Your URLs (must be registered with CBK) ---
    'response_url'        => 'https://www.sporta.com.kw/pay/callback.php',
    'error_url'           => 'https://www.sporta.com.kw/pay/callback.php',
    // Where the customer finally lands (your React result page):
    'return_url'          => 'https://www.sporta.com.kw/payment/result',

    // KWD = currency code 414, purchase action = 1, language EN.
    'currency_code'       => '414',
    'action'              => '1',
    'language'            => 'EN',

    // --- Optional: push the paid status into your Supabase "orders" table ---
    // Leave blank to skip and handle order updates yourself.
    'supabase_url'        => '',   // e.g. https://xxxx.supabase.co
    'supabase_service_key'=> '',   // service role key (server-side only!)
    'orders_table'        => 'orders',
    'orders_match_column' => 'track_id',
];
