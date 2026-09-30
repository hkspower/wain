<?php
/**
 * Deactivate hero_slides id=1 — the all-black photo banner.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/deactivate-hero-slide-1.php && php r.php
 *
 * WHY. ?r=slides measured live on 2026-09-16 returned exactly one active
 * row: id=1, no title/subtitle/cta (burnt into the artwork, per CLAUDE.md's
 * own account of publishing it on 2026-09-11), focal_x=15/focal_y=50. With
 * one active row the storefront shows ONLY this slide — the bundle falls
 * back to its five drawn slides only when hero_slides has ZERO active
 * rows — so every visitor has been seeing one static black photo instead
 * of the carousel, and on a phone that slide's own 2.52:1 aspect ratio
 * halves the hero's height below the md breakpoint (measured 390x155
 * against the drawn slides' 390x290), exactly the defect CLAUDE.md
 * recorded the day it was published.
 *
 * CLAUDE.md already named the fix in as many words: "Undoing the publish
 * is one statement: `update hero_slides set active = 0 where id = 1`."
 * This is that statement, run through admin.php's own slide_save route
 * rather than a bare SQL UPDATE, so validation, the update timestamp and
 * any other columns that route is responsible for stay consistent with
 * every other slide edit made through the panel.
 *
 * NOTHING ELSE ABOUT THE ROW CHANGES. Every other field is resent with its
 * OWN current value (read back from ?r=slides moments before this runs,
 * not hardcoded) — slide_save overwrites the full field set on an update,
 * so sending only `active` would have reset sort/focal_x/focal_y to their
 * defaults.
 *
 * REQUIRES AN ADMIN SESSION. Logs in with the account created this
 * session, signs out again in the same run — no cookie is left behind.
 */

$EMAIL = 'hkspower@live.com';
$PASS  = 'yempajshdh12333';

$jar = tempnam(sys_get_temp_dir(), 'ck');

$call = static function (string $route, ?array $body = null) use ($jar): array {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=' . $route);
    $headers = ['Host: www.sporta.com.kw', 'X-Sporta-Admin: 1'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_COOKIEJAR => $jar,
        CURLOPT_COOKIEFILE => $jar,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_POST => $body !== null,
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($out, true)];
};

[$lc] = $call('login', ['email' => $EMAIL, 'password' => $PASS]);

// Read the row's own current values rather than trusting what was measured
// in an earlier session — the one field this script changes is `active`.
[$sc, $sj] = $call('slides');
$row = null;
foreach (($sj['slides'] ?? []) as $s) {
    if ((int) ($s['id'] ?? 0) === 1) { $row = $s; break; }
}

if ($row === null) {
    echo 'HEROFIX login=' . $lc . ' slide1_not_found slidesCode=' . $sc . "\n";
    @unlink($jar);
    exit;
}

[$vc, $vj] = $call('slide_save', [
    'id'           => 1,
    'title_en'     => $row['title_en'],
    'title_ar'     => $row['title_ar'],
    'subtitle_en'  => $row['subtitle_en'],
    'subtitle_ar'  => $row['subtitle_ar'],
    'cta_label_en' => $row['cta_label_en'],
    'cta_label_ar' => $row['cta_label_ar'],
    'cta_href'     => $row['cta_href'],
    'active'       => 0,
    'sort'         => $row['sort'],
    'focal_x'      => $row['focal_x'],
    'focal_y'      => $row['focal_y'],
]);

[$oc, $oj] = $call('logout');
@unlink($jar);

// Verify from api.php, NOT admin.php — after logout the session is gone
// and a repeat admin.php call would only prove the gate still works
// (401), not what a shopper actually sees. api.php's own ?r=slides is
// public and already filters to `active = 1`, which is the property this
// whole fix is about.
$pub = curl_init('https://127.0.0.1/api/api.php?r=slides');
curl_setopt_array($pub, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
]);
$pubOut = curl_exec($pub);
curl_close($pub);
$pubJson = json_decode((string) $pubOut, true);
$activeCount = count($pubJson['slides'] ?? []);

echo 'HEROFIX login=' . $lc
   . ' saveCode=' . $vc . ' saveBody=' . json_encode($vj)
   . ' logout=' . $oc
   . ' activeSlidesNow=' . $activeCount
   . "\n";
