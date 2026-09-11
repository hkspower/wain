<?php
/**
 * Publish the category tiles from the repository to the live shop.
 *
 *   php /home/<user>/publish-cats.php
 *
 * WHY. A folder audit found all twenty cats/art-* files differing between the
 * repository and the server, the server's consistently smaller. The repository
 * is the source of truth for artwork, so this brings the shop to it.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. This file comes over plain HTTP from a
 * PUBLIC repository, so it is written so that anyone able to influence that
 * fetch gains nothing:
 *
 *   - It writes ONLY the twenty paths named below, all under cats/. There is
 *     no parameter, no loop over a directory, nothing derived from input.
 *   - Every file is checked against the sha256 recorded here BEFORE it is
 *     written. A byte out of place and it is refused, not written.
 *   - It is pinned to one COMMIT, not a branch, so what it fetches cannot
 *     change under it.
 *   - Each write goes to a temporary file and is renamed into place, so a
 *     shopper never sees half a picture.
 *   - It deletes nothing.
 *
 * Re-running it is a no-op: a file already matching its hash is skipped.
 */

$COMMIT = '0e9a78ddbe5a2c2e6490c98594ec54f7fd48f726';
$ROOT   = '/home/u130124229/domains/sporta.com.kw/public_html';
$BASE   = 'https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT
        . '/sporta-site/public_html/';

// path => sha256 of the bytes that must arrive.
$FILES = [
    "cats/mobile/art-men.jpg" => "6537b1c8233c9168661d625484da32f820511b913fb0deeb8d902dcd9f25d3c2",
    "cats/mobile/art-men.webp" => "4f097dd443fc8cbb24e4d6909e8e0ab8fec01f2ec2f8ec35b3e9be094404cdc3",
    "cats/mobile/art-men-rtl.jpg" => "bae72ff8416bce5b0a5ee11129738709f788ff868e13bcb29d3f3b5ad6729373",
    "cats/mobile/art-men-rtl.webp" => "a012032744381a57058ef1fa798d623ce1f8a01d355e86ac062976f6d27228ca",
    "cats/mobile/art-women.jpg" => "17ea92c07c35388232b7cb0bcfe5c273d90797694c937b4ce576b1d2ffb37f14",
    "cats/mobile/art-women.webp" => "39f47a5bf0c652e5e8cdedc9386e74ffab3042dfc9241124f36b2cb105a6927b",
    "cats/mobile/art-accessories.jpg" => "9dcb9e5daff6eeaf1467a51d8a2edbc3648f2eea3f30a4105be9805957e8fd96",
    "cats/mobile/art-accessories.webp" => "8561f81b3072e7d974ba6ad33aae8ac6c88a3d0740d2793aff85736a6833b7ea",
    "cats/mobile/art-outlet.jpg" => "451a9315fcf5aa0d2fa6f49f6511980776c31c78862a1da621e8fc7d4f1af219",
    "cats/mobile/art-outlet.webp" => "389d0ee80b953f2e49fdef0f91c80e3e6a238e316b4833be097b9c1d8036195b",
    "cats/desktop/art-men.jpg" => "812b41cd23cd2b2cf9ec5bebc98f0a9f16aec57c3bd5ada86a902211876f4782",
    "cats/desktop/art-men.webp" => "03fb7be9e5011b91c00b03d927731d9ef9060acb8be015bc2a2ec072adfe4242",
    "cats/desktop/art-men-rtl.jpg" => "218d84c097ed92afe7270414d01fc6b9450d5950a7bc58739629136edff6bbf4",
    "cats/desktop/art-men-rtl.webp" => "50818ba6650dc9ce77564dccd86ec9a358a417254278fe8b953a5dc4977eda9e",
    "cats/desktop/art-women.jpg" => "c112320cd2fb4e46005d102a4b8fcdb2c4a16f1bc638482e6afba773ecd23760",
    "cats/desktop/art-women.webp" => "5e229721e464ea64894fcb41f2a73ed304360556015185a49df467f826d2451a",
    "cats/desktop/art-accessories.jpg" => "6851ebb777ae4a69bcf44b471d48c904ac5d5eb7d6db8a2a7cb7cb62843e9847",
    "cats/desktop/art-accessories.webp" => "76e935a6ff28385d70692fd77e4bccb0224ac7c62741f109d76e022f4b994c0f",
    "cats/desktop/art-outlet.jpg" => "8c0675b4f9ed344d68e46ff7c168dc5b49b5877c4fd9ea3e58056a892f9ce7a1",
    "cats/desktop/art-outlet.webp" => "27a668c93acd01929865f1f34346b352060d4c77bcbed1e287066fb4455e5cf0",
];

$wrote = 0; $same = 0; $bad = []; $failed = [];

foreach ($FILES as $rel => $want) {
    $target = $ROOT . '/' . $rel;

    // Already correct? Then this run has nothing to do for it.
    if (is_file($target) && hash_file('sha256', $target) === $want) { $same++; continue; }

    // One at a time, deliberately. Three parallel fetches of this host
    // returned EMPTY FILES earlier in this project — served to the first
    // request and dropped for the others — and wget's -q hid it. Sequential
    // is slower and it is the reason every file here arrives whole.
    $ch = curl_init($BASE . $rel);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200 || $body === '') { $failed[] = $rel; continue; }
    if (hash('sha256', $body) !== $want) { $bad[] = $rel; continue; }

    $dir = dirname($target);
    if (!is_dir($dir)) { $failed[] = $rel; continue; }

    $tmp = $dir . '/.pub-' . bin2hex(random_bytes(6));
    $ok  = @file_put_contents($tmp, $body) === strlen($body);
    if ($ok) $ok = @rename($tmp, $target) || @copy($tmp, $target);
    @unlink($tmp);

    if ($ok && is_file($target) && hash_file('sha256', $target) === $want) { @chmod($target, 0644); $wrote++; }
    else $failed[] = $rel;
}

echo 'CATS wrote=' . $wrote . ' alreadyOk=' . $same
   . ' hashMismatch=' . (count($bad) ? implode(',', $bad) : '0')
   . ' failed=' . (count($failed) ? implode(',', $failed) : '0')
   . ' of=' . count($FILES) . "\n";
