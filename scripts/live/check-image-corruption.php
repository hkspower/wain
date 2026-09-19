<?php
/**
 * Check for corrupted or missing images on the live server.
 * Reports zero-byte files, unreadable files, and known stray files.
 * Run via cron: wget -qO - https://127.0.0.1/api/api.php?r=live_check_images
 */

// Scan image directories
$docroot = '/home/u130124229/domains/sporta.com.kw/public_html';
$corrupted = [];
$checked = 0;

// Expected image locations
$dirs = [
    'assets/hero/desktop',
    'assets/hero/mobile',
    'assets/cats/desktop',
    'assets/cats/mobile',
];

foreach ($dirs as $dir) {
    if (!is_dir("$docroot/$dir")) continue;

    $files = array_diff(scandir("$docroot/$dir"), ['.', '..']);
    foreach ($files as $file) {
        $path = "$docroot/$dir/$file";
        if (!is_file($path)) continue;

        $checked++;
        $size = filesize($path);

        // Check for problems
        if ($size === 0) {
            $corrupted[] = "/$dir/$file (zero bytes)";
        } else if (!is_readable($path)) {
            $corrupted[] = "/$dir/$file (not readable)";
        }
    }
}

// Check for known stray files that should not exist
$stray = [
    'cats/desktop/outlet.jpg' => 'duplicate tile image',
];

foreach ($stray as $path => $reason) {
    if (file_exists("$docroot/$path")) {
        $checked++;
        $corrupted[] = "/$path ($reason)";
    }
}

// Report
if (empty($corrupted)) {
    echo "images_ok=all_$checked";
} else {
    echo "corrupted=" . count($corrupted);
    foreach ($corrupted as $file) {
        echo " " . $file;
    }
}
