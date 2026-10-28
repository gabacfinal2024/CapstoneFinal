-- Notifications that reach the OTHER person. Run once in the Supabase SQL editor.
--
-- Why this is needed: the notifications table only lets a user write rows for themselves (RLS), so the
-- app could never notify a buyer about a new batch or the other side of a chat about a new message.
-- These SECURITY DEFINER triggers do it on the database side, for every client.

-- 1) A new batch goes on the marketplace -> every rescue buyer is notified
create or replace function public.notify_new_listing() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
  vendor text;
  note text;
begin
  if new.listing_status <> 'ACTIVE' then return new; end if;
  if tg_op = 'UPDATE' and old.listing_status = 'ACTIVE' then return new; end if;   -- only the moment it becomes active

  select crop_type, quantity_kg, current_price_per_kg into p from products where id = new.product_id;
  select coalesce(nullif(full_name, ''), 'A stall operator') into vendor from profiles where id = new.operator_id;

  note := initcap(lower(coalesce(p.crop_type, 'Produce'))) || ' · ' || coalesce(p.quantity_kg::text, '?') || ' kg · '
          || '₱' || to_char(coalesce(p.current_price_per_kg, 0), 'FM999990.00') || '/kg'
          || case when coalesce(new.discount_percent, 0) > 0 then ' (' || round(new.discount_percent)::text || '% off)' else '' end
          || ' from ' || vendor;

  insert into notifications (user_id, product_id, notification_type, title, message)
  select id, new.product_id, 'MARKETPLACE', 'New batch listed', note
  from profiles
  where role = 'RESCUE_BUYER' and id <> new.operator_id;
  return new;
end $$;

drop trigger if exists trg_notify_new_listing on public.marketplace_listings;
create trigger trg_notify_new_listing after insert or update of listing_status on public.marketplace_listings
  for each row execute function public.notify_new_listing();

-- 2) A chat message -> the other person in the chat is notified
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record;
  recipient uuid;
  sender text;
begin
  select operator_id, buyer_id into t from chat_threads where id = new.thread_id;
  if not found then return new; end if;
  recipient := case when new.sender_id = t.operator_id then t.buyer_id else t.operator_id end;
  if recipient is null or recipient = new.sender_id then return new; end if;
  select coalesce(nullif(full_name, ''), 'Someone') into sender from profiles where id = new.sender_id;
  insert into notifications (user_id, notification_type, title, message)
  values (recipient, 'NEW_MESSAGE', 'New message from ' || sender, left(new.message_text, 120));
  return new;
end $$;

drop trigger if exists trg_notify_new_message on public.chat_messages;
create trigger trg_notify_new_message after insert on public.chat_messages
  for each row execute function public.notify_new_message();

-- 3) Realtime: let the apps hear about new notifications / messages / listings the moment they happen
do $$
declare t text;
begin
  foreach t in array array['notifications', 'chat_messages', 'marketplace_listings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
