-- Sporta — the site's own pictures, when the owner replaces them (2026-10-04, "make all website
-- full dynamic to edit at backend").
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- The shop logo (/logo.png, /logo.webp, the white header mark /logo-white.png|webp) and the
-- features band (/assets/features.webp) ship as files, and the bundle asks for those exact URLs.
-- As with the category tiles (categoryart.mysql.sql), an owner's replacement is a ROW: .htaccess
-- sends those names to api.php?r=site_image, which serves the row when there is one and the
-- shipped file when there is not — or when the table, the row or the database is missing.
-- Deleting a row puts the shipped picture back.
create table if not exists site_images (
  name        varchar(24)  not null,
  fmt         varchar(4)   not null,
  bytes       mediumblob   not null,
  etag        char(32)     not null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  primary key (name, fmt),
  constraint site_img_name_ck check (name in ('logo','logo-white','features')),
  constraint site_img_fmt_ck  check (fmt in ('png','webp'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
