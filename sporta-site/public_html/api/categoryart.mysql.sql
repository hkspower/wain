-- Sporta — the home page's category tile pictures, when the owner replaces them.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- WHY A TABLE AND NOT FILES. The four tiles (men, women, accessories, outlet)
-- ship as files in /cats/, and the storefront asks for those exact URLs. Replacing
-- one by writing into the public folder needs the web server to be allowed to,
-- which this shop deliberately avoids (hero slides and brand logos are rows for
-- the same reason). So an uploaded picture is a ROW, and `.htaccess` sends the
-- tile URLs to api.php?r=cat_art, which serves the row when there is one and the
-- shipped file when there is not. Deleting the rows puts the shipped art back:
-- that is the whole "reset".
--
-- One row per (tile, variant, format): variant is desktop | mobile, with -rtl
-- for the Arabic composition; format is webp (what browsers are given) or jpg
-- (the <picture> fallback). Eight rows per tile when it is replaced.
create table if not exists category_art (
  tile        varchar(16)  not null,
  variant     varchar(16)  not null,
  fmt         varchar(4)   not null,
  bytes       mediumblob   not null,
  etag        char(32)     not null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp,
  primary key (tile, variant, fmt),
  constraint cat_art_tile_ck    check (tile in ('men','women','accessories','outlet')),
  constraint cat_art_variant_ck check (variant in ('desktop','mobile','desktop-rtl','mobile-rtl')),
  constraint cat_art_fmt_ck     check (fmt in ('webp','jpg'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
