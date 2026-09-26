<?php
/**
 * A permissions audit of the live account — READ-ONLY, changes nothing.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-permissions-check.php && php r.php
 *
 * WHY THIS EXISTS. `storage/deploy.secret` was found world-readable (0644,
 * should be 0600) on 2026-09-11 by looking at ONE file someone thought to
 * check. This asks the same question of every credential-bearing file and
 * directory this project knows about, plus a sweep of the whole docroot for
 * the general case a named list cannot anticipate: anything writable by
 * "other" on shared hosting, where "other" is every other account on the
 * machine.
 *
 * WHAT COUNTS AS A FINDING, and why each threshold is what it is:
 *
 *   - WORLD-WRITABLE (mode & 0002), on ANYTHING. There is no file in this
 *     project that legitimately needs another account on the machine to be
 *     able to write it. A world-writable PHP file is a way IN — anyone who
 *     can write it can have PHP execute anything they want as this account.
 *   - WORLD-READABLE (mode & 0004) on the NAMED CREDENTIAL FILES below only —
 *     not swept across the whole docroot, because most of public_html is
 *     served over HTTP and being world-readable AT THE FILESYSTEM LEVEL is
 *     not the same fact as being fetchable over the web (.htaccess already
 *     answers that question for the files it protects). This list is
 *     specifically the files where filesystem-level world-read is itself
 *     the exposure, because they hold a secret and sit outside what a URL
 *     can reach — exactly deploy.secret's own shape.
 *
 * NEVER PRINTS FILE CONTENTS. Every line below is a path, a mode and a
 * verdict — never a credential, a hash, a database row or a customer's data.
 * This can be republished safely even though the repository is public.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw';
$DOC  = $ROOT . '/public_html';

// Path, and whether world-READ alone is already the finding (a credential)
// or only world-WRITE is (everything else swept below).
$NAMED = [
    'api/config.php'              => true,
    'knet/config.php'             => true,
    'pay/config.php'              => true,
    '.htaccess'                   => false,
    'storage/deploy.secret'       => true,
];
// Outside public_html — the whole reason invoices, the payment log and the
// deploy secret live up there rather than in the docroot: no URL reaches
// them, so filesystem permission is the ONLY thing defending them.
$OUTSIDE = [
    '../invoices'                 => true,
    '../cbk-payments.log'         => true,
    '../sporta-voice.log'         => true,
    '../.cbk_token.json'          => true,
    'storage/deploy.secret'       => true,
];

$octal = static fn(string $p): ?string =>
    file_exists($p) ? substr(sprintf('%o', fileperms($p)), -4) : null;

$worldWritable = [];
$worldReadableSecret = [];
$named = [];

foreach ($NAMED as $rel => $secret) {
    $p = $DOC . '/' . $rel;
    $m = $octal($p);
    if ($m === null) { $named[] = "$rel=MISSING"; continue; }
    $perm = (int) octdec($m);
    $flagW = ($perm & 0002) !== 0;
    $flagR = $secret && ($perm & 0004) !== 0;
    $named[] = "$rel=$m" . ($flagW ? '(WORLD-WRITABLE)' : '') . ($flagR ? '(WORLD-READABLE!)' : '');
    if ($flagW) $worldWritable[] = $rel;
    if ($flagR) $worldReadableSecret[] = $rel;
}

foreach ($OUTSIDE as $rel => $secret) {
    $p = $DOC . '/' . $rel;
    $m = $octal($p);
    if ($m === null) { $named[] = "$rel=MISSING"; continue; }
    $perm = (int) octdec($m);
    $flagW = ($perm & 0002) !== 0;
    $flagR = $secret && ($perm & 0004) !== 0;
    $named[] = "$rel=$m" . ($flagW ? '(WORLD-WRITABLE)' : '') . ($flagR ? '(WORLD-READABLE!)' : '');
    if ($flagW) $worldWritable[] = $rel;
    if ($flagR) $worldReadableSecret[] = $rel;
}

// THE SWEEP. Every file and directory in the docroot, checked for the ONE
// thing that is never legitimate anywhere in it: world-write. Depth-limited
// walk, not recursive glob, so a directory this account cannot descend into
// (a permissions problem in ITSELF, worth reporting rather than silently
// skipping) does not abort the whole run.
$walked = 0;
$sweepWritable = [];
$stack = [$DOC];
while ($stack) {
    $dir = array_pop($stack);
    $items = @scandir($dir);
    if ($items === false) { $sweepWritable[] = substr($dir, strlen($DOC) + 1) . '=UNREADABLE-DIR'; continue; }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $full = $dir . '/' . $item;
        $walked++;
        $perm = @fileperms($full);
        if ($perm === false) continue;
        if (($perm & 0002) !== 0) {
            $sweepWritable[] = substr($full, strlen($DOC) + 1) . '=' . substr(sprintf('%o', $perm), -4);
        }
        if (is_dir($full) && !is_link($full)) $stack[] = $full;
    }
}

echo 'PERMS named=' . implode(',', $named) . "\n"
   . 'SWEEP walked=' . $walked
   . ' worldWritable=' . (count($sweepWritable) ? implode(',', $sweepWritable) : '0')
   . "\n"
   . 'VERDICT worldWritableCount=' . (count($worldWritable) + count($sweepWritable))
   . ' worldReadableSecretCount=' . count($worldReadableSecret)
   . "\n";
