<?php
/**
 * Payment status for the Payments screen — what each method would do right now.
 *
 * READS the live configuration the way the payment endpoints read it (file
 * overlaid by what /backends saved) and, for the CBK gateway, makes ONE real
 * Authenticate call so "the credentials are accepted" is a measurement rather
 * than a guess. It never charges anything, never creates an order, and NEVER
 * returns a credential: only booleans, the environment, the host it reached
 * and the bank's own short message.
 */

require_once __DIR__ . '/../knet/knet.php';
require_once __DIR__ . '/../pay/cbk.php';

function payment_check_placeholder($v): bool {
    $v = strtoupper(trim((string) $v));
    return $v === '' || str_starts_with($v, 'YOUR_') || str_starts_with($v, 'SANDBOX_NOT_A_REAL');
}

/** Can the gateway's host be reached at all? Any HTTP answer counts. */
function payment_check_reach(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6,
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch) ? mb_substr((string) curl_error($ch), 0, 120) : '';
    curl_close($ch);
    return ['reachable' => $code > 0, 'http' => $code, 'error' => $err, 'host' => (string) parse_url($url, PHP_URL_HOST)];
}

/** One Authenticate call, fresh (never the cached token), with the given config. */
function payment_check_cbk_login(array $cfg): array {
    $url = cbk_base($cfg) . '/ePay/api/cbk/online/pg/merchant/Authenticate';
    try {
        [$status, $res] = cbk_http('POST', $url, $cfg, [
            'ClientId' => $cfg['client_id'], 'ClientSecret' => $cfg['client_secret'], 'ENCRP_KEY' => $cfg['encrp_key'],
        ]);
    } catch (Throwable $e) {
        return ['ok' => false, 'message' => 'could not reach the gateway'];
    }
    if ($status === 0) return ['ok' => false, 'message' => 'could not reach the gateway'];
    if ($status === 200 && is_array($res) && ($res['Status'] ?? '') === '1' && !empty($res['AccessToken'])) {
        return ['ok' => true, 'message' => 'the bank accepted the credentials'];
    }
    $msg = is_array($res) ? mb_substr(strip_tags((string) ($res['Message'] ?? 'refused')), 0, 120) : 'refused';
    return ['ok' => false, 'message' => 'the bank refused them: ' . $msg];
}

function payment_check(PDO $db, bool $live = true): array {
    $rules = store_rules($db);
    $enabled = $rules['payment_methods'];

    // ---- CBK hosted gateway (card, T-Pay, and KNET when mode is official)
    $cbk = ['configured' => false, 'env' => 'test'];
    try {
        $cfg = cbk_config();
        $set = fn ($k) => !payment_check_placeholder($cfg[$k] ?? '');
        $cbk = [
            'configured' => $set('client_id') && $set('client_secret') && $set('encrp_key'),
            'client_id_set' => $set('client_id'), 'client_secret_set' => $set('client_secret'), 'encrp_key_set' => $set('encrp_key'),
            'env' => (($cfg['env'] ?? '') === 'production') ? 'production' : 'test',
        ];
        if ($live) {
            $cbk['reach'] = payment_check_reach(cbk_base($cfg));
            $cbk['login'] = $cbk['configured'] ? payment_check_cbk_login($cfg)
                                               : ['ok' => false, 'message' => 'credentials are not filled in yet'];
        }
    } catch (Throwable $e) { $cbk['error'] = 'config unreadable'; }

    // ---- KNET
    $knet = ['mode' => null];
    try {
        $kc = knet_config();
        $mode = knet_mode($kc);
        $knet = ['mode' => $mode, 'env' => (($kc['env'] ?? '') === 'test') ? 'test' : 'production'];
        if ($mode === 'legacy') {
            $knet['configured'] = knet_legacy_configured($kc);
            if ($live) $knet['reach'] = payment_check_reach(knet_gateway_url($kc));
        } else {
            $knet['configured'] = $cbk['configured'];   // official KNET is the CBK gateway
        }
    } catch (Throwable $e) { $knet['error'] = 'config unreadable'; }

    $liveOk = static fn (array $g) => !$g['configured'] ? false
        : (!isset($g['reach']) ? null : ($g['reach']['reachable'] && (!isset($g['login']) || $g['login']['ok'])));

    $methods = [
        'knet' => ['enabled' => in_array('knet', $enabled, true), 'configured' => (bool) ($knet['configured'] ?? false),
                   'working' => $liveOk($knet)],
        'tpay' => ['enabled' => in_array('tpay', $enabled, true), 'configured' => $cbk['configured'],
                   'working' => $liveOk($cbk)],
        'cod'  => ['enabled' => in_array('cod', $enabled, true), 'configured' => true, 'working' => true],
    ];
    foreach ($methods as $k => &$m) {
        $m['ready'] = $m['enabled'] && $m['configured'] && $m['working'] !== false;
        // A method that is ON while it cannot take money is the one thing worth shouting about.
        $m['warning'] = $m['enabled'] && (!$m['configured'] || $m['working'] === false);
    }
    unset($m);

    return [
        'methods' => $methods, 'knet' => $knet, 'cbk' => $cbk,
        'cod' => ['open_max' => (int) $rules['cod_open_max'], 'max_fils' => (int) ($rules['cod_max_fils'] ?? 0)],
        'checked_at' => gmdate('c'),
    ];
}
