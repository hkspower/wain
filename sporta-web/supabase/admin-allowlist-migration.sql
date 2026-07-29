-- Sporta — make "admin" mean an ALLOWLISTED account, not merely a signed-in one.
--
-- Safe to re-run.
--
-- ============================ THE VULNERABILITY ============================
-- Every admin policy and RPC was gated on the `authenticated` ROLE:
--
--   create policy orders_admin_read on public.orders
--     for select to authenticated using (true);
--   create policy products_admin_write on public.products
--     for all to authenticated using (true) with check (true);
--   grant execute on function public.admin_order_stats() to authenticated;
--
-- In Supabase `authenticated` is not "an admin" — it is ANY account that has
-- signed in. Projects allow public sign-up by default, and the anon key is
-- published in public_html/config.js because it is designed to be public. So
-- the whole chain was:
--
--   POST /auth/v1/signup  with the public anon key  ->  an authenticated JWT
--
-- and that JWT alone was enough to:
--   * READ EVERY ORDER — customer name, phone, governorate, block, street,
--     building, floor, flat. That is every customer's home address.
--   * rewrite any customer's delivery address (orders_admin_update).
--   * CHANGE ANY PRODUCT PRICE — products_admin_write is `for all`, so insert,
--     update and delete. Orders are priced server-side FROM products.price, so
--     setting a price to 0.001 buys the item for 0.001 KWD.
--   * read full revenue (admin_order_stats, admin_revenue_daily).
--   * settle cash orders (admin_set_cod_paid).
--   * set a device quick-unlock passcode for the admin UI.
--
-- The original code knew: "Admin routes are behind Supabase Auth; tighten to a
-- role/claim if you add one." This is that tightening.
--
-- ================================ THE FIX =================================
-- An explicit allowlist table plus is_admin(), and every admin policy and RPC
-- re-gated on it. Being signed in is now necessary but nowhere near sufficient.
--
-- Deliberately NOT done with a JWT claim: custom claims need an Auth Hook and
-- re-issued tokens, and a stale token would keep working after you removed
-- someone. A table row is checked on every single statement, so revoking an
-- admin takes effect immediately.

-- ============ 1. who is an admin ============
create table if not exists public.admin_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Allowlist of accounts that may use /admin. Rows are added ONLY from the '
  'Supabase SQL editor (service role, bypasses RLS) — there is deliberately no '
  'API path to grant yourself admin.';

alter table public.admin_users enable row level security;

-- security definer so the check itself is not subject to admin_users' own RLS
-- (which would recurse). stable so the planner may cache it per statement.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- Admins may see the list (so the UI can show who has access). Nobody can
-- write through the API at all: no insert/update/delete policy exists, and with
-- RLS on, absent policy = denied. Adding an admin is a SQL-editor operation.
drop policy if exists admin_users_read on public.admin_users;
create policy admin_users_read on public.admin_users
  for select to authenticated using (public.is_admin());

-- ============ 2. re-gate every admin policy ============
-- products: the public still reads active products; only admins see inactive
-- ones or write. products_admin_write was the price-tampering hole.
drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select to authenticated using (public.is_admin());

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- orders + items: customer PII. This is the row that mattered most.
drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists order_items_admin_read on public.order_items;
create policy order_items_admin_read on public.order_items
  for select to authenticated using (public.is_admin());

-- The money guard in WITH CHECK is kept exactly as it was and ANDed with the
-- admin test: an admin still cannot move amount or payment_status by hand.
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and amount = (select o.amount from public.orders o where o.id = orders.id)
    and payment_status = (select o.payment_status from public.orders o where o.id = orders.id)
  );

-- ============ 3. re-gate the RPCs ============
-- A GRANT to authenticated is not authorisation. These are security definer, so
-- they run with the owner's rights and bypass RLS entirely — the check has to be
-- inside the function body.
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
  revenue_7d        numeric,
  cod_awaiting_count   bigint,
  cod_awaiting_amount  numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
  select
    count(*) filter (where o.payment_status = 'paid'),
    coalesce(sum(o.amount) filter (where o.payment_status = 'paid'), 0),
    count(*) filter (where o.payment_status = 'pending'),
    count(*) filter (where o.payment_status = 'review'),
    count(*) filter (where o.payment_status = 'failed'),
    count(*) filter (where o.payment_status = 'paid' and o.fulfilment_status = 'unfulfilled'),
    count(*) filter (where o.payment_status = 'paid' and o.paid_at >= date_trunc('day', now())),
    coalesce(sum(o.amount) filter (where o.payment_status = 'paid' and o.paid_at >= date_trunc('day', now())), 0),
    count(*) filter (where o.payment_status = 'paid' and o.paid_at >= now() - interval '7 days'),
    coalesce(sum(o.amount) filter (where o.payment_status = 'paid' and o.paid_at >= now() - interval '7 days'), 0),
    count(*) filter (where o.payment_method = 'cod' and o.payment_status = 'pending'
                       and o.fulfilment_status <> 'cancelled'),
    coalesce(sum(o.amount) filter (where o.payment_method = 'cod' and o.payment_status = 'pending'
                                     and o.fulfilment_status <> 'cancelled'), 0)
  from public.orders o;
end $$;

revoke all on function public.admin_order_stats() from public, anon;
grant execute on function public.admin_order_stats() to authenticated;

create or replace function public.admin_revenue_daily(p_days int default 14)
returns table (day date, orders bigint, revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  -- Clamped: an unbounded p_days is a cheap way to make the server generate a
  -- very large series on every call.
  p_days := least(greatest(coalesce(p_days, 14), 1), 180);
  return query
  select d::date,
         count(o.id),
         coalesce(sum(o.amount), 0)
    from generate_series(date_trunc('day', now()) - ((p_days - 1) || ' days')::interval,
                         date_trunc('day', now()),
                         interval '1 day') d
    left join public.orders o
           on o.payment_status = 'paid'
          and o.paid_at >= d
          and o.paid_at <  d + interval '1 day'
   group by d
   order by d;
end $$;

revoke all on function public.admin_revenue_daily(int) from public, anon;
grant execute on function public.admin_revenue_daily(int) to authenticated;

-- Cash settlement: same treatment. Without this, any signed-up account could
-- mark cash orders paid and corrupt the revenue figures.
create or replace function public.admin_set_cod_paid(
  p_order_id uuid,
  p_paid     boolean default true
) returns table (new_status text, new_paid_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_method text;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select o.payment_method, o.payment_status
    into v_method, v_status
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_method <> 'cod' then
    raise exception 'not_a_cash_order' using errcode = 'P0001';
  end if;

  if p_paid then
    if v_status <> 'pending' then
      raise exception 'order_not_pending' using errcode = 'P0001';
    end if;
    update public.orders
       set payment_status = 'paid', paid_at = coalesce(paid_at, now())
     where id = p_order_id;
  else
    if v_status <> 'paid' then
      raise exception 'order_not_paid' using errcode = 'P0001';
    end if;
    update public.orders
       set payment_status = 'pending', paid_at = null
     where id = p_order_id;
  end if;

  return query
    select o.payment_status, o.paid_at from public.orders o where o.id = p_order_id;
end $$;

revoke all on function public.admin_set_cod_paid(uuid, boolean) from public, anon;
grant execute on function public.admin_set_cod_paid(uuid, boolean) to authenticated;

-- ============ 4. the device quick-unlock passcode ============
-- set_device_passcode let any signed-in account register a passcode for the
-- admin UI. Gate it the same way. verify_/has_ are left callable so the lock
-- screen can still ask "is there a passcode for this device?" without already
-- being through it — they reveal nothing but a boolean and never grant access
-- on their own.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_device_passcode'
  ) then
    execute $q$
      revoke all on function public.set_device_passcode(text, text, text) from public, anon;
      grant execute on function public.set_device_passcode(text, text, text) to authenticated;
    $q$;
  end if;
end $$;

-- ============ 5. did it work? ============
-- admin_count must be 1 or more, or NOBODY can use /admin. Add yourself here in
-- the SQL editor (this editor runs as the service role and bypasses RLS):
--
--   insert into public.admin_users (user_id, email)
--   select id, email from auth.users where email = 'you@example.com'
--   on conflict (user_id) do nothing;
--
select
  (select count(*) from public.admin_users)                                  as admin_count,
  (select count(*) from auth.users)                                          as auth_accounts,
  (select count(*) from pg_policies
    where schemaname = 'public' and qual like '%is_admin%')                   as policies_gated;
