<?php
// Render the built SPA shell with metadata that a crawler can read without JS.
// The body and its hashed assets remain the exact release build; only the
// route's initial <head> changes. Database failures leave that shell available.
declare(strict_types=1);
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/seo-runtime.php';

const SPORTA_SEO_ORIGIN = 'https://www.sporta.com.kw';

function sporta_seo_escape(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

function sporta_seo_text(mixed $value, int $limit): string {
    if (!is_string($value)) return '';
    $value = trim(preg_replace('/\s+/u', ' ', strip_tags($value)) ?? '');
    return mb_substr($value, 0, $limit);
}

function sporta_seo_image(mixed $raw): string {
    // Only same-origin raster images make useful, safe social cards. Product
    // data may carry a data URI or a generated placeholder; neither is a
    // crawler-fetchable image URL.
    $path = store_seo_image_path($raw);
    return SPORTA_SEO_ORIGIN . ($path !== '' ? $path : '/og-image.png');
}

function sporta_seo_defaults(string $path): array {
    $pages = [
        '/' => ['سبورتا | ملابس رياضية وملابس جيم في الكويت', 'Sporta | Sportswear & Gym Clothing in Kuwait',
            'ملابس رياضية فاخرة في الكويت. ملابس تمارين وهوديز وإكسسوارات — توصيل خلال ٢٤ ساعة بدينار واحد، وطرق الدفع تظهر عند إتمام الشراء.',
            'Premium sportswear in Kuwait. Activewear, gym clothing, hoodies and accessories — delivery within 24 hours for 1 KWD, with payment options shown at checkout.'],
        '/shop' => ['المتجر', 'Shop',
            'تسوّق الملابس الرياضية في الكويت — ملابس تمارين، هوديز، ليقنز، كابات وإكسسوارات. الأسعار بالدينار الكويتي، وطرق الدفع تظهر عند إتمام الشراء، والتوصيل خلال ٢٤ ساعة.',
            'Shop sportswear in Kuwait — activewear, hoodies, leggings, caps and accessories. Prices in Kuwaiti Dinar, payment choices at checkout, delivery within 24 hours.'],
        '/about' => ['عن سبورتا — ملابس رياضية في الكويت', 'About Sporta — sportswear in Kuwait',
            'سبورتا — متجر ملابس رياضية كويتي: توصيل خلال ٢٤ ساعة بدينار واحد، وطرق الدفع المتاحة تظهر عند إتمام الشراء، وإرجاع واستبدال وفق الشروط.',
            'Sporta is a Kuwaiti sportswear store — delivery within 24 hours for 1 KWD, payment choices shown at checkout, and return and exchange requests.'],
        '/contact' => ['تواصل مع سبورتا الكويت', 'Contact Sporta Kuwait',
            'تواصل مع سبورتا عبر واتساب ‎+965 2209 1914 أو البريد cs@sporta.com.kw — نرد بالعربي والإنجليزي.',
            'Contact Sporta on WhatsApp +965 2209 1914 or cs@sporta.com.kw — we answer in Arabic and English.'],
        '/support' => ['كيف نساعدك؟', 'How can we help?',
            'افتح تذكرة للدعم بشأن التوصيل أو الطلب أو المنتجات أو الدفع أو أي استفسار آخر. احتفظ برقم التذكرة وبريدك لمتابعة الردود.',
            'Open a support ticket for delivery, an order, products, payment or anything else. Keep your ticket number and email to follow the conversation.'],
        '/track' => ['تتبع طلبك', 'Track your order', 'أدخل رقم الطلب من رسالة التأكيد.', 'Enter the order number from your confirmation.'],
        '/returns' => ['الإرجاع والاستبدال', 'Returns & exchange',
            'ابدأ برقم طلب سبورتا ورقم الهاتف المستخدم عند الشراء. سنعرض المنتجات التي اشتريتها فعلًا ونحفظ طلبك لمراجعة فريقنا.',
            'Start with your Sporta order number and the phone used at checkout. We will show the items you actually purchased and save your request for our team to review.'],
        '/terms' => ['الشروط والأحكام', 'Terms & conditions',
            'توضّح هذه الشروط آلية الطلب والدفع والتوصيل والإرجاع عند الشراء من سبورتا في الكويت. وبتقديم الطلب فإنك توافق عليها.',
            'How orders, payment, delivery and returns work when you shop with Sporta in Kuwait. Placing an order means you accept these terms.'],
        '/privacy' => ['سياسة الخصوصية', 'Privacy policy',
            'توضّح هذه الصفحة البيانات التي تسجّلها سبورتا عند الشراء أو التواصل معنا، وكيف نستخدمها، وخياراتك بشأنها.',
            'This explains what Sporta records when you shop or contact us, how we use it, and the choices available to you.'],
    ];
    return $pages[$path] ?? ['سبورتا', 'Sporta', 'متجر سبورتا للملابس الرياضية في الكويت.', 'Sporta sportswear store in Kuwait.'];
}

function sporta_seo_route(string $uri): array {
    $path = parse_url($uri, PHP_URL_PATH);
    if (!is_string($path)) $path = '/';
    if ($path !== '/') $path = rtrim($path, '/');
    if ($path === '/exchange') $path = '/returns';
    if (in_array($path, ['/', '/shop', '/about', '/contact', '/support', '/track', '/returns', '/terms', '/privacy'], true)) {
        return ['kind' => 'page', 'path' => $path, 'slug' => null, 'status' => 200];
    }
    if (preg_match('~^/product/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$~D', $path, $match)) {
        return ['kind' => 'product', 'path' => $path, 'slug' => $match[1], 'status' => 200];
    }
    if (in_array($path, ['/cart', '/checkout', '/account', '/wishlist', '/payment/result', '/review'], true)
        || preg_match('~^/(?:backends(?:/.*)?|invoice/[A-Za-z0-9]{1,30})$~D', $path)) {
        return ['kind' => 'private', 'path' => $path, 'slug' => null, 'status' => 200];
    }
    return ['kind' => 'missing', 'path' => $path, 'slug' => null, 'status' => 404];
}

function sporta_seo_track_identified(string $uri): bool {
    $query = parse_url($uri, PHP_URL_QUERY);
    if (!is_string($query)) return false;
    $params = [];
    parse_str($query, $params);
    foreach (array_keys($params) as $key) {
        if (strcasecmp((string)$key, 'trackid') === 0) return true;
    }
    return false;
}

function sporta_seo_saved(array $overrides, string $field): string {
    // Admin copy is plain text, including literal angle brackets if an owner
    // types them. Keep it identical to React's savedText(); escape at output.
    $value = $overrides[$field] ?? '';
    if (!is_string($value)) return '';
    return trim(mb_substr($value, 0, str_starts_with($field, 'description') ? 320 : 120));
}

function sporta_seo_meta(array $route, string $lang, array $payload, ?array $product): array {
    $path = $route['path'];
    $kind = $route['kind'];
    $defaults = sporta_seo_defaults($path);
    $override = [];
    if ($kind === 'page') {
        $pages = (array)($payload['pages'] ?? []);
        $override = (array)($pages[$path] ?? []);
    }
    if ($kind === 'product') {
        $products = (array)($payload['products'] ?? []);
        $override = (array)($products[$route['slug']] ?? []);
    }
    $isArabic = $lang === 'ar';
    $title = $defaults[$isArabic ? 0 : 1];
    if ($kind === 'page' && $path !== '/') $title .= $isArabic ? ' — سبورتا' : ' — Sporta';
    $description = $defaults[$isArabic ? 2 : 3];
    $image = sporta_seo_image($override['image'] ?? '');

    if ($kind === 'product' && $product !== null) {
        $name = sporta_seo_text($product[$isArabic ? 'name_ar' : 'name_en'] ?? '', 160);
        $title = ($name !== '' ? $name : ($isArabic ? 'منتج' : 'Product')) . ($isArabic ? ' — سبورتا' : ' — Sporta');
        $description = sporta_seo_text($product[$isArabic ? 'desc_ar' : 'desc_en'] ?? '', 320);
        if ($description === '') $description = $isArabic
            ? 'تسوّق هذا المنتج من سبورتا في الكويت. اطّلع على المقاسات والسعر وخيارات التوصيل.'
            : 'Shop this product at Sporta Kuwait. View sizes, price and delivery choices.';
        if (empty($override['image'])) $image = sporta_seo_image($product['image'] ?? '');
    }
    $title = sporta_seo_saved($override, $isArabic ? 'title_ar' : 'title_en') ?: $title;
    $description = sporta_seo_saved($override, $isArabic ? 'description_ar' : 'description_en') ?: $description;
    if ($kind === 'private') {
        $title = ($isArabic ? 'حسابك وطلباتك' : 'Your Account & Orders') . ($isArabic ? ' — سبورتا' : ' — Sporta');
        $description = $isArabic ? 'إدارة طلبك لدى سبورتا.' : 'Manage your Sporta order.';
    }
    if ($kind === 'missing') {
        $title = ($isArabic ? 'الصفحة غير موجودة' : 'Page Not Found') . ($isArabic ? ' — سبورتا' : ' — Sporta');
        $description = $isArabic ? 'لم نتمكن من العثور على هذه الصفحة.' : 'We could not find this page.';
    }
    $base = SPORTA_SEO_ORIGIN . $path;
    return [
        'title' => $title, 'description' => $description, 'image' => $image,
        'canonical' => $base . ($lang === 'en' ? '?lang=en' : ''),
        'ar' => $base, 'en' => $base . '?lang=en', 'type' => $kind === 'product' ? 'product' : 'website',
        'indexable' => $kind === 'page' || ($kind === 'product' && $product !== null),
        'locale' => $isArabic ? 'ar_KW' : 'en_KW',
        'localeAlternate' => $isArabic ? 'en_KW' : 'ar_KW',
    ];
}

function sporta_seo_render(string $html, array $meta, string $lang, ?array $payload, ?array $product = null): string {
    // The built shell still contains home metadata. Remove only SEO tags so
    // crawlers never have to guess which duplicate title/canonical wins.
    $html = preg_replace('~<title\b[^>]*>.*?</title\s*>~is', '', $html, 1) ?? $html;
    $html = preg_replace_callback('~<meta\b[^>]*>~is', static function (array $match): string {
        if (preg_match('~\b(?:name|property)\s*=\s*["\'](description|robots|twitter:[^"\']+|og:[^"\']+)["\']~i', $match[0])) return '';
        return $match[0];
    }, $html) ?? $html;
    $html = preg_replace_callback('~<link\b[^>]*>~is', static function (array $match): string {
        if (preg_match('~\brel\s*=\s*["\']canonical["\']~i', $match[0])) return '';
        if (preg_match('~\brel\s*=\s*["\']alternate["\']~i', $match[0])
            && preg_match('~\bhreflang\s*=~i', $match[0])) return '';
        return $match[0];
    }, $html) ?? $html;
    $html = preg_replace('~<html\b[^>]*>~i', '<html lang="' . $lang . '" dir="' . ($lang === 'ar' ? 'rtl' : 'ltr') . '">', $html, 1) ?? $html;

    $esc = 'sporta_seo_escape';
    $robots = $meta['indexable']
        ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
        : 'noindex, follow';
    $tags = [
        '<title>' . $esc($meta['title']) . '</title>',
        '<meta name="description" content="' . $esc($meta['description']) . '">',
        '<meta name="robots" content="' . $robots . '">',
        '<meta property="og:type" content="' . $meta['type'] . '">',
        '<meta property="og:site_name" content="Sporta">',
        '<meta property="og:title" content="' . $esc($meta['title']) . '">',
        '<meta property="og:description" content="' . $esc($meta['description']) . '">',
        '<meta property="og:url" content="' . $esc($meta['canonical']) . '">',
        '<meta property="og:image" content="' . $esc($meta['image']) . '">',
        '<meta property="og:image:alt" content="' . $esc($meta['title']) . '">',
        '<meta property="og:locale" content="' . $meta['locale'] . '">',
        '<meta property="og:locale:alternate" content="' . $meta['localeAlternate'] . '">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="' . $esc($meta['title']) . '">',
        '<meta name="twitter:description" content="' . $esc($meta['description']) . '">',
        '<meta name="twitter:image" content="' . $esc($meta['image']) . '">',
        '<meta name="twitter:image:alt" content="' . $esc($meta['title']) . '">',
    ];
    if ($meta['indexable']) {
        $tags[] = '<link rel="canonical" href="' . $esc($meta['canonical']) . '">';
        foreach (['ar' => $meta['ar'], 'en' => $meta['en'], 'x-default' => $meta['ar']] as $code => $url) {
            $tags[] = '<link rel="alternate" hreflang="' . $code . '" href="' . $esc($url) . '">';
        }
    }
    $jsonFlags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE;
    if ($payload !== null) {
        $tags[] = '<script type="application/json" id="sporta-seo-data">'
            . json_encode($payload, $jsonFlags) . '</script>';
    }
    if ($product !== null) {
        $schema = [
            '@context' => 'https://schema.org', '@type' => 'Product',
            'name' => sporta_seo_text($product[$lang === 'ar' ? 'name_ar' : 'name_en'] ?? '', 160),
            'description' => $meta['description'], 'url' => $meta['canonical'],
        ];
        if ($meta['image'] !== SPORTA_SEO_ORIGIN . '/og-image.png') $schema['image'] = $meta['image'];
        if (is_numeric($product['price'] ?? null)) {
            $schema['offers'] = [
                '@type' => 'Offer', 'priceCurrency' => 'KWD',
                'price' => number_format((float)$product['price'], 3, '.', ''),
                'url' => $meta['canonical'],
            ];
        }
        $tags[] = '<script type="application/ld+json" data-sporta-ssr-product="true">'
            . json_encode($schema, $jsonFlags) . '</script>';
    }
    return str_replace('</head>', implode("\n    ", $tags) . "\n  </head>", $html);
}

function sporta_seo_serve(): void {
    $file = sporta_seo_public_path('index.html');
    if ($file === null) { http_response_code(503); header('Cache-Control: no-store'); return; }
    $html = file_get_contents($file);
    if ($html === false) { http_response_code(503); header('Cache-Control: no-store'); return; }
    $route = sporta_seo_route((string)($_SERVER['REQUEST_URI'] ?? '/'));
    $lang = ($_GET['lang'] ?? '') === 'en' ? 'en' : 'ar';
    $payload = null;
    $product = null;
    // Every known shell embeds the same sanitized overrides so a subsequent
    // client-side navigation can reuse them. Missing URLs need no catalogue.
    $db = $route['kind'] !== 'missing' ? sporta_seo_db() : null;
    if ($db !== null && $route['kind'] === 'product') {
        try {
            $q = $db->prepare('select slug, name_en, name_ar, desc_en, desc_ar, image, price,
                                     sale_price, sale_starts_at, sale_ends_at
                                from products where slug = ? and active = 1 limit 1');
            $q->execute([$route['slug']]);
            $product = $q->fetch() ?: null;
            if ($product === null) {
                $route['kind'] = 'missing';
                $route['status'] = 404;
            } else {
                // The raw list price can differ from the live sale price.
                // Product structured data must quote the amount checkout uses.
                $product['price'] = store_kwd(store_effective_price($product)['fils']);
            }
        } catch (Throwable $e) {
            error_log('Sporta SEO product unavailable: ' . get_class($e));
            $db = null;
        }
    }
    if ($db !== null && $route['kind'] !== 'missing') {
        try {
            $payload = store_seo_public($db);
        } catch (Throwable $e) {
            // Missing/corrupt SEO settings must not hide a valid product.
            error_log('Sporta SEO overrides unavailable: ' . get_class($e));
        }
    }
    $meta = sporta_seo_meta($route, $lang, $payload ?? [], $product);
    if ($route['path'] === '/track'
        && sporta_seo_track_identified((string)($_SERVER['REQUEST_URI'] ?? ''))) {
        $meta['indexable'] = false;
    }
    // A temporary database outage is not evidence a product disappeared.
    // Serve the shell for shoppers, but ask crawlers to retry the URL rather
    // than deindexing it on an invented noindex/404 response.
    $productUnavailable = $db === null && $route['kind'] === 'product';
    if ($productUnavailable) {
        $meta['indexable'] = true;
        header('Retry-After: 300');
    }
    http_response_code($productUnavailable ? 503 : $route['status']);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: ' . ($productUnavailable ? 'no-store' : 'no-cache, must-revalidate'));
    if (!$meta['indexable']) header('X-Robots-Tag: noindex, follow');
    $body = sporta_seo_render($html, $meta, $lang, $payload, $product);
    // A validator, so "no-cache" costs a 304 instead of the whole page. The
    // hash is of the exact bytes, so any change to the shell, the SEO text or
    // a product's price is a new ETag. mod_deflate/mod_brotli append -gzip/-br
    // to the header on the way out and browsers echo that back, so strip it
    // (and a weak W/ prefix) before comparing.
    if (http_response_code() === 200) {
        $etag = '"' . substr(hash('sha256', $body), 0, 32) . '"';
        header('ETag: ' . $etag);
        foreach (explode(',', (string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) as $tag) {
            $tag = preg_replace('~^W/~', '', trim($tag));
            $tag = preg_replace('~-(gzip|br)"$~', '"', (string)$tag);
            if ($tag === $etag || $tag === '*') { http_response_code(304); return; }
        }
    }
    echo $body;
}

if (!defined('SPORTA_SEO_TEST')) sporta_seo_serve();
