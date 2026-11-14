-- Restore the reviewed contracts after the later upstream redefinitions.
-- Function definitions and privileges only; no source, receipt or financial row changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.read_my_accounting_master_page(p_kind text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('read');q text;rows jsonb;n bigint;summary jsonb;term text;action text;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_kind IS NULL OR p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_export IS NULL THEN RAISE EXCEPTION 'MASTER_INVALID: invalid page request' USING ERRCODE='22023';END IF;
 IF p_export THEN PERFORM accounting_master_private.require_caller('export');END IF;
 PERFORM accounting_master_private.lock_catalog(t);term:=btrim(p_search);
 IF p_kind='accounts' THEN
  q:='SELECT * FROM accounting_master_private.account_rows($1) WHERE strpos(lower(concat_ws('' '',account_code,name_ar,name_en,description)),lower($2))>0';
  SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE is_active),'assets',count(*) FILTER(WHERE account_type='asset'),'income_expense',count(*) FILTER(WHERE account_type IN('income','expense'))) INTO summary FROM public.chart_of_accounts WHERE tenant_id=t AND deleted_at IS NULL;
 ELSE
  q:=format('SELECT id,%I AS code,name_ar,name_en,phone,email,tax_number,address,city,district,building_number,additional_number,postal_code,country_code,credit_limit::text,is_active,updated_at FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws('' '',%I,name_ar,name_en,phone,email,tax_number,address,city,district,building_number,additional_number,postal_code,country_code)),lower($2))>0',CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END,p_kind,CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END);
  EXECUTE format('SELECT jsonb_build_object(''total'',count(*),''active'',count(*) FILTER(WHERE is_active),''tax_registered'',count(*) FILTER(WHERE tax_number IS NOT NULL AND tax_number<>''''),''avg_credit_limit'',round(coalesce(avg(credit_limit),0),2)::text) FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL',p_kind) INTO summary USING t;
 END IF;
 EXECUTE 'SELECT count(*) FROM ('||q||') r' INTO n USING t,term;
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'MASTER_EXPORT_LIMIT: narrow the export search' USING ERRCODE='54000';END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id),''[]''::jsonb) FROM (SELECT * FROM ('||q||') data ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id LIMIT $3 OFFSET $4)r' INTO rows USING t,term,CASE WHEN p_export THEN n ELSE p_page_size END,CASE WHEN p_export THEN 0 ELSE(p_page::bigint-1)*p_page_size END;
 IF p_export THEN action:=CASE p_kind WHEN 'accounts' THEN 'chart_of_accounts_exported' WHEN 'customers' THEN 'customer_list_exported' ELSE 'supplier_list_exported' END;INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,action,jsonb_build_object('rows',n,'filtered',term<>''));END IF;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size,'summary',summary);
END$$;

CREATE OR REPLACE FUNCTION public.record_zatca_issuance(p_tenant uuid, p_stream uuid, p_source_type text, p_source_id uuid, p_document_uuid uuid, p_issued_at timestamp with time zone, p_expected_counter bigint, p_previous_hash text, p_xml text, p_canonical_xml text, p_invoice_hash text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  v_stream public.zatca_issuance_streams%ROWTYPE;
  v_existing public.zatca_document_issuances%ROWTYPE;
  v_source jsonb; v_lines jsonb; v_ref text; v_xml xml; v_currency text;
  v_ns text[][] := ARRAY[
    ARRAY['i','urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'],
    ARRAY['cbc','urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'],
    ARRAY['cac','urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2']];
BEGIN
  IF NOT public.zatca_operator_authorized(p_tenant,p_actor) THEN
    RAISE EXCEPTION 'ZTC_ACTOR: active tenant actor required' USING ERRCODE='42501';
  END IF;
  -- Lock ordering: EGS stream, then financial source. Competing writers either
  -- replay the stored artifact or lose the optimistic counter check.
  SELECT * INTO v_stream FROM public.zatca_issuance_streams WHERE id=p_stream AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZTC_STREAM: issuance stream not found'; END IF;
  SELECT * INTO v_existing FROM public.zatca_document_issuances WHERE tenant_id=p_tenant
    AND environment=v_stream.environment AND source_type=p_source_type AND source_id=p_source_id;
  IF p_source_type='invoice' THEN
    SELECT to_jsonb(i) INTO v_source FROM public.invoices i WHERE id=p_source_id AND tenant_id=p_tenant FOR SHARE;
    IF v_source->>'invoice_type' IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'ZTC_SOURCE: finalized sales document required'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY line_no),'[]'::jsonb) INTO v_lines
      FROM public.invoice_lines l WHERE invoice_id=p_source_id AND tenant_id=p_tenant;
    v_ref := v_source->>'invoice_number';
  ELSIF p_source_type='credit_note' THEN
    SELECT to_jsonb(n) INTO v_source FROM public.credit_notes n WHERE id=p_source_id AND tenant_id=p_tenant FOR SHARE;
    v_ref := v_source->>'credit_note_number'; v_lines := v_source->'lines';
  ELSIF p_source_type='debit_note' THEN
    SELECT to_jsonb(n) INTO v_source FROM public.debit_notes n WHERE id=p_source_id AND tenant_id=p_tenant FOR SHARE;
    v_ref := v_source->>'debit_note_number'; v_lines := v_source->'lines';
  ELSE RAISE EXCEPTION 'ZTC_SOURCE: unsupported source document'; END IF;
  IF v_source IS NULL OR v_source->>'deleted_at' IS NOT NULL
     OR NOT (v_source->>'status'='finalized' OR (v_existing.id IS NOT NULL AND p_source_type='invoice'
       AND v_source->>'status' IN ('paid','partially_paid','overdue')))
     OR jsonb_array_length(coalesce(v_lines,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'ZTC_SOURCE: finalized sales document required';
  END IF;
  IF p_source_type <> 'invoice' AND NOT EXISTS (SELECT 1 FROM public.invoices
    WHERE id=(v_source->>'reference_invoice_id')::uuid AND tenant_id=p_tenant AND invoice_type='sales') THEN
    RAISE EXCEPTION 'ZTC_SOURCE: finalized sales document required';
  END IF;
  -- Replay only after the financial source has been locked and checked.
  -- Paid documents reuse their stored identity; no payment state allocates a
  -- new ICV. Cancelled/deleted sources cannot be revived by a retry.
  IF v_existing.id IS NOT NULL THEN RETURN to_jsonb(v_existing); END IF;
  IF p_expected_counter IS NULL OR p_previous_hash IS NULL OR
    p_expected_counter <> v_stream.last_counter OR p_previous_hash <> v_stream.last_invoice_hash THEN
    RAISE EXCEPTION 'ZTC_CONFLICT: issuance stream changed; reload before preparing';
  END IF;
  IF p_document_uuid IS NULL OR p_issued_at IS NULL OR
    abs(extract(epoch FROM clock_timestamp()-p_issued_at)) > 300 THEN
    RAISE EXCEPTION 'ZTC_TIME: fresh preparation timestamp and document UUID required';
  END IF;
  IF p_xml IS NULL OR p_canonical_xml IS NULL OR p_invoice_hash IS NULL OR
    octet_length(p_xml) NOT BETWEEN 1 AND 2097152 OR octet_length(p_canonical_xml) NOT BETWEEN 1 AND 2097152 OR
    p_invoice_hash <> encode(sha256(convert_to(p_canonical_xml,'UTF8')),'base64') OR
    NOT xml_is_well_formed_document(p_xml) THEN
    RAISE EXCEPTION 'ZTC_XML: valid bounded XML and canonical digest required';
  END IF;
  v_xml := p_xml::xml;
  v_currency := (xpath('string(/i:Invoice/cbc:DocumentCurrencyCode)',v_xml,v_ns))[1]::text;
  IF (xpath('string(/i:Invoice/cbc:UUID)',v_xml,v_ns))[1]::text IS DISTINCT FROM p_document_uuid::text
    OR (xpath('string(/i:Invoice/cbc:ID)',v_xml,v_ns))[1]::text IS DISTINCT FROM v_ref
    OR (xpath('string(/i:Invoice/cbc:InvoiceTypeCode)',v_xml,v_ns))[1]::text IS DISTINCT FROM
      (CASE p_source_type WHEN 'invoice' THEN '388' WHEN 'credit_note' THEN '381' ELSE '383' END)
    OR (xpath('string(/i:Invoice/cac:AdditionalDocumentReference[cbc:ID="ICV"]/cbc:UUID)',v_xml,v_ns))[1]::text IS DISTINCT FROM (p_expected_counter+1)::text
    OR (xpath('string(/i:Invoice/cac:AdditionalDocumentReference[cbc:ID="PIH"]/cac:Attachment/cbc:EmbeddedDocumentBinaryObject)',v_xml,v_ns))[1]::text IS DISTINCT FROM p_previous_hash
    OR (xpath('string(/i:Invoice/cbc:IssueDate)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char(p_issued_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD')
    OR (xpath('string(/i:Invoice/cbc:IssueTime)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char(p_issued_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS')
    OR v_currency IS DISTINCT FROM v_source->>'currency'
    OR (xpath('string(/i:Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char((v_source->>'subtotal')::numeric,'FM999999999999990.00')
    OR (xpath('string(/i:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char((v_source->>'total')::numeric,'FM999999999999990.00') THEN
    RAISE EXCEPTION 'ZTC_XML: document identity, issuance metadata or financial totals mismatch';
  END IF;
  IF (xpath('string((/i:Invoice/cac:TaxTotal/cbc:TaxAmount[@currencyID=/i:Invoice/cbc:DocumentCurrencyCode])[last()])',v_xml,v_ns))[1]::text
      IS DISTINCT FROM to_char((v_source->>'vat_amount')::numeric,'FM999999999999990.00')
    OR cardinality(xpath('/i:Invoice/cac:InvoiceLine',v_xml,v_ns)) <> jsonb_array_length(v_lines)
    OR EXISTS (
      SELECT 1 FROM XMLTABLE(XMLNAMESPACES(
        'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2' AS i,
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2' AS cac,
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2' AS cbc),
        '/i:Invoice/cac:InvoiceLine' PASSING v_xml COLUMNS
        line_no int PATH 'cbc:ID', item_name text PATH 'cac:Item/cbc:Name', item_description text PATH 'cac:Item/cbc:Description',
        quantity numeric PATH 'cbc:InvoicedQuantity', unit_price numeric PATH 'cac:Price/cbc:PriceAmount',
        amount numeric PATH 'cbc:LineExtensionAmount', vat_amount numeric PATH 'cac:TaxTotal/cbc:TaxAmount',
        vat_rate numeric PATH 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent',
        discount numeric PATH 'sum(cac:AllowanceCharge[cbc:ChargeIndicator="false"]/cbc:Amount)') x
      FULL JOIN jsonb_array_elements(v_lines) l ON x.line_no=(l->>'line_no')::int
      WHERE x.line_no IS NULL OR l IS NULL OR x.item_name IS DISTINCT FROM COALESCE(NULLIF(l->>'item_name',''),l->>'description')
        OR x.item_description IS DISTINCT FROM CASE WHEN NULLIF(l->>'item_name','') IS NOT NULL THEN l->>'description' END
        OR x.quantity IS DISTINCT FROM (l->>'quantity')::numeric OR x.unit_price IS DISTINCT FROM (l->>'unit_price')::numeric
        OR x.amount IS DISTINCT FROM (l->>'amount')::numeric OR x.vat_amount IS DISTINCT FROM (l->>'vat_amount')::numeric
        OR x.vat_rate IS DISTINCT FROM (l->>'vat_rate')::numeric OR x.discount IS DISTINCT FROM coalesce((l->>'discount')::numeric,0)
    ) THEN RAISE EXCEPTION 'ZTC_XML: invoice lines or tax differ from the immutable source'; END IF;
  INSERT INTO public.zatca_document_issuances(id,tenant_id,stream_id,environment,source_type,source_id,doc_ref,
    issued_at,invoice_counter,previous_invoice_hash,invoice_hash,unsigned_xml,canonical_xml,source_snapshot,created_by)
  VALUES (p_document_uuid,p_tenant,p_stream,v_stream.environment,p_source_type,p_source_id,v_ref,p_issued_at,
    p_expected_counter+1,p_previous_hash,p_invoice_hash,p_xml,p_canonical_xml,
    jsonb_build_object('document',v_source,'lines',v_lines),p_actor)
  RETURNING * INTO v_existing;
  RETURN to_jsonb(v_existing);
END;
$function$;

-- Party address edits use mutate_my_accounting_master's version and receipt guard.
REVOKE ALL ON FUNCTION public.set_my_party_national_address(text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
