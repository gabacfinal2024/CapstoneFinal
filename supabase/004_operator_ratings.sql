-- Buyers rate the stall operator after a completed deal. Run once in the Supabase SQL editor.
create table if not exists public.ratings (
  id bigserial primary key,
  thread_id bigint not null unique references public.chat_threads(id) on delete cascade,
  operator_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists ratings_operator_idx on public.ratings (operator_id);

alter table public.ratings enable row level security;

drop policy if exists "ratings are public" on public.ratings;
create policy "ratings are public" on public.ratings for select using (true);

-- only the buyer of a completed chat can rate, and only once (unique thread_id)
drop policy if exists "buyer rates a completed deal" on public.ratings;
create policy "buyer rates a completed deal" on public.ratings for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and t.buyer_id = auth.uid() and t.operator_id = ratings.operator_id
        and t.transaction_completed = true
    )
  );
