-- Synthetic-only transaction; actual caller RPCs, audit failure and replay.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('17200000-0000-4000-8000-000000000001','fine-atomic-own@example.test','{"_invite_provisioned":true}'),
('17200000-0000-4000-8000-000000000002','fine-atomic-other@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE fine_atomic_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO fine_atomic_tenants VALUES
('own',(public.provision_company_atomic('17200000-0000-4000-8000-000000000001','{"name":"Atomic fine own","domain":"fine-atomic-own.example.test","slug":"fine-atomic-own"}')->>'id')::uuid),
('other',(public.provision_company_atomic('17200000-0000-4000-8000-000000000002','{"name":"Atomic fine other","domain":"fine-atomic-other.example.test","slug":"fine-atomic-other"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('17200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status)
SELECT '17200000-0000-4000-8000-000000000011',tenant_id,'Atomic fine driver','0501720001','freelancer','active' FROM fine_atomic_tenants WHERE kind='own';
INSERT INTO public.external_fine_imports(id,tenant_id,source,external_ref,violation_date,fine_amount,matched_driver_id,status)
SELECT x.id,tenant_id,'manual',x.ref,'2098-01-01',x.amount,'17200000-0000-4000-8000-000000000011',x.status::public.external_fine_status
FROM fine_atomic_tenants CROSS JOIN (VALUES
('17200000-0000-4000-8000-000000000021'::uuid,'ATOMIC-1',123.45::numeric,'matched'),
('17200000-0000-4000-8000-000000000022'::uuid,'ATOMIC-FAIL',50::numeric,'matched'),
('17200000-0000-4000-8000-000000000023'::uuid,'ATOMIC-IGNORE',25::numeric,'ignored'),
('17200000-0000-4000-8000-000000000024'::uuid,'ATOMIC-MISSING',NULL::numeric,'matched'))x(id,ref,amount,status) WHERE kind='own';
SELECT ok(NOT has_function_privilege('anon','public.convert_my_external_fine(uuid)','EXECUTE'),'anon cannot convert fines');
SELECT ok(NOT has_function_privilege('service_role','public.convert_my_external_fine(uuid)','EXECUTE'),'service cannot bypass caller conversion');
SELECT ok(NOT has_function_privilege('authenticated','driver_operations_private.resolve_external_fine(uuid,text,uuid,uuid,text)','EXECUTE'),'legacy raw linking is owner-only');
CREATE TEMP TABLE fine_atomic_results(kind text PRIMARY KEY,result jsonb);
GRANT ALL ON fine_atomic_tenants,fine_atomic_results TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17200000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO fine_atomic_results VALUES('first',public.convert_my_external_fine('17200000-0000-4000-8000-000000000021'));
INSERT INTO fine_atomic_results VALUES('retry',public.convert_my_external_fine('17200000-0000-4000-8000-000000000021'));
SELECT is((SELECT result->>'violation_id' FROM fine_atomic_results WHERE kind='first'),(SELECT result->>'violation_id' FROM fine_atomic_results WHERE kind='retry'),'lost-response retry returns the same violation');
SELECT is((SELECT result->>'replayed' FROM fine_atomic_results WHERE kind='retry'),'true','retry is recognized');
SELECT is((SELECT count(*)::int FROM public.violations WHERE external_fine_id='17200000-0000-4000-8000-000000000021'),1,'one linked violation');
SELECT is((SELECT deduction_amount FROM public.violations WHERE external_fine_id='17200000-0000-4000-8000-000000000021'),123.45::numeric,'stored fine determines deduction');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id='17200000-0000-4000-8000-000000000021' AND action='link_violation'),1,'replay adds no second link audit');
SELECT throws_ok($$SELECT public.resolve_external_fine('17200000-0000-4000-8000-000000000022','link_violation',NULL,'17200000-0000-4000-8000-000000000031')$$,'P0001','FIN014: use the atomic fine conversion workflow','cannot use two-step linking');
SELECT throws_ok($$SELECT public.convert_my_external_fine('17200000-0000-4000-8000-000000000023')$$,'P0001','FIN012: assign a driver before conversion','ignored fine cannot generate a deduction');
SELECT throws_ok($$SELECT public.convert_my_external_fine('17200000-0000-4000-8000-000000000024')$$,'P0001','FIN005: a valid fine amount is required','unknown amount cannot become zero');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_atomic_fine_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.entity_type='external_fine_imports' AND NEW.entity_id='17200000-0000-4000-8000-000000000022' AND NEW.action='link_violation' THEN RAISE EXCEPTION 'SYNTHETIC_FINE_AUDIT_FAILURE'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER fine_atomic_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_atomic_fine_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.convert_my_external_fine('17200000-0000-4000-8000-000000000022')$$,'P0001','SYNTHETIC_FINE_AUDIT_FAILURE','required link audit failure aborts conversion');
SELECT is((SELECT count(*)::int FROM public.violations WHERE incident_description LIKE 'Traffic fine ATOMIC-FAIL%'),0,'audit failure leaves no orphan violation');
SELECT is((SELECT status::text FROM public.external_fine_imports WHERE id='17200000-0000-4000-8000-000000000022'),'matched','audit failure keeps original fine status');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17200000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.convert_my_external_fine('17200000-0000-4000-8000-000000000021')$$,'P0001','FIN010: fine not found','foreign tenant cannot recover or convert the fine');
SELECT * FROM finish();
ROLLBACK;
