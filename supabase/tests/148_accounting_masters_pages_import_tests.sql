BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('14800000-0000-4000-8000-000000000001','master-pages@example.test','{"_invite_provisioned":true}'),
('14800000-0000-4000-8000-000000000002','master-pages-foreign@example.test','{"_invite_provisioned":true}'),
('14800000-0000-4000-8000-000000000004','master-legacy@example.test','{"_invite_provisioned":true}'),
('14800000-0000-4000-8000-000000000005','master-init-fault@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE master_page_tenants(label text,id uuid);
INSERT INTO master_page_tenants VALUES
('own',(public.provision_company_atomic('14800000-0000-4000-8000-000000000001','{"name":"Master pages fixture","domain":"masterpages148.example.test","slug":"masterpages148"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('14800000-0000-4000-8000-000000000002','{"name":"Foreign pages fixture","domain":"masterpages148foreign.example.test","slug":"masterpages148foreign"}')->>'id')::uuid),
('legacy','14800000-0000-4000-8000-000000000004'),('initfault','14800000-0000-4000-8000-000000000005');
INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
('14800000-0000-4000-8000-000000000004','Legacy master','Legacy master','master148-legacy'),
('14800000-0000-4000-8000-000000000005','Init fault master','Init fault master','master148-initfault');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
('14800000-0000-4000-8000-000000000004','14800000-0000-4000-8000-000000000004','master-legacy@example.test','general_manager','active',false),
('14800000-0000-4000-8000-000000000005','14800000-0000-4000-8000-000000000005','master-init-fault@example.test','general_manager','active',false);
INSERT INTO public.customers(tenant_id,customer_code,name_ar,name_en,is_active,tax_number,credit_limit)
SELECT t.id,'P148-'||lpad(i::text,5,'0'),CASE WHEN i=1 THEN 'Literal148 %_' ELSE 'عميل '||i END,'Export1201 customer '||i,i%4<>0,CASE WHEN i%3=0 THEN '123456789012345' END,i::numeric/100 FROM master_page_tenants t CROSS JOIN generate_series(1,1201)i WHERE t.label='own';
INSERT INTO public.customers(tenant_id,customer_code,name_ar,name_en) SELECT id,'FOREIGN148','Foreign148','Foreign148' FROM master_page_tenants WHERE label='foreign';
INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
SELECT t.id,(100000+i)::text,'حساب تصدير '||i,'Export1201 account '||i,'asset','debit' FROM master_page_tenants t CROSS JOIN generate_series(1,1201)i WHERE label='own';
CREATE TEMP TABLE master_page_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE master_import_payload(rows jsonb);
INSERT INTO master_import_payload VALUES('[{"account_code":"1000","name_ar":"Skip existing","name_en":"Skip","account_type":"asset","normal_balance":"debit"},{"account_code":"8701","name_ar":"جذر مستورد","name_en":"Imported root","account_type":"asset","normal_balance":"debit","is_active":true,"is_contra":false},{"account_code":"BAD","name_ar":"Invalid","name_en":"Invalid","account_type":"asset","normal_balance":"debit"},{"account_code":"8702","name_ar":"فرع مستورد","name_en":"Imported child","account_type":"asset","normal_balance":"debit","parent_code":"8701"},{"account_code":"8701","name_ar":"Repeated","name_en":"Repeated","account_type":"asset","normal_balance":"debit"}]');
GRANT SELECT ON master_page_tenants,master_import_payload TO authenticated;GRANT SELECT,INSERT ON master_page_results TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((public.read_my_accounting_master_page('customers')->>'total')::int,1201,'complete own party count beyond REST cap');
SELECT is(jsonb_array_length(public.read_my_accounting_master_page('customers','',49,25)->'rows'),1,'last party page beyond 1200 reachable');
SELECT is((public.read_my_accounting_master_page('customers','%_')->>'total')::int,1,'search wildcards are literal');
SELECT is((public.read_my_accounting_master_page('customers','FOREIGN148')->>'total')::int,0,'foreign party excluded');
SELECT is((public.read_my_accounting_master_page('customers','%_')->'summary'->>'total')::int,1201,'global summary unaffected by search');
SELECT is((public.read_my_accounting_master_page('customers')->'summary'->>'active')::int,901,'active KPI covers all rows');
SELECT is((public.read_my_accounting_master_page('customers')->'summary'->>'tax_registered')::int,400,'tax KPI covers all rows');
SELECT is(public.read_my_accounting_master_page('customers')->'summary'->>'avg_credit_limit','6.01','average credit uses exact numeric math');
SELECT is(jsonb_array_length(public.read_my_accounting_master_page('customers','',1,25,true)->'rows'),1201,'party export is complete beyond 1000');
SELECT is(jsonb_array_length(public.read_my_accounting_master_page('accounts','Export1201',1,25,true)->'rows'),1201,'chart export is complete beyond 1000');
SELECT is((public.read_my_accounting_master_page('accounts')->>'total')::int,1229,'account count includes standard and custom chart');
SELECT is((public.read_my_chart_parent_page('asset',NULL,'Export1201',49,25)->>'total')::int,1201,'parent picker searches full catalog');
SELECT is(jsonb_array_length(public.read_my_chart_parent_page('asset',NULL,'Export1201',49,25)->'rows'),1,'parent last page complete');
INSERT INTO master_page_results VALUES('import',public.import_my_chart_accounts((SELECT rows FROM master_import_payload),'14800000-0000-4000-8000-000000000101'));
SELECT is((SELECT(result->>'imported')::int FROM master_page_results WHERE label='import'),2,'partial import accepts valid rows');
SELECT is((SELECT(result->>'skipped')::int FROM master_page_results WHERE label='import'),2,'partial import skips existing and accepted codes');
SELECT is((SELECT jsonb_array_length(result->'errors') FROM master_page_results WHERE label='import'),1,'invalid row has explicit error');
SELECT ok((SELECT result->'errors'->>0 FROM master_page_results WHERE label='import') LIKE 'Row 4:%','import error retains CSV row position');
SELECT is(public.read_my_accounting_master_page('accounts','8702')->'rows'->0->>'parent_code','8701','import resolves earlier accepted parent');
SELECT is(public.import_my_chart_accounts((SELECT rows FROM master_import_payload),'14800000-0000-4000-8000-000000000101'),(SELECT result FROM master_page_results WHERE label='import'),'same import replays original counts and errors');
SELECT throws_ok($$SELECT public.import_my_chart_accounts('[{"account_code":"8751","name_ar":"Different","name_en":"Different","account_type":"asset","normal_balance":"debit"}]','14800000-0000-4000-8000-000000000101')$$,'P0001','MASTER_REQUEST_CONFLICT: request identifier was used for different details','changed import intent rejected');
SELECT throws_ok($$SELECT public.import_my_chart_accounts('[]','14800000-0000-4000-8000-000000000102')$$,'22023','MASTER_INVALID: import requires 1-1000 bounded rows within 512 KiB','empty import rejected');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND action='chart_of_accounts_imported'),1,'partial import has one batch audit');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND action='customer_list_exported' AND(new_values->>'rows')::int=1201),1,'complete export has its database audit');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.import_my_chart_accounts((SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,1001)),'14800000-0000-4000-8000-000000000110')$$,'22023','MASTER_INVALID: import requires 1-1000 bounded rows within 512 KiB','more than 1000 import rows rejected before writes');
SELECT throws_ok($$SELECT public.import_my_chart_accounts(jsonb_build_array(jsonb_build_object('name_ar',repeat('ع',262144))),'14800000-0000-4000-8000-000000000111')$$,'22023','MASTER_INVALID: import requires 1-1000 bounded rows within 512 KiB','UTF8 import ceiling counts bytes');
INSERT INTO master_page_results VALUES('row-bounds',public.import_my_chart_accounts(jsonb_build_array(jsonb_build_object('account_code','8741','name_ar','Oversize parent','name_en','Oversize parent','account_type','asset','normal_balance','debit','parent_code',repeat('1',4096)),jsonb_build_object('account_code','8742','name_ar','Valid bounded row','name_en','Valid bounded row','account_type','asset','normal_balance','debit')),'14800000-0000-4000-8000-000000000112'));
SELECT is((SELECT(result->>'imported')::int FROM master_page_results WHERE label='row-bounds'),1,'oversize row does not discard later valid bounded row');
SELECT is((SELECT result->'errors' FROM master_page_results WHERE label='row-bounds'),'["Row 2: Invalid account details"]'::jsonb,'row character guard returns bounded safe diagnostic');
SELECT throws_ok($$SELECT public.post_my_opening_balances('2091-04-01',jsonb_build_array(jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND account_code='8701'),'debit','1.005','credit',0),jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND account_code='3000'),'debit',0,'credit','1.005')),'14800000-0000-4000-8000-000000000113')$$,'22023','MASTER_INVALID: invalid opening balance line','opening RPC rejects subcent amounts without rounding');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM accounting_master_private.receipts WHERE request_id IN('14800000-0000-4000-8000-000000000110','14800000-0000-4000-8000-000000000111','14800000-0000-4000-8000-000000000113')),0,'whole request validation failures create no receipts');
CREATE FUNCTION pg_temp.master_batch_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.new_values->>'request_id' IN('14800000-0000-4000-8000-000000000103','14800000-0000-4000-8000-000000000104','14800000-0000-4000-8000-000000000105') THEN RAISE EXCEPTION 'synthetic master batch audit failure';END IF;RETURN NEW;END$$;
CREATE TRIGGER synthetic_master_batch_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.master_batch_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.import_my_chart_accounts('[{"account_code":"8711","name_ar":"Rollback","name_en":"Rollback","account_type":"asset","normal_balance":"debit"}]','14800000-0000-4000-8000-000000000103')$$,'P0001','synthetic master batch audit failure','failed batch audit rolls accepted rows back');
SELECT throws_ok($$SELECT public.post_my_opening_balances('2091-04-01',jsonb_build_array(jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND account_code='8701'),'debit',1,'credit',0),jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND account_code='3000'),'debit',0,'credit',1)),'14800000-0000-4000-8000-000000000104')$$,'P0001','synthetic master batch audit failure','opening audit failure rolls posting back');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14800000-0000-4000-8000-000000000005","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.initialize_my_chart_accounts('14800000-0000-4000-8000-000000000105')$$,'P0001','synthetic master batch audit failure','initializer audit failure aborts defaults');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND account_code='8711'),0,'failed import leaves no account');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own')),0,'failed opening leaves no journal');
SELECT is((SELECT count(*)::int FROM public.accounting_periods WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='own') AND period_year=2091 AND period_month=4),0,'failed opening leaves no period');
SELECT is((SELECT count(*)::int FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='initfault')),0,'failed initializer leaves no accounts');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='initfault')),0,'failed initializer leaves no mappings');
SELECT is((SELECT count(*)::int FROM accounting_master_private.receipts WHERE request_id IN('14800000-0000-4000-8000-000000000103','14800000-0000-4000-8000-000000000104','14800000-0000-4000-8000-000000000105')),0,'failed batch operations leave no receipts');
DROP TRIGGER synthetic_master_batch_failure ON public.audit_log;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14800000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is((public.initialize_my_chart_accounts('14800000-0000-4000-8000-000000000106')->>'inserted')::int,28,'explicit initialization creates 28 accounts');
SELECT is((public.initialize_my_chart_accounts('14800000-0000-4000-8000-000000000106')->>'inserted')::int,28,'initializer replays original nonzero result');
SELECT is((public.read_my_accounting_master_page('accounts')->>'total')::int,28,'initialized chart exactly standard size');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='legacy')),6,'initializer creates six mappings');
SELECT is((SELECT count(*)::int FROM public.accounting_periods WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='legacy')),1,'initializer creates current period');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE tenant_id=(SELECT id FROM master_page_tenants WHERE label='legacy')),0,'initializer invents no opening balance');
-- Corrupt only these fresh synthetic rows to verify bounded legacy-cycle reads.
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance) SELECT '14800000-0000-4000-8000-000000000201',id,'8801','Cycle A','Cycle A','asset','debit' FROM master_page_tenants WHERE label='own';
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance) SELECT '14800000-0000-4000-8000-000000000202',id,'8802','Cycle B','Cycle B','asset','debit' FROM master_page_tenants WHERE label='own';
ALTER TABLE public.chart_of_accounts DISABLE TRIGGER trg_coa_validate;
UPDATE public.chart_of_accounts SET parent_id=CASE id WHEN '14800000-0000-4000-8000-000000000201' THEN '14800000-0000-4000-8000-000000000202'::uuid ELSE '14800000-0000-4000-8000-000000000201'::uuid END WHERE id IN('14800000-0000-4000-8000-000000000201','14800000-0000-4000-8000-000000000202');
ALTER TABLE public.chart_of_accounts ENABLE TRIGGER trg_coa_validate;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((public.read_my_chart_parent_page('asset','14800000-0000-4000-8000-000000000201','Cycle')->>'total')::int,0,'legacy cycle traversal terminates and excludes descendants');
SELECT throws_ok($$SELECT public.mutate_my_accounting_master('accounts','create','{"account_code":"8803","name_ar":"Invalid parent","name_en":"Invalid parent","account_type":"asset","normal_balance":"debit","parent_id":"14800000-0000-4000-8000-000000000201"}',NULL,NULL,'14800000-0000-4000-8000-000000000107')$$,'P0001','COA002: parent chain is cyclic or needs review','new parent assignment cannot join legacy cycle');
RESET ROLE;
INSERT INTO public.customers(tenant_id,customer_code,name_ar,name_en,credit_limit) SELECT t.id,'P148-'||lpad(i::text,5,'0'),'حد التصدير '||i,'Over ceiling '||i,i::numeric/100 FROM master_page_tenants t CROSS JOIN generate_series(1202,10001)i WHERE label='own';
INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance) SELECT t.id,(100000+i)::text,'حد الحساب '||i,'Over ceiling account '||i,'asset','debit' FROM master_page_tenants t CROSS JOIN generate_series(1202,10001)i WHERE label='own';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.read_my_accounting_master_page('customers','',1,25,true)$$,'54000','MASTER_EXPORT_LIMIT: narrow the export search','party export above 10000 fails explicitly');
SELECT throws_ok($$SELECT public.read_my_accounting_master_page('accounts','',1,25,true)$$,'54000','MASTER_EXPORT_LIMIT: narrow the export search','chart export above 10000 fails explicitly');
SELECT is(jsonb_array_length(public.read_my_accounting_master_page('customers','Export1201',1,25,true)->'rows'),1201,'narrow party export remains complete');
SELECT is(jsonb_array_length(public.read_my_accounting_master_page('accounts','Export1201',1,25,true)->'rows'),1201,'narrow chart export remains complete');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;