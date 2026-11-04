-- Deactivate accounts without deleting their profiles, batches, or marketplace history.
-- Run once in the Supabase SQL editor. Configure SUPABASE_SERVICE_ROLE_KEY on the Django backend
-- before using admin account controls; never put that key in the static frontend.

alter table public.profiles
  add column if not exists is_active boolean not null default true;

create or replace function public.lock_profile_role()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role
          or new.stall_number is distinct from old.stall_number
          or new.is_verified is distinct from old.is_verified
          or new.is_active is distinct from old.is_active) then
    raise exception 'Only an administrator can change the account type, stall number, verification or account status.';
  end if;
  return new;
end;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and is_active = true
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

-- A restrictive policy makes the active-account check apply alongside existing table policies,
-- including to sessions whose access token was issued before the account was deactivated.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'iot_nodes', 'products', 'spoilage_predictions', 'sensor_logs',
    'marketplace_listings', 'saved_listings', 'notifications', 'chat_threads',
    'chat_messages', 'role_requests', 'ratings', 'product_climate'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists active_account_required on public.%I', table_name);
      execute format(
        'create policy active_account_required on public.%I as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user())',
        table_name
      );
    end if;
  end loop;
end $$;

-- Keep public image reads available, but disallow authenticated disabled accounts from storage actions.
drop policy if exists active_account_required on storage.objects;
create policy active_account_required on storage.objects as restrictive for all to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());
