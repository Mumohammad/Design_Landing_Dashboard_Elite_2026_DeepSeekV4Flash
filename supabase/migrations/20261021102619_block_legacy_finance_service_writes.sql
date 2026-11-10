BEGIN;
-- Install this guard before the pending release migrations during cutover.
-- Old immutable deployments used independent service-role REST writes. Stop
-- those before their first source/AP/outbox mutation; do not infer or repair
-- historical state. Caller-bound SECURITY DEFINER transactions continue as
-- their owner. Keep table UPDATE grants: trusted ZATCA preparation uses source
-- SELECT FOR SHARE, which requires UPDATE privilege without mutating the row.
CREATE FUNCTION public.block_legacy_finance_service_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user='service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='FIN_LEGACY_WRITE: use the guarded finance workflow';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.block_legacy_finance_service_write() FROM PUBLIC,anon,authenticated,service_role;

-- Statement triggers also fail empty mutations before later row triggers.
-- Notes contain their immutable line snapshots in JSONB, not child tables.
CREATE TRIGGER aaa_block_legacy_service_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.invoices
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
CREATE TRIGGER aaa_block_legacy_service_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.invoice_lines
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
CREATE TRIGGER aaa_block_legacy_service_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.credit_notes
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
CREATE TRIGGER aaa_block_legacy_service_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.debit_notes
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
CREATE TRIGGER aaa_block_legacy_service_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.financial_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();

-- The old purchase approval inserted AP before changing its invoice. Blocking
-- headers alone would leave this orphan effect. Check both OLD and NEW to
-- prevent changing the source tag to escape the guard. Manual balances remain
-- compatible; guarded document, payment and expense functions run as owner.
CREATE FUNCTION public.block_legacy_document_balance_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_sources text[]:=CASE WHEN TG_TABLE_NAME='receivables'
  THEN ARRAY['invoice','debit_note'] ELSE ARRAY['purchase_invoice','expense'] END;
BEGIN
  IF current_user='service_role' AND (
    (TG_OP<>'INSERT' AND OLD.source_entity_type=ANY(v_sources)) OR
    (TG_OP<>'DELETE' AND NEW.source_entity_type=ANY(v_sources))) THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='FIN_LEGACY_WRITE: use the guarded finance workflow';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.block_legacy_document_balance_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aaa_block_legacy_document_balance_write BEFORE INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.block_legacy_document_balance_write();
CREATE TRIGGER aaa_block_legacy_document_balance_write BEFORE INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.block_legacy_document_balance_write();
-- TRUNCATE cannot inspect OLD/NEW and would erase managed balances as well.
CREATE TRIGGER aaa_block_legacy_service_truncate BEFORE TRUNCATE ON public.receivables
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
CREATE TRIGGER aaa_block_legacy_service_truncate BEFORE TRUNCATE ON public.payables
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_legacy_finance_service_write();
NOTIFY pgrst, 'reload schema';
COMMIT;
