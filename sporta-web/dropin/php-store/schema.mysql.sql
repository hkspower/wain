-- Sporta native backend — MySQL schema.
--
-- Import once in hPanel -> Databases -> phpMyAdmin -> Import (or paste into the
-- SQL tab). Safe to re-run: everything is IF NOT EXISTS and the seed matches on
-- slug, so prices update in place and nothing duplicates.
--
-- This is the MySQL twin of supabase/schema.sql and its migrations, carrying
-- the same decisions: DECIMAL(10,3) because KWD has three decimal places and
-- floats lose fils; sizes and fits as CHECK lists because a text column fed
-- from a JSON body must not be free storage; utf8mb4 because the catalogue is
-- Arabic and utf8mb3 silently truncates at the first 4-byte glyph.

set names utf8mb4;

create table if not exists products (
  id        int unsigned auto_increment primary key,
  slug      varchar(80)  not null unique,
  name_en   varchar(160) not null,
  name_ar   varchar(160) not null,
  desc_en   text         null,
  desc_ar   text         null,
  price     decimal(10,3) not null,
  category  varchar(40)  null,
  image     varchar(500) null,
  active    tinyint(1)   not null default 1,
  created_at timestamp   not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists orders (
  id             int unsigned auto_increment primary key,
  track_id       varchar(30) not null unique,
  amount         decimal(10,3) not null default 0,
  payment_status varchar(10) not null default 'pending',
  payment_method varchar(10) not null default 'knet',
  fulfilment_status varchar(12) not null default 'unfulfilled',
  -- The bank's answer, written by callback.php. Same cbk_* names as the
  -- Postgres schema so the callback code differs only in its storage driver.
  cbk_status      varchar(30)  null,
  cbk_message     varchar(200) null,
  cbk_paymentid   varchar(60)  null,
  cbk_transaction varchar(60)  null,
  cbk_authcode    varchar(30)  null,
  cbk_reference   varchar(60)  null,
  cbk_receipt     varchar(60)  null,
  cbk_paytype     varchar(20)  null,
  customer_name        varchar(80) null,
  customer_phone       varchar(15) null,
  customer_governorate varchar(20) null,
  customer_area        varchar(60) null,
  customer_block       varchar(12) null,
  customer_street      varchar(40) null,
  customer_building    varchar(24) null,
  customer_floor       varchar(16) null,
  customer_flat        varchar(16) null,
  customer_note        varchar(280) null,
  paid_at    timestamp null,
  fulfilled_at timestamp null,
  created_at timestamp not null default current_timestamp,
  constraint orders_payment_status_ck  check (payment_status  in ('pending','paid','failed','review')),
  constraint orders_payment_method_ck  check (payment_method  in ('knet','tpay','cod')),
  constraint orders_fulfilment_ck      check (fulfilment_status in ('unfulfilled','packed','shipped','delivered','cancelled'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_orders_created on orders (created_at);

create table if not exists order_items (
  id         int unsigned auto_increment primary key,
  order_id   int unsigned not null,
  product_id int unsigned not null,
  qty        int not null,
  unit_price decimal(10,3) not null default 0,
  size       varchar(4) null,
  fit        varchar(10) null,
  constraint fk_items_order   foreign key (order_id)   references orders (id) on delete cascade,
  constraint fk_items_product foreign key (product_id) references products (id),
  constraint items_qty_ck  check (qty between 1 and 99),
  constraint items_size_ck check (size is null or size in ('S','M','L','XL','2XL','3XL','4XL','5XL','ONE')),
  constraint items_fit_ck  check (fit  is null or fit  in ('normal','slim','loose','oversize','boxy','tank'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_items_order on order_items (order_id);

create table if not exists product_variants (
  sku    varchar(30) not null primary key,
  slug   varchar(80) not null,
  size   varchar(4)  not null,
  stock  int not null default 0,
  -- Wholesale cost. The public stock endpoint NEVER selects this column — it
  -- is the one commercially sensitive number in the schema.
  cost_aed decimal(10,2) null,
  constraint variants_stock_ck check (stock >= 0)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_variants_slug on product_variants (slug);

create table if not exists admin_users (
  id            int unsigned auto_increment primary key,
  email         varchar(120) not null unique,
  password_hash varchar(255) not null,
  failed_attempts int not null default 0,
  locked_until  timestamp null,
  last_login_at timestamp null,
  created_at    timestamp not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The transactional outbox — same design as supabase/fulfilment-migration.sql,
-- same reasoning: the message row is written in the order's own transaction so
-- an order cannot exist without its warehouse message, and sending is a
-- separate job (cron-fulfilment.php) that drains and marks.
create table if not exists fulfilment_outbox (
  id         int unsigned auto_increment primary key,
  order_id   int unsigned not null,
  kind       varchar(10) not null,
  payload    json not null,
  created_at timestamp not null default current_timestamp,
  sent_at    timestamp null,
  attempts   int not null default 0,
  last_error varchar(500) null,
  -- MySQL has no partial indexes, and a plain UNIQUE(order_id, kind) would be
  -- wrong: an order can FAIL and then be PAID on a retry of the same track id,
  -- which is legitimately two 'payment' messages. Only 'new' must be unique —
  -- one picking list per order — so a generated column carries the order_id
  -- only for 'new' rows, and the unique index ignores the NULLs on the rest.
  new_once   int unsigned generated always as (case when kind = 'new' then order_id else null end) stored,
  constraint fk_outbox_order foreign key (order_id) references orders (id) on delete cascade,
  constraint outbox_kind_ck check (kind in ('new','payment'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- One picking list per order, guaranteed by the index rather than by memory.
create unique index if not exists uq_outbox_new on fulfilment_outbox (new_once);
