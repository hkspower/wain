<?php
// READ-ONLY. What the three non-Sporta folders on the account hold, so the owner can decide about them:
// top-level entries of ~/public_html, wainkw.com and almuhallab-code.com with sizes and newest change,
// and the deploy folders' artifact counts. Names, sizes and dates only.
declare(strict_types=1);
set_time_limit(240);
function sz(string $p, int &$newest): int { if (is_link($p)) return 0; if (is_file($p)) { $newest = max($newest, (int) filemtime($p)); return (int) filesize($p); }
  $s = 0; try { foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($p, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY, RecursiveIteratorIterator::CATCH_GET_CHILD) as $f)
    if (!$f->isLink() && $f->isFile()) { $s += $f->getSize(); $newest = max($newest, $f->getMTime()); } } catch (Throwable $e) {} return $s; }
foreach (['/home/u130124229/public_html', '/home/u130124229/domains/wainkw.com', '/home/u130124229/domains/almuhallab-code.com', '/home/u130124229/domains/wainkw.com/storage'] as $root) {
  if (!is_dir($root)) { echo "DIR $root missing\n"; continue; }
  $rows = [];
  foreach (scandir($root) as $n) { if ($n === '.' || $n === '..') continue; $nw = 0; $s = sz("$root/$n", $nw);
    if ($s > 200000) $rows[] = $n . (is_dir("$root/$n") ? '/' : '') . '=' . round($s / 1048576, 1) . 'MB@' . ($nw ? date('Y-m-d', $nw) : '-'); }
  echo 'DIR ' . str_replace('/home/u130124229/', '~/', $root) . ' ' . implode(' ', $rows) . "\n";
}
foreach (['deploy', 'deploy-staging'] as $d) { $g = glob("/home/u130124229/domains/wainkw.com/storage/$d/artifact-*.zip") ?: [];
  echo "ARTIFACTS $d count=" . count($g) . ' total=' . round(array_sum(array_map('filesize', $g)) / 1048576, 1) . "MB\n"; }
$idx = '/home/u130124229/public_html';
echo 'HOMEPUB index=' . (is_file("$idx/index.html") ? 'html' : (is_file("$idx/index.php") ? 'php' : 'none')) . ' title=' . (is_file("$idx/index.html") && preg_match('#<title>([^<]{0,60})#i', (string) file_get_contents("$idx/index.html"), $m) ? $m[1] : '-') . "\n";
