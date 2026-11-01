<?php
// One config path for the store, both gateways, and the backend editor.
// On the VPS the directory is mounted outside Apache's document root. Older
// shared-hosting installs continue to use their existing protected config.php.
//
// Ships as /api/config-path.php. The gateways (knet/knet.php, pay/cbk.php)
// include it from ../api/, so all three read the same rule and cannot disagree
// about where a secret lives.
//
// The VPS layout (apache-sporta container):
//   SPORTA_API_CONFIG_FILE     the store's config, a read-only bind mount of
//                              /docker/sporta/private/api-config.php
//   SPORTA_PRIVATE_CONFIG_DIR  holds knet-config.php and pay-config.php, a
//                              read-only bind mount of /docker/sporta/private/config
// Neither variable set means shared hosting: each config.php sits next to the
// code that reads it, denied by name in that folder's .htaccess.
declare(strict_types=1);

function sporta_config_path(string $kind, string $legacyPath): string {
    $names = [
        'knet' => 'knet-config.php',
        'tpay' => 'pay-config.php',
    ];
    if ($kind === 'api') {
        $file = getenv('SPORTA_API_CONFIG_FILE');
        if ($file !== false && $file !== '') {
            if ($file !== trim($file) || !str_starts_with($file, '/') || str_contains($file, "\0")) {
                throw new RuntimeException('Invalid private API config path');
            }
            return $file;
        }
        // A VPS with private merchant configs must never fall back to a web-root
        // API config. Its API file is a separate, read-only bind mount.
        if (getenv('SPORTA_PRIVATE_CONFIG_DIR')) {
            throw new RuntimeException('Private API config path missing');
        }
        return $legacyPath;
    }
    if (!isset($names[$kind])) throw new InvalidArgumentException('Unknown config kind');

    $dir = getenv('SPORTA_PRIVATE_CONFIG_DIR');
    if ($dir === false || $dir === '') return $legacyPath;
    // A configured private directory must fail closed. Falling back to a
    // public_html config on a mount typo would silently use stale credentials.
    if ($dir !== trim($dir) || !str_starts_with($dir, '/') || str_contains($dir, "\0")) {
        throw new RuntimeException('Invalid private config directory');
    }
    return rtrim($dir, '/') . '/' . $names[$kind];
}
