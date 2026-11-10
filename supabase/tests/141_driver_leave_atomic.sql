BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('14100000-0000-4000-8000-000000000001','leave-owner@example.test','{"_invite_provisioned":true}'),('14100000-0000-4000-8000-000000000002','leave-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE leave_tenants(label text,id uuid);
INSERT INTO leave_tenants VALUES('own',(public.provision_company_atomic('14100000-0000-4000-8000-000000000001','{"name":"Leave fixture","slug":"leave-workflow-fixture","domain":"leave-workflow.example.test"}')->>'id')::uuid),('foreign',(public.provision_company_atomic('14100000-0000-4000-8000-000000000002','{"name":"Foreign leave fixture","slug":"foreign-leave-workflow","domain":"foreign-leave.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('14100000-0000-4000-8000-000000000001','14100000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date) SELECT '14100000-0000-4000-8000-000000000011',id,'Leave driver fixture','0501410001','freelancer','active','2020-01-01' FROM leave_tenants WHERE label='own';
INSERT INTO public.leave_types(id,tenant_id,code,name_ar,name_en,days_per_year) SELECT '14100000-0000-4000-8000-000000000021',id,'workflow_fixture','إجازة اختبار','Workflow fixture',0 FROM leave_tenants WHERE label='own';
CREATE TEMP TABLE leave_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON leave_results,leave_tenants TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
INSERT INTO leave_results VALUES('future',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000011","client_request_id":"14100000-0000-4000-8000-000000000031","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2098-01-01","end_date":"2098-01-02","reason":"Synthetic request"}'));
SELECT is((SELECT (result->>'version')::int FROM leave_results WHERE label='future'),1,'new request has a reviewed optimistic version');
SELECT is((public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000011","client_request_id":"14100000-0000-4000-8000-000000000031","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2098-01-01","end_date":"2098-01-02","reason":"Synthetic request"}')->>'id'),(SELECT result->>'id' FROM leave_results WHERE label='future'),'create retry returns the same saved request');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='future') AND action='leave_create'),1::bigint,'create retry does not duplicate audit history');
SELECT throws_ok($$UPDATE public.driver_leave_requests SET reason='Bypass' WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='future')$$,'42501',NULL,'direct client write cannot bypass version and audit');
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000011","client_request_id":"14100000-0000-4000-8000-000000000032","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2098-01-02","end_date":"2098-01-03","reason":"Overlapping request"}')$$,'P0001','LEAVE_OVERLAP','overlapping pending leave cannot be created');
UPDATE leave_results SET result=public.mutate_driver_leave('edit','{"leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2098-01-03","end_date":"2098-01-04","reason":"Changed reviewed dates"}',(result->>'id')::uuid,(result->>'version')::int) WHERE label='future';
SELECT is((SELECT start_date FROM public.driver_leave_requests WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='future')),'2098-01-03'::date,'pending dates persist through caller edit');
SELECT throws_ok($$SELECT public.mutate_driver_leave('approved','{"reason":"Old editor decision"}',(result->>'id')::uuid,1) FROM leave_results WHERE label='future'$$,'P0001','LEAVE_STALE','review of old dates cannot approve edited leave');
UPDATE leave_results SET result=public.mutate_driver_leave('cancel','{"reason":"Withdraw pending leave"}',(result->>'id')::uuid,(result->>'version')::int) WHERE label='future';
SELECT ok((SELECT status='cancelled' AND deleted_at IS NULL AND cancelled_by=auth.uid() FROM public.driver_leave_requests WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='future')),'cancellation retains visible source and actor evidence');
UPDATE leave_results SET result=public.mutate_driver_leave('restore','{"reason":"Restore reviewed request"}',(result->>'id')::uuid,(result->>'version')::int) WHERE label='future';
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='future'),'pending','restored cancellation returns to pending');
UPDATE leave_results SET result=public.mutate_driver_leave('approved','{"reason":"Approve future leave"}',(result->>'id')::uuid,(result->>'version')::int) WHERE label='future';
SELECT is((SELECT status::text FROM public.drivers WHERE id='14100000-0000-4000-8000-000000000011'),'active','future approval does not immediately change current driver operations');
SELECT throws_ok($$SELECT public.mutate_driver_leave('cancel','{"reason":"Rewrite final leave"}',(result->>'id')::uuid,(result->>'version')::int) FROM leave_results WHERE label='future'$$,'P0001','LEAVE_ALREADY_DECIDED','approved source cannot be cancelled through pending workflow');
INSERT INTO leave_results VALUES('today',public.mutate_driver_leave('create',jsonb_build_object('driver_id','14100000-0000-4000-8000-000000000011','client_request_id','14100000-0000-4000-8000-000000000033','leave_type_id','14100000-0000-4000-8000-000000000021','start_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,'end_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,'reason','Current approved leave')));
UPDATE leave_results SET result=public.mutate_driver_leave('approved','{"reason":"Approve current leave"}',(result->>'id')::uuid,(result->>'version')::int) WHERE label='today';
SELECT is((SELECT status::text FROM public.drivers WHERE id='14100000-0000-4000-8000-000000000011'),'on_leave','current approval and driver status commit together');
INSERT INTO leave_results VALUES('audit_fault',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000011","client_request_id":"14100000-0000-4000-8000-000000000034","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2098-02-01","end_date":"2098-02-01","reason":"Audit rollback fixture"}'));
RESET ROLE;
CREATE FUNCTION pg_temp.fail_leave_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='leave_rejected' THEN RAISE EXCEPTION 'Synthetic leave audit fault';END IF;RETURN NEW;END;$$;
CREATE TRIGGER fail_leave_review_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_leave_review_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.mutate_driver_leave('rejected','{"reason":"Reject audit fixture"}',(result->>'id')::uuid,(result->>'version')::int) FROM leave_results WHERE label='audit_fault'$$,'P0001','Synthetic leave audit fault','audit failure aborts the whole decision');
SELECT is((SELECT status::text FROM public.driver_leave_requests WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='audit_fault')),'pending','failed audit leaves pending source intact');
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.mutate_driver_leave('rejected','{"reason":"Foreign tenant decision"}',(result->>'id')::uuid,(result->>'version')::int) FROM leave_results WHERE label='audit_fault'$$,'P0001','LEAVE_NOT_FOUND','foreign tenant cannot decide another request');
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.mutate_driver_leave('rejected','{"reason":"No MFA decision"}',(result->>'id')::uuid,(result->>'version')::int) FROM leave_results WHERE label='audit_fault'$$,'42501','LEAVE_FORBIDDEN','owner without required MFA cannot reach any record');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.driver_leave_requests SET status='rejected' WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='audit_fault')$$,'42501','LEAVE_CALLER_REQUIRED','old service write cannot bypass the caller workflow');
RESET ROLE;
SELECT throws_ok($$UPDATE public.driver_leave_requests SET reason='Mutate history' WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='future')$$,'P0001','LEAVE_HISTORY_IMMUTABLE','even trusted direct rewrite cannot change final leave history');
-- Allowance policy is serialized by driver and does not rely on unmaintained
-- balances to discover newly created reservations. All fixtures remain rollback-only.
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date)
 SELECT ('14100000-0000-4000-8000-0000000000'||n)::uuid,t.id,'Allowance fixture '||n,'05014100'||n,'freelancer','active',CASE WHEN n=17 THEN '2097-01-01'::date ELSE '2020-01-01'::date END
 FROM leave_tenants t CROSS JOIN generate_series(12,17) n WHERE t.label='own';
INSERT INTO public.leave_types(id,tenant_id,code,name_ar,name_en,days_per_year)
 SELECT ('14100000-0000-4000-8000-0000000000'||n)::uuid,t.id,code,code,code,cap
 FROM leave_tenants t CROSS JOIN (VALUES(22,'annual',0),(23,'capped_fixture',5),(24,'sick',1)) types(n,code,cap) WHERE t.label='own';
-- A matching balance may describe these same historic approved days; count its
-- used-days floor once, not once as a balance and once again as a request.
INSERT INTO public.driver_leave_requests(tenant_id,driver_id,leave_type_id,start_date,end_date,days_requested,status)
 SELECT id,'14100000-0000-4000-8000-000000000013','14100000-0000-4000-8000-000000000022','2098-03-01','2098-03-10',10,'approved' FROM leave_tenants WHERE label='own';
INSERT INTO public.driver_leave_balances(tenant_id,driver_id,leave_type_id,year,used_days,pending_days)
 SELECT id,'14100000-0000-4000-8000-000000000013','14100000-0000-4000-8000-000000000022',2098,10,0 FROM leave_tenants WHERE label='own';
INSERT INTO public.driver_leave_balances(tenant_id,driver_id,leave_type_id,year,used_days,pending_days)
 SELECT id,'14100000-0000-4000-8000-000000000014','14100000-0000-4000-8000-000000000022',2098,0,29 FROM leave_tenants WHERE label='own';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT ok(NOT has_function_privilege('authenticated','driver_operations_private.leave_allowance_error(uuid,uuid,date,integer,uuid)','EXECUTE'),'private allowance checker cannot become a caller authorization bypass');
INSERT INTO leave_results VALUES('annual',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000012","client_request_id":"14100000-0000-4000-8000-000000000041","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-01-01","end_date":"2098-01-20","reason":"Annual pending fixture"}'));
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000012","client_request_id":"14100000-0000-4000-8000-000000000042","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-02-01","end_date":"2098-02-20","reason":"Second annual fixture"}')$$,'P0001','LEAVE_POLICY_REVIEW','annual catalog zero still enforces entitlement across pending requests without balance rows');
SELECT is((SELECT sum(days_requested)::integer FROM public.driver_leave_requests WHERE driver_id='14100000-0000-4000-8000-000000000012'),20,'denied over-allocation leaves the first reservation unchanged');
UPDATE leave_results SET result=public.mutate_driver_leave('edit','{"leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-01-01","end_date":"2098-01-30","reason":"Use exact annual entitlement"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='annual';
SELECT is((SELECT (result->>'version')::integer FROM leave_results WHERE label='annual'),2,'allowance replacement excludes the old request and increments version once');
UPDATE leave_results SET result=public.mutate_driver_leave('cancel','{"reason":"Withdraw exact entitlement"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='annual';
UPDATE leave_results SET result=public.mutate_driver_leave('restore','{"reason":"Restore exact entitlement"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='annual';
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='annual'),'pending','restore does not double count its retained cancelled record');
UPDATE leave_results SET result=public.mutate_driver_leave('approved','{"reason":"Approve reserved entitlement"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='annual';
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='annual'),'approved','approval counts the existing pending reservation once');
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000017","client_request_id":"14100000-0000-4000-8000-000000000043","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-01-01","end_date":"2098-01-22","reason":"New hire entitlement fixture"}')$$,'P0001','LEAVE_POLICY_REVIEW','existing 21-day annual entitlement applies before five hire years');
INSERT INTO leave_results VALUES('annual_history',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000013","client_request_id":"14100000-0000-4000-8000-000000000044","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-04-01","end_date":"2098-04-20","reason":"Historic approval reconciliation"}'));
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='annual_history'),'pending','matching recorded use and historical approvals are counted once');
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000013","client_request_id":"14100000-0000-4000-8000-000000000045","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-05-01","end_date":"2098-05-01","reason":"Exceed historical used entitlement"}')$$,'P0001','LEAVE_POLICY_REVIEW','historic approved leave remains charged while reserving new pending days');
INSERT INTO leave_results VALUES('opaque_pending',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000014","client_request_id":"14100000-0000-4000-8000-000000000046","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-06-01","end_date":"2098-06-01","reason":"Recorded pending floor fixture"}'));
UPDATE leave_results SET result=public.mutate_driver_leave('edit','{"leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-06-01","end_date":"2098-06-02","reason":"Replace actual pending reservation"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='opaque_pending';
SELECT throws_ok($$SELECT public.mutate_driver_leave('edit','{"leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-06-01","end_date":"2098-07-01","reason":"Over-limit replacement fixture"}',(result->>'id')::uuid,(result->>'version')::integer) FROM leave_results WHERE label='opaque_pending'$$,'P0001','LEAVE_POLICY_REVIEW','replacement over entitlement fails even with a recorded pending floor');
SELECT is((SELECT (result->>'version')::integer FROM leave_results WHERE label='opaque_pending'),2,'failed allowance edit does not consume the reviewed version');
RESET ROLE;
SELECT is((SELECT pending_days::integer FROM public.driver_leave_balances WHERE driver_id='14100000-0000-4000-8000-000000000014'),29,'workflow does not release or rewrite opaque recorded pending reservations');
-- Recorded use with no matching requests must still reduce available entitlement.
INSERT INTO public.driver_leave_balances(tenant_id,driver_id,leave_type_id,year,used_days,pending_days)
 SELECT id,'14100000-0000-4000-8000-000000000017','14100000-0000-4000-8000-000000000022',2098,20,0 FROM leave_tenants WHERE label='own';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000017","client_request_id":"14100000-0000-4000-8000-000000000047","leave_type_id":"14100000-0000-4000-8000-000000000022","start_date":"2098-08-01","end_date":"2098-08-02","reason":"Unrepresented historic used days"}')$$,'P0001','LEAVE_POLICY_REVIEW','recorded approved use without retained request rows remains an entitlement floor');
INSERT INTO leave_results VALUES('capped',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000015","client_request_id":"14100000-0000-4000-8000-000000000048","leave_type_id":"14100000-0000-4000-8000-000000000023","start_date":"2098-08-01","end_date":"2098-08-05","reason":"Configured cap fixture"}'));
RESET ROLE;
UPDATE public.leave_types SET days_per_year=4 WHERE id='14100000-0000-4000-8000-000000000023';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.mutate_driver_leave('approved','{"reason":"Review changed yearly cap"}',(result->>'id')::uuid,(result->>'version')::integer) FROM leave_results WHERE label='capped'$$,'P0001','LEAVE_POLICY_REVIEW','final approval rechecks a configured cap changed since creation');
SELECT ok((SELECT status='pending' AND workflow_version=1 AND reviewed_at IS NULL FROM public.driver_leave_requests WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='capped')),'failed approval retains pending state and exact reviewed version');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='capped') AND action='leave_approved'),0::bigint,'failed allowance approval writes no decision audit');
INSERT INTO leave_results VALUES('sick',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000016","client_request_id":"14100000-0000-4000-8000-000000000049","leave_type_id":"14100000-0000-4000-8000-000000000024","start_date":"2098-01-01","end_date":"2098-04-30","reason":"Existing sick policy fixture"}'));
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='sick'),'pending','existing sick 120-day branch remains independent of catalog cap');
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000016","client_request_id":"14100000-0000-4000-8000-000000000050","leave_type_id":"14100000-0000-4000-8000-000000000024","start_date":"2098-05-01","end_date":"2098-05-01","reason":"Exceed existing sick policy"}')$$,'P0001','LEAVE_POLICY_REVIEW','pending sick requests reserve the full existing yearly policy window');
INSERT INTO leave_results VALUES('update_only',public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000015","client_request_id":"14100000-0000-4000-8000-000000000051","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2099-01-01","end_date":"2099-01-02","reason":"Update-only permission fixture"}'));
RESET ROLE;
-- Reuse the synthetic actor with a real restricted tenant role: no GM bypass.
INSERT INTO public.roles(tenant_id,name,name_ar,name_en,is_system_role) SELECT id,'readonly_auditor','Leave editor fixture','Leave editor fixture',false FROM leave_tenants WHERE label='own' ON CONFLICT DO NOTHING;
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN leave_tenants t ON t.id=r.tenant_id AND t.label='own' WHERE r.name='readonly_auditor');
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN leave_tenants t ON t.id=r.tenant_id AND t.label='own' CROSS JOIN public.permissions p WHERE r.name='readonly_auditor' AND p.module='attendance' AND p.action IN('read','update');
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET role='readonly_auditor' WHERE auth_user_id='14100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT ok(public.user_has_permission('attendance','update') AND NOT public.user_has_permission('attendance','create'),'permission fixture has update without create');
UPDATE leave_results SET result=public.mutate_driver_leave('edit','{"leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2099-01-01","end_date":"2099-01-03","reason":"Authorized restricted editor"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='update_only';
SELECT is((SELECT (result->>'version')::integer FROM leave_results WHERE label='update_only'),2,'attendance update alone permits a policy-checked edit');
UPDATE leave_results SET result=public.mutate_driver_leave('cancel','{"reason":"Restricted editor cancellation"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='update_only';
UPDATE leave_results SET result=public.mutate_driver_leave('restore','{"reason":"Restricted editor restoration"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='update_only';
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='update_only'),'pending','attendance update alone permits a policy-checked restoration');
SELECT throws_ok($$SELECT public.mutate_driver_leave('create','{"driver_id":"14100000-0000-4000-8000-000000000015","client_request_id":"14100000-0000-4000-8000-000000000052","leave_type_id":"14100000-0000-4000-8000-000000000021","start_date":"2099-02-01","end_date":"2099-02-01","reason":"Restricted unauthorized create"}')$$,'42501','LEAVE_FORBIDDEN','fixing edit permission does not grant request creation');
SELECT throws_ok($$SELECT public.mutate_driver_leave('approved','{"reason":"Restricted unauthorized approval"}',(result->>'id')::uuid,(result->>'version')::integer) FROM leave_results WHERE label='update_only'$$,'42501','LEAVE_FORBIDDEN','update permission does not grant leave approval');
RESET ROLE;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN leave_tenants t ON t.id=r.tenant_id AND t.label='own' CROSS JOIN public.permissions p WHERE r.name='readonly_auditor' AND p.module='attendance' AND p.action='approve';
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN leave_tenants t ON t.id=r.tenant_id AND t.label='own' WHERE r.name='readonly_auditor') AND permission_id IN(SELECT id FROM public.permissions WHERE module='attendance' AND action='update');
SET LOCAL ROLE authenticated;
SELECT ok(public.user_has_permission('attendance','approve') AND NOT public.user_has_permission('attendance','create') AND NOT public.user_has_permission('attendance','update'),'approval fixture has approve without create or update');
UPDATE leave_results SET result=public.mutate_driver_leave('approved','{"reason":"Authorized restricted approver"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='update_only';
SELECT is((SELECT result->>'status' FROM leave_results WHERE label='update_only'),'approved','approve-only caller can finalize its policy-checked pending reservation');
RESET ROLE;
-- Approval and the current operational status must roll back together if either
-- audit write fails, even when the approver has no generic driver update grant.
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date) SELECT '14100000-0000-4000-8000-000000000018',id,'Current approval audit fixture','0501410018','freelancer','active','2020-01-01' FROM leave_tenants WHERE label='own';
WITH saved AS (
 INSERT INTO public.driver_leave_requests(tenant_id,driver_id,leave_type_id,start_date,end_date,days_requested,reason)
 SELECT id,'14100000-0000-4000-8000-000000000018','14100000-0000-4000-8000-000000000021',(now() AT TIME ZONE 'Asia/Riyadh')::date,(now() AT TIME ZONE 'Asia/Riyadh')::date,1,'Current approval audit rollback' FROM leave_tenants WHERE label='own' RETURNING id,driver_id,workflow_version,status
) INSERT INTO leave_results SELECT 'approval_audit',jsonb_build_object('id',id,'driver_id',driver_id,'version',workflow_version,'status',status) FROM saved;
CREATE FUNCTION pg_temp.fail_current_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='leave_approved' THEN RAISE EXCEPTION 'Synthetic approval audit fault';END IF;RETURN NEW;END;$$;
CREATE TRIGGER fail_current_leave_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_current_leave_audit();
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.user_has_permission('drivers','update'),'current leave approver has no generic driver update grant');
SELECT throws_ok($$SELECT public.mutate_driver_leave('approved','{"reason":"Current approval audit test"}',(result->>'id')::uuid,(result->>'version')::integer) FROM leave_results WHERE label='approval_audit'$$,'P0001','Synthetic approval audit fault','approval audit failure aborts leave and nested driver status writes');
SELECT ok((SELECT status='pending' AND workflow_version=1 AND reviewed_at IS NULL FROM public.driver_leave_requests WHERE id=(SELECT (result->>'id')::uuid FROM leave_results WHERE label='approval_audit')),'failed approval audit preserves exact pending source version');
RESET ROLE;
SELECT is((SELECT status::text FROM public.drivers WHERE id='14100000-0000-4000-8000-000000000018'),'active','failed approval audit rolls current driver status back');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id='14100000-0000-4000-8000-000000000018' AND action='status_changed'),0::bigint,'failed approval audit rolls nested status audit back');
DROP TRIGGER fail_current_leave_audit ON public.audit_log;
SET LOCAL ROLE authenticated;
UPDATE leave_results SET result=public.mutate_driver_leave('approved','{"reason":"Current restricted approval"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE label='approval_audit';
RESET ROLE;
SELECT is((SELECT status::text FROM public.drivers WHERE id='14100000-0000-4000-8000-000000000018'),'on_leave','attendance approval alone can atomically change current leave operations');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id='14100000-0000-4000-8000-000000000018' AND action='status_changed'),1::bigint,'successful current approval records one nested driver status audit');
-- Historical cancellation used a soft delete. Read access must retain its
-- review context without exposing arbitrary archived pending records or
-- rewriting old rows merely to make the current UI work.
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET role='general_manager' WHERE auth_user_id='14100000-0000-4000-8000-000000000001';
INSERT INTO public.driver_leave_requests(id,tenant_id,driver_id,leave_type_id,start_date,end_date,days_requested,reason,status,deleted_at,reviewed_at)
 SELECT ('14100000-0000-4000-8000-0000000000'||n)::uuid,id,'14100000-0000-4000-8000-000000000011','14100000-0000-4000-8000-000000000021',date '2096-01-01'+n,date '2096-01-01'+n,1,'Retained cancellation fixture',s::public.leave_status,now(),CASE WHEN n=72 THEN now() ELSE NULL END
 FROM leave_tenants CROSS JOIN (VALUES(71,'cancelled'),(72,'cancelled'),(73,'pending')) examples(n,s) WHERE label='own';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.driver_leave_requests WHERE id IN('14100000-0000-4000-8000-000000000071','14100000-0000-4000-8000-000000000072')),2::bigint,'legacy soft-deleted cancellations remain visible to the authorized reviewer');
SELECT is((SELECT count(*) FROM public.driver_leave_requests WHERE id='14100000-0000-4000-8000-000000000073'),0::bigint,'other archived requests remain hidden');
SELECT throws_ok($$SELECT public.mutate_driver_leave('restore','{"reason":"Review finalized cancellation"}','14100000-0000-4000-8000-000000000072',1)$$,'P0001','LEAVE_ALREADY_DECIDED','retained reviewed cancellation cannot reopen a final decision');
SELECT lives_ok($$SELECT public.mutate_driver_leave('restore','{"reason":"Restore retained cancellation"}','14100000-0000-4000-8000-000000000071',1)$$,'legacy unreviewed cancellation can use the normal versioned restore workflow');
SELECT ok((SELECT status='pending' AND deleted_at IS NULL AND workflow_version=2 AND reason='Retained cancellation fixture' FROM public.driver_leave_requests WHERE id='14100000-0000-4000-8000-000000000071'),'restoration preserves original request meaning and increments its reviewed version');
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.driver_leave_requests WHERE id='14100000-0000-4000-8000-000000000072'),0::bigint,'legacy cancellation visibility remains tenant isolated');
SELECT set_config('request.jwt.claims','{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT is((SELECT count(*) FROM public.driver_leave_requests WHERE id='14100000-0000-4000-8000-000000000072'),0::bigint,'legacy cancellation visibility still requires privileged MFA');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.mutate_driver_leave('cancel','{}')$$,'42501',NULL,'anonymous execution is denied');
RESET ROLE;
SELECT * FROM finish();ROLLBACK;
