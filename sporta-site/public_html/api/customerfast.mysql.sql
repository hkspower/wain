-- Sporta — fast sign-in for customers (2026-10-07): Face ID / fingerprint
-- (passkeys) and one-time email codes. Google sign-in needs no table.
--
-- Safe to re-run: `create table if not exists` and nothing else.

create table if not exists customer_passkeys (
  id            int unsigned auto_increment primary key,
  customer_id   int unsigned not null,
  credential_id varbinary(400) not null,
  public_key    text not null,
  alg           int not null,
  sign_count    int unsigned not null default 0,
  label         varchar(60) null,
  transports    varchar(80) null,
  created_at    timestamp not null default current_timestamp,
  last_used_at  timestamp null default null,
  unique key customer_passkeys_cred (credential_id),
  key customer_passkeys_owner (customer_id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- One row per code sent. The code itself is never stored, only its HMAC.
create table if not exists customer_login_codes (
  id          int unsigned auto_increment primary key,
  email       varchar(190) not null,
  code_hash   char(64) not null,
  attempts    tinyint unsigned not null default 0,
  expires_at  timestamp not null,
  used_at     timestamp null default null,
  created_at  timestamp not null default current_timestamp,
  key customer_login_codes_email (email, created_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
