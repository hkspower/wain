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
            // ROUND FIVE: the MSA future, «متى سيصل الطلب» / «متى سيصلني الطلب» — only «متي يصل» was here.
            'سيصل', 'سيصلني', 'سيصلك', 'سيوصل', 'متي سيصل', 'متي ستصل', 'متي ستصلني',
            'tawseel', 'twseel', 'delivry',
            'deliver*', 'shipping', 'ship', 'shipped', 'arrive', 'arrived', 'arriving',
            // NOT a bare "how long": "how long are the leggings" is about the
            // garment, and was answered with the courier's timetable.
            'how long does', 'how long will', 'how long for', 'how long to', 'how long until',
            'how many days', 'how soon',
            // «متى يجيني الطلب», «كم ياخذ وقت؟». Not a bare «يجيني»: «المقاس
            // يجيني؟» is "will the size fit me".
            'متي يجيني', 'متي بيجيني', 'يجيني الطلب', 'ياخذ وقت', 'تاخذ وقت', 'كم ياخذ', 'كم تاخذ', 'كم يطول',
            // NOT a bare "when will", and not a bare "when will it / they"
            // either: those were the PARCEL's timetable for "when will they
            // call me back", "when will it be available in XL" and "when will
            // it go on sale". Only the parcel's own verbs: arrive (above),
            // come, get here, be delivered (deliver*), reach.
            'when will it come', 'when will they come', 'when does it come', 'will it reach', 'will they reach',
            'it reach me', 'when will i get it', 'when will i get my', 'when will i receive', 'when will i have it',
            'when will i have my', 'when do i get it', 'when do i get my', 'receive it', 'get here', 'get to me',
            'expect it', 'expect my', 'expect the parcel', 'expect the package', 'expect the order',
            // The courier is the delivery: "can the courier come in the
            // evening" was a greeting (by "evening"), "can the driver leave it
            // at the door" «ما لقيت شي».
            'courier', 'driver', 'delivery guy', 'delivery man',
            'get it today', 'get it tomorrow', 'have it today', 'have it tomorrow', 'come today', 'come tomorrow',
            'arrive today', 'arrive tomorrow', 'send it today', 'send it tomorrow', 'deliver today', 'deliver tomorrow',
            'it today', 'it tomorrow', 'by tomorrow', 'before friday', 'before the weekend'];
}

// "When will it be back" is about STOCK, not the courier. English only: the
// Arabic delivery words (يوصل/توصيل) never name a restock, and «يرجع» is also
// money coming back (a refund), which must reach the returns test. Not a bare
// "available": "is delivery available to Jahra" is a delivery question.
function assistant_restock_words(): array
{
    return ['restock*', 'back in stock', 'in stock again', 'be back', 'come back', 'coming back',
            'available again', 'sold out', 'in stock', 'new stock', 'it be available', 'they be available',
            'be available in', 'have size', 'have it in', 'have them in'];
}

// WHAT A SALE QUESTION SOUNDS LIKE — one list, read by the router and by the
// shelf (assistant_recommend), so «في تخفيض؟» cannot be routed to search while
// the shelf would have known it. It was two lists, and «تخفيض» and «عرض» sat
// only in the shelf's, which never saw them: «في تخفيض؟» and «في عرض؟» were
// answered «ما لقيت شي يطابق كلامك», which reads as "no deals".
//
// «عرض» as a whole word: it is inside «معرض» (a showroom) and «عرضه» (its
// width). «خصم» the NOUN only, anchored: the verb «انخصم» is money taken,
// sent to a person long before (assistant_money_complaint).
function assistant_sale_words(): array
{
    return ['^خصم$', '^الخصم$', '^بخصم$', '^والخصم$', 'في خصم', 'خصومات', 'عروض', '^عرض$', '^العرض$',
            '^بعرض$', 'تخفيض', 'تنزيلات', 'الجمعه البيضاء',
            'sale', 'on sale', 'discount*', 'offers', 'any offer', 'special offer', 'deals', 'any deal',
            'good deal', 'best deal', 'great deal', 'promo', 'promos', 'promotion*',
            'black friday', 'white friday'];
}

// MONEY TAKEN THAT SHOULD NOT HAVE BEEN. In Kuwaiti banking «خصم» is also the
// VERB "debited" — «انخصم المبلغ مرتين» is "the amount was taken twice" — and
// the shop's own stage_unpaid line says «إذا خُصم المبلغ من حسابك», so
// customers say it back. A substring 'خصم' answered those complaints with the
// discount shelf, and the shelf never reaches a person. They go to contact,
// which is handed off: somebody has to look at the payment.
//
// The discount NOUN is matched separately and anchored (assistant_sale_words),
// so «في خصم؟» is still a question about offers.
//
// THESE ALONE SAY MONEY MOVED, AND SAY IT IN THE PAST: each is a complaint on
// its own, even inside an "if". Round two listed the bare "money taken",
// "payment taken" and "two payments" here, and "is payment taken at delivery?",
// "can I split it into two payments" were emailed to staff as PAYMENT PROBLEMs
// — those are assistant_money_weak's, which a question about how paying works
// does not reach.
function assistant_money_words(): array
{
    return ['^انخصم', '^خصمو', '^خصمت', '^تم خصم', 'خصم مني', 'خصمو مني', 'انسحب المبلغ', '^انسحب', '^سحبو',
            'سحب مني', 'سحبت مني', 'دفعت مرتين', 'انخصم مرتين', 'تم الدفع مرتين', 'انحسب علي', 'انحسبت علي',
            'نزل من حسابي', 'نزلت من حسابي', 'طلع من حسابي', 'طلعت من حسابي', 'راح من حسابي', 'راحت من حسابي',
            'من حسابي مرتين', '^انحجز', 'المبلغ محجوز', 'محجوز من حسابي',
            'charged me twice', 'double charged', 'charged me', 'i was charged', 'was charged', 'were charged',
            'got charged', 'been charged', 'paid twice', 'money was taken', 'payment was taken', 'took my money',
            'took money', 'took the money', 'taken from my account', 'went through twice', 'charged my card',
            'card was charged', 'card got charged', 'billed twice', 'billed me', 'was billed', 'been billed',
            'double billed', 'was deducted', 'were deducted', 'got deducted', 'was debited', 'got debited',
            'money left my', 'left my account',
            // ROUND FOUR: the ways money is said to have gone that the lists above
            // did not hold. «اخذتوا فلوسي», «سحبتوا مني فلوس» ("you took my
            // money"), «رسالة خصم من البنك» (the bank's debit SMS) and Arabizi
            // "flosi inkhasmat marteen" went to the search box or the offers shelf,
            // and "I was overcharged" / "the money is gone" to nowhere.
            'اخذتوا فلوس', 'اخذتو فلوس', 'اخذتم فلوس', 'خذتوا فلوس', 'خذتو فلوس', 'خذيتو فلوس', 'خذيتوا فلوس', 'اخذو فلوس',
            'اخذتوا المبلغ', 'اخذتو المبلغ', 'اخذتم المبلغ', 'خذتو المبلغ', 'سحبتوا', 'سحبتو', 'سحبتم', 'دفعت مره ثانيه',
            'دفعت مره اخرى', 'رساله خصم', 'خصم من البنك', 'خصم من حسابي', 'خصم من بطاقتي', 'خصم من البطاقه', 'راحت فلوسي',
            'فلوسي راحت', 'فلوسي انخصم',
            'took my payment', 'took my cash', 'took the payment', 'taken my money', 'money is gone', 'money gone',
            'money was gone', 'money disappeared', 'overcharged', 'over charged', 'over-charged', 'charged too much',
            'charged extra', 'charged more than', 'wrongly charged', 'charged by mistake', 'charged again', 'paid again',
            'paid a second time', 'paid for a second time', 'paid it twice', 'paid two times', 'paid double',
            'double paid', 'payment done twice', 'payment made twice', 'transferred the money', 'transferred money',
            'i transferred', 'i have transferred', "i've transferred", 'deducted from', 'money deducted', 'amount deducted',
            'amount debited', 'debited from', 'charged to my card', 'charge on my card',
            // ROUND FIVE: the duplicate, the deduction as a noun, the hold, the debt, and the MSA
            // «تم السحب من بطاقتي» ("it was withdrawn from my card"). «دفع مكرر» is a duplicate payment.
            'double payment', 'duplicate payment', 'duplicated payment', 'duplicate charge', 'double charge', 'two charges',
            '2 charges', 'two deductions', '2 deductions', 'deduction message', 'deduction sms', 'debit message',
            'debit sms', 'you owe me', 'owe me money', 'owe me a refund',
            'دفع مكرر', 'سحب مكرر', 'خصم مكرر', '^تم السحب', '^تم سحب', '^تم الخصم من', 'مبلغ مكرر',
            // Arabizi: "inkhasam", "in7asab", "khasamo" (debited); the money itself is in $pay below.
            'inkhasm*', 'inkhasam*', 'enkhasm*', 'enkhasam*', 'in7asab*', 'in7asam*', 'inhasab*', 'khasamo', 'khasmo',
            'sa7abo', 'sa7abou', 'sahabo'];
}

// Money words that say it moved only when the sentence is not asking how
// paying works: "charged twice" is a complaint, "will I be charged twice for
// delivery if I order 2 items" a question about the fee.
function assistant_money_weak(): array
{
    return ['charged twice', 'charged two times', 'double charge', 'deducted', 'debited', 'money taken',
            'payment taken', 'two payments', 'card charged', '^ينخصم', '^تنخصم', 'خصم المبلغ', 'سحب المبلغ',
            // ROUND FIVE: a hold on the card (it may be a hold the bank puts on a pending authorisation).
            'money on hold', 'money is on hold', 'funds on hold', 'amount on hold', 'payment on hold', 'on hold from my',
            'hold on my card', 'held on my card', '^ينسحب', '^تنسحب'];
}

// MONEY TAKEN, SAID THE WAY PEOPLE SAY IT. assistant_money_words held only the
// exact sentences the first review quoted, so "my card was charged but the order
// failed" got the payment-methods line, and «المبلغ نزل من حسابي والطلب ما انعمل»
// got «ما لقيت شي» — and n8n only logs a failed search, so nobody heard either.
//
// Three ways in: a past-tense phrase that alone says money moved; a weaker
// money phrase; or a payment word next to what went wrong (failed, pending,
// unpaid, «مو مؤكد»). "But" and «بس» only with a PAST money word — «تقبلون
// كي نت بس؟» is "KNET only?", not a complaint.
//
// NOT A QUESTION ABOUT HOW PAYING WORKS. The last two ways in are closed to a
// hypothetical ("what if my payment fails?", «اذا فشل الدفع شسوي؟») with no
// past money word in it, and to a sentence that opens by asking (is / will /
// can / do / هل) about WHEN or an instalment ("is my payment pending until
// delivery?", "can I split it into two payments", «يعني تقسيط»). Those are
// the payment or delivery questions they were before round two. "Double" is
// a complaint only next to money that moved — "do you charge double for
// express delivery" is a fee question. «حسابي» is not a payment word on its
// own: «فشل تسجيل الدخول لحسابي» is a log-in that failed.
//
// NOT A DISCOUNT QUESTION. "is the discount deducted automatically?" and «تم
// خصم ١٠٪ من السعر؟» say money came OFF, and were emailed to staff as somebody
// wanting a person. A message that names a discount and nothing that went wrong
// is left for the offers shelf.
// "WHAT DOES PENDING MEAN", "payment pending, is that normal": asking what a
// STATE is, with no failure word beside it. Not a payment problem (it was emailed
// to staff as PAYMENT PROBLEM: money taken, order not right) and not the list of
// payment methods either — the answer is that order's own stage, which is one
// look-up away: the router sends it to order_status, which asks for the number,
// and stage_unpaid then says what is true of it and where to write if money left.
function assistant_pending_meaning(string $t): bool
{
    return assistant_has($t, ['what does', 'what do you mean', 'what is', "what's", 'whats', 'meaning', 'mean',
                              'is that normal', 'is this normal', 'is it normal', 'يعني ايش', 'شنو يعني',
                              'وش يعني', 'معنى', 'طبيعي'])
        && assistant_has($t, ['pending', 'unpaid', 'not paid', 'معلق', 'غير مدفوع', 'مو مدفوع'])
        && !assistant_has($t, ['failed', 'fail', 'error', 'twice', 'charged', 'taken', 'deducted', 'فشل', 'مرتين', 'انخصم']);
}

function assistant_money_complaint(string $t): bool
{
    $wrong = ['twice', 'two times', '2 times', 'failed', 'fail', 'error', 'pending', 'unpaid', 'not paid',
              'not confirmed', 'no confirmation', 'no order', 'not placed', 'not go through', 'did not go through',
              "didn't go through", 'declined but', 'says unpaid', 'shows unpaid',
              'مرتين', 'مرتان', '^دبل', 'ما تاكد', 'ما تأكد', 'مو مؤكد', 'مب مؤكد', 'غير مؤكد', 'ما ظهر',
              'غير مدفوع', 'مو مدفوع', 'ما انعمل', 'ما اندفع', 'فشل', '^خطا', 'ايرور', 'معلق', 'ولا وصلني تاكيد',
              'ما وصلني تاكيد', 'والطلب ما',
              // ROUND FOUR: "I paid and nothing happened", "the page froze",
              // "my payment is stuck" — the payment is in a state the customer
              // cannot see into, and the money may have left.
              'nothing happened', 'nothing happen', 'no response', 'not responding', 'froze', 'frozen', 'freez*', 'stuck',
              'hung', 'timed out', 'timeout', 'crashed', 'did not get a confirmation', "didn't get a confirmation",
              'did not receive a confirmation', "didn't receive a confirmation", 'not get a confirmation',
              'without a confirmation', 'no email', 'marteen', 'marten', 'mrten', 'martein',
              'ما صار شي', 'ما صار شيء', 'ولا شي صار', 'ما وصلني ايميل', 'ما وصل ايميل', 'ما وصلني رساله', 'ما جاني تاكيد',
              'ما جا تاكيد'];
    $past = ['paid', 'payment went through', 'went through', 'was charged', 'got charged', 'were charged',
             'was taken', 'was deducted', 'دفعت', 'تم الدفع', 'انخصم', 'خصمو', 'سحبو',
             'i made a payment', 'i made the payment', 'made a payment', 'made the payment', 'payment made',
             'payment done', 'i transferred', 'transferred', 'paid already', 'already paid', 'لقد دفعت', 'قمت بالدفع'];
    // WHAT A COMPLAINT SAYS AFTER "BUT": something did NOT happen. "I paid …
    // but want to change the size" carries a past money word and a "but" and is
    // a customer with a change to make, not a payment problem — it was emailed
    // to staff as PAYMENT PROBLEM: money taken, order not right.
    $negAfter = ['nothing', 'not', 'no', 'never', 'failed', 'fail', "didn't", "hasn't", "haven't", "wasn't", "isn't", "can't",
                 'cannot', 'without', 'still', 'neither', '^ما$', '^لا$', '^لم$', '^ولا$', '^مو$', '^مب$', 'بدون', 'للحين',
                 'لحد الحين', 'لحد الان'];
    // Twice, on purpose: "I paid twice for the same item because I wanted two".
    // A mistake word beside it keeps it a complaint.
    $onPurpose = assistant_has($t, ['because i wanted', 'because i want', 'on purpose', 'intentionally', 'i wanted two',
                                    'wanted two', 'two items', '2 items', 'two of the same', 'عن قصد', 'لاني ابي', 'عشان ابي'])
        && !assistant_has($t, ['mistake', 'accident', 'failed', 'error', 'nothing', 'بالغلط', 'غلط', 'فشل']);
    if ($onPurpose) return false;
    $direct = assistant_has($t, assistant_money_words());
    // The ways a payment is said to have gone MISSING, which need a payment word beside
    // them (round five). SPECIFIC ones — a page, a browser or a phone that stopped; a bank
    // page that did not send the customer back — can only be about paying. GENERIC ones —
    // «ما في طلب», «ولا شي», "nothing came" — also need the customer to say they paid, or
    // «ما في كي نت؟» ("is there no KNET?") would be a complaint.
    $lostSpecific = ['page closed', 'browser closed', 'tab closed', 'app closed', 'window closed', 'closed the page', 'closed the browser',
                     'closed the tab', 'closed the app', 'closed my browser', 'closed by itself', 'phone died', 'phone is dead',
                     'phone went dead', 'phone turned off', 'phone switched off', 'phone shut', 'battery died', 'ran out of battery',
                     'lost connection', 'lost signal', 'connection dropped', 'connection lost', 'connection cut', 'internet cut',
                     'internet dropped', 'internet went', 'session expired', 'session timed out', 'went blank', 'blank page',
                     'white page', 'white screen', 'came back blank', 'not redirected', 'never redirected', 'was not redirected',
                     'was never redirected', 'did not redirect', "didn't redirect", 'did not return me', "didn't return me",
                     'did not take me back', "didn't take me back", 'did not send me back', "didn't send me back",
                     'ما رجعني', 'ما رجع للموقع', 'ما رجعت للموقع', 'ما رجعنا للموقع', 'ما حولني', 'ما حولتني',
                     '^وقف', '^وقفت', '^علق', '^علقت', '^يعلق', '^تعلق', 'سكر المتصفح', 'سكرت الصفحه', 'سكرت المتصفح',
                     'اغلق المتصفح', 'اغلقت المتصفح', 'اغلقت الصفحه', 'انطفا', 'انطفى', 'انفصل النت', 'انقطع النت', 'انقطع الانترنت'];
    $lostBack = preg_match('/(?:not|n\'t|never)\s+(?:\w+\s+){0,2}(?:come|go|return|redirect\w*|take\s+me|send\s+me)\s+(?:me\s+)?back\s+(?:to\s+)?(?:the|your|this|my|sporta|its)\s+(?:\w+\s+)?(?:site|website|shop|store|page|sporta)/', $t) === 1;
    $lostGeneric = ['ما في طلب', 'مافي طلب', 'ما فيه طلب', 'ما في تاكيد', 'مافي تاكيد', 'ولا في تاكيد', 'ما في ايميل', 'مافي ايميل',
                    'ما في رساله', 'مافي رساله', 'ما في اشعار', 'مافي اشعار', 'ولا شي', 'ولا شيء', 'ما وصلني شي', 'ولا وصلني شي',
                    'ما وصل شي', 'ما وصلني اي شي', 'ما طلع لي', 'ما طلعلي', 'ما اجاني', 'ما جاني اشعار', 'ما جاني ايميل',
                    'لم اتلق', 'لم يظهر', 'ولم يظهر', 'لم تظهر', 'ما ظهر لي', 'لم يصلني تاكيد', 'ولم يصلني', 'اكثر من مره',
                    'اكثر من مرتين', 'مكرر', 'dfa3t w ma', 'ma wsalni', 'ma wasalni', 'ma wslni', 'ma jani', 'ma tm', 'ma sar',
                    'nothing came', 'nothing arrived', 'no order', 'no email', 'nothing in my email'];
    $paidWord = array_merge($past, ['paying', 'after payment', 'after the payment', 'after i paid', 'after paying', 'قمت بالدفع',
                                    'بعد الدفع', 'بعد ما دفعت', 'بالدفع', 'dfa3t', 'dfa3to', 'dafa3t', 'dafaet', 'dfaet']);
    // "Please confirm my payment": the customer paid and wants to hear that it arrived. A person
    // can see it; the payment-methods line is the one answer that invites a second payment.
    // Never a question that opens with is / how / when…: "how do I confirm my payment".
    $confirmAsk = ['did you receive my payment', 'have you received my payment', 'did you get my payment', 'payment received',
                   'confirm my payment', 'confirm the payment', 'confirm payment', 'please confirm', 'confirm receipt',
                   'payment completed', 'payment complete', 'payment is done', 'payment was done', 'payment done',
                   'وصلكم الدفع', 'وصلكم المبلغ', 'استلمتوا الدفع', 'استلمتم الدفع', 'استلمتوا المبلغ', 'تاكيد الدفع', 'اكدوا الدفع'];
    $startsAsking = preg_match('/^(?:is|are|will|would|can|could|do|does|should|how|what|when|where|why|هل|كيف|متي|وش|شنو|ايش)(?![\p{L}\p{N}])/u', $t) === 1;
    // An overcharge: what was taken is MORE than what was shown, or the discount did not land. "Paid" alone is
    // not enough for "the full price" — "I paid the full amount, when does it ship" is not a complaint — but
    // "charged / billed / deducted" are, and so is «انخصم المبلغ كامل».
    $overCharged = ['charged', 'billed', 'deducted', 'debited', 'taken', 'انخصم', 'انسحب', 'خصمو', 'سحبو', 'انحسب'];
    $overAny = ['charged', 'billed', 'paid', 'deducted', 'debited', 'انخصم', 'انسحب', 'دفعت', 'سحبو', 'خصمو', 'انحسب'];
    $overcharge = false;
    // A QUESTION THAT OPENS WITH when / how / what / where («متى», «كيف», «شلون», «وقت») is about how paying
    // works: "when is my card charged", "how is payment taken", «متى ينخصم المبلغ». Unless the sentence
    // says the money DID move (was / got / been, «تم»), says it moved twice, or owns a mistake: "when was
    // my card charged twice" is still a complaint. («Why» is left out: "why was I charged twice".)
    $opensAsking = preg_match('/^(?:when|how|what|where|متي|كيف|شلون|وقت|وش|شنو|ايش)(?![\p{L}\p{N}])/u', $t) === 1
        && !assistant_has($t, ['was', 'were', 'got', 'been', 'did', 'has', 'have', 'had', 'twice', 'two times', 'double', 'mistake',
                               'wrong', '^تم$', 'انخصم', 'خصمو', 'سحبو', 'مرتين', 'بالغلط', 'غلط']);
    // The strong money words that are really about WHEN money is taken ("when is the money deducted", "what gets charged to
    // my card", «متى ينخصم المبلغ») do not make a complaint when the sentence opens by asking.
    if ($direct && $opensAsking && !assistant_has($t, array_diff(assistant_money_words(), ['money deducted', 'amount deducted',
            'deducted from', 'amount debited', 'debited from', 'charged to my card', 'charge on my card', '^تم السحب', '^تم سحب']))) {
        $direct = false;
    }
    // An overcharge outranks a discount word (below), whichever way the money word was found.
    $overcharge = assistant_has($t, ['overcharg*', 'over charged', 'over-charged'])
        || (assistant_has($t, ['full price', 'full amount', 'whole price', 'whole amount', 'كامل', 'كاملا', 'زياده'])
            && assistant_has($t, $overCharged))
        || (assistant_has($t, ['not applied', 'was not applied', "wasn't applied", 'did not apply', "didn't apply", 'more than the',
                               'more than listed', 'more than it', 'more than i', 'higher than', 'wrong total', 'wrong amount',
                               'wrong price', 'higher price', 'اكثر من السعر', 'اكثر من المفروض', 'اكثر من المبلغ', 'مو صحيح',
                               'مب صحيح']) && assistant_has($t, $overAny))
        || (preg_match('/\d[^.?!]{0,12}instead of\s+\d/', $t) === 1 && assistant_has($t, $overAny));
    if (!$direct) {
        $hypothetical = !assistant_has($t, $past)
            && assistant_has($t, ['if', 'what if', 'in case', 'what happens', '^اذا$', '^لو$', 'في حال', '^لنفرض']);
        $howItWorks = assistant_pending_meaning($t) || assistant_has($t, ['تقسيط', 'اقساط', '^قسط', 'installment*', 'instalment*', 'split', 'tabby',
                                         'tamara', '^تابي$', 'تمارا', 'pay in two', 'pay in 2', 'in two payments', 'in 2 payments', 'two installments'])
            || $opensAsking
            || (preg_match('/(?:^|[.,!?؟،]\s*)(?:is|are|will|would|can|could|do|does|should|هل)\s/u', $t) === 1
                && assistant_has($t, ['when', 'at delivery', 'on delivery', 'upon delivery', 'until', 'before',
                                      'upfront', 'in advance', 'often', 'usually', 'normally', 'ever', 'متي',
                                      'عند الاستلام', 'عند التوصيل', 'قبل']));
        if (!$hypothetical && !$howItWorks) {
            $pay = ['payment', 'payments', 'paid', 'paying', 'charged', 'charge', 'money', 'amount', 'knet', 'bank', 'my card',
                    'billed', 'transaction', 'دفعت', 'الدفع', 'دفع', 'المبلغ', 'الفلوس', 'فلوسي', 'البطاقه', 'كي نت',
                    'البنك', 'العمليه', 'المصرف', 'flosi', 'flousi', 'floosi', 'fulusi', 'dfa3t', 'dfa3to', 'dafa3t', 'dafaet', 'dfaet'];
            $direct = assistant_has($t, assistant_money_weak())
                || $overcharge
                || (assistant_has($t, $pay) && (assistant_has($t, $wrong)
                    || (assistant_has($t, ['double']) && assistant_has($t, ['charged', 'paid', 'billed', 'taken', 'deducted']))
                    || (assistant_has($t, $past) && assistant_has($t, ['but', 'however', 'and', 'then', 'yet', '^بس$', '^لكن$', '^بعدين$'])
                        && assistant_has($t, $negAfter))
                    || assistant_has($t, $lostSpecific) || $lostBack
                    || (assistant_has($t, $paidWord) && assistant_has($t, $lostGeneric))
                    || (!$startsAsking && assistant_has($t, $confirmAsk) && assistant_has($t, ['payment', 'paid', 'pay', 'knet', 'دفع', 'الدفع', 'المبلغ', 'كي نت']))));
        }
    }
    if (!$direct) return false;
    $discount = assistant_has($t, ['discount*', 'code', 'coupon*', 'promo*', 'voucher*', 'offer*', 'sale',
                                   'كود', 'كوبون', 'عرض', 'عروض', 'تخفيض', 'السعر', 'خصومات', '%', '٪', 'بالميه']);
    // A discount word suppresses the complaint (it is an offers question), unless something went wrong
    // — or the customer says what they were charged was MORE than the price, which is a billing dispute
    // whether or not a code was involved (round five).
    return !$discount || $overcharge || assistant_has($t, $wrong);
}

// UNAUTHORISED CHARGES, FRAUD AND DISPUTES. "someone used my card on your site", "I did not make this
// purchase", "chargeback", «حد استخدم بطاقتي في موقعكم» were answered with the payment methods, or
// «ما لقيت شي» (a search gap, which emails nobody). They are a person's, with the money line — and the
// payment-methods line was an invitation to pay again. A fraud word alone is enough; the softer phrases
// ("did not place", "without my permission") need money or a card beside them.
function assistant_fraud(string $t): bool
{
    if (assistant_has($t, ['fraud*', 'chargeback', 'charge back', 'unauthori*', 'احتيال', 'نصب علي', 'سرقو فلوسي', 'سرقه بطاقتي'])) return true;
    $money = assistant_has($t, ['card', 'charge', 'charged', 'payment', 'paid', 'bank', 'money', 'account', 'purchase', 'transaction',
                                'بطاقتي', 'البطاقه', 'حسابي', 'المبلغ', 'فلوسي', 'خصم', 'انخصم', 'الدفع', 'دفعت']);
    if (!$money) return false;
    return assistant_has($t, ['without my permission', 'without permission', 'without my knowledge', 'without my consent',
                              'without me knowing', 'did not make this', "didn't make this", 'did not make that', "didn't make that",
                              'did not place', "didn't place", 'did not order', "didn't order", 'not my order', 'not my purchase',
                              'not my transaction', 'someone used my', 'somebody used my', 'someone else used', 'used my card',
                              'my card was used', 'card has been used', 'card got used', 'card was stolen', 'stolen card',
                              'hacked', 'dispute', 'disputed', 'disputing',
                              'بدون علمي', 'بدون اذني', 'بدون موافقتي', 'بدون ما اعرف', 'ما طلبت شي', 'ما طلبت هذا', 'ما سويت طلب',
                              'ما اشتريت', 'استخدم بطاقتي', 'استخدمو بطاقتي', 'استخدموا بطاقتي', 'استخدمت بطاقتي', 'احد استخدم',
                              'حد استخدم', 'سرقو', 'سرق ', 'اعتراض على']);
}

// THE COURIER TAKES THE MONEY. Checkout is cash on delivery, so a courier who
// asked for more, took a fee or kept the change is a money complaint, and a
// courier who never came, never called or was rude is a complaint about the
// delivery — and both were answered with the courier's own timetable, which
// ends «يصلك اتصال من المندوب قبل الوصول», or with «ما لقيت شي». [topic, or null]
function assistant_courier_problem(string $t): ?string
{
    if (!assistant_has($t, ['مندوب', 'السايق', 'الدليفري', 'driver', 'courier', 'delivery guy', 'delivery man',
                            'delivery boy', 'delivery person'])) {
        return null;
    }
    // Money AND a verb of taking or asking: «المندوب طلب مني رقم البيت» is not
    // a money complaint, «المندوب طلب اكثر من المبلغ» is.
    if (assistant_has($t, ['طلب مني', 'طلب اكثر', 'خذ مني', 'اخذ مني', 'زياده', 'اكثر من', 'الباقي', 'ما عطاني',
                           'asked for', 'asked me for', 'took', 'give me change', 'gave me change', 'give me the change',
                           'my change', 'more than', 'extra'])
        && assistant_has($t, ['دينار', 'فلوس', 'المبلغ', 'الباقي', 'زياده', 'kd', 'kwd', 'dinar*', 'money', 'change',
                              'cash', 'fee', 'charge*'])) {
        return 'money';
    }
    // Late as a fact, not a question: «المندوب يتأخر؟» and "will the courier
    // come late at night" are asking about delivery.
    if (assistant_has($t, ['ما جا', 'ما اجا', 'ما جاني', 'ما وصل', 'ما رد', 'ما يرد', 'ما اتصل', 'ما يتصل', 'وقح',
                           'قليل ادب', '^تاخر', '^متاخر', 'never came', "didn't come", 'did not come', "didn't show",
                           'did not show', 'no show', 'never showed', 'never called', "didn't call", 'did not call',
                           'not answering', "doesn't answer", "didn't answer", 'rude', 'is late', 'was late', 'came late',
                           'very late', 'so late', 'running late', 'late again', 'shouted', 'yelled', 'hung up'])) {
        return 'courier';
    }
    return null;
}

// Hello, in the ways Kuwait says it. Anchored, because the bare substrings
// were inside real words: هلا in الهلال (an Al-Hilal shirt), صباح in صباح
// السالم (a delivery area), هاي in نهاية. Shared with assistant_answer, which
// strips these to see whether anything else was asked.
function assistant_greeting_words(): array
{
    // NOT «مع السلامه»: it starts with «السلام» and is GOODBYE, answered with
    // the thanks line (assistant_is_goodbye), never the welcome.
    return ['^سلام', '^السلام', '^مرحب', '^هلا$', '^هلاا', '^ياهلا', '^اهلا', '^اهلين', '^هلو$', '^هلوو',
            'صباح الخير', 'صباح النور', 'صباح الورد', '^صباحو', 'مساء الخير', 'مساء النور', 'مساء الورد',
            // «مسا» is how «مساء» is typed; «حياك/حياكم الله» is a welcome.
            'مسا الخير', 'مسا النور', '^حياك',
            // Kuwaiti هاي is also "this"; whole word only, and safe because a
            // greeting that carries a product question is searched anyway.
            '^هاي$', 'hala', 'marhaba',
            'hello', 'helo', 'helloo', 'hellooo', 'helloooo', 'hi', 'hii', 'hiii', 'hiiii', 'hey', 'heyy', 'heyyy',
            'heyyyy', 'hiya', 'yo', 'good morning', 'good evening', 'good afternoon', 'morning', 'evening', 'salam',
            'salamu', 'salaam', 'assalam', 'assalamu', 'asalamu', 'asalam',
            'anyone there', 'anybody there', 'any one there', 'you there', 'someone there',
            // SMALL TALK IS A HELLO. «شلونك» and "how are you" on their own were
            // searched, and answered "I could not find anything in the shop"
            // — then handed to staff as a failed search.
            '^شلونك', '^شلونج', '^شخبارك', '^اخبارك', '^علومك', 'كيف حالك', 'كيف الحال', '^كيفك$', 'شلون الحال',
            'shlonak', 'shlonik', 'shlonich', 'shlonkom', 'shlonkum', 'shakhbarak',
            'how are you', 'how are u', 'how r u', "how's it going", 'how is it going',
            "what's up", 'whats up', 'wassup'];
}

// "IS ANYONE THERE?" AND "I HAVE A QUESTION", as the whole message: a hello.
// «موجودين؟» and «احد موجود؟» named «موجود», which the "what do you have"
// rule read as a request for the shelf; «عندي استفسار» was searched. Whole
// message only — «الليقنز موجودين؟» is about leggings.
function assistant_is_presence(string $t): bool
{
    $t = preg_replace('/^[\s\p{P}]+/u', '', $t) ?? $t;
    return preg_match('/^(?:(?:هل|يا)\s+)?(?:(?:فيه|في|اكو)\s+)?(?:(?:احد|حد|احدن)\s*)?(?:موجود|موجودين|موجوده|هني|هنا)?[\s\p{P}]*$/u', $t) === 1
            && preg_match('/احد|حد|موجود/u', $t) === 1
        || preg_match('/^(?:i have|i got|i\'ve got|got) (?:a |an )?(?:quick |small |little )?(?:question|inquiry|enquiry|query)[\s\p{P}]*$/u', $t) === 1
        || preg_match('/^(?:(?:انا|ابي|ممكن)\s+)?(?:عندي\s+)?(?:سوال|استفسار|اسال|استفسر)(?:\s+(?:بسيط|صغير|لو سمحت|لو سمحتو))?[\s\p{P}]*$/u', $t) === 1
        // "help", "who are you", «انت روبوت؟»: the welcome says what it can do.
        || preg_match('/^(?:help|help me|help please|please help|i need help|need help|can you help(?: me)?|who are you|are you a bot|are you a robot|what can you do|مساعده|ساعدني|ابي مساعده|احتاج مساعده|ممكن مساعده|مين انت|من انت|انت روبوت|انت بوت|انتم روبوت|انتم بوت|انتو روبوت|انتو بوت|شنو تقدر تسوي)[\s\p{P}]*$/u', $t) === 1;
}

// GOODBYE IS THANKS, NOT HELLO. «مع السلامه» matched «^السلام» and was answered
// «أهلًا بك في سبورتا» as the customer left; "bye" and «ارجع لكم بعدين» ("I
// will get back to you") were searched — the second one, through «ارجع», as a
// RETURN. Tested before the returns words for that reason, and only for a
// return to the CONVERSATION: «ارجع لكم القطعة» ("return the item to you")
// carries no «بعدين» and is still a return.
function assistant_is_goodbye(string $t): bool
{
    // «باي» is also the Pay of «ابل باي» and «تي باي».
    if (assistant_has($t, ['ابل باي', 'تي باي', 'تي-باي', 'جوجل باي'])) return false;
    // "SEE YOU" AND "COME BACK LATER" ONLY AS THE WHOLE MESSAGE: "can I see you
    // in person" is a location question and "will the black leggings come back
    // later" a restock one, and both were thanked and let go.
    if (preg_match('/^(?:(?:ok|okay|thanks|thank you|great|cool|bye)[\s\p{P}]*)*(?:see you|see ya|i will come back later|i\'ll come back later|come back later)(?:\s+(?:later|soon|tomorrow|then))?[\s\p{P}]*$/u', $t)) {
        return true;
    }
    return assistant_has($t, ['مع السلامه', 'في امان الله', 'فمان الله', '^باي$', '^بااي', 'bye', 'byee', 'bye bye',
                              'goodbye', 'good bye', 'cya', 'talk later', 'talk to you later',
                              'get back to you', 'later then'])
        || preg_match('/(?<![\p{L}])[بنا]?رجع\s*(?:ل[كي]م?|لكم)?\s*(?:بعدين|بعد شوي|لاحقا|بكره)(?![\p{L}])/u', $t) === 1;
}

// HOW KUWAIT ADDRESSES A CHAT: «هلا شباب», «مرحبا بنات», "hi ladies". Taken
// out with the greeting, because these are also the gender words search reads
// — «شباب» is men's, «بنات» women's — and «هلا شباب» was answered with four
// pairs of men's shorts instead of the welcome. assistant_answer separately
// refuses to turn a greeting into a search on gender alone.
function assistant_address_words(): array
{
    return ['شباب', 'الشباب', 'بالشباب', 'بنات', 'البنات', 'رجال', 'الرجال', 'يا جماعه', 'جماعه',
            'الجماعه', 'اخوي', 'خوي', 'اختي', 'حبيبي', 'يا اخوان', 'اخوان',
            'ladies', 'girls', 'guys', 'man', 'gents', 'bro', 'brother', 'sis', 'boys', 'friends',
            'everyone', 'folks', 'mate', 'dude', 'fam'];
}

// "ok", «تمام», «اوكي» — the customer acknowledging an answer. As a WHOLE
// message only, so "ok do you have leggings" is still a search; answered with
// the thanks line, which fits them exactly. They were searched before, and
// told nothing in the shop matched.
//
// Followed by a form of address — «اوكي حبيبي», «تمام اخوي», "ok bro" — it is
// still an acknowledgement; and a message that is ONLY emoji ("👍", "🙏") is
// one too. Both were searched and answered «ما لقيت شي».
function assistant_is_ack(string $t): bool
{
    static $re = null, $emoji = '/^[\s\p{P}]*(?:\p{So}[\x{FE0F}\x{200D}\x{1F3FB}-\x{1F3FF}\s\p{P}]*)+$/u';
    if ($re === null) {
        $words = ['ok', 'okay', 'okey', 'okk', 'k', 'kk', 'tamam', 'tmam', 'cool', 'great', 'perfect',
                  'alright', 'all right', 'got it', 'noted', 'fine', 'nice', 'understood', 'تمام', 'اوكي', 'اوكيه', 'اوك',
                  'طيب', 'زين', 'ماشي', 'ممتاز', 'عدل', 'اها', 'حلو', 'خلاص', 'فهمت', 'فهمت عليك', 'تم',
                  // "My bad": «انا غلطان» was filed as a wrong-item complaint.
                  'انا غلطان', 'غلطان', 'my bad'];
        $addr = array_merge(['يا'], assistant_address_words());
        $q = fn (array $ws) => implode('|', array_map(fn ($w) => preg_quote(assistant_normalise($w), '/'),
                                                     // Longest first, so «فهمت عليك» is tried before «فهمت».
                                                     (function ($ws) { usort($ws, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a)); return $ws; })($ws)));
        $sep = '(?![\p{L}\p{N}])[\s\p{P}\p{S}]*';
        $re = '/^(?:(?:' . $q($words) . ')' . $sep . ')+(?:(?:' . $q($addr) . ')' . $sep . ')*$/u';
    }
    return $t !== '' && (preg_match($re, $t) === 1 || preg_match($emoji, $t) === 1);
}

// ======================================================== ROUND FOUR: PEOPLE
//
// The rules below decide when a customer needs a PERSON, and they share one
// shape: a few words that say it, and the words that say it is only a question
// about how things work. Every one of them is tested in test:assistant against
// the sentences the fourth review quoted AND the ordinary messages that must
// keep their old answers.

// An order, named. «طلب» with its clitics and possessives, "order", "parcel",
// "package". Not «طلبت» ("I ordered") or «اطلب» ("I order"), which are verbs.
function assistant_order_word(string $t): bool
{
    return preg_match('/(?<![a-z])(?:orders?|purchases?|parcels?|packages?)(?![a-z])/', $t) === 1
        || preg_match('/(?<![\p{L}\p{N}])[وفبل]?(?:ال)?طلب(?:ي|يه|يتي|ك|نا|ه|ها|ات|اتي)?(?![\p{L}\p{N}])/u', $t) === 1;
}

// The customer has an order to talk about: the word, an SP number, or the
// first-person verb ("I paid for the jacket", «اشتريت»).
function assistant_order_context(string $t, string $text): bool
{
    return assistant_order_word($t) || assistant_find_track($text) !== null
        || assistant_has($t, ['i paid for', 'i bought', 'i ordered', 'i purchased', 'i placed', 'دفعت', 'اشتريت', 'طلبت']);
}

// The CLAUSE a position sits in, up to that position: the text after the last
// comma, full stop, "and", "but", "so", "then", "because", "please", "never mind", «لكن», «بس». A negation
// belongs to the clause it is in — "I didn't pay, cancel my order" and "the site is
// not working, please cancel my order" cancel an order; the "didn't" and the "not"
// are about something else. The word «ما» that belongs to an ability verb («ما اقدر
// الغي طلبي», "I cannot cancel") is a wish that is failing, not a refusal, so it is
// taken out first. Byte offsets in, because preg_match(PREG_OFFSET_CAPTURE) gives bytes.
function assistant_clause_before(string $t, int $byteOffset): string
{
    $head = substr($t, 0, $byteOffset);
    $head = preg_replace('/(?<![\p{L}\p{N}])ما\s+(?:اقدر|يمديني|يمدي|قدرت|اعرف|ينفع|لقيت|ادري|عرفت|زبط)(?![\p{L}\p{N}])/u', ' ', $head) ?? $head;
    $parts = preg_split('/[,،;:.!?؟]+|(?<![\p{L}\p{N}])(?:and|but|so|then|because|please|pls|plz|kindly|never\s*mind|nevermind|forget\s+(?:it|that)|لكن|بس|لو سمحت|عفوا|خلاص)(?![\p{L}\p{N}])/u', $head);
    return $parts ? (string) end($parts) : $head;
}

// The words just BEFORE a position, up to three, in its clause — what a
// negation sits in. Split on spaces only: "don't" must stay one word.
//
// PUNCTUATION IS STRIPPED BY UNICODE CLASS, NOT BY BYTE. This used trim($x, ",.;:!?؟،()…")
// and PHP's trim() reads that list as BYTES: «؟» and «،» both begin with 0xD8, which
// is also the first byte of ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ — so every Arabic
// word starting with one of them lost its first byte («تم» came back as three
// invalid bytes) and every comparison against an Arabic word was false.
function assistant_words_before(string $t, int $byteOffset, int $n = 3): array
{
    $w = preg_split('/\s+/u', assistant_clause_before($t, $byteOffset), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $w = array_map(fn ($x) => preg_replace('/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/u', '', $x) ?? $x, $w);
    return array_slice(array_values(array_filter($w, fn ($x) => $x !== '')), -$n);
}

// CANCEL, AS A REQUEST. The cancel words used to be tested bare, so anything
// that contained one was a cancellation emailed to staff as such:
//   "please don't cancel my order", «لا تلغون طلبي»   (the opposite)
//   "why was my order cancelled", "SP… is it cancelled?"   (a question about a state)
//   "don't send me offers", "do not ship to Hawally, ship to Salmiya",
//   «لا تشحنون الحين انا مسافر»   (an opt-out, an address, a hold)
// — and a wrong CANCEL subject can drive a wrong cancel or do-not-ship on a
// paid order. Now:
//   * the verb or noun (cancel, cancellation, «الغي», «الغاء»…) is a request
//     unless a negation sits in the three words before it; a negated one is a
//     person's to read (contact), not a cancellation;
//   * "cancelled" is a STATE (order_status) unless it follows want / need /
//     have / get ("I want it cancelled");
//   * "don't send / don't ship" is a cancellation only beside an order word and
//     with no place or time in the sentence; otherwise it is a change to an
//     order, or an opt-out.
// Returns [intent, topic] or null.
function assistant_cancel_rule(string $t): ?array
{
    $neg = ['not', 'no', 'never', 'without', 'dont', "don't", 'didnt', "didn't", 'لا', 'ما', 'لم', 'لن', 'مو', 'مب'];
    $request = false;
    $negated = false;
    // English: base forms and nouns are requests; -ed is a state. The Arabizi «akansel»
    // ("I cancel") has a leading «a»/«ab» that "kansel" alone did not allow.
    if (preg_match_all('/(?<![a-z])((?:a|ab)?kansel[a-z]*|cancel[a-z]*|cancle[a-z]*)(?![a-z])/', $t, $m, PREG_OFFSET_CAPTURE)) {
        foreach ($m[1] as [$word, $at]) {
            $clause = assistant_clause_before($t, $at);
            $isNeg = (bool) array_intersect(assistant_words_before($t, $at), $neg)
                // "I did not ASK you to cancel it", "I never told you to": the negation is on the
                // asking, and what follows is the shop's act, not a wish.
                || preg_match('/(?<![a-z])(?:did\s*not|didn\'?t|never|do\s*not|don\'?t)\s+(?:ask|asked|tell|told|request|requested|authori[sz]e|authori[sz]ed|want)(?:\s+\w+){0,2}\s*$/', $clause) === 1;
            // THE SHOP IS THE ONE WHO CANCELLED: "why did you cancel my order", "did you cancel
            // it", "who cancelled it". A question about a state, answered with the order's own
            // stage (the order-status words below).
            if (preg_match('/(?:^|[^a-z])(?:did|didn\'?t|why\s+did|why\s+would|how\s+come|have|has)\s+(?:you|they|sporta|the\s+shop|the\s+store|anyone|someone)(?:\s+guys)?(?:\s+(?:just|really|actually|already))?\s*$|(?:^|[^a-z])who\s*$/', $clause) === 1) {
                continue;
            }
            if (preg_match('/(?:ed|d)$/', $word)) {
                // A state, unless the customer is ASKING for it. The ask-verb must be ATTACHED to
                // the verb — "I want my order cancelled", "get it cancelled", "have SP… cancelled" —
                // not merely somewhere earlier in the sentence: "please tell me why my order was
                // cancelled", "I need to know if it was cancelled" and "have you cancelled my
                // order" are questions about what the shop did.
                $ask = preg_match('/(?<![a-z])(?:want|need|like|wish|get|make|have|had)\s+(?:(?:my|the|this|that|our|it|them|these|those|order|orders|parcel|purchase|please|sp[a-z0-9]{6,})\s+){1,3}(?:to\s+be\s+|be\s+)?$/', $clause . ' ') === 1;
                if (!$ask) continue;
            }
            if ($isNeg) $negated = true; else $request = true;
        }
    }
    // Arabizi: «abi alghi talabi», «bgait algi el talab» — the cancel verb next to «talab».
    if (preg_match('/(?<![a-z0-9])a?l(?:gh?|8)i(?![a-z])/', $t) === 1 && assistant_has($t, ['talab', 'talabi', 'talabe'])
        && !assistant_has($t, ['dont', "don't", 'la ', 'ma '])) {
        $request = true;
    }
    // Arabic: a verb of cancelling or «الغاء», negated by لا / ما / لم before it.
    if (preg_match_all('/(?:(?<![\p{L}\p{N}])[وف]?(?:الغ(?:ي|و)|لغيت|تلغ(?:ي|و)|نلغ(?:ي|و)|يلغ(?:ي|و))|الغاء|كنسل)/u', $t, $m, PREG_OFFSET_CAPTURE)) {
        foreach ($m[0] as [$word, $at]) {
            $before = assistant_words_before($t, $at);
            // «تم الغاء طلبي» says it HAS been cancelled — a state.
            if (in_array('تم', $before, true) && str_contains($word, 'الغاء')) continue;
            // The whole word the match is the start of. «الغيتوا / الغيتو / لغيتوا» is "you
            // cancelled" (past, plural), «الغيت» "I cancelled": a state, not an order to cancel.
            $token = preg_match('/\G\p{L}+/u', $t, $tk, 0, $at) === 1 ? $tk[0] : $word;
            if (preg_match('/^[وف]?ا?لغيت/u', $token) === 1) continue;
            // «مين الغى طلبي», «ليش الغيتو»: who / why cancelled — the shop's act.
            // (Not «ليش ما اقدر الغي طلبي», where the ability «ما» is what is being asked about.)
            $raw = substr($t, 0, $at);
            if (preg_match('/(?<![\p{L}\p{N}])(?:ليش|ليه|لماذا|مين|منو)\s+(?:\p{L}+\s+)?$/u', $raw) === 1
                && preg_match('/(?<![\p{L}\p{N}])ما\s+(?:اقدر|يمديني|يمدي|قدرت|اعرف|ينفع|لقيت|ادري|عرفت|زبط)/u', $raw) !== 1) {
                continue;
            }
            if (array_intersect($before, $neg)) $negated = true; else $request = true;
        }
    }
    if (assistant_has($t, ['الغ الطلب', 'ما ابي الطلب', 'ما ابي طلبي', 'ما ابغي الطلب', 'ما ابغي طلبي', 'مابي الطلب', 'مابي طلبي',
                           'مابغي الطلب', 'مابغي طلبي', 'بطل الطلب', 'اوقف الطلب',
                           "don't want the order", 'dont want the order', "don't want my order", 'dont want my order',
                           'do not want the order', 'do not want my order', 'no longer want', 'stop my order', 'stop the order'])) {
        $request = true;
    }
    // «الغاء الاشتراك» / "cancel my subscription to the newsletter" is leaving a mailing list, not
    // cancelling an order: a privacy request (assistant_privacy_request), unless an order is named.
    if ($request && !assistant_order_word($t) && assistant_find_track($t) === null
        && assistant_has($t, ['الاشتراك', 'اشتراكي', 'النشره', 'القائمه البريديه', 'newsletter', 'subscription', 'mailing list'])) {
        return ['contact', 'privacy_request'];
    }
    if ($request) return ['cancel', null];
    if ($negated) return ['contact', null];

    // "Don't send / don't ship": see the note above.
    if (assistant_has($t, ["don't send", 'do not send', 'dont send', "don't ship", 'do not ship', 'dont ship', "don't deliver",
                           'do not deliver', 'dont deliver', 'لا ترسلون', 'لا ترسلو', 'لا تشحنون', 'لا تشحنو', 'لا تطرشون',
                           'لا تطرشو', 'لا توصلون', 'لا توصلو', 'ما ترسلون'])) {
        if (assistant_has($t, ['offers', 'offer', 'promo', 'promos', 'promotions', 'promotional', 'newsletter', 'messages',
                               'message', 'sms', 'texts', 'emails', 'email', 'notifications', 'ads', 'marketing',
                               'عروض', 'رسايل', 'رسائل', 'ترويج', 'اعلانات', 'ايميلات', 'ايميل', 'نشره'])) {
            return ['contact', null];
        }
        $placeOrTime = assistant_has($t, ['address', 'instead', 'different', 'another', 'to', 'at', 'after', 'before', 'until',
                                          'later', 'tomorrow', 'now', 'morning', 'evening', 'night', 'travel*', 'traveling',
                                          'away', 'holiday', 'vacation', 'عنوان', 'بدل', 'الحين', 'مسافر', 'سفر',
                                          'بعدين', 'بكره', 'بعد', 'قبل', 'الصبح', 'المسا', 'العصر', 'الليل', 'لين']);
        if (assistant_order_word($t) && !$placeOrTime) return ['cancel', null];
        return ['contact', 'order_change'];
    }
    return null;
}

// AN ORDER TO TAKE BACK, said the way people say it. «احذف طلبي», "remove my
// order", "I ordered twice by mistake", «الطلب مكرر», "I changed my mind about
// my order" had no cancel word, so with the number they got the order's stage
// and without it «ما لقيت شي». Tested AFTER the money rule: "I ordered twice and
// was charged twice" is a payment problem, not a cancellation. Only beside an
// order (the word, a number, "I ordered").
function assistant_cancel_extra(string $t, string $text): bool
{
    if (!assistant_order_context($t, $text)) return false;
    // Remove / delete / undo … the order. A few filler words allowed between, never
    // "item", "size" or "from": "remove an item from my order" is a change.
    if (preg_match('/(?<![a-z])(?:delete|remove|undo|drop|scrap|void|withdraw|revoke|discard)(?![a-z])\s+(?:(?:my|the|this|that|a|an|whole|entire|complete|last|previous|second|duplicate|duplicated|extra|double|same|first|new|other|please)\s+){0,3}(?:orders?|purchases?)(?![a-z])/', $t) === 1
        || assistant_has($t, ['احذف الطلب', 'احذف طلبي', 'احذفو الطلب', 'امسح الطلب', 'امسح طلبي', 'شيل الطلب', 'شيل طلبي',
                              'ازل الطلب', 'ازيلو الطلب'])) {
        return true;
    }
    $mistake = assistant_has($t, ['by mistake', 'by accident', 'mistakenly', 'accidentally', 'بالغلط', 'بغلط', 'عن غير قصد']);
    $past = assistant_has($t, ['before', 'previously', 'last time', 'last month', 'last year', 'always', 'usually', 'often',
                               'every time', 'من قبل', 'دايم', 'كل مره']);
    $asking = preg_match('/^(?:can|could|do|does|is|are|will|would|how|should|هل|كيف)\s/u', $t) === 1;
    if ($past || ($asking && !$mistake)) return false;
    // SOMEONE CHASING AN ORDER IS NOT UNDOING ONE. "where is my second order", "SP… status",
    // «وين طلبي» are tracking questions whatever else they say, unless a mistake is owned to.
    $tracking = assistant_has($t, ['where', 'when', 'status', 'track*', 'arrive', 'arrived', 'arrives', 'shipped', 'deliver*',
                                   'وين', 'متى', 'حاله', 'وصل', 'وصلت', 'يوصل', 'توصل']);
    // THE ONLY SIGNS OF A DUPLICATE MADE BY MISTAKE are a word that says so (duplicate, by mistake,
    // «مكرر», «بالغلط») or the same order placed twice. Not "again", not "second", not "extra", not
    // "two orders", not a bare "twice": those are a repeat customer ("I will order again"), a
    // customer with two orders ("my second order has not arrived", «طلبين») or a delivery fee
    // ("do I pay delivery twice") — and each was emailed to staff as "customer asked to CANCEL
    // an order". The word that matters is the one that says it was not meant.
    $sameOrderTwice = preg_match('/(?<![a-z])(?:placed|submitted|made|sent|ordered|put\s+in)\s+(?:the|my|this|that|same|it)\s+(?:same\s+)?(?:order|purchase|thing|one|it)?\s*(?:twice|two\s+times|2\s+times)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:order|purchase)\s+(?:was|got|is|has\s+been)\s+(?:placed|made|submitted|sent|ordered)\s+(?:twice|two\s+times|2\s+times)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])ordered\s+it\s+(?:twice|two\s+times|2\s+times)(?![a-z])/', $t) === 1
        || preg_match('/(?:طلبت|سويت|عملت|ارسلت|كررت)\s+(?:نفس\s+)?(?:ال)?(?:طلب|طلبيه|الطلبيه)\s+(?:مرتين|مرتان)/u', $t) === 1;
    if ($tracking && !$mistake && assistant_find_track($text) !== null && !$sameOrderTwice) return false;
    return ($sameOrderTwice && (!$tracking || $mistake))
        || preg_match('/(?<![a-z])(?:duplicate|duplicated|dupe)\s+(?:orders?|purchases?)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])double[d]?\s+(?:order|purchase)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:is|was)\s+the\s+(?:duplicate|dupe)(?![a-z])/', $t) === 1
        || ($mistake && preg_match('/(?<![a-z])(?:ordered|order|placed|purchase|bought)(?![a-z])/', $t) === 1)
        || assistant_has($t, ['changed my mind', 'change of mind', 'changed my decision'])
        || assistant_has($t, ['مكرر', 'كررت الطلب', 'غيرت رايي', 'غيرت فكرتي'])
        || ($mistake && assistant_has($t, ['طلبت', 'الطلب', 'طلبي']))
        || (assistant_has($t, ['ما ابيه', 'ما ابغاه', 'ما ابغيه']) && assistant_order_word($t));
}

// "I CHANGED MY MIND", AND NOTHING ELSE. assistant_cancel_extra rightly needs an
// order beside it (a change of mind about a colour is not a cancellation), so the
// bare «غيرت رايي», «بدلت رايي», "I changed my mind" — with at most an "ok", a
// "sorry" or a «خلاص» around it — fell to search and was told «ما لقيت شي يطابق
// كلامك». As the WHOLE message it is a customer with something to undo and
// nothing said about what: a person reads it (contact, no topic — not a CANCEL
// subject, which drove a wrong cancel once already), and the contact line gives
// them the way to say which order. Anything more in the sentence — a colour, a
// size, an order — keeps its own rule.
function assistant_change_of_mind_alone(string $t): bool
{
    $lead = '(?:(?:ok|okay|no|sorry|actually|hmm|hm|wait|hi|hello|hey|please|pls|plz|well|um|uh|so|oh|خلاص|لا|اسف|اسفه|طيب|تمام|انا|والله|بس|عفوا|لو سمحت|لو سمحتو|اوكي)[\s\p{P}]*)*';
    $tail = '(?:[\s\p{P}]*(?:please|pls|plz|sorry|thanks|thank you|now|خلاص|لو سمحت|لو سمحتو|الله يخليك|شكرا|اسف|اسفه|الحين))*[\s\p{P}]*';
    return preg_match('/^' . $lead . '(?:i(?:\'ve|\'d| have| had)?\s+)?(?:changed|change)\s+(?:my|our)\s+mind' . $tail . '$/u', $t) === 1
        || preg_match('/^' . $lead . '(?:غيرت|بدلت)\s+(?:رايي|فكرتي|رايينا|فكرتنا)' . $tail . '$/u', $t) === 1;
}

// WITHDRAWING CONSENT OR ASKING FOR ONE'S DATA — to stop messages, be taken off a list, have an account
// or a number deleted, or to know what the shop holds and whom it is shared with. The shop messages its
// customers (order updates, a birthday email), and src/pages/Privacy.jsx tells them to ask on WhatsApp or by
// email; the assistant used to answer these as a failed product search. A person's job, with its own line
// (privacy_request) that says where to write. "Delete my order" is not here: it is a cancellation, and its
// rule runs first.
function assistant_privacy_request(string $t): bool
{
    // An ORDER being removed or stopped is cancel's; "remove an item from my order" is a change to one.
    if (assistant_has($t, ['my order', 'the order', 'an item', 'order number', 'tracking number', 'طلبي', 'الطلب'])
        && !assistant_has($t, ['my data', 'my details', 'my information', 'my account', 'my number', 'my email', 'personal', 'بياناتي', 'حسابي', 'رقمي'])) {
        return false;
    }
    return assistant_has($t, ['unsubscribe', 'un-subscribe', 'unsubscribed', 'opt out', 'opt-out', 'optout', 'opting out',
                              'stop sending me', 'stop emailing me', 'stop texting me', 'stop messaging me', 'stop calling me',
                              'stop contacting me', 'stop whatsapping me', 'stop the messages', 'stop the emails', 'stop the texts',
                              'stop your messages', 'stop your emails', 'stop your texts', 'no more messages', 'no more emails',
                              'no more texts', 'remove me from', 'take me off', 'take me out of', 'remove my number', 'remove my email',
                              'remove my phone', 'remove my details', 'remove my data', 'remove my information', 'remove my name',
                              'delete my account', 'delete my data', 'delete my details', 'delete my information', 'delete my personal',
                              'delete my number', 'delete my email', 'delete my phone', 'delete my name', 'erase my', 'erase all my',
                              'close my account', 'deactivate my account', 'privacy', 'personal data', 'personal information',
                              'what data', 'what information do you', 'what details do you', 'data do you keep', 'data do you hold',
                              'information do you keep', 'information do you hold', 'do you share my', 'do you sell my', 'gdpr',
                              'right to be forgotten',
                              'وقفوا الرسايل', 'وقفو الرسايل', 'وقف الرسايل', 'وقفوا الرسائل', 'وقفو الرسائل', 'وقف الرسائل',
                              'وقفوا الايميلات', 'وقفوا الاعلانات', 'ما ابي رسايل', 'ما ابغي رسايل', 'ما ابي رسائل', 'ما ابغي رسائل',
                              'ما ابي اعلانات', 'ما ابي ايميلات', 'ما ابي اشعارات', 'مابي رسايل', 'مابي رسائل', 'احذفوا رقمي', 'احذفو رقمي',
                              'احذف رقمي', 'امسحوا رقمي', 'امسح رقمي', 'شيلوا رقمي', 'شيل رقمي', 'احذف حسابي', 'احذفوا حسابي',
                              'امسح حسابي', 'امسحوا حسابي', 'الغاء حسابي', 'احذف بياناتي', 'احذفوا بياناتي', 'امسح بياناتي',
                              'امسحوا بياناتي', 'احذف ايميلي', 'احذفوا ايميلي', 'الغاء الاشتراك', 'الغاء اشتراكي', 'خصوصيه',
                              'سياسه الخصوصيه', 'بياناتي', 'معلوماتي الشخصيه', 'شنو البيانات', 'وش البيانات', 'ايش البيانات']);
}

// A PERSON ASKED FOR BY NAME, tested before the topic rules. "I want to talk to
// a human about my order" named the order, so it was asked for the order number;
// "speak to a manager about my return" got the returns policy; "customer
// support", "representative", «المدير», «في احد يرد؟» got «ما لقيت شي». A
// person-word beside a talk-word, or a person-word on its own as the whole
// message. «ankle support leggings» has no talk-word and is a product.
function assistant_person_request(string $t): bool
{
    // The message with its courtesies taken off, to see whether it is ONLY a person-word.
    $bare = ' ' . preg_replace('/[\p{P}\p{S}]+/u', ' ', $t) . ' ';
    foreach (['please', 'pls', 'plz', 'hi', 'hello', 'hey', 'i need', 'i want', 'need', 'want', 'a', 'an', 'the', 'ابي', 'ابغى',
              'ودي', 'ممكن', 'لو سمحت', 'احتاج'] as $filler) {
        $bare = preg_replace('/(?<![\p{L}\p{N}])' . preg_quote($filler, '/') . '(?![\p{L}\p{N}])/u', ' ', $bare) ?? $bare;
    }
    $bare = trim(preg_replace('/\s+/u', ' ', $bare) ?? $bare);
    if (in_array($bare, ['support', 'customer support', 'customer service', 'customer care', 'live support', 'tech support',
                         'help desk', 'helpdesk', 'representative', 'rep', 'agent', 'live agent', 'live chat', 'livechat',
                         'operator', 'manager', 'supervisor', 'human', 'real person', 'person', 'staff', 'someone', 'somebody',
                         'الدعم', 'الدعم الفني', 'دعم فني', 'دعم', 'خدمه العملاء', 'المدير', 'مدير', 'المسوول', 'مسوول', 'موظف',
                         'موظفين', 'انسان', 'شخص', 'ممثل', 'ادمن', 'مشرف', 'المشرف'], true)) {
        return true;
    }
    $person = assistant_has($t, ['human', 'a person', 'real person', 'agent', 'representative', 'manager', 'supervisor',
                                 'operator', 'staff', 'employee', 'team member', 'customer service', 'customer support',
                                 'customer care', 'someone', 'somebody', 'anyone', 'anybody', 'ahad', 'a7ad', 'موظف', 'موظفه', 'انسان',
                                 'شخص', 'مدير', 'المدير', 'مسوول', 'المسوول', 'ممثل', 'خدمه العملاء', 'الدعم', 'احد', 'ادمن',
                                 'مشرف']);
    $talk = assistant_has($t, ['talk to', 'talk with', 'speak to', 'speak with', 'chat with', 'connect me', 'transfer me',
                               'put me through', 'put me on', 'get me', 'let me talk', 'let me speak', 'need to talk',
                               'need to speak', 'want to talk', 'want to speak', 'would like to speak', 'would like to talk',
                               'call me', 'can i talk', 'can i speak', 'could i speak', 'could i talk', 'اكلم', 'اتكلم', 'اتواصل', 'كلم', 'كلموني', 'كلمني', 'حولني', 'وصلني',
                               'akalem', 'akalim', 'a7ki', 'ahki']);
    // «someone/anyone» are in everyday sentences ("anyone know if…"), so they count
    // only with a talk-word, like every other person-word: the pair is the rule.
    if ($person && $talk) return true;
    // "I need a human", "I want an agent", "get me a manager": the person-word DIRECTLY after the want. "need a" /
    // "want a" used to be talk-words, so "I want a gift for someone", "I need a jacket for my manager" and "a uniform
    // for my staff" — a shopper buying FOR someone — were read as asking for a person. With "for" after it, or a
    // garment between, it is a purchase.
    if (preg_match('/(?<![a-z])(?:need|want|get\s+me|give\s+me|find\s+me)\s+(?:a|an|the|your)\s+(?:real\s+|live\s+|human\s+)?(?:human|person|agent|representative|rep|manager|supervisor|operator|member\s+of\s+staff|staff\s+member|team\s+member|employee|customer\s+(?:service|support|care))(?![a-z])(?=\s*$|\s*[.,!?]|\s+(?:please|pls|plz|now|asap|to|who|that|about|regarding|with|on|in|from|and|or|thanks|thank)(?![a-z]))/', $t) === 1) return true;
    // «في احد يرد؟», «احد يساعدني», "is anyone available to help": asking whether a person is there.
    return assistant_has($t, ['احد يرد', 'حد يرد', 'احد يساعد', 'حد يساعد', 'احد يجاوب', 'حد يجاوب', 'احد يكلمني', 'احد يتواصل',
                              'someone to help', 'anyone to help', 'someone who can help', 'ahad yrod', 'ahad yrid']);
}

// CHANGING AN ORDER that exists: the address, the phone number, the size, the
// colour, the name, when it comes, where it goes. A person's job — the order
// may not have left yet — and it was answered with the location line («Sporta
// is an online shop — there is no branch to visit»), the delivery timetable,
// the returns policy or «send me your order number». Address, phone, name and
// place need no order word ("update my address"); size, colour and item need
// one ("change the size on my order"), because without it «اغير المقاس» is an
// exchange and the returns policy is the answer.
function assistant_order_change(string $t, string $text): bool
{
    $change = '(?:change|changing|update|updating|edit|editing|modify|correct|fix|amend|replace|alter|switch)';
    // The things that need no order beside them.
    if (preg_match('/(?<![a-z])' . $change . '(?![a-z])[^.?!]{0,30}(?<![a-z])(?:address|phone|mobile|telephone|email|location|delivery time|delivery date|delivery area|house|building|block|street|flat|apartment)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:wrong|incorrect)\s+(?:delivery\s+)?address(?![a-z])/', $t) === 1
        || assistant_has($t, ['wrong address', 'change address', 'change my address', 'change the address',
                              'اغير العنوان', 'تغيير العنوان', 'العنوان غلط', 'عنوان غلط', 'غيرت العنوان',
                              'اعدل العنوان', 'تعديل العنوان', 'اغير عنواني', 'تغيير عنواني', 'اعدل عنواني',
                              'غيرت عنواني', 'عنواني غلط', 'اغير رقم الجوال', 'اغير رقم الهاتف', 'اغير رقمي', 'تغيير رقم الجوال',
                              'تغيير رقم الهاتف', 'تعديل رقم الجوال', 'اعدل رقم الجوال', 'عنوان ثاني', 'عنوان اخر',
                              'عنوان جديد', 'عنوان مختلف', 'مكان ثاني',
                              // ROUND FIVE: the same thing said as a predicate — «غلطت في العنوان», «رقم الجوال غلط»,
                              // «عنواني تغير», «انتقلت لبيت جديد» — which the noun-first phrases above never matched.
                              'غلطت في العنوان', 'غلطت بالعنوان', 'غلطت في رقم', 'غلطت بالرقم', 'غلطت في الرقم', 'رقم الجوال غلط',
                              'رقم الهاتف غلط', 'رقم التلفون غلط', 'رقمي غلط', 'عنواني تغير', 'عنواني تغيير', 'تغير عنواني',
                              'تغير رقمي', 'تغير رقم الجوال', 'انتقلت لعنوان', 'انتقلت الى عنوان', 'انتقلت لبيت', 'انتقلت الى بيت',
                              'انتقلت لمنطقه', 'عنواني الجديد'])) {
        return true;
    }
    // "my address is wrong", "the address is incorrect", "the phone number on my order is wrong", "I made a mistake in
    // the address", "I have a new address", "wrong phone number on my order". The order number and the tracking number
    // are not in the list: «the order number is wrong» is not a change to an order.
    $subj = '(?:address|location|(?:phone|mobile|telephone|contact)\s+number|email|e-mail)';
    $bad  = '(?:wrong|incorrect|not\s+correct|not\s+right|mistaken|a\s+mistake|a\s+typo|typo|new|different|changed|outdated|old)';
    if (preg_match('/(?<![a-z])' . $subj . '(?:\s+(?:on|in|for)\s+(?:my|the)\s+(?:order|parcel|delivery))?\s+(?:is|was|are|has\s+been|had|seems|looks)\s+(?:\w+\s+)?' . $bad . '(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:mistake|typo|error)\s+(?:in|with|on)\s+(?:my|the)\s+(?:\w+\s+)?' . $subj . '(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:have|got|moved\s+to)\s+(?:a\s+)?new\s+' . $subj . '(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])my\s+new\s+' . $subj . '(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:wrong|incorrect)\s+(?:delivery\s+)?(?:phone|mobile|contact)\s+number(?![a-z])/', $t) === 1) {
        return true;
    }
    // To another place, said of the order that exists: "send it to a different
    // address", "send my order to my office instead". Not "can you ship to a
    // different country", which is the delivery question.
    $it = '(?:it|them|my\s+(?:order|parcel|package|items?)|the\s+(?:order|parcel|package))';
    if (preg_match('/(?<![a-z])(?:send|ship|deliver|forward|redirect|bring|route)\s+' . $it . '(?![a-z])[^.?!]{0,30}(?<![a-z])(?:to|at)(?![a-z])[^.?!]{0,30}(?<![a-z])(?:different|another|new|other|instead)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:send|ship|deliver|forward|redirect|bring)\s+' . $it . '(?![a-z])[^.?!]{0,40}(?<![a-z])instead(?![a-z])/', $t) === 1) {
        return true;
    }
    // A part of the order: with the order named.
    $parts = '(?:size|colour|color|item|items|product|piece|quantity|qty|number|name|phone|address)';
    $order = assistant_order_context($t, $text);
    if ($order && (preg_match('/(?<![a-z])' . $change . '(?![a-z])[^.?!]{0,40}(?<![a-z])' . $parts . '(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:change|update|edit|modify|amend|alter)\s+(?:my|the)\s+order(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])want\s+to\s+' . $change . '(?![a-z])/', $t) === 1)) {
        return true;
    }
    return $order && preg_match('/(?:اغير|تغيير|اعدل|تعديل|غيرت|اصحح|تصحيح|حدث)[^.?!؟]{0,30}(?:المقاس|اللون|الاسم|القطعه|الكميه|الرقم|الموقع|الايميل)/u', $t) === 1;
}

// NO ORDER NUMBER, said out loud. «نسيت رقم الطلب» and "I lost my order number"
// were asked for the number again, for ever. A person finds an order by the
// phone number on it.
function assistant_no_number(string $t): bool
{
    return assistant_has($t, ['order number', 'tracking number', 'tracking id', 'track id', 'tracking code', 'رقم الطلب',
                              'رقم التتبع', 'رقم طلبي', 'رقم الطلبيه', 'كود التتبع'])
        && assistant_has($t, ['lost', 'forgot', 'forgotten', 'dont have', "don't have", 'do not have', 'no order number',
                              'without', 'cant find', "can't find", 'cannot find', 'can not find', 'dont know', "don't know",
                              'do not know', 'dont remember', "don't remember", 'ما عندي', 'ما معي', 'نسيت', 'ضيعت', 'ضاع',
                              'ضاعت', 'ما لقيت', 'ما اعرف', 'ما اذكر', 'ما اتذكر', 'مو معي', 'مب معي', 'مسحت']);
}

// WHAT "IT DID NOT COME" SOUNDS LIKE, as a status question — read by the
// router (so a late order is still asked for its number), by assistant_answer
// (so the 24-hour promise is not made to someone who says it did not arrive)
// and by assistant_order (a DELIVERED order that "never arrived" is a dispute,
// not a return window).
function assistant_not_received_words(): array
{
    // (Answer-side only: as bare words in the ROUTER they would take "do you deliver late at night", "is it still not in
    // stock" and «للحين تبيعون هذا؟» for a tracking question.)
    return array_merge(assistant_late_words(), ['late', 'running late', 'not here', 'still not', 'ما استلمت', 'لم استلم', 'للحين']);
}

// A PARCEL THAT IS LATE OR HAS NOT COME, said any way — ONE list, read by the router (so each is a tracking question
// asked WITHOUT the 24-hour promise) and, through assistant_not_received_words, by assistant_answer. They used to be
// two lists that disagreed: "haven't arrived" was in one, "never came" and "delayed" in the other, and a customer whose
// parcel was days late was re-told the timetable (delivery rule) or «ما لقيت شي» (search). Phrases, not bare words: a
// bare "delay" or "late" is also "do you deliver late at night" and "will there be a delay".
function assistant_late_words(): array
{
    return ['did not arrive', "didn't arrive", 'never arrived', 'not arrived', "hasn't arrived", 'has not arrived',
            "haven't arrived", 'have not arrived', "hadn't arrived", 'not received', 'never received', "haven't received",
            'have not received', "hasn't come", 'has not come', "haven't come", 'have not come', "didn't come", 'did not come',
            'never came', 'not here yet', 'nothing arrived', 'nothing came', 'still waiting',
            'is delayed', 'are delayed', 'was delayed', 'got delayed', 'been delayed', 'order delayed', 'parcel delayed',
            'package delayed', 'delivery delayed', 'shipment delayed', 'delayed order', 'delayed parcel', 'delayed delivery',
            'ما وصل', 'ما وصلني', 'ما جاني', 'ما جات', 'ما جاتني', 'ما جانا', 'لم يصل', 'لم تصل', 'لم يصلني', 'مو واصل', 'موب واصل',
            'تاخر', 'متاخر', 'لم تصلني', 'لم تصلنا', 'ما وصلنا', 'متاخره', 'تاخرت'];
}

// A MESSAGE THAT SAYS A PARCEL IS LATE OR HAS NOT COME — the words (assistant_late_words) and the ways of counting days:
// "it has been a week and I have nothing", "delivery took 3 days", "3 days and no delivery", «صار لي ٥ ايام انتظر». Read by
// the router, and by assistant_answer so the 24-hour promise is not made to someone whose hours have already passed.
function assistant_is_late_talk(string $t): bool
{
    return assistant_has($t, assistant_late_words())
        // "It has been 5 days and nothing", «صار لي ٥ ايام انتظر».
        || (preg_match('/(?<![a-z])been\s+(?:\d+|a|one|two|three|four|five|six|seven|a\s+few|several)\s+(?:days?|weeks?)(?![a-z])/', $t) === 1
            && assistant_has($t, ['nothing', 'still', 'not', 'waiting', 'yet', "haven't", "hasn't", 'never']))
        // "delivery took 3 days", "3 days and no delivery", "waited 4 days": the promise has gone by.
        || preg_match('/(?<![a-z])(?:took|taking|waited|waiting)\s+(?:\w+\s+){0,2}\d+\s+(?:days?|weeks?)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z\d])\d+\s+(?:days?|weeks?)(?![a-z])\s*(?:and|but|now|already|later|,)?\s*(?:and\s+)?(?:no|nothing|still|not|without)(?![a-z])/', $t) === 1
        || (preg_match('/صار\s*لي\s*(?:\d+\s*)?(?:ايام|يوم|يومين|اسبوع|اسبوعين|اسابيع)/u', $t) === 1
            && assistant_has($t, ['انتظر', 'ما', 'لا', 'للحين', 'ولا']));
}

// A PARCEL THE CUSTOMER SAYS THEY NEVER GOT — a person's job, because the
// courier and the shop now disagree and money may be lost. Three ways in:
// "it says delivered but I never got it" (a delivered-word and a not-received
// word), a plain "I did not receive it" / «ما استلمت», and a parcel that is
// lost («الطلب ضايع»). Not a late order ("still waiting", «ما وصل»): that is a
// tracking question and keeps its old answer — the order's own stage decides
// whether it is a dispute (assistant_order).
function assistant_receipt_dispute(string $t): bool
{
    $negReceipt = assistant_has($t, ['not receive', 'did not receive', "didn't receive", 'never received', 'never got',
                                     'did not get', "didn't get", "haven't got", 'have not got', 'not got', 'got nothing',
                                     'received nothing', 'nothing arrived', 'nothing came', 'but i never', 'but i did not',
                                     'but nothing', 'not received', "haven't received", 'have not received',
                                     'ما استلمت', 'ما استلمنا', 'ما استلمته', 'لم استلم', 'لم نستلم', 'ما تسلمت', 'ما حصلت',
                                     'ما وصلني', 'ما وصل', 'ما جاني', 'ما جاتني', 'لم يصلني', 'لم يصل', 'ولا استلمت']);
    $delivered = assistant_has($t, ['delivered', 'تم التسليم', 'تم توصيل', 'تم التوصيل', 'واصل', 'سلمو', 'سلمتو', 'سلموني',
                                    'وصل الطلب', 'وصلكم الطلب', 'قالو وصل', 'يقولون وصل', 'يقول وصل', 'مكتوب وصل', 'تسليم']);
    if ($delivered && $negReceipt) return true;
    // "I did not receive …" is a parcel only when what was not received IS the
    // parcel: "I did not receive a confirmation email", «ما استلمت الرسالة» and «ما
    // استلمت المبلغ» are about something else.
    if (preg_match('/(?<![a-z])(?:did not|didn\'t|never)\s+(?:receive[d]?|get|got)\s+(?:my\s+|the\s+|any\s+|an?\s+)?(?:order|parcel|package|item|items|delivery|shipment|goods|products?|stuff|it|them)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:got|received)\s+nothing(?![a-z])|(?<![a-z])nothing\s+(?:arrived|came)(?![a-z])/', $t) === 1
        || (assistant_has($t, ['ما استلمت', 'لم استلم', 'ما استلمنا', 'ما تسلمت', 'لم نستلم'])
            && !assistant_has($t, ['المبلغ', 'الفلوس', 'فلوسي', 'رساله', 'الرساله', 'ايميل', 'الايميل', 'اتصال', 'مكالمه', 'كود',
                                   'رمز', 'تاكيد', 'فاتوره', 'اشعار', 'رد']))) {
        return true;
    }
    if (assistant_has($t, ['lost', 'got lost', 'ضايع', 'ضايعه', 'ضاع', 'ضاعت', 'مفقود', 'مفقوده'])
        && assistant_has($t, ['order', 'parcel', 'package', 'shipment', 'طلب', 'الطلب', 'طلبي', 'الشحنه', 'شحنتي',
                              'الطرد', 'الطلبيه'])
        && !assistant_has($t, ['number', 'confirmation', 'receipt', 'email', 'invoice', 'tracking', 'رقم', 'ايميل', 'فاتوره',
                               'تاكيد'])) {
        return true;
    }
    // "Never arrived, I want my money back": the parcel is gone AND the money is wanted.
    return assistant_has($t, ['never arrived', 'did not arrive', "didn't arrive", 'not arrived', "hasn't arrived",
                              'has not arrived', 'never came', 'did not come', "didn't come", 'ما وصل', 'ما وصلني', 'ما جاني',
                              'لم يصل', 'لم يصلني', 'ما جات', 'ما جاتني'])
        && assistant_has($t, ['money back', 'refund*', 'my money', 'فلوسي', 'فلوس', 'المبلغ', 'استرداد', 'ارجاع المبلغ']);
}

// A REFUND OR MONEY OWED, being waited for — not the returns policy. "Where is
// my refund", «ما رجعتو لي فلوسي», «كم يوم يرجع المبلغ» were answered with "start a
// return" (to someone who already returned the item), the 24-hour delivery
// timetable (by the bare «كم يوم») or «ما لقيت شي», and none reached a person.
// A noun for money coming back, and a word that says it has not (where, when,
// how long, still, yet, «متى», «وين», «ما رجع»). "Can I get a refund" is a
// POLICY question and keeps the returns answer.
function assistant_refund_status(string $t, ?string $text = null): bool
{
    if (assistant_has($t, ['can i get a refund', 'can i get my money back', 'can i have a refund', 'do you offer',
                           'do you give', 'do you do refunds', 'refund policy', 'how do i get a refund',
                           'how can i get a refund', 'how to get a refund', 'how do refunds work', 'is it possible',
                           'is it still possible', 'am i entitled', 'am i eligible', 'are refunds', 'is there a refund',
                           'do i get a refund', 'will i get a refund', 'what is your refund', 'what is the refund',
                           'where can i get a refund', 'where do i get a refund', 'where do i request', 'where can i request',
                           'هل ترجعون', 'هل تسترجعون', 'هل في استرجاع', 'هل يمكن', 'هل ممكن', 'سياسه'])) {
        return false;
    }
    // HOW LONG DOES A REFUND TAKE is the returns POLICY, asked by someone who has not returned anything: "how long does
    // a refund take", "how soon is the refund", "where does the refund go", "when will I get my refund IF I return it",
    // «اذا رجعت القطعة متى تنزل الفلوس». They were answered "Sorry for the wait… we will check on your refund" and a
    // refund-status email went to staff. A status is asked by someone who has the thing in hand: "my refund", "I
    // returned it", «ارجعت», an SP number. A hypothetical ("if I return", «لو رجعت», "after a return") is never one.
    if (assistant_has($t, ['if i return', 'if i send', 'if i sent', 'if i want to return', 'if i decide', 'if i cancel', 'after i return',
                           'after returning', 'after a return', 'after the return', 'after return', 'once i return', 'when i return',
                           'if you refund', 'if it is returned', 'if returned', 'بعد الارجاع', 'بعد الاسترجاع', 'بعد ما ارجع', 'بعد ما ارجعها',
                           'اذا رجعت', 'اذا ارجعت', 'لو رجعت', 'لو ارجعت', 'اذا استرجعت', 'لو استرجعت', 'اذا ارجع', 'لو ارجع'])) {
        return false;
    }
    $already = assistant_has($t, ['i returned', 'i have returned', "i've returned", 'i sent it back', 'i sent them back', 'i sent back',
                                  'i already returned', 'my refund', 'my return', 'my returned', 'i requested', 'i asked for a refund',
                                  'i submitted', 'i made a return', 'i have not received my', "i haven't received my", 'ارجعت', 'استرجعت',
                                  'رجعت القطعه', 'رجعت الطلب', 'طلبت استرجاع', 'طلبت الاسترجاع', 'طلبت استرداد', 'طلبي'])
        || ($text !== null && assistant_find_track($text) !== null);
    if (!$already && assistant_has($t, ['how long does', 'how long do', 'how long will', 'how long is the refund', 'how long is a refund',
                                        'how long for', 'how many days does', 'how many days do', 'how many days will', 'how many days for',
                                        'how soon is', 'how soon does', 'how soon do', 'how soon will', 'how fast', 'where does the refund',
                                        'where do refunds', 'where does a refund', 'كم ياخذ', 'كم تاخذ', 'كم يستغرق', 'كم تستغرق', 'وين تروح', 'وين يروح'])) {
        return false;
    }
    $noun = assistant_has($t, ['refund*', 'money back', 'reimburs*', 'استرداد', 'المسترد', 'مسترد', 'الاسترجاع حقي',
                               'استرجاعي', 'استرجاع المبلغ', 'استرجاع فلوس', 'استرجاع الفلوس']);
    $money = (assistant_has($t, ['المبلغ', 'الفلوس', 'فلوسي', 'فلوس', 'my money', 'the money', 'the amount'])
            && assistant_has($t, ['رجع', 'ترجع', 'يرجع', 'استرجع', 'تنزل', 'ينزل', 'تتحول', 'يتحول', 'تحول', 'back', 'returned',
                                  'refunded', 'credited']))
        // «وين فلوسي» / "where is my money": nothing else needed.
        || (assistant_has($t, ['فلوسي', 'my money']) && assistant_has($t, ['وين', 'متى', 'where', 'when']));
    if (!$noun && !$money) return false;
    return assistant_has($t, ['where', 'when', 'how long', 'how many days', 'how soon', 'how much longer', 'still', 'yet',
                              'waiting', 'not received', 'never received', "haven't received", 'have not received',
                              "didn't receive", 'did not receive', 'did not get', "didn't get", 'not got', 'never got',
                              'no refund', 'not refunded', 'been refunded', "hasn't been", 'has not been', 'status',
                              'update on', 'follow up', 'chasing', 'taking so long', 'taking long', 'did not come back',
                              "didn't come back", 'not come back', 'never came back', 'has not come back', "hasn't come back",
                              'not returned', 'never returned', 'متى', 'وين',
                              'كم يوم', 'كم بقي', 'للحين', 'لحد الحين', 'ما رجع', 'ما استلمت', 'لم استلم', 'لم يصل',
                              'لم ترجع', 'لم يرجع', 'ما وصل', 'ما جاني', 'انتظر', 'انتظار', 'ما نزل', 'ما تحول',
                              'ما انسترجع', 'ما استرجع']);
}

// A PAYMENT THAT WILL NOT GO THROUGH: "my card was declined", "I can't pay",
// "knet not working", "the payment page does not open", «رفض البطاقة»,
// «كي نت ما يفتح». They hit the payment-methods line, because the checkout rule
// needs a checkout word. The order cannot be completed, and WhatsApp can place
// it — checkout_problem. Not a hypothetical ("what if my card is declined?")
// and not a how-to.
function assistant_payment_trouble(string $t): bool
{
    if (assistant_has($t, ['if', 'what if', 'in case', 'what happens', '^اذا$', '^لو$', 'في حال', '^لنفرض', 'policy', 'سياسه'])) {
        return false;
    }
    // A gift card or a card holder is a thing to buy, not a way to pay.
    if (assistant_has($t, ['gift card', 'gift cards', 'giftcard', 'card holder', 'cardholder', 'بطاقه هديه', 'بطاقات هدايا'])) return false;
    if (assistant_has($t, ["can't pay", 'cant pay', 'cannot pay', 'can not pay', 'unable to pay', "couldn't pay", 'could not pay',
                           "won't let me pay", 'wont let me pay', 'not able to pay', 'ما اقدر ادفع', 'ما قدرت ادفع',
                           'ما يمديني ادفع', 'ما يخليني ادفع', 'ما اعرف ادفع', 'مو قادر ادفع',
                           // ROUND FIVE: «اكمل الدفع» ("complete the payment") and the MSA «تعذر».
                           'ما اقدر اكمل الدفع', 'ما قدرت اكمل الدفع', 'ما يمديني اكمل الدفع', 'ما اقدر اكمل الشراء',
                           'ما قدرت اكمل الشراء', 'تعذر الدفع', 'تعذر علي الدفع', 'تعذر اتمام الدفع', 'لا استطيع الدفع',
                           'لم استطع الدفع', 'unable to complete the payment', 'unable to complete payment',
                           "can't complete the payment", 'cannot complete the payment', "can't complete payment"])) {
        return true;
    }
    $pay = assistant_has($t, ['knet', 'k-net', 'كي نت', 'كينت', 'payment', 'payments', 'pay', 'paying', 'card', 'visa', 'mastercard',
                              'بطاق', 'فيزا', 'ماستر', 'الدفع', 'دفع', 'ادفع', 'tpay', 't-pay', 'تي باي', 'apple pay',
                              'ابل باي',
                              // ROUND FIVE: the Gulf word for a card is «كرت» (not «كرتون», a carton).
                              '^كرت$', '^كرتي$', '^الكرت$', '^بالكرت$', '^كرتك$', '^كرتكم$']);
    return $pay && assistant_has($t, ['declined', 'decline', 'rejected', 'refused', 'not working', "isn't working", 'is not working',
                                      "doesn't work", 'does not work', "didn't work", 'did not work', 'not opening', "won't open",
                                      "doesn't open", 'does not open', 'not open', 'not loading', "won't load", "doesn't load",
                                      'does not load', 'keeps failing', 'رفض', 'مرفوض', 'مرفوضه', 'ما يشتغل', 'ما اشتغل',
                                      'مو شغال', 'ما يفتح', 'ما فتح', 'ما تفتح', 'ما يحمل', 'ما يطلع', 'معطل', 'عطلان',
                                      // ROUND FIVE: «ما يمشي», «ما يقبل / ما قبل», «ما يمر», «واقف», «تعذر», and a card that
                                      // «ما يمر» — what a Gulf customer says of a payment that will not go through.
                                      'ما يمشي', 'ما مشى', 'ما مشي', 'ما يقبل', 'ما قبل الكرت', 'ما قبل البطاق', 'ما قبل الكي نت', 'ما قبل الفيزا', 'ما قبلت', 'ما تقبل', 'ما يمر', 'ما مر', 'ما تمر',
                                      'واقف', 'واقفه', 'تعذر', 'ما قدرت اكمل', 'ما اقدر اكمل', 'ما يكمل',
                                      'declining', 'gets declined', 'keeps declining', 'not going through', "isn't going through",
                                      'does not go through', "doesn't go through", 'will not go through', "won't go through"]);
}

// WHEN WILL IT BE BACK. A restock question names no garment ("when will you
// restock", "is XL coming back", «متى يتوفر مقاس XL») and found nothing, or the
// size guide. It cannot be answered from here, so it is a person's — with the
// item and the size. NOT when a garment is named: "when will the black leggings
// be back in stock" is shown the leggings, whose cards say what is in stock.
function assistant_restock_question(string $t, array $c): bool
{
    if ($c['type']) return false;
    // "I'll be back tomorrow" is a goodbye, not a restock question.
    if (preg_match("/(?<![a-z])(?:i|we)(?:'ll|'m going to|\\s+will|\\s+shall|\\s+am going to)\\s+(?:be|come)\\s+back/", $t) === 1) return false;
    // "COME BACK" / "BE BACK" MEAN STOCK ONLY NEXT TO STOCK. Bare, they took "the bank page did not come back to your
    // site", "will you come back to me about my complaint" and "the page will not come back" and emailed them to staff
    // as "customer asks when an item is back in stock". A size ("is XL coming back") or a stock word is what makes them one.
    $stockCtx = $c['size'] !== null || assistant_has($t, ['stock', 'available', 'availability', 'size', 'sizes', 'item', 'items',
                                                           'piece', 'pieces', 'product', 'products', 'collection', 'range', 'sold out',
                                                           'out of stock', 'again']);
    if ($stockCtx && assistant_has($t, ['coming back', 'come back', 'be back'])
        && !assistant_has($t, ['back to me', 'back to you', 'back to us', 'back to the site', 'back to your site', 'back to the website'])) {
        return true;
    }
    return assistant_has($t, ['restock*', 'back in stock', 'in stock again',
                              'available again', 'more stock', 'new stock', 'متى يتوفر', 'متى بيتوفر', 'متى تتوفر',
                              'متى يرجع', 'متى ترجع', 'متى تجيبون', 'متى تحصلون', 'تتوفر مره ثانيه', 'يتوفر مره ثانيه'])
        || preg_match('/(?<![a-z])when\s+(?:will|do|does|are|is)\b[^.?!]{0,40}(?<![a-z])(?:available|in stock|back(?!\s+(?:to|at|on)\b))(?![a-z])/', $t) === 1;
}

// The thank-you words, one list: the router tests it, and
// assistant_after_thanks takes the same words out to see what else was asked.
function assistant_thanks_words(): array
{
    return ['شكرا', 'مشكور', 'يعطيك العافيه', 'تسلم', 'ماقصرت', 'الله يعافيك', 'قصرت', 'العافيه', 'ثانكس', 'ثانكيو', 'يسلمك',
            'جزاك الله', 'يجزاك', 'shukran', 'shokran', 'mashkoor', 'thanks', 'thank you', 'thx', 'tnx', 'thnx', 'thanx',
            'appreciate it', 'cheers', 'thank u', 'thanku', 'ty', 'tysm'];
}

// What the message says AFTER the thanks words are taken out — so "do you have
// black leggings, thanks" can be seen to be a question. The same job
// assistant_after_greeting does for a hello.
function assistant_after_thanks(string $t): string
{
    static $res = null;
    if ($res === null) {
        $res = [];
        foreach (assistant_thanks_words() as $raw) {
            [$kind, $p] = assistant_needle($raw);
            if ($kind === 're') $res[] = $p;
            elseif ($kind === 'sub') $res[] = '/' . preg_quote($p, '/') . '/u';
        }
    }
    return trim(preg_replace($res, ' ', $t) ?? $t);
}

// Ordered, and the order is the policy: a message mentioning both an order
// number and delivery is a question about THAT order, so order_status is
// tested before delivery. The catch-all is last and admits ignorance rather
// than guessing.
//
// Returns [intent, topic]. The topic is null except for the kinds of `contact`
// that each get their own sentence and their own email subject — 'money'
// (paid and it went wrong), 'complaint' (a wrong or damaged item),
// 'coupon_problem' (a code that will not apply), 'checkout_problem' (an order
// that cannot be completed), 'site_problem' (the website itself) and 'courier'
// — and the two kinds of `thanks` that are not a thank-you ('bye', 'ack'). They
// are still `contact` and `thanks` to everything that reads the intent — the
// widget, the handoff, the tests that were written before the topic existed.
function assistant_route(string $text): array
{
    $t = assistant_normalise($text);

    // CANCELLING IS TESTED BEFORE EVERYTHING, INCLUDING THE ORDER NUMBER.
    // "ألغي طلبي SP1AU702NKHTKDV" carries a track ID, so it used to be read as
    // a tracking question and answered with a status report — the customer
    // asked to stop an order and was told, pleasantly, that it is being
    // prepared. Someone who says "cancel" while quoting the order number is
    // cancelling THAT order, so cancel wins over both branches below.
    //
    // WHAT COUNTS AS CANCELLING is assistant_cancel_rule's to decide: the verb
    // at the START of a word, never inside one («الغي» sits inside «للبالغين»,
    // "for adults"), the conjugations listed, and — round four — a NEGATION
    // before it ("don't cancel", «لا تلغون»), a STATE ("was it cancelled?") and
    // an opt-out or a change of address ("don't send me offers", "don't ship to
    // Hawally") are NOT a cancellation. They used to be, and each was emailed to
    // staff as "customer asked to CANCEL an order".
    $cancel = assistant_cancel_rule($t);
    if ($cancel !== null) return $cancel;

    // MONEY TAKEN WRONGLY IS A PERSON'S JOB (assistant_money_complaint), and it
    // outranks an order number and the returns words: "I was charged twice
    // for SP…, I want a refund" needs somebody to look at the payment, not the
    // status card or the 14-day policy.
    // (An unauthorised charge, fraud or a dispute is the same job: assistant_fraud.)
    if (assistant_money_complaint($t) || assistant_fraud($t)) return ['contact', 'money'];

    // "What does payment pending mean" is asked about an order: its number gets
    // its own stage (assistant_pending_meaning).
    if (assistant_pending_meaning($t)) return ['order_status', null];

    // AN ORDER TO TAKE BACK that has no cancel word in it: "remove my order",
    // "I ordered twice by mistake", «الطلب مكرر». After the money rule, so a
    // double charge is still a payment problem.
    if (assistant_cancel_extra($t, $text)) return ['cancel', null];

    // "I changed my mind", alone: a person's, with no CANCEL subject, because the
    // message names no order (assistant_change_of_mind_alone).
    if (assistant_change_of_mind_alone($t)) return ['contact', null];

    // LEAVING THE LIST, OR ASKING WHAT THE SHOP HOLDS. "unsubscribe me", "stop emailing me", "delete my
    // account", "what data do you keep" were searched, found nothing and logged as a gap that emails
    // nobody — while the Privacy page tells customers to ask the shop, and the shop does message them.
    // After the cancel rules, so "delete my order" is still a cancellation.
    if (assistant_privacy_request($t)) return ['contact', 'privacy_request'];

    // The courier asked for more, kept the change, never came, was rude
    // (assistant_courier_problem) — before delivery, which «المندوب» names.
    $courier = assistant_courier_problem($t);
    if ($courier !== null) return ['contact', $courier];

    // A PERSON, ASKED FOR BY NAME — before every topic rule. "I want to talk to a
    // human about my order" is not a request for the order number, and "speak to
    // a manager about my return" is not a request for the returns policy.
    if (assistant_person_request($t)) return ['contact', null];

    // A CODE THAT WILL NOT APPLY. «الكود ما اشتغل» and "my promo code is not
    // working" were told "if you have one, enter it at checkout" — which they
    // had just done — and the coupon line never reaches a person.
    if (assistant_has($t, ['code', 'codes', 'coupon*', 'voucher*', 'promocode', 'كود', 'الكود', 'كوبون', 'قسيمه'])
        && assistant_has($t, ['not working', 'isn\'t working', 'is not working', 'not work', "doesn't work",
                              'does not work', "didn't work", 'did not work', "won't work", 'wont work', 'invalid',
                              'expired', 'not valid', 'not accepted', 'rejected', 'not apply', "doesn't apply",
                              'not applying', 'not applied', "won't apply", "isn't applying",
                              'error', 'ما اشتغل', 'ما يشتغل', 'مو شغال', 'ما زبط', 'ما ضبط', 'ما يزبط', 'ما ينفع',
                              'منتهي', 'غلط', 'ما انقبل', 'ما ينقبل', 'مرفوض', 'خطا', 'ما طلع لي خصم', 'ما نزل الخصم',
                              'ما ينزل الخصم', 'ما خصم'])) {
        return ['contact', 'coupon_problem'];
    }

    // A PAYMENT THAT WILL NOT GO THROUGH — "my card was declined", "I can't pay",
    // "knet not working", «كي نت ما يفتح». Answered with the list of payment
    // methods before, to someone who had just tried them.
    if (assistant_payment_trouble($t)) return ['contact', 'checkout_problem'];

    // CHANGING AN ORDER — the address (said with «غلط», "the address is wrong",
    // so it is settled here, before the complaint words below read that «غلط» as
    // a wrong ITEM), the phone number, the size, the colour, where it goes, when.
    // A person's job; assistant_order_change has the words.
    if (assistant_order_change($t, $text)) return ['contact', 'order_change'];

    // A REFUND BEING WAITED FOR, and a parcel that never came. Before the
    // returns words and the order number: «وين فلوسي», "where is my refund" and
    // "SP… never arrived, I want my money back" are not the returns policy and
    // not a status look-up. The refund first — «لم أستلم المبلغ المسترد» says
    // "did not receive", and it is the money that did not come.
    if (assistant_refund_status($t, $text)) return ['contact', 'refund'];
    if (assistant_no_number($t)) return ['contact', 'no_number'];
    if (assistant_receipt_dispute($t)) return ['contact', 'not_received'];

    // What the message names as a product — read by the complaint, payment and
    // size rules below.
    $c = assistant_query($text);

    // AN ORDER THAT CANNOT BE COMPLETED. The checkout line ("complete your
    // order from your bag") was said to "checkout not working", «ما اقدر اكمل
    // الطلب» and "I cannot place the order, it gives an error" — the one step
    // that had just failed, with no number and nobody told. A checkout word
    // with a problem word is a person's job; so is ordering on WhatsApp, and a
    // size that is not there when the customer tries to buy, which the same
    // WhatsApp message solves. Before the complaint words, which read "the size
    // is missing" in "I want to place the order" as a missing ITEM.
    $checkoutWords = ['كمل الطلب', 'كمل طلبي', 'اكمل الطلب', 'اكمل طلبي', 'نكمل الطلب', 'اتمام الطلب', 'اتمم الطلب',
                      'اتمام الشراء', 'اكمل الشراء', '^اطلب$', 'اسوي طلب', 'checkout', 'check out', 'complete my order',
                      'complete the order', 'complete my purchase', 'complete the purchase', 'finish my order',
                      'place my order', 'place the order', 'place an order', 'place order', 'order on whatsapp',
                      'order through whatsapp', 'order by whatsapp', 'order via whatsapp'];
    $checkoutBad = ['not working', "isn't working", 'is not working', "doesn't work", 'does not work', 'error', 'fail*',
                    'stuck', 'crash*', "can't", 'cant', 'cannot', 'can not', "won't", 'unable', 'problem', 'issue',
                    'keeps', 'bug', 'freez*', 'loading', 'missing', 'not available', 'out of stock', 'sold out',
                    'whatsapp', 'ما اقدر', 'ما قدرت', 'ما يمديني', 'ما يمدي', 'ما يخليني', 'ما خلاني', '^خطا',
                    'ايرور', 'ما يشتغل', 'مو شغال', 'ما اشتغل', 'يعلق', '^علق', 'ما يفتح', 'مشكله', 'فشل',
                    'ما يرضي', 'مو موجود', 'مب موجود', 'غير موجود', 'مو متوفر', 'غير متوفر', 'عطلان', 'خربان', 'واتس'];
    // "Order failed" / «ما انعمل الطلب» with no money word is the same thing
    // (with one, it was a money complaint above).
    if ((assistant_has($t, $checkoutWords) && assistant_has($t, $checkoutBad)
         && !assistant_has($t, ["can't wait", 'cant wait', 'cannot wait']))
        || assistant_has($t, ["can't order", 'cant order', 'cannot order', 'unable to order', "can't place",
                              'cannot place', 'unable to place', "can't complete", 'cannot complete',
                              "won't let me order", "won't let me check", 'ما اقدر اطلب', 'ما قدرت اطلب',
                              'ما يمديني اطلب', 'order failed', 'order did not go through', "order didn't go through",
                              'الطلب فشل', 'فشل الطلب', 'ما انعمل الطلب', 'الطلب ما انعمل', 'ما تم الطلب', 'الطلب ما تم',
                              'الطلب ما يكمل', 'ما يكمل الطلب', 'الطلب ما يكتمل', 'ما يكتمل الطلب', 'ما اكتمل الطلب', 'الطلب ما اكتمل'])) {
        return ['contact', 'checkout_problem'];
    }

    // A WRONG OR DAMAGED ITEM IS A PERSON'S JOB TOO. "wrong item delivered" got
    // the 24-hour delivery line, «وصلني مقاس غلط» the size guide, and «القطعة
    // فيها عيب» «ما لقيت شي» — which n8n only logs. Tested before the order
    // number, delivery, sizes and returns, all of which those sentences touch.
    //
    // Not a hypothetical ("if it arrives damaged can I return it?", «اذا طلع
    // فيه عيب» — that is the returns question), and not the customer's own
    // slip ("I ordered the wrong size", «طلبت مقاس غلط» — that is an exchange).
    // A question about the POLICY ("how do you deal with damaged items") is
    // not a complaint about an order either.
    //
    // ONLY ABOUT SOMETHING THAT ARRIVED. The complaint line asks for the order
    // number and a photo, and staff get "WRONG OR DAMAGED ITEM received" — so
    // "the website is broken", "the photos are missing", "size M is missing"
    // and «المقاسات ناقصة؟» were all asked for a photo of a parcel that never
    // existed. The phrases that can only describe an item stand alone; the
    // rest («ناقص», "broken", "missing", «غلط»…) need something that arrived
    // beside them — a delivery word, the order, the piece — or, for physical
    // damage, the garment itself. "stain resistant", "do you cover damage" and
    // «انا غلطان» ("my bad") are not complaints at all.
    $hypothetical = assistant_has($t, ['if', 'what if', 'in case', 'how do you', 'what happens', 'policy',
                                       'what do you do', '^اذا$', '^لو$', '^لنفرض', 'في حال', 'سياسه']);
    // A WORRY BEFORE BUYING is not a complaint about something delivered: "how do I avoid ordering the wrong size", "I
    // am worried about getting the wrong size", "I always get the wrong size online", "make sure it doesn't arrive
    // damaged", "afraid the colour is different from the picture". They are the "do you have my size" family. Only
    // while nothing is said to have arrived (got / received / came / arrived / delivered / sent me).
    $worry = assistant_has($t, ['avoid', 'worried', 'worry', 'afraid', 'scared', 'nervous', 'concerned', 'anxious', "don't want",
                                'dont want', 'do not want', "i don't want", 'always get', 'always order', 'always buy', 'make sure',
                                'be sure', 'before ordering', 'before i order', 'before buying', 'before i buy', 'to avoid', 'prevent',
                                'ensure', 'خايف', 'خايفه', 'اخاف', 'ابي اتاكد', 'قبل اطلب', 'قبل ما اطلب', 'اتجنب'])
        && !assistant_has($t, ['arrived', 'received', 'got', 'came', 'delivered', 'sent me', 'وصلني', 'وصلت', 'استلمت', 'جاني', 'جاتني']);
    $ownSlip = assistant_has($t, ['i ordered the wrong', 'i chose the wrong', 'i picked the wrong', 'i bought the wrong',
                                  'ordered the wrong', 'my mistake', 'طلبت مقاس غلط', 'اخترت مقاس غلط', 'طلبت غلط',
                                  'اخترت غلط', 'غلطتي', 'طلبت لون غلط']);
    $notComplaint = assistant_has($t, ['do you cover', 'resistant', 'stainproof', 'waterproof', '^غلطان', '^غلطانه']);
    $itemOnly = ['wrong item', 'wrong order', 'wrong product', 'wrong size', 'wrong colour', 'wrong color', 'wrong one',
                 'wrong thing', 'not what i ordered', 'damaged', 'defect*', 'faulty', 'torn', 'ripped', 'stained',
                 'a stain', 'stain on', 'stains on', 'hole in', 'holes in', 'has a hole', 'have a hole', 'has holes',
                 'have holes', 'arrived dirty', 'came dirty', 'is dirty', 'are dirty', 'was dirty', 'smells',
                 'smell bad', 'bad smell', 'arrived used', 'looks used', 'already used', 'been used', 'worn already',
                 'already worn', 'been worn', 'second hand', 'not as pictured', 'not like the picture',
                 'not like the photo', 'different from the picture', 'different from the photo', 'not as shown',
                 'not as described', 'colour is different', 'color is different', 'is fake', 'are fake', 'a fake',
                 'looks fake', 'not original', 'counterfeit', 'something wrong with my order',
                 'something wrong with the item', 'different from what i ordered', 'different to what i ordered',
                 'different than what i ordered', 'not the same as what i ordered', 'differs from what i ordered', 'ملبوس من قبل', 'مو نفس الصوره', 'مب نفس الصوره', 'غير عن الصوره',
                 'مو مثل الصوره', 'مب مثل الصوره', 'يختلف عن الصوره', 'مختلف عن الصوره', 'غير الصوره', 'معيوب',
                 'مشقوق', '^انشق', 'مكسور', '^انكسر', 'تالف', 'ممزق', 'موب اللي طلبت', 'مو اللي طلبت',
                 'مب اللي طلبت', 'غير اللي طلبت', 'ما طلبته', 'فيه عيب', 'فيها عيب', 'لون غلط', 'مقاس غلط',
                 // ROUND FOUR: the same complaint in other words. MSA «خاطئ/خاطئة»
                 // ("wrong") was nowhere; «مختلفا عما طلبت» ("different from what I
                 // ordered"), «لا يطابق الصورة», «متضررة» ("damaged"); and faults
                 // that are not a wrong item but a bad one — a colour that faded,
                 // stitching that came apart, a fabric you can see through.
                 '^خاطي', 'عما طلبت', 'عما طلبته', 'عما اطلب', 'مختلف عن طلبي', 'مختلف عن اللي', 'لا يطابق', 'ما يطابق',
                 'لا تطابق', 'ما تطابق', 'غير مطابق', '^متضرر', 'color faded', 'colour faded', 'faded after', 'has faded',
                 'have faded', 'started fading', 'is fading', 'came apart', 'fell apart', 'coming apart', 'stitching came',
                 'stitching is', 'stitching has', 'stitching was', 'stitching fell', 'stitches came', 'stitches are',
                 'loose stitching', 'loose thread', 'loose threads', 'threads coming', 'are see through', 'is see through',
                 'are seethrough', 'is seethrough', 'are see-through', 'is see-through', 'became see through',
                 'become see through', 'went see through', 'turned see through', 'got see through', 'poor quality', 'bad quality', 'low quality', 'cheap quality',
                 'shrunk', 'shrank', 'peeling', 'pilling'];
    // Not a bare "used" or "worn": "what is this item used for", "can I return
    // worn items?" are questions; "arrived used", "already worn" are above.
    $needsArrival = ['broken', 'missing', 'stain', 'hole', 'holes', 'dirty', 'is wrong', 'was wrong',
                     'are wrong', 'damage', '^غلط', 'خربان', '^خرب', '^عيب', 'ناقص', 'مستعمل', 'ملبوس', '^وسخ', '^وصخ',
                     'ريحه', 'ريحته', 'مقلد', 'تقليد', 'مو اصلي', 'مب اصلي',
                     // "I ordered M but got L" / "received L instead of M": only about
                     // something that ARRIVED ("leggings instead of shorts" is a search).
                     'instead of', 'different colour', 'different color', 'different size', 'different one',
                     'different item', 'different product', 'different thing', 'not what i asked', 'not what i wanted',
                     'not the one i ordered', 'not the size', 'not the colour', 'not the color', '^خطا',
                     // ROUND FIVE: a box that was empty or had been opened, an order that is incomplete, and the Gulf «لون ثاني /
                     // مقاس ثاني» ("a different colour / size") and «قطعة وحدة بس» ("one piece only").
                     'empty', 'was opened', 'been opened', 'arrived opened', 'came opened', 'opened already', 'incomplete',
                     'not complete', 'not all of', 'لون ثاني', 'مقاس ثاني', 'لون مختلف', 'مقاس مختلف', 'لون غير', 'مقاس غير',
                     'وحده بس', 'واحده بس', 'ناقصني', 'ناقصه', 'مفتوح', 'مفتوحه', 'فاضي', 'فاضيه'];
    // A PART of the garment that is broken: "the zipper is broken", «الزبر خربان».
    // A question about the part ("does the zipper work", "a jacket with a zipper")
    // has no fault word and is not a complaint.
    $partFault = assistant_has($t, ['zipper', 'zip', 'zips', 'drawstring', 'velcro', 'elastic', 'waistband', 'seam', 'seams',
                                    'strap', 'straps', 'زبر', 'الزبر', 'سوسته', 'السوسته', 'زيب', 'الزيب',
                                    'سحاب'])
        && assistant_has($t, ['broken', 'stuck', 'jammed', 'not working', "doesn't work", 'does not work', 'came off', 'fell off',
                              'ripped', 'torn', 'snapped', 'split', 'خربان', '^خرب', 'مكسور', 'معطل', 'ما يشتغل', 'ما يسكر',
                              'ما يقفل', 'طاح', 'طايح', 'انقطع', 'تقطع', 'مقطوع', 'عالق']);
    // "I ordered M but got L": what was asked for, "but", what came.
    $mismatch = preg_match('/(?<![a-z])(?:ordered|asked for|wanted|chose|picked)(?![a-z])\s+(?:a\s+|an\s+|the\s+)?(?:size\s+)?\S+[^.?!]{0,40}(?<![a-z])but(?![a-z])\s+(?:i\s+|they\s+|you\s+)?(?:got|received|was sent|sent me|came|arrived|get|receive)(?![a-z])/', $t) === 1;
    $physical = ['broken', 'stain', 'hole', 'holes', 'dirty', 'torn', 'خربان', '^خرب', '^عيب', 'ناقص', 'مستعمل',
                 '^وسخ', '^وصخ', 'ريحه', 'ريحته'];
    $arrivedVerb = assistant_has($t, ['arrived', 'arrive', 'received', 'got', 'came', 'delivered', 'sent me', 'you sent',
                                      'وصل', 'وصلني', 'وصلت', 'وصلتني', 'استلمت', 'جاني', 'جاتني']);
    $arrived = $arrivedVerb || assistant_has($t, ['item', 'items', 'piece', 'parcel', 'package', 'box', 'my order', 'the order',
                                                  'in my order', 'القطعه', 'قطعه', 'الطلب', 'طلبي', 'الطلبيه', 'الشحنه',
                                                  'الكرتون']);
    // A QUESTION about the garment ("do the leggings have a hole for the
    // phone?", "is any item missing from the set?", «هل القطعة مستعملة؟») is
    // not a complaint unless something is said to have ARRIVED.
    $asking = preg_match('/^(?:do|does|is|are|can|could|will|would|should|هل)\s/u', $t) === 1;
    // ROUND FIVE: a parcel that came short, empty, opened or in the wrong colour or size, said the Gulf way («جاني لون
    // ثاني», «وصلني قطعة وحدة بس»). They need something that ARRIVED beside them, like every needsArrival word.
    $short = preg_match('/(?<![a-z])(?:only|just)\s+(?:one|1|two|2)\s+(?:\w+\s+){0,4}(?:arrived|came|received|delivered|was\s+sent|were\s+sent)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:received|got|arrived|came)\s+(?:\w+\s+){0,3}only\s+(?:one|1|two|2)(?![a-z])/', $t) === 1
        || preg_match('/(?<![a-z])(?:missing|short|not\s+all)\s+(?:\w+\s+){0,2}(?:items?|pieces?)(?![a-z])/', $t) === 1 && $arrivedVerb;
    if (!$hypothetical && !$worry && !$ownSlip && !$notComplaint && (!$asking || $arrivedVerb)
        && (assistant_has($t, $itemOnly) || $partFault || $mismatch || $short
            || (assistant_has($t, $needsArrival) && ($arrived || ($c['type'] && assistant_has($t, $physical)))))) {
        return ['contact', 'complaint'];
    }
    // ANGER, OR PLAIN DISSATISFACTION: "I am not satisfied", "this is unacceptable", "you are useless", «خدمتكم سيئة»,
    // «مو راضي», «نصابين», "is this a scam". No product, no order, no question the shop can answer — a customer who is
    // unhappy and is told to try another word for the item, or the size guide. A person, with the complaint line. Not
    // a hypothetical ("what if I am not satisfied", the satisfaction guarantee is a policy question).
    if (!$hypothetical && assistant_has($t, ['not satisfied', 'unsatisfied', 'dissatisfied', 'not happy with', 'unacceptable', 'useless',
                                             'disappointed', 'disappointing', 'ridiculous', 'fed up', 'terrible service', 'awful service',
                                             'horrible service', 'bad service', 'worst service', 'poor service', 'pathetic', 'scam',
                                             'scammers', 'rip off', 'ripoff', 'rip-off',
                                             'خدمتكم سيئه', 'خدمتكم زفت', 'خدمتكم ضعيفه', 'خدمه سيئه', 'خدمه زفت', 'خدمه ضعيفه', 'مو راضي',
                                             'مب راضي', 'غير راضي', 'ما رضيت', 'نصابين', 'نصاب', 'احتيال', 'حرامي', 'حراميه', 'زباله',
                                             'مخيبين', 'خيبتوا ظني', 'خيبه امل'])) {
        return ['contact', 'complaint'];
    }
    // A GARMENT THAT CAME AND DOES NOT FIT: "the jacket I received is too small"
    // was a search for jackets "in stock in that size". It is an exchange, and the
    // returns policy says how.
    if ($arrivedVerb && !$asking && !$hypothetical
        && assistant_has($t, ['too small', 'too big', 'too large', 'too tight', 'too loose', "doesn't fit", 'does not fit',
                              "didn't fit", 'did not fit', 'not fit', 'صغير علي', 'كبير علي', 'صغيره علي', 'كبيره علي',
                              'ما يناسب', 'ما ركب', 'ضيق علي', 'واسع علي',
                              // ROUND FIVE: «استلمت الجاكيت وهو صغير» — the size word with no «علي» after it.
                              '^صغير', '^كبير', '^ضيق', '^واسع', 'وهو صغير', 'وهو كبير', 'وهي صغيره', 'وهي كبيره', 'وهو ضيق', 'وهو واسع',
                              'طلع صغير', 'طلع كبير', 'طلعت صغيره', 'طلعت كبيره'])) {
        return ['returns', null];
    }

    // THE WEBSITE ITSELF. A page, a link, the app, a button, the log-in, the
    // photos — with something wrong with it — is a person's job, with its own
    // sentence (a screenshot helps, an order number may not exist). "I can't
    // find the leggings on the site" names a garment: that is a search.
    $site = assistant_has($t, ['website', 'site', 'page', 'link', 'app', 'button', 'login', 'log in', 'sign in',
                               'password', 'photo', 'photos', 'picture', 'pictures', 'image', 'images', 'add to bag',
                               'add to cart', 'الموقع', 'الصفحه', 'الرابط', 'اللينك', 'التطبيق', 'الابلكيشن', 'الزر',
                               'الزرار', 'تسجيل الدخول', 'كلمه السر', 'كلمه المرور', 'حسابي', 'الصور', 'السله']);
    if ($site && !($c['type'] && assistant_has($t, ["can't find", 'cannot find', 'ما لقيت', 'مو لاقي']))
        && assistant_has($t, ['broken', 'not working', "isn't working", 'is not working', "doesn't work",
                              'does not work', 'not loading', "won't load", 'not opening', "won't open", 'down',
                              'error', 'crash*', 'stuck', 'freez*', 'bug', 'glitch', 'missing', 'blank', "can't",
                              'cant', 'cannot', 'can not', 'unable', 'problem', 'issue', 'something wrong', 'keeps',
                              'خربان', '^خرب', 'ما يشتغل', 'مو شغال', 'ما يفتح', 'ما تفتح', 'ما فتح', 'يعلق', '^علق',
                              '^خطا', 'ايرور', 'مشكله', 'ما يحمل', 'ما تحمل', 'ما يطلع', 'ما تطلع', 'فشل', 'ما اقدر',
                              'ما قدرت', 'ما يمديني', 'ما يخليني', 'عطلان', 'واقف'])) {
        return ['contact', 'site_problem'];
    }

    // Goodbye, and "I will get back to you" — before the returns words, which
    // «ارجع لكم بعدين» would otherwise hit.
    if (assistant_is_goodbye($t)) return ['thanks', 'bye'];

    // DAMAGE, ASKED ABOUT IN ADVANCE: "if it arrives damaged", "how do you deal
    // with damaged items", "do you cover damage in delivery". The returns
    // policy is the answer, not «ما لقيت شي» and not the delivery timetable.
    if (assistant_has($t, ['damage', 'damaged', 'defect*', 'faulty', 'broken', 'عيب', 'تالف', 'خربان', 'معيوب'])
        && ($hypothetical || assistant_has($t, ['do you cover', 'cover damage', 'guarantee', 'warranty', 'ضمان', 'كفاله',
                                                'how do you deal']))) {
        return ['returns', null];
    }

    // "Back to the home page" is navigation, not a return.
    $navBack = assistant_has($t, ['ارجع للصفحه', 'ارجع للرئيسيه', 'ارجع للقائمه', 'ارجع للموقع', 'back to the home page',
                                  'back to the homepage', 'back to home']);

    // SENDING SOMETHING BACK IS NOT A TRACKING QUESTION, for the same reason
    // cancelling is not: "I want to return my order" and «ابي ارجع طلبي» name
    // the order, so they were answered "send me your order number" and the
    // 14-day free return was never mentioned. Only the unambiguous words are
    // tested here; «رجعت» also means "I came back", so it waits until after
    // the order and delivery questions below.
    //
    // «بدّل لي المقاس» as a whole word, never a substring: «بدلة رياضية» is a
    // tracksuit. "I want my money back" and «ابي فلوسي ترجع» are refunds.
    // ("returning customer" is a shopper who has bought before, not a return.)
    $tRet = preg_replace('/returning\s+(?:customers?|clients?|shoppers?|buyers?|visitors?|members?|users?)/', ' ', $t) ?? $t;
    if (!$navBack && assistant_has($tRet, ['ارجاع', 'ارجع', 'استرجاع', 'استرجع', 'استبدال', 'استبدل', 'ابدل', 'تبديل',
                           '^بدل$', '^بدلي$', '^بدلو', '^نبدل', '^تبدل', 'استرد',
                           'مرتجع', 'استرداد', 'اغير المقاس', 'تغيير المقاس', 'اغير اللون', 'تغيير اللون',
                           'طلبت مقاس غلط', 'اخترت مقاس غلط', 'طلبت غلط', 'اخترت غلط', 'arja3', 'retrun',
                           'فلوسي ترجع', 'ابي فلوسي', 'ترجعون فلوسي', 'ترجعولي فلوسي',
                           'return', 'returned', 'returning', 'returnable', 'returnables', 'refund*', 'exchange*', 'send back', 'send it back', 'send them back',
                           'swap', 'ordered the wrong', 'chose the wrong', 'picked the wrong', 'bought the wrong',
                           'money back'])) {
        return ['returns', null];
    }
    if ($navBack) return ['search', null];

    // "SP" on its own is somebody about to paste an order number. It used to
    // be a product search, and "sp" is inside "Sports", so they were shown a
    // sports bra.
    if (preg_match('/^\s*sp[\W_]*$/iu', $t)) return ['order_status', null];

    // AN ORDER NUMBER IS THE QUESTION, whatever words surround it. Someone who
    // pastes SP1AU702NKHTKDV and nothing else is asking about that order.
    if (assistant_find_track($text) !== null) return ['order_status', null];

    // "TAKE ME TO CHECKOUT", AND "HOW DO I ORDER". The recommend line used to
    // promise "I will take you through checkout", and «كمل الطلب» / "ok take me
    // to checkout" were then answered «ما لقيت شي» and handed to staff as
    // failed searches; "how do I place an order" and «كيف اطلب» still were.
    // Not a bare "check out": "check out the define jacket" is a look, not a
    // purchase. And not when the message is really about paying, a code or the
    // fee AT checkout — those have their own answers below. A how-to-order
    // that names the garment is shown the garment (search), with its Add button.
    if ((assistant_has($t, ['كمل الطلب', 'كمل طلبي', 'اكمل الطلب', 'نكمل الطلب', 'اتمام الطلب', 'اتمم الطلب',
                            'checkout', 'proceed to checkout', 'take me to checkout', 'go to checkout',
                            'how do i check out', 'how to check out', 'ready to check out', 'check out now',
                            'complete my order', 'complete the order', 'finish my order', 'place my order',
                            'place the order'])
         || preg_match('/^(?:اي |ok |okay )?(?:نكمل|كمل|اكمل|check out)[\s\p{P}]*$/u', $t)
         || (!$c['type'] && assistant_has($t, ['how do i order', 'how do i place', 'how to order', 'how to place',
                                               'how can i order', 'how can i place', 'how do i buy', 'how to buy',
                                               'how can i buy', 'how do you order', 'كيف اطلب', 'كيف اسوي طلب',
                                               'كيف اشتري', 'شلون اطلب', 'شلون اشتري', 'شلون اسوي طلب',
                                               'طريقه الطلب', 'كيف الطلب'])))
        && !assistant_has($t, ['pay', 'paying', 'payment', 'knet', 'cash', 'visa', 'card', 'code', 'coupon*', 'discount*',
                               'deliver*', 'fee', 'دفع', 'ادفع', 'كي نت', 'كاش', 'بطاق', 'كود', 'كوبون', 'خصم',
                               'توصيل', 'رسوم'])) {
        return ['checkout', null];
    }

    // CHANGING AN ORDER is a person's job: "can I add another item to my
    // order", «ابي اعدل الطلب» named the order and were asked for its number.
    // And "I have a problem", said and nothing else, is somebody who wants one.
    if (assistant_has($t, ['change my order', 'change the order', 'edit my order', 'modify my order', 'add to my order',
                           'add another item to my order', 'add something to my order', 'to my order',
                           'اعدل الطلب', 'اعدل طلبي', 'تعديل الطلب', 'اضيف للطلب', 'اضيف على الطلب', 'اضيف قطعه للطلب',
                           'اغير الطلب', 'اغير طلبي'])
        || preg_match('/^(?:i have|i\'ve got|i got|there is|there\'s|we have|got)\s+(?:a\s+|an\s+)?(?:small\s+|big\s+)?(?:problem|issue)(?:\s+with\s+(?:my|the)\s+order)?[\s\p{P}]*$|^(?:(?:انا\s+)?عندي|في|فيه)\s+مشكله(?:\s+(?:في|ب|بال)\s*(?:الطلب|طلبي))?[\s\p{P}]*$|^مشكله[\s\p{P}]*$|^(?:a\s+)?problem[\s\p{P}]*$/u', $t)) {
        return ['contact', null];
    }

    // COLLECTING IT IN PERSON is a location question: "can I pick up my order"
    // named "my order" and was asked for the order number.
    if (assistant_has($t, ['pick up my order', 'pickup my order', 'pick up the order', 'collect my order',
                           'pick it up myself', 'استلم بنفسي', 'اجي استلم', 'استلمه بنفسي'])) {
        return ['location', null];
    }

    // 'tracking', not 'track': "do you have a tracksuit" contains "track", and
    // a substring match on it answered a shopping question with a request for
    // an order number. A bare "track" as the whole message is the same
    // question as "tracking". Not a bare "my parcel" either: "when will my
    // parcel arrive" is a delivery question.
    // «الطلب ملغي؟» ("is the order cancelled?") asks about a state, so it is
    // answered with the request for the SP number, not as a product miss.
    // A LATE ORDER is a tracking question: «الطلب متأخر», "still waiting for my
    // package" got «ما لقيت شي». So is the commonest Kuwaiti "it hasn't come",
    // «ما جاني» / «ما جات», and "order not received".
    // "Cancelled" is a STATE here — «ملغي», "was my order cancelled?", "SP… is it
    // cancelled?" — and is answered with the order's own stage. As a request it
    // was taken by assistant_cancel_rule long before.
    if (assistant_has($t, ['cancelled', 'canceled', 'تم الغاء', 'تم الغا', 'طلبي', 'طلبيتي', 'وين طلب', 'اين طلب', 'تتبع', 'رقم الطلب', 'حاله الطلب',
                           'وين الطلب', 'الطلب حقي', 'ما وصلني', 'ما وصل', 'مو واصل', 'موب واصل', 'ملغي', '^انلغ',
                           'تاخر', 'متاخر', 'انتظر الطلب', 'انتظر الشحنه', 'ما جاني', 'ما جانا', 'ما جات', 'ما جاتني',
                           '^ما جا$', 'لم يصل', 'لم تصل', 'وين وصل', 'talabi', 'el talab',
                           'my order', 'where is my order', 'tracking', 'track my', 'track order',
                           'order status', 'order number', 'my oder', 'is late', 'running late', 'waiting for my',
                           'where is my', 'where are my', 'where is my parcel', 'where is my package', "where's my",
                           'wheres my', 'placed an order', 'update on my', 'not received', 'never received',
                           'never arrived', 'not arrived', "hasn't arrived", 'has not arrived', "didn't arrive",
                           'did not arrive', "hasn't come", 'has not come', "haven't received", 'have not received'])
        // ROUND FIVE: one list for a parcel that is late or has not come (assistant_late_words), so "haven't
        // arrived", "delayed", "never came", "still waiting" and «تأخر» are all a tracking question.
        || assistant_is_late_talk($t)
        || preg_match('/^track\W*$/u', $t)
        || preg_match('/(?<![a-z])i (?:ordered|placed an order)\b.*\b(?:ago|yesterday|days|week|still|nothing)\b/u', $t)
        ) {
        return ['order_status', null];
    }
    // "Cash on delivery?" names the courier but asks how to pay — and so does
    // «ادفع للمندوب؟»: «مندوب» is a delivery word, and it was answered with the
    // courier's timetable before «ادفع» was ever looked at.
    // And "is payment taken at delivery?", "can I pay when it arrives?": WHEN
    // the money is taken, which the delivery words below would have answered
    // with the timetable. Not when a fee is asked about — that IS delivery.
    if (assistant_has($t, ['cash on delivery', 'pay on delivery', 'payment on delivery', 'pay the courier',
                           'pay the driver', 'pay at the door', 'payment upon delivery', 'pay upon delivery'])
        || (assistant_has($t, ['دفع', '^ادفع', '^تدفع', '^ندفع', 'كاش', '^نقدا$', '^نقدي$', '^نقد$', '^النقد$', 'cash',
                               'كي نت', 'بطاقه', 'knet', 'card', 'visa'])
            && assistant_has($t, ['مندوب', 'المندوب', 'الاستلام', 'استلام', 'الباب', 'عند التوصيل', 'courier', 'driver',
                                  'delivery guy', 'delivery man']))
        || (assistant_has($t, ['pay', 'payment', 'paying', 'money', 'cash'])
            && assistant_has($t, ['at delivery', 'on delivery', 'upon delivery', 'when it arrives', 'when it comes',
                                  'when i receive', 'when i get it', 'when i order', 'until delivery', 'before delivery',
                                  'in advance', 'upfront'])
            && !assistant_has($t, ['fee', 'fees', 'cost', 'how much', 'price', 'charge*']))) {
        return ['payment', null];
    }
    // A SALE OR A REPLY, ASKED WITH "WHEN WILL": "when will it go on sale",
    // "when will they call me back". The delivery words below no longer hold a
    // bare "when will it/they", but a message that ALSO names the courier
    // ("when will the courier call me back") is about a person replying.
    // Not with a delivery verb: "when will you deliver my discounted item" is
    // about the parcel.
    if (assistant_has($t, ['when will', 'when do', 'when are']) && assistant_has($t, array_merge(assistant_sale_words(), ['cheaper']))
        && !assistant_has($t, ['deliver*', 'arrive*', 'ship', 'shipped', 'shipping', 'reach'])) {
        return ['recommend', null];
    }
    // ("when will it reach me" is the parcel, so 'reach me' is in the contact
    // list further down, after delivery has had its turn.)
    // (Not "thanks for the quick reply": that is a thank-you, and was paged as a
    // request for a person.)
    if (assistant_has($t, ['call me back', 'call back', 'contact me', 'reply', 'replies', 'respond',
                           'get back to me', 'come back to me', 'be back to me', 'answer my', 'email me', 'message me', 'text me'])
        && preg_match('/(?:thanks?|thank you|thx|شكرا)\s+(?:you\s+)?(?:so much\s+)?for\s+(?:the|your)\s+(?:\w+\s+)?(?:reply|replies|response|responses)/u', $t) !== 1) {
        return ['contact', null];
    }
    if ((assistant_has($t, assistant_delivery_words()) && !assistant_has($t, assistant_restock_words()))
        || preg_match('/^how long\W*$/u', $t)) {
        return ['delivery', null];
    }
    // The ambiguous returns words, now that order and delivery have had their
    // turn: «رجعت الطلب» is a return, «رجعت اسأل عن طلبي» was answered above.
    // Word-initial only, so «الطقم يرجع؟» (is the set coming back in stock?) is
    // not a returns question.
    if (assistant_has($t, ['^رجع', 'يرجع لي', 'ترجع لي', 'ترجعون'])) return ['returns', null];

    // WHEN WILL IT BE BACK, with no garment named: "when will you restock", "is
    // XL coming back", «متى يتوفر مقاس XL». It found nothing, or the size guide.
    // A person can say; the item and the size are what to send.
    if (assistant_restock_question($t, $c)) return ['contact', 'restock'];

    // A GIFT CARD IS A THING TO BUY, NOT A WAY TO PAY. "do you sell gift cards"
    // was answered with the payment methods. It is searched — and the shop
    // carries none, so search says so plainly (assistant_vocab 'unstocked').
    if (assistant_has($t, ['gift card', 'gift cards', 'giftcard', 'gift voucher', 'gift certificate',
                           'بطاقه هديه', 'بطاقات هدايا', 'بطاقه هدايا', 'بطاقات هديه', 'كرت هديه', 'قسيمه هديه',
                           'قسيمه شرائيه'])) {
        return ['search', null];
    }

    // Whole words, so "cardigan" and "discount code" are not payment questions.
    // A bare "card" IS one when no product is named — "can I use my card",
    // "card accepted?" lost their answer when it was dropped — but never "card
    // holder", which is a thing to buy; the same shape as the "phone" rule
    // below. «بطاقة» the same way, in an Arabic-first shop: «تقبلون البطاقات؟»
    // and «بطاقة ائتمان» were «ما لقيت شي». «كاش» and «تابي» are whole words
    // because كاشخ ("stylish") and كتابي contain them. "paypal" by name: "pay"
    // is a whole word now and no longer matched inside it; the answer lists
    // what IS accepted.
    // (Round five: a question about WHEN the money is taken — "when is my card charged", «متى ينخصم المبلغ» — reaches
    // here now that the money rule leaves it alone, and is a question about paying.)
    if (assistant_has($t, ['^ينخصم', '^تنخصم', '^ينسحب', '^تنسحب', 'خصم المبلغ', 'سحب المبلغ', 'خصم المبلغ', 'payment taken',
                           'money taken', 'card charged', 'gets charged', 'get charged', 'is charged', 'be charged', 'deducted',
                           'debited'])
        && !assistant_has($t, ['twice', 'two times', 'double', 'مرتين', 'discount*', 'code', 'coupon*', 'promo*', 'voucher*', 'offer*',
                               'sale', 'كود', 'كوبون', 'خصومات', 'تخفيض', 'عرض', 'عروض'])) {
        return ['payment', null];
    }
    if (assistant_has($t, ['دفع', 'كي نت', 'كينت', 'فيزا', 'ماستر', 'الدفع عند الاستلام', 'ائتمان', 'ابل باي',
                           'امريكان اكسبريس', 'اميكس', '^نقدا$', '^نقدي$', '^نقد$', '^النقد$', 'تي باي', 'تي-باي',
                           '^كاش$', '^الكاش$', 'بالكاش', 'اقساط', 'اقسط', 'تقسيط', '^تابي$', 'تمارا', 'adfa3',
                           'knet', 'visa', 'mastercard', 'master card', 'pay', 'pays', 'paying', 'payment',
                           'credit card', 'debit card', 'by card', 'with card', 'with a card', 'my card',
                           'accept card', 'take card', 'card payment', 'card accepted',
                           'accept debit', 'accept credit', 'paypal', 'pay pal', 'amex', 'american express',
                           'cash', 'cod', 'tpay', 't-pay', 'tabby', 'tamara', 'installment*', 'apple pay'])
        || (assistant_has($t, ['card', 'بطاق', '^كرت$', '^كرتي$', '^الكرت$', '^بالكرت$', '^كرتك$', '^كرتكم$']) && !$c['type']
            && !assistant_has($t, ['card holder', 'cardholder', 'card case', 'card wallet', 'card sleeve',
                                   'حامل بطاقات', 'محفظه بطاقات', 'محفظه']))) {
        return ['payment', null];
    }

    // A garment, as opposed to an accessory: a bag or a cap has no fit.
    $garment = (bool) array_diff_key($c['type'], ['bag' => 1, 'cap' => 1, 'strap' => 1, 'accessory' => 1]);

    // A FIT QUESTION ABOUT A NAMED GARMENT is still a fit question. "does the
    // jacket run small" and "is the jacket small" name a jacket AND a size
    // word (small = S), so the next rule read them as a search for size S and
    // answered with "the closest pieces" for a size nobody asked for. "in
    // small" / "size small" is a size the shopper wants, and stays a search.
    $fitPhrase = (assistant_has($t, ['run small', 'runs small', 'running small', 'run big', 'runs big',
                                     'run large', 'runs large', 'true to size', 'fit small', 'fits small',
                                     'fit big', 'fits big', 'fit large', 'fits large', 'come up small',
                                     'comes up small', 'come up big', 'comes up big', 'size up', 'size down'])
                  || preg_match('/(?<![a-z])(?:is|are)\s+(?:the|this|it|these|they|those)(?:\s+[a-z\-]+){0,3}?\s+(?:too\s+|very\s+|a bit\s+|a little\s+)?(?:small|big|large|tight|loose)[\s\p{P}]*$/u', $t))
                 && !preg_match('/(?<![a-z])(?:in|size|available)\s+(?:small|medium|large)(?![a-z])/u', $t);
    if ($fitPhrase && ($garment || !$c['type'])) return ['sizes', null];

    // A PRODUCT NAMED WITH A SIZE IS A SHOPPING QUESTION. «ليقنز مقاس M» and
    // "size large jacket" contain the size words below, and got the size-guide
    // sentence instead of the leggings that come in M. An accessory has no
    // size at all, so «شنطة كبيرة» (a large bag) is never a fit question.
    if ($c['type'] && $c['size'] !== null) return ['search', null];
    if (!$garment && $c['type'] && assistant_has($t, ['كبير', 'صغير'])) return ['search', null];
    // A garment with a bare «صغير/كبير/ضيق/واسع» and nothing else asked:
    // «الجاكيت صغير؟» is "does the jacket come up small", and was answered with
    // four jacket cards. Anything else named — a colour, a model — and it is
    // a search again.
    $fitAdj = ['صغير', 'كبير', 'ضيق', 'واسع'];
    if ($garment && assistant_has($t, ['^صغير', '^كبير', '^ضيق', '^واسع']) && !$c['colour']
        && !array_diff($c['free'], $fitAdj)) {
        return ['sizes', null];
    }
    // And a size with nothing else named is a sizing question: "XL?",
    // «عندكم XL؟», "is this available in medium" — and so is a size that is
    // "missing" or one the shopper is "between": "is the XL missing?",
    // «ناقص مقاس M؟», "I'm between M and L".
    if ($c['size'] !== null && !$c['type'] && !$c['colour'] && !array_diff($c['free'], ['missing', 'ناقص', 'between'])) {
        return ['sizes', null];
    }

    // Fit phrases, not bare «صغير/كبير»: those were inside «شنطة صغيرة» and
    // «خصومات كبيرة». A whole-word "fit" is safe now that English needles are
    // whole words — it can no longer match fitness or outfit — except as a
    // STYLE of a named garment: "slim fit joggers" is a search for joggers.
    $fitStyle = $c['type'] && assistant_has($t, ['slim fit', 'regular fit', 'relaxed fit', 'loose fit',
                                                  'oversized fit', 'oversize fit', 'skinny fit', 'tight fit',
                                                  'athletic fit', 'muscle fit', 'compression fit',
                                                  'tapered fit', 'straight fit', 'boxy fit']);
    if ((!$fitStyle && assistant_has($t, ['مقاس', 'مقاسات', 'حجم', 'مقاس صغير', 'مقاس كبير', 'صغير علي', 'كبير علي',
                           'صغيره علي', 'كبيره علي', 'يجي صغير', 'يجي كبير', 'يطلع صغير', 'يطلع كبير',
                           'طلع صغير', 'طلع كبير',
                           'size', 'sizing', 'measurement', 'fit', 'fits', 'fitting', 'fit guide',
                           'true to size', 'run small', 'runs small', 'run big', 'runs big', 'run large',
                           'runs large', 'how long are', 'قياس', 'القياسات']))
        || preg_match('/^(عندكم |do you have |is there |any )?(size |مقاس )?(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|small|medium|large|لارج|ميديم|سمول|اكس لارج)( available| متوفر| موجود)?[\s\p{P}]*$/u', $t)) {
        return ['sizes', null];
    }
    // A request for a SUGGESTION, not a search for a named thing. "وش تنصح",
    // "شنو الأكثر مبيعا", "recommend something" name no product, so product
    // search would find nothing and the customer would be told the shop has
    // nothing — when the honest answer is a shelf of what is in stock. Kept
    // AFTER sizes/returns so "what size do you recommend" stays a sizing
    // question. Offers, codes, new arrivals and gifts land here too: it is the
    // intent whose answer is a real shelf. Not bare «جديد/الجديد» («ابي الجاكيت
    // الجديد» is a search), and not a bare "offer" ("do you offer this in XL").
    // The sale words are assistant_sale_words — the shelf reads the same list.
    // Not a bare "deal" either: "how do you deal with damaged items" is not
    // asking for offers.
    //
    // NEW, TRENDING, THE LATEST — in any word order, when no garment or colour is
    // named: «وش عندكم جديد», «فيه جديد؟», «منتجات جديدة», «وش نزل جديد», "latest
    // collection", "any new models", "what's trending", "top sellers". The old list
    // held only «شنو الجديد»-shaped phrases, so each of those was a search for the
    // word «جديد» and came back «ما لقيت شي». A NAMED new piece («ابي الجاكيت
    // الجديد», "new leggings in black") is still a search.
    if (!$c['type'] && !$c['colour']
        && assistant_has($t, ['^جديد', '^الجديد', '^جديده', '^الجديده', '^جديدين', 'new models', 'new model', 'new designs',
                              'new design', 'new styles', 'new style', 'new products', 'new product', 'new pieces',
                              'new colours', 'new colors', 'new season', 'new drop', 'new release*', 'latest collection',
                              'latest arrivals', 'latest models', 'latest designs', 'latest styles', 'latest products',
                              'latest drop', "what's the latest", 'whats the latest', 'newest', 'trending', 'trend*',
                              'top seller*', 'top selling', 'bestseller', 'popular now'])) {
        return ['recommend', null];
    }
    if (assistant_has($t, assistant_sale_words())
        || assistant_has($t, ['انصح', 'تنصح', 'نصيحه', 'اقترح', 'اقتراح', 'وش تنصح', 'شنو تنصح',
                              'الاكثر مبيعا', 'الافضل', 'الاكثر طلبا', 'كود خصم',
                              'كود', 'كوبون', 'قسيمه', 'شنو الجديد', 'وش الجديد', 'ايش الجديد', 'الجديد عندكم', 'شي جديد',
                              'جديدكم', 'وصل جديد', 'هديه',
                              'recommend*', 'suggest*', 'suggestion', 'best seller*', 'bestseller*',
                              'popular', 'what should i', 'featured', 'promo*', 'coupon*', 'voucher*', 'new arrival*',
                              "what's new", 'whats new', 'what is new', 'anything new', 'new items', 'new item',
                              'new stuff', 'new collection', 'new in', 'gift*'])) {
        return ['recommend', null];
    }
    // A person. Not a bare "phone" while a product is named: the Gymshark
    // Phone Strap is in the catalogue, and asking for it by name handed the
    // shopper to staff as somebody wanting a human — and not "phone holder /
    // case / armband" either, which name a thing to buy with no type the
    // dictionary knows.
    if (assistant_has($t, ['تواصل', 'اتصال', 'خدمه العملاء', '^موظف', '^الموظف', 'انسان', 'واتساب', 'رقمكم', 'اكلم',
                           'كلموني', '^كلمني', 'اتصل', 'واتس', 'رقم التلفون', 'رقم الهاتف', 'تلفونكم', 'ايميل',
                           'اشتكي', 'شكوي', 'يرد علي', 'تردون', 'ترد علي', 'محد يرد', 'akalim',
                           'contact*', 'human', 'agent', 'speak to', 'speak with', 'whatsapp', 'email', 'e-mail',
                           'phone number', 'your number', 'call you', 'call me', 'customer service',
                           'customer care', 'talk to', 'a person', 'real person', 'complain*', 'reach me',
                           'reach you', 'telephone'])
        || (assistant_has($t, ['phone']) && !$c['type']
            && !preg_match('/phone\s+(?:holder|case|cover|armband|arm band|strap|pouch|mount|stand|bag|band|belt|sleeve|clip)/u', $t))) {
        return ['contact', null];
    }
    // WHERE THE SHOP IS. There is no branch to visit — Sporta is online only,
    // delivering across Kuwait — but "وين موقعكم" fell through to product
    // search and came back "I did not quite follow that", which reads as a shop
    // hiding its address. Saying plainly that it is an online shop is both true
    // and the more useful answer. Kept after `delivery`, so "متى يوصل لموقعي"
    // stays a delivery question. Not a bare "your store": "do you have
    // leggings in your store" is a search.
    if (assistant_has($t, ['وين موقعكم', 'موقعكم', 'مقركم', 'عنوانكم', 'فرع', 'فروع', 'محل', '^وينكم', 'مكانكم',
                           'القاكم', 'الاقيكم', 'معرض', 'وين تلقونكم', 'زياره', 'استلم بنفسي', 'اجي استلم',
                           'where are you', 'your location', 'address', 'branch*', 'store location',
                           'showroom', 'visit you', 'shop location', 'where is your shop', 'where is your store',
                           'visit your shop', 'visit your store', 'physical store', 'physical shop', 'a store',
                           'a shop in', 'are you in kuwait', 'based in', 'located', 'pickup', 'pick up', 'pick it up',
                           // "online only?" is the same question, and so is
                           // «انتو بالكويت؟». Phrases, not «بالكويت»: «توصلون
                           // ليقنز بالكويت» is not asking where the shop is.
                           'online only', 'only online', 'online store only', 'online shop only', 'is it an online',
                           'are you online', 'shop i can visit', 'store i can visit', 'in person', 'انتو بالكويت',
                           'انتم بالكويت', 'موجودين بالكويت', 'اونلاين بس', 'بس اونلاين', '^ازور', '^نزور',
                           'اين يقع', 'وين يقع'])) {
        return ['location', null];
    }

    // "IS ANYONE THERE?" / «موجودين؟» / «عندي استفسار», with or without a
    // hello: a hello. Before the "what do you have" rule, which read «موجود».
    // And a hello whose every other word is a courtesy («السلام عليكم
    // موجودين؟») is a hello, whatever «موجود» means elsewhere.
    if (assistant_is_presence($t) || assistant_is_presence(assistant_after_greeting($t))
        || (assistant_has($t, assistant_greeting_words()) && !preg_match('/[\p{L}\p{N}]{2,}/u', assistant_after_greeting($t)))) {
        return ['greeting', null];
    }

    // "WHAT DO YOU HAVE / SELL" names nothing, and every word of it is a stop
    // word, so it was searched, found nothing and answered «ما لقيت شي يطابق
    // كلامك في المتجر» — the shop telling a new customer it has nothing, as
    // the first reply of the chat, then logging it as a failed search. It is
    // a request for the shelf. Not a restock question ("when will it be back
    // in stock"), which is about one thing the shelf would not show.
    if (!$c['type'] && !$c['colour'] && !$c['gender'] && !$c['free'] && !$c['generic'] && $c['size'] === null
        && $c['max'] === null && !$c['cheap']
        && !assistant_has($t, ['when', 'متي', 'restock*', 'be back', 'come back', 'again', 'يرجع', 'ترجع'])
        && assistant_has($t, ['عندكم', 'عندك', 'شعندكم', 'تبيعون', 'تبيع', 'متوفر', 'موجود', 'منتجات',
                              'منتجاتكم', 'بضاعه', 'بضاعتكم', 'تشكيله', 'تشكيلتكم', 'ورني', 'وريني',
                              // "you have", not "have": "I have a question" is not a
                              // request for the shelf.
                              'you have', 'you got', 'you sell', 'you carry', 'you stock', 'your products',
                              'your range', 'your collection', 'products', 'catalog', 'catalogue', 'everything',
                              'show me', 'in stock', 'is available', "what's available", 'whats available'])) {
        return ['recommend', null];
    }

    // A greeting that also carries a product question is searched by
    // assistant_answer; here it is only recognised.
    if (assistant_has($t, assistant_greeting_words())) return ['greeting', null];

    // An acknowledgement — "ok", «تمام» — gets a line of its own, not a search.
    if (assistant_is_ack($t)) return ['thanks', 'ack'];

    // THANKS IS AN ANSWER, NOT A SEARCH. "شكرا" matched nothing and became a
    // product search, so the shop ended a conversation it had just handled well
    // with "I did not quite follow that" — the last thing the customer reads.
    // Tested LAST so that "thanks, where is my order" is still about the order.
    //
    // …AND ONLY IF NOTHING ELSE WAS ASKED. "do you have black leggings, thanks",
    // «ابي ليقنز اسود شكرا», «يعطيك العافية عندكم شورت؟» are product questions with
    // a courtesy in them, and were answered "Happy to help" with no product shown.
    // What the thanks words leave (and the hello and the forms of address, which
    // are search's to ignore) is read like a greeting's: a kind of garment, a
    // colour, who it is for, a size, a budget, "cheapest", "sportswear", something
    // the shop does not sell, or a brand it does not carry makes it a search. "thanks
    // a lot", "thank you so much", "thanks for your help" name none and stay thanks.
    if (assistant_has($t, assistant_thanks_words())) {
        $q = assistant_query(assistant_after_greeting(assistant_after_thanks($t)));
        if ($q['type'] || $q['colour'] || $q['gender'] || $q['size'] !== null || $q['max'] !== null || $q['cheap']
            || $q['generic'] || $q['unstocked'] || assistant_has($q['t'], assistant_other_brand_words())) {
            return ['search', null];
        }
        return ['thanks', null];
    }

    return ['search', null];
}

function assistant_intent(string $text): string
{
    return assistant_route($text)[0];
}

// An order number as the customer will type it: in either alphabet's digits,
// with a stray space or hyphen after the SP, or an invisible mark pasted
// inside it.
//
// NOT ANY WORD THAT STARTS WITH "SP". The old pattern was SP + six letters, so
// "sportswear for women" — the shop's own tagline is SPORTS WEAR — was answered
// "I could not find an order with the number SPORTSWEAR", and so were
// "Puma Speedcat" and "speedcross shoes". Real numbers come from makeTrackId
// (attempt.js, in src/lib): SP + two base36 integers, uppercased. Nearly all carry
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
        // Pants to a shopper, one word to the shop: "track pants" was the
        // free word "track" (on no card) beside the type.
        "/{$b}(?:sweat|track|jogging|jog)[\\s\\-]?pants?{$e}/u" => 'trackpants',
        // "Top sellers" is a request for the best-sellers shelf, not for the
        // garment "top".
        "/{$b}top[\\s\\-]?(?:sellers?|selling|rated|picks?){$e}/u" => 'bestseller',
        // A gift card is one thing, and not one the shop sells (unstocked).
        "/{$b}gift[\\s\\-]?(?:cards?|vouchers?|certificates?){$e}/u" => 'giftcard',
        '/(?:بطاق|كرت|قسيم)[اهت]*\s(?:هدي[هة]|هدايا|شرايي[هة])/u' => 'جفتكارد',
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
            'tshirt'  => ['tshirt', 'tee', 'shirt', 'تيشيرت', 'تيشرت', 'فانيلة', 'فنايل', 'قميص', 'شيرت'],
            // HOODIES ARE CARRIED: the category is «هوديز وجواكيت» / Hoodies &
            // Jackets (products.js, in src/lib), and the SEO copy advertises them.
            // They were in 'unstocked', so «عندكم هودي؟» was told "we do not
            // carry that". A hoodie is a sweatshirt or a jacket to this shop,
            // so it names both; «هوديز» meets «هودي» by the prefix rule below.
            //
            // BROKEN PLURALS ARE WORDS OF THEIR OWN. Arabic plurals a noun by
            // changing its inside — جاكيت → جواكيت, شنطة → شنط, بنطلون → بناطيل —
            // which no suffix rule and no prefix rule can reach. «جواكيت» is in
            // the shop's own category name («هوديز وجواكيت») and found nothing.
            'jacket'  => ['jacket', 'جاكيت', 'جاكت', 'جواكيت', 'جواكت', 'hoodie', 'hoodies', 'hoody', 'هودي'],
            'top'     => ['top', 'توب', 'بلوزة', 'بلايز', 'بلوزات'],
            'bra'     => ['bra', 'ستيان', 'برا', 'صدرية'],
            'bag'     => ['bag', 'backpack', 'حقيبة', 'شنطة', 'شنط', 'حقائب'],
            'cap'     => ['cap', 'hat', 'كاب', 'طاقية', 'قبعة'],
            'pant'    => ['pants', 'trousers', 'joggers', 'jogger', 'sweatpants', 'trackpants', 'بنطال', 'بنطلون',
                          'بناطيل', 'بنطلونات', 'سروال', 'سراويل', 'ترنك'],
            'tank'    => ['tank', 'vest', 'stringer', 'singlet', 'تانك', 'ستراينجر', 'شيال'],
            'sweat'   => ['sweatshirt', 'سويتشيرت', 'سويت', 'hoodie', 'hoodies', 'hoody', 'هودي'],
            'strap'   => ['strap', 'armband', 'حزام'],
            // The CATEGORY, by its storefront name (products.js, in src/lib):
            // Accessories / «إكسسوارات». English found it through the category
            // column ('accessories'); the Arabic name found nothing. Every row
            // in that category carries the word, so it is a type like any other.
            'accessory' => ['accessories', 'accessory', 'إكسسوارات', 'اكسسوارات', 'إكسسوار', 'اكسسوار'],
        ],
        'colour' => [
            // Arabizi colours too: "leggings aswad" is black leggings.
            'black'  => ['black', 'onyx', 'أسود', 'سوداء', 'فاحم', 'aswad', 'sowda', 'swda'],
            'navy'   => ['navy', 'كحلي'],
            'grey'   => ['grey', 'gray', 'steel', 'رمادي', 'رصاصي', 'فولاذي'],
            'red'    => ['red', 'cherry', 'أحمر', 'حمراء', 'كرزي', 'a7mar', 'ahmar', 'hamra'],
            'green'  => ['green', 'army', 'olive', 'أخضر', 'خضراء', 'زيتي', 'عسكري'],
            'brown'  => ['brown', 'taupe', 'coffee', 'بني', 'قهوة'],
            'white'  => ['white', 'أبيض', 'بيضاء', 'abyad', 'abyadh', 'baidha'],
            'pink'   => ['pink', 'وردي', 'زهري'],
            'purple' => ['purple', 'iris', 'بنفسجي', 'موف'],
            'blue'   => ['blue', 'royal', 'أزرق', 'زرقاء', 'ملكي', 'سماوي'],
            // COLOURS THE SHOP DOES NOT HAVE TODAY are still colours. As free
            // words, "yellow shorts" found the shorts and said "Here is what I
            // found:" over red and green ones; named as a colour, the reply
            // says that colour is not in (found_colour) and staff hear of it.
            'yellow' => ['yellow', 'أصفر', 'صفراء'],
            'orange' => ['orange', 'برتقالي'],
            'beige'  => ['beige', 'cream', 'بيج', 'بيجي', 'كريمي'],
            'gold'   => ['gold', 'golden', 'ذهبي'],
            'silver' => ['silver', 'فضي'],
            'maroon' => ['maroon', 'burgundy', 'عنابي', 'خمري'],
            'turquoise' => ['turquoise', 'teal', 'تركواز', 'تركوازي', 'فيروزي'],
        ],
        'gender' => [
            // Compared with the product's category by EQUALITY, never LIKE:
            // '%men%' is inside 'women'.
            'men'   => ['men', 'man', 'male', 'gents', 'رجالي', 'رجال', 'شباب', 'شبابي', 'husband', 'زوجي', 'rjali', 'rijali'],
            'women' => ['women', 'woman', 'ladies', 'lady', 'female', 'girls', 'نسائي', 'نساء', 'حريمي', 'حريم',
                        'بنات', 'بناتي', 'wife', 'زوجتي', 'nisai', 'nisa2i', 'harimi'],
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
            '2xl', '3xl', 'kd', 'kwd', 'dinar', 'dinars', 'fils', 'under', 'below', 'less', 'than', 'cheap',
            'cheaper', 'cheapest', 'max',
            // A restock question names no product: "when will it be back in
            // stock" found the BACKpack. ("restock" itself stays a word, so
            // "when will you restock XL" is not read as a bare size.)
            'back', 'again', 'soon',
            // "What do you have / sell" is made of these, and names nothing:
            // the router sends it to the shelf (assistant_route).
            'everything', 'catalog', 'catalogue', 'collection', 'range', 'carry', 'selling', 'sells',
            'شعندكم', 'تبيعون', 'تبيع', 'تبيعو', 'منتجاتكم', 'بضاعه', 'بضاعتكم', 'تشكيله', 'تشكيلتكم', 'وريني',
            'الموجود', 'المتوفر',
            // Praise is not a product. "comfy leggings" is leggings, and as a
            // free word "comfy" would be on no card and turn a real match
            // into "not exactly what you asked for" (found_other).
            'cute', 'comfy', 'comfortable', 'pretty', 'beautiful', 'stylish', 'cool', 'awesome', 'lovely',
            'حلوه', 'جميل', 'جميله', 'مريح', 'مريحه', 'كشخه', 'كشخ', 'كاشخ', 'روعه',
            // HOW KUWAIT ASKS TO BUY. None of these is a product, and round two
            // read each as a word missing from the top card: «ابي اشتري ليقنز»,
            // «عطوني ليقنز», «تكفون عندكم ليقنز», "do you guys sell shorts",
            // MSA «هل لديكم», and Arabizi "3indkum leggings?".
            'اشتري', 'نشتري', 'اطلب', 'نطلب', 'عطوني', 'اعطني', 'تعرضون', 'تعرض', 'محتاج', 'محتاجه', 'لديكم', 'لديك',
            'تكفون', 'تكفى', 'سمحتو', 'سمحتي', 'ضروري', 'شفت', 'شفتها', 'حصلت', 'بنفس', 'ابغي', 'اريده', 'ابيها',
            'guys', 'asap', 'order', 'sister', 'daughter', 'son', 'mum', 'mom', 'friend', 'like', 'buy', 'purchase',
            'abi', 'abgha', '3indkum', '3indkom', '3ndkm', '3ndkom', '3ndkum', 'endkom', 'fi', 'fe', 'wain', 'wen', 'el',
            'shno', 'shnu',
            // A courtesy is not a product (assistant_route reads the thanks first).
            'thanks', 'thank', 'thx', 'tnx', 'thnx', 'thanx', 'cheers', 'appreciate', 'shukran', 'shokran', 'mashkoor',
            'شكرا', 'مشكور', 'يعطيك', 'العافيه', 'تسلم', 'يسلمك', 'ماقصرت', 'ثانكس', 'ثانكيو', 'يعافيك',
        ]),
        // Words that mean "sportswear" and nothing narrower. A message made
        // only of these is a request for the shelf, not a failed search —
        // otherwise the shop would say it does not carry gym clothes.
        'generic' => $set([
            'ملابس', 'لبس', 'رياضي', 'رياضية', 'رياضة', 'جيم', 'تمرين', 'تمارين', 'ركض', 'جري', 'بالغين', 'للبالغين',
            'كبار', 'clothes', 'clothing', 'wear', 'activewear', 'sportswear', 'sport', 'sports', 'sporting', 'gym', 'workout',
            'training', 'outfit', 'fitness', 'exercise', 'running', 'jogging', 'yoga', 'adult', 'adults',
        ]),
        // Things Sporta does not sell today — every word checked against the
        // catalogue (no product name or category holds one) and the category
        // list (Women, Men, Hoodies & Jackets, Accessories). Hoodies were
        // here, and are carried. Only consulted when the catalogue did not
        // find the word itself: a hit on a product named after it always
        // wins, so the day the owner adds shoes, shoes are found and this
        // list says nothing.
        'unstocked' => $set([
            'shoe', 'shoes', 'sneaker', 'sneakers', 'trainers', 'boot', 'boots', 'sock', 'socks', 'protein',
            'supplement', 'supplements', 'mat', 'swimwear', 'swimsuit', 'tracksuit',
            'bottle', 'حذاء', 'احذية', 'جزمة', 'جزم', 'كوتش', 'جوارب', 'شراب', 'شرابات', 'بروتين', 'مكملات',
            'مايوه', 'تراكسوت', 'شوز', 'سنيكرز',
            // «بدلة رياضية» is a tracksuit (stemmed «بدل»), never the returns
            // verb — that one is routed long before search.
            'بدلة', 'بدلات',
            // Gift cards: folded to one word by assistant_prefold. "do you sell
            // gift cards" was answered with the payment methods.
            'giftcard', 'جفتكارد',
        ]),
    ];
}

// BRANDS AND TEAMS THE SHOP DOES NOT CARRY — an explicit list, checked
// against the catalogue (no product or brand row holds one). They are the one
// kind of leftover word search can prove is missing: "nike shorts" are shorts,
// and not Nike's, so the reply says it does not have exactly that
// (found_other) and staff hear of the demand. Any OTHER word that is on no
// card — "asap", «تكفون», "cotton", «خصر عالي» — proves nothing, because the
// catalogue's names record type and colour only, so it keeps "Here is what I
// found". Round two said «ما عندنا اللي طلبته بالضبط» to every such word.
function assistant_other_brand_words(): array
{
    return ['nike', 'adidas', 'puma', 'reebok', 'under armour', 'under armor', 'underarmour', 'lululemon', 'asics',
            'new balance', 'fila', 'skechers', 'jordan', 'jordans', 'champion', 'columbia', 'north face', 'decathlon',
            'alo yoga', 'hilal', 'al hilal', 'nassr', 'al nassr', 'ittihad', 'real madrid', 'barcelona', 'barca',
            'liverpool', 'arsenal', 'chelsea', 'man united', 'manchester', 'juventus', 'psg', 'bayern', 'ac milan',
            'نايكي', 'نايك', 'اديداس', 'ريبوك', 'بوما', 'اندر ارمر', 'لولوليمون', 'اسيكس', 'نيو بالانس', 'سكيتشرز',
            'جوردن', '^الهلال', '^هلال', '^النصر', '^الاتحاد', 'ريال مدريد', 'برشلونه', 'برشلونة', 'ليفربول',
            'ارسنال', 'تشيلسي', 'مانشستر', 'يوفنتوس', 'بايرن', 'القادسيه'];
}

// A size the shopper named, as the shop stores it (STORE_SIZES), or null.
// Not "xs" (the shop has none), and never the s of "women's" or the m of
// "I'm" — the apostrophe is the guard, and normalise has already folded the
// iPhone's curly one into it.
function assistant_size_token(string $f): ?string
{
    // "XS" too: the shop has none, and "black leggings size xs" was the size
    // guide instead of "not in that size, here are the closest". And never the
    // m of "i m" typed without its apostrophe ("hi i m new here").
    if (preg_match("/(?<![\\p{L}\\p{N}'])(5xl|4xl|3xl|2xl|xxxl|xxl|xl|xxs|xs|s|(?<!\\bi )m|l)(?![\\p{L}\\p{N}'])/u", $f, $m)) {
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
    $q = ['t' => $t, 'seq' => [], 'type' => [], 'colour' => [], 'gender' => [], 'free' => [], 'generic' => false,
          'unstocked' => false, 'unstocked_words' => [], 'colour_words' => [],
          'size' => assistant_size_token($f), 'max' => null,
          'cheap' => (bool) preg_match('/(?<![a-z])(?:cheap|cheaper|cheapest)(?![a-z])|ارخص|رخيص/u', $f)];
    // A budget: "under 5 kd", «أقل من ١٠ دينار». Digits are already ASCII.
    if (preg_match('/(?:under|below|less than|cheaper than|up to|اقل من|ارخص من|تحت|دون|بحدود|حدود)\s*(\d+(?:\.\d+)?)/u', $f, $m)) {
        $q['max'] = (int) round((float) $m[1] * 1000);
    }
    foreach (preg_split('/[^\p{L}\p{N}]+/u', $f, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $w) {
        $w = assistant_stem($w);
        // Every word in the order it was typed, for assistant_line_named: whether
        // a line's name sits NEXT TO a kind of garment.
        $q['seq'][] = $w;
        // Three letters or more. Two-letter words matched INSIDE product names:
        // «ما» is in «رمادي», so "my order has not arrived" got grey leggings —
        // and, because cards came back, no member of staff was ever told.
        if (mb_strlen($w) < 3 || ctype_digit($w) || isset($v['stop'][$w])) continue;
        if (isset($v['generic'][$w])) { $q['generic'] = true; continue; }
        $c = assistant_concepts_of($w, true);
        if ($c) {
            foreach ($c as [$g, $k]) {
                $q[$g][$k] = true;
                // The colour AS TYPED, as well as the colour it names: "taupe"
                // is brown, but the three pieces called Taupe should lead the
                // two called Coffee Brown (assistant_score).
                if ($g === 'colour') $q['colour_words'][] = $w;
            }
            continue;
        }
        if (isset($v['unstocked'][$w])) { $q['unstocked'] = true; $q['unstocked_words'][] = $w; }
        $q['free'][] = $w;
    }
    $q['free'] = array_values(array_unique($q['free']));
    $q['colour_words'] = array_values(array_unique($q['colour_words']));
    return $q;
}

// --------------------------------------------------------------------- tools
//
// Each returns [reply, data] — data being anything the widget can render as
// something better than a sentence (an order card, a row of products).

//
// Returns [reply, data, escalate]. `escalate` is null for an ordinary answer, and
// a contact topic ('not_received', 'late_order') when the order itself says a
// person must look — the widget still gets the order card and intent
// order_status; assistant_answer sends the handoff.
//
// $complaint is "the customer says it did not come / is late". It changes two
// things. With no number: the request for it also says what to do WITHOUT one,
// and makes no 24-hour promise to someone who says that hour has passed. With a
// DELIVERED order: it is a dispute — the courier says delivered and the customer
// says nothing came — not "delivered, you have 14 days to return it".
function assistant_order(PDO $db, array $cfg, ?string $track, bool $ar, bool $eta = false, bool $complaint = false): array
{
    if ($track === null) {
        // "When will my order arrive?" with no number used to get only "send
        // me your order number" — a timing question answered with no time,
        // while «متى يوصل الطلب» (no "my") got the 24 hours. The split followed
        // the possessive, not the language. Now both hear the promise.
        $key = $complaint ? 'ask_track_missing' : ($eta ? 'ask_track_eta' : 'ask_track');
        return [assistant_canned($cfg, $key, $ar), null, null];
    }
    $q = $db->prepare('select track_id, amount, payment_status, payment_method,
                              fulfilment_status, created_at, timestampdiff(HOUR, created_at, now()) as age_hours
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
        return [assistant_canned($cfg, 'no_order', $ar), null, null];
    }

    $paid = $o['payment_status'] === 'paid';
    $ful  = (string) $o['fulfilment_status'];
    $escalate = null;
    // HOW LONG IS TOO LONG. The stage lines promise "within 24 hours" and "on its
    // way", and said so of an order six days old — a stuck order was reassured
    // instead of looked at. Past `assistant_late_hours` (48 by default; the
    // promise is 24 and a day of slack is the courier's) a packed, shipped or
    // not-yet-started order is LATE: no promise, a way to reach a person, and a
    // handoff. Read from the database's own clock, like created_at.
    $lateHours = max(1, (int) ($cfg['assistant_late_hours'] ?? 48));
    $late = (int) ($o['age_hours'] ?? 0) >= $lateHours;
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
        if ($complaint) {
            $line = assistant_canned($cfg, 'not_received', $ar);
            $escalate = 'not_received';
        } else {
            $line = assistant_canned($cfg, 'stage_delivered', $ar);
        }
    } elseif ($late) {
        $line = assistant_canned($cfg, 'stage_late', $ar);
        $escalate = 'late_order';
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
    ], $escalate];
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
    return $cache[$id] = ['rows' => $rows, 'brands' => $brands, 'brand_tokens' => $brandToks,
                          'lines' => assistant_line_names($db, $rows)];
}

// THE NAMES OF THE SHOP'S LINES AND BRANDS — the words that, missing from the
// top card, prove "we do not have exactly that" (found_other): "sculpt
// shorts" names a line that has no shorts. Not every word of every name:
// "Gymshark PHONE Strap" made "is there a phone pocket in the leggings" a
// claim that the leggings have none, which nothing here knows.
//
//   * the first word of each English name (Sculpt, Cloudsoft, Vanquish …);
//   * its Arabic spelling: the word every Arabic name of that line shares
//     (كلاودسوفت, not «ظهر» — "back", in only the two backpacks);
//   * every active brand's name, in both languages.
function assistant_line_names(PDO $db, array $rows): array
{
    $v = assistant_vocab();
    $plain = fn (string $t) => mb_strlen($t) >= 3 && !isset($v['stop'][$t]) && !isset($v['generic'][$t])
                               && !assistant_concepts_of($t);
    $lines = [];
    $arabic = [];
    foreach ($rows as $p) {
        $first = assistant_tokens((string) $p['name_en'])[0] ?? '';
        if ($first === '' || !$plain($first)) continue;
        $lines[$first] = true;
        $arabic[$first][] = array_values(array_unique(array_filter(assistant_tokens((string) $p['name_ar']), $plain)));
    }
    foreach ($arabic as $sets) {
        if (count($sets) >= 2) foreach (array_intersect(...$sets) as $t) $lines[$t] = true;
    }
    try {
        foreach ($db->query('select name_en, name_ar from brands where active = 1')->fetchAll() as $b) {
            foreach (assistant_tokens($b['name_en'] . ' ' . $b['name_ar']) as $t) if ($plain($t)) $lines[$t] = true;
        }
    } catch (Throwable $e) {
        // A shop without the brands table has no brand names to know.
    }
    return $lines;
}

// IS THIS WORD USED AS THE NAME OF A LINE, or as an ordinary word that happens
// to be one? The first word of every English product name is a "line" (Sculpt,
// Cloudsoft, Vanquish — and Energy, Define, Street, Flash, Denver, and the
// brand ATE), and a line word missing from the top card is the proof of "we do
// not have exactly that". But "leggings for high ENERGY workouts", "leggings
// that DEFINE my shape", "jacket for the STREET" and "leggings I ATE" use the
// same words as English, and were told "we do not have exactly that" over
// cards that fit, and logged as a failed search.
//
// A line is NAMED when it stands beside a kind of garment, a colour or who it is
// for ("sculpt shorts", "vanquish leggings", "black define jacket"), or is the
// only thing the message says ("sculpt?"). Two words apart is not beside.
function assistant_line_named(array $q, string $w): bool
{
    $seq = $q['seq'] ?? [];
    if (count($seq) <= 1) return true;
    $named = function (?string $tok): bool {
        if ($tok === null) return false;
        foreach (assistant_concepts_of($tok, true) as [$g]) if (in_array($g, ['type', 'colour', 'gender'], true)) return true;
        return false;
    };
    foreach ($seq as $i => $tok) {
        if ($tok !== $w) continue;
        if ($named($seq[$i - 1] ?? null) || $named($seq[$i + 1] ?? null)) return true;
    }
    return false;
}

// A free word against a product's words: equal, or the start of one when the
// word is long enough to mean something ("sculpt", «سكالبت»), or the END of a
// compound name ("soft" in Cloudsoft — found by the old LIKE search, lost when
// search moved to words). The compound must be at least three letters longer
// than the word, so this is a name built from it, not an inflection. Never
// anywhere else inside a word — that is how "tee" found the Steel Grey jacket.
function assistant_word_hit(array $productTokens, string $w): bool
{
    $n = mb_strlen($w);
    foreach ($productTokens as $pt) {
        if ($pt === $w) return true;
        if ($n >= 4 && (str_starts_with($pt, $w) || (str_ends_with($pt, $w) && mb_strlen($pt) >= $n + 3))) return true;
    }
    return false;
}

// Is this word in any product's words at all (assistant_word_hit, over the
// whole catalogue)?
function assistant_word_anywhere(array $cat, string $w): bool
{
    foreach ($cat['rows'] as $p) if (assistant_word_hit($p['_tok'], $w)) return true;
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
    // The colour word itself in the name ranks its exact pieces first.
    foreach ($q['colour_words'] ?? [] as $w) if (assistant_word_hit($p['_tok'], $w)) $s += 4;
    if ($q['gender'] && $p['_gender'] !== null && isset($q['gender'][$p['_gender']])) $s += 3;
    // With no kind named, a word of the product's own name IS the kind: "pink
    // sculpt" led with the pink Naples bra (colour 9 against name 4) and said
    // "Here is what I found:" over it. The Sculpt pieces lead now, and the
    // reply says the colour is the part that is missing (found_colour).
    $nameWeight = $q['type'] ? 4 : 10;
    foreach ($free as $w) if (assistant_word_hit($p['_tok'], $w)) $s += $nameWeight;
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
// Returns [reply, data, missed, asked] — `missed` is true when something the
// shopper asked for was not found, which is what decides the n8n handoff now
// that a miss can still come back with cards. `asked` is true when the text
// named anything search can read: a kind, a colour, a brand, who it is for, a
// budget or size, "sportswear", or any other word — found or not. A greeting
// is turned into a search on it (assistant_answer), so «مرحبا، عندكم احذية؟»
// hears "not carried" and «هلا، عندكم نايكي؟» reaches staff, exactly as they
// would without the hello.
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
    $filtered = $q['max'] !== null || $q['cheap'] || $q['size'] !== null;
    // "gym stuff", «ملابس جيم حلوه»: "sportswear" with words no product
    // carries is still a request for the shelf, not a failed search.
    if ($q['generic'] && !$named && !$filtered && !$q['unstocked'] && $free
        && !array_filter($free, fn ($w) => assistant_word_anywhere($cat, $w))) {
        $free = [];
    }
    $browse = !$named && !$free;
    $asked = !$browse || $filtered || $q['generic'];

    if ($browse && !$filtered) {
        // Only "sportswear" words: that is a request for the shelf.
        if ($q['generic']) {
            [$r, $d] = assistant_shelf_answer($db, $cfg, $cat, $q, [], $ar, false, false);
            return [$r, $d, false, true];
        }
        // Nothing searchable at all: honest ignorance, and staff are told.
        return [assistant_canned($cfg, 'no_idea', $ar), null, true, false];
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
            return [$d ? assistant_canned($cfg, 'not_carried', $ar) : $r, $d, true, $asked];
        }
        // Honest ignorance, not a shelf of unrelated guesses. "do you sell live
        // goldfish" should hear what the shop CAN help with.
        return [assistant_canned($cfg, 'no_idea', $ar), null, true, $asked];
    }

    usort($hits, fn ($a, $b) =>
        [$b[0], $b[1]['_in_stock'], $q['cheap'] ? $a[1]['_fils'] : 0, $b[1]['_sale'], (int) $b[1]['featured'],
         (int) $a[1]['featured_sort'], $a[1]['name_en']]
        <=>
        [$a[0], $a[1]['_in_stock'], $q['cheap'] ? $b[1]['_fils'] : 0, $a[1]['_sale'], (int) $a[1]['featured'],
         (int) $b[1]['featured_sort'], $b[1]['name_en']]);
    $rows = array_map(fn ($h) => $h[1], array_slice($hits, 0, 4));
    $payload = assistant_products_payload($db, $rows, $ar);

    // A word that names a product, as opposed to one the shop does not sell.
    $realFree = array_values(array_diff($free, $q['unstocked_words']));
    $hitTop = false;
    foreach ($realFree as $w) if (assistant_word_hit($rows[0]['_tok'], $w)) { $hitTop = true; break; }

    // A THING THE SHOP DOES NOT SELL, WITH A COLOUR, IS STILL NOT CARRIED.
    // "black shoes" found black T-shirts by the colour and said "Here is what
    // I found:" over them. When the only kind of thing named is unstocked and
    // nothing else asked for is on the top card, it is said plainly, over the
    // same cards — and staff hear about the miss.
    if ($q['unstocked'] && !$q['type'] && !$brands && !$hitTop) {
        return [assistant_canned($cfg, 'not_carried', $ar), $payload, true, $asked];
    }

    // "Here is what I found" is a claim, and each way it can be untrue has its
    // own sentence — the most specific first:
    //
    //   found_colour  «جاكيت سماوي», "yellow shorts": the kind is here, the
    //                 colour is not. Not "the closest pieces" — army green is
    //                 not close to sky blue; it is the same jacket in another
    //                 colour, and the sentence says exactly that.
    //   found_near    "leggings in XL" with no XL left: the closest pieces.
    //   found_other   "nike shorts", «تيشيرت الهلال»: a brand or team the shop
    //                 does not carry (assistant_other_brand_words), or the name
    //                 of one of the shop's own lines or brands that the top
    //                 card lacks ("sculpt shorts": Sculpt has no shorts) —
    //                 assistant_line_names. Both are provable. Any other
    //                 leftover word is not — the names record type and colour
    //                 only — so it stays 'found'.
    //
    // The colour and the other-word misses are MISSES: the demand ("Nike",
    // "yellow") is something the shop wants to hear about, and `missed` is
    // what sends it to n8n. "Here is what I found:" over non-Nike shorts used
    // to be missed=false, so nobody ever learned it was asked for.
    $colourMiss = $q['colour'] && !array_intersect_key($rows[0]['_colour'], $q['colour']);
    $otherMiss = assistant_has($q['t'], assistant_other_brand_words());
    foreach ($realFree as $w) {
        if (!$otherMiss && isset($cat['lines'][$w]) && !assistant_word_hit($rows[0]['_tok'], $w)
            && assistant_line_named($q, $w)) {
            $otherMiss = true;
        }
    }
    $key = $colourMiss ? 'found_colour' : ($relaxed ? 'found_near' : ($otherMiss ? 'found_other' : 'found'));
    return [assistant_canned($cfg, $key, $ar), $payload, $colourMiss || $otherMiss, $asked];
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
//
// NO MARKED-DOWN ITEM IS NOT "NO OFFER". An automatic discount rule takes money
// off at checkout (store_discounts_for) with no item marked down at all, and
// telling that customer there is nothing on offer is how they leave before
// checkout would have given it to them. So when an automatic rule is live it
// is said (offers_auto); otherwise no_offers says only what it proves — no
// item is marked down — and where a code goes, because a code from a promo
// bar or a message is the other kind of deal it cannot see.
function assistant_shelf_answer(PDO $db, array $cfg, array $cat, array $q, array $brands, bool $ar, bool $sale, bool $newest): array
{
    $key = null;
    $rows = $sale ? assistant_shelf($cat, $q, $brands, true, $newest) : [];
    if ($sale && !$rows) $key = assistant_auto_discount_live($db) ? 'offers_auto' : 'no_offers';
    if (!$rows) $rows = assistant_shelf($cat, $q, $brands, false, $newest);
    if (!$rows) return [assistant_canned($cfg, 'no_idea', $ar), null];
    $payload = assistant_products_payload($db, $rows, $ar);
    $key ??= in_array(true, array_column($payload['items'], 'sale'), true) ? 'recommend_sale' : 'recommend';
    return [assistant_canned($cfg, $key, $ar), $payload];
}

// Is an automatic discount rule taking money off orders right now? The same
// four tests store_discounts_for applies before it counts one (active, kind
// auto, inside its window, uses left). Its minimum order and category are not
// knowable without a cart, which is why offers_auto says "when your order
// qualifies". False when the table cannot be read: a shop without the promo
// SQL has no rules, and the sentence is then the no_offers one, which is true.
function assistant_auto_discount_live(PDO $db): bool
{
    try {
        foreach ($db->query("select starts_at, ends_at, usage_limit, used_count from discounts
                              where kind = 'auto' and active = 1")->fetchAll() as $d) {
            if (function_exists('store_window_open') && !store_window_open($d['starts_at'], $d['ends_at'])) continue;
            if ((int) $d['usage_limit'] > 0 && (int) $d['used_count'] >= (int) $d['usage_limit']) continue;
            return true;
        }
    } catch (Throwable $e) {
        return false;
    }
    return false;
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
    // A COUPON QUESTION GETS A COUPON ANSWER. «عندي كوبون» and "do you have a
    // discount code" were answered with four tank tops: the one with a code was
    // not told where it goes, the one without was not told there is none to
    // give. No cards — a shelf is not what was asked. "At checkout" and no
    // more: the live storefront is a build this repo does not have, so the
    // field's label is not something this sentence can promise.
    if (assistant_has($t, ['code', 'codes', 'coupon*', 'voucher*', 'promocode', 'كود', 'كوبون', 'قسيمه'])) {
        return [assistant_canned($cfg, 'coupon', $ar), null];
    }
    // The router's own list (assistant_sale_words), so a question it sends
    // here as a sale question is read here as one. "when will it be cheaper"
    // is one too.
    $sale = assistant_has($t, assistant_sale_words()) || assistant_has($t, ['cheaper']);
    $newest = assistant_has($t, ['new arrival*', "what's new", 'whats new', 'what is new', 'anything new', 'new items',
                                 'new item', 'new stuff', 'new collection', 'new in', 'latest', 'newest', 'new models',
                                 'new model', 'new designs', 'new design', 'new styles', 'new style', 'new products',
                                 'new product', 'new pieces', 'trending', 'شنو الجديد', 'وش الجديد', 'ايش الجديد',
                                 'الجديد عندكم', 'شي جديد', 'جديدكم', 'وصل جديد', '^جديد', '^الجديد', '^جديده', '^الجديده',
                                 '^جديدين']);
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
        // «إتمام الطلب», the name every other line gives checkout.
        return $ar ? 'تظهر طرق الدفع المتاحة لطلبك عند إتمام الطلب قبل تأكيده. اختر إحدى الطرق المعروضة هناك.'
                   : 'The payment methods currently available for your order are shown at checkout before you confirm it. Choose one of the options shown there.';
    }
    $names = ['knet' => ['بكي نت', 'by KNET'], 'tpay' => ['إلكترونيًا عبر تي-باي', 'online with T-Pay'],
              'cod' => ['نقدًا عند الاستلام', 'cash on delivery']];
    $list = [];
    foreach ((array) ($c['methods'] ?? []) as $m) if (isset($names[$m])) $list[] = $names[$m][$ar ? 0 : 1];
    if (!$list) {
        return $ar ? 'الدفع غير متاح في الموقع الآن. راسلنا على واتساب ' . "\u{200E}" . $phone . ' ونساعدك.'
                   : 'Payment is not available on the site right now. Message us on WhatsApp ' . $phone . ' and we will help.';
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
            //
            // The exception in the SAME sentence as the promise, saying what is
            // still allowed (a return), rather than a promise of "return or
            // exchange" taken back one sentence later. The phone sits in its
            // own sentence: Arabic-Indic ١٤ and the Western-digit number never
            // share one (the rule test:arabic holds translations.js to, and
            // assistant-test holds these lines to).
            'ar' => 'الإرجاع والاستبدال مجانيان خلال ١٤ يومًا من الاستلام إذا كانت القطعة غير ملبوسة وبطاقاتها عليها، أما الملابس النسائية فإرجاع فقط. ابدأ من صفحة الإرجاع برقم طلبك ورقم الهاتف المسجّل فيه، أو راسلنا على واتساب ' . $phoneRtl . '.',
            // "the phone NUMBER on the order": "the phone" alone reads as the
            // handset. And the exception says what IS allowed, in full words.
            'en' => 'Returns and exchanges are free within 14 days of delivery if the item is unworn with its tags; women\'s clothing can be returned but not exchanged. Start on our Returns page with your order number and the phone number on the order, or WhatsApp us on ' . $phone . '.',
        ],
        'payment' => [
            'ar' => assistant_payment_line($cfg['_checkout'] ?? null, true, $phone),
            'en' => assistant_payment_line($cfg['_checkout'] ?? null, false, $phone),
        ],
        'sizes' => [
            // The size guide's own advice, unconditionally: it says take the
            // larger one, not "for the oversized fits". And only items that
            // come in sizes have a guide — a backpack does not.
            'ar' => 'تجد دليل المقاسات في صفحة كل قطعة لها مقاسات. إذا كنت بين مقاسين ننصح بالمقاس الأكبر، وإذا احترت راسلنا على واتساب ' . $phoneRtl . '.',
            'en' => 'Every item that comes in sizes has a size guide on its page. If you are between two sizes, we recommend the larger one — and if you are unsure, message us on WhatsApp ' . $phone . '.',
        ],
        'contact' => [
            'ar' => 'يسعدنا خدمتك عبر واتساب أو الاتصال على ' . $phoneRtl . '، أو عبر البريد ' . $email,
            'en' => 'We are happy to help on WhatsApp or by phone at ' . $phone . ', or by email at ' . $email,
        ],
        // THE KINDS OF `contact` THAT ARE NOT "WE ARE HAPPY TO HELP". A
        // double charge opened with «يسعدنا خدمتك» reads as not having heard
        // it. Each is still handed to a person (assistant_route's topic), and
        // each says what to bring, so the first WhatsApp message can be acted on.
        //
        // TRUE EITHER WAY. The money line used to open «نعتذر عن هذا» and was,
        // for a while, said to "what if my payment fails?" — an apology for
        // something that had not happened. Routing no longer sends those here,
        // and the line no longer assumes: IF money went wrong, this is the way.
        'money' => [
            'ar' => 'إذا انخصم منك مبلغ بالغلط أو صار خطأ في الدفع، راسلنا على واتساب ' . $phoneRtl . ' ومعك رقم الطلب، ونراجع الدفع.',
            'en' => 'If money was taken by mistake or a payment went wrong, WhatsApp us on ' . $phone . ' with your order number and we will check the payment.',
        ],
        // "If you have one" and "a photo OR SCREENSHOT of the problem": the
        // line asked for "a photo of what arrived" of people whose parcel had
        // not, and routing still cannot be sure every complaint is a parcel.
        'complaint' => [
            'ar' => 'نعتذر عن هذا. راسلنا على واتساب ' . $phoneRtl . ' ومعك رقم الطلب إذا عندك، وصورة توضّح المشكلة، ونساعدك.',
            'en' => 'Sorry about that. WhatsApp us on ' . $phone . ' with your order number if you have one and a photo or screenshot of the problem, and we will help.',
        ],
        // An order that will not go through: what to send so staff can place it.
        // No apology, because "can I order on WhatsApp" lands here too.
        'checkout_problem' => [
            'ar' => 'راسلنا على واتساب ' . $phoneRtl . ' واكتب لنا القطع والمقاسات اللي تبيها، ونساعدك تكمّل طلبك.',
            'en' => 'WhatsApp us on ' . $phone . ' with the items and sizes you want, and we will help you complete your order.',
        ],
        // The website itself: a screenshot, and no order number it may not have.
        'site_problem' => [
            'ar' => 'نعتذر عن هذا. راسلنا على واتساب ' . $phoneRtl . ' ومعك صورة للشاشة إذا تقدر، ونساعدك.',
            'en' => 'Sorry about that. WhatsApp us on ' . $phone . ' with a screenshot if you can, and we will help.',
        ],
        // A courier who never came, never called or was rude. (A courier who
        // took too much is 'money'.)
        'courier' => [
            'ar' => 'نعتذر عن هذا. راسلنا على واتساب ' . $phoneRtl . ' ومعك رقم الطلب، ونتابع الموضوع مع المندوب.',
            'en' => 'Sorry about that. WhatsApp us on ' . $phone . ' with your order number and we will follow it up with the courier.',
        ],
        // ROUND FOUR: the kinds of `contact` for a parcel that did not come, a
        // refund being waited for, a change to an order, a restock question and a
        // customer without the order number. Each is handed to a person, and each
        // says what to bring so the first WhatsApp message can be acted on.
        // No promise of a time: nothing here knows one.
        'not_received' => [
            'ar' => 'نعتذر عن هذا. راسلنا على واتساب ' . $phoneRtl . ' ومعك رقم الطلب، ونتحقق من الشحنة مع المندوب.',
            'en' => 'Sorry about that. WhatsApp us on ' . $phone . ' with your order number and we will check the parcel with the courier.',
        ],
        'refund' => [
            'ar' => 'نعتذر عن التأخير. راسلنا على واتساب ' . $phoneRtl . ' ومعك رقم الطلب، ونتحقق من حالة استرداد مبلغك.',
            'en' => 'Sorry for the wait. WhatsApp us on ' . $phone . ' with your order number and we will check on your refund.',
        ],
        'order_change' => [
            'ar' => 'راسلنا على واتساب ' . $phoneRtl . ' مع رقم الطلب والتعديل الذي تريده، ونرى ما نستطيع فعله.',
            'en' => 'WhatsApp us on ' . $phone . ' with your order number and what you would like changed, and we will see what we can do.',
        ],
        'restock' => [
            'ar' => 'لا أستطيع معرفة موعد توفر القطعة من هنا. راسلنا على واتساب ' . $phoneRtl . ' واكتب لنا القطعة والمقاس، ونخبرك إن كانت ستتوفر.',
            'en' => 'I cannot see restock dates from here. WhatsApp us on ' . $phone . ' with the item and the size, and we will tell you if it is coming back.',
        ],
        // ROUND FIVE: stopping messages, or seeing / correcting / deleting what the shop holds. The Privacy
        // page (section 6, "Your choices") says to write on WhatsApp or by email, so this line says the same
        // and nothing more: no promise of a time, no claim that it has been done.
        'privacy_request' => [
            'ar' => 'لإيقاف رسائلنا، أو لمعرفة ما نحتفظ به عنك أو تصحيحه أو حذفه، راسلنا على واتساب ' . $phoneRtl . ' أو بالبريد ' . $email . ' وسنرد عليك.',
            'en' => 'To stop our messages, or to see, correct or delete what we hold about you, WhatsApp us on ' . $phone . ' or email ' . $email . ' and we will respond.',
        ],
        'no_number' => [
            'ar' => 'لا مشكلة. راسلنا على واتساب ' . $phoneRtl . ' مع رقم الهاتف الذي طلبت به، ونبحث عن طلبك.',
            'en' => 'No problem. WhatsApp us on ' . $phone . ' with the phone number you ordered with and we will find your order.',
        ],
        // The two reasons a code is refused at checkout (store_discounts_for:
        // its window, its minimum order), said as possibilities, not as a
        // diagnosis nothing here has made.
        'coupon_problem' => [
            'ar' => 'نعتذر إن الكود ما اشتغل. أحيانًا يكون منتهيًا أو له حد أدنى للطلب. راسلنا على واتساب ' . $phoneRtl . ' ومعك الكود ونشيّك عليه.',
            'en' => 'Sorry the code did not work. Sometimes a code has expired or needs a minimum order. WhatsApp us on ' . $phone . ' with the code and we will check it.',
        ],
        // WHAT THE SHOP CAN HONESTLY PROMISE ABOUT CANCELLING. There is no
        // self-service cancel button, and inventing one would send the customer
        // hunting for a control that does not exist. So it says the true thing:
        // be quick, reach a human, and if it has already gone out, the published
        // route — a return within 14 days — is the way. It used to add "refuse
        // it at the door", which no policy page says.
        'cancel' => [
            // «كلّمنا أو راسلنا واتساب», not the calque «تواصل معنا باتصال أو
            // واتساب» ("contact us by call or WhatsApp").
            // The return it points to carries its condition, as returns does.
            'ar' => 'نقدر نلغي الطلب قبل ما يطلع مع المندوب. كلّمنا أو راسلنا واتساب على ' . $phoneRtl
                  . ' فورًا ومعك رقم الطلب. وإذا كان طلع للتوصيل، تقدر ترجع القطع غير الملبوسة وبطاقاتها عليها خلال ١٤ يومًا من الاستلام.',
            'en' => 'We can cancel an order before it leaves with the courier. Call or WhatsApp us right away on ' . $phone
                  . ' with your order number. If it has already gone out for delivery, you can return it within 14 days of delivery as long as it is unworn with its tags.',
        ],
        // ONLINE ONLY, SAID PLAINLY. There is no branch, and a shop that will
        // not say where it is reads as one with something to hide.
        'location' => [
            // ٢٤ and the phone number in separate sentences, as in returns.
            // "For confirmed orders", as delivery and ask_track_eta say it.
            'ar' => 'سبورتا متجر إلكتروني، ما عندنا فرع تزوره. نوصّل لجميع مناطق الكويت خلال ٢٤ ساعة للطلبات المؤكدة. وتقدر تتواصل معنا على '
                  . $phoneRtl . ' أو ' . $email,
            'en' => 'Sporta is an online shop — there is no branch to visit. We deliver to every area in Kuwait within 24 hours for confirmed orders, and you can reach us on '
                  . $phone . ' or ' . $email,
        ],
        // One voice per reply: it used to open in Gulf first person and close
        // in formal MSA with a calque («يومًا سعيدًا من سبورتا»).
        'thanks' => [
            'ar' => 'العفو، وأنا هني إذا احتجت أي شي ثاني.',
            'en' => 'Happy to help. I am here if you need anything else.',
        ],
        // «العفو» is the answer to THANKS. To «مع السلامة» Kuwait says «الله
        // يسلمك», and to «اوكي» / «تمام» something like «حاضرين».
        'bye' => [
            'ar' => 'الله يسلمك، وأنا هني إذا احتجت أي شي ثاني.',
            'en' => 'Take care. I am here if you need anything else.',
        ],
        'ack' => [
            'ar' => 'حاضرين، وأنا هني إذا احتجت أي شي ثاني.',
            'en' => 'Great. I am here if you need anything else.',
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
        // The same request, for someone who says it did not come or is late: no
        // 24-hour promise (the hour has passed), and a way out if there is no number.
        'ask_track_missing' => [
            'ar' => 'أرسل لي رقم الطلب (يبدأ بـ SP) وسأتحقق من حالته فورًا. وإن لم يكن معك، راسلنا على واتساب ' . $phoneRtl . ' مع رقم الهاتف المسجّل في الطلب.',
            'en' => 'Send me your order number (it starts with SP) and I will check it right away. If you do not have it, WhatsApp us on ' . $phone . ' with the phone number on the order.',
        ],
        // An order past its promise: neither "within 24 hours" nor "on its way".
        'stage_late' => [
            'ar' => 'طلبك تأخر أكثر مما نتوقع. راسلنا على واتساب ' . $phoneRtl . ' مع رقم الطلب ونتابعه فورًا.',
            'en' => 'Your order is taking longer than we expect. WhatsApp us on ' . $phone . ' with the order number and we will chase it up.',
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
        // The moment the return window starts, so it says how to use it — with
        // the condition and the exception IN the promise, as returns has them.
        // It promised an exchange for every delivered order, women's leggings
        // included, which the shop refuses at pickup.
        // «ما عدا … فإرجاع فقط», the shape returns has: «الاستبدال متاح إلا
        // للملابس النسائية» excepted from nothing, and gave the exchange no
        // window or condition.
        'stage_delivered' => [
            'ar' => 'تم تسليم هذا الطلب. لديك ١٤ يومًا من الاستلام لإرجاع أو استبدال أي قطعة غير ملبوسة وبطاقاتها عليها، ما عدا الملابس النسائية فإرجاع فقط. ابدأ من صفحة الإرجاع.',
            'en' => 'This order has been delivered. You have 14 days from delivery to return an unworn item with its tags, or to exchange it — women\'s clothing can be returned but not exchanged. Start on our Returns page.',
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
        // THE SEARCH FAMILY SPEAKS ONE REGISTER — Kuwaiti, like no_idea, which
        // sits beside them in the same conversation. 'found' was formal
        // («وجدت هذه المنتجات») while its siblings were Gulf, so one search
        // answered in two voices.
        'found' => [
            'ar' => 'لقيت لك هذي القطع:',
            'en' => 'Here is what I found:',
        ],
        // Not «طلبك» here either, for the same reason as no_idea. The three
        // near-misses each say which part was missing (assistant_search).
        // Size only: a missing colour is found_colour, and "closest" was untrue
        // of four other-coloured jackets.
        'found_near' => [
            'ar' => 'ما لقيت المقاس اللي طلبته متوفر، وهذي أقرب القطع عندنا:',
            'en' => 'I could not find that size in stock, so here are the closest pieces we have:',
        ],
        // "That IN this colour", not "this colour": a pink bra is in stock, so
        // «ما عندنا هذا اللون» was untrue of "pink jacket" — and "the same
        // pieces" was untrue of "yellow for men", which named no piece.
        'found_colour' => [
            'ar' => 'ما عندنا اللي تبيه بهذا اللون حاليًا، وهذي ألوان ثانية:',
            'en' => 'We do not have that in this colour right now; here are other colours:',
        ],
        'found_other' => [
            'ar' => 'ما عندنا اللي طلبته بالضبط، بس هذي قطع من نفس النوع:',
            'en' => 'We do not have exactly that, but here are pieces of the same kind:',
        ],
        // «للأسف ما عندنا هذا النوع» — NEGATION FIRST, unmistakably. «هذا ما
        // عندنا حاليًا» reads first as "THIS IS what we have", right above four
        // unrelated cards.
        'not_carried' => [
            'ar' => 'للأسف ما عندنا هذا النوع حاليًا، بس هذي قطع من تشكيلتنا ممكن تعجبك:',
            'en' => 'Sorry, we do not carry that right now, but here are a few pieces you might like:',
        ],
        // Each says only what the shelf query proves. "Most popular" is not
        // one of those things: nothing here reads sales.
        //
        // NO FIRST-PERSON PROMISE TO CHECK OUT. "I will take you through
        // checkout" is a control the assistant does not have, on the path that
        // leads to buying: «كمل الطلب» was then answered «ما لقيت شي». The bag
        // is the site's, and is where checkout starts.
        'recommend' => [
            'ar' => 'هذي مختارات من تشكيلتنا. أضف اللي يعجبك للسلة وكمّل الطلب من صفحة السلة.',
            'en' => 'Here are a few picks from our range. Add what you like to your bag and check out from there.',
        ],
        'recommend_sale' => [
            'ar' => 'هذي مختارات من تشكيلتنا، وبعضها عليه عرض الحين. أضف اللي يعجبك للسلة وكمّل الطلب من صفحة السلة.',
            'en' => 'Here are a few picks from our range, some of them on offer right now. Add what you like to your bag and check out from there.',
        ],
        // About marked-down ITEMS only, which the query proves, and said only
        // when no automatic rule is live (assistant_auto_discount_live). Not
        // "no offers": a code is a deal too, and nothing here can see one.
        'no_offers' => [
            'ar' => 'ما فيه قطع عليها تخفيض الحين، وإذا عندك كود خصم تقدر تكتبه عند إتمام الطلب. هذي مختارات من تشكيلتنا.',
            'en' => 'Nothing is marked down right now, and if you have a discount code you can enter it at checkout. Here are a few picks from our range.',
        ],
        // An automatic rule is live. Its minimum order and category need a
        // cart to check, hence "when your order qualifies".
        'offers_auto' => [
            'ar' => 'فيه خصم تلقائي الحين، وينحسب لك عند إتمام الطلب إذا انطبقت شروطه على طلبك. هذي مختارات من تشكيلتنا.',
            'en' => 'There is an automatic discount on right now, taken off at checkout when your order qualifies. Here are a few picks from our range.',
        ],
        // A coupon question (assistant_recommend). "At checkout", not a named
        // field: the live checkout is a build this repo does not have. The live
        // API takes a discount_code with the order, so the field is likely
        // there — and if it is not, or the code is refused, the WhatsApp route
        // still holds. THE OWNER SHOULD CONFIRM the live checkout has a code
        // box before this ships (SPORTA-AI-VOICE.md).
        'coupon' => [
            'ar' => 'ما أقدر أعطيك كود خصم من هني. إذا عندك كود، تقدر تكتبه عند إتمام الطلب، وإذا ما اشتغل راسلنا على واتساب ' . $phoneRtl . '.',
            'en' => 'I cannot give out discount codes here. If you have one, you can enter it at checkout, and if it does not work, WhatsApp us on ' . $phone . '.',
        ],
        // "Take me to checkout": where it is, and nothing the widget may not
        // have. (in_cart, "Added to your bag … shall we check out?", is gone:
        // nothing ever said it, the warmer bought audio for it, and it invited
        // exactly the reply that had no answer.)
        // Both halves are verbs, and no button is named: the live storefront
        // is a build this repo does not have, so its labels are not ours to
        // promise. "How do I order" and "take me to checkout" both land here.
        'checkout' => [
            'ar' => 'أضف القطع اللي تبيها للسلة، وبعدين كمّل طلبك من السلة.',
            'en' => 'Add the pieces you want to your bag, then complete your order from the bag.',
        ],
    ];

    return $t[$intent][$ar ? 'ar' : 'en'] ?? null;
}

// Every key of the table above, in the order the warmer buys them.
function assistant_canned_keys(): array
{
    return ['delivery', 'returns', 'payment', 'sizes', 'contact', 'money', 'complaint', 'coupon_problem',
            'checkout_problem', 'site_problem', 'courier',
            'cancel', 'location', 'thanks', 'bye', 'ack', 'greeting', 'ask_track', 'ask_track_eta',
            'stage_received', 'stage_packing', 'stage_shipped', 'stage_delivered', 'stage_unpaid',
            'stage_cancelled', 'no_order', 'no_idea', 'found', 'found_near', 'found_colour', 'found_other',
            'not_carried', 'recommend', 'recommend_sale', 'no_offers', 'offers_auto', 'coupon', 'checkout',
            'not_received', 'refund', 'order_change', 'restock', 'no_number', 'stage_late', 'ask_track_missing', 'privacy_request'];
}

// A connection for the warmer, or null — never store_db()'s exit. The same
// DSN and options store_db() uses, with a short connect timeout so a
// database that is down costs the warmer three seconds, not a minute.
function assistant_db_or_null(array $cfg): ?PDO
{
    if ((string) ($cfg['db_name'] ?? '') === '') return null;
    try {
        return new PDO(
            'mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
            (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
             PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 3]
        );
    } catch (Throwable $e) {
        return null;
    }
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
//
// A DATABASE THAT IS DOWN DOES NOT STOP THE WARMER. store_db() answers a
// failed connection with store_out(500) — an exit no try/catch can see — so
// the warmer and its status page used to die on a DB outage although only
// two of the lines read a setting. assistant_db_or_null() connects without
// that exit; with no database the two lines take their defaults (the 1 KWD
// fee, the "shown at checkout" payment sentence) and the rest warm as usual.
function assistant_canned_lines(array $cfg, ?PDO $db = null): array
{
    if (!array_key_exists('_checkout', $cfg)) {
        $db ??= assistant_db_or_null($cfg);
        $cfg['_checkout'] = $db !== null ? assistant_checkout_facts($db) : null;
    }
    $keys = assistant_canned_keys();
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
// NO SENTENCE COUNT. "Two sentences at most" told the model to squeeze the
// returns answer — four conditions, an exception for women's clothing — into
// two, and the easy way to do that is to drop the exception. assistant_llm_
// accept only refuses ADDED numbers and addresses, so "free returns within 14
// days" with no exception would have passed: a promise the shop refuses at
// pickup. The model is told to keep every condition, and no longer than the
// shop's own answer, instead.
//
// Haiku 5.5 thinks by default and its first content block can be a thinking
// block; thinking off and low effort keep a rewording inside the 6 s timeout
// and ASSISTANT_LLM_MAX_TOKENS. Sent ONLY to that family: other models the
// owner might configure reject one or both fields with a 400.
//
// The token budget fits the longest bubble the model may be asked to reword
// (ASSISTANT_LLM_MAX_CHARS) in Arabic, which costs more tokens per character
// than English; a reply cut off at the budget is discarded, not shown.
const ASSISTANT_LLM_MAX_TOKENS = 600;
function assistant_llm_request(array $cfg, string $message, string $reply, ?array $data, bool $ar): array
{
    $json = $data ? (string) json_encode($data, JSON_UNESCAPED_UNICODE) : '';
    // THE REGISTER, NAMED. "Reply in Arabic" let the model pick one, so with
    // a key configured the found / found_near / not_carried family — Kuwaiti
    // on purpose, like no_idea beside it — came back in whatever voice it chose.
    // "The SHOP ANSWER's register", not "Kuwaiti": the order-stage lines are
    // plain formal Arabic, and the prompt said otherwise of them.
    $system = ($ar ? 'Reply in Arabic. Keep the register of the SHOP ANSWER (Kuwaiti/Gulf where it is Gulf, plain formal Arabic where it is formal). '
                   : 'Reply in English. ')
        . 'You are the assistant for Sporta, a sportswear shop in Kuwait. Reword the SHOP ANSWER for the customer. '
        . 'Keep every number, price, phone number, email address and order number exactly as written. '
        . 'Never add a status, price, fee, discount, date, stock level or promise of follow-up. '
        . 'If the customer asks for anything the SHOP ANSWER does not cover, output the SHOP ANSWER unchanged. '
        . 'Keep every condition of the SHOP ANSWER — who and what it applies to, every exception, every number — '
        . 'and do not make it longer than the SHOP ANSWER.'
        . "\n\nSHOP ANSWER:\n" . $reply
        . ($json !== '' ? "\n\nDATA (reference only; never output JSON):\n" . $json : '');
    $model = (string) ($cfg['ai_model'] ?? 'claude-haiku-5-5');
    $req = ['model' => $model, 'max_tokens' => ASSISTANT_LLM_MAX_TOKENS, 'system' => $system,
            'messages' => [['role' => 'user', 'content' => $message]]];
    if (str_starts_with($model, 'claude-haiku-5')) {
        $req['thinking'] = ['type' => 'disabled'];
        $req['output_config'] = ['effort' => 'low'];
    }
    return $req;
}

// The longest reply the model may send. ABOVE the longest fixed sentence in
// either language (returns: about 260 characters in English, 230 in Arabic)
// with room for a rewording to say it more warmly — and the test measures
// that it stays so. 400 was set when a two-sentence rule kept replies short;
// it still fits.
const ASSISTANT_LLM_MAX_CHARS = 400;

// The model's text, or null — and null whenever it is anything but a
// rewording of what the shop already said. A cut-off reply (max_tokens), a
// refusal, an over-long bubble, or ANY number, SP order number, link or email
// address that is not in the shop's own answer and data sends the
// deterministic reply instead. Numbers are compared as whole tokens, so an
// invented "4" does not pass on the "24" in the facts; the SP pattern is
// case-sensitive and needs a digit, so "Sporta" is not an order number.
//
// AND IN THE OTHER DIRECTION. It only refused what the model ADDED, so the
// contact answer with its direction mark dropped (which shows «22091914 965+»
// in the RTL bubble) passed, and so did «الإرجاع مجاني خلال 14 يومًا» — the
// returns answer with the unworn/tags condition and the women's-clothing
// exception gone, in Western digits. "Keep every condition" was a request.
// Now it is checked:
//   * every number, phone, email and SP number the shop said is still there;
//   * every condition word the shop said is still there (women's clothing,
//     unworn, tags, "confirmed orders");
//   * in Arabic, Western digits only where the shop wrote them (the phone),
//     and the phone's left-to-right mark is put back if it was dropped;
//   * no longer than 1.3× the shop's own sentence.
//
// AND WHAT THE WORDS MEAN, as far as words can show it. Presence was not
// enough: «تقدر ترجع القطعة الملبوسة … والاستبدال للملابس النسائية فقط»
// kept "women's clothing" and «ملبوس» and inverted both; "Returns are not
// free", "Your order has shipped and arrives today", "Everything is free
// today!" all passed. So:
//   * the condition phrases are matched whole — «غير ملبوس», «فإرجاع فقط»,
//     "returned but not exchanged" — not their nouns;
//   * a phone in the shop's answer must come back exactly, «‎+965 …» in
//     Arabic, so «965 22091914» (which reads «22091914 965» in the bubble) is
//     refused;
//   * a word that changes a promise — not, free, today, half, %, shipped,
//     only, without … — may not appear more often than the shop said it.
// The first line of defence is that policy lines are never sent at all
// (assistant_llm_rewordable); this is the second.
function assistant_llm_accept(?array $j, string $reply, ?array $data, bool $ar = false): ?string
{
    if ($j === null || ($j['stop_reason'] ?? '') !== 'end_turn') return null;
    $out = '';
    foreach ((array) ($j['content'] ?? []) as $b) {
        if (is_array($b) && ($b['type'] ?? '') === 'text') { $out = trim((string) ($b['text'] ?? '')); break; }
    }
    if ($out === '' || mb_strlen($out) > ASSISTANT_LLM_MAX_CHARS) return null;
    $tok = function (string $s): array {
        $s = strtr($s, ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
                        '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9','٫'=>'.']);
        preg_match_all('/\d+(?:\.\d+)?|(?<![A-Za-z0-9])SP(?=[A-Z0-9]*\d)[A-Z0-9]{4,}|https?:\/\/\S+|www\.\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/u', $s, $m);
        return array_map(fn ($x) => rtrim($x, '.,'), $m[0]);
    };
    $allowed = $tok($reply . ' ' . ($data ? (string) json_encode($data, JSON_UNESCAPED_UNICODE) : ''));
    $got = $tok($out);
    foreach ($got as $t) if (!in_array($t, $allowed, true)) return null;
    foreach ($tok($reply) as $t) if (!in_array($t, $got, true)) return null;
    if (mb_strlen($out) > (int) ceil(mb_strlen($reply) * 1.3)) return null;
    $nr = assistant_normalise($reply);
    $no = assistant_normalise($out);
    foreach (['women', 'unworn', 'tag', 'confirmed', 'returned but not exchanged', 'within 14 days', 'النسائية',
              'غير ملبوس', 'فإرجاع فقط', 'بطاقات', 'المؤكدة'] as $w) {
        $w = assistant_normalise($w);
        if (str_contains($nr, $w) && !str_contains($no, $w)) return null;
    }
    // Words that change a promise: no more of them than the shop said. English
    // as whole words; Arabic of four letters or more as a piece of a word
    // («مجان» is in مجاني, مجانًا, مجانيان), shorter Arabic as a whole word
    // after an optional و/ف/ب/ال («بس» is inside «ملابس»).
    $count = function (string $hay, string $w): int {
        if ($w === "n't") return substr_count($hay, $w);
        if (preg_match('/^[a-z\' ]+$/', $w)) {
            return preg_match_all('/(?<![a-z0-9])' . preg_quote($w, '/') . '(?![a-z0-9])/u', $hay);
        }
        if (mb_strlen($w) >= 4) return mb_substr_count($hay, $w);
        return preg_match_all('/(?<![\p{L}\p{N}])(?:[وفب]|ال|وال|بال)?' . preg_quote($w, '/') . '(?![\p{L}\p{N}])/u', $hay);
    };
    foreach (['not', "n't", 'no', 'never', 'free', 'today', 'tomorrow', 'half', 'shipped', 'only', 'except',
              'without', 'worn', 'optional', 'guarantee', 'guaranteed', 'same day', 'غير', 'مجان', 'اليوم', 'بكره',
              'نص', 'نصف', 'فقط', 'بس', 'بدون', 'الا', 'ما عدا', 'ملبوس', 'شحن', 'انشحن'] as $w) {
        $w = assistant_normalise($w);
        if ($count($no, $w) > $count($nr, $w)) return null;
    }
    // A NEGATION THE SHOP SAID MAY NOT DISAPPEAR. The loop above stops a "not" from
    // being ADDED; this stops one from being DROPPED, which is the same lie the
    // other way round. Counted across the English and Arabic negations together,
    // so "could not find" may become "isn't in stock" but not "is in stock".
    $negs = fn (string $h) => array_sum(array_map(fn ($w) => $count($h, assistant_normalise($w)),
        ['not', "n't", 'no', 'never', 'cannot', 'ما', 'لا', 'لم', 'لن', 'للاسف', 'بدون']));
    if ($negs($nr) > $negs($no)) return null;
    if (substr_count($out, '%') + substr_count($out, '٪') > substr_count($reply, '%') + substr_count($reply, '٪')) return null;
    if ($ar) {
        // Western digit runs only where the shop's Arabic has them.
        preg_match_all('/[0-9]+/', $reply, $rm);
        preg_match_all('/[0-9]+/', $out, $om);
        foreach ($om[0] as $d) if (!in_array($d, $rm[0], true)) return null;
        // Two digit systems in one sentence is the mix test:arabic forbids.
        foreach (preg_split('/(?<=[.!؟?])\s+/u', $out) ?: [] as $sentence) {
            if (preg_match('/[٠-٩]/u', $sentence) && preg_match('/[0-9]/', $sentence)) return null;
        }
        $out = preg_replace('/(?<!\x{200E})\+(?=\d)/u', "\u{200E}+", $out) ?? $out;
    }
    // The phone exactly as the shop wrote it, mark and all.
    if (preg_match_all('/\x{200E}?\+\d[\d ]{5,}\d/u', $reply, $pm)) {
        foreach ($pm[0] as $phone) if (!str_contains($out, $phone)) return null;
    }
    return $out;
}

// WHICH ANSWERS A MODEL MAY REWORD AT ALL. Only the ones that carry no
// policy: what search found, the shelf, a hello, a thank-you, "nothing
// matched". Never returns, cancel, delivery, payment, an order's stage, the
// money, complaint and checkout lines, a coupon or an offer — each is a
// condition or a promise, and a rewording that keeps every word can still
// turn it round.
function assistant_llm_rewordable(array $cfg, string $reply, bool $ar): bool
{
    // NOT found_near / found_colour / found_other / not_carried / no_idea. Each is
    // a claim about STOCK made by its negation — "I could not find that size in
    // stock", "we do not carry that" — and a rewording that drops the "not" says
    // the opposite of what the database found ("Great news, those pieces are
    // available in that size") over cards that are not. They are the shop's
    // sentence or nothing. (assistant_llm_accept also refuses a lost negation, for
    // any line it is ever given.)
    foreach (['found', 'recommend', 'greeting', 'thanks', 'bye', 'ack'] as $k) {
        if (assistant_canned($cfg, $k, $ar) === $reply) return true;
    }
    return false;
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
    return assistant_llm_accept(is_array($j) ? $j : null, $reply, $data, $ar);
}

// ------------------------------------------------------------------- the ask

// What is left of a greeting once the greeting is taken out — so "صباح
// الخير، عندكم ليقنز؟" can be seen to be a leggings question.
function assistant_after_greeting(string $t): string
{
    static $res = null;
    if ($res === null) {
        $res = [];
        // What else a hello is made of. Every word left over is now SEARCHED
        // (assistant_answer), so the courtesies have to be here, or «مرحبا،
        // شلون الحال؟» would be answered as a failed search for «الحال».
        $fill = ['عليكم', 'ورحمه الله', 'وبركاته', 'الخير', 'النور', 'والله', 'يا', 'عندي سؤال', 'سؤال', 'ممكن',
                 'مساعده', 'ساعدني', 'سبورتا', 'وسهلين', 'وسهلا', 'سهلا', 'حياك', 'حياكم', 'الحال', 'الاحوال',
                 'عساك', 'عساكم', 'بخير', 'طيبين', 'الغالي', 'يالغالي', 'طال عمرك', 'الله', 'اخباركم', 'اخبارك',
                 'استفسار', 'استفسر', 'اسالك', 'اسال', 'تساعدني', 'تساعدوني', 'احتاج', 'موجود', 'موجودين', 'احد',
                 'وغلا', 'بالغالي', 'بالحبايب', 'فيك', 'فيكم', 'حالكم', 'بسيط',
                 'there', 'all', 'team', 'i need help', 'need help', 'help', 'doing', 'today', 'hope', 'well',
                 'dear', 'sir', 'madam', 'again', 'i have a question', 'question', 'please', 'pls', 'sporta',
                 'quick', 'inquiry', 'enquiry', 'assistance', 'available', 'alaikum', 'alikum', 'alaykum', 'anyone',
                 'wallah'];
        $addr = assistant_address_words();
        foreach (array_merge(assistant_greeting_words(), $fill, $addr) as $g) {
            $open = $g[0] === '^' && !str_ends_with($g, '$');
            $isAddr = in_array($g, $addr, true);
            $g = assistant_normalise(trim($g, '^$*'));
            if ($g === '') continue;
            // «^مرحب» is a word START, so it takes the rest of the word with it.
            // A form of address is not one after "for": "anything for a man",
            // «حق الشباب» name who it is FOR, and that is search's to read.
            $res[] = '/(?<![\p{L}\p{N}])' . ($isAddr ? '(?<!for )(?<!for a )(?<!for my )(?<!حق )' : '')
                   . preg_quote($g, '/') . ($open ? '\p{L}*' : '(?![\p{L}\p{N}])') . '/u';
        }
    }
    return trim(preg_replace($res, ' ', $t) ?? $t);
}

// DOES WHAT A GREETING LEAVES ASK FOR ANYTHING? Round two searched whatever
// was left and answered the search whenever it "named anything" — including
// a word that hits nothing — so «مرحبا عندي استفسار», «هلا وغلا», "hi, I have
// an inquiry" and 21 more of 55 ordinary openers were told «ما لقيت شي يطابق
// كلامك في المتجر» and logged as failed searches. The remainder is a question
// only when it names something search reads: a kind of garment, a colour, a
// brand (carried or not), the name of one of the shop's lines, something the shop does
// not sell, "sportswear", a budget, a size — or who it is for when that is
// plainly a target ("for my wife", «للبنات», «حق الرجال») rather than a form of
// address («هلا شباب», which assistant_after_greeting has already taken out).
function assistant_greeting_asks(PDO $db, string $rest): bool
{
    $q = assistant_query($rest);
    if ($q['type'] || $q['colour'] || $q['unstocked'] || $q['generic'] || $q['size'] !== null || $q['max'] !== null
        || $q['cheap'] || assistant_has($q['t'], assistant_other_brand_words())) {
        return true;
    }
    $cat = assistant_catalogue($db);
    [$brands, $free] = assistant_split_brands($q, $cat);
    if ($brands) return true;
    // A line or brand of the shop's own ("hi, sculpt?") — not any word of any
    // name: «هلا، ما ظهر لي شي» is not a question about the backpack «حقيبة ظهر».
    foreach ($free as $w) if (isset($cat['lines'][$w])) return true;
    if (!$q['gender']) return false;
    $words = preg_split('/[^\p{L}\p{N}]+/u', $q['t'], -1, PREG_SPLIT_NO_EMPTY) ?: [];
    foreach ($words as $i => $w) {
        if (!array_filter(assistant_concepts_of(assistant_stem($w), true), fn ($c) => $c[0] === 'gender')) continue;
        $prev = $words[$i - 1] ?? '';
        $prev2 = $words[$i - 2] ?? '';
        if (in_array($prev, ['for', 'حق', 'لل'], true) || ($prev2 === 'for' && in_array($prev, ['my', 'a', 'the', 'our'], true))
            || str_starts_with($w, 'لل') || in_array($w, ['wife', 'husband', 'زوجتي', 'زوجي'], true)) {
            return true;
        }
    }
    return false;
}

function assistant_answer(PDO $db, array $cfg, string $message, string $lang): array
{
    $ar = $lang === 'ar';
    [$intent, $topic] = assistant_route($message);
    $reply = null;
    $data = null;
    $missed = false;
    // A contact topic when an ORDER's own state says a person must look
    // (assistant_order): the widget keeps intent order_status and the card.
    $escalate = null;

    // The two answers built from settings read them now, and only those two:
    // the rest of the shop's questions should not pay for the lookup.
    if ($intent === 'payment' || $intent === 'delivery') $cfg['_checkout'] = assistant_checkout_facts($db);

    // A GREETING THAT ALSO ASKS FOR SOMETHING. «السلام عليكم، عندكم شورت؟» is how
    // a Gulf customer opens a chat, and it got the welcome line and nothing
    // else while the shop has the shorts.
    //
    // WHAT IS SEARCHED IS WHAT THE GREETING LEAVES — the hello, the
    // courtesies and the form of address («يا شباب», "ladies") taken out — and
    // only when that remainder names something search reads
    // (assistant_greeting_asks). «مرحبا، عندكم احذية؟», "hi, do you have
    // shoes?" and «هلا، عندكم نايكي؟» are searched — "not carried", a handoff —
    // exactly as they would be without the hello, while «مرحبا عندي استفسار»
    // and "hi there, quick question" stay the welcome they were before round
    // two. With the address words gone first, «هلا شباب» has nothing left and
    // stays a hello, while «عندكم شي للبنات؟» is the women's shelf.
    if ($intent === 'greeting') {
        $rest = assistant_after_greeting(assistant_normalise($message));
        if (preg_match('/[\p{L}\p{N}]{2,}/u', $rest) && assistant_greeting_asks($db, $rest)) {
            [$reply, $data, $missed] = assistant_search($db, $cfg, $rest, $ar);
            $intent = 'search';
        }
    }

    if ($reply === null) {
        switch ($intent) {
            case 'order_status':
                $tn = assistant_normalise($message);
                // "It did not arrive" / "it is late" is not "when will it arrive": it
                // gets no 24-hour promise (the hour has passed), and with a delivered
                // order it is a dispute (assistant_order).
                $complaint = assistant_has($tn, assistant_not_received_words()) || assistant_is_late_talk($tn);
                $eta = !$complaint && assistant_has($tn, assistant_delivery_words());
                [$reply, $data, $escalate] = assistant_order($db, $cfg, assistant_find_track($message), $ar, $eta, $complaint);
                break;
            case 'search':
                [$reply, $data, $missed] = assistant_search($db, $cfg, $message, $ar);
                break;
            case 'recommend':
                [$reply, $data] = assistant_recommend($db, $cfg, $message, $ar);
                break;
            default:
                // Everything else is a fixed sentence — see assistant_canned().
                // A `contact` with a topic (money, a complaint, a code) has a
                // sentence of its own.
                $reply = ($topic !== null ? assistant_canned($cfg, $topic, $ar) : null)
                    ?? assistant_canned($cfg, $intent, $ar)
                    ?? assistant_canned($cfg, 'greeting', $ar);
        }
    }

    // The model, if there is one, only rewords what is already true. Its
    // answer repeated word for word is no rewording at all.
    $better = assistant_llm_rewordable($cfg, $reply, $ar) ? assistant_llm($cfg, $message, $reply, $data, $ar) : null;
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
    //
    // KEYED LIKE EVERY OTHER LIMITER: store_client_identity(), i.e. an IPv6
    // client by its /64. The raw address let a host that owns a /64 present a new
    // source per request and never meet the cap — 25 requests from 25 addresses
    // of one subnet were 25 emails to the shop, with text the sender chose.
    //
    // AN ORDER THAT NEEDS A PERSON (assistant_order's `escalate`: a delivered
    // order the customer says never came, an order days past its promise) is
    // handed off as a `contact` with that topic, although the widget is still
    // answered with intent order_status and the order card.
    $handoffIntent = $escalate !== null ? 'contact' : $intent;
    $handoffTopic  = $escalate ?? $topic;
    $person = $handoffIntent === 'contact' || $handoffIntent === 'cancel';
    $gap    = $intent === 'search' && ($missed || !$data);
    if (($person || $gap)
        && (string) ($cfg['n8n_webhook'] ?? '') !== '' && (string) ($cfg['n8n_secret'] ?? '') !== ''
        && (!function_exists('store_rate_limit_hit')
            || store_rate_limit_hit($db, $person ? 'assistant_handoff_person' : 'assistant_handoff_gap',
                                    store_client_identity(), $person ? 6 : 10, 600)['allowed'])) {
        assistant_handoff($cfg, $message, $final, $handoffIntent, $lang, $handoffTopic);
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
// answers repeat: "delivery within 24 hours", "returns within 14 days", the
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
function assistant_handoff(array $cfg, string $message, string $reply, string $intent, string $lang,
                           ?string $topic = null): void
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

    // `topic` says WHY a `contact` needs a person — 'money' (paid, and it went
    // wrong), 'complaint' (a wrong or damaged item), 'coupon_problem' — so the
    // workflow's email subject can say "payment problem" instead of "asked for
    // a person". Null for everything else.
    $payload = json_encode([
        'source'  => 'sporta-ai',
        'intent'  => $intent,
        'topic'   => $topic,
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
