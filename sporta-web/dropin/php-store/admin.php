<?php
// Sporta native admin API — what the React /admin calls in native mode.
// Place at public_html/api/. Every route below ?r=login requires the session.
//
// The shapes returned here are the SAME shapes admin/api.js already hands the
// screens from Supabase — stats keys, order columns, nested product names on
// items — so the admin UI does not know or care which backend it is on. The
// contract is the UI's, not the database's.

declare(strict_types=1);
require __DIR__ . '/store.php';

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = store_db();

// ------------------------------------------------------------------- session
if ($r === 'login' && $method === 'POST') {
    $b = store_body();
    $who = store_login((string)($b['email'] ?? ''), (string)($b['password'] ?? ''));
    store_out(['email' => $who['email']]);
}

if ($r === 'logout' && $method === 'POST') {
    store_session_start();
    $_SESSION = [];
    session_destroy();
    store_out(['ok' => true]);
}

if ($r === 'me') {
    store_session_start();
    if (empty($_SESSION['admin_id'])) store_out(null);
    store_out(['email' => $_SESSION['admin_email'] ?? '']);
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
                   cbk_paymentid, cbk_reference, cbk_status
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
    // Nested `products` object, matching the supabase-js join shape the Orders
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
    $db->prepare('update orders set fulfilment_status = ?,
                    fulfilled_at = case when ? = \'delivered\' then now() else fulfilled_at end
                  where id = ?')
       ->execute([$status, $status, (int)($b['order_id'] ?? 0)]);
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
    // Upsert on slug, exactly like the Supabase syncCatalog. The rows come
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

store_fail('not_found', 404);
