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
    'api/wallet-assets/icon.png' => '917dcf6dfdd56040ed8348a95013cfb440172ed7fbc46bf7c52f06283ec2e899',
    'api/wallet-assets/icon@2x.png' => '50551289fcaba883c8631682afa507bea7404365f569ea96cb3ea63c0566b167',
    'api/wallet-assets/icon@3x.png' => 'e36fa3f207528b49ba4a79ed377572e2b60584c0c0ff9510f9b3e36f0de284fd',
    'api/wallet-assets/logo.png' => '6a5fae4d198dfb9307a73cced946f39470842d023ad7503fa94b20b08940dae8',
    'api/wallet-assets/logo@2x.png' => '73a07659c447d66227689c65115fe760fdb2bc34e6c2baf814c64ff1880cf1ab',
    'api/wallet-assets/logo@3x.png' => '3f4b4b4f14e8836427f16375ecf316c85f8dbbe07602cf526f1cc3db12175820',
    'api/wallet-assets/strip.png' => 'ca429b12c9c550719f53050c9946ede2db1f094da6c98eee3d2b0fd592261c9f',
    'api/wallet-assets/strip@2x.png' => '954bcf27a6329e0cb73e23d9785994d59bf15eed31ba58c1c0c607714557400c',
    'apple-touch-icon.png' => 'e09977ffae1506c51d3c101cacb52794bc673ed51de5b65bb31ea8f814805109',
    'assets/index-TIUCmnwm.css' => '4c85029a7c26cdf79a3ca7520c0bfebe286a95f9bbcc33ad8a4908d81a145ad7',
    'assets/sporta-dark.css' => '6cb6561f1016f71b295b3355c0d606cbacffc31b45c9fa6a3e9396bc3b7e2204',
    'assets/sporta-ui.css' => '41e99c1871fb8912dd3f23bc3f9c5cf0f43591a21b12b286e07f28a2adafe3b4',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'cats/desktop/art-accessories.jpg' => '1cee64e54118fe98a94eb3de2b7f97048f6817ef1088dd5b7c8ecea4443aa91b',
    'cats/desktop/art-accessories.webp' => 'a7e54449453065791a2a6957eacbc5bf3b68a6a1d9dc98a75d681675037789b8',
    'cats/desktop/art-men-rtl.jpg' => '2e276b7b2d617ab57bc14701b7b8db49e1af3b76ff4f07fa2363117b8ef482e4',
    'cats/desktop/art-men-rtl.webp' => '61367f0f6443b49dc4eb7ba4c0d10411530e58571622067815dfc23f740fd1dc',
    'cats/desktop/art-men.jpg' => '6df018a24de144dc1927407aa79129fa598fedee1f3a8457339d3cafb437e957',
    'cats/desktop/art-men.webp' => 'a8ee4065d1416496c4e64b8b2dd56816e9030a1bd11f2be95e8ba2a39e301884',
    'cats/desktop/art-outlet.jpg' => '8622301ba6f192498f39c2c9bca2aa7604b31d242c0514e3bec86005a5fbb975',
    'cats/desktop/art-outlet.webp' => 'd4aada60e40e9c9c6e3eb5c122919eb18158fb430940c350d782d1566bb53fcb',
    'cats/desktop/art-women-rtl.jpg' => '5aeafae993bd468945f4948a79d081346623ee08467b2dab23f636752751508c',
    'cats/desktop/art-women-rtl.webp' => '7fe571f1b2f7fbacd199f4eae6442b746cc8810f045a97949b45a2066e233d81',
    'cats/desktop/art-women.jpg' => '991de921afc4179dd0abc7b4646424243da74e5fb717a2143cd74e2df46b91c1',
    'cats/desktop/art-women.webp' => '9320d54c717b55de111b9890de155abf9eef1d283e310874b012a2a3825841e1',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories.jpg' => 'bd9929fea23c397a2aa24f3067882a66084d5ce753365db27132baf34e56b71d',
    'cats/mobile/art-accessories.webp' => '636824191cfa0932b795fc32dc077e6f197c555f089764417301c548ab15168b',
    'cats/mobile/art-men-rtl.jpg' => '8bb3562615ee66732007e3a7be02810923cf45f92335042e8cfa25cf91930b4c',
    'cats/mobile/art-men-rtl.webp' => 'dc0ef66837e493d8ae617d12dde39aa73797d2ef6e0f1ec0c82e9c4259f32624',
    'cats/mobile/art-men.jpg' => '88c0b2ed9f36825124067ff347d5ed4c2311400440f37d9f5ec6d057114e142a',
    'cats/mobile/art-men.webp' => '33f29d1b6cb4ab601cad5f68fcdb0ea0fdcbe349de2d6dcacb0e8345dcf52500',
    'cats/mobile/art-outlet.jpg' => '40855d8ef7c97cf3a69ffb0623b599ac1c6f718128b5d41d00a681fa2c42003a',
    'cats/mobile/art-outlet.webp' => '2631d0a4d0f6c78d0bc8c6946571a476ae116ce46dd49fe8499c9b546a816f7c',
    'cats/mobile/art-women-rtl.jpg' => '94d502c99331d0055db9e2a96d31190dcd0378bac4366c7e5bfb4f1de265446f',
    'cats/mobile/art-women-rtl.webp' => 'afff771745db182498dca2355f0adbb0c1b7ba883e823a68eabd4e1da376163c',
    'cats/mobile/art-women.jpg' => '8d3d6a09de722763d7289f11a8d2e41fe5320f458ec30987761ed656da908803',
    'cats/mobile/art-women.webp' => 'eeb956ca92dd6af226cc5dc7d2591e43cd9ac55f1b3120bf8764903a8de2e7ba',
    'cats/mobile/infobar.jpg' => '3f737a054397e2946c175444e14c76c7eb2356dc81be7cd504afa05fb9494a16',
    'cats/mobile/infobar.webp' => '4f553a7affcdfdb7b367508df5b725d3ef8d000e676339e11a2b10958b9c19c8',
    'favicon-192.png' => 'f9b1c55f2c5d3b7201203c702bfebe871cf32fdfb7db6f9a0a6aac3688a56b6c',
    'favicon-32.png' => 'c2cec10309c45382d25a70804f4d3af38372d6a69365784a1e2236d9872dfb15',
    'favicon-maskable.png' => 'db212cac661a0b04f20eae91586c8362746ee1306c173aeb0c9b8f4a929a143f',
    'favicon.ico' => 'daf723149bfda1bcb80d87bbaa3be9bf1fa14499a980105bfbf1ca1cfa070a26',
    'favicon.png' => '7b8bd27d8419df1414bf61f6c5ddf250270541014795b0157e8641e7511080bd',
    'hero/desktop/bodybuilding-men.webp' => '619cf45e749830106a81cbc4e7846153319034b1ee1f09afd23f35f48ffb2aec',
    'hero/desktop/bodybuilding-women.webp' => '157f046e6a987199d94f2a77abc683faf80362b63572881bb5a99f85345613b5',
    'hero/desktop/cardio-men.webp' => 'c57816624920687f36eff47771c692956fb7554cdb71816dd5f158602556d7ba',
    'hero/desktop/cardio-women.webp' => '1bbf419d8f6fba16ccda266e56e5488487c64b2829406ecbbba5b837b5702d5c',
    'hero/desktop/crossfit-men.webp' => 'd405b8e7976a80a59a5a399f2c0b1ea0e45a05e7875a1c18341240e46a03c38c',
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
