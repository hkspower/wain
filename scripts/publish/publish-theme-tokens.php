<?php
/**
 * Publish the theme scan's three fixes: the brand token, the missing font
 * faces, and the dead accent field.
 *
 *   php /home/<user>/publish-theme-tokens.php
 *
 * EIGHT FILES, and the four fonts are the reason this exists as one job rather
 * than eight. `assets/index-*.css` declares IBM Plex Sans Arabic at 400, 600
 * and 700, split Arabic/Latin — eight faces. Only the 600 pair was ever on the
 * server; the other four 404'd, invisibly, because a browser fetches a face
 * only when text actually uses that weight.
 *
 * The other four files make the brand colour real:
 *
 *   assets/sporta-ui.css    re-states the 48 rules that hard-code a brand
 *                           colour in terms of --brand / --brand-dark /
 *                           --brand-bright (generated — see
 *                           scripts/make-brand-tokens.mjs)
 *   assets/sporta-dark.css  points --sp-ember / --sp-ember-fill at those
 *                           tokens. This is the one that decides the primary
 *                           button, because its rule carries !important.
 *   assets/theme.js         derives the family and writes --primary in HSL
 *                           channels; no longer writes the dead --accent
 *   api/admin.php           stops saving the dead `accent` field
 *
 * NONE OF THEM CHANGES THE SHOP ON ITS OWN. Every re-stated rule keeps its
 * literal value on the line above, both --sp-* tokens carry the shipped hex as
 * a var() fallback, and theme.js emits nothing for an empty field — so a shop
 * that never opens the theme editor is pixel-identical after this.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - eight paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch
 *   - temp file + rename; deletes nothing
 *   - fetched ONE AT A TIME, because three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *
 * No service-worker bump: none of these carries a content hash, so sw.js
 * treats them network-first. The fonts are new files, cached on first use.
 *
 * The check asks the live server for one of the previously-missing faces and
 * for the stylesheet, and looks for the marker of each change — a byte count
 * would not tell the difference between the old sporta-ui.css and the new one.
 */

$COMMIT = '2ce027e';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'assets/sporta-ui.css'      => 'b6801af2ac8093fde012cac23d8bc400fa658bb4ca1c2b0b86aaf970836dee5b',
    'assets/sporta-dark.css'    => 'a5aa6a360288e29f78bece4b34ab91f33caadb3e5cf834836e4ecc82f094998d',
    'assets/theme.js'           => 'f23ea66ca1b8b8212e4e59caeb3e7fea59fa625435d42ac4f1efbfdf1dd83ac2',
    'api/admin.php'             => '724f61f24eba7117a2c3ae68f6a052d44790459edf688531cb3345a751fa756f',
    'fonts/plex-400-arabic.woff2' => 'dc558aa338ac16bc32fe2acc588adf257e3b3c5073a16d464bc29086b71006fe',
    'fonts/plex-400-latin.woff2'  => '6107bc5f81236217957a2cf2c9b784080b632126099b02497b18058e67f2d63b',
    'fonts/plex-700-arabic.woff2' => 'e0d84bfe093322d0d31c2bfb608c33981b75231cab81873a827e019b3e84b4e0',
    'fonts/plex-700-latin.woff2'  => 'ad82e8d9d4f0f1d83efc6347f48fb0368c64c15303d971d9738c8f0227fb37d3',
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 90,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path, over the loopback. */
$serve = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, strlen($out), $out];
};

[, , $ui]        = $serve('/assets/sporta-ui.css');
[, , $dark]      = $serve('/assets/sporta-dark.css');
[$fontCode, $fontLen, ] = $serve('/fonts/plex-400-arabic.woff2');

echo 'THEMETOKENS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' brandBlock=' . (strpos($ui, 'brand tokens') !== false ? 'ok' : 'MISSING')
   . ' emberToken=' . (strpos($dark, 'var(--brand, #e0561c)') !== false ? 'ok' : 'MISSING')
   . ' plex400=' . $fontCode . '/' . $fontLen . "\n";
