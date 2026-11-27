BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('15800000-0000-4000-8000-000000000001','branding-boundary-owner@example.test','{"_invite_provisioned":true}'),
 ('15800000-0000-4000-8000-000000000002','branding-boundary-delegate@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE logo_boundary_tenant AS SELECT (public.provision_company_atomic('15800000-0000-4000-8000-000000000001','{"name":"Branding boundary","slug":"branding158","domain":"branding158.example.test"}')->>'id')::uuid AS id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='15800000-0000-4000-8000-000000000001';
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '15800000-0000-4000-8000-000000000002',id,'branding-boundary-delegate@example.test','readonly_auditor','active',false FROM logo_boundary_tenant;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.tenant_id=(SELECT id FROM logo_boundary_tenant) AND r.name='readonly_auditor' AND p.module='settings' AND p.action='manage' ON CONFLICT DO NOTHING;
CREATE TEMP TABLE logo_boundary_objects(label text PRIMARY KEY,path text,owner_id text,metadata jsonb);
INSERT INTO logo_boundary_objects SELECT label,id||'/logos/15800000-0000-4000-8000-000000000001/15800000-0000-4000-8000-000000000101/logo-'||hash||'.png',owner_id,metadata FROM logo_boundary_tenant CROSS JOIN (VALUES
 ('valid','0000000000000001','15800000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}'::jsonb),
 ('wrong-owner','0000000000000002','15800000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}'::jsonb),
 ('wrong-type','0000000000000003','15800000-0000-4000-8000-000000000001','{"mimetype":"image/svg+xml","size":100}'::jsonb),
 ('zero','0000000000000004','15800000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":0}'::jsonb),
 ('oversize','0000000000000005','15800000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":524289}'::jsonb),
 ('bad-size','0000000000000006','15800000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":"NaN"}'::jsonb),
 ('missing-type','0000000000000007','15800000-0000-4000-8000-000000000001','{"size":100}'::jsonb)
)v(label,hash,owner_id,metadata);
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) SELECT 'company-assets',path,owner_id,metadata FROM logo_boundary_objects;
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) SELECT 'company-assets',id||'/ordinary/banner.png','15800000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}' FROM logo_boundary_tenant;
CREATE TEMP TABLE logo_boundary_initial AS SELECT configuration_version FROM public.tenants WHERE id=(SELECT id FROM logo_boundary_tenant);
GRANT SELECT ON logo_boundary_tenant,logo_boundary_objects,logo_boundary_initial TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok(format($q$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000101',(SELECT configuration_version FROM logo_boundary_initial),%L)$q$,path),'P0001','SETTINGS_INVALID','RPC rejects '||label) FROM logo_boundary_objects WHERE label<>'valid';
SELECT throws_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000102',(SELECT configuration_version FROM logo_boundary_initial),(SELECT path FROM logo_boundary_objects WHERE label='valid'))$$,'P0001','SETTINGS_INVALID','object request folder must match RPC request');
SELECT throws_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000101',(SELECT configuration_version FROM logo_boundary_initial),(SELECT replace(path,'0000000000000001','0000000000000099') FROM logo_boundary_objects WHERE label='valid'))$$,'P0001','SETTINGS_INVALID','missing object rejected');
WITH changed AS(UPDATE storage.objects SET metadata='{"mimetype":"image/png","size":200}' WHERE bucket_id='company-assets' AND name=(SELECT path FROM logo_boundary_objects WHERE label='valid') RETURNING id) SELECT is(count(*)::integer,0,'reserved staged/committed PNG cannot be overwritten') FROM changed;
SELECT throws_ok($$DELETE FROM storage.objects WHERE bucket_id='company-assets' AND name=(SELECT path FROM logo_boundary_objects WHERE label='valid')$$,'42501','Direct deletion from storage tables is not allowed. Use the Storage API instead.','platform metadata deletion guard remains active');
-- Replicate the Storage API's transaction-local mode to exercise the caller's
-- DELETE policy underneath the platform metadata guard. This test rolls back.
SET LOCAL storage.allow_delete_query='true';
WITH changed AS(DELETE FROM storage.objects WHERE bucket_id='company-assets' AND name=(SELECT path FROM logo_boundary_objects WHERE label='valid') RETURNING id) SELECT is(count(*)::integer,0,'reserved PNG cannot be deleted') FROM changed;
SET LOCAL storage.allow_delete_query='false';
WITH changed AS(UPDATE storage.objects SET metadata='{"mimetype":"image/png","size":200}' WHERE bucket_id='company-assets' AND name=(SELECT id||'/ordinary/banner.png' FROM logo_boundary_tenant) RETURNING id) SELECT is(count(*)::integer,1,'other company-assets update flow remains available') FROM changed;
SELECT throws_like($$UPDATE storage.objects SET name=(SELECT path||'new' FROM logo_boundary_objects WHERE label='valid') WHERE bucket_id='company-assets' AND name=(SELECT id||'/ordinary/banner.png' FROM logo_boundary_tenant)$$,'%row-level security%','ordinary asset cannot be renamed into immutable namespace');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_logo_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='settings_logo_updated' THEN RAISE EXCEPTION 'BRANDING_AUDIT_TEST'; END IF; RETURN NEW; END $$;
CREATE TRIGGER branding_audit_test BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_logo_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000101',(SELECT configuration_version FROM logo_boundary_initial),(SELECT path FROM logo_boundary_objects WHERE label='valid'))$$,'P0001','BRANDING_AUDIT_TEST','audit failure rolls logo mutation back');
SELECT is((public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT configuration_version FROM logo_boundary_initial),'audit rollback retains shared version');
SELECT is(public.read_my_settings_bundle('company')->>'logo_storage_path',NULL::text,'audit rollback retains original reference');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM tenant_branding_private.logo_receipts WHERE tenant_id=(SELECT id FROM logo_boundary_tenant)),0,'failed audit cannot leave successful receipt');
DROP TRIGGER branding_audit_test ON public.audit_log;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000101',(SELECT configuration_version FROM logo_boundary_initial),(SELECT path FROM logo_boundary_objects WHERE label='valid'))$$,'same request can commit after definite rollback');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15800000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_settings_bundle('company')$$,'42501','SETTINGS_FORBIDDEN','manage-only delegate cannot read the settings bundle');
SELECT lives_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000201',(SELECT configuration_version+1 FROM logo_boundary_initial),NULL)$$,'dynamic delegated settings manager can clear with the reviewed owner version');
RESET ROLE;
DELETE FROM public.role_permissions WHERE role_id IN(SELECT id FROM public.roles WHERE tenant_id=(SELECT id FROM logo_boundary_tenant) AND name='readonly_auditor') AND permission_id IN(SELECT id FROM public.permissions WHERE module='settings' AND action='manage');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_my_company_logo('15800000-0000-4000-8000-000000000201',(SELECT configuration_version+1 FROM logo_boundary_initial),NULL)$$,'42501','SETTINGS_FORBIDDEN','revoked manager cannot replay prior success');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='storage_company_assets_update' AND qual LIKE '%logos%' AND with_check LIKE '%logos%'),'existing permissive update USING and CHECK both reserve logos');
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='storage_company_assets_delete' AND qual LIKE '%logos%'),'existing permissive delete policy reserves logos');
SELECT * FROM finish();
ROLLBACK;
