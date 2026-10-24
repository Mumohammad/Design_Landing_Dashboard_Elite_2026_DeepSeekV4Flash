BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(34);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('13600000-0000-4000-8000-000000000001','accounting-pages-owner@example.test','{"_invite_provisioned":true}'),
 ('13600000-0000-4000-8000-000000000002','accounting-pages-foreign@example.test','{"_invite_provisioned":true}'),
 ('13600000-0000-4000-8000-000000000003','accounting-pages-denied@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE accounting_page_tenants(kind text,id uuid);
INSERT INTO accounting_page_tenants VALUES
 ('own',(public.provision_company_atomic('13600000-0000-4000-8000-000000000001','{"name":"Accounting page fixture","slug":"accounting-pages-fixture","domain":"accounting-pages.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('13600000-0000-4000-8000-000000000002','{"name":"Foreign page fixture","slug":"foreign-pages-fixture","domain":"foreign-pages.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN ('13600000-0000-4000-8000-000000000001','13600000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password) SELECT '13600000-0000-4000-8000-000000000003',id,'accounting-pages-denied@example.test','hr_officer','active',false FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.customers(id,tenant_id,name_ar,name_en) SELECT '13600000-0000-4000-8000-000000000011',id,'عميل صفحة','Page customer' FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.suppliers(id,tenant_id,name_ar,name_en) SELECT '13600000-0000-4000-8000-000000000012',id,'مورد صفحة','Page supplier' FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.finance_payments(tenant_id,payment_ref,direction,customer_id,amount,method,payment_date,reference)
 SELECT t.id,'PAGE-'||lpad(i::text,4,'0'),'in','13600000-0000-4000-8000-000000000011',0.10,'cash','2026-10-01','Synthetic' FROM accounting_page_tenants t CROSS JOIN generate_series(1,1005)i WHERE kind='own';
INSERT INTO public.finance_payments(id,tenant_id,payment_ref,direction,customer_id,amount,method,payment_date,reference)
 SELECT '13600000-0000-4000-8000-000000000021',id,'PARTIAL','in','13600000-0000-4000-8000-000000000011',100,'cash','2026-10-02','Literal %_ reference' FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.finance_payments(tenant_id,payment_ref,direction,supplier_id,amount,method,payment_date) SELECT id,'OUTGOING','out','13600000-0000-4000-8000-000000000012',20,'cash','2026-10-02' FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.finance_payments(tenant_id,payment_ref,direction,amount,method,status) SELECT id,'VOIDED','in',999,'cash','void' FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.finance_payments(tenant_id,payment_ref,direction,amount,method) SELECT id,'FOREIGN','in',99999,'cash' FROM accounting_page_tenants WHERE kind='foreign';
INSERT INTO public.receivables(id,tenant_id,customer_id,invoice_ref,invoice_date,due_date,amount,total_amount)
 SELECT '13600000-0000-4000-8000-000000000031',id,'13600000-0000-4000-8000-000000000011','ALLOC-136','2026-10-01','2026-10-01',100,100 FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.payment_allocations(tenant_id,finance_payment_id,receivable_id,allocated_amount)
 SELECT id,'13600000-0000-4000-8000-000000000021','13600000-0000-4000-8000-000000000031',40 FROM accounting_page_tenants WHERE kind='own';
INSERT INTO public.customers(tenant_id,name_ar,name_en) SELECT t.id,'مستورد '||i,'Page option '||lpad(i::text,4,'0') FROM accounting_page_tenants t CROSS JOIN generate_series(1,1005)i WHERE kind='own';
INSERT INTO public.vat_input_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount,vat_recoverability)
 SELECT t.id,1900+(i-1)/12,1+(i-1)%12,'VAT-PAGE-'||lpad(i::text,4,'0'),'1900-01-01'::date+i,0.10,15,0.02,'pending_review' FROM accounting_page_tenants t CROSS JOIN generate_series(1,1205)i WHERE kind='own';
INSERT INTO public.vat_periods(tenant_id,period_year,period_month) SELECT t.id,1900+(i-1)/12,1+(i-1)%12 FROM accounting_page_tenants t CROSS JOIN generate_series(1,1205)i WHERE kind='own';
GRANT SELECT ON accounting_page_tenants TO authenticated;
SELECT ok((SELECT NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.read_my_accounting_page(text,text,integer,integer,uuid,boolean)'::regprocedure),'paged reader is stable security invoker with empty search path');
SELECT ok(NOT has_function_privilege('anon','public.read_my_accounting_page(text,text,integer,integer,uuid,boolean)','execute'),'anonymous execution denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13600000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((public.read_my_accounting_page('payments')->>'total')::int,1008,'payment count includes every own non-deleted payment, not just first 100/200');
SELECT is(jsonb_array_length(public.read_my_accounting_page('payments')->'rows'),25,'server returns a bounded page');
SELECT is(jsonb_array_length(public.read_my_accounting_page('payments','',11,100)->'rows'),8,'records after REST default 1000 remain reachable');
SELECT is(public.read_my_accounting_page('payments')->'summary'->>'inflow','200.50','all receipt cents are aggregated exactly; void and foreign excluded');
SELECT is(public.read_my_accounting_page('payments')->'summary'->>'outflow','20.00','all outgoing payments aggregated');
SELECT is(public.read_my_accounting_page('payments')->'summary'->>'unallocated','180.50','unallocated subtracts real allocations instead of counting whole partial payment');
SELECT is((public.read_my_accounting_page('payments','%_')->>'total')::int,1,'percent and underscore search are literal');
SELECT is((public.read_my_accounting_page('payments','Page customer')->>'total')::int,1006,'party-name search applies on database across pages');
SELECT is(public.read_my_accounting_page('payments','PARTIAL')->'summary'->>'inflow','200.50','whole-tenant KPIs do not shrink with search or page');
SELECT is(jsonb_typeof(public.read_my_accounting_page('payments','PARTIAL')->'rows'->0->'amount'),'string','money transmitted as exact decimal text');
SELECT is(jsonb_array_length(public.read_my_accounting_page('payments','',1,25,NULL,true)->'rows'),1008,'export snapshot includes every matching row beyond 1000');
SELECT is((public.read_my_accounting_page('payments','FOREIGN')->>'total')::int,0,'foreign payments cannot be searched');
SELECT is(public.read_my_accounting_page('open_ar')->'rows'->0->>'outstanding','60.00','allocation picker subtracts pending reservations from available balance');
SELECT is((public.read_my_accounting_page('open_ar','',1,25,'13600000-0000-4000-8000-000000000012')->>'total')::int,0,'allocation choices stay bound to the selected same-tenant party');
SELECT is((public.read_my_accounting_page('customers','',11,100)->>'total')::int,1006,'party choices count all active tenant options');
SELECT is(jsonb_array_length(public.read_my_accounting_page('customers','',11,100)->'rows'),6,'party choices after 1000 reachable');
SELECT is((public.read_my_accounting_page('vat_review')->>'total')::int,1205,'VAT reviews are not capped at oldest 200');
SELECT is(jsonb_array_length(public.read_my_accounting_page('vat_review','',13,100)->'rows'),5,'oldest/newest review rows beyond 1000 reachable');
SELECT is((public.read_my_accounting_page('vat_periods')->>'total')::int,1205,'all VAT periods reachable beyond 24');
SELECT is((public.read_my_accounting_page('vat_recon')->>'total')::int,1205,'all reconciliation months reachable beyond 1000');
SELECT is((public.read_my_accounting_page('vat_recon','2000-05')->>'total')::int,1,'older month selection/search is independent of current page');
SELECT lives_ok($$SELECT public.read_my_accounting_page(kind) FROM unnest(ARRAY['accounts','asset_accounts','trial','vat_output','vat_input','vat_adjustments','vat_months','periods','events','zatca','suppliers','receivables','payables','open_ar','open_ap'])kind$$,'every allowlisted query compiles and retains caller policies');
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments; DROP TABLE users')$$,'22023','Invalid accounting page request','arbitrary read relation rejected');
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments','',1,101)$$,'22023','Invalid accounting page request','oversized page rejected');
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments',repeat('a',201))$$,'22023','Invalid accounting page request','unbounded search rejected');
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments','',0)$$,'22023','Invalid accounting page request','invalid page rejected');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13600000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments')$$,'42501','Accounting read access denied','GM financial reads require MFA assurance');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13600000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments')$$,'42501','Accounting read access denied','non-accounting role denied even with valid session');
RESET ROLE;
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r JOIN accounting_page_tenants t ON t.id=r.tenant_id AND t.kind='own' CROSS JOIN public.permissions p WHERE r.name='hr_officer' AND p.module='accounting' AND p.action='read' ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13600000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT lives_ok($$SELECT public.read_my_accounting_page('payments')$$,'read-only delegated principal can read accounting pages');
SELECT throws_ok($$SELECT public.read_my_accounting_page('payments','',1,25,NULL,true)$$,'42501','Accounting read access denied','read permission alone cannot export');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"13600000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is((public.read_my_accounting_page('payments','PAGE-')->>'total')::int,0,'foreign actor cannot search owner payment rows');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND policyname IN ('sel_bank_accounts_tenant','sel_customers_tenant','sel_suppliers_tenant','sel_finance_payments_tenant','sel_allocations_tenant','sel_payables_tenant','sel_vat_input_tenant','sel_vat_output_tenant','vata_sel_tenant','vatp_sel_tenant','sel_accounting_periods_tenant','sel_financial_events_tenant','sel_zatca_transmissions_tenant') AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles=ARRAY['authenticated']::name[]),13,'initplan optimization preserves SELECT command, authenticated roles and permissive mode');
SELECT * FROM finish();
ROLLBACK;
