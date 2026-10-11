-- Draft header, line replacement and audit history are one transaction.
-- Uses caller JWT (not a supplied tenant/actor), because server validation alone
-- cannot protect direct RPC callers. Definer is required for line replacement
-- and the append-only, service-owned audit trail; existing grants/RLS stay intact.
CREATE OR REPLACE FUNCTION public.save_invoice_draft_atomic(
  p_document jsonb,
  p_lines jsonb,
  p_invoice_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_number text;
  v_existing public.invoices%ROWTYPE;
  v_type public.invoice_type;
  v_customer uuid;
  v_supplier uuid;
  v_issue date;
  v_due date;
  v_currency text;
  v_rate numeric(5,2);
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_qty numeric(12,3);
  v_price numeric(12,2);
  v_discount numeric(12,2);
  v_line_rate numeric(5,2);
  v_gross numeric(12,2);
  v_amount numeric(12,2);
  v_vat numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_discounts numeric(12,2) := 0;
  v_vats numeric(12,2) := 0;
  v_total numeric(12,2);
  v_no integer := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'INV_AUTH: active tenant account required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('invoices', CASE WHEN p_invoice_id IS NULL THEN 'create' ELSE 'update' END) THEN
    RAISE EXCEPTION 'INV_PERMISSION: insufficient invoice permission' USING ERRCODE = '42501';
  END IF;
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' OR
     p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'INV002: invalid draft payload';
  END IF;
  IF jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 1000 THEN
    RAISE EXCEPTION 'INV013: invoice requires 1 to 1000 lines';
  END IF;
  IF (p_document->>'invoice_type') IS NULL OR p_document->>'invoice_type' NOT IN ('sales', 'purchase') THEN
    RAISE EXCEPTION 'INV002: invalid invoice type';
  END IF;
  v_type := (p_document->>'invoice_type')::public.invoice_type;
  IF COALESCE(p_document->>'issue_date', '') !~ '^\d{4}-\d{2}-\d{2}$' OR
     COALESCE(p_document->>'due_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INV008: valid issue and due dates required';
  END IF;
  v_issue := (p_document->>'issue_date')::date;
  v_due := (p_document->>'due_date')::date;
  IF v_due < v_issue THEN RAISE EXCEPTION 'INV008: due date precedes issue date'; END IF;
  v_currency := COALESCE(p_document->>'currency', 'SAR');
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'INV002: invalid currency code'; END IF;
  IF COALESCE(p_document->>'vat_rate', '15') !~ '^\d+(\.\d+)?$' THEN
    RAISE EXCEPTION 'INV002: invalid VAT rate';
  END IF;
  IF COALESCE(p_document->>'vat_rate', '15')::numeric > 100 THEN RAISE EXCEPTION 'INV002: invalid VAT rate'; END IF;
  v_rate := COALESCE(p_document->>'vat_rate', '15')::numeric;
  IF v_type = 'sales' THEN
    v_customer := NULLIF(p_document->>'customer_id', '')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'CUS001: customer not found in caller tenant';
    END IF;
  ELSE
    v_supplier := NULLIF(p_document->>'supplier_id', '')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'SUP001: supplier not found in caller tenant';
    END IF;
  END IF;

  -- Lock before any changes. An issued/finalized/foreign/deleted invoice
  -- cannot be overwritten, even if the UI read an earlier draft snapshot.
  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.invoices
      WHERE id = p_invoice_id AND tenant_id = v_tenant AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INV001: invoice not found'; END IF;
    IF v_existing.status <> 'draft' OR v_existing.invoice_type <> v_type THEN
      RAISE EXCEPTION 'INV006: only matching draft invoices may be edited';
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object' OR COALESCE(btrim(v_line->>'description'), '') = '' OR
       COALESCE(v_line->>'quantity', '') !~ '^\d+(\.\d+)?$' OR
       COALESCE(v_line->>'unit_price', '') !~ '^\d+(\.\d+)?$' OR
       COALESCE(v_line->>'discount', '0') !~ '^\d+(\.\d+)?$' OR
       COALESCE(v_line->>'vat_rate', v_rate::text) !~ '^\d+(\.\d+)?$' THEN
      RAISE EXCEPTION 'INV002: invalid invoice line';
    END IF;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_discount := COALESCE(v_line->>'discount', '0')::numeric;
    IF COALESCE(v_line->>'vat_rate', v_rate::text)::numeric > 100 THEN RAISE EXCEPTION 'INV002: invalid quantity or VAT rate'; END IF;
    v_line_rate := COALESCE(v_line->>'vat_rate', v_rate::text)::numeric;
    IF v_qty <= 0 OR v_line_rate > 100 THEN RAISE EXCEPTION 'INV002: invalid quantity or VAT rate'; END IF;
    v_gross := round(v_qty * v_price, 2);
    IF v_discount > v_gross THEN RAISE EXCEPTION 'INV002: discount exceeds line gross amount'; END IF;
    v_amount := v_gross - v_discount;
    v_vat := round(v_amount * v_line_rate / 100, 2);
    v_subtotal := v_subtotal + v_amount;
    v_discounts := v_discounts + v_discount;
    v_vats := v_vats + v_vat;
    v_no := v_no + 1;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_no, 'description', btrim(v_line->>'description'),
      'quantity', v_qty, 'unit_price', v_price, 'discount', v_discount,
      'amount', v_amount, 'vat_rate', v_line_rate, 'vat_amount', v_vat));
  END LOOP;
  v_total := v_subtotal + v_vats;
  IF p_invoice_id IS NULL THEN
    INSERT INTO public.invoices (tenant_id, invoice_type, customer_id, supplier_id,
      issue_date, due_date, currency, status, subtotal, discount, vat_amount, total, vat_rate, notes, created_by)
    VALUES (v_tenant, v_type, v_customer, v_supplier, v_issue, v_due, v_currency, 'draft',
      v_subtotal, v_discounts, v_vats, v_total, v_rate, NULLIF(btrim(p_document->>'notes'), ''), v_actor)
    RETURNING id, invoice_number INTO v_id, v_number;
  ELSE
    UPDATE public.invoices SET customer_id = v_customer, supplier_id = v_supplier,
      issue_date = v_issue, due_date = v_due, currency = v_currency,
      subtotal = v_subtotal, discount = v_discounts, vat_amount = v_vats,
      total = v_total, vat_rate = v_rate, notes = NULLIF(btrim(p_document->>'notes'), ''), updated_by = v_actor
    WHERE id = p_invoice_id AND tenant_id = v_tenant
    RETURNING id, invoice_number INTO v_id, v_number;
    DELETE FROM public.invoice_lines WHERE invoice_id = v_id AND tenant_id = v_tenant;
  END IF;
  INSERT INTO public.invoice_lines (tenant_id, invoice_id, line_no, description,
    quantity, unit_price, discount, amount, vat_rate, vat_amount, created_by)
  SELECT v_tenant, v_id, l.line_no, l.description, l.quantity, l.unit_price, l.discount,
    l.amount, l.vat_rate, l.vat_amount, v_actor
  FROM jsonb_to_recordset(v_lines) AS l(line_no integer, description text,
    quantity numeric, unit_price numeric, discount numeric, amount numeric, vat_rate numeric, vat_amount numeric);
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (v_tenant, v_actor, 'invoices', 'invoices', v_id,
    CASE WHEN p_invoice_id IS NULL THEN 'invoice_draft_created' ELSE 'invoice_draft_updated' END,
    CASE WHEN p_invoice_id IS NULL THEN NULL ELSE to_jsonb(v_existing) END,
    jsonb_build_object('invoice_number', v_number, 'invoice_type', v_type, 'lines', v_no, 'total', v_total));
  RETURN jsonb_build_object('id', v_id, 'invoice_number', v_number);
END;
$$;
REVOKE ALL ON FUNCTION public.save_invoice_draft_atomic(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_invoice_draft_atomic(jsonb, jsonb, uuid) TO authenticated;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.save_invoice_draft_atomic(jsonb,jsonb,uuid)', 'EXECUTE') OR
     NOT has_function_privilege('authenticated', 'public.save_invoice_draft_atomic(jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Invoice draft RPC grant postcondition failed';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
