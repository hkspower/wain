-- Sporta — a recovery email for each /backends account (2026-10-15, "add recovery email").
--
-- A second address that receives the password-reset code as well as the sign-in address, so an
-- owner who loses the main mailbox can still get back in. It is set from the Security screen with
-- the account's password (and second-factor code, where one is set up), and it receives reset codes
-- only once a code mailed TO it has been typed back — a typo can never send reset codes to a
-- stranger.
--
-- Safe to re-run: one `alter table … add column if not exists`, nothing else. Until it runs, the
-- reset flow works exactly as before and the Security card says the database is behind.
--
-- recovery_email          the address, lower case; null = none.
-- recovery_verified_at    when its code was typed back; null = not proved, so it gets no reset codes.
-- recovery_code_hash      password_hash() of the 8-digit code mailed to a new address; null = none pending.
-- recovery_code_expires   when that code stops working (15 minutes).
-- recovery_code_tries     wrong codes typed for the pending address (5 and the code is spent).
alter table admin_users
  add column if not exists recovery_email        varchar(190) null,
  add column if not exists recovery_verified_at  timestamp    null default null,
  add column if not exists recovery_code_hash    varchar(255) null,
  add column if not exists recovery_code_expires timestamp    null default null,
  add column if not exists recovery_code_tries   int          not null default 0;
