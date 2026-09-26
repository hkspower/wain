<?php
/**
 * One-shot: fetch IMPORT-THIS-ONE.sql from GitHub and run it against a
 * throwaway test database — never the live shop's database. Reports STATE,
 * not its own verb, per this project's cron convention.
 *
 * CREDENTIALS ARE ARGUMENTS, NEVER WRITTEN INTO THIS FILE. This file is
 * committed to a PUBLIC repository — a hardcoded password here would leak
 * the moment it lands. The cron COMMAND that invokes this (which carries the
 * real password) is never committed anywhere.
 *
 * Run via the Hostinger cron channel:
 *   wget -qO t.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/dev/import-clean-test-db.php && php t.php <host> <db> <user> <pass>
 *
 * DELETE THE CRON JOB the moment this prints output — it writes, and it
 * carries the test database's password in the panel until deleted.
 */

[, $host, $db, $user, $pass] = $argv + [null, null, null, null, null];
if (!$host || !$db || !$user || !$pass) {
    echo "USAGE: php t.php <host> <db> <user> <pass>\n";
    exit(1);
}

$commit = '6152d62233a5b8c47e63c10b25ab8ab7b24e2327';
$url = "https://raw.githubusercontent.com/hkspower/wain/$commit/sporta-site/database-sql/IMPORT-THIS-ONE.sql";

$sql = file_get_contents($url);
if ($sql === false || strlen($sql) < 1000) {
    echo 'FETCH-FAILED bytes=' . strlen((string) $sql) . "\n";
    exit(1);
}

$mysqli = @mysqli_connect($host, $user, $pass, $db);
if (!$mysqli) {
    echo 'CONNECT-FAILED ' . mysqli_connect_error() . "\n";
    exit(1);
}

$ok = mysqli_multi_query($mysqli, $sql);
$statementErrors = [];
if ($ok) {
    do {
        if ($res = mysqli_store_result($mysqli)) {
            mysqli_free_result($res);
        }
        if (mysqli_errno($mysqli)) {
            $statementErrors[] = mysqli_error($mysqli);
        }
    } while (mysqli_more_results($mysqli) && mysqli_next_result($mysqli));
} else {
    $statementErrors[] = mysqli_error($mysqli);
}

$tableCount = 0;
if ($res = mysqli_query($mysqli, 'show tables')) {
    $tableCount = mysqli_num_rows($res);
}

$productCount = 'n/a';
if ($res = mysqli_query($mysqli, 'select count(*) c from products')) {
    $productCount = mysqli_fetch_assoc($res)['c'];
}

$heroMobileCols = 'n/a';
if ($res = mysqli_query($mysqli, "show columns from hero_slides like 'image_mobile%'")) {
    $heroMobileCols = mysqli_num_rows($res);
}

echo 'STATE tables=' . $tableCount
    . ' products=' . $productCount
    . ' heroMobileCols=' . $heroMobileCols
    . ' statementErrors=' . count($statementErrors)
    . (count($statementErrors) ? ' first=' . substr($statementErrors[0], 0, 120) : '')
    . "\n";
