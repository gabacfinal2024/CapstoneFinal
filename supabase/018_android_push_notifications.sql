begin;

alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in ('STATUS_CHANGE', 'IOT_ALERT', 'ORDER_UPDATE', 'NEW_MESSAGE', 'MARKETPLACE',
                        'PRICE_DROP', 'AT_RISK_BATCH', 'AT_RISK_LISTING')
);

create table if not exists public.android_push_devices (
  installation_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique
);
create index if not exists android_push_devices_user_idx on public.android_push_devices(user_id);
alter table public.android_push_devices enable row level security;
revoke all on public.android_push_devices from anon, authenticated;

create table if not exists public.android_push_deliveries (
  id bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications(id) on delete cascade,
  installation_id uuid not null references public.android_push_devices(installation_id) on delete cascade,
  available_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  attempts integer not null default 0
);
create index if not exists android_push_deliveries_due_idx on public.android_push_deliveries(available_at);
create index if not exists android_push_deliveries_installation_idx on public.android_push_deliveries(installation_id);
create index if not exists android_push_deliveries_notification_idx on public.android_push_deliveries(notification_id);
alter table public.android_push_deliveries enable row level security;
revoke all on public.android_push_deliveries from anon, authenticated;

create or replace function public.register_android_push(p_installation_id uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
                 and role in ('STALL_OPERATOR', 'RESCUE_BUYER'))
     or p_installation_id is null or p_token is null or length(p_token) not between 20 and 4096 then
    raise exception 'Invalid push registration';
  end if;

  delete from public.android_push_devices where token = p_token and installation_id <> p_installation_id;
  insert into public.android_push_devices (installation_id, user_id, token)
  values (p_installation_id, auth.uid(), p_token)
  on conflict (installation_id) do update set user_id = excluded.user_id, token = excluded.token;
end;
$$;

create or replace function public.unregister_android_push(p_installation_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.android_push_devices where installation_id = p_installation_id and user_id = auth.uid();
$$;

revoke execute on function public.register_android_push(uuid, text), public.unregister_android_push(uuid)
from public, anon;
grant execute on function public.register_android_push(uuid, text), public.unregister_android_push(uuid)
to authenticated;

create or replace function public.queue_android_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.android_push_deliveries (notification_id, installation_id)
  select new.id, d.installation_id
  from public.android_push_devices d join public.profiles p on p.id = d.user_id
  where d.user_id = new.user_id
    and (p.role = 'STALL_OPERATOR' or (p.role = 'RESCUE_BUYER' and new.notification_type = 'AT_RISK_LISTING'));
  return new;
end;
$$;

drop trigger if exists trg_queue_android_push on public.notifications;
create trigger trg_queue_android_push after insert on public.notifications
for each row execute function public.queue_android_push();

create or replace function public.claim_android_push()
returns table (delivery_id bigint, attempt integer, installation_id uuid, token text, user_id uuid,
               notification_id bigint, notification_type text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.android_push_deliveries q where q.expires_at <= now();
  return query
  with due as (
    select q.id
    from public.android_push_deliveries q
    join public.notifications n on n.id = q.notification_id
    join public.android_push_devices d on d.installation_id = q.installation_id and d.user_id = n.user_id
    join public.profiles p on p.id = n.user_id
    where q.available_at <= now() and not coalesce(n.is_read, false)
      and (p.role = 'STALL_OPERATOR' or (p.role = 'RESCUE_BUYER' and n.notification_type = 'AT_RISK_LISTING'))
      and (n.notification_type <> 'AT_RISK_LISTING' or exists (
        select 1 from public.marketplace_listings l join public.products b on b.id = l.product_id
        where l.product_id = n.product_id and l.listing_status = 'ACTIVE'
          and l.expires_at > now() and b.freshness_status = 'AMBER' and b.quantity_kg > 0
      ))
    order by q.available_at, q.id
    limit 8 for update of q skip locked
  ), claimed as (
    update public.android_push_deliveries q
      set available_at = now() + interval '2 minutes', attempts = q.attempts + 1
      from due where q.id = due.id
      returning q.*
  )
  select c.id, c.attempts, d.installation_id, d.token, n.user_id, n.id, n.notification_type
    from claimed c join public.notifications n on n.id = c.notification_id
    join public.android_push_devices d on d.installation_id = c.installation_id and d.user_id = n.user_id;
end;
$$;

create or replace function public.finish_android_push(
  p_delivery_id bigint, p_attempt integer, p_token text, p_remove_token boolean
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_remove_token then
    delete from public.android_push_devices d using public.android_push_deliveries q
    where q.id = p_delivery_id and q.attempts = p_attempt
      and d.installation_id = q.installation_id and d.token = p_token;
  end if;
  delete from public.android_push_deliveries where id = p_delivery_id and attempts = p_attempt;
end;
$$;

revoke execute on function public.claim_android_push(), public.finish_android_push(bigint, integer, text, boolean)
from public, anon, authenticated;
grant execute on function public.claim_android_push(), public.finish_android_push(bigint, integer, text, boolean)
to service_role;

create or replace function public.notify_at_risk_listing(p_product_id bigint, p_operator_id uuid, p_crop_type text)
returns void language sql security invoker set search_path = '' as $$
  insert into public.notifications (user_id, product_id, notification_type, title, message)
  select id, p_product_id, 'AT_RISK_LISTING', 'At-risk listing available',
         initcap(lower(p_crop_type)) || ' is at risk and available in the Rescue Marketplace.'
  from public.profiles where role = 'RESCUE_BUYER' and id <> p_operator_id;
$$;
revoke execute on function public.notify_at_risk_listing(bigint, uuid, text) from public, anon, authenticated;

create or replace function public.notify_at_risk_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.freshness_status is distinct from 'AMBER' then return new; end if;
  if tg_op = 'UPDATE' and old.freshness_status = 'AMBER' then return new; end if;

  insert into public.notifications (user_id, product_id, notification_type, title, message)
  values (new.operator_id, new.id, 'AT_RISK_BATCH', 'Batch is at risk',
          'Your ' || lower(new.crop_type) || ' batch #' || new.id || ' is at risk.'
          || case when new.predicted_shelf_life is not null
                  then ' Estimated days remaining: ' || new.predicted_shelf_life || '.' else '' end);

  if new.quantity_kg > 0 and exists (
    select 1 from public.marketplace_listings
    where product_id = new.id and listing_status = 'ACTIVE' and expires_at > now()
  ) then
    perform public.notify_at_risk_listing(new.id, new.operator_id, new.crop_type);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_at_risk_batch on public.products;
create trigger trg_notify_at_risk_batch after insert or update of freshness_status on public.products
for each row execute function public.notify_at_risk_batch();

-- Preserve new-listing notifications, using the at-risk notification when applicable.
create or replace function public.notify_new_listing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p record;
  vendor text;
  note text;
begin
  if new.listing_status is distinct from 'ACTIVE' or new.expires_at <= now() then return new; end if;
  if tg_op = 'UPDATE' and old.listing_status = 'ACTIVE' and old.expires_at > now() then return new; end if;

  select crop_type, quantity_kg, current_price_per_kg, freshness_status
    into p from public.products where id = new.product_id;
  if p.freshness_status = 'AMBER' and p.quantity_kg > 0 then
    perform public.notify_at_risk_listing(new.product_id, new.operator_id, p.crop_type);
    return new;
  end if;

  select coalesce(nullif(full_name, ''), 'A stall operator') into vendor
    from public.profiles where id = new.operator_id;
  note := initcap(lower(coalesce(p.crop_type, 'Produce'))) || ' · ' || coalesce(p.quantity_kg::text, '?') || ' kg · '
          || '₱' || to_char(coalesce(p.current_price_per_kg, 0), 'FM999990.00') || '/kg'
          || case when coalesce(new.discount_percent, 0) > 0 then ' (' || round(new.discount_percent)::text || '% off)' else '' end
          || ' from ' || vendor;
  insert into public.notifications (user_id, product_id, notification_type, title, message)
  select id, new.product_id, 'MARKETPLACE', 'New batch listed', note
  from public.profiles where role = 'RESCUE_BUYER' and id <> new.operator_id;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_listing on public.marketplace_listings;
create trigger trg_notify_new_listing after insert or update of listing_status, expires_at on public.marketplace_listings
for each row execute function public.notify_new_listing();

commit;
