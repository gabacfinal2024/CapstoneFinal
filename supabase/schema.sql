-- AgriResQ Supabase RLS policies (run after Django migrations create tables)
-- Django manages schema; this file adds Row Level Security for direct Supabase client access.

-- Enable RLS on key tables (table names match Django default naming)
ALTER TABLE IF EXISTS api_cropbatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_marketplacelisting ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_pushnotification ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_chatmessage ENABLE ROW LEVEL SECURITY;

-- Wholesalers see only their batches
CREATE POLICY wholesaler_own_batches ON api_cropbatch
  FOR ALL USING (
    wholesaler_id IN (
      SELECT id FROM api_wholesalerprofile WHERE user_id = auth.uid()::text::integer
    )
  );

-- Buyers see listed marketplace items
CREATE POLICY buyer_view_listings ON api_marketplacelisting
  FOR SELECT USING (listing_status = 'ACTIVE');

-- Users see only their notifications
CREATE POLICY user_own_notifications ON api_pushnotification
  FOR ALL USING (user_id = auth.uid()::text::integer);
