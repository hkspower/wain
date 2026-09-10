<?php
/**
 * Real mobile hero art — five frames the server never got.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-mobile.php && php r.php
 *
 * WHAT IT FIXES. hero/mobile/ and hero/desktop/ were BYTE-IDENTICAL, all five
 * frames, same sha256. The split existed in the paths and delivered nothing:
 * every phone downloaded the full 1600px desktop frame to show it in a box 390
 * CSS pixels wide. Nothing reported it, because every file was present and
 * every URL answered 200 — a directory can be wrong about what it is FOR while
 * being right about what it contains.
 *
 * scripts/make-hero-sizes.mjs rebuilt them at 1200px (390px at 3x, rounded up)
 * and they were committed. This is the half that was never done: live-file-check
 * reported `differ=5` on exactly these five, which is the repository being ahead
 * of the server rather than the server being wrong.
 *
 *     293,998 bytes  ->  174,124 bytes      119,874 saved per phone
 *
 * NO SERVICE-WORKER BUMP, checked rather than assumed — and the check is the
 * interesting part, because this is precisely the file class that caused the
 * "I change something and the shop still shows the old version" fault.
 *
 *   - /hero/ is sw.js RULE 2b, cache-first-then-quietly-refreshed, not the
 *     rule-2 cache-first-and-never-re-asked that pinned the fixed-name assets.
 *     A returning visitor gets their cached frame once and a background fetch
 *     replaces it, so the new art arrives on the next view without a bump.
 *   - and it is moot here anyway: VERSION went to v11-grid1 in a commit AFTER
 *     these five were committed (verified with `git merge-base --is-ancestor`),
 *     and activating a version deletes every cache that is not the current one.
 *     A visitor who has loaded the shop since that publish holds no hero cache
 *     at all.
 *
 * The desktop master is NOT in this run and is never touched. It is the only
 * copy of this artwork in the repository — there is no 3200px original
 * anywhere — which is also why test:image-sizes still allows the desktop
 * hero's x1.98 upscale by name: only the owner can close that one.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - five paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in it,
 *     which makes a raw.githubusercontent ref ambiguous — it returns an EMPTY
 *     file and says nothing)
 *   - temp file + rename; deletes nothing; creates no directory
 *   - fetched ONE AT A TIME, inside one script: three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones, and
 *     -q hid it. Sequential in one job is also why this is one cron cycle
 *     rather than five.
 *   - IDEMPOTENT: a file already matching its hash is skipped
 *
 * THE CHECK ASKS THE SERVER what it serves for each mobile frame and compares
 * it with the DESKTOP frame beside it — because "the bytes landed" and "the
 * phone is no longer being sent the desktop picture" are different claims, and
 * the second is the one this work was for. `stillDesktop` is the failure that
 * matters; a byte count alone would have read as success throughout the entire
 * period the bug existed.
 */

$COMMIT = 'def64d5';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

$FILES = [
    'hero/mobile/bodybuilding-men.webp'   => '2254295a155bfc993b652a797fee64757a29a74e89567b00e9e721a46466cc86',
    'hero/mobile/bodybuilding-women.webp' => '065c7b00cf08390a1698179be2fc2be0f1f4c72b12b3cb5efba7a4a5c48ead80',
    'hero/mobile/cardio-men.webp'         => '20cfd33e475b8edb9ca8138e5339a5b0e30a2dec479c0371719bc2aed9a85335',
    'hero/mobile/cardio-women.webp'       => '5fa7332f877afee30941838cc3a3e446784c7cb3582705b3909ea847085fdde5',
    'hero/mobile/crossfit-men.webp'       => '6efccef97d571ae3a22c504628d432aaa20605f72577fffb190744828c1be332',
];

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

    if ($body === false || $code !== 200 || $body === '') { $failed[] = basename($rel); continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = basename($rel); continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = basename($rel);
}

/** What the live server serves for a path. Loopback with a Host header. */
$serve = static function (string $path): string {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = (string) curl_exec($ch);
    curl_close($ch);
    return $body;
};

/* THE QUESTION THIS WORK WAS ABOUT: is the phone still being handed the desktop
   picture? Asked by comparing what the server serves at the two paths, which is
   how the fault was found in the first place and how it would come back. */
$stillDesktop = []; $mobileBytes = 0; $desktopBytes = 0; $servedOk = 0;
foreach (array_keys($FILES) as $rel) {
    $m = $serve('/' . $rel);
    $d = $serve('/' . str_replace('hero/mobile/', 'hero/desktop/', $rel));
    if ($m === '' || $d === '') { $stillDesktop[] = basename($rel) . '(unserved)'; continue; }
    $servedOk++;
    $mobileBytes  += strlen($m);
    $desktopBytes += strlen($d);
    if (hash('sha256', $m) === hash('sha256', $d)) $stillDesktop[] = basename($rel);
}

echo 'HEROMOBILE wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' served=' . $servedOk . '/' . count($FILES)
   . ' stillDesktop=' . (count($stillDesktop) ? implode(',', $stillDesktop) : '0')
   . ' mobileBytes=' . $mobileBytes . ' desktopBytes=' . $desktopBytes
   . ' savedPerPhone=' . ($desktopBytes - $mobileBytes)
   . "\n";
