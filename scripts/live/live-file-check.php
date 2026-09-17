<?php
/**
 * Which of the shop's files on the LIVE server differ from the repository.
 *
 *   php /home/<user>/live-file-check.php
 *
 * The whole docroot, not just the pictures — live-image-check.php answered the
 * same question for 51 images and this is that idea finished: every file the
 * repository tracks under public_html, compared by sha256.
 *
 * READ-ONLY, for the reason every script in this folder is: it is fetched over
 * plain HTTP from a public repository by a cron job, so anything it can do,
 * anyone who can influence that fetch can do. It hashes files. It writes none.
 *
 * WHAT IT DELIBERATELY DOES NOT KNOW ABOUT. config.php, wallet-certs/ and the
 * invoices are git-ignored — they hold the database password, the KNET and CBK
 * credentials and every customer's address — so they are not in the manifest
 * and are never reported as "missing". A file the repository does not track is
 * not a file the repository can be the truth about.
 *
 * ONE LINE, because cron returns only the last one. Names, not counts: a list
 * is a thing to publish, a number is a thing to worry about.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

// path => sha256 in the repository.
$WANT = [
    '.htaccess' => 'd1926b0d1e0af56c5a36bf6d74d6bac4ef8ae10db1e6915250fcd37d292de01d',
    'api/.htaccess' => '574ff6d3712c69ad6a119652dd976afbad0e065cec35c198ceed85bfc72c3be2',
    'api/accounting.mysql.sql' => '865458325a463d3127bbb45cb1a3d5c0c9a603c7656cdde85c280ffb7f8ed716',
    'api/accounting.php' => '0e508c851de94808626164518d8394e6c65508ec2733efd16be7a278b2825963',
    'api/admin.php' => 'e79216851d788a971d8a53b60fd81b05661d1c215401a8af8aeb914d5f796373',
    'api/antifraud.mysql.sql' => '861285918d5a45a38913a2cd3300b49d825e3a6691ea81411f31b6840808275e',
    'api/api.php' => '54c2f3120308fa010c5b489217f9cf25b7de55f73afafc8ea51d40016615cc57',
    'api/arabic.php' => 'ee95e3677275fe690cde28c627d98d32d903118ae9c4f418e0fb1dca65c72cd9',
    'api/assistant.mysql.sql' => 'c7d041e64a9576eeba376d9d1430f8b5f7f428547d175d73d65d0e62e6b6eeb9',
    'api/assistant.php' => 'f76fbd923ca4ac6935109d6cb0e1490f1aa96c882b4fdd3a19b056bd0a707acc',
    'api/assistantqa.mysql.sql' => 'd272b606f750484f5ea9981f63792c084cb7a1335f62624996fd303fc671c3b2',
    'api/attribution.mysql.sql' => 'bd9486d8589c699881329c7a9fba716cef49f916f5f9f7cf837944d4bfc5ef58',
    'api/brands.mysql.sql' => '7f781441054267db1cfb90a356cfdc8817d62d80670ced83d9ba0be047bba110',
    'api/config.example.php' => 'f5b82f908dc633d29cb4fe07bc15dd3a3bd6b8809636264f90d6244fdb5a30c7',
    'api/cron-assistant.php' => '08fde52104005ba3d6f27e7bb3d869a9707787f980ccf8825e5f73a7caf423c9',
    'api/cron-customer-mail.php' => '176405d4ee17e350153c95b8cd0e04871a0f45de5efa933cd8c454e3c077c43b',
    'api/cron-fulfilment.php' => '251160b5addcbdc16ccb59def843f714cd3774fa73b7d9ed502b7e8718d29c85',
    'api/cron-invoice.php' => '35728b4cbc7426bcbe298ced1ce7bd846fc38c3343bdb4e7024f06db9c6b9e9f',
    'api/cron-push.php' => 'c7509228f2a54cb066608951d3f6e65f5fcc2bf97eb535f3b40b7075880f378c',
    'api/cron-stock.php' => '2f973f33029efc16789e62cca382abc65f36788cbc8576ab3da2c6e081ccebbd',
    'api/cron-voice.php' => '900aaf3ac0b7b8b721dae0c6d9bba23f87112377c36947792c4f89b7a01e3083',
    'api/cron-whatsapp.php' => '6778175f64a3fb248799921da586199208d9fc2830d896655d234c7af4e6d9da',
    'api/customermail.mysql.sql' => '31ef14254b819d78830aa1ee3eb0865a93f42edb75aecc1c0deea42441393e7b',
    'api/deploy.php' => 'e3ab2a969bb4745a5f8b4b90e07d0881f08566b3757d216af0a2699ea12c01b7',
    'api/file-audit.php' => '3d06aee5230b780d0e3761133d5587888224ce6df3be8429a7a92aab63e1514e',
    'api/install.mysql.sql' => 'a2e3fc99c8286ee94fc176b256345b81bb111292fb99fc1af21cddb51deafbae',
    'api/invoice-file.php' => '06f5504344bc696d9d73b4c5f8a77c65c4acdcbdc6ada05ad9af90cab8c8878f',
    'api/invoice-pdf.php' => '24f04230a63a3e1d146f5025fb91d189991c64138df1ea27c6428f253dd4f01a',
    'api/itemname.mysql.sql' => '8b16e46110783e9ca4c540533b5f144261b74f831c0800ca98381c7ed05b9c6e',
    'api/orders-print.php' => '2ed932214d01a5ecd8224f635522342fc489b2158a8dd7cf46e9c1552b3ed73e',
    'api/payattempt.mysql.sql' => 'cdebb8e2a2a525b1c6471709b858201ec02257c594fd6bb93b494d494b035d6b',
    'api/pdf.php' => '9a026d1daf03dd2c45fc5a4f78f0c8f045973786b287e29e547f14961bedecb2',
    'api/productbrand.mysql.sql' => '1a5dc4c60f8d7fd7dbaf5d0ef742eb9c0ce3e23687a254d39344319f4672aab4',
    'api/productimage.mysql.sql' => '870f598114bf792d606893fa9be6cac075e79f2c752422a38a19e63e216bb06e',
    'api/promo.mysql.sql' => '7f64bb42ff96d0a3cf410031b48bcac6ae0e109f089cde59cbe2d1d22fd4177b',
    'api/push.mysql.sql' => '70c562de94012285f7af9a654376412bdd26c150d563d2cc3237cd6355c13e8f',
    'api/reviews.mysql.sql' => 'e0288b6470d6e974e9e8811de761b07268f09fe2dbab5bab392428c0c2d65c5a',
    'api/schema.mysql.sql' => '7095a95406bae97034bc67328bf7bae2e6736fddacd5ba8a62fe0d83cd8fb246',
    'api/seed.mysql.sql' => 'bd51a938063ff63d7fb381290c42196ffde93d9d5b065f5da6bac3d10b7f0d88',
    'api/site-manifest.txt' => '7bad0eb79062c86fcd33afdc034090bd07ef0d8c9a8c3564da116dd7a230942b',
    'api/sitemap-products.php' => 'b1217037868d973c566132ae778c3bacd4c5f89b9bd48035c6bc58942e0f360b',
    'api/sizeadvice.mysql.sql' => 'd4aa5746daa9d721839661586dfafd416fdbc9607c8fd33d83a1181531d070ac',
    'api/stock.mysql.sql' => '2568407818e9cd7d9f3eac06b8513ea20998b74e686e335ca8e84e82eba0bf34',
    'api/store.php' => '9f88de153f4b2270782a4aac39f435cd997bcb81b35337f0cf3f684ffd050a44',
    'api/totp.mysql.sql' => 'a6e7383ae32985a2dac5c75ead5533360bae4f8f78fa56217e6b9e37868c5e40',
    'api/wallet-assets/icon.png' => '917dcf6dfdd56040ed8348a95013cfb440172ed7fbc46bf7c52f06283ec2e899',
    'api/wallet-assets/icon@2x.png' => '50551289fcaba883c8631682afa507bea7404365f569ea96cb3ea63c0566b167',
    'api/wallet-assets/icon@3x.png' => 'e36fa3f207528b49ba4a79ed377572e2b60584c0c0ff9510f9b3e36f0de284fd',
    'api/wallet-assets/logo.png' => '6a5fae4d198dfb9307a73cced946f39470842d023ad7503fa94b20b08940dae8',
    'api/wallet-assets/logo@2x.png' => '73a07659c447d66227689c65115fe760fdb2bc34e6c2baf814c64ff1880cf1ab',
    'api/wallet-assets/logo@3x.png' => '3f4b4b4f14e8836427f16375ecf316c85f8dbbe07602cf526f1cc3db12175820',
    'api/wallet-assets/strip.png' => 'ca429b12c9c550719f53050c9946ede2db1f094da6c98eee3d2b0fd592261c9f',
    'api/wallet-assets/strip@2x.png' => '954bcf27a6329e0cb73e23d9785994d59bf15eed31ba58c1c0c607714557400c',
    'api/wallet.mysql.sql' => 'dc8f136251ee4a5071fa74785d50d3336042967d3a2a5ec7221f172c1c72086f',
    'api/wallet.php' => '54a91297ba7896ba76422253a2dc76e72f71b386a36beb4b9358b42f00e3d756',
    'api/webpush.php' => '8543031cc499b3a83cff042b142257ac6017111a829951c3354d84961f734194',
    'api/whatsapp.mysql.sql' => '7ea02f2f7a591ad1c0870e2f5ae25bf078a63a101c85f1eba412a3a8d895b4e2',
    'apple-touch-icon.png' => 'e09977ffae1506c51d3c101cacb52794bc673ed51de5b65bb31ea8f814805109',
    'assets/About-7p00QsGK.js' => 'af2b7e351d28a6e070836ac4c2da587f4d1d1dd302fb6fa927807ec349dfb9b5',
    'assets/AdminApp-Chmxw88_.js' => 'be965ff4bbafdd95ce6da2a5df977240a498c9dfa4e2ba8ce00f0b7c436a5875',
    'assets/AssistantPanel-Dx280GRS.js' => 'a64dcf99a568e8c5a494398e0467e8c83ec169f0342496505c607cb245be0bc4',
    'assets/Cart-B71Jo6gk.js' => 'ea09191791d9d90e0ffd1f41e32ab6667b58aabdb8c5ce415cf896c613ac40be',
    'assets/Checkout-Dk5_ETdy.js' => '82083f34a19e3c883c0c3a6df1da25be5983bf527022580efb313fb6221bd4be',
    'assets/CheckoutSteps-BfD7s0hA.js' => 'd09fafabec5b286d6688e29c542419aaf1b05eb86248ddbc9412979d509b4cf9',
    'assets/Contact-HoZaOGvS.js' => '31575cd174c01ad975ae06332c20b360610ef66f2e2819f18b7565ed587bae46',
    'assets/Invoice-BRGavJXu.js' => 'e252bee1bd62d91c320e7d12affde39cc56978814955d35686eb8e38d3fd48b5',
    'assets/LegalPage-AcD8bbsz.js' => '8f52d3679cf5af24a01f534f9f135f09f0cd31de6b46f836a08cdb1e236b87d0',
    'assets/NotFound-DEvLDlGt.js' => '73803504a2958fc1ec25069ece553095ca7825289988bfc6b75ae9030bceba07',
    'assets/OptionBox-QdtaBX6i.js' => '4107f677a8871951a043b7c61a1dc199d044fa752d9887ad5335b8f010222e23',
    'assets/PaymentResult-EPQCKPl1.js' => '22d3991b933543404a6234aa4b536b45cb69afbf2782260ca8ae763a04f4bcdc',
    'assets/Privacy-DHSjoBJx.js' => '8aafa16ef5ee529ad02954e3f66399f517d076bac0a3095d0087d100c3097f4f',
    'assets/ProductDetail-uh71XAH8.js' => '3118f4067666e307609888ea97585bb0baa1e06e814c331b0316356762086809',
    'assets/Returns-BlLemmCZ.js' => '92a128aea0325c8c4459f8979250f81abd08c2ee85fa0d74179c3135ca98c928',
    'assets/Review-DZ-PH_xP.js' => '8269a6c06b8d13feddcbdb13e13cc5086d8606499ebfc3b180fdf447a506357a',
    'assets/Shop-BYKJiDn8.js' => '043314b77465784908cb9bad60ef015bfaf7936c5a0b9e3b8ba3d35581ba4413',
    'assets/Terms-Be905VBP.js' => '0efa4abae517992511657d3303d31423e155ad43c482427a216cb92402989fe5',
    'assets/TrackOrder-Ceilajwu.js' => 'c540c743462dffdbf37cff3c864e046efe29b5c05b979a57fe634a88ec6f3fea',
    'assets/Wishlist-L8me8CrG.js' => 'aaa43222b82a3b6e1ac9f44240a325d513130b86f6dd6606b1cc9f9bad1928ac',
    'assets/admin-mobile.js' => '3fb1c97f6221b8b375c7b77a20808d7cee0461b29786fbc13389776b2c158be0',
    'assets/admin-upload.js' => 'a7325254d8357aa8ae12ba87d5e35f10f693b9ca42aa354e0145d0a37475a736',
    'assets/apple-signin.js' => '61b4fccc570888c821b0c16137f786e2dce3f09e518928ad768211dcc52b4fcf',
    'assets/assistant-icon.js' => '449958d4c49615a71e3e4ed3464bd42163ff0c37de01caea5f2824f559ca4f41',
    'assets/bidi-aEAFfM9w.js' => '2d2f9386b7166e9eb7fc75bc3aa85cbcb3f21037f75ae92894bb2570c4436424',
    'assets/brand-badge.js' => 'f3c44b8c5081f3f064dbd62a9df88651c7c020bd1689a62b227d5085257f7073',
    'assets/brand-logos.js' => '857b1af9d9c239ee99607155989c69ad2cfc514a24fa21413ed3653e5b7b9caa',
    'assets/brand-strip.js' => '6423d2046b973f6c91089cefb75bf409394616dfd5ca4730035c256aecc440ac',
    'assets/card.js' => '6e8712fd2937fea11079b67482edd88d58a5eec8b55cc5a34a86dc432dffbe35',
    'assets/checkout-CJW4l7Oz.js' => '77a829178518d422c4c4d9252e8cdae9e97739ac92156fce6dc2370f82f8c6f7',
    'assets/checkout-tap-targets.js' => 'f84c5b331be1dd1226d906dcc8823d590e97558ac47b4b55c0fe414a65c907b2',
    'assets/contact.js' => 'c154a029dbd881079b9d4b1781f9c87a476de65a4de4953247604c50441a8f11',
    'assets/custom-css.js' => '092fcbf6caf633611467a691aae25c3363842425a5f8254430ba0f9335ac53a4',
    'assets/essentials.js' => '50c0cefbeef79643137826e44561a839bf49d25b7e1a33b6750b2eed97ed4dee',
    'assets/footer.js' => 'ccae6f59425660d18636fd07983a082c436bcb62d6df1b4d4cb829905bf9c9f4',
    'assets/google-signin.js' => '707a762dded58b38de5e28e414211192b7a51a9222fd14d7fc3852d21a1715a2',
    'assets/index-5HbquisI.js' => '881eece4525a72074c514b348be352f5056e3f9030ed9900dc5cc02a2368306c',
    'assets/index-TIUCmnwm.css' => '4c85029a7c26cdf79a3ca7520c0bfebe286a95f9bbcc33ad8a4908d81a145ad7',
    'assets/invoices.js' => '4014c84e42538aae132ec42e63d05fb63c5147c6bdeef0ea0aa11670de845c2f',
    'assets/legal-editor.js' => 'c04da2e4c6d32b14de7a09833b936af8ac24645c8c65bcb694106f07374bc369',
    'assets/legal-pages.js' => '0137d5a0971698f000015a8077c2c20582b2a2681a95d06a110c239ff8884dcf',
    'assets/nav-menu.js' => 'fb7d1f67ba06a91e67f56ecee47714c2d85634cffa3f31fcbc3db9b7d5220ff3',
    'assets/panel-settings.js' => '074c93175d78474c4330b71cbebd4c54cdf7c13ebfe26e69b1a6da4ae2305d11',
    'assets/payment.js' => '7cec301599380fb22d8111eef86c54ed2cae61be6df558a0702cd66a36be8f32',
    'assets/product-photos.js' => '3e546264440c8871c3978080da4fcc94d7ae2053456b27c87db509765319e738',
    'assets/react-vendor-CMgvnOJB.js' => '3f36bbb7b4c6de3289643869a25c08e7ec7055ebaeef06d597b0fa301525d579',
    'assets/returns-link.js' => '07a9d4753e0120988fe95e43d618760cfde9a3b1cfdabb31b209b2ae8a01ce10',
    'assets/returns-request.js' => '3cc4b82d3fd70cdd6689f52d57894c679d48db2b3a45cc115b9b90b9d10ea830',
    'assets/rolldown-runtime-QTnfLwEv.js' => '5db5ba82eef00d1dee7e86e663098c9427d01183a88d357437daff295aec3e75',
    'assets/rules.js' => 'efb369e10c3ea3e5e5372d9e92954af2ea5c0f8f85af6c149ae0bc911eb01b2b',
    'assets/sporta-dark.css' => 'f58ef5b795b26010b49a806ed2741f83cd54f57aab09fbd46845af2ced8ab238',
    'assets/sporta-ui.css' => '00c92e3282034168151ee9e60da38dd97d75e232be5e6927814bf2b64071b03e',
    'assets/theme.js' => '2cf8b9f8d7306d6da217827e7b0f88e61a551d65296fad28518d2f2a4d84a205',
    'assets/tile-art.js' => 'b1eaba860e149fb78bb4ab9672e607e4b88f1ce8142dcfb8ae16fcafd6f7137c',
    'assets/track-guard.js' => '49c24cfaf6bf666dbc4488fc8c194dd2b031c8c86a891fe773faefa3ba1e4897',
    'assistant-bot.png' => '1968893e2c7ca2ca60dd0db259d0c62fb49da81928354ae5cb0eef1ee2a6bb0f',
    'assistant-bot.webp' => 'f23292794a840a37474a554499b97b19dd15ee0f42c8cd35c100fb157afc1a20',
    'card.html' => '078c10da1220676efe2e490dfc7f56ab7dca0c9951f115871086bb61f2c5045a',
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
    'config.js' => 'a85fd8085d3e71a73b06e8a136791f7965db0905a41890d9e0f783d5d3f6ebde',
    'favicon-192.png' => 'f9b1c55f2c5d3b7201203c702bfebe871cf32fdfb7db6f9a0a6aac3688a56b6c',
    'favicon-32.png' => 'c2cec10309c45382d25a70804f4d3af38372d6a69365784a1e2236d9872dfb15',
    'favicon-maskable.png' => 'db212cac661a0b04f20eae91586c8362746ee1306c173aeb0c9b8f4a929a143f',
    'favicon.ico' => 'daf723149bfda1bcb80d87bbaa3be9bf1fa14499a980105bfbf1ca1cfa070a26',
    'favicon.png' => '7b8bd27d8419df1414bf61f6c5ddf250270541014795b0157e8641e7511080bd',
    'fonts/Alexandria-400.ttf' => '29817527e857c0cf40b4b37f8f307c6f2fcc5044954868ae62455631aed1c124',
    'fonts/alexandria-var-arabic.woff2' => 'e8d8ca61d4da1a1a38b9454dbae92be589185efc7af0af6046f6a11c60476e99',
    'fonts/alexandria-var-latin.woff2' => '98ccec0bc3c456332f8fd0fcaf81d26a4e010b7fc093f9781938f976df9ffbc4',
    'fonts/plex-400-arabic.woff2' => 'dc558aa338ac16bc32fe2acc588adf257e3b3c5073a16d464bc29086b71006fe',
    'fonts/plex-400-latin.woff2' => '6107bc5f81236217957a2cf2c9b784080b632126099b02497b18058e67f2d63b',
    'fonts/plex-600-arabic.woff2' => '16734a5adb27b0f363e566cbbeacec480da0dc0baa19c8f0053251c2e2bc0eac',
    'fonts/plex-600-latin.woff2' => '63f4757271e403f7baec0862f284ffaa4560ea6096ba9fe8bc6e585ca656e724',
    'fonts/plex-700-arabic.woff2' => 'e0d84bfe093322d0d31c2bfb608c33981b75231cab81873a827e019b3e84b4e0',
    'fonts/plex-700-latin.woff2' => 'ad82e8d9d4f0f1d83efc6347f48fb0368c64c15303d971d9738c8f0227fb37d3',
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
    'images/README.txt' => '7a4aa1eedc240ba16a2fb5dea97b84fd1c02eea6a06aadc3baa2a12145f88c78',
    'images/ahed/PUT-LOGO-HERE.txt' => '17016da765f747fb1cb1839dadc9bb98d308104def94d6808f05f2c27e42de04',
    'images/ate/PUT-LOGO-HERE.txt' => 'd6b813220734f1af3c0f1dbcee1c099e10dfd007c53113a0ded12a9c6813effc',
    'images/eyesportwear/PUT-LOGO-HERE.txt' => 'f193ad1a6900793415dfa76098a5d134a7d3df21af834d075470273e24912168',
    'images/gymshark/PUT-LOGO-HERE.txt' => 'b30b0bfc1d9f91c28a82ff2664d7f20655e53ad724523107b64750d4d48c2a18',
    'images/nba/PUT-LOGO-HERE.txt' => '61d8f1501f5f308f7866e51dc07ae1a73244555f5963820d0a353538330e619d',
    'images/rheo/PUT-LOGO-HERE.txt' => 'a4b7c2a548abf314ae74fb2f658db993f589697428ce841feb93dee4bf2b16f1',
    'images/sporta/PUT-LOGO-HERE.txt' => '1a3a4e03d799fea20641304473e95ded5b25321badebbffc6d3988985b797300',
    'images/vanquish/PUT-LOGO-HERE.txt' => '7b634c7c39ee98859bfca99b0bcc1b41e536a1e1b74f42780435a244f39d36d1',
    'index.html' => '0b83161d66181449c91cd67c9dd1660be5cfcf0787e8f7d95585e6dfeabb14ce',
    'knet/.htaccess' => '75d8e990375bfd2c0e1f6304886d120aeb3676720d58ea2f40faabe224a6ba03',
    'knet/callback.php' => '4e217d7d4c8f59e6cce67b71ad9726297dcc83eb2c8dc2a08a56f95cc826d519',
    'knet/config.example.php' => '8b12abd7be354864ca71d69408462744c39a500a648110557aeddf13a30bad4c',
    'knet/knet.php' => '3320c512cfafd5273fa5f60a250fa0ec9938dcb81c3b5b8fe3bee07134198569',
    'knet/pay.php' => '6333fa7c407b9d279ec70270bf7ed1c845bd4a1a53398814d894fa7cd4247b35',
    'llms.txt' => '03153eaebba2b4f47670ce5dfeec4f0babee0f5313faf863ba786a5e32209faf',
    'logo-white.png' => '4e60bc404ce37d63e97b925814c902d1deb4322778953876fca096bb29925ffe',
    'logo-white.webp' => '2d282c40925a4a6d86ef9c64db289b7c5da6bf8927ec0d1ba3e1725f571ef2ce',
    'logo.png' => 'f1a4e558ac3da1500aef3847bead524db51e11cc47b70e50fee8c2fb3772ef95',
    'logo.webp' => '5143f087020d6e8739bc15a2fbe45b3ef580677eaf186aa7244c6f51b8130f34',
    'og-image.png' => '4e16efd818ad868e383340741353c00cc0aae5311d8af38d26cdac948926a42f',
    'pay/.htaccess' => '88334a62281adfacc9fff3d9696299a8be5f0336649a52553ce783d5781d818b',
    'pay/callback.php' => 'cd5a0a783d9a034921657e7b1bd6616f332345b0f70e130a16ba843968be1273',
    'pay/cbk.php' => '07224c44245fed0ebbfeb748a46c9dd7c37de3292327a81dec5d143e54af84af',
    'pay/config.example.php' => 'a1b8bbaf41ad52daa0f00cd0138660b16b490e00458a46f1a7e98330e63c242b',
    'pay/pay.php' => '172d1d33bed9170b5bee311b375d899d4d22cbb262da92f1893bd99bad9b11a5',
    'returns-request.html' => '4b756bbec77a1e522cfdaf2e6ea6a4ef68495da74cd2fc2a6c96ac1d0a44d48c',
    'robots.txt' => '6baf32979c4813f61a35491da2b18c012e638321d4f0a4be5cf1ec795b03d257',
    'seo.php' => '83137853c289d5bc485115e6c748b0d190feb758d7d2abdc7d3af8740d8a8fab',
    'site.webmanifest' => '2b7b841790a8f02340b140a51acebd5ea3a51001f0567214703e0a5f74589f08',
    'sitemap-pages.xml' => 'bce21049f7497a847368e836dfad55e1304d94a2b4dfda57fab3caf602a5c340',
    'sitemap-products.xml' => '9e135e56f4e79bd68c65ee0c764f3e979715c3ac463f39f79a1b625fa6cfb383',
    'sitemap.xml' => '1ba2a01e9f35e80a67b4b6047afcb5370b4005074a150ade4907a578cb0ebf4a',
    'sw.js' => 'b212f3186fb935c93851af92a026a50b5c3339020b456be47bf462ebcadf3062',
];

// FILES THAT MUST NOT BE ON A LIVE SERVER.
//
// README-FIRST tells the owner to delete these before going live. That list was
// SIX names long and five of them had not existed for months — and a list that
// is mostly wrong teaches you to skim it, which is dangerous when the one true
// entry is the one that matters. knet/selftest.php was really there, on a
// production shop, reporting the configuration without asking for a password;
// it was deleted on 2026-09-09 and this is what stops it coming back unnoticed.
//
// They are named here rather than only in prose because a check runs and prose
// does not. Each is a page anyone who knows the name can open: between them
// they created an admin account, changed the admin password, wrote the bank's
// credentials from a request, and reported the configuration.
$MUSTNOT = [
    'knet/selftest.php',
    'knet/setup-config.php',
    'api/setup-admin.php',
    'api/reset-admin.php',
    'api/preflight.php',
    'go-live.html',
];

/* Untracked paths that BELONG on the server. Everything else the walk finds is
   reported, so this list is the difference between a signal and noise.

   THE CHECKER USED TO ANSWER TWO QUESTIONS AND THERE ARE THREE. "What did we
   send wrong?" is `differ`; "what did we never send?" is `missing`; and the one
   nothing asked was "what is here that we never sent at all?" On 2026-09-10 it
   reported same=182/182 differ=0 missing=0 — a clean bill — while three
   untracked files sat in the docroot, one of them a 240-line endpoint that
   downloads artifacts and writes them into the web root. A manifest can only
   ever vouch for the files it lists. */
$EXPECTED_EXTRA = [
    // Credentials, git-ignored on purpose — the database password, the KNET and
    // CBK values. Their ABSENCE would be the fault; their presence is correct.
    'api/config.php', 'knet/config.php', 'pay/config.php',
];
// Whole subtrees that are the owner's data or the server's own, not the
// repository's: brand logos dropped in by hand, generated invoices, the Wallet
// signing certs, and anything staged outside public_html.
$EXPECTED_DIRS = ['images/', 'invoices/', 'api/wallet-certs/', 'storage/'];

/** Every file actually present under the docroot, relative to it. */
$walkAll = static function (string $root): array {
    if (!is_dir($root)) return [];
    $out = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($it as $f) {
        if (!$f->isFile()) continue;
        $out[] = ltrim(str_replace($root, '', $f->getPathname()), '/');
    }
    return $out;
};

$same = 0; $diff = []; $miss = [];
foreach ($WANT as $rel => $sha) {
    $p = $ROOT . '/' . $rel;
    if (!is_file($p))                     { $miss[] = $rel; continue; }
    if (hash_file('sha256', $p) === $sha) { $same++; continue; }
    $diff[] = $rel;
}

$present = [];
foreach ($MUSTNOT as $rel) {
    if (is_file($ROOT . '/' . $rel)) $present[] = $rel;
}

/* The third question. Anything on disk that the manifest does not list, is not
   a known credential file, and does not live under one of the owner's own
   subtrees. Reported by NAME, because a count would only prompt another run. */
$extra = [];
foreach ($walkAll($ROOT) as $rel) {
    if (isset($WANT[$rel])) continue;
    if (in_array($rel, $EXPECTED_EXTRA, true)) continue;
    foreach ($EXPECTED_DIRS as $d) { if (str_starts_with($rel, $d)) continue 2; }
    // A file on the MUSTNOT list is already reported, and better, above.
    if (in_array($rel, $MUSTNOT, true)) continue;
    $extra[] = $rel;
}
sort($extra);

/* A walk that finds nothing would report untracked=0, which reads exactly like
   a clean docroot. The manifest is proof the walk works: every tracked file
   should have been seen. */
$walked = count($walkAll($ROOT));

echo 'FILES same=' . $same . '/' . count($WANT)
   . ' differ=' . (count($diff) ? count($diff) . ':' . implode(',', array_slice($diff, 0, 25)) : '0')
   . ' missing=' . (count($miss) ? count($miss) . ':' . implode(',', array_slice($miss, 0, 25)) : '0')
   . ' mustNotBeHere=' . (count($present) ? count($present) . ':' . implode(',', $present) : '0')
   . ' walked=' . $walked
   . ' untracked=' . (count($extra) ? count($extra) . ':' . implode(',', array_slice($extra, 0, 25)) : '0')
   . "\n";
