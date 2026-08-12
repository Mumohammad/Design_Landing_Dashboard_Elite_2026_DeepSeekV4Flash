-- 025_templates.sql
-- Module 13: Document templates and generated documents.
-- PostgreSQL-compatible version.
-- Partial UNIQUE constraints are implemented as standalone partial indexes.

-- ═══ Enums ═══
CREATE TYPE template_category AS ENUM ('vehicle', 'gear', 'hr', 'operations');
CREATE TYPE doc_generation_status AS ENUM ('draft', 'generated', 'printed', 'archived');

-- ═══ Document templates ═══
CREATE TABLE document_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code            TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT,
  category        template_category NOT NULL,
  description     TEXT,
  template_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_document_template_fields_object CHECK (
    jsonb_typeof(template_fields) IN ('array', 'object')
  )
);

CREATE UNIQUE INDEX idx_doc_templates_unique_code
  ON document_templates (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_doc_templates_active
  ON document_templates (tenant_id, category, is_active)
  WHERE deleted_at IS NULL;

-- ═══ Generated documents ═══
CREATE TABLE generated_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  doc_number      TEXT NOT NULL UNIQUE,
  template_id     UUID NOT NULL REFERENCES document_templates(id),
  driver_id       UUID REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id      UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  generated_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_url        TEXT,
  qr_code_url     TEXT,
  verify_url      TEXT,
  status          doc_generation_status NOT NULL DEFAULT 'generated',
  generated_by    UUID REFERENCES auth.users(id),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at      TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_generated_data_object CHECK (
    jsonb_typeof(generated_data) = 'object'
  )
);

CREATE INDEX idx_generated_docs_tenant
  ON generated_documents (tenant_id, generated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_generated_docs_driver
  ON generated_documents (tenant_id, driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_generated_docs_template
  ON generated_documents (tenant_id, template_id)
  WHERE deleted_at IS NULL;

-- ═══ Updated-at triggers ═══
CREATE TRIGGER trg_doc_templates_updated_at
  BEFORE UPDATE ON document_templates FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_generated_docs_updated_at
  BEFORE UPDATE ON generated_documents FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══ Row-level security ═══
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;

-- Document templates
CREATE POLICY doc_templates_sel ON document_templates FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY doc_templates_ins ON document_templates FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY doc_templates_upd ON document_templates FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Generated documents
CREATE POLICY generated_docs_sel ON generated_documents FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY generated_docs_ins ON generated_documents FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY generated_docs_upd ON generated_documents FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());