<?php
/**
 * WHO puts cats/desktop/outlet.jpg back one minute after it is removed?
 *
 * READ-ONLY. It greps the server's own PHP for code that could write it, and
 * reports what it finds. Nothing is written and no configuration value is
 * printed — matched lines are reported as FILE:LINE only, never as text,
 * because this runs over a public URL and a matched line could carry anything.
 *
 * MEASURED TWICE, identically. Moved 14:23:01 -> back 14:24:01. Moved
 * 14:39:01 -> back 14:40:01. Both times byte-identical to art-outlet.jpg
 * beside it (sha256 8c0675b4f9ed), both times at the cron tick, and both times
 * left alone afterwards — eight minutes untouched on the second. That last
 * part is the shape of a writer that only acts when the file is MISSING, which
 * is why nothing has ever noticed it: on a normal day it does nothing at all.
 *
 * SPORTA-BACKEND.zip, moved in the same run, has NOT come back. So this is not
 * a backup restoring the docroot wholesale; it is something specific to the
 * category art.
 *
 * The eight scheduled jobs do not explain it either — none of them runs every
 * minute and none names cats/ in its command. So the writer is either a PHP
 * file reachable from one of them, or something outside cron entirely.
 */
/* BOTH roots. The first version scanned only the docroot, which cannot contain
   the answer if the writer is a leftover script in the home directory — and
   the home directory is exactly where scripts land here, because a relative
   path in a cron command writes there. This channel's own scratch file, r.php,
   lives there for that reason. */
$roots = [
    'web'  => '/home/u130124229/domains/sporta.com.kw/public_html',
    'home' => '/home/u130124229',
];
$root = $roots['web'];

/* Names of the TARGET only. `copy(` was in this list in the first version and
   it is also in the write list below, so the conjunction "names the target AND
   can write" was satisfied by any file containing `copy(` — a tautology, and
   it produced exactly one candidate, api/deploy.php, which does not contain
   the string `cats` anywhere. I reported that file to the owner as the writer.
   It is a signed-POST deploy endpoint that cannot fire on a timer at all.

   The lesson is this repository's own, in a new place: an extractor's two
   halves must not share a term, or the AND between them stops meaning
   anything. Same family as the route extractor whose character class silently
   dropped a name — a check that cannot fail is not a check. */
$NEEDLES = ['outlet.jpg', 'art-outlet', 'cats/desktop', 'cats/mobile', '/cats/', 'publish-cats'];

$hits = []; $named = []; $scanned = 0;

foreach ($roots as $label => $base) {
    if (!is_dir($base)) continue;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY,
        RecursiveIteratorIterator::CATCH_GET_CHILD   // unreadable dirs must not abort the walk
    );
    foreach ($it as $f) {
        if (!$f->isFile()) continue;
        if (!preg_match('/\.(php|sh|js|cgi|pl|py)$/i', $f->getFilename())) continue;

        $path = $f->getPathname();
        // The home walk would otherwise re-scan the docroot underneath it.
        if ($label === 'home' && strpos($path, $roots['web']) === 0) continue;
        $rel = $label . ':' . substr($path, strlen($base) + 1);
        // The built bundle names the tiles constantly and writes nothing.
        if (strpos($rel, 'web:assets/') === 0) continue;
        $scanned++;

        $body = (string) @file_get_contents($path);
        if ($body === '') continue;

        $names = false;
        foreach ($NEEDLES as $n) if (strpos($body, $n) !== false) { $names = true; break; }
        if (!$names) continue;

        // Reported SEPARATELY from the writers. A file that names the target and
        // cannot write is not a candidate, but "which files even mention it?" is
        // the question to fall back on when the candidate list comes out empty —
        // and an empty list must not be the end of the enquiry.
        $named[] = $rel;

        $writes = [];
        foreach (['copy(', 'file_put_contents(', 'rename(', 'imagejpeg(', 'fopen(', 'exec(',
                  'shell_exec(', 'system(', 'passthru('] as $w) {
            if (strpos($body, $w) !== false) $writes[] = rtrim($w, '(');
        }
        if ($writes) $hits[] = $rel . '{' . implode('+', $writes) . '}';
    }
}

echo 'TILEWRITERS scanned=' . $scanned
   . ' writers=' . (count($hits) ? count($hits) . ':' . implode(' ', $hits) : '0')
   . ' mentionOnly=' . (count($named) ? count($named) . ':' . implode(' ', array_slice($named, 0, 12)) : '0')
   . "\n";
