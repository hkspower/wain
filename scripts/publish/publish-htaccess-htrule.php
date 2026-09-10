<?php
/**
 * Publish the `^\.ht` deny rule, and sweep the publishers' own leftovers.
 *
 *   php /home/<user>/publish-htaccess-htrule.php
 *
 * ONE FILE AND ONE TIDY-UP.
 *
 *   .htaccess   gains a named `<FilesMatch "(?i)^\.ht">Require all denied`.
 *               Apache and LiteSpeed already ship that rule in their MAIN
 *               configuration — measured, all five stray backups answered 403
 *               without it — so this buys ownership, not a change in
 *               behaviour: a defence you inherit is one you cannot watch
 *               change.
 *
 *   the five .htaccess.bak-* files in the docroot are DELETED. They are this
 *   session's publishers' own backups, written next to the file they replaced.
 *   The publishers write them above the docroot now.
 *
 * WHY DELETING IS SAFE HERE, and it is the only delete any publisher in this
 * directory does. Each file is a COPY of a .htaccess this session published,
 * every one of those versions is in git, and the current .htaccess is verified
 * by sha256 before and after the write below. Nothing unique is being thrown
 * away. The names are matched against a strict pattern — `.htaccess.bak-` plus
 * eight digits, a hyphen and six digits — so nothing else can be caught by it,
 * and the count is reported so a surprise is visible rather than silent.
 *
 * SPORTA-BACKEND.zip IS DELIBERATELY NOT TOUCHED. It is 435 kB of backend
 * source in the web root, it answers 403, and it is not this session's file to
 * remove — deleting somebody's upload because it looks untidy is not a
 * publisher's job.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - one path written, named below, checked against a sha256 BEFORE writing
 *   - REFUSED unless the live copy is exactly the version this was made
 *     against, with a timestamped backup kept ABOVE the docroot
 *   - deletes only names matching the strict pattern above
 *   - pinned to one COMMIT, not a branch
 */

$COMMIT = '36c3ed1';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$WANT   = 'fe79584c67c4c64b886c718bf829808f14d5e93eeda408c1a96c1ec4506838eb';
$MUSTBE = '309ce3cf0055a46e7cf403b6655d35fdffbedf10144fd02dff779ddfbbc901d4';

$target = $ROOT . '/.htaccess';
$now    = is_file($target) ? hash_file('sha256', $target) : '';
$state  = 'unknown';

if ($now === $WANT) {
    $state = 'alreadyOk';
} elseif ($now !== $MUSTBE) {
    $state = 'REFUSED-unexpected-live-copy';
} else {
    $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
                  . '/sporta-site/public_html/.htaccess');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') {
        $state = 'fetch-failed';
    } elseif (hash('sha256', $body) !== $WANT) {
        $state = 'hashMismatch';
    } else {
        @copy($target, dirname($ROOT) . '/.htaccess.bak-' . date('Ymd-His'));
        $tmp = $ROOT . '/.pub-' . bin2hex(random_bytes(6));
        $ok  = @file_put_contents($tmp, $body) === strlen($body);
        if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
        @unlink($tmp);
        $state = ($ok && hash_file('sha256', $target) === $WANT) ? 'wrote' : 'write-failed';
        if ($state === 'wrote') @chmod($target, 0644);
    }
}

// The sweep. Only after the write above has been verified — a run that failed
// to publish the rule should not also tidy away the evidence of what was there.
$swept = 0; $left = [];
if ($state === 'wrote' || $state === 'alreadyOk') {
    foreach (scandir($ROOT) ?: [] as $name) {
        if (!preg_match('/^\.htaccess\.bak-\d{8}-\d{6}$/', $name)) continue;
        if (@unlink($ROOT . '/' . $name)) $swept++; else $left[] = $name;
    }
}

/** What the server serves for a path — the only proof that matters. */
$serve = static function (string $path): int {
    $ch = curl_init('https://127.0.0.1/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 25,
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
};

// A file that is really there, refused, is the only proof a deny rule works —
// asking for one that does not exist answers 404 and proves nothing. So plant
// one, ask, and remove it.
$probe = $ROOT . '/.htaccess.bak-19700101-000000';
@file_put_contents($probe, "# probe\n");
$probeCode = $serve('.htaccess.bak-19700101-000000');
@unlink($probe);

echo 'HTRULE ' . $state
   . ' swept=' . $swept
   . ' couldNotDelete=' . (count($left) ? implode(',', $left) : '0')
   . ' plantedBackup=' . $probeCode . ($probeCode === 403 ? '-refused' : '-CHECK')
   . ' home=' . $serve('') . ' shopStillUp=' . ($serve('shop') === 200 ? 'yes' : 'CHECK')
   . "\n";
