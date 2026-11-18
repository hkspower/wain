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
    // Use the credentials issued for the selected env. Before switching from
    // test to production, replace all three with the LIVE credential set CBK
    // issued; changing env alone only changes the gateway URL.
    //
    // The nomination letter names a Merchant ID and a Terminal ID and calls
    // NEITHER of them "Tranportal" (Sporta's test pair: merchant 6261,
    // terminal 626101). CBK usually means the terminal-level credential here,
    // but that is an inference — confirm it with the bank in the same email
    // that requests the RAW toolkit details, or the first thing that tells you
    // is a failed test transaction. See KNET.md §2a.
    'tranportal_id'       => 'YOUR_TRANPORTAL_ID',
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY', // replace with the real secret: exactly 16 BYTES

    // --- Your URLs (KNET redirects the customer here) ---
    'response_url' => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    // Final page in your React app:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // Only the default language is configurable. Purchase action 1 and KWD
    // currency 414 are fixed by the Sporta checkout code.
    // Sporta sends USA for English and AR for Arabic. KNET's plug-in names no
    // langid constant, so confirm on the first Arabic TEST payment that the
    // bank's page comes up in Arabic.
    'language'      => 'USA',

    // The Tranportal ID, password and both URLs above travel RAW inside the
    // encrypted request, as KNET's own plug-in sends them. None of them may
    // contain & = ? # or a control character (refused on save and at checkout).
    // Gateway URLs: exactly the two above, or their www. forms
    // (https://www.kpaytest.com.kw/kpg/PaymentHTTP.htm, https://www.kpay.com.kw/...).

    // --- Lost-callback inquiry (KNET-IPAYPIPE-CHECK.md D2). OFF. ---
    // When true, api/cron-stock.php asks the bank (tranPipe.htm, XML) about a
    // pending KNET order before releasing its stock, and settles a CAPTURED one
    // the way callback.php would. It REFUSES to run until inquiry_action holds
    // the inquiry action code KNET gives you: there is deliberately no default,
    // and codes that move money (1-7, 9) are refused. inquiry_transid
    // ('trackid' or '') and inquiry_udf5 (letters, or '') add <transid> / <udf5>
    // if KNET says the inquiry needs them. See KNET.md, "Inquiry".
    'inquiry_enabled' => false,
    // 'inquiry_action'  => '',      // from KNET; no default
    // 'inquiry_transid' => '',
    // 'inquiry_udf5'    => '',

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
    // at all, so pay.php refuses to create a gateway session and callback.php
    // can only send the payment to review.
    //
    // Use the SAME four values as api/config.php — one database, one set of
    // orders, read by the shop and by both gateways.
    'mysql_host' => 'localhost',
    'mysql_name' => 'u130124229_sporta_kw',
    'mysql_user' => 'u130124229_sporta_user',
    'mysql_pass' => '',
];
