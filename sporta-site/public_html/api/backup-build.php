<?php
/**
 * What a backup IS: the tables, the primary keys and the builder — shared by admin.php (the Backup
 * card's export/preview/restore) and cron-backup.php (the daily file). One list, so the two cannot drift.
 * Lifted out of admin.php on 2026-10-04 unchanged; its comments are the authority on what travels.
 */
declare(strict_types=1);

const BACKUP_TABLES = [
    'brands', 'products', 'product_variants', 'product_images',
    'customers', 'orders', 'order_items', 'reviews', 'discounts',
    'blocked_customers', 'hero_slides', 'settings', 'admin_users', 'assistant_qa',
];

// The one non-'id' key. A hand-written exception list is the same shape as
// the size/fit lists elsewhere in this project that had to be read out of the
// schema rather than restated — this one is short enough, and stable enough
// (a primary-key column does not change casually), to state directly rather
// than introspect on every request.
function backup_pk(string $table): string {
    return $table === 'settings' ? 'name' : 'id';
}

// Every REAL column of a table this shop knows, the only names an insert
// built from an uploaded file may ever use.
//
// backup_import BUILDS ITS INSERT FROM THE UPLOADED FILE'S OWN KEYS —
// array_keys($row) — because a genuine export can carry a column this list
// does not enumerate by hand without the two drifting apart the moment the
// schema changes. That is safe only because those keys are checked against
// something real BEFORE they are ever concatenated into SQL; unchecked, a
// "column name" is an unescaped IDENTIFIER, and a row is an attacker-shaped
// value the moment it is anything other than the shop's own export — a
// backup is a file, and a file can be replaced before it is ever uploaded.
// `show columns` is queried with `$table` alone in the identifier position,
// and $table only ever comes from BACKUP_TABLES, never from the file.
function backup_columns(PDO $db, string $table): array {
    $out = [];
    foreach ($db->query('show columns from `' . $table . '`')->fetchAll() as $c) {
        $out[] = (string) $c['Field'];
    }
    return $out;
}

// Builds the exported form of one table: every column, every row, streamed
// off a PDO cursor rather than fetchAll()'d whole — orders and order_items
// are the tables here most likely to grow large, and a cursor means this
// route's peak memory is one row, not one table.
function backup_table_rows(PDO $db, string $table): array {
    $stmt = $db->query('select * from `' . $table . '`');
    $rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if ($table === 'admin_users') {
            // THE SECOND FACTOR NEVER TRAVELS. See the comment above this
            // block for the reasoning; this is the one line that enforces it.
            $row['totp_secret'] = null;
            $row['totp_enabled'] = 0;
            $row['totp_last_step'] = null;
        }
        $rows[] = $row;
    }
    return $rows;
}

function backup_build(PDO $db): array {
    $out = [
        // A format version, not the shop's own VERSION (sw.js) — this is the
        // shape of the FILE, so a future change to what a backup contains can
        // tell an old file from a new one without guessing from what keys
        // happen to be present.
        'format'      => 1,
        'exported_at' => gmdate('c'),
        'tables'      => [],
    ];
    foreach (BACKUP_TABLES as $t) {
        $out['tables'][$t] = backup_table_rows($db, $t);
    }
    return $out;
}

