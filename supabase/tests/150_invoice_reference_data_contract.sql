BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95100000-0000-4000-8000-000000000001','invoice-reference-owner@example.test','{"_invite_provisioned":true}'),
 ('95100000-0000-4000-8000-000000000002','invoice-reference-other@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE i20_tenants AS
 SELECT 'owner'::text label,(public.provision_company_atomic('95100000-0000-4000-8000-000000000001','{"name":"Invoice reference fixture","domain":"invoice-reference.test","slug":"invoice-reference"}')->>'id')::uuid id
 UNION ALL SELECT 'other',(public.provision_company_atomic('95100000-0000-4000-8000-000000000002','{"name":"Invoice reference other","domain":"invoice-reference-other.test","slug":"invoice-reference-other"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN ('95100000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,tenant_id,name_ar) SELECT '95100000-0000-4000-8000-000000000003',id,'Synthetic invoice party' FROM i20_tenants WHERE label='owner';
CREATE TEMP TABLE i20_cases(label text PRIMARY KEY,input jsonb,result jsonb,version timestamptz);
INSERT INTO i20_cases(label,input) VALUES
 ('reference',jsonb_build_object('invoice_type','sales','customer_id','95100000-0000-4000-8000-000000000003','issue_date',current_date,'due_date',current_date+7,'lines','[{"item_name":"  Reference item  ","description":"Separate service description","quantity":1,"unit_price":72225.2082,"vat_rate":15}]'::jsonb)),
 ('legacy',jsonb_build_object('invoice_type','sales','customer_id','95100000-0000-4000-8000-000000000003','issue_date',current_date,'due_date',current_date,'lines','[{"description":"Legacy item","quantity":1,"unit_price":4.10,"vat_rate":15}]'::jsonb)),
 ('rounding',jsonb_build_object('invoice_type','sales','customer_id','95100000-0000-4000-8000-000000000003','issue_date',current_date,'due_date',current_date,'lines','[{"description":"Half-cent product","quantity":0.125,"unit_price":0.0400,"vat_rate":0},{"description":"Four-decimal unit","quantity":100,"unit_price":0.0001,"vat_rate":0}]'::jsonb));
INSERT INTO i20_cases(label,input) SELECT 'unicode',jsonb_set(input,'{lines,0,item_name}',to_jsonb(chr(160)||E'\t'||chr(11)||'Precise name'||chr(65279)||chr(12288))) FROM i20_cases WHERE label='legacy';
INSERT INTO i20_cases(label,input) SELECT 'literal_v',jsonb_set(input,'{lines,0,item_name}','"validv"') FROM i20_cases WHERE label='legacy';
GRANT ALL ON i20_cases TO authenticated; GRANT SELECT ON i20_tenants TO authenticated;
SELECT ok(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoice_lines' AND column_name='unit_price' AND numeric_precision=14 AND numeric_scale=4),'stored unit prices retain four decimals');
SELECT ok(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='show_due_date' AND data_type='boolean' AND is_nullable='NO'),'due date visibility is an explicit nonnull presentation flag');
SELECT ok(NOT has_table_privilege('authenticated','public.invoice_lines','UPDATE'),'line precision does not restore direct browser writes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"95100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT lives_ok($$UPDATE i20_cases SET result=public.save_invoice_draft(input)$$,'real draft RPC accepts precise and legacy inputs');
UPDATE i20_cases SET version=(result->>'updated_at')::timestamptz;
SELECT is((SELECT l.unit_price FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='reference'),72225.2082::numeric,'persisted price is not rounded to cents');
SELECT is((SELECT l.item_name FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='reference'),'Reference item','item name is independently trimmed and retained');
SELECT is((SELECT l.description FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='reference'),'Separate service description','description is never split or replaced by the item name');
SELECT is((SELECT i.subtotal FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),72225.21::numeric,'net rounds the exact product once');
SELECT is((SELECT i.vat_amount FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),10833.78::numeric,'VAT keeps the existing per-line cent formula');
SELECT is((SELECT i.total FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),83058.99::numeric,'new invoices do not inherit the historical post-VAT adjustment');
SELECT is((SELECT i.show_due_date FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),false,'new reference presentation hides due date by default');
SELECT is((SELECT i.due_date-i.issue_date FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),7,'hidden due date remains financially retained');
SELECT is((SELECT i.total FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='legacy'),4.72::numeric,'existing two-decimal inputs retain identical totals');
SELECT is((SELECT l.item_name FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='legacy'),NULL::text,'legacy item names remain absent rather than fabricated');
SELECT is((SELECT i.total FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='rounding'),0.02::numeric,'quantity and price precision use PostgreSQL half-away cent rounding');
SELECT is((SELECT l.item_name FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='unicode'),'Precise name','legacy RPC trims NBSP, tab, vertical tab, BOM and ideographic space consistently with JavaScript');
SELECT is((SELECT l.item_name FROM public.invoice_lines l JOIN i20_cases c ON l.invoice_id=(c.result->>'id')::uuid WHERE c.label='literal_v'),'validv','normalization never strips literal letters from an item name');
SELECT throws_like($$SELECT public.save_invoice_draft(jsonb_set(input,'{lines,0,unit_price}','1.00001')) FROM i20_cases WHERE label='reference'$$,'INV002:%','five fractional price digits are rejected');
SELECT throws_like($$SELECT public.save_invoice_draft(jsonb_set(input,'{lines,0,item_name}',to_jsonb(repeat('x',201)))) FROM i20_cases WHERE label='reference'$$,'INV002:%','overlong item names are rejected');
SELECT throws_like($$SELECT public.save_invoice_draft(jsonb_set(input,'{lines,0,item_name}','42')) FROM i20_cases WHERE label='reference'$$,'INV002:%','nontext item names are rejected');
SELECT throws_like($$SELECT public.save_invoice_draft(input||'{"show_due_date":"true"}') FROM i20_cases WHERE label='reference'$$,'INV002:%','truthy strings cannot become presentation flags');
SELECT throws_like($$SELECT public.save_invoice_draft(input-'due_date') FROM i20_cases WHERE label='reference'$$,'INV008:%','financial due date remains required');
SELECT lives_ok($$UPDATE i20_cases SET result=public.save_invoice_draft(input||'{"show_due_date":true}',(result->>'id')::uuid,version) WHERE label='reference'$$,'reviewed draft can explicitly enable due-date printing');
UPDATE i20_cases SET version=(result->>'updated_at')::timestamptz WHERE label='reference';
SELECT is((SELECT i.show_due_date FROM public.invoices i JOIN i20_cases c ON i.id=(c.result->>'id')::uuid WHERE c.label='reference'),true,'due-date preference is persisted');
SELECT throws_like($$SELECT public.save_invoice_draft(input,(result->>'id')::uuid,'2000-01-01') FROM i20_cases WHERE label='reference'$$,'INV015:%','reference fields do not weaken stale-draft protection');
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'issue',version) FROM i20_cases WHERE label='reference'$$,'four-decimal draft passes the actual issue validator');
RESET ROLE;
UPDATE i20_cases c SET version=i.updated_at FROM public.invoices i WHERE i.id=(c.result->>'id')::uuid AND c.label='reference';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'finalize',version) FROM i20_cases WHERE label='reference'$$,'four-decimal invoice passes actual finalization');
RESET ROLE;
SELECT is((SELECT e.payload->'lines'->0->>'item_name' FROM public.financial_events e JOIN i20_cases c ON e.source_id=(c.result->>'id')::uuid WHERE c.label='reference'),'Reference item','immutable financial event preserves item name');
SELECT is((SELECT (e.payload->'lines'->0->>'unit_price')::numeric FROM public.financial_events e JOIN i20_cases c ON e.source_id=(c.result->>'id')::uuid WHERE c.label='reference'),72225.2082::numeric,'immutable event preserves full unit price');
SELECT is(public.dispatch_sales_finalized(e),'ok','real posting consumer accepts the precise invoice') FROM public.financial_events e JOIN i20_cases c ON e.source_id=(c.result->>'id')::uuid WHERE c.label='reference';
UPDATE public.financial_events e SET processing_status='processed',processed_at=now() FROM i20_cases c WHERE e.source_id=(c.result->>'id')::uuid AND c.label='reference';
SELECT is((SELECT total_amount FROM public.receivables r JOIN i20_cases c ON r.source_entity_id=(c.result->>'id')::uuid WHERE c.label='reference'),83058.99::numeric,'receivable keeps the validated new invoice total');
SELECT throws_like($$UPDATE public.invoices i SET show_due_date=false FROM i20_cases c WHERE i.id=(c.result->>'id')::uuid AND c.label='reference'$$,'INV003:%','finalized due-date presentation is immutable with its source');
UPDATE i20_cases c SET version=i.updated_at FROM public.invoices i WHERE i.id=(c.result->>'id')::uuid AND c.label='reference';
CREATE TEMP TABLE i20_credit(result jsonb); GRANT ALL ON i20_credit TO authenticated;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO i20_credit SELECT public.create_invoice_note_atomic('95100000-0000-4000-8000-000000000010',(result->>'id')::uuid,version,'credit',jsonb_build_object('reason','Synthetic reference full credit','issue_date',current_date)) FROM i20_cases WHERE label='reference'$$,'credit creation retains the precise immutable source');
RESET ROLE;
SELECT is((SELECT n.lines->0->>'item_name' FROM public.credit_notes n JOIN i20_credit c ON n.id=(c.result->>'id')::uuid),'Reference item','credit note snapshot preserves separate item name');
SELECT is((SELECT (n.lines->0->>'unit_price')::numeric FROM public.credit_notes n JOIN i20_credit c ON n.id=(c.result->>'id')::uuid),72225.2082::numeric,'credit note snapshot preserves four-decimal unit price');
SELECT is((SELECT n.total FROM public.credit_notes n JOIN i20_credit c ON n.id=(c.result->>'id')::uuid),83058.99::numeric,'credit note reverses only the validated source total');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"95100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT throws_like($$SELECT public.save_invoice_draft(input) FROM i20_cases WHERE label='legacy'$$,'INV005:%','foreign parties remain unavailable to another tenant');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
