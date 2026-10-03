<?php
// 2026-10-03, owner: "تبديل يومين فقط approve" — the exchange window becomes 2 days (rules.return_days,
// the same row /backends -> Shop rules writes; rules-live.js rewrites the shop's copy from it), and
// the approved description drafts are saved for the 29 products. Only desc_en/desc_ar change.
// Idempotent; reports STATE.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
$db = store_db();
$row = $db->query("select value from settings where name = 'rules'")->fetchColumn();
$rules = is_string($row) ? (json_decode($row, true) ?: []) : [];
$rules['return_days'] = 2;
$db->prepare("insert into settings (name, value) values ('rules', ?) on duplicate key update value = values(value)")
   ->execute([json_encode($rules, JSON_UNESCAPED_UNICODE)]);
$descs = json_decode(<<<'JSON'
[
 {
  "slug": "cagliari-calcio-sweatshirt-navy",
  "desc_en": "The Cagliari Calcio sweatshirt in navy, for supporters of the Italian football club. A comfortable layer for match days, travel and everyday wear.",
  "desc_ar": "سويت شيرت كالياري كالتشو باللون الكحلي لمشجعي النادي الإيطالي. طبقة مريحة ليوم المباراة والسفر ويومك العادي."
 },
 {
  "slug": "cloudsoft-jacket-army-green",
  "desc_en": "A Cloudsoft jacket in army green to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Cloudsoft pieces for a complete set.",
  "desc_ar": "جاكيت كلاودسوفت باللون الأخضر العسكري، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع كلاودسوفت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "cloudsoft-jacket-cherry-red",
  "desc_en": "A Cloudsoft jacket in cherry red to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Cloudsoft pieces for a complete set.",
  "desc_ar": "جاكيت كلاودسوفت باللون الأحمر الكرزي، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع كلاودسوفت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "cloudsoft-jacket-coffee-brown",
  "desc_en": "A Cloudsoft jacket in coffee brown to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Cloudsoft pieces for a complete set.",
  "desc_ar": "جاكيت كلاودسوفت باللون البني القهوة، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع كلاودسوفت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "cloudsoft-leggings-army-green",
  "desc_en": "Cloudsoft leggings in army green, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون الأخضر العسكري، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-leggings-cherry-red",
  "desc_en": "Cloudsoft leggings in cherry red, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون الأحمر الكرزي، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-leggings-coffee-brown",
  "desc_en": "Cloudsoft leggings in coffee brown, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون البني القهوة، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-leggings-grey",
  "desc_en": "Cloudsoft leggings in grey, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون الرمادي، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-leggings-navy",
  "desc_en": "Cloudsoft leggings in navy, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون الكحلي، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-leggings-onyx-black",
  "desc_en": "Cloudsoft leggings in onyx black, made to move with you through training, yoga and everyday wear. Pair them with the matching Cloudsoft top or jacket for a full set.",
  "desc_ar": "ليقنز كلاودسوفت باللون الأسود الأونيكس، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-top-grey",
  "desc_en": "A Cloudsoft top in grey for training and everyday wear. Pair it with the matching Cloudsoft leggings for a full set.",
  "desc_ar": "توب كلاودسوفت باللون الرمادي للتمرين ويومك العادي. نسّقيه مع ليقنز كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-top-navy",
  "desc_en": "A Cloudsoft top in navy for training and everyday wear. Pair it with the matching Cloudsoft leggings for a full set.",
  "desc_ar": "توب كلاودسوفت باللون الكحلي للتمرين ويومك العادي. نسّقيه مع ليقنز كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "cloudsoft-top-onyx-black",
  "desc_en": "A Cloudsoft top in onyx black for training and everyday wear. Pair it with the matching Cloudsoft leggings for a full set.",
  "desc_ar": "توب كلاودسوفت باللون الأسود الأونيكس للتمرين ويومك العادي. نسّقيه مع ليقنز كلاودسوفت المطابق لطقم متكامل."
 },
 {
  "slug": "define-jacket-iris-purple",
  "desc_en": "A Define jacket in iris purple to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Define pieces for a complete set.",
  "desc_ar": "جاكيت ديفاين باللون البنفسجي، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع ديفاين المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "define-jacket-onyx-black",
  "desc_en": "A Define jacket in onyx black to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Define pieces for a complete set.",
  "desc_ar": "جاكيت ديفاين باللون الأسود الأونيكس، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع ديفاين المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "define-jacket-steel-grey",
  "desc_en": "A Define jacket in steel grey to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Define pieces for a complete set.",
  "desc_ar": "جاكيت ديفاين باللون الرمادي الفولاذي، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع ديفاين المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "sculpt-jacket-black",
  "desc_en": "A Sculpt jacket in black to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Sculpt pieces for a complete set.",
  "desc_ar": "جاكيت سكالبت باللون الأسود، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع سكالبت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "sculpt-jacket-grey",
  "desc_en": "A Sculpt jacket in grey to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Sculpt pieces for a complete set.",
  "desc_ar": "جاكيت سكالبت باللون الرمادي، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع سكالبت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "sculpt-jacket-navy",
  "desc_en": "A Sculpt jacket in navy to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Sculpt pieces for a complete set.",
  "desc_ar": "جاكيت سكالبت باللون الكحلي، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع سكالبت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "sculpt-jacket-taupe-brown",
  "desc_en": "A Sculpt jacket in taupe brown to layer over your training top for warm-ups, cool-downs and everyday wear. Pair it with the matching Sculpt pieces for a complete set.",
  "desc_ar": "جاكيت سكالبت باللون البني الفاتح، يُلبس فوق توب التمرين في الإحماء والتهدئة وفي يومك العادي. نسّقيه مع قطع سكالبت المطابقة لإطلالة متكاملة."
 },
 {
  "slug": "sculpt-leggings-black",
  "desc_en": "Sculpt leggings in black, made to move with you through training, yoga and everyday wear. Pair them with the matching Sculpt top or jacket for a full set.",
  "desc_ar": "ليقنز سكالبت باللون الأسود، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-leggings-grey",
  "desc_en": "Sculpt leggings in grey, made to move with you through training, yoga and everyday wear. Pair them with the matching Sculpt top or jacket for a full set.",
  "desc_ar": "ليقنز سكالبت باللون الرمادي، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-leggings-navy",
  "desc_en": "Sculpt leggings in navy, made to move with you through training, yoga and everyday wear. Pair them with the matching Sculpt top or jacket for a full set.",
  "desc_ar": "ليقنز سكالبت باللون الكحلي، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-leggings-taupe-brown",
  "desc_en": "Sculpt leggings in taupe brown, made to move with you through training, yoga and everyday wear. Pair them with the matching Sculpt top or jacket for a full set.",
  "desc_ar": "ليقنز سكالبت باللون البني الفاتح، يتحرك معكِ في التمرين واليوغا ويومك العادي. نسّقيه مع توب أو جاكيت سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-top-black",
  "desc_en": "A Sculpt top in black for training and everyday wear. Pair it with the matching Sculpt leggings for a full set.",
  "desc_ar": "توب سكالبت باللون الأسود للتمرين ويومك العادي. نسّقيه مع ليقنز سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-top-grey",
  "desc_en": "A Sculpt top in grey for training and everyday wear. Pair it with the matching Sculpt leggings for a full set.",
  "desc_ar": "توب سكالبت باللون الرمادي للتمرين ويومك العادي. نسّقيه مع ليقنز سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-top-navy",
  "desc_en": "A Sculpt top in navy for training and everyday wear. Pair it with the matching Sculpt leggings for a full set.",
  "desc_ar": "توب سكالبت باللون الكحلي للتمرين ويومك العادي. نسّقيه مع ليقنز سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "sculpt-top-taupe-brown",
  "desc_en": "A Sculpt top in taupe brown for training and everyday wear. Pair it with the matching Sculpt leggings for a full set.",
  "desc_ar": "توب سكالبت باللون البني الفاتح للتمرين ويومك العادي. نسّقيه مع ليقنز سكالبت المطابق لطقم متكامل."
 },
 {
  "slug": "vanquish-tank-navy",
  "desc_en": "The Vanquish tank in navy, a sleeveless training top that leaves your arms free for lifting, running and gym sessions.",
  "desc_ar": "تانك فانكويش باللون الكحلي، توب تمرين بدون أكمام يمنح ذراعيك حرية الحركة في رفع الأثقال والجري وتمارين النادي."
 }
]
JSON, true);
$up = $db->prepare('update products set desc_en = ?, desc_ar = ? where slug = ?');
$n = 0;
foreach ($descs as $d) { $up->execute([$d['desc_en'], $d['desc_ar'], $d['slug']]); $n += $up->rowCount(); }
$chk = $db->prepare('select count(*) from products where slug = ? and desc_en = ? and desc_ar = ?');
$ok = 0;
foreach ($descs as $d) { $chk->execute([$d['slug'], $d['desc_en'], $d['desc_ar']]); $ok += (int) $chk->fetchColumn(); }
store_settings(null, true);
echo 'STATE returnDays=' . store_rule($db, 'return_days') . ' descsMatching=' . $ok . '/' . count($descs) . ' changedThisRun=' . $n . "\n";
