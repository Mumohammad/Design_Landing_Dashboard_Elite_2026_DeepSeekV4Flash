-- 20260924140000_audit_trail_surface.sql
-- Audit-Trail surface (Prompt D) — indexes + append-only grant hardening +
-- the filtered-page read helper.
--
-- The audit-trail surface (upgraded /audit-log page) READS audit_log; this
-- migration makes the list's filter paths index-certain, closes a live grant
-- gap found during Prompt-D recon (verified against a fresh stack), and adds
-- the server-side filtered read the page calls. All idempotent; safe to
-- re-run.
--   1. All four list/filter indexes from 007 re-asserted with IF NOT EXISTS —
--      they exist in 007 but the audit trail depends on them explicitly, so
--      the surface ships its own idempotent re-assertion (drift-proofing;
--      007's indexes are NOT IF NOT EXISTS).
--   2. anon + authenticated could still UPDATE / DELETE / TRUNCATE audit_log
--      (default Supabase privileges, never tightened like migration 058 did
--      for the users table). TRUNCATE bypasses RLS and the row-level
--      immutability trigger (009) entirely — both now get SELECT-only.
--   3. fetch_audit_trail_page(): SECURITY DEFINER read helper applying the
--      surface's filters (date range, actor, action, module, entity type +
--      id) with the hard cap applied in SQL. Definer matches the repo's
--      RLS-equivalent helper pattern (get_my_tenant_id()); the tenant arg is
--      always supplied by the server layer from getCurrentUser(), never from
--      the browser.
--   4. has_user_pdpl_consent(): the audit surface's PDPL masking gate — is
--      repaired to break created_at ties on version string ordering.
--      Rationale: inside a --single-transaction pgTAP run, now() is fixed at
--      transaction start, so consent rows written in one test can share a
--      created_at; the previous id-DESC tiebreaker is a RANDOM uuid, making
--      the gate's outcome nondeterministic. Rows are still distinguishable
--      via id, so no assumption of unique timestamps is required.
-- RLS remains the data boundary: no INSERT/UPDATE/DELETE policy exists or is
-- added (ADR-007 append-only). Service-role writes flow through
-- writeAuditLog() as before — nothing changes for the app's write path.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. List/filter indexes (idempotent re-assertion of 007)
--    Matches the audit-trail list: tenant filter + newest-first ordering,
--    per-entity drill-down, actor filter, module/action facets.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log(entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_module_action
  ON audit_log(tenant_id, module, action);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Append-only discipline at the grant layer (058 parity for audit_log)
--    anon + authenticated keep SELECT only. service_role keeps full write
--    breadth for writeAuditLog(). audit_log is a Phase-A-era core table:
--    PostgREST already exposes it, so no schema-cache reload is needed.
-- ─────────────────────────────────────────────────────────────────────────

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. fetch_audit_trail_page — filtered, capped, newest-first read helper
--    SECURITY DEFINER + pinned search_path (repo helper convention). Every
--    column reference is qualified: RETURNS TABLE names shadow the table's
--    columns inside the function body otherwise.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fetch_audit_trail_page(
  p_tenant_id      uuid,
  p_from           timestamptz DEFAULT NULL,
  p_to             timestamptz DEFAULT NULL,
  p_actor_user_id  uuid        DEFAULT NULL,
  p_action         text        DEFAULT NULL,
  p_module         text        DEFAULT NULL,
  p_entity_type    text        DEFAULT NULL,
  p_entity_id      uuid        DEFAULT NULL,
  p_limit          integer     DEFAULT 50
)
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  module      text,
  action      text,
  entity_type text,
  entity_id   uuid,
  actor_id    uuid,
  ip_address  inet,
  reason      text,
  old_values  jsonb,
  new_values  jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    a.id,
    a.created_at,
    a.module,
    a.action,
    a.entity_type,
    a.entity_id,
    a.actor_id,
    a.ip_address,
    CASE
      WHEN a.new_values ? 'reason' THEN NULLIF(a.new_values ->> 'reason', '')
      WHEN a.old_values ? 'reason' THEN NULLIF(a.old_values ->> 'reason', '')
      WHEN a.new_values ? 'archived_reason' THEN NULLIF(a.new_values ->> 'archived_reason', '')
      ELSE NULL
    END AS reason,
    a.old_values,
    a.new_values
  FROM public.audit_log a
  WHERE a.tenant_id = p_tenant_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to   IS NULL OR a.created_at <= p_to)
    AND (
      p_actor_user_id IS NULL
      OR a.actor_id = (
        SELECT u.auth_user_id FROM public.users u
        WHERE u.id = p_actor_user_id
        LIMIT 1
      )
    )
    AND (p_action      IS NULL OR a.action      = p_action)
    AND (p_module      IS NULL OR a.module      = p_module)
    AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
    AND (p_entity_id   IS NULL OR a.entity_id   = p_entity_id)
  ORDER BY a.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

REVOKE ALL ON FUNCTION public.fetch_audit_trail_page(
  uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_audit_trail_page(
  uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_audit_trail_page(
  uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer
) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. has_user_pdpl_consent — deterministic latest-version tiebreak (repair)
--    The audit surface's PDPL masking gate. Same body as the users-module
--    migration, with the created_at tiebreaker changed from id DESC (random
--    uuid — nondeterministic when timestamps tie, e.g. any pgTAP
--    --single-transaction run) to version DESC (monotonic strings).
--    If/when the users module ships the same fix, the CREATE OR REPLACE
--    makes this a no-op overwrite.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_user_pdpl_consent(
  p_user_id uuid,
  p_consent_type text DEFAULT 'terms'
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_consents c
    WHERE c.user_id = p_user_id
      AND c.consent_type = p_consent_type
      AND c.accepted IS TRUE
      AND c.version = (
        SELECT c2.version
        FROM public.user_consents c2
        WHERE c2.user_id = p_user_id
          AND c2.consent_type = p_consent_type
        ORDER BY c2.created_at DESC, c2.version DESC
        LIMIT 1
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_user_pdpl_consent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_user_pdpl_consent(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_user_pdpl_consent(uuid, text) TO authenticated, service_role;
