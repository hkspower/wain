-- Sporta — the panel's sign-in hardening (2026-10-04, "make full backend login improve and full
-- secure backend"): active sessions, and passkeys.
--
-- Safe to re-run: `create table if not exists` and nothing else. ADDS, never drops.
--
-- admin_sessions   one row per signed-in browser: the sha256 of the PHP session id (never the id),
--                  who, when, from where, last seen. store_session_admin() requires the row to exist
--                  and not be revoked, so "sign out everywhere" and "sign out that device" are real —
--                  a PHP session file alone cannot be listed or revoked from another browser.
-- admin_passkeys   WebAuthn credentials: the credential id (binary), the COSE public key, the sign
--                  counter (replay guard), a label and when it was last used. A passkey with user
--                  verification is possession + biometric/PIN, so it signs in without a second code.
create table if not exists admin_sessions (
  id           int unsigned auto_increment primary key,
  sid_hash     char(64)      not null unique,
  admin_id     int unsigned  not null,
  created_at   timestamp     not null default current_timestamp,
  last_seen    timestamp     not null default current_timestamp,
  ip           varchar(45)   null,
  agent        varchar(200)  null,
  method       varchar(16)   not null default 'password',
  revoked_at   timestamp     null,
  key idx_sessions_admin (admin_id, revoked_at),
  constraint fk_sessions_admin foreign key (admin_id) references admin_users (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists admin_passkeys (
  id            int unsigned auto_increment primary key,
  admin_id      int unsigned  not null,
  credential_id varbinary(400) not null,
  public_key    blob          not null,
  alg           int           not null,
  sign_count    bigint unsigned not null default 0,
  label         varchar(60)   null,
  transports    varchar(80)   null,
  created_at    timestamp     not null default current_timestamp,
  last_used_at  timestamp     null,
  unique key uq_passkey_cred (credential_id),
  key idx_passkeys_admin (admin_id),
  constraint fk_passkeys_admin foreign key (admin_id) references admin_users (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
