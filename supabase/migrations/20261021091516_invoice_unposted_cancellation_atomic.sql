BEGIN;
-- Only unposted invoices can be cancelled here. Posted document corrections
-- remain in the credit/review workflow; existing effects are never repaired.
-- Session callers emit financial events only through their guarded RPCs.
REVOKE INSERT,UPDATE,DELETE ON public.financial_events FROM authenticated,anon;
ALTER TABLE public.invoice_transition_receipts ADD COLUMN input_reason text;
ALTER TABLE public.invoice_transition_receipts
  DROP CONSTRAINT invoice_transition_receipts_operation_check;
ALTER TABLE public.invoice_transition_receipts
  ADD CONSTRAINT invoice_transition_receipts_operation_check CHECK(operation IN('issue','finalize','cancel'));
ALTER TABLE public.invoice_transition_receipts
  ADD CONSTRAINT invoice_transition_receipts_cancel_reason_check CHECK(operation<>'cancel' OR
    (input_reason IS NOT NULL AND length(input_reason) BETWEEN 5 AND 500 AND event_id IS NULL));

CREATE FUNCTION public.cancel_unposted_invoice_atomic(
  p_invoice_id uuid,p_expected_updated_at timestamptz,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid:=auth.uid(); v_tenant uuid:=public.get_my_tenant_id();
  v_inv public.invoices%ROWTYPE; v_receipt public.invoice_transition_receipts%ROWTYPE;
  v_reason text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.has_required_assurance()
    OR NOT public.user_has_permission('invoices','update') OR NOT EXISTS(
      SELECT 1 FROM public.users WHERE auth_user_id=v_actor AND tenant_id=v_tenant
        AND status='active' AND deleted_at IS NULL AND NOT must_change_password
        AND (locked_until IS NULL OR locked_until<=now())) THEN
    RAISE EXCEPTION 'AUTH007: active invoice update permission required';
  END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'INV002: cancellation reason must contain 5 to 500 characters';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'INV015: reviewed invoice version required';
  END IF;

  -- Payment/note consumers lock AR before the posted parent. Excluding posted
  -- states from this lock keeps this path outside their parent-lock ordering.
  -- Cancelled is included only so an exact committed cancellation may replay.
  SELECT * INTO v_inv FROM public.invoices WHERE id=p_invoice_id AND tenant_id=v_tenant
    AND deleted_at IS NULL AND status IN('draft','issued','cancelled') FOR UPDATE;
  IF NOT FOUND THEN
    -- A competing finalization may have won after our initial snapshot. Read
    -- its result without taking any parent, AR, payable, or payment row locks.
    SELECT * INTO v_inv FROM public.invoices WHERE id=p_invoice_id AND tenant_id=v_tenant AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
    IF v_inv.status IN('finalized','paid','partially_paid','overdue','credited') THEN
      RAISE EXCEPTION 'INV_CANCEL_POSTED: posted invoices require the credit or review workflow';
    END IF;
    RAISE EXCEPTION 'INV006: invoice state does not permit cancellation';
  END IF;

  SELECT * INTO v_receipt FROM public.invoice_transition_receipts
    WHERE tenant_id=v_tenant AND invoice_id=p_invoice_id AND operation='cancel';
  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM v_actor
      OR v_receipt.input_updated_at IS DISTINCT FROM p_expected_updated_at
      OR v_receipt.input_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'INV015: another cancellation decision exists; reload invoice';
    END IF;
    IF v_inv.status<>'cancelled' THEN
      RAISE EXCEPTION 'INV006: invoice state changed after cancellation';
    END IF;
    RETURN jsonb_build_object('id',v_inv.id,'operation','cancel','replayed',true);
  END IF;
  IF v_inv.status NOT IN('draft','issued') THEN
    RAISE EXCEPTION 'INV006: invoice state does not permit cancellation';
  END IF;
  IF v_inv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'INV015: invoice changed; reload before cancellation';
  END IF;

  -- Evidence under another tenant or an archived financial row is still
  -- evidence of a historical/partial posting. Fail closed on the invoice UUID
  -- instead of adopting, deleting, reversing, or otherwise repairing effects.
  -- These are reads only: no AR/AP/payment locks are taken by this transaction.
  IF v_inv.finalized_at IS NOT NULL OR v_inv.finalized_by IS NOT NULL
    OR v_inv.zatca_status<>'not_transmitted' OR v_inv.zatca_uuid IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.zatca_document_issuances WHERE source_type='invoice' AND source_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.zatca_transmissions WHERE invoice_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.financial_events WHERE source_id=v_inv.id
      OR payload->>'reference_invoice_id'=v_inv.id::text)
    OR EXISTS(SELECT 1 FROM public.journal_entries WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.receivables WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.payables WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.vat_output_ledger WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.vat_input_ledger WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.vat_adjustments WHERE source_entity_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.credit_notes WHERE reference_invoice_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.debit_notes WHERE reference_invoice_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.invoice_note_requests WHERE invoice_id=v_inv.id)
    OR EXISTS(SELECT 1 FROM public.invoice_transition_receipts WHERE invoice_id=v_inv.id AND operation='finalize') THEN
    RAISE EXCEPTION 'INV_CANCEL_REVIEW: existing accounting evidence requires review before cancellation';
  END IF;

  UPDATE public.invoices SET status='cancelled',cancel_reason=v_reason,cancelled_at=clock_timestamp(),
    cancelled_by=v_actor,updated_by=v_actor WHERE id=v_inv.id AND tenant_id=v_tenant;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
  VALUES(v_tenant,v_actor,'invoices','invoices',v_inv.id,'invoice_cancelled',
    jsonb_build_object('status',v_inv.status),jsonb_build_object('status','cancelled',
      'invoice_number',v_inv.invoice_number,'cancel_reason',v_reason,'input_updated_at',p_expected_updated_at));
  INSERT INTO public.invoice_transition_receipts(tenant_id,invoice_id,operation,actor_id,input_updated_at,input_reason)
  VALUES(v_tenant,v_inv.id,'cancel',v_actor,p_expected_updated_at,v_reason);
  RETURN jsonb_build_object('id',v_inv.id,'operation','cancel','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.cancel_unposted_invoice_atomic(uuid,timestamptz,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_unposted_invoice_atomic(uuid,timestamptz,text) TO authenticated;
COMMIT;
