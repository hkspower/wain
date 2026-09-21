<?php
/**
 * Publish EVERYTHING the repository has and the server does not — one run.
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/publish-all.php && php c.php
 *
 * WHY ONE RUN RATHER THAN A PUBLISHER PER CHANGE. Twenty-six files were behind
 * on 2026-09-19 — eighteen changed and eight never sent — across seven pieces
 * of work that landed without being published. Several are COUPLED, and the
 * couplings are the reason a file-by-file publish is the dangerous shape:
 *
 *   .htaccess + index.html   The policy names each inline script in index.html
 *                            by sha256. Published apart, in either order, there
 *                            is a window where the boot script is REFUSED — the
 *                            language flips after first paint, the theme does
 *                            not stick, the hero resizes under the reader.
 *   sw.js                    The VERSION bump is what frees a browser still
 *                            running the old worker. Without it the fixed-name
 *                            assets beside it reach new visitors only.
 *   api/*.php                store.php, api.php and admin.php changed together;
 *                            api.php calls customer.php, admin.php calls
 *                            research.php, and both new files are in this list.
 *
 * THE MIGRATION COMES FIRST AND IS NOT IN THIS FILE.
 * scripts/publish/migrate-customers.php adds `orders.customer_id`, and the new
 * checkout writes it. Publishing api/api.php against a table without that
 * column is not a degraded feature — it is EVERY CHECKOUT FAILING. Run the
 * migration, read `READY`, then run this.
 *
 * THE LIST IS FETCHED FROM THE MANIFEST AT THE SAME COMMIT, not written here.
 *
 * IT USED TO BE WRITTEN HERE, generated from scripts/live/live-file-check.php,
 * and that was wrong in a way that took a real under-publish to see. Changing
 * `$COMMIT` re-points where the CONTENT comes from and leaves the embedded
 * HASHES at whatever they were when this file was generated — so any file
 * edited since reports `alreadyOk` and is skipped WITHOUT A REQUEST. Measured
 * 2026-09-19: seo.php was fixed, committed, this was re-pinned to that commit,
 * and the run said `wrote=0 alreadyOk=220` while the server still served the
 * broken file. Nothing failed. Nothing warned.
 *
 * That is CLAUDE.md's "a publisher that grows a file list under-publishes in
 * silence" with the hashes gone stale instead of the list — the failure is a
 * larger `alreadyOk`, not an error.
 *
 * So there is ONE home for the hashes now: the manifest, fetched from this
 * publisher's own `$COMMIT`. Setting `$COMMIT` moves both, because they are
 * the same thing. A manifest that will not fetch or will not parse publishes
 * NOTHING, which is the right direction to fail.
 *
 * IT IS IDEMPOTENT AND FETCHES ONLY WHAT IT MUST. A file already matching its
 * hash is skipped WITHOUT a request, so this is a no-op on an up-to-date
 * server and a half-finished run completes on the next one. That is also what
 * makes the whole manifest affordable here: 222 entries, and only the ones that
 * differ cost a fetch.
 *
 * SAFE TO FETCH AND RUN, by the same five properties every publisher here has:
 *   - paths named in this file, nothing derived from input
 *   - each body checked against its sha256 BEFORE it is written
 *   - pinned to one full 40-character COMMIT, never a branch: the working
 *     branch has a slash in it, which makes a raw.githubusercontent ref
 *     ambiguous, and an abbreviated sha 404s — both return an EMPTY file and
 *     say nothing
 *   - temp file + rename; it deletes nothing and creates no directory
 *   - fetched ONE AT A TIME, because concurrent fetches of raw.githubusercontent
 *     once produced one good file and two empty ones
 *
 * IT DOES NOT TOUCH config.php, knet/config.php OR pay/config.php. None is in
 * the manifest — they hold the live credentials and are git-ignored, so there
 * is nothing here that could overwrite them.
 *
 * ECHO AS IT MEASURES. A run cut short by the channel must still report what
 * it got; a single trailing summary reports nothing.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$COMMIT = 'af1f34414970a86ad726877bbb9c5942bf01a744';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/* .htaccess and index.html are first on purpose: the CSP window above is the
   one coupling where the ORDER within a run still matters, and a run that dies
   halfway should have closed it rather than opened it. */
/* The manifest, from the same commit as the content it describes. */
$mfUrl = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
       . '/scripts/live/live-file-check.php';
$ch = curl_init($mfUrl);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
                        CURLOPT_TIMEOUT => 60]);
$mf = curl_exec($ch);
$mfCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
if (!is_string($mf) || $mfCode !== 200) {
    line('MANIFEST FETCH FAILED ' . $mfCode . ' — nothing published');
    exit;
}
$block = null;
if (preg_match('~\$WANT\s*=\s*\[(.*?)\n\];~s', $mf, $m)) $block = $m[1];
preg_match_all("~'([^']+)'\s*=>\s*'([0-9a-f]{64})'~", (string) $block, $mm, PREG_SET_ORDER);
$FILES = [];
foreach ($mm as $one) $FILES[$one[1]] = $one[2];

// A MANIFEST THAT PARSED TO ALMOST NOTHING IS NOT A SHORT MANIFEST, it is a
// parse that failed — and an empty $FILES publishes nothing while reporting a
// clean run, which is this project's oldest recorded failure shape.
if (count($FILES) < 50) {
    line('MANIFEST PARSED TO ' . count($FILES) . ' ENTRIES — refusing to publish from that');
    exit;
}
line('manifest ' . count($FILES) . ' files @ ' . substr($COMMIT, 0, 8));

/* .htaccess and index.html FIRST, for the CSP window: the policy names each
   inline script in index.html by sha256, so a run that dies halfway should
   have closed that window rather than opened it. The manifest is alphabetical,
   which puts index.html in the middle. */
foreach (['index.html', '.htaccess'] as $first) {
    if (isset($FILES[$first])) {
        $v = $FILES[$first];
        unset($FILES[$first]);
        $FILES = array_merge([$first => $v], $FILES);
    }
}


$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // THE CODE, NOT ONLY THE BYTES. An unresolvable ref answers 404 with a
    // short body, and a hash check alone would report that as a tamper rather
    // than as a wrong sha in this file.
    //
    // AN EMPTY FETCH AND AN EMPTY FILE ARE THE SAME BYTES, and the first
    // version of this refused both — so `images/brands/.gitkeep` and
    // `images/heros/.gitkeep`, which are zero-byte markers, fetched 200 and
    // were reported as failures. The manifest can tell them apart when the
    // body cannot: a file whose EXPECTED hash is the hash of the empty string
    // is supposed to be empty. Measured: wrote=29 failed=2, both of them this.
    $emptyIsCorrect = $want === hash('sha256', '');
    if ($body === false || $code !== 200 || ($body === '' && !$emptyIsCorrect)) {
        $failed[] = $rel . '(' . $code . ')'; continue;
    }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel . '(no dir)'; continue; }
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    // VERIFIED AFTER THE COPY, from the absolute path. An empty fetch and a
    // failed write look identical from the staging file.
    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) {
        @chmod($target, 0644); $wrote++;
        line('wrote ' . $rel);
    } else {
        $failed[] = $rel;
        line('FAILED ' . $rel);
    }
}

line('');
line('PUBLISH wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . count($bad) . (count($bad) ? ':' . implode(',', $bad) : '')
   . ' failed=' . count($failed) . (count($failed) ? ':' . implode(',', $failed) : ''));

/* And ask the SERVER what it now serves, over the loopback — the bytes landing
   is not the same question as LiteSpeed serving them, and this project has had
   the two disagree while both were telling the truth. */
$serve = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out = (string) curl_exec($ch);
    curl_close($ch);
    return (string) strlen($out);
};
line('SERVED home=' . $serve('/') . ' api=' . $serve('/api/api.php?r=products')
   . ' me=' . $serve('/api/api.php?r=customer_me'));
