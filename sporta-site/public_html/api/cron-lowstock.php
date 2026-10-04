<?php
// LOW-STOCK ALERT, once a day by email — 2026-10-04 ("improve inventory" → low-stock alerts to you).
//
// Wire it in hPanel -> Cron Jobs, daily, the loopback form every other job uses:
//   wget -nv -O- --no-check-certificate --header=Host:www.sporta.com.kw "https://127.0.0.1/api/cron-lowstock.php?key=<cron_key>"
//
// WHAT IT SENDS: every size of an ACTIVE product at or under the low-stock line (/backends -> Inventory
// -> Low-stock line, the `inventory` setting), sold-out first, to the alert address the owner typed in
// the same card (`inventory.alert_email`), else config.php's warehouse_email. No address = nothing sent
// and the state says so. ONCE A DAY: `inventory.alert_sent_on` records the date; a second run the same
// day reports and does not mail, so the job can be scheduled hourly without doubling. `&force=1` sends
// again (for a test). Nothing to report = no mail — a quiet morning is a stocked shop.
//
// It prints STATE, never a customer, and the same gate as every cron here.
declare(strict_types=1);
require __DIR__ . '/store.php';
$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals((string) $cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}
$db = store_db();
$set = store_setting($db, 'inventory');
$low = isset($set['low']) ? max(0, min(999, (int) $set['low'])) : 5;
$to = trim((string) ($set['alert_email'] ?? ''));
if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) $to = trim((string) ($cfg['warehouse_email'] ?? ''));
$today = gmdate('Y-m-d');
$sentOn = (string) ($set['alert_sent_on'] ?? '');
$force = ($_GET['force'] ?? '') === '1';

$q = $db->prepare('select v.sku, v.size, v.stock, p.name_en, p.slug from product_variants v join products p on p.slug = v.slug
                   where p.active = 1 and v.stock <= ? order by v.stock, p.name_en, v.size');
$q->execute([$low]);
$rows = $q->fetchAll();
$out = (int) count(array_filter($rows, fn ($r) => (int) $r['stock'] === 0));
$state = sprintf('STATE low=%d items=%d soldOut=%d to=%s sentOn=%s', $low, count($rows), $out, $to === '' ? 'none' : 'set', $sentOn === '' ? '-' : $sentOn);

if (!$rows) { store_out(['ok' => true, 'state' => $state, 'sent' => false, 'why' => 'nothing_low']); }
if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) { store_out(['ok' => true, 'state' => $state, 'sent' => false, 'why' => 'no_address']); }
if ($sentOn === $today && !$force) { store_out(['ok' => true, 'state' => $state, 'sent' => false, 'why' => 'already_today']); }
if (($cfg['mail_from'] ?? '') === '') { store_out(['ok' => true, 'state' => $state, 'sent' => false, 'why' => 'no_mail_from']); }

$lines = [];
foreach ($rows as $r) $lines[] = sprintf('%-6s %-4s %s — %s', (int) $r['stock'] === 0 ? 'OUT' : (string) $r['stock'], $r['size'], $r['name_en'], $r['sku']);
$subject = sprintf('Sporta stock: %d size%s at or under %d (%d sold out)', count($rows), count($rows) === 1 ? '' : 's', $low, $out);
$text = "Sizes at or under the low-stock line ($low), sold-out first:\n\n" . implode("\n", $lines) . "\n\nEdit stock: https://www.sporta.com.kw/backends (Inventory)\n";
$h = static fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$html = '<p>Sizes at or under the low-stock line (' . $low . '), sold-out first:</p><table style="border-collapse:collapse;font:14px system-ui">'
      . '<tr><th align="left">Stock</th><th align="left">Size</th><th align="left">Product</th><th align="left">Code</th></tr>';
foreach ($rows as $r) {
    $st = (int) $r['stock'];
    $html .= '<tr><td style="padding:3px 10px 3px 0;' . ($st === 0 ? 'color:#b3261e;font-weight:700' : 'color:#b26a00') . '">' . ($st === 0 ? 'SOLD OUT' : $st) . '</td><td style="padding:3px 10px 3px 0">' . $h($r['size']) . '</td><td style="padding:3px 10px 3px 0">' . $h($r['name_en']) . '</td><td style="padding:3px 0;font-family:monospace">' . $h($r['sku']) . '</td></tr>';
}
$html .= '</table><p><a href="https://www.sporta.com.kw/backends">Edit stock in /backends → Inventory</a></p>';
$ok = store_send_mail($cfg, $to, $subject, $text, $html);
if ($ok) { $set['alert_sent_on'] = $today; store_setting_save($db, 'inventory', $set); }
store_out(['ok' => true, 'state' => $state, 'sent' => $ok, 'why' => $ok ? null : 'mail_failed', 'items' => count($rows)]);
