BEGIN;

-- 1) Drop duplicate permissive {public} policies (they OR with the strict *_own_tenant policies;
--    the UPDATE variants had NO WITH CHECK -> allowed cross-tenant tenant_id reassignment)
DROP POLICY IF EXISTS "Users can view drivers from their tenant" ON public.drivers;
DROP POLICY IF EXISTS "Users can insert drivers to their tenant" ON public.drivers;
DROP POLICY IF EXISTS "Users can update drivers in their tenant" ON public.drivers;
DROP POLICY IF EXISTS "Users can view vehicles from their tenant" ON public.vehicles;
DROP POLICY IF EXISTS "Users can insert vehicles to their tenant" ON public.vehicles;
DROP POLICY IF EXISTS "Users can update vehicles in their tenant" ON public.vehicles;
DROP POLICY IF EXISTS "Users can view applications from their tenant" ON public.driver_applications;
DROP POLICY IF EXISTS "Users can insert applications to their tenant" ON public.driver_applications;
DROP POLICY IF EXISTS "Users can update applications in their tenant" ON public.driver_applications;

-- 2) Constrain anonymous application inserts to the default tenant (was: any tenant_id accepted)
DROP POLICY IF EXISTS driver_apps_anon_insert ON public.driver_applications;
CREATE POLICY driver_apps_anon_insert ON public.driver_applications
  FOR INSERT TO anon
  WITH CHECK (
    status = 'submitted'
    AND consent_terms = true
    AND consent_privacy = true
    AND tenant_id = get_default_tenant_id()
  );

-- 3) Pin search_path on all mutable functions (repo migration 061 was never applied here)
ALTER FUNCTION public.update_updated_at_column SET search_path = public, extensions;
ALTER FUNCTION public.prevent_audit_modification SET search_path = public, extensions;
ALTER FUNCTION public.sync_auth_user_to_custom_users SET search_path = public, extensions;
ALTER FUNCTION public.get_my_tenant_id SET search_path = public, extensions;
ALTER FUNCTION public.compute_driver_completeness SET search_path = public, extensions;
ALTER FUNCTION public.prevent_odometer_regression SET search_path = public, extensions;
ALTER FUNCTION public.prevent_vehicle_odometer_regression SET search_path = public, extensions;
ALTER FUNCTION public.prevent_posted_journal_mutation SET search_path = public, extensions;
ALTER FUNCTION public.block_posted_journal_delete SET search_path = public, extensions;
ALTER FUNCTION public.get_default_tenant_id SET search_path = public, extensions;
ALTER FUNCTION public.assign_application_number SET search_path = public, extensions;
ALTER FUNCTION public.invoice_number_assign SET search_path = public, extensions;
ALTER FUNCTION public.credit_note_number_assign SET search_path = public, extensions;
ALTER FUNCTION public.debit_note_number_assign SET search_path = public, extensions;
ALTER FUNCTION public.validate_invoice SET search_path = public, extensions;
ALTER FUNCTION public.protect_finalized_invoice SET search_path = public, extensions;
ALTER FUNCTION public.protect_invoice_lines SET search_path = public, extensions;
ALTER FUNCTION public.protect_credit_notes SET search_path = public, extensions;
ALTER FUNCTION public.protect_debit_notes SET search_path = public, extensions;
ALTER FUNCTION public.guard_payment_allocation SET search_path = public, extensions;
ALTER FUNCTION public.enforce_payment_alloc_totals SET search_path = public, extensions;
ALTER FUNCTION public.assign_application_status_token SET search_path = public, extensions;
ALTER FUNCTION public.assign_generated_doc_verify_token SET search_path = public, extensions;
ALTER FUNCTION public.cleanup_lookup_rate_limits SET search_path = public, extensions;

-- 4) Revoke EXECUTE from anon on internal SECURITY DEFINER functions (still callable by authenticated/triggers)
REVOKE EXECUTE ON FUNCTION public.compute_driver_completeness(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_user_self_escalation() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_auth_user_to_custom_users() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_chart_account() FROM anon;

-- 5) Add missing tenant_id FK indexes flagged by advisors (RLS lookup performance)
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_id ON public.bank_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_tenant_id ON public.bank_reconciliations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_id ON public.bank_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_tenant_id ON public.finance_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant_id ON public.invoice_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_tenant_id ON public.journal_entry_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_tenant_id ON public.payment_allocations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_tenant_id ON public.vehicle_odometer_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON public.tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id ON public.user_role_assignments(user_id);

COMMIT;
