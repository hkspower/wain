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
    //
    // The nomination letter names a Merchant ID and a Terminal ID and calls
    // NEITHER of them "Tranportal" (Sporta's test pair: merchant 6261,
    // terminal 626101). CBK usually means the terminal-level credential here,
    // but that is an inference — confirm it with the bank in the same email
    // that requests the RAW toolkit details, or the first thing that tells you
    // is a failed test transaction. See KNET.md §2a.
    'tranportal_id'       => 'YOUR_TRANPORTAL_ID',
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY', // AES key (secret)

    // --- Your URLs (KNET redirects the customer here) ---
    'response_url' => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    // Final page in your React app:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // action 1 = purchase, currency 414 = KWD.
    'action'        => '1',
    'currency_code' => '414',

    // WHICH STRING KNET WANTS FOR "ENGLISH" IS NOT SETTLED — confirm it, do
    // not assume it, in the same email as the RAW-toolkit request (KNET.md
    // §2a already has one open question of exactly this kind: which of the two
    // numbers in the nomination letter is the Tranportal ID).
    //
    // `langid` goes into trandata and picks the face of the bank's card page.
    // Arabic is 'AR' everywhere. English is the uncertain one: KPG integration
    // samples in this family of gateways commonly show `langid=USA` rather
    // than 'EN', and this shop has only ever sent 'EN'. Nobody here has seen
    // an English test transaction confirmed against the live gateway, so the
    // honest state is "unverified", not "working".
    //
    // It is a CONFIG value rather than a constant in pay.php for the reason
    // everything else here is: the server has no shell and no build step. When
    // the bank answers, the fix is editing this line in File Manager — not a
    // code change, a rebuild and a redeploy.
    //
    // The default is unchanged from what has always been sent, so nothing
    // moves until somebody deliberately moves it.
    'lang_en'  => 'EN',      // <- if KNET says USA, change ONLY this line
    'lang_ar'  => 'AR',
    'language' => 'EN',      // fallback when the storefront sends no ?lang=

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
    //
    // LEAVE THESE BLANK. That is the recommended setting, not a shortcut: an
    // absent block is inherited from api/config.php's db_* values by
    // knet_config(), so the orders database is named in ONE place and cannot fall
    // out of step with itself. The old advice — copy the same four values
    // across — is what made a MySQL password rotated in hPanel silently kill
    // the card path from a file nobody thought to open.
    //
    // Fill them in only to point this gateway at a DIFFERENT database on
    // purpose; an explicit value here always wins. With neither file naming
    // one there is no price authority and every payment is refused.
    'mysql_host' => '',
    'mysql_name' => '',
    'mysql_user' => '',
    'mysql_pass' => '',
];
