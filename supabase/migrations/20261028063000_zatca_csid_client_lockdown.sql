-- Forward-only port of the PR #68 staging repair (superseded draft). Idempotent:
-- adds platform_admins.note if missing and removes any client access to ZATCA
-- credentials. No row updates, deletes, seeds or credential reads.

-- CREATE TABLE IF NOT EXISTS in 20260905091941 cannot add this column to
-- staging's older platform_admins table. Preserve all existing rows.
ALTER TABLE public.platform_admins ADD COLUMN IF NOT EXISTS note text;

-- Historical staging migration 20260903164208 contradicted the service-role
-- credential-store design documented in 055/056. Deny direct client access,
-- even if an unexpected permissive policy or column grant remains.
DROP POLICY IF EXISTS zatca_csids_tenant_isolation ON public.zatca_csids;
REVOKE ALL ON TABLE public.zatca_csids FROM PUBLIC, anon, authenticated;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.zatca_csids'::regclass AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.zatca_csids FROM PUBLIC, anon, authenticated',c.attname);
  END LOOP;
END $$;
ALTER TABLE public.zatca_csids ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zatca_csids TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.platform_admins'::regclass
    AND attname='note' AND atttypid='text'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Staging reconciliation: platform_admins.note must be text';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.zatca_csids'::regclass)
    OR has_table_privilege('anon','public.zatca_csids','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated','public.zatca_csids','SELECT,INSERT,UPDATE,DELETE')
    OR has_any_column_privilege('anon','public.zatca_csids','SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('authenticated','public.zatca_csids','SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Staging reconciliation: ZATCA credentials remain client-accessible';
  END IF;
  IF NOT has_table_privilege('service_role','public.zatca_csids','SELECT')
    OR NOT has_table_privilege('service_role','public.zatca_csids','INSERT')
    OR NOT has_table_privilege('service_role','public.zatca_csids','UPDATE')
    OR NOT has_table_privilege('service_role','public.zatca_csids','DELETE') THEN
    RAISE EXCEPTION 'Staging reconciliation: service credential management unavailable';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
