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
 * category named in its own heading, its own URL, and "All products" always
 * one tap away in the header — narrowed IN THE OPEN, the same argument the
 * app's own /category/[id] and /brand/[slug] screens already make.
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
try {
    require_once __DIR__ . '/api/store.php';
    $db = store_db();

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
        : "The $nameEn range at Sporta Kuwait — new arrivals added regularly. Browse the full shop while this section fills up.")
    : ($count > 0
        ? "تسوّق قسم $nameAr في سبورتا الكويت — $count منتج مع الدفع بكي نت وتوصيل سريع."
        : "قسم $nameAr في سبورتا الكويت — تُضاف منتجات جديدة باستمرار. تصفّح المتجر الكامل بينما يتم تجهيز هذا القسم.");

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
  header.top {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 16px 20px; border-bottom: 1px solid var(--sp-line);
  }
  header.top img { height: 28px; width: auto; display: block; }
  nav.cats {
    display: flex; gap: 6px; flex-wrap: wrap; overflow-x: auto;
    padding: 12px 20px; border-bottom: 1px solid var(--sp-line);
  }
  nav.cats a {
    padding: 8px 14px; border-radius: 999px; font-size: .88rem; font-weight: 700;
    background: var(--sp-raise); border: 1px solid var(--sp-line); white-space: nowrap;
  }
  nav.cats a.on { background: var(--sp-fill); color: var(--sp-on-fill); border-color: var(--sp-fill); }
  .lang { font-size: .85rem; color: var(--sp-silver); border: 1px solid var(--sp-line);
          border-radius: 999px; padding: 6px 12px; }
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
  .card .frame .out {
    position: absolute; inset: 0; background: rgba(20,22,26,.55);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: .85rem;
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
  <a href="/<?= $isEn ? '?lang=en' : '' ?>"><img src="/logo-white.webp" alt="<?= $isEn ? 'Sporta' : 'سبورتا' ?>" width="120" height="28"></a>
  <a class="lang" href="<?= e($path . ($isEn ? '' : '?lang=en')) ?>"><?= $isEn ? 'العربية' : 'English' ?></a>
</header>
<nav class="cats">
  <?php foreach (CATS as $s => $c): $q = $isEn ? '?lang=en' : ''; ?>
    <a class="<?= $s === $slug ? 'on' : '' ?>" href="/<?= $s . $q ?>"><?= e($isEn ? $c[1] : $c[2]) ?></a>
  <?php endforeach; ?>
  <a href="/shop<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'All products' : 'كل المنتجات' ?></a>
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
  <?php if ($dbError): ?>
    <div class="empty">
      <?= $isEn
        ? 'This page could not load its products right now. <a href="/shop">Browse the full shop instead.</a>'
        : 'تعذّر تحميل المنتجات الآن. <a href="/shop">تصفّح المتجر الكامل بدلاً من ذلك.</a>' ?>
    </div>
  <?php elseif (!$products): ?>
    <div class="empty">
      <?= $isEn
        ? "Nothing is filed under $nameEn yet — new arrivals are added regularly. <a href=\"/shop\">Browse the full shop</a> in the meantime."
        : "لا توجد منتجات في قسم $nameAr حالياً — تُضاف منتجات جديدة باستمرار. <a href=\"/shop\">تصفّح المتجر الكامل</a> في هذه الأثناء." ?>
    </div>
  <?php else: ?>
    <p class="count"><?= $isEn
      ? ($count === 1 ? '1 product' : "$count products")
      : "$count منتج" ?></p>
    <div class="grid">
      <?php foreach ($products as $p): ?>
        <a class="card" href="/product/<?= e($p['slug']) ?><?= $isEn ? '?lang=en' : '' ?>">
          <div class="frame">
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
  <a href="/shop<?= $isEn ? '?lang=en' : '' ?>"><?= $isEn ? 'Shop everything at Sporta' : 'تسوّق كل شيء في سبورتا' ?></a>
</footer>
</body>
</html>
