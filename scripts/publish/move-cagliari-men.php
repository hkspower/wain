<?php
// 2026-10-03: the owner chose Men for the Cagliari Calcio sweatshirt (it was 'women' after the
// jackets move, or 'outerwear'). Guarded by slug and by "not already men", so a second run changes
// nothing. Men is exchangeable, which is what the Instagram caption already says. Reports STATE.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
$db = store_db();
$slug = 'cagliari-calcio-sweatshirt-navy';
$st = $db->prepare("update products set category = 'men' where slug = ? and category <> 'men'");
$st->execute([$slug]);
$q = $db->prepare('select category, active from products where slug = ?');
$q->execute([$slug]);
$r = $q->fetch(PDO::FETCH_ASSOC);
echo 'STATE changedThisRun=' . $st->rowCount() . ' category=' . ($r['category'] ?? 'MISSING') . ' active=' . ($r['active'] ?? '-') . "\n";
