-- Apply to an existing MariaDB database before enabling first-sign-in passwords.
-- The first column is present in some older Sporta backups; IF NOT EXISTS
-- keeps this migration safe for those databases.
alter table admin_users
  add column if not exists must_change_password tinyint(1) not null default 0 after password_hash,
  add column if not exists temporary_password_expires_at timestamp null after must_change_password,
  add column if not exists temporary_password_used_at timestamp null after temporary_password_expires_at;
