BEGIN;
SELECT no_plan();
-- Synthetic persistence evidence only: these rows make no authority claim.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('15600000-0000-4000-8000-000000000001','transmission156@example.test','{"_invite_provisioned":true}'),
 ('15600000-0000-4000-8000-000000000002','transmission156foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE z156_tenants(label text PRIMARY KEY,id uuid);
INSERT INTO z156_tenants VALUES
 ('own',(public.provision_company_atomic('15600000-0000-4000-8000-000000000001','{"name":"Transmission reconciliation","slug":"transmission156","domain":"transmission156.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('15600000-0000-4000-8000-000000000002','{"name":"Foreign transmission","slug":"transmission156f","domain":"transmission156f.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('15600000-0000-4000-8000-000000000001','15600000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,tenant_id,name_ar) SELECT '15600000-0000-4000-8000-000000000003',id,'Synthetic transmission customer' FROM z156_tenants WHERE label='own';
INSERT INTO public.invoices(id,tenant_id,invoice_type,customer_id,issue_date,due_date,subtotal,vat_amount,total,vat_rate,status,created_by)
 SELECT '15600000-0000-4000-8000-000000000004',id,'sales','15600000-0000-4000-8000-000000000003',current_date,current_date,100,15,115,15,'finalized','15600000-0000-4000-8000-000000000001' FROM z156_tenants WHERE label='own';
INSERT INTO public.credit_notes(id,tenant_id,credit_note_number,reference_invoice_id,customer_id,issue_date,subtotal,vat_amount,total,reason,lines,created_by)
 SELECT '15600000-0000-4000-8000-000000000005',id,'CN156','15600000-0000-4000-8000-000000000004','15600000-0000-4000-8000-000000000003',current_date,10,1.5,11.5,'Synthetic credit','[{"line_no":1,"item_name":"Item","description":"Description","quantity":1,"unit_price":10,"amount":10,"vat_rate":15,"vat_amount":1.5}]','15600000-0000-4000-8000-000000000001' FROM z156_tenants WHERE label='own';
INSERT INTO public.debit_notes(id,tenant_id,debit_note_number,reference_invoice_id,customer_id,issue_date,subtotal,vat_amount,total,reason,lines,created_by)
 SELECT '15600000-0000-4000-8000-000000000006',id,'DN156','15600000-0000-4000-8000-000000000004','15600000-0000-4000-8000-000000000003',current_date,10,1.5,11.5,'Synthetic debit','[{"line_no":1,"item_name":"Item","description":"Description","quantity":1,"unit_price":10,"amount":10,"vat_rate":15,"vat_amount":1.5}]','15600000-0000-4000-8000-000000000001' FROM z156_tenants WHERE label='own';
CREATE TEMP TABLE z156_before AS SELECT to_jsonb(i)-ARRAY['zatca_status','zatca_uuid','updated_by','updated_at'] value FROM public.invoices i WHERE id='15600000-0000-4000-8000-000000000004';
GRANT SELECT ON z156_tenants,z156_before TO service_role,authenticated;
CREATE FUNCTION pg_temp.z156_record(p_type text,p_source uuid,p_status public.zatca_status,p_uuid text DEFAULT NULL,p_response jsonb DEFAULT '{"sandbox":true}',p_payload text DEFAULT '<Invoice>synthetic</Invoice>',p_actor uuid DEFAULT '15600000-0000-4000-8000-000000000001',p_tenant uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$
 SELECT public.record_zatca_transmission(coalesce(p_tenant,(SELECT id FROM z156_tenants WHERE label='own')),p_actor,p_type,p_source,p_payload,p_status,p_uuid,p_response,NULL,clock_timestamp());
$$;
SELECT ok(has_function_privilege('service_role','public.record_zatca_transmission(uuid,uuid,text,uuid,text,public.zatca_status,text,jsonb,text,timestamptz)','EXECUTE'),'trusted service may record a bounded submission result');
SELECT ok(NOT has_function_privilege(r,'public.record_zatca_transmission(uuid,uuid,text,uuid,text,public.zatca_status,text,jsonb,text,timestamptz)','EXECUTE'),r||' cannot invoke the privileged status seam') FROM unnest(ARRAY['anon','authenticated'])r;

-- A downstream failure must roll the newly inserted transmission back too.
CREATE FUNCTION pg_temp.z156_fail_invoice_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.zatca_uuid='synthetic-atomic-failure' THEN RAISE EXCEPTION 'synthetic atomic failure';END IF;RETURN NEW;END $$;
CREATE TRIGGER z156_fail_invoice_update BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION pg_temp.z156_fail_invoice_update();
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed','synthetic-atomic-failure')$$,'P0001','synthetic atomic failure','invoice write failure rolls the source transmission back');
SELECT is((SELECT count(*)::int FROM public.zatca_transmissions WHERE tenant_id=(SELECT id FROM z156_tenants WHERE label='own')),0,'failed status transaction leaves no partial transmission');
SELECT throws_ok($$UPDATE public.invoices SET zatca_status='reported' WHERE id='15600000-0000-4000-8000-000000000004'$$,'42501','FIN_LEGACY_WRITE: use the guarded finance workflow','legacy direct service invoice writes remain blocked');
SELECT throws_ok($$UPDATE public.invoices SET total=total WHERE false$$,'42501','FIN_LEGACY_WRITE: use the guarded finance workflow','statement guard still rejects even empty direct finance mutations');
SELECT throws_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed',NULL,'{"sandbox":true}','<Invoice/>','15600000-0000-4000-8000-000000000002')$$,'42501','ZTC_ACTOR: active tenant operator required','foreign tenant operator cannot record another tenant source');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice',gen_random_uuid(),'failed')$$,'ZTC_SOURCE:%','unknown source cannot acquire a transmission');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed',NULL,'{"sandbox":true}','<Invoice/>','15600000-0000-4000-8000-000000000002',(SELECT id FROM z156_tenants WHERE label='foreign'))$$,'ZTC_SOURCE:%','authorized foreign operator cannot bind a source from another tenant');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported',NULL,'{}')$$,'ZTC_EVIDENCE:%','accepted-looking status without retained issuance or explicit mock is rejected');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed')$$,'authorized mock result records its invoice and source atomically');
SELECT is((SELECT zatca_status::text FROM public.invoices WHERE id='15600000-0000-4000-8000-000000000004'),'failed','invoice ZATCA status reflects the persisted outcome');
SELECT lives_ok($$SELECT pg_temp.z156_record('credit_note','15600000-0000-4000-8000-000000000005','failed')$$,'credit note gets its own source transmission');
SELECT lives_ok($$SELECT pg_temp.z156_record('debit_note','15600000-0000-4000-8000-000000000006','failed')$$,'debit note gets its own source transmission');
SELECT is((SELECT count(*)::int FROM public.zatca_transmissions WHERE tenant_id=(SELECT id FROM z156_tenants WHERE label='own')),3,'invoice, credit and debit remain separately keyed despite sharing one invoice');
SELECT is((SELECT zatca_status::text FROM public.invoices WHERE id='15600000-0000-4000-8000-000000000004'),'failed','note outcomes cannot overwrite their reference invoice status');
RESET ROLE;
DROP TRIGGER z156_fail_invoice_update ON public.invoices;

-- Direct synthetic immutable ledger fixtures isolate the result seam from the
-- separate issuance validator (covered by test155 and test152).
INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial) SELECT '15600000-0000-4000-8000-000000000010',id,'sandbox','Synthetic156' FROM z156_tenants WHERE label='own';
INSERT INTO public.zatca_document_issuances(id,tenant_id,stream_id,environment,source_type,source_id,doc_ref,issued_at,invoice_counter,previous_invoice_hash,invoice_hash,unsigned_xml,canonical_xml,source_snapshot,created_by)
 SELECT '15600000-0000-4000-8000-000000000011',t.id,s.id,'sandbox','invoice','15600000-0000-4000-8000-000000000004','Synthetic retained invoice',clock_timestamp(),1,s.last_invoice_hash,encode(sha256(convert_to('<Invoice>retained synthetic</Invoice>','UTF8')),'base64'),'<Invoice>retained synthetic</Invoice>','<Invoice>retained synthetic</Invoice>','{}','15600000-0000-4000-8000-000000000001' FROM z156_tenants t JOIN public.zatca_issuance_streams s ON s.tenant_id=t.id WHERE t.label='own' AND s.id='15600000-0000-4000-8000-000000000010';
CREATE TEMP TABLE z156_response AS SELECT jsonb_build_object('issuance_id',id,'environment',environment,'invoice_hash',invoice_hash,'pipeline','reporting') value FROM public.zatca_document_issuances WHERE id='15600000-0000-4000-8000-000000000011';
-- Separate environments prepare separate issuances but project into the same invoice.
INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial)
  SELECT '15600000-0000-4000-8000-000000000012',id,'simulation','Synthetic156Sim' FROM z156_tenants WHERE label='own';
INSERT INTO public.zatca_document_issuances(id,tenant_id,stream_id,environment,source_type,source_id,doc_ref,issued_at,invoice_counter,previous_invoice_hash,invoice_hash,unsigned_xml,canonical_xml,source_snapshot,created_by)
  SELECT '15600000-0000-4000-8000-000000000013',d.tenant_id,s.id,'simulation',d.source_type,d.source_id,d.doc_ref,
    clock_timestamp(),1,s.last_invoice_hash,d.invoice_hash,d.unsigned_xml,d.canonical_xml,d.source_snapshot,d.created_by
  FROM public.zatca_document_issuances d JOIN public.zatca_issuance_streams s ON s.tenant_id=d.tenant_id
  WHERE d.id='15600000-0000-4000-8000-000000000011' AND s.id='15600000-0000-4000-8000-000000000012';
CREATE TEMP TABLE z156_simulation AS
  SELECT jsonb_build_object('issuance_id',id,'environment',environment,'invoice_hash',invoice_hash,'pipeline','clearance') value
  FROM public.zatca_document_issuances WHERE id='15600000-0000-4000-8000-000000000013';
GRANT SELECT ON z156_response, z156_simulation TO service_role;
CREATE TEMP TABLE z156_claims(label text PRIMARY KEY, result jsonb);
GRANT SELECT, INSERT ON z156_claims TO service_role;
CREATE FUNCTION pg_temp.z156_claim(p_pipeline text DEFAULT 'clearance', p_environment text DEFAULT 'sandbox',
  p_actor uuid DEFAULT '15600000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.claim_zatca_submission(
    (SELECT id FROM z156_tenants WHERE label='own'), p_actor,
    '15600000-0000-4000-8000-000000000011', p_environment, p_pipeline
  );
$$;
CREATE FUNCTION pg_temp.z156_finish(p_label text, p_status text,
  p_actor uuid DEFAULT '15600000-0000-4000-8000-000000000001') RETURNS timestamptz LANGUAGE sql AS $$
  SELECT public.finish_zatca_submission(
    (SELECT id FROM z156_tenants WHERE label='own'), p_actor,
    '15600000-0000-4000-8000-000000000011', (SELECT (result->>'token')::uuid FROM z156_claims WHERE label=p_label),
    jsonb_build_object('status',p_status,'http_status',200,'signed_xml','<Invoice>signed</Invoice>','response','{"retained":true}'::jsonb)
  );
$$;
SELECT ok(NOT has_function_privilege(role_name,'public.claim_zatca_submission(uuid,uuid,uuid,text,text)','EXECUTE'),role_name||' cannot claim a provider submission')
  FROM unnest(ARRAY['anon','authenticated']) role_name;
SELECT ok(NOT has_function_privilege(role_name,'public.finish_zatca_submission(uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),role_name||' cannot finish a provider submission')
  FROM unnest(ARRAY['anon','authenticated']) role_name;
SELECT ok(NOT has_schema_privilege('service_role','zatca_submission_private','USAGE'),'service cannot access claim rows directly');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.z156_claim('clearance','simulation')$$,'ZTC_ISSUANCE:%','a claim cannot cross submission environments');
SELECT throws_like($$SELECT pg_temp.z156_claim('reporting')$$,'ZTC_PIPELINE:%','only the prepared document pipeline can hold a claim');
SELECT throws_ok($$SELECT pg_temp.z156_claim('clearance','sandbox','15600000-0000-4000-8000-000000000002')$$,
  '42501','ZTC_ACTOR: active tenant operator required','another tenant operator cannot claim this issuance');
INSERT INTO z156_claims VALUES ('old',pg_temp.z156_claim());
SELECT is((SELECT result->>'state' FROM z156_claims WHERE label='old'),'claimed','first worker receives the provider claim');
SELECT is(pg_temp.z156_claim()->>'state','busy','second worker cannot send while the claim is live');
SELECT throws_ok($$SELECT pg_temp.z156_finish('old','cleared','15600000-0000-4000-8000-000000000002')$$,
  '42501','ZTC_CLAIM: submission claim is no longer current','a different actor cannot use the claim token');
SELECT throws_like($$SELECT pg_temp.z156_finish('old','reported')$$,'ZTC_ATTEMPT:%','a reporting status cannot complete a clearance claim');
SELECT is(pg_temp.z156_claim()->>'state','busy','rejected evidence leaves the claim intact');
RESET ROLE;
UPDATE zatca_submission_private.claims SET expires_at=clock_timestamp()-interval '1 second'
  WHERE issuance_id='15600000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
INSERT INTO z156_claims VALUES ('new',pg_temp.z156_claim());
SELECT is((SELECT result->>'state' FROM z156_claims WHERE label='new'),'claimed','another worker can recover an expired claim');
SELECT isnt((SELECT result->>'token' FROM z156_claims WHERE label='old'),
  (SELECT result->>'token' FROM z156_claims WHERE label='new'),'recovering a claim replaces its token');
SELECT throws_ok($$SELECT pg_temp.z156_finish('old','failed')$$,'42501','ZTC_CLAIM: submission claim is no longer current','the expired token cannot persist an outcome');
INSERT INTO z156_claims VALUES ('recorded',to_jsonb(pg_temp.z156_finish('new','cleared')));
SELECT is(pg_temp.z156_claim()->>'state','accepted','committed acceptance prevents another claim');
SELECT is(pg_temp.z156_claim()->'response','{"retained":true}'::jsonb,'accepted claim returns only retained gateway validation evidence');
SELECT is(pg_temp.z156_claim()->'created_at',(SELECT result FROM z156_claims WHERE label='recorded'),'acceptance replay preserves the recorded submission time');
SELECT is((SELECT count(*)::integer FROM public.zatca_submission_attempts WHERE issuance_id='15600000-0000-4000-8000-000000000011'),1,
  'exactly one outcome is retained after invalid and stale completion attempts');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed',
  '15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,
  'a late failure can finish before accepted evidence is projected');
SELECT is((SELECT response->>'sandbox' FROM public.zatca_transmissions WHERE source_id='15600000-0000-4000-8000-000000000004'),
  'true','a late failure cannot project failure over durable acceptance awaiting projection');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed',
  '15600000-0000-4000-8000-000000000013',(SELECT value FROM z156_simulation),'<Invoice>retained synthetic</Invoice>')$$,
  'a different environment can report failure before accepted evidence is projected');
SELECT is((SELECT response->>'sandbox' FROM public.zatca_transmissions WHERE source_id='15600000-0000-4000-8000-000000000004'),
  'true','a late failure from another environment cannot replace durable acceptance awaiting projection');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported')$$,
  'an offline mock can finish before accepted evidence is projected');
SELECT is((SELECT status::text FROM public.zatca_transmissions WHERE source_id='15600000-0000-4000-8000-000000000004'),
  'failed','an offline mock cannot project mock acceptance when signed acceptance awaits projection');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'ZTC_EVIDENCE:%','network acceptance requires a matching retained submission attempt');
SELECT throws_like($$SELECT pg_temp.z156_record('credit_note','15600000-0000-4000-8000-000000000005','failed','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'ZTC_EVIDENCE:%','invoice issuance cannot be relabelled as a credit note source');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>changed</Invoice>')$$,'ZTC_EVIDENCE:%','transmission payload must equal the retained issuance bytes');
INSERT INTO public.zatca_submission_attempts(tenant_id,issuance_id,environment,pipeline,status,invoice_hash,signed_xml,response,created_by)
 SELECT tenant_id,id,environment,'compliance','reported',invoice_hash,'<Invoice>synthetic compliance evidence</Invoice>','{}','15600000-0000-4000-8000-000000000001' FROM public.zatca_document_issuances WHERE id='15600000-0000-4000-8000-000000000011';
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'ZTC_EVIDENCE:%','onboarding compliance attempt cannot satisfy reporting evidence');
INSERT INTO public.zatca_submission_attempts(tenant_id,issuance_id,environment,pipeline,status,invoice_hash,signed_xml,response,created_by)
 SELECT tenant_id,id,environment,'reporting','reported',invoice_hash,'<Invoice>synthetic reporting evidence</Invoice>','{}','15600000-0000-4000-8000-000000000001' FROM public.zatca_document_issuances WHERE id='15600000-0000-4000-8000-000000000011';
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'matched non-production reporting evidence may update status');
SELECT is((SELECT count(*)::int FROM public.zatca_transmissions WHERE tenant_id=(SELECT id FROM z156_tenants WHERE label='own')),3,'retry upserts the same source row instead of creating duplicates');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'a late failed worker can finish without changing a signed acceptance');
SELECT is((SELECT status::text FROM public.zatca_transmissions WHERE source_id='15600000-0000-4000-8000-000000000004'),'reported','a late failure cannot replace accepted transmission evidence');
SELECT is((SELECT zatca_status::text FROM public.invoices WHERE id='15600000-0000-4000-8000-000000000004'),'reported','a late failure cannot downgrade the invoice status');
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed')$$,'an offline worker may finish after signed acceptance');
SELECT is((SELECT status::text FROM public.zatca_transmissions WHERE source_id='15600000-0000-4000-8000-000000000004'),'reported','an offline result cannot replace accepted signed evidence');
SELECT is((SELECT to_jsonb(i)-ARRAY['zatca_status','zatca_uuid','updated_by','updated_at'] FROM public.invoices i WHERE id='15600000-0000-4000-8000-000000000004'),(SELECT value FROM z156_before),'status transaction cannot alter any financial or source column');
RESET ROLE;
UPDATE public.invoices SET status='paid' WHERE id='15600000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','reported','15600000-0000-4000-8000-000000000011',(SELECT value FROM z156_response),'<Invoice>retained synthetic</Invoice>')$$,'payment after a prior transmission reuses the retained issuance bytes');
SELECT is((SELECT last_counter::int FROM public.zatca_issuance_streams WHERE id='15600000-0000-4000-8000-000000000010'),1,'payment-state transmission retry consumes no additional ICV');
SELECT throws_like($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed')$$,'ZTC_EVIDENCE:%','payment-state retry cannot fall back to a newly generated mock payload');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.read_my_invoice_page()->'rows'->0->>'zatca_status','reported','complete invoice page exposes the persisted transmission status');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed',
  '15600000-0000-4000-8000-000000000013',(SELECT value FROM z156_simulation),'<Invoice>retained synthetic</Invoice>')$$,
  'a failure in a different environment can complete after an accepted projection');
SELECT is((SELECT zatca_status::text FROM public.invoices WHERE id='15600000-0000-4000-8000-000000000004'),'reported',
  'a failure in a different environment cannot downgrade a signed acceptance');
INSERT INTO public.zatca_submission_attempts(tenant_id,issuance_id,environment,pipeline,status,invoice_hash,signed_xml,response,created_by)
  SELECT tenant_id,id,environment,'clearance','cleared',invoice_hash,'<Invoice>synthetic simulation evidence</Invoice>','{}',created_by
  FROM public.zatca_document_issuances WHERE id='15600000-0000-4000-8000-000000000013';
SELECT lives_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','cleared',
  '15600000-0000-4000-8000-000000000013',(SELECT value FROM z156_simulation),'<Invoice>retained synthetic</Invoice>')$$,
  'valid acceptance in a different environment can refresh the projection');
SELECT is((SELECT zatca_status::text FROM public.invoices WHERE id='15600000-0000-4000-8000-000000000004'),'cleared',
  'the invoice reflects the newer signed acceptance');
RESET ROLE;
-- JWT claims were cleared before testing the other environment.
UPDATE public.users SET status='inactive' WHERE auth_user_id='15600000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT pg_temp.z156_record('invoice','15600000-0000-4000-8000-000000000004','failed')$$,'42501','ZTC_ACTOR: active tenant operator required','inactive operator cannot overwrite an existing transmission');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
