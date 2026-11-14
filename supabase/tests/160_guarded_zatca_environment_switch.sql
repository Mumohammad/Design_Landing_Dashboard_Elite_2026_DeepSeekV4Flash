BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('16000000-0000-4000-8000-000000000001','switch-owner@example.test','{"_invite_provisioned":true}'),
 ('16000000-0000-4000-8000-000000000002','switch-foreign@example.test','{"_invite_provisioned":true}'),
 ('16000000-0000-4000-8000-000000000003','switch-delegate@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE switch_tenants(label text PRIMARY KEY,id uuid);
INSERT INTO switch_tenants VALUES
 ('own',(public.provision_company_atomic('16000000-0000-4000-8000-000000000001','{"name":"Switch fixture","slug":"switch160","domain":"switch160.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('16000000-0000-4000-8000-000000000002','{"name":"Foreign switch","slug":"switch160foreign","domain":"switch160foreign.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '16000000-0000-4000-8000-000000000003',id,'switch-delegate@example.test','readonly_auditor','active',false FROM switch_tenants WHERE label='own';
-- Existing preferences are read without rewriting them. Fixtures use the trusted
-- database owner; application/service writes must go through the guarded RPC.
INSERT INTO public.zatca_tenant_environment(tenant_id,production_enabled,changed_by,acknowledgement)
 SELECT id,true,'16000000-0000-4000-8000-000000000001','Historical preference' FROM switch_tenants WHERE label='own';
CREATE TEMP TABLE switch_initial AS SELECT configuration_version FROM public.tenants WHERE id=(SELECT id FROM switch_tenants WHERE label='own');
CREATE TEMP TABLE switch_state(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON switch_tenants,switch_initial TO authenticated;
GRANT SELECT,INSERT ON switch_state TO authenticated;
SELECT ok(NOT has_function_privilege('anon','public.read_my_zatca_environment()','EXECUTE'),'anonymous environment reads denied');
SELECT ok(NOT has_function_privilege('anon','public.save_my_zatca_environment(uuid,bigint,boolean,text)','EXECUTE'),'anonymous environment writes denied');
SELECT ok(NOT has_function_privilege('service_role','public.save_my_zatca_environment(uuid,bigint,boolean,text)','EXECUTE'),'service role cannot impersonate a caller');
SELECT ok(NOT has_table_privilege('authenticated','zatca_switch_private.receipts','SELECT'),'receipts remain private');
-- Model a future grant in either migration order; the transaction-local grant
-- must still be constrained by the caller-only write trigger.
GRANT INSERT,UPDATE ON public.zatca_tenant_environment TO service_role;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.zatca_tenant_environment SET production_enabled=false WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug='switch160')$$,'42501','ZATCA_SWITCH_CALLER_REQUIRED','later service-role UPDATE grant cannot bypass the caller transaction');
SELECT throws_ok($$INSERT INTO public.zatca_tenant_environment(tenant_id,production_enabled) SELECT id,false FROM public.tenants WHERE slug='switch160foreign'$$,'42501','ZATCA_SWITCH_CALLER_REQUIRED','later service-role INSERT grant cannot bypass the caller transaction');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.read_my_zatca_environment()->>'production_enabled','true','stored ON is reported without a silent OFF fallback');
SELECT is((public.read_my_zatca_environment()->>'configuration_version')::bigint,(SELECT configuration_version FROM switch_initial),'read returns the reviewed shared version');
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000101',(SELECT configuration_version FROM switch_initial),true,'ack')$$,'P0001','ZATCA_PRODUCTION_BLOCKED','no caller can open production through this RPC');
SELECT throws_ok($$SELECT public.save_my_zatca_environment(NULL,(SELECT configuration_version FROM switch_initial),false,NULL)$$,'P0001','ZATCA_SWITCH_INVALID','request identity required');
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000101',(SELECT configuration_version+1 FROM switch_initial),false,NULL)$$,'P0001','ZATCA_SWITCH_STALE','unreviewed version cannot disable the preference');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_switch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='zatca_production_disabled' THEN RAISE EXCEPTION 'ZATCA_SWITCH_AUDIT_TEST'; END IF; RETURN NEW; END $$;
CREATE TRIGGER switch_audit_test BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_switch_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL)$$,'P0001','ZATCA_SWITCH_AUDIT_TEST','audit failure rolls back the entire switch save');
SELECT is(public.read_my_zatca_environment()->>'production_enabled','true','audit rollback retains the prior preference');
SELECT is((public.read_my_zatca_environment()->>'configuration_version')::bigint,(SELECT configuration_version FROM switch_initial),'audit rollback retains the shared version');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM zatca_switch_private.receipts WHERE tenant_id=(SELECT id FROM switch_tenants WHERE label='own')),0,'failed audit leaves no successful receipt');
DROP TRIGGER switch_audit_test ON public.audit_log;
SET LOCAL ROLE authenticated;
INSERT INTO switch_state VALUES('off',public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL));
SELECT is(public.read_my_zatca_environment()->>'production_enabled','false','confirmed recovery clears the stored preference');
SELECT is((public.read_my_zatca_environment()->>'configuration_version')::bigint,(SELECT configuration_version+1 FROM switch_initial),'confirmed recovery advances the shared version once');
SELECT throws_ok($$SELECT public.save_my_settings('company','{"name_ar":"شركة","name_en":"Company"}',(SELECT configuration_version FROM switch_initial))$$,'P0001','SETTINGS_STALE','a stale profile cannot overwrite the switch version');
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version+1 FROM switch_initial),false,NULL)$$,'P0001','ZATCA_SWITCH_INVALID','same request ID cannot be reused with a different reviewed version');
RESET ROLE;
-- Construct a later trusted change and prove a historical receipt cannot undo it.
UPDATE public.zatca_tenant_environment SET production_enabled=true,acknowledgement='Later fixture preference' WHERE tenant_id=(SELECT id FROM switch_tenants WHERE label='own');
UPDATE public.tenants SET configuration_version=configuration_version+1 WHERE id=(SELECT id FROM switch_tenants WHERE label='own');
SET LOCAL ROLE authenticated;
SELECT is(public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL),(SELECT result||'{"replayed":true}'::jsonb FROM switch_state WHERE label='off'),'exact retry returns the historical receipt');
SELECT is(public.read_my_zatca_environment()->>'production_enabled','true','historical OFF retry cannot undo a later stored preference');
SELECT is((public.read_my_zatca_environment()->>'configuration_version')::bigint,(SELECT configuration_version+2 FROM switch_initial),'historical retry leaves the later version intact');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is(public.read_my_zatca_environment()->>'production_enabled','false','foreign caller sees only its own default preference');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000201',(SELECT configuration_version+2 FROM switch_initial),false,NULL)$$,'42501','ZATCA_SWITCH_FORBIDDEN','reader without accounting approval cannot save');
RESET ROLE;
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.tenant_id=(SELECT id FROM switch_tenants WHERE label='own') AND r.name='readonly_auditor' AND p.module='accounting' AND p.action='approve' ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000201',(SELECT configuration_version+2 FROM switch_initial),false,NULL)$$,'dynamic accounting approver can save the reviewed OFF intent');
RESET ROLE;
DELETE FROM public.role_permissions WHERE role_id IN(SELECT id FROM public.roles WHERE tenant_id=(SELECT id FROM switch_tenants WHERE label='own') AND name='readonly_auditor') AND permission_id IN(SELECT id FROM public.permissions WHERE module='accounting' AND action='approve');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000201',(SELECT configuration_version+2 FROM switch_initial),false,NULL)$$,'42501','ZATCA_SWITCH_FORBIDDEN','revoked approver cannot replay a successful receipt');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL)$$,'42501','ZATCA_SWITCH_FORBIDDEN','receipt replay still requires current MFA');
RESET ROLE;
-- RESET ROLE retains transaction-local JWT settings. These two fixture-only
-- lock transitions belong to the database owner, not the signed-in user.
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET locked_until=now()+interval '1 hour' WHERE auth_user_id='16000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL)$$,'42501','ZATCA_SWITCH_FORBIDDEN','locked owner cannot replay a receipt');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET locked_until=NULL WHERE auth_user_id='16000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=(SELECT id FROM switch_tenants WHERE label='own') AND action='zatca_production_disabled'),2,'each committed switch has one required audit and retries add none');
SELECT throws_ok($$UPDATE zatca_switch_private.receipts SET result='{}'$$,'P0001','ZATCA_SWITCH_RECEIPT_IMMUTABLE','receipts cannot be rewritten');
SELECT throws_ok($$TRUNCATE zatca_switch_private.receipts$$,'P0001','ZATCA_SWITCH_RECEIPT_IMMUTABLE','receipts cannot be truncated');
UPDATE public.tenants SET status='suspended' WHERE id=(SELECT id FROM switch_tenants WHERE label='own');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_zatca_environment('16000000-0000-4000-8000-000000000102',(SELECT configuration_version FROM switch_initial),false,NULL)$$,'42501','ZATCA_SWITCH_FORBIDDEN','inactive tenant cannot replay a receipt');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
