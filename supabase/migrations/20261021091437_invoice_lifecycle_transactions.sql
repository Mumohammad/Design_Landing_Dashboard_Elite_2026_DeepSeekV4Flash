BEGIN;

-- New transitions only: do not reinterpret or repair existing production data.
-- A receipt proves that the version reviewed by this actor was committed with
-- its audit and outbox event. A lost response may replay that exact decision.
CREATE TABLE public.invoice_transition_receipts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  operation text NOT NULL CHECK(operation IN ('issue','finalize')),
  actor_id uuid NOT NULL,
  input_updated_at timestamptz NOT NULL,
  event_id uuid REFERENCES public.financial_events(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,invoice_id,operation)
);
ALTER TABLE public.invoice_transition_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX invoice_transition_receipts_invoice ON public.invoice_transition_receipts(invoice_id);
CREATE INDEX invoice_transition_receipts_event ON public.invoice_transition_receipts(event_id);
REVOKE ALL ON public.invoice_transition_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Line writers take the same parent lock as lifecycle/draft RPCs. Issued
-- lines are frozen, and moving a line to another parent cannot bypass the
-- original parent's immutability or tenant boundary.
CREATE OR REPLACE FUNCTION public.protect_invoice_lines() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_parent public.invoices%ROWTYPE; v_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'INV003: invoice lines cannot change parent or tenant';
  END IF;
  v_id := CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT * INTO v_parent FROM public.invoices WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM
    (CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END) THEN
    RAISE EXCEPTION 'INV001: invoice parent not found';
  END IF;
  IF v_parent.status<>'draft' OR v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INV003: only draft invoice lines can change';
  END IF;
  UPDATE public.invoices SET updated_at=clock_timestamp() WHERE id=v_id;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION public.transition_my_invoice(
  p_invoice_id uuid,p_operation text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
      OR length(btrim(v_line.description)) NOT BETWEEN 1 AND 1000
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
    v_lines := v_lines||jsonb_build_object('line_no',v_line.line_no,'description',v_line.description,
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
END $$;
REVOKE ALL ON FUNCTION public.transition_my_invoice(uuid,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.transition_my_invoice(uuid,text,timestamptz) TO authenticated;
COMMIT;
