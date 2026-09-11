<?php
// Sporta — the double-entry ledger.
//
// Required by admin.php. See accounting.mysql.sql for the schema and for why
// the books are kept on a CASH BASIS.
//
// ---------------------------------------------------------------------------
// THE THREE RULES THIS FILE EXISTS TO ENFORCE
//
//   1. Every entry balances. Debits equal credits, to the fils, or nothing is
//      written. No MySQL CHECK can express this — a constraint sees one row —
//      so acc_post() is the only way lines are ever written, and it refuses.
//
//   2. Nothing is ever edited or deleted. A mistake is corrected by posting
//      its mirror and linking the two. The ledger is a record of what was
//      believed at the time, and an editable record is not a record.
//
//   3. An event posts exactly once. The unique key on (source, source_ref,
//      kind) is the guarantee; this file's job is to treat the resulting
//      duplicate-key error as success, because that is what it means.
//
// ---------------------------------------------------------------------------
// EVERYTHING IS INTEGER FILS
//
// store_fils()/store_kwd() from store.php, the same pair the pricing code has
// always used. Amounts cross into SQL as decimal strings via store_kwd() and
// come back as strings, and every sum in between is an int. There is no float
// anywhere in this file, and that is not fastidiousness: a tenth of a fils lost
// to binary rounding is a trial balance that does not balance, and a ledger
// that does not balance is one nobody can use for anything.

declare(strict_types=1);

// The accounts the POSTING RULES name. Changing a code here without changing
// the seed in accounting.mysql.sql breaks posting on a live shop at the moment
// of a payment, which is the worst possible moment, so they are named once.
const ACC_CASH        = '1000';
const ACC_KNET        = '1010';
const ACC_TPAY        = '1020';
const ACC_INVENTORY   = '1200';
const ACC_SALES       = '4000';
const ACC_DELIVERY    = '4100';
const ACC_DISCOUNTS   = '4900';
const ACC_COGS        = '5000';

// Which account the money lands in, per payment method. COD is cash in hand —
// the courier collects it — while the two card products each sit in their own
// clearing account until the bank settles. See the seed for why that is not
// one bank account.
const ACC_BY_METHOD = [
    'cod'  => ACC_CASH,
    'knet' => ACC_KNET,
    'tpay' => ACC_TPAY,
];

// -------------------------------------------------------------- settings
//
// Merged over defaults in PHP as well as seeded in SQL, the same belt and
// braces store_setting() uses: a shop that has not imported this file's
// migration yet must not fatal, it must simply not post.
const ACC_SETTING_DEFAULTS = [
    'aed_to_kwd'      => '0.0817',
    'posting_enabled' => false,
];

function acc_settings(PDO $db): array {
    return array_merge(ACC_SETTING_DEFAULTS, store_settings($db)['accounting'] ?? []);
}

// The AED->KWD rate as a multiplier in fils-per-fils, avoided entirely: the
// rate is applied to an AED figure to produce KWD fils, in one integer step.
//
// $aed arrives as a decimal string from the database. It is scaled by 10^5
// before the multiply so that a rate of 0.0817 keeps all four of its
// significant figures, and the division rounds HALF DOWN rather than half up.
// Rounding a cost down understates COGS and so overstates profit by up to one
// fils per line, which is the wrong direction — but the alternative, rounding
// up, overstates cost on every one of thousands of lines and drifts the
// inventory account away from anything real. One fils either way is noise; a
// consistent, documented direction is what stops it becoming a mystery.
function acc_aed_to_fils(string|float|null $aed, string $rate): int {
    $aedMilli  = (int) round(((float) $aed) * 1000);      // AED, three places
    $rateScale = (int) round(((float) $rate) * 100000);   // rate, five places
    return intdiv($aedMilli * $rateScale, 100000);
}

// ------------------------------------------------------------ the accounts

function acc_accounts(PDO $db, bool $activeOnly = false): array {
    $sql = 'select id, code, name_en, name_ar, type, normal_side, is_system, active
              from accounts' . ($activeOnly ? ' where active = 1' : '') . ' order by code';
    return $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
}

// Account ids by code, for one request. Posting an order touches five or six
// accounts and every one of them would otherwise be a separate SELECT inside
// the payment transaction.
function acc_ids(PDO $db): array {
    static $map = null;
    if ($map === null) {
        $map = [];
        foreach ($db->query('select id, code from accounts') as $row) {
            $map[$row['code']] = (int) $row['id'];
        }
    }
    return $map;
}

// ---------------------------------------------------------------- posting

/**
 * Write one balanced journal entry.
 *
 * $lines is a list of ['code' => '4000', 'debit' => fils] or
 * ['code' => '1010', 'credit' => fils]. Zero-value lines are DROPPED rather
 * than rejected: an order with no discount and no delivery fee would otherwise
 * need the caller to build its line list conditionally, and a caller doing
 * that by hand is a caller that will one day forget a case.
 *
 * Returns the entry id, or null if this exact (source, source_ref, kind) was
 * already posted — which is not an error and must not be treated as one.
 *
 * NOT ITS OWN TRANSACTION when one is already open. An order's posting belongs
 * inside the transaction that marks the order paid: if the payment write rolls
 * back, the revenue must roll back with it, and a nested beginTransaction()
 * would either throw or silently commit the outer one.
 */
function acc_post(
    PDO $db,
    string $date,
    string $memo,
    array $lines,
    string $source = 'manual',
    ?string $sourceRef = null,
    ?string $kind = null,
    ?string $by = null,
    ?int $reverses = null
): ?int {
    $ids = acc_ids($db);

    $clean = [];
    $debits = 0;
    $credits = 0;
    foreach ($lines as $l) {
        $debit  = (int) ($l['debit'] ?? 0);
        $credit = (int) ($l['credit'] ?? 0);
        if ($debit === 0 && $credit === 0) continue;
        if ($debit < 0 || $credit < 0) {
            // A negative debit is a credit written by somebody who has confused
            // themselves. Allowing it would make every report's arithmetic
            // depend on nobody ever having done so.
            throw new InvalidArgumentException('accounting: a line may not be negative');
        }
        if ($debit > 0 && $credit > 0) {
            throw new InvalidArgumentException('accounting: a line is a debit or a credit, not both');
        }
        $code = (string) $l['code'];
        if (!isset($ids[$code])) {
            throw new InvalidArgumentException("accounting: no such account $code");
        }
        $clean[] = [$ids[$code], $debit, $credit, (string) ($l['memo'] ?? '')];
        $debits  += $debit;
        $credits += $credit;
    }

    if (!$clean) return null;                 // nothing happened; nothing to say
    if (count($clean) < 2) {
        throw new InvalidArgumentException('accounting: an entry needs at least two lines');
    }
    // RULE 1. To the fils, with no tolerance — a tolerance is how a ledger
    // starts drifting, and there is nothing to tolerate when every figure is
    // already an integer.
    if ($debits !== $credits) {
        throw new RuntimeException(
            'accounting: entry does not balance — debits ' . store_kwd($debits)
            . ' vs credits ' . store_kwd($credits)
        );
    }

    $ownTx = !$db->inTransaction();
    if ($ownTx) $db->beginTransaction();
    try {
        $ins = $db->prepare(
            'insert into journal_entries (entry_date, memo, source, source_ref, kind, created_by, reverses_id)
             values (?, ?, ?, ?, ?, ?, ?)'
        );
        try {
            $ins->execute([$date, $memo, $source, $sourceRef, $kind, $by, $reverses]);
        } catch (PDOException $e) {
            // RULE 3. 23000 is an integrity violation, and on this table with
            // this data the only unique key it can be is uq_journal_source.
            // "Already posted" is the answer, not a failure: the bank retried,
            // or two people marked the same COD order paid.
            if (($e->errorInfo[0] ?? '') === '23000') {
                if ($ownTx) $db->rollBack();
                return null;
            }
            throw $e;
        }
        $entryId = (int) $db->lastInsertId();

        $line = $db->prepare(
            'insert into journal_lines (entry_id, account_id, debit, credit, memo) values (?, ?, ?, ?, ?)'
        );
        foreach ($clean as [$accountId, $debit, $credit, $lineMemo]) {
            $line->execute([$entryId, $accountId, store_kwd($debit), store_kwd($credit), $lineMemo]);
        }

        if ($reverses !== null) {
            $db->prepare('update journal_entries set reversed_by_id = ? where id = ? and reversed_by_id is null')
               ->execute([$entryId, $reverses]);
        }

        if ($ownTx) $db->commit();
        return $entryId;
    } catch (Throwable $e) {
        if ($ownTx && $db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

/**
 * Post an order that has just been PAID. Cash basis: this is called at the
 * moment the money arrives, never when the order is placed.
 *
 * Two entries, deliberately, because they are two different facts and a shop
 * will want them separately:
 *
 *   sale  Dr  clearing/cash   amount        the money
 *         Dr  discounts       discount      what the promotion cost
 *             Cr sales        subtotal      what the goods listed at
 *             Cr delivery     fee           what was charged to deliver
 *
 *   cogs  Dr  cost of goods   cost          what the goods cost the shop
 *             Cr inventory    cost          which is no longer in stock
 *
 * The sale entry balances by identity, since amount = subtotal - discount +
 * delivery is how create_order computes it — but it is checked rather than
 * trusted, because that identity holding is precisely what would be broken by
 * the kind of bug this ledger is meant to catch.
 *
 * SAFE TO CALL TWICE, and it will be. Returns the number of entries actually
 * written: 2 on the first call, 0 on every call after.
 */
function acc_post_order(PDO $db, int $orderId, ?string $by = null): int {
    $cfg = acc_settings($db);
    if (!($cfg['posting_enabled'] ?? false)) return 0;

    $o = $db->prepare(
        'select id, track_id, amount, subtotal, discount_amount, delivery_fee,
                payment_method, payment_status, paid_at, created_at
           from orders where id = ?'
    );
    $o->execute([$orderId]);
    $order = $o->fetch(PDO::FETCH_ASSOC);
    if (!$order) return 0;

    // CASH BASIS. Anything not actually paid is not in these books.
    if (($order['payment_status'] ?? '') !== 'paid') return 0;

    // The date the money arrived, falling back to the order's own date for a
    // row paid before paid_at existed. Never today's date: a COD payment
    // recorded on Thursday for money taken on Tuesday belongs to Tuesday, and
    // using the clock would quietly move takings between months.
    $date = substr((string) ($order['paid_at'] ?: $order['created_at']), 0, 10);

    $amount   = store_fils($order['amount']);
    $subtotal = store_fils($order['subtotal']);
    $discount = store_fils($order['discount_amount']);
    $delivery = store_fils($order['delivery_fee']);

    // Orders taken before the discount migration have subtotal 0 and only an
    // amount. Treating that as "sold nothing for 12.500 KWD" would post a wildly
    // unbalanced entry; the honest reading is that the amount IS the subtotal.
    if ($subtotal === 0 && $amount > 0 && $discount === 0 && $delivery === 0) {
        $subtotal = $amount;
    }

    if ($amount !== $subtotal - $discount + $delivery) {
        throw new RuntimeException(
            "accounting: order {$order['track_id']} does not add up — "
            . store_kwd($subtotal) . ' - ' . store_kwd($discount) . ' + ' . store_kwd($delivery)
            . ' != ' . store_kwd($amount)
        );
    }

    $cashAccount = ACC_BY_METHOD[$order['payment_method']] ?? ACC_CASH;
    $ref = (string) $order['id'];
    $written = 0;

    $sale = acc_post($db, $date, 'Order ' . $order['track_id'], [
        ['code' => $cashAccount,  'debit'  => $amount,   'memo' => $order['payment_method']],
        ['code' => ACC_DISCOUNTS, 'debit'  => $discount, 'memo' => 'discount'],
        ['code' => ACC_SALES,     'credit' => $subtotal],
        ['code' => ACC_DELIVERY,  'credit' => $delivery],
    ], 'order', $ref, 'sale', $by);
    if ($sale !== null) $written++;

    $cost = acc_order_cost_fils($db, $orderId, (string) $cfg['aed_to_kwd']);
    if ($cost > 0) {
        $cogs = acc_post($db, $date, 'Cost of order ' . $order['track_id'], [
            ['code' => ACC_COGS,      'debit'  => $cost],
            ['code' => ACC_INVENTORY, 'credit' => $cost],
        ], 'order', $ref, 'cogs', $by);
        if ($cogs !== null) $written++;
    }

    return $written;
}

/**
 * What the goods on an order cost the shop, in KWD fils.
 *
 * The cost is per SIZE, not per product: product_variants is keyed on sku and
 * holds cost_aed per size, because a 5XL takes more fabric than an S and AHED
 * invoices accordingly. The join is therefore on slug AND size.
 *
 * A missing cost contributes ZERO rather than guessing from the price. That is
 * a deliberate understatement of cost: it makes the shop look more profitable
 * than it is, which is the wrong direction — but the alternative is inventing a
 * figure and burying it in the ledger where nobody will ever question it. The
 * Accounting screen reports how many orders had costs missing, which is the
 * honest way to surface it: a number the owner can go and fix at its source.
 */
function acc_order_cost_fils(PDO $db, int $orderId, string $rate): int {
    $q = $db->prepare(
        'select oi.qty, v.cost_aed
           from order_items oi
           join products p on p.id = oi.product_id
           left join product_variants v
             on v.slug = p.slug
            and v.size = coalesce(oi.size, v.size)
          where oi.order_id = ?'
    );
    $q->execute([$orderId]);
    $total = 0;
    foreach ($q as $row) {
        if ($row['cost_aed'] === null) continue;
        $total += acc_aed_to_fils($row['cost_aed'], $rate) * (int) $row['qty'];
    }
    return $total;
}

/**
 * Reverse an entry: post its mirror image and link the two.
 *
 * Not a delete, and not an edit. Both rows remain, they sum to nothing, and
 * the history says what happened and that it was undone — which is the whole
 * reason a ledger is worth keeping.
 */
function acc_reverse(PDO $db, int $entryId, string $memo, ?string $by = null): ?int {
    $e = $db->prepare('select id, entry_date, memo, reversed_by_id from journal_entries where id = ?');
    $e->execute([$entryId]);
    $entry = $e->fetch(PDO::FETCH_ASSOC);
    if (!$entry) return null;
    // Reversing a reversal twice would net the original back into existence
    // without anybody meaning it.
    if ($entry['reversed_by_id'] !== null) return null;

    $l = $db->prepare('select a.code, l.debit, l.credit, l.memo
                         from journal_lines l join accounts a on a.id = l.account_id
                        where l.entry_id = ?');
    $l->execute([$entryId]);

    $lines = [];
    foreach ($l as $row) {
        // Debit becomes credit and credit becomes debit. That is the whole of
        // a reversal.
        $lines[] = [
            'code'   => $row['code'],
            'debit'  => store_fils($row['credit']),
            'credit' => store_fils($row['debit']),
            'memo'   => $row['memo'],
        ];
    }
    if (!$lines) return null;

    // Dated TODAY, not the original's date, and this is a real choice. Dating a
    // reversal back would silently rewrite a month that may already have been
    // reported to somebody. The correction belongs to the day it was made.
    return acc_post($db, date('Y-m-d'), $memo, $lines, 'manual', null, null, $by, $entryId);
}

// ---------------------------------------------------------------- reports

/**
 * The trial balance: every account, its debits, its credits, and its balance
 * in its own normal direction.
 *
 * This is the report that proves the others. If total debits and total credits
 * differ, something is wrong with the books themselves and no profit figure
 * computed from them means anything — so the caller is handed both totals and
 * the screen shows them side by side rather than hiding a discrepancy behind a
 * tidy layout.
 *
 * $from/$to are optional and inclusive. A trial balance is normally
 * cumulative-to-date; a dated one is what you want for tying out a month.
 */
function acc_trial_balance(PDO $db, ?string $from = null, ?string $to = null): array {
    $where = [];
    $args  = [];
    if ($from) { $where[] = 'e.entry_date >= ?'; $args[] = $from; }
    if ($to)   { $where[] = 'e.entry_date <= ?'; $args[] = $to; }

    // THE PERIOD FILTERS THE LINES, IN A SUBQUERY, and getting this wrong is
    // silent in the worst way.
    //
    // The first version joined accounts -> lines -> entries and hung the date
    // condition on the entries join. It read correctly and did nothing: the
    // sums come from the LINES, and a line whose entry falls outside the range
    // still joins to its account — only `e` goes null. So every report ignored
    // its own date range, and a profit and loss for January 2032 returned the
    // previous June's figures.
    //
    // Nothing about that is visible from a balance check, because dropping the
    // filter drops it from both sides equally: the books balanced, every
    // invariant held, and the number was for the wrong period. It was found by
    // an example test asserting that an empty month is empty — which is the
    // argument for having both kinds.
    //
    // Moving the condition into a WHERE would have been the other classic
    // error: it turns the outer join inner and drops every account with no
    // movement, so a quiet month reports a chart of three accounts.
    //
    // Filtering inside a subquery and LEFT JOINing to that is what satisfies
    // both: out-of-period lines are gone, and every account is still listed.
    $filtered = 'select l.account_id, l.debit, l.credit
                   from journal_lines l
                   join journal_entries e on e.id = l.entry_id'
              . ($where ? ' where ' . implode(' and ', $where) : '');

    $sql = 'select a.id, a.code, a.name_en, a.name_ar, a.type, a.normal_side,
                   coalesce(sum(l.debit), 0)  as debit,
                   coalesce(sum(l.credit), 0) as credit
              from accounts a
              left join (' . $filtered . ') l on l.account_id = a.id
             group by a.id, a.code, a.name_en, a.name_ar, a.type, a.normal_side
             order by a.code';
    $q = $db->prepare($sql);
    $q->execute($args);

    $rows = [];
    $totalDebit = 0;
    $totalCredit = 0;
    foreach ($q as $r) {
        $debit  = store_fils($r['debit']);
        $credit = store_fils($r['credit']);
        $balance = $r['normal_side'] === 'debit' ? $debit - $credit : $credit - $debit;
        $totalDebit  += $debit;
        $totalCredit += $credit;
        $rows[] = [
            'code' => $r['code'], 'name_en' => $r['name_en'], 'name_ar' => $r['name_ar'],
            'type' => $r['type'], 'normal_side' => $r['normal_side'],
            'debit' => store_kwd($debit), 'credit' => store_kwd($credit),
            'balance' => store_kwd($balance), 'balance_fils' => $balance,
        ];
    }
    return [
        'rows' => $rows,
        'total_debit'  => store_kwd($totalDebit),
        'total_credit' => store_kwd($totalCredit),
        'balanced'     => $totalDebit === $totalCredit,
        'out_by'       => store_kwd($totalDebit - $totalCredit),
    ];
}

/**
 * Profit and loss for a period.
 *
 * Revenue accounts net of the contra-revenue one, less expenses. Cost of goods
 * is reported on its own line rather than lumped with the other expenses,
 * because gross margin — what the shop makes on the garments before it pays
 * for anything else — is the number a retailer actually steers by.
 */
function acc_profit_loss(PDO $db, string $from, string $to): array {
    $tb = acc_trial_balance($db, $from, $to);

    $revenue = [];
    $cogs    = [];
    $expense = [];
    $revenueTotal = 0;
    $cogsTotal    = 0;
    $expenseTotal = 0;

    foreach ($tb['rows'] as $r) {
        if ($r['balance_fils'] === 0) continue;
        if ($r['type'] === 'revenue') {
            // A contra-revenue account (discounts) has a debit normal side, so
            // its balance is positive when discounts were given. It REDUCES
            // revenue, so it is carried as a negative here and shown as its own
            // line — netting it away silently is how a shop loses the ability
            // to say what its promotions cost.
            $signed = $r['normal_side'] === 'credit' ? $r['balance_fils'] : -$r['balance_fils'];
            $revenue[] = $r + ['amount' => store_kwd($signed), 'amount_fils' => $signed];
            $revenueTotal += $signed;
        } elseif ($r['code'] === ACC_COGS) {
            $cogs[] = $r + ['amount' => $r['balance'], 'amount_fils' => $r['balance_fils']];
            $cogsTotal += $r['balance_fils'];
        } elseif ($r['type'] === 'expense') {
            $expense[] = $r + ['amount' => $r['balance'], 'amount_fils' => $r['balance_fils']];
            $expenseTotal += $r['balance_fils'];
        }
    }

    $gross = $revenueTotal - $cogsTotal;
    $net   = $gross - $expenseTotal;
    return [
        'from' => $from, 'to' => $to,
        'revenue' => $revenue, 'cogs' => $cogs, 'expenses' => $expense,
        'revenue_total' => store_kwd($revenueTotal),
        'cogs_total'    => store_kwd($cogsTotal),
        'gross_profit'  => store_kwd($gross),
        'expense_total' => store_kwd($expenseTotal),
        'net_profit'    => store_kwd($net),
        // Margin as a percentage, to one place, computed in integers. Null
        // rather than zero when there is no revenue: "0% margin" on a month
        // with no sales is a claim, and there is nothing to claim.
        'gross_margin_pct' => $revenueTotal > 0
            ? number_format(intdiv($gross * 1000, $revenueTotal) / 10, 1, '.', '')
            : null,
    ];
}

/**
 * The balance sheet, as at a date.
 *
 * Assets = liabilities + equity, where equity includes the profit earned so
 * far — which is not stored anywhere and must not be. Retained earnings is a
 * DERIVED figure: revenue less expenses since the books began. Storing it
 * would mean two sources for one number, and they would disagree the first
 * time anybody posted a backdated entry.
 */
function acc_balance_sheet(PDO $db, string $asAt): array {
    $tb = acc_trial_balance($db, null, $asAt);

    $assets = [];
    $liabilities = [];
    $equity = [];
    $assetTotal = 0;
    $liabilityTotal = 0;
    $equityTotal = 0;
    $earned = 0;

    foreach ($tb['rows'] as $r) {
        if ($r['type'] === 'asset') {
            if ($r['balance_fils'] !== 0) $assets[] = $r;
            $assetTotal += $r['balance_fils'];
        } elseif ($r['type'] === 'liability') {
            if ($r['balance_fils'] !== 0) $liabilities[] = $r;
            $liabilityTotal += $r['balance_fils'];
        } elseif ($r['type'] === 'equity') {
            if ($r['balance_fils'] !== 0) $equity[] = $r;
            // Drawings is an equity account with a DEBIT normal side, so its
            // balance is positive when money has been taken out — and it
            // reduces equity. Same shape as the contra-revenue account above.
            $equityTotal += $r['normal_side'] === 'credit' ? $r['balance_fils'] : -$r['balance_fils'];
        } elseif ($r['type'] === 'revenue') {
            $earned += $r['normal_side'] === 'credit' ? $r['balance_fils'] : -$r['balance_fils'];
        } elseif ($r['type'] === 'expense') {
            $earned -= $r['balance_fils'];
        }
    }

    $equityTotal += $earned;
    return [
        'as_at' => $asAt,
        'assets' => $assets, 'liabilities' => $liabilities, 'equity' => $equity,
        'retained_earnings' => store_kwd($earned),
        'assets_total' => store_kwd($assetTotal),
        'liabilities_total' => store_kwd($liabilityTotal),
        'equity_total' => store_kwd($equityTotal),
        // The identity, checked rather than assumed. If this is ever false the
        // screen says so in place of the figures: a balance sheet that does not
        // balance is not a balance sheet, and showing it as though it were is
        // how a wrong number gets used.
        'balanced' => $assetTotal === $liabilityTotal + $equityTotal,
        'out_by' => store_kwd($assetTotal - ($liabilityTotal + $equityTotal)),
    ];
}

/** The journal, newest first, for the screen and for export. */
function acc_journal(PDO $db, ?string $from, ?string $to, int $limit = 100, int $offset = 0): array {
    $where = [];
    $args  = [];
    if ($from) { $where[] = 'e.entry_date >= ?'; $args[] = $from; }
    if ($to)   { $where[] = 'e.entry_date <= ?'; $args[] = $to; }
    $sql = 'select e.id, e.entry_date, e.memo, e.source, e.source_ref, e.kind,
                   e.created_by, e.created_at, e.reverses_id, e.reversed_by_id
              from journal_entries e'
         . ($where ? ' where ' . implode(' and ', $where) : '')
         . ' order by e.entry_date desc, e.id desc limit ' . (int) $limit . ' offset ' . (int) $offset;
    $q = $db->prepare($sql);
    $q->execute($args);
    $entries = $q->fetchAll(PDO::FETCH_ASSOC);
    if (!$entries) return [];

    // One query for all the lines rather than one per entry — a hundred
    // entries is a hundred round trips otherwise, on a shared host.
    $ids = array_column($entries, 'id');
    $in  = implode(',', array_fill(0, count($ids), '?'));
    $l = $db->prepare("select l.entry_id, a.code, a.name_en, a.name_ar, l.debit, l.credit, l.memo
                         from journal_lines l join accounts a on a.id = l.account_id
                        where l.entry_id in ($in) order by l.id");
    $l->execute($ids);
    $byEntry = [];
    foreach ($l as $row) $byEntry[$row['entry_id']][] = $row;

    foreach ($entries as &$e) $e['lines'] = $byEntry[$e['id']] ?? [];
    return $entries;
}

/**
 * Orders that are paid but have NOT posted — the reconciliation that says
 * whether the ledger is actually complete.
 *
 * Without this the books can be quietly missing a week of sales (posting was
 * off, a migration had not run, an exception was swallowed) and every report
 * would still balance perfectly, because a missing entry is missing from both
 * sides. Balanced and complete are different properties and only one of them
 * is self-evident.
 */
function acc_unposted_orders(PDO $db, int $limit = 200): array {
    $q = $db->prepare(
        "select o.id, o.track_id, o.amount, o.payment_method, o.paid_at
           from orders o
           left join journal_entries e
             on e.source = 'order' and e.kind = 'sale'
            and e.source_ref = cast(o.id as char) collate utf8mb4_unicode_ci
          where o.payment_status = 'paid' and e.id is null
          order by o.paid_at asc limit " . (int) $limit
    );
    $q->execute();
    return $q->fetchAll(PDO::FETCH_ASSOC);
}
