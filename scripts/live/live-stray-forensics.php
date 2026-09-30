<?php
/**
 * Something puts cats/desktop/outlet.jpg back. What, and when?
 *
 * READ-ONLY. Timestamps, ownership and hashes. Nothing is written and no
 * configuration value is printed.
 *
 * WHAT HAPPENED. remove-strays.php moved the file into
 * /home/u130124229/removed-2026-09-10 at 14:22 UTC on 2026-09-10 and verified
 * it from both ends — gone from the docroot, landed in the attic at 59,388
 * bytes — and the four plain tile names all answered 404 in the same run.
 * Nine minutes later the file was on disk again at the same size and answering
 * 200. SPORTA-BACKEND.zip, which the same walk had reported minutes earlier,
 * was gone by then and nothing here removed it.
 *
 * So there is a writer to the live docroot that is not this channel, and that
 * matters far more than the tile does: every publisher in scripts/publish/
 * assumes it is the only thing writing, and verifies its work in the same
 * breath as doing it. A file that comes back later is invisible to all of them.
 *
 * WHAT THIS ASKS, and why each one:
 *   mtime/ctime   when the copy on disk was written, and when its inode last
 *                 changed — an extract sets both, a restore-from-backup
 *                 usually preserves mtime and moves ctime.
 *   owner/perms   whether the writer is this account or something running as
 *                 another user.
 *   sha256        whether the returned file is byte-identical to art-outlet.jpg
 *                 beside it, or merely the same size.
 *   the attic     whether the copy this session moved is still there, because
 *                 if it is, the new file is a NEW write and not that one
 *                 sliding back.
 *   neighbours    the mtimes of files nobody has touched, so "everything was
 *                 rewritten" and "one file appeared" are distinguishable.
 */
$root  = '/home/u130124229/domains/sporta.com.kw/public_html';
$attic = '/home/u130124229/removed-2026-09-10';

$stat = static function (string $p): string {
    if (!file_exists($p)) return 'absent';
    $s = stat($p);
    return $s['size'] . ',m=' . gmdate('m-d H:i:s', $s['mtime'])
         . ',c=' . gmdate('m-d H:i:s', $s['ctime'])
         . ',u=' . $s['uid'] . ':' . $s['gid']
         . ',p=' . substr(sprintf('%o', fileperms($p)), -4)
         . (is_file($p) ? ',h=' . substr(hash_file('sha256', $p), 0, 12) : '');
};

$lines = [
    'stray=' . $stat($root . '/cats/desktop/outlet.jpg'),
    'art=' . $stat($root . '/cats/desktop/art-outlet.jpg'),
    'atticCopy=' . $stat($attic . '/cats__desktop__outlet.jpg'),
    'atticZip=' . $stat($attic . '/SPORTA-BACKEND.zip'),
    'zipAtRoot=' . $stat($root . '/SPORTA-BACKEND.zip'),
    'deploy=' . $stat($root . '/api/deploy.php'),
    // Neighbours nobody touched, as a baseline for "was everything rewritten?"
    'catsDir=' . $stat($root . '/cats/desktop'),
    'index=' . $stat($root . '/index.html'),
    'sw=' . $stat($root . '/sw.js'),
];

echo 'FORENSICS now=' . gmdate('m-d H:i:s') . ' ' . implode(' ', $lines) . "\n";
