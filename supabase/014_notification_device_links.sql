-- Older deployments already have notifications but may be missing the sensor link.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS device_id bigint;
