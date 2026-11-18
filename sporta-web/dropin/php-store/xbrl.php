<?php
// XBRL financial statements for a period (owner request: "build xbrl account"). Admin only: admin.php?r=xbrl_export
// calls xbrl_build() after the admin session check. Nothing here is written to the database.
//
// WHAT IS REPORTED (definitions the numbers follow — change them here, not in the XML):
//   Revenue          paid orders in [from, to): subtotal minus discount. Delivery fees are NOT revenue.
//   OtherIncome      delivery fees collected on those paid orders.
//   CostOfSales      for each paid order line, quantity x the variant's unit_cost_kwd. A line whose variant has no
//                    cost is left out of CostOfSales and counted in CostMissingLines — never guessed.
//   GrossProfit      Revenue - CostOfSales.
//   Inventories      stock on hand at the end date, valued at unit_cost_kwd (variants without a cost are counted).
//   Expenses         the operating expense figures the owner keeps in the inventory settings. Those are current
//                    settings, not dated transactions: they are reported for the period as entered and marked so.
//   ProfitLoss       GrossProfit + OtherIncome - Expenses.
// The taxonomy is IFRS Full Set (2023). The entity identifier is a placeholder until the company's legal identifier
// (commercial registration) is set in the settings; a filing with the placeholder is not a filing.
declare(strict_types=1);

const XBRL_TAXONOMY = 'https://xbrl.ifrs.org/taxonomy/2023-03-23/full_ifrs/full_ifrs-cor_2023-03-23.xsd';
const XBRL_NS_IFRS = 'https://xbrl.ifrs.org/taxonomy/2023-03-23/ifrs-full';

function xbrl_period_ok(string $from, string $to): bool {
    $a = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
    $b = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
    if (!$a || !$b || $a->format('Y-m-d') !== $from || $b->format('Y-m-d') !== $to) return false;
    $days = (int)$a->diff($b)->format('%r%a');
    return $days > 0 && $days <= 366;
}

// Returns ['values' => [...], 'xml' => '...'] for the period. $db is the store PDO.
function xbrl_build(PDO $db, string $from, string $to, array $settings, string $entityName, string $entityId): array {
    // Paid orders in the period, with their lines and each line's variant cost.
    // A refunded or voided order is not 'paid' and is not here at all. A PARTIAL
    // refund (payment-records.php) leaves the order 'paid' and is taken off its
    // revenue: off the goods first, and only what exceeds them off delivery.
    // Before refunds.mysql.sql there is no refunded_amount, and nothing was.
    $refundCol = function_exists('store_column_exists') && store_column_exists($db, 'orders', 'refunded_amount')
        ? 'o.refunded_amount' : '0 as refunded_amount';
    $orders = $db->prepare("select o.id, o.subtotal, o.discount_amount, o.delivery_fee, {$refundCol}
        from orders o where o.payment_status = 'paid' and o.paid_at >= ? and o.paid_at < date_add(?, interval 1 day)");
    $orders->execute([$from, $to]);
    $rows = $orders->fetchAll(PDO::FETCH_ASSOC);

    $revenue = 0.0; $delivery = 0.0; $cost = 0.0; $missing = 0; $lines = 0;
    $lineQ = $db->prepare('select oi.qty, pv.unit_cost_kwd from order_items oi
        join products p on p.id = oi.product_id
        left join product_variants pv on pv.slug = p.slug and pv.size = oi.size
        where oi.order_id = ?');
    foreach ($rows as $o) {
        $goods = (float)$o['subtotal'] - (float)$o['discount_amount'];
        $fee = (float)$o['delivery_fee'];
        $back = max(0.0, (float)$o['refunded_amount']);
        $fromGoods = min($back, max(0.0, $goods));
        $revenue += $goods - $fromGoods;
        $delivery += max(0.0, $fee - ($back - $fromGoods));
        $lineQ->execute([(int)$o['id']]);
        foreach ($lineQ->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $lines++;
            if ($l['unit_cost_kwd'] === null) { $missing++; continue; }
            $cost += (int)$l['qty'] * (float)$l['unit_cost_kwd'];
        }
    }

    // Stock on hand at the end of the period (end date inclusive, i.e. before the next day).
    $stock = $db->query('select stock, unit_cost_kwd from product_variants')->fetchAll(PDO::FETCH_ASSOC);
    $inventories = 0.0; $unvalued = 0;
    foreach ($stock as $v) {
        if ($v['unit_cost_kwd'] === null) { $unvalued++; continue; }
        $inventories += (int)$v['stock'] * (float)$v['unit_cost_kwd'];
    }

    $num = static fn ($k): float => isset($settings[$k]) && is_numeric($settings[$k]) ? (float)$settings[$k] : 0.0;
    $distribution = $num('delivery_expense') + $num('ads_expense');
    $administrative = $num('fixed_expense');
    $otherExpenses = $num('variable_expense') + $num('returns_expense') + $num('damage_expense');
    $expenses = $distribution + $administrative + $otherExpenses;

    $grossProfit = $revenue - $cost;
    $profit = $grossProfit + $delivery - $expenses;

    $v = [
        'Revenue' => round($revenue, 3), 'CostOfSales' => round($cost, 3), 'GrossProfit' => round($grossProfit, 3),
        'OtherIncome' => round($delivery, 3), 'Inventories' => round($inventories, 3),
        'DistributionCosts' => round($distribution, 3), 'AdministrativeExpense' => round($administrative, 3),
        'OtherExpensesByFunction' => round($otherExpenses, 3), 'Expenses' => round($expenses, 3),
        'ProfitLoss' => round($profit, 3),
        'PaidOrders' => count($rows), 'LinesCounted' => $lines, 'CostMissingLines' => $missing, 'UnvaluedVariants' => $unvalued,
    ];

    $esc = static fn ($s): string => htmlspecialchars((string)$s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $dec = static fn (float $x): string => number_format($x, 3, '.', '');
    $duration = [
        'D' => "<xbrli:context id=\"D\"><xbrli:entity><xbrli:identifier scheme=\"urn:sporta:entity\">{$esc($entityId)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>{$from}</xbrli:startDate><xbrli:endDate>{$to}</xbrli:endDate></xbrli:period></xbrli:context>",
    ];
    $instant = "<xbrli:context id=\"I\"><xbrli:entity><xbrli:identifier scheme=\"urn:sporta:entity\">{$esc($entityId)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>{$to}</xbrli:instant></xbrli:period></xbrli:context>";
    $fact = static fn (string $name, string $ctx, float $val): string =>
        "  <ifrs-full:{$name} contextRef=\"{$ctx}\" unitRef=\"KWD\" decimals=\"3\">{$dec($val)}</ifrs-full:{$name}>";

    $xml = [];
    $xml[] = '<?xml version="1.0" encoding="UTF-8"?>';
    $xml[] = '<!-- Sporta financial statements, ' . $esc("$from to $to") . '. Definitions: see dropin/php-store/xbrl.php.';
    $xml[] = '     Expenses are current settings for the period, not dated transactions. Entity identifier is a placeholder until the legal identifier is set. -->';
    $xml[] = '<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase"'
        . ' xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"'
        . ' xmlns:ifrs-full="' . XBRL_NS_IFRS . '">';
    $xml[] = '  <link:schemaRef xlink:type="simple" xlink:href="' . XBRL_TAXONOMY . '"/>';
    $xml[] = '  ' . $duration['D'];
    $xml[] = '  ' . $instant;
    $xml[] = '  <xbrli:unit id="KWD"><xbrli:measure>iso4217:KWD</xbrli:measure></xbrli:unit>';
    $xml[] = $fact('Revenue', 'D', $revenue);
    $xml[] = $fact('OtherIncome', 'D', $delivery);
    $xml[] = $fact('CostOfSales', 'D', $cost);
    $xml[] = $fact('GrossProfit', 'D', $grossProfit);
    $xml[] = $fact('DistributionCosts', 'D', $distribution);
    $xml[] = $fact('AdministrativeExpense', 'D', $administrative);
    $xml[] = $fact('OtherExpensesByFunction', 'D', $otherExpenses);
    $xml[] = $fact('ProfitLoss', 'D', $profit);
    $xml[] = $fact('Inventories', 'I', $inventories);
    $xml[] = '</xbrli:xbrl>';

    return ['values' => $v, 'entity' => $entityName, 'xml' => implode("\n", $xml) . "\n"];
}
