BEGIN;
SELECT plan(31);

INSERT INTO public.tenants (id, name_ar, name_en, slug) VALUES
 ('79111111-1111-4111-8111-111111111111', 'Accounting A', 'Accounting A', 'accounting-79-a'),
 ('79222222-2222-4222-8222-222222222222', 'Accounting B', 'Accounting B', 'accounting-79-b');
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
 created_at, updated_at, raw_app_meta_data, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000000', '79333333-3333-4333-8333-333333333333',
  'authenticated', 'authenticated', 'accounting-79@test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{"_invite_provisioned":true}');
INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status, must_change_password) VALUES
 ('79444444-4444-4444-8444-444444444444', '79333333-3333-4333-8333-333333333333',
  '79111111-1111-4111-8111-111111111111', 'accounting-79@test.local', 'general_manager', 'active', false);
INSERT INTO public.customers (id, tenant_id, name_ar, name_en) VALUES
 ('79555555-5555-4555-8555-555555555555', '79111111-1111-4111-8111-111111111111', 'A customer', 'A customer'),
 ('79666666-6666-4666-8666-666666666666', '79222222-2222-4222-8222-222222222222', 'B customer', 'B customer');
CREATE TEMP TABLE draft_fixture (document jsonb, lines jsonb, invoice_id uuid);
INSERT INTO public.invoices (id, tenant_id, invoice_type, customer_id, issue_date, due_date,
 status, subtotal, discount, vat_amount, total, vat_rate) VALUES
 ('79777777-7777-4777-8777-777777777777', '79222222-2222-4222-8222-222222222222', 'sales',
  '79666666-6666-4666-8666-666666666666', '2026-10-11', '2026-10-11', 'draft', 10, 0, 1.5, 11.5, 15);
INSERT INTO draft_fixture VALUES (
 '{"invoice_type":"sales","customer_id":"79555555-5555-4555-8555-555555555555","issue_date":"2026-10-11","due_date":"2026-10-11"}',
 '[{"description":"Half-cent VAT","quantity":1,"unit_price":4.10}]', NULL);
GRANT SELECT, UPDATE ON draft_fixture TO authenticated;

SELECT ok(NOT has_function_privilege('anon', 'public.save_invoice_draft_atomic(jsonb,jsonb,uuid)', 'execute'), 'Anonymous cannot execute draft RPC');
SELECT ok(has_function_privilege('authenticated', 'public.save_invoice_draft_atomic(jsonb,jsonb,uuid)', 'execute'), 'Authenticated has guarded RPC grant');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '79333333-3333-4333-8333-333333333333';
SELECT lives_ok($$UPDATE draft_fixture SET invoice_id = (public.save_invoice_draft_atomic(document, lines)->>'id')::uuid$$, 'Authorized draft creation succeeds');
SELECT is((SELECT total FROM public.invoices WHERE id = (SELECT invoice_id FROM draft_fixture)), 4.72::numeric, 'VAT half cent rounds to 0.62');
SELECT is((SELECT vat_amount FROM public.invoice_lines WHERE invoice_id = (SELECT invoice_id FROM draft_fixture)), 0.62::numeric, 'Line VAT agrees with PostgreSQL decimal rounding');
SELECT is((SELECT count(*) FROM public.invoice_lines WHERE invoice_id = (SELECT invoice_id FROM draft_fixture)), 1::bigint, 'Header has its line');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = (SELECT invoice_id FROM draft_fixture) AND action = 'invoice_draft_created'), 1::bigint, 'Creation has exactly one committed audit entry');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(jsonb_set(document, '{customer_id}', '"79666666-6666-4666-8666-666666666666"'), lines) FROM draft_fixture$$,
 'P0001', 'CUS001: customer not found in caller tenant', 'Foreign tenant customer rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines, '79777777-7777-4777-8777-777777777777') FROM draft_fixture$$,
 'P0001', 'INV001: invoice not found', 'Foreign tenant invoice cannot be edited');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, '[{"description":"Invalid","quantity":1,"unit_price":1,"discount":2}]') FROM draft_fixture$$,
 'P0001', 'INV002: discount exceeds line gross amount', 'Negative net line rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, '[]') FROM draft_fixture$$,
 'P0001', 'INV013: invoice requires 1 to 1000 lines', 'Empty draft rejected');

-- Inject an actual failure after the header insert/update and line deletion.
-- The function must not catch this or commit an incomplete document.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_draft_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.description = 'FAIL-79' THEN RAISE EXCEPTION 'injected line failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_79_fail_line BEFORE INSERT ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_draft_line();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, '[{"description":"FAIL-79","quantity":1,"unit_price":99}]') FROM draft_fixture$$,
 'P0001', 'injected line failure', 'Failed line insert aborts creation');
SELECT is((SELECT count(*) FROM public.invoices), 1::bigint, 'Failed creation leaves no orphan header');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, '[{"description":"FAIL-79","quantity":1,"unit_price":99}]', invoice_id) FROM draft_fixture$$,
 'P0001', 'injected line failure', 'Failed replacement aborts update');
SELECT is((SELECT total FROM public.invoices WHERE id = (SELECT invoice_id FROM draft_fixture)), 4.72::numeric, 'Failed update restores original header total');
SELECT is((SELECT description FROM public.invoice_lines WHERE invoice_id = (SELECT invoice_id FROM draft_fixture)), 'Half-cent VAT', 'Failed update restores deleted original line');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = (SELECT invoice_id FROM draft_fixture)), 1::bigint, 'Failed writes do not append misleading audit entries');
DROP TRIGGER test_79_fail_line ON public.invoice_lines;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_invoice_draft_atomic(document, '[{"description":"Updated","quantity":0.5,"unit_price":8.21}]', invoice_id) FROM draft_fixture$$, 'Authorized replacement succeeds');
SELECT is((SELECT total FROM public.invoices WHERE id = (SELECT invoice_id FROM draft_fixture)), 4.73::numeric, 'Fractional quantity rounds identically to exact frontend calculation');
RESET ROLE;
UPDATE public.invoices SET status = 'issued' WHERE id = (SELECT invoice_id FROM draft_fixture);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines, invoice_id) FROM draft_fixture$$,
 'P0001', 'INV006: only matching draft invoices may be edited', 'Issued record cannot be edited as draft');
RESET ROLE;
UPDATE public.users SET role = 'readonly_auditor' WHERE auth_user_id = '79333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines) FROM draft_fixture$$,
 '42501', 'INV_PERMISSION: insufficient invoice permission', 'Read-only user cannot create draft');
RESET ROLE;
UPDATE public.users SET role = 'general_manager', status = 'inactive' WHERE auth_user_id = '79333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines) FROM draft_fixture$$,
 '42501', 'INV_AUTH: active tenant account required', 'Disabled account with valid JWT denied');
RESET ROLE;
UPDATE public.users SET status = 'locked' WHERE auth_user_id = '79333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines) FROM draft_fixture$$,
 '42501', 'INV_AUTH: active tenant account required', 'Locked account with valid JWT denied');
RESET ROLE;
UPDATE public.users SET status = 'active', deleted_at = now() WHERE auth_user_id = '79333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines) FROM draft_fixture$$,
 '42501', 'INV_AUTH: active tenant account required', 'Deleted account with valid JWT denied');
RESET ROLE;
UPDATE public.users SET deleted_at = NULL, status = 'active' WHERE auth_user_id = '79333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(jsonb_set(document, '{currency}', '"not-currency"'), lines) FROM draft_fixture$$,
 'P0001', 'INV002: invalid currency code', 'Malformed currency rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(jsonb_set(document, '{due_date}', '"2026-10-10"'), lines) FROM draft_fixture$$,
 'P0001', 'INV008: due date precedes issue date', 'Invalid date order rejected');
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document, lines) FROM draft_fixture$$,
 '42501', 'INV_AUTH: active tenant account required', 'Authenticated role without JWT subject denied');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id = (SELECT invoice_id FROM draft_fixture)), 2::bigint, 'Only successful creation and replacement audited');
SELECT is((SELECT count(*) FROM public.invoice_lines WHERE invoice_id = (SELECT invoice_id FROM draft_fixture)), 1::bigint, 'No duplicated lines after update');
SELECT is((SELECT total FROM public.invoices WHERE id = '79777777-7777-4777-8777-777777777777'), 11.5::numeric, 'Foreign tenant invoice unchanged');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic('{}', '[]')$$,
 '42501', 'permission denied for function save_invoice_draft_atomic', 'Anonymous RPC invocation denied at grant boundary');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
