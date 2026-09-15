-- ============================================================================
-- Drivers Module — Phase A: foundation
-- (20260915120000_drivers_module_foundation.sql)
--
-- Scope: Saudi-2026 compliance document types, driver identity/card fields,
-- new module tables (consents, compliance results/overrides, calendar events,
-- assets, driver cards + print history), the compute_driver_compliance()
-- engine, and a calendar conflict helper.
--
-- Conventions (Track 1):
--   * Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / guarded DO blocks.
--   * New mutable tables: RLS enabled, tenant policies via
--     get_my_tenant_id(), soft-delete where the table supports deleted_at.
--   * Append-only tables: RLS enabled, tenant policies via
--     get_my_tenant_id(), and no hard-DELETE policy.
--   * Internal SECURITY DEFINER engine: service_role EXECUTE only.
--   * No data seeds; no production data touched.
-- ============================================================================

-- ─── 1. Document types — Saudi 2026 compliance set ──────────────────────────
-- Balady health certificate + Home Delivery Permit (mandatory since
-- 2025-07), Ajeer Tasharuk permit (resident riders), annual Driver Card,
-- national ID distinction, and common HR/legal documents.

ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'national_id';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'health_certificate';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'home_delivery_permit';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'ajeer_permit';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'food_handling_certificate';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'vehicle_lease_agreement';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'driver_card';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'work_permit';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'authorization_letter';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'training_certificate';

-- ─── 2. drivers — identity typing, rider id, card state, assignment meta ────

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS identity_type text NOT NULL DEFAULT 'iqama';
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS rider_id text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS blood_type text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'ar';
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS branch_hub text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS delivery_zones text[];
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS card_status text NOT NULL DEFAULT 'not_issued';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'drivers_identity_type_check'
                   AND conrelid = 'public.drivers'::regclass) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_identity_type_check
      CHECK (identity_type IN ('national_id', 'iqama'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'drivers_card_status_check'
                   AND conrelid = 'public.drivers'::regclass) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_card_status_check
      CHECK (card_status IN ('not_issued', 'active', 'suspended', 'revoked', 'expired'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.drivers.identity_type IS
  'national_id (Saudi, starts with 1) or iqama (resident, starts with 2). Drives per-type validation and document rules.';
COMMENT ON COLUMN public.drivers.card_status IS
  'Driver card lifecycle: not_issued/active/suspended/revoked/expired. Expiry is also enforced by driver_cards.expires_at.';

-- ─── 3. New module tables ───────────────────────────────────────────────────

-- 3.1 PDPL consents (terms/privacy, versioned, provable)
CREATE TABLE IF NOT EXISTS public.driver_consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  driver_id    uuid NOT NULL REFERENCES public.drivers (id),
  consent_type text NOT NULL,
  version      text NOT NULL,
  accepted     boolean NOT NULL DEFAULT false,
  accepted_at  timestamptz,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, driver_id, consent_type, version)
);

-- 3.2 Compliance engine run history
CREATE TABLE IF NOT EXISTS public.driver_compliance_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  driver_id    uuid NOT NULL REFERENCES public.drivers (id),
  run_at       timestamptz NOT NULL DEFAULT now(),
  level        text NOT NULL CHECK (level IN (
                 'fully_compliant', 'compliant_warnings', 'pending_review',
                 'non_compliant', 'critical_block', 'suspended')),
  score        smallint NOT NULL CHECK (score >= 0 AND score <= 100),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3.3 Compliance overrides — authorized, reasoned, auto-expiring
CREATE TABLE IF NOT EXISTS public.driver_compliance_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id),
  driver_id      uuid NOT NULL REFERENCES public.drivers (id),
  requirement    text NOT NULL,
  reason         text NOT NULL,
  attachment_url text,
  approved_by    uuid NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  deleted_at     timestamptz
);

-- 3.4 Driver operations calendar backbone
CREATE TABLE IF NOT EXISTS public.driver_calendar_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants (id),
  driver_id           uuid NOT NULL REFERENCES public.drivers (id),
  event_type          text NOT NULL,
  status              text NOT NULL DEFAULT 'planned',
  priority            text NOT NULL DEFAULT 'normal',
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz,
  city                text,
  zone                text,
  vehicle_id          uuid REFERENCES public.vehicles (id),
  related_document_id uuid,
  related_entity_type text,
  related_entity_id   uuid,
  assigned_to         uuid,
  notes               text,
  attachments         text[],
  reminder_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- 3.5 Equipment / assets handed to the driver
CREATE TABLE IF NOT EXISTS public.driver_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id),
  driver_id      uuid NOT NULL REFERENCES public.drivers (id),
  asset_type     text NOT NULL,
  serial         text,
  condition      text,
  handed_over_at timestamptz,
  returned_at    timestamptz,
  handover_ref   text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  deleted_at     timestamptz
);

-- 3.6 Driver cards (HungerStation-format annual card)
CREATE TABLE IF NOT EXISTS public.driver_cards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants (id),
  driver_id             uuid NOT NULL REFERENCES public.drivers (id),
  card_serial           text NOT NULL UNIQUE,
  generated_document_id uuid REFERENCES public.generated_documents (id),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  issued_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz,
  activated_at          timestamptz,
  suspended_at          timestamptz,
  revoked_at            timestamptz,
  revoke_reason         text,
  reprint_count         integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  deleted_at            timestamptz
);

-- 3.7 Card print history (append-only)
CREATE TABLE IF NOT EXISTS public.driver_card_prints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id),
  card_id    uuid NOT NULL REFERENCES public.driver_cards (id),
  printed_by uuid,
  printed_at timestamptz NOT NULL DEFAULT now(),
  format     text NOT NULL DEFAULT 'pvc' CHECK (format IN ('pvc', 'a4', 'screen')),
  batch_ref  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 4. Indexes (tenant + driver hot paths) ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_driver_consents_driver           ON public.driver_consents (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_consents_tenant           ON public.driver_consents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_compliance_results_driver ON public.driver_compliance_results (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_compliance_results_tenant ON public.driver_compliance_results (tenant_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_overrides_driver          ON public.driver_compliance_overrides (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_overrides_tenant          ON public.driver_compliance_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_calendar_driver_time      ON public.driver_calendar_events (driver_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_driver_calendar_tenant_time      ON public.driver_calendar_events (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_driver_assets_driver             ON public.driver_assets (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_assets_tenant             ON public.driver_assets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_cards_driver              ON public.driver_cards (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_cards_tenant              ON public.driver_cards (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_card_prints_card          ON public.driver_card_prints (card_id);
CREATE INDEX IF NOT EXISTS idx_driver_card_prints_tenant        ON public.driver_card_prints (tenant_id);

-- ─── 5. RLS — tenant isolation and delete restriction ───────────────────────

ALTER TABLE public.driver_consents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_compliance_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_compliance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_calendar_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_assets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_cards                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_card_prints          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_soft_delete_tables text[] := ARRAY[
    'driver_compliance_overrides',
    'driver_calendar_events',
    'driver_assets',
    'driver_cards'
  ];
  v_plain_tables text[] := ARRAY[
    'driver_consents',
    'driver_compliance_results',
    'driver_card_prints'
  ];
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY v_soft_delete_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_sel ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_sel
       ON public.%I
       FOR SELECT
       TO authenticated
       USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL)',
      v_t, v_t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_ins ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_ins
       ON public.%I
       FOR INSERT
       TO authenticated
       WITH CHECK (tenant_id = get_my_tenant_id())',
      v_t, v_t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_upd ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_upd
       ON public.%I
       FOR UPDATE
       TO authenticated
       USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL)
       WITH CHECK (tenant_id = get_my_tenant_id())',
      v_t, v_t
    );
  END LOOP;

  FOREACH v_t IN ARRAY v_plain_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_sel ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_sel
       ON public.%I
       FOR SELECT
       TO authenticated
       USING (tenant_id = get_my_tenant_id())',
      v_t, v_t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_ins ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_ins
       ON public.%I
       FOR INSERT
       TO authenticated
       WITH CHECK (tenant_id = get_my_tenant_id())',
      v_t, v_t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_upd ON public.%I', v_t, v_t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_upd
       ON public.%I
       FOR UPDATE
       TO authenticated
       USING (tenant_id = get_my_tenant_id())
       WITH CHECK (tenant_id = get_my_tenant_id())',
      v_t, v_t
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE public.driver_consents IS
  'PDPL consent records (terms/privacy), versioned with acceptance timestamp and ip_hash. Tenant-isolated.';
COMMENT ON TABLE public.driver_compliance_results IS
  'Append-only history of compute_driver_compliance runs: level, score, per-requirement detail.';
COMMENT ON TABLE public.driver_compliance_overrides IS
  'Authorized compliance overrides with reason, approval, attachment and automatic expiry (expires_at).';
COMMENT ON TABLE public.driver_calendar_events IS
  'Driver operations calendar backbone: shifts, expiries, training, reviews, settlements. Soft-deleted; version column supports undo.';
COMMENT ON TABLE public.driver_assets IS
  'Equipment assigned to drivers (thermal bag, box, helmet, vest, uniform, phone, SIM, ID card, stickers) with handover/return.';
COMMENT ON TABLE public.driver_cards IS
  'Issued driver cards: serial, status lifecycle, 12-month expiry, reprint count. Linked to generated_documents for QR verification.';
COMMENT ON TABLE public.driver_card_prints IS
  'Append-only card print history (pvc/a4/screen) with operator and batch reference.';

-- ─── 6. compute_driver_compliance(uuid) ─────────────────────────────────────
-- Evaluates the Saudi-2026 driver requirements for one driver, writes the
-- result row, updates drivers.compliance_risk_score / documents_complete /
-- dispatch_eligible, and returns the per-requirement detail as jsonb.
-- Rules are tenant-configurable via system_settings key
-- 'driver_compliance_rules' (jsonb): warn_days (default 30),
-- require_health_certificate (default true), require_home_delivery_permit
-- (default true). SECURITY DEFINER; service_role EXECUTE only (Track 1).

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
     WHERE d.driver_id = p_driver_id AND d.doc_type = v_key
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

COMMENT ON FUNCTION public.compute_driver_compliance(uuid) IS
  'Drivers module: evaluates Saudi-2026 compliance for one driver, persists run history, updates risk score / documents_complete / dispatch_eligible. Rules tenant-configurable via system_settings driver_compliance_rules. SECURITY DEFINER, service_role only (Track 1).';

REVOKE ALL ON FUNCTION public.compute_driver_compliance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_driver_compliance(uuid) TO service_role;

-- ─── 7. driver_calendar_has_conflict — shift/event overlap guard ────────────
-- SECURITY INVOKER (read-only; RLS scopes rows). Used by server actions
-- before committing create/reschedule/assign operations.

CREATE OR REPLACE FUNCTION public.driver_calendar_has_conflict(
  p_driver_id  uuid,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz DEFAULT NULL,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_calendar_events e
    WHERE e.driver_id = p_driver_id
      AND e.deleted_at IS NULL
      AND e.status NOT IN ('cancelled', 'archived', 'rejected')
      AND (p_exclude_id IS NULL OR e.id <> p_exclude_id)
      AND tstzrange(e.starts_at, COALESCE(e.ends_at, e.starts_at + interval '1 hour'), '[)')
          && tstzrange(p_starts_at, COALESCE(p_ends_at, p_starts_at + interval '1 hour'), '[)')
  );
$func$;

COMMENT ON FUNCTION public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid) IS
  'Drivers module: true when the driver already has a non-terminal calendar event overlapping the given window. Server-side conflict gate for drag/assign/reschedule.';

REVOKE ALL ON FUNCTION public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;

-- ─── 8. Scope note ──────────────────────────────────────────────────────────
-- Not included here (by design): production data, WPS/GOSI/Qiwa exports
-- (Payroll phase), notifications delivery (Phase H), OCR/face-match vendors
-- (roadmap). This migration changes schema only and is validated by
-- supabase/tests/012_drivers_module_tests.sql.