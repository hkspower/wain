<?php
/**
 * Switch KNET to the OFFICIAL redirect (the CBK hosted page, tij_MerchPayType=1)
 * on the LIVE shop, by saving mode = 'official' in the `knet` settings row —
 * exactly what /backends → Payments → Integration does. 2026-09-30.
 *
 *   wget -nv -O k.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/set-knet-mode.php && php k.php
 *
 * The database row wins over knet/config.php's own 'mode', so knet/config.php is
 * not touched. Other keys in the row are kept as they are. IDEMPOTENT, and it
 * reports STATE (the mode now saved, and whether the CBK credentials are real),
 * so a per-minute job's last output reads the same on every run. Undo: save
 * mode "Use the file" in the panel, or run this with MODE=legacy edited in.
 * Prints no credential value.
 */
header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
const MODE = 'official';

$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$c = is_file("$root/api/config.php") ? require "$root/api/config.php" : null;
if (!is_array($c)) { line('config.php not found — nothing done'); exit; }
try {
    $db = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) { line('database unreachable: ' . $e->getMessage()); exit; }

try {
    $q = $db->prepare("select value from settings where name = 'knet'");
    $q->execute();
    $raw = $q->fetchColumn();
    $val = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (!is_array($val)) { line('the saved knet row is not valid JSON — nothing done'); exit; }
    if (($val['mode'] ?? '') !== MODE) {
        $val['mode'] = MODE;
        $db->prepare("replace into settings (name, value) values ('knet', ?)")->execute([json_encode($val, JSON_UNESCAPED_UNICODE)]);
    }
    $q->execute();
    $now = json_decode((string) $q->fetchColumn(), true) ?: [];
} catch (Throwable $e) { line('FAILED: ' . $e->getMessage()); exit; }

$ph = static fn ($v) => ($t = strtoupper(trim((string) $v))) === '' || str_starts_with($t, 'YOUR_') || str_starts_with($t, 'SANDBOX_NOT_A_REAL');
$pay = is_file("$root/pay/config.php") ? (@require "$root/pay/config.php") : [];
$eff = static fn ($saved, $file) => (string) ($now[$saved] ?? '') !== '' ? $now[$saved] : ($pay[$file] ?? '');
$ready = !$ph($eff('cbk_client_id', 'client_id')) && !$ph($eff('cbk_client_secret', 'client_secret')) && !$ph($eff('cbk_encrp_key', 'encrp_key'));
$env = in_array($now['env'] ?? '', ['test', 'production'], true) ? $now['env'] : (($pay['env'] ?? '') === 'production' ? 'production' : 'test');
line('STATE knet.mode=' . ($now['mode'] ?? '?') . ' cbkCredentialsReal=' . ($ready ? 'yes' : 'NO') . ' cbkEnv=' . $env);
line($ready ? 'READY — KNET now redirects to the official CBK hosted page.'
            : 'SWITCHED, BUT CBK credentials are still placeholders: KNET cannot take a payment until they are entered in /backends → Payments.');
