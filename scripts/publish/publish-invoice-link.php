<?php
/**
 * Publish two pending changesets in one run — four files.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-invoice-link.php && php r.php
 *
 * WHY TWO CHANGESETS TOGETHER. Neither had been published yet, and both are
 * small, independent, and touch a shared file (sw.js), so one run avoids a
 * second VERSION bump for the same window:
 *
 *   1. sporta-dark.css + sw.js VERSION v31 — the promo strip's dark-mode
 *      .bg-ink-steel rule was silently outranked by the header's charcoal
 *      recolor (see CLAUDE.md, ".bg-ink-steel dark-mode rule"). Cosmetic:
 *      dark theme only, one element.
 *   2. index.html + assets/invoices.js (NEW file) — a link to the PDF
 *      invoice api/invoice-pdf.php already drew, inside the website panel's
 *      order-detail drawer. See scripts/invoice-link-test.mjs.
 *
 * NEITHER TOUCHES PHP. invoice-file.php, invoice-pdf.php and cron-invoice.php
 * are all already live and unchanged — this publish only adds a way to REACH
 * them from the panel. A shop that never opens an order's drawer is
 * byte-for-byte unaffected.
 *
 * index.html adds an external <script src>, not an inline one, so the CSP's
 * five sha256 hashes are unchanged — checked below against the SERVER, not
 * assumed from the repository.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - four paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not the working branch (its slash makes a
 *     raw.githubusercontent ref ambiguous — an empty file, no error)
 *   - temp file + rename; deletes nothing
 *   - fetched ONE AT A TIME — three concurrent raw.githubusercontent fetches
 *     once produced one good file and two empty ones
 *   - IDEMPOTENT: a file already matching its hash is skipped
 */

$COMMIT = '38fd829a3ac45f359bfedd40b1d50a4999f5e708';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-dark.css' => 'f58ef5b795b26010b49a806ed2741f83cd54f57aab09fbd46845af2ced8ab238',
    'assets/invoices.js'     => '4014c84e42538aae132ec42e63d05fb63c5147c6bdeef0ea0aa11670de845c2f',
    'index.html'             => '0dbe04313c8e32bb5764e94f19d78162017a2ce9325dd614e974178408b1be4a',
    'sw.js'                  => '12dd6b3b16cc27434c74240e9ce0db2eb1ce44768f95165a52ba4b94cbaf6a38',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel; continue; }
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path, over the loopback so this works
 *  whether or not the public domain resolves and bypasses the CDN. */
$serve = static function (string $path, array $extra = []): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $extra),
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size), $code];
};

[$headHtml, $html, $homeCode] = $serve('/');
[, $swBody, $swCode]          = $serve('/sw.js');
[, $invBody, $invCode]        = $serve('/assets/invoices.js');

/* The CSP still names every inline script the served page carries — checked
   against the SERVER, not assumed, since index.html changed. */
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

$swVersion = null;
if (preg_match("/VERSION\s*=\s*'([^']+)'/", $swBody, $vm)) $swVersion = $vm[1];

echo 'INVOICE-LINK wrote=' . $wrote . ' alreadyOk=' . $same
    . (count($bad) ? ' HASH-MISMATCH=' . implode(',', $bad) : '')
    . (count($failed) ? ' FAILED=' . implode(',', $failed) : '')
    . ' home=' . $homeCode . '/' . strlen($html)
    . ' invoicesJs=' . $invCode . '/' . strlen($invBody)
    . ' swVersion=' . ($swVersion ?? 'MISSING')
    . ' cspBlockedInline=' . $blocked
    . "\n";
