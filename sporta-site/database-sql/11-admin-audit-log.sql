-- Sporta — a table for every admin write, logged centrally.
--
-- Import after 1-schema.mysql.sql. Safe to re-run.
--
-- See the comment on this table in 1-schema.mysql.sql for the shape, and
-- store_admin_audit_log() in api/store.php for how a row lands here without
-- every one of admin.php's ~50 save routes calling anything themselves — a
-- shutdown function registered once, after the admin gate, does it for all
-- of them.

set names utf8mb4;

create table if not exists admin_audit_log (
  id           int unsigned auto_increment primary key,
  admin_id     int unsigned null,
  admin_email  varchar(120) not null,
  route        varchar(64) not null,
  status_code  smallint unsigned not null,
  summary      text null,
  created_at   timestamp not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_audit_created on admin_audit_log (created_at);
