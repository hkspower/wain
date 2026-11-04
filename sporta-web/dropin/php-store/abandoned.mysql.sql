-- Abandoned orders: the owner's follow-up on a customer who started an order
-- and never finished it (/backends -> Abandoned orders, abandoned.php).
--
-- ADDITIVE AND SAFE TO RE-RUN. One new table; no existing table, column or row
-- is changed or read here. Apply once to an existing database before the
-- Abandoned orders screen is used; install.mysql.sql carries the same statements
-- for a fresh install (it is generated from schema.mysql.sql, which repeats them
-- byte for byte).
--
-- One row per order, at most: order_id is the primary key, so the owner's
-- "contacted" and a later "wrong number" are the SAME row, replaced by a single
-- atomic INSERT ... ON DUPLICATE KEY UPDATE. The list never creates a row; only
-- the owner's own click does.
--
--   state       what the owner did: contacted, not_interested, wrong_number or
--               recovered_manually (the customer ordered by phone instead)
--   note        the owner's own words, 280 characters at most. It can hold what
--               a customer said on the phone, so it is personal data: it goes
--               with the order (ON DELETE CASCADE) and is listed in
--               ops/db/data-protection.mjs
--   updated_by  which admin, as admin_activity_log names them
--   updated_at  when
--
-- The reading side (which orders count as abandoned, and why) is code, not data:
-- see the header of abandoned.php. Nothing here changes an order, its stock or
-- its discount uses.
create table if not exists abandoned_followup (
  order_id   int unsigned  not null primary key,
  state      varchar(20)   not null,
  note       varchar(280)  null,
  updated_by varchar(120)  not null,
  updated_at timestamp     not null default current_timestamp,
  constraint fk_abandoned_followup_order foreign key (order_id) references orders (id) on delete cascade,
  constraint abandoned_followup_state_ck check (state in ('contacted','not_interested','wrong_number','recovered_manually'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
