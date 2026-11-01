<?php
declare(strict_types=1);

const SUPPORT_STATUSES = ['open','waiting_customer','in_progress','resolved','closed'];
const SUPPORT_PRIORITIES = ['low','normal','high','urgent'];

function support_body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if ($raw === false || strlen($raw) > 8192) store_fail('request_too_large', 413);
    $body = json_decode($raw, true);
    if (!is_array($body) || array_is_list($body)) store_fail('invalid_json');
    return $body;
}

function support_text($value, int $min, int $max): ?string {
    if (!is_string($value)) return null;
    $value = trim($value);
    if (mb_strlen($value) < $min || mb_strlen($value) > $max || preg_match('/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', $value)) return null;
    return $value;
}

function support_identity(array $body): ?array {
    $reference = strtoupper(trim((string)($body['reference'] ?? '')));
    $email = strtolower(trim((string)($body['email'] ?? '')));
    if (!preg_match('/^ST[A-Z0-9]{12,20}$/D', $reference) || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 120) return null;
    return [$reference, $email];
}

function support_ticket_public(PDO $db, array $body): ?array {
    $identity = support_identity($body);
    if ($identity === null) return null;
    [$reference, $email] = $identity;
    $q = $db->prepare('select id, reference, subject, status, priority, order_track_id, created_at, updated_at
                         from support_tickets where reference = ? and customer_email = ?');
    $q->execute([$reference, $email]);
    $ticket = $q->fetch(PDO::FETCH_ASSOC);
    if (!$ticket) return null;
    $ticket['id'] = (int)$ticket['id'];
    $messages = $db->prepare("select id, author_kind, author_name, body, created_at from support_messages
                               where ticket_id = ? and (author_kind = 'customer' or visible_to_customer = 1)
                               order by id asc limit 100");
    $messages->execute([$ticket['id']]);
    $rows = $messages->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) $row['id'] = (int)$row['id'];
    unset($row, $ticket['id'], $ticket['priority']);
    return ['ticket' => $ticket, 'messages' => $rows];
}

function support_create(PDO $db, array $body): array {
    $name = support_text($body['name'] ?? null, 2, 80);
    $subject = support_text($body['subject'] ?? null, 3, 140);
    $message = support_text($body['message'] ?? null, 5, 2000);
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $phone = store_phone((string)($body['phone'] ?? ''));
    $track = strtoupper(trim((string)($body['order_track_id'] ?? '')));
    if ($name === null || $subject === null || $message === null || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 120) throw new InvalidArgumentException('invalid_ticket');
    if ($track !== '' && !preg_match('/^[A-Z0-9]{6,30}$/D', $track)) throw new InvalidArgumentException('invalid_order');
    if ((string)($body['phone'] ?? '') !== '' && $phone === null) throw new InvalidArgumentException('invalid_phone');
    $reference = 'ST' . strtoupper(bin2hex(random_bytes(8)));
    $db->beginTransaction();
    try {
        $q = $db->prepare("insert into support_tickets (reference, customer_name, customer_email, customer_phone, order_track_id, subject, status, last_customer_at)
                           values (?, ?, ?, ?, ?, ?, 'open', now())");
        $q->execute([$reference, $name, $email, $phone, $track === '' ? null : $track, $subject]);
        $id = (int)$db->lastInsertId();
        $db->prepare("insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) values (?, 'customer', ?, ?, 1)")
           ->execute([$id, $name, $message]);
        $db->commit();
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    return ['reference' => $reference, 'status' => 'open'];
}

function support_customer_reply(PDO $db, array $body): array {
    $identity = support_identity($body);
    $message = support_text($body['message'] ?? null, 2, 2000);
    if ($identity === null || $message === null) throw new InvalidArgumentException('invalid_ticket');
    [$reference, $email] = $identity;
    $db->beginTransaction();
    try {
        $q = $db->prepare('select id, customer_name, status from support_tickets where reference = ? and customer_email = ? for update');
        $q->execute([$reference, $email]); $ticket = $q->fetch(PDO::FETCH_ASSOC);
        if (!$ticket) throw new InvalidArgumentException('not_found');
        if (in_array($ticket['status'], ['resolved','closed'], true)) throw new InvalidArgumentException('ticket_closed');
        $db->prepare("insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) values (?, 'customer', ?, ?, 1)")
           ->execute([(int)$ticket['id'], (string)$ticket['customer_name'], $message]);
        $db->prepare("update support_tickets set status = 'open', last_customer_at = now() where id = ?")->execute([(int)$ticket['id']]);
        $db->commit();
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    return ['ok' => true];
}

function support_admin_list(PDO $db, string $status, string $q): array {
    $sql = 'select id, reference, customer_name, customer_email, customer_phone, order_track_id, subject, status, priority, assigned_to, last_customer_at, last_staff_at, created_at, updated_at from support_tickets';
    $where = []; $args = [];
    if ($status !== 'all') { $where[] = 'status = ?'; $args[] = $status; }
    if ($q !== '') { $where[] = '(reference like ? or customer_name like ? or customer_email like ? or order_track_id like ? or subject like ?)'; for ($i = 0; $i < 5; $i++) $args[] = '%' . $q . '%'; }
    if ($where) $sql .= ' where ' . implode(' and ', $where);
    $sql .= ' order by case priority when \'urgent\' then 1 when \'high\' then 2 when \'normal\' then 3 else 4 end, updated_at desc, id desc limit 100';
    $q = $db->prepare($sql); $q->execute($args); $tickets = $q->fetchAll(PDO::FETCH_ASSOC);
    foreach ($tickets as &$ticket) $ticket['id'] = (int)$ticket['id']; unset($ticket);
    return ['tickets' => $tickets];
}

function support_admin_detail(PDO $db, int $id): ?array {
    $q = $db->prepare('select id, reference, customer_name, customer_email, customer_phone, order_track_id, subject, status, priority, assigned_to, last_customer_at, last_staff_at, resolved_at, created_at, updated_at from support_tickets where id = ?');
    $q->execute([$id]); $ticket = $q->fetch(PDO::FETCH_ASSOC); if (!$ticket) return null;
    $ticket['id'] = (int)$ticket['id'];
    $q = $db->prepare('select id, author_kind, author_name, body, visible_to_customer, created_at from support_messages where ticket_id = ? order by id asc');
    $q->execute([$id]); $messages = $q->fetchAll(PDO::FETCH_ASSOC);
    foreach ($messages as &$message) { $message['id'] = (int)$message['id']; $message['visible_to_customer'] = (bool)$message['visible_to_customer']; } unset($message);
    return ['ticket' => $ticket, 'messages' => $messages];
}

function support_admin_update(PDO $db, array $body, string $admin): array {
    $id = $body['id'] ?? null; $status = $body['status'] ?? null; $priority = $body['priority'] ?? null;
    if (!is_int($id) || $id < 1 || !is_string($status) || !in_array($status, SUPPORT_STATUSES, true) || !is_string($priority) || !in_array($priority, SUPPORT_PRIORITIES, true)) throw new InvalidArgumentException('invalid_ticket');
    $assigned = $body['assigned_to'] ?? ''; if (!is_string($assigned) || mb_strlen(trim($assigned)) > 120 || preg_match('/[<>\x00-\x1f\x7f]/u', $assigned)) throw new InvalidArgumentException('invalid_assignee');
    $q = $db->prepare('update support_tickets set status = ?, priority = ?, assigned_to = ?, resolved_at = case when ? in (\'resolved\',\'closed\') then coalesce(resolved_at, now()) else null end where id = ?');
    $q->execute([$status, $priority, trim($assigned) ?: null, $status, $id]);
    // MySQL returns zero affected rows when an operator saves unchanged values;
    // that is still a successful save, not evidence that the ticket vanished.
    return support_admin_detail($db, $id) ?? throw new InvalidArgumentException('not_found');
}

function support_admin_reply(PDO $db, array $body, string $admin): array {
    $id = $body['id'] ?? null; $message = support_text($body['message'] ?? null, 2, 2000); $visible = $body['visible_to_customer'] ?? true;
    if (!is_int($id) || $id < 1 || $message === null || !is_bool($visible)) throw new InvalidArgumentException('invalid_reply');
    $db->beginTransaction();
    try {
        $q = $db->prepare('select id, status from support_tickets where id = ? for update'); $q->execute([$id]); $ticket = $q->fetch(PDO::FETCH_ASSOC);
        if (!$ticket) throw new InvalidArgumentException('not_found');
        $db->prepare("insert into support_messages (ticket_id, author_kind, author_name, body, visible_to_customer) values (?, ?, ?, ?, ?)")
           ->execute([$id, $visible ? 'staff' : 'internal', $admin, $message, $visible ? 1 : 0]);
        $db->prepare("update support_tickets set status = ?, last_staff_at = now() where id = ?")
           ->execute([$visible ? 'waiting_customer' : (string)$ticket['status'], $id]);
        $db->commit();
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
    return support_admin_detail($db, $id) ?? throw new InvalidArgumentException('not_found');
}
