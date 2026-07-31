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

    // Where to cache the AccessToken. This file IS a bearer credential: whoever
    // holds it can call CBK as this merchant until it expires.
    //
    // The default used to be __DIR__ . '/.cbk_token.json', which put it inside
    // the web root at /public_html/pay/. Three .htaccess rules denied it and all
    // three still do — but a credential in the web root is defended by
    // configuration, and configuration is the thing that breaks. One directory
    // up is /public_html/../, outside the document root, where no Apache rule,
    // no rewrite ordering and no future folder .htaccess can matter. That is
    // where knet-payments.log already lives, for the same reason.
    //
    // Must be writable by PHP. hPanel File Manager can create it next to
    // public_html; cbk.php creates it on first use if the directory is writable.
    'token_cache_file' => __DIR__ . '/../../.cbk_token.json',

    // --- Optional: update your Supabase "orders" table on success ---
    // --- ORDERS DATABASE. REQUIRED for a live shop ---
    //
    // Gives the SERVER authority over the price: pay.php charges the amount
    // stored on the order and callback.php refuses to settle when what CBK
    // captured does not match. Without it there is nothing to charge and
    // T-Pay refuses every payment.
    //
    // Fill in ONE block, matching public_html/config.js — and use the SAME
    // values as knet/config.php, since both gateways read the same orders.
    //
    // (a) NATIVE backend  (config.js has  backend: 'php'):
    // 'store'      => 'mysql',
    // 'mysql_host' => 'localhost',
    // 'mysql_name' => '',
    // 'mysql_user' => '',
    // 'mysql_pass' => '',
    //
    // (b) SUPABASE backend:
    'supabase_url'         => '',
    'supabase_service_key' => '',
    'orders_table'         => 'orders',
    'orders_match_column'  => 'track_id',
];
