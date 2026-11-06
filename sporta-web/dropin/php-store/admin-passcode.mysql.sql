-- Device passcode for the admin sign-in (quick unlock). Additive: three nullable / defaulted columns.
-- Run once before deploying the PHP that reads them. Changes no existing account.
alter table admin_users
  add column if not exists passcode_hash varchar(255) null,
  add column if not exists passcode_failed int not null default 0,
  add column if not exists passcode_locked_until datetime null;
