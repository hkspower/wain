-- ===========================================================================
-- Sporta - the column fixes of the "full database columns check" (2026-11-04).
--
-- ADDITIVE and IDEMPOTENT. Import it twice: the second run changes nothing. Nothing is dropped, renamed or rewritten, no row is
-- deleted, and the only column whose values are written is the new products.updated_at (every existing product gets the time of
-- this import). Every step that a row already in the table could refuse (the unique key, the CHECKs) COUNTS the offending rows first;
-- if there are any, that ONE step is skipped and one line says why, the other steps still run, and importing the file again after
-- the data is fixed adds it. A step that needs a table or column this database does not have (an older return_request_items,
-- a product_variants from before inventory.mysql.sql) is skipped the same way instead of stopping the import with ERROR 1054.
-- No DELIMITER and no stored routine, so it imports in phpMyAdmin like the other migrations.
--
-- WHY THE FILE IS CALLED zz-column-fixes: it is a FINISHING PASS. Steps 5 and 6 constrain tables that other migrations create
-- (return_request_items: returns.mysql.sql, product_variants.unit_cost_kwd: inventory.mysql.sql, discounts: promo.mysql.sql), so it
-- has to run after them. The name sorts last in the alphabetical order a file manager gives, install.mysql.sql carries it as its
-- last part, and a run that came too early only prints one note per skipped step and changes nothing else: import the file again.
--
-- WHAT IT FIXES (finding ids are those of DATABASE-COLUMNS-CHECK-2026-11-04.md; each one was reproduced on a private MariaDB
-- through the real PHP routes before it was fixed, and re-run afterwards):
--
--  1. order_items.name_en / name_ar  varchar(120) -> varchar(160)                                    [C-01, medium]
--       products.name_en / name_ar are varchar(160) and the admin's product form accepts 160, but the checkout copies the name into
--       the order line (itemname.mysql.sql made that copy 120 wide). A product whose name is 121-160 characters made EVERY order
--       containing it answer HTTP 500 "failed" and create nothing (strict sql_mode, the MariaDB default); under a lax mode the
--       invoice name was cut at 120. Nothing triggers it with today's catalogue (the longest seed name is under 100).
--  2. products.brand_slug            varchar(64)  -> varchar(80)                                      [C-12, low]
--       brands.slug is varchar(80); product_save accepts any brand that exists, so a brand whose slug is 65-80 characters could not
--       be given to a product (500 under strict mode, a tag cut to 64 characters that matches no brand under a lax one).
--  3. products.updated_at            timestamp not null default current_timestamp on update current_timestamp   [C-13, low]
--       sitemap-index.php and sitemap-products.php ask for it (SHOW COLUMNS) and have never found it, so the products sitemap has
--       never carried a <lastmod>. Existing products get the time of this import (the honest "since when, we do not know").
--  4. customer_accounts.birthday, birthday_set_at, birthday_sent_year, last_login_at                  [C-06 and C-14, both low]
--       birthday.php, birthday-lib.php and cron-birthday.php (daily 06:07) need the first three; they existed only in
--       sporta-live/birthday/birthday.mysql.sql, so a database built from dropin/php-store had the feature switched off (503
--       birthday_not_ready, cron "ready=0"). profiles.php asks for last_login_at (guarded) and no migration ever created it.
--       The CREATE TABLE IF NOT EXISTS below is customers.mysql.sql's own statement, repeated so this file does not depend on running
--       after it.
--  5. product_variants  UNIQUE (slug, size)                                                           [C-07, low]
--       The stock claim is `update ... where slug = ? and size = ?` and treats rowCount() <> 1 as "out of stock": a second row for one
--       (slug, size) makes that size UNBUYABLE (409 out_of_stock). No PHP statement inserts a variant, so no code path can hit the key.
--  6. Non-negative money, one named CHECK per table                                                   [C-05, medium]
--       orders (amount, subtotal, discount_amount, delivery_fee), order_items.unit_price, return_request_items.unit_price,
--       products (price, sale_price), discounts.min_order >= 0 and percent <= 100, product_variants (cost_aed, unit_cost_kwd).
--       The admin's catalogue sync (`?r=sync`) casts a price with a bare (float) and accepted -5.000; an order of one 20.000 item plus
--       two of the -5.000 product was ACCEPTED as 10.000 (a 10 KWD discount nobody configured). With the CHECK the sync answers 500
--       and stores nothing (the code patch refuses it with a named 400 first).
--
-- BEFORE YOU RUN IT ON THE LIVE DATABASE (read-only; every count should be 0). Take the backup of DATA-SCAN-2026-11-02.md first.
--
--   select count(*) from (select 1 from product_variants group by slug, size having count(*) > 1) d;
--   select count(*) from orders where amount < 0 or subtotal < 0 or discount_amount < 0 or delivery_fee < 0;
--   select count(*) from order_items where unit_price < 0;
--   select count(*) from return_request_items where unit_price < 0;      -- error 1054 here means the old layout: step 6 skips it
--   select count(*) from products where price < 0 or sale_price < 0;
--   select count(*) from discounts where min_order < 0 or (type = 'percent' and value > 100);
--   select count(*) from product_variants where cost_aed < 0 or unit_cost_kwd < 0;
--   select max(char_length(name_en)), max(char_length(name_ar)) from products;   -- above 120: step 1 is already needed
--   select count(*) from information_schema.columns where table_schema = database() and table_name = 'customer_accounts'
--      and column_name in ('birthday', 'birthday_set_at', 'birthday_sent_year', 'last_login_at');   -- 3 on a shop that ran the birthday add-on
--
-- A widening keeps the column's own character set and collation (a bare MODIFY re-collates a column to its TABLE's default
-- collation when the two differ, and order_items.name_* meets products.name_* in coalesce()).
-- ===========================================================================

set names utf8mb4;

-- ---------------------------------------------------------------- 1. order_items name snapshot width
-- A database that never ran itemname.mysql.sql has no such columns: give it them at the final width first.
alter table order_items
  add column if not exists name_en varchar(160) null after product_id,
  add column if not exists name_ar varchar(160) null after name_en;
set @cf := coalesce((select if(character_maximum_length < 160,
    concat('alter table order_items modify name_en varchar(160) character set ', character_set_name, ' collate ', collation_name, ' null default null'),
    'do 0')
  from information_schema.columns
 where table_schema = database() and table_name = 'order_items' and column_name = 'name_en' and character_set_name is not null), 'do 0');
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
set @cf := coalesce((select if(character_maximum_length < 160,
    concat('alter table order_items modify name_ar varchar(160) character set ', character_set_name, ' collate ', collation_name, ' null default null'),
    'do 0')
  from information_schema.columns
 where table_schema = database() and table_name = 'order_items' and column_name = 'name_ar' and character_set_name is not null), 'do 0');
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;

-- ---------------------------------------------------------------- 2. products.brand_slug as wide as brands.slug
-- A database that never ran productbrand.mysql.sql has no such column: give it one at the final width first.
alter table products add column if not exists brand_slug varchar(80) null after category;
set @cf := coalesce((select if(character_maximum_length < 80,
    concat('alter table products modify brand_slug varchar(80) character set ', character_set_name, ' collate ', collation_name, ' null default null'),
    'do 0')
  from information_schema.columns
 where table_schema = database() and table_name = 'products' and column_name = 'brand_slug' and character_set_name is not null), 'do 0');
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
create index if not exists idx_products_brand on products (brand_slug);

-- ---------------------------------------------------------------- 3. products.updated_at (sitemap <lastmod>)
alter table products
  add column if not exists updated_at timestamp not null default current_timestamp on update current_timestamp;

-- ---------------------------------------------------------------- 4. customer_accounts: birthday and last sign-in
create table if not exists customer_accounts (
  id bigint unsigned auto_increment primary key,
  name varchar(80) not null,
  email varchar(254) not null unique,
  password_hash varchar(255) not null,
  phone varchar(15) null,
  created_at timestamp not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

alter table customer_accounts
  add column if not exists birthday           date      null default null,
  add column if not exists birthday_set_at    datetime  null default null,
  add column if not exists birthday_sent_year smallint  null default null,
  add column if not exists last_login_at      timestamp null default null;

-- ---------------------------------------------------------------- 5. one row per (slug, size)
set @cf_dups := (select count(*) from (select 1 from product_variants group by slug, size having count(*) > 1) d);
set @cf_has  := (select count(*) from information_schema.statistics
                  where table_schema = database() and table_name = 'product_variants' and index_name = 'uq_variants_slug_size');
set @cf := if(@cf_has > 0, 'do 0',
           if(@cf_dups > 0,
              concat('select ''uq_variants_slug_size NOT added: ', @cf_dups, ' duplicated (slug, size) pair(s) in product_variants. List them with: select slug, size, group_concat(sku) from product_variants group by slug, size having count(*) > 1. Merge or delete the extra rows, then import this file again.'' as cf_note'),
              'alter table product_variants add unique key uq_variants_slug_size (slug, size)'));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;

-- ---------------------------------------------------------------- 6. non-negative money (one named CHECK per table)
-- orders
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'orders' and column_name in ('amount', 'subtotal', 'discount_amount', 'delivery_fee'));
set @cf_q := if(@cf_cols = 4, 'select count(*) into @cf_bad from orders where amount < 0 or subtotal < 0 or discount_amount < 0 or delivery_fee < 0', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'orders' and constraint_name = 'orders_money_nonneg_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''orders_money_nonneg_ck NOT added: orders lacks a column it needs (amount, subtotal, discount_amount, delivery_fee); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''orders_money_nonneg_ck NOT added: ', @cf_bad, ' order(s) have a negative amount'' as cf_note'),
  'alter table orders add constraint orders_money_nonneg_ck check (amount >= 0 and subtotal >= 0 and discount_amount >= 0 and delivery_fee >= 0)')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
-- order_items
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'order_items' and column_name in ('unit_price'));
set @cf_q := if(@cf_cols = 1, 'select count(*) into @cf_bad from order_items where unit_price < 0', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'order_items' and constraint_name = 'items_price_nonneg_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''items_price_nonneg_ck NOT added: order_items lacks a column it needs (unit_price); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''items_price_nonneg_ck NOT added: ', @cf_bad, ' order line(s) have a negative unit_price'' as cf_note'),
  'alter table order_items add constraint items_price_nonneg_ck check (unit_price >= 0)')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
-- return_request_items
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'return_request_items' and column_name in ('unit_price'));
set @cf_q := if(@cf_cols = 1, 'select count(*) into @cf_bad from return_request_items where unit_price < 0', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'return_request_items' and constraint_name = 'return_item_price_nonneg_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''return_item_price_nonneg_ck NOT added: return_request_items lacks a column it needs (unit_price); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''return_item_price_nonneg_ck NOT added: ', @cf_bad, ' return line(s) have a negative unit_price'' as cf_note'),
  'alter table return_request_items add constraint return_item_price_nonneg_ck check (unit_price >= 0)')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
-- products
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'products' and column_name in ('price', 'sale_price'));
set @cf_q := if(@cf_cols = 2, 'select count(*) into @cf_bad from products where price < 0 or sale_price < 0', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'products' and constraint_name = 'products_price_nonneg_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''products_price_nonneg_ck NOT added: products lacks a column it needs (price, sale_price); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''products_price_nonneg_ck NOT added: ', @cf_bad, ' product(s) have a negative price or sale_price'' as cf_note'),
  'alter table products add constraint products_price_nonneg_ck check (price >= 0 and (sale_price is null or sale_price >= 0))')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
-- discounts
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'discounts' and column_name in ('min_order', 'type', 'value'));
set @cf_q := if(@cf_cols = 3, 'select count(*) into @cf_bad from discounts where min_order < 0 or (type = ''percent'' and value > 100)', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'discounts' and constraint_name = 'discounts_range_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''discounts_range_ck NOT added: discounts lacks a column it needs (min_order, type, value); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''discounts_range_ck NOT added: ', @cf_bad, ' discount(s) have a negative min_order or a percent above 100'' as cf_note'),
  'alter table discounts add constraint discounts_range_ck check (min_order >= 0 and (type <> ''percent'' or value <= 100))')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
-- product_variants
set @cf_cols := (select count(*) from information_schema.columns where table_schema = database() and table_name = 'product_variants' and column_name in ('cost_aed', 'unit_cost_kwd'));
set @cf_q := if(@cf_cols = 2, 'select count(*) into @cf_bad from product_variants where cost_aed < 0 or unit_cost_kwd < 0', 'select -1 into @cf_bad');
prepare cf_stmt from @cf_q; execute cf_stmt; deallocate prepare cf_stmt;
set @cf_has := (select count(*) from information_schema.check_constraints where constraint_schema = database() and table_name = 'product_variants' and constraint_name = 'variants_cost_nonneg_ck');
set @cf := if(@cf_has > 0, 'do 0', if(@cf_bad < 0,
  'select ''variants_cost_nonneg_ck NOT added: product_variants lacks a column it needs (cost_aed, unit_cost_kwd); import the earlier migrations first'' as cf_note', if(@cf_bad > 0,
  concat('select ''variants_cost_nonneg_ck NOT added: ', @cf_bad, ' variant(s) have a negative cost'' as cf_note'),
  'alter table product_variants add constraint variants_cost_nonneg_ck check ((cost_aed is null or cost_aed >= 0) and (unit_cost_kwd is null or unit_cost_kwd >= 0))')));
prepare cf_stmt from @cf; execute cf_stmt; deallocate prepare cf_stmt;
