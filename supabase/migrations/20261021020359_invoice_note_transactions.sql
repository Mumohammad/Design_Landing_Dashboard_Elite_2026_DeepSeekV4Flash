BEGIN;
-- New requests only. Existing notes/effects are never inferred or repaired.
CREATE TABLE public.invoice_note_requests(
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  kind text NOT NULL CHECK(kind IN ('credit','debit')),
  request_payload jsonb NOT NULL,
  note_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.financial_events(event_id),
  receivable_id uuid NOT NULL REFERENCES public.receivables(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,request_id),
  UNIQUE(tenant_id,kind,note_id)
);
ALTER TABLE public.invoice_note_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_note_requests FROM PUBLIC,anon,authenticated,service_role;
-- Invoker consumers validate receipts when the trusted dispatcher replays an
-- event. Keep document decisions private to the RPC; the service gets reads only.
GRANT SELECT ON public.invoice_note_requests TO service_role;
CREATE INDEX invoice_note_requests_invoice ON public.invoice_note_requests(invoice_id);
CREATE INDEX invoice_note_requests_event ON public.invoice_note_requests(event_id);
CREATE INDEX invoice_note_requests_receivable ON public.invoice_note_requests(receivable_id);
REVOKE INSERT,UPDATE,DELETE ON public.credit_notes,public.debit_notes FROM authenticated,anon;

-- The Data API must not create a second source AR or reopen a credited
-- balance behind the caller-bound document/payment transactions.
CREATE FUNCTION public.protect_document_receivable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF (TG_OP<>'INSERT' AND OLD.source_entity_type IN('invoice','debit_note'))
      OR (TG_OP<>'DELETE' AND NEW.source_entity_type IN('invoice','debit_note')) THEN
      RAISE EXCEPTION 'INV_MANAGED_AR: use the guarded document or payment workflow';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.protect_document_receivable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_document_receivable BEFORE INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_receivable();

CREATE FUNCTION public.protect_document_payable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF (TG_OP<>'INSERT' AND OLD.source_entity_type IN('purchase_invoice','expense'))
      OR (TG_OP<>'DELETE' AND NEW.source_entity_type IN('purchase_invoice','expense')) THEN
      RAISE EXCEPTION 'INV_MANAGED_AP: use the guarded document or payment workflow';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.protect_document_payable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_document_payable BEFORE INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_payable();

CREATE FUNCTION public.create_invoice_note_atomic(
  p_request_id uuid,p_invoice_id uuid,p_expected_updated_at timestamptz,p_kind text,p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
      IF v_line.tenant_id<>v_tenant OR v_line.line_no<>v_count OR length(btrim(v_line.description)) NOT BETWEEN 1 AND 1000
        OR v_line.quantity NOT BETWEEN 0.001 AND 999999999.999 OR v_line.unit_price NOT BETWEEN 0 AND 9999999999.99
        OR v_line.discount NOT BETWEEN 0 AND 9999999999.99 OR v_line.vat_rate NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'INV004: reference lines require review'; END IF;
      v_amount:=round(v_line.quantity*v_line.unit_price,2)-v_line.discount;
      v_line_vat:=round(v_amount*v_line.vat_rate/100,2);
      IF v_amount<0 OR v_line.amount IS DISTINCT FROM v_amount OR v_line.vat_amount IS DISTINCT FROM v_line_vat THEN
        RAISE EXCEPTION 'INV004: reference line amounts do not reconcile'; END IF;
      v_subtotal:=v_subtotal+v_amount;v_discount:=v_discount+v_line.discount;v_vat:=v_vat+v_line_vat;
      v_lines:=v_lines||jsonb_build_object('line_no',v_line.line_no,'description',v_line.description,'quantity',v_line.quantity,
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
END $$;
REVOKE ALL ON FUNCTION public.create_invoice_note_atomic(uuid,uuid,timestamptz,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_note_atomic(uuid,uuid,timestamptz,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_credit_note(p_ev public.financial_events)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_note public.credit_notes%ROWTYPE; v_request public.invoice_note_requests%ROWTYPE;
  v_ar public.receivables%ROWTYPE; v_journal uuid;
  v_lines jsonb; v_entry uuid; v_ref text;
BEGIN
  SELECT * INTO v_note FROM public.credit_notes WHERE id=p_ev.source_id AND tenant_id=p_ev.tenant_id AND status='finalized';
  IF NOT FOUND OR p_ev.event_date<>v_note.issue_date THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: invalid credit source or date'; END IF;
  SELECT * INTO v_request FROM public.invoice_note_requests WHERE tenant_id=p_ev.tenant_id AND kind='credit'
    AND note_id=v_note.id AND event_id=p_ev.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: credit decision receipt required'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_ev.tenant_id AND source_module='accounting'
    AND source_entity_type='credit_note' AND source_entity_id=v_note.id AND entry_type='reversal' AND status='posted') THEN RETURN 'skipped'; END IF;
  SELECT * INTO v_ar FROM public.receivables WHERE id=v_request.receivable_id AND tenant_id=p_ev.tenant_id FOR UPDATE;
  IF NOT FOUND OR v_ar.deleted_at IS NULL OR v_ar.paid_amount<>0 OR v_ar.amount<>v_note.subtotal
    OR v_ar.vat_amount<>v_note.vat_amount OR v_ar.total_amount<>v_note.total
    OR v_ar.source_entity_type<>'invoice' OR v_ar.source_entity_id<>v_note.reference_invoice_id THEN
    RAISE EXCEPTION 'INV_NOTE_REVIEW: credited receivable does not reconcile'; END IF;
  -- A full credit reverses the actual posted accounts, even if chart codes
  -- have since changed. Never silently route historical revenue to a new code.
  SELECT id INTO v_journal FROM public.journal_entries WHERE tenant_id=p_ev.tenant_id
    AND source_module='accounting' AND source_entity_type='invoice' AND source_entity_id=v_note.reference_invoice_id
    AND entry_type='invoice' AND status='posted' AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: original posted journal required'; END IF;
  SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'description',v_note.credit_note_number,
    'debit',credit_amount,'credit',debit_amount) ORDER BY id) INTO v_lines FROM public.journal_entry_lines
    WHERE tenant_id=p_ev.tenant_id AND journal_entry_id=v_journal;
  IF v_lines IS NULL OR jsonb_array_length(v_lines)<2 THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: original journal lines required'; END IF;
  SELECT * INTO v_entry,v_ref FROM public.post_journal_entry(p_ev.tenant_id,v_note.issue_date,
    'إشعار دائن — '||v_note.credit_note_number,v_lines,NULL,v_note.created_by,'reversal','credit_note',v_note.id);
  INSERT INTO public.vat_adjustments(tenant_id,period_year,period_month,adjustment_type,direction,
    base_amount,vat_amount,reason,status,finalized_at,source_entity_type,source_entity_id,created_by)
  VALUES(p_ev.tenant_id,extract(year FROM v_note.issue_date),extract(month FROM v_note.issue_date),'credit_note','output',
    v_note.subtotal,-v_note.vat_amount,v_note.reason,'finalized',now(),'credit_note',v_note.id,v_note.created_by);
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_debit_note(p_ev public.financial_events)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_note public.debit_notes%ROWTYPE; v_request public.invoice_note_requests%ROWTYPE;
  v_ar uuid; v_revenue uuid; v_vat_account uuid; v_lines jsonb; v_entry uuid; v_ref text; v_due date;
BEGIN
  SELECT * INTO v_note FROM public.debit_notes WHERE id=p_ev.source_id AND tenant_id=p_ev.tenant_id AND status='finalized';
  IF NOT FOUND OR p_ev.event_date<>v_note.issue_date THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: invalid debit source or date'; END IF;
  SELECT * INTO v_request FROM public.invoice_note_requests WHERE tenant_id=p_ev.tenant_id AND kind='debit'
    AND note_id=v_note.id AND event_id=p_ev.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: debit decision receipt required'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_ev.tenant_id AND source_module='accounting'
    AND source_entity_type='debit_note' AND source_entity_id=v_note.id AND entry_type='invoice' AND status='posted') THEN RETURN 'skipped'; END IF;
  SELECT greatest(due_date,v_note.issue_date) INTO v_due FROM public.invoices WHERE id=v_note.reference_invoice_id
    AND tenant_id=p_ev.tenant_id AND invoice_type='sales' AND currency='SAR' AND customer_id=v_note.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INV_NOTE_REVIEW: debit reference requires review'; END IF;
  v_ar:=public.resolve_coa_account(p_ev.tenant_id,'1200');v_revenue:=public.resolve_coa_account(p_ev.tenant_id,'4000');
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_id',v_ar,'description',v_note.debit_note_number,'debit',v_note.total,'credit',0),
    jsonb_build_object('account_id',v_revenue,'description',v_note.debit_note_number,'debit',0,'credit',v_note.subtotal));
  IF v_note.vat_amount>0 THEN
    v_vat_account:=public.resolve_coa_account(p_ev.tenant_id,'2500');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_vat_account,'description',v_note.debit_note_number,'debit',0,'credit',v_note.vat_amount));
  END IF;
  SELECT * INTO v_entry,v_ref FROM public.post_journal_entry(p_ev.tenant_id,v_note.issue_date,
    'إشعار مدين — '||v_note.debit_note_number,v_lines,NULL,v_note.created_by,'invoice','debit_note',v_note.id);
  INSERT INTO public.vat_adjustments(tenant_id,period_year,period_month,adjustment_type,direction,
    base_amount,vat_amount,reason,status,finalized_at,source_entity_type,source_entity_id,created_by)
  VALUES(p_ev.tenant_id,extract(year FROM v_note.issue_date),extract(month FROM v_note.issue_date),'debit_note','output',
    v_note.subtotal,v_note.vat_amount,v_note.reason,'finalized',now(),'debit_note',v_note.id,v_note.created_by);
  INSERT INTO public.receivables(tenant_id,customer_id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,
    paid_amount,status,source_entity_type,source_entity_id,created_by)
  VALUES(p_ev.tenant_id,v_note.customer_id,v_note.debit_note_number,v_note.issue_date,v_due,v_note.subtotal,v_note.vat_amount,
    v_note.total,0,'open','debit_note',v_note.id,v_note.created_by);
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.dispatch_credit_note(public.financial_events),public.dispatch_debit_note(public.financial_events)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_credit_note(public.financial_events),public.dispatch_debit_note(public.financial_events) TO service_role;
COMMIT;
