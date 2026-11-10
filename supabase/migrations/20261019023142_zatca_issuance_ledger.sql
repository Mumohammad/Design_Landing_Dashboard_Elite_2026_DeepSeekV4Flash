-- Non-production document-preparation ledger. No backfill, financial mutation,
-- authority status, credential or network activation. Production is deliberately
-- excluded until the complete signing/onboarding workflow has been validated.
CREATE TABLE public.zatca_issuance_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  environment text NOT NULL CHECK (environment IN ('sandbox','simulation')),
  egs_serial text NOT NULL CHECK (length(egs_serial) BETWEEN 1 AND 200 AND egs_serial=btrim(egs_serial)),
  last_counter bigint NOT NULL DEFAULT 0 CHECK (last_counter BETWEEN 0 AND 9007199254740991),
  last_invoice_hash text NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, environment, egs_serial),
  UNIQUE (id, tenant_id, environment)
);

CREATE TABLE public.zatca_document_issuances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  stream_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','simulation')),
  source_type text NOT NULL CHECK (source_type IN ('invoice','credit_note','debit_note')),
  source_id uuid NOT NULL,
  doc_ref text NOT NULL,
  issued_at timestamptz NOT NULL,
  invoice_counter bigint NOT NULL CHECK (invoice_counter BETWEEN 1 AND 9007199254740991),
  previous_invoice_hash text NOT NULL,
  invoice_hash text NOT NULL CHECK (invoice_hash ~ '^[A-Za-z0-9+/]{43}=$'),
  unsigned_xml text NOT NULL CHECK (octet_length(unsigned_xml) BETWEEN 1 AND 2097152),
  canonical_xml text NOT NULL CHECK (octet_length(canonical_xml) BETWEEN 1 AND 2097152),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (stream_id, tenant_id, environment)
    REFERENCES public.zatca_issuance_streams(id, tenant_id, environment),
  UNIQUE (stream_id, invoice_counter),
  -- A note has its own identity, not its reference invoice's identity.
  UNIQUE (tenant_id, environment, source_type, source_id)
);
CREATE INDEX zatca_document_issuances_actor ON public.zatca_document_issuances(created_by);
CREATE INDEX zatca_document_issuances_tenant_date ON public.zatca_document_issuances(tenant_id, created_at DESC);
CREATE INDEX zatca_document_issuances_stream_fk ON public.zatca_document_issuances(stream_id, tenant_id, environment);

ALTER TABLE public.zatca_issuance_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_document_issuances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_issuance_streams, public.zatca_document_issuances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.zatca_issuance_streams, public.zatca_document_issuances TO authenticated;
CREATE POLICY issuance_stream_read ON public.zatca_issuance_streams FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
CREATE POLICY issuance_document_read ON public.zatca_document_issuances FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
GRANT SELECT, INSERT ON public.zatca_issuance_streams, public.zatca_document_issuances TO service_role;
GRANT UPDATE (last_counter, last_invoice_hash) ON public.zatca_issuance_streams TO service_role;

CREATE FUNCTION public.protect_zatca_issuance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'ZTC_IMMUTABLE: prepared document evidence cannot be changed or deleted';
END;
$$;
CREATE TRIGGER zatca_issuance_immutable BEFORE UPDATE OR DELETE ON public.zatca_document_issuances
  FOR EACH ROW EXECUTE FUNCTION public.protect_zatca_issuance();

CREATE FUNCTION public.protect_zatca_stream() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.last_counter <> 0 OR NEW.last_invoice_hash <> 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==' THEN
      RAISE EXCEPTION 'ZTC_CHAIN: new streams must start at the genesis hash';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.tenant_id,NEW.environment,NEW.egs_serial,NEW.created_at)
       IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.environment,OLD.egs_serial,OLD.created_at)
    OR NEW.last_counter <> OLD.last_counter + 1
    OR NOT EXISTS (SELECT 1 FROM public.zatca_document_issuances d WHERE d.stream_id=OLD.id
      AND d.invoice_counter=NEW.last_counter AND d.previous_invoice_hash=OLD.last_invoice_hash
      AND d.invoice_hash=NEW.last_invoice_hash) THEN
    RAISE EXCEPTION 'ZTC_CHAIN: stream state requires the next immutable document';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zatca_stream_protect BEFORE INSERT OR UPDATE ON public.zatca_issuance_streams
  FOR EACH ROW EXECUTE FUNCTION public.protect_zatca_stream();

CREATE FUNCTION public.advance_zatca_stream() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_stream public.zatca_issuance_streams%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_stream FROM public.zatca_issuance_streams WHERE id=NEW.stream_id FOR UPDATE;
  IF NEW.invoice_counter <> v_stream.last_counter + 1 OR NEW.previous_invoice_hash <> v_stream.last_invoice_hash THEN
    RAISE EXCEPTION 'ZTC_CONFLICT: issuance stream changed; reload before preparing';
  END IF;
  UPDATE public.zatca_issuance_streams SET last_counter=NEW.invoice_counter,last_invoice_hash=NEW.invoice_hash WHERE id=NEW.stream_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zatca_stream_advance AFTER INSERT ON public.zatca_document_issuances
  FOR EACH ROW EXECUTE FUNCTION public.advance_zatca_stream();

-- Trusted server only; never a client RPC. Invoker privileges intentionally
-- avoid SECURITY DEFINER. Application authorization/MFA must precede admin use.
CREATE FUNCTION public.record_zatca_issuance(
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
REVOKE ALL ON FUNCTION public.protect_zatca_issuance(), public.protect_zatca_stream(), public.advance_zatca_stream() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
