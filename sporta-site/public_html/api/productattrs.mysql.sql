-- Sporta — a product's colour and the fits it is offered in, picked in /backends.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- WHY A TABLE BESIDE `products`, NOT TWO NEW COLUMNS. `product_save` is a full
-- upsert used by three panels and a research overlay; a new column there is a
-- new way for any of them to blank it. This table is written by ONE route
-- (`product_attrs_save`) that touches nothing else, and a product with no row
-- here behaves exactly as before.
--
--   colour  a key of STORE_COLOURS (store.php) — a fixed list, never free text.
--   fits    comma-separated subset of the shop's fits. NULL means "every fit
--           the shop offers", which is what every product does today.
--
-- Sizes are not here: they are the product's rows in product_variants.
create table if not exists product_attrs (
  slug        varchar(80)  not null,
  colour      varchar(32)  null,
  fits        varchar(120) null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  primary key (slug)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
