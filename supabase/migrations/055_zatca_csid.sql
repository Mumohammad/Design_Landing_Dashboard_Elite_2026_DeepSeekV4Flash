-- ============================================================================
-- 055 — ZATCA CSID credential store (Phase 18 production prep)
--
-- Persists the onboarding outputs (compliance CSID + production CSID) so the
-- transmission transport can authenticate with the documented Basic auth
-- (binarySecurityToken:secret). One row per (tenant, environment, kind).
--
-- SECURITY MODEL — the CSID secret is a live API credential, so this table
-- has NO RLS policies at all: only the service-role admin client (app server
-- actions) can read or write it. Authenticated users never see the secret —
-- the UI consumes a masked summary via a server action. This is stricter than
-- zatca_transmissions (SELECT-only for own tenant) by design: a transmission
-- row is a factual record, a CSID secret is a credential.
--
-- No ZATCA compliance is claimed (ZATCA-BOUNDARY §5).
-- ============================================================================

CREATE TYPE zatca_csid_environment AS ENUM ('sandbox', 'simulation', 'production');
CREATE TYPE zatca_csid_kind AS ENUM ('compliance', 'production');

CREATE TABLE zatca_csids (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  environment    zatca_csid_environment NOT NULL,
  kind           zatca_csid_kind NOT NULL,
  csid_base64    TEXT NOT NULL,                -- binarySecurityToken (X.509 cert, base64)
  secret         TEXT NOT NULL,                -- CSID secret — live credential, never surfaced to the UI
  request_id     TEXT,                         -- compliance requestID (needed for the production step)
  status         TEXT NOT NULL DEFAULT 'issued',  -- 'issued' | 'revoked' | 'expired'
  issued_at      TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,                  -- CSIDs rotate; the adapter must refresh before expiry
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  CONSTRAINT chk_zatca_csids_status CHECK (status IN ('issued', 'revoked', 'expired'))
);

-- One CSID per (tenant, environment, kind) — onboarding is an upsert, so
-- re-running it refreshes the same row instead of accumulating secrets.
CREATE UNIQUE INDEX idx_zatca_csids_tenant_env_kind
  ON zatca_csids(tenant_id, environment, kind);

-- No RLS policies: service-role only (see header comment). Enabling RLS with
-- zero policies makes that explicit — every direct client query is denied.
ALTER TABLE zatca_csids ENABLE ROW LEVEL SECURITY;
