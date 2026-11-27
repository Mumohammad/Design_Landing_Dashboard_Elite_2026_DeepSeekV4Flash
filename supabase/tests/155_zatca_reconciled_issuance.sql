BEGIN;
SELECT no_plan();
-- Synthetic SQL source binding and retry tests; no provider or SDK acceptance.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('15500000-0000-4000-8000-000000000001','issuance155@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE z155_tenant AS SELECT (public.provision_company_atomic('15500000-0000-4000-8000-000000000001','{"name":"Issuance reconciliation","slug":"issuance155","domain":"issuance155.test"}')->>'id')::uuid id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='15500000-0000-4000-8000-000000000001';
INSERT INTO public.customers(id,tenant_id,name_ar) SELECT '15500000-0000-4000-8000-000000000002',id,'Synthetic customer' FROM z155_tenant;
INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial) SELECT '15500000-0000-4000-8000-000000000003',id,'sandbox','Synthetic155' FROM z155_tenant;
CREATE TEMP TABLE z155_cases(label text PRIMARY KEY,result jsonb,doc_id uuid DEFAULT gen_random_uuid(),issued_at timestamptz DEFAULT date_trunc('second',clock_timestamp()),xml text,receipt jsonb);
INSERT INTO z155_cases(label) VALUES('prepared'),('unprepared');
GRANT ALL ON z155_cases TO authenticated,service_role;GRANT SELECT ON z155_tenant TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
UPDATE z155_cases SET result=public.save_invoice_draft(jsonb_build_object('invoice_type','sales','customer_id','15500000-0000-4000-8000-000000000002','issue_date',current_date,'due_date',current_date+7,'show_due_date',false,'lines','[{"item_name":"Exact service","description":"Separate description","quantity":2,"unit_price":1.2345,"vat_rate":15}]'::jsonb));
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'issue',(result->>'updated_at')::timestamptz) FROM z155_cases$$,'fixtures issue through the guarded lifecycle');
RESET ROLE;
UPDATE z155_cases c SET result=c.result||jsonb_build_object('updated_at',i.updated_at) FROM public.invoices i WHERE i.id=(c.result->>'id')::uuid;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'finalize',(result->>'updated_at')::timestamptz) FROM z155_cases$$,'fixtures finalize through the guarded lifecycle');
SELECT is(public.read_my_invoice_page()->'rows'->0->>'zatca_status','not_transmitted','paged invoices retain the exact initial ZATCA status');
SELECT is(public.read_my_invoice_page()->'rows'->0->>'show_due_date','false','paged invoices retain due date presentation separately');
RESET ROLE;
CREATE FUNCTION pg_temp.z155_xml(p_label text,p_zone text DEFAULT 'Asia/Riyadh') RETURNS text LANGUAGE sql AS $$
 SELECT format('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>%s</cbc:ID><cbc:UUID>%s</cbc:UUID><cbc:IssueDate>%s</cbc:IssueDate><cbc:IssueTime>%s</cbc:IssueTime><cbc:InvoiceTypeCode>388</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>%s</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>%s</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0.37</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>2.47</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>2.84</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity>2</cbc:InvoicedQuantity><cbc:LineExtensionAmount>2.47</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount>0.37</cbc:TaxAmount></cac:TaxTotal><cac:Item><cbc:Description>Separate description</cbc:Description><cbc:Name>Exact service</cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>15</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount>1.2345</cbc:PriceAmount></cac:Price></cac:InvoiceLine></Invoice>',i.invoice_number,c.doc_id,to_char(c.issued_at AT TIME ZONE p_zone,'YYYY-MM-DD'),to_char(c.issued_at AT TIME ZONE p_zone,'HH24:MI:SS'),s.last_counter+1,s.last_invoice_hash)
 FROM z155_cases c JOIN public.invoices i ON i.id=(c.result->>'id')::uuid CROSS JOIN public.zatca_issuance_streams s WHERE c.label=p_label AND s.id='15500000-0000-4000-8000-000000000003';
$$;
CREATE FUNCTION pg_temp.z155_record(p_label text,p_xml text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_zatca_issuance(t.id,s.id,'invoice',(c.result->>'id')::uuid,c.doc_id,c.issued_at,s.last_counter,s.last_invoice_hash,p_xml,p_xml,encode(sha256(convert_to(p_xml,'UTF8')),'base64'),'15500000-0000-4000-8000-000000000001') FROM z155_cases c CROSS JOIN z155_tenant t CROSS JOIN public.zatca_issuance_streams s WHERE c.label=p_label AND s.id='15500000-0000-4000-8000-000000000003';
$$;
CREATE FUNCTION pg_temp.z155_replay(p_label text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_zatca_issuance(t.id,'15500000-0000-4000-8000-000000000003','invoice',(c.result->>'id')::uuid,c.doc_id,c.issued_at,NULL,NULL,NULL,NULL,NULL,'15500000-0000-4000-8000-000000000001') FROM z155_cases c CROSS JOIN z155_tenant t WHERE c.label=p_label;
$$;
UPDATE z155_cases SET xml=pg_temp.z155_xml(label) WHERE label='prepared';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.z155_record('prepared',pg_temp.z155_xml('prepared','UTC'))$$,'ZTC_XML:%','UTC wall-clock XML cannot replace the Riyadh IssueDate/IssueTime');
SELECT lives_ok($$UPDATE z155_cases SET receipt=pg_temp.z155_record(label,xml) WHERE label='prepared'$$,'Riyadh XML binds the exact item name, description and four decimal price');
SELECT is(pg_temp.z155_replay('prepared'),(SELECT receipt FROM z155_cases WHERE label='prepared'),'finalized retry returns the exact retained receipt without new bytes');
RESET ROLE;
UPDATE public.invoices SET status='paid' WHERE id IN(SELECT(result->>'id')::uuid FROM z155_cases);
SET LOCAL ROLE service_role;
SELECT is(pg_temp.z155_replay('prepared'),(SELECT receipt FROM z155_cases WHERE label='prepared'),'payment-state retry returns the original issuance identity and source snapshot');
SELECT throws_like($$SELECT pg_temp.z155_record('unprepared',pg_temp.z155_xml('unprepared'))$$,'ZTC_SOURCE:%','paid document cannot allocate a first issuance after the payment');
RESET ROLE;
SELECT is((SELECT last_counter::int FROM public.zatca_issuance_streams WHERE id='15500000-0000-4000-8000-000000000003'),1,'rejected UTC and paid allocation attempts create no chain gap');
SELECT is((SELECT source_snapshot->'lines'->0->>'item_name' FROM public.zatca_document_issuances WHERE tenant_id=(SELECT id FROM z155_tenant)),'Exact service','retained source snapshot keeps the separate item name');
UPDATE public.invoices SET status='finalized' WHERE id=(SELECT(result->>'id')::uuid FROM z155_cases WHERE label='prepared');
UPDATE public.invoices SET status='cancelled' WHERE id=(SELECT(result->>'id')::uuid FROM z155_cases WHERE label='prepared');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.z155_replay('prepared')$$,'ZTC_SOURCE:%','cancelled source cannot be revived by replaying its prior issuance');
RESET ROLE;
UPDATE public.tenants SET status='suspended' WHERE id=(SELECT id FROM z155_tenant);
SELECT is(public.zatca_operator_authorized((SELECT id FROM z155_tenant),'15500000-0000-4000-8000-000000000001'),false,'active operator of a suspended tenant is denied');
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT pg_temp.z155_replay('prepared')$$,'42501','ZTC_ACTOR: active tenant actor required','tenant authorization is rechecked even for stored receipt replay');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=clock_timestamp() WHERE id=(SELECT id FROM z155_tenant);
SELECT is(public.zatca_operator_authorized((SELECT id FROM z155_tenant),'15500000-0000-4000-8000-000000000001'),false,'deleted tenant cannot authorize an otherwise active operator');
SELECT * FROM finish();
ROLLBACK;
