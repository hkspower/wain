-- ===========================================================================
-- Sporta — the warehouse outbox learns two more kinds: 'cancel' and 'reinstate'.
--
-- Additive, and idempotent: importing it twice changes nothing. Import it
-- BEFORE the PHP that queues these kinds goes live (store_fulfilment_cancelled
-- and store_fulfilment_reinstate in store.php). Until then the cash sweeper
-- cannot cancel anything: its release is one transaction, the insert of the
-- "do not ship" row is refused, and the whole release rolls back.
--
-- WHY THIS EXISTS. fulfilment_outbox was created with
--     constraint outbox_kind_ck check (kind in ('new','payment'))
-- The code learned to queue a 'cancel' (CANCELLED — do not ship, for a
-- picking list that said COLLECT CASH) and a 'reinstate', but the CHECK still
-- refused them. The live database, installed from the older list, would
-- raise error 4025 on every auto-cancel of an unconfirmed cash order, so the
-- order would be left holding its garments with no do-not-ship sent to the
-- warehouse — the failure this change exists to prevent.
--
-- The column itself (kind varchar(10)) already fits both words, and the
-- generated new_once column is null for every kind but 'new', so the one
-- picking list per order is still the only unique rule.
--
-- DROP ... IF EXISTS then ADD: MariaDB has no ALTER ... ADD CONSTRAINT IF NOT
-- EXISTS, so the constraint is replaced in place each time. The table holds
-- only the outbox's own rows; re-checking them is cheap.
-- ===========================================================================

alter table fulfilment_outbox drop constraint if exists outbox_kind_ck;
alter table fulfilment_outbox
  add constraint outbox_kind_ck check (kind in ('new','payment','cancel','reinstate'));
