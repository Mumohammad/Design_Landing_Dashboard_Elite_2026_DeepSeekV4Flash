-- Forward reconciliation after the reference invoice and Riyadh time branches.
-- No existing source, receipt, preparation, signature or amount is rewritten.
-- Apply after both branches so fresh and live-plus-pending histories converge.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION public.zatca_operator_authorized(p_tenant uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.tenants t ON t.id=u.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL
    WHERE u.auth_user_id = p_user AND u.tenant_id = p_tenant
      AND u.status = 'active'::public.user_status AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (u.role = 'general_manager'::public.user_role OR EXISTS (
        SELECT 1 FROM public.roles r
        JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = u.tenant_id AND r.name = u.role AND r.deleted_at IS NULL
          AND p.module = 'accounting' AND p.action = 'approve'))
  );
$$;
REVOKE ALL ON FUNCTION public.zatca_operator_authorized(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zatca_operator_authorized(uuid, uuid) TO service_role;

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


CREATE OR REPLACE FUNCTION public.read_my_invoice_page(p_search text DEFAULT '',p_status text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();n bigint;summary jsonb;rows jsonb;
BEGIN
 IF t IS NULL OR auth.uid() IS NULL OR NOT public.user_has_permission('invoices','read') OR (p_export AND NOT public.user_has_permission('invoices','export')) THEN RAISE EXCEPTION 'AUTH007: invoice read/export permission required';END IF;
 IF p_search IS NULL OR length(p_search)>200 OR p_status IS NULL OR p_status NOT IN('all','draft','issued','finalized','paid','partially_paid','overdue','cancelled','credited') OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_export IS NULL THEN RAISE EXCEPTION 'INV002: invalid invoice page request';END IF;
 SELECT jsonb_build_object('total',count(*),'drafts',count(*) FILTER(WHERE status='draft'),'finalized',count(*) FILTER(WHERE status='finalized'),'value_sar',round(coalesce(sum(total) FILTER(WHERE currency='SAR' AND status NOT IN('cancelled','credited')),0),2)::text) INTO summary FROM public.invoices WHERE tenant_id=t AND deleted_at IS NULL;
 SELECT count(*) INTO n FROM public.invoices i LEFT JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=t LEFT JOIN public.suppliers s ON s.id=i.supplier_id AND s.tenant_id=t
 WHERE i.tenant_id=t AND i.deleted_at IS NULL AND (p_status='all' OR i.status::text=p_status) AND (p_search='' OR strpos(lower(concat_ws(' ',i.invoice_number,i.status::text,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower(p_search))>0);
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'INV_EXPORT_LIMIT: narrow the invoice export search';END IF;
 SELECT coalesce(jsonb_agg(q.row ORDER BY q.issue_date DESC,q.id DESC),'[]'::jsonb) INTO rows FROM (
 SELECT i.id,i.issue_date,jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'invoice_type',i.invoice_type,'issue_date',i.issue_date,'due_date',i.due_date,'show_due_date',i.show_due_date,'status',i.status,'zatca_status',i.zatca_status,'subtotal',i.subtotal,'discount',i.discount,'vat_amount',i.vat_amount,'total',i.total,'currency',i.currency,'updated_at',i.updated_at,'customer_id',i.customer_id,'supplier_id',i.supplier_id,'vat_rate',i.vat_rate,'notes',i.notes,'customer_name',c.name_ar,'customer_name_en',c.name_en,'supplier_name',s.name_ar,'supplier_name_en',s.name_en) row
 FROM public.invoices i LEFT JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=t LEFT JOIN public.suppliers s ON s.id=i.supplier_id AND s.tenant_id=t
 WHERE i.tenant_id=t AND i.deleted_at IS NULL AND (p_status='all' OR i.status::text=p_status) AND (p_search='' OR strpos(lower(concat_ws(' ',i.invoice_number,i.status::text,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower(p_search))>0)
 ORDER BY i.issue_date DESC,i.id DESC LIMIT CASE WHEN p_export THEN 10000 ELSE p_page_size END OFFSET CASE WHEN p_export THEN 0 ELSE(p_page-1)*p_page_size END
 )q;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',CASE WHEN p_export THEN 1 ELSE p_page END,'page_size',p_page_size,'summary',summary);
END $$;
REVOKE ALL ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) TO authenticated;

-- Service-only status seam. Its fixed UPDATE projection preserves every
-- finance amount/status/line guard, including aaa_block_legacy_service_write.
-- There is no caller-controlled table/column or request setting bypass.
CREATE FUNCTION public.record_zatca_transmission(
  p_tenant uuid, p_actor uuid, p_source_type text, p_source_id uuid,
  p_payload_xml text, p_status public.zatca_status, p_zatca_uuid text,
  p_response jsonb, p_error_message text, p_transmitted_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_source jsonb; v_ref text;
  v_issuance public.zatca_document_issuances%ROWTYPE;
BEGIN
  IF NOT public.zatca_operator_authorized(p_tenant,p_actor) THEN
    RAISE EXCEPTION 'ZTC_ACTOR: active tenant operator required' USING ERRCODE='42501';
  END IF;
  IF p_source_type NOT IN ('invoice','credit_note','debit_note') OR p_source_type IS NULL
    OR p_source_id IS NULL OR p_status IS NULL OR p_status='not_transmitted'
    OR p_payload_xml IS NULL OR octet_length(p_payload_xml) NOT BETWEEN 1 AND 2097152
    OR jsonb_typeof(p_response) IS DISTINCT FROM 'object'
    OR length(coalesce(p_zatca_uuid,''))>200 OR length(coalesce(p_error_message,''))>2000 THEN
    RAISE EXCEPTION 'ZTC_INPUT: invalid transmission result';
  END IF;
  IF p_source_type='invoice' THEN
    SELECT * INTO v_invoice FROM public.invoices WHERE id=p_source_id AND tenant_id=p_tenant FOR UPDATE;
    v_source:=to_jsonb(v_invoice); v_ref:=v_invoice.invoice_number;
  ELSIF p_source_type='credit_note' THEN
    SELECT to_jsonb(n) INTO v_source FROM public.credit_notes n WHERE id=p_source_id AND tenant_id=p_tenant FOR SHARE;
    v_ref:=v_source->>'credit_note_number';
    SELECT * INTO v_invoice FROM public.invoices WHERE id=(v_source->>'reference_invoice_id')::uuid AND tenant_id=p_tenant FOR SHARE;
  ELSE
    SELECT to_jsonb(n) INTO v_source FROM public.debit_notes n WHERE id=p_source_id AND tenant_id=p_tenant FOR SHARE;
    v_ref:=v_source->>'debit_note_number';
    SELECT * INTO v_invoice FROM public.invoices WHERE id=(v_source->>'reference_invoice_id')::uuid AND tenant_id=p_tenant FOR SHARE;
  END IF;
  IF v_source IS NULL OR v_source->>'id' IS NULL OR v_source->>'deleted_at' IS NOT NULL
    OR v_invoice.id IS NULL OR v_invoice.invoice_type<>'sales' OR v_invoice.deleted_at IS NOT NULL
    OR NOT (v_source->>'status'='finalized' OR (p_source_type='invoice' AND v_source->>'status' IN ('paid','partially_paid','overdue'))) THEN
    RAISE EXCEPTION 'ZTC_SOURCE: immutable sales source required';
  END IF;
  IF p_response ? 'issuance_id' THEN
    SELECT * INTO v_issuance FROM public.zatca_document_issuances d
    WHERE d.id::text=p_response->>'issuance_id' AND d.tenant_id=p_tenant
      AND d.source_type=p_source_type AND d.source_id=p_source_id AND d.environment=p_response->>'environment';
    IF v_issuance.id IS NULL OR v_issuance.id::text IS DISTINCT FROM p_zatca_uuid
      OR v_issuance.unsigned_xml IS DISTINCT FROM p_payload_xml THEN
      RAISE EXCEPTION 'ZTC_EVIDENCE: transmission does not match its issuance';
    END IF;
    IF p_status IN ('reported','cleared') AND NOT EXISTS (
      SELECT 1 FROM public.zatca_submission_attempts a WHERE a.tenant_id=p_tenant
        AND a.issuance_id=v_issuance.id AND a.environment=v_issuance.environment
        AND a.status=p_status::text AND a.invoice_hash=v_issuance.invoice_hash
        AND ((a.pipeline='reporting' AND p_status='reported') OR (a.pipeline='clearance' AND p_status='cleared'))
    ) THEN RAISE EXCEPTION 'ZTC_EVIDENCE: accepted transmission requires retained submission evidence'; END IF;
  ELSIF v_source->>'status'<>'finalized' OR p_response->'sandbox' IS DISTINCT FROM 'true'::jsonb THEN
    -- Offline mocks cannot reclassify a payment-state invoice or masquerade
    -- as a signed environment submission.
    RAISE EXCEPTION 'ZTC_EVIDENCE: retained issuance or explicit mock required';
  END IF;
  INSERT INTO public.zatca_transmissions(tenant_id,invoice_id,source_id,doc_type,doc_ref,payload_xml,
    status,zatca_uuid,response,error_message,transmitted_at,created_by,updated_by)
  VALUES(p_tenant,v_invoice.id,p_source_id,p_source_type,v_ref,p_payload_xml,
    p_status,p_zatca_uuid,p_response,p_error_message,p_transmitted_at,p_actor,p_actor)
  ON CONFLICT (tenant_id,doc_type,source_id) DO UPDATE SET
    payload_xml=EXCLUDED.payload_xml,status=EXCLUDED.status,zatca_uuid=EXCLUDED.zatca_uuid,
    response=EXCLUDED.response,error_message=EXCLUDED.error_message,
    transmitted_at=EXCLUDED.transmitted_at,updated_by=p_actor,updated_at=clock_timestamp();
  IF p_source_type='invoice' THEN
    UPDATE public.invoices SET zatca_status=p_status,zatca_uuid=p_zatca_uuid,updated_by=p_actor
      WHERE id=v_invoice.id AND tenant_id=p_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'ZTC_SOURCE: invoice disappeared'; END IF;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_zatca_transmission(uuid,uuid,text,uuid,text,public.zatca_status,text,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_zatca_transmission(uuid,uuid,text,uuid,text,public.zatca_status,text,jsonb,text,timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
