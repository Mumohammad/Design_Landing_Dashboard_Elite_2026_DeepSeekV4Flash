-- 011_storage_buckets.sql
-- All 9 storage buckets + storage RLS policies.
-- Source: docs/phase-2-schema-plan.md section 9

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('driver-photos', 'driver-photos', false, 5242880),
  ('driver-documents', 'driver-documents', false, 20971520),
  ('vehicle-photos', 'vehicle-photos', false, 10485760),
  ('vehicle-documents', 'vehicle-documents', false, 20971520),
  ('violation-evidence', 'violation-evidence', false, 52428800),
  ('company-assets', 'company-assets', true, 5242880),
  ('generated-reports', 'generated-reports', false, 104857600),
  ('payroll-payslips', 'payroll-payslips', false, 10485760),
  ('import-files', 'import-files', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated read own tenant files
CREATE POLICY "storage_read_own_tenant" ON storage.objects
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND bucket_id IN ('driver-photos', 'driver-documents', 'vehicle-photos', 'vehicle-documents', 'violation-evidence', 'company-assets', 'generated-reports', 'payroll-payslips', 'import-files')
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );

-- company-assets is public — allow SELECT without tenant check
CREATE POLICY "storage_read_public_assets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'company-assets');

-- Authenticated users can upload to their tenant folder
CREATE POLICY "storage_insert_own_tenant" ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id IN ('driver-photos', 'driver-documents', 'vehicle-photos', 'vehicle-documents', 'violation-evidence', 'generated-reports', 'payroll-payslips', 'import-files')
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );
