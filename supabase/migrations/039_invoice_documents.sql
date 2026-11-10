-- =====================================================================
-- 039 — Financial Phase 6: Invoice documents (PDF / print / QR)
--
--   1. `generated_documents` (from 025) grows an `invoice_id` link and
--      relaxes `template_id` to nullable so invoice PDFs can be recorded
--      without a document-template row.
--   2. New private storage bucket `invoice-documents` with tenant-folder
--      RLS following the 011 pattern. Rendered files are stored as
--      `{tenant_id}/{doc_number}.html`; signed URLs are issued for access.
--
-- The QR embedded in the rendered HTML is a VERIFICATION QR generated
-- server-side with the `qrcode` package — NOT a ZATCA tax QR
-- (ZATCA-BOUNDARY.md §3). Its TLV payload fields are documented in
-- src/lib/accounting/invoice-qr.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. generated_documents: invoice link (template_id becomes optional)
-- ---------------------------------------------------------------------
ALTER TABLE generated_documents
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE generated_documents
  ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX idx_generated_docs_invoice
  ON generated_documents (tenant_id, invoice_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. invoice-documents storage bucket + tenant-folder RLS
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('invoice-documents', 'invoice-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_read_invoice_docs" ON storage.objects
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND bucket_id = 'invoice-documents'
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "storage_insert_invoice_docs" ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id = 'invoice-documents'
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "storage_update_invoice_docs" ON storage.objects
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND bucket_id = 'invoice-documents'
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id = 'invoice-documents'
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "storage_delete_invoice_docs" ON storage.objects
  FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND bucket_id = 'invoice-documents'
    AND (storage.foldername(name))[1] = (
      SELECT tenant_id::text FROM users WHERE auth_user_id = auth.uid()
    )
  );
