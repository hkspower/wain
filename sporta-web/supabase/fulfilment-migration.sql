-- Sporta — tell the logistics company about every order, automatically.
--
-- Safe to re-run. Run AFTER order-options-migration.sql (it reads order_items.
-- size and fit) and after admin-allowlist-migration.sql (it needs is_admin()).
--
-- ============================== WHAT THIS IS ================================
-- Every order that gets written produces a message for the warehouse: who it
-- goes to, where, and exactly what to put in the box, down to the size and the
-- cut. A second, shorter message follows when the payment outcome lands.
--
-- ====================== WHY AN OUTBOX AND NOT AN HTTP CALL ==================
-- The obvious build is a trigger that POSTs to an Edge Function. Do not do
-- that. A trigger that makes an HTTP call has exactly two failure modes and
-- both are bad:
--
--   * synchronous — the warehouse's mail provider having a slow morning
--     becomes a checkout that times out, and a customer who cannot pay
--   * fire-and-forget — the call fails, nothing is recorded, and the order is
--     simply never sent. Nobody finds out. The customer paid and the parcel
--     does not exist.
--
-- The second is the one that matters here, because THIS FAILURE IS SILENT. No
-- customer complains that the warehouse did not get an email. It surfaces days
-- later as "where is my order".
--
-- So the trigger writes a ROW, in the same transaction as the order itself. If
-- the order exists, its message exists — there is no window where one is
-- committed and the other is not. Sending is a separate job that drains the
-- table and marks rows sent. Anything unsent is still sitting there, visible,
-- and can be retried. That is the transactional outbox, and it is the standard
-- answer to "this notification must not be lost".
--
-- ======================== WHEN THE FIRST ONE FIRES ==========================
-- On INSERT. The owner chose this knowing what it means, and it is written
-- down here so nobody later mistakes it for an oversight:
--
--   an order is INSERTed as 'pending', BEFORE the customer has paid.
--
-- So the warehouse will see orders that are abandoned at the bank page and
-- never paid for. That is why every message states the payment state in its
-- own field rather than burying it, and why a second message follows the
-- moment the outcome is known. The warehouse's rule is: do not ship a 'pending'
-- card order until the follow-up says paid. Cash on delivery needs no wait —
-- there is no payment step to fail.

-- ---------- 1. the outbox ----------
create table if not exists public.fulfilment_outbox (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  -- 'new'     — an order was placed
  -- 'payment' — its payment status reached a settled state
  kind        text not null check (kind in ('new', 'payment')),
  -- A SNAPSHOT, not a join. Two reasons: the message is an audit trail of what
  -- the warehouse was actually told, which a live join stops being the moment
  -- anyone edits the order; and the sender does not need read access to orders
  -- or customers to do its job.
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);

create index if not exists idx_fulfilment_outbox_unsent
  on public.fulfilment_outbox (created_at)
  where sent_at is null;

-- One 'new' message per order, enforced by the database rather than by the
-- sender remembering. A retry, a re-run of this file, or two workers racing
-- cannot produce two picking lists for one parcel.
create unique index if not exists uq_fulfilment_outbox_new
  on public.fulfilment_outbox (order_id)
  where kind = 'new';

alter table public.fulfilment_outbox enable row level security;

-- No policy for anon or authenticated. It holds names, phone numbers and
-- addresses; it is reached only through the security-definer functions below.
-- An absent policy denies everything, which is the correct default here.

comment on table public.fulfilment_outbox is
  'Outbound messages to the logistics company. Written in the same transaction '
  'as the order, so a message cannot go missing. Drained by the notify-warehouse '
  'Edge Function; anything with sent_at null has not reached the warehouse.';

-- ---------- 2. what the warehouse is told ----------
-- Everything needed to pick, pack and deliver one order, and nothing else.
-- No prices per line beyond the total, because the warehouse does not price
-- anything; no internal ids the driver cannot use.
create or replace function public.fulfilment_payload(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'track_id',       o.track_id,
    'placed_at',      o.created_at,
    'amount_kwd',     o.amount,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    -- The one thing the warehouse must not get wrong: cash on delivery means
    -- the driver COLLECTS money. Stated as its own boolean rather than left to
    -- be inferred from payment_method, because "cod" in a string field is easy
    -- to skim past and handing over goods without collecting is a real loss.
    'collect_cash',   (o.payment_method = 'cod' and o.payment_status <> 'paid'),
    'customer', jsonb_build_object(
      'name',  o.customer_name,
      'phone', o.customer_phone
    ),
    'address', jsonb_build_object(
      'governorate', o.customer_governorate,
      'area',        o.customer_area,
      'block',       o.customer_block,
      'street',      o.customer_street,
      'building',    o.customer_building,
      'floor',       o.customer_floor,
      'flat',        o.customer_flat,
      'note',        o.customer_note
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name_en', p.name_en,
               'name_ar', p.name_ar,
               'sku',     p.slug,
               'qty',     oi.qty,
               'size',    oi.size,
               'fit',     oi.fit
             ) order by p.name_en, oi.size)
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- ---------- 3. the triggers ----------
create or replace function public.queue_fulfilment_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fulfilment_outbox (order_id, kind, payload)
  values (new.id, 'new', public.fulfilment_payload(new.id))
  on conflict do nothing;
  return null;
end $$;

-- AFTER INSERT, and it has to be a statement the order's own transaction can
-- see finished: the items are inserted AFTER the order row, so a row-level
-- AFTER INSERT on orders would snapshot an order with an empty item list. A
-- CONSTRAINT trigger deferred to the end of the transaction sees the whole
-- order, items included.
drop trigger if exists trg_queue_fulfilment_new on public.orders;
create constraint trigger trg_queue_fulfilment_new
  after insert on public.orders
  deferrable initially deferred
  for each row
  execute function public.queue_fulfilment_new();

create or replace function public.queue_fulfilment_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only settled outcomes, and only on an actual change. 'review' and repeated
  -- writes of the same status are not news, and a warehouse that receives a
  -- message per database write stops reading them.
  if new.payment_status is distinct from old.payment_status
     and new.payment_status in ('paid', 'failed') then
    insert into public.fulfilment_outbox (order_id, kind, payload)
    values (new.id, 'payment', public.fulfilment_payload(new.id));
  end if;
  return null;
end $$;

drop trigger if exists trg_queue_fulfilment_payment on public.orders;
create trigger trg_queue_fulfilment_payment
  after update of payment_status on public.orders
  for each row
  execute function public.queue_fulfilment_payment();

-- ---------- 4. how the sender drains it ----------
-- Claim-then-confirm, so a crashed sender cannot lose a message and two senders
-- running at once cannot both send the same one. `for update skip locked` is
-- what makes the second guarantee true rather than hopeful.
create or replace function public.claim_fulfilment(p_limit int default 20)
returns setof public.fulfilment_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.fulfilment_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select id from public.fulfilment_outbox
      where sent_at is null
        -- Give up after five tries. A message that has failed five times is a
        -- broken address or a dead provider, and retrying it forever hides that
        -- behind a queue that never empties.
        and attempts < 5
      order by created_at
      for update skip locked
      limit greatest(1, least(p_limit, 100))
   )
  returning o.*;
end $$;

create or replace function public.mark_fulfilment_sent(p_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.fulfilment_outbox
     set sent_at    = case when p_error is null then now() else null end,
         last_error = p_error
   where id = p_id;
$$;

-- service_role only. These read customer addresses and are called by the Edge
-- Function with the service key; anon and authenticated must never reach them.
revoke all on function public.claim_fulfilment(int) from public, anon, authenticated;
revoke all on function public.mark_fulfilment_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.fulfilment_payload(uuid) from public, anon, authenticated;
grant execute on function public.claim_fulfilment(int) to service_role;
grant execute on function public.mark_fulfilment_sent(uuid, text) to service_role;

-- ---------- 5. what the admin can see ----------
-- Whether the warehouse actually knows about an order. Without this the only
-- way to find out is to ring them up.
create or replace function public.admin_fulfilment_status()
returns table (
  track_id text, kind text, created_at timestamptz,
  sent_at timestamptz, attempts int, last_error text
)
language sql
security definer
set search_path = public
stable
as $$
  select o.track_id, f.kind, f.created_at, f.sent_at, f.attempts, f.last_error
    from public.fulfilment_outbox f
    join public.orders o on o.id = f.order_id
   where public.is_admin()
   order by f.created_at desc
   limit 200;
$$;

revoke all on function public.admin_fulfilment_status() from public, anon;
grant execute on function public.admin_fulfilment_status() to authenticated;

do $$
begin
  raise notice 'fulfilment outbox ready: every order queues a warehouse message on insert';
end $$;
