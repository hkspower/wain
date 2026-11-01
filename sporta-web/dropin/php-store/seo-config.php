<?php
// Sporta SEO overrides. Paths, product identity and search-engine directives
// are never editable text: the admin controls only bilingual copy and a
// same-origin share image. Empty fields inherit the page/product defaults.
declare(strict_types=1);

const STORE_SEO_PAGE_PATHS = [
    '/', '/shop', '/about', '/contact', '/support', '/track', '/returns', '/terms', '/privacy',
];

function store_seo_empty(): array {
    return ['title_en' => '', 'title_ar' => '', 'description_en' => '', 'description_ar' => '', 'image' => ''];
}

function store_seo_image_path(mixed $value, bool $strict = false): string {
    if (!is_string($value)) {
        if ($strict) store_fail('invalid_seo_image');
        return '';
    }
    $path = trim($value);
    if ($path === '') return '';
    // No hosts, schemes, query strings, data URLs, traversal or SVG. The
    // browser and social crawlers may fetch this path as an image.
    if (strlen($path) > 500 || str_contains($path, '..')
        || !preg_match('~^/(?!/)[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif)$~iD', $path)) {
        if ($strict) store_fail('invalid_seo_image');
        return '';
    }
    return $path;
}

function store_seo_record(array $raw): array {
    $out = store_seo_empty();
    foreach (['title_en' => 120, 'title_ar' => 120,
              'description_en' => 320, 'description_ar' => 320] as $key => $limit) {
        if (!is_string($raw[$key] ?? null)) continue;
        $clean = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $raw[$key]) ?? '');
        $out[$key] = mb_substr($clean, 0, $limit);
    }
    $out['image'] = store_seo_image_path($raw['image'] ?? '');
    return $out;
}

function store_seo_validate_record(array $raw): array {
    $out = [];
    foreach (['title_en' => 120, 'title_ar' => 120,
              'description_en' => 320, 'description_ar' => 320] as $key => $limit) {
        $value = $raw[$key] ?? '';
        $kind = str_starts_with($key, 'title_') ? 'title' : 'description';
        if (!is_string($value) || strlen($value) > 4096) store_fail('invalid_seo_' . $kind);
        $clean = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $value) ?? '');
        if (mb_strlen($clean) > $limit) store_fail('invalid_seo_' . $kind);
        $out[$key] = $clean;
    }
    $out['image'] = store_seo_image_path($raw['image'] ?? '', true);
    return $out;
}

function store_seo_pages(PDO $db): array {
    $setting = store_setting($db, 'seo_pages');
    $stored = is_array($setting['pages'] ?? null) ? $setting['pages'] : [];
    $pages = [];
    foreach (STORE_SEO_PAGE_PATHS as $path) {
        if (is_array($stored[$path] ?? null)) $pages[$path] = store_seo_record($stored[$path]);
    }
    return $pages;
}

function store_seo_product_records(PDO $db): array {
    // One row per product avoids the 64 KB TEXT ceiling as the catalogue
    // grows. The key is based on the immutable database ID, so changing a
    // product slug keeps its metadata attached to the same product.
    $records = [];
    $q = $db->query("select name, value from settings where name like 'seo_p_%'");
    foreach ($q as $row) {
        $name = (string)($row['name'] ?? '');
        if (!preg_match('/^seo_p_([1-9][0-9]{0,9})$/D', $name, $match)) continue;
        $raw = json_decode((string)($row['value'] ?? ''), true);
        if (is_array($raw)) $records[(int)$match[1]] = store_seo_record($raw);
    }
    return $records;
}

function store_seo_public(PDO $db): array {
    $byId = store_seo_product_records($db);
    $products = [];
    $q = $db->query('select id, slug from products where active = 1');
    foreach ($q as $row) {
        $id = (int)$row['id'];
        if (isset($byId[$id])) $products[(string)$row['slug']] = $byId[$id];
    }
    return ['pages' => (object)store_seo_pages($db), 'products' => (object)$products];
}

function store_seo_admin_settings(PDO $db): array {
    $storedPages = store_seo_pages($db);
    $pages = [];
    foreach (STORE_SEO_PAGE_PATHS as $path) $pages[$path] = $storedPages[$path] ?? store_seo_empty();

    $byId = store_seo_product_records($db);
    $products = [];
    $q = $db->query('select id, slug, name_en, name_ar, active from products order by id desc');
    foreach ($q as $row) {
        $id = (int)$row['id'];
        $products[] = [
            'id' => $id,
            'slug' => (string)$row['slug'],
            'name_en' => (string)$row['name_en'],
            'name_ar' => (string)$row['name_ar'],
            'active' => (bool)$row['active'],
            ...($byId[$id] ?? store_seo_empty()),
        ];
    }
    return ['pages' => (object)$pages, 'products' => $products];
}

function store_seo_save_page(PDO $db, string $path, array $record): array {
    if (!in_array($path, STORE_SEO_PAGE_PATHS, true)) store_fail('invalid_seo_path');
    $db->beginTransaction();
    try {
        $db->exec("insert ignore into settings (name, value) values ('seo_pages', '{\"pages\":{}}')");
        $q = $db->prepare('select value from settings where name = ? for update');
        $q->execute(['seo_pages']);
        $raw = json_decode((string)($q->fetchColumn() ?: ''), true);
        $pages = is_array($raw['pages'] ?? null) ? $raw['pages'] : [];
        if ($record === store_seo_empty()) unset($pages[$path]);
        else $pages[$path] = $record;
        // Rebuild only allowed paths so a tampered row cannot retain arbitrary
        // keys in configuration read by the public renderer.
        $safe = [];
        foreach (STORE_SEO_PAGE_PATHS as $allowed) {
            if (is_array($pages[$allowed] ?? null)) $safe[$allowed] = store_seo_record($pages[$allowed]);
        }
        store_setting_save($db, 'seo_pages', ['pages' => $safe]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    return ['path' => $path, ...$record];
}

function store_seo_save_product(PDO $db, int $id, array $record): array {
    if ($id < 1 || $id > 4294967295) store_fail('invalid_seo_product');
    $q = $db->prepare('select id, slug from products where id = ?');
    $q->execute([$id]);
    $product = $q->fetch();
    if (!$product) store_fail('product_not_found', 404);
    $key = 'seo_p_' . $id;
    if ($record === store_seo_empty()) {
        $db->prepare('delete from settings where name = ?')->execute([$key]);
        store_setting_row($db, $key, true);
    } else {
        store_setting_save($db, $key, $record);
    }
    return ['id' => $id, 'product_id' => $id, 'slug' => (string)$product['slug'], ...$record];
}
