<?php
// KNET configuration.
//
// ===========================================================================
// MOST SHOPS DO NOT NEED TO FILL THIS FILE IN AT ALL. Read this first.
// ===========================================================================
//
// There are two ways to take a KNET payment, and which one you have was
// decided by your bank when it activated you:
//
//   THE OFFICIAL CBK HOSTED PAGE — the one Sporta is nominated for. KNET is
//     `tij_MerchPayType=1` on the very same gateway, merchant account and
//     credentials that already take T-Pay: pay/cbk.php calls itself "CBK
//     Hosted KNET & T-Pay" and implements the CBK Integration & Reference
//     Manual v2.93. Everything it needs lives in pay/config.php.
//     THERE IS NOTHING TO FILL IN HERE FOR THIS. Leave the Tranportal block
//     below empty and /knet/pay.php hands the shopper straight to it.
//
//   LEGACY TRANPORTAL — a separate, older KNET integration for shops issued a
//     Tranportal ID, a Tranportal password and a 16-byte Terminal Resource
//     Key. If you hold those three, fill them in below and this dropin uses
//     them, exactly as it always has.
//
// Fill the block in ONLY if the bank actually issued you those three values.
// Guessing at them is what left this shop without KNET: the three "confirm
// this with the bank" notes that used to be in this file — which of the two
// numbers on the nomination letter is the Tranportal ID, whether English is
// 'EN' or 'USA', which of the two callback styles you get — are all questions
// the legacy path asks and the official path does not. See KNET.md.
//
// Keep config.php out of public access (see .htaccess). Never commit real
// credentials.

return [
    // 'test' or 'production'
    'env' => 'test',

    // WHICH INTEGRATION. Leave it out and knet_mode() decides: legacy whenever
    // the Tranportal block below could actually take a payment, official
    // otherwise — so it can only ever turn a dead card path into a live one,
    // never the reverse. Set it to stop deciding, which is what to do the day
    // the bank puts the answer in writing:
    //   'official'  the CBK hosted page as KNET (pay/config.php)
    //   'legacy'    the Tranportal integration in this file
    // 'mode' => 'official',

    // ---- LEGACY TRANPORTAL ONLY. Ignored on the official path. ----
    // KNET hosted-payment endpoints (standard KPG URLs).
    'test_url'       => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
    'production_url' => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',

    // --- LEGACY TRANPORTAL CREDENTIALS. LEAVE EMPTY UNLESS YOU HOLD THEM. ---
    //
    // Empty (or still holding these placeholders, or a resource key that is not
    // exactly 16 bytes) means "no Tranportal account", and /knet/pay.php uses
    // the official CBK hosted page instead. That is the right setting for
    // Sporta.
    //
    // The nomination letter names a Merchant ID and a Terminal ID and calls
    // NEITHER of them "Tranportal" (Sporta's test pair: merchant 6261,
    // terminal 626101). Which one belongs here is a question for the bank —
    // and it is a question you only have to ask if you are on this path. On
    // the official path the same activation email that already works for
    // T-Pay works for KNET, with no third credential to identify.
    'tranportal_id'       => '',
    'tranportal_password' => '',
    'resource_key'        => '', // AES-128 key: EXACTLY 16 bytes, secret

    // --- Your URLs (KNET redirects the customer here) ---
    'response_url' => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    // Final page in your React app:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // action 1 = purchase, currency 414 = KWD.
    'action'        => '1',
    'currency_code' => '414',

    // LEGACY ONLY, AND ONE OF THE THREE REASONS NOT TO BE ON IT. The official
    // path takes the shop's own 'ar'/'en' straight through to the hosted page
    // and this whole question disappears with it.
    //
    // WHICH STRING KNET WANTS FOR "ENGLISH" IS NOT SETTLED — confirm it, do
    // not assume it, in the same email as the RAW-toolkit request.
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

    // LEGACY ONLY, and the third of the three. On the official path the
    // gateway returns to pay/config.php's return_url and pay/callback.php
    // settles the order — one callback for both faces of the page, with
    // nothing to choose.
    //
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
