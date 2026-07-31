<?php
// Sporta native store API — the endpoints the STOREFRONT calls.
// Place at public_html/api/. Routes:
//
//   GET  ?r=products            active catalogue (what loadProducts reads)
//   GET  ?r=stock               per-size availability (never the cost column)
//   POST ?r=order               create an order — the port of create_order
//   GET  ?r=status&id=TRACK     payment status for the result/track pages
//   GET  ?r=invoice&id=TRACK    the printable invoice document
//
// No authentication on these, deliberately, and the same reasoning as the
// Supabase grants they replace: the catalogue and stock are shop-window data,
// and the ORDER NUMBER is the credential for status and invoice — ~64 bits
// from crypto.getRandomValues, exactly as get_order_status has worked since
// day one. What the invoice returns is scoped accordingly (no phone number).

declare(strict_types=1);
require __DIR__ . '/store.php';

$r = $_GET['r'] ?? '';
$db = store_db();

// ---------------------------------------------------------------- products
if ($r === 'products') {
    $rows = $db->query(
        'select slug, name_en, name_ar, desc_en, desc_ar, price, category, image
           from products where active = 1 order by name_en'
    )->fetchAll();
    foreach ($rows as &$row) $row['price'] = (float)$row['price'];
    store_out($rows);
}

// ------------------------------------------------------------------- stock
if ($r === 'stock') {
    // Same columns as the product_stock view — and NOT cost_aed, which is the
    // one commercially sensitive number in the schema.
    $rows = $db->query(
        'select slug, size, sku, stock, (stock > 0) as in_stock from product_variants'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['stock'] = (int)$row['stock'];
        $row['in_stock'] = (bool)$row['in_stock'];
    }
    store_out($rows);
}

// ------------------------------------------------------------------- status
if ($r === 'status') {
    $q = $db->prepare('select payment_status, payment_method, amount from orders where track_id = ?');
    $q->execute([trim((string)($_GET['id'] ?? ''))]);
    $row = $q->fetch();
    if (!$row) store_out(null);
    $row['amount'] = (float)$row['amount'];
    store_out($row);
}

// ------------------------------------------------------------------ invoice
if ($r === 'invoice') {
    $q = $db->prepare('select * from orders where track_id = ?');
    $q->execute([trim((string)($_GET['id'] ?? ''))]);
    $o = $q->fetch();
    if (!$o) store_out(null);
    $it = $db->prepare(
        'select p.name_en, p.name_ar, oi.qty, oi.size, oi.fit, oi.unit_price,
                (oi.unit_price * oi.qty) as line_total
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by p.name_en, oi.size'
    );
    $it->execute([$o['id']]);
    $items = $it->fetchAll();
    foreach ($items as &$row) {
        $row['qty'] = (int)$row['qty'];
        $row['unit_price'] = (float)$row['unit_price'];
        $row['line_total'] = (float)$row['line_total'];
    }
    // Same shape as get_order_invoice, and the same deliberate omission: the
    // phone number is not on an invoice — the customer knows their own.
    store_out([
        'track_id'       => $o['track_id'],
        'placed_at'      => $o['created_at'],
        'paid_at'        => $o['paid_at'],
        'amount'         => (float)$o['amount'],
        'payment_method' => $o['payment_method'],
        'payment_status' => $o['payment_status'],
        'customer_name'  => $o['customer_name'],
        'address'        => [
            'governorate' => $o['customer_governorate'],
            'area'        => $o['customer_area'],
            'block'       => $o['customer_block'],
            'street'      => $o['customer_street'],
            'building'    => $o['customer_building'],
            'floor'       => $o['customer_floor'],
            'flat'        => $o['customer_flat'],
        ],
        'items'          => $items,
    ]);
}

// -------------------------------------------------------------------- order
// The port of create_order — same validation, same tokens, same idempotency,
// same server-side pricing. The browser never sends a price and never will.
if ($r === 'order' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $b = store_body();

    $track = trim((string)($b['track_id'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9]{6,30}$/', $track)) store_fail('invalid_track_id');

    $method = strtolower(trim((string)($b['payment_method'] ?? 'knet')));
    if (!in_array($method, STORE_PAY_METHODS, true)) store_fail('invalid_payment_method');

    // Idempotency FIRST: a double tap or a bank-page retry returns the pending
    // order it already created instead of a second one. The storefront's
    // attemptTrackId() keeps the id stable per attempt; this is the other half.
    $q = $db->prepare('select id, amount, payment_status from orders where track_id = ?');
    $q->execute([$track]);
    if ($existing = $q->fetch()) {
        if ($existing['payment_status'] !== 'pending') store_fail('order_not_pending');
        store_out(['order_id' => (int)$existing['id'], 'track_id' => $track,
                   'amount' => (float)$existing['amount'], 'payment_method' => $method]);
    }

    $items = $b['items'] ?? null;
    if (!is_array($items) || count($items) === 0) store_fail('empty_cart');
    if (count($items) > 50) store_fail('cart_too_large');

    $customer = is_array($b['customer'] ?? null) ? $b['customer'] : [];
    $phone = store_phone($customer['phone'] ?? null);
    if ($phone === null) store_fail('invalid_phone');
    $gov = trim((string)($customer['governorate'] ?? ''));
    if (!in_array($gov, STORE_GOVERNORATES, true)) store_fail('invalid_governorate');

    $name     = store_text($customer['name'] ?? null,     'name',     2, 80);
    $area     = store_text($customer['area'] ?? null,     'area',     2, 60);
    $block    = store_text($customer['block'] ?? null,    'block',    1, 12);
    $street   = store_text($customer['street'] ?? null,   'street',   1, 40);
    $building = store_text($customer['building'] ?? null, 'building', 1, 24);

    // Validate every line BEFORE the transaction opens, so a bad cart rejects
    // cleanly with the token naming the problem, not a rolled-back mystery.
    $lines = [];
    foreach ($items as $item) {
        $qty = (int)($item['qty'] ?? 1);
        if ($qty < 1 || $qty > 99) store_fail('invalid_qty');

        $size = strtoupper(trim((string)($item['size'] ?? '')));
        $fit  = strtolower(trim((string)($item['fit'] ?? '')));
        // Rejected, never silently dropped — a dropped size is an order that
        // looks complete and does not say which size to pack.
        if ($size !== '' && !in_array($size, STORE_SIZES, true)) store_fail('invalid_size');
        if ($fit  !== '' && !in_array($fit,  STORE_FITS,  true)) store_fail('invalid_fit');

        $p = $db->prepare('select id, price from products where slug = ? and active = 1');
        $p->execute([(string)($item['slug'] ?? '')]);
        $prod = $p->fetch();
        if (!$prod) store_fail('unavailable_' . (string)($item['slug'] ?? '?'));

        $lines[] = [
            'product_id' => (int)$prod['id'],
            'qty'        => $qty,
            // THE price. From the table, at order time. Nothing the browser
            // sent has been near this number.
            'unit_price' => (string)$prod['price'],
            'size'       => $size === '' ? null : $size,
            'fit'        => $fit === '' ? null : $fit,
        ];
    }

    $db->beginTransaction();
    try {
        $db->prepare(
            'insert into orders (track_id, payment_status, payment_method,
               customer_name, customer_phone, customer_governorate, customer_area,
               customer_block, customer_street, customer_building,
               customer_floor, customer_flat, customer_note)
             values (?, \'pending\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $track, $method, $name, $phone, $gov, $area, $block, $street, $building,
            store_opt($customer['floor'] ?? null),
            store_opt($customer['flat'] ?? null),
            store_opt($customer['note'] ?? null),
        ]);
        $orderId = (int)$db->lastInsertId();

        // Money in INTEGER FILS, not floats and not bcmath. KWD has exactly
        // three decimal places, so 10.000 KWD is 10000 fils and integer
        // arithmetic is exact; bcmath would also be exact but is a compiled-in
        // extension this must not depend on — shared hosting decides what PHP
        // has, not this file.
        $amountFils = 0;
        $ins = $db->prepare(
            'insert into order_items (order_id, product_id, qty, unit_price, size, fit)
             values (?, ?, ?, ?, ?, ?)'
        );
        foreach ($lines as $l) {
            $ins->execute([$orderId, $l['product_id'], $l['qty'], $l['unit_price'], $l['size'], $l['fit']]);
            $amountFils += (int)round(((float)$l['unit_price']) * 1000) * $l['qty'];
        }
        if ($amountFils <= 0) store_fail('zero_amount');
        $amount = number_format($amountFils / 1000, 3, '.', '');
        $db->prepare('update orders set amount = ? where id = ?')->execute([$amount, $orderId]);

        // The warehouse message, in the SAME transaction as the order — the
        // whole point of the outbox. If the order exists, its message exists.
        store_queue_fulfilment($db, $orderId, 'new');

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        // A duplicate track id racing itself lands here via the unique index;
        // re-read and answer idempotently rather than failing the second tap.
        $q->execute([$track]);
        if ($row = $q->fetch()) {
            store_out(['order_id' => (int)$row['id'], 'track_id' => $track,
                       'amount' => (float)$row['amount'], 'payment_method' => $method]);
        }
        store_fail('failed', 500);
    }

    store_out(['order_id' => $orderId, 'track_id' => $track,
               'amount' => (float)$amount, 'payment_method' => $method]);
}

store_fail('not_found', 404);
