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
 * has no checkout to compare against. Regenerate it from public_html with
 * find | sort | xargs sha256sum over the image extensions.
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
    'cats/desktop/art-accessories.jpg' => '6851ebb777ae4a69bcf44b471d48c904ac5d5eb7d6db8a2a7cb7cb62843e9847',
    'cats/desktop/art-accessories.webp' => '76e935a6ff28385d70692fd77e4bccb0224ac7c62741f109d76e022f4b994c0f',
    'cats/desktop/art-men-rtl.jpg' => '218d84c097ed92afe7270414d01fc6b9450d5950a7bc58739629136edff6bbf4',
    'cats/desktop/art-men-rtl.webp' => '50818ba6650dc9ce77564dccd86ec9a358a417254278fe8b953a5dc4977eda9e',
    'cats/desktop/art-men.jpg' => '812b41cd23cd2b2cf9ec5bebc98f0a9f16aec57c3bd5ada86a902211876f4782',
    'cats/desktop/art-men.webp' => '03fb7be9e5011b91c00b03d927731d9ef9060acb8be015bc2a2ec072adfe4242',
    'cats/desktop/art-outlet.jpg' => '8c0675b4f9ed344d68e46ff7c168dc5b49b5877c4fd9ea3e58056a892f9ce7a1',
    'cats/desktop/art-outlet.webp' => '27a668c93acd01929865f1f34346b352060d4c77bcbed1e287066fb4455e5cf0',
    'cats/desktop/art-women.jpg' => 'c112320cd2fb4e46005d102a4b8fcdb2c4a16f1bc638482e6afba773ecd23760',
    'cats/desktop/art-women.webp' => '5e229721e464ea64894fcb41f2a73ed304360556015185a49df467f826d2451a',
    'cats/desktop/infobar.jpg' => '5e978224c01ac9ed1b6891b83efd31a5699573d0fdb8bc45405afb37d2b15b0c',
    'cats/desktop/infobar.webp' => '05ce17b021a12de9c72975cec0945dff86c9592db724387cda7e3c6ae2dbad41',
    'cats/mobile/art-accessories.jpg' => '9dcb9e5daff6eeaf1467a51d8a2edbc3648f2eea3f30a4105be9805957e8fd96',
    'cats/mobile/art-accessories.webp' => '8561f81b3072e7d974ba6ad33aae8ac6c88a3d0740d2793aff85736a6833b7ea',
    'cats/mobile/art-men-rtl.jpg' => 'bae72ff8416bce5b0a5ee11129738709f788ff868e13bcb29d3f3b5ad6729373',
    'cats/mobile/art-men-rtl.webp' => 'a012032744381a57058ef1fa798d623ce1f8a01d355e86ac062976f6d27228ca',
    'cats/mobile/art-men.jpg' => '6537b1c8233c9168661d625484da32f820511b913fb0deeb8d902dcd9f25d3c2',
    'cats/mobile/art-men.webp' => '4f097dd443fc8cbb24e4d6909e8e0ab8fec01f2ec2f8ec35b3e9be094404cdc3',
    'cats/mobile/art-outlet.jpg' => '451a9315fcf5aa0d2fa6f49f6511980776c31c78862a1da621e8fc7d4f1af219',
    'cats/mobile/art-outlet.webp' => '389d0ee80b953f2e49fdef0f91c80e3e6a238e316b4833be097b9c1d8036195b',
    'cats/mobile/art-women.jpg' => '17ea92c07c35388232b7cb0bcfe5c273d90797694c937b4ce576b1d2ffb37f14',
    'cats/mobile/art-women.webp' => '39f47a5bf0c652e5e8cdedc9386e74ffab3042dfc9241124f36b2cb105a6927b',
    'cats/mobile/infobar.jpg' => '3f737a054397e2946c175444e14c76c7eb2356dc81be7cd504afa05fb9494a16',
    'cats/mobile/infobar.webp' => '4f553a7affcdfdb7b367508df5b725d3ef8d000e676339e11a2b10958b9c19c8',
    'favicon-192.png' => 'f9b1c55f2c5d3b7201203c702bfebe871cf32fdfb7db6f9a0a6aac3688a56b6c',
    'favicon-32.png' => 'c2cec10309c45382d25a70804f4d3af38372d6a69365784a1e2236d9872dfb15',
    'favicon.png' => '7b8bd27d8419df1414bf61f6c5ddf250270541014795b0157e8641e7511080bd',
    'hero/desktop/bodybuilding-men.webp' => '619cf45e749830106a81cbc4e7846153319034b1ee1f09afd23f35f48ffb2aec',
    'hero/desktop/bodybuilding-women.webp' => '157f046e6a987199d94f2a77abc683faf80362b63572881bb5a99f85345613b5',
    'hero/desktop/cardio-men.webp' => 'c57816624920687f36eff47771c692956fb7554cdb71816dd5f158602556d7ba',
    'hero/desktop/cardio-women.webp' => '1bbf419d8f6fba16ccda266e56e5488487c64b2829406ecbbba5b837b5702d5c',
    'hero/desktop/crossfit-men.webp' => 'd405b8e7976a80a59a5a399f2c0b1ea0e45a05e7875a1c18341240e46a03c38c',
    'hero/mobile/bodybuilding-men.webp' => '5484ac27210d9ec63706411eae516d56c71a6c143645f24c3f4d775b6cf32823',
    'hero/mobile/bodybuilding-women.webp' => 'd0d210e2220e383110b47f79fbae40db8b02c162a3d673699018aee32f7ad236',
    'hero/mobile/cardio-men.webp' => 'bc0e59d337786202650af4325d032f92ebd71bb515853caef7b024c40d108d77',
    'hero/mobile/cardio-women.webp' => '0db9c09ecb41c1d6ed7473fe59efed3b3e68a3c525b0326f8f700be918bf8e66',
    'hero/mobile/crossfit-men.webp' => '4bfa626816516c805d31ab73170ff4b8dbe692570e6bc4ad835842c9b6311a38',
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
