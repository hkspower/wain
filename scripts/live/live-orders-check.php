<?php
/**
 * Where the live shop's orders stand — READ-ONLY, and it prints no customer.
 *
 *   wget -nv -O r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-orders-check.php && php r.php
 *
 * Asked for on 2026-09-28 as "check order progress". Reports counts by
 * payment status, fulfilment status and payment method, today's and this
 * week's totals, and the ten newest orders by REFERENCE, status and amount.
 *
 * NO NAME, PHONE, EMAIL OR ADDRESS IS EVER SELECTED, not merely not printed:
 * this script is fetched over a public URL and its output sits in the
 * Hostinger panel. The track id is what the shop itself shows a customer on
 * the confirmation page, and it identifies an order to the owner in /backends.
 *
 * One line per section, echoed as measured, per the cron channel's rules.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('ORDERS config=unreadable'); exit; }
try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
    );
} catch (Throwable $e) { line('ORDERS db=unreachable'); exit; }

$group = static function (string $col) use ($pdo): string {
    $out = [];
    foreach ($pdo->query("select coalesce($col,'null') k, count(*) n from orders group by k order by n desc") as $r) {
        $out[] = $r['k'] . '=' . $r['n'];
    }
    return $out ? implode(' ', $out) : '-';
};

$total = (int) $pdo->query('select count(*) from orders')->fetchColumn();
line("ORDERS total=$total");
line('payment    ' . $group('payment_status'));
line('fulfilment ' . $group('fulfilment_status'));
line('method     ' . $group('payment_method'));

foreach (['today' => 'curdate()', 'last7days' => 'curdate() - interval 6 day'] as $label => $from) {
    $r = $pdo->query("select count(*) n, coalesce(sum(case when payment_status='paid' then amount end),0) paid
                      from orders where created_at >= $from")->fetch();
    line(sprintf('%-10s orders=%d paidKWD=%.3f', $label, $r['n'], $r['paid']));
}

// Stuck: paid but not fulfilled for more than two days — the one number that
// means a customer is waiting.
$stuck = (int) $pdo->query("select count(*) from orders where payment_status='paid'
    and coalesce(fulfilment_status,'') not in ('fulfilled','cancelled')
    and paid_at < now() - interval 2 day")->fetchColumn();
line("waiting    paidNotShippedOver2Days=$stuck");

line('newest');
foreach ($pdo->query('select track_id, created_at, amount, payment_method, payment_status, fulfilment_status
                      from orders order by id desc limit 10') as $r) {
    line(sprintf('  %s  %s  %s KWD  %s/%s  %s', $r['track_id'], $r['created_at'], $r['amount'],
        $r['payment_method'] ?? '-', $r['payment_status'] ?? '-', $r['fulfilment_status'] ?? '-'));
}
