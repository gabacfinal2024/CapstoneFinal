begin;

alter table public.products add column if not exists source_scan_id bigint;
create unique index if not exists products_source_scan_uidx
  on public.products (source_scan_id) where source_scan_id is not null;

create or replace function public.clear_rotten_product_sensor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.freshness_status = 'RED' then
    new.iot_node_id := null;
    new.is_listed := false;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_rotten_product_sensor on public.products;
create trigger clear_rotten_product_sensor
before insert or update of freshness_status, iot_node_id, is_listed on public.products
for each row execute function public.clear_rotten_product_sensor();

update public.products set iot_node_id = null, is_listed = false
where freshness_status = 'RED' and (iot_node_id is not null or is_listed);

create or replace function public.cancel_rotten_product_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketplace_listings set listing_status = 'CANCELLED'
  where product_id = new.id and listing_status = 'ACTIVE';
  return new;
end;
$$;

drop trigger if exists cancel_rotten_product_listing on public.products;
create trigger cancel_rotten_product_listing
after update of freshness_status on public.products
for each row when (new.freshness_status = 'RED')
execute function public.cancel_rotten_product_listing();

update public.marketplace_listings as listing set listing_status = 'CANCELLED'
from public.products as product
where listing.product_id = product.id and listing.listing_status = 'ACTIVE' and product.freshness_status = 'RED';

create table if not exists public.analysis_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  agreed_at timestamptz not null default now()
);
alter table public.analysis_consents enable row level security;
revoke all on public.analysis_consents from anon, authenticated;

create or replace function public.record_signup_analysis_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data->>'analysis_consent_version' = '1' then
    insert into public.analysis_consents (user_id, terms_version, agreed_at)
    values (new.id, '1', new.created_at)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists record_signup_analysis_consent on auth.users;
create trigger record_signup_analysis_consent
after insert on auth.users
for each row execute function public.record_signup_analysis_consent();

commit;
