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
