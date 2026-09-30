<?php
/**
 * Product photographs from the supplier proforma (AHED, To_Sportakw_2.xlsx) —
 * 2026-09-29, "go" on the 29-photo plan. Adds pictures to product_images and
 * changes nothing else: no product, price, stock or existing photograph.
 *
 *   wget -nv -O p.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/publish-product-photos.php && php p.php
 *
 * A photograph is added only when the product exists and that product does not
 * already carry a picture with the same hash, so a re-run adds nothing. Photos
 * are appended after any the product already has (sort = max + 1). The report
 * is STATE, not the verb: how many of the 29 are now on their products.
 * UNDO: delete from product_images where image_hash in (<hashes below>) —
 * or use the panel's photo delete on each.
 *
 * $COMMIT pins the ARTWORK (full 40 characters — an abbreviated sha 404s).
 * Fetch this script from HEAD.
 */
$COMMIT = 'b4c13f332c8d849e303a890b5eda5d40e296e25b';
$BASE = getenv('SPORTA_PHOTO_BASE') ?: 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/sporta-site/assets/product-photos/';
$ROOT = getenv('SPORTA_ROOT') ?: '/home/u130124229/domains/sporta.com.kw/public_html';

// slug, n, sha256 of the jpeg file
$PHOTOS = [
  ['cloudsoft-jacket-army-green', 1, 'a3de9fae79c825de131824e1afdff9b7cb3a30aaac6003f13ceaacdcc108297a'],
  ['cloudsoft-jacket-cherry-red', 1, '6859ead067f494cd62eef15ae1389b9b7e69206ba388b9d24e297ab7a4f6c304'],
  ['cloudsoft-jacket-coffee-brown', 1, '98c1a5d46b875f63483a2f5dd2c08be3eaac93af5d5d70a73a3ee122c832b41a'],
  ['cloudsoft-leggings-army-green', 1, '3e7e01e885d2d01479431bc0223e5f56d23057a94f8b1fc7ad8fe2c8563a3254'],
  ['cloudsoft-leggings-cherry-red', 1, '45b1e34f96d7a2044dce395c436cd10b054f7d35d6cc31b24b2fdf9f2e3b843e'],
  ['cloudsoft-leggings-coffee-brown', 1, 'e61d67288160ec05784b906357970e1ab51afa056981c711d1d6594a4b1bf95a'],
  ['cloudsoft-leggings-grey', 1, 'b0a2549a8b8b0cce780ed2d892ad8e92f7004fd7f28ee18bd064a01d40766c2a'],
  ['cloudsoft-leggings-navy', 1, '2f1d9742cab231ee707af745cbd5aa24ca98161005e904055ef9ff810eb592cc'],
  ['cloudsoft-leggings-onyx-black', 1, 'a388beedadfcda5f7e78727fdd5c3b9578e9cd7e999fe071432089cc98634030'],
  ['cloudsoft-top-grey', 1, 'e3083f58a5959ef7e341c966ec36f8e448a6a22560c80ebf3a344a5d29253c7c'],
  ['cloudsoft-top-navy', 1, 'fe5748b932a6dfaa8146681231bc32071feead794beacda45ae183f725b6ab4f'],
  ['cloudsoft-top-onyx-black', 1, '49ed081a668750b5c6f45cdb015abf18567a6331906663bd70a6faebd3a9451d'],
  ['define-jacket-iris-purple', 1, '1fac0f4bd235f524a948df9fd3bd210ec53eadab7118bf3df7e7401aa2fe68e5'],
  ['define-jacket-onyx-black', 1, 'edf680138e14576a858fc2e7941fef32bf3424f83566cd14478ad68e9d597943'],
  ['define-jacket-onyx-black', 2, '89988b113aef01577db95bc59dde7f09e824d411f330b30f9e657820586ebb90'],
  ['define-jacket-steel-grey', 1, 'df4e0fa1c59fd2fb987afec056c1df07997c1c7b11abfa65d6638f154fd09a13'],
  ['define-jacket-steel-grey', 2, 'b71bb2262203c8ad61a5c99690f867285df1631b523751c1f9ffe408087d3d69'],
  ['sculpt-jacket-black', 1, '144b4bad69e7e9e3bbdac7bf27894f52e63c9ff60d7131d80d2b91235c001efa'],
  ['sculpt-jacket-grey', 1, '6289075a4764d1699a74ca84f187a1d39abded5925b13206a9e68f40257df007'],
  ['sculpt-jacket-navy', 1, 'a7bf62c60f03fd5bd8df06e76dfd4e62c385adb2fdcf0bb6e62c120621f8a379'],
  ['sculpt-jacket-taupe-brown', 1, 'f0de62e5f9b9e96983f81515deba9fa3a205296c1f1de729606da8bc7678284b'],
  ['sculpt-leggings-black', 1, 'c3810d0a2789d1bf123eda0d72c6cbf393746c269fe06e86aafd2e5f2143ee50'],
  ['sculpt-leggings-grey', 1, 'd10d7aaeb2d676e00274817ee946c43409f34c9a127c66b1ca9341de0cdef96e'],
  ['sculpt-leggings-navy', 1, '8cda4eeca64519f547f18cf2aa27485fbf5fcc55125bd52db182f6af34f60c4c'],
  ['sculpt-leggings-taupe-brown', 1, '13c2cc66f7133867be0c1a88557ee7f92ef6b20f9d8d09965de7f9c8c3f16912'],
  ['sculpt-top-black', 1, '0210ebdb84a6016419e4d76fec4c0c973b36e443141253b2ae2c4a74d07be606'],
  ['sculpt-top-grey', 1, '40b55656cc3a2bc75b453dd67bb87f3d7762629991f3de46a5abb7b5943284b7'],
  ['sculpt-top-navy', 1, 'cd2079b7b6a17d1228014ab6e4705e40ea2acb8ccf0a3b512ad5d6d620b2dcc6'],
  ['sculpt-top-taupe-brown', 1, '96f4b1276eca72d760691739c0c869d8a6fb5443e2a0e411461cd3ebdc50ea0e'],
];

function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
function fetch_file(string $base, string $name): array {
    if (!preg_match('#^https?://#', $base)) {
        $b = @file_get_contents($base . $name);
        return [$b === false ? null : $b, $b === false ? 0 : 200];
    }
    $ch = curl_init($base . $name);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => true]);
    $b = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return [is_string($b) ? $b : null, $code];
}

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { line('PHOTOS db=NO-CONFIG'); return; }
try {
    $pdo = new PDO("mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 20]);
} catch (Throwable $e) { line('PHOTOS db=ERROR'); return; }

$known = $pdo->prepare('select 1 from products where slug = ?');
$has   = $pdo->prepare('select 1 from product_images where slug = ? and image_hash = ?');
$next  = $pdo->prepare('select coalesce(max(sort), -1) + 1 from product_images where slug = ?');
$count = $pdo->prepare('select count(*) from product_images where slug = ?');
$ins   = $pdo->prepare('insert into product_images (slug, sort, image, image_hash, image_w, image_h) values (?, ?, ?, ?, ?, ?)');
$added = 0; $already = 0; $noProduct = 0; $failed = 0;
foreach ($PHOTOS as [$slug, $n, $sha]) {
    $known->execute([$slug]);
    if (!$known->fetchColumn()) { line("PHOTO $slug-$n product-NOT-FOUND"); $noProduct++; continue; }
    [$bytes, $code] = fetch_file($BASE, "$slug-$n.jpg");
    if ($bytes === null || $code !== 200) { line("PHOTO $slug-$n fetch FAILED http=$code"); $failed++; continue; }
    if (hash('sha256', $bytes) !== $sha) { line("PHOTO $slug-$n HASH-MISMATCH"); $failed++; continue; }
    if (substr($bytes, 0, 3) !== "\xff\xd8\xff") { line("PHOTO $slug-$n NOT-A-JPEG"); $failed++; continue; }
    $uri = 'data:image/jpeg;base64,' . base64_encode($bytes);
    if (strlen($uri) > 1100000) { line("PHOTO $slug-$n TOO-LARGE"); $failed++; continue; }
    $hash = hash('sha256', $uri);
    $has->execute([$slug, $hash]);
    if ($has->fetchColumn()) { $already++; continue; }
    $count->execute([$slug]);
    if ((int) $count->fetchColumn() >= 12) { line("PHOTO $slug-$n product-full"); $failed++; continue; }
    [$w, $h] = getimagesizefromstring($bytes) ?: [null, null];
    $next->execute([$slug]);
    $ins->execute([$slug, (int) $next->fetchColumn(), $uri, $hash, $w, $h]);
    line("PHOTO $slug-$n added");
    $added++;
}
// STATE, so the run read a minute late says the same true thing: photographs of the
// plan that are on their products now, whichever run put them there.
line('PHOTOS onProducts=' . ($added + $already) . '/' . count($PHOTOS) . ' added=' . $added . ' alreadyThere=' . $already . ' noProduct=' . $noProduct . ' failed=' . $failed
   . ' productsWithPhotos=' . (int) $pdo->query('select count(distinct slug) from product_images')->fetchColumn()
   . ' totalPhotos=' . (int) $pdo->query('select count(*) from product_images')->fetchColumn());
