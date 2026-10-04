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
    'cats/desktop/art-accessories-rtl.jpg' => '0a81aa0cb3fcae6aa8fabf250ce5fc96558c18e0675cea4f14caee916469088a',
    'cats/desktop/art-accessories-rtl.webp' => 'f9eba2e81448fad79efda7b2f394a4731d457d7df318f4031a6257143308a1b8',
    'cats/desktop/art-accessories.jpg' => '19d22654be977f73176022ad5f7dfa00f8027359c46ffb589617ee75823b6d0e',
    'cats/desktop/art-accessories.webp' => 'b3c319511ffff40f8ecd32c8bab940a2dccdf828b190a5aa70ce6ff96ddf11e8',
    'cats/desktop/art-men-rtl.jpg' => '39b017c386b1ae2ed940caa096559450afb915f2c46dc1bd5cda4abec944a376',
    'cats/desktop/art-men-rtl.webp' => 'd14051d831b82b3a4cae1fb2504f5c959005ea12e85a64007e64863bfdc8acb5',
    'cats/desktop/art-men.jpg' => '6a14f134e9a7dad0443ae9479e128ea0bf8e8ef6ed2883943f0ee477dcc56680',
    'cats/desktop/art-men.webp' => 'd5a7a6efb1a6ef6d10f85e435486d80a2e09a34946c236587ba56cdb8c7f5a3c',
    'cats/desktop/art-outlet-rtl.jpg' => '6afa1f325b10cade2e6ba6cfd82fe044697c6085e172e22fffa54514a0e03b41',
    'cats/desktop/art-outlet-rtl.webp' => '4948660a9b0a2f982be2056bbaaa8fe4347165e7a06a115e0887e4d075300d86',
    'cats/desktop/art-outlet.jpg' => 'cdd15b163e64caf8332e972b2534e2a307117eaf2d2ff818282d55f96c6b991e',
    'cats/desktop/art-outlet.webp' => 'a93703cbb1566e9aaa5a06d65f5b562d2d65e0557855b08fd672c42b8e00a130',
    'cats/desktop/art-women-rtl.jpg' => 'a147411b119947df4f1981f63c535f28806da9e18c519afe69307f6afe2a13e3',
    'cats/desktop/art-women-rtl.webp' => 'df70c1faa2e92892842ea05327b6871332bc3517f6068e2f28d7da20ab9b3dcc',
    'cats/desktop/art-women.jpg' => 'e079f6f73e25e6f28970f71faea4fada8262e7ed0edc923a1551d33fd822529b',
    'cats/desktop/art-women.webp' => 'f22d620da25df01de3e16a37f4bcbcf755dae357e06e505bfad5626d2dd59e77',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories-rtl.jpg' => 'f89357498c0ac5ad792f44fbf2df0864a3bdbe33786fc466720c6bd086444d96',
    'cats/mobile/art-accessories-rtl.webp' => 'f3798c83227baa2e9b8c29558062f0c0bc1bc30fb0be3a9a78d27c1a45543ace',
    'cats/mobile/art-accessories.jpg' => 'f738c742fc4a6f7df1b6794233c89880a970dc41d6d1444aa327c3d1217d4515',
    'cats/mobile/art-accessories.webp' => '604594abe9847284e92ce6b368a027ad66dcd2dcebc3a795cfabfa9e2a2c2487',
    'cats/mobile/art-men-rtl.jpg' => 'f509adb421fce3c09d0457b997af599e9b355cbe7d9b889301a5213e521463cd',
    'cats/mobile/art-men-rtl.webp' => '574a697aa248ccc6c825805813e15a97be0098e18afb35a794d84e31eab8eef6',
    'cats/mobile/art-men.jpg' => 'ceda77b0c1541c3810848905c42df0b82c744d10cdd6450e039ad6c92be4edd1',
    'cats/mobile/art-men.webp' => '6c86116ccf9f3979fe3abc2019fefc52ffde8d7dbde9d034448e9aeac4ffac63',
    'cats/mobile/art-outlet-rtl.jpg' => 'd721dcd43fedc98b9a620de94292fe84cb35520fa9e71ab7202c93c5ca63466f',
    'cats/mobile/art-outlet-rtl.webp' => '9e38b161bb8e9441a593fb602cbf7124e9a2ef2aee3b7cad3646ae22894ec7ff',
    'cats/mobile/art-outlet.jpg' => '19e66d99c9d04e9527ad0c1f99917da8e4827f4aa9ffbec4308be7815a164d80',
    'cats/mobile/art-outlet.webp' => 'd75da17224ba10947b699b69f9e57e97401d0cdbb4cbee3e1b77bf234c3c6286',
    'cats/mobile/art-women-rtl.jpg' => '9fece4dd56f09db43b6b81a2663b969e2bc1416e81d7e7577f23c3b4e8723a61',
    'cats/mobile/art-women-rtl.webp' => 'cb9102733ff42fbc99df9d818894bdb38bf8716d748d1d838b63ba8cc5b79f2a',
    'cats/mobile/art-women.jpg' => 'bac0b15e86bbe4685035bf091bdffab27789213d9218fe60ea2a3578863b52f3',
    'cats/mobile/art-women.webp' => '30f55756442e08cc806c29ecc25fa6b95ff6e994bd6c093f1441d34da99d275f',
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
