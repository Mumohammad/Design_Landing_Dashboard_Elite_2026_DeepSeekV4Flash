BEGIN;
SELECT plan(51);
INSERT INTO public.tenants (id,name_ar,name_en,slug) VALUES
 ('80111111-1111-4111-8111-111111111111','Payment A','Payment A','payment-80-a'),
 ('80222222-2222-4222-8222-222222222222','Payment B','Payment B','payment-80-b');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000000','80333333-3333-4333-8333-333333333333',
 'authenticated','authenticated','payment-80@test.local',crypt('x',gen_salt('bf')),now(),now(),now(),
 '{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
INSERT INTO public.users (id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
 ('80444444-4444-4444-8444-444444444444','80333333-3333-4333-8333-333333333333',
 '80111111-1111-4111-8111-111111111111','payment-80@test.local','general_manager','active',false);
INSERT INTO public.customers (id,tenant_id,name_ar) VALUES
 ('80555555-5555-4555-8555-555555555555','80111111-1111-4111-8111-111111111111','Customer A'),
 ('80666666-6666-4666-8666-666666666666','80222222-2222-4222-8222-222222222222','Customer B');
INSERT INTO public.suppliers (id,tenant_id,name_ar) VALUES
 ('80aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','80111111-1111-4111-8111-111111111111','Supplier A');
INSERT INTO public.finance_payments (id,tenant_id,direction,customer_id,payment_date,amount,method) VALUES
 ('80bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','80222222-2222-4222-8222-222222222222','in',
 '80666666-6666-4666-8666-666666666666','2026-10-11',100,'cash');
INSERT INTO public.receivables (id,tenant_id,customer_id,invoice_ref,invoice_date,due_date,amount,total_amount) VALUES
 ('80777777-7777-4777-8777-777777777777','80111111-1111-4111-8111-111111111111','80555555-5555-4555-8555-555555555555','AR80A','2026-10-11','2026-10-11',100,100),
 ('80888888-8888-4888-8888-888888888888','80222222-2222-4222-8222-222222222222','80666666-6666-4666-8666-666666666666','AR80B','2026-10-11','2026-10-11',100,100);
INSERT INTO public.payables (id,tenant_id,supplier_id,invoice_ref,invoice_date,due_date,amount,total_amount) VALUES
 ('80999999-9999-4999-8999-999999999999','80111111-1111-4111-8111-111111111111','80aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','AP80A','2026-10-11','2026-10-11',100,100);
INSERT INTO public.chart_of_accounts (tenant_id,account_code,name_ar,name_en,account_type,normal_balance) VALUES
 ('80111111-1111-4111-8111-111111111111','1000','Cash','Cash','asset','debit'),
 ('80111111-1111-4111-8111-111111111111','1200','AR','AR','asset','debit'),
 ('80111111-1111-4111-8111-111111111111','2000','AP','AP','liability','credit');
INSERT INTO public.financial_events (tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
 VALUES ('80222222-2222-4222-8222-222222222222',gen_random_uuid(),'80-foreign-event','invoice',gen_random_uuid(),
 'InvoiceFinalizedEvent','2026-10-11','{}');
CREATE TEMP TABLE payment_fixture (document jsonb,allocations jsonb,payment_id uuid,outgoing_id uuid);
INSERT INTO payment_fixture VALUES
 ('{"direction":"in","payment_date":"2026-10-11","amount":4.72,"method":"cash","customer_id":"80555555-5555-4555-8555-555555555555"}',
 '[{"receivable_id":"80777777-7777-4777-8777-777777777777","amount":4.72}]',NULL,NULL);
GRANT SELECT,UPDATE ON payment_fixture TO authenticated;
SELECT ok(NOT has_function_privilege('anon','public.record_finance_payment_atomic(jsonb,jsonb,uuid)','EXECUTE'),'Anonymous cannot record payments');
SELECT ok(NOT has_function_privilege('anon','public.void_finance_payment_atomic(uuid)','EXECUTE'),'Anonymous cannot void payments');
SELECT ok(NOT has_function_privilege('authenticated','public.lock_payment_targets(uuid,uuid)','EXECUTE'),'Internal lock helper unavailable to callers');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SELECT set_config('request.jwt.claims','{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}',true);
SELECT lives_ok($$UPDATE payment_fixture SET payment_id = (public.record_finance_payment_atomic(document,allocations,'80000000-0000-4000-8000-000000000001')->>'id')::uuid$$,'Authorized receipt commits');
SELECT is((SELECT amount FROM public.finance_payments WHERE id = (SELECT payment_id FROM payment_fixture)),4.72::numeric,'Payment stores exact decimal');
SELECT is((SELECT count(*) FROM public.payment_allocations WHERE finance_payment_id = (SELECT payment_id FROM payment_fixture)),1::bigint,'Allocation committed');
SELECT is((SELECT count(*) FROM public.financial_events WHERE source_id = (SELECT payment_id FROM payment_fixture)),1::bigint,'Durable outbox committed');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = (SELECT payment_id FROM payment_fixture)),1::bigint,'Audit committed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT is((SELECT public.record_finance_payment_atomic(document,allocations,'80000000-0000-4000-8000-000000000001')->>'id' FROM payment_fixture),(SELECT payment_id::text FROM payment_fixture),'Retry returns original identifier');
SELECT is((SELECT count(*) FROM public.finance_payments),1::bigint,'Retry creates no duplicate payment');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(document,'{reference}','"changed"'),allocations,'80000000-0000-4000-8000-000000000001') FROM payment_fixture$$,
 'P0001','PMT_RETRY: request identifier already used for different details','Changed retry rejected');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(document,'{customer_id}','"80666666-6666-4666-8666-666666666666"'),allocations,'80000000-0000-4000-8000-000000000002') FROM payment_fixture$$,
 'P0001','CUS001: customer not found in caller tenant','Foreign party rejected');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,'[{"receivable_id":"80888888-8888-4888-8888-888888888888","amount":4.72}]','80000000-0000-4000-8000-000000000003') FROM payment_fixture$$,
 'P0001','PMT001: target not open in payment tenant','Foreign target rejected');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(document,'{amount}','100'), '[{"receivable_id":"80777777-7777-4777-8777-777777777777","amount":100}]','80000000-0000-4000-8000-000000000004') FROM payment_fixture$$,
 'P0001','PMT001: allocation exceeds unreserved outstanding balance','Pending receipt reserves its outstanding balance');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,'[]','80000000-0000-4000-8000-000000000005') FROM payment_fixture$$,
 'P0001','PMT004: payment requires 1 to 1000 allocations','Empty allocation rejected');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,'[{"receivable_id":"80777777-7777-4777-8777-777777777777","amount":4.71}]','80000000-0000-4000-8000-000000000005') FROM payment_fixture$$,
 'P0001','PMT003: allocations must equal payment amount','One-cent mismatch rejected');

-- Actual failures after earlier writes, not mocked rollbacks.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.allocated_amount = 5 THEN RAISE EXCEPTION 'injected allocation failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER test_80_alloc_fail BEFORE INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payment_allocation();
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(document,'{amount}','5'),'[{"receivable_id":"80777777-7777-4777-8777-777777777777","amount":5}]','80000000-0000-4000-8000-000000000006') FROM payment_fixture$$,
 'P0001','injected allocation failure','Allocation failure aborts header');
SELECT is((SELECT count(*) FROM public.finance_payments),1::bigint,'Failed allocation leaves no header');
RESET ROLE;
DROP TRIGGER test_80_alloc_fail ON public.payment_allocations;
CREATE FUNCTION pg_temp.fail_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tenant_id = '80111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'injected event failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER test_80_event_fail BEFORE INSERT ON public.financial_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payment_event();
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,allocations,'80000000-0000-4000-8000-000000000007') FROM payment_fixture$$,
 'P0001','injected event failure','Outbox failure aborts header and allocations');
SELECT is((SELECT count(*) FROM public.payment_allocations),1::bigint,'Failed outbox leaves no allocations');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_log WHERE tenant_id = '80111111-1111-4111-8111-111111111111'),1::bigint,'Failures do not produce success audits');
DROP TRIGGER test_80_event_fail ON public.financial_events;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$UPDATE public.finance_payments SET amount = 1 WHERE id = (SELECT payment_id FROM payment_fixture)$$,
 'P0001','PMT002: use the guarded payment lifecycle','Direct payment mutation denied');
SELECT throws_ok($$DELETE FROM public.payment_allocations WHERE finance_payment_id = (SELECT payment_id FROM payment_fixture)$$,
 '42501','permission denied for table payment_allocations','Authenticated allocation DELETE denied at grant boundary');
RESET ROLE;
SELECT throws_ok($$DELETE FROM public.payment_allocations WHERE finance_payment_id = (SELECT payment_id FROM payment_fixture)$$,
 'P0001','PMT002: recorded allocations are immutable','Privileged direct deletion also cannot alter queued allocations');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT is((SELECT out_processed FROM public.dispatch_my_financial_events()),1,'Tenant dispatcher posts receipt');
SELECT is((SELECT status::text FROM public.finance_payments WHERE id = (SELECT payment_id FROM payment_fixture)),'allocated','Posting confirmed by payment state');
SELECT is((SELECT paid_amount FROM public.receivables WHERE id = '80777777-7777-4777-8777-777777777777'),4.72::numeric,'Receivable paid amount updated');
SELECT is((SELECT sum(l.debit_amount)-sum(l.credit_amount) FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id
 WHERE e.source_entity_id = (SELECT payment_id FROM payment_fixture)),0::numeric,'Receipt ledger balances');
RESET ROLE;
SELECT is((SELECT processing_status::text FROM public.financial_events WHERE idempotency_key = '80-foreign-event'),'pending','Foreign queue untouched');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT is((SELECT out_processed FROM public.dispatch_my_financial_events()),0,'Second dispatch does not repost');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.entry_type = 'reversal' AND NEW.tenant_id = '80111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'injected reversal failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER test_80_reversal_fail BEFORE INSERT ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_payment_reversal();
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.void_finance_payment_atomic(payment_id) FROM payment_fixture$$,'P0001','injected reversal failure','Reversal failure aborts void');
SELECT is((SELECT status::text FROM public.finance_payments WHERE id = (SELECT payment_id FROM payment_fixture)),'allocated','Failed void restores payment state');
SELECT is((SELECT paid_amount FROM public.receivables WHERE id = '80777777-7777-4777-8777-777777777777'),4.72::numeric,'Failed reversal restores paid amount');
SELECT is((SELECT count(*) FROM public.financial_events WHERE source_id = (SELECT payment_id FROM payment_fixture)),1::bigint,'Failed reversal leaves no void event');
RESET ROLE;
DROP TRIGGER test_80_reversal_fail ON public.journal_entries;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT lives_ok($$SELECT public.void_finance_payment_atomic(payment_id) FROM payment_fixture$$,'Posted receipt reverses atomically');
SELECT is((SELECT paid_amount FROM public.receivables WHERE id = '80777777-7777-4777-8777-777777777777'),0::numeric,'Void restores outstanding balance');
SELECT lives_ok($$SELECT public.void_finance_payment_atomic(payment_id) FROM payment_fixture$$,'Repeated void is idempotent');
SELECT is((SELECT count(*) FROM public.journal_entries WHERE source_entity_id = (SELECT payment_id FROM payment_fixture) AND entry_type = 'reversal'),1::bigint,'Exactly one reversal ledger');
SELECT is((SELECT count(*) FROM public.financial_events WHERE source_id = (SELECT payment_id FROM payment_fixture) AND event_type = 'PaymentVoidedEvent'),1::bigint,'Exactly one void event');
SELECT lives_ok($$UPDATE payment_fixture SET outgoing_id = (public.record_finance_payment_atomic(
 '{"direction":"out","payment_date":"2026-10-11","amount":6.21,"method":"cash","supplier_id":"80aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
 '[{"payable_id":"80999999-9999-4999-8999-999999999999","amount":6.21}]','80000000-0000-4000-8000-000000000008')->>'id')::uuid$$,'Supplier payment commits');
SELECT is((SELECT out_processed FROM public.dispatch_my_financial_events()),1,'Supplier payment posts');
SELECT is((SELECT paid_amount FROM public.payables WHERE id = '80999999-9999-4999-8999-999999999999'),6.21::numeric,'Payable paid amount updated');
SELECT throws_ok($$SELECT public.void_finance_payment_atomic('80bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,'P0001','PMT005: payment not found','Actual foreign payment inaccessible');
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
UPDATE public.users SET role = 'readonly_auditor' WHERE auth_user_id = '80333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,allocations,'80000000-0000-4000-8000-000000000009') FROM payment_fixture$$,
 '42501','PMT_PERMISSION: accounting:create required','Read-only cannot record');
SELECT throws_ok($$SELECT public.void_finance_payment_atomic(payment_id) FROM payment_fixture$$,
 '42501','PMT_PERMISSION: accounting:approve required','Read-only cannot void');
SELECT throws_ok($$SELECT public.dispatch_my_financial_events()$$,
 '42501','DSP_PERMISSION: accounting:approve required','Read-only cannot post');
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
UPDATE public.users SET role = 'general_manager',status = 'locked' WHERE auth_user_id = '80333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(document,allocations,'80000000-0000-4000-8000-000000000009') FROM payment_fixture$$,
 '42501','PMT_AUTH: active tenant account required','Locked JWT cannot record');
SELECT throws_ok($$SELECT public.dispatch_my_financial_events()$$,
 '42501','DSP_AUTH: active tenant account required','Locked JWT cannot dispatch');
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
UPDATE public.users SET status = 'active',deleted_at = now() WHERE auth_user_id = '80333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '80333333-3333-4333-8333-333333333333';
SET LOCAL request.jwt.claims = '{"sub":"80333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';
SELECT throws_ok($$SELECT public.void_finance_payment_atomic(payment_id) FROM payment_fixture$$,
 '42501','PMT_AUTH: active tenant account required','Deleted JWT cannot void');
RESET ROLE;
SELECT is((SELECT status::text FROM public.finance_payments WHERE id = '80bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'pending','Foreign payment unchanged');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.dispatch_my_financial_events()$$,'42501','permission denied for function dispatch_my_financial_events','Anonymous dispatch denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
