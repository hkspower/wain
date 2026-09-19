<?php
/**
 * Which of the shop's images on the LIVE server differ from the repository.
 *
 *   php /home/<user>/live-image-check.php
 *
 * READ-ONLY, like live-scan.php and for the same reason: it is fetched over
 * plain HTTP from a public repository by a cron job, so anything it can do,
 * anyone who can influence that fetch can do. It stats and hashes files. It
 * writes nothing.
 *
 * WHY IT EXISTS. "Upload the images" is not a job until you know which images
 * are not already there. Fifty-one files at 2.1 MB cannot travel through the
 * cron command -- the ceiling is about 64 characters -- so each one that
 * genuinely differs costs a GitHub fetch on the server, and those fetches must
 * be SEQUENTIAL (three at once returned one good file and two empty ones). The
 * publish is the expensive half, and this makes it small: it names the files
 * that differ and says nothing about the ones that already match.
 *
 * The manifest below is the repository's answer, embedded because the server
 * has no checkout to compare against. IT IS GENERATED — `npm run
 * make:file-manifest` writes it and `npm run test:file-manifest` fails when it
 * drifts. Do not hand-edit it.
 *
 * IT USED TO SAY "regenerate it from public_html with find | sort | xargs
 * sha256sum", and that is a step a person has to remember every time, for ever.
 * It was not remembered. The hero/mobile entries went TWO generations stale, so
 * a run reported `differ=5` on five files the server had exactly right — and
 * the obvious response to that report is to publish them, which is what I did.
 * Nothing was wrong anywhere except in this list.
 *
 * live-file-check.php had the identical fault and was generated on 2026-09-10;
 * the fix was not carried across because nobody asked how many hardcoded
 * manifests there were. Six images were also missing from this list entirely,
 * so they had never been checked at all.
 *
 * ONE LINE of output, because cron returns only the last one.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

// path => sha256 in the repository.
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
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'cats/desktop/art-accessories.jpg' => '911167c5ed7d93a7ceb10d4d7e19124e64c9022ecf18fc7fce2e8b03918ec77a',
    'cats/desktop/art-accessories.webp' => '11db33701a7cc653907409e6cb0e1a880c26bc2c3e985308d00f7dfdec098fa4',
    'cats/desktop/art-men-rtl.jpg' => '6328496365bc0724247ddcc40c01a5ad52202c19d7f364bf3f1d7f52c997511e',
    'cats/desktop/art-men-rtl.webp' => '29858eda177209f75d1796c90e798de79f6e675accd239b984e17e8ce2c95e7d',
    'cats/desktop/art-men.jpg' => '2ee4fef26cdf4667a565141d2655b46584dcf1bdee7213e70bdfd467f5d116b8',
    'cats/desktop/art-men.webp' => 'f7e8a8002ac372143b56637ffe181f71acebaf00e741e067ecd4bc519bbbe77f',
    'cats/desktop/art-outlet.jpg' => '520868be8d7e6106db4e947b2d3ce828d3d444e08c79127669cefc740671ffd4',
    'cats/desktop/art-outlet.webp' => '3d35f12daaf4dfb82fe7d29aa9c4a6119f239145c1e65c525379287ae4bd3453',
    'cats/desktop/art-women-rtl.jpg' => 'e7480ce599e154f41abcd699fcd964c1f869bd5b8ac57cd666529213ae844406',
    'cats/desktop/art-women-rtl.webp' => 'e43e8107a12c5fb4c98dd4115bb22c84e80957348b403e1946ed1cf166c2f6f8',
    'cats/desktop/art-women.jpg' => 'c112320cd2fb4e46005d102a4b8fcdb2c4a16f1bc638482e6afba773ecd23760',
    'cats/desktop/art-women.webp' => '5e229721e464ea64894fcb41f2a73ed304360556015185a49df467f826d2451a',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories.jpg' => '1f5d8bc652e9983832904fd62010a3b61baae009b96c68f702628fb4663280f6',
    'cats/mobile/art-accessories.webp' => '50d77d35db0aaa62c83dd14ea39edbb4bdfb7f45b34e29911a85b416cac57fd6',
    'cats/mobile/art-men-rtl.jpg' => '81e4a80d66418eb1a6f9d3b23ff61c7c842125990e4d2c72a3ced95ae22663f3',
    'cats/mobile/art-men-rtl.webp' => 'ee5077e94b133aa71ec10f03fe2e95c48b98c7ee96840d3e158bde147e6e1541',
    'cats/mobile/art-men.jpg' => 'bf944a6fd28cfb728165249d3c9c0a8aff36f124cba1756b98b07a6df6ba6dfb',
    'cats/mobile/art-men.webp' => 'c951eac317c0bc7927ff1e7e501b96ba0a99ecf0b177a59633609b422354f769',
    'cats/mobile/art-outlet.jpg' => '884485d6fef4b55ef08afdf73e4fe77c14507b9db105c4cb4a554195ac97122c',
    'cats/mobile/art-outlet.webp' => 'e7b180b78f02ef9fc7f1cc376070c42d7508e062dbc3eb0fc5e92ee95417dfcf',
    'cats/mobile/art-women-rtl.jpg' => '5f6d6a54ee334c137164d8243b4902470918290a84d87ae4033553e891df094f',
    'cats/mobile/art-women-rtl.webp' => '35b26d9ccc04b0f332b38cc3d44ac49bec1528b796af9f973a25aa208270a785',
    'cats/mobile/art-women.jpg' => '17ea92c07c35388232b7cb0bcfe5c273d90797694c937b4ce576b1d2ffb37f14',
    'cats/mobile/art-women.webp' => '39f47a5bf0c652e5e8cdedc9386e74ffab3042dfc9241124f36b2cb105a6927b',
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

$same = 0; $diff = []; $miss = [];
foreach ($WANT as $rel => $sha) {
    $p = $ROOT . '/' . $rel;
    if (!is_file($p))                     { $miss[] = $rel; continue; }
    if (hash_file('sha256', $p) === $sha) { $same++; continue; }
    $diff[] = $rel;
}

// NAME them rather than count them: a count is a thing to worry about, a list
// is a thing to publish. Capped so one line stays one line.
echo 'IMG same=' . $same . '/' . count($WANT)
   . ' differ=' . (count($diff) ? count($diff) . ':' . implode(',', array_slice($diff, 0, 20)) : '0')
   . ' missing=' . (count($miss) ? count($miss) . ':' . implode(',', array_slice($miss, 0, 20)) : '0')
   . "\n";
