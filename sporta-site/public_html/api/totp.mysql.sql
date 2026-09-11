-- ===========================================================================
-- Sporta — a second factor on the admin sign-in.
--
-- Additive, and byte-for-byte the same columns as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- Sign-in at /backends was one password with no second factor, and behind it
-- sits every customer's name, telephone number and home address, the ability
-- to change what the shop charges, and the discount codes. A password can be
-- phished, reused on a site that leaks it, or read over a shoulder. Six digits
-- that change every thirty seconds and never leave the owner's phone cannot be
-- any of those things.
--
-- No rows are created here and nothing is switched on: an existing admin keeps
-- signing in with just a password until they enrol a phone from the admin's
-- own Security screen. A migration that turned on a second factor nobody had
-- set up yet would lock the owner out of their own shop.
-- ---------------------------------------------------------------------------

alter table admin_users row_format=DYNAMIC;

alter table admin_users
  add column if not exists totp_secret    varchar(64) null,
  add column if not exists totp_enabled   tinyint(1)  not null default 0,
  add column if not exists totp_last_step bigint      null,
  add column if not exists phone          varchar(20) null;
