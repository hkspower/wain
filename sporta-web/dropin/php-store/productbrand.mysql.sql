-- ===========================================================================
-- Sporta — which BRAND a product belongs to.
--
-- Additive, and byte-for-byte the same statements as the ones in
-- schema.mysql.sql. `if not exists`, so importing it twice changes nothing.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DID NOT EXIST
--
-- The `brands` table has been here for a while and the admin can manage it, but
-- nothing ever said WHICH brand a given product is. The brand list was a list —
-- eight rows nobody could reach from a garment. So the product page could show
-- the shop's own logo and the AHED supplier plate, and could not show that the
-- thing you are looking at is a Vanquish tee.
--
-- A SLUG, NOT A FOREIGN KEY ID. Everything else in this schema joins products
-- to variants on `slug` for the same reason: the catalogue is imported and
-- re-imported from the supplier's export, and an auto-increment id is not
-- stable across that. `brands.slug` is, and it is also readable in a database
-- dump, which matters on a host where phpMyAdmin is the debugger.
--
-- DELIBERATELY NOT A FOREIGN KEY CONSTRAINT. Deleting a brand must not delete
-- products or fail because a garment still points at it; an unmatched slug
-- simply shows no brand, which is the same as showing none today. The join is
-- LEFT and the page treats a missing brand as "no plate", so the failure mode
-- of bad data is a slightly plainer page rather than a broken one.
-- ===========================================================================

alter table products add column if not exists brand_slug varchar(64) null after category;

-- The product page and the shop grid both filter on it, and the admin lists
-- products by brand.
create index if not exists idx_products_brand on products (brand_slug);

-- ---------------------------------------------------------------------------
-- MORE THAN ONE PHOTOGRAPH.
--
-- The product page has had a gallery for a while and the catalogue had nowhere
-- to put a second picture: `products.image` is one URL, and productImages()
-- read a `p.images` field that no table ever had. So the gallery's swipe,
-- arrows, dots and thumbnails were unreachable code — they appear only when
-- there is more than one image, and there never was.
--
-- A COMMA-SEPARATED LIST OF PATHS, not an upload and not a join table.
--   * Not an upload, because this shop has no image upload by design: an
--     endpoint that writes into the web root is the thing sporta-deploy.php
--     was. Photographs are files the owner puts on the server by hand, exactly
--     as the category art already is.
--   * Not a join table, because a handful of ordered URLs is not a
--     relationship — it is a list, the order is the display order, and a
--     second table would need its own admin screen to reorder rows that a text
--     field reorders by dragging a comma.
--
-- The main `image` stays where it is and stays first in the gallery, so a
-- product with nothing in this column renders exactly as it does today.
alter table products add column if not exists images text null after image;
