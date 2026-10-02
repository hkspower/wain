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
    '.htaccess' => '3f84ce6611994eb157e2402188fa6e42d672464fea2fe745c7c925941e364290',
    'admin.webmanifest' => '2a36ff5a76af4f6e43877dad32f0a1ea3edc3b7afb8d3a5c06ef0897a979ca94',
    'api/.htaccess' => '574ff6d3712c69ad6a119652dd976afbad0e065cec35c198ceed85bfc72c3be2',
    'api/accounting.mysql.sql' => '865458325a463d3127bbb45cb1a3d5c0c9a603c7656cdde85c280ffb7f8ed716',
    'api/accounting.php' => '0e508c851de94808626164518d8394e6c65508ec2733efd16be7a278b2825963',
    'api/admin.php' => '7d5e4e2807a8a293f0afa69268248b80b38241c87d18ba9dc08e929c029c0952',
    'api/admindevices.mysql.sql' => 'ede4bf81432f368b9512dd6c2ef2a7139a5ccb4a603bc7aa60e0e378da4fde96',
    'api/adminloginlog.mysql.sql' => '15356b6c13cbc00e8e20cd60fd56415ec56ff877cd93242bd48ccdc75e2fbc2c',
    'api/adminreset.mysql.sql' => '006bf9cf2ccfb14a225761d3d81d083a7ad6ecec977f1c1b6b7ad8e4c64fcb14',
    'api/antifraud.mysql.sql' => '861285918d5a45a38913a2cd3300b49d825e3a6691ea81411f31b6840808275e',
    'api/api.php' => 'def444c877a954d188f595fd95011e0ed34cfbedc4759d2f1979a4935486de80',
    'api/arabic.php' => 'ee95e3677275fe690cde28c627d98d32d903118ae9c4f418e0fb1dca65c72cd9',
    'api/assistant.mysql.sql' => 'c7d041e64a9576eeba376d9d1430f8b5f7f428547d175d73d65d0e62e6b6eeb9',
    'api/assistant.php' => 'f76fbd923ca4ac6935109d6cb0e1490f1aa96c882b4fdd3a19b056bd0a707acc',
    'api/assistantqa.mysql.sql' => 'd272b606f750484f5ea9981f63792c084cb7a1335f62624996fd303fc671c3b2',
    'api/attribution.mysql.sql' => 'bd9486d8589c699881329c7a9fba716cef49f916f5f9f7cf837944d4bfc5ef58',
    'api/brands.mysql.sql' => '7f781441054267db1cfb90a356cfdc8817d62d80670ced83d9ba0be047bba110',
    'api/categoryart.mysql.sql' => '7773fd8278b03e92472a483e48879d5d26418868973513bc547f6040f7da872a',
    'api/config.example.php' => '139e99cd4d86122c4c085c7a4ecbc5dda3c80bd94ed85f935cdb502a9d942cfe',
    'api/cron-assistant.php' => '08fde52104005ba3d6f27e7bb3d869a9707787f980ccf8825e5f73a7caf423c9',
    'api/cron-customer-mail.php' => '176405d4ee17e350153c95b8cd0e04871a0f45de5efa933cd8c454e3c077c43b',
    'api/cron-fulfilment.php' => '251160b5addcbdc16ccb59def843f714cd3774fa73b7d9ed502b7e8718d29c85',
    'api/cron-invoice.php' => '35728b4cbc7426bcbe298ced1ce7bd846fc38c3343bdb4e7024f06db9c6b9e9f',
    'api/cron-push.php' => 'c7509228f2a54cb066608951d3f6e65f5fcc2bf97eb535f3b40b7075880f378c',
    'api/cron-stock.php' => '2f973f33029efc16789e62cca382abc65f36788cbc8576ab3da2c6e081ccebbd',
    'api/cron-voice.php' => '900aaf3ac0b7b8b721dae0c6d9bba23f87112377c36947792c4f89b7a01e3083',
    'api/cron-whatsapp.php' => '6778175f64a3fb248799921da586199208d9fc2830d896655d234c7af4e6d9da',
    'api/customer.php' => 'eae16955bfbcd262bf5e28a9f3e5a81de3325b55748ae170162c6f5bbd73c38e',
    'api/customermail.mysql.sql' => '31ef14254b819d78830aa1ee3eb0865a93f42edb75aecc1c0deea42441393e7b',
    'api/customernotes.mysql.sql' => '74d498958ca8f525da41a7ae6d626c937d31e642d997d8068b969b2f30fbca80',
    'api/customers.mysql.sql' => '13a8c34931a59eac904f28a06e2cdbee16f590ae00aa3fbc9e713216dbee8c9e',
    'api/deploy.php' => 'e3ab2a969bb4745a5f8b4b90e07d0881f08566b3757d216af0a2699ea12c01b7',
    'api/file-audit.php' => '3d06aee5230b780d0e3761133d5587888224ce6df3be8429a7a92aab63e1514e',
    'api/homebanner.mysql.sql' => '8303e5e0a028b4c8cef8261a174cb239504db4af603af95e7d844430cdc21ba7',
    'api/install.mysql.sql' => 'a2e3fc99c8286ee94fc176b256345b81bb111292fb99fc1af21cddb51deafbae',
    'api/invoice-file.php' => '06f5504344bc696d9d73b4c5f8a77c65c4acdcbdc6ada05ad9af90cab8c8878f',
    'api/invoice-logo.png' => '5decec38069f6f60c48eec86f864a1da35574cb56627baf8641147aa91ba0434',
    'api/invoice-pdf.php' => '922cbb4fe0c34e0d2655c2b54956d0c1f7df55d0ba6b537aad2b37800cedd2e9',
    'api/itemname.mysql.sql' => '8b16e46110783e9ca4c540533b5f144261b74f831c0800ca98381c7ed05b9c6e',
    'api/llms.php' => '03395a2a1a155f1aa1789d86c002638e16b799b3b822f6206665da0600277b04',
    'api/orders-print.php' => 'f3bdbae1b41058156c8f7eaf9770240c15b361d766c7357f463273d1f9cab54f',
    'api/payattempt.mysql.sql' => 'cdebb8e2a2a525b1c6471709b858201ec02257c594fd6bb93b494d494b035d6b',
    'api/payment-check.php' => 'fb136aad9492bc50e23665a1b54083a8d2b98aacdb1b3cb34277958e98d23bad',
    'api/pdf.php' => '8e1fd2ff13f0a3ac08e57f76db11301494c64e9d0ae711fa4a9277d411f72cbb',
    'api/photo-guess.php' => 'd6aeb9d520708dcb70fdc8b530c06b9d04e7148b130228c61002a33eaa4d86c0',
    'api/productattrs.mysql.sql' => '57b901286603246ad0f3477c0acb36613dfcafc4196c51fa572ca4a845ac881c',
    'api/productbrand.mysql.sql' => '1a5dc4c60f8d7fd7dbaf5d0ef742eb9c0ce3e23687a254d39344319f4672aab4',
    'api/productimage.mysql.sql' => '870f598114bf792d606893fa9be6cac075e79f2c752422a38a19e63e216bb06e',
    'api/productthumbs.mysql.sql' => '0751f5d5065b7f46740becd3105155faa01c3aae04108e831b6a588647352531',
    'api/promo.mysql.sql' => '7f64bb42ff96d0a3cf410031b48bcac6ae0e109f089cde59cbe2d1d22fd4177b',
    'api/push.mysql.sql' => '70c562de94012285f7af9a654376412bdd26c150d563d2cc3237cd6355c13e8f',
    'api/research.php' => 'f97e362c27a523035a86170d60bcd400b2793e3bff4344a3dc252330ad48dd11',
    'api/reviews.mysql.sql' => 'e0288b6470d6e974e9e8811de761b07268f09fe2dbab5bab392428c0c2d65c5a',
    'api/schema.mysql.sql' => '7095a95406bae97034bc67328bf7bae2e6736fddacd5ba8a62fe0d83cd8fb246',
    'api/seed.mysql.sql' => 'bd51a938063ff63d7fb381290c42196ffde93d9d5b065f5da6bac3d10b7f0d88',
    'api/site-manifest.txt' => '7bad0eb79062c86fcd33afdc034090bd07ef0d8c9a8c3564da116dd7a230942b',
    'api/sitemap-categories.php' => '60e9d9ad33532527687a2720323e99b3e0ef867ecbe6c13b40cc88de02092be6',
    'api/sitemap-products.php' => '3717da4de7b734411d72a2b5bd4d962e39e68334bfc9b0dc9a1bda37ce491bf9',
    'api/sizeadvice.mysql.sql' => 'd4aa5746daa9d721839661586dfafd416fdbc9607c8fd33d83a1181531d070ac',
    'api/stock.mysql.sql' => '2568407818e9cd7d9f3eac06b8513ea20998b74e686e335ca8e84e82eba0bf34',
    'api/stocklog.mysql.sql' => '3fba690958ceb6959f24fdd34a455e9fc34d6e8f8308a9dd53136eb76c900680',
    'api/store.php' => 'bf78baff7cdceb57e5660fe44476dcd9a80e15879c61b6ad9b594581456f9d86',
    'api/totp.mysql.sql' => 'a6e7383ae32985a2dac5c75ead5533360bae4f8f78fa56217e6b9e37868c5e40',
    'api/wallet-assets/icon.png' => '917dcf6dfdd56040ed8348a95013cfb440172ed7fbc46bf7c52f06283ec2e899',
    'api/wallet-assets/icon@2x.png' => '50551289fcaba883c8631682afa507bea7404365f569ea96cb3ea63c0566b167',
    'api/wallet-assets/icon@3x.png' => 'e36fa3f207528b49ba4a79ed377572e2b60584c0c0ff9510f9b3e36f0de284fd',
    'api/wallet-assets/logo.png' => '6a5fae4d198dfb9307a73cced946f39470842d023ad7503fa94b20b08940dae8',
    'api/wallet-assets/logo@2x.png' => '73a07659c447d66227689c65115fe760fdb2bc34e6c2baf814c64ff1880cf1ab',
    'api/wallet-assets/logo@3x.png' => '3f4b4b4f14e8836427f16375ecf316c85f8dbbe07602cf526f1cc3db12175820',
    'api/wallet-assets/strip.png' => 'ca429b12c9c550719f53050c9946ede2db1f094da6c98eee3d2b0fd592261c9f',
    'api/wallet-assets/strip@2x.png' => '954bcf27a6329e0cb73e23d9785994d59bf15eed31ba58c1c0c607714557400c',
    'api/wallet-setup.php' => 'f8f69743ceb3585393028f3d59db0dd1afdd199378e9c19db15954d61af73fc1',
    'api/wallet.mysql.sql' => 'dc8f136251ee4a5071fa74785d50d3336042967d3a2a5ec7221f172c1c72086f',
    'api/wallet.php' => '5415e4e690a3b09ec9bf5ba30930678f1a1ae72487d609b900c2d87fead3e741',
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
    'assets/activity-log.js' => '1b0ad44017ca9b6c94f1edaca3237f00f9706656f794e73d1df484faaab1fd26',
    'assets/admin-mobile.js' => '3fb1c97f6221b8b375c7b77a20808d7cee0461b29786fbc13389776b2c158be0',
    'assets/admin-upload.js' => 'b401829cda15417eb7f8ef8502c1f058eba8a05f4a1f3c6a6074a3fdf2a30b38',
    'assets/api-dedupe.js' => '1ea54fc042bb53a9ad1af782065e757b5136f6691d741ac8cdeb2802c292a7a8',
    'assets/apple-signin.js' => '5c7e39052ad9feb363e0147792fc69caff1de35c611710bc42f0ea487552c50b',
    'assets/assistant-icon.js' => '449958d4c49615a71e3e4ed3464bd42163ff0c37de01caea5f2824f559ca4f41',
    'assets/backup.js' => '54e649581f63bd10ba194242fe601bc65892db7b479ff7a3a8484c30563cd79c',
    'assets/bidi-aEAFfM9w.js' => '2d2f9386b7166e9eb7fc75bc3aa85cbcb3f21037f75ae92894bb2570c4436424',
    'assets/brand-badge.js' => '4467361bede7296f76ed12f1de1b358b83fd59e29b54121ef6d18c1379a9aa9f',
    'assets/brand-image-picker.js' => '12f369b7bcc96e31c2e2ccf446e7ad6bdbb40a28e7cd662bbb633eb6f9c6a667',
    'assets/brand-logos.js' => 'e0195c7480011ab284a70a738dcdb5d817a53872d97ba606e176081e10905a69',
    'assets/brand-strip.js' => '9e2c4ae3d55c1ee9e393eb15a3b3f0694b0f9b3929593ccca3fd4d811cce3f69',
    'assets/card-badges.js' => '2140aa40823461aa06da59a2338b91eb789ddfb380ec6a115ad771d646c31a02',
    'assets/card-heart.js' => '9768f49b782e63c2190ee2bfccf524b1c555ab76a99798e0684296ef6a80f4fe',
    'assets/card.js' => '6e8712fd2937fea11079b67482edd88d58a5eec8b55cc5a34a86dc432dffbe35',
    'assets/category-art.js' => '006bfce0325b78272735386ccb192f280c3b52d6eb1b8a32a513c9298dbbb89b',
    'assets/category-tiles.js' => 'f5b15ec381de0aa6eff490c9846cd8330d6e6188fc7936e9519d130b4d469aee',
    'assets/category-topbar.js' => '42fe8ed1f4a2fd767610bbca757d03bdbfbe5feea9cd77ccf8f23345bd4b51bd',
    'assets/checkout-CJW4l7Oz.js' => '77a829178518d422c4c4d9252e8cdae9e97739ac92156fce6dc2370f82f8c6f7',
    'assets/checkout-fields.js' => '8e8a1b13c731b5458ecc1e7f5617f73671641c87e3fd21a937a4ca082d7c0b11',
    'assets/checkout-speed.js' => 'bc24aac476c329229ed86526f715ab6cfb330ccf4a42e7cf51fae54a54ca5012',
    'assets/checkout-tap-targets.js' => 'f84c5b331be1dd1226d906dcc8823d590e97558ac47b4b55c0fe414a65c907b2',
    'assets/contact-emails.js' => '891af6643d1346da3162448bea85885e4ef6e21f0a803df87e64d565a8e811d7',
    'assets/contact.js' => '3a8fd66908f61d4e68fcac5241a8a2dd659b7069a19237177132577871a575ef',
    'assets/crm.js' => '1a7cb682e214d5fdd07b364cc15f66cf6b115cfe824a7623f287def587fc8fd0',
    'assets/custom-css.js' => 'ef8e440a043719ca3e43f6bcc32854396904c450200ff433a98e886b721793ab',
    'assets/customer-account.js' => '4dec48504de989a883397ddc0a559b0933b363fe10ea3dea73650c59f8f6c885',
    'assets/device-theme.js' => 'b00ba3a56a6a78030fb29fe7cfe3fca48e9725c30cb4807aa9134454a0fa64c3',
    'assets/essentials.js' => '50c0cefbeef79643137826e44561a839bf49d25b7e1a33b6750b2eed97ed4dee',
    'assets/first-admin.js' => '6a32ca37d71936f7783d9d4f436c385a69df36c78618ad30d1e70e78c81ef65f',
    'assets/footer-payment-icons.js' => '379ca6aa5813a9df61427d7aed82c101bc85417de9dd97e792e010b9a0ec5194',
    'assets/footer.js' => 'ccae6f59425660d18636fd07983a082c436bcb62d6df1b4d4cb829905bf9c9f4',
    'assets/force-password-notice.js' => '79f095525ce54694729e775e0c84c18f4be6991c402a04483bb55a1718d54c83',
    'assets/google-signin.js' => 'e66ab29ec70a794ffee0945c0fa69d50c30334ad90f56a56aa49ba12da58bd97',
    'assets/grid-name-fit.js' => '4793b09d658549075feb06f0b384b12327af386f7a6d21ef361eccbe15d74e09',
    'assets/hero-preload.js' => '7be10029881f8c43f750526ffcf3221e7262463e3c52b4fc54131149b4f0f04c',
    'assets/hero-slides.js' => '46a6898eed01fb5c19a9334f923610e726e8fd1fcb51d2d3bba16bd4eaf8cd7d',
    'assets/home-banner-editor.js' => '3c66d1ada309cf0b11bbd3ca133bd197d0ec292cc9e7a43b47d724001ad972bb',
    'assets/home-banner.js' => '7a81c78068aea5d3ba5996320cc8aa90c10d3d6fabb2796bca54643d77984a3d',
    'assets/home-products.js' => '893ad11b3b3daf6ccb1bb0321b0f799514c725b15079dc7d4ddb5b679abb6964',
    'assets/index-5HbquisI.js' => '881eece4525a72074c514b348be352f5056e3f9030ed9900dc5cc02a2368306c',
    'assets/index-TIUCmnwm.css' => '4c85029a7c26cdf79a3ca7520c0bfebe286a95f9bbcc33ad8a4908d81a145ad7',
    'assets/inventory-tools.js' => '75e09341fd3375e7a28a633ae42d91cd937ada9bc7386c507df9d4c283d3ce4b',
    'assets/invoices.js' => '4014c84e42538aae132ec42e63d05fb63c5147c6bdeef0ea0aa11670de845c2f',
    'assets/keyboard-hints.js' => 'b7a2cf8c8bc64de5998f5205f8a5e1696bd196e8f747f66275fc2af013ff5986',
    'assets/legal-editor.js' => '9f55b9f4095663afa525e00f2837bb5ffe8735be74b55b28074cd7dbdf7b58b6',
    'assets/legal-pages.js' => '0137d5a0971698f000015a8077c2c20582b2a2681a95d06a110c239ff8884dcf',
    'assets/login-log.js' => 'ec36b04dbb83525d48eab951785f74cf9b1063665862e0c1279655107934dfcc',
    'assets/nav-menu.js' => 'fb7d1f67ba06a91e67f56ecee47714c2d85634cffa3f31fcbc3db9b7d5220ff3',
    'assets/no-photo.svg' => 'c2868571641e1f8abdde77497db4b5c85fa38a72a76ede28f02b3b82d5a0fa8f',
    'assets/notification-center.js' => '87e8e5f0dcb5b303b144e9b40a637497170285395542a04104f471c5ce44f324',
    'assets/order-progress.js' => '798ad2c818119194ca661a853ea0e5fecce20e77b9de5b3bc7d55e390a9b830e',
    'assets/panel-save-bar.js' => '218d23abea78c85efc94e1bf0f3830c025a232e696b18ebe405ca053a9f02665',
    'assets/panel-settings.js' => '9c816c076d9115d5ddd4c365320789fe91238fdb902855822654b7b33a91a766',
    'assets/panel-tabbar-autocenter.js' => '5b313f6f88512e0ba33e7170d7e9f4e5f530a1b874944f96062ae573743d9d91',
    'assets/panel-tabbar-fade.js' => 'ae3f58547eec7b832159c72285eacae0c0b128adf719398b0d24dd539e535da6',
    'assets/panel-ux.js' => 'a2f956ae91db6f476028a13dc993b4f36fde65ae86f645d8109e9085061db550',
    'assets/passcode-login.js' => '35bf77668417aeda884f5c6dfe5c4cb78c379277c0b0ec45fa9d849cae84c683',
    'assets/password-reset.js' => 'd2c8ae3911f9e0a9acde809c81325b14e8e0d84ac267edecce9707f6849df9f6',
    'assets/payment.js' => '040e11fb1ad20bb5287e6df1da9f2181d8f3b70788c97005607382cb0ad59e5a',
    'assets/payments-screen.js' => '7fde733b287874c925ab91b3d5525b0e9f0b10bef90fe25fc17b9861379af5e5',
    'assets/product-attrs.js' => 'a737d3dfe647e114380de1c271b31768c28696599a9d880e780656880e9c2075',
    'assets/product-cards.js' => '63c037fecc9332bca5d39229824f959ec830a4488efa96981bfdb61bd40cdf81',
    'assets/product-mobile-layout.js' => '482120d0035374350500e1daeaf29862806264f11e43cb26bed2f6df51f154af',
    'assets/product-photos.js' => 'a21739795ae5267bbf0dde2956f0190e8e128405fd7e27ad4611517a8892f4f6',
    'assets/product-polish.js' => 'b0e7046e3e7c69a8370805e9fb3f9dd741d671116f46124c49abf3ee5acf558c',
    'assets/product-research.js' => '75c670733fbcbe5d0d2e6a5e121c5b3fd4f08c206d61d89b58e775c2200b6465',
    'assets/product-zoom.js' => '881bd8f6dd12c79a54b365ca6927326973f7c4fab2893b1c3cb112e815d23a5f',
    'assets/quick-add-size.js' => '22a90eb252e687a6f5d120c728c8ba50812544e580c4083beff48af730f5bb36',
    'assets/react-vendor-CMgvnOJB.js' => '3f36bbb7b4c6de3289643869a25c08e7ec7055ebaeef06d597b0fa301525d579',
    'assets/returns-link.js' => '07a9d4753e0120988fe95e43d618760cfde9a3b1cfdabb31b209b2ae8a01ce10',
    'assets/returns-request.js' => '13524131d58160089cf85e60781eeeb6ee188185e460af65a2d140e19d6af7a2',
    'assets/rolldown-runtime-QTnfLwEv.js' => '5db5ba82eef00d1dee7e86e663098c9427d01183a88d357437daff295aec3e75',
    'assets/rules-live.js' => '78c50e14c477a1f693c9d25ef75bf0db4ffa6a3a01fa18ca551a53cc0e02ad2f',
    'assets/rules.js' => '46350a2b1b9961f5b95b42afe61e4d6c895e9970be157d301efc0f53f25517ed',
    'assets/section-heads.js' => 'ea2d212ff7dfb31eca67ddfa423f5391e23e5efa11a4a8c00141b574f00f279f',
    'assets/site-strings.json' => 'a319870c331a4baf8ce21850fbf2d39755a75c9bf9e51d701272ab9d8f09a21c',
    'assets/site-text-editor.js' => 'cfdb78241d97b500dad6ebcc31754e39548b02d5bb39eaf62a65f7759855de85',
    'assets/site-text.js' => '1f14de76655611e43bd56e6f92f8eb16b9b420f872f18bed927b966aeba559b6',
    'assets/social-links.js' => 'a21ed1c9e267e994dc55a4cf29591654540bcb3aca8ba7fa39fbceb52228a79e',
    'assets/social-setup.js' => 'a6403def6f7f585e0dc58f356da47af4fc5530d10bffd06c923e823b1b83b007',
    'assets/sporta-dark.css' => '9a6172a002a4e9dcb44323af5faa19c39834e6d086ab2f78e862c173804cf9f6',
    'assets/sporta-desktop.css' => '56adebd9149c3e7dee9a5b2800cbfea429857c3d8eed139f982695983ddf93d7',
    'assets/sporta-mobile.css' => 'b5869f58b784db4b06fbdc2353a3f83b46aa8f405b7eba6039f9d77845f3e5c5',
    'assets/sporta-ui.css' => 'e71682386001ea718ccc2b74243182b29566bc8377bf6dcf505521b0481657fe',
    'assets/theme-colors.js' => 'ed913d1b97ccbef2f52c3f24ffe8fbeac31142894173a274014d4d1327d37811',
    'assets/theme.js' => 'd022ddb16f6ffa0aa5b5395428e28bbd71f5f8e16b3f62ed0c6bc49d6efcdb02',
    'assets/tile-art.js' => '389bc7006bac3b870cba78018d5eff080a5d960ee1492ef31f297cbc5fd5880d',
    'assets/track-guard.js' => '49c24cfaf6bf666dbc4488fc8c194dd2b031c8c86a891fe773faefa3ba1e4897',
    'assets/trust-strip.js' => 'fa5587f5162707334bdde584b3c911075bf125adbfce4f78721f350c69ab7915',
    'assets/wallet-setup.js' => '89f60d952feddbb7e107181077f086ae2585f7bc86def9d9c66db2404fb18c4d',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'card.html' => 'ec1132381b6f8e80dc105bce84cacab7388b2358faa9ae2c74fad8a7a00158f7',
    'category.php' => '5a7c09f7ea20bd27f1e68a524ec8c24c59f7dc58a20766ec23272c11e76bbad9',
    'cats/desktop/art-accessories-rtl.jpg' => '96fd2086140177b8b68462c8330196f4d727a620e5e5300bc1b720b59bd860b7',
    'cats/desktop/art-accessories-rtl.webp' => '2a79025e78494252a86638128771ff62c6868097aea21dfe3dc778433525a556',
    'cats/desktop/art-accessories.jpg' => '26ee83758d99c71fd825669c8978a531259d2ba7d6fcc7b6c2888ad55a0a04bc',
    'cats/desktop/art-accessories.webp' => 'f71a385a15848b9d12b5c7d5f0a2a887112b99c2a1e76101beb4fa375f9e163d',
    'cats/desktop/art-men-rtl.jpg' => '891fbfd2e2c0e64ce7911702cc1f6e070f2ef87ed4f9f77a31dedda888e901f5',
    'cats/desktop/art-men-rtl.webp' => '3a06b2f72a0de8267bbc710fb021f8f2505999e6e748e4a2c91734c86013462b',
    'cats/desktop/art-men.jpg' => 'd09608329feaf9a0a598879b288a8802e05a66dc87ff7874d4c125a64b368e85',
    'cats/desktop/art-men.webp' => '461010f966689934686528aa6e923f7f893fe2412aa9d0bb72794c7f20059465',
    'cats/desktop/art-outlet-rtl.jpg' => '3a753730ef5a75e4d41631081df8a2a132e7c55a875de6d56a539210dc451341',
    'cats/desktop/art-outlet-rtl.webp' => '021fb1c50b770cbe3c0c1115669abb4c8a14462e81f13cedb29827ee5f87e339',
    'cats/desktop/art-outlet.jpg' => '7c25532187dcef606979b753424b0a637a64df8e9175885f8a9514c05f5811a8',
    'cats/desktop/art-outlet.webp' => '9dea49d206dcc5be1ddbba052dcd25e1ecedc41744db0deeb720864e979120df',
    'cats/desktop/art-women-rtl.jpg' => '77a3dce9dca77b24bc60d2c8a8f7dd81e555b7d876fa9e3886a11dd61a201a89',
    'cats/desktop/art-women-rtl.webp' => 'e726da3ec8fb95612d2d13bb852b591c2bc5e0a033d27437a8685180edb401d3',
    'cats/desktop/art-women.jpg' => 'e25834648d1679416f03f2e097195a0586bfefffec76b621b3e78ce94dbcdb77',
    'cats/desktop/art-women.webp' => 'b7c465f2ecb630031178c373319d4d2e640ee82f9ec8f749a112a9d0a971e485',
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
    'cats/mobile/art-outlet-rtl.jpg' => '0e10542189327c2f551d8c29dd8ea8c1a32f9fb32bd9bee62658d0e90ad91660',
    'cats/mobile/art-outlet-rtl.webp' => '098d9c8f0f760bd632ffbc288a2893c292b0dac026790a91d9ce2092f4392d32',
    'cats/mobile/art-outlet.jpg' => '82913f83c0c8b2f9ec9578fdf4b6c31ca874d7398fa13eeb2881c3eddea9ae64',
    'cats/mobile/art-outlet.webp' => '6d798d0ea069ca5ffeb483a933347ad315b687659bb96700ea7a075135de8a1a',
    'cats/mobile/art-women-rtl.jpg' => '2b006395f39a25078f6bb10ef4742c86c7983c0743e05f61266821b59db75472',
    'cats/mobile/art-women-rtl.webp' => 'ce9370a2f1b95542620ce2600a32acb28741680dce5f9db98b1f722a0d019a9b',
    'cats/mobile/art-women.jpg' => 'e75dce70e4094b9cbad2b56b421c69d5f6dcb7a7ba73a8e468456a15e23c16f9',
    'cats/mobile/art-women.webp' => '5d7bdc1e3d89d3908b34d5d13b27370a0568783a9bde48254790a245b72503ad',
    'cats/mobile/infobar.jpg' => '3f737a054397e2946c175444e14c76c7eb2356dc81be7cd504afa05fb9494a16',
    'cats/mobile/infobar.webp' => '4f553a7affcdfdb7b367508df5b725d3ef8d000e676339e11a2b10958b9c19c8',
    'config.js' => 'a85fd8085d3e71a73b06e8a136791f7965db0905a41890d9e0f783d5d3f6ebde',
    'favicon-192.png' => 'f9b1c55f2c5d3b7201203c702bfebe871cf32fdfb7db6f9a0a6aac3688a56b6c',
    'favicon-32.png' => 'c2cec10309c45382d25a70804f4d3af38372d6a69365784a1e2236d9872dfb15',
    'favicon-maskable.png' => 'db212cac661a0b04f20eae91586c8362746ee1306c173aeb0c9b8f4a929a143f',
    'favicon.ico' => 'daf723149bfda1bcb80d87bbaa3be9bf1fa14499a980105bfbf1ca1cfa070a26',
    'favicon.png' => '7b8bd27d8419df1414bf61f6c5ddf250270541014795b0157e8641e7511080bd',
    'fonts/Alexandria-400.ttf' => '29817527e857c0cf40b4b37f8f307c6f2fcc5044954868ae62455631aed1c124',
    'fonts/Alexandria-700.ttf' => 'c35804961a1b2950ee1e79dbf655a9e0aba9fddce976e8b1e80691baa01f9314',
    'fonts/alexandria-var-arabic.woff2' => 'e8d8ca61d4da1a1a38b9454dbae92be589185efc7af0af6046f6a11c60476e99',
    'fonts/alexandria-var-latin.woff2' => '98ccec0bc3c456332f8fd0fcaf81d26a4e010b7fc093f9781938f976df9ffbc4',
    'fonts/anton-400-latin.woff2' => 'be92ffcb9f2ff3231264fff215f577ba1d17adb69055789de69e1e05bccbb6bc',
    'fonts/ibmplexsans-400-latin.woff2' => '730f2502851f12225074768006f611b528e88c975c2f6508071b3971149013d7',
    'fonts/ibmplexsans-600-latin.woff2' => '5cb23e0894f31ae130aaefac1fddddd29d3b69fcc1ec2c00980d2cf1b9f3c7b0',
    'fonts/ibmplexsans-700-latin.woff2' => 'a7c5e01259943728980dc4668f9a593430808ee95c8ee4faaeb21cd5e00e3b62',
    'fonts/plex-400-arabic.woff2' => 'dc558aa338ac16bc32fe2acc588adf257e3b3c5073a16d464bc29086b71006fe',
    'fonts/plex-400-latin.woff2' => '6107bc5f81236217957a2cf2c9b784080b632126099b02497b18058e67f2d63b',
    'fonts/plex-600-arabic.woff2' => '16734a5adb27b0f363e566cbbeacec480da0dc0baa19c8f0053251c2e2bc0eac',
    'fonts/plex-600-latin.woff2' => '63f4757271e403f7baec0862f284ffaa4560ea6096ba9fe8bc6e585ca656e724',
    'fonts/plex-700-arabic.woff2' => 'e0d84bfe093322d0d31c2bfb608c33981b75231cab81873a827e019b3e84b4e0',
    'fonts/plex-700-latin.woff2' => 'ad82e8d9d4f0f1d83efc6347f48fb0368c64c15303d971d9738c8f0227fb37d3',
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
    'images/README.txt' => 'dd1502a88b86ca0bc898489536e19f6cb36977eaab72624f96b2103af57e3ad7',
    'images/ahed/PUT-LOGO-HERE.txt' => '17016da765f747fb1cb1839dadc9bb98d308104def94d6808f05f2c27e42de04',
    'images/ate/PUT-LOGO-HERE.txt' => 'd6b813220734f1af3c0f1dbcee1c099e10dfd007c53113a0ded12a9c6813effc',
    'images/eyesportwear/PUT-LOGO-HERE.txt' => 'f193ad1a6900793415dfa76098a5d134a7d3df21af834d075470273e24912168',
    'images/gymshark/PUT-LOGO-HERE.txt' => 'b30b0bfc1d9f91c28a82ff2664d7f20655e53ad724523107b64750d4d48c2a18',
    'images/nba/PUT-LOGO-HERE.txt' => '61d8f1501f5f308f7866e51dc07ae1a73244555f5963820d0a353538330e619d',
    'images/rheo/PUT-LOGO-HERE.txt' => 'a4b7c2a548abf314ae74fb2f658db993f589697428ce841feb93dee4bf2b16f1',
    'images/sporta/PUT-LOGO-HERE.txt' => '1a3a4e03d799fea20641304473e95ded5b25321badebbffc6d3988985b797300',
    'images/vanquish/PUT-LOGO-HERE.txt' => '7b634c7c39ee98859bfca99b0bcc1b41e536a1e1b74f42780435a244f39d36d1',
    'index.html' => '295e405c890672f885ddaf7a3e95100122ae9411dca54bd64a4ff5f1519d8df8',
    'knet/.htaccess' => '75d8e990375bfd2c0e1f6304886d120aeb3676720d58ea2f40faabe224a6ba03',
    'knet/callback.php' => '4e217d7d4c8f59e6cce67b71ad9726297dcc83eb2c8dc2a08a56f95cc826d519',
    'knet/config.example.php' => '8b12abd7be354864ca71d69408462744c39a500a648110557aeddf13a30bad4c',
    'knet/knet.php' => 'b4bd650704200f122664dc54a29cef392ac2c1a9b377903df4efb483435605bc',
    'knet/pay.php' => '6333fa7c407b9d279ec70270bf7ed1c845bd4a1a53398814d894fa7cd4247b35',
    'llms.txt' => '7aef7e169cb23a1c7d76410bf823ef8fc76aecc78ad492650ec5f3e6b23359ca',
    'logo-white.png' => '4e60bc404ce37d63e97b925814c902d1deb4322778953876fca096bb29925ffe',
    'logo-white.webp' => '2d282c40925a4a6d86ef9c64db289b7c5da6bf8927ec0d1ba3e1725f571ef2ce',
    'logo.png' => 'f1a4e558ac3da1500aef3847bead524db51e11cc47b70e50fee8c2fb3772ef95',
    'logo.webp' => '5143f087020d6e8739bc15a2fbe45b3ef580677eaf186aa7244c6f51b8130f34',
    'og-image.png' => '4e16efd818ad868e383340741353c00cc0aae5311d8af38d26cdac948926a42f',
    'pay/.htaccess' => '88334a62281adfacc9fff3d9696299a8be5f0336649a52553ce783d5781d818b',
    'pay/callback.php' => 'cd5a0a783d9a034921657e7b1bd6616f332345b0f70e130a16ba843968be1273',
    'pay/cbk.php' => 'd504f874a288be6185cf6e647afa4e2b6f38f53dd1e1de923a97624ef1183c1e',
    'pay/config.example.php' => 'a1b8bbaf41ad52daa0f00cd0138660b16b490e00458a46f1a7e98330e63c242b',
    'pay/pay.php' => '172d1d33bed9170b5bee311b375d899d4d22cbb262da92f1893bd99bad9b11a5',
    'returns-request.html' => 'c60d4e4c7bdf9aaaddd9c4229a224f00c808b614221810f49df070a49ccd9540',
    'robots.txt' => 'ed67a89d55b4f88cec66dea500b3aa76c4d3838388ae93cdf6b015f11048d3e9',
    'seo.php' => 'c6fc3713fa9d83bdb90c2cab5be9c1aa68b7b82d4f50ef931d641b8cfd411ea8',
    'site.webmanifest' => '34169e10f86b2efbf13f3762961d394f9039b7904ffb2110e7525790a2e88779',
    'sitemap-pages.xml' => 'bce21049f7497a847368e836dfad55e1304d94a2b4dfda57fab3caf602a5c340',
    'sitemap-products.xml' => '9e135e56f4e79bd68c65ee0c764f3e979715c3ac463f39f79a1b625fa6cfb383',
    'sitemap.xml' => 'e697770591a925cbb9d3f8aaa3e190dfe3c59ef8c2ac7efbda92d35ff7a0d5aa',
    'sw.js' => 'ff36fea035206b404b5d4776f0295456647d236d71087fcc28a9f88f81ebb9e5',
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
