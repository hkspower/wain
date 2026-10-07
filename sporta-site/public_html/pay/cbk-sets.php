<?php
// Shared by pay/cbk.php (the gateway) and api/admin.php (the panel's readiness report), so the
// two can never disagree about which credentials a mode uses. Functions only; nothing runs.

/**
 * Which saved credentials a mode uses. PRODUCTION uses the production set (cbk_*) ONLY — a test
 * credential must never reach the live bank. TEST uses the test set (cbk_test_*), each field falling
 * back to the shared one, so a shop that saved a single set before the split behaves exactly as it
 * did. api/admin.php's readiness report carries the same rule; test:knet-modes holds them equal.
 */
function cbk_saved_set(array $val, string $env): array
{
    $out = [];
    foreach (['client_id', 'client_secret', 'encrp_key'] as $f) {
        $prod = (string) ($val['cbk_' . $f] ?? '');
        $test = (string) ($val['cbk_test_' . $f] ?? '');
        $out[$f] = $env === 'production' ? $prod : ($test !== '' ? $test : $prod);
    }
    return $out;
}
