<?php
/**
 * Empty the stored product-photo copies ONCE, so they are re-made with the sharper recipe
 * (Mitchell resize, WebP quality 88, plus a new 800px width). 2026-10-01.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/refresh-product-thumbs.php && php r.php
 *
 * RUN IT AFTER the new api/store.php is live, or the old code refills the table with
 * soft copies. Deleting loses nothing: product_image_thumbs is only a cache, rebuilt
 * from the originals on the next request for each picture.
 *
 * ONE-SHOT, AND IT SAYS SO IN THE DATABASE. This runs on a per-minute job, and a purge
 * that repeated would keep deleting the good copies the shop had just made. A marker
 * (settings row `thumbs_recipe`) records that recipe 2 was purged; later runs only
 * report. It reports STATE, so the run read a minute late says the same true thing.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }
try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

$live = file_get_contents('/home/u130124229/domains/sporta.com.kw/public_html/api/store.php');
$newCode = is_string($live) && strpos($live, 'IMG_MITCHELL') !== false && strpos($live, '[96, 200, 400, 600, 800]') !== false;
$marker = null;
try {
    $v = $db->query("select value from settings where name = 'thumbs_recipe'")->fetchColumn();
    if ($v !== false) $marker = (int) (json_decode((string) $v, true)['recipe'] ?? 0);
} catch (Throwable $e) {}

$purged = 'no';
if (!$newCode) {
    line('REFUSED — the live api/store.php is not the new recipe yet; publish it first.');
} elseif ($marker !== 2) {
    try {
        $db->exec('delete from product_image_thumbs');
        $db->prepare("insert into settings (name, value) values ('thumbs_recipe', ?) on duplicate key update value = values(value)")
           ->execute([json_encode(['recipe' => 2])]);
        $purged = 'yes';
    } catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); }
}
$rows = '?';
try { $rows = (string) $db->query('select count(*) from product_image_thumbs')->fetchColumn(); } catch (Throwable $e) {}
try { $v = $db->query("select value from settings where name = 'thumbs_recipe'")->fetchColumn(); $marker = $v === false ? null : (int) (json_decode((string) $v, true)['recipe'] ?? 0); } catch (Throwable $e) {}
line('STATE newCodeLive=' . ($newCode ? 'yes' : 'no') . ' recipeMarker=' . var_export($marker, true) . " thumbRows=$rows" . ($purged === 'yes' ? ' (purged this run)' : ''));
