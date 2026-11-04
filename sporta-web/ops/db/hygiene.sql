-- ===========================================================================
-- hygiene.sql — server-level account hygiene for the MariaDB that holds the shop.
-- Run as the admin account AFTER audit-accounts.sql has been read by a person:
--
--   mariadb -h <db> -u <admin> -p... < ops/db/hygiene.sql
--
-- Safe to run twice. Nothing here touches shop data, the app accounts, or
-- anything the live site connects with. Three things it deliberately does NOT do,
-- because each can lock the shop (or the operator) out and needs a human:
--   * drop root@% .................... drop-root-remote.sql (after confirming no job uses it)
--   * lock / revoke the old app account  retire-old-account.sql (after the new accounts are live)
--   * start-up options ............... README.md, "Container options" (needs a restart)
-- ===========================================================================

-- 1. No anonymous accounts. (The official MariaDB image does not create any; a
--    hand-installed server does.)
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP USER IF EXISTS ''@'127.0.0.1';
DROP USER IF EXISTS ''@'::1';

-- 2. No sample database.
DROP DATABASE IF EXISTS test;

-- 3. LOAD DATA LOCAL INFILE off. With it on, any account that can INSERT into a
--    table can make the SERVER ask the CLIENT for a file (the classic way a
--    hostile or hijacked server reads a web host's files; PHP leaves it off by
--    default, so this closes the other half). Runtime change; to survive a
--    restart add --local-infile=0 (README).
SET GLOBAL local_infile = 0;

-- 4. Password policy for every FUTURE password: simple_password_check refuses a
--    short or single-class password (and an empty one), password_reuse_check
--    refuses reusing one of the last N. The accounts in grants.sql get 40
--    random characters with all four classes, so they pass; a human typing
--    "password123" for root does not. INSTALL SONAME persists in mysql.plugin.
--    If the .so is missing from the image the INSTALL fails: read the error, do
--    not force it (README, "Password policy").
INSTALL SONAME 'simple_password_check';
SET GLOBAL simple_password_check_minimal_length = 24;
SET GLOBAL simple_password_check_digits = 1;
SET GLOBAL simple_password_check_letters_same_case = 1;
SET GLOBAL simple_password_check_other_characters = 1;
INSTALL SONAME 'password_reuse_check';
SET GLOBAL password_reuse_check_interval = 365;
