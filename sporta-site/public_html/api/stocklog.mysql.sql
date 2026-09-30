-- Sporta — a history of every change to a stock count.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- One row per change to one product_variants row: who (an admin's email, or NULL
-- for a shopper's order), why (reason), by how much (delta, signed) and what the
-- count was afterwards. It is WRITTEN BY THE APPLICATION, not by triggers: a
-- trigger needs a privilege shared hosting often withholds, and would fail the
-- very statement that takes a customer's stock. Every write is best-effort and
-- wrapped, so a missing table or a full disk can never refuse an order.
--
--   reason  order | release | set | variant | delete | bulk | import
--   ref     'order:<id>' for the two order reasons, otherwise NULL
create table if not exists stock_log (
  id           bigint unsigned not null auto_increment,
  at           timestamp       not null default current_timestamp,
  sku          varchar(30)     not null,
  slug         varchar(80)     not null,
  size         varchar(4)      not null,
  delta        int             not null,
  stock_after  int             null,
  reason       varchar(24)     not null,
  actor        varchar(80)     null,
  ref          varchar(40)     null,
  primary key (id),
  key idx_stock_log_slug (slug, id),
  key idx_stock_log_at (at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
