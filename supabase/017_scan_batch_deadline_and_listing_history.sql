begin;

create or replace function public.require_open_scan_for_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An older device-side integration can still write its own unsourced records.
  if new.source_scan_id is null and current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if new.source_scan_id is null or new.scan_listing_deadline is null then
    raise exception 'Update AgriResQ and run a verified scan before adding a batch.';
  end if;
  if clock_timestamp() >= new.scan_listing_deadline then
    raise exception 'This scan has expired. Run a new scan to add a batch.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_open_scan_for_batch on public.products;
create trigger require_open_scan_for_batch before insert on public.products
for each row execute function public.require_open_scan_for_batch();

create table if not exists public.batch_listing_history (
  product_id bigint primary key,
  source_scan_id bigint,
  listing_status text not null check (listing_status in ('ACTIVE', 'EXPIRED', 'CANCELLED', 'SOLD', 'REMOVED')),
  expires_at timestamptz
);

create index if not exists batch_listing_history_scan_idx
  on public.batch_listing_history (source_scan_id) where source_scan_id is not null;

alter table public.batch_listing_history enable row level security;
revoke all on public.batch_listing_history from anon, authenticated;
grant select on public.batch_listing_history to service_role;

create or replace function public.record_batch_listing_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.batch_listing_history
    set listing_status = case when old.listing_status = 'SOLD' then 'SOLD' else 'REMOVED' end
    where product_id = old.product_id;
    return old;
  end if;

  insert into public.batch_listing_history (product_id, source_scan_id, listing_status, expires_at)
  select new.product_id, p.source_scan_id, new.listing_status, new.expires_at
  from public.products p where p.id = new.product_id and new.listing_status is not null
  on conflict (product_id) do update
  set listing_status = excluded.listing_status, expires_at = excluded.expires_at;
  return new;
end;
$$;

drop trigger if exists record_batch_listing_history on public.marketplace_listings;
create trigger record_batch_listing_history
after insert or update of listing_status, expires_at or delete on public.marketplace_listings
for each row execute function public.record_batch_listing_history();

insert into public.batch_listing_history (product_id, source_scan_id, listing_status, expires_at)
select l.product_id, p.source_scan_id, l.listing_status, l.expires_at
from public.marketplace_listings l join public.products p on p.id = l.product_id
where l.listing_status is not null
on conflict (product_id) do nothing;

commit;
