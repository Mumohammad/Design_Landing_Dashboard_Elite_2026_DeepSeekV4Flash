BEGIN;
SELECT plan(34);
INSERT INTO public.tenants(id,name_ar,name_en) VALUES('a9500000-0000-4000-8000-000000000001','Payroll fixture','Payroll fixture'),('a9500000-0000-4000-8000-000000000002','Other fixture','Other fixture');
INSERT INTO auth.users(id,email) VALUES('a9500000-0000-4000-8000-000000000003','payroll-preparation@example.test');
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES('a9500000-0000-4000-8000-000000000004','a9500000-0000-4000-8000-000000000003','a9500000-0000-4000-8000-000000000001','payroll-preparation@example.test','general_manager','active',false);
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date) VALUES('a9500000-0000-4000-8000-000000000005','a9500000-0000-4000-8000-000000000001','Pay fixture','0509500001','sponsored_type1','active','2026-02-14'),('a9500000-0000-4000-8000-000000000006','a9500000-0000-4000-8000-000000000002','Other fixture','0509500002','sponsored_type1','active','2025-01-01');
INSERT INTO public.delivery_platforms(id,tenant_id,code,name_ar) VALUES('a9500000-0000-4000-8000-000000000007','a9500000-0000-4000-8000-000000000001','PAY95','Payroll test');
CREATE TEMP TABLE payroll_fixture(rule jsonb,rule_id uuid,advance_id uuid,period_id uuid);
INSERT INTO payroll_fixture(rule) VALUES('{"driverId":"a9500000-0000-4000-8000-000000000005","category":"sponsored_type1","effectiveDate":"2026-02-01","workingDaysTarget":24,"targetOrders":300,"baseSalary":2700.25,"bonusRate":0,"deductionRate":0,"minimumNetFloor":0,"note":"Owner reviewed explicit rule"}');
GRANT SELECT,UPDATE ON payroll_fixture TO authenticated;

ALTER TABLE payroll_fixture ADD COLUMN basis_payload jsonb;ALTER TABLE payroll_fixture ADD COLUMN result jsonb;
INSERT INTO public.system_settings(tenant_id,key,value,category) VALUES('a9500000-0000-4000-8000-000000000001','payroll.saudi_minimum_wage','4000','payroll');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date,termination_date) VALUES
 ('a9500000-0000-4000-8000-000000000010','a9500000-0000-4000-8000-000000000001','One day type2','0509500010','sponsored_type2','terminated','2026-02-28','2026-02-28'),
 ('a9500000-0000-4000-8000-000000000011','a9500000-0000-4000-8000-000000000001','Suspended owed payroll','0509500011','freelancer','suspended','2025-01-01',NULL),
 ('a9500000-0000-4000-8000-000000000012','a9500000-0000-4000-8000-000000000001','Missing termination','0509500012','freelancer','terminated','2025-01-01',NULL),
 ('a9500000-0000-4000-8000-000000000013','a9500000-0000-4000-8000-000000000001','Missing hire','0509500013','freelancer','active',NULL,NULL),
 ('a9500000-0000-4000-8000-000000000014','a9500000-0000-4000-8000-000000000001','Future hire','0509500014','freelancer','active','2026-03-01',NULL),
 ('a9500000-0000-4000-8000-000000000015','a9500000-0000-4000-8000-000000000001','Former employee','0509500015','freelancer','terminated','2025-01-01','2026-01-31'),
 ('a9500000-0000-4000-8000-000000000016','a9500000-0000-4000-8000-000000000001','Partial freelancer','0509500016','freelancer','terminated','2025-01-01','2026-02-10');
CREATE FUNCTION pg_temp.prepare_driver(d uuid,from_d date,to_d date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ver integer;
BEGIN
 SELECT version INTO ver FROM public.payroll_preparation_reviews WHERE driver_id=d AND period_year=2026 AND period_month=2;
 PERFORM public.payroll_preparation_mutate('attendance_save',jsonb_build_object('year',2026,'month',2,'driverId',d,'expectedVersion',COALESCE(ver,0),'note','Every employed date reviewed','days',(SELECT jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),'status','present')) FROM generate_series(from_d,to_d,'1 day'::interval) day)));
 SELECT version INTO ver FROM public.payroll_preparation_reviews WHERE driver_id=d AND period_year=2026 AND period_month=2;
 PERFORM public.payroll_preparation_mutate('orders_review',jsonb_build_object('year',2026,'month',2,'driverId',d,'expectedVersion',ver,'delivered',0,'revenue',0,'note','Confirmed explicit zero delivered orders'));
END; $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a9500000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
SELECT is(jsonb_array_length(public.payroll_preparation_read(2026,2)->'drivers'),6,'Overlapping and unknown employment included regardless current status; former/future excluded');
SELECT is((SELECT value->'employment'->>'issue' FROM jsonb_array_elements(public.payroll_preparation_read(2026,2)->'drivers') WHERE value->>'id'='a9500000-0000-4000-8000-000000000012'),'PAY_TERMINATION_DATE_REQUIRED','Unknown termination surfaces review instead of omitting owed pay');
SELECT is((SELECT value->'employment'->>'issue' FROM jsonb_array_elements(public.payroll_preparation_read(2026,2)->'drivers') WHERE value->>'id'='a9500000-0000-4000-8000-000000000013'),'PAY_HIRE_DATE_REQUIRED','Unknown hire date surfaces review');
SELECT public.payroll_preparation_mutate('open','{"year":2026,"month":2,"workingDays":28}');
UPDATE payroll_fixture SET rule=rule||'{"effectiveDate":"2026-02-14","bonusRate":3,"deductionRate":2}';
UPDATE payroll_fixture SET rule_id=(public.payroll_preparation_mutate('rule_save',rule)->>'id')::uuid;
UPDATE payroll_fixture SET basis_payload=jsonb_build_object('year',2026,'month',2,'driverId','a9500000-0000-4000-8000-000000000005','expectedVersion',0,'ruleId',rule_id,'ruleVersion',1,'employedFrom','2026-02-14','employedTo','2026-02-28','periodBaseAmount',1234.56,'periodOrderTarget',30,'periodAbsenceDeduction',5.67,'periodMinimumFloor',100,'ratesAcknowledged',true,'note','Owner reviewed explicit period amounts');
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload-'periodBaseAmount') FROM payroll_fixture$$,'P0001','PAY_PERIOD_AMOUNTS_REQUIRED','No partial-period base is guessed');
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload||'{"ratesAcknowledged":false}') FROM payroll_fixture$$,'P0001','PAY_RULE_SNAPSHOT_CHANGED','Actual rule rates must be acknowledged');
SELECT set_config('request.jwt.claims','{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload) FROM payroll_fixture$$,'42501','PAY_PREPARATION_FORBIDDEN','Period amount approval enforces MFA');
SELECT set_config('request.jwt.claims','{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
SELECT lives_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload) FROM payroll_fixture$$,'Owner approves explicit partial amounts');
SELECT is((SELECT count(*)::integer FROM public.driver_attendance WHERE driver_id='a9500000-0000-4000-8000-000000000005'),0,'Approving pay does not fabricate attendance');
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload) FROM payroll_fixture$$,'P0001','PAY_STALE_VERSION','Stale basis approval version rejected');
RESET ROLE;
UPDATE public.drivers SET hire_date='2026-02-15' WHERE id='a9500000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT is((SELECT (value->>'is_current')::boolean FROM jsonb_array_elements(public.payroll_preparation_read(2026,2)->'bases') WHERE value->>'driver_id'='a9500000-0000-4000-8000-000000000005'),false,'Employment edit invalidates the reviewed basis');
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('basis_save',basis_payload||'{"expectedVersion":1}') FROM payroll_fixture$$,'P0001','PAY_EMPLOYMENT_SNAPSHOT_CHANGED','Stale employment dates cannot be reapproved silently');
UPDATE payroll_fixture SET basis_payload=basis_payload||'{"expectedVersion":1,"employedFrom":"2026-02-15"}';
SELECT public.payroll_preparation_mutate('basis_save',basis_payload) FROM payroll_fixture;
SELECT lives_ok($$SELECT pg_temp.prepare_driver('a9500000-0000-4000-8000-000000000005','2026-02-15','2026-02-28')$$,'Only employed calendar days are required');
SELECT is((SELECT count(*)::integer FROM public.driver_attendance WHERE driver_id='a9500000-0000-4000-8000-000000000005'),14,'No pre-hire attendance records are generated');
SELECT public.payroll_preparation_mutate('rule_save','{"driverId":"a9500000-0000-4000-8000-000000000010","category":"sponsored_type2","effectiveDate":"2026-02-28","workingDaysTarget":28,"targetOrders":300,"packageAmount":3200,"thresholdOrders":400,"carRentDeduction":1700,"minimumNetFloor":0,"note":"Reviewed one-day employee contract"}');
SELECT public.payroll_preparation_mutate('rule_save','{"driverId":"a9500000-0000-4000-8000-000000000011","category":"freelancer","effectiveDate":"2026-02-01","workingDaysTarget":28,"targetOrders":0,"baseSalary":500,"bonusRate":0,"deductionRate":0,"bonusCap":0,"deductionCap":0,"minimumNetFloor":0,"note":"Suspended employee owed agreed pay"}');
SELECT public.payroll_preparation_mutate('rule_save','{"driverId":"a9500000-0000-4000-8000-000000000016","category":"freelancer","effectiveDate":"2026-02-01","workingDaysTarget":28,"targetOrders":100,"baseSalary":2000,"bonusRate":2,"deductionRate":1,"bonusCap":100,"deductionCap":100,"minimumNetFloor":0,"note":"Reviewed partial freelancer contract"}');
SELECT public.payroll_preparation_mutate('basis_save',jsonb_build_object('year',2026,'month',2,'driverId',driver_id,'expectedVersion',0,'ruleId',id,'ruleVersion',version,'employedFrom','2026-02-28','employedTo','2026-02-28','periodBaseAmount',100.25,'periodOrderTarget',1,'periodAbsenceDeduction',0,'periodMinimumFloor',0,'periodPackageThreshold',1,'periodRentDeduction',15.50,'ratesAcknowledged',true,'note','Reviewed one-day package pay explicitly')) FROM public.driver_payroll_rules WHERE driver_id='a9500000-0000-4000-8000-000000000010';
SELECT public.payroll_preparation_mutate('basis_save',jsonb_build_object('year',2026,'month',2,'driverId',driver_id,'expectedVersion',0,'ruleId',id,'ruleVersion',version,'employedFrom','2026-02-01','employedTo','2026-02-10','periodBaseAmount',850.50,'periodOrderTarget',10,'periodAbsenceDeduction',0,'periodMinimumFloor',0,'ratesAcknowledged',true,'note','Reviewed final freelancer period explicitly')) FROM public.driver_payroll_rules WHERE driver_id='a9500000-0000-4000-8000-000000000016';
SELECT pg_temp.prepare_driver('a9500000-0000-4000-8000-000000000010','2026-02-28','2026-02-28');
SELECT pg_temp.prepare_driver('a9500000-0000-4000-8000-000000000011','2026-02-01','2026-02-28');
SELECT pg_temp.prepare_driver('a9500000-0000-4000-8000-000000000016','2026-02-01','2026-02-10');
SELECT throws_ok($$SELECT public.payroll_preparation_mutate('lock',jsonb_build_object('year',2026,'month',2,'expectedVersion',(SELECT preparation_version FROM public.attendance_periods WHERE tenant_id='a9500000-0000-4000-8000-000000000001' AND period_year=2026 AND period_month=2),'note','Do not silently omit unknown employment'))$$,'P0001','PAY_TERMINATION_DATE_REQUIRED','Unknown termination prevents incomplete month approval');
SELECT is((SELECT count(*)::integer FROM public.payroll_period_bases WHERE tenant_id='a9500000-0000-4000-8000-000000000001' AND locked_at IS NOT NULL),0,'Failed period approval rolls back all intermediate snapshots');
RESET ROLE;
UPDATE public.drivers SET termination_date='2026-01-31' WHERE id='a9500000-0000-4000-8000-000000000012';
UPDATE public.drivers SET hire_date='2027-01-01' WHERE id='a9500000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.payroll_preparation_mutate('lock',jsonb_build_object('year',2026,'month',2,'expectedVersion',(SELECT preparation_version FROM public.attendance_periods WHERE tenant_id='a9500000-0000-4000-8000-000000000001' AND period_year=2026 AND period_month=2),'note','Owner verified all actual employed intervals'))$$,'All reviewed employed intervals lock without invented non-working attendance');
SELECT is(jsonb_array_length(public.payroll_calculation_drivers(2026,2)),4,'Calculation includes full, partial, terminated and suspended frozen participants');
SELECT is((SELECT count(*)::integer FROM public.payroll_period_bases WHERE tenant_id='a9500000-0000-4000-8000-000000000001' AND locked_at IS NOT NULL),4,'Every participant gets a frozen rule and employment basis');
SELECT throws_ok($$UPDATE public.payroll_period_bases SET period_base_amount=1 WHERE driver_id='a9500000-0000-4000-8000-000000000005'$$,'42501',NULL,'Browser cannot bypass basis workflow');
RESET ROLE;
SELECT throws_ok($$UPDATE public.payroll_period_bases SET period_base_amount=1 WHERE driver_id='a9500000-0000-4000-8000-000000000005'$$,'P0001','PAY_BASIS_LOCKED','Even privileged caller cannot mutate frozen approved basis');
UPDATE public.drivers SET status='terminated',termination_date='2026-03-20',category='freelancer' WHERE id='a9500000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
UPDATE payroll_fixture SET advance_id=(public.payroll_preparation_mutate('advance_save','{"driverId":"a9500000-0000-4000-8000-000000000005","requestId":"a9500000-0000-4000-8000-000000000017","amount":10,"advanceDate":"2026-02-15","repaymentMonth":"2026-02","reason":"Reviewed partial-period advance"}')->>'id')::uuid;
SELECT public.payroll_preparation_mutate('advance_transition',jsonb_build_object('id',advance_id,'expectedVersion',1,'to','approved','note','Owner approved actual partial advance')) FROM payroll_fixture;
RESET ROLE;
INSERT INTO public.violations(id,tenant_id,driver_id,incident_date,incident_description,status,deduction_amount) VALUES('a9500000-0000-4000-8000-000000000018','a9500000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000005','2026-02-15','Reviewed partial-period violation','resolved',2);
INSERT INTO public.violation_deduction_ledger(tenant_id,driver_id,violation_id,deduction_month,deduction_amount) VALUES('a9500000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000005','a9500000-0000-4000-8000-000000000018','2026-02',2);
SET LOCAL ROLE authenticated;
UPDATE payroll_fixture SET result=public.calculate_payroll_atomic('a9500000-0000-4000-8000-000000000005',2026,2);
SELECT is((SELECT (result->>'base_amount')::numeric FROM payroll_fixture),1234.56::numeric,'Partial base is not prorated again after 14 attendance days');
SELECT is((SELECT (result->>'orders_prorated_target')::integer FROM payroll_fixture),30,'Explicit adjusted target is not prorated again');
SELECT is((SELECT (result->>'net_payroll')::numeric FROM payroll_fixture),1156.89::numeric,'Reviewed absence and frozen rule rates applied once despite later category change');
SELECT is((SELECT period_basis_id IS NOT NULL FROM public.driver_payroll_periods WHERE driver_id='a9500000-0000-4000-8000-000000000005'),true,'Persisted calculation references immutable approved period basis');
SELECT is((public.calculate_payroll_atomic('a9500000-0000-4000-8000-000000000010',2026,2)->>'net_payroll')::numeric,84.75::numeric,'One-day type2 uses explicit package and rent amounts once');
SELECT is((public.calculate_payroll_atomic('a9500000-0000-4000-8000-000000000011',2026,2)->>'net_payroll')::numeric,500::numeric,'Suspended driver actual owed pay is included');
SELECT is((public.calculate_payroll_atomic('a9500000-0000-4000-8000-000000000016',2026,2)->>'net_payroll')::numeric,840.50::numeric,'Terminated freelancer final interval uses reviewed base and rate without double proration');
SELECT is((SELECT value->>'category' FROM jsonb_array_elements(public.payroll_preparation_read(2026,2)->'drivers') WHERE value->>'id'='a9500000-0000-4000-8000-000000000005'),'sponsored_type1','Locked reader shows historical category rather than current category');
SELECT is((SELECT advance_deduction FROM public.driver_payroll_periods WHERE driver_id='a9500000-0000-4000-8000-000000000005'),10::numeric,'Partial basis still includes approved actual advances');
SELECT is((SELECT violations_deduction FROM public.driver_payroll_periods WHERE driver_id='a9500000-0000-4000-8000-000000000005'),2::numeric,'Partial basis still includes pending reviewed violations');
SELECT public.transition_payroll_status_atomic((result->>'id')::uuid,'in_review') FROM payroll_fixture;
SELECT public.transition_payroll_status_atomic((result->>'id')::uuid,'approved') FROM payroll_fixture;
SELECT is((SELECT status::text FROM public.violation_deduction_ledger WHERE violation_id='a9500000-0000-4000-8000-000000000018'),'applied','Partial payroll applies reviewed ledger exactly once');
SELECT public.transition_payroll_status_atomic((result->>'id')::uuid,'cancelled','Owner reviewed partial payroll replacement') FROM payroll_fixture;
SELECT is((SELECT status::text FROM public.violation_deduction_ledger WHERE violation_id='a9500000-0000-4000-8000-000000000018'),'pending','Partial cancellation restores reviewed ledger');
SELECT is((SELECT payroll_period_id FROM public.payroll_advances WHERE id=(SELECT advance_id FROM payroll_fixture)),NULL::uuid,'Partial cancellation clears advance reservation');
SELECT is((public.calculate_payroll_atomic('a9500000-0000-4000-8000-000000000005',2026,2)->>'net_payroll')::numeric,1156.89::numeric,'Partial replacement reuses frozen approved basis without duplicating deductions');
SELECT * FROM finish();ROLLBACK;
