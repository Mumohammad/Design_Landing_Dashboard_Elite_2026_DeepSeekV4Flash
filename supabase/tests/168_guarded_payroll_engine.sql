BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('16800000-0000-4000-8000-000000000001','guard168@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE pg_tenant AS SELECT (public.provision_company_atomic('16800000-0000-4000-8000-000000000001','{"name":"Guard168","slug":"guard168","domain":"guard168.example.test"}')->>'id')::uuid id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='16800000-0000-4000-8000-000000000001';
CREATE TEMP TABLE pg_values(label text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE pg_input AS SELECT
 jsonb_build_object('payroll_month','January 2192','month_key','2192-01','platform_name','HungerStation','file_name','synthetic.xlsx','file_path',id::text||'/2192-01/16800000-0000-4000-8000-000000000099.xlsx','file_sha256',repeat('a',64),'rule_set_name','Synthetic','rule_snapshot','{}'::jsonb,'totals',jsonb_build_object('totalGross',25020,'totalNet',12522.51,'totalPenalties',12497.49,'totalVariance',0,'totalTraffic',0)) run
 FROM pg_tenant;
ALTER TABLE pg_input ADD COLUMN results jsonb;
UPDATE pg_input SET results=(SELECT jsonb_agg(jsonb_build_object('rider_id','R'||n,'driver_name','Synthetic '||n,'result',jsonb_build_object('contractName','Synthetic','vehicleType','bike','completedOrders',1,'uploadedBasicPayment',10.01,'grossSalaryBeforePenalties',20,'totalOtherPenalties',9.99,'trafficViolationsDeduction',0,'finalNetSalary',10.01,'varianceAmount',0,'varianceStatus','ok','reviewStatus','ok','performanceBand','average','exceptionFlag',false),'raw_input',jsonb_build_object('riderId','R'||n))) FROM generate_series(1,1251) n);
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance) SELECT '16800000-0000-4000-8000-000000000201',id,'990168','رواتب','Synthetic salaries','expense','debit' FROM pg_tenant;
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance) SELECT '16800000-0000-4000-8000-000000000202',id,'290168','رواتب مستحقة','Synthetic payable','liability','credit' FROM pg_tenant;
-- Rollback-only calculator stand-in: exercise the real service attestor with
-- synthetic claims, then restore the caller before testing the guarded RPC.
CREATE FUNCTION pg_temp.attest_save(source_version bigint,target uuid DEFAULT NULL,expected integer DEFAULT NULL,partial boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE claims text:=current_setting('request.jwt.claims',true);payload jsonb;answer boolean;
BEGIN
 SELECT jsonb_build_object('run',run,'results',CASE WHEN partial THEN (SELECT jsonb_agg(r) FROM jsonb_array_elements(results) WITH ORDINALITY x(r,n) WHERE n<=1000) ELSE results END,'exceptions','[]'::jsonb,'income','[]'::jsonb,'source',source_version,'run_id',target,'expected_version',expected) INTO payload FROM pg_input;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 answer:=public.attest_platform_payroll((SELECT id FROM pg_tenant),'16800000-0000-4000-8000-000000000001','save',payload,source_version);
 PERFORM set_config('request.jwt.claims',claims,true);RETURN answer;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claims',claims,true);RAISE;
END $$;
CREATE FUNCTION pg_temp.attest_approval(target uuid,expected integer,source_version bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE claims text:=current_setting('request.jwt.claims',true);payload jsonb;answer boolean;
BEGIN
 SELECT jsonb_build_object('run_id',target,'expected_version',expected,'changes','[]'::jsonb,'source',source_version,'results',(SELECT jsonb_agg(result ORDER BY rider_id COLLATE "C") FROM public.payroll_engine_results WHERE run_id=target)) INTO payload;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 answer:=public.attest_platform_payroll((SELECT id FROM pg_tenant),'16800000-0000-4000-8000-000000000001','approve',payload,source_version);
 PERFORM set_config('request.jwt.claims',claims,true);RETURN answer;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claims',claims,true);RAISE;
END $$;
GRANT SELECT ON pg_tenant,pg_input TO authenticated;
GRANT ALL ON pg_values TO authenticated;
SELECT ok(NOT has_function_privilege('service_role','public.save_my_platform_payroll(jsonb,jsonb,jsonb,jsonb,bigint,uuid,integer)','EXECUTE'),'service role cannot impersonate a payroll caller');
SELECT ok(NOT has_function_privilege('anon','public.create_my_platform_payroll_journal(uuid,uuid,uuid)','EXECUTE'),'anonymous journal creation denied');
SELECT ok(NOT has_table_privilege('authenticated','payroll_guard_private.run_receipts','SELECT'),'payroll receipts stay private');
SELECT ok(NOT has_function_privilege('authenticated','public.attest_platform_payroll(uuid,uuid,text,jsonb,bigint)','EXECUTE'),'browser cannot attest calculator outputs');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO pg_values VALUES('source',to_jsonb(public.read_my_payroll_source_version()));
SELECT throws_like($$SELECT public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT results FROM pg_input),'[]','[]',public.read_my_payroll_source_version())$$,'PAYENG019:%','caller cannot save invented unconfirmed calculations');
SELECT pg_temp.attest_save(public.read_my_payroll_source_version());
INSERT INTO pg_values VALUES('run',to_jsonb(public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT results FROM pg_input),'[]','[]',(SELECT(value#>>'{}')::bigint FROM pg_values WHERE label='source'))));
SELECT is(public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT results FROM pg_input),'[]','[]',(SELECT(value#>>'{}')::bigint FROM pg_values WHERE label='source')),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),'unknown import retry returns its original run');
SELECT pg_temp.attest_save(public.read_my_payroll_source_version(),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),1,true);
SELECT throws_like($$SELECT public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT jsonb_agg(r) FROM pg_input,jsonb_array_elements(results) WITH ORDINALITY x(r,n) WHERE n<=1000),'[]','[]',public.read_my_payroll_source_version(),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),1)$$,'PAYENG012:%','a partial 1000-of-1251 recalculation is rejected');
RESET ROLE;
INSERT INTO public.payroll_engine_items(tenant_id,kind,name,amount) SELECT id,'bonus','Source version probe',0 FROM pg_tenant;
SET LOCAL ROLE authenticated;
SELECT throws_like($$SELECT public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT results FROM pg_input),'[]','[]',(SELECT(value#>>'{}')::bigint FROM pg_values WHERE label='source'),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),1)$$,'PAYENG011:%','source changes invalidate a previously loaded calculation');
SELECT pg_temp.attest_save(public.read_my_payroll_source_version(),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),1);
SELECT lives_ok($$SELECT public.save_my_platform_payroll((SELECT run FROM pg_input),(SELECT results FROM pg_input),'[]','[]',public.read_my_payroll_source_version(),(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),1)$$,'complete recalculation saves against current source version');
SELECT pg_temp.attest_approval((SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),2,public.read_my_payroll_source_version());
SELECT lives_ok($$SELECT public.approve_my_platform_payroll((SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),2,'[]',public.read_my_payroll_source_version())$$,'reviewed complete run can be approved');
INSERT INTO pg_values VALUES('journal',public.create_my_platform_payroll_journal((SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),'16800000-0000-4000-8000-000000000201','16800000-0000-4000-8000-000000000202'));
SELECT is(public.create_my_platform_payroll_journal((SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),'16800000-0000-4000-8000-000000000201','16800000-0000-4000-8000-000000000202')->>'id',(SELECT value->>'id' FROM pg_values WHERE label='journal'),'repeated journal requests return one linked journal');
SELECT throws_like($$SELECT public.cancel_my_platform_payroll((SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run'),'Synthetic cancellation')$$,'PAYENG008:%','a live journal must be removed or reversed before cancellation');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.journal_entries WHERE source_entity_id=(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run')),1,'one payroll source journal exists');
SELECT is((SELECT sum(debit_amount) FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT(value->>'id')::uuid FROM pg_values WHERE label='journal')),12522.51::numeric,'journal includes all 1251 per-rider payable amounts');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE action='platform_payroll_journal_atomic' AND entity_id=(SELECT(value#>>'{}')::uuid FROM pg_values WHERE label='run')),1,'journal link and audit commit exactly once');
CREATE TEMP TABLE pg_income AS SELECT jsonb_build_object('rider_id','I1','driver_name','Synthetic income','basic_payment',100,'distance_payment',0,'segment_payment',0,'acceptance_penalty',0,'contact_penalty',0,'stacking_deduction',0,'declined_penalty',0,'late_penalty',0,'no_show_penalty',0,'no_show_special_penalty',0,'daily_acceptance_penalty',0,'missed_days_penalty',0,'rider_balance',0,'custom_fields','[]'::jsonb) row;
GRANT SELECT ON pg_income TO authenticated;
SET LOCAL ROLE authenticated;
SELECT throws_like($$SELECT public.import_my_platform_income('16800000-0000-4000-8000-000000000301','2192-02','Synthetic',jsonb_build_array((SELECT row FROM pg_income),(SELECT row||'{"rider_id":"I2","basic_payment":"invalid"}' FROM pg_income)),false)$$,'PAYENG020:%','a bad later import row rolls back all earlier rows');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.payroll_income_records WHERE tenant_id=(SELECT id FROM pg_tenant) AND month_key='2192-02'),0,'failed bulk import commits no partial rows');
SET LOCAL ROLE authenticated;
INSERT INTO pg_values VALUES('income',public.import_my_platform_income('16800000-0000-4000-8000-000000000302','2192-02','Synthetic',jsonb_build_array((SELECT row FROM pg_income)),false));
SELECT is(public.import_my_platform_income('16800000-0000-4000-8000-000000000302','2192-02','Synthetic',jsonb_build_array((SELECT row FROM pg_income)),false)->>'replayed','true','same import request replays without overwriting or duplicating');
SELECT throws_like($$SELECT public.import_my_platform_income('16800000-0000-4000-8000-000000000302','2192-02','Synthetic',jsonb_build_array((SELECT row||'{"basic_payment":200}' FROM pg_income)),true)$$,'PAYENG021:%','a retry identity cannot represent different money');
RESET ROLE;
SELECT is((SELECT total_income FROM public.payroll_income_records WHERE tenant_id=(SELECT id FROM pg_tenant) AND rider_id='I1'),100::numeric,'income totals derive from validated components');
SELECT * FROM finish();
ROLLBACK;
