<?php
/**
 * Everything today's work touches, asked the way a SHOPPER asks it.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-shopper-check.php && php r.php
 *
 * READ-ONLY. GETs and conditional GETs over the PUBLIC name. Nothing is
 * written; no configuration value is printed.
 *
 * WHY A SECOND PASS, AND WHY THIS ONE. The first verification of today's
 * publish asked the ORIGIN — file hashes, mtimes, and behaviour over
 * `https://127.0.0.1` with a Host header. All of that is necessary and none of
 * it is what a customer in Kuwait receives, because that request goes through
 * `hcdn` first. live-edge-check.php closed the gap for `/` and `/shop` and
 * stopped there.
 *
 * So this asks the edge about the things the first pass never put to it:
 *
 *   rulesFeed     ?r=slides carries the six public shop rules THROUGH the CDN.
 *                 The storefront reads its delivery fee and returns window from
 *                 here; a CDN serving a stale copy would mean the owner changes
 *                 a number in /backends and no shopper sees it.
 *   feed304       and that feed still revalidates, so the saving holds at the
 *                 edge as well as at the origin.
 *   noLeak        and the three internal limits are STILL absent from it. This
 *                 is asked at the edge deliberately: a CDN can hold a response
 *                 from before a fix, so "the origin does not leak" and "nothing
 *                 is serving a leak" are different claims.
 *   swVersion     the worker string a returning browser compares against its
 *                 own, read from the copy the CDN serves rather than from disk.
 *   card          /assets/rules.js answers at the edge, and the shell served at
 *                 the edge references it. A file nobody loads is not shipped.
 *   product       a THIRD seo.php route revalidates — `/` and `/shop` were
 *                 already proven, and a product page is the one whose ETag
 *                 depends on the database rather than only on the shell.
 *
 * WHAT A GOOD RUN LOOKS LIKE: every `=ok`, `304` on both revalidations,
 * `noLeak=ok`, and `swVersion=v10-refresh1`. Anything else is worth reading
 * slowly — particularly `noLeak`, where the failure is a disclosure rather than
 * a slowdown.
 */

$PUBLIC = 'https://www.sporta.com.kw';

/** One request over the public name — through the CDN, like a shopper. */
function edge(string $path, array $extra = []): array
{
    $ch = curl_init('https://www.sporta.com.kw' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_HTTPHEADER     => $extra,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $raw  = (string) curl_exec($ch);
    $hs   = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    $head = substr($raw, 0, $hs);
    return [
        'code' => $code,
        'etag' => preg_match('/^etag:\s*(.+)$/im', $head, $m) ? trim($m[1]) : '',
        'cdn'  => preg_match('/^x-hcdn-cache-status:\s*(.+)$/im', $head, $m2) ? trim($m2[1]) : '-',
        'body' => substr($raw, $hs),
        'len'  => strlen(substr($raw, $hs)),
        'err'  => $err,
    ];
}

/* ---------------------------------------------------- the shop's own rules */
$slides = edge('/api/api.php?r=slides');
$j = json_decode($slides['body'], true);
$r = is_array($j) && isset($j['rules']) && is_array($j['rules']) ? $j['rules'] : null;

$feed304 = $slides['etag'] !== ''
    ? edge('/api/api.php?r=slides', ['If-None-Match: ' . $slides['etag']])['code']
    : 0;

/* The three that must never be public. Named individually rather than counted:
   a count would go quietly wrong if the public set ever grew. */
$leaked = [];
foreach (['cod_open_max', 'discount_max_pct', 'review_reward_pct'] as $k) {
    if ($r !== null && array_key_exists($k, $r)) $leaked[] = $k;
}

/* ------------------------------------------------------------- the worker */
$sw = edge('/sw.js');
$ver = preg_match("/const VERSION = '([^']+)'/", $sw['body'], $m) ? $m[1] : 'UNREADABLE';

/* --------------------------------------------------------------- the card */
$card  = edge('/assets/rules.js');
$shell = edge('/');

/* ------------------------------------------------ a database-backed route */
/* Discovered from the live catalogue rather than named: a slug written here
   would go stale the day the owner renames a product, and the run would report
   a 404 as a caching fault. */
$prodPath = null;
$products = json_decode(edge('/api/api.php?r=products')['body'], true);
$list = is_array($products) ? ($products['products'] ?? $products) : [];
if (is_array($list) && isset($list[0]['slug'])) $prodPath = '/product/' . $list[0]['slug'];

$prod = $prodPath !== null ? edge($prodPath) : null;
$prod304 = ($prod && $prod['etag'] !== '')
    ? edge($prodPath, ['If-None-Match: ' . $prod['etag']])['code'] : 0;

echo 'SHOPPER'
   . ' rulesFeed=' . ($r === null ? 'MISSING' : count($r))
   . ' feed304=' . $feed304
   . ' noLeak=' . ($r === null ? 'unknown' : (count($leaked) ? 'LEAKED:' . implode(',', $leaked) : 'ok'))
   . ' feedCdn=' . $slides['cdn']
   . ' | swVersion=' . $ver
   . ' card=' . $card['code'] . '/' . $card['len']
   . ' cardTag=' . (strpos($shell['body'], '/assets/rules.js') !== false ? 'ok' : 'MISSING')
   . ' shell=' . $shell['code'] . '/' . $shell['len']
   . ' | product=' . ($prodPath === null ? 'NO-SLUG'
        : $prod['code'] . '/' . $prod['len'] . ' product304=' . $prod304)
   . ($shell['err'] !== '' ? ' ERR=' . $shell['err'] : '')
   . "\n";
