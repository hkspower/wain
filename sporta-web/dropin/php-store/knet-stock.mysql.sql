-- KNET reads orders.stock_released (pay.php, callback.php, knet.php) to decide
-- whether a late payment may still be fulfilled. The column was live on the
-- shop but was never in the repo schema, so a fresh install broke every card
-- payment with "Could not verify the order right now". Additive and safe to
-- re-run: existing rows keep 0, which is "stock still reserved".
alter table orders add column if not exists stock_released tinyint(1) not null default 0;
