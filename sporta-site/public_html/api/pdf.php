<?php
/**
 * A PDF writer, written out rather than pulled in.
 *
 * WHY THERE IS NO LIBRARY HERE. The same reason webpush.php has none: this
 * shop runs on Hostinger shared hosting with no shell and no Composer, and
 * every function that could shell out to one — exec, shell_exec, proc_open,
 * popen, passthru, system — is in the host's disable_functions list. Checked
 * against the live server's PHP configuration rather than assumed. There is no
 * pdf extension either. Whatever writes a PDF here has to be PHP that ships
 * with the site.
 *
 * WHAT IT DOES, precisely, because "write a PDF" covers a lot of ground it
 * deliberately does not cover. This produces a single-page-at-a-time document
 * with embedded TrueType text, horizontal rules and filled boxes. It has no
 * images, no transparency, no forms, no encryption and no compression of the
 * page stream. An invoice needs none of them, and each one is a place to be
 * subtly wrong.
 *
 * THE PART THAT MATTERS IS THE FONT, and it is why the obvious approach fails.
 * PDF's built-in fonts are Latin-only: there is no way to write "سبورتا" with
 * Helvetica, and no encoding trick that gets you there. The text has to be
 * drawn as GLYPHS from a font embedded in the file, addressed by glyph id
 * rather than by character. So:
 *
 *   The font is embedded WHOLE as a CIDFontType2 with Identity-H encoding, and
 *   text is written as a hex string of two-byte glyph ids. Identity-H means
 *   "the code IS the glyph id", which removes the entire encoding layer —
 *   there is no cmap to get wrong at the PDF end, only the font's own cmap
 *   used once, here, to turn characters into glyph ids.
 *
 *   NOT SUBSET. Rebuilding glyf, loca, hmtx and cmap for a subset is where a
 *   hand-rolled font writer usually breaks, and the whole file is 62 KB — an
 *   invoice comes out around 70 KB, which for an archival document nobody
 *   emails in bulk is not worth the risk of a malformed table.
 *
 * ARABIC IS NOT THIS FILE'S PROBLEM. It receives text already shaped and
 * already in visual order — see arabic.php, which exists for exactly that.
 * This file draws what it is given, left to right, and does not know or care
 * which way the language runs.
 */
declare(strict_types=1);

/**
 * Read out of a TrueType file the four things a PDF needs to embed it.
 *
 * Returns the raw bytes, the units-per-em the widths are measured in, a
 * character-to-glyph map and a glyph-to-advance map. Everything else in the
 * file is passed through untouched.
 */
function pdf_font_load(string $path): ?array
{
    $f = @file_get_contents($path);
    if ($f === false || strlen($f) < 12) return null;

    $numTables = unpack('n', substr($f, 4, 2))[1];
    $tables = [];
    for ($i = 0; $i < $numTables; $i++) {
        $o = 12 + 16 * $i;
        if ($o + 16 > strlen($f)) return null;
        $tag = substr($f, $o, 4);
        $d = unpack('Noff/Nlen', substr($f, $o + 8, 8));
        $tables[$tag] = [$d['off'], $d['len']];
    }
    foreach (['head', 'hhea', 'hmtx', 'maxp', 'cmap'] as $need) {
        if (!isset($tables[$need])) return null;
    }

    [$headOff] = $tables['head'];
    $unitsPerEm = unpack('n', substr($f, $headOff + 18, 2))[1];
    if ($unitsPerEm === 0) return null;

    [$hheaOff] = $tables['hhea'];
    $numHMetrics = unpack('n', substr($f, $hheaOff + 34, 2))[1];
    [$maxpOff] = $tables['maxp'];
    $numGlyphs = unpack('n', substr($f, $maxpOff + 4, 2))[1];

    // hmtx: numHMetrics advance/bearing pairs, then bearings only — every
    // glyph after the last pair keeps that pair's advance, which is how
    // monospaced tails are stored.
    [$hmtxOff] = $tables['hmtx'];
    $widths = [];
    $lastAdvance = 0;
    for ($g = 0; $g < $numGlyphs; $g++) {
        if ($g < $numHMetrics) {
            $p = $hmtxOff + 4 * $g;
            if ($p + 2 > strlen($f)) break;
            $lastAdvance = unpack('n', substr($f, $p, 2))[1];
        }
        $widths[$g] = $lastAdvance;
    }

    $cmap = pdf_font_cmap($f, $tables['cmap'][0]);
    if (!$cmap) return null;

    return [
        'data'  => $f,
        'upem'  => $unitsPerEm,
        'cmap'  => $cmap,
        'width' => $widths,
        'n'     => $numGlyphs,
    ];
}

/**
 * The character-to-glyph map, from whichever subtable is usable.
 *
 * Format 4 is the one every desktop font has and the one this reads. Format 12
 * is preferred when present because it reaches past U+FFFF — not needed for
 * Arabic or Latin, but a font that has only format 12 would otherwise look
 * like a font with no cmap at all.
 */
function pdf_font_cmap(string $f, int $off): array
{
    $n = unpack('n', substr($f, $off + 2, 2))[1];
    $best4 = null; $best12 = null;
    for ($i = 0; $i < $n; $i++) {
        $rec = unpack('nplat/nenc/Noff', substr($f, $off + 4 + 8 * $i, 8));
        $sub = $off + $rec['off'];
        $fmt = unpack('n', substr($f, $sub, 2))[1];
        if ($fmt === 4 && $best4 === null) $best4 = $sub;
        if ($fmt === 12) $best12 = $sub;
    }

    $map = [];
    if ($best12 !== null) {
        $groups = unpack('N', substr($f, $best12 + 12, 4))[1];
        for ($i = 0; $i < $groups; $i++) {
            $p = $best12 + 16 + 12 * $i;
            $g = unpack('Nstart/Nend/Ngid', substr($f, $p, 12));
            for ($c = $g['start']; $c <= $g['end'] && $c - $g['start'] < 0x10000; $c++) {
                $map[$c] = $g['gid'] + ($c - $g['start']);
            }
        }
        return $map;
    }
    if ($best4 === null) return [];

    $segX2 = unpack('n', substr($f, $best4 + 6, 2))[1];
    $seg = intdiv($segX2, 2);
    $endBase   = $best4 + 14;
    $startBase = $endBase + $segX2 + 2;
    $deltaBase = $startBase + $segX2;
    $rangeBase = $deltaBase + $segX2;

    for ($i = 0; $i < $seg; $i++) {
        $end   = unpack('n', substr($f, $endBase + 2 * $i, 2))[1];
        $start = unpack('n', substr($f, $startBase + 2 * $i, 2))[1];
        $delta = unpack('n', substr($f, $deltaBase + 2 * $i, 2))[1];
        $range = unpack('n', substr($f, $rangeBase + 2 * $i, 2))[1];
        if ($start > $end) continue;
        for ($c = $start; $c <= $end; $c++) {
            if ($c === 0xFFFF) continue;
            if ($range === 0) {
                $g = ($c + $delta) & 0xFFFF;
            } else {
                // The idRangeOffset trick: the offset is measured in bytes
                // from the position of the offset entry itself.
                $p = $rangeBase + 2 * $i + $range + 2 * ($c - $start);
                if ($p + 2 > strlen($f)) continue;
                $g = unpack('n', substr($f, $p, 2))[1];
                if ($g !== 0) $g = ($g + $delta) & 0xFFFF;
            }
            if ($g !== 0) $map[$c] = $g;
        }
    }
    return $map;
}

/**
 * A presentation form back to the plain letter it is a shape of.
 *
 * Built from arabic.php's own table, so the two cannot disagree about which
 * form belongs to which letter — a second hand-written table here would be a
 * copy that drifts.
 */
function pdf_form_to_base(int $form): ?int
{
    static $map = null;
    if ($map === null) {
        $map = [];
        if (defined('AR_FORMS')) {
            foreach (AR_FORMS as $base => $forms) {
                foreach ($forms as $f) $map[$f] = $base;
            }
        }
        // The lam-alef ligatures have no single base letter. For the DRAWING
        // fallback the lam alone is the closest honest answer — losing the
        // alef beats losing both. Extraction does better than that: see
        // pdf_form_to_unicode, which gives back both letters.
        if (defined('AR_LAM_ALEF')) {
            foreach (AR_LAM_ALEF as $forms) foreach ($forms as $f) $map[$f] = 0x0644;
        }
    }
    return $map[$form] ?? null;
}

/**
 * What a glyph MEANS, as one or more characters, for text extraction.
 *
 * ONE GLYPH IS NOT ALWAYS ONE LETTER, and Arabic is where that stops being a
 * technicality. "لا" is a single ligature glyph standing for lam AND alef, and
 * mapping it to the lam alone — which is all the drawing fallback can do —
 * turns "خلال" into "خلل" and "الإجمالي" into "الجمالي" when the text is
 * copied out. Both of those are real words, which is what makes the bug quiet:
 * the invoice looks perfect and searching it for a word that is on the page
 * finds nothing.
 *
 * A ToUnicode entry may map one code to a STRING, so both letters go back.
 */
function pdf_form_to_unicode(int $form): ?array
{
    // THE PAIR IS EMITTED ALEF-FIRST, WHICH LOOKS BACKWARDS AND IS NOT.
    //
    // The ligature is lam-then-alef as the word is spelled. But this file
    // writes text in VISUAL order — arabic.php has already reversed every
    // right-to-left run before it gets here — so the extracted stream is
    // visual too, and a reader puts it back into logical order by reversing it
    // again. A glyph standing for two letters has to sit in that stream the
    // same way round as everything else, or the reversal undoes it while
    // leaving its neighbours alone.
    //
    // Emitting the logical order produced "اإلجمالي" for "الإجمالي" — both
    // letters present, the two of them swapped, and the word no longer
    // findable by anyone searching for it. Reversing the pair puts it back.
    static $lig = null;
    if ($lig === null) {
        $lig = [];
        if (defined('AR_LAM_ALEF')) {
            foreach (AR_LAM_ALEF as $alef => $forms) {
                foreach ($forms as $f) $lig[$f] = [$alef, 0x0644];
            }
        }
    }
    if (isset($lig[$form])) return $lig[$form];
    $base = pdf_form_to_base($form);
    return $base === null ? null : [$base];
}

/** Characters to glyph ids, dropping anything the font has no glyph for. */
function pdf_glyphs(array $font, string $text): array
{
    $out = [];
    $len = mb_strlen($text, 'UTF-8');
    for ($i = 0; $i < $len; $i++) {
        $cp = mb_ord(mb_substr($text, $i, 1, 'UTF-8'), 'UTF-8');
        if ($cp === false) continue;
        $g = $font['cmap'][$cp] ?? null;

        // A PRESENTATION FORM THE FONT LACKS FALLS BACK TO THE PLAIN LETTER.
        // Not every font carries all four shapes of every letter, and the
        // failure when one is absent is the worst kind: the letter is simply
        // not drawn, the rest of the word closes up, and the result is a
        // customer's name spelled wrong on their invoice with nothing to
        // suggest anything went missing. Alexandria carries no isolated forms
        // at all — 36 codepoints — which is how this was found.
        //
        // The shaper now asks for the base character in that case, so this is
        // the second line of defence rather than the fix. It matters for the
        // next font somebody swaps in: an unjoined letter is a blemish, a
        // missing one is an error.
        if ($g === null && $cp >= 0xFE70 && $cp <= 0xFEFC) {
            $base = pdf_form_to_base($cp);
            if ($base !== null) $g = $font['cmap'][$base] ?? null;
        }
        if ($g !== null) $out[] = $g;
    }
    return $out;
}

/** How wide that string will be, in points, at this size. */
function pdf_text_width(array $font, string $text, float $size): float
{
    $w = 0;
    foreach (pdf_glyphs($font, $text) as $g) $w += $font['width'][$g] ?? 0;
    return $w * $size / $font['upem'];
}

/** A new document. Points, with the origin bottom-left, as PDF has it. */
function pdf_new(array $font, float $w = 595.28, float $h = 841.89): array
{
    return ['font' => $font, 'w' => $w, 'h' => $h, 'pages' => [], 'cur' => '', 'used' => []];
}

function pdf_page_break(array &$doc): void
{
    if ($doc['cur'] !== '') { $doc['pages'][] = $doc['cur']; $doc['cur'] = ''; }
}

/**
 * Draw text with its LEFT edge at x, or its RIGHT edge at x when $align is
 * 'right' — which is what an Arabic line needs, and the reason width is
 * measured here rather than guessed by the caller.
 */
function pdf_text(array &$doc, string $text, float $x, float $y, float $size,
                  string $align = 'left', array $rgb = [0, 0, 0]): void
{
    $glyphs = pdf_glyphs($doc['font'], $text);
    if (!$glyphs) return;
    foreach ($glyphs as $g) $doc['used'][$g] = true;

    if ($align === 'right')      $x -= pdf_text_width($doc['font'], $text, $size);
    elseif ($align === 'center') $x -= pdf_text_width($doc['font'], $text, $size) / 2;

    $hex = '';
    foreach ($glyphs as $g) $hex .= sprintf('%04X', $g);

    $doc['cur'] .= sprintf("BT %.3f %.3f %.3f rg /F1 %.2f Tf %.2f %.2f Td <%s> Tj ET\n",
        $rgb[0], $rgb[1], $rgb[2], $size, $x, $y, $hex);
}

function pdf_line(array &$doc, float $x1, float $y1, float $x2, float $y2,
                  float $w = 0.5, array $rgb = [0.8, 0.8, 0.8]): void
{
    $doc['cur'] .= sprintf("%.3f %.3f %.3f RG %.2f w %.2f %.2f m %.2f %.2f l S\n",
        $rgb[0], $rgb[1], $rgb[2], $w, $x1, $y1, $x2, $y2);
}

function pdf_rect(array &$doc, float $x, float $y, float $w, float $h, array $rgb): void
{
    $doc['cur'] .= sprintf("%.3f %.3f %.3f rg %.2f %.2f %.2f %.2f re f\n",
        $rgb[0], $rgb[1], $rgb[2], $x, $y, $w, $h);
}

/**
 * Serialise the whole thing.
 *
 * THE XREF TABLE IS THE PART THAT HAS TO BE EXACT. Every object's byte offset
 * from the start of the file is written into a table at the end, and a reader
 * seeks by those numbers — one wrong offset and the document does not open at
 * all, with no partial rendering to hint at where the mistake is. So offsets
 * are recorded as the bytes are appended rather than computed afterwards.
 */
function pdf_render(array $doc): string
{
    pdf_page_break($doc);
    $font = $doc['font'];

    $objects = [];
    $add = function (string $body) use (&$objects): int {
        $objects[] = $body;
        return count($objects);
    };

    $nPages = max(1, count($doc['pages']));
    $pageIds = [];
    $contentIds = [];

    // Reserve: 1 catalog, 2 pages tree. Content and page objects follow.
    $catalogId = $add('');           // 1, filled in at the end
    $pagesId   = $add('');           // 2

    foreach ($doc['pages'] as $content) {
        $contentIds[] = $add("<< /Length " . strlen($content) . " >>\nstream\n" . $content . "\nendstream");
    }
    if (!$contentIds) $contentIds[] = $add("<< /Length 0 >>\nstream\n\nendstream");

    // The font, embedded whole and flate-compressed.
    $raw = $font['data'];
    $comp = gzcompress($raw, 9);
    $fileId = $add("<< /Length " . strlen($comp) . " /Filter /FlateDecode /Length1 "
        . strlen($raw) . " >>\nstream\n" . $comp . "\nendstream");

    $descId = $add("<< /Type /FontDescriptor /FontName /SportaEmbedded "
        . "/Flags 4 /FontBBox [-1000 -400 2000 1100] /ItalicAngle 0 /Ascent 900 "
        . "/Descent -300 /CapHeight 700 /StemV 80 /FontFile2 {$fileId} 0 R >>");

    // WIDTHS FOR THE GLYPHS ACTUALLY USED. The /W array is what a reader
    // measures text with; a glyph missing from it silently falls back to
    // /DW, so a name would render with the right letters at the wrong
    // spacing. Only used glyphs are listed because the array is otherwise
    // thousands of entries of which a handful matter.
    $used = array_keys($doc['used']);
    sort($used);
    $w = '';
    foreach ($used as $g) {
        $adv = (int) round(($font['width'][$g] ?? 0) * 1000 / $font['upem']);
        $w .= $g . ' [' . $adv . '] ';
    }

    $cidId = $add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SportaEmbedded "
        . "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        . "/FontDescriptor {$descId} 0 R /DW 1000 /W [ {$w}] /CIDToGIDMap /Identity >>");

    // --- ToUnicode: what the glyphs MEAN, as opposed to how they look -------
    //
    // WITHOUT THIS THE DOCUMENT IS A PICTURE. Identity-H says "the code is the
    // glyph id", which is what makes any script drawable — and it also means
    // nothing in the file records that glyph 412 is the letter meem. The
    // invoice renders perfectly and then extracts as "ŀŚŹǢőƄ": not searchable,
    // not copyable, not indexable. On an archive of hundreds of files that is
    // most of the value gone, and the failure is invisible until somebody
    // searches a folder for an order number and is told it is not there.
    //
    // MAPPED BACK TO THE BASE LETTER, NOT THE PRESENTATION FORM. A medial meem
    // is U+FEE4 as a shape and U+0645 as a letter; writing the shape would
    // make the text extract as a string no one can search for, because nobody
    // types presentation forms. So the reverse map prefers the plain letter,
    // and copied Arabic comes out as ordinary Arabic.
    $rev = [];
    foreach ($font['cmap'] as $cp => $gid) {
        $isForm = $cp >= 0xFE70 && $cp <= 0xFEFF;
        // First writer wins unless it was a presentation form and this is not.
        if (!isset($rev[$gid]) || ($rev[$gid]['form'] && !$isForm)) {
            $rev[$gid] = ['cp' => $cp, 'form' => $isForm];
        }
    }
    $pairs = [];
    foreach ($used as $g) {
        $cp = $rev[$g]['cp'] ?? null;
        if ($cp === null) continue;
        // One glyph can mean more than one letter — the lam-alef ligatures do.
        $cps = $rev[$g]['form'] ? (pdf_form_to_unicode($cp) ?? [$cp]) : [$cp];
        // UTF-16BE, which is what a bfchar value is. Everything this shop
        // writes is inside the BMP, so one code unit each is always enough.
        $hex = '';
        foreach ($cps as $c) $hex .= sprintf('%04X', $c);
        $pairs[] = sprintf('<%04X> <%s>', $g, $hex);
    }

    $cmapBody = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        . "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        . "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        . "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
    // A bfchar block takes at most 100 entries — a hard limit in the spec, not
    // a style choice, and exceeding it makes readers drop the whole CMap.
    foreach (array_chunk($pairs, 100) as $chunk) {
        $cmapBody .= count($chunk) . " beginbfchar\n" . implode("\n", $chunk) . "\nendbfchar\n";
    }
    $cmapBody .= "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
    $toUniId = $add("<< /Length " . strlen($cmapBody) . " >>\nstream\n" . $cmapBody . "\nendstream");

    $fontId = $add("<< /Type /Font /Subtype /Type0 /BaseFont /SportaEmbedded "
        . "/Encoding /Identity-H /DescendantFonts [{$cidId} 0 R] "
        . "/ToUnicode {$toUniId} 0 R >>");

    foreach ($contentIds as $cid) {
        $pageIds[] = $add("<< /Type /Page /Parent {$pagesId} 0 R "
            . sprintf("/MediaBox [0 0 %.2f %.2f] ", $doc['w'], $doc['h'])
            . "/Resources << /Font << /F1 {$fontId} 0 R >> >> "
            . "/Contents {$cid} 0 R >>");
    }

    $kids = implode(' ', array_map(fn ($i) => "$i 0 R", $pageIds));
    $objects[$pagesId - 1] = "<< /Type /Pages /Kids [{$kids}] /Count " . count($pageIds) . " >>";
    $objects[$catalogId - 1] = "<< /Type /Catalog /Pages {$pagesId} 0 R >>";

    $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    $offsets = [];
    foreach ($objects as $i => $body) {
        $offsets[$i + 1] = strlen($out);
        $out .= ($i + 1) . " 0 obj\n" . $body . "\nendobj\n";
    }

    $xref = strlen($out);
    $count = count($objects) + 1;
    $out .= "xref\n0 {$count}\n0000000000 65535 f \n";
    for ($i = 1; $i < $count; $i++) {
        $out .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }
    $out .= "trailer\n<< /Size {$count} /Root {$catalogId} 0 R >>\nstartxref\n{$xref}\n%%EOF\n";
    return $out;
}
