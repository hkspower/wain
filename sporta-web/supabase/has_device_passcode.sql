-- Server-authoritative check: does this device have a passcode enrolled?
-- Read-only, returns a plain boolean, and does NOT consume verify attempts.
-- Run this in the Supabase SQL editor (or add to your migrations).
--
-- SECURITY DEFINER so it can read admin_device_passcodes under RLS, while
-- only ever leaking a single boolean (existence), never the passcode hash.

create or replace function public.has_device_passcode(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_device_passcodes
    where device_id = p_device_id
  );
$$;

-- Allow logged-in admins to call it. Adjust the role to match your setup.
revoke all on function public.has_device_passcode(text) from public;
grant execute on function public.has_device_passcode(text) to authenticated;
