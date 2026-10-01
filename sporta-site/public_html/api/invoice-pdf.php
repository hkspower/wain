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

    // THE BOLD FACE IS OPTIONAL. Alexandria 700 sits beside the regular file; a host that has
    // only the regular one still gets a correct invoice, with the headings in regular weight.
    $bold = null;
    foreach ([(string) ($cfg['invoice_font_bold'] ?? ''), dirname($fontPath) . '/Alexandria-700.ttf'] as $cand) {
        if ($cand !== '' && is_readable($cand)) { $bold = pdf_font_load($cand); if ($bold) break; }
    }

    $doc = pdf_new($font, 595.28, 841.89, $bold);
    $W = 595.28;
    $H = 841.89;
    $L = 60.0;                 // left margin
    $R = $W - 60.0;            // right margin

    // THE PALETTE IS THE SHOP'S: near-black ink, the orange of the buttons (the darker #cf4a0b,
    // because white on the brighter #f56315 is 3.1:1 — under AA at invoice sizes), and greys.
    $ink    = [0.078, 0.086, 0.102];
    $soft   = [0.40, 0.43, 0.47];
    $rule   = [0.89, 0.90, 0.92];
    $band   = [0.075, 0.082, 0.094];
    $orange = [0.812, 0.290, 0.043];
    $hot    = [0.961, 0.388, 0.082];
    $card   = [0.957, 0.961, 0.969];
    $zebra  = [0.975, 0.977, 0.982];
    $white  = [1, 1, 1];
    $green  = [0.086, 0.545, 0.286];
    $amber  = [0.980, 0.749, 0.141];

    // THE LOGO is the shop's own, flattened onto the masthead colour (api/invoice-logo.png) so it
    // embeds as a plain RGB picture. Missing or unreadable, the masthead falls back to the
    // lettered wordmark — an invoice without a logo is better than no invoice.
    $logo = pdf_png_load(__DIR__ . '/invoice-logo.png');

    $ar = fn (string $s) => ar_visual($s, true);
    $T  = function (string $t, float $x, float $y, float $sz, string $al = 'left', ?array $c = null,
                    bool $b = false, float $tr = 0.0) use (&$doc, $ink) {
        pdf_text($doc, $t, $x, $y, $sz, $al, $c ?? $ink, $b, $tr);
    };

    // --- masthead -----------------------------------------------------------
    $drawHead = function () use (&$doc, $W, $H, $L, $R, $band, $hot, $white, $T, $ar, $logo) {
        pdf_rect($doc, 0, $H - 128, $W, 128, $band);
        pdf_rect($doc, 0, $H - 132, $W, 4, $hot);
        if ($logo) {
            $lw = 158.0;
            $lh = $lw * $logo['h'] / $logo['w'];
            pdf_image($doc, $logo, $L, $H - 64 - $lh / 2, $lw, $lh);
        } else {
            $T('SPORTA', $L, $H - 70, 26, 'left', $white, true, 5.0);
            $T('SPORTS WEAR', $L, $H - 90, 9, 'left', [0.72, 0.75, 0.79], false, 3.0);
        }
        $T($ar('سبورتا'), $R, $H - 62, 26, 'right', $white, true);
        $T('sporta.com.kw', $R, $H - 86, 9.5, 'right', [0.72, 0.75, 0.79]);
    };
    $drawHead();
    $y = $H - 184;

    // --- title and status ---------------------------------------------------
    $placed = substr((string) $o['created_at'], 0, 16);
    $paid = ((string) $o['payment_status'] === 'paid');
    $method = strtoupper((string) $o['payment_method']);

    $T('INVOICE', $L, $y, 30, 'left', $ink, true, 1.0);
    $T($ar('فاتورة'), $R, $y, 30, 'right', $ink, true);
    $y -= 28;
    $pill = $paid ? 'PAID' : 'UNPAID';
    $pw = pdf_text_width($font, $pill, 9) + 24;
    pdf_rrect($doc, $L, $y - 5, $pw, 18, 9, $paid ? $green : $amber);
    $T($pill, $L + $pw / 2, $y, 9, 'center', $paid ? $white : $ink, true, 1.0);
    $T($ar($paid ? 'مدفوع' : 'غير مدفوع'), $R, $y, 11, 'right', $soft);
    $y -= 74;

    // --- the order, in a card -----------------------------------------------
    $cw = ($R - $L) / 3;
    pdf_rrect($doc, $L, $y - 28, $R - $L, 68, 12, $card);
    $cells = [
        ['ORDER', 'رقم الطلب', (string) $o['track_id']],
        ['DATE', 'التاريخ', $placed],
        ['PAYMENT', 'الدفع', $method],
    ];
    foreach ($cells as $i => [$en, $arLab, $val]) {
        $x = $L + 22 + $i * $cw;
        $T($en, $x, $y + 20, 8, 'left', $soft, true, 1.2);
        $T($ar($arLab), $x + $cw - 40, $y + 20, 8, 'right', $soft);
        $T($val, $x, $y - 8, 12, 'left', $ink, true);
    }
    $y -= 84;

    // --- who it is for ------------------------------------------------------
    // Drawn right-aligned when Arabic and left-aligned when not, decided per string rather than
    // per document: a Kuwaiti address routinely mixes both.
    $name = (string) $o['customer_name'];
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

    $T('DELIVER TO', $L, $y, 8, 'left', $soft, true, 1.2);
    $T($ar('التوصيل إلى'), $R, $y, 8, 'right', $soft);
    $y -= 24;
    if (ar_has_arabic($name)) $T($ar($name), $R, $y, 13, 'right', $ink, true);
    else                      $T($name, $L, $y, 13, 'left', $ink, true);
    $y -= 20;
    if (ar_has_arabic($line)) $T($ar($line), $R, $y, 9.5, 'right', $soft);
    else                      $T($line, $L, $y, 9.5, 'left', $soft);
    $y -= 46;

    // --- the goods ----------------------------------------------------------
    $cQty = $R - 190; $cPrice = $R - 104; $cTotal = $R - 18;
    $tableHead = function () use (&$doc, &$y, $L, $R, $band, $white, $T, $ar, $cQty, $cPrice, $cTotal) {
        pdf_rrect($doc, $L, $y - 11, $R - $L, 32, 8, $band);
        $T('ITEM', $L + 18, $y, 8, 'left', $white, true, 1.2);
        $T($ar('الصنف'), $L + 104, $y, 8, 'left', [0.72, 0.75, 0.79]);
        $T('QTY', $cQty, $y, 8, 'center', $white, true, 1.2);
        $T('PRICE', $cPrice, $y, 8, 'right', $white, true, 1.2);
        $T('TOTAL', $cTotal, $y, 8, 'right', $white, true, 1.2);
        $y -= 42;
    };
    $tableHead();

    $n = 0;
    foreach ($items as $row) {
        // A NEW PAGE RATHER THAN TEXT OFF THE BOTTOM, with the masthead and the column headings
        // drawn again. An order of forty lines is rare and is exactly the order somebody queries.
        if ($y < 140) {
            pdf_page_break($doc);
            $drawHead();
            $y = $H - 176;
            $tableHead();
        }
        $en = trim((string) $row['name_en']);
        $arName = trim((string) $row['name_ar']);
        $size = trim((string) $row['size']);
        $h = 48.0;
        if ($n % 2 === 0) pdf_rect($doc, $L, $y - 21, $R - $L, $h, $zebra);

        $T($en, $L + 18, $y + 2, 10.5, 'left', $ink, true);
        $T((string) (int) $row['qty'], $cQty, $y + 2, 10.5, 'center', $ink, true);
        $T(invoice_kwd((float) $row['unit_price']), $cPrice, $y + 2, 10.5, 'right', $ink);
        $T(invoice_kwd((float) $row['line_total']), $cTotal, $y + 2, 10.5, 'right', $ink, true);
        $sub = $size !== '' ? 'Size ' . $size : '';
        if ($sub !== '') $T($sub, $L + 18, $y - 14, 8.5, 'left', $soft);
        if ($arName !== '') $T($ar($arName), $cQty - 40, $y - 14, 8.5, 'right', $soft);
        $y -= $h;
        $n++;
    }
    pdf_line($doc, $L, $y + 27, $R, $y + 27, 0.6, $rule);

    // The totals and the footer need about 270pt under the last row; if they will not fit, they
    // go on a fresh page (with the masthead) rather than running into the footer rule.
    if ($y < 270) {
        pdf_page_break($doc);
        $drawHead();
        $y = $H - 176;
    }

    // --- the arithmetic, in full -------------------------------------------
    // Subtotal, discount, delivery and total, exactly as ?r=invoice does: an order given 3.000
    // off, showing lines totalling 23.000 against a total of 20.000, reads as a shop that
    // cannot count.
    $y -= 22;
    $bx = $R - 262;
    $rows = [['Subtotal', 'المجموع الفرعي', (float) $o['subtotal']]];
    if ((float) $o['discount_amount'] > 0) {
        $label = trim((string) ($o['discount_label'] ?? '')) ?: 'Discount';
        $rows[] = [$label, 'الخصم', -(float) $o['discount_amount']];
    }
    $rows[] = ['Delivery', 'التوصيل', (float) $o['delivery_fee']];
    foreach ($rows as [$en, $arLab, $val]) {
        $T($en, $bx, $y, 10, 'left', $soft);
        $T($ar($arLab), $bx + 142, $y, 9, 'right', $soft);
        $T(($val < 0 ? '-' : '') . invoice_kwd(abs($val)) . ' KWD', $R - 6, $y, 10, 'right', $ink);
        $y -= 26;
    }
    $y -= 12;
    pdf_rrect($doc, $bx - 16, $y - 15, 278, 44, 10, $orange);
    $T('TOTAL', $bx, $y, 11, 'left', $white, true, 1.5);
    $T($ar('الإجمالي'), $bx + 142, $y, 10, 'right', $white);
    $T(invoice_kwd((float) $o['amount']) . ' KWD', $R - 6, $y, 14, 'right', $white, true);

    // --- foot ---------------------------------------------------------------
    pdf_rect($doc, $L, 124, $R - $L, 1.2, $hot);
    $T('Thank you for shopping with Sporta.', $L, 98, 10.5, 'left', $ink, true);
    $T($ar('شكرًا لتسوقك من سبورتا'), $R, 98, 10.5, 'right', $ink, true);
    $T('Delivery across Kuwait within 24 hours.', $L, 78, 8.5, 'left', $soft);
    $T($ar('التوصيل داخل الكويت خلال ٢٤ ساعة'), $R, 78, 8.5, 'right', $soft);
    $T('sporta.com.kw', $L, 56, 8.5, 'left', $soft);

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
