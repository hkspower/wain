-- Sporta — hero slides, site settings, promotions and discounts.
--
-- ADDITIVE. Fresh installs get all of this from schema.mysql.sql; running this
-- as well is harmless. phpMyAdmin -> your database -> Import.
--
-- Money is decimal(10,3) here for the same reason it is everywhere else: KWD
-- has exactly three decimal places. Every calculation that touches it happens
-- in integer fils in PHP, never in floating point.

set names utf8mb4;

-- ---------------------------------------------------------------- hero slides
--
-- The image lives IN THE ROW, not as a file. That is the same rule the brand
-- logos follow and it exists because an upload endpoint has to write into the
-- web root, which this project forbids outright — the live server already had
-- one such endpoint answering to the whole internet.
--
-- But a hero photograph is two orders of magnitude bigger than a brand logo,
-- so it is NOT inlined into the storefront's JSON the way a logo is. The
-- catalogue response carries a URL; api.php?r=slide_image serves the bytes
-- with a content hash in the query string and a one-year immutable cache. The
-- home page therefore pays one cacheable image request per slide, which is
-- what it would have paid for a file, and nothing writes to disk.
create table if not exists hero_slides (
  id         int unsigned auto_increment primary key,
  sort       int          not null default 0,
  active     tinyint(1)   not null default 1,

  title_en   varchar(120) null,
  title_ar   varchar(120) null,
  subtitle_en varchar(200) null,
  subtitle_ar varchar(200) null,
  cta_label_en varchar(40) null,
  cta_label_ar varchar(40) null,
  cta_href   varchar(200) null,

  -- The bytes, base64 in a data: URI exactly as store_data_image() validates
  -- it. longtext because mediumtext (16 MB) is ample but the base64 of a large
  -- photograph plus the prefix should never be the thing that truncates.
  image      longtext     null,
  -- sha256 of the image, used as the cache-busting ?v= so a replaced photo is
  -- picked up immediately despite the immutable cache on the old URL.
  image_hash char(64)     null,
  image_w    int          null,
  image_h    int          null,

  -- Where the subject sits, as percentages. This is the "area" control: the
  -- slide crops to fill, so a subject near an edge gets cut without it.
  focal_x    tinyint unsigned not null default 50,
  focal_y    tinyint unsigned not null default 50,

  created_at timestamp    not null default current_timestamp,
  updated_at timestamp    not null default current_timestamp on update current_timestamp,
  constraint hero_focal_x_ck check (focal_x between 0 and 100),
  constraint hero_focal_y_ck check (focal_y between 0 and 100)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_hero_sort on hero_slides (active, sort);

-- ------------------------------------------------------------------- settings
--
-- Small, named pieces of site configuration the owner changes without a
-- deploy: the slider's speed, whether it shuffles, how tall it is, and the
-- promo bar's text. A key/value table rather than a column per setting, so
-- adding one is an INSERT and not a migration on a live shop.
--
-- The value is JSON so a setting can be a record (the promo bar is bilingual
-- and scheduled) without inventing a table for each.
create table if not exists settings (
  name       varchar(40) primary key,
  value      text        not null,
  updated_at timestamp   not null default current_timestamp on update current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- Defaults that match what the site does today, so importing this changes
-- nothing until the owner edits it. 6500 ms is the interval HeroSlider shipped
-- with; 'tall' is its current height.
insert into settings (name, value) values
  ('hero', '{"speed_ms":6500,"shuffle":false,"size":"tall","autoplay":true}'),
  ('promo_bar', '{"enabled": true, "text_en": "Same-day delivery in Kuwait · KNET, cards & cash on delivery", "text_ar": "توصيل في نفس اليوم داخل الكويت · كي نت والبطاقات والدفع عند الاستلام", "href": "", "starts_at": null, "ends_at": null}')
on duplicate key update name = name;   -- never clobber a value already set

-- ------------------------------------------------- promotions on the products
--
-- A sale price alongside the real one, so the shop can show "was 12.000, now
-- 9.000" and go back afterwards without anybody retyping the original. The
-- window may be open-ended at either end: no start = live now, no end = until
-- switched off.
--
-- `if not exists` on add column is MariaDB 10.2+ and MySQL 8.0.29+; Hostinger
-- runs MariaDB, and re-running this file is therefore safe.
alter table products add column if not exists sale_price     decimal(10,3) null after price;
alter table products add column if not exists sale_starts_at datetime      null after sale_price;
alter table products add column if not exists sale_ends_at   datetime      null after sale_starts_at;
alter table products add column if not exists featured       tinyint(1)    not null default 0;
alter table products add column if not exists featured_sort  int           not null default 0;

create index if not exists idx_products_featured on products (featured, featured_sort);

-- --------------------------------------------------------------- rate limiting
--
-- A fixed-window counter, keyed by a HASH of bucket + client IP. It exists for
-- `?r=discount`, which is a public endpoint that answers "is this code real?"
-- — an oracle, and an unthrottled oracle is a code generator.
--
-- In MySQL rather than a cache server or a file, because this runs on shared
-- hosting where neither exists and the request is already holding a database
-- connection. The IP is hashed: this is abuse control, not a visitor log, and
-- a table of who-asked-what is a liability with no use.
--
-- Swept opportunistically by store_throttle(), so it needs no cron.
create table if not exists rate_limit (
  bucket_key   char(32)     not null,
  window_start int unsigned not null,
  hits         int unsigned not null default 0,
  primary key (bucket_key, window_start)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_rate_limit_sweep on rate_limit (window_start);

-- ------------------------------------------------------------------ discounts
--
-- Two kinds in one table, because they are the same arithmetic and splitting
-- them would mean writing the validity window, the minimum, the limits and the
-- money maths twice — and one copy would drift. `kind` says whether a customer
-- has to type it:
--
--   'code'  the customer enters it at checkout
--   'auto'  it applies itself when the order qualifies
--
-- There is no free-delivery type because delivery is already free; adding one
-- would be a discount off nothing.
create table if not exists discounts (
  id          int unsigned auto_increment primary key,
  kind        varchar(6)   not null default 'code',
  -- Stored uppercase and unique, so SAVE10 and save10 cannot both exist.
  -- NULL for automatic rules, and MySQL lets NULLs repeat in a unique index.
  code        varchar(24)  null unique,
  label       varchar(80)  not null,
  type        varchar(8)   not null default 'percent',
  -- percent: 1-90. fixed: an amount in KWD.
  value       decimal(10,3) not null,
  -- Only orders at or above this subtotal qualify. 0 = no minimum.
  min_order   decimal(10,3) not null default 0,
  -- Restrict to one category, or NULL for the whole shop. When set, the
  -- discount is computed on the qualifying lines only.
  category    varchar(40)  null,
  starts_at   datetime     null,
  ends_at     datetime     null,
  -- 0 = unlimited. used_count is incremented in the SAME transaction as the
  -- order, so two simultaneous checkouts cannot both take the last one.
  usage_limit int unsigned not null default 0,
  used_count  int unsigned not null default 0,
  active      tinyint(1)   not null default 1,
  created_at  timestamp    not null default current_timestamp,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  constraint discounts_kind_ck  check (kind in ('code','auto')),
  constraint discounts_type_ck  check (type in ('percent','fixed')),
  constraint discounts_value_ck check (value > 0),
  -- An automatic rule has no code; a code rule must have one. Enforced here so
  -- a bad row cannot be created by any path, admin or otherwise.
  constraint discounts_code_ck  check ((kind = 'auto' and code is null)
                                    or (kind = 'code' and code is not null))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_discounts_live on discounts (active, kind);

-- ------------------------------------------------------- what the order kept
--
-- The order records what was actually charged and why. subtotal is the price
-- of the goods before any discount; amount stays what the customer pays and
-- what the bank is asked for, so nothing in the payment path has to know that
-- discounts exist. discount_label is a snapshot: renaming or deleting a
-- discount later must not rewrite the history of an order.
alter table orders add column if not exists subtotal        decimal(10,3) not null default 0 after amount;
alter table orders add column if not exists discount_amount decimal(10,3) not null default 0 after subtotal;
alter table orders add column if not exists discount_code   varchar(24)   null after discount_amount;
alter table orders add column if not exists discount_label  varchar(200)  null after discount_code;

-- Existing orders predate discounts: their subtotal is simply their amount.
update orders set subtotal = amount where subtotal = 0 and amount > 0;

-- ------------------------------------------------------------------- indexes
--
-- Added when the shop was small and every plan looked fine. They are here for
-- the shape the tables grow into, not the shape they have:
--
--   orders          the admin's Orders screen filters by payment or fulfilment
--                   status and always sorts newest-first. Without a composite
--                   index each filtered view is a full scan plus a filesort,
--                   and it gets slower with every order ever taken.
--   fulfilment_outbox  the cron claims work every five minutes, forever, from a
--                   table that only grows — sent rows are KEPT, deliberately,
--                   because they are the record that the warehouse was told.
--                   Measured before this index: type ALL, Using filesort.
--   orders.discount_code  the guard that refuses to delete a discount an order
--                   was placed with. A scan per delete.
create index if not exists idx_orders_payment    on orders (payment_status, created_at);
create index if not exists idx_orders_fulfilment on orders (fulfilment_status, created_at);
create index if not exists idx_orders_discount   on orders (discount_code);
create index if not exists idx_outbox_pending    on fulfilment_outbox (sent_at, attempts, created_at);
