BEGIN;
SELECT no_plan();
-- Minimal XML below exercises SQL source binding only. It is not an SDK,
-- signature, provider, production onboarding or authority acceptance claim.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('95400000-0000-4000-8000-000000000001','invoice-xml-owner@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE ix_tenant AS SELECT (public.provision_company_atomic('95400000-0000-4000-8000-000000000001','{"name":"Invoice XML fixture","domain":"invoice-xml.test","slug":"invoice-xml"}')->>'id')::uuid id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='95400000-0000-4000-8000-000000000001';
INSERT INTO public.customers(id,tenant_id,name_ar) SELECT '95400000-0000-4000-8000-000000000002',id,'Synthetic XML customer' FROM ix_tenant;
INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial) SELECT '95400000-0000-4000-8000-000000000003',id,'sandbox','Synthetic reference source stream' FROM ix_tenant;
CREATE TEMP TABLE ix_cases(label text PRIMARY KEY,result jsonb,doc_id uuid DEFAULT gen_random_uuid(),issued_at timestamptz DEFAULT date_trunc('second',clock_timestamp()),xml text,recorded jsonb);
INSERT INTO ix_cases(label) VALUES('named'),('legacy');GRANT ALL ON ix_cases TO authenticated,service_role;GRANT SELECT ON ix_tenant TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"95400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
UPDATE ix_cases SET result=public.save_invoice_draft(jsonb_build_object('invoice_type','sales','customer_id','95400000-0000-4000-8000-000000000002','issue_date',current_date,'due_date',current_date,'lines',jsonb_build_array(jsonb_build_object('item_name',CASE WHEN label='named' THEN 'Exact item' END,'description','Exact description','quantity',2,'unit_price',1.2345,'vat_rate',15))));
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'issue',(result->>'updated_at')::timestamptz) FROM ix_cases$$,'precise XML sources pass real issue validation');
RESET ROLE;
UPDATE ix_cases c SET result=c.result||jsonb_build_object('updated_at',i.updated_at) FROM public.invoices i WHERE i.id=(c.result->>'id')::uuid;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.transition_my_invoice((result->>'id')::uuid,'finalize',(result->>'updated_at')::timestamptz) FROM ix_cases$$,'precise XML sources pass real finalization');
RESET ROLE;
CREATE FUNCTION pg_temp.ix_xml(p_label text) RETURNS text LANGUAGE sql AS $$
 SELECT format('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>%s</cbc:ID><cbc:UUID>%s</cbc:UUID><cbc:IssueDate>%s</cbc:IssueDate><cbc:IssueTime>%s</cbc:IssueTime><cbc:InvoiceTypeCode>388</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>%s</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>%s</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">0.37</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>2.47</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>2.84</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity>2</cbc:InvoicedQuantity><cbc:LineExtensionAmount>2.47</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount>0.37</cbc:TaxAmount></cac:TaxTotal><cac:Item>%s<cbc:Name>%s</cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>15</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount>1.2345</cbc:PriceAmount></cac:Price></cac:InvoiceLine></Invoice>',i.invoice_number,c.doc_id,to_char(c.issued_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD'),to_char(c.issued_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS'),s.last_counter+1,s.last_invoice_hash,CASE WHEN p_label='named' THEN '<cbc:Description>Exact description</cbc:Description>' ELSE '' END,CASE WHEN p_label='named' THEN 'Exact item' ELSE 'Exact description' END)
 FROM ix_cases c JOIN public.invoices i ON i.id=(c.result->>'id')::uuid CROSS JOIN public.zatca_issuance_streams s WHERE c.label=p_label AND s.id='95400000-0000-4000-8000-000000000003';
$$;
CREATE FUNCTION pg_temp.ix_record(p_label text,p_xml text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_zatca_issuance(t.id,s.id,'invoice',(c.result->>'id')::uuid,c.doc_id,c.issued_at,s.last_counter,s.last_invoice_hash,p_xml,p_xml,encode(sha256(convert_to(p_xml,'UTF8')),'base64'),'95400000-0000-4000-8000-000000000001') FROM ix_cases c CROSS JOIN ix_tenant t CROSS JOIN public.zatca_issuance_streams s WHERE c.label=p_label AND s.id='95400000-0000-4000-8000-000000000003';
$$;
UPDATE ix_cases SET xml=pg_temp.ix_xml(label) WHERE label='named';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.ix_record(label,replace(xml,'<cbc:PriceAmount>1.2345</cbc:PriceAmount>','<cbc:PriceAmount>1.23</cbc:PriceAmount>')) FROM ix_cases WHERE label='named'$$,'ZTC_XML:%','XML cannot silently round the persisted unit price');
SELECT throws_like($$SELECT pg_temp.ix_record(label,replace(xml,'<cbc:Name>Exact item</cbc:Name>','<cbc:Name>Different item</cbc:Name>')) FROM ix_cases WHERE label='named'$$,'ZTC_XML:%','XML item name remains bound to the immutable source');
SELECT throws_like($$SELECT pg_temp.ix_record(label,replace(xml,'<cbc:Description>Exact description</cbc:Description>','')) FROM ix_cases WHERE label='named'$$,'ZTC_XML:%','XML cannot drop the separate description when an item name exists');
SELECT throws_like($$SELECT pg_temp.ix_record(label,replace(xml,'<cbc:Description>Exact description</cbc:Description>','<cbc:Description>Different description</cbc:Description>')) FROM ix_cases WHERE label='named'$$,'ZTC_XML:%','XML cannot change the separately retained description');
SELECT lives_ok($$UPDATE ix_cases SET recorded=pg_temp.ix_record(label,xml) WHERE label='named'$$,'trusted non-production preparation retains the exact source fields');
RESET ROLE;
SELECT is((SELECT last_counter::int FROM public.zatca_issuance_streams WHERE id='95400000-0000-4000-8000-000000000003'),1,'rejected variants consumed no counter or issuance identity');
SELECT is((SELECT source_snapshot->'lines'->0->>'item_name' FROM public.zatca_document_issuances),'Exact item','stored preparation snapshot contains the real separate item name');
SELECT is((SELECT (source_snapshot->'lines'->0->>'unit_price')::numeric FROM public.zatca_document_issuances),1.2345::numeric,'stored preparation snapshot retains full unit price');
UPDATE ix_cases SET xml=pg_temp.ix_xml(label) WHERE label='legacy';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.ix_record(label,replace(xml,'<cbc:Name>Exact description</cbc:Name>','<cbc:Description>Invented</cbc:Description><cbc:Name>Exact description</cbc:Name>')) FROM ix_cases WHERE label='legacy'$$,'ZTC_XML:%','legacy sources cannot acquire a fabricated separate item field');
SELECT lives_ok($$UPDATE ix_cases SET recorded=pg_temp.ix_record(label,xml) WHERE label='legacy'$$,'legacy description-name XML remains supported without price loss');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.zatca_document_issuances),2,'only the two exact source preparations are retained');
SELECT is((SELECT last_counter::int FROM public.zatca_issuance_streams WHERE id='95400000-0000-4000-8000-000000000003'),2,'source variants do not create chain gaps');
SELECT * FROM finish();
ROLLBACK;
