-- ============================================================================
-- FK Covering Indexes — production perf hardening (Prompt J)
-- (20260929000000_fk_covering_indexes.sql)
--
-- The Supabase FK audit (2026-09-29, prod wwfnsbilmyxeawgzicmv) found 282
-- foreign-key constraints with no supporting index; the same audit query
-- against a fresh local rebuild of THIS repo reports 288 (small drift —
-- the repo is the schema source of truth). Unindexed FKs slow joins and
-- force long lock waits on cascading deletes/updates of parent rows as
-- data grows.
--
-- Scope: INDEXES ONLY — no schema changes, no constraint changes, no data
-- statements, no DROP/ALTER. One plain CREATE INDEX IF NOT EXISTS per gap,
-- generated programmatically from the repo's own catalog (audit query +
-- conkey/ordinality column resolution; composite FKs would get constraint-
-- ordered composite indexes — the audit found none, all single-column).
--
-- Indexes are non-partial on purpose: a partial index (e.g. WHERE
-- deleted_at IS NULL) does NOT satisfy the audit's i.indpred IS NULL
-- predicate and, worse, leaves ON DELETE CASCADE proof scans on the rows
-- partial indexes exclude. Plain btree per FK column set.
--
-- Naming: idx_<table>_<first_fk_col> (prompt rule). Zero collisions with
-- pre-existing index names (verified via pg_indexes diff), zero intra-batch
-- duplicates, max identifier 52 chars (limit 63).
--
-- Concurrency note (ZTD): plain CREATE INDEX (non-CONCURRENTLY) — supabase
-- db push runs inside a transaction where CONCURRENTLY cannot run. On the
-- empty/staging stage this is instant; on prod the push is queued by the #54
-- workflow (concurrency group db-push-master, cancel-in-progress:false) and
-- per-index AccessExclusive locks are brief; prefer a low-traffic window.
--
-- Skipped FKs (9) — lookup/type tables with 100% tiny-table certainty
-- (the prompt's judgment-call list):
--   delivery_platforms: tenant_id, created_by, updated_by
--   leave_types:        tenant_id, created_by, updated_by
--   violation_types:    tenant_id, created_by, updated_by
--   report_job_status:  no unindexed FKs found (in the skip set, zero-gap)
--   expense_category_mappings: no unindexed FKs found (zero-gap)
--
-- Rollback (forward-only repo, notes only):
--   DROP INDEX IF EXISTS public.idx_<table>_<col>;  -- for each of the 279 below
-- ============================================================================

-- accounting_periods
CREATE INDEX IF NOT EXISTS idx_accounting_periods_closed_by ON public.accounting_periods (closed_by);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_created_by ON public.accounting_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_opened_by ON public.accounting_periods (opened_by);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_updated_by ON public.accounting_periods (updated_by);

-- attendance_periods
CREATE INDEX IF NOT EXISTS idx_attendance_periods_created_by ON public.attendance_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_attendance_periods_locked_by ON public.attendance_periods (locked_by);
CREATE INDEX IF NOT EXISTS idx_attendance_periods_updated_by ON public.attendance_periods (updated_by);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON public.audit_log (actor_id);

-- bank_accounts
CREATE INDEX IF NOT EXISTS idx_bank_accounts_created_by ON public.bank_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant_id ON public.bank_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_updated_by ON public.bank_accounts (updated_by);

-- bank_reconciliations
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_bank_account_id ON public.bank_reconciliations (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_created_by ON public.bank_reconciliations (created_by);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_reconciled_by ON public.bank_reconciliations (reconciled_by);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_tenant_id ON public.bank_reconciliations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_updated_by ON public.bank_reconciliations (updated_by);

-- bank_transactions
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account_id ON public.bank_transactions (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_created_by ON public.bank_transactions (created_by);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciliation_id ON public.bank_transactions (reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_id ON public.bank_transactions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_updated_by ON public.bank_transactions (updated_by);

-- chart_of_accounts
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_created_by ON public.chart_of_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent_id ON public.chart_of_accounts (parent_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant_id ON public.chart_of_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_updated_by ON public.chart_of_accounts (updated_by);

-- credit_notes
CREATE INDEX IF NOT EXISTS idx_credit_notes_created_by ON public.credit_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer_id ON public.credit_notes (customer_id);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON public.customers (created_by);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON public.customers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated_by ON public.customers (updated_by);

-- daily_order_entries
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_created_by ON public.daily_order_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_driver_id ON public.daily_order_entries (driver_id);
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_platform_id ON public.daily_order_entries (platform_id);
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_tenant_id ON public.daily_order_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_updated_by ON public.daily_order_entries (updated_by);

-- debit_notes
CREATE INDEX IF NOT EXISTS idx_debit_notes_created_by ON public.debit_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_debit_notes_customer_id ON public.debit_notes (customer_id);

-- document_templates
CREATE INDEX IF NOT EXISTS idx_document_templates_created_by ON public.document_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_document_templates_tenant_id ON public.document_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_updated_by ON public.document_templates (updated_by);

-- driver_application_documents
CREATE INDEX IF NOT EXISTS idx_driver_application_documents_created_by ON public.driver_application_documents (created_by);

-- driver_applications
CREATE INDEX IF NOT EXISTS idx_driver_applications_reviewed_by ON public.driver_applications (reviewed_by);

-- driver_attendance
CREATE INDEX IF NOT EXISTS idx_driver_attendance_created_by ON public.driver_attendance (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_attendance_driver_id ON public.driver_attendance (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_attendance_schedule_id ON public.driver_attendance (schedule_id);
CREATE INDEX IF NOT EXISTS idx_driver_attendance_updated_by ON public.driver_attendance (updated_by);

-- driver_attendance_summary
CREATE INDEX IF NOT EXISTS idx_driver_attendance_summary_created_by ON public.driver_attendance_summary (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_attendance_summary_driver_id ON public.driver_attendance_summary (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_attendance_summary_updated_by ON public.driver_attendance_summary (updated_by);

-- driver_calendar_events
CREATE INDEX IF NOT EXISTS idx_driver_calendar_events_vehicle_id ON public.driver_calendar_events (vehicle_id);

-- driver_cards
CREATE INDEX IF NOT EXISTS idx_driver_cards_generated_document_id ON public.driver_cards (generated_document_id);

-- driver_cod_sessions
CREATE INDEX IF NOT EXISTS idx_driver_cod_sessions_created_by ON public.driver_cod_sessions (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_cod_sessions_driver_id ON public.driver_cod_sessions (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_cod_sessions_reconciled_by ON public.driver_cod_sessions (reconciled_by);
CREATE INDEX IF NOT EXISTS idx_driver_cod_sessions_updated_by ON public.driver_cod_sessions (updated_by);

-- driver_documents
CREATE INDEX IF NOT EXISTS idx_driver_documents_created_by ON public.driver_documents (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_id ON public.driver_documents (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_tenant_id ON public.driver_documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_updated_by ON public.driver_documents (updated_by);
CREATE INDEX IF NOT EXISTS idx_driver_documents_verified_by ON public.driver_documents (verified_by);

-- driver_emergency_contacts
CREATE INDEX IF NOT EXISTS idx_driver_emergency_contacts_created_by ON public.driver_emergency_contacts (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_emergency_contacts_driver_id ON public.driver_emergency_contacts (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_emergency_contacts_tenant_id ON public.driver_emergency_contacts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_emergency_contacts_updated_by ON public.driver_emergency_contacts (updated_by);

-- driver_leave_balances
CREATE INDEX IF NOT EXISTS idx_driver_leave_balances_created_by ON public.driver_leave_balances (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_leave_balances_driver_id ON public.driver_leave_balances (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_balances_leave_type_id ON public.driver_leave_balances (leave_type_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_balances_tenant_id ON public.driver_leave_balances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_balances_updated_by ON public.driver_leave_balances (updated_by);

-- driver_leave_requests
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_created_by ON public.driver_leave_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_driver_id ON public.driver_leave_requests (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_leave_type_id ON public.driver_leave_requests (leave_type_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_requested_by ON public.driver_leave_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_reviewed_by ON public.driver_leave_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_tenant_id ON public.driver_leave_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_leave_requests_updated_by ON public.driver_leave_requests (updated_by);

-- driver_onboarding_checklists
CREATE INDEX IF NOT EXISTS idx_driver_onboarding_checklists_completed_by ON public.driver_onboarding_checklists (completed_by);
CREATE INDEX IF NOT EXISTS idx_driver_onboarding_checklists_created_by ON public.driver_onboarding_checklists (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_onboarding_checklists_driver_id ON public.driver_onboarding_checklists (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_onboarding_checklists_tenant_id ON public.driver_onboarding_checklists (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_onboarding_checklists_updated_by ON public.driver_onboarding_checklists (updated_by);

-- driver_payroll_periods
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_approved_by ON public.driver_payroll_periods (approved_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_calculated_by ON public.driver_payroll_periods (calculated_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_cancelled_by ON public.driver_payroll_periods (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_created_by ON public.driver_payroll_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_driver_id ON public.driver_payroll_periods (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_locked_by ON public.driver_payroll_periods (locked_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_manual_override_by ON public.driver_payroll_periods (manual_override_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_paid_by ON public.driver_payroll_periods (paid_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_payroll_rule_id ON public.driver_payroll_periods (payroll_rule_id);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_periods_updated_by ON public.driver_payroll_periods (updated_by);

-- driver_payroll_rules
CREATE INDEX IF NOT EXISTS idx_driver_payroll_rules_created_by ON public.driver_payroll_rules (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_rules_driver_id ON public.driver_payroll_rules (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_rules_tenant_id ON public.driver_payroll_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_rules_updated_by ON public.driver_payroll_rules (updated_by);

-- driver_salary_history
CREATE INDEX IF NOT EXISTS idx_driver_salary_history_approved_by ON public.driver_salary_history (approved_by);
CREATE INDEX IF NOT EXISTS idx_driver_salary_history_created_by ON public.driver_salary_history (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_salary_history_driver_id ON public.driver_salary_history (driver_id);

-- driver_work_schedules
CREATE INDEX IF NOT EXISTS idx_driver_work_schedules_created_by ON public.driver_work_schedules (created_by);
CREATE INDEX IF NOT EXISTS idx_driver_work_schedules_driver_id ON public.driver_work_schedules (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_work_schedules_tenant_id ON public.driver_work_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_work_schedules_updated_by ON public.driver_work_schedules (updated_by);

-- drivers
CREATE INDEX IF NOT EXISTS idx_drivers_created_by ON public.drivers (created_by);
CREATE INDEX IF NOT EXISTS idx_drivers_current_vehicle_id ON public.drivers (current_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_drivers_primary_platform_id ON public.drivers (primary_platform_id);
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_id ON public.drivers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_drivers_updated_by ON public.drivers (updated_by);

-- expenses
CREATE INDEX IF NOT EXISTS idx_expenses_approved_by ON public.expenses (approved_by);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_driver_id ON public.expenses (driver_id);
CREATE INDEX IF NOT EXISTS idx_expenses_platform_id ON public.expenses (platform_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON public.expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_by ON public.expenses (updated_by);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle_id ON public.expenses (vehicle_id);

-- external_fine_imports
CREATE INDEX IF NOT EXISTS idx_external_fine_imports_created_by ON public.external_fine_imports (created_by);
CREATE INDEX IF NOT EXISTS idx_external_fine_imports_matched_by ON public.external_fine_imports (matched_by);
CREATE INDEX IF NOT EXISTS idx_external_fine_imports_matched_driver_id ON public.external_fine_imports (matched_driver_id);
CREATE INDEX IF NOT EXISTS idx_external_fine_imports_matched_vehicle_id ON public.external_fine_imports (matched_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_external_fine_imports_violation_id ON public.external_fine_imports (violation_id);

-- finance_payments
CREATE INDEX IF NOT EXISTS idx_finance_payments_bank_account_id ON public.finance_payments (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_created_by ON public.finance_payments (created_by);
CREATE INDEX IF NOT EXISTS idx_finance_payments_customer_id ON public.finance_payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_supplier_id ON public.finance_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_tenant_id ON public.finance_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_updated_by ON public.finance_payments (updated_by);

-- generated_documents
CREATE INDEX IF NOT EXISTS idx_generated_documents_created_by ON public.generated_documents (created_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_driver_id ON public.generated_documents (driver_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_generated_by ON public.generated_documents (generated_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_invoice_id ON public.generated_documents (invoice_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_template_id ON public.generated_documents (template_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant_id ON public.generated_documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_updated_by ON public.generated_documents (updated_by);
CREATE INDEX IF NOT EXISTS idx_generated_documents_vehicle_id ON public.generated_documents (vehicle_id);

-- invites
CREATE INDEX IF NOT EXISTS idx_invites_accepted_by ON public.invites (accepted_by);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON public.invites (created_by);
CREATE INDEX IF NOT EXISTS idx_invites_invited_by ON public.invites (invited_by);
CREATE INDEX IF NOT EXISTS idx_invites_tenant_id ON public.invites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invites_updated_by ON public.invites (updated_by);

-- invoice_lines
CREATE INDEX IF NOT EXISTS idx_invoice_lines_created_by ON public.invoice_lines (created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant_id ON public.invoice_lines (tenant_id);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_cancelled_by ON public.invoices (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_finalized_by ON public.invoices (finalized_by);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON public.invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON public.invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_updated_by ON public.invoices (updated_by);

-- journal_approvals
CREATE INDEX IF NOT EXISTS idx_journal_approvals_approved_by ON public.journal_approvals (approved_by);
CREATE INDEX IF NOT EXISTS idx_journal_approvals_rejected_by ON public.journal_approvals (rejected_by);
CREATE INDEX IF NOT EXISTS idx_journal_approvals_submitted_by ON public.journal_approvals (submitted_by);
CREATE INDEX IF NOT EXISTS idx_journal_approvals_tenant_id ON public.journal_approvals (tenant_id);

-- journal_entries
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON public.journal_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period_id ON public.journal_entries (period_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_by ON public.journal_entries (posted_by);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of_entry_id ON public.journal_entries (reversal_of_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversed_entry_id ON public.journal_entries (reversed_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_id ON public.journal_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_updated_by ON public.journal_entries (updated_by);

-- journal_entry_lines
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_tenant_id ON public.journal_entry_lines (tenant_id);

-- monthly_driver_orders
CREATE INDEX IF NOT EXISTS idx_monthly_driver_orders_created_by ON public.monthly_driver_orders (created_by);
CREATE INDEX IF NOT EXISTS idx_monthly_driver_orders_driver_id ON public.monthly_driver_orders (driver_id);
CREATE INDEX IF NOT EXISTS idx_monthly_driver_orders_updated_by ON public.monthly_driver_orders (updated_by);

-- payables
CREATE INDEX IF NOT EXISTS idx_payables_created_by ON public.payables (created_by);
CREATE INDEX IF NOT EXISTS idx_payables_supplier_id ON public.payables (supplier_id);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_id ON public.payables (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payables_updated_by ON public.payables (updated_by);

-- payment_allocations
CREATE INDEX IF NOT EXISTS idx_payment_allocations_allocated_by ON public.payment_allocations (allocated_by);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payable_id ON public.payment_allocations (payable_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_receivable_id ON public.payment_allocations (receivable_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_tenant_id ON public.payment_allocations (tenant_id);

-- payroll_advances
CREATE INDEX IF NOT EXISTS idx_payroll_advances_approved_by ON public.payroll_advances (approved_by);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_created_by ON public.payroll_advances (created_by);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_driver_id ON public.payroll_advances (driver_id);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_tenant_id ON public.payroll_advances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_updated_by ON public.payroll_advances (updated_by);

-- payroll_journal_entries
CREATE INDEX IF NOT EXISTS idx_payroll_journal_entries_created_by ON public.payroll_journal_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_payroll_journal_entries_payroll_period_id ON public.payroll_journal_entries (payroll_period_id);

-- performance_reviews
CREATE INDEX IF NOT EXISTS idx_performance_reviews_created_by ON public.performance_reviews (created_by);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_driver_id ON public.performance_reviews (driver_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_reviewer_id ON public.performance_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_tenant_id ON public.performance_reviews (tenant_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_updated_by ON public.performance_reviews (updated_by);

-- platform_payments
CREATE INDEX IF NOT EXISTS idx_platform_payments_created_by ON public.platform_payments (created_by);
CREATE INDEX IF NOT EXISTS idx_platform_payments_platform_id ON public.platform_payments (platform_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_tenant_id ON public.platform_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_updated_by ON public.platform_payments (updated_by);

-- public_holidays
CREATE INDEX IF NOT EXISTS idx_public_holidays_created_by ON public.public_holidays (created_by);

-- receivables
CREATE INDEX IF NOT EXISTS idx_receivables_created_by ON public.receivables (created_by);
CREATE INDEX IF NOT EXISTS idx_receivables_customer_id ON public.receivables (customer_id);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_id ON public.receivables (tenant_id);
CREATE INDEX IF NOT EXISTS idx_receivables_updated_by ON public.receivables (updated_by);

-- report_generation_log
CREATE INDEX IF NOT EXISTS idx_report_generation_log_generated_by ON public.report_generation_log (generated_by);

-- role_permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_created_by ON public.role_permissions (created_by);

-- roles
CREATE INDEX IF NOT EXISTS idx_roles_created_by ON public.roles (created_by);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON public.roles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_updated_by ON public.roles (updated_by);

-- suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by ON public.suppliers (created_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_id ON public.suppliers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by ON public.suppliers (updated_by);

-- system_settings
CREATE INDEX IF NOT EXISTS idx_system_settings_created_by ON public.system_settings (created_by);
CREATE INDEX IF NOT EXISTS idx_system_settings_tenant_id ON public.system_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by ON public.system_settings (updated_by);

-- tenant_memberships
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_created_by ON public.tenant_memberships (created_by);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON public.tenant_memberships (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_updated_by ON public.tenant_memberships (updated_by);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON public.tenant_memberships (user_id);

-- tenants
CREATE INDEX IF NOT EXISTS idx_tenants_created_by ON public.tenants (created_by);
CREATE INDEX IF NOT EXISTS idx_tenants_updated_by ON public.tenants (updated_by);

-- training_records
CREATE INDEX IF NOT EXISTS idx_training_records_created_by ON public.training_records (created_by);
CREATE INDEX IF NOT EXISTS idx_training_records_driver_id ON public.training_records (driver_id);
CREATE INDEX IF NOT EXISTS idx_training_records_tenant_id ON public.training_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_records_updated_by ON public.training_records (updated_by);

-- user_role_assignments
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_assigned_by ON public.user_role_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_created_by ON public.user_role_assignments (created_by);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_role_id ON public.user_role_assignments (role_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_tenant_id ON public.user_role_assignments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_updated_by ON public.user_role_assignments (updated_by);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id ON public.user_role_assignments (user_id);

-- users
CREATE INDEX IF NOT EXISTS idx_users_created_by ON public.users (created_by);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON public.users (invited_by);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_updated_by ON public.users (updated_by);

-- vat_adjustments
CREATE INDEX IF NOT EXISTS idx_vat_adjustments_created_by ON public.vat_adjustments (created_by);
CREATE INDEX IF NOT EXISTS idx_vat_adjustments_finalized_by ON public.vat_adjustments (finalized_by);
CREATE INDEX IF NOT EXISTS idx_vat_adjustments_tenant_id ON public.vat_adjustments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vat_adjustments_updated_by ON public.vat_adjustments (updated_by);

-- vat_input_ledger
CREATE INDEX IF NOT EXISTS idx_vat_input_ledger_created_by ON public.vat_input_ledger (created_by);
CREATE INDEX IF NOT EXISTS idx_vat_input_ledger_supplier_id ON public.vat_input_ledger (supplier_id);

-- vat_output_ledger
CREATE INDEX IF NOT EXISTS idx_vat_output_ledger_created_by ON public.vat_output_ledger (created_by);
CREATE INDEX IF NOT EXISTS idx_vat_output_ledger_customer_id ON public.vat_output_ledger (customer_id);

-- vat_periods
CREATE INDEX IF NOT EXISTS idx_vat_periods_closed_by ON public.vat_periods (closed_by);
CREATE INDEX IF NOT EXISTS idx_vat_periods_created_by ON public.vat_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_vat_periods_updated_by ON public.vat_periods (updated_by);

-- vehicle_assignments
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_created_by ON public.vehicle_assignments (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_driver_id ON public.vehicle_assignments (driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_tenant_id ON public.vehicle_assignments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_updated_by ON public.vehicle_assignments (updated_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_vehicle_id ON public.vehicle_assignments (vehicle_id);

-- vehicle_documents
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_created_by ON public.vehicle_documents (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_tenant_id ON public.vehicle_documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_updated_by ON public.vehicle_documents (updated_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle_id ON public.vehicle_documents (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_verified_by ON public.vehicle_documents (verified_by);

-- vehicle_handover_forms
CREATE INDEX IF NOT EXISTS idx_vehicle_handover_forms_assignment_id ON public.vehicle_handover_forms (assignment_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_handover_forms_created_by ON public.vehicle_handover_forms (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_handover_forms_updated_by ON public.vehicle_handover_forms (updated_by);

-- vehicle_maintenance_events
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_events_created_by ON public.vehicle_maintenance_events (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_events_reported_by_driver_id ON public.vehicle_maintenance_events (reported_by_driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_events_tenant_id ON public.vehicle_maintenance_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_events_updated_by ON public.vehicle_maintenance_events (updated_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_events_vehicle_id ON public.vehicle_maintenance_events (vehicle_id);

-- vehicle_odometer_logs
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_recorded_by ON public.vehicle_odometer_logs (recorded_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_tenant_id ON public.vehicle_odometer_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_vehicle_id ON public.vehicle_odometer_logs (vehicle_id);

-- vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_created_by ON public.vehicles (created_by);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON public.vehicles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_updated_by ON public.vehicles (updated_by);

-- violation_deduction_ledger
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_applied_by ON public.violation_deduction_ledger (applied_by);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_created_by ON public.violation_deduction_ledger (created_by);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_driver_id ON public.violation_deduction_ledger (driver_id);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_rolled_back_by ON public.violation_deduction_ledger (rolled_back_by);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_tenant_id ON public.violation_deduction_ledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_updated_by ON public.violation_deduction_ledger (updated_by);
CREATE INDEX IF NOT EXISTS idx_violation_deduction_ledger_violation_id ON public.violation_deduction_ledger (violation_id);

-- violations
CREATE INDEX IF NOT EXISTS idx_violations_created_by ON public.violations (created_by);
CREATE INDEX IF NOT EXISTS idx_violations_deduction_applied_by ON public.violations (deduction_applied_by);
CREATE INDEX IF NOT EXISTS idx_violations_driver_id ON public.violations (driver_id);
CREATE INDEX IF NOT EXISTS idx_violations_reported_by ON public.violations (reported_by);
CREATE INDEX IF NOT EXISTS idx_violations_reviewed_by ON public.violations (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_violations_tenant_id ON public.violations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_violations_updated_by ON public.violations (updated_by);
CREATE INDEX IF NOT EXISTS idx_violations_vehicle_id ON public.violations (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_violations_violation_type_id ON public.violations (violation_type_id);
CREATE INDEX IF NOT EXISTS idx_violations_waived_by ON public.violations (waived_by);

-- zatca_csids
CREATE INDEX IF NOT EXISTS idx_zatca_csids_created_by ON public.zatca_csids (created_by);
CREATE INDEX IF NOT EXISTS idx_zatca_csids_updated_by ON public.zatca_csids (updated_by);

-- zatca_transmissions
CREATE INDEX IF NOT EXISTS idx_zatca_transmissions_created_by ON public.zatca_transmissions (created_by);
CREATE INDEX IF NOT EXISTS idx_zatca_transmissions_invoice_id ON public.zatca_transmissions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_zatca_transmissions_updated_by ON public.zatca_transmissions (updated_by);
