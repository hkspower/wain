<?php
declare(strict_types=1);

// CRM keys describe two different kinds of operational contact. A registered
// account is identified by its database ID; a guest is identified only by the
// phone captured with an order. Matching phone strings never merge the two.
function crm_parse_key(string $key): ?array {
    if (preg_match('/^account:([1-9][0-9]{0,17})$/D', $key, $m)) {
        $id = filter_var($m[1], FILTER_VALIDATE_INT);
        return $id === false ? null : ['source' => 'account', 'id' => $id, 'key' => $key];
    }
    if (preg_match('/^phone:(965[569][0-9]{7})$/D', $key, $m)) {
        return ['source' => 'phone', 'phone' => $m[1], 'key' => $key];
    }
    return null;
}

function crm_fils($amount): int {
    $value = (string)$amount;
    if (!preg_match('/^([0-9]+)(?:\.([0-9]{1,3}))?$/D', $value, $m)) return 0;
    return ((int)$m[1] * 1000) + (int)str_pad($m[2] ?? '0', 3, '0');
}

function crm_empty_contact(string $key, string $source, string $name = '', string $phone = '', string $email = ''): array {
    return [
        'key' => $key, 'source' => $source, 'name' => $name, 'display_name' => '',
        'phone' => $phone, 'email' => $email, 'order_count' => 0,
        'order_total' => 0.0, 'paid_total' => 0.0,
        'open_cod_count' => 0, 'open_cod_total' => 0.0,
        'last_order_at' => null, 'last_area' => '', 'last_track_id' => '',
        'status' => 'new', 'tags' => [], 'follow_up_at' => null,
        'note_count' => 0, 'updated_at' => null, 'updated_by' => null,
        '_order_fils' => 0, '_paid_fils' => 0, '_open_cod_fils' => 0, '_last_id' => 0,
    ];
}

// Let SQL aggregate order rows before PHP sees them. The result is one row per
// account/guest-phone combination, rather than every order ever placed. PHP
// then folds historical phone formats and multiple account delivery phones
// into their typed operational contact. Pagination bounds the API response.
function crm_all_contacts(PDO $db): array {
    $contacts = [];
    $accounts = $db->query('select id, name, email, phone from customer_accounts order by id');
    while ($row = $accounts->fetch(PDO::FETCH_ASSOC)) {
        $key = 'account:' . (int)$row['id'];
        $contacts[$key] = crm_empty_contact($key, 'account', (string)$row['name'],
            (string)($row['phone'] ?? ''), (string)$row['email']);
    }

    $orders = $db->query("select g.customer_account_id, g.customer_phone, g.order_count,
                                g.order_total, g.paid_total, g.open_cod_count,
                                g.open_cod_total, o.customer_name,
                                o.customer_area, o.track_id, o.created_at, o.id as latest_order_id
                           from (
                             select customer_account_id, customer_phone,
                                    count(*) as order_count,
                                    sum(amount) as order_total,
                                    sum(case when payment_status = 'paid' then amount else 0 end) as paid_total,
                                    sum(case when payment_method = 'cod' and payment_status = 'pending'
                                                   and fulfilment_status <> 'cancelled' then 1 else 0 end) as open_cod_count,
                                    sum(case when payment_method = 'cod' and payment_status = 'pending'
                                                   and fulfilment_status <> 'cancelled' then amount else 0 end) as open_cod_total,
                                    max(created_at) as latest_at
                               from orders group by customer_account_id, customer_phone
                           ) g join orders o on o.id = (
                             select max(o2.id) from orders o2
                              where (o2.customer_account_id = g.customer_account_id
                                     or (o2.customer_account_id is null and g.customer_account_id is null))
                                and (o2.customer_phone = g.customer_phone
                                     or (o2.customer_phone is null and g.customer_phone is null))
                                and o2.created_at = g.latest_at
                           )");
    while ($row = $orders->fetch(PDO::FETCH_ASSOC)) {
        $accountId = (int)($row['customer_account_id'] ?? 0);
        if ($accountId > 0) {
            $key = 'account:' . $accountId;
            if (!isset($contacts[$key])) {
                // Retain an orphaned historical account-order group without
                // guessing its email or merging it into a phone contact.
                $contacts[$key] = crm_empty_contact($key, 'account', (string)($row['customer_name'] ?? ''));
            }
        } else {
            $phone = store_phone((string)($row['customer_phone'] ?? ''));
            if ($phone === null) continue; // Orders remains the source for malformed legacy phones.
            $key = 'phone:' . $phone;
            if (!isset($contacts[$key])) {
                $contacts[$key] = crm_empty_contact($key, 'phone', (string)($row['customer_name'] ?? ''), $phone);
            }
        }
        $contact = &$contacts[$key];
        $dateCompare = $contact['last_order_at'] === null ? 1
            : strcmp((string)$row['created_at'], $contact['last_order_at']);
        if ($dateCompare > 0 || ($dateCompare === 0 && (int)$row['latest_order_id'] > $contact['_last_id'])) {
            $contact['last_order_at'] = (string)$row['created_at'];
            $contact['_last_id'] = (int)$row['latest_order_id'];
            $contact['last_area'] = (string)($row['customer_area'] ?? '');
            $contact['last_track_id'] = (string)$row['track_id'];
            if ($contact['source'] === 'phone') {
                $contact['name'] = (string)($row['customer_name'] ?? '');
            }
        }
        $contact['order_count'] += (int)$row['order_count'];
        $contact['_order_fils'] += crm_fils($row['order_total']);
        $contact['_paid_fils'] += crm_fils($row['paid_total']);
        $contact['open_cod_count'] += (int)$row['open_cod_count'];
        $contact['_open_cod_fils'] += crm_fils($row['open_cod_total']);
        unset($contact);
    }

    $metadata = $db->query('select contact_key, display_name, status, tags_json,
                                  follow_up_at, updated_at, updated_by from crm_contacts');
    while ($row = $metadata->fetch(PDO::FETCH_ASSOC)) {
        $key = (string)$row['contact_key'];
        $parsed = crm_parse_key($key);
        if ($parsed === null) continue;
        if (!isset($contacts[$key])) {
            if ($parsed['source'] === 'account') continue; // An account was deleted.
            $contacts[$key] = crm_empty_contact($key, 'phone', '', $parsed['phone']);
        }
        $c = &$contacts[$key];
        $c['display_name'] = (string)($row['display_name'] ?? '');
        $c['status'] = (string)$row['status'];
        $tags = json_decode((string)($row['tags_json'] ?? '[]'), true);
        $c['tags'] = is_array($tags) ? array_values(array_filter($tags, 'is_string')) : [];
        $c['follow_up_at'] = $row['follow_up_at'];
        $c['updated_at'] = $row['updated_at'];
        $c['updated_by'] = $row['updated_by'];
        unset($c);
    }

    $counts = $db->query('select contact_key, count(*) as note_count from crm_notes group by contact_key');
    while ($row = $counts->fetch(PDO::FETCH_ASSOC)) {
        $key = (string)$row['contact_key'];
        if (isset($contacts[$key])) $contacts[$key]['note_count'] = (int)$row['note_count'];
    }

    foreach ($contacts as &$contact) {
        if ($contact['updated_at'] === null && ($contact['_paid_fils'] > 0 || $contact['open_cod_count'] > 0)) {
            $contact['status'] = 'active';
        }
        $contact['name'] = $contact['display_name'] !== '' ? $contact['display_name']
            : ($contact['name'] !== '' ? $contact['name'] : 'Unnamed contact');
        $contact['order_total'] = $contact['_order_fils'] / 1000;
        $contact['paid_total'] = $contact['_paid_fils'] / 1000;
        $contact['open_cod_total'] = $contact['_open_cod_fils'] / 1000;
        unset($contact['_order_fils'], $contact['_paid_fils'], $contact['_open_cod_fils'], $contact['_last_id']);
    }
    unset($contact);
    return $contacts;
}

function crm_list(PDO $db, string $query, int $page, string $status, string $source, bool $due): array {
    $contacts = array_values(crm_all_contacts($db));
    $needle = mb_strtolower(trim($query));
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->format('Y-m-d');
    $contacts = array_values(array_filter($contacts, static function (array $c) use ($needle, $status, $source, $due, $today): bool {
        if ($source !== 'all' && $c['source'] !== $source) return false;
        if ($status !== 'all' && $c['status'] !== $status) return false;
        if ($due && (!$c['follow_up_at'] || $c['follow_up_at'] > $today)) return false;
        if ($needle === '') return true;
        $haystack = implode(' ', [$c['name'], $c['phone'], $c['email'], $c['last_area'],
            $c['last_track_id'], implode(' ', $c['tags'])]);
        return mb_stripos($haystack, $needle) !== false;
    }));
    usort($contacts, static function (array $a, array $b): int {
        $aDate = (string)($a['last_order_at'] ?? $a['updated_at'] ?? '');
        $bDate = (string)($b['last_order_at'] ?? $b['updated_at'] ?? '');
        return strcmp($bDate, $aDate) ?: strcmp($a['key'], $b['key']);
    });
    $summary = ['contacts' => count($contacts), 'orders' => 0, 'order_total' => 0.0,
                'paid_total' => 0.0, 'open_cod_count' => 0, 'open_cod_total' => 0.0,
                'due_followups' => 0];
    foreach ($contacts as $c) {
        $summary['orders'] += $c['order_count'];
        $summary['order_total'] += $c['order_total'];
        $summary['paid_total'] += $c['paid_total'];
        $summary['open_cod_count'] += $c['open_cod_count'];
        $summary['open_cod_total'] += $c['open_cod_total'];
        if ($c['follow_up_at'] && $c['follow_up_at'] <= $today) $summary['due_followups']++;
    }
    $summary['order_total'] = round($summary['order_total'], 3);
    $summary['paid_total'] = round($summary['paid_total'], 3);
    $summary['open_cod_total'] = round($summary['open_cod_total'], 3);
    $perPage = 20;
    return ['contacts' => array_slice($contacts, ($page - 1) * $perPage, $perPage),
            'page' => $page, 'has_more' => count($contacts) > $page * $perPage,
            'total' => count($contacts), 'summary' => $summary];
}

function crm_detail(PDO $db, string $key, int $ordersPage, int $notesPage): ?array {
    $contact = crm_all_contacts($db)[$key] ?? null;
    if ($contact === null) return null;
    $parsed = crm_parse_key($key);
    if ($parsed === null) return null;
    $ordersOffset = ($ordersPage - 1) * 20;
    if ($parsed['source'] === 'account') {
        $orders = $db->prepare('select id, track_id, created_at, amount, payment_method,
                                       payment_status, fulfilment_status, customer_name,
                                       customer_phone, customer_area, customer_governorate
                                  from orders where customer_account_id = ?
                                 order by created_at desc, id desc limit 21 offset ?');
        $orders->bindValue(1, $parsed['id'], PDO::PARAM_INT);
        $orders->bindValue(2, $ordersOffset, PDO::PARAM_INT);
        $orders->execute();
        $orderRows = $orders->fetchAll(PDO::FETCH_ASSOC);
    } else {
        // Match with the exact same normalization used by crm_all_contacts.
        // Historical orders may contain '+965 5522-2759' or Arabic digits;
        // an exact SQL IN list would count them in the summary and omit them
        // from the detail. Stream rows and stop after this bounded page.
        $orders = $db->query('select id, track_id, created_at, amount, payment_method,
                                    payment_status, fulfilment_status, customer_name,
                                    customer_phone, customer_area, customer_governorate
                               from orders where customer_account_id is null or customer_account_id = 0
                              order by created_at desc, id desc');
        $orderRows = [];
        $seen = 0;
        while ($row = $orders->fetch(PDO::FETCH_ASSOC)) {
            if (store_phone((string)($row['customer_phone'] ?? '')) !== $parsed['phone']) continue;
            if ($seen++ < $ordersOffset) continue;
            $orderRows[] = $row;
            if (count($orderRows) === 21) break;
        }
    }
    $ordersHasMore = count($orderRows) > 20;
    if ($ordersHasMore) $orderRows = array_slice($orderRows, 0, 20);
    foreach ($orderRows as &$order) { $order['id'] = (int)$order['id']; $order['amount'] = (float)$order['amount']; }
    unset($order);

    $notes = $db->prepare('select id, note, created_at, created_by from crm_notes
                             where contact_key = ? order by id desc limit 21 offset ?');
    $notes->bindValue(1, $key);
    $notes->bindValue(2, ($notesPage - 1) * 20, PDO::PARAM_INT);
    $notes->execute();
    $noteRows = $notes->fetchAll(PDO::FETCH_ASSOC);
    $notesHasMore = count($noteRows) > 20;
    if ($notesHasMore) $noteRows = array_slice($noteRows, 0, 20);
    foreach ($noteRows as &$note) $note['id'] = (int)$note['id'];
    unset($note);
    return ['contact' => $contact, 'orders' => $orderRows,
        'orders_has_more' => $ordersHasMore, 'orders_page' => $ordersPage,
        'notes' => $noteRows, 'notes_has_more' => $notesHasMore, 'notes_page' => $notesPage];
}

function crm_save_input(array $body): array {
    $key = $body['key'] ?? null;
    if (!is_string($key) || crm_parse_key($key) === null) return ['error' => 'invalid_contact'];
    $name = $body['display_name'] ?? '';
    if (!is_string($name)) return ['error' => 'invalid_name'];
    $name = trim($name);
    if ($name !== '' && (mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[<>\x00-\x1f\x7f]/u', $name))) return ['error' => 'invalid_name'];
    $status = $body['status'] ?? 'new';
    if (!is_string($status) || !in_array($status, ['new','active','follow_up','vip','inactive'], true)) return ['error' => 'invalid_status'];
    $tags = $body['tags'] ?? [];
    if (!is_array($tags) || count($tags) > 8 || array_is_list($tags) === false) return ['error' => 'invalid_tags'];
    $cleanTags = [];
    foreach ($tags as $tag) {
        if (!is_string($tag)) return ['error' => 'invalid_tags'];
        $tag = trim($tag);
        if (mb_strlen($tag) < 2 || mb_strlen($tag) > 24 || !preg_match('/^[\pL\pN][\pL\pN _-]*$/uD', $tag)) return ['error' => 'invalid_tags'];
        $cleanTags[mb_strtolower($tag)] = $tag;
    }
    $date = $body['follow_up_at'] ?? null;
    if ($date === '') $date = null;
    if ($date !== null) {
        if (!is_string($date) || !preg_match('/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/D', $date)) return ['error' => 'invalid_follow_up'];
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$parsed || $parsed->format('Y-m-d') !== $date) return ['error' => 'invalid_follow_up'];
    }
    return ['key' => $key, 'display_name' => $name ?: null, 'status' => $status,
        'tags_json' => json_encode(array_values($cleanTags), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        'follow_up_at' => $date];
}

function crm_note_input(array $body): array {
    $key = $body['key'] ?? null;
    $note = $body['note'] ?? null;
    if (!is_string($key) || crm_parse_key($key) === null) return ['error' => 'invalid_contact'];
    if (!is_string($note)) return ['error' => 'invalid_note'];
    $note = trim($note);
    if (mb_strlen($note) < 2 || mb_strlen($note) > 2000 || preg_match('/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', $note)) return ['error' => 'invalid_note'];
    return ['key' => $key, 'note' => $note];
}

function crm_key_exists(PDO $db, string $key): bool {
    $parsed = crm_parse_key($key);
    if ($parsed === null) return false;
    if ($parsed['source'] === 'account') {
        $q = $db->prepare('select 1 from customer_accounts where id = ? limit 1');
        $q->execute([$parsed['id']]);
        if ($q->fetchColumn()) return true;
        $q = $db->prepare('select 1 from orders where customer_account_id = ? limit 1');
        $q->execute([$parsed['id']]);
        return (bool)$q->fetchColumn();
    }
    return true; // A new manual phone contact is permitted.
}

function crm_save(PDO $db, array $input, string $editor): array {
    if (!crm_key_exists($db, $input['key'])) throw new InvalidArgumentException('not_found');
    $q = $db->prepare('insert into crm_contacts
            (contact_key, display_name, status, tags_json, follow_up_at, created_by, updated_by)
            values (?, ?, ?, ?, ?, ?, ?)
            on duplicate key update display_name = values(display_name), status = values(status),
              tags_json = values(tags_json), follow_up_at = values(follow_up_at),
              updated_by = values(updated_by), updated_at = current_timestamp');
    $q->execute([$input['key'], $input['display_name'], $input['status'], $input['tags_json'],
        $input['follow_up_at'], $editor, $editor]);
    return crm_all_contacts($db)[$input['key']];
}

// A manually added phone contact must never overwrite a contact derived from
// an existing guest order or an earlier CRM entry. Edits use crm_save instead.
function crm_create(PDO $db, array $input, string $editor): array {
    $parsed = crm_parse_key($input['key']);
    if (!$parsed || $parsed['source'] !== 'phone') throw new InvalidArgumentException('invalid_contact');
    if (isset(crm_all_contacts($db)[$input['key']])) throw new InvalidArgumentException('contact_exists');
    $q = $db->prepare('insert into crm_contacts
            (contact_key, display_name, status, tags_json, follow_up_at, created_by, updated_by)
            values (?, ?, ?, ?, ?, ?, ?)');
    try {
        $q->execute([$input['key'], $input['display_name'], $input['status'], $input['tags_json'],
            $input['follow_up_at'], $editor, $editor]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) == 1062) throw new InvalidArgumentException('contact_exists', 0, $e);
        throw $e;
    }
    return crm_all_contacts($db)[$input['key']];
}

function crm_add_note(PDO $db, array $input, string $editor): array {
    if (!crm_key_exists($db, $input['key'])) throw new InvalidArgumentException('not_found');
    $existing = crm_all_contacts($db)[$input['key']] ?? null;
    $defaultStatus = $existing && ($existing['paid_total'] > 0 || $existing['open_cod_count'] > 0)
        ? 'active' : 'new';
    $db->beginTransaction();
    try {
        $insert = $db->prepare('insert ignore into crm_contacts
            (contact_key, status, created_by, updated_by) values (?, ?, ?, ?)');
        $insert->execute([$input['key'], $defaultStatus, $editor, $editor]);
        $write = $db->prepare('insert into crm_notes (contact_key, note, created_by) values (?, ?, ?)');
        $write->execute([$input['key'], $input['note'], $editor]);
        $id = (int)$db->lastInsertId();
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    $q = $db->prepare('select id, note, created_at, created_by from crm_notes where id = ?');
    $q->execute([$id]);
    $note = $q->fetch(PDO::FETCH_ASSOC);
    if (!$note) throw new RuntimeException('CRM note was not found after save');
    $note['id'] = (int)$note['id'];
    return $note;
}
