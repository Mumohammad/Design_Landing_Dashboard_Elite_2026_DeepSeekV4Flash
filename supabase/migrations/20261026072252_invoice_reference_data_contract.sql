-- Reference invoice fields. Currency totals/VAT/line discounts keep their existing rules.
-- Historical sample-only post-VAT adjustments are NOT enabled for new issuance.
-- No existing invoice number, amount, status, snapshot or document is rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.invoice_lines ALTER COLUMN unit_price TYPE numeric(14,4);
ALTER TABLE public.invoice_lines ADD COLUMN item_name text;
ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_item_name_length CHECK (item_name IS NULL OR (length(item_name) BETWEEN 1 AND 200 AND item_name=btrim(item_name,E' \t\n\r' || chr(11) || chr(12) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))));
ALTER TABLE public.invoices ADD COLUMN show_due_date boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.invoice_lines.item_name IS 'Optional item name, retained separately from the invoice line description.';
COMMENT ON COLUMN public.invoices.show_due_date IS 'Presentation preference only; the financial due date remains mandatory.';
CREATE OR REPLACE FUNCTION public.save_invoice_draft(p_input jsonb, p_invoice_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_actor uuid := auth.uid();
  v_existing public.invoices%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_type public.invoice_type;
  v_party uuid;
  v_issue date; v_due date; v_currency text; v_rate numeric;
  v_line jsonb; v_lines jsonb := '[]'::jsonb; v_no integer := 0;
  v_qty numeric; v_price numeric; v_discount numeric; v_vat_rate numeric;
  v_amount numeric; v_vat numeric; v_description text; v_item_name text; v_show_due boolean;
  v_subtotal numeric := 0; v_discounts numeric := 0; v_vats numeric := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission(
    'invoices', CASE WHEN p_invoice_id IS NULL THEN 'create' ELSE 'update' END
  ) THEN RAISE EXCEPTION 'AUTH007: invoice permission required'; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input->>'invoice_type' IS NULL
    OR p_input->>'invoice_type' NOT IN ('sales','purchase') THEN
    RAISE EXCEPTION 'INV002: invalid invoice type';
  END IF;
  v_type := (p_input->>'invoice_type')::public.invoice_type;
  IF COALESCE(p_input->>'issue_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR COALESCE(p_input->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INV008: valid invoice dates required'; END IF;
  v_issue := (p_input->>'issue_date')::date;
  v_due := (p_input->>'due_date')::date;
  IF v_due < v_issue THEN RAISE EXCEPTION 'INV008: due date precedes issue date'; END IF;
  v_currency := COALESCE(p_input->>'currency','SAR');
  v_rate := COALESCE((p_input->>'vat_rate')::numeric,15);
  IF v_currency !~ '^[A-Z]{3}$' OR v_rate NOT BETWEEN 0 AND 100
    OR v_rate <> round(v_rate,2) THEN RAISE EXCEPTION 'INV002: invalid currency or VAT rate'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.invoices
    WHERE id=p_invoice_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
    IF v_existing.status <> 'draft' OR v_existing.invoice_type <> v_type THEN
      RAISE EXCEPTION 'INV006: only draft invoices can be edited'; END IF;
    IF p_expected_updated_at IS NULL OR v_existing.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'INV015: invoice changed; reload before saving'; END IF;
  END IF;
  IF p_input ? 'show_due_date' AND jsonb_typeof(p_input->'show_due_date') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'INV002: invalid due-date visibility'; END IF;
  v_show_due := CASE WHEN p_input ? 'show_due_date' THEN (p_input->>'show_due_date')::boolean ELSE COALESCE(v_existing.show_due_date,false) END;
  v_party := NULLIF(p_input->>CASE WHEN v_type='sales' THEN 'customer_id' ELSE 'supplier_id' END,'')::uuid;
  IF v_party IS NULL THEN RAISE EXCEPTION 'INV005: invoice party required'; END IF;
  IF v_type='sales' THEN
    PERFORM 1 FROM public.customers WHERE id=v_party AND tenant_id=v_tenant
      AND deleted_at IS NULL AND is_active FOR SHARE;
  ELSE
    PERFORM 1 FROM public.suppliers WHERE id=v_party AND tenant_id=v_tenant
      AND deleted_at IS NULL AND is_active FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV005: active tenant party required'; END IF;
  IF jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INV013: invoice lines required'; END IF;
  IF jsonb_array_length(p_input->'lines') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INV013: invoice needs between 1 and 200 lines'; END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
    v_no := v_no + 1;
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INV002: invalid invoice line'; END IF;
    v_description := btrim(COALESCE(v_line->>'description',''));
    IF v_line ? 'item_name' AND jsonb_typeof(v_line->'item_name') NOT IN ('string','null') THEN RAISE EXCEPTION 'INV002: invalid item name'; END IF;
    v_item_name := NULLIF(btrim(v_line->>'item_name',E' \t\n\r' || chr(11) || chr(12) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)),'');
    IF length(v_item_name)>200 THEN RAISE EXCEPTION 'INV002: item name exceeds 200 characters'; END IF;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_discount := COALESCE((v_line->>'discount')::numeric,0);
    v_vat_rate := COALESCE((v_line->>'vat_rate')::numeric,v_rate);
    IF length(v_description) NOT BETWEEN 1 AND 1000
      OR v_qty IS NULL OR v_qty NOT BETWEEN 0.001 AND 999999999.999 OR v_qty <> round(v_qty,3)
      OR v_price IS NULL OR v_price NOT BETWEEN 0 AND 9999999999.99 OR v_price <> round(v_price,4)
      OR v_discount NOT BETWEEN 0 AND 9999999999.99 OR v_discount <> round(v_discount,2)
      OR v_vat_rate NOT BETWEEN 0 AND 100 OR v_vat_rate <> round(v_vat_rate,2) THEN
      RAISE EXCEPTION 'INV002: invalid invoice line'; END IF;
    v_amount := round(v_qty*v_price,2)-v_discount;
    IF v_amount < 0 THEN RAISE EXCEPTION 'INV002: discount exceeds line value'; END IF;
    v_vat := round(v_amount*v_vat_rate/100,2);
    v_subtotal := v_subtotal+v_amount;
    v_discounts := v_discounts+v_discount;
    v_vats := v_vats+v_vat;
    v_lines := v_lines || jsonb_build_object('line_no',v_no,'item_name',v_item_name,'description',v_description,
      'quantity',v_qty,'unit_price',v_price,'discount',v_discount,'amount',v_amount,
      'vat_rate',v_vat_rate,'vat_amount',v_vat);
  END LOOP;
  IF p_invoice_id IS NULL THEN
    INSERT INTO public.invoices(tenant_id,invoice_type,customer_id,supplier_id,issue_date,due_date,show_due_date,
      currency,vat_rate,notes,subtotal,discount,vat_amount,total,created_by)
    VALUES(v_tenant,v_type,CASE WHEN v_type='sales' THEN v_party END,
      CASE WHEN v_type='purchase' THEN v_party END,v_issue,v_due,v_show_due,v_currency,v_rate,
      NULLIF(btrim(p_input->>'notes'),''),v_subtotal,v_discounts,v_vats,v_subtotal+v_vats,v_actor)
    RETURNING * INTO v_invoice;
  ELSE
    UPDATE public.invoices SET customer_id=CASE WHEN v_type='sales' THEN v_party END,
      supplier_id=CASE WHEN v_type='purchase' THEN v_party END,issue_date=v_issue,due_date=v_due,show_due_date=v_show_due,
      currency=v_currency,vat_rate=v_rate,notes=NULLIF(btrim(p_input->>'notes'),''),
      subtotal=v_subtotal,discount=v_discounts,vat_amount=v_vats,total=v_subtotal+v_vats,updated_by=v_actor
    WHERE id=p_invoice_id RETURNING * INTO v_invoice;
    DELETE FROM public.invoice_lines WHERE invoice_id=p_invoice_id AND tenant_id=v_tenant;
  END IF;
  INSERT INTO public.invoice_lines(tenant_id,invoice_id,line_no,item_name,description,quantity,unit_price,
    discount,amount,vat_rate,vat_amount,created_by)
  SELECT v_tenant,v_invoice.id,l.line_no,l.item_name,l.description,l.quantity,l.unit_price,l.discount,
    l.amount,l.vat_rate,l.vat_amount,v_actor
  FROM jsonb_to_recordset(v_lines) AS l(line_no integer,item_name text,description text,quantity numeric,
    unit_price numeric,discount numeric,amount numeric,vat_rate numeric,vat_amount numeric);
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,v_actor,'invoices','invoices',v_invoice.id,
    CASE WHEN p_invoice_id IS NULL THEN 'invoice_draft_created' ELSE 'invoice_draft_updated' END,
    jsonb_build_object('total',v_invoice.total,'line_count',v_no));
  RETURN jsonb_build_object('id',v_invoice.id,'updated_at',v_invoice.updated_at,'total',v_invoice.total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_zatca_issuance(p_tenant uuid, p_stream uuid, p_source_type text, p_source_id uuid, p_document_uuid uuid, p_issued_at timestamp with time zone, p_expected_counter bigint, p_previous_hash text, p_xml text, p_canonical_xml text, p_invoice_hash text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
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
    OR (xpath('string(/i:Invoice/cbc:IssueDate)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char(p_issued_at AT TIME ZONE 'UTC','YYYY-MM-DD')
    OR (xpath('string(/i:Invoice/cbc:IssueTime)',v_xml,v_ns))[1]::text IS DISTINCT FROM to_char(p_issued_at AT TIME ZONE 'UTC','HH24:MI:SS')
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

CREATE OR REPLACE FUNCTION public.transition_my_invoice(p_invoice_id uuid, p_operation text, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_tenant uuid := public.get_my_tenant_id();
  v_inv public.invoices%ROWTYPE; v_receipt public.invoice_transition_receipts%ROWTYPE;
  v_line public.invoice_lines%ROWTYPE; v_count integer := 0;
  v_subtotal numeric := 0; v_discount numeric := 0; v_vat numeric := 0;
  v_amount numeric; v_line_vat numeric; v_event uuid; v_source text; v_key text;
  v_action text; v_event_type text; v_lines jsonb := '[]'::jsonb;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('issue','finalize') THEN
    RAISE EXCEPTION 'INV006: invalid transition';
  END IF;
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission(
    'invoices',CASE WHEN p_operation='issue' THEN 'update' ELSE 'approve' END
  ) OR NOT EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=v_actor AND tenant_id=v_tenant
    AND status='active' AND deleted_at IS NULL AND NOT must_change_password
    AND (locked_until IS NULL OR locked_until<=now())) THEN
    RAISE EXCEPTION 'AUTH007: active invoice permission required';
  END IF;
  SELECT * INTO v_inv FROM public.invoices
    WHERE id=p_invoice_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
  SELECT * INTO v_receipt FROM public.invoice_transition_receipts
    WHERE tenant_id=v_tenant AND invoice_id=p_invoice_id AND operation=p_operation;
  IF FOUND THEN
    IF v_receipt.actor_id<>v_actor OR p_expected_updated_at IS DISTINCT FROM v_receipt.input_updated_at THEN
      RAISE EXCEPTION 'INV015: another decision exists; reload invoice';
    END IF;
    IF (p_operation='issue' AND v_inv.status<>'issued')
      OR (p_operation='finalize' AND v_inv.status NOT IN ('finalized','paid','partially_paid','overdue')) THEN
      RAISE EXCEPTION 'INV006: invoice state changed after decision';
    END IF;
    RETURN jsonb_build_object('id',v_inv.id,'invoice_type',v_inv.invoice_type,
      'operation',p_operation,'event_id',v_receipt.event_id,'replayed',true);
  END IF;
  IF (p_operation='issue' AND v_inv.status<>'draft')
    OR (p_operation='finalize' AND v_inv.status<>'issued') THEN
    RAISE EXCEPTION 'INV006: invoice state does not permit transition';
  END IF;
  IF p_expected_updated_at IS NULL OR p_expected_updated_at<>v_inv.updated_at THEN
    RAISE EXCEPTION 'INV015: invoice changed; reload before transition';
  END IF;
  IF v_inv.currency<>'SAR' THEN RAISE EXCEPTION 'INV012: SAR accounting only'; END IF;
  IF v_inv.invoice_type='sales' THEN
    PERFORM 1 FROM public.customers WHERE id=v_inv.customer_id AND tenant_id=v_tenant
      AND deleted_at IS NULL AND is_active FOR SHARE;
  ELSE
    PERFORM 1 FROM public.suppliers WHERE id=v_inv.supplier_id AND tenant_id=v_tenant
      AND deleted_at IS NULL AND is_active FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV005: active tenant party required'; END IF;

  -- No PostgREST row cap or binary floating point: validate every persisted
  -- line and every header component against the canonical numeric formula.
  FOR v_line IN SELECT * FROM public.invoice_lines WHERE invoice_id=v_inv.id ORDER BY line_no LOOP
    v_count := v_count+1;
    IF v_line.tenant_id<>v_tenant OR v_line.line_no<>v_count
      OR length(btrim(v_line.description)) NOT BETWEEN 1 AND 1000 OR length(v_line.item_name)>200
      OR v_line.quantity NOT BETWEEN 0.001 AND 999999999.999
      OR v_line.unit_price NOT BETWEEN 0 AND 9999999999.99
      OR v_line.discount NOT BETWEEN 0 AND 9999999999.99
      OR v_line.vat_rate NOT BETWEEN 0 AND 100 THEN
      RAISE EXCEPTION 'INV002: invalid stored invoice line';
    END IF;
    v_amount := round(v_line.quantity*v_line.unit_price,2)-v_line.discount;
    v_line_vat := round(v_amount*v_line.vat_rate/100,2);
    IF v_amount<0 OR v_line.amount IS DISTINCT FROM v_amount OR v_line.vat_amount IS DISTINCT FROM v_line_vat THEN
      RAISE EXCEPTION 'INV004: stored line amounts do not reconcile';
    END IF;
    v_subtotal := v_subtotal+v_amount; v_discount := v_discount+v_line.discount; v_vat := v_vat+v_line_vat;
    v_lines := v_lines||jsonb_build_object('line_no',v_line.line_no,'item_name',v_line.item_name,'description',v_line.description,
      'quantity',v_line.quantity,'unit_price',v_line.unit_price,'discount',v_line.discount,
      'amount',v_amount,'vat_rate',v_line.vat_rate,'vat_amount',v_line_vat);
  END LOOP;
  IF v_count NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INV013: invoice needs 1 to 200 lines'; END IF;
  IF v_inv.subtotal IS DISTINCT FROM v_subtotal OR v_inv.discount IS DISTINCT FROM v_discount
    OR v_inv.vat_amount IS DISTINCT FROM v_vat OR v_inv.total IS DISTINCT FROM v_subtotal+v_vat
    OR v_inv.total<=0 THEN RAISE EXCEPTION 'INV004: invoice totals do not reconcile'; END IF;

  IF p_operation='issue' THEN
    UPDATE public.invoices SET status='issued',updated_by=v_actor WHERE id=v_inv.id AND tenant_id=v_tenant;
    v_action := 'invoice_issued';
  ELSE
    v_source := CASE WHEN v_inv.invoice_type='purchase' THEN 'purchase_invoice' ELSE 'invoice' END;
    v_key := v_source||':'||v_inv.id::text||CASE WHEN v_inv.invoice_type='purchase' THEN ':approved' ELSE ':finalized' END;
    -- Historical partial effects must be reviewed, never silently adopted.
    IF EXISTS(SELECT 1 FROM public.financial_events WHERE idempotency_key=v_key)
      OR EXISTS(SELECT 1 FROM public.payables WHERE tenant_id=v_tenant
        AND source_entity_type='purchase_invoice' AND source_entity_id=v_inv.id AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.receivables WHERE tenant_id=v_tenant
        AND source_entity_type='invoice' AND source_entity_id=v_inv.id AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=v_tenant
        AND source_entity_type=v_source AND source_entity_id=v_inv.id) THEN
      RAISE EXCEPTION 'INV_REVIEW: existing accounting evidence requires review';
    END IF;
    IF v_inv.invoice_type='purchase' THEN
      INSERT INTO public.payables(tenant_id,supplier_id,invoice_ref,invoice_date,due_date,
        amount,vat_amount,total_amount,paid_amount,status,source_entity_type,source_entity_id,notes,created_by)
      VALUES(v_tenant,v_inv.supplier_id,v_inv.invoice_number,v_inv.issue_date,v_inv.due_date,
        v_subtotal,v_vat,v_inv.total,0,'open','purchase_invoice',v_inv.id,
        'Purchase invoice '||v_inv.invoice_number||' approval',v_actor);
      v_action := 'purchase_invoice_approved'; v_event_type := 'PurchaseInvoiceApprovedEvent';
    ELSE
      v_action := 'invoice_finalized'; v_event_type := 'InvoiceFinalizedEvent';
    END IF;
    UPDATE public.invoices SET status='finalized',finalized_at=now(),finalized_by=v_actor,updated_by=v_actor
      WHERE id=v_inv.id AND tenant_id=v_tenant;
    v_event := gen_random_uuid();
    INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
    VALUES(v_tenant,v_event,v_key,v_source,v_inv.id,v_event_type,v_inv.issue_date,
      jsonb_build_object('invoice_number',v_inv.invoice_number,'invoice_ref',v_inv.invoice_number,
        'customer_id',v_inv.customer_id,'supplier_id',v_inv.supplier_id,'lines',v_lines,
        'subtotal',v_subtotal,'discount',v_discount,'vat_amount',v_vat,'total',v_inv.total,'currency',v_inv.currency,
        'period_year',extract(year FROM v_inv.issue_date),'period_month',extract(month FROM v_inv.issue_date)));
  END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
  VALUES(v_tenant,v_actor,'invoices','invoices',v_inv.id,v_action,jsonb_build_object('status',v_inv.status),
    jsonb_build_object('invoice_number',v_inv.invoice_number,'subtotal',v_subtotal,'vat_amount',v_vat,
      'total',v_inv.total,'event_id',v_event,'input_updated_at',p_expected_updated_at));
  INSERT INTO public.invoice_transition_receipts(tenant_id,invoice_id,operation,actor_id,input_updated_at,event_id)
  VALUES(v_tenant,v_inv.id,p_operation,v_actor,p_expected_updated_at,v_event);
  RETURN jsonb_build_object('id',v_inv.id,'invoice_type',v_inv.invoice_type,
    'operation',p_operation,'event_id',v_event,'replayed',false);
END $function$;

CREATE OR REPLACE FUNCTION public.protect_finalized_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IN ('finalized', 'paid', 'partially_paid', 'overdue', 'credited', 'cancelled') THEN
    -- Financial columns immutable once finalized (corrections via notes).
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount IS DISTINCT FROM OLD.discount
       OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.show_due_date IS DISTINCT FROM OLD.show_due_date
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable; use a credit/debit note';
    END IF;

    -- Legal status transitions once finalized:
    --   - the payments engine (048) moves invoices between finalized /
    --     paid / partially_paid / overdue; reverting to finalized requires
    --     the invoice's receivable to be fully reopened (voided payment)
    --   - finalized → cancelled / credited (notes) as before
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status IN ('finalized', 'paid', 'partially_paid', 'overdue')
         AND NEW.status IN ('finalized', 'paid', 'partially_paid', 'overdue') THEN
        IF NEW.status = 'finalized' AND EXISTS (
          SELECT 1 FROM receivables r
          WHERE r.tenant_id = OLD.tenant_id
            AND r.source_entity_type = 'invoice'
            AND r.source_entity_id = OLD.id
            AND r.deleted_at IS NULL
            AND r.paid_amount > 0
        ) THEN
          RAISE EXCEPTION 'INV006: invoice still has an outstanding receivable';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.status = 'finalized' AND NEW.status IN ('cancelled', 'credited') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INV006: invoice state does not permit this change';
    END IF;

    -- No soft-delete of immutable documents.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_note_atomic(p_request_id uuid, p_invoice_id uuid, p_expected_updated_at timestamp with time zone, p_kind text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_tenant uuid:=public.get_my_tenant_id();
  v_request public.invoice_note_requests%ROWTYPE; v_inv public.invoices%ROWTYPE;
  v_ar public.receivables%ROWTYPE; v_event public.financial_events%ROWTYPE;
  v_line public.invoice_lines%ROWTYPE;
  v_reason text; v_date date; v_description text; v_payload jsonb;
  v_subtotal numeric:=0; v_discount numeric:=0; v_vat numeric:=0; v_total numeric;
  v_amount numeric; v_line_vat numeric; v_rate numeric; v_lines jsonb:='[]'::jsonb;
  v_count integer:=0; v_rows integer; v_note uuid; v_number text; v_event_id uuid;
  v_journal uuid; v_result text; v_period_status text; v_debit numeric; v_credit numeric;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('invoices','create')
    OR NOT public.user_has_permission('invoices','approve') OR NOT EXISTS(
      SELECT 1 FROM public.users WHERE auth_user_id=v_actor AND tenant_id=v_tenant
      AND status='active' AND deleted_at IS NULL AND NOT must_change_password
      AND (locked_until IS NULL OR locked_until<=now())) THEN
    RAISE EXCEPTION 'AUTH007: active invoice approver required';
  END IF;
  IF p_request_id IS NULL OR p_invoice_id IS NULL OR p_expected_updated_at IS NULL
    OR p_kind IS NULL OR p_kind NOT IN('credit','debit')
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: complete note request required';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN('reason','issue_date','amount','vat_rate','description'))
    OR (p_kind='credit' AND p_input ?| ARRAY['amount','vat_rate','description']) THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: unsupported note fields';
  END IF;
  v_reason:=btrim(p_input->>'reason');
  IF jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'issue_date') IS DISTINCT FROM 'string'
    OR (p_input ? 'description' AND jsonb_typeof(p_input->'description') IS DISTINCT FROM 'string')
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500
    OR COALESCE(p_input->>'issue_date','')!~'^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: valid reason and explicit issue date required';
  END IF;
  BEGIN v_date:=(p_input->>'issue_date')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: invalid issue date'; END;
  IF v_date<'0001-01-01'::date OR v_date>'9999-12-31'::date THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: invalid issue date'; END IF;
  v_payload:=jsonb_build_object('invoice_id',p_invoice_id,'kind',p_kind,'reason',v_reason,'issue_date',v_date,
    'expected_updated_at',to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  IF p_kind='debit' THEN
    IF jsonb_typeof(p_input->'amount') IS DISTINCT FROM 'number'
      OR (p_input ? 'vat_rate' AND jsonb_typeof(p_input->'vat_rate') IS DISTINCT FROM 'number') THEN
      RAISE EXCEPTION 'INV_NOTE_INPUT: numeric debit amount and VAT required'; END IF;
    v_subtotal:=(p_input->>'amount')::numeric; v_rate:=COALESCE((p_input->>'vat_rate')::numeric,15);
    v_description:=COALESCE(NULLIF(btrim(p_input->>'description'),''),v_reason);
    IF v_subtotal NOT BETWEEN 0.01 AND 99999999.99 OR v_subtotal<>round(v_subtotal,2)
      OR v_rate NOT BETWEEN 0 AND 100 OR v_rate<>round(v_rate,2)
      OR length(v_description) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'INV_NOTE_INPUT: invalid debit amount, rate or description'; END IF;
    v_vat:=round(v_subtotal*v_rate/100,2); v_total:=v_subtotal+v_vat;
    v_payload:=v_payload||jsonb_build_object('amount',v_subtotal,'vat_rate',v_rate,'description',v_description);
  END IF;

  -- Serialize the retry identity before any mutable reference-state checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_request_id::text,0));
  SELECT * INTO v_request FROM public.invoice_note_requests WHERE tenant_id=v_tenant AND request_id=p_request_id;
  IF FOUND THEN
    IF v_request.actor_id<>v_actor OR v_request.request_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'INV_NOTE_RETRY: request already identifies a different decision'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.financial_events WHERE tenant_id=v_tenant AND event_id=v_request.event_id
      AND processing_status IN('processed','skipped_duplicate'))
      OR (p_kind='credit' AND NOT EXISTS(SELECT 1 FROM public.credit_notes WHERE id=v_request.note_id AND tenant_id=v_tenant AND status='finalized'))
      OR (p_kind='debit' AND NOT EXISTS(SELECT 1 FROM public.debit_notes WHERE id=v_request.note_id AND tenant_id=v_tenant AND status='finalized')) THEN
      RAISE EXCEPTION 'INV_NOTE_REVIEW: previous note requires review'; END IF;
    RETURN jsonb_build_object('id',v_request.note_id,'event_id',v_request.event_id,'kind',p_kind,
      'reference_invoice_id',p_invoice_id,'replayed',true,'posting_status','posted');
  END IF;

  -- Keep the same target-before-invoice order as payment creation/posting.
  -- Requiring the original event first also serializes original AR creation.
  SELECT * INTO v_event FROM public.financial_events WHERE tenant_id=v_tenant
    AND source_type='invoice' AND source_id=p_invoice_id AND event_type='InvoiceFinalizedEvent'
    AND idempotency_key='invoice:'||p_invoice_id::text||':finalized' FOR UPDATE;
  IF NOT FOUND OR v_event.processing_status NOT IN('processed','skipped_duplicate') THEN
    RAISE EXCEPTION 'INV_NOTE_POSTING: original invoice must be fully posted'; END IF;
  SELECT count(*) INTO v_rows FROM public.receivables WHERE tenant_id=v_tenant
    AND source_entity_type='invoice' AND source_entity_id=p_invoice_id AND deleted_at IS NULL;
  IF v_rows<>1 THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: exactly one original receivable required'; END IF;
  SELECT * INTO v_ar FROM public.receivables WHERE tenant_id=v_tenant
    AND source_entity_type='invoice' AND source_entity_id=p_invoice_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_inv FROM public.invoices WHERE id=p_invoice_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
  IF v_inv.invoice_type<>'sales' OR v_inv.currency<>'SAR' OR v_inv.status<>'finalized' THEN
    RAISE EXCEPTION 'INV_NOTE_REFERENCE: notes require a finalized SAR sales invoice'; END IF;
  IF v_inv.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'INV015: invoice changed'; END IF;
  IF v_date<v_inv.issue_date OR v_date>(now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'INV_NOTE_INPUT: note date must be between invoice date and current Saudi date'; END IF;
  -- Full credit reverses a retained historical party; new debit charges still require an active customer.
  PERFORM 1 FROM public.customers WHERE id=v_inv.customer_id AND tenant_id=v_tenant
    AND (p_kind='credit' OR (deleted_at IS NULL AND is_active)) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV005: active tenant customer required'; END IF;
  IF v_ar.customer_id IS DISTINCT FROM v_inv.customer_id OR v_ar.amount<>v_inv.subtotal
    OR v_ar.vat_amount<>v_inv.vat_amount OR v_ar.total_amount<>v_inv.total
    OR v_ar.paid_amount<>0 OR v_ar.status NOT IN('open','overdue') THEN
    RAISE EXCEPTION 'INV007: original receivable must be complete and unpaid'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_allocations a JOIN public.finance_payments p ON p.id=a.finance_payment_id
    WHERE a.tenant_id=v_tenant AND a.receivable_id=v_ar.id AND p.tenant_id=v_tenant AND p.deleted_at IS NULL
      AND p.status<>'void' AND a.allocated_amount>0) THEN
    RAISE EXCEPTION 'INV_NOTE_RESERVED: original receivable has a payment reservation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vat_output_ledger WHERE tenant_id=v_tenant AND source_entity_type='invoice'
    AND source_entity_id=v_inv.id AND vat_base_amount=v_inv.subtotal AND vat_amount=v_inv.vat_amount
    AND customer_id=v_inv.customer_id AND invoice_date=v_inv.issue_date)
    OR (SELECT count(*) FROM public.vat_output_ledger WHERE tenant_id=v_tenant AND source_entity_type='invoice' AND source_entity_id=v_inv.id)<>1 THEN
    RAISE EXCEPTION 'INV_NOTE_REVIEW: original VAT evidence does not reconcile'; END IF;
  SELECT count(*) INTO v_rows FROM public.journal_entries WHERE tenant_id=v_tenant AND source_module='accounting'
    AND source_entity_type='invoice' AND source_entity_id=v_inv.id AND entry_type='invoice' AND status='posted' AND deleted_at IS NULL;
  IF v_rows<>1 THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: one original posted journal required'; END IF;
  SELECT id INTO v_journal FROM public.journal_entries WHERE tenant_id=v_tenant AND source_module='accounting'
    AND source_entity_type='invoice' AND source_entity_id=v_inv.id AND entry_type='invoice' AND status='posted' AND deleted_at IS NULL FOR SHARE;
  SELECT sum(debit_amount),sum(credit_amount) INTO v_debit,v_credit FROM public.journal_entry_lines
    WHERE tenant_id=v_tenant AND journal_entry_id=v_journal;
  IF v_debit IS DISTINCT FROM v_inv.total OR v_credit IS DISTINCT FROM v_inv.total
    OR EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE journal_entry_id=v_journal AND tenant_id<>v_tenant) THEN
    RAISE EXCEPTION 'INV_NOTE_REVIEW: original journal amounts do not reconcile'; END IF;

  IF p_kind='credit' THEN
    IF EXISTS(SELECT 1 FROM public.credit_notes WHERE tenant_id=v_tenant AND reference_invoice_id=v_inv.id) THEN
      RAISE EXCEPTION 'INV009: credit note already exists'; END IF;
    FOR v_line IN SELECT * FROM public.invoice_lines WHERE invoice_id=v_inv.id ORDER BY line_no LOOP
      v_count:=v_count+1;
      IF v_line.tenant_id<>v_tenant OR v_line.line_no<>v_count OR length(btrim(v_line.description)) NOT BETWEEN 1 AND 1000 OR length(v_line.item_name)>200
        OR v_line.quantity NOT BETWEEN 0.001 AND 999999999.999 OR v_line.unit_price NOT BETWEEN 0 AND 9999999999.99
        OR v_line.discount NOT BETWEEN 0 AND 9999999999.99 OR v_line.vat_rate NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'INV004: reference lines require review'; END IF;
      v_amount:=round(v_line.quantity*v_line.unit_price,2)-v_line.discount;
      v_line_vat:=round(v_amount*v_line.vat_rate/100,2);
      IF v_amount<0 OR v_line.amount IS DISTINCT FROM v_amount OR v_line.vat_amount IS DISTINCT FROM v_line_vat THEN
        RAISE EXCEPTION 'INV004: reference line amounts do not reconcile'; END IF;
      v_subtotal:=v_subtotal+v_amount;v_discount:=v_discount+v_line.discount;v_vat:=v_vat+v_line_vat;
      v_lines:=v_lines||jsonb_build_object('line_no',v_line.line_no,'item_name',v_line.item_name,'description',v_line.description,'quantity',v_line.quantity,
        'unit_price',v_line.unit_price,'discount',v_line.discount,'amount',v_amount,'vat_rate',v_line.vat_rate,'vat_amount',v_line_vat);
    END LOOP;
    v_total:=v_subtotal+v_vat;
    IF v_count NOT BETWEEN 1 AND 200 OR v_subtotal<>v_inv.subtotal OR v_discount<>v_inv.discount
      OR v_vat<>v_inv.vat_amount OR v_total<>v_inv.total OR v_total<=0 THEN
      RAISE EXCEPTION 'INV004: reference totals do not reconcile'; END IF;
    v_rate:=v_inv.vat_rate;
  ELSE
    v_lines:=jsonb_build_array(jsonb_build_object('line_no',1,'description',v_description,'quantity',1,'unit_price',v_subtotal,
      'discount',0,'amount',v_subtotal,'vat_rate',v_rate,'vat_amount',v_vat));
  END IF;

  -- Posting and note issuance are one decision. Close-period races cannot
  -- commit a legal document whose accounting effects failed.
  INSERT INTO public.accounting_periods(tenant_id,period_year,period_month,status)
    VALUES(v_tenant,extract(year FROM v_date),extract(month FROM v_date),'open')
    ON CONFLICT(tenant_id,period_year,period_month) DO NOTHING;
  SELECT status::text INTO v_period_status FROM public.accounting_periods WHERE tenant_id=v_tenant AND deleted_at IS NULL
    AND period_year=extract(year FROM v_date) AND period_month=extract(month FROM v_date) FOR SHARE;
  IF v_period_status IS NULL OR v_period_status NOT IN('open','reopened') THEN RAISE EXCEPTION 'ACC001: note period is closed'; END IF;
  INSERT INTO public.vat_periods(tenant_id,period_year,period_month,status)
    VALUES(v_tenant,extract(year FROM v_date),extract(month FROM v_date),'open')
    ON CONFLICT(tenant_id,period_year,period_month) DO NOTHING;
  SELECT status INTO v_period_status FROM public.vat_periods WHERE tenant_id=v_tenant AND deleted_at IS NULL
    AND period_year=extract(year FROM v_date) AND period_month=extract(month FROM v_date) FOR SHARE;
  IF v_period_status IS NULL OR v_period_status NOT IN('open','reopened') THEN RAISE EXCEPTION 'VAT001: note VAT period is closed'; END IF;

  IF p_kind='credit' THEN
    INSERT INTO public.credit_notes(tenant_id,reference_invoice_id,customer_id,issue_date,currency,status,
      subtotal,discount,vat_amount,total,vat_rate,reason,lines,created_by)
    VALUES(v_tenant,v_inv.id,v_inv.customer_id,v_date,'SAR','finalized',v_subtotal,v_discount,v_vat,v_total,v_rate,v_reason,v_lines,v_actor)
    RETURNING id,credit_note_number INTO v_note,v_number;
    UPDATE public.invoices SET status='credited',updated_by=v_actor WHERE id=v_inv.id AND tenant_id=v_tenant;
    -- Preserve original money for history; exclude the fully credited balance
    -- and block fresh payment reservations in the same transaction.
    UPDATE public.receivables SET deleted_at=now(),updated_by=v_actor WHERE id=v_ar.id AND tenant_id=v_tenant;
  ELSE
    INSERT INTO public.debit_notes(tenant_id,reference_invoice_id,customer_id,issue_date,currency,status,
      subtotal,discount,vat_amount,total,vat_rate,reason,lines,created_by)
    VALUES(v_tenant,v_inv.id,v_inv.customer_id,v_date,'SAR','finalized',v_subtotal,0,v_vat,v_total,v_rate,v_reason,v_lines,v_actor)
    RETURNING id,debit_note_number INTO v_note,v_number;
  END IF;
  v_event_id:=gen_random_uuid();
  INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
  VALUES(v_tenant,v_event_id,p_kind||'_note:'||v_note::text||':issued',p_kind||'_note',v_note,
    CASE WHEN p_kind='credit' THEN 'CreditNoteIssuedEvent' ELSE 'DebitNoteIssuedEvent' END,v_date,
    jsonb_build_object('note_number',v_number,'reference_invoice_id',v_inv.id,'subtotal',v_subtotal,'vat_amount',v_vat,'total',v_total,'reason',v_reason))
  RETURNING * INTO v_event;
  INSERT INTO public.invoice_note_requests(tenant_id,request_id,actor_id,invoice_id,kind,request_payload,note_id,event_id,receivable_id)
  VALUES(v_tenant,p_request_id,v_actor,v_inv.id,p_kind,v_payload,v_note,v_event_id,v_ar.id);
  IF p_kind='credit' THEN v_result:=public.dispatch_credit_note(v_event);
  ELSE v_result:=public.dispatch_debit_note(v_event); END IF;
  IF v_result<>'ok' THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: note effects were not created'; END IF;
  UPDATE public.financial_events SET processing_status='processed',processed_at=now(),error_message=NULL
    WHERE event_id=v_event_id AND tenant_id=v_tenant;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,v_actor,'invoices',p_kind||'_notes',v_note,p_kind||'_note_issued',
    jsonb_build_object('note_number',v_number,'reference_invoice_id',v_inv.id,'reference_number',v_inv.invoice_number,
      'total',v_total,'reason',v_reason,'issue_date',v_date,'request_id',p_request_id,'event_id',v_event_id));
  RETURN jsonb_build_object('id',v_note,'event_id',v_event_id,'kind',p_kind,'reference_invoice_id',p_invoice_id,
    'replayed',false,'posting_status','posted');
END $function$;

NOTIFY pgrst,'reload schema';
COMMIT;
