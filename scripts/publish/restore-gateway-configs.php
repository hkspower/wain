<?php
/**
 * Recreates the two git-ignored gateway config files that went missing from the live server (found
 * 2026-10-15, both absent and no backup anywhere on the account). Approved by the owner the same day.
 *
 * Each is written FROM THE REPOSITORY'S TEMPLATE, unchanged: pay/config.example.php -> pay/config.php and
 * knet/config.example.php -> knet/config.php. The templates hold NO secrets — placeholder credentials,
 * the test environment, the shop's return URLs, and an empty database block that is inherited from
 * api/config.php. The real CBK and KNET credentials come from /backends -> Payments, whose saved row
 * overrides the file (cbk_config() / knet_config()).
 *
 * NEVER OVERWRITES. A config.php that exists is left exactly as it is. Each template is checked against
 * its sha256 before it is written, and the written file is loaded back to prove it returns an array.
 *
 *   wget -nv -O r.php <raw URL of this file at a full commit SHA> && php r.php
 *
 * Ends with STATE (present/size/mode, env), so a later run reads the same answer.
 */
header('Content-Type: text/plain; charset=utf-8');
$COMMIT = '41770ea334f9da3dde6c5bbc7f6afdbcdb4d2c98';
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$want = [
    'pay'  => 'a1b8bbaf41ad52daa0f00cd0138660b16b490e00458a46f1a7e98330e63c242b',
    'knet' => 'e4ad1fccb4fce90a589c7547dc26494129188fe942628ac8bd9d1847bda2bfde',
];
$out = [];
foreach ($want as $dir => $sha) {
    $dst = "$root/$dir/config.php";
    $note = 'kept';
    if (!file_exists($dst)) {
        $url = "https://raw.githubusercontent.com/hkspower/wain/$COMMIT/sporta-site/public_html/$dir/config.example.php";
        $body = @file_get_contents($url);
        if (!is_string($body) || $body === '') { $note = 'FETCH-FAILED'; }
        elseif (hash('sha256', $body) !== $sha) { $note = 'HASH-MISMATCH'; }
        else {
            $tmp = $dst . '.new';
            if (@file_put_contents($tmp, $body) === false) { $note = 'WRITE-FAILED'; }
            else {
                @chmod($tmp, 0600);
                $note = @rename($tmp, $dst) ? 'written' : 'RENAME-FAILED';
            }
        }
    }
    $loads = 'no';
    $env = '?';
    if (is_file($dst)) {
        $c = (function ($f) { return @include $f; })($dst);
        if (is_array($c)) { $loads = 'yes'; $env = (string) ($c['env'] ?? '?'); }
    }
    $out[] = "$dir=" . $note . '/' . (is_file($dst) ? filesize($dst) . 'b/' . substr(sprintf('%o', fileperms($dst)), -4) : 'MISSING')
           . "/loads=$loads/env=$env";
}
echo 'STATE ', implode(' ', $out), "\n";
