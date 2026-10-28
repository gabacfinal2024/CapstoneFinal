-- Run once in the Supabase SQL editor, after 009. Safe to run again.
--
-- Raw sensor readings (temperature, humidity, VPD, heat units) are private to the batch's stall operator and the
-- administrator. Buyers only see the calculated days to spoil and the camera's freshness confidence.

-- 1) The stall's latest DHT22 reading, paired with every listing by the backend (service key).
create table if not exists public.product_climate (
  product_id bigint primary key references public.products(id) on delete cascade,
  latest_temp_c numeric(5,2),
  latest_humidity_rh numeric(5,2),
  latest_vpd_kpa numeric(6,3),
  chu_accumulated numeric(12,3) default 0,
  sensor_updated_at timestamptz
);
alter table public.product_climate enable row level security;
drop policy if exists product_climate_read on public.product_climate;
create policy product_climate_read on public.product_climate for select using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.operator_id = auth.uid()));

-- 2) Remove the columns an earlier version added to the buyer-readable products table.
alter table public.products drop column if exists latest_temp_c;
alter table public.products drop column if exists latest_humidity_rh;
alter table public.products drop column if exists latest_vpd_kpa;
alter table public.products drop column if exists chu_accumulated;
alter table public.products drop column if exists sensor_updated_at;

-- 3) Sensor history and the heat/VPD figures in prediction history were readable by everyone: owner and admin only.
drop policy if exists sensor_read on public.sensor_logs;
drop policy if exists sensor_owner_read on public.sensor_logs;
create policy sensor_owner_read on public.sensor_logs for select using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.operator_id = auth.uid()));

drop policy if exists predictions_read on public.spoilage_predictions;
drop policy if exists predictions_owner_read on public.spoilage_predictions;
create policy predictions_owner_read on public.spoilage_predictions for select using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.operator_id = auth.uid()));
