-- Sporta — the Users page at /backends (2026-10-08): the owner can switch a shopper's account off,
-- sign it out everywhere, and switch a panel colleague off. Six columns on two existing tables.
--
-- Safe to re-run: two `alter table … add column if not exists` and nothing else. ADDS, never drops,
-- touches no row. Until it has run, every sign-in and every signed-in session works exactly as before
-- (the code reads these columns with `select *` and treats a missing one as "not set"), and the new
-- Users routes answer 503 users_not_ready.
--
-- customers.blocked_at      set = this account may not sign in, and any browser already signed in to
--                           it is signed out on its next request (customer_id() reads it in the same
--                           row read as the password-key check). A timestamp rather than a flag so the
--                           screen can say WHEN; null = not blocked.
-- customers.blocked_reason  the owner's own note, up to 200 characters, shown back only in the panel.
-- customers.blocked_by      the panel email that blocked it, copied as text like blocked_customers.blocked_by,
--                           so the record outlives a colleague who is later removed.
-- customers.signed_out_at   "sign out everywhere". A shopper session is a PHP session file that cannot be
--                           listed or deleted from the panel, so the cut-off lives HERE: a session whose
--                           sign-in time (customer_since) is at or before this moment is ended on its next
--                           request. Compared as unix_timestamp() in SQL, never against PHP's clock zone.
--                           Unlike blocked_at it does not stop a NEW sign-in.
-- admin_users.disabled_at   the owner's lock on a colleague, and NOT locked_until: locked_until is the
--                           five-wrong-tries lock, cleared by every successful sign-in, by a password reset
--                           and by a wrong code, so it cannot hold a lock somebody chose. store_admin_grant()
--                           refuses an account with this set, at every door, and store_session_admin() ends
--                           an already signed-in session of it on its very next request.
-- admin_users.added_by      which panel email added this colleague from the Team tab; null for the first
--                           admin (made by `register`) and for accounts made before this existed.
alter table customers
  add column if not exists blocked_at     timestamp    null default null,
  add column if not exists blocked_reason varchar(200) null,
  add column if not exists blocked_by     varchar(120) null,
  add column if not exists signed_out_at  timestamp    null default null;

alter table admin_users
  add column if not exists disabled_at timestamp    null default null,
  add column if not exists added_by    varchar(120) null;
