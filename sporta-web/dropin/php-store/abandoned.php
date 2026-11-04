<?php
declare(strict_types=1);

// ABANDONED ORDERS, for the /backends admin: orders that were started and never
// completed, so the owner can see what was lost and phone or WhatsApp the
// customer. READ-ONLY on every order, stock and discount table; the one thing it
// writes is the owner's own follow-up note (abandoned_followup).
//
// This is an include, never an endpoint. admin.php requires it after the
// session gate (store_require_admin) and calls abandoned_dispatch(). A direct
// request to this file finds no store.php loaded and answers 403.
if (!function_exists('store_db')) { http_response_code(403); exit; }

// ---------------------------------------------------------------- WHAT COUNTS
//
// WHAT THE SHOP DOES TODAY (read from the code, not assumed):
//
//   * An order row is written BEFORE payment (api.php, create_order). A card
//     order (knet / tpay) then sends the shopper to the bank page; a shopper who
//     closes the tab leaves payment_status = 'pending' for ever.
//   * The bank's answer is final: a declined card or one the shopper cancelled
//     at the gateway sets payment_status = 'failed' on both gateways.
//   * cron-stock.php (every 15 min) puts the stock back for a card order still
//     pending after the hold (stock_hold_minutes, at least 15, default 120):
//     stock_released = 1, the order stays 'pending'. A card order that claimed NO
//     stock but held a discount use is CANCELLED by the same sweep instead.
//   * A cash order (cod) is a real sale waiting for a driver. The sweeper only
//     touches it when it is still pending AND unfulfilled cod_hold_hours after it
//     was placed (24 by default, 0 = off): it is then CANCELLED and its stock and
//     discount uses go back (store_stock_release). A cash order the shop has
//     packed or shipped is never touched.
//   * The cart itself lives only in the shopper's browser. A shopper who never
//     reached order creation is NOT recorded anywhere and cannot be listed. No
//     tracking beacon is built for that: it would be a privacy decision for the
//     owner, not a reporting detail.
//
// THE REASONS (one per listed order; the first four are "abandoned"):
//
//   unpaid       card order, still pending, older than abandoned_after_minutes
//                and still inside the sweeper's hold: the shopper left the bank
//                page without paying and the garments are still held.
//   expired      card order, still pending, whose hold has run out (the sweeper
//                has put the stock back, or will within 15 minutes), or one that
//                was cancelled only after its hold ran out.
//   declined     card order the bank refused (payment_status 'failed'), or the
//                shopper backed out at the gateway.
//   cod_expired  cash order nobody confirmed: pending and unfulfilled past
//                cod_hold_hours, or cancelled only after that time had passed.
//
//   waiting      NOT abandoned. A card order inside the threshold: the shopper is
//                probably still on the bank page. Shown only on request.
//   cancelled    NOT abandoned. An unpaid order the shop cancelled BEFORE its
//                hold ran out: a person's decision (duplicate, customer phoned,
//                fraud), not a customer walking away. Shown only on request.
//
// NEVER LISTED: paid orders; orders under REVIEW (the money may be real); a
// card order a person has packed; a cash order inside its hold or already
// packed, shipped, delivered or paid; and a CASH order whose payment_status is
// 'failed' - the card gateways are the only writers of that status for new
// orders, so on a cash order it is the historic import's wording for "did not
// happen" (27 such rows on the live database) and says nothing about a customer
// walking away.
//
// WHO CANCELLED A CANCELLED ORDER. The row does not say, and the sweeper and a
// person write the same thing. The order's own timeline does: the cancel event
// (order_tracking_events) carries the time, and the sweeper can only cancel an
// order AFTER its hold. A cancel before the hold ran out is a person's
// ('cancelled'); one after it is the order dying of old age however it was
// pressed ('expired' / 'cod_expired'). With no timeline row the answer is
// 'cancelled': this code never claims the sweeper did something it cannot show.
//
// RECOVERED. A LATER order (higher id) from the same customer that succeeded: the
// same stored phone (checkout writes one canonical form, store_phone()), or the
// same signed-in account (the only place an order meets an email address: orders
// carry none, and customer_accounts.email is unique, so one email is one
// account). Succeeded means paid, or a cash order the shop has packed, shipped
// or delivered. A cash order still waiting for confirmation is not yet a sale.
// A follow-up marked recovered_manually (the owner took the order by phone)
// counts too. Recovered rows are hidden unless asked for, and always counted.
const ABANDONED_REASONS      = ['unpaid', 'expired', 'declined', 'cod_expired'];
const ABANDONED_OTHER        = ['waiting', 'cancelled'];
const ABANDONED_STATES       = ['contacted', 'not_interested', 'wrong_number', 'recovered_manually'];
const ABANDONED_AFTER_DEFAULT = 30;   // minutes
const ABANDONED_AFTER_MIN     = 5;
const ABANDONED_PAGE_SIZE     = 20;
const ABANDONED_ITEM_LINES    = 5;    // item lines returned per order; the rest are counted

// The settings, each with a default in code because the store config is a
// root-owned read-only file on the VPS. abandoned_after_minutes is NEVER later
// than the sweeper's own hold: past the hold an order is 'expired', not 'unpaid'.
// The hold is read exactly as cron-stock.php reads it.
function abandoned_settings(): array {
    $cfg  = store_config();
    $hold = max(15, (int)($cfg['stock_hold_minutes'] ?? 120));
    $raw  = $cfg['abandoned_after_minutes'] ?? null;
    $after = ($raw === null || $raw === '') ? ABANDONED_AFTER_DEFAULT : (int)$raw;
    $after = max(ABANDONED_AFTER_MIN, min($after, $hold));
    return ['after_minutes' => $after, 'hold_minutes' => $hold, 'cod_hold_hours' => store_cod_hold_hours()];
}

// Does this database have the table yet? From information_schema, once per
// request per table, like store_column_exists().
function abandoned_table_exists(PDO $db, string $table): bool {
    static $known = [];
    if (!array_key_exists($table, $known)) {
        $q = $db->prepare('select count(*) from information_schema.tables where table_schema = database() and table_name = ?');
        $q->execute([$table]);
        $known[$table] = (int)$q->fetchColumn() > 0;
    }
    return $known[$table];
}

// ------------------------------------------------------------------- FILTERS

// Parses ?reason= &from= &to= &q= &include_recovered= &page= . Returns the
// filters, or a string error token. Nothing here is echoed back in an error.
function abandoned_filters(array $get): array|string {
    $str = static function (string $k, string $default) use ($get): string|false {
        if (!array_key_exists($k, $get)) return $default;
        return is_string($get[$k]) ? $get[$k] : false;
    };
    $reason = $str('reason', 'all');
    if ($reason === false || !in_array($reason, array_merge(['all'], ABANDONED_REASONS, ABANDONED_OTHER), true)) return 'invalid_filter';

    $dates = [];
    foreach (['from', 'to'] as $k) {
        $v = $str($k, '');
        if ($v === false) return 'invalid_filter';
        if ($v === '') { $dates[$k] = null; continue; }
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $v, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || (int)$m[1] < 2000) return 'invalid_filter';
        $dates[$k] = $v;
    }
    if ($dates['from'] !== null && $dates['to'] !== null && $dates['from'] > $dates['to']) return 'invalid_filter';

    $q = $str('q', '');
    if ($q === false || mb_strlen($q) > 80 || preg_match('/[\x00-\x1f\x7f]/u', $q)) return 'invalid_filter';

    $inc = $str('include_recovered', '0');
    if ($inc === false || !in_array($inc, ['0', '1'], true)) return 'invalid_filter';

    $page = $str('page', '1');
    if ($page === false || !preg_match('/^[1-9][0-9]{0,2}$/D', $page) || (int)$page > 500) return 'invalid_filter';

    return ['reason' => $reason, 'from' => $dates['from'], 'to' => $dates['to'], 'q' => trim($q),
            'include_recovered' => $inc === '1', 'page' => (int)$page];
}

// ----------------------------------------------------------------------- SQL

// What a SUCCESSFUL later order is: paid, or cash the shop has packed, shipped
// or delivered. $a is a table alias chosen by this file, never user input.
function abandoned_success_sql(string $a): string {
    return "({$a}.fulfilment_status <> 'cancelled' and ({$a}.payment_status = 'paid'"
         . " or ({$a}.payment_method = 'cod' and {$a}.payment_status = 'pending'"
         . " and {$a}.fulfilment_status in ('packed','shipped','delivered'))))";
}

// A later successful order from the same phone, or the same account. Two EXISTS
// arms, one per index (phone, then account): one OR inside a single subquery
// would give the optimizer neither.
function abandoned_recovered_sql(): string {
    return '(exists (select 1 from orders rp where rp.customer_phone = o.customer_phone and o.customer_phone <> \'\' and rp.id > o.id and ' . abandoned_success_sql('rp') . ')'
         . ' or (o.customer_account_id is not null and exists (select 1 from orders ra'
         . ' where ra.customer_account_id = o.customer_account_id and ra.id > o.id and ' . abandoned_success_sql('ra') . ')))';
}

// The reason of an order, as one CASE. Integers only, inlined: they come from
// abandoned_settings() (clamped) and never from the request.
function abandoned_reason_sql(array $s, bool $timeline): string {
    $thr = (int)$s['after_minutes']; $hold = (int)$s['hold_minutes']; $cod = (int)$s['cod_hold_hours'];
    $cancelAt = $timeline
        ? "(select max(e.created_at) from order_tracking_events e where e.order_id = o.id and e.status = 'cancelled')"
        : 'null';
    return "case
      when o.payment_method in ('knet','tpay') then
        case o.payment_status
          when 'failed' then 'declined'
          when 'pending' then
            case o.fulfilment_status
              when 'cancelled' then
                case when {$cancelAt} >= o.created_at + interval {$hold} minute then 'expired' else 'cancelled' end
              when 'unfulfilled' then
                case when o.stock_released = 1 or o.created_at < now() - interval {$hold} minute then 'expired'
                     when o.created_at < now() - interval {$thr} minute then 'unpaid'
                     else 'waiting' end
              else null end
          else null end
      when o.payment_method = 'cod' and o.payment_status = 'pending' then
        case o.fulfilment_status
          when 'unfulfilled' then
            case when {$cod} > 0 and o.created_at < now() - interval {$cod} hour then 'cod_expired' else null end
          when 'cancelled' then
            case when {$cod} > 0 and {$cancelAt} >= o.created_at + interval {$cod} hour then 'cod_expired' else 'cancelled' end
          else null end
      else null end";
}

// Structural pre-filter, on the indexed columns only (idx_orders_payment): the
// rows that COULD have a reason. Everything else (paid, review, a packed order,
// a cash order that failed in the historic import) is never read further.
const ABANDONED_PREFILTER =
    "o.payment_status in ('pending','failed')
     and ((o.payment_method in ('knet','tpay') and (o.payment_status = 'failed' or o.fulfilment_status in ('unfulfilled','cancelled')))
       or (o.payment_method = 'cod' and o.payment_status = 'pending' and o.fulfilment_status in ('unfulfilled','cancelled')))";

// The date range and the search, as WHERE fragments. The summary ignores the
// reason and include_recovered (so the owner sees the whole picture while
// filtering); both honour these two.
function abandoned_date_conds(array $f, string $col): array {
    $c = []; $a = [];
    if ($f['from'] !== null) { $c[] = "{$col} >= ?"; $a[] = $f['from'] . ' 00:00:00'; }
    if ($f['to'] !== null) {
        $c[] = "{$col} < ?";
        $a[] = (new DateTimeImmutable($f['to'] . ' 00:00:00'))->modify('+1 day')->format('Y-m-d H:i:s');
    }
    return [$c, $a];
}

function abandoned_search_conds(array $f): array {
    if ($f['q'] === '') return [[], []];
    // Escape LIKE metacharacters so a typed % or _ is literal. A phone typed
    // with spaces, a plus or Arabic digits is searched by its digits.
    $esc = static fn(string $t): string => '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $t) . '%';
    $digits = preg_replace('/\D/', '', store_ascii_digits($f['q'])) ?? '';
    $phone = (strlen($digits) >= 4 && preg_match('/^[\d\s+\-().\x{0660}-\x{0669}\x{06F0}-\x{06F9}]+$/u', $f['q'])) ? $digits : $f['q'];
    return [["(o.track_id like ? escape '!' or o.customer_name like ? escape '!' or o.customer_phone like ? escape '!')"],
            [$esc($f['q']), $esc($f['q']), $esc($phone)]];
}

// FROM + WHERE of THE PAGE (no search). One ordered query: the optimizer walks the newest
// orders first and stops at the page's last row, so a page costs what it shows.
// $narrow is a redundant, sargable restatement of the wanted reason (the CASE
// below stays the only authority): it lets a rare reason (cod_expired, declined)
// use idx_orders_payment instead of walking the whole table looking for it.
function abandoned_page_from_where(array $f, string $narrow): array {
    [$dc, $da] = abandoned_date_conds($f, 'o.created_at');
    [$sc, $sa] = abandoned_search_conds($f);
    $where = array_merge([ABANDONED_PREFILTER], $narrow !== '' ? [$narrow] : [], $dc, $sc);
    return ['from orders o left join abandoned_followup f on f.order_id = o.id where ' . implode(' and ', $where), array_merge($da, $sa)];
}

// FROM + WHERE for a query that must look at EVERY unpaid or failed order that
// matches: the summary, and a page with a search (a LIKE '%...%' cannot use an
// index, so walking the newest orders one by one would read the whole table).
// It starts from their ids alone: idx_orders_payment (payment_status,
// created_at) answers that without touching a table row, the date range is a
// range on that index, and the full rows are fetched by primary key afterwards.
// The LIMIT is not a limit: a derived table that carries one cannot be merged
// back into the query, and merged it is planned as a scan of the whole table.
function abandoned_candidates_from_where(array $f, string $narrow = ''): array {
    [$dc, $da] = abandoned_date_conds($f, 'created_at');
    [$sc, $sa] = abandoned_search_conds($f);
    $inner = implode(' and ', array_merge(["payment_status in ('pending','failed')"], $dc));
    $from = "from (select id from orders where {$inner} limit 18446744073709551615) c"
          . ' join orders o on o.id = c.id left join abandoned_followup f on f.order_id = o.id where '
          . implode(' and ', array_merge([ABANDONED_PREFILTER], $narrow !== '' ? [$narrow] : [], $sc));
    return [$from, array_merge($da, $sa)];
}

// ------------------------------------------------------------------ THE PAGE

// The SQL of one page and its arguments, apart from running it, so a test can
// EXPLAIN exactly what runs. The page asks for one row more than it shows: that
// row is the "more" flag.
function abandoned_page_query(PDO $db, array $f): array {
    $s = abandoned_settings();
    $reason = abandoned_reason_sql($s, abandoned_table_exists($db, 'order_tracking_events'));
    $rec = abandoned_recovered_sql();
    $discountReleased = store_column_exists($db, 'orders', 'discount_released') ? 'o.discount_released' : '0';

    // "all" is the four abandoned reasons and deliberately not waiting or
    // cancelled. Recovered rows are hidden unless asked for, except when the
    // owner asks for waiting or cancelled orders (recovery means nothing there).
    $want = $f['reason'] === 'all' ? ABANDONED_REASONS : [$f['reason']];
    $in = implode(',', array_map(static fn(string $r): string => "'" . $r . "'", $want));
    $narrow = match ($f['reason']) {
        'declined'    => "o.payment_status = 'failed' and o.payment_method in ('knet','tpay')",
        'unpaid', 'expired', 'waiting' => "o.payment_status = 'pending' and o.payment_method in ('knet','tpay')",
        'cod_expired' => "o.payment_status = 'pending' and o.payment_method = 'cod'",
        'cancelled'   => "o.payment_status = 'pending' and o.fulfilment_status = 'cancelled'",
        default       => '',
    };
    [$fw, $args] = $f['q'] !== '' ? abandoned_candidates_from_where($f, $narrow) : abandoned_page_from_where($f, $narrow);
    // rec_manual is coalesced to 0/1 in the inner select: with a LEFT JOIN a row
    // that has no follow-up carries NULL, and NOT (0 OR NULL) is NULL, which
    // would drop every row that has never been touched.
    $hideRecovered = $f['include_recovered'] || in_array($f['reason'], ABANDONED_OTHER, true)
        ? '' : ' and x.rec_order = 0 and x.rec_manual = 0';

    $sql = "select x.id, x.track_id, x.created_at, x.minutes_ago, x.amount, x.payment_method, x.payment_status,
                   x.fulfilment_status, x.customer_name, x.customer_phone, x.customer_governorate,
                   x.customer_area, x.customer_lang, x.stock_released, x.discount_released,
                   x.reason, x.rec_order, x.rec_manual, x.fu_state, x.fu_note, x.fu_by, x.fu_at
              from (select o.id, o.track_id, o.created_at, timestampdiff(minute, o.created_at, now()) as minutes_ago,
                           o.amount, o.payment_method, o.payment_status, o.fulfilment_status,
                           o.customer_name, o.customer_phone, o.customer_governorate, o.customer_area, o.customer_lang,
                           o.stock_released, {$discountReleased} as discount_released,
                           {$reason} as reason, coalesce({$rec}, 0) as rec_order,
                           coalesce(f.state = 'recovered_manually', 0) as rec_manual,
                           f.state as fu_state, f.note as fu_note, f.updated_by as fu_by, f.updated_at as fu_at
                      {$fw}) x
             where x.reason in ({$in}){$hideRecovered}
             order by x.created_at desc, x.id desc
             limit " . (ABANDONED_PAGE_SIZE + 1) . ' offset ' . (($f['page'] - 1) * ABANDONED_PAGE_SIZE);
    return [$sql, $args];
}

function abandoned_list(PDO $db, array $f): array {
    [$sql, $args] = abandoned_page_query($db, $f);
    $q = $db->prepare($sql);
    $q->execute($args);
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    $more = count($rows) > ABANDONED_PAGE_SIZE;
    if ($more) $rows = array_slice($rows, 0, ABANDONED_PAGE_SIZE);

    $items = abandoned_items($db, array_map(static fn(array $r): int => (int)$r['id'], $rows));
    $orders = [];
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $byOrder = (int)$r['rec_order'] === 1;
        $manual = (int)$r['rec_manual'] === 1;
        $lines = $items[$id] ?? [];
        $count = 0; foreach ($lines as $l) $count += $l['qty'];
        $orders[] = [
            'id' => $id,
            'track_id' => (string)$r['track_id'],
            'created_at' => $r['created_at'],
            'minutes_ago' => max(0, (int)$r['minutes_ago']),
            'reason' => (string)$r['reason'],
            'abandoned' => in_array($r['reason'], ABANDONED_REASONS, true),
            'payment_method' => (string)$r['payment_method'],
            'payment_status' => (string)$r['payment_status'],
            'fulfilment_status' => (string)$r['fulfilment_status'],
            'amount' => round(store_fils($r['amount']) / 1000, 3),
            'item_count' => $count,
            'items' => array_slice($lines, 0, ABANDONED_ITEM_LINES),
            'items_more' => max(0, count($lines) - ABANDONED_ITEM_LINES),
            'customer_name' => (string)($r['customer_name'] ?? ''),
            'customer_phone' => (string)($r['customer_phone'] ?? ''),
            // The canonical 965XXXXXXXX the browser builds wa.me/ from, by the
            // same function checkout uses; null when the stored value is not a
            // Kuwaiti mobile (a historic import).
            'whatsapp_phone' => store_phone((string)($r['customer_phone'] ?? '')),
            'customer_governorate' => (string)($r['customer_governorate'] ?? ''),
            'customer_area' => (string)($r['customer_area'] ?? ''),
            'customer_lang' => $r['customer_lang'] === 'ar' || $r['customer_lang'] === 'en' ? $r['customer_lang'] : null,
            'stock_released' => (int)$r['stock_released'] === 1,
            'discount_released' => (int)$r['discount_released'] === 1,
            'recovered' => $byOrder || $manual,
            'recovered_by' => $byOrder ? 'order' : ($manual ? 'manual' : null),
            'followup' => $r['fu_state'] === null ? null
                : ['state' => (string)$r['fu_state'], 'note' => $r['fu_note'] === null ? '' : (string)$r['fu_note'],
                   'by' => (string)$r['fu_by'], 'at' => $r['fu_at']],
        ];
    }
    return ['orders' => $orders, 'page' => $f['page'], 'has_more' => $more];
}

// The item lines of the page's orders in ONE query (never one per order). The
// name is the one the order was SOLD under, falling back to the catalogue.
function abandoned_items(PDO $db, array $ids): array {
    if (!$ids) return [];
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $q = $db->prepare("select oi.order_id, oi.qty, oi.size, oi.fit,
                              coalesce(oi.name_en, p.name_en) as name_en, coalesce(oi.name_ar, p.name_ar) as name_ar
                         from order_items oi left join products p on p.id = oi.product_id
                        where oi.order_id in ({$marks}) order by oi.order_id, oi.id");
    $q->execute($ids);
    $out = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['order_id']][] = [
            'name_en' => $r['name_en'] === null ? '' : (string)$r['name_en'],
            'name_ar' => $r['name_ar'] === null ? '' : (string)$r['name_ar'],
            'qty' => (int)$r['qty'],
            'size' => $r['size'] === null ? null : (string)$r['size'],
            'fit' => $r['fit'] === null ? null : (string)$r['fit'],
        ];
    }
    return $out;
}

// ---------------------------------------------------------------- THE SUMMARY

// Counts and values by reason over EVERYTHING that matches the date range and
// the search (not just the page). count/value are what is still lost (not
// recovered); recovered_* is what came back. recovery_rate is recovered over
// all abandoned, as a percentage with one decimal, null when there are none.
function abandoned_summary_query(PDO $db, array $f): array {
    $s = abandoned_settings();
    $reason = abandoned_reason_sql($s, abandoned_table_exists($db, 'order_tracking_events'));
    $rec = abandoned_recovered_sql();
    [$fw, $args] = abandoned_candidates_from_where($f);
    $sql = "select x.reason, x.rec, count(*) as n, coalesce(sum(x.amount), 0) as total
              from (select {$reason} as reason,
                           coalesce({$rec} or f.state = 'recovered_manually', 0) as rec, o.amount
                      {$fw}) x
             where x.reason is not null
             group by x.reason, x.rec";
    return [$sql, $args];
}

function abandoned_summary(PDO $db, array $f): array {
    [$sql, $args] = abandoned_summary_query($db, $f);
    $q = $db->prepare($sql);
    $q->execute($args);
    $blank = static fn(): array => ['count' => 0, 'value' => 0.0, 'recovered_count' => 0, 'recovered_value' => 0.0];
    $by = []; foreach (ABANDONED_REASONS as $r) $by[$r] = $blank();
    $other = ['waiting' => ['count' => 0, 'value' => 0.0], 'cancelled' => ['count' => 0, 'value' => 0.0]];
    $fils = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $r = (string)$row['reason']; $n = (int)$row['n']; $v = store_fils($row['total']);
        if (isset($other[$r])) { $other[$r]['count'] += $n; $fils[$r] = ($fils[$r] ?? 0) + $v; continue; }
        if (!isset($by[$r])) continue;
        if ((int)$row['rec'] === 1) { $by[$r]['recovered_count'] += $n; $fils[$r . '/r'] = ($fils[$r . '/r'] ?? 0) + $v; }
        else { $by[$r]['count'] += $n; $fils[$r] = ($fils[$r] ?? 0) + $v; }
    }
    $tot = ['count' => 0, 'recovered_count' => 0]; $totFils = 0; $recFils = 0;
    foreach ($by as $r => &$b) {
        $b['value'] = round(($fils[$r] ?? 0) / 1000, 3);
        $b['recovered_value'] = round(($fils[$r . '/r'] ?? 0) / 1000, 3);
        $tot['count'] += $b['count']; $tot['recovered_count'] += $b['recovered_count'];
        $totFils += $fils[$r] ?? 0; $recFils += $fils[$r . '/r'] ?? 0;
    } unset($b);
    foreach ($other as $r => &$o) $o['value'] = round(($fils[$r] ?? 0) / 1000, 3); unset($o);
    $all = $tot['count'] + $tot['recovered_count'];
    return [
        'abandoned' => [
            'count' => $tot['count'], 'value' => round($totFils / 1000, 3),
            'recovered_count' => $tot['recovered_count'], 'recovered_value' => round($recFils / 1000, 3),
            'recovery_rate' => $all > 0 ? round($tot['recovered_count'] * 100 / $all, 1) : null,
        ],
        'by_reason' => $by,
        'waiting' => $other['waiting'],
        'cancelled_by_shop' => $other['cancelled'],
    ];
}

// The reason of ONE order (null when it is not an abandoned-style order), by the
// same CASE as the list: a follow-up is only accepted for an order the list can
// show, so the table never fills with notes on paid or live orders.
function abandoned_reason_of(PDO $db, int $orderId): ?string {
    $s = abandoned_settings();
    $reason = abandoned_reason_sql($s, abandoned_table_exists($db, 'order_tracking_events'));
    $q = $db->prepare("select {$reason} as reason from orders o where o.id = ? and " . ABANDONED_PREFILTER);
    $q->execute([$orderId]);
    $v = $q->fetchColumn();
    return $v === false || $v === null ? null : (string)$v;
}

// ------------------------------------------------------------------ FOLLOW-UP

// Validates a follow-up request body. Returns the clean input or an error token.
// The note is the owner's own words: control characters are dropped, the length
// is counted in characters (280), and what it says is never echoed in an error.
function abandoned_followup_input(array $b): array|string {
    $id = $b['order_id'] ?? null;
    if (is_string($id) && preg_match('/^[1-9][0-9]{0,9}$/D', $id)) $id = (int)$id;
    if (!is_int($id) || $id < 1 || $id > 4294967295) return 'invalid_order';
    $state = $b['state'] ?? null;
    if (!is_string($state) || !in_array($state, array_merge(ABANDONED_STATES, ['none']), true)) return 'invalid_state';
    $note = $b['note'] ?? '';
    if ($note === null) $note = '';
    if (!is_string($note)) return 'invalid_note';
    $note = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $note) ?? '');
    if (preg_match('//u', $note) !== 1) return 'invalid_note';
    if (mb_strlen($note) > 280) return 'note_too_long';
    return ['order_id' => $id, 'state' => $state, 'note' => $note];
}

// ONE atomic UPSERT on the primary key (order_id), so two tabs, or a double
// tap, can never leave two rows or a state from one request and a note from
// another. 'none' removes the row. A deadlock or lock wait between concurrent
// writers on a brand-new key is retried, never answered as a failure. The order
// must exist and be one the list can show (409 not_abandoned otherwise).
function abandoned_followup_set(PDO $db, array $input, string $adminEmail): array {
    $id = $input['order_id'];
    $exists = $db->prepare('select 1 from orders where id = ?');
    $exists->execute([$id]);
    if ($exists->fetchColumn() === false) return ['error' => 'not_found', 'status' => 404];
    if (abandoned_reason_of($db, $id) === null) return ['error' => 'not_abandoned', 'status' => 409];

    for ($try = 0; ; $try++) {
        try {
            if ($input['state'] === 'none') {
                $db->prepare('delete from abandoned_followup where order_id = ?')->execute([$id]);
                return ['followup' => null];
            }
            $note = $input['note'] === '' ? null : $input['note'];
            $db->prepare('insert into abandoned_followup (order_id, state, note, updated_by) values (?, ?, ?, ?)
                          on duplicate key update state = values(state), note = values(note),
                                                  updated_by = values(updated_by), updated_at = current_timestamp')
               ->execute([$id, $input['state'], $note, mb_substr($adminEmail, 0, 120)]);
            break;
        } catch (PDOException $e) {
            $code = (int)($e->errorInfo[1] ?? 0);
            if ($code === 1452) return ['error' => 'not_found', 'status' => 404];   // the order went away
            if (($code === 1213 || $code === 1205) && $try < 4) { usleep(20000 * ($try + 1)); continue; }
            throw $e;
        }
    }
    $q = $db->prepare('select order_id, state, note, updated_by, updated_at from abandoned_followup where order_id = ?');
    $q->execute([$id]);
    $r = $q->fetch(PDO::FETCH_ASSOC);
    if (!$r) return ['followup' => null];   // removed by a concurrent "none"
    return ['followup' => ['order_id' => (int)$r['order_id'], 'state' => (string)$r['state'],
                           'note' => $r['note'] === null ? '' : (string)$r['note'],
                           'by' => (string)$r['updated_by'], 'at' => $r['updated_at']]];
}

// ------------------------------------------------------------------- ROUTES

// Called by admin.php for ?r=abandoned_orders (GET) and ?r=abandoned_followup
// (POST), AFTER store_require_admin() has proved the session and the
// X-Sporta-Admin header. Never returns: it answers through store_out().
function abandoned_dispatch(PDO $db, string $route, string $method, array $admin): never {
    if ($route === 'abandoned_orders') {
        if ($method !== 'GET') store_fail('method_not_allowed', 405);
        store_throttle($db, 'abandoned_read', 90, 60);
        $f = abandoned_filters($_GET);
        if (is_string($f)) store_fail($f);
        $s = abandoned_settings();
        $page = abandoned_list($db, $f);
        store_out([
            'settings' => ['abandoned_after_minutes' => $s['after_minutes'], 'hold_minutes' => $s['hold_minutes'],
                           'cod_hold_hours' => $s['cod_hold_hours']],
            'filters' => ['reason' => $f['reason'], 'from' => $f['from'], 'to' => $f['to'], 'q' => $f['q'],
                          'include_recovered' => $f['include_recovered']],
            'summary' => abandoned_summary($db, $f),
        ] + $page);
    }
    // abandoned_followup: a write.
    if ($method !== 'POST') store_fail('method_not_allowed', 405);
    store_throttle($db, 'abandoned_write', 30, 60);
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    $input = abandoned_followup_input(store_body(4096));
    if (is_string($input)) store_fail($input);
    $result = abandoned_followup_set($db, $input, (string)$admin['email']);
    if (isset($result['error'])) store_fail($result['error'], $result['status']);
    store_out($result);
}
