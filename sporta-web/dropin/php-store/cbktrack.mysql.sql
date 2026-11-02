-- ===========================================================================
-- Sporta — keep CBK's own Track ID for every hosted-gateway payment.
--
-- Additive, and byte-for-byte the same statement as the one in
-- schema.mysql.sql. `if not exists`, so importing it twice changes nothing.
--
-- CBK's result (manual, "Payment Details Entity Reference") carries two track
-- ids: PayId is OURS (tij_MerchantPaymentTrack, already orders.track_id) and
-- TrackId is the GATEWAY's, max 30. The manual says the merchant MUST save the
-- returned values; this one was read and dropped, and it is the reference the
-- bank asks for first in a dispute or a reconciliation query.
-- ===========================================================================
alter table orders add column if not exists cbk_trackid varchar(40) null
  after cbk_paytype;
