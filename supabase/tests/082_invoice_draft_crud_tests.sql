BEGIN;
SELECT no_plan();
INSERT INTO public.customers(id,tenant_id,name_ar) VALUES
 ('82000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','Draft customer'),
 ('82000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000002','Other tenant');
INSERT INTO public.suppliers(id,tenant_id,name_ar) VALUES
 ('82000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','Draft supplier');
CREATE TEMP TABLE draft_fixture(input jsonb, result jsonb);
INSERT INTO draft_fixture(input) VALUES ('{
 "invoice_type":"sales","customer_id":"82000000-0000-4000-8000-000000000001",
 "issue_date":"2026-10-13","due_date":"2026-11-13",
 "tenant_id":"00000000-0000-0000-0000-000000000002",
 "lines":[{"description":"VAT boundary","quantity":1,"unit_price":4.10}]
}');
GRANT ALL ON draft_fixture TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
UPDATE draft_fixture SET result=public.save_invoice_draft(input);
SELECT is((SELECT total FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),4.72::numeric,'decimal VAT matches PostgreSQL half-away rounding');
SELECT is((SELECT tenant_id FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),'00000000-0000-0000-0000-000000000001'::uuid,'caller cannot forge tenant');
SELECT is((SELECT count(*)::int FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)),1,'header and line persisted');
SELECT throws_ok($$SELECT public.save_invoice_draft(input || '{"customer_id":"82000000-0000-4000-8000-000000000002"}', (result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','INV005: active tenant party required','cross-tenant party edit rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft(input,(result->>'id')::uuid,'2000-01-01') FROM draft_fixture$$,'P0001','INV015: invoice changed; reload before saving','stale edit rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft(jsonb_set(input,'{lines,0,discount}','5'),(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','INV002: discount exceeds line value','over-discount rejected');
SELECT throws_ok($$SELECT public.save_invoice_draft(jsonb_set(input,'{lines,0,unit_price}','1.00001')) FROM draft_fixture$$,'P0001','INV002: invalid invoice line','unit-price precision beyond four decimals rejected');
SELECT is((SELECT total FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),4.72::numeric,'invalid edits preserve header');
SELECT is((SELECT amount FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)),4.10::numeric,'invalid edits preserve lines');
SELECT throws_ok($$UPDATE public.invoices SET total=0 WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)$$,'42501',NULL,'direct header write cannot bypass RPC');
SELECT throws_ok($$DELETE FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)$$,'42501',NULL,'direct line deletion cannot bypass RPC');
SELECT lives_ok($$UPDATE draft_fixture SET result=public.save_invoice_draft(jsonb_set(input,'{lines,0,unit_price}','10'),(result->>'id')::uuid,(result->>'updated_at')::timestamptz)$$,'draft edit succeeds');
SELECT is((SELECT total FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),11.50::numeric,'edit recomputes totals');
SELECT is((SELECT count(*)::int FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)),1,'edit replaces rather than duplicates lines');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action='invoice_draft_updated' THEN RAISE EXCEPTION 'audit fault'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_draft_test_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_draft_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_invoice_draft(input,(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','audit fault','audit failure aborts the entire edit');
SELECT is((SELECT total FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),11.50::numeric,'audit failure rolls header back');
SELECT is((SELECT amount FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)),10::numeric,'audit failure restores previous lines');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.delete_invoice_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','INV001: invoice not found','another tenant cannot delete invoice');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_invoice_draft(input) FROM draft_fixture$$,'P0001','AUTH007: invoice permission required','MFA required for privileged draft creation');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($$SELECT public.save_invoice_draft(input || '{"invoice_type":"purchase","supplier_id":"82000000-0000-4000-8000-000000000003"}') FROM draft_fixture$$,'purchase draft uses tenant supplier');
SELECT throws_ok($$SELECT public.delete_invoice_draft((result->>'id')::uuid,'2000-01-01') FROM draft_fixture$$,'P0001','INV015: invoice changed; reload before deleting','stale delete rejected');
SELECT lives_ok($$SELECT public.delete_invoice_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'draft can be soft deleted');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture)),'deletion preserves header');
SELECT is((SELECT count(*)::int FROM public.invoice_lines WHERE invoice_id=(SELECT (result->>'id')::uuid FROM draft_fixture)),1,'deletion retains lines for audit');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM draft_fixture) AND action='invoice_draft_deleted'),1,'deletion recorded in audit');
DROP TRIGGER trg_draft_test_audit ON public.audit_log;
UPDATE public.invoices SET status='issued',deleted_at=NULL WHERE id=(SELECT (result->>'id')::uuid FROM draft_fixture);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.delete_invoice_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','INV006: only drafts can be deleted','issued invoice cannot be deleted');
SELECT throws_ok($$SELECT public.save_invoice_draft(input,(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM draft_fixture$$,'P0001','INV006: only draft invoices can be edited','issued invoice cannot be edited');
SELECT * FROM finish();
ROLLBACK;
