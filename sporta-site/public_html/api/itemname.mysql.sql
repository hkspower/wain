-- The product's name AS IT WAS SOLD, on the order line. Additive; safe twice.
--
-- WHY AN INVOICE CANNOT READ THE CATALOGUE FOR THIS. order_items already
-- snapshots the unit price, the size and the fit, and orders snapshots
-- discount_label — that one carries a comment saying, in as many words, that
-- renaming or deleting a discount later must not rewrite what an order says it
-- was given. The product NAME was the one field still read live, through a
-- join, so an invoice from July described its items with today's wording.
--
-- Measured: renaming a product changed the wording on an ALREADY PLACED
-- order's invoice. The shop's Arabic copy has been edited repeatedly — typos,
-- better translations, colour names — and every one of those edits silently
-- rewrote every past invoice that included the item. For a document a customer
-- keeps, and that a return or a card dispute is argued from, the description is
-- part of the record just as much as the price is.
--
-- NULL on every row that existed before this, and the readers fall back to the
-- join for those: back-filling from the catalogue would write TODAY's names
-- into history and claim they were the originals, which is worse than an
-- honest gap.
alter table order_items
  add column if not exists name_en varchar(120) null after product_id,
  add column if not exists name_ar varchar(120) null after name_en;
