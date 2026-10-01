<?php
/**
 * What shape the PHONE category tiles a visitor receives are — 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-tile-shape-check.php && php r.php
 *
 * READ-ONLY, public URLs over the loopback (pinned with CURLOPT_RESOLVE).
 *
 * The phone tiles became square (1080x1080) that day. The URLs are rewritten to
 * api.php?r=cat_art, which serves an OWNER'S UPLOAD from the category_art table
 * when there is one and the shipped file otherwise — so a tile the owner replaced
 * in /backends before the change is still the old 900x798 shape, drawn into a
 * square box. Disk and publisher cannot see that; this asks what is SERVED, and
 * says which of the two answered.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$square = 0; $old = 0; $other = 0;
foreach (['men', 'women', 'accessories', 'outlet'] as $tile) {
    foreach (['', '-rtl'] as $rtl) {
        $path = "/cats/mobile/art-$tile$rtl.webp";
        $ch = curl_init('https://www.sporta.com.kw' . $path . '?v=20261001b');
        curl_setopt_array($ch, [
            CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_TIMEOUT => 8,
            CURLOPT_USERAGENT => 'sporta-tile-shape',
        ]);
        $bytes = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $bytes = is_string($bytes) ? $bytes : '';
        $info = $bytes !== '' ? @getimagesizefromstring($bytes) : false;
        $wh = $info ? $info[0] . 'x' . $info[1] : 'unreadable';
        $disk = is_file($ROOT . $path) ? file_get_contents($ROOT . $path) : '';
        $from = $bytes !== '' && $bytes === $disk ? 'shipped-file' : 'owner-upload';
        if ($wh === '1080x1080') $square++; elseif ($wh === '900x798') $old++; else $other++;
        line("$path $code $wh " . strlen($bytes) . "b $from");
    }
}
line("TILE-SHAPE square=$square old900x798=$old other=$other" . ($old ? '  <- replaced in /backends before the square change: re-upload them' : ''));
