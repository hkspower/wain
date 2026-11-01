<?php
// Read-only helpers for SEO responses. These routes must keep the storefront
// shell and the shipped sitemap available when MariaDB is temporarily down.
declare(strict_types=1);
require_once __DIR__ . '/config-path.php';

function sporta_seo_db(): ?PDO {
    try {
        $path = sporta_config_path('api', __DIR__ . '/config.php');
        if (!is_file($path)) return null;
        $config = require $path;
        if (!is_array($config)) return null;
        foreach (['db_host', 'db_name', 'db_user', 'db_pass'] as $field) {
            if (!is_string($config[$field] ?? null) || $config[$field] === '') return null;
        }
        return new PDO(
            "mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4",
            $config['db_user'],
            $config['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
             PDO::ATTR_EMULATE_PREPARES => false,
             PDO::ATTR_TIMEOUT => 3]
        );
    } catch (Throwable $e) {
        error_log('Sporta SEO database unavailable: ' . get_class($e));
        return null;
    }
}

function sporta_seo_public_path(string $file): ?string {
    // In the deployed bundle /api is beside index.html. The other two paths
    // support source-tree and built-tree verification without changing URLs.
    foreach ([dirname(__DIR__) . '/' . $file,
              dirname(__DIR__, 2) . '/dist/' . $file,
              dirname(__DIR__, 2) . '/' . $file] as $path) {
        if (is_file($path) && is_readable($path)) return $path;
    }
    return null;
}

function sporta_seo_static_file(string $file, string $contentType): never {
    $path = sporta_seo_public_path($file);
    if ($path === null) {
        http_response_code(503);
        header('Cache-Control: no-store');
        exit;
    }
    header('Content-Type: ' . $contentType);
    header('Cache-Control: no-cache, must-revalidate');
    readfile($path);
    exit;
}
