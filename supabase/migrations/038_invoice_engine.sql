-- =====================================================================
-- 038 — Invoice Engine (Financial Phase 5)
-- =====================================================================
-- Implements docs/financial/INVOICE-ARCHITECTURE.md + DATABASE-DESIGN.md 3.x:
--
--   financial_events   idempotency ledger (EVENT-MODEL.md) — Invoice Engine
--                      EMITS events here; Accounting/VAT engines consume them
--                      in Phase 9. Never double-posted (unique idempotency_key).
--   invoices           header (draft → issued → finalized → paid/overdue/
--                      cancelled/credited). Finalized rows are immutable
--                      (corrections go through credit/debit notes only).
--   invoice_lines      line items; immutable once the parent invoice is
--                      finalized (protect_invoice_lines trigger).
--   credit_notes       reversal documents — finalized on creation, immutable,
--                      carry a JSONB snapshot of the reversed lines.
--   debit_notes        additional-charge documents — same shape/immutability.
--
-- Numbering: per-table Postgres sequences with INV-/PINV-/CN-/DN- + year
-- prefixes (never COUNT(*)+1). Unique partial index (tenant_id, number)
-- WHERE deleted_at IS NULL on invoices.
--
-- Canonical math (single source of truth — Phase 5):
--   line_amount  = round2(quantity × unit_price) − discount      (line net)
--   line_vat     = round2(line_amount × vat_rate / 100)          (per line)
--   subtotal     = Σ line_amount   ·   vat_amount = Σ line_vat
--   total        = round2(subtotal + vat_amount)
--   invoices.discount is informational only (sum of line discounts).
-- Money is NUMERIC(12,2); the server action computes in rounded 2dp
-- integer-minor steps; the DB validates totals with a CHECK.
-- =====================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────
CREATE TYPE invoice_type AS ENUM ('sales', 'purchase');
CREATE TYPE invoice_status AS ENUM (
  'draft', 'issued', 'finalized', 'paid', 'partially_paid', 'overdue',
  'cancelled', 'credited'
);
CREATE TYPE financial_event_status AS ENUM ('pending', 'processed', 'failed', 'skipped_duplicate');

-- ── Numbering sequences ───────────────────────────────────────────────────
-- Start above the seeded demo numbers (INV-2026-000001, CN/DN-2026-…) so
-- the first auto-numbered document can never collide with the seed (mirrors
-- the parties pattern where finance_doc_ref_seq starts at 1001).
CREATE SEQUENCE invoice_number_seq START 1000;
CREATE SEQUENCE credit_note_number_seq START 1000;
CREATE SEQUENCE debit_note_number_seq START 1000;

-- =====================================================================
-- 1. financial_events — idempotency ledger (no deleted_at: append-only)
-- =====================================================================
CREATE TABLE financial_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  event_id          UUID NOT NULL UNIQUE,
  idempotency_key   TEXT NOT NULL UNIQUE,
  source_type       TEXT NOT NULL,            -- 'invoice' | 'credit_note' | 'debit_note' | ...
  source_id         UUID NOT NULL,
  event_type        TEXT NOT NULL,            -- 'InvoiceFinalizedEvent' | ...
  event_date        DATE NOT NULL,
  payload           JSONB NOT NULL,
  processing_status financial_event_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  error_message     TEXT
);
CREATE INDEX idx_financial_events_tenant_status ON financial_events(tenant_id, processing_status, created_at);
CREATE INDEX idx_financial_events_source ON financial_events(source_type, source_id);

-- =====================================================================
-- 2. invoices
-- =====================================================================
CREATE TABLE invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  invoice_number     TEXT NOT NULL,
  invoice_type       invoice_type NOT NULL DEFAULT 'sales',
  customer_id        UUID REFERENCES customers(id),
  supplier_id        UUID REFERENCES suppliers(id),
  issue_date         DATE NOT NULL,
  due_date           DATE NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'SAR',
  status             invoice_status NOT NULL DEFAULT 'draft',
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount           NUMERIC(12,2) NOT NULL DEFAULT 0,   -- sum of line discounts (informational)
  vat_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 15,   -- default % applied to new lines
  notes              TEXT,
  cancel_reason      TEXT,
  source_entity_type TEXT,
  source_entity_id   UUID,
  finalized_at       TIMESTAMPTZ,
  finalized_by       UUID REFERENCES auth.users(id),
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT chk_invoices_amounts CHECK (
    subtotal >= 0 AND discount >= 0 AND vat_amount >= 0 AND total >= 0
    AND total = subtotal + vat_amount
    AND vat_rate >= 0 AND vat_rate <= 100
  ),
  CONSTRAINT chk_invoices_dates CHECK (due_date >= issue_date)
);

CREATE UNIQUE INDEX idx_invoices_tenant_number ON invoices(tenant_id, invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_tenant_date   ON invoices(tenant_id, issue_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_tenant_status ON invoices(tenant_id, status) WHERE deleted_at IS NULL;

-- =====================================================================
-- 3. invoice_lines (no deleted_at — child rows, cascade with header)
-- =====================================================================
CREATE TABLE invoice_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  invoice_id         UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no            INT  NOT NULL,
  description        TEXT NOT NULL,
  quantity           NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,   -- net of line discount
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 15,
  vat_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_entity_type TEXT,
  source_entity_id   UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  CONSTRAINT chk_invoice_lines_amounts CHECK (
    quantity > 0 AND unit_price >= 0 AND discount >= 0
    AND amount >= 0 AND vat_amount >= 0
    AND vat_rate >= 0 AND vat_rate <= 100
  )
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE UNIQUE INDEX idx_invoice_lines_no ON invoice_lines(invoice_id, line_no);

-- =====================================================================
-- 4. credit_notes / debit_notes (finalized on creation, immutable)
-- =====================================================================
CREATE TABLE credit_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  credit_note_number  TEXT NOT NULL,
  reference_invoice_id UUID NOT NULL REFERENCES invoices(id),
  customer_id         UUID REFERENCES customers(id),
  issue_date          DATE NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'SAR',
  status              invoice_status NOT NULL DEFAULT 'finalized',
  subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total               NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate            NUMERIC(5,2) NOT NULL DEFAULT 15,
  reason              TEXT NOT NULL,
  lines               JSONB NOT NULL DEFAULT '[]',   -- snapshot of reversed lines
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  CONSTRAINT chk_credit_notes_amounts CHECK (
    subtotal >= 0 AND discount >= 0 AND vat_amount >= 0 AND total >= 0
    AND total = subtotal + vat_amount
  ),
  CONSTRAINT chk_credit_notes_status CHECK (status IN ('finalized', 'cancelled'))
);
CREATE UNIQUE INDEX idx_credit_notes_tenant_number ON credit_notes(tenant_id, credit_note_number);
CREATE INDEX idx_credit_notes_reference ON credit_notes(reference_invoice_id);

CREATE TABLE debit_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  debit_note_number  TEXT NOT NULL,
  reference_invoice_id UUID NOT NULL REFERENCES invoices(id),
  customer_id        UUID REFERENCES customers(id),
  issue_date         DATE NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'SAR',
  status             invoice_status NOT NULL DEFAULT 'finalized',
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 15,
  reason             TEXT NOT NULL,
  lines              JSONB NOT NULL DEFAULT '[]',   -- snapshot of the charged lines
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  CONSTRAINT chk_debit_notes_amounts CHECK (
    subtotal >= 0 AND discount >= 0 AND vat_amount >= 0 AND total >= 0
    AND total = subtotal + vat_amount
  ),
  CONSTRAINT chk_debit_notes_status CHECK (status IN ('finalized', 'cancelled'))
);
CREATE UNIQUE INDEX idx_debit_notes_tenant_number ON debit_notes(tenant_id, debit_note_number);
CREATE INDEX idx_debit_notes_reference ON debit_notes(reference_invoice_id);

-- =====================================================================
-- 5. Triggers
-- =====================================================================
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5.1 Invoice number assignment (INV-YYYY-000001 / PINV-…, CN-…, DN-…)
CREATE OR REPLACE FUNCTION invoice_number_assign() RETURNS trigger AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  IF NEW.invoice_number IS NULL THEN
    v_prefix := CASE WHEN NEW.invoice_type = 'purchase' THEN 'PINV' ELSE 'INV' END;
    NEW.invoice_number := v_prefix || '-' || to_char(NEW.issue_date, 'YYYY')
                          || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION credit_note_number_assign() RETURNS trigger AS $$
BEGIN
  IF NEW.credit_note_number IS NULL THEN
    NEW.credit_note_number := 'CN-' || to_char(NEW.issue_date, 'YYYY')
                              || '-' || lpad(nextval('credit_note_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION debit_note_number_assign() RETURNS trigger AS $$
BEGIN
  IF NEW.debit_note_number IS NULL THEN
    NEW.debit_note_number := 'DN-' || to_char(NEW.issue_date, 'YYYY')
                             || '-' || lpad(nextval('debit_note_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_number BEFORE INSERT OR UPDATE OF issue_date, invoice_type ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_number_assign();
CREATE TRIGGER trg_credit_notes_number BEFORE INSERT ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION credit_note_number_assign();
CREATE TRIGGER trg_debit_notes_number BEFORE INSERT ON debit_notes
  FOR EACH ROW EXECUTE FUNCTION debit_note_number_assign();

-- 5.2 validate_invoice — party rules, dates, NaN/negative money (INV0xx codes)
CREATE OR REPLACE FUNCTION validate_invoice() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_type = 'sales' THEN
    IF NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'INV005: customer is required for sales invoices';
    END IF;
    IF NEW.supplier_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV005: sales invoices cannot reference a supplier';
    END IF;
  ELSE
    IF NEW.supplier_id IS NULL THEN
      RAISE EXCEPTION 'INV005: supplier is required for purchase invoices';
    END IF;
    IF NEW.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV005: purchase invoices cannot reference a customer';
    END IF;
  END IF;

  IF NEW.due_date < NEW.issue_date THEN
    RAISE EXCEPTION 'INV008: due date cannot be before the issue date';
  END IF;

  -- NaN trap (x <> x): Postgres NUMERIC accepts NaN, which would bypass < 0.
  IF NEW.subtotal <> NEW.subtotal OR NEW.discount <> NEW.discount
     OR NEW.vat_amount <> NEW.vat_amount OR NEW.total <> NEW.total THEN
    RAISE EXCEPTION 'INV012: invoice amounts must be finite';
  END IF;
  IF NEW.subtotal < 0 OR NEW.discount < 0 OR NEW.vat_amount < 0 OR NEW.total < 0
     OR NEW.vat_rate < 0 OR NEW.vat_rate > 100 THEN
    RAISE EXCEPTION 'INV012: invalid invoice amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_validate BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION validate_invoice();

-- 5.3 protect_finalized_invoice — immutability of finalized/paid/credited/…
CREATE OR REPLACE FUNCTION protect_finalized_invoice() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('finalized', 'paid', 'partially_paid', 'overdue', 'credited', 'cancelled') THEN
    -- Financial columns immutable once finalized (corrections via notes).
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount IS DISTINCT FROM OLD.discount
       OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable; use a credit/debit note';
    END IF;

    -- Legal status transitions once finalized (payments engine in Phase 9 sets
    -- paid/partially_paid/overdue; cancellation only while unpaid — app-enforced;
    -- credited set when a credit note is issued). Everything else is blocked.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'finalized'
         AND NEW.status IN ('cancelled', 'credited', 'paid', 'partially_paid', 'overdue') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INV006: invoice state does not permit this change';
    END IF;

    -- No soft-delete of immutable documents.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_protect BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION protect_finalized_invoice();

-- 5.4 protect_invoice_lines — no line changes once the invoice is finalized
CREATE OR REPLACE FUNCTION protect_invoice_lines() RETURNS trigger AS $$
DECLARE
  v_status invoice_status;
BEGIN
  SELECT status INTO v_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IN ('finalized', 'paid', 'partially_paid', 'overdue', 'credited', 'cancelled') THEN
    RAISE EXCEPTION 'INV003: invoice lines are immutable once the invoice is finalized';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_lines_protect BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION protect_invoice_lines();

-- 5.5 Notes are immutable documents
CREATE OR REPLACE FUNCTION protect_credit_notes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'INV014: credit notes are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_debit_notes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'INV014: debit notes are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_protect BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION protect_credit_notes();
CREATE TRIGGER trg_debit_notes_protect BEFORE UPDATE ON debit_notes
  FOR EACH ROW EXECUTE FUNCTION protect_debit_notes();

-- =====================================================================
-- 6. RLS — 4-policy pattern (no DELETE; soft-delete via deleted_at)
-- =====================================================================
ALTER TABLE financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_notes       ENABLE ROW LEVEL SECURITY;

-- invoices: 4-policy pattern, inlined (the apply_accounting_rls() helper from
-- migration 027 does not exist on older remotes where 027 predates it).
CREATE POLICY "sel_invoices_tenant" ON invoices FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "ins_invoices_tenant" ON invoices FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_invoices_tenant" ON invoices FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL)
  WITH CHECK (tenant_id = get_my_tenant_id());

-- financial_events: append-only ledger — SELECT + INSERT only.
CREATE POLICY "sel_financial_events_tenant" ON financial_events FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_financial_events_tenant" ON financial_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

-- invoice_lines: no deleted_at (child rows) — explicit 3-policy set.
CREATE POLICY "sel_invoice_lines_tenant" ON invoice_lines FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_invoice_lines_tenant" ON invoice_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_invoice_lines_tenant" ON invoice_lines FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- credit/debit notes: SELECT + INSERT only (immutable documents).
CREATE POLICY "sel_credit_notes_tenant" ON credit_notes FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_credit_notes_tenant" ON credit_notes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "sel_debit_notes_tenant" ON debit_notes FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_debit_notes_tenant" ON debit_notes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

-- =====================================================================
-- 7. Demo seed (demo tenant only, idempotent) — the mock invoice from
--    INVOICE-ARCHITECTURE.md §10: 100,000 / 15,000 / 115,000.
-- =====================================================================
-- Insert as draft so protect_invoice_lines (blocks line changes once an
-- invoice is finalized) lets the lines in, then promote to finalized.
WITH inv AS (
  INSERT INTO invoices (
    tenant_id, invoice_number, invoice_type, customer_id, issue_date, due_date,
    status, subtotal, discount, vat_amount, total, vat_rate, notes
  )
  SELECT
    t.id,
    'INV-2026-000001',
    'sales',
    c.id,
    '2026-07-01',
    '2026-07-31',
    'draft',
    100000.00, 0.00, 15000.00, 115000.00, 15.00,
    'Demo sales invoice (mock data) — Delivery service + COD handling'
  FROM tenants t
  JOIN customers c
    ON c.tenant_id = t.id
   AND c.customer_code = 'CUST-0001'
   AND c.deleted_at IS NULL
  WHERE t.id = '00000000-0000-0000-0000-000000000001'
  ON CONFLICT (tenant_id, invoice_number) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, discount, amount, vat_rate, vat_amount)
SELECT
  inv.tenant_id,
  inv.id,
  ln.line_no,
  ln.description,
  ln.quantity,
  ln.unit_price,
  ln.discount,
  ln.amount,
  ln.vat_rate,
  ln.vat_amount
FROM inv
CROSS JOIN (VALUES
  (1, 'Delivery service (800 orders)',      800, 100.00, 0.00, 80000.00, 15.00, 12000.00),
  (2, 'COD handling fee (800 orders)',      800,  25.00, 0.00, 20000.00, 15.00,  3000.00)
) AS ln(line_no, description, quantity, unit_price, discount, amount, vat_rate, vat_amount);

-- Promote the seeded invoice to finalized (only drafts can reach it here).
UPDATE invoices
SET status = 'finalized', finalized_at = now()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND invoice_number = 'INV-2026-000001'
  AND deleted_at IS NULL
  AND status = 'draft';

-- Finalized-event row for the seeded invoice (idempotent; consumed in Phase 9).
INSERT INTO financial_events (
  tenant_id, event_id, idempotency_key, source_type, source_id, event_type,
  event_date, payload
)
SELECT
  i.tenant_id,
  gen_random_uuid(),
  'invoice:' || i.id::text || ':finalized',
  'invoice',
  i.id,
  'InvoiceFinalizedEvent',
  i.issue_date,
  jsonb_build_object(
    'invoice_number', i.invoice_number,
    'customer_id', i.customer_id,
    'subtotal', i.subtotal,
    'discount', i.discount,
    'vat_amount', i.vat_amount,
    'total', i.total,
    'currency', i.currency,
    'period_year', EXTRACT(YEAR FROM i.issue_date)::int,
    'period_month', EXTRACT(MONTH FROM i.issue_date)::int
  )
FROM invoices i
WHERE i.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND i.invoice_number = 'INV-2026-000001'
  AND i.deleted_at IS NULL
ON CONFLICT (idempotency_key) DO NOTHING;
