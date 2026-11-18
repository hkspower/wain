<?php
// XBRL financial statements for a period (owner request: "build xbrl account"). Admin only: admin.php?r=xbrl_export
// calls xbrl_build() after the admin session check. Nothing here is written to the database.
//
// WHAT IS REPORTED (definitions the numbers follow — change them here, not in the XML). Cash basis, in the SHOP'S day
// (Asia/Kuwait, UTC+3 all year); the database keeps UTC, so a period "2026-11-01 to 2026-11-30" is
// [31 Oct 21:00, 30 Nov 21:00) UTC. Before 2026-11-18 the cut was UTC midnight and up to three hours of orders at each
// end of a month landed in the neighbouring month (ACCOUNTING-SCAN-2026-11-18.md A1).
//   Revenue          orders PAID in [from, to] (any status that began as a payment: paid, refunded, voided): subtotal minus
//                    discount, in full; MINUS the refunds RECORDED in the period (order_refunds.created_at), against any order,
//                    off the goods first and only what exceeds them off delivery. A refund is booked on the day it is made, so a
//                    period that was reported and closed does not change when a later refund lands (A3). Delivery fees are NOT
//                    revenue.
//   OtherIncome      delivery fees collected on those orders, less the refunds that reached them.
//   CostOfSales      for each line of an order paid in the period, quantity x the variant's unit_cost_kwd; REVERSED, on the day of
//                    the refund that closes it, for an order that ended 'refunded' or 'voided' AND whose garments went back to stock
//                    (orders.stock_released = 1, payment-records.php), so the cost and the stock are not both counted (A4). An order
//                    already shipped or delivered keeps its cost: the garments left the shop. A PARTIAL refund leaves the order
//                    'paid' (the customer keeps the goods): its cost stays. A line whose variant has no cost is left out of
//                    CostOfSales and counted in CostMissingLines — never guessed. Refunds of scope 'duplicate' (a second capture of
//                    one payment) and refunds of an order that was never paid (no paid_at) are not revenue refunds and are ignored.
//                    RefundsRead says whether order_refunds could be read (false: refunds.mysql.sql is not imported, nothing was refunded).
//   GrossProfit      Revenue - CostOfSales.
//   Inventories      stock on hand NOW valued at unit_cost_kwd (variants without a cost are counted). The database keeps no
//                    stock history that can be replayed exactly, so this is reported as of InventoriesAsOf (today in Kuwait): the
//                    instant context of the XML carries that date, not the period's end, so a past period is never given
//                    today's stock under its own date (A2).
//   Expenses         the operating expense figures the owner keeps in the inventory settings. Those are current
//                    settings, not dated transactions: they are reported for the period as entered and marked so (ExpensesBasis).
//   ProfitLoss       GrossProfit + OtherIncome - Expenses.
//   ReconciliationDifference
//                    (money received for the orders paid in the period - refunds recorded in it) - (Revenue + OtherIncome). Zero when
//                    every order's stored total is subtotal - discount + delivery. Anything else is an order that does not add up
//                    (the Invoices screen marks it "Check"): the report is built from the parts, so the difference is shown, not
//                    hidden (A7).
// All money is summed in whole fils (integers), never as floating point (A6).
// The taxonomy is IFRS Full Set (2023). The entity identifier is a placeholder until the company's legal identifier
// (commercial registration) is set in the settings; a filing with the placeholder is not a filing.
declare(strict_types=1);

const XBRL_TAXONOMY = 'https://xbrl.ifrs.org/taxonomy/2023-03-23/full_ifrs/full_ifrs-cor_2023-03-23.xsd';
const XBRL_NS_IFRS = 'https://xbrl.ifrs.org/taxonomy/2023-03-23/ifrs-full';
const XBRL_SHOP_TZ = 'Asia/Kuwait';

function xbrl_period_ok(string $from, string $to): bool {
    $a = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
    $b = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
    if (!$a || !$b || $a->format('Y-m-d') !== $from || $b->format('Y-m-d') !== $to) return false;
    $days = (int)$a->diff($b)->format('%r%a');
    return $days > 0 && $days <= 366;
}

/** The UTC timestamps that bound the shop's days [$from 00:00, $to + 1 day 00:00) in Asia/Kuwait: ['Y-m-d H:i:s', 'Y-m-d H:i:s']. */
function xbrl_utc_bounds(string $from, string $to): array {
    $shop = new DateTimeZone(XBRL_SHOP_TZ);
    $utc = new DateTimeZone('UTC');
    $a = (new DateTimeImmutable($from . ' 00:00:00', $shop))->setTimezone($utc);
    $b = (new DateTimeImmutable($to . ' 00:00:00', $shop))->modify('+1 day')->setTimezone($utc);
    return [$a->format('Y-m-d H:i:s'), $b->format('Y-m-d H:i:s')];
}

/** A money value as the database or the settings hold it ("12.500", 12.5, 12) in whole fils. Never goes through a float sum. */
function xbrl_fils($v): int {
    if ($v === null || $v === '') return 0;
    $s = is_float($v) || is_int($v) ? number_format((float)$v, 3, '.', '') : trim((string)$v);
    // the plain decimal the database writes ("12.500", "-3") is read digit by digit; any other form is_numeric accepts (".5", "+5", "1e3")
    // goes through one float, rounded to the fil, rather than being read as 0
    if (!preg_match('/^(-?)(\d+)(?:\.(\d*))?$/D', $s) && is_numeric($s)) $s = number_format((float)$s, 3, '.', '');
    if (!preg_match('/^(-?)(\d+)(?:\.(\d*))?$/D', $s, $m)) return 0;
    $f = (int)$m[2] * 1000 + (int)str_pad(substr($m[3] ?? '', 0, 3), 3, '0');
    return $m[1] === '-' ? -$f : $f;
}

/** Whole fils -> the float the JSON and the XML carry (three decimals exactly). */
function xbrl_out(int $fils): float { return round($fils / 1000, 3); }

// Returns ['values' => [...], 'xml' => '...'] for the period. $db is the store PDO.
function xbrl_build(PDO $db, string $from, string $to, array $settings, string $entityName, string $entityId): array {
    [$fromUtc, $toUtc] = xbrl_utc_bounds($from, $to);
    $today = (new DateTimeImmutable('now', new DateTimeZone(XBRL_SHOP_TZ)))->format('Y-m-d');

    // Orders paid in the period, whatever became of them afterwards: a refund is its own event, booked below on its own day.
    $orders = $db->prepare("select o.id, o.subtotal, o.discount_amount, o.delivery_fee, o.amount, o.payment_status
        from orders o where o.payment_status in ('paid','refunded','voided') and o.paid_at >= ? and o.paid_at < ?");
    $orders->execute([$fromUtc, $toUtc]);
    $rows = $orders->fetchAll(PDO::FETCH_ASSOC);

    $lineQ = $db->prepare('select oi.qty, pv.unit_cost_kwd from order_items oi
        join products p on p.id = oi.product_id
        left join product_variants pv on pv.slug = p.slug and pv.size = oi.size
        where oi.order_id = ?');
    $missing = 0; $lines = 0;
    // The cost of one order's lines in fils. $count says whether the lines are counted in LinesCounted / CostMissingLines (the sale does, the reversal does not).
    $orderCost = function (int $orderId, bool $count) use ($lineQ, &$missing, &$lines): int {
        $lineQ->execute([$orderId]);
        $sum = 0;
        foreach ($lineQ->fetchAll(PDO::FETCH_ASSOC) as $l) {
            if ($count) $lines++;
            if ($l['unit_cost_kwd'] === null) { if ($count) $missing++; continue; }
            $sum += (int)$l['qty'] * xbrl_fils($l['unit_cost_kwd']);
        }
        return $sum;
    };

    $revenue = 0; $delivery = 0; $cost = 0; $received = 0;
    foreach ($rows as $o) {
        $revenue += xbrl_fils($o['subtotal']) - xbrl_fils($o['discount_amount']);
        $delivery += xbrl_fils($o['delivery_fee']);
        $received += xbrl_fils($o['amount']);
        $cost += $orderCost((int)$o['id'], true);
    }

    // Refunds recorded in the period, against any order (order_refunds exists once refunds.mysql.sql is imported; before it nothing was
    // refunded through the shop). Three rules, each from the independent review of 2026-11-18:
    //  - only scope 'order' rows count. A 'duplicate' row returns a SECOND capture of one payment (payment-records.php): the order stays
    //    paid, its takings were never doubled, so it is neither a refund of revenue nor a reason to reverse a cost;
    //  - an order with no paid_at (a payment never confirmed, then refunded from 'review') was never revenue, so its refund takes nothing off;
    //  - the cost comes back only when the garments did: orders.stock_released = 1 (payrec_stop_order does not release the stock of an order
    //    already shipped or delivered, and a cost of goods that left the shop stays a cost).
    // The figures are collected apart and applied once at the end, so a failure part way can never leave a half-booked report; and only
    // "the table does not exist" is the no-migration case — any other database error is a failure and is raised, not hidden.
    $refundedInPeriod = 0; $costReversed = 0; $dRevenue = 0; $dDelivery = 0; $dCost = 0; $refundsRead = true;
    try {
        $inPeriod = $db->prepare("select distinct order_id from order_refunds where scope = 'order' and created_at >= ? and created_at < ?");
        $inPeriod->execute([$fromUtc, $toUtc]);
        $ids = array_map('intval', $inPeriod->fetchAll(PDO::FETCH_COLUMN));
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $all = $db->prepare("select id, order_id, amount, created_at from order_refunds where scope = 'order' and order_id in ($in) order by order_id, id");
            $all->execute($ids);
            $byOrder = [];
            foreach ($all->fetchAll(PDO::FETCH_ASSOC) as $r) $byOrder[(int)$r['order_id']][] = $r;
            $ord = $db->prepare("select id, subtotal, discount_amount, delivery_fee, payment_status, paid_at, stock_released from orders where id in ($in)");
            $ord->execute($ids);
            $meta = [];
            foreach ($ord->fetchAll(PDO::FETCH_ASSOC) as $m) $meta[(int)$m['id']] = $m;
            foreach ($byOrder as $oid => $list) {
                if (!isset($meta[$oid]) || $meta[$oid]['paid_at'] === null) continue;
                $goods = max(0, xbrl_fils($meta[$oid]['subtotal']) - xbrl_fils($meta[$oid]['discount_amount']));
                $fee = max(0, xbrl_fils($meta[$oid]['delivery_fee']));
                $before = 0;
                $lastIdx = count($list) - 1;
                foreach ($list as $i => $r) {
                    $amt = xbrl_fils($r['amount']);
                    $inside = $r['created_at'] >= $fromUtc && $r['created_at'] < $toUtc;
                    if ($inside) {
                        // goods first, then delivery: what this row takes off each, from the running total before it
                        $g = min($before + $amt, $goods) - min($before, $goods);
                        $f = min(max(0, $before + $amt - $goods), $fee) - min(max(0, $before - $goods), $fee);
                        $dRevenue += $g;
                        $dDelivery += $f;
                        $refundedInPeriod += $amt;
                        // An order that ended refunded or voided with its garments back on the shelf: its cost is reversed on the day of the closing refund.
                        if ($i === $lastIdx && in_array($meta[$oid]['payment_status'], ['refunded', 'voided'], true) && (int)$meta[$oid]['stock_released'] === 1) {
                            $back = $orderCost($oid, false);
                            $dCost += $back;
                            $costReversed += $back;
                        }
                    }
                    $before += $amt;
                }
            }
        }
    } catch (PDOException $e) {
        // SQLSTATE 42S02 (MySQL 1146): refunds.mysql.sql is not imported yet, nothing has been refunded through the shop, nothing to book.
        if ((string)$e->getCode() !== '42S02' && (int)($e->errorInfo[1] ?? 0) !== 1146) throw $e;
        $refundsRead = false; $refundedInPeriod = 0; $costReversed = 0; $dRevenue = 0; $dDelivery = 0; $dCost = 0;
    }
    $revenue -= $dRevenue; $delivery -= $dDelivery; $cost -= $dCost;

    // Stock on hand NOW (no replayable history): reported as of today in Kuwait, in an instant context of that date.
    $stock = $db->query('select stock, unit_cost_kwd from product_variants')->fetchAll(PDO::FETCH_ASSOC);
    $inventories = 0; $unvalued = 0;
    foreach ($stock as $v) {
        if ($v['unit_cost_kwd'] === null) { $unvalued++; continue; }
        $inventories += (int)$v['stock'] * xbrl_fils($v['unit_cost_kwd']);
    }

    $num = static fn ($k): int => isset($settings[$k]) && is_numeric($settings[$k]) ? xbrl_fils($settings[$k]) : 0;
    $distribution = $num('delivery_expense') + $num('ads_expense');
    $administrative = $num('fixed_expense');
    $otherExpenses = $num('variable_expense') + $num('returns_expense') + $num('damage_expense');
    $expenses = $distribution + $administrative + $otherExpenses;

    $grossProfit = $revenue - $cost;
    $profit = $grossProfit + $delivery - $expenses;
    $difference = ($received - $refundedInPeriod) - ($revenue + $delivery);

    $v = [
        'Revenue' => xbrl_out($revenue), 'CostOfSales' => xbrl_out($cost), 'GrossProfit' => xbrl_out($grossProfit),
        'OtherIncome' => xbrl_out($delivery), 'Inventories' => xbrl_out($inventories),
        'DistributionCosts' => xbrl_out($distribution), 'AdministrativeExpense' => xbrl_out($administrative),
        'OtherExpensesByFunction' => xbrl_out($otherExpenses), 'Expenses' => xbrl_out($expenses),
        'ProfitLoss' => xbrl_out($profit),
        'PaidOrders' => count($rows), 'LinesCounted' => $lines, 'CostMissingLines' => $missing, 'UnvaluedVariants' => $unvalued,
        // what the figures stand on, so a reader is not left to assume
        'AmountReceived' => xbrl_out($received), 'RefundsRecorded' => xbrl_out($refundedInPeriod), 'CostReversed' => xbrl_out($costReversed),
        'RefundsRead' => $refundsRead,
        'ReconciliationDifference' => xbrl_out($difference),
        'InventoriesAsOf' => $today, 'InventoriesAtPeriodEnd' => $to >= $today,
        'ExpensesBasis' => 'current settings, not dated transactions',
        'PeriodBasis' => XBRL_SHOP_TZ . ' days, cash basis',
    ];

    $esc = static fn ($s): string => htmlspecialchars((string)$s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $dec = static fn (float $x): string => number_format($x, 3, '.', '');
    $duration = [
        'D' => "<xbrli:context id=\"D\"><xbrli:entity><xbrli:identifier scheme=\"urn:sporta:entity\">{$esc($entityId)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>{$from}</xbrli:startDate><xbrli:endDate>{$to}</xbrli:endDate></xbrli:period></xbrli:context>",
    ];
    $instant = "<xbrli:context id=\"I\"><xbrli:entity><xbrli:identifier scheme=\"urn:sporta:entity\">{$esc($entityId)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>{$today}</xbrli:instant></xbrli:period></xbrli:context>";
    $fact = static fn (string $name, string $ctx, float $val): string =>
        "  <ifrs-full:{$name} contextRef=\"{$ctx}\" unitRef=\"KWD\" decimals=\"3\">{$dec($val)}</ifrs-full:{$name}>";

    $xml = [];
    $xml[] = '<?xml version="1.0" encoding="UTF-8"?>';
    $xml[] = '<!-- Sporta financial statements, ' . $esc("$from to $to") . ' (days in ' . XBRL_SHOP_TZ . ', cash basis). Definitions: see dropin/php-store/xbrl.php.';
    $xml[] = '     Expenses are current settings for the period, not dated transactions. Inventories is stock on hand on ' . $esc($today) . ' (the instant context), not at the period end. Entity identifier is a placeholder until the legal identifier is set. -->';
    $xml[] = '<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase"'
        . ' xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"'
        . ' xmlns:ifrs-full="' . XBRL_NS_IFRS . '">';
    $xml[] = '  <link:schemaRef xlink:type="simple" xlink:href="' . XBRL_TAXONOMY . '"/>';
    $xml[] = '  ' . $duration['D'];
    $xml[] = '  ' . $instant;
    $xml[] = '  <xbrli:unit id="KWD"><xbrli:measure>iso4217:KWD</xbrli:measure></xbrli:unit>';
    $xml[] = $fact('Revenue', 'D', $v['Revenue']);
    $xml[] = $fact('OtherIncome', 'D', $v['OtherIncome']);
    $xml[] = $fact('CostOfSales', 'D', $v['CostOfSales']);
    $xml[] = $fact('GrossProfit', 'D', $v['GrossProfit']);
    $xml[] = $fact('DistributionCosts', 'D', $v['DistributionCosts']);
    $xml[] = $fact('AdministrativeExpense', 'D', $v['AdministrativeExpense']);
    $xml[] = $fact('OtherExpensesByFunction', 'D', $v['OtherExpensesByFunction']);
    $xml[] = $fact('ProfitLoss', 'D', $v['ProfitLoss']);
    $xml[] = $fact('Inventories', 'I', $v['Inventories']);
    $xml[] = '</xbrli:xbrl>';

    return ['values' => $v, 'entity' => $entityName, 'xml' => implode("\n", $xml) . "\n"];
}
