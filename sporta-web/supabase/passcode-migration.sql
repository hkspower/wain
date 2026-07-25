-- Sporta — admin device passcode (quick unlock).
--
-- Run in the Supabase SQL editor after schema.sql. Safe to re-run.
--
-- WHY THIS EXISTS
--
-- The admin has always called set_device_passcode, verify_device_passcode and
-- has_device_passcode, and SECURITY.md documents the feature as server-side
-- with attempt limits and lockout — but nothing created any of it. The only
-- SQL in the repo was has_device_passcode.sql, and on a fresh database that
-- file does not even load: its body reads admin_device_passcodes, which no
-- migration creates, so it fails with
--   ERROR: relation "public.admin_device_passcodes" does not exist
-- and the two GRANT statements after it fail in turn. Quick unlock was
-- non-functional on any project built from this repo.
--
-- This file supersedes has_device_passcode.sql, which has been removed: split
-- across two files, the table and the function that reads it could get out of
-- step exactly as they did.

-- crypt()/gen_salt() live in pgcrypto. Supabase usually installs it into the
-- `extensions` schema; a plain PostgreSQL puts it in public. The functions
-- below carry both on their search_path so this works either way.
create extension if not exists pgcrypto;

-- ============ 1. table ============
--
-- One row per enrolled device. The passcode itself is never stored — only a
-- bcrypt hash — so a leak of this table cannot be replayed as a login.

create table if not exists public.admin_device_passcodes (
  device_id     text primary key,
  passcode_hash text        not null,
  label         text,
  attempts      int         not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.admin_device_passcodes is
  'Admin quick-unlock. Bcrypt hashes only. Reachable exclusively through the '
  'security-definer RPCs below — RLS is on with no policies, so even a leaked '
  'service key path has to go through the attempt limiter.';

-- RLS on with NO policies: the table is unreachable by any client role. Every
-- read and write goes through the SECURITY DEFINER functions, which is what
-- makes the lockout counter impossible to bypass.
alter table public.admin_device_passcodes enable row level security;

-- ============ 2. policy knobs ============

create or replace function public.passcode_max_attempts() returns int
  language sql immutable as $$ select 5 $$;

create or replace function public.passcode_lockout() returns interval
  language sql immutable as $$ select interval '5 minutes' $$;

-- ============ 3. enrol ============
--
-- Six digits, matching the admin UI, enforced here as well because the UI can
-- be bypassed. Re-enrolling replaces the hash and clears any active lockout.

create or replace function public.set_device_passcode(
  p_device_id text,
  p_passcode  text,
  p_label     text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(p_device_id, '') = '' then
    raise exception 'device_id_required' using errcode = 'P0001';
  end if;
  if p_passcode !~ '^\d{6}$' then
    raise exception 'passcode_must_be_6_digits' using errcode = 'P0001';
  end if;

  insert into public.admin_device_passcodes (device_id, passcode_hash, label)
  values (p_device_id, crypt(p_passcode, gen_salt('bf', 10)), nullif(btrim(coalesce(p_label, '')), ''))
  on conflict (device_id) do update
    set passcode_hash = excluded.passcode_hash,
        label         = coalesce(excluded.label, public.admin_device_passcodes.label),
        attempts      = 0,
        locked_until  = null,
        created_at    = now();

  return jsonb_build_object('ok', true);
end $$;

-- ============ 4. verify ============
--
-- Returns exactly the shape the lock screen reads:
--   { ok, reason, attempts_left, locked_until }
--
-- The counter lives server-side. A client that reloads the page, clears
-- storage or calls the RPC directly still burns an attempt, and the lockout
-- window is wall-clock, not something the browser can wait out locally.

create or replace function public.verify_device_passcode(
  p_device_id text,
  p_passcode  text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r        public.admin_device_passcodes%rowtype;
  v_max    int := public.passcode_max_attempts();
  v_ok     boolean;
begin
  select * into r from public.admin_device_passcodes
    where device_id = p_device_id for update;

  if not found then
    -- Deliberately not distinguished from a wrong code at the UI level; the
    -- reason is here for the "enrol first" path, not to enumerate devices.
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled',
                              'attempts_left', null, 'locked_until', null);
  end if;

  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked',
                              'attempts_left', 0, 'locked_until', r.locked_until);
  end if;

  -- A lockout that has expired resets the counter before this attempt counts.
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

-- ============ 5. enrolment check ============
--
-- Read-only, returns a bare boolean, and does NOT consume an attempt. The
-- admin uses it to decide between the lock screen and the enrol screen; the
-- local flag in the browser is only a hint.

create or replace function public.has_device_passcode(p_device_id text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.admin_device_passcodes where device_id = p_device_id
  );
$$;

-- ============ 6. grants ============
--
-- authenticated only. Quick unlock re-locks an admin who already has a
-- Supabase session — it is not a login — so anon has no business calling any
-- of these, and denying it keeps the passcode surface off the public API.

revoke all on function public.set_device_passcode(text, text, text)    from public;
revoke all on function public.verify_device_passcode(text, text)       from public;
revoke all on function public.has_device_passcode(text)                from public;

grant execute on function public.set_device_passcode(text, text, text) to authenticated;
grant execute on function public.verify_device_passcode(text, text)    to authenticated;
grant execute on function public.has_device_passcode(text)             to authenticated;
