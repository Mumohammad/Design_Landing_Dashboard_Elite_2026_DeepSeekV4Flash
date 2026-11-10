-- 063: Expense approval — payable uniqueness + atomic approval RPC (FX-06)
--
-- Audit fix J5 (FX-06): approveExpense() had a check-then-insert race. Two
-- concurrent approvals of the same expense could both pass the
-- `is_approved = false` read and each insert a payable row (double AP).
-- Button disabling is not a fix; the database must arbitrate.
--
--   1. UNIQUE partial index on payables(tenant_id, source_entity_id) for
--      expense-sourced, live rows. The DB now enforces one payable per
--      expense regardless of which code path inserts it.
--   2. approve_expense_atomic(p_tenant_id, p_expense_id, p_vat_rate,
--      p_vat_recoverability, p_actor) — a single SECURITY DEFINER RPC that
--      validates its inputs (EXP003: finite VAT rate 0–100 and permitted
--      recoverability values — server-side, not TS-only), claims the expense
--      with a conditional UPDATE (0 rows ⇒ already approved), inserts the
--      payable with ON CONFLICT DO NOTHING and asserts exactly one live row,
--      and inserts the ExpenseApprovedEvent idempotently
--      (ON CONFLICT (idempotency_key) DO NOTHING against the real 038
--      column-UNIQUE). One transaction, atomic — the TS action only
--      orchestrates.
--
-- Mirrors 040's conventions: service-role-only execution boundary, pinned
-- search_path (rule from 061), EXP/DSP error codes, approve ExpenseApproved
-- only with approver + timestamp (EXP004 trigger contract preserved).
--
-- Constraint provenance (review round 2):
--   financial_events.idempotency_key  TEXT NOT NULL UNIQUE  (038, line 55)
--   expense_category_mappings         UNIQUE (tenant_id, expense_type)
--                                     = uq_expense_category_mapping (040, line 72)

-- ═══ 1. One live payable per expense ═════════════════════════════════════
DO $$
DECLARE
  v_dupes INT;
BEGIN
  -- Guard for existing environments: fail loudly if data already violates
  -- the invariant instead of silently dropping duplicate rows.
  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT tenant_id, source_entity_id
    FROM payables
    WHERE source_entity_type = 'expense'
      AND source_entity_id IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY tenant_id, source_entity_id
    HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'FX06: % expense(s) already have duplicate payables; reconcile before applying FX-06', v_dupes;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_expense_source
  ON payables(tenant_id, source_entity_id)
  WHERE source_entity_type = 'expense'
    AND source_entity_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON INDEX uq_payables_expense_source IS
  'FX-06: at most one live payable per expense per tenant — DB-level arbiter for the approveExpense check-then-insert race';

-- ═══ 2. Atomic approval RPC ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION approve_expense_atomic(
  p_tenant_id          UUID,
  p_expense_id         UUID,
  p_vat_rate           NUMERIC,
  p_vat_recoverability TEXT,
  p_actor              UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  -- ── RPC-owned validation (review item 3) ──────────────────────────────
  -- SECURITY DEFINER: must not depend exclusively on TypeScript validation.
  -- Matches the EXP003 contract in src/lib/expenses/actions.ts.
  -- Parity note: the TS EXP003 contract is Number.isFinite && 0..100 with NO
  -- 2-decimal restriction — a rate like 15.555 must pass here exactly as it
  -- passes in actions.ts. NaN/+Infinity fail `> 100` and -Infinity fails
  -- `< 0` under Postgres numeric ordering, matching !Number.isFinite.
  IF p_vat_rate IS NULL
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
         description, vendor, driver_id, vehicle_id, is_approved
    INTO v_expense
  FROM expenses
  WHERE id = p_expense_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXP001: expense not found';
  END IF;

  -- INTO STRICT with deliberate error handling (review item 2). The queried
  -- key is unique by uq_expense_category_mapping (040: UNIQUE (tenant_id,
  -- expense_type)), so NO_DATA_FOUND (P0002) is the only realistic outcome
  -- to handle; a TOO_MANY_ROWS would mean the constraint itself is broken
  -- and propagates loudly — never a silent arbitrary pick.
  BEGIN
    SELECT coa_account_code, vat_recoverability
      INTO STRICT v_mapping
    FROM expense_category_mappings
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
  UPDATE expenses SET
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
    RAISE EXCEPTION 'EXP002: expense already approved';
  END IF;

  -- ── Amounts (Postgres NUMERIC only — never float) ──────────────────────
  v_amount := v_expense.amount;
  v_vat    := round((v_amount * p_vat_rate) / 100, 2);
  v_total  := v_amount + v_vat;
  v_ref    := COALESCE(v_expense.expense_code,
                       'EXP-' || UPPER(LEFT(v_expense.id::TEXT, 8)));

  -- ── Payable: ON CONFLICT DO NOTHING, then assert exactly one live row ──
  INSERT INTO payables (
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
  FROM payables
  WHERE tenant_id = p_tenant_id
    AND source_entity_type = 'expense'
    AND source_entity_id = v_expense.id
    AND deleted_at IS NULL;

  IF v_live_ap <> 1 THEN
    RAISE EXCEPTION 'FX06: expected exactly 1 live payable for expense %, found %', v_expense.id, v_live_ap;
  END IF;

  -- ── ExpenseApprovedEvent (dispatcher posts Dr Expense / Dr VAT In / Cr AP)
  v_event_id := gen_random_uuid();
  INSERT INTO financial_events (
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
  -- Idempotent replay: the actual DB uniqueness guarantee is the column
  -- constraint financial_events.idempotency_key UNIQUE (038), not an
  -- invented target. A replayed approval re-raises EXP002 on the claim
  -- UPDATE before reaching this statement; this arm covers an event row
  -- that already exists without an approved expense (crash-after-commit
  -- leftovers / replayed event with the expense later un-approved).
  ON CONFLICT (idempotency_key) DO NOTHING;

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

-- ═══ 3. Execution boundary: service-role only (040 convention) ═══════════
REVOKE ALL ON FUNCTION approve_expense_atomic(UUID, UUID, NUMERIC, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION approve_expense_atomic(UUID, UUID, NUMERIC, TEXT, UUID)
  TO service_role;

COMMENT ON FUNCTION approve_expense_atomic(UUID, UUID, NUMERIC, TEXT, UUID) IS
  'FX-06: atomic expense approval — claims the expense via conditional UPDATE, inserts the payable with ON CONFLICT DO NOTHING, asserts exactly one live payable, enqueues the ExpenseApprovedEvent. Service-role only.';
