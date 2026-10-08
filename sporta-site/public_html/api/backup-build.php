<?php
/**
 * What a backup IS: the tables, how each row is written into the file, how a file is compared with
 * the live shop, and how it is put back — shared by admin.php (the Backup card's export, preview and
 * restore) and cron-backup.php (the daily file). One home, so the card and the daily file cannot
 * drift, and so a restore reads exactly the format an export writes.
 *
 * Lifted out of admin.php on 2026-10-04. Rewritten 2026-10-08 ("fix database"), because the list had
 * stopped describing the shop: fourteen tables, written when the shop had about that many, while the
 * owner's work had since gone into eighteen more — colours and fits, search text, the home banner,
 * the category pictures, the logo, the share picture, returns, customer notes, the books, suppliers
 * and purchase orders, stock history, size charts. None of it was in the daily file. A shop restored
 * from one would have come back with its products and without everything the owner had added to
 * them, and nothing anywhere said so.
 *
 * Four things changed with the list, each because the new tables needed it:
 *
 *   1. BINARY COLUMNS ARE BASE64. category_art, site_images, seo_image and home_banner keep their
 *      pictures as bytes (mediumblob). Raw bytes are not UTF-8, and json_encode() returns FALSE on
 *      them — store_out() would then have echoed an EMPTY body with a 200, and the card would have
 *      offered a 0-byte "backup". The file now names its binary columns in `binary`, and a restore
 *      decodes exactly those. That is format 2; a format-1 file (the fourteen tables, no binary
 *      columns) still restores.
 *   2. THE PRIMARY KEY IS READ FROM THE SCHEMA. The old code said "the one non-'id' key is
 *      settings.name" — and product_variants' key is `sku`. It has no `id` column at all, so the
 *      restore skipped EVERY size row as keyless after deleting them all: restoring a backup emptied
 *      the shop's stock and reported success. The new tables add composite keys (category_art is
 *      tile+variant+fmt), so the key is now whatever information_schema says it is.
 *   3. A TABLE THE FILE DOES NOT NAME IS LEFT ALONE. The restore used to treat a missing table as an
 *      empty one and delete it. With eighteen tables added, every backup written before today would
 *      have wiped the books, the suppliers and the purchase orders on restore. A table present in the
 *      file is REPLACED, as before (see admin.php for why replace, not merge); a table absent from the
 *      file is not in that backup, so a restore keeps it and the preview says so.
 *   4. IT STREAMS. The rows used to be collected into one PHP array, then json_encode()d whole —
 *      three copies of the shop's photographs in memory at once on shared hosting, on a list that has
 *      just grown by every picture the owner uploads. backup_write() writes one row at a time from an
 *      unbuffered query; cron-backup.php gzips it straight to disk.
 *
 * WHAT IS NEVER IN IT — BACKUP_EXCLUDED below, each with its reason, and three redactions inside rows
 * that do travel: the admins' second factor (as before), the payment credentials the Payments
 * screen keeps in the `knet` settings row, and every CUSTOMER's password hash (owner, 2026-10-07:
 * "drop customer passwords" — a file that leaves the server is a file of crackable hashes for every
 * shopper; the ADMIN's hash travels, or nobody could sign in after restoring onto an empty shop). The old comment said the KNET/CBK credentials "are not
 * database rows" — true when it was written, false since 2026-09-30, when /backends -> Payments began
 * saving them into settings. A file the owner can download and hand to anyone carried the bank
 * secrets in plain text. They are nulled now, and a restore keeps whatever this shop has saved.
 */
declare(strict_types=1);

// The shape of the FILE — not the shop's VERSION (sw.js). 1 = up to 2026-10-07: fourteen tables, no
// binary columns, no redaction of settings. 2 = binary columns base64 and named in `binary`, payment
// secrets redacted (named in `redacted`), tables this shop did not have named in `absent`.
const BACKUP_FORMAT = 2;

// EVERY TABLE THE OWNER OR A CUSTOMER WRITES. Grouped for reading; the order is also the order the
// preview lists them in. A restore runs with foreign_key_checks off (journal_entries points at itself,
// return_request_items at order_items), so the order is not what keeps a restore consistent — doing
// all of it in one transaction is.
const BACKUP_TABLES = [
    // the catalogue
    'brands', 'products', 'product_variants', 'product_images', 'product_attrs', 'product_seo',
    'size_charts', 'stock_log',
    // the shop's own pages: slides, banner, pictures, wording and rules, taught answers
    'hero_slides', 'home_banner', 'category_art', 'site_images', 'seo_image', 'settings', 'assistant_qa',
    // who buys, what they bought, what came back, what the owner noted about them
    'customers', 'customer_notes', 'blocked_customers', 'orders', 'order_items', 'reviews', 'discounts',
    'return_requests', 'return_request_items',
    // the books
    'accounts', 'journal_entries', 'journal_lines',
    // purchasing
    'suppliers', 'variant_supplier', 'purchase_orders', 'purchase_order_items',
    // who may run the shop
    'admin_users',
];

// EVERY OTHER TABLE, AND WHY IT STAYS OUT. Not documentation only: scripts/backup-tables-test.mjs
// requires every table a fully-migrated install has to be in exactly one of these two lists, so a
// table added tomorrow fails the test until somebody decides which side of the line it is on.
const BACKUP_EXCLUDED = [
    // logs — what happened, not what the shop is. A REPLACE restore would also rewind them, erasing
    // the record of everything since the backup, the restore included.
    'admin_audit_log'       => 'log of admin saves',
    'admin_login_log'       => 'log of sign-in attempts',
    'size_advice_log'       => 'log of size advice given',
    // credentials, sessions and one-time codes — a copy of the file must never be a way in, and a
    // device-bound key cannot be restored onto a device anyway: the owner re-enrols
    'admin_sessions'        => 'signed-in browsers',
    'admin_devices'         => 'passcode unlock tokens (hashes)',
    'admin_passkeys'        => 'passkey credentials',
    'admin_password_resets' => 'reset codes',
    'admin_known_ips'       => 'new-address alert state',
    'admin_ip_geo'          => 'cache of address lookups',
    'customer_passkeys'     => 'customer passkey credentials',
    'customer_login_codes'  => 'emailed sign-in codes',
    'push_subscriptions'    => 'browser push endpoints and keys',
    'wallet_registrations'  => 'phones registered for Wallet pushes',
    'wallet_passes'         => 'issued Wallet cards: each row carries the card\'s bearer auth token; a card is re-issued when the customer opens /card',
    // outboxes — restoring a half-sent queue sends its messages to real customers a second time
    'assistant_outbox'      => 'outbox',
    'customer_mail_outbox'  => 'outbox',
    'fulfilment_outbox'     => 'outbox',
    'push_outbox'           => 'outbox',
    'whatsapp_outbox'       => 'outbox',
    // counters and caches
    'rate_limit'            => 'rate-limit counters',
    'rate_bucket'           => 'rate-limit buckets',
    'product_image_thumbs'  => 'thumbnail cache, rebuilt from product_images on demand',
    'order_location'        => 'a driver\'s live position: overwritten, deleted on delivery, stale after 30 minutes',
];

// SECRETS INSIDE A ROW THAT OTHERWISE TRAVELS. settings.knet holds the Payments screen's credentials
// (see the `knet` branch of settings_save in admin.php): the Tranportal password and resource key and
// the CBK client secrets and encryption keys. The IDs travel — they say which merchant this is and
// prove nothing on their own. Exported as null; on restore the value this shop has saved is kept.
const BACKUP_REDACT_SETTINGS = [
    'knet' => ['tranportal_password', 'resource_key',
               'cbk_client_secret', 'cbk_encrp_key', 'cbk_test_client_secret', 'cbk_test_encrp_key'],
];

// CUSTOMER PASSWORD HASHES. Exported as null. On restore a customer keeps the hash this shop holds for
// the SAME EMAIL — never the same id: ids drift after a deletion, and handing customer 5's password to
// whoever is customer 5 in the file would be an account takeover. A customer this shop does not have
// gets a fresh random hash nobody knows (the column is NOT NULL), and signs in with an emailed code or
// Google, or sets a new password — the routes that already exist for a forgotten one.
const BACKUP_REDACT_COLUMNS = [
    'customers' => ['password_hash'],
];

const BACKUP_JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

/**
 * The real shape of every table of this shop: columns in order, the primary key, the binary columns.
 * Read from information_schema, never from a file — every identifier any SQL below is built from comes
 * out of here (and only for names in BACKUP_TABLES), so a backup file can name a column only by
 * matching one that exists.
 */
function backup_meta(PDO $db): array {
    $out = [];
    $q = $db->query("select table_name as t, column_name as c, data_type as d, column_key as k
                       from information_schema.columns
                      where table_schema = database()
                      order by table_name, ordinal_position");
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $c) {
        $t = (string) $c['t'];
        $out[$t] ??= ['cols' => [], 'pk' => [], 'binary' => []];
        $out[$t]['cols'][] = (string) $c['c'];
        if ((string) $c['k'] === 'PRI') $out[$t]['pk'][] = (string) $c['c'];
        if (in_array(strtolower((string) $c['d']), ['tinyblob', 'blob', 'mediumblob', 'longblob', 'binary', 'varbinary'], true)) {
            $out[$t]['binary'][] = (string) $c['c'];
        }
    }
    return $out;
}

// Every REAL column of a table — kept for anything that called it before backup_meta() existed.
function backup_columns(PDO $db, string $table): array {
    return backup_meta($db)[$table]['cols'] ?? [];
}

// A row's primary key as one string, for comparing the file with the shop. JSON of the values, so a
// composite key cannot collide the way "a" . "bc" and "ab" . "c" would.
function backup_key(array $row, array $pk): string {
    $v = [];
    foreach ($pk as $c) $v[] = isset($row[$c]) ? (string) $row[$c] : null;
    return json_encode($v, BACKUP_JSON);
}

/**
 * One live row as the FILE holds it. $forExport is false when the preview encodes a LIVE row to
 * compare it with the file: the binary columns and the payment secrets are encoded the same way
 * either side (a restore keeps this shop's secrets, so they are not a difference), but the second
 * factor is NOT nulled on the live side — a restore really does switch it off, and the preview must
 * show admin_users as changed when it will be.
 */
function backup_encode_row(string $table, array $row, array $binary, bool $forExport = true): array {
    if ($table === 'admin_users' && $forExport) {
        // THE SECOND FACTOR NEVER TRAVELS. A second-factor secret sitting in a file the owner can hand
        // to anyone is a secret that no longer proves anything. The cost, said in the preview: restoring
        // admin_users switches 2FA off, and the owner re-enrols. This is the line that enforces it.
        $row['totp_secret'] = null;
        $row['totp_enabled'] = 0;
        $row['totp_last_step'] = null;
        // A pending emailed sign-in code: a one-time secret, and long expired by any restore.
        if (array_key_exists('email_otp_hash', $row)) $row['email_otp_hash'] = null;
        if (array_key_exists('email_otp_expires', $row)) $row['email_otp_expires'] = null;
    }
    // Both sides, like the payment secrets: a restore keeps this shop's hash, so it is not a difference.
    foreach (BACKUP_REDACT_COLUMNS[$table] ?? [] as $c) {
        if (array_key_exists($c, $row)) $row[$c] = null;
    }
    if ($table === 'settings' && isset(BACKUP_REDACT_SETTINGS[(string) ($row['name'] ?? '')])) {
        $v = json_decode((string) ($row['value'] ?? ''), true);
        if (is_array($v)) {
            foreach (BACKUP_REDACT_SETTINGS[(string) $row['name']] as $k) {
                if (array_key_exists($k, $v)) $v[$k] = null;
            }
            $row['value'] = json_encode($v, BACKUP_JSON);
        } else {
            // Not JSON at all: nothing in it can be told apart from a secret, so none of it travels.
            $row['value'] = null;
        }
    }
    foreach ($binary as $c) {
        if (isset($row[$c])) $row[$c] = base64_encode((string) $row[$c]);
    }
    return $row;
}

/**
 * Writes the whole backup as JSON through $out, one row at a time, and returns the row count per
 * table. Throws on any failure — a half-written backup must never be handed over as a backup.
 *
 * The queries are UNBUFFERED for the duration: PDO's default buffers a whole result set in client
 * memory before the first fetch, so "streamed off a cursor", which the old comment claimed, was one
 * table's worth of photographs held at once. Nothing else may query this connection meanwhile, which
 * is why the metadata is read first and $out must not touch the database.
 */
function backup_write(PDO $db, callable $out): array {
    $meta = backup_meta($db);
    $present = []; $absent = []; $binary = [];
    foreach (BACKUP_TABLES as $t) {
        if (!isset($meta[$t])) { $absent[] = $t; continue; }   // a migration this shop has not run
        $present[] = $t;
        if ($meta[$t]['binary']) $binary[$t] = $meta[$t]['binary'];
    }
    $redacted = [];
    foreach (BACKUP_REDACT_SETTINGS as $name => $keys) $redacted['settings.' . $name] = $keys;
    foreach (BACKUP_REDACT_COLUMNS as $t => $cols) $redacted[$t] = $cols;

    $out('{"format":' . BACKUP_FORMAT
        . ',"exported_at":' . json_encode(gmdate('c'), BACKUP_JSON)
        . ',"binary":' . json_encode((object) $binary, BACKUP_JSON)
        . ',"redacted":' . json_encode((object) $redacted, BACKUP_JSON)
        . ',"absent":' . json_encode($absent, BACKUP_JSON)
        . ',"tables":{');

    $counts = [];
    $buffered = $db->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
    $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
    try {
        foreach ($present as $i => $t) {
            $out(($i ? ',' : '') . json_encode($t, BACKUP_JSON) . ':[');
            $order = $meta[$t]['pk'] ? ' order by `' . implode('`, `', $meta[$t]['pk']) . '`' : '';
            $stmt = $db->query('select * from `' . $t . '`' . $order);
            $n = 0;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $out(($n ? ',' : '') . json_encode(backup_encode_row($t, $row, $meta[$t]['binary']), BACKUP_JSON));
                $n++;
            }
            $stmt->closeCursor();
            $out(']');
            $counts[$t] = $n;
        }
    } finally {
        $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $buffered);
    }
    $out('}}');
    return $counts;
}

// The whole backup as an array. Kept for callers that want one; the routes and the daily file stream.
function backup_build(PDO $db): array {
    $s = '';
    backup_write($db, function (string $chunk) use (&$s) { $s .= $chunk; });
    return json_decode($s, true, 512, JSON_THROW_ON_ERROR);
}

/**
 * What restoring $data would do, table by table, WITHOUT writing anything — selects only.
 * `removed` is the dangerous half of a REPLACE: every row the shop has that the file does not.
 * Live rows are kept as hashes, not rows, so comparing a shop full of photographs costs one row at a
 * time rather than two copies of every picture.
 */
function backup_diff(PDO $db, array $data): array {
    $tables = (array) $data['tables'];
    $meta = backup_meta($db);
    $diff = [];
    $missingHere = [];
    foreach (BACKUP_TABLES as $t) {
        $inFile = array_key_exists($t, $tables) && is_array($tables[$t]);
        $rows = $inFile ? $tables[$t] : [];
        if (!isset($meta[$t])) {
            // In the file, not on this shop: a migration this shop has not run. Restoring would drop
            // those rows on the floor, so backup_restore() refuses until the table exists.
            if ($rows) $missingHere[] = $t;
            $diff[$t] = ['in_file' => $inFile, 'on_this_shop' => false, 'backup_count' => count($rows),
                         'live_count' => 0, 'added' => 0, 'changed' => 0, 'unchanged' => 0, 'removed' => 0];
            continue;
        }
        $pk = $meta[$t]['pk'];
        $live = [];
        $buffered = $db->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
        $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        try {
            $stmt = $db->query('select * from `' . $t . '`');
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                // Compared in the FILE's encoding (base64, redacted), so a row that would be restored
                // byte for byte reads as unchanged.
                $live[backup_key($row, $pk)] = hash('sha256', json_encode(backup_encode_row($t, $row, $meta[$t]['binary'], false), BACKUP_JSON));
            }
            $stmt->closeCursor();
        } finally {
            $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $buffered);
        }
        if (!$inFile) {
            // Not in this backup: kept exactly as it is.
            $diff[$t] = ['in_file' => false, 'on_this_shop' => true, 'backup_count' => 0, 'live_count' => count($live),
                         'added' => 0, 'changed' => 0, 'unchanged' => 0, 'removed' => 0];
            continue;
        }
        $seen = [];
        $added = 0; $changed = 0; $unchanged = 0;
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $key = backup_key($row, $pk);
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            if (!isset($live[$key])) { $added++; continue; }
            // Compare the JSON forms rather than the arrays: values PDO returned as strings must compare
            // equal to the same values decoded from the file, and json_encode is the one place both sides
            // already agree on a canonical form.
            if (hash('sha256', json_encode($row, BACKUP_JSON)) !== $live[$key]) $changed++; else $unchanged++;
        }
        $diff[$t] = [
            'in_file'      => true,
            'on_this_shop' => true,
            'live_count'   => count($live),
            'backup_count' => count($seen),
            'added'        => $added,
            'changed'      => $changed,
            'unchanged'    => $unchanged,
            'removed'      => count(array_diff_key($live, $seen)),
        ];
    }
    return ['tables' => $diff, 'missing_here' => $missingHere];
}

/**
 * Checks EVERY row of the file against the real schema before a single table is touched, and refuses
 * the whole file (store_fail) on anything a genuine export could not contain.
 *
 * The insert in backup_restore() builds its IDENTIFIER LIST from the file's own keys — array_keys($row)
 * — because a genuine export can carry a column this file does not enumerate by hand without the two
 * drifting apart the moment the schema changes. That is safe only because those keys are checked
 * against something real here first; unchecked, a "column name" is an unescaped identifier, and a
 * backup is a file, and a file can be replaced before it is ever uploaded.
 */
function backup_restore_check(array $data, array $meta): void {
    $tables = (array) $data['tables'];
    $format = (int) ($data['format'] ?? 1);
    if ($format < 1) store_fail('bad_backup_file');
    // A newer format may encode a value in a way this code would write into the shop wrongly.
    if ($format > BACKUP_FORMAT) store_fail('backup_newer_format');
    $binaryMap = $format >= 2 && is_array($data['binary'] ?? null) ? $data['binary'] : [];

    foreach (BACKUP_TABLES as $t) {
        if (!array_key_exists($t, $tables)) continue;            // not in this backup: kept as it is
        if (!is_array($tables[$t])) store_fail('bad_backup_file');
        if (!isset($meta[$t])) {
            if ($tables[$t]) store_fail('table_not_on_this_shop:' . $t);
            continue;
        }
        $allowed = array_flip($meta[$t]['cols']);
        $pk = $meta[$t]['pk'];
        $fileBinary = is_array($binaryMap[$t] ?? null) ? $binaryMap[$t] : [];
        foreach ($fileBinary as $col) {
            if (!is_string($col) || !in_array($col, $meta[$t]['binary'], true)) store_fail('bad_backup_file');
        }
        foreach ($tables[$t] as $row) {
            if (!is_array($row)) store_fail('bad_backup_file');
            foreach ($row as $col => $value) {
                if (!isset($allowed[$col])) store_fail('bad_backup_file');
                if ($value !== null && !is_scalar($value)) store_fail('bad_backup_file');
            }
            foreach ($pk as $c) {
                if (!array_key_exists($c, $row) || $row[$c] === null || $row[$c] === '') store_fail('bad_backup_file');
            }
            foreach ($fileBinary as $c) {
                if (isset($row[$c]) && (!is_string($row[$c]) || base64_decode($row[$c], true) === false)) store_fail('bad_backup_file');
            }
            if ($t === 'settings' && isset(BACKUP_REDACT_SETTINGS[(string) ($row['name'] ?? '')])
                && ($row['value'] ?? null) !== null && !is_array(json_decode((string) $row['value'], true))) {
                store_fail('bad_backup_file');
            }
        }
    }
}

// The redacted settings row as it will be written: every secret this shop has saved is kept; a format-1
// file's own secret is used only where the shop has none (a restore onto an empty database). The rest
// of the row is the file's, as for every other row — so a backup taken before the Payments screen was
// set up still puts the IDs and the mode back as they were then, and only the secrets survive it.
function backup_restore_settings_row(array $row, array $liveValues): array {
    $name = (string) ($row['name'] ?? '');
    $keys = BACKUP_REDACT_SETTINGS[$name] ?? null;
    if ($keys === null) return $row;
    $file = ($row['value'] ?? null) === null ? [] : (array) json_decode((string) $row['value'], true);
    $live = $liveValues[$name] ?? [];
    foreach ($keys as $k) {
        $l = $live[$k] ?? null;
        $f = $file[$k] ?? null;
        if (is_string($l) && $l !== '') $file[$k] = $l;
        elseif (is_string($f) && $f !== '') $file[$k] = $f;
        elseif (array_key_exists($k, $file)) $file[$k] = '';
    }
    $row['value'] = json_encode($file, JSON_UNESCAPED_UNICODE);
    return $row;
}

// Who a customer IS, for carrying a password across a restore: the email they sign in with, never the id.
function backup_customer_key(array $row): string {
    return strtolower(trim((string) ($row['email'] ?? '')));
}

// A customer row as it will be written. This shop's hash for the same email wins (the customer may have
// changed the password since the backup); a format-2 file taken before 2026-10-07 still carries its own
// hash, used only where this shop has none; otherwise a random hash that matches no password.
function backup_restore_customer_row(array $row, array $liveHashes): array {
    $live = $liveHashes[backup_customer_key($row)] ?? '';
    $file = $row['password_hash'] ?? null;
    if ($live !== '') $row['password_hash'] = $live;
    elseif (!is_string($file) || $file === '') $row['password_hash'] = password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
    return $row;
}

/**
 * REPLACES every table the file names with the file's rows, in one transaction; keeps every table it
 * does not name. Returns per table {before, written} or {before, kept}. Refuses (store_fail) before
 * writing anything if the file is not a genuine export — see backup_restore_check().
 */
function backup_restore(PDO $db, array $data): array {
    $meta = backup_meta($db);
    backup_restore_check($data, $meta);
    $tables = (array) $data['tables'];
    $format = (int) ($data['format'] ?? 1);
    $binaryMap = $format >= 2 && is_array($data['binary'] ?? null) ? $data['binary'] : [];

    // The secrets this shop has saved, read before the settings table is emptied.
    $liveSecrets = [];
    if (isset($meta['settings']) && array_key_exists('settings', $tables)) {
        $q = $db->prepare('select value from settings where name = ?');
        foreach (array_keys(BACKUP_REDACT_SETTINGS) as $name) {
            $q->execute([$name]);
            $v = json_decode((string) ($q->fetchColumn() ?: ''), true);
            if (is_array($v)) $liveSecrets[$name] = $v;
        }
    }

    // Every customer's hash, by email, read before the table is emptied (see BACKUP_REDACT_COLUMNS).
    $liveHashes = [];
    if (isset($meta['customers']) && array_key_exists('customers', $tables)) {
        foreach ($db->query('select id, email, password_hash from customers')->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $liveHashes[backup_customer_key($c)] = (string) $c['password_hash'];
        }
    }

    $result = [];
    $db->beginTransaction();
    try {
        $db->exec('set foreign_key_checks = 0');
        foreach (BACKUP_TABLES as $t) {
            if (!isset($meta[$t])) continue;
            $before = (int) $db->query('select count(*) from `' . $t . '`')->fetchColumn();
            if (!array_key_exists($t, $tables)) { $result[$t] = ['before' => $before, 'kept' => true]; continue; }

            $db->exec('delete from `' . $t . '`');
            $binary = array_flip(is_array($binaryMap[$t] ?? null) ? $binaryMap[$t] : []);
            $written = 0;
            $stmts = [];
            $settingsInFile = [];
            foreach ($tables[$t] as $row) {
                if ($t === 'customers') $row = backup_restore_customer_row($row, $liveHashes);
                if ($t === 'settings') {
                    $row = backup_restore_settings_row($row, $liveSecrets);
                    $settingsInFile[(string) ($row['name'] ?? '')] = true;
                }
                $cols = array_keys($row);
                $sig = implode(',', $cols);
                $stmts[$sig] ??= $db->prepare('insert into `' . $t . '` (`' . implode('`, `', $cols) . '`) values ('
                                            . implode(', ', array_fill(0, count($cols), '?')) . ')');
                $st = $stmts[$sig];
                $i = 1;
                foreach ($row as $col => $value) {
                    if ($value === null) {
                        $st->bindValue($i, null, PDO::PARAM_NULL);
                    } elseif (isset($binary[$col])) {
                        $st->bindValue($i, base64_decode((string) $value, true), PDO::PARAM_LOB);
                    } else {
                        $st->bindValue($i, is_bool($value) ? (int) $value : (string) $value, PDO::PARAM_STR);
                    }
                    $i++;
                }
                $st->execute();
                $written++;
            }
            // A FILE WITH NO ROW AT ALL for a redacted setting — a backup taken before the Payments
            // screen was first saved, so there was no `knet` row to take. Replacing the table would
            // otherwise delete this shop's saved secrets for good: no backup holds them, by design.
            // So the secrets alone are written back (every other key absent = "use the file", which is
            // what that backup's shop had); the IDs and the mode go back as the file has them — none.
            if ($t === 'settings') {
                foreach ($liveSecrets as $name => $live) {
                    if (isset($settingsInFile[$name])) continue;
                    $keep = [];
                    foreach (BACKUP_REDACT_SETTINGS[$name] as $k) {
                        if (is_string($live[$k] ?? null) && $live[$k] !== '') $keep[$k] = $live[$k];
                    }
                    if (!$keep) continue;
                    $db->prepare('insert into settings (name, value) values (?, ?)')
                       ->execute([$name, json_encode($keep, JSON_UNESCAPED_UNICODE)]);
                }
            }
            $result[$t] = ['before' => $before, 'written' => $written];
        }
        $db->exec('set foreign_key_checks = 1');
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        try { $db->exec('set foreign_key_checks = 1'); } catch (Throwable $ignored) {}
        error_log('backup_restore: ' . $e->getMessage());
        store_fail('restore_failed', 500);
    }
    return $result;
}
