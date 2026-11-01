-- Add this table to an existing Sporta installation before using the
-- Backends "Forgot password" link. Safe to run more than once.
create table if not exists admin_password_resets (
  id          bigint unsigned auto_increment primary key,
  admin_id    int unsigned not null,
  token_hash  char(64) not null unique,
  expires_at  datetime not null,
  used_at     datetime null,
  request_ip  char(64) null,
  created_at  timestamp not null default current_timestamp,
  constraint fk_admin_reset_user foreign key (admin_id) references admin_users(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_admin_reset_account on admin_password_resets (admin_id, used_at, expires_at);
