BEGIN;

-- Header, replacement lines and audit evidence commit together. The definer
-- is needed for line replacement; identity and permissions come from Auth,
-- never from caller-supplied tenant/actor IDs.
CREATE FUNCTION public.save_invoice_draft(
  p_input jsonb, p_invoice_id uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  v_amount numeric; v_vat numeric; v_description text;
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
    v_description := btrim(COALESCE(v_line->>'description',''));
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_discount := COALESCE((v_line->>'discount')::numeric,0);
    v_vat_rate := COALESCE((v_line->>'vat_rate')::numeric,v_rate);
    IF length(v_description) NOT BETWEEN 1 AND 1000
      OR v_qty IS NULL OR v_qty NOT BETWEEN 0.001 AND 999999999.999 OR v_qty <> round(v_qty,3)
      OR v_price IS NULL OR v_price NOT BETWEEN 0 AND 9999999999.99 OR v_price <> round(v_price,2)
      OR v_discount NOT BETWEEN 0 AND 9999999999.99 OR v_discount <> round(v_discount,2)
      OR v_vat_rate NOT BETWEEN 0 AND 100 OR v_vat_rate <> round(v_vat_rate,2) THEN
      RAISE EXCEPTION 'INV002: invalid invoice line'; END IF;
    v_amount := round(v_qty*v_price,2)-v_discount;
    IF v_amount < 0 THEN RAISE EXCEPTION 'INV002: discount exceeds line value'; END IF;
    v_vat := round(v_amount*v_vat_rate/100,2);
    v_subtotal := v_subtotal+v_amount;
    v_discounts := v_discounts+v_discount;
    v_vats := v_vats+v_vat;
    v_lines := v_lines || jsonb_build_object('line_no',v_no,'description',v_description,
      'quantity',v_qty,'unit_price',v_price,'discount',v_discount,'amount',v_amount,
      'vat_rate',v_vat_rate,'vat_amount',v_vat);
  END LOOP;
  IF p_invoice_id IS NULL THEN
    INSERT INTO public.invoices(tenant_id,invoice_type,customer_id,supplier_id,issue_date,due_date,
      currency,vat_rate,notes,subtotal,discount,vat_amount,total,created_by)
    VALUES(v_tenant,v_type,CASE WHEN v_type='sales' THEN v_party END,
      CASE WHEN v_type='purchase' THEN v_party END,v_issue,v_due,v_currency,v_rate,
      NULLIF(btrim(p_input->>'notes'),''),v_subtotal,v_discounts,v_vats,v_subtotal+v_vats,v_actor)
    RETURNING * INTO v_invoice;
  ELSE
    UPDATE public.invoices SET customer_id=CASE WHEN v_type='sales' THEN v_party END,
      supplier_id=CASE WHEN v_type='purchase' THEN v_party END,issue_date=v_issue,due_date=v_due,
      currency=v_currency,vat_rate=v_rate,notes=NULLIF(btrim(p_input->>'notes'),''),
      subtotal=v_subtotal,discount=v_discounts,vat_amount=v_vats,total=v_subtotal+v_vats,updated_by=v_actor
    WHERE id=p_invoice_id RETURNING * INTO v_invoice;
    DELETE FROM public.invoice_lines WHERE invoice_id=p_invoice_id AND tenant_id=v_tenant;
  END IF;
  INSERT INTO public.invoice_lines(tenant_id,invoice_id,line_no,description,quantity,unit_price,
    discount,amount,vat_rate,vat_amount,created_by)
  SELECT v_tenant,v_invoice.id,l.line_no,l.description,l.quantity,l.unit_price,l.discount,
    l.amount,l.vat_rate,l.vat_amount,v_actor
  FROM jsonb_to_recordset(v_lines) AS l(line_no integer,description text,quantity numeric,
    unit_price numeric,discount numeric,amount numeric,vat_rate numeric,vat_amount numeric);
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,v_actor,'invoices','invoices',v_invoice.id,
    CASE WHEN p_invoice_id IS NULL THEN 'invoice_draft_created' ELSE 'invoice_draft_updated' END,
    jsonb_build_object('total',v_invoice.total,'line_count',v_no));
  RETURN jsonb_build_object('id',v_invoice.id,'updated_at',v_invoice.updated_at,'total',v_invoice.total);
END;
$$;

CREATE FUNCTION public.delete_invoice_draft(p_invoice_id uuid,p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid := public.get_my_tenant_id(); v_invoice public.invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('invoices','delete') THEN
    RAISE EXCEPTION 'AUTH007: invoice delete permission required'; END IF;
  SELECT * INTO v_invoice FROM public.invoices
    WHERE id=p_invoice_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
  IF v_invoice.status <> 'draft' THEN RAISE EXCEPTION 'INV006: only drafts can be deleted'; END IF;
  IF p_expected_updated_at IS NULL OR v_invoice.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'INV015: invoice changed; reload before deleting'; END IF;
  UPDATE public.invoices SET deleted_at=now(),updated_by=auth.uid() WHERE id=p_invoice_id;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action)
  VALUES(v_tenant,auth.uid(),'invoices','invoices',p_invoice_id,'invoice_draft_deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.save_invoice_draft(jsonb,uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.delete_invoice_draft(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_invoice_draft(jsonb,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_invoice_draft(uuid,timestamptz) TO authenticated;
-- Prevent direct browser writes from bypassing atomic totals and lifecycle checks.
-- Existing lifecycle server actions use their separately authorized service client.
REVOKE INSERT,UPDATE,DELETE ON public.invoices,public.invoice_lines FROM authenticated,anon;
COMMIT;
