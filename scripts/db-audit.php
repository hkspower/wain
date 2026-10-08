<?php
/**
 * The database, checked against the website that reads it — every line, against the sandbox.
 *
 *   php scripts/db-audit.php            (needs MariaDB up — scripts/sandbox.sh)
 *   SPORTA_DB_AUDIT_JSON=1 php scripts/db-audit.php     machine-readable
 *
 * THE CHECKS ARE IN scripts/live/live-db-audit.php, and only there. This file asks that one for
 * every line instead of its compact cron report; the output is what this file printed when it
 * carried the checks itself (95 checks on the sandbox, line for line).
 *
 * They moved so the SAME checks run on the live shop: the cron channel fetches exactly one file and
 * runs it on the server, so that file has to be the one with the checks in it. It finds the live
 * server's own api/store.php when it is there and the repository's otherwise, so here it is always
 * the sandbox — the site's own connection (api/config.php via store.php), not a second opinion.
 *
 * It writes NOTHING. Every statement is a select.
 */
declare(strict_types=1);

const SPORTA_DB_AUDIT_FULL = true;
require __DIR__ . '/live/live-db-audit.php';
