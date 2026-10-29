BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES
('13800000-0000-4000-8000-000000000001','management-owner@example.test','{"_invite_provisioned":true}',now()),
('13800000-0000-4000-8000-000000000002','management-foreign@example.test','{"_invite_provisioned":true}',now()),
('13800000-0000-4000-8000-000000000003','management-member@example.test','{"_invite_provisioned":true}',now()),
('13800000-0000-4000-8000-000000000004','management-admin@example.test','{"_invite_provisioned":true}',now());
CREATE TEMP TABLE management_tenants(kind text PRIMARY KEY,id uuid);
INSERT INTO management_tenants VALUES
('own',(public.provision_company_atomic('13800000-0000-4000-8000-000000000001','{"name":"Management fixture own","domain":"management-own.example.test","slug":"management-fixture-own"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('13800000-0000-4000-8000-000000000002','{"name":"Management fixture foreign","domain":"management-foreign.example.test","slug":"management-fixture-foreign"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN ('13800000-0000-4000-8000-000000000001','13800000-0000-4000-8000-000000000002');
INSERT INTO public.users(id,tenant_id,auth_user_id,email,full_name_en,role,status,must_change_password) SELECT
'13800000-0000-4000-8000-000000000013',id,'13800000-0000-4000-8000-000000000003','management-member@example.test','Management member','accountant','active',false FROM management_tenants WHERE kind='own';
INSERT INTO public.users(id,tenant_id,auth_user_id,email,full_name_en,role,status,must_change_password) SELECT
'13800000-0000-4000-8000-000000000014',id,'13800000-0000-4000-8000-000000000004','management-admin@example.test','Management admin','admin','active',false FROM management_tenants WHERE kind='own';
INSERT INTO public.tenant_memberships(tenant_id,user_id) SELECT id,'13800000-0000-4000-8000-000000000013' FROM management_tenants WHERE kind='own';
INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id) SELECT t.id,'13800000-0000-4000-8000-000000000013',r.id FROM management_tenants t JOIN public.roles r ON r.tenant_id=t.id AND r.name='accountant' WHERE t.kind='own';
CREATE TEMP TABLE management_results(kind text PRIMARY KEY,result jsonb);
INSERT INTO management_results VALUES ('member','{"id":"13800000-0000-4000-8000-000000000013","version":1}');
-- Remove only an unassigned synthetic tenant preset so creation is exercised.
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN management_tenants t ON t.id=r.tenant_id WHERE t.kind='own' AND r.name='platform_coordinator');
DELETE FROM public.roles WHERE tenant_id=(SELECT id FROM management_tenants WHERE kind='own') AND name='platform_coordinator';
GRANT ALL ON management_tenants,management_results TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((public.list_managed_users('users')->>'total')::int,3,'roster counts all own tenant accounts');
SELECT is((public.list_managed_users('users','Management member')->>'total')::int,1,'server search finds matching user');
SELECT is(jsonb_array_length(public.list_managed_users('users','', 'all','all',1,2)->'users'),2,'roster page size honored');
SELECT is(jsonb_array_length(public.list_managed_users('users','', 'all','all',2,2)->'users'),1,'second roster page available');
SELECT ok(NOT((public.list_managed_users('security')->'users'->0)?'two_factor_secret') AND NOT((public.list_managed_users('security')->'users'->0)?'locked_until'),'security rows exclude credentials and lock internals');
SELECT throws_ok($$SELECT public.mutate_managed_user('profile','13800000-0000-4000-8000-000000000013',999,'{"full_name_en":"Stale"}')$$,'P0001','USR003: record changed; reload before saving','stale user profile edit denied');
UPDATE management_results SET result=public.mutate_managed_user('profile',(result->>'id')::uuid,(result->>'version')::bigint,'{"full_name_en":"Edited member","phone":"0500000000","employee_code":"STAFF-138"}') WHERE kind='member';
SELECT is((SELECT full_name_en FROM public.users WHERE id='13800000-0000-4000-8000-000000000013'),'Edited member','profile edit persisted');
SELECT is((SELECT employee_code FROM public.users WHERE id='13800000-0000-4000-8000-000000000013'),'STAFF-138','employee code edit persisted');
SELECT throws_ok($$SELECT public.mutate_managed_user('profile',(SELECT id FROM public.users WHERE auth_user_id='13800000-0000-4000-8000-000000000004'),1,'{"employee_code":"STAFF-138"}')$$,'P0001','USR008: employee code is already assigned','duplicate employee code denied');
SELECT throws_ok($$SELECT public.mutate_managed_user('status',(SELECT id FROM public.users WHERE auth_user_id='13800000-0000-4000-8000-000000000001'),(SELECT version FROM public.users WHERE auth_user_id='13800000-0000-4000-8000-000000000001'),'{"status":"inactive","reason":"Do not remove final owner"}')$$,'P0001','USR005: you cannot change your own role, account status or archive your account','self/last owner cannot deactivate');
SELECT throws_ok($$SELECT public.mutate_managed_user('role','13800000-0000-4000-8000-000000000013',(result->>'version')::bigint,'{"role":"general_manager","reason":"No owner promotion"}') FROM management_results WHERE kind='member'$$,'P0001','USR014: select a different supported non-owner role','existing user cannot be promoted to GM');
UPDATE management_results SET result=public.mutate_managed_user('role',(result->>'id')::uuid,(result->>'version')::bigint,'{"role":"supervisor","reason":"Changed responsibility"}') WHERE kind='member';
SELECT is((SELECT role::text FROM public.users WHERE id='13800000-0000-4000-8000-000000000013'),'supervisor','owner changes supported user role');
SELECT is((SELECT count(*)::int FROM public.user_role_assignments WHERE user_id='13800000-0000-4000-8000-000000000013' AND revoked_at IS NULL AND deleted_at IS NULL),1,'one active assignment retained');
SELECT is((SELECT count(*)::int FROM public.user_role_assignments WHERE user_id='13800000-0000-4000-8000-000000000013' AND revoked_at IS NOT NULL),1,'old assignment preserved as revoked history');
SELECT throws_ok($$SELECT public.mutate_managed_user('archive',(result->>'id')::uuid,(result->>'version')::bigint,'{"reason":"Do not archive active user"}') FROM management_results WHERE kind='member'$$,'P0001','USR016: deactivate the account before archiving it','active user must deactivate first');
INSERT INTO management_results SELECT 'role',public.mutate_managed_role('save',jsonb_build_object('name','platform_coordinator','name_ar','منسق اختبار','name_en','Fixture coordinator','permission_ids',jsonb_build_array((SELECT id FROM public.permissions WHERE module='vehicles' AND action='read'))));
SELECT is((SELECT name_en FROM public.roles WHERE id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='role')),'Fixture coordinator','missing supported preset created');
SELECT throws_ok($$SELECT public.mutate_managed_role('save','{"name":"platform_coordinator","name_ar":"قديم","name_en":"Stale","permission_ids":[]}',(result->>'id')::uuid,999) FROM management_results WHERE kind='role'$$,'P0001','USR003: record changed; reload before saving','stale role grant edit denied');
UPDATE management_results SET result=public.mutate_managed_role('save','{"name":"platform_coordinator","name_ar":"معدل","name_en":"Edited coordinator","permission_ids":[]}',(result->>'id')::uuid,(result->>'version')::bigint) WHERE kind='role';
SELECT is((SELECT count(*)::int FROM public.role_permissions WHERE role_id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='role')),0,'owner grant removal persisted');
UPDATE management_results SET result=public.mutate_managed_role('archive','{"reason":"Unused custom preset"}',(result->>'id')::uuid,(result->>'version')::bigint) WHERE kind='role';
UPDATE management_results SET result=public.mutate_managed_role('restore','{}',(result->>'id')::uuid,(result->>'version')::bigint) WHERE kind='role';
SELECT ok((SELECT deleted_at IS NULL FROM public.roles WHERE id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='role')),'archived non-system preset restored');
SELECT throws_ok($$SELECT public.mutate_managed_role('archive','{"reason":"Cannot archive system preset"}',id,version) FROM public.roles WHERE tenant_id=(SELECT id FROM management_tenants WHERE kind='own') AND name='accountant'$$,'P0001','USR025: system or already archived roles cannot be archived','system preset cannot archive');
SELECT throws_ok($$SELECT public.mutate_managed_role('save','{"name":"general_manager","name_ar":"ممنوع","name_en":"Forbidden","permission_ids":[]}',id,version) FROM public.roles WHERE tenant_id=(SELECT id FROM management_tenants WHERE kind='own') AND name='general_manager'$$,'P0001','USR020: the general manager system role and its access are immutable','owner role and bypass cannot change');
SELECT throws_ok($$UPDATE public.users SET role='general_manager' WHERE id='13800000-0000-4000-8000-000000000013'$$,'42501',NULL,'direct user role bypass denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.mutate_managed_role('save','{"name":"platform_coordinator","name_ar":"ممنوع","name_en":"Forbidden","permission_ids":[]}',(result->>'id')::uuid,(result->>'version')::bigint) FROM management_results WHERE kind='role'$$,'P0001','USR017: only the general manager can configure role permissions','delegated admin cannot change role grants');
SELECT throws_ok($$SELECT public.mutate_managed_user('role',(result->>'id')::uuid,(result->>'version')::bigint,'{"role":"admin","reason":"Self escalation forbidden"}') FROM management_results WHERE kind='member'$$,'P0001','USR004: only the general manager can change roles or archive users','admin cannot reassign another role');
SELECT throws_ok($$SELECT public.issue_managed_invite('invalid@example.test','accountant',gen_random_uuid(),crypt('fixture',gen_salt('bf')),now()+interval '1 day')$$,'P0001','USR029: only the general manager can issue team invitations','delegated users.manage cannot issue invitations');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.mutate_managed_user('profile',(result->>'id')::uuid,(result->>'version')::bigint,'{"full_name_en":"Foreign mutation"}') FROM management_results WHERE kind='member'$$,'P0001','USR002: user not found in this organization','foreign tenant cannot mutate user');
SELECT throws_ok($$SELECT public.mutate_managed_role('restore','{}',(result->>'id')::uuid,(result->>'version')::bigint) FROM management_results WHERE kind='role'$$,'P0001','USR019: role not found in this organization','foreign tenant cannot restore role');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.list_managed_users('users')$$,'P0001','AUTH007: user read permission required','owner missing MFA cannot read protected roster');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.issue_managed_invite('management-invitee@example.test','general_manager',gen_random_uuid(),crypt('fixture',gen_salt('bf')),now()+interval '1 day')$$,'P0001','USR030: select an active supported non-owner tenant role','GM invitations rejected even for owner');
INSERT INTO management_results VALUES ('invite',public.issue_managed_invite('management-invitee@example.test','accountant','13800000-0000-4000-8000-000000000099',crypt('fixture',gen_salt('bf')),now()+interval '1 day'));
SELECT throws_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005','Invitee fixture') FROM management_results WHERE kind='invite'$$,'42501',NULL,'authenticated API cannot invoke trusted acceptance RPC');
SELECT throws_ok($$SELECT public.reserve_managed_invite_identity((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005') FROM management_results WHERE kind='invite'$$,'42501',NULL,'authenticated caller cannot reserve an Auth identity');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.reserve_managed_invite_identity((result->>'id')::uuid,'13800000-0000-4000-8000-000000000001') FROM management_results WHERE kind='invite'$$,'P0001','USR036: provisioning identity is already in use','a pending invitation cannot adopt a preexisting arbitrary Auth UUID');
SELECT is((public.reserve_managed_invite_identity((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005')->>'auth_user_id'),'13800000-0000-4000-8000-000000000005','old pending invitation lazily binds one durable Auth UUID') FROM management_results WHERE kind='invite';
SELECT is((public.reserve_managed_invite_identity((result->>'id')::uuid,'13800000-0000-4000-8000-000000000095')->>'auth_user_id'),'13800000-0000-4000-8000-000000000005','retry or concurrent candidate cannot replace the bound UUID') FROM management_results WHERE kind='invite';
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data)
SELECT '13800000-0000-4000-8000-000000000005','management-invitee@example.test',now(),jsonb_build_object('_invite_provisioned',true,'_invite_id',result->>'id','_invite_tenant_id',t.id::text) FROM management_results r CROSS JOIN management_tenants t WHERE r.kind='invite' AND t.kind='own';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000003','Wrong bound identity') FROM management_results WHERE kind='invite'$$,'P0001','USR034: invalid or expired invitation','wrong Auth UUID cannot consume a bound invitation');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{_invite_tenant_id}','"foreign-tenant"') WHERE id='13800000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005','Wrong metadata') FROM management_results WHERE kind='invite'$$,'P0001','USR034: invalid or expired invitation','server-controlled tenant metadata must match bound invitation');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{_invite_tenant_id}',to_jsonb((SELECT id::text FROM management_tenants WHERE kind='own'))) WHERE id='13800000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005','Invitee fixture') FROM management_results WHERE kind='invite'$$,'valid configured invitation provisions atomically');
SELECT lives_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005','Invitee fixture') FROM management_results WHERE kind='invite'$$,'exact trusted provisioning retry returns committed result without duplication');
SELECT throws_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000003','Different invitee') FROM management_results WHERE kind='invite'$$,'P0001','USR034: invalid or expired invitation','consumed invitation cannot provision a different account');
RESET ROLE;
UPDATE public.invites SET provisioning_auth_user_id=NULL WHERE id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='invite');
UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data-'_invite_id'-'_invite_tenant_id' WHERE id='13800000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT public.accept_managed_invite((result->>'id')::uuid,'13800000-0000-4000-8000-000000000005','Historical accepted retry') FROM management_results WHERE kind='invite'$$,'historical accepted row with no binding preserves legitimate same-user idempotency');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.tenant_memberships m JOIN public.users u ON u.id=m.user_id WHERE u.auth_user_id='13800000-0000-4000-8000-000000000005'),1,'accepted invitation has exactly one membership');
SELECT is((SELECT count(*)::int FROM public.user_role_assignments r JOIN public.users u ON u.id=r.user_id WHERE u.auth_user_id='13800000-0000-4000-8000-000000000005' AND revoked_at IS NULL),1,'accepted invitation has exactly one active role assignment');
CREATE FUNCTION pg_temp.reject_management_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user_profile' THEN RAISE EXCEPTION 'management audit fault';END IF;RETURN NEW;END;$$;
CREATE TRIGGER management_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_management_audit();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.mutate_managed_user('profile',(result->>'id')::uuid,(result->>'version')::bigint,'{"full_name_en":"Must roll back"}') FROM management_results WHERE kind='member'$$,'P0001','management audit fault','audit failure aborts profile mutation');
SELECT is((SELECT full_name_en FROM public.users WHERE id='13800000-0000-4000-8000-000000000013'),'Edited member','audit failure leaves original profile intact');
RESET ROLE;
DROP TRIGGER management_audit_fault ON public.audit_log;
SET LOCAL ROLE authenticated;
UPDATE management_results SET result=public.mutate_managed_user('status',(result->>'id')::uuid,(result->>'version')::bigint,'{"status":"inactive","reason":"Retire synthetic member"}') WHERE kind='member';
UPDATE management_results SET result=public.mutate_managed_user('archive',(result->>'id')::uuid,(result->>'version')::bigint,'{"reason":"Archive synthetic member"}') WHERE kind='member';
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.users WHERE id='13800000-0000-4000-8000-000000000013'),'inactive user archived without deleting history');
SELECT is((SELECT count(*)::int FROM public.user_role_assignments WHERE user_id='13800000-0000-4000-8000-000000000013' AND revoked_at IS NULL),0,'archive revokes remaining active role assignment');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=(SELECT id FROM management_tenants WHERE kind='own') AND new_values::text LIKE '%0500000000%'),'audit history does not expose phone values');
-- Thousands of synthetic rows prove server filtering/paging and counts cannot
-- silently stop at the old 100/200/PostgREST1000 response ceilings.
INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at)
SELECT md5('management-page-'||n)::uuid,'management-page-'||n||'@example.test','{"_invite_provisioned":true}'::jsonb,now() FROM generate_series(1,1005) n;
INSERT INTO public.users(tenant_id,auth_user_id,email,full_name_en,role,status,must_change_password)
SELECT t.id,md5('management-page-'||n)::uuid,'management-page-'||n||'@example.test','Paged member '||n,'readonly_auditor','active',false FROM management_tenants t CROSS JOIN generate_series(1,1005) n WHERE t.kind='own';
SET LOCAL ROLE authenticated;
SELECT is((public.list_managed_users('users','Paged member')->>'total')::int,1005,'server count covers more than1000 matching users');
SELECT is(jsonb_array_length(public.list_managed_users('users','Paged member','all','all',11,100)->'users'),5,'roster final page after1000 rows is available');
SELECT is((public.list_managed_users('security','Paged member')->'kpis'->>'total')::int,1008,'security KPI counts full roster independently of current page/filter');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.list_managed_roles()$$,'42501',NULL,'anonymous role access denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"13800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
INSERT INTO management_results VALUES ('revocation',public.issue_managed_invite('management-revocation@example.test','accountant',gen_random_uuid(),crypt('fixture',gen_salt('bf')),now()+interval '1 day'));
SELECT lives_ok($$SELECT public.revoke_managed_invite((result->>'id')::uuid) FROM management_results WHERE kind='revocation'$$,'owner revocation commits with its audit');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='revocation') AND action='invite_revoked'),1::bigint,'one committed revocation audit');
SELECT throws_ok($$SELECT public.revoke_managed_invite((result->>'id')::uuid) FROM management_results WHERE kind='revocation'$$,'P0001','USR035: invitation is no longer pending','repeated revocation cannot report false success');
SELECT throws_ok($$SELECT public.revoke_managed_invite((result->>'id')::uuid) FROM management_results WHERE kind='invite'$$,'P0001','USR035: invitation is no longer pending','accepted invitation cannot be revoked');
INSERT INTO management_results VALUES ('revocation_rollback',public.issue_managed_invite('management-rollback@example.test','accountant',gen_random_uuid(),crypt('fixture',gen_salt('bf')),now()+interval '1 day'));
RESET ROLE;
CREATE FUNCTION pg_temp.fail_invite_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='invite_revoked' THEN RAISE EXCEPTION 'Synthetic invite audit failure';END IF;RETURN NEW;END;$$;
CREATE TRIGGER test_invite_revoke_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_invite_revoke_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.revoke_managed_invite((result->>'id')::uuid) FROM management_results WHERE kind='revocation_rollback'$$,'P0001','Synthetic invite audit failure','audit failure rolls back revocation');
SELECT is((SELECT status::text FROM public.invites WHERE id=(SELECT (result->>'id')::uuid FROM management_results WHERE kind='revocation_rollback')),'pending','failed audit preserves the pending token');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon','public.reserve_managed_invite_identity(uuid,uuid)','execute'),'anonymous cannot reserve Auth identities');
SELECT ok(NOT has_function_privilege('authenticated','management_private.reserve_invite_identity(uuid,uuid)','execute'),'authenticated cannot invoke the private identity binder');
SELECT * FROM finish();
ROLLBACK;
