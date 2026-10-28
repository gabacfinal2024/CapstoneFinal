-- Run once in the Supabase SQL editor.

-- 1) Public bucket for profile pictures. Without it the app embeds the picture in the profile row instead.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars are public" on storage.objects;
create policy "avatars are public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users replace their own avatar" on storage.objects;
create policy "users replace their own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2) The account type (buyer or stall operator) is fixed at registration.
-- Signed-in users cannot change it, even by calling the API directly. The SQL editor and the
-- service role (auth.uid() is null) can still correct it by hand.
create or replace function public.lock_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'The account type cannot be changed after registration.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_profile_role on public.profiles;
create trigger lock_profile_role
  before update on public.profiles
  for each row execute function public.lock_profile_role();
-- New accounts are Rescue Buyers. An administrator promotes a buyer to Stall Operator.
-- Run once in the Supabase SQL editor (after 006).

-- 1) Registration: whatever the app sends, a new account is a Rescue Buyer.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, phone_number, role, buyer_type, market_location)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone_number', ''),
    'RESCUE_BUYER',
    coalesce(nullif(new.raw_user_meta_data->>'buyer_type', ''), 'RETAILER'),
    coalesce(nullif(new.raw_user_meta_data->>'market_location', ''), 'Bulua WBIT Terminal')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- 2) Who is an administrator
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'ADMIN');
$$;

-- Only an administrator (or the SQL editor / service role, where auth.uid() is null) can change these.
create or replace function public.lock_profile_role()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role
          or new.stall_number is distinct from old.stall_number
          or new.is_verified is distinct from old.is_verified) then
    raise exception 'Only an administrator can change the account type, stall number or verification.';
  end if;
  return new;
end;
$$;

-- 3) Requests to become a stall operator
create table if not exists public.role_requests (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_stall_number text not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists role_requests_one_pending on public.role_requests (user_id) where status = 'PENDING';

alter table public.role_requests enable row level security;
drop policy if exists role_requests_select on public.role_requests;
create policy role_requests_select on public.role_requests
  for select using (user_id = auth.uid() or public.is_admin());
-- no insert/update policies: everything goes through the functions below

create or replace function public.request_operator_role(stall text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select role into r from profiles where id = auth.uid();
  if r is distinct from 'RESCUE_BUYER' then raise exception 'Only rescue buyers can apply to become a stall operator.'; end if;
  if nullif(btrim(stall), '') is null then raise exception 'Enter your stall number.'; end if;
  if exists (select 1 from role_requests where user_id = auth.uid() and status = 'PENDING') then
    raise exception 'You already have a request waiting for review.';
  end if;
  insert into role_requests (user_id, requested_stall_number, note)
  values (auth.uid(), btrim(stall), nullif(btrim(coalesce(note, '')), ''));
end $$;

-- Administrator: set any user's account type (also approves a waiting request for them)
create or replace function public.admin_set_role(target uuid, new_role text, new_stall text default null)
returns void language plpgsql security definer set search_path = public as $$
declare stall text := nullif(btrim(coalesce(new_stall, '')), '');
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  if new_role not in ('STALL_OPERATOR', 'RESCUE_BUYER') then raise exception 'Unsupported account type.'; end if;
  if (select role from profiles where id = target) = 'ADMIN' then raise exception 'Administrator accounts are changed in the database.'; end if;

  if new_role = 'STALL_OPERATOR' then
    if stall is null then
      select requested_stall_number into stall from role_requests where user_id = target and status = 'PENDING';
    end if;
    if stall is null then raise exception 'A stall number is required for a stall operator.'; end if;
    update profiles set role = 'STALL_OPERATOR', stall_number = stall, buyer_type = null, is_verified = true where id = target;
  else
    update profiles set role = 'RESCUE_BUYER', stall_number = null, buyer_type = coalesce(buyer_type, 'RETAILER'), is_verified = false where id = target;
  end if;

  update role_requests set status = case when new_role = 'STALL_OPERATOR' then 'APPROVED' else 'REJECTED' end,
         decided_by = auth.uid(), decided_at = now()
   where user_id = target and status = 'PENDING';

  insert into notifications (user_id, notification_type, title, message)
  values (target, 'ORDER_UPDATE', 'Account type updated',
          case when new_role = 'STALL_OPERATOR'
               then 'You are now a stall operator. Sign in again to see your stall tools.'
               else 'Your account is now a rescue buyer account.' end);
end $$;

-- Administrator: turn down a request
create or replace function public.admin_reject_role_request(request_id bigint, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  update role_requests set status = 'REJECTED', decided_by = auth.uid(), decided_at = now()
   where id = request_id and status = 'PENDING' returning user_id into uid;
  if uid is null then raise exception 'That request was already decided.'; end if;
  insert into notifications (user_id, notification_type, title, message)
  values (uid, 'ORDER_UPDATE', 'Stall operator request declined',
          coalesce(nullif(btrim(coalesce(reason, '')), ''), 'An administrator declined your request. You can ask again after checking your stall number.'));
end $$;

grant execute on function public.request_operator_role(text, text) to authenticated;
grant execute on function public.admin_set_role(uuid, text, text) to authenticated;
grant execute on function public.admin_reject_role_request(bigint, text) to authenticated;

-- 4) Make yourself the first administrator (replace the email), then sign in on the web dashboard:
-- update public.profiles set role = 'ADMIN' where email = 'you@example.com';
