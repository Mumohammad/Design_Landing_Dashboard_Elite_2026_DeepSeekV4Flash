-- 033_coa_phase2.sql
-- Phase 2 — Chart of Accounts management.
--
-- 1. post_journal_entry: new signature with p_entry_type (currently
--    'manual' | 'opening'). Opening balances are posted as an 'opening'
--    journal entry through the SAME journal engine (double-entry, appears
--    in the trial balance automatically). Old 6-arg signature is dropped to
--    avoid PostgREST named-arg ambiguity.
--
-- 2. chart_of_accounts: is_contra flag + validation trigger:
--      COA001  account code must be 3-6 digits
--      COA002  parent must exist in the same tenant and not be itself /
--              create a cycle / have a different account_type
--      COA003  type/normal-balance inconsistency (contra accounts opt out)
--      COA004  code/type/normal_balance immutable once posted lines exist
--      COA005  cannot deactivate an account with posted lines or active children
--
-- 3. ensure_default_chart_of_accounts(tenant_id): idempotent per-tenant
--    default CoA seed (per-tenant defaults requirement).

-- =====================================================================
-- 1. Rebuild post_journal_entry with p_entry_type
-- =====================================================================
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID);

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_tenant_id       UUID,
  p_entry_date      DATE,
  p_description_ar  TEXT,
  p_lines           JSONB,
  p_description_en  TEXT DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL,
  p_entry_type      TEXT DEFAULT 'manual'
)
RETURNS TABLE (out_entry_id UUID, out_entry_ref TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period_id      UUID;
  v_period_status  accounting_period_status;
  v_period_year    SMALLINT := EXTRACT(YEAR FROM p_entry_date)::SMALLINT;
  v_period_month   SMALLINT := EXTRACT(MONTH FROM p_entry_date)::SMALLINT;
  v_line           JSONB;
  v_account_id     UUID;
  v_account_ok     BOOLEAN;
  v_debit          NUMERIC(12,2);
  v_credit         NUMERIC(12,2);
  v_total_debit    NUMERIC(12,2) := 0;
  v_total_credit   NUMERIC(12,2) := 0;
  v_entry_id       UUID;
  v_entry_ref      TEXT;
  v_entry_type     journal_entry_type;
BEGIN
  -- Validation
  IF p_entry_date IS NULL OR p_description_ar IS NULL OR p_description_ar = '' THEN
    RAISE EXCEPTION 'JRN005: entry date and an Arabic description are required';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'JRN006: a journal entry needs at least two lines';
  END IF;
  IF p_entry_type IS NULL OR p_entry_type NOT IN ('manual', 'opening') THEN
    RAISE EXCEPTION 'JRN009: unsupported journal entry type %', COALESCE(p_entry_type, 'null');
  END IF;
  v_entry_type := p_entry_type::journal_entry_type;

  -- Resolve the open accounting period for the entry date (create if missing,
  -- atomically: ON CONFLICT handles two concurrent first-postings into the
  -- same month — the UNIQUE(tenant_id, period_year, period_month) constraint
  -- from migration 027 is the arbiter).
  SELECT id, status INTO v_period_id, v_period_status
  FROM accounting_periods
  WHERE tenant_id = p_tenant_id
    AND period_year = v_period_year
    AND period_month = v_period_month
  LIMIT 1;

  IF v_period_id IS NULL THEN
    INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
    VALUES (p_tenant_id, v_period_year, v_period_month, 'open')
    ON CONFLICT (tenant_id, period_year, period_month) DO NOTHING
    RETURNING id INTO v_period_id;

    IF v_period_id IS NULL THEN
      -- A concurrent transaction created the period between our SELECT and
      -- INSERT; re-read it so the closed-period check still applies.
      SELECT id, status INTO v_period_id, v_period_status
      FROM accounting_periods
      WHERE tenant_id = p_tenant_id
        AND period_year = v_period_year
        AND period_month = v_period_month;
    END IF;
  END IF;

  -- Postings into a period that is closing or closed are rejected (defense-
  -- in-depth; the app layer performs the period-close flow).
  IF v_period_status IN ('closing', 'closed') THEN
    RAISE EXCEPTION 'ACC001: the accounting period for this date is closed';
  END IF;

  -- Validate + sum lines (exact NUMERIC, no floating point)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_account_id := (v_line->>'account_id')::UUID;
    v_debit      := COALESCE((v_line->>'debit')::NUMERIC(12,2), 0);
    v_credit     := COALESCE((v_line->>'credit')::NUMERIC(12,2), 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'JRN006: every line needs an account';
    END IF;
    -- Account must belong to the same tenant (defense-in-depth)
    SELECT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE id = v_account_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
    ) INTO v_account_ok;
    IF NOT v_account_ok THEN
      RAISE EXCEPTION 'JRN008: account % does not belong to this tenant', v_account_id;
    END IF;

    IF (v_debit > 0 AND v_credit > 0) OR (v_debit = 0 AND v_credit = 0) THEN
      RAISE EXCEPTION 'JRN007: each line must be single-sided (debit XOR credit)';
    END IF;
    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'JRN007: line amounts cannot be negative';
    END IF;

    v_total_debit  := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_total_debit <= 0 THEN
    RAISE EXCEPTION 'JRN007: entry amounts must be greater than zero';
  END IF;
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION
      'JRN004: posted journal entry does not balance (debits % <> credits %)',
      v_total_debit, v_total_credit;
  END IF;

  -- Insert header + lines atomically (single transaction)
  INSERT INTO journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, posted_at, posted_by,
     created_by)
  VALUES
    (p_tenant_id, p_entry_date, v_period_id, v_entry_type, 'posted',
     p_description_ar, p_description_en, 'accounting', 'manual_entry',
     now(), p_created_by, p_created_by)
  RETURNING id, entry_ref INTO v_entry_id, v_entry_ref;

  INSERT INTO journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  SELECT
    p_tenant_id,
    v_entry_id,
    (src_line->>'account_id')::UUID,
    NULLIF(src_line->>'description', ''),
    COALESCE((src_line->>'debit')::NUMERIC(12,2), 0),
    COALESCE((src_line->>'credit')::NUMERIC(12,2), 0)
  FROM jsonb_array_elements(p_lines) AS src_line;

  out_entry_id  := v_entry_id;
  out_entry_ref := v_entry_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT) TO service_role;

-- =====================================================================
-- 2. Chart of accounts validation
-- =====================================================================
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_contra BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION validate_chart_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_tenant  UUID;
  v_parent_type    account_type;
  v_parent_deleted TIMESTAMPTZ;
  v_cycle          BOOLEAN;
  v_posted_lines   BIGINT;
  v_child_count    BIGINT;
BEGIN
  -- COA001 — code format
  IF NEW.account_code !~ '^[0-9]{3,6}$' THEN
    RAISE EXCEPTION 'COA001: account code must be 3-6 digits';
  END IF;

  -- COA002 — parent validation
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'COA002: an account cannot be its own parent';
    END IF;
    SELECT tenant_id, account_type, deleted_at
      INTO v_parent_tenant, v_parent_type, v_parent_deleted
    FROM chart_of_accounts WHERE id = NEW.parent_id;
    IF v_parent_tenant IS NULL OR v_parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'COA002: parent account must belong to the same tenant';
    END IF;
    IF v_parent_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'COA002: parent account is deleted';
    END IF;
    IF v_parent_type IS DISTINCT FROM NEW.account_type THEN
      RAISE EXCEPTION 'COA002: a child account must have the same type as its parent';
    END IF;
    -- Cycle detection (walk the new parent chain, depth-capped)
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 1 AS depth FROM chart_of_accounts WHERE id = NEW.parent_id
      UNION ALL
      SELECT c.id, p.parent_id, c.depth + 1
      FROM chain c
      JOIN chart_of_accounts p ON p.id = c.parent_id
      WHERE c.depth < 50
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE id = NEW.id) INTO v_cycle;
    IF v_cycle THEN
      RAISE EXCEPTION 'COA002: parent chain would create a cycle';
    END IF;
  END IF;

  -- COA003 — type/normal-balance consistency (contra accounts opt out)
  IF NOT NEW.is_contra THEN
    IF NEW.account_type IN ('asset', 'expense') AND NEW.normal_balance <> 'debit' THEN
      RAISE EXCEPTION 'COA003: % accounts normally carry a debit balance', NEW.account_type;
    END IF;
    IF NEW.account_type IN ('liability', 'equity', 'income') AND NEW.normal_balance <> 'credit' THEN
      RAISE EXCEPTION 'COA003: % accounts normally carry a credit balance', NEW.account_type;
    END IF;
  END IF;

  -- UPDATE-only guards
  IF TG_OP = 'UPDATE' THEN
    -- COA004 — structural fields immutable once the account carries posted lines
    IF (NEW.account_code IS DISTINCT FROM OLD.account_code
        OR NEW.account_type IS DISTINCT FROM OLD.account_type
        OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance) THEN
      SELECT COUNT(*) INTO v_posted_lines
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.account_id = NEW.id AND je.status = 'posted';
      IF v_posted_lines > 0 THEN
        RAISE EXCEPTION 'COA004: code, type and normal balance are immutable for an account with posted journal lines';
      END IF;
    END IF;
    -- COA005 — deactivation guard (is_active flip or soft-delete). Both hide
    -- the account from RLS views while its posted lines stay in the journal,
    -- which would silently drop rows from the trial balance.
    IF (OLD.is_active AND NOT NEW.is_active) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
      SELECT COUNT(*) INTO v_posted_lines
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.account_id = NEW.id AND je.status = 'posted';
      SELECT COUNT(*) INTO v_child_count
      FROM chart_of_accounts
      WHERE parent_id = NEW.id AND is_active AND deleted_at IS NULL AND id <> NEW.id;
      IF v_posted_lines > 0 OR v_child_count > 0 THEN
        RAISE EXCEPTION 'COA005: account cannot be deactivated or deleted while it has posted journal lines or active children';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_validate ON chart_of_accounts;
CREATE TRIGGER trg_coa_validate
  BEFORE INSERT OR UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION validate_chart_account();

-- The seeded contra-asset (accumulated depreciation) opts out of COA003.
UPDATE chart_of_accounts SET is_contra = true
WHERE account_code = '1610'
  AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- =====================================================================
-- 3. Per-tenant default CoA seed (idempotent)
-- =====================================================================
CREATE OR REPLACE FUNCTION ensure_default_chart_of_accounts(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant id is required';
  END IF;

  INSERT INTO chart_of_accounts
    (tenant_id, account_code, name_ar, name_en, account_type, normal_balance, is_contra)
  VALUES
    (p_tenant_id, '1000', 'النقد بالصندوق', 'Cash on Hand', 'asset', 'debit', false),
    (p_tenant_id, '1100', 'الحساب البنكي', 'Bank Account', 'asset', 'debit', false),
    (p_tenant_id, '1200', 'ذمم مدينة — عملاء', 'Accounts Receivable — Customers', 'asset', 'debit', false),
    (p_tenant_id, '1300', 'ذمم مدينة — منصات التوصيل', 'Accounts Receivable — Platforms', 'asset', 'debit', false),
    (p_tenant_id, '1400', 'ذمم مدينة — السائقون (COD)', 'Receivable — Drivers (COD)', 'asset', 'debit', false),
    (p_tenant_id, '1500', 'مصروفات مدفوعة مقدماً', 'Prepaid Expenses', 'asset', 'debit', false),
    (p_tenant_id, '1600', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'debit', false),
    (p_tenant_id, '1610', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', 'credit', true),
    (p_tenant_id, '2000', 'ذمم دائنة — موردون', 'Accounts Payable — Suppliers', 'liability', 'credit', false),
    (p_tenant_id, '2100', 'رواتب مستحقة', 'Wages Payable', 'liability', 'credit', false),
    (p_tenant_id, '2200', 'مستحقات التأمينات (GOSI)', 'GOSI Payable', 'liability', 'credit', false),
    (p_tenant_id, '2300', 'سلف مستلمة', 'Advances Received', 'liability', 'credit', false),
    (p_tenant_id, '2500', 'ضريبة القيمة المضافة المستحقة (مخرجات)', 'VAT Output Payable', 'liability', 'credit', false),
    (p_tenant_id, '2600', 'ضريبة القيمة المضافة المدينة (مدخلات)', 'VAT Input Receivable', 'asset', 'debit', false),
    (p_tenant_id, '3000', 'رأس المال', 'Capital', 'equity', 'credit', false),
    (p_tenant_id, '3100', 'الأرباح المحتجزة', 'Retained Earnings', 'equity', 'credit', false),
    (p_tenant_id, '4000', 'إيرادات رسوم التوصيل', 'Revenue — Delivery Fees', 'income', 'credit', false),
    (p_tenant_id, '4100', 'إيرادات عمولات المنصات', 'Revenue — Platform Commissions', 'income', 'credit', false),
    (p_tenant_id, '4200', 'إيرادات رسوم التحصيل عند الاستلام', 'Revenue — COD Handling Fees', 'income', 'credit', false),
    (p_tenant_id, '5000', 'مصروفات الوقود', 'Fuel Expenses', 'expense', 'debit', false),
    (p_tenant_id, '5100', 'الصيانة والإصلاحات', 'Maintenance & Repairs', 'expense', 'debit', false),
    (p_tenant_id, '5200', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'debit', false),
    (p_tenant_id, '5300', 'اشتراكات التأمينات (GOSI)', 'GOSI Contributions', 'expense', 'debit', false),
    (p_tenant_id, '5400', 'الإيجار', 'Rent', 'expense', 'debit', false),
    (p_tenant_id, '5500', 'التأمين', 'Insurance', 'expense', 'debit', false),
    (p_tenant_id, '5600', 'الرسوم البنكية', 'Bank Charges', 'expense', 'debit', false),
    (p_tenant_id, '5700', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', 'debit', false),
    (p_tenant_id, '5800', 'مصروفات متنوعة', 'Miscellaneous Expenses', 'expense', 'debit', false)
  ON CONFLICT (tenant_id, account_code) WHERE deleted_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Ensure the current open accounting period exists for the tenant.
  INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
  SELECT p_tenant_id,
         EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
         EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
         'open'
  WHERE NOT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE tenant_id = p_tenant_id
      AND period_year = EXTRACT(YEAR FROM CURRENT_DATE)::smallint
      AND period_month = EXTRACT(MONTH FROM CURRENT_DATE)::smallint
  );

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION ensure_default_chart_of_accounts(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION ensure_default_chart_of_accounts(UUID) TO service_role;
