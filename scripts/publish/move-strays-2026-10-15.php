<?php
/**
 * Moves three files that must not be on the live server out of the web root, approved by the owner on
 * 2026-10-15. A RENAME, NOT A DELETE: each lands in ~/removed-2026-10-15/ (outside public_html, so
 * nothing serves it) with its path flattened, and can be put back with one rename.
 *
 *   knet/selftest.php   api/preflight.php   go-live.html
 *
 *   wget -nv -O r.php <raw URL of this file at a full commit SHA> && php r.php
 *
 * Reports STATE (where each file is now, by size), not its own verb, so a run read a minute late —
 * after the work is done — still says the true thing. This docroot has a writer that has restored a
 * removed file before; a later read showing a file back in the docroot means exactly that.
 */
header('Content-Type: text/plain; charset=utf-8');
$root  = '/home/u130124229/domains/sporta.com.kw/public_html';
$attic = '/home/u130124229/removed-2026-10-15';
$files = ['knet/selftest.php', 'api/preflight.php', 'go-live.html'];

if (!is_dir($attic) && !@mkdir($attic, 0700, true)) { echo "could not create the attic — nothing moved\n"; exit; }
$out = [];
foreach ($files as $f) {
    $src = $root . '/' . $f;
    $dst = $attic . '/' . str_replace('/', '__', $f);
    if (is_file($src) && !file_exists($dst)) @rename($src, $dst);
    $out[] = $f . '=' . (is_file($src) ? 'STILL-IN-DOCROOT:' . filesize($src) : 'gone')
           . '/attic:' . (is_file($dst) ? filesize($dst) : 'none');
}
echo 'STATE ', implode(' ', $out), "\n";
