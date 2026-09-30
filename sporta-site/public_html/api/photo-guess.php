<?php
/**
 * Sporta — look at ONE uploaded photograph and guess which garment it is.
 *
 * WHAT THIS IS. product-photos.js already matches an unsorted photo to a
 * product by its FILENAME — `nike-tee-1.jpg` lands on `nike-tee`. A file
 * named `IMG_4821.jpg` matches nothing and waits for the owner to pick a
 * garment from a dropdown by hand. This is that dropdown pre-filled by
 * actually looking at the picture — asked for as "guess sportswear images,
 * yellow shirt goes to the yellow t-shirt, black pants go to the black
 * men's pants product" — with the owner choosing all three out of two
 * offered: guess-and-confirm rather than guess-and-write.
 *
 *     IT NEVER WRITES. It returns a guessed slug and nothing else. The photo
 *     is not uploaded here — product-photos.js still calls product_image_add
 *     itself, the ordinary route, only once the owner has looked at the
 *     pre-filled choice and pressed Upload. Same shape as research.php:
 *     ONE way into the database, and this is not it.
 *
 * ONE PHOTOGRAPH PER CALL, deliberately, even though the panel may have fifty
 * queued. A batch endpoint would need to hold fifty images in one request
 * body against STORE_PRODUCT_IMAGE_MAX each — tens of megabytes — and a
 * single bad file would fail the whole batch rather than the one row it
 * belongs to. The panel calls this once per unmatched file instead, the same
 * shape enqueue()/upload() already uses for the real upload.
 *
 * THE IMAGE IS VALIDATED BEFORE IT EVER REACHES THE MODEL. store_data_image()
 * is the same gate product_image_add uses — png/jpeg/webp only, magic-number
 * checked, capped at STORE_PRODUCT_IMAGE_MAX — so this can never be used to
 * push an arbitrary file at the API on the shop's credit, and never guesses
 * about a photograph that account would go on to refuse anyway.
 *
 * THE CANDIDATE LIST IS THE SHOP'S OWN, read fresh from `products` rather
 * than trusted from the client — the same reasoning research.php gives for
 * reading categories from the database rather than a list typed into this
 * file: a client-supplied candidate list is a second way for a caller to
 * point this at a product that does not exist, or a product a compromised
 * panel session should not be steering photographs onto. Only slug, name and
 * category go to the model — no price, no cost, no stock, for the same
 * reason research.php withholds them: none helps identify a photograph, and
 * every one is a number a model has no business restating.
 *
 * IT FAILS CLOSED. No `ai_key`, no feature: 503 by name, exactly like
 * research.php and Google sign-in — this can ship before the owner has a key.
 *
 * THE MODEL'S ANSWER IS UNTRUSTED INPUT, same as research.php: the slug it
 * returns is checked against the candidate list actually sent (not merely
 * "some product exists with this slug") before it is trusted, or a model
 * hallucinating a plausible-looking slug would place a photograph on nothing
 * at all and the panel would silently no-op the eventual upload.
 */

/** How many candidate products go to the model in one call. The seeded
 *  catalogue is 46; a shop with hundreds of products would need this to grow
 *  with it, but there is no such shop yet to size it against, so it stays a
 *  named constant rather than an unlimited query — a client on a very large
 *  catalogue gets a clear 'catalogue_too_large' rather than a silently
 *  truncated, wrong-looking guess. */
const PHOTOGUESS_MAX_CANDIDATES = 300;

/** The active products this may offer as candidates — slug, name and
 *  category only, nothing commercial. Read every time: a product added or
 *  renamed in the panel should be guessable the same minute. */
function photoguess_candidates(PDO $db): array
{
    $rows = $db->query(
        "select slug, name_en, category from products
          where active = 1 order by name_en"
    )->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn($r) => [
        'slug'     => (string) $r['slug'],
        'name_en'  => (string) $r['name_en'],
        'category' => (string) ($r['category'] ?? ''),
    ], $rows);
}

/**
 * Ask the model to look at one photograph and pick a candidate.
 * Returns ['error' => string] or ['slug' => string|null, 'reason' => string].
 */
function photoguess_run(array $cfg, PDO $db, string $imageDataUri): array
{
    $key = (string) ($cfg['ai_key'] ?? '');
    $url = (string) ($cfg['ai_url'] ?? '');
    if ($key === '' || $url === '') return ['error' => 'ai_not_configured'];

    // Re-validated here rather than trusted from the caller — the same gate
    // product_image_add applies, so this can never spend the shop's AI
    // budget on a file the real upload would go on to refuse anyway.
    $image = store_data_image($imageDataUri, STORE_PRODUCT_IMAGE_MAX);
    if ($image === null) return ['error' => 'image_required'];

    if (!preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', $image, $m)) {
        return ['error' => 'image_required'];
    }
    $mediaType = 'image/' . $m[1];
    $base64    = $m[2];

    $candidates = photoguess_candidates($db);
    if (!$candidates) return ['error' => 'no_products'];
    if (count($candidates) > PHOTOGUESS_MAX_CANDIDATES) return ['error' => 'catalogue_too_large'];

    $bySlug = [];
    foreach ($candidates as $c) $bySlug[$c['slug']] = $c;

    $list = '';
    foreach ($candidates as $c) {
        $list .= '- ' . $c['slug'] . ': ' . $c['name_en']
               . ($c['category'] !== '' ? ' (' . $c['category'] . ')' : '') . "\n";
    }

    $rules = "You are helping the owner of Sporta, a sportswear shop in Kuwait, sort an\n"
        . "unlabelled product photograph. Look at the picture: what garment is it, and\n"
        . "what colour?\n\n"
        . "Then pick the ONE product below the photograph most likely shows, by its\n"
        . "colour and garment type. Reply with a single JSON object and no other text:\n"
        . '{"slug": "<one of the slugs below, or null if none plausibly matches>", '
        . '"reason": "<one short sentence — the colour and garment you saw>"}' . "\n\n"
        . "Only ever return a slug from this exact list — never invent one, never\n"
        . "return a slug not shown here. If more than one product could plausibly be\n"
        . "the same colour and type, or the photo is unclear, return null rather than\n"
        . "guessing between them.\n\n"
        . "PRODUCTS:\n" . $list;

    $payload = [
        'model'      => (string) ($cfg['ai_model'] ?? 'claude-haiku-4-5'),
        'max_tokens' => 300,
        'system'     => $rules,
        'messages'   => [[
            'role'    => 'user',
            'content' => [
                ['type' => 'image', 'source' => [
                    'type'       => 'base64',
                    'media_type' => $mediaType,
                    'data'       => $base64,
                ]],
                ['type' => 'text', 'text' => 'Which product is this? JSON only.'],
            ],
        ]],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        // A vision call on one image, no search tool — well under
        // research.php's ninety seconds, but still an owner waiting on a
        // button press rather than a page load, so it is not the assistant's
        // six.
        CURLOPT_TIMEOUT        => 40,
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

    if ($code !== 200 || !is_string($body)) {
        return ['error' => 'ai_failed', 'detail' => $code . ' ' . substr(
            $err !== '' ? $err : (string) $body, 0, 300)];
    }

    $j = json_decode($body, true);
    if (!is_array($j)) return ['error' => 'ai_failed', 'detail' => 'unreadable response'];

    $text = '';
    foreach (($j['content'] ?? []) as $blk) {
        if (($blk['type'] ?? '') === 'text') $text .= (string) ($blk['text'] ?? '');
    }

    $from = strpos($text, '{');
    $to   = strrpos($text, '}');
    $obj  = ($from !== false && $to !== false && $to > $from)
        ? json_decode(substr($text, $from, $to - $from + 1), true)
        : null;
    if (!is_array($obj)) {
        return ['error' => 'ai_no_answer', 'detail' => substr(trim($text), 0, 300)];
    }

    // THE SLUG IS CHECKED AGAINST THE LIST ACTUALLY SENT, not merely against
    // `products` in general — a model returning a real slug that was never
    // one of the candidates offered is exactly as untrustworthy as one it
    // invented outright.
    $slug = $obj['slug'] ?? null;
    if ($slug !== null && (!is_string($slug) || !isset($bySlug[$slug]))) $slug = null;

    $reason = is_string($obj['reason'] ?? null)
        ? mb_substr(trim(preg_replace('~<[^>]*>~', '', (string) $obj['reason'])), 0, 200)
        : '';

    return ['slug' => $slug, 'reason' => $reason];
}
