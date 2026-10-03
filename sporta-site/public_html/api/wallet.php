<?php
// Sporta — issuing Apple Wallet passes.
//
//   /api/wallet.php?r=loyalty&phone=55512345&track=SP1A2B3C
//   /api/wallet.php?r=coupon&code=SUMMER24
//
// Answers with a signed .pkpass, which iOS installs directly. Nothing here
// renders a picture: the eight images are built once by
// scripts/wallet-assets.mjs and live in wallet-assets/ beside this file.
//
// ------------------------------------------------------------------ IDENTITY
//
// A loyalty pass carries a name and a points balance, so issuing one on a phone
// number ALONE would let anyone mint a card for any customer whose number they
// know — which in Kuwait is anyone who has ever been handed a receipt. The
// first issue therefore also wants the track_id of one of that phone's own
// orders: something only the customer has. Afterwards the pass exists and is
// returned unchanged, because by then it is the serial, not the phone, that
// identifies it.
//
// This is deliberately not a login. The shop has no customer accounts, and
// inventing one to protect a points balance would be a much larger thing than
// the thing it protects.
//
// ------------------------------------------------------------------- SIGNING
//
// A pass is signed with the Pass Type ID certificate from the shop's Apple
// Developer account. It lives OUTSIDE the web root next to config.php, and
// without it this endpoint answers 503 saying so rather than serving a file
// every iPhone will refuse. See WALLET.md.

declare(strict_types=1);
require __DIR__ . '/store.php';
// WALLET_PASS_TYPE_ID and the certificate helpers live there, shared with the
// /backends setup card, so the pass type the card checks for and the one this
// file signs as cannot drift apart.
require __DIR__ . '/wallet-setup.php';
// The card itself (building, signing, translations, the loyalty layout) — shared with passkit.php.
require __DIR__ . '/wallet-pass.php';

$db = store_db();
store_throttle($db, 'wallet', 60, 60);

$cfg = store_config();
$certDir = wallet_cert_dir($cfg);
// From the certificate when one is installed (Apple writes the team id into
// it, and the two must agree or iPhones refuse the pass); config.php otherwise.
$teamId  = wallet_team_id($cfg, $certDir);

$r = $_GET['r'] ?? '';


// ------------------------------------------------------------------ loyalty
// -------------------------------------------------------------- the balance
//
// The same points, as JSON, with NO certificate involved.
//
// Three reasons this exists rather than being a detail of ?r=loyalty:
//
//   1. THE CARD IS BLOCKED ON APPLE AND THE POINTS ARE NOT. Every ?r= route
//      here refuses with 503 wallet_not_configured until the shop's Pass Type
//      ID certificate is installed, which needs a paid Apple Developer
//      membership and a Mac. Until that day a customer who has spent money has
//      a balance nobody — including the shop — can see. The balance is a fact
//      about the orders table; only the .pkpass needs Apple.
//
//   2. ANDROID. A .pkpass is an iOS file. Most of Kuwait is not on an iPhone,
//      and handing those customers a download they cannot open is worse than
//      telling them their balance in the page.
//
//   3. THE WEB PAGE HAS TO SHOW SOMETHING BEFORE IT OFFERS A DOWNLOAD. /card
//      asks for a phone number and an order reference; answering with a file
//      and nothing else means a customer who mistypes gets a 403 they cannot
//      read. This answers with the name, the points and the tier, and the
//      button appears after that.
//
// THE IDENTITY GATE IS THE SAME ONE, and it has to be: a balance carries the
// customer's NAME and what they have spent. Phone alone would let anyone read
// it for any number they have seen on a receipt, so a first look requires one
// of that phone's own order references, exactly as issuing the pass does.
//
// It deliberately does NOT create a wallet_passes row. Reading a balance is
// not issuing a card, and a row created by a lookup would make the "have they
// got the card yet" question unanswerable.
if ($r === 'balance') {
    $phone = store_phone((string) ($_GET['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');

    // THE ORDER REFERENCE IS REQUIRED EVERY TIME, and this is where ?r=balance
    // deliberately parts company with ?r=loyalty above.
    //
    // That route asks for a reference on the FIRST issue only, and afterwards
    // hands back the existing pass on the phone number alone — defensible,
    // because what it returns is a pass keyed to a serial, and the serial is
    // what identifies the holder from then on.
    //
    // This route returns a NAME and what that person has spent. There is no
    // serial in the answer and nothing about the second read is safer than the
    // first. Written the same way as the pass route — skip the check once a
    // wallet_passes row exists — it meant that the moment any customer took a
    // card, their name and spend could be read by anyone who knew their phone
    // number, which in Kuwait is anyone who has seen one of their receipts.
    // Caught by live-api-test.mjs, which asks for a known phone with no
    // reference and requires a 403; it answered 200 with the name in it.
    $track = trim((string) ($_GET['track'] ?? ''));
    $own = $db->prepare('select customer_name from orders where track_id = ? and customer_phone = ? limit 1');
    $own->execute([$track, $phone]);
    $found = $own->fetchColumn();
    if ($found === false) store_fail('order_not_found_for_phone', 403);

    $row = $db->prepare('select serial, name, issued_at from wallet_passes where kind = ? and phone = ? limit 1');
    $row->execute(['loyalty', $phone]);
    $existing = $row->fetch(PDO::FETCH_ASSOC) ?: null;

    // The name on the card wins where there is one — it is what the customer
    // will see on their phone, and a later order under a different spelling
    // should not make the page and the card disagree.
    $name = $existing['name'] ?? (string) $found;

    // Computed from the orders, never read from points_at_issue — that column
    // is a snapshot of what the last-issued pass SAYS, and the whole reason the
    // pass route recomputes is that a stored balance drifts from the orders
    // behind it. Reading it here would have made the page and the card
    // disagree the first time a customer ordered again.
    $pts = $db->prepare("select coalesce(sum(amount), 0), count(*) from orders where customer_phone = ? and payment_status = 'paid'");
    $pts->execute([$phone]);
    [$paidKwd, $orders] = $pts->fetch(PDO::FETCH_NUM);
    $spentFils = (int) round(((float) $paidKwd) * 1000);
    $points = intdiv($spentFils, WALLET_FILS_PER_POINT);

    store_out([
        'name'         => $name,
        'points'       => $points,
        'spent_fils'   => $spentFils,
        'paid_orders'  => (int) $orders,
        'tier'         => $points >= 500 ? 'gold' : ($points >= 200 ? 'silver' : 'base'),
        'next_tier_at' => $points >= 500 ? null : ($points >= 200 ? 500 : 200),
        'has_card'     => $existing !== null,
        // Whether ?r=loyalty can answer at all. The page uses this to decide
        // between offering the download and saying the card is not ready yet —
        // rather than offering a button that returns a 503 the customer reads
        // as the shop being broken.
        'card_ready'   => $teamId !== '' && is_file($certDir . '/pass.pem'),
    ]);
}

if ($r === 'loyalty') {
    if ($teamId === '') store_out(['error' => 'wallet_not_configured', 'hint' => 'link the Apple Developer account in /backends → Settings → Apple Wallet'], 503);

    // store_phone(), not a second normaliser. It strips 00965 and 965, checks
    // the Kuwaiti prefixes, and returns the number in the SAME form the orders
    // table stores — with the country code. Writing this again here got a 403
    // for a customer who plainly existed: the input was normalised to eight
    // digits and compared against a column holding eleven.
    $phone = store_phone((string) ($_GET['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');

    $row = $db->prepare('select * from wallet_passes where kind = ? and phone = ? limit 1');
    $row->execute(['loyalty', $phone]);
    $existing = $row->fetch(PDO::FETCH_ASSOC) ?: null;

    if ($existing === null) {
        // FIRST ISSUE ONLY: prove the phone is yours with one of its own order
        // references. Afterwards the pass exists and the serial identifies it.
        $track = trim((string) ($_GET['track'] ?? ''));
        $own = $db->prepare('select customer_name from orders where track_id = ? and customer_phone = ? limit 1');
        $own->execute([$track, $phone]);
        $name = $own->fetchColumn();
        if ($name === false) store_fail('order_not_found_for_phone', 403);

        $serial = 'SP-' . strtoupper(bin2hex(random_bytes(4)));
        $ins = $db->prepare('insert into wallet_passes (kind, serial, phone, name) values (?, ?, ?, ?)');
        $ins->execute(['loyalty', $serial, $phone, (string) $name]);
        $existing = ['serial' => $serial, 'name' => $name, 'issued_at' => date('Y-m-d H:i:s')];
    }

    // A token for Apple's update service, minted once per card (2026-10-03). Guarded: on a shop that
    // has not run migrate-wallet-web.php the column is missing, and the card is issued without live
    // updates rather than not at all.
    try {
        $tok = $db->prepare('select auth_token from wallet_passes where serial = ?');
        $tok->execute([$existing['serial']]);
        $token = (string) $tok->fetchColumn();
        if ($token === '') {
            $token = bin2hex(random_bytes(16));
            $db->prepare('update wallet_passes set auth_token = ?, updated_at = updated_at where serial = ? and auth_token is null')
               ->execute([$token, $existing['serial']]);
        }
        $existing['auth_token'] = $token;
    } catch (Throwable $e) { /* no column yet: a static card */ }
    $existing['phone'] = $phone;

    $pass = wallet_loyalty_pass($db, $teamId, $existing);
    $db->prepare('update wallet_passes set points_at_issue = ?, updated_at = updated_at where serial = ?')
       ->execute([(int) $pass['storeCard']['headerFields'][0]['value'], $existing['serial']]);

    wallet_send(wallet_build($pass, $certDir), 'sporta-loyalty.pkpass');
}

// ------------------------------------------------------------------- coupon
if ($r === 'coupon') {
    if ($teamId === '') store_out(['error' => 'wallet_not_configured', 'hint' => 'link the Apple Developer account in /backends → Settings → Apple Wallet'], 503);

    $code = strtoupper(trim((string) ($_GET['code'] ?? '')));
    if (!preg_match('/^[A-Z0-9]{3,24}$/', $code)) store_fail('invalid_code');

    // FROM THE DISCOUNTS TABLE, and only while it is live. A coupon in a
    // customer's Wallet that the checkout will refuse is worse than no coupon:
    // they find out at the till, in front of somebody.
    $q = $db->prepare("select * from discounts where code = ? and active = 1 and kind = 'code' limit 1");
    $q->execute([$code]);
    $d = $q->fetch(PDO::FETCH_ASSOC);
    if (!$d) store_fail('no_such_offer', 404);
    if ($d['usage_limit'] > 0 && $d['used_count'] >= $d['usage_limit']) store_fail('offer_used_up', 410);

    // A fixed discount is a CURRENCY field, so the phone writes "KWD 2.000" or "٢٫٠٠٠ د.ك." in its
    // own language; a percentage is the same in both.
    $valueField = $d['type'] === 'percent'
        ? ['key' => 'value', 'label' => 'DISCOUNT', 'value' => rtrim(rtrim((string) $d['value'], '0'), '.') . '%']
        : ['key' => 'value', 'label' => 'DISCOUNT', 'value' => (float) $d['value'], 'currencyCode' => 'KWD'];

    $pass = wallet_common($teamId) + [
        'description'  => 'Sporta offer ' . $code,
        'serialNumber' => $code,
        'barcodes'     => wallet_barcode($code),
        'coupon'       => [
            'headerFields'    => [$valueField],
            'primaryFields'   => [['key' => 'code', 'label' => 'CODE', 'value' => $code]],
            'secondaryFields' => array_values(array_filter([
                $d['ends_at'] ? ['key' => 'ends', 'label' => 'ENDS', 'value' => substr((string) $d['ends_at'], 0, 10) . 'T23:59:59+03:00',
                                 'dateStyle' => 'PKDateStyleMedium', 'timeStyle' => 'PKDateStyleNone'] : null,
                ['key' => 'where', 'label' => 'WHERE', 'value' => 'WHERE_TEXT'],
            ])),
            'backFields'      => array_merge(array_values(array_filter([
                ['key' => 'how', 'label' => 'HOW_USE', 'value' => 'HOW_USE_TEXT'],
                trim((string) $d['label']) !== '' ? ['key' => 'terms', 'label' => 'TERMS', 'value' => (string) $d['label']] : null,
            ])), wallet_back_fields($db, false)),
        ],
    ];
    // Wallet greys an expired pass and drops it to the back of the stack, which
    // is what should happen to a finished offer.
    if ($d['ends_at']) $pass['expirationDate'] = substr((string) $d['ends_at'], 0, 10) . 'T23:59:59+03:00';

    wallet_send(wallet_build($pass, $certDir), 'sporta-offer.pkpass');
}

store_fail('not_found', 404);
