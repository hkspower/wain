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

const WALLET_PASS_TYPE_ID = 'pass.kw.com.sporta.card';
const WALLET_ORG          = 'Sporta';
// One point per 100 fils spent, on PAID orders only. Cash-on-delivery counts
// from the moment it is marked paid, not from when it was placed.
const WALLET_FILS_PER_POINT = 100;

$db = store_db();
store_throttle($db, 'wallet', 60, 60);

$cfg = store_config();
$certDir = (string) ($cfg['wallet_cert_dir'] ?? dirname(__DIR__, 2) . '/wallet-certs');
$teamId  = (string) ($cfg['wallet_team_id'] ?? '');

$r = $_GET['r'] ?? '';

/** Every file of the bundle, hashed and signed, returned as bytes. */
function wallet_build(array $pass, string $certDir): string {
    $files = ['pass.json' => json_encode($pass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];

    $assets = __DIR__ . '/wallet-assets';
    foreach (glob($assets . '/*.png') ?: [] as $png) {
        $files[basename($png)] = (string) file_get_contents($png);
    }
    if (count($files) < 4) store_fail('wallet_assets_missing', 500);

    // manifest.json is SHA-1 of every file. Apple still specifies SHA-1 here:
    // it is an integrity list inside a signed envelope, not a security
    // boundary of its own.
    $manifest = [];
    foreach ($files as $name => $bytes) $manifest[$name] = sha1($bytes);
    $files['manifest.json'] = json_encode($manifest, JSON_UNESCAPED_SLASHES);

    $cert = $certDir . '/pass.pem';
    $key  = $certDir . '/pass.key';
    $wwdr = $certDir . '/wwdr.pem';
    foreach ([$cert, $key, $wwdr] as $needed) {
        if (!is_readable($needed)) {
            // 503, not 500: nothing is broken, the certificate simply is not
            // installed yet, and the difference matters to whoever reads the log.
            store_out([
                'error' => 'wallet_not_configured',
                'hint'  => "missing " . basename($needed) . " in {$certDir} — see WALLET.md",
            ], 503);
        }
    }

    $tmp = sys_get_temp_dir() . '/sporta-wallet-' . bin2hex(random_bytes(6));
    mkdir($tmp);
    try {
        file_put_contents("$tmp/manifest.json", $files['manifest.json']);
        $signed = "$tmp/signature.p7s";
        $ok = openssl_pkcs7_sign(
            "$tmp/manifest.json",
            $signed,
            'file://' . $cert,
            ['file://' . $key, (string) ($GLOBALS['wallet_key_pass'] ?? '')],
            [],
            PKCS7_BINARY | PKCS7_DETACHED,
            $wwdr
        );
        if (!$ok) store_fail('wallet_sign_failed', 500);

        // UNWRAPPING S/MIME PROPERLY. openssl_pkcs7_sign writes a MULTIPART
        // message: a preamble, the signed content as one part, and the
        // signature as another. Wallet wants the DER of that second part and
        // nothing else.
        //
        // Taking everything after the first blank line — the obvious reading —
        // yields the preamble plus both parts, base64-decodes to rubbish, and
        // openssl refuses it with "wrong tag". The pass looked complete and was
        // unopenable; the test is what said so.
        //
        // So: find the part whose headers name a pkcs7 signature, and decode
        // only its body.
        $smime = (string) file_get_contents($signed);
        $der = '';
        if (preg_match('/boundary="?([^";\r\n]+)"?/i', $smime, $m)) {
            foreach (explode('--' . $m[1], $smime) as $part) {
                // The MESSAGE headers say "protocol=application/x-pkcs7-signature"
                // too, so the preamble matches that string just as the real part
                // does. Taking the first match found the preamble, decoded "This
                // is an S/MIME signed message", and produced a pass that looked
                // complete and would not open. Every part is tried, and the one
                // that decodes to a DER SEQUENCE — 0x30 — is the signature.
                if (stripos($part, 'pkcs7-signature') === false) continue;
                $split = preg_split('/\r?\n\r?\n/', ltrim($part), 2);
                if (count($split) !== 2) continue;
                $try = (string) base64_decode(preg_replace('/[^A-Za-z0-9+\/=]/', '', $split[1]) ?? '', true);
                if ($try !== '' && substr($try, 0, 1) === "\x30") { $der = $try; break; }
            }
        }
        if ($der === '' || substr($der, 0, 1) !== "\x30") store_fail('wallet_sign_unwrap_failed', 500);
        $files['signature'] = $der;

        $zipPath = "$tmp/pass.pkpass";
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE) !== true) store_fail('wallet_zip_failed', 500);
        // FLAT. Every file at the root of the archive: a .pkpass with its
        // contents one directory down is the commonest reason a hand-built
        // pass refuses to open, and it looks identical from outside.
        foreach ($files as $name => $bytes) $zip->addFromString($name, $bytes);
        $zip->close();

        return (string) file_get_contents($zipPath);
    } finally {
        foreach (glob("$tmp/*") ?: [] as $f) @unlink($f);
        @rmdir($tmp);
    }
}

function wallet_common(string $teamId): array {
    return [
        'formatVersion'      => 1,
        'passTypeIdentifier' => WALLET_PASS_TYPE_ID,
        'teamIdentifier'     => $teamId,
        'organizationName'   => WALLET_ORG,
        'backgroundColor'    => 'rgb(43, 49, 56)',
        'foregroundColor'    => 'rgb(255, 255, 255)',
        'labelColor'         => 'rgb(226, 128, 63)',
        'logoText'           => 'SPORTA',
    ];
}

function wallet_barcode(string $message): array {
    return [[
        'format'          => 'PKBarcodeFormatQR',
        'message'         => $message,
        'messageEncoding' => 'iso-8859-1',
        'altText'         => $message,
    ]];
}

function wallet_send(string $bytes, string $filename): void {
    header('Content-Type: application/vnd.apple.pkpass');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($bytes));
    // A pass is personal and cheap to rebuild; caching one is how a customer
    // ends up holding somebody else's card from a shared proxy.
    header('Cache-Control: no-store, private');
    echo $bytes;
    exit;
}

// ------------------------------------------------------------------ loyalty
if ($r === 'loyalty') {
    if ($teamId === '') store_out(['error' => 'wallet_not_configured', 'hint' => 'set wallet_team_id in api/config.php'], 503);

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

    // Points from what was actually paid, computed now — a stored balance is a
    // balance that can disagree with the orders behind it.
    $pts = $db->prepare("select coalesce(sum(amount), 0) from orders where customer_phone = ? and payment_status = 'paid'");
    $pts->execute([$phone]);
    $spentFils = (int) round(((float) $pts->fetchColumn()) * 1000);
    $points = intdiv($spentFils, WALLET_FILS_PER_POINT);

    $db->prepare('update wallet_passes set points_at_issue = ? where serial = ?')
       ->execute([$points, $existing['serial']]);

    $pass = wallet_common($teamId) + [
        'description'  => 'Sporta loyalty card',
        'serialNumber' => $existing['serial'],
        'barcodes'     => wallet_barcode($existing['serial']),
        'storeCard'    => [
            'headerFields'    => [['key' => 'points', 'label' => 'النقاط', 'value' => $points, 'changeMessage' => 'رصيدك الآن %@ نقطة']],
            'primaryFields'   => [['key' => 'holder', 'label' => 'العضو', 'value' => (string) ($existing['name'] ?? 'عميل سبورتا')]],
            'secondaryFields' => [
                ['key' => 'tier', 'label' => 'المستوى', 'value' => $points >= 500 ? 'ذهبي' : ($points >= 200 ? 'فضي' : 'أساسي')],
                ['key' => 'since', 'label' => 'عضو منذ', 'value' => substr((string) $existing['issued_at'], 0, 4)],
            ],
            'backFields'      => [
                ['key' => 'how', 'label' => 'كيف تجمع النقاط', 'value' => 'نقطة واحدة لكل ١٠٠ فلس تنفقها في سبورتا.'],
                ['key' => 'shop', 'label' => 'المتجر', 'value' => 'www.sporta.com.kw'],
                ['key' => 'contact', 'label' => 'خدمة العملاء', 'value' => 'cs@sporta.com.kw'],
            ],
        ],
    ];

    wallet_send(wallet_build($pass, $certDir), 'sporta-loyalty.pkpass');
}

// ------------------------------------------------------------------- coupon
if ($r === 'coupon') {
    if ($teamId === '') store_out(['error' => 'wallet_not_configured', 'hint' => 'set wallet_team_id in api/config.php'], 503);

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

    $value = $d['type'] === 'percent'
        ? rtrim(rtrim((string) $d['value'], '0'), '.') . '%'
        : number_format((float) $d['value'], 3) . ' د.ك';

    $pass = wallet_common($teamId) + [
        'description'  => 'Sporta offer ' . $code,
        'serialNumber' => $code,
        'barcodes'     => wallet_barcode($code),
        'coupon'       => [
            'headerFields'    => [['key' => 'value', 'label' => 'الخصم', 'value' => $value]],
            'primaryFields'   => [['key' => 'code', 'label' => 'الكود', 'value' => $code]],
            'secondaryFields' => array_values(array_filter([
                $d['ends_at'] ? ['key' => 'ends', 'label' => 'ينتهي', 'value' => substr((string) $d['ends_at'], 0, 10)] : null,
                ['key' => 'where', 'label' => 'أين', 'value' => 'المتجر والتطبيق'],
            ])),
            'backFields'      => [
                ['key' => 'how', 'label' => 'كيف تستخدمه', 'value' => 'أدخل الكود عند إتمام الطلب.'],
                ['key' => 'terms', 'label' => 'الشروط', 'value' => (string) $d['label']],
            ],
        ],
    ];
    // Wallet greys an expired pass and drops it to the back of the stack, which
    // is what should happen to a finished offer.
    if ($d['ends_at']) $pass['expirationDate'] = substr((string) $d['ends_at'], 0, 10) . 'T23:59:59+03:00';

    wallet_send(wallet_build($pass, $certDir), 'sporta-offer.pkpass');
}

store_fail('not_found', 404);
