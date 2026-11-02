-- ===========================================================================
-- Sporta — a cancelled order gives its discount uses back.
--
-- Additive, and byte-for-byte the same statement as the one in
-- schema.mysql.sql. `if not exists`, so importing it twice changes nothing.
-- Import it BEFORE the PHP that writes these columns goes live: api.php
-- records them on every order with a discount.
--
-- A limited code ("the first 50 orders", a single-use review code) is claimed
-- inside the order's own transaction, and nothing ever gave the use back. So
-- an order that never happened — a declined card, an abandoned bank page, a
-- cash order nobody confirmed, a bot's fake order — spent a use for good, and
-- a handful of fake orders could finish a launch code before one real
-- customer had it.
--
--   discount_ids       the discounts.id of EVERY rule this order claimed — the
--                      typed code and the automatic rules alike, because
--                      store_discounts_claim() counts a use against each of
--                      them. NULL for an order with no discount and for every
--                      order placed before this column existed (those keep
--                      their uses: there is no record of what they claimed).
--   discount_released  the idempotence guard: set in the same transaction as
--                      the give-back, so the sweeper and a retried callback
--                      cannot both return the same use.
-- ===========================================================================

alter table orders
  add column if not exists discount_ids      json       null after discount_label,
  add column if not exists discount_released tinyint(1) not null default 0 after discount_ids;
