-- Expense approval, payable, accounting event and approval audit commit together.
-- No existing financial data or audit history is rewritten.
CREATE OR REPLACE FUNCTION public.approve_expense_with_context_atomic(
  p_tenant_id          UUID,
  p_expense_id         UUID,
  p_vat_rate           NUMERIC,
  p_vat_recoverability TEXT,
  p_actor              UUID,
  p_reason             TEXT,
  p_surface            TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expense   RECORD;
  v_mapping   RECORD;
  v_amount    NUMERIC;
  v_vat       NUMERIC;
  v_total     NUMERIC;
  v_ref       TEXT;
  v_recover   TEXT;
  v_claimed   INT;
  v_live_ap   INT;
  v_event_id  UUID;
  v_event_rows INT;
BEGIN
  IF p_actor IS NULL OR p_tenant_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.users WHERE auth_user_id=p_actor AND tenant_id=p_tenant_id
      AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=now())
  ) THEN RAISE EXCEPTION 'EXP_AUTH: active tenant approver required' USING ERRCODE='42501';END IF;
  IF p_surface IS NULL OR p_surface NOT IN('expenses','approvals_inbox')
    OR (p_reason IS NOT NULL AND char_length(btrim(p_reason))>500)
    OR (p_surface='approvals_inbox' AND (p_reason IS NULL OR char_length(btrim(p_reason))<5)) THEN
    RAISE EXCEPTION 'EXP_INPUT: valid approval context and reason required' USING ERRCODE='22023';
  END IF;
  -- ── RPC-owned validation (review item 3) ──────────────────────────────
  -- SECURITY DEFINER: must not depend exclusively on TypeScript validation.
  -- Matches the EXP003 contract in src/lib/expenses/actions.ts.
  IF (p_vat_rate IS NULL AND p_surface<>'approvals_inbox')
     OR p_vat_rate < 0 OR p_vat_rate > 100 THEN
    RAISE EXCEPTION 'EXP003: invalid VAT rate';
  END IF;
  -- Mirrors RECOVERABILITY in src/lib/expenses/constants.ts exactly.
  IF p_vat_recoverability IS NOT NULL
     AND p_vat_recoverability NOT IN
         ('recoverable', 'non_recoverable', 'pending_review') THEN
    RAISE EXCEPTION 'EXP003: invalid recoverability';
  END IF;
  -- ── Read the expense and the category→CoA mapping ─────────────────────
  SELECT id, expense_code, expense_type, category, amount, expense_date,
         description, vendor, driver_id, vehicle_id, is_approved,vat_rate
    INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP001: expense not found';
  END IF;

  -- The inbox has no VAT editor. Resolve its omitted rate from the locked
  -- source, including an explicit zero, then calculate at retained precision.
  p_vat_rate := COALESCE(p_vat_rate,v_expense.vat_rate);
  IF p_vat_rate IS NULL OR p_vat_rate<0 OR p_vat_rate>100 THEN
    RAISE EXCEPTION 'EXP003: invalid VAT rate';
  END IF;
  p_vat_rate := round(p_vat_rate,2);

  -- INTO STRICT with deliberate error handling (review item 2). The queried
  -- key is unique by uq_expense_category_mapping (040: UNIQUE (tenant_id,
  -- expense_type)), so NO_DATA_FOUND (P0002) is the only realistic outcome
  -- to handle; a TOO_MANY_ROWS would mean the constraint itself is broken
  -- and propagates loudly — never a silent arbitrary pick.
  BEGIN
    SELECT coa_account_code, vat_recoverability
      INTO STRICT v_mapping
    FROM public.expense_category_mappings
    WHERE tenant_id = p_tenant_id
      AND expense_type = v_expense.expense_type;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'EXP005: no CoA mapping for category';
  END;
  v_recover := COALESCE(p_vat_recoverability, v_mapping.vat_recoverability, 'recoverable');

  -- ── Claim the expense (the race arbiter) ────────────────────────────────
  -- The conditional predicate IS the mutex: under READ COMMITTED a second
  -- concurrent UPDATE blocks on this row, re-evaluates is_approved after the
  -- first commits, and matches 0 rows → EXP002. Exactly one caller wins.
  UPDATE public.expenses SET
    is_approved         = TRUE,
    approved_by         = p_actor,
    approved_at         = now(),
    vat_rate            = p_vat_rate,
    vat_amount          = round((amount * p_vat_rate) / 100, 2),
    vat_recoverability  = v_recover,
    coa_account_code    = v_mapping.coa_account_code,
    updated_by          = p_actor
  WHERE id = p_expense_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND is_approved = FALSE;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    IF EXISTS(SELECT 1 FROM public.expenses WHERE id=p_expense_id AND tenant_id=p_tenant_id
      AND deleted_at IS NULL AND is_approved) THEN
      RAISE EXCEPTION 'EXP002: expense already approved';
    END IF;
    RAISE EXCEPTION 'EXP001: expense not found';
  END IF;

  -- ── Amounts (Postgres NUMERIC only — never float) ──────────────────────
  v_amount := v_expense.amount;
  v_vat    := round((v_amount * p_vat_rate) / 100, 2);
  v_total  := v_amount + v_vat;
  v_ref    := COALESCE(v_expense.expense_code,
                       'EXP-' || UPPER(LEFT(v_expense.id::TEXT, 8)));

  -- ── Payable: ON CONFLICT DO NOTHING, then assert exactly one live row ──
  INSERT INTO public.payables (
    tenant_id, supplier_id, invoice_ref, invoice_date, due_date,
    amount, vat_amount, total_amount, paid_amount, status,
    source_entity_type, source_entity_id, notes, created_by
  ) VALUES (
    p_tenant_id, NULL, v_ref, v_expense.expense_date, v_expense.expense_date,
    v_amount, v_vat, v_total, 0, 'open',
    'expense', v_expense.id,
    COALESCE(v_expense.category, v_expense.expense_type)
      || COALESCE(' — ' || v_expense.vendor, ''),
    p_actor
  )
  ON CONFLICT (tenant_id, source_entity_id)
    WHERE source_entity_type = 'expense'
      AND source_entity_id IS NOT NULL
      AND deleted_at IS NULL
  DO NOTHING;

  SELECT COUNT(*) INTO v_live_ap
  FROM public.payables
  WHERE tenant_id = p_tenant_id
    AND source_entity_type = 'expense'
    AND source_entity_id = v_expense.id
    AND deleted_at IS NULL;

  IF v_live_ap <> 1 THEN
    RAISE EXCEPTION 'FX06: expected exactly 1 live payable for expense %, found %', v_expense.id, v_live_ap;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.payables WHERE tenant_id=p_tenant_id
    AND source_entity_type='expense' AND source_entity_id=v_expense.id AND deleted_at IS NULL
    AND amount=v_amount AND vat_amount=v_vat AND total_amount=v_total) THEN
    RAISE EXCEPTION 'EXP_AP_REVIEW: existing payable differs from expense approval';
  END IF;

  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(p_tenant_id,p_actor,'expenses',CASE WHEN p_surface='approvals_inbox' THEN 'expense' ELSE 'expenses' END,v_expense.id,'expense_approved',
    jsonb_build_object('expense_ref',v_ref,'amount',v_amount,'vat_rate',p_vat_rate,
      'vat_amount',v_vat,'total',v_total,'coa_account_code',v_mapping.coa_account_code,
      'vat_recoverability',v_recover,'from','pending','to','approved','reason',nullif(btrim(p_reason),''),'surface',p_surface));

  -- ── ExpenseApprovedEvent (dispatcher posts Dr Expense / Dr VAT In / Cr AP)
  v_event_id := gen_random_uuid();
  INSERT INTO public.financial_events (
    tenant_id, event_id, idempotency_key, source_type, source_id,
    event_type, event_date, payload
  ) VALUES (
    p_tenant_id,
    v_event_id,
    'expense:' || v_expense.id::TEXT || ':approved',
    'expense',
    v_expense.id,
    'ExpenseApprovedEvent',
    v_expense.expense_date,
    jsonb_build_object(
      'expense_id',        v_expense.id,
      'expense_code',      v_expense.expense_code,
      'expense_type',      v_expense.expense_type,
      'category',          v_expense.category,
      'amount',            v_amount,
      'vat_amount',        v_vat,
      'vat_rate',          p_vat_rate,
      'vat_recoverability', v_recover,
      'coa_account_code',  v_mapping.coa_account_code,
      'driver_id',         v_expense.driver_id,
      'vehicle_id',        v_expense.vehicle_id
    )
  )
  -- An event left behind by a manually reset legacy expense requires review.
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_event_rows=ROW_COUNT;
  IF v_event_rows<>1 THEN
    RAISE EXCEPTION 'EXP_EVENT_REVIEW: approval event already exists; review the original expense';
  END IF;

  RETURN jsonb_build_object(
    'expense_id', v_expense.id,
    'expense_ref', v_ref,
    'amount', v_amount,
    'vat_amount', v_vat,
    'total', v_total,
    'coa_account_code', v_mapping.coa_account_code,
    'vat_recoverability', v_recover,
    'event_id', v_event_id
  );
END;
$$;

-- Preserve the existing five-argument trusted-server contract.
CREATE OR REPLACE FUNCTION public.approve_expense_atomic(
  p_tenant_id uuid,p_expense_id uuid,p_vat_rate numeric,p_vat_recoverability text,p_actor uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.approve_expense_with_context_atomic(p_tenant_id,p_expense_id,p_vat_rate,p_vat_recoverability,p_actor,NULL,'expenses');
$$;

-- Preserve pending historical edits, but prevent direct caller changes to
-- approval evidence or approved financial records. Trusted service workflows
-- remain responsible for their permission checks and controlled mutations.
CREATE OR REPLACE FUNCTION public.protect_expense_request()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF current_user IN('authenticated','anon') THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;RETURN NEW;
  ELSIF TG_OP='UPDATE' THEN
    IF current_user IN('authenticated','anon') AND(OLD.request_id IS NOT NULL OR NEW.request_id IS NOT NULL
      OR NEW.request_payload IS NOT NULL OR OLD.is_approved OR NEW.is_approved
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount OR NEW.coa_account_code IS DISTINCT FROM OLD.coa_account_code
      OR NEW.vat_recoverability IS DISTINCT FROM OLD.vat_recoverability) THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;
    IF OLD.request_id IS NOT NULL AND(NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.request_payload IS DISTINCT FROM OLD.request_payload OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'EXP_IDENTITY: expense request identity is immutable';
    END IF;RETURN NEW;
  ELSE
    IF current_user IN('authenticated','anon') AND(OLD.request_id IS NOT NULL OR OLD.is_approved) THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;RETURN OLD;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.approve_expense_atomic(uuid,uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_expense_atomic(uuid,uuid,numeric,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.approve_expense_with_context_atomic(uuid,uuid,numeric,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_expense_with_context_atomic(uuid,uuid,numeric,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.protect_expense_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protect_expense_request() TO service_role;
NOTIFY pgrst,'reload schema';
