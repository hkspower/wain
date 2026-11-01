<?php
// Shared authorization for scheduled jobs. A VPS scheduler invokes PHP CLI
// with an explicit action flag; the secret is never placed in a URL or process
// argument. Existing shared-hosting HTTP jobs retain their keyed route.
declare(strict_types=1);

function sporta_cron_authorized(array $cfg, string $sapi, array $query, array $argv, array $cliFlags): bool {
    $secret = $cfg['cron_key'] ?? null;
    if (!is_string($secret) || $secret === '') return false;

    if ($sapi === 'cli') {
        return count($argv) === 2
            && is_string($argv[1])
            && in_array($argv[1], $cliFlags, true);
    }

    $provided = $query['key'] ?? null;
    return is_string($provided) && hash_equals($secret, $provided);
}
