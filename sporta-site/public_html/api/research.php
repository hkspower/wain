<?php
/**
 * Sporta — look a product up on the web, and PROPOSE what is missing.
 *
 * WHAT THIS IS. The owner asked for an assistant that finds product
 * information on the web and uses it to fill the gaps on a product page. This
 * is that, with one rule that shapes everything else:
 *
 *     IT NEVER WRITES. It returns a proposal and nothing else.
 *
 * No route in this file touches the database. The owner reads what came back,
 * edits it, and presses the panel's own Save — which goes through
 * `product_save`, with the validation it has always had. That was the owner's
 * choice out of two offered, and it is the right one: a wrong description or a
 * wrong category on a product page is a wrong sale, and nothing downstream
 * would ever report it.
 *
 * ONLY GENUINELY EMPTY FIELDS, AND ONLY THREE OF THEM. `desc_en`, `desc_ar`
 * and `category`. A field with anything in it is never sent to the model and
 * never comes back — the owner asked for missing fields only, and "improve
 * what is there" is a different feature that would quietly rewrite their work.
 *
 * AND NEVER THE COMMERCIAL ONES. Not price, not sale price, not stock, not
 * size, not SKU, not `cost_aed`, not the slug, not `active`, not an image.
 * Every one of those is a fact about THIS shop's trade that no web page knows:
 * the wholesale cost is the one commercially sensitive number in the schema,
 * a size invented here is refused by a CHECK constraint at insert, and a price
 * taken off a retailer's page is somebody else's margin. The model is not told
 * they exist.
 *
 * CATEGORY IS NOT COSMETIC, AND IT IS THE ONE TO WATCH. `store_return_lookup()`
 * decides whether a garment may be exchanged with `category === 'women'`. So a
 * category proposed here and accepted without thought changes the shop's
 * RETURNS POLICY for that product. It is still offered, because a product with
 * no category is worse — but it is flagged as policy-bearing in what comes
 * back, and the choices are read out of the categories the shop ALREADY USES
 * rather than from a list written here. A list typed into this file is a
 * second home for something the database already knows.
 *
 * THE ARABIC DESCRIPTION IS A TRANSLATION, NOT A SEARCH. When `desc_en` exists
 * and `desc_ar` does not, the shop already holds the fact and only the wording
 * is missing — so the model is asked to translate what is there rather than to
 * go looking, which needs no source and cannot drift from the English half.
 * Only when BOTH are missing does anything get searched.
 *
 * A CLAIM WITH NO SOURCE IS DROPPED. The search is done by the model's own
 * server-side tool, which returns citations; a description that cites nothing
 * is a description that was remembered rather than read, and remembering is
 * exactly how a jacket acquires a fabric it is not made of.
 *
 * IT FAILS CLOSED. No `ai_key`, no feature: the route answers 503 by name and
 * the panel draws nothing. That is the same shape as Google sign-in, and it is
 * why this can ship before the owner has a key.
 *
 * THE MODEL'S ANSWER IS UNTRUSTED INPUT. It is JSON from a program that read
 * the open web, so it is length-capped, HTML-stripped and key-filtered here
 * before it reaches a browser — the same suspicion `store_body()` applies to
 * anything a stranger sends.
 */

/** The three fields this may ever propose, and nothing else may be added
 *  without reading the paragraphs above about why the others are absent. */
const RESEARCH_FIELDS = ['desc_en', 'desc_ar', 'category'];

/** How long a proposed description may be. The column is TEXT, so this is not
 *  the database's limit — it is a shop's product description, and a model asked
 *  for "a description" will happily write a page. */
const RESEARCH_MAX_DESC = 900;

/** Which of the fields this file may propose are actually empty on $p.
 *  Whitespace counts as empty: a description of " " is not a description, and
 *  a product whose gap is a stray space would otherwise never be offered. */
function research_missing(array $p): array
{
    $out = [];
    foreach (RESEARCH_FIELDS as $f) {
        if (trim((string) ($p[$f] ?? '')) === '') $out[] = $f;
    }
    return $out;
}

/** The categories this shop actually uses, so the model picks from the shop's
 *  own vocabulary rather than inventing "sportswear" beside "men". Read every
 *  time rather than cached: adding a category in the panel should be usable
 *  the same minute. */
function research_categories(PDO $db): array
{
    try {
        $rows = $db->query(
            "select distinct category from products
              where category is not null and category <> '' order by category"
        )->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable $e) {
        return [];
    }
    return array_values(array_filter(array_map('strval', $rows)));
}

/** Strip anything that is not plain prose out of a value the model returned.
 *  Not an HTML sanitiser — a refusal. The shop stores descriptions as text and
 *  renders them as text, so a tag here is either a model being decorative or
 *  something worse, and neither belongs in the column. */
function research_clean(string $v, int $max): string
{
    $v = str_replace(["\r", "\0"], '', $v);
    $v = preg_replace('~<[^>]*>~', '', $v) ?? '';
    $v = preg_replace('~[ \t]+~', ' ', $v) ?? '';
    $v = trim(preg_replace('~\n{3,}~', "\n\n", $v) ?? '');
    if (function_exists('mb_substr')) return mb_substr($v, 0, $max);
    return substr($v, 0, $max);
}

/**
 * Ask the model. Returns ['error' => string] or
 * ['fields' => [...], 'sources' => [...], 'searched' => bool, 'notes' => string].
 *
 * $product is the row as the panel holds it; $missing is what to ask for.
 */
function research_run(array $cfg, PDO $db, array $product, array $missing): array
{
    $key = (string) ($cfg['ai_key'] ?? '');
    $url = (string) ($cfg['ai_url'] ?? '');
    if ($key === '' || $url === '') return ['error' => 'ai_not_configured'];
    if (!$missing) return ['error' => 'nothing_missing'];

    $missing = array_values(array_intersect($missing, RESEARCH_FIELDS));
    if (!$missing) return ['error' => 'nothing_missing'];

    $cats = research_categories($db);

    // TRANSLATION OR SEARCH, decided here rather than by the model. If the only
    // gap is the Arabic description and the English one exists, there is
    // nothing on the web this shop needs — it already owns the fact.
    $onlyArabic = $missing === ['desc_ar']
        && trim((string) ($product['desc_en'] ?? '')) !== '';

    // WHAT THE MODEL IS TOLD ABOUT THE PRODUCT. Deliberately only the
    // identifying facts. It is not shown the price, the stock, the cost or the
    // slug: none helps it identify a garment, and the first two are the numbers
    // a careless proposal would be most tempting to "correct".
    $known = [
        'name_en' => (string) ($product['name_en'] ?? ''),
        'name_ar' => (string) ($product['name_ar'] ?? ''),
        'brand'   => (string) ($product['brand_slug'] ?? ''),
    ];
    if (!$onlyArabic && trim((string) ($product['desc_en'] ?? '')) !== '') {
        $known['desc_en'] = research_clean((string) $product['desc_en'], RESEARCH_MAX_DESC);
    }

    $rules = "You are helping the owner of Sporta, a sportswear shop in Kuwait, fill in\n"
        . "gaps on one product. Reply with a single JSON object and no other text.\n\n"
        . "FILL ONLY THESE KEYS: " . implode(', ', $missing) . ".\n"
        . "Omit a key entirely if you cannot support it. An omitted key is a good\n"
        . "answer; a guessed one is not. Never include any other key.\n\n"
        . "NEVER state or guess a price, a discount, stock, a size, an SKU or where\n"
        . "the item ships from. Those are this shop's own figures and you do not\n"
        . "have them.\n\n"
        . "desc_en / desc_ar: two or three plain sentences about what the garment IS\n"
        . "— fabric, cut, intended use. No marketing superlatives, no price, no\n"
        . "sizes, no shipping or returns wording. At most " . RESEARCH_MAX_DESC . " characters.\n"
        . "desc_ar must be Arabic; desc_en must be English.\n";

    if ($cats) {
        $rules .= "\ncategory: choose EXACTLY one of these, which are the categories this\n"
            . "shop already uses: " . implode(', ', $cats) . ". If none fits, omit it.\n";
    } else {
        // No categories in the database yet, so there is no vocabulary to
        // choose from and inventing one would set the shop's first category
        // from a web page. Drop it from the ask entirely.
        $missing = array_values(array_diff($missing, ['category']));
        if (!$missing) return ['error' => 'nothing_missing'];
    }

    if ($onlyArabic) {
        $rules .= "\nTRANSLATE the English description supplied below into natural Arabic.\n"
            . "Do not search the web and do not add anything it does not say.\n";
    } else {
        $rules .= "\nSearch the web for this exact product, preferring the brand's own site.\n"
            . "Write only what a source actually says. If you find nothing about this\n"
            . "specific item, return an empty JSON object rather than a description of\n"
            . "something similar.\n";
    }

    $rules .= "\nPRODUCT:\n" . json_encode($known, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

    $payload = [
        // Undated, for the reason assistant_llm() gives beside the same line: a
        // dated snapshot 404s when it is retired, and a 404 here is
        // indistinguishable from no key.
        'model'      => (string) ($cfg['ai_model'] ?? 'claude-haiku-4-5'),
        'max_tokens' => 1500,
        'system'     => $rules,
        'messages'   => [['role' => 'user', 'content' =>
            'Fill in: ' . implode(', ', $missing) . '. JSON only.']],
    ];

    // THE SEARCH IS THE MODEL'S OWN SERVER-SIDE TOOL, not a scraper here. That
    // is the whole reason this is affordable: no fetching, no HTML parsing, no
    // robots.txt to honour on this server, and citations come back with the
    // answer. The tool name is a CONFIG VALUE with a default, because a
    // server-tool version that is renamed upstream would otherwise need a code
    // publish to fix — and the failure is a 400 nobody would attribute to it.
    if (!$onlyArabic) {
        $payload['tools'] = [[
            'type'     => (string) ($cfg['ai_search_tool'] ?? 'web_search_20250305'),
            'name'     => 'web_search',
            'max_uses' => (int) ($cfg['ai_search_max'] ?? 5),
        ]];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        // Pinned rather than inherited, for the reason written out beside the
        // same three lines in assistant.php and pay/cbk.php: this request
        // carries a credential, and a default is an omission nobody reviews.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        // Far longer than the assistant's six seconds, and that is correct
        // rather than careless: nobody is waiting on a Kuwaiti mobile
        // connection here. This is the owner pressing a button in the panel,
        // having asked for a web search, and a search that is cut off at six
        // seconds returns nothing at all.
        CURLOPT_TIMEOUT        => 90,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $key,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    // SAY WHICH FAILURE IT WAS. assistant.php learned this the expensive way:
    // every failure there returned null, which is also what "not configured"
    // returns, so a key that expired on a Tuesday went unnoticed for months.
    // Here the owner is standing in front of the screen, so the reason goes
    // back to them — the API's own message, truncated, never the key.
    if ($code !== 200 || !is_string($body)) {
        return ['error' => 'ai_failed', 'detail' => $code . ' ' . substr(
            $err !== '' ? $err : (string) $body, 0, 300)];
    }

    $j = json_decode($body, true);
    if (!is_array($j)) return ['error' => 'ai_failed', 'detail' => 'unreadable response'];

    // Gather the text and the citations out of the content blocks. A
    // web-search turn interleaves tool blocks with text, so the JSON may not be
    // the first block and frequently is not.
    $text = '';
    $sources = [];
    foreach (($j['content'] ?? []) as $blk) {
        if (($blk['type'] ?? '') === 'text') {
            $text .= (string) ($blk['text'] ?? '');
            foreach (($blk['citations'] ?? []) as $c) {
                $u = (string) ($c['url'] ?? '');
                if ($u !== '') $sources[$u] = (string) ($c['title'] ?? $u);
            }
        }
        if (($blk['type'] ?? '') === 'web_search_tool_result') {
            foreach (($blk['content'] ?? []) as $c) {
                $u = (string) ($c['url'] ?? '');
                if ($u !== '') $sources[$u] = (string) ($c['title'] ?? $u);
            }
        }
    }

    // The model was asked for JSON only; it is not always obliging, so the
    // object is located rather than assumed to be the whole string.
    $from = strpos($text, '{');
    $to   = strrpos($text, '}');
    $obj  = ($from !== false && $to !== false && $to > $from)
        ? json_decode(substr($text, $from, $to - $from + 1), true)
        : null;
    if (!is_array($obj)) {
        return ['error' => 'ai_no_answer', 'detail' => substr(trim($text), 0, 300)];
    }

    // ---- validate what came back, key by key ----------------------------
    //
    // KEY-FILTERED RATHER THAN KEY-CHECKED. Anything not in $missing is
    // dropped without comment: the model returning `price` is not an error to
    // report, it is a key that must not survive to the panel, where a helpful
    // "apply all" would one day carry it into the row.
    $fields = [];
    foreach ($missing as $f) {
        $v = $obj[$f] ?? null;
        if (!is_string($v)) continue;
        $v = research_clean($v, $f === 'category' ? 40 : RESEARCH_MAX_DESC);
        if ($v === '') continue;

        if ($f === 'category') {
            // The shop's own vocabulary, compared case-insensitively and
            // returned in the shop's spelling — never the model's.
            $hit = null;
            foreach ($cats as $c) {
                if (strcasecmp($c, $v) === 0) { $hit = $c; break; }
            }
            if ($hit === null) continue;
            $v = $hit;
        }
        $fields[$f] = $v;
    }

    // A SEARCHED CLAIM WITH NO SOURCE IS DROPPED. A translation needs none —
    // the fact came from the shop's own English — but a description written
    // from a search that cited nothing was remembered rather than read, and
    // that is precisely how a garment acquires a fabric it is not made of.
    if (!$onlyArabic && !$sources) {
        $fields = array_intersect_key($fields, array_flip(['category']));
    }

    return [
        'fields'   => $fields,
        'sources'  => array_slice(array_map(
            static fn($u, $t) => ['url' => $u, 'title' => $t],
            array_keys($sources), array_values($sources)
        ), 0, 8),
        'searched' => !$onlyArabic,
        'notes'    => $onlyArabic
            ? 'Translated from the English description this shop already holds — nothing was searched.'
            : '',
    ];
}
