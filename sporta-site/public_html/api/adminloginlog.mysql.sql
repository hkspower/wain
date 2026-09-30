-- Sporta — a log of every admin sign-in attempt, with the address and country.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- admin_login_log   one row per attempt: password, code, Google, Apple,
--                   passcode, reset. `result` is 'ok' or the server's own
--                   refusal word (bad_credentials, bad_code, locked, ...).
-- admin_ip_geo      the country of an address, looked up once and remembered,
--                   so a busy or attacked login never waits on a lookup twice.
--                   Only addresses that try the ADMIN login are ever looked up.
create table if not exists admin_login_log (
  id            bigint unsigned not null auto_increment,
  at            timestamp    not null default current_timestamp,
  admin_id      int unsigned null,
  email         varchar(190) null,
  method        varchar(16)  not null,
  result        varchar(40)  not null,
  ip            varchar(45)  not null,
  country       varchar(2)   null,
  country_name  varchar(80)  null,
  new_ip        tinyint(1)   not null default 0,
  agent         varchar(160) null,
  primary key (id),
  key idx_login_log_at (at),
  key idx_login_log_ip (ip, at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists admin_ip_geo (
  ip            varchar(45) not null,
  country       varchar(2)  null,
  country_name  varchar(80) null,
  looked_up_at  timestamp   not null default current_timestamp,
  primary key (ip)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
