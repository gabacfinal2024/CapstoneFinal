-- Let the administrator see every stall's batches, listings and sensor nodes on the web dashboard
-- (read-only). Run once in the Supabase SQL editor, after 007.

drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select using (public.is_admin());

drop policy if exists listings_admin_read on public.marketplace_listings;
create policy listings_admin_read on public.marketplace_listings
  for select using (public.is_admin());

drop policy if exists iot_admin_read on public.iot_nodes;
create policy iot_admin_read on public.iot_nodes
  for select using (public.is_admin());
