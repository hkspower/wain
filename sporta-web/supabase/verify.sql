-- Sporta — did the setup actually work?
--
-- The LAST part of SETUP-ALL.sql, so running that file ends with a readable
-- report. Also safe to run on its own, any time, to answer "is this database
-- set up?".
--
-- WHY IT EXISTS. SETUP-ALL.sql is thousands of lines pasted into a web editor
-- by someone who cannot see a terminal. It finishes, the editor says "Success",
-- and that tells you the LAST statement worked — not that the checkout can take
-- an order. Every setup failure this project has had was silent in exactly that
-- way: a storefront that renders perfectly and a checkout that refuses
-- everything.
--
-- IT IS A FUNCTION, not a plain SELECT, and that is not decoration. A plain
-- query naming storage.buckets fails to PARSE on a project where Storage has
-- never been provisioned — `to_regclass` guards execution, but the planner has
-- already resolved the name and raised. Dynamic SQL is not parsed until it
-- runs, so the report can ask about things that may not exist. The first
-- version of this file died on exactly that, on the check meant to tolerate it.

create or replace function public.sporta_setup_report()
returns table (check_ text, status text, detail text)
language plpgsql
as $$
declare
  n bigint;
begin
  -- A count from a table that may not exist yet.
  create temp table if not exists _t (x int) on commit drop;

  -- ---------------------------------------------------------------- tables
  if to_regclass('public.products') is null then
    return query select '01. products'::text, 'MISSING'::text, 'run schema.sql'::text;
  else
    execute 'select count(*) from public.products' into n;
    return query select '01. products'::text, 'ok'::text, n::text || ' products';
  end if;

  if to_regclass('public.orders') is null then
    return query select '02. orders'::text, 'MISSING'::text, 'run schema.sql'::text;
  else
    execute 'select count(*) from public.orders' into n;
    return query select '02. orders'::text, 'ok'::text, n::text || ' orders';
  end if;

  -- ------------------------------------------------------------- checkout
  -- The most important line in this report. No create_order, no checkout:
  -- every order fails with an opaque error while the shop looks fine.
  -- DUPLICATE matters too — two overloads make a three-argument call ambiguous
  -- and leave an older, less-validated door into order creation standing.
  select count(*) into n from pg_proc where proname = 'create_order';
  return query select
    '03. create_order (checkout works at all)'::text,
    case n when 0 then 'MISSING' when 1 then 'ok' else 'DUPLICATE' end,
    coalesce((select string_agg(oid::regprocedure::text, ' | ')
                from pg_proc where proname = 'create_order'), 'not found');

  return query select
    '04. orders record size and fit'::text,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'order_items'
                         and column_name = 'size') then 'ok' else 'MISSING' end,
    'without this an order does not say which size to pack'::text;

  return query select
    '05. cash on delivery is a payment method'::text,
    case when exists (select 1 from information_schema.check_constraints
                       where constraint_name = 'orders_payment_method_check'
                         and check_clause like '%cod%') then 'ok' else 'MISSING' end,
    '-'::text;

  -- ------------------------------------------------------------ fulfilment
  if to_regclass('public.fulfilment_outbox') is null then
    return query select '06. warehouse outbox'::text, 'MISSING'::text,
                        'the logistics company will not be told about orders'::text;
  else
    execute 'select count(*) from public.fulfilment_outbox where sent_at is null' into n;
    return query select '06. warehouse outbox'::text, 'ok'::text,
                        n::text || ' message(s) waiting to send';
  end if;

  return query select
    '07. warehouse trigger fires on new orders'::text,
    case when exists (select 1 from pg_trigger where tgname = 'trg_queue_fulfilment_new')
         then 'ok' else 'MISSING' end,
    'set WAREHOUSE_EMAIL on the notify-warehouse function too'::text;

  -- --------------------------------------------------------------- invoice
  return query select
    '08. customer invoice'::text,
    case when exists (select 1 from pg_proc where proname = 'get_order_invoice')
         then 'ok' else 'MISSING' end,
    '/invoice/<order number> reads this'::text;

  -- ----------------------------------------------------------------- admin
  if to_regclass('public.admin_users') is null then
    return query select '09. admin allowlist'::text, 'MISSING'::text,
                        'run admin-allowlist-migration.sql'::text;
  else
    execute 'select count(*) from public.admin_users' into n;
    -- The one that locks the owner out of their own shop. is_admin() gates
    -- every admin read and write, so an EMPTY allowlist means the admin screen
    -- shows zero orders and zero products and explains nothing, because RLS
    -- denies by returning no rows rather than an error.
    return query select
      '09. admin allowlist'::text,
      case when n = 0 then 'ACTION NEEDED' else 'ok' end,
      case when n = 0
        then 'EMPTY — nobody can use /admin. Add yourself: insert into public.admin_users (user_id) select id from auth.users where email = ''you@example.com'';'
        else n::text || ' admin(s)' end;
  end if;

  -- ---------------------------------------------------------------- stock
  if to_regclass('public.product_variants') is null then
    return query select '10. per-size stock'::text, 'MISSING'::text, '-'::text;
  else
    execute 'select count(*) from public.product_variants' into n;
    return query select '10. per-size stock'::text, 'ok'::text, n::text || ' size rows';
  end if;

  -- -------------------------------------------------------------- storage
  -- Not provisioned is not a failure — Storage is simply not switched on yet,
  -- and the shop runs without it until real photographs are uploaded.
  if to_regclass('storage.buckets') is null then
    return query select '11. product-images bucket'::text, 'not provisioned'::text,
                        'enable Storage in the dashboard, then run this file again'::text;
  else
    execute 'select count(*) from storage.buckets where id = ''product-images''' into n;
    return query select
      '11. product-images bucket'::text,
      case when n > 0 then 'ok' else 'MISSING' end,
      'the admin image uploader writes here'::text;
  end if;
end $$;

select * from public.sporta_setup_report() order by check_;
