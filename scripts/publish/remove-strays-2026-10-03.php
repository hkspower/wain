<?php
// 2026-10-03, owner: "yes do" — the three files on the server that no commit has. MOVED to an attic
// outside public_html, never deleted, so any of them is one rename away. Reports STATE (where each
// file is now), so a later tick reads the same as the run that moved them.
$root  = '/home/u130124229/domains/sporta.com.kw/public_html/';
$attic = '/home/u130124229/removed-2026-10-03/';
@mkdir($attic, 0700, true);
$out = [];
foreach (['assets/section-heads.js', 'cats/desktop/outlet.jpg', 'default.php'] as $rel) {
    $src = $root . $rel; $dst = $attic . str_replace('/', '__', $rel);
    if (is_file($src) && !is_file($dst)) @rename($src, $dst);
    elseif (is_file($src) && is_file($dst)) @rename($src, $dst . '.' . date('His'));   // it came back
    $out[] = $rel . '=' . (is_file($src) ? 'STILL-LIVE' : 'gone') . '/attic=' . (is_file($dst) ? filesize($dst) : 0);
}
echo 'STRAYS ' . implode(' ', $out) . "\n";
