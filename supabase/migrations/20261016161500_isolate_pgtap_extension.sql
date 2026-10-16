-- Operational prerequisite when a hosted database has pgTAP in public:
-- apply this migration before retrying rbac_completion. Fresh databases need no change.
-- Moving the extension preserves its objects and dependencies; no DROP or data writes.
DO $migration$
DECLARE extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pgtap';
  IF extension_schema='public' THEN
    ALTER EXTENSION pgtap SET SCHEMA extensions;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgtap' AND n.nspname='public'
  ) THEN
    RAISE EXCEPTION 'pgTAP must not remain in the exposed public schema';
  END IF;
END $migration$;
