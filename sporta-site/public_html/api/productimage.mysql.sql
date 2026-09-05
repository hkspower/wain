-- ===========================================================================
-- Sporta — product photographs, uploaded from the admin.
--
-- Additive, and byte-for-byte the same statements as the block at the end of
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- The catalogue had 46 products and NO photographs. `products.image` is a
-- varchar holding a path, and `products.images` a comma-separated list of
-- more of them — both pointing at files the owner had to put on the server
-- by hand through File Manager and then name, correctly, 46 times. In
-- practice that meant a shop of grey placeholders.
--
-- ---------------------------------------------------------------------------
-- WHY A CHILD TABLE AND NOT A COLUMN
--
-- Brand logos and hero slides keep their bytes in the row they belong to,
-- because there is exactly ONE of each. A garment has a shoot: a front, a
-- back, a detail, a model shot. Putting them in `products` would mean either a
-- fixed number of columns or one giant one, and `products` is already the
-- second-widest table here.
--
-- It is keyed on SLUG, not on products.id, for the same reason
-- product_variants is: the slug is what the storefront and the admin both
-- speak, and it survives a row being deleted and re-imported by the seed.
--
-- No foreign key, matching the deliberate choice made for brand_slug two
-- blocks above it: a photograph left behind by a deleted product is invisible
-- (the read path joins to an active product) and costs a few kB, whereas a
-- constraint that makes `delete from products` fail is a support call.
--
-- ---------------------------------------------------------------------------
-- WHY THE BYTES ARE IN THE DATABASE
--
-- Same rule as brand logos and hero slides, and it is not a preference: this
-- server had a PHP endpoint in its web root once that accepted uploads, and
-- an endpoint that writes files is a way in. The row is validated by
-- store_data_image() — png/jpeg/webp only, never SVG, magic number checked
-- against the DECODED bytes, hard size cap — and served back by
-- api.php?r=product_image as real bytes behind a content-hash URL with a
-- one-year immutable cache. The browser pays exactly what it would pay for a
-- file, and nothing on this server needs write access to the web root.
-- ===========================================================================

set names utf8mb4;

create table if not exists product_images (
  id         int unsigned auto_increment primary key,
  -- The garment this belongs to. Not a foreign key — see the note above.
  slug       varchar(120) not null,
  -- Display order, lowest first. The FIRST one is the product's main image:
  -- the card, the search result, the Open Graph preview.
  sort       int          not null default 0,

  -- The bytes, base64 in a data: URI exactly as store_data_image() validates
  -- it. longtext because the cap belongs in PHP, where it can produce an error
  -- the admin can read, rather than in a column width that truncates silently
  -- and renders as a broken image with nothing logged anywhere.
  image      longtext     not null,
  -- sha256 of the data URI, used as the cache-busting ?v=. Replacing a
  -- photograph changes the hash, so the new one appears at once despite the
  -- immutable cache on the old URL.
  image_hash char(64)     not null,
  -- What was stored, so the storefront can reserve the right box before the
  -- bytes arrive. A grid that resizes when the photographs land is layout
  -- shift, which is a Core Web Vital and a measurable annoyance.
  image_w    int          null,
  image_h    int          null,

  created_at timestamp    not null default current_timestamp,

  key idx_product_images (slug, sort, id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci row_format=DYNAMIC;
