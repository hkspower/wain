<?php
/**
 * THE GENERATED ART COMES BACK — 2026-10-04 ("undo use ai generate for hero and slide and category";
 * the owner chose: bring the generated art back, re-rendered). The reverse of compose-own-photo-art.php.
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/restore-generated-art.php && php c.php
 *
 *  1. CATEGORY TILES: the category_art rows the own-photo publisher wrote are DELETED, so the four tiles
 *     fall back to the shipped files in /cats/ — the generated art, re-encoded at higher quality and
 *     published by publish-all.php (run that FIRST, so the files on disk are the new ones).
 *  2. HERO: the five generated neutral slides (matched by image hash) are switched back ON; the own-photo
 *     slides (no title, a category link, not one of the five) are switched OFF — not deleted, so
 *     `active = 1` brings either set back.
 *  3. The features band picture is a CSS change in assets/trust-strip.js, published by publish-all.
 *
 * IDEMPOTENT, reports STATE, writes nothing else.
 */
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';

const GENERATED_HERO = [   // the five neutral slides of 2026-10-01 (desktop image hashes), as compose-own-photo-art.php lists them
    'fae0112c1ea5ebe2565eebabbe06f9c0318757a8fa736e37eaaf28c63ba23a9f',
    'aad2f59f893eb2d3fab2ee04f160b97fdbbb925e742fb430b2b7545cd9094e3b',
    '1c113245a75cd13f5cb0100e3d675b22840b491e6c932d8fc97a39cd2a6f0581',
    '79adcfd9075dea0c19ebd3d44ce94dec427555502192e8b8ed3065b1e7609018',
    '3cfbd88622884ba9cc1db7b15048ce391868be0481ecb4992c8c900ac1ed8f46',
];
const OWN_HREFS = ['/women', '/men'];

try {
    $db = store_db();
    // 1. tiles
    $rows = 0;
    try { $rows = (int) $db->query('select count(*) from category_art')->fetchColumn(); } catch (Throwable $e) { line('category_art: no table (tiles are the shipped files already)'); }
    if ($rows > 0) { $db->exec('delete from category_art'); }
    $left = 0; try { $left = (int) $db->query('select count(*) from category_art')->fetchColumn(); } catch (Throwable $e) {}
    // 2. hero
    $in = implode(',', array_fill(0, count(GENERATED_HERO), '?'));
    $db->prepare("update hero_slides set active = 1 where image_hash in ($in)")->execute(GENERATED_HERO);
    $hin = implode(',', array_fill(0, count(OWN_HREFS), '?'));
    $db->prepare("update hero_slides set active = 0 where cta_href in ($hin) and coalesce(title_en,'') = '' and coalesce(title_ar,'') = '' and image_hash not in ($in)")
       ->execute([...OWN_HREFS, ...GENERATED_HERO]);
    $q = $db->prepare("select count(*) from hero_slides where image_hash in ($in) and active = 1"); $q->execute(GENERATED_HERO);
    $genOn = (int) $q->fetchColumn();
    $q = $db->prepare("select count(*) from hero_slides where cta_href in ($hin) and coalesce(title_en,'') = '' and coalesce(title_ar,'') = '' and image_hash not in ($in) and active = 1");
    $q->execute([...OWN_HREFS, ...GENERATED_HERO]); $ownOn = (int) $q->fetchColumn();
    $active = (int) $db->query('select count(*) from hero_slides where active = 1')->fetchColumn();
    line("STATE categoryArtRows=$left generatedSlidesOn=$genOn/5 ownPhotoSlidesOn=$ownOn activeSlides=$active");
    line($left === 0 && $genOn === 5 && $ownOn === 0 ? 'DONE — the generated tiles and slides are showing again.' : 'NOT DONE — read the counts above.');
} catch (Throwable $e) {
    line('FAILED: ' . $e->getMessage());
}
