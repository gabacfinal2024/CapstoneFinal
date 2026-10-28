-- create_chat_thread_and_policies.sql
-- Run this in the Supabase SQL editor (or psql) to add a secure RPC and RLS policies

BEGIN;

-- 1) Create RPC function to securely create or return a chat thread
CREATE OR REPLACE FUNCTION public.create_chat_thread(listing_id uuid)
RETURNS TABLE(
  id uuid,
  listing_id uuid,
  operator_id uuid,
  buyer_id uuid,
  is_archived boolean,
  transaction_completed boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  buyer uuid := auth.uid();
  op uuid;
BEGIN
  IF buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- enforce buyer role
  IF (SELECT role FROM public.profiles WHERE id = buyer) <> 'RESCUE_BUYER' THEN
    RAISE EXCEPTION 'only buyers may start chats';
  END IF;

  SELECT operator_id INTO op FROM public.marketplace_listings WHERE id = listing_id;
  IF op IS NULL THEN
    RAISE EXCEPTION 'listing not found';
  END IF;

  RETURN QUERY
  INSERT INTO public.chat_threads (listing_id, operator_id, buyer_id, is_archived, transaction_completed, created_at, updated_at)
  VALUES (listing_id, op, buyer, false, false, now(), now())
  ON CONFLICT (listing_id, buyer_id) DO UPDATE
    SET updated_at = now()
  RETURNING id, listing_id, operator_id, buyer_id, is_archived, transaction_completed, created_at, updated_at;
END;
$$;

-- 2) Enable RLS on chat_threads (if not already enabled)
ALTER TABLE IF EXISTS public.chat_threads ENABLE ROW LEVEL SECURITY;

-- Allow selecting threads only for participants
CREATE POLICY IF NOT EXISTS select_threads_for_participants ON public.chat_threads
  FOR SELECT
  USING (operator_id = auth.uid() OR buyer_id = auth.uid());

-- Allow buyers to insert threads where they are the buyer
CREATE POLICY IF NOT EXISTS insert_threads_by_buyer ON public.chat_threads
  FOR INSERT
  WITH CHECK (buyer_id = auth.uid() AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'RESCUE_BUYER');

-- Allow updates by participants (archive/complete)
CREATE POLICY IF NOT EXISTS update_threads_for_participants ON public.chat_threads
  FOR UPDATE
  USING (operator_id = auth.uid() OR buyer_id = auth.uid());

-- 3) Enable RLS on chat_messages and policies
ALTER TABLE IF EXISTS public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow selecting messages only to thread participants
CREATE POLICY IF NOT EXISTS select_messages_for_participants ON public.chat_messages
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chat_threads t WHERE t.id = public.chat_messages.thread_id AND (t.operator_id = auth.uid() OR t.buyer_id = auth.uid())
  ));

-- Allow inserting messages only when sender is auth.uid() and is participant of thread
CREATE POLICY IF NOT EXISTS insert_messages_for_participants ON public.chat_messages
  FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.chat_threads t WHERE t.id = public.chat_messages.thread_id AND (t.operator_id = auth.uid() OR t.buyer_id = auth.uid())
  ));

COMMIT;

-- Notes:
-- 1) Run this in Supabase SQL editor (Project -> SQL) as a user with SQL privileges.
-- 2) The function uses SECURITY DEFINER to run using the function owner's permissions; set the function owner to a role that has rights to insert into chat_threads if necessary.
-- 3) After applying, the client will call the RPC `create_chat_thread(listing_id)` which will enforce authentication and role checks server-side.
-- 4) Keep client-side role checks for UX, but DB policies are the true security boundary.
