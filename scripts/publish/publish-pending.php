<?php
/**
 * Publish EVERYTHING WAITING as of 2026-09-10 — nine files, one run.
 *
 *   php /home/<user>/publish-pending.php
 *
 * WHY ONE SCRIPT. Three separate pieces of work stacked up while the Hostinger
 * connector was down, and two of them are coupled to a third file that nothing
 * would make you publish on its own:
 *
 *   THE HERO FLOOR          sporta-ui.css + index.html
 *     A wide screen cropped the banner's top and bottom — 15% on every 16:9
 *     screen, 26% at 1440x700. A floor under the 60svh cap fixes it, and the
 *     pre-paint shell in index.html carries the same formula.
 *
 *   BOTH THEMES BACK        index.html + sporta-dark.css
 *     The shopper's dark/white toggle is restored. index.html no longer pins
 *     the stored choice to dark; sporta-dark.css no longer hides the toggle,
 *     and fixes the carousel dot that rendered at 2.14:1 on the hero in the
 *     white theme — invisible, and unreported because the theme could not be
 *     opened.
 *
 *   A WORKING DAY SIGNED IN store.php
 *     session.gc_maxlifetime was PHP's 1440-second default, so the session
 *     FILE was deletable after 24 minutes idle and the 12-hour window above it
 *     never happened. Raising it cannot lengthen a session — store_session_admin()
 *     still decides — it only lets that decision be the one taken.
 *
 *   SAFE SEEDS              api/seed.mysql.sql, install.mysql.sql, brands.mysql.sql
 *     Three on-duplicate-key clauses overwrote a hand-priced product, a renamed
 *     brand and the wholesale cost on every import. Not executed by the site —
 *     published so the copies ON the server match the repository, because
 *     live-file-check's manifest names them and a `differ` there should mean
 *     something.
 *
 * AND .htaccess IS WHY THIS CANNOT BE THREE JOBS. It carries the CSP, which
 * names each inline script in index.html by sha256. index.html's boot script
 * changed twice, so its hash changed twice. Published apart, in either order,
 * there is a window where the boot script is REFUSED: a new index.html against
 * an old policy is a hash the policy does not name, and an old index.html
 * against a new policy is the same thing reversed. A blocked boot script is not
 * a blank page — it is the language flipping after first paint, the theme not
 * sticking, the hero resizing under the reader. One run closes that window to
 * the gap between two renames.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. Plain HTTP from a PUBLIC repository:
 *   - nine paths, named below, nothing derived from input
 *   - each checked against the sha256 recorded here BEFORE it is written
 *   - pinned to one COMMIT, not a branch (the working branch has a slash in it,
 *     which makes a raw.githubusercontent ref ambiguous — it returns an EMPTY
 *     file and says nothing)
 *   - temp file + rename; deletes nothing; creates no directory
 *   - fetched ONE AT A TIME, because three concurrent fetches of
 *     raw.githubusercontent once produced one good file and two empty ones
 *   - IDEMPOTENT: a file already matching its hash is skipped, so re-running
 *     costs nothing and a half-finished run completes on the next one
 *
 *   THE SERVICE-WORKER BUMP  sw.js
 *     AND THIS PARAGRAPH USED TO SAY THE OPPOSITE. It read "no service-worker
 *     bump, checked rather than assumed: sw.js caches cache-first only what
 *     matches a HASHED name, and both CSS files here have fixed names and fall
 *     through to rule 3, network-first". Every clause of that is true — OF A
 *     BROWSER ALREADY RUNNING THIS WORKER.
 *
 *     A browser still running an OLDER worker is executing the OLDER rules,
 *     where everything under /assets/ was cache-first and never re-asked. It
 *     holds sporta-ui.css from whenever it first visited and does not ask
 *     again, so none of the three changes above reaches it. The owner reported
 *     exactly that — "I change something and the shop still shows the old
 *     version" — while the origin sent no-cache, the CDN said BYPASS and this
 *     worker was network-first. All three were measurements of the CURRENT
 *     worker; the stale copy was in a cache belonging to one that exists only
 *     in a visitor's browser.
 *
 *     Activating a new VERSION deletes every cache that is not the current one.
 *     That is what frees them, and it costs each visitor one re-download.
 *     npm run test:sw-version now fails when a fixed-name asset changes without
 *     it, because the rule had been written in sw.js's own comments and missed
 *     twice anyway.
 *
 * THE CHECK ASKS THE SERVER, over the loopback, for the thing each change was
 * made FOR rather than for a byte count — and it re-derives the sha256 of every
 * inline script the served page carries, comparing it against the policy the
 * server actually SENDS. BLOCKED=0 is the line that matters; reading .htaccess
 * would only say what the repository thinks.
 */

$COMMIT = 'ec28737';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

/* .htaccess FIRST so the policy never lags the page it describes; the rest in
   any order. All inside one run, so the ordering is belt and braces. */
$FILES = [
    '.htaccess'              => 'd17d1cfb1ae113c88fa24fa49992b03fbf341ad7cbcb2c521390c93020c60d82',
    'index.html'             => 'b82f3db62bcedbd90f4fa177ae81d227673a285bf3b8705ead1f30159ca3aed8',
    'assets/sporta-ui.css'   => '8f65d85a6176ce50e92c448090af4caa6bb59ca212ca5b33c70ff915d639c6bf',
    'assets/sporta-dark.css' => '0ea59b2c0ef1638e42c54839b43c42c24dadb511cc18fd293d21c9bfbadb096a',
    'api/store.php'          => 'faf516e0c4b35fb41384f7bad53bead72bdac43a44edbddbf0262fbad5cb5c62',
    'api/seed.mysql.sql'     => 'bd51a938063ff63d7fb381290c42196ffde93d9d5b065f5da6bac3d10b7f0d88',
    'api/install.mysql.sql'  => 'a2e3fc99c8286ee94fc176b256345b81bb111292fb99fc1af21cddb51deafbae',
    'api/brands.mysql.sql'   => '7f781441054267db1cfb90a356cfdc8817d62d80670ced83d9ba0be047bba110',
    // THE BUMP, and the only file in this list that is not already live. A fix
    // to sw.js's RULES reaches new arrivals; the VERSION is what drops the
    // caches of a browser still running the previous worker, which is where a
    // stale sporta-ui.css actually sits. See test:sw-version.
    'sw.js'                  => '0d893edb4a80db8325c2b634cc1ee3f2467df727a1648d74e7ed4e62954fca6d',
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

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

/** What the live server serves for a path, with its headers. The public name is
 *  used only as a Host header — see CLAUDE.md on why this form keeps working
 *  whether or not the domain resolves. */
$serve = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Host: www.sporta.com.kw'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $out  = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [substr($out, 0, $size), substr($out, $size)];
};

[$headHtml, $html] = $serve('/');
[, $ui]            = $serve('/assets/sporta-ui.css');
[, $dark]          = $serve('/assets/sporta-dark.css');

/* Does the policy the server SENDS name the inline scripts the page CARRIES?
   Anything but 0 is the boot script silently refused. */
$declared = [];
if (preg_match('/content-security-policy:.*/i', $headHtml, $m)) {
    preg_match_all("/'(sha256-[A-Za-z0-9+\/=]+)'/", $m[0], $d);
    $declared = $d[1];
}
preg_match_all('/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/s', $html, $s);
$blocked = 0;
foreach ($s[1] as $b) {
    if (!in_array('sha256-' . base64_encode(hash('sha256', $b, true)), $declared, true)) $blocked++;
}

echo 'PENDING wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' inlineScripts=' . count($s[1]) . ' cspHashes=' . count($declared) . ' BLOCKED=' . $blocked
   . ' heroFloor=' . (strpos($ui, 'min-height: calc(100vw / 2.52)') !== false ? 'ok' : 'MISSING')
   . ' heroShell=' . (strpos($html, 'max(calc(100vw / 2.52), min(calc(100vw / 1.90), 60svh))') !== false ? 'ok' : 'MISSING')
   . ' darkPinGone=' . (strpos($html, "setItem('sporta_theme', 'dark')") === false ? 'ok' : 'STILL-PINNED')
   . ' toggleShown=' . (strpos($dark, "aria-label='الوضع الفاتح'") === false ? 'ok' : 'STILL-HIDDEN')
   . ' dotFix=' . (strpos($dark, "[aria-current='true'] > .bg-brand") !== false ? 'ok' : 'MISSING')
   // store.php is never served, so it is read from disk by absolute path —
   // reading it back by any relative name would prove nothing about the file
   // the shop actually loads.
   . ' sessionGc=' . (strpos(@file_get_contents($ROOT . '/api/store.php') ?: '',
                             "ini_set('session.gc_maxlifetime'") !== false ? 'ok' : 'MISSING')
   // The version the SERVER serves, not the one on disk: this is the string a
   // returning browser compares against its own worker, and the whole point.
   . ' swVersion=' . (preg_match("/const VERSION = '([^']+)'/", $serve('/sw.js')[1], $m) ? $m[1] : 'UNREADABLE')
   . "\n";
