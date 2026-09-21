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
$promoText = null;
try {
    require_once __DIR__ . '/api/store.php';
    $db = store_db();

    $promo = store_setting($db, 'promo_bar');
    if ((bool) ($promo['enabled'] ?? false)
        && store_window_open($promo['starts_at'] ?? null, $promo['ends_at'] ?? null)) {
        $promoText = $isEn ? ($promo['text_en'] ?? '') : ($promo['text_ar'] ?? '');
        if ($promoText === '') $promoText = null;
    }

    $rows = $db->prepare(
        'select p.slug, p.name_en, p.name_ar, p.price, p.sale_price, p.sale_starts_at,
                p.sale_ends_at, p.image, p.images, p.brand_slug,
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

$artDesktop = "/cats/desktop/art-$slug" . ($hasRtlArt && !$isEn ? '-rtl' : '') . '.webp';
$artMobile  = "/cats/mobile/art-$slug" . ($hasRtlArt && !$isEn ? '-rtl' : '') . '.webp';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=0, must-revalidate');
?>
<!doctype html>
<html lang="<?= $lang ?>" dir="<?= $dir ?>" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0d0e10">
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
<style>
  /* The palette and font-face block are copied from returns-request.html's
     own copy of assets/sporta-dark.css's ramp, for the same reason it gives:
     this page renders correctly on its own without pulling in a 91 KB build
     stylesheet for nine colours. */
  :root {
    --sp-black:  #0d0e10;
    --sp-tile:   #1a1d20;
    --sp-panel:  #1e2124;
    --sp-raise:  #2a2d31;
    --sp-line:   #3a3e43;
    --sp-silver: #a6acb2;
    --sp-text:   #eaecee;
    --sp-ember:  #ff7b17;
    --sp-fill:   #e0561c;
    --sp-on-fill:#171a1e;
  }
  @font-face {
    font-family: Alexandria; font-style: normal; font-weight: 100 900; font-display: swap;
    src: url(/fonts/alexandria-var-arabic.woff2) format("woff2-variations");
    unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF;
  }
  @font-face {
    font-family: Alexandria; font-style: normal; font-weight: 100 900; font-display: swap;
    src: url(/fonts/alexandria-var-latin.woff2) format("woff2-variations");
    unicode-range: U+0000-00FF, U+2000-206F, U+20AC;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 0 48px;
    background: var(--sp-black); color: var(--sp-text);
    font-family: Alexandria, system-ui, sans-serif;
    font-size: 16px; line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  a { color: inherit; text-decoration: none; }
  /* SOLID BLACK, MATCHING THE APP'S .app-header — 2026-09-21, asked for as
     "make the topbar is unitersal for all website and pages". This page is a
     separate server-rendered surface (see the file's own header comment: a
     crawler that runs no JavaScript still needs something to see), so it was
     never touched by sporta-ui.css's header override, which only reaches the
     built React bundle. #000 and the identical shadow are restated here
     literally rather than shared, because this page already avoids pulling
     in the 91 KB build stylesheet for nine colours (see the palette comment
     above) — a --sp-header-bg custom property would need the owner's
     theme.js to reach this file too, which it does not. */
  header.top { background: #000; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.20); }

  /* THE FULL TOPBAR, NOT JUST ITS COLOUR — 2026-09-21, same day, asked again
     after the colour match as "use all pages same main topbar", confirmed
     with the owner to mean the whole bar: promo strip, language toggle,
     Kuwait clock, cart count and the sub-nav row, not only its background.
     Structure mirrors the app's own header (promo <p>, a main row, a
     border-topped sub-nav), rebuilt in plain HTML/CSS/vanilla JS because
     this page has none of the app's JavaScript to reuse. */
  .promo {
    background: var(--sp-tile); text-align: center; font-size: .8rem; font-weight: 600;
    padding: 6px 14px; color: var(--sp-text);
  }
  .topnav {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 20px;
  }
  .topnav .brand-logo img { height: 28px; width: auto; display: block; }
  .lang-pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700;
    color: rgba(255,255,255,.9); border: 1px solid rgba(255,255,255,.2); border-radius: 999px;
    padding: 6px 12px;
  }
  .lang-pill svg { width: 14px; height: 14px; flex: none; }
  /* THE CLOCK IS DECORATIVE AND HIDDEN BELOW 640px, same breakpoint the
     app's own header uses for its digital readout — a ticking clock is the
     least useful thing on a phone-width category page and the first thing
     worth dropping. */
  .clock { display: none; align-items: center; gap: 8px; }
  @media (min-width: 640px) { .clock { display: flex; } }
  .clock svg { width: 30px; height: 30px; flex: none; }
  .clock .digital { font-size: .78rem; font-weight: 600; color: rgba(255,255,255,.85);
                     font-variant-numeric: tabular-nums; }
  .icons { display: flex; align-items: center; gap: 16px; }
  .icons a { position: relative; display: flex; color: #fff; }
  .icons svg { width: 22px; height: 22px; flex: none; }
  .cart-badge {
    position: absolute; top: -6px; inset-inline-end: -8px; background: var(--sp-fill);
    color: #fff; font-size: .65rem; font-weight: 800; line-height: 1;
    min-width: 16px; height: 16px; border-radius: 999px; display: none;
    align-items: center; justify-content: center; padding: 0 3px;
  }
  .subnav { border-top: 1px solid rgba(255,255,255,.08); }
  .subnav ul {
    list-style: none; display: flex; justify-content: center; gap: 20px;
    margin: 0; padding: 10px 20px; flex-wrap: wrap;
  }
  .subnav a { font-size: .85rem; font-weight: 700; color: rgba(255,255,255,.75); }
  .subnav a.on { color: var(--sp-ember); }
  nav.cats {
    display: flex; gap: 6px; flex-wrap: wrap; overflow-x: auto;
    padding: 12px 20px; border-bottom: 1px solid var(--sp-line);
  }
  nav.cats a {
    padding: 8px 14px; border-radius: 999px; font-size: .88rem; font-weight: 700;
    background: var(--sp-raise); border: 1px solid var(--sp-line); white-space: nowrap;
  }
  nav.cats a.on { background: var(--sp-fill); color: var(--sp-on-fill); border-color: var(--sp-fill); }
  .hero { position: relative; }
  .hero picture, .hero img { display: block; width: 100%; height: auto; }
  .hero .copy {
    position: absolute; inset-inline-start: 0; top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
    padding: 24px clamp(20px, 6vw, 56px); max-width: 60%;
  }
  .hero .kicker { font-size: .82rem; font-weight: 700; letter-spacing: .04em;
                  color: rgba(255,255,255,.85); margin: 0 0 6px; }
  .hero h1 { font-size: clamp(1.5rem, 4vw, 2.4rem); font-weight: 800; margin: 0;
             color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.5); }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
  .count { color: var(--sp-silver); font-size: .9rem; margin: 0 0 18px; }
  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 640px)  { .grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1024px) { .grid { grid-template-columns: repeat(4, 1fr); } }
  .card {
    background: var(--sp-panel); border: 1px solid var(--sp-line);
    border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;
  }
  .card .frame { position: relative; aspect-ratio: 4 / 5; background: var(--sp-tile);
                 overflow: hidden; }
  .card .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* A light wash, not a block-out — the same balance the app's own product
     card strikes (dim + a small corner badge). The first version of this
     page covered the WHOLE photo with a 55%-opaque layer and a large
     centred label, which on a genuinely sold-out item with a real uploaded
     photo (checked live: /women's "AHED") reads as a broken image with a
     dark tint over it rather than as a sold-out notice — the shopper cannot
     see the garment at all. This still says "sold out" clearly; it no
     longer hides the photo to do it. */
  .card .frame.is-out img { opacity: .55; }
  .card .frame .out {
    position: absolute; top: 8px; inset-inline-start: 8px;
    background: rgba(20,22,26,.85); border: 1px solid rgba(255,255,255,.2);
    border-radius: 999px; padding: 4px 10px;
    color: #fff; font-weight: 700; font-size: .72rem;
  }
  .card .body { padding: 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .card .brand { font-size: .78rem; color: var(--sp-silver); }
  .card .name { font-weight: 700; font-size: .92rem;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden; min-height: 2.4em; }
  .card .price { margin-top: auto; display: flex; align-items: baseline; gap: 8px; }
  .card .price b { font-size: 1rem; }
  .card .price s { color: var(--sp-silver); font-size: .82rem; }
  .empty {
    background: var(--sp-panel); border: 1px solid var(--sp-line); border-radius: 14px;
    padding: 32px 20px; text-align: center; color: var(--sp-silver);
  }
  .empty a { color: var(--sp-ember); font-weight: 700; }
  footer.bottom { text-align: center; padding: 24px 20px; color: var(--sp-silver); font-size: .85rem; }
  footer.bottom a { color: var(--sp-ember); font-weight: 700; }
</style>
</head>
<body>
<header class="top">
  <?php if ($promoText !== null): ?>
    <p class="promo"><?= e($promoText) ?></p>
  <?php endif; ?>
  <div class="topnav">
    <a class="lang-pill" href="<?= e($path . ($isEn ? '' : '?lang=en')) ?>">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"></path></svg>
      <?= $isEn ? 'العربية' : 'English' ?>
    </a>
    <span class="clock" aria-hidden="true">
      <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="rgba(255,255,255,.06)"></circle><circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.6"></circle><g data-hand="hour" transform="rotate(0 24 24)"><line x1="24" y1="26.5" x2="24" y2="12" stroke="#fff" stroke-width="3" stroke-linecap="round"></line></g><g data-hand="minute" transform="rotate(0 24 24)"><line x1="24" y1="26.5" x2="24" y2="7" stroke="var(--sp-ember)" stroke-width="2.4" stroke-linecap="round"></line></g><g data-hand="second" transform="rotate(0 24 24)"><line x1="24" y1="30" x2="24" y2="8" stroke="rgba(255,255,255,.5)" stroke-width="1.1" stroke-linecap="round"></line></g><circle cx="24" cy="24" r="2.4" fill="var(--sp-ember)"></circle></svg>
      <span class="digital" data-clock-digital>&nbsp;</span>
    </span>
    <a class="brand-logo" href="/<?= $isEn ? '?lang=en' : '' ?>"><img src="/logo-white.webp" alt="<?= $isEn ? 'Sporta' : 'سبورتا' ?>" width="120" height="28"></a>
    <div class="icons">
      <a href="/cart" aria-label="<?= $isEn ? 'Bag' : 'الحقيبة' ?>">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.91" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
        <span class="cart-badge" data-cart-badge></span>
      </a>
      <a href="/wishlist" aria-label="<?= $isEn ? 'Wishlist' : 'المفضلة' ?>">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.91" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>
      </a>
      <!-- NO SEARCH ICON AND NO "SHOP" LINK, on purpose. The app's own header
           carries both, pointing at /shop — and this file's own header
           comment says, in the owner's own instruction, that none of these
           four pages links there: "the nav, the footer and both empty-state
           fallbacks cross-link the OTHER THREE category pages instead, never
           the unfiltered grid." A search here has nowhere honest to land
           that policy allows, so it is left out rather than pointed
           somewhere the owner already said no to. test:category-pages
           already asserted this and caught the first draft doing exactly
           that. -->
    </div>
  </div>
  <nav class="subnav">
    <ul>
      <li><a href="/<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'Home' : 'الرئيسية' ?></a></li>
      <li><a href="/terms<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'Terms' : 'الشروط' ?></a></li>
      <li><a href="/about<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'About' : 'من نحن' ?></a></li>
      <li><a href="/contact<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'Contact' : 'اتصل بنا' ?></a></li>
    </ul>
  </nav>
</header>
<nav class="cats">
  <?php foreach (CATS as $s => $c): $q = $isEn ? '?lang=en' : ''; ?>
    <a class="<?= $s === $slug ? 'on' : '' ?>" href="/<?= $s . $q ?>"><?= e($isEn ? $c[1] : $c[2]) ?></a>
  <?php endforeach; ?>
</nav>
<div class="hero">
  <picture>
    <source media="(max-width: 640px)" srcset="<?= e($artMobile) ?>">
    <img src="<?= e($artDesktop) ?>" alt="" width="1600" height="635" loading="eager">
  </picture>
  <div class="copy">
    <p class="kicker"><?= e($kicker) ?></p>
    <h1><?= e($name) ?></h1>
  </div>
</div>
<main>
  <?php
  // Cross-link to the OTHER THREE category pages rather than to /shop —
  // /shop is not linked anywhere on these four pages, per the owner's own
  // instruction, so a fallback needs a real destination among the pages
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
    <div class="empty">
      <?= $isEn
        ? 'This page could not load its products right now. Try one of the other sections: '
        : 'تعذّر تحميل المنتجات الآن. جرّب أحد الأقسام الأخرى: ' ?>
      <?= $otherLinks ?>
    </div>
  <?php elseif (!$products): ?>
    <div class="empty">
      <?= $isEn
        ? "Nothing is filed under $nameEn yet — new arrivals are added regularly. In the meantime: "
        : "لا توجد منتجات في قسم $nameAr حالياً — تُضاف منتجات جديدة باستمرار. في هذه الأثناء: " ?>
      <?= $otherLinks ?>
    </div>
  <?php else: ?>
    <p class="count"><?= $isEn
      ? ($count === 1 ? '1 product' : "$count products")
      : "$count منتج" ?></p>
    <div class="grid">
      <?php foreach ($products as $p): ?>
        <a class="card" href="/product/<?= e($p['slug']) ?><?= $isEn ? '?lang=en' : '' ?>">
          <div class="frame<?= $p['soldOut'] ? ' is-out' : '' ?>">
            <?php if ($p['image']): ?>
              <img src="/<?= e(ltrim($p['image'], '/')) ?>" alt="<?= e($p['name']) ?>" loading="lazy">
            <?php endif; ?>
            <?php if ($p['soldOut']): ?>
              <div class="out"><?= $isEn ? 'Sold out' : 'نفدت الكمية' ?></div>
            <?php endif; ?>
          </div>
          <div class="body">
            <?php if ($p['brand']): ?><div class="brand"><?= e($p['brand']) ?></div><?php endif; ?>
            <div class="name"><?= e($p['name']) ?></div>
            <div class="price">
              <b><?= number_format($p['price'], 3) ?> <?= $isEn ? 'KWD' : 'د.ك' ?></b>
              <?php if ($p['was']): ?><s><?= number_format($p['was'], 3) ?></s><?php endif; ?>
            </div>
          </div>
        </a>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
</main>
<footer class="bottom">
  <?= $otherLinks ?>
</footer>
<script src="/assets/category-topbar.js" defer></script>
</body>
</html>
