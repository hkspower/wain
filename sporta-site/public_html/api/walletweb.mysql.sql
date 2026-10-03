-- Apple Wallet live updates (2026-10-03): a per-card token for Apple's update service, and the
-- phones each card is installed on. Safe to run twice. Run AFTER wallet.mysql.sql.
alter table wallet_passes add column if not exists auth_token varchar(64) null;

create table if not exists wallet_registrations (
  device_id   varchar(64)  not null,
  serial      varchar(40)  not null,
  push_token  varchar(200) not null,
  created_at  timestamp    not null default current_timestamp,
  primary key (device_id, serial),
  key idx_wallet_reg_serial (serial)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
