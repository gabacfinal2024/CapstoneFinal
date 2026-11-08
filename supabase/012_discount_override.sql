-- Run once in the Supabase SQL editor. Existing rows keep their current automatic pricing.
alter table public.products
  add column if not exists discount_override_percent numeric(5,2);

alter table public.products
  drop constraint if exists products_discount_override_percent_check;

alter table public.products
  add constraint products_discount_override_percent_check
  check (discount_override_percent is null or discount_override_percent between 0 and 100);
