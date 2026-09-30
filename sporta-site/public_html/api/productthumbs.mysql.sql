-- Sporta — resized copies of product photographs, made once and read back.
--
-- Safe to re-run: `create table if not exists` and nothing else.
--
-- ?r=product_image&w=400|600 (and 96|200) serves a WebP at that width. Making it
-- means decoding the stored original and resizing it, and the shop grid asks for
-- thirty on a first visit while the CDN does not sit in front of /api — so the
-- result is kept here, keyed by the photograph's row id (a photograph is never
-- edited in place: replacing one is a new row) and the width. Deleting a
-- photograph deletes its copies. The route works without this table: it just
-- resizes on every cold request, as it did before.
create table if not exists product_image_thumbs (
  image_id  int unsigned not null,
  w         smallint     not null,
  type      varchar(8)   not null,
  bytes     mediumblob   not null,
  primary key (image_id, w)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
