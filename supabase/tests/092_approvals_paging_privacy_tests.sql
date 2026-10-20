BEGIN;
SELECT plan(41);
INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data)
VALUES('92000000-0000-4000-8000-000000000001','queue-092@example.test','synthetic','{"_invite_provisioned":true}');
CREATE TEMP TABLE approval_company AS SELECT (public.provision_company_atomic('92000000-0000-4000-8000-000000000001',
 '{"name":"Approval queue tests","slug":"approvals-092","domain":"approvals-092.test"}')->>'id')::uuid id;
INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data)
VALUES('92000000-0000-4000-8000-000000000006','queue-accountant-092@example.test','synthetic','{"_invite_provisioned":true}');
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password)
SELECT '92000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000006',id,'queue-accountant-092@example.test','accountant','active',false FROM approval_company;
GRANT SELECT ON approval_company TO authenticated;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='92000000-0000-4000-8000-000000000001';
INSERT INTO public.tenants(id,name_ar,name_en) VALUES('92000000-0000-4000-8000-000000000002','مستأجر آخر','Another queue tenant');
INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date,vendor,created_at)
SELECT md5('approval-092-'||i)::uuid,c.id,'fuel',0.1,CURRENT_DATE,
 CASE WHEN i=105 THEN 'Literal %_أحمد' ELSE 'Vendor' END,'2020-01-01T00:00:00Z'::timestamptz FROM generate_series(1,105) i CROSS JOIN approval_company c;
INSERT INTO public.expenses(tenant_id,expense_type,amount,expense_date,vendor)
VALUES('92000000-0000-4000-8000-000000000002','fuel',99,CURRENT_DATE,'Foreign vendor');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date)
SELECT '92000000-0000-4000-8000-000000000003',id,'سائق اختباري','0500000000','freelancer','active',CURRENT_DATE-400 FROM approval_company;
INSERT INTO public.leave_types(id,tenant_id,code,name_ar,name_en,days_per_year)
SELECT '92000000-0000-4000-8000-000000000004',id,'annual','سنوية','Annual',30 FROM approval_company;
INSERT INTO public.driver_leave_requests(tenant_id,driver_id,leave_type_id,start_date,end_date,days_requested,status)
SELECT id,'92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000004',CURRENT_DATE+7,CURRENT_DATE+7,1,'pending' FROM approval_company;
INSERT INTO public.driver_applications(id,tenant_id,application_number,first_name,last_name,full_name,mobile,identity_type,identity_number,work_type,status,city)
SELECT '92000000-0000-4000-8000-000000000005',id,'DRV-2092-900001','سعيد','Saleh','سعيد أحمد Saleh','0501112222','iqama','sensitive-identity','full_time','submitted','Riyadh' FROM approval_company;

SELECT ok((SELECT prosecdef AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer)'::regprocedure),'paged queue is definer with empty search path');
SELECT ok(NOT has_function_privilege('anon','public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer)','execute'),'anon cannot call paged queue');
SELECT ok(has_function_privilege('authenticated','public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer)','execute'),'authenticated can call guarded paged queue');
SELECT ok(NOT has_function_privilege('authenticated','public.pending_approval_rows(uuid,text,timestamptz,timestamptz)','execute'),'browser cannot call private unbounded source');
SELECT ok(NOT has_function_privilege('service_role','public.pending_approval_rows(uuid,text,timestamptz,timestamptz)','execute'),'service API cannot call private source');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
CREATE TEMP TABLE queue_pages AS SELECT public.fetch_pending_approvals_page(id) page_one,
 public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'',2) page_two,
 public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'',999) page_last FROM approval_company;
SELECT is((SELECT (page_one->'kpis'->>'total')::int FROM queue_pages),107,'exact total includes all three sources beyond 100');
SELECT is((SELECT (page_one->'kpis'->>'expenses')::int FROM queue_pages),105,'expense KPI covers whole filtered queue');
SELECT is((SELECT (page_one->'kpis'->>'leaves')::int FROM queue_pages),1,'leave KPI included');
SELECT is((SELECT (page_one->'kpis'->>'applications')::int FROM queue_pages),1,'application KPI included');
SELECT is((SELECT (page_one->'kpis'->>'stale')::int FROM queue_pages),105,'stale count spans all pages');
SELECT is((SELECT jsonb_array_length(page_one->'rows') FROM queue_pages),50,'first page bounded');
SELECT is((SELECT jsonb_array_length(page_two->'rows') FROM queue_pages),50,'second page bounded');
SELECT is((SELECT jsonb_array_length(page_last->'rows') FROM queue_pages),7,'last page has remaining rows');
SELECT is((SELECT (page_last->>'page')::int FROM queue_pages),3,'out-of-range page clamps to current last page');
SELECT is((SELECT count(DISTINCT r->>'item_id')::int FROM queue_pages p CROSS JOIN LATERAL jsonb_array_elements((p.page_one->'rows')||(p.page_two->'rows')||(p.page_last->'rows')) r),107,'stable tie-breaking pages contain every row exactly once');
SELECT is((SELECT public.fetch_pending_approvals_page(id)->'rows' FROM approval_company),(SELECT page_one->'rows' FROM queue_pages),'same timestamp ordering is repeatable');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'Literal %_أحمد')->'kpis'->>'total')::int FROM approval_company),1,'percent and underscore search are literal');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'سعيد')->'kpis'->>'total')::int FROM approval_company),0,'hidden applicant name cannot be inferred by search counts');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'0501112222')->'kpis'->>'total')::int FROM approval_company),0,'mobile is not searchable');
SELECT is((SELECT public.fetch_pending_approvals_page(id,'application')->'rows'->0->'subject_meta'->>'full_name' FROM approval_company),'س. أ. S.','application initials are projected at database boundary');
SELECT ok((SELECT public.fetch_pending_approvals_page(id,'application')::text !~ 'سعيد|أحمد|Saleh|0501112222|sensitive-identity' FROM approval_company),'wire payload contains no hidden applicant identity');
SELECT is((SELECT subject_meta->>'full_name' FROM public.fetch_pending_approvals((SELECT id FROM approval_company),'application')),'س. أ. S.','legacy queue clients receive safe initials too');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,'expense')->'kpis'->>'total')::int FROM approval_company),105,'type filter counts full queue');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,'2026-01-01',NULL)->'kpis'->>'total')::int FROM approval_company),2,'date filter excludes old expenses');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,'2020-01-01T00:00:00Z')->'kpis'->>'total')::int FROM approval_company),105,'inclusive upper date boundary');
SELECT is((SELECT count(*)::int FROM public.fetch_pending_approvals((SELECT id FROM approval_company),NULL,NULL,NULL,100000)),100,'legacy hard cap enforced against a genuine queue larger than 100');
SELECT is((SELECT count(*)::int FROM public.fetch_pending_approvals((SELECT id FROM approval_company),NULL,NULL,NULL,0)),1,'legacy nonpositive cap safely returns one row');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'',1,999)->>'pageSize')::int FROM approval_company),100,'page size capped at 100');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'',-1,0)->>'pageSize')::int FROM approval_company),1,'nonpositive page size clamps safely');
SELECT is((public.fetch_pending_approvals_page('92000000-0000-4000-8000-000000000002')->'kpis'->>'total')::int,0,'tenant argument cannot cross caller tenant');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,'invalid')->'kpis'->>'total')::int FROM approval_company),0,'unsupported type cannot broaden visibility');
SELECT is((SELECT (public.fetch_pending_approvals_page(id,NULL,NULL,NULL,'no matching item')->'kpis'->>'total')::int FROM approval_company),0,'genuine empty filter returns exact zero');
RESET ROLE;
UPDATE public.users SET must_change_password=true WHERE auth_user_id='92000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),0,'forced password requirement blocks queue at AAL2');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN approval_company c ON r.tenant_id=c.id WHERE r.name='accountant');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000006","aal":"aal2"}',true);
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),0,'no module approve grants gives no queue');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.roles(tenant_id,name,name_ar,name_en)
SELECT id,'accountant','محاسب','Accountant' FROM approval_company ON CONFLICT(tenant_id,name) WHERE deleted_at IS NULL DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.roles r JOIN approval_company c ON c.id=r.tenant_id CROSS JOIN public.permissions p
WHERE r.name='accountant' AND r.deleted_at IS NULL AND p.module='hr' AND p.action='approve';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000006","aal":"aal2"}',true);
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),1,'HR-only approver sees just application');
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'expenses')::int FROM approval_company),0,'HR-only total reveals no expense count');
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'leaves')::int FROM approval_company),0,'HR-only total reveals no leave count');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET status='inactive' WHERE auth_user_id='92000000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000006","aal":"aal2"}',true);
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),0,'inactive caller denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET status='active',locked_until=now()+interval '1 hour' WHERE auth_user_id='92000000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000006","aal":"aal2"}',true);
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),0,'locked caller denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92000000-0000-4000-8000-000000000099","aal":"aal2"}',true);
SELECT is((SELECT (public.fetch_pending_approvals_page(id)->'kpis'->>'total')::int FROM approval_company),0,'unknown caller denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.fetch_pending_approvals_page('92000000-0000-4000-8000-000000000002')$$,'42501',NULL,'anonymous API invocation denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
