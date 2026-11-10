BEGIN;
SELECT no_plan();
INSERT INTO public.accounting_periods(id,tenant_id,period_year,period_month,status,reopen_reason) VALUES
('15300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001',2191,1,'open',NULL),
('15300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001',2191,2,'closing',NULL),
('15300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001',2191,3,'reopened','Reviewed correction'),
('15300000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000001',2191,4,'reopened','Draft correction'),
('15300000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000001',2191,5,'closed','Retained reason'),
('15300000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000002',2191,6,'reopened','Other tenant');
SELECT ok(has_function_privilege('service_role','public.close_accounting_period(uuid,uuid,uuid)','EXECUTE'),'existing service-role close privilege is preserved');
SELECT ok(NOT has_function_privilege('authenticated','public.close_accounting_period(uuid,uuid,uuid)','EXECUTE'),'browser role cannot bypass the authorized server action');
SELECT ok(NOT has_function_privilege('anon','public.close_accounting_period(uuid,uuid,uuid)','EXECUTE'),'anonymous period close remains forbidden');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.close_accounting_period(uuid,uuid,uuid)'::regprocedure),'period close remains security invoker');
SELECT lives_ok($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001')$$,'open period can still close');
SELECT lives_ok($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001')$$,'closing period can still close');
SELECT lives_ok($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001')$$,'reopened period can close after its correction');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000003'),'closed','re-close persists closed status');
SELECT is((SELECT reopen_reason FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000003'),'Reviewed correction','re-close retains the historical reopen reason');
SELECT ok((SELECT closed_at IS NOT NULL AND closed_by='00000000-0000-0000-0000-000000000001'::uuid AND updated_by=closed_by FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000003'),'re-close records its actor and timestamp');
SELECT lives_ok($$SELECT public.reopen_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000001','Reviewed second cycle','00000000-0000-0000-0000-000000000001')$$,'closed period can reopen through the existing guarded operation');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000001'),'reopened','reopen retains its existing status contract');
SELECT lives_ok($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001')$$,'complete open close reopen re-close cycle succeeds');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000001'),'closed','full cycle ends closed');
SELECT throws_like($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000005',NULL)$$,'ACC005:%','already closed period is not closed again');
SELECT throws_like($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000006',NULL)$$,'ACC003:%','cross-tenant period is not closed');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000006'),'reopened','cross-tenant period stays unchanged');
INSERT INTO public.journal_entries(id,tenant_id,entry_ref,entry_date,period_id,status,description_ar) VALUES('15300000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000001','period-reclose-fixture','2191-04-01','15300000-0000-4000-8000-000000000004','draft','Pending reviewed correction');
SELECT throws_like($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000004',NULL)$$,'ACC004:%','reopened period with pending drafts cannot close');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000004'),'reopened','failed draft check leaves the period reopened');
UPDATE public.journal_entries SET deleted_at=now() WHERE id='15300000-0000-4000-8000-000000000010';
SELECT lives_ok($$SELECT public.close_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000004',NULL)$$,'properly removed drafts no longer prevent re-close');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE id='15300000-0000-4000-8000-000000000004'),'closed','re-close after removed draft persists');
SELECT throws_like($$SELECT public.reopen_accounting_period('00000000-0000-0000-0000-000000000001','15300000-0000-4000-8000-000000000005','',NULL)$$,'ACC006:%','reopen still requires a reason');
SELECT * FROM finish();
ROLLBACK;
