#!/usr/bin/env node
/**
 * Build a self-contained PHP installer that writes named files into the live
 * document root — and removes nothing.
 *
 * WHY THIS EXISTS AS A SCRIPT rather than as something typed by hand each time:
 * the container this runs in is temporary. Every installer built in an earlier
 * session is gone; the repository is not. A builder in git can be re-run to
 * produce a byte-identical installer after the machine has been reclaimed,
 * which is the difference between "the hand-off survives" and "it was in the
 * other window".
 *
 * WHY AN INSTALLER AND NOT A ZIP. A zip extracted through the Hostinger File
 * Manager REPLACES the directory it lands in rather than merging into it. That
 * emptied api/ and assets/ on this site and took every config.php and .htaccess
 * with them. An installer writes the paths it is given and touches nothing
 * else, so the worst case is a file that did not change.
 *
 * WHY EACH WRITE GOES THROUGH A TEMPORARY FILE. A half-written CSS file served
 * to a customer is worse than an old one. Writing beside the target and
 * renaming into place makes the swap atomic, so a reader sees either the whole
 * old file or the whole new one.
 *
 * .htaccess IS SPECIAL. This host refuses a shell redirect that creates a file
 * called .htaccess, though copying one into place works. PHP's own write is
 * tried first and a copy() is the fallback, because which of the two the guard
 * permits is a property of the host, not something worth guessing at.
 *
 * Usage:  node scripts/make-installer.mjs <out.php> <file> [file...]
 * Paths are given relative to sporta-site/public_html and land at the same
 * place under the document root.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'sporta-site', 'public_html');

const [out, ...rels] = process.argv.slice(2);
if (!out || !rels.length) {
  console.error('usage: make-installer.mjs <out.php> <path-under-public_html>...');
  process.exit(2);
}

const key = randomBytes(24).toString('base64url');

const entries = rels.map((rel) => {
  const bytes = readFileSync(join(ROOT, rel));
  return {
    rel,
    b64: bytes.toString('base64'),
    size: bytes.length,
    sha: createHash('sha256').update(bytes).digest('hex'),
  };
});

// The payload is a PHP array literal rather than a single blob so that a
// truncated upload fails to parse instead of writing half a file.
const payload = entries
  .map((e) => `  ${JSON.stringify(e.rel)} => ["${e.sha}", "${e.b64}"],`)
  .join('\n');

const php = `<?php
/**
 * Sporta publisher — writes the files listed below and removes nothing.
 *
 * Upload next to index.html, open it with ?key=${key} , read the table, then
 * DELETE THIS FILE. It carries the whole payload in its own source and any
 * copy left in the web root is a copy of the site's code sitting where anyone
 * can ask for it.
 */
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

if (!hash_equals(${JSON.stringify(key)}, (string)($_GET['key'] ?? ''))) {
    http_response_code(403);
    exit('no');
}

$files = [
${payload}
];

$root = __DIR__;
$rows = [];
$bad = 0;

foreach ($files as $rel => [$sha, $b64]) {
    $target = $root . '/' . $rel;
    $dir = dirname($target);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        $rows[] = [$rel, 'FAILED', 'cannot create ' . $dir];
        $bad++;
        continue;
    }

    $data = base64_decode($b64, true);
    if ($data === false || hash('sha256', $data) !== $sha) {
        // Decoding is checked before anything is written, so a damaged upload
        // never reaches the document root.
        $rows[] = [$rel, 'FAILED', 'payload damaged in transit'];
        $bad++;
        continue;
    }

    $before = is_file($target) ? filesize($target) : null;

    // Write beside the target and rename in, so a reader never sees a partial
    // file. If the host refuses to rename onto this name — .htaccess is
    // guarded here — fall back to copy(), which it does permit.
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok = @file_put_contents($tmp, $data) === strlen($data);
    if ($ok) {
        $ok = @rename($tmp, $target) || @copy($tmp, $target);
    }
    @unlink($tmp);

    if (!$ok || !is_file($target) || hash_file('sha256', $target) !== $sha) {
        $rows[] = [$rel, 'FAILED', 'could not write ' . $target];
        $bad++;
        continue;
    }

    @chmod($target, 0644);
    $rows[] = [
        $rel,
        $before === null ? 'created' : 'replaced',
        number_format(strlen($data)) . ' bytes' .
            ($before === null ? '' : ' (was ' . number_format($before) . ')'),
    ];
}

echo '<!doctype html><meta charset="utf-8"><title>Sporta publisher</title>';
echo '<style>body{font:15px/1.6 system-ui;margin:2rem;max-width:46rem}';
echo 'td,th{padding:.35rem .8rem;border-bottom:1px solid #ddd;text-align:left}';
echo '.FAILED{color:#b00020;font-weight:700}</style>';
echo '<h1>Sporta publisher</h1><table>';
echo '<tr><th>file<th>result<th>size';
foreach ($rows as [$f, $r, $n]) {
    printf('<tr><td>%s<td class="%s">%s<td>%s', htmlspecialchars($f), $r, $r, htmlspecialchars($n));
}
echo '</table>';
echo $bad
    ? '<p class="FAILED">' . $bad . ' file(s) did not land. Nothing was removed — the site is as it was for those.</p>'
    : '<p><strong>All ' . count($rows) . ' files are in place.</strong> Now delete this file from the server.</p>';
`;

writeFileSync(out, php);

const total = entries.reduce((n, e) => n + e.size, 0);
console.log(`${basename(out)}  ${php.length.toLocaleString()} bytes`);
console.log(`key: ${key}`);
for (const e of entries) console.log(`  ${e.rel}  ${e.size.toLocaleString()}`);
console.log(`  ${entries.length} files, ${total.toLocaleString()} bytes of payload`);
