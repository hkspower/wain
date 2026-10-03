<?php
// Sporta — the Apple Wallet pass itself: building, signing, the two languages and the loyalty card.
// Shared by api/wallet.php (the customer downloads a card) and api/passkit.php (Wallet asks for the
// newest copy after a push), so both answer with exactly the same card. Moved here 2026-10-03.
declare(strict_types=1);

const WALLET_ORG            = 'Sporta';
// One point per 100 fils spent, on PAID orders only. Cash-on-delivery counts
// from the moment it is marked paid, not from when it was placed.
const WALLET_FILS_PER_POINT = 100;
const WALLET_TIER_SILVER    = 200;
const WALLET_TIER_GOLD      = 500;
// Where Wallet registers a card and asks for updates. Wallet appends /v1/...; passkit.php reads it
// as PATH_INFO, so no rewrite rule is involved. HTTPS is required by Apple.
const WALLET_WEB_SERVICE    = 'https://www.sporta.com.kw/api/passkit.php';
const WALLET_SITE           = 'https://www.sporta.com.kw';

/** The translations. Keys are what pass.json carries; Wallet shows the phone's language. */
function wallet_strings(): array {
    return [
        'en' => [
            'POINTS' => 'Points', 'MEMBER' => 'Member', 'TIER' => 'Level', 'SINCE' => 'Member since',
            'TIER_GOLD' => 'Gold', 'TIER_SILVER' => 'Silver', 'TIER_BASE' => 'Member',
            'CUSTOMER' => 'Sporta customer',
            'CHANGE_POINTS' => 'Your balance is now %@ points',
            'HOW' => 'How points work',
            'HOW_TEXT' => 'You earn 1 point for every 100 fils you spend at Sporta, counted when an order is paid. Silver from 200 points, Gold from 500.',
            'SHOP' => 'Shop', 'TRACK' => 'Track an order', 'CARD' => 'Your card online',
            'PHONE' => 'Call us', 'WHATSAPP' => 'WhatsApp', 'EMAIL' => 'Email',
            'DISCOUNT' => 'Discount', 'CODE' => 'Code', 'ENDS' => 'Ends', 'WHERE' => 'Where',
            'WHERE_TEXT' => 'Website and app', 'HOW_USE' => 'How to use it',
            'HOW_USE_TEXT' => 'Enter the code at checkout.', 'TERMS' => 'Terms',
        ],
        'ar' => [
            'POINTS' => 'النقاط', 'MEMBER' => 'العضو', 'TIER' => 'المستوى', 'SINCE' => 'عضو منذ',
            'TIER_GOLD' => 'ذهبي', 'TIER_SILVER' => 'فضي', 'TIER_BASE' => 'أساسي',
            'CUSTOMER' => 'عميل سبورتا',
            'CHANGE_POINTS' => 'رصيدك الآن %@ نقطة',
            'HOW' => 'كيف تجمع النقاط',
            'HOW_TEXT' => 'نقطة واحدة لكل ١٠٠ فلس تنفقها في سبورتا، تُحتسب عند دفع الطلب. المستوى الفضي من ٢٠٠ نقطة، والذهبي من ٥٠٠.',
            'SHOP' => 'المتجر', 'TRACK' => 'تتبّع طلبك', 'CARD' => 'بطاقتك على الموقع',
            'PHONE' => 'اتصل بنا', 'WHATSAPP' => 'واتساب', 'EMAIL' => 'البريد الإلكتروني',
            'DISCOUNT' => 'الخصم', 'CODE' => 'الكود', 'ENDS' => 'ينتهي', 'WHERE' => 'أين',
            'WHERE_TEXT' => 'الموقع والتطبيق', 'HOW_USE' => 'كيف تستخدمه',
            'HOW_USE_TEXT' => 'أدخل الكود عند إتمام الطلب.', 'TERMS' => 'الشروط',
        ],
    ];
}

/** A .strings file: "key" = "value"; lines, UTF-16LE with a BOM, which every iOS version reads. */
function wallet_strings_file(array $table): string {
    $out = '';
    foreach ($table as $k => $v) {
        $esc = fn (string $s) => str_replace(['\\', '"', "\n"], ['\\\\', '\\"', '\\n'], $s);
        $out .= '"' . $esc((string) $k) . '" = "' . $esc((string) $v) . "\";\n";
    }
    return "\xFF\xFE" . mb_convert_encoding($out, 'UTF-16LE', 'UTF-8');
}

/** Points from what was actually paid, computed now — a stored balance can disagree with the orders. */
function wallet_points(PDO $db, string $phone): int {
    $pts = $db->prepare("select coalesce(sum(amount), 0) from orders where customer_phone = ? and payment_status = 'paid'");
    $pts->execute([$phone]);
    return intdiv((int) round(((float) $pts->fetchColumn()) * 1000), WALLET_FILS_PER_POINT);
}

function wallet_tier_key(int $points): string {
    return $points >= WALLET_TIER_GOLD ? 'TIER_GOLD' : ($points >= WALLET_TIER_SILVER ? 'TIER_SILVER' : 'TIER_BASE');
}

/** The back of the card: the owner's own contact details from /backends, only those that are filled in. */
function wallet_back_fields(PDO $db, bool $loyalty): array {
    $f = [];
    if ($loyalty) $f[] = ['key' => 'how', 'label' => 'HOW', 'value' => 'HOW_TEXT'];
    try { $c = store_setting($db, 'contact'); } catch (Throwable $e) { $c = []; }
    $phone = trim((string) ($c['phone'] ?? ''));
    $wa = preg_replace('/\D+/', '', (string) ($c['whatsapp'] ?? ''));
    $mail = trim((string) ($c['email'] ?? ''));
    if ($phone !== '') $f[] = ['key' => 'phone', 'label' => 'PHONE', 'value' => $phone, 'dataDetectorTypes' => ['PKDataDetectorTypePhoneNumber']];
    if ($wa !== '') $f[] = ['key' => 'whatsapp', 'label' => 'WHATSAPP', 'value' => 'https://wa.me/' . $wa,
        'attributedValue' => '<a href="https://wa.me/' . $wa . '">+' . $wa . '</a>'];
    if ($mail !== '') $f[] = ['key' => 'email', 'label' => 'EMAIL', 'value' => $mail, 'dataDetectorTypes' => ['PKDataDetectorTypeLink']];
    $f[] = ['key' => 'shop', 'label' => 'SHOP', 'value' => WALLET_SITE, 'attributedValue' => '<a href="' . WALLET_SITE . '">www.sporta.com.kw</a>'];
    $f[] = ['key' => 'track', 'label' => 'TRACK', 'value' => WALLET_SITE . '/track', 'attributedValue' => '<a href="' . WALLET_SITE . '/track">sporta.com.kw/track</a>'];
    if ($loyalty) $f[] = ['key' => 'card', 'label' => 'CARD', 'value' => WALLET_SITE . '/card', 'attributedValue' => '<a href="' . WALLET_SITE . '/card">sporta.com.kw/card</a>'];
    return $f;
}

/**
 * The loyalty card for one wallet_passes row, as pass.json. With an auth_token the card carries the
 * web service, so Wallet registers it and can be told to fetch a fresh copy when the points change;
 * without one (a shop that has not run migrate-wallet-web.php) it is the same card, just static.
 */
function wallet_loyalty_pass(PDO $db, string $teamId, array $row): array {
    $points = wallet_points($db, (string) $row['phone']);
    $name = trim((string) ($row['name'] ?? ''));
    $pass = wallet_common($teamId) + [
        'description'  => 'Sporta loyalty card',
        'serialNumber' => (string) $row['serial'],
        'barcodes'     => wallet_barcode((string) $row['serial']),
        'storeCard'    => [
            'headerFields'    => [['key' => 'points', 'label' => 'POINTS', 'value' => $points, 'changeMessage' => 'CHANGE_POINTS']],
            'primaryFields'   => [['key' => 'holder', 'label' => 'MEMBER', 'value' => $name !== '' ? $name : 'CUSTOMER']],
            'secondaryFields' => [
                ['key' => 'tier', 'label' => 'TIER', 'value' => wallet_tier_key($points)],
                ['key' => 'since', 'label' => 'SINCE', 'value' => substr((string) ($row['issued_at'] ?? date('Y')), 0, 4)],
            ],
            'backFields'      => wallet_back_fields($db, true),
        ],
    ];
    $token = (string) ($row['auth_token'] ?? '');
    if ($token !== '') {
        $pass['webServiceURL'] = WALLET_WEB_SERVICE;
        $pass['authenticationToken'] = $token;
    }
    return $pass;
}

/** Every file of the bundle, hashed and signed, returned as bytes. */
function wallet_build(array $pass, string $certDir): string {
    $files = ['pass.json' => json_encode($pass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];

    $assets = __DIR__ . '/wallet-assets';
    foreach (glob($assets . '/*.png') ?: [] as $png) {
        $files[basename($png)] = (string) file_get_contents($png);
    }
    if (count($files) < 4) store_fail('wallet_assets_missing', 500);

    // ONE CARD, TWO LANGUAGES (2026-10-03). Every label and fixed value in pass.json is a KEY, and
    // Wallet looks it up in the folder matching the phone's language — Arabic for an Arabic iPhone,
    // English otherwise. These two folders are the only sub-folders a pass may have; everything
    // else stays flat at the root (see the zip below).
    foreach (wallet_strings() as $lang => $table) {
        $files[$lang . '.lproj/pass.strings'] = wallet_strings_file($table);
    }

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
        // pass refuses to open, and it looks identical from outside. The one
        // exception Apple defines is <lang>.lproj/, for the translations.
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
        // The shop's header colour and its orange (2026-10-03, "fresh design"). The label orange is
        // the lighter one, because the brand's #e0561c is under 4:1 on this grey at Wallet's 11pt.
        'backgroundColor'    => 'rgb(45, 48, 52)',
        'foregroundColor'    => 'rgb(255, 255, 255)',
        'labelColor'         => 'rgb(247, 140, 80)',
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
