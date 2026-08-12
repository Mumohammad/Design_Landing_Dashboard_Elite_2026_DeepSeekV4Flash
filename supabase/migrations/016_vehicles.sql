-- 016_vehicles.sql
-- Module 2 (Vehicles) — core tables, documents, odometer logs, active docs view.
-- Source: docs/elite-master-prompt-v2.md section 6 M2

-- ═══ Enums ═══
CREATE TYPE vehicle_status AS ENUM ('available', 'assigned', 'in_maintenance', 'off_road', 'retired');
CREATE TYPE vehicle_condition AS ENUM ('excellent', 'good', 'fair', 'poor', 'damaged');
CREATE TYPE fuel_type AS ENUM ('petrol', 'diesel', 'hybrid', 'electric');
CREATE TYPE vehicle_document_type AS ENUM (
  'registration', 'insurance', 'inspection', 'operating_card',
  'ownership', 'modification_permit', 'other'
);

-- ═══ vehicles table ═══
CREATE TABLE vehicles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,

  vehicle_code            TEXT,
  plate_number            TEXT NOT NULL,
  plate_type              TEXT,
  make                    TEXT NOT NULL,
  model                   TEXT NOT NULL,
  year                    SMALLINT,
  color                   TEXT,
  chassis_number          TEXT,
  engine_number           TEXT,
  vin                     TEXT,

  status                  vehicle_status NOT NULL DEFAULT 'available',
  condition_status        vehicle_condition NOT NULL DEFAULT 'good',
  fuel_type               fuel_type,

  odometer_current        INTEGER NOT NULL DEFAULT 0,
  odometer_last_service   INTEGER,
  odometer_unit           TEXT NOT NULL DEFAULT 'km',

  purchase_date           DATE,
  warranty_expiry         DATE,
  insurance_expiry        DATE,
  insurance_provider      TEXT,
  insurance_policy_number TEXT,
  inspection_expiry       DATE,
  registration_expiry     DATE,
  operating_card_expiry   DATE,

  current_driver_id       UUID,
  primary_platform_id     UUID,

  transmission            TEXT,
  seats                   SMALLINT,
  cargo_capacity          NUMERIC(10,2),

  photo_url               TEXT,
  notes                   TEXT,
  tags                    TEXT[],

  CONSTRAINT chk_vehicles_year CHECK (year IS NULL OR (year BETWEEN 1980 AND EXTRACT(YEAR FROM now())::INT + 1))
);

CREATE UNIQUE INDEX idx_vehicles_tenant_plate
  ON vehicles(tenant_id, plate_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_vehicles_tenant_chassis
  ON vehicles(tenant_id, chassis_number) WHERE deleted_at IS NULL AND chassis_number IS NOT NULL;
CREATE INDEX idx_vehicles_active
  ON vehicles(tenant_id, status, condition_status) WHERE deleted_at IS NULL;

-- Add FK from drivers.current_vehicle_id to vehicles(id)
ALTER TABLE drivers
  ADD CONSTRAINT drivers_current_vehicle_id_fkey
  FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id);

-- ═══ vehicle_documents table ═══
CREATE TABLE vehicle_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type          vehicle_document_type NOT NULL,
  doc_number        TEXT,
  issue_date        DATE,
  expiry_date       DATE,
  issuing_authority TEXT,
  file_url          TEXT NOT NULL,
  file_size_bytes   BIGINT,
  mime_type         TEXT,
  is_verified       BOOLEAN NOT NULL DEFAULT false,
  verified_by       UUID REFERENCES auth.users(id),
  verified_at       TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_vehicle_docs_active
  ON vehicle_documents(tenant_id, vehicle_id, doc_type, expiry_date)
  WHERE deleted_at IS NULL AND is_active = true;

-- ═══ vehicle_active_documents VIEW (v2.0 M2 correction) ═══
-- Scoring engine queries this view, NOT the base table. Ensures deleted/inactive
-- documents are never counted.
CREATE OR REPLACE VIEW vehicle_active_documents AS
SELECT * FROM vehicle_documents
WHERE deleted_at IS NULL AND is_active = true;

-- ═══ vehicle_odometer_logs table ═══
CREATE TABLE vehicle_odometer_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  vehicle_id    UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading       INTEGER NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by   UUID REFERENCES auth.users(id),
  source        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'gps' | 'obd' | 'import'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_odometer_logs_vehicle
  ON vehicle_odometer_logs(vehicle_id, recorded_at DESC) WHERE deleted_at IS NULL;

-- ═══ Odometer fraud triggers (v2.0 M2 correction) ═══
-- Block odometer readings that go backwards. Raises VEH003.
CREATE OR REPLACE FUNCTION prevent_odometer_regression()
RETURNS TRIGGER AS $$
DECLARE
  max_reading INTEGER;
BEGIN
  SELECT MAX(reading) INTO max_reading
  FROM vehicle_odometer_logs
  WHERE vehicle_id = NEW.vehicle_id
    AND id != NEW.id
    AND deleted_at IS NULL;

  IF max_reading IS NOT NULL AND NEW.reading < max_reading THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'VEH003',
        DETAIL = format(
          'Odometer reading (%s km) is lower than the highest recorded reading (%s km)',
          NEW.reading, max_reading
        );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER odometer_regression_check
BEFORE INSERT OR UPDATE ON vehicle_odometer_logs
FOR EACH ROW EXECUTE FUNCTION prevent_odometer_regression();

-- Also enforce on direct vehicle update
CREATE OR REPLACE FUNCTION prevent_vehicle_odometer_regression()
RETURNS TRIGGER AS $$
DECLARE
  max_log_reading INTEGER;
BEGIN
  SELECT MAX(reading) INTO max_log_reading
  FROM vehicle_odometer_logs
  WHERE vehicle_id = NEW.id AND deleted_at IS NULL;

  IF max_log_reading IS NOT NULL AND NEW.odometer_current < max_log_reading THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'VEH003',
        DETAIL = format('Odometer (%s) is lower than logged max (%s)', NEW.odometer_current, max_log_reading);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicle_odometer_regression_check
BEFORE UPDATE OF odometer_current ON vehicles
FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_odometer_regression();

-- ═══ updated_at triggers ═══
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vehicle_documents_updated_at BEFORE UPDATE ON vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ RLS ═══
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_odometer_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicles_select_own_tenant" ON vehicles
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vehicles_insert_own_tenant" ON vehicles
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicles_update_own_tenant" ON vehicles
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "vehicle_documents_select_own_tenant" ON vehicle_documents
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vehicle_documents_insert_own_tenant" ON vehicle_documents
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vehicle_documents_update_own_tenant" ON vehicle_documents
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "vehicle_odometer_logs_select_own_tenant" ON vehicle_odometer_logs
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vehicle_odometer_logs_insert_own_tenant" ON vehicle_odometer_logs
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
