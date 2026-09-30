<?php
/**
 * Remove the two untracked strays from the live docroot, on the owner's word
 * (2026-09-10). WRITES — it is in scripts/publish/ for that reason.
 *
 *   cats/desktop/outlet.jpg   59,388 bytes, a copy of art-outlet.jpg saved
 *                             under the BRIDGING name. The tile component only
 *                             falls to its good <picture> — webp, and the -rtl
 *                             Arabic composition — when the plain name ERRORS.
 *                             This one answers 200, so the outlet tile is
 *                             pinned to the jpeg. Its three siblings 404
 *                             correctly; measured by live-tile-names.php.
 *
 *   SPORTA-BACKEND.zip        445 KB of source in the web root. Currently 403
 *                             through the CDN, but only by an .htaccess rule —
 *                             on a server whose .htaccess a restore has rolled
 *                             back before, taking that rule with it.
 *
 * NOT api/deploy.php and NOT default.php. The first is a signed remote deploy
 * endpoint the owner has not ruled on; the second is Hostinger's own
 * placeholder and harmless. A script that removes more than it was approved
 * for is the failure this repository already records of an Extract that
 * "replaces rather than merges".
 *
 * MOVED, NOT UNLINKED. Each file is renamed into a timestamped directory in
 * the HOME directory — outside public_html, so nothing serves it — and the
 * move is verified afterwards from both ends. A delete on a live server should
 * be undoable by a rename; `rm` is not. The zip in particular is 445 KB of
 * somebody's work and no copy of it is known to exist anywhere else.
 *
 * IDEMPOTENT. A path already gone is reported `already-gone`, not an error, so
 * a re-run costs nothing.
 *
 * The check at the end asks the SERVER what the four plain tile names do now,
 * cache-busted — because /cats/ carries max-age=86400 plus a month of
 * stale-while-revalidate and a cached 200 can outlive the file that made it.
 * A run that reports STILL-BRIDGED with the file confirmed gone is LiteSpeed
 * holding an old response, not a failed delete; that is the distinction
 * live-tile-probe.php exists to draw.
 */

$ROOT  = '/home/u130124229/domains/sporta.com.kw/public_html';
$ATTIC = '/home/u130124229/removed-2026-09-10';

$REMOVE = ['cats/desktop/outlet.jpg', 'SPORTA-BACKEND.zip'];

if (!is_dir($ATTIC)) @mkdir($ATTIC, 0700, true);

$out = [];
foreach ($REMOVE as $rel) {
    $from = $ROOT . '/' . $rel;
    if (!is_file($from)) { $out[] = $rel . '=already-gone'; continue; }

    $size = filesize($from);
    $to   = $ATTIC . '/' . str_replace('/', '__', $rel);
    $ok   = @rename($from, $to);

    // Verified from BOTH ends by absolute path: gone from the docroot AND
    // present in the attic at the same size. Either alone can be true while
    // the move half-failed.
    $gone   = !file_exists($from);
    $landed = is_file($to) && filesize($to) === $size;

    $out[] = $rel . '=' . ($ok && $gone && $landed ? 'moved/' . $size
           : 'FAILED(rename=' . ($ok ? 'y' : 'n') . ' gone=' . ($gone ? 'y' : 'n')
             . ' landed=' . ($landed ? 'y' : 'n') . ')');
}

$ask = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw', 'Cache-Control: no-cache'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return $code . (strpos($type, 'image/') === 0 ? '/img/' : '/non/') . strlen($body);
};

$tiles = [];
foreach (['accessories', 'men', 'outlet', 'women'] as $id) {
    $tiles[] = $id . '=' . $ask('/cats/desktop/' . $id . '.jpg?cb=' . bin2hex(random_bytes(4)));
}

// The shop still answers — the one thing a removal must not cost. Both are
// asked over the loopback, so neither depends on the domain resolving.
$home = $ask('/');
$zip  = $ask('/SPORTA-BACKEND.zip');

echo 'STRAYS ' . implode(' ', $out)
   . ' | tiles ' . implode(' ', $tiles)
   . ' | zip=' . $zip . ' home=' . $home . "\n";
