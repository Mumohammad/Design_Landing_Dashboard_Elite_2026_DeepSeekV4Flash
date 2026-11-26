BEGIN;

CREATE SCHEMA zatca_submission_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA zatca_submission_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE zatca_submission_private.claims (
  issuance_id uuid PRIMARY KEY REFERENCES public.zatca_document_issuances(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON TABLE zatca_submission_private.claims FROM PUBLIC, anon, authenticated, service_role;

-- Both functions lock the same immutable issuance first. Provider I/O occurs
-- after the claim transaction commits and before the completion transaction.
CREATE FUNCTION public.claim_zatca_submission(
  p_tenant uuid, p_actor uuid, p_issuance uuid, p_environment text, p_pipeline text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_issuance public.zatca_document_issuances%ROWTYPE;
  v_pipeline text;
  v_accepted_status text;
  v_accepted jsonb;
  v_token uuid;
BEGIN
  IF NOT public.zatca_operator_authorized(p_tenant, p_actor) THEN
    RAISE EXCEPTION 'ZTC_ACTOR: active tenant operator required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_issuance
  FROM public.zatca_document_issuances
  WHERE id = p_issuance AND tenant_id = p_tenant AND environment = p_environment
    AND environment IN ('sandbox', 'simulation')
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZTC_ISSUANCE: prepared issuance required';
  END IF;

  v_pipeline := CASE WHEN strpos(v_issuance.unsigned_xml, '<cbc:InvoiceTypeCode name="02') > 0
    THEN 'reporting' ELSE 'clearance' END;
  IF p_pipeline IS DISTINCT FROM v_pipeline THEN
    RAISE EXCEPTION 'ZTC_PIPELINE: issuance pipeline mismatch';
  END IF;
  v_accepted_status := CASE WHEN v_pipeline = 'reporting' THEN 'reported' ELSE 'cleared' END;

  SELECT jsonb_build_object(
    'state', 'accepted', 'response', attempt.response, 'created_at', attempt.created_at
  ) INTO v_accepted
  FROM public.zatca_submission_attempts AS attempt
  WHERE attempt.tenant_id = p_tenant AND attempt.issuance_id = p_issuance
    AND attempt.environment = v_issuance.environment AND attempt.invoice_hash = v_issuance.invoice_hash
    AND attempt.pipeline = v_pipeline AND attempt.status = v_accepted_status
  ORDER BY attempt.created_at DESC, attempt.id DESC
  LIMIT 1;
  IF FOUND THEN RETURN v_accepted; END IF;

  -- The gateway's 30-second client timeout is shorter than the claim.
  INSERT INTO zatca_submission_private.claims AS claim (issuance_id, actor_id, token, expires_at)
  VALUES (p_issuance, p_actor, gen_random_uuid(), clock_timestamp() + interval '5 minutes')
  ON CONFLICT (issuance_id) DO UPDATE SET
    actor_id = EXCLUDED.actor_id, token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
  WHERE claim.expires_at <= clock_timestamp()
  RETURNING token INTO v_token;

  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'busy'); END IF;
  RETURN jsonb_build_object('state', 'claimed', 'token', v_token);
END $$;

CREATE FUNCTION public.finish_zatca_submission(
  p_tenant uuid, p_actor uuid, p_issuance uuid, p_token uuid, p_attempt jsonb
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_issuance public.zatca_document_issuances%ROWTYPE;
  v_claim zatca_submission_private.claims%ROWTYPE;
  v_pipeline text;
  v_accepted_status text;
  v_status text := p_attempt->>'status';
  v_recorded_at timestamptz;
BEGIN
  SELECT * INTO v_issuance
  FROM public.zatca_document_issuances
  WHERE id = p_issuance AND tenant_id = p_tenant AND environment IN ('sandbox', 'simulation')
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZTC_CLAIM: submission claim is no longer current' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_claim FROM zatca_submission_private.claims WHERE issuance_id = p_issuance;
  IF NOT FOUND OR v_claim.actor_id IS DISTINCT FROM p_actor OR v_claim.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'ZTC_CLAIM: submission claim is no longer current' USING ERRCODE = '42501';
  END IF;

  -- The matching token authorizes retention of the completed attempt even
  -- if the operator was revoked while the provider request was in flight.
  v_pipeline := CASE WHEN strpos(v_issuance.unsigned_xml, '<cbc:InvoiceTypeCode name="02') > 0
    THEN 'reporting' ELSE 'clearance' END;
  v_accepted_status := CASE WHEN v_pipeline = 'reporting' THEN 'reported' ELSE 'cleared' END;
  IF jsonb_typeof(p_attempt) IS DISTINCT FROM 'object'
    OR v_status IS NULL OR v_status NOT IN (v_accepted_status, 'rejected', 'failed') THEN
    RAISE EXCEPTION 'ZTC_ATTEMPT: invalid submission evidence';
  END IF;

  INSERT INTO public.zatca_submission_attempts (
    tenant_id, issuance_id, environment, pipeline, status, http_status, invoice_hash,
    signed_xml, cleared_xml, response, error_code, created_by
  ) VALUES (
    p_tenant, p_issuance, v_issuance.environment, v_pipeline, v_status,
    (p_attempt->>'http_status')::integer, v_issuance.invoice_hash, p_attempt->>'signed_xml',
    p_attempt->>'cleared_xml', p_attempt->'response', p_attempt->>'error_code', p_actor
  ) RETURNING created_at INTO v_recorded_at;

  DELETE FROM zatca_submission_private.claims WHERE issuance_id = p_issuance;
  RETURN v_recorded_at;
END $$;

REVOKE ALL ON FUNCTION public.claim_zatca_submission(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_zatca_submission(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zatca_submission(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_zatca_submission(uuid, uuid, uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.record_zatca_transmission(
  p_tenant uuid, p_actor uuid, p_source_type text, p_source_id uuid,
  p_payload_xml text, p_status public.zatca_status, p_zatca_uuid text,
  p_response jsonb, p_error_message text, p_transmitted_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_source jsonb; v_ref text;
  v_issuance public.zatca_document_issuances%ROWTYPE;
  v_accepting_signed boolean;
  v_has_acceptance boolean;
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
  ELSIF v_source->>'status'<>'finalized' OR p_response->'sandbox' IS DISTINCT FROM 'true'::jsonb THEN
    -- Offline mocks cannot reclassify a payment-state invoice or masquerade
    -- as a signed environment submission.
    RAISE EXCEPTION 'ZTC_EVIDENCE: retained issuance or explicit mock required';
  END IF;
  v_accepting_signed := v_issuance.id IS NOT NULL AND p_status IN ('reported','cleared');
  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_document_issuances d
    JOIN public.zatca_submission_attempts a ON a.issuance_id=d.id
      AND a.tenant_id=d.tenant_id AND a.environment=d.environment AND a.invoice_hash=d.invoice_hash
    WHERE d.tenant_id=p_tenant AND d.source_type=p_source_type AND d.source_id=p_source_id
      AND d.environment IN ('sandbox','simulation')
      AND ((a.pipeline='reporting' AND a.status='reported') OR (a.pipeline='clearance' AND a.status='cleared'))
      AND (NOT v_accepting_signed OR (d.id=v_issuance.id AND a.status=p_status::text))
  ) INTO v_has_acceptance;
  IF v_accepting_signed AND NOT v_has_acceptance THEN
    RAISE EXCEPTION 'ZTC_EVIDENCE: accepted transmission requires retained submission evidence';
  END IF;
  IF NOT v_accepting_signed AND v_has_acceptance THEN
    -- A delayed worker may finish while the accepted attempt still awaits
    -- projection. Only signed acceptance may update the projection now.
    RETURN true;
  END IF;
  INSERT INTO public.zatca_transmissions AS stored(tenant_id,invoice_id,source_id,doc_type,doc_ref,payload_xml,
    status,zatca_uuid,response,error_message,transmitted_at,created_by,updated_by)
  VALUES(p_tenant,v_invoice.id,p_source_id,p_source_type,v_ref,p_payload_xml,
    p_status,p_zatca_uuid,p_response,p_error_message,p_transmitted_at,p_actor,p_actor)
  ON CONFLICT (tenant_id,doc_type,source_id) DO UPDATE SET
    payload_xml=EXCLUDED.payload_xml,status=EXCLUDED.status,zatca_uuid=EXCLUDED.zatca_uuid,
    response=EXCLUDED.response,error_message=EXCLUDED.error_message,
    transmitted_at=EXCLUDED.transmitted_at,updated_by=p_actor,updated_at=clock_timestamp()
  -- Preserve the first accepted projection for this immutable issuance.
  -- A late failure, including from another environment, and an offline mock
  -- cannot overwrite signed acceptance.
  WHERE NOT (
    stored.status IN ('reported','cleared')
    AND stored.response->>'issuance_id' IS NOT NULL
    AND (
      stored.response->>'issuance_id' IS NOT DISTINCT FROM EXCLUDED.response->>'issuance_id'
      OR EXCLUDED.status NOT IN ('reported','cleared')
      OR EXCLUDED.response->'sandbox' = 'true'::jsonb AND NOT (EXCLUDED.response ? 'issuance_id')
    )
  );
  IF NOT FOUND THEN RETURN true; END IF;
  IF p_source_type='invoice' THEN
    UPDATE public.invoices SET zatca_status=p_status,zatca_uuid=p_zatca_uuid,updated_by=p_actor
      WHERE id=v_invoice.id AND tenant_id=p_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'ZTC_SOURCE: invoice disappeared'; END IF;
  END IF;
  RETURN true;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
