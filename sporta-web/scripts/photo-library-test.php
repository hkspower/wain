<?php
// The photo library: list, rename (with every product repointed) and delete (only when unused).
//
//   php scripts/photo-library-test.php
//
// Runs against its OWN database (sporta_photo_test, created and dropped here) and a temporary folder,
// so the rig's data is never touched. Needs the MariaDB socket the rig uses, as root.
declare(strict_types=1);

$root = dirname(__DIR__);
require_once $root . '/dropin/php-store/photo-library.php';

$fails = 0;
$ok = static function (string $name, bool $cond, string $detail = '') use (&$fails): void {
    if ($cond) { echo "ok   {$name}\n"; return; }
    $fails++;
    echo "FAIL {$name}" . ($detail !== '' ? "  — {$detail}" : '') . "\n";
};

// ---------------------------------------------------------------- names
$ok('a plain name is accepted', photo_name_ok('cloudsoft-jacket-army-green-1a2b3c4d5e.jpg'));
$ok('a webp name is accepted', photo_name_ok('x.webp'));
foreach (['../etc/passwd.jpg', 'a/b.jpg', 'Upper.jpg', 'x.php', '.hidden.jpg', '._stub.jpg', 'x..y.jpg', "x\0.jpg", ''] as $bad) {
    $ok("refused: " . json_encode($bad), !photo_name_ok($bad));
}
$ok('a path base is taken from a stored reference', photo_base('/images/products/x-1.jpg') === 'x-1.jpg');
$ok('a bare stored name is its own base', photo_base('x-1.jpg') === 'x-1.jpg');
$ok('repoint keeps the folder and changes the name', photo_repoint('/images/products/a.jpg', 'a.jpg', 'b.jpg') === '/images/products/b.jpg');
$ok('repoint leaves other names alone', photo_repoint('/images/products/c.jpg', 'a.jpg', 'b.jpg') === '/images/products/c.jpg');
$ok('repoint keeps a leading space in a list', photo_repoint(' /images/products/a.jpg', 'a.jpg', 'b.jpg') === ' /images/products/b.jpg');

// ---------------------------------------------------------------- database and folder
$admin = new PDO('mysql:unix_socket=/run/mysqld/mysqld.sock;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$admin->exec('drop database if exists sporta_photo_test');
$admin->exec('create database sporta_photo_test');
$db = new PDO('mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=sporta_photo_test;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('create table products (id int primary key auto_increment, slug varchar(80) not null, image varchar(500) null, images text null) engine=InnoDB');
$db->exec("insert into products (slug, image, images) values
    ('alpha', '/images/products/shared.jpg', '/images/products/extra-1.jpg,/images/products/extra-2.jpg'),
    ('beta',  '/images/products/shared.jpg', null),
    ('gamma', '/images/products/gamma.jpg', null)");

$dir = sys_get_temp_dir() . '/photo-library-' . bin2hex(random_bytes(4));
mkdir($dir);
foreach (['shared.jpg', 'extra-1.jpg', 'extra-2.jpg', 'gamma.jpg', 'orphan.png', '._stub.jpg', 'notes.txt'] as $f) {
    file_put_contents("$dir/$f", base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='));
}

$list = photo_list($db, $dir);
$names = array_column($list, 'name');
$ok('the listing has the photographs and not the stubs or other files', $names === ['extra-1.jpg', 'extra-2.jpg', 'gamma.jpg', 'orphan.png', 'shared.jpg'], json_encode($names));
$byName = array_column($list, null, 'name');
$ok('a shared photo lists every product that shows it', ($byName['shared.jpg']['used_by'] ?? []) === ['alpha', 'beta'], json_encode($byName['shared.jpg']['used_by'] ?? null));
$ok('an extra photo lists the product that shows it as an extra', ($byName['extra-1.jpg']['used_by'] ?? []) === ['alpha']);
$ok('an unused photo lists no product', ($byName['orphan.png']['used_by'] ?? null) === []);
$ok('the listing gives the size of a photograph', ($byName['gamma.jpg']['width'] ?? 0) === 1 && ($byName['gamma.jpg']['path'] ?? '') === '/images/products/gamma.jpg');

// ---------------------------------------------------------------- delete
$refusedSlugs = null;
try { photo_delete($db, $dir, 'shared.jpg'); } catch (PhotoInUse $e) { $refusedSlugs = $e->slugs; }
$ok('delete refuses a photograph a product shows, and names the products', $refusedSlugs === ['alpha', 'beta'], json_encode($refusedSlugs));
$ok('a refused delete removes nothing', is_file("$dir/shared.jpg"));
photo_delete($db, $dir, 'orphan.png');
$ok('delete removes a photograph no product shows', !is_file("$dir/orphan.png"));
$missing = null;
try { photo_delete($db, $dir, 'orphan.png'); } catch (RuntimeException $e) { $missing = $e->getMessage(); }
$ok('deleting it again says it is not found', $missing === 'photo_not_found', (string)$missing);

// ---------------------------------------------------------------- rename
$result = photo_rename($db, $dir, 'shared.jpg', 'shared-new.jpg');
$ok('rename moves the file', is_file("$dir/shared-new.jpg") && !is_file("$dir/shared.jpg"));
$ok('rename reports how many products it repointed', ($result['products'] ?? 0) === 2, json_encode($result));
$rows = $db->query('select slug, image, images from products order by slug')->fetchAll(PDO::FETCH_ASSOC);
$ok('every product that showed it now shows the new name', $rows[0]['image'] === '/images/products/shared-new.jpg' && $rows[1]['image'] === '/images/products/shared-new.jpg', json_encode($rows));
$ok('an extra photo is repointed too', $rows[0]['images'] === '/images/products/extra-1.jpg,/images/products/extra-2.jpg', (string)$rows[0]['images']);
$ok('an unrelated product is untouched', $rows[2]['image'] === '/images/products/gamma.jpg');

$taken = null;
try { photo_rename($db, $dir, 'gamma.jpg', 'extra-1.jpg'); } catch (RuntimeException $e) { $taken = $e->getMessage(); }
$ok('rename refuses a name already in use, and changes nothing', $taken === 'photo_name_taken' && is_file("$dir/gamma.jpg"), (string)$taken);
$invalid = null;
try { photo_rename($db, $dir, 'gamma.jpg', '../escape.jpg'); } catch (RuntimeException $e) { $invalid = $e->getMessage(); }
$ok('rename refuses a path in the new name', $invalid === 'photo_name_invalid', (string)$invalid);

// A failed file move must not leave the database pointing at a file that is not there.
// A read-only folder stops a normal user's rename but not root's, so this check needs a non-root run. As root it is
// reported as SKIPPED (loudly), not passed: the rollback path is then untested by this file.
if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
    echo "SKIP a rename whose file move fails is undone in the database  — running as root (a read-only folder does not stop root)\n";
} else {
    $db->exec("update products set image = '/images/products/gamma-2.jpg' where slug = 'gamma'");
    chmod($dir, 0555);
    $moveFailed = null;
    try { photo_rename($db, $dir, 'gamma.jpg', 'gamma-3.jpg'); } catch (RuntimeException $e) { $moveFailed = $e->getMessage(); }
    chmod($dir, 0755);
    $after = $db->query("select image from products where slug = 'gamma'")->fetchColumn();
    $ok('a rename whose file move fails is undone in the database', $moveFailed === 'photo_rename_failed' && $after === '/images/products/gamma-2.jpg', "move={$moveFailed} image={$after}");
}

// ---------------------------------------------------------------- clean up
$admin->exec('drop database if exists sporta_photo_test');
foreach (glob("$dir/*") ?: [] as $f) @unlink($f);
@rmdir($dir);

echo $fails === 0 ? "\nphoto-library: all ok\n" : "\nphoto-library: {$fails} FAIL\n";
exit($fails === 0 ? 0 : 1);
