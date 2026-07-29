-- Sporta — let the admin settle CASH-ON-DELIVERY orders.
--
-- Safe to re-run.
--
-- THE BUG THIS FIXES
-- admin-migration.sql locks payment_status against admin edits:
--
--   create policy orders_admin_update on public.orders
--     for update to authenticated
--     using (true)
--     with check (
--       amount         = (select o.amount         from public.orders o where o.id = orders.id)
--       and payment_status = (select o.payment_status from public.orders o where o.id = orders.id)
--     );
--
-- That is exactly right for cards: a KNET or T-Pay order becomes 'paid' only
-- because the bank's callback said so, and nobody signed into /admin should be
-- able to assert a payment the bank never confirmed.
--
-- Then cash on delivery arrived (payment-method-migration.sql) and that policy
-- was never revisited. A cash order is genuinely unpaid until the driver hands
-- the money over, so it is created 'pending' and is supposed to become 'paid'
-- when the admin confirms the cash — but there was no way to do it. Result:
--   * every cod order sat at 'pending' forever;
--   * admin_order_stats counts only payment_status = 'paid', so the entire cash
--     side of the business was missing from revenue, today, last-7-days and the
--     daily chart;
--   * the Orders screen printed "Mark it paid once the cash is in" next to no
--     control that could do it.
--
-- THE FIX, AND WHY IT IS A FUNCTION AND NOT A LOOSER POLICY
-- The policy stays exactly as it is. Relaxing it would let an admin flip ANY
-- order to paid, including a card order that failed. Instead this adds one
-- narrow security-definer door that can only ever do the cash transition:
--   * payment_method must be 'cod' — a card order is untouchable here;
--   * only pending <-> paid, nothing else;
--   * paid_at is maintained too. Nothing else sets it (only the bank callbacks
--     do, server-side with the service key), and the stats and the chart filter
--     on paid_at — so without this the revenue would land in the totals but
--     never in "today" or the graph.
-- Reverting is allowed because a mis-click otherwise inflates revenue with no
-- way back, and reverting can only ever REDUCE reported money, never invent it.

-- ============ 1. settle / un-settle a cash order ============
-- The OUT parameters are new_status / new_paid_at rather than the column names:
-- a RETURNS TABLE column becomes a PL/pgSQL variable, so naming one `paid_at`
-- made `set paid_at = coalesce(paid_at, now())` ambiguous and the function
-- failed at runtime with "column reference paid_at is ambiguous".
-- Dropped first so this file stays re-runnable even when the signature changes:
-- "create or replace" cannot rename OUT parameters any more than it can add
-- them, and it fails rather than warning.
drop function if exists public.admin_set_cod_paid(uuid, boolean);

create function public.admin_set_cod_paid(
  p_order_id uuid,
  p_paid     boolean default true
) returns table (new_status text, new_paid_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_method text;
  v_status text;
begin
  select o.payment_method, o.payment_status
    into v_method, v_status
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  -- The whole point of the function: cash only.
  if v_method <> 'cod' then
    raise exception 'not_a_cash_order' using errcode = 'P0001';
  end if;

  if p_paid then
    -- Only pending may be settled. 'failed' or 'review' need looking at, not a
    -- shortcut, and re-settling an already-paid order would move paid_at and
    -- silently shift the money into a different day's revenue.
    if v_status <> 'pending' then
      raise exception 'order_not_pending' using errcode = 'P0001';
    end if;
    update public.orders
       set payment_status = 'paid',
           paid_at = coalesce(paid_at, now())
     where id = p_order_id;
  else
    if v_status <> 'paid' then
      raise exception 'order_not_paid' using errcode = 'P0001';
    end if;
    update public.orders
       set payment_status = 'pending',
           paid_at = null
     where id = p_order_id;
  end if;

  return query
    select o.payment_status, o.paid_at from public.orders o where o.id = p_order_id;
end $$;

revoke all on function public.admin_set_cod_paid(uuid, boolean) from public, anon;
grant execute on function public.admin_set_cod_paid(uuid, boolean) to authenticated;

-- ============ 2. stats: separate cash owed from card chasing ============
-- 'pending' meant two opposite jobs. pending+knet is an abandoned checkout to
-- chase with the bank; pending+cod is a real order out for delivery with money
-- to collect. One number could not tell the admin which.
--
-- Dropped first, not "create or replace": the return type gains columns, and
-- Postgres refuses to replace a function whose OUT parameters changed. Every
-- database that has ever run admin-migration.sql already has the old shape.
drop function if exists public.admin_order_stats();

create function public.admin_order_stats()
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
  revenue_7d        numeric,
  cod_awaiting_count   bigint,
  cod_awaiting_amount  numeric
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
    coalesce(sum(amount) filter (where payment_status = 'paid' and paid_at >= now() - interval '7 days'), 0),
    -- cash still with the driver: ordered, not cancelled, money not in yet
    count(*) filter (where payment_method = 'cod' and payment_status = 'pending'
                       and fulfilment_status <> 'cancelled'),
    coalesce(sum(amount) filter (where payment_method = 'cod' and payment_status = 'pending'
                                   and fulfilment_status <> 'cancelled'), 0)
  from public.orders
$$;

revoke all on function public.admin_order_stats() from public, anon;
grant execute on function public.admin_order_stats() to authenticated;

select
  count(*) filter (where payment_method = 'cod' and payment_status = 'pending') as cash_awaiting,
  count(*) filter (where payment_method = 'cod' and payment_status = 'paid')    as cash_collected
from public.orders;
