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
    'assets/no-photo.svg' => 'c2868571641e1f8abdde77497db4b5c85fa38a72a76ede28f02b3b82d5a0fa8f',
    'assets/sporta-dark.css' => 'db04390f4abd81905493f14a13fc56d3aa44e7cc47ccccdc20aeab5468b2f8a8',
    'assets/sporta-ui.css' => 'a47e173c689ea5516f577632e30ce49f07e071d586f5e682f7c981b9d5f3b58a',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'cats/desktop/art-accessories-rtl.jpg' => 'a6bdde8b27879c7ae32ee1cf9d70096b4d7d1b212101fd1a4f679e7937c87a77',
    'cats/desktop/art-accessories-rtl.webp' => 'e3e0220ea7a92a06328d22ffe596d2a1da45f7fb3928e90d3a4f61530f3217b6',
    'cats/desktop/art-accessories.jpg' => '7a6799f75a6f9d0114a17d6edc886688de23a93be120b0e605b14bb4b37d3af5',
    'cats/desktop/art-accessories.webp' => 'ffcf7c6ae94e77abb46be8af4a375a9cca3b5fc2c34ce671ba3f7c0d4ad43c43',
    'cats/desktop/art-men-rtl.jpg' => '84664f279a5396877fca35fb3b9c04000ad49dc62fa0bf58089389b8eeafeef2',
    'cats/desktop/art-men-rtl.webp' => 'e618ad328f0767146767fcc351b76b3acdca5712dae9c22d1fa9144e5b9242c4',
    'cats/desktop/art-men.jpg' => '3958e8934ca16bab761f75717b35a22aa32c9be0d0da9807020375cf6c75b034',
    'cats/desktop/art-men.webp' => '25350c76f61286b8937f94437e639b0d0eabc1ece123c3f2cf8ef48291a7010a',
    'cats/desktop/art-outlet-rtl.jpg' => '91f6839ce5d5782c21c1f47b70aeba6f38ee23ca08defb193b27e922846ac833',
    'cats/desktop/art-outlet-rtl.webp' => '1dad28b6b89c88dd83ed411ceaa4bcd41e4bde3ee812bd0fc403b74af1f91d7e',
    'cats/desktop/art-outlet.jpg' => '3b5cc84f3c50569787cbfe818b4be7914d34d113ca91abd6af03289ef8df23c5',
    'cats/desktop/art-outlet.webp' => '78ce5fc71ec6450a3733a3ebf46f9982c17990c4b81eae736d0b52e9096d0be9',
    'cats/desktop/art-women-rtl.jpg' => 'f68a146ad4e55ab25a5aeaff7c36ee7709b068d040b7b128e53fa6f3f7b5ed43',
    'cats/desktop/art-women-rtl.webp' => '5faa5a99226e99a57fcdccd3fd987668cb4581e2033341f1834b514a2c8464ad',
    'cats/desktop/art-women.jpg' => '4977f4af92f16addb0a78e15ac5d6068fe1d389945978a69156410b2f5b9c98e',
    'cats/desktop/art-women.webp' => '6fa502afaaf418a9c24c598a070af5b9d42ce91686042d045b3807df2d2c08bb',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories-rtl.jpg' => '9321dd5368e8e6ac83abb1eba61e5b285551c8cb4e809c37a45b34cfc91e3e00',
    'cats/mobile/art-accessories-rtl.webp' => '9b58d7c5943aeb35216192b7601383d23b3ec108e275b45553fc3fc75e6e0d10',
    'cats/mobile/art-accessories.jpg' => '36f54561e5841cd0298e43fbd769c3c366f17e0d576381bf2cb2558e8e776480',
    'cats/mobile/art-accessories.webp' => 'c7d678b1c57adecd718ad1bb426c2842193627a18c5898424299823a8c3162dc',
    'cats/mobile/art-men-rtl.jpg' => '5472ade6a1f4227df3d951ccf37fb8aa203f3077d187781447202f100f91c319',
    'cats/mobile/art-men-rtl.webp' => 'b3eea8e864f423d947dce4626ace70769b0b5550fc8157ce57f7eae026c38ca3',
    'cats/mobile/art-men.jpg' => 'ab0047b0f39e171c5e84300cbb3d244bba823a5b7fd627503545c319f685ca37',
    'cats/mobile/art-men.webp' => '419ff343ff34842daefc32a7a1814f81ccd6e78e5febb3596c481b8eaad7ae38',
    'cats/mobile/art-outlet-rtl.jpg' => '4c536b9b7aa0a81e56cb749a8dc70787b9a3b3f39db5b32fbaaa4d36917cbcb1',
    'cats/mobile/art-outlet-rtl.webp' => 'feefefc3096b881bb0c07903f85281f22f97911d1eeb2ab5871c413e946463b8',
    'cats/mobile/art-outlet.jpg' => 'f9a277a9ef074cfd632d01e6ff55e0e4a04931d75b2882664532e5dda82b7c37',
    'cats/mobile/art-outlet.webp' => '2b06f90848ed648ca6b37602bea23c96ee9cd23159abb679cba912a466010462',
    'cats/mobile/art-women-rtl.jpg' => '8fec953fe7c6aa7e005274d8acffd53c2d5909576f1a1a398fbf474f3eff6f97',
    'cats/mobile/art-women-rtl.webp' => '802706adcd7da4135e8148cad4d2de4231e7d144a4bfb49de6d5e45cbfb61247',
    'cats/mobile/art-women.jpg' => '795140678c4bc8b04798afc0b8b052b1e074e052f3e5b98714d26ddba5e7a15a',
    'cats/mobile/art-women.webp' => '33bb759715b7004615b23d097f3e4d74653d4d45cd92f880b2e924149c2916d5',
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
