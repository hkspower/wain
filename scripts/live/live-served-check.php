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
    'assets/sporta-ui.css' => '77de0e480e717ea336c68b1e87970dba8e31064e45dab60241d5e70afaf3262e',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'cats/desktop/art-accessories-rtl.jpg' => '08617a0f5023129ea90da09540f8c6e4722fcc72924e594056c06cb5f36287be',
    'cats/desktop/art-accessories-rtl.webp' => '926b22b11421e5a0e81bcb3e1e6619a592d8bf76402f30ce05a673ce76a02e0a',
    'cats/desktop/art-accessories.jpg' => '91491c03ca84f65498edfd7aa8db36404f4c99823dc233109105f0bf1ebbd8d2',
    'cats/desktop/art-accessories.webp' => '38162a9734f10a82ac0b1885be174a60b9115eff96cf88762e4c820b67e7767e',
    'cats/desktop/art-men-rtl.jpg' => 'ab4d165245d5d50bdf16ba67ac1268c611d9cad20209a53cbf13796fdc7b8cb6',
    'cats/desktop/art-men-rtl.webp' => '9e1bb942996e728aced47c1cfa65a3abf487f5926c480461cb367943d5136922',
    'cats/desktop/art-men.jpg' => '68cb819e313d0149eefa85d8aefa6ef4869ea05160ce29962468939d2deb364c',
    'cats/desktop/art-men.webp' => '13995fb9dd598e9e68a4f0de9243da2b42e78f6904c439db0e93b4f04a83be6a',
    'cats/desktop/art-outlet-rtl.jpg' => '3f5276b670f951ea9a2b5440007a2edf53a6133209b153df7c754ae2d1ae3e10',
    'cats/desktop/art-outlet-rtl.webp' => '2cf370506d0d30868291a78be18488f9696b3c3c9002667531e65663f3e3d2f2',
    'cats/desktop/art-outlet.jpg' => '7f02d57a43770a5da30a243df69a7ed64774286cdc0131f2f3a1a810dbb81aa4',
    'cats/desktop/art-outlet.webp' => '50081a43bc9894f1907bd3b9a6b2431e4fd6345c0f5384a9bc1917fafb4095b5',
    'cats/desktop/art-women-rtl.jpg' => 'c901814b13af0a02156270ba19bbd88019348dc6f10b53917350c9312efa7b09',
    'cats/desktop/art-women-rtl.webp' => 'b45dfebed20fd59bb3a5efcd23d7475a356e6bed5e1a35b67b2551f0c01fb8aa',
    'cats/desktop/art-women.jpg' => '24178df244cdac1d291f52f198f799308184c2946b52cdd86b23d0a140f4ab35',
    'cats/desktop/art-women.webp' => 'b3b92348ba575234b19211f3e8fdaaf41ef74415e9df732632f693f0d0c43e0d',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories-rtl.jpg' => '97131d2847a5f95290f355f7e75f6bdc4aa96e661c425ed8dec71cea45187bb6',
    'cats/mobile/art-accessories-rtl.webp' => '1919da86b08414b27982c29e4441c68ea329fc4fb825346974e3a7e91cbb6d0c',
    'cats/mobile/art-accessories.jpg' => 'a7a0dabf5bc29c8557525a8c1811ef70e21ce9f0b71b1a722e72f1be2c4086e0',
    'cats/mobile/art-accessories.webp' => 'e2842f793aa8bb36c5f5dcd970b9042b2cad5b94fa7ba1227ac4b9a314da9b04',
    'cats/mobile/art-men-rtl.jpg' => 'ebf16ada833039662f7079fc30368e5cda4977e3decaf64cd7e86f26928cbb7e',
    'cats/mobile/art-men-rtl.webp' => '87b71fe4b31743f3a17e9a6aff2d9cf7683119a077810bee6bef7e556359efc1',
    'cats/mobile/art-men.jpg' => 'ae6ff098589f1a69e3ca523cd57d173817a23a3062639ea0540dc7ae05611b0c',
    'cats/mobile/art-men.webp' => '3a14b2959b4f28a42d5550486b85495aa5b85ae529ebaa183b4d5d00ba2a0ee7',
    'cats/mobile/art-outlet-rtl.jpg' => '7030e29c27f0f7f6a796815ef4f812bf15769e48a873b65010488d8e20f73d31',
    'cats/mobile/art-outlet-rtl.webp' => 'd2781449f8b0c7d3796edb1e105b0b318c8e7e6775c6d0c81c9230edc96adeab',
    'cats/mobile/art-outlet.jpg' => '734d5068f47f550c5ee7387ad84c73266f55df8124f3298b62b69eb82b35e1c8',
    'cats/mobile/art-outlet.webp' => 'd156c5abe8c041abd335ac9abcc243da96ab1943a9ad23ab86e6122a3700be53',
    'cats/mobile/art-women-rtl.jpg' => 'df8a769baf0b63bf48b1976491213d02642815ceed3070cc70c0f61daf5d16d2',
    'cats/mobile/art-women-rtl.webp' => '28d5433970f7b9976559b27bf0078dd15f7c9627f3c3b6c4b9056746965a403c',
    'cats/mobile/art-women.jpg' => 'd56ee387c37866592aa1644c408d9a7cb63aabf1483d720556f0337ac4caf67a',
    'cats/mobile/art-women.webp' => 'b49481bba35768175d71a325c3b7c8ea4656acfc30a37b2092b297029b22f28c',
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
