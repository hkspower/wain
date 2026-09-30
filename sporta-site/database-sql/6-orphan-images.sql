-- Sporta — photographs and size rows left behind by a renamed product.
--
-- RUN THE REPORT FIRST. Nothing in this file deletes anything until you
-- uncomment the last block, and you should not uncomment it until you have
-- looked at what the report lists.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
--
-- product_images, product_variants and size_advice_log are keyed on
-- products.slug. There is no foreign key and no ON UPDATE CASCADE — a
-- deliberate choice, so the catalogue survives being re-imported from the
-- supplier's export under new row ids — and until now nothing carried those
-- rows when the slug itself changed. The slug is an editable field in the
-- admin's product form.
--
-- So renaming a product detached everything hanging off it:
--
--   the photo shoot   stays in product_images under the old name. Not shown
--                     (?r=products looks up by the new slug and finds
--                     nothing, so the grid goes back to a grey box), not
--                     listed in the admin (which also looks up by slug), not
--                     servable (?r=product_image INNER JOINs products and
--                     404s). The bytes sit in the database with nothing able
--                     to reach them.
--
--   the size rows     stay in product_variants under the old name, and this
--                     is the worse half. A garment with no rows in that table
--                     is treated as UNTRACKED: every size reads as in stock,
--                     and it can be oversold with no warning.
--
-- admin.php now moves all three inside the rename's own transaction, so this
-- cannot happen again. This file is for the rows a rename already stranded.
--
-- ---------------------------------------------------------------------------
-- 1. THE REPORT. Safe, read-only, run it as often as you like.

set names utf8mb4;

select 'orphaned photographs' as what, i.id, i.slug as belongs_to_slug,
       round(length(i.image) / 1024) as kb, i.created_at
  from product_images i
  left join products p on p.slug = i.slug
 where p.slug is null
 order by i.slug, i.sort, i.id;

select 'orphaned size rows' as what, v.sku, v.slug as belongs_to_slug, v.size, v.stock
  from product_variants v
  left join products p on p.slug = v.slug
 where p.slug is null
 order by v.slug, v.sku;

select 'orphaned size advice' as what, count(*) as rows_affected
  from size_advice_log a
  left join products p on p.slug = a.slug
 where p.slug is null;

-- ---------------------------------------------------------------------------
-- 2. THE REATTACH, and try this before you delete anything.
--
-- If the report shows a slug that is OBVIOUSLY the old name of a product you
-- renamed — cloudsoft-jacket-army-green where the catalogue now says
-- cloudsoft-jacket-olive — point the rows back at it and nothing is lost. Fill
-- in the two names and run the three statements together.
--
-- Do them as one transaction: moving the photographs and then failing to move
-- the size rows would leave a garment whose stock lives somewhere else, and
-- the shop would go on selling it.
--
-- start transaction;
--   update product_images   set slug = 'THE-NEW-SLUG' where slug = 'THE-OLD-SLUG';
--   update product_variants set slug = 'THE-NEW-SLUG' where slug = 'THE-OLD-SLUG';
--   update size_advice_log  set slug = 'THE-NEW-SLUG' where slug = 'THE-OLD-SLUG';
-- commit;
--
-- Repeat per renamed product. Then run the report again — it should come back
-- empty.

-- ---------------------------------------------------------------------------
-- 3. THE DELETE. Only for rows whose product is genuinely gone, and only once
-- the report has been read.
--
-- IRREVERSIBLE. A deleted photograph is not somewhere else; the database is
-- where it lived. Take a backup from hPanel first — it takes a minute, and it
-- is the only way back.
--
-- The size rows and the advice log are safe to drop once their product no
-- longer exists: stock for a garment nobody can buy is not a number anyone
-- needs. The photographs are the ones to think about.
--
-- start transaction;
--   delete i from product_images i
--     left join products p on p.slug = i.slug
--    where p.slug is null;
--   delete v from product_variants v
--     left join products p on p.slug = v.slug
--    where p.slug is null;
--   delete a from size_advice_log a
--     left join products p on p.slug = a.slug
--    where p.slug is null;
-- commit;
--
-- Then reclaim the space the photographs were using — longtext is stored off
-- the row and a delete alone does not shrink the file on disk:
--
--   optimize table product_images;
