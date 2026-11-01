-- Existing MariaDB installations: apply before enabling admin passcodes.
-- Additive only; no account or existing authenticator setting is changed.
create table if not exists admin_recovery_codes (
  admin_id   int unsigned not null,
  code_hash  char(64) not null,
  used_at    timestamp null,
  created_at timestamp not null default current_timestamp,
  primary key (admin_id, code_hash),
  constraint admin_recovery_owner_fk foreign key (admin_id) references admin_users(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
