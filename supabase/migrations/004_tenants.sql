-- 004_tenants.sql
CREATE TABLE tenants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  legal_name     TEXT,
  cr_number      TEXT,
  vat_number     TEXT,
  address        TEXT,
  city           TEXT,
  region         TEXT,
  country        TEXT NOT NULL DEFAULT 'SA',
  phone          TEXT,
  email          TEXT,
  logo_url       TEXT,
  status         tenant_status NOT NULL DEFAULT 'active',
  plan           tenant_plan   NOT NULL DEFAULT 'single_tenant',
  default_locale TEXT NOT NULL DEFAULT 'ar',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_tenants_cr_number  ON tenants(cr_number)  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_tenants_vat_number ON tenants(vat_number) WHERE deleted_at IS NULL;
