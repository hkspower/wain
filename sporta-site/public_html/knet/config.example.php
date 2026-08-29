<?php
// KNET configuration — the Tranportal integration.
//
// ===========================================================================
// THIS SHOP USES THE TRANPORTAL VALUES. Owner's decision, and it is pinned
// below rather than left to be worked out. Fill in the three credentials.
// ===========================================================================
//
// There are two ways to take a KNET payment. Sporta is on the first:
//
//   LEGACY TRANPORTAL — this file. A Tranportal ID, a Tranportal password and
//     a 16-byte Terminal Resource Key; an AES-128-CBC `trandata` blob; the
//     shopper posted to kpay.com.kw/kpg. The three values come from the bank
//     and go in the block below.
//
//   THE OFFICIAL CBK HOSTED PAGE — the fallback, kept working and kept tested.
//     KNET is `tij_MerchPayType=1` on the same gateway and merchant account
//     that already take T-Pay: pay/cbk.php calls itself "CBK Hosted KNET &
//     T-Pay" and implements the CBK Integration & Reference Manual v2.93.
//     Everything it needs is already in pay/config.php, so switching to it is
//     one line — `'mode' => 'official'` — and nothing else.
//
// THREE THINGS TO CONFIRM WITH THE BANK, because the Tranportal path asks them
// and the official one does not. None of them stops you filling this in today;
// all three are things a failed transaction would otherwise teach you slowly:
//
//   1. WHICH NUMBER IS THE TRANPORTAL ID. The nomination letter names a
//      Merchant ID and a Terminal ID and calls neither of them Tranportal.
//      The terminal-level one is set below, which is what CBK usually means.
//   2. WHETHER ENGLISH IS 'EN' OR 'USA' — see `lang_en` further down.
//   3. WHICH CALLBACK STYLE this Tranportal ID gets — see `callback_response`.
//      The shipped default answers both styles at once, so this one is already
//      safe; the other two are not.
//
// Keep config.php out of public access (see .htaccess). Never commit real
// credentials.

return [
    // 'test' or 'production'
    'env' => 'test',

    // WHICH INTEGRATION — PINNED, not worked out.
    //
    // Left out, knet_mode() decides for itself: legacy whenever the Tranportal
    // block below could actually take a payment, official otherwise. That
    // default exists so a shop that never finished this setup still gets a
    // working card path, and it is the right behaviour for a shop that has not
    // decided. This one has.
    //
    // Pinning it means the shop cannot quietly change integration because a
    // credential was mistyped, blanked, or lost to a bad copy/paste: with
    // 'legacy' set, a broken Tranportal block is a broken Tranportal block and
    // says so, instead of silently becoming a CBK hosted page and taking money
    // through a route nobody was expecting.
    //
    //   'legacy'    the Tranportal integration in this file   <- Sporta
    //   'official'  the CBK hosted page as KNET (pay/config.php)
    'mode' => 'legacy',

    // ---- LEGACY TRANPORTAL ONLY. Ignored on the official path. ----
    // KNET hosted-payment endpoints (standard KPG URLs).
    'test_url'       => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
    'production_url' => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',

    // --- THE TRANPORTAL CREDENTIALS. This is what the shop pays through. ---
    //
    // THE ID IS THE TEST TERMINAL FROM THE NOMINATION LETTER. That letter gives
    // Sporta a merchant/terminal pair — merchant 6261, terminal 626101 — and
    // calls neither of them "Tranportal". The terminal-level number is set
    // here because that is the one CBK usually means; if the bank says it wants
    // the merchant-level number, change it to 6261. It is the only Tranportal
    // value this project has ever had written down, which is why it is the only
    // one filled in below.
    //
    // THE OTHER TWO HAVE TO COME FROM THE BANK. They have never been recorded
    // anywhere in this project, and neither of them is guessable:
    //
    //   tranportal_password  no format to infer, no copy kept.
    //   resource_key         EXACTLY 16 bytes — AES-128 takes nothing else.
    //                        knet_assert_key() throws on any other length and
    //                        the shopper gets "Payment init failed", so a
    //                        trailing space or newline from a copy/paste is a
    //                        dead card path. knet/selftest.php counts the bytes
    //                        for you; it is the fastest way to catch it.
    //
    // Until both are in, this dropin cannot complete a transaction. That is the
    // honest state and the self-test reports it as one, rather than falling
    // through to another gateway — see the note on 'mode' above.
    'tranportal_id'       => '626101',
    'tranportal_password' => 'YOUR_TRANPORTAL_PASSWORD',
    'resource_key'        => 'YOUR_TERMINAL_RESOURCE_KEY', // AES key, 16 bytes

    // --- Your URLs (KNET redirects the customer here) ---
    'response_url' => 'https://www.sporta.com.kw/knet/callback.php',
    'error_url'    => 'https://www.sporta.com.kw/knet/callback.php',
    // Final page in your React app:
    'result_page_url' => 'https://www.sporta.com.kw/payment/result',

    // action 1 = purchase, currency 414 = KWD.
    'action'        => '1',
    'currency_code' => '414',

    // OPEN QUESTION 2 OF 3. Ask the bank; the shop works meanwhile, in Arabic.
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

    // OPEN QUESTION 3 OF 3, and the one already answered safely: the default
    // below replies in BOTH styles at once, so it is right whichever style the
    // bank gives this Tranportal ID. Leave it alone unless they tell you.
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
