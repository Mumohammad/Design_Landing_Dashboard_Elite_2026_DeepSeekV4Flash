-- One ZATCA transmission per source document. The original key
-- (tenant_id, invoice_id, doc_type) stored credit/debit notes under their
-- reference invoice, so a second credit note against the same invoice was
-- treated as "already reported" and never transmitted (a VAT reporting gap).
ALTER TABLE public.zatca_transmissions ADD COLUMN IF NOT EXISTS source_id uuid;

UPDATE public.zatca_transmissions t SET source_id = t.invoice_id
WHERE t.source_id IS NULL AND t.doc_type = 'invoice';

UPDATE public.zatca_transmissions t SET source_id = n.id
FROM public.credit_notes n
WHERE t.source_id IS NULL AND t.doc_type = 'credit_note'
  AND n.tenant_id = t.tenant_id AND n.reference_invoice_id = t.invoice_id
  AND n.credit_note_number = t.doc_ref;

UPDATE public.zatca_transmissions t SET source_id = n.id
FROM public.debit_notes n
WHERE t.source_id IS NULL AND t.doc_type = 'debit_note'
  AND n.tenant_id = t.tenant_id AND n.reference_invoice_id = t.invoice_id
  AND n.debit_note_number = t.doc_ref;

-- Unmatched legacy rows keep their previous identity (the invoice id) so the
-- new key never collides with them.
UPDATE public.zatca_transmissions SET source_id = invoice_id WHERE source_id IS NULL;

ALTER TABLE public.zatca_transmissions ALTER COLUMN source_id SET NOT NULL;
DROP INDEX IF EXISTS public.idx_zatca_transmissions_tenant_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zatca_transmissions_tenant_source
  ON public.zatca_transmissions(tenant_id, doc_type, source_id);

NOTIFY pgrst, 'reload schema';
