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

function assistant_order(PDO $db, ?string $track, bool $ar): array
{
    if ($track === null) {
        return [$ar
            ? 'أرسل لي رقم الطلب (يبدأ بـ SP) وسأتحقق من حالته فورًا.'
            : 'Send me your order number (it starts with SP) and I will check it right away.', null];
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
        $line = $ar
            ? 'لم يكتمل الدفع لهذا الطلب بعد، لذلك لم يدخل التجهيز. يمكنك إعادة المحاولة من صفحة تتبع الطلب.'
            : 'Payment for this order has not completed, so it has not gone into preparation. You can try again from the order tracking page.';
    } elseif ($ful === 'delivered') {
        $line = $ar ? 'تم تسليم هذا الطلب. نتمنى أن يكون كل شيء على ما يرام.'
                    : 'This order has been delivered. We hope everything is as it should be.';
    } elseif ($ful === 'shipped' || $ful === 'dispatched') {
        $line = $ar ? 'الطلب مع المندوب الآن وفي طريقه إليك.'
                    : 'Your order is with the courier and on its way to you.';
    } else {
        $line = $ar ? 'تم استلام الطلب وهو قيد التجهيز. التوصيل داخل الكويت في نفس اليوم للطلبات المؤكدة.'
                    : 'We have your order and it is being prepared. Delivery inside Kuwait is same-day for confirmed orders.';
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
function assistant_search(PDO $db, string $text, bool $ar): array
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
        return [$ar
            ? 'لم أفهم طلبك تمامًا. أستطيع مساعدتك في: حالة الطلب، التوصيل، الإرجاع والاستبدال، طرق الدفع، والمقاسات — أو ابحث في المتجر مباشرة.'
            : 'I did not quite follow that. I can help with order status, delivery, returns and exchanges, payment methods and sizing — or you can search the shop directly.', null];
    }
    return [$ar ? 'وجدت هذه المنتجات:' : 'Here is what I found:', [
        'kind'  => 'products',
        'items' => array_map(fn ($p) => [
            'slug'  => $p['slug'],
            'name'  => $ar ? $p['name_ar'] : $p['name_en'],
            'price' => number_format((float) ($p['sale_price'] ?: $p['price']), 3, '.', ''),
            'sale'  => $p['sale_price'] !== null && $p['sale_price'] !== '',
        ], $found),
    ]];
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
            [$reply, $data] = assistant_order($db, assistant_find_track($message), $ar);
            break;
        case 'delivery':
            $reply = $ar
                ? 'التوصيل داخل الكويت في نفس اليوم للطلبات المؤكدة، والتوصيل مجاني. يصلك اتصال من المندوب قبل الوصول.'
                : 'Delivery inside Kuwait is same-day for confirmed orders, and it is free. The courier calls before arriving.';
            break;
        case 'returns':
            $reply = $ar
                ? 'الإرجاع والاستبدال متاح خلال ١٤ يومًا من الاستلام، بشرط أن تكون القطعة بحالتها الأصلية مع البطاقة.'
                : 'You can return or exchange within 14 days of delivery, as long as the item is unworn and still has its tag.';
            break;
        case 'payment':
            $reply = $ar
                ? 'نقبل كي نت، والدفع أونلاين عبر T-Pay، والدفع عند الاستلام.'
                : 'We accept KNET, paying online with T-Pay, and cash on delivery.';
            break;
        case 'sizes':
            $reply = $ar
                ? 'كل منتج فيه جدول مقاسات في صفحته. إذا كنت بين مقاسين ننصح بالأكبر للقصّات الواسعة.'
                : 'Every product page has a size guide. If you are between two sizes, take the larger one for the oversized fits.';
            break;
        case 'contact':
            $reply = $ar
                ? 'يسعدنا خدمتك: ' . ($cfg['shop_phone'] ?? '+965 22091914') . ' أو ' . ($cfg['shop_email'] ?? 'cs@sporta.com.kw')
                : 'We are happy to help: ' . ($cfg['shop_phone'] ?? '+965 22091914') . ' or ' . ($cfg['shop_email'] ?? 'cs@sporta.com.kw');
            break;
        case 'greeting':
            $reply = $ar
                ? 'أهلًا بك في سبورتا. أقدر أساعدك في حالة طلبك، التوصيل، الإرجاع، أو إيجاد المقاس المناسب.'
                : 'Welcome to Sporta. I can help with your order, delivery, returns, or finding the right size.';
            break;
        default:
            [$reply, $data] = assistant_search($db, $message, $ar);
    }

    // The model, if there is one, only rewords what is already true.
    $better = assistant_llm($cfg, $message, $reply . ($data ? "\n" . json_encode($data, JSON_UNESCAPED_UNICODE) : ''), $ar);

    return ['intent' => $intent, 'reply' => $better ?? $reply, 'data' => $data,
            'source' => $better === null ? 'shop' : 'shop+ai'];
}
