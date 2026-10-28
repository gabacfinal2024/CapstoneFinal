-- Keep profile role and registration details consistent with auth metadata.
-- Run once on projects that have already applied 001_agriresq_schema.sql.

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

-- Repair profiles created by the old stall registration flow when auth metadata
-- still records the intended role.
UPDATE public.profiles AS profile
SET
  role = CASE
    WHEN auth_user.raw_user_meta_data->>'role' = 'WHOLESALER' THEN 'STALL_OPERATOR'
    ELSE auth_user.raw_user_meta_data->>'role'
  END,
  stall_number = COALESCE(NULLIF(auth_user.raw_user_meta_data->>'stall_number', ''), profile.stall_number)
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND auth_user.raw_user_meta_data->>'role' IN ('STALL_OPERATOR', 'RESCUE_BUYER', 'WHOLESALER')
  AND profile.role IS DISTINCT FROM CASE
    WHEN auth_user.raw_user_meta_data->>'role' = 'WHOLESALER' THEN 'STALL_OPERATOR'
    ELSE auth_user.raw_user_meta_data->>'role'
  END;
