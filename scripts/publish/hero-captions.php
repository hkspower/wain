<?php
/**
 * WRITES to the live database: a headline, a subtitle and a "Shop now" button
 * on each hero slide, asked for on 2026-09-24 ("improve hero images design",
 * option "Text + Shop button").
 *
 *   wget -qO p.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/hero-captions.php && php p.php
 *
 * THE WORDS ARE A STARTING POINT, NOT A DECISION. The owner edits every one of
 * these in /backends → Settings → hero slides, and this script never touches a
 * slide that already carries a headline in either language. Run it twice and
 * the second run changes nothing; run it after the owner has written their own
 * and it changes nothing either.
 *
 * EACH CAPTION IS TIED TO ITS PICTURE, by the first 16 characters of the
 * slide's image hash. "Ready to train" was written for the man in the tank
 * top; if the owner has since replaced that photograph, the caption would
 * describe a picture that is not there. A hash that does not match is
 * reported as `skipped-different-image` and nothing is written to it.
 *
 * Reports STATE, not its own verb, so the reading is the same on every run
 * of a `* * * * *` job: `title=set` whether this run wrote it or an earlier
 * one did. Delete the job after the first output.
 */

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfg = @include '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_array($cfg)) { line('FAILED config unreadable'); exit; }

try {
    $db = new PDO('mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . ($cfg['db_name'] ?? '') . ';charset=utf8mb4',
                  (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
                  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    line('FAILED connect: ' . get_class($e));
    exit;
}

$CAPTIONS = [
    // image hash prefix => [title_ar, title_en, subtitle_ar, subtitle_en]
    '20f9508f1f28500e' => ['انطلق بقوة',   'Built to move',      'ملابس أداء لكل يوم',     'Performance wear for every day'],
    'e8cf8307ae182263' => ['قوتك بأسلوبك', 'Strength, your way', 'تشكيلة النساء الجديدة', "The new women's collection"],
    '1fc04cc9840a7ff9' => ['جاهز للتمرين', 'Ready to train',     'ملابس تدريب رجالية',     "Men's training wear"],
];

$rows = $db->query('select id, active, left(image_hash, 16) h, title_ar, title_en from hero_slides order by sort, id')
           ->fetchAll(PDO::FETCH_ASSOC);
line('slides=' . count($rows));

$upd = $db->prepare(
    "update hero_slides set title_ar = ?, title_en = ?, subtitle_ar = ?, subtitle_en = ?,
            cta_label_ar = 'تسوق الآن', cta_label_en = 'Shop now', cta_href = '/shop'
      where id = ? and title_ar is null and title_en is null"
);

foreach ($rows as $r) {
    $id = (int) $r['id'];
    $had = ($r['title_ar'] ?? '') !== '' || ($r['title_en'] ?? '') !== '';
    if (!$had && isset($CAPTIONS[$r['h']])) {
        [$tar, $ten, $sar, $sen] = $CAPTIONS[$r['h']];
        $upd->execute([$tar, $ten, $sar, $sen, $id]);
    }
    $now = $db->prepare('select title_ar, title_en, cta_href from hero_slides where id = ?');
    $now->execute([$id]);
    $n = $now->fetch(PDO::FETCH_ASSOC) ?: [];
    $set = ($n['title_ar'] ?? '') !== '' && ($n['title_en'] ?? '') !== '';
    // By CONTENT, not by whether this run wrote it: the second tick of the job
    // must read the same as the first.
    $ours = isset($CAPTIONS[$r['h']]) && ($n['title_en'] ?? '') === $CAPTIONS[$r['h']][1];
    $state = !$set
        ? (isset($CAPTIONS[$r['h']]) ? 'title=EMPTY' : 'skipped-different-image')
        : ($ours ? 'title=ours cta=' . ($n['cta_href'] ?? '?') : 'title=owner-written(untouched)');
    line('slide id=' . $id . ' active=' . (int) $r['active'] . ' img=' . $r['h'] . ' ' . $state);
}
