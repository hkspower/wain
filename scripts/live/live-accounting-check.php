<?php
/**
 * The live ledger's state — READ-ONLY, prints counts and totals, never a customer or a credential.
 *
 *   wget -qO a.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-accounting-check.php && php a.php
 *
 * Answers: are the three tables there, is posting switched on, how many paid orders are not in the
 * books yet, and do the books balance (total debits = total credits, to the fils).
 */
$cfg = require '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
try {
    $db = new PDO('mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . ($cfg['db_name'] ?? '') . ';charset=utf8mb4',
        (string)($cfg['db_user'] ?? ''), (string)($cfg['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) { echo "ACC db=unreachable\n"; exit; }
$t = [];
foreach (['accounts', 'journal_entries', 'journal_lines'] as $n) $t[] = $n . '=' . ($db->query("show tables like '$n'")->fetchColumn() ? 'yes' : 'NO');
$set = json_decode((string)$db->query("select value from settings where name='accounting'")->fetchColumn(), true) ?: [];
$on = !empty($set['posting_enabled']) ? 'on' : 'off';
$paid = (int)$db->query("select count(*) from orders where payment_status='paid'")->fetchColumn();
$posted = 0; $entries = 0; $d = '0'; $c = '0'; $accts = 0;
try {
    $accts = (int)$db->query('select count(*) from accounts')->fetchColumn();
    $entries = (int)$db->query('select count(*) from journal_entries')->fetchColumn();
    $posted = (int)$db->query("select count(distinct source_ref) from journal_entries where source='order' and kind='sale'")->fetchColumn();
    [$d, $c] = $db->query('select coalesce(sum(debit),0), coalesce(sum(credit),0) from journal_lines')->fetch(PDO::FETCH_NUM);
} catch (Throwable $e) {}
echo 'ACC ' . implode(' ', $t) . " accounts=$accts posting=$on paidOrders=$paid postedOrders=$posted unposted=" . ($paid - $posted)
   . " entries=$entries debits=$d credits=$c balanced=" . ($d === $c ? 'yes' : 'NO') . "\n";
