<?php
// سبورتا AI — the shop assistant's brain.
//
// WHAT IT IS, AND THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM
//
// Customers ask a shop four things: where is my order, when does it arrive, can
// I send it back, and do you have my size. Every one of those has a RIGHT
// ANSWER sitting in this database, and an answer that is merely plausible is
// worse than no answer at all — "your order shipped yesterday" invented by a
// language model is a complaint, a refund and a lost customer.
//
// So the facts are looked up, never generated. This file matches what the
// customer asked to an INTENT, runs a real query for it, and answers from the
// row. A language model is optional (see assistant_llm below) and is only ever
// allowed to phrase an answer around facts already fetched here — it is never
// the source of one, and the shop works completely without it.
//
// The intent matching is deliberately boring: normalise, then look for words.
// It is auditable, it costs nothing, it cannot be prompt-injected, it answers
// in milliseconds on shared hosting, and it is right or it says it does not know.
declare(strict_types=1);

// ---------------------------------------------------------------- normalising
//
// ARABIC IS WHY THIS FUNCTION EXISTS. The same question arrives spelled a
// dozen ways and none of them are wrong:
//
//   أين طلبي / اين طلبي / وين طلبي / وين طلبى     — hamza, and ya vs alef maqsura
//   التوصيل / التوصيــل                            — tatweel, the decorative stretch
//   مَتى يوصل                                       — diacritics, common in careful typing
//   طلب رقم ٥                                       — Arabic-Indic digits
//
// A keyword list that does not fold these matches roughly none of them, which
// is exactly how "Arabic support" ships broken while the English tests pass.
function assistant_normalise(string $s): string
{
    $s = mb_strtolower(trim($s));
    // THE PHONE'S PUNCTUATION, NOT THE KEYBOARD'S. iOS types ’ in "what’s new"
    // and "where’s my parcel", and a keyword written with ' matched neither —
    // the two most natural phrasings of two real questions. A non-breaking
    // space pasted from an SMS is a space.
    $s = strtr($s, ["\u{2019}" => "'", "\u{2018}" => "'", "\u{02BC}" => "'", "\u{00A0}" => ' ']);
    // Zero-width and direction marks are formatting, never meaning — and one
    // pasted inside an order number used to cut it in half.
    $s = preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $s) ?? $s;
    $map = [
        // Alef in all its forms, and the ta marbuta / ha confusion.
        'أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا',
        'ى' => 'ي', 'ئ' => 'ي', 'ؤ' => 'و', 'ة' => 'ه',
        // Tatweel and the harakat: decoration, never meaning.
        'ـ' => '', 'ً' => '', 'ٌ' => '', 'ٍ' => '', 'َ' => '', 'ُ' => '', 'ِ' => '',
        'ّ' => '', 'ْ' => '', 'ٰ' => '',
    ];
    $s = strtr($s, $map);
    // Arabic-Indic and Eastern Arabic-Indic digits -> ASCII, so an order number
    // or a budget typed on an Arabic keyboard still matches. The Arabic decimal
    // separator too, or «٥٫٥ د.ك» is two numbers.
    $s = strtr($s, ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
                    '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
                    '٫'=>'.']);
    return trim(preg_replace('/\s+/u', ' ', $s) ?? $s);
}

// HOW A KEYWORD MATCHES, decided once per keyword and remembered.
//
// ENGLISH MATCHES WHOLE WORDS; ARABIC MATCHES INSIDE WORDS. They are opposite
// rules because the languages are built oppositely:
//
//   * Arabic glues its articles and prefixes on (التوصيل is "the delivery",
//     وبكم is "and how much"), so a word boundary would miss most real
//     questions. Substring stays the Arabic default.
//   * English does not, and substring matching there was a disaster: "hi"
//     sat inside shirt/white/this/which/ship, "hey" inside "they", "cod" inside
//     "code", "card" inside "cardigan", "fit" inside "fitness" — so "do you have
//     white t-shirts" was answered with a welcome and the T-shirt could not be
//     found in English at all.
//
// The small syntax, so each list stays readable:
//   word      English: whole word, plus a plural s on words of 4+ letters
//             ("returns", but "hi" never matches "his"). Arabic: substring.
//   word*     English stem: "deliver*" is delivery/delivered/deliveries.
//   ^word     Arabic, start of a word only: «^الغي» is ألغي but not للبالغين.
//   ^word$    Arabic, the whole word: «^هلا$» is هلا but not الهلال.
function assistant_needle(string $raw): array
{
    static $memo = [];
    if (isset($memo[$raw])) return $memo[$raw];
    $start = $raw !== '' && $raw[0] === '^';
    $end   = str_ends_with($raw, '$');
    $stem  = str_ends_with($raw, '*');
    $n = assistant_normalise(trim($raw, '^$*'));
    if ($n === '') return $memo[$raw] = ['none', ''];
    if (preg_match("/^[a-z0-9 '\\-]+$/", $n)) {
        // NEVER falls back to a substring test: that fallback is exactly the
        // bug this replaces ("they" still contained "hey").
        $tail = $stem ? '' : ((strlen($n) >= 4 ? 's?' : '') . '(?![a-z0-9])');
        return $memo[$raw] = ['re', '/(?<![a-z0-9])' . preg_quote($n, '/') . $tail . '/u'];
    }
    if ($start || $end) {
        return $memo[$raw] = ['re', '/' . ($start ? '(?<![\p{L}\p{N}])' : '') . preg_quote($n, '/')
                                    . ($end ? '(?![\p{L}\p{N}])' : '') . '/u'];
    }
    return $memo[$raw] = ['sub', $n];
}

// Does the (normalised) text contain any of these keywords? See above for how.
function assistant_has(string $hay, array $needles): bool
{
    foreach ($needles as $raw) {
        [$kind, $p] = assistant_needle($raw);
        if ($kind === 're' ? preg_match($p, $hay) === 1 : ($kind === 'sub' && str_contains($hay, $p))) return true;
    }
    return false;
}

// ------------------------------------------------------------------ intents
//
// The two lists that are read in two places, so they cannot drift apart.

// What a timing question sounds like. assistant_intent routes on it, and
// assistant_answer reads it again to decide whether "where is my order" was
// really "WHEN is my order" — one list, so the two can never disagree.
function assistant_delivery_words(): array
{
    return ['توصيل', 'شحن', 'يوصل', '^توصل', 'متي يصل', 'مندوب', 'يجي الطلب', 'كم يوم',
            'tawseel', 'twseel', 'delivry',
            'deliver*', 'shipping', 'ship', 'shipped', 'arrive', 'arrived', 'arriving',
            // NOT a bare "how long": "how long are the leggings" is about the
            // garment, and was answered with the courier's timetable.
            'how long does', 'how long will', 'how long for', 'how long to', 'how long until',
            'how many days', 'how soon',
            // NOT a bare "when will": "when will you restock XL" is about stock.
            'when will it come', 'when does it come', 'when will i get', 'when will i receive',
            'when do i get', 'receive it'];
}

// Hello, in the ways Kuwait says it. Anchored, because the bare substrings
// were inside real words: هلا in الهلال (an Al-Hilal shirt), صباح in صباح
// السالم (a delivery area), هاي in نهاية. Shared with assistant_answer, which
// strips these to see whether anything else was asked.
function assistant_greeting_words(): array
{
    return ['^سلام', '^السلام', '^مرحب', '^هلا$', '^هلاا', '^اهلا',
            'صباح الخير', 'صباح النور', 'صباح الورد', '^صباحو', 'مساء الخير', 'مساء النور',
            // Kuwaiti هاي is also "this"; whole word only, and safe because a
            // greeting that carries a product question is searched anyway.
            '^هاي$', 'hala', 'marhaba',
            'hello', 'hi', 'hii', 'hiii', 'hey', 'hiya', 'good morning', 'good evening',
            'good afternoon', 'salam'];
}

// Ordered, and the order is the policy: a message mentioning both an order
// number and delivery is a question about THAT order, so order_status is
// tested before delivery. The catch-all is last and admits ignorance rather
// than guessing.
function assistant_intent(string $text): string
{
    $t = assistant_normalise($text);

    // CANCELLING IS TESTED BEFORE EVERYTHING, INCLUDING THE ORDER NUMBER.
    // "ألغي طلبي SP1AU702NKHTKDV" carries a track ID, so it used to be read as
    // a tracking question and answered with a status report — the customer
    // asked to stop an order and was told, pleasantly, that it is being
    // prepared. Someone who says "cancel" while quoting the order number is
    // cancelling THAT order, so cancel wins over both branches below.
    //
    // The verb at the START of a word, never inside one: «الغي» and «لغي» sit
    // inside «للبالغين» ("for adults"), so "do you have sizes for adults" was
    // answered with the cancellation line AND handed to staff as a
    // cancellation. The conjugations are listed, because «تلغي/نلغي/تلغون» do
    // not start with «الغي».
    if (assistant_has($t, ['الغاء', '^الغي', '^لغيت', '^تلغي', '^تلغو', '^نلغي', '^يلغي', '^الغو',
                           'الغ الطلب', 'ما ابي الطلب', 'بطل الطلب', 'اوقف الطلب',
                           // Kuwait says "كنسل", from the English.
                           'كنسل',
                           'cancel*', 'cancle*'])) {
        return 'cancel';
    }

    // SENDING SOMETHING BACK IS NOT A TRACKING QUESTION, for the same reason
    // cancelling is not: "I want to return my order" and «ابي ارجع طلبي» name
    // the order, so they were answered "send me your order number" and the
    // 14-day free return was never mentioned. Only the unambiguous words are
    // tested here; «رجعت» also means "I came back", so it waits until after
    // the order and delivery questions below.
    if (assistant_has($t, ['ارجاع', 'ارجع', 'استرجاع', 'استرجع', 'استبدال', 'استبدل', 'ابدل', 'تبديل',
                           'مرتجع', 'استرداد', 'اغير المقاس', 'تغيير المقاس', 'arja3', 'retrun',
                           'return', 'returned', 'refund*', 'exchange*', 'send back', 'swap'])) {
        return 'returns';
    }

    // "SP" on its own is somebody about to paste an order number. It used to
    // be a product search, and "sp" is inside "Sports", so they were shown a
    // sports bra.
    if (preg_match('/^\s*sp[\W_]*$/iu', $t)) return 'order_status';

    // AN ORDER NUMBER IS THE QUESTION, whatever words surround it. Someone who
    // pastes SP1AU702NKHTKDV and nothing else is asking about that order.
    if (assistant_find_track($text) !== null) return 'order_status';

    // 'tracking', not 'track': "do you have a tracksuit" contains "track", and
    // a substring match on it answered a shopping question with a request for
    // an order number. Not a bare "my parcel" either: "when will my parcel
    // arrive" is a delivery question.
    if (assistant_has($t, ['طلبي', 'طلبيتي', 'وين طلب', 'اين طلب', 'تتبع', 'رقم الطلب', 'حاله الطلب',
                           'وين الطلب', 'الطلب حقي', 'ما وصلني', 'ما وصل', 'talabi', 'el talab',
                           'my order', 'where is my order', 'tracking', 'track my', 'track order',
                           'order status', 'order number', 'my oder',
                           'where is my parcel', 'where is my package', "where's my parcel",
                           "where's my package", 'wheres my', 'placed an order', 'update on my'])) {
        return 'order_status';
    }
    // "Cash on delivery?" names the courier but asks how to pay.
    if (assistant_has($t, ['cash on delivery', 'pay on delivery', 'payment on delivery'])) return 'payment';
    if (assistant_has($t, assistant_delivery_words()) || preg_match('/^how long\W*$/u', $t)) {
        return 'delivery';
    }
    // The ambiguous returns words, now that order and delivery have had their
    // turn: «رجعت الطلب» is a return, «رجعت اسأل عن طلبي» was answered above.
    // Word-initial only, so «الطقم يرجع؟» (is the set coming back in stock?) is
    // not a returns question.
    if (assistant_has($t, ['^رجع', 'يرجع لي', 'ترجع لي', 'ترجعون'])) return 'returns';

    // Whole words, so "cardigan" and "discount code" are not payment questions;
    // a bare "card" is not one either ("card holder"), unless that is the
    // whole message. «كاش» and «تابي» are whole words because كاشخ ("stylish")
    // and كتابي contain them.
    if (assistant_has($t, ['دفع', 'كي نت', 'كينت', 'فيزا', 'ماستر', 'الدفع عند الاستلام',
                           '^كاش$', '^الكاش$', 'بالكاش', 'اقساط', 'اقسط', 'تقسيط', '^تابي$', 'تمارا', 'adfa3',
                           'knet', 'visa', 'mastercard', 'master card', 'pay', 'pays', 'paying', 'payment',
                           'cards', 'credit card', 'debit card', 'by card', 'with card', 'with a card',
                           'accept card', 'take card', 'card payment', 'gift card',
                           'cash', 'cod', 'tpay', 't-pay', 'tabby', 'tamara', 'installment*', 'apple pay'])
        || preg_match('/^(credit |debit )?cards?\W*$/u', $t)) {
        return 'payment';
    }

    // A PRODUCT NAMED WITH A SIZE IS A SHOPPING QUESTION. «ليقنز مقاس M» and
    // "size large jacket" contain the size words below, and got the size-guide
    // sentence instead of the leggings that come in M. An accessory has no
    // size at all, so «شنطة كبيرة» (a large bag) is never a fit question.
    $c = assistant_query($text);
    if ($c['type'] && $c['size'] !== null) return 'search';
    if (array_intersect_key($c['type'], ['bag' => 1, 'cap' => 1, 'strap' => 1]) && assistant_has($t, ['كبير', 'صغير'])) {
        return 'search';
    }
    // And a size with nothing else named is a sizing question: "XL?",
    // «عندكم XL؟», "is this available in medium".
    if ($c['size'] !== null && !$c['type'] && !$c['colour'] && !$c['free']) return 'sizes';

    // Fit phrases, not bare «صغير/كبير»: those were inside «شنطة صغيرة» and
    // «خصومات كبيرة». Not a bare "fit" either: it is inside fitness and outfit.
    if (assistant_has($t, ['مقاس', 'مقاسات', 'حجم', 'مقاس صغير', 'مقاس كبير', 'صغير علي', 'كبير علي',
                           'صغيره علي', 'كبيره علي', 'يجي صغير', 'يجي كبير', 'يطلع صغير', 'يطلع كبير',
                           'طلع صغير', 'طلع كبير',
                           'size', 'sizing', 'measurement', 'it fit', 'fit me', 'the fit', 'fits', 'fitting',
                           'true to size', 'run small', 'runs small', 'run big', 'runs big', 'run large',
                           'runs large', 'how long are'])
        || preg_match('/^(عندكم |do you have |is there |any )?(size |مقاس )?(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|small|medium|large|لارج|ميديم|سمول|اكس لارج)( available| متوفر| موجود)?[\s\p{P}]*$/u', $t)) {
        return 'sizes';
    }
    // A request for a SUGGESTION, not a search for a named thing. "وش تنصح",
    // "شنو الأكثر مبيعا", "recommend something" name no product, so product
    // search would find nothing and the customer would be told the shop has
    // nothing — when the honest answer is a shelf of what is in stock. Kept
    // AFTER sizes/returns so "what size do you recommend" stays a sizing
    // question. Offers, codes, new arrivals and gifts land here too: it is the
    // intent whose answer is a real shelf. Not bare «جديد/الجديد» («ابي الجاكيت
    // الجديد» is a search), and not a bare "offer" ("do you offer this in XL").
    if (assistant_has($t, ['انصح', 'تنصح', 'نصيحه', 'اقترح', 'اقتراح', 'وش تنصح', 'شنو تنصح',
                           'الاكثر مبيعا', 'الافضل', 'الاكثر طلبا', 'عروض', 'تخفيضات', 'خصومات', 'خصم',
                           'كود', 'كوبون', 'شنو الجديد', 'وش الجديد', 'ايش الجديد', 'الجديد عندكم', 'شي جديد',
                           'جديدكم', 'وصل جديد', 'تنزيلات', 'الجمعه البيضاء', 'هديه',
                           'recommend*', 'suggest*', 'suggestion', 'best seller*', 'bestseller*',
                           'popular', 'what should i', 'on sale', 'sale', 'deal', 'offers', 'any offer',
                           'special offer', 'featured', 'discount*', 'promo*', 'coupon*', 'new arrival*',
                           "what's new", 'whats new', 'new in', 'white friday', 'black friday', 'gift*'])) {
        return 'recommend';
    }
    // A person. Not a bare "phone" while a product is named: the Gymshark
    // Phone Strap is in the catalogue, and asking for it by name handed the
    // shopper to staff as somebody wanting a human.
    if (assistant_has($t, ['تواصل', 'اتصال', 'خدمه العملاء', 'موظف', 'انسان', 'واتساب', 'رقمكم', 'اكلم',
                           'كلموني', 'اتصل', 'واتس', 'رقم التلفون', 'رقم الهاتف', 'تلفونكم', 'ايميل',
                           'اشتكي', 'شكوي', 'akalim',
                           'contact*', 'human', 'agent', 'speak to', 'speak with', 'whatsapp', 'email', 'e-mail',
                           'phone number', 'your number', 'call you', 'call me', 'customer service',
                           'customer care', 'talk to', 'a person', 'real person', 'complain*',
                           // An address change is a person's job, and contact is
                           // tested before location for exactly this.
                           'wrong address', 'change address', 'change my address', 'telephone'])
        || (assistant_has($t, ['phone']) && !$c['type'])) {
        return 'contact';
    }
    // WHERE THE SHOP IS. There is no branch to visit — Sporta is online only,
    // delivering across Kuwait — but "وين موقعكم" fell through to product
    // search and came back "I did not quite follow that", which reads as a shop
    // hiding its address. Saying plainly that it is an online shop is both true
    // and the more useful answer. Kept after `delivery`, so "متى يوصل لموقعي"
    // stays a delivery question. Not a bare "your store": "do you have
    // leggings in your store" is a search.
    if (assistant_has($t, ['وين موقعكم', 'موقعكم', 'مقركم', 'عنوانكم', 'فرع', 'فروع', 'محل',
                           'معرض', 'وين تلقونكم', 'زياره', 'استلم بنفسي', 'اجي استلم',
                           'where are you', 'your location', 'address', 'branch*', 'store location',
                           'showroom', 'visit you', 'shop location', 'where is your shop', 'where is your store',
                           'visit your shop', 'visit your store', 'physical store', 'physical shop',
                           'a store in', 'a shop in', 'pickup', 'pick up', 'pick it up'])) {
        return 'location';
    }

    // A greeting that also carries a product question is searched by
    // assistant_answer; here it is only recognised.
    if (assistant_has($t, assistant_greeting_words())) return 'greeting';

    // THANKS IS AN ANSWER, NOT A SEARCH. "شكرا" matched nothing and became a
    // product search, so the shop ended a conversation it had just handled well
    // with "I did not quite follow that" — the last thing the customer reads.
    // Tested LAST so that "thanks, where is my order" is still about the order.
    if (assistant_has($t, ['شكرا', 'مشكور', 'يعطيك العافيه', 'تسلم', 'ماقصرت', 'الله يعافيك', 'قصرت',
                           'العافيه', 'ثانكس', 'shukran', 'shokran', 'mashkoor',
                           'thanks', 'thank you', 'thx', 'appreciate it', 'cheers', 'thank u', 'thanku',
                           'ty', 'tysm'])) {
        return 'thanks';
    }

    return 'search';
}

// An order number as the customer will type it: in either alphabet's digits,
// with a stray space or hyphen after the SP, or an invisible mark pasted
// inside it.
//
// NOT ANY WORD THAT STARTS WITH "SP". The old pattern was SP + six letters, so
// "sportswear for women" — the shop's own tagline is SPORTS WEAR — was answered
// "I could not find an order with the number SPORTSWEAR", and so were
// "Puma Speedcat" and "speedcross shoes". Real numbers come from makeTrackId
// (src/lib/attempt.js): SP + two base36 integers, uppercased. Nearly all carry
// a digit; the ~1.5% that do not are still printed in CAPITALS on the
// confirmation, which an English word typed into a chat is not. The accepted
// cost: a digit-free number retyped in lowercase is missed (and "my order"
// around it still asks for the number, rather than answering wrongly).
function assistant_find_track(string $text): ?string
{
    $raw = strtr($text, ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
                         '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
                         "\u{00A0}" => ' ']);
    $raw = preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $raw) ?? $raw;
    if (preg_match_all('/(?<![A-Za-z0-9])SP[ \-]?([A-Za-z0-9]{6,28})(?![A-Za-z0-9])/i', $raw, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $m) {
            // Do not raise the 10: SPAI + Date.now().toString(36) is exactly 10.
            if (preg_match('/\d/', $m[1]) || (strlen($m[1]) >= 10 && $m[0] === strtoupper($m[0]))) {
                return 'SP' . strtoupper($m[1]);
            }
        }
    }
    return null;
}

// ------------------------------------------------------- the shop's vocabulary
//
// PRODUCT SEARCH COMPARES WORDS, NOT STRINGS, AND BOTH SIDES GO THROUGH THE
// SAME PIPELINE: normalise -> join multi-word names -> split -> stem. The
// catalogue, the question, the stop words and the dictionary below all take
// the same path.
//
// That rule is the fix. Search used to fold the QUESTION (أ→ا, ة→ه, harakat
// dropped) and then LIKE it against the RAW Arabic column, which MariaDB does
// not fold. So «أحمر» and «احمر» both found nothing (four red products exist),
// «حقيبة» typed exactly as the catalogue spells it found nothing, and «رغبي»
// missed «رَغبي». Every hamza colour was dead for Arabic shoppers.

// Names that are two words to a shopper and one thing to the shop. Run on
// both sides, before splitting, or "tank top" is two product types at once.
// Skipped for a single word, which none of these can match.
function assistant_prefold(string $f): string
{
    if (!preg_match('/[\s\-]/', $f)) return $f;
    static $rules = null;
    $b = '(?<![\p{L}\p{N}])';
    $e = '(?![\p{L}\p{N}])';
    $rules ??= [
        "/{$b}sweat[\\s\\-]?shirts?{$e}/u"         => 'sweatshirt',
        "/{$b}t[\\s\\-]?shirts?{$e}/u"             => 'tshirt',
        '/سويت\s?شيرت/u'                           => 'سويتشيرت',
        '/تي\s?شيرت/u'                             => 'تيشيرت',
        "/{$b}sports?\\s?bras?{$e}/u"              => 'bra',
        "/{$b}tank\\s?tops?{$e}/u"                 => 'tank',
        '/تانك\s?توب/u'                            => 'تانك',
        "/{$b}(?:اكس\\s?لارج|x[\\s\\-]?large){$e}/u" => 'xl',
        "/{$b}gym\\s?shark{$e}/u"                  => 'gymshark',
        '/جيم\s?شارك/u'                            => 'جيمشارك',
        "/{$b}ان بي ايه{$e}/u"                     => 'nba',
        "/{$b}ايه تي اي{$e}/u"                     => 'ate',
        "/{$b}اي سبورت وير{$e}/u"                  => 'eyesportwear',
        "/{$b}eye\\s?sport\\s?wear{$e}/u"          => 'eyesportwear',
    ];
    return preg_replace(array_keys($rules), array_values($rules), $f) ?? $f;
}

// One word, reduced to what it shares with its plural and its article.
//
// English: a trailing s, when three letters remain (leggings→legging).
// Arabic: ONE leading article (ال/وال/بال/فال/لل) and then ONE suffix
// (ات/ين/ون/ه), each only when three letters remain. Deliberately not «يه»:
// stripping it deleted the nisba ي, so «رياضية» became «رياض» and «نسائية»,
// «طاقية», «صدرية» never met their own dictionary words.
function assistant_stem(string $w): string
{
    if (preg_match('/^[a-z0-9]+$/', $w)) {
        return (strlen($w) >= 4 && str_ends_with($w, 's') && !str_ends_with($w, 'ss')) ? substr($w, 0, -1) : $w;
    }
    if (preg_match('/^(?:وال|بال|فال|لل|ال)(\p{L}{3,})$/u', $w, $m)) $w = $m[1];
    if (preg_match('/^(\p{L}{3,}?)(?:ات|ين|ون|ه)$/u', $w, $m)) $w = $m[1];
    return $w;
}

// Any text -> the words search compares.
function assistant_tokens(string $s): array
{
    $out = [];
    foreach (preg_split('/[^\p{L}\p{N}]+/u', assistant_prefold(assistant_normalise($s)), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $w) {
        $out[] = assistant_stem($w);
    }
    return $out;
}

// WHAT A SHOPPER MEANS, as a small fixed dictionary: kinds of garment, colours,
// and who it is for. Written as real words — the pipeline folds and stems them
// at load, exactly as it does the catalogue, so a needle can never be compared
// raw against a stemmed word (which is how «نسائي» once matched nothing).
function assistant_concept_words(): array
{
    return [
        'type' => [
            'short'   => ['short', 'shorts', 'شورت'],
            'legging' => ['legging', 'leggings', 'leggins', 'tights', 'ليقنز', 'ليجنز', 'لقنز', 'ليغنز'],
            'tshirt'  => ['tshirt', 'tee', 'shirt', 'تيشيرت', 'تيشرت', 'فانيلة', 'قميص', 'شيرت'],
            'jacket'  => ['jacket', 'جاكيت', 'جاكت'],
            'top'     => ['top', 'توب', 'بلوزة'],
            'bra'     => ['bra', 'ستيان', 'برا', 'صدرية'],
            'bag'     => ['bag', 'backpack', 'حقيبة', 'شنطة'],
            'cap'     => ['cap', 'hat', 'كاب', 'طاقية', 'قبعة'],
            'pant'    => ['pants', 'trousers', 'joggers', 'بنطال', 'بنطلون', 'سروال', 'ترنك'],
            'tank'    => ['tank', 'vest', 'stringer', 'singlet', 'تانك', 'ستراينجر', 'شيال'],
            'sweat'   => ['sweatshirt', 'سويتشيرت', 'سويت'],
            'strap'   => ['strap', 'armband', 'حزام'],
        ],
        'colour' => [
            'black'  => ['black', 'onyx', 'أسود', 'سوداء', 'فاحم'],
            'navy'   => ['navy', 'كحلي'],
            'grey'   => ['grey', 'gray', 'steel', 'رمادي', 'رصاصي', 'فولاذي'],
            'red'    => ['red', 'cherry', 'أحمر', 'حمراء', 'كرزي'],
            'green'  => ['green', 'army', 'olive', 'أخضر', 'خضراء', 'زيتي', 'عسكري'],
            'brown'  => ['brown', 'taupe', 'coffee', 'بني', 'قهوة'],
            'white'  => ['white', 'أبيض', 'بيضاء'],
            'pink'   => ['pink', 'وردي', 'زهري'],
            'purple' => ['purple', 'iris', 'بنفسجي', 'موف'],
            'blue'   => ['blue', 'royal', 'أزرق', 'زرقاء', 'ملكي', 'سماوي'],
        ],
        'gender' => [
            // Compared with the product's category by EQUALITY, never LIKE:
            // '%men%' is inside 'women'.
            'men'   => ['men', 'man', 'male', 'gents', 'رجالي', 'رجال', 'شباب', 'شبابي', 'husband', 'زوجي'],
            'women' => ['women', 'woman', 'ladies', 'lady', 'female', 'girls', 'نسائي', 'نساء', 'حريمي', 'حريم',
                        'بنات', 'بناتي', 'wife', 'زوجتي'],
        ],
    ];
}

// The concepts one stemmed word names: [[group, concept], ...].
//
// Equality, plus a PREFIX for Arabic garment words of four letters or more,
// because Arabic inflects a garment more than a plural s: «بنطلون» stems to
// «بنطل», and «بنطلونات» to «بنطلون», which starts with it. Colours and English
// words are equality only — "bluetooth" is not a colour.
//
// With $clitic, a one-letter و/ب/ف/ل glued to the front is tried off — but
// only when what remains is a dictionary word. Stripping it unconditionally
// turns «بلوزه» (a blouse) into «لوز» (almonds).
function assistant_concepts_of(string $tok, bool $clitic = false): array
{
    static $exact = null, $prefix = [], $memo = [];
    $key = ($clitic ? '1' : '0') . $tok;
    if (isset($memo[$key])) return $memo[$key];
    if ($exact === null) {
        $exact = [];
        foreach (assistant_concept_words() as $group => $concepts) {
            foreach ($concepts as $concept => $words) {
                foreach ($words as $w) {
                    foreach (assistant_tokens($w) as $s) {
                        $exact[$s][] = [$group, $concept];
                        if ($group === 'type' && !preg_match('/^[a-z0-9]+$/', $s) && mb_strlen($s) >= 4) {
                            $prefix[] = [$s, $group, $concept];
                        }
                    }
                }
            }
        }
    }
    $hit = $exact[$tok] ?? [];
    if (!$hit) {
        foreach ($prefix as [$n, $g, $k]) if (str_starts_with($tok, $n)) $hit[] = [$g, $k];
    }
    if (!$hit && $clitic && preg_match('/^[وبفل](\p{L}{3,})$/u', $tok, $m)) $hit = assistant_concepts_of($m[1]);
    return $memo[$key] = $hit;
}

// The three word lists search needs besides the dictionary, folded once.
function assistant_vocab(): array
{
    static $v = null;
    if ($v !== null) return $v;
    $set = function (array $words): array {
        $s = [];
        foreach ($words as $w) foreach (assistant_tokens($w) as $tok) $s[$tok] = true;
        return $s;
    };
    return $v = [
        // The padding every question is made of, in both languages, the
        // greeting words, sizes and money words (read separately), and the
        // shop's own name — which is also a brands row, and in greetings.
        'stop' => $set([
            'هل', 'عندكم', 'عندك', 'عندكو', 'عندي', 'فيه', 'فيها', 'على', 'الى', 'ابي', 'ابيه', 'ابغى', 'ابغا',
            'ودي', 'بدي', 'تبي', 'ممكن', 'لون', 'الوان', 'ابحث', 'اريد', 'بغيت', 'شنو', 'ايش', 'وين', 'شلون',
            'كيف', 'متى', 'ليش', 'حقي', 'حقك', 'الطلب', 'طلبي', 'للحين', 'الحين', 'الان', 'اليوم', 'ولا', 'اذا',
            'هذا', 'هذي', 'هذه', 'هاي', 'اقدر', 'نقدر', 'تقدر', 'عليه', 'عليها', 'متوفر', 'متوفرة', 'موجود',
            'يوجد', 'اللي', 'زين', 'حلو', 'سمحت', 'منتج', 'منتجات', 'قطعة', 'قطع', 'نوع', 'انواع', 'عطني',
            'ورني', 'اشوف', 'ايضا', 'بعد', 'غير', 'واحد', 'شيء', 'مقاس', 'مقاسات', 'سعر', 'بكم',
            'مرحبا', 'هلا', 'السلام', 'سلام', 'عليكم', 'صباح', 'الخير', 'مساء', 'اهلا',
            'لارج', 'ميديم', 'ميديوم', 'سمول', 'دينار', 'دنانير', 'ارخص', 'رخيص', 'اقل', 'تحت', 'دون', 'حدود', 'بحدود',
            'the', 'and', 'you', 'have', 'has', 'had', 'are', 'was', 'for', 'want', 'wanna', 'need', 'any', 'with',
            'from', 'show', 'some', 'something', 'anything', 'please', 'pls', 'looking', 'look', 'got', 'get', 'its',
            'there', 'here', 'your', 'what', 'where', 'when', 'how', 'can', 'could', 'would', 'will', 'this', 'that',
            'these', 'those', 'which', 'they', 'them', 'their', 'does', 'did', 'mine', 'our', 'sell', 'buy', 'stock',
            'available', 'availability', 'size', 'sizes', 'price', 'prices', 'much', 'cost', 'colour', 'color',
            'one', 'ones', 'like', 'also', 'just', 'only', 'all', 'really', 'very', 'about', 'tell', 'give', 'see',
            'find', 'store', 'shop', 'online', 'item', 'items', 'product', 'products', 'piece', 'pieces', 'thing',
            'things', 'other', 'another', 'more', 'same', 'good', 'nice', 'best', 'great', 'new', 'talk', 'someone',
            'help', 'question', 'hi', 'hello', 'hey', 'sporta', 'سبورتا', 'small', 'medium', 'large', 'xxl', 'xxxl',
            '2xl', '3xl', 'kd', 'kwd', 'under', 'below', 'less', 'than', 'cheap', 'cheaper', 'cheapest', 'max',
        ]),
        // Words that mean "sportswear" and nothing narrower. A message made
        // only of these is a request for the shelf, not a failed search —
        // otherwise the shop would say it does not carry gym clothes.
        'generic' => $set([
            'ملابس', 'لبس', 'رياضي', 'رياضية', 'رياضة', 'جيم', 'تمرين', 'تمارين', 'ركض', 'جري', 'بالغين', 'للبالغين',
            'كبار', 'clothes', 'clothing', 'wear', 'activewear', 'sportswear', 'sport', 'sports', 'sporting', 'gym', 'workout',
            'training', 'outfit', 'fitness', 'exercise', 'running', 'jogging', 'yoga', 'adult', 'adults',
        ]),
        // Things Sporta does not sell today. Only ever consulted AFTER the
        // catalogue found nothing, so the day the owner adds shoes, shoes are
        // found and this list says nothing.
        'unstocked' => $set([
            'shoe', 'shoes', 'sneaker', 'sneakers', 'trainers', 'boot', 'boots', 'sock', 'socks', 'protein',
            'supplement', 'supplements', 'mat', 'swimwear', 'swimsuit', 'hoodie', 'hoodies', 'hoody', 'tracksuit',
            'bottle', 'حذاء', 'احذية', 'جزمة', 'جزم', 'كوتش', 'جوارب', 'شراب', 'شرابات', 'بروتين', 'مكملات',
            'مايوه', 'هودي', 'تراكسوت',
        ]),
    ];
}

// A size the shopper named, as the shop stores it (STORE_SIZES), or null.
// Not "xs" (the shop has none), and never the s of "women's" or the m of
// "I'm" — the apostrophe is the guard, and normalise has already folded the
// iPhone's curly one into it.
function assistant_size_token(string $f): ?string
{
    if (preg_match("/(?<![\\p{L}\\p{N}'])(5xl|4xl|3xl|2xl|xxxl|xxl|xl|s|m|l)(?![\\p{L}\\p{N}'])/u", $f, $m)) {
        return ['xxl' => '2XL', 'xxxl' => '3XL'][$m[1]] ?? strtoupper($m[1]);
    }
    if (preg_match('/(?<![\p{L}\p{N}])(small|medium|large|سمول|ميديم|ميديوم|لارج)(?![\p{L}\p{N}])/u', $f, $m)) {
        return ['small' => 'S', 'سمول' => 'S', 'medium' => 'M', 'ميديم' => 'M', 'ميديوم' => 'M',
                'large' => 'L', 'لارج' => 'L'][$m[1]];
    }
    return null;
}

// What a message asks for, as search reads it: the concepts it names, the
// words left over, a size, a budget, and whether it wants the cheapest.
function assistant_query(string $text): array
{
    $t = assistant_normalise($text);
    $f = assistant_prefold($t);
    $v = assistant_vocab();
    $q = ['t' => $t, 'type' => [], 'colour' => [], 'gender' => [], 'free' => [], 'generic' => false,
          'unstocked' => false, 'size' => assistant_size_token($f), 'max' => null,
          'cheap' => (bool) preg_match('/(?<![a-z])(?:cheap|cheaper|cheapest)(?![a-z])|ارخص|رخيص/u', $f)];
    // A budget: "under 5 kd", «أقل من ١٠ دينار». Digits are already ASCII.
    if (preg_match('/(?:under|below|less than|cheaper than|up to|اقل من|ارخص من|تحت|دون|بحدود|حدود)\s*(\d+(?:\.\d+)?)/u', $f, $m)) {
        $q['max'] = (int) round((float) $m[1] * 1000);
    }
    foreach (preg_split('/[^\p{L}\p{N}]+/u', $f, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $w) {
        $w = assistant_stem($w);
        // Three letters or more. Two-letter words matched INSIDE product names:
        // «ما» is in «رمادي», so "my order has not arrived" got grey leggings —
        // and, because cards came back, no member of staff was ever told.
        if (mb_strlen($w) < 3 || ctype_digit($w) || isset($v['stop'][$w])) continue;
        if (isset($v['generic'][$w])) { $q['generic'] = true; continue; }
        $c = assistant_concepts_of($w, true);
        if ($c) { foreach ($c as [$g, $k]) $q[$g][$k] = true; continue; }
        if (isset($v['unstocked'][$w])) $q['unstocked'] = true;
        $q['free'][] = $w;
    }
    $q['free'] = array_values(array_unique($q['free']));
    return $q;
}

// --------------------------------------------------------------------- tools
//
// Each returns [reply, data] — data being anything the widget can render as
// something better than a sentence (an order card, a row of products).

function assistant_order(PDO $db, array $cfg, ?string $track, bool $ar, bool $eta = false): array
{
    if ($track === null) {
        // "When will my order arrive?" with no number used to get only "send
        // me your order number" — a timing question answered with no time,
        // while «متى يوصل الطلب» (no "my") got the 24 hours. The split followed
        // the possessive, not the language. Now both hear the promise.
        return [assistant_canned($cfg, $eta ? 'ask_track_eta' : 'ask_track', $ar), null];
    }
    $q = $db->prepare('select track_id, amount, payment_status, payment_method,
                              fulfilment_status, created_at
                       from orders where track_id = ?');
    $q->execute([$track]);
    $o = $q->fetch();
    if (!$o) {
        // NOT "your order is on its way". An order number that does not exist
        // is usually a typo, and saying so is the useful answer.
        //
        // A FIXED SENTENCE, with no number echoed back. It used to quote the
        // number the visitor typed, which made every invented SP token a NEW
        // sentence — and every new sentence is a new signature, i.e. a paid
        // synthesis anyone could mint in a loop. It also promised "a colleague
        // will follow up" if they sent a phone number; nothing stored the
        // number, so the next message was answered "I did not follow that".
        return [assistant_canned($cfg, 'no_order', $ar), null];
    }

    $paid = $o['payment_status'] === 'paid';
    $ful  = (string) $o['fulfilment_status'];
    // The wording is driven by BOTH columns, because they answer different
    // questions and a customer feels the difference: an unpaid order is not
    // late, it is unfinished, and telling them it is "being prepared" would
    // send them to wait for a parcel that will never be packed.
    //
    // CANCELLED FIRST, whatever the payment state. Staff can cancel from the
    // admin, and 'cancelled' matched no branch, so it fell to "being prepared,
    // delivery within 24 hours" — the customer who cancelled was told it was
    // on its way.
    if ($ful === 'cancelled') {
        $line = assistant_canned($cfg, 'stage_cancelled', $ar);
    } elseif (!$paid && $o['payment_method'] !== 'cod') {
        $line = assistant_canned($cfg, 'stage_unpaid', $ar);
    } elseif ($ful === 'delivered') {
        $line = assistant_canned($cfg, 'stage_delivered', $ar);
    } elseif ($ful === 'shipped' || $ful === 'dispatched') {
        $line = assistant_canned($cfg, 'stage_shipped', $ar);
    } elseif ($ful === '' || $ful === 'unfulfilled' || $ful === 'pending') {
        // A cash-on-delivery order is placed but nobody has started on it yet.
        // This used to fall through to "being prepared", which is a claim about
        // work that has not begun and was shown for a month-old order.
        $line = assistant_canned($cfg, 'stage_received', $ar);
    } else {
        $line = assistant_canned($cfg, 'stage_packing', $ar);
    }

    return [$line, [
        'kind'    => 'order',
        'track'   => $o['track_id'],
        'amount'  => number_format((float) $o['amount'], 3, '.', ''),
        'paid'    => $paid,
        'method'  => $o['payment_method'],
        'stage'   => $ful,
        'placed'  => $o['created_at'],
    ]];
}

// THE CATALOGUE, LOADED ONCE AND COMPARED IN PHP.
//
// Not LIKE in SQL any more: MariaDB does not fold Arabic the way normalise
// does, and a LIKE cannot rank. 46 rows today and ?r=products already hands
// the whole catalogue to every visitor, so this exposes nothing and costs
// about a millisecond. Each row carries what search and the shelf need: its
// words, its concepts, its live price (store_effective_price — the number
// checkout charges), and whether anything is left to buy.
function assistant_catalogue(PDO $db): array
{
    static $cache = [];
    $id = spl_object_id($db);
    if (isset($cache[$id])) return $cache[$id];
    $rows = $db->query(
        'select p.id, p.slug, p.name_en, p.name_ar, p.price, p.sale_price, p.sale_starts_at, p.sale_ends_at,
                p.category, p.featured, p.featured_sort, p.created_at, p.brand_slug,
                b.name_en as brand_en, b.name_ar as brand_ar,
                (select count(*) from product_variants v where v.slug = p.slug) as nvar,
                (select group_concat(v.size) from product_variants v where v.slug = p.slug and v.stock > 0) as sizes
           from products p
           left join brands b on b.slug = p.brand_slug and b.active = 1
          where p.active = 1'
    )->fetchAll();
    $stop = assistant_vocab()['stop'];
    $brands = [];
    $brandToks = [];
    foreach ($rows as &$p) {
        $eff = store_effective_price($p);
        $p['_fils'] = $eff['fils'];
        $p['_sale'] = $eff['on_sale'];
        // The storefront's rule (ProductCard): sold out when it has sizes and
        // every size is out. Without this, three sold-out leggings filled the
        // top three slots, each with an Add button.
        $p['_sizes'] = ($p['sizes'] ?? null) !== null ? explode(',', (string) $p['sizes']) : [];
        $p['_in_stock'] = (int) $p['nvar'] === 0 || $p['_sizes'] !== [];
        $bt = [];
        if (($p['brand_slug'] ?? null) !== null && $p['brand_en'] !== null) {
            foreach (assistant_tokens($p['brand_en'] . ' ' . $p['brand_ar']) as $tok) {
                if (mb_strlen($tok) >= 3 && !isset($stop[$tok])) {
                    $bt[] = $tok;
                    $brands[$tok][$p['brand_slug']] = true;
                }
            }
            $brandToks[$p['brand_slug']] = array_unique(array_merge($brandToks[$p['brand_slug']] ?? [], $bt));
        }
        $p['_tok'] = array_values(array_unique(array_merge(
            assistant_tokens($p['name_en'] . ' ' . $p['name_ar'] . ' ' . (string) $p['category']), $bt)));
        $p['_type'] = [];
        $p['_colour'] = [];
        foreach ($p['_tok'] as $tok) {
            foreach (assistant_concepts_of($tok) as [$g, $k]) {
                if ($g === 'type') $p['_type'][$k] = true;
                if ($g === 'colour') $p['_colour'][$k] = true;
            }
        }
        // Who it is for comes from the category, never the name. Outerwear
        // and accessories are for anyone.
        $p['_gender'] = in_array($p['category'], ['men', 'women'], true) ? $p['category'] : null;
    }
    unset($p);
    return $cache[$id] = ['rows' => $rows, 'brands' => $brands, 'brand_tokens' => $brandToks];
}

// A free word against a product's words: equal, or the start of one when the
// word is long enough to mean something ("sculpt", «سكالبت»). Never anywhere
// inside a word — that is how "tee" found the Steel Grey jacket.
function assistant_word_hit(array $productTokens, string $w): bool
{
    foreach ($productTokens as $pt) {
        if ($pt === $w || (mb_strlen($w) >= 4 && str_starts_with($pt, $w))) return true;
    }
    return false;
}

// Is this product from one of the brands the shopper named? By its brand row,
// or by the brand's name sitting in its own name (Vanquish is both).
function assistant_brand_hit(array $p, array $named, array $cat): bool
{
    if (($p['brand_slug'] ?? null) !== null && isset($named[$p['brand_slug']])) return true;
    foreach (array_keys($named) as $slug) {
        foreach ($cat['brand_tokens'][$slug] ?? [] as $tok) if (in_array($tok, $p['_tok'], true)) return true;
    }
    return false;
}

// How well a product answers the question. Kind of garment and brand weigh
// most, then colour, then who it is for, then any other word it matches.
function assistant_score(array $p, array $q, array $free, array $brands, array $cat): int
{
    $s = 0;
    if ($q['type'] && array_intersect_key($p['_type'], $q['type'])) $s += 10;
    if ($brands && assistant_brand_hit($p, $brands, $cat)) $s += 10;
    if ($q['colour'] && array_intersect_key($p['_colour'], $q['colour'])) $s += 5;
    if ($q['gender'] && $p['_gender'] !== null && isset($q['gender'][$p['_gender']])) $s += 3;
    foreach ($free as $w) if (assistant_word_hit($p['_tok'], $w)) $s += 4;
    return $s;
}

// The query's free words that are really brand names (NBA, «جيم شارك»).
function assistant_split_brands(array $q, array $cat): array
{
    $brands = [];
    $free = [];
    foreach ($q['free'] as $w) {
        if (isset($cat['brands'][$w])) $brands += $cat['brands'][$w];
        else $free[] = $w;
    }
    return [$brands, $free];
}

// Product search over both languages at once. The shopper types in whichever
// they think in, and the catalogue is stored in both.
//
// Returns [reply, data, missed] — `missed` is true when nothing the shopper
// asked for was found, which is what decides the n8n handoff now that a miss
// can still come back with a shelf of suggestions.
//
// RANKED, AND FILTERED BY WHAT WAS NAMED. Every word used to be OR'd into one
// LIKE with no ORDER BY and LIMIT 4, so "navy leggings" showed a navy backpack
// and a navy sweatshirt and neither navy legging. Now: a named kind of garment
// is a filter (leggings only), a named gender drops the other one, a named
// brand or budget is a filter, colour and other words rank. Then in stock
// before sold out, and four.
function assistant_search(PDO $db, array $cfg, string $text, bool $ar): array
{
    $q = assistant_query($text);
    $cat = assistant_catalogue($db);
    [$brands, $free] = assistant_split_brands($q, $cat);
    $named = $q['type'] || $q['colour'] || $q['gender'] || $brands;
    $browse = !$named && !$free;
    $filtered = $q['max'] !== null || $q['cheap'] || $q['size'] !== null;

    if ($browse && !$filtered) {
        // Only "sportswear" words: that is a request for the shelf.
        if ($q['generic']) return assistant_shelf_answer($db, $cfg, $cat, $q, [], $ar, false, false) + [2 => false];
        // Nothing searchable at all: honest ignorance, and staff are told.
        return [assistant_canned($cfg, 'no_idea', $ar), null, true];
    }

    $hits = [];
    foreach ($cat['rows'] as $p) {
        if ($q['type'] && !array_intersect_key($p['_type'], $q['type'])) continue;
        if ($q['gender'] && $p['_gender'] !== null && !isset($q['gender'][$p['_gender']])) continue;
        if ($brands && !assistant_brand_hit($p, $brands, $cat)) continue;
        if ($q['max'] !== null && $p['_fils'] > $q['max']) continue;
        $score = assistant_score($p, $q, $free, $brands, $cat);
        if (!$browse && $score === 0) continue;
        $hits[] = [$score, $p];
    }

    // A size the shopper named, in stock. If nothing has it, the closest
    // pieces are shown and the reply SAYS they are the closest.
    $relaxed = false;
    if ($q['size'] !== null && $hits) {
        $sized = array_values(array_filter($hits, fn ($h) => in_array($q['size'], $h[1]['_sizes'], true)));
        if ($sized) $hits = $sized; else $relaxed = true;
    }
    // Sold-out matches never take a slot an in-stock one could fill.
    $live = array_values(array_filter($hits, fn ($h) => $h[1]['_in_stock']));
    if ($live) $hits = $live;

    if (!$hits) {
        // SAID PLAINLY, when it is something the shop does not sell: the
        // question was understood, and "I did not follow" was untrue. Checked
        // AFTER the lookup, so it stays true the day the owner adds shoes.
        if ($q['unstocked']) {
            [$r, $d] = assistant_shelf_answer($db, $cfg, $cat, $q, $brands, $ar, false, false);
            return [$d ? assistant_canned($cfg, 'not_carried', $ar) : $r, $d, true];
        }
        // Honest ignorance, not a shelf of unrelated guesses. "do you sell live
        // goldfish" should hear what the shop CAN help with.
        return [assistant_canned($cfg, 'no_idea', $ar), null, true];
    }

    usort($hits, fn ($a, $b) =>
        [$b[0], $b[1]['_in_stock'], $q['cheap'] ? $a[1]['_fils'] : 0, $b[1]['_sale'], (int) $b[1]['featured'],
         (int) $a[1]['featured_sort'], $a[1]['name_en']]
        <=>
        [$a[0], $a[1]['_in_stock'], $q['cheap'] ? $b[1]['_fils'] : 0, $a[1]['_sale'], (int) $a[1]['featured'],
         (int) $b[1]['featured_sort'], $b[1]['name_en']]);
    $rows = array_map(fn ($h) => $h[1], array_slice($hits, 0, 4));

    // "Here is what I found" is a claim. Over four grey jackets for «جاكيت
    // سماوي» it was false, so a colour or size that is not on the top card is
    // said to be the closest match instead.
    $near = $relaxed || ($q['colour'] && !array_intersect_key($rows[0]['_colour'], $q['colour']));
    return [assistant_canned($cfg, $near ? 'found_near' : 'found', $ar), assistant_products_payload($db, $rows, $ar), false];
}

// THE SHELF: what the shop puts in front of someone who asks for ideas.
// Real rows only, ordered by what the catalogue actually knows — what was
// asked for (kind, gender, brand), in stock, a live sale price, what the owner
// featured, newest. Filters fall back to the whole shelf rather than to
// nothing. $saleOnly keeps only live sale prices; $newest leads with the most
// recently added, which is the one sense of "new" the database can prove.
function assistant_shelf(array $cat, array $q, array $brands, bool $saleOnly, bool $newest): array
{
    $pool = array_values(array_filter($cat['rows'], fn ($p) => !$saleOnly || $p['_sale']));
    $fit = array_values(array_filter($pool, fn ($p) =>
        (!$q['type'] || array_intersect_key($p['_type'], $q['type']))
        && (!$q['gender'] || $p['_gender'] === null || isset($q['gender'][$p['_gender']]))
        && (!$brands || assistant_brand_hit($p, $brands, $cat))));
    if ($fit) $pool = $fit;
    $live = array_values(array_filter($pool, fn ($p) => $p['_in_stock']));
    if ($live) $pool = $live;
    $scored = array_map(fn ($p) => [assistant_score($p, $q, [], $brands, $cat), $p], $pool);
    usort($scored, fn ($a, $b) => $newest
        ? [$b[0], (string) $b[1]['created_at'], (int) $b[1]['id']] <=> [$a[0], (string) $a[1]['created_at'], (int) $a[1]['id']]
        : [$b[0], $b[1]['_sale'], (int) $b[1]['featured'], (int) $a[1]['featured_sort'], (int) $b[1]['id']]
          <=> [$a[0], $a[1]['_sale'], (int) $a[1]['featured'], (int) $b[1]['featured_sort'], (int) $a[1]['id']]);
    return array_map(fn ($s) => $s[1], array_slice($scored, 0, 4));
}

// The shelf, with the one sentence that is true of it. "Most popular" and
// "some on offer" used to be said over every shelf: nothing here reads sales,
// and the sandbox shelf had no sale price on it. Now "on offer" is said only
// when a card on screen carries a live sale price, and asking for offers when
// there are none gets the shelf with that said plainly.
function assistant_shelf_answer(PDO $db, array $cfg, array $cat, array $q, array $brands, bool $ar, bool $sale, bool $newest): array
{
    $key = null;
    $rows = $sale ? assistant_shelf($cat, $q, $brands, true, $newest) : [];
    if ($sale && !$rows) $key = 'no_offers';
    if (!$rows) $rows = assistant_shelf($cat, $q, $brands, false, $newest);
    if (!$rows) return [assistant_canned($cfg, 'no_idea', $ar), null];
    $payload = assistant_products_payload($db, $rows, $ar);
    $key ??= in_array(true, array_column($payload['items'], 'sale'), true) ? 'recommend_sale' : 'recommend';
    return [assistant_canned($cfg, $key, $ar), $payload];
}

// What the shop wants to put in front of someone who asks "what do you
// recommend" or "what's on offer". It reads the question now: "recommend
// something for women" and «تنصحني بليقنز» used to get the same four men's
// Vanquish items as everybody else.
function assistant_recommend(PDO $db, array $cfg, string $message, bool $ar): array
{
    // "Black Friday" and «الجمعة البيضاء» name a sale, not a colour.
    $q = assistant_query(preg_replace('/\b(?:black|white) friday\b|الجمع[ةه] البيضاء/iu', ' ', $message) ?? $message);
    $t = assistant_normalise($message);
    $cat = assistant_catalogue($db);
    [$brands] = assistant_split_brands($q, $cat);
    // A coupon question is not a request for marked-down items: there is no
    // way to look a code up here, so it gets the plain shelf.
    $coupon = assistant_has($t, ['code', 'coupon*', 'promo*', 'كود', 'كوبون']);
    // Whole word «عرض»: it is inside «معرض» (a showroom).
    $sale = !$coupon && assistant_has($t, ['خصم', 'خصومات', 'عروض', '^عرض$', 'تخفيض', 'تنزيلات', 'الجمعه البيضاء',
                                           'sale', 'discount*', 'offers', 'any offer', 'special offer', 'deal',
                                           'black friday', 'white friday']);
    $newest = assistant_has($t, ['new arrival*', "what's new", 'whats new', 'new in', 'latest', 'شنو الجديد',
                                 'وش الجديد', 'ايش الجديد', 'الجديد عندكم', 'شي جديد', 'جديدكم', 'وصل جديد']);
    return assistant_shelf_answer($db, $cfg, $cat, $q, $brands, $ar, $sale, $newest);
}

// ONE shape for a product the widget can add to the cart, so search and
// recommend cannot disagree about what a buyable item looks like.
//
// It carries a NUMERIC price for the cart to display a running total — but that
// number is never authoritative: create_order re-prices every line from the
// products table, so a tampered price here changes what the customer SEES for a
// moment and nothing about what they are charged. The three-decimal string is
// what is shown; the number is what the cart sums.
//
// THE PRICE IS store_effective_price's, the same rule ?r=products and
// create_order use. It used to show any non-null sale_price — an expired sale,
// one that had not started, one above the list price — and flag it "sale",
// a number the shop would not charge. A row without the window columns would
// silently bring that back (a missing key reads as "no bound"), so it refuses.
function assistant_products_payload(PDO $db, array $rows, bool $ar): array
{
    return [
        'kind'  => 'products',
        'items' => array_map(function ($p) use ($ar) {
            if (!array_key_exists('sale_starts_at', $p) || !array_key_exists('sale_ends_at', $p)
                || !array_key_exists('nvar', $p)) {
                throw new LogicException('assistant_products_payload needs rows from assistant_catalogue');
            }
            $eff = store_effective_price($p);
            return [
                'slug'      => $p['slug'],
                'name'      => $ar ? $p['name_ar'] : $p['name_en'],
                'name_en'   => $p['name_en'],
                'name_ar'   => $p['name_ar'],
                'price'     => store_kwd($eff['fils']),
                'price_kwd' => $eff['fils'] / 1000,
                'sale'      => $eff['on_sale'],
                'category'  => $p['category'],
                // Whether it needs a size chosen first. A garment with per-size
                // stock rows must be picked in a size before it can be ordered —
                // create_order refuses it with size_required_<slug> otherwise —
                // so the widget sends those to the product page instead of
                // dropping a size-less line in the bag that fails at checkout.
                'has_sizes' => (int) $p['nvar'] > 0,
                // The widget shows an Add button on a buyable row. The order it
                // eventually places goes through the SAME create_order every
                // other checkout uses, priced server-side; this flag is a UI
                // affordance, not an authority.
                'buyable'   => true,
            ];
        }, $rows),
    ];
}

// ------------------------------------------------------------ fixed answers
//
// THE CHECKOUT, AS IT IS RIGHT NOW. The delivery fee and the payment methods
// are the owner's settings, and a bank method is only offered once its gateway
// config is ready — so they are read, never written into a sentence. Null when
// the settings cannot be read at all, and the sentences then say what they
// said before (true, if less specific).
function assistant_checkout_facts(PDO $db): ?array
{
    if (!function_exists('store_public_checkout_setting')) return null;
    try {
        return store_public_checkout_setting($db);
    } catch (Throwable $e) {
        return null;
    }
}

// "How do I pay" answered with the methods actually on offer. It used to be
// "shown at checkout … choose one of the options shown there", which answers
// nothing, including "do you take Visa". No card brands and no QR are named:
// the shop does not promise what the gateway decides.
function assistant_payment_line(?array $c, bool $ar, string $phone): string
{
    if ($c === null) {
        return $ar ? 'تظهر طرق الدفع المتاحة لطلبك في صفحة إتمام الشراء قبل تأكيده. اختر إحدى الطرق المعروضة هناك.'
                   : 'The payment methods currently available for your order are shown at checkout before you confirm it. Choose one of the options shown there.';
    }
    $names = ['knet' => ['بكي نت', 'by KNET'], 'tpay' => ['إلكترونيًا عبر تي-باي', 'online with T-Pay'],
              'cod' => ['نقدًا عند الاستلام', 'cash on delivery']];
    $list = [];
    foreach ((array) ($c['methods'] ?? []) as $m) if (isset($names[$m])) $list[] = $names[$m][$ar ? 0 : 1];
    if (!$list) {
        return $ar ? 'الدفع غير متاح في الموقع الآن. راسلنا على واتساب ' . "\u{200E}" . $phone . ' ونساعدك.'
                   : 'Checkout payment is not available right now. Message us on WhatsApp ' . $phone . ' and we will help.';
    }
    if ($ar) return 'عند إتمام الطلب تقدر تدفع ' . implode(' أو ', $list) . '.';
    $last = array_pop($list);
    return 'At checkout you can pay ' . ($list ? implode(', ', $list) . ' or ' : '') . $last . '.';
}

// THE SENTENCES THE SHOP CAN SAY WITHOUT LOOKING ANYTHING UP, and the reason
// they live in a table instead of inside the switch that used to hold them:
// the voice cache is warmed from this list, so a sentence that exists twice is
// a sentence the warmer buys in one spelling and the customer requests in
// another. Nothing breaks visibly — the shop just pays for audio it already
// owns, on the exact answers it says most often, for ever.
//
// One list, read by both. Edit a line here and the warmer warms the new one.
// The two that depend on settings (delivery, payment) are built from
// $cfg['_checkout'], which the answer and the warmer resolve the same way.
function assistant_canned(array $cfg, string $intent, bool $ar): ?string
{
    $phone = (string) ($cfg['shop_phone'] ?? '+965 22091914');
    $email = (string) ($cfg['shop_email'] ?? 'cs@sporta.com.kw');
    // THE NUMBER READS BACKWARDS IN AN ARABIC BUBBLE without a left-to-right
    // mark in front of it: measured in Chromium at dir=rtl, "+965 22091914"
    // displayed as "22091914 965+". The site's own pages (Terms, About) carry
    // the same mark. Arabic lines use $phoneRtl; English lines use $phone.
    // assistant_speech_prep drops the mark before anything is read aloud.
    $phoneRtl = "\u{200E}" . $phone;

    // The fee, from the owner's setting. A literal 1000 fallback, not the
    // constant: this table is built on every call, including from the warmer.
    // At 1000 fils the sentences are byte-for-byte the ones the shop always
    // said, so audio already in the cache stays valid.
    $fils = max(0, (int) ($cfg['_checkout']['delivery_fee_fils'] ?? 1000));
    $fee = $fils % 1000 === 0 ? (string) intdiv($fils, 1000) : number_format($fils / 1000, 3, '.', '');
    $feeAr = strtr($fee, ['0'=>'٠','1'=>'١','2'=>'٢','3'=>'٣','4'=>'٤','5'=>'٥','6'=>'٦','7'=>'٧','8'=>'٨','9'=>'٩','.'=>'٫']);

    $t = [
        'delivery' => $fils > 0 ? [
            'ar' => 'التوصيل داخل الكويت خلال ٢٤ ساعة للطلبات المؤكدة، ورسوم التوصيل ' . $feeAr . ' د.ك لجميع مناطق الكويت. يصلك اتصال من المندوب قبل الوصول.',
            'en' => 'Delivery inside Kuwait is within 24 hours for confirmed orders, and it costs ' . $fee . ' KWD to every area. The courier calls before arriving.',
        ] : [
            'ar' => 'التوصيل داخل الكويت خلال ٢٤ ساعة للطلبات المؤكدة، ومجاني لجميع مناطق الكويت. يصلك اتصال من المندوب قبل الوصول.',
            'en' => 'Delivery inside Kuwait is within 24 hours for confirmed orders, and it is free to every area. The courier calls before arriving.',
        ],
        'returns' => [
            // 14 days must match /returns and the Product structured data.
            // Free, the condition (/terms §5), the one exception the product
            // pages state, and HOW to start — /returns takes the order number
            // and the phone on the order. It used to end "contact us … to
            // arrange the request", with no channel, and «لترتيب الطلب» read
            // as "to arrange the ORDER".
            'ar' => 'يمكنك الإرجاع أو الاستبدال مجانًا خلال ١٤ يومًا من الاستلام، إذا كانت القطعة غير ملبوسة ومعها البطاقات. الملابس النسائية لا تُستبدل. ابدأ من صفحة الإرجاع برقم طلبك ورقم الهاتف المسجّل فيه، أو راسلنا على واتساب ' . $phoneRtl . '.',
            'en' => 'You can return or exchange an item free within 14 days of delivery, if it is unworn and has its tags. Women\'s clothing cannot be exchanged. Start on our Returns page with your order number and the phone number on the order, or WhatsApp us on ' . $phone . '.',
        ],
        'payment' => [
            'ar' => assistant_payment_line($cfg['_checkout'] ?? null, true, $phone),
            'en' => assistant_payment_line($cfg['_checkout'] ?? null, false, $phone),
        ],
        'sizes' => [
            // The size guide's own advice, unconditionally: it says take the
            // larger one, not "for the oversized fits". And only items that
            // come in sizes have a guide — a backpack does not.
            'ar' => 'دليل المقاسات موجود في صفحة كل قطعة تأتي بمقاسات. إذا كنت بين مقاسين ننصح بالمقاس الأكبر، وإذا احترت راسلنا على واتساب ' . $phoneRtl . '.',
            'en' => 'Every item that comes in sizes has a size guide on its page. If you are between two sizes, we recommend the larger one — and if you are unsure, message us on WhatsApp ' . $phone . '.',
        ],
        'contact' => [
            'ar' => 'يسعدنا خدمتك عبر واتساب أو الاتصال على ' . $phoneRtl . '، أو عبر البريد ' . $email,
            'en' => 'We are happy to help on WhatsApp or by phone at ' . $phone . ', or by email at ' . $email,
        ],
        // WHAT THE SHOP CAN HONESTLY PROMISE ABOUT CANCELLING. There is no
        // self-service cancel button, and inventing one would send the customer
        // hunting for a control that does not exist. So it says the true thing:
        // be quick, reach a human, and if it has already gone out, the published
        // route — a return within 14 days — is the way. It used to add "refuse
        // it at the door", which no policy page says.
        'cancel' => [
            'ar' => 'نقدر نلغي الطلب قبل ما يطلع مع المندوب. تواصل معنا فورًا باتصال أو واتساب على ' . $phoneRtl
                  . ' ومعك رقم الطلب. وإذا كان طلع للتوصيل، تقدر ترجعه خلال ١٤ يومًا من الاستلام.',
            'en' => 'We can cancel an order before it leaves with the courier. Call or WhatsApp us right away on ' . $phone
                  . ' with your order number. If it has already gone out for delivery, you can return it within 14 days of delivery.',
        ],
        // ONLINE ONLY, SAID PLAINLY. There is no branch, and a shop that will
        // not say where it is reads as one with something to hide.
        'location' => [
            'ar' => 'سبورتا متجر إلكتروني، ما عندنا فرع تزوره. نوصّل لجميع مناطق الكويت خلال ٢٤ ساعة، وتقدر تتواصل معنا على '
                  . $phoneRtl . ' أو ' . $email,
            'en' => 'Sporta is an online shop — there is no branch to visit. We deliver to every area in Kuwait within 24 hours, and you can reach us on '
                  . $phone . ' or ' . $email,
        ],
        // One voice per reply: it used to open in Gulf first person and close
        // in formal MSA with a calque («يومًا سعيدًا من سبورتا»).
        'thanks' => [
            'ar' => 'العفو، وأنا هني إذا احتجت أي شي ثاني.',
            'en' => 'Happy to help. I am here if you need anything else.',
        ],
        // What the chips ask about, payment included, as an Arabic list joined
        // with و rather than English commas.
        'greeting' => [
            'ar' => 'أهلًا بك في سبورتا. أقدر أتحقق من طلبك، وأشرح لك التوصيل والإرجاع والدفع، وأساعدك في اختيار المنتج والمقاس.',
            'en' => 'Welcome to Sporta. I can check your order, explain delivery, returns and payment, and help you choose a product and a size.',
        ],
        // Not reachable as an intent — these are the fixed replies the two
        // database-backed tools fall back to, and the voice warms them too
        // because "send me your order number" is said many times a day.
        'ask_track' => [
            'ar' => 'أرسل لي رقم الطلب (يبدأ بـ SP) وسأتحقق من حالته فورًا.',
            'en' => 'Send me your order number (it starts with SP) and I will check it right away.',
        ],
        // The same request, for someone who asked WHEN: the promise first.
        'ask_track_eta' => [
            'ar' => 'التوصيل داخل الكويت خلال ٢٤ ساعة للطلبات المؤكدة. أرسل لي رقم الطلب (يبدأ بـ SP) وسأتحقق من حالته فورًا.',
            'en' => 'Delivery inside Kuwait is within 24 hours for confirmed orders. Send me your order number (it starts with SP) and I will check it right away.',
        ],
        'stage_received' => [
            'ar' => 'استلمنا طلبك وهو بانتظار التأكيد من فريقنا قبل التجهيز. إذا مرّ وقت طويل، أرسل لنا رقم الطلب على واتساب ' . $phoneRtl . '.',
            'en' => 'We have received your order and it is waiting for our team to confirm it before preparation. If it has been a while, message us the order number on WhatsApp ' . $phone . '.',
        ],
        // «استلمنا طلبك», not «تم استلام الطلب»: everywhere else here «الاستلام»
        // means DELIVERY (١٤ يومًا من الاستلام), so the passive read as "the order
        // was delivered".
        'stage_packing' => [
            'ar' => 'استلمنا طلبك وهو قيد التجهيز. الطلبات المؤكدة داخل الكويت تصل خلال ٢٤ ساعة.',
            'en' => 'We have your order and it is being prepared. Confirmed orders inside Kuwait arrive within 24 hours.',
        ],
        'stage_shipped' => [
            'ar' => 'الطلب مع المندوب الآن وفي طريقه إليك.',
            'en' => 'Your order is with the courier and on its way to you.',
        ],
        // The moment the return window starts, so it says how to use it.
        'stage_delivered' => [
            'ar' => 'تم تسليم هذا الطلب. وإذا أردت إرجاع قطعة أو استبدالها، فلديك ١٤ يومًا من الاستلام، ويمكنك البدء من صفحة الإرجاع.',
            'en' => 'This order has been delivered. If anything is not right, you have 14 days from delivery to return or exchange it — start on our Returns page.',
        ],
        // TRUE FOR pending, failed AND review. It used to say "try again from
        // the order tracking page", but the gateways only start a new attempt
        // for a pending order whose stock is still held — a declined one is
        // 'failed', and 'review' is the state where the money may already have
        // been taken, so that sentence invited a second payment.
        'stage_unpaid' => [
            'ar' => 'لم يتأكد دفع هذا الطلب، لذلك لم يدخل التجهيز. إذا خُصم المبلغ من حسابك، راسلنا على واتساب ' . $phoneRtl . ' مع رقم الطلب، وإن لم يُخصم يمكنك الطلب من جديد.',
            'en' => 'Payment for this order is not confirmed, so it has not gone into preparation. If money was taken from your account, WhatsApp us on ' . $phone . ' with the order number; if not, you can order again.',
        ],
        'stage_cancelled' => [
            'ar' => 'تم إلغاء هذا الطلب، لذلك لن يُجهَّز ولن يُوصَّل. إذا كان لديك سؤال عنه، راسلنا على واتساب ' . $phoneRtl . ' مع رقم الطلب.',
            'en' => 'This order has been cancelled, so it will not be prepared or delivered. If you have a question about it, message us on WhatsApp ' . $phone . ' with the order number.',
        ],
        'no_order' => [
            'ar' => 'لم أجد طلبًا بهذا الرقم. تأكد منه كما يظهر في رسالة التأكيد، أو راسلنا على واتساب ' . $phoneRtl . ' ونساعدك.',
            'en' => 'I could not find an order with that number. Check it against your confirmation message, or message us on WhatsApp ' . $phone . ' and we will help.',
        ],
        // Honest for a product miss AND an unrecognised question. It used to
        // say "I did not follow" to a question it had understood, and «لم أفهم
        // طلبك» reads first as "I did not understand your ORDER".
        'no_idea' => [
            'ar' => 'ما لقيت شي يطابق كلامك في المتجر. جرّب اسم القطعة بكلمة ثانية، أو اسألني عن طلبك أو التوصيل أو الإرجاع أو الدفع أو المقاسات.',
            'en' => 'I could not find anything in the shop that matches that. Try another word for the item, or ask me about your order, delivery, returns, payment or sizes.',
        ],
        'found' => [
            'ar' => 'وجدت هذه المنتجات:',
            'en' => 'Here is what I found:',
        ],
        // Not «طلبك» here either, for the same reason as no_idea.
        'found_near' => [
            'ar' => 'ما لقيت نفس اللون أو المقاس اللي تبيه، هذي أقرب القطع عندنا:',
            'en' => 'I could not find that exact colour or size, so here are the closest pieces we have:',
        ],
        'not_carried' => [
            'ar' => 'هذا ما عندنا حاليًا. هذي قطع من تشكيلتنا ممكن تعجبك، أو اكتب نوع القطعة واللون، مثل: ليقنز أسود.',
            'en' => 'We do not carry that right now. Here are a few pieces you might like, or type a piece and a colour, like black leggings.',
        ],
        // Each says only what the shelf query proves. "Most popular" is not
        // one of those things: nothing here reads sales.
        'recommend' => [
            'ar' => 'هذي مختارات من تشكيلتنا. أضف اللي يعجبك للسلة وأنا أكمل معك الطلب.',
            'en' => 'Here are a few picks from our range. Add what you like to the bag and I will take you through checkout.',
        ],
        'recommend_sale' => [
            'ar' => 'هذي مختارات من تشكيلتنا، وبعضها عليه عرض الحين. أضف اللي يعجبك للسلة وأنا أكمل معك الطلب.',
            'en' => 'Here are a few picks from our range, some of them on offer right now. Add what you like to the bag and I will take you through checkout.',
        ],
        // About marked-down ITEMS only, which the query does prove. Not "no
        // offers": an automatic discount rule is an offer too, and the shelf
        // never reads those.
        'no_offers' => [
            'ar' => 'ما فيه قطع عليها تخفيض الحين، بس هذي مختارات من تشكيلتنا. أضف اللي يعجبك للسلة وأنا أكمل معك الطلب.',
            'en' => 'Nothing is marked down right now, but here are a few picks from our range. Add what you like to the bag and I will take you through checkout.',
        ],
        'in_cart' => [
            'ar' => 'أضفته للسلة. تبي تضيف شي ثاني، أو نكمل الطلب؟',
            'en' => 'Added to your bag. Add anything else, or shall we check out?',
        ],
    ];

    return $t[$intent][$ar ? 'ar' : 'en'] ?? null;
}

// Every fixed sentence, both languages — what the voice warmer buys up front,
// and the only sentences that are ever signed for speech (assistant_answer).
// Derived from the table above, so it cannot list a sentence the shop no
// longer says or miss one it just started saying.
//
// The settings-dependent lines are resolved here the same way the answer
// resolves them: from $cfg['_checkout'] when the caller already has it, else
// from the database. cron-voice.php calls this with the config alone, so it
// reads the same row the API reads, and warms the sentence the API will say.
function assistant_canned_lines(array $cfg, ?PDO $db = null): array
{
    if (!array_key_exists('_checkout', $cfg)) {
        $cfg['_checkout'] = $db !== null ? assistant_checkout_facts($db)
            : (function_exists('store_db') && (string) ($cfg['db_name'] ?? '') !== '' ? assistant_checkout_facts(store_db()) : null);
    }
    $keys = ['delivery', 'returns', 'payment', 'sizes', 'contact', 'cancel', 'location', 'thanks',
             'greeting', 'ask_track', 'ask_track_eta',
             'stage_received', 'stage_packing', 'stage_shipped', 'stage_delivered', 'stage_unpaid',
             'stage_cancelled', 'no_order', 'no_idea', 'found', 'found_near', 'not_carried',
             'recommend', 'recommend_sale', 'no_offers', 'in_cart'];
    $out = ['ar' => [], 'en' => []];
    foreach ($keys as $k) {
        $out['ar'][] = assistant_canned($cfg, $k, true);
        $out['en'][] = assistant_canned($cfg, $k, false);
    }
    return $out;
}

// ------------------------------------------------------ the optional LLM seam
//
// Returns null unless a key is configured, and null is the normal case. When
// it IS configured the model receives the shop's answer, the data behind it,
// and the customer's message, and is asked only to word the reply.
//
// It is never given the database, never asked what an order's status is, and
// its answer is discarded if the request fails or is slow — the deterministic
// reply is already in hand, so the fallback costs nothing. A shop assistant
// that breaks when a card expires or an API has an outage is worse than one
// that is merely plain.

// The request, extracted so the test can assert exactly what is sent.
//
// THE FACTS ARE IN `system`, THE CUSTOMER IS IN `messages`. They used to share
// one user string, "FACTS: … CUSTOMER: …", so a customer could type their own
// FACTS section. And "say you will pass it to a colleague" is gone: a handoff
// only happens for contact, cancel and a failed search, so a reworded
// delivery answer promised a follow-up nobody would ever receive.
//
// Haiku 5.5 thinks by default and its first content block can be a thinking
// block; thinking off and low effort keep a two-sentence rewording inside the
// 6 s timeout and the 300 tokens. Sent ONLY to that family: other models the
// owner might configure reject one or both fields with a 400.
function assistant_llm_request(array $cfg, string $message, string $reply, ?array $data, bool $ar): array
{
    $json = $data ? (string) json_encode($data, JSON_UNESCAPED_UNICODE) : '';
    $system = ($ar ? 'Reply in Arabic. ' : 'Reply in English. ')
        . 'You are the assistant for Sporta, a sportswear shop in Kuwait. Reword the SHOP ANSWER for the customer. '
        . 'Keep every number, price, phone number, email address and order number exactly as written. '
        . 'Never add a status, price, fee, discount, date, stock level or promise of follow-up. '
        . 'If the customer asks for anything the SHOP ANSWER does not cover, output the SHOP ANSWER unchanged. '
        . 'Two sentences at most.'
        . "\n\nSHOP ANSWER:\n" . $reply
        . ($json !== '' ? "\n\nDATA (reference only; never output JSON):\n" . $json : '');
    $model = (string) ($cfg['ai_model'] ?? 'claude-haiku-5-5');
    $req = ['model' => $model, 'max_tokens' => 300, 'system' => $system,
            'messages' => [['role' => 'user', 'content' => $message]]];
    if (str_starts_with($model, 'claude-haiku-5')) {
        $req['thinking'] = ['type' => 'disabled'];
        $req['output_config'] = ['effort' => 'low'];
    }
    return $req;
}

// The model's text, or null — and null whenever it is anything but a
// rewording of what the shop already said. A cut-off reply (max_tokens), a
// refusal, an over-long bubble, or ANY number, SP order number, link or email
// address that is not in the shop's own answer and data sends the
// deterministic reply instead. Numbers are compared as whole tokens, so an
// invented "4" does not pass on the "24" in the facts; the SP pattern is
// case-sensitive and needs a digit, so "Sporta" is not an order number.
function assistant_llm_accept(?array $j, string $reply, ?array $data): ?string
{
    if ($j === null || ($j['stop_reason'] ?? '') !== 'end_turn') return null;
    $out = '';
    foreach ((array) ($j['content'] ?? []) as $b) {
        if (is_array($b) && ($b['type'] ?? '') === 'text') { $out = trim((string) ($b['text'] ?? '')); break; }
    }
    if ($out === '' || mb_strlen($out) > 400) return null;
    $tok = function (string $s): array {
        $s = strtr($s, ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
                        '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9','٫'=>'.']);
        preg_match_all('/\d+(?:\.\d+)?|(?<![A-Za-z0-9])SP(?=[A-Z0-9]*\d)[A-Z0-9]{4,}|https?:\/\/\S+|www\.\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/u', $s, $m);
        return array_map(fn ($x) => rtrim($x, '.,'), $m[0]);
    };
    $allowed = $tok($reply . ' ' . ($data ? (string) json_encode($data, JSON_UNESCAPED_UNICODE) : ''));
    foreach ($tok($out) as $t) if (!in_array($t, $allowed, true)) return null;
    return $out;
}

function assistant_llm(array $cfg, string $message, string $reply, ?array $data, bool $ar): ?string
{
    $key = (string) ($cfg['ai_key'] ?? '');
    $url = (string) ($cfg['ai_url'] ?? '');
    if ($key === '' || $url === '') return null;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        // Short on purpose. This runs while a customer waits on a Kuwaiti
        // mobile connection, and the deterministic answer is already written.
        CURLOPT_TIMEOUT => 6,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $key,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => json_encode(assistant_llm_request($cfg, $message, $reply, $data, $ar), JSON_UNESCAPED_UNICODE),
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body)) return null;
    $j = json_decode($body, true);
    return assistant_llm_accept(is_array($j) ? $j : null, $reply, $data);
}

// ------------------------------------------------------------------- the ask

// What is left of a greeting once the greeting is taken out — so "صباح
// الخير، عندكم ليقنز؟" can be seen to be a leggings question.
function assistant_after_greeting(string $t): string
{
    static $res = null;
    if ($res === null) {
        $res = [];
        $fill = ['عليكم', 'ورحمه الله', 'وبركاته', 'الخير', 'النور', 'والله', 'يا', 'عندي سؤال', 'سؤال', 'ممكن',
                 'مساعده', 'ساعدني', 'سبورتا', 'there', 'all', 'team', 'i need help', 'need help', 'help',
                 'i have a question', 'question', 'please', 'pls', 'sporta'];
        foreach (array_merge(assistant_greeting_words(), $fill) as $g) {
            $open = $g[0] === '^' && !str_ends_with($g, '$');
            $g = assistant_normalise(trim($g, '^$*'));
            if ($g === '') continue;
            // «^مرحب» is a word START, so it takes the rest of the word with it.
            $res[] = '/(?<![\p{L}\p{N}])' . preg_quote($g, '/') . ($open ? '\p{L}*' : '(?![\p{L}\p{N}])') . '/u';
        }
    }
    return trim(preg_replace($res, ' ', $t) ?? $t);
}

function assistant_answer(PDO $db, array $cfg, string $message, string $lang): array
{
    $ar = $lang === 'ar';
    $intent = assistant_intent($message);
    $reply = null;
    $data = null;
    $missed = false;

    // The two answers built from settings read them now, and only those two:
    // the rest of the shop's questions should not pay for the lookup.
    if ($intent === 'payment' || $intent === 'delivery') $cfg['_checkout'] = assistant_checkout_facts($db);

    // A GREETING THAT ALSO ASKS FOR SOMETHING. «السلام عليكم، عندكم شورت؟» is how
    // a Gulf customer opens a chat, and it got the welcome line and nothing
    // else while the shop has the shorts. Searched only when something besides
    // the greeting is left, and kept a greeting unless the search came back
    // with cards — so "hi, how are you?" is still answered as a hello, not as
    // a failed search handed to staff.
    if ($intent === 'greeting'
        && preg_match('/[\p{L}\p{N}]{3,}/u', assistant_after_greeting(assistant_normalise($message)))) {
        [$r, $d, $m] = assistant_search($db, $cfg, $message, $ar);
        if ($d) { $intent = 'search'; $reply = $r; $data = $d; $missed = $m; }
    }

    if ($reply === null) {
        switch ($intent) {
            case 'order_status':
                $eta = assistant_has(assistant_normalise($message), assistant_delivery_words());
                [$reply, $data] = assistant_order($db, $cfg, assistant_find_track($message), $ar, $eta);
                break;
            case 'search':
                [$reply, $data, $missed] = assistant_search($db, $cfg, $message, $ar);
                break;
            case 'recommend':
                [$reply, $data] = assistant_recommend($db, $cfg, $message, $ar);
                break;
            default:
                // Everything else is a fixed sentence — see assistant_canned().
                $reply = assistant_canned($cfg, $intent, $ar)
                    ?? assistant_canned($cfg, 'greeting', $ar);
        }
    }

    // The model, if there is one, only rewords what is already true. Its
    // answer repeated word for word is no rewording at all.
    $better = assistant_llm($cfg, $message, $reply, $data, $ar);
    if ($better === $reply) $better = null;
    $final = $better ?? $reply;

    // Hand off to n8n exactly where the assistant runs out: the customer asked
    // for a person, or the question found nothing the shop sells. Handing off
    // every message would make the workflow a transcript log, which is not what
    // it is for.
    // `cancel` joins them because it is the one intent where the fixed answer
    // is not the end of the matter: the customer has asked to stop something
    // that is moving, the shop can only honour it by acting, and the reply
    // tells them to telephone. If nobody is told, the answer is advice nobody
    // followed up — so it goes out with the other two.
    //
    // THROTTLED, in two buckets. Every handoff is an email in the shop's
    // inbox, and 30 messages a minute from one IP was 30 emails of whatever
    // text the sender wrote. A person/cancel request is limited like a
    // support ticket (6 per 10 minutes), and failed searches have their own
    // bucket, so a burst of nonsense cannot starve a real cancellation. Only
    // counted when a handoff would actually be sent.
    $person = $intent === 'contact' || $intent === 'cancel';
    $gap    = $intent === 'search' && ($missed || !$data);
    if (($person || $gap)
        && (string) ($cfg['n8n_webhook'] ?? '') !== '' && (string) ($cfg['n8n_secret'] ?? '') !== ''
        && (!function_exists('store_rate_limit_hit')
            || store_rate_limit_hit($db, $person ? 'assistant_handoff_person' : 'assistant_handoff_gap',
                                    store_client_ip(), $person ? 6 : 10, 600)['allowed'])) {
        assistant_handoff($cfg, $message, $final, $intent, $lang);
    }

    $out = ['intent' => $intent, 'reply' => $final, 'data' => $data,
            'source' => $better === null ? 'shop' : 'shop+ai'];

    // The signature, not the audio. Speech is a second request the visitor
    // makes only if they press the speaker — synthesising every answer aloud
    // would bill the shop for words nobody listened to, and would put a
    // ten-second upstream call in front of a reply that is already written.
    //
    // ONLY THE SHOP'S OWN FIXED SENTENCES ARE SIGNED. Signing whatever was
    // said made every sentence the visitor could steer — an invented order
    // number echoed back, a model's rewording — a new paid synthesis, minted
    // in a loop. The shop's sentences are a fixed, warmable set, and every
    // non-model answer is one of them. The settings-dependent ones are
    // compared as built for THIS answer; the rest do not depend on them.
    if (assistant_speech_available($cfg) && $better === null) {
        if (!array_key_exists('_checkout', $cfg)) $cfg['_checkout'] = null;
        if (in_array($final, assistant_canned_lines($cfg)[$ar ? 'ar' : 'en'], true)) {
            $out['speak'] = assistant_speech_sig($cfg, $final, $lang);
        }
    }

    return $out;
}

// ------------------------------------------------------------------- the voice
//
// ELEVENLABS, PROXIED — the key never reaches the browser, and neither does
// the ability to spend it.
//
// The obvious build is an endpoint that takes text and returns speech. That
// endpoint is a free text-to-speech service for the entire internet, billed to
// this shop: one loop posting Moby-Dick a paragraph at a time is the whole
// month's budget. So the browser cannot ask for arbitrary speech at all.
//
// Every assistant reply comes back with a SIGNATURE — HMAC of the exact text,
// keyed on cron_key, which only the server knows. say.php synthesises text
// whose signature verifies and refuses everything else. The browser can
// therefore ask for the sentence the shop just said to it, and for nothing
// else, ever.
function assistant_speech_sig(array $cfg, string $text, string $lang): string
{
    // Truncated to 32 hex characters: this is an anti-abuse tag on a public
    // sentence, not a secret, and 128 bits is far past what forging it is
    // worth. The full digest would only make the URL longer.
    return substr(hash_hmac('sha256', $lang . "\0" . $text, (string) ($cfg['cron_key'] ?? '')), 0, 32);
}

function assistant_speech_available(array $cfg): bool
{
    return ($cfg['tts_key'] ?? '') !== '' && ($cfg['tts_voice_id'] ?? '') !== ''
        && ($cfg['cron_key'] ?? '') !== '';
}

// ------------------------------------------------- what the sentence SOUNDS like
//
// THE TEXT ON SCREEN AND THE TEXT TO READ ALOUD ARE NOT THE SAME STRING, and
// assuming they were is the difference between a voice that sounds like a shop
// and one that sounds broken. Two cases, both of which happen on the most
// important sentences the assistant says:
//
//   "لم أجد طلبًا بالرقم SP1AU702NKHTKDV"
//       A fifteen-character random Latin token sitting in an Arabic sentence.
//       A multilingual model treats it as a WORD and tries to pronounce it —
//       the customer hears a syllable soup and cannot check it against the SMS
//       in their other hand, which is the entire reason that sentence exists.
//       Spaced out, it is read as characters: ess, pee, one, ay, you…
//
//   "+965 22091914"
//       Eight digits in a row is a NUMBER to a TTS model, so it says "twenty-two
//       million, ninety-one thousand, nine hundred and fourteen". Nobody can
//       dial that. Phone numbers are read digit by digit in every language.
//
// This runs AFTER the signature check and does NOT change the cache key: what
// is signed and cached is the sentence the shop actually said. This is a
// pronunciation hint applied on the way out, so fixing pronunciation never
// invalidates a signature the browser is already holding.
function assistant_speech_prep(string $text, string $lang): string
{
    // The left-to-right mark in front of the phone number in Arabic replies
    // (see assistant_canned) is for the eye, not the ear.
    $text = str_replace("\u{200E}", '', $text);

    // Order numbers, spelled. 4+ trailing characters so SP-anything is caught,
    // and the whole token is upper-cased first so the model does not read a
    // lowercase run as a word.
    $text = preg_replace_callback('/\b(SP[A-Za-z0-9]{4,28})\b/', function ($m) {
        return implode(' ', str_split(strtoupper($m[1])));
    }, $text) ?? $text;

    // Long digit runs — phone numbers, and nothing else the shop says. Prices
    // are three-decimal (4.000 KWD) and must NOT be split: "four point zero
    // zero zero" is right and "four zero zero zero" is not, so the pattern
    // requires 7+ digits with no decimal point attached.
    $text = preg_replace_callback('/(?<![\d.])(\d{7,})(?![\d.])/', function ($m) {
        return implode(' ', str_split($m[1]));
    }, $text) ?? $text;

    // A country code reads as a number too: +965 is "plus nine sixty-five".
    $text = preg_replace_callback('/\+(\d{1,4})\b/', function ($m) use ($lang) {
        return ($lang === 'ar' ? 'زائد ' : 'plus ') . implode(' ', str_split($m[1]));
    }, $text) ?? $text;

    // AN EMAIL ADDRESS IS NOT A WORD. "cs@sporta.com.kw" was handed to the
    // model whole and came back as a syllable — and this is the CONTACT answer,
    // the one sentence whose entire job is to be written down by someone
    // holding a phone. Spoken as its parts, it can be transcribed.
    $text = preg_replace_callback('/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/',
        function ($m) use ($lang) {
            $at  = $lang === 'ar' ? ' آت ' : ' at ';
            $dot = $lang === 'ar' ? ' دوت ' : ' dot ';
            // The local part is spelled out — "cs" is initials, not a word —
            // while the domain is left as words joined by "dot", because
            // "sporta" is the brand and must sound like itself.
            $user = implode(' ', str_split($m[1]));
            $host = str_replace('.', $dot, $m[2]);
            return $user . $at . $host;
        }, $text) ?? $text;

    // THE CURRENCY. "1 KWD" was read letter by letter as "kay double-you dee",
    // and «د.ك» fares no better — both appear in the delivery answer, which is
    // among the three sentences this shop says most. Expanded to the spoken
    // name, after the digit rules above so a price is still read as a number.
    $text = $lang === 'ar'
        ? (preg_replace('/\bد\.?\s?ك\b/u', 'دينار كويتي', $text) ?? $text)
        : (preg_replace('/\bKWD\b/u', 'Kuwaiti dinars', $text) ?? $text);

    return trim(preg_replace('/[ \t]+/u', ' ', $text) ?? $text);
}

// The JSON body sent to ElevenLabs — extracted so the test can assert exactly
// what the shop asks for without reaching the real API.
//
// KUWAITI ARABIC, MADE DELIBERATE. The multilingual model DETECTS language per
// request, and detection is a coin-flip on the shop's most important sentences:
// an Arabic reply carrying a Latin order token, or an English product name,
// can tip the whole sentence into the wrong phoneme set — the customer hears
// "SP-one-A" read as Arabic letters, or حولي read with English vowels. Setting
// language_code removes the guess. It is sent ONLY when configured, because
// eleven_multilingual_v2 does not accept it while eleven_turbo_v2_5 and
// eleven_flash_v2_5 (the faster models, recommended for Arabic in the config)
// do — so an installation on the old model is unaffected and one on the new
// model gets enforced Kuwaiti Arabic.
function assistant_tts_body(array $cfg, string $model, string $text, string $lang): array
{
    $body = [
        // PRONOUNCED, not displayed — see assistant_speech_prep.
        'text' => assistant_speech_prep($text, $lang),
        // Multilingual, or Arabic letters get read with English phonemes.
        'model_id' => $model,
        'voice_settings' => [
            // Stability low-ish so the read has some life in it; too high and a
            // shop greeting sounds like a station announcement.
            'stability'         => (float) ($cfg['tts_stability'] ?? 0.45),
            'similarity_boost'  => (float) ($cfg['tts_similarity'] ?? 0.8),
            'style'             => (float) ($cfg['tts_style'] ?? 0.0),
            'use_speaker_boost' => (bool)  ($cfg['tts_speaker_boost'] ?? true),
        ],
    ];
    // Explicit language, when the installation set one AND the model is not the
    // one that rejects it. Default '' = let the model detect, the old behaviour.
    $langCode = trim((string) ($cfg['tts_language_code'] ?? ''));
    if ($langCode !== '' && $model !== 'eleven_multilingual_v2') {
        $body['language_code'] = $langCode;
    }
    return $body;
}

// ----------------------------------------------------- what the format IS
//
// `tts_format` was allowed to be anything ElevenLabs accepts, and everything
// downstream assumed mp3 anyway: the cache file ended in `.mp3`, the response
// said `audio/mpeg`, and the "is this really audio" guard looked for an MPEG
// frame. Set `pcm_44100` for lossless and every one of those three was wrong —
// the shop cached a file it mislabelled and the browser was handed samples it
// could not decode.
//
// One place decides now, and everything reads it from here.
//
// RAW PCM IS NOT A PLAYABLE FILE, and this is the part that surprises people:
// `pcm_*` returns headerless little-endian 16-bit samples. There is no format
// marker, no sample rate, nothing for a decoder to work from — <audio> refuses
// it. So PCM is wrapped in a 44-byte WAV header on the way to disk, and what
// is cached and served is a real .wav. That is still lossless; it is the same
// samples with the sample rate written down in front of them.
function assistant_voice_kind(array $cfg): array
{
    $f = (string) ($cfg['tts_format'] ?? 'mp3_22050_32');
    if (str_starts_with($f, 'pcm_')) {
        return ['ext' => 'wav', 'mime' => 'audio/wav', 'wrap' => 'wav',
                'rate' => (int) (explode('_', $f)[1] ?? 44100)];
    }
    if (str_starts_with($f, 'ulaw_')) return ['ext' => 'wav', 'mime' => 'audio/wav', 'wrap' => 'raw', 'rate' => 0];
    if (str_starts_with($f, 'opus_')) return ['ext' => 'ogg', 'mime' => 'audio/ogg', 'wrap' => 'raw', 'rate' => 0];
    return ['ext' => 'mp3', 'mime' => 'audio/mpeg', 'wrap' => 'raw', 'rate' => 0];
}

// The 44 bytes that turn samples into a file. Mono, 16-bit — what ElevenLabs
// returns for every pcm_* format.
function assistant_wav_header(int $bytes, int $rate): string
{
    $ch = 1; $bits = 16;
    $byteRate = $rate * $ch * $bits / 8;
    return 'RIFF' . pack('V', 36 + $bytes) . 'WAVE'
         . 'fmt ' . pack('V', 16) . pack('v', 1) . pack('v', $ch)
         . pack('V', $rate) . pack('V', (int) $byteRate)
         . pack('v', (int) ($ch * $bits / 8)) . pack('v', $bits)
         . 'data' . pack('V', $bytes);
}

function assistant_voice_dir(array $cfg): string
{
    return (string) ($cfg['tts_cache_dir'] ?? sys_get_temp_dir() . '/sporta-voice');
}

// WHERE A SENTENCE'S AUDIO LIVES — the ONE implementation of the cache key.
//
// It was briefly computed in three places (here, and twice in cron-voice.php),
// which is how a warm cache and a cold lookup end up disagreeing about the
// same sentence: the warmer fills one path and the customer's request checks
// another, so the shop pays for audio it already owns and nobody notices,
// because everything still works.
//
// The key is the sentence AS WRITTEN, not as pronounced — pronunciation is
// applied on the way out and must never invalidate a signature the browser is
// already holding. It is bound to the voice, the model and the format too:
// change any of those in config and the shop must buy new audio rather than
// serve the old voice from disk for ever.
function assistant_voice_path(array $cfg, string $text, string $lang): string
{
    $hash = hash('sha256', implode("\0", [
        $lang,
        (string) ($cfg['tts_voice_id'] ?? ''),
        (string) ($cfg['tts_model'] ?? 'eleven_multilingual_v2'),
        (string) ($cfg['tts_format'] ?? 'mp3_22050_32'),
        // Bound to the language code too: turning on enforced Arabic changes how
        // a sentence sounds, so the shop must buy new audio rather than serve
        // the detected-language read from disk for ever.
        (string) ($cfg['tts_language_code'] ?? ''),
        $text,
    ]));
    return assistant_voice_dir($cfg) . '/' . $hash . '.' . assistant_voice_kind($cfg)['ext'];
}

// Returns the mp3 bytes, from cache when possible.
//
// CACHING IS NOT AN OPTIMISATION HERE, it is most of the design. The shop's
// answers repeat: "delivery is same-day", "returns within 14 days", the
// greeting. Those are the same bytes every time, so they are synthesised once
// and served from disk for ever after. Only the shop's fixed sentences are
// ever signed (assistant_answer), so after the warmer has run, a customer's
// press costs nothing.
function assistant_speak(array $cfg, string $text, string $lang): ?string
{
    if (!assistant_speech_available($cfg)) return null;

    $dir    = assistant_voice_dir($cfg);
    $file   = assistant_voice_path($cfg, $text, $lang);
    $model  = (string) ($cfg['tts_model'] ?? 'eleven_multilingual_v2');
    // 22 kHz / 32 kbps mono. Speech, not music: at 128 kbps (the API default)
    // the same sentence is four times the bytes with nothing a listener can
    // hear for it, and these are played on Kuwaiti mobile data.
    $format = (string) ($cfg['tts_format'] ?? 'mp3_22050_32');
    if (is_readable($file)) return (string) file_get_contents($file);

    if (!is_dir($dir)) @mkdir($dir, 0700, true);

    // SINGLE FLIGHT. Two customers pressing the speaker on the same new
    // sentence at the same moment used to mean two synthesis calls billed for
    // one file, and — worse — two processes writing the same path, which
    // interleaves into an mp3 that plays as a burst of noise. The second
    // request now waits for the first and serves what it wrote.
    $lockPath = $file . '.lock';
    $lock = @fopen($lockPath, 'c');
    if ($lock !== false) {
        @flock($lock, LOCK_EX);
        // The winner wrote it while this process was waiting on the lock.
        if (is_readable($file)) {
            @flock($lock, LOCK_UN); @fclose($lock); @unlink($lockPath);
            return (string) file_get_contents($file);
        }
    }

    // The base URL is configurable for one reason only: the test suite points
    // it at a fake gateway. It defaults to the real one and the owner never
    // sets it.
    $base = rtrim((string) ($cfg['tts_url'] ?? 'https://api.elevenlabs.io'), '/');
    $url  = $base . '/v1/text-to-speech/' . rawurlencode((string) $cfg['tts_voice_id'])
          . '?output_format=' . rawurlencode($format);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        // A customer is waiting and reading the same words on screen. If the
        // voice is slow, the voice is skipped — it is an enhancement, and an
        // enhancement that blocks the answer has stopped being one.
        CURLOPT_TIMEOUT => (int) ($cfg['tts_timeout'] ?? 10),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: audio/mpeg',
            'xi-api-key: ' . $cfg['tts_key'],
        ],
        CURLOPT_POSTFIELDS => json_encode(assistant_tts_body($cfg, $model, $text, $lang), JSON_UNESCAPED_UNICODE),
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    $release = function () use ($lock, $lockPath) {
        if ($lock !== false) { @flock($lock, LOCK_UN); @fclose($lock); @unlink($lockPath); }
    };

    // AN mp3 IS NOT THE ONLY THING THIS CAN RETURN. A wrong key answers 401
    // with a JSON body, an exhausted quota 429, an unknown voice 404 — and
    // every one of those used to become a silent `null`, i.e. a speaker button
    // that does nothing, with no way for the owner to find out why. The reason
    // is written down now. The log sits beside knet-payments.log ABOVE the web
    // root; it records status and reason, never the key.
    if ($code !== 200 || !is_string($body) || $body === '') {
        $why = $err !== '' ? $err : substr((string) $body, 0, 300);
        assistant_voice_log($cfg, sprintf('tts %d %s', $code, str_replace("\n", ' ', $why)));
        $release();
        return null;
    }
    // A JSON error body served with a 200 is not audio, and must not be cached
    // as though it were — a cached error plays as silence for ever and never
    // retries. The test differs by format: an mp3 announces itself with an ID3
    // tag or a frame sync, while PCM is raw samples with no marker at all, so
    // for those the only honest check is that it does not look like the JSON
    // error it would otherwise be.
    $kind = assistant_voice_kind($cfg);
    $looksAudio = $kind['ext'] === 'mp3'
        ? (str_starts_with($body, 'ID3') || $body[0] === "\xFF")
        : ($body[0] !== '{' && $body[0] !== '<' && strlen($body) > 256);
    if (!$looksAudio) {
        assistant_voice_log($cfg, 'tts 200 but body is not ' . $kind['ext'] . ': ' . substr($body, 0, 200));
        $release();
        return null;
    }

    // Samples become a file. Done before the write, so what is cached is what
    // is served and nothing has to remember to wrap it again later.
    if ($kind['wrap'] === 'wav') {
        $body = assistant_wav_header(strlen($body), $kind['rate']) . $body;
    }

    // ATOMIC. Write to a temp file in the same directory and rename it into
    // place — rename(2) is atomic on the same filesystem, so a reader either
    // sees no file or sees the whole file, never a half-written one.
    $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.part';
    if (@file_put_contents($tmp, $body) === strlen($body)) {
        @chmod($tmp, 0600);
        @rename($tmp, $file);
    } else {
        @unlink($tmp);
    }
    $release();
    return $body;
}

// One line per failure, above the web root. Silent if it cannot write —
// logging is diagnosis, and diagnosis must never take the shop down.
function assistant_voice_log(array $cfg, string $line): void
{
    $path = (string) ($cfg['tts_log'] ?? '');
    if ($path === '') {
        $dir = (string) ($cfg['tts_cache_dir'] ?? sys_get_temp_dir() . '/sporta-voice');
        $path = dirname($dir) . '/sporta-voice.log';
    }
    @file_put_contents($path, gmdate('c') . ' ' . $line . "\n", FILE_APPEND | LOCK_EX);
    @chmod($path, 0600);
}

// Delete cached audio nobody has asked for in a long time.
//
// THE CACHE IS UNBOUNDED WITHOUT THIS. Only the fixed sentences above are
// signed for speech now, so the live set is small — but every change of voice,
// model, format, delivery fee or payment method leaves the previous audio on
// disk under keys nobody will ask for again, in a directory the owner cannot
// see over FTP without going looking. Pruned by last ACCESS where the
// filesystem records it, so a line that is still being played stays.
function assistant_voice_prune(array $cfg, int $maxAgeDays = 90): int
{
    $dir = (string) ($cfg['tts_cache_dir'] ?? sys_get_temp_dir() . '/sporta-voice');
    if (!is_dir($dir)) return 0;
    $cut = time() - ($maxAgeDays * 86400);
    $gone = 0;
    // EVERY audio extension, not just mp3. Pruning only .mp3 while the shop is
    // configured for lossless would let the cache grow without limit and report
    // "0 deleted" while doing it — and lossless files are the ones that make a
    // disk quota matter.
    foreach ((glob($dir . '/*.{mp3,wav,ogg}', GLOB_BRACE) ?: []) as $f) {
        // atime, falling back to mtime: shared hosts often mount noatime, and
        // in that case atime IS mtime, which is the conservative answer.
        $seen = max((int) @fileatime($f), (int) @filemtime($f));
        if ($seen > 0 && $seen < $cut && @unlink($f)) $gone++;
    }
    // Abandoned lock/part files from a process that died mid-synthesis.
    foreach (array_merge(glob($dir . '/*.lock') ?: [], glob($dir . '/*.part') ?: []) as $f) {
        if ((int) @filemtime($f) < time() - 3600) @unlink($f);
    }
    return $gone;
}

// ---------------------------------------------------------------------- n8n
//
// One outbound webhook, fired when the assistant has reached the end of what
// it can do — the customer asked for a person, or the question fell through to
// the catch-all. n8n decides what happens next: WhatsApp, an email, a row in a
// sheet. None of that belongs in a shop's PHP.
//
// AS CLOSE TO FIRE AND FORGET AS PHP GETS. The customer is waiting for an
// answer that is already written; whether an automation platform acknowledged
// the handoff is not their problem and must never delay them or fail their
// request. It is still a synchronous call — mod_php has no
// fastcgi_finish_request — so it is bounded hard: half a second to connect,
// a second and a half in all. It was four seconds, measured in full on every
// "phone strap" while the webhook was slow, and ten with a slow model too.
// A fully non-blocking handoff would be an outbox drained by cron, as
// fulfilment_outbox is.
function assistant_handoff(array $cfg, string $message, string $reply, string $intent, string $lang): void
{
    $url    = (string) ($cfg['n8n_webhook'] ?? '');
    $secret = (string) ($cfg['n8n_secret'] ?? '');
    if ($url === '') return;
    // NO SECRET, NO SEND. An unset n8n_secret used to sign the payload with an
    // EMPTY KEY, and the workflow at the other end verified it against the same
    // empty key and accepted it — so the signature check passed while
    // protecting nothing, which is worse than having none, because the design
    // and the comments both say the handoff is authenticated.
    //
    // The webhook URL is not a secret; it leaks through browser history,
    // screenshots and support tickets, and that is exactly why the signature
    // exists. Without a key, anyone holding the URL can make this shop email
    // itself text they wrote, presented as a customer's words. Refuse instead.
    if ($secret === '') return;

    $payload = json_encode([
        'source'  => 'sporta-ai',
        'intent'  => $intent,
        'lang'    => $lang,
        'message' => $message,
        'reply'   => $reply,
        'at'      => gmdate('c'),
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT_MS => 500,
        CURLOPT_TIMEOUT_MS => 1500,
        // Sub-second timeouts need this on libcurl builds with the
        // synchronous resolver, or the alarm-based timeout is ignored.
        CURLOPT_NOSIGNAL => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            // A webhook URL stops being a secret the moment it is in a browser
            // history or a screenshot. The signature is what lets the workflow
            // tell this shop from anyone who has seen the URL.
            'X-Sporta-Signature: ' . hash_hmac('sha256', $payload, $secret),
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    curl_exec($ch);
    curl_close($ch);
}
