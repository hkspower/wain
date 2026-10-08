<?php
/**
 * Does the LIVE database actually have every column the CURRENT code expects?
 *
 *   php scripts/live/live-schema-completeness.php      (from a checkout; against the sandbox locally)
 *
 * RETIRED 2026-10-08 — NOW A THIN WRAPPER OF live-schema-full.php, beside it, which answers this
 * question completely and is the only copy of the answer.
 *
 * WHY IT WAS RETIRED. This file asked about SEVEN hand-picked tables (orders, customers,
 * assistant_qa, hero_slides, settings, blocked_customers, return_requests) and 22 columns of them,
 * out of the 55 tables and 499 columns a fresh install has. A live database missing a table that
 * was not on its list — admin_sessions, site_images, any of the four purchasing tables — reported
 * `missing=0`. live-schema-full.php checks every table, column, type and index from a GENERATED
 * manifest (scripts/make-schema-manifest.mjs, with a --check that fails on drift) and names the
 * migrate-*.php that repairs each gap.
 *
 * Its other three lines went where they belong:
 *   HERO-MOBILE-LIVE   hero_slides.image_mobile* are in the manifest (with their migrator,
 *                      migrate-hero-mobile.php); its own "expected 0" had been stale since they
 *                      were applied.
 *   paidNoTimestamp    live-db-audit.php: "N orders are paid with no paid_at".
 *   orphanVariants     live-db-audit.php: "variants exist for '<slug>', which is not a product".
 *
 * ON THE SERVER, fetch live-schema-full.php itself. The cron channel fetches exactly one file, so a
 * copy of this wrapper alone has nothing to require, and it says so in one line rather than dying
 * in silence:
 *
 *   wget -nv -O r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-schema-full.php && php r.php
 *
 * READ-ONLY: live-schema-full.php reads information_schema and writes nothing.
 */
declare(strict_types=1);

$full = __DIR__ . '/live-schema-full.php';
if (!is_file($full)) {
    echo "SCHEMA retired - this checker is now scripts/live/live-schema-full.php; fetch and run that file\n";
    exit;
}
require $full;
