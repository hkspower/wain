<?php
/**
 * Arabic, shaped and ordered for a PDF.
 *
 * WHY THIS FILE HAS TO EXIST. A PDF has no idea what Arabic is. It draws
 * glyphs, left to right, in the order you hand them over, and that is the
 * whole of its typographic opinion. Everything a browser does for free — join
 * the letters, pick the right shape for each position, run the line
 * right-to-left, keep the Latin and the digits inside it running the other way
 * — has to be done before the text reaches the page. Hand "سبورتا" to a PDF
 * writer unprepared and it comes out as six disconnected letters in reverse.
 *
 * That is the reason orders-print.php gives for letting the browser make the
 * PDF, and it was the right call while nothing here could shape a word. This
 * file is what changes it.
 *
 * TWO STEPS, AND THEY ARE DIFFERENT PROBLEMS.
 *
 *   SHAPING. An Arabic letter has up to four shapes depending on what sits
 *   beside it — isolated, initial, medial, final — and Unicode keeps every one
 *   of them as its own codepoint in the Presentation Forms-B block, U+FE70 to
 *   U+FEFF. So shaping here is a lookup, not a rendering engine: decide which
 *   of the four a letter is in, and swap it for that codepoint. This works
 *   because the shop's own font, Alexandria, carries 89 of those forms —
 *   checked, not assumed. A font with only the base block would need the
 *   OpenType GSUB tables applied properly, which is a different and much
 *   larger program.
 *
 *   ORDERING. Shaped letters still have to be laid down in visual order. This
 *   is a deliberately small bidi: Arabic runs reverse, Latin and digit runs do
 *   not, and the runs themselves are laid out right to left for an Arabic
 *   line. It is not UAX #9 and does not pretend to be — no explicit embedding
 *   codes, no bracket pairs. It is exactly enough for what an invoice holds:
 *   an Arabic name, an Arabic address with Latin block and street numbers in
 *   it, and a Latin order reference.
 *
 * NUMBERS ARE LEFT AS LATIN DIGITS, and that is a decision rather than an
 * omission. An invoice is a document somebody reads a total off and types into
 * a bank app or reads down a telephone; ٢٤ and 24 are the same number and only
 * one of them survives that trip reliably. The shop's own website makes the
 * opposite choice for prose, which is right for prose.
 */
declare(strict_types=1);

/**
 * Every Arabic letter that changes shape, and the four shapes it takes.
 *
 * [isolated, final, initial, medial] — and a letter with only two entries is
 * RIGHT-JOINING: it accepts a join from the letter before it and offers none
 * to the letter after, so it has no initial or medial form. Alef and the
 * dal/reh/waw families are the ones people notice, because a word containing
 * one visibly breaks into two pieces.
 */
const AR_FORMS = [
    0x0621 => [0xFE80],                                  // hamza — joins nothing
    0x0622 => [0xFE81, 0xFE82],                          // alef madda
    0x0623 => [0xFE83, 0xFE84],                          // alef hamza above
    0x0624 => [0xFE85, 0xFE86],                          // waw hamza
    0x0625 => [0xFE87, 0xFE88],                          // alef hamza below
    0x0626 => [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],          // yeh hamza
    0x0627 => [0xFE8D, 0xFE8E],                          // alef
    0x0628 => [0xFE8F, 0xFE90, 0xFE91, 0xFE92],          // beh
    0x0629 => [0xFE93, 0xFE94],                          // teh marbuta
    0x062A => [0xFE95, 0xFE96, 0xFE97, 0xFE98],          // teh
    0x062B => [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],          // theh
    0x062C => [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],          // jeem
    0x062D => [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4],          // hah
    0x062E => [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8],          // khah
    0x062F => [0xFEA9, 0xFEAA],                          // dal
    0x0630 => [0xFEAB, 0xFEAC],                          // thal
    0x0631 => [0xFEAD, 0xFEAE],                          // reh
    0x0632 => [0xFEAF, 0xFEB0],                          // zain
    0x0633 => [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4],          // seen
    0x0634 => [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],          // sheen
    0x0635 => [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],          // sad
    0x0636 => [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0],          // dad
    0x0637 => [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],          // tah
    0x0638 => [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8],          // zah
    0x0639 => [0xFEC9, 0xFECA, 0xFECB, 0xFECC],          // ain
    0x063A => [0xFECD, 0xFECE, 0xFECF, 0xFED0],          // ghain
    0x0640 => [0x0640, 0x0640, 0x0640, 0x0640],          // tatweel — joins both ways, never changes
    0x0641 => [0xFED1, 0xFED2, 0xFED3, 0xFED4],          // feh
    0x0642 => [0xFED5, 0xFED6, 0xFED7, 0xFED8],          // qaf
    0x0643 => [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],          // kaf
    0x0644 => [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0],          // lam
    0x0645 => [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4],          // meem
    0x0646 => [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],          // noon
    0x0647 => [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],          // heh
    0x0648 => [0xFEED, 0xFEEE],                          // waw
    0x0649 => [0xFEEF, 0xFEF0],                          // alef maksura
    0x064A => [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],          // yeh
];

/**
 * LAM followed by an ALEF is one glyph, not two, and it is not optional.
 * "لا" written as a lam beside an alef is wrong in the way that "rn" for "m"
 * is wrong — every reader sees it. Keyed by the alef, giving [isolated, final].
 */
const AR_LAM_ALEF = [
    0x0622 => [0xFEF5, 0xFEF6],
    0x0623 => [0xFEF7, 0xFEF8],
    0x0625 => [0xFEF9, 0xFEFA],
    0x0627 => [0xFEFB, 0xFEFC],
];

/** Marks that sit above or below a letter and take no width of their own. */
function ar_is_mark(int $cp): bool
{
    return ($cp >= 0x064B && $cp <= 0x065F) || $cp === 0x0670
        || ($cp >= 0x06D6 && $cp <= 0x06ED);
}

/** Does this letter offer a join to the letter AFTER it? Only 4-form letters do. */
function ar_joins_forward(int $cp): bool
{
    return isset(AR_FORMS[$cp]) && count(AR_FORMS[$cp]) === 4;
}

/** Does this letter accept a join from the letter BEFORE it? Anything with a final form. */
function ar_joins_back(int $cp): bool
{
    return isset(AR_FORMS[$cp]) && count(AR_FORMS[$cp]) >= 2;
}

function ar_is_arabic(int $cp): bool
{
    return ($cp >= 0x0600 && $cp <= 0x06FF) || ($cp >= 0xFB50 && $cp <= 0xFEFF)
        || ($cp >= 0x0750 && $cp <= 0x077F);
}

/** UTF-8 in, array of codepoints out. */
function ar_codepoints(string $s): array
{
    $out = [];
    $len = mb_strlen($s, 'UTF-8');
    for ($i = 0; $i < $len; $i++) {
        $ch = mb_substr($s, $i, 1, 'UTF-8');
        $out[] = mb_ord($ch, 'UTF-8') ?: 0x20;
    }
    return $out;
}

/**
 * Pick each letter's shape from its neighbours, and fuse lam-alef.
 *
 * MARKS ARE TRANSPARENT. A fatha between two letters does not break their
 * join, so the neighbour search skips over marks rather than stopping at them.
 * Getting this wrong is subtle in the worst way: the word still renders, and
 * only a reader notices that one join has come apart under a vowel.
 */
function ar_shape(array $cps): array
{
    $out = [];
    $n = count($cps);

    // Index of the previous / next non-mark character.
    $prevOf = [];
    $nextOf = [];
    $last = -1;
    for ($i = 0; $i < $n; $i++) {
        $prevOf[$i] = $last;
        if (!ar_is_mark($cps[$i])) $last = $i;
    }
    $last = -1;
    for ($i = $n - 1; $i >= 0; $i--) {
        $nextOf[$i] = $last;
        if (!ar_is_mark($cps[$i])) $last = $i;
    }

    $skip = -1;
    for ($i = 0; $i < $n; $i++) {
        if ($i === $skip) continue;
        $cp = $cps[$i];

        if (ar_is_mark($cp)) { $out[] = $cp; continue; }

        if (!isset(AR_FORMS[$cp])) { $out[] = $cp; continue; }

        $p = $prevOf[$i];
        $nx = $nextOf[$i];
        $prevJoins = $p >= 0 && ar_joins_forward($cps[$p]);

        // LAM + ALEF, before anything else: the pair becomes one glyph, and
        // whether it is the isolated or the final form depends only on what
        // came before the lam.
        if ($cp === 0x0644 && $nx >= 0 && isset(AR_LAM_ALEF[$cps[$nx]])) {
            $lig = AR_LAM_ALEF[$cps[$nx]];
            $out[] = $prevJoins ? $lig[1] : $lig[0];
            $skip = $nx;
            continue;
        }

        $forms = AR_FORMS[$cp];
        $nextJoins = $nx >= 0 && ar_joins_back($cps[$nx]);

        // THE ISOLATED FORM IS THE BASE CHARACTER, not the FExx codepoint the
        // table lists for it. U+0627 already IS a standalone alef, so a font
        // has no reason to carry U+FE8D as well — and Alexandria does not,
        // along with every other isolated form: 36 of them, which is exactly
        // the set that came out missing when this first ran. Every letter that
        // stood alone or ended a word after a non-joiner simply vanished from
        // the page. Asking for the base codepoint is both what the font has
        // and what the character means.
        if (count($forms) === 4) {
            if ($prevJoins && $nextJoins)      $out[] = $forms[3];   // medial
            elseif ($prevJoins)                $out[] = $forms[1];   // final
            elseif ($nextJoins)                $out[] = $forms[2];   // initial
            else                               $out[] = $cp;         // isolated
        } else {
            $out[] = $prevJoins ? $forms[1] : $cp;
        }
    }
    return $out;
}

/**
 * Logical order in, visual order out.
 *
 * THE SMALL BIDI, and its limits are the point. Text is cut into runs of one
 * direction; Arabic runs reverse, Latin and digit runs keep their order, and
 * for a right-to-left line the runs themselves are laid out from the right.
 * Neutral characters — spaces, punctuation — take the direction of the run
 * they follow, which is what keeps "Salmiya, Block 4" from coming apart in the
 * middle of an Arabic address.
 *
 * A NUMBER IS NOT REVERSED even inside Arabic. "24" read backwards is "42",
 * and on an invoice that is a different amount of money. This is the one case
 * where a shortcut would produce something that looks plausible and is wrong,
 * which is why digits are their own run type rather than being swept in with
 * the surrounding Arabic.
 */
function ar_visual(string $text, bool $rtl = true): string
{
    $cps = ar_codepoints($text);
    if (!$cps) return '';

    $shaped = ar_shape($cps);

    // Classify: 1 = RTL, 0 = LTR/digit, -1 = neutral.
    $cls = [];
    foreach ($shaped as $cp) {
        if (ar_is_arabic($cp) && !($cp >= 0x0660 && $cp <= 0x0669)) $cls[] = 1;
        elseif (($cp >= 0x30 && $cp <= 0x39) || ($cp >= 0x41 && $cp <= 0x5A)
             || ($cp >= 0x61 && $cp <= 0x7A) || ($cp >= 0x0660 && $cp <= 0x0669)) $cls[] = 0;
        else $cls[] = -1;
    }

    // A neutral takes the direction of what is around it; the paragraph
    // direction decides the ones at the very edges.
    $base = $rtl ? 1 : 0;
    for ($i = 0; $i < count($cls); $i++) {
        if ($cls[$i] !== -1) continue;
        $before = $base; $after = $base;
        for ($j = $i - 1; $j >= 0; $j--) if ($cls[$j] !== -1) { $before = $cls[$j]; break; }
        for ($j = $i + 1; $j < count($cls); $j++) if ($cls[$j] !== -1) { $after = $cls[$j]; break; }
        $cls[$i] = $before === $after ? $before : $base;
    }

    // Cut into runs of one direction.
    $runs = [];
    $cur = [$shaped[0]];
    $curDir = $cls[0];
    for ($i = 1; $i < count($shaped); $i++) {
        if ($cls[$i] === $curDir) { $cur[] = $shaped[$i]; continue; }
        $runs[] = [$curDir, $cur];
        $cur = [$shaped[$i]];
        $curDir = $cls[$i];
    }
    $runs[] = [$curDir, $cur];

    $out = [];
    foreach ($runs as [$dir, $chars]) {
        if ($dir === 1) $chars = array_reverse($chars);
        $out[] = $chars;
    }
    if ($rtl) $out = array_reverse($out);

    $flat = [];
    foreach ($out as $chunk) foreach ($chunk as $c) $flat[] = $c;

    $s = '';
    foreach ($flat as $cp) $s .= mb_chr($cp, 'UTF-8');
    return $s;
}

/** Is there any Arabic in here at all? Decides a line's base direction. */
function ar_has_arabic(string $s): bool
{
    foreach (ar_codepoints($s) as $cp) if (ar_is_arabic($cp)) return true;
    return false;
}
