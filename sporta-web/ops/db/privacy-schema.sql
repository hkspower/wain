-- ===========================================================================
-- Sporta - the schema the privacy rules need. ADDITIVE and IDEMPOTENT: import it twice, nothing changes.
--
--   * three nullable marker columns, so the retention job knows which rows it has already blanked and
--     never touches a row twice (and so a re-run is free);
--   * privacy_runs     one row per run: which rule changed how many rows. Counts only, no personal data.
--   * privacy_erasures the erasure ledger: a SALTED HASH of an erased phone (its last 8 digits) or email,
--     never the value itself. After any restore from an older backup, re-applying the ledger erases those
--     people again (erase-reapply.sql). Without it a restore silently brings erased people back.
--
-- Nothing is dropped, renamed or rewritten. Adding a nullable column is an instant, metadata-only change.
--
-- WHERE THIS FILE LIVES: ops/db/, which is NOT part of the web package. It must be imported BEFORE any PHP
-- that names these columns goes live (privacy.php in privacy-php.patch). When that patch is applied, move
-- this file to dropin/php-store/privacy.mysql.sql and regenerate install.mysql.sql (scripts/make-install-sql.mjs),
-- so "the live database carries every repo migration" stays true.
-- ===========================================================================

alter table orders          add column if not exists anonymised_at datetime null default null;
alter table support_tickets add column if not exists anonymised_at datetime null default null;
alter table return_requests add column if not exists anonymised_at datetime null default null;

create table if not exists privacy_runs (
  id          bigint unsigned auto_increment primary key,
  ran_at      datetime     not null default current_timestamp,
  kind        varchar(16)  not null,
  dry_run     tinyint(1)   not null default 0,
  policy_json text         null,
  affected_json text       null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists privacy_erasures (
  id           bigint unsigned auto_increment primary key,
  requested_at datetime    not null default current_timestamp,
  id_kind      varchar(8)  not null,
  id_hash      char(64)    not null,
  scope        varchar(16) not null default 'erase',
  unique key uq_privacy_erasure (id_kind, id_hash),
  constraint privacy_erasure_kind_ck check (id_kind in ('phone','email'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
