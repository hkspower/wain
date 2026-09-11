<?php
// Drains customer_mail_outbox: the shopper's own copy of what they ordered.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every 5 minutes:
//   wget -qO- "https://www.sporta.com.kw/api/cron-customer-mail.php?key=<cron_key>"
//
// ---------------------------------------------------------------------------
// WHAT THIS MAIL IS, AND WHAT IT IS CAREFUL NOT TO BE
//
// It goes out on INSERT, before the bank has said anything, so it is a RECEIPT
// and not a confirmation. It says: here is what you ordered, here is what it
// costs, here is your order number, and here is exactly where the payment
// stands. It never says "confirmed", never says "thank you for your payment",
// and never implies the order is on its way.
//
// That distinction is the whole reason whatsapp_outbox waits for settlement,
// and this queue is written so as not to break it: a shopper whose card was
// declined must not receive a message that reads like success, because they
// then stop watching for the failure and the sale is lost quietly. The three
// states get three different sentences and three different subjects.
//
// In the customer's OWN language — the one the checkout was rendered in, frozen
// on the row at order time, because by now the browser is long gone.

declare(strict_types=1);
require __DIR__ . '/store.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}

$db = store_db();

// ---- claim ----
// FOR UPDATE SKIP LOCKED, so two overlapping runs cannot send one shopper the
// same receipt twice. Five attempts, then the row sits visibly with its error
// rather than retrying at a mailbox that is never coming back.
$db->beginTransaction();
$rows = $db->query(
    'select id, order_id, kind, to_email, lang from customer_mail_outbox
      where sent_at is null and attempts < 5
      order by created_at limit 20
        for update skip locked'
)->fetchAll();
if ($rows) {
    $ids = implode(',', array_map(fn($r) => (int) $r['id'], $rows));
    $db->exec("update customer_mail_outbox set attempts = attempts + 1 where id in ($ids)");
}
$db->commit();

$sent = 0; $failed = [];
foreach ($rows as $row) {
    $order = sporta_receipt_data($db, (int) $row['order_id']);
    if ($order === null) {
        // The order is gone. Nothing to send and nothing to fix, so close the
        // row instead of leaving it to burn its remaining attempts.
        $db->prepare('update customer_mail_outbox set sent_at = ?, last_error = ? where id = ?')
           ->execute([date('Y-m-d H:i:s'), 'order no longer exists', (int) $row['id']]);
        continue;
    }
    [$subject, $text, $html] = sporta_render_receipt($cfg, $order, (string) $row['lang']);
    $ok = store_send_mail($cfg, (string) $row['to_email'], $subject, $text, $html);
    $db->prepare('update customer_mail_outbox set sent_at = ?, last_error = ? where id = ?')
       ->execute([
           $ok ? date('Y-m-d H:i:s') : null,
           $ok ? null : 'mail() returned false — check the host’s mail service and SPF/DKIM',
           (int) $row['id'],
       ]);
    $ok ? $sent++ : $failed[] = (int) $row['id'];
}

store_out(['claimed' => count($rows), 'sent' => $sent, 'failed' => $failed]);

// ---------------------------------------------------------------------------

function sporta_receipt_data(PDO $db, int $orderId): ?array
{
    $q = $db->prepare(
        'select track_id, created_at, amount, subtotal, discount_amount, delivery_fee,
                discount_label, payment_method, payment_status,
                customer_name, customer_governorate, customer_area, customer_block,
                customer_street, customer_building, customer_floor, customer_flat
           from orders where id = ?'
    );
    $q->execute([$orderId]);
    $o = $q->fetch();
    if (!$o) return null;

    $it = $db->prepare(
        'select coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                oi.qty, oi.size, oi.fit, oi.unit_price
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by oi.id'
    );
    $it->execute([$orderId]);
    $o['items'] = $it->fetchAll();
    return $o;
}

/** Three decimals, always. Kuwait prices in fils and 12.5 is not a price. */
function sporta_kwd(float $n, string $lang): string
{
    $n = number_format($n, 3, '.', '');
    return $lang === 'ar' ? $n . ' د.ك' : 'KWD ' . $n;
}

function sporta_render_receipt(array $cfg, array $o, string $lang): array
{
    $ar = $lang === 'ar';
    $track = (string) $o['track_id'];
    $paid  = ($o['payment_status'] ?? '') === 'paid';
    $cod   = ($o['payment_method'] ?? '') === 'cod';

    // THE THREE STATES, each with its own sentence. A single "thank you for
    // your order" for all three is what makes a receipt untrustworthy — the
    // customer cannot tell from it whether they still owe money.
    if ($paid) {
        $subject = $ar ? "سبورتا · استلمنا طلبك {$track} — تم الدفع"
                       : "Sporta · we have your order {$track} — paid";
        $state   = $ar ? 'تم استلام الدفع. سنجهّز طلبك للشحن.'
                       : 'Payment received. We are preparing your order for shipping.';
    } elseif ($cod) {
        $subject = $ar ? "سبورتا · استلمنا طلبك {$track} — الدفع عند الاستلام"
                       : "Sporta · we have your order {$track} — cash on delivery";
        $state   = $ar ? 'ستدفع المبلغ للمندوب عند التسليم. جهّز المبلغ نقداً من فضلك.'
                       : 'You will pay the courier on delivery. Please have the amount ready in cash.';
    } else {
        $subject = $ar ? "سبورتا · استلمنا طلبك {$track} — بانتظار الدفع"
                       : "Sporta · we have your order {$track} — awaiting payment";
        // Said plainly, because the alternative is a shopper who believes they
        // are done and finds out a week later that they are not.
        $state   = $ar ? 'لم يكتمل الدفع بعد، ولن نبدأ الشحن قبل اكتماله. إذا انقطعت عملية الدفع، يمكنك إعادة المحاولة من صفحة تتبع الطلب.'
                       : 'Payment has not completed yet, and nothing ships before it does. If the payment was interrupted, you can try again from the order tracking page.';
    }

    $site  = 'https://www.sporta.com.kw';
    $track_url = $site . '/track?order=' . rawurlencode($track) . ($ar ? '' : '&lang=en');
    $hello = $ar ? 'مرحباً ' . $o['customer_name'] : 'Hello ' . $o['customer_name'];
    $intro = $ar ? 'شكراً لطلبك من سبورتا. هذه نسختك من الطلب.'
                 : 'Thank you for shopping with Sporta. Here is your copy of the order.';

    $L = $ar
        ? ['order' => 'رقم الطلب', 'date' => 'التاريخ', 'items' => 'الطلب', 'qty' => 'الكمية',
           'size' => 'المقاس', 'sub' => 'المجموع', 'disc' => 'الخصم', 'ship' => 'التوصيل',
           'total' => 'الإجمالي', 'addr' => 'عنوان التوصيل', 'trackBtn' => 'تتبّع الطلب',
           'help' => 'لأي استفسار، ردّ على هذه الرسالة أو راسلنا على']
        : ['order' => 'Order', 'date' => 'Placed', 'items' => 'Your order', 'qty' => 'Qty',
           'size' => 'Size', 'sub' => 'Subtotal', 'disc' => 'Discount', 'ship' => 'Delivery',
           'total' => 'Total', 'addr' => 'Delivery address', 'trackBtn' => 'Track your order',
           'help' => 'Any question — reply to this email or write to us at'];

    // ---- the address, in one line, skipping what was not given ----
    $addr = implode('، ', array_filter([
        $o['customer_area'], $o['customer_governorate'],
        ($ar ? 'قطعة ' : 'Block ')  . $o['customer_block'],
        ($ar ? 'شارع ' : 'Street ') . $o['customer_street'],
        ($ar ? 'مبنى ' : 'Building ') . $o['customer_building'],
        $o['customer_floor'] ? ($ar ? 'الدور ' : 'Floor ') . $o['customer_floor'] : '',
        $o['customer_flat']  ? ($ar ? 'شقة ' : 'Flat ')   . $o['customer_flat']  : '',
    ], fn($p) => trim((string) $p) !== ''));

    // ---- lines ----
    $textItems = ''; $htmlItems = '';
    foreach ($o['items'] as $i) {
        $name = $ar ? ($i['name_ar'] ?: $i['name_en']) : ($i['name_en'] ?: $i['name_ar']);
        $bits = array_filter([$i['size'], $i['fit']], fn($v) => trim((string) $v) !== '');
        $meta = $bits ? ' (' . implode(' · ', $bits) . ')' : '';
        $line = sporta_kwd((float) $i['unit_price'] * (int) $i['qty'], $lang);
        $textItems .= sprintf("  %d × %s%s — %s\n", (int) $i['qty'], $name, $meta, $line);
        $htmlItems .= '<tr>'
            . '<td style="padding:8px 10px;border-bottom:1px solid #eee">'
            . htmlspecialchars($name) . '<span style="color:#777">' . htmlspecialchars($meta) . '</span></td>'
            . '<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center">' . (int) $i['qty'] . '</td>'
            . '<td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">' . htmlspecialchars($line) . '</td>'
            . '</tr>';
    }

    $sub   = sporta_kwd((float) $o['subtotal'], $lang);
    $disc  = (float) $o['discount_amount'];
    $ship  = sporta_kwd((float) $o['delivery_fee'], $lang);
    $total = sporta_kwd((float) $o['amount'], $lang);

    // ---- plain text, which is the part that always arrives ----
    $text = "{$hello}\n\n{$intro}\n{$state}\n\n"
          . "{$L['order']}: {$track}\n{$L['date']}: " . substr((string) $o['created_at'], 0, 16) . "\n\n"
          . "{$L['items']}:\n{$textItems}\n"
          . "{$L['sub']}: {$sub}\n"
          . ($disc > 0 ? "{$L['disc']}: -" . sporta_kwd($disc, $lang) . "\n" : '')
          . "{$L['ship']}: {$ship}\n{$L['total']}: {$total}\n\n"
          . "{$L['addr']}: {$addr}\n\n{$L['trackBtn']}: {$track_url}\n\n"
          . "{$L['help']} " . $cfg['mail_reply_to'] . "\n";

    // ---- HTML ----
    // dir on the wrapper, not on <html>: a mail client strips the outer
    // document and keeps this div, so an Arabic receipt laid out left-to-right
    // is what happens if the attribute is put in the usual place.
    $dir = $ar ? 'rtl' : 'ltr';
    $align = $ar ? 'right' : 'left';
    $esc = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $html = '<div dir="' . $dir . '" style="font-family:-apple-system,Segoe UI,Tahoma,Arial,sans-serif;'
          . 'max-width:600px;margin:0 auto;color:#171A1E;text-align:' . $align . '">'
          // Dark silver, the shop's own surface colour, and the wordmark as
          // TEXT: a remote image is blocked by default in most mail clients, so
          // a logo file would leave a grey box where the brand should be.
          . '<div style="background:#2B3138;padding:18px 20px">'
          . '<span style="color:#FF7B17;font-size:22px;font-weight:800;letter-spacing:.5px">SPORTA</span>'
          . '<span style="color:#fff;font-size:22px;font-weight:800"> · سبورتا</span></div>'
          . '<div style="padding:20px">'
          . '<p style="margin:0 0 6px;font-size:16px;font-weight:700">' . $esc($hello) . '</p>'
          . '<p style="margin:0 0 4px;color:#444">' . $esc($intro) . '</p>'
          . '<p style="margin:0 0 16px;padding:10px 12px;background:#F6F3ED;border-inline-start:4px solid #E0561C;'
          . 'border-radius:6px">' . $esc($state) . '</p>'
          . '<p style="margin:0 0 14px;color:#444">' . $esc($L['order']) . ': <b>' . $esc($track) . '</b>'
          . '<br>' . $esc($L['date']) . ': ' . $esc(substr((string) $o['created_at'], 0, 16)) . '</p>'
          . '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">'
          . '<tr style="background:#f1f5f9"><th style="padding:8px 10px;text-align:' . $align . '">' . $esc($L['items']) . '</th>'
          . '<th style="padding:8px 10px">' . $esc($L['qty']) . '</th>'
          . '<th style="padding:8px 10px;text-align:' . $align . '">' . $esc($L['total']) . '</th></tr>'
          . $htmlItems . '</table>'
          . '<table cellpadding="0" cellspacing="0" style="width:100%;margin-top:12px;font-size:14px">'
          . '<tr><td style="padding:3px 10px">' . $esc($L['sub']) . '</td><td style="padding:3px 10px;text-align:' . ($ar ? 'left' : 'right') . '">' . $esc($sub) . '</td></tr>'
          . ($disc > 0
             ? '<tr><td style="padding:3px 10px;color:#1a7f4b">' . $esc($L['disc'])
               . ($o['discount_label'] ? ' <span style="color:#777">(' . $esc($o['discount_label']) . ')</span>' : '')
               . '</td><td style="padding:3px 10px;color:#1a7f4b;text-align:' . ($ar ? 'left' : 'right') . '">-' . $esc(sporta_kwd($disc, $lang)) . '</td></tr>'
             : '')
          . '<tr><td style="padding:3px 10px">' . $esc($L['ship']) . '</td><td style="padding:3px 10px;text-align:' . ($ar ? 'left' : 'right') . '">' . $esc($ship) . '</td></tr>'
          . '<tr><td style="padding:8px 10px;font-weight:800;font-size:16px;border-top:1px solid #ddd">' . $esc($L['total'])
          . '</td><td style="padding:8px 10px;font-weight:800;font-size:16px;border-top:1px solid #ddd;text-align:' . ($ar ? 'left' : 'right') . '">' . $esc($total) . '</td></tr>'
          . '</table>'
          . '<p style="margin:16px 0 6px;font-weight:700">' . $esc($L['addr']) . '</p>'
          . '<p style="margin:0 0 18px;color:#444">' . $esc($addr) . '</p>'
          . '<p style="margin:0 0 18px"><a href="' . $esc($track_url) . '" '
          . 'style="display:inline-block;background:#E0561C;color:#171A1E;font-weight:800;'
          . 'text-decoration:none;padding:11px 20px;border-radius:8px">' . $esc($L['trackBtn']) . '</a></p>'
          . '<p style="margin:0;color:#777;font-size:12px">' . $esc($L['help']) . ' '
          . '<a href="mailto:' . $esc($cfg['mail_reply_to']) . '" style="color:#B8430F">' . $esc($cfg['mail_reply_to']) . '</a></p>'
          . '</div></div>';

    return [$subject, $text, $html];
}
