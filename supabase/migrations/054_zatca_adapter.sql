-- ============================================================================
-- 054 — ZATCA Adapter (IMPLEMENTATION-PLAN Phase 15, ZATCA-BOUNDARY.md §3)
--
-- Adds the transmission seam for the future ZATCA e-invoicing integration:
--   - `zatca_status` enum on invoices (not_transmitted → pending → reported /
--     cleared / rejected / failed)
--   - `invoices.zatca_status` + `invoices.zatca_uuid` (ZATCA response UUID)
--   - `zatca_transmissions` — the adapter's own ledger (per ZATCA-BOUNDARY §3
--     the adapter writes ONLY its own tables + status fields; it never
--     recomputes or mutates financial totals). One row per (tenant, invoice,
--     doc_type); UNIQUE makes replay idempotent — re-running the adapter for
--     an already-transmitted invoice is a no-op.
--
-- Sandbox-first: transmission goes through a pluggable app-layer transport
-- (sandbox mock by default; real ZATCA API becomes config-only later via
-- env + credentials). No ZATCA compliance is claimed — ZATCA-BOUNDARY §5.
--
-- RLS mirrors the hardened financial_events pattern (053): authenticated
-- users get SELECT-only for their own tenant; all writes flow through the
-- service-role admin client from the app actions.
-- ============================================================================

-- ── Enum ───────────────────────────────────────────────────────────────────
CREATE TYPE zatca_status AS ENUM (
  'not_transmitted', 'pending', 'reported', 'cleared', 'rejected', 'failed'
);

-- ── invoices: ZATCA status columns ────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN zatca_status zatca_status NOT NULL DEFAULT 'not_transmitted',
  ADD COLUMN zatca_uuid    TEXT;               -- ZATCA response UUID

CREATE INDEX idx_invoices_zatca_status ON invoices(tenant_id, zatca_status)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- zatca_transmissions — adapter ledger (append-only, no deleted_at)
-- ===========================================================================
CREATE TABLE zatca_transmissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  invoice_id     UUID NOT NULL REFERENCES invoices(id),
  doc_type       TEXT NOT NULL,                -- 'invoice' | 'credit_note' | 'debit_note'
  doc_ref        TEXT NOT NULL,                -- human ref: invoice_number / CN / DN number
  payload_xml    TEXT NOT NULL,                -- UBL 2.1 payload built by the adapter
  status         zatca_status NOT NULL DEFAULT 'pending',
  zatca_uuid     TEXT,                         -- response UUID (sandbox mock or real API)
  response       JSONB,                        -- raw ZATCA response (mock in sandbox)
  error_message  TEXT,
  transmitted_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES auth.users(id),
  CONSTRAINT chk_zatca_transmissions_doc_type CHECK (doc_type IN ('invoice', 'credit_note', 'debit_note'))
);

-- Idempotency: one transmission per (tenant, invoice, doc_type). A replay of
-- the adapter for the same invoice is skipped, exactly like the event ledger.
CREATE UNIQUE INDEX idx_zatca_transmissions_tenant_invoice
  ON zatca_transmissions(tenant_id, invoice_id, doc_type);
CREATE INDEX idx_zatca_transmissions_tenant_status
  ON zatca_transmissions(tenant_id, status, created_at);

-- ── RLS: SELECT-only for authenticated (own tenant); writes via service role ──
ALTER TABLE zatca_transmissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sel_zatca_transmissions_tenant" ON zatca_transmissions
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

-- No INSERT / UPDATE / DELETE policies: the app writes through the
-- service-role admin client (mirrors financial_events post-053 hardening —
-- authenticated users can never inject or mutate transmissions).
