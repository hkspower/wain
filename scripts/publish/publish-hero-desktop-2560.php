<?php
/**
 * WRITES to the live database: the DESKTOP picture of the five neutral hero slides, 3200px -> 2560px.
 * 2026-10-14, a technical fix — nothing a visitor sees changes except the bytes.
 *
 *   wget -nv -O r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/publish-hero-desktop-2560.php && php r.php
 *
 * WHY. Every desktop and tablet is sent the 3200x1270 master (crossfit alone 328 kB, 760 kB for the
 * five), and the masters carry almost no detail above ~2240px. 2560px is exactly what a 1280px window
 * draws at 2x; wider windows already upscaled the 3200 file. Re-encoded at q86 (sharp YUV) by
 * scripts/make-hero-desktop-2560.py: 378 kB for the five, 41-47 dB against a Lanczos 2560 of each
 * master. A slide is a ROW (hero_slides.image, a data: URI served by ?r=slide_image), so this is a
 * database write, like publish-hero-neutral.php.
 *
 * WHAT IT TOUCHES, AND WHAT IT NEVER TOUCHES.
 *  - Only `image`, `image_hash`, `image_w`, `image_h` of a row whose desktop picture IS, byte for byte,
 *    one of the five 3200 masters publish-hero-neutral.php wrote. The bytes are decoded out of the row
 *    and hashed — the hash column alone is not trusted. Phone picture, focal point, titles, button,
 *    order and active are left exactly as they are.
 *  - A row carrying anything else (the owner has replaced that picture, or it was never the neutral
 *    one) is reported `untouched` and not written. A row already carrying the 2560 file reads
 *    `already-2560`, so a re-run is harmless.
 *  - Each artefact is fetched from $COMMIT by its FULL sha (an abbreviated one 404s, silently empty),
 *    one at a time, and must answer 200, match its recorded sha256, be a WEBP and be 2560x1016 before
 *    anything is written.
 *  - The replaced 3200 bytes are saved FIRST, one file per row, to a timestamped directory in the
 *    account's home, OUTSIDE the docroot (0700, files 0600), and read back by sha256; no backup, no
 *    write. Undo = put those bytes back (or re-run publish-hero-neutral.php's shape with the masters,
 *    which are still in the repository).
 *  - The write is guarded on the old hash, so a panel save in the same moment is not overwritten.
 *
 * REPORTS STATE, not its verb: the last line reads the same on every run of a `* * * * *` job —
 * `HERO2560 at2560=5/5 …` whether this run or an earlier one did the work. Delete the job after the
 * first output. The URL changes with the hash (`?v=` is its first 16 characters), so browsers fetch
 * the new file at once, and seo.php's first-frame preload follows the row on the next page load.
 *
 * $COMMIT pins the ARTEFACTS (the commit that added them). Fetch this script from HEAD.
 *
 * LOCAL TEST MODE, never on the live server: only when the live docroot does not exist do
 * SPORTA_CONFIG_FILE, SPORTA_BACKUP_DIR and SPORTA_ARTEFACT_DIR (artefacts read from a directory
 * instead of fetched) decide where it reads and writes.
 */
declare(strict_types=1);

$COMMIT = '8fab5f02056809485ace6a8be18693e06bc197ac';
const LIVE_DOCROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
const LIVE_HOME    = '/home/u130124229';

// name => [the 3200 master's sha256 (publish-hero-neutral.php), the 2560 file's sha256]
$SWAPS = [
    'crossfit'   => ['3cfbd88622884ba9cc1db7b15048ce391868be0481ecb4992c8c900ac1ed8f46', 'adff55356fd474999a7c95a8979df632f15c296d3637751965c89df82ddeb97e'],
    'features'   => ['79adcfd9075dea0c19ebd3d44ce94dec427555502192e8b8ed3065b1e7609018', 'e394df80909a07e9680d5dfcc82fa420d469099b8a04cc38f50ca994cd9937c2'],
    'runner'     => ['fae0112c1ea5ebe2565eebabbe06f9c0318757a8fa736e37eaaf28c63ba23a9f', '77ab133b8292d0833e58dbd023a64929e3b08957d9e6dde4c9fa583966cd7b6e'],
    'activewear' => ['aad2f59f893eb2d3fab2ee04f160b97fdbbb925e742fb430b2b7545cd9094e3b', '5e4b9b2338e92d84193e5215875ad19fb96cd2895748fb805240702b0b34e4a7'],
    'training'   => ['1c113245a75cd13f5cb0100e3d675b22840b491e6c932d8fc97a39cd2a6f0581', '648e68675298eba3c42e6f3886daf4dc3a4f099e4b097d8d84b49e9c6c447a02'],
];
const W = 2560, H = 1016;

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$STATE = 'HERO2560 UNKNOWN (the run stopped before it measured)';
register_shutdown_function(static function () use (&$STATE): void {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) line('FAILED fatal at line ' . $e['line']);
    line($STATE);
});

$local   = !is_dir(LIVE_DOCROOT);
$cfgFile = $local ? (string) getenv('SPORTA_CONFIG_FILE') : LIVE_DOCROOT . '/api/config.php';
$bakRoot = $local ? (string) getenv('SPORTA_BACKUP_DIR') : LIVE_HOME;
$artDir  = $local ? (string) getenv('SPORTA_ARTEFACT_DIR') : '';
line('HERO2560 publish-hero-desktop-2560 ' . gmdate('Y-m-d\TH:i:s\Z') . ($local ? ' LOCAL-TEST' : '') . ' commit=' . substr($COMMIT, 0, 12));
if ($cfgFile === '' || $bakRoot === '' || ($local && $artDir === '')) { $STATE = 'HERO2560 REFUSED-no-paths'; exit; }
if (!preg_match('/^[0-9a-f]{40}$/', $COMMIT)) { $STATE = 'HERO2560 REFUSED-commit-not-a-full-sha'; exit; }

/** Width and height out of a webp's own header (VP8, VP8L or VP8X), or null. */
function webp_size(string $b): ?array {
    if (strlen($b) < 30 || substr($b, 0, 4) !== 'RIFF' || substr($b, 8, 4) !== 'WEBP') return null;
    $c = substr($b, 12, 4);
    if ($c === 'VP8X') { $w = unpack('V', substr($b, 24, 3) . "\0")[1] + 1; $h = unpack('V', substr($b, 27, 3) . "\0")[1] + 1; return [$w, $h]; }
    if ($c === 'VP8 ') return [unpack('v', substr($b, 26, 2))[1] & 0x3fff, unpack('v', substr($b, 28, 2))[1] & 0x3fff];
    if ($c === 'VP8L') { $n = unpack('V', substr($b, 21, 4))[1]; return [($n & 0x3fff) + 1, (($n >> 14) & 0x3fff) + 1]; }
    return null;
}
function artefact(string $name, string $sha, string $commit, string $artDir): ?string {
    $file = $name . '-neutral-desktop-2560.webp';
    if ($artDir !== '') {
        $b = @file_get_contents(rtrim($artDir, '/') . '/' . $file);
        $code = is_string($b) ? 200 : 0;
    } else {
        $ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $commit . '/sporta-site/assets/hero/' . $file);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => true]);
        $b = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    }
    if (!is_string($b) || $code !== 200 || $b === '') { line("  $name fetch=FAILED http=$code"); return null; }
    if (!hash_equals($sha, hash('sha256', $b))) { line("  $name HASH-MISMATCH"); return null; }
    if (webp_size($b) !== [W, H]) { line("  $name NOT-A-" . W . 'x' . H . '-WEBP'); return null; }
    return $b;
}
/** The bytes inside a stored data: URI, or null. */
function bytes_of(?string $uri): ?string {
    if (!is_string($uri) || !preg_match('#^data:image/(?:png|jpeg|webp);base64,(.+)$#s', $uri, $m)) return null;
    $b = base64_decode($m[1], true);
    return $b === false ? null : $b;
}

$cfg = @include $cfgFile;
if (!is_array($cfg)) { $STATE = 'HERO2560 REFUSED-config-unreadable'; exit; }
try {
    $pdo = new PDO('mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . ($cfg['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { $STATE = 'HERO2560 REFUSED-connect ' . get_class($e) . '/' . $e->getCode(); exit; }

$swapped = 0; $already = 0; $untouched = 0; $failed = 0; $before = 0; $after = 0; $bakDir = '';
try {
    foreach ($SWAPS as $name => [$master, $new]) {
        $q = $pdo->prepare('select id, active from hero_slides where image_hash = ?');
        $q->execute([$new]);
        if ($r = $q->fetch(PDO::FETCH_ASSOC)) { line("SLIDE $name id={$r['id']} active={$r['active']} already-2560"); $already++; continue; }
        $q = $pdo->prepare('select id, active, image, image_w, image_h from hero_slides where image_hash = ?');
        $q->execute([$master]);
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) { line("SLIDE $name untouched (no row carries the 3200 master: replaced, or never the neutral one)"); $untouched++; continue; }
        foreach ($rows as $r) {
            $id = (int) $r['id'];
            $old = bytes_of($r['image']);
            if ($old === null || !hash_equals($master, hash('sha256', $old))) { line("SLIDE $name id=$id untouched REFUSED-bytes-are-not-the-master"); $untouched++; continue; }
            $b = artefact($name, $new, $COMMIT, $artDir);
            if ($b === null) { $failed++; continue; }
            // the backup, verified before anything is written
            if ($bakDir === '') {
                $bakDir = rtrim($bakRoot, '/') . '/hero-desktop-3200-backup-' . gmdate('Ymd-His') . 'Z';
                if (!is_dir($bakDir) && !@mkdir($bakDir, 0700, true)) { $STATE = 'HERO2560 REFUSED-backup-dir ' . $bakDir; exit; }
                @chmod($bakDir, 0700);
            }
            $bak = $bakDir . '/slide-' . $id . '-' . $name . '-3200.webp';
            $ok = @file_put_contents($bak, $old, LOCK_EX) === strlen($old);
            @chmod($bak, 0600);
            $back = $ok ? @file_get_contents($bak) : false;
            if (!is_string($back) || !hash_equals($master, hash('sha256', $back))) { line("SLIDE $name id=$id REFUSED-backup-not-written $bak"); $failed++; continue; }
            $u = $pdo->prepare('update hero_slides set image = ?, image_hash = ?, image_w = ?, image_h = ? where id = ? and image_hash = ?');
            $u->execute(['data:image/webp;base64,' . base64_encode($b), $new, W, H, $id, $master]);
            if ($u->rowCount() !== 1) { line("SLIDE $name id=$id changed-meanwhile (untouched)"); $untouched++; continue; }
            line("SLIDE $name id=$id active={$r['active']} swapped " . strlen($old) . ' -> ' . strlen($b) . " bytes backup=$bak");
            $swapped++; $before += strlen($old); $after += strlen($b);
        }
    }
    // STATE, read back from the rows: how many of the five carry the 2560 file, bytes and dimensions verified
    $at = 0; $live = 0;
    $q = $pdo->prepare('select active, image, image_w, image_h from hero_slides where image_hash = ?');
    foreach ($SWAPS as $name => [, $new]) {
        $q->execute([$new]);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $b = bytes_of($r['image']);
            if ($b !== null && hash_equals($new, hash('sha256', $b)) && (int) $r['image_w'] === W && (int) $r['image_h'] === H) { $at++; if ((int) $r['active'] === 1) $live++; }
        }
    }
    $STATE = "HERO2560 at2560=$at/5 active=$live this-run: swapped=$swapped already=$already untouched=$untouched failed=$failed"
           . ($swapped ? " bytes=$before->$after backup=$bakDir" : '');
} catch (Throwable $e) {
    $STATE = 'HERO2560 FAILED ' . get_class($e) . '/' . $e->getCode();
}
