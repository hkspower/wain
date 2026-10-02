<?php
declare(strict_types=1);

/**
 * category.php — the four category landing pages: /men /women /accessories
 * /outlet. Served at those clean URLs by the RewriteRules in .htaccess.
 *
 * WHY A FLAT PHP FILE AND NOT AN APP ROUTE. The storefront is a built React
 * bundle whose source is not in this repository, and its router has never
 * heard of these four paths — the same reason /card and /returns/request are
 * flat files (see their own headers). Unlike those two, this one needs LIVE
 * data, so it is PHP rather than static HTML: it queries the same `products`
 * table the shop itself reads, server-rendered, so a crawler that runs no
 * JavaScript at all still sees real product names, prices and links.
 *
 * WHY IT IS NOT A FILTER ON /shop. The shop's product grid was deliberately
 * stripped of every on-page filter on 2026-09-09 ("the shop narrows nothing"),
 * because a hidden parameter left no way to tell the grid was narrowed and no
 * way back to "all". This is the opposite shape: a page of its own, with the
 * category named in its own heading and its own URL — narrowed IN THE OPEN,
 * the same argument the app's own /category/[id] and /brand/[slug] screens
 * already make.
 *
 * NONE OF THE FOUR LINKS TO /shop, on the owner's own instruction — the nav,
 * the footer and both empty-state fallbacks cross-link the OTHER THREE
 * category pages instead ($otherLinks), never the unfiltered grid. A product
 * page (/product/<slug>) is still reachable from a card, and /shop itself
 * still exists and still works; it is simply not linked FROM here.
 *
 * FOUR SLUGS, ONE WHITELIST — never the raw query string. `category` is a
 * free-text column with no CHECK constraint (unlike size/fit), so an
 * unfiltered slug would let a request pick an arbitrary WHERE clause value.
 * The four below are fixed; anything else 404s rather than running a query.
 *
 * "outlet" HAS NO PRODUCTS ASSIGNED YET, and that is expected rather than a
 * bug — this repository's own live-category-breakdown.php found the real
 * catalogue carries men/women/accessories/outerwear, with "outlet" existing
 * only in the app's sandbox seed data. It is still built and still indexed:
 * the owner assigns products to it from /backends by typing "outlet" into
 * the free-text category field (no schema change needed — checked, admin.php
 * validates nothing there), and the page picks them up with no republish.
 * An EMPTY category still gets real copy explaining that, rather than a
 * thin or broken-looking page.
 *
 * "outerwear" IS DELIBERATELY NOT ON ANY OF THE FOUR PAGES. The owner's own
 * call, made when this file was built: those 11 products stay reachable
 * through /shop and their own /product/<slug> pages, not folded into men or
 * women, which would have made the count on either page an approximation of
 * what a shopper filtering by that page's own name should see.
 *
 * FAILS SAFE, like seo.php: any database error falls through to a page that
 * says so in plain language rather than a blank screen or a stack trace.
 */

const SITE     = 'https://www.sporta.com.kw';
const OG_IMAGE = SITE . '/og-image.png';

/** [db category value, name_en, name_ar, kicker_en, kicker_ar, has RTL art] */
const CATS = [
    'men'         => ['men', 'Men', 'رجالي', 'Performance gear', 'معدات الأداء', true],
    'women'       => ['women', 'Women', 'نسائي', 'Move with confidence', 'تحرّكي بثقة', true],
    'accessories' => ['accessories', 'Accessories', 'إكسسوارات', 'Everyday essentials', 'معدات أساسية', false],
    'outlet'      => ['outlet', 'Sporta Outlet', 'سبورتا أوتلت', 'Reduced prices, while they last', 'أسعار مخفضة لفترة محدودة', false],
];

$slug = (string) ($_GET['slug'] ?? '');
if (!isset(CATS[$slug])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found.\n";
    exit;
}
[$dbCategory, $nameEn, $nameAr, $kickerEn, $kickerAr, $hasRtlArt] = CATS[$slug];

$isEn = (($_GET['lang'] ?? '') === 'en');
$lang = $isEn ? 'en' : 'ar';
$dir  = $isEn ? 'ltr' : 'rtl';
$name = $isEn ? $nameEn : $nameAr;
$kicker = $isEn ? $kickerEn : $kickerAr;

function e(?string $s): string {
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

$products = [];
$dbError = false;
// SAME ROW ?r=slides READS, so the promo strip cannot say one thing here and
// another on the app — one home for the text, per this project's own
// standing rule against a second copy drifting from the first.
try {
    require_once __DIR__ . '/api/store.php';
    $db = store_db();

    /* No promo strip: the shop's header hides its own (test:header-polish), and this
       header is the shop's since 2026-10-01. */

    $rows = $db->prepare(
        'select p.slug, p.name_en, p.name_ar, p.price, p.sale_price, p.sale_starts_at,
                p.sale_ends_at, p.image, p.images, p.brand_slug, p.featured,
                b.name_en as brand_en, b.name_ar as brand_ar
           from products p
           left join brands b on b.slug = p.brand_slug and b.active = 1
          where p.active = 1 and p.category = ?
          order by p.name_en'
    );
    $rows->execute([$dbCategory]);
    $rows = $rows->fetchAll(PDO::FETCH_ASSOC);

    // One photo per product, first upload wins — same rule ?r=products uses.
    $slugs = array_column($rows, 'slug');
    $shots = [];
    if ($slugs) {
        $ph = array_fill(0, count($slugs), '?');
        $stmt = $db->prepare(
            'select slug, id, image_hash from product_images where slug in (' . implode(',', $ph) . ')
              order by slug, sort, id'
        );
        $stmt->execute($slugs);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $shots[$s['slug']] ??= 'api/api.php?r=product_image&id=' . (int) $s['id']
                . '&v=' . substr((string) $s['image_hash'], 0, 12);
        }
    }

    // Stock: untracked (no variant rows) reads as always available, same as
    // the storefront's own store_stock_claim().
    $stock = [];
    if ($slugs) {
        $ph = array_fill(0, count($slugs), '?');
        $stmt = $db->prepare(
            'select slug, count(*) as n, coalesce(sum(stock), 0) as total
               from product_variants where slug in (' . implode(',', $ph) . ')
              group by slug'
        );
        $stmt->execute($slugs);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $stock[$s['slug']] = ['tracked' => (int) $s['n'] > 0, 'total' => (int) $s['total']];
        }
    }

    foreach ($rows as $row) {
        $eff = store_effective_price($row);
        $st = $stock[$row['slug']] ?? ['tracked' => false, 'total' => 0];
        $products[] = [
            'slug'    => $row['slug'],
            'name'    => $isEn ? ($row['name_en'] ?: $row['name_ar']) : ($row['name_ar'] ?: $row['name_en']),
            'brand'   => $isEn ? ($row['brand_en'] ?? '') : ($row['brand_ar'] ?? ($row['brand_en'] ?? '')),
            'price'   => $eff['fils'] / 1000,
            'was'     => $eff['on_sale'] ? $eff['list_fils'] / 1000 : null,
            'image'   => $shots[$row['slug']] ?? ($row['image'] ?: null),
            'soldOut' => $st['tracked'] && $st['total'] <= 0,
            'featured' => (bool) ($row['featured'] ?? false),
        ];
    }
} catch (Throwable $e) {
    $dbError = true;
}

$title = $isEn
    ? "$nameEn — Sporta Kuwait"
    : "$nameAr — سبورتا الكويت";
$count = count($products);
$desc = $isEn
    ? ($count > 0
        ? "Shop $nameEn at Sporta Kuwait — $count product" . ($count === 1 ? '' : 's') . " with KNET checkout and fast local delivery."
        : "The $nameEn range at Sporta Kuwait — new arrivals added regularly.")
    : ($count > 0
        ? "تسوّق قسم $nameAr في سبورتا الكويت — $count منتج مع الدفع بكي نت وتوصيل سريع."
        : "قسم $nameAr في سبورتا الكويت — تُضاف منتجات جديدة باستمرار.");

$path = '/' . $slug;
$canonical = SITE . $path . ($isEn ? '?lang=en' : '');

// Since 2026-09-28 all four categories have an Arabic frame and one shape
// (scripts/make-white-tiles.py), so $hasRtlArt no longer decides either.
// ?v= for the same reason as assets/tile-art.js's ART_VERSION: /cats/ may be
// shown stale for days, so a changed picture needs a new URL. Keep them equal.
$artDesktop = "/cats/desktop/art-$slug" . (!$isEn ? '-rtl' : '') . '.webp?v=20261002d';
$artMobile  = "/cats/mobile/art-$slug" . (!$isEn ? '-rtl' : '') . '.webp?v=20261002d';

// THE REAL DIMENSIONS, NOT A GUESS COPIED ACROSS ALL FOUR — 2026-09-21, asked
// for as "fix aspect ration heros images". The <img> below carried a single
// hardcoded 1600x635 (2.52:1) for every category, and none of the six files
// on disk are that shape: men/women are 1216x706 desktop, 900x570 mobile
// (1.72:1 — the -rtl and plain crops share the file's own ratio, checked byte
// for byte), accessories/outlet are 1216x418 desktop, 900x454 mobile (2.91:1).
// Both are narrower than 2.52 and one is wider, so no single fixed pair could
// ever have been right for all four. `height: auto` in the CSS meant the
// WRONG attributes never stretched or cropped anything a visitor could see —
// the browser re-measures from the real file once it decodes — but they
// reserved the wrong box before that happened, which is a real layout shift,
// and they were simply false metadata regardless. $hasRtlArt already tells
// the two groups apart; it is reused here rather than adding a second flag
// that could disagree with it.
[$artW, $artH, $artMobileW, $artMobileH] = [1216, 988, 1080, 1080];   // desktop 40% taller, phone SQUARE since 2026-10-01 (scripts/make-white-tiles.py)

/* ------------------------------------------------------------------------------------
 * THE SHOP'S OWN HEADER, CARD AND FOOTER — 2026-10-01, the owner's choice ("shop header +
 * footer, shorter banner" and "the /shop card everywhere"), out of options rendered side
 * by side. This page used to carry its own copies of all three: a header with a clock the
 * shop dropped on 2026-09-05, a menu row and a wishlist icon the shop hides, "English"
 * where the shop says EN; a card with the + on the photo and no heart; a one-line footer.
 *
 * So it now loads the SHOP'S stylesheets and draws the shop's own markup, class for class
 * (captured from the rendered /shop page with every overlay script blocked), and loads the
 * same overlay scripts the shop does for those parts. One set of rules draws both, and an
 * edit the owner makes in /backends (footer wording, social links, payment chips, site
 * wording, brand colour) reaches these pages the way it reaches the shop.
 *
 * Only the language switch and the bag are LINKS here rather than the bundle's buttons:
 * this page has no app to run them, and a link works with no JavaScript at all.
 * ------------------------------------------------------------------------------------ */

/* The bundle's stylesheet is content-hashed. Read the name out of index.html rather than
   repeating it here, so a rebuilt bundle cannot leave this page on a deleted file. */
function shop_bundle_css(): string {
    $html = @file_get_contents(__DIR__ . '/index.html');
    if (is_string($html) && preg_match('~/assets/index-[A-Za-z0-9_-]+\.css~', $html, $m)) return $m[0];
    return '/assets/index-TIUCmnwm.css';
}

/* The bundle's own price format (Intl en-KW / ar-KW, three decimals, Latin digits), byte
   for byte: "KWD 8.000" and "8.000 د.ك." with the marks the formatter adds. */
function shop_price(float $kwd, bool $isEn): string {
    $n = number_format($kwd, 3, '.', '');
    return $isEn ? "KWD\u{00A0}$n" : "\u{200F}$n\u{00A0}د.ك.\u{200F}";
}

const SHOP_HEART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.47" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>';
/* the bundle's own "no photograph" image; 41-no-photo.css swaps it for the Sporta placeholder */
const SHOP_NO_PHOTO = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22600%22%20height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23171A1E%22%2F%3E%3C%2Fsvg%3E';

/* Takes the SLUG, not a path: the slug is checked against CATS before anything is printed, so
   only a fixed value reaches this markup (test:xss-guard reads the echo that calls it). */
/** The menu bar under the top bar (2026-10-02): the same five links as assets/menu-bar.js, drawn
 *  here because these pages never run the SPA's overlays. It sits INSIDE the sticky header. */
function shop_menubar(bool $isEn, string $slug): string {
    $q = $isEn ? '?lang=en' : '';
    $items = [
        'men' => ['Men', 'رجالي'], 'women' => ['Women', 'نسائي'],
        'accessories' => ['Accessories', 'إكسسوارات'], 'outlet' => ['Outlet', 'سبورتا أوتلت'],
        'shop' => ['All products', 'كل المنتجات'],
    ];
    $out = '<nav class="sp-menubar" aria-label="' . ($isEn ? 'Shop menu' : 'قائمة المتجر') . '">';
    foreach ($items as $s => $t) {
        $out .= '<a class="sp-menubar__link" href="/' . $s . $q . '"' . ($s === $slug ? ' aria-current="page"' : '') . '>'
              . e($isEn ? $t[0] : $t[1]) . '</a>';
    }
    return $out . '</nav>';
}

function shop_header(bool $isEn, string $slug): string {
    $switch = '/' . $slug . ($isEn ? '' : '?lang=en');
    $q = $isEn ? '?lang=en' : '';
    $langLabel = $isEn ? 'Switch language' : 'تغيير اللغة';
    $langText = $isEn ? 'AR' : 'EN';
    $home = $isEn ? 'Sporta — home' : 'سبورتا — الرئيسية';
    $bag = $isEn ? 'Bag' : 'الحقيبة';
    return '<header class="app-header  sticky top-0 z-30 border-b border-white/10 bg-ink-silver/[.97] text-white backdrop-blur">'
        . '<nav class="mx-auto flex max-w-7xl items-center justify-between px-3 py-2 sm:px-4 sm:py-3">'
        . '<div class="flex items-center gap-2">'
        . '<a aria-label="' . e($langLabel) . '" href="' . e($switch) . '" class="tap flex items-center justify-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 hover:border-brand hover:text-brand-bright">'
        . '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"></path></svg> ' . $langText . '</a>'
        . '</div>'
        . '<a aria-label="' . e($home) . '" class="flex min-h-11 items-center" href="/' . $q . '"><picture><source type="image/webp" srcset="/logo-white.webp"><img alt="Sporta Sports Wear" width="132" height="41" class="h-8 w-auto md:h-9" src="/logo-white.png"></picture></a>'
        . '<div class="flex items-center gap-0.5 sm:gap-3">'
        . '<a class="tap relative flex items-center justify-center" aria-label="' . e($bag) . '" href="/cart' . $q . '">'
        . '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.91" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>'
        . '<span data-cart-badge style="display:none" class="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-ink"></span>'
        . '</a></div></nav>'
        /* the shop's menu row is hidden by its CSS, but its 1px top border stays as the
           header's bottom hairline, so the row is kept empty here for the same line */
        . shop_menubar($isEn, $slug)
        . '</header>';
}

function shop_footer(bool $isEn): string {
    $t = $isEn ? [
        'tag' => 'The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands.',
        'ig' => 'Instagram', 'tt' => 'TikTok', 'wa' => 'WhatsApp',
        'info' => 'Information', 'about' => 'About us', 'why' => 'Why Sporta?', 'terms' => 'Terms', 'privacy' => 'Privacy',
        'nav' => 'Navigate', 'contact' => 'Contact us', 'ship' => 'Shipping', 'returns' => 'Returns', 'track' => 'Track order',
        'club' => 'Join the Sporta club', 'clubSub' => 'Offers and new drops — straight to WhatsApp.', 'msg' => 'Message us',
        'cod' => 'Cash on delivery',
        'rights' => 'Sporta — All rights reserved. · 30199/2023',
        'op' => 'Sporta is operated by Al-Muhallab Co. for Designing and Programming Special Software.',
    ] : [
        'tag' => 'موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا.',
        'ig' => 'إنستغرام', 'tt' => 'تيك توك', 'wa' => 'واتساب',
        'info' => 'معلومات', 'about' => 'من نحن', 'why' => 'لماذا سبورتا؟', 'terms' => 'الشروط', 'privacy' => 'الخصوصية',
        'nav' => 'التنقل', 'contact' => 'اتصل بنا', 'ship' => 'الشحن', 'returns' => 'الإرجاع', 'track' => 'تتبع الطلب',
        'club' => 'انضم لنادي سبورتا', 'clubSub' => 'العروض والإصدارات الجديدة — مباشرة على واتساب.', 'msg' => 'راسلنا',
        'cod' => 'الدفع عند الاستلام',
        'rights' => 'Sporta — جميع الحقوق محفوظة. · 30199/2023',
        'op' => 'متجر سبورتا تحت إدارة شركة المهلب لتصميم وبرمجة البرمجيات الخاصة.',
    ];
    $q = $isEn ? '?lang=en' : '';
    $link = fn (string $href, string $text): string =>
        '<li><a class="inline-flex min-h-11 items-center hover:text-brand" href="' . e($href) . '">' . e($text) . '</a></li>';
    $social = fn (string $href, string $label, string $svg): string =>
        '<a href="' . e($href) . '" target="_blank" rel="noopener noreferrer" aria-label="' . e($label) . '" class="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 transition hover:border-brand hover:text-brand">' . $svg . '</a>';
    $svgA = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.33" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
    return '<footer class="app-footer mt-16 bg-ink-silver text-slate-300"><div class="mx-auto max-w-7xl px-6 py-12 md:py-16">'
        . '<div class="flex flex-col items-center gap-5 text-center"><picture><source type="image/webp" srcset="/logo-white.webp"><img alt="Sporta Sports Wear" width="200" height="62" loading="lazy" class="h-12 w-auto" src="/logo-white.png"></picture>'
        . '<p class="max-w-md text-sm text-slate-400">' . e($t['tag']) . '</p>'
        . '<div class="flex items-center gap-3">'
        . $social('https://www.instagram.com/sporta.kw', $t['ig'], $svgA . '<rect x="2" y="2" width="20" height="20" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><path d="M17.5 6.5h.01"></path></svg>')
        . $social('https://www.tiktok.com/@sporta.kw', $t['tt'], $svgA . '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path></svg>')
        . $social('https://wa.me/96522091914', $t['wa'], $svgA . '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path><path d="M8.6 9.2c-.2 1 .2 2.1 1.1 3s2 1.3 3 1.1c.4-.1.8-.5 1-.9l.2-.5-1.6-1-.6.7a4.6 4.6 0 0 1-1.4-1.4l.7-.6-1-1.6-.5.2c-.4.2-.8.6-.9 1Z"></path></svg>')
        . '</div></div>'
        . '<div class="mt-12 grid grid-cols-2 gap-8 text-center sm:text-start">'
        . '<div><h2 class="mb-3 text-sm font-bold text-brand-bright">' . e($t['info']) . '</h2><ul class="text-sm">'
        . $link('/about' . $q, $t['about']) . $link('/about' . $q . '#why', $t['why']) . $link('/terms' . $q, $t['terms']) . $link('/privacy' . $q, $t['privacy'])
        . '</ul></div>'
        . '<div><h2 class="mb-3 text-sm font-bold text-brand-bright">' . e($t['nav']) . '</h2><ul class="text-sm">'
        . $link('/contact' . $q, $t['contact']) . $link('/terms' . $q . '#delivery', $t['ship']) . $link('/returns' . $q, $t['returns']) . $link('/track' . $q, $t['track'])
        . '</ul></div></div>'
        . '<div class="mt-12 flex flex-col items-center justify-between gap-4 rounded-3xl bg-ink-steel p-8 text-center md:flex-row md:text-start">'
        . '<div><h2 class="text-xl font-extrabold text-white">' . e($t['club']) . '</h2><p class="mt-1 text-sm text-slate-300">' . e($t['clubSub']) . '</p></div>'
        . '<a href="https://wa.me/96522091914" target="_blank" rel="noopener noreferrer" class="btn btn-primary">' . e($t['msg']) . '</a></div>'
        . '<div class="mt-8 flex flex-wrap items-center justify-center gap-2">'
        . '<span class="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-bold tracking-wide text-slate-300">KNET</span>'
        . '<span class="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-bold tracking-wide text-slate-300">' . e($t['cod']) . '</span></div>'
        . '<p class="mt-8 text-center text-xs text-slate-400">© ' . date('Y') . ' ' . e($t['rights']) . '</p>'
        . '<p class="mt-1 text-center text-xs text-slate-400">' . e($t['op']) . '</p>'
        . '</div></footer>';
}

$bundleCss = shop_bundle_css();

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=0, must-revalidate');
?>
<!doctype html>
<html lang="<?= $lang ?>" dir="<?= $dir ?>" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#2d3034">
<title><?= e($title) ?></title>
<meta name="description" content="<?= e($desc) ?>">
<link rel="canonical" href="<?= e($canonical) ?>">
<link rel="alternate" hreflang="ar" href="<?= e(SITE . $path) ?>">
<link rel="alternate" hreflang="en" href="<?= e(SITE . $path . '?lang=en') ?>">
<link rel="alternate" hreflang="x-default" href="<?= e(SITE . $path) ?>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sporta">
<meta property="og:locale" content="<?= $isEn ? 'en_US' : 'ar_KW' ?>">
<meta property="og:url" content="<?= e($canonical) ?>">
<meta property="og:title" content="<?= e($title) ?>">
<meta property="og:description" content="<?= e($desc) ?>">
<meta property="og:image" content="<?= e(SITE . $artDesktop) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= e($title) ?>">
<meta name="twitter:description" content="<?= e($desc) ?>">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- The shop's own three stylesheets, in the shop's order (index.html): the bundle, the
     palette, then the overlay rules. A visitor who goes on to /shop already holds all three. -->
<link rel="stylesheet" href="<?= e($bundleCss) ?>">
<link rel="stylesheet" href="/assets/sporta-dark.css">
<link rel="stylesheet" href="/assets/sporta-ui.css">
<link rel="stylesheet" href="/assets/sporta-mobile.css" media="(max-width: 767.98px)">
<link rel="stylesheet" href="/assets/sporta-desktop.css" media="(min-width: 768px)">
<style>
  /* Only what is this page's own: the banner, the count, the empty state and the links to
     the other three sections. Everything else is the shop's markup under the shop's CSS. */
  :root { color-scheme: dark; }

  /* The two header controls that are links here rather than the bundle's buttons take the
     look 01-top-bar.css gives the buttons (`.app-header button[aria-label]`). */
  .app-header a[aria-label].border-white\/20 {
    font-size: 13.5px !important; font-weight: 600 !important; letter-spacing: normal !important;
    border-color: #ffffff59 !important; color: #ffffff !important;
  }

  /* THE BANNER, NO TALLER THAN 45% OF THE SCREEN on anything wider than a phone (owner's
     choice, 2026-10-01): at 1280x900 it was 1,040px tall and the first screen showed no
     products at all. A phone keeps the whole picture, which is already under that. */
  .cp-hero { position: relative; background: #ffffff; }
  .cp-hero picture, .cp-hero img { display: block; width: 100%; height: auto; }
  @media (min-width: 641px) {
    .cp-hero img { height: 45svh; min-height: 300px; object-fit: cover; object-position: 72% 18%; }
    [dir=rtl] .cp-hero img { object-position: 28% 18%; }
  }
  .cp-copy {
    position: absolute; inset-inline-start: 0; top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
    padding: 24px clamp(20px, 6vw, 56px); max-width: 60%;
    background: linear-gradient(to right, rgba(255,255,255,.94) 62%, rgba(255,255,255,0));
  }
  [dir=rtl] .cp-copy { background: linear-gradient(to left, rgba(255,255,255,.94) 62%, rgba(255,255,255,0)); }
  .cp-kicker { font-size: .82rem; font-weight: 700; color: var(--sp-ink-on-light, #c2410c); margin: 0 0 6px; }
  [dir=ltr] .cp-kicker { letter-spacing: .04em; }
  /* ONE PAGE-TITLE STYLE (2026-10-01): Alexandria 700, 26px phone / 30px from 768px, the
     orange bar under it — dark ink here because the banner behind it is white. */
  /* Title only, no picture: the kicker and title sit at the top of the page, in the grid's
     own column and gutter, so they line up with the product count under them. */
  .cp-hero--text { background: transparent; }
  .cp-hero--text .cp-copy {
    position: static; max-width: var(--cp-max); margin: 0 auto; background: none;
    padding: 28px var(--cp-gutter) 0;
  }
  @media (min-width: 768px) { .cp-hero--text .cp-copy { padding: 40px var(--cp-gutter) 0; } }
  /* A WIDER BODY, 2026-10-02 ("increase size for body for category pages to get more space
     for product"): the grid's column was 80rem (1280px) with 16px gutters, so on a 1920px
     screen a third of the width was empty. It is 1600px now, with 12px gutters on a phone and
     24px from 768px, and the title above it uses the SAME two values so they stay aligned. */
  :root { --cp-max: 100rem; --cp-gutter: 12px; }
  @media (min-width: 768px) { :root { --cp-gutter: 24px; } }
  .cp-wrap.cp-wrap { max-width: var(--cp-max); padding-inline: var(--cp-gutter); }
  @media (min-width: 1700px) { .cp-wrap .grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
  .cp-title {
    position: relative; margin: 0; padding-bottom: 16px;
    font-family: 'Alexandria', 'IBM Plex Sans Arabic', system-ui, sans-serif !important;
    font-weight: 700 !important; font-size: 26px !important; line-height: 1.3 !important;
    letter-spacing: 0 !important; color: #171a1e !important;
  }
  @media (min-width: 768px) { .cp-title { font-size: 30px !important; } }
  .cp-title::after {
    content: ""; position: absolute; bottom: 0; inset-inline-start: 0;
    width: 56px; height: 4px; border-radius: 2px; background: var(--brand, #e0561c);
  }
  .cp-count { margin: 0 0 18px; font-size: .9rem; color: var(--sp-silver, #b7bdc4); }
  .cp-empty {
    background: var(--sp-panel, #2d3034); border: 1px solid var(--sp-line, #494e54); border-radius: 16px;
    padding: 32px 20px; text-align: center; color: var(--sp-silver, #b7bdc4);
  }
  .cp-more { margin: 40px 0 0; text-align: center; font-size: .9rem; color: var(--sp-silver, #b7bdc4); }
  .cp-empty a, .cp-more a { color: var(--sp-text, #dbdfe4); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
  /* Sold out: the shop's pill shape in a neutral ink, and the photograph washed, not hidden. */
  .cp-out { position: absolute; top: 10px; left: 10px; z-index: 2; border-radius: 999px; padding: 6px 10px; line-height: 1;
            font-size: 12px; font-weight: 700; color: #fff; background: rgba(20,22,26,.85); border: 1px solid rgba(255,255,255,.2); }
  .cp-washed img { opacity: .55; }
</style>
</head>
<body data-canvas="silver">
<div id="root"><div class="flex min-h-screen flex-col">
<?= shop_header($isEn, $slug) ?>
<main id="main" tabindex="-1" class="flex-1">
  <?php /* NO CATEGORY PICTURE, 2026-10-02 (owner's choice: "title only"). The art still
           exists for the home tiles and stays the page's og:image for link previews. */ ?>
  <div class="cp-hero cp-hero--text">
    <div class="cp-copy">
      <p class="cp-kicker"><?= e($kicker) ?></p>
      <h1 class="cp-title"><?= e($name) ?></h1>
    </div>
  </div>
  <section class="cp-wrap mx-auto max-w-7xl px-4 py-12" style="padding-top:20px">
  <?php
  // Cross-link to the OTHER THREE category pages rather than to /shop —
  // /shop is not linked from the page BODY on these four pages, per the owner's own
  // instruction (the menu bar's "All products" link, added 2026-10-02 at the owner's
  // request, is the one exception), so a fallback needs a real destination among the pages
  // that remain rather than a dead-end sentence.
  $otherLinks = '';
  foreach (CATS as $s => $c) {
      if ($s === $slug) continue;
      $q = $isEn ? '?lang=en' : '';
      if ($otherLinks !== '') $otherLinks .= ' · ';
      $otherLinks .= '<a href="/' . e($s) . $q . '">' . e($isEn ? $c[1] : $c[2]) . '</a>';
  }
  ?>
  <?php if ($dbError): ?>
    <div class="cp-empty">
      <?= $isEn
        ? 'This page could not load its products right now. Try one of the other sections: '
        : 'تعذّر تحميل المنتجات الآن. جرّب أحد الأقسام الأخرى: ' ?>
      <?= $otherLinks ?>
    </div>
  <?php elseif (!$products): ?>
    <div class="cp-empty">
      <?= $isEn
        ? 'Nothing is filed under ' . e($nameEn) . ' yet — new arrivals are added regularly. In the meantime: '
        : 'لا توجد منتجات في قسم ' . e($nameAr) . ' حالياً — تُضاف منتجات جديدة باستمرار. في هذه الأثناء: ' ?>
      <?= $otherLinks ?>
    </div>
  <?php else: ?>
    <p class="cp-count"><?= $isEn
      ? ($count === 1 ? '1 product' : e((string) $count) . ' products')
      : e((string) $count) . ' منتج' ?></p>
    <div class="grid grid-cols-2 gap-x-2 gap-y-10 sm:gap-x-3 md:grid-cols-3 lg:grid-cols-4">
      <?php foreach ($products as $p):
        $href = '/product/' . rawurlencode($p['slug']) . ($isEn ? '?lang=en' : '');
      ?>
      <article class="group flex flex-col">
        <a class="relative block aspect-[4/5] overflow-hidden bg-slate-100<?= $p['soldOut'] ? ' cp-washed' : '' ?>" href="<?= e($href) ?>" aria-label="<?= e($p['name']) ?>">
          <img alt="<?= e($p['name']) ?>" loading="lazy" decoding="async" width="600" height="750" class="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]" src="<?= $p['image'] ? '/' . e(ltrim($p['image'], '/')) : SHOP_NO_PHOTO ?>">
          <?php if ($p['featured'] && !$p['soldOut']): ?><span class="absolute start-2.5 top-2.5 rounded-lg bg-brand px-2 py-1 text-xs font-bold uppercase tracking-wide text-ink"><?= $isEn ? 'Bestseller' : 'الأكثر مبيعًا' ?></span><?php endif; ?>
          <?php if ($p['soldOut']): ?><span class="cp-out"><?= $isEn ? 'Sold out' : 'نفدت الكمية' ?></span><?php endif; ?>
          <button type="button" aria-label="<?= $isEn ? 'Save to wishlist' : 'أضف إلى المفضلة' ?>" aria-pressed="false" data-sporta-heart="<?= e($p['slug']) ?>" class="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600 lg:opacity-0 lg:group-hover:opacity-100"><?= SHOP_HEART_SVG ?></button>
        </a>
        <div class="flex flex-col gap-1 pt-3">
          <a class="-my-1.5 py-1.5 transition group-hover:text-accent" href="<?= e($href) ?>"><h3 class="line-clamp-1 text-sm font-medium text-slate-900"><?= e($p['name']) ?></h3></a>
          <span class="price-card flex items-baseline gap-2 text-sm font-semibold tabular-nums"><?= shop_price((float) $p['price'], $isEn) ?><?php if ($p['was']): ?><s class="text-xs font-normal text-slate-400"><?= shop_price((float) $p['was'], $isEn) ?></s><?php endif; ?></span>
        </div>
      </article>
      <?php endforeach; ?>
    </div>
    <p class="cp-more"><?= $otherLinks ?></p>
  <?php endif; ?>
  </section>
</main>
<?= shop_footer($isEn) ?>
</div></div>
<!-- The shop's own overlays for the parts this page now shares with it: the owner's theme,
     the bag count, the wishlist heart, quick-add, the account sheet, the card's brand and
     colour lines, the sale chip, card thumbnails, and the footer's editable wording, social
     links and payment chips. -->
<script src="/assets/theme.js" defer></script>
<script src="/assets/category-topbar.js" defer></script>
<script src="/assets/card-heart.js" defer></script>
<script src="/assets/grid-name-fit.js" defer></script>
<script src="/assets/quick-add-size.js?v=20261001e" defer></script>
<script src="/assets/customer-account.js" defer></script>
<script src="/assets/brand-badge.js" defer></script>
<script src="/assets/card-badges.js" defer></script>
<script src="/assets/product-cards.js?v=20260930" defer></script>
<script src="/assets/footer.js" defer></script>
<script src="/assets/footer-links.js" defer></script>
<script src="/assets/social-links.js" defer></script>
<script src="/assets/footer-payment-icons.js" defer></script>
<script src="/assets/site-text.js" defer></script>
</body>
</html>
