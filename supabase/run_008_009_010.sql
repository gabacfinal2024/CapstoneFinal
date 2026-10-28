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
-- Run once in the Supabase SQL editor, after 008.

-- 1) Profile pictures. The profiles table never had this column, which is why saving a photo failed.
alter table public.profiles add column if not exists avatar_url text;

-- 2) Completed deals with both people: the stall operator who sold and the rescue buyer who bought.
--    An administrator sees every deal; an operator or buyer sees their own.
create or replace function public.deal_history()
returns table (
  thread_id bigint, completed_at timestamptz, listing_id bigint, product_id bigint,
  crop_type text, quantity_kg numeric, total numeric, price_per_kg numeric, listing_status text,
  operator_id uuid, operator_name text, operator_email text, stall_number text,
  buyer_id uuid, buyer_name text, buyer_email text, buyer_type text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.updated_at, l.id, p.id,
         p.crop_type, p.quantity_kg, l.listed_price,
         round(l.listed_price / nullif(p.quantity_kg, 0), 2), l.listing_status,
         t.operator_id, op.full_name, op.email, op.stall_number,
         t.buyer_id, bu.full_name, bu.email, bu.buyer_type
  from chat_threads t
  join marketplace_listings l on l.id = t.listing_id
  join products p on p.id = l.product_id
  join profiles op on op.id = t.operator_id
  join profiles bu on bu.id = t.buyer_id
  where t.transaction_completed
    and (public.is_admin() or t.operator_id = auth.uid() or t.buyer_id = auth.uid())
  order by t.updated_at desc;
$$;

-- 3) Administrator: put a batch on the marketplace on behalf of its operator, or take a listing down.
create or replace function public.admin_list_batch(p_product bigint, p_days int default 3)
returns bigint language plpgsql security definer set search_path = public as $$
declare pr products; listing bigint;
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  select * into pr from products where id = p_product;
  if not found then raise exception 'Batch not found.'; end if;
  if pr.freshness_status = 'RED' then raise exception 'A rotten batch cannot be listed.'; end if;

  update products set is_listed = true where id = p_product;
  insert into marketplace_listings (product_id, operator_id, listed_price, original_price, discount_percent, listing_status, expires_at)
  values (p_product, pr.operator_id,
          round(coalesce(pr.current_price_per_kg, 0) * pr.quantity_kg, 2),
          round(coalesce(pr.base_price_per_kg, 0) * pr.quantity_kg, 2),
          coalesce(pr.discount_percent, 0), 'ACTIVE', now() + make_interval(days => greatest(p_days, 1)))
  on conflict (product_id) do update
     set listing_status = 'ACTIVE', listed_price = excluded.listed_price, original_price = excluded.original_price,
         discount_percent = excluded.discount_percent, expires_at = excluded.expires_at
  returning id into listing;
  return listing;
end $$;

create or replace function public.admin_cancel_listing(p_listing bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  update marketplace_listings set listing_status = 'CANCELLED' where id = p_listing and listing_status = 'ACTIVE';
  update products set is_listed = false where id = (select product_id from marketplace_listings where id = p_listing);
end $$;

grant execute on function public.deal_history() to authenticated;
grant execute on function public.admin_list_batch(bigint, int) to authenticated;
grant execute on function public.admin_cancel_listing(bigint) to authenticated;
-- Run once in the Supabase SQL editor, after 009.
-- The latest DHT22 reading is paired with every listing: the backend writes these columns on each batch,
-- so the web and mobile apps can show temperature, humidity, VPD and heat units next to the batch.
alter table public.products add column if not exists latest_temp_c numeric(5,2);
alter table public.products add column if not exists latest_humidity_rh numeric(5,2);
alter table public.products add column if not exists latest_vpd_kpa numeric(6,3);
alter table public.products add column if not exists chu_accumulated numeric(12,3) default 0;
alter table public.products add column if not exists sensor_updated_at timestamptz;
