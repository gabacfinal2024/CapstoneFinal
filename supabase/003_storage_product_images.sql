-- Public bucket for product (batch) photos. Run once in the Supabase SQL editor.
-- Without it the app embeds the photo in the product row instead, which also works but is heavier.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product images are public" on storage.objects;
create policy "product images are public" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "operators upload their own product images" on storage.objects;
create policy "operators upload their own product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "operators replace their own product images" on storage.objects;
create policy "operators replace their own product images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);
