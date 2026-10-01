-- Sporta — the home page's product banner, above "Shop by category". 2026-10-01.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- ONE ROW (id = 1): the owner's choice of product, the words in both languages,
-- the link, the on/off switch, and an optional uploaded picture. The picture is
-- BYTES in the row rather than a file for the reason category_art gives — this
-- shop never needs write access to its web root — and it is in a table of its
-- own rather than the `settings` table because store_settings() loads every
-- settings row on every request: a few hundred kB of picture there would be read
-- on every API call in the shop.
--
-- With no table, no row, or `enabled = 0`, the banner simply is not drawn.
create table if not exists home_banner (
  id          tinyint       not null,
  enabled     tinyint(1)    not null default 0,
  product     varchar(64)   null,
  kicker_en   varchar(60)   not null default '',
  kicker_ar   varchar(60)   not null default '',
  title_en    varchar(90)   not null default '',
  title_ar    varchar(90)   not null default '',
  button_en   varchar(30)   not null default '',
  button_ar   varchar(30)   not null default '',
  href        varchar(200)  not null default '',
  image       mediumblob    null,
  image_type  varchar(10)   null,
  image_w     int           null,
  image_h     int           null,
  etag        char(32)      null,
  updated_at  timestamp     not null default current_timestamp on update current_timestamp,
  primary key (id),
  constraint home_banner_one_row check (id = 1),
  constraint home_banner_type_ck check (image_type is null or image_type in ('webp','jpeg','png'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
