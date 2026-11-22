<?php
// THE PHOTO LIBRARY: the product photographs on disk, as the admin sees them.
//
// Three admin actions, and only these:
//   photo_list    every photograph in the product folder, with its size and the
//                 products that show it (read only).
//   photo_rename  give a photograph a new file name AND point every product that
//                 shows it at the new name, in one transaction. The file is only
//                 renamed when the database has accepted the change, so a product
//                 never points at a file that is not there.
//   photo_delete  remove a photograph, but ONLY when no product shows it. A product
//                 that still uses the file is refused with 409 photo_in_use and the
//                 slugs named, so nothing disappears from a live product by accident.
//
// Uploads stay in admin.php (product_image_upload): this file never writes a new
// picture, never resizes and never re-encodes. A name is only ever a bare file
// name made of a-z, 0-9, dot, dash and underscore, ending in .png, .jpg, .jpeg or
// .webp, so no path can leave the product folder.

/** A bare, safe file name for a product photograph. */
function photo_name_ok(mixed $name): bool
{
    if (!is_string($name) || $name === '' || strlen($name) > 128) return false;
    return (bool)preg_match('/^[a-z0-9][a-z0-9._-]{0,122}\.(png|jpe?g|webp)$/D', $name)
        && strpos($name, '..') === false;
}

/** The bare file name of a stored photo reference ("/images/products/x.jpg" or "x.jpg"), or ''. */
function photo_base(?string $ref): string
{
    $ref = trim((string)$ref);
    if ($ref === '') return '';
    $slash = strrpos($ref, '/');
    return $slash === false ? $ref : substr($ref, $slash + 1);
}

/**
 * The products that show each file: name => [slug, ...]. A product shows a file as its
 * main photograph (`image`) or as one of its extra photographs (`images`, comma-separated).
 *
 * @return array<string, list<string>>
 */
function photo_refs(PDO $db): array
{
    $refs = [];
    $rows = $db->query('select slug, image, images from products')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        $names = [photo_base($row['image'] ?? null)];
        foreach (explode(',', (string)($row['images'] ?? '')) as $part) $names[] = photo_base($part);
        foreach (array_unique(array_filter($names, static fn ($n) => $n !== '')) as $name) {
            $refs[$name][] = (string)$row['slug'];
        }
    }
    return $refs;
}

/**
 * Every photograph in the folder. Only files that pass photo_name_ok() are listed, so the
 * macOS "._" stubs and any stray file are left out (they are not photographs the shop uses).
 *
 * @return list<array{name:string, path:string, bytes:int, width:int, height:int, used_by:list<string>}>
 */
function photo_list(PDO $db, string $dir): array
{
    $out = [];
    $refs = photo_refs($db);
    $names = is_dir($dir) ? scandir($dir) : [];
    foreach (is_array($names) ? $names : [] as $name) {
        if (!photo_name_ok($name) || !is_file($dir . '/' . $name)) continue;
        $size = @getimagesize($dir . '/' . $name);
        $out[] = [
            'name' => $name,
            'path' => '/images/products/' . $name,
            'bytes' => (int)(@filesize($dir . '/' . $name) ?: 0),
            'width' => is_array($size) ? (int)$size[0] : 0,
            'height' => is_array($size) ? (int)$size[1] : 0,
            'used_by' => array_values(array_unique($refs[$name] ?? [])),
        ];
    }
    usort($out, static fn ($a, $b) => strcmp($a['name'], $b['name']));
    return $out;
}

/** A stored photo reference with its file name changed, keeping the folder part and any spaces around it. */
function photo_repoint(string $ref, string $from, string $to): string
{
    $t = trim($ref);
    if (photo_base($t) !== $from) return $ref;
    $pos = strrpos($t, $from);
    $lead = substr($ref, 0, strpos($ref, $t));
    $trail = substr($ref, strlen($lead) + strlen($t));
    return $lead . substr($t, 0, $pos) . $to . $trail;
}

/** The file is still shown by these products, so it is not removed. */
final class PhotoInUse extends RuntimeException
{
    /** @param list<string> $slugs */
    public function __construct(public readonly array $slugs)
    {
        parent::__construct('photo_in_use');
    }
}

/**
 * Give a file a new name and repoint every product that shows it. Throws RuntimeException with
 * a store error code: 'photo_name_invalid', 'photo_not_found', 'photo_name_taken', 'photo_rename_failed'.
 *
 * @return array{from:string, to:string, products:int}
 */
function photo_rename(PDO $db, string $dir, mixed $from, mixed $to): array
{
    if (!photo_name_ok($from) || !photo_name_ok($to)) throw new RuntimeException('photo_name_invalid');
    if ($from === $to) throw new RuntimeException('photo_name_invalid');
    if (!is_file($dir . '/' . $from)) throw new RuntimeException('photo_not_found');
    if (file_exists($dir . '/' . $to)) throw new RuntimeException('photo_name_taken');

    $db->beginTransaction();
    try {
        // Lock the rows that might show the file, so a concurrent product save cannot write the old name back.
        $q = $db->prepare('select id, image, images from products where image like ? or images like ? for update');
        $q->execute(['%' . $from . '%', '%' . $from . '%']);
        $changed = 0;
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $image = (string)($row['image'] ?? '');
            $newImage = photo_repoint($image, $from, $to);
            $newParts = array_map(static fn (string $p) => photo_repoint($p, $from, $to), explode(',', (string)($row['images'] ?? '')));
            $newImages = implode(',', $newParts);
            if ($newImage === $image && $newImages === (string)($row['images'] ?? '')) continue;
            $db->prepare('update products set image = ?, images = ? where id = ?')
               ->execute([$newImage, $newImages, (int)$row['id']]);
            $changed++;
        }
        // The file moves only after the database has taken the change, and the change is undone if the file will not move.
        if (!@rename($dir . '/' . $from, $dir . '/' . $to)) throw new RuntimeException('photo_rename_failed');
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($e instanceof RuntimeException) throw $e;
        throw new RuntimeException('photo_rename_failed');
    }
    return ['from' => $from, 'to' => $to, 'products' => $changed];
}

/**
 * Remove a file, but only when no product shows it. Throws RuntimeException with
 * 'photo_name_invalid', 'photo_not_found', 'photo_in_use' (with the slugs on the exception's
 * data via photo_in_use_slugs()) or 'photo_delete_failed'.
 *
 * @return list<string> the slugs that show it (empty when it was removed)
 */
function photo_delete(PDO $db, string $dir, mixed $name): array
{
    if (!photo_name_ok($name)) throw new RuntimeException('photo_name_invalid');
    if (!is_file($dir . '/' . $name)) throw new RuntimeException('photo_not_found');
    $shown = photo_refs($db)[$name] ?? [];
    $shown = array_values(array_unique($shown));
    if ($shown) throw new PhotoInUse($shown);
    if (!@unlink($dir . '/' . $name)) throw new RuntimeException('photo_delete_failed');
    return [];
}
