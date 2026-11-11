-- Run once in the Supabase SQL editor, after 012_discount_override.sql.
-- An active, unexpired listing is the source of truth for buyer visibility.

update public.products p
set is_listed = true
where p.is_listed is distinct from true
  and p.freshness_status <> 'RED'
  and exists (
    select 1
    from public.marketplace_listings l
    where l.product_id = p.id
      and l.listing_status = 'ACTIVE'
      and l.expires_at > now()
  );

drop policy if exists products_buyer_read on public.products;
create policy products_buyer_read on public.products
for select using (
  freshness_status <> 'RED'
  and (
    is_listed = true
    or exists (
      select 1
      from public.marketplace_listings l
      where l.product_id = products.id
        and l.listing_status = 'ACTIVE'
        and l.expires_at > now()
    )
  )
);
