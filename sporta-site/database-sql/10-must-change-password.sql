-- Sporta — force a real password after a cron-set temporary one.
--
-- Import after 1-schema.mysql.sql. Safe to re-run.
--
-- WHY. reset-admin-password.php is the ONLY way this shop recovers a locked-
-- out admin — CLAUDE.md is explicit that a self-service "forgot password"
-- route was removed as a security hole, so the recovery path stays "someone
-- with server access sets a password directly in the database". That password
-- is typed into a cron command by whoever is doing the recovery, which means
-- at least one other person can plausibly reconstruct it. It should not go on
-- being the real password a day, a week or a year later.
--
-- ONE COLUMN ON admin_users, same reasoning 8-email-otp.sql already gives for
-- putting per-account state there rather than in a table of its own: this is
-- strictly one-per-account and dies with the account.
--
-- WHY A FLAG AND NOT A SEPARATE "PENDING" STATE THAT BLOCKS SIGN-IN ENTIRELY.
-- Blocking sign-in would mean the temporary password cannot even be USED to
-- reach the screen that replaces it — the owner would be locked out by the
-- very thing meant to unlock them. Signing in still works normally; every
-- OTHER route is what refuses, in store_require_admin(), until this clears.

set names utf8mb4;

alter table admin_users
  add column if not exists must_change_password tinyint(1) not null default 0;
