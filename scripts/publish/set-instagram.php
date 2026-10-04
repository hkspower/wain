<?php
// 2026-10-04, owner: Sporta's Instagram is @sporta.kw. Writes ONLY the instagram key of the `social`
// settings row (the same row /backends -> Social writes), keeping every other network as it is.
// Reports STATE.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
$db = store_db();
$row = $db->query("select value from settings where name = 'social'")->fetchColumn();
$s = is_string($row) ? (json_decode($row, true) ?: []) : [];
foreach (['instagram', 'snapchat', 'youtube', 'tiktok', 'whatsapp'] as $k) $s[$k] = (string) ($s[$k] ?? '');
$s['instagram'] = 'https://www.instagram.com/sporta.kw';
$db->prepare("insert into settings (name, value) values ('social', ?) on duplicate key update value = values(value)")
   ->execute([json_encode($s, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
store_settings(null, true);
$now = store_settings($db)['social'] ?? [];
echo 'SOCIAL instagram=' . ($now['instagram'] ?? '-') . ' others=' . implode(',', array_map(fn ($k) => $k . ':' . (($now[$k] ?? '') !== '' ? 'set' : 'empty'), ['snapchat', 'youtube', 'tiktok', 'whatsapp'])) . "\n";
