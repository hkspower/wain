<?php
/**
 * Saves ONE value — the CBK Client ID of the TEST set — into the live `knet` settings row, exactly as
 * /backends → Payments would (cbk_test_client_id). Asked for by the owner on 2026-10-15.
 *
 * THE VALUE IS AN ARGUMENT, NOT IN THIS FILE. This repository is public; the Client ID is given on the
 * cron command line only (`php r.php <client id>`), so it is never committed.
 *
 *   wget -nv -O r.php <raw URL of this file at a full commit SHA> && php r.php <client id>
 *
 * Changes nothing else in the row: every other key, including both secret sets, is read and written back
 * untouched. The previous row is backed up to ~/settings-knet-<timestamp>.json (0600) first.
 * Validated like the panel does: printable, no spaces, 1-200 characters, not a placeholder.
 * Ends with STATE, so a later run reads the same answer. Prints the last three characters only.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$id = (string) ($argv[1] ?? '');
if ($id === '' || $id !== trim($id) || !preg_match('/^[\x21-\x7E]{1,200}$/', $id)
    || str_starts_with(strtoupper($id), 'YOUR_') || str_starts_with(strtoupper($id), 'SANDBOX_NOT_A_REAL')) {
    line('REFUSED: give the Client ID as the one argument (printable, no spaces, not a placeholder)');
    exit;
}

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('api/config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('api/config.php did not return an array — nothing done'); exit; }
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) { line('database unreachable — nothing done'); exit; }

$q = $db->prepare('select value from settings where name = ?');
$q->execute(['knet']);
$raw = $q->fetchColumn();
$val = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
if (!is_array($val)) { line('the knet row is not readable JSON — nothing done, nothing overwritten'); exit; }

if ((string) ($val['cbk_test_client_id'] ?? '') !== $id) {
    if (is_string($raw) && $raw !== '') {
        $bak = '/home/u130124229/settings-knet-' . gmdate('Ymd-His') . '.json';
        if (@file_put_contents($bak, $raw) === false) { line('could not write the backup — nothing done'); exit; }
        @chmod($bak, 0600);
        line('backup ' . basename($bak));
    }
    $val['cbk_test_client_id'] = $id;
    $db->prepare('insert into settings (name, value) values (?, ?) on duplicate key update value = values(value)')
       ->execute(['knet', json_encode($val, JSON_UNESCAPED_UNICODE)]);
}

// STATE, read back from the database rather than from what was just written.
$q->execute(['knet']);
$back = json_decode((string) $q->fetchColumn(), true) ?: [];
$saved = (string) ($back['cbk_test_client_id'] ?? '');
$set = fn($k) => ((string) ($back[$k] ?? '')) !== '' ? 'yes' : 'no';
line('STATE testClientId=' . ($saved === $id ? 'saved:...' . substr($saved, -3) : 'MISMATCH')
    . ' testSecret=' . $set('cbk_test_client_secret') . ' testEncrpKey=' . $set('cbk_test_encrp_key')
    . ' prodClientId=' . $set('cbk_client_id') . ' env=' . ((string) ($back['env'] ?? '') ?: 'file-default')
    . ' keys=' . count($back));
