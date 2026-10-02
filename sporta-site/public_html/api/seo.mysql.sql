-- SEO setup, 2026-10-02 ("add seo setup and sitemap builder and robots txt builder at backend").
--
-- product_seo: an optional search-result title and description per product, per language. Its own
-- table rather than columns on products, so the live catalogue table is never ALTERed and
-- product_save (a full upsert of products) can never blank them. Empty = the page's own title and
-- description, exactly as before.
--
-- seo_image: the shop's default share picture (og:image), one row. Its own table, not a settings row,
-- because store_settings() reads every settings row on every request and a picture is up to 900 kB.
--
-- Safe to re-run: `create table if not exists` only, and nothing here writes a row.
create table if not exists product_seo (
  slug        varchar(64)   not null,
  title_en    varchar(70)   not null default '',
  title_ar    varchar(70)   not null default '',
  desc_en     varchar(200)  not null default '',
  desc_ar     varchar(200)  not null default '',
  updated_at  timestamp     not null default current_timestamp on update current_timestamp,
  primary key (slug)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists seo_image (
  id          tinyint       not null,
  image       mediumblob    not null,
  image_type  varchar(10)   not null,
  image_w     int           not null,
  image_h     int           not null,
  etag        char(32)      not null,
  updated_at  timestamp     not null default current_timestamp on update current_timestamp,
  primary key (id),
  constraint seo_image_one_row check (id = 1),
  constraint seo_image_type_ck check (image_type in ('webp','jpeg','png'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
