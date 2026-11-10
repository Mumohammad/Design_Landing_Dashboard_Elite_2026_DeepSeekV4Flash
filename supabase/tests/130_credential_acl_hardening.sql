BEGIN;
SELECT plan(18);
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.zatca_csids'::regclass),'credential RLS stays enabled');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='zatca_csids' AND roles IS DISTINCT FROM ARRAY['service_role']::name[]),0::bigint,'no client or PUBLIC credential policy');
SELECT ok(NOT has_table_privilege(r,'public.zatca_csids',op),'no credential table '||op||' for '||r)
 FROM unnest(ARRAY['anon','authenticated'])r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE'])op;
SELECT ok(NOT has_any_column_privilege(r,'public.zatca_csids',op),'no credential column '||op||' for '||r)
 FROM unnest(ARRAY['anon','authenticated'])r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES'])op;
-- Service-role access and anonymous/authenticated denial behavior are also
-- exercised by the full RPC/RLS suite. The legacy-ACL replay harness injects
-- old PUBLIC/column grants, applies this migration twice and rolls back.
SELECT * FROM finish();
ROLLBACK;
