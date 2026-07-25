<?php
// Sporta mobile API — JSON endpoints for the Flutter app.
// Place at public_html/knet/api/. Routes:
//   GET  /knet/api/?r=products          -> catalog
//   POST /knet/api/?r=order             -> {items:[{slug,qty,size}], lang} -> {track_id, pay_url}
//   GET  /knet/api/?r=status&id=TRACK   -> {track_id, amount, payment_status}
//
// The order amount is computed SERVER-SIDE from stored prices — the app never
// sends a price. Card entry stays on the bank's hosted page (KNET/PCI rule);
// the app opens pay_url and returns via the deep link set in config.

declare(strict_types=1);
require __DIR__ . '/../knet.php';
knet_require_https();
$cfg = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { exit; }

function out($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Supabase REST helper (service key stays on the server) ---
function sb(array $cfg, string $method, string $path, ?array $body = null) {
    if (($cfg['supabase_url'] ?? '') === '') return null;
    $ch = curl_init(rtrim($cfg['supabase_url'], '/') . '/rest/v1/' . $path);
    $headers = [
        'apikey: ' . $cfg['supabase_service_key'],
        'Authorization: Bearer ' . $cfg['supabase_service_key'],
        'Content-Type: application/json',
        'Prefer: return=representation',
    ];
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12,
             CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers];
    if ($body !== null) $opts[CURLOPT_POSTFIELDS] = json_encode($body);
    curl_setopt_array($ch, $opts);
    $res = curl_exec($ch);
    curl_close($ch);
    return $res === false ? null : json_decode((string)$res, true);
}

$r = $_GET['r'] ?? '';

// ---------------- products ----------------
if ($r === 'products') {
    $rows = sb($cfg, 'GET', 'products?select=slug,name_en,name_ar,desc_en,desc_ar,price,category,image&active=eq.true');
    if (!is_array($rows)) out(['products' => []]);
    out(['products' => array_map(fn($p) => [
        'slug' => $p['slug'],
        'name' => ['en' => $p['name_en'], 'ar' => $p['name_ar']],
        'desc' => ['en' => $p['desc_en'] ?? '', 'ar' => $p['desc_ar'] ?? ''],
        'price' => (float)$p['price'],
        'category' => $p['category'],
        'image' => $p['image'],
    ], $rows)]);
}

// ---------------- create order ----------------
if ($r === 'order') {
    $in = json_decode(file_get_contents('php://input') ?: '[]', true);
    $items = $in['items'] ?? [];
    if (!is_array($items) || !$items) out(['error' => 'empty_cart'], 400);

    // Delegates to the create_order function — the same single, guarded door
    // the website uses. It validates the delivery details, resolves slugs, and
    // creates the order and its items in one transaction.
    //
    // The old code here did the work inline and silently `continue`d past any
    // slug it could not resolve, which produced an order totalling zero and a
    // dead end at the payment step. create_order raises 'unavailable_<slug>'
    // instead, so the app can name the item.
    $trackId = 'SP' . strtoupper(bin2hex(random_bytes(4)));
    $res = sb($cfg, 'POST', 'rpc/create_order', [
        'p_track_id' => $trackId,
        'p_items'    => array_map(fn($i) => [
            'slug' => (string)($i['slug'] ?? ''),
            'qty'  => max(1, (int)($i['qty'] ?? 1)),
        ], array_values($items)),
        'p_customer' => (array)($in['customer'] ?? []),
    ]);

    // PostgREST returns {message: 'invalid_phone', ...} for a raised exception.
    if (!is_array($res) || !isset($res['track_id'])) {
        $token = is_array($res) ? (string)($res['message'] ?? 'order_failed') : 'order_failed';
        out(['error' => $token], preg_match('/^(invalid_|missing_|too_long_|empty_|unavailable_|cart_too_large)/', $token) ? 400 : 500);
    }

    $lang = ($in['lang'] ?? 'en') === 'ar' ? 'ar' : 'en';
    out([
        'track_id' => $res['track_id'],
        'amount'   => $res['amount'],
        'pay_url' => rtrim($cfg['result_page_url'] ? dirname($cfg['response_url']) : '', '/')
            . '/pay.php?trackid=' . rawurlencode($res['track_id']) . '&lang=' . $lang,
    ]);
}

// ---------------- order status ----------------
if ($r === 'status') {
    $id = trim((string)($_GET['id'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9]{1,30}$/', $id)) out(['error' => 'bad_id'], 400);
    $rows = sb($cfg, 'GET', 'orders?select=track_id,amount,payment_status&track_id=eq.' . rawurlencode($id));
    if (!is_array($rows) || !$rows) out(['error' => 'not_found'], 404);
    out($rows[0]);
}

out(['error' => 'unknown_route'], 404);
