-- ZATCA IssueDate/IssueTime are the seller's local (Asia/Riyadh, UTC+3, no DST)
-- calendar date and wall-clock time. Recording them in UTC put documents issued
-- between 21:00 and 24:00 UTC on the previous calendar day (wrong VAT period
-- at month/quarter ends) and disagreed with the Phase 2 QR timestamp derived
-- from the same fields. issued_at stays an absolute timestamptz; only the XML
-- identity check now compares against the Riyadh-local rendering.
CREATE OR REPLACE FUNCTION public.record_zatca_issuance(
  p_tenant uuid, p_stream uuid, p_source_type text, p_source_id uuid,
  p_document_uuid uuid, p_issued_at timestamptz, p_expected_counter bigint,
  p_previous_hash text, p_xml text, p_canonical_xml text, p_invoice_hash text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_stream public.zatca_issuance_streams%ROWTYPE;
  v_existing public.zatca_document_issuances%ROWTYPE;
  v_source jsonb; v_lines jsonb; v_ref text; v_xml xml; v_currency text;
  v_ns text[][] := ARRAY[
    ARRAY['i','urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'],
    ARRAY['cbc','urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'],
    ARRAY['cac','urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2']];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_user_id=p_actor AND tenant_id=p_tenant
    AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until <= now())) THEN
    RAISE EXCEPTION 'ZTC_ACTOR: active tenant actor required' USING ERRCODE='42501';
  END IF;
  -- Lock ordering: EGS stream, then financial source. Competing writers either
  -- replay the stored artifact or lose the optimistic counter check.
  SELECT * INTO v_stream FROM public.zatca_issuance_streams WHERE id=p_stream AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZTC_STREAM: issuance stream not found'; END IF;
  SELECT * INTO v_existing FROM public.zatca_document_issuances WHERE tenant_id=p_tenant
    AND environment=v_stream.environment AND source_type=p_source_type AND source_id=p_source_id;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;
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
  IF v_source IS NULL OR v_source->>'status' IS DISTINCT FROM 'finalized' OR v_source->>'deleted_at' IS NOT NULL
     OR jsonb_array_length(coalesce(v_lines,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'ZTC_SOURCE: finalized sales document required';
  END IF;
  IF p_source_type <> 'invoice' AND NOT EXISTS (SELECT 1 FROM public.invoices
    WHERE id=(v_source->>'reference_invoice_id')::uuid AND tenant_id=p_tenant AND invoice_type='sales') THEN
    RAISE EXCEPTION 'ZTC_SOURCE: finalized sales document required';
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
        line_no int PATH 'cbc:ID', description text PATH 'cac:Item/cbc:Name',
        quantity numeric PATH 'cbc:InvoicedQuantity', unit_price numeric PATH 'cac:Price/cbc:PriceAmount',
        amount numeric PATH 'cbc:LineExtensionAmount', vat_amount numeric PATH 'cac:TaxTotal/cbc:TaxAmount',
        vat_rate numeric PATH 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent',
        discount numeric PATH 'sum(cac:AllowanceCharge[cbc:ChargeIndicator="false"]/cbc:Amount)') x
      FULL JOIN jsonb_array_elements(v_lines) l ON x.line_no=(l->>'line_no')::int
      WHERE x.line_no IS NULL OR l IS NULL OR x.description IS DISTINCT FROM l->>'description'
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
$$;
REVOKE ALL ON FUNCTION public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
