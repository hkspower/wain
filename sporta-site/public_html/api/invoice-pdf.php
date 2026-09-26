<?php
/**
 * One order, as a PDF file on disk.
 *
 *   invoice_pdf_build($db, $cfg, 'SPXXXXXXXX')   -> bytes
 *   invoice_pdf_save($db, $cfg, 'SPXXXXXXXX')    -> path written
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS NOW, WHEN orders-print.php SAYS IT CANNOT
 *
 * That file gives two reasons for letting the browser make the PDF, and it was
 * right about both at the time. They are answered rather than ignored:
 *
 *   "A PDF has no Arabic." True, and still true — a PDF draws glyphs in the
 *   order given and has no concept of right-to-left or letter shaping. What
 *   changed is that arabic.php now does that work before the text arrives, and
 *   pdf.php embeds the shop's own font so the glyphs exist to draw. Checked by
 *   rendering, not by reasoning: every letter of every test string appears.
 *
 *   "A folder of PDFs is a folder of names, phone numbers and addresses in a
 *   web root where a guessed filename is all it takes." Also true, and the
 *   reason the folder is NOT in the web root. It sits beside public_html, not
 *   inside it, so no URL reaches it at all — there is no filename to guess.
 *   Nothing serves these files; an admin who wants one asks admin.php for it
 *   with a session, and that endpoint reads the file from outside the docroot.
 *   The live host's open_basedir is unset, so PHP can read there — checked
 *   against the server's own configuration.
 *
 * The phone number is left off the document for the same reason the JSON
 * invoice route leaves it off: the customer knows their own number, and an
 * archived file has a longer life than the moment it was made for.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DOCUMENT SAYS
 *
 * It is bilingual because the shop is: an Arabic label and an English one on
 * every row, so the same file works for the customer, for the driver, and for
 * an accountant who reads neither half fluently. The money is Latin digits in
 * both languages — see arabic.php on why.
 *
 * IT SHOWS EVERY LINE OF THE ARITHMETIC. Subtotal, discount, delivery and
 * total, exactly as ?r=invoice does and for the reason written there: an
 * order given 3.000 off, showing lines totalling 23.000 against a total of
 * 20.000, reads as a shop that cannot count.
 */
declare(strict_types=1);

require_once __DIR__ . '/arabic.php';
require_once __DIR__ . '/pdf.php';

/**
 * WHERE THE FILES LIVE, and the default is the important part.
 *
 * Beside public_html, never inside it. On the live host the docroot is
 * /home/uNNNNNNN/domains/sporta.com.kw/public_html, so the default lands at
 * .../sporta.com.kw/invoices — one level up, unreachable by any URL. It is
 * overridable in config for a host that puts the docroot somewhere else.
 *
 * The fallback is the system temp directory, matching what the assistant's
 * voice cache does. That is a worse place to keep an archive — it is cleared
 * — but it is never a place the web can read, which is the property that
 * must not be lost by accident.
 */
function invoice_dir(array $cfg): string
{
    $dir = trim((string) ($cfg['invoice_dir'] ?? ''));
    if ($dir === '') {
        $up = dirname(__DIR__, 2);              // .../public_html/api -> ...
        $dir = is_dir($up) && is_writable($up) ? $up . '/invoices'
                                              : sys_get_temp_dir() . '/sporta-invoices';
    }
    return rtrim($dir, '/');
}

/**
 * The file for one order.
 *
 * Named by track id, which is the only identifier a person has in their hand
 * when they go looking. It is validated to letters and digits before it
 * reaches a path — a track id arrives from the client at checkout, so treating
 * it as a filename without that check is how a request for
 * "../../public_html/index.php" gets written to.
 */
function invoice_path(array $cfg, string $track): ?string
{
    $t = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $track) ?? '');
    if ($t === '' || strlen($t) > 40) return null;
    return invoice_dir($cfg) . '/' . $t . '.pdf';
}

/** Bilingual money: always Latin digits, always three decimals, as the shop prices. */
function invoice_kwd(float $v): string
{
    return number_format($v, 3, '.', '');
}

/**
 * Draw one order and hand back the PDF bytes, or null if there is no such
 * order or no font to draw it with.
 */
function invoice_pdf_build(PDO $db, array $cfg, string $track): ?string
{
    $q = $db->prepare('select * from orders where track_id = ?');
    $q->execute([$track]);
    $o = $q->fetch();
    if (!$o) return null;

    $it = $db->prepare(
        'select coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                oi.qty, oi.size, oi.unit_price,
                (oi.unit_price * oi.qty) as line_total
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by 1, oi.size');
    $it->execute([$o['id']]);
    $items = $it->fetchAll();

    // THE FONT IS THE SHOP'S OWN, and it has to be findable from the server.
    // Config first so a host can move it; then the two places it actually
    // lives in this project.
    $fontPath = (string) ($cfg['invoice_font'] ?? '');
    foreach ([$fontPath, __DIR__ . '/fonts/Alexandria-400.ttf',
              dirname(__DIR__) . '/fonts/Alexandria-400.ttf'] as $cand) {
        if ($cand !== '' && is_readable($cand)) { $fontPath = $cand; break; }
        $fontPath = '';
    }
    if ($fontPath === '') return null;
    $font = pdf_font_load($fontPath);
    if (!$font) return null;

    $doc = pdf_new($font);
    $W = 595.28;
    $L = 56.0;                 // left margin
    $R = $W - 56.0;            // right margin
    $y = 786.0;

    $ink  = [0.08, 0.09, 0.10];
    $soft = [0.42, 0.45, 0.48];
    $rule = [0.85, 0.86, 0.88];

    $ar = fn (string $s) => ar_visual($s, true);

    // --- head ---------------------------------------------------------------
    pdf_text($doc, 'SPORTA', $L, $y, 20, 'left', $ink);
    pdf_text($doc, $ar('سبورتا'), $R, $y, 20, 'right', $ink);
    $y -= 16;
    pdf_text($doc, 'sporta.com.kw', $L, $y, 9, 'left', $soft);
    pdf_text($doc, $ar('فاتورة'), $R, $y, 11, 'right', $soft);
    $y -= 14;
    pdf_line($doc, $L, $y, $R, $y, 1, $rule);
    $y -= 24;

    // --- the order ----------------------------------------------------------
    $placed = substr((string) $o['created_at'], 0, 16);
    $paid = ((string) $o['payment_status'] === 'paid');
    $method = strtoupper((string) $o['payment_method']);

    pdf_text($doc, 'Order', $L, $y, 9, 'left', $soft);
    pdf_text($doc, (string) $o['track_id'], $L + 54, $y, 11, 'left', $ink);
    pdf_text($doc, $ar('رقم الطلب'), $R, $y, 9, 'right', $soft);
    $y -= 16;
    pdf_text($doc, 'Date', $L, $y, 9, 'left', $soft);
    pdf_text($doc, $placed, $L + 54, $y, 10, 'left', $ink);
    pdf_text($doc, $ar('التاريخ'), $R, $y, 9, 'right', $soft);
    $y -= 16;
    pdf_text($doc, 'Payment', $L, $y, 9, 'left', $soft);
    pdf_text($doc, $method . ($paid ? ' — paid' : ' — unpaid'), $L + 54, $y, 10, 'left', $ink);
    pdf_text($doc, $ar($paid ? 'مدفوع' : 'غير مدفوع'), $R, $y, 9, 'right', $soft);
    $y -= 26;

    // --- who it is for ------------------------------------------------------
    // The customer's own name and address are drawn right-aligned when they
    // are Arabic and left-aligned when they are not, decided per string rather
    // than per document: a Kuwaiti address routinely mixes both.
    $name = (string) $o['customer_name'];
    pdf_text($doc, 'Deliver to', $L, $y, 9, 'left', $soft);
    if (ar_has_arabic($name)) pdf_text($doc, $ar($name), $R, $y, 11, 'right', $ink);
    else                      pdf_text($doc, $name, $L + 54, $y, 11, 'left', $ink);
    $y -= 15;

    $addr = array_values(array_filter([
        (string) $o['customer_area'],
        $o['customer_block'] ? 'Block ' . $o['customer_block'] : '',
        $o['customer_street'] ? 'Street ' . $o['customer_street'] : '',
        $o['customer_building'] ? 'Building ' . $o['customer_building'] : '',
        $o['customer_floor'] ? 'Floor ' . $o['customer_floor'] : '',
        $o['customer_flat'] ? 'Flat ' . $o['customer_flat'] : '',
        ucfirst((string) $o['customer_governorate']),
    ], fn ($p) => trim((string) $p) !== ''));
    $line = implode(', ', $addr);
    if (ar_has_arabic($line)) pdf_text($doc, $ar($line), $R, $y, 9, 'right', $soft);
    else                      pdf_text($doc, $line, $L + 54, $y, 9, 'left', $soft);
    $y -= 26;

    // --- the goods ----------------------------------------------------------
    pdf_rect($doc, $L, $y - 6, $R - $L, 20, [0.96, 0.96, 0.97]);
    pdf_text($doc, 'Item', $L + 8, $y, 9, 'left', $soft);
    pdf_text($doc, 'Qty', $R - 168, $y, 9, 'left', $soft);
    pdf_text($doc, 'Price', $R - 92, $y, 9, 'right', $soft);
    pdf_text($doc, 'Total', $R - 8, $y, 9, 'right', $soft);
    $y -= 24;

    foreach ($items as $row) {
        // A NEW PAGE RATHER THAN TEXT OFF THE BOTTOM. An order of forty lines
        // is rare and is exactly the order somebody eventually queries.
        if ($y < 140) {
            pdf_page_break($doc);
            $y = 786.0;
        }
        $en = trim((string) $row['name_en']);
        $arName = trim((string) $row['name_ar']);
        $size = trim((string) $row['size']);

        pdf_text($doc, $en . ($size !== '' ? "  ($size)" : ''), $L + 8, $y, 10, 'left', $ink);
        pdf_text($doc, (string) (int) $row['qty'], $R - 168, $y, 10, 'left', $ink);
        pdf_text($doc, invoice_kwd((float) $row['unit_price']), $R - 92, $y, 10, 'right', $ink);
        pdf_text($doc, invoice_kwd((float) $row['line_total']), $R - 8, $y, 10, 'right', $ink);
        if ($arName !== '') {
            $y -= 12;
            pdf_text($doc, $ar($arName), $L + 8 + 150, $y, 8.5, 'right', $soft);
        }
        $y -= 18;
        pdf_line($doc, $L, $y + 6, $R, $y + 6, 0.4, $rule);
    }

    // --- the arithmetic, in full -------------------------------------------
    $y -= 12;
    $rows = [
        ['Subtotal', 'المجموع الفرعي', (float) $o['subtotal'], false],
    ];
    if ((float) $o['discount_amount'] > 0) {
        $label = trim((string) ($o['discount_label'] ?? '')) ?: 'Discount';
        $rows[] = [$label, 'الخصم', -(float) $o['discount_amount'], false];
    }
    $rows[] = ['Delivery', 'التوصيل', (float) $o['delivery_fee'], false];
    $rows[] = ['Total', 'الإجمالي', (float) $o['amount'], true];

    foreach ($rows as [$en, $arLab, $val, $bold]) {
        if ($bold) {
            $y -= 4;
            pdf_line($doc, $R - 240, $y + 14, $R, $y + 14, 0.8, $rule);
            $y -= 6;
        }
        $size = $bold ? 12.0 : 10.0;
        pdf_text($doc, $en, $R - 240, $y, $size, 'left', $bold ? $ink : $soft);
        pdf_text($doc, $ar($arLab), $R - 118, $y, $size - 1, 'right', $soft);
        pdf_text($doc, ($val < 0 ? '-' : '') . invoice_kwd(abs($val)) . ' KWD',
            $R - 8, $y, $size, 'right', $ink);
        $y -= 18;
    }

    // --- foot ---------------------------------------------------------------
    pdf_line($doc, $L, 96, $R, 96, 0.5, $rule);
    pdf_text($doc, 'Thank you for shopping with Sporta.', $L, 80, 9, 'left', $soft);
    pdf_text($doc, $ar('شكرًا لتسوقك من سبورتا'), $R, 80, 9, 'right', $soft);
    pdf_text($doc, 'Delivery across Kuwait within 24 hours.', $L, 68, 8, 'left', $soft);
    pdf_text($doc, $ar('التوصيل داخل الكويت خلال ٢٤ ساعة'), $R, 68, 8, 'right', $soft);

    return pdf_render($doc);
}

/**
 * Build it and put it on disk. Returns the path, or null if it could not.
 *
 * WRITTEN THROUGH A TEMPORARY FILE AND RENAMED. A reader that opens the file
 * while it is being written gets a truncated PDF, which is a file that exists
 * and does not open — the worst of both. rename() within one directory is
 * atomic, so the file is either absent or complete.
 */
function invoice_pdf_save(PDO $db, array $cfg, string $track): ?string
{
    $path = invoice_path($cfg, $track);
    if ($path === null) return null;

    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return null;

    $pdf = invoice_pdf_build($db, $cfg, $track);
    if ($pdf === null) return null;

    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.part';
    if (@file_put_contents($tmp, $pdf) !== strlen($pdf)) { @unlink($tmp); return null; }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) { @unlink($tmp); return null; }
    return $path;
}
