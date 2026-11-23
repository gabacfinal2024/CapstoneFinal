begin;

alter table public.products add column if not exists scan_listing_deadline timestamptz;

create or replace function public.guard_product_scan_listing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.scan_listing_deadline is not null and current_user not in ('service_role', 'postgres') then
      raise exception 'The scan deadline must be verified by the AgriResQ hub.';
    end if;
  else
    if new.source_scan_id is distinct from old.source_scan_id
        or (old.source_scan_id is not null and new.operator_id is distinct from old.operator_id) then
      raise exception 'The source scan and its operator cannot be changed.';
    end if;
    if new.scan_listing_deadline is distinct from old.scan_listing_deadline
        and current_user not in ('service_role', 'postgres') then
      raise exception 'The scan deadline must be verified by the AgriResQ hub.';
    end if;
    if new.is_listed is not distinct from old.is_listed then
      return new;
    end if;
  end if;

  if new.is_listed and not exists (
    select 1 from public.marketplace_listings
    where product_id = new.id and operator_id = new.operator_id
      and listing_status = 'ACTIVE' and expires_at > clock_timestamp()
  ) then
    raise exception 'An active marketplace listing is required before marking this batch as listed.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_product_scan_listing on public.products;
create trigger guard_product_scan_listing
before insert or update of source_scan_id, operator_id, scan_listing_deadline, is_listed on public.products
for each row execute function public.guard_product_scan_listing();

create or replace function public.guard_marketplace_scan_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline timestamptz;
  checked_at timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    if new.product_id is distinct from old.product_id or new.operator_id is distinct from old.operator_id then
      raise exception 'The batch and operator of a marketplace listing cannot be changed.';
    end if;
    if old.listing_status = 'ACTIVE' and old.expires_at > checked_at then
      return new;
    end if;
  end if;
  if new.listing_status <> 'ACTIVE' then
    return new;
  end if;

  -- A BEFORE INSERT also runs for an upsert of an existing listing.
  if tg_op = 'INSERT' and exists (
    select 1 from public.marketplace_listings
    where product_id = new.product_id and operator_id = new.operator_id
      and listing_status = 'ACTIVE' and expires_at > checked_at
  ) then
    return new;
  end if;

  select scan_listing_deadline into deadline from public.products
  where id = new.product_id and operator_id = new.operator_id and source_scan_id is not null;
  if deadline is null then
    raise exception 'A verified source scan is required to list this batch.';
  end if;
  if clock_timestamp() >= deadline then
    raise exception 'This scan has expired. Run a new scan to publish a listing.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_marketplace_scan_listing on public.marketplace_listings;
create trigger guard_marketplace_scan_listing
before insert or update on public.marketplace_listings
for each row execute function public.guard_marketplace_scan_listing();

-- Keep the admin RPC atomic and set the batch flag after the guarded listing write.
create or replace function public.admin_list_batch(p_product bigint, p_days int default 3)
returns bigint language plpgsql security definer set search_path = public as $$
declare pr products; listing bigint;
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  select * into pr from products where id = p_product;
  if not found then raise exception 'Batch not found.'; end if;
  if pr.freshness_status = 'RED' then raise exception 'A rotten batch cannot be listed.'; end if;

  insert into marketplace_listings (product_id, operator_id, listed_price, original_price, discount_percent, listing_status, expires_at)
  values (p_product, pr.operator_id,
          round(coalesce(pr.current_price_per_kg, 0) * pr.quantity_kg, 2),
          round(coalesce(pr.base_price_per_kg, 0) * pr.quantity_kg, 2),
          coalesce(pr.discount_percent, 0), 'ACTIVE', now() + make_interval(days => greatest(p_days, 1)))
  on conflict (product_id) do update
     set listing_status = 'ACTIVE', listed_price = excluded.listed_price, original_price = excluded.original_price,
         discount_percent = excluded.discount_percent, expires_at = excluded.expires_at
  returning id into listing;
  update products set is_listed = true where id = p_product;
  return listing;
end $$;

grant execute on function public.admin_list_batch(bigint, int) to authenticated;

commit;
