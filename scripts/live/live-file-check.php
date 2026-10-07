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
    '.htaccess' => '2a71e3c74f76610f485578fb419451fedb7dccec6a3f6fafc615853dbed95af6',
    'admin.webmanifest' => '2a36ff5a76af4f6e43877dad32f0a1ea3edc3b7afb8d3a5c06ef0897a979ca94',
    'api/.htaccess' => '574ff6d3712c69ad6a119652dd976afbad0e065cec35c198ceed85bfc72c3be2',
    'api/accounting.mysql.sql' => '865458325a463d3127bbb45cb1a3d5c0c9a603c7656cdde85c280ffb7f8ed716',
    'api/accounting.php' => '0e508c851de94808626164518d8394e6c65508ec2733efd16be7a278b2825963',
    'api/admin.php' => 'cb4b4613d7b855f06e2d317aa9ad0727c31dec372994f59284a15f747997d7c4',
    'api/admindevices.mysql.sql' => 'ede4bf81432f368b9512dd6c2ef2a7139a5ccb4a603bc7aa60e0e378da4fde96',
    'api/adminloginlog.mysql.sql' => '15356b6c13cbc00e8e20cd60fd56415ec56ff877cd93242bd48ccdc75e2fbc2c',
    'api/adminreset.mysql.sql' => '006bf9cf2ccfb14a225761d3d81d083a7ad6ecec977f1c1b6b7ad8e4c64fcb14',
    'api/antifraud.mysql.sql' => '861285918d5a45a38913a2cd3300b49d825e3a6691ea81411f31b6840808275e',
    'api/api.php' => 'a0e4e9f2a1b142217bc4a98c8637d10d719c2f9113ef7dfc97a050a75121393c',
    'api/arabic.php' => 'ee95e3677275fe690cde28c627d98d32d903118ae9c4f418e0fb1dca65c72cd9',
    'api/assistant.mysql.sql' => 'c7d041e64a9576eeba376d9d1430f8b5f7f428547d175d73d65d0e62e6b6eeb9',
    'api/assistant.php' => 'f76fbd923ca4ac6935109d6cb0e1490f1aa96c882b4fdd3a19b056bd0a707acc',
    'api/assistantqa.mysql.sql' => 'd272b606f750484f5ea9981f63792c084cb7a1335f62624996fd303fc671c3b2',
    'api/attribution.mysql.sql' => 'bd9486d8589c699881329c7a9fba716cef49f916f5f9f7cf837944d4bfc5ef58',
    'api/backup-build.php' => 'e68d3731603ab12eca397059ad15cfb96575f9892b716dd8a2019a02b95df0a0',
    'api/brands.mysql.sql' => '7f781441054267db1cfb90a356cfdc8817d62d80670ced83d9ba0be047bba110',
    'api/catalog-feed.php' => '0afe5972b740f9860a32d1f73383f276b6b941bbee23028be534e08ea001c08e',
    'api/categoryart.mysql.sql' => '7773fd8278b03e92472a483e48879d5d26418868973513bc547f6040f7da872a',
    'api/config.example.php' => '494d1d9c2bb34db3880764b48ac0d795be3c8b8017ee4e2df5c740d111e58f38',
    'api/cron-assistant.php' => '08fde52104005ba3d6f27e7bb3d869a9707787f980ccf8825e5f73a7caf423c9',
    'api/cron-backup.php' => '62ea87700159a47b103bb63c681e1a2c198ff4828085eb0cce697fe1f0ff71cb',
    'api/cron-customer-mail.php' => '176405d4ee17e350153c95b8cd0e04871a0f45de5efa933cd8c454e3c077c43b',
    'api/cron-fulfilment.php' => '251160b5addcbdc16ccb59def843f714cd3774fa73b7d9ed502b7e8718d29c85',
    'api/cron-invoice.php' => '35728b4cbc7426bcbe298ced1ce7bd846fc38c3343bdb4e7024f06db9c6b9e9f',
    'api/cron-lowstock.php' => 'a79d7d2d5610ebc1ae4109f303d5ed6eaadd472cd83023eba1ed15ef2ee5c849',
    'api/cron-push.php' => 'c7509228f2a54cb066608951d3f6e65f5fcc2bf97eb535f3b40b7075880f378c',
    'api/cron-stock.php' => '2f973f33029efc16789e62cca382abc65f36788cbc8576ab3da2c6e081ccebbd',
    'api/cron-voice.php' => '900aaf3ac0b7b8b721dae0c6d9bba23f87112377c36947792c4f89b7a01e3083',
    'api/cron-whatsapp.php' => '6778175f64a3fb248799921da586199208d9fc2830d896655d234c7af4e6d9da',
    'api/customer.php' => 'eae16955bfbcd262bf5e28a9f3e5a81de3325b55748ae170162c6f5bbd73c38e',
    'api/customermail.mysql.sql' => '31ef14254b819d78830aa1ee3eb0865a93f42edb75aecc1c0deea42441393e7b',
    'api/customernotes.mysql.sql' => '74d498958ca8f525da41a7ae6d626c937d31e642d997d8068b969b2f30fbca80',
    'api/customers.mysql.sql' => '13a8c34931a59eac904f28a06e2cdbee16f590ae00aa3fbc9e713216dbee8c9e',
    'api/deploy.php' => 'e3ab2a969bb4745a5f8b4b90e07d0881f08566b3757d216af0a2699ea12c01b7',
    'api/driver.php' => '3b67aa3ec498e5751fff541cbc2e7d5c5351d8a8c598dee26752878c9813d904',
    'api/file-audit.php' => '3d06aee5230b780d0e3761133d5587888224ce6df3be8429a7a92aab63e1514e',
    'api/homebanner.mysql.sql' => '8303e5e0a028b4c8cef8261a174cb239504db4af603af95e7d844430cdc21ba7',
    'api/install.mysql.sql' => 'a2e3fc99c8286ee94fc176b256345b81bb111292fb99fc1af21cddb51deafbae',
    'api/invoice-file.php' => '06f5504344bc696d9d73b4c5f8a77c65c4acdcbdc6ada05ad9af90cab8c8878f',
    'api/invoice-logo.png' => '5decec38069f6f60c48eec86f864a1da35574cb56627baf8641147aa91ba0434',
    'api/invoice-pdf.php' => 'b225809ec8cfa7609542547de2ec4f7dbcfe97795c34ba5f70e2778f6a32476f',
    'api/itemname.mysql.sql' => '8b16e46110783e9ca4c540533b5f144261b74f831c0800ca98381c7ed05b9c6e',
    'api/labels.php' => '47172b8a2c2d1e1eab228261ccff2ce6354a98ed500eeedc00059bbda4828a48',
    'api/livetrack.mysql.sql' => '9775c6410057c27ebf639ba64d7109982d64a3d64525f0f418fcf03dff3f6761',
    'api/llms.php' => '03395a2a1a155f1aa1789d86c002638e16b799b3b822f6206665da0600277b04',
    'api/orders-print.php' => 'f3bdbae1b41058156c8f7eaf9770240c15b361d766c7357f463273d1f9cab54f',
    'api/passkit.php' => '673d7bce0d7aed12c66fcea53be8f9583c8114354f9009a13f828b04c78b7927',
    'api/payattempt.mysql.sql' => 'cdebb8e2a2a525b1c6471709b858201ec02257c594fd6bb93b494d494b035d6b',
    'api/payment-check.php' => 'fb136aad9492bc50e23665a1b54083a8d2b98aacdb1b3cb34277958e98d23bad',
    'api/pdf.php' => '8e1fd2ff13f0a3ac08e57f76db11301494c64e9d0ae711fa4a9277d411f72cbb',
    'api/photo-guess.php' => 'd6aeb9d520708dcb70fdc8b530c06b9d04e7148b130228c61002a33eaa4d86c0',
    'api/productattrs.mysql.sql' => '57b901286603246ad0f3477c0acb36613dfcafc4196c51fa572ca4a845ac881c',
    'api/productbrand.mysql.sql' => '1a5dc4c60f8d7fd7dbaf5d0ef742eb9c0ce3e23687a254d39344319f4672aab4',
    'api/productimage.mysql.sql' => '870f598114bf792d606893fa9be6cac075e79f2c752422a38a19e63e216bb06e',
    'api/productthumbs.mysql.sql' => '0751f5d5065b7f46740becd3105155faa01c3aae04108e831b6a588647352531',
    'api/promo.mysql.sql' => '7f64bb42ff96d0a3cf410031b48bcac6ae0e109f089cde59cbe2d1d22fd4177b',
    'api/purchasing.mysql.sql' => 'c76fad2f30b0426b558ebab7ccbd73c3fb0d513f8125fd7399ba767a4d6da546',
    'api/push.mysql.sql' => '70c562de94012285f7af9a654376412bdd26c150d563d2cc3237cd6355c13e8f',
    'api/research.php' => 'f97e362c27a523035a86170d60bcd400b2793e3bff4344a3dc252330ad48dd11',
    'api/reviews.mysql.sql' => 'e0288b6470d6e974e9e8811de761b07268f09fe2dbab5bab392428c0c2d65c5a',
    'api/robots.php' => '64352d9a1f9564053697c5a4d972026896f5ee295f9d9879abc8a05f241dfaa8',
    'api/schema.mysql.sql' => '7095a95406bae97034bc67328bf7bae2e6736fddacd5ba8a62fe0d83cd8fb246',
    'api/security.mysql.sql' => '7c53a232f0e18815a3e2cae02f70456e320b9d79d98a96719a45785b312e5591',
    'api/security.php' => '27b57fdb0d2eb118031f1674e785de6cc5fff56e5922059b2d20d18e90ca2506',
    'api/seed.mysql.sql' => 'bd51a938063ff63d7fb381290c42196ffde93d9d5b065f5da6bac3d10b7f0d88',
    'api/seo.mysql.sql' => 'f58260dc969ee70f3bbd1b9a80fd0693d5d53e4fc8c16ed99d3b7ef61d09766c',
    'api/site-manifest.txt' => '7bad0eb79062c86fcd33afdc034090bd07ef0d8c9a8c3564da116dd7a230942b',
    'api/siteimages.mysql.sql' => '00471df85d634e066d29d44951b30b625c52502f98955ead02ea7bdb95e65d47',
    'api/sitemap-categories.php' => '60e9d9ad33532527687a2720323e99b3e0ef867ecbe6c13b40cc88de02092be6',
    'api/sitemap-custom.php' => '38c411a86059e518b1845fec0cf269be6d0b246a09c4483baace900937ab0cd0',
    'api/sitemap-index.php' => '2d187b6f5acf37210e4161e0dc0476ee47c00aecd5745c4a1af9f019d0e803cd',
    'api/sitemap-products.php' => '0c1c1b9dd872c6afbb29c4276e99f241a198c52d379873022ab56d778e0f283e',
    'api/sizeadvice.mysql.sql' => 'd4aa5746daa9d721839661586dfafd416fdbc9607c8fd33d83a1181531d070ac',
    'api/stock.mysql.sql' => '2568407818e9cd7d9f3eac06b8513ea20998b74e686e335ca8e84e82eba0bf34',
    'api/stocklog.mysql.sql' => '3fba690958ceb6959f24fdd34a455e9fc34d6e8f8308a9dd53136eb76c900680',
    'api/store.php' => 'f1408eadd75a569b46639b4aeb3f32232bb397480d8cc2864aeb11fae19c3288',
    'api/totp.mysql.sql' => 'a6e7383ae32985a2dac5c75ead5533360bae4f8f78fa56217e6b9e37868c5e40',
    'api/wallet-assets/icon.png' => 'f6558cf7c1697b039c3743de6b1db1d9f46ff97a969f2c072a8c85f1564a2c08',
    'api/wallet-assets/icon@2x.png' => '11408129ddc0a6775f0c80e72c10e3293d32490eb458062ace112c06cccd64fc',
    'api/wallet-assets/icon@3x.png' => 'd3a3ed93bfd3cfd430ee71ece2d5b246e8d653a187e985ad400003a32f8d7e3e',
    'api/wallet-assets/logo.png' => '6a5fae4d198dfb9307a73cced946f39470842d023ad7503fa94b20b08940dae8',
    'api/wallet-assets/logo@2x.png' => '73a07659c447d66227689c65115fe760fdb2bc34e6c2baf814c64ff1880cf1ab',
    'api/wallet-assets/logo@3x.png' => '3f4b4b4f14e8836427f16375ecf316c85f8dbbe07602cf526f1cc3db12175820',
    'api/wallet-assets/strip.png' => 'af6c9cccdcc479344c438628cd0b03397cb6a97fa52a5034eb1c35b243c3b2a3',
    'api/wallet-assets/strip@2x.png' => 'b96e1a773f8eeb632a583e69defae80270d858ff36c3cdb1a07bcef87fe9a758',
    'api/wallet-assets/strip@3x.png' => 'af6db34ab49e6b288fa76985ee13ce2880bb22960ea738453ae906802215e7c1',
    'api/wallet-pass.php' => '8bda2ef2bf3980e6bf889f162c9190823a045c4eb6d4c44b81f066a046722fe0',
    'api/wallet-setup.php' => 'f8f69743ceb3585393028f3d59db0dd1afdd199378e9c19db15954d61af73fc1',
    'api/wallet.mysql.sql' => 'dc8f136251ee4a5071fa74785d50d3336042967d3a2a5ec7221f172c1c72086f',
    'api/wallet.php' => '6b2dff4a6a2ad4d1cde133b0c8d5b81dbe0ff3f611ba430e86790f1b01a54b47',
    'api/walletweb.mysql.sql' => 'f8aa6b19fda9e9a7bf197df4cc1dd835220a85f230426f96c19f01a7569875cc',
    'api/webpush.php' => '8543031cc499b3a83cff042b142257ac6017111a829951c3354d84961f734194',
    'api/whatsapp.mysql.sql' => '7ea02f2f7a591ad1c0870e2f5ae25bf078a63a101c85f1eba412a3a8d895b4e2',
    'apple-touch-icon.png' => 'e09977ffae1506c51d3c101cacb52794bc673ed51de5b65bb31ea8f814805109',
    'assets/About-7p00QsGK.js' => 'af2b7e351d28a6e070836ac4c2da587f4d1d1dd302fb6fa927807ec349dfb9b5',
    'assets/AdminApp-Chmxw88_.js' => 'be965ff4bbafdd95ce6da2a5df977240a498c9dfa4e2ba8ce00f0b7c436a5875',
    'assets/AssistantPanel-Dx280GRS.js' => 'a64dcf99a568e8c5a494398e0467e8c83ec169f0342496505c607cb245be0bc4',
    'assets/Cart-B71Jo6gk.js' => 'ea09191791d9d90e0ffd1f41e32ab6667b58aabdb8c5ce415cf896c613ac40be',
    'assets/Checkout-Dk5_ETdy.js' => 'ac684bb4b3e4ca454f2d58e25805aa3227dca48534cf0c7a578bfa356718da02',
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
    'assets/api-dedupe.js' => 'cb74db76c5f93fd5b6339facf01d6bc35889daab9e24b88f21f1ce0ee63c4498',
    'assets/apple-signin.js' => 'dec584e40a9cdd989fd1bae36212a0f847e613ddb7de358bee162f1cd1c55d66',
    'assets/assistant-icon.js' => '449958d4c49615a71e3e4ed3464bd42163ff0c37de01caea5f2824f559ca4f41',
    'assets/backup.js' => '54e649581f63bd10ba194242fe601bc65892db7b479ff7a3a8484c30563cd79c',
    'assets/bidi-aEAFfM9w.js' => '2d2f9386b7166e9eb7fc75bc3aa85cbcb3f21037f75ae92894bb2570c4436424',
    'assets/brand-badge.js' => '8e67e1cd42dba8b07da441470ebb54a6de237ea120596a0cd486118720c1a590',
    'assets/brand-image-picker.js' => '12f369b7bcc96e31c2e2ccf446e7ad6bdbb40a28e7cd662bbb633eb6f9c6a667',
    'assets/brand-logos.js' => '4442eee47cff809363c04bcecf358945bec746804c2a57f50c98798904b14e0c',
    'assets/brand-strip.js' => '9e2c4ae3d55c1ee9e393eb15a3b3f0694b0f9b3929593ccca3fd4d811cce3f69',
    'assets/card-badges.js' => '2140aa40823461aa06da59a2338b91eb789ddfb380ec6a115ad771d646c31a02',
    'assets/card-heart.js' => '9768f49b782e63c2190ee2bfccf524b1c555ab76a99798e0684296ef6a80f4fe',
    'assets/card-options.js' => 'ab899604e0e1f1d04203b65df3cb939c194acfb79571433428d7ff514be27339',
    'assets/card.js' => '132155ae8d7d298b68f81ef4d34e3300db9298f15a6f2448da345da06f048ba8',
    'assets/category-art.js' => '006bfce0325b78272735386ccb192f280c3b52d6eb1b8a32a513c9298dbbb89b',
    'assets/category-tiles.js' => 'f5b15ec381de0aa6eff490c9846cd8330d6e6188fc7936e9519d130b4d469aee',
    'assets/category-topbar.js' => '42fe8ed1f4a2fd767610bbca757d03bdbfbe5feea9cd77ccf8f23345bd4b51bd',
    'assets/checkout-CJW4l7Oz.js' => '77a829178518d422c4c4d9252e8cdae9e97739ac92156fce6dc2370f82f8c6f7',
    'assets/checkout-fields.js' => '8e8a1b13c731b5458ecc1e7f5617f73671641c87e3fd21a937a4ca082d7c0b11',
    'assets/checkout-pay.js' => '74a30f2bd273b1ee5fe0a807e7829f06d962392d63bf155a1e6e067954247691',
    'assets/checkout-speed.js' => 'bc24aac476c329229ed86526f715ab6cfb330ccf4a42e7cf51fae54a54ca5012',
    'assets/checkout-tap-targets.js' => 'f84c5b331be1dd1226d906dcc8823d590e97558ac47b4b55c0fe414a65c907b2',
    'assets/contact-emails.js' => '891af6643d1346da3162448bea85885e4ef6e21f0a803df87e64d565a8e811d7',
    'assets/contact.js' => '3a8fd66908f61d4e68fcac5241a8a2dd659b7069a19237177132577871a575ef',
    'assets/crm.js' => '1a7cb682e214d5fdd07b364cc15f66cf6b115cfe824a7623f287def587fc8fd0',
    'assets/custom-css.js' => 'ef8e440a043719ca3e43f6bcc32854396904c450200ff433a98e886b721793ab',
    'assets/customer-account.js' => '9f3213d2b563b50b1fd3718281417e352388561268720cfcb1e458fb98a5bb0a',
    'assets/device-theme.js' => 'b00ba3a56a6a78030fb29fe7cfe3fca48e9725c30cb4807aa9134454a0fa64c3',
    'assets/driver.css' => 'bc0603c400d9165d10ba991c7cbfd26efbd63ee7e353b2ae73f572380f906d59',
    'assets/driver.js' => '8ee4ca8628a0e9d27c5a44f5f65ab8010c5acb10f3e32f870961ca8c4aa2d7d1',
    'assets/essentials.js' => '50c0cefbeef79643137826e44561a839bf49d25b7e1a33b6750b2eed97ed4dee',
    'assets/features.webp' => '951c8a807b0574183359700b7bf5901590ac16cc97b008770a4a10b99bfab1ad',
    'assets/first-admin.js' => '6a32ca37d71936f7783d9d4f436c385a69df36c78618ad30d1e70e78c81ef65f',
    'assets/footer-editor.js' => 'ab9ccee7da7e9a3a4bd53556964cd66b7ad46922521022d4f3516a188617d6a5',
    'assets/footer-links.js' => '0a8c1d7ecabefb3ec447113f41e3c3c5a758245a29e2aced4834692a511a92d6',
    'assets/footer-payment-icons.js' => '379ca6aa5813a9df61427d7aed82c101bc85417de9dd97e792e010b9a0ec5194',
    'assets/footer.js' => 'ccae6f59425660d18636fd07983a082c436bcb62d6df1b4d4cb829905bf9c9f4',
    'assets/force-password-notice.js' => '79f095525ce54694729e775e0c84c18f4be6991c402a04483bb55a1718d54c83',
    'assets/google-signin.js' => 'ca543d7857a473d57b0a3528c61fd81e92370df6dcd24310314cc5eb6ae868f6',
    'assets/grid-name-fit.js' => '438ce637ce024c997fbb3b719177e76856323bf4d623536505f6f8a95d315075',
    'assets/grid-price.js' => '9ba40cb3a61aec57a678a51930f593b1d664261cdb1ec1262469fce04f74038f',
    'assets/hero-lazy.js' => 'b0abae9e516d28b208c5db316cea1a96f218649a1b954760dc945198013c36fe',
    'assets/hero-preload.js' => '7be10029881f8c43f750526ffcf3221e7262463e3c52b4fc54131149b4f0f04c',
    'assets/hero-slides.js' => '867c022fb66f56ee2db2e86a50aed97d51c8d3753393fdd2e4998dc0ff692ed1',
    'assets/home-banner-editor.js' => '3c66d1ada309cf0b11bbd3ca133bd197d0ec292cc9e7a43b47d724001ad972bb',
    'assets/home-banner.js' => '7a81c78068aea5d3ba5996320cc8aa90c10d3d6fabb2796bca54643d77984a3d',
    'assets/home-layout-editor.js' => '493f61d0e19f708a4ec0818d0908db008a6c139b5ac9083b56f161c5d8a96326',
    'assets/home-products.js' => '852de281d269314866593b256fa19f813e17c29baa98cb505aaa6f1079d89905',
    'assets/home-sections.js' => 'b4b1dcfd559a49c7f88a845d9a93f256002be45fabf545f2dbff9a92d4b37f66',
    'assets/index-5HbquisI.js' => '881eece4525a72074c514b348be352f5056e3f9030ed9900dc5cc02a2368306c',
    'assets/index-TIUCmnwm.css' => '4c85029a7c26cdf79a3ca7520c0bfebe286a95f9bbcc33ad8a4908d81a145ad7',
    'assets/inventory-scan.js' => '756167af3c89caeca7527cef34ca93d05b329acf2ae7412d29b8080f87dfb543',
    'assets/inventory-tools.js' => '41f45e6d6546a54704e71baf01bc1dba83f7c6f031f8c35e294149a87e0f1ed2',
    'assets/invoices.js' => '4014c84e42538aae132ec42e63d05fb63c5147c6bdeef0ea0aa11670de845c2f',
    'assets/keyboard-hints.js' => '71a4dc5f2429ed9cd0d885c4e9afad76cd6a66f9d74548cdbf13f3237ca85334',
    'assets/leaflet/LICENSE' => '53e8dc25862014e4324741ca18fbe3611e11d42ef69f59f86ea8c5389647d4cb',
    'assets/leaflet/images/marker-icon-2x.png' => '00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528',
    'assets/leaflet/images/marker-icon.png' => '574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437',
    'assets/leaflet/images/marker-shadow.png' => '264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da',
    'assets/leaflet/leaflet.css' => 'a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6',
    'assets/leaflet/leaflet.js' => 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a',
    'assets/legal-editor.js' => '9f55b9f4095663afa525e00f2837bb5ffe8735be74b55b28074cd7dbdf7b58b6',
    'assets/legal-pages.js' => '0137d5a0971698f000015a8077c2c20582b2a2681a95d06a110c239ff8884dcf',
    'assets/login-log.js' => 'ab654a080a63737d90226c1baac1c86bc7bdad7ec777933b237b21fb127a912b',
    'assets/login-polish.js' => 'bc903bc032db3121cf99002cf23b1179cb4e5b08220c7c2494a1ec9669ab572a',
    'assets/menu-bar.js' => '6b70ee2989bbafc3d69cebfb7f87dd35cea140996bc46670405c14093c800adb',
    'assets/nav-menu.js' => 'ae7b9bab03e1f8d64046acd2d2841920fe6f9e299476d05a1407ae6a22254bec',
    'assets/no-photo.svg' => 'c2868571641e1f8abdde77497db4b5c85fa38a72a76ede28f02b3b82d5a0fa8f',
    'assets/notification-center.js' => '87e8e5f0dcb5b303b144e9b40a637497170285395542a04104f471c5ce44f324',
    'assets/order-progress.js' => '3b50aa4c9198278960e542f66c5db56a557f9080d4cf1d81e93902dd62a283c5',
    'assets/order-tracking-panel.js' => 'efafa81437c75d9302fe2a9c2db45f46ae93d25d161987e04906886004ff61d0',
    'assets/panel-light.js' => 'f20e919d7ae6a21a861c0bc08379755070457ed5a320521fec94dc59116e5e7d',
    'assets/panel-save-bar.js' => '163bc1d8da52787784bed8b4d7592c12191545664bb652694a474fd687d3a02d',
    'assets/panel-settings.js' => '7eccdf22bc1e3875ae850672ffa5f99e614f2f7d09b3e93c26bddce51c1c6a88',
    'assets/panel-tabbar-autocenter.js' => '5b313f6f88512e0ba33e7170d7e9f4e5f530a1b874944f96062ae573743d9d91',
    'assets/panel-tabbar-fade.js' => 'ae3f58547eec7b832159c72285eacae0c0b128adf719398b0d24dd539e535da6',
    'assets/panel-tidy.js' => '7736ceb6da10796f29df653a34504b13a8484e91082fd75b6cf8181f2bdba353',
    'assets/panel-ux.js' => '582e069eeb87827a05a5c8e222c82090dbe5b829b33af3b3bb1393bb841d2a84',
    'assets/passcode-login.js' => '4ce9c91b43122ae785e911d82716e52385e87eebeb6b113c4a093d99e1b02da3',
    'assets/password-reset.js' => 'c880e3c424001860e17d2c0266747b4668cb557dd8fa1c00ef037ee270c63f49',
    'assets/payment.js' => '040e11fb1ad20bb5287e6df1da9f2181d8f3b70788c97005607382cb0ad59e5a',
    'assets/payments-screen.js' => 'c96bf6556952b38f83e2e27ad7513c85345c8d0fdac5347c43d57202dc82df92',
    'assets/product-attrs.js' => '57eb015784ab810a0f0a71f432ea6a614031b2879eda530b9744a89f5bf6ac21',
    'assets/product-cards.js' => '63c037fecc9332bca5d39229824f959ec830a4488efa96981bfdb61bd40cdf81',
    'assets/product-mobile-layout.js' => '482120d0035374350500e1daeaf29862806264f11e43cb26bed2f6df51f154af',
    'assets/product-photos.js' => 'a21739795ae5267bbf0dde2956f0190e8e128405fd7e27ad4611517a8892f4f6',
    'assets/product-polish.js' => 'fffc7b52ee995d68dbf5b89b6b84a117098e37a8bbe1d8224269f509b72de104',
    'assets/product-research.js' => '75c670733fbcbe5d0d2e6a5e121c5b3fd4f08c206d61d89b58e775c2200b6465',
    'assets/product-zoom.js' => '881bd8f6dd12c79a54b365ca6927326973f7c4fab2893b1c3cb112e815d23a5f',
    'assets/purchasing.js' => 'b25f9592910b8b299de54327695fbb1af86d9945437cd01ad28fbc9b350a6aa6',
    'assets/quick-add-size.js' => 'c97803b57a4a621197a29ce6e502b85419ba6af533f688abf7e6c24f15435425',
    'assets/react-vendor-CMgvnOJB.js' => '3f36bbb7b4c6de3289643869a25c08e7ec7055ebaeef06d597b0fa301525d579',
    'assets/returns-link.js' => '07a9d4753e0120988fe95e43d618760cfde9a3b1cfdabb31b209b2ae8a01ce10',
    'assets/returns-request.js' => '660d4d3a5a8f1ebb470f39709063a1965133514f462105ebea5ea6117964c2c6',
    'assets/rolldown-runtime-QTnfLwEv.js' => '5db5ba82eef00d1dee7e86e663098c9427d01183a88d357437daff295aec3e75',
    'assets/rules-live.js' => 'f390963369dc57bee77ee1f98b0241bfa55da8f751fd3ea0fdaa036f2c5d6766',
    'assets/rules.js' => '7d78c9d7066192b399aa0b2c5f06d327c82865a232fcc76e842c95b40a36355b',
    'assets/security-plus.js' => '464b5a4e3a906b369de6bc4cedfc912bfee6e86d93f9f485ed685e36478bf04e',
    'assets/seo-keep.js' => '0d3bba88ca1b7245e6198a4d9863b9bce18ec206371c4806e860f82837b16f3a',
    'assets/seo-screen.js' => '825ff144aa9a24f134a08db919cf241b88a1287c3e28e426b54eb75c94e697db',
    'assets/setup-screen.js' => '8afbf53d0f869448cf921458d3c110e820bb73b7832a065b6e2acd6702e37a2a',
    'assets/site-images.js' => '44132a19e72d503d17cb481a7fecd548cabffea559b24120f27b2724187495ce',
    'assets/site-strings.json' => 'd6bea55bbff3476d82a1db1eb0b80b9bec210298d2d85afa7dd6eea755d6e48a',
    'assets/site-text-editor.js' => 'cfdb78241d97b500dad6ebcc31754e39548b02d5bb39eaf62a65f7759855de85',
    'assets/site-text.js' => '1f14de76655611e43bd56e6f92f8eb16b9b420f872f18bed927b966aeba559b6',
    'assets/social-links.js' => 'a21ed1c9e267e994dc55a4cf29591654540bcb3aca8ba7fa39fbceb52228a79e',
    'assets/social-setup.js' => 'a6403def6f7f585e0dc58f356da47af4fc5530d10bffd06c923e823b1b83b007',
    'assets/sporta-dark.css' => '7b9445725c3d0c8a3e01720914dc10d39b503248c598510b135043fbce0b9a7f',
    'assets/sporta-desktop.css' => '40608ba719b94ef7d1fe5b7debb1753e7bc6be3ff7b5efa4abcf06f50c4e42a3',
    'assets/sporta-mobile.css' => '704c330c4892d16f52981f001c84d74276a614b4f198359af1420de7e4f7f89a',
    'assets/sporta-ui.css' => '16c8cf0f50fe94d64119a517b90438bf97337a89dee2bf75141538bdd926804c',
    'assets/theme-colors.js' => 'ed913d1b97ccbef2f52c3f24ffe8fbeac31142894173a274014d4d1327d37811',
    'assets/theme.js' => 'cf0044660306b1eedd3c830ed9ec432a7400d15e27aabdd3ce57d435b7c60403',
    'assets/tile-art.js' => '30ca13b0aff1ccf8a91b4629b1e93484d5469dfcfec884da8d0b37cdd591ac2c',
    'assets/track-guard.js' => '49c24cfaf6bf666dbc4488fc8c194dd2b031c8c86a891fe773faefa3ba1e4897',
    'assets/trust-strip.js' => '95f84b909720afdc23a3adfceb742047efcf4c38fd2b018b3b346beb1c43e01f',
    'assets/wallet-setup.js' => '89f60d952feddbb7e107181077f086ae2585f7bc86def9d9c66db2404fb18c4d',
    'assistant-bot.png' => 'a589c66921ceb50accebe71449e0ca595e11649ca595517f864246e339483e00',
    'assistant-bot.webp' => '74b4d1a0ffdb119ae12b735b98468ae0de461d4c6f5ac8d14f652ad89b279803',
    'card.html' => 'ec1132381b6f8e80dc105bce84cacab7388b2358faa9ae2c74fad8a7a00158f7',
    'category.php' => '140a5fcb9382e2d50ef02560eb1195411f1bcd32733a1071701d98f28370a255',
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
    'config.js' => 'ddf413fb4ab285c934230d9c4f78bc43bf883d4c54aec053fbf773f7cd00a794',
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
    'index.html' => '23f4b33322fb46d0b85d1dd61e23eb944ced81ffd9bd0607ca541a266c532634',
    'knet/.htaccess' => '75d8e990375bfd2c0e1f6304886d120aeb3676720d58ea2f40faabe224a6ba03',
    'knet/callback.php' => 'b97c587a569e9849b25aba4bf7dce88dcd5c7151d40c095b5ab2b48e0a81e62b',
    'knet/config.example.php' => 'b13cecaa5998ee52d5de1b11f272ac011eb2320f38494460da25e1455538ad09',
    'knet/knet.php' => 'b4bd650704200f122664dc54a29cef392ac2c1a9b377903df4efb483435605bc',
    'knet/pay.php' => '519f5fc0710460c0353b602606df0087bdb2b6f552bf3d59c6490295b4ae3d9d',
    'llms.txt' => '7aef7e169cb23a1c7d76410bf823ef8fc76aecc78ad492650ec5f3e6b23359ca',
    'logo-white.png' => '4e60bc404ce37d63e97b925814c902d1deb4322778953876fca096bb29925ffe',
    'logo-white.webp' => '2d282c40925a4a6d86ef9c64db289b7c5da6bf8927ec0d1ba3e1725f571ef2ce',
    'logo.png' => 'f1a4e558ac3da1500aef3847bead524db51e11cc47b70e50fee8c2fb3772ef95',
    'logo.webp' => '5143f087020d6e8739bc15a2fbe45b3ef580677eaf186aa7244c6f51b8130f34',
    'og-image.png' => '4e16efd818ad868e383340741353c00cc0aae5311d8af38d26cdac948926a42f',
    'panel.php' => '8ee98824ff126b9a8bff9ec763ec87300fb18bab656b6a617b87c882e95a52f8',
    'pay/.htaccess' => '88334a62281adfacc9fff3d9696299a8be5f0336649a52553ce783d5781d818b',
    'pay/callback.php' => '8d3dd6a3a43429bff8b6fdf3af2281bd5a4a0e394d00dff44774b1bf54e58d4b',
    'pay/cbk.php' => 'd504f874a288be6185cf6e647afa4e2b6f38f53dd1e1de923a97624ef1183c1e',
    'pay/config.example.php' => 'a1b8bbaf41ad52daa0f00cd0138660b16b490e00458a46f1a7e98330e63c242b',
    'pay/pay.php' => '4b4b85c94fa9dccb2e35628f82f702814d06894b0c8c935b8fb76e4fd760b9ae',
    'returns-request.html' => 'c60d4e4c7bdf9aaaddd9c4229a224f00c808b614221810f49df070a49ccd9540',
    'robots.txt' => '7139e922a29b7cee657145e6f4357b0ddde81335ecfaf5f76a8e12c61674436d',
    'seo.php' => 'edbbcb28aed3275e66442b4c36b46ad20d623f46d969f23d2e7723a144f66943',
    'site.webmanifest' => '34169e10f86b2efbf13f3762961d394f9039b7904ffb2110e7525790a2e88779',
    'sitemap-pages.xml' => 'bce21049f7497a847368e836dfad55e1304d94a2b4dfda57fab3caf602a5c340',
    'sitemap-products.xml' => '9e135e56f4e79bd68c65ee0c764f3e979715c3ac463f39f79a1b625fa6cfb383',
    'sitemap.xml' => 'e697770591a925cbb9d3f8aaa3e190dfe3c59ef8c2ac7efbda92d35ff7a0d5aa',
    'sw.js' => 'ce37f289d98fbc6c023c22e0e2c272d2ff50d510581582af10108869d1d727a8',
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
