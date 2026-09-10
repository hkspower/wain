<?php
declare(strict_types=1);

/**
 * seo.php — per-route <head> for the Sporta single-page app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every route on this site (/shop, /product/<slug>, /about, ...) is rewritten
 * by .htaccess to the one and only index.html. That file has a single
 * hardcoded <head>, so before this shim EVERY url served:
 *
 *     <title>Sporta — Sports & Fitness Store in Kuwait | سبورتا</title>
 *     <link rel="canonical" href="https://www.sporta.com.kw/">
 *
 * The canonical was the real damage: it told Google that all 92 product urls
 * in sitemap-products.xml are duplicates of the homepage, so none of them
 * could hold a ranking of their own. It also meant every product link shared
 * on WhatsApp previewed as the generic store card, never the product.
 *
 * A JavaScript fix does not work here. WhatsApp, Facebook and Twitter scrapers
 * do not run JS, and Google treats a JS-injected canonical as unreliable. The
 * tags have to be in the bytes we send. Hence PHP.
 *
 * BEHAVIOUR
 * ---------
 * Reads index.html, strips the hardcoded SEO tags, injects the correct ones
 * for the requested route, and echoes the result. The <body> is untouched, so
 * the SPA boots exactly as it did before.
 *
 * FAIL-SAFE: any error at all — bad db, missing product, anything thrown —
 * falls through to serving index.html verbatim. A broken meta tag must never
 * become a broken storefront.
 */

const SITE      = 'https://www.sporta.com.kw';
const OG_IMAGE  = SITE . '/og-image.png';
const SHELL     = __DIR__ . '/index.html';

/* The shell is the one hard requirement. Without it there is nothing to serve. */
$html = @file_get_contents(SHELL);
if ($html === false) {
    http_response_code(500);
    exit('Store shell missing.');
}

/* ------------------------------------------------------------- sending it out
 *
 * EVERY ROUTE ON THIS SITE COMES THROUGH HERE — `/`, /shop, /cart, /checkout,
 * every /product/<slug> — because .htaccess rewrites them all to this file. So
 * whatever this function does, it does on every navigation a shopper makes.
 *
 * IT SENT NO VALIDATOR, AND THAT COST A FULL PAGE EVERY TIME. `max-age=0,
 * must-revalidate` is the right policy: ask the server before reusing this. But
 * `no-cache`/`max-age=0` only buys anything if the server can answer "still the
 * same" — and answering that needs an ETag or a Last-Modified. PHP sends
 * neither on its own, and a static file gets them from the web server, which is
 * why every OTHER file on this shop had one and the home page did not.
 *
 * Measured on the live server, 2026-09-10, by
 * scripts/live/live-revalidate-check.php:
 *
 *   shell   200/42810  v=NONE     inm=no-etag  ims=no-lm    <- this file
 *   worker  200/18880  v=etag+lm  inm=304/0
 *   fixed   200/92856  v=etag+lm  inm=304/0
 *   api     200/21773  v=etag     inm=304/0
 *
 * So Chrome and Safari both re-downloaded 42,810 bytes on every single
 * navigation, and neither had any way not to. With the ETag below the same
 * request is a 304 with an empty body whenever nothing has changed.
 *
 * A HASH OF THE BODY IS AN HONEST ETAG HERE because this page is a pure
 * function of the URL: the language comes from ?lang=en rather than from
 * Accept-Language, nothing reads a cookie, and there is no clock, no nonce and
 * no random value anywhere in it. Two requests for one URL produce identical
 * bytes, so the tag changes exactly when the page does — when the shell is
 * republished, or when a product's name or price is edited in /backends.
 *
 * NO `Vary` IS NEEDED for the same reason. If this ever starts reading
 * Accept-Language, a Vary must be added in the same commit, or a shared cache
 * will hand an Arabic page to an English shopper.
 *
 * THE FALLBACK BRANCH USES THIS TOO, and that is safe rather than sloppy: it
 * serves a DEGRADED shell, and its own comment argues such a page must not be
 * pinned. It is not pinned — `max-age=0, must-revalidate` still forces the ask
 * on every visit, and the moment the fault clears the body differs, so the tag
 * differs and the shopper gets a 200 with the good page. A 304 fires only while
 * the bytes really are the ones the browser already holds.
 */
function seo_send(string $html): never
{
    $etag = '"' . sha1($html) . '"';

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=0, must-revalidate');
    header('ETag: ' . $etag);

    /* A conditional request may carry SEVERAL tags, and any cache in the path
       is allowed to weaken one to W/"…". Comparing the whole header as one
       string is how a 304 silently never fires — store_out_cacheable() carries
       the same loop for the same reason, and calls that failure "a slower
       no-store with extra steps". */
    $inm = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
    if ($inm !== '' && $inm !== '*') {
        foreach (explode(',', $inm) as $tag) {
            $tag = trim($tag);
            if (str_starts_with($tag, 'W/')) $tag = substr($tag, 2);
            if ($tag === $etag) {
                http_response_code(304);
                exit;   /* 304 carries no body, by definition */
            }
        }
    }

    echo $html;
    exit;
}

/* ------------------------------------------------------------------ helpers */

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Collapse markup + whitespace and cut to a length search engines will show. */
function summarise(?string $s, int $max = 155): string
{
    $s = trim(preg_replace('/\s+/u', ' ', strip_tags((string) $s)));
    if ($s === '') return '';
    if (mb_strlen($s, 'UTF-8') <= $max) return $s;
    return rtrim(mb_substr($s, 0, $max - 1, 'UTF-8')) . '…';
}

/** Product images may be stored absolute, root-relative, or bare. Normalise. */
function absolute_url(?string $path): string
{
    $path = trim((string) $path);
    if ($path === '') return OG_IMAGE;
    if (preg_match('#^https?://#i', $path)) return $path;
    return SITE . '/' . ltrim($path, '/');
}

/* -------------------------------------------------------------- route + lang */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = '/' . trim(rawurldecode($path), '/');
if ($path === '/') $path = '/';

/* Arabic is the primary language; ?lang=en opts into English. */
$isEn = (($_GET['lang'] ?? '') === 'en');
$lang = $isEn ? 'en' : 'ar';

/* Self-referencing canonical, preserving the language variant so the ar/en
   pair in the sitemap each keep their own canonical rather than collapsing. */
$canonical = SITE . ($path === '/' ? '/' : $path) . ($isEn ? '?lang=en' : '');

/* ------------------------------------------------------------ page metadata */

$title   = 'Sporta — Sports & Fitness Store in Kuwait | سبورتا';
$desc    = $isEn
    ? "Kuwait's destination for sports and fitness gear. Shop activewear, footwear and accessories online with KNET checkout and fast local delivery."
    : 'وجهتك في الكويت للملابس والأدوات الرياضية. تسوّق أونلاين مع الدفع بكي نت وتوصيل سريع داخل الكويت.';
$image   = OG_IMAGE;
$ogType  = 'website';
$noindex = false;

/* Static routes. Each entry: [ar title, en title, ar desc, en desc]. */
$pages = [
    '/shop' => [
        'تسوّق جميع المنتجات', 'Shop All Products',
        'تصفّح تشكيلة سبورتا الكاملة من الملابس والأحذية والإكسسوارات الرياضية في الكويت.',
        'Browse the full Sporta range of sportswear, footwear and accessories in Kuwait.',
    ],
    '/about' => [
        'من نحن', 'About Us',
        'سبورتا متجر كويتي للملابس والمستلزمات الرياضية، تديره شركة المهلب كود.',
        'Sporta is a Kuwait-based sportswear and fitness store, operated by Almuhallab Code.',
    ],
    '/contact' => [
        'اتصل بنا', 'Contact Us',
        'تواصل مع فريق سبورتا للاستفسار عن الطلبات أو المنتجات أو التوصيل داخل الكويت.',
        'Get in touch with the Sporta team about orders, products or delivery inside Kuwait.',
    ],
    '/track' => [
        'تتبّع طلبك', 'Track Your Order',
        'تابع حالة طلبك من سبورتا خطوة بخطوة حتى وصوله إليك.',
        'Follow your Sporta order from confirmation through to delivery.',
    ],
    '/returns' => [
        'الإرجاع والاستبدال', 'Returns & Exchanges',
        'سياسة الإرجاع والاستبدال في سبورتا وكيفية تقديم طلب إرجاع.',
        "Sporta's returns and exchanges policy, and how to start a return.",
    ],
    '/terms' => [
        'الشروط والأحكام', 'Terms & Conditions',
        'الشروط والأحكام الخاصة بالشراء من متجر سبورتا.',
        'The terms and conditions that apply to purchases from Sporta.',
    ],
    '/privacy' => [
        'سياسة الخصوصية', 'Privacy Policy',
        'كيف تجمع سبورتا بياناتك وتستخدمها وتحميها.',
        'How Sporta collects, uses and protects your personal data.',
    ],
    '/review' => [
        'آراء العملاء', 'Customer Reviews',
        'اقرأ تقييمات وآراء عملاء سبورتا حول المنتجات والخدمة.',
        'Read what Sporta customers say about our products and service.',
    ],
];

/* Routes that must never be indexed: they are private, transactional, or
   generate an unbounded number of near-identical urls. */
$privatePrefixes = ['/cart', '/checkout', '/wishlist', '/payment', '/invoice', '/backends'];

try {
    if (str_starts_with($path, '/product/')) {

        $slug = substr($path, strlen('/product/'));

        /* store.php is ~100KB; only load it on the routes that need the db. */
        require_once __DIR__ . '/api/store.php';
        $db = store_db();
        $stmt = $db->prepare(
            'select name_ar, name_en, desc_ar, desc_en, price, image
               from products
              where slug = ? and active = 1
              limit 1'
        );
        $stmt->execute([$slug]);
        $p = $stmt->fetch();

        if ($p) {
            $name = $isEn ? ($p['name_en'] ?: $p['name_ar']) : ($p['name_ar'] ?: $p['name_en']);
            $body = $isEn ? ($p['desc_en'] ?: $p['desc_ar']) : ($p['desc_ar'] ?: $p['desc_en']);
            $price = number_format((float) $p['price'], 3);

            $title  = $isEn ? "$name — Sporta Kuwait" : "$name — سبورتا الكويت";
            $desc   = summarise($body) ?: ($isEn
                ? "$name — available now at Sporta Kuwait for KD $price. KNET checkout, fast local delivery."
                : "$name — متوفر الآن في سبورتا الكويت بسعر $price د.ك. الدفع بكي نت وتوصيل سريع.");
            $ogType = 'product';

            /* Product photography lives in product_images as base64 data URIs,
               which a social scraper cannot use — it needs a URL it can GET.
               api.php?r=product_image serves those bytes at a hashed, cacheable
               URL, so point og:image there. Falls back to the products.image
               column, then to the store card. Today every product has neither,
               so the card is what ships; the moment photos are uploaded this
               starts producing real previews with no code change. */
            $image = absolute_url($p['image']);
            $shot  = $db->prepare(
                'select id, image_hash
                   from product_images
                  where slug = ?
                  order by sort, id
                  limit 1'
            );
            $shot->execute([$slug]);
            if ($s = $shot->fetch()) {
                $image = SITE . '/api/api.php?r=product_image&id=' . (int) $s['id']
                       . '&v=' . substr((string) $s['image_hash'], 0, 12);
            }
        } else {
            /* Unknown or deactivated slug: the SPA renders its not-found view,
               so make sure we do not invite Google to index it. */
            $noindex = true;
            $title   = $isEn ? 'Product not found — Sporta' : 'المنتج غير موجود — سبورتا';
        }

    } elseif (isset($pages[$path])) {

        [$tAr, $tEn, $dAr, $dEn] = $pages[$path];
        $title = ($isEn ? $tEn : $tAr) . ($isEn ? ' — Sporta Kuwait' : ' — سبورتا الكويت');
        $desc  = $isEn ? $dEn : $dAr;

    } else {
        foreach ($privatePrefixes as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
                $noindex = true;
                break;
            }
        }
    }
} catch (Throwable $ex) {
    /* Never let a metadata problem take the storefront down. Serve the shell
       untouched — that is exactly the behaviour the site had before.

       AND SAY HOW LONG IT MAY BE KEPT, which this path did not. The success
       path below sends `public, max-age=0, must-revalidate`; this one sent
       only a Content-Type, so every cache in the chain fell back to a
       heuristic — typically a tenth of the age of the file, which for a shell
       built weeks ago is days.

       That is the wrong way round. This branch runs when something has already
       gone wrong, so the page it serves is the one LEAST worth keeping: a
       degraded shell pinned for days outlives the fault that produced it, and
       the shop looks broken long after it is fixed. Measured on 2026-09-05 —
       the .htaccess rig reported "NOTHING, so every cache guesses" for `/`,
       which is how this branch was found at all. */
    seo_send($html);
}

/* ------------------------------------------------------ build the head block */

$hreflang = '';
if (!$noindex) {
    $base = SITE . ($path === '/' ? '/' : $path);
    $hreflang =
        '  <link rel="alternate" hreflang="ar" href="' . e($base) . '" />' . "\n" .
        '  <link rel="alternate" hreflang="en" href="' . e($base . '?lang=en') . '" />' . "\n" .
        '  <link rel="alternate" hreflang="x-default" href="' . e($base) . '" />' . "\n";
}

$robots = $noindex
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

$head  = "\n  <!-- seo.php: per-route metadata -->\n";
$head .= '  <title>' . e($title) . "</title>\n";
$head .= '  <meta name="description" content="' . e($desc) . "\" />\n";
$head .= '  <meta name="robots" content="' . $robots . "\" />\n";
if (!$noindex) {
    $head .= '  <link rel="canonical" href="' . e($canonical) . "\" />\n";
}
$head .= $hreflang;
$head .= '  <meta property="og:type" content="' . $ogType . "\" />\n";
$head .= '  <meta property="og:site_name" content="Sporta" />' . "\n";
$head .= '  <meta property="og:locale" content="' . ($isEn ? 'en_US' : 'ar_KW') . "\" />\n";
$head .= '  <meta property="og:url" content="' . e($canonical) . "\" />\n";
$head .= '  <meta property="og:title" content="' . e($title) . "\" />\n";
$head .= '  <meta property="og:description" content="' . e($desc) . "\" />\n";
$head .= '  <meta property="og:image" content="' . e($image) . "\" />\n";
$head .= '  <meta name="twitter:card" content="summary_large_image" />' . "\n";
$head .= '  <meta name="twitter:title" content="' . e($title) . "\" />\n";
$head .= '  <meta name="twitter:description" content="' . e($desc) . "\" />\n";
$head .= '  <meta name="twitter:image" content="' . e($image) . "\" />\n";

/* Remove the hardcoded originals so we do not emit each tag twice. The
   keywords tag is dropped entirely — no search engine has used it in over a
   decade, and ours was a 250-character keyword stuff that reads as spam. */
$strip = [
    '#<title>.*?</title>\s*#is',
    '#<meta\s+name=["\']description["\'][^>]*>\s*#i',
    '#<meta\s+name=["\']keywords["\'][^>]*>\s*#i',
    '#<meta\s+name=["\']robots["\'][^>]*>\s*#i',
    '#<link\s+rel=["\']canonical["\'][^>]*>\s*#i',
    '#<link\s+rel=["\']alternate["\'][^>]*hreflang=[^>]*>\s*#i',
    '#<meta\s+property=["\']og:[^"\']*["\'][^>]*>\s*#i',
    '#<meta\s+name=["\']twitter:[^"\']*["\'][^>]*>\s*#i',
];
$clean = preg_replace($strip, '', $html);
if ($clean !== null) $html = $clean;

/* Inject just before </head>. If the shell somehow has no </head>, leave the
   document alone rather than corrupting it. */
$pos = stripos($html, '</head>');
if ($pos !== false) {
    $html = substr($html, 0, $pos) . $head . substr($html, $pos);
}

/* The <html lang> attribute should follow the requested language. */
$html = preg_replace(
    '#<html\s+lang=["\'][^"\']*["\']#i',
    '<html lang="' . $lang . '"',
    $html,
    1
);

seo_send($html);
