<?php
/**
 * Cleaner backdrops for four hero slides — 2026-09-29, "improve hero slide
 * backgrounds quality", approved from before/after images.
 *
 *   wget -nv -O c.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-hero-clean.php && php c.php
 *
 * WHAT CHANGED IN THE PICTURES. Built to move, Strength your way and Ready to
 * train had dark studio backdrops full of blotchy compression patches, and
 * were stored at 3200px with only ~1600px of real detail. Their backdrop, away
 * from the athlete and the floor shadow, is smoothed and re-grained at the
 * full 3200px; the athlete and shadow are untouched. Sporta Features had a
 * dark smear and a flat grey right half; its backdrop is repainted as one
 * studio gradient in its own colours, desktop and phone.
 *
 * IN PLACE, BY FINGERPRINT. Each row is found by the image_hash it has NOW and
 * only its picture columns change, so the slide keeps its title, captions,
 * button, focal point and order. A row already carrying the new hash is
 * reported as done, so a re-run is harmless. A new hash is also a new
 * ?r=slide_image URL, so no browser keeps the old picture.
 *
 * UNDO: the old pictures are in this repository (assets/hero/sportswear-*.webp
 * and sporta-site/assets/hero/features-*.webp); swap OLD and NEW below.
 *
 * $COMMIT pins the ARTWORK. Fetch this script from HEAD.
 */

$COMMIT = 'REPLACE_WITH_ART_COMMIT';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/assets/hero/';

// [old desktop hash, new file, new sha, w, h, mobile file|null, mobile sha|null, mw, mh]
$SWAPS = [
    ['20f9508f1f28500ef237804ca4048bb7ddbcb7ef92a30e1f697faa541ff993c2', 'runner-clean.webp',
     'c48773054fbac2408127d2626e36bb58dd95445f40be05438ed634d5e04f5d90', 3200, 1270, null, null, 0, 0],
    ['e8cf8307ae182263251f4a8b74a8d3e16f7751c890b9669c337f20310e7b75a4', 'activewear-clean.webp',
     '08c42cf6ddd600c76f15402806ad923a44b7c63f3ec144f58fe63e52495aa838', 3200, 1270, null, null, 0, 0],
    ['1fc04cc9840a7ff9346e75a05929555352534fcc00f4fd37f38724c5d9ade0f8', 'training-clean.webp',
     '728c64876a1ad0bafbacacbe4f73cbfde4f2fc8b0af60c2e82672c05aedac025', 3200, 1270, null, null, 0, 0],
    ['aa81344ff4219c57bf9000651afc61cb43a53de486b12ccc848d976359229a86', 'features-clean-desktop.webp',
     'd7d15398ceb8b007048a534e1c6b87861d7a9ac2c325eed6180ac436f56abe64', 3200, 1270,
     'features-clean-mobile.webp', '7621999aa0dee00187fb704cd5b4748fb068708dc5cfd3cea291df99017e9884', 1200, 476],
];

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

function fetch_webp(string $url, string $sha): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => true]);
    $b = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!is_string($b) || $code !== 200) { line("  fetch FAILED http=$code " . basename($url)); return null; }
    if (hash('sha256', $b) !== $sha) { line('  HASH-MISMATCH ' . basename($url)); return null; }
    if (substr($b, 0, 4) !== 'RIFF' || substr($b, 8, 4) !== 'WEBP') { line('  NOT-A-WEBP ' . basename($url)); return null; }
    return $b;
}

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('HEROCLEAN db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('HEROCLEAN db=ERROR'); return; }

$done = 0; $swapped = 0; $missing = 0;
foreach ($SWAPS as [$old, $file, $sha, $w, $h, $mfile, $msha, $mw, $mh]) {
    $now = $pdo->prepare('select id from hero_slides where image_hash = ?');
    $now->execute([$sha]);
    if ($id = $now->fetchColumn()) { line("SLIDE $file id=$id already-clean"); $done++; continue; }

    $find = $pdo->prepare('select id from hero_slides where image_hash = ?');
    $find->execute([$old]);
    $id = $find->fetchColumn();
    if (!$id) { line("SLIDE $file old-row-NOT-FOUND " . substr($old, 0, 10)); $missing++; continue; }

    $b = fetch_webp($BASE . $file, $sha);
    if ($b === null) continue;
    $uri = 'data:image/webp;base64,' . base64_encode($b);
    if (strlen($uri) > 1200000) { line("SLIDE $file TOO-LARGE"); continue; }

    if ($mfile) {
        $m = fetch_webp($BASE . $mfile, $msha);
        if ($m === null) continue;
        $muri = 'data:image/webp;base64,' . base64_encode($m);
        $pdo->prepare('update hero_slides set image = ?, image_hash = ?, image_w = ?, image_h = ?,
                              image_mobile = ?, image_mobile_hash = ?, image_mobile_w = ?, image_mobile_h = ?
                        where id = ?')
            ->execute([$uri, $sha, $w, $h, $muri, $msha, $mw, $mh, $id]);
    } else {
        $pdo->prepare('update hero_slides set image = ?, image_hash = ?, image_w = ?, image_h = ? where id = ?')
            ->execute([$uri, $sha, $w, $h, $id]);
    }
    line("SLIDE $file id=$id swapped");
    $swapped++;
}
// STATE, not the verb: this reads the same on every run.
$clean = 0;
$q = $pdo->prepare('select count(*) from hero_slides where image_hash = ? and active = 1');
foreach ($SWAPS as $s) { $q->execute([$s[2]]); $clean += (int) $q->fetchColumn(); }
line("HEROCLEAN swapped=$swapped alreadyClean=$done notFound=$missing activeCleanSlides=$clean/4");
