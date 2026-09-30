-- Sporta — password reset codes for /backends.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- One live code per admin (the primary key). Only a password_hash() of the
-- 8-digit code is stored; it expires, and five wrong tries burn it.
create table if not exists admin_password_resets (
  admin_id    int unsigned not null,
  code_hash   varchar(255) not null,
  attempts    tinyint unsigned not null default 0,
  created_at  timestamp    not null default current_timestamp,
  expires_at  datetime     not null,
  primary key (admin_id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
