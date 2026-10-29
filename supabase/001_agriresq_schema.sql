-- AgriResQ Supabase Schema — run in Supabase SQL Editor
-- Project: https://yyrmuaocpnrlkeedwpzx.supabase.co

-- Profiles (extends Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone_number TEXT,
  role TEXT NOT NULL CHECK (role IN ('STALL_OPERATOR', 'RESCUE_BUYER', 'ADMIN')),
  stall_number TEXT,
  market_location TEXT DEFAULT 'Bulua WBIT Terminal',
  buyer_type TEXT CHECK (buyer_type IN ('RETAILER', 'PROCESSOR', 'CONSUMER')),
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IoT sensor nodes
CREATE TABLE IF NOT EXISTS iot_nodes (
  id BIGSERIAL PRIMARY KEY,
  operator_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_token TEXT UNIQUE NOT NULL,
  stall_location TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  battery_level INTEGER DEFAULT 100,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products / crop batches
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  iot_node_id BIGINT REFERENCES iot_nodes(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL CHECK (crop_type IN ('EGGPLANT', 'CUCUMBER', 'CARROT')),
  quantity_kg NUMERIC(8,2) NOT NULL,
  base_price_per_kg NUMERIC(10,2) DEFAULT 0,
  current_price_per_kg NUMERIC(10,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  auto_discount_enabled BOOLEAN DEFAULT TRUE,
  freshness_status TEXT DEFAULT 'GREEN' CHECK (freshness_status IN ('GREEN', 'AMBER', 'RED')),
  freshness_percent INTEGER DEFAULT 100,
  predicted_shelf_life NUMERIC(5,2) DEFAULT 5.0,
  ml_confidence NUMERIC(5,2),
  harvest_datetime TIMESTAMPTZ,
  image_url TEXT,
  notes TEXT,
  pickup_location TEXT DEFAULT 'Bulua West Terminal',
  is_listed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spoilage predictions (history)
CREATE TABLE IF NOT EXISTS spoilage_predictions (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  predicted_status TEXT NOT NULL CHECK (predicted_status IN ('GREEN', 'AMBER', 'RED')),
  days_to_spoil NUMERIC(5,2) NOT NULL,
  freshness_percent INTEGER,
  chu_accumulated NUMERIC(8,2) DEFAULT 0,
  vpd_value NUMERIC(6,4),
  source TEXT DEFAULT 'RULE_ENGINE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sensor telemetry
CREATE TABLE IF NOT EXISTS sensor_logs (
  id BIGSERIAL PRIMARY KEY,
  iot_node_id BIGINT REFERENCES iot_nodes(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  temperature_c NUMERIC(5,2) NOT NULL,
  humidity_rh NUMERIC(5,2) NOT NULL,
  ethylene_ppm NUMERIC(6,3),
  vpd_value NUMERIC(6,4),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace listings
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listed_price NUMERIC(12,2) NOT NULL,
  original_price NUMERIC(12,2),
  discount_percent NUMERIC(5,2) DEFAULT 0,
  listing_status TEXT DEFAULT 'ACTIVE' CHECK (listing_status IN ('ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'STATUS_CHANGE', 'IOT_ALERT', 'ORDER_UPDATE', 'NEW_MESSAGE', 'MARKETPLACE', 'PRICE_DROP'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat threads (inbox vs archived)
CREATE TABLE IF NOT EXISTS chat_threads (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  transaction_completed BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id, buyer_id)
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES chat_threads(id) ON DELETE CASCADE;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  requested_role TEXT;
BEGIN
  requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'RESCUE_BUYER');
  IF requested_role NOT IN ('STALL_OPERATOR', 'RESCUE_BUYER') THEN
    RAISE EXCEPTION 'Unsupported account role: %', requested_role;
  END IF;
  IF requested_role = 'STALL_OPERATOR'
    AND NULLIF(NEW.raw_user_meta_data->>'stall_number', '') IS NULL THEN
    RAISE EXCEPTION 'A stall number is required for stall operators';
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, phone_number, role, stall_number, buyer_type, market_location
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone_number', ''),
    requested_role,
    CASE WHEN requested_role = 'STALL_OPERATOR'
      THEN NULLIF(NEW.raw_user_meta_data->>'stall_number', '') END,
    CASE WHEN requested_role = 'RESCUE_BUYER'
      THEN COALESCE(NULLIF(NEW.raw_user_meta_data->>'buyer_type', ''), 'RETAILER') END,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'market_location', ''), 'Bulua WBIT Terminal')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS chat_threads_updated_at ON chat_threads;
CREATE TRIGGER chat_threads_updated_at BEFORE UPDATE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE spoilage_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE iot_nodes ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update own
CREATE POLICY profiles_select ON profiles FOR SELECT USING (true);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (auth.uid() = id);

-- Products: operators manage own; buyers read listed
CREATE POLICY products_operator_all ON products FOR ALL USING (auth.uid() = operator_id);
CREATE POLICY products_buyer_read ON products FOR SELECT USING (is_listed = true AND freshness_status != 'RED');

-- Marketplace: public read active listings
CREATE POLICY listings_read ON marketplace_listings FOR SELECT USING (listing_status = 'ACTIVE');
CREATE POLICY listings_operator ON marketplace_listings FOR ALL USING (auth.uid() = operator_id);

-- Notifications: own only
CREATE POLICY notif_own ON notifications FOR ALL USING (auth.uid() = user_id);

-- Chat: participants only
CREATE POLICY chat_thread_participant ON chat_threads FOR ALL
  USING (auth.uid() = operator_id OR auth.uid() = buyer_id);
CREATE POLICY chat_msg_participant ON chat_messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM chat_threads t WHERE t.id = thread_id
    AND (t.operator_id = auth.uid() OR t.buyer_id = auth.uid())
  ));

-- Predictions & sensors: read if product accessible
CREATE POLICY predictions_read ON spoilage_predictions FOR SELECT USING (true);
CREATE POLICY sensor_read ON sensor_logs FOR SELECT USING (true);

-- IoT nodes: operator owns
CREATE POLICY iot_operator ON iot_nodes FOR ALL USING (auth.uid() = operator_id);

-- Enable Realtime (run separately if needed)
-- ALTER PUBLICATION supabase_realtime ADD TABLE products, notifications, chat_messages;
