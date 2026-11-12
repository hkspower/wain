<?php
// Daily birthday gift. Run from the host:
//   docker exec -u www-data apache-sporta-1 php /var/www/html/api/cron-birthday.php --send
//   ... --dry   reports who is due without creating codes or sending mail
// Over HTTP it needs ?key=<cron_key>&mode=send|dry (same gate as the other cron files).
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/cron-auth.php';
require __DIR__ . '/birthday-lib.php';
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$cfg = store_config();
if (!sporta_cron_authorized($cfg, PHP_SAPI, $_GET, $argv ?? [], ['--send', '--dry'])) {
    http_response_code(403); echo "forbidden\n"; exit;
}
$dry = PHP_SAPI === 'cli' ? (($argv[1] ?? '') === '--dry') : (($_GET['mode'] ?? 'dry') !== 'send');

$db = store_db();
$s = birthday_settings($db);
$today = new DateTimeImmutable('now', new DateTimeZone(BIRTHDAY_TZ));
if (!birthday_columns_ready($db)) { echo "STATE ready=0 why=migration_missing\n"; exit; }
// Gifts go to verified addresses only (birthday_due); without the column, none.
if (!customer_verify_ready($db)) { echo "STATE ready=0 why=verify_migration_missing\n"; exit; }
if (!$s['enabled']) { echo "STATE enabled=0\n"; exit; }

$mailCfg = $cfg;
$mailCfg['mail_from'] = (string)($cfg['customer_mail_from'] ?? $cfg['mail_reply_to'] ?? $cfg['mail_from'] ?? '');
$due = birthday_due($db, $today);
$sent = 0; $failed = 0;
$year = (int)$today->format('Y');
// ends_at is compared in UTC by store_window_open(); end of the last local day.
$ends = $today->modify('+' . ($s['days'] - 1) . ' days')->setTime(23, 59, 59)
    ->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
$endsLocal = $today->modify('+' . ($s['days'] - 1) . ' days')->format('Y-m-d');

foreach ($due as $row) {
    if ($dry) { echo "DUE id={$row['id']}\n"; continue; }
    $id = (int)$row['id'];
    $code = null; $prevYear = $row['birthday_sent_year'];
    $db->beginTransaction();
    try {
        // Lock the row and re-check, so two overlapping runs cannot both gift it.
        $q = $db->prepare('select birthday_sent_year from customer_accounts where id = ? for update');
        $q->execute([$id]);
        $cur = $q->fetchColumn();
        if ($cur !== null && (int)$cur >= $year) { $db->rollBack(); continue; }
        for ($i = 0; $i < 5 && $code === null; $i++) {
            $try = birthday_new_code();
            try {
                $db->prepare("insert into discounts (kind, code, label, type, value, usage_limit, active, ends_at)
                    values ('code', ?, ?, 'percent', ?, 1, 1, ?)")
                   ->execute([$try, 'Birthday gift / هدية عيد الميلاد', $s['percent'], $ends]);
                $code = $try;
            } catch (PDOException $e) { if ($i === 4) throw $e; }
        }
        $db->prepare('update customer_accounts set birthday_sent_year = ? where id = ?')->execute([$year, $id]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Sporta birthday gift failed: ' . get_class($e));
        $failed++; continue;
    }
    $name = trim((string)$row['name']);
    $safe = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $pct = $s['percent'];
    $subject = 'عيد ميلاد سعيد من سبورتا 🎉 Happy birthday from Sporta';
    $text = "عيد ميلاد سعيد" . ($name !== '' ? " يا {$name}" : '') . "!\n"
        . "هديتك: خصم {$pct}% على طلبك القادم بالكود {$code} — صالح حتى {$endsLocal}.\n\n"
        . "Happy birthday" . ($name !== '' ? ", {$name}" : '') . "!\n"
        . "Your gift: {$pct}% off your next order with code {$code} — valid until {$endsLocal}.\n"
        . "https://www.sporta.com.kw/shop\n";
    $html = '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#171a1e;max-width:520px">'
        . '<div dir="rtl" style="text-align:right"><h2 style="margin:0 0 8px">عيد ميلاد سعيد' . ($name !== '' ? ' يا ' . $safe($name) : '') . '!</h2>'
        . '<p>هديتك من سبورتا: خصم <b>' . $pct . '%</b> على طلبك القادم.</p></div>'
        . '<p style="font-size:26px;font-weight:700;letter-spacing:2px;background:#fff1e8;border:2px dashed #e0561c;border-radius:10px;padding:14px;text-align:center;margin:16px 0">' . $safe($code) . '</p>'
        . '<p dir="rtl" style="text-align:right">صالح حتى ' . $safe($endsLocal) . ' — مرة واحدة.</p>'
        . '<p>Happy birthday' . ($name !== '' ? ', ' . $safe($name) : '') . '! Your gift: <b>' . $pct . '% off</b> your next order. Valid until ' . $safe($endsLocal) . ', one use.</p>'
        . '<p><a href="https://www.sporta.com.kw/shop" style="display:inline-block;background:#e0561c;color:#171a1e;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">تسوق الآن · Shop now</a></p></div>';
    if (store_send_admin_mail($mailCfg, (string)$row['email'], $subject, $text, $html, 'Sporta')) {
        $sent++;
    } else {
        // An email that never arrived must not cost the customer this year's gift.
        $db->prepare("delete from discounts where kind = 'code' and code = ? and used_count = 0")->execute([$code]);
        $db->prepare('update customer_accounts set birthday_sent_year = ? where id = ?')->execute([$prevYear, $id]);
        $failed++;
    }
}
printf("STATE date=%s enabled=1 percent=%d days=%d due=%d sent=%d failed=%d dry=%d\n",
    $today->format('Y-m-d'), $s['percent'], $s['days'], count($due), $sent, $failed, $dry ? 1 : 0);
