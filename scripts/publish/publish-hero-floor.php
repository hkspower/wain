<?php
/**
 * Publish THE HERO FLOOR — a wide screen stops cropping the banner.
 *
 *   php /home/<user>/publish-hero-floor.php
 *
 * WHAT IT CHANGES. The hero was capped at 60svh, and once that cap binds
 * `min(100vw/1.90, 60svh)` is no longer a ratio: on a wide window the box came
 * out WIDER than the artwork's 2.52:1, so `cover` cropped the banner's HEIGHT
 * — 15% on every 16:9 screen, 26% at 1440x700, taking equal bites off the top
 * and the bottom because object-position is `15% center`. A floor now sits
 * under the cap, max(100vw/2.52, min(100vw/1.90, 60svh)), so the banner is
 * never cropped and the cap still binds everywhere it is not the cause.
 *
 * THREE FILES, AND THE ORDER MATTERS — which is the whole reason this is one
 * script rather than three cron jobs:
 *
 *   .htaccess             carries the CSP. It names each inline script in
 *                         index.html by sha256, and the boot script changed,
 *                         so its hash changed with it.
 *   index.html            the boot script itself, which paints the pre-mount
 *                         shell. It carried a DIFFERENT hero formula from the
 *                         stylesheet — measured, the two disagreed by up to
 *                         152px — and now carries the same one.
 *   assets/sporta-ui.css  the floor, on the mounted hero.
 *
 * PUBLISHED SEPARATELY, EITHER ORDER, THERE IS A WINDOW IN WHICH THE BOOT
 * SCRIPT IS REFUSED: the new index.html against the old CSP is a hash the
 * policy does not name, and the old index.html against the new CSP is the same
 * thing the other way round. A blocked boot script is not a blank page — it is
 * the subtler set of symptoms this repository has already paid for once: the
 * language flipping after first paint, the theme not sticking, the hero
 * resizing under the reader. Writing all three inside ONE run closes that
 * window to the few milliseconds between two renames.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - three paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in
 *     it, which makes a raw.githubusercontent ref ambiguous — it returns an
 *     EMPTY file and says nothing)
 *   - temp file + rename; deletes nothing; creates no directory
 *   - fetched ONE AT A TIME, because three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *
 * NO SERVICE-WORKER BUMP, checked rather than assumed. sw.js caches
 * cache-first only what matches a HASHED name (`-<8+ chars>.css|js`);
 * sporta-ui.css has a fixed name and falls through to rule 3, network-first,
 * and index.html is a navigation, which is rule 3 as well. Both reach a
 * returning visitor on the next load without rotating everyone's cache.
 *
 * THE CHECK ASKS THE SERVER, over the loopback, and asks for the thing each
 * file was published FOR rather than for its size — the old and new index.html
 * differ by well under a percent. It also re-reads the CSP the server SENDS
 * and confirms it names the script the page actually carries, because that is
 * the failure this script exists to avoid and reading .htaccess would only say
 * what the repository thinks.
 */

$COMMIT = '9e860f7';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    '.htaccess'            => '13eb7ac30fb5747a31ab60c5d603a22b8c1657440411e6dfbd4bbd65fa96d9e2',
    'index.html'           => '51435dfddcc0a3d200ffea98d5e1cf6c4f00478bfd7a5cdfbbb2afa4f36bb7b0',
    'assets/sporta-ui.css' => '8f65d85a6176ce50e92c448090af4caa6bb59ca212ca5b33c70ff915d639c6bf',
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

/** What the live server serves for a path, with its headers. The public name
 *  is used only as a Host header — see CLAUDE.md on why this form is the one
 *  that keeps working whether or not the domain resolves. */
$serve = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size)];
};

[$headHtml, $html] = $serve('/');
[, $css]           = $serve('/assets/sporta-ui.css');

/* Does the policy the server SENDS name the inline scripts the page CARRIES?
 * Anything else is the boot script silently refused. */
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$inline = count($s[1]);
$blocked = 0;
foreach ($s[1] as $body) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $body, true)), $declared, true)) $blocked++;
}

echo 'HEROFLOOR wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' homeBytes=' . strlen($html) . ' cssBytes=' . strlen($css)
   . ' floorCss=' . (strpos($css, 'min-height: calc(100vw / 2.52)') !== false ? 'ok' : 'MISSING')
   . ' floorShell=' . (strpos($html, 'max(calc(100vw / 2.52), min(calc(100vw / 1.90), 60svh))') !== false ? 'ok' : 'MISSING')
   . ' inlineScripts=' . $inline . ' cspHashes=' . count($declared) . ' BLOCKED=' . $blocked
   . "\n";
