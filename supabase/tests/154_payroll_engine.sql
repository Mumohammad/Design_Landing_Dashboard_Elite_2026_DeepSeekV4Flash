BEGIN;
SELECT no_plan();
-- Privileges: the engine RPCs are server-only.
SELECT ok(has_function_privilege('service_role','public.payroll_engine_save_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,integer)','EXECUTE'),'service role saves payroll runs');
SELECT ok(NOT has_function_privilege('authenticated','public.payroll_engine_save_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,integer)','EXECUTE'),'browser role cannot save runs');
SELECT ok(NOT has_function_privilege('authenticated','public.payroll_engine_approve_run(uuid,uuid,uuid,integer,jsonb)','EXECUTE'),'browser role cannot approve runs');
SELECT ok(NOT has_function_privilege('anon','public.payroll_engine_cancel_run(uuid,uuid,uuid,text)','EXECUTE'),'anonymous cannot cancel runs');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payroll_engine_results'::regclass),'results have RLS');

CREATE TEMP TABLE pe_args AS SELECT
 '{"payroll_month":"January 2191","month_key":"2191-01","platform_name":"HS","file_name":"jan.xlsx","rule_set_name":"R","rule_snapshot":{},"totals":{"totalGross":1000,"totalPenalties":50,"totalNet":950,"totalVariance":0,"totalTraffic":0}}'::jsonb AS run,
 '[{"rider_id":"R1","driver_name":"Rider One","result":{"contractName":"C","vehicleType":"bike","completedOrders":100,"uploadedBasicPayment":950,"grossSalaryBeforePenalties":1000,"totalOtherPenalties":50,"trafficViolationsDeduction":0,"finalNetSalary":950,"varianceAmount":0,"varianceStatus":"ok","reviewStatus":"ok","performanceBand":"average","exceptionFlag":false},"raw_input":{"riderId":"R1"}}]'::jsonb AS results,
 '[{"riderId":"R1","driverName":"Rider One","basicPayment":1000,"distancePayment":0,"segmentPayment":0,"acceptancePenalty":0,"contactPenalty":0,"stackingDeduction":0,"declinedPenalty":0,"latePenalty":50,"noShowPenalty":0,"noShowSpecialPenalty":0,"dailyAcceptancePenalty":0,"missedDaysPenalty":0,"riderBalance":0,"totalIncome":950,"totalPenalties":50}]'::jsonb AS income;

INSERT INTO public.payroll_engine_items(id,tenant_id,kind,name,amount,installment_enabled,installment_monthly_amount,installment_total_paid,installment_status)
VALUES ('15400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','deduction','Loan',1000,true,400,800,'active');
INSERT INTO public.payroll_engine_traffic_fines(id,tenant_id,rider_id,ticket_date,violation_type,amount,status)
VALUES ('15400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','R1','2191-01-05','Speed',300,'approved');
INSERT INTO public.payroll_engine_adjustments(id,tenant_id,rider_id,title,amount,adjustment_type)
VALUES ('15400000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','R1','Advance',100,'deduction');

SELECT lives_ok($$SELECT public.payroll_engine_save_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT run FROM pe_args),(SELECT results FROM pe_args),'[]','[]'::jsonb||(SELECT income FROM pe_args))$$,'draft run saves');
SELECT is((SELECT count(*)::int FROM public.payroll_engine_runs WHERE month_key='2191-01' AND status='draft'),1,'one draft run');
SELECT is((SELECT final_net_salary FROM public.payroll_engine_results r JOIN public.payroll_engine_runs u ON u.id=r.run_id WHERE u.month_key='2191-01' AND u.status='draft'),950::numeric,'result columns extracted');
SELECT is((SELECT total_income FROM public.payroll_income_records WHERE month_key='2191-01' AND rider_id='R1'),950::numeric,'income synced');

SELECT lives_ok($$SELECT public.payroll_engine_save_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT run FROM pe_args),(SELECT results FROM pe_args),'[]',(SELECT income FROM pe_args))$$,'re-import saves');
SELECT is((SELECT count(*)::int FROM public.payroll_engine_runs WHERE month_key='2191-01' AND status='draft'),1,'re-import replaces the previous draft');
SELECT is((SELECT cancel_reason FROM public.payroll_engine_runs WHERE month_key='2191-01' AND status='cancelled'),'Replaced by a new import','previous draft cancelled with reason');
SELECT is((SELECT count(*)::int FROM public.payroll_income_records WHERE month_key='2191-01'),1,'income not duplicated');

CREATE TEMP TABLE pe_run AS SELECT id, version FROM public.payroll_engine_runs WHERE month_key='2191-01' AND status='draft';
SELECT throws_like($$SELECT public.payroll_engine_approve_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT id FROM pe_run),(SELECT version FROM pe_run)+5,'[]')$$,'PAYENG004:%','stale version cannot approve');
SELECT is(public.payroll_engine_approve_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT id FROM pe_run),(SELECT version FROM pe_run),
 '[{"table":"items","id":"15400000-0000-4000-8000-000000000001","installmentTotalPaid":1000,"installmentStatus":"completed"},{"table":"traffic_status","id":"15400000-0000-4000-8000-000000000002"},{"table":"adjustment_status","id":"15400000-0000-4000-8000-000000000003"},{"table":"traffic_status","id":"15400000-0000-4000-8000-0000000000ff"}]'),
 '{"advanced": 1, "settled": 2}'::jsonb,'approval advances installments and settles one-off records (missing ids ignored)');
SELECT is((SELECT installment_status||':'||installment_total_paid FROM public.payroll_engine_items WHERE id='15400000-0000-4000-8000-000000000001'),'completed:1000','installment completed');
SELECT is((SELECT status FROM public.payroll_engine_traffic_fines WHERE id='15400000-0000-4000-8000-000000000002'),'paid','one-off fine settled');
SELECT is((SELECT status FROM public.payroll_engine_adjustments WHERE id='15400000-0000-4000-8000-000000000003'),'paid','manual adjustment settled');
SELECT throws_like($$SELECT public.payroll_engine_save_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT run FROM pe_args),(SELECT results FROM pe_args),'[]',(SELECT income FROM pe_args))$$,'PAYENG005:%','approved month cannot be re-imported');

SELECT throws_like($$SELECT public.payroll_engine_cancel_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT id FROM pe_run),'x')$$,'PAYENG007:%','cancel needs a reason');
SELECT lives_ok($$SELECT public.payroll_engine_cancel_run('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',(SELECT id FROM pe_run),'Wrong workbook')$$,'approved run cancels');
SELECT is((SELECT installment_status||':'||installment_total_paid FROM public.payroll_engine_items WHERE id='15400000-0000-4000-8000-000000000001'),'active:800','installment progress rolled back');
SELECT is((SELECT status FROM public.payroll_engine_traffic_fines WHERE id='15400000-0000-4000-8000-000000000002'),'approved','fine settlement rolled back');
SELECT is((SELECT status FROM public.payroll_engine_adjustments WHERE id='15400000-0000-4000-8000-000000000003'),'active','adjustment settlement rolled back');
SELECT is((SELECT count(*)::int FROM public.payroll_income_records WHERE month_key='2191-01'),0,'cancelled run income removed');
SELECT throws_like($$SELECT public.payroll_engine_approve_run('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',(SELECT id FROM pe_run),1,'[]')$$,'PAYENG002:%','cross-tenant approve is rejected');
SELECT * FROM finish();
ROLLBACK;
