-- 017_vehicle_handover.sql
-- Module 2 (Vehicles) — v2.0 M2 corrections: structured handover forms,
-- vehicle assignments, vehicle maintenance events.
-- Source: docs/elite-master-prompt-v2.md section 6 M2

-- ═══ vehicle_assignments table ═══
CREATE TABLE vehicle_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ,

  vehicle_id          UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at       TIMESTAMPTZ,
  is_current          BOOLEAN NOT NULL DEFAULT true,
  assignment_reason   TEXT,
  handover_odometer   INTEGER,
  return_odometer     INTEGER,
  handover_condition  TEXT,
  return_condition    TEXT,
  handover_form_id    UUID,
  return_form_id      UUID,
  handover_photos     TEXT[],  -- deprecated, kept for backward compat
  notes               TEXT
);

CREATE INDEX idx_vehicle_assignments_current
  ON vehicle_assignments(tenant_id, vehicle_id, is_current) WHERE is_current = true;
CREATE INDEX idx_vehicle_assignments_driver
  ON vehicle_assignments(tenant_id, driver_id, is_current) WHERE is_current = true;

-- ═══ vehicle_handover_forms table (v2.0 M2 — structured handover) ═══
-- Replaces the loose handover_photos TEXT[] approach. Every driver assignment
-- and return MUST have a formal handover form.
CREATE TABLE vehicle_handover_forms (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID REFERENCES auth.users(id),
  updated_by                  UUID REFERENCES auth.users(id),

  assignment_id               UUID NOT NULL REFERENCES vehicle_assignments(id) ON DELETE CASCADE,
  form_type                   TEXT NOT NULL CHECK (form_type IN ('handover', 'return')),
  form_date                   DATE NOT NULL,

  odometer_reading            INTEGER NOT NULL,
  fuel_level                  TEXT CHECK (fuel_level IN ('full', '3/4', '1/2', '1/4', 'empty')),

  -- Condition checklist
  exterior_front              TEXT NOT NULL DEFAULT 'ok' CHECK (exterior_front IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  exterior_rear               TEXT NOT NULL DEFAULT 'ok' CHECK (exterior_rear IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  exterior_left               TEXT NOT NULL DEFAULT 'ok' CHECK (exterior_left IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  exterior_right              TEXT NOT NULL DEFAULT 'ok' CHECK (exterior_right IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  interior_cabin              TEXT NOT NULL DEFAULT 'ok' CHECK (interior_cabin IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  tires_front_left            TEXT NOT NULL DEFAULT 'ok' CHECK (tires_front_left IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  tires_front_right           TEXT NOT NULL DEFAULT 'ok' CHECK (tires_front_right IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  tires_rear_left             TEXT NOT NULL DEFAULT 'ok' CHECK (tires_rear_left IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  tires_rear_right            TEXT NOT NULL DEFAULT 'ok' CHECK (tires_rear_right IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  spare_tire                  TEXT NOT NULL DEFAULT 'ok' CHECK (spare_tire IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  windshield                  TEXT NOT NULL DEFAULT 'ok' CHECK (windshield IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  lights_headlights           TEXT NOT NULL DEFAULT 'ok' CHECK (lights_headlights IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  lights_rear                 TEXT NOT NULL DEFAULT 'ok' CHECK (lights_rear IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  ac_system                   TEXT NOT NULL DEFAULT 'ok' CHECK (ac_system IN ('ok', 'minor_issue', 'major_issue', 'missing')),
  engine_compartment          TEXT NOT NULL DEFAULT 'ok' CHECK (engine_compartment IN ('ok', 'minor_issue', 'major_issue', 'missing')),

  -- Items present
  registration_card_present   BOOLEAN NOT NULL DEFAULT true,
  insurance_card_present      BOOLEAN NOT NULL DEFAULT true,
  spare_tire_present          BOOLEAN NOT NULL DEFAULT true,
  jack_tools_present          BOOLEAN NOT NULL DEFAULT true,
  fire_extinguisher_present   BOOLEAN NOT NULL DEFAULT true,
  reflectors_present          BOOLEAN NOT NULL DEFAULT true,

  defects_noted               TEXT,
  overall_condition           TEXT CHECK (overall_condition IN ('excellent', 'good', 'fair', 'poor', 'damaged')),

  photos                      TEXT[],

  driver_signature_url        TEXT,
  supervisor_signature_url    TEXT,

  driver_acknowledged_at      TIMESTAMPTZ,
  supervisor_acknowledged_at  TIMESTAMPTZ,

  notes                       TEXT,

  UNIQUE(tenant_id, assignment_id, form_type)
);

-- Link assignments to handover forms
ALTER TABLE vehicle_assignments
  ADD COLUMN IF NOT EXISTS handover_form_id UUID REFERENCES vehicle_handover_forms(id),
  ADD COLUMN IF NOT EXISTS return_form_id UUID REFERENCES vehicle_handover_forms(id);

CREATE INDEX idx_handover_forms_assignment
  ON vehicle_handover_forms(tenant_id, assignment_id, form_type);

-- ═══ vehicle_maintenance_events table ═══
CREATE TABLE vehicle_maintenance_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),
  deleted_at            TIMESTAMPTZ,

  vehicle_id            UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type      TEXT NOT NULL CHECK (maintenance_type IN ('preventive', 'emergency', 'periodic', 'repair')),
  reported_by_driver_id UUID REFERENCES drivers(id),
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  fault_description     TEXT,
  provider              TEXT,
  cost                  NUMERIC(10,2),
  parts_replaced        TEXT,
  odometer_at_service   INTEGER,
  date_in               TIMESTAMPTZ,
  date_out              TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  next_service_km       INTEGER,
  next_service_date     DATE,
  notes                 TEXT
);

CREATE INDEX idx_maintenance_active
  ON vehicle_maintenance_events(tenant_id, vehicle_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_maintenance_vehicle
  ON vehicle_maintenance_events(tenant_id, vehicle_id, reported_at DESC)
  WHERE deleted_at IS NULL;

-- ═══ updated_at triggers ═══
CREATE TRIGGER trg_vehicle_assignments_updated_at BEFORE UPDATE ON vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vehicle_handover_forms_updated_at BEFORE UPDATE ON vehicle_handover_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vehicle_maintenance_events_updated_at BEFORE UPDATE ON vehicle_maintenance_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ RLS ═══
ALTER TABLE vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_handover_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_assignments_select_own_tenant" ON vehicle_assignments
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vehicle_assignments_insert_own_tenant" ON vehicle_assignments
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicle_assignments_update_own_tenant" ON vehicle_assignments
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "vehicle_handover_forms_select_own_tenant" ON vehicle_handover_forms
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicle_handover_forms_insert_own_tenant" ON vehicle_handover_forms
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicle_handover_forms_update_own_tenant" ON vehicle_handover_forms
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "vehicle_maintenance_select_own_tenant" ON vehicle_maintenance_events
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vehicle_maintenance_insert_own_tenant" ON vehicle_maintenance_events
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicle_maintenance_update_own_tenant" ON vehicle_maintenance_events
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());
