<?php
declare(strict_types=1);

// Staff-facing account profiles. Password hashes, reset tokens, sessions and
// any customer-controlled authentication state are intentionally not selected.

// customer_accounts HAS NO last_login_at, and these queries named it.
//
// Only admin_users carries that column (schema.mysql.sql, install.mysql.sql);
// no migration has ever added it to customer_accounts. So both queries below
// failed with "unknown column" on every database there is, and the Profiles
// screen answered 503 no_table on every visit — found by a live scan. The
// screen still expects the key, so it stays in the response: the column's
// value where a database has one, and null where (as everywhere today) it
// does not. Asked once per request, not once per row.
function profiles_last_login_select(PDO $db, string $alias = ''): string {
    if (!store_column_exists($db, 'customer_accounts', 'last_login_at')) return 'null';
    return ($alias === '' ? '' : $alias . '.') . 'last_login_at';
}

function profiles_list(PDO $db, string $query, int $page): array {
    $where = ''; $args = [];
    if ($query !== '') {
        $where = 'where (a.name like ? or a.email like ? or a.phone like ?)';
        $needle = '%' . $query . '%'; $args = [$needle, $needle, $needle];
    }
    $lastLogin = profiles_last_login_select($db, 'a');
    $groupLastLogin = $lastLogin === 'null' ? '' : ", {$lastLogin}";
    $sql = "select a.id, a.name, a.email, a.phone, a.created_at, {$lastLogin} as last_login_at,
                   count(o.id) as order_count,
                   coalesce(sum(case when o.payment_status = 'paid' then o.amount else 0 end), 0) as paid_total,
                   max(o.created_at) as last_order_at
              from customer_accounts a left join orders o on o.customer_account_id = a.id
              {$where} group by a.id, a.name, a.email, a.phone, a.created_at{$groupLastLogin}
              order by coalesce(max(o.created_at), a.created_at) desc, a.id desc limit 21 offset ?";
    $q = $db->prepare($sql);
    foreach ($args as $i => $value) $q->bindValue($i + 1, $value);
    $q->bindValue(count($args) + 1, ($page - 1) * 20, PDO::PARAM_INT); $q->execute();
    $rows = $q->fetchAll(PDO::FETCH_ASSOC); $more = count($rows) > 20; if ($more) $rows = array_slice($rows, 0, 20);
    foreach ($rows as &$row) { $row['id'] = (int)$row['id']; $row['order_count'] = (int)$row['order_count']; $row['paid_total'] = (float)$row['paid_total']; } unset($row);
    return ['profiles' => $rows, 'page' => $page, 'has_more' => $more];
}

function profiles_detail(PDO $db, int $id): ?array {
    $q = $db->prepare('select id, name, email, phone, created_at, ' . profiles_last_login_select($db)
                    . ' as last_login_at from customer_accounts where id = ?');
    $q->execute([$id]); $profile = $q->fetch(PDO::FETCH_ASSOC); if (!$profile) return null;
    $profile['id'] = (int)$profile['id'];
    $q = $db->prepare('select id, track_id, amount, payment_method, payment_status, fulfilment_status, customer_name, customer_phone, customer_governorate, customer_area, customer_block, customer_street, customer_building, customer_floor, customer_flat, customer_note, created_at, paid_at, fulfilled_at from orders where customer_account_id = ? order by created_at desc, id desc limit 100');
    $q->execute([$id]); $orders = $q->fetchAll(PDO::FETCH_ASSOC);
    $paid = 0; foreach ($orders as &$order) { $order['id'] = (int)$order['id']; $order['amount'] = (float)$order['amount']; if ($order['payment_status'] === 'paid') $paid += $order['amount']; } unset($order);
    return ['profile' => $profile, 'orders' => $orders, 'summary' => ['orders' => count($orders), 'paid_total' => round($paid, 3)]];
}
