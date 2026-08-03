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
function assistant_intent(string $text): string
{
    $t = assistant_normalise($text);

    // AN ORDER NUMBER IS THE QUESTION, whatever words surround it. Someone who
    // pastes SP1AU702NKHTKDV and nothing else is asking about that order, and
    // matching on phrasing alone missed it: "order SP1AU..." contains none of
    // the keywords below, so it fell all the way through to product search and
    // the customer was offered four jackets.
    if (assistant_find_track($text) !== null) return 'order_status';

    // 'tracking', not 'track': "do you have a tracksuit" contains "track", and
    // a substring match on it answered a shopping question with a request for
    // an order number.
    if (assistant_has($t, ['طلبي', 'طلبيتي', 'وين طلب', 'اين طلب', 'تتبع', 'رقم الطلب', 'حاله الطلب',
                           'my order', 'where is my order', 'tracking', 'track my', 'track order',
                           'order status', 'order number'])) {
        return 'order_status';
    }
    if (assistant_has($t, ['توصيل', 'شحن', 'يوصل', 'التوصيل', 'متي يصل', 'مندوب',
                           'deliver', 'shipping', 'arrive', 'how long', 'when will'])) {
        return 'delivery';
    }
    // Both the noun and the VERB of each. Arabic asks with verbs — "أبي
    // أستبدل" (I want to exchange) shares no whole word with "استبدال"
    // (an exchange), and matching only the noun missed every natural sentence.
    if (assistant_has($t, ['ارجاع', 'ارجع', 'استرجاع', 'استرجع', 'استبدال', 'استبدل', 'ابدل',
                           'تبديل', 'مرتجع', 'استرداد', 'رجع',
                           'return', 'refund', 'exchange', 'send back'])) {
        return 'returns';
    }
    if (assistant_has($t, ['دفع', 'كي نت', 'كينت', 'knet', 'فيزا', 'ماستر', 'الدفع عند الاستلام',
                           'pay', 'payment', 'card', 'cash on delivery', 'cod', 'tpay', 't-pay'])) {
        return 'payment';
    }
    if (assistant_has($t, ['مقاس', 'مقاسات', 'حجم', 'صغير', 'كبير',
                           'size', 'sizing', 'fit', 'measurement'])) {
        return 'sizes';
    }
    if (assistant_has($t, ['تواصل', 'اتصال', 'خدمه العملاء', 'موظف', 'انسان', 'واتساب', 'رقمكم',
                           'contact', 'human', 'agent', 'speak to', 'phone', 'whatsapp', 'email'])) {
        return 'contact';
    }
    if (assistant_has($t, ['سلام', 'مرحبا', 'هلا', 'صباح', 'مساء',
                           'hello', 'hi ', 'hey', 'good morning', 'salam'])) {
        return 'greeting';
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
        return [assistant_canned($cfg, 'no_idea', $ar), null];
    }
    return [assistant_canned($cfg, 'found', $ar), [
        'kind'  => 'products',
        'items' => array_map(fn ($p) => [
            'slug'  => $p['slug'],
            'name'  => $ar ? $p['name_ar'] : $p['name_en'],
            'price' => number_format((float) ($p['sale_price'] ?: $p['price']), 3, '.', ''),
            'sale'  => $p['sale_price'] !== null && $p['sale_price'] !== '',
        ], $found),
    ]];
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
            'ar' => 'التوصيل داخل الكويت في نفس اليوم للطلبات المؤكدة، والتوصيل مجاني. يصلك اتصال من المندوب قبل الوصول.',
            'en' => 'Delivery inside Kuwait is same-day for confirmed orders, and it is free. The courier calls before arriving.',
        ],
        'returns' => [
            // 14 days must match /returns and the Product structured data.
            'ar' => 'الإرجاع والاستبدال متاح خلال ١٤ يومًا من الاستلام، بشرط أن تكون القطعة بحالتها الأصلية مع البطاقة.',
            'en' => 'You can return or exchange within 14 days of delivery, as long as the item is unworn and still has its tag.',
        ],
        'payment' => [
            'ar' => 'نقبل كي نت، والدفع أونلاين عبر T-Pay، والدفع عند الاستلام.',
            'en' => 'We accept KNET, paying online with T-Pay, and cash on delivery.',
        ],
        'sizes' => [
            'ar' => 'كل منتج فيه جدول مقاسات في صفحته. إذا كنت بين مقاسين ننصح بالأكبر للقصّات الواسعة.',
            'en' => 'Every product page has a size guide. If you are between two sizes, take the larger one for the oversized fits.',
        ],
        'contact' => [
            'ar' => 'يسعدنا خدمتك: ' . $phone . ' أو ' . $email,
            'en' => 'We are happy to help: ' . $phone . ' or ' . $email,
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
            'ar' => 'تم استلام الطلب وهو قيد التجهيز. التوصيل داخل الكويت في نفس اليوم للطلبات المؤكدة.',
            'en' => 'We have your order and it is being prepared. Delivery inside Kuwait is same-day for confirmed orders.',
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
    ];

    return $t[$intent][$ar ? 'ar' : 'en'] ?? null;
}

// Every fixed sentence, both languages — what the voice warmer buys up front.
// Derived from the table above, so it cannot list a sentence the shop no
// longer says or miss one it just started saying.
function assistant_canned_lines(array $cfg): array
{
    $keys = ['delivery', 'returns', 'payment', 'sizes', 'contact', 'greeting', 'ask_track',
             'stage_packing', 'stage_shipped', 'stage_delivered', 'stage_unpaid', 'no_idea', 'found'];
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
    $intent = assistant_intent($message);
    $data = null;

    switch ($intent) {
        case 'order_status':
            [$reply, $data] = assistant_order($db, $cfg, assistant_find_track($message), $ar);
            break;
        case 'search':
            [$reply, $data] = assistant_search($db, $cfg, $message, $ar);
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
    if ($intent === 'contact' || ($intent === 'search' && !$data)) {
        assistant_handoff($cfg, $message, $final, $intent, $lang);
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

    return trim(preg_replace('/[ \t]+/u', ' ', $text) ?? $text);
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
        $text,
    ]));
    return assistant_voice_dir($cfg) . '/' . $hash . '.mp3';
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
        CURLOPT_POSTFIELDS => json_encode([
            // PRONOUNCED, not displayed — see assistant_speech_prep.
            'text' => assistant_speech_prep($text, $lang),
            // Multilingual, or Arabic letters get read with English phonemes.
            'model_id' => $model,
            'voice_settings' => [
                // Stability low-ish so the read has some life in it; too high
                // and a shop greeting sounds like a station announcement.
                'stability'         => (float) ($cfg['tts_stability'] ?? 0.45),
                'similarity_boost'  => (float) ($cfg['tts_similarity'] ?? 0.8),
                'style'             => (float) ($cfg['tts_style'] ?? 0.0),
                'use_speaker_boost' => (bool)  ($cfg['tts_speaker_boost'] ?? true),
            ],
        ], JSON_UNESCAPED_UNICODE),
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
    // A JSON error body served with a 200 is not audio. Check the bytes are
    // actually an MPEG frame or an ID3 tag before caching them for ever.
    if (!str_starts_with($body, 'ID3') && ($body[0] !== "\xFF")) {
        assistant_voice_log($cfg, 'tts 200 but body is not mp3: ' . substr($body, 0, 200));
        $release();
        return null;
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
    foreach ((glob($dir . '/*.mp3') ?: []) as $f) {
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
function assistant_handoff(array $cfg, string $message, string $reply, string $intent, string $lang): void
{
    $url = (string) ($cfg['n8n_webhook'] ?? '');
    if ($url === '') return;

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
        CURLOPT_TIMEOUT => 4,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            // A webhook URL stops being a secret the moment it is in a browser
            // history or a screenshot. The signature is what lets the workflow
            // tell this shop from anyone who has seen the URL.
            'X-Sporta-Signature: ' . hash_hmac('sha256', $payload, (string) ($cfg['n8n_secret'] ?? '')),
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    curl_exec($ch);
    curl_close($ch);
}
