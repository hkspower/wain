<?php
declare(strict_types=1);

function returns_request_body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if ($raw === false || strlen($raw) > 8192) store_fail('request_too_large', 413);
    $body = json_decode($raw, true);
    if (!is_array($body) || array_is_list($body)) store_fail('invalid_json');
    return $body;
}

// An order number alone only grants the existing, deliberately small tracking
// response. Return requests reveal purchases and history, so both the order
// number and the phone recorded at checkout must match. A registered account
// is never inferred from a phone number.
function returns_verified_order(PDO $db, array $body, bool $lock = false): ?array {
    $track = $body['track_id'] ?? null;
    $phone = $body['phone'] ?? null;
    if (!is_string($track) || !is_string($phone) || strlen($phone) > 32) return null;
    $track = strtoupper(trim($track));
    if (!preg_match('/^[A-Z0-9]{6,30}$/D', $track)) return null;
    $canonical = store_phone($phone);
    if ($canonical === null) return null;
    $q = $db->prepare('select id, track_id, customer_phone, customer_name, payment_status,
                             payment_method, fulfilment_status, fulfilled_at, created_at,
                             timestampdiff(second, fulfilled_at, now()) as delivery_age_seconds
                        from orders where track_id = ?' . ($lock ? ' for update' : ''));
    $q->execute([$track]);
    $order = $q->fetch(PDO::FETCH_ASSOC);
    if (!$order) return null;
    $recorded = store_phone((string)($order['customer_phone'] ?? ''));
    if ($recorded === null || !hash_equals($recorded, $canonical)) return null;
    $order['id'] = (int)$order['id'];
    $order['contact_phone'] = $canonical;
    return $order;
}

// The timestamp is advisory: historical orders can have no delivery stamp and
// an admin may re-mark an order delivered. All claims still receive human
// review; an older/unknown date is routed to manual review, not refused.
function returns_eligibility(array $order): string {
    if (($order['fulfilment_status'] ?? '') !== 'delivered') return 'not_delivered';
    // Both operands are evaluated by the same MariaDB session, so this avoids
    // interpreting a timezone-less TIMESTAMP in a different PHP timezone.
    $age = $order['delivery_age_seconds'] ?? null;
    if ($age === null || !is_numeric($age) || (int)$age < 0 || (int)$age > 14 * 86400) {
        return 'manual_review';
    }
    return 'standard';
}

function returns_reserved_quantities(PDO $db, int $orderId): array {
    $q = $db->prepare("select ri.order_item_id, sum(ri.qty) as reserved_qty
                         from return_request_items ri
                         join return_requests rr on rr.id = ri.request_id
                        where rr.order_id = ? and rr.status not in ('declined','cancelled')
                        group by ri.order_item_id");
    $q->execute([$orderId]);
    $out = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) $out[(int)$row['order_item_id']] = (int)$row['reserved_qty'];
    return $out;
}

function returns_order_items(PDO $db, int $orderId, bool $withRemaining = true): array {
    $q = $db->prepare('select oi.id, oi.qty, oi.size, oi.fit, oi.unit_price,
                             coalesce(oi.name_en, p.name_en) as name_en,
                             coalesce(oi.name_ar, p.name_ar) as name_ar,
                             p.slug
                        from order_items oi left join products p on p.id = oi.product_id
                       where oi.order_id = ? order by oi.id');
    $q->execute([$orderId]);
    $reserved = $withRemaining ? returns_reserved_quantities($db, $orderId) : [];
    $out = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['id'] = (int)$row['id'];
        $row['qty'] = (int)$row['qty'];
        $row['unit_price'] = (float)$row['unit_price'];
        if ($withRemaining) $row['remaining_qty'] = max(0, $row['qty'] - ($reserved[$row['id']] ?? 0));
        $out[] = $row;
    }
    return $out;
}

function returns_public_request_items(PDO $db, array $ids): array {
    if (!$ids) return [];
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $q = $db->prepare('select request_id, order_item_id, qty, action, reason, requested_size,
                             name_en, name_ar, original_size, original_fit
                        from return_request_items where request_id in (' . $marks . ') order by id');
    $q->execute($ids);
    $out = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $id = (int)$row['request_id'];
        unset($row['request_id']);
        $row['order_item_id'] = (int)$row['order_item_id'];
        $row['qty'] = (int)$row['qty'];
        $out[$id][] = $row;
    }
    return $out;
}

function returns_public_history(PDO $db, int $orderId): array {
    $q = $db->prepare('select id, reference, status, eligibility, created_at, updated_at
                        from return_requests where order_id = ? order by id desc limit 50');
    $q->execute([$orderId]);
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    $byId = returns_public_request_items($db, array_map(static fn ($r) => (int)$r['id'], $rows));
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['items'] = $byId[$row['id']] ?? [];
    }
    unset($row);
    return $rows;
}

function returns_lookup(PDO $db, array $body): ?array {
    $order = returns_verified_order($db, $body);
    if (!$order) return null;
    return ['order' => [
        'track_id' => $order['track_id'],
        'fulfilment_status' => $order['fulfilment_status'],
        'delivered_at' => $order['fulfilled_at'],
        'eligibility' => returns_eligibility($order),
        'items' => returns_order_items($db, $order['id']),
    ], 'requests' => returns_public_history($db, $order['id'])];
}

function returns_submission_input(array $body): array {
    $items = $body['items'] ?? null;
    $note = $body['note'] ?? '';
    if (!is_array($items) || !array_is_list($items) || count($items) > 20
        || !is_string($note)) return ['error' => 'invalid_items'];
    $note = trim($note);
    if (mb_strlen($note) > 1000 || preg_match('/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', $note)) {
        return ['error' => 'invalid_note'];
    }
    $clean = [];
    $seen = [];
    foreach ($items as $item) {
        if (!is_array($item) || !is_int($item['order_item_id'] ?? null)
            || $item['order_item_id'] <= 0 || !is_int($item['qty'] ?? null)
            || $item['qty'] < 1 || $item['qty'] > 99
            || !is_string($item['action'] ?? null) || !in_array($item['action'], ['return','exchange'], true)
            || !is_string($item['reason'] ?? null)
            || !in_array($item['reason'], ['size','damaged','not_as_described','changed_mind','other'], true)) {
            return ['error' => 'invalid_items'];
        }
        $id = $item['order_item_id'];
        if (isset($seen[$id])) return ['error' => 'duplicate_request'];
        $seen[$id] = true;
        $size = $item['requested_size'] ?? null;
        if ($size === '') $size = null;
        if ($item['action'] === 'exchange') {
            if ($size !== null && (!is_string($size) || !in_array($size, STORE_SIZES, true))) {
                return ['error' => 'invalid_size'];
            }
        } elseif ($size !== null) return ['error' => 'invalid_size'];
        $clean[] = ['order_item_id' => $id, 'qty' => $item['qty'], 'action' => $item['action'],
            'reason' => $item['reason'], 'requested_size' => $size];
    }
    return ['items' => $clean, 'note' => $note];
}

function returns_submit(PDO $db, array $body): array {
    $input = returns_submission_input($body);
    if (isset($input['error'])) throw new InvalidArgumentException($input['error']);
    $db->beginTransaction();
    try {
        // Lock the parent order so two concurrent claims cannot both observe
        // the same remaining quantity before either inserts its request.
        $order = returns_verified_order($db, $body, true);
        if (!$order) throw new InvalidArgumentException('order_not_found');
        $eligibility = returns_eligibility($order);
        if ($eligibility === 'not_delivered') throw new InvalidArgumentException('not_delivered');
        $purchased = returns_order_items($db, $order['id']);
        $byId = [];
        foreach ($purchased as $row) $byId[$row['id']] = $row;
        if (!$purchased) {
            // Some legacy orders have no order_items. Let the verified buyer
            // create a trackable manual case with a useful description.
            if ($input['items'] || mb_strlen($input['note']) < 10) {
                throw new InvalidArgumentException('manual_description_required');
            }
            // There is no order_item_id to reserve on an old empty-line order.
            // Keep one active manual case per order until staff close it.
            $open = $db->prepare("select rr.id from return_requests rr
                                   where rr.order_id = ? and rr.status not in ('declined','cancelled')
                                     and not exists (select 1 from return_request_items ri
                                                      where ri.request_id = rr.id)
                                   limit 1");
            $open->execute([$order['id']]);
            if ($open->fetchColumn()) throw new InvalidArgumentException('duplicate_request');
            $eligibility = 'manual_review';
        } elseif (!$input['items']) throw new InvalidArgumentException('invalid_items');
        foreach ($input['items'] as &$item) {
            $sold = $byId[$item['order_item_id']] ?? null;
            if (!$sold) throw new InvalidArgumentException('invalid_items');
            if ($item['qty'] > $sold['remaining_qty']) throw new InvalidArgumentException('quantity_exceeded');
            if ($item['action'] === 'exchange') {
                if ($item['requested_size'] === null && $sold['size'] === 'ONE') $item['requested_size'] = 'ONE';
                if ($item['requested_size'] === null) throw new InvalidArgumentException('invalid_size');
            }
        }
        unset($item);
        $reference = 'SR' . strtoupper(bin2hex(random_bytes(8)));
        $q = $db->prepare('insert into return_requests
            (reference, order_id, status, eligibility, contact_phone, customer_note)
            values (?, ?, \'submitted\', ?, ?, ?)');
        $q->execute([$reference, $order['id'], $eligibility, $order['contact_phone'],
            $input['note'] === '' ? null : $input['note']]);
        $id = (int)$db->lastInsertId();
        $write = $db->prepare('insert into return_request_items
            (request_id, order_item_id, action, reason, qty, requested_size, name_en, name_ar,
             original_size, original_fit, unit_price) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($input['items'] as $item) {
            $sold = $byId[$item['order_item_id']];
            $write->execute([$id, $sold['id'], $item['action'], $item['reason'], $item['qty'],
                $item['requested_size'], $sold['name_en'] ?? '', $sold['name_ar'] ?? '',
                $sold['size'], $sold['fit'], $sold['unit_price']]);
        }
        $db->prepare('insert into return_request_events
            (request_id, from_status, to_status, actor_type, actor)
            values (?, null, \'submitted\', \'customer\', null)')->execute([$id]);
        $db->commit();
        $saved = $db->prepare('select id, reference, status, eligibility, created_at, updated_at
                               from return_requests where id = ?');
        $saved->execute([$id]);
        $request = $saved->fetch(PDO::FETCH_ASSOC);
        if (!$request) throw new RuntimeException('Return request not found after insert');
        $request['id'] = $id;
        $request['items'] = returns_public_request_items($db, [$id])[$id] ?? [];
        return ['request' => $request];
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

const RETURNS_STATUSES = ['submitted','under_review','approved','declined',
    'pickup_scheduled','received','completed','cancelled'];
const RETURNS_TRANSITIONS = [
    'submitted' => ['under_review','approved','declined','cancelled'],
    'under_review' => ['approved','declined','cancelled'],
    'approved' => ['pickup_scheduled','received','cancelled'],
    'pickup_scheduled' => ['received','cancelled'],
    'received' => ['completed','cancelled'],
    'completed' => [], 'declined' => [], 'cancelled' => [],
];

function returns_admin_list(PDO $db, string $status, string $search, int $page): array {
    $where = [];
    $args = [];
    if ($status !== 'all') { $where[] = 'rr.status = ?'; $args[] = $status; }
    if ($search !== '') {
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search) . '%';
        $where[] = "(rr.reference like ? escape '!' or o.track_id like ? escape '!'
                       or o.customer_name like ? escape '!' or o.customer_phone like ? escape '!')";
        array_push($args, $like, $like, $like, $like);
    }
    $filter = $where ? ' where ' . implode(' and ', $where) : '';
    $from = ' from return_requests rr join orders o on o.id = rr.order_id' . $filter;
    $total = $db->prepare('select count(*)' . $from);
    $total->execute($args);
    $count = (int)$total->fetchColumn();
    $q = $db->prepare('select rr.id, rr.reference, rr.status, rr.eligibility, rr.created_at,
                             rr.updated_at, o.track_id, o.customer_name, o.customer_phone,
                             o.payment_method, o.fulfilment_status' . $from .
                            ' order by rr.created_at desc, rr.id desc limit 21 offset ?');
    $i = 1;
    foreach ($args as $arg) $q->bindValue($i++, $arg);
    $q->bindValue($i, ($page - 1) * 20, PDO::PARAM_INT);
    $q->execute();
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    $hasMore = count($rows) > 20;
    if ($hasMore) $rows = array_slice($rows, 0, 20);
    foreach ($rows as &$row) $row['id'] = (int)$row['id'];
    unset($row);
    return ['requests' => $rows, 'page' => $page, 'has_more' => $hasMore, 'total' => $count];
}

function returns_admin_detail(PDO $db, int $id): ?array {
    $q = $db->prepare('select rr.*, o.track_id, o.customer_name, o.customer_phone,
                             o.payment_status, o.payment_method, o.fulfilment_status,
                             o.fulfilled_at, o.created_at as ordered_at
                        from return_requests rr join orders o on o.id = rr.order_id
                       where rr.id = ?');
    $q->execute([$id]);
    $request = $q->fetch(PDO::FETCH_ASSOC);
    if (!$request) return null;
    $request['id'] = (int)$request['id'];
    $request['order_id'] = (int)$request['order_id'];
    $request['allowed_next'] = RETURNS_TRANSITIONS[$request['status']] ?? [];
    $items = $db->prepare('select id, order_item_id, action, reason, qty, requested_size,
                                 name_en, name_ar, original_size, original_fit, unit_price
                            from return_request_items where request_id = ? order by id');
    $items->execute([$id]);
    $lines = $items->fetchAll(PDO::FETCH_ASSOC);
    foreach ($lines as &$line) {
        $line['id'] = (int)$line['id']; $line['order_item_id'] = (int)$line['order_item_id'];
        $line['qty'] = (int)$line['qty']; $line['unit_price'] = (float)$line['unit_price'];
    }
    unset($line);
    $events = $db->prepare('select id, from_status, to_status, actor_type, actor, note, created_at
                             from return_request_events where request_id = ? order by id');
    $events->execute([$id]);
    $history = $events->fetchAll(PDO::FETCH_ASSOC);
    foreach ($history as &$event) $event['id'] = (int)$event['id'];
    unset($event);
    return ['request' => $request, 'items' => $lines, 'events' => $history];
}

function returns_admin_status(PDO $db, int $id, string $status, string $expected,
                              string $note, string $admin): array {
    if ($id < 1 || !in_array($status, RETURNS_STATUSES, true)
        || !in_array($expected, RETURNS_STATUSES, true)) throw new InvalidArgumentException('invalid_status');
    $note = trim($note);
    if (mb_strlen($note) > 2000 || preg_match('/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', $note)) {
        throw new InvalidArgumentException('invalid_note');
    }
    if (in_array($status, ['declined','cancelled','completed'], true) && mb_strlen($note) < 5) {
        throw new InvalidArgumentException('note_required');
    }
    $db->beginTransaction();
    try {
        $q = $db->prepare('select status from return_requests where id = ? for update');
        $q->execute([$id]);
        $from = $q->fetchColumn();
        if ($from === false) throw new InvalidArgumentException('not_found');
        if ($from !== $expected) throw new InvalidArgumentException('status_changed');
        if (!in_array($status, RETURNS_TRANSITIONS[$from] ?? [], true)) {
            throw new InvalidArgumentException('invalid_transition');
        }
        $db->prepare('update return_requests set status = ?, reviewed_by = ? where id = ?')
            ->execute([$status, $admin, $id]);
        $db->prepare('insert into return_request_events
            (request_id, from_status, to_status, actor_type, actor, note)
            values (?, ?, ?, \'admin\', ?, ?)')->execute([$id, $from, $status, $admin,
                $note === '' ? null : $note]);
        $db->commit();
        $detail = returns_admin_detail($db, $id);
        if (!$detail) throw new RuntimeException('Return request not found after status update');
        return $detail;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}
