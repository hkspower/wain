<?php
/**
 * Creates the KNET response table on the live database (K-064 §3.5.2). Idempotent: run it again, nothing changes.
 * Reads api/config.php for the database login, as migrate-customers.php does. Changes nothing else.
 *
 *   wget -nv -O m.php <raw URL of this file at a full commit SHA> && php m.php
 *
 * Its statement is the one in knet/responses.mysql.sql, repeated here so this file is the whole migration.
 * Ends with STATE, so a later run reads the same answer.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('api/config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('api/config.php did not return an array — nothing done'); exit; }

try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) {
    line('database unreachable: ' . $e->getMessage());
    exit;
}

$sql = "create table if not exists knet_responses (
  id          bigint unsigned not null auto_increment primary key,
  track_id    varchar(30) not null,
  received_at timestamp not null default current_timestamp,
  encrypted   mediumtext not null,
  plaintext   text not null,
  key ix_knet_responses_track (track_id)
) engine = innodb default charset = utf8mb4";

try {
    $db->exec($sql);
    line('knet_responses table: ok');
} catch (Throwable $e) {
    line('knet_responses table FAILED: ' . $e->getMessage());
    exit;
}

$cols = $db->query('show columns from knet_responses')->fetchAll(PDO::FETCH_COLUMN);
$need = ['id', 'track_id', 'received_at', 'encrypted', 'plaintext'];
$missing = array_diff($need, $cols);
line('STATE knet_responses=' . ($missing ? 'INCOMPLETE:' . implode(',', $missing) : 'yes') . ' rows=' . (int) $db->query('select count(*) from knet_responses')->fetchColumn());
