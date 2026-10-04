<?php
/**
 * Every image and every stylesheet, as the SERVER ACTUALLY SERVES THEM.
 *
 *   php /home/<user>/live-served-check.php
 *
 * READ-ONLY. It fetches files over the loopback and compares sha256 sums. It
 * writes nothing and prints no configuration value.
 *
 * WHY THIS IS NOT live-file-check.php. That one reads the files ON DISK and is
 * the right check for "did the publish land". This one asks what a VISITOR
 * receives, which is a different question and has bitten this project twice in
 * one day:
 *
 *   - LiteSpeed served a cached response for /cats/desktop/men.jpg for a while
 *     after the rule that produced it was deleted. Disk said one thing, the
 *     wire said another.
 *   - .htaccess decides Cache-Control and, for a while, decided that a
 *     hand-written stylesheet could be held for a week.
 *
 * So this compares the BYTES ON THE WIRE against the repository, one file at a
 * time, and reports anything that differs by name. A file whose sha matches is
 * a file the browser is genuinely getting.
 *
 * IT ALSO REPORTS THE CACHE HEADER FOR THE THREE STYLESHEETS, because a
 * stylesheet that is correct on the wire and cached for a week is a stylesheet
 * that is correct for nobody who visited yesterday.
 *
 * Two files are expected NOT to be reachable and are skipped rather than
 * counted as faults: api/wallet-assets/* sits behind a deny rule, which is
 * correct — those are pass artwork, not web assets.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$WANT = [
    'api/invoice-logo.png' => '5decec38069f6f60c48eec86f864a1da35574cb56627baf8641147aa91ba0434',
    'api/wallet-assets/icon.png' => 'f6558cf7c1697b039c3743de6b1db1d9f46ff97a969f2c072a8c85f1564a2c08',
    'api/wallet-assets/icon@2x.png' => '11408129ddc0a6775f0c80e72c10e3293d32490eb458062ace112c06cccd64fc',
    'api/wallet-assets/icon@3x.png' => 'd3a3ed93bfd3cfd430ee71ece2d5b246e8d653a187e985ad400003a32f8d7e3e',
    'api/wallet-assets/logo.png' => '6a5fae4d198dfb9307a73cced946f39470842d023ad7503fa94b20b08940dae8',
    'api/wallet-assets/logo@2x.png' => '73a07659c447d66227689c65115fe760fdb2bc34e6c2baf814c64ff1880cf1ab',
    'api/wallet-assets/logo@3x.png' => '3f4b4b4f14e8836427f16375ecf316c85f8dbbe07602cf526f1cc3db12175820',
    'api/wallet-assets/strip.png' => 'af6c9cccdcc479344c438628cd0b03397cb6a97fa52a5034eb1c35b243c3b2a3',
    'api/wallet-assets/strip@2x.png' => 'b96e1a773f8eeb632a583e69defae80270d858ff36c3cdb1a07bcef87fe9a758',
    'api/wallet-assets/strip@3x.png' => 'af6db34ab49e6b288fa76985ee13ce2880bb22960ea738453ae906802215e7c1',
    'apple-touch-icon.png' => 'e09977ffae1506c51d3c101cacb52794bc673ed51de5b65bb31ea8f814805109',
    'assets/driver.css' => 'bc0603c400d9165d10ba991c7cbfd26efbd63ee7e353b2ae73f572380f906d59',
    'assets/features.webp' => '951c8a807b0574183359700b7bf5901590ac16cc97b008770a4a10b99bfab1ad',
    'assets/index-TIUCmnwm.css' => '4c85029a7c26cdf79a3ca7520c0bfebe286a95f9bbcc33ad8a4908d81a145ad7',
    'assets/leaflet/images/marker-icon-2x.png' => '00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528',
    'assets/leaflet/images/marker-icon.png' => '574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437',
    'assets/leaflet/images/marker-shadow.png' => '264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da',
    'assets/leaflet/leaflet.css' => 'a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6',
    'assets/no-photo.svg' => 'c2868571641e1f8abdde77497db4b5c85fa38a72a76ede28f02b3b82d5a0fa8f',
    'assets/sporta-dark.css' => '7b9445725c3d0c8a3e01720914dc10d39b503248c598510b135043fbce0b9a7f',
    'assets/sporta-desktop.css' => 'b348262a6bdeefaebbaa56ae5b3c0b026cb0a5a9cffea03c3103d3e737766781',
    'assets/sporta-mobile.css' => '8db1c3db5b6c8240b636db8d4457423049cf5c7297ef5eda4cb2afdb973cc82f',
    'assets/sporta-ui.css' => '8f4e9477d74aa2738afe6c4b8e2409faa8f8ea0d1a0cdc63b353af56cf481163',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'cats/desktop/art-accessories-rtl.jpg' => '96fd2086140177b8b68462c8330196f4d727a620e5e5300bc1b720b59bd860b7',
    'cats/desktop/art-accessories-rtl.webp' => '2a79025e78494252a86638128771ff62c6868097aea21dfe3dc778433525a556',
    'cats/desktop/art-accessories.jpg' => '26ee83758d99c71fd825669c8978a531259d2ba7d6fcc7b6c2888ad55a0a04bc',
    'cats/desktop/art-accessories.webp' => 'f71a385a15848b9d12b5c7d5f0a2a887112b99c2a1e76101beb4fa375f9e163d',
    'cats/desktop/art-men-rtl.jpg' => '891fbfd2e2c0e64ce7911702cc1f6e070f2ef87ed4f9f77a31dedda888e901f5',
    'cats/desktop/art-men-rtl.webp' => '3a06b2f72a0de8267bbc710fb021f8f2505999e6e748e4a2c91734c86013462b',
    'cats/desktop/art-men.jpg' => 'd09608329feaf9a0a598879b288a8802e05a66dc87ff7874d4c125a64b368e85',
    'cats/desktop/art-men.webp' => '461010f966689934686528aa6e923f7f893fe2412aa9d0bb72794c7f20059465',
    'cats/desktop/art-outlet-rtl.jpg' => 'b10614d9cb2dc030fbb87f594d2d7436b1934eab70895dc129c090cec8312727',
    'cats/desktop/art-outlet-rtl.webp' => '9b2c69ad624ccbf54d59ecee37d0c4cee8fe33b92202fa9f35a79307d7a55df1',
    'cats/desktop/art-outlet.jpg' => 'e1586b45412f4676b74c89f63cce12a4930b27b14785507b19587f4b08118895',
    'cats/desktop/art-outlet.webp' => 'b0e3c909dfac982ccab789b53cdc1e77a869427d1edaff9f9ab71df19946cdd9',
    'cats/desktop/art-women-rtl.jpg' => '5b11526a1576240da927e1e8f7a9ad847385503b002fd55c31925262a632ad38',
    'cats/desktop/art-women-rtl.webp' => 'a8e33489667bf06325661435db242fa93d6b1802d172c8f84b41e78a8a2b42f5',
    'cats/desktop/art-women.jpg' => '93a2c1e15ffb0c0d5d520016dfca3a582146f3e53ff31feb02d62e606fd471c0',
    'cats/desktop/art-women.webp' => '8d0b6806e397738952c9f592c5ed94819d4df0065dcac6c156fb8dadf9ee06f3',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories-rtl.jpg' => '5b9e717f86a5ff4aad3f46ab86352a954483315b13dc4e43d2a0315ebda34505',
    'cats/mobile/art-accessories-rtl.webp' => '1183aed94d177cd4d75e974ebbe503ef4881ad2de78114bd31f833359b283d1a',
    'cats/mobile/art-accessories.jpg' => 'a5adae305363a5b7038c69dd254c168e20bc01eb36ba38902345655a60f6efde',
    'cats/mobile/art-accessories.webp' => '725c11e4cc8cefb949e280ef9726f1b6c19cbc81a2678e2b4279e6c12f17a780',
    'cats/mobile/art-men-rtl.jpg' => '1d6c9384faca405d660b1aca413d844533d6a58fcedb7ed077bb3c296b9c4651',
    'cats/mobile/art-men-rtl.webp' => 'a488cac2813b17ebc9e8423e890783ddbd3df935cbce09cd908f889e40077b96',
    'cats/mobile/art-men.jpg' => 'b910f31fbf5a2c527140bdd931fb9f90081cab825ac5d42b61d12fe39f926436',
    'cats/mobile/art-men.webp' => 'f6ecde86664c49a218f16ddc4f6eb4dd14dd523f0bc35de3deca7d64b8f7d216',
    'cats/mobile/art-outlet-rtl.jpg' => 'ec678c2970e078b04eea9b80d926dd54a3c2ca5e0b8f755e23b0f5eb32df2e16',
    'cats/mobile/art-outlet-rtl.webp' => '9629613c4d05951cd554275c821766611a47eb7bad7f9fc28120558e727feedf',
    'cats/mobile/art-outlet.jpg' => '46c60c678304d3efb846d2d7348d2049053e1596a008d942571c42b2ba0650c6',
    'cats/mobile/art-outlet.webp' => '7b881611eaaeff74eeef9c6111e76495f262dadafbde842e81a33eeace4465c2',
    'cats/mobile/art-women-rtl.jpg' => 'a74f669e07e952a9c8c2ed37d4a5976c57a3381909948c320893bfc3872609ff',
    'cats/mobile/art-women-rtl.webp' => 'd3a9dcbcf9f60ebfdc41856b2a4b8f42b13829f266f3af3b3080ad394ed84fd4',
    'cats/mobile/art-women.jpg' => 'e68dcf25597929ffdfa921c646bc8a5ca0059ec05b2a687ddbb377d9c93784fa',
    'cats/mobile/art-women.webp' => 'a1ba9d97071674119e3db6c5d31a3976930023b657757ff83809665c3c454267',
    'cats/mobile/infobar.jpg' => '3f737a054397e2946c175444e14c76c7eb2356dc81be7cd504afa05fb9494a16',
    'cats/mobile/infobar.webp' => '4f553a7affcdfdb7b367508df5b725d3ef8d000e676339e11a2b10958b9c19c8',
    'favicon-192.png' => 'f9b1c55f2c5d3b7201203c702bfebe871cf32fdfb7db6f9a0a6aac3688a56b6c',
    'favicon-32.png' => 'c2cec10309c45382d25a70804f4d3af38372d6a69365784a1e2236d9872dfb15',
    'favicon-maskable.png' => 'db212cac661a0b04f20eae91586c8362746ee1306c173aeb0c9b8f4a929a143f',
    'favicon.ico' => 'daf723149bfda1bcb80d87bbaa3be9bf1fa14499a980105bfbf1ca1cfa070a26',
    'favicon.png' => '7b8bd27d8419df1414bf61f6c5ddf250270541014795b0157e8641e7511080bd',
    'hero/desktop/bodybuilding-men.webp' => 'eb9c5cc2397dbc5fedbc5c020fba8eb41a76749e1a1497ebb509f7f6db6184e0',
    'hero/desktop/bodybuilding-women.webp' => 'fcfa07ca880e74a8c5d5d2f96d9e382a258624d379437abfd734740f27102dba',
    'hero/desktop/cardio-men.webp' => '60b2c3c1b67911eade3fb0db1f41b3e01f8d51927f7280398c765f1dc34dc56e',
    'hero/desktop/cardio-women.webp' => 'b50ad7ac7e3ed6774a05f72cb22da5605b0f2f245ab54638874e5e735097560f',
    'hero/desktop/crossfit-men.webp' => '4f74e7d6980048413343443e3c946bde35d45eace5721ae525105ac583b252dd',
    'hero/mobile/bodybuilding-men.webp' => '2254295a155bfc993b652a797fee64757a29a74e89567b00e9e721a46466cc86',
    'hero/mobile/bodybuilding-women.webp' => '065c7b00cf08390a1698179be2fc2be0f1f4c72b12b3cb5efba7a4a5c48ead80',
    'hero/mobile/cardio-men.webp' => '20cfd33e475b8edb9ca8138e5339a5b0e30a2dec479c0371719bc2aed9a85335',
    'hero/mobile/cardio-women.webp' => '5fa7332f877afee30941838cc3a3e446784c7cb3582705b3909ea847085fdde5',
    'hero/mobile/crossfit-men.webp' => '6efccef97d571ae3a22c504628d432aaa20605f72577fffb190744828c1be332',
    'logo-white.png' => '4e60bc404ce37d63e97b925814c902d1deb4322778953876fca096bb29925ffe',
    'logo-white.webp' => '2d282c40925a4a6d86ef9c64db289b7c5da6bf8927ec0d1ba3e1725f571ef2ce',
    'logo.png' => 'f1a4e558ac3da1500aef3847bead524db51e11cc47b70e50fee8c2fb3772ef95',
    'logo.webp' => '5143f087020d6e8739bc15a2fbe45b3ef580677eaf186aa7244c6f51b8130f34',
    'og-image.png' => '4e16efd818ad868e383340741353c00cc0aae5311d8af38d26cdac948926a42f',
];

$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Cache-Control: no-cache'],
        CURLOPT_TIMEOUT        => 45,
    ]);
    $res  = (string) curl_exec($ch);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $head = substr($res, 0, $hlen);
    $body = substr($res, $hlen);
    $cc = preg_match('/cache-control:\s*([^\r\n]*)/i', $head, $m) ? trim($m[1]) : 'NONE';
    return [$code, $body, $cc];
};

$same = 0; $differ = []; $missing = []; $skipped = 0;
$cssCache = [];

foreach ($WANT as $rel => $want) {
    // Deliberately not reachable, and that is correct — pass artwork, not a
    // web asset. Counting it as missing would train the reader to skim.
    if (strpos($rel, 'api/wallet-assets/') === 0) { $skipped++; continue; }

    [$code, $body, $cc] = $fetch($rel);
    if ($code !== 200 || $body === '') { $missing[] = $rel . '(' . $code . ')'; continue; }
    if (hash('sha256', $body) === $want) $same++;
    else $differ[] = $rel;

    if (substr($rel, -4) === '.css') $cssCache[] = basename($rel) . '="' . $cc . '"';
}

echo 'SERVED same=' . $same . '/' . (count($WANT) - $skipped)
   . ' differ=' . (count($differ) ? implode(',', $differ) : '0')
   . ' unreachable=' . (count($missing) ? implode(',', $missing) : '0')
   . ' skipped=' . $skipped . ':wallet-assets'
   . ' | ' . implode(' ', $cssCache)
   . "\n";
