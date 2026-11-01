-- Stock reservation. Additive; safe to run on a live database, and safe twice.
--
-- WHY TWO FLAGS AND NOT ONE. The obvious design is a single `stock_released`
-- boolean, and it is wrong for the orders that already exist: every row in the
-- table today was placed BEFORE stock was ever claimed, so a sweeper looking
-- only at `released = 0` would happily "put back" garments that were never
-- taken — inventing inventory out of history.
--
-- `stock_claimed` records that this order actually took stock, and is set by
-- the checkout inside the same transaction as the claim. Old orders keep 0 and
-- are therefore invisible to the release path, permanently and by construction.
--
-- `stock_released` is the idempotence guard. A KNET callback that fails and is
-- retried, and then an abandoned-order sweep that catches the same row, must
-- not both restock it.
alter table orders
  add column if not exists stock_claimed  tinyint(1) not null default 0,
  add column if not exists stock_released tinyint(1) not null default 0;

-- The sweeper's query: unpaid, claimed, not yet released, older than the
-- cutoff. Without this it is a full scan of every order the shop has ever
-- taken, run on a schedule, on shared hosting.
create index if not exists idx_orders_stock_sweep
  on orders (payment_status, stock_claimed, stock_released, created_at);
