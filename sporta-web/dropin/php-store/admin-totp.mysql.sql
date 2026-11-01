-- Existing MariaDB installations: add the three columns needed to preserve
-- an administrator's TOTP enrollment before restoring any account row.
-- Run once before deploying the MFA-aware PHP code. This changes no accounts.
alter table admin_users
  add column if not exists totp_secret varchar(64) null,
  add column if not exists totp_enabled tinyint(1) not null default 0,
  add column if not exists totp_last_step bigint null;
