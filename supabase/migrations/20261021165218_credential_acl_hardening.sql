-- Forward-only hardening of a service-only credential table. No credential rows change.
-- Table revokes alone leave legacy column ACLs intact; remove both surfaces.
ALTER TABLE public.zatca_csids ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.zatca_csids FROM PUBLIC, anon, authenticated;
DO $credential_acl$
DECLARE c record; p record; r text; operation text;
BEGIN
  FOR c IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.zatca_csids'::regclass AND attnum>0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.zatca_csids FROM PUBLIC, anon, authenticated',c.attname);
  END LOOP;
  -- Keep a policy only if its entire audience is the existing backend role.
  FOR p IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='zatca_csids'
      AND roles IS DISTINCT FROM ARRAY['service_role']::name[]
  LOOP
    EXECUTE format('DROP POLICY %I ON public.zatca_csids',p.policyname);
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      IF has_table_privilege(r,'public.zatca_csids',operation)
        OR has_any_column_privilege(r,'public.zatca_csids',operation) THEN
        RAISE EXCEPTION 'Credential ACL hardening failed: client privilege remains';
      END IF;
    END LOOP;
    FOREACH operation IN ARRAY ARRAY['DELETE','TRUNCATE','TRIGGER'] LOOP
      IF has_table_privilege(r,'public.zatca_csids',operation) THEN
        RAISE EXCEPTION 'Credential ACL hardening failed: client table privilege remains';
      END IF;
    END LOOP;
  END LOOP;
END;
$credential_acl$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zatca_csids TO service_role;
