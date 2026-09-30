-- Sporta — trusted devices for the /backends passcode unlock.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- A row is one browser the owner signed in on (password + any second factor)
-- and chose to trust. The browser holds a random token in a cookie; only its
-- SHA-256 is stored here, beside a password_hash() of the 6-digit passcode.
-- Five wrong passcodes lock the row (failed >= 5); only a full sign-in and a
-- fresh enrolment clears that. Changing the account password deletes every row.
create table if not exists admin_devices (
  id            int unsigned not null auto_increment,
  admin_id      int unsigned not null,
  token_hash    char(64)     not null,
  pass_hash     varchar(255) not null,
  label         varchar(80)  not null default '',
  failed        tinyint unsigned not null default 0,
  created_at    timestamp    not null default current_timestamp,
  last_used_at  timestamp    null,
  expires_at    datetime     not null,
  primary key (id),
  unique key uq_admin_devices_token (token_hash),
  key idx_admin_devices_admin (admin_id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
