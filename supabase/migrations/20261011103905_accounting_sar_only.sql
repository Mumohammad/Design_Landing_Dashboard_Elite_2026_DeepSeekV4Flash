-- The ledger has no foreign-exchange conversion engine; restrict new writes to SAR.
-- NOT VALID preserves existing foreign-currency rows without relabeling them;
-- all subsequent writes must be SAR. Existing FX rows need manual disposition.
CREATE OR REPLACE FUNCTION public.guard_legacy_foreign_currency() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  IF OLD.currency <> 'SAR' AND NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'ACC_CURRENCY: legacy foreign currency requires explicit migration review';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts','invoices','credit_notes','debit_notes','expenses'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass
      AND conname = 'accounting_currency_sar_only') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT accounting_currency_sar_only CHECK (currency = ''SAR'') NOT VALID',t);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS guard_legacy_foreign_currency ON public.%I',t);
    EXECUTE format('CREATE TRIGGER guard_legacy_foreign_currency BEFORE UPDATE OF currency ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_foreign_currency()',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_sar_payment_bank() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.bank_accounts WHERE id = NEW.bank_account_id AND currency <> 'SAR') THEN
    RAISE EXCEPTION 'ACC_CURRENCY: accounting supports SAR only';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_sar_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.receivables r JOIN public.invoices i ON i.id = r.source_entity_id
    AND i.tenant_id = r.tenant_id WHERE r.id = NEW.receivable_id AND r.source_entity_type = 'invoice' AND i.currency <> 'SAR')
    OR EXISTS (SELECT 1 FROM public.payables p JOIN public.invoices i ON i.id = p.source_entity_id
    AND i.tenant_id = p.tenant_id WHERE p.id = NEW.payable_id AND p.source_entity_type IN ('invoice','purchase_invoice') AND i.currency <> 'SAR') THEN
    RAISE EXCEPTION 'ACC_CURRENCY: accounting supports SAR only';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_sar_note_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = NEW.reference_invoice_id
    AND tenant_id = NEW.tenant_id AND currency = 'SAR') THEN
    RAISE EXCEPTION 'ACC_CURRENCY: note requires a SAR invoice in the same tenant';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_sar_payment_bank ON public.finance_payments;
CREATE TRIGGER guard_sar_payment_bank BEFORE INSERT OR UPDATE ON public.finance_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_sar_payment_bank();
DROP TRIGGER IF EXISTS guard_sar_allocation ON public.payment_allocations;
CREATE TRIGGER guard_sar_allocation BEFORE INSERT OR UPDATE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_sar_allocation();
DROP TRIGGER IF EXISTS guard_sar_note_reference ON public.credit_notes;
CREATE TRIGGER guard_sar_note_reference BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_sar_note_reference();
DROP TRIGGER IF EXISTS guard_sar_note_reference ON public.debit_notes;
CREATE TRIGGER guard_sar_note_reference BEFORE INSERT ON public.debit_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_sar_note_reference();
REVOKE ALL ON FUNCTION public.guard_sar_payment_bank(),public.guard_sar_allocation(),public.guard_sar_note_reference(),public.guard_legacy_foreign_currency() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_sar_payment_bank(),public.guard_sar_allocation(),public.guard_sar_note_reference(),public.guard_legacy_foreign_currency() TO service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conname = 'accounting_currency_sar_only'
    AND conrelid IN ('public.bank_accounts'::regclass,'public.invoices'::regclass,
      'public.credit_notes'::regclass,'public.debit_notes'::regclass,'public.expenses'::regclass)) <> 5 THEN
    RAISE EXCEPTION 'SAR-only constraint postcondition failed';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
