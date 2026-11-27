BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();

-- Synthetic, rollback-only evidence. The temporary calculator stand-in uses
-- the real attestor; no production identity, workbook, or bank data is used.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('17000000-0000-4000-8000-000000000001','payroll170-owner@example.test','{"_invite_provisioned":true}'),
 ('17000000-0000-4000-8000-000000000002','payroll170-foreign@example.test','{"_invite_provisioned":true}'),
 ('17000000-0000-4000-8000-000000000003','payroll170-delegate@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE payroll170_tenants(label text PRIMARY KEY,id uuid);
INSERT INTO payroll170_tenants VALUES
 ('own',(public.provision_company_atomic('17000000-0000-4000-8000-000000000001','{"name":"Payroll170","slug":"payroll170","domain":"payroll170.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('17000000-0000-4000-8000-000000000002','{"name":"Foreign payroll170","slug":"payroll170foreign","domain":"payroll170foreign.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN ('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '17000000-0000-4000-8000-000000000003',id,'payroll170-delegate@example.test','readonly_auditor','active',false FROM payroll170_tenants WHERE label='own';
-- A verified synthetic factor makes the shared assurance rule require AAL2
-- for this delegated role as well as for built-in administrator roles.
INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 VALUES('17000000-0000-4000-8000-000000000004','17000000-0000-4000-8000-000000000003','Synthetic rollback-only factor','totp','verified','synthetic-rollback-only',now(),now());
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE r.tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND r.name='readonly_auditor'
 AND ((p.module='payroll' AND p.action IN ('read','create','update','approve')) OR (p.module='accounting' AND p.action='create'))
 ON CONFLICT DO NOTHING;
INSERT INTO public.payroll_engine_items(id,tenant_id,kind,name,amount,apply_to_all,target_rider_ids,installment_enabled,installment_monthly_amount,installment_total_paid,installment_status)
 SELECT '17000000-0000-4000-8000-000000000101',id,'deduction','Synthetic R1 loan',1000,false,ARRAY['R1'],true,100,0,'active' FROM payroll170_tenants WHERE label='own';
INSERT INTO public.payroll_engine_items(id,tenant_id,kind,name,amount,apply_to_all,target_rider_ids,installment_enabled,installment_monthly_amount,installment_total_paid,installment_status)
 SELECT '17000000-0000-4000-8000-000000000102',id,'deduction','Unrelated R2 loan',1000,false,ARRAY['R2'],true,100,0,'active' FROM payroll170_tenants WHERE label='own';
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
 SELECT '17000000-0000-4000-8000-000000000201',id,'990170','رواتب تجريبية','Synthetic salaries','expense','debit' FROM payroll170_tenants WHERE label='own';
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
 SELECT '17000000-0000-4000-8000-000000000202',id,'290170','رواتب مستحقة تجريبية','Synthetic payable','liability','credit' FROM payroll170_tenants WHERE label='own';
CREATE TEMP TABLE payroll170_state(label text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT ON payroll170_tenants TO authenticated;
GRANT SELECT,INSERT ON payroll170_state TO authenticated;

CREATE FUNCTION pg_temp.make_payroll170(p_label text,p_month text,p_platform text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=extensions,public,pg_temp AS $$
DECLARE saved_claims text:=current_setting('request.jwt.claims',true);actor uuid:=auth.uid();t uuid:=public.get_my_tenant_id();revision bigint;
 run_payload jsonb;result_rows jsonb;payload jsonb;run_id uuid;
BEGIN
 revision:=public.read_my_payroll_source_version();
 run_payload:=jsonb_build_object('payroll_month',p_month,'month_key',p_month,'platform_name',p_platform,
  'file_name','synthetic-'||p_label||'.xlsx','file_path',t::text||'/'||p_month||'/'||md5(p_label)::uuid::text||'.xlsx',
  'file_sha256',repeat('a',64),'rule_set_name','Synthetic','rule_snapshot','{}'::jsonb,
  'totals',jsonb_build_object('totalGross',1000,'totalNet',900,'totalPenalties',100,'totalVariance',0,'totalTraffic',0));
 result_rows:=jsonb_build_array(jsonb_build_object('rider_id','R1','driver_name','Synthetic R1',
  'result',jsonb_build_object('contractName','Synthetic','vehicleType','bike','completedOrders',100,'uploadedBasicPayment',900,
   'grossSalaryBeforePenalties',1000,'totalOtherPenalties',100,'trafficViolationsDeduction',0,'finalNetSalary',900,
   'varianceAmount',0,'varianceStatus','ok','reviewStatus','ok','performanceBand','average','exceptionFlag',false),
  'raw_input',jsonb_build_object('riderId','R1')));
 payload:=jsonb_build_object('run',run_payload,'results',result_rows,'exceptions','[]'::jsonb,'income','[]'::jsonb,
  'source',revision,'run_id',NULL,'expected_version',NULL);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.attest_platform_payroll(t,actor,'save',payload,revision);
 PERFORM set_config('request.jwt.claims',saved_claims,true);
 run_id:=public.save_my_platform_payroll(run_payload,result_rows,'[]','[]',revision);
 RETURN run_id;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claims',saved_claims,true);RAISE;
END $$;

CREATE FUNCTION pg_temp.attest_payroll170_approval(p_run_id uuid,p_expected integer,p_changes jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=extensions,public,pg_temp AS $$
DECLARE saved_claims text:=current_setting('request.jwt.claims',true);actor uuid:=auth.uid();t uuid:=public.get_my_tenant_id();revision bigint;payload jsonb;
BEGIN
 revision:=public.read_my_payroll_source_version();
 SELECT jsonb_build_object('run_id',p_run_id,'expected_version',p_expected,'changes',p_changes,'source',revision,
  'results',(SELECT jsonb_agg(r.result ORDER BY r.rider_id COLLATE "C") FROM public.payroll_engine_results r WHERE r.run_id=p_run_id AND r.tenant_id=t)) INTO payload;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.attest_platform_payroll(t,actor,'approve',payload,revision);
 PERFORM set_config('request.jwt.claims',saved_claims,true);RETURN true;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claims',saved_claims,true);RAISE;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
INSERT INTO payroll170_state VALUES('january',to_jsonb(pg_temp.make_payroll170('january','2193-01','HungerStation')));
SELECT is(public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1),NULL::jsonb,'uncommitted approval has no successful recovery receipt');
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000102","installmentTotalPaid":100,"installmentStatus":"active"}]');
SELECT throws_like($$SELECT public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000102","installmentTotalPaid":100,"installmentStatus":"active"}]',public.read_my_payroll_source_version())$$,'PAYENG013:%','an unrelated rider loan cannot be advanced by this run');
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":250,"installmentStatus":"active"}]');
SELECT throws_like($$SELECT public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":250,"installmentStatus":"active"}]',public.read_my_payroll_source_version())$$,'PAYENG013:%','advancement must match the current balance and exact monthly installment');
RESET ROLE;
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000101'),0::numeric,'invalid approval leaves the participant loan unpaid');
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000102'),0::numeric,'invalid approval leaves the unrelated loan unpaid');
SELECT is((SELECT status FROM public.payroll_engine_runs WHERE id=(SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january')),'draft','invalid changes cannot approve the run');

-- Failure after the legacy approval changed the loan must roll back the loan,
-- run version/status, source revision, audit, and durable approval receipt.
CREATE FUNCTION pg_temp.fail_payroll170_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action IN ('platform_payroll_approved_atomic','platform_payroll_journal_atomic') AND NEW.tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') THEN RAISE EXCEPTION 'PAYROLL170_AUDIT_FAILURE'; END IF;RETURN NEW;END $$;
CREATE TRIGGER payroll170_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payroll170_audit();
SET LOCAL ROLE authenticated;
INSERT INTO payroll170_state VALUES('before_failed_approval_source',to_jsonb(public.read_my_payroll_source_version()));
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":100,"installmentStatus":"active"}]');
SELECT throws_ok($$SELECT public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":100,"installmentStatus":"active"}]',public.read_my_payroll_source_version())$$,'P0001','PAYROLL170_AUDIT_FAILURE','required approval audit failure aborts the entire mutation');
SELECT is(public.read_my_payroll_source_version(),(SELECT (value#>>'{}')::bigint FROM payroll170_state WHERE label='before_failed_approval_source'),'failed approval rolls back its source revision');
SELECT is(public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1),NULL::jsonb,'failed audit cannot produce a successful recovery receipt');
RESET ROLE;
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000101'),0::numeric,'required audit failure rolls back installment progress');
SELECT is((SELECT status||':'||version FROM public.payroll_engine_runs WHERE id=(SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january')),'draft:1','required audit failure rolls back status and version');
SELECT is((SELECT count(*)::integer FROM payroll_guard_private.run_receipts WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND request_key LIKE 'approve:%'),0,'failed approval commits no durable approval receipt');
DROP TRIGGER payroll170_audit_failure ON public.audit_log;
SET LOCAL ROLE authenticated;
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":100,"installmentStatus":"active"}]');
SELECT is(public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":100,"installmentStatus":"active"}]',public.read_my_payroll_source_version())->>'advanced','1','one actual participating rider installment is applied');
SELECT is(public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)->>'advanced','1','dropped-response recovery returns the committed advancement');
SELECT is(public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)->>'replayed','true','recovery identifies the original committed approval');
RESET ROLE;
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000101'),100::numeric,'successful January approval applies the installment once');
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000102'),0::numeric,'successful approval never advances an absent rider loan');
SELECT is((SELECT count(*)::integer FROM payroll_guard_private.run_receipts WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND request_key LIKE 'approve:%'),1,'recovery creates no duplicate approval receipt');

CREATE TRIGGER payroll170_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payroll170_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_my_platform_payroll_journal((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),'17000000-0000-4000-8000-000000000201','17000000-0000-4000-8000-000000000202')$$,'P0001','PAYROLL170_AUDIT_FAILURE','required payroll journal audit failure rolls back journal creation and linkage');
RESET ROLE;
SELECT is((SELECT journal_entry_id FROM public.payroll_engine_runs WHERE id=(SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january')),NULL::uuid,'failed journal audit leaves no linked journal or replay pointer');
SELECT is((SELECT count(*)::integer FROM public.journal_entries WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own')),0,'failed journal audit leaves no orphan journal');
SELECT is((SELECT count(*)::integer FROM public.journal_entry_lines WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own')),0,'failed journal audit leaves no orphan lines');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND action='journal_draft_created'),0,'failed payroll audit rolls back the inner journal audit too');
SELECT is((SELECT count(*)::integer FROM payroll_guard_private.run_receipts WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND request_key LIKE 'approve:%'),1,'journal failure cannot create another successful approval receipt');
DROP TRIGGER payroll170_audit_failure ON public.audit_log;

SET LOCAL ROLE authenticated;
INSERT INTO payroll170_state VALUES('same_month_other_platform',to_jsonb(pg_temp.make_payroll170('same-month-keeta','2193-01','Keeta')));
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='same_month_other_platform'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":200,"installmentStatus":"active"}]');
SELECT throws_like($$SELECT public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='same_month_other_platform'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":200,"installmentStatus":"active"}]',public.read_my_payroll_source_version())$$,'PAYENG014:%','another platform cannot apply the same rider installment twice in one month');
RESET ROLE;
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000101'),100::numeric,'same-month rejection preserves the exact installment balance');
SET LOCAL ROLE authenticated;
INSERT INTO payroll170_state VALUES('february',to_jsonb(pg_temp.make_payroll170('february','2193-02','HungerStation')));
SELECT pg_temp.attest_payroll170_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='february'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":200,"installmentStatus":"active"}]');
SELECT is(public.approve_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='february'),1,'[{"table":"items","id":"17000000-0000-4000-8000-000000000101","installmentTotalPaid":200,"installmentStatus":"active"}]',public.read_my_payroll_source_version())->>'advanced','1','next month advances the same rider by exactly one installment');
SELECT throws_like($$SELECT public.cancel_my_platform_payroll((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),'Synthetic old-period cancellation')$$,'PAYENG015:%','out-of-order cancellation cannot erase later approved installment progress');
RESET ROLE;
SELECT is((SELECT installment_total_paid FROM public.payroll_engine_items WHERE id='17000000-0000-4000-8000-000000000101'),200::numeric,'rejected old-period cancellation preserves both approved installments');
SELECT is((SELECT status FROM public.payroll_engine_runs WHERE id=(SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january')),'approved','rejected old-period cancellation leaves the prior run approved');

-- Recovery is a protected read: receipts cannot bypass current tenant, MFA,
-- active membership, or a permission that has since been revoked.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_like($$SELECT public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)$$,'PAYENG002:%','foreign tenant cannot recover another tenant approval receipt');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT throws_like($$SELECT public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)$$,'PAYENG010:%','MFA is required even to recover an earlier successful approval');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is(public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)->>'replayed','true','current authorized caller can recover after subsequent source changes');
RESET ROLE;
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND name='readonly_auditor') AND permission_id IN (SELECT id FROM public.permissions WHERE module='payroll' AND action='approve');
SET LOCAL ROLE authenticated;
SELECT throws_like($$SELECT public.read_my_platform_payroll_approval((SELECT (value#>>'{}')::uuid FROM payroll170_state WHERE label='january'),1)$$,'PAYENG010:%','revoked approver cannot recover a historical successful receipt');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM payroll_guard_private.run_receipts WHERE tenant_id=(SELECT id FROM payroll170_tenants WHERE label='own') AND request_key LIKE 'approve:%'),2,'denied and recovered reads never duplicate or remove the two committed approvals');
SELECT * FROM finish();
ROLLBACK;
