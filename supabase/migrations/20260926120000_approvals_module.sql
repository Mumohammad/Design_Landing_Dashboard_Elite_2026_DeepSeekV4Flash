-- ============================================================================
-- Approvals Module — surface (Prompt E)
-- (20260926120000_approvals_module.sql)
--
-- Scope: schema support the unified approvals inbox (/approvals) needs on top
-- of the EXISTING decision sources. Nothing new is invented where a table
-- already exists:
--
--   Queue sources (all pre-existing — verified against live schema):
--     * expenses (021)             is_approved = false  → approve/reject
--     * driver_leave_requests (018) status = 'pending'  → approve/reject
--     * driver_applications (029/030) status IN ('submitted','under_review')
--                                    → approve/reject
--
--   1. Partial indexes for each queue read (the queue query filters on
--      pending-state predicates; two of the three already have them —
--      idx_expenses_pending_approval (021), idx_driver_apps_review_queue
--      (030) — those are re-asserted idempotently for drift-proofing, the
--      leave-requests pending index from 018 is NOT IF NOT EXISTS so the
--      surface ships its own guarded re-assertion, and driver_applications
--      lacked a submitted/under_review partial index entirely).
--   2. fetch_pending_approvals(p_tenant_id, p_type, p_from, p_to, p_limit) —
--      the capped SECURITY DEFINER read RPC composing the unified queue from
--      the three sources via UNION ALL. Pinned search_path (rule from 061),
--      hard cap 100 (same convention as fetch_audit_trail_page), tenant arg
--      always supplied by the server layer from getCurrentUser(), never from
--      the browser.
--   3. decide_leave_request_atomic(p_tenant_id, p_request_id, p_decision,
--      p_reason, p_reviewer) — the leave decision transition as ONE atomic
--      RPC (063_expense_approval_race.sql parity): conditional UPDATE claims
--      the pending row (0 rows ⇒ already decided → LVE002), approved leave
--      moves the driver to on_leave via set_driver_status (the drivers-module
--      contract the profile tab relies on), and the rejection reason is
--      persisted in review_notes. Expense decisions already have their atomic
--      RPC (approve_expense_atomic, 063) and are REUSED, not duplicated;
--      application decisions are a guarded conditional UPDATE in the server
--      action (single-statement write, same stale-state semantics).
--   4. anon + authenticated keep SELECT/UPDATE breadth they already have via
--      RLS on these Phase-A-era tables (expenses_upd / leave_requests_upd /
--      staff policy) — but the server layer only ever calls the atomic RPCs
--      through the service-role client behind requirePermission(...approve),
--      matching approve_expense_atomic's execution boundary.
--
-- Conventions (Track 1): idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- guarded DO blocks), SECURITY DEFINER helpers with pinned search_path,
-- exact-signature REVOKE/GRANT, no data seeds.
--
-- Rollback (forward-only repo, notes only):
--   DROP FUNCTION IF EXISTS public.decide_leave_request_atomic(uuid, uuid, text, text, uuid);
--   DROP FUNCTION IF EXISTS public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer);
--   DROP INDEX IF EXISTS public.idx_leave_requests_pending_queue;
--   DROP INDEX IF EXISTS public.idx_driver_apps_pending_queue;
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Queue indexes (idempotent)
--    One partial index per pending-state predicate the queue filters on.
--    idx_expenses_pending_approval (021) and idx_driver_apps_review_queue
--    (030) already exist and are re-asserted as a no-op for drift-proofing;
--    the two below are NEW (018's leave pending index is not IF NOT EXISTS
--    and driver_applications had no submitted/under_review partial index).
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_expenses_pending_approval
  ON expenses(tenant_id, is_approved)
  WHERE deleted_at IS NULL AND is_approved = false;

CREATE INDEX IF NOT EXISTS idx_driver_apps_review_queue
  ON driver_applications(tenant_id, status, created_at DESC);

-- NEW: leave queue — pending requests by tenant, oldest-first decision queue.
-- 018's idx_leave_requests_pending indexes (tenant_id, status, start_date)
-- WHERE deleted_at IS NULL AND status = 'pending' but is not IF NOT EXISTS,
-- so the approvals surface ships its own guarded equivalent.
CREATE INDEX IF NOT EXISTS idx_leave_requests_pending_queue
  ON driver_leave_requests(tenant_id, requested_at)
  WHERE deleted_at IS NULL AND status = 'pending';

-- NEW: applications queue — pre-decision states by submission order.
CREATE INDEX IF NOT EXISTS idx_driver_apps_pending_queue
  ON driver_applications(submitted_at DESC)
  WHERE status IN ('submitted', 'under_review');

COMMENT ON INDEX idx_leave_requests_pending_queue IS
  'Approvals inbox: pending driver leave requests per tenant, requested_at order (queue predicate index)';
COMMENT ON INDEX idx_driver_apps_pending_queue IS
  'Approvals inbox: driver applications awaiting decision (submitted/under_review), submission order';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. fetch_pending_approvals — the unified queue read
--    Composes the three pending-decision sources with UNION ALL. SECURITY
--    DEFINER + pinned search_path + hard cap (LEAST/GREATEST clamp), same
--    shape as fetch_audit_trail_page. STABLE: no writes, same-input-stable.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fetch_pending_approvals(
  p_tenant_id uuid,
  p_type      text        DEFAULT NULL,  -- 'expense' | 'leave_request' | 'application' | NULL = all
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_limit     integer     DEFAULT 50
)
RETURNS TABLE (
  item_type    text,
  item_id      uuid,
  subject      text,
  subject_meta jsonb,
  requester    text,
  requested_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT * FROM (
    -- ── Expenses (021): is_approved = false ─────────────────────────────
    SELECT
      'expense'::text                       AS item_type,
      e.id                                  AS item_id,
      COALESCE(e.expense_code, 'EXP-' || LEFT(e.id::text, 8)) AS subject,
      jsonb_build_object(
        'amount',      e.amount,
        'currency',    e.currency,
        'expense_type', e.expense_type,
        'category',    e.category,
        'vendor',      e.vendor,
        'expense_date', e.expense_date
      )                                     AS subject_meta,
      COALESCE(e.vendor, '')                AS requester,
      e.created_at                          AS requested_at
    FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND e.deleted_at IS NULL
      AND e.is_approved = FALSE
      AND (p_type IS NULL OR p_type = 'expense')
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)

    UNION ALL

    -- ── Driver leave requests (018): status = 'pending' ─────────────────
    SELECT
      'leave_request'::text,
      r.id,
      COALESCE(t.name_en, t.name_ar, t.code),
      jsonb_build_object(
        'driver_id',      r.driver_id,
        'leave_type',     t.code,
        'start_date',     r.start_date,
        'end_date',       r.end_date,
        'days_requested', r.days_requested,
        'reason',         r.reason
      ),
      '',
      r.requested_at
    FROM public.driver_leave_requests r
    JOIN public.leave_types t ON t.id = r.leave_type_id
    WHERE r.tenant_id = p_tenant_id
      AND r.deleted_at IS NULL
      AND r.status = 'pending'
      AND (p_type IS NULL OR p_type = 'leave_request')
      AND (p_from IS NULL OR r.requested_at >= p_from)
      AND (p_to IS NULL OR r.requested_at <= p_to)

    UNION ALL

    -- ── Driver applications (029/030): pre-decision states ──────────────
    SELECT
      'application'::text,
      a.id,
      a.application_number,
      jsonb_build_object(
        'full_name',     a.full_name,
        'mobile_hashed', CASE WHEN a.mobile IS NOT NULL THEN 'present' ELSE NULL END,
        'city',          a.city,
        'work_type',     a.work_type,
        'driver_category', a.driver_category,
        'status',        a.status
      ),
      '',  -- applicant PII is NOT projected raw; the UI masks per PDPL
      a.submitted_at
    FROM public.driver_applications a
    WHERE a.tenant_id = p_tenant_id
      AND a.status IN ('submitted', 'under_review')
      AND (p_type IS NULL OR p_type = 'application')
      AND (p_from IS NULL OR a.submitted_at >= p_from)
      AND (p_to IS NULL OR a.submitted_at <= p_to)
  ) q
  ORDER BY q.requested_at ASC  -- oldest pending first (queue discipline)
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

REVOKE ALL ON FUNCTION public.fetch_pending_approvals(
  uuid, text, timestamptz, timestamptz, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_pending_approvals(
  uuid, text, timestamptz, timestamptz, integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer) IS
  'Approvals inbox: unified pending-decision queue composed from expenses (is_approved=false), driver_leave_requests (status=pending) and driver_applications (submitted/under_review). SECURITY DEFINER, pinned search_path, hard cap 100, tenant arg supplied by the server layer. Oldest-first. PDPL note: applicant mobile is never projected (only a presence flag) — the UI masks per consent.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. decide_leave_request_atomic — the leave decision transition
--    ONE atomic RPC (063 parity): conditional UPDATE claims the row
--    (0 rows ⇒ already decided), approved leave flips the driver to
--    on_leave via set_driver_status (drivers-module contract), rejection
--    reason lands in review_notes. Service-role only, like
--    approve_expense_atomic — the server action orchestrates.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_leave_request_atomic(
  p_tenant_id  uuid,
  p_request_id uuid,
  p_decision   text,   -- 'approved' | 'rejected'
  p_reason     text,
  p_reviewer   uuid    -- auth.users id (reviewed_by column FK)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed integer;
  v_row     public.driver_leave_requests%ROWTYPE;
  v_driver  record;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'LVE003: invalid decision';
  END IF;
  IF p_decision = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'LVE004: rejection reason required';
  END IF;

  -- ── Claim the pending row (the race arbiter — 063 pattern) ────────────
  UPDATE public.driver_leave_requests SET
    status        = p_decision::public.leave_status,
    reviewed_by   = p_reviewer,
    reviewed_at   = now(),
    review_notes  = CASE WHEN p_decision = 'rejected' THEN p_reason ELSE review_notes END,
    updated_by    = p_reviewer,
    updated_at    = now()
  WHERE id = p_request_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND status = 'pending';

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RAISE EXCEPTION 'LVE002: leave request already decided';
  END IF;

  SELECT * INTO v_row FROM public.driver_leave_requests
  WHERE id = p_request_id AND tenant_id = p_tenant_id;

  -- ── Approved leave moves the driver to on_leave (drivers contract) ────
  IF p_decision = 'approved' THEN
    SELECT id, status INTO v_driver FROM public.drivers
    WHERE id = v_row.driver_id AND deleted_at IS NULL;
    IF FOUND AND v_driver.status <> 'on_leave' THEN
      PERFORM public.set_driver_status(
        v_row.driver_id,
        'on_leave',
        'Leave approved via approvals inbox',
        p_reviewer
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'request_id',   v_row.id,
    'driver_id',    v_row.driver_id,
    'decision',     p_decision,
    'reviewed_at',  v_row.reviewed_at,
    'days_requested', v_row.days_requested
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_leave_request_atomic(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_leave_request_atomic(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.decide_leave_request_atomic(uuid, uuid, text, text, uuid) IS
  'Approvals inbox: atomic leave decision — claims the pending row via conditional UPDATE (0 rows ⇒ LVE002 already decided), approved leave flips the driver to on_leave via set_driver_status, rejection persists the mandatory reason in review_notes. Service-role only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. decide_application_atomic — the application decision transition
--    Same stale-state semantics as the leave RPC: conditional UPDATE claims
--    a pre-decision row (submitted/under_review); 0 rows ⇒ already decided.
--    reviewed_by references the custom users table (030 convention — the
--    server layer stores getCurrentUser().id, the users row id).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_application_atomic(
  p_tenant_id      uuid,
  p_application_id uuid,
  p_decision       text,  -- 'approved' | 'rejected'
  p_note           text,
  p_reviewer       uuid   -- users.id (reviewed_by FK per 030)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed integer;
  v_row     record;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'APP003: invalid decision';
  END IF;
  IF p_decision = 'rejected' AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'APP004: rejection note required';
  END IF;

  UPDATE public.driver_applications SET
    status        = p_decision,
    reviewed_by   = p_reviewer,
    reviewed_at   = now(),
    review_note   = p_note,
    updated_at    = now()
  WHERE id = p_application_id
    AND tenant_id = p_tenant_id
    AND status IN ('submitted', 'under_review');

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RAISE EXCEPTION 'APP002: application already decided';
  END IF;

  SELECT id, application_number, status, reviewed_at INTO v_row
  FROM public.driver_applications
  WHERE id = p_application_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'application_id',     v_row.id,
    'application_number', v_row.application_number,
    'decision',           v_row.status,
    'reviewed_at',        v_row.reviewed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_application_atomic(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_application_atomic(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.decide_application_atomic(uuid, uuid, text, text, uuid) IS
  'Approvals inbox: atomic application decision — claims a pre-decision row (submitted/under_review) via conditional UPDATE (0 rows ⇒ APP002 already decided), persists reviewed_by/reviewed_at/review_note (030 columns). Rejection requires a note. Service-role only.';
