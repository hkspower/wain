-- Sporta — harden the admin quick-unlock passcode.
--
-- Safe to re-run. Run AFTER admin-allowlist-migration.sql (it needs is_admin()).
--
-- WHAT WAS ALREADY RIGHT, and is not being changed
-- The design of passcode-migration.sql is sound and stays: bcrypt hashes only
-- (a leak of the table cannot be replayed), RLS on with NO policies so the table
-- is unreachable except through the security-definer RPCs, and a server-side
-- attempt counter with a wall-clock lockout that a browser cannot wait out by
-- clearing storage or calling the RPC directly.
--
-- THE THREE GAPS
--
-- 1. AUTHORISATION. set_device_passcode was granted to `authenticated` and
--    checked nothing else, so any account that merely signed up could enrol a
--    passcode. RLS still kept it away from orders, but it could write rows into
--    the admin passcode table and enrol its own device. The earlier allowlist
--    migration fixed the GRANT (anon lost it) but not the authorisation — a
--    grant says who may call, not who may act. All three RPCs now require
--    is_admin() in the body.
--
-- 2. OWNERSHIP. The table was keyed on device_id alone, so a passcode belonged
--    to a browser rather than to a person. Removing someone from admin_users
--    revoked their data access but left their device unlock intact, and the
--    admin UI could not show whose devices were enrolled. There is now a
--    user_id, set from auth.uid() at enrolment and cascading on delete: drop the
--    admin, and the enrolment goes with them.
--
-- 3. NO WAY TO SEE OR REVOKE. There was no list and no delete, so a lost phone
--    could not be un-enrolled without opening the SQL editor.
--
-- WHAT THE PASSCODE IS, HONESTLY
-- It is a re-lock over an existing Supabase session, not a second factor and not
-- a login. Someone holding a live session token could still reach the API
-- directly; the passcode stops a person who picks up an unlocked laptop. That is
-- what it is for, and the UI says so.

-- ============ 1. ownership ============
alter table public.admin_device_passcodes
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_passcode_user on public.admin_device_passcodes(user_id);

comment on column public.admin_device_passcodes.user_id is
  'The admin who enrolled this device. ON DELETE CASCADE, so removing the '
  'account removes the unlock with it.';

-- ============ 2. enrol — admins only, and recorded against them ============
create or replace function public.set_device_passcode(
  p_device_id text,
  p_passcode  text,
  p_label     text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if coalesce(p_device_id, '') = '' then
    raise exception 'device_id_required' using errcode = 'P0001';
  end if;
  if p_passcode !~ '^\d{6}$' then
    raise exception 'passcode_must_be_6_digits' using errcode = 'P0001';
  end if;
  -- Reject the codes a hurried person picks first. Six identical digits and
  -- straight runs are the whole top of every leaked-PIN list, and this is the
  -- one moment we can refuse them.
  if p_passcode ~ '^(\d)\1{5}$'
     or p_passcode in ('123456','654321','012345','543210','111111','000000') then
    raise exception 'passcode_too_obvious' using errcode = 'P0001';
  end if;

  insert into public.admin_device_passcodes (device_id, user_id, passcode_hash, label)
  values (p_device_id, v_uid, crypt(p_passcode, gen_salt('bf', 10)),
          nullif(btrim(coalesce(p_label, '')), ''))
  on conflict (device_id) do update
    set passcode_hash = excluded.passcode_hash,
        user_id       = excluded.user_id,
        label         = coalesce(excluded.label, public.admin_device_passcodes.label),
        attempts      = 0,
        locked_until  = null,
        created_at    = now();

  return jsonb_build_object('ok', true);
end $$;

-- ============ 3. verify / check — admins only ============
-- The lock screen runs inside an existing admin session, so is_admin() is true
-- there. Requiring it stops a signed-up non-admin using these to probe the
-- passcode table or burn another admin's attempts into a lockout.
create or replace function public.verify_device_passcode(
  p_device_id text,
  p_passcode  text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r     public.admin_device_passcodes%rowtype;
  v_max int := public.passcode_max_attempts();
  v_ok  boolean;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select * into r from public.admin_device_passcodes
    where device_id = p_device_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled',
                              'attempts_left', null, 'locked_until', null);
  end if;

  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked',
                              'attempts_left', 0, 'locked_until', r.locked_until);
  end if;

  if r.locked_until is not null and r.locked_until <= now() then
    update public.admin_device_passcodes
       set attempts = 0, locked_until = null
     where device_id = p_device_id;
    r.attempts := 0;
  end if;

  v_ok := (r.passcode_hash = crypt(p_passcode, r.passcode_hash));

  if v_ok then
    update public.admin_device_passcodes
       set attempts = 0, locked_until = null, last_used_at = now()
     where device_id = p_device_id;
    return jsonb_build_object('ok', true, 'reason', null,
                              'attempts_left', v_max, 'locked_until', null);
  end if;

  update public.admin_device_passcodes
     set attempts = r.attempts + 1,
         locked_until = case when r.attempts + 1 >= v_max
                             then now() + public.passcode_lockout() else null end
   where device_id = p_device_id
   returning * into r;

  if r.locked_until is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked',
                              'attempts_left', 0, 'locked_until', r.locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong',
                            'attempts_left', v_max - r.attempts, 'locked_until', null);
end $$;

create or replace function public.has_device_passcode(p_device_id text)
returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.admin_device_passcodes where device_id = p_device_id
  );
end $$;

-- ============ 4. list and revoke enrolled devices ============
-- Without these a lost phone stayed enrolled until someone opened the SQL
-- editor. No hashes are returned.
drop function if exists public.admin_list_devices();

create function public.admin_list_devices()
returns table (
  device_id    text,
  label        text,
  mine         boolean,
  owner_email  text,
  created_at   timestamptz,
  last_used_at timestamptz,
  locked_until timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
    select d.device_id, d.label, d.user_id = auth.uid(), u.email,
           d.created_at, d.last_used_at, d.locked_until
      from public.admin_device_passcodes d
      left join auth.users u on u.id = d.user_id
     order by d.last_used_at desc nulls last, d.created_at desc;
end $$;

create or replace function public.admin_revoke_device(p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gone int;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  delete from public.admin_device_passcodes where device_id = p_device_id;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', v_gone > 0, 'removed', v_gone);
end $$;

-- ============ 5. grants ============
-- anon has no business with any of these: quick unlock re-locks an admin who
-- already holds a Supabase session, so it is never part of a public flow.
revoke all on function public.set_device_passcode(text, text, text) from public, anon;
revoke all on function public.verify_device_passcode(text, text)    from public, anon;
revoke all on function public.has_device_passcode(text)             from public, anon;
revoke all on function public.admin_list_devices()                  from public, anon;
revoke all on function public.admin_revoke_device(text)             from public, anon;

grant execute on function public.set_device_passcode(text, text, text) to authenticated;
grant execute on function public.verify_device_passcode(text, text)    to authenticated;
grant execute on function public.has_device_passcode(text)             to authenticated;
grant execute on function public.admin_list_devices()                  to authenticated;
grant execute on function public.admin_revoke_device(text)             to authenticated;

select
  (select count(*) from public.admin_device_passcodes)                    as devices_enrolled,
  (select count(*) from public.admin_device_passcodes where user_id is null) as unowned_legacy,
  public.passcode_max_attempts()                                          as attempts_allowed,
  public.passcode_lockout()                                               as lockout_window;
