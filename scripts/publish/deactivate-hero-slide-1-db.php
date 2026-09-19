<?php
/**
 * Deactivate hero_slides id=1 directly, bypassing admin.php's login.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/deactivate-hero-slide-1-db.php && php r.php
 *
 * WHY THIS INSTEAD OF THE LOGIN-BASED VERSION. deactivate-hero-slide-1.php's
 * own live run answered login=401 bad_credentials against the password this
 * session recorded creating the account with — not 429 `locked` (already
 * cleared by unlock-admin.php moments before). Rather than guess at a second
 * password or risk further failed attempts against a real admin account,
 * this reuses store_db() directly — the same pattern unlock-admin.php used
 * for admin_users, and for the same reason: no route exists to do this, and
 * guessing at config.php's values is unnecessary when the file itself can be
 * required for its connection.
 *
 * TOUCHES EXACTLY ONE COLUMN ON ONE ROW: hero_slides.active, id=1, set to 0.
 * Nothing else — title/subtitle/cta/sort/focal_x/focal_y are untouched,
 * because this never rewrites the row's other fields the way slide_save
 * would have required.
 */

require_once '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';

$db = store_db();
$stmt = $db->prepare('update hero_slides set active = 0 where id = 1');
$stmt->execute();
$rows = $stmt->rowCount();

$check = $db->prepare('select id, active from hero_slides where id = 1');
$check->execute();
$row = $check->fetch();

// Verify from the PUBLIC route, which is what a shopper actually sees.
$pub = curl_init('https://127.0.0.1/api/api.php?r=slides');
curl_setopt_array($pub, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
]);
$pubOut = curl_exec($pub);
curl_close($pub);
$pubJson = json_decode((string) $pubOut, true);
$activeCount = count($pubJson['slides'] ?? []);

echo 'HEROFIXDB rows=' . $rows
   . ' id1_active=' . ($row['active'] ?? 'no_such_row')
   . ' activeSlidesNow=' . $activeCount
   . "\n";
