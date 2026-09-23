<?php
/**
 * READ-ONLY. One-line answers about what the 2026-09-23 publish changed, asked
 * of the live server. Prints states, never a secret: ai_key is reported as
 * set/empty only.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-verify-0923.php && php r.php
 */
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$root = '/home/u130124229/domains/sporta.com.kw/public_html';

$get = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 8,
    ]);
    $raw = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hs = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [$code, substr($raw, 0, $hs), substr($raw, $hs)];
};
$cc = static function (string $h): string {
    return preg_match('~^cache-control:\s*(.+)$~mi', $h, $m) ? trim($m[1]) : 'NONE';
};

[$c, $h, $b] = $get('/llms.txt');
line('LLMS code=' . $c . ' generated=' . (str_contains($b, 'Every fact above is generated') ? 'yes' : 'NO')
   . ' cod=' . (str_contains($b, 'cash on delivery') ? 'yes' : 'NO')
   . ' returnDays=' . (preg_match('~within (\d+) days~', $b, $m) ? $m[1] : '?'));

foreach (['/assets/home-products.js', '/assets/crm.js', '/assets/theme.js'] as $p) {
    [$c, $h] = $get($p);
    line('CACHE ' . $p . ' code=' . $c . ' cc=' . $cc($h));
}

$cfg = @include $root . '/api/config.php';
line('AI ai_key=' . ((is_array($cfg) && trim((string) ($cfg['ai_key'] ?? '')) !== '') ? 'set' : 'EMPTY'));

try {
    $db = new PDO('mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . ($cfg['db_name'] ?? ''),
                  (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
                  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $t = $db->query("show tables like 'customer_notes'")->fetchColumn();
    line('DB customer_notes=' . ($t ? 'exists' : 'not-yet (created on first save)'));
} catch (Throwable $e) {
    line('DB unreadable: ' . get_class($e));
}
