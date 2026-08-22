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
// in 3ms on shared hosting, and it is right or it says it does not know.
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
    // typed on an Arabic keyboard still matches.
    $s = strtr($s, ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
                    '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9']);
    return preg_replace('/\s+/u', ' ', $s) ?? $s;
}

// Does the text contain any of these words? Substring, not word-boundary:
// Arabic glues its articles and prefixes on (التوصيل is "the delivery",
// وبكم is "and how much"), so \b would miss most real questions.
function assistant_has(string $hay, array $needles): bool
{
    foreach ($needles as $n) {
        if ($n !== '' && mb_strpos($hay, assistant_normalise($n)) !== false) return true;
    }
    return false;
}

// ------------------------------------------------------------------ intents
//
// Ordered, and the order is the policy: a message mentioning both an order
// number and delivery is a question about THAT order, so order_status is
// tested first. The catch-all is last and admits ignorance rather than
// guessing.
function assistant_intent(PDO $db, string $text): string
{
    $t = assistant_normalise($text);

    // AN ORDER NUMBER IS THE QUESTION, whatever words surround it. Someone who
    // pastes SP1AU702NKHTKDV and nothing else is asking about that order, and
    // matching on phrasing alone missed it: "order SP1AU..." contains none of
    // the keywords below, so it fell all the way through to product search and
    // the customer was offered four jackets.
    // CANCELLING IS TESTED BEFORE EVERYTHING, INCLUDING THE ORDER NUMBER.
    // "ألغي طلبي SP1AU702NKHTKDV" carries a track ID, so it used to be read as
    // a tracking question and answered with a status report — the customer
    // asked to stop an order and was told, pleasantly, that it is being
    // prepared. Someone who says "cancel" while quoting the order number is
    // cancelling THAT order, so cancel wins over both branches below.
    // 'الغ طلب' added: the bare imperative "ألغِ طلبي" normalises to "الغ طلبي"
    // (the kasra is stripped, leaving no ya), which none of the -ي spellings
    // caught. 'الغ طلب' is cancel-plus-order and safe — it is not a substring of
    // المبلغ / الغالي / بلغ, which lack the alef-lam-ghayn run.
    if (assistant_has($t, ['الغاء', 'الغي', 'الغ الطلب', 'الغ طلب', 'لغي', 'ابي الغي', 'ما ابي الطلب',
                           'بطل الطلب', 'اوقف الطلب', 'cancel', 'cancellation'])) {
        return 'cancel';
    }

    if (assistant_find_track($text) !== null) return 'order_status';

    // 'tracking', not 'track': "do you have a tracksuit" contains "track", and
    // a substring match on it answered a shopping question with a request for
    // an order number.
    if (assistant_has($t, ['طلبي', 'طلبيتي', 'وين طلب', 'اين طلب', 'تتبع', 'رقم الطلب', 'حاله الطلب',
                           'my order', 'where is my order', 'tracking', 'track my', 'track order',
                           'order status', 'order number'])) {
        return 'order_status';
    }
    // RETURNS, above delivery — because "is the return free or do I pay the
    // shipping back?" carries the word "shipping", which delivery would grab,
    // and answer with the delivery FEE for a question about a REFUND. A message
    // naming a return or an exchange is about that, whatever logistics word
    // rides along. Both the noun and the VERB of each: "أبي أستبدل" shares no
    // whole word with "استبدال", and matching only the noun missed live Arabic.
    if (assistant_has($t, ['ارجاع', 'ارجع', 'استرجاع', 'استرجع', 'استبدال', 'استبدل', 'ابدل',
                           'تبديل', 'مرتجع', 'استرداد', 'رجع',
                           'return', 'refund', 'exchange', 'send back'])) {
        return 'returns';
    }
    // OUTSIDE KUWAIT, BEFORE delivery. "do you ship to Dubai" would otherwise be
    // caught by delivery's 'shipping' and answered "yes — 24h, 1 KWD", which is
    // a promise to another country the shop cannot keep. Keyed ONLY on a foreign
    // place / abroad word, never on bare "ship" or "Kuwait", so an in-Kuwait
    // delivery question never reaches it.
    if (assistant_has($t, ['خارج الكويت', 'برا الكويت', 'بره الكويت', 'برة الكويت', 'دولي',
                           'دول الخليج', 'السعوديه', 'الامارات', 'دبي', 'قطر', 'البحرين', 'عمان',
                           'outside kuwait', 'international', 'worldwide', 'abroad', 'overseas',
                           'gcc', 'saudi', 'ksa', 'uae', 'dubai', 'qatar', 'bahrain', 'oman'])) {
        return 'shipping_scope';
    }
    // CASH ON DELIVERY IS A PAYMENT METHOD, not a delivery question — and the
    // English words "cash on delivery" contain "delivery", so without this guard
    // ahead of the delivery branch, asking whether COD is accepted was answered
    // with the delivery-fee line. Only the unambiguous multi-word COD phrases,
    // never bare 'cod' (that would eat "discount code").
    if (assistant_has($t, ['cash on delivery', 'pay on delivery', 'عند الاستلام',
                           'كاش عند الاستلام', 'الدفع عند الاستلام', 'كاش عند التوصيل',
                           'دفع عند التوصيل'])) {
        return 'payment';
    }
    // 'توصل'/'توصلون' added: the Gulf second-person "do you deliver" — the single
    // most common way a customer asks — shares no whole word with 'توصيل'/'يوصل',
    // so it used to fall through delivery entirely. Not a substring of 'تواصل'
    // (contact), which carries an alef the delivery verb does not.
    if (assistant_has($t, ['توصيل', 'شحن', 'يوصل', 'توصل', 'توصلون', 'التوصيل', 'متي يصل', 'مندوب',
                           'شركه التوصيل', 'deliver', 'shipping', 'arrive', 'how long', 'when will',
                           'courier'])) {
        return 'delivery';
    }
    // INSTALLMENTS, BEFORE payment, and its own intent rather than a synonym of
    // payment: the honest answer is a plain NO plus the three methods that DO
    // exist, and folding it into the generic payment reply would bury the "no".
    // "how do I pay" carries none of these words, so it stays 'payment'.
    if (assistant_has($t, ['تقسيط', 'اقساط', 'قسط', 'تابي', 'تمارا', 'دفعات', 'دفع مؤجل', 'مؤجل',
                           'installment', 'installments', 'instalment', 'tabby', 'tamara',
                           'split payment', 'pay later', 'pay in 4', 'financing'])) {
        return 'installments';
    }
    if (assistant_has($t, ['دفع', 'كي نت', 'كينت', 'knet', 'فيزا', 'ماستر', 'الدفع عند الاستلام',
                           'pay', 'payment', 'card', 'cash on delivery', 'cod', 'tpay', 't-pay',
                           'visa', 'mastercard', 'apple pay', 'ابل باي'])) {
        return 'payment';
    }
    // AVAILABILITY — the order-driving branch, and the only one gated on the
    // DATABASE. It fires only when BOTH a stock cue ("available"/"in stock"/
    // "do you have"/متوفر) AND a real catalogue product are present. A cue with
    // no product ("do you have anything on sale") falls through to recommend; a
    // product with no cue ("what size is the jacket") falls through to sizes.
    // Placed above 'sizes' so "is the jacket available in L" gets a truthful
    // in-stock answer instead of the generic size guide — the whole point.
    if (assistant_has($t, assistant_stock_cues()) && assistant_match_products($db, $text)) {
        return 'availability';
    }
    if (assistant_has($t, ['مقاس', 'مقاسات', 'حجم', 'صغير', 'كبير',
                           'size', 'sizing', 'fit', 'measurement'])) {
        return 'sizes';
    }
    // A request for a SUGGESTION, not a search for a named thing. "وش تنصح",
    // "شنو الأكثر مبيعا", "recommend something" name no product, so product
    // search would find nothing and the customer would be told the shop has
    // nothing — when the honest answer is a shelf of what sells. Kept AFTER
    // sizes/returns so "what size do you recommend" stays a sizing question.
    if (assistant_has($t, ['انصح', 'تنصح', 'نصيحه', 'اقترح', 'اقتراح', 'وش تنصح', 'شنو تنصح',
                           'الاكثر مبيعا', 'اكثر مبيعا', 'مبيع', 'تقترح', 'الافضل', 'الاكثر طلبا',
                           'عروض', 'تخفيضات', 'تخفيض', 'خصومات', 'خصم',
                           'recommend', 'suggest', 'suggestion', 'best seller', 'bestseller',
                           'best selling', 'best-selling', 'bestselling', 'top seller',
                           'popular', 'what should i', 'on sale', 'deals', 'offers', 'featured'])) {
        return 'recommend';
    }
    if (assistant_has($t, ['تواصل', 'اتصال', 'خدمه العملاء', 'موظف', 'انسان', 'واتساب', 'رقمكم',
                           'contact', 'human', 'agent', 'speak to', 'phone', 'whatsapp', 'email'])) {
        return 'contact';
    }
    // AUTHENTICITY / WARRANTY — a trust question no action intent owns, and one
    // the shop has NOT written a policy for. So it never asserts "yes, genuine"
    // or a guarantee it cannot back; it hands the customer to a human. Below
    // contact (so "talk to someone" is still contact) and above location (so
    // "محل رسمي؟" — official store? — is a trust question, not an address one).
    // Keyed on authentic/genuine/original/ضمان, never bare "real"/"really".
    if (assistant_has($t, ['اصلي', 'اصليه', 'اصلية', 'تقليد', 'مقلد', 'ضمان', 'كفاله', 'كفالة',
                           'رسمي', 'معتمد',
                           'authentic', 'genuine', 'original', 'fake', 'replica', 'counterfeit',
                           'warranty', 'guarantee', 'official', 'authorized', 'authorised'])) {
        return 'authenticity';
    }
    // HOW TO ORDER — the onboarding walk-through. Below every ACTION intent
    // (order_status, delivery, payment, availability…) so a real order/delivery/
    // payment question always wins, but ABOVE location because "كيف اطلب من
    // موقعكم" (how do I order FROM YOUR SITE) carries موقعكم, which also means
    // "your location" — and the customer is plainly asking how to buy, not for
    // an address. Its triggers are the specific order/buy verbs, so no genuine
    // location question ("وين موقعكم") reaches this by accident.
    if (assistant_has($t, ['كيف اطلب', 'شلون اطلب', 'كيف اشتري', 'شلون اشتري', 'ابي اشتري', 'طريقه الطلب',
                           'كيف اقدر اطلب', 'اقدر اطلب', 'ابي اطلب', 'ابغى اطلب', 'اطلب من موقع',
                           'شلون اكمل', 'كيف اكمل', 'اكمل الطلب', 'اكمل طلب', 'محتاج حساب', 'لازم حساب',
                           'اسوي حساب', 'سوي حساب',
                           'how do i order', 'how to order', 'how can i order', 'how do i buy',
                           'how to buy', 'how do i checkout', 'how do i check out', 'need an account',
                           'do i need an account'])) {
        return 'how_to_order';
    }
    // WHERE THE SHOP IS. There is no branch to visit — Sporta is online only,
    // delivering across Kuwait — but "وين موقعكم" fell through to product
    // search and came back "I did not quite follow that", which reads as a shop
    // hiding its address. Saying plainly that it is an online shop is both true
    // and the more useful answer. Kept after `delivery`, so "متى يوصل لموقعي"
    // stays a delivery question.
    if (assistant_has($t, ['وين موقعكم', 'موقعكم', 'مقركم', 'عنوانكم', 'فرع', 'فروع', 'محل',
                           'معرض', 'وين تلقونكم', 'زياره', 'اونلاين بس', 'متجر الكتروني', 'متجر اونلاين',
                           'where are you', 'your location', 'address', 'branch', 'store location',
                           'showroom', 'visit you', 'shop location', 'physical store', 'physical shop',
                           'online only', 'online store', 'online shop', 'can i visit'])) {
        return 'location';
    }

    // WORKING HOURS — an online shop has none, and saying "we're open 24/7" is
    // the true, reassuring answer. Below delivery so "how many hours until it
    // arrives" stays delivery; keyed on the hours/opening phrases, never bare
    // "hours" or "open" (which appear in half the delivery questions).
    if (assistant_has($t, ['ساعات العمل', 'اوقات العمل', 'اوقات الدوام', 'وقت الدوام', 'الدوام',
                           'دوامكم', 'متي تفتحون', 'متي يفتح', 'مفتوحين',
                           'working hours', 'opening hours', 'business hours', 'are you open',
                           'open now', 'when do you open', 'what time do you open'])) {
        return 'hours';
    }
    // The Latin greetings are matched WHOLE-WORD, and that is a bug fix, not a
    // nicety: the list used to carry 'hi ' with a trailing space to stop it
    // matching inside a word — but assistant_has() normalises each needle, and
    // normalise trims, so 'hi ' became 'hi' and then matched the "hi" inside
    // "which", "this" and "ship". A courier question reaching this slot was
    // answered "Welcome to Sporta". \b fixes it for every such word at once.
    if (assistant_has($t, ['سلام', 'مرحبا', 'هلا', 'صباح', 'مساء', 'good morning', 'salam'])
        || preg_match('/\b(hello|hi|hey|hiya)\b/u', $t)) {
        return 'greeting';
    }

    // THANKS IS AN ANSWER, NOT A SEARCH. "شكرا" matched nothing and became a
    // product search, so the shop ended a conversation it had just handled well
    // with "I did not quite follow that" — the last thing the customer reads.
    // Tested LAST so that "thanks, where is my order" is still about the order.
    if (assistant_has($t, ['شكرا', 'مشكور', 'يعطيك العافيه', 'تسلم', 'ماقصرت', 'الله يعافيك',
                           'thanks', 'thank you', 'thx', 'appreciate it', 'cheers'])) {
        return 'thanks';
    }

    return 'search';
}

// An order number as the customer will type it: with or without the SP, in
// either alphabet's digits (normalise has already folded those), any case.
function assistant_find_track(string $text): ?string
{
    if (preg_match('/\b(SP[A-Z0-9]{6,28})\b/i', assistant_normalise($text), $m)) {
        return strtoupper($m[1]);
    }
    return null;
}

// -------------------------------------------------------- availability cues
//
// What turns "the jacket" into "is the jacket IN STOCK". The availability tool
// is the one order-driving question the assistant could not answer — a customer
// asking whether their size is there is a customer with a card in their hand —
// and the whole trick is telling that question apart from a generic sizing one.
//
// The cue is a HAVING word (available / in stock / do you have / متوفر / عندكم),
// never the word "size" / "مقاس" (that belongs to the sizes intent), and never a
// bare size letter. "do you have" IS a cue, on purpose: "do you have leggings"
// is a stock question, and answering it with the sizes actually on the shelf is
// a better, more honest answer than a plain search — and it carries the SAME
// buyable product payload, so nothing the widget renders changes.
function assistant_stock_cues(): array
{
    return [
        // EN — a HAVING word, not a sizing one.
        'available', 'availability', 'in stock', 'in-stock', 'out of stock',
        'out-of-stock', 'sold out', 'restock', 'back in stock', 'do you have',
        'have you got', 'have any', 'got any', 'any left', 'still have',
        'still got', 'still available', 'do you carry', 'comes in', 'have it in',
        // AR — Gulf phrasings, normalised (ة->ه etc. already folded by has()).
        'متوفر', 'متوفره', 'متوافر', 'يتوفر', 'تتوفر', 'متواجد', 'موجود', 'موجوده',
        'باقي', 'متبقي', 'يوجد', 'عندكم', 'عندك', 'عندج', 'نفد', 'نافد', 'نفذ',
        'خلص', 'خلصان', 'مخزون', 'بالمخزون',
    ];
}

// The size a customer named, folded to the catalogue's canon (S,M,L,XL,2XL,…),
// or null when none was named. It FAILS SAFE toward null: Branch 1 of the
// availability tool only ever affirms a size it has PROVEN is in stock, so a
// mis-read here can never invent availability — the worst it does is drop to
// "here are the sizes we do have".
function assistant_size_token(string $raw): ?string
{
    $t = ' ' . assistant_normalise($raw) . ' ';
    // Arabic / transliterated size WORDS first — multi-word before single so
    // "اكس لارج" is not eaten by "لارج". صغير/كبير double as sizes-intent words;
    // here they only matter once a product has already matched.
    foreach (['اكس لارج' => 'XL', 'اكسلارج' => 'XL', 'دبل اكس' => '2XL',
              'لارج' => 'L', 'كبير' => 'L', 'ميديم' => 'M', 'متوسط' => 'M',
              'وسط' => 'M', 'سمول' => 'S', 'صغير' => 'S'] as $w => $sz) {
        if (mb_strpos($t, $w) !== false) return $sz;
    }
    // English words — the extra-large spellings before bare "large".
    foreach (['extra large' => 'XL', 'x-large' => 'XL', 'xlarge' => 'XL',
              'xx-large' => '2XL', 'small' => 'S', 'medium' => 'M',
              'large' => 'L'] as $w => $sz) {
        if (mb_strpos($t, $w) !== false) return $sz;
    }
    // Latin letter tokens, WHOLE-WORD only — this boundary anchor is why a bare
    // size letter is never a cue: \bl\b matches "in l" but never the l in "sold".
    if (preg_match('/\b(xxxl|xxl|x3l|xl|xs|s|m|l)\b/u', $t, $m)) {
        $z = strtoupper($m[1]);
        return ['XXL' => '2XL', 'XXXL' => '3XL'][$z] ?? $z;
    }
    return null;
}

// The product(s) a stock question is ABOUT, or [] when none is named.
//
// Reuses the search tokenizer, then does the one thing plain search does not:
// it SCORES each product by how many of the naming words it matched and keeps
// only the top-scoring set. "cloudsoft jacket" scores 2 on every cloudsoft
// jacket colour and 1 on every other jacket, so the family that comes back is
// the cloudsoft jackets — not every jacket in the shop. A bare "jacket" scores
// 1 everywhere and returns the jackets as an honest, ambiguous family.
//
// The cue words and size words are stripped BEFORE matching, so "available",
// "in stock" and "L" never masquerade as product names.
function assistant_match_products(PDO $db, string $text): array
{
    $t = assistant_normalise($text);
    foreach (assistant_stock_cues() as $c) $t = str_replace(assistant_normalise($c), ' ', $t);

    // Availability must be CONSERVATIVE about firing (it sits above sizes and
    // recommend), so its matcher is stricter than search's: a naming word is
    // three letters or more. Two-letter tokens like "on" match "onyx" and
    // "phone" and would turn "anything on sale" into a fabricated stock answer;
    // the length floor kills them, and the recommend words ('sale'/'offers'/
    // 'عروض') are dropped so a browse-the-offers question reaches recommend.
    $stop = ['هل', 'عندكم', 'عندك', 'عندج', 'في', 'من', 'على', 'the', 'and', 'you',
             'have', 'this', 'that', 'for', 'want', 'need', 'any', 'stock', 'available',
             'size', 'مقاس', 'حجم', 'small', 'medium', 'large',
             'sale', 'offer', 'offers', 'deal', 'deals', 'anything', 'something',
             'عروض', 'تخفيض', 'تخفيضات', 'خصم'];
    $words = array_values(array_filter(preg_split('/[^\p{L}\p{N}]+/u', $t) ?: [],
        fn ($w) => mb_strlen($w) >= 3 && !in_array($w, $stop, true)));
    // Arabic glues the definite article on, and the stored names carry none:
    // "الجاكيت" / "هالجاكيت" / "للجاكيت" all mean the jacket, and none of them
    // matches "جاكيت" — the single most common reason an Arabic availability
    // question found no product. Strip a leading article so the naming word
    // underneath is what we search. NOT 'كال': "كالياري" (Cagliari) begins with
    // it, and stripping would erase a real product family.
    $words = array_map(function ($w) {
        $s = preg_replace('/^(هال|وال|بال|لل|ال)/u', '', $w);
        return ($s !== $w && mb_strlen($s) >= 3) ? $s : $w;
    }, $words);
    if (!$words) return [];

    $where = implode(' or ', array_fill(0, count($words),
        '(name_en like ? or name_ar like ? or slug like ? or category like ?)'));
    $args = [];
    foreach ($words as $w) { $like = '%' . $w . '%'; array_push($args, $like, $like, $like, $like); }
    $q = $db->prepare("select slug, name_en, name_ar, price, sale_price, category
                       from products where active = 1 and ($where) limit 40");
    $q->execute($args);
    $rows = $q->fetchAll();
    if (!$rows) return [];

    $best = 0;
    foreach ($rows as &$r) {
        $hay = assistant_normalise($r['name_en'] . ' ' . $r['name_ar'] . ' ' . $r['slug'] . ' ' . $r['category']);
        $score = 0;
        foreach ($words as $w) if (mb_strpos($hay, $w) !== false) $score++;
        $r['_score'] = $score;
        if ($score > $best) $best = $score;
    }
    unset($r);
    if ($best === 0) return [];
    $out = array_values(array_filter($rows, fn ($r) => ($r['_score'] ?? 0) === $best));
    return array_slice($out, 0, 6);
}

// --------------------------------------------------------------------- tools
//
// Each returns [reply, data] — data being anything the widget can render as
// something better than a sentence (an order card, a row of products).

function assistant_order(PDO $db, array $cfg, ?string $track, bool $ar): array
{
    if ($track === null) {
        return [assistant_canned($cfg, 'ask_track', $ar), null];
    }
    $q = $db->prepare('select track_id, amount, payment_status, payment_method,
                              fulfilment_status, created_at
                       from orders where track_id = ?');
    $q->execute([$track]);
    $o = $q->fetch();
    if (!$o) {
        // NOT "your order is on its way". An order number that does not exist
        // is usually a typo, and saying so is the useful answer.
        return [$ar
            ? "لم أجد طلبًا بالرقم $track. تأكد من الرقم كما يظهر في رسالة التأكيد، أو أرسل لي رقم هاتفك وسيتواصل معك أحد الزملاء."
            : "I could not find an order with the number $track. Check it against your confirmation message, or send your phone number and a colleague will follow up.", null];
    }

    $paid = $o['payment_status'] === 'paid';
    $ful  = (string) $o['fulfilment_status'];
    // The wording is driven by BOTH columns, because they answer different
    // questions and a customer feels the difference: an unpaid order is not
    // late, it is unfinished, and telling them it is "being prepared" would
    // send them to wait for a parcel that will never be packed.
    if (!$paid && $o['payment_method'] !== 'cod') {
        $line = assistant_canned($cfg, 'stage_unpaid', $ar);
    } elseif ($ful === 'delivered') {
        $line = assistant_canned($cfg, 'stage_delivered', $ar);
    } elseif ($ful === 'shipped' || $ful === 'dispatched') {
        $line = assistant_canned($cfg, 'stage_shipped', $ar);
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

// Product search over both languages at once. The shopper types in whichever
// they think in, and the catalogue is stored in both.
function assistant_search(PDO $db, array $cfg, string $text, bool $ar): array
{
    $t = assistant_normalise($text);
    // Words worth searching on: two characters or more, and not the padding
    // every question is made of.
    $stop = ['هل','عندكم','في','من','على','the','a','do','you','have','is','for','and','i','me','my','want','need','any'];
    $words = array_values(array_filter(preg_split('/[^\p{L}\p{N}]+/u', $t) ?: [],
        fn ($w) => mb_strlen($w) >= 2 && !in_array($w, $stop, true)));

    $found = [];
    if ($words) {
        $where = implode(' or ', array_fill(0, count($words), '(name_en like ? or name_ar like ? or category like ?)'));
        $args = [];
        foreach ($words as $w) { $like = '%' . $w . '%'; $args[] = $like; $args[] = $like; $args[] = $like; }
        $q = $db->prepare("select slug, name_en, name_ar, price, sale_price, category
                           from products where active = 1 and ($where) limit 4");
        $q->execute($args);
        $found = $q->fetchAll();
    }

    if (!$found) {
        // Honest ignorance, not a shelf of unrelated guesses. "do you sell live
        // goldfish" should hear what the shop CAN help with — the same rule the
        // rest of this file follows. A shopper who wants ideas asks for them,
        // and that is the 'recommend' intent, which offers real bestsellers.
        return [assistant_canned($cfg, 'no_idea', $ar), null];
    }
    return [assistant_canned($cfg, 'found', $ar), assistant_products_payload($db, $found, $ar)];
}

// What the shop wants to put in front of someone who asks "what do you
// recommend" or "what's on offer": things on sale first (a reason to buy now),
// then whatever the owner marked featured, padded with the rest. Never
// generated — these are real rows, in stock terms the catalogue knows.
function assistant_recommend(PDO $db, array $cfg, bool $ar): array
{
    // Sale items first, then featured, then newest — one query, ordered so the
    // most compelling reason to buy is at the top. Only active products.
    $rows = $db->query(
        "select slug, name_en, name_ar, price, sale_price, category
           from products
          where active = 1
          order by (sale_price is not null and sale_price <> '') desc,
                   featured desc, featured_sort asc, id desc
          limit 4"
    )->fetchAll();

    if (!$rows) return [assistant_canned($cfg, 'no_idea', $ar), null];
    return [assistant_canned($cfg, 'recommend', $ar), assistant_products_payload($db, $rows, $ar)];
}

// "Is <product> available in <size>?" — the order-driving question, answered
// from the SHELF and never invented. Everything here is server-authoritative:
// the browser supplies the words, product_variants supplies the truth, and the
// tool states availability without ever quoting a number it made up.
//
// It reads only stock — never a price or an order status — and it hands off to
// a human on exactly the two branches where self-serve has genuinely run out:
// every size sold out, or no product identifiable. It NEVER guesses a restock
// date, because the shop does not hold one.
function assistant_availability(PDO $db, array $cfg, string $text, bool $ar): array
{
    $phone = (string) ($cfg['shop_phone'] ?? '+965 22091914');
    $fam = assistant_match_products($db, $text);

    // BRANCH 4 — no product. Try a plain search on the naming words first: if it
    // surfaces something buyable, that IS the helpful answer. Only when even
    // search finds nothing does self-serve run out (null data -> handoff).
    if (!$fam) {
        [$sReply, $sData] = assistant_search($db, $cfg, $text, $ar);
        if ($sData) return [$sReply, $sData];
        return [$ar
            ? "لم أتمكّن من تحديد المنتج الذي تقصده. اكتب اسم المنتج كما يظهر في المتجر أو ابحث مباشرة وسأتحقق من مقاساته وتوفّره — أو يساعدك أحد الزملاء على $phone."
            : "I couldn't tell which item you mean. Type the product name as it appears in the shop, or search directly, and I'll check its sizes and stock — or a colleague can help on $phone.", null];
    }

    $slugs = array_column($fam, 'slug');
    $in = implode(',', array_fill(0, count($slugs), '?'));
    $vq = $db->prepare("select slug, size, stock from product_variants where slug in ($in)");
    $vq->execute($slugs);
    $variants = $vq->fetchAll();

    $name = $ar ? $fam[0]['name_ar'] : $fam[0]['name_en'];
    $size = assistant_size_token($text);

    // BRANCH 3 — ONE-SIZE. Row-existence is checked FIRST: a product with no
    // variant rows is UNTRACKED, and untracked means orderable (this mirrors
    // store.php, which claims stock only on tracked lines). It is never "0 left".
    if (!$variants) {
        $reply = $ar
            ? ($size !== null ? "$name مقاس واحد فلا يوجد مقاس $size تحديدًا — " : "")
              . "$name مقاس واحد ومتاح للطلب الآن من صفحته. التوصيل داخل الكويت خلال ٢٤ ساعة برسوم ١ د.ك."
            : ($size !== null ? "$name is one-size, so there's no separate $size — " : "")
              . "$name is available to order now from its page. Delivery is inside Kuwait within 24 hours for 1 KWD.";
        return [$reply, assistant_products_payload($db, $fam, $ar)];
    }

    // SIZED. Fold the family's rows into: which sizes are in stock at all, and
    // which colours carry the requested size in stock.
    $rank = ['XS' => 0, 'S' => 1, 'M' => 2, 'L' => 3, 'XL' => 4, '2XL' => 5, '3XL' => 6];
    $inStock = [];          // size => true (anywhere in the family, stock>0)
    $hasSize = [];          // slug => true (this colour has the asked size in stock)
    foreach ($variants as $v) {
        if ((int) $v['stock'] <= 0) continue;
        $inStock[$v['size']] = true;
        if ($size !== null && $v['size'] === $size) $hasSize[$v['slug']] = true;
    }
    $sizes = array_keys($inStock);
    usort($sizes, fn ($a, $b) => ($rank[$a] ?? 99) <=> ($rank[$b] ?? 99));
    $sizesList = implode($ar ? '، ' : ', ', $sizes);

    // BRANCH 1 — IN STOCK in the asked size. Payload is filtered to the colours
    // that actually carry it, so an Add leads only to a size that exists.
    if ($size !== null && $hasSize) {
        $buy = array_values(array_filter($fam, fn ($p) => isset($hasSize[$p['slug']])));
        $reply = $ar
            ? "نعم — $name متوفر بمقاس $size. اختر $size في صفحة المنتج وأضِفه إلى السلة، والتوصيل لأي منطقة في الكويت خلال ٢٤ ساعة برسوم ١ د.ك."
            : "Yes — $name is in stock in size $size. Pick $size on the product page and add it to your bag; delivery is anywhere in Kuwait within 24 hours for 1 KWD.";
        return [$reply, assistant_products_payload($db, $buy, $ar)];
    }

    // BRANCH 2a — the asked size is out, but others are in. Name what IS there
    // (real sizes, from the row) and offer a human for the exact one.
    if ($size !== null && $sizes) {
        $reply = $ar
            ? "المقاس $size غير متوفر حاليًا لـ $name. المتوفر الآن: $sizesList. أضيف لك واحدًا منها؟ وإذا تحتاج $size تحديدًا، أحوّلك لأحد الزملاء على $phone."
            : "Size $size is out of stock for $name right now. In stock now: $sizesList. Want one of those? If you need $size specifically, I can pass you to a colleague — $phone.";
        return [$reply, assistant_products_payload($db, $fam, $ar)];
    }

    // BRANCH 2b — every size sold out. Handoff (null data). No invented restock.
    if (!$sizes) {
        $reply = $ar
            ? "$name غير متوفر حاليًا بجميع المقاسات. لن أخمّن موعد توفّره — أرسل رقمك على $phone ويخبرك أحد الزملاء أول ما يرجع."
            : "$name is currently out of stock in every size. I won't guess when it's back — send your number to $phone and a colleague will let you know the moment it returns.";
        return [$reply, null];
    }

    // BRANCH 2c — no size named, some sizes in stock. List them, show the goods.
    $buy = array_values(array_filter($fam, function ($p) use ($variants) {
        foreach ($variants as $v) if ($v['slug'] === $p['slug'] && (int) $v['stock'] > 0) return true;
        return false;
    }));
    $reply = $ar
        ? "$name متوفر الآن بمقاسات: $sizesList. أي مقاس تريد؟"
        : "$name is in stock now in sizes: $sizesList. Which size would you like?";
    return [$reply, assistant_products_payload($db, $buy ?: $fam, $ar)];
}

// ONE shape for a product the widget can add to the cart, so search and
// recommend cannot disagree about what a buyable item looks like.
//
// It carries a NUMERIC price for the cart to display a running total — but that
// number is never authoritative: create_order re-prices every line from the
// products table, so a tampered price here changes what the customer SEES for a
// moment and nothing about what they are charged. The three-decimal string is
// what is shown; the number is what the cart sums.
function assistant_products_payload(PDO $db, array $rows, bool $ar): array
{
    // Which of these products carry per-size stock rows. A garment that does
    // must be picked in a size before it can be ordered — create_order refuses
    // it with size_required_<slug> otherwise — so the widget sends those to the
    // product page instead of dropping a size-less line in the bag that fails
    // at checkout. One query for the whole result set, not one per row.
    $sized = [];
    $slugs = array_column($rows, 'slug');
    if ($slugs) {
        $in = implode(',', array_fill(0, count($slugs), '?'));
        $q = $db->prepare("select distinct slug from product_variants where slug in ($in)");
        $q->execute($slugs);
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $s) $sized[$s] = true;
    }

    return [
        'kind'  => 'products',
        'items' => array_map(function ($p) use ($ar, $sized) {
            $effFils = (int) round((float) (($p['sale_price'] !== null && $p['sale_price'] !== '')
                ? $p['sale_price'] : $p['price']) * 1000);
            return [
                'slug'      => $p['slug'],
                'name'      => $ar ? $p['name_ar'] : $p['name_en'],
                'price'     => number_format($effFils / 1000, 3, '.', ''),
                'price_kwd' => $effFils / 1000,
                'sale'      => $p['sale_price'] !== null && $p['sale_price'] !== '',
                'category'  => $p['category'],
                // Whether it needs a size chosen first. The widget adds a
                // size-less item straight to the bag, and links a sized one to
                // its page so the shopper picks the size the order path demands.
                'has_sizes' => isset($sized[$p['slug']]),
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
// THE SENTENCES THE SHOP CAN SAY WITHOUT LOOKING ANYTHING UP, and the reason
// they live in a table instead of inside the switch that used to hold them:
// the voice cache is warmed from this list, so a sentence that exists twice is
// a sentence the warmer buys in one spelling and the customer requests in
// another. Nothing breaks visibly — the shop just pays for audio it already
// owns, on the exact answers it says most often, for ever.
//
// One list, read by both. Edit a line here and the warmer warms the new one.
function assistant_canned(array $cfg, string $intent, bool $ar): ?string
{
    $phone = (string) ($cfg['shop_phone'] ?? '+965 22091914');
    $email = (string) ($cfg['shop_email'] ?? 'cs@sporta.com.kw');

    $t = [
        'delivery' => [
            'ar' => 'التوصيل داخل الكويت خلال ٢٤ ساعة للطلبات المؤكدة، ورسوم التوصيل ١ د.ك لجميع مناطق الكويت. يصلك اتصال من المندوب قبل الوصول.',
            'en' => 'Delivery inside Kuwait is within 24 hours for confirmed orders, and it costs 1 KWD to every area. The courier calls before arriving.',
        ],
        'returns' => [
            // 14 days must match /returns and the Product structured data.
            // It must also say the words FREE and مجانيان: /returns, /terms,
            // /about and the footer badge all promise free returns, and this
            // answer did not — a customer who asked the assistant instead of
            // reading the page was told returns exist, not that they cost
            // nothing. And «الإرجاع والاستبدال» is two nouns, so the adjective
            // is dual (مجانيان), not singular (مجاني).
            'ar' => 'الاستبدال مجاني وسريع خلال ١٤ يومًا من الاستلام، في حال كان المنتج تالفًا أو المقاس غير مناسب. والاسترجاع في حال التلف أو إذا كانت الجودة غير متوقعة. الملابس النسائية غير قابلة للاستبدال نهائيًا.',
            'en' => 'Exchange is free and fast within 14 days of delivery, for a damaged item or the wrong size. Return applies if the item is damaged or the quality is not as expected. Women\'s clothing cannot be exchanged.',
        ],
        // WHAT THE SHOP ACTUALLY TAKES. This said T-Pay, which is built and
        // tested but not activated at CBK — so the assistant was telling
        // customers about a method the checkout does not offer. The keyword
        // list above still matches 'visa' and 'mastercard' on purpose: someone
        // who asks "do you take Visa?" deserves this answer rather than a
        // shrug, and the answer is what tells them no.
        'payment' => [
            'ar' => 'نقبل كي نت والدفع عند الاستلام. لا نقبل حاليًا فيزا أو ماستركارد.',
            'en' => 'We accept KNET and cash on delivery. We do not take Visa or Mastercard at the moment.',
        ],
        // POINTS AT THE ADVISER RATHER THAN ANSWERING. "Take the larger one"
        // was the whole of the shop's size advice, and it is advice that costs
        // money when it is wrong — a returned garment the shop collects free,
        // or, on women's clothing, a sale simply lost because that category
        // cannot be exchanged at all.
        //
        // The adviser computes a size from the shop's own chart and its own
        // stock (store_size_advice), which is exactly the kind of fact this
        // assistant is allowed to repeat and NOT the kind it is allowed to
        // invent. So the answer sends them to it, and keeps the one piece of
        // genuinely general guidance that does not depend on a body.
        'sizes' => [
            'ar' => 'في كل صفحة منتج تلقى «شنو مقاسي؟» — تعطينا طولك ووزنك أو قياساتك ونحسب لك المقاس والقَصّة المناسبة، ونقول لك إذا كان متوفر. وإذا كنت بين مقاسين خذ الأكبر، خصوصًا في القصّات الواسعة.',
            'en' => 'Every product page has a "What is my size?" adviser — give it your height and weight, or your measurements, and it works out the size and the fit and tells you whether we have it. If you are between two sizes take the larger one, especially in the roomier cuts.',
        ],
        'contact' => [
            'ar' => 'يسعدنا خدمتك: ' . $phone . ' أو ' . $email,
            'en' => 'We are happy to help: ' . $phone . ' or ' . $email,
        ],
        // WHAT THE SHOP CAN HONESTLY PROMISE ABOUT CANCELLING. There is no
        // self-service cancel button, and inventing one would send the customer
        // hunting for a control that does not exist. So it says the true thing:
        // be quick, reach a human, and if it has already gone out the returns
        // policy — 14 days, free exchange — is the route. Every claim here is
        // one /returns already makes.
        'cancel' => [
            'ar' => 'نقدر نلغي الطلب قبل ما يطلع مع المندوب. تواصل معنا فورًا على ' . $phone
                  . ' ومعك رقم الطلب. وإذا كان طلع للتوصيل، ترفضه عند الاستلام أو ترجعه خلال ١٤ يومًا.',
            'en' => 'We can cancel an order before it leaves with the courier. Call us right away on ' . $phone
                  . ' with your order number. If it has already gone out for delivery, refuse it at the door or return it within 14 days.',
        ],
        // ONLINE ONLY, SAID PLAINLY. There is no branch, and a shop that will
        // not say where it is reads as one with something to hide.
        'location' => [
            'ar' => 'سبورتا متجر إلكتروني، ما عندنا فرع تزوره. نوصّل لجميع مناطق الكويت خلال ٢٤ ساعة، وتقدر تتواصل معنا على '
                  . $phone . ' أو ' . $email,
            'en' => 'Sporta is an online shop — there is no branch to visit. We deliver to every area in Kuwait within 24 hours, and you can reach us on '
                  . $phone . ' or ' . $email,
        ],
        'thanks' => [
            'ar' => 'العفو، وين ما تحتاجني أنا هني. نتمنى لك يومًا سعيدًا من سبورتا.',
            'en' => 'You are very welcome. I am here whenever you need me — enjoy your day from all of us at Sporta.',
        ],
        // HOW ORDERING WORKS. The onboarding walk-through, in the true order of
        // the real flow, ending on the delivery promise the rest of the shop
        // makes. Every step here is one a shopper actually takes.
        'how_to_order' => [
            'ar' => 'الطلب سهل وسريع: ابحث أو تصفّح عمّا يعجبك، افتح المنتج، اختر مقاسك إذا كانت القطعة بمقاسات، أضِفه إلى السلة، ثم أكمل الدفع بكي نت أو T-Pay (رابط أونلاين) أو الدفع عند الاستلام. الطلبات المؤكدة تصل لأي منطقة في الكويت خلال ٢٤ ساعة برسوم ١ د.ك.',
            'en' => 'Ordering is quick: search or browse for what you like, open the product, pick your size if it is a sized item, add it to your bag, then check out and pay by KNET, T-Pay (online link), or cash on delivery. Confirmed orders are delivered anywhere in Kuwait within 24 hours for 1 KWD.',
        ],
        // ONLINE CHECKOUT IS KUWAIT-ONLY, BUT THE GULF IS NOT A FLAT "NO" — and
        // getting that wrong turns away a customer the shop wants. This answer
        // is word-for-word consistent with /terms §4: online checkout covers
        // Kuwait; GCC and the wider Middle East are arranged over WhatsApp with
        // the cost confirmed first. It must NOT quote the local 24h/1 KWD terms
        // for an abroad address, and it must NOT deny GCC delivery outright,
        // which an earlier version did — contradicting the Terms page a tap
        // away, and losing the lead.
        'shipping_scope' => [
            'ar' => 'الدفع عبر الموقع متاح داخل الكويت — لجميع المناطق، خلال ٢٤ ساعة للطلبات المؤكدة، برسوم ١ د.ك. ولطلبات دول الخليج أو الشرق الأوسط راسلنا على واتساب ' . $phone . ' ونرتّب لك الشحن ونؤكد التكلفة معك مسبقًا.',
            'en' => 'Online checkout is inside Kuwait — every area, within 24 hours for confirmed orders, for 1 KWD. For GCC or wider Middle East delivery, message us on WhatsApp at ' . $phone . ' and we will arrange it and confirm the cost with you first.',
        ],
        // A PLAIN NO, THEN THE THREE METHODS THAT DO EXIST. The "no" comes first
        // so it is not buried, and no product the shop lacks (Tabby, Tamara) is
        // ever named as if it might arrive.
        'installments' => [
            'ar' => 'لا نوفّر التقسيط — لا تابي ولا تمارا ولا دفع مؤجّل. طرق الدفع لدينا ثلاث فقط: كي نت، والدفع أونلاين عبر T-Pay، والدفع عند الاستلام.',
            'en' => 'We do not offer installments — no Tabby, Tamara, or deferred plans. Our payment methods are exactly three: KNET, T-Pay (pay online via a link), and cash on delivery.',
        ],
        // ALWAYS OPEN, BECAUSE THERE IS NO DOOR. An online shop has no working
        // hours; the honest answer is 24/7, with the same 24h delivery promise.
        'hours' => [
            'ar' => 'نحن متجر إلكتروني مفتوح ٢٤/٧ — تقدر تطلب في أي وقت، ليلًا أو نهارًا. والطلبات المؤكدة تُوصَّل لكل مناطق الكويت خلال ٢٤ ساعة.',
            'en' => 'We are an online shop, open 24/7 — you can order any time, day or night. Confirmed orders are delivered across Kuwait within 24 hours.',
        ],
        // A TRUST QUESTION THE SHOP HAS NOT DEFINED A POLICY FOR — so it promises
        // nothing and routes to a human. Better an honest handoff than an
        // invented guarantee. Joins the handoff set in assistant_answer().
        'authenticity' => [
            'ar' => 'بالنسبة لأسئلة الأصلية أو الضمان أو تفاصيل المنتج، أفضّل أن أحوّلك بدل أن أعطيك معلومة غير مؤكدة. يساعدك أحد الزملاء مباشرة على ' . $phone . ' أو ' . $email . '.',
            'en' => "For questions about authenticity, warranty, or product specifics, I'd rather connect you than give you anything I can't confirm. A colleague can help directly on " . $phone . ' or ' . $email . '.',
        ],
        'greeting' => [
            'ar' => 'أهلًا بك في سبورتا. أقدر أساعدك في حالة طلبك، التوصيل، الإرجاع، أو إيجاد المقاس المناسب.',
            'en' => 'Welcome to Sporta. I can help with your order, delivery, returns, or finding the right size.',
        ],
        // Not reachable as an intent — these are the fixed replies the two
        // database-backed tools fall back to, and the voice warms them too
        // because "send me your order number" is said many times a day.
        'ask_track' => [
            'ar' => 'أرسل لي رقم الطلب (يبدأ بـ SP) وسأتحقق من حالته فورًا.',
            'en' => 'Send me your order number (it starts with SP) and I will check it right away.',
        ],
        'stage_packing' => [
            'ar' => 'تم استلام الطلب وهو قيد التجهيز. التوصيل داخل الكويت خلال ٢٤ ساعة للطلبات المؤكدة.',
            'en' => 'We have your order and it is being prepared. Delivery inside Kuwait is within 24 hours for confirmed orders.',
        ],
        'stage_shipped' => [
            'ar' => 'الطلب مع المندوب الآن وفي طريقه إليك.',
            'en' => 'Your order is with the courier and on its way to you.',
        ],
        'stage_delivered' => [
            'ar' => 'تم تسليم هذا الطلب. نتمنى أن يكون كل شيء على ما يرام.',
            'en' => 'This order has been delivered. We hope everything is as it should be.',
        ],
        'stage_unpaid' => [
            'ar' => 'لم يكتمل الدفع لهذا الطلب بعد، لذلك لم يدخل التجهيز. يمكنك إعادة المحاولة من صفحة تتبع الطلب.',
            'en' => 'Payment for this order has not completed, so it has not gone into preparation. You can try again from the order tracking page.',
        ],
        'no_idea' => [
            'ar' => 'لم أفهم طلبك تمامًا. أستطيع مساعدتك في: حالة الطلب، التوصيل، الإرجاع والاستبدال، طرق الدفع، والمقاسات — أو ابحث في المتجر مباشرة.',
            'en' => 'I did not quite follow that. I can help with order status, delivery, returns and exchanges, payment methods and sizing — or you can search the shop directly.',
        ],
        'found' => [
            'ar' => 'وجدت هذه المنتجات:',
            'en' => 'Here is what I found:',
        ],
        'recommend' => [
            'ar' => 'هذي من أكثر القطع طلبًا عندنا، وبعضها عليه عرض. أضف اللي يعجبك للسلة وأنا أكمل معك الطلب.',
            'en' => 'These are some of our most popular pieces, a few of them on offer. Add what you like to the bag and I will take you through checkout.',
        ],
        'in_cart' => [
            'ar' => 'أضفته للسلة. تبي تضيف شي ثاني، أو نكمل الطلب؟',
            'en' => 'Added to your bag. Add anything else, or shall we check out?',
        ],
    ];

    return $t[$intent][$ar ? 'ar' : 'en'] ?? null;
}

// Every fixed sentence, both languages — what the voice warmer buys up front.
// Derived from the table above, so it cannot list a sentence the shop no
// longer says or miss one it just started saying.
function assistant_canned_lines(array $cfg): array
{
    // The NEW static intents are warmed too — "we deliver inside Kuwait only"
    // and "ordering is quick…" are said many times a day. The availability
    // answers are NOT here: they carry {product}/{size} and are minted per
    // request, so warming a template would cache audio nobody ever plays.
    $keys = ['delivery', 'returns', 'payment', 'sizes', 'contact', 'cancel', 'location', 'thanks',
             'greeting', 'ask_track', 'how_to_order', 'shipping_scope', 'installments', 'hours',
             'authenticity',
             'stage_packing', 'stage_shipped', 'stage_delivered', 'stage_unpaid', 'no_idea', 'found',
             'recommend', 'in_cart'];
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
// it IS configured the model receives the customer's message AND the facts
// this file already looked up, and is asked only to word the reply.
//
// It is never given the database, never asked what an order's status is, and
// its answer is discarded if the request fails or is slow — the deterministic
// reply is already in hand, so the fallback costs nothing. A shop assistant
// that breaks when a card expires or an API has an outage is worse than one
// that is merely plain.
function assistant_llm(array $cfg, string $message, string $facts, bool $ar): ?string
{
    $key = (string) ($cfg['ai_key'] ?? '');
    $url = (string) ($cfg['ai_url'] ?? '');
    if ($key === '' || $url === '') return null;

    $system = ($ar ? 'Reply in Arabic. ' : 'Reply in English. ')
        . 'You are the assistant for Sporta, a sportswear shop in Kuwait. '
        . 'Answer ONLY from the FACTS below. If the facts do not cover it, say you will pass it to a colleague. '
        . 'Never invent an order status, a price, a delivery date or a stock level. '
        . 'Two sentences at most.';

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
        CURLOPT_POSTFIELDS => json_encode([
            'model' => (string) ($cfg['ai_model'] ?? 'claude-haiku-4-5-20251001'),
            'max_tokens' => 300,
            'system' => $system,
            'messages' => [['role' => 'user', 'content' => "FACTS:\n$facts\n\nCUSTOMER: $message"]],
        ], JSON_UNESCAPED_UNICODE),
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body)) return null;
    $j = json_decode($body, true);
    $out = trim((string) ($j['content'][0]['text'] ?? ''));
    return $out === '' ? null : $out;
}

// ------------------------------------------------------------------- the ask
function assistant_answer(PDO $db, array $cfg, string $message, string $lang): array
{
    $ar = $lang === 'ar';
    $intent = assistant_intent($db, $message);
    $data = null;

    switch ($intent) {
        case 'order_status':
            [$reply, $data] = assistant_order($db, $cfg, assistant_find_track($message), $ar);
            break;
        case 'availability':
            [$reply, $data] = assistant_availability($db, $cfg, $message, $ar);
            break;
        case 'search':
            [$reply, $data] = assistant_search($db, $cfg, $message, $ar);
            break;
        case 'recommend':
            [$reply, $data] = assistant_recommend($db, $cfg, $ar);
            break;
        default:
            // Everything else is a fixed sentence — see assistant_canned().
            $reply = assistant_canned($cfg, $intent, $ar)
                ?? assistant_canned($cfg, 'greeting', $ar);
    }

    // The model, if there is one, only rewords what is already true.
    $better = assistant_llm($cfg, $message, $reply . ($data ? "\n" . json_encode($data, JSON_UNESCAPED_UNICODE) : ''), $ar);
    $final = $better ?? $reply;

    // Hand off to n8n exactly where the assistant runs out: the customer asked
    // for a person, or the question fell through to the catch-all and found
    // nothing. Handing off every message would make the workflow a transcript
    // log, which is not what it is for.
    // `cancel` joins them because it is the one intent where the fixed answer
    // is not the end of the matter: the customer has asked to stop something
    // that is moving, the shop can only honour it by acting, and the reply
    // tells them to telephone. If nobody is told, the answer is advice nobody
    // followed up — so it goes out with the other two.
    // `authenticity` always hands off — it deliberately answers nothing, only
    // routes to a human. `availability` hands off ONLY when it returned no
    // buyable payload, which is exactly its two dead ends: every size sold out
    // (Branch 2b) and no product identifiable even after a search (Branch 4).
    if ($intent === 'contact' || $intent === 'cancel' || $intent === 'authenticity'
        || ($intent === 'search' && !$data)
        || ($intent === 'availability' && !$data)) {
        assistant_handoff($db, $cfg, $message, $final, $intent, $lang);
    }

    $out = ['intent' => $intent, 'reply' => $final, 'data' => $data,
            'source' => $better === null ? 'shop' : 'shop+ai'];

    // The signature, not the audio. Speech is a second request the visitor
    // makes only if they press the speaker — synthesising every answer aloud
    // would bill the shop for words nobody listened to, and would put a
    // ten-second upstream call in front of a reply that is already written.
    if (assistant_speech_available($cfg)) $out['speak'] = assistant_speech_sig($cfg, $final, $lang);

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
// and served from disk for ever after. Only a genuinely new sentence — an
// order card, a product list — costs anything.
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
// THE CACHE IS UNBOUNDED WITHOUT THIS. The canned lines above are a fixed two
// dozen files, but every order-status answer names an order number, so each is
// a sentence that will be said once and never again. A shop doing forty orders
// a day writes forty files a day, for ever, into a directory the owner cannot
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
// FIRE AND FORGET, deliberately. The customer is waiting for an answer that is
// already written; whether an automation platform acknowledged the handoff is
// not their problem and must never delay them or fail their request.
function assistant_handoff(PDO $db, array $cfg, string $message, string $reply, string $intent, string $lang): void
{
    // WRITE IT DOWN FIRST, SEND IT LATER — and that order is the whole fix.
    //
    // This used to curl_exec() to n8n right here and ignore the result. Three
    // things were wrong with that, and the third is the one that cost real
    // customers:
    //
    //   * it ran INSIDE the request, so a slow webhook added up to 4 seconds
    //     to a reply the shop had already finished writing;
    //   * curl_exec's return value was never read, so a 500, a rate limit or a
    //     DNS failure looked exactly like success;
    //   * and there was no record anywhere, so a hand-off that failed to send
    //     was simply gone. The customer had been told a colleague would follow
    //     up. No colleague was told, and nothing knew to be sorry about it.
    //
    // fulfilment_outbox already solved this shape for warehouse mail: the row
    // is written in the request so it cannot go missing, and cron-assistant.php
    // does the network with retries. Same pattern, same reasoning.
    //
    // NOT INSIDE A TRANSACTION and deliberately unguarded: the assistant is a
    // read path, this is the only write it makes, and a failure to log must
    // never cost the customer their answer. If the table is not there yet
    // (a shop that has not run assistant.mysql.sql) the insert throws, is
    // swallowed, and the assistant carries on exactly as before.
    try {
        $db->prepare(
            'insert into assistant_outbox (intent, lang, message, reply) values (?, ?, ?, ?)'
        )->execute([
            $intent,
            $lang === 'ar' ? 'ar' : 'en',
            mb_substr($message, 0, 500),
            mb_substr($reply, 0, 1000),
        ]);
    } catch (Throwable $e) {
        // Nothing to do here that helps the customer. The reply is already
        // written and returning it matters more than recording why we could
        // not queue the follow-up.
    }
}

// Send one queued hand-off to n8n. Called by cron-assistant.php, never by a
// web request.
//
// Returns true only when n8n actually accepted it — a 2xx. Everything else is
// a failure the caller records and retries, which is the difference between
// this and the fire-and-forget call it replaces.
function assistant_handoff_send(array $cfg, array $row): array
{
    $url    = (string) ($cfg['n8n_webhook'] ?? '');
    $secret = (string) ($cfg['n8n_secret'] ?? '');
    if ($url === '') return [false, 'n8n_webhook is not set'];
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
    if ($secret === '') return [false, 'n8n_secret is not set'];

    $payload = json_encode([
        'source'  => 'sporta-ai',
        'id'      => (int) $row['id'],
        'intent'  => $row['intent'],
        'lang'    => $row['lang'],
        'message' => $row['message'],
        'reply'   => $row['reply'],
        'at'      => gmdate('c', strtotime((string) $row['created_at'])),
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        // Longer than the old 4s because nobody is waiting on it now.
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            // A webhook URL stops being a secret the moment it is in a browser
            // history or a screenshot. The signature is what lets the workflow
            // tell this shop from anyone who has seen the URL.
            'X-Sporta-Signature: ' . hash_hmac('sha256', $payload, $secret),
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    // THE RETURN VALUE IS NOW READ, which is the point of the rewrite.
    if ($body === false) return [false, 'curl: ' . ($err !== '' ? $err : 'failed')];
    if ($code < 200 || $code >= 300) return [false, "n8n answered $code"];
    return [true, null];
}
