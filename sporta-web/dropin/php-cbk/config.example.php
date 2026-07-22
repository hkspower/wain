<?php
// CBK Hosted KNET & T-Pay — configuration.
// Copy to config.php and fill with the values CBK sends after activation.
// Keep config.php OUT of public web access (see .htaccess). Never commit it.
//
// NOTE: CBK T-Pay does NOT require you to AES-encrypt anything. ENCRP_KEY and
// the AccessToken are already-encrypted tokens issued by the bank/gateway —
// you pass them through as-is.

return [
    // --- Environment: 'test' or 'production' ---
    'env' => 'test',

    // Base URLs from CBK (the {TestPG} / {ProductionPG} placeholders in the
    // manual). CBK gives you the real hosts on activation.
    'test_base'       => 'https://PROVIDED_BY_CBK_TEST',        // {TestPG}
    'production_base' => 'https://PROVIDED_BY_CBK_PRODUCTION',  // {ProductionPG}

    // --- Merchant API credentials (server-side only, never to the browser) ---
    'client_id'     => 'YOUR_CLIENT_ID',      // ClientId  (Merchant API ID)
    'client_secret' => 'YOUR_CLIENT_SECRET',  // ClientSecret (Merchant API Password)
    'encrp_key'     => 'YOUR_ENCRP_KEY',      // ENCRP_KEY (Merchant Encrypted account key)

    // --- Your URLs ---
    // Where CBK sends the customer back (this callback), with ?encrp=...
    'return_url'      => 'https://www.sporta.com.kw/pay/callback.php',
    // Final page in your React app the customer lands on after we verify:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // Default language for the hosted page: 'en' or 'ar'
    'lang' => 'en',

    // Payment mode: '' = let customer choose, '1' = KNET only, '2' = T-Pay QR only
    'pay_type' => '',

    // Where to cache the AccessToken (must be writable, NOT web-accessible).
    'token_cache_file' => __DIR__ . '/.cbk_token.json',

    // --- Optional: update your Supabase "orders" table on success ---
    'supabase_url'         => '',
    'supabase_service_key' => '',
    'orders_table'         => 'orders',
    'orders_match_column'  => 'track_id',
];
