<?php
/**
 * Update the CrossFit hero slide's title and subtitle — asked for as
 * "change hero text to TRAIN HARD. LOOK BETTER. / Premium sportswear
 * delivered across Kuwait", with the Arabic translated to match rather than
 * left stale, per the owner's own choice when asked.
 *
 * IDENTIFIED BY THE ARTWORK'S OWN HASH, same as publish-crossfit-hero-slide.php
 * used to CREATE this row — not by id, which is a value this script has to be
 * TOLD rather than one it can verify. A hash mismatch means "this is not the
 * slide I think it is" and refuses rather than editing the wrong row's text.
 *
 * TEXT ONLY. Neither image column, neither dimension, neither focal point is
 * touched — this can only ever change four varchar columns on one row it has
 * already confirmed by hash.
 *
 * IDEMPOTENT AND REPORTS STATE, same reasoning as the slide publisher: a
 * per-minute cron job keeps the LAST run's output, so this prints the row's
 * current text whether it just wrote it or found it already there.
 */

$DESKTOP_SHA = '355f09f5eec8db5f9ca195b946c075eeb89f2aee9b3cacdb677a9178bd8b2c9a';

$TITLE_EN    = 'TRAIN HARD. LOOK BETTER.';
$TITLE_AR    = 'تدرّب بجد. اظهر بمظهر أفضل.';
$SUBTITLE_EN = 'Premium sportswear delivered across Kuwait';
$SUBTITLE_AR = 'ملابس رياضية فاخرة، توصيل إلى جميع محافظات الكويت';

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "TEXT db=NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );

    $find = $pdo->prepare('select id from hero_slides where image_hash = ?');
    $find->execute([$DESKTOP_SHA]);
    $id = $find->fetchColumn();
    if ($id === false) { echo "TEXT slide=NOT-FOUND hash=" . substr($DESKTOP_SHA, 0, 12) . "\n"; return; }
    $id = (int) $id;

    $pdo->prepare(
        'update hero_slides set title_en = ?, title_ar = ?, subtitle_en = ?, subtitle_ar = ?
          where id = ?'
    )->execute([$TITLE_EN, $TITLE_AR, $SUBTITLE_EN, $SUBTITLE_AR, $id]);

    $q = $pdo->prepare('select active, title_en, title_ar, subtitle_en, subtitle_ar from hero_slides where id = ?');
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);

    echo "TEXT id=$id active={$s['active']} title_en=\"{$s['title_en']}\""
       . " title_ar=\"{$s['title_ar']}\" subtitle_en=\"{$s['subtitle_en']}\""
       . " subtitle_ar=\"{$s['subtitle_ar']}\"\n";
} catch (Throwable $e) {
    echo "TEXT db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
