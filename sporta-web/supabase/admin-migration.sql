-- Sporta — admin console migration.
-- Run this in the Supabase SQL editor AFTER schema.sql.
-- Safe to re-run: every statement is idempotent.
--
-- Three things this fixes or adds:
--   1. 'review' is a real payment status. callback.php writes it when a payment
--      cannot be verified, but the CHECK constraint rejected it, so the write
--      failed and the order silently stayed 'pending'.
--   2. The admin can actually READ orders. Only an insert policy existed, so a
--      signed-in admin could not select a single order — which is why the
--      Orders screen was showing hardcoded sample rows.
--   3. Orders carry fulfilment state and customer details, so the admin is
--      useful for shipping and not just for watching payments arrive.

-- ============ 1. payment_status: allow 'review' ============

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'review'));

comment on column public.orders.payment_status is
  'pending | paid | failed | review. "review" means the bank may have captured '
  'the payment but the server could not verify the amount or find the order — '
  'never treat it as unpaid without checking the KNET portal first.';

-- ============ 2. fulfilment + customer columns ============

alter table public.orders
  add column if not exists fulfilment_status text not null default 'unfulfilled',
  add column if not exists fulfilled_at    timestamptz,
  add column if not exists customer_name   text,
  add column if not exists customer_phone  text,
  add column if not exists customer_area   text,
  add column if not exists customer_note   text;

alter table public.orders drop constraint if exists orders_fulfilment_status_check;
alter table public.orders
  add constraint orders_fulfilment_status_check
  check (fulfilment_status in ('unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled'));

-- Stamp fulfilled_at automatically so the admin never has to set two fields.
create or replace function public.touch_fulfilled_at()
returns trigger language plpgsql as $$
begin
  if new.fulfilment_status is distinct from old.fulfilment_status then
    new.fulfilled_at := case
      when new.fulfilment_status in ('shipped', 'delivered') then now()
      else null
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_fulfilled_at on public.orders;
create trigger trg_touch_fulfilled_at
  before update on public.orders
  for each row execute function public.touch_fulfilled_at();

-- The admin lists newest-first and filters by status constantly.
create index if not exists idx_orders_created  on public.orders (created_at desc);
create index if not exists idx_orders_payment  on public.orders (payment_status);
create index if not exists idx_orders_fulfil   on public.orders (fulfilment_status);

-- ============ 3. RLS: let signed-in admins read and fulfil ============
--
-- Anonymous visitors still cannot select orders at all — the storefront reads a
-- single order through the get_order_status RPC. These policies apply only to
-- the `authenticated` role, i.e. someone who signed in to /admin.
--
-- If you later add more Supabase users who should NOT see orders, tighten the
-- USING clause to a claim, e.g.  using (auth.jwt() ->> 'role' = 'admin').

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders
  for select to authenticated using (true);

drop policy if exists order_items_admin_read on public.order_items;
create policy order_items_admin_read on public.order_items
  for select to authenticated using (true);

-- Admins update fulfilment and customer details. Payment fields stay the
-- server's job (callback.php uses the service key and bypasses RLS), so the
-- WITH CHECK below refuses any admin edit that would change the money.
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (true)
  with check (
    amount         = (select o.amount         from public.orders o where o.id = orders.id)
    and payment_status = (select o.payment_status from public.orders o where o.id = orders.id)
  );

-- ============ 4. dashboard counters in one round trip ============

create or replace function public.admin_order_stats()
returns table (
  paid_count        bigint,
  paid_revenue      numeric,
  pending_count     bigint,
  review_count      bigint,
  failed_count      bigint,
  unfulfilled_count bigint,
  paid_today        bigint,
  revenue_today     numeric,
  paid_7d           bigint,
  revenue_7d        numeric
)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where payment_status = 'paid'),
    coalesce(sum(amount) filter (where payment_status = 'paid'), 0),
    count(*) filter (where payment_status = 'pending'),
    count(*) filter (where payment_status = 'review'),
    count(*) filter (where payment_status = 'failed'),
    count(*) filter (where payment_status = 'paid' and fulfilment_status = 'unfulfilled'),
    count(*) filter (where payment_status = 'paid' and paid_at >= date_trunc('day', now())),
    coalesce(sum(amount) filter (where payment_status = 'paid' and paid_at >= date_trunc('day', now())), 0),
    count(*) filter (where payment_status = 'paid' and paid_at >= now() - interval '7 days'),
    coalesce(sum(amount) filter (where payment_status = 'paid' and paid_at >= now() - interval '7 days'), 0)
  from public.orders
$$;

revoke all on function public.admin_order_stats() from public, anon;
grant execute on function public.admin_order_stats() to authenticated;

-- Daily paid revenue for the dashboard chart.
create or replace function public.admin_revenue_daily(p_days int default 14)
returns table (day date, orders bigint, revenue numeric)
language sql stable security definer set search_path = public as $$
  select d::date,
         count(o.id),
         coalesce(sum(o.amount), 0)
  from generate_series(
         date_trunc('day', now()) - ((p_days - 1) || ' days')::interval,
         date_trunc('day', now()),
         '1 day'
       ) d
  left join public.orders o
    on o.payment_status = 'paid'
   and o.paid_at >= d
   and o.paid_at <  d + interval '1 day'
  group by d
  order by d
$$;

revoke all on function public.admin_revenue_daily(int) from public, anon;
grant execute on function public.admin_revenue_daily(int) to authenticated;
