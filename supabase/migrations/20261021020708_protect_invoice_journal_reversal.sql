BEGIN;
-- Invoice, purchase invoice and note journals cannot be reversed independently
-- of their AR/AP and VAT effects. Preserve manual/opening journal reversals.
-- Lock the source row so simultaneous generic reversals cannot both succeed.
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_tenant_id       UUID,
  p_entry_id        UUID,
  p_description_ar  TEXT,
  p_description_en  TEXT DEFAULT NULL,
  p_reversal_date   DATE DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_entry_ref TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entry        public.journal_entries%ROWTYPE;
  v_period_id    UUID;
  v_rev_date     DATE;
  v_new_id       UUID;
  v_new_ref      TEXT;
BEGIN
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant';
  END IF;
  IF v_entry.status <> 'posted' THEN
    RAISE EXCEPTION 'JRN012: only posted journal entries can be reversed';
  END IF;
  IF v_entry.reversed_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'JRN011: journal entry is already reversed';
  END IF;

  -- The invoice/note lifecycle owns AR/AP and VAT as well as the journal.
  -- A generic reversal would change only the GL, leaving those effects intact.
  -- Follow historical generic reversals too: their source tag is only
  -- journal_reversal, so ownership comes from the original source chain.
  -- A visited path bounds corrupt/cyclic historical links; tenant boundaries
  -- are retained for every ancestor. The legacy invoice type is also protected.
  IF EXISTS (
    WITH RECURSIVE source_chain AS (
      SELECT id, entry_type, source_entity_type, reversal_of_entry_id, ARRAY[id] AS visited
      FROM public.journal_entries
      WHERE id = v_entry.id AND tenant_id = p_tenant_id
      UNION ALL
      SELECT ancestor.id, ancestor.entry_type, ancestor.source_entity_type,
        ancestor.reversal_of_entry_id, chain.visited || ancestor.id
      FROM public.journal_entries ancestor
      JOIN source_chain chain ON ancestor.id = chain.reversal_of_entry_id
      WHERE ancestor.tenant_id = p_tenant_id AND NOT ancestor.id = ANY(chain.visited)
    )
    SELECT 1 FROM source_chain
    WHERE entry_type = 'invoice'
      OR source_entity_type IN ('invoice', 'purchase_invoice', 'credit_note', 'debit_note')
  ) THEN
    RAISE EXCEPTION 'JRN015: invoice and note journals must be corrected through the invoice lifecycle';
  END IF;

  v_rev_date := COALESCE(p_reversal_date, v_entry.entry_date);
  v_period_id := public.get_or_create_period(p_tenant_id, v_rev_date);

  -- New reversed entry (negated lines).
  INSERT INTO public.journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, reversal_of_entry_id,
     posted_at, posted_by, created_by)
  VALUES
    (p_tenant_id, v_rev_date, v_period_id, 'reversal', 'posted',
     COALESCE(p_description_ar, 'عكس القيد ' || v_entry.entry_ref),
     COALESCE(p_description_en, 'Reversal of ' || v_entry.entry_ref),
     'accounting', 'journal_reversal', v_entry.id,
     now(), p_created_by, p_created_by)
  RETURNING id, entry_ref INTO v_new_id, v_new_ref;

  INSERT INTO public.journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  SELECT
    p_tenant_id,
    v_new_id,
    account_id,
    description,
    credit_amount,  -- swap: credit becomes debit
    debit_amount    -- swap: debit becomes credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = p_entry_id AND tenant_id = p_tenant_id;

  -- Mark the original reversed (immutability trigger allows posted → reversed).
  UPDATE public.journal_entries
    SET status = 'reversed',
        reversed_entry_id = v_new_id,
        updated_by = p_created_by
  WHERE id = p_entry_id;

  out_entry_id  := v_new_id;
  out_entry_ref := v_new_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(UUID, UUID, TEXT, TEXT, DATE, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, UUID, TEXT, TEXT, DATE, UUID) TO service_role;
COMMIT;