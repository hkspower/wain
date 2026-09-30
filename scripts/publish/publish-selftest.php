<?php
/**
 * Publish the KNET self-test that names where the Tranportal ID came from.
 *
 *   php /home/<user>/publish-selftest.php
 *
 * WHY. /knet/selftest.php is the instrument the owner is told to run before
 * going live. It reported the tranportal_id in force but not WHICH OF ITS TWO
 * HOMES that value came from — knet/config.php, or the settings row /backends
 * writes, which silently wins. The go-live instructions say the commonest
 * failure is the wrong Tranportal ID and to fix it in the file; if one is
 * saved in /backends that edit does nothing. This version says so outright.
 *
 * It also reports whether the page is REACHABLE at all: it disables itself
 * unless env is 'test', which is the correct state for a live shop, and the
 * run prints which it is rather than leaving that to be guessed.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository, so:
 *   - one path, named below, nothing derived from input
 *   - checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing; creates no directory
 *
 * Re-running it is a no-op.
 */

$COMMIT = 'dc3407f33d71181db82d81bbcd07f72546d4f600';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    "knet/selftest.php" => "189c873882dd6e04968f30d678c42db12b624b4f3f5bae704a8f3fb5f2633374",
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
    if (!is_dir(dirname($target))) { $failed[] = $rel; continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

// IS THE PAGE OPEN ON THE LIVE SHOP? It disables itself unless env is 'test'.
// Read from the config directly rather than fetching the page, so this says
// what the server believes rather than what a cache served.
$env = '?';
$cfgFile = $ROOT . '/knet/config.php';
if (is_file($cfgFile)) {
    $c = @include $cfgFile;
    if (is_array($c)) $env = (string) ($c['env'] ?? '(unset)');
}

echo 'SELFTEST wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' knetEnv=' . $env
   . ' pageOpen=' . ($env === 'test' ? 'YES' : 'no') . "\n";
