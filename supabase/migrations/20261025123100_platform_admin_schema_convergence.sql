-- Converge the reconstructed platform administrator provenance column.
-- Production already has this nullable column; earlier staging tables may not.
-- No platform administrators or existing record values are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.platform_admins ADD COLUMN IF NOT EXISTS note text;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_admins' AND column_name='note' AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
  RAISE EXCEPTION 'PLATFORM_ADMIN_SCHEMA_MISMATCH';
 END IF;
END $$;
COMMENT ON COLUMN public.platform_admins.note IS 'Optional internal platform administrator provenance.';
COMMIT;
