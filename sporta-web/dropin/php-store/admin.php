<?php
// Sporta admin API — what the React /backends screen calls.
// Place at public_html/api/. Every route below ?r=login requires the session.
//
// The shapes returned here are the SAME shapes admin/api.js already hands the
// screens expected — stats keys, order columns, nested product names on
// items — so the admin UI does not know or care which backend it is on. The
// contract is the UI's, not the database's.

declare(strict_types=1);
require __DIR__ . '/store.php';

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = store_db();

// ---------------------------------------------------------------- throttling
// This file had NONE, and the login lockout is not a substitute for it.
//
// That lockout is PER ACCOUNT — five failures freeze one email for fifteen
// minutes. It says nothing about an attacker who sprays one guess across a
// hundred addresses, or who simply hammers ?r=me (unauthenticated, and it runs
// a count over admin_users on every call). Neither is slowed by an account
// lock, and both are free database load on shared hosting.
//
// The ceiling is deliberately high. An admin opening the dashboard fires a
// dozen requests before they have touched anything — stats, revenue, orders,
// items, products — and a limit that interrupts real work is one that gets
// removed. This is a bound on machines, not on people.
//
// Failed LOGINS are counted separately and inside store_login(), on the
// failure path only: a signed-in admin reloading their screen is not guessing,
// and the same distinction the discount route makes applies here.
store_throttle($db, 'admin', 240, 60);

// ------------------------------------------------------------------- session
if ($r === 'login' && $method === 'POST') {
    $b = store_body();
    $who = store_login((string)($b['email'] ?? ''), (string)($b['password'] ?? ''));
    store_out(['email' => $who['email']]);
}

if ($r === 'logout' && $method === 'POST') {
    store_session_start();
    // Clears the cookie as well as the server-side session. Emptying $_SESSION
    // and calling session_destroy() left the browser holding an id — expired
    // server-side, but still sent on every request, and still the thing an
    // attacker with the cookie would replay against a session PHP had not yet
    // collected.
    store_session_end();
    store_out(['ok' => true]);
}

if ($r === 'me') {
    // store_session_admin(), not store_session_start(): an expired session must
    // read as signed OUT here, or the dashboard renders around a session every
    // other route will refuse.
    $who = store_session_admin();
    if ($who === null) {
        // Not signed in — so answer the OTHER question the screen needs before
        // it offers a password box: is there anything to sign in to? Without
        // this, a server whose SQL was never imported and a server with no
        // account both look like a plain login, and the first thing the owner
        // learns is that their correct password is "wrong". One cheap count on
        // a tiny table, and only on the signed-out path.
        if ((int)$db->query('select count(*) from admin_users')->fetchColumn() === 0) {
            store_fail('no_admin_account', 409);
        }
        store_out(null);
    }
    store_out(['email' => $who['email']]);
}

// Everything below this line is an admin.
$admin = store_require_admin();

// --------------------------------------------------------------------- stats
// Same columns as admin_order_stats — Overview reads these keys by name.
if ($r === 'stats') {
    $row = $db->query("
        select
          count(case when payment_status = 'paid' then 1 end)                          as paid_count,
          coalesce(sum(case when payment_status = 'paid' then amount end), 0)          as paid_revenue,
          count(case when payment_status = 'pending' then 1 end)                       as pending_count,
          count(case when payment_status = 'review' then 1 end)                        as review_count,
          count(case when payment_status = 'failed' then 1 end)                        as failed_count,
          count(case when payment_status = 'paid' and fulfilment_status = 'unfulfilled' then 1 end) as unfulfilled_count,
          count(case when payment_status = 'paid' and paid_at >= curdate() then 1 end) as paid_today,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() then amount end), 0) as revenue_today,
          count(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then 1 end) as paid_7d,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then amount end), 0) as revenue_7d,
          count(case when payment_method = 'cod' and payment_status = 'pending' then 1 end) as cod_awaiting_count,
          coalesce(sum(case when payment_method = 'cod' and payment_status = 'pending' then amount end), 0) as cod_awaiting_amount
        from orders
    ")->fetch();
    store_out($row);
}

if ($r === 'revenue') {
    $days = max(1, min(60, (int)($_GET['days'] ?? 14)));
    $q = $db->prepare("
        select date(paid_at) as day, sum(amount) as revenue
          from orders
         where payment_status = 'paid' and paid_at >= curdate() - interval ? day
         group by date(paid_at) order by day
    ");
    $q->execute([$days]);
    store_out($q->fetchAll());
}

// -------------------------------------------------------------------- orders
if ($r === 'orders') {
    $sql = 'select id, track_id, amount, payment_status, payment_method, fulfilment_status,
                   paid_at, created_at, customer_name, customer_phone, customer_area,
                   customer_note, customer_governorate, customer_block, customer_street,
                   customer_building, customer_floor, customer_flat,
                   cbk_paymentid, cbk_reference, cbk_status,
                   -- Which ad produced the order. The whole point of recording
                   -- it is that the owner can see it beside the money.
                   utm_source, utm_medium, utm_campaign, referrer_host
              from orders';
    $where = [];
    $args = [];
    $payment = $_GET['payment'] ?? 'all';
    $fulfilment = $_GET['fulfilment'] ?? 'all';
    if (in_array($payment, ['paid','pending','review','failed'], true)) {
        $where[] = 'payment_status = ?'; $args[] = $payment;
    }
    if (in_array($fulfilment, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        $where[] = 'fulfilment_status = ?'; $args[] = $fulfilment;
    }
    $term = trim((string)($_GET['search'] ?? ''));
    if ($term !== '') { $where[] = 'track_id like ?'; $args[] = '%' . $term . '%'; }
    if ($where) $sql .= ' where ' . implode(' and ', $where);
    $sql .= ' order by created_at desc limit ' . max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $q = $db->prepare($sql);
    $q->execute($args);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) { $row['amount'] = (float)$row['amount']; $row['id'] = (int)$row['id']; }
    store_out($rows);
}

if ($r === 'items') {
    // Nested `products` object, matching the join shape the Orders
    // screen already renders.
    $q = $db->prepare(
        'select oi.id, oi.qty, oi.unit_price, oi.size, oi.fit,
                p.slug, p.name_en, p.name_ar
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ?'
    );
    $q->execute([(int)($_GET['order'] ?? 0)]);
    $out = [];
    foreach ($q->fetchAll() as $row) {
        $out[] = [
            'id' => (int)$row['id'], 'qty' => (int)$row['qty'],
            'unit_price' => (float)$row['unit_price'],
            'size' => $row['size'], 'fit' => $row['fit'],
            'products' => ['slug' => $row['slug'], 'name_en' => $row['name_en'], 'name_ar' => $row['name_ar']],
        ];
    }
    store_out($out);
}

if ($r === 'fulfilment' && $method === 'POST') {
    $b = store_body();
    $status = (string)($b['status'] ?? '');
    if (!in_array($status, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        store_fail('invalid_status');
    }
    $orderId = (int)($b['order_id'] ?? 0);
    $db->prepare('update orders set fulfilment_status = ?,
                    fulfilled_at = case when ? = \'delivered\' then now() else fulfilled_at end
                  where id = ?')
       ->execute([$status, $status, $orderId]);
    // Tell the customer it is on its way. Only on 'shipped': 'packed' is an
    // internal state that means nothing to a shopper, and 'delivered' arrives
    // after they are holding the bag. The unique index makes this safe to call
    // again when an order is re-marked, which the admin screen allows.
    if ($status === 'shipped') store_queue_whatsapp($db, $orderId, 'shipped');
    // And ask what they thought, once it is actually in their hands. 'delivered'
    // is the only honest moment for this: a review invitation that arrives
    // while the order is still with the courier is asking someone to rate a
    // parcel they have not opened. The unique index on (order_id, kind) makes
    // re-marking an order safe — the admin screen allows it, and it must not
    // send a second invitation.
    if ($status === 'delivered') store_queue_whatsapp($db, $orderId, 'review');
    store_out(['ok' => true]);
}

// Settle (or un-settle) a cash order. The one narrow path that may touch
// payment_status, same as admin_set_cod_paid: card payments are confirmed by
// the bank's callback, never by a person with an admin session.
if ($r === 'cod_paid' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    $paid = (bool)($b['paid'] ?? true);
    $q = $db->prepare('select payment_method, payment_status from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] !== 'cod') store_fail('not_a_cash_order');
    if ($paid  && $o['payment_status'] !== 'pending') store_fail('order_not_pending');
    if (!$paid && $o['payment_status'] !== 'paid')    store_fail('order_not_paid');

    $db->beginTransaction();
    try {
        $db->prepare('update orders set payment_status = ?, paid_at = ? where id = ?')
           ->execute([$paid ? 'paid' : 'pending', $paid ? date('Y-m-d H:i:s') : null, $id]);
        // Cash collected is a settled outcome: the warehouse follow-up fires
        // exactly as it does when the bank confirms a card.
        if ($paid) store_payment_settled($db, $id, 'paid');
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// A card payment the bank took but the callback never reported.
//
// This is the one real gap the KNET flow leaves, and it is not hypothetical:
// KPG hands the result back through the CUSTOMER's browser, so a shopper who
// pays and then closes the tab, loses signal in a lift, or is bounced by a
// flaky redirect leaves the money captured at the bank and the order sitting
// at 'pending' — or at 'review', where callback.php parks anything it could
// not verify. Until now the admin had a warning telling them to check the KNET
// portal and NO control that could act on what they found there; cod_paid
// refuses cards by design, because an admin session must not be able to
// declare a card paid on a hunch.
//
// So: settling a card requires the bank's own payment id, typed in. That is
// the forcing function — you cannot fill it in without having opened the KNET
// portal and found the transaction. It is stored, and the status is recorded
// as MANUAL_BANK_CONFIRMED so a manual settlement can never be mistaken for
// the bank's own callback when the books are read later.
if ($r === 'card_settled' && $method === 'POST') {
    $b = store_body();
    $id  = (int)($b['order_id'] ?? 0);
    $ref = trim((string)($b['bank_reference'] ?? ''));

    $q = $db->prepare('select payment_method, payment_status, cbk_paymentid from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] === 'cod')  store_fail('not_a_card_order');
    if ($o['payment_status'] === 'paid') store_fail('order_already_paid');
    // Long enough that it cannot be a shrug. KNET payment ids are numeric and
    // ~12 digits; this stays permissive about format because acquirers differ,
    // but not about the field being filled in.
    if (strlen($ref) < 6 || strlen($ref) > 60) store_fail('bank_reference_required');

    $db->beginTransaction();
    try {
        $db->prepare(
            "update orders set payment_status = 'paid', paid_at = ?,
                    cbk_status = 'MANUAL_BANK_CONFIRMED',
                    cbk_paymentid = ?, cbk_message = ?
              where id = ? and payment_status <> 'paid'"
        )->execute([
            date('Y-m-d H:i:s'),
            $ref,
            'settled in admin by ' . (string)($_SESSION['admin_email'] ?? '?'),
            $id,
        ]);
        store_payment_settled($db, $id, 'paid');
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at, cbk_status, cbk_paymentid from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// ---------------------------------------------------------------- products
// The product editor. `sync` pushes the whole shipped catalogue; this is the
// single-row companion — add a piece, change a price, take one off sale.
if ($r === 'products_all') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                image, active
           from products order by id desc'
    )->fetchAll());
}

if ($r === 'product_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 160);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 160);
    // THE PRICE IS MONEY. Same three-decimal discipline the order path uses:
    // KWD has exactly three, and a price that arrives as 10.5 must be stored
    // as 10.500 or the fils quietly disappear.
    $price = (float)($b['price'] ?? 0);
    if ($price <= 0 || $price > 9999999) store_fail('invalid_price');
    $price = number_format($price, 3, '.', '');
    $active = array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1;

    // The sale price. Optional, and only meaningful BELOW the list price — a
    // "sale" above it would quietly overcharge, which is the kind of mistake
    // nobody reports because the customer just leaves. Refused here rather
    // than ignored at read time, so the admin says so instead of saving
    // something that does nothing.
    $salePrice = $b['sale_price'] ?? null;
    if ($salePrice === '' || $salePrice === null) {
        $salePrice = null;
        $saleFrom = $saleTo = null;
    } else {
        $salePrice = (float)$salePrice;
        if ($salePrice <= 0)              store_fail('invalid_sale_price');
        if ($salePrice >= (float)$price)  store_fail('sale_not_lower');
        $salePrice = number_format($salePrice, 3, '.', '');
        $saleFrom = store_datetime($b['sale_starts_at'] ?? null);
        $saleTo   = store_datetime($b['sale_ends_at'] ?? null);
        if ($saleFrom !== null && $saleTo !== null && $saleFrom > $saleTo) store_fail('sale_dates_backwards');
    }
    $featured = !empty($b['featured']) ? 1 : 0;
    $featuredSort = (int)($b['featured_sort'] ?? 0);

    // WHICH BRAND MADE IT. Checked against the brands table rather than stored
    // as typed: a slug with a typo would silently show no brand on the product
    // page, and "the logo did not appear" is a much harder thing to diagnose
    // than a save that refused. Empty clears it, which is how a product goes
    // back to having no brand.
    // EXTRA PHOTOGRAPHS, as a comma-separated list of same-origin paths.
    // store_internal_href is the same gate the hero buttons pass: a leading //
    // is a HOSTNAME, not a path, so an off-site URL cannot be spelled here.
    // Blank entries are dropped rather than becoming empty <img> tags.
    $extraImages = null;
    $rawImages = trim((string)($b['images'] ?? ''));
    if ($rawImages !== '') {
        $clean = [];
        foreach (explode(',', $rawImages) as $one) {
            $one = trim($one);
            if ($one === '') continue;
            $clean[] = store_internal_href($one);
        }
        $extraImages = $clean ? implode(',', $clean) : null;
    }

    $brandSlug = trim((string)($b['brand_slug'] ?? ''));
    if ($brandSlug === '') {
        $brandSlug = null;
    } else {
        $q = $db->prepare('select 1 from brands where slug = ?');
        $q->execute([$brandSlug]);
        if (!$q->fetchColumn()) store_fail('unknown_brand');
    }

    try {
        if ($id > 0) {
            $db->prepare(
                'update products set slug = ?, name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?,
                        price = ?, sale_price = ?, sale_starts_at = ?, sale_ends_at = ?,
                        featured = ?, featured_sort = ?, category = ?, brand_slug = ?, image = ?, images = ?, active = ?
                  where id = ?'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        store_opt($b['image'] ?? null), $extraImages, $active, $id]);
        } else {
            $db->prepare(
                'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                        sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                        image, images, active)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        store_opt($b['image'] ?? null), $extraImages, $active]);
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug, image,
                images, active from products where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Take a product off sale. NOT a delete: order_items point at products by id,
// and a shop that deletes a sold product loses the line on every invoice that
// ever contained it. `active = 0` hides it from the storefront and keeps the
// history intact — the same reasoning as brands.
if ($r === 'product_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $db->prepare('update products set active = ? where id = ?')
       ->execute([empty($b['active']) ? 0 : 1, $id]);
    $q = $db->prepare('select id, slug, active from products where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('product_not_found');
    store_out($row);
}

// ------------------------------------------------------------------ brands
// The admin sees EVERY brand, disabled ones included — a switch you cannot
// see is a switch you cannot turn back on.
if ($r === 'brands') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, logo, active, sort from brands order by sort, name_en'
    )->fetchAll());
}

// Create or rename a brand. One route for both: the admin screen has one form
// and the difference is whether an id came with it.
if ($r === 'brand_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 80);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 80);
    $slug = store_slug((string)($b['slug'] ?? '')) ?: store_slug($nameEn);
    if ($slug === '') store_fail('invalid_slug');
    $sort = (int)($b['sort'] ?? 0);
    // Absent means "leave the logo alone"; empty string means "remove it".
    $hasLogo = array_key_exists('logo', $b);
    $logo = $hasLogo ? store_data_image($b['logo']) : null;

    try {
        if ($id > 0) {
            $sql = 'update brands set slug = ?, name_en = ?, name_ar = ?, sort = ?'
                 . ($hasLogo ? ', logo = ?' : '') . ' where id = ?';
            $args = $hasLogo ? [$slug, $nameEn, $nameAr, $sort, $logo, $id]
                             : [$slug, $nameEn, $nameAr, $sort, $id];
            $db->prepare($sql)->execute($args);
        } else {
            $db->prepare('insert into brands (slug, name_en, name_ar, logo, sort) values (?, ?, ?, ?, ?)')
               ->execute([$slug, $nameEn, $nameAr, $logo, $sort]);
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        // The slug is unique, and two brands with one slug is a storefront
        // filter that shows the wrong things — name the clash, do not 500.
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, logo, active, sort from brands where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Show it, or stop showing it. Never a delete: a brand with orders behind it
// is history, and disabling is the reversible answer.
if ($r === 'brand_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['active']);
    $db->prepare('update brands set active = ? where id = ?')->execute([$on ? 1 : 0, $id]);
    $q = $db->prepare('select id, slug, active from brands where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('brand_not_found');
    store_out($row);
}

if ($r === 'customer' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    // Column allowlist — an admin edits the delivery details, not the money.
    $allowed = ['customer_name','customer_phone','customer_governorate','customer_area',
                'customer_block','customer_street','customer_building',
                'customer_floor','customer_flat','customer_note'];
    $sets = []; $args = [];
    foreach (($b['fields'] ?? []) as $k => $v) {
        if (in_array($k, $allowed, true)) { $sets[] = "`$k` = ?"; $args[] = $v === '' ? null : (string)$v; }
    }
    if (!$sets) store_fail('nothing_to_update');
    $args[] = $id;
    $db->prepare('update orders set ' . implode(', ', $sets) . ' where id = ?')->execute($args);
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- catalogue
if ($r === 'products_state') {
    store_out($db->query('select slug, price, active from products')->fetchAll());
}

if ($r === 'sync' && $method === 'POST') {
    // Upsert on slug, exactly like syncCatalog expects. The rows come
    // from the shipped catalogue via the admin UI; prices here are what
    // checkout charges, which is the entire reason this screen exists.
    $rows = store_body()['rows'] ?? [];
    if (!is_array($rows) || !$rows) store_fail('empty');
    $up = $db->prepare(
        'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, category, image, active)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on duplicate key update name_en = values(name_en), name_ar = values(name_ar),
           desc_en = values(desc_en), desc_ar = values(desc_ar), price = values(price),
           category = values(category), active = values(active)'
    );
    $n = 0;
    $db->beginTransaction();
    try {
        foreach ($rows as $p) {
            if (!is_array($p) || empty($p['slug'])) continue;
            $up->execute([
                (string)$p['slug'], (string)($p['name_en'] ?? ''), (string)($p['name_ar'] ?? ''),
                $p['desc_en'] ?? null, $p['desc_ar'] ?? null,
                number_format((float)($p['price'] ?? 0), 3, '.', ''),
                $p['category'] ?? null, $p['image'] ?? null,
                !empty($p['active']) ? 1 : 0,
            ]);
            $n++;
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    store_out(['count' => $n]);
}

// -------------------------------------------------------------------- stock
if ($r === 'variants') {
    // cost_aed IS included here — this is the admin, behind the session; the
    // public ?r=stock endpoint is the one that must never select it.
    $rows = $db->query(
        'select v.sku, v.slug, p.name_en, v.size, v.stock, v.cost_aed
           from product_variants v left join products p on p.slug = v.slug
          order by v.slug, v.size'
    )->fetchAll();
    foreach ($rows as &$row) { $row['stock'] = (int)$row['stock']; }
    store_out($rows);
}

if ($r === 'set_stock' && $method === 'POST') {
    $b = store_body();
    $stock = (int)($b['stock'] ?? -1);
    if ($stock < 0) store_fail('stock_cannot_be_negative');
    // The RPC discipline kept: only the count moves. Not the SKU, not the
    // slug, not the cost.
    $q = $db->prepare('update product_variants set stock = ? where sku = ?');
    $q->execute([$stock, (string)($b['sku'] ?? '')]);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from product_variants where sku = ?');
        $chk->execute([(string)($b['sku'] ?? '')]);
        if (!$chk->fetch()) store_fail('sku_not_found');
    }
    $q2 = $db->prepare('select sku, slug, size, stock from product_variants where sku = ?');
    $q2->execute([(string)($b['sku'] ?? '')]);
    store_out($q2->fetch());
}

// ------------------------------------------------------------------- slides
// The home hero. The photograph lives in the ROW, not on disk — the same rule
// the brand logos follow, and for the same reason: an endpoint that writes
// into the web root is a way in, and this server already hosted one.
//
// The admin sends the image already downscaled and re-encoded to WebP in the
// browser, so a 12-megapixel phone photo becomes ~200 kB before it is ever
// uploaded. store_data_image() is the floor under that, because a client-side
// limit is a suggestion.
if ($r === 'slides') {
    $rows = $db->query(
        'select id, sort, active, title_en, title_ar, subtitle_en, subtitle_ar,
                cta_label_en, cta_label_ar, cta_href, image_hash, image_w, image_h,
                focal_x, focal_y, updated_at
           from hero_slides order by sort, id'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['sort'] = (int)$row['sort'];
        $row['focal_x'] = (int)$row['focal_x'];
        $row['focal_y'] = (int)$row['focal_y'];
        // The admin gets the same cacheable URL the storefront gets, rather
        // than a megabyte of base64 per slide in a list response.
        $row['image'] = $row['image_hash']
            ? 'api.php?r=slide_image&id=' . $row['id'] . '&v=' . substr((string)$row['image_hash'], 0, 16)
            : null;
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);
    store_out(['slides' => $rows, 'hero' => store_setting($db, 'hero')]);
}

if ($r === 'slide_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);

    // A slide with no photograph is a blank panel on the home page. The image
    // is required on CREATE; on edit, omitting it keeps the one already there
    // rather than wiping it, so changing a caption cannot lose the artwork.
    $image = null;
    if (($b['image'] ?? '') !== '') {
        $image = store_data_image((string)$b['image'], STORE_HERO_MAX);
    } elseif ($id === 0) {
        store_fail('image_required');
    }

    $focalX = max(0, min(100, (int)($b['focal_x'] ?? 50)));
    $focalY = max(0, min(100, (int)($b['focal_y'] ?? 50)));
    $fields = [
        'title_en'     => store_opt($b['title_en'] ?? null),
        'title_ar'     => store_opt($b['title_ar'] ?? null),
        'subtitle_en'  => store_opt($b['subtitle_en'] ?? null),
        'subtitle_ar'  => store_opt($b['subtitle_ar'] ?? null),
        'cta_label_en' => store_opt($b['cta_label_en'] ?? null),
        'cta_label_ar' => store_opt($b['cta_label_ar'] ?? null),
        // Same-origin paths only. A hero button is the most prominent link on
        // the site, so it may not be pointed at somebody else's domain from a
        // form — that is a redirect the shop's own design would be lending
        // credibility to.
        'cta_href'     => store_internal_href($b['cta_href'] ?? null),
        'active'       => !empty($b['active']) ? 1 : 0,
        'sort'         => (int)($b['sort'] ?? 0),
        'focal_x'      => $focalX,
        'focal_y'      => $focalY,
    ];
    if ($image !== null) {
        $fields['image'] = $image;
        // The hash is the cache key the storefront URL carries, so a replaced
        // photograph is a different URL and appears at once despite the
        // one-year immutable cache on the old one.
        $fields['image_hash'] = hash('sha256', $image);
        $fields['image_w'] = (int)($b['width'] ?? 0) ?: null;
        $fields['image_h'] = (int)($b['height'] ?? 0) ?: null;
    }

    $cols = array_keys($fields);
    if ($id > 0) {
        $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
        $db->prepare("update hero_slides set $set where id = ?")
           ->execute([...array_values($fields), $id]);
    } else {
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        $db->prepare('insert into hero_slides (' . implode(', ', $cols) . ") values ($ph)")
           ->execute(array_values($fields));
        $id = (int)$db->lastInsertId();
    }
    store_out(['id' => $id]);
}

if ($r === 'slide_delete' && $method === 'POST') {
    $b = store_body();
    // Slides are genuinely deletable, unlike products and brands: nothing
    // points at one. No order, no invoice and no history refers to a slide, so
    // removing it loses nothing but the picture.
    $db->prepare('delete from hero_slides where id = ?')->execute([(int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// Reorder in one call. Sending the whole order at once means the list can
// never be left half-renumbered by a failed second request.
if ($r === 'slide_reorder' && $method === 'POST') {
    $ids = store_body()['ids'] ?? [];
    if (!is_array($ids)) store_fail('bad_request');
    $db->beginTransaction();
    $up = $db->prepare('update hero_slides set sort = ? where id = ?');
    foreach (array_values($ids) as $i => $id) $up->execute([$i, (int)$id]);
    $db->commit();
    store_out(['ok' => true]);
}

// ------------------------------------------------------------------ settings
// How the slider plays, and the promo bar. Whitelisted by name and rebuilt
// field by field: a settings endpoint that stores whatever JSON it is handed
// is a place to park arbitrary data inside the shop's own configuration.
if ($r === 'settings_save' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    $v = is_array($b['value'] ?? null) ? $b['value'] : [];

    if ($name === 'hero') {
        store_setting_save($db, 'hero', [
            // 2s floor: anything faster is unreadable, and WCAG 2.2.2 wants
            // moving content to be pausable, not merely slow. 30s ceiling
            // because past that the second slide is never seen.
            'speed_ms' => max(2000, min(30000, (int)($v['speed_ms'] ?? 6500))),
            'shuffle'  => !empty($v['shuffle']),
            'autoplay' => !empty($v['autoplay']),
            'size'     => in_array($v['size'] ?? '', ['short', 'tall', 'full'], true) ? $v['size'] : 'tall',
        ]);
    } elseif ($name === 'promo_bar') {
        store_setting_save($db, 'promo_bar', [
            'enabled'   => !empty($v['enabled']),
            'text_en'   => mb_substr(trim((string)($v['text_en'] ?? '')), 0, 160),
            'text_ar'   => mb_substr(trim((string)($v['text_ar'] ?? '')), 0, 160),
            'href'      => store_internal_href($v['href'] ?? null) ?? '',
            'starts_at' => store_datetime($v['starts_at'] ?? null),
            'ends_at'   => store_datetime($v['ends_at'] ?? null),
        ]);
    } else {
        store_fail('unknown_setting');
    }
    store_out(store_setting($db, $name));
}

// ------------------------------------------------------------- blocked numbers
// The manual half of the cash-on-delivery defence — see antifraud.mysql.sql.
// The automatic cap stops one number flooding the courier; this is where the
// owner records the number that already cost them three wasted trips.
if ($r === 'blocked') {
    store_out($db->query(
        'select id, phone, scope, reason, blocked_by, created_at
           from blocked_customers order by created_at desc limit 500'
    )->fetchAll());
}

if ($r === 'block_customer' && $method === 'POST') {
    $b = store_body();
    // Canonicalised with the SAME function the checkout uses, or the block is
    // recorded against a spelling the order path will never produce and
    // silently protects nothing.
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $scope = ($b['scope'] ?? 'cod') === 'all' ? 'all' : 'cod';
    $reason = mb_substr(trim((string)($b['reason'] ?? '')), 0, 200);

    $db->prepare(
        'insert into blocked_customers (phone, scope, reason, blocked_by) values (?, ?, ?, ?)
         on duplicate key update scope = values(scope), reason = values(reason),
                                 blocked_by = values(blocked_by)'
    )->execute([$phone, $scope, $reason === '' ? null : $reason,
                (string)($_SESSION['admin_email'] ?? '')]);
    store_out(['ok' => true, 'phone' => $phone, 'scope' => $scope]);
}

// Unblocking must be as easy as blocking. A block placed by mistake that
// cannot be undone from the same screen becomes a customer nobody can help.
if ($r === 'unblock_customer' && $method === 'POST') {
    $b = store_body();
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $db->prepare('delete from blocked_customers where phone = ?')->execute([$phone]);
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- discounts
if ($r === 'discounts') {
    $rows = $db->query('select * from discounts order by kind, code, id')->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['value'] = (float)$row['value'];
        $row['min_order'] = (float)$row['min_order'];
        $row['usage_limit'] = (int)$row['usage_limit'];
        $row['used_count'] = (int)$row['used_count'];
        $row['live'] = $row['active'] && store_window_open($row['starts_at'], $row['ends_at'])
            && ($row['usage_limit'] === 0 || $row['used_count'] < $row['usage_limit']);
    }
    unset($row);
    store_out($rows);
}

if ($r === 'discount_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $kind = ($b['kind'] ?? 'code') === 'auto' ? 'auto' : 'code';
    $type = ($b['type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';

    // Uppercase and stripped to A-Z0-9, so SAVE10 and save10 cannot both
    // exist and a code cannot carry a space the customer will never reproduce.
    $code = null;
    if ($kind === 'code') {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($b['code'] ?? '')));
        if (strlen($code) < 3 || strlen($code) > 24) store_fail('invalid_code');
    }

    $value = (float)($b['value'] ?? 0);
    // 90% is the per-rule ceiling; store_discounts_for caps the STACK at 60%
    // of the order. Both exist: one stops a typo ("100" meaning 10), the other
    // stops two sane rules adding up to a free order.
    if ($type === 'percent' && ($value < 1 || $value > 90)) store_fail('invalid_percent');
    if ($type === 'fixed' && ($value <= 0 || $value > 9999)) store_fail('invalid_amount');

    $fields = [
        'kind'        => $kind,
        'code'        => $code,
        'label'       => store_text($b['label'] ?? null, 'label', 2, 80),
        'type'        => $type,
        'value'       => number_format($value, 3, '.', ''),
        'min_order'   => number_format(max(0, (float)($b['min_order'] ?? 0)), 3, '.', ''),
        'category'    => store_opt($b['category'] ?? null),
        'starts_at'   => store_datetime($b['starts_at'] ?? null),
        'ends_at'     => store_datetime($b['ends_at'] ?? null),
        'usage_limit' => max(0, (int)($b['usage_limit'] ?? 0)),
        'active'      => !empty($b['active']) ? 1 : 0,
    ];
    if ($fields['starts_at'] !== null && $fields['ends_at'] !== null
        && $fields['starts_at'] > $fields['ends_at']) store_fail('sale_dates_backwards');

    $cols = array_keys($fields);
    try {
        if ($id > 0) {
            $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
            $db->prepare("update discounts set $set where id = ?")
               ->execute([...array_values($fields), $id]);
        } else {
            $ph = implode(', ', array_fill(0, count($cols), '?'));
            $db->prepare('insert into discounts (' . implode(', ', $cols) . ") values ($ph)")
               ->execute(array_values($fields));
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('code_taken');
        throw $e;
    }
    $q = $db->prepare('select * from discounts where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Switched off, never deleted while it has been used: orders reference the
// code they were given, and a report that cannot explain why an order was
// 3 KWD cheaper is a report nobody trusts.
if ($r === 'discount_active' && $method === 'POST') {
    $b = store_body();
    $db->prepare('update discounts set active = ? where id = ?')
       ->execute([!empty($b['active']) ? 1 : 0, (int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

if ($r === 'discount_delete' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $q = $db->prepare('select code from discounts where id = ?');
    $q->execute([$id]);
    $code = $q->fetchColumn();
    if ($code !== false && $code !== null) {
        $u = $db->prepare('select count(*) from orders where discount_code = ?');
        $u->execute([$code]);
        if ((int)$u->fetchColumn() > 0) store_fail('discount_in_use', 409);
    }
    $db->prepare('delete from discounts where id = ?')->execute([$id]);
    store_out(['ok' => true]);
}

store_fail('not_found', 404);
