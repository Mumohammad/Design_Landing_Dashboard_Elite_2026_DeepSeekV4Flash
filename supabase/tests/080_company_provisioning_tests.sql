BEGIN;
SELECT plan(7);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('80000000-0000-4000-8000-000000000001','company-success@example.test','{"_invite_provisioned":true}'),
 ('80000000-0000-4000-8000-000000000002','company-fault@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE company_result AS SELECT public.provision_company_atomic(
 '80000000-0000-4000-8000-000000000001','{"name":"Company Fixture","domain":"company-fixture.example.test","slug":"company-fixture"}') AS result;
SELECT is((SELECT count(*)::integer FROM public.roles WHERE tenant_id=(SELECT (result->>'id')::uuid FROM company_result)),9,'new company gets nine roles');
SELECT ok((SELECT count(*) FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id WHERE r.tenant_id=(SELECT (result->>'id')::uuid FROM company_result)) > 100,'new roles have permission grants');
SELECT is((SELECT count(*)::integer FROM public.system_settings WHERE tenant_id=(SELECT (result->>'id')::uuid FROM company_result)),24,'new company gets settings');
SELECT is((SELECT count(*)::integer FROM public.tenant_memberships WHERE tenant_id=(SELECT (result->>'id')::uuid FROM company_result)),1,'owner membership exists');
CREATE FUNCTION pg_temp.fail_company_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'membership fault'; END; $$;
CREATE TRIGGER trg_test_company_membership BEFORE INSERT ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_company_membership();
SELECT throws_ok($$SELECT public.provision_company_atomic('80000000-0000-4000-8000-000000000002','{"name":"Fault Fixture","domain":"fault-fixture.example.test","slug":"fault-fixture"}')$$,'P0001','membership fault','membership failure aborts the full transaction');
SELECT is((SELECT count(*)::integer FROM public.tenants WHERE domain='fault-fixture.example.test'),0,'failed provisioning leaves no tenant');
SELECT is((SELECT count(*)::integer FROM public.users WHERE auth_user_id='80000000-0000-4000-8000-000000000002'),0,'failed provisioning leaves no profile');
SELECT * FROM finish();
ROLLBACK;
