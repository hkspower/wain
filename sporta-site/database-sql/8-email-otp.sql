-- Sporta — a one-time code by email, as a second factor for the admin panel.
--
-- Import after 1-schema.mysql.sql. Safe to re-run.
--
-- WHY, WHEN TOTP ALREADY EXISTS. The panel has had TOTP since it was written
-- and it is the stronger factor — an authenticator app holds a secret that
-- never travels, while an emailed code is only as safe as the mailbox. But
-- TOTP costs the owner a phone, an app, a scanned QR and a saved recovery
-- path, and an owner who will not do that ends up with ONE factor rather than
-- two. A code to the address they already read every day is the second factor
-- they will actually turn on, and one factor plus a mailbox beats one factor.
--
-- Only one of the two is ever in force. TOTP wins where both are enrolled:
-- store_login() checks it first, and this is never reached.
--
-- COLUMNS ON admin_users RATHER THAN A TABLE OF THEIR OWN. Unlike `orders`,
-- which the schema warns is near InnoDB's row ceiling, admin_users is eleven
-- narrow columns and holds one row per person who can sign in. The state here
-- is strictly one-per-account and dies with the account, so a second table
-- would be a join to say what a column says.

set names utf8mb4;

-- Whether this account uses an emailed code at all. Off by default: turning it
-- on is a deliberate act that costs the current password and, if TOTP is
-- already on, a fresh code — the same price as every other change to who can
-- sign in.
alter table admin_users
  add column if not exists email_otp_enabled tinyint(1) not null default 0;

-- THE CODE IS NEVER STORED. What is stored is HMAC-SHA256 of it, keyed on
-- cron_key from api/config.php — the same construction store_review_sig() uses
-- for review links.
--
-- A plain hash would not be enough. Six digits is a million possibilities, and
-- sha256 over a million inputs is the work of a moment on any laptop, so a
-- leaked database row would hand over the live code. Keyed on a secret the
-- database does not contain, the row is worth nothing without config.php as
-- well — and store_email_otp_issue() refuses to work at all when cron_key is
-- empty rather than quietly keying everything on "".
alter table admin_users
  add column if not exists email_otp_hash char(64) null;

-- When it stops being accepted. Ten minutes: long enough to open a mail app on
-- a phone, short enough that a code read over someone's shoulder is stale
-- before it can be typed somewhere else.
alter table admin_users
  add column if not exists email_otp_expires timestamp null;

-- When the last one was sent, so "send it again" cannot be used to post a
-- thousand messages to an address, or to keep a code alive for ever by
-- refreshing it.
alter table admin_users
  add column if not exists email_otp_sent_at timestamp null;

-- Wrong guesses against the CURRENT code. Five and the code is destroyed, so a
-- guesser has to make the shop send a new one — which is itself throttled —
-- rather than grinding a single code a million times. Separate from
-- failed_attempts, which counts against the account lock and is not reset when
-- a new code is issued.
alter table admin_users
  add column if not exists email_otp_attempts int not null default 0;
