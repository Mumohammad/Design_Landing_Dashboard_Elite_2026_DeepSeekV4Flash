-- 020_orders_platforms.sql
-- Module 10: Platforms + Module 5: Orders
-- PostgreSQL-compatible version.
-- Partial UNIQUE constraints are implemented as standalone partial indexes.
-- Expression indexes use explicit parentheses around COALESCE expressions.

-- ═══ Delivery platforms ═══
CREATE TABLE delivery_platforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  brand_color     TEXT,
  logo_url        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  rate_type       TEXT NOT NULL DEFAULT 'flat'
                  CHECK (rate_type IN ('flat', 'distance_based', 'tiered', 'custom')),
  rate_per_order  NUMERIC(6,2),
  rate_card       JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_base_url    TEXT,
  api_credentials JSONB,
  sort_order      SMALLINT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_platform_rate CHECK (
    rate_per_order IS NULL OR rate_per_order >= 0
  )
);

CREATE UNIQUE INDEX idx_delivery_platforms_unique_code
  ON delivery_platforms (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_delivery_platforms_active
  ON delivery_platforms (tenant_id, is_active, sort_order)
  WHERE deleted_at IS NULL;

-- Requires drivers.primary_platform_id to exist in an earlier migration.
ALTER TABLE drivers
  ADD CONSTRAINT drivers_primary_platform_id_fkey
  FOREIGN KEY (primary_platform_id) REFERENCES delivery_platforms(id);

-- ═══ Daily order entries ═══
CREATE TABLE daily_order_entries (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id),
  driver_id                  UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  platform_id                UUID NOT NULL REFERENCES delivery_platforms(id),
  entry_date                 DATE NOT NULL,
  shift_label                TEXT,
  orders_delivered           INTEGER NOT NULL DEFAULT 0,
  orders_failed              INTEGER NOT NULL DEFAULT 0,
  orders_returned            INTEGER NOT NULL DEFAULT 0,
  orders_cancelled           INTEGER NOT NULL DEFAULT 0,
  total_distance_km          NUMERIC(8,2),
  avg_order_distance_km      NUMERIC(6,2),
  multi_order_batches        SMALLINT NOT NULL DEFAULT 0,
  gross_revenue              NUMERIC(10,2) NOT NULL DEFAULT 0,
  platform_reported_revenue  NUMERIC(10,2),
  revenue_variance           NUMERIC(10,2) GENERATED ALWAYS AS (
    gross_revenue - COALESCE(platform_reported_revenue, gross_revenue)
  ) STORED,
  notes                      TEXT,
  entry_source               TEXT NOT NULL DEFAULT 'manual'
                             CHECK (entry_source IN ('manual', 'import', 'api')),
  is_locked                  BOOLEAN NOT NULL DEFAULT false,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 UUID REFERENCES auth.users(id),
  updated_by                 UUID REFERENCES auth.users(id),
  deleted_at                 TIMESTAMPTZ,
  CONSTRAINT chk_daily_orders_delivered CHECK (orders_delivered >= 0),
  CONSTRAINT chk_daily_orders_failed CHECK (orders_failed >= 0),
  CONSTRAINT chk_daily_orders_returned CHECK (orders_returned >= 0),
  CONSTRAINT chk_daily_orders_cancelled CHECK (orders_cancelled >= 0),
  CONSTRAINT chk_daily_orders_batches CHECK (multi_order_batches >= 0),
  CONSTRAINT chk_daily_orders_distance CHECK (
    total_distance_km IS NULL OR total_distance_km >= 0
  ),
  CONSTRAINT chk_daily_orders_avg_distance CHECK (
    avg_order_distance_km IS NULL OR avg_order_distance_km >= 0
  ),
  CONSTRAINT chk_daily_orders_revenue CHECK (gross_revenue >= 0),
  CONSTRAINT chk_daily_orders_platform_revenue CHECK (
    platform_reported_revenue IS NULL OR platform_reported_revenue >= 0
  )
);

-- COALESCE makes NULL shift_label equivalent to 'full_day'.
CREATE UNIQUE INDEX idx_daily_order_entries_unique
  ON daily_order_entries (
    tenant_id,
    entry_date,
    driver_id,
    platform_id,
    (COALESCE(shift_label, 'full_day'))
  )
  WHERE deleted_at IS NULL;

CREATE INDEX idx_daily_order_entries_active
  ON daily_order_entries (tenant_id, entry_date, driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_daily_order_entries_period
  ON daily_order_entries (tenant_id, driver_id, entry_date DESC)
  WHERE deleted_at IS NULL;

-- ═══ Monthly driver orders ═══
CREATE TABLE monthly_driver_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  platform_id        UUID REFERENCES delivery_platforms(id),
  period_year        SMALLINT NOT NULL,
  period_month       SMALLINT NOT NULL,
  total_delivered    INTEGER NOT NULL DEFAULT 0,
  total_failed       INTEGER NOT NULL DEFAULT 0,
  total_returned     INTEGER NOT NULL DEFAULT 0,
  total_revenue      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_distance_km  NUMERIC(10,2) NOT NULL DEFAULT 0,
  working_days       SMALLINT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT chk_monthly_period_month CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_monthly_orders_delivered CHECK (total_delivered >= 0),
  CONSTRAINT chk_monthly_orders_failed CHECK (total_failed >= 0),
  CONSTRAINT chk_monthly_orders_returned CHECK (total_returned >= 0),
  CONSTRAINT chk_monthly_orders_revenue CHECK (total_revenue >= 0),
  CONSTRAINT chk_monthly_orders_distance CHECK (total_distance_km >= 0),
  CONSTRAINT chk_monthly_working_days CHECK (working_days >= 0)
);

-- COALESCE makes a NULL platform_id represent the driver's all-platform total.
CREATE UNIQUE INDEX idx_monthly_orders_unique
  ON monthly_driver_orders (
    tenant_id,
    driver_id,
    (COALESCE(platform_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    period_year,
    period_month
  )
  WHERE deleted_at IS NULL;

CREATE INDEX idx_monthly_orders_driver_period
  ON monthly_driver_orders (tenant_id, driver_id, period_year, period_month)
  WHERE deleted_at IS NULL;

-- ═══ Updated-at triggers ═══
CREATE TRIGGER trg_delivery_platforms_updated_at
  BEFORE UPDATE ON delivery_platforms FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_daily_order_entries_updated_at
  BEFORE UPDATE ON daily_order_entries FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_monthly_driver_orders_updated_at
  BEFORE UPDATE ON monthly_driver_orders FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══ Row-level security ═══
ALTER TABLE delivery_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_order_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_driver_orders ENABLE ROW LEVEL SECURITY;

-- Delivery platforms
CREATE POLICY platforms_sel ON delivery_platforms FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY platforms_ins ON delivery_platforms FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY platforms_upd ON delivery_platforms FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Daily orders
CREATE POLICY daily_orders_sel ON daily_order_entries FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY daily_orders_ins ON daily_order_entries FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY daily_orders_upd ON daily_order_entries FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Monthly orders
CREATE POLICY monthly_orders_sel ON monthly_driver_orders FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY monthly_orders_ins ON monthly_driver_orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY monthly_orders_upd ON monthly_driver_orders FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());