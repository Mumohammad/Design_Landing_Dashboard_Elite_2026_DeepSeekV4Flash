BEGIN;
SELECT plan(26);
INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data)
VALUES('93000000-0000-4000-8000-000000000001','vat-093@example.test','synthetic','{"_invite_provisioned":true}');
CREATE TEMP TABLE vat_company AS SELECT (public.provision_company_atomic('93000000-0000-4000-8000-000000000001',
 '{"name":"VAT totals tests","slug":"vat-093","domain":"vat-093.test"}')->>'id')::uuid id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='93000000-0000-4000-8000-000000000001';
INSERT INTO public.tenants(id,name_ar,name_en) VALUES('93000000-0000-4000-8000-000000000002','مستأجر آخر','Foreign VAT tenant');
GRANT SELECT ON vat_company TO authenticated;
SELECT ok((SELECT NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.read_my_vat_position()'::regprocedure),'stable invoker with empty search path');
SELECT ok(NOT has_function_privilege('anon','public.read_my_vat_position()','execute'),'anon cannot call totals');
SELECT ok(has_function_privilege('authenticated','public.read_my_vat_position()','execute'),'authenticated has guarded entry point');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((public.read_my_vat_position()->>'period_count')::int,0,'empty tenant has zero periods');
SELECT is((public.read_my_vat_position()->>'net_position')::numeric,0::numeric,'empty tenant is a genuine zero');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- 1,201 periods exceed both the old 200-entry UI and default 1,000 API cap.
INSERT INTO public.vat_output_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount)
SELECT c.id,1900+(i-1)/12,1+(i-1)%12,'OUT-'||i,CURRENT_DATE,0.10 FROM vat_company c CROSS JOIN generate_series(1,1201) i;
INSERT INTO public.vat_output_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount)
VALUES('93000000-0000-4000-8000-000000000002',2026,1,'FOREIGN',CURRENT_DATE,999999);
INSERT INTO public.vat_input_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount,vat_recoverability)
SELECT c.id,1900,1,'IN-'||i,CURRENT_DATE,0.10,'recoverable' FROM vat_company c CROSS JOIN generate_series(1,205) i;
INSERT INTO public.vat_input_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount,vat_recoverability)
SELECT id,1900,1,'NONREC',CURRENT_DATE,2,'non_recoverable' FROM vat_company UNION ALL
SELECT id,1900,1,'REVIEW',CURRENT_DATE,3,'pending_review' FROM vat_company;
INSERT INTO public.vat_adjustments(tenant_id,period_year,period_month,adjustment_type,direction,vat_amount,status)
SELECT c.id,1900,1,'correction','output',0.10,'finalized' FROM vat_company c CROSS JOIN generate_series(1,105) i;
INSERT INTO public.vat_adjustments(tenant_id,period_year,period_month,adjustment_type,direction,vat_amount,status,deleted_at)
SELECT id,1900,1,'correction','input',1.10,'finalized',NULL::timestamptz FROM vat_company UNION ALL
SELECT id,1900,1,'credit_note','output',-0.50,'finalized',NULL::timestamptz FROM vat_company UNION ALL
SELECT id,1900,1,'correction','output',900,'draft',NULL::timestamptz FROM vat_company UNION ALL
SELECT id,1900,1,'correction','input',800,'voided',NULL::timestamptz FROM vat_company UNION ALL
SELECT id,1900,1,'correction','output',700,'finalized',now() FROM vat_company;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
CREATE TEMP TABLE vat_result AS SELECT public.read_my_vat_position() result;
SELECT is((SELECT (result->>'period_count')::int FROM vat_result),1201,'all periods beyond API cap');
SELECT is((SELECT (result->>'output_vat')::numeric FROM vat_result),120.10::numeric,'all output entries, excluding foreign tenant');
SELECT is((SELECT (result->>'recoverable_input_vat')::numeric FROM vat_result),20.50::numeric,'all recoverable input beyond 200');
SELECT is((SELECT (result->>'non_recoverable_vat')::numeric FROM vat_result),2::numeric,'nonrecoverable classified separately');
SELECT is((SELECT (result->>'pending_review_vat')::numeric FROM vat_result),3::numeric,'pending VAT not silently treated as deductible');
SELECT is((SELECT (result->>'adjustments_output')::numeric FROM vat_result),10::numeric,'all finalized adjustments beyond 100, including signed credit');
SELECT is((SELECT (result->>'adjustments_input')::numeric FROM vat_result),1.10::numeric,'draft, voided and deleted adjustments excluded');
SELECT is((SELECT (result->>'net_position')::numeric FROM vat_result),108.50::numeric,'exact canonical net position');
SELECT is((SELECT jsonb_typeof(result->'output_vat') FROM vat_result),'string','money crosses JSON as exact decimal strings');
SELECT is((SELECT count(*)::int FROM vat_result CROSS JOIN LATERAL jsonb_object_keys(result)),8,'only aggregate fields exposed');
SELECT is(public.read_my_vat_position(),(SELECT result FROM vat_result),'stable repeated read');
SELECT throws_ok($$SELECT public.read_my_vat_position('93000000-0000-4000-8000-000000000002'::uuid)$$,'42883',NULL,'no arbitrary tenant overload');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET must_change_password=true WHERE auth_user_id='93000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','forced password gate');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET must_change_password=false,status='inactive' WHERE auth_user_id='93000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','inactive caller denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET status='active',locked_until=now()+interval '1 hour' WHERE auth_user_id='93000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','locked caller denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000099","aal":"aal2"}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','unknown caller denied');
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','missing JWT denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','service key without user denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data)
VALUES('93000000-0000-4000-8000-000000000003','vat-driver-093@example.test','synthetic','{"_invite_provisioned":true}');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
SELECT '93000000-0000-4000-8000-000000000003',id,'vat-driver-093@example.test','accountant','active',false FROM vat_company;
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN vat_company c ON r.tenant_id=c.id WHERE r.name='accountant');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"93000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT throws_ok('SELECT public.read_my_vat_position()','42501','VAT access denied','role without accounting read denied');
SELECT is((SELECT count(*)::int FROM public.vat_output_ledger),0,'underlying ledger RLS remains enforced');
SELECT ok((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class WHERE oid='public.vat_reconciliation'::regclass),'canonical view remains invoker');
SELECT * FROM finish();
ROLLBACK;
