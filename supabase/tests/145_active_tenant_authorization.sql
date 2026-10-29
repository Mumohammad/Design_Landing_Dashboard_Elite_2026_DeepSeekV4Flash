-- Synthetic tenant lifecycle regression. No historical business data is rewritten.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES
 ('14500000-0000-4000-8000-000000000001','owner145@example.test','{"_invite_provisioned":true}',now()),
 ('14500000-0000-4000-8000-000000000002','foreign145@example.test','{"_invite_provisioned":true}',now()),
 ('14500000-0000-4000-8000-000000000003','normal145@example.test','{"_invite_provisioned":true}',now()),
 ('14500000-0000-4000-8000-000000000004','custom145@example.test','{"_invite_provisioned":true}',now()),
 ('14500000-0000-4000-8000-000000000005','denied145@example.test','{"_invite_provisioned":true}',now());
CREATE TEMP TABLE tenant145_tenants(kind text PRIMARY KEY,id uuid);
INSERT INTO tenant145_tenants VALUES
 ('own',(public.provision_company_atomic('14500000-0000-4000-8000-000000000001','{"name":"Tenant state fixture","slug":"tenant-state145","domain":"tenant145.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('14500000-0000-4000-8000-000000000002','{"name":"Foreign tenant state fixture","slug":"foreign-state145","domain":"foreign145.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('14500000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000002');
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
 ('14500000-0000-4000-8000-000000000103','14500000-0000-4000-8000-000000000003',(SELECT id FROM tenant145_tenants WHERE kind='own'),'normal145@example.test','supervisor','active',false),
 ('14500000-0000-4000-8000-000000000104','14500000-0000-4000-8000-000000000004',(SELECT id FROM tenant145_tenants WHERE kind='own'),'custom145@example.test','readonly_auditor','active',false),
 ('14500000-0000-4000-8000-000000000105','14500000-0000-4000-8000-000000000005',(SELECT id FROM tenant145_tenants WHERE kind='own'),'denied145@example.test','operations_officer','active',false);
-- Use actual configured presets and permission rows, never mocked SQL helpers.
DELETE FROM public.role_permissions WHERE role_id IN(SELECT id FROM public.roles WHERE tenant_id=(SELECT id FROM tenant145_tenants WHERE kind='own') AND name IN('supervisor','readonly_auditor','operations_officer'));
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE r.tenant_id=(SELECT id FROM tenant145_tenants WHERE kind='own') AND r.name IN('supervisor','readonly_auditor')
 AND p.module='drivers' AND p.action IN('read','update');
CREATE TEMP TABLE tenant145_principals(kind text PRIMARY KEY,auth_id uuid,role_id uuid);
INSERT INTO tenant145_principals
 SELECT CASE name WHEN 'general_manager' THEN 'GM' WHEN 'supervisor' THEN 'normal' ELSE 'custom' END,
 CASE name WHEN 'general_manager' THEN '14500000-0000-4000-8000-000000000001'::uuid WHEN 'supervisor' THEN '14500000-0000-4000-8000-000000000003'::uuid ELSE '14500000-0000-4000-8000-000000000004'::uuid END,id
 FROM public.roles WHERE tenant_id=(SELECT id FROM tenant145_tenants WHERE kind='own') AND name IN('general_manager','supervisor','readonly_auditor');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date) VALUES
 ('14500000-0000-4000-8000-000000000011',(SELECT id FROM tenant145_tenants WHERE kind='own'),'Synthetic driver145','0501450001','freelancer','active','2020-01-01'),
 ('14500000-0000-4000-8000-000000000012',(SELECT id FROM tenant145_tenants WHERE kind='foreign'),'Foreign synthetic driver145','0501450002','freelancer','active','2020-01-01');
INSERT INTO storage.buckets(id,name,public) VALUES('driver-documents','driver-documents',false) ON CONFLICT(id) DO NOTHING;
GRANT SELECT ON tenant145_tenants,tenant145_principals TO authenticated,anon,service_role;
SELECT is((SELECT count(*)::integer FROM pg_proc WHERE oid IN('public.get_my_tenant_id()'::regprocedure,'public.user_has_permission(text,text)'::regprocedure,'public.storage_path_in_current_tenant(text)'::regprocedure,'public.is_callers_role(uuid)'::regprocedure) AND prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig)),4,'all shared boundaries preserve stable definer execution and pinned search_path');
SELECT ok(NOT has_table_privilege('authenticated','public.drivers','UPDATE'),'tenant hardening never restores direct business DML');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf','14500000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000001','{"size":100,"mimetype":"application/pdf"}')$$,'active authorized tenant can upload through the real Storage policy');
RESET ROLE;
CREATE TEMP TABLE tenant145_original_drivers AS SELECT id,to_jsonb(d) AS body FROM public.drivers d WHERE tenant_id IN(SELECT id FROM tenant145_tenants);
CREATE TEMP TABLE tenant145_original_objects AS SELECT id,to_jsonb(o) AS body FROM storage.objects o WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf';
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'active GM resolves only the caller tenant');
SELECT ok(public.user_has_permission('drivers','update'),'active GM retains configured permission');
SELECT ok(public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'active GM retains own Storage path access');
SELECT ok(public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'active GM can resolve own configured role');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),1::bigint,'active GM retains real own-tenant read');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000012'),0::bigint,'active GM cannot read foreign tenant driver');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'active GM retains the caller-bound business workflow');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'active normal resolves only the caller tenant');
SELECT ok(public.user_has_permission('drivers','update'),'active normal retains configured permission');
SELECT ok(public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'active normal retains own Storage path access');
SELECT ok(public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='normal')),'active normal can resolve own configured role');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),1::bigint,'active normal retains real own-tenant read');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000012'),0::bigint,'active normal cannot read foreign tenant driver');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'active normal retains the caller-bound business workflow');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'active custom resolves only the caller tenant');
SELECT ok(public.user_has_permission('drivers','update'),'active custom retains configured permission');
SELECT ok(public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'active custom retains own Storage path access');
SELECT ok(public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='custom')),'active custom can resolve own configured role');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),1::bigint,'active custom retains real own-tenant read');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000012'),0::bigint,'active custom cannot read foreign tenant driver');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'active custom retains the caller-bound business workflow');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT ok(NOT public.user_has_permission('roles','manage'),'custom preset grant cannot escalate into role management');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000005","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'active no-permission profile still resolves only own tenant');
SELECT ok(NOT public.user_has_permission('drivers','update'),'configured role without a grant is still denied');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'no-permission profile cannot read business rows');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','no-permission profile cannot mutate evidence');

RESET ROLE;
UPDATE public.tenants SET status='suspended',deleted_at=NULL WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'suspended tenant denies existing AAL2 GM tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'suspended tenant denies existing AAL2 GM permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'suspended tenant denies GM Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'suspended tenant denies GM caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'suspended tenant hides business rows from GM through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'suspended tenant hides stored objects from GM through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','suspended tenant denies GM evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','suspended tenant denies GM profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/suspended-GM.pdf','14500000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000001','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'suspended tenant denies GM Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'suspended tenant denies existing AAL2 normal tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'suspended tenant denies existing AAL2 normal permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'suspended tenant denies normal Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='normal')),'suspended tenant denies normal caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'suspended tenant hides business rows from normal through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'suspended tenant hides stored objects from normal through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','suspended tenant denies normal evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','suspended tenant denies normal profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/suspended-normal.pdf','14500000-0000-4000-8000-000000000003','14500000-0000-4000-8000-000000000003','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'suspended tenant denies normal Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'suspended tenant denies existing AAL2 custom tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'suspended tenant denies existing AAL2 custom permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'suspended tenant denies custom Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='custom')),'suspended tenant denies custom caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'suspended tenant hides business rows from custom through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'suspended tenant hides stored objects from custom through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','suspended tenant denies custom evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','suspended tenant denies custom profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/suspended-custom.pdf','14500000-0000-4000-8000-000000000004','14500000-0000-4000-8000-000000000004','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'suspended tenant denies custom Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.users WHERE auth_user_id='14500000-0000-4000-8000-000000000001'),1::bigint,'suspended tenant keeps only self-profile identity available for routing');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=NULL WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'restoring suspended tenant restores caller tenant resolution');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'restoring suspended tenant restores authorized business workflow');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),1::bigint,'restoring suspended tenant restores authorized Storage reads');

RESET ROLE;
UPDATE public.tenants SET status='terminated',deleted_at=NULL WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'terminated tenant denies existing AAL2 GM tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'terminated tenant denies existing AAL2 GM permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'terminated tenant denies GM Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'terminated tenant denies GM caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'terminated tenant hides business rows from GM through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'terminated tenant hides stored objects from GM through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','terminated tenant denies GM evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','terminated tenant denies GM profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/terminated-GM.pdf','14500000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000001','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'terminated tenant denies GM Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'terminated tenant denies existing AAL2 normal tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'terminated tenant denies existing AAL2 normal permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'terminated tenant denies normal Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='normal')),'terminated tenant denies normal caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'terminated tenant hides business rows from normal through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'terminated tenant hides stored objects from normal through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','terminated tenant denies normal evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','terminated tenant denies normal profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/terminated-normal.pdf','14500000-0000-4000-8000-000000000003','14500000-0000-4000-8000-000000000003','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'terminated tenant denies normal Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'terminated tenant denies existing AAL2 custom tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'terminated tenant denies existing AAL2 custom permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'terminated tenant denies custom Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='custom')),'terminated tenant denies custom caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'terminated tenant hides business rows from custom through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'terminated tenant hides stored objects from custom through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','terminated tenant denies custom evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','terminated tenant denies custom profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/terminated-custom.pdf','14500000-0000-4000-8000-000000000004','14500000-0000-4000-8000-000000000004','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'terminated tenant denies custom Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.users WHERE auth_user_id='14500000-0000-4000-8000-000000000001'),1::bigint,'terminated tenant keeps only self-profile identity available for routing');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=NULL WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'restoring terminated tenant restores caller tenant resolution');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'restoring terminated tenant restores authorized business workflow');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),1::bigint,'restoring terminated tenant restores authorized Storage reads');

RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=now() WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'deleted tenant denies existing AAL2 GM tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'deleted tenant denies existing AAL2 GM permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'deleted tenant denies GM Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'deleted tenant denies GM caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'deleted tenant hides business rows from GM through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'deleted tenant hides stored objects from GM through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','deleted tenant denies GM evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','deleted tenant denies GM profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/deleted-GM.pdf','14500000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000001','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'deleted tenant denies GM Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'deleted tenant denies existing AAL2 normal tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'deleted tenant denies existing AAL2 normal permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'deleted tenant denies normal Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='normal')),'deleted tenant denies normal caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'deleted tenant hides business rows from normal through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'deleted tenant hides stored objects from normal through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','deleted tenant denies normal evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','deleted tenant denies normal profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/deleted-normal.pdf','14500000-0000-4000-8000-000000000003','14500000-0000-4000-8000-000000000003','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'deleted tenant denies normal Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'deleted tenant denies existing AAL2 custom tenant resolution');
SELECT ok(NOT public.user_has_permission('drivers','update'),'deleted tenant denies existing AAL2 custom permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'deleted tenant denies custom Storage path helper');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='custom')),'deleted tenant denies custom caller-role helper');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'deleted tenant hides business rows from custom through real RLS');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),0::bigint,'deleted tenant hides stored objects from custom through real RLS');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','deleted tenant denies custom evidence mutations');
SELECT throws_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',1)$$,'P0001','AUTH007: driver permission required','deleted tenant denies custom profile mutations');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES('driver-documents',(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/deleted-custom.pdf','14500000-0000-4000-8000-000000000004','14500000-0000-4000-8000-000000000004','{"size":100,"mimetype":"application/pdf"}')$$,'42501',NULL,'deleted tenant denies custom Storage uploads');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.users WHERE auth_user_id='14500000-0000-4000-8000-000000000001'),1::bigint,'deleted tenant keeps only self-profile identity available for routing');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=NULL WHERE id=(SELECT id FROM tenant145_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'restoring deleted tenant restores caller tenant resolution');
SELECT lives_ok($$SELECT public.mutate_driver_profile('update','{}','14500000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'))$$,'restoring deleted tenant restores authorized business workflow');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name=(SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),1::bigint,'restoring deleted tenant restores authorized Storage reads');

-- MFA routing retains a self profile without business access at insufficient AAL.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT is((SELECT count(*) FROM public.users WHERE auth_user_id='14500000-0000-4000-8000-000000000001'),1::bigint,'AAL1 privileged caller retains self-profile for enrollment/challenge');
SELECT ok(NOT public.has_required_assurance(),'AAL1 privileged caller still requires MFA');
SELECT is(public.get_my_tenant_id(),NULL::uuid,'AAL1 privileged caller cannot resolve a business tenant');
SELECT ok(NOT public.user_has_permission('drivers','read'),'AAL1 GM bypass cannot grant business permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'AAL1 privileged caller cannot access tenant Storage');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'AAL1 privileged caller cannot use caller-role grants');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'AAL1 privileged caller gets no business rows');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14500000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','AAL1 privileged caller cannot mutate evidence');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT ok(public.has_required_assurance(),'non-privileged caller without a verified factor retains existing assurance policy');
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='own'),'tenant hardening does not impose new MFA enrollment requirements on ordinary users');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14500000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),(SELECT id FROM tenant145_tenants WHERE kind='foreign'),'foreign active caller resolves only foreign tenant');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'foreign active caller cannot address own-tenant Storage');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'foreign GM cannot resolve another tenant role');
SELECT is((SELECT count(*) FROM public.drivers WHERE id='14500000-0000-4000-8000-000000000011'),0::bigint,'foreign GM cannot read another tenant business rows');
SELECT set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'missing caller identity resolves no tenant');
SELECT ok(NOT public.user_has_permission('drivers','read'),'missing caller identity has no permission');
SELECT ok(NOT public.storage_path_in_current_tenant((SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/proof.pdf'),'missing caller identity has no Storage path');
SELECT ok(NOT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM')),'missing caller identity has no caller role');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_my_tenant_id()$$,'42501',NULL,'anonymous role cannot execute tenant boundary');
SELECT throws_ok($$SELECT public.user_has_permission('drivers','read')$$,'42501',NULL,'anonymous role cannot execute permission boundary');
SELECT throws_ok($$SELECT public.storage_path_in_current_tenant('x/file')$$,'42501',NULL,'anonymous role cannot execute Storage boundary');
SELECT throws_ok($$SELECT public.is_callers_role((SELECT role_id FROM tenant145_principals WHERE kind='GM'))$$,'42501',NULL,'anonymous role cannot execute caller-role boundary');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.get_my_tenant_id(),NULL::uuid,'service role without caller does not acquire a tenant');
SELECT ok(NOT public.user_has_permission('drivers','update'),'service role without caller does not acquire business permission');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM tenant145_original_drivers snapshot JOIN public.drivers d USING(id) WHERE snapshot.body IS DISTINCT FROM to_jsonb(d)),'denial and restoration never rewrite preexisting business rows');
SELECT ok(NOT EXISTS(SELECT 1 FROM tenant145_original_objects snapshot JOIN storage.objects o USING(id) WHERE snapshot.body IS DISTINCT FROM to_jsonb(o)),'denial and restoration preserve stored object metadata');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name LIKE (SELECT id FROM tenant145_tenants WHERE kind='own')::text||'/14500000-0000-4000-8000-000000000011/%'),1::bigint,'rejected tenant uploads leave no partial objects');
SELECT * FROM finish();
ROLLBACK;
