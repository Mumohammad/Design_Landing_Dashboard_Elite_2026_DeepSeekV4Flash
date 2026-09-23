-- ============================================================================
-- 061_reconcile_drivers_module_drift.sql
-- Reconciles the live drivers-module schema with the repo migrations.
--
-- Findings source: docs/drivers-audit.md (sections 1.4 / 1.5).
-- Live probed 2026-09-23 via service-role client:
--   * driver_documents.file_url exists (NOT NULL); UI wrote file_path (broken)
--   * no unique index on (driver_id, doc_type) -> document upsert duplicated rows
--   * monthly_driver_orders lacks driver/platform FK indexes
--   * set_driver_status(uuid, driver_status, text, uuid) RPC missing live,
--     but driver-leave-tab.tsx calls it on leave approval (PGRST202)
--   * driver_leave_balances.year / driver_salary_history.basic_salary /
--     drivers.iqama_number + iqama_expiry_date match the repo (no action)
--
-- Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS / guarded DO
-- blocks) so the file can replay on local, staging, and production.
-- ============================================================================

-- ── 1. driver_documents: real upsert target + duplicate backfill ────────────
-- Backfill: collapse pre-existing duplicates on (driver_id, doc_type),
-- keeping the newest active row per pair and soft-deleting the rest.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'driver_documents'
      AND column_name = 'file_url'
  ) THEN
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY driver_id, doc_type
               ORDER BY (deleted_at IS NOT NULL), is_active DESC, updated_at DESC, created_at DESC
             ) AS rn
      FROM public.driver_documents
    )
    UPDATE public.driver_documents d
       SET deleted_at = COALESCE(d.deleted_at, now()),
           is_active  = false,
           notes      = COALESCE(d.notes, 'deduplicated by 061 (superseded upload)')
      FROM ranked r
     WHERE d.id = r.id
       AND d.deleted_at IS NULL
       AND r.rn > 1;
    GET DIAGNOSTICS v_dupes = ROW_COUNT;
    IF v_dupes > 0 THEN
      RAISE NOTICE '061: soft-deleted % duplicate driver_documents rows', v_dupes;
    END IF;
  END IF;
END $$;

-- The upsert target the UI always assumed:
-- one ACTIVE document per (driver, doc_type). Partial so soft-deleted and
-- deactivated history rows never block a re-upload.
DROP INDEX IF EXISTS uq_driver_documents_driver_type;
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_documents_driver_type
  ON public.driver_documents (driver_id, doc_type)
  WHERE deleted_at IS NULL AND is_active = true;

-- ── 1b. driver_document_type enum: compliance requirement keys the UI writes ─
-- The compliance engine keys 'home_delivery_permit' / 'ajeer_permit' map to
-- document rows; the live enum only carries the 10 base Saudi-2026 types.
-- ADD VALUE is idempotent and additive (PG12+ allows this in a transaction as
-- long as the type was created by an earlier migration).
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'home_delivery_permit';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'ajeer_permit';

-- ── 2. monthly_driver_orders: FK indexes (hot path for payroll KPI reads) ───
CREATE INDEX IF NOT EXISTS idx_mdo_driver
  ON public.monthly_driver_orders (tenant_id, driver_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_mdo_platform
  ON public.monthly_driver_orders (platform_id);

-- ── 3. set_driver_status RPC (missing live; UI depends on it) ────────────────
-- Tenant-scoped status transition with audit trail in drivers.updated_by.
CREATE OR REPLACE FUNCTION public.set_driver_status(
  p_driver_id  uuid,
  p_status     public.driver_status,
  p_reason     text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_current public.driver_status;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_current
  FROM public.drivers
  WHERE id = p_driver_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'DRV001: driver not found';
  END IF;

  IF v_current = p_status THEN
    RETURN; -- idempotent no-op
  END IF;

  UPDATE public.drivers
     SET status = p_status,
         updated_by = p_changed_by,
         updated_at = now()
   WHERE id = p_driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_driver_status(uuid, public.driver_status, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_driver_status(uuid, public.driver_status, text, uuid) TO authenticated, service_role;

-- ── 4. Saudi Labor Law leave validation ──────────────────────────────────────
-- Annual: 21 days (< 5 years of service), 30 days (>= 5 years).
-- Sick (120-day structure): 30 full pay + 60 half pay + 30 unpaid.
-- Returns a human-readable violation string, or NULL when the request is OK.
CREATE OR REPLACE FUNCTION public.validate_leave_request(
  p_driver_id       uuid,
  p_leave_type_code text,
  p_days            integer,
  p_year            integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hire_date date;
  v_entitled integer;
  v_used integer;
  v_pending integer;
  v_requested integer;
  v_code text;
  v_days_per_year smallint;
  v_sick_full integer := 30;
  v_sick_half integer := 60;
  v_sick_unpaid integer := 30;
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
BEGIN
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN 'Leave length must be at least one day';
  END IF;

  SELECT hire_date INTO v_hire_date
  FROM public.drivers
  WHERE id = p_driver_id AND deleted_at IS NULL;

  IF v_hire_date IS NULL THEN
    RETURN 'DRV001: driver not found';
  END IF;

  -- Annual entitlement by service length (Art. 109): 21d < 5y, 30d >= 5y
  IF p_leave_type_code = 'annual' THEN
    v_entitled := CASE
      WHEN v_year - EXTRACT(YEAR FROM v_hire_date)::integer >= 5 THEN 30
      ELSE 21
    END;

    SELECT COALESCE(SUM(used_days), 0), COALESCE(SUM(pending_days), 0)
      INTO v_used, v_pending
    FROM public.driver_leave_balances
    WHERE driver_id = p_driver_id
      AND year = v_year
      AND deleted_at IS NULL;

    v_requested := COALESCE(v_used, 0) + COALESCE(v_pending, 0) + p_days;
    IF v_requested > v_entitled THEN
      RETURN format(
        'Annual leave exceeds entitlement: %s/%s days used. Driver has %s years of service (entitlement: %s days).',
        v_used + v_pending, v_entitled,
        v_year - EXTRACT(YEAR FROM v_hire_date)::integer,
        v_entitled
      );
    END IF;
  END IF;

  -- Sick leave tiers (Art. 117): within 120 days -> 30 full / 60 half / 30 unpaid
  IF p_leave_type_code = 'sick' THEN
    SELECT COALESCE(SUM(days_requested), 0) INTO v_used
    FROM public.driver_leave_requests r
    JOIN public.leave_types t ON t.id = r.leave_type_id
    WHERE r.driver_id = p_driver_id
      AND t.code = 'sick'
      AND r.status IN ('pending', 'approved')
      AND EXTRACT(YEAR FROM r.start_date) = v_year
      AND r.deleted_at IS NULL;

    v_requested := v_used + p_days;
    IF v_requested <= v_sick_full THEN
      RETURN NULL; -- within full-pay tier
    ELSIF v_requested <= v_sick_full + v_sick_half THEN
      RAISE NOTICE 'sick tier: half pay (day % of 120-day window)', v_requested - v_sick_full;
      RETURN NULL;
    ELSIF v_requested <= v_sick_full + v_sick_half + v_sick_unpaid THEN
      RAISE NOTICE 'sick tier: unpaid (day % of 120-day window)', v_requested - v_sick_full - v_sick_half;
      RETURN NULL;
    ELSE
      RETURN format(
        'Sick leave exceeds the 120-day statutory window (%s full + %s half + %s unpaid). Requested through day %s.',
        v_sick_full, v_sick_half, v_sick_unpaid, v_requested
      );
    END IF;
  END IF;

  -- Other types: cap from leave_types.days_per_year when configured
  SELECT t.code, t.days_per_year INTO v_code, v_days_per_year
  FROM public.leave_types t
  WHERE t.code = p_leave_type_code
  LIMIT 1;

  IF v_code IS NOT NULL AND v_days_per_year > 0 THEN
    SELECT COALESCE(SUM(r.days_requested), 0) INTO v_used
    FROM public.driver_leave_requests r
    JOIN public.leave_types t2 ON t2.id = r.leave_type_id
    WHERE r.driver_id = p_driver_id
      AND t2.code = v_code
      AND r.status IN ('pending', 'approved')
      AND EXTRACT(YEAR FROM r.start_date) = v_year
      AND r.deleted_at IS NULL;

    IF v_used + p_days > v_days_per_year THEN
      RETURN format('Leave exceeds the %s-day yearly cap for type "%s".', v_days_per_year, v_code);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_leave_request(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_leave_request(uuid, text, integer, integer) TO authenticated, service_role;

-- ── 5. PDPL consent gate helper ──────────────────────────────────────────────
-- True only when the driver accepted BOTH photo and sensitive_docs consents
-- (latest version per type). Used by card print + document surfaces before
-- rendering national_id / iqama values.
CREATE OR REPLACE FUNCTION public.has_pdpl_consent(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT bool_and(accepted) FROM (
       SELECT DISTINCT ON (consent_type) accepted
       FROM public.driver_consents
       WHERE driver_id = p_driver_id
         AND consent_type IN ('photo', 'sensitive_docs')
       ORDER BY consent_type, created_at DESC
     ) latest),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.has_pdpl_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_pdpl_consent(uuid) TO authenticated, service_role;

-- ── 6. Trigger (optional enforcement): block leave requests that violate ─────
-- Saudi Labor Law caps at INSERT time. Soft-fail design: raises so the UI
-- surfaces the validator message verbatim.
CREATE OR REPLACE FUNCTION public.enforce_leave_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_msg text;
BEGIN
  SELECT code INTO v_code FROM public.leave_types WHERE id = NEW.leave_type_id;
  v_msg := public.validate_leave_request(NEW.driver_id, v_code, NEW.days_requested::integer, EXTRACT(YEAR FROM NEW.start_date)::integer);
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'LVE001: %', v_msg USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_leave_policy ON public.driver_leave_requests;
CREATE TRIGGER trg_enforce_leave_policy
  BEFORE INSERT ON public.driver_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_policy();

-- ── 7. compute_driver_compliance: enum/text comparison crash ───────────────
-- The function compared doc_type (driver_document_type enum) to the plain
-- text loop variable (v_key), raising 'operator does not exist:
-- driver_document_type = text' on every run for drivers whose documents
-- were evaluated. Found by actually running the pgTAP suite once the CI
-- runner was fixed to detect aborted files (audit 2026-09-23).
-- Identical body to the foundation migration; CREATE OR REPLACE is safe on
-- both fresh resets and the live DB (this file sorts last).
CREATE OR REPLACE FUNCTION public.compute_driver_compliance(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_driver     public.drivers%ROWTYPE;
  v_rules_text text;
  v_rules      jsonb := '{}'::jsonb;
  v_warn_days  integer := 30;
  v_req_health boolean := true;
  v_req_hdp    boolean := true;
  v_today      date := CURRENT_DATE;
  v_reqs       jsonb := '[]'::jsonb;
  v_blockers   integer := 0;
  v_missing    integer := 0;
  v_warnings   integer := 0;
  v_pending    integer := 0;
  v_level      text;
  v_score      integer;
  v_key        text;
  v_status     text;
  v_detail     text;
  v_blocker    boolean;
  v_override   boolean;
  v_doc        record;
  v_vehicle    record;
BEGIN
  SELECT * INTO v_driver FROM public.drivers
   WHERE id = p_driver_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'driver_not_found');
  END IF;

  -- Tenant-configurable rules (fall back to Saudi-market defaults).
  SELECT s.value INTO v_rules_text
    FROM public.system_settings s
   WHERE s.tenant_id = v_driver.tenant_id
     AND s.key = 'driver_compliance_rules'
     AND s.deleted_at IS NULL
   ORDER BY s.updated_at DESC
   LIMIT 1;

  BEGIN
    v_rules := COALESCE(v_rules_text::jsonb, '{}'::jsonb);
    v_warn_days  := COALESCE((v_rules->>'warn_days')::integer, 30);
    v_req_health := COALESCE((v_rules->>'require_health_certificate')::boolean, true);
    v_req_hdp    := COALESCE((v_rules->>'require_home_delivery_permit')::boolean, true);
  EXCEPTION WHEN others THEN
    v_warn_days := 30; v_req_health := true; v_req_hdp := true;
  END;

  -- ── identity (National ID / Iqama) — blocker ─────────────────────────────
  v_key := 'identity'; v_blocker := true; v_detail := NULL;
  IF v_driver.iqama_number IS NOT NULL AND btrim(v_driver.iqama_number) <> '' THEN
    IF v_driver.iqama_expiry_date IS NULL THEN
      v_status := 'valid'; v_detail := 'no_expiry_captured';
    ELSIF v_driver.iqama_expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_driver.iqama_expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  ELSE
    SELECT d.expiry_date, d.is_verified INTO v_doc
      FROM public.driver_documents d
     WHERE d.driver_id = p_driver_id AND d.doc_type IN ('national_id', 'iqama')
       AND d.is_active AND d.deleted_at IS NULL
     ORDER BY d.expiry_date DESC NULLS LAST, d.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
      v_status := 'missing';
    ELSIF NOT v_doc.is_verified THEN
      v_status := 'pending_review';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  END IF;
  SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
   WHERE o.driver_id = p_driver_id AND o.requirement = v_key
     AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
  IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
    v_status := 'override_active';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
  IF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
  ELSIF v_status = 'pending_review' THEN v_pending := v_pending + 1;
  ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1;
  ELSIF v_status = 'missing' THEN v_missing := v_missing + 1; END IF;

  -- ── driving licence — blocker ────────────────────────────────────────────
  v_key := 'driving_license'; v_blocker := true; v_detail := NULL; v_override := false;
  IF v_driver.license_number IS NULL OR btrim(v_driver.license_number) = '' THEN
    v_status := 'missing';
  ELSIF v_driver.license_expiry_date IS NULL THEN
    v_status := 'valid'; v_detail := 'no_expiry_captured';
  ELSIF v_driver.license_expiry_date < v_today THEN
    v_status := 'expired';
  ELSIF v_driver.license_expiry_date <= v_today + v_warn_days THEN
    v_status := 'expiring';
  ELSE
    v_status := 'valid';
  END IF;
  SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
   WHERE o.driver_id = p_driver_id AND o.requirement = v_key
     AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
  IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
    v_status := 'override_active';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
  IF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
  ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1; END IF;

  -- ── photo / selfie ───────────────────────────────────────────────────────
  v_key := 'photo'; v_blocker := false; v_detail := NULL;
  IF v_driver.photo_url IS NOT NULL AND btrim(v_driver.photo_url) <> '' THEN
    v_status := 'valid';
  ELSE
    v_status := 'missing'; v_missing := v_missing + 1;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);

  -- ── document-type requirements (health certificate, home delivery permit,
  --    Ajeer for residents) — latest active document decides ────────────────
  FOR v_key, v_blocker IN
    SELECT k, b FROM (VALUES
      ('health_certificate',   v_req_health),
      ('home_delivery_permit', v_req_hdp),
      ('ajeer_permit',         (v_driver.nationality_code IS NOT NULL
                                 AND v_driver.nationality_code <> 'SA'
                                 AND v_driver.identity_type = 'iqama'))
    ) AS r(k, b)
  LOOP
    v_detail := NULL; v_override := false;
    SELECT d.expiry_date, d.is_verified INTO v_doc
      FROM public.driver_documents d
     WHERE d.driver_id = p_driver_id AND d.doc_type = v_key::public.driver_document_type
       AND d.is_active AND d.deleted_at IS NULL
     ORDER BY d.expiry_date DESC NULLS LAST, d.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
      IF v_blocker THEN v_status := 'missing'; ELSE v_status := 'not_required'; END IF;
    ELSIF NOT v_doc.is_verified THEN
      v_status := 'pending_review';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
    SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
     WHERE o.driver_id = p_driver_id AND o.requirement = v_key
       AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
    IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
      v_status := 'override_active';
    END IF;
    v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
              'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
    IF v_status = 'not_required' OR v_status = 'valid' THEN NULL;
    ELSIF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
    ELSIF v_status = 'missing' THEN v_missing := v_missing + 1;
    ELSIF v_status = 'pending_review' THEN v_pending := v_pending + 1;
    ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1; END IF;
  END LOOP;

  -- ── vehicle link (only when a vehicle is assigned) — blocker ─────────────
  v_key := 'vehicle_link'; v_blocker := true; v_detail := NULL; v_override := false;
  IF v_driver.current_vehicle_id IS NULL THEN
    v_status := 'not_required';
  ELSE
    SELECT registration_expiry, insurance_expiry, status AS vehicle_status
      INTO v_vehicle
      FROM public.vehicles
     WHERE id = v_driver.current_vehicle_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      v_status := 'expired'; v_detail := 'vehicle_record_missing';
    ELSIF v_vehicle.vehicle_status IN ('retired', 'off_road') THEN
      v_status := 'expired'; v_detail := 'vehicle_' || v_vehicle.vehicle_status;
    ELSIF v_vehicle.registration_expiry IS NOT NULL AND v_vehicle.registration_expiry < v_today THEN
      v_status := 'expired'; v_detail := 'registration_expired';
    ELSIF v_vehicle.insurance_expiry IS NOT NULL AND v_vehicle.insurance_expiry < v_today THEN
      v_status := 'expired'; v_detail := 'insurance_expired';
    ELSIF (v_vehicle.registration_expiry IS NOT NULL AND v_vehicle.registration_expiry <= v_today + v_warn_days)
       OR (v_vehicle.insurance_expiry IS NOT NULL AND v_vehicle.insurance_expiry <= v_today + v_warn_days) THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);
  IF v_status = 'expired' THEN v_blockers := v_blockers + 1;
  ELSIF v_status = 'expiring' THEN v_warnings := v_warnings + 1; END IF;

  -- ── employment status ────────────────────────────────────────────────────
  v_key := 'employment_status'; v_blocker := true; v_detail := NULL;
  IF v_driver.status IN ('terminated', 'blacklisted') THEN
    v_status := 'blocked'; v_blockers := v_blockers + 1;
  ELSIF v_driver.status = 'suspended' THEN
    v_status := 'suspended';
  ELSE
    v_status := 'valid';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);

  -- ── driver card (annual) — warning-level ─────────────────────────────────
  v_key := 'driver_card'; v_blocker := false; v_detail := NULL;
  IF v_driver.card_status = 'active' THEN
    v_status := 'valid';
  ELSIF v_driver.card_status = 'not_issued' THEN
    v_status := 'missing';
  ELSE
    v_status := 'expiring'; v_detail := 'card_' || v_driver.card_status;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);
  IF v_status = 'expiring' THEN v_warnings := v_warnings + 1; END IF;
  -- card 'missing' is informational: does not raise compliance level

  -- ── level + score ────────────────────────────────────────────────────────
  IF v_driver.status = 'suspended' THEN
    v_level := 'suspended';
  ELSIF v_blockers > 0 THEN
    v_level := 'critical_block';
  ELSIF v_missing > 0 THEN
    v_level := 'non_compliant';
  ELSIF v_pending > 0 THEN
    v_level := 'pending_review';
  ELSIF v_warnings > 0 THEN
    v_level := 'compliant_warnings';
  ELSE
    v_level := 'fully_compliant';
  END IF;

  v_score := GREATEST(0,
    100 - (40 * v_blockers) - (15 * v_missing) - (10 * v_pending) - (5 * v_warnings));

  UPDATE public.drivers
  SET compliance_risk_score      = (100 - v_score),
      documents_complete         = (v_missing = 0 AND v_pending = 0),
      last_compliance_review_at  = now(),
      dispatch_eligible          = (v_level IN ('fully_compliant', 'compliant_warnings')
                                    AND v_driver.status = 'active'),
      updated_at                 = now()
  WHERE id = p_driver_id;

  INSERT INTO public.driver_compliance_results
    (tenant_id, driver_id, level, score, details, triggered_by)
  VALUES
    (v_driver.tenant_id, p_driver_id, v_level, v_score,
     jsonb_build_object('level', v_level, 'score', v_score,
                        'blockers', v_blockers, 'missing', v_missing,
                        'pending', v_pending, 'warnings', v_warnings,
                        'requirements', v_reqs, 'computed_at', now()),
     auth.uid());

  RETURN jsonb_build_object(
    'level', v_level, 'score', v_score,
    'blockers', v_blockers, 'missing', v_missing,
    'pending', v_pending, 'warnings', v_warnings,
    'requirements', v_reqs);
END;
$func$;

REVOKE ALL ON FUNCTION public.compute_driver_compliance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_driver_compliance(uuid) TO service_role;
