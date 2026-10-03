<?php
// READ-ONLY. Every active product's photographs on the live shop: which products have none, and whether
// each uploaded photo is actually SERVED as a picture (status, type, decodable size) — full size and as
// the 400px grid thumbnail. Loopback GETs + SELECTs only; prints slugs and numbers, no image data.
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/store.php';
require is_file($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/store.php';
function fetchImg(string $path): array {
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_TIMEOUT => 8]);
    $b = (string) curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE); curl_close($ch);
    $dim = @getimagesizefromstring($b);
    return [$code, $type, strlen($b), $dim ? $dim[0] . 'x' . $dim[1] : 'undecodable'];
}
try {
    $db = store_db();
    $act = $db->query('select slug from products where active = 1 order by slug')->fetchAll(PDO::FETCH_COLUMN);
    $imgs = $db->query('select i.id, i.slug, i.image_hash, length(i.image) n, i.image_w, i.image_h from product_images i join products p on p.slug = i.slug and p.active = 1 order by i.slug, i.sort, i.id')->fetchAll(PDO::FETCH_ASSOC);
    $by = []; foreach ($imgs as $i) $by[$i['slug']][] = $i;
    $none = array_values(array_filter($act, fn($s) => empty($by[$s])));
    $orph = (int) $db->query('select count(*) from product_images i left join products p on p.slug = i.slug where p.slug is null')->fetchColumn();
    line('PHOTOS active=' . count($act) . ' withPhotos=' . (count($act) - count($none)) . ' photos=' . count($imgs) . ' orphanRows=' . $orph);
    line('NOPHOTO ' . ($none ? implode(',', $none) : '-'));
    $bad = []; $small = []; $ok = 0;
    foreach ($imgs as $i) {
        $v = substr((string) $i['image_hash'], 0, 12);
        [$c, $t, $len, $d] = fetchImg('/api/api.php?r=product_image&id=' . $i['id'] . '&v=' . $v);
        [$c2, $t2, , $d2] = fetchImg('/api/api.php?r=product_image&id=' . $i['id'] . '&v=' . $v . '&w=400');
        if ($c !== 200 || !str_starts_with($t, 'image/') || $d === 'undecodable' || $c2 !== 200 || $d2 === 'undecodable')
            $bad[] = $i['slug'] . '#' . $i['id'] . "[$c/$t/$d thumb $c2/$t2/$d2]";
        else { $ok++; $w = (int) explode('x', $d)[0]; if ($w < 800) $small[] = $i['slug'] . '#' . $i['id'] . "=$d"; }
    }
    line("SERVED ok=$ok/" . count($imgs) . ' broken=' . count($bad) . ($bad ? ' ' . implode(' ', $bad) : ''));
    line('LOWRES(<800px) ' . ($small ? implode(' ', $small) : '-'));
} catch (Throwable $e) { line('ERROR ' . $e->getMessage()); }
