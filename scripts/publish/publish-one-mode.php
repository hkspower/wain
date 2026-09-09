<?php
/**
 * Publish ONE MODE — the shop is dark, and the light theme becomes unreachable.
 *
 *   php /home/<user>/publish-one-mode.php
 *
 * TWO FILES, and neither of them works without the other:
 *
 *   index.html            writes localStorage.sporta_theme = 'dark' before any
 *                         module loads, then pins data-theme. The WRITE is the
 *                         point: the bundle's ThemeProvider initialises from
 *                         that key and sets data-theme in an effect AFTER
 *                         hydration, so pinning the attribute alone would be
 *                         undone one frame later for anybody who had ever
 *                         chosen light.
 *   assets/sporta-dark.css hides the header's toggle — the only control that
 *                         ever set the key — by aria-label, all four strings,
 *                         because the bundle gives that button no id and no
 *                         class of its own.
 *
 * Publishing ONE of them is worse than publishing neither: index.html alone
 * leaves a visible toggle that appears to do nothing, and the CSS alone leaves
 * an old light-mode visitor with no way back. Both are attempted in one run and
 * the count is reported per file.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - two paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *   - fetched ONE AT A TIME, because three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *
 * NO SERVICE-WORKER BUMP, checked rather than assumed: sw.js caches
 * cache-first only what matches HASHED (`-<8+ chars>.css|js`), and
 * sporta-dark.css has a fixed name; navigations — which is what index.html is
 * — are network-first in rule 3. Both reach a returning visitor on the next
 * load without rotating everyone's cache.
 *
 * The check reads BOTH files back over the loopback and looks for the thing
 * each one was published for, in what the server actually serves. Bytes alone
 * would not do: the old index.html is nearly the same size as the new one.
 */

$COMMIT = '9d3e087';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'index.html'             => '82cf203c3c3f2ecf68cbffefaabc07240dfc45d2bf6d4aa8390bdc3a06338b45',
    'assets/sporta-dark.css' => 'babca8b645b48ef4ec40f9056bddaf0380abf816a5303f405e0f73a118892606',
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
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path, over the loopback. The public name
 *  is used only as a Host header — see CLAUDE.md on why this form is the one
 *  that keeps working. */
$serve = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out = (string) curl_exec($ch);
    curl_close($ch);
    return $out;
};

$html = $serve('/');
$css  = $serve('/assets/sporta-dark.css');

echo 'ONEMODE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' homeBytes=' . strlen($html) . ' cssBytes=' . strlen($css)
   . ' pin=' . (strpos($html, "setItem('sporta_theme', 'dark')") !== false ? 'ok' : 'MISSING')
   . ' toggleHidden=' . (strpos($css, "aria-label='الوضع الفاتح'") !== false ? 'ok' : 'MISSING')
   . "\n";
